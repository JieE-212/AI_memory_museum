"use strict";

const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const { applyMigrations, listAppliedMigrations, readUserVersion } = require("../lib/migrations");
const { REVISION_MIGRATION, initializeRevisionDatabase } = require("../lib/revision-database");
const {
  REVISION_BACKUP_LIMITS,
  buildRevisionBackup,
  createMemorySnapshot,
  memorySnapshotSha256
} = require("../lib/revision-backup");

const LEGACY_MIGRATIONS = Object.freeze([5, 6, 7, 8, 9].map((version) => ({
  version,
  name: `revision-check-v${version}`,
  up(db) { db.exec(`CREATE TABLE revision_legacy_v${version} (id TEXT PRIMARY KEY)`); }
})));

let assertions = 0;

checkMigrationAndTimestampBackfill();
checkCreationAndTransitions();
checkFailureRollbackAndCascade();
checkBackupRestoreAndHeadVerification();
checkRecentRevisionSummaries();
checkCapacityRollbackAcrossWritePaths();

console.log(`Revision database checks passed: ${assertions} assertions.`);

function checkMigrationAndTimestampBackfill() {
  const fixture = createFixture("migration", { initialize: false });
  try {
    const before = snapshotCoreRows(fixture.db);
    const revisions = fixture.initialize();
    equal(readUserVersion(fixture.db), 10, "迁移 10 更新 user_version");
    deepEqual(listAppliedMigrations(fixture.db).map((entry) => entry.version), [4, 5, 6, 7, 8, 9, 10], "账本连续追加 schema 10");
    equal(REVISION_MIGRATION.version, 10, "公开迁移常量固定为 schema 10");
    ok(tableExists(fixture.db, "memory_revisions"), "迁移创建 memory_revisions");
    ok(indexExists(fixture.db, "idx_memory_revisions_memory"), "迁移创建 head 查询索引");
    equal(tableCount(fixture.db, "memory_revisions"), 0, "迁移不伪造旧馆藏历史");
    equal(fixture.db.prepare("SELECT updated_at FROM memories WHERE id = ?").get("migration-memory").updated_at,
      "2026-01-01T00:00:00.000Z", "旧馆藏空 updated_at 使用 created_at 回填");
    const after = snapshotCoreRows(fixture.db);
    deepEqual({ ...after, memoryUpdatedAt: before.memoryCreatedAt }, {
      ...before,
      memoryUpdatedAt: before.memoryCreatedAt
    }, "时间回填外的旧馆藏字段与关系保持不变");
    deepEqual(revisions.getRevisionStats(), { memories: 0, revisions: 0 }, "新模块初始统计为空");
    const ledger = listAppliedMigrations(fixture.db);
    fixture.initialize();
    deepEqual(listAppliedMigrations(fixture.db), ledger, "重复初始化不改写迁移账本");
  } finally { fixture.close(); }
}

