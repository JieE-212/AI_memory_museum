"use strict";

const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const { applyMigrations, listAppliedMigrations, readUserVersion } = require("../lib/migrations");
const {
  COORDINATE_SPACE,
  OFFSET_UNIT,
  buildAnchorKey,
  catalogSourceToClaimSource,
  mapCatalogResolutionToResolverResult,
  normalizeClaimDraftInput,
  normalizeVerifiedSourceSnapshot,
  sha256,
  stableStringify
} = require("../lib/provenance-service");
const {
  createProvenanceSourceCatalog,
  createSnapshot,
  provenanceKey
} = require("../lib/provenance-sources");
const {
  PROVENANCE_REDACTED_NOTE,
  validateProvenanceBackupPayload
} = require("../lib/provenance-backup");
const {
  PROVENANCE_MIGRATION,
  initializeProvenanceDatabase
} = require("../lib/provenance-database");

const PREVIOUS_MIGRATIONS = Array.from({ length: 11 }, (_, index) => index + 5).map((version) => Object.freeze({
  version,
  name: `provenance-test-v${version}`,
  up() {}
}));

let assertions = 0;

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});

async function main() {
  checkPureSourceContract();
  checkSourceCatalogBridge();
  checkDatabaseLifecycleAndIdempotency();
  checkBackupAndRestore();
  checkMigrationFailureAndFutureGuard();
  console.log(`Provenance checks passed: ${assertions} assertions.`);
}

function checkSourceCatalogBridge() {
  const memory = { id: "memory-a", title: "Catalog bridge", rawContent: "A\u{1f600}B" };
  const catalog = createProvenanceSourceCatalog({ getMemory: (id) => id === memory.id ? memory : null });
  const candidate = catalog.listSources(memory.id)[0];
  const resolution = catalog.resolveSource(memory.id, {
    kind: candidate.kind,
    referenceId: candidate.referenceId,
    sourceKey: candidate.sourceKey,
    snapshotSha256: candidate.snapshotSha256,
    startOffset: 1,
    endOffset: 3
  });
  equal(resolution.status, "resolved", "catalog resolves the live memory range before core admission");
  const bridged = catalogSourceToClaimSource(resolution.source, { relationKind: "supports" });
  const claim = normalizeClaimDraftInput({
    memoryId: memory.id,
    statement: "The selected range contains the remembered symbol.",
    sources: [bridged]
  });
  equal(claim.sources[0].snapshot.excerpt, "\u{1f600}", "catalog UTF-16 range crosses the bridge without changing text");
  ok(claim.sources[0].sourceKey.startsWith("memory-text-source:"), "bridge emits the core canonical source identity");
  equal(claim.sources[0].snapshot.metadata.catalog.sourceKey, resolution.source.sourceKey,
    "core snapshot binds the original catalog source identity");
  deepEqual(mapCatalogResolutionToResolverResult(resolution),
    { status: "source_verified", reason: "catalog_resolved" }, "resolved catalog state maps to a current DB source");
  equal(mapCatalogResolutionToResolverResult("source_changed").status, "source_changed",
    "changed catalog state remains review-only");
  equal(mapCatalogResolutionToResolverResult("missing").status, "source_missing",
    "missing catalog state remains review-only");
  throwsCode(() => catalogSourceToClaimSource({ ...resolution.source, snapshotSha256: "0".repeat(64) }),
    "PROVENANCE_CATALOG_SNAPSHOT_INVALID", "bridge rejects a catalog snapshot with a forged digest");

  const imageDigest = sha256("catalog image bytes");
  const imageCatalogSource = createSnapshot({
    kind: "image_region",
    memoryId: memory.id,
    referenceId: "image:observation-one",
    sourceKey: provenanceKey("image-source", { memoryId: memory.id, imageDigest }),
    anchorKey: provenanceKey("image-region", { memoryId: memory.id, imageDigest, x: 0.1 }),
    label: "Confirmed photo region",
    locator: { coordinateSpace: COORDINATE_SPACE, x: 0.1, y: 0.1, width: 0.4, height: 0.4 },
    excerpt: "",
    contentSha256: imageDigest,
    confirmation: "user_confirmed"
  });
  const imageClaim = normalizeClaimDraftInput({
    memoryId: memory.id,
    statement: "This claim points to a confirmed photo region without invented text.",
    sources: [catalogSourceToClaimSource(imageCatalogSource)]
  });
  equal(imageClaim.sources[0].snapshot.excerpt, "", "image provenance crosses the bridge without fabricated prose");
}

