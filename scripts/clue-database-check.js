"use strict";

const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const { applyMigrations, listAppliedMigrations, readUserVersion } = require("../lib/migrations");
const { CLUE_MIGRATION, initializeClueDatabase } = require("../lib/clue-database");

const TEST_MIGRATION_5 = Object.freeze({ version: 5, name: "clue-test-v5", up() {} });
const TEST_MIGRATION_6 = Object.freeze({ version: 6, name: "clue-test-v6", up() {} });
const TEST_MIGRATION_8 = Object.freeze({ version: 8, name: "clue-test-v8", up() {} });

let assertions = 0;

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});

async function main() {
  checkMigrationAndBackfill();
  checkSearchAndSynchronization();
  checkAliasAndMerge();
  checkBackupRestoreAndClear();
  checkMigrationBoundaries();
  console.log(`Clue database checks passed: ${assertions} assertions.`);
}

function checkMigrationAndBackfill() {
  const fixture = createFixture("backfill", sourceMemories());
  try {
    equal(readUserVersion(fixture.db), 7, "migration 7 更新 user_version");
    deepEqual(listAppliedMigrations(fixture.db).map((item) => item.version), [4, 5, 6, 7], "迁移链从 V4 连续推进到 V7");
    ok(tableExists(fixture.db, "entities"), "migration 7 创建实体表");
    ok(tableExists(fixture.db, "entity_aliases"), "migration 7 创建别名表");
    ok(tableExists(fixture.db, "memory_entities"), "migration 7 创建展品实体关系表");
    ok(tableExists(fixture.db, "memory_search_documents"), "migration 7 创建外部内容表");
    ok(tableExists(fixture.db, "memory_search_fts"), "Node 24 环境创建 trigram FTS5 表");
    equal(/content\s*=\s*'memory_search_documents'/u.test(ftsSql(fixture.db)), true, "FTS 使用 external-content 模式");
    equal(/tokenize\s*=\s*'trigram'/u.test(ftsSql(fixture.db)), true, "FTS 明确使用 trigram tokenizer");

    const stats = fixture.clues.getClueStats();
    equal(stats.entities, 11, "人物、地点和标签逐条精确回填");
    equal(stats.memoryLinks, 11, "每个旧字段值形成可追溯关系");
    equal(stats.searchDocuments, 3, "所有既有展品建立检索文档");
    equal(stats.people, 3, "同名人物在不同展品中保留为独立线索");
    const roommateEntities = fixture.clues.listEntities({ type: "person", query: "室友" });
    equal(roommateEntities.length, 2, "同名人物没有被自动认定为同一身份");
    ok(roommateEntities.every((entity) => entity.resolutionStatus === "same-name-clue"), "旧字段实体明确标记为同名线索");
    ok(roommateEntities.every((entity) => entity.memoryCount === 1), "旧同名实体各自只关联原展品");
    equal(fixture.clues.listEntities({ type: "place" }).length, 3, "实体筛选兼容 API 对地点使用的 place 名称");
    const refs = fixture.clues.getMemoryEntityRefs("backfill-one");
    ok(refs.every((ref) => ref.reason.includes("不自动认定")), "回填关系公开谨慎的身份说明");
    deepEqual(fixture.readLegacy("backfill-one"), {
      location: "学校操场",
      people: ["室友"],
      tags: ["校园", "毕业"]
    }, "回填不反写旧 people/location/tags 字段");

    const firstEntityIds = fixture.db.prepare("SELECT id FROM entities ORDER BY id").all().map((row) => row.id);
    const second = initializeClueDatabase({ db: fixture.db, now: fixture.now, createId: fixture.createId });
    deepEqual(second.getClueStats(), fixture.clues.getClueStats(), "重复初始化保持计数幂等");
    deepEqual(fixture.db.prepare("SELECT id FROM entities ORDER BY id").all().map((row) => row.id), firstEntityIds, "重复初始化不生成第二批实体");
  } finally {
    fixture.close();
  }
}

