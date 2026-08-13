"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { createMemoryStore } = require("../database");
const { SCHEMA_VERSION } = require("../lib/release-identity");

const root = path.resolve(__dirname, "..");
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "time-isle-collection-page-"));
const dbPath = path.join(fixtureRoot, "collection.sqlite");
const mediaRoot = path.join(fixtureRoot, "media");
const forbiddenCardFields = ["rawContent", "attachments", "media", "voices", "entityRefs"];
const FIXTURE_COUNT = Number(process.env.COLLECTION_FIXTURE_COUNT || 500);
const MUTATION_FIXTURE_COUNT = Math.min(FIXTURE_COUNT, 250);
const fixtureHalls = [
  { id: "daily", name: "Daily", description: "fixture" },
  { id: "friends", name: "Friends", description: "fixture" },
  { id: "youth", name: "Youth", description: "fixture" },
  { id: "family", name: "Family", description: "fixture" },
  { id: "love", name: "Love", description: "fixture" },
  { id: "growth", name: "Growth", description: "fixture" },
  { id: "work", name: "Work", description: "fixture" }
];

main().then(
  () => cleanupFixtureRoot(),
  (error) => {
    console.error(error);
    cleanupFixtureRoot();
    process.exitCode = 1;
  }
);

async function main() {
  seedFixtureDatabase();
  await withServer(async (baseUrl) => {
    const first = await readJson(`${baseUrl}/api/memories?view=card&sort=recent&limit=30`);
    assert.equal(first.response.status, 200);
    assert.equal(first.payload.memories.length, 30);
    assert.equal(first.payload.total, FIXTURE_COUNT);
    assert.ok(first.payload.nextCursor);
    assert.ok(Buffer.byteLength(first.text, "utf8") <= 750 * 1024, "首批卡片 JSON 不应超过 750 KiB");
    assert.ok(first.payload.memories.every(isSafeCard), "卡片响应不得包含原文或完整媒体列表");

    const allIds = await collectMemoryPages(baseUrl, "/api/memories?view=card&sort=recent&limit=100");
    assert.equal(allIds.size, FIXTURE_COUNT, "30 件一页遍历时不得重复或遗漏");

    const friends = await readJson(`${baseUrl}/api/memories?view=card&hall=friends&sort=oldest&limit=30`);
    assert.equal(friends.payload.total, fixtureHallCount("friends"));
    assert.ok(friends.payload.memories.every((memory) => memory.hall === "friends"));

    const searchIds = await collectSearchPages(baseUrl, "/api/search?query=%E8%A7%84%E6%A8%A1%E5%A4%B9%E5%85%B7&sort=oldest&limit=50");
    assert.equal(searchIds.size, FIXTURE_COUNT, "搜索必须先筛选排序再分页，且不得重复或遗漏");

    const mismatch = await readJson(`${baseUrl}/api/memories?view=card&hall=youth&sort=oldest&limit=30&cursor=${encodeURIComponent(friends.payload.nextCursor)}`);
    assert.equal(mismatch.response.status, 400, "馆藏 cursor 不得跨展厅复用");

    await checkStableCollectionContinuation(baseUrl);
    await checkStableSearchContinuation(baseUrl);
  });
  console.log(`Collection pagination checks passed: ${FIXTURE_COUNT} fixtures, 30-card pages, stable keyset continuation, safe projection and bound cursors.`);
}

