"use strict";

const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const cryptoProtocol = require("../public/assets/co-memory-crypto.js");
const { applyMigrations, listAppliedMigrations, readUserVersion } = require("../lib/migrations");
const {
  CO_MEMORY_RESPONSE_ARCHIVE_PREFIX,
  MAX_CO_MEMORY_RESPONSE_BACKUP_BYTES,
  CO_MEMORY_RESPONSE_REDACTED_NOTE,
  CO_MEMORY_RESPONSE_SECTION_NAME,
  CO_MEMORY_RESPONSE_SECTION_PATH,
  validateCoMemoryResponseBackupPayload
} = require("../lib/co-memory-response-backup");
const {
  CO_MEMORY_RESPONSE_MIGRATION,
  initializeCoMemoryResponseDatabase
} = require("../lib/co-memory-response-database");
const {
  createCoMemoryResponseApi,
  readOnlyRecord
} = require("../lib/co-memory-response-api");
const {
  CO_MEMORY_RESPONSE_CONFIRMATION,
  CO_MEMORY_RESPONSE_KIND,
  extractCoMemoryMemoryAnchor,
  mutationSha256,
  resolveCoMemoryResponseSource,
  toCoMemoryResponseSource,
  validateCoMemoryResponseConfirmation,
  validateStoredCoMemoryResponse
} = require("../lib/co-memory-response-service");

const PREVIOUS_MIGRATIONS = Array.from({ length: 12 }, (_, index) => Object.freeze({
  version: index + 5,
  name: `co-memory-response-test-v${index + 5}`,
  up() {}
}));

let assertions = 0;

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});

async function main() {
  await checkServiceContract();
  await checkDatabaseAndSources();
  await checkRestoreBoundary();
  await checkApiBoundary();
  console.log(`co-memory-response-check: ${assertions} assertions passed`);
}

