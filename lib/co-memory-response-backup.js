"use strict";

const {
  CO_MEMORY_RESPONSE_KIND,
  CO_MEMORY_RESPONSE_SCHEMA_VERSION,
  STORED_RECORD_KEYS,
  coMemoryResponseError,
  stableStringify,
  validateStoredCoMemoryResponse
} = require("./co-memory-response-service");

const MAX_CO_MEMORY_RESPONSE_BACKUP_RECORDS = 10000;
const MAX_CO_MEMORY_RESPONSE_BACKUP_BYTES = 20 * 1024 * 1024;
const CO_MEMORY_RESPONSE_SECTION_VERSION = 1;
const CO_MEMORY_RESPONSE_SECTION_NAME = "co-memory-responses";
const CO_MEMORY_RESPONSE_SECTION_PATH = "co-memory/responses.json";
const CO_MEMORY_RESPONSE_ARCHIVE_PREFIX = "co-memory/";
const CO_MEMORY_RESPONSE_LIMITS = Object.freeze({ responses: MAX_CO_MEMORY_RESPONSE_BACKUP_RECORDS });
const CO_MEMORY_RESPONSE_REDACTED_NOTE =
  "脱敏备份只保留共忆回信安全计数；不包含问题、邀请片段、回答、署名、展品 ID、信笺 ID、内部 ID 或哈希。";
const FULL_ROOT_KEYS = new Set(["mode", "schemaVersion", "kind", "responses"]);
const REDACTED_ROOT_KEYS = new Set([
  "mode", "responseCount", "unverifiedIdentityCount", "encryptedTransportCount", "unsignedCount", "note"
]);

function buildCoMemoryResponseBackup(records, mode = "full", memoryIds) {
  if (!Array.isArray(records)) throw backupError("Co-memory response records must be an array.");
  if (records.length > MAX_CO_MEMORY_RESPONSE_BACKUP_RECORDS) {
    throw backupError("Co-memory response backup exceeds its record budget.", "CO_MEMORY_RESPONSE_BACKUP_LIMIT");
  }
  const allowedMemoryIds = memoryIds === undefined ? null : normalizeMemoryIds(memoryIds);
  const normalized = records.map((record) => normalizeBackupRecord(record))
    .filter((record) => !allowedMemoryIds || allowedMemoryIds.has(record.memoryId))
    .sort(compareRecords);
  assertUniqueRecords(normalized);
  if (mode === "redacted") {
    return deepFreeze({
      mode: "redacted-summary",
      responseCount: normalized.length,
      unverifiedIdentityCount: normalized.length,
      encryptedTransportCount: normalized.length,
      unsignedCount: normalized.length,
      note: CO_MEMORY_RESPONSE_REDACTED_NOTE
    });
  }
  if (mode !== "full") throw backupError("Co-memory response backup mode is invalid.");
  const payload = {
    mode: "full",
    schemaVersion: CO_MEMORY_RESPONSE_SCHEMA_VERSION,
    kind: CO_MEMORY_RESPONSE_KIND,
    responses: normalized
  };
  assertBackupByteBudget(payload);
  return deepFreeze(payload);
}

function validateCoMemoryResponseBackupPayload(input, options = {}) {
  assertPlainObject(input, "co-memory response backup");
  assertPlainObject(options, "backup options");
  assertExactKeys(options, new Set(["memoryIds"]), "backup options", true);
  if (input.mode === "redacted-summary") {
    assertExactKeys(input, REDACTED_ROOT_KEYS, "redacted co-memory response backup");
    const responseCount = requireCount(input.responseCount, "responseCount");
    if (requireCount(input.unverifiedIdentityCount, "unverifiedIdentityCount") !== responseCount ||
        requireCount(input.encryptedTransportCount, "encryptedTransportCount") !== responseCount ||
        requireCount(input.unsignedCount, "unsignedCount") !== responseCount ||
        input.note !== CO_MEMORY_RESPONSE_REDACTED_NOTE) {
      throw backupError("Redacted co-memory response counters are inconsistent.");
    }
    return true;
  }
  assertExactKeys(input, FULL_ROOT_KEYS, "full co-memory response backup");
  if (input.mode !== "full" || input.schemaVersion !== CO_MEMORY_RESPONSE_SCHEMA_VERSION ||
      input.kind !== CO_MEMORY_RESPONSE_KIND || !Array.isArray(input.responses) ||
      input.responses.length > MAX_CO_MEMORY_RESPONSE_BACKUP_RECORDS) {
    throw backupError("Full co-memory response backup header is invalid.");
  }
  assertBackupByteBudget(input);
  const allowedMemoryIds = options.memoryIds === undefined ? null : normalizeMemoryIds(options.memoryIds);
  const normalized = input.responses.map((record, index) => {
    try { return normalizeBackupRecord(record); }
    catch (cause) {
      throw backupError(`Co-memory response backup record ${index} is invalid.`, "CO_MEMORY_RESPONSE_BACKUP_RECORD_INVALID", cause);
    }
  });
  assertUniqueRecords(normalized);
  if (normalized.some((record, index) => stableStringify(record) !== stableStringify(input.responses[index]))) {
    throw backupError("Co-memory response backup records are not canonical.", "CO_MEMORY_RESPONSE_BACKUP_RECORD_INVALID");
  }
  if (normalized.some((record) => allowedMemoryIds && !allowedMemoryIds.has(record.memoryId))) {
    throw backupError("Co-memory response backup crosses the selected memory boundary.", "CO_MEMORY_RESPONSE_BACKUP_REFERENCE_INVALID");
  }
  const sorted = [...normalized].sort(compareRecords);
  if (normalized.some((record, index) => record.id !== sorted[index].id)) {
    throw backupError("Co-memory response backup order is not canonical.", "CO_MEMORY_RESPONSE_BACKUP_ORDER_INVALID");
  }
  return true;
}