function cleanupFixtureRoot() {
  fs.rmSync(fixtureRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}

async function checkStableCollectionContinuation(baseUrl) {
  const path = "/api/memories?view=card&hall=friends&sort=recent&limit=30";
  const first = await readJson(`${baseUrl}${path}`);
  assert.equal(first.response.status, 200);
  const firstIds = new Set(first.payload.memories.map((memory) => memory.id));
  const anchorId = first.payload.memories.at(-1).id;
  const baseline = await collectCardContinuation(baseUrl, first.payload.nextCursor, "recent", "friends");
  const predecessor = await getFullMemory(baseUrl, first.payload.memories[0].id);
  const anchor = await getFullMemory(baseUrl, anchorId);
  const successor = await getFullMemory(baseUrl, [...baseline][0]);

  await createCustomFixture(baseUrl, {
    id: "keyset-collection-new-before-anchor",
    title: "Keyset collection new before anchor",
    hall: "friends",
    rawContent: "Keyset collection fixture",
    exhibitText: "Keyset collection fixture",
    date: "2099-01-01"
  });
  const afterInsert = await collectCardContinuation(baseUrl, first.payload.nextCursor, "recent", "friends");
  assertStableContinuation(afterInsert, baseline, firstIds, "collection insert before anchor");
  assert.ok(!afterInsert.has("keyset-collection-new-before-anchor"), "collection keyset continuation excludes an item inserted before the captured anchor");
  await deleteMemory(baseUrl, "keyset-collection-new-before-anchor");

  await deleteMemory(baseUrl, predecessor.id);
  const afterDeleteBeforeAnchor = await collectCardContinuation(baseUrl, first.payload.nextCursor, "recent", "friends");
  assertStableContinuation(afterDeleteBeforeAnchor, baseline, firstIds, "collection delete before anchor");
  await restoreFixture(baseUrl, predecessor);

  const changed = await updateFixture(baseUrl, successor, { mediaNote: "keyset continuation changed without changing recent sort key" });
  const afterUpdateAfterAnchor = await collectCardContinuation(baseUrl, first.payload.nextCursor, "recent", "friends");
  assertStableContinuation(afterUpdateAfterAnchor, baseline, firstIds, "collection update after anchor");
  assert.ok(afterUpdateAfterAnchor.has(successor.id), "collection keyset continuation retains a post-anchor item when non-sort fields change");
  await updateFixture(baseUrl, changed, { mediaNote: successor.mediaNote });

  await deleteMemory(baseUrl, anchorId);
  const afterDeleteAnchor = await collectCardContinuation(baseUrl, first.payload.nextCursor, "recent", "friends");
  assertStableContinuation(afterDeleteAnchor, baseline, firstIds, "collection delete cursor anchor");
  assert.ok(!afterDeleteAnchor.has(anchorId), "deleted collection cursor anchor is not resurrected by continuation");
  await restoreFixture(baseUrl, anchor);
}

async function checkStableSearchContinuation(baseUrl) {
  const query = "规模夹具";
  const path = `/api/search?query=${encodeURIComponent(query)}&hall=friends&sort=recent&limit=30`;
  const initial = await readJson(`${baseUrl}${path}`);
  assert.equal(initial.response.status, 200);
  const firstIds = new Set(initial.payload.results.map((item) => item.memory.id));
  const anchorId = initial.payload.results.at(-1).memory.id;
  const baseline = await collectSearchContinuation(baseUrl, initial.payload.nextCursor, query, "recent", "friends");
  const predecessor = await getFullMemory(baseUrl, initial.payload.results[0].memory.id);
  const anchor = await getFullMemory(baseUrl, anchorId);
  const successor = await getFullMemory(baseUrl, [...baseline][0]);

  await createCustomFixture(baseUrl, {
    id: "keyset-search-new-before-anchor",
    title: "规模夹具 Keyset search new before anchor",
    hall: "friends",
    rawContent: "规模夹具 Keyset search fixture",
    exhibitText: "规模夹具 Keyset search fixture",
    date: "2099-01-02"
  });
  const afterInsert = await collectSearchContinuation(baseUrl, initial.payload.nextCursor, query, "recent", "friends");
  assertStableContinuation(afterInsert, baseline, firstIds, "search insert before anchor");
  assert.ok(!afterInsert.has("keyset-search-new-before-anchor"), "search keyset continuation excludes an item inserted before the captured anchor");
  await deleteMemory(baseUrl, "keyset-search-new-before-anchor");

  await deleteMemory(baseUrl, predecessor.id);
  const afterDeleteBeforeAnchor = await collectSearchContinuation(baseUrl, initial.payload.nextCursor, query, "recent", "friends");
  assertStableContinuation(afterDeleteBeforeAnchor, baseline, firstIds, "search delete before anchor");
  await restoreFixture(baseUrl, predecessor);

  const changed = await updateFixture(baseUrl, successor, { mediaNote: "search keyset continuation changed without changing recent sort key" });
  const afterUpdateAfterAnchor = await collectSearchContinuation(baseUrl, initial.payload.nextCursor, query, "recent", "friends");
  assertStableContinuation(afterUpdateAfterAnchor, baseline, firstIds, "search update after anchor");
  assert.ok(afterUpdateAfterAnchor.has(successor.id), "search keyset continuation retains a post-anchor item when non-sort fields change");
  await updateFixture(baseUrl, changed, { mediaNote: successor.mediaNote });

  await deleteMemory(baseUrl, anchorId);
  const afterDeleteAnchor = await collectSearchContinuation(baseUrl, initial.payload.nextCursor, query, "recent", "friends");
  assertStableContinuation(afterDeleteAnchor, baseline, firstIds, "search delete cursor anchor");
  assert.ok(!afterDeleteAnchor.has(anchorId), "deleted search cursor anchor is not resurrected by continuation");
  await restoreFixture(baseUrl, anchor);

  const legacy = Buffer.from(JSON.stringify({ v: 1, query, hall: "", sort: "recent", offset: 30 }), "utf8").toString("base64url");
  const legacyCollection = Buffer.from(JSON.stringify({ v: 1, view: "card", hall: "", sort: "recent", offset: 30 }), "utf8").toString("base64url");
  assert.equal((await readJson(`${baseUrl}/api/search?query=${encodeURIComponent(query)}&sort=recent&cursor=${encodeURIComponent(legacy)}`)).response.status, 400, "v1 search cursor is explicitly rejected");
  assert.equal((await readJson(`${baseUrl}/api/memories?view=card&sort=recent&cursor=${encodeURIComponent(legacyCollection)}`)).response.status, 400, "v1 collection cursor is explicitly rejected");
  assert.equal((await readJson(`${baseUrl}/api/search?query=${encodeURIComponent(query)}&hall=friends&sort=oldest&cursor=${encodeURIComponent(initial.payload.nextCursor)}`)).response.status, 400, "search cursor cannot cross sort context");
  const collectionFirst = await readJson(`${baseUrl}/api/memories?view=card&hall=friends&sort=recent&limit=30`);
  assert.equal((await readJson(`${baseUrl}/api/memories?view=card&hall=friends&sort=oldest&cursor=${encodeURIComponent(collectionFirst.payload.nextCursor)}`)).response.status, 400, "collection cursor cannot cross sort context");
}

function seedFixtureDatabase() {
  const store = createMemoryStore({ dbPath, halls: fixtureHalls, schemaVersion: SCHEMA_VERSION });
  try {
    store.importMemories(Array.from({ length: FIXTURE_COUNT }, (_, index) => fixtureMemory(index)), { requireNew: true, revisionMode: "defer" });
  } finally {
    store.close();
  }
}

function fixtureMemory(index) {
  const id = `scale-memory-${String(index).padStart(3, "0")}`;
  const createdAt = new Date(Date.UTC(2020, 0, 1, 0, 0, index)).toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    title: `规模夹具 ${String(index).padStart(3, "0")}`,
    hall: fixtureHall(index),
    sourceType: "fixture",
    rawContent: `规模夹具 ${index} 的私密原文，不得进入馆藏卡片响应。`.repeat(8),
    exhibitText: `第 ${index + 1} 件完全虚构的分页展品。`,
    date: `${2020 + (index % 6)}-${String((index % 12) + 1).padStart(2, "0")}-${String((index % 27) + 1).padStart(2, "0")}`,
    location: "",
    people: [],
    tags: [],
    emotions: [],
    emotionIntensity: 3,
    importance: (index % 5) + 1,
    favorite: false,
    coverImage: "",
    mediaNote: "",
    attachments: [],
    agentRunId: "",
    createdAt,
    updatedAt: createdAt
  };
}

