"use strict";

const fs = require("fs");
const path = require("path");
const { createHash, randomUUID } = require("crypto");
const { Transform } = require("stream");
const { pipeline } = require("stream/promises");
const { inspectVoice } = require("./voice-format");
const { normalizeVoicePolicy, VOICE_FORMATS } = require("./voice-policy");

const UPLOAD_ID_PATTERN = /^voice-upload-[a-f0-9-]{36}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const READY_KEY_PATTERN = /^ready\/([a-f0-9]{2})\/([a-f0-9]{64})\.(webm|m4a)$/;
const TRASH_NAME_PATTERN = /^q-(\d{10,})-([a-f0-9-]{36})-([a-f0-9]{64})\.(webm|m4a)$/;

function createVoiceStorage(options = {}) {
  const root = path.resolve(options.root || path.join(process.cwd(), "data", "voice"));
  const policy = normalizeVoicePolicy(options);
  const stagingRoot = path.join(root, ".staging");
  const readyRoot = path.join(root, "ready");
  const trashRoot = path.join(root, ".trash");
  for (const directory of [root, stagingRoot, readyRoot, trashRoot]) ensureRealDirectory(directory);

  async function beginUpload(readable, input = {}) {
    if (!readable || typeof readable.pipe !== "function") {
      throw new TypeError("readable 必须是 Node.js Readable stream。");
    }
    const uploadId = `voice-upload-${randomUUID()}`;
    const directory = safeJoin(stagingRoot, uploadId);
    const temporaryPath = path.join(directory, "source.upload");
    fs.mkdirSync(directory, { recursive: false, mode: 0o700 });
    try {
      const streamed = await streamToFile(readable, temporaryPath, policy.maxBytes);
      const bytes = await fs.promises.readFile(temporaryPath);
      const inspected = inspectVoice(bytes, {
        declaredMimeType: input.declaredMimeType,
        maxBytes: policy.maxBytes,
        maxDurationMs: policy.maxDurationMs
      });
      if (inspected.byteSize !== streamed.byteSize) corrupt("流式写入后的声音大小不一致。", "VOICE_STAGE_CORRUPT");
      const sourceFile = `source.${inspected.extension}`;
      await fs.promises.rename(temporaryPath, path.join(directory, sourceFile));
      const stage = Object.freeze({
        uploadId,
        sourceFile,
        originalName: sanitizeFileName(input.fileName, inspected.extension),
        contentSha256: streamed.sha256,
        byteSize: streamed.byteSize,
        mimeType: inspected.mimeType,
        extension: inspected.extension,
        container: inspected.container,
        codec: inspected.codec,
        durationMs: inspected.durationMs,
        createdAt: new Date().toISOString()
      });
      await writeStage(directory, stage);
      return publicStage(stage);
    } catch (error) {
      await removePath(directory);
      throw error;
    }
  }

  async function getUpload(uploadId) {
    return publicStage(await readStage(stageDirectory(uploadId), uploadId));
  }

  async function discardUpload(uploadId) {
    const directory = stageDirectory(uploadId);
    await removePath(directory);
    return true;
  }

  async function materialize(uploadId) {
    const directory = stageDirectory(uploadId);
    const stage = await readStage(directory, uploadId);
    const sourcePath = safeJoin(directory, stage.sourceFile);
    await verifyStagedFile(sourcePath, stage);
    const storageKey = readyStorageKey(stage.contentSha256, stage.extension);
    const destination = resolveStorageKey(storageKey);
    ensureRealDirectory(path.dirname(destination));

    let created = false;
    if (fs.existsSync(destination)) {
      await assertReusableReady(destination, stage);
    } else {
      try {
        await fs.promises.link(sourcePath, destination);
        created = true;
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        await assertReusableReady(destination, stage);
      }
    }
    await removePath(directory);
    return publicMaterialized(stage, storageKey, created);
  }

  async function save(readable, input = {}) {
    let stage = null;
    try {
      stage = await beginUpload(readable, input);
      return await materialize(stage.uploadId);
    } catch (error) {
      if (stage?.uploadId) await discardUpload(stage.uploadId).catch(() => {});
      throw error;
    }
  }

  function resolveStorageKey(storageKey) {
    const normalized = normalizeStorageKey(storageKey);
    const match = READY_KEY_PATTERN.exec(normalized);
    if (!match || match[1] !== match[2].slice(0, 2)) {
      throw voiceStorageError(400, "声音存储路径无效。", "VOICE_STORAGE_KEY_INVALID");
    }
    return safeJoin(root, ...normalized.split("/"));
  }

  async function stat(storageKey) {
    const normalized = normalizeStorageKey(storageKey);
    const match = READY_KEY_PATTERN.exec(normalized);
    const filePath = resolveStorageKey(normalized);
    let fileStat;
    try {
      fileStat = await fs.promises.lstat(filePath);
    } catch (error) {
      if (error?.code === "ENOENT") throw voiceStorageError(404, "声音文件不存在。", "VOICE_NOT_FOUND");
      throw error;
    }
    if (!fileStat.isFile() || fileStat.isSymbolicLink() || fileStat.size <= 0 || fileStat.size > policy.maxBytes) {
      corrupt("声音文件状态或大小无效。", "VOICE_READY_CORRUPT");
    }
    if (await hashFile(filePath) !== match[2]) {
      corrupt("声音文件未通过内容完整性校验。", "VOICE_READY_CORRUPT");
    }
    const mimeType = match[3] === "webm" ? "audio/webm" : "audio/mp4";
    return Object.freeze({
      storageKey: normalized,
      byteSize: fileStat.size,
      mimeType,
      sha256: match[2],
      etag: `"sha256-${match[2]}"`,
      lastModified: fileStat.mtime.toISOString()
    });
  }

  async function open(storageKey, options = {}) {
    const metadata = await stat(storageKey);
    const rangeRequested = options.start !== undefined || options.end !== undefined;
    if (!rangeRequested) return fs.createReadStream(resolveStorageKey(metadata.storageKey));
    const range = normalizeRange(options, metadata.byteSize);
    return fs.createReadStream(resolveStorageKey(metadata.storageKey), { start: range.start, end: range.end });
  }

  async function openRange(storageKey, rangeInput = {}) {
    const metadata = await stat(storageKey);
    const range = normalizeRange(rangeInput, metadata.byteSize);
    return Object.freeze({
      stream: fs.createReadStream(resolveStorageKey(metadata.storageKey), { start: range.start, end: range.end }),
      start: range.start,
      end: range.end,
      length: range.end - range.start + 1,
      total: metadata.byteSize,
      contentRange: `bytes ${range.start}-${range.end}/${metadata.byteSize}`
    });
  }

  async function verify(descriptor, options = {}) {
    const storageKey = typeof descriptor === "string" ? descriptor : descriptor?.storageKey;
    if (!storageKey) return false;
    try {
      options.signal?.throwIfAborted?.();
      const metadata = await stat(storageKey);
      if (descriptor && typeof descriptor === "object") {
        const expectedHash = descriptor.sha256 || descriptor.contentSha256;
        if (expectedHash && expectedHash !== metadata.sha256) return false;
        if (descriptor.byteSize !== undefined && Number(descriptor.byteSize) !== metadata.byteSize) return false;
        if (descriptor.mimeType && descriptor.mimeType !== metadata.mimeType) return false;
        const bytes = await fs.promises.readFile(resolveStorageKey(metadata.storageKey), options.signal ? { signal: options.signal } : undefined);
        const inspected = inspectVoice(bytes, {
          declaredMimeType: descriptor.mimeType,
          maxBytes: policy.maxBytes,
          maxDurationMs: policy.maxDurationMs
        });
        if (descriptor.codec && descriptor.codec !== inspected.codec) return false;
        if (descriptor.durationMs !== undefined && Number(descriptor.durationMs) !== inspected.durationMs) return false;
      }
      return metadata.sha256 === (typeof descriptor === "object" && descriptor?.contentSha256
        ? descriptor.contentSha256
        : metadata.sha256);
    } catch (error) {
      if (options.signal?.aborted || error?.name === "AbortError") throw error;
      return false;
    }
  }

  async function quarantine(storageKey) {
    const metadata = await stat(storageKey).catch((error) => {
      if (error?.code === "VOICE_NOT_FOUND") return null;
      throw error;
    });
    if (!metadata) return null;
    const extension = metadata.mimeType === "audio/webm" ? "webm" : "m4a";
    const timestamp = Date.now();
    const name = `q-${timestamp}-${randomUUID()}-${metadata.sha256}.${extension}`;
    const target = safeJoin(trashRoot, name);
    await fs.promises.rename(resolveStorageKey(metadata.storageKey), target);
    return Object.freeze({
      storageKey: metadata.storageKey,
      trashKey: `.trash/${name}`,
      sha256: metadata.sha256,
      byteSize: metadata.byteSize,
      mimeType: metadata.mimeType,
      quarantinedAt: new Date(timestamp).toISOString()
    });
  }

  async function restoreQuarantined(token) {
    const resolved = resolveQuarantineToken(token, trashRoot);
    if (!fs.existsSync(resolved.trashPath)) return null;
    const destination = resolveStorageKey(resolved.storageKey);
    if (fs.existsSync(destination)) {
      throw voiceStorageError(409, "声音文件的原位置已存在，无法回滚。", "VOICE_RESTORE_CONFLICT");
    }
    ensureRealDirectory(path.dirname(destination));
    await fs.promises.rename(resolved.trashPath, destination);
    return resolved.storageKey;
  }

  async function removeQuarantined(token) {
    const resolved = resolveQuarantineToken(token, trashRoot);
    await fs.promises.rm(resolved.trashPath, { force: true });
    return true;
  }

  async function listQuarantined(now = Date.now(), minimumAgeMs = 0) {
    const current = validTimestamp(now, "now");
    const minimum = nonNegativeInteger(minimumAgeMs, 0);
    const results = [];
    for (const entry of await fs.promises.readdir(trashRoot, { withFileTypes: true })) {
      if (!entry.isFile() || entry.isSymbolicLink()) continue;
      const parsed = parseTrashName(entry.name);
      if (!parsed || current - parsed.timestamp < minimum) continue;
      const filePath = safeJoin(trashRoot, entry.name);
      const fileStat = await fs.promises.stat(filePath);
      results.push(Object.freeze({
        storageKey: readyStorageKey(parsed.sha256, parsed.extension),
        trashKey: `.trash/${entry.name}`,
        sha256: parsed.sha256,
        byteSize: fileStat.size,
        mimeType: parsed.extension === "webm" ? "audio/webm" : "audio/mp4",
        quarantinedAt: new Date(parsed.timestamp).toISOString()
      }));
    }
    return results;
  }

  async function cleanupStaleStages(now = Date.now(), staleStageMs = policy.staleStageMs) {
    const current = validTimestamp(now, "now");
    const age = nonNegativeInteger(staleStageMs, policy.staleStageMs);
    const removed = [];
    for (const entry of await fs.promises.readdir(stagingRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || !UPLOAD_ID_PATTERN.test(entry.name)) continue;
      const directory = safeJoin(stagingRoot, entry.name);
      const directoryStat = await fs.promises.stat(directory);
      if (current - directoryStat.mtimeMs <= age) continue;
      await removePath(directory);
      removed.push(entry.name);
    }
    return removed;
  }

  async function cleanupTrash(now = Date.now(), trashGraceMs = policy.trashGraceMs) {
    const current = validTimestamp(now, "now");
    const age = nonNegativeInteger(trashGraceMs, policy.trashGraceMs);
    const removed = [];
    for (const token of await listQuarantined(current, age)) {
      await removeQuarantined(token);
      removed.push(token.storageKey);
    }
    return removed;
  }

  async function garbageCollect(options = {}) {
    const now = options.now === undefined ? Date.now() : validTimestamp(options.now, "options.now");
    const [stagingRemoved, trashRemoved] = await Promise.all([
      cleanupStaleStages(now, options.staleStageMs),
      cleanupTrash(now, options.trashGraceMs)
    ]);
    return Object.freeze({ stagingRemoved, trashRemoved });
  }

  async function verifyStagedFile(sourcePath, stage) {
    let fileStat;
    try {
      fileStat = await fs.promises.lstat(sourcePath);
    } catch (error) {
      if (error?.code === "ENOENT") corrupt("声音上传暂存文件不存在。", "VOICE_STAGE_CORRUPT");
      throw error;
    }
    if (!fileStat.isFile() || fileStat.isSymbolicLink() || fileStat.size !== stage.byteSize || fileStat.size > policy.maxBytes) {
      corrupt("声音上传暂存文件大小无效。", "VOICE_STAGE_CORRUPT");
    }
    if (await hashFile(sourcePath) !== stage.contentSha256) corrupt("声音上传暂存文件哈希不一致。", "VOICE_STAGE_CORRUPT");
    const inspected = inspectVoice(await fs.promises.readFile(sourcePath), {
      maxBytes: policy.maxBytes,
      maxDurationMs: policy.maxDurationMs
    });
    if (inspected.mimeType !== stage.mimeType || inspected.durationMs !== stage.durationMs || inspected.codec !== stage.codec) {
      corrupt("声音上传暂存元数据不一致。", "VOICE_STAGE_CORRUPT");
    }
  }

  async function assertReusableReady(filePath, stage) {
    const fileStat = await fs.promises.lstat(filePath);
    if (!fileStat.isFile() || fileStat.isSymbolicLink() || fileStat.size !== stage.byteSize) {
      corrupt("同哈希声音文件已存在但大小不一致。", "VOICE_CONTENT_CONFLICT");
    }
    if (await hashFile(filePath) !== stage.contentSha256) {
      corrupt("同哈希声音文件已损坏，拒绝复用。", "VOICE_CONTENT_CONFLICT");
    }
  }

  function stageDirectory(uploadId) {
    if (!UPLOAD_ID_PATTERN.test(String(uploadId || ""))) {
      throw voiceStorageError(400, "声音上传会话无效。", "VOICE_UPLOAD_ID_INVALID");
    }
    return safeJoin(stagingRoot, uploadId);
  }

  return Object.freeze({
    root,
    policy,
    beginUpload,
    stageUpload: beginUpload,
    getUpload,
    discardUpload,
    materialize,
    materializeUpload: materialize,
    finalizeUpload: materialize,
    save,
    resolveStorageKey,
    stat,
    open,
    openRange,
    verify,
    quarantine,
    quarantineReady: quarantine,
    restoreQuarantined,
    removeQuarantined,
    listQuarantined,
    cleanupStaleStages,
    cleanupTrash,
    garbageCollect,
    hashFile
  });
}

