"use strict";

const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const { applyMigrations, listAppliedMigrations, readUserVersion } = require("../lib/migrations");
const { initializeRevisitDatabase } = require("../lib/revisit-database");
const {
  REVISIT_INTENT_REDACTED_NOTE,
  initializeRevisitIntentDatabase
} = require("../lib/revisit-intent-database");
const { selectRevisits } = require("../lib/revisit-service");
const { createRevisitApi } = require("../lib/revisit-api");

const TEST_MIGRATIONS = [5, 7, 8, 9, 10].map((version) => Object.freeze({
  version,
  name: `revisit-intent-test-v${version}`,
  up() {}
}));

let assertions = 0;

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});

async function main() {
  checkMigrationAndDatabase();
  checkIntentSelection();
  checkBackupRestore();
  await checkIntentApi();
  console.log(`Revisit intent checks passed: ${assertions} assertions.`);
}

function checkMigrationAndDatabase() {
  const fixture = createFixture("database");
  try {
    deepEqual(listAppliedMigrations(fixture.db).map((entry) => entry.version), [4, 5, 6, 7, 8, 9, 10, 11], "fresh 数据库按顺序走到 schema 11");
    equal(readUserVersion(fixture.db), 11, "schema 11 写入 PRAGMA user_version");
    const ledgerBefore = JSON.stringify(listAppliedMigrations(fixture.db));
    initializeRevisitIntentDatabase({ db: fixture.db, schemaVersion: 11, now: () => fixture.clock.value });
    equal(JSON.stringify(listAppliedMigrations(fixture.db)), ledgerBefore, "重复初始化只校验账本且不改写");

    fixture.insertMemory("welcome-memory");
    fixture.clock.value = "2026-07-18T01:00:00.000Z";
    const welcome = fixture.intents.setRevisitIntent({ memoryId: "welcome-memory", intent: "welcome" });
    equal(welcome.intent, "welcome", "welcome 意愿保存为显式行");
    equal(fixture.intents.getRevisitIntent("welcome-memory").updatedAt, welcome.updatedAt, "get 返回已保存意愿");

    fixture.clock.value = "2026-07-18T02:00:00.000Z";
    const noOp = fixture.intents.setRevisitIntent({ memoryId: "welcome-memory", intent: "welcome" });
    equal(noOp.updatedAt, welcome.updatedAt, "相同意愿保存为 no-op 且不更新时间");

    const later = fixture.intents.setRevisitIntent({
      memoryId: "welcome-memory",
      intent: "later",
      notBeforeLocalDate: "2026-08-01",
      notBeforeTimezone: "Asia/Shanghai"
    });
    equal(later.intent, "later", "later 意愿可以替换 welcome");
    equal(later.notBeforeTimezone, "Asia/Shanghai", "later 时区规范化后保存");
    equal(later.createdAt, welcome.createdAt, "意愿更新保留首次创建时间");
    equal(later.updatedAt, fixture.clock.value, "真实变化才更新时间");

    fixture.insertMemory("clock-rollback-memory");
    fixture.clock.value = "2030-01-01T00:00:00.000Z";
    const beforeClockRollback = fixture.intents.setRevisitIntent({ memoryId: "clock-rollback-memory", intent: "welcome" });
    fixture.clock.value = "2025-01-01T00:00:00.000Z";
    const afterClockRollback = fixture.intents.setRevisitIntent({ memoryId: "clock-rollback-memory", intent: "pause" });
    ok(Date.parse(afterClockRollback.updatedAt) > Date.parse(beforeClockRollback.updatedAt), "系统时钟回拨时仍生成单调更新时间");
    ok(fixture.intents.validateRevisitIntentBackup(fixture.intents.buildRevisitIntentBackup("full"), ["welcome-memory", "clock-rollback-memory"]), "时钟回拨后的完整意愿备份仍可自验真");
    fixture.intents.clearRevisitIntent("clock-rollback-memory");
    fixture.clock.value = "2026-07-18T03:00:00.000Z";

    throwsCode(
      () => fixture.intents.setRevisitIntent({ memoryId: "welcome-memory", intent: "later", notBeforeLocalDate: "2026-02-30", notBeforeTimezone: "UTC" }),
      "REVISIT_LOCAL_DATE_INVALID",
      "later 拒绝不存在的本地日期"
    );
    throwsCode(
      () => fixture.intents.setRevisitIntent({ memoryId: "welcome-memory", intent: "later", notBeforeLocalDate: "2026-08-01", notBeforeTimezone: "Mars/Olympus" }),
      "REVISIT_TIMEZONE_INVALID",
      "later 拒绝非 IANA 时区"
    );
    throwsCode(
      () => fixture.intents.setRevisitIntent({ memoryId: "welcome-memory", intent: "pause", notBeforeLocalDate: "2026-08-01", notBeforeTimezone: "UTC" }),
      "REVISIT_INTENT_CONTEXT_INVALID",
      "pause 不能夹带延后日期"
    );
    throwsCode(
      () => fixture.intents.setRevisitIntent({ memoryId: "missing", intent: "welcome" }),
      "REVISIT_INTENT_MEMORY_NOT_FOUND",
      "意愿不能引用不存在的展品"
    );

    deepEqual(fixture.intents.getRevisitIntentStats(), { intents: 1, welcome: 0, later: 1, pause: 0 }, "意愿统计只计算持久非 neutral 行");
    deepEqual(fixture.intents.listRevisitIntents().map((entry) => entry.memoryId), ["welcome-memory"], "意愿列表稳定按展品 ID 排序");
    ok(fixture.intents.clearRevisitIntent("welcome-memory").cleared, "clear 单件意愿恢复 neutral");
    equal(fixture.intents.getRevisitIntent("welcome-memory"), null, "neutral 不保存冗余数据库行");

    fixture.intents.setRevisitIntent({ memoryId: "welcome-memory", intent: "pause" });
    fixture.db.prepare("DELETE FROM memories WHERE id = ?").run("welcome-memory");
    equal(fixture.intents.getRevisitIntent("welcome-memory"), null, "删除展品通过外键级联清理意愿");
  } finally {
    fixture.close();
  }

  const limited = createFixture("limit");
  try {
    for (let index = 0; index <= 500; index += 1) limited.insertMemory(`limit-${index}`);
    for (let index = 0; index < 500; index += 1) {
      limited.intents.setRevisitIntent({ memoryId: `limit-${index}`, intent: index % 2 ? "welcome" : "pause" });
    }
    equal(limited.intents.getRevisitIntentStats().intents, 500, "数据库允许最多 500 条意愿");
    throwsCode(
      () => limited.intents.setRevisitIntent({ memoryId: "limit-500", intent: "welcome" }),
      "REVISIT_INTENT_LIMIT",
      "第 501 条意愿被拒绝"
    );
  } finally {
    limited.close();
  }

  const failed = createFixture("migration-failure", { initializeIntent: false });
  try {
    failed.db.exec("CREATE TABLE memory_revisit_intents (memory_id TEXT PRIMARY KEY)");
    throwsCode(
      () => initializeRevisitIntentDatabase({ db: failed.db, schemaVersion: 11, now: () => failed.clock.value }),
      "MIGRATION_APPLY_FAILED",
      "v11 DDL 失败时迁移整体回滚"
    );
    equal(readUserVersion(failed.db), 10, "失败迁移保持 schema 10");
    ok(!listAppliedMigrations(failed.db).some((entry) => entry.version === 11), "失败迁移不留下 v11 账本墓碑");
  } finally {
    failed.close();
  }
}

