"use strict";

const assert = require("node:assert/strict");
const {
  REVISION_BACKUP_LIMITS,
  REVISION_REDACTED_NOTE,
  buildRevisionBackup,
  createMemorySnapshot,
  memorySnapshotSha256,
  remapRevisionBackup,
  serializeMemorySnapshot,
  validateMemorySnapshot,
  validateRevisionBackup
} = require("../lib/revision-backup");

let assertions = 0;

checkDeterministicSnapshot();
checkFullAndPartialBackup();
checkRedactedBoundary();
checkStrictValidation();
checkUtf8ByteBudget();
checkIdRemap();

console.log(`Revision backup checks passed: ${assertions} assertions.`);

function checkDeterministicSnapshot() {
  const first = memory("memory-one", {
    people: ["乙", "甲", "乙"],
    tags: ["证据", "修订"],
    emotions: ["温暖", "平静"],
    updatedAt: "2026-01-02T00:00:00.000Z",
    agentRunId: "run-secret"
  });
  const second = memory("memory-one", {
    people: ["甲", "乙"],
    tags: ["修订", "证据"],
    emotions: ["平静", "温暖"],
    updatedAt: "2030-01-02T00:00:00.000Z",
    agentRunId: "run-other"
  });
  const snapshot = createMemorySnapshot(first);
  deepEqual(Object.keys(snapshot), [
    "attachments", "coverImage", "date", "emotionIntensity", "emotions", "exhibitText",
    "favorite", "hall", "importance", "location", "mediaNote", "people", "rawContent",
    "sourceType", "tags", "title"
  ], "规范快照键顺序固定");
  deepEqual(snapshot.people, ["乙", "甲"].sort(compareText), "集合字段去重并使用代码点稳定排序");
  ok(!Object.hasOwn(snapshot, "id") && !Object.hasOwn(snapshot, "updatedAt") && !Object.hasOwn(snapshot, "agentRunId"),
    "快照物理排除身份、时间和 Agent run");
  equal(serializeMemorySnapshot(first), serializeMemorySnapshot(second), "输入集合顺序、更新时间与 Agent 不影响规范字节");
  equal(memorySnapshotSha256(first), memorySnapshotSha256(second), "相同语义状态产生相同 SHA-256");
  notEqual(memorySnapshotSha256(first), memorySnapshotSha256({ ...first, rawContent: "正文发生变化" }), "正文变化产生不同 SHA-256");
  deepEqual(validateMemorySnapshot(snapshot), snapshot, "规范快照可通过独立验真");
}

function checkFullAndPartialBackup() {
  const chainOne = revisionChain("memory-one", "one");
  const chainTwo = revisionChain("memory-two", "two").slice(0, 2);
  const backup = buildRevisionBackup({ revisions: [...chainTwo].reverse().concat([...chainOne].reverse()) }, "full", ["memory-one", "memory-two"]);
  deepEqual(Object.keys(backup).sort(), ["mode", "revisions", "schemaVersion"], "完整备份根字段精确固定");
  equal(backup.schemaVersion, 10, "完整备份声明 schema 10");
  deepEqual(backup.revisions.map((item) => `${item.memoryId}:${item.revisionNo}`), [
    "memory-one:1", "memory-one:2", "memory-one:3", "memory-two:1", "memory-two:2"
  ], "完整备份按 memoryId 与 revisionNo 确定性排序");
  deepEqual(Object.keys(backup.revisions[0]).sort(), [
    "changeKind", "changeNote", "createdAt", "id", "memoryId", "parentSha256",
    "restoredFromRevisionId", "revisionNo", "snapshot", "snapshotSha256", "sourceUpdatedAt"
  ], "每条完整修订使用精确键集");
  ok(validateRevisionBackup(backup, ["memory-one", "memory-two"]), "多展品完整链通过验真");

  const partial = buildRevisionBackup({ revisions: [...chainOne, ...chainTwo] }, "full", ["memory-two"]);
  equal(partial.revisions.length, 2, "部分备份只保留边界内整条修订链");
  ok(partial.revisions.every((item) => item.memoryId === "memory-two"), "部分备份不泄漏其他展品 ID");

  const row = chainOne[0];
  const databaseRow = {
    id: row.id,
    memory_id: row.memoryId,
    revision_no: row.revisionNo,
    parent_sha256: row.parentSha256,
    snapshot_json: JSON.stringify(row.snapshot),
    snapshot_sha256: row.snapshotSha256,
    change_kind: row.changeKind,
    change_note: row.changeNote,
    restored_from_revision_id: row.restoredFromRevisionId,
    source_updated_at: row.sourceUpdatedAt,
    created_at: row.createdAt
  };
  const fromDatabase = buildRevisionBackup({ revisions: [databaseRow] }, "full", [row.memoryId]);
  deepEqual(fromDatabase.revisions[0], row, "构建器接受数据库 snake_case 行并输出公开精确契约");
  throwsCode(
    () => validateRevisionBackup({ mode: "full", schemaVersion: 10, revisions: [databaseRow] }, [row.memoryId]),
    "REVISION_BACKUP_INVALID",
    "公开备份验真只接受 canonical 修订，不接受数据库内部行"
  );
  throwsCode(
    () => buildRevisionBackup({ revisions: [{ ...databaseRow, evil_field: "x" }] }, "full", [row.memoryId]),
    "REVISION_BACKUP_INVALID",
    "数据库 snake_case 行同样拒绝任何额外字段"
  );
}