function checkCreationAndTransitions() {
  const fixture = createFixture("transition");
  try {
    const old = fixture.readMemory("transition-memory");
    const next = memory("transition-memory", {
      ...old,
      title: "第二版标题",
      rawContent: "第二版正文，保留可靠修订。",
      people: ["乙", "甲", "甲"],
      tags: ["修订", "证据"],
      updatedAt: "2026-01-02T00:00:00.000Z"
    });
    const first = fixture.revisions.recordMemoryTransition(old, next, {
      baselineId: "transition-baseline",
      id: "transition-edit-1",
      createdAt: "2026-01-02T00:00:01.000Z"
    });
    ok(first.changed && first.baselineCreated, "旧馆藏首次真实编辑原子创建 baseline 与新 head");
    let chain = fixture.revisions.listMemoryRevisions(old.id);
    equal(chain.length, 2, "首次编辑形成两条修订");
    deepEqual(chain.map((item) => [item.revisionNo, item.changeKind]), [[1, "baseline"], [2, "edited"]], "首次链类型和序号固定");
    equal(chain[1].parentSha256, chain[0].snapshotSha256, "edited 父哈希精确指向 baseline");
    deepEqual(chain[1].snapshot.people, ["乙", "甲"].sort(compareText), "确定性快照对集合字段排序去重");
    equal(chain[1].snapshotSha256, memorySnapshotSha256(next), "head SHA 来自规范快照");
    deepEqual(fixture.revisions.verifyMemoryHead(next), { matches: true, tracked: true, head: chain[1] }, "传入当前语义状态可核对 head");
    equal(fixture.revisions.verifyMemoryHead(old).matches, false, "旧状态不再匹配 head");

    fixture.writeMemory(next);
    const noOp = fixture.revisions.recordMemoryTransition(next, { ...next, updatedAt: "2026-01-03T00:00:00.000Z" });
    equal(noOp.changed, false, "仅时间变化不生成伪修订");
    equal(fixture.revisions.listMemoryRevisions(old.id).length, 2, "no-op 不插入记录");

    const third = memory(old.id, { ...next, title: "第三版标题", updatedAt: "2026-01-03T00:00:00.000Z" });
    const edited = fixture.revisions.recordMemoryTransition(next, third, {
      id: "transition-edit-2",
      changeNote: "用户再次核对",
      createdAt: "2026-01-03T00:00:01.000Z"
    });
    equal(edited.head.revisionNo, 3, "后续编辑连续追加 revision 3");
    equal(edited.head.changeNote, "用户再次核对", "用户说明进入修订但不参与快照哈希");
    fixture.writeMemory(third);

    const restored = fixture.revisions.recordMemoryTransition(third, old, {
      id: "transition-restore",
      changeKind: "restored",
      restoredFromRevisionId: "transition-baseline",
      sourceUpdatedAt: "2026-01-04T00:00:00.000Z",
      createdAt: "2026-01-04T00:00:01.000Z"
    });
    equal(restored.head.revisionNo, 4, "恢复旧版生成新 head 而非移动指针");
    equal(restored.head.restoredFromRevisionId, "transition-baseline", "恢复 head 保留明确来源");
    equal(restored.head.snapshotSha256, chain[0].snapshotSha256, "恢复允许再次出现相同快照 SHA");
    equal(new Set(fixture.revisions.listMemoryRevisions(old.id).map((item) => item.id)).size, 4, "恢复不删除任何中间历史");

    const createdMemory = memory("transition-created", {
      title: "新建展品",
      rawContent: "V7.2 新建即有 revision 1。",
      createdAt: "2026-02-01T00:00:00.000Z",
      updatedAt: "2026-02-01T00:00:00.000Z"
    });
    fixture.writeMemory(createdMemory);
    const created = fixture.revisions.recordMemoryCreation(createdMemory, { id: "transition-created-r1" });
    equal(created.head.changeKind, "created", "新建展品首条记录标记 created");
    equal(created.head.revisionNo, 1, "新建展品不额外制造 baseline");
    equal(fixture.revisions.recordMemoryCreation(createdMemory).changed, false, "相同创建状态重复记录保持幂等");

    throwsCode(
      () => fixture.revisions.recordMemoryTransition(next, third),
      "REVISION_HEAD_MISMATCH",
      "调用方传入过期 previous 状态时失败关闭"
    );
  } finally { fixture.close(); }
}

function checkFailureRollbackAndCascade() {
  const fixture = createFixture("rollback");
  try {
    const old = fixture.readMemory("rollback-memory");
    const next = memory(old.id, { ...old, title: "不会提交", updatedAt: "2026-03-01T00:00:00.000Z" });
    throwsCode(
      () => fixture.revisions.recordMemoryTransition(old, next, {
        changeKind: "restored",
        restoredFromRevisionId: "missing-revision"
      }),
      "REVISION_RESTORE_SOURCE_INVALID",
      "baseline 后恢复来源失败时抛出稳定错误"
    );
    equal(fixture.revisions.listMemoryRevisions(old.id).length, 0, "恢复来源失败回滚本次 baseline");

    fixture.revisions.recordMemoryCreation(old, { id: "rollback-created" });
    fixture.db.prepare("DELETE FROM memories WHERE id = ?").run(old.id);
    equal(tableCount(fixture.db, "memory_revisions"), 0, "删除展品级联清理修订");

    const one = memory("rollback-one", { title: "一", createdAt: "2026-03-02T00:00:00.000Z", updatedAt: "2026-03-02T00:00:00.000Z" });
    const two = memory("rollback-two", { title: "二", createdAt: "2026-03-03T00:00:00.000Z", updatedAt: "2026-03-03T00:00:00.000Z" });
    fixture.writeMemory(one); fixture.writeMemory(two);
    fixture.revisions.recordMemoryCreation(one, { id: "rollback-one-r1" });
    fixture.revisions.recordMemoryCreation(two, { id: "rollback-two-r1" });
    equal(fixture.revisions.clearRevisions([one.id]).revisionsDeleted, 1, "局部清理严格限制展品边界");
    equal(fixture.revisions.getRevisionStats().revisions, 1, "局部清理不影响其他展品");
    equal(fixture.revisions.clearRevisions().revisionsDeleted, 1, "完整清理返回实际删除数");
  } finally { fixture.close(); }
}