function checkIntentSelection() {
  const memories = [
    memory("due", "2024-07-18"),
    memory("future", "2024-07-18"),
    memory("neutral", "2024-07-18"),
    memory("pause", "2024-07-18"),
    memory("welcome", "2024-07-18"),
    memory("welcome-wrong-day", "2024-07-17")
  ];
  const intents = [
    intent("due", "later", "2026-07-18", "Asia/Shanghai"),
    intent("future", "later", "2026-07-19", "Asia/Shanghai"),
    intent("pause", "pause"),
    intent("welcome", "welcome"),
    intent("welcome-wrong-day", "welcome")
  ];
  const result = selectRevisits(memories, [], {
    kind: "on-this-day",
    localDate: "2026-07-18",
    timezone: "Asia/Shanghai",
    now: "2026-07-18T04:00:00.000Z",
    intents,
    limit: 20
  });
  deepEqual(result.items.map((entry) => entry.memory.id), ["due", "welcome", "neutral"], "到期 later 与 welcome 只在原资格集合内稳定优先");
  ok(!result.items.some((entry) => entry.memory.id === "welcome-wrong-day"), "welcome 不突破往年今日硬条件");
  ok(!result.items.some((entry) => ["future", "pause"].includes(entry.memory.id)), "未到期 later 与 pause 被排除");
  equal(result.items[0].intent.choice, "later", "候选回显用户明确的 later 意愿");
  equal(result.items[1].basis.revisitIntent.source, "user-confirmed", "排序依据明确标为用户确认而非模型判断");
  ok(result.items[0].reason.includes("已到你选择的 2026-07-18"), "later 理由只陈述日期事实");

  const handled = selectRevisits(memories, [{
    memoryId: "welcome",
    lastViewedAt: "2026-07-18T01:00:00.000Z",
    lastViewedLocalDate: "2026-07-18",
    lastViewedTimezone: "Asia/Shanghai",
    viewCount: 1,
    updatedAt: "2026-07-18T01:00:00.000Z"
  }], {
    kind: "on-this-day",
    localDate: "2026-07-18",
    timezone: "Asia/Shanghai",
    now: "2026-07-18T04:00:00.000Z",
    intents,
    limit: 20
  });
  ok(!handled.items.some((entry) => entry.memory.id === "welcome"), "welcome 不覆盖同日本地时区的 viewed 去重");

  const crossZoneBefore = selectRevisits([memory("ny", "2024-07-18")], [], {
    kind: "on-this-day",
    localDate: "2026-07-18",
    timezone: "Asia/Shanghai",
    now: "2026-07-18T02:00:00.000Z",
    intents: [intent("ny", "later", "2026-07-18", "America/New_York")],
    limit: 5
  });
  equal(crossZoneBefore.items.length, 0, "later 按保存时区判断，在纽约日期到达前继续排除");
  const crossZoneDue = selectRevisits([memory("ny", "2024-07-18")], [], {
    kind: "on-this-day",
    localDate: "2026-07-18",
    timezone: "Asia/Shanghai",
    now: "2026-07-18T16:00:00.000Z",
    intents: [intent("ny", "later", "2026-07-18", "America/New_York")],
    limit: 5
  });
  equal(crossZoneDue.items.length, 1, "保存时区进入目标日期后 later 恢复资格");

  const allDeferred = selectRevisits([memory("paused-only", "2024-07-18")], [], {
    kind: "on-this-day",
    localDate: "2026-07-18",
    timezone: "UTC",
    now: "2026-07-18T12:00:00.000Z",
    intents: [intent("paused-only", "pause")]
  });
  ok(allDeferred.emptyReason.includes("明确设置为稍后或暂停"), "全被意愿过滤时返回事实化空状态");
}

