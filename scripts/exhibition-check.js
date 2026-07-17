"use strict";

const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const { applyMigrations, listAppliedMigrations, readUserVersion } = require("../lib/migrations");
const { buildExhibitionPreview } = require("../lib/exhibition-curator");
const { initializeExhibitionDatabase } = require("../lib/exhibition-database");
const { createExhibitionApi } = require("../lib/exhibition-api");

let assertions = 0;

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});

async function main() {
  checkMigrationRollback();
  checkFutureMigrationRejection();
  checkCurator();
  checkDatabase();
  await checkApi();
  console.log(`Exhibition checks passed: ${assertions} assertions.`);
}

function checkFutureMigrationRejection() {
  const fixture = createFixture("future");
  try {
    fixture.db.prepare(`
      INSERT INTO schema_migrations (version, name, checksum, applied_at)
      VALUES (6, 'future-feature', ?, '2026-07-16T00:00:00.000Z')
    `).run("f".repeat(64));
    fixture.db.exec("PRAGMA user_version = 6");
    assert.throws(
      () => initializeExhibitionDatabase({ db: fixture.db, createId: fixture.createId, now: fixture.now }),
      (error) => error.code === "MIGRATION_DATABASE_TOO_NEW"
    );
    ok(true, "V5 程序拒绝打开带完整账本的未来版本数据库");
  } finally {
    fixture.db.close();
  }
}

function checkMigrationRollback() {
  const db = new DatabaseSync(":memory:");
  try {
    assert.throws(() => applyMigrations({
      db,
      baselineVersion: 4,
      now: () => "2026-07-16T00:00:00.000Z",
      migrations: [{
        version: 5,
        name: "intentional-failure",
        up(connection) {
          connection.exec("CREATE TABLE should_rollback (id TEXT PRIMARY KEY)");
          throw new Error("boom");
        }
      }]
    }), (error) => error.code === "MIGRATION_APPLY_FAILED");
    ok(!tableExists(db, "should_rollback"), "失败迁移回滚其 schema 写入");
    equal(readUserVersion(db), 4, "失败迁移保留基线 user_version");
    deepEqual(listAppliedMigrations(db).map((item) => item.version), [4], "失败迁移不污染账本");
  } finally {
    db.close();
  }
}

function checkCurator() {
  const memories = fixtureMemories();
  const snapshot = JSON.stringify(memories);
  const preview = buildExhibitionPreview(memories, { theme: "毕业季" });
  equal(preview.theme, "毕业季", "预览尊重用户指定主题");
  equal(preview.mode, "evidence-rules", "预览声明本地证据规则模式");
  ok(preview.requiresConfirmation === true, "预览明确要求用户确认");
  ok(preview.sections.length >= 1 && preview.sections.length <= 3, "预览最多生成三个章节");
  const items = preview.sections.flatMap((section) => section.items);
  equal(items.length, memories.length, "每件用户选定展品只进入一次展览");
  equal(new Set(items.map((item) => item.memoryId)).size, memories.length, "策展结果不重复展品");
  items.forEach((item) => {
    const memory = memories.find((candidate) => candidate.id === item.memoryId);
    item.citations.forEach((citation) => {
      equal(memory.rawContent.slice(citation.startOffset, citation.endOffset), citation.quote, "每条引用均可回到原文切片");
      ok(citation.evidenceValid && citation.field === "rawContent", "引用标明有效原文字段");
    });
  });
  equal(JSON.stringify(memories), snapshot, "纯策展函数不修改输入记忆");
  assert.throws(
    () => buildExhibitionPreview([memories[0], memories[0]]),
    (error) => error.code === "EXHIBITION_MEMORY_DUPLICATE"
  );
  ok(true, "策展函数拒绝重复展品");
  assert.throws(
    () => buildExhibitionPreview([{ ...memories[0], rawContent: "" }, memories[1]]),
    (error) => error.code === "EXHIBITION_SOURCE_EMPTY"
  );
  ok(true, "策展函数拒绝无法引用的空原文");
}

