"use strict";

const { randomUUID } = require("node:crypto");
const { applyMigrations } = require("./migrations");
const {
  MAX_CO_MEMORY_RESPONSE_BACKUP_RECORDS,
  buildCoMemoryResponseBackup,
  normalizeBackupRecord,
  validateCoMemoryResponseBackupPayload
} = require("./co-memory-response-backup");
const {
  CO_MEMORY_RESPONSE_KIND,
  CO_MEMORY_RESPONSE_SCHEMA_VERSION,
  coMemoryResponseError,
  mutationSha256,
  resolveCoMemoryResponseSource: resolveSourceProjection,
  sha256,
  stableStringify,
  toCoMemoryResponseSource,
  validateCoMemoryResponseConfirmation,
  validateStoredCoMemoryResponse
} = require("./co-memory-response-service");

const MAX_CO_MEMORY_RESPONSES_PER_MEMORY = 100;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,119}$/u;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/u;

const CO_MEMORY_RESPONSE_MIGRATION = Object.freeze({
  version: CO_MEMORY_RESPONSE_SCHEMA_VERSION,
  name: "encrypted-co-memory-response-source",
  up(db) {
    db.exec(`
      CREATE TABLE co_memory_responses (
        id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 120),
        schema_version INTEGER NOT NULL DEFAULT 17 CHECK (schema_version = 17),
        kind TEXT NOT NULL CHECK (kind = 'co_memory_response'),
        memory_id TEXT NOT NULL,
        letter_id TEXT NOT NULL UNIQUE CHECK (length(letter_id) BETWEEN 16 AND 120),
        response_id TEXT NOT NULL UNIQUE CHECK (length(response_id) BETWEEN 16 AND 120),
        request_sha256 TEXT NOT NULL UNIQUE CHECK (
          length(request_sha256) = 64 AND request_sha256 NOT GLOB '*[^0-9a-f]*'
        ),
        response_sha256 TEXT NOT NULL UNIQUE CHECK (
          length(response_sha256) = 64 AND response_sha256 NOT GLOB '*[^0-9a-f]*'
        ),
        source_key TEXT NOT NULL UNIQUE CHECK (
          length(source_key) = 90 AND substr(source_key, 1, 26) = 'co-memory-response-source:'
          AND substr(source_key, 27) NOT GLOB '*[^0-9a-f]*'
        ),
        anchor_key TEXT NOT NULL UNIQUE CHECK (
          length(anchor_key) = 90 AND substr(anchor_key, 1, 26) = 'co-memory-response-anchor:'
          AND substr(anchor_key, 27) NOT GLOB '*[^0-9a-f]*'
        ),
        snapshot_sha256 TEXT NOT NULL CHECK (
          length(snapshot_sha256) = 64 AND snapshot_sha256 NOT GLOB '*[^0-9a-f]*'
        ),
        relation_kind TEXT NOT NULL CHECK (relation_kind = 'supplements'),
        label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 120),
        excerpt_text TEXT NOT NULL CHECK (length(excerpt_text) BETWEEN 1 AND 8000),
        identity_assurance TEXT NOT NULL CHECK (identity_assurance = 'self-asserted-unverified'),
        identity_verified INTEGER NOT NULL CHECK (identity_verified = 0),
        encrypted INTEGER NOT NULL CHECK (encrypted = 1),
        signed INTEGER NOT NULL CHECK (signed = 0),
        confirmation TEXT NOT NULL CHECK (confirmation = 'user_confirmed_unverified'),
        request_json TEXT NOT NULL CHECK (json_valid(request_json) AND json_type(request_json) = 'object'),
        response_json TEXT NOT NULL CHECK (json_valid(response_json) AND json_type(response_json) = 'object'),
        idempotency_key TEXT NOT NULL UNIQUE CHECK (
          length(idempotency_key) BETWEEN 8 AND 120
          AND substr(idempotency_key, 1, 1) GLOB '[A-Za-z0-9]'
          AND idempotency_key NOT GLOB '*[^A-Za-z0-9._:-]*'
        ),
        mutation_sha256 TEXT NOT NULL CHECK (
          length(mutation_sha256) = 64 AND mutation_sha256 NOT GLOB '*[^0-9a-f]*'
        ),
        created_at TEXT NOT NULL,
        FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
      );

      CREATE INDEX idx_co_memory_responses_memory
        ON co_memory_responses(memory_id, created_at DESC, id);
      CREATE INDEX idx_co_memory_responses_source
        ON co_memory_responses(kind, source_key, anchor_key);

      CREATE TRIGGER co_memory_response_immutable
      BEFORE UPDATE ON co_memory_responses
      BEGIN
        SELECT RAISE(ABORT, 'CO_MEMORY_RESPONSE_IMMUTABLE');
      END;
    `);
  }
});