function checkBackupRestore() {
  const source = createFixture("backup-source");
  const target = createFixture("backup-target");
  const capacity = createFixture("backup-capacity");
  try {
    source.insertMemory("source-a");
    source.insertMemory("source-b");
    source.insertMemory("source-outside");
    source.intents.setRevisitIntent({ memoryId: "source-a", intent: "welcome" });
    source.clock.value = "2026-07-19T00:00:00.000Z";
    source.intents.setRevisitIntent({ memoryId: "source-b", intent: "later", notBeforeLocalDate: "2027-01-01", notBeforeTimezone: "Asia/Shanghai" });
    source.intents.setRevisitIntent({ memoryId: "source-outside", intent: "pause" });

    const full = source.intents.buildRevisitIntentBackup("full", ["source-a", "source-b"]);
    equal(full.schemaVersion, 11, "完整意愿备份使用 schema 11 合同");
    deepEqual(full.intents.map((entry) => entry.memoryId), ["source-a", "source-b"], "部分备份不越过馆藏边界");
    ok(source.intents.validateRevisitIntentBackup(full, ["source-a", "source-b"]), "完整意愿备份写入前严格验证");
    const wideBoundary = Array.from({ length: 501 }, (_unused, index) => `wide-memory-${index}`);
    equal(source.intents.buildRevisitIntentBackup("full", wideBoundary).intents.length, 0, "展品边界数量不误用 500 条意愿容量限制");

    const redacted = source.intents.buildRevisitIntentBackup("redacted", ["source-a", "source-b"]);
    deepEqual(redacted, { mode: "redacted-summary", intentCount: 2, note: REVISIT_INTENT_REDACTED_NOTE }, "脱敏备份只有总数与固定说明");
    const redactedJson = JSON.stringify(redacted);
    for (const forbidden of ["source-a", "welcome", "later", "2027-01-01", "Asia/Shanghai"]) {
      ok(!redactedJson.includes(forbidden), `脱敏意愿物理排除 ${forbidden}`);
    }
    ok(source.intents.validateRevisitIntentBackup(redacted, []), "脱敏意愿摘要可独立验证");

    const duplicate = structuredClone(full);
    duplicate.intents.push(structuredClone(duplicate.intents[0]));
    throwsCode(() => source.intents.validateRevisitIntentBackup(duplicate, ["source-a", "source-b"]), "REVISIT_INTENT_BACKUP_DUPLICATE", "完整备份拒绝重复意愿");
    const outside = structuredClone(full);
    outside.intents[0].memoryId = "source-outside";
    throwsCode(() => source.intents.validateRevisitIntentBackup(outside, ["source-a", "source-b"]), "REVISIT_INTENT_BACKUP_REFERENCE_INVALID", "完整备份拒绝边界外引用");
    const extra = structuredClone(full);
    extra.intents[0].note = "不应存在";
    throwsCode(() => source.intents.validateRevisitIntentBackup(extra, ["source-a", "source-b"]), "REVISIT_INTENT_BACKUP_INVALID", "完整备份拒绝自由文本或额外字段");

    target.insertMemory("target-a");
    target.insertMemory("target-b");
    const restored = target.intents.restoreRevisitIntentBackup(full, new Map([
      ["source-a", "target-a"], ["source-b", "target-b"]
    ]));
    equal(restored.intents, 2, "恢复全部意愿");
    deepEqual(restored.idMap, { "source-a": "target-a", "source-b": "target-b" }, "恢复公开确定的展品 ID 映射");
    equal(target.intents.getRevisitIntent("target-a").intent, "welcome", "恢复保留 welcome");
    equal(target.intents.getRevisitIntent("target-b").notBeforeTimezone, "Asia/Shanghai", "恢复保留 later 本地时区");
    equal(target.intents.restoreRevisitIntentBackup(redacted, {}).intents, 0, "脱敏摘要恢复为零写入");
    throwsCode(
      () => target.intents.restoreRevisitIntentBackup(full, new Map([["source-a", "target-a"], ["source-b", "target-a"]])),
      "REVISIT_INTENT_BACKUP_MAPPING_COLLISION",
      "恢复拒绝把两个源意愿折叠到同一目标展品"
    );

    capacity.insertMemory("capacity-a");
    capacity.insertMemory("capacity-b");
    capacity.intents.setRevisitIntent({ memoryId: "capacity-a", intent: "pause" });
    for (let index = 0; index < 499; index += 1) {
      const memoryId = `capacity-fill-${index}`;
      capacity.insertMemory(memoryId);
      capacity.intents.setRevisitIntent({ memoryId, intent: "welcome" });
    }
    equal(capacity.intents.getRevisitIntentStats().intents, 500, "恢复容量场景先达到全库硬上限");
    throwsCode(
      () => capacity.intents.restoreRevisitIntentBackup(full, new Map([
        ["source-a", "capacity-a"], ["source-b", "capacity-b"]
      ])),
      "REVISIT_INTENT_LIMIT",
      "恢复在写入前拒绝把全库意愿扩到 500 条以上"
    );
    equal(capacity.intents.getRevisitIntent("capacity-a").intent, "pause", "容量拒绝会回滚已有目标的覆盖");
    equal(capacity.intents.getRevisitIntent("capacity-b"), null, "容量拒绝不会留下部分新增意愿");
  } finally {
    source.close();
    target.close();
    capacity.close();
  }
}

