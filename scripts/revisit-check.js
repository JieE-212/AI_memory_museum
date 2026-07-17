"use strict";

const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const { applyMigrations, listAppliedMigrations, readUserVersion } = require("../lib/migrations");
const {
  normalizeLocalContext,
  parseExplicitCalendarDate,
  selectRevisits
} = require("../lib/revisit-service");
const { initializeRevisitDatabase } = require("../lib/revisit-database");
const { createRevisitApi } = require("../lib/revisit-api");
require("../public/assets/revisits.js");
const { normalizeRevisit: normalizeClientRevisit } = globalThis.TimeIsleRevisits;

const TEST_V5_MIGRATION = Object.freeze({
  version: 5,
  name: "revisit-test-v5-baseline",
  up() {}
});
const TEST_V7_MIGRATION = Object.freeze({
  version: 7,
  name: "revisit-test-future",
  up() {}
});

let assertions = 0;

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});

async function main() {
  checkSelectionService();
  checkClientSelection();
  checkDatabaseAndBackup();
  checkMigrationBoundaries();
  await checkApi();
  console.log(`Revisit checks passed: ${assertions} assertions.`);
}

function checkClientSelection() {
  const payload = {
    revisits: [
      { kind: "random", label: "随机漫游", memory: { id: "hidden-memory", title: "已略过" } },
      { kind: "random", label: "随机漫游", memory: { id: "next-memory", title: "下一件" } }
    ]
  };
  const selected = normalizeClientRevisit(payload, "random", new Set(["hidden-memory"]));
  equal(selected.memory.id, "next-memory", "客户端从多候选中跳过本次会话已处理的展品");
  equal(normalizeClientRevisit(payload, "random", new Set(["hidden-memory", "next-memory"])), null, "客户端在候选全部处理后返回明确空状态");
  equal(normalizeClientRevisit({ revisit: payload.revisits[0] }, "random").memory.id, "hidden-memory", "客户端继续兼容单候选 API 合同");
}