function checkBackupRestoreAndHeadVerification() {
  const source = createFixture("backup-source");
  const target = createFixture("backup-target");
  const broken = createFixture("backup-broken");
  try {
    const old = source.readMemory("backup-source-memory");
    const next = memory(old.id, { ...old, title: "可迁移的新版本", updatedAt: "2026-04-02T00:00:00.000Z" });
    source.revisions.recordMemoryTransition(old, next, {
      baselineId: "shared-revision-id",
      id: "backup-source-r2",
      createdAt: "2026-04-02T00:00:01.000Z"
    });
    source.writeMemory(next);
    const backup = source.revisions.buildRevisionBackup("full", [old.id]);
    equal(backup.revisions.length, 2, "数据库完整备份包含边界内整条链");

    const targetMemory = memory("backup-target-memory", { ...next, id: "backup-target-memory" });
    target.writeMemory(targetMemory);
    const occupiedMemory = memory("backup-target-occupied", { title: "占位", createdAt: "2026-04-03T00:00:00.000Z", updatedAt: "2026-04-03T00:00:00.000Z" });
    target.writeMemory(occupiedMemory);
    target.revisions.recordMemoryCreation(occupiedMemory, { id: "shared-revision-id" });
    const restored = target.revisions.restoreRevisionBackup(
      backup,
      new Map([[old.id, targetMemory.id]])
    );
    equal(restored.revisions, 2, "ID 冲突时仍完整恢复修订链");
    notEqual(restored.idMap.revisions["shared-revision-id"], "shared-revision-id", "冲突 revision ID 使用新安全 ID");
    const targetChain = target.revisions.listMemoryRevisions(targetMemory.id);
    equal(targetChain[1].parentSha256, targetChain[0].snapshotSha256, "ID remap 不改变 SHA 父链");
    equal(target.revisions.verifyMemoryHead(targetMemory).matches, true, "恢复后目标当前状态与 head 一致");

    const mismatched = memory("backup-broken-memory", { ...next, id: "backup-broken-memory", title: "不同当前值" });
    broken.writeMemory(mismatched);
    throwsCode(
      () => broken.revisions.restoreRevisionBackup(backup, { [old.id]: mismatched.id }),
      "REVISION_RESTORE_HEAD_MISMATCH",
      "目标当前值与源 head 不一致时整批拒绝"
    );
    equal(broken.revisions.getRevisionStats().revisions, 0, "head 不匹配回滚全部已插入修订");

    const redacted = source.revisions.buildRevisionBackup("redacted", [old.id]);
    deepEqual(target.revisions.restoreRevisionBackup(redacted, {}), {
      memories: 0,
      revisions: 0,
      skipped: 0,
      idMap: { memories: {}, revisions: {} }
    }, "脱敏摘要验真但保持零修订写入");
  } finally {
    source.close(); target.close(); broken.close();
  }
}

