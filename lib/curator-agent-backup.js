"use strict";

const { createHash } = require("node:crypto");

const CURATOR_AGENT_SCHEMA_VERSION = 14;
const CURATOR_AGENT_SECTION_VERSION = 1;
const CURATOR_AGENT_SECTION_NAME = "curator-agent";
const CURATOR_AGENT_SECTION_PATH = "curator-agent/state.json";
const CURATOR_AGENT_ARCHIVE_PREFIX = "curator-agent/";
const CURATOR_AGENT_ENGINE_VERSION = "local-evidence-rules-v1";
const CURATOR_AGENT_REDACTED_NOTE = "策展运行请求、只读工具回执、提案预览、来源引用、人工决定、内部标识、哈希与精确时间已从脱敏备份中移除。";

const CURATOR_AGENT_LIMITS = Object.freeze({
  runs: 500,
  stepsPerRun: 16,
  decisionsPerRun: 16,
  proposalsPerRun: 1,
  totalItems: 17_000,
  jsonBytes: 20 * 1024 * 1024,
  jsonDepth: 12,
  jsonNodes: 200_000,
  textChars: 8 * 1024 * 1024,
  stringChars: 262_144
});

const FIXED_BUDGETS = Object.freeze({
  maxSteps: 6,
  maxToolCalls: 4,
  maxDurationMs: 2_000,
  maxResultBytes: 262_144,
  maxMemories: 6
});

const READ_ONLY_TOOL_NAMES = Object.freeze([
  "search_memory_summaries",
  "read_memory_evidence",
  "read_confirmed_relationships",
  "read_exhibition_summaries"
]);
const INTERNAL_STEP_NAMES = Object.freeze(["plan", "compose", "validate"]);
const CURATOR_AGENT_STEP_NAMES = Object.freeze([...READ_ONLY_TOOL_NAMES, ...INTERNAL_STEP_NAMES]);
const CURATOR_AGENT_ACTIONS = Object.freeze([
  "save_exhibition",
  "confirm_relationship",
  "publish_exhibition"
]);
const CURATOR_AGENT_RUN_STATUSES = Object.freeze([
  "created",
  "running",
  "completed",
  "cancelled",
  "failed",
  "interrupted"
]);

const READ_ONLY_TOOL_SET = new Set(READ_ONLY_TOOL_NAMES);
const STEP_NAME_SET = new Set(CURATOR_AGENT_STEP_NAMES);
const ACTION_SET = new Set(CURATOR_AGENT_ACTIONS);
const RUN_STATUS_SET = new Set(CURATOR_AGENT_RUN_STATUSES);
const DECISION_SET = new Set(["approve", "reject"]);
const ID_PATTERN = /^[A-Za-z0-9_-]{1,120}$/u;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9_-]{8,120}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const HISTORICAL_REQUEST_DOMAIN = "time-isle.curator-agent.historical-request.v1";
const HISTORICAL_DECISION_DOMAIN = "time-isle.curator-agent.historical-decision.v1";
const HISTORICAL_KEY_DOMAIN = "time-isle.curator-agent.historical-idempotency.v1";

const FULL_ROOT_KEYS = Object.freeze(["mode", "runs", "schemaVersion"]);
const REDACTED_ROOT_KEYS = Object.freeze([
  "approvedCount",
  "cancelledRunCount",
  "completedRunCount",
  "decisionCount",
  "mode",
  "note",
  "proposalCount",
  "rejectedCount",
  "runCount"
]);
const ENTRY_KEYS = Object.freeze(["decisions", "proposal", "run", "steps"]);
const RUN_KEYS = Object.freeze([
  "allowDecisions", "budgets", "cancelledAt", "completedAt", "createdAt",
  "failedAt", "failureCode", "failureMessage", "historical", "id",
  "idempotencyKey", "interruptedAt", "needsReview", "request",
  "requestSha256", "schemaVersion", "startedAt", "status", "updatedAt",
  "usage", "version"
]);
const BUDGET_KEYS = Object.freeze([
  "maxDurationMs", "maxMemories", "maxResultBytes", "maxSteps", "maxToolCalls"
]);
const USAGE_KEYS = Object.freeze(["durationMs", "resultBytes", "steps", "toolCalls"]);
const REQUEST_KEYS = Object.freeze(["intent", "memoryIds", "query", "theme", "title"]);
const STEP_KEYS = Object.freeze([
  "args", "createdAt", "durationMs", "id", "position", "result",
  "resultBytes", "resultSha256", "runId", "summary", "toolName"
]);
const PROPOSAL_KEYS = Object.freeze([
  "actions", "createdAt", "duplicateContext", "engineVersion", "id", "kind",
  "preview", "proposalSha256", "relation", "requestSha256", "runId",
  "schemaVersion", "sourceRefs", "sourceSetSha256"
]);
const SOURCE_REF_KEYS = Object.freeze(["memoryId", "rawSha256", "updatedAt"]);
const DECISION_KEYS = Object.freeze([
  "action", "createdAt", "decision", "idempotencyKey", "outcome",
  "requestSha256", "runId"
]);

function validateCuratorAgentArchiveEnvelope(payload, mode) {
  measureJson(payload);
  assertPlainObject(payload, "curator-agent state");
  if (payload.mode === "redacted-summary") {
    validateRedactedState(payload, mode);
    return payload.runCount;
  }
  assertExactKeys(payload, FULL_ROOT_KEYS, "curator-agent full state");
  if (payload.mode !== "full" || payload.schemaVersion !== CURATOR_AGENT_SCHEMA_VERSION) {
    fail("完整策展助手状态的模式或 Schema 版本无效。", "CURATOR_AGENT_ARCHIVE_INVALID");
  }
  if (mode !== undefined && mode !== "full") {
    fail("策展助手状态与归档隐私模式不一致。", "CURATOR_AGENT_ARCHIVE_MODE_MISMATCH");
  }
  const runs = requireArray(payload.runs, CURATOR_AGENT_LIMITS.runs, "runs");
  let totalItems = 0;
  const ids = { runs: new Set(), runKeys: new Set(), steps: new Set(), proposals: new Set(), decisionKeys: new Set() };
  runs.forEach((entry, index) => {
    totalItems += validateRunEntry(entry, index, ids, null);
    if (totalItems > CURATOR_AGENT_LIMITS.totalItems) {
      fail("策展助手归档总记录数超过安全上限。", "CURATOR_AGENT_ARCHIVE_LIMIT_EXCEEDED", 413);
    }
  });
  return runs.length;
}

function validateCuratorAgentArchiveState(payload, options = {}) {
  assertPlainObject(options, "curator-agent validation options");
  const mode = options.mode;
  const count = validateCuratorAgentArchiveEnvelope(payload, mode);
  if (payload.mode === "redacted-summary") {
    assertRedactedCuratorAgentPrivacy(payload);
    return options.returnNormalized ? cloneJson(payload) : true;
  }
  const boundaries = {
    memories: normalizeBoundary(options.memoryIds, "memoryIds"),
    events: normalizeBoundary(options.eventIds, "eventIds"),
    exhibitions: normalizeBoundary(options.exhibitionIds, "exhibitionIds")
  };
  const ids = { runs: new Set(), runKeys: new Set(), steps: new Set(), proposals: new Set(), decisionKeys: new Set() };
  let totalItems = 0;
  payload.runs.forEach((entry, index) => {
    totalItems += validateRunEntry(entry, index, ids, boundaries);
  });
  if (totalItems > CURATOR_AGENT_LIMITS.totalItems || count !== payload.runs.length) {
    fail("策展助手归档总记录数无效。", "CURATOR_AGENT_ARCHIVE_LIMIT_EXCEEDED", 413);
  }
  return options.returnNormalized ? cloneJson(payload) : true;
}

function assertRedactedCuratorAgentPrivacy(payload) {
  validateRedactedState(payload, "redacted");
  const serialized = JSON.stringify(payload);
  const forbiddenKey = /"(?:id|runId|memoryId|memoryIds|eventId|exhibitionId|idempotencyKey|request|requestSha256|sourceRefs|sourceSetSha256|rawSha256|proposalSha256|resultSha256|createdAt|startedAt|updatedAt|completedAt|cancelledAt|interruptedAt|failedAt|toolName|args|result|preview|relation|actions|duplicateContext|outcome|failureMessage)"\s*:/iu;
  const sensitiveValue = /[a-f0-9]{64}|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}|(?:search_memory_summaries|read_memory_evidence|read_confirmed_relationships|read_exhibition_summaries|save_exhibition|confirm_relationship|publish_exhibition)/iu;
  if (forbiddenKey.test(serialized) || sensitiveValue.test(serialized)) {
    fail("脱敏策展助手摘要泄露了标识、哈希、时间、工具、提案或决定内容。", "CURATOR_AGENT_REDACTED_PRIVACY_INVALID");
  }
  return true;
}