function checkSelectionService() {
  const memories = [
    memory("leap-2024", "2024-02-29", "2024-03-01T00:00:00.000Z"),
    memory("leap-2020", "2020-02-29", "2020-03-01T00:00:00.000Z"),
    memory("feb-28", "2024-02-28", "2024-02-28T00:00:00.000Z"),
    memory("same-year", "2028-02-29", "2028-02-01T00:00:00.000Z"),
    memory("not-explicit", "2024-02-29T08:00:00", "2024-02-01T00:00:00.000Z"),
    memory("invalid-date", "2023-02-29", "2023-02-01T00:00:00.000Z"),
    memory("undated", "", "2019-01-01T00:00:00.000Z"),
    { ...memory("leap-2024", "2016-02-29", "2016-03-01T00:00:00.000Z"), title: "重复项不应覆盖首项" }
  ];
  const snapshot = JSON.stringify(memories);

  const leap = selectRevisits(memories, [], {
    kind: "on-this-day",
    localDate: "2028-02-29",
    timezone: "Asia/Shanghai",
    limit: 10
  });
  deepEqual(leap.items.map((item) => item.memory.id), ["leap-2024", "leap-2020"], "闰日只匹配往年明确填写的 2 月 29 日并按最近年份排序");
  equal(leap.timezone, "Asia/Shanghai", "IANA 时区被规范化后随结果返回");
  equal(leap.items[0].basis.anniversaryYears, 4, "往年今日提供可解释的周年差值");
  ok(leap.items.every((item) => item.basis.type === "explicit-date"), "往年今日明确声明只使用日期证据");
  equal(JSON.stringify(memories), snapshot, "回访选材不修改输入馆藏");

  const ordinaryDay = selectRevisits(memories, [], {
    kind: "on-this-day",
    localDate: "2027-02-28",
    timezone: "Asia/Shanghai",
    limit: 10
  });
  deepEqual(ordinaryDay.items.map((item) => item.memory.id), ["feb-28"], "非闰年的 2 月 28 日不会代替闰日周年");
  ok(!ordinaryDay.items.some((item) => item.memory.id.startsWith("leap-")), "闰日记忆不会被折算到相邻日期");
  ok(parseExplicitCalendarDate("2000-02-29") && !parseExplicitCalendarDate("2100-02-29"), "公历闰年规则覆盖世纪年份");
  ok(!parseExplicitCalendarDate("2024-2-29") && !parseExplicitCalendarDate("2024-02-29T00:00:00Z"), "记忆日期必须严格为 YYYY-MM-DD");

  throwsCode(
    () => selectRevisits(memories, [], { kind: "random", localDate: "2028-02-29" }),
    "REVISIT_TIMEZONE_INVALID",
    "缺少显式时区会被拒绝"
  );
  throwsCode(
    () => normalizeLocalContext({ localDate: "2028-02-30", timezone: "Asia/Shanghai" }),
    "REVISIT_LOCAL_DATE_INVALID",
    "不存在的本地日期会被拒绝"
  );
  throwsCode(
    () => normalizeLocalContext({ localDate: "2028-02-29", timezone: "Mars/Olympus" }),
    "REVISIT_TIMEZONE_INVALID",
    "运行环境不支持的时区会被拒绝"
  );

  const handledInShanghai = [{
    memoryId: "leap-2024",
    lastViewedAt: "2028-02-29T01:00:00.000Z",
    lastViewedLocalDate: "2028-02-29",
    lastViewedTimezone: "Asia/Shanghai",
    viewCount: 1,
    updatedAt: "2028-02-29T01:00:00.000Z"
  }];
  const noRepeat = selectRevisits(memories, handledInShanghai, {
    kind: "on-this-day",
    localDate: "2028-02-29",
    timezone: "Asia/Shanghai",
    limit: 10
  });
  deepEqual(noRepeat.items.map((item) => item.memory.id), ["leap-2020"], "同一本地日期已查看的记忆不会重复推荐");
  const timezoneScoped = selectRevisits(memories, handledInShanghai, {
    kind: "on-this-day",
    localDate: "2028-02-29",
    timezone: "America/New_York",
    limit: 10
  });
  deepEqual(timezoneScoped.items.map((item) => item.memory.id), ["leap-2024", "leap-2020"], "处理状态按显式时区隔离而不是猜测客户端时区");

  const longUnseenMemories = [
    memory("never-new", "", "2024-01-01T00:00:00.000Z"),
    memory("viewed-recent", "", "2018-01-01T00:00:00.000Z"),
    memory("never-old", "", "2019-01-01T00:00:00.000Z"),
    memory("viewed-old", "", "2017-01-01T00:00:00.000Z")
  ];
  const longUnseenStates = [
    viewedState("viewed-recent", "2027-12-01T00:00:00.000Z", "2027-12-01"),
    viewedState("viewed-old", "2020-01-01T00:00:00.000Z", "2020-01-01")
  ];
  const longUnseen = selectRevisits(longUnseenMemories, longUnseenStates, {
    kind: "long-unseen",
    localDate: "2028-02-29",
    timezone: "Asia/Shanghai",
    limit: 10
  });
  deepEqual(
    longUnseen.items.map((item) => item.memory.id),
    ["never-old", "never-new", "viewed-old", "viewed-recent"],
    "很久没见先排从未回访项，再按最久未回访稳定排序"
  );
  ok(longUnseen.items[0].reason.includes("还没有回访"), "很久没见说明排序原因且不生成心理判断");

  const randomA = selectRevisits(memories, [], {
    kind: "random",
    localDate: "2028-03-01",
    timezone: "Asia/Shanghai",
    limit: 20
  });
  const randomB = selectRevisits([...memories].reverse(), [], {
    kind: "random",
    localDate: "2028-03-01",
    timezone: "Asia/Shanghai",
    limit: 20
  });
  deepEqual(randomA.items.map((item) => item.memory.id), randomB.items.map((item) => item.memory.id), "稳定随机不依赖数据库返回顺序且自动去重");
  ok(randomA.items.every((item) => item.basis.type === "stable-daily-rotation"), "随机漫游公开稳定轮换依据");
  equal(new Set(randomA.items.map((item) => item.memory.id)).size, 7, "重复展品 ID 只进入候选集一次");
}

