"use strict";

const {
  CURATOR_AGENT_ENGINE_VERSION,
  CURATOR_AGENT_SCHEMA_VERSION,
  DEFAULT_BUDGETS,
  buildCuratorProposal,
  buildCuratorRequestSha256,
  curatorAgentEtag,
  evaluateCuratorAgentTrace,
  normalizeCuratorRunRequest,
  sha256,
  stableStringify
} = require("./curator-agent-service");

const BASE_PATH = "/api/curator-agent";
const RUNS_PATH = `${BASE_PATH}/runs`;
const RUN_PATH = /^\/api\/curator-agent\/runs\/([a-zA-Z0-9_-]{1,120})$/u;
const RUN_ACTION_PATH = /^\/api\/curator-agent\/runs\/([a-zA-Z0-9_-]{1,120})\/(execute|cancel|evaluation|decisions)$/u;

function createCuratorAgentApi(options = {}) {
  const store = options.store || options.database;
  const sendJson = options.sendJson;
  const readJsonBody = options.readJsonBody;
  const makeHttpError = options.httpError;
  const interviewDemo = Boolean(options.interviewDemo);
  assertDependencies({ store, sendJson, readJsonBody, makeHttpError, interviewDemo });

  async function handle(request, response, url) {
    const pathname = String(url?.pathname || "");
    if (!pathname.startsWith(`${BASE_PATH}/`) && pathname !== BASE_PATH) return false;
    try {
      if (interviewDemo && !["GET", "HEAD"].includes(String(request.method || "GET"))) {
        const error = curatorApiError(403, "CURATOR_AGENT_DEMO_READ_ONLY", "The public Demo only shows a synthetic curator-agent workspace and never writes private data.");
        error.interviewDemo = true;
        throw error;
      }
      if (pathname === `${BASE_PATH}/sample`) {
        assertNoQuery(url, "sample");
        if (request.method !== "GET") throw methodNotAllowed("GET");
        return respondWorkspace(response, 200, createCuratorAgentSample(), { demo: interviewDemo, synthetic: true });
      }
      if (pathname === RUNS_PATH) return handleRuns(request, response, url);
      const actionMatch = pathname.match(RUN_ACTION_PATH);
      if (actionMatch) return handleRunAction(request, response, url, actionMatch[1], actionMatch[2]);
      const runMatch = pathname.match(RUN_PATH);
      if (runMatch) return handleRun(request, response, url, runMatch[1]);
      throw curatorApiError(400, "CURATOR_AGENT_PATH_INVALID", "Curator-agent target path is invalid.");
    } catch (error) {
      throw normalizeApiError(error, makeHttpError);
    }
  }

  async function handleRuns(request, response, url) {
    if (request.method === "GET") {
      const limit = parseListQuery(url);
      if (interviewDemo) return sendJson(response, 200, { runs: [], demo: true });
      return sendJson(response, 200, {
        runs: store.listCuratorAgentRuns({ limit }).map(publicRunSummary),
        demo: false
      });
    }
    assertNoQuery(url, "run creation");
    if (request.method !== "POST") throw methodNotAllowed("GET, POST");
    const idempotencyKey = requireIdempotencyHeader(request);
    const body = await readJsonBody(request);
    const result = store.createCuratorAgentRun(body, { idempotencyKey });
    return respondWorkspace(response, result.created ? 201 : 200, result.workspace, {
      ok: true,
      idempotent: Boolean(result.idempotent)
    });
  }

  async function handleRun(request, response, url, runId) {
    assertNoQuery(url, "run");
    if (request.method === "GET") {
      if (interviewDemo) throw curatorApiError(404, "CURATOR_AGENT_RUN_NOT_FOUND", "Curator-agent run was not found.");
      const workspace = requireWorkspace(store.getCuratorAgentRunWorkspace(runId));
      return respondWorkspace(response, 200, workspace);
    }
    if (request.method === "DELETE") {
      // Parse the run-bound ETag without pre-reading the workspace so an exact
      // retry can reach the database's minimal deletion tombstone.
      const expectedVersion = requireIfMatchVersion(request, { id: runId });
      const idempotencyKey = requireIdempotencyHeader(request);
      const body = await readJsonBody(request);
      assertConfirmOnlyBody(body, "delete");
      const result = store.deleteCuratorAgentRun(runId, {
        confirm: true,
        expectedVersion,
        idempotencyKey
      });
      return sendJson(response, 200, { ok: true, deleted: Boolean(result.deleted), idempotent: Boolean(result.idempotent) });
    }
    throw methodNotAllowed("GET, DELETE");
  }

  async function handleRunAction(request, response, url, runId, action) {
    assertNoQuery(url, `run ${action}`);
    if (action === "evaluation") {
      if (request.method !== "GET") throw methodNotAllowed("GET");
      if (interviewDemo) throw curatorApiError(404, "CURATOR_AGENT_RUN_NOT_FOUND", "Curator-agent run was not found.");
      const workspace = requireWorkspace(store.getCuratorAgentRunWorkspace(runId));
      const etag = curatorAgentEtag(workspace.run);
      response?.setHeader?.("ETag", etag);
      return sendJson(response, 200, {
        runId,
        evaluation: store.evaluateCuratorAgentRun(runId),
        etag,
        demo: false
      });
    }
    if (request.method !== "POST") throw methodNotAllowed("POST");
    const current = requireWorkspace(store.getCuratorAgentRunWorkspace(runId));
    const expectedVersion = requireIfMatchVersion(request, current.run);
    const idempotencyKey = requireIdempotencyHeader(request);
    const body = await readJsonBody(request);
    if (action === "execute") {
      assertConfirmOnlyBody(body, "execute");
      const result = store.executeCuratorAgentRun(runId, { confirm: true, expectedVersion, idempotencyKey });
      return respondWorkspace(response, 200, result.workspace, {
        ok: true,
        executed: Boolean(result.executed),
        idempotent: Boolean(result.idempotent)
      });
    }
    if (action === "cancel") {
      assertConfirmOnlyBody(body, "cancel");
      const result = store.cancelCuratorAgentRun(runId, { confirm: true, expectedVersion, idempotencyKey });
      return respondWorkspace(response, 200, result.workspace, {
        ok: true,
        cancelled: Boolean(result.cancelled),
        idempotent: Boolean(result.idempotent)
      });
    }
    if (action === "decisions") {
      const result = store.decideCuratorAgentRun(runId, body, { expectedVersion, idempotencyKey });
      return respondWorkspace(response, result.decided ? 201 : 200, result.workspace, {
        ok: true,
        decided: Boolean(result.decided),
        idempotent: Boolean(result.idempotent)
      });
    }
    throw curatorApiError(400, "CURATOR_AGENT_ACTION_INVALID", "Curator-agent action is invalid.");
  }

  function respondWorkspace(response, statusCode, workspace, extra = {}) {
    const normalized = requireWorkspace(workspace);
    const etag = curatorAgentEtag(normalized.run);
    response?.setHeader?.("ETag", etag);
    return sendJson(response, statusCode, {
      ...extra,
      ...publicWorkspace(normalized, interviewDemo),
      etag
    });
  }

  return Object.freeze({ handle });
}

