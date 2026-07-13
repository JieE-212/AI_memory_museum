"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");
const zlib = require("node:zlib");
const { createMediaStorage } = require("../lib/media-storage");

let assertions = 0;

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  const temporaryRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "time-isle-media-storage-check-"));
  try {
    const originalPng = createPng(6, 4);
    const displayWebp = createWebp(320, 180);
    const thumbWebp = createWebp(120, 80);

    await checkPreservedUpload(temporaryRoot, originalPng, displayWebp, thumbWebp);
    await checkSanitizedUpload(temporaryRoot, originalPng, displayWebp, thumbWebp);
    await checkRejections(temporaryRoot, originalPng, displayWebp);
    await checkStaleCleanup(temporaryRoot, originalPng);

    console.log(`Media storage checks passed: ${assertions} assertions.`);
  } finally {
    await fs.promises.rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function checkPreservedUpload(temporaryRoot, originalPng, displayWebp, thumbWebp) {
  const root = path.join(temporaryRoot, "preserve");
  const storage = createMediaStorage({
    root,
    displayMaxEdge: 400,
    thumbMaxEdge: 160
  });
  const stage = await storage.beginUpload(asStream(originalPng), {
    fileName: "../夏日\u0000合影.png",
    declaredMimeType: "image/png; charset=binary",
    privacyMode: "preserve_original"
  });
  match(stage.uploadId, /^upload-[a-f0-9-]{36}$/, "beginUpload 应返回不可穿越的随机会话 ID");
  equal(stage.originalName, "夏日合影.png", "beginUpload 应清理原始文件名中的路径与控制字符");
  equal(stage.privacyMode, "preserve_original", "应保留显式的原图隐私策略");
  equal(stage.source.mimeType, "image/png", "应记录从内容识别出的原图 MIME");
  equal(stage.source.width, 6, "应记录原图真实宽度");
  equal(stage.source.height, 4, "应记录原图真实高度");
  equal(stage.source.byteSize, originalPng.length, "应记录流式写入的原图字节数");
  equal(stage.source.sha256, sha256(originalPng), "应在流式写入时计算原图哈希");
  equal(stage.readyToFinalize, false, "缺少派生图时不能完成上传");

  const loaded = await storage.getUpload(stage.uploadId);
  deepEqual(loaded.source, stage.source, "getUpload 应读回持久化的会话元数据");
  await rejectsStatus(409, () => storage.finalizeUpload(stage.uploadId, "asset-incomplete01"), "缺少派生图时 finalize 应拒绝");
  await rejectsStatus(400, () => storage.putDerived(stage.uploadId, "../display", asStream(displayWebp)), "派生图类型不能用于路径穿越");

  const withDisplay = await storage.putDerived(stage.uploadId, "display", asStream(displayWebp), {
    declaredMimeType: "application/octet-stream"
  });
  equal(withDisplay.variants.display.width, 320, "putDerived 应记录展示图宽度");
  equal(withDisplay.variants.display.sha256, sha256(displayWebp), "putDerived 应记录展示图哈希");
  equal(withDisplay.readyToFinalize, false, "仅有展示图时仍不能完成上传");
  const ready = await storage.putDerived(stage.uploadId, "thumb", asStream(thumbWebp), {
    declaredMimeType: "image/webp"
  });
  equal(ready.variants.thumb.height, 80, "putDerived 应记录缩略图高度");
  equal(ready.readyToFinalize, true, "展示图和缩略图齐备后应可完成上传");
  await rejectsStatus(400, () => storage.finalizeUpload(stage.uploadId, "asset-../../escape"), "资产 ID 不能用于路径穿越");

  const finalized = await storage.finalizeUpload(stage.uploadId, "asset-preserve01");
  equal(finalized.asset.id, "asset-preserve01", "finalize 应使用合法的指定资产 ID");
  equal(finalized.asset.contentSha256, sha256(originalPng), "保留原图模式应以原图哈希作为内容哈希");
  equal(finalized.asset.privacyMode, "preserve_original", "完成后应保留隐私策略");
  deepEqual(finalized.variants.map((item) => item.kind), ["original", "display", "thumb"], "保留原图模式应生成三个变体记录");
  check(finalized.variants.every((item) => !item.storageKey.includes("\\")), "存储键应统一使用正斜杠");
  check(finalized.variants.every((item) => storage.resolveStorageKey(item.storageKey).startsWith(root)), "合法存储键应始终解析在媒体根目录内");
  equal(fs.existsSync(path.join(root, ".staging", stage.uploadId)), false, "finalize 后会话目录不应残留");
  equal(fs.existsSync(finalized.directory), true, "finalize 应原子移动为正式资产目录");

  for (const variant of finalized.variants) {
    equal(await storage.verifyVariant(variant), true, `应验证 ${variant.kind} 变体的大小与哈希`);
  }
  const thumb = finalized.variants.find((item) => item.kind === "thumb");
  const thumbPath = storage.resolveStorageKey(thumb.storageKey);
  const pristineThumb = await fs.promises.readFile(thumbPath);
  const tamperedThumb = Buffer.from(pristineThumb);
  tamperedThumb[tamperedThumb.length - 1] ^= 0x01;
  await fs.promises.writeFile(thumbPath, tamperedThumb);
  equal(await storage.verifyVariant(thumb), false, "同尺寸但内容被篡改时哈希校验应失败");
  await fs.promises.writeFile(thumbPath, pristineThumb);
  equal(await storage.verifyVariant(thumb), true, "恢复原内容后哈希校验应重新通过");

  rejectsStatusSync(400, () => storage.resolveStorageKey("../escape.png"), "应拒绝父目录穿越存储键");
  rejectsStatusSync(400, () => storage.resolveStorageKey("assets/../../escape.png"), "应拒绝嵌套父目录穿越存储键");
  rejectsStatusSync(400, () => storage.resolveStorageKey("/absolute/path.png"), "应拒绝绝对存储键");
  await rejectsStatus(400, () => storage.getUpload("upload-../../escape"), "应拒绝非法上传会话 ID");
  await rejectsStatus(400, () => storage.removeQuarantined(temporaryRoot), "只能删除回收站范围内的目录");

  const quarantined = await storage.quarantineAsset(finalized.asset.id, finalized.variants);
  check(quarantined && quarantined.startsWith(path.join(root, ".trash")), "资产应先移动到媒体根目录内的回收站");
  equal(fs.existsSync(finalized.directory), false, "隔离资产后原目录应消失");
  equal(fs.existsSync(quarantined), true, "隔离资产应保留在回收目录等待提交删除");
  const restoredDirectory = await storage.restoreQuarantined(quarantined, finalized.asset.id, finalized.variants);
  equal(restoredDirectory, finalized.directory, "数据库步骤失败时应把隔离目录恢复到原存储位置");
  equal(fs.existsSync(finalized.directory), true, "回滚隔离后正式媒体文件应重新可用");
  const requarantined = await storage.quarantineAsset(finalized.asset.id, finalized.variants);
  await storage.removeQuarantined(requarantined);
  equal(fs.existsSync(requarantined), false, "确认删除后回收目录不应残留");
}

async function checkSanitizedUpload(temporaryRoot, originalPng, displayWebp, thumbWebp) {
  const root = path.join(temporaryRoot, "sanitized");
  const storage = createMediaStorage({ root, displayMaxEdge: 400, thumbMaxEdge: 160 });
  const defaultStage = await storage.beginUpload(asStream(originalPng), {
    fileName: "默认安全策略.png",
    declaredMimeType: "image/png"
  });
  equal(defaultStage.privacyMode, "sanitized_only", "缺少隐私参数时必须默认不保留原图");
  await storage.discardUpload(defaultStage.uploadId);
  const invalidStage = await storage.beginUpload(asStream(originalPng), {
    fileName: "错误隐私参数.png",
    declaredMimeType: "image/png",
    privacyMode: "preserve-orignal"
  });
  equal(invalidStage.privacyMode, "sanitized_only", "错误隐私参数不能静默退化为保留原图");
  await storage.discardUpload(invalidStage.uploadId);
  const stage = await storage.beginUpload(asStream(originalPng), {
    fileName: "含定位信息的原片.png",
    declaredMimeType: "image/png",
    privacyMode: "sanitized_only"
  });
  await storage.putDerived(stage.uploadId, "display", asStream(displayWebp));
  await storage.putDerived(stage.uploadId, "thumb", asStream(thumbWebp));
  const finalized = await storage.finalizeUpload(stage.uploadId, "asset-sanitized01");

  equal(finalized.asset.privacyMode, "sanitized_only", "应保存仅脱敏版本策略");
  equal(finalized.asset.contentSha256, sha256(displayWebp), "仅脱敏模式应以展示图哈希作为内容哈希");
  equal(finalized.asset.sourceMimeType, "image/webp", "仅脱敏模式的规范来源应是展示图");
  equal(finalized.asset.sourceByteSize, displayWebp.length, "仅脱敏模式不应暴露原图大小作为规范来源");
  deepEqual(finalized.variants.map((item) => item.kind), ["display", "thumb"], "仅脱敏模式不能生成 original 变体");
  equal(finalized.variants.some((item) => item.storageKey.includes("original")), false, "变体存储键不能泄漏原图");
  const files = (await fs.promises.readdir(finalized.directory)).sort();
  deepEqual(files, ["display.webp", "thumb.webp"], "正式资产目录中应物理删除原图和会话元数据");
  for (const variant of finalized.variants) equal(await storage.verifyVariant(variant), true, "脱敏变体应通过哈希校验");
}

async function checkRejections(temporaryRoot, originalPng, displayWebp) {
  const originalLimitRoot = path.join(temporaryRoot, "original-limit");
  const limitedOriginals = createMediaStorage({
    root: originalLimitRoot,
    maxOriginalBytes: originalPng.length - 1
  });
  await rejectsStatus(
    413,
    () => limitedOriginals.beginUpload(asStream(originalPng), { declaredMimeType: "image/png" }),
    "beginUpload 应在流式写入期间拒绝超限原图"
  );
  deepEqual(await stageEntries(originalLimitRoot), [], "超限原图失败后不能残留会话或半文件");

  const mismatchRoot = path.join(temporaryRoot, "mime-mismatch");
  const mismatchStorage = createMediaStorage({ root: mismatchRoot });
  await rejectsStatus(
    400,
    () => mismatchStorage.beginUpload(asStream(originalPng), { declaredMimeType: "image/jpeg" }),
    "声明 MIME 与真实魔数不一致时应拒绝原图"
  );
  deepEqual(await stageEntries(mismatchRoot), [], "伪 MIME 原图失败后不能残留会话目录");

  const derivedRoot = path.join(temporaryRoot, "derived-rejections");
  const derivedStorage = createMediaStorage({
    root: derivedRoot,
    maxDerivedBytes: displayWebp.length - 1,
    displayMaxEdge: 400
  });
  const stage = await derivedStorage.beginUpload(asStream(originalPng), { declaredMimeType: "image/png" });
  await rejectsStatus(
    413,
    () => derivedStorage.putDerived(stage.uploadId, "display", asStream(displayWebp)),
    "putDerived 应在流式写入期间拒绝超限派生图"
  );
  const directory = path.join(derivedRoot, ".staging", stage.uploadId);
  equal(fs.existsSync(path.join(directory, "display.webp.upload")), false, "超限派生图不能残留临时文件");
  equal((await derivedStorage.getUpload(stage.uploadId)).variants.display, undefined, "失败的派生图不能写入会话元数据");
  await derivedStorage.discardUpload(stage.uploadId);

  const derivedMimeRoot = path.join(temporaryRoot, "derived-mime");
  const derivedMimeStorage = createMediaStorage({ root: derivedMimeRoot, displayMaxEdge: 400 });
  const mimeStage = await derivedMimeStorage.beginUpload(asStream(originalPng), { declaredMimeType: "image/png" });
  await rejectsStatus(
    400,
    () => derivedMimeStorage.putDerived(mimeStage.uploadId, "display", asStream(displayWebp), { declaredMimeType: "image/png" }),
    "派生图声明 MIME 与真实 WebP 不一致时应拒绝"
  );
  equal((await derivedMimeStorage.getUpload(mimeStage.uploadId)).variants.display, undefined, "伪 MIME 派生图不能污染会话元数据");
  equal(fs.existsSync(path.join(derivedMimeRoot, ".staging", mimeStage.uploadId, "display.webp.upload")), false, "伪 MIME 派生图不能残留临时文件");
  await derivedMimeStorage.discardUpload(mimeStage.uploadId);
}

async function checkStaleCleanup(temporaryRoot, originalPng) {
  const root = path.join(temporaryRoot, "stale-cleanup");
  const storage = createMediaStorage({ root, staleStageMs: 1000 });
  const stale = await storage.beginUpload(asStream(originalPng), { fileName: "stale.png" });
  const fresh = await storage.beginUpload(asStream(originalPng), { fileName: "fresh.png" });
  const now = Date.now();
  const staleDirectory = path.join(root, ".staging", stale.uploadId);
  const oldTime = new Date(now - 10_000);
  await fs.promises.utimes(staleDirectory, oldTime, oldTime);
  const staleTrash = path.join(root, ".trash", `asset-stale-${now - 10_000}`);
  const freshTrash = path.join(root, ".trash", `asset-fresh-${now}`);
  await fs.promises.mkdir(staleTrash);
  await fs.promises.mkdir(freshTrash);
  await fs.promises.utimes(staleTrash, oldTime, oldTime);

  const removed = await storage.cleanupStaleStages(now);
  deepEqual(removed, [stale.uploadId], "stale cleanup 应只返回并移除超过时限的会话");
  equal(fs.existsSync(staleDirectory), false, "过期会话目录应被物理删除");
  await rejectsStatus(404, () => storage.getUpload(stale.uploadId), "清理后的过期会话应不可读取");
  equal((await storage.getUpload(fresh.uploadId)).uploadId, fresh.uploadId, "未过期会话应保持可用");
  const staleTrashEntries = await storage.listQuarantined(now, 1000);
  deepEqual(staleTrashEntries.map((entry) => entry.assetId), ["asset-stale"], "启动协调应只列出过期的隔离目录");
  equal(fs.existsSync(staleTrash), true, "存储层不能在核对数据库前擅自删除过期隔离目录");
  equal(fs.existsSync(freshTrash), true, "新近隔离目录应保留给当前删除事务");
  await fs.promises.rm(staleTrash, { recursive: true, force: true });
  await fs.promises.rm(freshTrash, { recursive: true, force: true });
  await storage.discardUpload(fresh.uploadId);
  equal(fs.existsSync(path.join(root, ".staging", fresh.uploadId)), false, "discardUpload 应删除未完成会话");
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

function asStream(buffer) {
  return Readable.from([buffer]);
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

async function stageEntries(root) {
  return fs.promises.readdir(path.join(root, ".staging"));
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

function match(actual, expected, message) {
  assert.match(actual, expected, message);
  assertions += 1;
}

async function rejectsStatus(statusCode, action, message) {
  await assert.rejects(action, (error) => error && error.statusCode === statusCode, message);
  assertions += 1;
}

function rejectsStatusSync(statusCode, action, message) {
  assert.throws(action, (error) => error && error.statusCode === statusCode, message);
  assertions += 1;
}
