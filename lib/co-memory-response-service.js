"use strict";

const { createHash } = require("node:crypto");
const coMemoryCrypto = require("../public/assets/co-memory-crypto.js");

const CO_MEMORY_RESPONSE_SCHEMA_VERSION = 17;
const CO_MEMORY_RESPONSE_KIND = "co_memory_response";
const CO_MEMORY_RESPONSE_RELATION = "supplements";
const CO_MEMORY_RESPONSE_CONFIRMATION = "user_confirmed_unverified";
const MEMORY_ID_PATTERN = /^[A-Za-z0-9_-]{1,120}$/u;
const RECORD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const SOURCE_KEY_PATTERN = /^co-memory-response-source:[a-f0-9]{64}$/u;
const ANCHOR_KEY_PATTERN = /^co-memory-response-anchor:[a-f0-9]{64}$/u;
const SNAPSHOT_SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const MEMORY_ANCHOR_PATTERN = /^\[time-isle-memory-anchor:v1:([A-Za-z0-9_-]{1,120})\](?:\n|$)/u;
const CONFIRMATION_KEYS = new Set(["confirm", "memoryId", "requestSha256", "request", "response", "source"]);
const SOURCE_KEYS = new Set([
  "kind", "relationKind", "label", "excerpt", "identityAssurance", "identityVerified", "encrypted", "signed"
]);
const STORED_RECORD_KEYS = new Set([
  "schemaVersion", "id", "kind", "memoryId", "letterId", "responseId", "requestSha256", "responseSha256",
  "sourceKey", "anchorKey", "snapshotSha256", "relationKind", "label", "excerpt", "identityAssurance",
  "identityVerified", "encrypted", "signed", "confirmation", "request", "response", "createdAt"
]);

/**
 * Revalidates the exact browser confirmation contract. The encrypted envelope
 * has already been opened client-side, but its request/response binding,
 * self-asserted identity boundary and encrypted memory anchor are independently
 * checked again before any database operation is allowed.
 */
async function validateCoMemoryResponseConfirmation(input = {}) {
  assertPlainObject(input, "confirmation contract", "CO_MEMORY_CONFIRMATION_INVALID");
  assertExactKeys(input, CONFIRMATION_KEYS, "confirmation contract", "CO_MEMORY_CONFIRMATION_INVALID");
  if (input.confirm !== true) {
    throw coMemoryResponseError(
      "Saving a co-memory response requires confirm: true.",
      "CO_MEMORY_CONFIRMATION_REQUIRED"
    );
  }
  const memoryId = requireMemoryId(input.memoryId, "memoryId");
  const declaredRequestSha256 = requireSha256(input.requestSha256, "requestSha256");
  const request = invokeCryptoValidator(() => coMemoryCrypto.validateRequestPayload(input.request));
  const response = invokeCryptoValidator(() => coMemoryCrypto.validateResponsePayload(input.response));
  const measuredRequestSha256 = await coMemoryCrypto.digestRequestPayload(request);
  if (declaredRequestSha256 !== measuredRequestSha256 || response.requestSha256 !== measuredRequestSha256) {
    throw coMemoryResponseError(
      "The response is not bound to the exact request payload.",
      "CO_MEMORY_REQUEST_BINDING_INVALID"
    );
  }
  if (response.letterId !== request.letterId) {
    throw coMemoryResponseError(
      "The response letter ID does not match the request.",
      "CO_MEMORY_LETTER_BINDING_INVALID"
    );
  }
  const boundMemoryId = extractCoMemoryMemoryAnchor(request);
  if (!boundMemoryId || boundMemoryId !== memoryId) {
    throw coMemoryResponseError(
      "The encrypted memory anchor does not match the target memory.",
      "CO_MEMORY_MEMORY_BINDING_INVALID"
    );
  }

  assertPlainObject(input.source, "source", "CO_MEMORY_SOURCE_INVALID");
  assertExactKeys(input.source, SOURCE_KEYS, "source", "CO_MEMORY_SOURCE_INVALID");
  const expectedLabel = response.identity.label || "未署名共忆回信";
  if (input.source.kind !== CO_MEMORY_RESPONSE_KIND ||
      input.source.relationKind !== CO_MEMORY_RESPONSE_RELATION ||
      input.source.label !== expectedLabel ||
      input.source.excerpt !== response.answer ||
      input.source.identityAssurance !== coMemoryCrypto.IDENTITY_ASSURANCE ||
      input.source.identityVerified !== false ||
      input.source.encrypted !== true ||
      input.source.signed !== false) {
    throw coMemoryResponseError(
      "The co-memory source boundary is invalid or overstates identity assurance.",
      "CO_MEMORY_SOURCE_BOUNDARY_INVALID"
    );
  }
  if (response.identity.assurance !== coMemoryCrypto.IDENTITY_ASSURANCE || response.identity.verified !== false) {
    throw coMemoryResponseError(
      "Co-memory identity must remain self-asserted and unverified.",
      "CO_MEMORY_IDENTITY_BOUNDARY_INVALID"
    );
  }

  const responseSha256 = sha256(stableStringify(response));
  const sourceKey = `co-memory-response-source:${responseSha256}`;
  const anchorKey = `co-memory-response-anchor:${sha256(stableStringify({
    memoryId,
    letterId: request.letterId,
    responseId: response.responseId,
    requestSha256: measuredRequestSha256,
    responseSha256
  }))}`;
  const sourceCore = {
    schemaVersion: CO_MEMORY_RESPONSE_SCHEMA_VERSION,
    kind: CO_MEMORY_RESPONSE_KIND,
    memoryId,
    letterId: request.letterId,
    responseId: response.responseId,
    requestSha256: measuredRequestSha256,
    responseSha256,
    sourceKey,
    anchorKey,
    relationKind: CO_MEMORY_RESPONSE_RELATION,
    label: expectedLabel,
    excerpt: response.answer,
    identityAssurance: coMemoryCrypto.IDENTITY_ASSURANCE,
    identityVerified: false,
    encrypted: true,
    signed: false,
    confirmation: CO_MEMORY_RESPONSE_CONFIRMATION,
    request,
    response
  };
  return deepFreeze({
    ...sourceCore,
    snapshotSha256: buildCoMemoryResponseSnapshotSha256(sourceCore)
  });
}

