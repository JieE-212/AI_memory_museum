"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  MEMORY_LENS_PREVIEW_PATH,
  MEMORY_LENS_EXECUTION_BOUNDARY,
  createMemoryLensApi,
  parseMemoryLensQuery
} = require("../lib/memory-lens-api");

let assertions = 0;

run().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});

async function run() {
  checkQueryContract();
  await checkGetOnlyBoundary();
  await checkServerSideReadAndPreview();
  await checkClueAndFreshness();
  await checkFailuresBeforeReads();
  await checkMissingAndInvalidSavedMemory();
  checkStaticReadOnlyBoundary();
  console.log(`Memory-lens API checks passed (${assertions} assertions).`);
}

function checkQueryContract() {
  const parsed = parseMemoryLensQuery(new URL(
    "http://local.test/api/memory-lens/preview?lens=time&memoryId=lens-a&memoryId=lens-b"
  ).searchParams);
  equal(parsed.lens, "time", "query parser keeps the explicit lens");
  deepEqual(parsed.memoryIds, ["lens-a", "lens-b"], "query parser keeps the complete explicit scope");
  equal(parsed.query, "", "non-clue lens has no hidden query");
  ok(Object.isFrozen(parsed) && Object.isFrozen(parsed.memoryIds), "parsed request is immutable");

  const clue = parseMemoryLensQuery(new URL(
    "http://local.test/api/memory-lens/preview?lens=clue&memoryId=lens-a&memoryId=lens-b&query=%E9%9B%A8%E5%A4%9C"
  ).searchParams);
  equal(clue.query, "雨夜", "clue lens accepts one explicit query");
  throwsCode(
    () => parseMemoryLensQuery(new URL("http://local.test/api/memory-lens/preview?lens=time&memoryId=lens-a&memoryId=lens-b&query=x").searchParams),
    "MEMORY_LENS_QUERY_INVALID",
    "non-clue lens rejects query"
  );
  throwsCode(
    () => parseMemoryLensQuery(new URL("http://local.test/api/memory-lens/preview?lens=clue&memoryId=lens-a&memoryId=lens-b").searchParams),
    "MEMORY_LENS_QUERY_INVALID",
    "clue lens requires one explicit query"
  );
  throwsCode(
    () => parseMemoryLensQuery(new URL("http://local.test/api/memory-lens/preview?lens=time&memoryId=lens-a&memoryId=lens-b&memory=%7B%7D").searchParams),
    "MEMORY_LENS_REQUEST_INVALID",
    "client memory payload fields are rejected"
  );
  throwsCode(
    () => parseMemoryLensQuery(new URL("http://local.test/api/memory-lens/preview?lens=time&lens=evidence&memoryId=lens-a&memoryId=lens-b").searchParams),
    "MEMORY_LENS_REQUEST_INVALID",
    "lens cannot be ambiguous"
  );
  throwsCode(
    () => parseMemoryLensQuery(new URL("http://local.test/api/memory-lens/preview?lens=time&memoryId=lens-a&memoryId=lens-a").searchParams),
    "MEMORY_LENS_MEMORY_INVALID",
    "duplicate memory IDs are rejected"
  );
}

async function checkGetOnlyBoundary() {
  const fixture = createFixture();
  const api = createMemoryLensApi(fixture.dependencies);
  equal(await api.handle({ method: "GET" }, {}, new URL("http://local.test/api/elsewhere")), false, "unrelated paths are not claimed");
  equal(fixture.calls.getMemory.length, 0, "unrelated paths do not read the collection");

  const request = { method: "POST" };
  Object.defineProperty(request, "body", { get() { throw new Error("request body must not be read"); } });
  Object.defineProperty(request, "headers", { get() { throw new Error("content type must not be read"); } });
  await rejectsCode(
    () => api.handle(request, {}, previewUrl("time", ["lens-a", "lens-b"])),
    "MEMORY_LENS_METHOD_NOT_ALLOWED",
    "POST is rejected before headers or body are inspected"
  );
  equal(fixture.calls.getMemory.length, 0, "non-GET request performs zero collection reads");

  for (const method of ["PUT", "PATCH", "DELETE", "HEAD"]) {
    await rejectsCode(
      () => api.handle({ method }, {}, previewUrl("time", ["lens-a", "lens-b"])),
      "MEMORY_LENS_METHOD_NOT_ALLOWED",
      `${method} is rejected by the GET-only route`
    );
  }
  equal(fixture.calls.sendJson.length, 0, "rejected methods never emit a success payload");
}

