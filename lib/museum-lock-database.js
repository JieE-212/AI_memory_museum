"use strict";

const crypto = require("node:crypto");
const { applyMigrations } = require("./migrations");
const {
  applyMuseumLockTransition,
  createInitialMuseumLockState,
  normalizeMuseumLockState,
  publicMuseumLockState
} = require("./museum-lock-service");

const MUSEUM_LOCK_SCHEMA_VERSION = 19;
const MUSEUM_LOCK_SINGLETON_KEY = 1;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

function createMuseumLockMigration(options = {}) {
  const clock = options.clock;
  const randomBytes = options.randomBytes;
  return Object.freeze({
    version: MUSEUM_LOCK_SCHEMA_VERSION,
    name: "museum-write-lock-singleton",
    up(db) {
      db.exec(`
      CREATE TABLE museum_lock_state (
        singleton_key INTEGER PRIMARY KEY CHECK (singleton_key = 1),
        schema_version INTEGER NOT NULL DEFAULT 19 CHECK (schema_version = 19),
        state_id TEXT NOT NULL UNIQUE CHECK (
          length(state_id) = 29
          AND substr(state_id, 1, 5) = 'lock_'
          AND substr(state_id, 6) NOT GLOB '*[^A-Za-z0-9_-]*'
        ),
        status TEXT NOT NULL CHECK (status IN ('unlocked', 'locked')),
        revision INTEGER NOT NULL CHECK (revision >= 0),
        recovery_verifier_json TEXT CHECK (
          recovery_verifier_json IS NULL OR
          (json_valid(recovery_verifier_json) AND json_type(recovery_verifier_json) = 'object')
        ),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        locked_at TEXT,
        unlocked_at TEXT,
        last_transition_json TEXT CHECK (
          last_transition_json IS NULL OR
          (json_valid(last_transition_json) AND json_type(last_transition_json) = 'object')
        ),
        state_sha256 TEXT NOT NULL CHECK (
          length(state_sha256) = 64 AND state_sha256 NOT GLOB '*[^0-9a-f]*'
        )
      );

      CREATE TRIGGER museum_lock_state_identity_immutable
      BEFORE UPDATE ON museum_lock_state
      WHEN new.singleton_key IS NOT old.singleton_key
        OR new.schema_version IS NOT old.schema_version
        OR new.state_id IS NOT old.state_id
        OR new.created_at IS NOT old.created_at
      BEGIN
        SELECT RAISE(ABORT, 'MUSEUM_LOCK_STATE_IDENTITY_IMMUTABLE');
      END;

      CREATE TRIGGER museum_lock_state_replace_forbidden
      BEFORE INSERT ON museum_lock_state
      WHEN EXISTS (
        SELECT 1 FROM museum_lock_state WHERE singleton_key = 1
      )
      BEGIN
        SELECT RAISE(ABORT, 'MUSEUM_LOCK_STATE_REPLACE_FORBIDDEN');
      END;

      CREATE TRIGGER museum_lock_state_revision_cas
      BEFORE UPDATE ON museum_lock_state
      WHEN new.revision != old.revision + 1 OR new.status = old.status
      BEGIN
        SELECT RAISE(ABORT, 'MUSEUM_LOCK_REVISION_CAS_REQUIRED');
      END;

      CREATE TRIGGER museum_lock_state_verifier_immutable
      BEFORE UPDATE ON museum_lock_state
      WHEN old.recovery_verifier_json IS NOT NULL
        AND new.recovery_verifier_json IS NOT old.recovery_verifier_json
      BEGIN
        SELECT RAISE(ABORT, 'MUSEUM_LOCK_VERIFIER_IMMUTABLE');
      END;

      CREATE TRIGGER museum_lock_state_delete_forbidden
      BEFORE DELETE ON museum_lock_state
      BEGIN
        SELECT RAISE(ABORT, 'MUSEUM_LOCK_STATE_DELETE_FORBIDDEN');
      END;
      `);
      const initial = stateToDatabaseRecord(createInitialMuseumLockState({ clock, randomBytes }));
      db.prepare(`
        INSERT INTO museum_lock_state (
          singleton_key, schema_version, state_id, status, revision,
          recovery_verifier_json, created_at, updated_at, locked_at,
          unlocked_at, last_transition_json, state_sha256
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(...recordValues(initial));
    }
  });
}

const MUSEUM_LOCK_MIGRATION = createMuseumLockMigration();

function initializeMuseumLockDatabase(options = {}) {
  const db = requireDatabase(options.db);
  const now = typeof options.now === "function" ? options.now : () => new Date().toISOString();
  const randomBytes = options.randomBytes;
  if (randomBytes !== undefined && typeof randomBytes !== "function") {
    throw new TypeError("initializeMuseumLockDatabase randomBytes must be a function.");
  }
  const suppliedTransaction = typeof options.withTransaction === "function" ? options.withTransaction : null;

  if (options.applyMigrations !== false) {
    applyMigrations({
      db,
      baselineVersion: 18,
      migrations: [createMuseumLockMigration({ clock: now, randomBytes })],
      supportedVersion: Math.max(MUSEUM_LOCK_SCHEMA_VERSION, Number(options.schemaVersion) || MUSEUM_LOCK_SCHEMA_VERSION),
      now
    });
  }

  const statements = prepareStatements(db);

  function runAtomic(operation) {
    if (suppliedTransaction) {
      const result = suppliedTransaction(operation);
      if (result && typeof result.then === "function") {
        throw new TypeError("Museum lock database transactions must be synchronous.");
      }
      return result;
    }
    const savepoint = `museum_lock_${crypto.randomUUID().replace(/-/gu, "")}`;
    db.exec(`SAVEPOINT ${savepoint}`);
    try {
      const result = operation();
      if (result && typeof result.then === "function") {
        throw new TypeError("Museum lock database transactions must be synchronous.");
      }
      db.exec(`RELEASE SAVEPOINT ${savepoint}`);
      return result;
    } catch (error) {
      try { db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`); } catch { /* preserve original */ }
      try { db.exec(`RELEASE SAVEPOINT ${savepoint}`); } catch { /* preserve original */ }
      throw normalizeDatabaseError(error);
    }
  }

  function initializeSingleton() {
    return runAtomic(() => {
      const count = Number(statements.count.get()?.count);
      if (count !== 1) {
        throw corruptStateError("Museum lock singleton cardinality is invalid.");
      }
      return readMuseumLockState();
    });
  }

  function readMuseumLockState() {
    let row;
    try {
      row = statements.get.get(MUSEUM_LOCK_SINGLETON_KEY);
    } catch (cause) {
      throw corruptStateError("Museum lock state could not be read safely.", cause);
    }
    if (!row) throw corruptStateError("Museum lock singleton is missing.");
    return rowToMuseumLockState(row);
  }

  function getPublicMuseumLockState() {
    return publicMuseumLockState(readMuseumLockState());
  }

  function isMuseumWriteLocked() {
    // Any state integrity failure throws before a caller can authorize a write.
    return readMuseumLockState().status === "locked";
  }

  function transitionMuseumLock(command, transitionOptions = {}) {
    assertTransitionOptions(transitionOptions);
    return runAtomic(() => {
      const row = statements.get.get(MUSEUM_LOCK_SINGLETON_KEY);
      if (!row) throw corruptStateError("Museum lock singleton is missing.");
      const current = rowToMuseumLockState(row);
      const result = applyMuseumLockTransition(current, command, {
        clock: now,
        demoMode: transitionOptions.demoMode === true
      });
      if (!result.transition.changed) return result;

      const nextRecord = stateToDatabaseRecord(result.persistenceRecord);
      const write = statements.compareAndSet.run(
        ...updateRecordValues(nextRecord),
        MUSEUM_LOCK_SINGLETON_KEY,
        current.revision,
        row.state_sha256
      );
      if (write.changes !== 1) {
        const actualRevision = Number(statements.readRevision.get(MUSEUM_LOCK_SINGLETON_KEY)?.revision);
        throw revisionConflict(current.revision, actualRevision);
      }
      const persisted = readMuseumLockState();
      return deepFreeze({
        persistenceRecord: persisted,
        publicState: publicMuseumLockState(persisted),
        transition: result.transition
      });
    });
  }

  const initialState = initializeSingleton();
  return Object.freeze({
    getMuseumLockState: readMuseumLockState,
    getPublicMuseumLockState,
    initialState,
    isMuseumWriteLocked,
    transitionMuseumLock
  });
}

