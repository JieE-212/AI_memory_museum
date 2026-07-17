"use strict";

const path = require("node:path");
const { pipeline } = require("node:stream/promises");
const {
  MAX_VOICE_BYTES,
  MAX_VOICE_DURATION_MS,
  MAX_VOICES_PER_MEMORY,
  VOICE_MIME_TYPES
} = require("./voice-policy");

const MAX_LABEL_LENGTH = 120;
const MAX_TRANSCRIPT_LENGTH = 8_000;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/u;
const CONTENT_PATH = /^\/api\/voice\/assets\/([A-Za-z0-9][A-Za-z0-9_-]{0,119})\/content$/u;
const ASSET_PATH = /^\/api\/voice\/assets\/([A-Za-z0-9][A-Za-z0-9_-]{0,119})$/u;
const MEMORY_COLLECTION_PATH = /^\/api\/memories\/([A-Za-z0-9][A-Za-z0-9_-]{0,119})\/voices$/u;
const MEMORY_ITEM_PATH = /^\/api\/memories\/([A-Za-z0-9][A-Za-z0-9_-]{0,119})\/voices\/([A-Za-z0-9][A-Za-z0-9_-]{0,119})$/u;
const TRANSCRIPT_PATH = /^\/api\/memories\/([A-Za-z0-9][A-Za-z0-9_-]{0,119})\/voices\/([A-Za-z0-9][A-Za-z0-9_-]{0,119})\/transcript$/u;
const ALLOWED_AUDIO_TYPES = new Set([...VOICE_MIME_TYPES, "audio/m4a", "audio/x-m4a", "application/octet-stream"]);

