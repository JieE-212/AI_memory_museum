"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ui = require("../public/assets/semantic-recall.js");

let assertions = 0;

async function run() {
  await checkPrepareQueryAndClear();
  await checkPendingFetchCancellation();
  await checkFailureAndInvalidation();
  checkStaticUiBoundary();
  console.log(`Semantic recall UI checks passed (${assertions} assertions).`);
}

async function checkPrepareQueryAndClear() {
  FakeWorker.instances = [];
  const harness = createHarness({ fetch: async () => jsonResponse(snapshotFixture()) });
  harness.elements.prepare.click();
  await settle();
  equal(harness.requests.length, 1, "prepare performs one snapshot request");
  equal(harness.requests[0].url, ui.SNAPSHOT_PATH, "prepare uses only the fixed same-origin snapshot path");
  equal(harness.requests[0].options.method, "GET", "snapshot is GET-only");
  equal(harness.requests[0].options.cache, "no-store", "private snapshot bypasses browser response cache");
  ok(harness.requests[0].options.signal, "snapshot fetch receives an abort signal");
  equal(FakeWorker.instances.length, 1, "one module worker is created after snapshot validation");
  const worker = FakeWorker.instances[0];
  equal(worker.url, ui.WORKER_PATH, "worker uses the fixed same-origin implementation");
  equal(worker.options.type, "module", "worker is a module so the pinned runtime can be imported");
  equal(worker.messages[0].type, "prepare", "worker receives a prepare command");
  equal(worker.messages[0].snapshot.documentCount, 1, "complete bounded snapshot enters the worker");
  const session = worker.messages[0].session;
  worker.emit("message", { session, type: "ready", documentCount: 1, collectionFingerprint: "a".repeat(64), maximumInputTokens: 451, modelMaximumTokens: 512 });
  equal(harness.controller.getPhase(), "ready", "valid worker receipt enables semantic query");
  equal(harness.elements.query.disabled, false, "query field becomes available only after indexing");

  harness.elements.query.value = "小时候 下雨天 等爷爷";
  harness.elements.form.submit();
  equal(worker.messages.at(-1).type, "query", "query is sent only to the current worker");
  equal(worker.messages.at(-1).query, "小时候 下雨天 等爷爷", "natural description stays inside the worker message");
  equal(harness.requests.length, 1, "semantic query causes no additional network request");
  worker.emit("message", {
    session,
    type: "results",
    collectionFingerprint: "a".repeat(64),
    results: [{ rank: 1, memoryId: "memory-a", title: "<img onerror=steal>", excerpt: "<script>secret</script>", tags: ["童年"], similarity: 0.84 }]
  });
  equal(harness.elements.results.children.length, 1, "one semantic result is rendered");
  const resultButton = harness.elements.results.children[0].children[0];
  equal(resultButton.children[1].textContent, "<img onerror=steal>", "result title is inert textContent");
  equal(resultButton.children[2].textContent, "<script>secret</script>", "result excerpt is inert textContent");
  resultButton.click();
  deepEqual(harness.opened, ["memory-a"], "result opens only its validated memory ID");

  harness.elements.fallback.click();
  deepEqual(harness.fallbacks, ["小时候 下雨天 等爷爷"], "fallback hands the current phrase to field-and-clue retrieval");
  equal(harness.requests.length, 1, "fallback itself performs no hidden request");
  harness.elements.clear.click();
  ok(worker.terminated, "clear terminates the worker and releases model memory");
  equal(harness.elements.query.value, "", "clear removes the session query");
  equal(harness.elements.results.children.length, 0, "clear removes session results");
  equal(harness.controller.getPhase(), "idle", "clear returns to idle state");
}

async function checkPendingFetchCancellation() {
  FakeWorker.instances = [];
  let resolveFetch;
  const pending = new Promise((resolve) => { resolveFetch = resolve; });
  const harness = createHarness({ fetch: async (url, options) => {
    harness.requests.push({ url, options });
    return pending;
  }, recordFetch: false });
  harness.elements.prepare.click();
  await settle();
  equal(harness.controller.getPhase(), "loading", "pending snapshot keeps prepare in loading state");
  const signal = harness.requests[0].options.signal;
  harness.elements.stop.click();
  ok(signal.aborted, "stop aborts a pending snapshot fetch");
  equal(harness.controller.getPhase(), "idle", "stop immediately returns UI to idle");
  resolveFetch(jsonResponse(snapshotFixture()));
  await settle();
  equal(FakeWorker.instances.length, 0, "late fetch response cannot create a worker after stop");

  let resolveDestroy;
  const destroyPending = new Promise((resolve) => { resolveDestroy = resolve; });
  const destroyed = createHarness({ fetch: async () => destroyPending });
  destroyed.elements.prepare.click();
  await settle();
  destroyed.controller.destroy();
  resolveDestroy(jsonResponse(snapshotFixture()));
  await settle();
  equal(FakeWorker.instances.length, 0, "late fetch response cannot create a worker after destroy");
}