function checkSearchAndSynchronization() {
  const fixture = createFixture("search", [
    memory("long", {
      title: "操场尽头的毕业合照",
      exhibitText: "晚风里的校园告别",
      rawContent: "毕业那天我们在操场拍下珍贵合照。",
      location: "学校操场",
      people: ["室友"],
      tags: ["校园", "毕业"],
      emotions: ["怀念"]
    }),
    memory("short", {
      title: "雨夜",
      exhibitText: "和妈妈等车",
      rawContent: "妈妈带着伞来接我。",
      location: "家",
      people: ["妈妈"],
      tags: ["家人"],
      emotions: ["温暖"]
    }),
    memory("wildcard", {
      title: "票据 %_ 留存",
      exhibitText: "字符测试",
      rawContent: "只有这件含有百分号和下划线。",
      location: "档案柜",
      people: [],
      tags: ["票据"],
      emotions: []
    }),
    memory("plain", {
      title: "票据 AB 留存",
      exhibitText: "普通字符",
      rawContent: "不包含特殊通配符。",
      location: "档案柜",
      people: [],
      tags: ["票据"],
      emotions: []
    })
  ]);
  try {
    const fts = fixture.clues.searchClues("毕业合照", { limit: 10 });
    equal(fts.strategy, "fts5-trigram", "三字及以上检索走 FTS5 trigram");
    equal(fts.results[0].memoryId, "search-long", "FTS 返回正确展品");
    ok(fts.results[0].matchedFields.includes("title"), "检索结果公开命中字段");
    ok(fts.results[0].evidence.length > 0 && fts.results[0].reason, "检索结果包含证据、置信度与原因");

    const short = fixture.clues.searchClues("雨", { limit: 10 });
    equal(short.strategy, "like", "一字检索走严格 LIKE 回退");
    equal(short.results[0].memoryId, "search-short", "短词回退命中正确展品");
    ok(short.usedFallback, "短词结果显式声明回退");
    const two = fixture.clues.searchClues("妈妈", { limit: 10 });
    equal(two.strategy, "like", "二字检索同样走 LIKE 回退");
    equal(two.results[0].memoryId, "search-short", "二字检索覆盖人物和原文");

    const escaped = fixture.clues.searchClues("%_", { limit: 10 });
    deepEqual(escaped.results.map((item) => item.memoryId), ["search-wildcard"], "LIKE 对百分号和下划线做字面转义");
    const expanded = fixture.clues.searchClues("告别", { limit: 10, ruleExpansions: ["毕业"] });
    ok(expanded.results.some((item) => item.memoryId === "search-long"), "规则扩展与直接词一起进入候选和解释");
    throwsCode(() => fixture.clues.searchClues("x".repeat(201)), "CLUE_QUERY_INVALID", "超长检索在进入 SQL 前被拒绝");
    throwsCode(() => fixture.clues.searchClues("雨", { limit: 1000 }), "CLUE_LIMIT_INVALID", "检索上限不能被调用方放宽");

    fixture.updateMemory("search-long", {
      title: "海边清晨",
      exhibitText: "第一次看日出",
      rawContent: "清晨在海边看到了日出。",
      location: "海边",
      people: ["朋友"],
      tags: ["旅行"],
      emotions: ["兴奋"]
    });
    const synced = fixture.clues.syncMemoryClues("search-long");
    ok(synced.indexed && synced.entityRefs.length === 3, "保存同步重建搜索文档和旧字段实体关系");
    equal(fixture.clues.searchClues("毕业合照").results.length, 0, "更新后旧全文内容不再形成幽灵命中");
    equal(fixture.clues.searchClues("海边 日出").results[0].memoryId, "search-long", "更新后新内容立即可检索");
    deepEqual(fixture.readLegacy("search-long"), {
      location: "海边",
      people: ["朋友"],
      tags: ["旅行"]
    }, "同步只读取而不反写旧字段");
    ok(!fixture.clues.listEntities({ query: "室友" }).some((entity) => entity.id.includes("search")), "更新会清理失去关系的孤立旧实体");

    fixture.db.prepare("DELETE FROM memories WHERE id = ?").run("search-long");
    equal(fixture.clues.searchClues("海边 日出").results.length, 0, "直接删除展品也不会留下 FTS 幽灵");
    equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM memory_search_documents WHERE memory_id = 'search-long'").get().count, 0, "搜索文档通过外键级联删除");
    equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM memory_entities WHERE memory_id = 'search-long'").get().count, 0, "实体关系通过外键级联删除");
    equal(fixture.clues.listEntities({ query: "朋友" }).length, 0, "删除展品后孤立实体由触发器修剪");

    fixture.db.exec(`
      DROP TRIGGER IF EXISTS memory_search_documents_ai;
      DROP TRIGGER IF EXISTS memory_search_documents_ad;
      DROP TRIGGER IF EXISTS memory_search_documents_au;
      DROP TABLE memory_search_fts;
    `);
    const noFts = fixture.clues.searchClues("百分号", { limit: 10 });
    equal(noFts.strategy, "like", "FTS 在运行期不可用时自动降级为参数化 LIKE");
    equal(noFts.results[0].memoryId, "search-wildcard", "无 FTS 回退仍返回正确结果");
    equal(fixture.clues.getClueStats().ftsAvailable, false, "统计公开当前 FTS 降级状态");
  } finally {
    fixture.close();
  }
}

