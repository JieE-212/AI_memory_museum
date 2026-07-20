"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const host = require("../public/assets/memory-lens-host");

let assertions = 0;

run().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});

async function run() {
  checkExportsAndSelection();
  await checkPreviewClient();
  await checkMemoryLoader();
  checkCuratorHandoff();
  await checkHostWiring();
  await checkResponseFailures();
  checkStaticBoundary();
  console.log(`Memory-lens host checks passed (${assertions} assertions).`);
}

function checkExportsAndSelection() {
  for (const name of [
    "createHost",
    "createPreviewClient",
    "createMemoryLoader",
    "normalizePreviewSelection",
    "prepareCuratorHandoff"
  ]) {
    equal(typeof host[name], "function", `host exports ${name}`);
  }
  equal(host.PREVIEW_PATH, "/api/memory-lens/preview", "host uses the GET-only preview path");
  equal(host.LIMITS.maxCuratorMemories, 6, "curator preselection is explicitly capped at six");

  const privateCanary = "PRIVATE MEMORY BODY MUST NOT LEAVE";
  const normalized = host.normalizePreviewSelection({
    lens: "time",
    memories: [savedMemory("lens-a", privateCanary), savedMemory("lens-b", privateCanary)]
  });
  deepEqual(normalized.memoryIds, ["lens-a", "lens-b"], "selection projects memories to IDs only");
  ok(!JSON.stringify(normalized).includes(privateCanary), "selection does not retain private memory content");
  ok(Object.isFrozen(normalized) && Object.isFrozen(normalized.memoryIds), "selection is immutable");
  equal(host.normalizePreviewSelection({
    lens: "clue",
    memories: [savedMemory("lens-a"), savedMemory("lens-b")],
    query: "  雨夜   礼堂  "
  }).query, "雨夜 礼堂", "clue query is normalized without semantic expansion");
  equal(host.normalizePreviewSelection({
    lens: "clue",
    memories: [savedMemory("lens-a"), savedMemory("lens-b")],
    query: "Ａ A"
  }).query, "A A", "query text is preserved while validation uses canonical comparison");
  throwsCode(
    () => host.normalizePreviewSelection({ lens: "time", memories: [savedMemory("lens-a")] }),
    "MEMORY_LENS_MEMORY_COUNT_INVALID",
    "host refuses fewer than two sources"
  );
  throwsCode(
    () => host.normalizePreviewSelection({ lens: "time", memories: [savedMemory("lens-a"), savedMemory("lens-a")] }),
    "MEMORY_LENS_MEMORY_INVALID",
    "host refuses duplicate IDs"
  );
  const sparse = Array(2);
  sparse[0] = savedMemory("lens-a");
  throwsCode(
    () => host.normalizePreviewSelection({ lens: "time", memories: sparse }),
    "MEMORY_LENS_MEMORY_COUNT_INVALID",
    "host refuses sparse source arrays"
  );
  throwsCode(
    () => host.normalizePreviewSelection({ lens: "time", memories: [savedMemory("lens-a"), savedMemory("lens-b")], query: "hidden" }),
    "MEMORY_LENS_QUERY_INVALID",
    "non-clue request cannot smuggle a query"
  );
}

