"use strict";

const { buildSemanticRecallDocument, semanticDocumentSourceSha256 } = require("./semantic-recall-service");

const SEMANTIC_INDEX_SCHEMA_VERSION = 20;
const SEMANTIC_INDEX_DIMENSIONS = 512;
const SEMANTIC_INDEX_VECTOR_BYTES = SEMANTIC_INDEX_DIMENSIONS * Float32Array.BYTES_PER_ELEMENT;
const SEMANTIC_INDEX_PROJECTION_VERSION = "v1";
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

const SEMANTIC_INDEX_MIGRATION = Object.freeze({
  version: SEMANTIC_INDEX_SCHEMA_VERSION,
  name: "semantic-embedding-derived-cache",
  up(db) {
    db.exec(`
      CREATE TABLE semantic_embedding_cache (
        memory_id TEXT PRIMARY KEY,
        source_sha256 TEXT NOT NULL CHECK (length(source_sha256) = 64 AND source_sha256 NOT GLOB '*[^0-9a-f]*'),
        projection_version TEXT NOT NULL,
        model_id TEXT NOT NULL,
        model_sha256 TEXT NOT NULL CHECK (length(model_sha256) = 64 AND model_sha256 NOT GLOB '*[^0-9a-f]*'),
        dimensions INTEGER NOT NULL CHECK (dimensions = 512),
        dtype TEXT NOT NULL CHECK (dtype = 'float32-le'),
        vector BLOB NOT NULL CHECK (length(vector) = 2048),
        updated_at TEXT NOT NULL,
        FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_semantic_embedding_model ON semantic_embedding_cache(model_id, model_sha256, projection_version);
    `);
  }
});

function initializeSemanticIndexDatabase(options = {}) {
  const db = requireDatabase(options.db);
  const withTransaction = typeof options.withTransaction === "function" ? options.withTransaction : (work) => work();
  const getMemory = requireFunction(options.getMemory, "getMemory");
  const listVoiceForMemory = requireFunction(options.listVoiceForMemory, "listVoiceForMemory");
  const now = typeof options.now === "function" ? options.now : () => new Date().toISOString();
  const statements = {
    get: db.prepare("SELECT * FROM semantic_embedding_cache WHERE memory_id = ?"),
    list: db.prepare("SELECT * FROM semantic_embedding_cache ORDER BY memory_id"),
    remove: db.prepare("DELETE FROM semantic_embedding_cache WHERE memory_id = ?"),
    clear: db.prepare("DELETE FROM semantic_embedding_cache"),
    upsert: db.prepare(`
      INSERT INTO semantic_embedding_cache (
        memory_id, source_sha256, projection_version, model_id, model_sha256,
        dimensions, dtype, vector, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(memory_id) DO UPDATE SET
        source_sha256 = excluded.source_sha256,
        projection_version = excluded.projection_version,
        model_id = excluded.model_id,
        model_sha256 = excluded.model_sha256,
        dimensions = excluded.dimensions,
        dtype = excluded.dtype,
        vector = excluded.vector,
        updated_at = excluded.updated_at
    `)
  };

  function getSemanticIndexStatus(options = {}) {
    const expected = normalizeIdentity(options, { allowEmpty: true });
    const rows = statements.list.all();
    const freshness = rows.reduce((result, row) => {
      const memory = getMemory(row.memory_id);
      if (!memory) result.orphaned += 1;
      else if (expected.modelId && (row.model_id !== expected.modelId || row.model_sha256 !== expected.modelSha256 || row.projection_version !== expected.projectionVersion)) result.stale += 1;
      else if (row.source_sha256 !== semanticSourceSha256(memory, listVoiceForMemory(memory.id))) result.stale += 1;
      else result.fresh += 1;
      return result;
    }, { fresh: 0, stale: 0, orphaned: 0 });
    return {
      enabled: true,
      persistence: "local-sqlite-derived-cache",
      encryptedAtRest: false,
      dimensions: SEMANTIC_INDEX_DIMENSIONS,
      dtype: "float32-le",
      projectionVersion: expected.projectionVersion || SEMANTIC_INDEX_PROJECTION_VERSION,
      modelId: expected.modelId || null,
      modelSha256: expected.modelSha256 || null,
      cachedCount: rows.length,
      ...freshness,
      updatedAt: rows.reduce((latest, row) => latest > row.updated_at ? latest : row.updated_at, "") || null
    };
  }

  function upsertSemanticEmbeddings(entries, options = {}) {
    const identity = normalizeIdentity(options);
    if (!Array.isArray(entries) || !entries.length || entries.length > 500) {
      throw indexError("向量批次必须包含 1 到 500 件展品。", "SEMANTIC_INDEX_BATCH_INVALID", 400);
    }
    const normalized = entries.map((entry, index) => normalizeEntry(entry, index));
    const seen = new Set();
    normalized.forEach((entry) => {
      if (seen.has(entry.memoryId)) throw indexError("一个批次不能重复写入同一件展品。", "SEMANTIC_INDEX_DUPLICATE_MEMORY", 400);
      seen.add(entry.memoryId);
    });
    return withTransaction(() => {
      let stored = 0;
      let stale = 0;
      normalized.forEach((entry) => {
        const memory = getMemory(entry.memoryId);
        if (!memory || semanticSourceSha256(memory, listVoiceForMemory(memory.id)) !== entry.sourceSha256) {
          stale += 1;
          return;
        }
        const result = statements.upsert.run(
          entry.memoryId, entry.sourceSha256, identity.projectionVersion, identity.modelId, identity.modelSha256,
          SEMANTIC_INDEX_DIMENSIONS, "float32-le", entry.vector, now()
        );
        if (result.changes) stored += 1;
        else stale += 1;
      });
      return { stored, stale, requested: normalized.length };
    });
  }

  function searchSemanticEmbeddings(queryVector, options = {}) {
    const identity = normalizeIdentity(options);
    const query = normalizeVector(queryVector, "queryVector");
    const limit = Math.min(30, Math.max(1, Number(options.limit) || 30));
    return statements.list.all()
      .filter((row) => row.model_id === identity.modelId && row.model_sha256 === identity.modelSha256 && row.projection_version === identity.projectionVersion)
      .map((row) => ({ row, memory: getMemory(row.memory_id) }))
      .filter(({ row, memory }) => memory && row.source_sha256 === semanticSourceSha256(memory, listVoiceForMemory(memory.id)))
      .map(({ row, memory }) => ({ memory, memoryId: row.memory_id, similarity: dot(query, new Float32Array(toArrayBuffer(row.vector))) }))
      .sort((left, right) => right.similarity - left.similarity || left.memoryId.localeCompare(right.memoryId))
      .slice(0, limit)
      .map((item, index) => ({ ...item, rank: index + 1 }));
  }

  function invalidateSemanticEmbedding(memoryId) {
    return Number(statements.remove.run(String(memoryId || "")).changes) || 0;
  }

  function invalidateSemanticEmbeddingIfStale(memory) {
    const memoryId = String(memory?.id || "");
    const row = statements.get.get(memoryId);
    if (!row || row.source_sha256 === semanticSourceSha256(memory, listVoiceForMemory(memoryId))) return 0;
    return Number(statements.remove.run(memoryId).changes) || 0;
  }

  function clearSemanticEmbeddings() {
    return { deleted: Number(statements.clear.run().changes) || 0 };
  }

  return Object.freeze({
    getSemanticIndexStatus,
    upsertSemanticEmbeddings,
    searchSemanticEmbeddings,
    invalidateSemanticEmbedding,
    invalidateSemanticEmbeddingIfStale,
    clearSemanticEmbeddings,
    semanticSourceSha256
  });
}

