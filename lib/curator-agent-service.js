"use strict";

const { createHash } = require("node:crypto");
const { buildExhibitionPreview } = require("./exhibition-curator");

const CURATOR_AGENT_SCHEMA_VERSION = 14;
const CURATOR_AGENT_ENGINE_VERSION = "local-evidence-rules-v1";
const DEFAULT_BUDGETS = Object.freeze({
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
// Historical schema-14 archives may retain bounded internal receipts from
// earlier V10 builds. They are never callable tools and do not consume the
// fixed four-call tool budget.
const INTERNAL_STEP_NAMES = Object.freeze(["plan", "compose", "validate"]);
const RELATION_BASIS_LABELS = Object.freeze({
  tag: "主题标签",
  person: "人物",
  location: "地点"
});
const READ_ONLY_TOOL_SET = new Set(READ_ONLY_TOOL_NAMES);
const INTERNAL_STEP_SET = new Set(INTERNAL_STEP_NAMES);
const CURATOR_ACTIONS = Object.freeze([
  "save_exhibition",
  "confirm_relationship",
  "publish_exhibition"
]);
const CURATOR_ACTION_SET = new Set(CURATOR_ACTIONS);
const RUN_STATUSES = Object.freeze([
  "created",
  "running",
  "completed",
  "cancelled",
  "failed",
  "interrupted"
]);
const RUN_STATUS_SET = new Set(RUN_STATUSES);
const ID_PATTERN = /^[a-zA-Z0-9_-]{1,120}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const MAX_TOOL_RESULT_EXCERPT = 1_600;
const MAX_STEP_SUMMARY = 240;
const HISTORICAL_REQUEST_DOMAIN = "time-isle.curator-agent.historical-request.v1";

function normalizeCuratorRunRequest(input = {}) {
  if (!isPlainObject(input)) throw curatorAgentError("Run request must be an object.", "CURATOR_AGENT_REQUEST_INVALID");
  assertExactKeys(input, ["intent", "memoryIds", "query", "theme", "title"], "run request");
  const intent = String(input.intent || "draft_exhibition").trim();
  if (intent !== "draft_exhibition") {
    throw curatorAgentError("Only draft_exhibition is supported.", "CURATOR_AGENT_INTENT_INVALID");
  }
  const memoryIds = normalizeIds(input.memoryIds, DEFAULT_BUDGETS.maxMemories);
  if (memoryIds.length === 1) {
    throw curatorAgentError("Select at least two memories, or leave the selection empty and search.", "CURATOR_AGENT_MEMORY_COUNT_INVALID");
  }
  const query = cleanText(input.query, 240);
  if (!query && memoryIds.length === 0) {
    throw curatorAgentError("A query or at least two memoryIds is required.", "CURATOR_AGENT_REQUEST_EMPTY");
  }
  return Object.freeze({
    intent,
    query,
    memoryIds: Object.freeze(memoryIds),
    title: cleanText(input.title, 120),
    theme: cleanText(input.theme, 60)
  });
}

function buildCuratorRequestSha256(request) {
  return sha256(stableStringify(normalizeCuratorRunRequest(request)));
}

function buildHistoricalCuratorRequestSha256(request) {
  return sha256(`${HISTORICAL_REQUEST_DOMAIN}\0${stableStringify(normalizeCuratorRunRequest(request))}`);
}

/**
 * Execute one deterministic, request-bound curation pass.
 * Tool callbacks must be synchronous and are restricted to the four names in
 * READ_ONLY_TOOL_NAMES. Only short receipts leave this function; raw evidence
 * is held transiently long enough to produce citations and source hashes.
 */
function executeCuratorAgent(options = {}) {
  const request = normalizeCuratorRunRequest(options.request);
  const tools = normalizeTools(options.tools);
  const budgets = normalizeFixedBudgets(options.budgets);
  const onStep = typeof options.onStep === "function" ? options.onStep : () => {};
  const shouldCancel = typeof options.shouldCancel === "function" ? options.shouldCancel : () => false;
  const monotonicNow = typeof options.monotonicNow === "function" ? options.monotonicNow : () => Date.now();
  const readMonotonic = () => {
    const value = Number(monotonicNow());
    if (!Number.isFinite(value)) throw new TypeError("Curator-agent monotonic clock is invalid.");
    return value;
  };
  const startedAtMs = readMonotonic();
  const receipts = [];
  let toolCalls = 0;
  let resultBytes = 0;

  function elapsedAt(value = readMonotonic()) {
    return Math.max(0, Math.floor(value - startedAtMs));
  }

  function assertDuration(value = readMonotonic()) {
    const elapsed = elapsedAt(value);
    if (elapsed > budgets.maxDurationMs) {
      throw curatorAgentError("The run exceeded its duration budget.", "CURATOR_AGENT_DURATION_BUDGET_EXCEEDED", 409);
    }
    return elapsed;
  }

  function checkpoint() {
    if (shouldCancel()) throw curatorAgentError("The run was cancelled.", "CURATOR_AGENT_CANCELLED", 409);
    assertDuration();
    if (receipts.length >= budgets.maxSteps || toolCalls >= budgets.maxToolCalls) {
      throw curatorAgentError("The run exceeded its step or tool-call budget.", "CURATOR_AGENT_STEP_BUDGET_EXCEEDED", 409);
    }
  }

  function callTool(toolName, args, summary) {
    checkpoint();
    if (!READ_ONLY_TOOL_SET.has(toolName)) {
      throw curatorAgentError("A non-whitelisted tool was requested.", "CURATOR_AGENT_TOOL_FORBIDDEN", 403);
    }
    const callStarted = readMonotonic();
    const rawResult = tools[toolName](deepFreeze(cloneJson(args)));
    if (rawResult && typeof rawResult.then === "function") {
      throw curatorAgentError("Curator tools must run synchronously.", "CURATOR_AGENT_ASYNC_TOOL_FORBIDDEN", 500);
    }
    // A synchronous callback cannot be pre-empted, so reject an over-budget
    // result immediately after it returns and before any receipt is stored.
    assertDuration();
    const result = sanitizeToolResult(toolName, rawResult, budgets.maxMemories);
    const resultJson = stableStringify(result);
    const callFinished = readMonotonic();
    assertDuration(callFinished);
    const byteLength = Buffer.byteLength(resultJson, "utf8");
    toolCalls += 1;
    resultBytes += byteLength;
    if (resultBytes > budgets.maxResultBytes) {
      throw curatorAgentError("The run exceeded its stored-result budget.", "CURATOR_AGENT_RESULT_BUDGET_EXCEEDED", 409);
    }
    const receipt = Object.freeze({
      position: receipts.length,
      toolName,
      args: cloneJson(args),
      result,
      resultSha256: sha256(resultJson),
      resultBytes: byteLength,
      durationMs: Math.max(0, Math.floor(callFinished - callStarted)),
      summary: cleanText(summary, MAX_STEP_SUMMARY)
    });
    receipts.push(receipt);
    onStep(receipt);
    if (shouldCancel()) throw curatorAgentError("The run was cancelled.", "CURATOR_AGENT_CANCELLED", 409);
    assertDuration();
    return { rawResult, result };
  }

  const search = callTool("search_memory_summaries", {
    query: request.query,
    memoryIds: [...request.memoryIds],
    limit: budgets.maxMemories
  }, "为本次策展挑选有界的记忆摘要。");
  const selectedIds = request.memoryIds.length
    ? [...request.memoryIds]
    : search.result.memories.map((memory) => memory.id).slice(0, budgets.maxMemories);
  if (selectedIds.length < 2) {
    throw curatorAgentError("At least two matching memories are required.", "CURATOR_AGENT_MEMORY_COUNT_INVALID", 409);
  }

  const evidence = callTool("read_memory_evidence", {
    memoryIds: selectedIds
  }, "只读提取所选记忆的有界证据片段。");
  const transientMemories = normalizeEvidenceMemories(evidence.rawResult, selectedIds, budgets.maxMemories);
  if (transientMemories.length < 2) {
    throw curatorAgentError("Selected source memories are missing or incomplete.", "CURATOR_AGENT_SOURCE_MISSING", 409);
  }

  const relationships = callTool("read_confirmed_relationships", {
    memoryIds: transientMemories.map((memory) => memory.id)
  }, "只读查看用户已经确认的记忆关系。");
  const exhibitions = callTool("read_exhibition_summaries", {
    memoryIds: transientMemories.map((memory) => memory.id)
  }, "只读查看已有展览摘要，避免重复策展。");

  const requestSha256 = buildCuratorRequestSha256(request);
  const proposal = buildCuratorProposal({
    request,
    requestSha256,
    memories: transientMemories,
    confirmedRelationships: relationships.result.relationships,
    exhibitionSummaries: exhibitions.result.exhibitions
  });
  const elapsedMs = assertDuration();
  return Object.freeze({
    proposal,
    steps: Object.freeze(receipts),
    usage: Object.freeze({
      steps: receipts.length,
      toolCalls,
      resultBytes,
      durationMs: elapsedMs
    })
  });
}

function buildCuratorProposal(input = {}) {
  const request = normalizeCuratorRunRequest(input.request);
  const requestSha256 = requireSha256(input.requestSha256 || buildCuratorRequestSha256(request), "requestSha256");
  const memories = normalizeProposalMemories(input.memories, DEFAULT_BUDGETS.maxMemories);
  const sourceRefs = memories.map((memory) => ({
    memoryId: memory.id,
    updatedAt: memory.updatedAt,
    rawSha256: memory.rawSha256
  })).sort((left, right) => left.memoryId.localeCompare(right.memoryId, "en"));
  const sourceSetSha256 = sha256(stableStringify(sourceRefs));
  const preview = buildExhibitionPreview(memories.map((memory) => ({
    id: memory.id,
    title: memory.title,
    rawContent: memory.rawExcerpt,
    exhibitText: memory.exhibitText,
    date: memory.date,
    location: memory.location,
    people: memory.people,
    tags: memory.tags,
    emotions: memory.emotions
  })), {
    title: request.title,
    theme: request.theme
  });
  normalizePreviewSelectionMetadata(preview);
  const relation = buildCandidateRelation(memories, input.confirmedRelationships);
  const actions = [
    {
      action: "save_exhibition",
      enabled: true,
      requiresConfirmation: true,
      effect: "create_draft_only"
    },
    {
      action: "confirm_relationship",
      enabled: Boolean(relation),
      requiresConfirmation: true,
      effect: "confirm_candidate_only"
    },
    {
      action: "publish_exhibition",
      enabled: true,
      requiresConfirmation: true,
      dependsOn: "save_exhibition",
      effect: "publish_saved_draft"
    }
  ];
  const content = {
    schemaVersion: CURATOR_AGENT_SCHEMA_VERSION,
    engineVersion: CURATOR_AGENT_ENGINE_VERSION,
    kind: "curator-agent-proposal",
    requestSha256,
    sourceSetSha256,
    sourceRefs,
    preview,
    relation,
    actions,
    duplicateContext: normalizeExhibitionContext(input.exhibitionSummaries)
  };
  return Object.freeze({
    ...content,
    proposalSha256: sha256(stableStringify(content))
  });
}

function evaluateCuratorAgentTrace(snapshot = {}) {
  const run = isPlainObject(snapshot.run) ? snapshot.run : {};
  const steps = Array.isArray(snapshot.steps) ? snapshot.steps : [];
  const proposal = isPlainObject(snapshot.proposal) ? snapshot.proposal : null;
  const budgets = normalizeFixedBudgets(run.budgets || DEFAULT_BUDGETS);
  const checks = [];
  const check = (name, passed, detail) => checks.push({ name, passed: Boolean(passed), detail: cleanText(detail, 240) });
  const readOnlySteps = steps.filter((step) => READ_ONLY_TOOL_SET.has(String(step?.toolName || "")));
  const internalSteps = steps.filter((step) => INTERNAL_STEP_SET.has(String(step?.toolName || "")));
  check("run-status", RUN_STATUS_SET.has(String(run.status || "")), "Run status is in the schema-14 state machine.");
  check("step-budget", steps.length <= budgets.maxSteps, `${steps.length}/${budgets.maxSteps} stored steps.`);
  check("tool-budget", readOnlySteps.length <= budgets.maxToolCalls, `${readOnlySteps.length}/${budgets.maxToolCalls} read-only tool receipts.`);
  check(
    "step-kind-whitelist",
    readOnlySteps.length + internalSteps.length === steps.length,
    "Every receipt is either one fixed read-only tool or a compatible bounded internal receipt."
  );
  const observedToolOrder = readOnlySteps.map((step) => String(step.toolName || ""));
  const expectedToolOrder = READ_ONLY_TOOL_NAMES.slice(0, observedToolOrder.length);
  check(
    "tool-order",
    stableStringify(observedToolOrder) === stableStringify(expectedToolOrder) && (!proposal || observedToolOrder.length === READ_ONLY_TOOL_NAMES.length),
    "Read-only tools appear at most once in the fixed order; a proposal requires all four."
  );
  check("step-order", steps.every((step, index) => Number(step.position) === index), "Receipt positions are contiguous.");
  const resultHashesValid = steps.every((step) => {
    try { return requireSha256(step.resultSha256, "resultSha256") === sha256(stableStringify(step.result)); } catch { return false; }
  });
  check("receipt-hashes", resultHashesValid, "Every bounded result matches its persisted SHA-256.");
  const resultBytes = steps.reduce((total, step) => total + Buffer.byteLength(stableStringify(step.result), "utf8"), 0);
  const receiptBytesValid = steps.every((step) => Number(step.resultBytes) === Buffer.byteLength(stableStringify(step.result), "utf8"));
  check("receipt-byte-counts", receiptBytesValid, "Every persisted result byte count matches its canonical JSON receipt.");
  check("result-budget", resultBytes <= budgets.maxResultBytes, `${resultBytes}/${budgets.maxResultBytes} persisted result bytes.`);
  const usage = isPlainObject(run.usage) ? run.usage : null;
  const stepDurationMs = steps.reduce((total, step) => total + Math.max(0, Number(step?.durationMs) || 0), 0);
  const usageDurationMs = Number(usage?.durationMs);
  check(
    "usage-closure",
    Boolean(usage) &&
      Number(usage.steps) === steps.length &&
      Number(usage.toolCalls) === readOnlySteps.length &&
      Number(usage.resultBytes) === resultBytes &&
      Number.isSafeInteger(usageDurationMs) && usageDurationMs >= stepDurationMs && usageDurationMs <= budgets.maxDurationMs,
    "Persisted steps, tool calls, result bytes, and duration close over the stored receipts and fixed budgets."
  );
  check("proposal-count", !proposal || isPlainObject(proposal), "The snapshot contains at most one proposal.");
  if (proposal) {
    const sourceRefs = Array.isArray(proposal.sourceRefs) ? proposal.sourceRefs : [];
    const sourceSetSha256 = sha256(stableStringify(sourceRefs.map(normalizeSourceRef).sort((a, b) => a.memoryId.localeCompare(b.memoryId, "en"))));
    check("source-bindings", sourceRefs.length >= 2 && sourceRefs.length <= budgets.maxMemories && sourceRefs.every(validSourceRef), "Each source is bound to memoryId, updatedAt, and raw SHA-256.");
    check("source-set-hash", sourceSetSha256 === proposal.sourceSetSha256, "The source-set hash is reproducible from persisted references.");
    const proposalContent = proposalContentForHash(proposal);
    check("proposal-determinism", sha256(stableStringify(proposalContent)) === proposal.proposalSha256, "The proposal hash is reproducible without reading tools again.");
    const actions = Array.isArray(proposal.actions) ? proposal.actions : [];
    check("approval-boundary", actions.length === 3 && actions.every((item) => CURATOR_ACTION_SET.has(String(item.action || "")) && item.requiresConfirmation === true), "Only the three explicit approval actions are present.");
    check("no-share-action", actions.every((item) => String(item.action || "") !== "share_exhibition"), "Sharing is not a backend action.");
    check("relation-limit", proposal.relation === null || (isPlainObject(proposal.relation) && proposal.relation.status === "candidate" && proposal.relation.requiresConfirmation === true), "There is at most one explicitly labelled relationship candidate.");
    const evidenceReceipt = steps.find((step) => step.toolName === "read_memory_evidence");
    const receiptRefs = Array.isArray(evidenceReceipt?.result?.memories)
      ? evidenceReceipt.result.memories.map((memory) => ({ memoryId: memory.id, updatedAt: memory.updatedAt, rawSha256: memory.rawSha256 })).sort((a, b) => a.memoryId.localeCompare(b.memoryId, "en"))
      : [];
    check("proposal-trace-binding", stableStringify(receiptRefs) === stableStringify(sourceRefs.map(normalizeSourceRef).sort((a, b) => a.memoryId.localeCompare(b.memoryId, "en"))), "Proposal references match the persisted evidence receipt.");
    let replayProposal = null;
    try {
      const relationshipReceipt = steps.find((step) => step.toolName === "read_confirmed_relationships");
      const exhibitionReceipt = steps.find((step) => step.toolName === "read_exhibition_summaries");
      replayProposal = buildCuratorProposal({
        request: run.request,
        requestSha256: run.requestSha256,
        memories: Array.isArray(evidenceReceipt?.result?.memories) ? evidenceReceipt.result.memories : [],
        confirmedRelationships: Array.isArray(relationshipReceipt?.result?.relationships) ? relationshipReceipt.result.relationships : [],
        exhibitionSummaries: Array.isArray(exhibitionReceipt?.result?.exhibitions) ? exhibitionReceipt.result.exhibitions : []
      });
    } catch {
      replayProposal = null;
    }
    const expectedRequestSha256 = run.historical
      ? buildHistoricalCuratorRequestSha256(run.request)
      : buildCuratorRequestSha256(run.request);
    check("request-binding", expectedRequestSha256 === run.requestSha256 && proposal.requestSha256 === run.requestSha256, "The persisted request, run digest, and proposal digest are bound together in the live or isolated historical domain.");
    const currentProposalContentSha256 = sha256(stableStringify(proposalContentForHash(proposal)));
    check("proposal-replay", Boolean(replayProposal) &&
      replayProposal.proposalSha256 === proposal.proposalSha256 &&
      replayProposal.proposalSha256 === currentProposalContentSha256,
    "The proposal is rebuilt from the persisted request and four bounded receipts without live reads.");
  }
  const traceMaterial = {
    run: {
      id: String(run.id || ""),
      requestSha256: String(run.requestSha256 || ""),
      status: String(run.status || ""),
      version: Number(run.version) || 0,
      budgets,
      usage: usage ? {
        steps: Number(usage.steps),
        toolCalls: Number(usage.toolCalls),
        resultBytes: Number(usage.resultBytes),
        durationMs: Number(usage.durationMs)
      } : null
    },
    steps: steps.map((step) => ({
      position: Number(step.position),
      toolName: String(step.toolName || ""),
      args: step.args,
      resultSha256: String(step.resultSha256 || "")
    })),
    proposalSha256: String(proposal?.proposalSha256 || "")
  };
  return Object.freeze({
    passed: checks.every((item) => item.passed),
    checks: Object.freeze(checks.map(Object.freeze)),
    traceSha256: sha256(stableStringify(traceMaterial)),
    engineVersion: CURATOR_AGENT_ENGINE_VERSION
  });
}

function curatorAgentEtag(run) {
  const id = requireId(run?.id, "run.id");
  const version = Number(run?.version);
  if (!Number.isSafeInteger(version) || version < 1) throw curatorAgentError("Run version is invalid.", "CURATOR_AGENT_VERSION_INVALID");
  return `"curator-agent-${id}-v${version}"`;
}

function buildCandidateRelation(memories, confirmedRelationships) {
  const confirmed = new Set((Array.isArray(confirmedRelationships) ? confirmedRelationships : []).map((item) => {
    const ids = [String(item?.memoryAId || item?.leftMemoryId || ""), String(item?.memoryBId || item?.rightMemoryId || "")].sort();
    return ids[0] && ids[1] ? ids.join("\0") : "";
  }).filter(Boolean));
  const candidates = [];
  for (let leftIndex = 0; leftIndex < memories.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < memories.length; rightIndex += 1) {
      const left = memories[leftIndex];
      const right = memories[rightIndex];
      const pairKey = [left.id, right.id].sort().join("\0");
      if (confirmed.has(pairKey)) continue;
      const basis = firstExactSharedBasis(left, right);
      if (!basis) continue;
      candidates.push({ left, right, basis, pairKey });
    }
  }
  candidates.sort((a, b) => a.pairKey.localeCompare(b.pairKey, "en") || a.basis.field.localeCompare(b.basis.field, "en") || a.basis.value.localeCompare(b.basis.value, "zh-CN"));
  const selected = candidates[0];
  if (!selected) return null;
  const basisLabel = RELATION_BASIS_LABELS[selected.basis.field] || "已记录线索";
  return {
    status: "candidate",
    relationType: "related_context",
    memoryAId: selected.left.id,
    memoryBId: selected.right.id,
    basis: selected.basis,
    rationale: `两件已保存记忆含有相同的${basisLabel}「${selected.basis.value}」，仅作为待确认候选。`,
    requiresConfirmation: true
  };
}

function firstExactSharedBasis(left, right) {
  const fields = [
    ["tag", left.tags, right.tags],
    ["person", left.people, right.people],
    ["location", left.location ? [left.location] : [], right.location ? [right.location] : []]
  ];
  for (const [field, leftValues, rightValues] of fields) {
    const rightMap = new Map(rightValues.map((value) => [canonical(value), value]));
    const match = [...leftValues].sort((a, b) => String(a).localeCompare(String(b), "zh-CN")).find((value) => rightMap.has(canonical(value)));
    if (match) return { field, value: cleanText(match, 80) };
  }
  return null;
}

function normalizeEvidenceMemories(rawResult, selectedIds, maximum) {
  const source = Array.isArray(rawResult) ? rawResult : Array.isArray(rawResult?.memories) ? rawResult.memories : [];
  const byId = new Map();
  source.forEach((memory) => {
    if (!isPlainObject(memory)) return;
    const id = safeId(memory.id || memory.memoryId);
    if (id && !byId.has(id)) byId.set(id, memory);
  });
  return selectedIds.slice(0, maximum).map((id) => byId.get(id)).filter(Boolean).map((memory) => {
    const id = requireId(memory.id || memory.memoryId, "memory.id");
    const rawContent = String(memory.rawContent ?? memory.raw_content ?? "");
    if (!rawContent.trim()) throw curatorAgentError(`Memory ${id} has no evidence text.`, "CURATOR_AGENT_SOURCE_EMPTY", 409);
    const rawSha256 = memory.rawSha256 ? requireSha256(memory.rawSha256, "memory.rawSha256") : sha256(rawContent);
    const rawExcerpt = rawContent.slice(0, MAX_TOOL_RESULT_EXCERPT);
    return {
      id,
      title: cleanText(memory.title, 120) || "Untitled memory",
      rawExcerpt,
      rawSha256,
      updatedAt: requireTimestamp(memory.updatedAt || memory.updated_at || memory.createdAt || memory.created_at),
      exhibitText: cleanText(memory.exhibitText ?? memory.exhibit_text, 500),
      date: cleanText(memory.date ?? memory.memoryDate ?? memory.memory_date, 40),
      location: cleanText(memory.location, 80),
      people: normalizeTextList(memory.people, 12, 40),
      tags: normalizeTextList(memory.tags, 12, 40),
      emotions: normalizeTextList(memory.emotions, 8, 30)
    };
  });
}

function normalizeProposalMemories(value, maximum) {
  if (!Array.isArray(value) || value.length < 2 || value.length > maximum) {
    throw curatorAgentError(`A proposal requires 2 to ${maximum} memories.`, "CURATOR_AGENT_MEMORY_COUNT_INVALID");
  }
  const seen = new Set();
  return value.map((memory) => {
    if (!isPlainObject(memory)) throw curatorAgentError("Proposal memory is invalid.", "CURATOR_AGENT_SOURCE_INVALID");
    const id = requireId(memory.id || memory.memoryId, "memory.id");
    if (seen.has(id)) throw curatorAgentError("Proposal memories must be unique.", "CURATOR_AGENT_SOURCE_DUPLICATE");
    seen.add(id);
    return {
      id,
      title: cleanText(memory.title, 120) || "Untitled memory",
      rawExcerpt: String(memory.rawExcerpt ?? memory.rawContent ?? "").slice(0, MAX_TOOL_RESULT_EXCERPT),
      rawSha256: requireSha256(memory.rawSha256, "memory.rawSha256"),
      updatedAt: requireTimestamp(memory.updatedAt),
      exhibitText: cleanText(memory.exhibitText, 500),
      date: cleanText(memory.date, 40),
      location: cleanText(memory.location, 80),
      people: normalizeTextList(memory.people, 12, 40),
      tags: normalizeTextList(memory.tags, 12, 40),
      emotions: normalizeTextList(memory.emotions, 8, 30)
    };
  });
}

function sanitizeToolResult(toolName, rawResult, maximum) {
  if (toolName === "search_memory_summaries") {
    const source = Array.isArray(rawResult) ? rawResult : Array.isArray(rawResult?.memories) ? rawResult.memories : [];
    return {
      memories: uniqueById(source, maximum).map((memory) => ({
        id: requireId(memory.id || memory.memoryId, "memory.id"),
        title: cleanText(memory.title, 120),
        summary: cleanText(memory.summary ?? memory.exhibitText ?? memory.exhibit_text, 320),
        updatedAt: optionalTimestamp(memory.updatedAt || memory.updated_at || memory.createdAt || memory.created_at)
      }))
    };
  }
  if (toolName === "read_memory_evidence") {
    const source = Array.isArray(rawResult) ? rawResult : Array.isArray(rawResult?.memories) ? rawResult.memories : [];
    return {
      memories: uniqueById(source, maximum).map((memory) => {
        const rawContent = String(memory.rawContent ?? memory.raw_content ?? "");
        return {
          id: requireId(memory.id || memory.memoryId, "memory.id"),
          title: cleanText(memory.title, 120),
          rawExcerpt: rawContent.slice(0, MAX_TOOL_RESULT_EXCERPT),
          rawSha256: memory.rawSha256 ? requireSha256(memory.rawSha256, "memory.rawSha256") : sha256(rawContent),
          updatedAt: requireTimestamp(memory.updatedAt || memory.updated_at || memory.createdAt || memory.created_at),
          exhibitText: cleanText(memory.exhibitText ?? memory.exhibit_text, 500),
          date: cleanText(memory.date ?? memory.memoryDate ?? memory.memory_date, 40),
          tags: normalizeTextList(memory.tags, 12, 40),
          people: normalizeTextList(memory.people, 12, 40),
          location: cleanText(memory.location, 80),
          emotions: normalizeTextList(memory.emotions, 8, 30)
        };
      })
    };
  }
  if (toolName === "read_confirmed_relationships") {
    const source = Array.isArray(rawResult) ? rawResult : Array.isArray(rawResult?.relationships) ? rawResult.relationships : [];
    return {
      relationships: source.slice(0, 30).map((item) => ({
        memoryAId: requireId(item.memoryAId || item.leftMemoryId, "relationship.memoryAId"),
        memoryBId: requireId(item.memoryBId || item.rightMemoryId, "relationship.memoryBId"),
        relationType: cleanText(item.relationType || item.decision || item.status, 40),
        confirmedAt: optionalTimestamp(item.confirmedAt || item.updatedAt || item.updated_at)
      })).filter((item) => item.memoryAId !== item.memoryBId)
    };
  }
  if (toolName === "read_exhibition_summaries") {
    const source = Array.isArray(rawResult) ? rawResult : Array.isArray(rawResult?.exhibitions) ? rawResult.exhibitions : [];
    return {
      exhibitions: source.slice(0, 20).map((item) => ({
        id: requireId(item.id, "exhibition.id"),
        title: cleanText(item.title, 120),
        status: ["draft", "published"].includes(String(item.status || "")) ? String(item.status) : "draft",
        memoryIds: normalizeIds(item.memoryIds, 12)
      }))
    };
  }
  throw curatorAgentError("A non-whitelisted tool result was provided.", "CURATOR_AGENT_TOOL_FORBIDDEN", 403);
}

function normalizeExhibitionContext(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).map((item) => ({
    id: requireId(item.id, "exhibition.id"),
    title: cleanText(item.title, 120),
    status: String(item.status || "draft"),
    memoryIds: normalizeIds(item.memoryIds, 12)
  }));
}