function publicWorkspace(workspace, demo = false) {
  const run = publicRun(workspace.run);
  const proposal = workspace.proposal ? publicProposal(workspace.proposal) : null;
  return {
    run,
    steps: (Array.isArray(workspace.steps) ? workspace.steps : []).slice(0, DEFAULT_BUDGETS.maxSteps).map(publicStep),
    proposal,
    decisions: (Array.isArray(workspace.decisions) ? workspace.decisions : []).slice(0, 3).map(publicDecision),
    freshness: {
      status: run.needsReview ? "needs_review" : proposal ? "bound" : "not_applicable",
      sourceSetSha256: String(proposal?.sourceSetSha256 || "")
    },
    demo: Boolean(demo),
    synthetic: Boolean(workspace.synthetic)
  };
}

function publicRun(run) {
  return {
    id: String(run?.id || ""),
    schemaVersion: Number(run?.schemaVersion) || CURATOR_AGENT_SCHEMA_VERSION,
    requestSha256: String(run?.requestSha256 || ""),
    request: isPlainObject(run?.request) ? run.request : {},
    status: String(run?.status || ""),
    version: Number(run?.version) || 1,
    budgets: { ...DEFAULT_BUDGETS, ...(isPlainObject(run?.budgets) ? run.budgets : {}) },
    usage: {
      steps: Number(run?.usage?.steps) || 0,
      toolCalls: Number(run?.usage?.toolCalls) || 0,
      resultBytes: Number(run?.usage?.resultBytes) || 0,
      durationMs: Number(run?.usage?.durationMs) || 0
    },
    historical: Boolean(run?.historical),
    needsReview: Boolean(run?.needsReview),
    allowDecisions: Boolean(run?.allowDecisions),
    createdAt: String(run?.createdAt || ""),
    startedAt: String(run?.startedAt || ""),
    updatedAt: String(run?.updatedAt || ""),
    completedAt: String(run?.completedAt || ""),
    cancelledAt: String(run?.cancelledAt || ""),
    interruptedAt: String(run?.interruptedAt || ""),
    failedAt: String(run?.failedAt || ""),
    failureCode: String(run?.failureCode || ""),
    failureMessage: String(run?.failureMessage || "")
  };
}