async function checkServiceContract() {
  equal(CO_MEMORY_RESPONSE_SECTION_NAME, "co-memory-responses", "archive section has a dedicated name");
  equal(CO_MEMORY_RESPONSE_SECTION_PATH, "co-memory/responses.json", "archive section has a dedicated JSON path");
  equal(CO_MEMORY_RESPONSE_ARCHIVE_PREFIX, "co-memory/", "archive reserves only its dedicated prefix");
  equal(MAX_CO_MEMORY_RESPONSE_BACKUP_BYTES, 20 * 1024 * 1024, "backup has an explicit archive-safe byte budget");
  const contract = await makeContract({ suffix: "service000000001", memoryId: "memory-service" });
  const normalized = await validateCoMemoryResponseConfirmation(contract);
  equal(normalized.schemaVersion, 17, "service emits schema 17 independent source records");
  equal(normalized.kind, "co_memory_response", "service keeps co-memory responses out of existing provenance kinds");
  equal(normalized.memoryId, "memory-service", "encrypted memory anchor binds the target memory");
  equal(extractCoMemoryMemoryAnchor(normalized.request), "memory-service", "memory anchor is independently extractable");
  equal(normalized.requestSha256, await cryptoProtocol.digestRequestPayload(contract.request),
    "service remeasures request SHA-256 with the shared crypto contract");
  equal(normalized.response.requestSha256, normalized.requestSha256, "response is bound to the measured request digest");
  equal(normalized.response.letterId, normalized.request.letterId, "response is bound to the request letter ID");
  equal(normalized.identityAssurance, "self-asserted-unverified", "identity assurance remains self-asserted and unverified");
  equal(normalized.identityVerified, false, "service cannot promote identity to verified");
  equal(normalized.encrypted, true, "record preserves encrypted transport assertion");
  equal(normalized.signed, false, "record preserves unsigned assertion");
  equal(normalized.confirmation, CO_MEMORY_RESPONSE_CONFIRMATION, "record marks explicit unverified confirmation");
  ok(normalized.sourceKey.startsWith("co-memory-response-source:"), "source has a content-addressed source key");
  ok(normalized.anchorKey.startsWith("co-memory-response-anchor:"), "source has a request/response-bound anchor key");
  ok(/^[a-f0-9]{64}$/u.test(normalized.snapshotSha256), "source snapshot has a deterministic digest");
  ok(Object.isFrozen(normalized.response.identity), "normalized nested response is immutable");
  ok(/^[a-f0-9]{64}$/u.test(mutationSha256(normalized)), "idempotency mutation fingerprint is deterministic");

  const stored = validateStoredCoMemoryResponse({
    ...normalized,
    id: "record-service-1",
    createdAt: "2026-07-19T13:00:00.000Z"
  });
  equal(stored.excerpt, contract.response.answer, "stored record retains the confirmed answer as an independent excerpt");
  const source = toCoMemoryResponseSource(stored);
  equal(source.kind, CO_MEMORY_RESPONSE_KIND, "source projection uses only the independent co-memory kind");
  equal(source.referenceId, stored.id, "source projection has a stable record reference");
  equal(source.locator.identityVerified, false, "source projection repeats the identity boundary");
  equal(source.locator.encrypted, true, "source projection exposes encrypted transport metadata");
  equal(source.locator.signed, false, "source projection exposes unsigned metadata");
  equal(source.excerpt, stored.excerpt, "source projection does not invent or summarize answer text");

  await rejectsCode(() => validateCoMemoryResponseConfirmation({ ...contract, confirm: false }),
    "CO_MEMORY_CONFIRMATION_REQUIRED", "saving requires explicit confirm true");
  await rejectsCode(() => validateCoMemoryResponseConfirmation({ ...contract, extra: true }),
    "CO_MEMORY_CONFIRMATION_INVALID", "root contract rejects extra fields");
  await rejectsCode(() => validateCoMemoryResponseConfirmation({ ...contract, memoryId: "bad/id" }),
    "CO_MEMORY_MEMORY_ID_INVALID", "target memory ID is strict");
  await rejectsCode(() => validateCoMemoryResponseConfirmation({ ...contract, requestSha256: "A".repeat(64) }),
    "CO_MEMORY_HASH_INVALID", "request digest must be lowercase canonical SHA-256");

  const tamperedRequest = clone(contract);
  tamperedRequest.request.question = "被替换的问题";
  await rejectsCode(() => validateCoMemoryResponseConfirmation(tamperedRequest),
    "CO_MEMORY_REQUEST_BINDING_INVALID", "service rejects a request changed after digesting");
  const wrongResponseDigest = clone(contract);
  wrongResponseDigest.response.requestSha256 = "f".repeat(64);
  await rejectsCode(() => validateCoMemoryResponseConfirmation(wrongResponseDigest),
    "CO_MEMORY_REQUEST_BINDING_INVALID", "response cannot point at another request digest");
  const wrongLetter = clone(contract);
  wrongLetter.response.letterId = "letter_wrong0000000001";
  await rejectsCode(() => validateCoMemoryResponseConfirmation(wrongLetter),
    "CO_MEMORY_LETTER_BINDING_INVALID", "response cannot point at another letter ID");
  const wrongMemory = clone(contract);
  wrongMemory.memoryId = "memory-other";
  await rejectsCode(() => validateCoMemoryResponseConfirmation(wrongMemory),
    "CO_MEMORY_MEMORY_BINDING_INVALID", "request anchor cannot be confirmed onto another memory");
  const missingAnchor = await makeContract({ suffix: "noanchor000000001", memoryId: "memory-service", includeAnchor: false });
  await rejectsCode(() => validateCoMemoryResponseConfirmation(missingAnchor),
    "CO_MEMORY_MEMORY_BINDING_INVALID", "request without encrypted memory anchor cannot be saved");

  for (const [field, value, message] of [
    ["kind", "oral_history_excerpt", "source cannot masquerade as oral history"],
    ["relationKind", "supports", "source cannot claim stronger support relation"],
    ["label", "伪造署名", "source label must match self-asserted response label"],
    ["excerpt", "改写后的回答", "source excerpt must remain verbatim"],
    ["identityAssurance", "verified", "source cannot upgrade identity assurance"],
    ["identityVerified", true, "source cannot claim verified identity"],
    ["encrypted", false, "source must preserve encrypted transport assertion"],
    ["signed", true, "source cannot claim a digital signature"]
  ]) {
    const changed = clone(contract);
    changed.source[field] = value;
    await rejectsCode(() => validateCoMemoryResponseConfirmation(changed),
      "CO_MEMORY_SOURCE_BOUNDARY_INVALID", message);
  }
  const extraSource = clone(contract);
  extraSource.source.confidence = 1;
  await rejectsCode(() => validateCoMemoryResponseConfirmation(extraSource),
    "CO_MEMORY_SOURCE_INVALID", "source contract rejects confidence or truth scores");
  const verifiedIdentity = clone(contract);
  verifiedIdentity.response.identity.verified = true;
  verifiedIdentity.source.identityVerified = true;
  await rejectsCode(() => validateCoMemoryResponseConfirmation(verifiedIdentity),
    "CO_MEMORY_RESPONSE_INVALID", "shared crypto validator rejects verified identity payloads");
  const extraRequest = clone(contract);
  extraRequest.request.context.relationship = "friend";
  await rejectsCode(() => validateCoMemoryResponseConfirmation(extraRequest),
    "CO_MEMORY_REQUEST_INVALID", "shared crypto validator rejects inferred relationship fields");
  const extraResponse = clone(contract);
  extraResponse.response.emotion = "nostalgic";
  await rejectsCode(() => validateCoMemoryResponseConfirmation(extraResponse),
    "CO_MEMORY_RESPONSE_INVALID", "shared crypto validator rejects inferred emotion fields");

  const changedSelection = {
    kind: source.kind,
    referenceId: source.referenceId,
    sourceKey: source.sourceKey,
    anchorKey: source.anchorKey,
    snapshotSha256: "0".repeat(64)
  };
  equal(resolveCoMemoryResponseSource([stored], stored.memoryId, changedSelection).status, "source_changed",
    "catalog resolver marks a changed source snapshot for review");
  equal(resolveCoMemoryResponseSource([], stored.memoryId, { ...changedSelection, snapshotSha256: source.snapshotSha256 }).status,
    "missing", "catalog resolver reports deleted records as missing");
}