function checkPureSourceContract() {
  const text = memoryTextSource();
  equal(text.locator.offsetUnit, OFFSET_UNIT, "文字来源固定 UTF-16 code-unit 偏移合同");
  equal(text.locator.endOffset - text.locator.startOffset, text.snapshot.excerpt.length, "emoji 选段按 UTF-16 长度闭包");
  equal(text.snapshot.excerpt, "😀", "emoji 区间逐字保留且不做 Unicode 归一化");
  ok(text.anchorKey.startsWith("memory-text-anchor:"), "原文区间生成内容寻址 anchor key");

  const document = documentSource();
  const expectedDocumentAnchor = `text-anchor:${sha256(stableStringify({
    sourceKey: document.sourceKey,
    offsetUnit: OFFSET_UNIT,
    startOffset: 0,
    endOffset: 2,
    excerptSha256: sha256("文档")
  }))}`;
  equal(document.anchorKey, expectedDocumentAnchor, "文档片段直接复用 V11 text-anchor 稳定身份合同");
  equal(buildAnchorKey({
    sourceKind: "document_excerpt",
    sourceKey: document.sourceKey,
    locator: document.locator,
    excerptSha256: document.snapshot.excerptSha256
  }), document.anchorKey, "文档 anchor 可独立重算");

  const image = imageSource();
  equal(image.locator.coordinateSpace, COORDINATE_SPACE, "图片区域固定 canonical-preview-v1 坐标系");
  equal(image.locator.x, 0.123457, "图片坐标规范到六位小数");
  const voice = voiceSource();
  deepEqual(voice.locator, { startMs: 1200, endMs: 6400 }, "声音片段使用严格毫秒闭区间定位器");
  equal(voice.snapshot.excerpt, "", "纯声音选段不伪造文字稿");
  const oral = oralSource();
  equal(oral.snapshot.excerpt, "我记得那是在夏天", "口述史只保留人工文字片段快照");

  throwsCode(() => normalizeVerifiedSourceSnapshot({
    relationKind: "supports",
    sourceKind: "memory_text",
    sourceKey: `memory-text-source:${sha256("A😀B")}`,
    originRef: { memoryId: "memory-a" },
    locator: { offsetUnit: OFFSET_UNIT, startOffset: 1, endOffset: 2 },
    sourceSha256: sha256("A😀B"),
    excerpt: "\ud83d",
    sensitive: false
  }), "PROVENANCE_EXCERPT_INVALID", "文字片段拒绝截断 surrogate pair");
  throwsCode(() => normalizeVerifiedSourceSnapshot({ ...liveInput(image), confidence: 0.9 }), "PROVENANCE_FIELD_SET_INVALID", "来源合同拒绝 confidence 等真假评分字段");
  throwsCode(() => normalizeVerifiedSourceSnapshot({
    ...liveInput(text),
    locator: { offsetUnit: OFFSET_UNIT, startOffset: 0, endOffset: 1 }
  }), "PROVENANCE_TEXT_RANGE_MISMATCH", "文字摘录长度必须与显式 UTF-16 区间一致");
  throwsCode(() => normalizeVerifiedSourceSnapshot({
    ...liveInput(image),
    locator: { coordinateSpace: COORDINATE_SPACE, x: 0.9, y: 0.1, width: 0.2, height: 0.2 }
  }), "PROVENANCE_IMAGE_REGION_INVALID", "图片区域不能越出规范画布");
  throwsCode(() => normalizeVerifiedSourceSnapshot({
    ...liveInput(voice),
    locator: { startMs: 7000, endMs: 6000 }
  }), "PROVENANCE_INTEGER_INVALID", "声音区间拒绝反向端点");
}

