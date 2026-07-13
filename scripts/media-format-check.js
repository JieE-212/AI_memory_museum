"use strict";

const assert = require("node:assert/strict");
const zlib = require("node:zlib");
const { inspectImage, validateDerivedWebp } = require("../lib/media-format");

let assertions = 0;

function check(value, message) {
  assert.ok(value, message);
  assertions += 1;
}

function equal(actual, expected, message) {
  assert.equal(actual, expected, message);
  assertions += 1;
}

function rejects(code, action, message) {
  assert.throws(action, (error) => error && error.code === code, message);
  assertions += 1;
}

const png = createPng(3, 2);
const pngInfo = inspectImage(png, { maxBytes: 4096, maxPixels: 100 });
equal(pngInfo.mimeType, "image/png", "应从 PNG 签名识别真实 MIME");
equal(pngInfo.width, 3, "应读取 PNG 宽度");
equal(pngInfo.height, 2, "应读取 PNG 高度");
equal(pngInfo.pixels, 6, "应计算 PNG 像素数");

const jpeg = createJpeg(7, 5);
const jpegInfo = inspectImage(jpeg);
equal(jpegInfo.mimeType, "image/jpeg", "应从 JPEG 签名识别真实 MIME");
equal(jpegInfo.width, 7, "应读取 JPEG SOF 宽度");
equal(jpegInfo.height, 5, "应读取 JPEG SOF 高度");
const jpegWithPostScanSegment = Buffer.concat([
  jpeg.subarray(0, jpeg.length - 2),
  jpegSegment(0xfe, Buffer.alloc(0)),
  Buffer.from([0xff, 0xd9])
]);
equal(inspectImage(jpegWithPostScanSegment).width, 7, "应接受扫描后带合法空 COM 段并正常结束的 JPEG");
rejects(
  "IMAGE_INVALID",
  () => inspectImage(Buffer.concat([jpegWithPostScanSegment, Buffer.from("trailing")])),
  "扫描后数据段路径同样必须拒绝 EOI 后尾随载荷"
);

const vp8 = createVp8Webp(11, 9);
const vp8Info = inspectImage(vp8);
equal(vp8Info.mimeType, "image/webp", "应从 RIFF/WEBP 识别真实 MIME");
equal(vp8Info.width, 11, "应读取 VP8 宽度");
equal(vp8Info.height, 9, "应读取 VP8 高度");

const vp8lInfo = inspectImage(createVp8lWebp(13, 8));
equal(vp8lInfo.width, 13, "应读取 VP8L 宽度");
equal(vp8lInfo.height, 8, "应读取 VP8L 高度");

const vp8xInfo = inspectImage(createVp8xWebp(17, 12));
equal(vp8xInfo.width, 17, "应读取 VP8X 画布宽度");
equal(vp8xInfo.height, 12, "应读取 VP8X 画布高度");

rejects(
  "IMAGE_TYPE_NOT_ALLOWED",
  () => inspectImage(png, { allowedMimeTypes: ["image/jpeg"] }),
  "不能因调用方声称是 JPEG 就接受真实 PNG"
);
rejects("IMAGE_UNSUPPORTED_TYPE", () => inspectImage(Buffer.from("GIF89a\x01\x00\x01\x00", "binary")), "应拒绝 GIF");
rejects("IMAGE_UNSUPPORTED_TYPE", () => inspectImage(Buffer.from("  <?xml version=\"1.0\"?><svg></svg>")), "应拒绝 SVG");
rejects("IMAGE_UNSUPPORTED_TYPE", () => inspectImage(Buffer.from("not-an-image")), "应拒绝未知魔数");

rejects("IMAGE_TRUNCATED", () => inspectImage(png.subarray(0, png.length - 1)), "应拒绝截断 PNG");
rejects("IMAGE_TRUNCATED", () => inspectImage(jpeg.subarray(0, jpeg.length - 1)), "应拒绝缺少 EOI 的 JPEG");
rejects("IMAGE_INVALID", () => inspectImage(Buffer.concat([jpeg, Buffer.from("<script>polyglot</script>")])), "应拒绝 EOI 后带尾随载荷的 JPEG");
rejects("IMAGE_TRUNCATED", () => inspectImage(vp8.subarray(0, vp8.length - 1)), "应拒绝截断 WebP");