function remapCuratorAgentState(state, options = {}) {
  assertPlainObject(options, "curator-agent remap options");
  if (state?.mode === "redacted-summary") {
    validateCuratorAgentArchiveState(state, { mode: "redacted" });
    return {
      state: cloneJson(state),
      idMap: { runs: {}, steps: {}, proposals: {}, decisions: {} }
    };
  }
  const memoryIdMap = normalizeRequiredIdMap(options.memoryIdMap, "memoryIdMap", true);
  const eventIdMap = normalizeRequiredIdMap(options.eventIdMap, "eventIdMap", true);
  const exhibitionIdMap = normalizeRequiredIdMap(options.exhibitionIdMap, "exhibitionIdMap", true);
  const createId = options.createId;
  if (typeof createId !== "function") {
    fail("策展助手恢复需要 createId。", "CURATOR_AGENT_REMAP_DEPENDENCY_INVALID", 500);
  }
  validateCuratorAgentArchiveState(state, {
    mode: "full",
    memoryIds: [...memoryIdMap.keys()],
    eventIds: [...eventIdMap.keys()],
    exhibitionIds: [...exhibitionIdMap.keys()]
  });

  const occupied = new Set();
  const runIdMap = new Map();
  const stepIdMap = new Map();
  const proposalIdMap = new Map();
  const decisionIdMap = new Map();
  for (const entry of state.runs) {
    runIdMap.set(entry.run.id, claimCreatedId(createId, "curator-run", occupied));
    for (const step of entry.steps) {
      stepIdMap.set(step.id, claimCreatedId(createId, "curator-step", occupied));
    }
    if (entry.proposal) {
      proposalIdMap.set(entry.proposal.id, claimCreatedId(createId, "curator-proposal", occupied));
    }
    entry.decisions.forEach((decision, index) => {
      const sourceKey = curatorAgentDecisionMapKey(entry.run.id, index, decision);
      decisionIdMap.set(sourceKey, claimCreatedId(createId, "curator-decision", occupied));
    });
  }

  const remappedRuns = state.runs.map((entry) => remapRunEntry(entry, {
    memoryIdMap,
    eventIdMap,
    exhibitionIdMap,
    runIdMap,
    stepIdMap,
    proposalIdMap,
    decisionIdMap
  }));
  const remapped = { mode: "full", schemaVersion: CURATOR_AGENT_SCHEMA_VERSION, runs: remappedRuns };
  validateCuratorAgentArchiveState(remapped, {
    mode: "full",
    memoryIds: [...memoryIdMap.values()],
    eventIds: [...eventIdMap.values()],
    exhibitionIds: [...exhibitionIdMap.values()]
  });
  return {
    state: remapped,
    idMap: {
      runs: Object.fromEntries(runIdMap),
      steps: Object.fromEntries(stepIdMap),
      proposals: Object.fromEntries(proposalIdMap),
      decisions: Object.fromEntries(decisionIdMap)
    }
  };
}

function validateRunEntry(entry, index, ids, boundaries) {
  const label = `runs[${index}]`;
  assertPlainObject(entry, label);
  assertExactKeys(entry, ENTRY_KEYS, label);
  const run = validateRun(entry.run, `${label}.run`, ids, boundaries);
  const steps = requireArray(entry.steps, CURATOR_AGENT_LIMITS.stepsPerRun, `${label}.steps`);
  let resultBytes = 0;
  let toolCalls = 0;
  let stepDuration = 0;
  steps.forEach((step, stepIndex) => {
    const normalized = validateStep(step, `${label}.steps[${stepIndex}]`, run, stepIndex, ids, boundaries);
    resultBytes += normalized.resultBytes;
    stepDuration += normalized.durationMs;
    if (READ_ONLY_TOOL_SET.has(normalized.toolName)) toolCalls += 1;
  });
  if (run.usage.steps !== steps.length || run.usage.toolCalls !== toolCalls || run.usage.resultBytes !== resultBytes ||
      stepDuration > run.usage.durationMs) {
    fail(`${label} 的用量与步骤回执不一致。`, "CURATOR_AGENT_USAGE_INVALID");
  }
  const proposal = entry.proposal === null
    ? null
    : validateProposal(entry.proposal, `${label}.proposal`, run, steps, ids, boundaries);
  const decisions = requireArray(entry.decisions, CURATOR_AGENT_LIMITS.decisionsPerRun, `${label}.decisions`);
  const normalizedDecisions = decisions.map((decision, decisionIndex) => (
    validateDecision(decision, `${label}.decisions[${decisionIndex}]`, run, proposal, decisionIndex, ids, boundaries)
  ));
  const decisionByAction = new Map();
  normalizedDecisions.forEach((decision) => {
    if (decisionByAction.has(decision.action)) {
      fail("同一策展动作只能保留一项最终决定。", "CURATOR_AGENT_DECISION_STATE_INVALID");
    }
    decisionByAction.set(decision.action, decision);
  });
  const publishDecision = decisionByAction.get("publish_exhibition");
  if (publishDecision?.decision === "approve") {
    const saveDecision = decisionByAction.get("save_exhibition");
    const savedOutcome = saveDecision ? decisions[saveDecision.index]?.outcome : null;
    const publishedOutcome = decisions[publishDecision.index]?.outcome;
    if (saveDecision?.decision !== "approve" || saveDecision.index >= publishDecision.index ||
        (!run.historical && !savedOutcome?.exhibitionId) || savedOutcome?.exhibitionId !== publishedOutcome?.exhibitionId) {
      fail("发布批准必须位于同一展览的保存批准之后。", "CURATOR_AGENT_DECISION_STATE_INVALID");
    }
  }
  if (run.status === "completed" && !proposal) {
    fail("已完成的策展运行必须保留唯一提案。", "CURATOR_AGENT_PROPOSAL_REQUIRED");
  }
  if (run.status !== "completed" && proposal) {
    fail("未完成的策展运行不能携带提案。", "CURATOR_AGENT_PROPOSAL_STATE_INVALID");
  }
  if (!proposal && decisions.length) {
    fail("没有提案的运行不能携带人工决定。", "CURATOR_AGENT_DECISION_REFERENCE_INVALID");
  }
  return 1 + steps.length + (proposal ? 1 : 0) + decisions.length;
}