async function checkPreviewClient() {
  const calls = [];
  const privateCanary = "PRIVATE RAW CONTENT";
  const signal = new AbortController().signal;
  const client = host.createPreviewClient({
    fetch: async (url, options) => {
      calls.push({ url, options });
      return response({ preview: { marker: "server-preview" } });
    }
  });
  const payload = await client({
    lens: "clue",
    memories: [savedMemory("lens-a", privateCanary), savedMemory("lens-b", privateCanary)],
    query: "雨夜 礼堂"
  }, { signal, requestId: 9 });
  deepEqual(payload, { preview: { marker: "server-preview" } }, "preview client returns the server envelope");
  equal(calls.length, 1, "one explicit run produces one request");
  const call = calls[0];
  equal(call.options.method, "GET", "preview uses GET");
  equal(Object.hasOwn(call.options, "body"), false, "preview request has no body");
  equal(Object.hasOwn(call.options.headers, "Content-Type"), false, "preview request has no request content type");
  equal(call.options.signal, signal, "controller AbortSignal reaches fetch");
  equal(call.options.credentials, "same-origin", "preview remains on the current origin");
  equal(call.options.cache, "no-store", "preview HTTP response is not reused as persisted state");
  const url = new URL(call.url, "http://local.test");
  equal(url.pathname, host.PREVIEW_PATH, "request stays on the fixed local preview path");
  equal(url.searchParams.get("lens"), "clue", "URL contains the explicit lens");
  deepEqual(url.searchParams.getAll("memoryId"), ["lens-a", "lens-b"], "URL contains every explicit ID without widening scope");
  equal(url.searchParams.get("query"), "雨夜 礼堂", "URL contains only the explicit clue query");
  ok(!call.url.includes(privateCanary) && !JSON.stringify(call.options).includes(privateCanary), "private titles and body text are never transmitted");

  const timeCalls = [];
  const timeClient = host.createPreviewClient({ fetch: async (url, options) => {
    timeCalls.push({ url, options });
    return response({ preview: {} });
  } });
  await timeClient({ lens: "time", memories: [savedMemory("lens-a"), savedMemory("lens-b")] });
  equal(new URL(timeCalls[0].url, "http://local.test").searchParams.has("query"), false, "non-clue URL omits query entirely");
}

async function checkMemoryLoader() {
  const calls = [];
  const signal = new AbortController().signal;
  const memories = [savedMemory("lens-a"), savedMemory("lens-b")];
  const loader = host.createMemoryLoader({ fetch: async (url, options) => {
    calls.push({ url, options });
    return response({ schemaVersion: 18, memories });
  } });
  const payload = await loader({ signal });
  equal(payload.memories, memories, "candidate loader returns the current collection envelope");
  equal(calls[0].url, "/api/memories", "candidate loader uses the existing collection endpoint");
  equal(calls[0].options.method, "GET", "candidate loading is read-only GET");
  equal(Object.hasOwn(calls[0].options, "body"), false, "candidate loading has no request body");
  equal(calls[0].options.signal, signal, "candidate loading forwards cancellation");

  const invalid = host.createMemoryLoader({ fetch: async () => response({ memories: null }) });
  await rejectsCode(() => invalid({}), "MEMORY_LENS_COLLECTION_INVALID", "invalid collection envelope fails closed");
}

function checkCuratorHandoff() {
  const current = Array.from({ length: 20 }, (_, index) => savedMemory(`lens-${index}`));
  for (const count of [2, 6]) {
    const brief = curatorBrief(current.slice(0, count));
    const handoff = host.prepareCuratorHandoff(brief, current);
    equal(handoff.format, host.CURATOR_HANDOFF_FORMAT, `${count}-item handoff uses a dedicated transient format`);
    equal(handoff.state, "unsaved-explicit-preselection", `${count}-item handoff is explicitly unsaved`);
    equal(handoff.persisted, false, `${count}-item handoff claims no persistence`);
    equal(handoff.autoRun, false, `${count}-item handoff cannot auto-run curation`);
    equal(handoff.autoSave, false, `${count}-item handoff cannot auto-save`);
    equal(handoff.autoPublish, false, `${count}-item handoff cannot auto-publish`);
    deepEqual(handoff.memoryIds, brief.orderedMemoryIds, `${count}-item handoff preserves the complete explicit order`);
    ok(Object.isFrozen(handoff) && Object.isFrozen(handoff.memoryIds) && Object.isFrozen(handoff.sourceRefs), `${count}-item handoff is deeply immutable`);
    ok(!JSON.stringify(handoff).includes(current[0].rawContent), `${count}-item handoff does not duplicate memory body text`);
  }

  for (const count of [7, 20]) {
    const brief = curatorBrief(current.slice(0, count));
    throwsCode(
      () => host.prepareCuratorHandoff(brief, current),
      "MEMORY_LENS_CURATOR_RESELECT_REQUIRED",
      `${count}-item preview requires a new explicit 2–6 item choice instead of truncation`
    );
  }

  const staleBrief = curatorBrief(current.slice(0, 2));
  const staleCurrent = current.map((memory, index) => index === 0
    ? { ...memory, updatedAt: "2026-07-19T11:59:00.000Z" }
    : memory);
  throwsCode(
    () => host.prepareCuratorHandoff(staleBrief, staleCurrent),
    "MEMORY_LENS_SOURCE_STALE",
    "updated source is not preselected"
  );
  throwsCode(
    () => host.prepareCuratorHandoff(staleBrief, current.slice(1)),
    "MEMORY_LENS_SOURCE_STALE",
    "missing source is not preselected"
  );

  const mismatched = clone(staleBrief);
  mismatched.sourceRefs[0].memoryId = "lens-9";
  throwsCode(
    () => host.prepareCuratorHandoff(mismatched, current),
    "MEMORY_LENS_CURATOR_BRIEF_INVALID",
    "ordered scope must match source receipts"
  );
  const badHash = clone(staleBrief);
  badHash.previewSha256 = "not-a-digest";
  throwsCode(
    () => host.prepareCuratorHandoff(badHash, current),
    "MEMORY_LENS_CURATOR_BRIEF_INVALID",
    "curator bridge rejects an unverified preview digest"
  );
}

