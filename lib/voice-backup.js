"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { inspectVoice } = require("./voice-format");
const { MAX_VOICE_BYTES, MAX_VOICE_DURATION_MS } = require("./voice-policy");

const VOICE_SCHEMA_VERSION = 8;
const VOICE_SECTION_VERSION = 1;
const VOICE_SECTION_PATH = "voices/state.json";
const VOICE_ARCHIVE_PREFIX = "voices/";
const VOICE_ASSET_PREFIX = "voices/assets/";
const VOICE_REDACTED_NOTE = "声音文件、文件名、哈希、路径、展品 ID、转写文字与精确时间已从脱敏备份中移除。";
const VOICE_MIME_TYPES = new Set(["audio/webm", "audio/mp4"]);
const ID_PATTERN = /^[a-zA-Z0-9_-]{1,120}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const FULL_STATE_KEYS = Object.freeze(["assets", "memoryLinks", "mode", "schemaVersion", "transcripts"]);
const REDACTED_STATE_KEYS = Object.freeze([
  "assetCount",
  "confirmedTranscriptCount",
  "memoryLinkCount",
  "mode",
  "note",
  "totalDurationMs",
  "transcriptCount"
]);

function buildVoiceArchiveSection({ collection, mode, schemaVersion, voiceStorage, validateVoiceBackup } = {}) {
  const active = schemaVersion >= VOICE_SCHEMA_VERSION;
  const present = Boolean(collection && Object.hasOwn(collection, "voices"));
  if (mode === "full" && active && !present) {
    fail(`完整 schema ${schemaVersion} 归档缺少必需的 voices 数据。`, "MEDIA_ARCHIVE_REQUIRED_SECTION_MISSING");
  }
  if (!present) return null;
  if (!active) {
    fail(`voices 数据不能由 schema ${schemaVersion} 归档声明。`, "MEDIA_ARCHIVE_FEATURE_SCHEMA_INVALID");
  }

  const state = collection.voices;
  delete collection.voices;
  validateVoiceState(state, collection.memories, validateVoiceBackup, mode);
  const count = state.mode === "full" ? state.assets.length : state.assetCount;
  const section = {
    name: "voices",
    path: VOICE_SECTION_PATH,
    count,
    required: mode === "full",
    version: VOICE_SECTION_VERSION,
    state,
    audioEntries: [],
    totalBytes: 0
  };

  if (mode === "redacted") return section;
  requireVoiceStorage(voiceStorage);
  section.audioEntries = state.assets.map((asset) => readVoiceAssetForArchive(asset, voiceStorage));
  section.totalBytes = section.audioEntries.reduce((sum, entry) => safeAdd(sum, entry.data.length), 0);
  return section;
}

function buildVoiceManifest(section) {
  if (!section) return null;
  return {
    included: section.state.mode === "full",
    statePath: VOICE_SECTION_PATH,
    assetCount: section.count,
    totalBytes: section.totalBytes,
    audio: section.audioEntries.map((entry) => ({
      assetId: entry.assetId,
      path: entry.path,
      bytes: entry.data.length,
      sha256: sha256(entry.data),
      mime: entry.mime,
      codec: entry.codec,
      durationMs: entry.durationMs
    }))
  };
}