function checkDatabaseLifecycleAndIdempotency() {
  const fixture = createFixture("lifecycle");
  try {
    deepEqual(listAppliedMigrations(fixture.db).map((entry) => entry.version), Array.from({ length: 13 }, (_, index) => index + 4), "迁移账本连续推进到 schema 16");
    equal(readUserVersion(fixture.db), 16, "schema 16 写入 PRAGMA user_version");
    const ledger = JSON.stringify(listAppliedMigrations(fixture.db));
    initializeProvenanceDatabase({
      db: fixture.db,
      schemaVersion: 16,
      now: () => fixture.clock.value,
      createId: fixture.createId,
      sourceResolver: fixture.resolve
    });
    equal(JSON.stringify(listAppliedMigrations(fixture.db)), ledger, "重复初始化只校验迁移定义且不改写账本");

    fixture.insertMemory("memory-a", "A😀B");
    const input = claimInput("memory-a", "旧车票是那次旅行留下的。", allSourceInputs());
    const created = fixture.provenance.createProvenanceClaim(input, { idempotencyKey: "claim-create-1" });
    ok(created.created && !created.idempotent, "创建动作只插入一条新主张");
    equal(created.claim.status, "draft", "创建只能得到 draft 而不会顺带确认");
    equal(created.claim.version, 1, "draft 只有 created 账本事件");
    equal(created.claim.sources.length, 5, "五类统一来源快照可同时绑定一条主张");
    deepEqual(tableCounts(fixture.db), { claims: 1, sources: 5, events: 1 }, "创建事务闭包写入 claim/source/created event");

    const firstClaimId = created.claim.id;
    const replay = fixture.provenance.createProvenanceClaim(input, { idempotencyKey: "claim-create-1" });
    ok(!replay.created && replay.idempotent && replay.claim.id === firstClaimId, "相同创建请求精确幂等重放");
    deepEqual(tableCounts(fixture.db), { claims: 1, sources: 5, events: 1 }, "创建重放不追加墓碑记录");
    throwsCode(() => fixture.provenance.createProvenanceClaim({ ...input, statement: "另一条主张" }, { idempotencyKey: "claim-create-1" }), "PROVENANCE_IDEMPOTENCY_CONFLICT", "幂等 key 不能复用于不同创建请求");
    throwsCode(() => fixture.provenance.confirmProvenanceClaim(firstClaimId, { confirm: false, expectedVersion: 1, idempotencyKey: "confirm-1" }), "PROVENANCE_CONFIRMATION_REQUIRED", "确认必须显式 confirm true");

    const changedAnchor = created.claim.sources[0].anchorKey;
    fixture.statusByAnchor.set(changedAnchor, "source_changed");
    throwsCode(() => fixture.provenance.confirmProvenanceClaim(firstClaimId, { confirm: true, expectedVersion: 1, idempotencyKey: "confirm-1" }), "PROVENANCE_SOURCE_NOT_CURRENT", "来源变化时 draft 不能确认");
    equal(tableCounts(fixture.db).events, 1, "失败确认不留下事件墓碑");
    fixture.statusByAnchor.set(changedAnchor, "source_verified");

    fixture.clock.value = "2026-07-19T01:00:00.000Z";
    const confirmed = fixture.provenance.confirmProvenanceClaim(firstClaimId, { confirm: true, expectedVersion: 1, idempotencyKey: "confirm-1" });
    ok(confirmed.changed && !confirmed.idempotent, "确认独立追加 confirmed 事件");
    equal(confirmed.claim.status, "confirmed", "当前来源完整时人工确认状态可见");
    equal(confirmed.claim.version, 2, "确认后版本只增加一个事件");
    equal(confirmed.claim.events[1].previousEventSha256, confirmed.claim.events[0].eventSha256, "confirmed 事件哈希链闭合到 created");
    const confirmReplay = fixture.provenance.confirmProvenanceClaim(firstClaimId, { confirm: true, expectedVersion: 1, idempotencyKey: "confirm-1" });
    ok(confirmReplay.idempotent && !confirmReplay.changed, "确认请求可在版本推进后精确重放");
    equal(tableCounts(fixture.db).events, 2, "确认重放不重复追加事件");
    throwsCode(() => fixture.provenance.confirmProvenanceClaim(firstClaimId, { confirm: true, expectedVersion: 2, idempotencyKey: "confirm-2" }), "PROVENANCE_CLAIM_ALREADY_CONFIRMED", "新确认请求不能重复批准同一主张");

    fixture.statusByAnchor.set(changedAnchor, { status: "source_missing", reason: "原件已移除" });
    const eventCountBeforeRead = tableCounts(fixture.db).events;
    const review = fixture.provenance.getProvenanceClaim(firstClaimId);
    equal(review.status, "needsReview", "已确认来源缺失时只读派生 needsReview");
    equal(review.lifecycleStatus, "confirmed", "needsReview 不抹除历史确认动作");
    equal(review.sources[0].reviewReason, "原件已移除", "来源 resolver 的固定复核原因进入只读投影");
    fixture.provenance.getProvenanceClaim(firstClaimId);
    equal(tableCounts(fixture.db).events, eventCountBeforeRead, "重复读取 needsReview 不产生隐藏数据库写入");
    equal(fixture.provenance.listConfirmedProvenanceForAgent(["memory-a"])["memory-a"].claims.length, 0, "needsReview 主张不会进入 Agent 只读投影");

    fixture.statusByAnchor.set(changedAnchor, "archived_verified");
    const agentProjection = fixture.provenance.listConfirmedProvenanceForAgent(["memory-a"])["memory-a"];
    equal(agentProjection.claims.length, 1, "当前确认主张进入 Agent 只读投影");
    ok(/^[a-f0-9]{64}$/u.test(agentProjection.provenanceSetSha256), "Agent 投影绑定完整 provenance 集合摘要");
    ok(!JSON.stringify(agentProjection).includes("confidence"), "Agent 投影不引入真假评分");

    fixture.clock.value = "2026-07-19T02:00:00.000Z";
    const withdrawn = fixture.provenance.withdrawProvenanceClaim(firstClaimId, { confirm: true, expectedVersion: 2, idempotencyKey: "withdraw-1" });
    equal(withdrawn.claim.status, "withdrawn", "撤回独立追加 withdrawn 状态而非物理删除");
    equal(withdrawn.claim.version, 3, "撤回形成第三个追加事件");
    equal(withdrawn.claim.events[2].previousEventSha256, withdrawn.claim.events[1].eventSha256, "withdrawn 继续账本哈希链");
    const withdrawReplay = fixture.provenance.withdrawProvenanceClaim(firstClaimId, { confirm: true, expectedVersion: 2, idempotencyKey: "withdraw-1" });
    ok(withdrawReplay.idempotent && withdrawReplay.claim.status === "withdrawn", "撤回精确重放返回当前只读历史");
    equal(fixture.provenance.listConfirmedProvenanceForAgent(["memory-a"])["memory-a"].claims.length, 0, "撤回主张不进入 Agent 投影");

    assert.throws(() => fixture.db.prepare("UPDATE provenance_claims SET statement = 'tamper' WHERE id = ?").run(firstClaimId), /PROVENANCE_CLAIM_IMMUTABLE/u);
    assertions += 1;
    assert.throws(() => fixture.db.prepare("UPDATE provenance_claim_sources SET sensitive = 1 WHERE claim_id = ?").run(firstClaimId), /PROVENANCE_SOURCE_IMMUTABLE/u);
    assertions += 1;
    assert.throws(() => fixture.db.prepare("UPDATE provenance_claim_events SET action = 'created' WHERE claim_id = ? AND sequence = 1").run(firstClaimId), /PROVENANCE_EVENT_IMMUTABLE/u);
    assertions += 1;
    assert.throws(() => fixture.db.prepare(`INSERT INTO provenance_claim_sources
      (id, claim_id, position, relation_kind, source_kind, source_key, anchor_key, origin_ref_json,
       locator_json, snapshot_json, snapshot_sha256, sensitive, created_at)
      SELECT 'late-source', id, 6, 'supports', 'voice_segment', ?, ?, '{}', '{}', '{}', ?, 0, created_at
      FROM provenance_claims WHERE id = ?`).run(`voice-source:${"a".repeat(64)}`, `voice-segment:${"b".repeat(64)}`, "c".repeat(64), firstClaimId), /PROVENANCE_SOURCE_SET_FROZEN/u);
    assertions += 1;

    const second = fixture.provenance.createProvenanceClaim(claimInput("memory-a", "第二条保持待核对。", [liveInput(memoryTextSource())]), { idempotencyKey: "claim-create-2" });
    throwsCode(() => fixture.provenance.withdrawProvenanceClaim(second.claim.id, { confirm: true, expectedVersion: 2, idempotencyKey: "withdraw-stale-version" }), "PROVENANCE_VERSION_CONFLICT", "旧 expectedVersion 不覆盖较新状态");
    equal(fixture.provenance.getProvenancePassport("memory-a").summary.claims, 2, "来源护照聚合展品全部主张");
    deepEqual(fixture.provenance.getProvenanceStats(), { claims: 2, sources: 6, events: 4, draft: 1, confirmed: 0, needsReview: 0, withdrawn: 1 }, "统计区分 draft/withdrawn 且不把撤回当确认");

    fixture.db.prepare("DELETE FROM memories WHERE id = ?").run("memory-a");
    deepEqual(tableCounts(fixture.db), { claims: 0, sources: 0, events: 0 }, "删除展品通过外键级联清理完整 provenance 聚合");
  } finally {
    fixture.close();
  }
}

