"use strict";

const assert = require("node:assert/strict");
const {
  CURATOR_AGENT_ACTIONS,
  CURATOR_AGENT_ARCHIVE_PREFIX,
  CURATOR_AGENT_LIMITS,
  CURATOR_AGENT_REDACTED_NOTE,
  CURATOR_AGENT_SCHEMA_VERSION,
  CURATOR_AGENT_SECTION_NAME,
  CURATOR_AGENT_SECTION_PATH,
  CURATOR_AGENT_SECTION_VERSION,
  FIXED_BUDGETS,
  READ_ONLY_TOOL_NAMES,
  assertRedactedCuratorAgentPrivacy,
  buildCuratorDecisionRequestSha256,
  buildCuratorProposalSha256,
  buildCuratorRequestSha256,
  buildCuratorSourceSetSha256,
  buildHistoricalCuratorDecisionSha256,
  buildHistoricalCuratorRequestSha256,
  remapCuratorAgentState,
  sha256,
  stableStringify,
  validateCuratorAgentArchiveEnvelope,
  validateCuratorAgentArchiveState
} = require("../lib/curator-agent-backup");
const {
  DEFAULT_BUDGETS,
  executeCuratorAgent
} = require("../lib/curator-agent-service");

let assertions = 0;
const ok = (value, message) => { assertions += 1; assert.ok(value, message); };
const equal = (actual, expected, message) => { assertions += 1; assert.equal(actual, expected, message); };
const deepEqual = (actual, expected, message) => { assertions += 1; assert.deepEqual(actual, expected, message); };
const throwsCode = (operation, code, message) => {
  assertions += 1;
  assert.throws(operation, (error) => error?.code === code, message);
};

run();

function run() {
  checkConstantsAndHappyPath();
  checkExactKeysAndHashes();
  checkBudgetsAndDenialOfService();
  checkRedactedPrivacy();
  checkRemappingAndReadOnlyRestore();
  checkMissingMappingsAndTypedOutcomes();
  console.log(`Curator-agent backup checks passed: ${assertions} assertions.`);
}

function checkConstantsAndHappyPath() {
  equal(CURATOR_AGENT_SCHEMA_VERSION, 14, "策展归档固定为 schema 14");
  equal(CURATOR_AGENT_SECTION_VERSION, 1, "策展 section 固定为版本 1");
  equal(CURATOR_AGENT_SECTION_NAME, "curator-agent", "策展 section 名称稳定");
  equal(CURATOR_AGENT_SECTION_PATH, "curator-agent/state.json", "策展 section 路径稳定");
  equal(CURATOR_AGENT_ARCHIVE_PREFIX, "curator-agent/", "策展归档保留独立前缀");
  deepEqual(FIXED_BUDGETS, DEFAULT_BUDGETS, "归档预算与运行时冻结预算一致");
  deepEqual(READ_ONLY_TOOL_NAMES, [
    "search_memory_summaries",
    "read_memory_evidence",
    "read_confirmed_relationships",
    "read_exhibition_summaries"
  ], "归档只接受四个只读工具");
  deepEqual(CURATOR_AGENT_ACTIONS, [
    "save_exhibition",
    "confirm_relationship",
    "publish_exhibition"
  ], "归档只接受三项逐项人工决定且没有分享动作");

  const state = fullState();
  equal(validateCuratorAgentArchiveEnvelope(state, "full"), 1, "完整 envelope 返回运行数量");
  equal(validateCuratorAgentArchiveState(state, boundaries()), true, "完整状态通过结构、来源和目标联合验真");
  equal(state.runs[0].steps.length, 4, "真实运行只留下四项只读工具回执");
  equal(state.runs[0].proposal.actions.length, 3, "一份提案包含三项独立人工动作");
  ok(!JSON.stringify(state.runs[0].proposal.actions).includes("share"), "提案没有后端分享动作");
}