function prepareStatements(db) {
  return {
    count: db.prepare("SELECT COUNT(*) AS count FROM museum_lock_state"),
    get: db.prepare(`
      SELECT singleton_key, schema_version, state_id, status, revision,
             recovery_verifier_json, created_at, updated_at, locked_at,
             unlocked_at, last_transition_json, state_sha256
      FROM museum_lock_state
      WHERE singleton_key = ?
    `),
    readRevision: db.prepare("SELECT revision FROM museum_lock_state WHERE singleton_key = ?"),
    compareAndSet: db.prepare(`
      UPDATE museum_lock_state
      SET schema_version = ?,
          state_id = ?,
          status = ?,
          revision = ?,
          recovery_verifier_json = ?,
          created_at = ?,
          updated_at = ?,
          locked_at = ?,
          unlocked_at = ?,
          last_transition_json = ?,
          state_sha256 = ?
      WHERE singleton_key = ? AND revision = ? AND state_sha256 = ?
    `)
  };
}

function stateToDatabaseRecord(input) {
  const state = normalizeMuseumLockState(input);
  return Object.freeze({
    singletonKey: MUSEUM_LOCK_SINGLETON_KEY,
    schemaVersion: MUSEUM_LOCK_SCHEMA_VERSION,
    stateId: state.stateId,
    status: state.status,
    revision: state.revision,
    recoveryVerifierJson: state.recoveryVerifier === null ? null : JSON.stringify(state.recoveryVerifier),
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    lockedAt: state.lockedAt,
    unlockedAt: state.unlockedAt,
    lastTransitionJson: state.lastTransition === null ? null : JSON.stringify(state.lastTransition),
    stateSha256: stateSha256(state)
  });
}