function checkBackupAndRestore() {
  const source = createFixture("backup-source");
  let full;
  try {
    source.insertMemory("memory-source", "A😀B");
    const first = source.provenance.createProvenanceClaim(claimInput("memory-source", "这是一条已确认来源主张。", [liveInput(memoryTextSource("memory-source")), liveInput(documentSource("memory-source"))]), { idempotencyKey: "backup-create-1" });
    source.clock.value = "2026-07-19T03:00:00.000Z";
    source.provenance.confirmProvenanceClaim(first.claim.id, { confirm: true, expectedVersion: 1, idempotencyKey: "backup-confirm-1" });
    const review = source.provenance.createProvenanceClaim(claimInput("memory-source", "这条主张的图片来源后来变化。", [liveInput(imageSource("memory-source"))]), { idempotencyKey: "backup-create-2" });
    source.clock.value = "2026-07-19T04:00:00.000Z";
    source.provenance.confirmProvenanceClaim(review.claim.id, { confirm: true, expectedVersion: 1, idempotencyKey: "backup-confirm-2" });
    source.statusByAnchor.set(review.claim.sources[0].anchorKey, "source_changed");

    full = source.provenance.buildProvenanceBackup("full", ["memory-source"]);
    ok(source.provenance.validateProvenanceBackup(full, ["memory-source"]), "完整 provenance 归档可独立严格验真");
    equal(full.claims.length, 2, "完整归档保留两条主张根记录");
    equal(full.sources.length, 3, "完整归档保留统一来源快照");
    equal(full.events.length, 4, "完整归档保留追加事件链");
    ok(!JSON.stringify(full).includes("idempotencyKey") && !JSON.stringify(full).includes("requestSha256"), "归档不携带本机幂等命名空间");

    const redacted = source.provenance.buildProvenanceBackup("redacted", ["memory-source"]);
    deepEqual(Object.keys(redacted).sort(), ["claimCount", "confirmedCount", "draftCount", "mode", "needsReviewCount", "note", "sourceCount", "withdrawnCount"].sort(), "脱敏 provenance 只有固定安全计数字段");
    equal(redacted.confirmedCount, 1, "脱敏摘要单独计数当前确认主张");
    equal(redacted.needsReviewCount, 1, "脱敏摘要单独计数来源变化主张");
    equal(redacted.note, PROVENANCE_REDACTED_NOTE, "脱敏摘要使用固定隐私说明");
    const serializedRedacted = JSON.stringify(redacted);
    ok(!/statement|anchorKey|sourceKey|startOffset|coordinateSpace|eventSha256|memory-source/u.test(serializedRedacted), "脱敏摘要物理排除文字、定位、ID 与哈希字段");
    ok(validateProvenanceBackupPayload(redacted), "脱敏 provenance 摘要可独立验真");

    rejectBackupMutation(full, (copy) => { copy.extra = true; }, "根对象未知字段被拒绝");
    rejectBackupMutation(full, (copy) => { copy.schemaVersion = 17; }, "future provenance schema 被拒绝");
    rejectBackupMutation(full, (copy) => { copy.claims[0].claimSha256 = "0".repeat(64); }, "主张哈希篡改被拒绝");
    rejectBackupMutation(full, (copy) => { copy.sources[0].snapshot.excerpt += "篡改"; }, "来源快照篡改被拒绝");
    rejectBackupMutation(full, (copy) => { copy.sources[0].anchorKey = `memory-text-anchor:${"1".repeat(64)}`; }, "来源 anchor 篡改被拒绝");
    rejectBackupMutation(full, (copy) => { copy.events[1].previousEventSha256 = "2".repeat(64); }, "事件父哈希篡改被拒绝");
    rejectBackupMutation(full, (copy) => { copy.sources[0].claimId = "missing-claim"; }, "孤儿来源引用被拒绝");
    rejectBackupMutation(full, (copy) => { copy.events[1].action = "withdrawn"; }, "非法事件生命周期被拒绝");
    rejectBackupMutation(full, (copy) => { copy.sources.push({ ...copy.sources[0], id: copy.sources[0].id }); }, "重复来源 ID 被拒绝");
  } finally {
    source.close();
  }

  const target = createFixture("backup-target");
  try {
    target.insertMemory("memory-target", "A😀B");
    const restored = target.provenance.restoreProvenanceBackup(full, { memoryIdMap: { "memory-source": "memory-target" } });
    equal(restored.claims, 2, "恢复完整写入全部 provenance claims");
    equal(restored.sources, 3, "恢复完整写入全部来源快照");
    equal(restored.events, 4, "恢复完整写入全部事件链");
    equal(Object.keys(restored.idMap.claims).length, 2, "恢复返回 claim ID 映射");
    const passport = target.provenance.getProvenancePassport("memory-target");
    equal(passport.claims.length, 2, "恢复后目标展品可读取来源护照");
    deepEqual(passport.claims.map((claim) => claim.claimSha256).sort(), full.claims.map((claim) => claim.claimSha256).sort(), "ID 映射不改变稳定 claim digest");
    ok(target.provenance.validateProvenanceState(), "恢复后数据库可重新构建完整归档并验真");
    const restoredFull = target.provenance.buildProvenanceBackup("full", ["memory-target"]);
    deepEqual(restoredFull.claims.map((claim) => claim.claimSha256).sort(), full.claims.map((claim) => claim.claimSha256).sort(), "完整归档恢复往返保留内容身份");
    ok(JSON.stringify(restoredFull).includes("memory-target") && !JSON.stringify(restoredFull).includes("memory-source\""), "恢复重写目标 memoryId 与通用 originRef.memoryId");
  } finally {
    target.close();
  }

  const rollback = createFixture("backup-rollback");
  try {
    rollback.insertMemory("memory-target", "A😀B");
    throwsCode(() => rollback.provenance.restoreProvenanceBackup(full, {
      memoryIdMap: { "memory-source": "memory-target" },
      sourceMapper() { throw Object.assign(new Error("mapping failed"), { code: "SOURCE_MAP_FAILED" }); }
    }), "SOURCE_MAP_FAILED", "来源映射失败向调用方保留稳定错误");
    deepEqual(tableCounts(rollback.db), { claims: 0, sources: 0, events: 0 }, "恢复规划失败时业务表保持零写入");
    const summaryOnly = rollback.provenance.restoreProvenanceBackup({
      mode: "redacted-summary",
      claimCount: 2,
      draftCount: 0,
      confirmedCount: 1,
      needsReviewCount: 1,
      withdrawnCount: 0,
      sourceCount: 3,
      note: PROVENANCE_REDACTED_NOTE
    }, { memoryIdMap: {} });
    ok(summaryOnly.summarized && summaryOnly.claims === 0, "脱敏摘要只验真计数而不恢复私人内容");
  } finally {
    rollback.close();
  }
}