const corruptPng = Buffer.from(png);
corruptPng[corruptPng.length - 5] ^= 0x01;
rejects("IMAGE_INVALID", () => inspectImage(corruptPng), "应拒绝 CRC 错误的 PNG");
rejects("IMAGE_DIMENSIONS_INVALID", () => inspectImage(createPng(0, 2, true)), "应拒绝零尺寸图片");
rejects(
  "IMAGE_TOO_MANY_PIXELS",
  () => inspectImage(createPng(10000, 10000, true), { maxPixels: 20_000_000 }),
  "应在不解码大画布的情况下拒绝像素炸弹"
);
rejects("IMAGE_TOO_LARGE", () => inspectImage(png, { maxBytes: png.length - 1 }), "应执行文件字节上限");

const derived = validateDerivedWebp(createVp8Webp(320, 180), {
  expectedWidth: 320,
  expectedHeight: 180,
  maxWidth: 640,
  maxHeight: 640
});
equal(derived.extension, "webp", "应接受尺寸符合预期的静态派生 WebP");
rejects(
  "DERIVED_WEBP_DIMENSIONS_MISMATCH",
  () => validateDerivedWebp(createVp8Webp(319, 180), { expectedWidth: 320 }),
  "应拒绝尺寸与预期不一致的派生 WebP"
);
rejects("IMAGE_TYPE_NOT_ALLOWED", () => validateDerivedWebp(png), "派生图片必须是真实 WebP");
check(Object.isFrozen(pngInfo), "校验结果应为不可变快照");

console.log(`Media format checks passed: ${assertions} assertions.`);

function createPng(width, height, headerOnlyPixels = false) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width >>> 0, 0);
  header.writeUInt32BE(height >>> 0, 4);
  header[8] = 8;
  header[9] = 6;
  const raw = headerOnlyPixels
    ? Buffer.alloc(0)
    : Buffer.alloc((1 + (width * 4)) * height);
  return Buffer.concat([
    signature,
    pngChunk("IHDR", header),
    pngChunk("IDAT", zlib.deflateSync(raw)),
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

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createJpeg(width, height) {
  const frame = Buffer.alloc(9);
  frame[0] = 8;
  frame.writeUInt16BE(height, 1);
  frame.writeUInt16BE(width, 3);
  frame[5] = 1;
  frame[6] = 1;
  frame[7] = 0x11;
  frame[8] = 0;
  const scan = Buffer.from([1, 1, 0, 0, 63, 0]);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    jpegSegment(0xc0, frame),
    jpegSegment(0xda, scan),
    Buffer.from([0x00, 0xff, 0xd9])
  ]);
}

function jpegSegment(marker, data) {
  const segment = Buffer.alloc(data.length + 4);
  segment[0] = 0xff;
  segment[1] = marker;
  segment.writeUInt16BE(data.length + 2, 2);
  data.copy(segment, 4);
  return segment;
}

function createVp8Webp(width, height) {
  const frame = Buffer.alloc(10);
  frame[3] = 0x9d;
  frame[4] = 0x01;
  frame[5] = 0x2a;
  frame.writeUInt16LE(width, 6);
  frame.writeUInt16LE(height, 8);
  return webp([riffChunk("VP8 ", frame)]);
}

function createVp8lWebp(width, height) {
  const frame = Buffer.alloc(5);
  frame[0] = 0x2f;
  frame.writeUInt32LE((width - 1) | ((height - 1) << 14), 1);
  return webp([riffChunk("VP8L", frame)]);
}

function createVp8xWebp(width, height) {
  const extended = Buffer.alloc(10);
  writeUInt24LE(extended, width - 1, 4);
  writeUInt24LE(extended, height - 1, 7);
  const frame = Buffer.alloc(10);
  frame[3] = 0x9d;
  frame[4] = 0x01;
  frame[5] = 0x2a;
  frame.writeUInt16LE(width, 6);
  frame.writeUInt16LE(height, 8);
  return webp([riffChunk("VP8X", extended), riffChunk("VP8 ", frame)]);
}

function riffChunk(type, data) {
  const padding = data.length % 2;
  const chunk = Buffer.alloc(8 + data.length + padding);
  chunk.write(type, 0, 4, "ascii");
  chunk.writeUInt32LE(data.length, 4);
  data.copy(chunk, 8);
  return chunk;
}

function webp(chunks) {
  const body = Buffer.concat([Buffer.from("WEBP", "ascii"), ...chunks]);
  const header = Buffer.alloc(8);
  header.write("RIFF", 0, 4, "ascii");
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

function writeUInt24LE(buffer, value, offset) {
  buffer[offset] = value & 0xff;
  buffer[offset + 1] = (value >>> 8) & 0xff;
  buffer[offset + 2] = (value >>> 16) & 0xff;
}
