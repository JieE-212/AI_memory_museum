"use strict";

const {
  MEMORY_LENS_LIMITS,
  buildMemoryLensPreview
} = require("./memory-lens-service");

const MEMORY_LENS_PREVIEW_PATH = "/api/memory-lens/preview";
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/u;
const SINGLE_LINE_CONTROL_PATTERN = /[\u0000-\u001F\u007F]/u;
const QUERY_KEYS = new Set(["lens", "memoryId", "query"]);
const EXECUTION_BOUNDARY = Object.freeze({
  source: "server-read-saved-memories",
  deterministic: true,
  externalModel: false,
  modelCalls: 0,
  toolCalls: 0,
  persisted: false
});

/**
 * GET-only adapter for deterministic memory-lens previews.
 *
 * The request accepts identifiers, never memory objects. Every preview is
 * rebuilt from the current saved collection and is returned without creating
 * a database record, running a model, or invoking a tool.
 */
function createMemoryLensApi(options = {}) {
  const store = options.store;
  const sendJson = options.sendJson;
  const makeHttpError = options.httpError;
  const buildPreview = typeof options.buildPreview === "function"
    ? options.buildPreview
    : buildMemoryLensPreview;
  const decorateMemory = typeof options.decorateMemory === "function"
    ? options.decorateMemory
    : defaultDecorateMemory;
  assertDependencies({ store, sendJson, makeHttpError, buildPreview });

  async function handle(request, response, url) {
    if (url?.pathname !== MEMORY_LENS_PREVIEW_PATH) return false;
    if (request?.method !== "GET") {
      throw apiError(makeHttpError, 405, "设备内镜片预览只支持 GET。", "MEMORY_LENS_METHOD_NOT_ALLOWED");
    }

    try {
      const selection = parseMemoryLensQuery(url.searchParams, makeHttpError);
      const memories = [];
      for (const memoryId of selection.memoryIds) {
        const saved = await Promise.resolve(store.getMemory(memoryId));
        if (!saved) {
          throw apiError(makeHttpError, 404, `没有找到展品 ${memoryId}。`, "MEMORY_LENS_MEMORY_NOT_FOUND");
        }
        const decorated = await Promise.resolve(decorateMemory(saved, { memoryId, store }));
        if (!decorated || typeof decorated !== "object" || Array.isArray(decorated) || decorated.id !== memoryId) {
          throw new TypeError("Memory-lens decoration must preserve the saved memory ID.");
        }
        memories.push(decorated);
      }

      const preview = await Promise.resolve(buildPreview({
        lens: selection.lens,
        memories,
        ...(selection.lens === "clue" ? { query: selection.query } : {})
      }));
      return sendJson(response, 200, { preview, execution: EXECUTION_BOUNDARY });
    } catch (error) {
      throw normalizeApiError(error, makeHttpError);
    }
  }

  return Object.freeze({ handle });
}

function parseMemoryLensQuery(searchParams, makeHttpError = localHttpError) {
  if (!searchParams || typeof searchParams.getAll !== "function" || typeof searchParams.keys !== "function") {
    throw apiError(makeHttpError, 400, "镜片查询参数无效。", "MEMORY_LENS_REQUEST_INVALID");
  }
  for (const key of searchParams.keys()) {
    if (!QUERY_KEYS.has(key)) {
      throw apiError(
        makeHttpError,
        400,
        "镜片接口只接受 lens、memoryId 和线索模式下的 query。",
        "MEMORY_LENS_REQUEST_INVALID"
      );
    }
  }

  const lensValues = searchParams.getAll("lens");
  if (lensValues.length !== 1 || !["time", "cooccurrence", "evidence", "clue"].includes(lensValues[0])) {
    throw apiError(makeHttpError, 400, "请选择一个有效镜片。", "MEMORY_LENS_REQUEST_INVALID");
  }
  const lens = lensValues[0];
  const memoryIds = searchParams.getAll("memoryId");
  if (memoryIds.length < MEMORY_LENS_LIMITS.minMemories || memoryIds.length > MEMORY_LENS_LIMITS.maxMemories) {
    throw apiError(
      makeHttpError,
      400,
      `请明确选择 ${MEMORY_LENS_LIMITS.minMemories}–${MEMORY_LENS_LIMITS.maxMemories} 件展品。`,
      "MEMORY_LENS_MEMORY_COUNT_INVALID"
    );
  }
  if (memoryIds.some((memoryId) => !ID_PATTERN.test(memoryId))) {
    throw apiError(makeHttpError, 400, "展品 ID 无效。", "MEMORY_LENS_MEMORY_INVALID");
  }
  if (new Set(memoryIds).size !== memoryIds.length) {
    throw apiError(makeHttpError, 400, "不能重复选择同一件展品。", "MEMORY_LENS_MEMORY_INVALID");
  }

  const queryValues = searchParams.getAll("query");
  let query = "";
  if (lens === "clue") {
    if (queryValues.length !== 1) {
      throw apiError(makeHttpError, 400, "线索镜片需要一组明确查询词。", "MEMORY_LENS_QUERY_INVALID");
    }
    query = normalizeClueQuery(queryValues[0], makeHttpError);
  } else if (queryValues.length) {
    throw apiError(makeHttpError, 400, "只有线索镜片可以携带 query。", "MEMORY_LENS_QUERY_INVALID");
  }

  return Object.freeze({
    lens,
    memoryIds: Object.freeze([...memoryIds]),
    query
  });
}