function validateStoredCoMemoryResponse(input = {}) {
  assertPlainObject(input, "stored co-memory response", "CO_MEMORY_STORED_RECORD_INVALID");
  assertExactKeys(input, STORED_RECORD_KEYS, "stored co-memory response", "CO_MEMORY_STORED_RECORD_INVALID");
  if (input.schemaVersion !== CO_MEMORY_RESPONSE_SCHEMA_VERSION || input.kind !== CO_MEMORY_RESPONSE_KIND ||
      input.relationKind !== CO_MEMORY_RESPONSE_RELATION || input.confirmation !== CO_MEMORY_RESPONSE_CONFIRMATION ||
      input.identityAssurance !== coMemoryCrypto.IDENTITY_ASSURANCE || input.identityVerified !== false ||
      input.encrypted !== true || input.signed !== false) {
    throw coMemoryResponseError("Stored co-memory boundaries are invalid.", "CO_MEMORY_STORED_RECORD_INVALID", 500);
  }
  const id = requireRecordId(input.id, "record.id", 500);
  const memoryId = requireMemoryId(input.memoryId, "record.memoryId", 500);
  const request = invokeCryptoValidator(() => coMemoryCrypto.validateRequestPayload(input.request), 500);
  const response = invokeCryptoValidator(() => coMemoryCrypto.validateResponsePayload(input.response), 500);
  const requestSha256 = sha256(stableStringify(request));
  const responseSha256 = sha256(stableStringify(response));
  const sourceKey = `co-memory-response-source:${responseSha256}`;
  const anchorKey = `co-memory-response-anchor:${sha256(stableStringify({
    memoryId,
    letterId: request.letterId,
    responseId: response.responseId,
    requestSha256,
    responseSha256
  }))}`;
  const label = response.identity.label || "未署名共忆回信";
  if (extractCoMemoryMemoryAnchor(request) !== memoryId || response.letterId !== request.letterId ||
      response.requestSha256 !== requestSha256 || input.letterId !== request.letterId ||
      input.responseId !== response.responseId || input.requestSha256 !== requestSha256 ||
      input.responseSha256 !== responseSha256 || input.sourceKey !== sourceKey || input.anchorKey !== anchorKey ||
      input.label !== label || input.excerpt !== response.answer ||
      !SOURCE_KEY_PATTERN.test(input.sourceKey) || !ANCHOR_KEY_PATTERN.test(input.anchorKey)) {
    throw coMemoryResponseError("Stored co-memory response integrity is invalid.", "CO_MEMORY_STORED_RECORD_INVALID", 500);
  }
  const sourceCore = {
    schemaVersion: CO_MEMORY_RESPONSE_SCHEMA_VERSION,
    kind: CO_MEMORY_RESPONSE_KIND,
    memoryId,
    letterId: request.letterId,
    responseId: response.responseId,
    requestSha256,
    responseSha256,
    sourceKey,
    anchorKey,
    relationKind: CO_MEMORY_RESPONSE_RELATION,
    label,
    excerpt: response.answer,
    identityAssurance: coMemoryCrypto.IDENTITY_ASSURANCE,
    identityVerified: false,
    encrypted: true,
    signed: false,
    confirmation: CO_MEMORY_RESPONSE_CONFIRMATION,
    request,
    response
  };
  const snapshotSha256 = buildCoMemoryResponseSnapshotSha256(sourceCore);
  if (input.snapshotSha256 !== snapshotSha256 || !SNAPSHOT_SHA256_PATTERN.test(input.snapshotSha256)) {
    throw coMemoryResponseError("Stored co-memory snapshot digest is invalid.", "CO_MEMORY_STORED_RECORD_INVALID", 500);
  }
  return deepFreeze({
    ...sourceCore,
    id,
    snapshotSha256,
    createdAt: requireTimestamp(input.createdAt, "record.createdAt", 500)
  });
}

