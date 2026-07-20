"use strict";

const { createHash } = require("node:crypto");

const MEMORY_INBOX_SCHEMA_VERSION = 15;
const MAX_SOURCE_BYTES = 512 * 1024;
const MAX_EXCERPT_LENGTH = 4000;
const MAX_PREVIEW_CANDIDATES = 100;
const MAX_DISPLAY_NAME_LENGTH = 160;
const SOURCE_KIND = "local-text-document";
const SOURCE_KEY_PREFIX = "text-source:";
const ANCHOR_KEY_PREFIX = "text-anchor:";
const ENCODING = "utf-8";
const OFFSET_UNIT = "utf16-code-unit";
const RETENTION_MODE = "anchors-only";
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const SOURCE_KEY_PATTERN = /^text-source:[a-f0-9]{64}$/u;
const ANCHOR_KEY_PATTERN = /^text-anchor:[a-f0-9]{64}$/u;
const FORMATS = new Set(["txt", "markdown"]);
const MIME_BY_FORMAT = Object.freeze({
  txt: new Set(["", "text/plain"]),
  markdown: new Set(["", "text/markdown", "text/plain", "text/x-markdown"])
});
const EXTENSION_BY_FORMAT = Object.freeze({ txt: ".txt", markdown: ".md" });
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

function verifyMemoryInboxSelection(input = {}) {
  assertPlainObject(input, "selection");
  const allowedKeys = new Set([
    "displayName", "endOffset", "format", "mimeType", "rawBase64", "rawBytes", "startOffset"
  ]);
  const unknown = Object.keys(input).filter((key) => !allowedKeys.has(key));
  if (unknown.length) {
    throw memoryInboxError(`The selection contains unsupported field(s): ${unknown.join(", ")}.`, "MEMORY_INBOX_FIELD_SET_INVALID");
  }
  const hasRawBytes = Object.hasOwn(input, "rawBytes");
  const hasRawBase64 = Object.hasOwn(input, "rawBase64");
  if (hasRawBytes === hasRawBase64) {
    throw memoryInboxError("Provide exactly one of rawBytes or rawBase64.", "MEMORY_INBOX_SOURCE_BYTES_INVALID");
  }
  const displayName = requireDisplayName(input.displayName);
  const format = requireFormat(input.format);
  assertMatchingExtension(displayName, format);
  const mimeType = requireMimeType(input.mimeType, format);
  const bytes = requireRawBytes(hasRawBytes ? input.rawBytes : decodeBase64(input.rawBase64));
  const text = decodeUtf8(bytes);
  const rawSha256 = sha256(bytes);
  const source = Object.freeze({
    schemaVersion: MEMORY_INBOX_SCHEMA_VERSION,
    sourceKey: buildSourceKey(rawSha256),
    kind: SOURCE_KIND,
    displayName,
    format,
    mimeType,
    byteSize: bytes.length,
    decodedLength: text.length,
    rawSha256,
    decodedTextSha256: sha256Utf8(text),
    encoding: ENCODING,
    offsetUnit: OFFSET_UNIT,
    retentionMode: RETENTION_MODE
  });
  const anchor = buildTextAnchor(source, text, {
    startOffset: input.startOffset,
    endOffset: input.endOffset
  });
  return Object.freeze({ source, anchor, text });
}

function buildTextAnchor(source, text, range = {}) {
  const descriptor = requireSourceContract(source);
  if (typeof text !== "string" || text.length !== descriptor.decodedLength || sha256Utf8(text) !== descriptor.decodedTextSha256) {
    throw memoryInboxError("Decoded source text does not match its descriptor.", "MEMORY_INBOX_SOURCE_TEXT_MISMATCH");
  }
  const startOffset = requireOffset(range.startOffset, "startOffset", text.length);
  const endOffset = requireOffset(range.endOffset, "endOffset", text.length);
  if (endOffset <= startOffset) {
    throw memoryInboxError("The selected source range must not be empty.", "MEMORY_INBOX_RANGE_INVALID");
  }
  if (endOffset - startOffset > MAX_EXCERPT_LENGTH) {
    throw memoryInboxError(`A source excerpt may contain at most ${MAX_EXCERPT_LENGTH} UTF-16 code units.`, "MEMORY_INBOX_EXCERPT_TOO_LARGE", 413);
  }
  const excerpt = text.slice(startOffset, endOffset);
  if (!excerpt.trim()) {
    throw memoryInboxError("The selected source range contains only whitespace.", "MEMORY_INBOX_EXCERPT_EMPTY");
  }
  const excerptSha256 = sha256Utf8(excerpt);
  const identity = {
    sourceKey: descriptor.sourceKey,
    offsetUnit: OFFSET_UNIT,
    startOffset,
    endOffset,
    excerptSha256
  };
  const start = positionForOffset(text, startOffset);
  const end = positionForOffset(text, endOffset);
  return Object.freeze({
    schemaVersion: MEMORY_INBOX_SCHEMA_VERSION,
    anchorKey: buildAnchorKey(identity),
    sourceKey: descriptor.sourceKey,
    offsetUnit: OFFSET_UNIT,
    startOffset,
    endOffset,
    startLine: start.line,
    startColumn: start.column,
    endLine: end.line,
    endColumn: end.column,
    excerpt,
    excerptSha256
  });
}