async function checkIntentApi() {
  const fixture = createFixture("api");
  try {
    fixture.insertMemory("api-a");
    fixture.insertMemory("api-b");
    const memories = [memory("api-a", "2024-07-18"), memory("api-b", "2024-07-18")];
    let bodyReads = 0;
    const dependencies = {
      database: fixture.revisits,
      intentDatabase: fixture.intents,
      store: { listMemories: () => memories },
      sendJson: (_response, status, payload) => ({ status, payload }),
      readJsonBody: async (incoming) => { bodyReads += 1; return incoming.body || {}; },
      httpError,
      now: () => fixture.clock.value,
      decorateMemory: (item) => ({ ...item, decorated: true })
    };
    const api = createRevisitApi(dependencies);

    const initial = await api.handle(request("GET"), {}, url("/api/revisits/api-a/intent"));
    deepEqual(initial.payload.intent, { memoryId: "api-a", choice: "neutral", notBeforeLocalDate: "", timezone: "", updatedAt: "" }, "单件 GET 用无记录表达 neutral");
    const emptyList = await api.handle(request("GET"), {}, url("/api/revisits/intents"));
    equal(emptyList.payload.count, 0, "意愿列表初始为空且 GET 零写入");

    fixture.clock.value = "2026-07-18T01:00:00.000Z";
    const saved = await api.handle(request("PUT", {
      choice: "welcome", notBeforeLocalDate: "", timezone: "", confirm: true
    }), {}, url("/api/revisits/api-b/intent"));
    equal(saved.payload.intent.choice, "welcome", "PUT 保存 welcome");
    const firstUpdatedAt = saved.payload.intent.updatedAt;
    fixture.clock.value = "2026-07-18T02:00:00.000Z";
    const noOp = await api.handle(request("PUT", {
      choice: "welcome", notBeforeLocalDate: "", timezone: "", confirm: true
    }), {}, url("/api/revisits/api-b/intent"));
    equal(noOp.payload.intent.updatedAt, firstUpdatedAt, "API 同值 PUT 保持更新时间不变");

    const list = await api.handle(request("GET"), {}, url("/api/revisits/intents"));
    equal(list.payload.intents[0].memory.title, "api-b", "管理列表只附带最小展品标题");
    deepEqual(Object.keys(list.payload.intents[0].memory).sort(), ["id", "title"], "管理列表不返回正文或心理字段");

    const selected = await api.handle(request("GET"), {}, url("/api/revisits?kind=on-this-day&localDate=2026-07-18&timezone=Asia%2FShanghai&limit=2"));
    equal(selected.payload.revisits[0].memory.id, "api-b", "现有 GET 在原硬条件内优先 welcome");
    equal(selected.payload.revisits[0].intent.choice, "welcome", "候选 API 回显明确意愿");

    await rejectsStatus(
      () => api.handle(request("PUT", { choice: "later", notBeforeLocalDate: "2026-02-30", timezone: "UTC", confirm: true }), {}, url("/api/revisits/api-a/intent")),
      400,
      "API 拒绝无效 later 日期"
    );
    await rejectsStatus(
      () => api.handle(request("PUT", { choice: "welcome", notBeforeLocalDate: "", timezone: "", confirm: false }), {}, url("/api/revisits/api-a/intent")),
      400,
      "API 要求用户明确确认"
    );
    await rejectsStatus(
      () => api.handle(request("PUT", { choice: "welcome", notBeforeLocalDate: "", timezone: "", confirm: true, note: "禁止自由文本" }), {}, url("/api/revisits/api-a/intent")),
      400,
      "API 拒绝额外字段和自由文本"
    );
    await rejectsStatus(
      () => api.handle(request("GET"), {}, url("/api/revisits/intents?include=all")),
      400,
      "意愿读取拒绝扩张查询参数"
    );
    await rejectsStatus(
      () => api.handle(request("GET"), {}, url("/api/revisits/missing/intent")),
      404,
      "单件意愿读取拒绝不存在展品"
    );

    const cleared = await api.handle(request("PUT", {
      choice: "neutral", notBeforeLocalDate: "", timezone: "", confirm: true
    }), {}, url("/api/revisits/api-b/intent"));
    equal(cleared.payload.action, "cleared", "neutral PUT 清除持久意愿");
    equal(fixture.intents.listRevisitIntents().length, 0, "neutral 后数据库不留行");

    const demoFixture = createFixture("demo-api");
    try {
      demoFixture.insertMemory("demo-a");
      let demoBodyReads = 0;
      const demoApi = createRevisitApi({
        ...dependencies,
        database: demoFixture.revisits,
        intentDatabase: demoFixture.intents,
        store: { listMemories: () => [memory("demo-a", "2024-07-18")] },
        interviewDemo: true,
        readJsonBody: async (incoming) => { demoBodyReads += 1; return incoming.body || {}; }
      });
      const demoGet = await demoApi.handle(request("GET"), {}, url("/api/revisits/demo-a/intent"));
      equal(demoGet.payload.intent.choice, "neutral", "Demo 允许只读 neutral 意愿");
      await rejectsStatus(
        () => demoApi.handle(request("PUT", { choice: "welcome", notBeforeLocalDate: "", timezone: "", confirm: true }), {}, url("/api/revisits/demo-a/intent")),
        403,
        "Demo 明确拒绝意愿 PUT"
      );
      equal(demoBodyReads, 0, "Demo 在读取请求体前二次禁写");
      equal(demoFixture.intents.listRevisitIntents().length, 0, "Demo 禁写不留下意愿行");
    } finally {
      demoFixture.close();
    }
    ok(bodyReads >= 5, "本地 API 只在允许写入时读取严格请求体");
  } finally {
    fixture.close();
  }
}

