"use strict";

const {
  MULTI_PERSPECTIVE_FORMAT,
  buildMultiPerspectivePreview
} = require("./multi-perspective-service");

const MULTI_PERSPECTIVE_PATH = /^\/api\/multi-perspective\/memories\/([A-Za-z0-9][A-Za-z0-9_-]{0,119})$/u;
const SHA256 = Object.freeze({
  a: "a".repeat(64),
  b: "b".repeat(64),
  c: "c".repeat(64)
});

function createMultiPerspectiveApi(options = {}) {
  const store = options.store;
  const sendJson = options.sendJson;
  const makeHttpError = options.httpError;
  const interviewDemo = Boolean(options.interviewDemo);
  const buildPreview = typeof options.buildPreview === "function"
    ? options.buildPreview
    : buildMultiPerspectivePreview;
  assertDependencies({ store, sendJson, makeHttpError, buildPreview });

  async function handle(request, response, url) {
    if (!url?.pathname.startsWith("/api/multi-perspective")) return false;
    const match = url.pathname.match(MULTI_PERSPECTIVE_PATH);
    if (!match) {
      throw apiError(makeHttpError, 404, "多视角记忆对照接口不存在。", "MULTI_PERSPECTIVE_ROUTE_NOT_FOUND");
    }
    if (request.method !== "GET") {
      throw apiError(makeHttpError, 405, "多视角记忆对照只支持 GET。", "MULTI_PERSPECTIVE_METHOD_NOT_ALLOWED");
    }
    assertNoQuery(url, makeHttpError);

    try {
      const preview = interviewDemo
        // This branch deliberately precedes every store call. The public Demo
        // renders a synthetic contract and never inspects a private database.
        ? buildSyntheticMultiPerspectivePreview(match[1], buildPreview)
        : buildStoredMultiPerspectivePreview(store, match[1], buildPreview);
      return respondPreview(request, response, sendJson, preview);
    } catch (error) {
      throw normalizeApiError(error, makeHttpError);
    }
  }

  return Object.freeze({ handle });
}

function buildStoredMultiPerspectivePreview(store, memoryId, buildPreview = buildMultiPerspectivePreview) {
  const memory = synchronous(store.getMemory(memoryId), "getMemory");
  if (!memory) {
    const error = new Error("没有找到这件展品。");
    error.code = "MULTI_PERSPECTIVE_MEMORY_NOT_FOUND";
    error.statusCode = 404;
    throw error;
  }
  const revisions = synchronous(store.listMemoryRevisions(memoryId), "listMemoryRevisions");
  const responses = synchronous(
    store.listCoMemoryResponses({ memoryId, limit: 100 }),
    "listCoMemoryResponses"
  );
  const passport = synchronous(store.getProvenancePassport(memoryId), "getProvenancePassport");
  const timeContext = readTimeContext(store, memoryId);
  return synchronous(buildPreview({
    memory,
    revisions,
    responses,
    passport,
    timeContext,
    synthetic: false
  }), "buildMultiPerspectivePreview");
}

function readTimeContext(store, memoryId) {
  const event = synchronous(store.getMemoryEventForMemory(memoryId), "getMemoryEventForMemory");
  if (event?.status === "confirmed") {
    const workspace = synchronous(store.getEventCalibrationWorkspace(event.id), "getEventCalibrationWorkspace");
    return {
      targetType: "event",
      targetTitle: String(event.title || ""),
      calibration: workspace?.calibration || null,
      needsReview: Boolean(workspace?.needsReview)
    };
  }
  const workspace = synchronous(store.getMemoryCalibrationWorkspace(memoryId), "getMemoryCalibrationWorkspace");
  return {
    targetType: "memory",
    targetTitle: String(workspace?.target?.title || ""),
    calibration: workspace?.calibration || null,
    needsReview: Boolean(workspace?.needsReview)
  };
}

