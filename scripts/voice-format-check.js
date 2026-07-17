"use strict";

const assert = require("assert");
const { inspectVoice, detectVoiceMimeType } = require("../lib/voice-format");
const {
  MAX_VOICE_BYTES,
  MAX_VOICE_DURATION_MS,
  MAX_VOICES_PER_MEMORY,
  DEFAULT_VOICE_POLICY,
  normalizeVoicePolicy
} = require("../lib/voice-policy");

let assertions = 0;
const check = (value, message) => { assert.ok(value, message); assertions += 1; };
const equal = (actual, expected, message) => { assert.strictEqual(actual, expected, message); assertions += 1; };

const webm = makeWebm({ durationMs: 1_000 });
const webmInfo = inspectVoice(webm, { declaredMimeType: "audio/webm; codecs=opus" });
equal(webmInfo.mimeType, "audio/webm", "WebM 应由真字节识别");
equal(webmInfo.container, "webm", "WebM 容器名称应稳定");
equal(webmInfo.codec, "opus", "WebM 必须识别为 Opus");
equal(webmInfo.extension, "webm", "WebM 扩展名应稳定");
equal(webmInfo.durationMs, 1_000, "WebM Duration 应按 TimecodeScale 换算");
equal(webmInfo.byteSize, webm.length, "WebM 大小应来自真字节");
equal(webmInfo.audioTracks, 1, "WebM 只接受一条音频轨");
equal(detectVoiceMimeType(webm), "audio/webm", "WebM 探测不依赖文件名");

const observedWebm = inspectVoice(makeWebm({ durationMs: null, clusterTimestamp: 100 }));
equal(observedWebm.durationMs, 120, "缺少 Duration 时应从 Cluster 与 Opus 包推导时长");
equal(inspectVoice(makeWebm({ unknownSegmentSize: true })).mimeType, "audio/webm", "应接受浏览器常见的未知长度 Segment");
equal(inspectVoice(new Uint8Array(webm)).codec, "opus", "Uint8Array 输入应受支持");
equal(inspectVoice(webm, { declaredMimeType: "application/octet-stream" }).mimeType, "audio/webm", "通用二进制声明应允许真字节判型");

const mp4 = makeMp4({ durationMs: 1_250 });
const mp4Info = inspectVoice(mp4, { declaredMimeType: "audio/mp4" });
equal(mp4Info.mimeType, "audio/mp4", "M4A 应由真字节识别为 audio/mp4");
equal(mp4Info.container, "mp4", "MP4 容器名称应稳定");
equal(mp4Info.codec, "aac", "mp4a/esds 应验证为 AAC");
equal(mp4Info.extension, "m4a", "MP4/AAC 应使用 m4a 扩展名");
equal(mp4Info.durationMs, 1_250, "mdhd 时长应按 timescale 换算");
equal(mp4Info.audioTracks, 1, "MP4 只接受一条音频轨");
equal(detectVoiceMimeType(mp4), "audio/mp4", "MP4 探测不依赖文件名");
equal(inspectVoice(mp4, { declaredMimeType: "audio/x-m4a" }).mimeType, "audio/mp4", "常见 M4A MIME 别名应规范化");

