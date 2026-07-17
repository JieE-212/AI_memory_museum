"use strict";

const { randomUUID } = require("node:crypto");
const { applyMigrations } = require("./migrations");
const { normalizeLocalContext, parseExplicitCalendarDate } = require("./revisit-service");

const MAX_REVISIT_STATES = 500;
const MAX_VIEW_COUNT = 2147483647;
const ID_PATTERN = /^[a-zA-Z0-9_-]{1,120}$/;

const REVISIT_MIGRATION = Object.freeze({
  version: 6,
  name: "memory-revisit-state",
  up(db) {
    db.exec(`
      CREATE TABLE memory_revisit_state (
        memory_id TEXT PRIMARY KEY,
        last_viewed_at TEXT NOT NULL DEFAULT '',
        last_viewed_local_date TEXT NOT NULL DEFAULT '',
        last_viewed_timezone TEXT NOT NULL DEFAULT '',
        view_count INTEGER NOT NULL DEFAULT 0 CHECK (view_count >= 0 AND view_count <= 2147483647),
        dismissed_local_date TEXT NOT NULL DEFAULT '',
        dismissed_timezone TEXT NOT NULL DEFAULT '',
        last_dismissed_at TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE,
        CHECK (
          (view_count = 0 AND last_viewed_at = '' AND last_viewed_local_date = '' AND last_viewed_timezone = '') OR
          (view_count > 0 AND last_viewed_at <> '' AND last_viewed_local_date <> '' AND last_viewed_timezone <> '')
        ),
        CHECK (
          (dismissed_local_date = '' AND dismissed_timezone = '' AND last_dismissed_at = '') OR
          (dismissed_local_date <> '' AND dismissed_timezone <> '' AND last_dismissed_at <> '')
        )
      );

      CREATE INDEX idx_memory_revisit_last_viewed
        ON memory_revisit_state(last_viewed_at, memory_id);
      CREATE INDEX idx_memory_revisit_dismissed
        ON memory_revisit_state(dismissed_local_date, dismissed_timezone, memory_id);
    `);
  }
});

