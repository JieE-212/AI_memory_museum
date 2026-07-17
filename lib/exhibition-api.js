"use strict";

const {
  MAX_MEMORIES,
  MIN_MEMORIES,
  buildExhibitionPreview
} = require("./exhibition-curator");

const ID_PATTERN = /^[a-zA-Z0-9_-]{1,120}$/;

function createExhibitionApi(options = {}) {
  const database = options.database || options.exhibitionStore;
  const store = options.store;
  const sendJson = options.sendJson;
  const readJsonBody = options.readJsonBody;
  const makeHttpError = options.httpError;
  const interviewDemo = Boolean(options.interviewDemo);
  const curator = typeof options.buildPreview === "function" ? options.buildPreview : buildExhibitionPreview;
  assertDependencies({ database, store, sendJson, readJsonBody, makeHttpError });

  async function handle(request, response, url) {
    const relevant = url.pathname === "/api/exhibitions" ||
      url.pathname === "/api/exhibitions/preview" ||
      /^\/api\/exhibitions\/[a-zA-Z0-9_-]{1,120}$/.test(url.pathname);
    if (!relevant) return false;

    try {
      if (url.pathname === "/api/exhibitions/preview") {
        if (request.method === "POST") {
          const body = await readJsonBody(request);
          const preview = previewFromBody(body);
          return sendJson(response, 200, { preview });
        }
        throw makeHttpError(405, "主题展览预览只支持 POST。");
      }

      if (url.pathname === "/api/exhibitions") {
        if (request.method === "GET") {
          const requestedStatus = url.searchParams.get("status");
          const status = ["draft", "published"].includes(requestedStatus) ? requestedStatus : "";
          const limit = clampInteger(url.searchParams.get("limit"), 1, 200, 200);
          const exhibitions = database.listExhibitions()
            .filter((item) => !status || item.status === status)
            .slice(0, limit);
          return sendJson(response, 200, { exhibitions });
        }
        if (request.method === "POST") {
          assertPersistentWritesAllowed();
          const body = await readJsonBody(request);
          assertConfirmed(body);
          const exhibition = database.createExhibition(materializeSaveInput(body));
          return sendJson(response, 201, { exhibition });
        }
        throw makeHttpError(405, "主题展览列表不支持该请求方法。");
      }

      const itemMatch = url.pathname.match(/^\/api\/exhibitions\/([a-zA-Z0-9_-]{1,120})$/);
      if (!itemMatch) return false;
      const id = itemMatch[1];

      if (request.method === "GET") {
        const exhibition = database.getExhibition(id);
        if (!exhibition) throw makeHttpError(404, "没有找到这个主题展览。");
        return sendJson(response, 200, { exhibition });
      }
      if (request.method === "PUT") {
        assertPersistentWritesAllowed();
        const body = await readJsonBody(request);
        assertConfirmed(body);
        const existing = database.getExhibition(id);
        if (!existing) throw makeHttpError(404, "没有找到这个主题展览。");
        const exhibition = database.updateExhibition(id, materializeSaveInput(body, existing));
        return sendJson(response, 200, { exhibition });
      }
      if (request.method === "DELETE") {
        assertPersistentWritesAllowed();
        const removed = database.deleteExhibition(id);
        if (!removed) throw makeHttpError(404, "没有找到这个主题展览。");
        return sendJson(response, 200, { ok: true, id });
      }
      throw makeHttpError(405, "主题展览详情不支持该请求方法。");
    } catch (error) {
      throw normalizeApiError(error);
    }
  }

  function previewFromBody(body = {}) {
    const memoryIds = normalizeMemoryIds(body.memoryIds);
    const memories = memoryIds.map((id) => {
      const memory = store.getMemory(id);
      if (!memory) throw makeHttpError(404, `没有找到展品 ${id}。`);
      return memory;
    });
    return curator(memories, {
      theme: optionalText(body.theme, 60),
      title: optionalText(body.title, 120),
      opening: optionalText(body.opening, 1200)
    });
  }

  function materializeSaveInput(body, existing = null) {
    const confirmed = body.confirm === true || body.confirmed === true;
    let content;
    if (Array.isArray(body.sections)) {
      content = { ...body };
    } else if (Array.isArray(body.memoryIds)) {
      content = previewFromBody(body);
    } else if (existing) {
      content = existing;
    } else {
      throw makeHttpError(400, "保存主题展览需要 memoryIds 或完整 sections。");
    }
    return {
      ...content,
      ...(body.title !== undefined ? { title: optionalText(body.title, 120) } : {}),
      ...(body.theme !== undefined ? { theme: optionalText(body.theme, 60) } : {}),
      ...(body.opening !== undefined ? { opening: optionalText(body.opening, 1200) } : {}),
      ...(body.mode !== undefined ? { mode: body.mode } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
      confirm: confirmed,
      confirmed
    };
  }

  function assertPersistentWritesAllowed() {
    if (!interviewDemo) return;
    const error = makeHttpError(403, "公开 Demo 只提供主题展览预览，不保存私人策展内容。");
    error.interviewDemo = true;
    throw error;
  }

  function assertConfirmed(body) {
    if (body?.confirm === true || body?.confirmed === true) return;
    throw makeHttpError(400, "保存主题展览前必须由用户明确确认。");
  }

  function normalizeApiError(error) {
    if (error?.statusCode) return error;
    if (error instanceof TypeError || error instanceof RangeError || String(error?.code || "").startsWith("EXHIBITION_")) {
      const status = Number(error?.statusCode) || 400;
      const wrapped = makeHttpError(status, error.message);
      if (error?.code) wrapped.code = error.code;
      return wrapped;
    }
    return error;
  }

  return Object.freeze({ handle });
}

function normalizeMemoryIds(value) {
  if (!Array.isArray(value) || value.length < MIN_MEMORIES || value.length > MAX_MEMORIES) {
    const error = new Error(`memoryIds 必须包含 ${MIN_MEMORIES} 至 ${MAX_MEMORIES} 个展品 ID。`);
    error.code = "EXHIBITION_MEMORY_COUNT_INVALID";
    error.statusCode = 400;
    throw error;
  }
  const ids = value.map((item) => String(item || "").trim());
  if (ids.some((id) => !ID_PATTERN.test(id))) {
    const error = new Error("memoryIds 包含无效展品 ID。");
    error.code = "EXHIBITION_MEMORY_INVALID";
    error.statusCode = 400;
    throw error;
  }
  if (new Set(ids).size !== ids.length) {
    const error = new Error("memoryIds 不能重复选择同一件展品。");
    error.code = "EXHIBITION_MEMORY_DUPLICATE";
    error.statusCode = 400;
    throw error;
  }
  return ids;
}

function optionalText(value, maximum) {
  return String(value || "").trim().slice(0, maximum);
}

function clampInteger(value, minimum, maximum, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
}

function assertDependencies({ database, store, sendJson, readJsonBody, makeHttpError }) {
  if (!database || typeof database.listExhibitions !== "function" || typeof database.createExhibition !== "function" ||
      !store || typeof store.getMemory !== "function" || typeof sendJson !== "function" ||
      typeof readJsonBody !== "function" || typeof makeHttpError !== "function") {
    throw new TypeError("createExhibitionApi 依赖不完整。");
  }
}

module.exports = { createExhibitionApi, normalizeMemoryIds };