function requireSourceContract(source) {
  assertPlainObject(source, "source");
  if (source.schemaVersion !== MEMORY_INBOX_SCHEMA_VERSION || source.kind !== SOURCE_KIND ||
      source.encoding !== ENCODING || source.offsetUnit !== OFFSET_UNIT || source.retentionMode !== RETENTION_MODE) {
    throw memoryInboxError("The source descriptor contract is invalid.", "MEMORY_INBOX_SOURCE_INVALID");
  }
  const rawSha256 = requireSha256(source.rawSha256, "rawSha256");
  if (source.sourceKey !== buildSourceKey(rawSha256)) {
    throw memoryInboxError("The source key does not match the raw byte hash.", "MEMORY_INBOX_SOURCE_HASH_MISMATCH");
  }
  requireSha256(source.decodedTextSha256, "decodedTextSha256");
  requirePositiveInteger(source.byteSize, "byteSize", MAX_SOURCE_BYTES);
  requireNonNegativeInteger(source.decodedLength, "decodedLength", MAX_SOURCE_BYTES);
  return source;
}

function decodeBase64(value) {
  if (typeof value !== "string" || !value || value.length % 4 !== 0 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) {
    throw memoryInboxError("rawBase64 must be canonical base64.", "MEMORY_INBOX_BASE64_INVALID");
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) {
    throw memoryInboxError("rawBase64 must be canonical base64.", "MEMORY_INBOX_BASE64_INVALID");
  }
  return bytes;
}

function requireRawBytes(value) {
  if (!Buffer.isBuffer(value) && !(value instanceof Uint8Array)) {
    throw memoryInboxError("Source bytes are required.", "MEMORY_INBOX_SOURCE_BYTES_INVALID");
  }
  const bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (!bytes.length) throw memoryInboxError("The source file is empty.", "MEMORY_INBOX_SOURCE_EMPTY");
  if (bytes.length > MAX_SOURCE_BYTES) {
    throw memoryInboxError(`A source file may contain at most ${MAX_SOURCE_BYTES} bytes.`, "MEMORY_INBOX_SOURCE_TOO_LARGE", 413);
  }
  return bytes;
}

function decodeUtf8(bytes) {
  let text;
  try {
    text = utf8Decoder.decode(bytes);
  } catch (cause) {
    throw memoryInboxError("The source file is not valid UTF-8.", "MEMORY_INBOX_UTF8_INVALID", 400, cause);
  }
  if (!text.length || !text.trim()) throw memoryInboxError("The decoded source file is empty.", "MEMORY_INBOX_SOURCE_EMPTY");
  if (text.includes("\u0000")) {
    throw memoryInboxError("NUL characters are not supported in text sources.", "MEMORY_INBOX_TEXT_UNSUPPORTED");
  }
  return text;
}

function positionForOffset(text, offset) {
  const safeOffset = requireOffset(offset, "offset", text.length);
  let line = 1;
  let lineStart = 0;
  for (let index = 0; index < safeOffset; index += 1) {
    if (text.charCodeAt(index) === 10) {
      line += 1;
      lineStart = index + 1;
    }
  }
  return { line, column: safeOffset - lineStart + 1 };
}

function buildSourceKey(rawSha256) {
  return `${SOURCE_KEY_PREFIX}${requireSha256(rawSha256, "rawSha256")}`;
}

