"use strict";

const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const {
  MUSEUM_LOCK_MIGRATION,
  MUSEUM_LOCK_SCHEMA_VERSION,
  initializeMuseumLockDatabase,
  rowToMuseumLockState,
  stateToDatabaseRecord
} = require("../lib/museum-lock-database");
const {
  LOCK_CONFIRMATION,
  RECOVERY_VERIFIER_FORMAT,
  UNLOCK_CONFIRMATION
} = require("../lib/museum-lock-service");

let assertions = 0;

main();

function main() {
  checkMigrationAndSingleton();
  checkTransitionsAndCas();
  checkCorruptionFailsClosed();
  console.log(`museum-lock-database-check: ${assertions} assertions passed`);
}

function checkMigrationAndSingleton() {
  const fixture = createFixture();
  const { db, store } = fixture;
  equal(MUSEUM_LOCK_SCHEMA_VERSION, 19, "museum lock persistence is schema 19");
  equal(MUSEUM_LOCK_MIGRATION.version, 19, "migration version is explicit");
  equal(Number(db.prepare("PRAGMA user_version").get().user_version), 19, "migration advances PRAGMA user_version");
  equal(Number(db.prepare("SELECT COUNT(*) AS count FROM museum_lock_state").get().count), 1,
    "exactly one lock singleton is initialized");
  const state = store.getMuseumLockState();
  equal(state.status, "unlocked", "new museum starts unlocked");
  equal(state.revision, 0, "new singleton starts at revision zero");
  equal(state.recoveryVerifier, null, "new singleton does not invent authentication material");
  equal(store.isMuseumWriteLocked(), false, "unlocked singleton authorizes the internal unlocked predicate");
  equal(store.getPublicMuseumLockState().verifierConfigured, false, "public state exposes verifier presence only");
  check(!Object.hasOwn(store.getPublicMuseumLockState(), "recoveryVerifier"), "public state excludes verifier JSON");

  const row = db.prepare("SELECT * FROM museum_lock_state").get();
  deepEqual(rowToMuseumLockState(row), state, "database row round-trips through strict state validation");
  equal(stateToDatabaseRecord(state).schemaVersion, 19, "database record carries schema 19");
  check(/^[a-f0-9]{64}$/u.test(row.state_sha256), "singleton is protected by a SHA-256 state checksum");
  equal(row.recovery_verifier_json, null, "initial database row stores no verifier JSON");

  const tableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='museum_lock_state'").get().sql;
  check(tableSql.includes("singleton_key = 1"), "schema enforces one fixed singleton key");
  check(tableSql.includes("schema_version = 19"), "schema pins lock records to schema 19");
  const triggerNames = db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'museum_lock_state_%'")
    .all().map((entry) => entry.name);
  check(triggerNames.includes("museum_lock_state_revision_cas"), "schema installs a database-level revision transition guard");
  check(triggerNames.includes("museum_lock_state_delete_forbidden"), "schema prevents singleton deletion");
  check(triggerNames.includes("museum_lock_state_replace_forbidden"), "schema prevents INSERT OR REPLACE lock resets");
  throwsMessage(() => db.prepare(`
    INSERT OR REPLACE INTO museum_lock_state (
      singleton_key, schema_version, state_id, status, revision,
      recovery_verifier_json, created_at, updated_at, locked_at,
      unlocked_at, last_transition_json, state_sha256
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.singleton_key,
    row.schema_version,
    row.state_id,
    row.status,
    row.revision,
    row.recovery_verifier_json,
    row.created_at,
    row.updated_at,
    row.locked_at,
    row.unlocked_at,
    row.last_transition_json,
    row.state_sha256
  ), "MUSEUM_LOCK_STATE_REPLACE_FORBIDDEN", "INSERT OR REPLACE cannot bypass singleton transition guards");
  equal(store.getMuseumLockState().stateId, state.stateId, "rejected replacement preserves the singleton");
  throwsMessage(() => db.prepare("DELETE FROM museum_lock_state").run(), "MUSEUM_LOCK_STATE_DELETE_FORBIDDEN",
    "singleton cannot be deleted by ordinary database code");
  throwsMessage(() => db.prepare(`
    INSERT INTO museum_lock_state (
      singleton_key, schema_version, state_id, status, revision, recovery_verifier_json,
      created_at, updated_at, locked_at, unlocked_at, last_transition_json, state_sha256
    ) VALUES (2, 19, 'lock_AAAAAAAAAAAAAAAAAAAAAAAA', 'unlocked', 0, NULL,
      '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z', NULL,
      '2026-07-20T00:00:00.000Z', NULL, ?)
  `).run("0".repeat(64)), "MUSEUM_LOCK_STATE_REPLACE_FORBIDDEN", "a second singleton insert is rejected");

  const reopened = initializeMuseumLockDatabase({
    db,
    now: fixture.now,
    randomBytes: (length) => Buffer.alloc(length, 9)
  });
  equal(reopened.getMuseumLockState().stateId, state.stateId, "reinitialization preserves the existing singleton identity");
  equal(Number(db.prepare("SELECT COUNT(*) AS count FROM museum_lock_state").get().count), 1,
    "reinitialization creates no duplicate singleton");
}

function checkTransitionsAndCas() {
  const fixture = createFixture();
  const { db, store, clock } = fixture;
  const verifier = makeVerifier();
  clock.value = "2026-07-20T00:01:00.000Z";
  const locked = store.transitionMuseumLock({
    action: "lock",
    confirmation: LOCK_CONFIRMATION,
    expectedRevision: 0,
    operationId: "db-lock-0001",
    verifier
  });
  equal(locked.persistenceRecord.status, "locked", "lock transition is persisted");
  equal(locked.persistenceRecord.revision, 1, "lock transition increments revision exactly once");
  equal(store.isMuseumWriteLocked(), true, "persisted locked state closes the write predicate");
  equal(locked.publicState.verifierConfigured, true, "public transition result exposes verifier presence");
  check(!JSON.stringify(locked.publicState).includes(verifier.digest), "public transition result excludes verifier digest");
  check(!JSON.stringify(locked.publicState).includes(verifier.salt), "public transition result excludes verifier salt");

  const row = db.prepare("SELECT * FROM museum_lock_state").get();
  equal(JSON.parse(row.recovery_verifier_json).digest, verifier.digest, "database persists the derived verifier digest");
  check(!Object.values(row).some((value) => String(value ?? "").includes("plaintext recovery phrase")),
    "database row contains no raw recovery phrase");
  check(/^[a-f0-9]{64}$/u.test(row.state_sha256), "changed lock state receives a new checksum");

  const replay = store.transitionMuseumLock({
    action: "lock",
    confirmation: LOCK_CONFIRMATION,
    expectedRevision: 0,
    operationId: "db-lock-0001",
    verifier
  });
  equal(replay.transition.replayed, true, "same operation ID is replay-safe");
  equal(replay.persistenceRecord.revision, 1, "replay creates no tombstone revision");
  throwsCode(() => store.transitionMuseumLock({
    action: "unlock",
    confirmation: UNLOCK_CONFIRMATION,
    expectedRevision: 0,
    operationId: "db-unlock-stale",
    verifier
  }), "MUSEUM_LOCK_REVISION_CONFLICT", "stale expected revision is rejected");
  equal(store.getMuseumLockState().revision, 1, "stale transition writes nothing");

  const noMatch = db.prepare("UPDATE museum_lock_state SET revision = revision + 1, status = 'unlocked' WHERE revision = 999").run();
  equal(noMatch.changes, 0, "database compare predicate cannot update a stale revision");
  throwsMessage(() => db.prepare(`
    UPDATE museum_lock_state
    SET revision = revision + 1,
        status = 'unlocked',
        recovery_verifier_json = ?,
        updated_at = '2026-07-20T00:02:00.000Z'
    WHERE singleton_key = 1
  `).run(JSON.stringify(makeVerifier({ digestByte: 8 }))), "MUSEUM_LOCK_VERIFIER_IMMUTABLE",
  "database trigger prevents silent verifier rotation");

  clock.value = "2026-07-20T00:02:00.000Z";
  const unlocked = store.transitionMuseumLock({
    action: "unlock",
    confirmation: UNLOCK_CONFIRMATION,
    expectedRevision: 1,
    operationId: "db-unlock-001",
    verifier
  });
  equal(unlocked.persistenceRecord.status, "unlocked", "matching verifier unlocks the museum");
  equal(unlocked.persistenceRecord.revision, 2, "unlock advances the CAS revision");
  equal(unlocked.persistenceRecord.recoveryVerifier.digest, verifier.digest, "unlock retains the configured verifier");
  throwsCode(() => store.transitionMuseumLock({
    action: "lock",
    confirmation: LOCK_CONFIRMATION,
    expectedRevision: 2,
    operationId: "db-relock-wrong",
    verifier: makeVerifier({ digestByte: 8 })
  }), "MUSEUM_LOCK_VERIFIER_MISMATCH", "relock rejects a different derived verifier");
  throwsCode(() => store.transitionMuseumLock({
    action: "lock",
    confirmation: LOCK_CONFIRMATION,
    expectedRevision: 2,
    operationId: "db-demo-lock",
    verifier
  }, { demoMode: true }), "MUSEUM_LOCK_DEMO_READ_ONLY", "demo transition is rejected before persistence");
  equal(store.getMuseumLockState().revision, 2, "demo transition performs zero writes");
}

function checkCorruptionFailsClosed() {
  const fixture = createFixture();
  const { db, store } = fixture;
  db.exec("DROP TRIGGER museum_lock_state_revision_cas");
  db.prepare("UPDATE museum_lock_state SET state_sha256 = ? WHERE singleton_key = 1").run("f".repeat(64));
  const readError = capture(() => store.getMuseumLockState());
  equal(readError?.code, "MUSEUM_LOCK_STATE_CORRUPT", "checksum corruption has a stable error code");
  equal(readError?.failClosed, true, "checksum corruption is explicitly fail closed");
  const gateError = capture(() => store.isMuseumWriteLocked());
  equal(gateError?.code, "MUSEUM_LOCK_STATE_CORRUPT", "write predicate never treats damaged state as unlocked");
  const reopenError = capture(() => initializeMuseumLockDatabase({
    db,
    now: fixture.now,
    randomBytes: (length) => Buffer.alloc(length, 7)
  }));
  equal(reopenError?.code, "MUSEUM_LOCK_STATE_CORRUPT", "startup does not silently replace a damaged singleton");
  equal(Number(db.prepare("SELECT COUNT(*) AS count FROM museum_lock_state").get().count), 1,
    "damaged singleton remains for explicit operator recovery instead of being reset");

  const missing = createFixture();
  missing.db.exec("DROP TRIGGER museum_lock_state_delete_forbidden; DELETE FROM museum_lock_state;");
  const missingError = capture(() => initializeMuseumLockDatabase({
    db: missing.db,
    now: missing.now,
    randomBytes: (length) => Buffer.alloc(length, 8)
  }));
  equal(missingError?.code, "MUSEUM_LOCK_STATE_CORRUPT", "a missing persisted singleton fails closed on restart");
  equal(Number(missing.db.prepare("SELECT COUNT(*) AS count FROM museum_lock_state").get().count), 0,
    "startup never recreates a deleted singleton as silently unlocked");
}

function createFixture() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON; PRAGMA user_version = 18;");
  const clock = { value: "2026-07-20T00:00:00.000Z" };
  const now = () => clock.value;
  const store = initializeMuseumLockDatabase({
    db,
    now,
    randomBytes: (length) => Buffer.alloc(length, 1)
  });
  return { db, store, clock, now };
}

function makeVerifier(options = {}) {
  return {
    format: RECOVERY_VERIFIER_FORMAT,
    version: 1,
    algorithm: "scrypt-sha256",
    parameters: { cost: 32768, blockSize: 8, parallelization: 1, keyLength: 32 },
    salt: Buffer.alloc(16, options.saltByte ?? 2).toString("base64url"),
    digest: Buffer.alloc(32, options.digestByte ?? 3).toString("base64url")
  };
}

function capture(operation) {
  try { operation(); return null; }
  catch (error) { return error; }
}

function check(condition, message) {
  assert.ok(condition, message);
  assertions += 1;
}

function equal(actual, expected, message) {
  assert.equal(actual, expected, message);
  assertions += 1;
}

function deepEqual(actual, expected, message) {
  assert.deepEqual(actual, expected, message);
  assertions += 1;
}

function throwsCode(operation, code, message) {
  equal(capture(operation)?.code, code, message);
}

function throwsMessage(operation, fragment, message) {
  const error = capture(operation);
  check(Boolean(error) && String(error.message).includes(fragment), message);
}