function normalizeBackupRecord(input) {
  const record = validateStoredCoMemoryResponse(input);
  const normalized = {
    schemaVersion: record.schemaVersion,
    id: record.id,
    kind: record.kind,
    memoryId: record.memoryId,
    letterId: record.letterId,
    responseId: record.responseId,
    requestSha256: record.requestSha256,
    responseSha256: record.responseSha256,
    sourceKey: record.sourceKey,
    anchorKey: record.anchorKey,
    snapshotSha256: record.snapshotSha256,
    relationKind: record.relationKind,
    label: record.label,
    excerpt: record.excerpt,
    identityAssurance: record.identityAssurance,
    identityVerified: false,
    encrypted: true,
    signed: false,
    confirmation: record.confirmation,
    request: cloneJson(record.request),
    response: cloneJson(record.response),
    createdAt: record.createdAt
  };
  assertExactKeys(normalized, STORED_RECORD_KEYS, "normalized co-memory response record");
  return deepFreeze(normalized);
}

function assertUniqueRecords(records) {
  const fields = ["id", "letterId", "responseId", "requestSha256", "responseSha256", "sourceKey", "anchorKey"];
  for (const field of fields) {
    const values = records.map((record) => record[field]);
    if (new Set(values).size !== values.length) {
      throw backupError(`Co-memory response backup contains duplicate ${field}.`, "CO_MEMORY_RESPONSE_BACKUP_DUPLICATE");
    }
  }
}

function normalizeMemoryIds(value) {
  if (!Array.isArray(value) && !(value instanceof Set)) {
    throw backupError("memoryIds must be an array or Set.", "CO_MEMORY_RESPONSE_BACKUP_REFERENCE_INVALID");
  }
  const result = new Set();
  for (const raw of value) {
    const id = String(raw || "");
    if (!/^[A-Za-z0-9_-]{1,120}$/u.test(id)) {
      throw backupError("memoryIds contains an invalid ID.", "CO_MEMORY_RESPONSE_BACKUP_REFERENCE_INVALID");
    }
    result.add(id);
  }
  return result;
}

function requireCount(value, name) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_CO_MEMORY_RESPONSE_BACKUP_RECORDS) {
    throw backupError(`${name} is invalid.`);
  }
  return value;
}

function compareRecords(left, right) {
  return left.memoryId.localeCompare(right.memoryId, "en") ||
    left.createdAt.localeCompare(right.createdAt, "en") ||
    left.id.localeCompare(right.id, "en");
}

function assertBackupByteBudget(payload) {
  const bytes = Buffer.byteLength(stableStringify(payload), "utf8");
  if (bytes > MAX_CO_MEMORY_RESPONSE_BACKUP_BYTES) {
    throw backupError(
      "Co-memory response backup exceeds the archive-safe byte budget.",
      "CO_MEMORY_RESPONSE_BACKUP_BYTE_LIMIT"
    );
  }
}

function assertPlainObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw backupError(`${name} must be a plain object.`);
  }
}

function assertExactKeys(value, expected, name, allowSubset = false) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  const invalid = allowSubset
    ? actual.some((key) => !expected.has(key))
    : actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index]);
  if (invalid) throw backupError(`${name} field set is invalid.`);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  Object.values(value).forEach((item) => deepFreeze(item, seen));
  return Object.freeze(value);
}

function backupError(message, code = "CO_MEMORY_RESPONSE_BACKUP_INVALID", cause) {
  const error = coMemoryResponseError(message, code, 400);
  if (cause) error.cause = cause;
  return error;
}

module.exports = {
  CO_MEMORY_RESPONSE_ARCHIVE_PREFIX,
  CO_MEMORY_RESPONSE_LIMITS,
  CO_MEMORY_RESPONSE_REDACTED_NOTE,
  CO_MEMORY_RESPONSE_SECTION_NAME,
  CO_MEMORY_RESPONSE_SECTION_PATH,
  CO_MEMORY_RESPONSE_SECTION_VERSION,
  MAX_CO_MEMORY_RESPONSE_BACKUP_RECORDS,
  MAX_CO_MEMORY_RESPONSE_BACKUP_BYTES,
  buildCoMemoryResponseBackup,
  normalizeBackupRecord,
  validateCoMemoryResponseBackupPayload
};