async function checkDatabaseAndSources() {
  const fixture = createFixture("database");
  try {
    deepEqual(listAppliedMigrations(fixture.db).map((entry) => entry.version),
      Array.from({ length: 14 }, (_, index) => index + 4), "migration ledger advances continuously through schema 17");
    equal(readUserVersion(fixture.db), 17, "schema 17 becomes SQLite user_version");
    equal(CO_MEMORY_RESPONSE_MIGRATION.version, 17, "migration declares schema 17");
    const ledger = JSON.stringify(listAppliedMigrations(fixture.db));
    initializeCoMemoryResponseDatabase({
      db: fixture.db,
      schemaVersion: 17,
      now: () => fixture.clock.value,
      createId: fixture.createId
    });
    equal(JSON.stringify(listAppliedMigrations(fixture.db)), ledger, "reinitialization verifies without rewriting migration ledger");

    fixture.insertMemory("memory-a");
    fixture.insertMemory("memory-b");
    const firstContract = await makeContract({ suffix: "database0000001", memoryId: "memory-a" });
    const created = await fixture.store.confirmCoMemoryResponse(firstContract, { idempotencyKey: "confirm-response-0001" });
    ok(created.created && !created.idempotent, "first explicit confirmation creates one source record");
    equal(created.record.kind, "co_memory_response", "database record kind is isolated");
    equal(created.record.memoryId, "memory-a", "database record attaches only to the bound memory");
    equal(created.record.identityVerified, false, "database record cannot claim verified identity");
    equal(created.record.encrypted, true, "database record retains encrypted transport boundary");
    equal(created.record.signed, false, "database record retains unsigned boundary");
    ok(Object.isFrozen(created.record.request.context), "database returns deeply read-only records");
    equal(fixture.db.prepare("SELECT raw_content FROM memories WHERE id = ?").get("memory-a").raw_content,
      "Original memory remains unchanged.", "confirmation does not rewrite the original memory");
    deepEqual(tableCounts(fixture.db), { responses: 1, oralHistoryTables: 0 },
      "confirmation writes one independent row and creates no oral-history tables");
    equal(fixture.db.prepare("SELECT kind FROM co_memory_responses").get().kind, "co_memory_response",
      "SQL check preserves independent source kind");

    const replay = await fixture.store.confirmCoMemoryResponse(firstContract, { idempotencyKey: "confirm-response-0001" });
    ok(!replay.created && replay.idempotent, "same Idempotency-Key and payload replays safely");
    equal(replay.record.id, created.record.id, "idempotent replay returns the original read-only record");
    equal(tableCounts(fixture.db).responses, 1, "idempotent replay creates no duplicate or tombstone row");

    const otherContract = await makeContract({ suffix: "database0000002", memoryId: "memory-b" });
    await rejectsCode(() => fixture.store.confirmCoMemoryResponse(otherContract, { idempotencyKey: "confirm-response-0001" }),
      "CO_MEMORY_IDEMPOTENCY_CONFLICT", "Idempotency-Key cannot be reused for another response");
    await rejectsCode(() => fixture.store.confirmCoMemoryResponse(firstContract, { idempotencyKey: "confirm-response-0002" }),
      "CO_MEMORY_DUPLICATE_REQUEST", "same request with a new key is rejected rather than duplicated");

    const sameLetter = await makeContract({ suffix: "database0000001", memoryId: "memory-a", question: "同一信笺被篡改后的问题" });
    await rejectsCode(() => fixture.store.confirmCoMemoryResponse(sameLetter, { idempotencyKey: "confirm-response-0003" }),
      "CO_MEMORY_DUPLICATE_REQUEST", "same letter ID cannot be reused with changed request content");
    const duplicateResponseId = await makeContract({
      suffix: "database0000003",
      responseId: firstContract.response.responseId,
      memoryId: "memory-b"
    });
    await rejectsCode(() => fixture.store.confirmCoMemoryResponse(duplicateResponseId, { idempotencyKey: "confirm-response-0004" }),
      "CO_MEMORY_DUPLICATE_RESPONSE", "response ID cannot be replayed against another request");
    const missingMemory = await makeContract({ suffix: "database0000004", memoryId: "missing-memory" });
    await rejectsCode(() => fixture.store.confirmCoMemoryResponse(missingMemory, { idempotencyKey: "confirm-response-0005" }),
      "CO_MEMORY_MEMORY_NOT_FOUND", "confirmation cannot create or infer a missing memory");
    await rejectsCode(() => fixture.store.confirmCoMemoryResponse(otherContract, { idempotencyKey: "short" }),
      "CO_MEMORY_IDEMPOTENCY_KEY_INVALID", "database requires a bounded Idempotency-Key");

    fixture.clock.value = "2026-07-19T13:01:00.000Z";
    const second = await fixture.store.confirmCoMemoryResponse(otherContract, { idempotencyKey: "confirm-response-0006" });
    equal(second.record.memoryId, "memory-b", "second valid invitation remains independent");
    equal(fixture.store.getCoMemoryResponse(created.record.id).responseId, created.record.responseId,
      "record can be retrieved read-only by ID");
    equal(fixture.store.listCoMemoryResponses({ memoryId: "memory-a" }).length, 1,
      "memory-scoped list does not cross museum boundaries");
    equal(fixture.store.listCoMemoryResponses().length, 2, "bounded internal list returns both records");
    deepEqual(fixture.store.getCoMemoryResponseStats(), {
      responses: 2,
      memories: 2,
      unverifiedIdentity: 2,
      encryptedTransport: 2,
      unsigned: 2
    }, "stats state every response is encrypted transport, unsigned and identity-unverified");

    const sources = fixture.store.listCoMemoryResponseSources("memory-a");
    equal(sources.length, 1, "source catalog adapter lists one source for the bound memory");
    equal(sources[0].excerpt, firstContract.response.answer, "source catalog uses verbatim answer text");
    equal(fixture.store.getCoMemoryResponseSource(created.record.id).sourceKey, sources[0].sourceKey,
      "source catalog adapter gets a source by stable reference");
    const selection = {
      kind: sources[0].kind,
      referenceId: sources[0].referenceId,
      sourceKey: sources[0].sourceKey,
      anchorKey: sources[0].anchorKey,
      snapshotSha256: sources[0].snapshotSha256
    };
    equal(fixture.store.resolveCoMemoryResponseSource("memory-a", selection).status, "resolved",
      "source catalog resolves the unchanged independent response");
    equal(fixture.store.resolveCoMemoryResponseSource("memory-b", selection).status, "missing",
      "source catalog cannot rebind a response to another memory");
    equal(fixture.store.resolveCoMemoryResponseSource("memory-a", { ...selection, sourceKey: `co-memory-response-source:${"0".repeat(64)}` }).status,
      "source_changed", "source catalog detects a stale content identity");

    const full = fixture.store.buildCoMemoryResponseBackup("full", ["memory-a", "memory-b"]);
    ok(fixture.store.validateCoMemoryResponseBackup(full, ["memory-a", "memory-b"]),
      "full co-memory response backup validates strictly");
    equal(full.schemaVersion, 17, "full backup declares schema 17");
    equal(full.kind, "co_memory_response", "full backup cannot be mistaken for a provenance claim section");
    equal(full.responses.length, 2, "full backup retains both independent response records");
    ok(!JSON.stringify(full).includes("confirm-response-0001"), "full backup excludes local idempotency namespace");
    const filtered = fixture.store.buildCoMemoryResponseBackup("full", ["memory-a"]);
    deepEqual(filtered.responses.map((record) => record.memoryId), ["memory-a"],
      "backup builder honors selected memory boundary");
    const redacted = fixture.store.buildCoMemoryResponseBackup("redacted", ["memory-a", "memory-b"]);
    deepEqual(Object.keys(redacted).sort(), [
      "mode", "responseCount", "unverifiedIdentityCount", "encryptedTransportCount", "unsignedCount", "note"
    ].sort(), "redacted backup exposes only fixed counters and note");
    equal(redacted.responseCount, 2, "redacted backup counts responses");
    equal(redacted.note, CO_MEMORY_RESPONSE_REDACTED_NOTE, "redacted backup uses fixed privacy explanation");
    ok(validateCoMemoryResponseBackupPayload(redacted), "redacted backup validates independently");
    const redactedJson = JSON.stringify(redacted);
    ok(!/memory-a|letter_|response_|requestSha256|sourceKey|anchorKey|旧礼堂|一位回信人|等雨小一点/u.test(redactedJson),
      "redacted backup physically excludes IDs, content and hashes");

    rejectBackupMutation(full, (copy) => { copy.extra = true; }, "full backup rejects unknown root fields");
    rejectBackupMutation(full, (copy) => { copy.schemaVersion = 18; }, "full backup rejects future schema");
    rejectBackupMutation(full, (copy) => { copy.kind = "oral_history_excerpt"; }, "full backup rejects a masquerading kind");
    rejectBackupMutation(full, (copy) => { copy.responses[0].excerpt += "篡改"; }, "full backup rejects answer tampering");
    rejectBackupMutation(full, (copy) => { copy.responses[0].request.question += "篡改"; }, "full backup rejects request tampering");
    rejectBackupMutation(full, (copy) => { copy.responses[0].response.requestSha256 = "0".repeat(64); },
      "full backup rejects response/request rebinding");
    rejectBackupMutation(full, (copy) => { copy.responses[0].identityVerified = true; },
      "full backup rejects verified-identity claims");
    rejectBackupMutation(full, (copy) => { copy.responses[0].signed = true; },
      "full backup rejects signature claims");
    rejectBackupMutation(full, (copy) => { copy.responses.push(clone(copy.responses[0])); },
      "full backup rejects duplicate response identities");
    rejectBackupMutation(full, (copy) => { copy.responses.reverse(); }, "full backup requires canonical order");
    rejectBackupMutation(full, (copy) => { copy.responses[0].response.answer = "x".repeat(MAX_CO_MEMORY_RESPONSE_BACKUP_BYTES); },
      "full backup rejects payloads that cannot fit the archive section budget");
    throwsCode(() => validateCoMemoryResponseBackupPayload(full, { memoryIds: ["memory-a"] }),
      "CO_MEMORY_RESPONSE_BACKUP_REFERENCE_INVALID", "backup validator enforces selected memory boundary");
    const changedRedacted = clone(redacted);
    changedRedacted.unsignedCount = 1;
    throwsCode(() => validateCoMemoryResponseBackupPayload(changedRedacted), "CO_MEMORY_RESPONSE_BACKUP_INVALID",
      "redacted backup counters must remain internally consistent");

    assert.throws(() => fixture.db.prepare("UPDATE co_memory_responses SET label = 'tamper' WHERE id = ?").run(created.record.id),
      /CO_MEMORY_RESPONSE_IMMUTABLE/u, "saved response rows are immutable");
    assertions += 1;
    fixture.db.prepare("DELETE FROM memories WHERE id = ?").run("memory-a");
    equal(fixture.store.getCoMemoryResponse(created.record.id), null,
      "deleting the target memory cascades the independent source record instead of orphan-rebinding it");
    equal(fixture.store.resolveCoMemoryResponseSource("memory-a", selection).status, "missing",
      "deleted source resolves as missing for later source-catalog review");
    equal(fixture.store.listCoMemoryResponses().length, 1, "deleting one memory leaves unrelated response sources intact");
  } finally {
    fixture.close();
  }
}

