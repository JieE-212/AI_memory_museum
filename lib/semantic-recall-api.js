"use strict";

const {
  SEMANTIC_RECALL_FORMAT,
  buildSemanticRecallSnapshot
} = require("./semantic-recall-service");

const SEMANTIC_RECALL_SNAPSHOT_PATH = "/api/semantic-recall/snapshot";

function createSemanticRecallApi(options = {}) {
  const store = options.store;
  const sendJson = options.sendJson;
  const makeHttpError = options.httpError;
  const buildSnapshot = typeof options.buildSnapshot === "function"
    ? options.buildSnapshot
    : buildSemanticRecallSnapshot;
  assertDependencies({ store, sendJson, makeHttpError, buildSnapshot });

  async function handle(request, response, url) {
    if (!url?.pathname.startsWith("/api/semantic-recall")) return false;
    if (url.pathname !== SEMANTIC_RECALL_SNAPSHOT_PATH) {
      throw apiError(makeHttpError, 404, "设备内语义回忆接口不存在。", "SEMANTIC_RECALL_ROUTE_NOT_FOUND");
    }
    if (request?.method !== "GET") {
      throw apiError(makeHttpError, 405, "设备内语义回忆快照只支持 GET。", "SEMANTIC_RECALL_METHOD_NOT_ALLOWED");
    }
    if ([...url.searchParams.keys()].length) {
      throw apiError(makeHttpError, 400, "设备内语义回忆快照不接受查询参数。", "SEMANTIC_RECALL_QUERY_INVALID");
    }

    try {
      const memories = synchronous(store.listMemories(), "listMemories");
      const snapshot = synchronous(buildSnapshot({
        memories,
        listVoiceForMemory: (memoryId) => store.listVoiceForMemory(memoryId)
      }), "buildSemanticRecallSnapshot");
      if (snapshot?.format !== SEMANTIC_RECALL_FORMAT || snapshot.documentCount !== snapshot.documents?.length) {
        throw new TypeError("Semantic recall snapshot builder returned an invalid contract.");
      }
      response.setHeader("Cache-Control", "private, no-store");
      return sendJson(response, 200, { snapshot });
    } catch (error) {
      throw normalizeApiError(error, makeHttpError);
    }
  }

  return Object.freeze({ handle });
}

function normalizeApiError(error, makeHttpError) {
  const code = String(error?.code || "");
  if (!code.startsWith("SEMANTIC_RECALL_")) return error;
  const statusCode = Number(error?.statusCode);
  return apiError(
    makeHttpError,
    statusCode >= 400 && statusCode < 600 ? statusCode : 500,
    error.message || "设备内语义回忆暂时不可用。",
    code
  );
}

function apiError(makeHttpError, statusCode, message, code) {
  const error = makeHttpError(statusCode, message);
  if (!error || typeof error !== "object") throw new TypeError("httpError must return an Error object.");
  error.code = code;
  return error;
}

function synchronous(value, name) {
  if (value && typeof value.then === "function") throw new TypeError(`${name} must be synchronous.`);
  return value;
}

function assertDependencies({ store, sendJson, makeHttpError, buildSnapshot }) {
  if (!store || typeof store.listMemories !== "function" || typeof store.listVoiceForMemory !== "function" ||
      typeof sendJson !== "function" || typeof makeHttpError !== "function" || typeof buildSnapshot !== "function") {
    throw new TypeError("Semantic recall API dependencies are required.");
  }
}

module.exports = {
  SEMANTIC_RECALL_SNAPSHOT_PATH,
  createSemanticRecallApi
};
