"use strict";

const { createHash } = require("node:crypto");

const LEDGER_TABLE = "schema_migrations";
const VERSION_PATTERN = /^[1-9]\d*$/;

/**
 * Apply synchronous SQLite migrations in version order.
 *
 * A pre-migration database may have PRAGMA user_version=0 even though its
 * schema already represents the supplied baseline. In that one well-defined
 * case the runner records the baseline before applying later migrations.
 */
function applyMigrations(options = {}) {
  const db = requireDatabase(options.db);
  const baselineVersion = requireVersion(options.baselineVersion ?? 4, "baselineVersion");
  const now = typeof options.now === "function" ? options.now : () => new Date().toISOString();
  const migrations = normalizeMigrations(options.migrations, baselineVersion);
  const latestMigrationVersion = migrations.at(-1)?.version || baselineVersion;
  const supportedVersion = requireVersion(options.supportedVersion ?? latestMigrationVersion, "supportedVersion");
  if (supportedVersion < latestMigrationVersion) {
    throw new RangeError(`supportedVersion 不能低于迁移版本 ${latestMigrationVersion}。`);
  }

  initializeLedger(db, baselineVersion, now);
  let currentVersion = readUserVersion(db);
  if (currentVersion > supportedVersion) {
    throw migrationError(
      `数据库版本 ${currentVersion} 高于当前程序支持的 ${supportedVersion}。`,
      "MIGRATION_DATABASE_TOO_NEW"
    );
  }
  const appliedByVersion = new Map(listAppliedMigrations(db).map((entry) => [entry.version, entry]));

  for (const migration of migrations) {
    if (migration.version <= currentVersion) {
      verifyAppliedDefinition(appliedByVersion.get(migration.version), migration);
      continue;
    }
    if (migration.version !== currentVersion + 1) {
      throw migrationError(
        `迁移版本不连续：当前为 ${currentVersion}，下一项却是 ${migration.version}。`,
        "MIGRATION_VERSION_GAP"
      );
    }

    runInSavepoint(db, `time_isle_migration_${migration.version}`, () => {
      const result = migration.up(db);
      if (result && typeof result.then === "function") {
        throw migrationError("SQLite migration.up 必须是同步函数。", "MIGRATION_ASYNC_FORBIDDEN");
      }
      db.prepare(`
        INSERT INTO ${LEDGER_TABLE} (version, name, checksum, applied_at)
        VALUES (?, ?, ?, ?)
      `).run(migration.version, migration.name, migration.checksum, requireTimestamp(now()));
      writeUserVersion(db, migration.version);
    });
    currentVersion = migration.version;
    appliedByVersion.set(migration.version, {
      version: migration.version,
      name: migration.name,
      checksum: migration.checksum
    });
  }

  return {
    baselineVersion,
    supportedVersion,
    currentVersion,
    applied: listAppliedMigrations(db)
  };
}

function initializeLedger(db, baselineVersion, now) {
  runInSavepoint(db, "time_isle_migration_ledger", () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS ${LEDGER_TABLE} (
        version INTEGER PRIMARY KEY CHECK (version > 0),
        name TEXT NOT NULL,
        checksum TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);

    const entries = listAppliedMigrations(db);
    const userVersion = readUserVersion(db);
    if (!entries.length) {
      if (userVersion > baselineVersion) {
        throw migrationError(
          `数据库版本为 ${userVersion}，但迁移账本为空，无法安全推断历史。`,
          "MIGRATION_LEDGER_MISSING"
        );
      }
      if (userVersion !== 0 && userVersion !== baselineVersion) {
        throw migrationError(
          `数据库版本 ${userVersion} 与基线 ${baselineVersion} 不一致。`,
          "MIGRATION_BASELINE_MISMATCH"
        );
      }
      db.prepare(`
        INSERT INTO ${LEDGER_TABLE} (version, name, checksum, applied_at)
        VALUES (?, ?, ?, ?)
      `).run(
        baselineVersion,
        `baseline-v${baselineVersion}`,
        checksumFor(`${baselineVersion}:baseline`),
        requireTimestamp(now())
      );
      writeUserVersion(db, baselineVersion);
      return;
    }

    validateLedger(entries, userVersion, baselineVersion);
  });
}

function validateLedger(entries, userVersion, baselineVersion) {
  const first = entries[0];
  const last = entries[entries.length - 1];
  if (first.version !== baselineVersion) {
    throw migrationError("迁移账本缺少预期基线。", "MIGRATION_BASELINE_MISMATCH");
  }
  for (let index = 1; index < entries.length; index += 1) {
    if (entries[index].version !== entries[index - 1].version + 1) {
      throw migrationError("迁移账本存在版本断层。", "MIGRATION_LEDGER_GAP");
    }
  }
  if (userVersion !== last.version) {
    throw migrationError(
      `PRAGMA user_version=${userVersion} 与迁移账本版本 ${last.version} 不一致。`,
      "MIGRATION_VERSION_MISMATCH"
    );
  }
}

