"use strict";

const { normalizeLocalContext, selectRevisits } = require("./revisit-service");

const ACTION_PATH = /^\/api\/revisits\/([a-zA-Z0-9_-]{1,120})\/(viewed|dismissed)$/u;
const KIND_LABELS = Object.freeze({
  "on-this-day": "往年今日",
  "long-unseen": "很久没见",
  random: "随机漫游"
});

function createRevisitApi(options = {}) {
  const database = options.database || options.revisitStore;
  const store = options.store;
  const sendJson = options.sendJson;
  const readJsonBody = options.readJsonBody;
  const makeHttpError = options.httpError;
  const interviewDemo = Boolean(options.interviewDemo);
  const selector = typeof options.selectRevisits === "function" ? options.selectRevisits : selectRevisits;
  const decorateMemory = typeof options.decorateMemory === "function" ? options.decorateMemory : (memory) => memory;
  assertDependencies({ database, store, sendJson, readJsonBody, makeHttpError });

  async function handle(request, response, url) {
    const actionMatch = url.pathname.match(ACTION_PATH);
    if (url.pathname !== "/api/revisits" && !actionMatch) return false;

    try {
      if (url.pathname === "/api/revisits") {
        if (request.method !== "GET") throw makeHttpError(405, "记忆回访列表只支持 GET。");
        const selection = selector(store.listMemories(), database.listRevisitStates(), {
          kind: url.searchParams.get("kind") || "on-this-day",
          localDate: url.searchParams.get("localDate") || "",
          timezone: url.searchParams.get("timezone") || "",
          limit: url.searchParams.get("limit") || undefined
        });
        const revisits = selection.items.map((item) => ({
          ...item,
          kind: selection.kind,
          label: KIND_LABELS[selection.kind],
          memory: decorateMemory(item.memory)
        }));
        return sendJson(response, 200, {
          kind: selection.kind,
          localDate: selection.localDate,
          timezone: selection.timezone,
          count: revisits.length,
          candidateCount: selection.candidateCount,
          explanation: selection.explanation,
          emptyReason: selection.emptyReason,
          revisit: revisits[0] || null,
          revisits
        });
      }

      if (request.method !== "POST") throw makeHttpError(405, "回访状态只支持 POST。");
      assertPersistentWritesAllowed();
      const body = await readJsonBody(request);
      const local = normalizeLocalContext(body);
      const input = {
        memoryId: actionMatch[1],
        localDate: local.localDate,
        timezone: local.timezone
      };
      const state = actionMatch[2] === "viewed"
        ? database.markRevisitViewed(input)
        : database.markRevisitDismissed(input);
      return sendJson(response, 200, {
        ok: true,
        action: actionMatch[2],
        memoryId: actionMatch[1],
        state
      });
    } catch (error) {
      throw normalizeApiError(error);
    }
  }

  function assertPersistentWritesAllowed() {
    if (!interviewDemo) return;
    const error = makeHttpError(403, "公开 Demo 可以查看记忆回访，但不会保存浏览或隐藏状态。");
    error.interviewDemo = true;
    throw error;
  }

  function normalizeApiError(error) {
    if (error?.statusCode && !String(error?.code || "").startsWith("REVISIT_")) return error;
    if (error instanceof TypeError || error instanceof RangeError || String(error?.code || "").startsWith("REVISIT_")) {
      const wrapped = makeHttpError(Number(error?.statusCode) || 400, error.message);
      if (error?.code) wrapped.code = error.code;
      if (error?.interviewDemo) wrapped.interviewDemo = true;
      return wrapped;
    }
    return error;
  }

  return Object.freeze({ handle });
}

function assertDependencies({ database, store, sendJson, readJsonBody, makeHttpError }) {
  const databaseMethods = ["listRevisitStates", "markRevisitViewed", "markRevisitDismissed"];
  if (!database || databaseMethods.some((name) => typeof database[name] !== "function") ||
      !store || typeof store.listMemories !== "function" || typeof sendJson !== "function" ||
      typeof readJsonBody !== "function" || typeof makeHttpError !== "function") {
    throw new TypeError("createRevisitApi 依赖不完整。");
  }
}

module.exports = { createRevisitApi };