reject(() => inspectVoice(Buffer.alloc(0)), "VOICE_EMPTY", 400, "空文件必须拒绝");
reject(() => inspectVoice(Buffer.from("not audio")), "VOICE_UNSUPPORTED_TYPE", 415, "随机字节不能伪装声音");
reject(() => inspectVoice(webm, { declaredMimeType: "audio/mp4" }), "VOICE_MIME_MISMATCH", 415, "伪 MIME 必须拒绝");
reject(() => inspectVoice(mp4, { declaredMimeType: "audio/webm" }), "VOICE_MIME_MISMATCH", 415, "反向伪 MIME 必须拒绝");
reject(() => inspectVoice(webm, { declaredMimeType: "video/webm" }), "VOICE_MIME_MISMATCH", 415, "视频 MIME 不能用于声音上传");
reject(() => inspectVoice(webm, { maxBytes: webm.length - 1 }), "VOICE_TOO_LARGE", 413, "调用方更小的字节上限应生效");
reject(() => inspectVoice(webm, { maxDurationMs: 999 }), "VOICE_DURATION_EXCEEDED", 413, "调用方更小时长上限应生效");
reject(() => inspectVoice(makeWebm({ durationMs: 180_001 })), "VOICE_DURATION_EXCEEDED", 413, "WebM 超过三分钟必须拒绝");
reject(() => inspectVoice(makeMp4({ durationMs: 180_001 })), "VOICE_DURATION_EXCEEDED", 413, "MP4 超过三分钟必须拒绝");
reject(() => inspectVoice(makeMp4({ durationMs: 0 })), "VOICE_DURATION_INVALID", 400, "MP4 零时长必须拒绝");
reject(() => inspectVoice(makeWebm({ video: true })), "VOICE_VIDEO_TRACK_FORBIDDEN", 415, "WebM 视频轨必须拒绝");
reject(() => inspectVoice(makeMp4({ video: true })), "VOICE_VIDEO_TRACK_FORBIDDEN", 415, "MP4 视频轨必须拒绝");
reject(() => inspectVoice(makeWebm({ codecId: "A_VORBIS" })), "VOICE_CODEC_UNSUPPORTED", 415, "WebM 非 Opus 轨必须拒绝");
reject(() => inspectVoice(makeMp4({ aacObjectType: 0x6b })), "VOICE_CODEC_UNSUPPORTED", 415, "mp4a 非 AAC 对象类型必须拒绝");
reject(() => inspectVoice(makeWebm({ includeAudioBlock: false })), "VOICE_AUDIO_DATA_MISSING", 400, "WebM 无音频块必须拒绝");
reject(() => inspectVoice(makeMp4({ sampleCount: 0 })), "VOICE_MP4_INVALID", 400, "MP4 无样本必须拒绝");
reject(() => inspectVoice(webm.subarray(0, webm.length - 1)), "VOICE_WEBM_TRUNCATED", 400, "截断 WebM 必须拒绝");
reject(() => inspectVoice(mp4.subarray(0, mp4.length - 1)), "VOICE_MP4_TRUNCATED", 400, "截断 MP4 必须拒绝");
reject(() => inspectVoice(makeWebm({ invalidOpusHead: true })), "VOICE_OPUS_INVALID", 400, "伪 OpusHead 必须拒绝");
reject(() => inspectVoice(makeMp4({ mdatBytes: 2, sampleSize: 4 })), "VOICE_MP4_TRUNCATED", 400, "样本大小不能越过 mdat 边界");
reject(() => inspectVoice(makeMp4({ majorBrand: "qt  ", compatibleBrands: [] })), "VOICE_UNSUPPORTED_TYPE", 415, "非白名单 ISO BMFF 品牌必须拒绝");
reject(() => inspectVoice(makeWebm({ secondAudio: true })), "VOICE_AUDIO_TRACK_INVALID", 415, "多音轨 WebM 必须拒绝");

equal(MAX_VOICE_BYTES, 12 * 1024 * 1024, "硬字节限制应为 12 MiB");
equal(MAX_VOICE_DURATION_MS, 180_000, "硬时长限制应为 3 分钟");
equal(MAX_VOICES_PER_MEMORY, 3, "单条记忆最多三段声音");
equal(DEFAULT_VOICE_POLICY.maxVoicesPerMemory, 3, "默认 policy 应暴露声音数量上限");
equal(normalizeVoicePolicy({ maxBytes: Number.MAX_SAFE_INTEGER }).maxBytes, MAX_VOICE_BYTES, "配置不能抬高硬字节上限");
equal(normalizeVoicePolicy({ maxDurationMs: 999_999 }).maxDurationMs, MAX_VOICE_DURATION_MS, "配置不能抬高硬时长上限");
equal(normalizeVoicePolicy({ maxVoicesPerMemory: 99 }).maxVoicesPerMemory, 3, "配置不能抬高单记忆声音上限");
equal(normalizeVoicePolicy({ maxBytes: 1024 }).maxBytes, 1024, "测试或部署可收紧字节上限");
check(Object.isFrozen(DEFAULT_VOICE_POLICY), "默认 policy 应不可变");
check(Object.isFrozen(webmInfo), "格式检查结果应不可变");