async function checkHostWiring() {
  const current = [savedMemory("lens-a"), savedMemory("lens-b")];
  const calls = { controller: [], load: [], preview: [], curate: [] };
  const root = { open: true };
  const lensUi = {
    createController(options) {
      calls.controller.push(options);
      return Object.freeze({ mounted: true, options });
    }
  };
  const loadMemories = async (context) => {
    calls.load.push(context);
    return { memories: current };
  };
  const buildPreview = async (request, context) => {
    calls.preview.push({ request, context });
    return { preview: {} };
  };
  const controller = host.createHost({
    lensUi,
    root,
    loadMemories,
    buildPreview,
    preselectCurator: async (handoff, brief) => { calls.curate.push({ handoff, brief }); }
  });
  equal(controller.mounted, true, "host returns the underlying controller");
  equal(root.open, false, "host mounts the workbench folded by default");
  equal(calls.load.length, 0, "mount does not automatically read the collection");
  equal(calls.preview.length, 0, "mount does not automatically run a lens");
  equal(calls.curate.length, 0, "mount does not automatically preselect curation");
  equal(calls.controller.length, 1, "host creates exactly one UI controller");
  equal(calls.controller[0].loadMemories, loadMemories, "controller receives the explicit lazy collection loader");
  equal(calls.controller[0].buildPreview, buildPreview, "controller receives the GET preview adapter");
  equal(typeof calls.controller[0].onCurate, "function", "curator bridge is enabled only with an explicit callback");

  const brief = curatorBrief(current);
  await calls.controller[0].onCurate(brief);
  equal(calls.load.length, 1, "explicit curate click re-reads sources for freshness");
  equal(calls.load[0].purpose, "curator-freshness", "freshness read is distinguishable from candidate loading");
  equal(calls.curate.length, 1, "fresh 2–6 item brief reaches curator callback once");
  deepEqual(calls.curate[0].handoff.memoryIds, ["lens-a", "lens-b"], "curator receives exact explicit preselection");
  equal(calls.curate[0].brief, brief, "original validated brief remains available to the curator bridge");

  const seven = Array.from({ length: 7 }, (_, index) => savedMemory(`many-${index}`));
  await rejectsCode(
    () => calls.controller[0].onCurate(curatorBrief(seven)),
    "MEMORY_LENS_CURATOR_RESELECT_REQUIRED",
    "host refuses seven items before any curator handoff"
  );
  equal(calls.load.length, 1, "seven-item brief is rejected before even a freshness read");
  equal(calls.curate.length, 1, "seven-item brief never reaches curator callback");

  const noCuratorCalls = [];
  host.createHost({
    lensUi: { createController(options) { noCuratorCalls.push(options); return {}; } },
    root: { open: true },
    loadMemories,
    buildPreview
  });
  equal(noCuratorCalls[0].onCurate, null, "curator action stays disabled when no explicit bridge exists");

  const compatibleCalls = [];
  const compatibleControllers = [];
  host.createHost({
    lensUi: { createController(options) { compatibleControllers.push(options); return {}; } },
    root: { open: true },
    loadMemories,
    buildPreview,
    onCurate: async (originalBrief, handoff) => compatibleCalls.push({ originalBrief, handoff })
  });
  await compatibleControllers[0].onCurate(brief);
  equal(compatibleCalls[0].originalBrief, brief, "legacy onCurate callback keeps the original brief as its first argument");
  deepEqual(compatibleCalls[0].handoff.memoryIds, ["lens-a", "lens-b"], "legacy onCurate callback receives safe preselection metadata as its second argument");
}