function createVoiceApi(options = {}) {
  const { store, storage, sendJson, readJsonBody, httpError } = options;
  const interviewDemo = Boolean(options.interviewDemo);
  assertDependencies({ store, storage, sendJson, readJsonBody, httpError });
  const mutations = createExclusiveQueue();

  function isRawVoiceRequest(request, url) {
    return request?.method === "POST" && url?.pathname === "/api/voice/uploads";
  }

  async function handle(request, response, url) {
    if (!isVoicePath(url?.pathname)) return false;

    if (interviewDemo && isMutation(request?.method)) {
      return sendJson(response, 403, {
        error: "公开 Demo 不接收或修改私人声音；请在本地版本体验录音与转写。",
        code: "VOICE_DEMO_READ_ONLY",
        interviewDemo: true,
        blockedAction: `${request.method} ${url.pathname}`
      });
    }

    try {
      if (url.pathname === "/api/voice/uploads") {
        assertMethod(request, "POST", httpError);
        return await handleUpload(request, response, url);
      }

      let match = url.pathname.match(CONTENT_PATH);
      if (match) {
        assertMethods(request, ["GET", "HEAD"], httpError);
        assertNoQuery(url);
        return await serveContent(request, response, match[1]);
      }

      match = url.pathname.match(TRANSCRIPT_PATH);
      if (match) {
        assertMethods(request, ["PUT", "DELETE"], httpError);
        assertNoQuery(url);
        return await mutations.runExclusive(() => handleTranscript(request, response, match[1], match[2]));
      }

      match = url.pathname.match(MEMORY_COLLECTION_PATH);
      if (match) {
        assertMethods(request, ["GET", "PUT"], httpError);
        assertNoQuery(url);
        if (request.method === "GET") return await listMemoryVoices(response, match[1]);
        return await mutations.runExclusive(() => replaceMemoryVoices(request, response, match[1]));
      }

      match = url.pathname.match(MEMORY_ITEM_PATH);
      if (match) {
        assertMethod(request, "DELETE", httpError);
        assertNoQuery(url);
        return await mutations.runExclusive(() => detachMemoryVoice(response, match[1], match[2]));
      }

      match = url.pathname.match(ASSET_PATH);
      if (match) {
        assertMethod(request, "DELETE", httpError);
        assertNoQuery(url);
        return await mutations.runExclusive(() => deleteUnreferencedAsset(response, match[1]));
      }

      return false;
    } catch (error) {
      throw normalizeVoiceError(error, httpError);
    }
  }

  async function handleUpload(request, response, url) {
    assertOnlyQueryKeys(url, ["filename"]);
    const fileName = normalizeFileName(url.searchParams.get("filename"));
    const declaredMimeType = assertRawVoiceContentType(request);
    assertDeclaredLength(request, storage.policy?.maxBytes || MAX_VOICE_BYTES);

    let stage;
    try {
      stage = await storage.beginUpload(request, { fileName, declaredMimeType });
      return await mutations.runExclusive(async () => {
        let materialized;
        try {
          materialized = await storage.materialize(stage.uploadId);
          const existing = await findAssetByHash(materialized.asset.contentSha256);
          if (existing) {
            await cleanupUnexpectedDuplicateFile(materialized, existing);
            return sendJson(response, 200, { deduplicated: true, asset: publicAsset(existing) });
          }

          try {
            const created = await Promise.resolve(store.createVoiceAsset({
              ...materialized.asset,
              storageKey: materialized.file.storageKey,
              sha256: materialized.file.sha256 || materialized.asset.contentSha256,
              status: "ready"
            }));
            return sendJson(response, 201, { deduplicated: false, asset: publicAsset(created) });
          } catch (error) {
            const raced = await findAssetByHash(materialized.asset.contentSha256);
            if (raced && isDuplicateError(error)) {
              await cleanupUnexpectedDuplicateFile(materialized, raced);
              return sendJson(response, 200, { deduplicated: true, asset: publicAsset(raced) });
            }
            await cleanupUncommittedFile(materialized);
            throw error;
          }
        } finally {
          await storage.discardUpload(stage.uploadId).catch(() => {});
        }
      });
    } catch (error) {
      if (stage?.uploadId) await storage.discardUpload(stage.uploadId).catch(() => {});
      throw error;
    }
  }

  async function serveContent(request, response, assetId) {
    const asset = await requireReadyAsset(assetId);
    const storageKey = internalStorageKey(asset);
    if (!storageKey) throw voiceError(409, "VOICE_ASSET_FILE_MISSING", "这段声音的文件索引不完整。");

    const stat = await Promise.resolve(storage.stat(storageKey));
    const total = positiveInteger(stat?.byteSize, asset.byteSize);
    if (!Number.isSafeInteger(total) || total < 1) {
      throw voiceError(409, "VOICE_ASSET_FILE_INVALID", "这段声音的文件信息不完整。");
    }
    const mimeType = String(stat?.mimeType || asset.mimeType || "application/octet-stream");
    const etag = normalizeEtag(stat?.etag, stat?.sha256 || asset.sha256 || asset.contentSha256);
    setContentHeaders(response, { asset, mimeType, etag });

    const ifNoneMatch = headerValue(request, "if-none-match");
    if (ifNoneMatch && etagMatches(ifNoneMatch, etag)) {
      response.statusCode = 304;
      response.setHeader("Content-Length", "0");
      return response.end();
    }

    const rangeHeader = headerValue(request, "range");
    const ifRange = headerValue(request, "if-range");
    const useRange = Boolean(rangeHeader) && (!ifRange || etagMatches(ifRange, etag));
    if (useRange) {
      const range = parseSingleByteRange(rangeHeader, total);
      if (!range) return sendUnsatisfiedRange(response, total);
      response.statusCode = 206;
      response.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${total}`);
      response.setHeader("Content-Length", String(range.end - range.start + 1));
      if (request.method === "HEAD") return response.end();
      const opened = await Promise.resolve(storage.openRange(storageKey, range));
      const stream = opened?.stream || opened;
      if (!stream || typeof stream.pipe !== "function") {
        throw voiceError(500, "VOICE_STORAGE_STREAM_INVALID", "声音文件暂时无法读取。");
      }
      if (opened?.contentRange) response.setHeader("Content-Range", opened.contentRange);
      if (Number.isSafeInteger(opened?.length)) response.setHeader("Content-Length", String(opened.length));
      return pipeline(stream, response);
    }

    response.statusCode = 200;
    response.setHeader("Content-Length", String(total));
    if (request.method === "HEAD") return response.end();
    const stream = await Promise.resolve(storage.open(storageKey));
    if (!stream || typeof stream.pipe !== "function") {
      throw voiceError(500, "VOICE_STORAGE_STREAM_INVALID", "声音文件暂时无法读取。");
    }
    return pipeline(stream, response);
  }

  async function listMemoryVoices(response, memoryId) {
    await requireMemory(memoryId);
    const voices = await publicVoiceList(memoryId);
    return sendJson(response, 200, {
      memoryId,
      voices,
      count: voices.length,
      policy: publicPolicy(storage.policy)
    });
  }

  async function replaceMemoryVoices(request, response, memoryId) {
    await requireMemory(memoryId);
    const body = await readJsonBody(request);
    assertPlainObject(body, "语音关联请求");
    assertAllowedKeys(body, ["items"], "语音关联请求");
    if (!Array.isArray(body.items)) throw voiceError(400, "VOICE_ITEMS_INVALID", "items 必须是声音关联数组。");
    if (body.items.length > MAX_VOICES_PER_MEMORY) {
      throw voiceError(400, "VOICE_MEMORY_LIMIT", `每件展品最多保存 ${MAX_VOICES_PER_MEMORY} 段声音。`);
    }
    const items = normalizeVoiceItems(body.items);
    await Promise.resolve(store.replaceMemoryVoice(memoryId, items));
    const voices = await publicVoiceList(memoryId);
    return sendJson(response, 200, { ok: true, memoryId, voices, count: voices.length });
  }

  async function detachMemoryVoice(response, memoryId, assetId) {
    await requireMemory(memoryId);
    const removed = await Promise.resolve(store.detachVoice(memoryId, assetId));
    if (!removed) throw voiceError(404, "VOICE_LINK_NOT_FOUND", "这段声音没有关联到当前展品。");
    const voices = await publicVoiceList(memoryId);
    return sendJson(response, 200, { ok: true, memoryId, assetId, voices, count: voices.length });
  }

  async function handleTranscript(request, response, memoryId, assetId) {
    await requireMemory(memoryId);
    await requireLinkedVoice(memoryId, assetId);

    if (request.method === "PUT") {
      const body = await readJsonBody(request);
      assertPlainObject(body, "转写请求");
      assertAllowedKeys(body, ["text", "confirm"], "转写请求");
      const confirmed = normalizeConfirmation(body);
      const text = normalizeTranscriptText(body.text);
      const transcript = await Promise.resolve(store.upsertVoiceTranscript({
        memoryId,
        assetId,
        text,
        confirmed,
        source: "manual"
      }));
      return sendJson(response, transcript?.created === true ? 201 : 200, {
        ok: true,
        memoryId,
        assetId,
        transcript: publicTranscript(transcript)
      });
    }

    const removed = await Promise.resolve(store.deleteVoiceTranscript(memoryId, assetId));
    if (!removed) throw voiceError(404, "VOICE_TRANSCRIPT_NOT_FOUND", "这段声音还没有可删除的已确认转写。");
    return sendJson(response, 200, { ok: true, memoryId, assetId, transcript: null });
  }

  async function deleteUnreferencedAsset(response, assetId) {
    const removed = await removeAssetIfUnreferencedUnlocked(assetId, true);
    if (!removed) throw voiceError(404, "VOICE_ASSET_NOT_FOUND", "没有找到这段声音。");
    return sendJson(response, 200, { ok: true, assetId, cleanupPending: removed.cleanupPending });
  }

  async function removeAssetIfUnreferencedUnlocked(assetId, explicit = false) {
    const asset = await Promise.resolve(store.getVoiceAsset(assetId));
    if (!asset) return null;
    if (!explicit && asset.status && asset.status !== "ready" && asset.status !== "pending_delete") return null;
    const storageKey = internalStorageKey(asset);
    if (!storageKey) throw voiceError(409, "VOICE_ASSET_FILE_MISSING", "这段声音的文件索引不完整。");

    const quarantineToken = await Promise.resolve(storage.quarantine(storageKey));
    try {
      const removed = await Promise.resolve(store.deleteVoiceAsset(assetId));
      if (!removed) throw voiceError(404, "VOICE_ASSET_NOT_FOUND", "没有找到这段声音。");
    } catch (error) {
      try {
        await Promise.resolve(storage.restoreQuarantined(quarantineToken));
      } catch (rollbackError) {
        error.rollbackError = rollbackError;
      }
      throw error;
    }

    let cleanupPending = false;
    try {
      await Promise.resolve(storage.removeQuarantined(quarantineToken));
    } catch {
      cleanupPending = true;
    }
    return { asset, cleanupPending };
  }

  async function garbageCollect(options = {}) {
    return mutations.runExclusive(() => garbageCollectUnlocked(options));
  }

  async function reconcileQuarantine(options = {}) {
    return mutations.runExclusive(async () => {
      if (typeof storage.listQuarantined !== "function") return { restored: [], removed: [], pending: [] };
      const entries = await Promise.resolve(storage.listQuarantined(options.now, options.minimumAgeMs));
      const result = { restored: [], removed: [], pending: [] };
      for (const entry of Array.isArray(entries) ? entries : []) {
        const token = entry?.token || entry;
        const asset = entry?.sha256 && typeof store.getVoiceAssetByHash === "function"
          ? await Promise.resolve(store.getVoiceAssetByHash(entry.sha256))
          : null;
        try {
          if (asset && internalStorageKey(asset) === String(entry.storageKey || "")) {
            await Promise.resolve(storage.restoreQuarantined(token));
            if (asset.status === "pending_delete" && typeof store.markVoiceReady === "function") {
              await Promise.resolve(store.markVoiceReady(asset.id));
            }
            result.restored.push(asset.id);
          } else {
            await Promise.resolve(storage.removeQuarantined(token));
            result.removed.push(String(asset?.id || entry?.storageKey || ""));
          }
        } catch {
          result.pending.push(String(asset?.id || entry?.storageKey || ""));
        }
      }
      return result;
    });
  }

  async function garbageCollectUnlocked(options = {}) {
    const filters = {
      status: String(options.status || "ready"),
      limit: clampInteger(options.limit, 1, 500, 100)
    };
    if (options.before) filters.before = String(options.before);
    let candidates;
    if (typeof store.listUnreferencedVoiceAssets === "function") {
      candidates = await Promise.resolve(store.listUnreferencedVoiceAssets(filters));
    } else {
      const listed = await Promise.resolve(store.listVoiceAssets(filters));
      candidates = (Array.isArray(listed) ? listed : []).filter((asset) => (
        Number(asset?.referenceCount ?? asset?.memoryCount ?? -1) === 0
      ));
    }
    const removed = [];
    const pending = [];
    for (const asset of (Array.isArray(candidates) ? candidates : []).slice(0, filters.limit)) {
      try {
        const result = await removeAssetIfUnreferencedUnlocked(String(asset?.id || ""), true);
        if (result) {
          removed.push(asset.id);
          if (result.cleanupPending) pending.push(asset.id);
        }
      } catch (error) {
        if (!isInUseError(error)) throw error;
      }
    }
    return { removed, pending };
  }

  async function listAllAssets() {
    const assets = [];
    let offset = 0;
    while (true) {
      const page = await Promise.resolve(store.listVoiceAssets({ limit: 500, offset }));
      const normalized = Array.isArray(page) ? page : [];
      assets.push(...normalized);
      if (normalized.length < 500) break;
      offset += normalized.length;
    }
    return assets;
  }

  async function quarantineStoredFiles(assets = []) {
    return mutations.runExclusive(() => quarantineStoredFilesUnlocked(assets));
  }

  async function quarantineStoredFilesUnlocked(assets = []) {
    const entries = [];
    const seen = new Set();
    try {
      for (const asset of Array.isArray(assets) ? assets : []) {
        const storageKey = internalStorageKey(asset);
        if (!storageKey || seen.has(storageKey)) continue;
        seen.add(storageKey);
        const token = await Promise.resolve(storage.quarantine(storageKey));
        entries.push({ asset, storageKey, token });
      }
      return entries;
    } catch (error) {
      try {
        await restoreStoredFilesUnlocked(entries);
      } catch (rollbackError) {
        error.rollbackError = rollbackError;
      }
      throw error;
    }
  }

  async function restoreStoredFiles(entries = []) {
    return mutations.runExclusive(() => restoreStoredFilesUnlocked(entries));
  }

  async function restoreStoredFilesUnlocked(entries = []) {
    const failures = [];
    for (const entry of [...(Array.isArray(entries) ? entries : [])].reverse()) {
      if (!entry?.token) continue;
      try {
        await Promise.resolve(storage.restoreQuarantined(entry.token));
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length) throw new AggregateError(failures, "部分声音文件未能从隔离区恢复。");
  }

  async function removeQuarantinedFiles(entries = []) {
    return mutations.runExclusive(() => removeQuarantinedFilesUnlocked(entries));
  }

  async function removeQuarantinedFilesUnlocked(entries = []) {
    const removed = [];
    const pending = [];
    for (const entry of Array.isArray(entries) ? entries : []) {
      if (!entry?.token) continue;
      try {
        await Promise.resolve(storage.removeQuarantined(entry.token));
        removed.push(String(entry.asset?.id || entry.storageKey || ""));
      } catch {
        pending.push(String(entry.asset?.id || entry.storageKey || ""));
      }
    }
    return { removed: removed.filter(Boolean), pending: pending.filter(Boolean) };
  }

  async function removeStoredFiles(assets = []) {
    return mutations.runExclusive(async () => {
      const entries = await quarantineStoredFilesUnlocked(assets);
      return removeQuarantinedFilesUnlocked(entries);
    });
  }

  // Coordinated callers must use direct store/storage work inside this callback to avoid re-entering the same lock.
  function withVoiceOperation(operation) {
    return mutations.runExclusive(operation);
  }

  async function purgeAll(purgeRecords) {
    if (typeof purgeRecords !== "function") throw new TypeError("purgeRecords must be a function.");
    return mutations.runExclusive(async () => {
      const entries = await quarantineStoredFilesUnlocked(await listAllAssets());
      let purge;
      try {
        purge = await purgeRecords();
      } catch (error) {
        try {
          await restoreStoredFilesUnlocked(entries);
        } catch (rollbackError) {
          error.rollbackError = rollbackError;
        }
        throw error;
      }
      const cleanup = await removeQuarantinedFilesUnlocked(entries);
      return { purge, cleanup };
    });
  }

  async function requireReadyAsset(assetId) {
    const asset = await Promise.resolve(store.getVoiceAsset(assetId));
    if (!asset) throw voiceError(404, "VOICE_ASSET_NOT_FOUND", "没有找到这段声音。");
    if (asset.status && asset.status !== "ready") {
      throw voiceError(409, "VOICE_ASSET_NOT_READY", "这段声音尚未准备完成。");
    }
    return asset;
  }

  async function requireMemory(memoryId) {
    if (typeof store.getMemory !== "function") return;
    const memory = await Promise.resolve(store.getMemory(memoryId));
    if (!memory) throw voiceError(404, "VOICE_MEMORY_NOT_FOUND", "没有找到这件展品。");
  }

  async function requireLinkedVoice(memoryId, assetId) {
    const voices = await Promise.resolve(store.listVoiceForMemory(memoryId));
    if ((Array.isArray(voices) ? voices : []).some((item) => voiceAssetId(item) === assetId)) return;
    throw voiceError(404, "VOICE_LINK_NOT_FOUND", "这段声音没有关联到当前展品。");
  }

  async function publicVoiceList(memoryId) {
    const source = await Promise.resolve(store.listVoiceForMemory(memoryId));
    return Promise.all((Array.isArray(source) ? source : []).slice(0, MAX_VOICES_PER_MEMORY).map(async (item, index) => {
      const assetId = voiceAssetId(item);
      const asset = item?.asset || (assetId ? await Promise.resolve(store.getVoiceAsset(assetId)) : null);
      let transcript = item?.transcript || null;
      if (!transcript && typeof store.getVoiceTranscript === "function" && assetId) {
        transcript = await Promise.resolve(store.getVoiceTranscript(memoryId, assetId));
      }
      return {
        assetId,
        position: Number.isSafeInteger(item?.position) ? item.position : index,
        label: String(item?.label || ""),
        asset: publicAsset(asset || { id: assetId }),
        transcript: transcript ? publicTranscript(transcript) : null
      };
    }));
  }

  async function findAssetByHash(hash) {
    if (typeof store.getVoiceAssetByHash === "function") {
      return Promise.resolve(store.getVoiceAssetByHash(hash));
    }
    const assets = await Promise.resolve(store.listVoiceAssets({ status: "ready", limit: 1000 }));
    return (Array.isArray(assets) ? assets : []).find((asset) => asset?.contentSha256 === hash || asset?.sha256 === hash) || null;
  }

  async function cleanupUnexpectedDuplicateFile(materialized, existing) {
    if (!materialized?.created || !materialized?.file?.storageKey) return;
    if (materialized.file.storageKey === internalStorageKey(existing)) return;
    await cleanupUncommittedFile(materialized);
  }

  async function cleanupUncommittedFile(materialized) {
    if (!materialized?.created || !materialized?.file?.storageKey) return;
    const token = await Promise.resolve(storage.quarantine(materialized.file.storageKey)).catch(() => null);
    if (token) await Promise.resolve(storage.removeQuarantined(token)).catch(() => {});
  }

  return Object.freeze({
    handle,
    isRawVoiceRequest,
    publicAsset,
    publicVoiceList,
    policy: publicPolicy(storage.policy),
    withVoiceOperation,
    reconcileQuarantine,
    garbageCollect,
    purgeAll,
    listAllAssets,
    quarantineStoredFiles,
    restoreStoredFiles,
    removeQuarantinedFiles,
    removeStoredFiles
  });
}

function isVoicePath(pathname) {
  return pathname === "/api/voice/uploads" || CONTENT_PATH.test(pathname) || ASSET_PATH.test(pathname) ||
    MEMORY_COLLECTION_PATH.test(pathname) || MEMORY_ITEM_PATH.test(pathname) || TRANSCRIPT_PATH.test(pathname);
}

function isMutation(method) {
  return ["POST", "PUT", "DELETE"].includes(method);
}

function assertRawVoiceContentType(request) {
  const mimeType = headerValue(request, "content-type").split(";", 1)[0].trim().toLowerCase();
  if (!ALLOWED_AUDIO_TYPES.has(mimeType)) {
    throw voiceError(415, "VOICE_MIME_UNSUPPORTED", "只支持 WebM/Opus 或 MP4/AAC 声音。");
  }
  return mimeType;
}

function assertDeclaredLength(request, maximum) {
  const raw = headerValue(request, "content-length");
  if (!raw) return;
  if (!/^\d+$/u.test(raw)) throw voiceError(400, "VOICE_CONTENT_LENGTH_INVALID", "Content-Length 无效。");
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) throw voiceError(400, "VOICE_CONTENT_LENGTH_INVALID", "声音文件不能为空。");
  if (value > maximum) throw voiceError(413, "VOICE_TOO_LARGE", `单段声音不能超过 ${formatMiB(maximum)} MiB。`);
}

function normalizeFileName(value) {
  const source = String(value ?? "").trim();
  if (!source) throw voiceError(400, "VOICE_FILENAME_REQUIRED", "请提供声音文件名。");
  if ([...source].length > 160 || /[\u0000-\u001f\u007f]/u.test(source)) {
    throw voiceError(400, "VOICE_FILENAME_INVALID", "声音文件名无效或过长。");
  }
  const fileName = path.win32.basename(source).trim();
  if (!fileName || fileName === "." || fileName === "..") {
    throw voiceError(400, "VOICE_FILENAME_INVALID", "声音文件名无效。");
  }
  return fileName;
}

function normalizeVoiceItems(items) {
  const seen = new Set();
  return items.map((item, index) => {
    assertPlainObject(item, `items[${index}]`);
    assertAllowedKeys(item, ["assetId", "label"], `items[${index}]`);
    const assetId = String(item.assetId ?? "").trim();
    if (!ID_PATTERN.test(assetId)) throw voiceError(400, "VOICE_ASSET_ID_INVALID", `items[${index}].assetId 无效。`);
    if (seen.has(assetId)) throw voiceError(400, "VOICE_ASSET_DUPLICATE", `items[${index}] 重复引用了同一段声音。`);
    seen.add(assetId);
    const label = optionalSingleLine(item.label, MAX_LABEL_LENGTH, `items[${index}].label`);
    return { assetId, label };
  });
}

function normalizeTranscriptText(value) {
  if (typeof value !== "string") throw voiceError(400, "VOICE_TRANSCRIPT_INVALID", "text 必须是转写文字。");
  const text = value.replace(/\r\n?/gu, "\n").trim();
  if (!text) throw voiceError(400, "VOICE_TRANSCRIPT_REQUIRED", "请先核对并填写转写文字。");
  if ([...text].length > MAX_TRANSCRIPT_LENGTH) {
    throw voiceError(400, "VOICE_TRANSCRIPT_TOO_LONG", `转写文字不能超过 ${MAX_TRANSCRIPT_LENGTH} 个字符。`);
  }
  return text;
}

function optionalSingleLine(value, maximum, label) {
  if (value === undefined) return "";
  if (typeof value !== "string") throw voiceError(400, "VOICE_LABEL_INVALID", `${label} 必须是文字。`);
  const text = value.replace(/\s+/gu, " ").trim();
  if ([...text].length > maximum) throw voiceError(400, "VOICE_LABEL_TOO_LONG", `${label} 不能超过 ${maximum} 个字符。`);
  return text;
}

function normalizeConfirmation(body) {
  if (!Object.prototype.hasOwnProperty.call(body, "confirm")) {
    throw voiceError(400, "VOICE_CONFIRM_REQUIRED", "confirm 必须明确设为 true 或 false。");
  }
  if (typeof body.confirm !== "boolean") {
    throw voiceError(400, "VOICE_CONFIRM_INVALID", "confirm 必须是布尔值。");
  }
  return body.confirm;
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw voiceError(400, "VOICE_BODY_INVALID", `${label}必须是 JSON 对象。`);
  }
}

function assertAllowedKeys(value, allowed, label) {
  const allow = new Set(allowed);
  const unknown = Object.keys(value).filter((key) => !allow.has(key));
  if (unknown.length) throw voiceError(400, "VOICE_UNKNOWN_FIELD", `${label}包含未知字段：${unknown.join("、")}。`);
}

function assertNoQuery(url) {
  assertOnlyQueryKeys(url, []);
}

function assertOnlyQueryKeys(url, allowed) {
  const allow = new Set(allowed);
  const unknown = [...new Set([...url.searchParams.keys()].filter((key) => !allow.has(key)))];
  if (unknown.length) throw voiceError(400, "VOICE_UNKNOWN_QUERY", `请求包含未知查询参数：${unknown.join("、")}。`);
  for (const key of allow) {
    if (url.searchParams.getAll(key).length > 1) throw voiceError(400, "VOICE_QUERY_DUPLICATE", `查询参数 ${key} 不能重复。`);
  }
}

function parseSingleByteRange(value, total) {
  const source = String(value || "").trim();
  if (source.includes(",")) return null;
  const match = source.match(/^bytes=(\d*)-(\d*)$/u);
  if (!match || (!match[1] && !match[2])) return null;

  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength < 1) return null;
    return { start: Math.max(0, total - suffixLength), end: total - 1 };
  }

  const start = Number(match[1]);
  if (!Number.isSafeInteger(start) || start < 0 || start >= total) return null;
  const requestedEnd = match[2] ? Number(match[2]) : total - 1;
  if (!Number.isSafeInteger(requestedEnd) || requestedEnd < start) return null;
  return { start, end: Math.min(requestedEnd, total - 1) };
}

function sendUnsatisfiedRange(response, total) {
  response.statusCode = 416;
  response.setHeader("Content-Range", `bytes */${total}`);
  response.setHeader("Content-Length", "0");
  return response.end();
}

function setContentHeaders(response, { asset, mimeType, etag }) {
  response.setHeader("Content-Type", mimeType);
  response.setHeader("ETag", etag);
  response.setHeader("Accept-Ranges", "bytes");
  response.setHeader("Cache-Control", "private, no-store");
  const fallbackExtension = mimeType === "audio/webm" ? "webm" : "m4a";
  const fileName = path.win32.basename(String(asset.originalName || `memory-voice.${fallbackExtension}`));
  response.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`);
}

function normalizeEtag(value, hash) {
  const source = String(value || "").trim();
  if (/^(?:W\/)?"[^"\r\n]+"$/u.test(source)) return source;
  const token = String(source || (hash ? `sha256-${hash}` : "voice-asset")).replace(/[^A-Za-z0-9._:-]/gu, "");
  return `"${token || "voice-asset"}"`;
}

function etagMatches(header, etag) {
  return String(header || "").split(",").map((item) => item.trim()).some((item) => item === "*" || item === etag);
}

function headerValue(request, name) {
  const headers = request?.headers;
  if (!headers) return "";
  if (typeof headers.get === "function") return String(headers.get(name) || "");
  const direct = headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()];
  return Array.isArray(direct) ? direct.join(",") : String(direct || "");
}