function validateRun(value, label, ids, boundaries) {
  assertPlainObject(value, label);
  assertExactKeys(value, RUN_KEYS, label);
  const id = requireUniqueId(value.id, `${label}.id`, ids.runs);
  if (value.schemaVersion !== CURATOR_AGENT_SCHEMA_VERSION) fail(`${label}.schemaVersion 无效。`, "CURATOR_AGENT_ARCHIVE_INVALID");
  const idempotencyKey = requireIdempotencyKey(value.idempotencyKey, `${label}.idempotencyKey`);
  if (ids.runKeys.has(idempotencyKey)) fail("运行幂等键不能重复。", "CURATOR_AGENT_DUPLICATE_ID");
  ids.runKeys.add(idempotencyKey);
  const request = validateRequest(value.request, `${label}.request`, boundaries);
  const historical = requireBoolean(value.historical, `${label}.historical`);
  const expectedRequestSha256 = historical
    ? buildHistoricalCuratorRequestSha256(request)
    : buildCuratorRequestSha256(request);
  if (requireSha256(value.requestSha256, `${label}.requestSha256`) !== expectedRequestSha256) {
    fail(`${label}.requestSha256 与规范请求不一致。`, "CURATOR_AGENT_HASH_MISMATCH");
  }
  if (historical && !idempotencyKey.startsWith("historical-")) {
    fail("历史策展运行必须使用隔离的幂等键。", "CURATOR_AGENT_HISTORICAL_BOUNDARY_INVALID");
  }
  const status = requireEnum(value.status, RUN_STATUS_SET, `${label}.status`);
  const version = requireInteger(value.version, `${label}.version`, 1, Number.MAX_SAFE_INTEGER);
  const budgets = validateFixedBudgets(value.budgets, `${label}.budgets`);
  const usage = validateUsage(value.usage, `${label}.usage`, budgets);
  const needsReview = requireBoolean(value.needsReview, `${label}.needsReview`);
  const allowDecisions = requireBoolean(value.allowDecisions, `${label}.allowDecisions`);
  if (historical && (!needsReview || allowDecisions)) {
    fail("历史策展运行必须待复核且禁止再次决定。", "CURATOR_AGENT_HISTORICAL_BOUNDARY_INVALID");
  }
  if (allowDecisions && status !== "completed") {
    fail("只有已完成且非历史的运行可以开放人工决定。", "CURATOR_AGENT_DECISION_STATE_INVALID");
  }
  const createdAt = requireTimestamp(value.createdAt, `${label}.createdAt`);
  const startedAt = optionalTimestamp(value.startedAt, `${label}.startedAt`);
  const updatedAt = requireTimestamp(value.updatedAt, `${label}.updatedAt`);
  const completedAt = optionalTimestamp(value.completedAt, `${label}.completedAt`);
  const cancelledAt = optionalTimestamp(value.cancelledAt, `${label}.cancelledAt`);
  const interruptedAt = optionalTimestamp(value.interruptedAt, `${label}.interruptedAt`);
  const failedAt = optionalTimestamp(value.failedAt, `${label}.failedAt`);
  if (Date.parse(updatedAt) < Date.parse(createdAt) || (startedAt && Date.parse(startedAt) < Date.parse(createdAt))) {
    fail(`${label} 的时间顺序无效。`, "CURATOR_AGENT_TIMESTAMP_INVALID");
  }
  const terminalTimes = { completed: completedAt, cancelled: cancelledAt, interrupted: interruptedAt, failed: failedAt };
  for (const [terminalStatus, timestamp] of Object.entries(terminalTimes)) {
    if ((status === terminalStatus) !== Boolean(timestamp)) {
      fail(`${label} 的终态时间与状态不一致。`, "CURATOR_AGENT_TIMESTAMP_INVALID");
    }
    if (timestamp && (Date.parse(timestamp) < Date.parse(createdAt) || Date.parse(timestamp) > Date.parse(updatedAt))) {
      fail(`${label} 的终态时间顺序无效。`, "CURATOR_AGENT_TIMESTAMP_INVALID");
    }
  }
  if (["running", "completed", "failed", "interrupted"].includes(status) && !startedAt) {
    fail(`${label} 缺少 startedAt。`, "CURATOR_AGENT_TIMESTAMP_INVALID");
  }
  const failureCode = requireText(value.failureCode, `${label}.failureCode`, 120, false);
  const failureMessage = requireText(value.failureMessage, `${label}.failureMessage`, 500, false);
  if ((status === "failed") !== Boolean(failureCode) || (status !== "failed" && failureMessage)) {
    fail(`${label} 的失败信息与状态不一致。`, "CURATOR_AGENT_FAILURE_STATE_INVALID");
  }
  return {
    id, request, requestSha256: value.requestSha256, status, version, budgets, usage,
    historical, needsReview, allowDecisions, createdAt, updatedAt
  };
}

function validateRequest(value, label, boundaries) {
  assertPlainObject(value, label);
  assertExactKeys(value, REQUEST_KEYS, label);
  if (value.intent !== "draft_exhibition") fail(`${label}.intent 无效。`, "CURATOR_AGENT_REQUEST_INVALID");
  const query = requireText(value.query, `${label}.query`, 240, false);
  const memoryIds = validateIdArray(value.memoryIds, `${label}.memoryIds`, 0, FIXED_BUDGETS.maxMemories, boundaries?.memories);
  if (memoryIds.length === 1 || (!query && memoryIds.length === 0)) {
    fail(`${label} 必须包含查询或至少两件展品。`, "CURATOR_AGENT_REQUEST_INVALID");
  }
  requireText(value.title, `${label}.title`, 120, false);
  requireText(value.theme, `${label}.theme`, 60, false);
  return cloneJson(value);
}

function validateFixedBudgets(value, label) {
  assertPlainObject(value, label);
  assertExactKeys(value, BUDGET_KEYS, label);
  for (const [key, expected] of Object.entries(FIXED_BUDGETS)) {
    if (value[key] !== expected) fail(`${label}.${key} 必须固定为 ${expected}。`, "CURATOR_AGENT_BUDGET_INVALID");
  }
  return { ...FIXED_BUDGETS };
}

function validateUsage(value, label, budgets) {
  assertPlainObject(value, label);
  assertExactKeys(value, USAGE_KEYS, label);
  const usage = {
    steps: requireInteger(value.steps, `${label}.steps`, 0, budgets.maxSteps),
    toolCalls: requireInteger(value.toolCalls, `${label}.toolCalls`, 0, budgets.maxToolCalls),
    resultBytes: requireInteger(value.resultBytes, `${label}.resultBytes`, 0, budgets.maxResultBytes),
    durationMs: requireInteger(value.durationMs, `${label}.durationMs`, 0, budgets.maxDurationMs)
  };
  if (usage.toolCalls > usage.steps) fail(`${label} 的工具次数不能超过步骤数。`, "CURATOR_AGENT_USAGE_INVALID");
  return usage;
}

function validateStep(value, label, run, expectedPosition, ids, boundaries) {
  assertPlainObject(value, label);
  assertExactKeys(value, STEP_KEYS, label);
  requireUniqueId(value.id, `${label}.id`, ids.steps);
  if (requireId(value.runId, `${label}.runId`) !== run.id) fail(`${label}.runId 无效。`, "CURATOR_AGENT_REFERENCE_INVALID");
  const position = requireInteger(value.position, `${label}.position`, 0, CURATOR_AGENT_LIMITS.stepsPerRun - 1);
  if (position !== expectedPosition) fail(`${label}.position 必须从 0 连续递增。`, "CURATOR_AGENT_STEP_ORDER_INVALID");
  const toolName = requireEnum(value.toolName, STEP_NAME_SET, `${label}.toolName`);
  validateStepPayload(toolName, value.args, value.result, `${label}`, boundaries);
  const resultJson = stableStringify(value.result);
  const resultBytes = Buffer.byteLength(resultJson, "utf8");
  if (requireInteger(value.resultBytes, `${label}.resultBytes`, 0, FIXED_BUDGETS.maxResultBytes) !== resultBytes ||
      requireSha256(value.resultSha256, `${label}.resultSha256`) !== sha256(resultJson)) {
    fail(`${label} 的结果字节数或 SHA-256 无效。`, "CURATOR_AGENT_HASH_MISMATCH");
  }
  const durationMs = requireInteger(value.durationMs, `${label}.durationMs`, 0, FIXED_BUDGETS.maxDurationMs);
  requireText(value.summary, `${label}.summary`, 240, false);
  const createdAt = requireTimestamp(value.createdAt, `${label}.createdAt`);
  if (Date.parse(createdAt) < Date.parse(run.createdAt) || Date.parse(createdAt) > Date.parse(run.updatedAt)) {
    fail(`${label}.createdAt 超出运行边界。`, "CURATOR_AGENT_TIMESTAMP_INVALID");
  }
  return { toolName, resultBytes, durationMs };
}