console.log(`Voice format checks passed: ${assertions} assertions.`);

function reject(operation, code, statusCode, message) {
  assert.throws(operation, (error) => error?.code === code && error?.statusCode === statusCode, message);
  assertions += 1;
}

function makeWebm(options = {}) {
  const durationMs = options.durationMs === undefined ? 1_000 : options.durationMs;
  const infoParts = [ebmlUInt("2ad7b1", 1_000_000)];
  if (durationMs !== null) infoParts.push(ebmlFloat("4489", durationMs));
  const info = ebmlElement("1549a966", Buffer.concat(infoParts));
  const tracks = [makeWebmTrack({
    number: 1,
    type: 2,
    codecId: options.codecId || "A_OPUS",
    invalidOpusHead: options.invalidOpusHead
  })];
  if (options.video) tracks.push(makeWebmTrack({ number: 2, type: 1, codecId: "V_VP9" }));
  if (options.secondAudio) tracks.push(makeWebmTrack({ number: 2, type: 2, codecId: "A_OPUS" }));
  const trackElement = ebmlElement("1654ae6b", Buffer.concat(tracks));
  const clusterParts = [ebmlUInt("e7", options.clusterTimestamp || 0)];
  if (options.includeAudioBlock !== false) {
    clusterParts.push(ebmlElement("a3", Buffer.from([0x81, 0x00, 0x00, 0x80, 0xf8])));
  }
  const cluster = ebmlElement("1f43b675", Buffer.concat(clusterParts));
  const segmentPayload = Buffer.concat([info, trackElement, cluster]);
  const segment = options.unknownSegmentSize
    ? Buffer.concat([Buffer.from("18538067", "hex"), Buffer.from([0xff]), segmentPayload])
    : ebmlElement("18538067", segmentPayload);
  const header = ebmlElement("1a45dfa3", ebmlElement("4282", Buffer.from("webm")));
  return Buffer.concat([header, segment]);
}

