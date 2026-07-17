"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");
const { createMemoryStore } = require("../database");
const { createMediaStorage } = require("../lib/media-storage");
const { createMediaApi } = require("../lib/media-api");

let assertions = 0;
const root = fs.mkdtempSync(path.join(os.tmpdir(), "time-isle-media-api-"));
const store = createMemoryStore({
  dbPath: path.join(root, "museum.sqlite"),
  halls: [{ id: "daily", name: "日常展厅", description: "测试" }],
  schemaVersion: 4
});
const storage = createMediaStorage({ root: path.join(root, "media"), staleStageMs: 1000 });
const api = createMediaApi({
  store,
  storage,
  interviewDemo: false,
  sendJson: (response, statusCode, payload) => {
    if (response && typeof response === "object") {
      response.statusCode = statusCode;
      response.payload = payload;
    }
    return payload;
  },
  readJsonBody: async () => ({}),
  httpError: (statusCode, message) => Object.assign(new Error(message), { statusCode })
});

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  try { store.close(); } catch { /* already closed */ }
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

async function main() {
  const memory = store.saveMemory(memoryFixture("memory-reconcile"));
  const referenced = createAsset("asset-referenced", "referenced");
  store.attachMedia(memory.id, referenced.id, { role: "cover", position: 0 });
  await storage.quarantineAsset(referenced.id, referenced.variants);
  const restored = await api.reconcileQuarantine();
  check(restored.restored.includes(referenced.id), "数据库仍引用的隔离媒体应在启动时恢复");
  check(referenced.variants.every((variant) => fs.existsSync(storage.resolveStorageKey(variant.storageKey))), "恢复后全部媒体变体应重新可读");
  equal(store.getMediaAsset(referenced.id).status, "ready", "恢复引用媒体后状态保持 ready");

  const associationMemory = store.saveMemory(memoryFixture("memory-six-photo-limit"));
  const associationAssets = Array.from({ length: 7 }, (_, index) => (
    createAsset(`asset-association-${index + 1}`, `association-${index + 1}`)
  ));
  let associationBody = {};
  const associationApi = createMediaApi({
    store,
    storage,
    interviewDemo: false,
    sendJson: (response, statusCode, payload) => {
      response.statusCode = statusCode;
      response.payload = payload;
      return payload;
    },
    readJsonBody: async () => associationBody,
    httpError: (statusCode, message) => Object.assign(new Error(message), { statusCode })
  });
  for (const asset of associationAssets.slice(0, 6)) {
    associationBody = { assetId: asset.id };
    await associationApi.handle(
      { method: "POST", headers: {} },
      {},
      new URL(`http://local/api/memories/${associationMemory.id}/media`)
    );
  }
  equal(store.listMediaForMemory(associationMemory.id).length, 6, "POST attach accepts exactly six distinct photos");
  associationBody = { assetId: associationAssets[6].id };
  await assert.rejects(
    () => associationApi.handle(
      { method: "POST", headers: {} },
      {},
      new URL(`http://local/api/memories/${associationMemory.id}/media`)
    ),
    (error) => error?.statusCode === 400 && /最多保存 6 张照片/.test(error.message)
  );
  assertions += 1;
  associationBody = { assetId: associationAssets[0].id, caption: "更新已有照片" };
  const associationUpdateResponse = {};
  await associationApi.handle(
    { method: "POST", headers: {} },
    associationUpdateResponse,
    new URL(`http://local/api/memories/${associationMemory.id}/media`)
  );
  check(
    associationUpdateResponse.payload.collection.length === 6 &&
      associationUpdateResponse.payload.media.caption === "更新已有照片",
    "POST attach updates an existing photo at the limit without counting it twice"
  );

  const orphan = createAsset("asset-orphan", "orphan");
  const orphanTrash = await storage.quarantineAsset(orphan.id, orphan.variants);
  store.deleteMediaAsset(orphan.id);
  const removedOrphan = await api.reconcileQuarantine();
  check(removedOrphan.removed.includes(orphan.id), "数据库已无记录的隔离媒体应在启动时删除");
  equal(fs.existsSync(orphanTrash), false, "孤儿隔离目录应被物理删除");

  const pending = createAsset("asset-pending", "pending");
  store.markMediaPendingDelete(pending.id);
  const pendingTrash = await storage.quarantineAsset(pending.id, pending.variants);
  const removedPending = await api.reconcileQuarantine();
  check(removedPending.removed.includes(pending.id), "已提交删除的隔离媒体应完成数据库和文件清理");
  equal(store.getMediaAsset(pending.id), null, "pending_delete 资产协调后不应残留数据库墓碑");
  equal(fs.existsSync(pendingTrash), false, "pending_delete 隔离目录协调后不应残留");

  const rollback = createAsset("asset-rollback", "rollback");
  const bulk = await api.quarantineStoredFiles([rollback]);
  check(!fs.existsSync(path.dirname(storage.resolveStorageKey(rollback.variants[0].storageKey))), "批量清空前应先隔离媒体目录");
  await api.restoreStoredFiles(bulk);
  check(fs.existsSync(path.dirname(storage.resolveStorageKey(rollback.variants[0].storageKey))), "数据库事务失败时批量隔离应可完整回滚");

  const stranded = createAsset("asset-stranded", "stranded");
  const strandedDirectory = path.dirname(storage.resolveStorageKey(stranded.variants[0].storageKey));
  store.deleteMediaAsset(stranded.id);
  const strandedCleanup = await api.reconcileAssetDirectories({ graceMs: 0 });
  check(strandedCleanup.removed.includes(stranded.id), "正式 assets 下无数据库记录的目录应由维护协调器回收");
  equal(fs.existsSync(strandedDirectory), false, "无主正式媒体目录不应永久残留原图");

  const corruptDuplicate = createAsset("asset-corrupt-duplicate", "corrupt-duplicate");
  const duplicateOriginal = corruptDuplicate.variants.find((variant) => variant.kind === "original");
  const duplicateDisplay = corruptDuplicate.variants.find((variant) => variant.kind === "display");
  const duplicateBytes = fs.readFileSync(storage.resolveStorageKey(duplicateOriginal.storageKey));
  const corruptedBytes = fs.readFileSync(storage.resolveStorageKey(duplicateDisplay.storageKey));
  corruptedBytes[corruptedBytes.length - 1] ^= 0x01;
  fs.writeFileSync(storage.resolveStorageKey(duplicateDisplay.storageKey), corruptedBytes);
  const duplicateStage = await storage.beginUpload(Readable.from(duplicateBytes), {
    fileName: "corrupt-duplicate.webp",
    declaredMimeType: "image/webp",
    privacyMode: "preserve_original"
  });
  await storage.putDerived(duplicateStage.uploadId, "display", Readable.from(duplicateBytes), { declaredMimeType: "image/webp" });
  await storage.putDerived(duplicateStage.uploadId, "thumb", Readable.from(duplicateBytes), { declaredMimeType: "image/webp" });
  await assert.rejects(
    () => api.handle({ method: "POST", headers: {} }, {}, new URL(`http://local/api/media/uploads/${duplicateStage.uploadId}/complete`)),
    (error) => error?.statusCode === 409 && /完整性/.test(error.message)
  );
  assertions += 1;
  equal((await storage.getUpload(duplicateStage.uploadId)).uploadId, duplicateStage.uploadId, "损坏的既有资产不能导致健康上传被静默去重丢弃");
  equal(store.getMediaAssetByHash(sha256(duplicateBytes)).id, corruptDuplicate.id, "完整性冲突不能改写既有资产记录");
  await storage.discardUpload(duplicateStage.uploadId);

  await assert.rejects(
    () => api.withMediaOperation(() => { throw new Error("forced coordinator rejection"); }),
    /forced coordinator rejection/
  );
  assertions += 1;
  equal(
    await withWatchdog(api.withMediaOperation(() => "queue-continued"), "媒体队列在前序异常后未继续执行"),
    "queue-continued",
    "媒体队列不应被前一个失败操作永久毒化"
  );

  await assertDedupeDeletionIsSerialized("asset-existing-race", "existing-race", false);
  await assertDedupeDeletionIsSerialized("asset-late-duplicate-race", "late-duplicate-race", true);

  const putRaceBytes = createWebp(18, 12);
  const putRaceStage = await storage.beginUpload(Readable.from(putRaceBytes), {
    fileName: "put-cleanup-race.webp",
    declaredMimeType: "image/webp",
    privacyMode: "preserve_original"
  });
  let releasePut;
  let reportPutStarted;
  const putGate = new Promise((resolve) => { releasePut = resolve; });
  const putStarted = new Promise((resolve) => { reportPutStarted = resolve; });
  const putRequest = Readable.from((async function* streamDerivedSlowly() {
    reportPutStarted();
    yield putRaceBytes.subarray(0, 12);
    await putGate;
    yield putRaceBytes.subarray(12);
  })());
  putRequest.method = "PUT";
  putRequest.headers = { "content-type": "image/webp" };
  const putResponse = {};
  let putPromise;
  let stageCleanupPromise;
  try {
    putPromise = api.handle(
      putRequest,
      putResponse,
      new URL(`http://local/api/media/uploads/${putRaceStage.uploadId}/display`)
    );
    await withWatchdog(putStarted, "派生图 PUT 未进入受控慢流");
    let cleanupFinished = false;
    stageCleanupPromise = api.withMediaOperation(() => storage.cleanupStaleStages(Date.now() + 5_000))
      .finally(() => { cleanupFinished = true; });
    await new Promise((resolve) => setImmediate(resolve));
    equal(cleanupFinished, false, "慢派生图 PUT 期间 stale-stage cleanup 必须等待同一媒体锁");
    releasePut();
    await withWatchdog(putPromise, "派生图 PUT 在释放测试闸门后未完成");
    equal(putResponse.payload?.upload?.variants?.display?.mimeType, "image/webp", "排队清理前派生图 PUT 应完整提交响应");
    const staleRemoved = await withWatchdog(stageCleanupPromise, "排队的 stale-stage cleanup 未完成");
    check(staleRemoved.includes(putRaceStage.uploadId), "stale-stage cleanup 应在 PUT 提交后按队列顺序回收测试会话");
  } finally {
    releasePut?.();
    await settleWithWatchdog([putPromise, stageCleanupPromise], "派生图 PUT / cleanup 测试未能收束");
    await storage.discardUpload(putRaceStage.uploadId).catch(() => {});
  }

  const purgeRace = createAsset("asset-purge-race", "purge-race");
  const purgeRaceDirectory = path.dirname(storage.resolveStorageKey(purgeRace.variants[0].storageKey));
  let releasePurge;
  let reportPurgeStarted;
  const purgeGate = new Promise((resolve) => { releasePurge = resolve; });
  const purgeStarted = new Promise((resolve) => { reportPurgeStarted = resolve; });
  let purgePromise;
  let reconcilePromise;
  let gcPromise;
  let externalOperationPromise;
  try {
    purgePromise = api.purgeAll(async () => {
      reportPurgeStarted();
      await purgeGate;
      return store.purgeAll();
    });
    await withWatchdog(purgeStarted, "慢清空未进入数据库提交前的测试窗口");
    equal(fs.existsSync(purgeRaceDirectory), false, "慢清空进入数据库事务前应保持媒体处于隔离区");

    let reconcileFinished = false;
    let gcFinished = false;
    let externalOperationFinished = false;
    reconcilePromise = api.reconcileQuarantine().finally(() => { reconcileFinished = true; });
    gcPromise = api.garbageCollect({ status: "ready", limit: 500 }).finally(() => { gcFinished = true; });
    externalOperationPromise = api.withMediaOperation(() => {
      externalOperationFinished = true;
      return store.getMediaAsset(purgeRace.id);
    });
    await new Promise((resolve) => setImmediate(resolve));
    equal(reconcileFinished, false, "慢清空期间周期隔离协调必须等待同一媒体锁");
    equal(gcFinished, false, "慢清空期间垃圾回收必须等待同一媒体锁");
    equal(externalOperationFinished, false, "慢清空期间归档恢复等外部媒体操作必须等待同一媒体锁");
    equal(fs.existsSync(purgeRaceDirectory), false, "等待中的周期维护不能把 active purge 的隔离目录恢复到正式区");

    releasePurge();
    const purgeResult = await withWatchdog(purgePromise, "慢清空在释放测试闸门后未完成");
    const [reconciled, collected, externalView] = await withWatchdog(
      Promise.all([reconcilePromise, gcPromise, externalOperationPromise]),
      "清空后的协调队列未能排空"
    );
    equal(purgeResult.cleanup.pending.length, 0, "独占清空完成后隔离媒体应全部物理清理");
    equal(store.getMediaAsset(purgeRace.id), null, "独占清空完成后不应残留媒体数据库记录");
    equal(reconciled.restored.length, 0, "清空后才运行的协调器不应复活已删除媒体");
    equal(collected.length, 0, "清空后才运行的 GC 不应重复处理已删除媒体");
    equal(externalView, null, "外部媒体操作应在完整清空提交后观察数据库状态");
  } finally {
    releasePurge?.();
    await settleWithWatchdog(
      [purgePromise, reconcilePromise, gcPromise, externalOperationPromise],
      "慢清空并发测试未能收束"
    );
  }

  const filesBeforeFailedUpload = countFiles(path.join(storage.root, "assets"));
  const uploadBytes = createWebp(16, 10);
  const staged = await storage.beginUpload(Readable.from(uploadBytes), {
    fileName: "transaction.webp",
    declaredMimeType: "image/webp",
    privacyMode: "preserve_original"
  });
  await storage.putDerived(staged.uploadId, "display", Readable.from(uploadBytes), { declaredMimeType: "image/webp" });
  await storage.putDerived(staged.uploadId, "thumb", Readable.from(uploadBytes), { declaredMimeType: "image/webp" });
  const originalCreate = store.createMediaAsset;
  store.createMediaAsset = (...args) => {
    originalCreate(...args);
    throw new Error("forced post-insert failure");
  };
  await assert.rejects(
    () => api.handle({ method: "POST", headers: {} }, {}, new URL(`http://local/api/media/uploads/${staged.uploadId}/complete`)),
    /forced post-insert failure/
  );
  assertions += 1;
  store.createMediaAsset = originalCreate;
  equal(store.getMediaAssetByHash(sha256(uploadBytes)), null, "上传完成的后续写入失败时媒体数据库事务必须回滚");
  equal(countFiles(path.join(storage.root, "assets")), filesBeforeFailedUpload, "失败上传的最终目录必须清理且不能影响既有测试资产");

  console.log(`Media API checks passed: ${assertions} assertions.`);
}