function publicRunSummary(run) {
  const normalized = publicRun(run);
  return {
    id: normalized.id,
    status: normalized.status,
    version: normalized.version,
    query: String(normalized.request.query || ""),
    memoryIds: Array.isArray(normalized.request.memoryIds) ? normalized.request.memoryIds : [],
    historical: normalized.historical,
    needsReview: normalized.needsReview,
    allowDecisions: normalized.allowDecisions,
    createdAt: normalized.createdAt,
    updatedAt: normalized.updatedAt,
    completedAt: normalized.completedAt
  };
}

function publicStep(step) {
  return {
    id: String(step?.id || ""),
    runId: String(step?.runId || ""),
    position: Number(step?.position) || 0,
    toolName: String(step?.toolName || ""),
    args: isPlainObject(step?.args) ? step.args : {},
    result: isPlainObject(step?.result) ? step.result : {},
    resultSha256: String(step?.resultSha256 || ""),
    resultBytes: Number(step?.resultBytes) || 0,
    durationMs: Number(step?.durationMs) || 0,
    summary: String(step?.summary || ""),
    createdAt: String(step?.createdAt || "")
  };
}

function publicProposal(proposal) {
  return {
    id: String(proposal?.id || ""),
    runId: String(proposal?.runId || ""),
    schemaVersion: Number(proposal?.schemaVersion) || CURATOR_AGENT_SCHEMA_VERSION,
    engineVersion: String(proposal?.engineVersion || ""),
    kind: String(proposal?.kind || ""),
    requestSha256: String(proposal?.requestSha256 || ""),
    proposalSha256: String(proposal?.proposalSha256 || ""),
    sourceSetSha256: String(proposal?.sourceSetSha256 || ""),
    sourceRefs: Array.isArray(proposal?.sourceRefs) ? proposal.sourceRefs.slice(0, DEFAULT_BUDGETS.maxMemories) : [],
    preview: isPlainObject(proposal?.preview) ? proposal.preview : {},
    relation: isPlainObject(proposal?.relation) ? proposal.relation : null,
    actions: Array.isArray(proposal?.actions) ? proposal.actions.slice(0, 3) : [],
    duplicateContext: Array.isArray(proposal?.duplicateContext) ? proposal.duplicateContext.slice(0, 20) : [],
    createdAt: String(proposal?.createdAt || "")
  };
}

function publicDecision(decision) {
  return {
    id: String(decision?.id || ""),
    runId: String(decision?.runId || ""),
    action: String(decision?.action || ""),
    decision: String(decision?.decision || ""),
    requestSha256: String(decision?.requestSha256 || ""),
    outcome: isPlainObject(decision?.outcome) ? decision.outcome : {},
    createdAt: String(decision?.createdAt || "")
  };
}

