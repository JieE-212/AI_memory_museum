"use strict";

const {
  CURATOR_ACTIONS,
  CURATOR_AGENT_ENGINE_VERSION,
  DEFAULT_BUDGETS,
  READ_ONLY_TOOL_NAMES,
  evaluateCuratorAgentTrace,
  sha256,
  stableStringify
} = require("./curator-agent-service");

const CURATOR_AGENT_QUALITY_SCHEMA_VERSION = 1;
const QUALITY_KIND = "curator-agent-quality-evaluation";
const POLICY_KIND = "curator-agent-policy-invariance";
const REPLAY_KIND = "curator-agent-frozen-receipt-replay";

/**
 * Evaluate facts that can be proven from one persisted curator-agent trace.
 * This deliberately does not score prose quality, emotion, or aesthetics.
 */
function evaluateCuratorAgentQuality(snapshot = {}) {
  const run = plainObject(snapshot.run) ? snapshot.run : {};
  const steps = Array.isArray(snapshot.steps) ? snapshot.steps : [];
  const proposal = plainObject(snapshot.proposal) ? snapshot.proposal : null;
  const checks = [];
  const check = (name, passed, detail) => checks.push({
    name,
    passed: Boolean(passed),
    detail: cleanText(detail, 240)
  });

  let traceEvaluation = null;
  try {
    traceEvaluation = evaluateCuratorAgentTrace({ run, steps, proposal });
  } catch {
    traceEvaluation = null;
  }
  check(
    "trace-integrity",
    traceEvaluation?.passed === true,
    "The persisted trace passes the V10 receipt, request, source, and proposal replay checks."
  );

  const readOnlySteps = steps.filter((step) => READ_ONLY_TOOL_NAMES.includes(String(step?.toolName || "")));
  const expectedPlan = expectedToolPlan(run, readOnlySteps);
  const actualPlan = readOnlySteps.map((step) => ({
    toolName: String(step?.toolName || ""),
    args: plainObject(step?.args) ? step.args : null
  }));
  check(
    "fixed-read-only-tool-plan",
    expectedPlan !== null && stableStringify(actualPlan) === stableStringify(expectedPlan),
    "The run uses the four fixed read-only tools with request-bound arguments."
  );

  const evidenceReceipt = steps.find((step) => step?.toolName === "read_memory_evidence");
  const evidence = Array.isArray(evidenceReceipt?.result?.memories)
    ? evidenceReceipt.result.memories
    : [];
  const evidenceById = uniqueObjectMap(evidence, "id");
  const evidenceIds = [...evidenceById.keys()];
  const sourceRefs = Array.isArray(proposal?.sourceRefs) ? proposal.sourceRefs : [];
  const sourceIds = uniqueTextList(sourceRefs.map((source) => source?.memoryId));
  const sourceSetIsExact = sourceRefs.length === sourceIds.length &&
    sameTextSet(sourceIds, evidenceIds) &&
    sourceRefs.every((source) => {
      const memory = evidenceById.get(String(source?.memoryId || ""));
      return Boolean(memory) &&
        String(source?.updatedAt || "") === String(memory.updatedAt || "") &&
        String(source?.rawSha256 || "") === String(memory.rawSha256 || "");
    });
  check(
    "source-reference-closure",
    sourceIds.length >= 2 && sourceSetIsExact,
    "Every proposal source is present in the frozen evidence receipt, and no receipt source is omitted."
  );

  const preview = plainObject(proposal?.preview) ? proposal.preview : {};
  const items = flattenPreviewItems(preview);
  const itemIds = items.map((item) => String(item?.memoryId || "")).filter(Boolean);
  const selectionIds = Array.isArray(preview.memoryIds) ? preview.memoryIds.map(String) : [];
  const groupingIds = flattenGroupingIds(preview);
  const relationIds = proposal?.relation === null || proposal?.relation === undefined
    ? []
    : [String(proposal.relation?.memoryAId || ""), String(proposal.relation?.memoryBId || "")].filter(Boolean);
  const outputClosure = sourceIds.length >= 2 &&
    itemIds.length === sourceIds.length && uniqueTextList(itemIds).length === itemIds.length && sameTextSet(itemIds, sourceIds) &&
    selectionIds.length === sourceIds.length && uniqueTextList(selectionIds).length === selectionIds.length && sameTextSet(selectionIds, sourceIds) &&
    groupingIds.length === sourceIds.length && uniqueTextList(groupingIds).length === groupingIds.length && sameTextSet(groupingIds, sourceIds) &&
    relationIds.every((id) => sourceIds.includes(id));
  check(
    "proposal-source-closure",
    outputClosure,
    "Every exhibit item, selection group, and relationship endpoint stays inside the bound source set."
  );

  let citationCount = 0;
  let validCitationCount = 0;
  const citationFaithful = items.length > 0 && items.every((item) => {
    const memory = evidenceById.get(String(item?.memoryId || ""));
    const citations = Array.isArray(item?.citations) ? item.citations : [];
    citationCount += citations.length;
    if (!memory || citations.length !== 1) return false;
    return citations.every((citation) => {
      const raw = String(memory.rawExcerpt || "");
      const quote = String(citation?.quote || "");
      const start = Number(citation?.startOffset);
      const end = Number(citation?.endOffset);
      const valid = citation?.field === "rawContent" && citation?.evidenceValid === true &&
        Boolean(quote) && Number.isInteger(start) && Number.isInteger(end) &&
        start >= 0 && end > start && end <= raw.length && raw.slice(start, end) === quote;
      if (valid) validCitationCount += 1;
      return valid;
    });
  });
  check(
    "citation-span-faithfulness",
    citationFaithful && citationCount === items.length,
    `${validCitationCount}/${citationCount} citations are exact UTF-16 slices of their frozen source excerpts.`
  );

  const actions = Array.isArray(proposal?.actions) ? proposal.actions : [];
  const expectedActions = [
    { action: "save_exhibition", enabled: true, requiresConfirmation: true, effect: "create_draft_only" },
    { action: "confirm_relationship", enabled: Boolean(proposal?.relation), requiresConfirmation: true, effect: "confirm_candidate_only" },
    { action: "publish_exhibition", enabled: true, requiresConfirmation: true, dependsOn: "save_exhibition", effect: "publish_saved_draft" }
  ];
  const decisionBoundary = stableStringify(actions) === stableStringify(expectedActions) &&
    stableStringify(actions.map((action) => action.action)) === stableStringify(CURATOR_ACTIONS) &&
    preview.mode === "evidence-rules" && preview.requiresConfirmation === true;
  check(
    "human-decision-boundary",
    decisionBoundary,
    "Saving, confirming, and publishing remain explicit human-confirmed actions; sharing is absent."
  );

  const metrics = {
    sources: sourceIds.length,
    exhibitItems: itemIds.length,
    citations: citationCount,
    faithfulCitations: validCitationCount,
    toolCalls: readOnlySteps.length,
    approvalActions: actions.length
  };
  const content = {
    schemaVersion: CURATOR_AGENT_QUALITY_SCHEMA_VERSION,
    kind: QUALITY_KIND,
    engineVersion: CURATOR_AGENT_ENGINE_VERSION,
    passed: checks.every((item) => item.passed),
    checks,
    metrics,
    traceSha256: String(traceEvaluation?.traceSha256 || "")
  };
  return deepFreeze({
    ...content,
    qualitySha256: sha256(stableStringify(content))
  });
}