function fixtureHallCount(hall) {
  let count = 0;
  for (let index = 0; index < FIXTURE_COUNT; index += 1) if (fixtureHall(index) === hall) count += 1;
  return count;
}

function fixtureHall(index) {
  return index < Math.min(60, MUTATION_FIXTURE_COUNT) ? "friends" : "youth";
}

async function collectMemoryPages(baseUrl, initialPath) {
  const ids = new Set();
  const route = new URL(initialPath, baseUrl);
  let cursor = "";
  for (let page = 0; page < 30; page += 1) {
    if (cursor) route.searchParams.set("cursor", cursor);
    else route.searchParams.delete("cursor");
    const result = await readJson(route.toString());
    assert.equal(result.response.status, 200);
    assert.ok(result.payload.memories.length <= 100);
    for (const memory of result.payload.memories) {
      assert.ok(isSafeCard(memory));
      assert.ok(!ids.has(memory.id), `馆藏分页重复：${memory.id}`);
      ids.add(memory.id);
    }
    cursor = result.payload.nextCursor || "";
    if (!cursor) break;
  }
  return ids;
}

async function collectSearchPages(baseUrl, initialPath) {
  const ids = new Set();
  const route = new URL(initialPath, baseUrl);
  let cursor = "";
  for (let page = 0; page < 20; page += 1) {
    if (cursor) route.searchParams.set("cursor", cursor);
    else route.searchParams.delete("cursor");
    const result = await readJson(route.toString());
    assert.equal(result.response.status, 200);
    for (const item of result.payload.results) {
      assert.ok(isSafeCard(item.memory));
      assert.ok(!ids.has(item.memory.id), `搜索分页重复：${item.memory.id}`);
      ids.add(item.memory.id);
    }
    cursor = result.payload.nextCursor || "";
    if (!cursor) break;
  }
  return ids;
}

