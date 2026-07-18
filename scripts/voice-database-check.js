"use strict";

const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const { CLUE_MIGRATION, initializeClueDatabase } = require("../lib/clue-database");
const { applyMigrations, listAppliedMigrations, readUserVersion } = require("../lib/migrations");
const {
  MAX_VOICE_BYTES,
  MAX_VOICE_DURATION_MS,
  VOICE_MIGRATION,
  initializeVoiceDatabase
} = require("../lib/voice-database");

let assertions = 0;

const TEST_MIGRATION_5 = Object.freeze({
  version: 5,
  name: "voice-check-v5",
  up(db) { db.exec("CREATE TABLE voice_check_v5 (id INTEGER PRIMARY KEY)"); }
});
const TEST_MIGRATION_6 = Object.freeze({
  version: 6,
  name: "voice-check-v6",
  up(db) { db.exec("CREATE TABLE voice_check_v6 (id INTEGER PRIMARY KEY)"); }
});
const TEST_MIGRATION_7 = Object.freeze({
  version: 7,
  name: "voice-check-v7-placeholder",
  up(db) { db.exec("CREATE TABLE voice_check_v7 (id INTEGER PRIMARY KEY)"); }
});
const TEST_MIGRATION_9 = Object.freeze({
  version: 9,
  name: "voice-check-v9",
  up(db) { db.exec("CREATE TABLE voice_check_v9 (id INTEGER PRIMARY KEY)"); }
});

checkMigrationAndConstraints();
checkSchema7MigrationPreservesData();
checkTranscriptSearchAndRollback();
checkBackupRestoreAndPurge();
checkMigrationBoundaries();

console.log(`Voice database checks passed: ${assertions} assertions.`);

