"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const {
  MAX_MEDIA_PER_MEMORY,
  MEDIA_ARCHIVE_LIMITS,
  mediaObservationPolicyViolation
} = require("./media-policy");

function restorePreparedArchive(options = {}) {
  const {
    prepared,
    store,
    storage,
    normalizeMemory,
    validateArchaeologyBackup,
    restoreArchaeologyBackup,
    createId
  } = options;
  assertDependencies({ prepared, store, storage, normalizeMemory, createId });
  assertPreparedArchiveLimits(prepared);

  const sourceMemories = prepared.collection.memories;
  const sourceIds = sourceMemories.map((memory) => requireId(memory.id, "memory.id"));
  const archaeology = prepared.collection.archaeology || null;
  if (archaeology && typeof validateArchaeologyBackup === "function") {
    validateArchaeologyBackup(archaeology, sourceIds);
  }

  const memoryPlan = buildMemoryPlan(sourceMemories, store, normalizeMemory, createId);
  const assetPlan = buildAssetPlan(prepared, store, storage, createId);
  const linksByMemory = mapLinks(prepared.links, memoryPlan.idMap, assetPlan.idMap);
  const sourcePrivacyModes = new Map(prepared.assets.map((asset) => [asset.id, asset.privacyMode]));
  const observationPlan = buildObservationPlan(
    prepared.mediaObservations,
    memoryPlan.idMap,
    assetPlan.idMap,
    sourcePrivacyModes,
    store,
    createId
  );

  const movedDirectories = [];
  try {
    materializeAssetFiles(assetPlan.newAssets, movedDirectories);
    let archaeologyResult = { events: 0, claims: 0, decisions: 0, questions: 0, skipped: 0 };
    store.withTransaction(() => {
      store.importMemories(memoryPlan.memories);
      for (const planned of assetPlan.newAssets) {
        store.createMediaAsset(planned.asset, planned.variants);
      }
      for (const [memoryId, links] of linksByMemory) {
        store.replaceMemoryMedia(memoryId, links);
      }
      for (const observation of observationPlan) store.saveMediaObservation(observation);
      if (archaeology?.mode === "full" && typeof restoreArchaeologyBackup === "function") {
        archaeologyResult = restoreArchaeologyBackup(store, archaeology, memoryPlan.idMap);
        if (archaeologyResult.skipped) {
          throw restoreError("时光拼图关系未能完整恢复。", "MEDIA_RESTORE_ARCHAEOLOGY_INCOMPLETE");
        }
      }
    });
    return {
      imported: memoryPlan.memories.length,
      memories: memoryPlan.memories.map((memory) => store.getMemory(memory.id)),
      media: {
        assetsCreated: assetPlan.newAssets.length,
        assetsReused: assetPlan.reusedCount,
        links: [...linksByMemory.values()].reduce((sum, links) => sum + links.length, 0),
        observations: observationPlan.length
      },
      archaeology: archaeologyResult,
      idMap: {
        memories: Object.fromEntries(memoryPlan.idMap),
        assets: Object.fromEntries(assetPlan.idMap)
      }
    };
  } catch (error) {
    cleanupMovedDirectories(movedDirectories);
    throw error;
  }
}

function buildMemoryPlan(sourceMemories, store, normalizeMemory, createId) {
  const occupied = new Set(store.listMemories().map((memory) => memory.id));
  const idMap = new Map();
  const memories = sourceMemories.map((source) => {
    const sourceId = requireId(source.id, "memory.id");
    let targetId = sourceId;
    if (occupied.has(targetId)) targetId = uniqueId("memory", occupied, createId);
    occupied.add(targetId);
    idMap.set(sourceId, targetId);
    const normalized = normalizeMemory({ ...source, id: targetId, agentRunId: "", coverImage: "" });
    normalized.id = targetId;
    normalized.agentRunId = "";
    normalized.coverImage = "";
    return normalized;
  });
  return { memories, idMap };
}