function checkMigrationFailureAndFutureGuard() {
  const failed = createFixture("migration-failure", { initialize: false });
  try {
    failed.db.exec("CREATE TABLE provenance_claims (id TEXT PRIMARY KEY)");
    throwsCode(() => initializeProvenanceDatabase({
      db: failed.db,
      schemaVersion: 16,
      now: () => failed.clock.value,
      createId: failed.createId,
      sourceResolver: failed.resolve
    }), "MIGRATION_APPLY_FAILED", "schema16 DDL 失败整体回滚");
    equal(readUserVersion(failed.db), 15, "失败迁移保持 schema15 user_version");
    ok(!listAppliedMigrations(failed.db).some((entry) => entry.version === 16), "失败迁移不留下 schema16 账本墓碑");
  } finally {
    failed.close();
  }

  const future = createFixture("future", { initialize: false });
  try {
    applyMigrations({ db: future.db, baselineVersion: 4, migrations: [
      ...PREVIOUS_MIGRATIONS,
      PROVENANCE_MIGRATION,
      { version: 17, name: "future-provenance", up() {} }
    ], supportedVersion: 17, now: () => future.clock.value });
    throwsCode(() => initializeProvenanceDatabase({
      db: future.db,
      schemaVersion: 16,
      now: () => future.clock.value,
      createId: future.createId,
      sourceResolver: future.resolve
    }), "MIGRATION_DATABASE_TOO_NEW", "schema16 实现拒绝猜测性打开未来数据库");
  } finally {
    future.close();
  }
}

