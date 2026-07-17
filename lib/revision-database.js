"use strict";

const { randomUUID } = require("node:crypto");
const { applyMigrations } = require("./migrations");
const {
  REVISION_SCHEMA_VERSION,
  buildRevisionBackup: buildBackupContract,
  createMemorySnapshot,
  memorySnapshotSha256,
  remapRevisionBackup,
  serializeMemorySnapshot,
  validateMemorySnapshot,
  validateRevisionBackup: validateBackupContract
} = require("./revision-backup");

const ID_PATTERN = /^[a-zA-Z0-9_-]{1,120}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const INITIAL_CHANGE_KINDS = new Set(["baseline", "created", "imported"]);
const NEXT_CHANGE_KINDS = new Set(["edited", "restored"]);

const REVISION_MIGRATION = Object.freeze({
  version: REVISION_SCHEMA_VERSION,
  name: "memory-revisions",
  up(db) {
    db.exec(`
      CREATE TABLE memory_revisions (
        id TEXT PRIMARY KEY,
        memory_id TEXT NOT NULL,
        revision_no INTEGER NOT NULL CHECK (revision_no > 0),
        parent_sha256 TEXT NOT NULL DEFAULT '',
        snapshot_json TEXT NOT NULL CHECK (
          length(snapshot_json) >= 2 AND length(snapshot_json) <= 65536
        ),
        snapshot_sha256 TEXT NOT NULL CHECK (
          length(snapshot_sha256) = 64
          AND snapshot_sha256 NOT GLOB '*[^0-9a-f]*'
        ),
        change_kind TEXT NOT NULL CHECK (
          change_kind IN ('baseline', 'created', 'edited', 'restored', 'imported')
        ),
        change_note TEXT NOT NULL DEFAULT '' CHECK (length(change_note) <= 500),
        restored_from_revision_id TEXT NOT NULL DEFAULT '',
        source_updated_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (memory_id, revision_no),
        FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE,
        CHECK (
          (revision_no = 1 AND parent_sha256 = '')
          OR
          (revision_no > 1 AND length(parent_sha256) = 64
            AND parent_sha256 NOT GLOB '*[^0-9a-f]*')
        ),
        CHECK (
          (change_kind = 'restored' AND restored_from_revision_id <> '')
          OR
          (change_kind <> 'restored' AND restored_from_revision_id = '')
        )
      );

      CREATE INDEX idx_memory_revisions_memory
        ON memory_revisions(memory_id, revision_no DESC);

      UPDATE memories
      SET updated_at = created_at
      WHERE trim(updated_at) = '';
    `);
  }
});