function checkAliasAndMerge() {
  const fixture = createFixture("entity", sourceMemories());
  try {
    const roommates = fixture.clues.listEntities({ type: "person", query: "室友" });
    equal(roommates.length, 2, "合并前保留两个同名人物线索");
    const sourceId = roommates[0].id;
    const targetId = roommates[1].id;
    throwsCode(
      () => fixture.clues.addEntityAlias(targetId, { alias: "老同学" }),
      "CLUE_CONFIRMATION_REQUIRED",
      "数据库别名写入强制显式确认"
    );
    const aliasPreview = fixture.clues.previewEntityAlias(targetId, { alias: "老同学" });
    ok(aliasPreview.requiresConfirmation && !aliasPreview.noOp, "别名先返回无写入预览");
    equal(fixture.clues.getEntityProfile(targetId).aliases.length, 0, "预览不会修改数据库");
    const added = fixture.clues.addEntityAlias(targetId, { alias: "老同学", confirm: true });
    ok(added.created && added.alias.alias === "老同学", "确认后保存别名");
    equal(fixture.clues.searchClues("老同学").results[0].memoryId, roommates[1].id.includes("one") ? "entity-one" : "entity-two", "别名写入后同步进入搜索文档");
    const duplicate = fixture.clues.addEntityAlias(targetId, { alias: " 老同学 ", confirm: true });
    ok(!duplicate.created, "规范化后重复别名保持幂等");

    const otherPerson = fixture.clues.listEntities({ type: "person", query: "妈妈" })[0];
    const conflict = fixture.clues.previewEntityAlias(otherPerson.id, { alias: "老同学" });
    equal(conflict.conflicts.length, 1, "同类型跨实体同名只作为冲突线索展示，不静默合并");
    const location = fixture.clues.listEntities({ type: "location" })[0];
    throwsCode(
      () => fixture.clues.previewEntityMerge({ sourceEntityId: sourceId, targetEntityId: location.id }),
      "CLUE_ENTITY_TYPE_MISMATCH",
      "不同实体类型不能合并"
    );
    throwsCode(
      () => fixture.clues.previewEntityMerge({ sourceEntityId: targetId, targetEntityId: targetId }),
      "CLUE_MERGE_SAME_ENTITY",
      "实体不能与自身合并"
    );

    const legacyBefore = fixture.readAllLegacy();
    const mergePreview = fixture.clues.previewEntityMerge({ sourceEntityId: sourceId, targetEntityId: targetId });
    ok(mergePreview.requiresConfirmation && mergePreview.effect.memoriesAdded === 1, "合并预览公开将新增的展品关系");
    equal(fixture.clues.listEntities({ type: "person", query: "室友" }).length, 2, "合并预览不写数据库");
    throwsCode(
      () => fixture.clues.mergeEntities({ sourceEntityId: sourceId, targetEntityId: targetId }),
      "CLUE_CONFIRMATION_REQUIRED",
      "实体合并同样强制显式确认"
    );
    const merged = fixture.clues.mergeEntities({ sourceEntityId: sourceId, targetEntityId: targetId, confirm: true });
    equal(merged.targetEntityId, targetId, "合并始终保留调用方指定的目标实体");
    equal(fixture.clues.getEntityProfile(sourceId), null, "源实体在确认合并后删除");
    const profile = fixture.clues.getEntityProfile(targetId);
    equal(profile.memories.length, 2, "目标实体接收并去重源展品关系");
    equal(profile.resolutionStatus, "confirmed", "显式合并将目标标记为已确认");
    equal(profile.aliases.filter((alias) => alias.alias === "室友").length, 0, "与目标规范名相同的源名称不会重复成为别名");
    deepEqual(fixture.readAllLegacy(), legacyBefore, "别名和实体合并从不反写旧字段");

    const resyncedMemoryId = profile.memories[0].memoryId;
    fixture.clues.syncMemoryClues(resyncedMemoryId);
    equal(fixture.clues.getEntityProfile(targetId).memories.length, 2, "后续保存同步不会拆散已确认的合并关系");

    fixture.clues.mergeEntities({ sourceEntityId: otherPerson.id, targetEntityId: targetId, confirm: true });
    const aliasSearchIds = fixture.clues.searchClues("妈妈", { limit: 10 }).results.map((item) => item.memoryId).sort();
    deepEqual(aliasSearchIds, ["entity-one", "entity-three", "entity-two"], "合并新增的规范名作为别名并刷新目标全部展品文档");
    equal(fixture.clues.getEntityProfile(targetId).memories.length, 3, "不同名称实体确认合并后关系去重并归入目标");
    deepEqual(fixture.readAllLegacy(), legacyBefore, "第二次实体合并仍不反写旧人物字段");

    throwsCode(
      () => fixture.clues.deleteEntityAlias(targetId, { aliasId: added.alias.id }),
      "CLUE_CONFIRMATION_REQUIRED",
      "删除别名必须显式确认"
    );
    const removed = fixture.clues.deleteEntityAlias(targetId, { aliasId: added.alias.id, confirm: true });
    ok(removed.deleted && !removed.entity.aliases.some((alias) => alias.id === added.alias.id), "确认后删除指定别名");
    throwsCode(
      () => fixture.clues.deleteEntityAlias(targetId, { aliasId: added.alias.id, confirm: true }),
      "CLUE_ALIAS_NOT_FOUND",
      "重复删除返回明确不存在错误"
    );
  } finally {
    fixture.close();
  }
}

