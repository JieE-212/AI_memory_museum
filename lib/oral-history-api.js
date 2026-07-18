"use strict";

const { createHash } = require("node:crypto");

const EVENT_PATH = /^\/api\/oral-histories\/events\/([a-zA-Z0-9_-]{1,120})$/u;

function createOralHistoryApi(options = {}) {
  const store = options.store;
  const sendJson = options.sendJson;
  const readJsonBody = options.readJsonBody;
  const makeHttpError = options.httpError;
  const interviewDemo = Boolean(options.interviewDemo);
  assertDependencies({ store, sendJson, readJsonBody, makeHttpError });

  async function handle(request, response, url) {
    const match = String(url?.pathname || "").match(EVENT_PATH);
    if (!match) {
      if (String(url?.pathname || "").startsWith("/api/oral-histories/")) {
        throw makeHttpError(400, "Oral-history target path is invalid.");
      }
      return false;
    }
    try {
      if ([...url.searchParams.keys()].length) throw oralApiError(400, "ORAL_HISTORY_QUERY_INVALID", "口述史事件接口不接受查询参数。");
      const eventId = match[1];
      if (request.method === "GET") return respondWorkspace(response, 200, store.getOralHistoryEventWorkspace(eventId));
      if (request.method !== "PUT" && request.method !== "DELETE") {
        throw oralApiError(405, "ORAL_HISTORY_METHOD_NOT_ALLOWED", "口述史事件接口仅支持 GET、PUT 与 DELETE。");
      }
      if (interviewDemo) {
        const error = oralApiError(403, "ORAL_HISTORY_DEMO_READ_ONLY", "公开 Demo 只展示口述史，不保存私人声音、文字稿或时间判断。");
        error.interviewDemo = true;
        throw error;
      }
      const current = store.getOralHistoryEventWorkspace(eventId);
      const suppliedEtag = requireIfMatchHeader(request);
      const body = await readJsonBody(request);
      const currentEtag = oralHistoryEtag(current);
      if (suppliedEtag !== currentEtag) {
        if (request.method === "PUT" && store.isOralHistorySubmissionReplay(eventId, body)) {
          return respondWorkspace(response, 200, current, { ok: true, idempotent: true });
        }
        throw oralApiError(412, "ORAL_HISTORY_VERSION_CONFLICT", "口述史已经变化，请刷新后再继续。");
      }
      if (request.method === "PUT") {
        const result = store.saveOralHistoryAnswer(eventId, body);
        return respondWorkspace(response, result.created ? 201 : 200, result.workspace, {
          ok: true,
          idempotent: Boolean(result.idempotent)
        });
      }
      const result = store.withdrawOralHistoryAnswers(eventId, body);
      return respondWorkspace(response, 200, result.workspace, {
        ok: true,
        withdrawnCount: result.withdrawnCount
      });
    } catch (error) {
      throw normalizeApiError(error, makeHttpError);
    }
  }

  function respondWorkspace(response, statusCode, workspace, extra = {}) {
    const etag = oralHistoryEtag(workspace);
    response?.setHeader?.("ETag", etag);
    return sendJson(response, statusCode, {
      ...extra,
      ...publicWorkspace(workspace, interviewDemo),
      etag
    });
  }

  return Object.freeze({ handle });
}

function oralHistoryEtag(workspace) {
  const question = workspace?.question;
  const answers = Array.isArray(workspace?.history) ? workspace.history : [];
  return `"oral-history-${sha256(stableStringify({
    answers: answers.map((answer) => ({
      confirmedAt: String(answer.confirmedAt || ""),
      createdAt: String(answer.createdAt || ""),
      id: String(answer.id || ""),
      status: String(answer.status || ""),
      submissionId: String(answer.submissionId || ""),
      supersededAt: String(answer.supersededAt || ""),
      withdrawnAt: String(answer.withdrawnAt || "")
    })),
    eventId: String(workspace?.event?.id || ""),
    eventStatus: String(workspace?.event?.status || ""),
    questionKey: String(question?.questionKey || ""),
    questionSetSha256: String(workspace?.questionSetSha256 || ""),
    questionUpdatedAt: String(question?.updatedAt || "")
  }))}"`;
}