async function checkFailureAndInvalidation() {
  FakeWorker.instances = [];
  const harness = createHarness({ fetch: async () => jsonResponse(snapshotFixture()) });
  harness.elements.prepare.click();
  await settle();
  const worker = FakeWorker.instances[0];
  const session = worker.messages[0].session;
  worker.emit("message", { session, type: "ready", documentCount: 1, collectionFingerprint: "a".repeat(64), maximumInputTokens: 451, modelMaximumTokens: 512 });
  harness.controller.invalidate();
  ok(worker.terminated, "collection changes terminate a ready worker");
  ok(harness.elements.status.textContent.includes("馆藏文字已变化"), "invalidation tells a beginner why preparation is needed again");
  harness.elements.prepare.click();
  await settle();
  const replacement = FakeWorker.instances.at(-1);
  ok(replacement !== worker && !replacement.terminated, "a fresh prepare owns a new worker instance");
  worker.emit("error", {});
  ok(!replacement.terminated, "queued error from a terminated worker cannot kill its replacement");
  equal(harness.controller.getPhase(), "loading", "stale worker error cannot alter the replacement phase");
  replacement.emit("message", { session: replacement.messages[0].session, type: "ready", documentCount: 1, collectionFingerprint: "a".repeat(64), maximumInputTokens: 451, modelMaximumTokens: 512 });
  equal(harness.controller.getPhase(), "ready", "replacement worker can still complete after stale error");

  const failing = createHarness({ fetch: async () => ({ ok: false, json: async () => ({ error: "容量超出", code: "SEMANTIC_RECALL_CAPACITY_EXCEEDED" }) }) });
  failing.elements.prepare.click();
  await settle();
  ok(failing.elements.status.textContent.startsWith("设备语义不可用。"), "failure never displays semantic success");
  ok(failing.elements.status.textContent.includes("字段与线索检索"), "failure exposes the honest fallback");
  equal(failing.controller.getPhase(), "error", "failure stays explicit");
}