async function checkServerSideReadAndPreview() {
  const fixture = createFixture();
  const api = createMemoryLensApi(fixture.dependencies);
  const response = {};
  const result = await api.handle({ method: "GET" }, response, previewUrl("evidence", ["lens-a", "lens-b"]));
  equal(result, "sent:200", "successful request returns the sendJson result");
  deepEqual(fixture.calls.getMemory, ["lens-a", "lens-b"], "server re-reads every selected saved memory by ID");
  deepEqual(fixture.calls.decorate, ["lens-a", "lens-b"], "saved memories are decorated only after server reads");
  equal(fixture.calls.sendJson.length, 1, "successful preview emits one response");
  const sent = fixture.calls.sendJson[0];
  equal(sent.statusCode, 200, "preview returns HTTP 200");
  equal(sent.payload.preview.sourceCount, 2, "preview covers the complete explicit scope");
  equal(sent.payload.preview.engine.externalModel, false, "preview states zero external-model execution");
  equal(sent.payload.preview.engine.toolCalls, 0, "preview states zero tool calls");
  equal(sent.payload.preview.engine.persisted, false, "preview states zero persistence");
  deepEqual(sent.payload.execution, MEMORY_LENS_EXECUTION_BOUNDARY, "response repeats the deterministic read-only boundary");
  equal(sent.payload.execution.modelCalls, 0, "response explicitly states zero model calls");
  equal(sent.payload.execution.persisted, false, "response explicitly states that it was not saved");
  ok(sent.payload.preview.items.some((item) => item.evidence.some((entry) => entry.value === "1")), "server decoration contributes saved evidence counts");
}

async function checkClueAndFreshness() {
  const fixture = createFixture();
  const api = createMemoryLensApi(fixture.dependencies);
  await api.handle({ method: "GET" }, {}, previewUrl("clue", ["lens-a", "lens-b"], "  雨夜  礼堂  "));
  const first = fixture.calls.sendJson.at(-1).payload.preview;
  equal(first.query, "雨夜 礼堂", "core service canonically normalizes the explicit clue query");
  deepEqual(first.queryTerms, ["雨夜", "礼堂"], "core service uses only the explicit clue terms");

  fixture.memories.get("lens-a").updatedAt = "2026-07-19T10:05:00.000Z";
  await api.handle({ method: "GET" }, {}, previewUrl("clue", ["lens-a", "lens-b"], "雨夜 礼堂"));
  const second = fixture.calls.sendJson.at(-1).payload.preview;
  notEqual(second.sourceSnapshotSha256, first.sourceSnapshotSha256, "a newer saved source creates a new source snapshot");
  notEqual(second.previewSha256, first.previewSha256, "stale preview hashes are not reused after a saved source changes");
}

async function checkFailuresBeforeReads() {
  const fixture = createFixture();
  const api = createMemoryLensApi(fixture.dependencies);
  const invalidUrls = [
    new URL("http://local.test/api/memory-lens/preview?lens=future&memoryId=lens-a&memoryId=lens-b"),
    new URL("http://local.test/api/memory-lens/preview?lens=time&memoryId=lens-a"),
    new URL("http://local.test/api/memory-lens/preview?lens=time&memoryId=..%2Fprivate&memoryId=lens-b"),
    new URL("http://local.test/api/memory-lens/preview?lens=time&memoryId=lens-a&memoryId=lens-a"),
    new URL("http://local.test/api/memory-lens/preview?lens=time&memoryId=lens-a&memoryId=lens-b&memories=private"),
    previewUrl("clue", ["lens-a", "lens-b"], "a b c d e f g h i"),
    previewUrl("clue", ["lens-a", "lens-b"], "line\nbreak")
  ];
  for (const url of invalidUrls) {
    await assert.rejects(() => api.handle({ method: "GET" }, {}, url));
    assertions += 1;
  }
  equal(fixture.calls.getMemory.length, 0, "invalid URL scope is rejected before any saved memory is read");

  const twentyOne = Array.from({ length: 21 }, (_, index) => `memory-${index}`);
  await rejectsCode(
    () => api.handle({ method: "GET" }, {}, previewUrl("time", twentyOne)),
    "MEMORY_LENS_MEMORY_COUNT_INVALID",
    "twenty-one selected IDs are rejected before reads"
  );
  equal(fixture.calls.getMemory.length, 0, "over-limit scope performs zero collection reads");
}