function toCoMemoryResponseSource(input) {
  const record = validateStoredCoMemoryResponse(input);
  return deepFreeze({
    schemaVersion: 1,
    kind: CO_MEMORY_RESPONSE_KIND,
    memoryId: record.memoryId,
    referenceId: record.id,
    sourceKey: record.sourceKey,
    anchorKey: record.anchorKey,
    label: record.label,
    locator: {
      letterId: record.letterId,
      responseId: record.responseId,
      requestSha256: record.requestSha256,
      identityAssurance: record.identityAssurance,
      identityVerified: false,
      encrypted: true,
      signed: false
    },
    excerpt: record.excerpt,
    contentSha256: record.responseSha256,
    confirmation: CO_MEMORY_RESPONSE_CONFIRMATION,
    snapshotSha256: record.snapshotSha256
  });
}

function resolveCoMemoryResponseSource(records, memoryId, selection = {}) {
  const id = requireMemoryId(memoryId, "memoryId");
  assertPlainObject(selection, "source selection", "CO_MEMORY_SOURCE_SELECTION_INVALID");
  assertExactKeys(
    selection,
    new Set(["kind", "referenceId", "sourceKey", "anchorKey", "snapshotSha256"]),
    "source selection",
    "CO_MEMORY_SOURCE_SELECTION_INVALID"
  );
  if (selection.kind !== CO_MEMORY_RESPONSE_KIND) {
    throw coMemoryResponseError("Source selection kind is invalid.", "CO_MEMORY_SOURCE_SELECTION_INVALID");
  }
  const referenceId = requireRecordId(selection.referenceId, "selection.referenceId");
  requireSourceKey(selection.sourceKey, "selection.sourceKey");
  requireAnchorKey(selection.anchorKey, "selection.anchorKey");
  requireSha256(selection.snapshotSha256, "selection.snapshotSha256");
  const list = Array.isArray(records) ? records : [];
  const found = list.find((entry) => entry?.id === referenceId);
  if (!found || found.memoryId !== id) {
    return deepFreeze({ status: "missing", kind: CO_MEMORY_RESPONSE_KIND, referenceId, sourceKey: selection.sourceKey });
  }
  const source = toCoMemoryResponseSource(found);
  if (source.sourceKey !== selection.sourceKey || source.anchorKey !== selection.anchorKey ||
      source.snapshotSha256 !== selection.snapshotSha256) {
    return deepFreeze({
      status: "source_changed",
      kind: CO_MEMORY_RESPONSE_KIND,
      referenceId,
      sourceKey: selection.sourceKey,
      source
    });
  }
  return deepFreeze({
    status: "resolved",
    kind: CO_MEMORY_RESPONSE_KIND,
    referenceId,
    sourceKey: selection.sourceKey,
    source
  });
}