async function assertDedupeDeletionIsSerialized(assetId, label, forceLateCollision) {
  const existing = createAsset(assetId, label);
  const originalVariant = existing.variants.find((variant) => variant.kind === "original");
  const bytes = fs.readFileSync(storage.resolveStorageKey(originalVariant.storageKey));
  const stage = await storage.beginUpload(Readable.from(bytes), {
    fileName: `${label}.webp`,
    declaredMimeType: "image/webp",
    privacyMode: "preserve_original"
  });
  await storage.putDerived(stage.uploadId, "display", Readable.from(bytes), { declaredMimeType: "image/webp" });
  await storage.putDerived(stage.uploadId, "thumb", Readable.from(bytes), { declaredMimeType: "image/webp" });

  const originalGetByHash = store.getMediaAssetByHash;
  const originalMarkMediaReady = store.markMediaReady;
  const originalVerify = storage.verifyVariant;
  const originalDiscard = storage.discardUpload;
  const originalQuarantine = storage.quarantineAsset;
  let hashLookups = 0;
  let verificationPaused = false;
  let reportVerificationStarted;
  let releaseVerification;
  const verificationStarted = new Promise((resolve) => { reportVerificationStarted = resolve; });
  const verificationGate = new Promise((resolve) => { releaseVerification = resolve; });
  const order = [];
  let reuseLeaseRefreshed = false;
  let completionPromise;
  let deletionPromise;

  if (forceLateCollision) {
    store.getMediaAssetByHash = (hash) => {
      if (hash === existing.contentSha256 && hashLookups++ === 0) return null;
      return originalGetByHash(hash);
    };
  }
  store.markMediaReady = (currentAssetId) => {
    if (currentAssetId === existing.id) reuseLeaseRefreshed = true;
    return originalMarkMediaReady(currentAssetId);
  };
  storage.verifyVariant = async (variant) => {
    if (!verificationPaused && variant.assetId === existing.id) {
      verificationPaused = true;
      reportVerificationStarted();
      await verificationGate;
    }
    return originalVerify(variant);
  };
  storage.discardUpload = async (uploadId) => {
    if (uploadId === stage.uploadId) order.push("discard-upload");
    return originalDiscard(uploadId);
  };
  storage.quarantineAsset = async (currentAssetId, variants) => {
    if (currentAssetId === existing.id) order.push("delete-existing");
    else order.push("discard-finalized");
    return originalQuarantine(currentAssetId, variants);
  };

  try {
    const completionResponse = {};
    completionPromise = api.handle(
      { method: "POST", headers: {} },
      completionResponse,
      new URL(`http://local/api/media/uploads/${stage.uploadId}/complete`)
    );
    await withWatchdog(verificationStarted, `${label}: 去重校验未进入测试闸门`);

    let deletionFinished = false;
    deletionPromise = api.handle(
      { method: "DELETE", headers: {} },
      {},
      new URL(`http://local/api/media/assets/${existing.id}`)
    ).finally(() => { deletionFinished = true; });
    await new Promise((resolve) => setImmediate(resolve));

    equal(deletionFinished, false, `${label}: 去重完整性校验未结束时并发删除必须等待`);
    check(existing.variants.every((variant) => fs.existsSync(storage.resolveStorageKey(variant.storageKey))), `${label}: 等待中的删除不能移走正在校验的既有资产`);

    releaseVerification();
    await withWatchdog(completionPromise, `${label}: 去重完成请求未能结束`);
    equal(completionResponse.payload?.deduplicated, true, `${label}: 健康既有资产应完成精确去重`);
    equal(reuseLeaseRefreshed, true, `${label}: 去重复用应刷新未关联资产的 GC 宽限期`);
    await withWatchdog(deletionPromise, `${label}: 排队删除未能结束`);

    const discardStep = forceLateCollision ? "discard-finalized" : "discard-upload";
    check(
      order.indexOf(discardStep) >= 0 && order.indexOf(discardStep) < order.indexOf("delete-existing"),
      `${label}: 既有资产只能在健康上传安全丢弃后删除`
    );
  } finally {
    releaseVerification?.();
    await settleWithWatchdog([completionPromise, deletionPromise], `${label}: 去重并发测试未能收束`);
    store.getMediaAssetByHash = originalGetByHash;
    store.markMediaReady = originalMarkMediaReady;
    storage.verifyVariant = originalVerify;
    storage.discardUpload = originalDiscard;
    storage.quarantineAsset = originalQuarantine;
  }
}

