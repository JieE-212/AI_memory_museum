"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const {
  applyMuseumLockTransition,
  assertNoRecoveryVerifier,
  auditMuseumLockTransition,
  createInitialMuseumLockState,
  evaluateMuseumWriteGate,
  normalizeMuseumLockState,
  normalizeRecoveryVerifier,
  publicMuseumLockState,
  sameRecoveryVerifier,
  LOCK_CONFIRMATION,
  MUSEUM_LOCK_ARCHIVE_POLICY,
  MUSEUM_LOCK_SECURITY_BUDGET,
  RECOVERY_VERIFIER_FORMAT,
  UNLOCK_CONFIRMATION
} = require("../lib/museum-lock-service");
const {
  createStructuralRecoveryDrill,
  inspectPreparedArchive,
  STRUCTURAL_RECOVERY_FORMAT,
  STRUCTURAL_RECOVERY_MAXIMUM_BUDGET,
  STRUCTURAL_VERIFICATION_KIND
} = require("../lib/structural-recovery-drill");

let assertions = 0;

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  checkLockStateAndVerifier();
  checkLockTransitions();
  checkPreBodyGate();
  await checkStructuralRecoveryDrill();
  console.log(`museum-lock-check: ${assertions} assertions passed`);
}

function checkLockStateAndVerifier() {
  const initial = createInitialMuseumLockState({
    clock: () => "2026-07-19T10:00:00.000Z",
    randomBytes: (length) => Buffer.alloc(length, 1)
  });
  checkEqual(initial.format, "time-isle.museum-write-lock", "initial state uses the explicit write-lock format");
  checkEqual(initial.stateId, "lock_AQEBAQEBAQEBAQEBAQEBAQEB", "state IDs support an injected deterministic random source");
  checkEqual(initial.status, "unlocked", "initial state is unlocked");
  checkEqual(initial.revision, 0, "initial revision is zero");
  checkEqual(initial.recoveryVerifier, null, "initial state does not invent a recovery verifier");
  checkEqual(initial.createdAt, "2026-07-19T10:00:00.000Z", "state creation supports an injected deterministic clock");
  check(Object.isFrozen(initial), "initial state is immutable");
  checkDeepEqual(normalizeMuseumLockState(JSON.parse(JSON.stringify(initial))), initial,
    "a persisted state round-trips through strict normalization");

  const verifier = makeScryptVerifier();
  const normalized = normalizeRecoveryVerifier(verifier);
  checkEqual(normalized.format, RECOVERY_VERIFIER_FORMAT, "verifier format is explicit");
  checkEqual(normalized.algorithm, "scrypt-sha256", "scrypt verifier is accepted");
  checkEqual(normalized.parameters.cost, 32768, "scrypt cost remains parameterized");
  checkEqual(Buffer.from(normalized.salt, "base64url").length, 16, "verifier salt has the required byte length");
  checkEqual(Buffer.from(normalized.digest, "base64url").length, 32, "verifier digest has the required byte length");
  check(Object.isFrozen(normalized.parameters), "normalized verifier parameters are immutable");
  check(sameRecoveryVerifier(normalized, structuredClone(normalized)), "equal verifiers compare successfully");
  check(!sameRecoveryVerifier(normalized, makeScryptVerifier({ digestByte: 9 })), "different verifier digests do not match");
  check(!sameRecoveryVerifier(normalized, makeScryptVerifier({ saltByte: 9 })), "different verifier salts do not match");

  const pbkdf2 = normalizeRecoveryVerifier(makePbkdf2Verifier());
  checkEqual(pbkdf2.algorithm, "pbkdf2-sha256", "PBKDF2-SHA256 verifier is accepted");
  checkEqual(pbkdf2.parameters.iterations, 310000, "PBKDF2 iteration count remains parameterized");
  check(!sameRecoveryVerifier(normalized, pbkdf2), "different KDF algorithms do not compare equal");

  checkThrows(() => normalizeRecoveryVerifier({ ...verifier, passphrase: "never" }),
    "MUSEUM_LOCK_PLAINTEXT_SECRET_FORBIDDEN", "raw passphrases are rejected at the verifier boundary");
  checkThrows(() => normalizeRecoveryVerifier({ ...verifier, salt: Buffer.alloc(15).toString("base64url") }),
    "MUSEUM_LOCK_VERIFIER_INVALID", "short salts are rejected");
  checkThrows(() => normalizeRecoveryVerifier({ ...verifier, salt: `${verifier.salt}=` }),
    "MUSEUM_LOCK_VERIFIER_INVALID", "padded non-canonical base64url is rejected");
  checkThrows(() => normalizeRecoveryVerifier({ ...verifier, digest: Buffer.alloc(31).toString("base64url") }),
    "MUSEUM_LOCK_VERIFIER_INVALID", "short verifier digests are rejected");
  checkThrows(() => normalizeRecoveryVerifier(makeScryptVerifier({ cost: 10000 })),
    "MUSEUM_LOCK_VERIFIER_INVALID", "non-power-of-two scrypt cost is rejected");
  checkThrows(() => normalizeRecoveryVerifier(makeScryptVerifier({ cost: 8192 })),
    "MUSEUM_LOCK_VERIFIER_INVALID", "weak scrypt cost is rejected");
  checkThrows(() => normalizeRecoveryVerifier(makeScryptVerifier({ cost: 262144, blockSize: 32 })),
    "MUSEUM_LOCK_VERIFIER_INVALID", "scrypt memory beyond the safety budget is rejected");
  checkThrows(() => normalizeRecoveryVerifier(makePbkdf2Verifier({ iterations: 200000 })),
    "MUSEUM_LOCK_VERIFIER_INVALID", "weak PBKDF2 iteration count is rejected");
  checkThrows(() => normalizeRecoveryVerifier(makePbkdf2Verifier({ iterations: 2000001 })),
    "MUSEUM_LOCK_VERIFIER_INVALID", "PBKDF2 work beyond the server budget is rejected");
  checkThrows(() => normalizeRecoveryVerifier({ ...verifier, parameters: { ...verifier.parameters, keyLength: 64 } }),
    "MUSEUM_LOCK_VERIFIER_INVALID", "unexpected derived key lengths are rejected");
  checkThrows(() => normalizeRecoveryVerifier({ ...verifier, algorithm: "sha256" }),
    "MUSEUM_LOCK_VERIFIER_INVALID", "unparameterized verifier algorithms are rejected");
  checkThrows(() => createInitialMuseumLockState({ randomBytes: () => Buffer.alloc(17) }),
    "MUSEUM_LOCK_RANDOM_INVALID", "invalid injected randomness is rejected");
  checkThrows(() => createInitialMuseumLockState({ clock: () => "not-a-time" }),
    "MUSEUM_LOCK_CLOCK_INVALID", "invalid injected time is rejected");
  checkEqual(MUSEUM_LOCK_SECURITY_BUDGET.scrypt.maximumMemoryBytes, 256 * 1024 * 1024,
    "scrypt has an explicit memory ceiling");
  checkEqual(MUSEUM_LOCK_ARCHIVE_POLICY.ordinaryArchive, "excluded",
    "ordinary archives explicitly exclude lock authentication material");
}