async function checkMissingAndInvalidSavedMemory() {
  const fixture = createFixture();
  const api = createMemoryLensApi(fixture.dependencies);
  await rejectsCode(
    () => api.handle({ method: "GET" }, {}, previewUrl("time", ["lens-a", "lens-missing"])),
    "MEMORY_LENS_MEMORY_NOT_FOUND",
    "missing saved memory fails closed"
  );
  deepEqual(fixture.calls.getMemory, ["lens-a", "lens-missing"], "missing memory is discovered by authoritative server reads");
  equal(fixture.calls.sendJson.length, 0, "missing source emits no partial preview");

  const invalid = createFixture();
  invalid.memories.get("lens-b").updatedAt = "not-a-timestamp";
  const invalidApi = createMemoryLensApi(invalid.dependencies);
  await rejectsCode(
    () => invalidApi.handle({ method: "GET" }, {}, previewUrl("time", ["lens-a", "lens-b"])),
    "MEMORY_LENS_MEMORY_INVALID",
    "invalid current saved memory is rejected by the core contract"
  );
  equal(invalid.calls.sendJson.length, 0, "invalid saved source emits no result");
}

function checkStaticReadOnlyBoundary() {
  const source = fs.readFileSync(path.join(__dirname, "..", "lib", "memory-lens-api.js"), "utf8");
  ok(!/readJsonBody|requestBody|\bbody\b\s*[),]/u.test(source), "API contains no request-body reader");
  ok(!/store\.(?:createMemory|saveMemory|updateMemory|deleteMemory)\s*\(|INSERT\s+INTO|UPDATE\s+memories|DELETE\s+FROM/iu.test(source), "API contains no collection mutation surface");
  ok(!/\bfetch\s*\(|https?:\/\//u.test(source), "server adapter contains no network or external URL capability");
  ok(source.includes('request?.method !== "GET"'), "GET-only method gate is explicit");
  ok(source.indexOf('request?.method !== "GET"') < source.indexOf("url.searchParams"), "method gate runs before query parsing");
  ok(source.includes("store.getMemory(memoryId)"), "selected IDs are resolved through the saved collection");
  ok(source.includes("externalModel: false") && source.includes("modelCalls: 0") && source.includes("persisted: false"), "response boundary freezes zero-model and zero-save claims");
}

function createFixture() {
  const calls = { getMemory: [], decorate: [], sendJson: [] };
  const memories = new Map([
    ["lens-a", memory("lens-a", "礼堂雨夜", "2026-07-19T10:01:00.000Z")],
    ["lens-b", memory("lens-b", "散场以后", "2026-07-19T10:02:00.000Z")]
  ]);
  const store = {
    getMemory(id) {
      calls.getMemory.push(id);
      return memories.get(id) || null;
    },
    listMemories() {
      throw new Error("lens API must not widen scope with listMemories");
    }
  };
  const dependencies = {
    store,
    decorateMemory(saved) {
      calls.decorate.push(saved.id);
      return { ...saved, media: saved.id === "lens-a" ? [{ assetId: "media-a" }] : [] };
    },
    sendJson(response, statusCode, payload) {
      calls.sendJson.push({ response, statusCode, payload });
      return `sent:${statusCode}`;
    },
    httpError(statusCode, message) {
      const error = new Error(message);
      error.statusCode = statusCode;
      return error;
    }
  };
  return { calls, dependencies, memories };
}

function memory(id, title, updatedAt) {
  return {
    id,
    title,
    createdAt: "2026-07-19T10:00:00.000Z",
    updatedAt,
    date: "2025-06",
    location: "旧礼堂",
    sourceType: "手写日记",
    tags: ["雨夜"],
    rawContent: `${title}，雨夜散场。`,
    exhibitText: "只保留明确记录的文字。",
    entityRefs: [],
    confirmedQuotes: [],
    voices: []
  };
}

function previewUrl(lens, memoryIds, query = "") {
  const url = new URL(`http://local.test${MEMORY_LENS_PREVIEW_PATH}`);
  url.searchParams.set("lens", lens);
  memoryIds.forEach((memoryId) => url.searchParams.append("memoryId", memoryId));
  if (lens === "clue") url.searchParams.set("query", query);
  return url;
}

function ok(value, message) {
  assertions += 1;
  assert.ok(value, message);
}

function equal(actual, expected, message) {
  assertions += 1;
  assert.equal(actual, expected, message);
}

function notEqual(actual, expected, message) {
  assertions += 1;
  assert.notEqual(actual, expected, message);
}

function deepEqual(actual, expected, message) {
  assertions += 1;
  assert.deepEqual(actual, expected, message);
}

function throwsCode(callback, code, message) {
  assertions += 1;
  assert.throws(callback, (error) => error?.code === code, message);
}

async function rejectsCode(callback, code, message) {
  assertions += 1;
  await assert.rejects(callback, (error) => error?.code === code, message);
}