function checkDatabaseAndBackup() {
  const source = createFixture("source");
  const target = createFixture("target");
  try {
    source.insertMemory("source-a");
    source.insertMemory("source-b");
    source.clock.value = "2026-07-16T01:00:00.000Z";
    const firstView = source.revisits.markRevisitViewed({
      memoryId: "source-a",
      localDate: "2026-07-16",
      timezone: "Asia/Shanghai"
    });
    equal(firstView.viewCount, 1, "首次查看创建回访状态");
    source.clock.value = "2026-07-16T02:00:00.000Z";
    const secondView = source.revisits.markRevisitViewed({
      memoryId: "source-a",
      localDate: "2026-07-16",
      timezone: "Asia/Shanghai"
    });
    equal(secondView.viewCount, 2, "重复查看以有界计数累加而不是新增重复状态");
    equal(secondView.createdAt, firstView.createdAt, "更新查看状态保留首次创建时间");

    source.clock.value = "2026-07-16T03:00:00.000Z";
    const dismissed = source.revisits.markRevisitDismissed({
      memoryId: "source-b",
      localDate: "2026-07-16",
      timezone: "Asia/Shanghai"
    });
    equal(dismissed.dismissedLocalDate, "2026-07-16", "隐藏动作保存客户端明确提供的本地日期");
    equal(dismissed.dismissedTimezone, "Asia/Shanghai", "隐藏动作保存规范化时区");
    deepEqual(source.revisits.listRevisitStates().map((item) => item.memoryId), ["source-a", "source-b"], "状态列表按展品 ID 稳定排序");
    throwsCode(
      () => source.revisits.markRevisitViewed({ memoryId: "missing", localDate: "2026-07-16", timezone: "UTC" }),
      "REVISIT_MEMORY_NOT_FOUND",
      "状态不能引用不存在的展品"
    );

    const full = source.revisits.buildRevisitBackup("full");
    ok(full.mode === "full" && full.schemaVersion === 6 && full.states.length === 2, "完整备份包含版本化回访状态");
    const partial = source.revisits.buildRevisitBackup("full", ["source-a"]);
    deepEqual(partial.states.map((state) => state.memoryId), ["source-a"], "部分馆藏备份不会带出边界之外的回访状态");
    ok(source.revisits.validateRevisitBackup(full, ["source-a", "source-b"]), "完整备份在写入前通过结构与引用验证");

    const redacted = source.revisits.buildRevisitBackup("redacted");
    const redactedJson = JSON.stringify(redacted);
    ok(redacted.mode === "redacted-summary" && !Object.hasOwn(redacted, "states"), "脱敏备份物理移除逐展品状态");
    ok(!redactedJson.includes("source-a") && !redactedJson.includes("2026-07-16") && !redactedJson.includes("Asia/Shanghai"), "脱敏备份不含 ID、本地日期、时区或时间戳");
    ok(source.revisits.validateRevisitBackup(redacted, []), "严格脱敏摘要可以独立验证");
    const unsafeRedacted = { ...redacted, states: full.states };
    throwsCode(
      () => source.revisits.validateRevisitBackup(unsafeRedacted, ["source-a", "source-b"]),
      "REVISIT_BACKUP_INVALID",
      "标为脱敏的备份不能夹带逐展品状态"
    );

    const duplicate = structuredClone(full);
    duplicate.states.push(structuredClone(duplicate.states[0]));
    throwsCode(
      () => source.revisits.validateRevisitBackup(duplicate, ["source-a", "source-b"]),
      "REVISIT_BACKUP_DUPLICATE",
      "完整备份拒绝重复状态"
    );
    const outside = structuredClone(full);
    outside.states[0].memoryId = "outside";
    throwsCode(
      () => source.revisits.validateRevisitBackup(outside, ["source-a", "source-b"]),
      "REVISIT_BACKUP_REFERENCE_INVALID",
      "完整备份拒绝馆藏边界之外的引用"
    );
    const inconsistent = structuredClone(full);
    inconsistent.states[0].lastViewedTimezone = "";
    throwsCode(
      () => source.revisits.validateRevisitBackup(inconsistent, ["source-a", "source-b"]),
      "REVISIT_BACKUP_INVALID",
      "完整备份拒绝不成对的本地日期和时区"
    );

    target.insertMemory("target-a");
    target.insertMemory("target-b");
    const mapping = new Map([["source-a", "target-a"], ["source-b", "target-b"]]);
    const restored = target.revisits.restoreRevisitBackup(full, mapping);
    equal(restored.states, 2, "完整备份恢复全部回访状态");
    deepEqual(restored.idMap, { "source-a": "target-a", "source-b": "target-b" }, "恢复结果公开确定的展品 ID 映射");
    equal(target.revisits.getRevisitState("target-a").viewCount, 2, "恢复保留查看次数和时间上下文");
    equal(target.revisits.getRevisitState("target-b").dismissedLocalDate, "2026-07-16", "恢复重写外键并保留隐藏日期");
    ok(!target.revisits.listRevisitStates().some((state) => state.memoryId.startsWith("source-")), "目标数据库不残留源展品外键");
    throwsCode(
      () => target.revisits.restoreRevisitBackup(full, new Map([["source-a", "target-a"], ["source-b", "target-a"]])),
      "REVISIT_BACKUP_MAPPING_COLLISION",
      "恢复拒绝把两个源状态折叠到同一目标展品"
    );
    deepEqual(target.revisits.restoreRevisitBackup(redacted, {}).idMap, {}, "脱敏摘要恢复为明确的零写入结果");

    const purged = target.revisits.clearRevisitStates();
    equal(purged.revisitStatesDeleted, 2, "purge helper 返回实际删除的状态数");
    equal(target.revisits.listRevisitStates().length, 0, "purge helper 清空全部回访状态");
    equal(target.memoryCount(), 2, "purge helper 不越界删除馆藏展品");

    source.insertMemory("cascade-memory");
    source.revisits.markRevisitDismissed({ memoryId: "cascade-memory", localDate: "2026-07-16", timezone: "UTC" });
    source.db.prepare("DELETE FROM memories WHERE id = ?").run("cascade-memory");
    equal(source.revisits.getRevisitState("cascade-memory"), null, "删除展品通过外键级联清理回访状态");
  } finally {
    source.close();
    target.close();
  }
}

