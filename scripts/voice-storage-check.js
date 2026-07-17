"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Readable } = require("stream");
const { createVoiceStorage } = require("../lib/voice-storage");

let assertions = 0;
const check = (value, message) => { assert.ok(value, message); assertions += 1; };
const equal = (actual, expected, message) => { assert.strictEqual(actual, expected, message); assertions += 1; };

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  const temporaryRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "time-isle-voice-storage-check-"));
  try {
    const root = path.join(temporaryRoot, "voice");
    const storage = createVoiceStorage({ root, staleStageMs: 5_000, trashGraceMs: 5_000 });
    const webm = makeWebm(1_000);
    const webmHash = sha256(webm);

    equal(storage.policy.maxBytes, 12 * 1024 * 1024, "storage 应继承 12 MiB 硬限制");
    equal(storage.policy.maxDurationMs, 180_000, "storage 应继承三分钟硬限制");
    equal(storage.policy.maxVoicesPerMemory, 3, "storage policy 应暴露单记忆声音上限");
    check(fs.statSync(path.join(root, ".staging")).isDirectory(), "应初始化 staging 目录");
    check(fs.statSync(path.join(root, "ready")).isDirectory(), "应初始化 ready 目录");
    check(fs.statSync(path.join(root, ".trash")).isDirectory(), "应初始化 trash 目录");

    const stage = await storage.beginUpload(Readable.from(webm), {
      fileName: "C:\\private\\memo.webm",
      declaredMimeType: "audio/webm"
    });
    check(/^voice-upload-[a-f0-9-]{36}$/.test(stage.uploadId), "uploadId 应不可猜且有边界");
    equal(stage.originalName, "memo.webm", "原始文件名只保留 basename");
    equal(stage.contentSha256, webmHash, "流式写入应计算 SHA-256");
    equal(stage.sha256, webmHash, "stage 应提供 sha256 兼容字段");
    equal(stage.byteSize, webm.length, "stage 应记录精确字节数");
    equal(stage.mimeType, "audio/webm", "stage MIME 必须来自真字节");
    equal(stage.codec, "opus", "stage codec 必须来自真字节");
    equal(stage.durationMs, 1_000, "stage 时长必须来自容器");
    check(stage.readyToMaterialize, "合法 stage 应可物化");
    equal((await storage.getUpload(stage.uploadId)).contentSha256, webmHash, "stage 元数据应可重读");

    const finalized = await storage.materialize(stage.uploadId);
    check(finalized.created && !finalized.reused, "首次物化应创建内容文件");
    equal(finalized.asset.storageKey, `ready/${webmHash.slice(0, 2)}/${webmHash}.webm`, "ready 路径应按内容哈希分片");
    equal(finalized.asset.originalName, "memo.webm", "物化结果应保留安全原名");
    equal(finalized.file.sha256, webmHash, "物化文件描述应带内容哈希");
    equal(fs.existsSync(path.join(root, ".staging", stage.uploadId)), false, "物化后不应残留 stage");
    check(fs.existsSync(storage.resolveStorageKey(finalized.file.storageKey)), "内容寻址 ready 文件应存在");

    const metadata = await storage.stat(finalized.file.storageKey);
    equal(metadata.byteSize, webm.length, "stat 应返回精确大小");
    equal(metadata.mimeType, "audio/webm", "stat 应从安全 storageKey 还原 MIME");
    equal(metadata.sha256, webmHash, "stat 应从内容地址返回哈希");
    equal(metadata.etag, `"sha256-${webmHash}"`, "stat 应给 API 稳定强 ETag");
    check(Number.isFinite(Date.parse(metadata.lastModified)), "stat 应给出合法修改时间");

    equal((await readStream(await storage.open(finalized.file.storageKey))).compare(webm), 0, "open 应读取完整声音");
    const ranged = await storage.openRange(finalized.file.storageKey, { start: 2, end: 8 });
    equal(ranged.start, 2, "Range 起点应包含在响应中");
    equal(ranged.end, 8, "Range 终点应为 inclusive");
    equal(ranged.length, 7, "Range 长度应正确");
    equal(ranged.total, webm.length, "Range 应公开总长度");
    equal(ranged.contentRange, `bytes 2-8/${webm.length}`, "Content-Range 元数据应可直接供 API 使用");
    equal((await readStream(ranged.stream)).compare(webm.subarray(2, 9)), 0, "Range 流不能多读或少读");
    equal((await readStream(await storage.open(finalized.file.storageKey, { start: 0, end: 3 }))).compare(webm.subarray(0, 4)), 0, "open 也应支持 inclusive range");
    await rejectAsync(() => storage.openRange(finalized.file.storageKey, { start: webm.length, end: webm.length + 1 }), "VOICE_RANGE_NOT_SATISFIABLE", 416, "Range 起点越界必须 416");
    await rejectAsync(() => storage.openRange(finalized.file.storageKey, { start: -1, end: 2 }), "VOICE_RANGE_NOT_SATISFIABLE", 416, "负 Range 必须 416");
    check(await storage.verify(finalized.file), "verify 应核对大小、MIME 与哈希");
    check(!(await storage.verify({ ...finalized.file, byteSize: webm.length + 1 })), "verify 应拒绝错误描述");

    const duplicateStage = await storage.stageUpload(Readable.from(webm), { fileName: "again.webm" });
    const duplicate = await storage.finalizeUpload(duplicateStage.uploadId);
    check(!duplicate.created && duplicate.reused, "相同真字节应复用内容地址");
    equal(duplicate.file.storageKey, finalized.file.storageKey, "重复内容不能制造第二个 ready 路径");
    equal(countReadyFiles(root), 1, "去重后 ready 只应有一个物理文件");

    const readyPath = storage.resolveStorageKey(finalized.file.storageKey);
    await fs.promises.writeFile(readyPath, Buffer.concat([Buffer.from([0]), webm.subarray(1)]));
    check(!(await storage.verify(finalized.file)), "ready 内容损坏后 verify 必须失败");
    const conflictStage = await storage.beginUpload(Readable.from(webm), { fileName: "conflict.webm" });
    await rejectAsync(() => storage.materializeUpload(conflictStage.uploadId), "VOICE_CONTENT_CONFLICT", 409, "损坏的同哈希文件不能被静默复用");
    check(fs.existsSync(path.join(root, ".staging", conflictStage.uploadId)), "物化冲突应保留 stage 供调用方决定回滚");
    await storage.discardUpload(conflictStage.uploadId);
    await fs.promises.writeFile(readyPath, webm);

    const token = await storage.quarantineReady(finalized.file.storageKey);
    check(token && token.trashKey.startsWith(".trash/q-"), "删除前应先移动到 trash");
    equal(fs.existsSync(readyPath), false, "隔离后 ready 文件应不可见");
    equal((await storage.listQuarantined()).length, 1, "隔离项应可枚举用于重启协调");
    equal(await storage.restoreQuarantined(token), finalized.file.storageKey, "回滚应恢复原 storageKey");
    check(fs.existsSync(readyPath), "回滚后 ready 文件应恢复");
    const finalToken = await storage.quarantine(finalized.file.storageKey);
    await storage.removeQuarantined(finalToken);
    equal((await storage.listQuarantined()).length, 0, "最终清理后 trash 不应残留");
    equal(await storage.restoreQuarantined(finalToken), null, "已最终清理的隔离项不能凭空恢复");

    const mp4 = makeMp4(2_000);
    const savedMp4 = await storage.save(Readable.from(mp4), {
      fileName: "../voice-note.m4a",
      declaredMimeType: "audio/x-m4a"
    });
    check(savedMp4.created, "save 应完成 begin + materialize");
    equal(savedMp4.asset.originalName, "voice-note.m4a", "save 也必须 basename 化");
    equal(savedMp4.asset.mimeType, "audio/mp4", "M4A MIME 应规范为 audio/mp4");
    check(savedMp4.asset.storageKey.endsWith(".m4a"), "MP4/AAC 内容地址应使用 m4a");
    check(await storage.verify(savedMp4.file), "save 后的 M4A 应通过完整性校验");

    const stale = await storage.beginUpload(Readable.from(webm), { fileName: "stale.webm" });
    const fresh = await storage.beginUpload(Readable.from(webm), { fileName: "fresh.webm" });
    const old = new Date(Date.now() - 10_000);
    await fs.promises.utimes(path.join(root, ".staging", stale.uploadId), old, old);
    const trashForGc = await storage.quarantine(savedMp4.file.storageKey);
    const gc = await storage.garbageCollect({ now: Date.now(), staleStageMs: 5_000, trashGraceMs: 0 });
    check(gc.stagingRemoved.includes(stale.uploadId), "GC 应清除陈旧 staging");
    check(!gc.stagingRemoved.includes(fresh.uploadId), "GC 不应清除新 staging");
    check(gc.trashRemoved.includes(savedMp4.file.storageKey), "GC 应清除到期 trash");
    equal(fs.existsSync(path.join(root, ".staging", stale.uploadId)), false, "陈旧 stage 应物理删除");
    equal(fs.existsSync(path.join(root, ".staging", fresh.uploadId)), true, "新 stage 应保留");
    equal(await storage.restoreQuarantined(trashForGc), null, "GC 清理后隔离项不应恢复");
    await storage.discardUpload(fresh.uploadId);

    await rejectAsync(() => storage.beginUpload(Readable.from(webm), { declaredMimeType: "audio/mp4" }), "VOICE_MIME_MISMATCH", 415, "伪 MIME 上传应拒绝");
    equal((await fs.promises.readdir(path.join(root, ".staging"))).length, 0, "失败上传不能留下 stage");
    assert.throws(() => storage.resolveStorageKey("../outside.webm"), (error) => error?.code === "VOICE_STORAGE_KEY_INVALID", "路径穿越 storageKey 必须拒绝");
    assertions += 1;
    await rejectAsync(() => storage.stat(`ready/00/${"0".repeat(64)}.webm`), "VOICE_NOT_FOUND", 404, "不存在的内容地址应返回 404");
    await assert.rejects(() => storage.restoreQuarantined({ ...token, trashKey: "../escape" }), (error) => error?.statusCode === 400, "伪造 trash token 必须拒绝");
    assertions += 1;

    const smallRoot = path.join(temporaryRoot, "small");
    const small = createVoiceStorage({ root: smallRoot, maxBytes: webm.length - 1 });
    await rejectAsync(() => small.beginUpload(Readable.from(webm), { fileName: "large.webm" }), "VOICE_TOO_LARGE", 413, "流式硬限应在解析前终止写入");
    equal((await fs.promises.readdir(path.join(smallRoot, ".staging"))).length, 0, "超限流不能留下临时文件");

    console.log(`Voice storage checks passed: ${assertions} assertions.`);
  } finally {
    await fs.promises.rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function rejectAsync(operation, code, statusCode, message) {
  await assert.rejects(operation, (error) => error?.code === code && error?.statusCode === statusCode, message);
  assertions += 1;
}

async function readStream(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function countReadyFiles(root) {
  let count = 0;
  const ready = path.join(root, "ready");
  for (const shard of fs.readdirSync(ready, { withFileTypes: true })) {
    if (!shard.isDirectory()) continue;
    count += fs.readdirSync(path.join(ready, shard.name), { withFileTypes: true }).filter((entry) => entry.isFile()).length;
  }
  return count;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
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