function buildAssetPlan(prepared, store, storage, createId) {
  const existingAssets = listAllAssets(store);
  const anyByHash = new Map(existingAssets.map((asset) => [asset.contentSha256, asset]));
  const byHash = new Map(existingAssets.filter((asset) => asset.status === "ready").map((asset) => [asset.contentSha256, asset]));
  const occupied = new Set(existingAssets.map((asset) => asset.id));
  const variantFileByKey = new Map(prepared.files.variants.map((file) => [`${file.assetId}\0${file.kind}`, file]));
  const idMap = new Map();
  const newAssets = [];
  let reusedCount = 0;

  for (const sourceAsset of prepared.assets) {
    if (anyByHash.has(sourceAsset.contentSha256) && !byHash.has(sourceAsset.contentSha256)) {
      throw restoreError("相同内容的媒体正在等待回收，请完成清理后再恢复归档。", "MEDIA_RESTORE_ASSET_NOT_READY");
    }
    const reusable = byHash.get(sourceAsset.contentSha256);
    if (reusable) {
      assertReusableAsset(sourceAsset, reusable, storage);
      idMap.set(sourceAsset.id, reusable.id);
      reusedCount += 1;
      continue;
    }
    let targetId = sourceAsset.id;
    if (occupied.has(targetId)) targetId = uniqueId("asset", occupied, createId);
    occupied.add(targetId);
    idMap.set(sourceAsset.id, targetId);
    const directoryKey = `assets/${sourceAsset.contentSha256.slice(0, 2)}/${targetId}`;
    const destinationDirectory = storage.resolveStorageKey(directoryKey);
    if (fs.existsSync(destinationDirectory)) {
      throw restoreError("媒体恢复目标目录已经存在。", "MEDIA_RESTORE_TARGET_EXISTS");
    }
    const variants = sourceAsset.variants.map((variant) => {
      const staged = variantFileByKey.get(`${sourceAsset.id}\0${variant.kind}`);
      if (!staged) throw restoreError("媒体恢复缺少已验证文件。", "MEDIA_RESTORE_FILE_MISSING");
      const fileName = variantFileName(variant.kind, variant.mimeType);
      return {
        descriptor: {
          assetId: targetId,
          kind: variant.kind,
          storageKey: `${directoryKey}/${fileName}`,
          mimeType: variant.mimeType,
          byteSize: variant.byteSize,
          width: variant.width,
          height: variant.height,
          sha256: variant.sha256,
          createdAt: variant.createdAt,
          updatedAt: variant.updatedAt
        },
        sourcePath: staged.filePath,
        destinationPath: storage.resolveStorageKey(`${directoryKey}/${fileName}`)
      };
    });
    const planned = {
      sourceId: sourceAsset.id,
      directory: destinationDirectory,
      asset: {
        id: targetId,
        contentSha256: sourceAsset.contentSha256,
        originalName: sourceAsset.originalName,
        sourceMimeType: sourceAsset.sourceMimeType,
        sourceByteSize: sourceAsset.sourceByteSize,
        width: sourceAsset.width,
        height: sourceAsset.height,
        storageDriver: "local",
        privacyMode: sourceAsset.privacyMode,
        status: "ready",
        safeMetadata: { ...(sourceAsset.safeMetadata || {}) },
        createdAt: sourceAsset.createdAt,
        updatedAt: sourceAsset.updatedAt
      },
      variants: variants.map((variant) => variant.descriptor),
      fileMoves: variants
    };
    newAssets.push(planned);
    byHash.set(sourceAsset.contentSha256, planned.asset);
  }
  return { idMap, newAssets, reusedCount };
}

function assertReusableAsset(sourceAsset, reusable, storage) {
  if (sourceAsset.privacyMode !== reusable.privacyMode) {
    throw restoreError("相同内容的现有媒体使用了不同的原图保存策略，无法安全复用。", "MEDIA_RESTORE_ASSET_CONFLICT");
  }
  const sourceVariants = new Map((sourceAsset.variants || []).map((variant) => [variant.kind, variant]));
  const reusableVariants = new Map((reusable.variants || []).map((variant) => [variant.kind, variant]));
  if (sourceVariants.size !== reusableVariants.size || [...sourceVariants.keys()].some((kind) => !reusableVariants.has(kind))) {
    throw restoreError("相同内容的现有媒体变体集合与归档不一致。", "MEDIA_RESTORE_ASSET_CONFLICT");
  }
  for (const [kind, source] of sourceVariants) {
    const current = reusableVariants.get(kind);
    const descriptorMatches = ["sha256", "mimeType", "byteSize", "width", "height"]
      .every((field) => String(current?.[field]) === String(source?.[field]));
    if (!descriptorMatches || !verifyStoredVariant(storage, current)) {
      throw restoreError("相同内容的现有媒体文件缺失、损坏或与归档预览不一致。", "MEDIA_RESTORE_ASSET_CONFLICT");
    }
  }
}

