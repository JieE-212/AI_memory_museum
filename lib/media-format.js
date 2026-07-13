"use strict";

const DEFAULT_MAX_BYTES = 15 * 1024 * 1024;
const DEFAULT_MAX_PIXELS = 40 * 1000 * 1000;
const MIME_TO_EXTENSION = Object.freeze({
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp"
});
const SUPPORTED_MIME_TYPES = Object.freeze(Object.keys(MIME_TO_EXTENSION));
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CRC32_TABLE = buildCrc32Table();

/**
 * Inspect an untrusted image from its bytes rather than its file name or declared MIME type.
 * This is a structural validation boundary, not a replacement for decoding before rendering.
 *
 * @param {Buffer|Uint8Array} inputBuffer
 * @param {{maxBytes?: number, maxPixels?: number, allowedMimeTypes?: string[]|Set<string>}} [options]
 * @returns {{mimeType: string, extension: string, width: number, height: number, pixels: number, byteSize: number, animated: boolean}}
 */
function inspectImage(inputBuffer, options = {}) {
  const buffer = toBuffer(inputBuffer);
  const maxBytes = normalizeLimit(options.maxBytes, DEFAULT_MAX_BYTES, "maxBytes");
  const maxPixels = normalizeLimit(options.maxPixels, DEFAULT_MAX_PIXELS, "maxPixels");
  const allowedMimeTypes = normalizeAllowedMimeTypes(options.allowedMimeTypes);

  if (buffer.length === 0) fail("图片文件为空。", "IMAGE_EMPTY");
  if (buffer.length > maxBytes) fail("图片文件超过允许的大小。", "IMAGE_TOO_LARGE");

  const mimeType = detectMimeType(buffer);
  if (!mimeType) fail(unsupportedMessage(buffer), "IMAGE_UNSUPPORTED_TYPE");
  if (!allowedMimeTypes.has(mimeType)) {
    fail(`图片真实格式 ${mimeType} 不在允许范围内。`, "IMAGE_TYPE_NOT_ALLOWED");
  }

  let parsed;
  if (mimeType === "image/png") parsed = parsePng(buffer);
  else if (mimeType === "image/jpeg") parsed = parseJpeg(buffer);
  else parsed = parseWebp(buffer);

  assertDimensions(parsed.width, parsed.height, maxPixels);
  return Object.freeze({
    mimeType,
    extension: MIME_TO_EXTENSION[mimeType],
    width: parsed.width,
    height: parsed.height,
    pixels: parsed.width * parsed.height,
    byteSize: buffer.length,
    animated: Boolean(parsed.animated)
  });
}

/**
 * Validate a generated thumbnail/display derivative before it is persisted.
 * Derived media must be a static WebP and may optionally be checked against exact or maximum dimensions.
 *
 * @param {Buffer|Uint8Array} inputBuffer
 * @param {{maxBytes?: number, maxPixels?: number, expectedWidth?: number, expectedHeight?: number, maxWidth?: number, maxHeight?: number}} [options]
 */
function validateDerivedWebp(inputBuffer, options = {}) {
  const info = inspectImage(inputBuffer, {
    maxBytes: options.maxBytes,
    maxPixels: options.maxPixels,
    allowedMimeTypes: ["image/webp"]
  });
  if (info.animated) fail("派生 WebP 不能是动画。", "DERIVED_WEBP_ANIMATED");

  const expectedWidth = normalizeOptionalDimension(options.expectedWidth, "expectedWidth");
  const expectedHeight = normalizeOptionalDimension(options.expectedHeight, "expectedHeight");
  const maxWidth = normalizeOptionalDimension(options.maxWidth, "maxWidth");
  const maxHeight = normalizeOptionalDimension(options.maxHeight, "maxHeight");
  if (expectedWidth !== null && info.width !== expectedWidth) {
    fail("派生 WebP 的宽度与预期不一致。", "DERIVED_WEBP_DIMENSIONS_MISMATCH");
  }
  if (expectedHeight !== null && info.height !== expectedHeight) {
    fail("派生 WebP 的高度与预期不一致。", "DERIVED_WEBP_DIMENSIONS_MISMATCH");
  }
  if ((maxWidth !== null && info.width > maxWidth) || (maxHeight !== null && info.height > maxHeight)) {
    fail("派生 WebP 的尺寸超过允许范围。", "DERIVED_WEBP_DIMENSIONS_EXCEEDED");
  }
  return info;
}