function buildSyntheticMultiPerspectivePreview(memoryId, buildPreview = buildMultiPerspectivePreview) {
  return buildPreview({
    memory: {
      id: memoryId,
      title: "合成示例 · 雨夜散场",
      rawContent: "我记得离开礼堂时已经下起小雨。",
      exhibitText: "同一段经历可以保留不同人的说法。",
      date: "2021-06-19",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-03T00:00:00.000Z"
    },
    revisions: [
      {
        id: "synthetic-revision-old",
        memoryId,
        revisionNo: 1,
        changeKind: "created",
        snapshotSha256: SHA256.a,
        snapshot: {
          title: "合成示例 · 雨夜散场",
          date: "2021-06-18",
          rawContent: "我最初把日期记成了十八日。",
          exhibitText: "同一段经历可以保留不同人的说法。"
        },
        createdAt: "2026-01-01T00:00:00.000Z"
      }
    ],
    responses: [
      syntheticResponse(memoryId)
    ],
    passport: {
      memoryId,
      claims: [
        {
          id: "synthetic-claim",
          memoryId,
          statement: "关于雨从什么时候开始，留下了不同记录。",
          status: "confirmed",
          lifecycleStatus: "confirmed",
          needsReview: false,
          sourcesCurrent: true,
          etag: "synthetic-confirmed-v2",
          sources: [
            {
              relationKind: "supports",
              sourceKind: "memory_text",
              originRef: { provider: "synthetic", memoryId, referenceId: `memory:${memoryId}` },
              snapshot: { excerpt: "我记得离开礼堂时已经下起小雨。", metadata: { label: "合成馆主记录" } },
              integrityStatus: "source_verified"
            },
            {
              relationKind: "different_record",
              sourceKind: "co_memory_response",
              originRef: { provider: "synthetic", memoryId, referenceId: "co-memory:synthetic-response" },
              snapshot: { excerpt: "我记得雨是散场以后才下的。", metadata: { label: "合成亲友回信（自述）" } },
              integrityStatus: "source_verified"
            }
          ]
        }
      ]
    },
    timeContext: {
      targetType: "event",
      targetTitle: "合成毕业散场",
      needsReview: false,
      calibration: {
        resolutionKind: "alternatives",
        intervalStart: "",
        intervalEnd: "",
        selectedSourceKeys: [`time-source:${SHA256.a}`, `time-source:${SHA256.b}`],
        updatedAt: "2026-01-04T00:00:00.000Z"
      }
    },
    synthetic: true
  });
}

function syntheticResponse(memoryId) {
  return {
    id: "synthetic-response",
    kind: "co_memory_response",
    memoryId,
    label: "合成亲友回信（自述）",
    excerpt: "我记得雨是散场以后才下的。",
    identityAssurance: "self-asserted-unverified",
    identityVerified: false,
    encrypted: true,
    signed: false,
    snapshotSha256: SHA256.c,
    request: { question: "你记得散场时已经下雨了吗？" },
    response: {
      identity: { label: "合成回信人", assurance: "self-asserted-unverified", verified: false },
      answer: "我记得雨是散场以后才下的。"
    },
    createdAt: "2026-01-05T00:00:00.000Z"
  };
}

function respondPreview(request, response, sendJson, preview) {
  if (!preview || preview.format !== MULTI_PERSPECTIVE_FORMAT ||
      !/^[a-f0-9]{64}$/u.test(String(preview.receipt?.previewSha256 || ""))) {
    throw new TypeError("Multi-perspective builder returned an invalid preview.");
  }
  const etag = `"multi-perspective-${preview.receipt.previewSha256}"`;
  response.setHeader("Cache-Control", "private, no-store");
  response.setHeader("ETag", etag);
  if (readHeader(request, "if-none-match") === etag) {
    response.statusCode = 304;
    response.end();
    return undefined;
  }
  return sendJson(response, 200, { preview, etag });
}

function assertNoQuery(url, makeHttpError) {
  if ([...url.searchParams.keys()].length) {
    throw apiError(makeHttpError, 400, "多视角记忆对照不接受查询参数。", "MULTI_PERSPECTIVE_QUERY_INVALID");
  }
}

function normalizeApiError(error, makeHttpError) {
  const code = String(error?.code || "");
  if (error?.statusCode === 404 && code === "MULTI_PERSPECTIVE_MEMORY_NOT_FOUND") {
    return apiError(makeHttpError, 404, "没有找到这件展品。", code);
  }
  if (code.startsWith("MULTI_PERSPECTIVE_")) {
    return apiError(
      makeHttpError,
      Number(error?.statusCode) >= 400 && Number(error?.statusCode) < 500 ? Number(error.statusCode) : 500,
      Number(error?.statusCode) === 404 ? "没有找到这件展品。" : "多视角记忆对照暂时无法生成。",
      code
    );
  }
  return error;
}

function synchronous(value, name) {
  if (value && typeof value.then === "function") {
    throw new TypeError(`${name} must be synchronous for one coherent preview.`);
  }
  return value;
}

function readHeader(request, name) {
  if (request?.headers && typeof request.headers.get === "function") return String(request.headers.get(name) || "");
  return String(request?.headers?.[name] || request?.headers?.[name.toLowerCase()] || "");
}

function apiError(makeHttpError, statusCode, message, code) {
  const error = makeHttpError(statusCode, message);
  if (!error || typeof error !== "object") throw new TypeError("httpError must return an Error.");
  error.code = code;
  return error;
}

function assertDependencies({ store, sendJson, makeHttpError, buildPreview }) {
  const methods = [
    "getEventCalibrationWorkspace",
    "getMemory",
    "getMemoryCalibrationWorkspace",
    "getMemoryEventForMemory",
    "getProvenancePassport",
    "listCoMemoryResponses",
    "listMemoryRevisions"
  ];
  if (!store || methods.some((name) => typeof store[name] !== "function") ||
      typeof sendJson !== "function" || typeof makeHttpError !== "function" || typeof buildPreview !== "function") {
    throw new TypeError("Multi-perspective API dependencies are incomplete.");
  }
}

module.exports = {
  MULTI_PERSPECTIVE_PATH,
  buildStoredMultiPerspectivePreview,
  buildSyntheticMultiPerspectivePreview,
  createMultiPerspectiveApi
};