function readVoiceArchiveSection({ manifest, verifiedByPath, collection, validateVoiceBackup } = {}) {
  const active = Number(manifest?.schemaVersion) >= VOICE_SCHEMA_VERSION;
  if (manifest?.formatVersion === 1) {
    if (active && manifest.mode === "full") {
      fail("schema 8 完整归档必须使用独立 voices/state.json section。", "MEDIA_ARCHIVE_REQUIRED_SECTION_MISSING");
    }
    if (Object.hasOwn(collection || {}, "voices")) {
      fail("旧版归档不能内联 voices 数据。", "MEDIA_ARCHIVE_FEATURE_SCHEMA_INVALID");
    }
    return null;
  }

  const section = Array.isArray(manifest?.sections)
    ? manifest.sections.find((item) => item?.name === "voices")
    : null;
  const required = active && manifest.mode === "full";
  if (required && !section) {
    fail(`完整 schema ${manifest.schemaVersion} 归档缺少必需的 voices section。`, "MEDIA_ARCHIVE_REQUIRED_SECTION_MISSING");
  }
  if (!section) {
    if (manifest?.voices !== undefined) fail("manifest.voices 缺少对应 section。", "MEDIA_ARCHIVE_SECTIONS_INVALID");
    return null;
  }
  if (!active) fail("voices section 与 manifest schema 不一致。", "MEDIA_ARCHIVE_FEATURE_SCHEMA_INVALID");
  if (Object.hasOwn(collection, "voices")) {
    fail("voices 不能同时出现在 collection 与独立 section。", "MEDIA_ARCHIVE_SECTIONS_INVALID");
  }
  if (section.path !== VOICE_SECTION_PATH || section.version !== VOICE_SECTION_VERSION || section.required !== required) {
    fail("voices section 声明无效。", "MEDIA_ARCHIVE_SECTIONS_INVALID");
  }
  const stateEntry = verifiedByPath.get(VOICE_SECTION_PATH);
  if (!stateEntry || stateEntry.mime !== "application/json") {
    fail("voices section 缺少有效 JSON 入口。", "MEDIA_ARCHIVE_ENTRY_MISSING");
  }
  const state = readJson(stateEntry.filePath);
  validateVoiceState(state, collection.memories, validateVoiceBackup, manifest.mode);
  const count = state.mode === "full" ? state.assets.length : state.assetCount;
  if (section.count !== count) fail("voices section 计数与状态不一致。", "MEDIA_ARCHIVE_SECTIONS_INVALID");

  const voiceManifest = validateVoiceManifest(manifest.voices, state, verifiedByPath);
  collection.voices = state;
  return {
    state,
    count,
    paths: new Set([VOICE_SECTION_PATH, ...voiceManifest.audio.map((item) => item.path)]),
    files: voiceManifest.audio.map((item) => ({
      assetId: item.assetId,
      archivePath: item.path,
      filePath: verifiedByPath.get(item.path).filePath,
      byteSize: item.bytes,
      sha256: item.sha256,
      mimeType: item.mime,
      codec: item.codec,
      durationMs: item.durationMs
    }))
  };
}

function validateVoiceSectionDeclaration(manifest, sectionsByName, entriesByPath) {
  const section = sectionsByName.get("voices");
  const active = Number(manifest.schemaVersion) >= VOICE_SCHEMA_VERSION;
  const required = manifest.mode === "full" && active;
  if (required && !section) {
    fail(`完整 schema ${manifest.schemaVersion} 归档缺少必需的 voices section。`, "MEDIA_ARCHIVE_REQUIRED_SECTION_MISSING");
  }
  if (!section) {
    if (manifest.voices !== undefined) fail("manifest.voices 缺少对应 section。", "MEDIA_ARCHIVE_SECTIONS_INVALID");
    return;
  }
  if (!active) fail("voices section 与 manifest schema 不一致。", "MEDIA_ARCHIVE_FEATURE_SCHEMA_INVALID");
  if (section.path !== VOICE_SECTION_PATH || section.version !== VOICE_SECTION_VERSION || section.required !== required) {
    fail("voices section 声明无效。", "MEDIA_ARCHIVE_SECTIONS_INVALID");
  }
  const entry = entriesByPath.get(VOICE_SECTION_PATH);
  if (!entry || entry.mime !== "application/json") {
    fail("voices section 缺少有效 JSON 入口。", "MEDIA_ARCHIVE_ENTRY_MISSING");
  }
}

