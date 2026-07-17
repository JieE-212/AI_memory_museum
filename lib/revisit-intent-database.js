"use strict";

const { randomUUID } = require("node:crypto");
const { applyMigrations } = require("./migrations");
const { normalizeLocalContext } = require("./revisit-service");

const MAX_REVISIT_INTENTS = 500;
const INTENTS = new Set(["welcome", "later", "pause"]);
const ID_PATTERN = /^[a-zA-Z0-9_-]{1,120}$/u;
const REVISIT_INTENT_REDACTED_NOTE = "单件回访意愿、展品 ID、延后日期、时区和精确时间已从脱敏导出中物理移除。";

const REVISIT_INTENT_MIGRATION = Object.freeze({
  version: 11,
  name: "memory-revisit-intents",
  up(db) {
    db.exec(`
      CREATE TABLE memory_revisit_intents (
        memory_id TEXT PRIMARY KEY,
        intent TEXT NOT NULL CHECK (intent IN ('welcome', 'later', 'pause')),
        not_before_local_date TEXT NOT NULL DEFAULT '',
        not_before_timezone TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE,
        CHECK (
          (intent = 'later' AND not_before_local_date <> '' AND not_before_timezone <> '') OR
          (intent IN ('welcome', 'pause') AND not_before_local_date = '' AND not_before_timezone = '')
        )
      );

      CREATE INDEX idx_memory_revisit_intents_choice
        ON memory_revisit_intents(intent, not_before_local_date, updated_at, memory_id);
    `);
  }
});

