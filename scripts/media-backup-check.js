"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { createArchive, extractArchive } = require("../lib/time-isle-archive");
const {
  buildMediaArchive,
  prepareMediaArchive,
  ARCHIVE_FORMAT,
  ARCHIVE_FORMAT_VERSION,
  ARCHIVE_PATHS,
  FEATURE_ARCHIVE_SECTIONS
} = require("../lib/media-backup");
const { buildClueBackup } = require("../lib/clue-backup");
const { MEDIA_ARCHIVE_LIMITS } = require("../lib/media-policy");

let assertions = 0;

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "time-isle-media-backup-check-"));
  let failure = null;
  try {
    await runChecks(temporaryRoot);
  } catch (error) {
    failure = error;
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
  if (failure) throw failure;
  equal(fs.existsSync(temporaryRoot), false, "测试完成后应清理全部临时归档和图片文件");
  console.log(`Media backup checks passed: ${assertions} assertions.`);
}

async function runChecks(temporaryRoot) {
  const fixture = createFixture(temporaryRoot);
  const collection = {
    product: "时屿",
    productEnglish: "TIME ISLE",
    version: "4.0.0",
    schemaVersion: 4,
    mode: "full",
    exportedAt: "2026-07-12T12:00:00.000Z",
    count: 2,
    memories: [
      { id: "memory-one", title: "旧操场", rawContent: "那天我们绕着操场散步。", media: [{ assetId: fixture.asset.id }] },
      { id: "memory-two", title: "后来重返", rawContent: "多年后又回到同一个地方。", media: [{ assetId: fixture.asset.id }] }
    ],
    archaeology: { mode: "full", events: [], claims: [], pairDecisions: [], questions: [] }
  };

  const archive = buildMediaArchive({
    collection,
    store: fixture.store,
    storage: fixture.storage,
    appVersion: "4.0.0",
    schemaVersion: 4
  });
  check(Buffer.isBuffer(archive), "buildMediaArchive 应返回 Buffer");
  deepEqual(archive.subarray(0, 2), Buffer.from([0x1f, 0x8b]), ".time-isle 应使用 gzip 封装");

  const roundTripRoot = path.join(temporaryRoot, "roundtrip");
  const prepared = await prepareMediaArchive(archive, {
    stagingRoot: roundTripRoot,
    limits: { maxEntries: 20, maxEntryBytes: 1024 * 1024, maxTotalBytes: 4 * 1024 * 1024 }
  });
  equal(ARCHIVE_FORMAT_VERSION, 2, "新归档 writer 应发布 format version 2");
  deepEqual(prepared.manifest.sections, [
    { name: "collection", path: ARCHIVE_PATHS.collection, count: 2, required: true, version: 1 },
    { name: "media", path: ARCHIVE_PATHS.assets, count: 1, required: true, version: 1 }
  ], "V2 manifest 应显式声明必需的 collection 与 media sections");
  equal(prepared.verified, true, "完整归档应在全量验证后返回 verified descriptor");
  equal(prepared.manifest.format, ARCHIVE_FORMAT, "manifest 应声明媒体归档格式");
  equal(prepared.collection.memories.length, 2, "馆藏 JSON 应完整回环");
  equal(prepared.assets.length, 1, "共享图片应只归档一份资产元数据");
  equal(prepared.links.length, 2, "共享图片应保留两个馆藏内关联");
  equal(prepared.mediaObservations.length, 1, "只应保留当前馆藏边界内的图片观察");
  equal(prepared.mediaObservations[0].metadata.memoryId, "memory-one", "图片观察应保留合法的展品归属");
  equal(prepared.files.variants.length, 3, "保留原图模式应返回 original/display/thumb 三个已验证文件路径");
  check(prepared.files.variants.every((item) => path.isAbsolute(item.filePath) && fs.existsSync(item.filePath)), "恢复 descriptor 应提供可读取的绝对暂存路径");
  check(prepared.assets[0].variants.every((variant) => !Object.hasOwn(variant, "storageKey")), "归档不能泄漏原机器 storageKey");
  deepEqual(
    fs.readFileSync(prepared.files.variants.find((item) => item.kind === "original").filePath),
    fixture.original,
    "原图字节应无损回环"
  );
  check(prepared.manifest.entries.every((entry) => /^[a-f0-9]{64}$/.test(entry.sha256) && Number.isSafeInteger(entry.bytes) && entry.mime), "manifest 应为每个业务条目记录哈希、字节数和 MIME");

  const pristineEntries = await readArchiveEntries(archive, path.join(temporaryRoot, "unpack-pristine"));
  const imagePath = prepared.assets[0].variants.find((variant) => variant.kind === "display").archivePath;
  await checkArchiveVersioning(temporaryRoot, pristineEntries);
  await checkFeatureSections(temporaryRoot, fixture, collection);

  const corruptedEntries = cloneEntries(pristineEntries);
  const corruptedImage = Buffer.from(corruptedEntries.get(imagePath));
  corruptedImage[corruptedImage.length - 1] ^= 0x01;
  corruptedEntries.set(imagePath, corruptedImage);
  const corruptedRoot = path.join(temporaryRoot, "reject-corrupt-hash");
  fs.mkdirSync(corruptedRoot);
  await rejectsCode(
    "MEDIA_ARCHIVE_HASH_MISMATCH",
    () => prepareMediaArchive(repack(corruptedEntries), { stagingRoot: corruptedRoot }),
    "图片被篡改时必须在返回 descriptor 前拒绝"
  );
  deepEqual(fs.readdirSync(corruptedRoot), [], "调用方预先创建的空暂存目录在拒绝后应恢复为空目录");

  const missingEntries = cloneEntries(pristineEntries);
  missingEntries.delete(imagePath);
  const missingRoot = path.join(temporaryRoot, "reject-missing-entry");
  await rejectsCode(
    "MEDIA_ARCHIVE_ENTRY_MISSING",
    () => prepareMediaArchive(repack(missingEntries), { stagingRoot: missingRoot }),
    "manifest 声明但实际缺失的图片必须被拒绝"
  );
  equal(fs.existsSync(missingRoot), false, "缺条目归档被拒绝后不能残留暂存文件");

  const unauthorizedEntries = cloneEntries(pristineEntries);
  const unauthorizedLinks = parseJson(unauthorizedEntries.get(ARCHIVE_PATHS.links));
  unauthorizedLinks[0].memoryId = "memory-outside";
  replaceJsonAndRefreshManifest(unauthorizedEntries, ARCHIVE_PATHS.links, unauthorizedLinks);
  const unauthorizedRoot = path.join(temporaryRoot, "reject-unauthorized-link");
  await rejectsCode(
    "MEDIA_ARCHIVE_REFERENCE_FORBIDDEN",
    () => prepareMediaArchive(repack(unauthorizedEntries), { stagingRoot: unauthorizedRoot }),
    "指向馆藏外记忆的媒体关联必须被拒绝"
  );
  equal(fs.existsSync(unauthorizedRoot), false, "越权引用归档被拒绝后不能残留暂存文件");

  const mimeEntries = cloneEntries(pristineEntries);
  const mimeManifest = parseJson(mimeEntries.get(ARCHIVE_PATHS.manifest));
  mimeManifest.entries.find((entry) => entry.path === imagePath).mime = "image/png";
  mimeEntries.set(ARCHIVE_PATHS.manifest, jsonBuffer(mimeManifest));
  const mimeRoot = path.join(temporaryRoot, "reject-mime");
  await rejectsCode(
    "MEDIA_ARCHIVE_MIME_MISMATCH",
    () => prepareMediaArchive(repack(mimeEntries), { stagingRoot: mimeRoot }),
    "manifest MIME 与图片真实格式不一致时必须被拒绝"
  );
  equal(fs.existsSync(mimeRoot), false, "伪造 MIME 归档被拒绝后不能残留暂存文件");

  await checkObservationPrivacy(temporaryRoot, fixture, collection, pristineEntries);
  await checkArchiveLimits(temporaryRoot, fixture, collection);
  await checkRedactedArchive(temporaryRoot, collection);
}