async function checkApiBoundary() {
  const fixture = createFixture("api");
  try {
    fixture.insertMemory("memory-api");
    const contract = await makeContract({ suffix: "api0000000000001", memoryId: "memory-api" });
    let bodyReads = 0;
    let maximumBodyBytes = 0;
    const dependencies = {
      store: fixture.store,
      readJsonBody: async (request, maximum) => {
        bodyReads += 1;
        maximumBodyBytes = maximum;
        return request.body;
      },
      sendJson: (response, statusCode, payload) => {
        response.statusCode = statusCode;
        response.payload = payload;
        return payload;
      },
      httpError: (statusCode, message) => Object.assign(new Error(message), { statusCode })
    };
    const api = createCoMemoryResponseApi(dependencies);
    const response = responseMock();
    await api.handle({
      method: "POST",
      headers: { "idempotency-key": "api-confirm-0001" },
      body: contract
    }, response, new URL("http://local/api/co-memory-responses/confirm"));
    equal(response.statusCode, 201, "confirmation API creates an independent source with HTTP 201");
    equal(response.payload.record.kind, "co_memory_response", "API returns the independent source kind");
    equal(response.payload.record.identityVerified, false, "API record cannot overstate identity");
    equal(response.payload.record.boundary.includes("不会创建口述史"), true,
      "API record explains that no oral history is created");
    equal(bodyReads, 1, "local confirmation reads one JSON body");
    equal(maximumBodyBytes, 900 * 1024, "API applies a bounded confirmation body budget");
    ok(response.headers.ETag.includes(response.payload.record.snapshotSha256), "immutable record ETag binds the source snapshot");

    const replayResponse = responseMock();
    await api.handle({
      method: "POST",
      headers: { "idempotency-key": "api-confirm-0001" },
      body: contract
    }, replayResponse, new URL("http://local/api/co-memory-responses/confirm"));
    equal(replayResponse.statusCode, 200, "idempotent API replay returns HTTP 200");
    equal(replayResponse.payload.idempotent, true, "API exposes exact idempotent replay");

    const listResponse = responseMock();
    await api.handle({ method: "GET", headers: {} }, listResponse,
      new URL("http://local/api/co-memory-responses?memoryId=memory-api"));
    equal(listResponse.payload.records.length, 1, "read API lists responses only for an explicit memory");
    equal(listResponse.payload.identityBoundary, "self-asserted-unverified", "list API repeats identity boundary");
    const itemResponse = responseMock();
    await api.handle({ method: "GET", headers: {} }, itemResponse,
      new URL(`http://local/api/co-memory-responses/${response.payload.record.id}`));
    equal(itemResponse.payload.record.responseId, contract.response.responseId, "read API returns saved immutable record");

    const second = await makeContract({ suffix: "api0000000000002", memoryId: "memory-api" });
    fixture.clock.value = "2026-07-19T14:01:00.000Z";
    const direct = await api.confirmResponse(second, { idempotencyKey: "api-confirm-0002" });
    equal(direct.responseId, second.response.responseId, "host confirmResponse callback returns the saved record directly");
    ok(Object.isFrozen(direct.response), "host confirmResponse result is deeply read-only");
    const publicProjection = readOnlyRecord(fixture.store.getCoMemoryResponse(response.payload.record.id));
    ok(!Object.hasOwn(publicProjection, "idempotencyKey"), "read-only API record excludes idempotency storage fields");

    const invalidKeyResponse = responseMock();
    const readsBeforeInvalidKey = bodyReads;
    await rejectsCode(() => api.handle({ method: "POST", headers: {}, body: contract }, invalidKeyResponse,
      new URL("http://local/api/co-memory-responses/confirm")), "CO_MEMORY_IDEMPOTENCY_KEY_INVALID",
    "missing Idempotency-Key is rejected");
    equal(bodyReads, readsBeforeInvalidKey, "invalid Idempotency-Key is rejected before body reading");
    await rejectsCode(() => api.handle({ method: "GET", headers: {} }, responseMock(),
      new URL("http://local/api/co-memory-responses")), "CO_MEMORY_QUERY_INVALID",
    "list API requires one explicit memoryId");
    await rejectsCode(() => api.handle({ method: "PUT", headers: {} }, responseMock(),
      new URL("http://local/api/co-memory-responses/anything")), "CO_MEMORY_METHOD_NOT_ALLOWED",
    "unsupported write methods are rejected");
    equal(await api.handle({ method: "GET", headers: {} }, responseMock(), new URL("http://local/api/other")), false,
      "API ignores routes outside its namespace");

    let demoBodyReads = 0;
    let demoStoreWrites = 0;
    const demoStore = {
      confirmCoMemoryResponse: async () => { demoStoreWrites += 1; throw new Error("must not run"); },
      getCoMemoryResponse: () => null,
      listCoMemoryResponses: () => []
    };
    const demoApi = createCoMemoryResponseApi({
      ...dependencies,
      store: demoStore,
      interviewDemo: true,
      readJsonBody: async () => { demoBodyReads += 1; return contract; }
    });
    const demoResponse = responseMock();
    await demoApi.handle({ method: "POST", headers: {}, body: contract }, demoResponse,
      new URL("http://local/api/co-memory-responses/confirm"));
    equal(demoResponse.statusCode, 403, "public demo blocks save with HTTP 403");
    equal(demoResponse.payload.code, "CO_MEMORY_DEMO_READ_ONLY", "public demo uses a stable read-only code");
    equal(demoBodyReads, 0, "public demo rejects before reading any request body");
    equal(demoStoreWrites, 0, "public demo performs zero persistence calls");
    await rejectsCode(() => demoApi.confirmResponse(contract, { idempotencyKey: "api-demo-0001" }),
      "CO_MEMORY_DEMO_READ_ONLY", "host callback is also read-only in public demo");
    equal(demoStoreWrites, 0, "demo host callback performs zero persistence calls");

    const controller = new AbortController();
    controller.abort();
    const beforeAbortCount = fixture.store.listCoMemoryResponses().length;
    await rejectsName(() => api.confirmResponse(second, {
      idempotencyKey: "api-abort-0001",
      signal: controller.signal
    }), "AbortError", "aborted host confirmation stops before persistence");
    equal(fixture.store.listCoMemoryResponses().length, beforeAbortCount, "aborted host confirmation creates no record");
  } finally {
    fixture.close();
  }
}

