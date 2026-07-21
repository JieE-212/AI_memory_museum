"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { Readable } = require("node:stream");
const { createMemoryStore } = require("../database");
const { createCollectionExporter } = require("../lib/collection-export");
const { buildArchaeologyBackup } = require("../lib/archaeology-backup");
const { buildMediaArchive } = require("../lib/media-backup");
const { createMediaStorage } = require("../lib/media-storage");
const { createVoiceStorage } = require("../lib/voice-storage");
const { createIsolatedRecoveryRuntime, SANDBOX_PARENT_NAME } = require("../lib/isolated-recovery-runtime");
const { isMutationRequest } = require("../lib/museum-write-runtime");
const { LOCK_CONFIRMATION, RECOVERY_VERIFIER_FORMAT } = require("../lib/museum-lock-service");

const SCHEMA_VERSION = 19;
const APP_VERSION = "15.0.0";
const halls = [{ id: "daily", name: "日常展厅", description: "永久真实恢复门禁" }];
let assertions = 0;

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "time-isle-isolated-runtime-check-"));
  const sourceRoot = path.join(root, "source");
  const temporaryRoot = path.join(root, "runtime-temp");
  let store = null;
  try {
    fs.mkdirSync(sourceRoot, { recursive: true });
    const dbPath = path.join(sourceRoot, "museum.sqlite");
    const mediaRoot = path.join(sourceRoot, "media");
    const voiceRoot = path.join(mediaRoot, "voice");
    store = createMemoryStore({ dbPath, halls, schemaVersion: SCHEMA_VERSION });
    const mediaStorage = createMediaStorage({ root: mediaRoot });
    const voiceStorage = createVoiceStorage({ root: voiceRoot });
    const memory = store.saveMemory(normalizeMemory({
      id: "memory-runtime-source",
      title: "一次性恢复门禁",
      rawContent: "这段私人测试正文只能留在源馆藏与一次性副本中。",
      exhibitText: "用真实图片和声音证明备份可以恢复。"
    }));
    createImageFixture(store, mediaStorage, memory.id);
    await createVoiceFixture(store, voiceStorage, memory.id);

    const buildCollectionExport = createCollectionExporter({
      store,
      appVersion: APP_VERSION,
      schemaVersion: SCHEMA_VERSION,
      buildArchaeologyBackup
    });
    const collection = buildCollectionExport(store.listMemories(), "full");
    const archive = buildMediaArchive({
      collection,
      store,
      storage: mediaStorage,
      voiceStorage,
      appVersion: APP_VERSION,
      schemaVersion: SCHEMA_VERSION
    });
    ok(Buffer.isBuffer(archive) && archive.subarray(0, 2).equals(Buffer.from([0x1f, 0x8b])),
      "production export chain creates a gzip .time-isle archive");

    const locked = store.transitionMuseumLock({
      action: "lock",
      confirmation: LOCK_CONFIRMATION,
      expectedRevision: store.getMuseumLockState().revision,
      operationId: "runtime-check-lock-0001",
      verifier: verifierFixture()
    });
    equal(locked.publicState.status, "locked", "source museum is locked before the rehearsal");
    equal(isMutationRequest("POST", "/api/recovery-drills/isolated-restore"), false,
      "isolated recovery endpoint remains read-only to the museum lock gate");

    const sourceStatsBefore = stableJson(store.getStats());
    const sourceLockBefore = stableJson(store.getMuseumLockState());
    const sourceDatabaseBefore = hashFile(dbPath);
    const sourceFilesBefore = hashTree(mediaRoot);
    const runtime = createIsolatedRecoveryRuntime({
      temporaryRoot,
      schemaVersion: SCHEMA_VERSION,
      halls,
      normalizeMemory,
      createId: (() => {
        let value = 0;
        return (prefix) => `${prefix}-runtime-restored-${++value}`;
      })()
    });
    const receipt = await runtime.run(archive, {
      requestId: "recovery_runtimecheckabcdefghijkl"
    });

    equal(receipt.verdict, "passed-isolated-restore", "real runtime completes an isolated restore");
    equal(receipt.checks.restore.counts.memories, 1, "real runtime restores the memory into the copy");
    equal(receipt.checks.restore.counts.mediaAssets, 1, "real runtime restores and verifies the image asset");
    equal(receipt.checks.restore.counts.mediaVariants, 3, "real runtime verifies every image variant hash and format");
    equal(receipt.checks.restore.counts.voiceAssets, 1, "real runtime restores and verifies the voice file");
    equal(receipt.checks.database.passed, receipt.checks.database.total,
      "schema, FTS, foreign keys and SQLite integrity all pass");
    equal(receipt.isolation.currentMuseumCapabilityProvided, false, "receipt exposes the no-live-capability boundary");
    equal(receipt.isolation.sandboxDestroyed, true, "receipt is returned only after sandbox destruction");
    equal(fs.existsSync(path.join(temporaryRoot, SANDBOX_PARENT_NAME)), false,
      "real runtime leaves no recovery sandbox parent or child behind");

    await rejectsIncompleteRestore({
      archive,
      temporaryRoot: path.join(root, "missing-variant-temp"),
      requestId: "recovery_aaaaaaaaaaaaaaaaaaaaaaaa",
      deleteSql: "DELETE FROM media_variants WHERE kind = 'thumb'",
      message: "a missing restored image variant cannot produce a passed receipt"
    });
    await rejectsIncompleteRestore({
      archive,
      temporaryRoot: path.join(root, "missing-reference-temp"),
      requestId: "recovery_bbbbbbbbbbbbbbbbbbbbbbbb",
      deleteSql: "DELETE FROM memory_media",
      message: "a missing restored relationship edge cannot produce a passed receipt"
    });

    equal(stableJson(store.getStats()), sourceStatsBefore, "source museum statistics remain unchanged");
    equal(stableJson(store.getMuseumLockState()), sourceLockBefore, "source lock state and verifier remain unchanged");
    equal(hashFile(dbPath), sourceDatabaseBefore, "source SQLite bytes remain unchanged");
    equal(stableJson(hashTree(mediaRoot)), stableJson(sourceFilesBefore),
      "source image and voice file inventory and hashes remain unchanged");
    const serialized = JSON.stringify(receipt);
    equal(/私人测试正文|memory-runtime-source|asset-runtime-source|voice-runtime-source|runtime-temp|museum\.sqlite|[a-f0-9]{64}/u.test(serialized), false,
      "receipt contains no content, source IDs, paths or individual hashes");
  } finally {
    try { store?.close(); } catch { /* preserve the original assertion */ }
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
  console.log(`Isolated recovery runtime checks passed: ${assertions}`);
}

