"use strict";

const {
  ANCHOR_KEY_PATTERN,
  ENCODING,
  MAX_DISPLAY_NAME_LENGTH,
  MAX_EXCERPT_LENGTH,
  MAX_SOURCE_BYTES,
  MEMORY_INBOX_SCHEMA_VERSION,
  OFFSET_UNIT,
  RETENTION_MODE,
  SHA256_PATTERN,
  SOURCE_KEY_PATTERN,
  SOURCE_KIND,
  buildAnchorKey,
  buildSourceKey,
  memoryInboxError,
  sha256Utf8
} = require("./memory-inbox-service");

const MAX_MEMORY_INBOX_SOURCES = 500;
const MAX_MEMORY_INBOX_ITEMS = 1000;
const MEMORY_INBOX_SECTION_NAME = "memory-inbox";
const MEMORY_INBOX_SECTION_PATH = "inbox/state.json";
const MEMORY_INBOX_ARCHIVE_PREFIX = "inbox/";
const MEMORY_INBOX_SECTION_VERSION = 1;
const MEMORY_INBOX_LIMITS = Object.freeze({
  sources: MAX_MEMORY_INBOX_SOURCES,
  items: MAX_MEMORY_INBOX_ITEMS
});
const MEMORY_INBOX_REDACTED_NOTE =
  "Source names, hashes, excerpts, offsets, internal identifiers, and admission links were physically removed.";
const ITEM_STATUSES = new Set(["pending", "dismissed", "accepted", "orphaned"]);
const ID_PATTERN = /^[a-zA-Z0-9_-]{1,120}$/u;
const SOURCE_KEYS = Object.freeze([
  "byteSize", "createdAt", "decodedLength", "decodedTextSha256", "displayName",
  "encoding", "format", "id", "kind", "mimeType", "offsetUnit", "rawSha256",
  "retentionMode", "schemaVersion", "sourceKey", "verifiedAt"
]);
const ITEM_KEYS = Object.freeze([
  "acceptedAt", "anchorKey", "createdAt", "dismissedAt", "endColumn", "endLine",
  "endOffset", "excerpt", "excerptSha256", "id", "memoryId", "needsReview",
  "offsetUnit", "schemaVersion", "sourceId", "startColumn", "startLine", "startOffset",
  "status", "updatedAt", "version"
]);
const REDACTED_KEYS = Object.freeze([
  "acceptedCount", "dismissedCount", "itemCount", "mode", "note", "orphanedCount",
  "pendingCount", "sourceCount"
]);

function buildMemoryInboxBackup(state = {}, mode = "full") {
  const sources = Array.isArray(state.sources) ? state.sources.map(toBackupSource) : [];
  const items = Array.isArray(state.items) ? state.items.map(toBackupItem) : [];
  const full = {
    mode: "full",
    schemaVersion: MEMORY_INBOX_SCHEMA_VERSION,
    sources,
    items
  };
  validateMemoryInboxBackupPayload(full);
  if (mode === "redacted") {
    const counts = countStatuses(items);
    return {
      mode: "redacted-summary",
      sourceCount: sources.length,
      itemCount: items.length,
      pendingCount: counts.pending,
      dismissedCount: counts.dismissed,
      acceptedCount: counts.accepted,
      orphanedCount: counts.orphaned,
      note: MEMORY_INBOX_REDACTED_NOTE
    };
  }
  if (mode !== "full") throw backupError("Memory-inbox backup mode is invalid.");
  return full;
}

