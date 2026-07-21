"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  createIsolatedRecoveryDrill,
  ISOLATED_RECOVERY_FORMAT,
  ISOLATED_RECOVERY_MAXIMUM_BUDGET
} = require("../lib/isolated-recovery-drill");
const { cleanupStaleRecoverySandboxes } = require("../lib/isolated-recovery-runtime");

let assertions = 0;

async function main() {
  await checkSuccessAndSafeReceipt();
  await checkSingleFlightAndAbort();
  await checkInitializationFailuresReleaseLease();
  await checkFailureAndCleanupBoundaries();
  checkDependencyBoundary();
  checkStaleCleanup();
  console.log(`Isolated recovery checks passed: ${assertions}`);
}

async function checkSuccessAndSafeReceipt() {
  let destroyed = 0;
  const drill = createFixtureDrill({ destroySandbox: async () => { destroyed += 1; return { destroyed: true }; } });
  const receipt = await drill.run(Buffer.from("private archive"), {
    requestId: "recovery_abcdefghijklmnopqrstuvwx"
  });
  equal(receipt.format, ISOLATED_RECOVERY_FORMAT, "receipt format is explicit");
  equal(receipt.verdict, "passed-isolated-restore", "real isolated restore receives a distinct verdict");
  equal(receipt.checks.restore.counts.memories, 1, "safe restored memory count is retained");
  equal(receipt.isolation.currentMuseumCapabilityProvided, false, "current museum capability is absent");
  equal(receipt.isolation.currentMuseumWrites, 0, "current museum write count is fixed at zero");
  equal(receipt.isolation.sandboxDestroyed, true, "success is emitted only after destruction");
  equal(receipt.limitations.disasterRecoveryProven, false, "receipt does not overclaim disaster recovery");
  equal(receipt.limitations.processIsolationProvided, false, "receipt does not overclaim process isolation");
  equal(destroyed, 1, "single-use copy is destroyed exactly once");
  ok(Object.isFrozen(receipt) && Object.isFrozen(receipt.checks.restore.counts), "receipt is deeply immutable");
  const serialized = JSON.stringify(receipt);
  equal(/private archive|private-title|memory-private|[A-Za-z]:\\|\/tmp\//u.test(serialized), false,
    "receipt excludes content, IDs and filesystem paths");
}

async function checkSingleFlightAndAbort() {
  const pending = deferred();
  const drill = createFixtureDrill({ createSandbox: () => pending.promise });
  const first = drill.run(Buffer.from("first"), { requestId: "recovery_abcdefghijklmnopqrstuvwx" });
  await rejectsCode(
    () => drill.run(Buffer.from("second"), { requestId: "recovery_bcdefghijklmnopqrstuvwxy" }),
    "ISOLATED_RECOVERY_BUSY",
    "only one isolated restore may run at a time"
  );
  pending.resolve({ isolated: true });
  await first;

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => drill.run(Buffer.from("aborted"), { signal: controller.signal, requestId: "recovery_cdefghijklmnopqrstuvwxyz" }),
    (error) => error?.name === "AbortError"
  );
  assertions += 1;
  const afterAbort = await drill.run(Buffer.from("after abort"), { requestId: "recovery_defghijklmnopqrstuvwxyza" });
  equal(afterAbort.verdict, "passed-isolated-restore", "abort releases the single-flight lease");
}

