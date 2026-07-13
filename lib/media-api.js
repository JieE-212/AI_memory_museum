"use strict";

const fs = require("fs");
const path = require("path");
const { buildImageRegionObservation, publicImageRegion } = require("./media-evidence");
const { extractExifHints } = require("./exif-hints");
const { computeDHash64, classifySimilarity } = require("./media-similarity");
const { MAX_MEDIA_PER_MEMORY } = require("./media-policy");

const SIMILARITY_THRESHOLDS = Object.freeze({
  maxHammingDistance: 8,
  maxAspectRatioDifference: 0.12,
  lowVarianceThreshold: 80,
  maxAverageRgbDistance: 32
});
const FINGERPRINT_SAMPLE = Object.freeze({ width: 9, height: 8 });
const ORPHAN_ASSET_GRACE_MS = 10 * 60 * 1000;

function createMediaApi(options = {}) {
  const { store, storage, interviewDemo, sendJson, readJsonBody, httpError } = options;
  if (!store || !storage || typeof sendJson !== "function" || typeof readJsonBody !== "function") {
    throw new TypeError("Media API dependencies are incomplete.");
  }
  const mediaOperations = createExclusiveQueue();

  function isRawMediaRequest(request, url) {
    if (request.method === "POST" && url.pathname === "/api/media/uploads") return true;
    return request.method === "PUT" && /^\/api\/media\/uploads\/upload-[a-f0-9-]{36}\/(display|thumb)$/.test(url.pathname);
  }

  function isMediaMutation(request, url) {
    if (!["POST", "PUT", "DELETE"].includes(request.method)) return false;
    return url.pathname.startsWith("/api/media/") || /^\/api\/memories\/[a-zA-Z0-9_-]{1,120}\/media(?:\/|$)/.test(url.pathname);
  }

  async function handle(request, response, url) {
    const relevant = url.pathname.startsWith("/api/media/") || /^\/api\/memories\/[a-zA-Z0-9_-]{1,120}\/media(?:\/|$)/.test(url.pathname);
    if (!relevant) return false;
    try {
      if (interviewDemo && isMediaMutation(request, url)) {
        return sendJson(response, 403, {
          error: "公开 Demo 不接收私人图片；请在本地版本体验图片保存。",
          interviewDemo: true,
          blockedAction: `${request.method} ${url.pathname}`
        });
      }

      if (request.method === "POST" && url.pathname === "/api/media/uploads") {
        assertRawImageContentType(request);
        const stage = await storage.beginUpload(request, {
          fileName: url.searchParams.get("filename"),
          privacyMode: url.searchParams.get("privacy"),
          declaredMimeType: request.headers["content-type"]
        });
        return sendJson(response, 201, { upload: stage, policy: storage.policy });
      }

      const uploadVariantMatch = url.pathname.match(/^\/api\/media\/uploads\/(upload-[a-f0-9-]{36})\/(display|thumb)$/);
      if (request.method === "PUT" && uploadVariantMatch) {
        assertRawImageContentType(request, true);
        return await mediaOperations.runExclusive(async () => {
          const stage = await storage.putDerived(uploadVariantMatch[1], uploadVariantMatch[2], request, {
            declaredMimeType: request.headers["content-type"]
          });
          return sendJson(response, 200, { upload: stage });
        });
      }

      const uploadMatch = url.pathname.match(/^\/api\/media\/uploads\/(upload-[a-f0-9-]{36})$/);
      if (uploadMatch && request.method === "GET") {
        return sendJson(response, 200, { upload: await storage.getUpload(uploadMatch[1]) });
      }
      if (uploadMatch && request.method === "DELETE") {
        return await mediaOperations.runExclusive(async () => {
          await storage.discardUpload(uploadMatch[1]);
          return sendJson(response, 200, { ok: true, uploadId: uploadMatch[1] });
        });
      }

      const completeMatch = url.pathname.match(/^\/api\/media\/uploads\/(upload-[a-f0-9-]{36})\/complete$/);
      if (request.method === "POST" && completeMatch) {
        return await mediaOperations.runExclusive(() => completeUpload(completeMatch[1], response));
      }

      if (request.method === "GET" && url.pathname === "/api/media/usage") {
        return sendJson(response, 200, buildUsage());
      }

      const fingerprintMatch = url.pathname.match(/^\/api\/media\/assets\/([a-zA-Z0-9_-]{1,120})\/fingerprint$/);
      if (fingerprintMatch) {
        const asset = requireReadyAsset(fingerprintMatch[1]);
        if (request.method === "GET") {
          return sendJson(response, 200, { fingerprint: publicFingerprint(getFingerprint(asset.id)) });
        }
        if (request.method === "POST") {
          const body = await readJsonBody(request);
          const fingerprint = buildFingerprint(body, asset);
          const existingFingerprint = getFingerprint(asset.id);
          const saved = store.saveMediaObservation({
            ...(existingFingerprint ? { id: existingFingerprint.id } : {}),
            assetId: asset.id,
            kind: "visual_fingerprint",
            source: "system",
            status: "confirmed",
            confidence: 1,
            sensitive: false,
            value: fingerprint,
            metadata: {
              sourceVariant: "display",
              sourceSha256: store.getMediaVariant(asset.id, "display")?.sha256 || "",
              retrievalOnly: true
            }
          });
          return sendJson(response, existingFingerprint ? 200 : 201, { fingerprint: publicFingerprint(saved) });
        }
      }

      const similarMatch = url.pathname.match(/^\/api\/media\/assets\/([a-zA-Z0-9_-]{1,120})\/similar$/);
      if (request.method === "GET" && similarMatch) {
        const asset = requireReadyAsset(similarMatch[1]);
        return sendJson(response, 200, buildSimilarCandidates(asset, url.searchParams.get("limit")));
      }

      const variantMatch = url.pathname.match(/^\/api\/media\/([a-zA-Z0-9_-]{1,120})\/(thumb|display|original)$/);
      if (["GET", "HEAD"].includes(request.method) && variantMatch) {
        return await serveVariant(request, response, variantMatch[1], variantMatch[2]);
      }

      const memoryMediaMatch = url.pathname.match(/^\/api\/memories\/([a-zA-Z0-9_-]{1,120})\/media$/);
      if (memoryMediaMatch) {
        const memoryId = memoryMediaMatch[1];
        if (!store.getMemory(memoryId)) throw httpError(404, "没有找到这件展品。");
        if (request.method === "GET") return sendJson(response, 200, { media: publicMediaList(memoryId) });
        if (request.method === "POST") {
          const body = await readJsonBody(request);
          const current = store.listMediaForMemory(memoryId);
          const alreadyLinked = current.some((item) => item.assetId === body.assetId);
          if (!alreadyLinked && current.length >= MAX_MEDIA_PER_MEMORY) {
            throw httpError(400, `每件展品最多保存 ${MAX_MEDIA_PER_MEMORY} 张照片；请先移除一张再添加。`);
          }
          const linked = store.attachMedia(memoryId, body.assetId, mediaDetails(body));
          return sendJson(response, 201, { media: publicMedia(linked), collection: publicMediaList(memoryId) });
        }
        if (request.method === "PUT") {
          const body = await readJsonBody(request);
          if (!Array.isArray(body.items)) throw httpError(400, "items 必须是图片关联数组。");
          if (body.items.length > storage.policy.maxPhotosPerMemory) {
            throw httpError(400, `每段记忆最多保存 ${storage.policy.maxPhotosPerMemory} 张照片。`);
          }
          const collection = store.replaceMemoryMedia(memoryId, replacementMediaItems(body.items, httpError));
          return sendJson(response, 200, { collection: collection.map(publicMedia) });
        }
      }

      const memoryMediaItemMatch = url.pathname.match(/^\/api\/memories\/([a-zA-Z0-9_-]{1,120})\/media\/([a-zA-Z0-9_-]{1,120})$/);
      if (memoryMediaItemMatch) {
        const [, memoryId, assetId] = memoryMediaItemMatch;
        if (!store.getMemory(memoryId)) throw httpError(404, "没有找到这件展品。");
        if (request.method === "PUT") {
          const body = await readJsonBody(request);
          const linked = store.updateMemoryMedia(memoryId, assetId, mediaDetails(body));
          return sendJson(response, 200, { media: publicMedia(linked), collection: publicMediaList(memoryId) });
        }
        if (request.method === "DELETE") {
          const detached = store.detachMedia(memoryId, assetId);
          if (!detached) throw httpError(404, "这张照片没有关联到当前展品。");
          let removedAsset = null;
          let cleanupPending = false;
          try { removedAsset = await removeAssetIfUnreferenced(assetId); } catch { cleanupPending = true; }
          return sendJson(response, 200, {
            ok: true,
            detached: { memoryId, assetId },
            assetRemoved: Boolean(removedAsset),
            cleanupPending,
            collection: publicMediaList(memoryId)
          });
        }
      }

      const annotationCollectionMatch = url.pathname.match(/^\/api\/memories\/([a-zA-Z0-9_-]{1,120})\/media\/([a-zA-Z0-9_-]{1,120})\/annotations$/);
      if (annotationCollectionMatch) {
        const [, memoryId, assetId] = annotationCollectionMatch;
        const linked = requireLinkedMedia(memoryId, assetId);
        if (request.method === "GET") {
          return sendJson(response, 200, { annotations: listAnnotations(memoryId, linked) });
        }
        if (request.method === "POST") {
          const body = await readJsonBody(request);
          const observation = buildImageRegionObservation(body, { asset: linked.asset, memoryId });
          const saved = store.saveMediaObservation(observation);
          return sendJson(response, 201, { annotation: publicImageRegion(saved, publicMedia(linked)) });
        }
      }

      const annotationItemMatch = url.pathname.match(/^\/api\/memories\/([a-zA-Z0-9_-]{1,120})\/media\/([a-zA-Z0-9_-]{1,120})\/annotations\/([a-zA-Z0-9_-]{1,120})$/);
      if (annotationItemMatch) {
        const [, memoryId, assetId, annotationId] = annotationItemMatch;
        const linked = requireLinkedMedia(memoryId, assetId);
        const existing = store.getMediaObservation(annotationId);
        if (!existing || existing.assetId !== assetId || existing.metadata?.memoryId !== memoryId) {
          throw httpError(404, "没有找到这条图片区域证据。");
        }
        if (request.method === "PUT") {
          const body = await readJsonBody(request);
          const observation = buildImageRegionObservation({ ...body, id: annotationId }, { asset: linked.asset, memoryId });
          const saved = store.saveMediaObservation(observation);
          return sendJson(response, 200, { annotation: publicImageRegion(saved, publicMedia(linked)) });
        }
        if (request.method === "DELETE") {
          store.deleteMediaObservation(annotationId);
          return sendJson(response, 200, { ok: true, annotationId });
        }
      }

      const orphanMatch = url.pathname.match(/^\/api\/media\/assets\/([a-zA-Z0-9_-]{1,120})$/);
      if (request.method === "DELETE" && orphanMatch) {
        const removed = await removeAssetIfUnreferenced(orphanMatch[1], true);
        if (!removed) throw httpError(409, "媒体仍被展品引用，不能删除。");
        return sendJson(response, 200, { ok: true, assetId: orphanMatch[1] });
      }

      return false;
    } catch (error) {
      throw normalizeMediaError(error, httpError);
    }
  }

  async function completeUpload(uploadId, response) {
    const stage = await storage.getUpload(uploadId);
    if (!stage.readyToFinalize) throw httpError(409, "展示图和缩略图尚未准备完成。");
    const contentHash = stage.privacyMode === "sanitized_only"
      ? stage.variants.display.sha256
      : stage.source.sha256;
    const existing = store.getMediaAssetByHash(contentHash);
    if (existing?.status === "ready") {
      if (existing.privacyMode !== stage.privacyMode) {
        await storage.discardUpload(stage.uploadId);
        throw httpError(409, "相同图片已使用另一种原图保存策略，请保持现有隐私选择或先移除旧资产。");
      }
      if (!await isStoredAssetIntact(existing)) {
        throw httpError(409, "相同内容的现有图片未通过完整性校验，请先移除或从完整备份恢复该资产。");
      }
      const refreshed = store.markMediaReady(existing.id);
      await storage.discardUpload(stage.uploadId);
      return sendJson(response, 200, { deduplicated: true, media: publicAsset(refreshed) });
    }

    const exif = typeof storage.readUploadSource === "function"
      ? await storage.readUploadSource(stage.uploadId).then(extractExifHints).catch(() => null)
      : null;
    const finalized = await storage.finalizeUpload(stage.uploadId);
    try {
      const saved = store.withTransaction(() => {
        const created = store.createMediaAsset({ ...finalized.asset, status: "ready" }, finalized.variants);
        saveExifObservations(created.id, exif, created.privacyMode);
        return created;
      });
      return sendJson(response, 201, { deduplicated: false, media: publicAsset(saved) });
    } catch (error) {
      const duplicate = error.code === "MEDIA_ASSET_HASH_EXISTS"
        ? store.getMediaAssetByHash(finalized.asset.contentSha256)
        : null;
      const reusableDuplicate = duplicate?.status === "ready"
        && duplicate.privacyMode === finalized.asset.privacyMode
        && await isStoredAssetIntact(duplicate);
      const quarantined = await storage.quarantineAsset(finalized.asset.id, finalized.variants);
      await storage.removeQuarantined(quarantined).catch(() => {});
      if (reusableDuplicate) {
        const refreshed = store.markMediaReady(duplicate.id);
        return sendJson(response, 200, { deduplicated: true, media: publicAsset(refreshed) });
      }
      if (duplicate?.status === "ready") throw httpError(409, "相同内容的现有图片隐私策略不一致或未通过完整性校验。");
      throw error;
    }
  }

  function publicMediaList(memoryId) {
    return store.listMediaForMemory(memoryId).map(publicMedia);
  }

  function requireLinkedMedia(memoryId, assetId) {
    if (!store.getMemory(memoryId)) throw httpError(404, "没有找到这件展品。");
    const linked = store.listMediaForMemory(memoryId).find((item) => item.assetId === assetId);
    if (!linked) throw httpError(404, "这张照片没有关联到当前展品。");
    return linked;
  }

  function listAnnotations(memoryId, linked) {
    const media = publicMedia(linked);
    return store.listMediaObservations({ assetId: linked.assetId, kind: "image_region", status: "confirmed" })
      .filter((observation) => !observation.metadata?.memoryId || observation.metadata.memoryId === memoryId)
      .map((observation) => publicImageRegion(observation, media));
  }

  function publicMedia(item) {
    if (!item) return null;
    const asset = item.asset || store.getMediaAsset(item.assetId);
    const hydratedAsset = asset ? { ...asset, variants: item.variants || asset.variants || [] } : null;
    return {
      assetId: item.assetId,
      role: item.role,
      position: item.position,
      caption: item.caption || "",
      altText: item.altText || "",
      backNote: item.backNote || "",
      metadata: item.metadata || {},
      ...publicAsset(hydratedAsset)
    };
  }

  function publicAsset(asset) {
    if (!asset) return null;
    const kinds = new Set((asset.variants || []).map((variant) => variant.kind));
    return {
      id: asset.id,
      contentSha256: asset.contentSha256,
      originalName: asset.originalName,
      mimeType: asset.sourceMimeType,
      byteSize: asset.sourceByteSize,
      width: asset.width,
      height: asset.height,
      privacyMode: asset.privacyMode,
      status: asset.status,
      safeMetadata: asset.safeMetadata || {},
      hints: publicExifHints(asset.id),
      urls: {
        thumb: kinds.has("thumb") ? `/api/media/${encodeURIComponent(asset.id)}/thumb` : "",
        display: kinds.has("display") ? `/api/media/${encodeURIComponent(asset.id)}/display` : "",
        original: kinds.has("original") ? `/api/media/${encodeURIComponent(asset.id)}/original` : ""
      },
      createdAt: asset.createdAt,
      updatedAt: asset.updatedAt
    };
  }

  function requireReadyAsset(assetId) {
    const asset = store.getMediaAsset(assetId);
    if (!asset || asset.status !== "ready") throw httpError(404, "图片不存在或尚未准备完成。");
    return asset;
  }

  async function isStoredAssetIntact(asset) {
    const requiredKinds = asset.privacyMode === "preserve_original" ? ["original", "display", "thumb"] : ["display", "thumb"];
    const variants = Array.isArray(asset.variants) ? asset.variants : [];
    if (variants.length !== requiredKinds.length || requiredKinds.some((kind) => !variants.some((variant) => variant.kind === kind))) return false;
    for (const variant of variants) {
      if (!await storage.verifyVariant(variant).catch(() => false)) return false;
    }
    return true;
  }

  function saveExifObservations(assetId, exif, privacyMode) {
    if (!exif || !Array.isArray(exif.hints)) return [];
    const observations = exif.hints.filter((hint) => privacyMode !== "sanitized_only" || !hint.sensitive);
    if (Number.isInteger(exif.orientation)) {
      observations.push({
        kind: "orientation",
        source: "exif",
        status: "suggested",
        sensitive: false,
        value: { orientation: exif.orientation }
      });
    }
    return observations.map((hint) => store.saveMediaObservation({
      assetId,
      kind: hint.kind,
      source: "exif",
      status: "suggested",
      confidence: null,
      sensitive: Boolean(hint.sensitive),
      value: hint.value,
      metadata: {
        parser: exif.source || "jpeg-app1-exif",
        requiresUserConfirmation: true,
        reverseGeocoded: false
      }
    }));
  }

  function publicExifHints(assetId) {
    return store.listMediaObservations({ assetId, source: "exif", status: "suggested", limit: 20 })
      .map((observation) => ({
        id: observation.id,
        kind: observation.kind,
        status: "suggested",
        sensitive: Boolean(observation.sensitive),
        requiresUserConfirmation: true,
        value: observation.sensitive ? null : observation.value,
        available: true
      }));
  }

  function getFingerprint(assetId) {
    return store.listMediaObservations({ assetId, kind: "visual_fingerprint", source: "system", limit: 2 })[0] || null;
  }

  function buildFingerprint(body, asset) {
    const sample = body?.sample;
    if (!sample || Number(sample.width) !== FINGERPRINT_SAMPLE.width || Number(sample.height) !== FINGERPRINT_SAMPLE.height) {
      throw httpError(400, `图片指纹采样必须是 ${FINGERPRINT_SAMPLE.width}×${FINGERPRINT_SAMPLE.height} RGBA。`);
    }
    const encoded = String(sample.rgbaBase64 || "");
    const expectedBytes = FINGERPRINT_SAMPLE.width * FINGERPRINT_SAMPLE.height * 4;
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length > 512) {
      throw httpError(400, "图片指纹采样格式无效。");
    }
    const pixels = Buffer.from(encoded, "base64");
    if (pixels.length !== expectedBytes || pixels.toString("base64") !== encoded) {
      throw httpError(400, "图片指纹采样长度无效。");
    }
    const computed = computeDHash64({
      pixels,
      width: FINGERPRINT_SAMPLE.width,
      height: FINGERPRINT_SAMPLE.height
    });
    return {
      ...computed,
      aspectRatio: Number(asset.width) / Number(asset.height),
      sample: { ...FINGERPRINT_SAMPLE, source: "browser-canonical-display" }
    };
  }

  function publicFingerprint(observation) {
    if (!observation) return null;
    return {
      id: observation.id,
      assetId: observation.assetId,
      algorithm: observation.value?.algorithm || "",
      ready: Boolean(observation.value?.hash),
      updatedAt: observation.updatedAt
    };
  }

  function buildSimilarCandidates(asset, rawLimit) {
    const source = getFingerprint(asset.id);
    const limit = Math.min(20, Math.max(1, Number.parseInt(rawLimit, 10) || 8));
    if (!source?.value?.hash) {
      return {
        assetId: asset.id,
        ready: false,
        candidates: [],
        policy: { ...SIMILARITY_THRESHOLDS, resultMeaning: "possible_match_requires_review" }
      };
    }
    const candidates = [];
    for (const candidateAsset of listAllAssets()) {
      if (candidateAsset.id === asset.id || candidateAsset.status !== "ready") continue;
      const candidateFingerprint = getFingerprint(candidateAsset.id);
      if (!candidateFingerprint?.value?.hash) continue;
      let classification;
      try {
        classification = classifySimilarity(
          { ...source.value, contentSha256: asset.contentSha256 },
          { ...candidateFingerprint.value, contentSha256: candidateAsset.contentSha256 },
          SIMILARITY_THRESHOLDS
        );
      } catch {
        continue;
      }
      if (!classification.isCandidate) continue;
      const memoryIds = store.getMediaUsage(candidateAsset.id)?.memoryIds || [];
      candidates.push({
        assetId: candidateAsset.id,
        classification: "similar_candidate",
        requiresReview: true,
        metrics: classification.metrics,
        media: publicAsset(candidateAsset),
        memories: memoryIds.map((memoryId) => store.getMemory(memoryId)).filter(Boolean).map((memory) => ({
          id: memory.id,
          title: memory.title,
          date: memory.date || ""
        }))
      });
    }
    candidates.sort((left, right) => (
      left.metrics.hammingDistance - right.metrics.hammingDistance
      || left.metrics.aspectRatioDifference - right.metrics.aspectRatioDifference
      || left.assetId.localeCompare(right.assetId)
    ));
    return {
      assetId: asset.id,
      ready: true,
      candidates: candidates.slice(0, limit),
      policy: { ...SIMILARITY_THRESHOLDS, resultMeaning: "possible_match_requires_review" }
    };
  }

  async function removeAssetIfUnreferenced(assetId, explicit = false) {
    return mediaOperations.runExclusive(() => removeAssetIfUnreferencedUnlocked(assetId, explicit));
  }

  async function removeAssetIfUnreferencedUnlocked(assetId, explicit = false) {
    const asset = store.getMediaAsset(assetId);
    if (!asset) return null;
    const usage = store.getMediaUsage(assetId);
    if (usage?.memoryCount > 0) return null;
    if (!explicit && asset.status !== "ready") return null;
    store.markMediaPendingDelete(assetId);
    const quarantined = await storage.quarantineAsset(assetId, asset.variants);
    let removed;
    try {
      removed = store.deleteMediaAsset(assetId);
      if (!removed) throw httpError(409, "媒体记录状态已变化，请重试删除。");
    } catch (error) {
      await storage.restoreQuarantined?.(quarantined, assetId, asset.variants).catch(() => {});
      throw error;
    }
    await storage.removeQuarantined(quarantined).catch(() => {});
    return removed;
  }

  async function garbageCollect(options = {}) {
    return mediaOperations.runExclusive(() => garbageCollectUnlocked(options));
  }

  async function garbageCollectUnlocked(options = {}) {
    const removed = [];
    const filters = {
      status: options.status || "pending_delete",
      limit: options.limit || 100
    };
    if (options.before) filters.before = options.before;
    else if (filters.status === "ready") filters.before = new Date(Date.now() - storage.policy.staleStageMs).toISOString();
    const assets = store.listUnreferencedMediaAssets(filters);
    for (const asset of assets) {
      const result = await removeAssetIfUnreferencedUnlocked(asset.id, true);
      if (result) removed.push(asset.id);
    }
    return removed;
  }

  function listAllAssets() {
    const assets = [];
    let offset = 0;
    while (true) {
      const page = store.listMediaAssets({ limit: 500, offset });
      assets.push(...page);
      if (page.length < 500) break;
      offset += page.length;
    }
    return assets;
  }

  async function quarantineStoredFiles(assets = []) {
    return mediaOperations.runExclusive(() => quarantineStoredFilesUnlocked(assets));
  }

  async function quarantineStoredFilesUnlocked(assets = []) {
    const quarantined = [];
    try {
      for (const asset of assets) {
        const directory = await storage.quarantineAsset(asset.id, asset.variants || []);
        quarantined.push({ asset, directory });
      }
      return quarantined;
    } catch (error) {
      try {
        await restoreStoredFilesUnlocked(quarantined);
      } catch (rollbackError) {
        error.rollbackError = rollbackError;
      }
      throw error;
    }
  }

  async function restoreStoredFiles(entries = []) {
    return mediaOperations.runExclusive(() => restoreStoredFilesUnlocked(entries));
  }

  async function restoreStoredFilesUnlocked(entries = []) {
    const failures = [];
    for (const entry of [...entries].reverse()) {
      if (!entry?.directory) continue;
      try {
        await storage.restoreQuarantined(entry.directory, entry.asset.id, entry.asset.variants || []);
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length) throw new AggregateError(failures, "部分媒体文件未能从隔离区恢复。");
  }

  async function removeQuarantinedFiles(entries = []) {
    return mediaOperations.runExclusive(() => removeQuarantinedFilesUnlocked(entries));
  }

  async function removeQuarantinedFilesUnlocked(entries = []) {
    const removed = [];
    const pending = [];
    for (const entry of entries) {
      if (!entry?.directory) continue;
      try {
        await storage.removeQuarantined(entry.directory);
        removed.push(entry.asset.id);
      } catch {
        pending.push(entry.asset.id);
      }
    }
    return { removed, pending };
  }

  async function removeStoredFiles(assets = []) {
    return mediaOperations.runExclusive(async () => {
      const quarantined = await quarantineStoredFilesUnlocked(assets);
      return removeQuarantinedFilesUnlocked(quarantined);
    });
  }

  // Coordinated callbacks may use direct store/storage operations only; re-entering a locked wrapper would self-deadlock.
  function withMediaOperation(operation) {
    return mediaOperations.runExclusive(operation);
  }

  async function purgeAll(purgeRecords) {
    if (typeof purgeRecords !== "function") throw new TypeError("purgeRecords must be a function.");
    return mediaOperations.runExclusive(async () => {
      const quarantined = await quarantineStoredFilesUnlocked(listAllAssets());
      let purge;
      try {
        purge = await purgeRecords();
      } catch (error) {
        try {
          await restoreStoredFilesUnlocked(quarantined);
        } catch (rollbackError) {
          error.rollbackError = rollbackError;
        }
        throw error;
      }
      const cleanup = await removeQuarantinedFilesUnlocked(quarantined);
      return { purge, cleanup };
    });
  }

  async function reconcileQuarantine(options = {}) {
    return mediaOperations.runExclusive(() => reconcileQuarantineUnlocked(options));
  }

  async function reconcileQuarantineUnlocked(options = {}) {
    if (typeof storage.listQuarantined !== "function") return { restored: [], removed: [], pending: [] };
    const entries = await storage.listQuarantined(options.now, options.minimumAgeMs);
    const result = { restored: [], removed: [], pending: [] };
    for (const entry of entries) {
      const asset = store.getMediaAsset(entry.assetId);
      try {
        if (!asset) {
          await storage.removeQuarantined(entry.directory);
          result.removed.push(entry.assetId);
        } else if (asset.status === "pending_delete" && !store.getMediaUsage(asset.id)?.memoryCount) {
          store.deleteMediaAsset(asset.id);
          await storage.removeQuarantined(entry.directory);
          result.removed.push(entry.assetId);
        } else {
          await storage.restoreQuarantined(entry.directory, asset.id, asset.variants || []);
          if (asset.status === "pending_delete") store.markMediaReady(asset.id);
          result.restored.push(entry.assetId);
        }
      } catch {
        result.pending.push(entry.assetId);
      }
    }
    return result;
  }

  async function reconcileAssetDirectories(options = {}) {
    return mediaOperations.runExclusive(() => reconcileAssetDirectoriesUnlocked(options));
  }

  async function reconcileAssetDirectoriesUnlocked(options = {}) {
    if (typeof storage.listAssetDirectories !== "function" || typeof storage.quarantineOrphanDirectory !== "function") {
      return { removed: [], pending: [] };
    }
    const now = Number(options.now) || Date.now();
    const graceMs = Number.isFinite(Number(options.graceMs)) ? Math.max(0, Number(options.graceMs)) : ORPHAN_ASSET_GRACE_MS;
    const result = { removed: [], pending: [] };
    for (const entry of await storage.listAssetDirectories()) {
      if (now - Number(entry.updatedAtMs) < graceMs || store.getMediaAsset(entry.assetId)) continue;
      try {
        const quarantined = await storage.quarantineOrphanDirectory(entry.directory, entry.assetId);
        await storage.removeQuarantined(quarantined);
        result.removed.push(entry.assetId);
      } catch {
        result.pending.push(entry.assetId);
      }
    }
    return result;
  }

  function buildUsage() {
    const usage = store.getMediaUsage();
    const assets = store.listMediaAssets({ status: "ready", limit: 500 });
    const referencedIds = new Set(usage.filter((item) => item.memoryCount > 0).map((item) => item.assetId));
    const referenced = assets.filter((asset) => referencedIds.has(asset.id));
    return {
      assets: referenced.length,
      memories: new Set(usage.flatMap((item) => item.memoryIds || [])).size,
      sourceBytes: referenced.reduce((sum, asset) => sum + Number(asset.sourceByteSize || 0), 0),
      totalVariantBytes: referenced.reduce((sum, asset) => (
        sum + (asset.variants || []).reduce((inner, variant) => inner + Number(variant.byteSize || 0), 0)
      ), 0),
      policy: storage.policy
    };
  }

  async function serveVariant(request, response, assetId, kind) {
    const asset = store.getMediaAsset(assetId);
    if (!asset || asset.status !== "ready") throw httpError(404, "图片不存在或尚未准备完成。");
    const variant = store.getMediaVariant(assetId, kind);
    if (!variant) throw httpError(404, "没有找到这个图片版本。");
    const filePath = storage.resolveStorageKey(variant.storageKey);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) throw httpError(404, "图片文件暂时不可用。");
    if (!await storage.verifyVariant(variant).catch(() => false)) throw httpError(409, "图片文件未通过内容完整性校验。");
    const etag = `"sha256-${variant.sha256}"`;
    response.setHeader("Content-Type", variant.mimeType);
    response.setHeader("Content-Length", String(variant.byteSize));
    response.setHeader("ETag", etag);
    response.setHeader("Accept-Ranges", "none");
    response.setHeader("Cache-Control", kind === "original" ? "private, no-store" : "private, max-age=31536000, immutable");
    if (kind === "original") {
      response.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(path.basename(asset.originalName || `memory-photo.${extensionForMime(variant.mimeType)}`))}`);
    }
    if (String(request.headers["if-none-match"] || "") === etag) {
      response.statusCode = 304;
      return response.end();
    }
    response.statusCode = 200;
    if (request.method === "HEAD") return response.end();
    fs.createReadStream(filePath).pipe(response);
  }

  return {
    handle,
    isRawMediaRequest,
    isMediaMutation,
    publicMedia,
    publicMediaList,
    publicAsset,
    garbageCollect,
    withMediaOperation,
    purgeAll,
    listAllAssets,
    quarantineStoredFiles,
    restoreStoredFiles,
    removeQuarantinedFiles,
    removeStoredFiles,
    reconcileQuarantine,
    reconcileAssetDirectories
  };
}

function createExclusiveQueue() {
  let tail = Promise.resolve();
  return Object.freeze({
    runExclusive(operation) {
      if (typeof operation !== "function") throw new TypeError("Exclusive media operation must be a function.");
      const result = tail.then(() => operation());
      tail = result.then(() => undefined, () => undefined);
      return result;
    }
  });
}

function mediaDetails(input = {}) {
  return {
    ...(input.role !== undefined ? { role: input.role } : {}),
    ...(input.position !== undefined ? { position: input.position } : {}),
    ...(input.caption !== undefined ? { caption: input.caption } : {}),
    ...(input.altText !== undefined ? { altText: input.altText } : {}),
    ...(input.backNote !== undefined ? { backNote: input.backNote } : {}),
    ...(input.metadata !== undefined ? { metadata: input.metadata } : {})
  };
}

function replacementMediaItems(items, httpError) {
  const allowedKeys = new Set(["assetId", "id", "role", "position", "caption", "altText", "backNote", "metadata"]);
  const seenAssetIds = new Set();
  let coverCount = 0;
  return items.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw httpError(400, `items[${index}] 必须是图片关联对象。`);
    }
    const unknownKeys = Object.keys(item).filter((key) => !allowedKeys.has(key));
    if (unknownKeys.length) {
      throw httpError(400, `items[${index}] 包含未知字段：${unknownKeys.join("、")}。`);
    }

    const assetId = item.assetId ?? item.id;
    if (typeof assetId !== "string" || !/^[a-zA-Z0-9_-]{1,120}$/.test(assetId)) {
      throw httpError(400, `items[${index}].assetId 无效。`);
    }
    if (item.assetId !== undefined && item.id !== undefined && item.assetId !== item.id) {
      throw httpError(400, `items[${index}] 的 assetId 与 id 相互矛盾。`);
    }
    if (seenAssetIds.has(assetId)) {
      throw httpError(400, `items[${index}] 重复引用了同一张照片。`);
    }
    seenAssetIds.add(assetId);

    if (item.position !== undefined && (!Number.isSafeInteger(item.position) || item.position !== index)) {
      throw httpError(400, `items[${index}].position 必须与数组顺序一致。`);
    }
    if (item.role === "cover") coverCount += 1;
    if (coverCount > 1) throw httpError(400, "图片关联最多只能指定一张封面。");

    const { position: _position, ...details } = mediaDetails(item);
    return { assetId, ...details };
  });
}

function assertRawImageContentType(request, derived = false) {
  const mimeType = String(request.headers["content-type"] || "").split(";", 1)[0].trim().toLowerCase();
  const allowed = derived ? ["image/webp"] : ["image/jpeg", "image/png", "image/webp", "application/octet-stream"];
  if (!allowed.includes(mimeType)) {
    const error = new Error(derived ? "展示图和缩略图必须是 WebP。" : "仅支持 JPEG、PNG 或 WebP 图片。");
    error.statusCode = 415;
    throw error;
  }
}

function normalizeMediaError(error, httpError) {
  if (error?.statusCode) return error;
  if (error?.code === "ENOENT") return httpError(404, "媒体文件不存在。");
  if (String(error?.code || "").includes("NOT_FOUND")) return httpError(404, error.message);
  if (/EXISTS|IN_USE|NOT_READY|REQUIRED/.test(String(error?.code || ""))) return httpError(409, error.message);
  if (error instanceof TypeError || error instanceof RangeError || /^IMAGE_|^DERIVED_/.test(String(error?.code || ""))) {
    return httpError(400, error.message);
  }
  return error;
}

function extensionForMime(mimeType) {
  return ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" })[mimeType] || "bin";
}

module.exports = { createMediaApi };