function checkRedactedBoundary() {
  const secret = "绝不能进入脱敏摘要的旧正文";
  const revisions = revisionChain("memory-private", "private").map((item, index) => ({
    ...item,
    changeNote: index ? "这里也有私人编辑备注" : "",
    snapshot: { ...item.snapshot, rawContent: secret },
    snapshotSha256: memorySnapshotSha256({ ...item.snapshot, rawContent: secret })
  }));
  const redacted = buildRevisionBackup({ revisions }, "redacted", ["memory-private"]);
  deepEqual(redacted, {
    memoryCount: 1,
    mode: "redacted-summary",
    note: REVISION_REDACTED_NOTE,
    revisionCount: 3
  }, "脱敏备份只保留固定计数摘要");
  const serialized = JSON.stringify(redacted);
  for (const forbidden of [secret, "memory-private", "private-r1", "私人编辑备注", revisions[0].snapshotSha256]) {
    ok(!serialized.includes(forbidden), `脱敏摘要物理排除 ${forbidden.slice(0, 12)}`);
  }
  ok(validateRevisionBackup(redacted, []), "脱敏摘要可独立验真且不需要 memory ID 边界");
  throwsCode(
    () => validateRevisionBackup({ ...redacted, memoryIds: ["memory-private"] }, []),
    "REVISION_BACKUP_INVALID",
    "脱敏摘要拒绝夹带额外 ID 字段"
  );
  throwsCode(
    () => validateRevisionBackup({ ...redacted, note: "自定义说明" }, []),
    "REVISION_BACKUP_INVALID",
    "脱敏摘要固定说明不能被替换"
  );
}