async function collectCardContinuation(baseUrl, cursor, sort, hall = "") {
  const ids = new Set();
  let nextCursor = cursor;
  for (let page = 0; page < 30 && nextCursor; page += 1) {
    const params = new URLSearchParams({ view: "card", sort, limit: "30", cursor: nextCursor });
    if (hall) params.set("hall", hall);
    const result = await readJson(`${baseUrl}/api/memories?${params}`);
    assert.equal(result.response.status, 200);
    for (const memory of result.payload.memories) {
      assert.ok(!ids.has(memory.id), `collection keyset continuation duplicate: ${memory.id}`);
      ids.add(memory.id);
    }
    nextCursor = result.payload.nextCursor;
  }
  return ids;
}

async function collectSearchContinuation(baseUrl, cursor, query, sort, hall = "") {
  const ids = new Set();
  let nextCursor = cursor;
  for (let page = 0; page < 30 && nextCursor; page += 1) {
    const params = new URLSearchParams({ query, sort, limit: "30", cursor: nextCursor });
    if (hall) params.set("hall", hall);
    const result = await readJson(`${baseUrl}/api/search?${params}`);
    assert.equal(result.response.status, 200);
    for (const item of result.payload.results) {
      assert.ok(!ids.has(item.memory.id), `search keyset continuation duplicate: ${item.memory.id}`);
      ids.add(item.memory.id);
    }
    nextCursor = result.payload.nextCursor;
  }
  return ids;
}

async function getFullMemory(baseUrl, id) {
  const result = await readJson(`${baseUrl}/api/memories/${encodeURIComponent(id)}`);
  assert.equal(result.response.status, 200);
  return result.payload.memory;
}