function checkMigrationBoundaries() {
  const fixture = createFixture("migration");
  try {
    equal(readUserVersion(fixture.db), 6, "migration v6 更新 PRAGMA user_version");
    deepEqual(listAppliedMigrations(fixture.db).map((item) => item.version), [4, 5, 6], "迁移账本包含 V5 基线和 V6 回访迁移");
    initializeRevisitDatabase({ db: fixture.db, now: () => fixture.clock.value });
    deepEqual(listAppliedMigrations(fixture.db).map((item) => item.version), [4, 5, 6], "重复初始化不会再次应用 migration v6");

    applyMigrations({
      db: fixture.db,
      baselineVersion: 4,
      migrations: [TEST_V7_MIGRATION],
      now: () => fixture.clock.value
    });
    throwsCode(
      () => initializeRevisitDatabase({ db: fixture.db, now: () => fixture.clock.value }),
      "MIGRATION_DATABASE_TOO_NEW",
      "V6 模块拒绝打开带完整账本的未来数据库"
    );
  } finally {
    fixture.close();
  }
}

async function checkApi() {
  const fixture = createFixture("api");
  try {
    fixture.insertMemory("api-2024");
    fixture.insertMemory("api-2020");
    const memories = [
      memory("api-2024", "2024-02-29", "2024-03-01T00:00:00.000Z"),
      memory("api-2020", "2020-02-29", "2020-03-01T00:00:00.000Z")
    ];
    const dependencies = {
      database: fixture.revisits,
      store: { listMemories: () => memories },
      sendJson: (_response, status, payload) => ({ status, payload }),
      readJsonBody: async (request) => request.body || {},
      httpError,
      decorateMemory: (item) => ({ ...item, decorated: true })
    };
    const api = createRevisitApi(dependencies);
    const getUrl = () => new URL("http://127.0.0.1/api/revisits?kind=on-this-day&localDate=2028-02-29&timezone=Asia%2FShanghai&limit=1");

    const first = await api.handle(request("GET"), {}, getUrl());
    ok(first.status === 200 && first.payload.count === 1 && first.payload.revisit.memory.id === "api-2024", "GET 默认只返回一张稳定的今日回访卡");
    ok(first.payload.revisits[0].memory.decorated, "API 支持由服务器注入媒体等公开展品装饰器");
    equal(first.payload.timezone, "Asia/Shanghai", "GET 回显实际采用的规范化时区");

    fixture.clock.value = "2028-02-29T02:00:00.000Z";
    const viewed = await api.handle(
      request("POST", { localDate: "2028-02-29", timezone: "Asia/Shanghai" }),
      {},
      new URL("http://127.0.0.1/api/revisits/api-2024/viewed")
    );
    ok(viewed.status === 200 && viewed.payload.action === "viewed" && viewed.payload.state.viewCount === 1, "viewed 写接口保存浏览状态");
    const next = await api.handle(request("GET"), {}, getUrl());
    equal(next.payload.revisits[0].memory.id, "api-2020", "查看后同一本地日不会重复推荐同一件展品");

    fixture.clock.value = "2028-02-29T03:00:00.000Z";
    const dismissed = await api.handle(
      request("POST", { localDate: "2028-02-29", timezone: "Asia/Shanghai" }),
      {},
      new URL("http://127.0.0.1/api/revisits/api-2020/dismissed")
    );
    ok(dismissed.status === 200 && dismissed.payload.action === "dismissed", "dismissed 写接口保存按日隐藏状态");
    const empty = await api.handle(request("GET"), {}, getUrl());
    ok(empty.payload.count === 0 && empty.payload.emptyReason, "候选处理完后 GET 返回可解释空状态");

    await rejectsStatus(
      () => api.handle(request("GET"), {}, new URL("http://127.0.0.1/api/revisits?kind=random&localDate=2028-02-29")),
      400,
      "GET 强制客户端显式提供时区"
    );
    await rejectsStatus(
      () => api.handle(request("POST", { localDate: "2028-02-29", timezone: "UTC" }), {}, new URL("http://127.0.0.1/api/revisits/missing/viewed")),
      404,
      "写接口对不存在的展品返回 404"
    );
    await rejectsStatus(
      () => api.handle(request("POST", {}), {}, new URL("http://127.0.0.1/api/revisits")),
      405,
      "列表端点拒绝写入方法"
    );
    equal(await api.handle(request("GET"), {}, new URL("http://127.0.0.1/api/not-revisits")), false, "API 对无关路径返回 false 供主路由继续分发");

    const demoFixture = createFixture("demo-api");
    try {
      demoFixture.insertMemory("demo-memory");
      const demoApi = createRevisitApi({
        ...dependencies,
        database: demoFixture.revisits,
        store: { listMemories: () => [memory("demo-memory", "2024-02-29", "2024-03-01T00:00:00.000Z")] },
        interviewDemo: true
      });
      const demoGet = await demoApi.handle(request("GET"), {}, getUrl());
      equal(demoGet.status, 200, "公开 Demo 允许只读回访选材");
      await rejectsStatus(
        () => demoApi.handle(
          request("POST", { localDate: "2028-02-29", timezone: "Asia/Shanghai" }),
          {},
          new URL("http://127.0.0.1/api/revisits/demo-memory/viewed")
        ),
        403,
        "公开 Demo 拒绝 viewed 持久化"
      );
      await rejectsStatus(
        () => demoApi.handle(
          request("POST", { localDate: "2028-02-29", timezone: "Asia/Shanghai" }),
          {},
          new URL("http://127.0.0.1/api/revisits/demo-memory/dismissed")
        ),
        403,
        "公开 Demo 拒绝 dismissed 持久化"
      );
      equal(demoFixture.revisits.listRevisitStates().length, 0, "Demo 写保护不会留下回访状态");
    } finally {
      demoFixture.close();
    }
  } finally {
    fixture.close();
  }
}