function checkStrictValidation() {
  const backup = buildRevisionBackup({ revisions: revisionChain("memory-strict", "strict") }, "full", ["memory-strict"]);

  rejectMutation(backup, (copy) => { copy.schemaVersion = 11; }, "REVISION_BACKUP_INVALID", "未来 schema 被拒绝");
  rejectMutation(backup, (copy) => { delete copy.revisions[0].changeKind; }, "REVISION_BACKUP_INVALID", "缺失必需字段被拒绝");
  rejectMutation(backup, (copy) => { copy.revisions[0].extra = "x"; }, "REVISION_BACKUP_INVALID", "额外字段被拒绝");
  rejectMutation(backup, (copy) => { copy.revisions[0].evil_field = "x"; }, "REVISION_BACKUP_INVALID", "带下划线的额外字段不能绕过精确键校验");
  rejectMutation(backup, (copy) => { copy.revisions[0].memory_id = copy.revisions[0].memoryId; }, "REVISION_BACKUP_INVALID", "canonical 修订不能夹带 snake_case 别名");
  rejectMutation(backup, (copy) => { copy.revisions[1].snapshotSha256 = "0".repeat(64); }, "REVISION_BACKUP_HASH_MISMATCH", "快照哈希篡改被拒绝");
  rejectMutation(backup, (copy) => { copy.revisions[1].parentSha256 = "1".repeat(64); }, "REVISION_BACKUP_CHAIN_INVALID", "父哈希篡改被拒绝");
  rejectMutation(backup, (copy) => { copy.revisions[1].revisionNo = 4; }, "REVISION_BACKUP_CHAIN_INVALID", "修订序号断层被拒绝");
  rejectMutation(backup, (copy) => { copy.revisions[0].changeKind = "edited"; }, "REVISION_BACKUP_CHAIN_INVALID", "首条 edited 被拒绝");
  rejectMutation(backup, (copy) => { copy.revisions[2].restoredFromRevisionId = "missing"; }, "REVISION_BACKUP_REFERENCE_INVALID", "恢复引用不存在版本被拒绝");
  rejectMutation(backup, (copy) => { copy.revisions[1].restoredFromRevisionId = copy.revisions[0].id; }, "REVISION_BACKUP_REFERENCE_INVALID", "非 restored 不得夹带恢复来源");
  rejectMutation(backup, (copy) => {
    copy.revisions[1].snapshot.people = ["甲", "乙"];
    copy.revisions[1].snapshotSha256 = memorySnapshotSha256(copy.revisions[1].snapshot);
  }, "REVISION_SNAPSHOT_INVALID", "非规范集合顺序被拒绝");
  rejectMutation(backup, (copy) => {
    copy.revisions[0].snapshot.internalId = "leak";
  }, "REVISION_BACKUP_INVALID", "快照额外内部字段被拒绝");
  rejectMutation(backup, (copy) => { copy.revisions.push(clone(copy.revisions[0])); }, "REVISION_BACKUP_DUPLICATE", "重复 revision ID 被拒绝");
  throwsCode(
    () => validateRevisionBackup(backup, ["another-memory"]),
    "REVISION_BACKUP_REFERENCE_INVALID",
    "完整备份不能越过调用方 memory 边界"
  );
}

function checkUtf8ByteBudget() {
  const backup = createExactBudgetBackup("memory-budget");
  equal(Buffer.byteLength(JSON.stringify(backup), "utf8"), REVISION_BACKUP_LIMITS.bytes,
    "完整修订备份允许恰好等于 20 MiB 的 UTF-8 JSON");
  ok(validateRevisionBackup(backup, ["memory-budget"]), "字节预算闭区间上界可通过验真");

  const over = clone(backup);
  over.revisions[over.revisions.length - 1].changeNote = "x";
  equal(Buffer.byteLength(JSON.stringify(over), "utf8"), REVISION_BACKUP_LIMITS.bytes + 1,
    "边界样本可精确增加一个 UTF-8 字节");
  throwsCode(
    () => validateRevisionBackup(over, ["memory-budget"]),
    "REVISION_BACKUP_LIMIT_EXCEEDED",
    "超过统一 JSON 字节预算一个字节即拒绝"
  );
  equal(Buffer.byteLength(JSON.stringify({ value: "记" }), "utf8"), 15,
    "容量计量使用 UTF-8 字节而非 JavaScript 字符数");
  throwsCode(
    () => validateRevisionBackup({
      mode: "full",
      schemaVersion: 10,
      revisions: new Array(REVISION_BACKUP_LIMITS.revisions + 1).fill(backup.revisions[0])
    }, ["memory-budget"]),
    "REVISION_BACKUP_LIMIT_EXCEEDED",
    "统一字节预算之外仍保留一万条修订硬上限"
  );
}