function checkDatabase() {
  const fixture = createFixture("source");
  const target = createFixture("target");
  const capacity = createFixture("capacity");
  try {
    const preview = buildExhibitionPreview(fixture.memories, { theme: "校园", title: "操场与车站" });
    assert.throws(
      () => fixture.exhibitions.createExhibition(preview),
      (error) => error.code === "EXHIBITION_CONFIRMATION_REQUIRED"
    );
    ok(true, "数据库层拒绝未经确认的策展预览");

    const first = fixture.exhibitions.createExhibition({ ...preview, confirmed: true });
    ok(first.id && first.requiresConfirmation === false, "确认后持久化并返回稳定展览 ID");
    equal(first.sections.flatMap((section) => section.items).length, 3, "数据库保存全部章节成员");
    ok(first.sections.flatMap((section) => section.items).every((item) => item.citations.every((citation) => citation.evidenceValid)), "数据库重新核验全部原文引用");
    equal(readUserVersion(fixture.db), 5, "migration 5 更新 PRAGMA user_version");
    deepEqual(listAppliedMigrations(fixture.db).map((item) => item.version), [4, 5], "迁移账本记录基线与展览迁移");

    initializeExhibitionDatabase({
      db: fixture.db,
      now: fixture.now,
      createId: fixture.createId
    });
    deepEqual(listAppliedMigrations(fixture.db).map((item) => item.version), [4, 5], "重复启动不会重复应用 migration 5");

    const secondPreview = buildExhibitionPreview(fixture.memories.slice(0, 2), { theme: "同行" });
    const second = fixture.exhibitions.createExhibition({ ...secondPreview, confirm: true });
    ok(second.memoryIds.includes(fixture.memories[0].id), "同一展品可以进入多个不同主题展览");

    const beforeRejected = fixture.exhibitions.getExhibitionStats().exhibitions;
    const invalid = structuredClone(preview);
    invalid.sections[0].items[0].citations[0].startOffset += 1;
    assert.throws(
      () => fixture.exhibitions.createExhibition({ ...invalid, title: "无效引用", confirmed: true }),
      (error) => error.code === "EXHIBITION_EVIDENCE_INVALID"
    );
    equal(fixture.exhibitions.getExhibitionStats().exhibitions, beforeRejected, "无效引用整项拒绝且不留下半成品");

    const updated = fixture.exhibitions.updateExhibition(first.id, { ...first, title: "更新后的展览", confirm: true });
    equal(updated.title, "更新后的展览", "主题展览可在再次确认后更新");
    const published = fixture.exhibitions.updateExhibition(first.id, { ...updated, status: "published", confirm: true });
    ok(published.status === "published" && published.requiresConfirmation === false, "确认后的展览可以发布且不误标待复核");
    assert.throws(
      () => fixture.exhibitions.updateExhibition(first.id, { title: "未确认更新" }),
      (error) => error.code === "EXHIBITION_CONFIRMATION_REQUIRED"
    );
    ok(true, "更新同样要求用户明确确认");

    const backup = fixture.exhibitions.buildExhibitionBackup("full");
    equal(backup.exhibitions.length, 2, "完整备份包含主题展览");
    const malformedBackup = structuredClone(backup);
    malformedBackup.exhibitions[0].sections[0].items[0].citations = null;
    assert.throws(
      () => fixture.exhibitions.validateExhibitionBackup(malformedBackup, fixture.memories.map((memory) => memory.id)),
      (error) => error.code === "EXHIBITION_LIMIT_INVALID"
    );
    ok(true, "完整备份在媒体落盘前深层拒绝无效引用结构");
    const redacted = fixture.exhibitions.buildExhibitionBackup("redacted");
    ok(redacted.mode === "redacted-summary" && !redacted.exhibitions, "脱敏备份物理移除展览叙事与原文引用");
    ok(fixture.exhibitions.validateExhibitionBackup(redacted, []) === true, "规范脱敏展览摘要可独立验真");
    assert.throws(
      () => fixture.exhibitions.validateExhibitionBackup({ ...redacted, exhibitions: [{ title: "夹带叙事" }] }, []),
      (error) => error.code === "EXHIBITION_BACKUP_INVALID"
    );
    ok(true, "脱敏展览摘要拒绝夹带完整记录或未知字段");

    const idMap = new Map(fixture.memories.map((memory, index) => [memory.id, target.memories[index].id]));
    const restored = target.exhibitions.restoreExhibitionBackup(backup, idMap);
    equal(restored.exhibitions, 2, "完整备份可恢复全部主题展览");
    const restoredFirst = target.exhibitions.getExhibition(restored.idMap[first.id]);
    deepEqual(restoredFirst.memoryIds, first.memoryIds.map((id) => idMap.get(id)), "恢复时重写全部展品外键");
    ok(restoredFirst.sections.flatMap((section) => section.items).every((item) => item.citations.every((citation) => citation.evidenceValid)), "恢复后引用仍通过目标原文核验");

    const insertCapacity = capacity.db.prepare(`
      INSERT INTO exhibitions (
        id, schema_version, title, theme, opening, mode, status,
        created_at, updated_at, published_at
      ) VALUES (?, 5, ?, '', '', 'evidence-rules', 'draft', ?, ?, '')
    `);
    for (let index = 0; index < 199; index += 1) {
      insertCapacity.run(`capacity-${index}`, `容量占位 ${index}`, "2026-07-16T00:00:00.000Z", "2026-07-16T00:00:00.000Z");
    }
    assert.throws(
      () => capacity.exhibitions.restoreExhibitionBackup(
        backup,
        new Map(fixture.memories.map((memory, index) => [memory.id, capacity.memories[index].id]))
      ),
      (error) => error.code === "EXHIBITION_LIMIT_REACHED"
    );
    equal(capacity.exhibitions.getExhibitionStats().exhibitions, 199, "恢复拒绝突破 200 场上限且不留下半成品");

    const restoredPublished = target.exhibitions.updateExhibition(restored.idMap[first.id], {
      ...restoredFirst,
      status: "published",
      confirm: true
    });
    ok(restoredPublished.status === "published", "恢复后的有效展览仍可再次确认发布");
    target.db.prepare("DELETE FROM memories WHERE id = ?").run(target.memories[0].id);
    const pruned = target.exhibitions.getExhibition(restored.idMap[first.id]);
    ok(pruned?.memoryIds.length === 2, "删除展品后仍有两件成员的展览会自动收拢");
    ok(pruned?.requiresConfirmation === true && pruned.status === "draft", "来源删除后展览自动降为待复核草稿");
    equal(target.exhibitions.getExhibition(restored.idMap[second.id]), null, "删除展品后不足两件成员的展览会自动清理");

    const boundedCitation = fixture.db.prepare("SELECT id FROM exhibition_citations WHERE memory_id = ? LIMIT 1").get(fixture.memories[0].id);
    fixture.db.prepare("UPDATE exhibition_citations SET start_offset = 0, end_offset = 999, quote_text = ? WHERE id = ?")
      .run(fixture.memories[0].rawContent, boundedCitation.id);
    const bounded = fixture.exhibitions.revalidateCitationsForMemory(fixture.memories[0].id);
    ok(bounded.find((citation) => citation.id === boundedCitation.id)?.evidenceValid === false, "越过原文长度的引用不会因 slice 截断而误判有效");

    fixture.db.prepare("UPDATE memories SET raw_content = ? WHERE id = ?").run("原文已经被整体改写。", fixture.memories[0].id);
    const revised = fixture.exhibitions.revalidateCitationsForMemory(fixture.memories[0].id);
    ok(revised.length >= 2 && revised.every((citation) => !citation.evidenceValid), "编辑原文后所有相关展览引用被标记失效");
    const needsReview = fixture.exhibitions.getExhibition(first.id);
    ok(needsReview.requiresConfirmation === true && needsReview.status === "draft", "引用失效后已发布展览自动降为待复核草稿");

    const stats = fixture.exhibitions.getExhibitionStats();
    ok(stats.exhibitions === 2 && stats.items >= 5 && stats.sections >= 2, "展览统计覆盖展览、章节和展品数");
    const cleared = fixture.exhibitions.clearExhibitions();
    ok(cleared.exhibitionsDeleted === 2 && fixture.exhibitions.listExhibitions().length === 0, "清空接口依靠级联移除全部展览数据");
  } finally {
    fixture.db.close();
    target.db.close();
    capacity.db.close();
  }
}