function checkMigrationAndConstraints() {
  const fixture = createFixture("core", ["memory-a", "memory-b"]);
  try {
    equal(readUserVersion(fixture.db), 8, "V7 database migrates to schema 8");
    deepEqual(
      listAppliedMigrations(fixture.db).map((entry) => entry.version),
      [4, 5, 6, 7, 8],
      "migration 8 appends to the ledger without changing old entries"
    );
    for (const table of ["voice_assets", "memory_voice", "voice_transcripts"]) {
      ok(tableExists(fixture.db, table), `migration creates ${table}`);
    }
    ok(columnExists(fixture.db, "memory_search_documents", "voice_text"), "migration adds voice_text to clue documents");
    const ftsSql = String(fixture.db.prepare("SELECT sql FROM sqlite_master WHERE name = 'memory_search_fts'").get()?.sql || "");
    ok(!ftsSql || ftsSql.includes("voice_text"), "FTS is either unavailable or rebuilt with the voice column");
    const ledgerBefore = listAppliedMigrations(fixture.db);
    const reopened = initializeVoiceDatabase(fixture.options());
    deepEqual(listAppliedMigrations(fixture.db), ledgerBefore, "repeated initialization is idempotent");
    equal(reopened.getVoiceStats().assets, 0, "reopened store remains usable");

    const staging = fixture.voice.createVoiceAsset(asset("staging", { status: "staging" }));
    const first = fixture.voice.createVoiceAsset(asset("first", { status: "ready" }));
    const second = fixture.voice.createVoiceAsset(asset("second", { status: "ready", mimeType: "audio/mp4", codec: "aac" }));
    const third = fixture.voice.createVoiceAsset(asset("third", { status: "ready" }));
    const fourth = fixture.voice.createVoiceAsset(asset("fourth", { status: "ready" }));
    equal(fixture.voice.getVoiceAssetByHash(first.contentSha256).id, first.id, "asset can be queried by content hash");
    equal(fixture.voice.listVoiceAssets({ status: "ready" }).length, 4, "asset list filters by status");
    equal(fixture.voice.listUnreferencedVoiceAssets({ status: "ready" }).length, 4, "unreferenced query exposes GC candidates");
    equal(fixture.voice.listVoiceAssets()[0].referenceCount, 0, "asset list includes its reference count");
    fixture.additionalUsage.set(fourth.id, 1);
    equal(fixture.voice.listUnreferencedVoiceAssets({ status: "ready" }).length, 3, "oral-history usage excludes an otherwise unlinked asset from GC");
    equal(fixture.voice.getVoiceUsage(fourth.id).oralHistoryCount, 1, "usage reports the additional oral-history reference");
    throwsCode(
      () => fixture.voice.deleteVoiceAsset(fourth.id),
      "VOICE_ASSET_IN_USE",
      "voice deletion refuses an oral-history referenced asset"
    );
    const oralOnlyBackup = fixture.voice.exportVoiceData("full", ["memory-a"], { additionalAssetIds: [fourth.id] });
    equal(oralOnlyBackup.assets.length, 1, "voice export includes an oral-only referenced asset once");
    equal(fixture.voice.validateVoiceBackup(oralOnlyBackup, ["memory-a"], { additionalAssetIds: [fourth.id] }), true, "voice validator accepts the explicit oral asset boundary");
    throwsCode(
      () => fixture.voice.validateVoiceBackup(oralOnlyBackup, ["memory-a"]),
      "VOICE_BACKUP_REFERENCE_INVALID",
      "voice validator rejects an unexplained unlinked asset"
    );
    fixture.additionalUsage.delete(fourth.id);

    throwsCode(
      () => fixture.voice.createVoiceAsset(asset("bad-mime", { mimeType: "audio/ogg", codec: "opus" })),
      "VOICE_FORMAT_INVALID",
      "database contract rejects unapproved audio containers"
    );
    throwsCode(
      () => fixture.voice.createVoiceAsset(asset("too-large", { byteSize: MAX_VOICE_BYTES + 1 })),
      "VOICE_VALUE_INVALID",
      "database contract enforces 12 MiB"
    );
    throwsCode(
      () => fixture.voice.createVoiceAsset(asset("too-long", { durationMs: MAX_VOICE_DURATION_MS + 1 })),
      "VOICE_VALUE_INVALID",
      "database contract enforces three minutes"
    );
    throwsCode(
      () => fixture.voice.createVoiceAsset({ ...asset("hash-copy"), contentSha256: first.contentSha256 }),
      "VOICE_ASSET_HASH_EXISTS",
      "content hash remains unique"
    );
    throwsCode(
      () => fixture.voice.replaceMemoryVoice("memory-a", [{ assetId: staging.id, label: "not ready" }]),
      "VOICE_ASSET_NOT_READY",
      "only ready assets may be attached"
    );

    const links = fixture.voice.replaceMemoryVoice("memory-a", [
      { assetId: first.id, label: "开场" },
      { assetId: second.id, label: "环境声" },
      { assetId: third.id, label: "结尾" }
    ]);
    deepEqual(links.map((entry) => entry.position), [0, 1, 2], "replace writes continuous positions");
    deepEqual(links.map((entry) => entry.label), ["开场", "环境声", "结尾"], "association label round-trips");
    ok(links.every((entry) => entry.asset && Object.hasOwn(entry, "transcript")), "hydrated links include asset and transcript");
    equal(fixture.voice.getVoiceUsage(first.id).memoryCount, 1, "usage reports referenced memories");
    equal(fixture.voice.listUnreferencedVoiceAssets({ status: "ready" }).length, 1, "GC query excludes referenced assets");
    throwsCode(
      () => fixture.voice.replaceMemoryVoice("memory-a", [
        { assetId: first.id }, { assetId: second.id }, { assetId: third.id }, { assetId: fourth.id }
      ]),
      "VOICE_MEMORY_LIMIT",
      "public replace enforces three assets"
    );
    throwsCode(
      () => fixture.voice.replaceMemoryVoice("memory-a", [{ assetId: first.id }, { assetId: first.id }]),
      "VOICE_ASSOCIATION_DUPLICATE",
      "public replace rejects duplicate composite links"
    );
    equal(fixture.voice.listVoiceForMemory("memory-a").length, 3, "failed replacement is zero-write");
    throwsCode(
      () => fixture.voice.deleteVoiceAsset(first.id),
      "VOICE_ASSET_IN_USE",
      "referenced asset cannot be deleted"
    );
    throwsCode(
      () => fixture.voice.updateVoiceAsset(first.id, { status: "staging" }),
      "VOICE_ASSET_IN_USE",
      "referenced ready asset cannot be demoted"
    );

    const detached = fixture.voice.detachVoice("memory-a", second.id);
    equal(detached.label, "环境声", "detach returns the removed association");
    deepEqual(fixture.voice.listVoiceForMemory("memory-a").map((entry) => entry.position), [0, 1], "detach compacts positions");
    fixture.voice.replaceMemoryVoices("memory-a", [{ assetId: first.id }, { assetId: fourth.id }]);
    deepEqual(fixture.voice.listVoiceForMemory("memory-a").map((entry) => entry.assetId), [first.id, fourth.id], "plural alias uses the same atomic replace contract");

    assert.throws(
      () => fixture.db.prepare(`INSERT INTO memory_voice (
        memory_id, asset_id, position, label, created_at, updated_at
      ) VALUES (?, ?, 2, '', ?, ?)` ).run("memory-b", third.id, fixture.now(), fixture.now()),
      /VOICE_POSITION_NOT_CONTIGUOUS/,
      "SQLite trigger rejects a direct position gap"
    );
    assertions += 1;
    assert.throws(
      () => fixture.db.prepare(`INSERT INTO memory_voice (
        memory_id, asset_id, position, label, created_at, updated_at
      ) VALUES (?, ?, 0, '', ?, ?)` ).run("memory-b", staging.id, fixture.now(), fixture.now()),
      /VOICE_ASSET_NOT_READY/,
      "SQLite trigger rejects a direct staging link"
    );
    assertions += 1;
  } finally {
    fixture.close();
  }
}