function createCuratorAgentSample() {
  const createdAt = "2026-01-01T00:00:00.000Z";
  const request = normalizeCuratorRunRequest({
    intent: "draft_exhibition",
    query: "两件校园记忆里的共同线索",
    memoryIds: ["demo-memory-one", "demo-memory-two"],
    theme: "校园一角"
  });
  const requestSha256 = buildCuratorRequestSha256(request);
  const memories = [
    {
      id: "demo-memory-one",
      title: "下课后的旧公告栏",
      rawExcerpt: "下课后，我们在旧公告栏旁碰面，又把那张纸票夹进了笔记本。",
      rawSha256: sha256("下课后，我们在旧公告栏旁碰面，又把那张纸票夹进了笔记本。"),
      updatedAt: createdAt,
      exhibitText: "公告栏旁被留存下来的一小段校园日常。",
      date: "",
      location: "旧公告栏",
      people: [],
      tags: ["校园"],
      emotions: []
    },
    {
      id: "demo-memory-two",
      title: "公告栏旁的一张照片",
      rawExcerpt: "照片里还是那块旧公告栏，上面留着两张尚未揭下的手写便签。",
      rawSha256: sha256("照片里还是那块旧公告栏，上面留着两张尚未揭下的手写便签。"),
      updatedAt: createdAt,
      exhibitText: "同一个校园角落留下的另一种证据。",
      date: "",
      location: "旧公告栏",
      people: [],
      tags: ["校园"],
      emotions: []
    }
  ];
  const proposalCore = buildCuratorProposal({
    request,
    requestSha256,
    memories,
    confirmedRelationships: [],
    exhibitionSummaries: []
  });
  const stepResults = [
    { memories: memories.map((memory) => ({ id: memory.id, title: memory.title, summary: memory.exhibitText, updatedAt: memory.updatedAt })) },
    { memories: memories.map((memory) => ({
      id: memory.id,
      title: memory.title,
      rawExcerpt: memory.rawExcerpt,
      rawSha256: memory.rawSha256,
      updatedAt: memory.updatedAt,
      exhibitText: memory.exhibitText,
      date: memory.date,
      tags: memory.tags,
      people: memory.people,
      location: memory.location,
      emotions: memory.emotions
    })) },
    { relationships: [] },
    { exhibitions: [] }
  ];
  const toolNames = [
    "search_memory_summaries",
    "read_memory_evidence",
    "read_confirmed_relationships",
    "read_exhibition_summaries"
  ];
  const steps = stepResults.map((result, position) => ({
    id: `curator-demo-step-${position + 1}`,
    runId: "curator-demo-sample",
    position,
    toolName: toolNames[position],
    args: position === 0 ? { query: request.query, memoryIds: request.memoryIds, limit: 6 } : { memoryIds: request.memoryIds },
    result,
    resultSha256: sha256(stableStringify(result)),
    resultBytes: Buffer.byteLength(stableStringify(result), "utf8"),
    durationMs: 0,
    summary: [
      "为本次策展挑选有界的记忆摘要。",
      "只读提取所选记忆的有界证据片段。",
      "只读查看用户已经确认的记忆关系。",
      "只读查看已有展览摘要，避免重复策展。"
    ][position],
    createdAt
  }));
  const run = {
    id: "curator-demo-sample",
    schemaVersion: CURATOR_AGENT_SCHEMA_VERSION,
    idempotencyKey: "synthetic-demo-only",
    requestSha256,
    request,
    status: "completed",
    version: 1,
    budgets: DEFAULT_BUDGETS,
    usage: {
      steps: 4,
      toolCalls: 4,
      resultBytes: steps.reduce((total, step) => total + step.resultBytes, 0),
      durationMs: 0
    },
    historical: false,
    needsReview: false,
    allowDecisions: false,
    createdAt,
    startedAt: createdAt,
    updatedAt: createdAt,
    completedAt: createdAt,
    cancelledAt: "",
    interruptedAt: "",
    failedAt: "",
    failureCode: "",
    failureMessage: ""
  };
  const workspace = {
    run,
    steps,
    proposal: {
      id: "curator-demo-proposal",
      runId: run.id,
      ...proposalCore,
      createdAt
    },
    decisions: [],
    synthetic: true
  };
  workspace.evaluation = evaluateCuratorAgentTrace(workspace);
  return workspace;
}