async function rejectsIncompleteRestore(options) {
  const runtime = createIsolatedRecoveryRuntime({
    temporaryRoot: options.temporaryRoot,
    schemaVersion: SCHEMA_VERSION,
    halls,
    normalizeMemory,
    createId: (() => {
      let value = 0;
      return (prefix) => `${prefix}-incomplete-restore-${++value}`;
    })(),
    createStore: (storeOptions) => {
      const store = createMemoryStore(storeOptions);
      let sabotagePending = true;
      return new Proxy(store, {
        get(target, property, receiver) {
          if (property !== "runDatabaseHealthChecks") return Reflect.get(target, property, receiver);
          return (...args) => {
            if (sabotagePending) {
              sabotagePending = false;
              const database = new DatabaseSync(storeOptions.dbPath);
              try { database.exec(options.deleteSql); }
              finally { database.close(); }
            }
            return target.runDatabaseHealthChecks(...args);
          };
        }
      });
    }
  });
  assertions += 1;
  await assert.rejects(
    () => runtime.run(options.archive, { requestId: options.requestId }),
    (error) => error?.code === "ISOLATED_RECOVERY_REFERENCE_CHECK_FAILED",
    options.message
  );
  equal(fs.existsSync(path.join(options.temporaryRoot, SANDBOX_PARENT_NAME)), false,
    `${options.message}; the rejected copy is still destroyed`);
}

function createImageFixture(store, storage, memoryId) {
  const bytes = createWebp(12, 8);
  const hash = sha256(bytes);
  const asset = {
    id: "asset-runtime-source",
    contentSha256: hash,
    originalName: "runtime-photo.webp",
    sourceMimeType: "image/webp",
    sourceByteSize: bytes.length,
    width: 12,
    height: 8,
    storageDriver: "local",
    privacyMode: "preserve_original",
    status: "ready",
    safeMetadata: { canonicalVariant: "display", coordinateSpace: "canonical-preview-v1" }
  };
  const variants = ["original", "display", "thumb"].map((kind) => {
    const storageKey = `assets/runtime/${kind}.webp`;
    const filePath = storage.resolveStorageKey(storageKey);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, bytes);
    return {
      assetId: asset.id,
      kind,
      storageKey,
      mimeType: "image/webp",
      byteSize: bytes.length,
      width: 12,
      height: 8,
      sha256: hash
    };
  });
  store.createMediaAsset(asset, variants);
  store.attachMedia(memoryId, asset.id, {
    role: "cover",
    position: 0,
    caption: "真实恢复测试图片",
    altText: "十二乘八的合成 WebP",
    backNote: "只用于永久门禁",
    metadata: {}
  });
}

async function createVoiceFixture(store, voiceStorage, memoryId) {
  const saved = await voiceStorage.save(Readable.from(makeWebm(1000)), {
    fileName: "runtime-voice.webm",
    declaredMimeType: "audio/webm"
  });
  const asset = store.createVoiceAsset({
    id: "voice-runtime-source",
    ...saved.asset,
    status: "ready"
  });
  store.replaceMemoryVoice(memoryId, [{ assetId: asset.id, label: "真实恢复测试声音" }]);
  store.upsertVoiceTranscript({
    memoryId,
    assetId: asset.id,
    text: "这段转写只用于真实恢复门禁。",
    language: "zh-CN",
    source: "manual",
    status: "confirmed"
  });
}