async function createCustomFixture(baseUrl, body) {
  const response = await fetch(`${baseUrl}/api/memories`, { method: "POST", headers: writeHeaders(baseUrl), body: JSON.stringify(body) });
  const payload = await response.json();
  assert.equal(response.status, 201, `fixture creation should succeed: ${payload.error || "unknown error"}`);
}

async function deleteMemory(baseUrl, id) {
  const current = await getFullMemory(baseUrl, id);
  const response = await fetch(`${baseUrl}/api/memories/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { ...writeHeaders(baseUrl), "If-Match": memoryEtag(current) }
  });
  assert.equal(response.status, 200);
}

async function updateFixture(baseUrl, memory, patch) {
  const current = await getFullMemory(baseUrl, memory.id);
  const response = await fetch(`${baseUrl}/api/memories/${encodeURIComponent(memory.id)}`, {
    method: "PUT",
    headers: { ...writeHeaders(baseUrl), "If-Match": memoryEtag(current) },
    body: JSON.stringify({ ...current, ...patch, expectedUpdatedAt: current.updatedAt })
  });
  const payload = await response.json();
  assert.equal(response.status, 200, `fixture update should succeed: ${payload.error || "unknown error"}`);
  return payload.memory;
}

function memoryEtag(memory) {
  const version = String(memory?.updatedAt || memory?.createdAt || "");
  return `"memory-${Buffer.from(version, "utf8").toString("base64url")}"`;
}

function assertStableContinuation(actual, expected, firstPageIds, label) {
  assert.equal(actual.size, expected.size, `${label} returns every original post-anchor item exactly once`);
  for (const id of expected) assert.ok(actual.has(id), `${label} keeps original post-anchor item ${id}`);
  for (const id of actual) assert.ok(!firstPageIds.has(id), `${label} does not repeat a first-page item ${id}`);
}

async function restoreFixture(baseUrl, memory) {
  const response = await fetch(`${baseUrl}/api/memories`, { method: "POST", headers: writeHeaders(baseUrl), body: JSON.stringify(memory) });
  assert.equal(response.status, 201);
}

function isSafeCard(memory) {
  return memory && forbiddenCardFields.every((field) => !Object.hasOwn(memory, field));
}

async function readJson(url) {
  const response = await fetch(url);
  const text = await response.text();
  return { response, text, payload: JSON.parse(text) };
}

function writeHeaders(baseUrl) {
  return { Origin: baseUrl, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json" };
}

async function withServer(callback) {
  const port = await freePort();
  const logs = [];
  const child = spawn(process.execPath, [path.join(root, "server.js")], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      BIND_HOST: "127.0.0.1",
      DB_PATH: dbPath,
      MEDIA_ROOT: mediaRoot,
      VOICE_ROOT: path.join(mediaRoot, "voice"),
      AI_API_KEY: "",
      PUBLIC_DEPLOYMENT: "false",
      INTERVIEW_DEMO: "false",
      DEMO_MODE: "false",
      VERCEL: ""
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.on("data", (chunk) => logs.push(chunk.toString()));
  child.stderr.on("data", (chunk) => logs.push(chunk.toString()));
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await waitForHealth(baseUrl, child, logs);
    await callback(baseUrl);
  } catch (error) {
    error.message += `\nServer log:\n${logs.join("")}`;
    throw error;
  } finally {
    if (child.exitCode === null) child.kill("SIGTERM");
    await Promise.race([new Promise((resolve) => child.once("exit", resolve)), new Promise((resolve) => setTimeout(resolve, 2000))]);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
}

async function waitForHealth(baseUrl, child, logs) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`服务提前退出。\n${logs.join("")}`);
    try {
      if ((await fetch(`${baseUrl}/api/health`)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("分页夹具服务未能启动。");
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}
