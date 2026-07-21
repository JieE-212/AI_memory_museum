"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  buildStoredMultiPerspectivePreview,
  buildSyntheticMultiPerspectivePreview,
  createMultiPerspectiveApi
} = require("../lib/multi-perspective-api");

let assertions = 0;

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function run() {
  const localStore = createStore();
  const localApi = createApi(localStore, false);
  const unrelated = await localApi.handle({ method: "GET", headers: {} }, responseMock(), url("/api/health"));
  equal(unrelated, false, "unrelated route falls through");

  const response = responseMock();
  const result = await localApi.handle({ method: "GET", headers: {} }, response, url("/api/multi-perspective/memories/memory-a"));
  equal(result.statusCode, 200, "local GET returns 200");
  equal(result.payload.preview.synthetic, false, "local preview is not synthetic");
  equal(result.payload.preview.target.id, "memory-a", "local preview stays on requested memory");
  equal(response.headers.get("cache-control"), "private, no-store", "preview is private and no-store");
  ok(/^"multi-perspective-[a-f0-9]{64}"$/u.test(response.headers.get("etag")), "preview has a content ETag");
  equal(result.payload.etag, response.headers.get("etag"), "payload and HTTP ETag agree");
  equal(localStore.calls.getMemory, 1, "local preview reads the requested memory once");
  equal(localStore.calls.revisions, 1, "local preview reads revision history once");
  equal(localStore.calls.responses, 1, "local preview reads co-memory responses once");
  equal(localStore.calls.passport, 1, "local preview reads the source passport once");
  equal(localStore.calls.memoryTime, 1, "un-grouped local memory reads its time workspace once");
  equal(localStore.calls.eventTime, 0, "un-grouped memory does not read event calibration");

  const conditional = responseMock();
  const conditionalResult = await localApi.handle({
    method: "GET",
    headers: { "if-none-match": result.payload.etag }
  }, conditional, url("/api/multi-perspective/memories/memory-a"));
  equal(conditionalResult, undefined, "matching If-None-Match returns no JSON body");
  equal(conditional.statusCode, 304, "matching If-None-Match returns 304");
  ok(conditional.ended, "304 response is ended");

  await rejectsCode(
    () => localApi.handle({ method: "POST", headers: {} }, responseMock(), url("/api/multi-perspective/memories/memory-a")),
    "MULTI_PERSPECTIVE_METHOD_NOT_ALLOWED",
    "write method is rejected"
  );
  await rejectsCode(
    () => localApi.handle({ method: "GET", headers: {} }, responseMock(), url("/api/multi-perspective/memories/memory-a?limit=1")),
    "MULTI_PERSPECTIVE_QUERY_INVALID",
    "query parameter is rejected"
  );
  await rejectsCode(
    () => localApi.handle({ method: "GET", headers: {} }, responseMock(), url("/api/multi-perspective/events/event-a")),
    "MULTI_PERSPECTIVE_ROUTE_NOT_FOUND",
    "event route is deliberately outside V16 memory scope"
  );
  await rejectsCode(
    () => localApi.handle({ method: "GET", headers: {} }, responseMock(), url("/api/multi-perspective/memories/missing")),
    "MULTI_PERSPECTIVE_MEMORY_NOT_FOUND",
    "missing local memory returns safe 404"
  );

  const eventStore = createStore({ event: { id: "event-a", title: "同一往事", status: "confirmed" } });
  const eventPreview = buildStoredMultiPerspectivePreview(eventStore, "memory-a");
  equal(eventPreview.timeContext.calibration.targetType, "event", "confirmed event calibration takes display precedence");
  equal(eventStore.calls.eventTime, 1, "event context is read once");
  equal(eventStore.calls.memoryTime, 0, "event context avoids duplicate member calibration read");

  const forbiddenCalls = createThrowingStore();
  const demoApi = createApi(forbiddenCalls.store, true);
  const demoResponse = responseMock();
  const demo = await demoApi.handle({ method: "GET", headers: {} }, demoResponse,
    url("/api/multi-perspective/memories/demo-seeded-memory"));
  equal(demo.statusCode, 200, "Demo GET returns 200");
  equal(demo.payload.preview.synthetic, true, "Demo preview is explicitly synthetic");
  equal(forbiddenCalls.count(), 0, "Demo preview calls no store method");
  equal(demo.payload.preview.execution.persisted, false, "Demo preview remains zero-save");
  equal(demo.payload.preview.execution.modelCalls, 0, "Demo preview remains zero-model");
  ok(demo.payload.preview.perspectives.some((item) => item.identity?.verified === false),
    "Demo keeps the reply identity-unverified badge");
  const demoJson = JSON.stringify(demo.payload);
  ok(!/synthetic-response|synthetic-revision-old|synthetic-claim|sourceKey|anchorKey|requestSha256/iu.test(demoJson),
    "Demo projection hides synthetic and internal source record IDs");

  const firstSynthetic = buildSyntheticMultiPerspectivePreview("demo-a");
  const secondSynthetic = buildSyntheticMultiPerspectivePreview("demo-a");
  equal(firstSynthetic.receipt.previewSha256, secondSynthetic.receipt.previewSha256,
    "synthetic preview is deterministic");

  const source = fs.readFileSync(path.join(__dirname, "..", "lib", "multi-perspective-api.js"), "utf8");
  ok(source.indexOf("? buildSyntheticMultiPerspectivePreview") < source.indexOf(": buildStoredMultiPerspectivePreview"),
    "Demo branch visibly precedes the stored branch");
  ok(!/readJsonBody|requestBody|request\.on\s*\(|for\s+await\s*\([^)]*request/u.test(source),
    "GET-only API has no body reader");
  ok(!/method\s*===\s*["'](?:POST|PUT|PATCH|DELETE)|INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM/iu.test(source),
    "API exposes no mutation path or SQL write");
  ok(!/\bfetch\s*\(|https?:\/\//u.test(source), "API has no external network capability");

  console.log(`Multi-perspective API checks passed: ${assertions} assertions.`);
}

function createApi(store, interviewDemo) {
  return createMultiPerspectiveApi({
    store,
    interviewDemo,
    sendJson: (_response, statusCode, payload) => ({ statusCode, payload }),
    httpError: (statusCode, message) => Object.assign(new Error(message), { statusCode })
  });
}

function createStore(options = {}) {
  const calls = { getMemory: 0, revisions: 0, responses: 0, passport: 0, event: 0, memoryTime: 0, eventTime: 0 };
  const memory = {
    id: "memory-a",
    title: "本机记录",
    rawContent: "只在本机读取的虚构正文。",
    exhibitText: "虚构展签。",
    date: "2024-06-18",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z"
  };
  return {
    calls,
    getMemory(id) { calls.getMemory += 1; return id === memory.id ? memory : null; },
    listMemoryRevisions(id) { calls.revisions += 1; return id === memory.id ? [] : []; },
    listCoMemoryResponses(query) { calls.responses += 1; assert.equal(query.memoryId, memory.id); return []; },
    getProvenancePassport(id) { calls.passport += 1; return { memoryId: id, claims: [] }; },
    getMemoryEventForMemory() { calls.event += 1; return options.event || null; },
    getMemoryCalibrationWorkspace(id) {
      calls.memoryTime += 1;
      return { target: { type: "memory", id, title: memory.title }, calibration: null, needsReview: false };
    },
    getEventCalibrationWorkspace(id) {
      calls.eventTime += 1;
      return {
        target: { type: "event", id, title: options.event?.title || "事件" },
        calibration: {
          targetType: "event",
          resolutionKind: "uncertain",
          intervalStart: "",
          intervalEnd: "",
          selectedSourceKeys: [],
          updatedAt: "2026-01-03T00:00:00.000Z"
        },
        needsReview: false
      };
    }
  };
}

function createThrowingStore() {
  let calls = 0;
  const fail = () => { calls += 1; throw new Error("Demo attempted to read a private store"); };
  return {
    count: () => calls,
    store: {
      getEventCalibrationWorkspace: fail,
      getMemory: fail,
      getMemoryCalibrationWorkspace: fail,
      getMemoryEventForMemory: fail,
      getProvenancePassport: fail,
      listCoMemoryResponses: fail,
      listMemoryRevisions: fail
    }
  };
}

function responseMock() {
  const headers = new Map();
  return {
    statusCode: 200,
    ended: false,
    headers,
    setHeader(name, value) { headers.set(String(name).toLowerCase(), String(value)); },
    end() { this.ended = true; }
  };
}

function url(value) {
  return new URL(value, "http://127.0.0.1:3000");
}

function ok(value, message) { assert.ok(value, message); assertions += 1; }
function equal(actual, expected, message) { assert.equal(actual, expected, message); assertions += 1; }
async function rejectsCode(callback, code, message) {
  await assert.rejects(callback, (error) => error?.code === code, message);
  assertions += 1;
}