function checkExactKeysAndHashes() {
  const cases = [
    ["根字段", (state) => { state.extra = true; }, "CURATOR_AGENT_FIELD_SET_INVALID"],
    ["entry 字段", (state) => { state.runs[0].extra = true; }, "CURATOR_AGENT_FIELD_SET_INVALID"],
    ["run 字段", (state) => { state.runs[0].run.extra = true; }, "CURATOR_AGENT_FIELD_SET_INVALID"],
    ["step 字段", (state) => { state.runs[0].steps[0].extra = true; }, "CURATOR_AGENT_FIELD_SET_INVALID"],
    ["proposal 字段", (state) => { state.runs[0].proposal.extra = true; }, "CURATOR_AGENT_FIELD_SET_INVALID"],
    ["decision 字段", (state) => { state.runs[0].decisions[0].extra = true; }, "CURATOR_AGENT_FIELD_SET_INVALID"],
    ["来源字段", (state) => { state.runs[0].proposal.sourceRefs[0].extra = true; }, "CURATOR_AGENT_FIELD_SET_INVALID"],
    ["错误 schema", (state) => { state.schemaVersion = 13; }, "CURATOR_AGENT_ARCHIVE_INVALID"],
    ["请求哈希", (state) => { state.runs[0].run.requestSha256 = "0".repeat(64); }, "CURATOR_AGENT_HASH_MISMATCH"],
    ["步骤哈希", (state) => { state.runs[0].steps[0].resultSha256 = "0".repeat(64); }, "CURATOR_AGENT_HASH_MISMATCH"],
    ["来源集合哈希", (state) => { state.runs[0].proposal.sourceSetSha256 = "0".repeat(64); }, "CURATOR_AGENT_HASH_MISMATCH"],
    ["提案哈希", (state) => { state.runs[0].proposal.proposalSha256 = "0".repeat(64); }, "CURATOR_AGENT_HASH_MISMATCH"],
    ["决定哈希", (state) => { state.runs[0].decisions[0].requestSha256 = "0".repeat(64); }, "CURATOR_AGENT_HASH_MISMATCH"],
    ["非规范 SHA", (state) => { state.runs[0].steps[0].resultSha256 = "A".repeat(64); }, "CURATOR_AGENT_HASH_INVALID"],
    ["非规范时间", (state) => { state.runs[0].run.updatedAt = "2026-07-18 06:00:01Z"; }, "CURATOR_AGENT_TIMESTAMP_INVALID"],
    ["非白名单工具", (state) => { state.runs[0].steps[0].toolName = "delete_memory"; }, "CURATOR_AGENT_VALUE_INVALID"],
    ["后端分享决定", (state) => { state.runs[0].decisions[0].action = "share_exhibition"; }, "CURATOR_AGENT_VALUE_INVALID"]
  ];
  for (const [label, mutate, code] of cases) {
    const state = fullState();
    mutate(state);
    throwsCode(() => validateCuratorAgentArchiveState(state, boundaries()), code, `${label} 被严格拒绝`);
  }

  const wrongMode = fullState();
  throwsCode(() => validateCuratorAgentArchiveEnvelope(wrongMode, "redacted"), "CURATOR_AGENT_ARCHIVE_MODE_MISMATCH", "完整状态不能伪装成脱敏归档");

  const reordered = fullState();
  reordered.runs[0].proposal.sourceRefs.reverse();
  reordered.runs[0].proposal.sourceSetSha256 = buildCuratorSourceSetSha256(reordered.runs[0].proposal.sourceRefs);
  reordered.runs[0].proposal.proposalSha256 = buildCuratorProposalSha256(reordered.runs[0].proposal);
  throwsCode(() => validateCuratorAgentArchiveState(reordered, boundaries()), "CURATOR_AGENT_SOURCE_INVALID", "来源引用必须使用规范排序");

  const injectedInstruction = fullState();
  injectedInstruction.runs[0].steps[0].toolName = "write_file";
  throwsCode(() => validateCuratorAgentArchiveState(injectedInstruction, boundaries()), "CURATOR_AGENT_VALUE_INVALID", "工具结果中的提示不能扩张工具白名单");
}