function checkSchema7MigrationPreservesData() {
  const db = new DatabaseSync(":memory:");
  try {
    createBaseSchema(db, ["migration-memory"]);
    db.prepare("INSERT INTO memory_people (memory_id, name) VALUES (?, ?)").run("migration-memory", "Old friend");
    db.prepare("INSERT INTO memory_tags (memory_id, tag) VALUES (?, ?)").run("migration-memory", "Summer");
    db.prepare("INSERT INTO memory_emotions (memory_id, emotion) VALUES (?, ?)").run("migration-memory", "Warmth");

    let idCounter = 0;
    const now = () => "2026-07-17T00:00:00.000Z";
    const createId = (kind) => `${kind}-migration-${++idCounter}`;
    applyMigrations({ db, baselineVersion: 4, migrations: [TEST_MIGRATION_5, TEST_MIGRATION_6], now });
    initializeClueDatabase({ db, schemaVersion: 7, now, createId });
    equal(readUserVersion(db), 7, "migration fixture reaches schema 7 before voice upgrade");

    const preservedTables = [
      "memories",
      "memory_people",
      "memory_tags",
      "memory_emotions",
      "entities",
      "entity_aliases",
      "memory_entities"
    ];
    const before = Object.fromEntries(preservedTables.map((table) => [table, tableCount(db, table)]));
    const voice = initializeVoiceDatabase({ db, schemaVersion: 8, now, createId });

    equal(readUserVersion(db), 8, "schema 7 fixture migrates to schema 8");
    deepEqual(
      Object.fromEntries(preservedTables.map((table) => [table, tableCount(db, table)])),
      before,
      "schema 8 voice migration preserves all pre-existing memory and clue counts"
    );
    deepEqual(voice.getVoiceStats(), {
      assets: 0,
      ready: 0,
      staging: 0,
      pendingDelete: 0,
      memoryLinks: 0,
      transcripts: 0,
      confirmedTranscripts: 0,
      draftTranscripts: 0,
      totalBytes: 0,
      totalDurationMs: 0
    }, "schema 8 voice tables start empty after migrating existing data");
  } finally {
    db.close();
  }
}