function normalizeMigrations(value, baselineVersion) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new TypeError("migrations 必须是数组。");
  const seen = new Set();
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new TypeError(`migrations[${index}] 必须是对象。`);
    }
    const version = requireVersion(entry.version, `migrations[${index}].version`);
    if (version <= baselineVersion) {
      throw new RangeError(`migrations[${index}].version 必须高于基线 ${baselineVersion}。`);
    }
    if (seen.has(version)) throw new Error(`迁移版本 ${version} 重复。`);
    seen.add(version);
    const name = requireText(entry.name, `migrations[${index}].name`, 120);
    if (typeof entry.up !== "function") throw new TypeError(`migrations[${index}].up 必须是函数。`);
    const checksum = entry.checksum
      ? requireChecksum(entry.checksum, `migrations[${index}].checksum`)
      : checksumFor(`${version}:${name}:${Function.prototype.toString.call(entry.up).replace(/\r\n?/g, "\n")}`);
    return Object.freeze({ version, name, up: entry.up, checksum });
  }).sort((left, right) => left.version - right.version);
}

function verifyAppliedDefinition(applied, migration) {
  if (!applied) {
    throw migrationError(`迁移账本缺少已应用版本 ${migration.version}。`, "MIGRATION_LEDGER_MISSING");
  }
  if (applied.name !== migration.name || applied.checksum !== migration.checksum) {
    throw migrationError(
      `已应用迁移 ${migration.version} 的名称或校验值发生变化。`,
      "MIGRATION_DEFINITION_CHANGED"
    );
  }
}

function listAppliedMigrations(db) {
  if (!tableExists(db, LEDGER_TABLE)) return [];
  return db.prepare(`
    SELECT version, name, checksum, applied_at
    FROM ${LEDGER_TABLE}
    ORDER BY version
  `).all().map((row) => ({
    version: Number(row.version),
    name: row.name,
    checksum: row.checksum,
    appliedAt: row.applied_at
  }));
}

function tableExists(db, tableName) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName));
}

function readUserVersion(db) {
  const row = db.prepare("PRAGMA user_version").get();
  return Number(row?.user_version) || 0;
}

function writeUserVersion(db, version) {
  const safeVersion = requireVersion(version, "user_version");
  db.exec(`PRAGMA user_version = ${safeVersion}`);
}

function runInSavepoint(db, rawName, operation) {
  const name = String(rawName || "migration").replace(/[^a-zA-Z0-9_]/g, "_");
  db.exec(`SAVEPOINT ${name}`);
  try {
    const result = operation();
    db.exec(`RELEASE SAVEPOINT ${name}`);
    return result;
  } catch (error) {
    try { db.exec(`ROLLBACK TO SAVEPOINT ${name}`); } catch { /* keep original failure */ }
    try { db.exec(`RELEASE SAVEPOINT ${name}`); } catch { /* keep original failure */ }
    if (String(error?.code || "").startsWith("MIGRATION_")) throw error;
    throw migrationError(`迁移执行失败：${error.message}`, "MIGRATION_APPLY_FAILED", error);
  }
}

function requireDatabase(db) {
  if (!db || typeof db.exec !== "function" || typeof db.prepare !== "function") {
    throw new TypeError("applyMigrations 需要同步 SQLite 数据库连接。");
  }
  return db;
}

function requireVersion(value, name) {
  const text = String(value ?? "");
  if (!VERSION_PATTERN.test(text)) throw new RangeError(`${name} 必须是正整数。`);
  const number = Number(text);
  if (!Number.isSafeInteger(number)) throw new RangeError(`${name} 超出安全整数范围。`);
  return number;
}

function requireText(value, name, maximum) {
  const text = String(value || "").trim();
  if (!text || text.length > maximum) throw new TypeError(`${name} 不能为空且最多 ${maximum} 字。`);
  return text;
}

function requireChecksum(value, name) {
  const checksum = String(value || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(checksum)) throw new TypeError(`${name} 必须是 SHA-256。`);
  return checksum;
}

function requireTimestamp(value) {
  const text = String(value || "").trim();
  if (!text || Number.isNaN(Date.parse(text))) throw new TypeError("迁移时间戳无效。");
  return text.slice(0, 40);
}

function checksumFor(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

function migrationError(message, code, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  return error;
}

module.exports = {
  LEDGER_TABLE,
  applyMigrations,
  listAppliedMigrations,
  readUserVersion
};