function parsePng(buffer) {
  if (buffer.length < 33) truncated("PNG 文件头不完整。");
  let offset = PNG_SIGNATURE.length;
  let width = 0;
  let height = 0;
  let sawHeader = false;
  let sawImageData = false;
  let sawEnd = false;

  while (offset < buffer.length) {
    if (buffer.length - offset < 12) truncated("PNG 数据块不完整。");
    const length = buffer.readUInt32BE(offset);
    const typeStart = offset + 4;
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4;
    if (!Number.isSafeInteger(dataEnd) || chunkEnd > buffer.length) truncated("PNG 数据块长度超出文件边界。");

    const type = buffer.toString("ascii", typeStart, dataStart);
    if (!/^[A-Za-z]{4}$/.test(type)) fail("PNG 包含非法数据块类型。", "IMAGE_INVALID");
    const expectedCrc = buffer.readUInt32BE(dataEnd);
    const actualCrc = crc32(buffer, typeStart, dataEnd);
    if (expectedCrc !== actualCrc) fail(`PNG ${type} 数据块校验失败。`, "IMAGE_INVALID");

    if (!sawHeader && type !== "IHDR") fail("PNG 的首个数据块必须是 IHDR。", "IMAGE_INVALID");
    if (type === "IHDR") {
      if (sawHeader || length !== 13) fail("PNG 的 IHDR 数据块无效。", "IMAGE_INVALID");
      sawHeader = true;
      width = buffer.readUInt32BE(dataStart);
      height = buffer.readUInt32BE(dataStart + 4);
      validatePngHeader(buffer, dataStart, width, height);
    } else if (type === "IDAT") {
      if (!sawHeader || sawEnd) fail("PNG 的 IDAT 数据块顺序无效。", "IMAGE_INVALID");
      sawImageData = true;
    } else if (type === "IEND") {
      if (length !== 0 || !sawImageData) fail("PNG 的 IEND 数据块无效。", "IMAGE_INVALID");
      sawEnd = true;
      if (chunkEnd !== buffer.length) fail("PNG 结束标记后存在额外数据。", "IMAGE_INVALID");
    }

    offset = chunkEnd;
    if (sawEnd) break;
  }

  if (!sawEnd) truncated("PNG 缺少结束标记。");
  return { width, height, animated: false };
}

function validatePngHeader(buffer, dataStart, width, height) {
  if (width === 0 || height === 0 || width > 0x7fffffff || height > 0x7fffffff) {
    fail("PNG 图片尺寸无效。", "IMAGE_DIMENSIONS_INVALID");
  }
  const bitDepth = buffer[dataStart + 8];
  const colorType = buffer[dataStart + 9];
  const compression = buffer[dataStart + 10];
  const filter = buffer[dataStart + 11];
  const interlace = buffer[dataStart + 12];
  const allowedDepths = {
    0: [1, 2, 4, 8, 16],
    2: [8, 16],
    3: [1, 2, 4, 8],
    4: [8, 16],
    6: [8, 16]
  };
  if (!allowedDepths[colorType] || !allowedDepths[colorType].includes(bitDepth)) {
    fail("PNG 的颜色类型或位深无效。", "IMAGE_INVALID");
  }
  if (compression !== 0 || filter !== 0 || (interlace !== 0 && interlace !== 1)) {
    fail("PNG 使用了无效的压缩、过滤或隔行参数。", "IMAGE_INVALID");
  }
}

function parseJpeg(buffer) {
  if (buffer.length < 4) truncated("JPEG 文件头不完整。");
  let offset = 2;
  let width = 0;
  let height = 0;
  let inScan = false;
  let sawScan = false;
  let sawEnd = false;

  while (offset < buffer.length) {
    if (inScan) {
      const marker = findJpegScanMarker(buffer, offset);
      if (!marker) truncated("JPEG 扫描数据缺少结束标记。");
      offset = marker.offset;
      if (marker.code === 0xd9) {
        if (marker.after !== buffer.length) fail("JPEG 结束标记后存在额外数据。", "IMAGE_INVALID");
        sawEnd = true;
        break;
      }
      if (marker.code >= 0xd0 && marker.code <= 0xd7) {
        offset = marker.after;
        continue;
      }
      inScan = false;
    }

    if (buffer[offset] !== 0xff) fail("JPEG 标记结构无效。", "IMAGE_INVALID");
    const markerStart = offset;
    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
    if (offset >= buffer.length) truncated("JPEG 标记被截断。");
    const marker = buffer[offset];
    offset += 1;
    if (marker === 0x00) fail("JPEG 标记结构无效。", "IMAGE_INVALID");
    if (marker === 0xd9) {
      if (offset !== buffer.length) fail("JPEG 结束标记后存在额外数据。", "IMAGE_INVALID");
      sawEnd = true;
      break;
    }
    if (marker === 0xd8) fail("JPEG 包含重复的起始标记。", "IMAGE_INVALID");
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (buffer.length - offset < 2) truncated("JPEG 数据段长度被截断。");

    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2) fail("JPEG 数据段长度无效。", "IMAGE_INVALID");
    const segmentEnd = offset + segmentLength;
    if (segmentEnd > buffer.length) truncated("JPEG 数据段超出文件边界。");

    if (isJpegStartOfFrame(marker)) {
      if (segmentLength < 8) fail("JPEG 尺寸帧无效。", "IMAGE_INVALID");
      const precision = buffer[offset + 2];
      const frameHeight = buffer.readUInt16BE(offset + 3);
      const frameWidth = buffer.readUInt16BE(offset + 5);
      const components = buffer[offset + 7];
      if (precision === 0 || components === 0 || segmentLength < 8 + (3 * components)) {
        fail("JPEG 尺寸帧无效。", "IMAGE_INVALID");
      }
      if (width && (width !== frameWidth || height !== frameHeight)) {
        fail("JPEG 包含相互矛盾的尺寸帧。", "IMAGE_INVALID");
      }
      width = frameWidth;
      height = frameHeight;
    }

    if (marker === 0xda) {
      const components = segmentLength >= 3 ? buffer[offset + 2] : 0;
      if (!width || !height || components === 0 || segmentLength < 6 + (2 * components)) {
        fail("JPEG 扫描数据头无效。", "IMAGE_INVALID");
      }
      sawScan = true;
      inScan = true;
    }
    offset = segmentEnd;

    if (offset === markerStart) fail("JPEG 解析未能前进。", "IMAGE_INVALID");
  }

  if (!sawScan) fail("JPEG 缺少扫描数据。", "IMAGE_INVALID");
  if (!sawEnd) truncated("JPEG 缺少结束标记。");
  return { width, height, animated: false };
}