async function checkApi() {
  const fixture = createFixture("api");
  try {
    const responses = [];
    const dependencies = {
      database: fixture.exhibitions,
      store: { getMemory: (id) => fixture.memories.find((memory) => memory.id === id) || null },
      readJsonBody: async (request) => request.body || {},
      sendJson: (_response, status, payload) => {
        const result = { status, payload };
        responses.push(result);
        return result;
      },
      httpError: (statusCode, message) => Object.assign(new Error(message), { statusCode })
    };
    const api = createExhibitionApi(dependencies);
    const memoryIds = fixture.memories.map((memory) => memory.id);

    const previewResponse = await api.handle(
      request("POST", { memoryIds, theme: "毕业季" }),
      {},
      new URL("http://127.0.0.1/api/exhibitions/preview")
    );
    ok(previewResponse.status === 200 && previewResponse.payload.preview.theme === "毕业季", "preview API 接受前端精简 theme + memoryIds 合同");
    ok(previewResponse.payload.preview.sections.flatMap((section) => section.items).length === 3, "preview API 返回完整可解释章节");

    await assert.rejects(
      () => api.handle(request("POST", { memoryIds, title: "未确认" }), {}, new URL("http://127.0.0.1/api/exhibitions")),
      (error) => error.statusCode === 400
    );
    ok(true, "POST API 拒绝缺少 confirm 的保存请求");

    const created = await api.handle(
      request("POST", { memoryIds, theme: "毕业季", title: "毕业季小展", opening: "三段被选中的记忆。", confirm: true }),
      {},
      new URL("http://127.0.0.1/api/exhibitions")
    );
    ok(created.status === 201 && created.payload.exhibition.title === "毕业季小展", "POST API 兼容 confirm 和精简保存合同");
    const exhibitionId = created.payload.exhibition.id;

    const listed = await api.handle(request("GET"), {}, new URL("http://127.0.0.1/api/exhibitions"));
    ok(listed.payload.exhibitions.length === 1 && listed.payload.exhibitions[0].itemCount === 3, "GET 列表返回展览摘要");
    const detail = await api.handle(request("GET"), {}, new URL(`http://127.0.0.1/api/exhibitions/${exhibitionId}`));
    equal(detail.payload.exhibition.id, exhibitionId, "GET 详情返回完整主题展览");

    const updated = await api.handle(
      request("PUT", { memoryIds: memoryIds.slice(0, 2), theme: "同行", title: "两个人的展览", confirmed: true }),
      {},
      new URL(`http://127.0.0.1/api/exhibitions/${exhibitionId}`)
    );
    ok(updated.payload.exhibition.title === "两个人的展览" && updated.payload.exhibition.memoryIds.length === 2, "PUT API 兼容 confirmed 并重新生成已确认章节");

    const demoApi = createExhibitionApi({ ...dependencies, interviewDemo: true });
    const demoPreview = await demoApi.handle(
      request("POST", { memoryIds: memoryIds.slice(0, 2), theme: "Demo" }),
      {},
      new URL("http://127.0.0.1/api/exhibitions/preview")
    );
    equal(demoPreview.status, 200, "公开 Demo 仍可生成本地主题展览预览");
    await assert.rejects(
      () => demoApi.handle(
        request("POST", { memoryIds: memoryIds.slice(0, 2), title: "禁止保存", confirm: true }),
        {},
        new URL("http://127.0.0.1/api/exhibitions")
      ),
      (error) => error.statusCode === 403
    );
    ok(true, "公开 Demo 拒绝持久化主题展览");

    const removed = await api.handle(request("DELETE"), {}, new URL(`http://127.0.0.1/api/exhibitions/${exhibitionId}`));
    ok(removed.payload.ok && fixture.exhibitions.listExhibitions().length === 0, "DELETE API 删除主题展览并级联内容");
  } finally {
    fixture.db.close();
  }
}