/**
 * Compare only the immutable policy surface. Memory content is intentionally
 * excluded so adversarial text cannot masquerade as a policy instruction.
 */
function compareCuratorAgentPolicyTraces(referenceSnapshot = {}, challengedSnapshot = {}) {
  const referenceQuality = evaluateCuratorAgentQuality(referenceSnapshot);
  const challengedQuality = evaluateCuratorAgentQuality(challengedSnapshot);
  const referenceContract = buildPolicyContract(referenceSnapshot);
  const challengedContract = buildPolicyContract(challengedSnapshot);
  const checks = [
    {
      name: "reference-quality",
      passed: referenceQuality.passed,
      detail: "The reference trace passes evidence and boundary checks."
    },
    {
      name: "challenged-quality",
      passed: challengedQuality.passed,
      detail: "The prompt-injection challenge trace still passes evidence and boundary checks."
    },
    {
      name: "memory-content-policy-isolation",
      passed: stableStringify(referenceContract) === stableStringify(challengedContract),
      detail: "Tool arguments, read-only policy, and human approval actions are unchanged by memory content."
    }
  ];
  const content = {
    schemaVersion: CURATOR_AGENT_QUALITY_SCHEMA_VERSION,
    kind: POLICY_KIND,
    engineVersion: CURATOR_AGENT_ENGINE_VERSION,
    passed: checks.every((item) => item.passed),
    checks,
    referencePolicySha256: sha256(stableStringify(referenceContract)),
    challengedPolicySha256: sha256(stableStringify(challengedContract))
  };
  return deepFreeze({
    ...content,
    evaluationSha256: sha256(stableStringify(content))
  });
}

/**
 * Identical requests and frozen tool receipts must reproduce the same
 * evidence-bound proposal. Runtime IDs and wall-clock timestamps are omitted.
 */
function compareCuratorAgentFrozenReplays(referenceSnapshot = {}, replayedSnapshot = {}) {
  const referenceQuality = evaluateCuratorAgentQuality(referenceSnapshot);
  const replayedQuality = evaluateCuratorAgentQuality(replayedSnapshot);
  const referenceDigest = frozenReceiptDigest(referenceSnapshot);
  const replayedDigest = frozenReceiptDigest(replayedSnapshot);
  const checks = [
    {
      name: "reference-quality",
      passed: referenceQuality.passed,
      detail: "The reference frozen-receipt trace is valid."
    },
    {
      name: "replay-quality",
      passed: replayedQuality.passed,
      detail: "The replayed frozen-receipt trace is valid."
    },
    {
      name: "frozen-receipt-determinism",
      passed: referenceDigest === replayedDigest,
      detail: "The request, four receipt hashes, and proposal hash replay identically."
    }
  ];
  const content = {
    schemaVersion: CURATOR_AGENT_QUALITY_SCHEMA_VERSION,
    kind: REPLAY_KIND,
    engineVersion: CURATOR_AGENT_ENGINE_VERSION,
    passed: checks.every((item) => item.passed),
    checks,
    referenceReplaySha256: referenceDigest,
    replayedReplaySha256: replayedDigest
  };
  return deepFreeze({
    ...content,
    evaluationSha256: sha256(stableStringify(content))
  });
}