function initializeRevisionDatabase(options = {}) {
  const db = requireDatabase(options.db);
  const suppliedTransaction = typeof options.withTransaction === "function" ? options.withTransaction : null;
  const now = typeof options.now === "function" ? options.now : () => new Date().toISOString();
  const createId = typeof options.createId === "function"
    ? options.createId
    : (prefix) => `${prefix}-${randomUUID()}`;

  if (options.applyMigrations !== false) {
    const supportedVersion = Math.max(REVISION_SCHEMA_VERSION, Number(options.schemaVersion) || REVISION_SCHEMA_VERSION);
    applyMigrations({
      db,
      baselineVersion: 4,
      migrations: [REVISION_MIGRATION],
      supportedVersion,
      now
    });
  }

  const statements = prepareStatements(db);

  function runAtomic(operation) {
    if (suppliedTransaction) return suppliedTransaction(operation);
    const savepoint = `revision_write_${randomUUID().replace(/-/gu, "")}`;
    db.exec(`SAVEPOINT ${savepoint}`);
    try {
      const result = operation();
      if (result && typeof result.then === "function") throw new TypeError("修订数据库事务必须同步执行。");
      db.exec(`RELEASE SAVEPOINT ${savepoint}`);
      return result;
    } catch (error) {
      try { db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`); } catch { /* keep original */ }
      try { db.exec(`RELEASE SAVEPOINT ${savepoint}`); } catch { /* keep original */ }
      throw error;
    }
  }

  function recordMemoryCreation(memory, details = {}) {
    assertPlainObject(details, "revision details");
    const memoryId = requireMemory(memory);
    const changeKind = details.changeKind === undefined ? "created" : requireInitialKind(details.changeKind);
    return runAtomic(() => {
      requireStoredMemory(memoryId);
      const existing = readHead(memoryId);
      const snapshot = createMemorySnapshot(memory);
      const hash = memorySnapshotSha256(snapshot);
      if (existing) {
        if (existing.snapshotSha256 === hash) return { changed: false, head: existing };
        throw revisionError("这件展品已经存在不同的修订 head。", "REVISION_HEAD_EXISTS", 409);
      }
      const revision = makeRevision({
        id: details.id,
        memoryId,
        revisionNo: 1,
        parentSha256: "",
        snapshot,
        snapshotSha256: hash,
        changeKind,
        changeNote: details.changeNote,
        restoredFromRevisionId: "",
        sourceUpdatedAt: details.sourceUpdatedAt || memory.updatedAt || memory.createdAt,
        createdAt: details.createdAt
      });
      assertRevisionLedgerWritable([revision]);
      insertRevision(revision);
      return { changed: true, head: revision };
    });
  }

  function recordMemoryTransition(previousMemory, nextMemory, details = {}) {
    assertPlainObject(details, "revision transition details");
    const memoryId = requireMemory(previousMemory);
    if (requireMemory(nextMemory) !== memoryId) {
      throw revisionError("修订前后必须属于同一件展品。", "REVISION_MEMORY_MISMATCH");
    }
    const previousSnapshot = createMemorySnapshot(previousMemory);
    const nextSnapshot = createMemorySnapshot(nextMemory);
    const previousHash = memorySnapshotSha256(previousSnapshot);
    const nextHash = memorySnapshotSha256(nextSnapshot);
    const changeKind = details.changeKind === undefined ? "edited" : requireNextKind(details.changeKind);

    return runAtomic(() => {
      requireStoredMemory(memoryId);
      let head = readHead(memoryId);
      if (head && head.snapshotSha256 !== previousHash) {
        throw revisionError("当前展品与修订 head 不一致，已拒绝继续写入。", "REVISION_HEAD_MISMATCH", 409);
      }
      if (nextHash === previousHash) return { baselineCreated: false, changed: false, head };

      let baselineCreated = false;
      const pending = [];
      if (!head) {
        const baseline = makeRevision({
          id: details.baselineId,
          memoryId,
          revisionNo: 1,
          parentSha256: "",
          snapshot: previousSnapshot,
          snapshotSha256: previousHash,
          changeKind: "baseline",
          changeNote: details.baselineNote || "",
          restoredFromRevisionId: "",
          sourceUpdatedAt: details.baselineSourceUpdatedAt || previousMemory.updatedAt || previousMemory.createdAt,
          createdAt: details.baselineCreatedAt || details.createdAt
        });
        pending.push(baseline);
        head = baseline;
        baselineCreated = true;
      }

      const restoredFromRevisionId = changeKind === "restored"
        ? requireRestoredSource(memoryId, details.restoredFromRevisionId, head.revisionNo)
        : "";
      const revision = makeRevision({
        id: details.id,
        memoryId,
        revisionNo: head.revisionNo + 1,
        parentSha256: head.snapshotSha256,
        snapshot: nextSnapshot,
        snapshotSha256: nextHash,
        changeKind,
        changeNote: details.changeNote,
        restoredFromRevisionId,
        sourceUpdatedAt: details.sourceUpdatedAt || nextMemory.updatedAt || getNow(),
        createdAt: details.createdAt
      });
      pending.push(revision);
      assertRevisionLedgerWritable(pending);
      pending.forEach(insertRevision);
      return { baselineCreated, changed: true, head: revision };
    });
  }

  function verifyMemoryHead(memory) {
    const memoryId = requireMemory(memory);
    const head = readHead(memoryId);
    if (!head) return { matches: true, tracked: false, head: null };
    const actual = memorySnapshotSha256(createMemorySnapshot(memory));
    return { matches: actual === head.snapshotSha256, tracked: true, head };
  }

  function listMemoryRevisions(memoryId) {
    const id = requireId(memoryId, "memoryId");
    return statements.listForMemory.all(id).map(rowToRevision);
  }

  function getMemoryRevision(memoryId, revisionId) {
    const row = statements.getForMemory.get(
      requireId(memoryId, "memoryId"),
      requireId(revisionId, "revisionId")
    );
    return row ? rowToRevision(row) : null;
  }

  function getMemoryRevisionHead(memoryId) {
    return readHead(requireId(memoryId, "memoryId"));
  }

  function listRecentMemoryRevisions(options = {}) {
    assertPlainObject(options, "recent revision options");
    const requested = Number(options.limit) || 30;
    const limit = Math.min(100, Math.max(1, Math.trunc(requested)));
    return statements.listRecent.all(limit).map((row) => ({
      ...rowToRevision(row),
      memoryTitle: String(row.memory_title || "").trim() || "未命名记忆"
    }));
  }

  function getRevisionStats(memoryIds) {
    const rows = memoryIds === undefined
      ? statements.listAll.all()
      : listRowsForBoundary(memoryIds);
    return {
      memories: new Set(rows.map((row) => row.memory_id)).size,
      revisions: rows.length
    };
  }

  function buildRevisionBackup(mode = "full", memoryIds) {
    const rows = memoryIds === undefined ? statements.listAll.all() : listRowsForBoundary(memoryIds);
    return buildBackupContract({ revisions: rows }, mode, memoryIds);
  }

  function validateRevisionBackup(backup, sourceMemoryIds) {
    return validateBackupContract(backup, sourceMemoryIds);
  }

  function restoreRevisionBackup(backup, memoryIdMap, restoreOptions = {}) {
    assertPlainObject(restoreOptions, "revision restore options");
    if (backup?.mode === "redacted-summary") {
      validateBackupContract(backup, []);
      return { memories: 0, revisions: 0, skipped: 0, idMap: { memories: {}, revisions: {} } };
    }
    const sourceMemoryIds = unique(backup.revisions.map((revision) => revision.memoryId));
    validateBackupContract(backup, sourceMemoryIds);
    const remapped = remapRevisionBackup(backup, {
      memoryIdMap,
      revisionIdMap: restoreOptions.revisionIdMap,
      occupiedRevisionIds: statements.listIds.all().map((row) => row.id),
      createId
    });

    return runAtomic(() => {
      const targetMemoryIds = unique(remapped.backup.revisions.map((revision) => revision.memoryId));
      targetMemoryIds.forEach((memoryId) => {
        requireStoredMemory(memoryId);
        if (statements.countForMemory.get(memoryId).count) {
          throw revisionError("目标展品已存在修订历史，不能覆盖恢复。", "REVISION_RESTORE_TARGET_NOT_EMPTY", 409);
        }
      });
      assertRevisionLedgerWritable(remapped.backup.revisions);
      remapped.backup.revisions.forEach(insertRevision);
      targetMemoryIds.forEach((memoryId) => {
        const head = readHead(memoryId);
        const current = readStoredMemorySnapshot(memoryId);
        if (!head || head.snapshotSha256 !== memorySnapshotSha256(current)) {
          throw revisionError("恢复后的修订 head 与当前展品不一致。", "REVISION_RESTORE_HEAD_MISMATCH");
        }
      });
      return {
        memories: targetMemoryIds.length,
        revisions: remapped.backup.revisions.length,
        skipped: 0,
        idMap: remapped.idMap
      };
    });
  }

  function clearRevisions(memoryIds) {
    return runAtomic(() => {
      if (memoryIds === undefined) return { revisionsDeleted: Number(statements.clearAll.run().changes) || 0 };
      const ids = normalizeMemoryIds(memoryIds);
      let revisionsDeleted = 0;
      ids.forEach((id) => { revisionsDeleted += Number(statements.clearForMemory.run(id).changes) || 0; });
      return { revisionsDeleted };
    });
  }

  function readHead(memoryId) {
    const row = statements.headForMemory.get(memoryId);
    return row ? rowToRevision(row) : null;
  }

  function assertRevisionLedgerWritable(additions = []) {
    const rows = statements.listAll.all();
    const revisions = rows.concat(additions);
    const memoryIds = unique(revisions.map((revision) => revision.memory_id || revision.memoryId));
    buildBackupContract({ revisions }, "full", memoryIds);
  }

  function insertRevision(input) {
    const revision = normalizeRevisionForInsert(input);
    try {
      statements.insert.run(
        revision.id,
        revision.memoryId,
        revision.revisionNo,
        revision.parentSha256,
        JSON.stringify(revision.snapshot),
        revision.snapshotSha256,
        revision.changeKind,
        revision.changeNote,
        revision.restoredFromRevisionId,
        revision.sourceUpdatedAt,
        revision.createdAt
      );
    } catch (cause) {
      if (String(cause?.message || "").includes("UNIQUE")) {
        throw revisionError("修订 ID 或序号已存在。", "REVISION_EXISTS", 409, cause);
      }
      throw cause;
    }
    return revision;
  }

  function makeRevision(input) {
    const snapshot = validateMemorySnapshot(input.snapshot);
    const snapshotSha256 = memorySnapshotSha256(snapshot);
    if (input.snapshotSha256 && input.snapshotSha256 !== snapshotSha256) {
      throw revisionError("修订快照哈希不一致。", "REVISION_HASH_MISMATCH");
    }
    return normalizeRevisionForInsert({
      id: input.id || newId("revision"),
      memoryId: input.memoryId,
      revisionNo: input.revisionNo,
      parentSha256: input.parentSha256,
      snapshot,
      snapshotSha256,
      changeKind: input.changeKind,
      changeNote: input.changeNote || "",
      restoredFromRevisionId: input.restoredFromRevisionId || "",
      sourceUpdatedAt: input.sourceUpdatedAt || getNow(),
      createdAt: input.createdAt || getNow()
    });
  }

  function normalizeRevisionForInsert(input) {
    assertPlainObject(input, "revision");
    const snapshot = validateMemorySnapshot(input.snapshot);
    const snapshotSha256 = requireSha256(input.snapshotSha256, "snapshotSha256");
    if (snapshotSha256 !== memorySnapshotSha256(snapshot)) {
      throw revisionError("修订快照哈希不一致。", "REVISION_HASH_MISMATCH");
    }
    const changeKind = requireChangeKind(input.changeKind);
    const restoredFromRevisionId = input.restoredFromRevisionId
      ? requireId(input.restoredFromRevisionId, "restoredFromRevisionId")
      : "";
    if ((changeKind === "restored") !== Boolean(restoredFromRevisionId)) {
      throw revisionError("恢复修订与来源修订字段不一致。", "REVISION_RESTORE_SOURCE_INVALID");
    }
    return {
      id: requireId(input.id, "revision.id"),
      memoryId: requireId(input.memoryId, "revision.memoryId"),
      revisionNo: requirePositiveInteger(input.revisionNo, "revision.revisionNo"),
      parentSha256: input.parentSha256 ? requireSha256(input.parentSha256, "revision.parentSha256") : "",
      snapshot,
      snapshotSha256,
      changeKind,
      changeNote: requireCanonicalText(input.changeNote || "", "revision.changeNote", 500),
      restoredFromRevisionId,
      sourceUpdatedAt: requireTimestamp(input.sourceUpdatedAt, "revision.sourceUpdatedAt"),
      createdAt: requireTimestamp(input.createdAt, "revision.createdAt")
    };
  }

  function rowToRevision(row) {
    let snapshot;
    try { snapshot = JSON.parse(row.snapshot_json); } catch { throw revisionError("数据库中的修订快照损坏。", "REVISION_SNAPSHOT_CORRUPT", 500); }
    const revision = normalizeRevisionForInsert({
      id: row.id,
      memoryId: row.memory_id,
      revisionNo: Number(row.revision_no),
      parentSha256: row.parent_sha256 || "",
      snapshot,
      snapshotSha256: row.snapshot_sha256,
      changeKind: row.change_kind,
      changeNote: row.change_note || "",
      restoredFromRevisionId: row.restored_from_revision_id || "",
      sourceUpdatedAt: row.source_updated_at,
      createdAt: row.created_at
    });
    return revision;
  }

  function readStoredMemorySnapshot(memoryId) {
    const row = statements.getMemory.get(memoryId);
    if (!row) throw revisionError("没有找到修订对应的展品。", "REVISION_MEMORY_NOT_FOUND", 404);
    return createMemorySnapshot({
      ...row,
      attachments: parseJson(row.attachments_json, []),
      emotions: statements.emotionsFor.all(memoryId).map((item) => item.emotion),
      people: statements.peopleFor.all(memoryId).map((item) => item.name),
      tags: statements.tagsFor.all(memoryId).map((item) => item.tag)
    });
  }

  function requireRestoredSource(memoryId, revisionId, headRevisionNo) {
    const id = requireId(revisionId, "restoredFromRevisionId");
    const source = getMemoryRevision(memoryId, id);
    if (!source || source.revisionNo >= headRevisionNo + 1) {
      throw revisionError("恢复来源必须是同一展品已有的旧修订。", "REVISION_RESTORE_SOURCE_INVALID");
    }
    return id;
  }

  function requireStoredMemory(memoryId) {
    if (!statements.memoryExists.get(memoryId)) {
      throw revisionError("没有找到修订对应的展品。", "REVISION_MEMORY_NOT_FOUND", 404);
    }
  }

  function listRowsForBoundary(memoryIds) {
    const ids = normalizeMemoryIds(memoryIds);
    return ids.flatMap((id) => statements.listForMemory.all(id));
  }

  function getNow() {
    return requireTimestamp(now(), "now()");
  }

  function newId(prefix) {
    return requireId(createId(prefix), `${prefix} id`);
  }

  return Object.freeze({
    buildRevisionBackup,
    clearRevisions,
    getMemoryRevision,
    getMemoryRevisionHead,
    getRevisionStats,
    listMemoryRevisions,
    listRecentMemoryRevisions,
    recordMemoryCreation,
    recordMemoryTransition,
    restoreRevisionBackup,
    validateRevisionBackup,
    verifyMemoryHead
  });
}

function prepareStatements(db) {
  return {
    insert: db.prepare(`
      INSERT INTO memory_revisions (
        id, memory_id, revision_no, parent_sha256, snapshot_json, snapshot_sha256,
        change_kind, change_note, restored_from_revision_id, source_updated_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    listAll: db.prepare("SELECT * FROM memory_revisions ORDER BY memory_id, revision_no, id"),
    listRecent: db.prepare(`
      SELECT revisions.*, memories.title AS memory_title
      FROM memory_revisions AS revisions
      INNER JOIN memories ON memories.id = revisions.memory_id
      ORDER BY revisions.created_at DESC, revisions.revision_no DESC, revisions.id ASC
      LIMIT ?
    `),
    listIds: db.prepare("SELECT id FROM memory_revisions ORDER BY id"),
    listForMemory: db.prepare("SELECT * FROM memory_revisions WHERE memory_id = ? ORDER BY revision_no, id"),
    headForMemory: db.prepare("SELECT * FROM memory_revisions WHERE memory_id = ? ORDER BY revision_no DESC LIMIT 1"),
    getForMemory: db.prepare("SELECT * FROM memory_revisions WHERE memory_id = ? AND id = ?"),
    countForMemory: db.prepare("SELECT COUNT(*) AS count FROM memory_revisions WHERE memory_id = ?"),
    clearForMemory: db.prepare("DELETE FROM memory_revisions WHERE memory_id = ?"),
    clearAll: db.prepare("DELETE FROM memory_revisions"),
    memoryExists: db.prepare("SELECT 1 FROM memories WHERE id = ?"),
    getMemory: db.prepare("SELECT * FROM memories WHERE id = ?"),
    peopleFor: db.prepare("SELECT name FROM memory_people WHERE memory_id = ? ORDER BY name"),
    tagsFor: db.prepare("SELECT tag FROM memory_tags WHERE memory_id = ? ORDER BY tag"),
    emotionsFor: db.prepare("SELECT emotion FROM memory_emotions WHERE memory_id = ? ORDER BY emotion")
  };
}

function requireDatabase(db) {
  if (!db || typeof db.exec !== "function" || typeof db.prepare !== "function") {
    throw new TypeError("initializeRevisionDatabase 需要同步 SQLite 数据库连接。");
  }
  return db;
}

function requireMemory(memory) {
  if (!memory || typeof memory !== "object" || Array.isArray(memory)) {
    throw revisionError("memory 必须是对象。", "REVISION_MEMORY_INVALID");
  }
  return requireId(memory.id, "memory.id");
}

function requireInitialKind(value) {
  if (!INITIAL_CHANGE_KINDS.has(value)) throw revisionError("首条修订类型无效。", "REVISION_CHANGE_KIND_INVALID");
  return value;
}

function requireNextKind(value) {
  if (!NEXT_CHANGE_KINDS.has(value)) throw revisionError("后续修订类型无效。", "REVISION_CHANGE_KIND_INVALID");
  return value;
}

function requireChangeKind(value) {
  if (!INITIAL_CHANGE_KINDS.has(value) && !NEXT_CHANGE_KINDS.has(value)) {
    throw revisionError("修订类型无效。", "REVISION_CHANGE_KIND_INVALID");
  }
  return value;
}

function requireId(value, name) {
  const id = String(value || "").trim();
  if (!ID_PATTERN.test(id)) throw revisionError(`${name} 无效。`, "REVISION_ID_INVALID");
  return id;
}

function requireSha256(value, name) {
  const hash = String(value || "");
  if (!SHA256_PATTERN.test(hash)) throw revisionError(`${name} 必须是小写 SHA-256。`, "REVISION_HASH_INVALID");
  return hash;
}

function requirePositiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) throw revisionError(`${name} 必须是正整数。`, "REVISION_VALUE_INVALID");
  return value;
}

function requireCanonicalText(value, name, maximum) {
  if (typeof value !== "string" || value !== value.trim() || value.includes("\u0000") || value.length > maximum) {
    throw revisionError(`${name} 文本无效。`, "REVISION_VALUE_INVALID");
  }
  return value;
}

function requireTimestamp(value, name) {
  if (typeof value !== "string" || !value || value.length > 40) throw revisionError(`${name} 时间无效。`, "REVISION_TIME_INVALID");
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw revisionError(`${name} 必须是规范 UTC 时间。`, "REVISION_TIME_INVALID");
  }
  return value;
}

function normalizeMemoryIds(value) {
  if (!Array.isArray(value)) throw revisionError("memoryIds 必须是数组。", "REVISION_MEMORY_INVALID");
  const ids = value.map((id) => requireId(id, "memoryId"));
  if (new Set(ids).size !== ids.length) throw revisionError("memoryIds 不能重复。", "REVISION_MEMORY_INVALID");
  return ids;
}

function parseJson(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function unique(values) {
  return [...new Set(values)];
}

function assertPlainObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw revisionError(`${name} 必须是普通对象。`, "REVISION_VALUE_INVALID");
  }
}

function revisionError(message, code, statusCode = 400, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

module.exports = {
  REVISION_MIGRATION,
  REVISION_SCHEMA_VERSION,
  initializeRevisionDatabase
};
