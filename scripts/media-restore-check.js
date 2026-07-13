"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createMemoryStore } = require("../database");
const { createMediaStorage } = require("../lib/media-storage");
const { buildMediaArchive, prepareMediaArchive } = require("../lib/media-backup");
const { restorePreparedArchive } = require("../lib/media-restore");
const { validateArchaeologyBackup, restoreArchaeologyBackup } = require("../lib/archaeology-backup");

let assertions = 0;
const root = fs.mkdtempSync(path.join(os.tmpdir(), "time-isle-restore-"));
const halls = [{ id: "daily", name: "日常展厅", description: "测试" }];
let sourceStore;
let targetStore;
let failingStore;
let privacyConflictStore;
let corruptReusableStore;
let boundaryStore;
let privacyDefenseStore;

function check(value, message) {
  assert.ok(value, message);
  assertions += 1;
}

function equal(actual, expected, message) {
  assert.equal(actual, expected, message);
  assertions += 1;
}

async function main() {
  try {
    const source = createFixture(path.join(root, "source"));
    sourceStore = source.store;
    const archive = buildMediaArchive({
      collection: source.collection,
      store: source.store,
      storage: source.storage,
      appVersion: "4.0.0",
      schemaVersion: 4
    });

    const target = createTarget(path.join(root, "target"));
    targetStore = target.store;
    const firstPrepared = await prepareMediaArchive(archive, {
      stagingRoot: path.join(target.storage.root, ".restore", "first")
    });
    let idCounter = 0;
    const first = restorePreparedArchive({
      prepared: firstPrepared,
      store: target.store,
      storage: target.storage,
      normalizeMemory: normalizeMemory,
      validateArchaeologyBackup,
      restoreArchaeologyBackup,
      createId: (prefix) => `${prefix}-restored-${++idCounter}`
    });
    equal(first.imported, 1, "应恢复一件展品");
    equal(first.media.assetsCreated, 1, "首次恢复应创建媒体资产");
    equal(first.media.links, 1, "应恢复图片关联");
    equal(first.media.observations, 1, "应恢复图片区域证据");
    const restoredMemoryId = first.idMap.memories["memory-source"];
    const restoredMedia = target.store.listMediaForMemory(restoredMemoryId);
    equal(restoredMedia.length, 1, "恢复后的展品应能读取图片");
    check(restoredMedia[0].variants.every((variant) => fs.existsSync(target.storage.resolveStorageKey(variant.storageKey))), "所有媒体文件都应落在最终内容寻址目录");
    equal(target.store.listMediaObservations({ assetId: restoredMedia[0].assetId }).length, 1, "恢复后的媒体观察应可查询");

    const boundary = createTarget(path.join(root, "boundary"));
    boundaryStore = boundary.store;
    const boundaryArchive = buildMediaArchive({
      collection: boundaryCollection(500),
      appVersion: "4.0.0",
      schemaVersion: 4
    });
    const boundaryPrepared = await prepareMediaArchive(boundaryArchive, {
      stagingRoot: path.join(boundary.storage.root, ".restore", "five-hundred")
    });
    let boundaryId = 0;
    const boundaryResult = restorePreparedArchive({
      prepared: boundaryPrepared,
      store: boundary.store,
      storage: boundary.storage,
      normalizeMemory,
      validateArchaeologyBackup,
      restoreArchaeologyBackup,
      createId: (prefix) => `${prefix}-boundary-${++boundaryId}`
    });
    equal(boundaryResult.imported, 500, "默认共享上限应允许 500 件展品完整导出、prepare 与恢复");
    equal(boundary.store.listMemories().length, 500, "500 件边界恢复应在单次事务后全部可见");

    const tooManyPrepared = {
      ...boundaryPrepared,
      collection: boundaryCollection(501)
    };
    assert.throws(() => restorePreparedArchive({
      prepared: tooManyPrepared,
      store: boundary.store,
      storage: boundary.storage,
      normalizeMemory,
      validateArchaeologyBackup,
      restoreArchaeologyBackup,
      createId: (prefix) => `${prefix}-too-many-${++boundaryId}`
    }), (error) => error?.code === "MEDIA_RESTORE_TOO_MANY_MEMORIES");
    assertions += 1;
    equal(boundary.store.listMemories().length, 500, "第 501 件被拒绝时恢复目标必须零增量写入");

    const privacyDefense = createTarget(path.join(root, "privacy-defense"));
    privacyDefenseStore = privacyDefense.store;
    const maliciousPrepared = {
      ...firstPrepared,
      mediaObservations: firstPrepared.mediaObservations.map((observation, index) => (
        index === 0
          ? { ...observation, kind: "gps_coordinates", source: "user", status: "confirmed", sensitive: false }
          : observation
      ))
    };
    assert.throws(() => restorePreparedArchive({
      prepared: maliciousPrepared,
      store: privacyDefense.store,
      storage: privacyDefense.storage,
      normalizeMemory,
      validateArchaeologyBackup,
      restoreArchaeologyBackup,
      createId: (prefix) => `${prefix}-privacy-defense-${++boundaryId}`
    }), (error) => error?.code === "MEDIA_RESTORE_OBSERVATION_PRIVACY_INVALID");
    assertions += 1;
    equal(privacyDefense.store.listMemories().length, 0, "恢复层拒绝恶意 GPS descriptor 时不得写入展品");
    equal(privacyDefense.store.listMediaAssets({ limit: 20 }).length, 0, "恢复层拒绝恶意 GPS descriptor 时不得写入媒体");

    const secondPrepared = await prepareMediaArchive(archive, {
      stagingRoot: path.join(target.storage.root, ".restore", "second")
    });
    const second = restorePreparedArchive({
      prepared: secondPrepared,
      store: target.store,
      storage: target.storage,
      normalizeMemory,
      validateArchaeologyBackup,
      restoreArchaeologyBackup,
      createId: (prefix) => `${prefix}-restored-${++idCounter}`
    });
    equal(second.media.assetsCreated, 0, "相同 SHA-256 的图片应复用现有资产");
    equal(second.media.assetsReused, 1, "复用必须在结果中可见");
    equal(target.store.listMemories().length, 2, "ID 冲突的展品应作为新副本恢复");
    equal(target.store.listMediaAssets({ limit: 20 }).length, 1, "重复恢复不能复制相同媒体文件");

    const privacyConflict = createTarget(path.join(root, "privacy-conflict"));
    privacyConflictStore = privacyConflict.store;
    seedReusableAsset(privacyConflict, source, { privacyMode: "sanitized_only" });
    const privacyPrepared = await prepareMediaArchive(archive, {
      stagingRoot: path.join(privacyConflict.storage.root, ".restore", "privacy")
    });
    assert.throws(() => restorePreparedArchive({
      prepared: privacyPrepared,
      store: privacyConflict.store,
      storage: privacyConflict.storage,
      normalizeMemory,
      validateArchaeologyBackup,
      restoreArchaeologyBackup,
      createId: (prefix) => `${prefix}-privacy-${++idCounter}`
    }), (error) => error?.code === "MEDIA_RESTORE_ASSET_CONFLICT");
    assertions += 1;
    equal(privacyConflict.store.listMemories().length, 0, "隐私策略冲突时恢复必须零写入");

    const corruptReusable = createTarget(path.join(root, "corrupt-reusable"));
    corruptReusableStore = corruptReusable.store;
    const corruptedDisplay = seedReusableAsset(corruptReusable, source, { corruptKind: "display" });
    const corruptPrepared = await prepareMediaArchive(archive, {
      stagingRoot: path.join(corruptReusable.storage.root, ".restore", "corrupt")
    });
    assert.throws(() => restorePreparedArchive({
      prepared: corruptPrepared,
      store: corruptReusable.store,
      storage: corruptReusable.storage,
      normalizeMemory,
      validateArchaeologyBackup,
      restoreArchaeologyBackup,
      createId: (prefix) => `${prefix}-corrupt-${++idCounter}`
    }), (error) => error?.code === "MEDIA_RESTORE_ASSET_CONFLICT");
    assertions += 1;
    check(fs.existsSync(corruptedDisplay), "损坏的既有资产应保留给用户检查，不能用归档静默覆盖");
    equal(corruptReusable.store.listMemories().length, 0, "现有文件损坏时恢复必须零写入");

    const failing = createTarget(path.join(root, "failing"));
    failingStore = failing.store;
    const rejectedPrepared = await prepareMediaArchive(archive, {
      stagingRoot: path.join(failing.storage.root, ".restore", "rejected")
    });
    const originalCreate = failing.store.createMediaAsset;
    failing.store.createMediaAsset = () => { throw new Error("forced DB failure"); };
    assert.throws(() => restorePreparedArchive({
      prepared: rejectedPrepared,
      store: failing.store,
      storage: failing.storage,
      normalizeMemory,
      validateArchaeologyBackup,
      restoreArchaeologyBackup,
      createId: (prefix) => `${prefix}-rollback-${++idCounter}`
    }), /forced DB failure/);
    assertions += 1;
    failing.store.createMediaAsset = originalCreate;
    equal(failing.store.listMemories().length, 0, "DB 失败时展品事务必须回滚");
    equal(failing.store.listMediaAssets({ limit: 20 }).length, 0, "DB 失败时媒体记录必须回滚");
    const finalAssetRoot = path.join(failing.storage.root, "assets", source.asset.contentSha256.slice(0, 2));
    const leftovers = fs.existsSync(finalAssetRoot) ? fs.readdirSync(finalAssetRoot) : [];
    equal(leftovers.length, 0, "DB 失败时已移动的最终媒体目录必须删除");

    console.log(`Media restore checks passed: ${assertions} assertions.`);
  } finally {
    for (const store of [
      sourceStore,
      targetStore,
      failingStore,
      privacyConflictStore,
      corruptReusableStore,
      boundaryStore,
      privacyDefenseStore
    ]) {
      try { store?.close(); } catch { /* already closed */ }
    }
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

function createFixture(directory) {
  fs.mkdirSync(directory, { recursive: true });
  const store = createMemoryStore({ dbPath: path.join(directory, "museum.sqlite"), halls, schemaVersion: 4 });
  sourceStore = store;
  const storage = createMediaStorage({ root: path.join(directory, "media") });
  const memory = store.saveMemory(normalizeMemory({
    id: "memory-source",
    title: "旧相册",
    rawContent: "翻开旧相册时，看见了那天的雨。",
    exhibitText: "一张被保存下来的旧照片。",
    date: "2024-06",
    tags: ["相册"]
  }));
  const data = createWebp(12, 8);
  const hash = sha256(data);
  const asset = {
    id: "asset-source-photo",
    contentSha256: hash,
    originalName: "旧相册.webp",
    sourceMimeType: "image/webp",
    sourceByteSize: data.length,
    width: 12,
    height: 8,
    storageDriver: "local",
    privacyMode: "preserve_original",
    status: "ready",
    safeMetadata: { canonicalVariant: "display", coordinateSpace: "canonical-preview-v1" }
  };
  const variants = ["original", "display", "thumb"].map((kind) => {
    const storageKey = `assets/source/${kind}.webp`;
    const filePath = storage.resolveStorageKey(storageKey);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, data);
    return { assetId: asset.id, kind, storageKey, mimeType: "image/webp", byteSize: data.length, width: 12, height: 8, sha256: hash };
  });
  store.createMediaAsset(asset, variants);
  store.attachMedia(memory.id, asset.id, { role: "cover", position: 0, caption: "雨天旧照", altText: "窗边的一张旧照片", backNote: "照片背面写着六月。", metadata: {} });
  store.saveMediaObservation({
    id: "observation-source-region",
    assetId: asset.id,
    kind: "image_region",
    source: "user",
    value: { label: "窗边", locator: { coordinateSpace: "canonical-preview-v1", x: 0.1, y: 0.1, width: 0.4, height: 0.4 } },
    status: "confirmed",
    confidence: 1,
    sensitive: false,
    metadata: { memoryId: memory.id }
  });
  const collection = {
    product: "时屿",
    version: "4.0.0",
    schemaVersion: 4,
    mode: "full",
    exportedAt: "2026-07-12T00:00:00.000Z",
    memories: [memory],
    archaeology: { mode: "full", events: [], claims: [], pairDecisions: [], questions: [] }
  };
  return { store, storage, collection, asset };
}

function createTarget(directory) {
  fs.mkdirSync(directory, { recursive: true });
  return {
    store: createMemoryStore({ dbPath: path.join(directory, "museum.sqlite"), halls, schemaVersion: 4 }),
    storage: createMediaStorage({ root: path.join(directory, "media") })
  };
}

function seedReusableAsset(target, source, options = {}) {
  const sourceAsset = source.store.getMediaAsset(source.asset.id);
  const privacyMode = options.privacyMode || sourceAsset.privacyMode;
  const sourceVariants = privacyMode === "sanitized_only"
    ? sourceAsset.variants.filter((variant) => variant.kind !== "original")
    : sourceAsset.variants;
  const targetId = `asset-existing-${privacyMode}`;
  const variants = sourceVariants.map((variant) => {
    const sourcePath = source.storage.resolveStorageKey(variant.storageKey);
    const data = fs.readFileSync(sourcePath);
    const storageKey = `assets/existing/${targetId}/${variant.kind}.webp`;
    const targetPath = target.storage.resolveStorageKey(storageKey);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, data);
    return { ...variant, assetId: targetId, storageKey };
  });
  target.store.createMediaAsset({
    id: targetId,
    contentSha256: sourceAsset.contentSha256,
    originalName: sourceAsset.originalName,
    sourceMimeType: sourceAsset.sourceMimeType,
    sourceByteSize: sourceAsset.sourceByteSize,
    width: sourceAsset.width,
    height: sourceAsset.height,
    storageDriver: sourceAsset.storageDriver,
    privacyMode,
    status: "ready",
    safeMetadata: sourceAsset.safeMetadata,
    createdAt: sourceAsset.createdAt,
    updatedAt: sourceAsset.updatedAt
  }, variants);
  const corrupt = variants.find((variant) => variant.kind === options.corruptKind);
  if (!corrupt) return "";
  const corruptPath = target.storage.resolveStorageKey(corrupt.storageKey);
  const bytes = fs.readFileSync(corruptPath);
  bytes[bytes.length - 1] ^= 0x01;
  fs.writeFileSync(corruptPath, bytes);
  return corruptPath;
}