function initializeCoMemoryResponseDatabase(options = {}) {
  const db = requireDatabase(options.db);
  const now = typeof options.now === "function" ? options.now : () => new Date().toISOString();
  const createId = typeof options.createId === "function"
    ? options.createId
    : (prefix) => `${prefix}-${randomUUID()}`;
  const suppliedTransaction = typeof options.withTransaction === "function" ? options.withTransaction : null;

  if (options.applyMigrations !== false) {
    applyMigrations({
      db,
      baselineVersion: 4,
      migrations: [CO_MEMORY_RESPONSE_MIGRATION],
      supportedVersion: Math.max(CO_MEMORY_RESPONSE_SCHEMA_VERSION, Number(options.schemaVersion) || CO_MEMORY_RESPONSE_SCHEMA_VERSION),
      now
    });
  }
  const statements = prepareStatements(db);

  function runAtomic(operation) {
    if (suppliedTransaction) return suppliedTransaction(operation);
    const savepoint = `co_memory_response_${randomUUID().replace(/-/gu, "")}`;
    db.exec(`SAVEPOINT ${savepoint}`);
    try {
      const result = operation();
      if (result && typeof result.then === "function") {
        throw new TypeError("Co-memory database transactions must be synchronous.");
      }
      db.exec(`RELEASE SAVEPOINT ${savepoint}`);
      return result;
    } catch (error) {
      try { db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`); } catch { /* preserve original error */ }
      try { db.exec(`RELEASE SAVEPOINT ${savepoint}`); } catch { /* preserve original error */ }
      throw normalizeDatabaseError(error);
    }
  }

  async function confirmCoMemoryResponse(input = {}, mutation = {}) {
    assertMutation(mutation);
    const idempotencyKey = requireIdempotencyKey(mutation.idempotencyKey);
    const normalized = await validateCoMemoryResponseConfirmation(input);
    const requestMutationSha256 = mutationSha256(normalized);
    const replayRow = statements.byIdempotency.get(idempotencyKey);
    if (replayRow) {
      if (replayRow.mutation_sha256 !== requestMutationSha256) throw idempotencyConflict();
      return deepFreeze({ created: false, idempotent: true, record: rowToCoMemoryResponse(replayRow) });
    }
    requireMemory(normalized.memoryId);
    const duplicateRequest = statements.byRequest.get(normalized.requestSha256, normalized.letterId);
    if (duplicateRequest) throw duplicateRequestError();
    const duplicateResponse = statements.byResponse.get(normalized.responseId, normalized.responseSha256);
    if (duplicateResponse) throw duplicateResponseError();
    const currentCount = Number(statements.countForMemory.get(normalized.memoryId)?.count || 0);
    if (currentCount >= MAX_CO_MEMORY_RESPONSES_PER_MEMORY) {
      throw coMemoryResponseError(
        "This memory reached the co-memory response safety limit.",
        "CO_MEMORY_RESPONSE_LIMIT",
        409
      );
    }
    const createdAt = requireTimestamp(now());
    const id = requireId(createId("co-memory-response"), "generated response record ID", 500);
    const candidate = validateStoredCoMemoryResponse({
      ...normalized,
      id,
      createdAt
    });
    return runAtomic(() => {
      // Recheck all uniqueness boundaries inside the same synchronous write
      // section after the asynchronous Web Crypto digest has completed.
      const replay = statements.byIdempotency.get(idempotencyKey);
      if (replay) {
        if (replay.mutation_sha256 !== requestMutationSha256) throw idempotencyConflict();
        return deepFreeze({ created: false, idempotent: true, record: rowToCoMemoryResponse(replay) });
      }
      if (statements.byRequest.get(candidate.requestSha256, candidate.letterId)) throw duplicateRequestError();
      if (statements.byResponse.get(candidate.responseId, candidate.responseSha256)) throw duplicateResponseError();
      statements.insert.run(
        candidate.id,
        candidate.schemaVersion,
        candidate.kind,
        candidate.memoryId,
        candidate.letterId,
        candidate.responseId,
        candidate.requestSha256,
        candidate.responseSha256,
        candidate.sourceKey,
        candidate.anchorKey,
        candidate.snapshotSha256,
        candidate.relationKind,
        candidate.label,
        candidate.excerpt,
        candidate.identityAssurance,
        0,
        1,
        0,
        candidate.confirmation,
        JSON.stringify(candidate.request),
        JSON.stringify(candidate.response),
        idempotencyKey,
        requestMutationSha256,
        candidate.createdAt
      );
      return deepFreeze({ created: true, idempotent: false, record: requireRecord(candidate.id) });
    });
  }

  function getCoMemoryResponse(id) {
    const recordId = requireId(id, "response record ID");
    const row = statements.byId.get(recordId);
    return row ? rowToCoMemoryResponse(row) : null;
  }

  function listCoMemoryResponses(query = {}) {
    assertQuery(query);
    const limit = boundedLimit(query.limit);
    const rows = query.memoryId === undefined
      ? statements.listAll.all(limit)
      : statements.listForMemory.all(requireId(query.memoryId, "memoryId"), limit);
    return deepFreeze(rows.map(rowToCoMemoryResponse));
  }

  function getCoMemoryResponseSource(referenceId) {
    const record = getCoMemoryResponse(referenceId);
    return record ? toCoMemoryResponseSource(record) : null;
  }

  function listCoMemoryResponseSources(memoryId) {
    return deepFreeze(listCoMemoryResponses({ memoryId, limit: MAX_CO_MEMORY_RESPONSES_PER_MEMORY })
      .map(toCoMemoryResponseSource));
  }

  function resolveCoMemoryResponseSource(memoryId, selection) {
    const referenceId = selection?.referenceId;
    const record = typeof referenceId === "string" ? getCoMemoryResponse(referenceId) : null;
    return resolveSourceProjection(record ? [record] : [], memoryId, selection);
  }

  function getCoMemoryResponseStats() {
    const row = statements.stats.get();
    return deepFreeze({
      responses: Number(row?.responses || 0),
      memories: Number(row?.memories || 0),
      unverifiedIdentity: Number(row?.unverified_identity || 0),
      encryptedTransport: Number(row?.encrypted_transport || 0),
      unsigned: Number(row?.unsigned_count || 0)
    });
  }

  function buildCoMemoryResponseBackupPayload(mode = "full", memoryIds) {
    if (getCoMemoryResponseStats().responses > MAX_CO_MEMORY_RESPONSE_BACKUP_RECORDS) {
      throw coMemoryResponseError(
        "Co-memory response backup exceeds its record budget.",
        "CO_MEMORY_RESPONSE_BACKUP_LIMIT",
        409
      );
    }
    return buildCoMemoryResponseBackup(listCoMemoryResponses({ limit: 10000 }), mode, memoryIds);
  }

  function validateCoMemoryResponseBackup(payload, memoryIds) {
    return validateCoMemoryResponseBackupPayload(payload, memoryIds === undefined ? {} : { memoryIds });
  }

  function restoreCoMemoryResponseBackup(payload, restoreOptions = {}) {
    if (payload?.mode === "redacted-summary") {
      validateCoMemoryResponseBackupPayload(payload);
      return {
        responses: 0,
        reused: 0,
        skipped: 0,
        summarized: true,
        idMap: { responses: {} }
      };
    }
    assertRestoreOptions(restoreOptions);
    const memoryIdMap = normalizeMemoryIdMap(restoreOptions.memoryIdMap);
    validateCoMemoryResponseBackupPayload(payload, { memoryIds: [...memoryIdMap.keys()] });
    const records = payload.responses.map(normalizeBackupRecord);
    const additionsByMemory = new Map();
    const plans = records.map((record) => {
      const targetMemoryId = memoryIdMap.get(record.memoryId);
      if (!targetMemoryId) {
        throw coMemoryResponseError(
          "Co-memory restore is missing a memory ID mapping.",
          "CO_MEMORY_RESTORE_MAPPING_INVALID",
          409
        );
      }
      if (targetMemoryId !== record.memoryId) {
        throw coMemoryResponseError(
          "Encrypted co-memory responses cannot be rebound to another memory ID.",
          "CO_MEMORY_RESTORE_MEMORY_REBIND_FORBIDDEN",
          409
        );
      }
      requireMemory(targetMemoryId);
      const collisions = statements.restoreCollision.all(
        record.id,
        record.letterId,
        record.responseId,
        record.requestSha256,
        record.responseSha256,
        record.sourceKey,
        record.anchorKey
      );
      if (collisions.length) {
        if (collisions.length !== 1) throw restoreIdentityConflict();
        const existing = normalizeBackupRecord(rowToCoMemoryResponse(collisions[0]));
        if (existing.id !== record.id || stableStringify(existing) !== stableStringify(record)) {
          throw restoreIdentityConflict();
        }
        return { record, reused: true };
      }
      additionsByMemory.set(record.memoryId, (additionsByMemory.get(record.memoryId) || 0) + 1);
      return { record, reused: false };
    });
    for (const [memoryId, additions] of additionsByMemory) {
      const currentCount = Number(statements.countForMemory.get(memoryId)?.count || 0);
      if (currentCount + additions > MAX_CO_MEMORY_RESPONSES_PER_MEMORY) {
        throw coMemoryResponseError(
          "Co-memory restore exceeds the per-memory response safety limit.",
          "CO_MEMORY_RESPONSE_LIMIT",
          409
        );
      }
    }
    return runAtomic(() => {
      for (const plan of plans) {
        if (plan.reused) continue;
        const record = plan.record;
        statements.insert.run(
          record.id,
          record.schemaVersion,
          record.kind,
          record.memoryId,
          record.letterId,
          record.responseId,
          record.requestSha256,
          record.responseSha256,
          record.sourceKey,
          record.anchorKey,
          record.snapshotSha256,
          record.relationKind,
          record.label,
          record.excerpt,
          record.identityAssurance,
          0,
          1,
          0,
          record.confirmation,
          JSON.stringify(record.request),
          JSON.stringify(record.response),
          `restore:${record.responseSha256}`,
          sha256(`time-isle-co-memory-restore-v1\0${stableStringify(record)}`),
          record.createdAt
        );
      }
      return {
        responses: plans.length,
        reused: plans.filter((plan) => plan.reused).length,
        skipped: 0,
        summarized: false,
        idMap: { responses: Object.fromEntries(records.map((record) => [record.id, record.id])) }
      };
    });
  }

  function clearCoMemoryResponses() {
    return runAtomic(() => {
      const responsesDeleted = getCoMemoryResponseStats().responses;
      statements.clearResponses.run();
      return { coMemoryResponsesDeleted: responsesDeleted };
    });
  }

  function requireMemory(memoryId) {
    if (!statements.memoryExists.get(memoryId)) {
      throw coMemoryResponseError("The target memory does not exist.", "CO_MEMORY_MEMORY_NOT_FOUND", 404);
    }
  }

  function requireRecord(id) {
    const record = getCoMemoryResponse(id);
    if (!record) throw coMemoryResponseError("Saved co-memory response is missing.", "CO_MEMORY_RESPONSE_WRITE_FAILED", 500);
    return record;
  }

  return Object.freeze({
    buildCoMemoryResponseBackup: buildCoMemoryResponseBackupPayload,
    clearCoMemoryResponses,
    confirmCoMemoryResponse,
    getCoMemoryResponse,
    getCoMemoryResponseSource,
    getCoMemoryResponseStats,
    listCoMemoryResponseSources,
    listCoMemoryResponses,
    resolveCoMemoryResponseSource,
    restoreCoMemoryResponseBackup,
    validateCoMemoryResponseBackup
  });
}

function prepareStatements(db) {
  return {
    insert: db.prepare(`
      INSERT INTO co_memory_responses (
        id, schema_version, kind, memory_id, letter_id, response_id, request_sha256, response_sha256,
        source_key, anchor_key, snapshot_sha256, relation_kind, label, excerpt_text, identity_assurance,
        identity_verified, encrypted, signed, confirmation, request_json, response_json,
        idempotency_key, mutation_sha256, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    byId: db.prepare("SELECT * FROM co_memory_responses WHERE id = ?"),
    byIdempotency: db.prepare("SELECT * FROM co_memory_responses WHERE idempotency_key = ?"),
    byRequest: db.prepare(`
      SELECT id FROM co_memory_responses
      WHERE request_sha256 = ? OR letter_id = ?
      LIMIT 1
    `),
    byResponse: db.prepare(`
      SELECT id FROM co_memory_responses
      WHERE response_id = ? OR response_sha256 = ?
      LIMIT 1
    `),
    restoreCollision: db.prepare(`
      SELECT * FROM co_memory_responses
      WHERE id = ?1 OR letter_id = ?2 OR response_id = ?3 OR request_sha256 = ?4
        OR response_sha256 = ?5 OR source_key = ?6 OR anchor_key = ?7
      ORDER BY id
      LIMIT 2
    `),
    memoryExists: db.prepare("SELECT 1 AS found FROM memories WHERE id = ? LIMIT 1"),
    countForMemory: db.prepare("SELECT COUNT(*) AS count FROM co_memory_responses WHERE memory_id = ?"),
    listAll: db.prepare(`
      SELECT * FROM co_memory_responses
      ORDER BY memory_id ASC, created_at ASC, id ASC
      LIMIT ?
    `),
    listForMemory: db.prepare(`
      SELECT * FROM co_memory_responses
      WHERE memory_id = ?
      ORDER BY created_at ASC, id ASC
      LIMIT ?
    `),
    stats: db.prepare(`
      SELECT COUNT(*) AS responses,
        COUNT(DISTINCT memory_id) AS memories,
        SUM(CASE WHEN identity_verified = 0 THEN 1 ELSE 0 END) AS unverified_identity,
        SUM(CASE WHEN encrypted = 1 THEN 1 ELSE 0 END) AS encrypted_transport,
        SUM(CASE WHEN signed = 0 THEN 1 ELSE 0 END) AS unsigned_count
      FROM co_memory_responses
    `),
    clearResponses: db.prepare("DELETE FROM co_memory_responses")
  };
}

function rowToCoMemoryResponse(row) {
  if (!row) return null;
  let request;
  let response;
  try {
    request = JSON.parse(row.request_json);
    response = JSON.parse(row.response_json);
  } catch (cause) {
    const error = coMemoryResponseError("Stored co-memory JSON is invalid.", "CO_MEMORY_STORED_JSON_INVALID", 500);
    error.cause = cause;
    throw error;
  }
  return validateStoredCoMemoryResponse({
    schemaVersion: Number(row.schema_version),
    id: row.id,
    kind: row.kind,
    memoryId: row.memory_id,
    letterId: row.letter_id,
    responseId: row.response_id,
    requestSha256: row.request_sha256,
    responseSha256: row.response_sha256,
    sourceKey: row.source_key,
    anchorKey: row.anchor_key,
    snapshotSha256: row.snapshot_sha256,
    relationKind: row.relation_kind,
    label: row.label,
    excerpt: row.excerpt_text,
    identityAssurance: row.identity_assurance,
    identityVerified: Number(row.identity_verified) === 1,
    encrypted: Number(row.encrypted) === 1,
    signed: Number(row.signed) === 1,
    confirmation: row.confirmation,
    request,
    response,
    createdAt: row.created_at
  });
}

function assertMutation(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Object.keys(value).some((key) => key !== "idempotencyKey")) {
    throw coMemoryResponseError("Mutation options are invalid.", "CO_MEMORY_MUTATION_INVALID");
  }
}

function assertQuery(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Object.keys(value).some((key) => !new Set(["memoryId", "limit"]).has(key))) {
    throw coMemoryResponseError("Co-memory response query is invalid.", "CO_MEMORY_QUERY_INVALID");
  }
}

function assertRestoreOptions(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Object.keys(value).some((key) => key !== "memoryIdMap")) {
    throw coMemoryResponseError("Restore options are invalid.", "CO_MEMORY_RESTORE_OPTIONS_INVALID");
  }
}