function findJpegScanMarker(buffer, start) {
  let offset = start;
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const markerOffset = offset;
    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
    if (offset >= buffer.length) return null;
    const code = buffer[offset];
    if (code === 0x00) {
      offset += 1;
      continue;
    }
    return { offset: markerOffset, after: offset + 1, code };
  }
  return null;
}

function isJpegStartOfFrame(marker) {
  return marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
}

function parseWebp(buffer) {
  if (buffer.length < 20) truncated("WebP 文件头不完整。");
  const declaredSize = buffer.readUInt32LE(4);
  const expectedSize = declaredSize + 8;
  if (declaredSize < 4) fail("WebP RIFF 长度无效。", "IMAGE_INVALID");
  if (expectedSize > buffer.length) truncated("WebP RIFF 数据被截断。");
  if (expectedSize !== buffer.length) fail("WebP RIFF 结束后存在额外数据。", "IMAGE_INVALID");

  let offset = 12;
  let canvas = null;
  let payload = null;
  let sawAnimationHeader = false;
  let sawAnimationFrame = false;
  let animated = false;
  let chunkIndex = 0;

  while (offset < buffer.length) {
    if (buffer.length - offset < 8) truncated("WebP 数据块头被截断。");
    const type = buffer.toString("ascii", offset, offset + 4);
    if (!/^[\x20-\x7e]{4}$/.test(type)) fail("WebP 包含非法数据块类型。", "IMAGE_INVALID");
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + chunkSize;
    const chunkEnd = dataEnd + (chunkSize % 2);
    if (!Number.isSafeInteger(dataEnd) || chunkEnd > buffer.length) truncated("WebP 数据块超出文件边界。");

    if (type === "VP8X") {
      if (canvas || chunkIndex !== 0 || chunkSize !== 10) fail("WebP VP8X 数据块无效。", "IMAGE_INVALID");
      const flags = buffer[dataStart];
      if ((flags & 0xc1) !== 0 || buffer[dataStart + 1] || buffer[dataStart + 2] || buffer[dataStart + 3]) {
        fail("WebP VP8X 保留位无效。", "IMAGE_INVALID");
      }
      canvas = {
        width: readUInt24LE(buffer, dataStart + 4) + 1,
        height: readUInt24LE(buffer, dataStart + 7) + 1
      };
      animated = Boolean(flags & 0x02);
    } else if (type === "VP8 ") {
      if (payload) fail("WebP 包含多个顶层图像数据块。", "IMAGE_INVALID");
      payload = parseVp8Payload(buffer, dataStart, chunkSize);
    } else if (type === "VP8L") {
      if (payload) fail("WebP 包含多个顶层图像数据块。", "IMAGE_INVALID");
      payload = parseVp8lPayload(buffer, dataStart, chunkSize);
    } else if (type === "ANIM") {
      sawAnimationHeader = true;
    } else if (type === "ANMF") {
      if (chunkSize < 16) fail("WebP 动画帧无效。", "IMAGE_INVALID");
      sawAnimationFrame = true;
    }

    offset = chunkEnd;
    chunkIndex += 1;
  }

  if (offset !== buffer.length) truncated("WebP 数据块填充字节被截断。");
  if (animated) {
    if (!canvas || !sawAnimationHeader || !sawAnimationFrame) fail("WebP 动画结构不完整。", "IMAGE_INVALID");
    return { ...canvas, animated: true };
  }
  if (!payload) fail("WebP 缺少图像数据块。", "IMAGE_INVALID");
  if (canvas && (canvas.width !== payload.width || canvas.height !== payload.height)) {
    fail("WebP 画布与图像数据的尺寸不一致。", "IMAGE_INVALID");
  }
  return { ...(canvas || payload), animated: false };
}

