"use strict";

const { SEMANTIC_RECALL_MODEL } = require("./semantic-recall-service");
const { SEMANTIC_INDEX_PROJECTION_VERSION } = require("./semantic-index-database");

const BASE_PATH = "/api/semantic-index";
const MODEL_ID = SEMANTIC_RECALL_MODEL.id;
const MODEL_SHA256 = "15b717c382bcb518ba457b93ea6850ede7f4f1cd8937454aa06972366cd19bcc";

function createSemanticIndexApi(options = {}) {
  const store = options.store;
  const interviewDemo = options.interviewDemo === true;
  const sendJson = options.sendJson;
  const readJsonBody = options.readJsonBody;
  const httpError = options.httpError;
  if (!store || typeof store.getSemanticIndexStatus !== "function" || typeof store.upsertSemanticEmbeddings !== "function" ||
      typeof store.searchSemanticEmbeddings !== "function" || typeof store.clearSemanticEmbeddings !== "function" ||
      typeof sendJson !== "function" || typeof readJsonBody !== "function" || typeof httpError !== "function") {
    throw new TypeError("Semantic index API dependencies are required.");
  }
  const identity = Object.freeze({ modelId: MODEL_ID, modelSha256: MODEL_SHA256, projectionVersion: SEMANTIC_INDEX_PROJECTION_VERSION });

  async function handle(request, response, url) {
    if (!url?.pathname.startsWith(BASE_PATH)) return false;
    if (url.pathname === `${BASE_PATH}/status` && request.method === "GET") {
      if ([...url.searchParams.keys()].length) throw httpError(400, "索引状态不接受查询参数。");
      return sendJson(response, 200, {
        ...store.getSemanticIndexStatus(identity),
        allowed: !interviewDemo,
        boundary: interviewDemo ? "public-demo-memory-only" : "private-local-derived-cache"
      });
    }
    if (interviewDemo) {
      throw indexError(httpError, 403, "公开 Demo 不保存或查询持久语义索引。", "SEMANTIC_INDEX_DEMO_DISABLED");
    }
    if (url.pathname === `${BASE_PATH}/upsert` && request.method === "POST") {
      const body = await readJsonBody(request);
      requireExactKeys(body, ["entries", "modelId", "modelSha256", "projectionVersion"]);
      assertIdentity(body, httpError);
      const result = store.upsertSemanticEmbeddings(body.entries, identity);
      return sendJson(response, 200, { ...result, persistence: "local-sqlite-derived-cache" });
    }
    if (url.pathname === `${BASE_PATH}/search` && request.method === "POST") {
      const body = await readJsonBody(request);
      requireExactKeys(body, ["limit", "modelId", "modelSha256", "projectionVersion", "vector"]);
      assertIdentity(body, httpError);
      const results = store.searchSemanticEmbeddings(body.vector, { ...identity, limit: body.limit });
      return sendJson(response, 200, { engine: "local-sqlite-exact-vector", results: results.map(toResult) });
    }
    if (url.pathname === BASE_PATH && request.method === "DELETE") {
      if ([...url.searchParams.keys()].length) throw httpError(400, "清除索引不接受查询参数。");
      return sendJson(response, 200, { ...store.clearSemanticEmbeddings(), persistence: "local-sqlite-derived-cache" });
    }
    throw indexError(httpError, 405, "语义索引接口或方法不存在。", "SEMANTIC_INDEX_METHOD_NOT_ALLOWED");
  }

  return Object.freeze({ handle, identity });
}

function toResult(item) {
  const memory = item.memory;
  return {
    memoryId: item.memoryId,
    rank: item.rank,
    similarity: item.similarity,
    title: memory.title,
    // Only expose the presentation projection. Raw memory text remains behind
    // the detail endpoint and must never be echoed by the derived-index API.
    excerpt: String(memory.exhibitText || "").slice(0, 180),
    tags: Array.isArray(memory.tags) ? memory.tags : []
  };
}

function assertIdentity(body, httpError) {
  if (body.modelId !== MODEL_ID || body.modelSha256 !== MODEL_SHA256 || body.projectionVersion !== SEMANTIC_INDEX_PROJECTION_VERSION) {
    throw indexError(httpError, 409, "设备模型或索引投影已变化，请重新建立索引。", "SEMANTIC_INDEX_IDENTITY_STALE");
  }
}

function requireExactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).sort().join("\u0000") !== [...expected].sort().join("\u0000")) {
    const error = new Error("语义索引请求字段无效。");
    error.code = "SEMANTIC_INDEX_REQUEST_INVALID";
    error.statusCode = 400;
    throw error;
  }
}

function indexError(httpError, statusCode, message, code) {
  const error = httpError(statusCode, message);
  error.code = code;
  return error;
}

module.exports = { BASE_PATH, MODEL_ID, MODEL_SHA256, createSemanticIndexApi };