async function checkArchiveVersioning(temporaryRoot, pristineEntries) {
  const legacyEntries = cloneEntries(pristineEntries);
  const legacyManifest = parseJson(legacyEntries.get(ARCHIVE_PATHS.manifest));
  legacyManifest.formatVersion = 1;
  delete legacyManifest.sections;
  legacyEntries.set(ARCHIVE_PATHS.manifest, jsonBuffer(legacyManifest));
  const legacyPrepared = await prepareMediaArchive(repack(legacyEntries), {
    stagingRoot: path.join(temporaryRoot, "roundtrip-v1")
  });
  equal(legacyPrepared.manifest.formatVersion, 1, "V2 reader 应继续接受没有 sections 的 V1 归档");
  equal(legacyPrepared.collection.memories.length, 2, "V1 兼容读取应原样返回 collection");

  const requiredEntries = cloneEntries(pristineEntries);
  const requiredManifest = parseJson(requiredEntries.get(ARCHIVE_PATHS.manifest));
  requiredManifest.sections.push({
    name: "future_required",
    path: "future/required.json",
    count: 0,
    required: true,
    version: 1
  });
  requiredEntries.set(ARCHIVE_PATHS.manifest, jsonBuffer(requiredManifest));
  await rejectsCode(
    "MEDIA_ARCHIVE_REQUIRED_SECTION_UNSUPPORTED",
    () => prepareMediaArchive(repack(requiredEntries), {
      stagingRoot: path.join(temporaryRoot, "reject-unknown-required-section")
    }),
    "未知 required section 必须在任何业务恢复前整包拒绝"
  );

  const optionalEntries = cloneEntries(pristineEntries);
  const optionalPath = "future/optional.json";
  const optionalData = jsonBuffer({ records: [{ id: "future-one" }] });
  optionalEntries.set(optionalPath, optionalData);
  const optionalManifest = parseJson(optionalEntries.get(ARCHIVE_PATHS.manifest));
  optionalManifest.sections.push({
    name: "future_optional",
    path: optionalPath,
    count: 1,
    required: false,
    version: 1
  });
  optionalManifest.entries.push({
    path: optionalPath,
    sha256: sha256(optionalData),
    bytes: optionalData.length,
    mime: "application/json"
  });
  optionalManifest.entries.sort((left, right) => left.path.localeCompare(right.path, "en"));
  optionalManifest.entryCount = optionalManifest.entries.length;
  optionalEntries.set(ARCHIVE_PATHS.manifest, jsonBuffer(optionalManifest));
  const optionalPrepared = await prepareMediaArchive(repack(optionalEntries), {
    stagingRoot: path.join(temporaryRoot, "roundtrip-unknown-optional-section")
  });
  equal(optionalPrepared.collection.memories.length, 2, "未知 optional section 可在验真后忽略");
  equal(optionalPrepared.assets.length, 1, "忽略 optional section 不得改变既有 feature descriptor");

  const undeclaredEntries = cloneEntries(pristineEntries);
  const undeclaredPath = "future/undeclared.json";
  undeclaredEntries.set(undeclaredPath, jsonBuffer({ ignored: true }));
  const undeclaredManifest = parseJson(undeclaredEntries.get(ARCHIVE_PATHS.manifest));
  undeclaredManifest.sections.push({
    name: "future_optional",
    path: undeclaredPath,
    count: 0,
    required: false,
    version: 1
  });
  undeclaredEntries.set(ARCHIVE_PATHS.manifest, jsonBuffer(undeclaredManifest));
  await rejectsCode(
    "MEDIA_ARCHIVE_ENTRY_UNDECLARED",
    () => prepareMediaArchive(repack(undeclaredEntries), {
      stagingRoot: path.join(temporaryRoot, "reject-undeclared-optional-entry")
    }),
    "optional section 不能让未列入 manifest.entries 的归档条目绕过校验"
  );
}

