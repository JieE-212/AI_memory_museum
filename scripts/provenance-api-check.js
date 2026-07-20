"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createMemoryStore } = require("../database");
const { createProvenanceApi } = require("../lib/provenance-api");

const dbPath = path.join(os.tmpdir(), `time-isle-provenance-api-${process.pid}-${Date.now()}.sqlite`);
let store;
let assertions = 0;

function ok(value, message) {
  assertions += 1;
  assert.ok(value, message);
}

function equal(actual, expected, message) {
  assertions += 1;
  assert.equal(actual, expected, message);
}

async function main() {
  store = createMemoryStore({
    dbPath,
    schemaVersion: 16,
    halls: [{ id: "daily", name: "日常展厅", description: "测试" }]
  });
  let memory = store.saveMemory(memoryInput(), { requireNew: true });
  const api = apiFor(store);

  const sourceList = await call(api, "GET", `/api/provenance/memories/${memory.id}/sources`);
  equal(sourceList.status, 200, "source catalog is readable");
  equal(sourceList.payload.sources.length, 1, "plain memory exposes one explicit text source");
  const catalogSource = sourceList.payload.sources[0];
  equal(catalogSource.kind, "memory_text", "catalog source is typed");
  ok(!Object.hasOwn(catalogSource, "contentSha256"), "public catalog omits the raw content hash");

  const createBody = {
    confirm: true,
    statement: "原文写下了雨停后继续散步。",
    sources: [{
      relationKind: "supports",
      sourceKind: "memory_text",
      sourceKey: `memory:${memory.id}`,
      anchorKey: "",
      locator: { offsetUnit: "utf16-code-unit", startOffset: 0, endOffset: 9 },
      label: "当前展品逐字原文"
    }]
  };
  const created = await call(api, "POST", `/api/provenance/memories/${memory.id}/claims`, createBody, {
    "idempotency-key": "provenance-create-0001"
  });
  equal(created.status, 201, "manual claim is created as a new resource");
  equal(created.payload.claim.status, "draft", "creation only produces a draft");
  equal(store.getProvenanceStats().events, 1, "draft creation appends one immutable event");
  equal(created.payload.claim.sources[0].excerpt, memory.rawContent.slice(0, 9), "server resolves the exact live excerpt");

  const replay = await call(api, "POST", `/api/provenance/memories/${memory.id}/claims`, createBody, {
    "idempotency-key": "provenance-create-0001"
  });
  equal(replay.status, 200, "identical idempotent create is replayed");
  equal(store.getProvenanceStats().claims, 1, "idempotent replay creates no duplicate claim");

  const confirmed = await call(api, "POST", `/api/provenance/claims/${created.payload.claim.id}/confirm`, { confirm: true }, {
    "if-match": created.payload.claim.etag,
    "idempotency-key": "provenance-confirm-0001"
  });
  equal(confirmed.status, 200, "confirmation is a separate request");
  equal(confirmed.payload.claim.status, "confirmed", "claim becomes confirmed only after the decision");
  equal(store.getProvenanceStats().events, 2, "confirmation appends rather than mutates history");

  memory = store.saveMemory({ ...memory, rawContent: `后来补写：${memory.rawContent}` }, {
    requireExisting: true,
    expectedUpdatedAt: memory.updatedAt
  });
  const changedPassport = await call(api, "GET", `/api/provenance/memories/${memory.id}`);
  equal(changedPassport.payload.passport.claims[0].status, "needsReview", "changed live source marks a confirmed claim for review");
  equal(changedPassport.payload.passport.claims[0].needsReview, true, "review state is explicit");
  equal(memory.rawContent.startsWith("后来补写"), true, "source review does not overwrite the memory");

  const stale = await call(api, "POST", `/api/provenance/claims/${created.payload.claim.id}/withdraw`, { confirm: true }, {
    "if-match": confirmed.payload.claim.etag,
    "idempotency-key": "provenance-withdraw-stale"
  });
  equal(stale.status, 412, "freshness-changing source invalidates an old ETag");
  const currentClaim = store.getProvenanceClaim(created.payload.claim.id);
  const withdrawn = await call(api, "POST", `/api/provenance/claims/${created.payload.claim.id}/withdraw`, { confirm: true }, {
    "if-match": currentClaim.etag,
    "idempotency-key": "provenance-withdraw-0001"
  });
  equal(withdrawn.status, 200, "current claim can be explicitly withdrawn");
  equal(withdrawn.payload.claim.status, "withdrawn", "withdrawal remains visible in the ledger");
  equal(store.getProvenanceStats().events, 3, "withdrawal appends the final lifecycle event");

  const noQuery = await call(api, "GET", `/api/provenance/memories/${memory.id}?extra=1`);
  equal(noQuery.status, 400, "unexpected query parameters are rejected");
  const unknownField = await call(api, "POST", `/api/provenance/memories/${memory.id}/claims`, { ...createBody, invented: true }, {
    "idempotency-key": "provenance-create-bad1"
  });
  equal(unknownField.status, 400, "unknown create fields are rejected");

  let demoBodyReads = 0;
  const demoApi = apiFor(store, {
    interviewDemo: true,
    readJsonBody: async (request) => { demoBodyReads += 1; return request.body; }
  });
  const beforeDemo = store.getProvenanceStats();
  const demoMutation = await call(demoApi, "POST", `/api/provenance/memories/${memory.id}/claims`, createBody, {
    "idempotency-key": "provenance-demo-0001"
  });
  equal(demoMutation.status, 403, "Demo mutation is rejected");
  equal(demoBodyReads, 0, "Demo rejection happens before request body parsing");
  assert.deepEqual(store.getProvenanceStats(), beforeDemo, "Demo mutation writes nothing");
  assertions += 1;
  const demoPassport = await call(demoApi, "GET", `/api/provenance/memories/${memory.id}`);
  equal(demoPassport.payload.passport.synthetic, true, "Demo uses an explicitly synthetic passport");

  console.log(`Provenance API checks passed: ${assertions} assertions.`);
}