function validateStepPayload(toolName, args, result, label, boundaries) {
  assertPlainObject(args, `${label}.args`);
  assertPlainObject(result, `${label}.result`);
  if (toolName === "search_memory_summaries") {
    assertExactKeys(args, ["limit", "memoryIds", "query"], `${label}.args`);
    requireText(args.query, `${label}.args.query`, 240, false);
    validateIdArray(args.memoryIds, `${label}.args.memoryIds`, 0, FIXED_BUDGETS.maxMemories, boundaries?.memories);
    if (args.limit !== FIXED_BUDGETS.maxMemories) fail(`${label}.args.limit 无效。`, "CURATOR_AGENT_STEP_INVALID");
    assertExactKeys(result, ["memories"], `${label}.result`);
    requireArray(result.memories, FIXED_BUDGETS.maxMemories, `${label}.result.memories`).forEach((memory, index) => {
      assertExactKeys(memory, ["id", "summary", "title", "updatedAt"], `${label}.result.memories[${index}]`);
      requireBoundaryId(memory.id, `${label}.result.memories[${index}].id`, boundaries?.memories);
      requireText(memory.title, "title", 120, false);
      requireText(memory.summary, "summary", 320, false);
      if (memory.updatedAt) requireTimestamp(memory.updatedAt, "updatedAt");
    });
    return;
  }
  if (toolName === "read_memory_evidence") {
    assertExactKeys(args, ["memoryIds"], `${label}.args`);
    const requested = validateIdArray(args.memoryIds, `${label}.args.memoryIds`, 2, FIXED_BUDGETS.maxMemories, boundaries?.memories);
    assertExactKeys(result, ["memories"], `${label}.result`);
    const returned = requireArray(result.memories, FIXED_BUDGETS.maxMemories, `${label}.result.memories`).map((memory, index) => {
      assertExactKeys(memory, ["date", "emotions", "exhibitText", "id", "location", "people", "rawExcerpt", "rawSha256", "tags", "title", "updatedAt"], `${label}.result.memories[${index}]`);
      const id = requireBoundaryId(memory.id, "memory.id", boundaries?.memories);
      requireText(memory.title, "title", 120, false);
      requireText(memory.rawExcerpt, "rawExcerpt", 1_600, false);
      requireSha256(memory.rawSha256, "rawSha256");
      requireTimestamp(memory.updatedAt, "updatedAt");
      validateTextArray(memory.tags, "tags", 12, 40);
      validateTextArray(memory.people, "people", 12, 40);
      requireText(memory.location, "location", 80, false);
      requireText(memory.exhibitText, "exhibitText", 500, false);
      requireText(memory.date, "date", 40, false);
      validateTextArray(memory.emotions, "emotions", 8, 30);
      return id;
    });
    if (!sameIdSet(requested, returned)) fail(`${label} 的证据结果与请求边界不一致。`, "CURATOR_AGENT_REFERENCE_INVALID");
    return;
  }
  if (toolName === "read_confirmed_relationships") {
    assertExactKeys(args, ["memoryIds"], `${label}.args`);
    validateIdArray(args.memoryIds, `${label}.args.memoryIds`, 2, FIXED_BUDGETS.maxMemories, boundaries?.memories);
    assertExactKeys(result, ["relationships"], `${label}.result`);
    requireArray(result.relationships, 30, `${label}.result.relationships`).forEach((item, index) => {
      assertExactKeys(item, ["confirmedAt", "memoryAId", "memoryBId", "relationType"], `${label}.result.relationships[${index}]`);
      const left = requireBoundaryId(item.memoryAId, "memoryAId", boundaries?.memories);
      const right = requireBoundaryId(item.memoryBId, "memoryBId", boundaries?.memories);
      if (left === right) fail("关系两端不能相同。", "CURATOR_AGENT_REFERENCE_INVALID");
      requireText(item.relationType, "relationType", 40, true);
      if (item.confirmedAt) requireTimestamp(item.confirmedAt, "confirmedAt");
    });
    return;
  }
  if (toolName === "read_exhibition_summaries") {
    assertExactKeys(args, ["memoryIds"], `${label}.args`);
    validateIdArray(args.memoryIds, `${label}.args.memoryIds`, 2, FIXED_BUDGETS.maxMemories, boundaries?.memories);
    assertExactKeys(result, ["exhibitions"], `${label}.result`);
    requireArray(result.exhibitions, 20, `${label}.result.exhibitions`).forEach((item, index) => {
      assertExactKeys(item, ["id", "memoryIds", "status", "title"], `${label}.result.exhibitions[${index}]`);
      requireBoundaryId(item.id, "exhibition.id", boundaries?.exhibitions);
      requireText(item.title, "title", 120, false);
      requireEnum(item.status, new Set(["draft", "published"]), "status");
      validateIdArray(item.memoryIds, "memoryIds", 0, 12, boundaries?.memories);
    });
    return;
  }
  validateTypedJsonReferences(args, boundaries, `${label}.args`);
  validateTypedJsonReferences(result, boundaries, `${label}.result`);
}

function validateProposal(value, label, run, steps, ids, boundaries) {
  assertPlainObject(value, label);
  assertExactKeys(value, PROPOSAL_KEYS, label);
  requireUniqueId(value.id, `${label}.id`, ids.proposals);
  if (requireId(value.runId, `${label}.runId`) !== run.id || value.schemaVersion !== CURATOR_AGENT_SCHEMA_VERSION ||
      value.engineVersion !== CURATOR_AGENT_ENGINE_VERSION || value.kind !== "curator-agent-proposal") {
    fail(`${label} 的运行、版本或类型无效。`, "CURATOR_AGENT_PROPOSAL_INVALID");
  }
  if (requireSha256(value.requestSha256, `${label}.requestSha256`) !== run.requestSha256) {
    fail(`${label} 未绑定当前运行请求。`, "CURATOR_AGENT_HASH_MISMATCH");
  }
  const sourceRefs = requireArray(value.sourceRefs, FIXED_BUDGETS.maxMemories, `${label}.sourceRefs`);
  if (sourceRefs.length < 2) fail("策展提案至少需要两项来源。", "CURATOR_AGENT_SOURCE_INVALID");
  let previous = "";
  const sourceIds = new Set();
  sourceRefs.forEach((ref, index) => {
    assertPlainObject(ref, `${label}.sourceRefs[${index}]`);
    assertExactKeys(ref, SOURCE_REF_KEYS, `${label}.sourceRefs[${index}]`);
    const id = requireBoundaryId(ref.memoryId, "sourceRef.memoryId", boundaries?.memories);
    if (sourceIds.has(id) || (previous && previous.localeCompare(id, "en") >= 0)) {
      fail("策展来源必须按 memoryId 严格排序且不重复。", "CURATOR_AGENT_SOURCE_INVALID");
    }
    sourceIds.add(id);
    previous = id;
    requireTimestamp(ref.updatedAt, "sourceRef.updatedAt");
    requireSha256(ref.rawSha256, "sourceRef.rawSha256");
  });
  if (requireSha256(value.sourceSetSha256, `${label}.sourceSetSha256`) !== buildCuratorSourceSetSha256(sourceRefs)) {
    fail(`${label}.sourceSetSha256 与来源集合不一致。`, "CURATOR_AGENT_HASH_MISMATCH");
  }
  validatePreview(value.preview, `${label}.preview`, sourceIds, boundaries);
  validateRelation(value.relation, `${label}.relation`, sourceIds);
  validateActions(value.actions, `${label}.actions`, Boolean(value.relation));
  validateDuplicateContext(value.duplicateContext, `${label}.duplicateContext`, boundaries);
  const proposalSha = buildCuratorProposalSha256(value);
  if (requireSha256(value.proposalSha256, `${label}.proposalSha256`) !== proposalSha) {
    fail(`${label}.proposalSha256 与规范提案不一致。`, "CURATOR_AGENT_HASH_MISMATCH");
  }
  const readOnlyReceipts = steps.filter((step) => READ_ONLY_TOOL_SET.has(step.toolName));
  if (READ_ONLY_TOOL_NAMES.some((name) => readOnlyReceipts.filter((step) => step.toolName === name).length !== 1) ||
      stableStringify(readOnlyReceipts.map((step) => step.toolName)) !== stableStringify(READ_ONLY_TOOL_NAMES)) {
    fail("已完成提案必须按固定顺序保留四项只读工具回执。", "CURATOR_AGENT_SOURCE_INVALID");
  }
  const evidence = readOnlyReceipts.find((step) => step.toolName === "read_memory_evidence");
  const receiptRefs = evidence.result.memories.map((memory) => ({
    memoryId: memory.id,
    updatedAt: memory.updatedAt,
    rawSha256: memory.rawSha256
  })).sort((left, right) => left.memoryId.localeCompare(right.memoryId, "en"));
  if (stableStringify(receiptRefs) !== stableStringify(sourceRefs)) {
    fail("提案来源与只读证据回执不一致。", "CURATOR_AGENT_SOURCE_INVALID");
  }
  const createdAt = requireTimestamp(value.createdAt, `${label}.createdAt`);
  if (Date.parse(createdAt) < Date.parse(run.createdAt) || Date.parse(createdAt) > Date.parse(run.updatedAt)) {
    fail(`${label}.createdAt 超出运行边界。`, "CURATOR_AGENT_TIMESTAMP_INVALID");
  }
  return value;
}