function verifyStoredVariant(storage, variant) {
  let descriptor;
  try {
    const filePath = storage.resolveStorageKey(variant.storageKey);
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== Number(variant.byteSize)) return false;
    const hash = createHash("sha256");
    const handle = fs.openSync(filePath, "r");
    try {
      const buffer = Buffer.allocUnsafe(64 * 1024);
      let bytesRead;
      while ((bytesRead = fs.readSync(handle, buffer, 0, buffer.length, null)) > 0) {
        hash.update(buffer.subarray(0, bytesRead));
      }
    } finally {
      fs.closeSync(handle);
    }
    descriptor = hash.digest("hex");
  } catch {
    return false;
  }
  return descriptor === variant.sha256;
}

function mapLinks(sourceLinks, memoryIdMap, assetIdMap) {
  const groups = new Map();
  const seen = new Set();
  for (const link of sourceLinks) {
    const memoryId = memoryIdMap.get(link.memoryId);
    const assetId = assetIdMap.get(link.assetId);
    if (!memoryId || !assetId) throw restoreError("媒体关联无法映射到恢复对象。", "MEDIA_RESTORE_REFERENCE_INVALID");
    const key = `${memoryId}\0${assetId}`;
    if (seen.has(key)) {
      throw restoreError("两项媒体在恢复时折叠成了同一关联，请先整理源归档。", "MEDIA_RESTORE_REFERENCE_COLLISION");
    }
    seen.add(key);
    const list = groups.get(memoryId) || [];
    if (list.length >= MAX_MEDIA_PER_MEMORY) {
      throw restoreError(
        `每件展品最多恢复 ${MAX_MEDIA_PER_MEMORY} 张图片。`,
        "MEDIA_RESTORE_MEDIA_LIMIT_EXCEEDED"
      );
    }
    list.push({
      restorePosition: link.position,
      assetId,
      role: link.role,
      caption: link.caption,
      altText: link.altText,
      backNote: link.backNote,
      metadata: { ...(link.metadata || {}) }
    });
    groups.set(memoryId, list);
  }
  for (const [memoryId, links] of groups) {
    groups.set(memoryId, links
      .sort((left, right) => left.restorePosition - right.restorePosition)
      .map(({ restorePosition, ...item }) => item));
  }
  return groups;
}

function buildObservationPlan(sourceObservations, memoryIdMap, assetIdMap, sourcePrivacyModes, store, createId) {
  const occupied = new Set();
  const output = [];
  for (const source of sourceObservations) {
    const privacyMode = sourcePrivacyModes.get(source.assetId);
    const privacyViolation = mediaObservationPolicyViolation(source, privacyMode);
    if (!privacyMode || privacyViolation) {
      throw restoreError(
        privacyViolation || "图片线索引用了未知媒体资产。",
        "MEDIA_RESTORE_OBSERVATION_PRIVACY_INVALID"
      );
    }
    let id = source.id;
    if (occupied.has(id) || store.getMediaObservation(id)) id = uniqueId("observation", occupied, createId, store.getMediaObservation);
    occupied.add(id);
    const assetId = assetIdMap.get(source.assetId);
    if (!assetId) throw restoreError("图片线索无法映射到媒体资产。", "MEDIA_RESTORE_REFERENCE_INVALID");
    const metadata = { ...(source.metadata || {}) };
    if (metadata.memoryId) {
      metadata.memoryId = memoryIdMap.get(metadata.memoryId);
      if (!metadata.memoryId) throw restoreError("图片线索无法映射到展品。", "MEDIA_RESTORE_REFERENCE_INVALID");
    }
    output.push({
      id,
      assetId,
      kind: source.kind,
      source: source.source,
      value: source.value,
      status: source.status,
      confidence: source.confidence,
      sensitive: source.sensitive,
      metadata,
      createdAt: source.createdAt,
      updatedAt: source.updatedAt
    });
  }
  return output;
}

function materializeAssetFiles(plans, movedDirectories) {
  for (const planned of plans) {
    fs.mkdirSync(path.dirname(planned.directory), { recursive: true });
    fs.mkdirSync(planned.directory, { recursive: false });
    movedDirectories.push(planned.directory);
    for (const move of planned.fileMoves) {
      if (!fs.statSync(move.sourcePath).isFile() || fs.existsSync(move.destinationPath)) {
        throw restoreError("媒体暂存文件不可用或目标已存在。", "MEDIA_RESTORE_FILE_CONFLICT");
      }
      fs.renameSync(move.sourcePath, move.destinationPath);
    }
  }
}