function checkBudgetsAndDenialOfService() {
  const budget = fullState();
  budget.runs[0].run.budgets.maxSteps = FIXED_BUDGETS.maxSteps + 1;
  throwsCode(() => validateCuratorAgentArchiveState(budget, boundaries()), "CURATOR_AGENT_BUDGET_INVALID", "预算上限 +1 被拒绝");

  const usage = fullState();
  usage.runs[0].run.usage.steps = FIXED_BUDGETS.maxSteps + 1;
  throwsCode(() => validateCuratorAgentArchiveState(usage, boundaries()), "CURATOR_AGENT_VALUE_INVALID", "已用步骤不能超过配置预算");

  const resultBudget = fullState();
  resultBudget.runs[0].run.usage.resultBytes = FIXED_BUDGETS.maxResultBytes + 1;
  throwsCode(() => validateCuratorAgentArchiveState(resultBudget, boundaries()), "CURATOR_AGENT_VALUE_INVALID", "已用结果字节不能超过配置预算");

  const tooManyRuns = fullState();
  tooManyRuns.runs = Array.from({ length: CURATOR_AGENT_LIMITS.runs + 1 }, () => tooManyRuns.runs[0]);
  throwsCode(() => validateCuratorAgentArchiveEnvelope(tooManyRuns), "CURATOR_AGENT_ARCHIVE_LIMIT_EXCEEDED", "运行数量上限 +1 在解析记录前被拒绝");

  const tooManySteps = fullState();
  tooManySteps.runs[0].steps = Array.from({ length: CURATOR_AGENT_LIMITS.stepsPerRun + 1 }, (_, index) => ({
    ...tooManySteps.runs[0].steps[0], id: `step-over-${index}`, position: index
  }));
  throwsCode(() => validateCuratorAgentArchiveEnvelope(tooManySteps), "CURATOR_AGENT_ARCHIVE_LIMIT_EXCEEDED", "每运行步骤上限 +1 被拒绝");

  const tooManyDecisions = fullState();
  tooManyDecisions.runs[0].decisions = Array.from({ length: CURATOR_AGENT_LIMITS.decisionsPerRun + 1 }, (_, index) => ({
    ...tooManyDecisions.runs[0].decisions[0], idempotencyKey: `decision-over-${String(index).padStart(3, "0")}`
  }));
  throwsCode(() => validateCuratorAgentArchiveEnvelope(tooManyDecisions), "CURATOR_AGENT_ARCHIVE_LIMIT_EXCEEDED", "每运行决定上限 +1 被拒绝");

  const tooDeep = fullState();
  let nested = {};
  const root = nested;
  for (let index = 0; index <= CURATOR_AGENT_LIMITS.jsonDepth; index += 1) {
    nested.value = {};
    nested = nested.value;
  }
  tooDeep.evil = root;
  throwsCode(() => validateCuratorAgentArchiveEnvelope(tooDeep), "CURATOR_AGENT_ARCHIVE_LIMIT_EXCEEDED", "JSON 深度上限 +1 在字段验真前被拒绝");

  const tooMuchText = fullState();
  tooMuchText.evil = "x".repeat(CURATOR_AGENT_LIMITS.textChars + 1);
  throwsCode(() => validateCuratorAgentArchiveEnvelope(tooMuchText), "CURATOR_AGENT_ARCHIVE_LIMIT_EXCEEDED", "聚合文本上限 +1 被拒绝");

  const cyclic = fullState();
  cyclic.self = cyclic;
  throwsCode(() => validateCuratorAgentArchiveEnvelope(cyclic), "CURATOR_AGENT_ARCHIVE_INVALID", "循环 JSON 被拒绝且不会递归失控");

  const proto = fullState();
  proto.runs[0].run.request = Object.create({ inherited: true });
  Object.assign(proto.runs[0].run.request, fullState().runs[0].run.request);
  throwsCode(() => validateCuratorAgentArchiveEnvelope(proto), "CURATOR_AGENT_ARCHIVE_INVALID", "非普通对象原型被拒绝");
}