function validateVoiceManifest(input, state, verifiedByPath) {
  assertPlainObject(input, "manifest.voices");
  assertExactKeys(input, ["assetCount", "audio", "included", "statePath", "totalBytes"], "manifest.voices");
  if (input.statePath !== VOICE_SECTION_PATH || !Number.isSafeInteger(input.assetCount) || input.assetCount < 0 ||
      !Number.isSafeInteger(input.totalBytes) || input.totalBytes < 0 || !Array.isArray(input.audio)) {
    fail("manifest.voices 声明无效。", "MEDIA_ARCHIVE_MANIFEST_INVALID");
  }
  const full = state.mode === "full";
  const count = full ? state.assets.length : state.assetCount;
  if (input.included !== full || input.assetCount !== count) {
    fail("manifest.voices 模式或计数与状态不一致。", "MEDIA_ARCHIVE_MANIFEST_INVALID");
  }
  if (!full) {
    if (input.totalBytes !== 0 || input.audio.length !== 0) {
      fail("脱敏声音归档不能包含音频清单。", "MEDIA_ARCHIVE_REDACTED_VOICE_FORBIDDEN");
    }
    return input;
  }
  if (input.audio.length !== state.assets.length) {
    fail("声音音频清单数量与状态不一致。", "MEDIA_ARCHIVE_MANIFEST_INVALID");
  }

  const assetsById = new Map(state.assets.map((asset) => [asset.id, asset]));
  const seenIds = new Set();
  const seenPaths = new Set();
  let totalBytes = 0;
  for (let index = 0; index < input.audio.length; index += 1) {
    const item = input.audio[index];
    assertPlainObject(item, `manifest.voices.audio[${index}]`);
    assertExactKeys(item, ["assetId", "bytes", "codec", "durationMs", "mime", "path", "sha256"], `manifest.voices.audio[${index}]`);
    const assetId = requireId(item.assetId, `manifest.voices.audio[${index}].assetId`);
    const asset = assetsById.get(assetId);
    if (!asset || seenIds.has(assetId)) fail("声音音频清单包含缺失或重复资产。", "MEDIA_ARCHIVE_REFERENCE_INVALID");
    seenIds.add(assetId);
    const expectedPath = voiceArchivePath(asset);
    if (item.path !== expectedPath || seenPaths.has(item.path)) {
      fail("声音音频清单路径无效或重复。", "MEDIA_ARCHIVE_PATH_INVALID");
    }
    seenPaths.add(item.path);
    const verified = verifiedByPath.get(item.path);
    if (!verified || !verified.voice) fail("声音音频条目缺失或尚未验真。", "MEDIA_ARCHIVE_ENTRY_MISSING");
    if (item.bytes !== asset.byteSize || item.bytes !== verified.bytes || item.sha256 !== asset.contentSha256 ||
        item.sha256 !== verified.sha256 || item.mime !== asset.mimeType || item.mime !== verified.mime ||
        item.codec !== asset.codec || item.codec !== verified.voice.codec ||
        item.durationMs !== asset.durationMs || item.durationMs !== verified.voice.durationMs) {
      fail("声音音频清单与状态或真字节不一致。", "MEDIA_ARCHIVE_VOICE_MISMATCH");
    }
    totalBytes = safeAdd(totalBytes, item.bytes);
  }
  if (totalBytes !== input.totalBytes) fail("声音总字节数与清单不一致。", "MEDIA_ARCHIVE_BYTES_MISMATCH");
  return input;
}