function checkTranscriptSearchAndRollback() {
  const events = [];
  const fixture = createFixture("transcript", ["memory-a"], (memoryId, event) => events.push({ memoryId, event }));
  try {
    const first = fixture.voice.createVoiceAsset(asset("speech", { status: "ready" }));
    fixture.voice.replaceMemoryVoice("memory-a", [{ assetId: first.id, label: "口述" }]);
    const draft = fixture.voice.upsertVoiceTranscript({
      memoryId: "memory-a",
      assetId: first.id,
      text: "海边晚风吹过旧码头",
      confirmed: false,
      source: "manual"
    });
    equal(draft.status, "draft", "confirm=false stores a draft");
    equal(draft.confirmedAt, "", "draft has no confirmedAt");
    equal(searchDocument(fixture.db, "memory-a").voice_text, "", "draft does not enter search text");
    equal(events.length, 0, "draft-only changes do not trigger clue sync");

    const confirmed = fixture.voice.upsertVoiceTranscript({
      memoryId: "memory-a",
      assetId: first.id,
      text: draft.text,
      confirmed: true,
      source: "manual"
    });
    equal(confirmed.status, "confirmed", "confirm=true stores a confirmed transcript");
    ok(Boolean(confirmed.confirmedAt), "confirmed transcript receives confirmedAt");
    equal(searchDocument(fixture.db, "memory-a").voice_text, draft.text, "confirmed text enters the search document");
    equal(events.length, 1, "confirmation triggers clue synchronization once");
    equal(events[0].memoryId, "memory-a", "callback receives the affected memory first");
    equal(events[0].event.assetId, first.id, "callback event identifies the asset");
    if (tableExists(fixture.db, "memory_search_fts")) {
      const count = Number(fixture.db.prepare("SELECT COUNT(*) AS count FROM memory_search_fts WHERE memory_search_fts MATCH ?").get("海边晚风")?.count) || 0;
      equal(count, 1, "confirmed transcript is physically indexed by FTS5");
    }

    fixture.voice.upsertVoiceTranscript({
      memoryId: "memory-a",
      assetId: first.id,
      text: "海边晚风吹过安静码头",
      confirmed: true,
      source: "manual"
    });
    equal(events.length, 2, "editing confirmed text triggers another sync");
    ok(searchDocument(fixture.db, "memory-a").voice_text.includes("安静码头"), "edited confirmed text replaces the index text");
    fixture.voice.upsertVoiceTranscript({
      memoryId: "memory-a",
      assetId: first.id,
      text: "海边晚风吹过安静码头",
      confirmed: false,
      source: "manual"
    });
    equal(searchDocument(fixture.db, "memory-a").voice_text, "", "demoting to draft removes search text");
    equal(events.length, 3, "demotion triggers clue synchronization");
    fixture.voice.upsertVoiceTranscript({
      memoryId: "memory-a",
      assetId: first.id,
      text: "再次确认的口述",
      confirmed: true,
      source: "manual"
    });
    fixture.voice.deleteVoiceTranscript("memory-a", first.id);
    equal(searchDocument(fixture.db, "memory-a").voice_text, "", "deleting confirmed transcript removes search text");
    equal(events.at(-1).event.reason, "transcript-deleted", "delete callback explains the reason");

    const rollback = createFixture("callback-rollback", ["memory-a"], () => { throw new Error("sync failed"); });
    try {
      const voice = rollback.voice.createVoiceAsset(asset("rollback", { status: "ready" }));
      rollback.voice.replaceMemoryVoice("memory-a", [{ assetId: voice.id }]);
      assert.throws(() => rollback.voice.upsertVoiceTranscript({
        memoryId: "memory-a",
        assetId: voice.id,
        text: "不能留下的确认文字",
        confirmed: true,
        source: "manual"
      }), /sync failed/, "callback failure is surfaced");
      assertions += 1;
      equal(rollback.voice.getVoiceTranscript("memory-a", voice.id), null, "callback failure rolls back transcript write");
      equal(searchDocument(rollback.db, "memory-a").voice_text, "", "callback failure rolls back index write");
    } finally {
      rollback.close();
    }
  } finally {
    fixture.close();
  }
}