function checkLockTransitions() {
  const verifier = makeScryptVerifier();
  const initial = createInitialMuseumLockState({
    clock: () => "2026-07-19T10:00:00.000Z",
    randomBytes: (length) => Buffer.alloc(length, 2)
  });
  const lockCommand = {
    action: "lock",
    confirmation: LOCK_CONFIRMATION,
    expectedRevision: 0,
    operationId: "op-lock-0001",
    verifier
  };
  const locked = applyMuseumLockTransition(initial, lockCommand, {
    clock: () => "2026-07-19T10:01:00.000Z"
  });
  checkEqual(locked.persistenceRecord.status, "locked", "explicit lock command changes state to locked");
  checkEqual(locked.persistenceRecord.revision, 1, "lock command advances the compare-and-set revision once");
  checkEqual(locked.persistenceRecord.lockedAt, "2026-07-19T10:01:00.000Z", "lock time comes from the injected clock");
  checkEqual(locked.transition.changed, true, "first lock transition reports a change");
  checkEqual(locked.transition.idempotent, false, "first lock transition is not a replay");
  checkEqual(locked.publicState.verifierConfigured, true, "public state reports only verifier presence");
  check(!Object.hasOwn(locked.publicState, "recoveryVerifier"), "public state omits the verifier object");
  check(!JSON.stringify(locked.publicState).includes(verifier.digest), "public state serialization omits verifier digest");
  check(!JSON.stringify(locked.publicState).includes(verifier.salt), "public state serialization omits verifier salt");
  check(locked.publicState.boundary.includes("not disk"), "public state says write lock is not disk encryption");
  checkThrows(() => assertNoRecoveryVerifier(locked.persistenceRecord), "MUSEUM_LOCK_VERIFIER_EXPORT_FORBIDDEN",
    "ordinary archives and logs reject the persistence record");
  check(assertNoRecoveryVerifier(locked.publicState), "public lock state is safe for API and log projection");

  const audit = auditMuseumLockTransition(locked);
  checkEqual(audit.action, "lock", "audit projection retains the transition action");
  checkEqual(audit.secretMaterialIncluded, false, "audit projection explicitly excludes secret material");
  check(!JSON.stringify(audit).includes(verifier.digest), "audit projection excludes verifier digest");
  check(assertNoRecoveryVerifier(audit), "audit projection passes the verifier-exclusion guard");

  const replay = applyMuseumLockTransition(locked.persistenceRecord, lockCommand, {
    clock: () => "2030-01-01T00:00:00.000Z"
  });
  checkEqual(replay.persistenceRecord.revision, 1, "same operation ID replay does not advance revision");
  checkEqual(replay.transition.replayed, true, "same operation ID is recognized as a replay");
  checkEqual(replay.transition.changed, false, "replay performs no second change");
  checkEqual(replay.transition.at, "2026-07-19T10:01:00.000Z", "replay preserves the original transition time");
  checkThrows(() => applyMuseumLockTransition(locked.persistenceRecord, { ...lockCommand, expectedRevision: 1 }),
    "MUSEUM_LOCK_OPERATION_REUSED", "operation IDs cannot be reused with different input");

  const alreadyLocked = applyMuseumLockTransition(locked.persistenceRecord, {
    ...lockCommand,
    expectedRevision: 1,
    operationId: "op-lock-0002"
  });
  checkEqual(alreadyLocked.transition.idempotent, true, "locking an already locked museum is idempotent");
  checkEqual(alreadyLocked.persistenceRecord.revision, 1, "already-locked idempotency does not create tombstone revisions");

  checkThrows(() => applyMuseumLockTransition(initial, { ...lockCommand, confirmation: true }),
    "MUSEUM_LOCK_CONFIRMATION_REQUIRED", "boolean confirmation is not accepted as explicit lock confirmation");
  checkThrows(() => applyMuseumLockTransition(initial, { ...lockCommand, expectedRevision: 1 }),
    "MUSEUM_LOCK_REVISION_CONFLICT", "stale compare-and-set revision is rejected");
  checkThrows(() => applyMuseumLockTransition(locked.persistenceRecord, {
    action: "unlock",
    confirmation: UNLOCK_CONFIRMATION,
    expectedRevision: 1,
    operationId: "op-unlock-bad1",
    verifier: makeScryptVerifier({ digestByte: 8 })
  }), "MUSEUM_LOCK_VERIFIER_MISMATCH", "unlock rejects a mismatched verifier");
  checkThrows(() => applyMuseumLockTransition(initial, {
    action: "unlock",
    confirmation: UNLOCK_CONFIRMATION,
    expectedRevision: 0,
    operationId: "op-unlock-none",
    verifier
  }), "MUSEUM_LOCK_VERIFIER_NOT_CONFIGURED", "unconfigured initial state cannot be unlocked with an arbitrary verifier");

  const unlockCommand = {
    action: "unlock",
    confirmation: UNLOCK_CONFIRMATION,
    expectedRevision: 1,
    operationId: "op-unlock-0001",
    verifier
  };
  const unlocked = applyMuseumLockTransition(locked.persistenceRecord, unlockCommand, {
    clock: () => "2026-07-19T10:02:00.000Z"
  });
  checkEqual(unlocked.persistenceRecord.status, "unlocked", "matching explicit unlock changes state to unlocked");
  checkEqual(unlocked.persistenceRecord.revision, 2, "unlock advances revision exactly once");
  checkEqual(unlocked.persistenceRecord.unlockedAt, "2026-07-19T10:02:00.000Z", "unlock time is recorded");
  checkEqual(unlocked.persistenceRecord.recoveryVerifier.algorithm, "scrypt-sha256", "unlock retains only the configured verifier");
  const unlockReplay = applyMuseumLockTransition(unlocked.persistenceRecord, unlockCommand);
  checkEqual(unlockReplay.transition.replayed, true, "unlock retry with the same operation ID is idempotent");
  checkEqual(unlockReplay.persistenceRecord.revision, 2, "unlock retry does not advance revision");

  const relocked = applyMuseumLockTransition(unlocked.persistenceRecord, {
    action: "lock",
    confirmation: LOCK_CONFIRMATION,
    expectedRevision: 2,
    operationId: "op-relock-001",
    verifier
  }, { clock: () => "2026-07-19T10:03:00.000Z" });
  checkEqual(relocked.persistenceRecord.revision, 3, "relocking with the configured verifier advances revision");
  checkEqual(relocked.persistenceRecord.status, "locked", "relock restores write protection");
  checkThrows(() => applyMuseumLockTransition(unlocked.persistenceRecord, {
    action: "lock",
    confirmation: LOCK_CONFIRMATION,
    expectedRevision: 2,
    operationId: "op-relock-bad",
    verifier: makePbkdf2Verifier()
  }), "MUSEUM_LOCK_VERIFIER_MISMATCH", "existing verifier cannot be silently rotated by relocking");

  checkThrows(() => applyMuseumLockTransition(initial, lockCommand, { demoMode: true }),
    "MUSEUM_LOCK_DEMO_READ_ONLY", "public demo cannot persist lock transitions");
  checkThrows(() => applyMuseumLockTransition(initial, { ...lockCommand, passphrase: "plaintext" }),
    "MUSEUM_LOCK_PLAINTEXT_SECRET_FORBIDDEN", "transition command does not accept a plaintext passphrase field");
  checkThrows(() => applyMuseumLockTransition(locked.persistenceRecord, {
    ...unlockCommand,
    operationId: "op-clock-back1"
  }, { clock: () => "2020-01-01T00:00:00.000Z" }), "MUSEUM_LOCK_CLOCK_INVALID",
  "state transitions reject clocks moving backwards");

  const publicState = publicMuseumLockState(JSON.parse(JSON.stringify(unlocked.persistenceRecord)));
  checkEqual(publicState.revision, 2, "public projection accepts a persisted JSON record");
  checkThrows(() => normalizeMuseumLockState({ ...initial, status: "locked" }),
    "MUSEUM_LOCK_STATE_INVALID", "locked state without verifier is rejected");
  checkThrows(() => normalizeMuseumLockState({ ...initial, plaintextKey: "never" }),
    "MUSEUM_LOCK_STATE_INVALID", "unknown state fields cannot smuggle key material");
}