function checkStaticUiBoundary() {
  const html = read("public/index.html");
  const source = read("public/assets/semantic-recall.js");
  const worker = read("public/assets/semantic-recall-worker.js");
  const css = read("public/semantic-recall.css");
  const panel = html.slice(html.indexOf('id="semanticRecallDetails"'), html.indexOf('<section class="guide-card"'));
  ok(panel.includes("按意思找回") && panel.includes("约 47 MB") && panel.includes("文字与查询不上传"), "collapsed summary and body explain purpose, size and privacy");
  ok(!/<details[^>]*id="semanticRecallDetails"[^>]*\sopen(?:\s|>)/u.test(html), "semantic feature is closed by default");
  ok(panel.includes("相似不等于事实、人物关系、情绪、真实性或概率判断"), "result boundary is beginner-readable");
  ok(!/localStorage|sessionStorage|indexedDB|caches\.open/u.test(source + worker), "query, vectors and index have no persistence API");
  ok(source.includes("AbortController") && source.includes("prepareEpoch") && source.includes("epoch !== prepareEpoch"), "pending fetch and stale completion are permanently guarded");
  ok(source.includes("sourceWorker !== worker") && source.includes("handleWorkerCrash(event, candidate)"), "stale worker messages and errors are instance-bound");
  ok(source.includes("textContent = result.title") && source.includes("textContent = result.excerpt") && !/\.innerHTML\b|insertAdjacentHTML|document\.write/u.test(source), "untrusted results use only text nodes");
  ok(source.includes("fetchImpl(SNAPSHOT_PATH") && !source.includes("fetchImpl(`") && !source.includes("fetchImpl(query"), "host fetches only the fixed snapshot path");
  ok(!/method:\s*["'](?:POST|PUT|PATCH|DELETE)/u.test(source), "host has no write request");
  ok(!/gradient\s*\(/iu.test(css), "semantic panel preserves the clean no-gradient visual language");
  ok(css.includes("@media (max-width: 390px)") && css.includes("@media (max-width: 320px)") && css.includes("min-height: 44px"), "narrow mobile and touch targets are permanent");
  ok(css.includes("min-width: 0") && css.includes("overflow-wrap: anywhere"), "long unbroken result text cannot force horizontal overflow");
}

function createHarness(options = {}) {
  const elements = createElements();
  const document = new FakeDocument(elements);
  const requests = [];
  const opened = [];
  const fallbacks = [];
  const fetchImpl = options.fetch || (async () => jsonResponse(snapshotFixture()));
  const harness = { elements, document, requests, opened, fallbacks, controller: null };
  const trackedFetch = options.recordFetch === false ? fetchImpl : async (url, fetchOptions) => {
    requests.push({ url, options: fetchOptions });
    return fetchImpl(url, fetchOptions);
  };
  harness.controller = ui.createController({
    document,
    fetch: trackedFetch,
    Worker: FakeWorker,
    AbortController,
    onOpenMemory: (id) => opened.push(id),
    onFallback: (query) => fallbacks.push(query)
  });
  return harness;
}

function createElements() {
  const elements = Object.fromEntries([
    "semanticRecallDetails", "semanticRecallPrepare", "semanticRecallStop", "semanticRecallClear",
    "semanticRecallStatus", "semanticRecallProgress", "semanticRecallForm", "semanticRecallQuery",
    "semanticRecallSubmit", "semanticRecallFallback", "semanticRecallResults"
  ].map((id) => [id, new FakeElement(id)]));
  return Object.assign(elements, {
    details: elements.semanticRecallDetails,
    prepare: elements.semanticRecallPrepare,
    stop: elements.semanticRecallStop,
    clear: elements.semanticRecallClear,
    status: elements.semanticRecallStatus,
    progress: elements.semanticRecallProgress,
    form: elements.semanticRecallForm,
    query: elements.semanticRecallQuery,
    submit: elements.semanticRecallSubmit,
    fallback: elements.semanticRecallFallback,
    results: elements.semanticRecallResults
  });
}

function snapshotFixture() {
  const documents = [{ memoryId: "memory-a", title: "雨天", exhibitText: "等爷爷", rawContent: "屋檐下", tags: ["童年"], confirmedTranscripts: [] }];
  return {
    format: "time-isle-semantic-recall-snapshot-v1",
    collectionFingerprint: "a".repeat(64),
    documentCount: 1,
    documents,
    documentUtf8Bytes: new TextEncoder().encode(JSON.stringify(documents)).byteLength,
    model: { id: "Xenova/bge-small-zh-v1.5", dimensions: 512, dtype: "q8", localModelPath: "/assets/models/v17/", remoteModelsAllowed: false },
    boundary: { execution: "browser-worker-memory-only", persisted: false, externalRequests: false }
  };
}

function jsonResponse(snapshot) { return { ok: true, json: async () => ({ snapshot }) }; }
function settle() { return new Promise((resolve) => setImmediate(resolve)); }
function read(file) { return fs.readFileSync(path.join(__dirname, "..", file), "utf8"); }
function ok(value, message) { assert.ok(value, message); assertions += 1; }
function equal(actual, expected, message) { assert.equal(actual, expected, message); assertions += 1; }
function deepEqual(actual, expected, message) { assert.deepEqual(actual, expected, message); assertions += 1; }

class FakeClassList {
  constructor() { this.values = new Set(); }
  toggle(name, force) { if (force) this.values.add(name); else this.values.delete(name); }
}

class FakeElement {
  constructor(id = "") {
    this.id = id; this.hidden = false; this.disabled = false; this.value = ""; this.textContent = "";
    this.children = []; this.listeners = new Map(); this.classList = new FakeClassList(); this.attributes = new Map();
  }
  addEventListener(type, callback) { const list = this.listeners.get(type) || []; list.push(callback); this.listeners.set(type, list); }
  dispatch(type, event = {}) { (this.listeners.get(type) || []).forEach((callback) => callback({ preventDefault() {}, data: undefined, ...event })); }
  click() { this.dispatch("click"); }
  submit() { this.dispatch("submit"); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  replaceChildren(...children) { this.children = [...children]; }
  append(...children) { this.children.push(...children); }
  focus() {}
}

class FakeDocument {
  constructor(elements) { this.elements = elements; }
  querySelector(selector) { return this.elements[selector.slice(1)] || null; }
  createElement() { return new FakeElement(); }
}

class FakeWorker {
  static instances = [];
  constructor(url, options) { this.url = url; this.options = options; this.messages = []; this.listeners = new Map(); this.terminated = false; FakeWorker.instances.push(this); }
  addEventListener(type, callback) { this.listeners.set(type, callback); }
  postMessage(message) { this.messages.push(message); }
  terminate() { this.terminated = true; }
  emit(type, data) { this.listeners.get(type)?.({ data }); }
}

run().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
