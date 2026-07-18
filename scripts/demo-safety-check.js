"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { assertSafeDemoStorage, resetDemoStorage, createDemoCapacityGuard, DEMO_LIMITS } = require("../lib/demo-safety");
const { createCuratorAgentApi } = require("../lib/curator-agent-api");

let assertions = 0;
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ai-memory-museum-demo-safety-"));

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});

async function main() {
  try {
  const safe = assertSafeDemoStorage({
    dbPath: path.join(tempRoot, "ai-memory-museum-demo.sqlite"),
    mediaRoot: path.join(tempRoot, "ai-memory-museum-demo-media"),
    tempRoot
  });
  check(safe.dbPath.endsWith("ai-memory-museum-demo.sqlite"), "专用临时数据库路径应通过校验");
  check(safe.mediaRoot.endsWith("ai-memory-museum-demo-media"), "专用临时媒体路径应通过校验");
  fs.writeFileSync(safe.dbPath, "temporary demo database");
  fs.mkdirSync(safe.mediaRoot, { recursive: true });
  fs.writeFileSync(path.join(safe.mediaRoot, "temporary-media"), "demo");
  resetDemoStorage({ dbPath: safe.dbPath, mediaRoot: safe.mediaRoot, tempRoot });
  check(!fs.existsSync(safe.dbPath) && !fs.existsSync(safe.mediaRoot), "安全校验后才可重置专用 Demo 存储");

  throwsCode(() => assertSafeDemoStorage({
    dbPath: path.join(path.dirname(tempRoot), "unrelated.sqlite"),
    mediaRoot: path.join(tempRoot, "ai-memory-museum-demo-media"),
    tempRoot
  }), "非项目专用名称必须拒绝");
  throwsCode(() => assertSafeDemoStorage({
    dbPath: path.join(tempRoot, "ai-memory-museum-demo.sqlite"),
    mediaRoot: tempRoot,
    tempRoot
  }), "临时目录根本身必须拒绝");
  throwsCode(() => assertSafeDemoStorage({
    dbPath: path.join(tempRoot, "ai-memory-museum-demo.sqlite"),
    mediaRoot: path.resolve(tempRoot, "..", "ai-memory-museum-outside"),
    tempRoot
  }), "越出临时边界的媒体目录必须拒绝");
  throwsCode(() => assertSafeDemoStorage({
    dbPath: path.join(tempRoot, "ai-memory-museum-same"),
    mediaRoot: path.join(tempRoot, "ai-memory-museum-same"),
    tempRoot
  }), "数据库与媒体同路径必须拒绝");
  throwsCode(() => assertSafeDemoStorage({
    dbPath: path.join(tempRoot, "ai-memory-museum-parent", "ai-memory-museum-demo.sqlite"),
    mediaRoot: path.join(tempRoot, "ai-memory-museum-parent"),
    tempRoot
  }), "媒体目录包含数据库路径时必须拒绝");

  let currentMemories = DEMO_LIMITS.memories - 1;
  let transactions = 0;
  let mutations = 0;
  const capacity = createDemoCapacityGuard({
    enabled: true,
    withTransaction: (callback) => { transactions += 1; return callback(); }
  });
  const firstWrite = capacity.write("memories", () => currentMemories, () => { mutations += 1; currentMemories += 1; return currentMemories; });
  check(firstWrite === DEMO_LIMITS.memories, "容量检查与最后一次允许写入应共享同一事务");
  assert.throws(() => capacity.write("memories", () => currentMemories, () => { mutations += 1; }), (error) => error?.statusCode === 429);
  assertions += 1;
  check(transactions === 2 && mutations === 1, "达到上限后的事务不得执行写入回调");

  check(DEMO_LIMITS.curatorAgentRuns === 64, "V10 curator-agent runs have an explicit bounded Demo capacity");
  assert.throws(() => capacity.write("curatorAgentRuns", () => DEMO_LIMITS.curatorAgentRuns, () => {
    mutations += 1;
  }), (error) => error?.statusCode === 429);
  assertions += 1;
  check(mutations === 1, "a full curator-agent Demo capacity never reaches the mutation callback");

  await checkCuratorAgentDemoApi();
  console.log(`Demo safety checks passed: ${assertions} assertions.`);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

async function checkCuratorAgentDemoApi() {
  let persistenceReads = 0;
  let persistenceWrites = 0;
  let bodyReads = 0;
  let sent = null;
  const store = new Proxy({}, {
    get() {
      persistenceReads += 1;
      return () => { persistenceWrites += 1; throw new Error("Demo must not touch persistence."); };
    }
  });
  const api = createCuratorAgentApi({
    store,
    interviewDemo: true,
    sendJson: (_response, statusCode, payload) => {
      sent = { statusCode, payload };
      return true;
    },
    readJsonBody: async () => { bodyReads += 1; return { confirm: true }; },
    httpError: (statusCode, message) => Object.assign(new Error(message), { statusCode })
  });

  await api.handle({ method: "GET", headers: {} }, {}, new URL("http://demo.local/api/curator-agent/sample"));
  check(sent?.statusCode === 200 && sent?.payload?.demo === true && sent?.payload?.synthetic === true,
    "curator-agent sample GET is synthesized explicitly in Demo mode");
  check(persistenceReads === 0 && persistenceWrites === 0 && bodyReads === 0,
    "curator-agent sample GET performs zero persistence and zero body reads");

  await assert.rejects(
    () => api.handle({ method: "POST", headers: {} }, {}, new URL("http://demo.local/api/curator-agent/runs")),
    (error) => error?.statusCode === 403 && error?.code === "CURATOR_AGENT_DEMO_READ_ONLY"
  );
  assertions += 1;
  await assert.rejects(
    () => api.handle({ method: "DELETE", headers: {} }, {}, new URL("http://demo.local/api/curator-agent/runs/curator-run-demo")),
    (error) => error?.statusCode === 403 && error?.code === "CURATOR_AGENT_DEMO_READ_ONLY"
  );
  assertions += 1;
  check(persistenceReads === 0 && persistenceWrites === 0 && bodyReads === 0,
    "Demo POST and DELETE are rejected before persistence, ETag, idempotency, or body processing");
}

function check(value, message) {
  assert.ok(value, message);
  assertions += 1;
}

function throwsCode(callback, message) {
  assert.throws(callback, (error) => error?.code === "DEMO_STORAGE_UNSAFE", message);
  assertions += 1;
}