function normalizeMemoryIdMap(value) {
  const entries = value instanceof Map
    ? [...value]
    : value && typeof value === "object" && !Array.isArray(value)
      ? Object.entries(value)
      : null;
  if (!entries) {
    throw coMemoryResponseError("memoryIdMap is required.", "CO_MEMORY_RESTORE_MAPPING_INVALID", 409);
  }
  const result = new Map();
  for (const [source, target] of entries) {
    const sourceId = requireId(source, "source memory ID");
    const targetId = requireId(target, "target memory ID");
    if (result.has(sourceId)) {
      throw coMemoryResponseError("memoryIdMap contains duplicate source IDs.", "CO_MEMORY_RESTORE_MAPPING_INVALID", 409);
    }
    result.set(sourceId, targetId);
  }
  return result;
}

function requireIdempotencyKey(value) {
  const key = String(value || "").trim();
  if (!IDEMPOTENCY_PATTERN.test(key)) {
    throw coMemoryResponseError("Idempotency-Key is invalid.", "CO_MEMORY_IDEMPOTENCY_KEY_INVALID");
  }
  return key;
}

function requireId(value, name, statusCode = 400) {
  const id = String(value || "");
  if (!ID_PATTERN.test(id)) throw coMemoryResponseError(`${name} is invalid.`, "CO_MEMORY_RECORD_ID_INVALID", statusCode);
  return id;
}