function createFixture(prefix) {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE memories (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      raw_content TEXT NOT NULL
    );
  `);
  const source = fixtureMemories();
  const memories = source.map((memory, index) => ({ ...memory, id: `${prefix}-memory-${index + 1}` }));
  const insert = db.prepare("INSERT INTO memories (id, title, raw_content) VALUES (?, ?, ?)");
  memories.forEach((memory) => insert.run(memory.id, memory.title, memory.rawContent));
  let idCounter = 0;
  let timeCounter = 0;
  const createId = (kind) => `${kind}-${prefix}-${++idCounter}`;
  const now = () => new Date(Date.UTC(2026, 6, 16, 0, 0, timeCounter++)).toISOString();
  const exhibitions = initializeExhibitionDatabase({ db, createId, now });
  return { db, memories, exhibitions, createId, now };
}

function fixtureMemories() {
  return [
    {
      id: "memory-one",
      title: "操场尽头的告别",
      rawContent: "毕业那天，我们在操场尽头拍了最后一张合照。晚风吹过看台，大家都没有先说再见。",
      exhibitText: "毕业日留在操场的一次告别。",
      date: "2024-06-20",
      location: "学校操场",
      people: ["室友"],
      tags: ["校园", "毕业"],
      emotions: ["怀念"]
    },
    {
      id: "memory-two",
      title: "宿舍熄灯以后",
      rawContent: "宿舍熄灯以后，室友又聊起毕业旅行。我们约好离校前再去一次旧操场。",
      exhibitText: "熄灯后的约定。",
      date: "2024-06-18",
      location: "学生宿舍",
      people: ["室友"],
      tags: ["校园", "朋友"],
      emotions: ["温暖"]
    },
    {
      id: "memory-three",
      title: "车站的清晨",
      rawContent: "清晨到达车站时，妈妈把准备好的早餐塞进背包，提醒我到了以后报平安。",
      exhibitText: "出发前被家人照顾的片刻。",
      date: "2025-02-03",
      location: "火车站",
      people: ["妈妈"],
      tags: ["旅行", "家人"],
      emotions: ["温暖"]
    }
  ];
}

function request(method, body) {
  return { method, body };
}

function tableExists(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

function ok(condition, message) {
  assertions += 1;
  assert.ok(condition, message);
}

function equal(actual, expected, message) {
  assertions += 1;
  assert.equal(actual, expected, message);
}

function deepEqual(actual, expected, message) {
  assertions += 1;
  assert.deepEqual(actual, expected, message);
}