async function checkResponseFailures() {
  const badJsonClient = host.createPreviewClient({
    fetch: async () => ({ ok: true, status: 200, async json() { throw new SyntaxError("bad json"); } })
  });
  await rejectsCode(
    () => badJsonClient({ lens: "time", memories: [savedMemory("lens-a"), savedMemory("lens-b")] }),
    "MEMORY_LENS_RESPONSE_INVALID",
    "invalid JSON response fails closed"
  );

  const denied = host.createPreviewClient({
    fetch: async () => response({ error: "只读镜片请求被拒绝。", code: "MEMORY_LENS_DENIED" }, false, 403)
  });
  await rejectsCode(
    () => denied({ lens: "time", memories: [savedMemory("lens-a"), savedMemory("lens-b")] }),
    "MEMORY_LENS_DENIED",
    "server error code is preserved for the UI"
  );
}

function checkStaticBoundary() {
  const source = fs.readFileSync(path.join(__dirname, "..", "public", "assets", "memory-lens-host.js"), "utf8");
  ok(!/localStorage|sessionStorage|indexedDB/u.test(source), "host has zero browser persistence");
  ok(!/method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/u.test(source), "host issues no write HTTP method");
  ok(!/WebSocket|EventSource|sendBeacon|XMLHttpRequest/u.test(source), "host has no alternate network channel");
  ok(!/JSON\.stringify\(request\.memories|body:\s*request/u.test(source), "host never serializes client memory objects");
  ok(source.includes('params.append("memoryId", memoryId)') && !source.includes('params.append("memory"'), "preview query carries IDs rather than memory payloads");
  ok(source.includes("system不会静默截断") || source.includes("系统不会静默截断"), "seven-to-twenty item branch explicitly refuses silent truncation");
  ok(source.includes("autoRun: false") && source.includes("autoSave: false") && source.includes("autoPublish: false"), "curator handoff freezes no-run/no-save/no-publish flags");
  ok(source.includes("rootElement.open = false"), "host preserves a folded default entry");
}

function savedMemory(id, rawContent = "只留在浏览器当前视图中的正文") {
  const suffix = Number.parseInt(String(id).match(/\d+$/u)?.[0] || "0", 10);
  return {
    id,
    title: `展品 ${id}`,
    date: "2025-06",
    rawContent,
    updatedAt: new Date(Date.UTC(2026, 6, 19, 10, suffix % 60, 0, 0)).toISOString()
  };
}

function curatorBrief(memories) {
  return {
    format: "time-isle.memory-lens-curator-brief",
    version: 1,
    state: "unsaved-preview",
    persisted: false,
    engine: "deterministic-memory-lenses-v1",
    lens: { code: "time", label: "时间镜片", boundary: "只看明确日期" },
    query: "",
    sourceRefs: memories.map((memory) => ({ memoryId: memory.id, updatedAt: memory.updatedAt })),
    sourceSnapshotSha256: "a".repeat(64),
    previewSha256: "b".repeat(64),
    orderedMemoryIds: memories.map((memory) => memory.id),
    groupSummaries: [],
    boundary: "仍需用户决定。"
  };
}

function response(payload, ok = true, status = 200) {
  return { ok, status, async json() { return payload; } };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function ok(value, message) {
  assertions += 1;
  assert.ok(value, message);
}

function equal(actual, expected, message) {
  assertions += 1;
  assert.equal(actual, expected, message);
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