async function checkFeatureSections(temporaryRoot, fixture, sourceCollection) {
  deepEqual(
    FEATURE_ARCHIVE_SECTIONS.map(({ name, path: sectionPath, sinceSchemaVersion }) => ({ name, path: sectionPath, sinceSchemaVersion })),
    [
      { name: "exhibitions", path: ARCHIVE_PATHS.exhibitions, sinceSchemaVersion: 5 },
      { name: "revisits", path: ARCHIVE_PATHS.revisits, sinceSchemaVersion: 6 },
      { name: "entities", path: ARCHIVE_PATHS.entities, sinceSchemaVersion: 7 },
      { name: "capsules", path: ARCHIVE_PATHS.capsules, sinceSchemaVersion: 9 }
    ],
    "功能 section 注册表应按 schema 顺序声明展览、回访、实体线索与时间胶囊"
  );

  const exhibitions = { mode: "full", schemaVersion: 5, exhibitions: [] };
  const schema5Collection = {
    ...sourceCollection,
    version: "5.0.0",
    schemaVersion: 5,
    exhibitions
  };
  throwsCode(
    "MEDIA_ARCHIVE_REQUIRED_SECTION_MISSING",
    () => buildMediaArchive({
      collection: {
        ...sourceCollection,
        version: "5.0.0",
        schemaVersion: 5
      },
      store: fixture.store,
      storage: fixture.storage,
      appVersion: "5.0.0",
      schemaVersion: 5
    }),
    "schema 5 完整归档不得省略空展览 section"
  );

  const schema5Archive = buildMediaArchive({
    collection: schema5Collection,
    store: fixture.store,
    storage: fixture.storage,
    appVersion: "5.0.0",
    schemaVersion: 5
  });
  const schema5Entries = await readArchiveEntries(schema5Archive, path.join(temporaryRoot, "unpack-schema5-features"));
  check(schema5Entries.has(ARCHIVE_PATHS.exhibitions), "schema 5 writer 应创建独立展览 JSON 条目");
  check(!Object.hasOwn(parseJson(schema5Entries.get(ARCHIVE_PATHS.collection)), "exhibitions"), "展览数据应从归档内 collection 副本移出");
  deepEqual(parseJson(schema5Entries.get(ARCHIVE_PATHS.exhibitions)), exhibitions, "独立展览条目应无损保存完整备份");
  const schema5Prepared = await prepareMediaArchive(schema5Archive, {
    stagingRoot: path.join(temporaryRoot, "roundtrip-schema5-features")
  });
  deepEqual(
    schema5Prepared.manifest.sections.find((section) => section.name === "exhibitions"),
    { name: "exhibitions", path: ARCHIVE_PATHS.exhibitions, count: 0, required: true, version: 1 },
    "schema 5 full 即使没有展览也应声明 required section"
  );
  deepEqual(schema5Prepared.exhibitions, exhibitions, "reader 应在顶层暴露展览备份");
  deepEqual(schema5Prepared.collection.exhibitions, exhibitions, "reader 应把展览备份重新挂回 collection");
  equal(schema5Prepared.revisits, null, "schema 5 归档不应伪造尚不存在的回访 section");
  equal(schema5Prepared.entities, null, "V2 schema 5 归档不应被实体 section 注册影响");

  const revisits = { mode: "full", schemaVersion: 6, states: [] };
  const schema6Collection = {
    ...schema5Collection,
    version: "6.0.0",
    schemaVersion: 6,
    revisits
  };
  throwsCode(
    "MEDIA_ARCHIVE_REQUIRED_SECTION_MISSING",
    () => buildMediaArchive({
      collection: {
        ...schema5Collection,
        version: "6.0.0",
        schemaVersion: 6
      },
      store: fixture.store,
      storage: fixture.storage,
      appVersion: "6.0.0",
      schemaVersion: 6
    }),
    "schema 6 完整归档不得省略空回访 section"
  );

  const schema6Archive = buildMediaArchive({
    collection: schema6Collection,
    store: fixture.store,
    storage: fixture.storage,
    appVersion: "6.0.0",
    schemaVersion: 6
  });
  const schema6Entries = await readArchiveEntries(schema6Archive, path.join(temporaryRoot, "unpack-schema6-features"));
  const storedSchema6Collection = parseJson(schema6Entries.get(ARCHIVE_PATHS.collection));
  check(!Object.hasOwn(storedSchema6Collection, "exhibitions") && !Object.hasOwn(storedSchema6Collection, "revisits"), "功能数据不得在 collection 与独立 section 中重复保存");
  const schema6Manifest = parseJson(schema6Entries.get(ARCHIVE_PATHS.manifest));
  deepEqual(schema6Manifest.sections.slice(2), [
    { name: "exhibitions", path: ARCHIVE_PATHS.exhibitions, count: 0, required: true, version: 1 },
    { name: "revisits", path: ARCHIVE_PATHS.revisits, count: 0, required: true, version: 1 }
  ], "schema 6 full 应按注册表顺序声明两个必需功能 section");
  check(!schema6Manifest.sections.some((section) => ["entities", "voice", "capsules"].includes(section.name)), "尚无数据模型的未来功能不得提前写入 manifest");
  const schema6Prepared = await prepareMediaArchive(schema6Archive, {
    stagingRoot: path.join(temporaryRoot, "roundtrip-schema6-features")
  });
  deepEqual(schema6Prepared.exhibitions, exhibitions, "schema 6 reader 应继续暴露展览备份");
  deepEqual(schema6Prepared.revisits, revisits, "schema 6 reader 应暴露回访备份");
  deepEqual(schema6Prepared.collection.revisits, revisits, "schema 6 reader 应把回访备份重新挂回 collection");
  equal(schema6Prepared.entities, null, "V2 schema 6 归档不应被实体 section 注册影响");

  const entities = { mode: "full", schemaVersion: 7, entities: [] };
  const schema7Collection = {
    ...schema6Collection,
    version: "6.0.0",
    schemaVersion: 7,
    entities
  };
  throwsCode(
    "MEDIA_ARCHIVE_REQUIRED_SECTION_MISSING",
    () => buildMediaArchive({
      collection: {
        ...schema6Collection,
        version: "6.0.0",
        schemaVersion: 7
      },
      store: fixture.store,
      storage: fixture.storage,
      appVersion: "6.0.0",
      schemaVersion: 7
    }),
    "schema 7 完整归档不得省略空实体 section"
  );
  const schema7Archive = buildMediaArchive({
    collection: schema7Collection,
    store: fixture.store,
    storage: fixture.storage,
    appVersion: "6.0.0",
    schemaVersion: 7
  });
  const schema7Entries = await readArchiveEntries(schema7Archive, path.join(temporaryRoot, "unpack-schema7-features"));
  const schema7StoredCollection = parseJson(schema7Entries.get(ARCHIVE_PATHS.collection));
  check(!Object.hasOwn(schema7StoredCollection, "entities"), "实体线索不得在 collection 与独立 section 中重复保存");
  const schema7Manifest = parseJson(schema7Entries.get(ARCHIVE_PATHS.manifest));
  deepEqual(schema7Manifest.sections.slice(2), [
    { name: "exhibitions", path: ARCHIVE_PATHS.exhibitions, count: 0, required: true, version: 1 },
    { name: "revisits", path: ARCHIVE_PATHS.revisits, count: 0, required: true, version: 1 },
    { name: "entities", path: ARCHIVE_PATHS.entities, count: 0, required: true, version: 1 }
  ], "schema 7 full 即使实体为空也应声明三个必需功能 section");
  const schema7Prepared = await prepareMediaArchive(schema7Archive, {
    stagingRoot: path.join(temporaryRoot, "roundtrip-schema7-features")
  });
  deepEqual(schema7Prepared.entities, entities, "schema 7 reader 应暴露实体线索备份");
  deepEqual(schema7Prepared.collection.entities, entities, "schema 7 reader 应把实体线索重新挂回 collection");

  const entitySource = entityBackupSource(sourceCollection.memories[0].id);
  const nonEmptyEntities = buildClueBackup(entitySource, "full", [sourceCollection.memories[0].id]);
  const nonEmptySchema7Archive = buildMediaArchive({
    collection: { ...schema7Collection, entities: nonEmptyEntities },
    store: fixture.store,
    storage: fixture.storage,
    appVersion: "6.0.0",
    schemaVersion: 7
  });
  const nonEmptySchema7Entries = await readArchiveEntries(
    nonEmptySchema7Archive,
    path.join(temporaryRoot, "unpack-schema7-nonempty-entities")
  );
  const nonEmptySchema7Manifest = parseJson(nonEmptySchema7Entries.get(ARCHIVE_PATHS.manifest));
  deepEqual(
    nonEmptySchema7Manifest.sections.find((section) => section.name === "entities"),
    { name: "entities", path: ARCHIVE_PATHS.entities, count: 1, required: true, version: 1 },
    "schema 7 非空实体图应以可信计数写入 required section"
  );
  deepEqual(
    parseJson(nonEmptySchema7Entries.get(ARCHIVE_PATHS.entities)),
    nonEmptyEntities,
    "非空实体、别名和展品关系应无损写入独立 JSON"
  );
  const nonEmptySchema7Prepared = await prepareMediaArchive(nonEmptySchema7Archive, {
    stagingRoot: path.join(temporaryRoot, "roundtrip-schema7-nonempty-entities")
  });
  deepEqual(nonEmptySchema7Prepared.entities, nonEmptyEntities, "prepare 顶层应无损暴露非空实体图");
  deepEqual(
    nonEmptySchema7Prepared.collection.entities,
    nonEmptySchema7Prepared.entities,
    "prepared.collection.entities 与 prepared.entities 必须保持等价"
  );

  const sourceMemoryIds = sourceCollection.memories.map((memory) => memory.id);
  const emptyVoices = {
    mode: "full",
    schemaVersion: 8,
    assets: [],
    memoryLinks: [],
    transcripts: []
  };
  const validateEmptyVoices = (backup, memoryIds) => {
    deepEqual(memoryIds, sourceMemoryIds, "schema 8/9 声音校验器应收到当前归档的展品边界");
    deepEqual(backup, emptyVoices, "schema 8/9 兼容夹具只声明严格空声音备份");
    return true;
  };
  const voiceAwareStore = { ...fixture.store, validateVoiceBackup: validateEmptyVoices };
  const emptyVoiceStorage = { resolveStorageKey: () => path.join(temporaryRoot, "unused-empty-voice") };
  const schema8Collection = {
    ...schema7Collection,
    version: "6.1.0",
    schemaVersion: 8,
    voices: emptyVoices
  };
  const schema8Archive = buildMediaArchive({
    collection: schema8Collection,
    store: voiceAwareStore,
    storage: fixture.storage,
    voiceStorage: emptyVoiceStorage,
    appVersion: "6.1.0",
    schemaVersion: 8
  });
  const schema8Prepared = await prepareMediaArchive(schema8Archive, {
    stagingRoot: path.join(temporaryRoot, "roundtrip-schema8-without-capsules"),
    validateVoiceBackup: validateEmptyVoices
  });
  equal(schema8Prepared.capsules, null, "schema 8 完整归档不应被 schema 9 胶囊 section 追溯影响");
  check(
    !schema8Prepared.manifest.sections.some((section) => section.name === "capsules"),
    "schema 8 manifest 不应伪造尚未存在的胶囊 section"
  );

  throwsCode(
    "MEDIA_ARCHIVE_REQUIRED_SECTION_MISSING",
    () => buildMediaArchive({
      collection: {
        ...schema8Collection,
        version: "7.0.0",
        schemaVersion: 9
      },
      store: voiceAwareStore,
      storage: fixture.storage,
      voiceStorage: emptyVoiceStorage,
      appVersion: "7.0.0",
      schemaVersion: 9
    }),
    "schema 9 完整归档即使胶囊为空也不能省略 required capsules section"
  );

  const fullCapsules = capsuleBackupFixture(fixture.asset.id);
  const schema9Collection = {
    ...schema8Collection,
    version: "7.0.0",
    schemaVersion: 9,
    capsules: fullCapsules
  };
  const schema9Archive = buildMediaArchive({
    collection: schema9Collection,
    store: voiceAwareStore,
    storage: fixture.storage,
    voiceStorage: emptyVoiceStorage,
    appVersion: "7.0.0",
    schemaVersion: 9
  });
  const schema9Entries = await readArchiveEntries(
    schema9Archive,
    path.join(temporaryRoot, "unpack-schema9-capsules")
  );
  const schema9Manifest = parseJson(schema9Entries.get(ARCHIVE_PATHS.manifest));
  deepEqual(
    schema9Manifest.sections.find((section) => section.name === "capsules"),
    { name: "capsules", path: ARCHIVE_PATHS.capsules, count: 1, required: true, version: 1 },
    "schema 9 非空胶囊应以可信计数写入 required section"
  );
  const capsuleBytes = schema9Entries.get(ARCHIVE_PATHS.capsules);
  const capsuleEntry = schema9Manifest.entries.find((entry) => entry.path === ARCHIVE_PATHS.capsules);
  equal(capsuleEntry.bytes, capsuleBytes.length, "胶囊 section 字节数应写入 manifest");
  equal(capsuleEntry.sha256, sha256(capsuleBytes), "胶囊 section SHA-256 应覆盖精确归档字节");
  deepEqual(parseJson(capsuleBytes), fullCapsules, "胶囊外壳、安全快照与图片链接应无损写入独立 JSON");
  check(!capsuleBytes.toString("utf8").includes("payload_sha256"), "胶囊私有 payload hash 不得进入 .time-isle");

  const schema9Prepared = await prepareMediaArchive(schema9Archive, {
    stagingRoot: path.join(temporaryRoot, "roundtrip-schema9-capsules"),
    validateVoiceBackup: validateEmptyVoices
  });
  deepEqual(schema9Prepared.capsules, fullCapsules, "prepare 顶层应无损暴露非空胶囊备份");
  deepEqual(schema9Prepared.collection.capsules, fullCapsules, "prepare 应把胶囊备份重新挂回 collection");
  deepEqual(schema9Prepared.collection.capsules, schema9Prepared.capsules, "胶囊的两个 prepared 入口必须等价");

  const missingCapsules = cloneEntries(schema9Entries);
  const missingCapsulesManifest = parseJson(missingCapsules.get(ARCHIVE_PATHS.manifest));
  missingCapsulesManifest.sections = missingCapsulesManifest.sections.filter((section) => section.name !== "capsules");
  missingCapsulesManifest.entries = missingCapsulesManifest.entries.filter((entry) => entry.path !== ARCHIVE_PATHS.capsules);
  missingCapsulesManifest.entryCount = missingCapsulesManifest.entries.length;
  missingCapsules.delete(ARCHIVE_PATHS.capsules);
  missingCapsules.set(ARCHIVE_PATHS.manifest, jsonBuffer(missingCapsulesManifest));
  await rejectsCode(
    "MEDIA_ARCHIVE_REQUIRED_SECTION_MISSING",
    () => prepareMediaArchive(repack(missingCapsules), {
      stagingRoot: path.join(temporaryRoot, "reject-missing-schema9-capsules"),
      validateVoiceBackup: validateEmptyVoices
    }),
    "schema 9 full reader 不得把缺失胶囊 section 静默降级为空"
  );

  const corruptCapsules = cloneEntries(schema9Entries);
  const corruptCapsuleBytes = Buffer.from(corruptCapsules.get(ARCHIVE_PATHS.capsules));
  corruptCapsuleBytes[corruptCapsuleBytes.length - 2] ^= 0x01;
  corruptCapsules.set(ARCHIVE_PATHS.capsules, corruptCapsuleBytes);
  await rejectsCode(
    "MEDIA_ARCHIVE_HASH_MISMATCH",
    () => prepareMediaArchive(repack(corruptCapsules), {
      stagingRoot: path.join(temporaryRoot, "reject-corrupt-schema9-capsules"),
      validateVoiceBackup: validateEmptyVoices
    }),
    "胶囊 section 任一字节被篡改时必须在返回 prepared 前拒绝"
  );

  const redactedCapsules = {
    mode: "redacted-summary",
    capsuleCount: 2,
    mediaLinkCount: 1,
    note: "胶囊标题、日期、时区、来源、内容快照、图片关联和内部 ID 已物理移除。"
  };
  const redactedCapsuleArchive = buildMediaArchive({
    collection: {
      ...sourceCollection,
      version: "7.0.0",
      schemaVersion: 9,
      mode: "redacted",
      memories: sourceCollection.memories.map((memory) => ({
        ...memory,
        rawContent: "[已隐藏原始记忆]",
        media: [],
        attachments: [],
        coverImage: ""
      })),
      capsules: redactedCapsules
    },
    appVersion: "7.0.0",
    schemaVersion: 9
  });
  const redactedCapsuleEntries = await readArchiveEntries(
    redactedCapsuleArchive,
    path.join(temporaryRoot, "unpack-redacted-schema9-capsules")
  );
  deepEqual(
    [...redactedCapsuleEntries.keys()].sort(),
    [ARCHIVE_PATHS.collection, ARCHIVE_PATHS.capsules, ARCHIVE_PATHS.manifest].sort(),
    "schema 9 脱敏胶囊归档只增加 count-only JSON 摘要"
  );
  const redactedCapsuleManifest = parseJson(redactedCapsuleEntries.get(ARCHIVE_PATHS.manifest));
  deepEqual(
    redactedCapsuleManifest.sections.find((section) => section.name === "capsules"),
    { name: "capsules", path: ARCHIVE_PATHS.capsules, count: 2, required: false, version: 1 },
    "脱敏胶囊 section 应为 optional 且只公开可信总数"
  );
  const redactedCapsuleBytes = redactedCapsuleEntries.get(ARCHIVE_PATHS.capsules).toString("utf8");
  deepEqual(
    Object.keys(JSON.parse(redactedCapsuleBytes)).sort(),
    ["capsuleCount", "mediaLinkCount", "mode", "note"],
    "脱敏胶囊 section 字段集合必须精确限制为两个计数、模式与固定说明"
  );
  for (const canary of capsuleCanaries(fullCapsules)) {
    check(!redactedCapsuleBytes.includes(canary), `脱敏胶囊 section 应物理排除 ${canary}`);
  }
  check(!/[a-f0-9]{64}/iu.test(redactedCapsuleBytes), "脱敏胶囊 section 不得包含 payload 或媒体 SHA-256");
  const redactedCapsulePrepared = await prepareMediaArchive(redactedCapsuleArchive, {
    stagingRoot: path.join(temporaryRoot, "roundtrip-redacted-schema9-capsules")
  });
  deepEqual(redactedCapsulePrepared.capsules, redactedCapsules, "prepare 应只暴露脱敏胶囊计数摘要");
  deepEqual(redactedCapsulePrepared.collection.capsules, redactedCapsules, "脱敏胶囊摘要应安全重挂回 collection");

  const leakyCapsuleSummary = cloneEntries(redactedCapsuleEntries);
  const leakyCapsulePayload = parseJson(leakyCapsuleSummary.get(ARCHIVE_PATHS.capsules));
  leakyCapsulePayload.note = `capsule-archive-canary，2040-02-29，${fixture.asset.id}`;
  replaceJsonAndRefreshManifest(leakyCapsuleSummary, ARCHIVE_PATHS.capsules, leakyCapsulePayload);
  await rejectsCode(
    "MEDIA_ARCHIVE_FEATURE_INVALID",
    () => prepareMediaArchive(repack(leakyCapsuleSummary), {
      stagingRoot: path.join(temporaryRoot, "reject-leaky-redacted-capsule-note")
    }),
    "即使重算 manifest 哈希，脱敏胶囊固定说明也不能夹带 ID、日期或媒体引用"
  );

  throwsCode(
    "MEDIA_ARCHIVE_FEATURE_INVALID",
    () => buildMediaArchive({
      collection: {
        ...sourceCollection,
        version: "7.0.0",
        schemaVersion: 9,
        mode: "redacted",
        capsules: { ...redactedCapsules, capsules: fullCapsules.capsules }
      },
      appVersion: "7.0.0",
      schemaVersion: 9
    }),
    "脱敏胶囊摘要不得夹带完整胶囊数组"
  );

  const redactedExhibitions = {
    mode: "redacted-summary",
    exhibitionCount: 2,
    publishedCount: 1,
    note: "展览内容已移除。"
  };
  const redactedRevisits = {
    mode: "redacted-summary",
    stateCount: 2,
    viewedCount: 1,
    dismissedCount: 1,
    note: "逐条回访状态已移除。"
  };
  const redactedArchive = buildMediaArchive({
    collection: {
      ...schema6Collection,
      mode: "redacted",
      exhibitions: redactedExhibitions,
      revisits: redactedRevisits
    },
    appVersion: "6.0.0",
    schemaVersion: 6
  });
  const redactedEntries = await readArchiveEntries(redactedArchive, path.join(temporaryRoot, "unpack-redacted-features"));
  deepEqual([...redactedEntries.keys()].sort(), [
    ARCHIVE_PATHS.collection,
    ARCHIVE_PATHS.exhibitions,
    ARCHIVE_PATHS.manifest,
    ARCHIVE_PATHS.revisits
  ].sort(), "schema 6 脱敏归档只应增加两个 JSON 摘要条目");
  const redactedManifest = parseJson(redactedEntries.get(ARCHIVE_PATHS.manifest));
  deepEqual(redactedManifest.sections.slice(2), [
    { name: "exhibitions", path: ARCHIVE_PATHS.exhibitions, count: 2, required: false, version: 1 },
    { name: "revisits", path: ARCHIVE_PATHS.revisits, count: 2, required: false, version: 1 }
  ], "脱敏功能 section 应为可选摘要并保留可信计数");
  const redactedRevisitBytes = redactedEntries.get(ARCHIVE_PATHS.revisits).toString("utf8");
  deepEqual(
    Object.keys(parseJson(redactedEntries.get(ARCHIVE_PATHS.revisits))).sort(),
    ["dismissedCount", "mode", "note", "stateCount", "viewedCount"],
    "脱敏回访 section 只允许集合计数与说明字段"
  );
  check(
    !/["'](?:memoryId|lastViewedAt|lastDismissedAt|states)["']/.test(redactedRevisitBytes)
      && !/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(redactedRevisitBytes),
    "脱敏回访 section 不得包含展品 ID、精确时间或逐条状态"
  );
  const redactedPrepared = await prepareMediaArchive(redactedArchive, {
    stagingRoot: path.join(temporaryRoot, "roundtrip-redacted-features")
  });
  deepEqual(redactedPrepared.exhibitions, redactedExhibitions, "脱敏展览摘要应在验真后重新挂载");
  deepEqual(redactedPrepared.revisits, redactedRevisits, "脱敏回访摘要应在验真后重新挂载");
  check(!Object.hasOwn(redactedPrepared.revisits, "states") && !Object.hasOwn(redactedPrepared.exhibitions, "exhibitions"), "脱敏功能 section 不得包含完整记录数组");

  const redactedEntities = buildClueBackup(entitySource, "redacted", [sourceCollection.memories[0].id]);
  const redactedSchema7Archive = buildMediaArchive({
    collection: {
      ...schema7Collection,
      mode: "redacted",
      exhibitions: redactedExhibitions,
      revisits: redactedRevisits,
      entities: redactedEntities
    },
    appVersion: "6.0.0",
    schemaVersion: 7
  });
  const redactedSchema7Entries = await readArchiveEntries(redactedSchema7Archive, path.join(temporaryRoot, "unpack-redacted-schema7"));
  const redactedEntityBytes = redactedSchema7Entries.get(ARCHIVE_PATHS.entities).toString("utf8");
  deepEqual(
    Object.keys(parseJson(redactedSchema7Entries.get(ARCHIVE_PATHS.entities))).sort(),
    ["entityCount", "locationCount", "mode", "note", "personCount", "themeCount"],
    "脱敏实体 section 只允许分类计数与说明字段"
  );
  check(
    !/(?:canonicalName|alias|entityId|memoryId|confirmedAt|createdAt|updatedAt)/.test(redactedEntityBytes)
      && !/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(redactedEntityBytes)
      && !["林岚", "岚姨", "entity-archive-person", "alias-archive-person", sourceCollection.memories[0].id]
        .some((secret) => redactedEntityBytes.includes(secret)),
    "脱敏实体 section 不得包含名称、ID、关系或精确时间"
  );
  const redactedSchema7Prepared = await prepareMediaArchive(redactedSchema7Archive, {
    stagingRoot: path.join(temporaryRoot, "roundtrip-redacted-schema7")
  });
  deepEqual(redactedSchema7Prepared.entities, redactedEntities, "脱敏实体摘要应在验真后重新挂载");
  deepEqual(redactedSchema7Prepared.collection.entities, redactedSchema7Prepared.entities, "脱敏实体摘要的两处 prepared 入口应等价");

  const leakyEntitySummary = cloneEntries(redactedSchema7Entries);
  const leakyEntityPayload = parseJson(leakyEntitySummary.get(ARCHIVE_PATHS.entities));
  leakyEntityPayload.note = "林岚（岚姨），entity-archive-person，2026-07-16T00:00:00.000Z";
  replaceJsonAndRefreshManifest(leakyEntitySummary, ARCHIVE_PATHS.entities, leakyEntityPayload);
  await rejectsCode(
    "MEDIA_ARCHIVE_FEATURE_INVALID",
    () => prepareMediaArchive(repack(leakyEntitySummary), {
      stagingRoot: path.join(temporaryRoot, "reject-leaky-redacted-entity-note")
    }),
    "即使重新计算哈希，脱敏实体摘要也不能借 note 夹带名称、ID 或精确时间"
  );

  const leakedRedactedFeature = cloneEntries(redactedEntries);
  const leakedRevisits = parseJson(leakedRedactedFeature.get(ARCHIVE_PATHS.revisits));
  leakedRevisits.states = [];
  replaceJsonAndRefreshManifest(leakedRedactedFeature, ARCHIVE_PATHS.revisits, leakedRevisits);
  await rejectsCode(
    "MEDIA_ARCHIVE_FEATURE_INVALID",
    () => prepareMediaArchive(repack(leakedRedactedFeature), { stagingRoot: path.join(temporaryRoot, "reject-redacted-feature-leak") }),
    "即使哈希已重算，脱敏功能 section 也不得夹带完整记录字段"
  );

  const summarylessArchive = buildMediaArchive({
    collection: {
      ...sourceCollection,
      version: "6.0.0",
      schemaVersion: 6,
      mode: "redacted"
    },
    appVersion: "6.0.0",
    schemaVersion: 6
  });
  const summarylessPrepared = await prepareMediaArchive(summarylessArchive, {
    stagingRoot: path.join(temporaryRoot, "roundtrip-summaryless-features")
  });
  equal(summarylessPrepared.exhibitions, null, "缺席的脱敏可选展览摘要不应被伪造");
  equal(summarylessPrepared.revisits, null, "缺席的脱敏可选回访摘要不应被伪造");

  const countMismatch = cloneEntries(schema6Entries);
  const countMismatchManifest = parseJson(countMismatch.get(ARCHIVE_PATHS.manifest));
  countMismatchManifest.sections.find((section) => section.name === "revisits").count = 1;
  countMismatch.set(ARCHIVE_PATHS.manifest, jsonBuffer(countMismatchManifest));
  await rejectsCode(
    "MEDIA_ARCHIVE_SECTIONS_INVALID",
    () => prepareMediaArchive(repack(countMismatch), { stagingRoot: path.join(temporaryRoot, "reject-feature-count") }),
    "功能 section 声明计数必须与已验真 JSON 内容一致"
  );

  const wrongPath = cloneEntries(schema6Entries);
  const wrongPathManifest = parseJson(wrongPath.get(ARCHIVE_PATHS.manifest));
  wrongPathManifest.sections.find((section) => section.name === "revisits").path = "revisits/wrong.json";
  wrongPath.set(ARCHIVE_PATHS.manifest, jsonBuffer(wrongPathManifest));
  await rejectsCode(
    "MEDIA_ARCHIVE_SECTIONS_INVALID",
    () => prepareMediaArchive(repack(wrongPath), { stagingRoot: path.join(temporaryRoot, "reject-feature-path") }),
    "已知功能 section 不得更换注册路径"
  );

  const wrongVersion = cloneEntries(schema6Entries);
  const wrongVersionManifest = parseJson(wrongVersion.get(ARCHIVE_PATHS.manifest));
  wrongVersionManifest.sections.find((section) => section.name === "revisits").version = 2;
  wrongVersion.set(ARCHIVE_PATHS.manifest, jsonBuffer(wrongVersionManifest));
  await rejectsCode(
    "MEDIA_ARCHIVE_SECTIONS_INVALID",
    () => prepareMediaArchive(repack(wrongVersion), { stagingRoot: path.join(temporaryRoot, "reject-feature-version") }),
    "不受支持的功能 section 版本必须整包拒绝"
  );

  const corruptFeature = cloneEntries(schema6Entries);
  const corruptBytes = Buffer.from(corruptFeature.get(ARCHIVE_PATHS.revisits));
  corruptBytes[corruptBytes.length - 2] ^= 0x01;
  corruptFeature.set(ARCHIVE_PATHS.revisits, corruptBytes);
  await rejectsCode(
    "MEDIA_ARCHIVE_HASH_MISMATCH",
    () => prepareMediaArchive(repack(corruptFeature), { stagingRoot: path.join(temporaryRoot, "reject-feature-hash") }),
    "功能 section 字节被篡改时必须先于业务恢复拒绝"
  );

  const missingRequired = cloneEntries(schema6Entries);
  const missingRequiredManifest = parseJson(missingRequired.get(ARCHIVE_PATHS.manifest));
  missingRequiredManifest.sections = missingRequiredManifest.sections.filter((section) => section.name !== "revisits");
  missingRequiredManifest.entries = missingRequiredManifest.entries.filter((entry) => entry.path !== ARCHIVE_PATHS.revisits);
  missingRequiredManifest.entryCount = missingRequiredManifest.entries.length;
  missingRequired.delete(ARCHIVE_PATHS.revisits);
  missingRequired.set(ARCHIVE_PATHS.manifest, jsonBuffer(missingRequiredManifest));
  await rejectsCode(
    "MEDIA_ARCHIVE_REQUIRED_SECTION_MISSING",
    () => prepareMediaArchive(repack(missingRequired), { stagingRoot: path.join(temporaryRoot, "reject-missing-feature") }),
    "schema 6 full 缺少回访 section 时不得静默降级恢复"
  );

  const missingRequiredEntities = cloneEntries(schema7Entries);
  const missingRequiredEntitiesManifest = parseJson(missingRequiredEntities.get(ARCHIVE_PATHS.manifest));
  missingRequiredEntitiesManifest.sections = missingRequiredEntitiesManifest.sections.filter((section) => section.name !== "entities");
  missingRequiredEntitiesManifest.entries = missingRequiredEntitiesManifest.entries.filter((entry) => entry.path !== ARCHIVE_PATHS.entities);
  missingRequiredEntitiesManifest.entryCount = missingRequiredEntitiesManifest.entries.length;
  missingRequiredEntities.delete(ARCHIVE_PATHS.entities);
  missingRequiredEntities.set(ARCHIVE_PATHS.manifest, jsonBuffer(missingRequiredEntitiesManifest));
  await rejectsCode(
    "MEDIA_ARCHIVE_REQUIRED_SECTION_MISSING",
    () => prepareMediaArchive(repack(missingRequiredEntities), {
      stagingRoot: path.join(temporaryRoot, "reject-missing-entities-feature")
    }),
    "schema 7 full 即使实体为空也不能省略 required entities section"
  );

  const duplicatedFeature = cloneEntries(schema6Entries);
  const duplicatedCollection = parseJson(duplicatedFeature.get(ARCHIVE_PATHS.collection));
  duplicatedCollection.revisits = revisits;
  replaceJsonAndRefreshManifest(duplicatedFeature, ARCHIVE_PATHS.collection, duplicatedCollection);
  await rejectsCode(
    "MEDIA_ARCHIVE_SECTIONS_INVALID",
    () => prepareMediaArchive(repack(duplicatedFeature), { stagingRoot: path.join(temporaryRoot, "reject-duplicated-feature") }),
    "collection 与独立 section 中重复的功能数据必须拒绝"
  );

  const legacySchema5 = cloneEntries(schema5Entries);
  const legacyCollection = parseJson(legacySchema5.get(ARCHIVE_PATHS.collection));
  legacyCollection.exhibitions = parseJson(legacySchema5.get(ARCHIVE_PATHS.exhibitions));
  legacySchema5.set(ARCHIVE_PATHS.collection, jsonBuffer(legacyCollection));
  legacySchema5.delete(ARCHIVE_PATHS.exhibitions);
  const legacyManifest = parseJson(legacySchema5.get(ARCHIVE_PATHS.manifest));
  legacyManifest.formatVersion = 1;
  delete legacyManifest.sections;
  legacyManifest.entries = legacyManifest.entries.filter((entry) => entry.path !== ARCHIVE_PATHS.exhibitions);
  const legacyCollectionEntry = legacyManifest.entries.find((entry) => entry.path === ARCHIVE_PATHS.collection);
  const legacyCollectionBytes = legacySchema5.get(ARCHIVE_PATHS.collection);
  legacyCollectionEntry.bytes = legacyCollectionBytes.length;
  legacyCollectionEntry.sha256 = sha256(legacyCollectionBytes);
  legacyManifest.entryCount = legacyManifest.entries.length;
  legacySchema5.set(ARCHIVE_PATHS.manifest, jsonBuffer(legacyManifest));
  const legacyPrepared = await prepareMediaArchive(repack(legacySchema5), {
    stagingRoot: path.join(temporaryRoot, "roundtrip-inline-v1-feature")
  });
  deepEqual(legacyPrepared.exhibitions, exhibitions, "V1 内联展览备份应继续兼容并在顶层暴露");
  deepEqual(legacyPrepared.collection.exhibitions, exhibitions, "V1 内联展览备份应保留原 collection 结构");

  const legacySchema6 = cloneEntries(schema6Entries);
  const legacySchema6Collection = parseJson(legacySchema6.get(ARCHIVE_PATHS.collection));
  legacySchema6Collection.exhibitions = parseJson(legacySchema6.get(ARCHIVE_PATHS.exhibitions));
  legacySchema6Collection.revisits = parseJson(legacySchema6.get(ARCHIVE_PATHS.revisits));
  legacySchema6.set(ARCHIVE_PATHS.collection, jsonBuffer(legacySchema6Collection));
  legacySchema6.delete(ARCHIVE_PATHS.exhibitions);
  legacySchema6.delete(ARCHIVE_PATHS.revisits);
  const legacySchema6Manifest = parseJson(legacySchema6.get(ARCHIVE_PATHS.manifest));
  legacySchema6Manifest.formatVersion = 1;
  delete legacySchema6Manifest.sections;
  legacySchema6Manifest.entries = legacySchema6Manifest.entries.filter((entry) => (
    entry.path !== ARCHIVE_PATHS.exhibitions && entry.path !== ARCHIVE_PATHS.revisits
  ));
  const legacySchema6CollectionEntry = legacySchema6Manifest.entries.find((entry) => entry.path === ARCHIVE_PATHS.collection);
  const legacySchema6CollectionBytes = legacySchema6.get(ARCHIVE_PATHS.collection);
  legacySchema6CollectionEntry.bytes = legacySchema6CollectionBytes.length;
  legacySchema6CollectionEntry.sha256 = sha256(legacySchema6CollectionBytes);
  legacySchema6Manifest.entryCount = legacySchema6Manifest.entries.length;
  legacySchema6.set(ARCHIVE_PATHS.manifest, jsonBuffer(legacySchema6Manifest));
  const legacySchema6Prepared = await prepareMediaArchive(repack(legacySchema6), {
    stagingRoot: path.join(temporaryRoot, "roundtrip-inline-v1-revisit")
  });
  deepEqual(legacySchema6Prepared.collection.exhibitions, exhibitions, "V1 schema 6 仍能读取内联展览备份");
  deepEqual(legacySchema6Prepared.collection.revisits, revisits, "V1 schema 6 仍能读取内联回访备份");

  const incompleteLegacySchema6 = cloneEntries(legacySchema6);
  const incompleteLegacyCollection = parseJson(incompleteLegacySchema6.get(ARCHIVE_PATHS.collection));
  delete incompleteLegacyCollection.revisits;
  replaceJsonAndRefreshManifest(incompleteLegacySchema6, ARCHIVE_PATHS.collection, incompleteLegacyCollection);
  await rejectsCode(
    "MEDIA_ARCHIVE_REQUIRED_SECTION_MISSING",
    () => prepareMediaArchive(repack(incompleteLegacySchema6), {
      stagingRoot: path.join(temporaryRoot, "reject-incomplete-v1-revisit")
    }),
    "V1 schema 6 full 缺少内联回访备份时也不得静默丢失状态"
  );

  const legacySchema7 = cloneEntries(nonEmptySchema7Entries);
  const legacySchema7Collection = parseJson(legacySchema7.get(ARCHIVE_PATHS.collection));
  legacySchema7Collection.exhibitions = parseJson(legacySchema7.get(ARCHIVE_PATHS.exhibitions));
  legacySchema7Collection.revisits = parseJson(legacySchema7.get(ARCHIVE_PATHS.revisits));
  legacySchema7Collection.entities = parseJson(legacySchema7.get(ARCHIVE_PATHS.entities));
  legacySchema7.set(ARCHIVE_PATHS.collection, jsonBuffer(legacySchema7Collection));
  legacySchema7.delete(ARCHIVE_PATHS.exhibitions);
  legacySchema7.delete(ARCHIVE_PATHS.revisits);
  legacySchema7.delete(ARCHIVE_PATHS.entities);
  const legacySchema7Manifest = parseJson(legacySchema7.get(ARCHIVE_PATHS.manifest));
  legacySchema7Manifest.formatVersion = 1;
  delete legacySchema7Manifest.sections;
  legacySchema7Manifest.entries = legacySchema7Manifest.entries.filter((entry) => ![
    ARCHIVE_PATHS.exhibitions,
    ARCHIVE_PATHS.revisits,
    ARCHIVE_PATHS.entities
  ].includes(entry.path));
  const legacySchema7CollectionEntry = legacySchema7Manifest.entries.find((entry) => entry.path === ARCHIVE_PATHS.collection);
  const legacySchema7CollectionBytes = legacySchema7.get(ARCHIVE_PATHS.collection);
  legacySchema7CollectionEntry.bytes = legacySchema7CollectionBytes.length;
  legacySchema7CollectionEntry.sha256 = sha256(legacySchema7CollectionBytes);
  legacySchema7Manifest.entryCount = legacySchema7Manifest.entries.length;
  legacySchema7.set(ARCHIVE_PATHS.manifest, jsonBuffer(legacySchema7Manifest));
  const legacySchema7Prepared = await prepareMediaArchive(repack(legacySchema7), {
    stagingRoot: path.join(temporaryRoot, "roundtrip-inline-v1-entities")
  });
  deepEqual(legacySchema7Prepared.entities, nonEmptyEntities, "V1 schema 7 仍能在顶层暴露内联非空实体图");
  deepEqual(legacySchema7Prepared.collection.entities, nonEmptyEntities, "V1 schema 7 仍能读取内联非空实体线索备份");

  const incompleteLegacySchema7 = cloneEntries(legacySchema7);
  const incompleteLegacySchema7Collection = parseJson(incompleteLegacySchema7.get(ARCHIVE_PATHS.collection));
  delete incompleteLegacySchema7Collection.entities;
  replaceJsonAndRefreshManifest(incompleteLegacySchema7, ARCHIVE_PATHS.collection, incompleteLegacySchema7Collection);
  await rejectsCode(
    "MEDIA_ARCHIVE_REQUIRED_SECTION_MISSING",
    () => prepareMediaArchive(repack(incompleteLegacySchema7), {
      stagingRoot: path.join(temporaryRoot, "reject-incomplete-v1-entities")
    }),
    "V1 schema 7 full 缺少内联实体备份时也不得静默丢失线索"
  );
}

async function checkArchiveLimits(temporaryRoot, fixture, fullCollection) {
  const fiveHundred = boundaryCollection(MEDIA_ARCHIVE_LIMITS.maxMemories);
  const fiveHundredArchive = buildMediaArchive({
    collection: fiveHundred,
    appVersion: "4.0.0",
    schemaVersion: 4
  });
  check(Buffer.isBuffer(fiveHundredArchive), "默认导出上限应接受恰好 500 件展品");
  const fiveHundredPrepared = await prepareMediaArchive(fiveHundredArchive, {
    stagingRoot: path.join(temporaryRoot, "roundtrip-500")
  });
  equal(fiveHundredPrepared.collection.memories.length, 500, "默认 prepare 上限应接受恰好 500 件展品");

  const fiveHundredOne = boundaryCollection(MEDIA_ARCHIVE_LIMITS.maxMemories + 1);
  throwsCode(
    "MEDIA_ARCHIVE_LIMIT_EXCEEDED",
    () => buildMediaArchive({ collection: fiveHundredOne, appVersion: "4.0.0", schemaVersion: 4 }),
    "默认导出必须在打包前拒绝第 501 件展品"
  );
  throwsCode(
    "MEDIA_ARCHIVE_VALUE_INVALID",
    () => buildMediaArchive({
      collection: fiveHundred,
      appVersion: "4.0.0",
      schemaVersion: 4,
      limits: { maxMemories: 501 }
    }),
    "调用者不能抬高共享发布上限制造默认不可恢复的归档"
  );
  const permissiveArchive = createUncheckedRedactedArchive(fiveHundredOne);
  const rejected501Root = path.join(temporaryRoot, "reject-prepare-501");
  await rejectsCode(
    "MEDIA_ARCHIVE_LIMIT_EXCEEDED",
    () => prepareMediaArchive(permissiveArchive, { stagingRoot: rejected501Root }),
    "默认 prepare 必须拒绝包含 501 件展品的自校验归档"
  );
  equal(fs.existsSync(rejected501Root), false, "501 件归档被拒绝后不应残留暂存目录");

  for (const [name, value, message] of [
    ["maxAssets", 0, "导出前应拒绝超限媒体资产"],
    ["maxLinks", 1, "导出前应拒绝超限媒体关联"],
    ["maxObservations", 0, "导出前应拒绝超限图片线索"]
  ]) {
    throwsCode(
      "MEDIA_ARCHIVE_LIMIT_EXCEEDED",
      () => buildMediaArchive({
        collection: fullCollection,
        store: fixture.store,
        storage: fixture.storage,
        appVersion: "4.0.0",
        schemaVersion: 4,
        limits: { [name]: value }
      }),
      message
    );
  }

  const oneMemory = boundaryCollection(1);
  const baseline = buildMediaArchive({ collection: oneMemory, appVersion: "4.0.0", schemaVersion: 4 });
  const baselineEntries = await readArchiveEntries(baseline, path.join(temporaryRoot, "measure-export-limits"));
  const largestEntryBytes = Math.max(...[...baselineEntries.values()].map((data) => data.length));
  const totalEntryBytes = [...baselineEntries.values()].reduce((sum, data) => sum + data.length, 0);
  check(Buffer.isBuffer(buildMediaArchive({
    collection: oneMemory,
    appVersion: "4.0.0",
    schemaVersion: 4,
    limits: { maxEntryBytes: largestEntryBytes, maxTotalBytes: totalEntryBytes }
  })), "导出应接受恰好命中单项与总字节边界的归档");
  throwsCode(
    "MEDIA_ARCHIVE_LIMIT_EXCEEDED",
    () => buildMediaArchive({
      collection: oneMemory,
      appVersion: "4.0.0",
      schemaVersion: 4,
      limits: { maxEntryBytes: largestEntryBytes - 1 }
    }),
    "导出应在压缩前拒绝超过单项字节边界的归档"
  );
  throwsCode(
    "MEDIA_ARCHIVE_LIMIT_EXCEEDED",
    () => buildMediaArchive({
      collection: oneMemory,
      appVersion: "4.0.0",
      schemaVersion: 4,
      limits: { maxTotalBytes: totalEntryBytes - 1 }
    }),
    "导出应在压缩前拒绝超过总字节边界的归档"
  );
  throwsCode(
    "MEDIA_ARCHIVE_LIMIT_EXCEEDED",
    () => buildMediaArchive({
      collection: oneMemory,
      appVersion: "4.0.0",
      schemaVersion: 4,
      limits: { maxEntries: 1 }
    }),
    "导出应在压缩前拒绝超过条目数边界的归档"
  );
}

async function checkObservationPrivacy(temporaryRoot, fixture, collection, pristineEntries) {
  const invalidGpsStore = {
    ...fixture.store,
    listMediaObservations({ assetId }) {
      return fixture.observations.filter((item) => item.assetId === assetId).map((item, index) => (
        index === 0
          ? {
              ...item,
              kind: "gps_location",
              source: "exif",
              status: "suggested",
              sensitive: false,
              value: { latitude: 31.2, longitude: 121.5 }
            }
          : item
      ));
    }
  };
  throwsCode(
    "MEDIA_ARCHIVE_OBSERVATION_PRIVACY_INVALID",
    () => buildMediaArchive({
      collection,
      store: invalidGpsStore,
      storage: fixture.storage,
      appVersion: "4.0.0",
      schemaVersion: 4
    }),
    "导出不能把伪装成普通线索的 GPS 坐标写入归档"
  );

  const maliciousGpsEntries = cloneEntries(pristineEntries);
  const maliciousGps = parseJson(maliciousGpsEntries.get(ARCHIVE_PATHS.observations));
  Object.assign(maliciousGps[0], {
    kind: "gps_location",
    source: "exif",
    status: "suggested",
    sensitive: false,
    value: { latitude: 31.2, longitude: 121.5 }
  });
  replaceJsonAndRefreshManifest(maliciousGpsEntries, ARCHIVE_PATHS.observations, maliciousGps);
  const maliciousGpsRoot = path.join(temporaryRoot, "reject-self-verified-gps");
  await rejectsCode(
    "MEDIA_ARCHIVE_OBSERVATION_PRIVACY_INVALID",
    () => prepareMediaArchive(repack(maliciousGpsEntries), { stagingRoot: maliciousGpsRoot }),
    "哈希正确的恶意 GPS 归档仍必须在 prepare 阶段被拒绝"
  );
  equal(fs.existsSync(maliciousGpsRoot), false, "恶意 GPS 归档被拒绝后不得残留暂存文件");

  const sanitizedFixture = createFixture(temporaryRoot, {
    privacyMode: "sanitized_only",
    suffix: "sanitized"
  });
  const sanitizedArchive = buildMediaArchive({
    collection,
    store: sanitizedFixture.store,
    storage: sanitizedFixture.storage,
    appVersion: "4.0.0",
    schemaVersion: 4
  });
  const invalidSensitiveExifStore = {
    ...sanitizedFixture.store,
    listMediaObservations({ assetId }) {
      return sanitizedFixture.observations.filter((item) => item.assetId === assetId).map((item, index) => (
        index === 0
          ? {
              ...item,
              kind: "gps_coordinates",
              source: "exif",
              status: "suggested",
              sensitive: true,
              value: { latitude: 31.2, longitude: 121.5 }
            }
          : item
      ));
    }
  };
  throwsCode(
    "MEDIA_ARCHIVE_OBSERVATION_PRIVACY_INVALID",
    () => buildMediaArchive({
      collection,
      store: invalidSensitiveExifStore,
      storage: sanitizedFixture.storage,
      appVersion: "4.0.0",
      schemaVersion: 4
    }),
    "仅保留安全展示图的导出必须拒绝全部敏感 EXIF 线索"
  );
  const sanitizedEntries = await readArchiveEntries(
    sanitizedArchive,
    path.join(temporaryRoot, "unpack-sanitized-privacy")
  );
  const maliciousExif = parseJson(sanitizedEntries.get(ARCHIVE_PATHS.observations));
  Object.assign(maliciousExif[0], {
    kind: "gps_coordinates",
    source: "exif",
    status: "suggested",
    sensitive: true,
    value: { latitude: 31.2, longitude: 121.5 }
  });
  replaceJsonAndRefreshManifest(sanitizedEntries, ARCHIVE_PATHS.observations, maliciousExif);
  await rejectsCode(
    "MEDIA_ARCHIVE_OBSERVATION_PRIVACY_INVALID",
    () => prepareMediaArchive(repack(sanitizedEntries), {
      stagingRoot: path.join(temporaryRoot, "reject-self-verified-sensitive-exif")
    }),
    "哈希正确的 sanitized-only 敏感 EXIF 归档仍必须被拒绝"
  );

  const sevenExportStore = {
    ...fixture.store,
    listMediaForMemory(memoryId) {
      const media = fixture.store.listMediaForMemory(memoryId);
      return memoryId === "memory-one" && media.length ? Array.from({ length: 7 }, () => ({ ...media[0] })) : media;
    }
  };
  throwsCode(
    "MEDIA_ARCHIVE_LIMIT_EXCEEDED",
    () => buildMediaArchive({
      collection,
      store: sevenExportStore,
      storage: fixture.storage,
      appVersion: "4.0.0",
      schemaVersion: 4
    }),
    "归档导出不能绕过单展品六图上限"
  );
  await rejectSevenLinkArchive(temporaryRoot, pristineEntries);
}

async function rejectSevenLinkArchive(temporaryRoot, pristineEntries) {
  const entries = cloneEntries(pristineEntries);
  const assets = parseJson(entries.get(ARCHIVE_PATHS.assets));
  const sourceAsset = assets[0];
  const expandedAssets = [sourceAsset];
  for (let index = 2; index <= 7; index += 1) {
    const clone = JSON.parse(JSON.stringify(sourceAsset));
    clone.id = `asset-seven-link-${index}`;
    for (const variant of clone.variants) {
      const sourcePath = variant.archivePath;
      variant.assetId = clone.id;
      variant.archivePath = sourcePath.replace(`/${sourceAsset.id}/`, `/${clone.id}/`);
      entries.set(variant.archivePath, Buffer.from(entries.get(sourcePath)));
    }
    expandedAssets.push(clone);
  }
  const links = expandedAssets.map((asset, index) => ({
    ...link("memory-one", asset.id, `边界照片 ${index + 1}`),
    role: index === 0 ? "cover" : "gallery",
    position: index
  }));
  entries.set(ARCHIVE_PATHS.assets, jsonBuffer(expandedAssets));
  entries.set(ARCHIVE_PATHS.links, jsonBuffer(links));
  entries.set(ARCHIVE_PATHS.observations, jsonBuffer([]));
  refreshWholeManifest(entries, {
    assetCount: expandedAssets.length,
    linkCount: links.length,
    observationCount: 0
  });
  await rejectsCode(
    "MEDIA_ARCHIVE_LINK_ORDER_INVALID",
    () => prepareMediaArchive(repack(entries), {
      stagingRoot: path.join(temporaryRoot, "reject-seven-links")
    }),
    "归档 link validator 必须使用同一六图常量拒绝第七张"
  );
}

async function checkRedactedArchive(temporaryRoot, fullCollection) {
  const redactedCollection = {
    ...fullCollection,
    mode: "redacted",
    privacy: "已隐藏媒体",
    memories: fullCollection.memories.map((memory) => ({
      ...memory,
      rawContent: "[已隐藏原始记忆]",
      coverImage: "private.jpg",
      attachments: [{ name: "不应进入归档.jpg" }],
      media: [{ assetId: "asset-should-not-leak" }]
    }))
  };
  const forbiddenDependency = new Proxy({}, {
    get() {
      throw new Error("脱敏导出不应读取媒体 store/storage");
    }
  });
  const archive = buildMediaArchive({
    collection: redactedCollection,
    store: forbiddenDependency,
    storage: forbiddenDependency,
    appVersion: "4.0.0",
    schemaVersion: 4
  });
  const entries = await readArchiveEntries(archive, path.join(temporaryRoot, "unpack-redacted"));
  deepEqual([...entries.keys()].sort(), [ARCHIVE_PATHS.collection, ARCHIVE_PATHS.manifest].sort(), "脱敏 .time-isle 只能包含 manifest 和 collection");
  check([...entries.keys()].every((entryPath) => !entryPath.startsWith("media/")), "脱敏归档不得物理包含任何媒体条目");

  const prepared = await prepareMediaArchive(archive, { stagingRoot: path.join(temporaryRoot, "roundtrip-redacted") });
  deepEqual(prepared.manifest.sections, [
    { name: "collection", path: ARCHIVE_PATHS.collection, count: 2, required: true, version: 1 },
    { name: "media", path: ARCHIVE_PATHS.assets, count: 0, required: false, version: 1 }
  ], "V2 脱敏归档应保留 optional media section 且明确计数为零");
  equal(prepared.manifest.media.included, false, "脱敏 manifest 应明确媒体未包含");
  deepEqual(prepared.assets, [], "脱敏恢复 descriptor 不应包含资产");
  check(prepared.collection.memories.every((memory) => memory.media.length === 0 && memory.attachments.length === 0 && memory.coverImage === ""), "脱敏 collection 应清空关联、附件和封面路径");
}

function createFixture(temporaryRoot, options = {}) {
  const sanitizedOnly = options.privacyMode === "sanitized_only";
  const suffix = options.suffix ? `-${options.suffix}` : "";
  const mediaRoot = path.join(temporaryRoot, `media-source${suffix}`);
  fs.mkdirSync(mediaRoot, { recursive: true });
  const original = createPng(12, 8);
  const display = createWebp(320, 180);
  const thumb = createWebp(120, 80);
  const files = {
    ...(sanitizedOnly ? {} : { "assets/original.png": original }),
    "assets/display.webp": display,
    "assets/thumb.webp": thumb
  };
  for (const [storageKey, data] of Object.entries(files)) {
    const filePath = path.join(mediaRoot, ...storageKey.split("/"));
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, data);
  }

  const asset = {
    id: `asset-shared-photo${suffix}`,
    schemaVersion: 4,
    contentSha256: sha256(sanitizedOnly ? display : original),
    originalName: sanitizedOnly ? "操场合影.webp" : "操场合影.png",
    sourceMimeType: sanitizedOnly ? "image/webp" : "image/png",
    sourceByteSize: (sanitizedOnly ? display : original).length,
    width: 320,
    height: 180,
    storageDriver: "local",
    privacyMode: sanitizedOnly ? "sanitized_only" : "preserve_original",
    status: "ready",
    safeMetadata: { canonicalVariant: "display", coordinateSpace: "canonical-preview-v1" },
    createdAt: "2026-07-12T10:00:00.000Z",
    updatedAt: "2026-07-12T10:00:00.000Z"
  };
  const variants = [
    ...(sanitizedOnly ? [] : [variant(asset.id, "original", "assets/original.png", "image/png", original, 12, 8)]),
    variant(asset.id, "display", "assets/display.webp", "image/webp", display, 320, 180),
    variant(asset.id, "thumb", "assets/thumb.webp", "image/webp", thumb, 120, 80)
  ];
  asset.variants = variants;
  const links = [
    link("memory-one", asset.id, "旧操场照片"),
    link("memory-two", asset.id, "重返时翻出的旧照")
  ];
  const observations = [
    {
      id: `observation-school-gate${suffix}`,
      assetId: asset.id,
      kind: "image_region",
      source: "user",
      value: { x: 0.12, y: 0.18, width: 0.3, height: 0.4, label: "旧校门" },
      status: "confirmed",
      confidence: null,
      sensitive: false,
      metadata: { memoryId: "memory-one" },
      createdAt: "2026-07-12T10:10:00.000Z",
      updatedAt: "2026-07-12T10:10:00.000Z"
    },
    {
      id: `observation-outside-boundary${suffix}`,
      assetId: asset.id,
      kind: "image_region",
      source: "user",
      value: { x: 0, y: 0, width: 1, height: 1 },
      status: "confirmed",
      confidence: null,
      sensitive: true,
      metadata: { memoryId: "memory-private-outside" },
      createdAt: "2026-07-12T10:11:00.000Z",
      updatedAt: "2026-07-12T10:11:00.000Z"
    }
  ];
  const store = {
    listMediaForMemory(memoryId) {
      return links.filter((item) => item.memoryId === memoryId).map((item) => ({ ...item, asset, variants }));
    },
    getMediaAsset(assetId) {
      return assetId === asset.id ? asset : null;
    },
    listMediaVariants(assetId) {
      return assetId === asset.id ? variants : [];
    },
    listMediaObservations({ assetId }) {
      return observations.filter((item) => item.assetId === assetId);
    }
  };
  const storage = {
    resolveStorageKey(storageKey) {
      const target = path.resolve(mediaRoot, ...String(storageKey).split("/"));
      const relative = path.relative(mediaRoot, target);
      if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("storage escape");
      return target;
    }
  };
  return { original, display, thumb, asset, variants, links, observations, store, storage };
}