function publicWorkspace(workspace, demo) {
  return {
    event: workspace?.event ? {
      id: String(workspace.event.id || ""),
      title: String(workspace.event.title || ""),
      status: String(workspace.event.status || ""),
      memberCount: Number(workspace.event.memberCount) || 0
    } : null,
    eligibility: {
      eligible: Boolean(workspace?.eligibility?.eligible),
      canAnswer: Boolean(workspace?.eligibility?.canAnswer),
      reason: String(workspace?.eligibility?.reason || ""),
      calibrationState: String(workspace?.eligibility?.calibrationState || ""),
      needsReview: Boolean(workspace?.eligibility?.needsReview)
    },
    question: publicQuestion(workspace?.question),
    questionSetSha256: String(workspace?.questionSetSha256 || ""),
    currentDraft: publicAnswer(workspace?.currentDraft),
    currentConfirmed: publicAnswer(workspace?.currentConfirmed),
    history: (Array.isArray(workspace?.history) ? workspace.history : []).slice(0, 100).map(publicAnswer),
    demo: Boolean(demo)
  };
}

function publicQuestion(question) {
  if (!question) return null;
  return {
    id: String(question.id || ""),
    questionKey: String(question.questionKey || ""),
    text: String(question.text || ""),
    persisted: Boolean(question.persisted),
    sources: (Array.isArray(question.sources) ? question.sources : []).slice(0, 2).map((source) => ({
      sourceKey: String(source.sourceKey || ""),
      sourceType: String(source.sourceType || ""),
      precision: String(source.precision || ""),
      intervalStart: String(source.intervalStart || ""),
      intervalEnd: String(source.intervalEnd || ""),
      memoryId: String(source.memoryId || ""),
      memoryTitle: String(source.memoryTitle || "")
    })),
    originSourceSetSha256: String(question.originSourceSetSha256 || ""),
    createdAt: String(question.createdAt || ""),
    updatedAt: String(question.updatedAt || "")
  };
}

function publicAnswer(answer) {
  if (!answer) return null;
  const asset = answer.asset || {};
  const assetId = String(answer.assetId || asset.id || "");
  return {
    id: String(answer.id || ""),
    submissionId: String(answer.submissionId || ""),
    status: String(answer.status || ""),
    assetId,
    asset: {
      id: assetId,
      durationMs: Number(asset.durationMs) || 0,
      mimeType: String(asset.mimeType || ""),
      contentUrl: assetId ? `/api/voice/assets/${encodeURIComponent(assetId)}/content` : ""
    },
    segmentStartMs: Number(answer.segmentStartMs) || 0,
    segmentEndMs: Number(answer.segmentEndMs) || 0,
    transcriptText: String(answer.transcriptText || ""),
    resolutionKind: String(answer.resolutionKind || ""),
    intervalStart: String(answer.intervalStart || ""),
    intervalEnd: String(answer.intervalEnd || ""),
    createdAt: String(answer.createdAt || ""),
    confirmedAt: String(answer.confirmedAt || ""),
    supersededAt: String(answer.supersededAt || ""),
    withdrawnAt: String(answer.withdrawnAt || "")
  };
}

function requireIfMatchHeader(request) {
  const value = String(request?.headers?.["if-match"] || request?.headers?.get?.("if-match") || "").trim();
  if (!value) throw oralApiError(428, "ORAL_HISTORY_PRECONDITION_REQUIRED", "更新口述史需要 If-Match。");
  return value;
}

function normalizeApiError(error, makeHttpError) {
  const code = String(error?.code || "");
  if (!code.startsWith("ORAL_HISTORY_") && error?.statusCode) return error;
  if (code.startsWith("ORAL_HISTORY_") || error instanceof TypeError || error instanceof RangeError) {
    const wrapped = makeHttpError(Number(error?.statusCode) || 400, error?.message || "Oral-history request failed.");
    if (code) wrapped.code = code;
    if (error?.interviewDemo) wrapped.interviewDemo = true;
    return wrapped;
  }
  return error;
}

function assertDependencies({ store, sendJson, readJsonBody, makeHttpError }) {
  const methods = ["getOralHistoryEventWorkspace", "isOralHistorySubmissionReplay", "saveOralHistoryAnswer", "withdrawOralHistoryAnswers"];
  if (!store || methods.some((name) => typeof store[name] !== "function") ||
      typeof sendJson !== "function" || typeof readJsonBody !== "function" || typeof makeHttpError !== "function") {
    throw new TypeError("Oral-history API dependencies are required.");
  }
}

function oralApiError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
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

module.exports = {
  createOralHistoryApi,
  oralHistoryEtag,
  publicWorkspace
};