function requireTimestamp(value) {
  const timestamp = String(value || "");
  if (!timestamp || timestamp.length > 40 || !Number.isFinite(Date.parse(timestamp)) ||
      new Date(timestamp).toISOString() !== timestamp) {
    throw coMemoryResponseError("Current time is invalid.", "CO_MEMORY_TIMESTAMP_INVALID", 500);
  }
  return timestamp;
}

function boundedLimit(value) {
  if (value === undefined) return 200;
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10000) {
    throw coMemoryResponseError("Query limit is invalid.", "CO_MEMORY_QUERY_INVALID");
  }
  return limit;
}

function duplicateRequestError() {
  return coMemoryResponseError(
    "This co-memory request or letter was already saved.",
    "CO_MEMORY_DUPLICATE_REQUEST",
    409
  );
}

function duplicateResponseError() {
  return coMemoryResponseError(
    "This co-memory response was already saved.",
    "CO_MEMORY_DUPLICATE_RESPONSE",
    409
  );
}

function idempotencyConflict() {
  return coMemoryResponseError(
    "Idempotency-Key was already used for a different co-memory response.",
    "CO_MEMORY_IDEMPOTENCY_CONFLICT",
    409
  );
}

function restoreIdentityConflict() {
  return coMemoryResponseError(
    "Co-memory restore conflicts with an existing response identity and cannot remap it safely.",
    "CO_MEMORY_RESTORE_IDENTITY_CONFLICT",
    409
  );
}