function variant(assetId, kind, storageKey, mimeType, data, width, height) {
  return {
    assetId,
    kind,
    storageKey,
    mimeType,
    byteSize: data.length,
    width,
    height,
    sha256: sha256(data),
    createdAt: "2026-07-12T10:00:00.000Z",
    updatedAt: "2026-07-12T10:00:00.000Z"
  };
}

function link(memoryId, assetId, caption) {
  return {
    memoryId,
    assetId,
    role: "cover",
    position: 0,
    caption,
    altText: "傍晚操场旁的一张旧照片",
    backNote: "照片背面留着当年的一句话。",
    metadata: {},
    createdAt: "2026-07-12T10:05:00.000Z",
    updatedAt: "2026-07-12T10:05:00.000Z"
  };
}

async function readArchiveEntries(archive, stagingRoot) {
  const extracted = await extractArchive(archive, {
    stagingRoot,
    maxEntries: 50,
    maxEntryBytes: 1024 * 1024,
    maxTotalBytes: 8 * 1024 * 1024
  });
  const entries = new Map(extracted.entries.map((entry) => [
    entry.path,
    fs.readFileSync(path.join(stagingRoot, ...entry.path.split("/")))
  ]));
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

function refreshWholeManifest(entries, mediaCounts) {
  const manifest = parseJson(entries.get(ARCHIVE_PATHS.manifest));
  const previous = new Map(manifest.entries.map((entry) => [entry.path, entry]));
  manifest.entries = [...entries]
    .filter(([entryPath]) => entryPath !== ARCHIVE_PATHS.manifest)
    .sort(([left], [right]) => left.localeCompare(right, "en"))
    .map(([entryPath, data]) => ({
      path: entryPath,
      sha256: sha256(data),
      bytes: data.length,
      mime: previous.get(entryPath)?.mime || mimeForArchivePath(entryPath)
    }));
  manifest.entryCount = manifest.entries.length;
  Object.assign(manifest.media, mediaCounts);
  const mediaSection = manifest.sections?.find((section) => section.name === "media");
  if (mediaSection) mediaSection.count = mediaCounts.assetCount;
  entries.set(ARCHIVE_PATHS.manifest, jsonBuffer(manifest));
}

function mimeForArchivePath(entryPath) {
  if (entryPath.endsWith(".json")) return "application/json";
  if (entryPath.endsWith(".jpg") || entryPath.endsWith(".jpeg")) return "image/jpeg";
  if (entryPath.endsWith(".png")) return "image/png";
  if (entryPath.endsWith(".webp")) return "image/webp";
  throw new Error(`unknown test archive MIME: ${entryPath}`);
}

function boundaryCollection(count) {
  return {
    product: "时屿",
    version: "4.0.0",
    schemaVersion: 4,
    mode: "redacted",
    exportedAt: "2026-07-12T12:00:00.000Z",
    memories: Array.from({ length: count }, (_, index) => ({
      id: `memory-boundary-${String(index + 1).padStart(3, "0")}`,
      title: `边界展品 ${index + 1}`,
      rawContent: "[已隐藏原始记忆]",
      attachments: [],
      media: []
    })),
    archaeology: { mode: "redacted", events: [], claims: [], pairDecisions: [], questions: [] }
  };
}

function entityBackupSource(memoryId) {
  const timestamp = "2026-07-16T00:00:00.000Z";
  return {
    entities: [{ id: "entity-archive-person", type: "person", canonicalName: "林岚" }],
    aliases: [{
      id: "alias-archive-person",
      entityId: "entity-archive-person",
      alias: "岚姨",
      source: "user",
      confirmedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp
    }],
    memoryLinks: [{
      entityId: "entity-archive-person",
      memoryId,
      sourceField: "people",
      mentionText: "岚姨",
      confirmedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp
    }]
  };
}

function capsuleBackupFixture(assetId) {
  const timestamp = "2026-07-17T00:00:00.000Z";
  return {
    mode: "full",
    schemaVersion: 9,
    capsules: [{
      id: "capsule-archive-canary",
      title: "给未来的旧操场",
      shellMessage: "等到那一天，再慢慢打开。",
      opensOn: "2040-02-29",
      timezone: "Asia/Shanghai",
      ceremonialGate: "local-date-ritual",
      needsReview: false,
      exhibitionId: "exhibition-archive-canary",
      snapshot: {
        version: 1,
        title: "给未来的旧操场",
        theme: "重逢",
        opening: "晚风又吹过旧操场。",
        sections: [{
          key: "section-1",
          title: "第一章",
          summary: "一份不携带内部 ID 的安全快照。",
          items: [{
            key: "item-1",
            title: "旧操场",
            excerpt: "那天我们绕着操场散步。",
            curatorNote: "留给未来。",
            confirmedQuotes: ["那天我们绕着操场散步。"],
            confirmedTranscripts: []
          }]
        }]
      },
      mediaLinks: [{
        assetId,
        itemKey: "item-1",
        position: 0,
        altText: "傍晚操场旁的一张旧照片",
        caption: "旧操场照片"
      }],
      createdAt: timestamp,
      updatedAt: timestamp
    }]
  };
}

function capsuleCanaries(backup) {
  const capsule = backup.capsules[0];
  return [
    capsule.id,
    capsule.title,
    capsule.shellMessage,
    capsule.opensOn,
    capsule.timezone,
    capsule.exhibitionId,
    capsule.mediaLinks[0].assetId,
    capsule.mediaLinks[0].itemKey,
    capsule.snapshot.opening
  ];
}

function createUncheckedRedactedArchive(collection) {
  const collectionData = jsonBuffer(collection);
  const manifest = {
    format: ARCHIVE_FORMAT,
    formatVersion: 1,
    extension: ".time-isle",
    appVersion: "4.0.0",
    schemaVersion: 4,
    mode: "redacted",
    exportedAt: collection.exportedAt,
    collectionPath: ARCHIVE_PATHS.collection,
    media: { included: false, assetCount: 0, linkCount: 0, observationCount: 0 },
    entryCount: 1,
    entries: [{
      path: ARCHIVE_PATHS.collection,
      sha256: sha256(collectionData),
      bytes: collectionData.length,
      mime: "application/json"
    }]
  };
  return createArchive([
    { path: ARCHIVE_PATHS.manifest, data: jsonBuffer(manifest), mtime: 0 },
    { path: ARCHIVE_PATHS.collection, data: collectionData, mtime: 0 }
  ]);
}

function parseJson(data) {
  return JSON.parse(data.toString("utf8"));
}

function jsonBuffer(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function createPng(width, height) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const pixels = Buffer.alloc((1 + (width * 4)) * height);
  return Buffer.concat([
    signature,
    pngChunk("IHDR", header),
    pngChunk("IDAT", zlib.deflateSync(pixels)),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  typeBuffer.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
  return output;
}

function createWebp(width, height) {
  const frame = Buffer.alloc(10);
  frame[3] = 0x9d;
  frame[4] = 0x01;
  frame[5] = 0x2a;
  frame.writeUInt16LE(width, 6);
  frame.writeUInt16LE(height, 8);
  const chunk = Buffer.alloc(18);
  chunk.write("VP8 ", 0, 4, "ascii");
  chunk.writeUInt32LE(frame.length, 4);
  frame.copy(chunk, 8);
  const body = Buffer.concat([Buffer.from("WEBP", "ascii"), chunk]);
  const header = Buffer.alloc(8);
  header.write("RIFF", 0, 4, "ascii");
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function sha256(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
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

async function rejectsCode(expectedCode, operation, message) {
  await assert.rejects(operation, (error) => error?.code === expectedCode, message);
  assertions += 1;
}

function throwsCode(expectedCode, operation, message) {
  assert.throws(operation, (error) => error?.code === expectedCode, message);
  assertions += 1;
}