function normalizeMemory(input = {}) {
  const now = "2026-07-21T00:00:00.000Z";
  return {
    schemaVersion: SCHEMA_VERSION,
    id: String(input.id || "memory-runtime"),
    title: String(input.title || "恢复门禁"),
    hall: "daily",
    sourceType: "文字记录",
    rawContent: String(input.rawContent || ""),
    exhibitText: String(input.exhibitText || ""),
    date: "2026-07-21",
    location: "本机",
    people: ["recovery-witness"],
    tags: ["恢复门禁"],
    emotions: ["reassured"],
    emotionIntensity: 3,
    importance: 2,
    favorite: false,
    coverImage: "",
    mediaNote: "",
    attachments: [],
    agentRunId: "",
    createdAt: now,
    updatedAt: ""
  };
}

function verifierFixture() {
  return {
    format: RECOVERY_VERIFIER_FORMAT,
    version: 1,
    algorithm: "scrypt-sha256",
    parameters: { cost: 32768, blockSize: 8, parallelization: 1, keyLength: 32 },
    salt: Buffer.alloc(16, 2).toString("base64url"),
    digest: Buffer.alloc(32, 3).toString("base64url")
  };
}

function createWebp(width, height) {
  const frame = Buffer.alloc(10);
  frame[3] = 0x9d;
  frame[4] = 0x01;
  frame[5] = 0x2a;
  frame.writeUInt16LE(width, 6);
  frame.writeUInt16LE(height, 8);
  const chunk = Buffer.alloc(18);
  chunk.write("VP8 ", 0, 4, "ascii");
  chunk.writeUInt32LE(frame.length, 4);
  frame.copy(chunk, 8);
  const body = Buffer.concat([Buffer.from("WEBP", "ascii"), chunk]);
  const header = Buffer.alloc(8);
  header.write("RIFF", 0, 4, "ascii");
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

function makeWebm(durationMs) {
  const opusHead = Buffer.alloc(19);
  opusHead.write("OpusHead", 0, "ascii");
  opusHead[8] = 1;
  opusHead[9] = 1;
  opusHead.writeUInt32LE(48_000, 12);
  const audio = ebmlElement("e1", Buffer.concat([ebmlUInt("9f", 1), ebmlFloat("b5", 48_000)]));
  const track = ebmlElement("ae", Buffer.concat([
    ebmlUInt("d7", 1),
    ebmlUInt("83", 2),
    ebmlElement("86", Buffer.from("A_OPUS")),
    ebmlElement("63a2", opusHead),
    audio
  ]));
  const segment = ebmlElement("18538067", Buffer.concat([
    ebmlElement("1549a966", Buffer.concat([ebmlUInt("2ad7b1", 1_000_000), ebmlFloat("4489", durationMs)])),
    ebmlElement("1654ae6b", track),
    ebmlElement("1f43b675", Buffer.concat([ebmlUInt("e7", 0), ebmlElement("a3", Buffer.from([0x81, 0, 0, 0x80, 0xf8]))]))
  ]));
  return Buffer.concat([ebmlElement("1a45dfa3", ebmlElement("4282", Buffer.from("webm"))), segment]);
}

function ebmlElement(id, payload) {
  return Buffer.concat([Buffer.from(id, "hex"), ebmlSize(payload.length), payload]);
}

function ebmlUInt(id, value) {
  let hex = BigInt(value).toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  return ebmlElement(id, Buffer.from(hex, "hex"));
}

function ebmlFloat(id, value) {
  const data = Buffer.alloc(8);
  data.writeDoubleBE(value);
  return ebmlElement(id, data);
}

function ebmlSize(value) {
  const number = BigInt(value);
  for (let width = 1; width <= 8; width += 1) {
    if (number >= (1n << BigInt(7 * width)) - 1n) continue;
    let marked = number | (1n << BigInt(7 * width));
    const output = Buffer.alloc(width);
    for (let index = width - 1; index >= 0; index -= 1) {
      output[index] = Number(marked & 0xffn);
      marked >>= 8n;
    }
    return output;
  }
  throw new Error("EBML fixture is too large.");
}

function hashTree(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const filePath = path.join(entry.parentPath || entry.path, entry.name);
      return { path: path.relative(root, filePath).replace(/\\/gu, "/"), sha256: hashFile(filePath) };
    })
    .sort((left, right) => left.path.localeCompare(right.path));
}

function hashFile(filePath) {
  return sha256(fs.readFileSync(filePath));
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function stableJson(value) {
  return JSON.stringify(value, Object.keys(value || {}).sort());
}

function ok(value, message) {
  assertions += 1;
  assert.ok(value, message);
}

function equal(actual, expected, message) {
  assertions += 1;
  assert.equal(actual, expected, message);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