function checkPreBodyGate() {
  const initial = createInitialMuseumLockState({
    clock: () => "2026-07-19T10:00:00.000Z",
    randomBytes: (length) => Buffer.alloc(length, 3)
  });
  const locked = applyMuseumLockTransition(initial, {
    action: "lock",
    confirmation: LOCK_CONFIRMATION,
    expectedRevision: 0,
    operationId: "op-gate-lock1",
    verifier: makeScryptVerifier()
  }, { clock: () => "2026-07-19T10:01:00.000Z" }).persistenceRecord;

  for (const method of ["GET", "HEAD", "OPTIONS"]) {
    const decision = evaluateMuseumWriteGate({ method, pathname: "/api/memories", lockState: locked });
    checkEqual(decision.allowed, true, `${method} remains available while locked`);
    checkEqual(decision.bodyBytesRead, 0, `${method} gate is decided before body parsing`);
  }
  const exportDecision = evaluateMuseumWriteGate({ method: "GET", pathname: "/api/archive/export", lockState: locked });
  checkEqual(exportDecision.allowed, true, "archive export remains available while locked");
  const blockedPost = evaluateMuseumWriteGate({ method: "POST", pathname: "/api/memories", lockState: locked });
  checkEqual(blockedPost.allowed, false, "locked museum blocks a write POST");
  checkEqual(blockedPost.statusCode, 423, "locked mutation uses HTTP 423");
  checkEqual(blockedPost.code, "MUSEUM_LOCKED", "locked mutation has one stable error code");
  checkEqual(blockedPost.decisionStage, "pre-body", "lock decision is explicitly pre-body");
  checkEqual(blockedPost.bodyBytesRead, 0, "locked mutation reads zero body bytes");
  check(blockedPost.boundary.includes("not disk"), "gate says application lock is not disk encryption");
  checkEqual(evaluateMuseumWriteGate({ method: "DELETE", pathname: "/api/memories/m1", lockState: locked }).statusCode,
    423, "DELETE is blocked while locked");
  checkEqual(evaluateMuseumWriteGate({ method: "PUT", pathname: "/api/memories/m1", lockState: locked }).statusCode,
    423, "PUT is blocked while locked");
  checkEqual(evaluateMuseumWriteGate({ method: "POST", pathname: "/api/archive/restore", lockState: locked }).statusCode,
    423, "real archive restore is blocked while locked");

  const inspect = evaluateMuseumWriteGate({ method: "POST", pathname: "/api/archive/inspect", lockState: locked });
  checkEqual(inspect.allowed, true, "archive verification remains available while locked");
  checkEqual(inspect.mutation, false, "archive verification is classified as conceptually read-only");
  const drill = evaluateMuseumWriteGate({ method: "POST", pathname: "/api/recovery-drills/structural", lockState: locked });
  checkEqual(drill.allowed, true, "structural recovery drill remains available while locked");
  checkEqual(drill.code, "MUSEUM_LOCK_READ_ONLY_OPERATION_ALLOWED", "drill uses the explicit read-only gate result");
  const unlock = evaluateMuseumWriteGate({ method: "POST", pathname: "/api/museum-lock/unlock", lockState: locked });
  checkEqual(unlock.allowed, true, "explicit unlock control remains available while locked");
  checkEqual(unlock.code, "MUSEUM_LOCK_CONTROL_ALLOWED", "unlock uses a dedicated control result");
  checkEqual(evaluateMuseumWriteGate({
    method: "POST", pathname: "/api/museum-lock/unlock", lockState: locked, mutation: true
  }).allowed, true, "a broad route registry cannot accidentally block the explicit unlock control");
  checkEqual(evaluateMuseumWriteGate({
    method: "POST", pathname: "/api/archive/inspect", lockState: locked, mutation: true
  }).allowed, true, "a broad route registry cannot reclassify archive verification as a museum write");
  const customRead = evaluateMuseumWriteGate({
    method: "POST", pathname: "/api/local/read-only-preview", lockState: locked, mutation: false
  });
  checkEqual(customRead.allowed, true, "route registry can declare another bounded POST as non-mutating");

  const unlockedPost = evaluateMuseumWriteGate({ method: "POST", pathname: "/api/memories", lockState: initial });
  checkEqual(unlockedPost.allowed, true, "local unlocked museum permits mutation");
  checkEqual(unlockedPost.code, "MUSEUM_LOCK_WRITE_ALLOWED", "unlocked mutation has a stable decision code");
  const demoPost = evaluateMuseumWriteGate({
    method: "POST", pathname: "/api/memories", lockState: initial, demoMode: true
  });
  checkEqual(demoPost.statusCode, 403, "public demo blocks non-read request with HTTP 403");
  checkEqual(demoPost.bodyBytesRead, 0, "public demo blocks before reading a request body");
  checkEqual(evaluateMuseumWriteGate({
    method: "POST", pathname: "/api/archive/inspect", lockState: initial, demoMode: true
  }).statusCode, 403, "public demo does not stage archive-inspection uploads");
  checkEqual(evaluateMuseumWriteGate({
    method: "POST", pathname: "/api/museum-lock/lock", lockState: initial, demoMode: true
  }).statusCode, 403, "public demo does not persist lock control state");
  checkEqual(evaluateMuseumWriteGate({
    method: "GET", pathname: "/api/memories", demoMode: true
  }).allowed, true, "public demo retains read-only GET access without requiring a persisted lock record");
  checkThrows(() => evaluateMuseumWriteGate({ method: "POST", pathname: "relative", lockState: locked }),
    "MUSEUM_LOCK_GATE_INVALID", "gate rejects non-path request metadata");
}