function cleanupMovedDirectories(directories) {
  for (const directory of directories.slice().reverse()) {
    try { fs.rmSync(directory, { recursive: true, force: true }); } catch { /* best effort after DB rollback */ }
  }
}

function listAllAssets(store) {
  const assets = [];
  let offset = 0;
  while (true) {
    const page = store.listMediaAssets({ limit: 500, offset });
    assets.push(...page);
    if (page.length < 500) return assets;
    offset += page.length;
  }
}

function uniqueId(prefix, occupied, createId, additionalCheck = null) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const id = requireId(createId(prefix), `${prefix}.id`);
    if (!occupied.has(id) && !(typeof additionalCheck === "function" && additionalCheck.call(null, id))) return id;
  }
  throw restoreError("无法为恢复对象生成唯一 ID。", "MEDIA_RESTORE_ID_EXHAUSTED");
}

function variantFileName(kind, mimeType) {
  if (kind === "display" || kind === "thumb") return `${kind}.webp`;
  const extension = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" })[mimeType];
  if (!extension) throw restoreError("媒体格式不受支持。", "MEDIA_RESTORE_MIME_UNSUPPORTED");
  return `original.${extension}`;
}

function assertPreparedArchiveLimits(prepared) {
  const limits = MEDIA_ARCHIVE_LIMITS;
  if (prepared.collection.memories.length > limits.maxMemories) {
    throw restoreError(
      `一次最多恢复 ${limits.maxMemories} 件展品。`,
      "MEDIA_RESTORE_TOO_MANY_MEMORIES"
    );
  }
  if (prepared.assets.length > limits.maxAssets ||
      prepared.links.length > limits.maxLinks ||
      prepared.mediaObservations.length > limits.maxObservations) {
    throw restoreError("归档业务记录超过恢复上限。", "MEDIA_RESTORE_LIMIT_EXCEEDED");
  }
  if (prepared.manifest.entries.length + 1 > limits.maxEntries) {
    throw restoreError("归档条目数量超过恢复上限。", "MEDIA_RESTORE_LIMIT_EXCEEDED");
  }

  let manifestBytes;
  try {
    manifestBytes = Buffer.byteLength(`${JSON.stringify(prepared.manifest, null, 2)}\n`, "utf8");
  } catch {
    throw restoreError("归档清单无法验证。", "MEDIA_RESTORE_NOT_PREPARED");
  }
  if (manifestBytes > limits.maxEntryBytes) {
    throw restoreError("归档清单超过单项字节上限。", "MEDIA_RESTORE_LIMIT_EXCEEDED");
  }
  let totalBytes = manifestBytes;
  for (const entry of prepared.manifest.entries) {
    const bytes = entry?.bytes;
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > limits.maxEntryBytes) {
      throw restoreError("归档条目字节数超过恢复上限。", "MEDIA_RESTORE_LIMIT_EXCEEDED");
    }
    totalBytes += bytes;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > limits.maxTotalBytes) {
      throw restoreError("归档总字节数超过恢复上限。", "MEDIA_RESTORE_LIMIT_EXCEEDED");
    }
  }
}

function assertDependencies({ prepared, store, storage, normalizeMemory, createId }) {
  if (!prepared?.verified || !prepared.collection || !Array.isArray(prepared.collection.memories)
      || !Array.isArray(prepared.assets) || !Array.isArray(prepared.links)
      || !Array.isArray(prepared.mediaObservations) || !Array.isArray(prepared.files?.variants)
      || !prepared.manifest || !Array.isArray(prepared.manifest.entries)) {
    throw restoreError("归档尚未完成全量验证。", "MEDIA_RESTORE_NOT_PREPARED");
  }
  if (!store || typeof store.withTransaction !== "function" || typeof store.importMemories !== "function"
      || !storage || typeof storage.resolveStorageKey !== "function"
      || typeof normalizeMemory !== "function" || typeof createId !== "function") {
    throw new TypeError("媒体恢复依赖不完整。");
  }
}

function requireId(value, name) {
  const id = String(value || "").trim();
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(id)) throw restoreError(`${name} 无效。`, "MEDIA_RESTORE_ID_INVALID");
  return id;
}

function restoreError(message, code) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = 400;
  return error;
}

module.exports = { restorePreparedArchive };