function createAsset(id, label) {
  const seed = crypto.createHash("sha256").update(label).digest().readUInt16BE(0);
  const width = 12 + (seed % 400);
  const height = 8 + (seed % 37);
  const data = createWebp(width, height);
  const hash = sha256(data);
  const variants = ["original", "display", "thumb"].map((kind) => {
    const storageKey = `assets/${hash.slice(0, 2)}/${id}/${kind}.webp`;
    const filePath = storage.resolveStorageKey(storageKey);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, data);
    return { assetId: id, kind, storageKey, mimeType: "image/webp", byteSize: data.length, width, height, sha256: hash };
  });
  return store.createMediaAsset({
    id,
    contentSha256: hash,
    originalName: `${label}.webp`,
    sourceMimeType: "image/webp",
    sourceByteSize: data.length,
    width,
    height,
    privacyMode: "preserve_original",
    status: "ready",
    safeMetadata: {}
  }, variants);
}

function memoryFixture(id) {
  return {
    schemaVersion: 4,
    id,
    title: "隔离恢复测试",
    hall: "daily",
    sourceType: "其他",
    rawContent: "验证媒体隔离在失败和重启后的补偿。",
    exhibitText: "媒体隔离补偿",
    date: "",
    location: "",
    people: [],
    tags: [],
    emotions: [],
    emotionIntensity: 3,
    importance: 2,
    favorite: false,
    coverImage: "",
    mediaNote: "",
    attachments: [],
    agentRunId: "",
    createdAt: "2026-07-13T00:00:00.000Z",
    updatedAt: ""
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

function countFiles(directory) {
  if (!fs.existsSync(directory)) return 0;
  return fs.readdirSync(directory, { withFileTypes: true }).reduce((count, entry) => (
    count + (entry.isDirectory() ? countFiles(path.join(directory, entry.name)) : entry.isFile() ? 1 : 0)
  ), 0);
}

function withWatchdog(promise, message, timeoutMs = 3_000) {
  let timer;
  const watchdog = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([Promise.resolve(promise), watchdog]).finally(() => clearTimeout(timer));
}

function settleWithWatchdog(promises, message) {
  return withWatchdog(Promise.allSettled(promises.filter(Boolean)), message);
}

function check(value, message) {
  assert.ok(value, message);
  assertions += 1;
}

function equal(actual, expected, message) {
  assert.equal(actual, expected, message);
  assertions += 1;
}