function normalizePreviewSelectionMetadata(preview) {
  const orderedIds = Array.isArray(preview?.memoryIds) ? preview.memoryIds : [];
  const grouping = Array.isArray(preview?.selection?.grouping) ? preview.selection.grouping : [];
  grouping.forEach((group) => {
    const memoryIds = Array.isArray(group.memoryIds) ? [...group.memoryIds] : [];
    const firstIndex = memoryIds.reduce((minimum, id) => {
      const index = orderedIds.indexOf(id);
      return index >= 0 ? Math.min(minimum, index) : minimum;
    }, orderedIds.length);
    group.basis = {
      type: String(group?.basis?.type || "selection"),
      value: String(group?.basis?.value || "用户选择"),
      count: memoryIds.length,
      firstIndex: firstIndex < orderedIds.length ? firstIndex : 0,
      memoryIds
    };
  });
  return preview;
}

function proposalContentForHash(proposal) {
  return {
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
  };
}

function normalizeFixedBudgets(value = {}) {
  const normalized = {};
  for (const [key, fixed] of Object.entries(DEFAULT_BUDGETS)) {
    const supplied = value?.[key];
    if (supplied !== undefined && Number(supplied) !== fixed) {
      throw curatorAgentError(`Budget ${key} is fixed at ${fixed}.`, "CURATOR_AGENT_BUDGET_INVALID");
    }
    normalized[key] = fixed;
  }
  return Object.freeze(normalized);
}