function createFixture(name, options = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE memories (
      id TEXT PRIMARY KEY,
      raw_content TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  const clock = { value: "2026-07-19T00:00:00.000Z" };
  let counter = 0;
  const createId = (prefix) => `${prefix}-${name}-${++counter}`;
  const statusByAnchor = new Map();
  const resolve = (source) => statusByAnchor.get(source.anchorKey) || "source_verified";
  applyMigrations({ db, baselineVersion: 4, migrations: PREVIOUS_MIGRATIONS, supportedVersion: 15, now: () => clock.value });
  const provenance = options.initialize === false ? null : initializeProvenanceDatabase({
    db,
    schemaVersion: 16,
    now: () => clock.value,
    createId,
    sourceResolver: resolve
  });
  return {
    db,
    clock,
    createId,
    statusByAnchor,
    resolve,
    provenance,
    insertMemory(id, rawContent = "") {
      db.prepare("INSERT INTO memories VALUES (?, ?, ?, ?)").run(id, rawContent, clock.value, clock.value);
    },
    close() { db.close(); }
  };
}

function claimInput(memoryId, statement, sources) {
  return { memoryId, statement, sources };
}

function allSourceInputs() {
  return [memoryTextSource(), documentSource(), imageSource(), voiceSource(), oralSource()].map(liveInput);
}

function memoryTextSource(memoryId = "memory-a") {
  const sourceText = "A😀B";
  return normalizeVerifiedSourceSnapshot({
    relationKind: "supports",
    sourceKind: "memory_text",
    sourceKey: `memory-text-source:${sha256(sourceText)}`,
    originRef: { memoryId, revisionId: "" },
    locator: { offsetUnit: OFFSET_UNIT, startOffset: 1, endOffset: 3 },
    sourceSha256: sha256(sourceText),
    excerpt: "😀",
    metadata: { snapshotKind: "current" },
    sensitive: false
  });
}

function documentSource(memoryId = "memory-a") {
  return normalizeVerifiedSourceSnapshot({
    relationKind: "supplements",
    sourceKind: "document_excerpt",
    sourceKey: `text-source:${sha256("raw document bytes")}`,
    originRef: { memoryId, anchorKey: "accepted-inbox-anchor" },
    locator: { offsetUnit: OFFSET_UNIT, startOffset: 0, endOffset: 2 },
    sourceSha256: sha256("decoded document text"),
    excerpt: "文档",
    metadata: { retentionMode: "anchors-only" },
    sensitive: false
  });
}

function imageSource(memoryId = "memory-a") {
  const digest = sha256("image bytes");
  return normalizeVerifiedSourceSnapshot({
    relationKind: "supports",
    sourceKind: "image_region",
    sourceKey: `image-source:${digest}`,
    originRef: { memoryId, assetId: "asset-one" },
    locator: { coordinateSpace: COORDINATE_SPACE, x: 0.1234567, y: 0.2, width: 0.3, height: 0.4 },
    sourceSha256: digest,
    excerpt: "照片里的旧车票",
    metadata: { regionType: "object" },
    sensitive: false
  });
}

function voiceSource(memoryId = "memory-a") {
  const digest = sha256("voice bytes");
  return normalizeVerifiedSourceSnapshot({
    relationKind: "supplements",
    sourceKind: "voice_segment",
    sourceKey: `voice-source:${digest}`,
    originRef: { memoryId, assetId: "voice-one" },
    locator: { startMs: 1200, endMs: 6400 },
    sourceSha256: digest,
    excerpt: "",
    metadata: { label: "环境声音" },
    sensitive: false
  });
}

function oralSource(memoryId = "memory-a") {
  const digest = sha256("oral answer composite");
  return normalizeVerifiedSourceSnapshot({
    relationKind: "different_record",
    sourceKind: "oral_history_excerpt",
    sourceKey: `oral-history-source:${digest}`,
    originRef: { memoryId, answerId: "answer-one", eventId: "event-one" },
    locator: { startMs: 2000, endMs: 9000 },
    sourceSha256: digest,
    excerpt: "我记得那是在夏天",
    metadata: { questionKey: `oral-question:${sha256("question")}` },
    sensitive: false
  });
}

function liveInput(source) {
  return {
    relationKind: source.relationKind,
    sourceKind: source.sourceKind,
    sourceKey: source.sourceKey,
    anchorKey: source.anchorKey,
    originRef: JSON.parse(JSON.stringify(source.originRef)),
    locator: JSON.parse(JSON.stringify(source.locator)),
    sourceSha256: source.snapshot.sourceSha256,
    excerpt: source.snapshot.excerpt,
    metadata: JSON.parse(JSON.stringify(source.snapshot.metadata)),
    sensitive: source.sensitive
  };
}

function tableCounts(db) {
  const count = (table) => Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count);
  return {
    claims: count("provenance_claims"),
    sources: count("provenance_claim_sources"),
    events: count("provenance_claim_events")
  };
}

function rejectBackupMutation(backup, mutate, label) {
  const copy = JSON.parse(JSON.stringify(backup));
  mutate(copy);
  assert.throws(() => validateProvenanceBackupPayload(copy), (error) => String(error?.code || "").startsWith("PROVENANCE_"), label);
  assertions += 1;
}

function throwsCode(operation, code, label) {
  assert.throws(operation, (error) => error?.code === code, label);
  assertions += 1;
}

function ok(value, label) {
  assert.ok(value, label);
  assertions += 1;
}

function equal(actual, expected, label) {
  assert.equal(actual, expected, label);
  assertions += 1;
}

function deepEqual(actual, expected, label) {
  assert.deepEqual(actual, expected, label);
  assertions += 1;
}