function boundaryCollection(count) {
  return {
    product: "时屿",
    version: "4.0.0",
    schemaVersion: 4,
    mode: "redacted",
    exportedAt: "2026-07-12T00:00:00.000Z",
    memories: Array.from({ length: count }, (_, index) => ({
      id: `memory-boundary-${String(index + 1).padStart(3, "0")}`,
      title: `边界展品 ${index + 1}`,
      rawContent: "[已隐藏原始记忆]",
      attachments: [],
      media: []
    }))
  };
}

function normalizeMemory(input = {}) {
  const now = "2026-07-12T00:00:00.000Z";
  return {
    schemaVersion: 4,
    id: input.id,
    title: String(input.title || "未命名记忆"),
    hall: "daily",
    sourceType: "其他",
    rawContent: String(input.rawContent || ""),
    exhibitText: String(input.exhibitText || input.rawContent || ""),
    date: String(input.date || ""),
    location: String(input.location || ""),
    people: Array.isArray(input.people) ? input.people : [],
    tags: Array.isArray(input.tags) ? input.tags : [],
    emotions: Array.isArray(input.emotions) ? input.emotions : [],
    emotionIntensity: 3,
    importance: 2,
    favorite: false,
    coverImage: "",
    mediaNote: "",
    attachments: [],
    agentRunId: "",
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || ""
  };
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

function sha256(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