function validateMemoryInboxBackupPayload(backup, options = {}) {
  assertPlainObject(backup, "memory-inbox backup");
  if (backup.mode === "redacted-summary") {
    assertExactKeys(backup, REDACTED_KEYS, "redacted memory-inbox backup");
    const sourceCount = requireCount(backup.sourceCount, "sourceCount", MAX_MEMORY_INBOX_SOURCES);
    const itemCount = requireCount(backup.itemCount, "itemCount", MAX_MEMORY_INBOX_ITEMS);
    const sum = ["pendingCount", "dismissedCount", "acceptedCount", "orphanedCount"]
      .reduce((total, key) => total + requireCount(backup[key], key, MAX_MEMORY_INBOX_ITEMS), 0);
    if (sum !== itemCount || sourceCount > itemCount || backup.note !== MEMORY_INBOX_REDACTED_NOTE) {
      throw backupError("Redacted memory-inbox counts or note are invalid.");
    }
    return true;
  }

  assertExactKeys(backup, ["items", "mode", "schemaVersion", "sources"], "memory-inbox backup");
  if (backup.mode !== "full" || backup.schemaVersion !== MEMORY_INBOX_SCHEMA_VERSION ||
      !Array.isArray(backup.sources) || backup.sources.length > MAX_MEMORY_INBOX_SOURCES ||
      !Array.isArray(backup.items) || backup.items.length > MAX_MEMORY_INBOX_ITEMS) {
    throw backupError("Memory-inbox backup mode, schema, or record count is invalid.");
  }

  const sources = backup.sources.map(normalizeBackupSource);
  const sourceIds = uniqueMap(sources, "id", "source id");
  uniqueMap(sources, "sourceKey", "source key");
  uniqueMap(sources, "rawSha256", "source hash");

  const allowedMemoryIds = normalizeOptionalIdSet(options.memoryIds, "memoryIds");
  const items = backup.items.map((item, index) => normalizeBackupItem(item, index, sourceIds));
  const itemIds = uniqueMap(items, "id", "item id");
  if ([...itemIds.keys()].some((id) => sourceIds.has(id))) throw backupError("Source and item IDs must be globally distinct.");
  uniqueMap(items, "anchorKey", "anchor key");
  const admittedMemoryIds = new Set();
  for (const item of items) {
    if (item.memoryId) {
      if (admittedMemoryIds.has(item.memoryId)) throw backupError("More than one inbox item targets the same memory.");
      admittedMemoryIds.add(item.memoryId);
      if (allowedMemoryIds && !allowedMemoryIds.has(item.memoryId)) {
        throw referenceError("An accepted inbox item references a memory outside the archive boundary.");
      }
    }
  }
  if (!items.length && sources.length) throw backupError("Unreferenced inbox sources are not allowed in a full backup.");
  const referencedSources = new Set(items.map((item) => item.sourceId));
  if (sources.some((source) => !referencedSources.has(source.id))) throw backupError("Unreferenced inbox sources are not allowed in a full backup.");
  return true;
}

function validateMemoryInboxArchiveEnvelope(backup, mode, options = {}) {
  const expectedMode = mode === "redacted" ? "redacted-summary" : mode;
  if (!new Set(["full", "redacted-summary"]).has(expectedMode) || backup?.mode !== expectedMode) {
    throw backupError("Memory-inbox archive privacy mode is inconsistent.");
  }
  return validateMemoryInboxBackupPayload(backup, options);
}

function normalizeBackupSource(value, index = 0) {
  assertPlainObject(value, `sources[${index}]`);
  assertExactKeys(value, SOURCE_KEYS, `sources[${index}]`);
  const source = {
    schemaVersion: requireExactSchema(value.schemaVersion),
    id: requireId(value.id, `sources[${index}].id`),
    sourceKey: requirePattern(value.sourceKey, SOURCE_KEY_PATTERN, `sources[${index}].sourceKey`),
    kind: requireExact(value.kind, SOURCE_KIND, `sources[${index}].kind`),
    displayName: requireBoundedText(value.displayName, `sources[${index}].displayName`, MAX_DISPLAY_NAME_LENGTH),
    format: requireChoice(value.format, new Set(["txt", "markdown"]), `sources[${index}].format`),
    mimeType: requireChoice(value.mimeType, new Set(["text/plain", "text/markdown", "text/x-markdown"]), `sources[${index}].mimeType`),
    byteSize: requireInteger(value.byteSize, 1, MAX_SOURCE_BYTES, `sources[${index}].byteSize`),
    decodedLength: requireInteger(value.decodedLength, 1, MAX_SOURCE_BYTES, `sources[${index}].decodedLength`),
    rawSha256: requirePattern(value.rawSha256, SHA256_PATTERN, `sources[${index}].rawSha256`),
    decodedTextSha256: requirePattern(value.decodedTextSha256, SHA256_PATTERN, `sources[${index}].decodedTextSha256`),
    encoding: requireExact(value.encoding, ENCODING, `sources[${index}].encoding`),
    offsetUnit: requireExact(value.offsetUnit, OFFSET_UNIT, `sources[${index}].offsetUnit`),
    retentionMode: requireExact(value.retentionMode, RETENTION_MODE, `sources[${index}].retentionMode`),
    verifiedAt: requireTimestamp(value.verifiedAt, `sources[${index}].verifiedAt`),
    createdAt: requireTimestamp(value.createdAt, `sources[${index}].createdAt`)
  };
  assertSourcePresentation(source);
  if (source.sourceKey !== buildSourceKey(source.rawSha256) || Date.parse(source.verifiedAt) < Date.parse(source.createdAt)) {
    throw backupError("A source key or timestamp boundary is invalid.");
  }
  return source;
}