function checkBackupRestoreAndClear() {
  const source = createFixture("backup-source", sourceMemories());
  const target = createFixture("backup-target", sourceMemories());
  try {
    const person = source.clues.listEntities({ type: "person", query: "妈妈" })[0];
    source.clues.addEntityAlias(person.id, { alias: "母亲", confirm: true });
    const sourceMemoryIds = source.memoryIds();
    const full = source.clues.buildClueBackup("full", sourceMemoryIds);
    ok(full.mode === "full" && full.schemaVersion === 7, "完整备份使用 V7 严格合同");
    equal(full.entities.length, source.clues.getClueStats().entities, "完整备份包含实体图");
    ok(full.entities.every((entity) => Object.keys(entity).sort().join() === "aliases,canonicalName,id,memoryLinks,type"), "备份物理移除内部归一化和推断字段");
    ok(source.clues.validateClueBackup(full, sourceMemoryIds), "完整备份可在写入前严格验证");
    const partial = source.clues.buildClueBackup("full", [sourceMemoryIds[0]]);
    ok(partial.entities.length > 0 && partial.entities.every((entity) => entity.memoryLinks.every((link) => link.memoryId === sourceMemoryIds[0])), "部分备份严格限制展品边界");

    const redacted = source.clues.buildClueBackup("redacted", sourceMemoryIds);
    const redactedJson = JSON.stringify(redacted);
    ok(redacted.mode === "redacted-summary" && !Object.hasOwn(redacted, "entities"), "脱敏备份物理移除实体明细");
    ok(!redactedJson.includes("妈妈") && !redactedJson.includes(sourceMemoryIds[0]), "脱敏摘要不泄漏名称、展品 ID 或逐条关系");
    ok(source.clues.validateClueBackup(redacted, []), "脱敏摘要可独立严格验证");

    const invalid = structuredClone(full);
    invalid.entities[0].memoryLinks[0].memoryId = "outside";
    throwsCode(
      () => source.clues.validateClueBackup(invalid, sourceMemoryIds),
      "CLUE_BACKUP_REFERENCE_INVALID",
      "完整备份拒绝边界外引用"
    );
    const targetMap = new Map(sourceMemoryIds.map((sourceId, index) => [sourceId, target.memoryIds()[index]]));
    const entityMap = Object.fromEntries(full.entities.map((entity, index) => [entity.id, `restored-entity-${index}`]));
    const aliasIds = full.entities.flatMap((entity) => entity.aliases.map((alias) => alias.id));
    const aliasMap = Object.fromEntries(aliasIds.map((id, index) => [id, `restored-alias-${index}`]));
    const before = target.clues.getClueStats();
    const restored = target.clues.restoreClueBackup(full, {
      memoryIdMap: targetMap,
      entityIdMap: entityMap,
      aliasIdMap: aliasMap
    });
    equal(restored.entities, full.entities.length, "完整备份恢复全部实体");
    equal(restored.memoryLinks, full.entities.reduce((sum, entity) => sum + entity.memoryLinks.length, 0), "恢复重写并保存全部展品关系");
    equal(target.clues.getClueStats().entities, before.entities + restored.entities, "恢复在目标既有线索之外追加实体");
    equal(restored.idMap.memories[sourceMemoryIds[0]], target.memoryIds()[0], "恢复结果公开展品 ID 映射");
    equal(restored.idMap.entities[full.entities[0].id], entityMap[full.entities[0].id], "恢复结果公开实体 ID 映射");
    equal(target.clues.searchClues("母亲").results.length, 1, "恢复后别名同步进入目标全文索引");

    const firstDefaultRestore = target.clues.restoreClueBackup(full, targetMap);
    equal(
      firstDefaultRestore.idMap.entities[full.entities[0].id],
      full.entities[0].id,
      "未占用的源实体 ID 默认原样保留"
    );
    const collisionRestore = target.clues.restoreClueBackup(full, targetMap);
    ok(
      full.entities.every((entity) => collisionRestore.idMap.entities[entity.id] !== entity.id),
      "未显式映射时为已占用实体 ID 生成无碰撞目标 ID"
    );
    ok(
      aliasIds.every((aliasId) => collisionRestore.idMap.aliases[aliasId] !== aliasId),
      "未显式映射时为已占用别名 ID 生成无碰撞目标 ID"
    );
    equal(
      new Set(Object.values(collisionRestore.idMap.entities)).size,
      full.entities.length,
      "同一恢复计划内自动生成的实体 ID 彼此唯一"
    );
    const beforeExplicitCollision = target.clues.getClueStats();
    throwsCode(
      () => target.clues.restoreClueBackup(full, {
        memoryIdMap: targetMap,
        entityIdMap: Object.fromEntries(full.entities.map((entity) => [entity.id, entity.id])),
        aliasIdMap: Object.fromEntries(aliasIds.map((aliasId) => [aliasId, aliasId]))
      }),
      "CLUE_BACKUP_ID_COLLISION",
      "调用方显式指定的占用 ID 仍被严格拒绝"
    );
    deepEqual(target.clues.getClueStats(), beforeExplicitCollision, "显式 ID 碰撞整项拒绝且零写入");

    const badMap = new Map(targetMap);
    badMap.set(sourceMemoryIds[0], "missing-target");
    const statsBeforeFailure = target.clues.getClueStats();
    throwsCode(
      () => target.clues.restoreClueBackup(full, {
        memoryIdMap: badMap,
        entityIdMap: Object.fromEntries(full.entities.map((entity, index) => [entity.id, `failed-entity-${index}`])),
        aliasIdMap: Object.fromEntries(aliasIds.map((id, index) => [id, `failed-alias-${index}`]))
      }),
      "CLUE_BACKUP_REFERENCE_INVALID",
      "恢复在事务写入前拒绝不存在的目标展品"
    );
    deepEqual(target.clues.getClueStats(), statsBeforeFailure, "失败恢复保持实体、关系和索引零写入");
    deepEqual(target.clues.restoreClueBackup(redacted, {}).idMap, { memories: {}, entities: {}, aliases: {} }, "脱敏摘要恢复为明确零写入");

    const cleared = target.clues.clearClues();
    ok(cleared.entitiesDeleted > 0 && cleared.memoryEntityLinksDeleted > 0, "purge helper 返回实际线索删除计数");
    deepEqual(target.clues.getClueStats(), {
      entities: 0,
      people: 0,
      locations: 0,
      themes: 0,
      aliases: 0,
      memoryLinks: 0,
      searchDocuments: 0,
      ftsAvailable: true
    }, "purge helper 清空实体图和全文文档");
    equal(target.memoryIds().length, 3, "purge helper 不越界删除展品");
    const rebuilt = target.clues.rebuildClueIndex();
    equal(rebuilt.memoriesIndexed, 3, "清空后可从旧字段安全重建全部线索");
    equal(target.clues.getClueStats().searchDocuments, 3, "重建恢复全文文档");
  } finally {
    source.close();
    target.close();
  }
}