async function checkRestoreBoundary() {
  const source = createFixture("restore-source");
  const target = createFixture("restore-target");
  const rebound = createFixture("restore-rebound");
  const collision = createFixture("restore-collision");
  try {
    for (const fixture of [source, target, rebound, collision]) {
      fixture.insertMemory("memory-a");
      fixture.insertMemory("memory-b");
    }
    const firstContract = await makeContract({ suffix: "restore000000001", memoryId: "memory-a" });
    const secondContract = await makeContract({ suffix: "restore000000002", memoryId: "memory-b" });
    await source.store.confirmCoMemoryResponse(firstContract, { idempotencyKey: "restore-source-0001" });
    source.clock.value = "2026-07-19T15:01:00.000Z";
    await source.store.confirmCoMemoryResponse(secondContract, { idempotencyKey: "restore-source-0002" });
    const full = source.store.buildCoMemoryResponseBackup("full", ["memory-a", "memory-b"]);
    const redacted = source.store.buildCoMemoryResponseBackup("redacted", ["memory-a", "memory-b"]);

    const restored = target.store.restoreCoMemoryResponseBackup(full, {
      memoryIdMap: new Map([["memory-a", "memory-a"], ["memory-b", "memory-b"]])
    });
    equal(restored.responses, 2, "restore writes every verified response into its original memory identity");
    equal(restored.reused, 0, "first restore does not report reused responses");
    deepEqual(restored.idMap.responses, Object.fromEntries(full.responses.map((record) => [record.id, record.id])),
      "restore preserves response record IDs so provenance references stay immutable");
    deepEqual(target.store.buildCoMemoryResponseBackup("full", ["memory-a", "memory-b"]), full,
      "restore preserves request, response, hashes, timestamps and identity boundaries byte-for-byte");

    const replay = target.store.restoreCoMemoryResponseBackup(full, {
      memoryIdMap: { "memory-a": "memory-a", "memory-b": "memory-b" }
    });
    equal(replay.responses, 2, "an exact restore replay accounts for all source responses");
    equal(replay.reused, 2, "an exact restore replay reuses immutable identity-equal records");
    equal(target.store.listCoMemoryResponses().length, 2, "restore replay creates no duplicate or tombstone rows");

    const summary = target.store.restoreCoMemoryResponseBackup(redacted, { memoryIdMap: {} });
    ok(summary.summarized && summary.responses === 0, "redacted restore remains a zero-write statistical summary");

    throwsCode(() => rebound.store.restoreCoMemoryResponseBackup(full, {
      memoryIdMap: new Map([["memory-a", "memory-a-copy"], ["memory-b", "memory-b"]])
    }), "CO_MEMORY_RESTORE_MEMORY_REBIND_FORBIDDEN",
    "encrypted memory anchors reject any attempt to remap a response to a conflict copy");
    equal(rebound.store.listCoMemoryResponses().length, 0,
      "memory-ID rebind failure rejects the whole package before writing any response");

    await collision.store.confirmCoMemoryResponse(firstContract, { idempotencyKey: "restore-local-0001" });
    const beforeCollision = collision.store.listCoMemoryResponses().length;
    throwsCode(() => collision.store.restoreCoMemoryResponseBackup(full, {
      memoryIdMap: { "memory-a": "memory-a", "memory-b": "memory-b" }
    }), "CO_MEMORY_RESTORE_IDENTITY_CONFLICT",
    "existing response identity under another record ID cannot be silently remapped");
    equal(collision.store.listCoMemoryResponses().length, beforeCollision,
      "response identity collision leaves the complete target package unchanged");

    const cleared = target.store.clearCoMemoryResponses();
    equal(cleared.coMemoryResponsesDeleted, 2, "purge hook reports deleted co-memory response rows");
    equal(target.store.listCoMemoryResponses().length, 0, "purge hook removes all independent response sources");
  } finally {
    source.close();
    target.close();
    rebound.close();
    collision.close();
  }
}