async function checkStructuralRecoveryDrill() {
  const prepared = makePreparedArchive();
  let prepareCalls = 0;
  let capturedPolicy = null;
  const drill = createStructuralRecoveryDrill({
    prepareArchive: async (source, policy) => {
      prepareCalls += 1;
      checkEqual(source, "synthetic-full-archive", "drill passes the selected archive to trusted preflight");
      capturedPolicy = policy;
      return structuredClone(prepared);
    },
    clock: sequenceClock("2026-07-19T11:00:00.000Z", "2026-07-19T11:00:02.000Z"),
    randomBytes: (length) => Buffer.alloc(length, 4)
  });
  const report = await drill.run("synthetic-full-archive");
  checkEqual(prepareCalls, 1, "structural drill executes one trusted archive preflight");
  checkEqual(capturedPolicy.purpose, STRUCTURAL_VERIFICATION_KIND, "preflight purpose is structural-verification");
  checkEqual(capturedPolicy.mode, "verify-only", "preflight is verify-only");
  checkEqual(capturedPolicy.requireFullArchive, true, "preflight requires a complete archive");
  checkEqual(capturedPolicy.restore, false, "preflight policy forbids restore");
  checkEqual(capturedPolicy.writeCurrentCollection, false, "preflight policy forbids current collection writes");
  check(Object.isFrozen(capturedPolicy), "preflight policy cannot be mutated by integration code");
  checkEqual(capturedPolicy.limits.maxEntries, STRUCTURAL_RECOVERY_MAXIMUM_BUDGET.maxEntries,
    "preflight receives the entry safety ceiling");
  checkEqual(report.format, STRUCTURAL_RECOVERY_FORMAT, "drill report uses an explicit format");
  checkEqual(report.kind, "structural-verification", "report labels itself structural-verification");
  checkEqual(report.requestId, "drill_BAQEBAQEBAQEBAQEBAQEBAQE", "report ID supports deterministic injected randomness");
  checkEqual(report.verdict, "passed-structural-verification", "successful preflight produces a bounded structural verdict");
  checkEqual(report.archive.mode, "full", "report confirms that a full archive was tested");
  checkEqual(report.archive.entryCount, 5, "report exposes only manifest entry count");
  checkEqual(report.checks.manifest.status, "passed", "manifest result is explicit");
  checkEqual(report.checks.hashes.status, "passed", "hash result is explicit");
  checkEqual(report.checks.hashes.entriesVerified, 5, "hash result is bound to every trusted preflight entry");
  checkEqual(report.checks.hashes.descriptorBindingsRechecked, 1, "media descriptor hash binding is rechecked");
  checkEqual(report.checks.references.status, "passed", "reference result is explicit");
  checkEqual(report.checks.references.mediaLinksRechecked, 1, "media reference count is bounded and reported");
  checkEqual(report.checks.references.observationsRechecked, 1, "observation references are rechecked");
  checkEqual(report.safety.currentCollectionWrites, 0, "drill reports zero current collection writes");
  checkEqual(report.safety.currentMediaWrites, 0, "drill reports zero current media writes");
  checkEqual(report.safety.restoreCallbacksAvailable, false, "drill core has no restore callback");
  checkEqual(report.limitations.actualRestorePerformed, false, "drill does not claim a real restore");
  checkEqual(report.limitations.isolatedRestorePerformed, false, "drill does not claim an isolated restore");
  checkEqual(report.limitations.disasterRecoveryProven, false, "drill does not overclaim disaster recovery");
  checkEqual(report.limitations.diskEncryptionProvided, false, "drill does not imply disk encryption");
  check(report.limitations.statement.includes("structural-verification only"), "limitation text is unambiguous");
  check(/^[a-f0-9]{64}$/u.test(report.archive.archiveFingerprint), "archive fingerprint is deterministic SHA-256 metadata");
  check(!JSON.stringify(report).includes("memory body must stay private"), "drill report does not expose memory text");
  check(!JSON.stringify(report).includes("memory-1"), "drill report does not expose memory IDs");
  check(Object.isFrozen(report.checks.references), "drill report is deeply immutable");

  const directEvidence = inspectPreparedArchive(structuredClone(prepared), STRUCTURAL_RECOVERY_MAXIMUM_BUDGET);
  checkEqual(directEvidence.memoryCount, 1, "bounded core inspection counts memories without returning content");
  checkEqual(directEvidence.assetCount, 1, "bounded core inspection counts media assets");

  checkThrows(() => createStructuralRecoveryDrill({
    prepareArchive: async () => prepared,
    restoreArchive: () => {}
  }), "RECOVERY_DRILL_DEPENDENCY_INVALID", "drill dependency boundary rejects restore callbacks");
  checkThrows(() => createStructuralRecoveryDrill({ prepareArchive: async () => prepared, store: {} }),
    "RECOVERY_DRILL_DEPENDENCY_INVALID", "drill dependency boundary rejects current stores");
  checkThrows(() => createStructuralRecoveryDrill({}), "RECOVERY_DRILL_DEPENDENCY_INVALID",
    "drill requires trusted archive preflight");

  let demoPrepareCalls = 0;
  const demoDrill = createStructuralRecoveryDrill({ prepareArchive: async () => { demoPrepareCalls += 1; return prepared; } });
  await checkRejects(() => demoDrill.run("archive", { demoMode: true }), "RECOVERY_DRILL_DEMO_READ_ONLY",
    "public demo rejects recovery uploads");
  checkEqual(demoPrepareCalls, 0, "public demo rejects before staging or preflight");

  const aborted = new AbortController();
  aborted.abort();
  let abortedPrepareCalls = 0;
  const abortDrill = createStructuralRecoveryDrill({
    prepareArchive: async () => { abortedPrepareCalls += 1; return prepared; }
  });
  await checkRejects(() => abortDrill.run("archive", { signal: aborted.signal }), "ABORT_ERR",
    "already-aborted drill does not begin preflight", "AbortError");
  checkEqual(abortedPrepareCalls, 0, "aborted drill calls no preflight dependency");

  await expectPreparedFailure({ ...prepared, verified: false }, "RECOVERY_DRILL_PREFLIGHT_INVALID",
    "unattested preflight result is rejected");
  await expectPreparedFailure({ ...prepared, manifest: { ...prepared.manifest, mode: "redacted" } },
    "RECOVERY_DRILL_FULL_ARCHIVE_REQUIRED", "redacted export cannot stand in for a complete recovery archive");
  await expectPreparedFailure({ ...prepared, collection: { ...prepared.collection, mode: "redacted" } },
    "RECOVERY_DRILL_FULL_ARCHIVE_REQUIRED", "redacted collection cannot stand in for a complete archive");
  await expectPreparedFailure(mutatePrepared(prepared, (copy) => {
    copy.manifest.entries = copy.manifest.entries.filter((entry) => entry.path !== "media/media_observations.json");
    copy.manifest.entryCount = copy.manifest.entries.length;
  }),
    "RECOVERY_DRILL_FULL_ARCHIVE_REQUIRED", "missing observation manifest entry is rejected");
  await expectPreparedFailure(mutatePrepared(prepared, (copy) => {
    copy.manifest.entries[1].path = copy.manifest.entries[0].path.toUpperCase();
  }), "RECOVERY_DRILL_MANIFEST_INVALID", "case-colliding manifest paths are rejected");
  await expectPreparedFailure(mutatePrepared(prepared, (copy) => { copy.manifest.entries[0].sha256 = "A".repeat(64); }),
    "RECOVERY_DRILL_MANIFEST_INVALID", "non-canonical manifest hash is rejected");
  await expectPreparedFailure(mutatePrepared(prepared, (copy) => { copy.collection.memories.push({ id: "memory-1" }); copy.collection.count += 1; }),
    "RECOVERY_DRILL_REFERENCE_INVALID", "duplicate memory IDs are rejected");
  await expectPreparedFailure(mutatePrepared(prepared, (copy) => { copy.links[0].memoryId = "outside-memory"; }),
    "RECOVERY_DRILL_REFERENCE_INVALID", "media link outside memory boundary is rejected");
  await expectPreparedFailure(mutatePrepared(prepared, (copy) => { copy.links[0].assetId = "outside-asset"; }),
    "RECOVERY_DRILL_REFERENCE_INVALID", "media link outside asset boundary is rejected");
  await expectPreparedFailure(mutatePrepared(prepared, (copy) => { copy.mediaObservations[0].assetId = "outside-asset"; }),
    "RECOVERY_DRILL_REFERENCE_INVALID", "observation outside asset boundary is rejected");
  await expectPreparedFailure(mutatePrepared(prepared, (copy) => { copy.mediaObservations[0].metadata.memoryId = "outside-memory"; }),
    "RECOVERY_DRILL_REFERENCE_INVALID", "observation outside memory boundary is rejected");
  await expectPreparedFailure(mutatePrepared(prepared, (copy) => { copy.assets[0].variants[0].sha256 = digest("tampered"); }),
    "RECOVERY_DRILL_HASH_BINDING_INVALID", "media variant hash must match its manifest entry");
  await expectPreparedFailure(mutatePrepared(prepared, (copy) => { copy.collection.count = 99; }),
    "RECOVERY_DRILL_REFERENCE_INVALID", "collection count mismatch is rejected");
  await expectPreparedFailure(mutatePrepared(prepared, (copy) => {
    copy.files.voices.push({ archivePath: "voices/audio/a.webm", byteSize: 8, sha256: digest("voice") });
  }), "RECOVERY_DRILL_HASH_BINDING_INVALID", "unmanifested voice descriptor is rejected");

  const smallBudgetDrill = createStructuralRecoveryDrill({
    prepareArchive: async (_source, policy) => {
      checkEqual(policy.limits.maxEntries, 4, "callers may lower but not raise the entry budget");
      return prepared;
    }
  });
  await checkRejects(() => smallBudgetDrill.run("archive", { budget: { maxEntries: 4 } }),
    "RECOVERY_DRILL_BUDGET_EXCEEDED", "lowered entry budget is enforced after trusted preflight");
  await checkRejects(() => demoDrill.run("archive", {
    budget: { maxEntries: STRUCTURAL_RECOVERY_MAXIMUM_BUDGET.maxEntries + 1 }
  }), "RECOVERY_DRILL_REQUEST_INVALID", "caller cannot raise the entry safety budget");
  await checkRejects(() => demoDrill.run("archive", { requestId: "arbitrary" }),
    "RECOVERY_DRILL_REQUEST_INVALID", "caller-provided drill IDs must follow the non-content identifier format");

  const genericFailure = createStructuralRecoveryDrill({ prepareArchive: async () => { throw new Error("synthetic failure"); } });
  await checkRejects(() => genericFailure.run("archive"), "RECOVERY_DRILL_PREFLIGHT_FAILED",
    "unknown preflight errors are wrapped in a stable drill error");
  const archiveFailure = createStructuralRecoveryDrill({ prepareArchive: async () => {
    const error = new Error("bad archive");
    error.code = "MEDIA_ARCHIVE_HASH_MISMATCH";
    throw error;
  } });
  await checkRejects(() => archiveFailure.run("archive"), "MEDIA_ARCHIVE_HASH_MISMATCH",
    "specific archive-integrity errors remain inspectable");

  const backwardsClock = createStructuralRecoveryDrill({
    prepareArchive: async () => prepared,
    clock: sequenceClock("2026-07-19T12:00:02.000Z", "2026-07-19T12:00:01.000Z")
  });
  await checkRejects(() => backwardsClock.run("archive"), "RECOVERY_DRILL_CLOCK_INVALID",
    "drill rejects a clock moving backwards");
  const badRandom = createStructuralRecoveryDrill({
    prepareArchive: async () => prepared,
    randomBytes: () => Buffer.alloc(1)
  });
  await checkRejects(() => badRandom.run("archive"), "RECOVERY_DRILL_RANDOM_INVALID",
    "drill rejects an invalid random source");
}