function checkBackupRestoreAndPurge() {
  const source = createFixture("backup-source", ["memory-a", "memory-b"]);
  const target = createFixture("backup-target", ["target-a", "target-b"]);
  try {
    const first = source.voice.createVoiceAsset(asset("backup-first", { status: "ready" }));
    const second = source.voice.createVoiceAsset(asset("backup-second", { status: "ready", mimeType: "audio/mp4", codec: "aac" }));
    source.voice.replaceMemoryVoice("memory-a", [{ assetId: first.id, label: "第一段" }]);
    source.voice.replaceMemoryVoice("memory-b", [{ assetId: second.id, label: "第二段" }]);
    source.voice.upsertVoiceTranscript({ memoryId: "memory-a", assetId: first.id, text: "只属于完整备份的秘密", confirmed: true, source: "manual" });
    source.voice.upsertVoiceTranscript({ memoryId: "memory-b", assetId: second.id, text: "待确认草稿", confirmed: false, source: "manual" });

    const full = source.voice.exportVoiceData("full", ["memory-a", "memory-b"]);
    ok(source.voice.validateVoiceData(full, ["memory-a", "memory-b"]), "full raw data validates before restore");
    equal(full.assets.length, 2, "full backup includes referenced assets");
    equal(full.memoryLinks.length, 2, "full backup includes composite associations");
    equal(full.transcripts.length, 2, "full backup includes draft and confirmed transcripts");
    const redacted = source.voice.buildVoiceBackup("redacted", ["memory-a", "memory-b"]);
    ok(source.voice.validateVoiceBackup(redacted, []), "redacted summary has a strict contract");
    const redactedText = JSON.stringify(redacted);
    ok(!redactedText.includes("秘密") && !redactedText.includes(first.id) && !redactedText.includes(first.storageKey), "redacted summary physically excludes text, IDs and paths");

    target.voice.createVoiceAsset({ ...asset("occupied", { status: "ready" }), id: first.id });
    const restored = target.voice.restoreVoiceData(full, {
      memoryIdMap: { "memory-a": "target-a", "memory-b": "target-b" },
      storageKeyMap: Object.fromEntries(full.assets.map((item, index) => [item.storageKey, `voice/restored-${index}.webm`]))
    });
    equal(restored.assets, 2, "restore writes both new assets");
    ok(restored.idMap.assets[first.id] !== first.id, "occupied source asset ID receives a safe generated target ID");
    equal(restored.memoryLinks, 2, "restore writes both associations");
    equal(restored.transcripts, 2, "restore writes both transcripts");
    equal(target.voice.listVoiceForMemory("target-a")[0].label, "第一段", "association label survives restore");
    equal(searchDocument(target.db, "target-a").voice_text, "只属于完整备份的秘密", "restored confirmed text enters search index");
    equal(searchDocument(target.db, "target-b").voice_text, "", "restored draft remains outside search index");

    const beforeCollision = target.voice.getVoiceStats();
    throwsCode(
      () => target.voice.restoreVoiceData(full, {
        memoryIdMap: { "memory-a": "target-a", "memory-b": "target-b" },
        assetIdMap: { [first.id]: first.id, [second.id]: restored.idMap.assets[second.id] },
        storageKeyMap: Object.fromEntries(full.assets.map((item, index) => [item.storageKey, `voice/collision-${index}.webm`]))
      }),
      "VOICE_BACKUP_ID_COLLISION",
      "explicit occupied ID is rejected instead of silently remapped"
    );
    deepEqual(target.voice.getVoiceStats(), beforeCollision, "failed restore is zero-write");

    const cleared = target.voice.purgeVoiceData();
    ok(cleared.voiceAssetsDeleted >= 3, "purge reports all deleted assets");
    deepEqual(target.voice.getVoiceStats(), {
      assets: 0,
      ready: 0,
      staging: 0,
      pendingDelete: 0,
      memoryLinks: 0,
      transcripts: 0,
      confirmedTranscripts: 0,
      draftTranscripts: 0,
      totalBytes: 0,
      totalDurationMs: 0
    }, "purge clears assets, links and transcripts");
    equal(target.db.prepare("SELECT COUNT(*) AS count FROM memories").get().count, 2, "purge never deletes memories");
    ok(target.db.prepare("SELECT COUNT(*) AS count FROM memory_search_documents WHERE voice_text <> ''").get().count === 0, "purge removes all voice search text");
  } finally {
    source.close();
    target.close();
  }
}