function rowToMuseumLockState(row) {
  try {
    if (!row || typeof row !== "object" || Number(row.singleton_key) !== MUSEUM_LOCK_SINGLETON_KEY ||
        Number(row.schema_version) !== MUSEUM_LOCK_SCHEMA_VERSION) {
      throw new Error("Museum lock row identity is invalid.");
    }
    const recoveryVerifier = parseNullableJsonObject(row.recovery_verifier_json, "recovery verifier");
    const lastTransition = parseNullableJsonObject(row.last_transition_json, "last transition");
    const state = normalizeMuseumLockState({
      format: "time-isle.museum-write-lock",
      formatVersion: 1,
      stateId: row.state_id,
      status: row.status,
      revision: Number(row.revision),
      recoveryVerifier,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lockedAt: row.locked_at,
      unlockedAt: row.unlocked_at,
      lastTransition
    });
    if (!constantTimeHashEqual(row.state_sha256, stateSha256(state))) {
      throw new Error("Museum lock state checksum did not match.");
    }
    return state;
  } catch (cause) {
    if (cause?.code === "MUSEUM_LOCK_STATE_CORRUPT") throw cause;
    throw corruptStateError("Museum lock state failed integrity validation.", cause);
  }
}

function recordValues(record) {
  return [
    record.singletonKey,
    record.schemaVersion,
    record.stateId,
    record.status,
    record.revision,
    record.recoveryVerifierJson,
    record.createdAt,
    record.updatedAt,
    record.lockedAt,
    record.unlockedAt,
    record.lastTransitionJson,
    record.stateSha256
  ];
}

function updateRecordValues(record) {
  return recordValues(record).slice(1);
}

function parseNullableJsonObject(value, label) {
  if (value === null) return null;
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > 4096) {
    throw new Error(`${label} JSON is outside its safety budget.`);
  }
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.getPrototypeOf(parsed) !== Object.prototype) {
    throw new Error(`${label} JSON is not an object.`);
  }
  return parsed;
}

function stateSha256(state) {
  return crypto.createHash("sha256").update(JSON.stringify(normalizeMuseumLockState(state)), "utf8").digest("hex");
}

function constantTimeHashEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string" ||
      !SHA256_PATTERN.test(left) || !SHA256_PATTERN.test(right)) return false;
  return crypto.timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function assertTransitionOptions(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Object.keys(value).some((key) => key !== "demoMode") ||
      (value.demoMode !== undefined && typeof value.demoMode !== "boolean")) {
    const error = new Error("Museum lock transition options are invalid.");
    error.code = "MUSEUM_LOCK_OPTIONS_INVALID";
    error.statusCode = 400;
    throw error;
  }
}

function revisionConflict(expectedRevision, actualRevision) {
  const error = new Error("Museum lock state changed before the transition could be persisted.");
  error.code = "MUSEUM_LOCK_REVISION_CONFLICT";
  error.statusCode = 409;
  error.details = Object.freeze({
    expectedRevision,
    actualRevision: Number.isSafeInteger(actualRevision) ? actualRevision : null
  });
  return error;
}

function corruptStateError(message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = "MUSEUM_LOCK_STATE_CORRUPT";
  error.statusCode = 500;
  error.failClosed = true;
  return error;
}

function normalizeDatabaseError(error) {
  const message = String(error?.message || "");
  if (String(error?.code || "").startsWith("MUSEUM_LOCK_")) return error;
  if (message.includes("MUSEUM_LOCK_REVISION_CAS_REQUIRED")) return revisionConflict(null, null);
  if (message.includes("MUSEUM_LOCK_VERIFIER_IMMUTABLE")) {
    const mismatch = new Error("The configured recovery verifier is immutable.");
    mismatch.code = "MUSEUM_LOCK_VERIFIER_MISMATCH";
    mismatch.statusCode = 409;
    return mismatch;
  }
  if (message.includes("MUSEUM_LOCK_STATE_DELETE_FORBIDDEN") ||
      message.includes("MUSEUM_LOCK_STATE_IDENTITY_IMMUTABLE") ||
      message.includes("MUSEUM_LOCK_STATE_REPLACE_FORBIDDEN")) {
    return corruptStateError("Museum lock singleton integrity protection rejected a write.", error);
  }
  return error;
}

function requireDatabase(db) {
  if (!db || typeof db.exec !== "function" || typeof db.prepare !== "function") {
    throw new TypeError("initializeMuseumLockDatabase requires a synchronous SQLite database.");
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
  MUSEUM_LOCK_MIGRATION,
  MUSEUM_LOCK_SCHEMA_VERSION,
  MUSEUM_LOCK_SINGLETON_KEY,
  createMuseumLockMigration,
  initializeMuseumLockDatabase,
  rowToMuseumLockState,
  stateToDatabaseRecord
};