function checkRedactedPrivacy() {
  const redacted = redactedState();
  equal(validateCuratorAgentArchiveEnvelope(redacted, "redacted"), 1, "脱敏 envelope 只返回安全运行计数");
  equal(validateCuratorAgentArchiveState(redacted, { mode: "redacted" }), true, "脱敏摘要通过统一状态验真");
  equal(assertRedactedCuratorAgentPrivacy(redacted), true, "脱敏隐私扫描通过");
  deepEqual(Object.keys(redacted).sort(), [
    "approvedCount", "cancelledRunCount", "completedRunCount", "decisionCount",
    "mode", "note", "proposalCount", "rejectedCount", "runCount"
  ], "脱敏摘要 exact keys 不携带记录数组");
  ok(!/[a-f0-9]{64}|2026-|memory-|run-|"(?:toolName|preview|sourceRefs|decisions)"\s*:/iu.test(JSON.stringify(redacted)), "脱敏摘要物理排除 ID、哈希、时间、工具和提案正文");

  const extra = { ...redacted, runs: [] };
  throwsCode(() => validateCuratorAgentArchiveEnvelope(extra, "redacted"), "CURATOR_AGENT_FIELD_SET_INVALID", "脱敏摘要不能夹带完整运行");

  const wrongNote = { ...redacted, note: `${CURATOR_AGENT_REDACTED_NOTE} memory-private` };
  throwsCode(() => assertRedactedCuratorAgentPrivacy(wrongNote), "CURATOR_AGENT_REDACTED_PRIVACY_INVALID", "脱敏固定说明不能被正文污染");

  const inconsistent = { ...redacted, approvedCount: 0 };
  throwsCode(() => validateCuratorAgentArchiveEnvelope(inconsistent, "redacted"), "CURATOR_AGENT_REDACTED_PRIVACY_INVALID", "脱敏决定计数必须闭合");

  const remapped = remapCuratorAgentState(redacted);
  deepEqual(remapped.state, redacted, "脱敏摘要恢复保持纯计数且不制造记录");
  deepEqual(remapped.idMap, { runs: {}, steps: {}, proposals: {}, decisions: {} }, "脱敏摘要没有可恢复 ID");
}