function createFixture(name, options = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE memories (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      raw_content TEXT NOT NULL DEFAULT ''
    );
  `);
  const clock = { value: "2026-07-18T00:00:00.000Z" };
  applyMigrations({ db, baselineVersion: 4, migrations: [TEST_MIGRATIONS[0]], supportedVersion: 11, now: () => clock.value });
  const revisits = initializeRevisitDatabase({ db, schemaVersion: 11, now: () => clock.value });
  applyMigrations({ db, baselineVersion: 4, migrations: TEST_MIGRATIONS.slice(1), supportedVersion: 11, now: () => clock.value });
  const intents = options.initializeIntent === false
    ? null
    : initializeRevisitIntentDatabase({ db, schemaVersion: 11, now: () => clock.value });
  const insert = db.prepare("INSERT INTO memories (id, title, raw_content) VALUES (?, ?, ?)");
  return {
    name,
    db,
    clock,
    revisits,
    intents,
    insertMemory(id) { insert.run(id, id, `原文 ${id}`); },
    close() { db.close(); }
  };
}

function memory(id, date) {
  return { id, title: id, date, createdAt: `${date || "2024-01-01"}T00:00:00.000Z`, rawContent: `原文 ${id}`, exhibitText: `展品说明 ${id}` };
}

function intent(memoryId, choice, notBeforeLocalDate = "", notBeforeTimezone = "") {
  return {
    memoryId,
    intent: choice,
    notBeforeLocalDate,
    notBeforeTimezone,
    updatedAt: "2026-07-17T00:00:00.000Z"
  };
}

function request(method, body) {
  return { method, body };
}

function url(pathname) {
  return new URL(pathname, "http://127.0.0.1");
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
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

function throwsCode(operation, expectedCode, message) {
  assertions += 1;
  assert.throws(operation, (error) => error?.code === expectedCode, message);
}

async function rejectsStatus(operation, expectedStatus, message) {
  assertions += 1;
  await assert.rejects(operation, (error) => error?.statusCode === expectedStatus, message);
}