function normalizeClueQuery(value, makeHttpError) {
  if (typeof value !== "string" || value.length > 320 || SINGLE_LINE_CONTROL_PATTERN.test(value)) {
    throw apiError(makeHttpError, 400, "线索查询格式无效。", "MEMORY_LENS_QUERY_INVALID");
  }
  const query = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if ([...query].length < 1 || [...query].length > 160) {
    throw apiError(makeHttpError, 400, "线索查询需要 1–160 个字符。", "MEMORY_LENS_QUERY_INVALID");
  }
  const distinctTerms = new Set();
  for (const term of query.split(" ")) {
    if ([...term].length > 40) {
      throw apiError(makeHttpError, 400, "每个线索词最多 40 个字符。", "MEMORY_LENS_QUERY_INVALID");
    }
    distinctTerms.add(term.normalize("NFKC").toLowerCase());
  }
  if (distinctTerms.size < 1 || distinctTerms.size > 8) {
    throw apiError(makeHttpError, 400, "线索查询需要 1–8 个明确词语。", "MEMORY_LENS_QUERY_INVALID");
  }
  return query;
}

function defaultDecorateMemory(memory, context) {
  const store = context.store;
  const memoryId = context.memoryId;
  const entityRefs = typeof store.getMemoryEntityRefs === "function"
    ? store.getMemoryEntityRefs(memoryId)
    : memory.entityRefs;
  const voices = typeof store.listVoiceForMemory === "function"
    ? store.listVoiceForMemory(memoryId)
    : memory.voices;
  return {
    ...memory,
    ...(Array.isArray(entityRefs) ? { entityRefs } : {}),
    ...(Array.isArray(voices) ? {
      voices,
      voiceSummary: {
        count: voices.length,
        confirmedTranscriptCount: voices.filter((item) => item?.transcript?.confirmed === true).length
      }
    } : {})
  };
}

function normalizeApiError(error, makeHttpError) {
  if (error?.statusCode) return error;
  if (String(error?.code || "").startsWith("MEMORY_LENS_")) {
    const wrapped = apiError(makeHttpError, 400, error.message, error.code || "MEMORY_LENS_REQUEST_INVALID");
    return wrapped;
  }
  return error;
}

function apiError(makeHttpError, statusCode, message, code) {
  const error = makeHttpError(statusCode, message);
  if (!error || typeof error !== "object") throw new TypeError("httpError must return an Error object.");
  error.code = code;
  return error;
}

function localHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function assertDependencies({ store, sendJson, makeHttpError, buildPreview }) {
  if (!store || typeof store.getMemory !== "function" || typeof sendJson !== "function" ||
      typeof makeHttpError !== "function" || typeof buildPreview !== "function") {
    throw new TypeError("Memory-lens API dependencies are required.");
  }
}

module.exports = {
  MEMORY_LENS_PREVIEW_PATH,
  MEMORY_LENS_EXECUTION_BOUNDARY: EXECUTION_BOUNDARY,
  createMemoryLensApi,
  parseMemoryLensQuery
};
