"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createSemanticRecallApi } = require("../lib/semantic-recall-api");

let assertions = 0;

run().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});

async function run() {
  await checkGetOnlyContract();
  await checkSnapshotResponse();
  await checkCapacityFailure();
  checkStaticBoundary();
  console.log(`Semantic recall API checks passed (${assertions} assertions).`);
}

async function checkGetOnlyContract() {
  const fixture = createFixture();
  const api = createSemanticRecallApi(fixture.dependencies);
  equal(await api.handle({ method: "GET" }, {}, new URL("http://local.test/api/elsewhere")), false, "unrelated route is not claimed");
  equal(fixture.reads.memories, 0, "unrelated route performs no reads");
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "HEAD"]) {
    const request = { method };
    Object.defineProperty(request, "body", { get() { throw new Error("body must not be read"); } });
    await rejectsCode(() => api.handle(request, {}, url()), "SEMANTIC_RECALL_METHOD_NOT_ALLOWED", `${method} is rejected before body access`);
  }
  equal(fixture.reads.memories, 0, "rejected methods perform no collection reads");
  await rejectsCode(() => api.handle({ method: "GET" }, {}, new URL(`${url()}?query=private`)), "SEMANTIC_RECALL_QUERY_INVALID", "query parameters are rejected");
  equal(fixture.reads.memories, 0, "invalid query is rejected before reads");
  await rejectsCode(() => api.handle({ method: "GET" }, {}, new URL("http://local.test/api/semantic-recall/future")), "SEMANTIC_RECALL_ROUTE_NOT_FOUND", "unknown semantic route is explicit");
}

async function checkSnapshotResponse() {
  const fixture = createFixture();
  const api = createSemanticRecallApi(fixture.dependencies);
  const response = responseFixture();
  const returned = await api.handle({ method: "GET" }, response, url());
  equal(returned, "sent:200", "successful route returns sendJson result");
  equal(fixture.reads.memories, 1, "collection is read exactly once");
  deepEqual(fixture.reads.voices, ["memory-a"], "confirmed transcript sources are read once per memory");
  equal(fixture.sent.length, 1, "one success payload is emitted");
  equal(response.headers.get("cache-control"), "private, no-store", "private snapshot cannot be cached");
  const snapshot = fixture.sent[0].payload.snapshot;
  equal(snapshot.documentCount, 1, "complete snapshot reaches the client");
  equal(snapshot.documents[0].confirmedTranscripts[0], "人工确认的雨声回忆", "confirmed text reaches the worker boundary");
  ok(!JSON.stringify(snapshot).includes("draft-secret"), "draft transcript cannot leak");
  ok(!JSON.stringify(snapshot).includes("asset-secret"), "voice asset metadata cannot leak");
}

async function checkCapacityFailure() {
  const fixture = createFixture();
  fixture.memories = Array.from({ length: 501 }, (_, index) => ({ id: `memory-${index}`, title: "样例" }));
  const api = createSemanticRecallApi(fixture.dependencies);
  await rejectsCode(() => api.handle({ method: "GET" }, responseFixture(), url()), "SEMANTIC_RECALL_CAPACITY_EXCEEDED", "over-capacity collection fails explicitly");
  equal(fixture.reads.voices.length, 0, "capacity failure does not read transcripts");
  equal(fixture.sent.length, 0, "capacity failure cannot emit partial snapshot");
}

function checkStaticBoundary() {
  const source = fs.readFileSync(path.join(__dirname, "..", "lib", "semantic-recall-api.js"), "utf8");
  ok(!/readJsonBody|request\.body|INSERT\s+INTO|UPDATE\s+memories|DELETE\s+FROM/iu.test(source), "adapter has no request body or write capability");
  ok(!/\bfetch\s*\(|https?:\/\//u.test(source), "adapter has no external network capability");
  ok(source.indexOf('request?.method !== "GET"') < source.indexOf("store.listMemories()"), "method gate precedes collection reads");
  ok(source.indexOf("url.searchParams.keys()") < source.indexOf("store.listMemories()"), "query gate precedes collection reads");
}

function createFixture() {
  const reads = { memories: 0, voices: [] };
  const sent = [];
  const fixture = {
    reads,
    sent,
    memories: [{ id: "memory-a", title: "雨天", exhibitText: "屋檐下等待", rawContent: "爷爷带伞来接我", tags: ["童年"] }]
  };
  fixture.dependencies = {
    store: {
      listMemories() { reads.memories += 1; return fixture.memories; },
      listVoiceForMemory(memoryId) {
        reads.voices.push(memoryId);
        return [
          { asset: { name: "asset-secret" }, transcript: { status: "confirmed", confirmed: true, text: "人工确认的雨声回忆" } },
          { transcript: { status: "draft", text: "draft-secret" } }
        ];
      }
    },
    sendJson(response, statusCode, payload) { sent.push({ response, statusCode, payload }); return `sent:${statusCode}`; },
    httpError(statusCode, message) { const error = new Error(message); error.statusCode = statusCode; return error; }
  };
  return fixture;
}

function responseFixture() {
  const headers = new Map();
  return { headers, setHeader(name, value) { headers.set(String(name).toLowerCase(), String(value)); } };
}

function url() { return new URL("http://local.test/api/semantic-recall/snapshot"); }
function ok(value, message) { assert.ok(value, message); assertions += 1; }
function equal(actual, expected, message) { assert.equal(actual, expected, message); assertions += 1; }
function deepEqual(actual, expected, message) { assert.deepEqual(actual, expected, message); assertions += 1; }
async function rejectsCode(callback, code, message) { await assert.rejects(callback, (error) => error?.code === code, message); assertions += 1; }