function checkRecentRevisionSummaries() {
  const fixture = createFixture("recent");
  try {
    const old = fixture.readMemory("recent-memory");
    const next = memory(old.id, { ...old, title: "最近修订后的标题", updatedAt: "2026-05-01T00:00:00.000Z" });
    fixture.revisions.recordMemoryTransition(old, next, {
      baselineId: "recent-z",
      id: "recent-b",
      createdAt: "2026-05-01T00:00:01.000Z"
    });
    fixture.writeMemory(next);
    const other = memory("recent-other", {
      title: "另一件展品",
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z"
    });
    fixture.writeMemory(other);
    fixture.revisions.recordMemoryCreation(other, {
      id: "recent-a",
      createdAt: "2026-05-01T00:00:01.000Z"
    });

    const recent = fixture.revisions.listRecentMemoryRevisions({ limit: 3 });
    deepEqual(recent.map((item) => item.id), ["recent-b", "recent-a", "recent-z"],
      "最近修订由单查询按时间、序号和 ID 稳定排序");
    deepEqual(recent.map((item) => item.memoryTitle), ["最近修订后的标题", "另一件展品", "最近修订后的标题"],
      "最近修订联表返回对应展品标题");
    deepEqual(fixture.revisions.listRecentMemoryRevisions({ limit: 2 }).map((item) => item.id), ["recent-b", "recent-a"],
      "SQL LIMIT 在解析前截断最近修订结果");
  } finally { fixture.close(); }
}

function checkCapacityRollbackAcrossWritePaths() {
  const fixture = createFixture("capacity");
  try {
    const memoryId = "capacity-memory";
    const backup = createExactBudgetBackup(memoryId);
    const headSnapshot = backup.revisions[backup.revisions.length - 1].snapshot;
    fixture.writeMemory(memory(memoryId, {
      ...headSnapshot,
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:00:00.000Z"
    }));
    const restored = fixture.revisions.restoreRevisionBackup(backup, { [memoryId]: memoryId });
    equal(restored.revisions, backup.revisions.length, "恰好填满字节预算的整批历史可一次恢复");
    const baselineCount = fixture.revisions.getRevisionStats().revisions;
    const baselineHead = fixture.revisions.getMemoryRevisionHead(memoryId);
    const current = fixture.readMemory(memoryId);

    const edited = memory(memoryId, {
      ...current,
      title: `${current.title}x`,
      updatedAt: "2026-06-02T00:00:00.000Z"
    });
    throwsCode(
      () => fixture.revisions.recordMemoryTransition(current, edited, { id: "capacity-edit" }),
      "REVISION_BACKUP_LIMIT_EXCEEDED",
      "普通编辑不能把可备份账本推过字节预算"
    );
    assertLedgerUnchanged(fixture, memoryId, baselineCount, baselineHead.id, "编辑超限完整回滚");

    const restoredMemory = memory(memoryId, {
      ...current,
      ...backup.revisions[0].snapshot,
      updatedAt: "2026-06-03T00:00:00.000Z"
    });
    throwsCode(
      () => fixture.revisions.recordMemoryTransition(current, restoredMemory, {
        changeKind: "restored",
        id: "capacity-restore",
        restoredFromRevisionId: backup.revisions[0].id
      }),
      "REVISION_BACKUP_LIMIT_EXCEEDED",
      "恢复旧版不能把可备份账本推过字节预算"
    );
    assertLedgerUnchanged(fixture, memoryId, baselineCount, baselineHead.id, "旧版恢复超限完整回滚");

    const created = memory("capacity-created", { title: "容量外新建" });
    fixture.writeMemory(created);
    throwsCode(
      () => fixture.revisions.recordMemoryCreation(created, { id: "capacity-created-r1" }),
      "REVISION_BACKUP_LIMIT_EXCEEDED",
      "新建首条修订不能越过账本预算"
    );
    equal(fixture.revisions.listMemoryRevisions(created.id).length, 0, "新建超限不留下半条修订");

    const imported = memory("capacity-imported", { title: "容量外导入" });
    fixture.writeMemory(imported);
    throwsCode(
      () => fixture.revisions.recordMemoryCreation(imported, {
        changeKind: "imported",
        id: "capacity-imported-r1"
      }),
      "REVISION_BACKUP_LIMIT_EXCEEDED",
      "导入首条修订不能越过账本预算"
    );
    equal(fixture.revisions.listMemoryRevisions(imported.id).length, 0, "导入超限不留下半条修订");

    const target = memory("capacity-target", { title: "整批恢复目标" });
    fixture.writeMemory(target);
    const sourceId = "capacity-source";
    const sourceSnapshot = createMemorySnapshot(target);
    const incoming = buildRevisionBackup({ revisions: [{
      changeKind: "created",
      changeNote: "",
      createdAt: "2026-06-04T00:00:00.000Z",
      id: "capacity-batch-r1",
      memoryId: sourceId,
      parentSha256: "",
      restoredFromRevisionId: "",
      revisionNo: 1,
      snapshot: sourceSnapshot,
      snapshotSha256: memorySnapshotSha256(sourceSnapshot),
      sourceUpdatedAt: "2026-06-04T00:00:00.000Z"
    }] }, "full", [sourceId]);
    throwsCode(
      () => fixture.revisions.restoreRevisionBackup(incoming, { [sourceId]: target.id }),
      "REVISION_BACKUP_LIMIT_EXCEEDED",
      "整批历史恢复只在整批插入后统一检查并原子回滚"
    );
    equal(fixture.revisions.listMemoryRevisions(target.id).length, 0, "整批恢复超限不留下部分历史");
    assertLedgerUnchanged(fixture, memoryId, baselineCount, baselineHead.id, "所有超限写路径后原账本保持不变");
  } finally { fixture.close(); }
}

