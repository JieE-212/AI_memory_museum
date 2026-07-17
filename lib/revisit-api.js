"use strict";

const { normalizeLocalContext, selectRevisits } = require("./revisit-service");

const ACTION_PATH = /^\/api\/revisits\/([a-zA-Z0-9_-]{1,120})\/(viewed|dismissed)$/u;
const INTENT_PATH = /^\/api\/revisits\/([a-zA-Z0-9_-]{1,120})\/intent$/u;
const INTENT_LIST_PATH = "/api/revisits/intents";
const INTENT_BODY_KEYS = new Set(["choice", "notBeforeLocalDate", "timezone", "confirm"]);
const INTENT_CHOICES = new Set(["neutral", "welcome", "later", "pause"]);
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
  const intentDatabase = options.intentDatabase || database;
  const now = typeof options.now === "function" ? options.now : () => new Date().toISOString();
  assertDependencies({ database, intentDatabase, store, sendJson, readJsonBody, makeHttpError });

  async function handle(request, response, url) {
    const actionMatch = url.pathname.match(ACTION_PATH);
    const intentMatch = url.pathname.match(INTENT_PATH);
    if (url.pathname !== "/api/revisits" && url.pathname !== INTENT_LIST_PATH && !actionMatch && !intentMatch) return false;

    try {
      if (url.pathname === INTENT_LIST_PATH) {
        if (request.method !== "GET") throw makeHttpError(405, "回访意愿列表只支持 GET。");
        assertNoQuery(url);
        const memoryById = new Map(store.listMemories().map((memory) => [String(memory?.id || ""), memory]));
        const intents = intentDatabase.listRevisitIntents().map((intent) => ({
          ...publicIntent(intent.memoryId, intent),
          memory: memorySummary(memoryById.get(intent.memoryId))
        }));
        return sendJson(response, 200, { count: intents.length, intents });
      }

      if (intentMatch) {
        assertNoQuery(url);
        const memoryId = intentMatch[1];
        requireMemory(memoryId);
        if (request.method === "GET") {
          return sendJson(response, 200, { intent: publicIntent(memoryId, intentDatabase.getRevisitIntent(memoryId)) });
        }
        if (request.method !== "PUT") throw makeHttpError(405, "单件回访意愿只支持 GET 或 PUT。");
        assertPersistentWritesAllowed();
        const body = await readJsonBody(request);
        const input = normalizeIntentBody(body);
        let action;
        let intent;
        if (input.choice === "neutral") {
          intentDatabase.clearRevisitIntent(memoryId);
          action = "cleared";
          intent = publicIntent(memoryId, null);
        } else {
          const saved = intentDatabase.setRevisitIntent({
            memoryId,
            intent: input.choice,
            notBeforeLocalDate: input.notBeforeLocalDate,
            notBeforeTimezone: input.timezone
          });
          action = "saved";
          intent = publicIntent(memoryId, saved);
        }
        return sendJson(response, 200, { ok: true, action, memoryId, intent });
      }

      if (url.pathname === "/api/revisits") {
        if (request.method !== "GET") throw makeHttpError(405, "记忆回访列表只支持 GET。");
        const selection = selector(store.listMemories(), database.listRevisitStates(), {
          kind: url.searchParams.get("kind") || "on-this-day",
          localDate: url.searchParams.get("localDate") || "",
          timezone: url.searchParams.get("timezone") || "",
          limit: url.searchParams.get("limit") || undefined,
          intents: intentDatabase.listRevisitIntents(),
          now: now()
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
    const error = makeHttpError(403, "公开 Demo 可以查看记忆回访，但不会保存浏览、隐藏或回访意愿。");
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

  function assertNoQuery(url) {
    if ([...url.searchParams.keys()].length) throw makeHttpError(400, "回访意愿接口不接受查询参数。");
  }

  function requireMemory(memoryId) {
    const memory = store.listMemories().find((item) => String(item?.id || "") === memoryId);
    if (!memory) throw makeHttpError(404, `没有找到展品 ${memoryId}。`);
    return memory;
  }

  function normalizeIntentBody(body) {
    if (!body || typeof body !== "object" || Array.isArray(body) ||
        (Object.getPrototypeOf(body) !== Object.prototype && Object.getPrototypeOf(body) !== null)) {
      throw makeHttpError(400, "回访意愿必须是 JSON 对象。");
    }
    const unknown = Object.keys(body).filter((key) => !INTENT_BODY_KEYS.has(key));
    if (unknown.length) throw makeHttpError(400, `回访意愿包含不支持的字段：${unknown.join(", ")}。`);
    if (body.confirm !== true) throw makeHttpError(400, "保存回访意愿前必须由用户明确确认。");
    const choice = String(body.choice || "").trim();
    if (!INTENT_CHOICES.has(choice)) throw makeHttpError(400, "choice 必须是 neutral、welcome、later 或 pause。");
    const notBeforeLocalDate = String(body.notBeforeLocalDate || "");
    const timezone = String(body.timezone || "");
    if (choice === "later") {
      const local = normalizeLocalContext({ localDate: notBeforeLocalDate, timezone });
      return { choice, notBeforeLocalDate: local.localDate, timezone: local.timezone };
    }
    if (notBeforeLocalDate || timezone) throw makeHttpError(400, "只有 later 意愿可以设置延后日期与时区。");
    return { choice, notBeforeLocalDate: "", timezone: "" };
  }
}

function assertDependencies({ database, intentDatabase, store, sendJson, readJsonBody, makeHttpError }) {
  const databaseMethods = ["listRevisitStates", "markRevisitViewed", "markRevisitDismissed"];
  const intentMethods = ["listRevisitIntents", "getRevisitIntent", "setRevisitIntent", "clearRevisitIntent"];
  if (!database || databaseMethods.some((name) => typeof database[name] !== "function") ||
      !intentDatabase || intentMethods.some((name) => typeof intentDatabase[name] !== "function") ||
      !store || typeof store.listMemories !== "function" || typeof sendJson !== "function" ||
      typeof readJsonBody !== "function" || typeof makeHttpError !== "function") {
    throw new TypeError("createRevisitApi 依赖不完整。");
  }
}

function publicIntent(memoryId, value) {
  return {
    memoryId,
    choice: value?.intent || "neutral",
    notBeforeLocalDate: value?.notBeforeLocalDate || "",
    timezone: value?.notBeforeTimezone || "",
    updatedAt: value?.updatedAt || ""
  };
}

function memorySummary(memory) {
  return { id: String(memory?.id || ""), title: String(memory?.title || "") };
}

module.exports = { createRevisitApi };