function buildAnchorKey(input = {}) {
  assertPlainObject(input, "anchor identity");
  if (!SOURCE_KEY_PATTERN.test(String(input.sourceKey || "")) || input.offsetUnit !== OFFSET_UNIT) {
    throw memoryInboxError("The anchor identity source is invalid.", "MEMORY_INBOX_ANCHOR_INVALID");
  }
  const startOffset = requireNonNegativeInteger(input.startOffset, "startOffset", Number.MAX_SAFE_INTEGER);
  const endOffset = requirePositiveInteger(input.endOffset, "endOffset", Number.MAX_SAFE_INTEGER);
  if (endOffset <= startOffset) throw memoryInboxError("The anchor range is invalid.", "MEMORY_INBOX_ANCHOR_INVALID");
  const excerptSha256 = requireSha256(input.excerptSha256, "excerptSha256");
  return `${ANCHOR_KEY_PREFIX}${sha256Utf8(stableStringify({
    sourceKey: input.sourceKey,
    offsetUnit: OFFSET_UNIT,
    startOffset,
    endOffset,
    excerptSha256
  }))}`;
}

function requireDisplayName(value) {
  const name = String(value || "").normalize("NFC").trim();
  if (!name || name.length > MAX_DISPLAY_NAME_LENGTH || /[\u0000-\u001f\u007f/\\]/u.test(name)) {
    throw memoryInboxError("The source display name is invalid.", "MEMORY_INBOX_DISPLAY_NAME_INVALID");
  }
  return name;
}

function requireFormat(value) {
  const format = String(value || "").trim().toLowerCase();
  if (!FORMATS.has(format)) throw memoryInboxError("Only txt and markdown sources are supported.", "MEMORY_INBOX_FORMAT_UNSUPPORTED", 415);
  return format;
}

function assertMatchingExtension(displayName, format) {
  const lower = displayName.toLowerCase();
  const valid = format === "txt" ? lower.endsWith(".txt") : lower.endsWith(".md") || lower.endsWith(".markdown");
  if (!valid) {
    throw memoryInboxError(`The file extension does not match ${EXTENSION_BY_FORMAT[format]}.`, "MEMORY_INBOX_EXTENSION_MISMATCH", 415);
  }
}

function requireMimeType(value, format) {
  const mimeType = String(value || "").split(";", 1)[0].trim().toLowerCase();
  if (!MIME_BY_FORMAT[format].has(mimeType)) {
    throw memoryInboxError("The source MIME type is not supported.", "MEMORY_INBOX_MIME_UNSUPPORTED", 415);
  }
  return mimeType || (format === "txt" ? "text/plain" : "text/markdown");
}

function requireOffset(value, name, maximum) {
  return requireNonNegativeInteger(value, name, maximum);
}

function requireSha256(value, name) {
  const digest = String(value || "");
  if (!SHA256_PATTERN.test(digest)) throw memoryInboxError(`${name} must be a lowercase SHA-256 digest.`, "MEMORY_INBOX_HASH_INVALID");
  return digest;
}

function requireNonNegativeInteger(value, name, maximum) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw memoryInboxError(`${name} is outside its supported range.`, "MEMORY_INBOX_RANGE_INVALID");
  }
  return value;
}

function requirePositiveInteger(value, name, maximum) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw memoryInboxError(`${name} is outside its supported range.`, "MEMORY_INBOX_RANGE_INVALID");
  }
  return value;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sha256Utf8(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function assertPlainObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw memoryInboxError(`${name} must be an object.`, "MEMORY_INBOX_INPUT_INVALID");
  }
}

function memoryInboxError(message, code, statusCode = 400, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

module.exports = {
  ANCHOR_KEY_PATTERN,
  ENCODING,
  MAX_DISPLAY_NAME_LENGTH,
  MAX_EXCERPT_LENGTH,
  MAX_PREVIEW_CANDIDATES,
  MAX_SOURCE_BYTES,
  MEMORY_INBOX_SCHEMA_VERSION,
  OFFSET_UNIT,
  RETENTION_MODE,
  SHA256_PATTERN,
  SOURCE_KEY_PATTERN,
  SOURCE_KIND,
  buildAnchorKey,
  buildSourceKey,
  buildTextAnchor,
  decodeBase64,
  decodeUtf8,
  memoryInboxError,
  positionForOffset,
  requireSourceContract,
  sha256,
  sha256Utf8,
  stableStringify,
  verifyMemoryInboxSelection
};