function assertLedgerUnchanged(fixture, memoryId, revisionCount, headId, message) {
  equal(fixture.revisions.getRevisionStats().revisions, revisionCount, `${message}：总数不变`);
  equal(fixture.revisions.getMemoryRevisionHead(memoryId).id, headId, `${message}：head 不变`);
}

function createExactBudgetBackup(memoryId) {
  const revisions = [];
  const fullSnapshot = createMemorySnapshot(memory(memoryId, {
    attachments: [],
    rawContent: "x".repeat(4000),
    title: "容量边界"
  }));
  let bytes = Buffer.byteLength(JSON.stringify({ mode: "full", schemaVersion: 10, revisions: [] }), "utf8");
  let parentSha256 = "";

  while (true) {
    const next = budgetRevision(memoryId, revisions.length + 1, parentSha256, fullSnapshot);
    const contribution = Buffer.byteLength(JSON.stringify(next), "utf8") + (revisions.length ? 1 : 0);
    if (bytes + contribution > REVISION_BACKUP_LIMITS.bytes) break;
    revisions.push(next);
    bytes += contribution;
    parentSha256 = next.snapshotSha256;
  }

  let tail = budgetRevision(
    memoryId,
    revisions.length + 1,
    parentSha256,
    createMemorySnapshot(memory(memoryId, { attachments: [], rawContent: "", title: "容量边界" }))
  );
  let tailContribution = Buffer.byteLength(JSON.stringify(tail), "utf8") + 1;
  let remaining = REVISION_BACKUP_LIMITS.bytes - bytes;
  if (remaining < tailContribution) {
    const shrinkBy = tailContribution - remaining;
    const previous = revisions[revisions.length - 1];
    previous.snapshot.rawContent = previous.snapshot.rawContent.slice(0, -shrinkBy);
    previous.snapshotSha256 = memorySnapshotSha256(previous.snapshot);
    parentSha256 = previous.snapshotSha256;
    bytes -= shrinkBy;
    remaining += shrinkBy;
    tail = budgetRevision(memoryId, revisions.length + 1, parentSha256, tail.snapshot);
    tailContribution = Buffer.byteLength(JSON.stringify(tail), "utf8") + 1;
  }
  tail.snapshot.rawContent = "y".repeat(remaining - tailContribution);
  tail.snapshotSha256 = memorySnapshotSha256(tail.snapshot);
  revisions.push(tail);

  const backup = { mode: "full", schemaVersion: 10, revisions };
  equal(Buffer.byteLength(JSON.stringify(backup), "utf8"), REVISION_BACKUP_LIMITS.bytes,
    "数据库容量夹具精确填满统一字节预算");
  return backup;
}