function normalizeDatabaseError(error) {
  const message = String(error?.message || "");
  if (message.includes("co_memory_responses.idempotency_key")) return idempotencyConflict();
  if (message.includes("co_memory_responses.request_sha256") || message.includes("co_memory_responses.letter_id")) {
    return duplicateRequestError();
  }
  if (message.includes("co_memory_responses.response_id") || message.includes("co_memory_responses.response_sha256") ||
      message.includes("co_memory_responses.source_key")) return duplicateResponseError();
  if (message.includes("CO_MEMORY_RESPONSE_IMMUTABLE")) {
    return coMemoryResponseError("Saved co-memory responses are immutable.", "CO_MEMORY_RESPONSE_IMMUTABLE", 409);
  }
  return error;
}

function requireDatabase(db) {
  if (!db || typeof db.exec !== "function" || typeof db.prepare !== "function") {
    throw new TypeError("initializeCoMemoryResponseDatabase requires a synchronous SQLite database.");
  }
  return db;
}

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  Object.values(value).forEach((item) => deepFreeze(item, seen));
  return Object.freeze(value);
}

module.exports = {
  CO_MEMORY_RESPONSE_MIGRATION,
  MAX_CO_MEMORY_RESPONSES_PER_MEMORY,
  initializeCoMemoryResponseDatabase,
  rowToCoMemoryResponse
};
