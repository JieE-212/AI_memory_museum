"use strict";

const {
  coMemoryResponseError,
  validateStoredCoMemoryResponse
} = require("./co-memory-response-service");

const MEMORY_ID_PATTERN = /^[A-Za-z0-9_-]{1,120}$/u;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,119}$/u;
const MAX_CONFIRMATION_BODY_BYTES = 900 * 1024;

function createCoMemoryResponseApi(options = {}) {
  const store = options.store;
  const sendJson = options.sendJson;
  const readJsonBody = options.readJsonBody;
  const httpError = options.httpError;
  const interviewDemo = Boolean(options.interviewDemo);
  assertDependencies({ store, sendJson, readJsonBody, httpError });

  async function confirmResponse(contract, context = {}) {
    assertContext(context);
    if (interviewDemo) {
      throw coMemoryResponseError(
        "The public demo does not save co-memory responses.",
        "CO_MEMORY_DEMO_READ_ONLY",
        403
      );
    }
    throwIfAborted(context.signal);
    const result = await store.confirmCoMemoryResponse(contract, {
      idempotencyKey: requireIdempotencyValue(context.idempotencyKey)
    });
    return readOnlyRecord(result.record);
  }

  async function handle(request, response, url) {
    if (!url?.pathname.startsWith("/api/co-memory-responses")) return false;

    if (request.method === "GET" && url.pathname === "/api/co-memory-responses") {
      const memoryId = requireListQuery(url, httpError);
      const records = store.listCoMemoryResponses({ memoryId }).map(readOnlyRecord);
      return sendJson(response, 200, {
        records,
        count: records.length,
        identityBoundary: "self-asserted-unverified",
        demo: interviewDemo,
        persisted: !interviewDemo
      });
    }

    const itemMatch = url.pathname.match(/^\/api\/co-memory-responses\/([A-Za-z0-9][A-Za-z0-9_-]{0,119})$/u);
    if (request.method === "GET" && itemMatch) {
      assertNoQuery(url, httpError);
      const record = store.getCoMemoryResponse(itemMatch[1]);
      if (!record) throw codedHttpError(httpError, 404, "没有找到这封共忆回信。", "CO_MEMORY_RESPONSE_NOT_FOUND");
      response.setHeader("ETag", coMemoryResponseEtag(record));
      return sendJson(response, 200, { record: readOnlyRecord(record) });
    }

    // This guard is intentionally before Idempotency-Key parsing and before
    // readJsonBody, so the public demo consumes zero request-body bytes.
    if (!new Set(["GET", "HEAD"]).has(request.method) && interviewDemo) {
      return sendJson(response, 403, {
        error: "公开 Demo 只展示共忆信笺流程，不读取回信保存请求体，也不持久化任何回复。",
        code: "CO_MEMORY_DEMO_READ_ONLY",
        interviewDemo: true
      });
    }

    if (request.method === "POST" && url.pathname === "/api/co-memory-responses/confirm") {
      assertNoQuery(url, httpError);
      const idempotencyKey = requireIdempotencyHeader(request, httpError);
      const body = await readJsonBody(request, MAX_CONFIRMATION_BODY_BYTES);
      const result = await store.confirmCoMemoryResponse(body, { idempotencyKey });
      const record = readOnlyRecord(result.record);
      response.setHeader("ETag", coMemoryResponseEtag(record));
      return sendJson(response, result.created ? 201 : 200, {
        created: Boolean(result.created),
        idempotent: Boolean(result.idempotent),
        record
      });
    }

    throw codedHttpError(
      httpError,
      request.method === "GET" ? 404 : 405,
      request.method === "GET" ? "共忆回信接口不存在。" : "共忆回信接口不支持该请求方法。",
      request.method === "GET" ? "CO_MEMORY_ROUTE_NOT_FOUND" : "CO_MEMORY_METHOD_NOT_ALLOWED"
    );
  }

  return Object.freeze({ confirmResponse, handle });
}

function readOnlyRecord(input) {
  const record = validateStoredCoMemoryResponse(input);
  return deepFreeze({
    ...record,
    boundary: "独立未核验来源；不会创建口述史、修改原记忆或证明回信人身份。"
  });
}

function coMemoryResponseEtag(record) {
  const hash = String(record?.snapshotSha256 || "");
  return `"co-memory-response-${hash}"`;
}

function requireListQuery(url, httpError) {
  const keys = [...url.searchParams.keys()];
  if (keys.length !== 1 || keys[0] !== "memoryId" || url.searchParams.getAll("memoryId").length !== 1) {
    throw codedHttpError(httpError, 400, "共忆回信列表只接受一个 memoryId。", "CO_MEMORY_QUERY_INVALID");
  }
  const memoryId = url.searchParams.get("memoryId") || "";
  if (!MEMORY_ID_PATTERN.test(memoryId)) {
    throw codedHttpError(httpError, 400, "memoryId 无效。", "CO_MEMORY_QUERY_INVALID");
  }
  return memoryId;
}

function requireIdempotencyHeader(request, httpError) {
  const value = String(request.headers?.["idempotency-key"] || "").trim();
  if (!IDEMPOTENCY_PATTERN.test(value)) {
    throw codedHttpError(
      httpError,
      400,
      "Idempotency-Key 必须包含 8 至 120 个允许字符。",
      "CO_MEMORY_IDEMPOTENCY_KEY_INVALID"
    );
  }
  return value;
}

function requireIdempotencyValue(value) {
  const key = String(value || "").trim();
  if (!IDEMPOTENCY_PATTERN.test(key)) {
    throw coMemoryResponseError("Idempotency-Key is invalid.", "CO_MEMORY_IDEMPOTENCY_KEY_INVALID");
  }
  return key;
}

function assertNoQuery(url, httpError) {
  if ([...url.searchParams.keys()].length) {
    throw codedHttpError(httpError, 400, "该共忆回信接口不接受查询参数。", "CO_MEMORY_QUERY_INVALID");
  }
}

function assertContext(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Object.keys(value).some((key) => !new Set(["idempotencyKey", "signal"]).has(key))) {
    throw coMemoryResponseError("confirmResponse context is invalid.", "CO_MEMORY_API_CONTEXT_INVALID");
  }
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  if (typeof signal.throwIfAborted === "function") signal.throwIfAborted();
  const error = new Error("Co-memory confirmation was aborted.");
  error.name = "AbortError";
  throw error;
}

function codedHttpError(httpError, statusCode, message, code) {
  const error = httpError(statusCode, message);
  error.code = code;
  return error;
}

function assertDependencies({ store, sendJson, readJsonBody, httpError }) {
  const methods = ["confirmCoMemoryResponse", "getCoMemoryResponse", "listCoMemoryResponses"];
  if (!store || methods.some((name) => typeof store[name] !== "function") ||
      typeof sendJson !== "function" || typeof readJsonBody !== "function" || typeof httpError !== "function") {
    throw new TypeError("createCoMemoryResponseApi dependencies are incomplete.");
  }
}

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  Object.values(value).forEach((item) => deepFreeze(item, seen));
  return Object.freeze(value);
}

module.exports = {
  MAX_CONFIRMATION_BODY_BYTES,
  coMemoryResponseEtag,
  createCoMemoryResponseApi,
  readOnlyRecord
};