async function expectPreparedFailure(prepared, code, message) {
  const drill = createStructuralRecoveryDrill({ prepareArchive: async () => prepared });
  await checkRejects(() => drill.run("archive", { requestId: "drill_AAAAAAAAAAAAAAAAAAAAAAAA" }), code, message);
}

function makePreparedArchive() {
  const imageBytes = 128;
  const imageHash = digest("synthetic image bytes");
  const entries = [
    jsonEntry("collection.json", "collection"),
    jsonEntry("media/assets.json", "assets"),
    jsonEntry("media/links.json", "links"),
    jsonEntry("media/media_observations.json", "observations"),
    { path: "media/asset-1/display.webp", bytes: imageBytes, sha256: imageHash, mime: "image/webp" }
  ];
  return {
    verified: true,
    manifest: {
      format: "time-isle-media-archive",
      formatVersion: 2,
      schemaVersion: 16,
      appVersion: "11.1.0",
      mode: "full",
      exportedAt: "2026-07-19T09:00:00.000Z",
      entryCount: entries.length,
      entries,
      sections: [
        { name: "collection", path: "collection.json", count: 1, required: true, version: 1 },
        { name: "media", path: "media/assets.json", count: 1, required: true, version: 1 }
      ]
    },
    collection: {
      mode: "full",
      count: 1,
      memories: [{ id: "memory-1", rawContent: "memory body must stay private" }]
    },
    assets: [{
      id: "asset-1",
      variants: [{
        assetId: "asset-1",
        kind: "display",
        archivePath: "media/asset-1/display.webp",
        byteSize: imageBytes,
        sha256: imageHash
      }]
    }],
    links: [{ memoryId: "memory-1", assetId: "asset-1", role: "cover", position: 0 }],
    mediaObservations: [{
      id: "observation-1",
      assetId: "asset-1",
      metadata: { memoryId: "memory-1" }
    }],
    files: { voices: [] }
  };
}