function checkRemappingAndReadOnlyRestore() {
  const source = fullState();
  const before = JSON.stringify(source);
  const generated = [];
  let writes = 0;
  const restored = remapCuratorAgentState(source, {
    memoryIdMap: { "memory-a": "memory-z", "memory-b": "memory-y" },
    eventIdMap: {},
    exhibitionIdMap: { "exhibition-old": "exhibition-new" },
    createId(prefix) {
      const id = `${prefix}-${generated.length + 1}`;
      generated.push(id);
      return id;
    },
    save() { writes += 1; }
  });
  equal(writes, 0, "纯 remap helper 不接受也不调用任何写入副作用");
  equal(JSON.stringify(source), before, "恢复映射不修改来源归档");
  equal(restored.state.runs[0].run.historical, true, "恢复运行强制标记为历史");
  equal(restored.state.runs[0].run.needsReview, true, "恢复运行强制进入待复核");
  equal(restored.state.runs[0].run.allowDecisions, false, "恢复运行绝不继承执行授权");
  ok(restored.state.runs[0].run.idempotencyKey.startsWith("historical-"), "恢复运行使用隔离幂等键");
  ok(restored.state.runs[0].decisions[0].idempotencyKey.startsWith("historical-"), "恢复决定使用隔离幂等键");
  ok(restored.state.runs[0].run.requestSha256 !== source.runs[0].run.requestSha256, "恢复请求使用 domain-separated 历史哈希");
  equal(restored.state.runs[0].run.requestSha256, buildHistoricalCuratorRequestSha256(restored.state.runs[0].run.request), "恢复请求哈希可规范重放验真");
  equal(restored.state.runs[0].decisions[0].requestSha256, buildHistoricalCuratorDecisionSha256({
    action: "save_exhibition", decision: "approve", runId: restored.state.runs[0].run.id
  }), "恢复决定哈希与新运行 ID 绑定");
  deepEqual(restored.state.runs[0].proposal.sourceRefs.map((item) => item.memoryId), ["memory-y", "memory-z"], "来源引用逐项映射并重新规范排序");
  equal(restored.state.runs[0].proposal.sourceSetSha256, buildCuratorSourceSetSha256(restored.state.runs[0].proposal.sourceRefs), "来源集合哈希在映射后重算");
  equal(restored.state.runs[0].proposal.proposalSha256, buildCuratorProposalSha256(restored.state.runs[0].proposal), "提案哈希在全部引用映射后重算");
  equal(restored.state.runs[0].proposal.duplicateContext[0].id, "exhibition-new", "重复展览上下文使用展览映射");
  equal(restored.state.runs[0].decisions[0].outcome.exhibitionId, "exhibition-new", "人工决定结果使用 typed 展览映射");
  deepEqual(new Set(restored.state.runs[0].proposal.preview.memoryIds), new Set(["memory-y", "memory-z"]), "预览中的展品引用全部映射");
  equal(Object.keys(restored.idMap.runs).length, 1, "返回完整 run ID map");
  equal(Object.keys(restored.idMap.steps).length, 4, "返回完整 step ID map");
  equal(Object.keys(restored.idMap.proposals).length, 1, "返回完整 proposal ID map");
  equal(Object.keys(restored.idMap.decisions).length, 1, "无 decision.id 时以 run/action/idempotency 复合键返回映射");
  equal(validateCuratorAgentArchiveState(restored.state, {
    mode: "full",
    memoryIds: ["memory-y", "memory-z"],
    eventIds: [],
    exhibitionIds: ["exhibition-new"]
  }), true, "重映射后的历史状态通过目标边界与全部新哈希验真");

  const historicalEmptyTarget = clone(restored.state);
  historicalEmptyTarget.runs[0].decisions[0].outcome.exhibitionId = "";
  equal(validateCuratorAgentArchiveState(historicalEmptyTarget, {
    mode: "full", memoryIds: ["memory-y", "memory-z"], eventIds: [], exhibitionIds: ["exhibition-new"]
  }), true, "历史决定允许目标记录已经不存在，但仍不能获得执行授权");

  const withInternalStep = fullState();
  prependInternalStep(withInternalStep, "plan", { purpose: "inspect-event" }, { eventId: "event-old", note: "只读规划结果" });
  equal(validateCuratorAgentArchiveState(withInternalStep, {
    ...boundaries(), eventIds: ["event-old"]
  }), true, "plan/compose/validate 内部步骤可被归档但不计入工具调用预算");
  const mappedInternal = remapCuratorAgentState(withInternalStep, {
    memoryIdMap: { "memory-a": "memory-z", "memory-b": "memory-y" },
    eventIdMap: { "event-old": "event-new" },
    exhibitionIdMap: { "exhibition-old": "exhibition-new" },
    createId: sequenceId()
  });
  equal(mappedInternal.state.runs[0].steps[0].result.eventId, "event-new", "内部只读步骤只按 typed eventId 完整映射");

  const active = fullState();
  active.runs[0].run.status = "running";
  active.runs[0].run.completedAt = "";
  active.runs[0].run.allowDecisions = false;
  active.runs[0].proposal = null;
  active.runs[0].decisions = [];
  const activeResultBytes = active.runs[0].steps.reduce((sum, step) => sum + step.resultBytes, 0);
  active.runs[0].run.usage = { steps: 4, toolCalls: 4, resultBytes: activeResultBytes, durationMs: 0 };
  const interrupted = remapCuratorAgentState(active, {
    memoryIdMap: { "memory-a": "memory-z", "memory-b": "memory-y" },
    eventIdMap: {},
    exhibitionIdMap: { "exhibition-old": "exhibition-new" },
    createId: sequenceId()
  });
  equal(interrupted.state.runs[0].run.status, "interrupted", "恢复中的 active run 永不自动续跑并收敛为 interrupted");
  ok(Boolean(interrupted.state.runs[0].run.interruptedAt), "中断投影留下可审计终态时间");

  const empty = remapCuratorAgentState({ mode: "full", schemaVersion: 14, runs: [] }, {
    memoryIdMap: {}, eventIdMap: {}, exhibitionIdMap: {}, createId: sequenceId()
  });
  deepEqual(empty.state.runs, [], "空 curator state 可在空馆藏中安全恢复");
}

