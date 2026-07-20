"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");
const { createMemoryStore } = require("../database");
const { createMediaStorage } = require("../lib/media-storage");
const { createVoiceStorage } = require("../lib/voice-storage");
const { createArchive, extractArchive } = require("../lib/time-isle-archive");
const { buildMediaArchive, prepareMediaArchive, ARCHIVE_PATHS } = require("../lib/media-backup");
const { restorePreparedArchive } = require("../lib/media-restore");
const {
  buildArchaeologyBackup,
  restoreArchaeologyBackup,
  validateArchaeologyBackup
} = require("../lib/archaeology-backup");

let assertions = 0;

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "time-isle-voice-backup-"));
  const stores = [];
  try {
    const source = await createVoiceFixture(path.join(root, "source"));
    stores.push(source.store);
    const archive = buildMediaArchive({
      collection: buildCollection(source.store, [source.memory], "full"),
      store: source.store,
      storage: source.mediaStorage,
      voiceStorage: source.voiceStorage,
      appVersion: "6.1.0",
      schemaVersion: 8
    });
    const pristine = await readArchiveEntries(archive, path.join(root, "unpack-pristine"));

    await checkBuildAndPrepare(root, source, archive);
    await checkStrictRejections(root, source, pristine);
    await checkRedacted(root, source);
    await checkRestore(root, source, archive, stores);
  } finally {
    for (const store of stores.reverse()) {
      try { store.close(); } catch { /* already closed */ }
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
  equal(fs.existsSync(root), false, "专项结束后应清理全部临时数据库、音频和归档");
  console.log(`Voice backup checks passed: ${assertions} assertions.`);
}

async function checkBuildAndPrepare(root, source, archive) {
  const prepared = await prepareMediaArchive(archive, {
    stagingRoot: path.join(root, "prepared-full"),
    validateVoiceBackup: source.store.validateVoiceBackup
  });
  const section = prepared.manifest.sections.find((item) => item.name === "voices");
  deepEqual(section, {
    name: "voices",
    path: "voices/state.json",
    count: 2,
    required: true,
    version: 1
  }, "schema 8 完整归档应声明 required voices section");
  equal(prepared.manifest.voices.assetCount, 2, "manifest 声音计数应与状态一致");
  equal(prepared.manifest.voices.audio.length, 2, "manifest 应逐段描述声音真文件");
  equal(
    prepared.manifest.voices.totalBytes,
    source.webm.length + source.m4a.length,
    "manifest totalBytes 应精确汇总音频字节"
  );
  deepEqual(
    new Set(prepared.manifest.voices.audio.map((item) => item.mime)),
    new Set(["audio/webm", "audio/mp4"]),
    "manifest 仅声明受支持的 WebM 与 MP4 MIME"
  );
  check(prepared.manifest.voices.audio.some((item) => item.path.endsWith("/audio.webm")), "WebM 使用稳定归档路径");
  check(prepared.manifest.voices.audio.some((item) => item.path.endsWith("/audio.m4a")), "M4A 使用稳定归档路径");
  equal(prepared.voices.assets.length, 2, "prepare 顶层应暴露声音状态");
  equal(prepared.collection.voices.assets.length, 2, "prepare collection 应重挂声音状态");
  equal(prepared.files.voices.length, 2, "prepare 应暴露全部已验真声音文件");
  check(prepared.files.voices.every((file) => path.isAbsolute(file.filePath) && fs.existsSync(file.filePath)), "声音文件描述只指向隔离暂存区真文件");
  check(prepared.files.voices.every((file) => /^[a-f0-9]{64}$/u.test(file.sha256)), "声音文件描述包含完整 SHA-256");
  check(prepared.files.voices.every((file) => file.codec === (file.mimeType === "audio/webm" ? "opus" : "aac")), "声音 codec 来自真字节验真");

  assert.throws(() => buildMediaArchive({
    collection: { ...buildCollection(source.store, [source.memory], "full"), voices: null },
    store: source.store,
    storage: source.mediaStorage,
    voiceStorage: source.voiceStorage,
    appVersion: "6.1.0",
    schemaVersion: 8
  }), (error) => error?.code === "MEDIA_ARCHIVE_VOICE_INVALID");
  assertions += 1;

  const missingVoices = buildCollection(source.store, [source.memory], "full");
  delete missingVoices.voices;
  assert.throws(() => buildMediaArchive({
    collection: missingVoices,
    store: source.store,
    storage: source.mediaStorage,
    voiceStorage: source.voiceStorage,
    appVersion: "6.1.0",
    schemaVersion: 8
  }), (error) => error?.code === "MEDIA_ARCHIVE_REQUIRED_SECTION_MISSING");
  assertions += 1;

  await rejectsCode(
    "MEDIA_ARCHIVE_VOICE_HANDLER_REQUIRED",
    () => prepareMediaArchive(archive, { stagingRoot: path.join(root, "reject-missing-validator") }),
    "schema 8 声音在 prepare 阶段必须经过 store 业务校验"
  );
}

async function checkStrictRejections(root, source, pristine) {
  const audioPath = parseJson(pristine.get(ARCHIVE_PATHS.manifest)).voices.audio[0].path;

  const missingAudio = cloneEntries(pristine);
  missingAudio.delete(audioPath);
  await rejectsCode("MEDIA_ARCHIVE_ENTRY_MISSING", () => prepare(source, root, "missing-audio", missingAudio), "缺失音频应在 prepare 拒绝");

  const missingState = cloneEntries(pristine);
  missingState.delete("voices/state.json");
  await rejectsCode("MEDIA_ARCHIVE_ENTRY_MISSING", () => prepare(source, root, "missing-state", missingState), "缺失声音状态应在 prepare 拒绝");

  const extra = cloneEntries(pristine);
  extra.set("voices/assets/extra/audio.webm", source.webm);
  await rejectsCode("MEDIA_ARCHIVE_ENTRY_UNDECLARED", () => prepare(source, root, "extra-audio", extra), "未声明声音条目应拒绝");

  const tampered = cloneEntries(pristine);
  const bytes = Buffer.from(tampered.get(audioPath));
  bytes[bytes.length - 1] ^= 1;
  tampered.set(audioPath, bytes);
  await rejectsCode("MEDIA_ARCHIVE_HASH_MISMATCH", () => prepare(source, root, "tampered-audio", tampered), "篡改声音字节应先被哈希拒绝");

  for (const [name, mutate, expected] of [
    ["count", (manifest) => { manifest.sections.find((item) => item.name === "voices").count += 1; }, "MEDIA_ARCHIVE_SECTIONS_INVALID"],
    ["total-bytes", (manifest) => { manifest.voices.totalBytes += 1; }, "MEDIA_ARCHIVE_BYTES_MISMATCH"],
    ["hash", (manifest) => { manifest.voices.audio[0].sha256 = "0".repeat(64); }, "MEDIA_ARCHIVE_VOICE_MISMATCH"],
    ["codec", (manifest) => { manifest.voices.audio[0].codec = manifest.voices.audio[0].codec === "opus" ? "aac" : "opus"; }, "MEDIA_ARCHIVE_VOICE_MISMATCH"],
    ["duration", (manifest) => { manifest.voices.audio[0].durationMs += 1; }, "MEDIA_ARCHIVE_VOICE_MISMATCH"],
    ["mime", (manifest) => { manifest.voices.audio[0].mime = manifest.voices.audio[0].mime === "audio/webm" ? "audio/mp4" : "audio/webm"; }, "MEDIA_ARCHIVE_VOICE_MISMATCH"],
    ["escape", (manifest) => { manifest.voices.audio[0].path = "voices/assets/../escape/audio.webm"; }, "MEDIA_ARCHIVE_PATH_INVALID"]
  ]) {
    const entries = cloneEntries(pristine);
    const manifest = parseJson(entries.get(ARCHIVE_PATHS.manifest));
    mutate(manifest);
    entries.set(ARCHIVE_PATHS.manifest, jsonBuffer(manifest));
    await rejectsCode(expected, () => prepare(source, root, `manifest-${name}`, entries), `manifest ${name} 与状态不一致时应拒绝`);
  }

  const falseMime = cloneEntries(pristine);
  const falseMimeManifest = parseJson(falseMime.get(ARCHIVE_PATHS.manifest));
  const falseMimeEntry = falseMimeManifest.entries.find((entry) => entry.path === audioPath);
  falseMimeEntry.mime = falseMimeEntry.mime === "audio/webm" ? "audio/mp4" : "audio/webm";
  falseMime.set(ARCHIVE_PATHS.manifest, jsonBuffer(falseMimeManifest));
  await rejectsCode("MEDIA_ARCHIVE_MIME_INVALID", () => prepare(source, root, "false-mime", falseMime), "manifest MIME 不能覆盖真字节类型");

  const invalidReference = cloneEntries(pristine);
  const voiceState = parseJson(invalidReference.get("voices/state.json"));
  voiceState.memoryLinks[0].memoryId = "memory-outside";
  replaceJsonAndRefreshManifest(invalidReference, "voices/state.json", voiceState);
  await rejectsCode("MEDIA_ARCHIVE_VOICE_INVALID", () => prepare(source, root, "invalid-reference", invalidReference), "越过馆藏边界的声音引用应在任何写入前拒绝");

  const reserved = cloneEntries(pristine);
  const reservedPath = "voices/future.json";
  const reservedData = jsonBuffer({ future: true });
  reserved.set(reservedPath, reservedData);
  const reservedManifest = parseJson(reserved.get(ARCHIVE_PATHS.manifest));
  reservedManifest.sections.push({ name: "future_optional", path: reservedPath, count: 1, required: false, version: 1 });
  reservedManifest.entries.push(describeEntry(reservedPath, reservedData, "application/json"));
  reservedManifest.entries.sort((left, right) => left.path.localeCompare(right.path, "en"));
  reservedManifest.entryCount = reservedManifest.entries.length;
  reserved.set(ARCHIVE_PATHS.manifest, jsonBuffer(reservedManifest));
  await rejectsCode("MEDIA_ARCHIVE_SECTIONS_INVALID", () => prepare(source, root, "reserved-prefix", reserved), "未知 section 不得占用 voices/ 保留前缀");
}

async function checkRedacted(root, source) {
  const collection = buildCollection(source.store, [source.memory], "redacted");
  const archive = buildMediaArchive({
    collection,
    store: source.store,
    storage: new Proxy({}, { get() { throw new Error("脱敏声音归档不应读取媒体文件"); } }),
    voiceStorage: new Proxy({}, { get() { throw new Error("脱敏声音归档不应读取声音文件"); } }),
    appVersion: "6.1.0",
    schemaVersion: 8
  });
  const entries = await readArchiveEntries(archive, path.join(root, "unpack-redacted"));
  const manifest = parseJson(entries.get(ARCHIVE_PATHS.manifest));
  equal(manifest.voices.included, false, "脱敏归档明确声明未包含音频");
  equal(manifest.voices.totalBytes, 0, "脱敏声音总字节必须为零");
  equal(manifest.voices.audio.length, 0, "脱敏 manifest 物理排除音频条目");
  check([...entries.keys()].every((entryPath) => !entryPath.startsWith("voices/assets/")), "脱敏归档物理排除声音文件");
  const state = parseJson(entries.get("voices/state.json"));
  deepEqual(Object.keys(state).sort(), [
    "assetCount", "confirmedTranscriptCount", "memoryLinkCount", "mode", "note", "totalDurationMs", "transcriptCount"
  ].sort(), "脱敏声音状态只有聚合白名单字段");
  const stateText = JSON.stringify(state);
  for (const secret of [source.voiceAssets[0].id, source.voiceAssets[0].contentSha256, source.voiceAssets[0].originalName, "只存在于声音转写中的秘密句子"]) {
    check(!stateText.includes(secret), `脱敏声音状态不应出现 ${secret}`);
  }
  const prepared = await prepareMediaArchive(archive, {
    stagingRoot: path.join(root, "prepared-redacted"),
    validateVoiceBackup: source.store.validateVoiceBackup
  });
  equal(prepared.files.voices.length, 0, "脱敏 prepare 不暴露声音文件");

  const leaky = cloneEntries(entries);
  const leakyState = parseJson(leaky.get("voices/state.json"));
  leakyState.note = "0".repeat(64);
  replaceJsonAndRefreshManifest(leaky, "voices/state.json", leakyState);
  await rejectsCode("MEDIA_ARCHIVE_REDACTED_VOICE_FORBIDDEN", () => prepare(source, root, "redacted-leak", leaky), "脱敏摘要中的哈希形态也应物理拒绝");
}

async function checkRestore(root, source, archive, stores) {
  const handlerDefense = createTarget(path.join(root, "handler-defense"));
  stores.push(handlerDefense.store);
  const handlerPrepared = await prepareMediaArchive(archive, {
    stagingRoot: path.join(root, "handler-prepared"),
    validateVoiceBackup: handlerDefense.store.validateVoiceBackup
  });
  assert.throws(
    () => restoreToTarget(handlerPrepared, handlerDefense, () => "handler-defense", handlerDefense.store.restoreVoiceBackup, {
      restoreVoiceBackup: undefined
    }),
    (error) => error?.code === "MEDIA_RESTORE_VOICE_HANDLER_REQUIRED"
  );
  assertions += 1;
  equal(handlerDefense.store.listMemories().length, 0, "缺少声音恢复处理器时必须保持零展品写入");
  assert.throws(
    () => restoreToTarget(handlerPrepared, handlerDefense, () => "storage-defense", handlerDefense.store.restoreVoiceBackup, {
      voiceStorage: undefined
    }),
    (error) => error?.code === "MEDIA_RESTORE_VOICE_STORAGE_REQUIRED"
  );
  assertions += 1;
  equal(handlerDefense.store.listMemories().length, 0, "缺少 voiceStorage 时必须保持零展品写入");

  const target = createTarget(path.join(root, "target"));
  stores.push(target.store);
  const prepared = await prepareMediaArchive(archive, {
    stagingRoot: path.join(root, "target-prepared"),
    validateVoiceBackup: target.store.validateVoiceBackup
  });
  let counter = 0;
  const first = restoreToTarget(prepared, target, () => `restored-${++counter}`);
  equal(first.voices.assets, 2, "首次恢复应登记两段声音资产");
  equal(first.voices.assetsReused, 0, "首次恢复不应误报 hash 复用");
  equal(first.voices.memoryLinks, 2, "声音关联应与展品同事务恢复");
  equal(first.voices.transcripts, 2, "草稿和已确认转写均应完整恢复");
  equal(Object.keys(first.idMap.voices).length, 2, "恢复结果应暴露源声音到目标声音映射");
  const firstMemoryId = first.idMap.memories[source.memory.id];
  const restoredVoices = target.store.listVoiceForMemory(firstMemoryId);
  equal(restoredVoices.length, 2, "恢复后的展品可读取两段声音");
  check(restoredVoices.every((item) => fs.existsSync(target.voiceStorage.resolveStorageKey(item.asset.storageKey))), "恢复后每段声音真文件都已落盘");
  equal(target.store.getVoiceTranscript(firstMemoryId, first.idMap.voices[source.voiceAssets[0].id]).text, "只存在于声音转写中的秘密句子", "确认转写应无损恢复");

  const second = restoreToTarget(prepared, target, () => `second-${++counter}`);
  equal(second.voices.assets, 0, "再次恢复相同内容不应重复登记声音资产");
  equal(second.voices.assetsReused, 2, "再次恢复应按内容哈希复用两段声音");
  deepEqual(second.idMap.voices, first.idMap.voices, "hash 复用应保持声音映射稳定");
  equal(target.store.listVoiceAssets({ limit: 20 }).length, 2, "hash 复用后声音资产总数不增长");

  const collision = createTarget(path.join(root, "id-collision"));
  stores.push(collision.store);
  const collisionBytes = makeWebm(1_500);
  const collisionSaved = await collision.voiceStorage.save(Readable.from(collisionBytes), {
    fileName: "preexisting.webm",
    declaredMimeType: "audio/webm"
  });
  collision.store.createVoiceAsset({
    id: source.voiceAssets[0].id,
    ...collisionSaved.asset,
    status: "ready"
  });
  const collisionPrepared = await prepareMediaArchive(archive, {
    stagingRoot: path.join(root, "id-collision-prepared"),
    validateVoiceBackup: collision.store.validateVoiceBackup
  });
  const collisionResult = restoreToTarget(collisionPrepared, collision, () => `voice-remapped-${++counter}`);
  check(collisionResult.idMap.voices[source.voiceAssets[0].id] !== source.voiceAssets[0].id, "声音 ID 冲突时应生成安全新 ID");
  equal(collisionResult.idMap.voices[source.voiceAssets[1].id], source.voiceAssets[1].id, "未冲突声音 ID 应保持稳定");
  equal(collision.store.listVoiceAssets({ limit: 20 }).length, 3, "ID 冲突恢复不得覆盖既有声音资产");

  const rollback = createTarget(path.join(root, "rollback"));
  stores.push(rollback.store);
  const rollbackPrepared = await prepareMediaArchive(archive, {
    stagingRoot: path.join(root, "rollback-prepared"),
    validateVoiceBackup: rollback.store.validateVoiceBackup
  });
  assert.throws(() => restoreToTarget(rollbackPrepared, rollback, () => `rollback-${++counter}`, (...args) => {
    rollback.store.restoreVoiceBackup(...args);
    throw Object.assign(new Error("forced voice restore failure"), { code: "VOICE_FORCED_FAILURE" });
  }), (error) => error?.code === "VOICE_FORCED_FAILURE");
  assertions += 1;
  equal(rollback.store.listMemories().length, 0, "声音 DB 失败应回滚展品事务");
  equal(rollback.store.listVoiceAssets({ limit: 20 }).length, 0, "声音 DB 失败应回滚资产记录");
  check(source.voiceAssets.every((asset) => !fs.existsSync(rollback.voiceStorage.resolveStorageKey(asset.storageKey))), "声音 DB 失败应删除本轮新落盘文件");

  const invalid = createTarget(path.join(root, "invalid"));
  stores.push(invalid.store);
  const invalidPrepared = await prepareMediaArchive(archive, {
    stagingRoot: path.join(root, "invalid-prepared"),
    validateVoiceBackup: invalid.store.validateVoiceBackup
  });
  invalidPrepared.collection.voices.memoryLinks[0].memoryId = "memory-outside";
  assert.throws(() => restoreToTarget(invalidPrepared, invalid, () => `invalid-${++counter}`), (error) => error?.code === "MEDIA_RESTORE_FEATURE_INVALID");
  assertions += 1;
  equal(invalid.store.listMemories().length, 0, "prepare 后描述被篡改也必须在任何写入前拒绝");
  equal(invalid.store.listVoiceAssets({ limit: 20 }).length, 0, "非法引用不得制造声音资产");
}

function restoreToTarget(prepared, target, createId, voiceRestore = target.store.restoreVoiceBackup, overrides = {}) {
  return restorePreparedArchive({
    prepared,
    store: target.store,
    storage: target.mediaStorage,
    voiceStorage: target.voiceStorage,
    normalizeMemory,
    validateArchaeologyBackup,
    restoreArchaeologyBackup,
    validateExhibitionBackup: target.store.validateExhibitionBackup,
    restoreExhibitionBackup: target.store.restoreExhibitionBackup,
    validateRevisitBackup: target.store.validateRevisitBackup,
    restoreRevisitBackup: target.store.restoreRevisitBackup,
    validateEntityBackup: target.store.validateClueBackup,
    restoreEntityBackup: target.store.restoreClueBackup,
    validateVoiceBackup: target.store.validateVoiceBackup,
    restoreVoiceBackup: voiceRestore,
    createId,
    ...overrides
  });
}

async function createVoiceFixture(directory) {
  const target = createTarget(directory);
  const memory = target.store.saveMemory(normalizeMemory({
    id: "memory-voice-source",
    title: "留给未来的一段声音",
    rawContent: "这一件展品同时保存 WebM 与 M4A 声音。",
    exhibitText: "一件能被听见的记忆。"
  }));
  const webm = makeWebm(1_000);
  const m4a = makeMp4(2_000);
  const voiceAssets = [];
  for (const [index, fixture] of [
    { bytes: webm, fileName: "private-webm-name.webm", mimeType: "audio/webm" },
    { bytes: m4a, fileName: "private-m4a-name.m4a", mimeType: "audio/mp4" }
  ].entries()) {
    const saved = await target.voiceStorage.save(Readable.from(fixture.bytes), {
      fileName: fixture.fileName,
      declaredMimeType: fixture.mimeType
    });
    voiceAssets.push(target.store.createVoiceAsset({
      id: `voice-source-${index + 1}`,
      ...saved.asset,
      status: "ready"
    }));
  }
  target.store.replaceMemoryVoice(memory.id, voiceAssets.map((asset, index) => ({ assetId: asset.id, label: `声音 ${index + 1}` })));
  target.store.upsertVoiceTranscript({
    memoryId: memory.id,
    assetId: voiceAssets[0].id,
    text: "只存在于声音转写中的秘密句子",
    language: "zh-CN",
    source: "manual",
    status: "confirmed"
  });
  target.store.upsertVoiceTranscript({
    memoryId: memory.id,
    assetId: voiceAssets[1].id,
    text: "尚未确认的草稿转写",
    language: "zh-CN",
    source: "manual",
    status: "draft"
  });
  return { ...target, memory, voiceAssets, webm, m4a };
}

function createTarget(directory) {
  fs.mkdirSync(directory, { recursive: true });
  const halls = [{ id: "daily", name: "日常展厅", description: "测试" }];
  return {
    store: createMemoryStore({ dbPath: path.join(directory, "museum.sqlite"), halls, schemaVersion: 8 }),
    mediaStorage: createMediaStorage({ root: path.join(directory, "media") }),
    voiceStorage: createVoiceStorage({ root: path.join(directory, "voice") })
  };
}

function buildCollection(store, memories, mode) {
  const memoryIds = memories.map((memory) => memory.id);
  return {
    product: "时屿",
    productEnglish: "TIME ISLE",
    version: "6.1.0",
    schemaVersion: 8,
    mode,
    exportedAt: "2026-07-17T00:00:00.000Z",
    count: memories.length,
    memories: mode === "redacted"
      ? memories.map((memory) => ({ ...memory, rawContent: "[已隐藏原始记忆]", exhibitText: "一段声音记忆。", people: [], location: "" }))
      : memories,
    archaeology: buildArchaeologyBackup(store, memories, mode),
    exhibitions: store.buildExhibitionBackup(mode),
    revisits: store.buildRevisitBackup(mode, memoryIds),
    entities: store.buildClueBackup(mode, memoryIds),
    voices: store.buildVoiceBackup(mode, memoryIds)
  };
}

function normalizeMemory(input = {}) {
  const now = "2026-07-17T00:00:00.000Z";
  return {
    schemaVersion: 8,
    id: input.id,
    title: String(input.title || "未命名记忆"),
    hall: String(input.hall || "daily"),
    sourceType: String(input.sourceType || "其他"),
    rawContent: String(input.rawContent || ""),
    exhibitText: String(input.exhibitText || input.rawContent || ""),
    date: String(input.date || ""),
    location: String(input.location || ""),
    people: Array.isArray(input.people) ? input.people : [],
    tags: Array.isArray(input.tags) ? input.tags : [],
    emotions: Array.isArray(input.emotions) ? input.emotions : [],
    emotionIntensity: Number(input.emotionIntensity || 3),
    importance: Number(input.importance || 2),
    favorite: Boolean(input.favorite),
    coverImage: "",
    mediaNote: "",
    attachments: [],
    agentRunId: "",
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || ""
  };
}

async function prepare(source, root, name, entries) {
  return prepareMediaArchive(repack(entries), {
    stagingRoot: path.join(root, `reject-${name}`),
    validateVoiceBackup: source.store.validateVoiceBackup
  });
}

async function readArchiveEntries(archive, stagingRoot) {
  const extracted = await extractArchive(archive, { stagingRoot });
  const entries = new Map(extracted.entries.map((entry) => [entry.path, fs.readFileSync(path.join(stagingRoot, ...entry.path.split("/")))]));
  fs.rmSync(stagingRoot, { recursive: true, force: true });
  return entries;
}

function repack(entries) {
  return createArchive([...entries].map(([entryPath, data]) => ({ path: entryPath, data, mtime: 0 })));
}

function cloneEntries(entries) {
  return new Map([...entries].map(([entryPath, data]) => [entryPath, Buffer.from(data)]));
}

function replaceJsonAndRefreshManifest(entries, entryPath, value) {
  const data = jsonBuffer(value);
  entries.set(entryPath, data);
  const manifest = parseJson(entries.get(ARCHIVE_PATHS.manifest));
  const descriptor = manifest.entries.find((entry) => entry.path === entryPath);
  descriptor.bytes = data.length;
  descriptor.sha256 = sha256(data);
  entries.set(ARCHIVE_PATHS.manifest, jsonBuffer(manifest));
}

function describeEntry(entryPath, data, mime) {
  return { path: entryPath, sha256: sha256(data), bytes: data.length, mime };
}

function parseJson(data) {
  return JSON.parse(data.toString("utf8"));
}

function jsonBuffer(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function rejectsCode(code, operation, message) {
  await assert.rejects(operation, (error) => error?.code === code, message);
  assertions += 1;
}

function check(value, message) {
  assert.ok(value, message);
  assertions += 1;
}

function equal(actual, expected, message) {
  assert.equal(actual, expected, message);
  assertions += 1;
}

function deepEqual(actual, expected, message) {
  assert.deepEqual(actual, expected, message);
  assertions += 1;
}

function makeWebm(durationMs) {
  const opusHead = Buffer.alloc(19);
  opusHead.write("OpusHead", 0, "ascii");
  opusHead[8] = 1;
  opusHead[9] = 1;
  opusHead.writeUInt32LE(48_000, 12);
  const audio = ebmlElement("e1", Buffer.concat([ebmlUInt("9f", 1), ebmlFloat("b5", 48_000)]));
  const track = ebmlElement("ae", Buffer.concat([
    ebmlUInt("d7", 1),
    ebmlUInt("83", 2),
    ebmlElement("86", Buffer.from("A_OPUS")),
    ebmlElement("63a2", opusHead),
    audio
  ]));
  const segment = ebmlElement("18538067", Buffer.concat([
    ebmlElement("1549a966", Buffer.concat([ebmlUInt("2ad7b1", 1_000_000), ebmlFloat("4489", durationMs)])),
    ebmlElement("1654ae6b", track),
    ebmlElement("1f43b675", Buffer.concat([ebmlUInt("e7", 0), ebmlElement("a3", Buffer.from([0x81, 0, 0, 0x80, 0xf8]))]))
  ]));
  return Buffer.concat([ebmlElement("1a45dfa3", ebmlElement("4282", Buffer.from("webm"))), segment]);
}

function makeMp4(durationMs) {
  const timescale = 48_000;
  const audioHeader = Buffer.alloc(28);
  audioHeader.writeUInt16BE(1, 6);
  audioHeader.writeUInt16BE(2, 16);
  audioHeader.writeUInt16BE(16, 18);
  audioHeader.writeUInt32BE(48_000 * 65_536, 24);
  const asc = descriptor(0x05, Buffer.from([0x12, 0x10]));
  const decoder = descriptor(0x04, Buffer.concat([Buffer.from([0x40, 0x15, 0, 0, 0]), Buffer.alloc(8), asc]));
  const esds = mp4Box("esds", Buffer.concat([Buffer.alloc(4), descriptor(0x03, Buffer.concat([Buffer.from([0, 1, 0]), decoder]))]));
  const mp4a = mp4Box("mp4a", Buffer.concat([audioHeader, esds]));
  const stsd = mp4Box("stsd", Buffer.concat([Buffer.alloc(4), u32(1), mp4a]));
  const stsz = mp4Box("stsz", Buffer.concat([Buffer.alloc(4), u32(4), u32(1)]));
  const mdhd = Buffer.alloc(24);
  mdhd.writeUInt32BE(timescale, 12);
  mdhd.writeUInt32BE(Math.round(durationMs * timescale / 1000), 16);
  const hdlr = Buffer.alloc(24);
  hdlr.write("soun", 8, "ascii");
  const mdia = mp4Box("mdia", Buffer.concat([
    mp4Box("mdhd", mdhd),
    mp4Box("hdlr", hdlr),
    mp4Box("minf", mp4Box("stbl", Buffer.concat([stsd, stsz])))
  ]));
  const ftyp = mp4Box("ftyp", Buffer.concat([Buffer.from("M4A "), Buffer.alloc(4), Buffer.from("isommp42")]));
  return Buffer.concat([ftyp, mp4Box("moov", mp4Box("trak", mdia)), mp4Box("mdat", Buffer.alloc(4, 0x55))]);
}

function ebmlElement(id, payload) {
  return Buffer.concat([Buffer.from(id, "hex"), encodeEbmlSize(payload.length), payload]);
}

function ebmlUInt(id, value) {
  let hex = BigInt(value).toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  return ebmlElement(id, Buffer.from(hex, "hex"));
}

function ebmlFloat(id, value) {
  const data = Buffer.alloc(8);
  data.writeDoubleBE(value);
  return ebmlElement(id, data);
}

function encodeEbmlSize(value) {
  const number = BigInt(value);
  for (let width = 1; width <= 8; width += 1) {
    if (number >= (1n << BigInt(7 * width)) - 1n) continue;
    let marked = number | (1n << BigInt(7 * width));
    const output = Buffer.alloc(width);
    for (let index = width - 1; index >= 0; index -= 1) {
      output[index] = Number(marked & 0xffn);
      marked >>= 8n;
    }
    return output;
  }
  throw new Error("fixture too large");
}

function descriptor(tag, payload) {
  return Buffer.concat([Buffer.from([tag, payload.length]), payload]);
}

function mp4Box(type, payload) {
  return Buffer.concat([u32(payload.length + 8), Buffer.from(type), payload]);
}

function u32(value) {
  const output = Buffer.alloc(4);
  output.writeUInt32BE(value);
  return output;
}