function normalizeBackupItem(value, index = 0, sourceMap) {
  assertPlainObject(value, `items[${index}]`);
  assertExactKeys(value, ITEM_KEYS, `items[${index}]`);
  const item = {
    schemaVersion: requireExactSchema(value.schemaVersion),
    id: requireId(value.id, `items[${index}].id`),
    sourceId: requireId(value.sourceId, `items[${index}].sourceId`),
    anchorKey: requirePattern(value.anchorKey, ANCHOR_KEY_PATTERN, `items[${index}].anchorKey`),
    offsetUnit: requireExact(value.offsetUnit, OFFSET_UNIT, `items[${index}].offsetUnit`),
    startOffset: requireInteger(value.startOffset, 0, MAX_SOURCE_BYTES, `items[${index}].startOffset`),
    endOffset: requireInteger(value.endOffset, 1, MAX_SOURCE_BYTES, `items[${index}].endOffset`),
    startLine: requireInteger(value.startLine, 1, MAX_SOURCE_BYTES + 1, `items[${index}].startLine`),
    startColumn: requireInteger(value.startColumn, 1, MAX_SOURCE_BYTES + 1, `items[${index}].startColumn`),
    endLine: requireInteger(value.endLine, 1, MAX_SOURCE_BYTES + 1, `items[${index}].endLine`),
    endColumn: requireInteger(value.endColumn, 1, MAX_SOURCE_BYTES + 1, `items[${index}].endColumn`),
    excerpt: requireBoundedTextPreservingWhitespace(value.excerpt, `items[${index}].excerpt`, MAX_EXCERPT_LENGTH),
    excerptSha256: requirePattern(value.excerptSha256, SHA256_PATTERN, `items[${index}].excerptSha256`),
    status: requireChoice(value.status, ITEM_STATUSES, `items[${index}].status`),
    needsReview: requireBoolean(value.needsReview, `items[${index}].needsReview`),
    memoryId: value.memoryId === "" ? "" : requireId(value.memoryId, `items[${index}].memoryId`),
    version: requireInteger(value.version, 1, Number.MAX_SAFE_INTEGER, `items[${index}].version`),
    createdAt: requireTimestamp(value.createdAt, `items[${index}].createdAt`),
    updatedAt: requireTimestamp(value.updatedAt, `items[${index}].updatedAt`),
    dismissedAt: value.dismissedAt === "" ? "" : requireTimestamp(value.dismissedAt, `items[${index}].dismissedAt`),
    acceptedAt: value.acceptedAt === "" ? "" : requireTimestamp(value.acceptedAt, `items[${index}].acceptedAt`)
  };
  const source = sourceMap?.get(item.sourceId);
  if (!source) throw referenceError("An inbox item references a missing source.");
  if (item.endOffset <= item.startOffset || item.endOffset > source.decodedLength ||
      item.endOffset - item.startOffset !== item.excerpt.length ||
      item.excerptSha256 !== sha256Utf8(item.excerpt) ||
      item.anchorKey !== buildAnchorKey({ ...item, sourceKey: source.sourceKey }) || item.endLine < item.startLine ||
      (item.endLine === item.startLine && item.endColumn <= item.startColumn)) {
    throw backupError("An inbox anchor is invalid.");
  }
  const excerptLines = item.excerpt.split("\n");
  const expectedEndLine = item.startLine + excerptLines.length - 1;
  const expectedEndColumn = excerptLines.length === 1
    ? item.startColumn + item.excerpt.length
    : excerptLines.at(-1).length + 1;
  if (item.endLine !== expectedEndLine || item.endColumn !== expectedEndColumn) {
    throw backupError("An inbox anchor line projection is invalid.");
  }
  assertItemState(item);
  if (Date.parse(item.updatedAt) < Date.parse(item.createdAt) ||
      item.dismissedAt && Date.parse(item.dismissedAt) < Date.parse(item.createdAt) ||
      item.acceptedAt && Date.parse(item.acceptedAt) < Date.parse(item.createdAt)) {
    throw backupError("An inbox item timestamp boundary is invalid.");
  }
  return item;
}

function assertItemState(item) {
  if (item.status === "pending" && (item.memoryId || item.acceptedAt || item.dismissedAt || item.needsReview)) {
    throw backupError("A pending inbox item has an invalid state.");
  }
  if (item.status === "dismissed" && (item.memoryId || item.acceptedAt || !item.dismissedAt || item.needsReview)) {
    throw backupError("A dismissed inbox item has an invalid state.");
  }
  if (item.status === "accepted" && (!item.memoryId || !item.acceptedAt || item.dismissedAt || item.needsReview)) {
    throw backupError("An accepted inbox item has an invalid state.");
  }
  if (item.status === "orphaned" && (item.memoryId || !item.acceptedAt || item.dismissedAt || !item.needsReview)) {
    throw backupError("An orphaned inbox item has an invalid state.");
  }
}