function validatePreview(value, label, sourceIds, boundaries) {
  assertPlainObject(value, label);
  assertExactKeys(value, ["guidance", "memoryIds", "mode", "opening", "requiresConfirmation", "sections", "selection", "theme", "title"], label);
  requireText(value.title, `${label}.title`, 120, true);
  requireText(value.theme, `${label}.theme`, 60, true);
  requireText(value.opening, `${label}.opening`, 1_200, true);
  if (value.mode !== "evidence-rules" || value.requiresConfirmation !== true) fail(`${label} 的证据或确认边界无效。`, "CURATOR_AGENT_PREVIEW_INVALID");
  const memoryIds = validateIdArray(value.memoryIds, `${label}.memoryIds`, 2, FIXED_BUDGETS.maxMemories, boundaries?.memories);
  if (!sameIdSet(memoryIds, [...sourceIds])) fail(`${label} 的展品与来源集合不一致。`, "CURATOR_AGENT_REFERENCE_INVALID");
  const seenItems = [];
  const sections = requireArray(value.sections, 3, `${label}.sections`);
  if (!sections.length) fail(`${label}.sections 不能为空。`, "CURATOR_AGENT_PREVIEW_INVALID");
  sections.forEach((section, sectionIndex) => {
    assertExactKeys(section, ["items", "summary", "title"], `${label}.sections[${sectionIndex}]`);
    requireText(section.title, "section.title", 120, true);
    requireText(section.summary, "section.summary", 800, true);
    const items = requireArray(section.items, FIXED_BUDGETS.maxMemories, "section.items");
    if (!items.length) fail("展览章节不能为空。", "CURATOR_AGENT_PREVIEW_INVALID");
    items.forEach((item, itemIndex) => {
      assertExactKeys(item, ["citations", "curatorNote", "excerpt", "memoryId", "title"], `item[${itemIndex}]`);
      const id = requireBoundaryId(item.memoryId, "item.memoryId", sourceIds);
      seenItems.push(id);
      requireText(item.title, "item.title", 120, true);
      requireText(item.excerpt, "item.excerpt", 240, false);
      requireText(item.curatorNote, "item.curatorNote", 500, false);
      const citations = requireArray(item.citations, 1, "item.citations");
      if (citations.length !== 1) fail("每件提案展品必须恰好保留一条可核验引用。", "CURATOR_AGENT_PREVIEW_INVALID");
      const citation = citations[0];
      assertExactKeys(citation, ["endOffset", "evidenceValid", "field", "quote", "startOffset"], "citation");
      const start = requireInteger(citation.startOffset, "citation.startOffset", 0, 4_000);
      const end = requireInteger(citation.endOffset, "citation.endOffset", 1, 4_000);
      if (end <= start || citation.evidenceValid !== true || citation.field !== "rawContent") fail("提案引用边界无效。", "CURATOR_AGENT_PREVIEW_INVALID");
      requireText(citation.quote, "citation.quote", 180, true);
    });
  });
  if (!sameIdSet(seenItems, memoryIds) || new Set(seenItems).size !== seenItems.length) {
    fail("展览章节必须恰好覆盖每项来源一次。", "CURATOR_AGENT_PREVIEW_INVALID");
  }
  validateSelection(value.selection, `${label}.selection`, memoryIds);
  requireText(value.guidance, `${label}.guidance`, 500, true);
}

function validateSelection(value, label, memoryIds) {
  assertPlainObject(value, label);
  assertExactKeys(value, ["count", "grouping", "memoryIds"], label);
  if (value.count !== memoryIds.length || !sameIdSet(validateIdArray(value.memoryIds, `${label}.memoryIds`, 2, FIXED_BUDGETS.maxMemories), memoryIds)) {
    fail(`${label} 与提案展品不一致。`, "CURATOR_AGENT_PREVIEW_INVALID");
  }
  requireArray(value.grouping, 3, `${label}.grouping`).forEach((group, index) => {
    assertExactKeys(group, ["basis", "memoryIds", "sectionTitle"], `${label}.grouping[${index}]`);
    requireText(group.sectionTitle, "sectionTitle", 120, true);
    assertExactKeys(group.basis, ["count", "firstIndex", "memoryIds", "type", "value"], "basis");
    requireEnum(group.basis.type, new Set(["tag", "person", "location", "emotion", "year", "selection"]), "basis.type");
    requireText(group.basis.value, "basis.value", 80, true);
    const groupMemoryIds = validateIdArray(group.memoryIds, "group.memoryIds", 1, FIXED_BUDGETS.maxMemories, new Set(memoryIds));
    const basisMemoryIds = validateIdArray(group.basis.memoryIds, "basis.memoryIds", 1, FIXED_BUDGETS.maxMemories, new Set(memoryIds));
    if (group.basis.count !== groupMemoryIds.length || !sameIdSet(groupMemoryIds, basisMemoryIds) ||
        !Number.isSafeInteger(group.basis.firstIndex) || group.basis.firstIndex < 0 || group.basis.firstIndex >= memoryIds.length) {
      fail("分组 basis 与章节成员不一致。", "CURATOR_AGENT_PREVIEW_INVALID");
    }
  });
}

function validateRelation(value, label, sourceIds) {
  if (value === null) return;
  assertPlainObject(value, label);
  assertExactKeys(value, ["basis", "memoryAId", "memoryBId", "rationale", "relationType", "requiresConfirmation", "status"], label);
  if (value.status !== "candidate" || value.relationType !== "related_context" || value.requiresConfirmation !== true) {
    fail(`${label} 必须保持候选且等待人工确认。`, "CURATOR_AGENT_RELATION_INVALID");
  }
  const left = requireBoundaryId(value.memoryAId, "relation.memoryAId", sourceIds);
  const right = requireBoundaryId(value.memoryBId, "relation.memoryBId", sourceIds);
  if (left === right) fail("候选关系两端不能相同。", "CURATOR_AGENT_RELATION_INVALID");
  assertExactKeys(value.basis, ["field", "value"], `${label}.basis`);
  requireEnum(value.basis.field, new Set(["tag", "person", "location"]), "relation.basis.field");
  requireText(value.basis.value, "relation.basis.value", 80, true);
  requireText(value.rationale, "relation.rationale", 500, true);
}

function validateActions(value, label, relationAvailable) {
  const actions = requireArray(value, CURATOR_AGENT_ACTIONS.length, label);
  if (actions.length !== CURATOR_AGENT_ACTIONS.length) fail("策展提案必须精确声明三项独立人工动作。", "CURATOR_AGENT_ACTION_INVALID");
  actions.forEach((item, index) => {
    const action = CURATOR_AGENT_ACTIONS[index];
    const expectedKeys = action === "publish_exhibition"
      ? ["action", "dependsOn", "effect", "enabled", "requiresConfirmation"]
      : ["action", "effect", "enabled", "requiresConfirmation"];
    assertExactKeys(item, expectedKeys, `${label}[${index}]`);
    if (item.action !== action || item.requiresConfirmation !== true || typeof item.enabled !== "boolean") {
      fail("策展动作顺序或人工确认边界无效。", "CURATOR_AGENT_ACTION_INVALID");
    }
    if (action === "save_exhibition" && (item.enabled !== true || item.effect !== "create_draft_only")) fail("保存动作无效。", "CURATOR_AGENT_ACTION_INVALID");
    if (action === "confirm_relationship" && (item.enabled !== relationAvailable || item.effect !== "confirm_candidate_only")) fail("关系动作无效。", "CURATOR_AGENT_ACTION_INVALID");
    if (action === "publish_exhibition" && (item.enabled !== true || item.dependsOn !== "save_exhibition" || item.effect !== "publish_saved_draft")) fail("发布动作无效。", "CURATOR_AGENT_ACTION_INVALID");
  });
  if (JSON.stringify(actions).includes("share")) fail("分享不能成为策展助手后端动作。", "CURATOR_AGENT_SHARE_FORBIDDEN");
}

function validateDuplicateContext(value, label, boundaries) {
  const ids = new Set();
  requireArray(value, 20, label).forEach((item, index) => {
    assertExactKeys(item, ["id", "memoryIds", "status", "title"], `${label}[${index}]`);
    const id = requireBoundaryId(item.id, "duplicateContext.id", boundaries?.exhibitions);
    if (ids.has(id)) fail("重复展览上下文不能重复。", "CURATOR_AGENT_REFERENCE_INVALID");
    ids.add(id);
    requireText(item.title, "duplicateContext.title", 120, false);
    requireEnum(item.status, new Set(["draft", "published"]), "duplicateContext.status");
    validateIdArray(item.memoryIds, "duplicateContext.memoryIds", 0, 12, boundaries?.memories);
  });
}

function validateDecision(value, label, run, proposal, index, ids, boundaries) {
  assertPlainObject(value, label);
  assertExactKeys(value, DECISION_KEYS, label);
  if (requireId(value.runId, `${label}.runId`) !== run.id) fail(`${label}.runId 无效。`, "CURATOR_AGENT_REFERENCE_INVALID");
  const action = requireEnum(value.action, ACTION_SET, `${label}.action`);
  const decision = requireEnum(value.decision, DECISION_SET, `${label}.decision`);
  const key = requireIdempotencyKey(value.idempotencyKey, `${label}.idempotencyKey`);
  if (ids.decisionKeys.has(key)) fail("人工决定幂等键不能重复。", "CURATOR_AGENT_DUPLICATE_ID");
  ids.decisionKeys.add(key);
  if (run.historical && !key.startsWith("historical-")) fail("历史决定必须使用隔离幂等键。", "CURATOR_AGENT_HISTORICAL_BOUNDARY_INVALID");
  const expectedHash = run.historical
    ? buildHistoricalCuratorDecisionSha256({ action, decision, runId: run.id })
    : buildCuratorDecisionRequestSha256({ action, decision, runId: run.id });
  if (requireSha256(value.requestSha256, `${label}.requestSha256`) !== expectedHash) {
    fail(`${label}.requestSha256 与决定不一致。`, "CURATOR_AGENT_HASH_MISMATCH");
  }
  validateDecisionOutcome(value.outcome, `${label}.outcome`, action, decision, run.historical, proposal, boundaries);
  const createdAt = requireTimestamp(value.createdAt, `${label}.createdAt`);
  if (Date.parse(createdAt) < Date.parse(run.createdAt) || Date.parse(createdAt) > Date.parse(run.updatedAt)) {
    fail(`${label}.createdAt 超出运行边界。`, "CURATOR_AGENT_TIMESTAMP_INVALID");
  }
  const declared = proposal?.actions?.find((item) => item.action === action);
  if (!declared || (decision === "approve" && declared.enabled !== true)) fail(`${label} 引用了不可执行动作。`, "CURATOR_AGENT_ACTION_INVALID");
  if (action === "confirm_relationship" && decision === "approve" && !proposal?.relation) fail("没有关系候选时不能确认关系。", "CURATOR_AGENT_RELATION_INVALID");
  return { index, action, decision };
}