function budgetRevision(memoryId, revisionNo, parentSha256, snapshot) {
  return {
    changeKind: revisionNo === 1 ? "created" : "edited",
    changeNote: "",
    createdAt: "2026-06-01T00:00:00.000Z",
    id: `capacity-budget-r${revisionNo}`,
    memoryId,
    parentSha256,
    restoredFromRevisionId: "",
    revisionNo,
    snapshot: clone(snapshot),
    snapshotSha256: memorySnapshotSha256(snapshot),
    sourceUpdatedAt: "2026-06-01T00:00:00.000Z"
  };
}

function createFixture(prefix, options = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  createCoreSchema(db);
  const initial = memory(`${prefix}-memory`, {
    title: `${prefix} 初始标题`,
    rawContent: `${prefix} 初始正文。`,
    people: ["甲"],
    tags: ["初始"],
    emotions: ["平静"],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: ""
  });
  writeMemory(db, initial);
  applyMigrations({
    db,
    baselineVersion: 4,
    migrations: LEGACY_MIGRATIONS,
    supportedVersion: 9,
    now: () => "2026-01-01T00:00:00.000Z"
  });
  let sequence = 0;
  const now = () => new Date(Date.UTC(2026, 0, 10, 0, 0, sequence++)).toISOString();
  let idSequence = 0;
  const createId = (kind) => `${prefix}-${kind}-${++idSequence}`;
  let revisions = null;
  const initialize = () => {
    revisions = initializeRevisionDatabase({ db, schemaVersion: 10, now, createId });
    return revisions;
  };
  if (options.initialize !== false) initialize();
  return {
    db,
    get revisions() { return revisions; },
    initialize,
    readMemory: (id) => readMemory(db, id),
    writeMemory: (value) => writeMemory(db, value),
    close: () => db.close()
  };
}

function createCoreSchema(db) {
  db.exec(`
    CREATE TABLE memories (
      id TEXT PRIMARY KEY, schema_version INTEGER NOT NULL DEFAULT 9,
      title TEXT NOT NULL, hall_id TEXT NOT NULL, source_type TEXT NOT NULL,
      raw_content TEXT NOT NULL, exhibit_text TEXT NOT NULL,
      memory_date TEXT NOT NULL DEFAULT '', location TEXT NOT NULL DEFAULT '',
      emotion_intensity INTEGER NOT NULL DEFAULT 3, importance INTEGER NOT NULL DEFAULT 1,
      favorite INTEGER NOT NULL DEFAULT 0, cover_image TEXT NOT NULL DEFAULT '',
      media_note TEXT NOT NULL DEFAULT '', attachments_json TEXT NOT NULL DEFAULT '[]',
      agent_run_id TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE memory_people (
      memory_id TEXT NOT NULL, name TEXT NOT NULL, PRIMARY KEY(memory_id, name),
      FOREIGN KEY(memory_id) REFERENCES memories(id) ON DELETE CASCADE
    );
    CREATE TABLE memory_tags (
      memory_id TEXT NOT NULL, tag TEXT NOT NULL, PRIMARY KEY(memory_id, tag),
      FOREIGN KEY(memory_id) REFERENCES memories(id) ON DELETE CASCADE
    );
    CREATE TABLE memory_emotions (
      memory_id TEXT NOT NULL, emotion TEXT NOT NULL, PRIMARY KEY(memory_id, emotion),
      FOREIGN KEY(memory_id) REFERENCES memories(id) ON DELETE CASCADE
    );
  `);
}

function memory(id, overrides = {}) {
  return {
    id,
    title: "默认标题",
    hall: "daily",
    sourceType: "日记",
    rawContent: "默认正文。",
    exhibitText: "默认展品说明。",
    date: "2025-12-31",
    location: "本地",
    people: [],
    tags: [],
    emotions: [],
    emotionIntensity: 3,
    importance: 2,
    favorite: false,
    coverImage: "",
    mediaNote: "",
    attachments: [],
    agentRunId: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
    id
  };
}