function toBackupSource(source) {
  return Object.fromEntries(SOURCE_KEYS.map((key) => [key, source[key]]));
}

function toBackupItem(item) {
  return Object.fromEntries(ITEM_KEYS.map((key) => [key, item[key]]));
}

function countStatuses(items) {
  const counts = { pending: 0, dismissed: 0, accepted: 0, orphaned: 0 };
  for (const item of items) if (Object.hasOwn(counts, item.status)) counts[item.status] += 1;
  return counts;
}

function uniqueMap(values, key, label) {
  const map = new Map();
  for (const value of values) {
    if (map.has(value[key])) throw backupError(`Duplicate ${label}.`);
    map.set(value[key], value);
  }
  return map;
}

function normalizeOptionalIdSet(value, name) {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) && !(value instanceof Set)) throw backupError(`${name} must be an array or Set.`);
  return new Set([...value].map((id) => requireId(id, name)));
}

function requireExactSchema(value) {
  if (value !== MEMORY_INBOX_SCHEMA_VERSION) throw backupError("Memory-inbox record schema is invalid.");
  return value;
}

function requireId(value, name) {
  const id = String(value || "");
  if (!ID_PATTERN.test(id)) throw backupError(`${name} is invalid.`);
  return id;
}

function requirePattern(value, pattern, name) {
  const text = String(value || "");
  if (!pattern.test(text)) throw backupError(`${name} is invalid.`);
  return text;
}

function requireExact(value, expected, name) {
  if (value !== expected) throw backupError(`${name} is invalid.`);
  return value;
}

function requireChoice(value, choices, name) {
  const text = String(value || "");
  if (!choices.has(text)) throw backupError(`${name} is invalid.`);
  return text;
}

function requireBoundedText(value, name, maximum) {
  if (typeof value !== "string") throw backupError(`${name} is invalid.`);
  const text = value.trim();
  if (!text || text !== value || text.length > maximum || /[\u0000-\u001f\u007f/\\]/u.test(text)) {
    throw backupError(`${name} is invalid.`);
  }
  return text;
}

function requireBoundedTextPreservingWhitespace(value, name, maximum) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum || value.includes("\u0000")) {
    throw backupError(`${name} is invalid.`);
  }
  return value;
}

function requireInteger(value, minimum, maximum, name) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw backupError(`${name} is invalid.`);
  return value;
}

function requireCount(value, name, maximum) {
  return requireInteger(value, 0, maximum, name);
}

function requireBoolean(value, name) {
  if (typeof value !== "boolean") throw backupError(`${name} must be a boolean.`);
  return value;
}

function requireTimestamp(value, name) {
  if (typeof value !== "string" || !value || value.length > 40 || !Number.isFinite(Date.parse(value)) ||
      new Date(value).toISOString() !== value) {
    throw backupError(`${name} is invalid.`);
  }
  return value;
}

function assertSourcePresentation(source) {
  const lower = source.displayName.toLowerCase();
  const extensionOk = source.format === "txt"
    ? lower.endsWith(".txt")
    : lower.endsWith(".md") || lower.endsWith(".markdown");
  const mimeOk = source.format === "txt"
    ? source.mimeType === "text/plain"
    : ["text/plain", "text/markdown", "text/x-markdown"].includes(source.mimeType);
  if (!extensionOk || !mimeOk) throw backupError("A source format, filename, or MIME contract is inconsistent.");
}

function assertPlainObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw backupError(`${name} must be an object.`);
  }
}

function assertExactKeys(value, expected, name) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw backupError(`${name} has an invalid field set.`);
  }
}

function backupError(message) {
  return memoryInboxError(message, "MEMORY_INBOX_BACKUP_INVALID");
}

function referenceError(message) {
  return memoryInboxError(message, "MEMORY_INBOX_BACKUP_REFERENCE_INVALID");
}

module.exports = {
  ITEM_KEYS,
  ITEM_STATUSES,
  MAX_MEMORY_INBOX_ITEMS,
  MAX_MEMORY_INBOX_SOURCES,
  MEMORY_INBOX_ARCHIVE_PREFIX,
  MEMORY_INBOX_LIMITS,
  MEMORY_INBOX_REDACTED_NOTE,
  MEMORY_INBOX_SECTION_NAME,
  MEMORY_INBOX_SECTION_PATH,
  MEMORY_INBOX_SECTION_VERSION,
  SOURCE_KEYS,
  buildMemoryInboxBackup,
  normalizeBackupItem,
  normalizeBackupSource,
  validateMemoryInboxArchiveEnvelope,
  validateMemoryInboxBackupPayload
};
