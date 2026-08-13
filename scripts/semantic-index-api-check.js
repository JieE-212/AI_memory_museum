"use strict";

const assert = require("node:assert/strict");
const { createSemanticIndexApi, MODEL_ID, MODEL_SHA256 } = require("../lib/semantic-index-api");

let assertions = 0;

async function run() {
  await checkPrivateRoutes();
  await checkPrivateSearch();
  await checkDemoBoundary();
  console.log(`Semantic index API checks passed (${assertions} assertions).`);
}

async function checkPrivateSearch() {
  const fixture = createFixture(false, { searchResults: [{ memoryId: "memory-a", rank: 1, similarity: 1, memory: { title: "fixture", exhibitText: "excerpt", rawContent: "private", tags: [] } }] });
  const api = createSemanticIndexApi(fixture.dependencies);
  const body = { limit: 30, modelId: MODEL_ID, modelSha256: MODEL_SHA256, projectionVersion: "v1", vector: Buffer.alloc(2048).toString("base64") };
  fixture.nextBody = body;
  equal(await api.handle({ method: "POST" }, {}, url("/search")), "sent:200", "private derived index search remains available as a POST read operation");
  deepEqual(fixture.readBodies, [body], "search reads the unchanged existing request shape");
  equal(fixture.searches.length, 1, "search delegates the local vector exactly once");
  equal(fixture.sent[0].payload.results[0].memoryId, "memory-a", "search response projects only the display-safe result fields");
  equal(fixture.sent[0].payload.results[0].excerpt, "excerpt", "search response uses the display projection only");
  equal(JSON.stringify(fixture.sent[0].payload).includes("private"), false, "search response never exposes raw memory text");
}

async function checkPrivateRoutes() {
  const fixture = createFixture(false);
  const api = createSemanticIndexApi(fixture.dependencies);
  equal(await api.handle({ method: "GET" }, {}, url("/status")), "sent:200", "private status is readable");
  equal(fixture.sent[0].payload.allowed, true, "private status truthfully allows explicit persistence");
  equal(fixture.sent[0].payload.boundary, "private-local-derived-cache", "private status names local derived cache boundary");
  const body = { entries: [entry()], modelId: MODEL_ID, modelSha256: MODEL_SHA256, projectionVersion: "v1" };
  equal(await api.handle({ method: "POST" }, {}, url("/upsert")), "sent:200", "private upsert returns success");
  deepEqual(fixture.readBodies, [body], "upsert reads one exact identity-bound derived-vector body");
  equal(fixture.upserts.length, 1, "upsert delegates only vector entries to the store");
  equal(await api.handle({ method: "DELETE" }, {}, url("")), "sent:200", "private index can be cleared without touching memories");
  equal(fixture.clears, 1, "clear delegates exactly once");
}

async function checkDemoBoundary() {
  const fixture = createFixture(true);
  const api = createSemanticIndexApi(fixture.dependencies);
  equal(await api.handle({ method: "GET" }, {}, url("/status")), "sent:200", "Demo may disclose truthful status");
  equal(fixture.sent[0].payload.allowed, false, "Demo never offers persistent index writes");
  for (const [method, suffix] of [["POST", "/upsert"], ["POST", "/search"], ["DELETE", ""]]) {
    const request = { method };
    Object.defineProperty(request, "body", { get() { throw new Error("body must not be read"); } });
    await assert.rejects(() => api.handle(request, {}, url(suffix)), (error) => error?.code === "SEMANTIC_INDEX_DEMO_DISABLED");
    assertions += 1;
  }
  equal(fixture.readBodies.length, 0, "Demo mutation boundary rejects before request-body reader");
  equal(fixture.upserts.length, 0, "Demo never writes derived vectors");
}

function createFixture(interviewDemo, options = {}) {
  const sent = []; const readBodies = []; const upserts = [];
  const body = { entries: [entry()], modelId: MODEL_ID, modelSha256: MODEL_SHA256, projectionVersion: "v1" };
  const fixture = { sent, readBodies, upserts, searches: [], clears: 0, nextBody: body };
  fixture.dependencies = {
    interviewDemo,
    store: {
      getSemanticIndexStatus: () => ({ cachedCount: 0, fresh: 0, stale: 0 }),
      upsertSemanticEmbeddings(entries, identity) { upserts.push({ entries, identity }); return { stored: entries.length, stale: 0, requested: entries.length }; },
      searchSemanticEmbeddings(vector, identity) { fixture.searches.push({ vector, identity }); return options.searchResults || []; },
      clearSemanticEmbeddings() { fixture.clears += 1; return { deleted: 0 }; }
    },
    readJsonBody: async () => { readBodies.push(fixture.nextBody); return fixture.nextBody; },
    sendJson: (_response, status, payload) => { sent.push({ status, payload }); return `sent:${status}`; },
    httpError: (status, message) => { const error = new Error(message); error.statusCode = status; return error; }
  };
  return fixture;
}

function entry() { return { memoryId: "memory-a", sourceSha256: "a".repeat(64), vector: Buffer.alloc(2048).toString("base64") }; }
function url(suffix) { return new URL(`http://local.test/api/semantic-index${suffix}`); }
function equal(actual, expected, message) { assert.equal(actual, expected, message); assertions += 1; }
function deepEqual(actual, expected, message) { assert.deepEqual(actual, expected, message); assertions += 1; }

run().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