function checkMissingMappingsAndTypedOutcomes() {
  let idCalls = 0;
  throwsCode(() => remapCuratorAgentState(fullState(), {
    memoryIdMap: { "memory-a": "memory-z" },
    eventIdMap: {},
    exhibitionIdMap: { "exhibition-old": "exhibition-new" },
    createId() { idCalls += 1; return `should-not-run-${idCalls}`; }
  }), "CURATOR_AGENT_REFERENCE_INVALID", "缺失 memory 映射在生成任何恢复 ID 前失败");
  equal(idCalls, 0, "缺失 memory 映射保持零恢复动作");

  throwsCode(() => remapCuratorAgentState(fullState(), {
    memoryIdMap: { "memory-a": "memory-z", "memory-b": "memory-y" },
    eventIdMap: {},
    exhibitionIdMap: {},
    createId: sequenceId()
  }), "CURATOR_AGENT_REFERENCE_INVALID", "缺失 exhibition 映射拒绝重复上下文和批准结果");

  throwsCode(() => remapCuratorAgentState(fullState(), {
    memoryIdMap: { "memory-a": "memory-z", "memory-b": "memory-z" },
    eventIdMap: {},
    exhibitionIdMap: { "exhibition-old": "exhibition-new" },
    createId: sequenceId()
  }), "CURATOR_AGENT_REMAP_MAPPING_COLLISION", "多源不能折叠到同一展品目标");

  const relation = fullState();
  relation.runs[0].decisions = [decisionFor(relation, "confirm_relationship", "approve", {
    status: "approved",
    memoryAId: "memory-a",
    memoryBId: "memory-b",
    relationType: "related_context"
  }, "decision-relation-0001")];
  equal(validateCuratorAgentArchiveState(relation, boundaries()), true, "关系确认 outcome 使用 exact typed memory IDs");
  const restoredRelation = remapCuratorAgentState(relation, {
    memoryIdMap: { "memory-a": "memory-z", "memory-b": "memory-y" },
    eventIdMap: {},
    exhibitionIdMap: { "exhibition-old": "exhibition-new" },
    createId: sequenceId()
  });
  deepEqual(new Set([
    restoredRelation.state.runs[0].decisions[0].outcome.memoryAId,
    restoredRelation.state.runs[0].decisions[0].outcome.memoryBId
  ]), new Set(["memory-y", "memory-z"]), "关系确认 outcome 只按 typed memory 字段重映射");

  const rejected = fullState();
  rejected.runs[0].decisions = [decisionFor(rejected, "publish_exhibition", "reject", { status: "rejected" }, "decision-reject-0001")];
  equal(validateCuratorAgentArchiveState(rejected, boundaries()), true, "拒绝决定 exact outcome 不制造目标 ID");
  const leaked = clone(rejected);
  leaked.runs[0].decisions[0].outcome.exhibitionId = "exhibition-old";
  throwsCode(() => validateCuratorAgentArchiveState(leaked, boundaries()), "CURATOR_AGENT_FIELD_SET_INVALID", "拒绝 outcome 不能夹带展览目标");

  const duplicateAction = fullState();
  duplicateAction.runs[0].decisions.push(decisionFor(duplicateAction, "save_exhibition", "reject", {
    status: "rejected"
  }, "decision-save-duplicate"));
  throwsCode(() => validateCuratorAgentArchiveState(duplicateAction, boundaries()), "CURATOR_AGENT_DECISION_STATE_INVALID", "同一动作不能伪造两个最终决定");

  const publishWithoutSave = fullState();
  publishWithoutSave.runs[0].decisions = [decisionFor(publishWithoutSave, "publish_exhibition", "approve", {
    status: "approved",
    exhibitionId: "exhibition-old",
    exhibitionStatus: "published"
  }, "decision-publish-without-save")];
  throwsCode(() => validateCuratorAgentArchiveState(publishWithoutSave, boundaries()), "CURATOR_AGENT_DECISION_STATE_INVALID", "发布批准不能绕过独立保存批准");

  const mismatchedPublish = fullState();
  mismatchedPublish.runs[0].decisions.push(decisionFor(mismatchedPublish, "publish_exhibition", "approve", {
    status: "approved",
    exhibitionId: "exhibition-other",
    exhibitionStatus: "published"
  }, "decision-publish-other"));
  throwsCode(() => validateCuratorAgentArchiveState(mismatchedPublish, {
    ...boundaries(), exhibitionIds: ["exhibition-old", "exhibition-other"]
  }), "CURATOR_AGENT_DECISION_STATE_INVALID", "发布批准必须指向此前保存的同一草稿");

  const reversedPublish = fullState();
  const reversedSave = reversedPublish.runs[0].decisions[0];
  reversedPublish.runs[0].decisions = [
    decisionFor(reversedPublish, "publish_exhibition", "approve", {
      status: "approved", exhibitionId: "exhibition-old", exhibitionStatus: "published"
    }, "decision-publish-first"),
    reversedSave
  ];
  throwsCode(() => validateCuratorAgentArchiveState(reversedPublish, boundaries()), "CURATOR_AGENT_DECISION_STATE_INVALID", "发布批准不能排列在保存批准之前");

  const validPublished = fullState();
  validPublished.runs[0].decisions.push(decisionFor(validPublished, "publish_exhibition", "approve", {
    status: "approved",
    exhibitionId: "exhibition-old",
    exhibitionStatus: "published"
  }, "decision-publish-valid"));
  equal(validateCuratorAgentArchiveState(validPublished, boundaries()), true, "独立保存后发布同一草稿的审计链有效");

  const stale = fullState();
  stale.runs[0].proposal.sourceRefs[0].updatedAt = "2026-07-18T05:00:01.000Z";
  throwsCode(() => validateCuratorAgentArchiveState(stale, boundaries()), "CURATOR_AGENT_HASH_MISMATCH", "来源变化而未重算摘要时提案被视为篡改/陈旧");
}