function requireIfMatchVersion(request, run) {
  const supplied = String(request?.headers?.["if-match"] || request?.headers?.get?.("if-match") || "").trim();
  if (!supplied) throw curatorApiError(428, "CURATOR_AGENT_PRECONDITION_REQUIRED", "If-Match is required.");
  const escapedId = String(run.id).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = supplied.match(new RegExp(`^"curator-agent-${escapedId}-v([1-9]\\d*)"$`, "u"));
  if (!match) throw curatorApiError(412, "CURATOR_AGENT_VERSION_CONFLICT", "The curator-agent run changed; refresh before continuing.");
  return Number(match[1]);
}

function requireIdempotencyHeader(request) {
  const value = String(request?.headers?.["idempotency-key"] || request?.headers?.get?.("idempotency-key") || "").trim();
  if (!value) throw curatorApiError(400, "CURATOR_AGENT_IDEMPOTENCY_KEY_INVALID", "Idempotency-Key is required.");
  return value;
}

function assertConfirmOnlyBody(body, operation) {
  if (!isPlainObject(body) || Object.keys(body).length !== 1 || body.confirm !== true) {
    throw curatorApiError(400, "CURATOR_AGENT_FIELD_SET_INVALID", `${operation} requires the exact body { confirm: true }.`);
  }
}

function parseListQuery(url) {
  const keys = [...url.searchParams.keys()];
  if (keys.some((key) => key !== "limit") || keys.filter((key) => key === "limit").length > 1) {
    throw curatorApiError(400, "CURATOR_AGENT_QUERY_INVALID", "Run listing only accepts one limit parameter.");
  }
  if (!url.searchParams.has("limit")) return 20;
  const value = url.searchParams.get("limit");
  if (!/^[1-9]\d*$/u.test(String(value || "")) || Number(value) > 100) {
    throw curatorApiError(400, "CURATOR_AGENT_QUERY_INVALID", "limit must be an integer from 1 to 100.");
  }
  return Number(value);
}

function assertNoQuery(url, label) {
  if ([...url.searchParams.keys()].length) throw curatorApiError(400, "CURATOR_AGENT_QUERY_INVALID", `${label} does not accept query parameters.`);
}

function requireWorkspace(workspace) {
  if (!workspace?.run) throw curatorApiError(404, "CURATOR_AGENT_RUN_NOT_FOUND", "Curator-agent run was not found.");
  return workspace;
}

function methodNotAllowed(allow) {
  const error = curatorApiError(405, "CURATOR_AGENT_METHOD_NOT_ALLOWED", `Method not allowed. Expected ${allow}.`);
  error.allow = allow;
  return error;
}

function normalizeApiError(error, makeHttpError) {
  const code = String(error?.code || "");
  if (!code.startsWith("CURATOR_AGENT_") && error?.statusCode) return error;
  if (code.startsWith("CURATOR_AGENT_") || error instanceof TypeError || error instanceof RangeError) {
    const wrapped = makeHttpError(Number(error?.statusCode) || 400, error?.message || "Curator-agent request failed.");
    if (code) wrapped.code = code;
    if (error?.interviewDemo) wrapped.interviewDemo = true;
    if (error?.memoryId) wrapped.memoryId = error.memoryId;
    if (error?.allow) wrapped.allow = error.allow;
    return wrapped;
  }
  return error;
}

function assertDependencies({ store, sendJson, readJsonBody, makeHttpError, interviewDemo }) {
  const methods = [
    "createCuratorAgentRun", "executeCuratorAgentRun", "cancelCuratorAgentRun",
    "decideCuratorAgentRun", "getCuratorAgentRunWorkspace", "listCuratorAgentRuns",
    "evaluateCuratorAgentRun", "deleteCuratorAgentRun"
  ];
  if ((!interviewDemo && (!store || methods.some((name) => typeof store[name] !== "function"))) ||
      typeof sendJson !== "function" || typeof readJsonBody !== "function" || typeof makeHttpError !== "function") {
    throw new TypeError("Curator-agent API dependencies are required.");
  }
}

function curatorApiError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

module.exports = {
  BASE_PATH,
  createCuratorAgentApi,
  createCuratorAgentSample,
  publicDecision,
  publicProposal,
  publicRun,
  publicRunSummary,
  publicStep,
  publicWorkspace
};