function initializeRevisitDatabase(options = {}) {
  const db = requireDatabase(options.db);
  const now = typeof options.now === "function" ? options.now : () => new Date().toISOString();
  const suppliedTransaction = typeof options.withTransaction === "function" ? options.withTransaction : null;

  if (options.applyMigrations !== false) {
    const supportedVersion = Math.max(6, Number(options.schemaVersion) || 6);
    applyMigrations({ db, baselineVersion: 4, migrations: [REVISIT_MIGRATION], supportedVersion, now });
  }

  const statements = {
    memoryExists: db.prepare("SELECT 1 FROM memories WHERE id = ?"),
    get: db.prepare("SELECT * FROM memory_revisit_state WHERE memory_id = ?"),
    list: db.prepare("SELECT * FROM memory_revisit_state ORDER BY memory_id"),
    count: db.prepare("SELECT COUNT(*) AS count FROM memory_revisit_state"),
    countViewed: db.prepare("SELECT COUNT(*) AS count FROM memory_revisit_state WHERE view_count > 0"),
    countDismissed: db.prepare("SELECT COUNT(*) AS count FROM memory_revisit_state WHERE dismissed_local_date <> ''"),
    upsertViewed: db.prepare(`
      INSERT INTO memory_revisit_state (
        memory_id, last_viewed_at, last_viewed_local_date, last_viewed_timezone,
        view_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(memory_id) DO UPDATE SET
        last_viewed_at = excluded.last_viewed_at,
        last_viewed_local_date = excluded.last_viewed_local_date,
        last_viewed_timezone = excluded.last_viewed_timezone,
        view_count = CASE
          WHEN memory_revisit_state.view_count >= ${MAX_VIEW_COUNT} THEN ${MAX_VIEW_COUNT}
          ELSE memory_revisit_state.view_count + 1
        END,
        updated_at = excluded.updated_at
    `),
    upsertDismissed: db.prepare(`
      INSERT INTO memory_revisit_state (
        memory_id, dismissed_local_date, dismissed_timezone, last_dismissed_at,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(memory_id) DO UPDATE SET
        dismissed_local_date = excluded.dismissed_local_date,
        dismissed_timezone = excluded.dismissed_timezone,
        last_dismissed_at = excluded.last_dismissed_at,
        updated_at = excluded.updated_at
    `),
    restore: db.prepare(`
      INSERT INTO memory_revisit_state (
        memory_id, last_viewed_at, last_viewed_local_date, last_viewed_timezone,
        view_count, dismissed_local_date, dismissed_timezone, last_dismissed_at,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(memory_id) DO UPDATE SET
        last_viewed_at = excluded.last_viewed_at,
        last_viewed_local_date = excluded.last_viewed_local_date,
        last_viewed_timezone = excluded.last_viewed_timezone,
        view_count = excluded.view_count,
        dismissed_local_date = excluded.dismissed_local_date,
        dismissed_timezone = excluded.dismissed_timezone,
        last_dismissed_at = excluded.last_dismissed_at,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
    `),
    clear: db.prepare("DELETE FROM memory_revisit_state")
  };

  function runAtomic(operation) {
    if (suppliedTransaction) return suppliedTransaction(operation);
    const savepoint = `revisit_write_${randomUUID().replace(/-/g, "")}`;
    db.exec(`SAVEPOINT ${savepoint}`);
    try {
      const result = operation();
      if (result && typeof result.then === "function") throw new TypeError("回访数据库事务必须同步执行。");
      db.exec(`RELEASE SAVEPOINT ${savepoint}`);
      return result;
    } catch (error) {
      try { db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`); } catch { /* preserve the original error */ }
      try { db.exec(`RELEASE SAVEPOINT ${savepoint}`); } catch { /* preserve the original error */ }
      throw error;
    }
  }

  function listRevisitStates() {
    return statements.list.all().map(rowToState);
  }

  function getRevisitState(memoryId) {
    const id = requireId(memoryId, "memoryId");
    const row = statements.get.get(id);
    return row ? rowToState(row) : null;
  }

  function markRevisitViewed(input = {}) {
    const { memoryId, localDate, timezone } = normalizeActionInput(input);
    requireMemory(memoryId);
    const timestamp = requireTimestamp(now(), "now");
    return runAtomic(() => {
      statements.upsertViewed.run(memoryId, timestamp, localDate, timezone, timestamp, timestamp);
      return getRevisitState(memoryId);
    });
  }

  function markRevisitDismissed(input = {}) {
    const { memoryId, localDate, timezone } = normalizeActionInput(input);
    requireMemory(memoryId);
    const timestamp = requireTimestamp(now(), "now");
    return runAtomic(() => {
      statements.upsertDismissed.run(memoryId, localDate, timezone, timestamp, timestamp, timestamp);
      return getRevisitState(memoryId);
    });
  }

  function clearRevisitStates() {
    return runAtomic(() => {
      const revisitStatesDeleted = Number(statements.count.get()?.count) || 0;
      statements.clear.run();
      return { revisitStatesDeleted };
    });
  }

  function getRevisitStats() {
    return {
      states: Number(statements.count.get()?.count) || 0,
      viewed: Number(statements.countViewed.get()?.count) || 0,
      dismissed: Number(statements.countDismissed.get()?.count) || 0
    };
  }

  function buildRevisitBackup(mode = "full", sourceMemoryIds) {
    const sourceSet = sourceMemoryIds === undefined ? null : new Set(normalizeSourceMemoryIds(sourceMemoryIds));
    const states = listRevisitStates().filter((state) => !sourceSet || sourceSet.has(state.memoryId));
    const stats = {
      states: states.length,
      viewed: states.filter((state) => state.viewCount > 0).length,
      dismissed: states.filter((state) => state.dismissedLocalDate).length
    };
    if (mode === "redacted") {
      return {
        mode: "redacted-summary",
        stateCount: stats.states,
        viewedCount: stats.viewed,
        dismissedCount: stats.dismissed,
        note: "展品 ID、回访时间和按日隐藏状态已从脱敏备份中移除。"
      };
    }
    return {
      mode: "full",
      schemaVersion: 6,
      states
    };
  }

  function validateRevisitBackup(backup, sourceMemoryIds) {
    assertPlainObject(backup, "revisit backup");
    if (backup.mode === "redacted-summary") {
      assertExactKeys(backup, ["dismissedCount", "mode", "note", "stateCount", "viewedCount"], "redacted revisit backup");
      requireNonNegativeInteger(backup.stateCount, "stateCount", Number.MAX_SAFE_INTEGER);
      requireNonNegativeInteger(backup.viewedCount, "viewedCount", Number.MAX_SAFE_INTEGER);
      requireNonNegativeInteger(backup.dismissedCount, "dismissedCount", Number.MAX_SAFE_INTEGER);
      if (backup.viewedCount > backup.stateCount || backup.dismissedCount > backup.stateCount) {
        throw revisitError("脱敏回访统计互相矛盾。", "REVISIT_BACKUP_INVALID");
      }
      requireText(backup.note, "note", 240);
      return true;
    }

    assertExactKeys(backup, ["mode", "schemaVersion", "states"], "revisit backup");
    if (backup.mode !== "full" || backup.schemaVersion !== 6 || !Array.isArray(backup.states) || backup.states.length > MAX_REVISIT_STATES) {
      throw revisitError("回访备份模式、版本或数量无效。", "REVISIT_BACKUP_INVALID");
    }
    const sourceIds = normalizeSourceMemoryIds(sourceMemoryIds);
    const sourceSet = new Set(sourceIds);
    const seen = new Set();
    for (let index = 0; index < backup.states.length; index += 1) {
      const state = normalizeBackupState(backup.states[index], index);
      if (seen.has(state.memoryId)) throw revisitError("回访备份包含重复的展品状态。", "REVISIT_BACKUP_DUPLICATE");
      if (!sourceSet.has(state.memoryId)) throw revisitError("回访状态引用了备份之外的展品。", "REVISIT_BACKUP_REFERENCE_INVALID");
      seen.add(state.memoryId);
    }
    return true;
  }

  function restoreRevisitBackup(backup, memoryIdMap) {
    if (backup?.mode === "redacted-summary") {
      validateRevisitBackup(backup, []);
      return { states: 0, skipped: 0, idMap: {} };
    }
    const mapping = normalizeIdMap(memoryIdMap);
    validateRevisitBackup(backup, [...mapping.keys()]);
    const plans = [];
    const targetIds = new Set();
    for (let index = 0; index < backup.states.length; index += 1) {
      const source = normalizeBackupState(backup.states[index], index);
      const targetId = mapping.get(source.memoryId);
      if (!targetId) throw revisitError("回访恢复缺少展品 ID 映射。", "REVISIT_BACKUP_REFERENCE_INVALID");
      const normalizedTargetId = requireId(targetId, "mapped memoryId");
      if (targetIds.has(normalizedTargetId)) throw revisitError("多个回访状态映射到了同一件目标展品。", "REVISIT_BACKUP_MAPPING_COLLISION");
      requireMemory(normalizedTargetId);
      targetIds.add(normalizedTargetId);
      plans.push({ sourceId: source.memoryId, targetId: normalizedTargetId, state: { ...source, memoryId: normalizedTargetId } });
    }

    return runAtomic(() => {
      const restoredMap = new Map();
      for (const plan of plans) {
        writeRestoredState(plan.state);
        restoredMap.set(plan.sourceId, plan.targetId);
      }
      return { states: plans.length, skipped: 0, idMap: Object.fromEntries(restoredMap) };
    });
  }

  function writeRestoredState(state) {
    statements.restore.run(
      state.memoryId,
      state.lastViewedAt,
      state.lastViewedLocalDate,
      state.lastViewedTimezone,
      state.viewCount,
      state.dismissedLocalDate,
      state.dismissedTimezone,
      state.lastDismissedAt,
      state.createdAt,
      state.updatedAt
    );
  }

  function requireMemory(memoryId) {
    if (!statements.memoryExists.get(memoryId)) {
      throw revisitError(`没有找到展品 ${memoryId}。`, "REVISIT_MEMORY_NOT_FOUND", 404);
    }
  }

  return Object.freeze({
    buildRevisitBackup,
    clearRevisitStates,
    getRevisitState,
    getRevisitStats,
    listRevisitStates,
    markRevisitDismissed,
    markRevisitViewed,
    restoreRevisitBackup,
    validateRevisitBackup
  });
}

function normalizeActionInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw revisitError("回访动作必须是对象。", "REVISIT_ACTION_INVALID");
  }
  const memoryId = requireId(input.memoryId, "memoryId");
  const local = normalizeLocalContext(input);
  return { memoryId, localDate: local.localDate, timezone: local.timezone };
}

function normalizeBackupState(input, index) {
  assertPlainObject(input, `states[${index}]`);
  assertExactKeys(input, [
    "createdAt", "dismissedLocalDate", "dismissedTimezone", "lastDismissedAt",
    "lastViewedAt", "lastViewedLocalDate", "lastViewedTimezone", "memoryId",
    "updatedAt", "viewCount"
  ], `states[${index}]`);
  const memoryId = requireId(input.memoryId, `states[${index}].memoryId`);
  const viewCount = requireNonNegativeInteger(input.viewCount, `states[${index}].viewCount`, MAX_VIEW_COUNT);
  const lastViewedAt = optionalTimestamp(input.lastViewedAt, `states[${index}].lastViewedAt`);
  const lastViewed = normalizeOptionalLocalContext(
    input.lastViewedLocalDate,
    input.lastViewedTimezone,
    `states[${index}].lastViewed`
  );
  if ((viewCount === 0) !== (!lastViewedAt && !lastViewed.localDate)) {
    throw revisitError("回访次数与最后回访状态不一致。", "REVISIT_BACKUP_INVALID");
  }
  if (viewCount > 0 && (!lastViewedAt || !lastViewed.localDate)) {
    throw revisitError("已回访状态缺少本地日期或时间戳。", "REVISIT_BACKUP_INVALID");
  }

  const lastDismissedAt = optionalTimestamp(input.lastDismissedAt, `states[${index}].lastDismissedAt`);
  const dismissed = normalizeOptionalLocalContext(
    input.dismissedLocalDate,
    input.dismissedTimezone,
    `states[${index}].dismissed`
  );
  if (Boolean(lastDismissedAt) !== Boolean(dismissed.localDate)) {
    throw revisitError("隐藏日期与隐藏时间戳不一致。", "REVISIT_BACKUP_INVALID");
  }

  const createdAt = requireTimestamp(input.createdAt, `states[${index}].createdAt`);
  const updatedAt = requireTimestamp(input.updatedAt, `states[${index}].updatedAt`);
  const updatedTime = Date.parse(updatedAt);
  if (Date.parse(createdAt) > updatedTime || (lastViewedAt && Date.parse(lastViewedAt) > updatedTime) ||
      (lastDismissedAt && Date.parse(lastDismissedAt) > updatedTime)) {
    throw revisitError("回访状态时间顺序无效。", "REVISIT_BACKUP_INVALID");
  }
  return {
    memoryId,
    lastViewedAt,
    lastViewedLocalDate: lastViewed.localDate,
    lastViewedTimezone: lastViewed.timezone,
    viewCount,
    dismissedLocalDate: dismissed.localDate,
    dismissedTimezone: dismissed.timezone,
    lastDismissedAt,
    createdAt,
    updatedAt
  };
}

function normalizeOptionalLocalContext(localDateValue, timezoneValue, name) {
  const localDate = String(localDateValue || "");
  const timezone = String(timezoneValue || "");
  if (!localDate && !timezone) return { localDate: "", timezone: "" };
  if (!localDate || !timezone || !parseExplicitCalendarDate(localDate)) {
    throw revisitError(`${name} 本地日期与时区必须同时有效。`, "REVISIT_BACKUP_INVALID");
  }
  try {
    const normalized = normalizeLocalContext({ localDate, timezone });
    return { localDate: normalized.localDate, timezone: normalized.timezone };
  } catch (cause) {
    throw revisitError(`${name} 本地日期或时区无效。`, "REVISIT_BACKUP_INVALID", 400, cause);
  }
}

function normalizeSourceMemoryIds(value) {
  if (!Array.isArray(value) || value.length > MAX_REVISIT_STATES) {
    throw revisitError("sourceMemoryIds 数量无效。", "REVISIT_BACKUP_INVALID");
  }
  const ids = value.map((item, index) => requireId(item, `sourceMemoryIds[${index}]`));
  if (new Set(ids).size !== ids.length) throw revisitError("sourceMemoryIds 不能重复。", "REVISIT_BACKUP_INVALID");
  return ids;
}

function normalizeIdMap(value) {
  if (value instanceof Map) return new Map([...value.entries()].map(([source, target]) => [
    requireId(source, "source memoryId"),
    requireId(target, "target memoryId")
  ]));
  if (value && typeof value === "object" && !Array.isArray(value)) return normalizeIdMap(new Map(Object.entries(value)));
  throw revisitError("memoryIdMap 必须是 Map 或对象。", "REVISIT_BACKUP_MAPPING_INVALID");
}

function rowToState(row) {
  return {
    memoryId: row.memory_id,
    lastViewedAt: row.last_viewed_at || "",
    lastViewedLocalDate: row.last_viewed_local_date || "",
    lastViewedTimezone: row.last_viewed_timezone || "",
    viewCount: Number(row.view_count) || 0,
    dismissedLocalDate: row.dismissed_local_date || "",
    dismissedTimezone: row.dismissed_timezone || "",
    lastDismissedAt: row.last_dismissed_at || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function requireDatabase(db) {
  if (!db || typeof db.exec !== "function" || typeof db.prepare !== "function") {
    throw new TypeError("initializeRevisitDatabase 需要同步 SQLite 数据库连接。");
  }
  return db;
}

function requireId(value, name) {
  const id = String(value || "").trim();
  if (!ID_PATTERN.test(id)) throw revisitError(`${name} 无效。`, "REVISIT_MEMORY_ID_INVALID");
  return id;
}

function requireTimestamp(value, name) {
  const timestamp = String(value || "").trim();
  if (!timestamp || timestamp.length > 40 || !Number.isFinite(Date.parse(timestamp))) {
    throw revisitError(`${name} 必须是有效时间戳。`, "REVISIT_TIMESTAMP_INVALID");
  }
  return timestamp;
}

function optionalTimestamp(value, name) {
  const timestamp = String(value || "");
  return timestamp ? requireTimestamp(timestamp, name) : "";
}

function requireNonNegativeInteger(value, name, maximum) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw revisitError(`${name} 必须是 0 至 ${maximum} 的整数。`, "REVISIT_BACKUP_INVALID");
  }
  return value;
}

function requireText(value, name, maximum) {
  const text = String(value || "").trim();
  if (!text || text.length > maximum || text.includes("\u0000")) {
    throw revisitError(`${name} 不能为空且最多 ${maximum} 字。`, "REVISIT_BACKUP_INVALID");
  }
  return text;
}

function assertPlainObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw revisitError(`${name} 必须是对象。`, "REVISIT_BACKUP_INVALID");
  }
}

function assertExactKeys(value, expected, name) {
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (keys.length !== wanted.length || keys.some((key, index) => key !== wanted[index])) {
    throw revisitError(`${name} 字段无效。`, "REVISIT_BACKUP_INVALID");
  }
}

function revisitError(message, code, statusCode = 400, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

module.exports = {
  MAX_REVISIT_STATES,
  REVISIT_MIGRATION,
  initializeRevisitDatabase
};