function fullState() {
  const request = {
    intent: "draft_exhibition",
    query: "陪伴",
    memoryIds: ["memory-a", "memory-b"],
    title: "陪伴留下的两件事",
    theme: "陪伴"
  };
  const memories = [
    {
      id: "memory-a",
      title: "操场尽头",
      rawContent: "毕业那天，我和朋友在操场尽头聊了很久。",
      exhibitText: "操场留下了一次没有说完的告别。",
      updatedAt: "2026-07-18T05:00:00.000Z",
      date: "2021-06-18",
      location: "学校操场",
      people: ["朋友"],
      tags: ["陪伴", "毕业"],
      emotions: ["怀念"]
    },
    {
      id: "memory-b",
      title: "没有挂断的电话",
      rawContent: "低谷里，朋友没有劝我，只陪我把混乱的话说完。",
      exhibitText: "没有提前挂断的电话，是陪伴留下的证据。",
      updatedAt: "2026-07-18T05:00:00.000Z",
      date: "2022-09",
      location: "",
      people: ["朋友"],
      tags: ["陪伴", "朋友"],
      emotions: ["温暖"]
    }
  ];
  const executed = executeCuratorAgent({
    request,
    monotonicNow: () => 0,
    tools: {
      search_memory_summaries: () => memories.map((memory) => ({
        id: memory.id,
        title: memory.title,
        summary: memory.exhibitText,
        updatedAt: memory.updatedAt
      })),
      read_memory_evidence: () => memories,
      read_confirmed_relationships: () => [],
      read_exhibition_summaries: () => [{
        id: "exhibition-old",
        title: "旧展览",
        status: "draft",
        memoryIds: memories.map((memory) => memory.id)
      }]
    }
  });
  const requestSha256 = buildCuratorRequestSha256(request);
  const createdAt = "2026-07-18T06:00:00.000Z";
  const updatedAt = "2026-07-18T06:00:01.000Z";
  const run = {
    id: "curator-run-source",
    schemaVersion: 14,
    idempotencyKey: "curator-request-source",
    requestSha256,
    request,
    status: "completed",
    version: 1,
    budgets: { ...FIXED_BUDGETS },
    usage: { ...executed.usage },
    historical: false,
    needsReview: false,
    allowDecisions: true,
    createdAt,
    startedAt: createdAt,
    updatedAt,
    completedAt: updatedAt,
    cancelledAt: "",
    interruptedAt: "",
    failedAt: "",
    failureCode: "",
    failureMessage: ""
  };
  const steps = executed.steps.map((step, index) => ({
    id: `curator-step-source-${index + 1}`,
    runId: run.id,
    position: step.position,
    toolName: step.toolName,
    args: clone(step.args),
    result: clone(step.result),
    resultSha256: step.resultSha256,
    resultBytes: step.resultBytes,
    durationMs: step.durationMs,
    summary: step.summary,
    createdAt: "2026-07-18T06:00:00.500Z"
  }));
  const proposal = {
    id: "curator-proposal-source",
    runId: run.id,
    ...clone(executed.proposal),
    createdAt: "2026-07-18T06:00:00.800Z"
  };
  const state = {
    mode: "full",
    schemaVersion: 14,
    runs: [{ run, steps, proposal, decisions: [] }]
  };
  state.runs[0].decisions.push(decisionFor(state, "save_exhibition", "approve", {
    status: "approved",
    exhibitionId: "exhibition-old",
    exhibitionStatus: "draft"
  }, "decision-save-0001"));
  return state;
}