function checkMigrationBoundaries() {
  const future = createFixture("future", ["memory-a"]);
  try {
    applyMigrations({ db: future.db, baselineVersion: 4, migrations: [TEST_MIGRATION_9], now: future.now });
    throwsCode(
      () => initializeVoiceDatabase(future.options()),
      "MIGRATION_DATABASE_TOO_NEW",
      "V8 store rejects a future schema"
    );
  } finally {
    future.close();
  }

  const broken = new DatabaseSync(":memory:");
  try {
    createBaseSchema(broken, ["memory-a"]);
    applyMigrations({
      db: broken,
      baselineVersion: 4,
      migrations: [TEST_MIGRATION_5, TEST_MIGRATION_6, TEST_MIGRATION_7],
      now: () => "2026-07-17T00:00:00.000Z"
    });
    throwsCode(
      () => initializeVoiceDatabase({ db: broken, now: () => "2026-07-17T00:00:00.000Z" }),
      "MIGRATION_APPLY_FAILED",
      "migration fails atomically when V7 search documents are missing"
    );
    equal(readUserVersion(broken), 7, "failed migration preserves user_version 7");
    ok(!tableExists(broken, "voice_assets"), "failed migration leaves no half-created voice table");
    deepEqual(listAppliedMigrations(broken).map((entry) => entry.version), [4, 5, 6, 7], "failed migration does not pollute ledger");
  } finally {
    broken.close();
  }
}

function createFixture(prefix, memoryIds, callback) {
  const db = new DatabaseSync(":memory:");
  createBaseSchema(db, memoryIds);
  let tick = 0;
  let idCounter = 0;
  const now = () => new Date(Date.UTC(2026, 6, 17, 0, 0, tick++)).toISOString();
  const createId = (kind) => `${kind}-${prefix}-${++idCounter}`;
  applyMigrations({ db, baselineVersion: 4, migrations: [TEST_MIGRATION_5, TEST_MIGRATION_6], now });
  initializeClueDatabase({ db, now, createId });
  const withTransaction = (operation) => {
    db.exec("SAVEPOINT voice_check_transaction");
    try {
      const result = operation();
      db.exec("RELEASE SAVEPOINT voice_check_transaction");
      return result;
    } catch (error) {
      try { db.exec("ROLLBACK TO SAVEPOINT voice_check_transaction"); } catch { /* preserve original */ }
      try { db.exec("RELEASE SAVEPOINT voice_check_transaction"); } catch { /* preserve original */ }
      throw error;
    }
  };
  const additionalUsage = new Map();
  const options = () => ({
    db, now, createId, withTransaction, onConfirmedTranscriptChanged: callback,
    getAdditionalAssetUsage: (assetId) => additionalUsage.get(assetId) || 0
  });
  const voice = initializeVoiceDatabase(options());
  return { db, now, createId, withTransaction, options, voice, additionalUsage, close: () => db.close() };
}