function checkMigrationBoundaries() {
  const fixture = createFixture("future", []);
  try {
    applyMigrations({
      db: fixture.db,
      baselineVersion: 4,
      migrations: [TEST_MIGRATION_8],
      now: fixture.now
    });
    throwsCode(
      () => initializeClueDatabase({ db: fixture.db, now: fixture.now }),
      "MIGRATION_DATABASE_TOO_NEW",
      "V7 数据层拒绝打开带完整账本的未来数据库"
    );
  } finally {
    fixture.close();
  }

  const broken = new DatabaseSync(":memory:");
  try {
    broken.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE memories (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '',
        exhibit_text TEXT NOT NULL DEFAULT '',
        raw_content TEXT NOT NULL DEFAULT '',
        memory_date TEXT NOT NULL DEFAULT '',
        location TEXT NOT NULL DEFAULT '',
        source_type TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT ''
      );
    `);
    applyMigrations({
      db: broken,
      baselineVersion: 4,
      migrations: [TEST_MIGRATION_5, TEST_MIGRATION_6],
      now: () => "2026-07-17T00:00:00.000Z"
    });
    throwsCode(
      () => initializeClueDatabase({ db: broken, now: () => "2026-07-17T00:00:00.000Z" }),
      "MIGRATION_APPLY_FAILED",
      "缺少旧关系表时迁移整体失败"
    );
    equal(readUserVersion(broken), 6, "失败迁移保留 V6 user_version");
    equal(tableExists(broken, "entities"), false, "失败迁移回滚所有 V7 表而不留半成品");
    deepEqual(listAppliedMigrations(broken).map((item) => item.version), [4, 5, 6], "失败迁移不污染迁移账本");
  } finally {
    broken.close();
  }
}

function createFixture(prefix, memories) {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE memories (
      id TEXT PRIMARY KEY,
      schema_version INTEGER NOT NULL DEFAULT 4,
      title TEXT NOT NULL DEFAULT '',
      hall_id TEXT NOT NULL DEFAULT 'daily',
      source_type TEXT NOT NULL DEFAULT 'text',
      raw_content TEXT NOT NULL DEFAULT '',
      exhibit_text TEXT NOT NULL DEFAULT '',
      memory_date TEXT NOT NULL DEFAULT '',
      location TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE memory_people (
      memory_id TEXT NOT NULL,
      name TEXT NOT NULL,
      PRIMARY KEY (memory_id, name),
      FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
    );
    CREATE TABLE memory_tags (
      memory_id TEXT NOT NULL,
      tag TEXT NOT NULL,
      PRIMARY KEY (memory_id, tag),
      FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
    );
    CREATE TABLE memory_emotions (
      memory_id TEXT NOT NULL,
      emotion TEXT NOT NULL,
      PRIMARY KEY (memory_id, emotion),
      FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
    );
  `);
  let tick = 0;
  let idCounter = 0;
  const now = () => new Date(Date.UTC(2026, 6, 17, 0, 0, tick++)).toISOString();
  const createId = (kind) => `${kind}-${prefix}-${++idCounter}`;
  const fixture = { db, now, createId };
  memories.forEach((entry, index) => insertMemory(db, { ...entry, id: `${prefix}-${entry.id || index + 1}` }, now()));
  applyMigrations({
    db,
    baselineVersion: 4,
    migrations: [TEST_MIGRATION_5, TEST_MIGRATION_6],
    now
  });
  const clues = initializeClueDatabase({ db, now, createId });
  return {
    ...fixture,
    clues,
    close: () => db.close(),
    memoryIds: () => db.prepare("SELECT id FROM memories ORDER BY id").all().map((row) => row.id),
    readLegacy: (memoryId) => readLegacy(db, memoryId),
    readAllLegacy: () => Object.fromEntries(db.prepare("SELECT id FROM memories ORDER BY id").all().map((row) => [row.id, readLegacy(db, row.id)])),
    updateMemory: (memoryId, value) => replaceMemoryFields(db, memoryId, value, now())
  };
}