function validateVoiceState(state, memories, validateVoiceBackup, mode) {
  assertPlainObject(state, "voices state");
  const memoryIds = requireMemoryIds(memories);
  if (state.mode === "full") {
    assertExactKeys(state, FULL_STATE_KEYS, "voices full state");
    if (mode !== "full" || state.schemaVersion !== VOICE_SCHEMA_VERSION || !Array.isArray(state.assets) ||
        !Array.isArray(state.memoryLinks) || !Array.isArray(state.transcripts)) {
      fail("完整声音状态模式或字段无效。", "MEDIA_ARCHIVE_VOICE_INVALID");
    }
  } else if (state.mode === "redacted-summary") {
    assertExactKeys(state, REDACTED_STATE_KEYS, "voices redacted state");
    if (mode !== "redacted") fail("声音状态与归档隐私模式不一致。", "MEDIA_ARCHIVE_MODE_MISMATCH");
    assertRedactedVoiceState(state);
  } else {
    fail("声音状态模式无效。", "MEDIA_ARCHIVE_VOICE_INVALID");
  }
  if (typeof validateVoiceBackup !== "function") {
    fail("声音归档缺少严格校验处理器。", "MEDIA_ARCHIVE_VOICE_HANDLER_REQUIRED");
  }
  try {
    const result = validateVoiceBackup(state, memoryIds);
    if (result && typeof result.then === "function") throw new TypeError("validateVoiceBackup 必须同步执行。");
    if (result !== true) fail("声音状态未通过业务校验。", "MEDIA_ARCHIVE_VOICE_INVALID");
  } catch (cause) {
    if (String(cause?.code || "").startsWith("MEDIA_ARCHIVE_")) throw cause;
    fail(`声音状态无法通过业务校验：${cause?.message || "未知错误"}`, "MEDIA_ARCHIVE_VOICE_INVALID", cause);
  }
  return state;
}

function verifyVoiceBytes(data, declaredMime, label) {
  let inspected;
  try {
    inspected = inspectVoice(data, {
      declaredMimeType: declaredMime,
      maxBytes: MAX_VOICE_BYTES,
      maxDurationMs: MAX_VOICE_DURATION_MS
    });
  } catch (cause) {
    fail(`归档声音内容无效：${label}`, "MEDIA_ARCHIVE_MIME_INVALID", cause);
  }
  if (inspected.mimeType !== declaredMime) {
    fail(`归档声音 MIME 不一致：${label}`, "MEDIA_ARCHIVE_MIME_MISMATCH");
  }
  return inspected;
}

function voiceArchivePath(asset) {
  const id = requireId(asset?.id, "voice asset.id");
  const extension = extensionForMime(asset?.mimeType);
  return `${VOICE_ASSET_PREFIX}${id}/audio.${extension}`;
}

function readyStorageKey(asset) {
  const hash = requireSha256(asset?.contentSha256, "voice asset.contentSha256");
  return `ready/${hash.slice(0, 2)}/${hash}.${extensionForMime(asset?.mimeType)}`;
}

function readVoiceAssetForArchive(asset, voiceStorage) {
  assertPlainObject(asset, "voice asset");
  if (asset.status !== "ready") fail("归档声音资产必须处于 ready 状态。", "MEDIA_ARCHIVE_VOICE_INVALID");
  const filePath = voiceStorage.resolveStorageKey(asset.storageKey);
  let stat;
  let data;
  try {
    stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("not a regular file");
    data = fs.readFileSync(filePath);
  } catch (cause) {
    fail("归档声音文件不存在或不可安全读取。", "MEDIA_ARCHIVE_ENTRY_MISSING", cause);
  }
  const hash = requireSha256(asset.contentSha256, "voice asset.contentSha256");
  const inspected = verifyVoiceBytes(data, asset.mimeType, asset.id);
  if (data.length !== asset.byteSize || data.length !== stat.size || sha256(data) !== hash ||
      inspected.codec !== asset.codec || inspected.durationMs !== asset.durationMs) {
    fail("声音资产状态与真文件不一致。", "MEDIA_ARCHIVE_VOICE_MISMATCH");
  }
  return {
    assetId: asset.id,
    path: voiceArchivePath(asset),
    mime: asset.mimeType,
    codec: asset.codec,
    durationMs: asset.durationMs,
    data
  };
}