function createBaseSchema(db, memoryIds) {
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE memories (
      id TEXT PRIMARY KEY,
      schema_version INTEGER NOT NULL DEFAULT 4,
      title TEXT NOT NULL DEFAULT '',
      hall_id TEXT NOT NULL DEFAULT 'daily',
      source_type TEXT NOT NULL DEFAULT 'text',
      raw_content TEXT NOT NULL DEFAULT '',
      exhibit_text TEXT NOT NULL DEFAULT '',
      memory_date TEXT NOT NULL DEFAULT '',
      location TEXT NOT NULL DEFAULT '',
      emotion_intensity INTEGER NOT NULL DEFAULT 0,
      importance INTEGER NOT NULL DEFAULT 0,
      favorite INTEGER NOT NULL DEFAULT 0,
      cover_image TEXT NOT NULL DEFAULT '',
      media_note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE memory_people (
      memory_id TEXT NOT NULL,
      name TEXT NOT NULL,
      PRIMARY KEY (memory_id, name),
      FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
    );
    CREATE TABLE memory_tags (
      memory_id TEXT NOT NULL,
      tag TEXT NOT NULL,
      PRIMARY KEY (memory_id, tag),
      FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
    );
    CREATE TABLE memory_emotions (
      memory_id TEXT NOT NULL,
      emotion TEXT NOT NULL,
      PRIMARY KEY (memory_id, emotion),
      FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
    );
  `);
  const insert = db.prepare(`
    INSERT INTO memories (
      id, title, raw_content, exhibit_text, memory_date, created_at, updated_at
    ) VALUES (?, ?, ?, ?, '2024-06-20', ?, ?)
  `);
  memoryIds.forEach((id, index) => {
    const timestamp = new Date(Date.UTC(2024, 5, 20, 0, 0, index)).toISOString();
    insert.run(id, `Memory ${id}`, `Raw ${id}`, `Exhibit ${id}`, timestamp, timestamp);
  });
}

function asset(seed, overrides = {}) {
  const numeric = [...seed].reduce((sum, char) => sum + char.codePointAt(0), 0);
  const mimeType = overrides.mimeType || "audio/webm";
  return {
    id: overrides.id || `voice-${seed}`,
    contentSha256: overrides.contentSha256 || numeric.toString(16).padStart(64, "0").slice(-64),
    originalName: overrides.originalName || `${seed}.${mimeType === "audio/mp4" ? "m4a" : "webm"}`,
    mimeType,
    codec: overrides.codec || (mimeType === "audio/mp4" ? "aac" : "opus"),
    byteSize: overrides.byteSize || 4096 + numeric,
    durationMs: overrides.durationMs || 12000 + numeric,
    storageKey: overrides.storageKey || `voice/${seed}.${mimeType === "audio/mp4" ? "m4a" : "webm"}`,
    status: overrides.status || "staging"
  };
}

function searchDocument(db, memoryId) {
  return db.prepare("SELECT * FROM memory_search_documents WHERE memory_id = ?").get(memoryId);
}

function tableExists(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

function tableCount(db, name) {
  if (!/^[a-z_]+$/u.test(name)) throw new Error(`Unsafe table name: ${name}`);
  return Number(db.prepare(`SELECT COUNT(*) AS count FROM ${name}`).get()?.count || 0);
}

function columnExists(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((entry) => entry.name === column);
}

function ok(value, message) {
  assertions += 1;
  assert.ok(value, message);
}

function equal(actual, expected, message) {
  assertions += 1;
  assert.equal(actual, expected, message);
}

function deepEqual(actual, expected, message) {
  assertions += 1;
  assert.deepEqual(actual, expected, message);
}

function throwsCode(operation, expectedCode, message) {
  assertions += 1;
  assert.throws(operation, (error) => error?.code === expectedCode, message);
}