async function streamToFile(readable, targetPath, maxBytes) {
  let byteSize = 0;
  const hash = createHash("sha256");
  const meter = new Transform({
    transform(chunk, encoding, callback) {
      byteSize += chunk.length;
      if (byteSize > maxBytes) {
        callback(voiceStorageError(413, "声音文件超过允许大小。", "VOICE_TOO_LARGE"));
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    }
  });
  try {
    await pipeline(readable, meter, fs.createWriteStream(targetPath, { flags: "wx", mode: 0o600 }));
  } catch (error) {
    await fs.promises.rm(targetPath, { force: true }).catch(() => {});
    throw error;
  }
  if (!byteSize) {
    await fs.promises.rm(targetPath, { force: true }).catch(() => {});
    throw voiceStorageError(400, "声音文件不能为空。", "VOICE_EMPTY");
  }
  return Object.freeze({ byteSize, sha256: hash.digest("hex") });
}

async function hashFile(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function readStage(directory, expectedUploadId) {
  let stage;
  try {
    stage = JSON.parse(await fs.promises.readFile(path.join(directory, "stage.json"), "utf8"));
  } catch {
    throw voiceStorageError(404, "声音上传会话不存在或已失效。", "VOICE_UPLOAD_NOT_FOUND");
  }
  validateStage(stage, expectedUploadId);
  return stage;
}

async function writeStage(directory, stage) {
  const target = path.join(directory, "stage.json");
  const temporary = path.join(directory, `stage-${randomUUID()}.tmp`);
  await fs.promises.writeFile(temporary, JSON.stringify(stage), { flag: "wx", mode: 0o600 });
  await fs.promises.rename(temporary, target);
}

function validateStage(stage, expectedUploadId) {
  if (!stage || typeof stage !== "object" || Array.isArray(stage) || stage.uploadId !== expectedUploadId ||
      !UPLOAD_ID_PATTERN.test(stage.uploadId) || !HASH_PATTERN.test(stage.contentSha256) ||
      !Number.isSafeInteger(stage.byteSize) || stage.byteSize <= 0 ||
      !Number.isSafeInteger(stage.durationMs) || stage.durationMs <= 0 ||
      !VOICE_FORMATS[stage.mimeType] || VOICE_FORMATS[stage.mimeType].extension !== stage.extension ||
      VOICE_FORMATS[stage.mimeType].codec !== stage.codec || stage.sourceFile !== `source.${stage.extension}` ||
      typeof stage.originalName !== "string" || !stage.originalName || !validIsoDate(stage.createdAt)) {
    corrupt("声音上传会话元数据已损坏。", "VOICE_STAGE_CORRUPT");
  }
}

function publicStage(stage) {
  return Object.freeze({
    uploadId: stage.uploadId,
    originalName: stage.originalName,
    contentSha256: stage.contentSha256,
    sha256: stage.contentSha256,
    byteSize: stage.byteSize,
    mimeType: stage.mimeType,
    extension: stage.extension,
    container: stage.container,
    codec: stage.codec,
    durationMs: stage.durationMs,
    createdAt: stage.createdAt,
    readyToMaterialize: true
  });
}

function publicMaterialized(stage, storageKey, created) {
  const asset = Object.freeze({
    contentSha256: stage.contentSha256,
    originalName: stage.originalName,
    mimeType: stage.mimeType,
    codec: stage.codec,
    durationMs: stage.durationMs,
    byteSize: stage.byteSize,
    storageKey
  });
  const file = Object.freeze({
    storageKey,
    sha256: stage.contentSha256,
    byteSize: stage.byteSize,
    mimeType: stage.mimeType
  });
  return Object.freeze({ asset, file, created, reused: !created });
}

function normalizeRange(input, total) {
  const start = Number(input.start);
  const requestedEnd = input.end === undefined ? total - 1 : Number(input.end);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start < 0 || requestedEnd < start || start >= total) {
    const error = voiceStorageError(416, "声音字节范围无法满足。", "VOICE_RANGE_NOT_SATISFIABLE");
    error.totalBytes = total;
    throw error;
  }
  return { start, end: Math.min(requestedEnd, total - 1) };
}

function resolveQuarantineToken(token, trashRoot) {
  if (!token || typeof token !== "object" || Array.isArray(token)) {
    throw voiceStorageError(400, "声音隔离令牌无效。", "VOICE_TRASH_TOKEN_INVALID");
  }
  const trashKey = normalizeStorageKey(token.trashKey);
  const parts = trashKey.split("/");
  if (parts.length !== 2 || parts[0] !== ".trash") {
    throw voiceStorageError(400, "声音隔离令牌无效。", "VOICE_TRASH_TOKEN_INVALID");
  }
  const parsed = parseTrashName(parts[1]);
  if (!parsed) throw voiceStorageError(400, "声音隔离令牌无效。", "VOICE_TRASH_TOKEN_INVALID");
  const storageKey = readyStorageKey(parsed.sha256, parsed.extension);
  if (token.storageKey !== storageKey || (token.sha256 && token.sha256 !== parsed.sha256)) {
    throw voiceStorageError(400, "声音隔离令牌内容不一致。", "VOICE_TRASH_TOKEN_INVALID");
  }
  return { trashPath: safeJoin(trashRoot, parts[1]), storageKey };
}

function parseTrashName(name) {
  const match = TRASH_NAME_PATTERN.exec(String(name || ""));
  if (!match) return null;
  const timestamp = Number(match[1]);
  if (!Number.isSafeInteger(timestamp)) return null;
  return { timestamp, sha256: match[3], extension: match[4] };
}

function readyStorageKey(sha256, extension) {
  if (!HASH_PATTERN.test(String(sha256 || "")) || !["webm", "m4a"].includes(extension)) {
    throw voiceStorageError(400, "声音内容地址无效。", "VOICE_STORAGE_KEY_INVALID");
  }
  return `ready/${sha256.slice(0, 2)}/${sha256}.${extension}`;
}

function sanitizeFileName(value, extension) {
  const normalized = String(value || "").replace(/\\/g, "/").replace(/[\u0000-\u001f\u007f]/g, "");
  const base = path.posix.basename(normalized).trim().slice(0, 160);
  return base || `memory-voice.${extension}`;
}

function normalizeStorageKey(value) {
  const normalized = String(value || "").replace(/\\/g, "/");
  if (!normalized || normalized.startsWith("/") || normalized.split("/").includes("..")) {
    throw voiceStorageError(400, "声音存储路径无效。", "VOICE_STORAGE_KEY_INVALID");
  }
  return normalized;
}

function ensureRealDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw voiceStorageError(500, "声音存储目录不安全。", "VOICE_STORAGE_ROOT_INVALID");
  }
}

function safeJoin(root, ...parts) {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, ...parts);
  const relative = path.relative(resolvedRoot, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw voiceStorageError(400, "声音路径超出存储边界。", "VOICE_STORAGE_PATH_ESCAPE");
  }
  return target;
}

async function removePath(target) {
  await fs.promises.rm(target, { recursive: true, force: true });
}

function nonNegativeInteger(value, fallback) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : fallback;
}

function validTimestamp(value, name) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new TypeError(`${name} 必须是非负整数时间戳。`);
  return number;
}

function validIsoDate(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function corrupt(message, code) {
  throw voiceStorageError(409, message, code);
}

function voiceStorageError(statusCode, message, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

module.exports = {
  createVoiceStorage,
  voiceStorageError,
  hashFile
};