function validateDecisionOutcome(value, label, action, decision, historical, proposal, boundaries) {
  assertPlainObject(value, label);
  if (decision === "reject") {
    assertExactKeys(value, ["status"], label);
    if (value.status !== "rejected") fail(`${label}.status 无效。`, "CURATOR_AGENT_DECISION_INVALID");
    return;
  }
  if (action === "save_exhibition") {
    assertExactKeys(value, ["exhibitionId", "exhibitionStatus", "status"], label);
    if (value.status !== "approved" || value.exhibitionStatus !== "draft") fail(`${label} 无效。`, "CURATOR_AGENT_DECISION_INVALID");
    requireHistoricalTarget(value.exhibitionId, "outcome.exhibitionId", boundaries?.exhibitions, historical);
    return;
  }
  if (action === "publish_exhibition") {
    assertExactKeys(value, ["exhibitionId", "exhibitionStatus", "status"], label);
    if (value.status !== "approved" || value.exhibitionStatus !== "published") fail(`${label} 无效。`, "CURATOR_AGENT_DECISION_INVALID");
    requireHistoricalTarget(value.exhibitionId, "outcome.exhibitionId", boundaries?.exhibitions, historical);
    return;
  }
  assertExactKeys(value, ["memoryAId", "memoryBId", "relationType", "status"], label);
  if (value.status !== "approved" || !["same_event", "related_context"].includes(value.relationType)) fail(`${label} 无效。`, "CURATOR_AGENT_DECISION_INVALID");
  const left = requireBoundaryId(value.memoryAId, "outcome.memoryAId", boundaries?.memories);
  const right = requireBoundaryId(value.memoryBId, "outcome.memoryBId", boundaries?.memories);
  if (left === right || (proposal?.relation && !sameIdSet([left, right], [proposal.relation.memoryAId, proposal.relation.memoryBId]))) {
    fail("关系决定与候选来源不一致。", "CURATOR_AGENT_RELATION_INVALID");
  }
}

function validateRedactedState(payload, mode) {
  assertExactKeys(payload, REDACTED_ROOT_KEYS, "curator-agent redacted state");
  if (payload.mode !== "redacted-summary" || payload.note !== CURATOR_AGENT_REDACTED_NOTE ||
      (mode !== undefined && mode !== "redacted")) {
    fail("脱敏策展助手摘要的模式或固定说明无效。", "CURATOR_AGENT_REDACTED_PRIVACY_INVALID");
  }
  const runCount = requireCount(payload.runCount, "runCount", CURATOR_AGENT_LIMITS.runs);
  const completed = requireCount(payload.completedRunCount, "completedRunCount", runCount);
  const cancelled = requireCount(payload.cancelledRunCount, "cancelledRunCount", runCount);
  const proposals = requireCount(payload.proposalCount, "proposalCount", runCount);
  const decisions = requireCount(payload.decisionCount, "decisionCount", runCount * CURATOR_AGENT_LIMITS.decisionsPerRun);
  const approved = requireCount(payload.approvedCount, "approvedCount", decisions);
  const rejected = requireCount(payload.rejectedCount, "rejectedCount", decisions);
  if (completed + cancelled > runCount || proposals > completed || approved + rejected !== decisions) {
    fail("脱敏策展助手摘要统计互相矛盾。", "CURATOR_AGENT_REDACTED_PRIVACY_INVALID");
  }
  return true;
}

function remapRunEntry(entry, maps) {
  const oldRun = entry.run;
  const runId = maps.runIdMap.get(oldRun.id);
  const interrupted = ["created", "running"].includes(oldRun.status);
  const request = remapRequest(oldRun.request, maps.memoryIdMap);
  const requestSha256 = buildHistoricalCuratorRequestSha256(request);
  const idempotencyKey = historicalKey(oldRun.idempotencyKey, runId);
  const steps = entry.steps.map((step) => {
    const args = remapStepPayload(step.toolName, step.args, maps, true);
    const result = remapStepPayload(step.toolName, step.result, maps, false);
    const resultJson = stableStringify(result);
    return {
      ...cloneJson(step),
      id: maps.stepIdMap.get(step.id),
      runId,
      args,
      result,
      resultSha256: sha256(resultJson),
      resultBytes: Buffer.byteLength(resultJson, "utf8")
    };
  });
  const proposal = entry.proposal ? remapProposal(entry.proposal, runId, requestSha256, maps) : null;
  const decisions = entry.decisions.map((decision, index) => {
    const sourceKey = curatorAgentDecisionMapKey(oldRun.id, index, decision);
    const generatedDecisionId = maps.decisionIdMap.get(sourceKey);
    const outcome = remapDecisionOutcome(decision, maps);
    return {
      ...cloneJson(decision),
      runId,
      idempotencyKey: historicalKey(decision.idempotencyKey, generatedDecisionId),
      requestSha256: buildHistoricalCuratorDecisionSha256({
        action: decision.action,
        decision: decision.decision,
        runId
      }),
      outcome
    };
  });
  return {
    run: {
      ...cloneJson(oldRun),
      id: runId,
      idempotencyKey,
      request,
      requestSha256,
      usage: {
        ...cloneJson(oldRun.usage),
        resultBytes: steps.reduce((sum, step) => sum + step.resultBytes, 0)
      },
      historical: true,
      needsReview: true,
      allowDecisions: false,
      status: interrupted ? "interrupted" : oldRun.status,
      startedAt: interrupted ? (oldRun.startedAt || oldRun.createdAt) : oldRun.startedAt,
      interruptedAt: interrupted ? (oldRun.interruptedAt || oldRun.updatedAt) : oldRun.interruptedAt
    },
    steps,
    proposal,
    decisions
  };
}

function remapRequest(request, memoryIdMap) {
  return { ...cloneJson(request), memoryIds: request.memoryIds.map((id) => mapRequired(memoryIdMap, id, "memoryId")) };
}

function remapStepPayload(toolName, payload, maps, isArgs) {
  const value = cloneJson(payload);
  if (toolName === "search_memory_summaries") {
    if (isArgs) return { ...value, memoryIds: value.memoryIds.map((id) => mapRequired(maps.memoryIdMap, id, "memoryId")) };
    return { memories: value.memories.map((item) => ({ ...item, id: mapRequired(maps.memoryIdMap, item.id, "memoryId") })) };
  }
  if (toolName === "read_memory_evidence") {
    if (isArgs) return { memoryIds: value.memoryIds.map((id) => mapRequired(maps.memoryIdMap, id, "memoryId")) };
    return { memories: value.memories.map((item) => ({ ...item, id: mapRequired(maps.memoryIdMap, item.id, "memoryId") })) };
  }
  if (toolName === "read_confirmed_relationships") {
    if (isArgs) return { memoryIds: value.memoryIds.map((id) => mapRequired(maps.memoryIdMap, id, "memoryId")) };
    return { relationships: value.relationships.map((item) => ({
      ...item,
      memoryAId: mapRequired(maps.memoryIdMap, item.memoryAId, "memoryAId"),
      memoryBId: mapRequired(maps.memoryIdMap, item.memoryBId, "memoryBId")
    })) };
  }
  if (toolName === "read_exhibition_summaries") {
    if (isArgs) return { memoryIds: value.memoryIds.map((id) => mapRequired(maps.memoryIdMap, id, "memoryId")) };
    return { exhibitions: value.exhibitions.map((item) => ({
      ...item,
      id: mapRequired(maps.exhibitionIdMap, item.id, "exhibitionId"),
      memoryIds: item.memoryIds.map((id) => mapRequired(maps.memoryIdMap, id, "memoryId"))
    })) };
  }
  return remapTypedJson(value, maps);
}

