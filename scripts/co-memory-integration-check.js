"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { createMemoryStore } = require("../database");
const cryptoProtocol = require("../public/assets/co-memory-crypto.js");
const { catalogSourceToClaimSource } = require("../lib/provenance-service");
const { listAppliedMigrations, readUserVersion } = require("../lib/migrations");

let assertions = 0;

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});

async function main() {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "time-isle-co-memory-integration-"));
  const dbPath = path.join(temporaryRoot, "museum.sqlite");
  let store = null;
  try {
    store = createMemoryStore({
      dbPath,
      halls: [{ id: "daily", name: "日常展厅", description: "" }],
      schemaVersion: 18
    });
    const memory = createMemory();
    store.saveMemory(memory);
    const beforeText = store.getMemory(memory.id).rawContent;
    const contract = await createContract(memory.id);
    const response = await store.confirmCoMemoryResponse(contract, {
      idempotencyKey: `co-memory-confirm:${contract.requestSha256}`
    });
    ok(response.created, "schema 18 store saves an explicitly confirmed co-memory response");
    equal(store.getMemory(memory.id).rawContent, beforeText, "saving a response does not rewrite the original memory");

    const sources = store.listProvenanceSources(memory.id);
    const candidate = sources.find((source) => source.kind === "co_memory_response");
    ok(candidate, "schema 18 source catalog exposes the saved co-memory response");
    equal(candidate.confirmation, "user_confirmed_unverified", "catalog keeps the identity-unverified confirmation boundary");
    equal(candidate.excerpt, contract.response.answer, "catalog keeps the verbatim confirmed answer");
    deepEqual(Object.keys(candidate.locator).sort(), ["answerLength", "responseId"],
      "catalog locator contains no inferred person, date, relationship or emotion");

    const claimSource = catalogSourceToClaimSource(candidate, {
      relationKind: "supplements",
      sensitive: false
    });
    equal(claimSource.relationKind, "supplements", "co-memory evidence can only supplement the human claim in this flow");
    const draft = store.createProvenanceClaim({
      memoryId: memory.id,
      statement: "对方自述记得那天有一把蓝色的伞。",
      sources: [claimSource]
    }, { idempotencyKey: "co-memory-integration-claim-create" });
    equal(draft.claim.status, "draft", "binding a response first creates only a human claim draft");
    const confirmed = store.confirmProvenanceClaim(draft.claim.id, {
      confirm: true,
      expectedVersion: draft.claim.version,
      idempotencyKey: "co-memory-integration-claim-confirm"
    });
    equal(confirmed.claim.status, "confirmed", "the claim becomes confirmed only after a separate human decision");
    equal(confirmed.claim.sources[0].sourceKind, "co_memory_response", "confirmed claim retains the independent source kind");
    equal(confirmed.claim.sources[0].snapshot.metadata.confirmation, "user_confirmed_unverified",
      "confirmed claim still states that the respondent identity is unverified");

    const projection = store.listConfirmedProvenanceForAgent([memory.id])[memory.id];
    equal(projection.claims.length, 1, "Agent read-only evidence sees one current confirmed human claim");
    const projectedSource = projection.claims[0].sources[0];
    deepEqual({
      relationKind: projectedSource.relationKind,
      sourceKind: projectedSource.sourceKind,
      identityAssurance: projectedSource.identityAssurance,
      identityVerified: projectedSource.identityVerified,
      encrypted: projectedSource.encrypted,
      signed: projectedSource.signed
    }, {
      relationKind: "supplements",
      sourceKind: "co_memory_response",
      identityAssurance: "self-asserted-unverified",
      identityVerified: false,
      encrypted: true,
      signed: false
    }, "Agent projection cannot overstate identity or signature assurance");

    const health = store.runDatabaseHealthChecks();
    ok(health.checks.find((check) => check.code === "DATABASE_PROVENANCE_STRUCTURE")?.ok,
      "schema 18 provenance structure accepts the co-memory source kind");
    ok(health.checks.find((check) => check.code === "DATABASE_CO_MEMORY_RESPONSE_STRUCTURE")?.ok,
      "schema 18 health check validates co-memory rows with the canonical backup contract");
    equal(health.counts.coMemoryResponses, 1, "health snapshot reports one co-memory response without content");
    equal(health.counts.coMemoryUnverifiedIdentity, 1, "health snapshot reports the unverified identity boundary");

    const cleanup = store.clearCoMemoryResponses();
    equal(cleanup.coMemoryResponsesDeleted, 1, "source removal uses the permanent purge hook");
    const stale = store.getProvenanceClaim(draft.claim.id);
    ok(stale.needsReview && stale.status === "needsReview", "removed co-memory source moves the claim to needsReview");
    equal(store.listConfirmedProvenanceForAgent([memory.id])[memory.id].claims.length, 0,
      "Agent projection immediately excludes a claim whose response source is missing");
    equal(store.getMemory(memory.id).rawContent, beforeText, "source removal also leaves the original memory unchanged");

    store.close();
    store = null;
    const inspection = new DatabaseSync(dbPath, { readOnly: true });
    try {
      equal(readUserVersion(inspection), 18, "schema 18 becomes the durable SQLite user_version");
      deepEqual(listAppliedMigrations(inspection).slice(-3).map((entry) => entry.version), [16, 17, 18],
        "provenance, co-memory and extended-source migrations apply continuously before statements are prepared");
      const sourceSql = String(inspection.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'provenance_claim_sources'").get()?.sql || "");
      ok(sourceSql.includes("'co_memory_response'"), "durable provenance table includes the schema 18 source constraint");
    } finally {
      inspection.close();
    }
  } finally {
    try { store?.close(); } catch { /* keep the original failure */ }
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
  console.log(`Co-memory integration checks passed: ${assertions} assertions.`);
}

function createMemory() {
  const createdAt = "2026-07-19T16:00:00.000Z";
  return {
    schemaVersion: 18,
    id: "memory-co-memory-integration",
    title: "蓝伞下的回忆",
    hall: "daily",
    sourceType: "其他",
    rawContent: "我只记得那天雨很大，其它细节仍不确定。",
    exhibitText: "一段仍在等待外部见证的雨天回忆。",
    date: "",
    location: "",
    people: [],
    tags: ["雨天"],
    emotions: [],
    emotionIntensity: 3,
    importance: 3,
    favorite: false,
    coverImage: "",
    mediaNote: "",
    attachments: [],
    agentRunId: "",
    createdAt,
    updatedAt: createdAt
  };
}

async function createContract(memoryId) {
  const letterId = "letter_integration_000001";
  const request = cryptoProtocol.validateRequestPayload({
    format: cryptoProtocol.REQUEST_FORMAT,
    version: cryptoProtocol.VERSION,
    letterId,
    question: "你还记得那天我们拿的伞是什么颜色吗？",
    context: {
      title: "",
      note: `[time-isle-memory-anchor:v1:${memoryId}]\n只回答你亲自记得的部分。`,
      evidence: [{ key: "evidence-1", kind: "quote", text: "我只记得那天雨很大。" }]
    },
    boundary: cryptoProtocol.REQUEST_BOUNDARY
  });
  const requestSha256 = await cryptoProtocol.digestRequestPayload(request);
  const response = cryptoProtocol.validateResponsePayload({
    format: cryptoProtocol.RESPONSE_FORMAT,
    version: cryptoProtocol.VERSION,
    letterId,
    responseId: "response_integration_0001",
    requestSha256,
    identity: {
      label: "一位回信人（自述）",
      assurance: cryptoProtocol.IDENTITY_ASSURANCE,
      verified: false
    },
    answer: "我自己记得那天是一把蓝色的伞，但日期仍不确定。",
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
      label: response.identity.label,
      excerpt: response.answer,
      identityAssurance: cryptoProtocol.IDENTITY_ASSURANCE,
      identityVerified: false,
      encrypted: true,
      signed: false
    }
  };
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
