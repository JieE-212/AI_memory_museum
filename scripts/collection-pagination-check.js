"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "time-isle-collection-page-"));
const dbPath = path.join(fixtureRoot, "collection.sqlite");
const mediaRoot = path.join(fixtureRoot, "media");
const forbiddenCardFields = ["rawContent", "attachments", "media", "voices", "entityRefs"];

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
});

async function main() {
  await withServer(async (baseUrl) => {
    for (let offset = 0; offset < 500; offset += 25) {
      await Promise.all(Array.from({ length: 25 }, (_, index) => createFixture(baseUrl, offset + index)));
    }

    const first = await readJson(`${baseUrl}/api/memories?view=card&sort=recent&limit=30`);
    assert.equal(first.response.status, 200);
    assert.equal(first.payload.memories.length, 30);
    assert.equal(first.payload.total, 500);
    assert.ok(first.payload.nextCursor);
    assert.ok(Buffer.byteLength(first.text, "utf8") <= 750 * 1024, "首批卡片 JSON 不应超过 750 KiB");
    assert.ok(first.payload.memories.every(isSafeCard), "卡片响应不得包含原文或完整媒体列表");

    const allIds = await collectMemoryPages(baseUrl, "/api/memories?view=card&sort=recent&limit=30");
    assert.equal(allIds.size, 500, "30 件一页遍历时不得重复或遗漏");

    const friends = await readJson(`${baseUrl}/api/memories?view=card&hall=friends&sort=oldest&limit=30`);
    assert.equal(friends.payload.total, 250);
    assert.ok(friends.payload.memories.every((memory) => memory.hall === "friends"));

    const searchIds = await collectSearchPages(baseUrl, "/api/search?query=%E8%A7%84%E6%A8%A1%E5%A4%B9%E5%85%B7&hall=friends&sort=oldest&limit=30");
    assert.equal(searchIds.size, 250, "搜索必须先筛选排序再分页，且不得重复或遗漏");

    const mismatch = await readJson(`${baseUrl}/api/memories?view=card&hall=youth&sort=oldest&limit=30&cursor=${encodeURIComponent(friends.payload.nextCursor)}`);
    assert.equal(mismatch.response.status, 400, "馆藏 cursor 不得跨展厅复用");
  });
  console.log("Collection pagination checks passed: 500 fixtures, 30-card pages, safe projection and bound cursors.");
}

async function createFixture(baseUrl, index) {
  const id = `scale-memory-${String(index).padStart(3, "0")}`;
  const response = await fetch(`${baseUrl}/api/memories`, {
    method: "POST",
    headers: writeHeaders(baseUrl),
    body: JSON.stringify({
      id,
      title: `规模夹具 ${String(index).padStart(3, "0")}`,
      hall: index % 2 ? "friends" : "youth",
      rawContent: `规模夹具 ${index} 的私密原文，不得进入馆藏卡片响应。`.repeat(8),
      exhibitText: `第 ${index + 1} 件完全虚构的分页展品。`,
      date: `${2020 + (index % 6)}-${String((index % 12) + 1).padStart(2, "0")}-${String((index % 27) + 1).padStart(2, "0")}`,
      importance: (index % 5) + 1
    })
  });
  if (response.status !== 201) throw new Error(`第 ${index} 件夹具创建失败：${response.status} ${await response.text()}`);
}

async function collectMemoryPages(baseUrl, initialPath) {
  const ids = new Set();
  let route = initialPath;
  for (let page = 0; page < 30 && route; page += 1) {
    const result = await readJson(`${baseUrl}${route}`);
    assert.equal(result.response.status, 200);
    assert.ok(result.payload.memories.length <= 30);
    for (const memory of result.payload.memories) {
      assert.ok(isSafeCard(memory));
      assert.ok(!ids.has(memory.id), `馆藏分页重复：${memory.id}`);
      ids.add(memory.id);
    }
    route = result.payload.nextCursor
      ? `/api/memories?view=card&sort=recent&limit=30&cursor=${encodeURIComponent(result.payload.nextCursor)}`
      : "";
  }
  return ids;
}

async function collectSearchPages(baseUrl, initialPath) {
  const ids = new Set();
  let route = initialPath;
  for (let page = 0; page < 20 && route; page += 1) {
    const result = await readJson(`${baseUrl}${route}`);
    assert.equal(result.response.status, 200);
    for (const item of result.payload.results) {
      assert.ok(isSafeCard(item.memory));
      assert.ok(!ids.has(item.memory.id), `搜索分页重复：${item.memory.id}`);
      ids.add(item.memory.id);
    }
    route = result.payload.nextCursor
      ? `/api/search?query=%E8%A7%84%E6%A8%A1%E5%A4%B9%E5%85%B7&hall=friends&sort=oldest&limit=30&cursor=${encodeURIComponent(result.payload.nextCursor)}`
      : "";
  }
  return ids;
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