function extractCoMemoryMemoryAnchor(requestPayload) {
  const note = requestPayload?.context?.note;
  if (typeof note !== "string") return "";
  const match = note.match(MEMORY_ANCHOR_PATTERN);
  return match && MEMORY_ID_PATTERN.test(match[1]) ? match[1] : "";
}

function buildCoMemoryResponseSnapshotSha256(input) {
  return sha256(stableStringify({
    schemaVersion: input.schemaVersion,
    kind: input.kind,
    memoryId: input.memoryId,
    letterId: input.letterId,
    responseId: input.responseId,
    requestSha256: input.requestSha256,
    responseSha256: input.responseSha256,
    sourceKey: input.sourceKey,
    anchorKey: input.anchorKey,
    relationKind: input.relationKind,
    label: input.label,
    excerpt: input.excerpt,
    identityAssurance: input.identityAssurance,
    identityVerified: input.identityVerified,
    encrypted: input.encrypted,
    signed: input.signed,
    confirmation: input.confirmation
  }));
}

function mutationSha256(normalized) {
  return sha256(`time-isle-co-memory-response-confirm-v1\0${stableStringify(normalized)}`);
}

function invokeCryptoValidator(operation, statusCode = 400) {
  try { return operation(); }
  catch (cause) {
    if (String(cause?.code || "").startsWith("CO_MEMORY_")) {
      const error = coMemoryResponseError(cause.message, cause.code, statusCode);
      error.cause = cause;
      throw error;
    }
    throw cause;
  }
}

function requireMemoryId(value, name, statusCode = 400) {
  if (typeof value !== "string" || !MEMORY_ID_PATTERN.test(value)) {
    throw coMemoryResponseError(`${name} is invalid.`, "CO_MEMORY_MEMORY_ID_INVALID", statusCode);
  }
  return value;
}

function requireRecordId(value, name, statusCode = 400) {
  if (typeof value !== "string" || !RECORD_ID_PATTERN.test(value)) {
    throw coMemoryResponseError(`${name} is invalid.`, "CO_MEMORY_RECORD_ID_INVALID", statusCode);
  }
  return value;
}

function requireSha256(value, name, statusCode = 400) {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    throw coMemoryResponseError(`${name} is invalid.`, "CO_MEMORY_HASH_INVALID", statusCode);
  }
  return value;
}

function requireSourceKey(value, name) {
  if (typeof value !== "string" || !SOURCE_KEY_PATTERN.test(value)) {
    throw coMemoryResponseError(`${name} is invalid.`, "CO_MEMORY_SOURCE_SELECTION_INVALID");
  }
  return value;
}

function requireAnchorKey(value, name) {
  if (typeof value !== "string" || !ANCHOR_KEY_PATTERN.test(value)) {
    throw coMemoryResponseError(`${name} is invalid.`, "CO_MEMORY_SOURCE_SELECTION_INVALID");
  }
  return value;
}

function requireTimestamp(value, name, statusCode = 400) {
  if (typeof value !== "string" || value.length > 40 || !Number.isFinite(Date.parse(value)) ||
      new Date(value).toISOString() !== value) {
    throw coMemoryResponseError(`${name} is invalid.`, "CO_MEMORY_TIMESTAMP_INVALID", statusCode);
  }
  return value;
}

function assertPlainObject(value, name, code) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw coMemoryResponseError(`${name} must be a plain object.`, code);
  }
}

function assertExactKeys(value, expected, name, code) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw coMemoryResponseError(`${name} contains unsupported or missing fields.`, code);
  }
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  Object.values(value).forEach((item) => deepFreeze(item, seen));
  return Object.freeze(value);
}

function coMemoryResponseError(message, code, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

module.exports = {
  ANCHOR_KEY_PATTERN,
  CO_MEMORY_RESPONSE_CONFIRMATION,
  CO_MEMORY_RESPONSE_KIND,
  CO_MEMORY_RESPONSE_RELATION,
  CO_MEMORY_RESPONSE_SCHEMA_VERSION,
  CONFIRMATION_KEYS,
  SOURCE_KEY_PATTERN,
  SOURCE_KEYS,
  STORED_RECORD_KEYS,
  buildCoMemoryResponseSnapshotSha256,
  coMemoryResponseError,
  extractCoMemoryMemoryAnchor,
  mutationSha256,
  resolveCoMemoryResponseSource,
  sha256,
  stableStringify,
  toCoMemoryResponseSource,
  validateCoMemoryResponseConfirmation,
  validateStoredCoMemoryResponse
};