function internalStorageKey(asset) {
  return String(asset?.storageKey || asset?.file?.storageKey || "");
}

function voiceAssetId(item) {
  return String(item?.assetId || item?.asset?.id || item?.id || "");
}

function publicAsset(value) {
  const asset = value && typeof value === "object" ? value : {};
  const id = String(asset.id || asset.assetId || "");
  return {
    id,
    originalName: String(asset.originalName || asset.fileName || "memory-voice"),
    mimeType: String(asset.mimeType || ""),
    codec: String(asset.codec || ""),
    durationMs: finiteNumber(asset.durationMs),
    byteSize: finiteNumber(asset.byteSize),
    status: String(asset.status || "ready"),
    createdAt: String(asset.createdAt || ""),
    contentUrl: id ? `/api/voice/assets/${encodeURIComponent(id)}/content` : ""
  };
}

function publicTranscript(value) {
  const transcript = value && typeof value === "object" ? value : {};
  return {
    text: String(transcript.text || ""),
    confirmed: transcript.confirmed === true || transcript.status === "confirmed",
    source: String(transcript.source || "manual"),
    createdAt: String(transcript.createdAt || ""),
    updatedAt: String(transcript.updatedAt || transcript.createdAt || "")
  };
}

function publicPolicy(value = {}) {
  return Object.freeze({
    maxBytes: positiveInteger(value.maxBytes, MAX_VOICE_BYTES),
    maxDurationMs: positiveInteger(value.maxDurationMs, MAX_VOICE_DURATION_MS),
    maxVoicesPerMemory: MAX_VOICES_PER_MEMORY,
    acceptedMimeTypes: [...ALLOWED_AUDIO_TYPES]
  });
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function formatMiB(bytes) {
  return Math.round((Number(bytes) / (1024 * 1024)) * 10) / 10;
}

function assertMethod(request, expected, httpError) {
  assertMethods(request, [expected], httpError);
}

function assertMethods(request, expected, httpError) {
  if (expected.includes(request?.method)) return;
  const error = httpError(405, `该声音接口只支持 ${expected.join(" 或 ")}。`);
  error.code = "VOICE_METHOD_NOT_ALLOWED";
  error.allow = expected.join(", ");
  throw error;
}

function isDuplicateError(error) {
  return /(?:HASH_)?EXISTS|DUPLICATE/u.test(String(error?.code || ""));
}

function isInUseError(error) {
  return /IN_USE|REFERENCED/u.test(String(error?.code || ""));
}

function clampInteger(value, minimum, maximum, fallback) {
  const number = Number(value);
  return Number.isSafeInteger(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
}

function voiceError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function normalizeVoiceError(error, httpError) {
  if (!error) return error;
  const code = String(error.code || "");
  let status = Number(error.statusCode) || 0;
  if (!status && code.startsWith("VOICE_")) {
    if (/NOT_FOUND|FILE_MISSING/u.test(code)) status = 404;
    else if (/TOO_LARGE/u.test(code)) status = 413;
    else if (/MIME|FORMAT|CODEC|UNSUPPORTED/u.test(code)) status = 415;
    else if (/RANGE/u.test(code)) status = 416;
    else if (/IN_USE|EXISTS|CONFLICT|NOT_READY/u.test(code)) status = 409;
    else status = 400;
  }
  if (!status && (error instanceof TypeError || error instanceof RangeError)) status = 400;
  if (!status) return error;
  if (error.statusCode === status && (!code || code.startsWith("VOICE_"))) return error;
  const wrapped = httpError(status, error.message || "声音请求无效。");
  if (code) wrapped.code = code;
  if (error.interviewDemo) wrapped.interviewDemo = true;
  if (error.allow) wrapped.allow = error.allow;
  if (error.rollbackError) wrapped.rollbackError = error.rollbackError;
  return wrapped;
}

function createExclusiveQueue() {
  let tail = Promise.resolve();
  return Object.freeze({
    runExclusive(operation) {
      if (typeof operation !== "function") throw new TypeError("Voice operation must be a function.");
      const result = tail.then(() => operation());
      tail = result.then(() => undefined, () => undefined);
      return result;
    }
  });
}

function assertDependencies({ store, storage, sendJson, readJsonBody, httpError }) {
  const storeMethods = [
    "createVoiceAsset", "getVoiceAsset", "listVoiceAssets", "listVoiceForMemory", "replaceMemoryVoice",
    "detachVoice", "deleteVoiceAsset", "upsertVoiceTranscript", "deleteVoiceTranscript"
  ];
  const storageMethods = [
    "beginUpload", "materialize", "getUpload", "discardUpload", "stat", "open", "openRange",
    "quarantine", "restoreQuarantined", "removeQuarantined"
  ];
  if (!store || storeMethods.some((name) => typeof store[name] !== "function") ||
      !storage || storageMethods.some((name) => typeof storage[name] !== "function") ||
      typeof sendJson !== "function" || typeof readJsonBody !== "function" || typeof httpError !== "function") {
    throw new TypeError("createVoiceApi 依赖不完整。");
  }
}

module.exports = {
  MAX_VOICE_BYTES,
  MAX_VOICE_DURATION_MS,
  MAX_VOICES_PER_MEMORY,
  createVoiceApi,
  parseSingleByteRange,
  publicAsset,
  publicTranscript
};