function checkIdRemap() {
  const backup = buildRevisionBackup({ revisions: revisionChain("memory-source", "source") }, "full", ["memory-source"]);
  let sequence = 0;
  const remapped = remapRevisionBackup(backup, {
    memoryIdMap: { "memory-source": "memory-target" },
    occupiedRevisionIds: ["source-r1"],
    createId: () => `generated-revision-${++sequence}`
  });
  equal(remapped.backup.revisions.length, 3, "ID remap 保留完整链长度");
  ok(remapped.backup.revisions.every((item) => item.memoryId === "memory-target"), "所有展品引用使用同一映射");
  notEqual(remapped.idMap.revisions["source-r1"], "source-r1", "已占用 revision ID 生成安全新 ID");
  equal(
    remapped.backup.revisions[2].restoredFromRevisionId,
    remapped.idMap.revisions["source-r1"],
    "restoredFromRevisionId 与 revision ID 同步映射"
  );
  deepEqual(
    remapped.backup.revisions.map((item) => item.snapshotSha256),
    backup.revisions.map((item) => item.snapshotSha256),
    "ID 重映射不改变内容哈希和父链"
  );
  ok(validateRevisionBackup(remapped.backup, ["memory-target"]), "重映射结果再次通过完整链验真");

  throwsCode(
    () => remapRevisionBackup(backup, { memoryIdMap: {} }),
    "REVISION_BACKUP_MAPPING_MISSING",
    "缺少 memory ID 映射时拒绝恢复"
  );
  throwsCode(
    () => remapRevisionBackup(backup, {
      memoryIdMap: { "memory-source": "memory-target" },
      occupiedRevisionIds: ["source-r1"]
    }),
    "REVISION_BACKUP_ID_COLLISION",
    "revision ID 冲突且无生成器时失败关闭"
  );

  const twoMemories = buildRevisionBackup({
    revisions: [revisionChain("memory-a", "a")[0], revisionChain("memory-b", "b")[0]]
  }, "full", ["memory-a", "memory-b"]);
  throwsCode(
    () => remapRevisionBackup(twoMemories, {
      memoryIdMap: { "memory-a": "same-target", "memory-b": "same-target" }
    }),
    "REVISION_BACKUP_MAPPING_COLLISION",
    "两个源展品不能把历史合并到同一目标"
  );

  const redacted = buildRevisionBackup({ revisions: backup.revisions }, "redacted", ["memory-source"]);
  const redactedRemap = remapRevisionBackup(redacted, {});
  deepEqual(redactedRemap.backup, redacted, "脱敏摘要 remap 只返回安全副本");
  deepEqual(redactedRemap.idMap, { memories: {}, revisions: {} }, "脱敏摘要不产生内部 ID 映射");
}

function revisionChain(memoryId, prefix) {
  const firstSnapshot = createMemorySnapshot(memory(memoryId, { title: `${prefix} 初版`, rawContent: `${prefix} 第一版正文。` }));
  const secondSnapshot = createMemorySnapshot(memory(memoryId, {
    title: `${prefix} 第二版`,
    rawContent: `${prefix} 第二版正文。`,
    people: ["甲", "乙"]
  }));
  return [
    revision(`${prefix}-r1`, memoryId, 1, "", firstSnapshot, "created", "", "2026-01-01T00:00:00.000Z"),
    revision(`${prefix}-r2`, memoryId, 2, memorySnapshotSha256(firstSnapshot), secondSnapshot, "edited", "", "2026-01-02T00:00:00.000Z"),
    revision(`${prefix}-r3`, memoryId, 3, memorySnapshotSha256(secondSnapshot), firstSnapshot, "restored", `${prefix}-r1`, "2026-01-03T00:00:00.000Z")
  ];
}

function revision(id, memoryId, revisionNo, parentSha256, snapshot, changeKind, restoredFromRevisionId, createdAt) {
  return {
    changeKind,
    changeNote: changeKind === "edited" ? "人工核对后修改" : "",
    createdAt,
    id,
    memoryId,
    parentSha256,
    restoredFromRevisionId,
    revisionNo,
    snapshot,
    snapshotSha256: memorySnapshotSha256(snapshot),
    sourceUpdatedAt: createdAt
  };
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
    attachments: [{ name: "纸条", type: "物品", note: "手写" }],
    agentRunId: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
    id
  };
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
  const padding = remaining - tailContribution;
  tail.snapshot.rawContent = "y".repeat(padding);
  tail.snapshotSha256 = memorySnapshotSha256(tail.snapshot);
  revisions.push(tail);

  const backup = { mode: "full", schemaVersion: 10, revisions };
  equal(Buffer.byteLength(JSON.stringify(backup), "utf8"), REVISION_BACKUP_LIMITS.bytes,
    "测试夹具精确填满统一容量预算");
  return backup;
}

function budgetRevision(memoryId, revisionNo, parentSha256, snapshot) {
  return {
    changeKind: revisionNo === 1 ? "created" : "edited",
    changeNote: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    id: `budget-r${revisionNo}`,
    memoryId,
    parentSha256,
    restoredFromRevisionId: "",
    revisionNo,
    snapshot: clone(snapshot),
    snapshotSha256: memorySnapshotSha256(snapshot),
    sourceUpdatedAt: "2026-01-01T00:00:00.000Z"
  };
}

function rejectMutation(backup, mutate, code, message) {
  const copy = clone(backup);
  mutate(copy);
  throwsCode(() => validateRevisionBackup(copy, ["memory-strict"]), code, message);
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