function createFixture(name) {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE memories (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      raw_content TEXT NOT NULL DEFAULT ''
    );
  `);
  const clock = { value: "2026-07-16T00:00:00.000Z" };
  applyMigrations({
    db,
    baselineVersion: 4,
    migrations: [TEST_V5_MIGRATION],
    now: () => clock.value
  });
  const revisits = initializeRevisitDatabase({ db, now: () => clock.value });
  const insert = db.prepare("INSERT INTO memories (id, title, raw_content) VALUES (?, ?, ?)");
  return {
    name,
    db,
    clock,
    revisits,
    insertMemory(id) { insert.run(id, id, `原文 ${id}`); },
    memoryCount() { return Number(db.prepare("SELECT COUNT(*) AS count FROM memories").get()?.count) || 0; },
    close() { db.close(); }
  };
}

function memory(id, date, createdAt) {
  return { id, title: id, date, createdAt, rawContent: `原文 ${id}`, exhibitText: `展品说明 ${id}` };
}

function viewedState(memoryId, lastViewedAt, localDate) {
  return {
    memoryId,
    lastViewedAt,
    lastViewedLocalDate: localDate,
    lastViewedTimezone: "Asia/Shanghai",
    viewCount: 1,
    updatedAt: lastViewedAt
  };
}

function request(method, body) {
  return { method, body };
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
