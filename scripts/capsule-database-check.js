"use strict";

const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const {
  CAPSULE_MIGRATION,
  initializeCapsuleDatabase
} = require("../lib/capsule-database");
const { CEREMONIAL_GATE } = require("../lib/capsule-service");
const { applyMigrations, listAppliedMigrations, readUserVersion } = require("../lib/migrations");

const TEST_MIGRATIONS = Object.freeze([5, 6, 7, 8].map((version) => ({
  version,
  name: `capsule-check-v${version}`,
  up(db) {
    db.exec(`CREATE TABLE capsule_legacy_v${version} (id TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  }
})));

let assertions = 0;

checkSchema8Migration();
checkStorageIntegrityAndCleanup();
checkBackupRestore();

console.log(`Capsule database checks passed: ${assertions} assertions.`);

function checkSchema8Migration() {
  const fixture = createSchema8Fixture("migration", { initialize: false });
  try {
    equal(readUserVersion(fixture.db), 8, "迁移夹具从真实账本版本 8 开始");
    const oldTables = [
      "memories", "memory_people", "memory_tags", "memory_emotions", "exhibitions",
      "media_assets", "media_variants", "capsule_legacy_v5", "capsule_legacy_v6",
      "capsule_legacy_v7", "capsule_legacy_v8"
    ];
    const before = Object.fromEntries(oldTables.map((table) => [table, tableCount(fixture.db, table)]));
    const capsules = fixture.initialize();
    equal(readUserVersion(fixture.db), 9, "schema 8 数据库按顺序迁移到 schema 9");
    deepEqual(
      listAppliedMigrations(fixture.db).map((entry) => entry.version),
      [4, 5, 6, 7, 8, 9],
      "迁移 9 只追加账本而不改写旧迁移"
    );
    deepEqual(
      Object.fromEntries(oldTables.map((table) => [table, tableCount(fixture.db, table)])),
      before,
      "schema 8 的所有旧表计数在迁移后保持不变"
    );
    deepEqual(capsules.getCapsuleStats(), {
      capsules: 0,
      payloads: 0,
      mediaLinks: 0,
      needsReview: 0
    }, "三个 schema 9 新表在迁移已有数据后全部为空");
    for (const table of ["time_capsules", "time_capsule_payloads", "time_capsule_media"]) {
      ok(tableExists(fixture.db, table), `迁移创建 ${table}`);
    }
    ok(columnExists(fixture.db, "time_capsule_payloads", "payload_sha256"), "payload 表保存私有 SHA-256 完整性值");
    const mediaSql = String(fixture.db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='time_capsule_media'").get()?.sql || "");
    ok(/FOREIGN KEY \(asset_id\)[\s\S]*ON DELETE CASCADE/iu.test(mediaSql), "图片资产删除使用级联而不是阻塞原有清理流程");
    ok(tableExists(fixture.db, "mark_time_capsules_for_review_before_media_delete", "trigger"), "图片删除前触发器会标记胶囊待复核");

    const ledger = listAppliedMigrations(fixture.db);
    const reopened = fixture.initialize();
    deepEqual(listAppliedMigrations(fixture.db), ledger, "重复初始化不会重复迁移或改写账本");
    equal(reopened.getCapsuleStats().capsules, 0, "重复初始化后的数据库仍可使用");
    equal(CAPSULE_MIGRATION.version, 9, "公开迁移常量固定为 schema 9");
  } finally {
    fixture.close();
  }
}

function checkStorageIntegrityAndCleanup() {
  const fixture = createSchema8Fixture("storage");
  try {
    const capsules = fixture.capsules;
    throwsCode(
      () => capsules.createCapsule(capsuleInput({ confirm: false })),
      "CAPSULE_CONFIRMATION_REQUIRED",
      "数据库写入也要求显式 confirm:true"
    );
    deepEqual(capsules.getCapsuleStats(), { capsules: 0, payloads: 0, mediaLinks: 0, needsReview: 0 }, "缺少确认的创建保持零写入");
    throwsCode(
      () => capsules.createCapsule(capsuleInput({ exhibitionId: "exhibition-draft" })),
      "CAPSULE_SOURCE_REVIEW_REQUIRED",
      "数据库拒绝草稿或待复核来源"
    );

    const created = capsules.createCapsule(capsuleInput());
    deepEqual(Object.keys(created).sort(), [
      "ceremonialGate", "createdAt", "id", "needsReview", "opensOn",
      "shellMessage", "timezone", "title"
    ], "数据库外壳读取不泄漏来源、更新时间或 payload");
    equal(created.ceremonialGate, CEREMONIAL_GATE, "持久层固定记录本地日期仪式门槛");
    deepEqual(capsules.getCapsuleStats(), { capsules: 1, payloads: 1, mediaLinks: 1, needsReview: 0 }, "外壳、payload 与图片链接分别计数");
    const payload = capsules.getCapsulePayload("capsule-source");
    deepEqual(payload.snapshot, safeSnapshot(), "严格安全快照完整往返");
    deepEqual(payload.mediaLinks, [mediaLink("media-display")], "图片内部链接与匿名 itemKey 完整往返");
    const stored = fixture.db.prepare(`
      SELECT safe_snapshot_json, payload_sha256 FROM time_capsule_payloads WHERE capsule_id = ?
    `).get("capsule-source");
    equal(stored.payload_sha256, sha256(stored.safe_snapshot_json), "SHA-256 覆盖数据库中精确 UTF-8 JSON 字节");
    ok(/^[a-f0-9]{64}$/u.test(stored.payload_sha256), "payload hash 是 64 位小写十六进制");

    fixture.db.prepare("UPDATE time_capsule_payloads SET safe_snapshot_json = ? WHERE capsule_id = ?")
      .run('{"tampered":true}', "capsule-source");
    equal(capsules.listCapsuleShells().length, 1, "payload 被篡改时列表仍只读取外壳");
    equal(capsules.getCapsuleShell("capsule-source").title, "未来展览", "payload 被篡改时单外壳读取仍可用");
    throwsCode(
      () => capsules.getCapsulePayload("capsule-source"),
      "CAPSULE_PAYLOAD_INTEGRITY_FAILED",
      "payload 篡改在 JSON 解析前失败关闭"
    );
    fixture.db.prepare(`
      UPDATE time_capsule_payloads SET safe_snapshot_json = ?, payload_sha256 = ? WHERE capsule_id = ?
    `).run(stored.safe_snapshot_json, stored.payload_sha256, "capsule-source");
    deepEqual(capsules.getCapsulePayload("capsule-source").snapshot, safeSnapshot(), "恢复精确 JSON 与 hash 后可再次读取");

    capsules.createCapsule(capsuleInput({
      id: "capsule-media-delete",
      exhibitionId: "",
      mediaLinks: [mediaLink("media-delete")]
    }));
    const updatedBefore = fixture.db.prepare("SELECT updated_at FROM time_capsules WHERE id = ?").get("capsule-media-delete").updated_at;
    fixture.db.prepare("DELETE FROM media_assets WHERE id = ?").run("media-delete");
    equal(capsules.getCapsuleShell("capsule-media-delete").needsReview, true, "删除展示图片会保留胶囊并标记待复核");
    equal(capsules.getCapsulePayload("capsule-media-delete").mediaLinks.length, 0, "删除图片资产会级联清理内部链接");
    const updatedAfter = fixture.db.prepare("SELECT updated_at FROM time_capsules WHERE id = ?").get("capsule-media-delete").updated_at;
    ok(updatedAfter !== updatedBefore, "图片删除触发器同步更新时间");

    capsules.createCapsule(capsuleInput({ id: "capsule-delete", exhibitionId: "", mediaLinks: [] }));
    equal(capsules.deleteCapsule("capsule-delete"), true, "删除胶囊返回 true");
    equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM time_capsule_payloads WHERE capsule_id = ?").get("capsule-delete").count, 0, "删除外壳级联删除 payload");
    equal(capsules.deleteCapsule("capsule-delete"), false, "重复删除返回 false");
  } finally {
    fixture.close();
  }
}

function checkBackupRestore() {
  const source = createSchema8Fixture("backup-source");
  const target = createSchema8Fixture("backup-target");
  try {
    source.capsules.createCapsule(capsuleInput());
    const full = source.capsules.buildCapsuleBackup("full");
    ok(source.capsules.validateCapsuleBackup(full), "完整备份通过严格验证");
    equal(full.schemaVersion, 9, "完整备份声明 schema 9");
    equal(full.capsules.length, 1, "完整备份包含外壳与安全 payload");
    const fullJson = JSON.stringify(full);
    ok(!fullJson.includes("payload_sha256") && !fullJson.includes(sha256(JSON.stringify(safeSnapshot()))), "payload hash 保持私有且不进入备份合同");

    const redacted = source.capsules.buildCapsuleBackup("redacted");
    ok(source.capsules.validateCapsuleBackup(redacted), "脱敏备份通过严格摘要合同");
    ok(!Object.hasOwn(redacted, "schemaVersion"), "脱敏摘要遵循通用 feature section 合同且不声明 schemaVersion");
    const redactedJson = JSON.stringify(redacted);
    for (const secret of ["capsule-source", "未来展览", "2040-02-29", "Asia/Shanghai", "media-display", "item-1", "展览开场"]) {
      ok(!redactedJson.includes(secret), `脱敏备份物理排除 ${secret}`);
    }
    ok(!Object.hasOwn(redacted, "capsules"), "脱敏备份不携带胶囊数组");
    const unsafeRedacted = { ...redacted, capsules: full.capsules };
    throwsCode(() => source.capsules.validateCapsuleBackup(unsafeRedacted), "CAPSULE_BACKUP_INVALID", "脱敏摘要不能夹带 payload");
    throwsCode(
      () => source.capsules.validateCapsuleBackup({ ...redacted, note: "capsule-source" }),
      "CAPSULE_BACKUP_INVALID",
      "脱敏摘要 note 固定，不能借文本字段夹带内部 ID"
    );

    const duplicate = structuredClone(full);
    duplicate.capsules.push(structuredClone(duplicate.capsules[0]));
    throwsCode(() => source.capsules.validateCapsuleBackup(duplicate), "CAPSULE_BACKUP_DUPLICATE", "完整备份拒绝重复胶囊 ID");
    const unsafeSnapshot = structuredClone(full);
    unsafeSnapshot.capsules[0].snapshot.sections[0].items[0].memoryId = "memory-secret";
    throwsCode(() => source.capsules.validateCapsuleBackup(unsafeSnapshot), "CAPSULE_SNAPSHOT_UNSAFE", "完整备份拒绝夹带内部展品 ID");

    target.capsules.createCapsule(capsuleInput({ mediaLinks: [] }));
    const restored = target.capsules.restoreCapsuleBackup(full, {
      exhibitionIdMap: { "exhibition-published": "exhibition-target" },
      mediaAssetIdMap: { "media-display": "media-target" }
    });
    equal(restored.capsules, 1, "恢复完整备份写入一个胶囊");
    ok(restored.idMap["capsule-source"] !== "capsule-source", "目标 ID 冲突时生成无碰撞胶囊 ID");
    const restoredPayload = target.capsules.getCapsulePayload(restored.idMap["capsule-source"]);
    equal(restoredPayload.mediaLinks[0].assetId, "media-target", "恢复按显式映射重写图片资产 ID");
    deepEqual(restoredPayload.snapshot, safeSnapshot(), "恢复不修改匿名安全快照");
    ok(target.transaction.nestedEntries > 0, "恢复事务覆盖内部 createCapsule 且安全处理嵌套事务");
    deepEqual(
      target.capsules.restoreCapsuleBackup(redacted),
      { capsules: 0, mediaLinks: 0, idMap: {} },
      "脱敏摘要恢复为明确零写入"
    );

    const missing = createSchema8Fixture("backup-missing");
    try {
      throwsCode(
        () => missing.capsules.restoreCapsuleBackup(full, {
          mediaAssetIdMap: { "media-display": "missing-media" }
        }),
        "CAPSULE_BACKUP_REFERENCE_INVALID",
        "恢复在缺少图片映射时整体失败"
      );
      deepEqual(missing.capsules.getCapsuleStats(), { capsules: 0, payloads: 0, mediaLinks: 0, needsReview: 0 }, "失败的恢复保持零写入");
      const skipped = missing.capsules.restoreCapsuleBackup(full, {
        mediaAssetIdMap: { "media-display": "missing-media" },
        skipMissingMedia: true
      });
      equal(skipped.mediaLinks, 0, "显式 skipMissingMedia 可恢复纯文本安全快照");
    } finally {
      missing.close();
    }

    const cleared = target.capsules.clearCapsules();
    ok(cleared.capsulesDeleted >= 2 && cleared.payloadsDeleted >= 2, "clear 返回删除前精确资源计数");
    deepEqual(target.capsules.getCapsuleStats(), { capsules: 0, payloads: 0, mediaLinks: 0, needsReview: 0 }, "clear 级联清空三个胶囊表");
  } finally {
    source.close();
    target.close();
  }
}

function createSchema8Fixture(label, options = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE memories (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL
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
    CREATE TABLE exhibitions (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      needs_review INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE media_assets (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE media_variants (
      asset_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      PRIMARY KEY (asset_id, kind),
      FOREIGN KEY (asset_id) REFERENCES media_assets(id) ON DELETE CASCADE
    );
  `);
  const timestamp = "2028-01-01T00:00:00.000Z";
  db.prepare("INSERT INTO memories (id, title, created_at) VALUES (?, ?, ?)").run("memory-existing", "旧记忆", timestamp);
  db.prepare("INSERT INTO memory_people (memory_id, name) VALUES (?, ?)").run("memory-existing", "老友");
  db.prepare("INSERT INTO memory_tags (memory_id, tag) VALUES (?, ?)").run("memory-existing", "海边");
  db.prepare("INSERT INTO memory_emotions (memory_id, emotion) VALUES (?, ?)").run("memory-existing", "温暖");
  db.prepare("INSERT INTO exhibitions (id, status, needs_review) VALUES (?, 'published', 0)").run("exhibition-published");
  db.prepare("INSERT INTO exhibitions (id, status, needs_review) VALUES (?, 'published', 0)").run("exhibition-target");
  db.prepare("INSERT INTO exhibitions (id, status, needs_review) VALUES (?, 'draft', 1)").run("exhibition-draft");
  for (const assetId of ["media-display", "media-delete", "media-target"]) {
    db.prepare("INSERT INTO media_assets (id, status, updated_at) VALUES (?, 'ready', ?)").run(assetId, timestamp);
    db.prepare("INSERT INTO media_variants (asset_id, kind, mime_type) VALUES (?, 'display', 'image/webp')").run(assetId);
  }
  applyMigrations({ db, baselineVersion: 4, migrations: TEST_MIGRATIONS, now: () => timestamp });
  TEST_MIGRATIONS.forEach((migration) => db.prepare(`INSERT INTO capsule_legacy_v${migration.version} (id, value) VALUES (?, ?)`)
    .run(`legacy-${migration.version}`, `value-${migration.version}`));

  let idCounter = 0;
  const transaction = { depth: 0, begins: 0, nestedEntries: 0 };
  const withTransaction = (operation) => {
    if (transaction.depth > 0) {
      transaction.nestedEntries += 1;
      return operation();
    }
    db.exec("BEGIN");
    transaction.depth += 1;
    transaction.begins += 1;
    try {
      const result = operation();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    } finally {
      transaction.depth -= 1;
    }
  };
  const initialize = () => initializeCapsuleDatabase({
    db,
    schemaVersion: 9,
    now: () => "2028-01-02T03:04:05.000Z",
    createId: (prefix) => `${prefix}-${label}-${++idCounter}`,
    withTransaction
  });
  const fixture = {
    db,
    initialize,
    transaction,
    capsules: null,
    close: () => db.close()
  };
  if (options.initialize !== false) fixture.capsules = initialize();
  return fixture;
}

function capsuleInput(overrides = {}) {
  const base = {
    id: "capsule-source",
    title: "未来展览",
    shellMessage: "到那天再打开",
    opensOn: "2040-02-29",
    timezone: "Asia/Shanghai",
    ceremonialGate: CEREMONIAL_GATE,
    exhibitionId: "exhibition-published",
    snapshot: safeSnapshot(),
    mediaLinks: [mediaLink("media-display")],
    confirm: true
  };
  return { ...base, ...overrides };
}

function safeSnapshot() {
  return {
    version: 1,
    title: "未来展览",
    theme: "重逢",
    opening: "展览开场",
    sections: [{
      key: "section-1",
      title: "第一章",
      summary: "匿名、安全的展览摘要。",
      items: [{
        key: "item-1",
        title: "旧码头",
        excerpt: "晚风吹过。",
        curatorNote: "留给未来。",
        confirmedQuotes: ["海风吹过旧码头"],
        confirmedTranscripts: ["这是确认后的口述。"]
      }, {
        key: "item-2",
        title: "回程",
        excerpt: "车灯亮起。",
        curatorNote: "第二件展品。",
        confirmedQuotes: ["车灯照亮了站台"],
        confirmedTranscripts: []
      }]
    }]
  };
}

function mediaLink(assetId) {
  return {
    assetId,
    itemKey: "item-1",
    position: 0,
    altText: "海边",
    caption: "隐私处理后的展示图"
  };
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function tableExists(db, name, type = "table") {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?").get(type, name));
}

function columnExists(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((entry) => entry.name === column);
}

function tableCount(db, table) {
  if (!/^[a-z0-9_]+$/u.test(table)) throw new Error(`Unsafe table name: ${table}`);
  return Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count || 0);
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