function initializeRevisitIntentDatabase(options = {}) {
  const db = requireDatabase(options.db);
  const now = typeof options.now === "function" ? options.now : () => new Date().toISOString();
  const suppliedTransaction = typeof options.withTransaction === "function" ? options.withTransaction : null;

  if (options.applyMigrations !== false) {
    const supportedVersion = Math.max(11, Number(options.schemaVersion) || 11);
    applyMigrations({
      db,
      baselineVersion: 4,
      migrations: [REVISIT_INTENT_MIGRATION],
      supportedVersion,
      now
    });
  }

  const statements = {
    memoryExists: db.prepare("SELECT 1 FROM memories WHERE id = ?"),
    get: db.prepare("SELECT * FROM memory_revisit_intents WHERE memory_id = ?"),
    list: db.prepare("SELECT * FROM memory_revisit_intents ORDER BY memory_id"),
    count: db.prepare("SELECT COUNT(*) AS count FROM memory_revisit_intents"),
    countByIntent: db.prepare("SELECT intent, COUNT(*) AS count FROM memory_revisit_intents GROUP BY intent"),
    upsert: db.prepare(`
      INSERT INTO memory_revisit_intents (
        memory_id, intent, not_before_local_date, not_before_timezone, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(memory_id) DO UPDATE SET
        intent = excluded.intent,
        not_before_local_date = excluded.not_before_local_date,
        not_before_timezone = excluded.not_before_timezone,
        updated_at = excluded.updated_at
    `),
    restore: db.prepare(`
      INSERT INTO memory_revisit_intents (
        memory_id, intent, not_before_local_date, not_before_timezone, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(memory_id) DO UPDATE SET
        intent = excluded.intent,
        not_before_local_date = excluded.not_before_local_date,
        not_before_timezone = excluded.not_before_timezone,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
    `),
    remove: db.prepare("DELETE FROM memory_revisit_intents WHERE memory_id = ?"),
    clear: db.prepare("DELETE FROM memory_revisit_intents")
  };

  function runAtomic(operation) {
    if (suppliedTransaction) return suppliedTransaction(operation);
    const savepoint = `revisit_intent_write_${randomUUID().replace(/-/gu, "")}`;
    db.exec(`SAVEPOINT ${savepoint}`);
    try {
      const result = operation();
      if (result && typeof result.then === "function") throw new TypeError("回访意愿数据库事务必须同步执行。");
      db.exec(`RELEASE SAVEPOINT ${savepoint}`);
      return result;
    } catch (error) {
      try { db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`); } catch { /* preserve original error */ }
      try { db.exec(`RELEASE SAVEPOINT ${savepoint}`); } catch { /* preserve original error */ }
      throw error;
    }
  }

  function listRevisitIntents() {
    return statements.list.all().map(rowToIntent);
  }

  function getRevisitIntent(memoryId) {
    const id = requireId(memoryId, "memoryId");
    const row = statements.get.get(id);
    return row ? rowToIntent(row) : null;
  }

  function setRevisitIntent(input = {}) {
    const normalized = normalizeSetInput(input);
    requireMemory(normalized.memoryId);
    const existing = getRevisitIntent(normalized.memoryId);
    if (existing && sameChoice(existing, normalized)) return existing;

    return runAtomic(() => {
      if (!existing && intentCount() >= MAX_REVISIT_INTENTS) {
        throw intentError(`最多保存 ${MAX_REVISIT_INTENTS} 条回访意愿。`, "REVISIT_INTENT_LIMIT", 409);
      }
      const timestamp = monotonicTimestamp(requireTimestamp(now(), "now"), existing?.updatedAt || existing?.createdAt || "");
      statements.upsert.run(
        normalized.memoryId,
        normalized.intent,
        normalized.notBeforeLocalDate,
        normalized.notBeforeTimezone,
        existing?.createdAt || timestamp,
        timestamp
      );
      return getRevisitIntent(normalized.memoryId);
    });
  }

  function clearRevisitIntent(memoryId) {
    const id = requireId(memoryId, "memoryId");
    requireMemory(id);
    return runAtomic(() => ({ memoryId: id, cleared: statements.remove.run(id).changes > 0 }));
  }

  function clearRevisitIntents() {
    return runAtomic(() => {
      const revisitIntentsDeleted = intentCount();
      statements.clear.run();
      return { revisitIntentsDeleted };
    });
  }

  function getRevisitIntentStats() {
    const stats = { intents: 0, welcome: 0, later: 0, pause: 0 };
    for (const row of statements.countByIntent.all()) {
      const count = Number(row.count) || 0;
      if (Object.hasOwn(stats, row.intent)) stats[row.intent] = count;
      stats.intents += count;
    }
    return stats;
  }

  function buildRevisitIntentBackup(mode = "full", sourceMemoryIds) {
    const sourceSet = sourceMemoryIds === undefined ? null : new Set(normalizeSourceMemoryIds(sourceMemoryIds));
    const intents = listRevisitIntents().filter((entry) => !sourceSet || sourceSet.has(entry.memoryId));
    if (mode === "redacted") {
      return {
        mode: "redacted-summary",
        intentCount: intents.length,
        note: REVISIT_INTENT_REDACTED_NOTE
      };
    }
    if (mode !== "full") throw intentError("回访意愿备份模式无效。", "REVISIT_INTENT_BACKUP_INVALID");
    return { mode: "full", schemaVersion: 11, intents };
  }

  function validateRevisitIntentBackup(backup, sourceMemoryIds) {
    return validateRevisitIntentBackupPayload(backup, sourceMemoryIds);
  }

  function restoreRevisitIntentBackup(backup, memoryIdMap) {
    if (backup?.mode === "redacted-summary") {
      validateRevisitIntentBackup(backup, []);
      return { intents: 0, skipped: 0, idMap: {}, summarized: true };
    }
    const mapping = normalizeIdMap(memoryIdMap);
    validateRevisitIntentBackup(backup, [...mapping.keys()]);
    const plans = [];
    const targetIds = new Set();
    backup.intents.forEach((entry, index) => {
      const source = normalizeBackupIntent(entry, index);
      const targetId = mapping.get(source.memoryId);
      if (!targetId) {
        throw intentError("回访意愿恢复缺少展品 ID 映射。", "REVISIT_INTENT_BACKUP_REFERENCE_INVALID");
      }
      const normalizedTargetId = requireId(targetId, "mapped memoryId");
      if (targetIds.has(normalizedTargetId)) {
        throw intentError("多个回访意愿映射到了同一件目标展品。", "REVISIT_INTENT_BACKUP_MAPPING_COLLISION");
      }
      requireMemory(normalizedTargetId);
      targetIds.add(normalizedTargetId);
      plans.push({ sourceId: source.memoryId, targetId: normalizedTargetId, value: { ...source, memoryId: normalizedTargetId } });
    });

    return runAtomic(() => {
      const additions = plans.reduce((count, plan) => count + (statements.get.get(plan.targetId) ? 0 : 1), 0);
      if (intentCount() + additions > MAX_REVISIT_INTENTS) {
        throw intentError(`恢复后最多保存 ${MAX_REVISIT_INTENTS} 条回访意愿。`, "REVISIT_INTENT_LIMIT", 409);
      }
      const restoredMap = new Map();
      for (const plan of plans) {
        const value = plan.value;
        statements.restore.run(
          value.memoryId,
          value.intent,
          value.notBeforeLocalDate,
          value.notBeforeTimezone,
          value.createdAt,
          value.updatedAt
        );
        restoredMap.set(plan.sourceId, plan.targetId);
      }
      return { intents: plans.length, skipped: 0, idMap: Object.fromEntries(restoredMap), summarized: false };
    });
  }

  function intentCount() {
    return Number(statements.count.get()?.count) || 0;
  }

  function requireMemory(memoryId) {
    if (!statements.memoryExists.get(memoryId)) {
      throw intentError(`没有找到展品 ${memoryId}。`, "REVISIT_INTENT_MEMORY_NOT_FOUND", 404);
    }
  }

  return Object.freeze({
    listRevisitIntents,
    getRevisitIntent,
    setRevisitIntent,
    clearRevisitIntent,
    clearRevisitIntents,
    getRevisitIntentStats,
    buildRevisitIntentBackup,
    validateRevisitIntentBackup,
    restoreRevisitIntentBackup
  });
}

function validateRevisitIntentBackupPayload(backup, sourceMemoryIds) {
  assertPlainObject(backup, "revisit intent backup");
  if (backup.mode === "redacted-summary") {
    assertExactKeys(backup, ["intentCount", "mode", "note"], "redacted revisit intent backup");
    requireNonNegativeInteger(backup.intentCount, "intentCount", MAX_REVISIT_INTENTS);
    if (backup.note !== REVISIT_INTENT_REDACTED_NOTE) {
      throw intentError("脱敏回访意愿备份的固定说明无效。", "REVISIT_INTENT_BACKUP_INVALID");
    }
    return true;
  }

  assertExactKeys(backup, ["intents", "mode", "schemaVersion"], "revisit intent backup");
  if (backup.mode !== "full" || backup.schemaVersion !== 11 ||
      !Array.isArray(backup.intents) || backup.intents.length > MAX_REVISIT_INTENTS) {
    throw intentError("回访意愿备份模式、版本或数量无效。", "REVISIT_INTENT_BACKUP_INVALID");
  }
  const sourceSet = new Set(normalizeSourceMemoryIds(sourceMemoryIds));
  const seen = new Set();
  backup.intents.forEach((entry, index) => {
    const normalized = normalizeBackupIntent(entry, index);
    if (seen.has(normalized.memoryId)) {
      throw intentError("回访意愿备份包含重复展品。", "REVISIT_INTENT_BACKUP_DUPLICATE");
    }
    if (!sourceSet.has(normalized.memoryId)) {
      throw intentError("回访意愿引用了备份之外的展品。", "REVISIT_INTENT_BACKUP_REFERENCE_INVALID");
    }
    seen.add(normalized.memoryId);
  });
  return true;
}

function normalizeSetInput(input) {
  assertPlainObject(input, "revisit intent");
  const memoryId = requireId(input.memoryId, "memoryId");
  const intent = requireIntent(input.intent, "intent");
  const rawDate = String(input.notBeforeLocalDate || "");
  const rawTimezone = String(input.notBeforeTimezone || "");
  if (intent === "later") {
    const local = normalizeLocalContext({ localDate: rawDate, timezone: rawTimezone });
    return { memoryId, intent, notBeforeLocalDate: local.localDate, notBeforeTimezone: local.timezone };
  }
  if (rawDate || rawTimezone) {
    throw intentError("只有 later 意愿可以设置延后日期与时区。", "REVISIT_INTENT_CONTEXT_INVALID");
  }
  return { memoryId, intent, notBeforeLocalDate: "", notBeforeTimezone: "" };
}

function normalizeBackupIntent(input, index) {
  assertPlainObject(input, `intents[${index}]`);
  assertExactKeys(input, [
    "createdAt", "intent", "memoryId", "notBeforeLocalDate", "notBeforeTimezone", "updatedAt"
  ], `intents[${index}]`);
  const normalized = normalizeSetInput({
    memoryId: input.memoryId,
    intent: input.intent,
    notBeforeLocalDate: input.notBeforeLocalDate,
    notBeforeTimezone: input.notBeforeTimezone
  });
  const createdAt = requireTimestamp(input.createdAt, `intents[${index}].createdAt`);
  const updatedAt = requireTimestamp(input.updatedAt, `intents[${index}].updatedAt`);
  if (Date.parse(createdAt) > Date.parse(updatedAt)) {
    throw intentError("回访意愿备份时间顺序无效。", "REVISIT_INTENT_BACKUP_INVALID");
  }
  return { ...normalized, createdAt, updatedAt };
}

function sameChoice(left, right) {
  return left.intent === right.intent &&
    left.notBeforeLocalDate === right.notBeforeLocalDate &&
    left.notBeforeTimezone === right.notBeforeTimezone;
}

function rowToIntent(row) {
  return {
    memoryId: row.memory_id,
    intent: row.intent,
    notBeforeLocalDate: row.not_before_local_date || "",
    notBeforeTimezone: row.not_before_timezone || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function normalizeSourceMemoryIds(value) {
  if (!Array.isArray(value)) throw intentError("sourceMemoryIds 必须是数组。", "REVISIT_INTENT_BACKUP_INVALID");
  const ids = value.map((item, index) => requireId(item, `sourceMemoryIds[${index}]`));
  if (new Set(ids).size !== ids.length) {
    throw intentError("sourceMemoryIds 不能重复。", "REVISIT_INTENT_BACKUP_INVALID");
  }
  return ids;
}

function normalizeIdMap(value) {
  if (value instanceof Map) return new Map([...value.entries()].map(([source, target]) => [
    requireId(source, "source memoryId"),
    requireId(target, "target memoryId")
  ]));
  if (value && typeof value === "object" && !Array.isArray(value)) return normalizeIdMap(new Map(Object.entries(value)));
  throw intentError("memoryIdMap 必须是 Map 或对象。", "REVISIT_INTENT_BACKUP_MAPPING_INVALID");
}

function requireDatabase(db) {
  if (!db || typeof db.exec !== "function" || typeof db.prepare !== "function") {
    throw new TypeError("initializeRevisitIntentDatabase 需要同步 SQLite 数据库连接。");
  }
  return db;
}

function requireId(value, name) {
  const id = String(value || "").trim();
  if (!ID_PATTERN.test(id)) throw intentError(`${name} 无效。`, "REVISIT_INTENT_ID_INVALID");
  return id;
}

function requireIntent(value, name) {
  const intent = String(value || "").trim();
  if (!INTENTS.has(intent)) throw intentError(`${name} 必须是 welcome、later 或 pause。`, "REVISIT_INTENT_CHOICE_INVALID");
  return intent;
}

function requireTimestamp(value, name) {
  if (typeof value !== "string" || value.length < 1 || value.length > 40 || !Number.isFinite(Date.parse(value))) {
    throw intentError(`${name} 必须是有效时间戳。`, "REVISIT_INTENT_TIMESTAMP_INVALID");
  }
  return value;
}

function monotonicTimestamp(candidate, previous) {
  if (!previous || Date.parse(candidate) > Date.parse(previous)) return candidate;
  const next = Date.parse(previous) + 1;
  if (!Number.isFinite(next)) return previous;
  try {
    return new Date(next).toISOString();
  } catch {
    return previous;
  }
}

function requireNonNegativeInteger(value, name, maximum) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw intentError(`${name} 必须是有效非负整数。`, "REVISIT_INTENT_BACKUP_INVALID");
  }
  return value;
}

function assertPlainObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw intentError(`${name} 必须是对象。`, "REVISIT_INTENT_INVALID");
  }
}

function assertExactKeys(value, expected, name) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw intentError(`${name} 字段集合无效。`, "REVISIT_INTENT_BACKUP_INVALID");
  }
}

function intentError(message, code, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

module.exports = {
  MAX_REVISIT_INTENTS,
  REVISIT_INTENT_MIGRATION,
  REVISIT_INTENT_REDACTED_NOTE,
  initializeRevisitIntentDatabase,
  validateRevisitIntentBackupPayload
};