async function checkInitializationFailuresReleaseLease() {
  const base = { requestId: "recovery_efghijklmnopqrstuvwxyzab" };
  const drill = createFixtureDrill();
  await rejectsCode(
    () => drill.run(Buffer.from("bad budget"), { ...base, budget: { maxEntries: 0 } }),
    "ISOLATED_RECOVERY_VERIFICATION_INVALID",
    "invalid budget fails before leasing the runner"
  );
  equal((await drill.run(Buffer.from("after budget"), base)).verdict, "passed-isolated-restore",
    "invalid budget cannot strand the runner as busy");

  let randomCalls = 0;
  const randomDrill = createFixtureDrill({
    randomBytes(length) {
      randomCalls += 1;
      return randomCalls === 1 ? Buffer.alloc(length - 1) : Buffer.alloc(length, 7);
    }
  });
  await rejectsCode(() => randomDrill.run(Buffer.from("bad random")), "ISOLATED_RECOVERY_RANDOM_INVALID",
    "invalid random source fails safely");
  equal((await randomDrill.run(Buffer.from("after random"))).verdict, "passed-isolated-restore",
    "random-source failure cannot strand the runner as busy");

  let clockCalls = 0;
  const clockDrill = createFixtureDrill({
    clock() {
      clockCalls += 1;
      return clockCalls === 1 ? "not-a-time" : new Date(`2026-07-21T00:00:0${Math.min(clockCalls, 9)}.000Z`);
    }
  });
  await rejectsCode(() => clockDrill.run(Buffer.from("bad clock")), "ISOLATED_RECOVERY_CLOCK_INVALID",
    "invalid clock fails safely");
  equal((await clockDrill.run(Buffer.from("after clock"))).verdict, "passed-isolated-restore",
    "clock failure cannot strand the runner as busy");
}

async function checkFailureAndCleanupBoundaries() {
  let cleanupCalls = 0;
  const restoreFailure = createFixtureDrill({
    restoreArchive() { throw Object.assign(new Error("private restore detail"), { code: "MEDIA_RESTORE_REFERENCE_INVALID" }); },
    destroySandbox: async () => { cleanupCalls += 1; return { destroyed: true }; }
  });
  await rejectsCode(() => restoreFailure.run(Buffer.from("broken"), {
    requestId: "recovery_fghijklmnopqrstuvwxyzabc"
  }), "ISOLATED_RECOVERY_RESTORE_FAILED", "restore failure is normalized and fails closed");
  equal(cleanupCalls, 1, "restore failure still destroys the single-use copy");

  let cleanupAttempts = 0;
  let cleanupSandboxCreations = 0;
  const cleanupFailure = createFixtureDrill({
    createSandbox: async () => {
      cleanupSandboxCreations += 1;
      return { isolated: true };
    },
    destroySandbox: async () => {
      cleanupAttempts += 1;
      if (cleanupAttempts <= 2) throw new Error("private path C:\\temp\\copy");
      return { destroyed: true };
    }
  });
  await rejectsCode(() => cleanupFailure.run(Buffer.from("cleanup fail"), {
    requestId: "recovery_ghijklmnopqrstuvwxyzabcd"
  }), "ISOLATED_RECOVERY_CLEANUP_FAILED", "cleanup failure cannot emit a passed receipt");
  equal(cleanupSandboxCreations, 1, "the first failed rehearsal created one single-use copy");
  await rejectsCode(() => cleanupFailure.run(Buffer.from("blocked by cleanup"), {
    requestId: "recovery_hijklmnopqrstuvwxyzabcde"
  }), "ISOLATED_RECOVERY_CLEANUP_REQUIRED", "a still-undestroyed copy blocks the next archive before it is read");
  equal(cleanupSandboxCreations, 1, "no new copy is created while old-copy cleanup remains unresolved");
  equal((await cleanupFailure.run(Buffer.from("after cleanup"), {
    requestId: "recovery_ijklmnopqrstuvwxyzabcdef"
  })).verdict, "passed-isolated-restore", "cleanup failure releases the single-flight lease");

  const redacted = createFixtureDrill({ prepareArchive: async () => preparedFixture({ mode: "redacted" }) });
  await rejectsCode(() => redacted.run(Buffer.from("redacted"), {
    requestId: "recovery_ijklmnopqrstuvwxyzabcdef"
  }), "ISOLATED_RECOVERY_ARCHIVE_INVALID", "redacted backup cannot claim real full restore");

  const oversized = createFixtureDrill({ prepareArchive: async () => preparedFixture({ entryBytes: 20 }) });
  await rejectsCode(() => oversized.run(Buffer.from("large"), {
    requestId: "recovery_jklmnopqrstuvwxyzabcdefg",
    budget: { ...ISOLATED_RECOVERY_MAXIMUM_BUDGET, maxExpandedBytes: 10, maxEntryBytes: 10 }
  }), "ISOLATED_RECOVERY_ARCHIVE_INVALID", "expanded-byte budget fails closed");
}