function remapProposal(value, runId, requestSha256, maps) {
  const sourceRefs = value.sourceRefs.map((ref) => ({
    ...ref,
    memoryId: mapRequired(maps.memoryIdMap, ref.memoryId, "sourceRef.memoryId")
  })).sort((left, right) => left.memoryId.localeCompare(right.memoryId, "en"));
  const preview = remapPreview(value.preview, maps.memoryIdMap);
  const relation = value.relation ? {
    ...cloneJson(value.relation),
    memoryAId: mapRequired(maps.memoryIdMap, value.relation.memoryAId, "relation.memoryAId"),
    memoryBId: mapRequired(maps.memoryIdMap, value.relation.memoryBId, "relation.memoryBId")
  } : null;
  const duplicateContext = value.duplicateContext.map((item) => ({
    ...cloneJson(item),
    id: mapRequired(maps.exhibitionIdMap, item.id, "duplicateContext.exhibitionId"),
    memoryIds: item.memoryIds.map((id) => mapRequired(maps.memoryIdMap, id, "duplicateContext.memoryId"))
  }));
  const proposal = {
    ...cloneJson(value),
    id: maps.proposalIdMap.get(value.id),
    runId,
    requestSha256,
    sourceRefs,
    sourceSetSha256: buildCuratorSourceSetSha256(sourceRefs),
    preview,
    relation,
    duplicateContext
  };
  proposal.proposalSha256 = buildCuratorProposalSha256(proposal);
  return proposal;
}

function remapPreview(value, memoryIdMap) {
  return {
    ...cloneJson(value),
    memoryIds: value.memoryIds.map((id) => mapRequired(memoryIdMap, id, "preview.memoryId")),
    sections: value.sections.map((section) => ({
      ...cloneJson(section),
      items: section.items.map((item) => ({ ...cloneJson(item), memoryId: mapRequired(memoryIdMap, item.memoryId, "preview.item.memoryId") }))
    })),
    selection: {
      ...cloneJson(value.selection),
      memoryIds: value.selection.memoryIds.map((id) => mapRequired(memoryIdMap, id, "selection.memoryId")),
      grouping: value.selection.grouping.map((group) => ({
        ...cloneJson(group),
        memoryIds: group.memoryIds.map((id) => mapRequired(memoryIdMap, id, "group.memoryId")),
        basis: {
          ...cloneJson(group.basis),
          memoryIds: group.basis.memoryIds.map((id) => mapRequired(memoryIdMap, id, "basis.memoryId"))
        }
      }))
    }
  };
}

function remapDecisionOutcome(decision, maps) {
  const outcome = cloneJson(decision.outcome);
  if (decision.decision === "reject") return outcome;
  if (["save_exhibition", "publish_exhibition"].includes(decision.action)) {
    return {
      ...outcome,
      exhibitionId: outcome.exhibitionId
        ? mapRequired(maps.exhibitionIdMap, outcome.exhibitionId, "outcome.exhibitionId")
        : ""
    };
  }
  return {
    ...outcome,
    memoryAId: mapRequired(maps.memoryIdMap, outcome.memoryAId, "outcome.memoryAId"),
    memoryBId: mapRequired(maps.memoryIdMap, outcome.memoryBId, "outcome.memoryBId")
  };
}

function validateTypedJsonReferences(value, boundaries, label, seen = new Set()) {
  if (!value || typeof value !== "object") return;
  if (seen.has(value)) fail(`${label} 不能包含循环引用。`, "CURATOR_AGENT_ARCHIVE_INVALID");
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateTypedJsonReferences(item, boundaries, `${label}[${index}]`, seen));
  } else {
    for (const [key, item] of Object.entries(value)) {
      if (["memoryId", "memoryAId", "memoryBId"].includes(key)) requireBoundaryId(item, `${label}.${key}`, boundaries?.memories);
      else if (key === "memoryIds") validateIdArray(item, `${label}.${key}`, 0, 100, boundaries?.memories);
      else if (key === "eventId" && item !== "") requireBoundaryId(item, `${label}.${key}`, boundaries?.events);
      else if (key === "exhibitionId" && item !== "") requireBoundaryId(item, `${label}.${key}`, boundaries?.exhibitions);
      validateTypedJsonReferences(item, boundaries, `${label}.${key}`, seen);
    }
  }
  seen.delete(value);
}

function remapTypedJson(value, maps) {
  if (Array.isArray(value)) return value.map((item) => remapTypedJson(item, maps));
  if (!value || typeof value !== "object") return value;
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (["memoryId", "memoryAId", "memoryBId"].includes(key)) output[key] = mapRequired(maps.memoryIdMap, item, key);
    else if (key === "memoryIds") output[key] = item.map((id) => mapRequired(maps.memoryIdMap, id, key));
    else if (key === "eventId" && item) output[key] = mapRequired(maps.eventIdMap, item, key);
    else if (key === "exhibitionId" && item) output[key] = mapRequired(maps.exhibitionIdMap, item, key);
    else output[key] = remapTypedJson(item, maps);
  }
  return output;
}

function buildCuratorRequestSha256(request) {
  return sha256(stableStringify(request));
}

function buildHistoricalCuratorRequestSha256(request) {
  return domainHash(HISTORICAL_REQUEST_DOMAIN, request);
}

function buildCuratorSourceSetSha256(sourceRefs) {
  return sha256(stableStringify(sourceRefs));
}

function buildCuratorProposalSha256(proposal) {
  return sha256(stableStringify({
    schemaVersion: Number(proposal.schemaVersion),
    engineVersion: String(proposal.engineVersion || ""),
    kind: String(proposal.kind || ""),
    requestSha256: String(proposal.requestSha256 || ""),
    sourceSetSha256: String(proposal.sourceSetSha256 || ""),
    sourceRefs: Array.isArray(proposal.sourceRefs) ? proposal.sourceRefs : [],
    preview: proposal.preview,
    relation: proposal.relation ?? null,
    actions: Array.isArray(proposal.actions) ? proposal.actions : [],
    duplicateContext: Array.isArray(proposal.duplicateContext) ? proposal.duplicateContext : []
  }));
}

function buildCuratorDecisionRequestSha256(input) {
  return sha256(stableStringify({ action: input.action, confirm: true, decision: input.decision, runId: input.runId }));
}

function buildHistoricalCuratorDecisionSha256(input) {
  return domainHash(HISTORICAL_DECISION_DOMAIN, { action: input.action, confirm: true, decision: input.decision, runId: input.runId });
}

function historicalKey(source, target) {
  return `historical-${domainHash(HISTORICAL_KEY_DOMAIN, { source, target }).slice(0, 48)}`;
}

function domainHash(domain, value) {
  return sha256(`${domain}\u0000${stableStringify(value)}`);
}

function measureJson(value) {
  const seen = new Set();
  const totals = { nodes: 0, text: 0 };
  walk(value, 0);
  let bytes;
  try { bytes = Buffer.byteLength(JSON.stringify(value), "utf8"); }
  catch (cause) { fail("策展助手归档无法序列化。", "CURATOR_AGENT_ARCHIVE_INVALID", 400, cause); }
  if (bytes > CURATOR_AGENT_LIMITS.jsonBytes) fail("策展助手归档超过 JSON 字节上限。", "CURATOR_AGENT_ARCHIVE_LIMIT_EXCEEDED", 413);
  return { ...totals, bytes };

  function walk(item, depth) {
    totals.nodes += 1;
    if (totals.nodes > CURATOR_AGENT_LIMITS.jsonNodes || depth > CURATOR_AGENT_LIMITS.jsonDepth) {
      fail("策展助手归档的 JSON 复杂度超过安全上限。", "CURATOR_AGENT_ARCHIVE_LIMIT_EXCEEDED", 413);
    }
    if (typeof item === "string") {
      if (!isWellFormedString(item) || item.length > CURATOR_AGENT_LIMITS.stringChars) fail("策展助手归档包含无效或过长文本。", "CURATOR_AGENT_ARCHIVE_LIMIT_EXCEEDED", 413);
      totals.text += item.length;
      if (totals.text > CURATOR_AGENT_LIMITS.textChars) fail("策展助手归档总文本超过安全上限。", "CURATOR_AGENT_ARCHIVE_LIMIT_EXCEEDED", 413);
      return;
    }
    if (item === null || typeof item === "boolean") return;
    if (typeof item === "number") {
      if (!Number.isFinite(item)) fail("策展助手归档不能包含非有限数字。", "CURATOR_AGENT_ARCHIVE_INVALID");
      return;
    }
    if (Array.isArray(item)) {
      if (seen.has(item)) fail("策展助手归档不能包含循环引用。", "CURATOR_AGENT_ARCHIVE_INVALID");
      seen.add(item);
      item.forEach((child) => walk(child, depth + 1));
      seen.delete(item);
      return;
    }
    assertPlainObject(item, "JSON object");
    if (seen.has(item)) fail("策展助手归档不能包含循环引用。", "CURATOR_AGENT_ARCHIVE_INVALID");
    seen.add(item);
    for (const [key, child] of Object.entries(item)) {
      if (["__proto__", "prototype", "constructor"].includes(key) || key.length > 120 || !isWellFormedString(key)) {
        fail("策展助手归档包含不安全字段名。", "CURATOR_AGENT_ARCHIVE_INVALID");
      }
      totals.text += key.length;
      if (totals.text > CURATOR_AGENT_LIMITS.textChars) fail("策展助手归档总文本超过安全上限。", "CURATOR_AGENT_ARCHIVE_LIMIT_EXCEEDED", 413);
      walk(child, depth + 1);
    }
    seen.delete(item);
  }
}

