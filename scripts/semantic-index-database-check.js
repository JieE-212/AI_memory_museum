"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createMemoryStore } = require("../database");
const { createCollectionExporter } = require("../lib/collection-export");
const { MODEL_ID, MODEL_SHA256 } = require("../lib/semantic-index-api");
const { buildSemanticRecallDocument } = require("../lib/semantic-recall-service");

const dbPath = path.join(os.tmpdir(), `time-isle-semantic-index-${process.pid}-${Date.now()}.sqlite`);
const migrationPath = path.join(os.tmpdir(), `time-isle-semantic-index-migration-${process.pid}-${Date.now()}.sqlite`);
const transcriptPath = path.join(os.tmpdir(), `time-isle-semantic-index-transcript-${process.pid}-${Date.now()}.sqlite`);
let store;
const migrationStores = [];
let assertions = 0;

try {
  store = createMemoryStore({
    dbPath,
    schemaVersion: 20,
    halls: [{ id: "daily", name: "Daily", description: "fixture" }]
  });
  checkSchemaAndLifecycle();
  checkConfirmedTranscriptProjectionPersistence();
  checkExportBoundary();
  checkSchemaMigrationAndImportBoundary();
  console.log(`Semantic index database checks passed (${assertions} assertions).`);
} finally {
  try { store?.close(); } catch { /* deterministic cleanup */ }
  for (const candidate of migrationStores) { try { candidate.close(); } catch { /* deterministic cleanup */ } }
  for (const base of [dbPath, migrationPath, transcriptPath]) {
    for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${base}${suffix}`, { force: true, maxRetries: 20, retryDelay: 100 });
  }
}

function checkConfirmedTranscriptProjectionPersistence() {
  const transcriptStore = createMemoryStore({
    dbPath: transcriptPath,
    schemaVersion: 20,
    halls: [{ id: "daily", name: "Daily", description: "fixture" }]
  });
  let reopened;
  try {
    const created = transcriptStore.saveMemory(memory("semantic-transcript"), { requireNew: true });
    const asset = transcriptStore.createVoiceAsset({
      id: "voice-semantic-transcript",
      contentSha256: "f".repeat(64),
      originalName: "fixture.webm",
      mimeType: "audio/webm",
      codec: "opus",
      byteSize: 4096,
      durationMs: 1000,
      storageKey: "voice/semantic-transcript.webm",
      status: "ready"
    });
    transcriptStore.replaceMemoryVoice(created.id, [{ assetId: asset.id, label: "fixture" }]);
    const longText = "确认文字稿很长，但语义来源只应使用稳定的三段、单段七十字且总计七十字投影。".repeat(4);
    transcriptStore.upsertVoiceTranscript({ memoryId: created.id, assetId: asset.id, text: longText, confirmed: true, source: "manual" });
    const saved = transcriptStore.getMemory(created.id);
    const voices = transcriptStore.listVoiceForMemory(created.id);
    const projected = buildSemanticRecallDocument(saved, voices, saved.id);
    equal(projected.confirmedTranscripts.length, 1, "long confirmed transcript stays within one projected segment");
    ok([...projected.confirmedTranscripts[0]].length <= 70, "long confirmed transcript projection never exceeds 70 characters");
    equal(transcriptStore.upsertSemanticEmbeddings([entry(saved.id, projected.sourceSha256, 1)], identity()).stored, 1, "long transcript uses the same source hash for vector persistence");
    equal(transcriptStore.getSemanticIndexStatus(identity()).fresh, 1, "long transcript vector is fresh before restart");
    transcriptStore.close();

    reopened = createMemoryStore({
      dbPath: transcriptPath,
      schemaVersion: 20,
      halls: [{ id: "daily", name: "Daily", description: "fixture" }]
    });
    const reopenedMemory = reopened.getMemory(created.id);
    const reopenedDocument = buildSemanticRecallDocument(reopenedMemory, reopened.listVoiceForMemory(created.id), created.id);
    equal(reopenedDocument.sourceSha256, projected.sourceSha256, "long confirmed transcript hash remains stable after reopening SQLite");
    equal(reopened.getSemanticIndexStatus(identity()).fresh, 1, "reopened long transcript vector remains reusable");
    reopened.upsertVoiceTranscript({ memoryId: created.id, assetId: asset.id, text: `${longText} 已修改`, confirmed: false, source: "manual" });
    equal(reopened.getSemanticIndexStatus(identity()).cachedCount, 0, "confirming-state changes invalidate the long transcript vector");
  } finally {
    try { transcriptStore.close(); } catch { /* it may already be closed before reopening */ }
    try { reopened?.close(); } catch { /* deterministic cleanup */ }
  }
}

function checkSchemaAndLifecycle() {
  const initial = store.getSemanticIndexStatus(identity());
  equal(initial.cachedCount, 0, "new schema 20 database starts without derived vectors");
  const created = store.saveMemory(memory("semantic-a"), { requireNew: true });
  const source = snapshotSource(created);
  const inserted = store.upsertSemanticEmbeddings([entry(created.id, source, 1)], identity());
  deepEqual(inserted, { stored: 1, stale: 0, requested: 1 }, "current source hash stores one vector");
  equal(store.getSemanticIndexStatus(identity()).fresh, 1, "stored vector is fresh for current text projection");
  equal(store.searchSemanticEmbeddings(vector(1), { ...identity(), limit: 30 })[0].memoryId, created.id, "exact BLOB search returns the stored memory");

  const subarrayBacking = new Float32Array(513);
  subarrayBacking[0] = -1;
  subarrayBacking[1] = 0.75;
  equal(store.upsertSemanticEmbeddings([{
    memoryId: created.id,
    sourceSha256: source,
    vector: subarrayBacking.subarray(1)
  }], identity()).stored, 1, "a Float32Array subarray persists only its view bytes");
  equal(store.searchSemanticEmbeddings(vector(1), { ...identity(), limit: 30 })[0].similarity, 0.75, "semantic search reads the Float32Array subarray rather than its backing prefix");

  const edited = store.saveMemory({ ...created, title: "edited title" }, { requireExisting: true, expectedUpdatedAt: created.updatedAt });
  equal(store.getSemanticIndexStatus(identity()).cachedCount, 0, "title changes invalidate the derived cache");
  const stale = store.upsertSemanticEmbeddings([entry(edited.id, source, 1)], identity());
  deepEqual(stale, { stored: 0, stale: 1, requested: 1 }, "late vector for an old source hash cannot overwrite current text");
  const current = snapshotSource(edited);
  equal(store.upsertSemanticEmbeddings([entry(edited.id, current, 1)], identity()).stored, 1, "current source hash can rebuild cache");
  const tagged = store.saveMemory({ ...edited, tags: ["tagged"] }, { requireExisting: true, expectedUpdatedAt: edited.updatedAt });
  equal(store.getSemanticIndexStatus(identity()).cachedCount, 0, "tag changes invalidate the derived cache");
  equal(store.deleteMemory(tagged.id), true, "memory can be deleted after cache invalidation");
  equal(store.getSemanticIndexStatus(identity()).cachedCount, 0, "deleting memory leaves no index orphan");

  const second = store.saveMemory(memory("semantic-b"), { requireNew: true });
  equal(store.upsertSemanticEmbeddings([entry(second.id, snapshotSource(second), 0.5)], identity()).stored, 1, "second memory index is stored");
  equal(store.purgeAll().memoriesDeleted >= 1, true, "purge removes collection data");
  equal(store.getSemanticIndexStatus(identity()).cachedCount, 0, "purge clears derived vectors with the museum");
}

function checkExportBoundary() {
  const created = store.saveMemory(memory("semantic-export"), { requireNew: true });
  equal(store.upsertSemanticEmbeddings([entry(created.id, snapshotSource(created), 1)], identity()).stored, 1, "export fixture has a derived vector");
  const exporter = createCollectionExporter({
    store,
    appVersion: "17.2.2",
    schemaVersion: 20,
    buildArchaeologyBackup: () => ({ mode: "full", events: [], claims: [], pairDecisions: [], questions: [] })
  });
  const archive = exporter(store.listMemories(), "full");
  ok(!JSON.stringify(archive).includes("semantic_embedding_cache"), "export does not serialize derived cache table");
  ok(!JSON.stringify(archive).includes(Buffer.from(vector(1).buffer).toString("base64")), "export does not serialize vector bytes");
}

function checkSchemaMigrationAndImportBoundary() {
  const schema19 = createMemoryStore({
    dbPath: migrationPath,
    schemaVersion: 19,
    halls: [{ id: "daily", name: "Daily", description: "fixture" }]
  });
  migrationStores.push(schema19);
  const legacy = schema19.saveMemory(memory("semantic-migration"), { requireNew: true });
  equal(schema19.getMemory(legacy.id).schemaVersion, 20, "legacy fixture may contain a current memory payload before schema migration");
  schema19.close();

  const schema20 = createMemoryStore({
    dbPath: migrationPath,
    schemaVersion: 20,
    halls: [{ id: "daily", name: "Daily", description: "fixture" }]
  });
  migrationStores.push(schema20);
  equal(schema20.getSemanticIndexStatus(identity()).cachedCount, 0, "schema 19 to 20 migration creates an empty derived cache");
  const migrated = schema20.getMemory(legacy.id);
  equal(schema20.upsertSemanticEmbeddings([entry(migrated.id, snapshotSource(migrated), 1)], identity()).stored, 1, "migrated database accepts a current derived vector");
  schema20.importMemories([{ ...migrated, rawContent: "imported text replaces the old source" }], { revisionMode: "defer" });
  equal(schema20.getSemanticIndexStatus(identity()).cachedCount, 0, "importing changed text invalidates its prior derived vector");
  schema20.close();

  const reopened = createMemoryStore({
    dbPath: migrationPath,
    schemaVersion: 20,
    halls: [{ id: "daily", name: "Daily", description: "fixture" }]
  });
  migrationStores.push(reopened);
  equal(reopened.getSemanticIndexStatus(identity()).cachedCount, 0, "schema 20 migration is idempotent after a restart");
  reopened.close();

  const { DatabaseSync } = require("node:sqlite");
  const { applyMigrations } = require("../lib/migrations");
  const downgradeDb = new DatabaseSync(migrationPath);
  let downgradeError = null;
  try { applyMigrations({ db: downgradeDb, baselineVersion: 4, migrations: [], supportedVersion: 19 }); } catch (error) { downgradeError = error; }
  downgradeDb.close();
  equal(downgradeError?.code, "MIGRATION_DATABASE_TOO_NEW", "schema 19 program rejects a schema 20 database instead of downgrading it");
  assertions += 1;
}

function identity() { return { modelId: MODEL_ID, modelSha256: MODEL_SHA256, projectionVersion: "v1" }; }
function vector(first) { const value = new Float32Array(512); value[0] = first; return value; }
function entry(memoryId, sourceSha256, first) { return { memoryId, sourceSha256, vector: vector(first) }; }
function snapshotSource(memory) {
  const snapshot = require("../lib/semantic-recall-service").buildSemanticRecallDocument(memory, [], memory.id);
  return snapshot.sourceSha256;
}
function memory(id) {
  return {
    schemaVersion: 20, id, title: "fixture", hall: "daily", sourceType: "note", rawContent: "private source text", exhibitText: "exhibit", date: "",
    location: "", people: [], tags: [], emotions: [], emotionIntensity: 3, importance: 3, favorite: false, coverImage: "", mediaNote: "", attachments: [], agentRunId: "",
    createdAt: "2026-08-12T00:00:00.000Z", updatedAt: "2026-08-12T00:00:00.000Z"
  };
}
function ok(value, message) { assert.ok(value, message); assertions += 1; }
function equal(actual, expected, message) { assert.equal(actual, expected, message); assertions += 1; }
function deepEqual(actual, expected, message) { assert.deepEqual(actual, expected, message); assertions += 1; }