function makeWebmTrack({ number, type, codecId, invalidOpusHead = false }) {
  const parts = [
    ebmlUInt("d7", number),
    ebmlUInt("83", type),
    ebmlElement("86", Buffer.from(codecId, "ascii"))
  ];
  if (type === 2) {
    const opusHead = Buffer.alloc(19);
    opusHead.write(invalidOpusHead ? "NopeHead" : "OpusHead", 0, "ascii");
    opusHead[8] = 1;
    opusHead[9] = 1;
    opusHead.writeUInt32LE(48_000, 12);
    parts.push(ebmlElement("63a2", opusHead));
    parts.push(ebmlElement("e1", Buffer.concat([ebmlUInt("9f", 1), ebmlFloat("b5", 48_000)])));
  }
  return ebmlElement("ae", Buffer.concat(parts));
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

function ebmlElement(id, payload) {
  return Buffer.concat([Buffer.from(id, "hex"), encodeEbmlSize(payload.length), payload]);
}

function encodeEbmlSize(value) {
  const number = BigInt(value);
  for (let width = 1; width <= 8; width += 1) {
    const maximum = (1n << BigInt(7 * width)) - 1n;
    if (number >= maximum) continue;
    let marked = number | (1n << BigInt(7 * width));
    const output = Buffer.alloc(width);
    for (let index = width - 1; index >= 0; index -= 1) {
      output[index] = Number(marked & 0xffn);
      marked >>= 8n;
    }
    return output;
  }
  throw new Error("fixture size too large");
}

function makeMp4(options = {}) {
  const durationMs = options.durationMs === undefined ? 1_000 : options.durationMs;
  const timescale = 48_000;
  const duration = Math.round(durationMs * timescale / 1_000);
  const sampleCount = options.sampleCount === undefined ? 1 : options.sampleCount;
  const sampleSize = options.sampleSize === undefined ? 4 : options.sampleSize;
  const audioHeader = Buffer.alloc(28);
  audioHeader.writeUInt16BE(1, 6);
  audioHeader.writeUInt16BE(2, 16);
  audioHeader.writeUInt16BE(16, 18);
  audioHeader.writeUInt32BE(48_000 * 65_536, 24);
  const esds = mp4Box("esds", Buffer.concat([Buffer.alloc(4), makeEsDescriptor(options.aacObjectType || 0x40)]));
  const mp4a = mp4Box("mp4a", Buffer.concat([audioHeader, esds]));
  const stsd = mp4Box("stsd", Buffer.concat([Buffer.alloc(4), u32(1), mp4a]));
  const stsz = mp4Box("stsz", Buffer.concat([Buffer.alloc(4), u32(sampleSize), u32(sampleCount)]));
  const stbl = mp4Box("stbl", Buffer.concat([stsd, stsz]));
  const minf = mp4Box("minf", stbl);
  const mdhdData = Buffer.alloc(24);
  mdhdData.writeUInt32BE(timescale, 12);
  mdhdData.writeUInt32BE(duration, 16);
  const mdhd = mp4Box("mdhd", mdhdData);
  const hdlrData = Buffer.alloc(24);
  hdlrData.write("soun", 8, "ascii");
  const hdlr = mp4Box("hdlr", hdlrData);
  const mdia = mp4Box("mdia", Buffer.concat([mdhd, hdlr, minf]));
  const tracks = [mp4Box("trak", mdia)];
  if (options.video) {
    const videoHandler = Buffer.alloc(24);
    videoHandler.write("vide", 8, "ascii");
    tracks.push(mp4Box("trak", mp4Box("mdia", mp4Box("hdlr", videoHandler))));
  }
  const moov = mp4Box("moov", Buffer.concat(tracks));
  const majorBrand = options.majorBrand || "M4A ";
  const compatibleBrands = options.compatibleBrands || ["isom", "mp42"];
  const ftyp = mp4Box("ftyp", Buffer.concat([
    Buffer.from(majorBrand, "ascii"),
    Buffer.alloc(4),
    ...compatibleBrands.map((brand) => Buffer.from(brand, "ascii"))
  ]));
  const mdatBytes = options.mdatBytes === undefined ? Math.max(1, sampleSize * Math.max(1, sampleCount)) : options.mdatBytes;
  return Buffer.concat([ftyp, moov, mp4Box("mdat", Buffer.alloc(mdatBytes, 0x55))]);
}

function makeEsDescriptor(objectType) {
  const asc = descriptor(0x05, Buffer.from([0x12, 0x10]));
  const decoderPayload = Buffer.concat([
    Buffer.from([objectType, 0x15, 0x00, 0x00, 0x00]),
    Buffer.alloc(8),
    asc
  ]);
  const decoder = descriptor(0x04, decoderPayload);
  return descriptor(0x03, Buffer.concat([Buffer.from([0x00, 0x01, 0x00]), decoder]));
}

function descriptor(tag, payload) {
  if (payload.length >= 128) throw new Error("fixture descriptor too large");
  return Buffer.concat([Buffer.from([tag, payload.length]), payload]);
}

function mp4Box(type, payload) {
  return Buffer.concat([u32(payload.length + 8), Buffer.from(type, "ascii"), payload]);
}

function u32(value) {
  const result = Buffer.alloc(4);
  result.writeUInt32BE(value);
  return result;
}