function jsonEntry(pathname, content) {
  return {
    path: pathname,
    bytes: Buffer.byteLength(content),
    sha256: digest(content),
    mime: "application/json"
  };
}

function makeScryptVerifier(options = {}) {
  const saltByte = options.saltByte ?? 5;
  const digestByte = options.digestByte ?? 6;
  return {
    format: RECOVERY_VERIFIER_FORMAT,
    version: 1,
    algorithm: "scrypt-sha256",
    parameters: {
      cost: options.cost ?? 32768,
      blockSize: options.blockSize ?? 8,
      parallelization: options.parallelization ?? 1,
      keyLength: 32
    },
    salt: Buffer.alloc(16, saltByte).toString("base64url"),
    digest: Buffer.alloc(32, digestByte).toString("base64url")
  };
}

function makePbkdf2Verifier(options = {}) {
  return {
    format: RECOVERY_VERIFIER_FORMAT,
    version: 1,
    algorithm: "pbkdf2-sha256",
    parameters: {
      iterations: options.iterations ?? 310000,
      keyLength: 32
    },
    salt: Buffer.alloc(16, 7).toString("base64url"),
    digest: Buffer.alloc(32, 8).toString("base64url")
  };
}

function mutatePrepared(prepared, mutate) {
  const copy = structuredClone(prepared);
  mutate(copy);
  return copy;
}

function sequenceClock(...values) {
  let index = 0;
  return () => values[index++];
}

function digest(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function check(condition, message) {
  assert.ok(condition, message);
  assertions += 1;
}

function checkEqual(actual, expected, message) {
  assert.equal(actual, expected, message);
  assertions += 1;
}

function checkDeepEqual(actual, expected, message) {
  assert.deepEqual(actual, expected, message);
  assertions += 1;
}

function checkThrows(operation, expectedCode, message) {
  let error = null;
  try { operation(); }
  catch (caught) { error = caught; }
  assert.equal(error?.code, expectedCode, message);
  assertions += 1;
}

async function checkRejects(operation, expectedCode, message, expectedName) {
  let error = null;
  try { await operation(); }
  catch (caught) { error = caught; }
  if (expectedName) assert.equal(error?.name, expectedName, message);
  else assert.equal(error?.code, expectedCode, message);
  assertions += 1;
}
