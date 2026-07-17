"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createMemoryStore } = require("../database");
const { memoryEtag } = require("../lib/revision-api");

let assertions = 0;
const dbPath = path.join(os.tmpdir(), `time-isle-memory-version-${process.pid}-${Date.now()}.sqlite`);
const realDateNow = Date.now;
let store;

try {
  const fixedNow = Date.parse("2026-07-18T00:00:00.000Z");
  Date.now = () => fixedNow;
  store = createMemoryStore({
    dbPath,
    schemaVersion: 10,
    halls: [{ id: "daily", name: "日常展厅", description: "测试" }]
  });
  const created = store.saveMemory(memory("version-memory", { createdAt: new Date(fixedNow).toISOString(), updatedAt: new Date(fixedNow).toISOString() }), { requireNew: true });
  const first = store.saveMemory({ ...created, title: "同毫秒第一版" }, { requireExisting: true, expectedUpdatedAt: created.updatedAt });
  const second = store.saveMemory({ ...first, title: "同毫秒第二版" }, { requireExisting: true, expectedUpdatedAt: first.updatedAt });

  check(Date.parse(first.updatedAt) === fixedNow + 1, "固定时钟下第一次编辑仍生成严格递增毫秒版本");
  check(Date.parse(second.updatedAt) === fixedNow + 2, "同一毫秒连续编辑不会复用 updatedAt");
  check(memoryEtag(first) !== memoryEtag(second), "严格递增时间会生成不同 ETag");

  const noOp = store.saveMemory({ ...second }, { requireExisting: true, expectedUpdatedAt: second.updatedAt });
  check(noOp.updatedAt === second.updatedAt, "无内容变化仍保持 no-op，不制造新版本时间");
  assert.throws(
    () => store.saveMemory({ ...second, title: "过期写入" }, { requireExisting: true, expectedUpdatedAt: first.updatedAt }),
    (error) => error?.statusCode === 412 && error?.code === "MEMORY_VERSION_CONFLICT"
  );
  assertions += 1;
  check(store.listMemoryRevisions(created.id).length === 3, "创建与两次真实编辑形成连续三版且过期写入零新增");
  console.log(`Memory version checks passed: ${assertions} assertions.`);
} finally {
  Date.now = realDateNow;
  try { store?.close(); } catch { /* keep cleanup deterministic */ }
  for (const suffix of ["", "-shm", "-wal"]) fs.rmSync(`${dbPath}${suffix}`, { force: true });
}

function memory(id, overrides = {}) {
  return {
    schemaVersion: 10,
    id,
    title: "版本测试",
    hall: "daily",
    sourceType: "日记",
    rawContent: "同一毫秒内连续编辑也不能静默覆盖。",
    exhibitText: "用于验证单调版本。",
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
    createdAt: "2026-07-18T00:00:00.000Z",
    updatedAt: "2026-07-18T00:00:00.000Z",
    ...overrides
  };
}

function check(condition, message) {
  assert.ok(condition, message);
  assertions += 1;
}