function normalizeBoundary(value, name) {
  if (value === undefined || value === null) return null;
  const items = value instanceof Set ? [...value] : value;
  if (!Array.isArray(items)) fail(`${name} 必须是数组或 Set。`, "CURATOR_AGENT_REFERENCE_INVALID");
  const result = new Set();
  items.forEach((item) => {
    const id = requireId(item, name);
    if (result.has(id)) fail(`${name} 不能重复。`, "CURATOR_AGENT_REFERENCE_INVALID");
    result.add(id);
  });
  return result;
}

function normalizeRequiredIdMap(value, name, allowEmpty = false) {
  const entries = value instanceof Map ? [...value] : isPlainObject(value) ? Object.entries(value) : null;
  if (!entries || (!allowEmpty && entries.length === 0)) fail(`${name} 必须提供完整 ID 映射。`, "CURATOR_AGENT_REMAP_MAPPING_INVALID");
  const result = new Map();
  const targets = new Set();
  entries.forEach(([source, target]) => {
    const sourceId = requireId(source, `${name}.source`);
    const targetId = requireId(target, `${name}.target`);
    if (result.has(sourceId) || targets.has(targetId)) fail(`${name} 包含重复或折叠映射。`, "CURATOR_AGENT_REMAP_MAPPING_COLLISION", 409);
    result.set(sourceId, targetId);
    targets.add(targetId);
  });
  return result;
}

function mapRequired(map, source, name) {
  const id = requireId(source, name);
  if (!map.has(id)) fail(`${name} 缺少恢复映射。`, "CURATOR_AGENT_REMAP_MAPPING_MISSING", 409);
  return map.get(id);
}

function claimCreatedId(createId, prefix, occupied) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const id = requireId(createId(prefix), `${prefix} generated id`);
    if (!occupied.has(id)) {
      occupied.add(id);
      return id;
    }
  }
  fail("策展助手恢复无法生成唯一 ID。", "CURATOR_AGENT_REMAP_ID_EXHAUSTED", 500);
}

function curatorAgentDecisionMapKey(runId, index, decision) {
  return `${runId}:${index}:${decision.action}:${decision.idempotencyKey}`;
}

function requireHistoricalTarget(value, name, boundary, historical) {
  if (value === "" && historical) return "";
  return requireBoundaryId(value, name, boundary);
}

function requireBoundaryId(value, name, boundary) {
  const id = requireId(value, name);
  if (boundary && !boundary.has(id)) fail(`${name} 引用了归档边界外对象。`, "CURATOR_AGENT_REFERENCE_INVALID");
  return id;
}

function validateIdArray(value, name, minimum, maximum, boundary) {
  const array = requireArray(value, maximum, name);
  if (array.length < minimum) fail(`${name} 数量不足。`, "CURATOR_AGENT_REFERENCE_INVALID");
  const ids = array.map((item) => requireBoundaryId(item, name, boundary));
  if (new Set(ids).size !== ids.length) fail(`${name} 不能重复。`, "CURATOR_AGENT_REFERENCE_INVALID");
  return ids;
}

function validateTextArray(value, name, maximum, itemMaximum) {
  const array = requireArray(value, maximum, name);
  array.forEach((item) => requireText(item, name, itemMaximum, true));
  if (new Set(array).size !== array.length) fail(`${name} 不能重复。`, "CURATOR_AGENT_VALUE_INVALID");
  return array;
}

function sameIdSet(left, right) {
  return left.length === right.length && new Set(left).size === left.length && left.every((id) => right.includes(id));
}

function requireUniqueId(value, name, set) {
  const id = requireId(value, name);
  if (set.has(id)) fail(`${name} 重复。`, "CURATOR_AGENT_DUPLICATE_ID");
  set.add(id);
  return id;
}

function requireId(value, name) {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) fail(`${name} 无效。`, "CURATOR_AGENT_ID_INVALID");
  return value;
}

function requireIdempotencyKey(value, name) {
  if (typeof value !== "string" || !IDEMPOTENCY_PATTERN.test(value)) fail(`${name} 无效。`, "CURATOR_AGENT_IDEMPOTENCY_INVALID");
  return value;
}

function requireSha256(value, name) {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) fail(`${name} 必须是规范小写 SHA-256。`, "CURATOR_AGENT_HASH_INVALID");
  return value;
}

function requireTimestamp(value, name) {
  if (typeof value !== "string" || !value || value.length > 40) fail(`${name} 时间无效。`, "CURATOR_AGENT_TIMESTAMP_INVALID");
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) fail(`${name} 必须是规范 UTC 时间。`, "CURATOR_AGENT_TIMESTAMP_INVALID");
  return value;
}

function optionalTimestamp(value, name) {
  return value === "" ? "" : requireTimestamp(value, name);
}

function requireInteger(value, name, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) fail(`${name} 整数无效。`, "CURATOR_AGENT_VALUE_INVALID");
  return value;
}

function requireCount(value, name, maximum) {
  return requireInteger(value, name, 0, maximum);
}

function requireBoolean(value, name) {
  if (typeof value !== "boolean") fail(`${name} 必须是布尔值。`, "CURATOR_AGENT_VALUE_INVALID");
  return value;
}

function requireEnum(value, allowed, name) {
  if (!allowed.has(value)) fail(`${name} 枚举值无效。`, "CURATOR_AGENT_VALUE_INVALID");
  return value;
}

function requireText(value, name, maximum, required) {
  if (typeof value !== "string" || value.length > maximum || value.includes("\u0000") || !isWellFormedString(value) ||
      value !== value.trim() || (required && !value)) {
    fail(`${name} 文本无效。`, "CURATOR_AGENT_VALUE_INVALID");
  }
  return value;
}

function requireArray(value, maximum, name) {
  if (!Array.isArray(value) || value.length > maximum) fail(`${name} 数组无效或超过上限。`, "CURATOR_AGENT_ARCHIVE_LIMIT_EXCEEDED", 413);
  return value;
}

function assertExactKeys(value, expected, name) {
  assertPlainObject(value, name);
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (keys.length !== wanted.length || keys.some((key, index) => key !== wanted[index])) {
    fail(`${name} 字段集合无效。`, "CURATOR_AGENT_FIELD_SET_INVALID");
  }
}

function assertPlainObject(value, name) {
  if (!isPlainObject(value)) fail(`${name} 必须是普通对象。`, "CURATOR_AGENT_ARCHIVE_INVALID");
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isWellFormedString(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function fail(message, code, statusCode = 400, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  error.statusCode = statusCode;
  throw error;
}

module.exports = {
  CURATOR_AGENT_ACTIONS,
  CURATOR_AGENT_ARCHIVE_PREFIX,
  CURATOR_AGENT_ENGINE_VERSION,
  CURATOR_AGENT_LIMITS,
  CURATOR_AGENT_REDACTED_NOTE,
  CURATOR_AGENT_RUN_STATUSES,
  CURATOR_AGENT_SCHEMA_VERSION,
  CURATOR_AGENT_SECTION_NAME,
  CURATOR_AGENT_SECTION_PATH,
  CURATOR_AGENT_SECTION_VERSION,
  CURATOR_AGENT_STEP_NAMES,
  FIXED_BUDGETS,
  READ_ONLY_TOOL_NAMES,
  assertRedactedCuratorAgentPrivacy,
  buildCuratorDecisionRequestSha256,
  buildCuratorProposalSha256,
  buildCuratorRequestSha256,
  buildCuratorSourceSetSha256,
  buildHistoricalCuratorDecisionSha256,
  buildHistoricalCuratorRequestSha256,
  curatorAgentDecisionMapKey,
  remapCuratorAgentState,
  sha256,
  stableStringify,
  validateCuratorAgentArchiveEnvelope,
  validateCuratorAgentArchiveState
};