function assertRedactedVoiceState(state) {
  for (const key of ["assetCount", "memoryLinkCount", "transcriptCount", "confirmedTranscriptCount", "totalDurationMs"]) {
    if (!Number.isSafeInteger(state[key]) || state[key] < 0) {
      fail("脱敏声音统计无效。", "MEDIA_ARCHIVE_VOICE_INVALID");
    }
  }
  if (typeof state.note !== "string" || !state.note || state.note.length > 300) {
    fail("脱敏声音说明无效。", "MEDIA_ARCHIVE_VOICE_INVALID");
  }
  if (state.note !== VOICE_REDACTED_NOTE) {
    fail("脱敏声音摘要必须使用固定隐私说明。", "MEDIA_ARCHIVE_REDACTED_VOICE_FORBIDDEN");
  }
  const serialized = JSON.stringify(state);
  const forbiddenKeys = /"(?:assets|memoryLinks|transcripts|id|assetId|memoryId|storageKey|originalName|contentSha256|text|createdAt|updatedAt|confirmedAt|path|filename|hash)"\s*:/iu;
  if (forbiddenKeys.test(serialized) || /[a-f0-9]{64}/iu.test(serialized) || /(?:^|[\\/])ready[\\/]/iu.test(serialized)) {
    fail("脱敏声音摘要泄露了音频、转写、标识、路径、文件名、哈希或精确时间。", "MEDIA_ARCHIVE_REDACTED_VOICE_FORBIDDEN");
  }
}

function requireVoiceStorage(storage) {
  if (!storage || typeof storage.resolveStorageKey !== "function") {
    fail("完整声音归档缺少 voiceStorage。", "MEDIA_ARCHIVE_DEPENDENCY_INVALID");
  }
}

function requireMemoryIds(memories) {
  if (!Array.isArray(memories)) fail("collection.memories 无效。", "MEDIA_ARCHIVE_COLLECTION_INVALID");
  const ids = memories.map((memory, index) => requireId(memory?.id, `memories[${index}].id`));
  if (new Set(ids).size !== ids.length) fail("collection.memories ID 重复。", "MEDIA_ARCHIVE_REFERENCE_INVALID");
  return ids;
}

function extensionForMime(mimeType) {
  if (!VOICE_MIME_TYPES.has(mimeType)) fail("声音 MIME 无效。", "MEDIA_ARCHIVE_MIME_INVALID");
  return mimeType === "audio/webm" ? "webm" : "m4a";
}

function requireId(value, name) {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) fail(`${name} 无效。`, "MEDIA_ARCHIVE_REFERENCE_INVALID");
  return value;
}

function requireSha256(value, name) {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) fail(`${name} 无效。`, "MEDIA_ARCHIVE_HASH_INVALID");
  return value;
}

function assertPlainObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${name} 必须是对象。`, "MEDIA_ARCHIVE_VOICE_INVALID");
  return value;
}

function assertExactKeys(value, expected, name) {
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (keys.length !== wanted.length || keys.some((key, index) => key !== wanted[index])) {
    fail(`${name} 字段无效。`, "MEDIA_ARCHIVE_VOICE_INVALID");
  }
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (cause) {
    fail("voices/state.json 无法解析。", "MEDIA_ARCHIVE_JSON_INVALID", cause);
  }
}

function safeAdd(left, right) {
  const total = left + right;
  if (!Number.isSafeInteger(total)) fail("声音总字节数无效。", "MEDIA_ARCHIVE_BYTES_MISMATCH");
  return total;
}

function sha256(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function fail(message, code, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  error.statusCode = 400;
  throw error;
}

module.exports = {
  VOICE_SCHEMA_VERSION,
  VOICE_SECTION_VERSION,
  VOICE_SECTION_PATH,
  VOICE_ARCHIVE_PREFIX,
  VOICE_ASSET_PREFIX,
  VOICE_REDACTED_NOTE,
  VOICE_MIME_TYPES,
  buildVoiceArchiveSection,
  buildVoiceManifest,
  readVoiceArchiveSection,
  validateVoiceSectionDeclaration,
  verifyVoiceBytes,
  voiceArchivePath,
  readyStorageKey
};