function semanticSourceSha256(memory, voices = []) {
  return semanticDocumentSourceSha256(buildSemanticRecallDocument(memory, voices, memory?.id));
}

function normalizeIdentity(value, options = {}) {
  const projectionVersion = String(value?.projectionVersion || SEMANTIC_INDEX_PROJECTION_VERSION).trim().slice(0, 40);
  const modelId = String(value?.modelId || "").trim().slice(0, 160);
  const modelSha256 = String(value?.modelSha256 || "").trim().toLowerCase();
  if (options.allowEmpty && !modelId && !modelSha256) return { projectionVersion, modelId: "", modelSha256: "" };
  if (!modelId || !SHA256_PATTERN.test(modelSha256)) {
    throw indexError("索引模型身份无效。", "SEMANTIC_INDEX_IDENTITY_INVALID", 400);
  }
  return { projectionVersion, modelId, modelSha256 };
}

function normalizeEntry(value, index) {
  const memoryId = String(value?.memoryId || "").trim();
  const sourceSha256 = String(value?.sourceSha256 || "").trim().toLowerCase();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/u.test(memoryId) || !SHA256_PATTERN.test(sourceSha256)) {
    throw indexError(`entries[${index}] 的展品或来源版本无效。`, "SEMANTIC_INDEX_ENTRY_INVALID", 400);
  }
  const vector = normalizeVector(value.vector, `entries[${index}].vector`);
  return { memoryId, sourceSha256, vector: Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength) };
}

function normalizeVector(value, label) {
  let array = Array.isArray(value) ? Float32Array.from(value) : value instanceof Float32Array ? value : null;
  if (!array && typeof value === "string" && /^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    const encoded = Buffer.from(value, "base64");
    if (encoded.byteLength === SEMANTIC_INDEX_VECTOR_BYTES) {
      array = new Float32Array(encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength));
    }
  }
  if (!array || array.length !== SEMANTIC_INDEX_DIMENSIONS || [...array].some((item) => !Number.isFinite(item))) {
    throw indexError(`${label} 必须是 ${SEMANTIC_INDEX_DIMENSIONS} 维有限数值向量。`, "SEMANTIC_INDEX_VECTOR_INVALID", 400);
  }
  return array;
}

function toArrayBuffer(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value || "");
  if (buffer.byteLength !== SEMANTIC_INDEX_VECTOR_BYTES) throw indexError("已保存的语义向量长度无效。", "SEMANTIC_INDEX_STORAGE_INVALID", 409);
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

function dot(left, right) {
  let total = 0;
  for (let index = 0; index < left.length; index += 1) total += left[index] * right[index];
  return total;
}

function requireDatabase(db) {
  if (!db || typeof db.prepare !== "function") throw new TypeError("semantic index requires a SQLite database.");
  return db;
}

function requireFunction(value, name) {
  if (typeof value !== "function") throw new TypeError(`${name} is required.`);
  return value;
}

function indexError(message, code, statusCode) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

module.exports = {
  SEMANTIC_INDEX_SCHEMA_VERSION,
  SEMANTIC_INDEX_DIMENSIONS,
  SEMANTIC_INDEX_PROJECTION_VERSION,
  SEMANTIC_INDEX_MIGRATION,
  initializeSemanticIndexDatabase,
  semanticSourceSha256
};