function createFixture(suffix) {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE memories (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      raw_content TEXT NOT NULL DEFAULT ''
    );
  `);
  const clock = { value: "2026-07-19T13:00:00.000Z" };
  applyMigrations({
    db,
    baselineVersion: 4,
    migrations: PREVIOUS_MIGRATIONS,
    supportedVersion: 16,
    now: () => "2026-07-19T12:00:00.000Z"
  });
  let id = 0;
  const createId = () => `co-memory-${suffix}-${++id}`;
  const store = initializeCoMemoryResponseDatabase({
    db,
    schemaVersion: 17,
    now: () => clock.value,
    createId
  });
  return {
    db,
    clock,
    createId,
    store,
    insertMemory(memoryId) {
      db.prepare("INSERT INTO memories (id, title, raw_content) VALUES (?, ?, ?)")
        .run(memoryId, `Memory ${memoryId}`, "Original memory remains unchanged.");
    },
    close() { db.close(); }
  };
}

async function makeContract(options = {}) {
  const suffix = String(options.suffix || "default000000001").replace(/[^A-Za-z0-9]/gu, "").padEnd(16, "0").slice(0, 24);
  const memoryId = options.memoryId || "memory-a";
  const letterId = options.letterId || `letter_${suffix}`;
  const responseId = options.responseId || `response_${suffix}`;
  const note = options.includeAnchor === false
    ? "只回答自己亲自记得的部分。"
    : `[time-isle-memory-anchor:v1:${memoryId}]\n只回答自己亲自记得的部分。`;
  const request = cryptoProtocol.validateRequestPayload({
    format: cryptoProtocol.REQUEST_FORMAT,
    version: cryptoProtocol.VERSION,
    letterId,
    question: options.question || "你还记得我们为什么在旧礼堂门口停留吗？",
    context: {
      title: "旧礼堂旁的合照",
      note,
      evidence: [{ key: "evidence-1", kind: "quote", text: "散场以后，我们在门口又站了很久。" }]
    },
    boundary: cryptoProtocol.REQUEST_BOUNDARY
  });
  const requestSha256 = await cryptoProtocol.digestRequestPayload(request);
  const response = cryptoProtocol.validateResponsePayload({
    format: cryptoProtocol.RESPONSE_FORMAT,
    version: cryptoProtocol.VERSION,
    letterId,
    responseId,
    requestSha256,
    identity: {
      label: options.identityLabel === undefined ? "一位回信人（自述）" : options.identityLabel,
      assurance: cryptoProtocol.IDENTITY_ASSURANCE,
      verified: false
    },
    answer: options.answer || "我记得当时是在等雨小一点；具体日期我仍不确定。",
    boundary: cryptoProtocol.RESPONSE_BOUNDARY
  });
  return {
    confirm: true,
    memoryId,
    requestSha256,
    request,
    response,
    source: {
      kind: "co_memory_response",
      relationKind: "supplements",
      label: response.identity.label || "未署名共忆回信",
      excerpt: response.answer,
      identityAssurance: "self-asserted-unverified",
      identityVerified: false,
      encrypted: true,
      signed: false
    }
  };
}

function tableCounts(db) {
  return {
    responses: Number(db.prepare("SELECT COUNT(*) AS count FROM co_memory_responses").get().count),
    oralHistoryTables: Number(db.prepare(`
      SELECT COUNT(*) AS count FROM sqlite_master
      WHERE type = 'table' AND name LIKE 'oral_history%'
    `).get().count)
  };
}

function rejectBackupMutation(backup, mutate, message) {
  const copy = clone(backup);
  mutate(copy);
  throwsCode(() => validateCoMemoryResponseBackupPayload(copy), null, message);
}

function responseMock() {
  return {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; }
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function ok(value, message) {
  assert.ok(value, message);
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

function throwsCode(operation, expectedCode, message) {
  let error = null;
  try { operation(); }
  catch (caught) { error = caught; }
  if (expectedCode === null) assert.ok(error?.code, message);
  else assert.equal(error?.code, expectedCode, message);
  assertions += 1;
}

async function rejectsCode(operation, expectedCode, message) {
  let error = null;
  try { await operation(); }
  catch (caught) { error = caught; }
  assert.equal(error?.code, expectedCode, message);
  assertions += 1;
}

async function rejectsName(operation, expectedName, message) {
  let error = null;
  try { await operation(); }
  catch (caught) { error = caught; }
  assert.equal(error?.name, expectedName, message);
  assertions += 1;
}