function decisionFor(state, action, decision, outcome, idempotencyKey) {
  const runId = state.runs[0].run.id;
  return {
    runId,
    action,
    decision,
    idempotencyKey,
    requestSha256: buildCuratorDecisionRequestSha256({ action, decision, runId }),
    outcome,
    createdAt: "2026-07-18T06:00:00.900Z"
  };
}

function redactedState() {
  return {
    mode: "redacted-summary",
    note: CURATOR_AGENT_REDACTED_NOTE,
    runCount: 1,
    completedRunCount: 1,
    cancelledRunCount: 0,
    proposalCount: 1,
    decisionCount: 1,
    approvedCount: 1,
    rejectedCount: 0
  };
}

function boundaries() {
  return {
    mode: "full",
    memoryIds: ["memory-a", "memory-b"],
    eventIds: [],
    exhibitionIds: ["exhibition-old"]
  };
}

function sequenceId() {
  let value = 0;
  return (prefix) => `${prefix}-mapped-${++value}`;
}

function prependInternalStep(state, toolName, args, result) {
  const run = state.runs[0].run;
  const resultJson = stableStringify(result);
  state.runs[0].steps.unshift({
    id: `curator-step-${toolName}-source`,
    runId: run.id,
    position: 0,
    toolName,
    args,
    result,
    resultSha256: sha256(resultJson),
    resultBytes: Buffer.byteLength(resultJson, "utf8"),
    durationMs: 0,
    summary: "只读内部步骤",
    createdAt: "2026-07-18T06:00:00.400Z"
  });
  state.runs[0].steps.forEach((step, index) => { step.position = index; });
  run.usage.steps = state.runs[0].steps.length;
  run.usage.resultBytes = state.runs[0].steps.reduce((sum, step) => sum + step.resultBytes, 0);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