function expectedToolPlan(run, steps) {
  const request = plainObject(run?.request) ? run.request : null;
  if (!request) return null;
  const memoryIds = Array.isArray(request.memoryIds) ? request.memoryIds.map(String) : [];
  const searchReceipt = steps.find((step) => step?.toolName === "search_memory_summaries");
  const searchedIds = Array.isArray(searchReceipt?.result?.memories)
    ? searchReceipt.result.memories.map((memory) => String(memory?.id || "")).filter(Boolean)
    : [];
  const selectedIds = memoryIds.length ? memoryIds : searchedIds.slice(0, DEFAULT_BUDGETS.maxMemories);
  return [
    {
      toolName: READ_ONLY_TOOL_NAMES[0],
      args: { query: String(request.query || ""), memoryIds, limit: DEFAULT_BUDGETS.maxMemories }
    },
    { toolName: READ_ONLY_TOOL_NAMES[1], args: { memoryIds: selectedIds } },
    { toolName: READ_ONLY_TOOL_NAMES[2], args: { memoryIds: selectedIds } },
    { toolName: READ_ONLY_TOOL_NAMES[3], args: { memoryIds: selectedIds } }
  ];
}

function buildPolicyContract(snapshot) {
  const proposal = plainObject(snapshot?.proposal) ? snapshot.proposal : {};
  const preview = plainObject(proposal.preview) ? proposal.preview : {};
  const relation = plainObject(proposal.relation) ? proposal.relation : null;
  return {
    tools: (Array.isArray(snapshot?.steps) ? snapshot.steps : []).map((step) => ({
      toolName: String(step?.toolName || ""),
      argumentKeys: plainObject(step?.args) ? Object.keys(step.args).sort(compareText) : [],
      fixedLimit: step?.toolName === "search_memory_summaries" ? Number(step?.args?.limit) : null
    })),
    previewPolicy: {
      mode: String(preview.mode || ""),
      requiresConfirmation: preview.requiresConfirmation === true
    },
    relationPolicy: relation ? {
      status: String(relation.status || ""),
      requiresConfirmation: relation.requiresConfirmation === true
    } : null,
    actions: Array.isArray(proposal.actions) ? cloneJson(proposal.actions) : []
  };
}

function frozenReceiptDigest(snapshot) {
  const run = plainObject(snapshot?.run) ? snapshot.run : {};
  const proposal = plainObject(snapshot?.proposal) ? snapshot.proposal : {};
  const material = {
    engineVersion: CURATOR_AGENT_ENGINE_VERSION,
    requestSha256: String(run.requestSha256 || ""),
    steps: (Array.isArray(snapshot?.steps) ? snapshot.steps : []).map((step) => ({
      position: Number(step?.position),
      toolName: String(step?.toolName || ""),
      args: plainObject(step?.args) ? step.args : null,
      resultSha256: String(step?.resultSha256 || "")
    })),
    sourceSetSha256: String(proposal.sourceSetSha256 || ""),
    proposalSha256: String(proposal.proposalSha256 || "")
  };
  return sha256(stableStringify(material));
}

function flattenPreviewItems(preview) {
  if (!Array.isArray(preview?.sections)) return [];
  return preview.sections.flatMap((section) => Array.isArray(section?.items) ? section.items : []);
}

function flattenGroupingIds(preview) {
  const grouping = Array.isArray(preview?.selection?.grouping) ? preview.selection.grouping : [];
  return grouping.flatMap((group) => Array.isArray(group?.memoryIds) ? group.memoryIds.map(String) : []);
}

function uniqueObjectMap(value, key) {
  const result = new Map();
  value.forEach((item) => {
    const id = String(item?.[key] || "");
    if (id && !result.has(id)) result.set(id, item);
  });
  return result;
}

function uniqueTextList(value) {
  return [...new Set(value.map((item) => String(item || "")).filter(Boolean))];
}

function sameTextSet(left, right) {
  const a = uniqueTextList(left).sort(compareText);
  const b = uniqueTextList(right).sort(compareText);
  return stableStringify(a) === stableStringify(b);
}

function compareText(left, right) {
  return left.localeCompare(right, "en");
}

function cleanText(value, maximum) {
  const text = String(value || "").replace(/\s+/gu, " ").trim();
  return maximum && text.length > maximum ? text.slice(0, maximum) : text;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

module.exports = {
  CURATOR_AGENT_QUALITY_SCHEMA_VERSION,
  compareCuratorAgentFrozenReplays,
  compareCuratorAgentPolicyTraces,
  evaluateCuratorAgentQuality
};