function checkDependencyBoundary() {
  assert.throws(
    () => createIsolatedRecoveryDrill({
      store: { private: true },
      createSandbox() {}, prepareArchive() {}, restoreArchive() {}, verifySandbox() {}, destroySandbox() {}
    }),
    (error) => error?.code === "ISOLATED_RECOVERY_DEPENDENCY_INVALID"
  );
  assertions += 1;
}

function checkStaleCleanup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "time-isle-stale-check-"));
  const parentRoot = path.join(root, "time-isle-recovery-drills");
  const oldRun = path.join(parentRoot, "recovery-old_fixture");
  const freshRun = path.join(parentRoot, "recovery-fresh_fixture");
  const unrelated = path.join(parentRoot, "keep-me");
  fs.mkdirSync(oldRun, { recursive: true });
  fs.mkdirSync(freshRun);
  fs.mkdirSync(unrelated);
  const now = Date.now();
  fs.utimesSync(oldRun, new Date(now - 10000), new Date(now - 10000));
  const result = cleanupStaleRecoverySandboxes({ parentRoot, minimumAgeMs: 5000, now });
  equal(result.removed.includes("recovery-old_fixture"), true, "stale matching sandbox is removed");
  equal(fs.existsSync(oldRun), false, "stale sandbox path no longer exists");
  equal(fs.existsSync(freshRun), true, "fresh sandbox is preserved");
  equal(fs.existsSync(unrelated), true, "unrelated temporary directory is preserved");
  fs.rmSync(root, { recursive: true, force: true });
}

function createFixtureDrill(overrides = {}) {
  let tick = 0;
  const defaults = {
    clock: () => new Date(`2026-07-21T00:00:0${tick++}.000Z`),
    randomBytes: (length) => Buffer.alloc(length, 1),
    createSandbox: async () => ({ isolated: true }),
    prepareArchive: async () => preparedFixture(),
    restoreArchive: async () => ({ private: "private-title", idMap: { memory: "memory-private" } }),
    verifySandbox: async () => verificationFixture(),
    destroySandbox: async () => ({ destroyed: true })
  };
  return createIsolatedRecoveryDrill({ ...defaults, ...overrides });
}

function preparedFixture(options = {}) {
  const entryBytes = options.entryBytes === undefined ? 1 : options.entryBytes;
  const entries = [
    "collection.json",
    "media/assets.json",
    "media/links.json",
    "media/media_observations.json"
  ].map((entryPath, index) => ({
    path: entryPath,
    bytes: entryBytes,
    sha256: String(index + 1).repeat(64),
    mime: "application/json"
  }));
  return {
    verified: true,
    manifest: {
      format: "time-isle-media-archive",
      formatVersion: 2,
      schemaVersion: 19,
      appVersion: "15.0.0",
      mode: options.mode || "full",
      exportedAt: "2026-07-21T00:00:00.000Z",
      entryCount: entries.length,
      entries,
      sections: []
    },
    collection: {
      mode: options.mode || "full",
      count: 1,
      memories: [{ id: "memory-source" }]
    },
    assets: [],
    links: [],
    mediaObservations: [],
    files: { voices: [] }
  };
}

function verificationFixture() {
  return {
    targetSchemaVersion: 19,
    counts: {
      memories: 1, mediaAssets: 0, mediaVariants: 0, voiceAssets: 0, exhibitions: 0, capsules: 0,
      entities: 0, revisions: 0, timeCalibrations: 0, oralHistoryQuestions: 0, oralHistoryAnswers: 0,
      curatorAgentRuns: 0, memoryInboxItems: 0, provenanceClaims: 0, coMemoryResponses: 0, revisitIntents: 0
    },
    database: { status: "passed", passed: 5, total: 5, attention: 0 },
    references: { status: "passed", edgesChecked: 0 },
    media: { status: "passed", assetsVerified: 0, variantsVerified: 0 },
    voice: { status: "passed", assetsVerified: 0, filesVerified: 0 }
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function ok(value, message) {
  assertions += 1;
  assert.ok(value, message);
}

function equal(actual, expected, message) {
  assertions += 1;
  assert.equal(actual, expected, message);
}

async function rejectsCode(operation, code, message) {
  assertions += 1;
  await assert.rejects(operation, (error) => error?.code === code, message);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