function writeMemory(db, value) {
  db.prepare(`
    INSERT INTO memories (
      id, schema_version, title, hall_id, source_type, raw_content, exhibit_text,
      memory_date, location, emotion_intensity, importance, favorite, cover_image,
      media_note, attachments_json, agent_run_id, created_at, updated_at
    ) VALUES (?, 10, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title=excluded.title, hall_id=excluded.hall_id, source_type=excluded.source_type,
      raw_content=excluded.raw_content, exhibit_text=excluded.exhibit_text,
      memory_date=excluded.memory_date, location=excluded.location,
      emotion_intensity=excluded.emotion_intensity, importance=excluded.importance,
      favorite=excluded.favorite, cover_image=excluded.cover_image, media_note=excluded.media_note,
      attachments_json=excluded.attachments_json, agent_run_id=excluded.agent_run_id,
      created_at=excluded.created_at, updated_at=excluded.updated_at
  `).run(
    value.id, value.title, value.hall, value.sourceType, value.rawContent, value.exhibitText,
    value.date, value.location, value.emotionIntensity, value.importance, value.favorite ? 1 : 0,
    value.coverImage, value.mediaNote, JSON.stringify(value.attachments), value.agentRunId || "",
    value.createdAt, value.updatedAt
  );
  db.prepare("DELETE FROM memory_people WHERE memory_id = ?").run(value.id);
  db.prepare("DELETE FROM memory_tags WHERE memory_id = ?").run(value.id);
  db.prepare("DELETE FROM memory_emotions WHERE memory_id = ?").run(value.id);
  [...new Set(value.people)].forEach((item) => db.prepare("INSERT INTO memory_people VALUES (?, ?)").run(value.id, item));
  [...new Set(value.tags)].forEach((item) => db.prepare("INSERT INTO memory_tags VALUES (?, ?)").run(value.id, item));
  [...new Set(value.emotions)].forEach((item) => db.prepare("INSERT INTO memory_emotions VALUES (?, ?)").run(value.id, item));
}

function readMemory(db, id) {
  const row = db.prepare("SELECT * FROM memories WHERE id = ?").get(id);
  return memory(id, {
    title: row.title,
    hall: row.hall_id,
    sourceType: row.source_type,
    rawContent: row.raw_content,
    exhibitText: row.exhibit_text,
    date: row.memory_date,
    location: row.location,
    people: db.prepare("SELECT name FROM memory_people WHERE memory_id = ? ORDER BY name").all(id).map((item) => item.name),
    tags: db.prepare("SELECT tag FROM memory_tags WHERE memory_id = ? ORDER BY tag").all(id).map((item) => item.tag),
    emotions: db.prepare("SELECT emotion FROM memory_emotions WHERE memory_id = ? ORDER BY emotion").all(id).map((item) => item.emotion),
    emotionIntensity: row.emotion_intensity,
    importance: row.importance,
    favorite: Boolean(row.favorite),
    coverImage: row.cover_image,
    mediaNote: row.media_note,
    attachments: JSON.parse(row.attachments_json),
    agentRunId: row.agent_run_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

function snapshotCoreRows(db) {
  const row = db.prepare("SELECT * FROM memories LIMIT 1").get();
  return {
    memoryCount: tableCount(db, "memories"),
    peopleCount: tableCount(db, "memory_people"),
    tagCount: tableCount(db, "memory_tags"),
    emotionCount: tableCount(db, "memory_emotions"),
    title: row.title,
    rawContent: row.raw_content,
    memoryCreatedAt: row.created_at,
    memoryUpdatedAt: row.updated_at
  };
}

function tableExists(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
}

function indexExists(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name=?").get(name));
}

function tableCount(db, name) {
  return Number(db.prepare(`SELECT COUNT(*) AS count FROM ${name}`).get().count);
}

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function compareText(left, right) { return left < right ? -1 : left > right ? 1 : 0; }

function ok(value, message) { assert.ok(value, message); assertions += 1; }
function equal(actual, expected, message) { assert.equal(actual, expected, message); assertions += 1; }
function notEqual(actual, expected, message) { assert.notEqual(actual, expected, message); assertions += 1; }
function deepEqual(actual, expected, message) { assert.deepEqual(actual, expected, message); assertions += 1; }
function throwsCode(operation, code, message) {
  assert.throws(operation, (error) => error?.code === code, message);
  assertions += 1;
}