function normalizeTools(value) {
  if (!isPlainObject(value)) throw new TypeError("Curator-agent tools are required.");
  const unexpected = Object.keys(value).filter((name) => !READ_ONLY_TOOL_SET.has(name));
  if (unexpected.length) throw curatorAgentError(`Tool is not whitelisted: ${unexpected[0]}`, "CURATOR_AGENT_TOOL_FORBIDDEN", 403);
  const tools = {};
  for (const name of READ_ONLY_TOOL_NAMES) {
    if (typeof value[name] !== "function") throw new TypeError(`Curator-agent tool is required: ${name}`);
    tools[name] = value[name];
  }
  return Object.freeze(tools);
}

function normalizeSourceRef(value) {
  return {
    memoryId: String(value?.memoryId || ""),
    updatedAt: String(value?.updatedAt || ""),
    rawSha256: String(value?.rawSha256 || "")
  };
}

function validSourceRef(value) {
  try {
    requireId(value?.memoryId, "memoryId");
    requireTimestamp(value?.updatedAt);
    requireSha256(value?.rawSha256, "rawSha256");
    return true;
  } catch {
    return false;
  }
}

function normalizeIds(value, maximum) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > maximum) throw curatorAgentError(`memoryIds must contain at most ${maximum} ids.`, "CURATOR_AGENT_MEMORY_IDS_INVALID");
  const seen = new Set();
  return value.map((item) => requireId(item, "memoryId")).filter((id) => {
    if (seen.has(id)) throw curatorAgentError("memoryIds must be unique.", "CURATOR_AGENT_MEMORY_IDS_INVALID");
    seen.add(id);
    return true;
  });
}