function sourceMemories() {
  return [
    memory("one", {
      title: "操场尽头的告别",
      exhibitText: "毕业日的合照",
      rawContent: "毕业那天，我们和室友在操场拍了合照。",
      location: "学校操场",
      people: ["室友"],
      tags: ["校园", "毕业"],
      emotions: ["怀念"]
    }),
    memory("two", {
      title: "宿舍熄灯以后",
      exhibitText: "熄灯后的约定",
      rawContent: "室友说离校前再去一次操场。",
      location: "学生宿舍",
      people: ["室友"],
      tags: ["校园", "朋友"],
      emotions: ["温暖"]
    }),
    memory("three", {
      title: "车站的清晨",
      exhibitText: "家人的照顾",
      rawContent: "妈妈把早餐塞进背包。",
      location: "火车站",
      people: ["妈妈"],
      tags: ["旅行"],
      emotions: ["温暖"]
    })
  ];
}

function memory(id, value) {
  return {
    id,
    title: value.title,
    exhibitText: value.exhibitText,
    rawContent: value.rawContent,
    date: value.date || "2024-06-20",
    location: value.location,
    people: value.people || [],
    tags: value.tags || [],
    emotions: value.emotions || [],
    sourceType: value.sourceType || "text"
  };
}

function insertMemory(db, value, timestamp) {
  db.prepare(`
    INSERT INTO memories (
      id, title, source_type, raw_content, exhibit_text, memory_date,
      location, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    value.id, value.title, value.sourceType, value.rawContent, value.exhibitText,
    value.date, value.location, timestamp, timestamp
  );
  replaceRelated(db, "memory_people", "name", value.id, value.people);
  replaceRelated(db, "memory_tags", "tag", value.id, value.tags);
  replaceRelated(db, "memory_emotions", "emotion", value.id, value.emotions);
}

function replaceMemoryFields(db, memoryId, value, timestamp) {
  db.prepare(`
    UPDATE memories SET
      title = ?, exhibit_text = ?, raw_content = ?, memory_date = ?,
      location = ?, source_type = ?, updated_at = ?
    WHERE id = ?
  `).run(
    value.title, value.exhibitText, value.rawContent, value.date || "",
    value.location, value.sourceType || "text", timestamp, memoryId
  );
  replaceRelated(db, "memory_people", "name", memoryId, value.people || []);
  replaceRelated(db, "memory_tags", "tag", memoryId, value.tags || []);
  replaceRelated(db, "memory_emotions", "emotion", memoryId, value.emotions || []);
}

function replaceRelated(db, table, column, memoryId, values) {
  db.prepare(`DELETE FROM ${table} WHERE memory_id = ?`).run(memoryId);
  const insert = db.prepare(`INSERT INTO ${table} (memory_id, ${column}) VALUES (?, ?)`);
  [...new Set(values)].forEach((value) => insert.run(memoryId, value));
}

function readLegacy(db, memoryId) {
  return {
    location: db.prepare("SELECT location FROM memories WHERE id = ?").get(memoryId)?.location || "",
    people: db.prepare("SELECT name FROM memory_people WHERE memory_id = ? ORDER BY name").all(memoryId).map((row) => row.name),
    tags: db.prepare("SELECT tag FROM memory_tags WHERE memory_id = ? ORDER BY tag").all(memoryId).map((row) => row.tag)
  };
}

function ftsSql(db) {
  return String(db.prepare("SELECT sql FROM sqlite_master WHERE name = 'memory_search_fts'").get()?.sql || "").replace(/\s+/gu, " ");
}

function tableExists(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
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