function parseVp8Payload(buffer, start, size) {
  if (size < 10) truncated("WebP VP8 帧头不完整。");
  if ((buffer[start] & 0x01) !== 0) fail("WebP 顶层 VP8 帧不是关键帧。", "IMAGE_INVALID");
  if (buffer[start + 3] !== 0x9d || buffer[start + 4] !== 0x01 || buffer[start + 5] !== 0x2a) {
    fail("WebP VP8 帧同步码无效。", "IMAGE_INVALID");
  }
  return {
    width: buffer.readUInt16LE(start + 6) & 0x3fff,
    height: buffer.readUInt16LE(start + 8) & 0x3fff
  };
}

function parseVp8lPayload(buffer, start, size) {
  if (size < 5) truncated("WebP VP8L 帧头不完整。");
  if (buffer[start] !== 0x2f) fail("WebP VP8L 签名字节无效。", "IMAGE_INVALID");
  const bits = buffer.readUInt32LE(start + 1);
  if ((bits >>> 29) !== 0) fail("WebP VP8L 版本无效。", "IMAGE_INVALID");
  return {
    width: (bits & 0x3fff) + 1,
    height: ((bits >>> 14) & 0x3fff) + 1
  };
}

function detectMimeType(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return "image/png";
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xd8) return "image/jpeg";
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
    return "image/webp";
  }
  return "";
}

function unsupportedMessage(buffer) {
  if (buffer.length >= 6 && ["GIF87a", "GIF89a"].includes(buffer.toString("ascii", 0, 6))) {
    return "暂不支持 GIF 图片。";
  }
  const prefix = buffer.subarray(0, Math.min(buffer.length, 1024)).toString("utf8")
    .replace(/^\ufeff/, "")
    .trimStart();
  if (/^(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg(?:\s|>)/i.test(prefix)) {
    return "出于安全考虑，不支持 SVG 图片。";
  }
  return "仅支持真实的 JPEG、PNG 或 WebP 图片。";
}

function assertDimensions(width, height, maxPixels) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    fail("图片尺寸无效。", "IMAGE_DIMENSIONS_INVALID");
  }
  if (width > Math.floor(Number.MAX_SAFE_INTEGER / height)) {
    fail("图片像素数量无效。", "IMAGE_DIMENSIONS_INVALID");
  }
  if (width > Math.floor(maxPixels / height)) fail("图片像素数量超过允许范围。", "IMAGE_TOO_MANY_PIXELS");
}

function normalizeAllowedMimeTypes(value) {
  if (value === undefined) return new Set(SUPPORTED_MIME_TYPES);
  if (!Array.isArray(value) && !(value instanceof Set)) {
    fail("allowedMimeTypes 必须是数组或 Set。", "IMAGE_OPTIONS_INVALID");
  }
  const normalized = new Set(Array.from(value, (item) => String(item || "").trim().toLowerCase()).filter(Boolean));
  if (!normalized.size) fail("allowedMimeTypes 不能为空。", "IMAGE_OPTIONS_INVALID");
  return normalized;
}

function normalizeLimit(value, fallback, name) {
  if (value === undefined) return fallback;
  if (value === Infinity) return value;
  if (!Number.isSafeInteger(value) || value <= 0) fail(`${name} 必须是正整数。`, "IMAGE_OPTIONS_INVALID");
  return value;
}

function normalizeOptionalDimension(value, name) {
  if (value === undefined || value === null) return null;
  if (!Number.isSafeInteger(value) || value <= 0) fail(`${name} 必须是正整数。`, "IMAGE_OPTIONS_INVALID");
  return value;
}

function toBuffer(input) {
  if (Buffer.isBuffer(input)) return input;
  if (input instanceof Uint8Array) return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  fail("图片内容必须是 Buffer 或 Uint8Array。", "IMAGE_INPUT_INVALID");
}

function readUInt24LE(buffer, offset) {
  return buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16);
}

function crc32(buffer, start, end) {
  let crc = 0xffffffff;
  for (let index = start; index < end; index += 1) {
    crc = CRC32_TABLE[(crc ^ buffer[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildCrc32Table() {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    table[index] = value >>> 0;
  }
  return table;
}

function truncated(message) {
  fail(message, "IMAGE_TRUNCATED");
}

function fail(message, code) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

module.exports = {
  inspectImage,
  validateDerivedWebp
};