function uniqueById(value, maximum) {
  const seen = new Set();
  const result = [];
  for (const item of value) {
    if (!isPlainObject(item)) continue;
    const id = safeId(item.id || item.memoryId);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(item);
    if (result.length >= maximum) break;
  }
  return result;
}

function normalizeTextList(value, maximum, itemLength) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const result = [];
  for (const item of value) {
    const text = cleanText(item, itemLength);
    const key = canonical(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
    if (result.length >= maximum) break;
  }
  return result;
}

function canonical(value) {
  return String(value || "").normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

function requireId(value, name) {
  const id = String(value || "").trim();
  if (!ID_PATTERN.test(id)) throw curatorAgentError(`${name} is invalid.`, "CURATOR_AGENT_ID_INVALID");
  return id;
}

function safeId(value) {
  const id = String(value || "").trim();
  return ID_PATTERN.test(id) ? id : "";
}

function requireSha256(value, name) {
  const hash = String(value || "").trim().toLowerCase();
  if (!SHA256_PATTERN.test(hash)) throw curatorAgentError(`${name} must be SHA-256.`, "CURATOR_AGENT_HASH_INVALID");
  return hash;
}

function requireTimestamp(value) {
  const timestamp = String(value || "").trim();
  if (!timestamp || Number.isNaN(Date.parse(timestamp))) throw curatorAgentError("Source timestamp is invalid.", "CURATOR_AGENT_TIMESTAMP_INVALID");
  return timestamp.slice(0, 40);
}

function optionalTimestamp(value) {
  const timestamp = String(value || "").trim();
  return timestamp && !Number.isNaN(Date.parse(timestamp)) ? timestamp.slice(0, 40) : "";
}

function cleanText(value, maximum) {
  const text = String(value || "").replace(/\s+/gu, " ").trim();
  return maximum && text.length > maximum ? text.slice(0, maximum) : text;
}

function assertExactKeys(value, allowed, label) {
  const allowedSet = new Set(allowed);
  const unexpected = Object.keys(value).filter((key) => !allowedSet.has(key));
  if (unexpected.length) throw curatorAgentError(`${label} contains an unsupported field: ${unexpected[0]}`, "CURATOR_AGENT_FIELD_SET_INVALID");
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

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function curatorAgentError(message, code, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

module.exports = {
  CURATOR_ACTIONS,
  CURATOR_AGENT_ENGINE_VERSION,
  CURATOR_AGENT_SCHEMA_VERSION,
  DEFAULT_BUDGETS,
  INTERNAL_STEP_NAMES,
  READ_ONLY_TOOL_NAMES,
  RUN_STATUSES,
  buildHistoricalCuratorRequestSha256,
  buildCuratorProposal,
  buildCuratorRequestSha256,
  curatorAgentError,
  curatorAgentEtag,
  evaluateCuratorAgentTrace,
  executeCuratorAgent,
  normalizeCuratorRunRequest,
  normalizeFixedBudgets,
  sha256,
  stableStringify
};