function apiFor(database, overrides = {}) {
  return createProvenanceApi({
    store: database,
    interviewDemo: Boolean(overrides.interviewDemo),
    readJsonBody: overrides.readJsonBody || (async (request) => request.body),
    sendJson(response, status, payload) {
      response.status = status;
      response.payload = payload;
      return { status, payload };
    },
    httpError(status, message, code) {
      const error = new Error(message);
      error.statusCode = status;
      error.code = code || "HTTP_ERROR";
      return error;
    }
  });
}

async function call(api, method, target, body, headers = {}) {
  const response = {
    headers: {},
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; }
  };
  try {
    await api.handle({ method, headers, body }, response, new URL(target, "http://127.0.0.1"));
  } catch (error) {
    return { status: error.statusCode || 500, payload: { error: error.message, code: error.code }, headers: response.headers };
  }
  return { status: response.status, payload: response.payload, headers: response.headers };
}

function memoryInput() {
  const timestamp = "2026-07-19T00:00:00.000Z";
  return {
    schemaVersion: 16,
    id: "provenance-memory",
    title: "雨停后的散步",
    hall: "daily",
    sourceType: "日记",
    rawContent: "雨停后我沿着河边继续散步。",
    exhibitText: "一段由馆主亲自记录的普通日常。",
    date: "",
    location: "",
    people: [],
    tags: [],
    emotions: [],
    emotionIntensity: 3,
    importance: 3,
    favorite: false,
    coverImage: "",
    mediaNote: "",
    attachments: [],
    agentRunId: "",
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  try { store?.close(); } catch { /* deterministic cleanup */ }
  for (const suffix of ["", "-shm", "-wal"]) fs.rmSync(`${dbPath}${suffix}`, { force: true });
});
