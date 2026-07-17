"use strict";

const { createHash } = require("node:crypto");

const REVISIT_KINDS = Object.freeze(["on-this-day", "long-unseen", "random"]);
const REVISIT_KIND_SET = new Set(REVISIT_KINDS);
const DEFAULT_LIMIT = 1;
const MAX_LIMIT = 20;
const ID_PATTERN = /^[a-zA-Z0-9_-]{1,120}$/;
const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;
const REVISIT_INTENTS = Object.freeze(["welcome", "later", "pause"]);
const REVISIT_INTENT_SET = new Set(REVISIT_INTENTS);

const KIND_EXPLANATIONS = Object.freeze({
  "on-this-day": "只从用户明确填写 YYYY-MM-DD 日期的往年记忆中选择，不使用保存时间推测周年。",
  "long-unseen": "从今天尚未处理的记忆中，优先选择从未回访或最久未回访的记录。",
  random: "使用本地日期、时区和展品 ID 生成稳定轮换顺序；同一天重复打开不会无故跳动。"
});

function selectRevisits(inputMemories, inputStates, options = {}) {
  const context = normalizeRevisitContext(options);
  const memories = normalizeMemories(inputMemories);
  const stateByMemory = normalizeStateIndex(inputStates);
  const intentByMemory = normalizeIntentIndex(options.intents);
  const selectionNow = normalizeSelectionNow(options.now);
  const eligible = memories.filter((memory) => !handledInContext(stateByMemory.get(memory.id), context));
  let candidates;

  if (context.kind === "on-this-day") {
    candidates = selectOnThisDay(eligible, stateByMemory, context);
  } else if (context.kind === "long-unseen") {
    candidates = selectLongUnseen(eligible, stateByMemory, context);
  } else {
    candidates = selectStableRandom(eligible, stateByMemory, context);
  }

  const withIntents = applyRevisitIntents(candidates, intentByMemory, selectionNow);
  return {
    kind: context.kind,
    localDate: context.localDate,
    timezone: context.timezone,
    limit: context.limit,
    candidateCount: withIntents.items.length,
    explanation: KIND_EXPLANATIONS[context.kind],
    emptyReason: withIntents.items.length
      ? ""
      : withIntents.filteredCount
        ? "符合本次回访方式的记忆，当前被你明确设置为稍后或暂停回访。"
        : emptyReasonFor(context.kind),
    items: withIntents.items.slice(0, context.limit).map((candidate, index) => ({
      ...candidate,
      rank: index + 1
    }))
  };
}

function applyRevisitIntents(candidates, intentByMemory, now) {
  const available = [];
  let filteredCount = 0;
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const intent = intentByMemory.get(memoryId(candidate));
    const status = evaluateIntent(intent, now);
    if (!status.available) {
      filteredCount += 1;
      continue;
    }
    const publicValue = publicIntent(intent);
    const suffix = status.choice === "welcome"
      ? "你曾明确选择愿意再次遇见它"
      : status.choice === "later"
        ? `已到你选择的 ${publicValue.notBeforeLocalDate}`
        : "";
    available.push({
      candidate: {
        ...candidate,
        intent: publicValue,
        reason: suffix ? `${candidate.reason} · ${suffix}` : candidate.reason,
        basis: suffix ? {
          ...candidate.basis,
          revisitIntent: {
            source: "user-confirmed",
            choice: status.choice,
            notBeforeLocalDate: publicValue.notBeforeLocalDate,
            timezone: publicValue.timezone
          }
        } : candidate.basis
      },
      explicit: status.choice === "welcome" || status.choice === "later",
      position: index
    });
  }
  available.sort((left, right) => Number(right.explicit) - Number(left.explicit) || left.position - right.position);
  return { items: available.map((entry) => entry.candidate), filteredCount };
}

function evaluateIntent(intent, now) {
  if (!intent) return { available: true, choice: "neutral" };
  if (intent.intent === "pause") return { available: false, choice: "pause" };
  if (intent.intent === "later") {
    const localDate = localDateAt(now, intent.notBeforeTimezone);
    return { available: localDate >= intent.notBeforeLocalDate, choice: "later" };
  }
  return { available: true, choice: "welcome" };
}

function publicIntent(intent) {
  if (!intent) return { choice: "neutral", notBeforeLocalDate: "", timezone: "", updatedAt: "" };
  return {
    choice: intent.intent,
    notBeforeLocalDate: intent.notBeforeLocalDate,
    timezone: intent.notBeforeTimezone,
    updatedAt: intent.updatedAt
  };
}

function selectOnThisDay(memories, stateByMemory, context) {
  const candidates = [];
  for (const memory of memories) {
    const sourceDate = parseExplicitCalendarDate(memory.date);
    if (!sourceDate || sourceDate.year >= context.year || sourceDate.month !== context.month || sourceDate.day !== context.day) continue;
    const yearsAgo = context.year - sourceDate.year;
    candidates.push({
      memory: memory.value,
      state: publicState(stateByMemory.get(memory.id)),
      reason: `${sourceDate.year} 年的今天 · ${yearsAgo} 周年`,
      basis: {
        type: "explicit-date",
        sourceDate: sourceDate.localDate,
        anniversaryYears: yearsAgo
      },
      sortDate: sourceDate.localDate
    });
  }
  return candidates
    .sort((left, right) => right.sortDate.localeCompare(left.sortDate, "en") || memoryId(left).localeCompare(memoryId(right), "en"))
    .map(withoutInternalSortFields);
}

function selectLongUnseen(memories, stateByMemory) {
  return memories.map((memory) => {
    const state = stateByMemory.get(memory.id);
    const lastViewedAt = validTimestamp(state?.lastViewedAt) ? state.lastViewedAt : "";
    const neverViewed = !lastViewedAt;
    return {
      memory: memory.value,
      state: publicState(state),
      reason: neverViewed ? "还没有回访过这件记忆" : `上次回访于 ${lastViewedAt.slice(0, 10)}`,
      basis: {
        type: neverViewed ? "never-viewed" : "last-viewed",
        lastViewedAt
      },
      neverViewed,
      sortTimestamp: neverViewed ? sortableTimestamp(memory.createdAt, Number.MAX_SAFE_INTEGER) : Date.parse(lastViewedAt)
    };
  }).sort((left, right) => (
    Number(right.neverViewed) - Number(left.neverViewed) ||
    left.sortTimestamp - right.sortTimestamp ||
    memoryId(left).localeCompare(memoryId(right), "en")
  )).map(withoutInternalSortFields);
}

function selectStableRandom(memories, stateByMemory, context) {
  const seed = `${context.localDate}\u0000${context.timezone}`;
  return memories.map((memory) => ({
    memory: memory.value,
    state: publicState(stateByMemory.get(memory.id)),
    reason: `${context.localDate} · ${context.timezone} 的稳定随机漫游`,
    basis: {
      type: "stable-daily-rotation",
      localDate: context.localDate,
      timezone: context.timezone
    },
    stableOrder: createHash("sha256").update(`${seed}\u0000${memory.id}`, "utf8").digest("hex")
  })).sort((left, right) => (
    left.stableOrder.localeCompare(right.stableOrder, "en") || memoryId(left).localeCompare(memoryId(right), "en")
  )).map(withoutInternalSortFields);
}

function normalizeRevisitContext(options = {}) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw revisitError("回访上下文必须是对象。", "REVISIT_CONTEXT_INVALID");
  }
  const kind = String(options.kind || "on-this-day").trim();
  if (!REVISIT_KIND_SET.has(kind)) {
    throw revisitError("kind 必须是 on-this-day、long-unseen 或 random。", "REVISIT_KIND_INVALID");
  }
  const local = normalizeLocalContext(options);
  return {
    ...local,
    kind,
    limit: normalizeLimit(options.limit)
  };
}

function normalizeLocalContext(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw revisitError("本地日期上下文必须是对象。", "REVISIT_CONTEXT_INVALID");
  }
  const parsed = parseExplicitCalendarDate(input.localDate);
  if (!parsed) {
    throw revisitError("localDate 必须是有效的 YYYY-MM-DD 本地日期。", "REVISIT_LOCAL_DATE_INVALID");
  }
  const timezone = normalizeTimezone(input.timezone);
  return { ...parsed, timezone };
}

function parseExplicitCalendarDate(value) {
  if (typeof value !== "string") return null;
  const match = LOCAL_DATE_PATTERN.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return { localDate: value, year, month, day };
}

function normalizeTimezone(value) {
  const timezone = typeof value === "string" ? value.trim() : "";
  if (!timezone || timezone.length > 100 || timezone.includes("\u0000")) {
    throw revisitError("timezone 必须是明确的 IANA 时区。", "REVISIT_TIMEZONE_INVALID");
  }
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: timezone }).resolvedOptions().timeZone;
  } catch {
    throw revisitError("timezone 不是当前运行环境支持的 IANA 时区。", "REVISIT_TIMEZONE_INVALID");
  }
}

function normalizeLimit(value) {
  if (value === undefined || value === null || value === "") return DEFAULT_LIMIT;
  const text = String(value).trim();
  if (!/^\d+$/u.test(text)) throw revisitError("limit 必须是整数。", "REVISIT_LIMIT_INVALID");
  const limit = Number(text);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw revisitError(`limit 必须是 1 至 ${MAX_LIMIT}。`, "REVISIT_LIMIT_INVALID");
  }
  return limit;
}

function normalizeMemories(value) {
  if (!Array.isArray(value)) throw revisitError("memories 必须是数组。", "REVISIT_MEMORIES_INVALID");
  const seen = new Set();
  const memories = [];
  for (let index = 0; index < value.length; index += 1) {
    const memory = value[index];
    if (!memory || typeof memory !== "object" || Array.isArray(memory)) {
      throw revisitError(`memories[${index}] 格式无效。`, "REVISIT_MEMORY_INVALID");
    }
    const id = requireId(memory.id, `memories[${index}].id`);
    if (seen.has(id)) continue;
    seen.add(id);
    memories.push({
      id,
      date: typeof memory.date === "string" ? memory.date : "",
      createdAt: validTimestamp(memory.createdAt) ? memory.createdAt : "",
      value: memory
    });
  }
  return memories;
}

function normalizeStateIndex(value) {
  const output = new Map();
  if (value === undefined || value === null) return output;
  const entries = value instanceof Map ? [...value.entries()] : Array.isArray(value)
    ? value.map((state) => [state?.memoryId, state])
    : (() => { throw revisitError("states 必须是数组或 Map。", "REVISIT_STATES_INVALID"); })();
  for (const [key, input] of entries) {
    if (!input || typeof input !== "object" || Array.isArray(input)) continue;
    const memoryId = ID_PATTERN.test(String(input.memoryId || key || "").trim()) ? String(input.memoryId || key).trim() : "";
    if (!memoryId) continue;
    const state = {
      memoryId,
      lastViewedAt: validTimestamp(input.lastViewedAt) ? input.lastViewedAt : "",
      lastViewedLocalDate: parseExplicitCalendarDate(input.lastViewedLocalDate)?.localDate || "",
      lastViewedTimezone: safeTimezone(input.lastViewedTimezone),
      viewCount: Number.isSafeInteger(input.viewCount) && input.viewCount >= 0 ? input.viewCount : 0,
      dismissedLocalDate: parseExplicitCalendarDate(input.dismissedLocalDate)?.localDate || "",
      dismissedTimezone: safeTimezone(input.dismissedTimezone),
      lastDismissedAt: validTimestamp(input.lastDismissedAt) ? input.lastDismissedAt : "",
      updatedAt: validTimestamp(input.updatedAt) ? input.updatedAt : ""
    };
    const current = output.get(memoryId);
    if (!current || sortableTimestamp(state.updatedAt, 0) >= sortableTimestamp(current.updatedAt, 0)) output.set(memoryId, state);
  }
  return output;
}

function normalizeIntentIndex(value) {
  const output = new Map();
  if (value === undefined || value === null) return output;
  const entries = value instanceof Map ? [...value.entries()] : Array.isArray(value)
    ? value.map((intent) => [intent?.memoryId, intent])
    : (() => { throw revisitError("intents 必须是数组或 Map。", "REVISIT_INTENTS_INVALID"); })();
  for (const [key, input] of entries) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw revisitError("回访意愿必须是对象。", "REVISIT_INTENT_INVALID");
    }
    const memoryId = String(input.memoryId || key || "").trim();
    if (!ID_PATTERN.test(memoryId)) throw revisitError("回访意愿 memoryId 无效。", "REVISIT_INTENT_INVALID");
    const intent = String(input.intent || input.choice || "").trim();
    if (!REVISIT_INTENT_SET.has(intent)) throw revisitError("回访意愿必须是 welcome、later 或 pause。", "REVISIT_INTENT_INVALID");
    let notBeforeLocalDate = "";
    let notBeforeTimezone = "";
    if (intent === "later") {
      const local = normalizeLocalContext({
        localDate: input.notBeforeLocalDate,
        timezone: input.notBeforeTimezone || input.timezone
      });
      notBeforeLocalDate = local.localDate;
      notBeforeTimezone = local.timezone;
    } else if (input.notBeforeLocalDate || input.notBeforeTimezone || input.timezone) {
      throw revisitError("只有 later 回访意愿可以带延后日期与时区。", "REVISIT_INTENT_INVALID");
    }
    const normalized = {
      memoryId,
      intent,
      notBeforeLocalDate,
      notBeforeTimezone,
      updatedAt: validTimestamp(input.updatedAt) ? input.updatedAt : ""
    };
    const current = output.get(memoryId);
    if (!current || sortableTimestamp(normalized.updatedAt, 0) >= sortableTimestamp(current.updatedAt, 0)) {
      output.set(memoryId, normalized);
    }
  }
  return output;
}

function normalizeSelectionNow(value) {
  if (value === undefined || value === null || value === "") return new Date().toISOString();
  if (!validTimestamp(value)) throw revisitError("now 必须是有效时间戳。", "REVISIT_NOW_INVALID");
  return value;
}

function localDateAt(timestamp, timezone) {
  try {
    const parts = new Intl.DateTimeFormat("en", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(new Date(timestamp));
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const localDate = `${values.year}-${values.month}-${values.day}`;
    if (!parseExplicitCalendarDate(localDate)) throw new Error("invalid local date");
    return localDate;
  } catch {
    throw revisitError("无法按回访意愿保存的时区计算当前日期。", "REVISIT_INTENT_TIMEZONE_INVALID");
  }
}

function handledInContext(state, context) {
  if (!state) return false;
  const viewed = state.lastViewedLocalDate === context.localDate && state.lastViewedTimezone === context.timezone;
  const dismissed = state.dismissedLocalDate === context.localDate && state.dismissedTimezone === context.timezone;
  return viewed || dismissed;
}

function publicState(state) {
  return {
    viewCount: Number.isSafeInteger(state?.viewCount) ? state.viewCount : 0,
    lastViewedAt: validTimestamp(state?.lastViewedAt) ? state.lastViewedAt : ""
  };
}

function withoutInternalSortFields(candidate) {
  const { sortDate, sortTimestamp, neverViewed, stableOrder, ...publicCandidate } = candidate;
  return publicCandidate;
}

function memoryId(candidate) {
  return String(candidate?.memory?.id || "");
}

function sortableTimestamp(value, fallback) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : fallback;
}

function validTimestamp(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 40 && Number.isFinite(Date.parse(value));
}

function safeTimezone(value) {
  try {
    return value ? normalizeTimezone(value) : "";
  } catch {
    return "";
  }
}

function daysInMonth(year, month) {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function requireId(value, name) {
  const id = String(value || "").trim();
  if (!ID_PATTERN.test(id)) throw revisitError(`${name} 无效。`, "REVISIT_MEMORY_ID_INVALID");
  return id;
}

function emptyReasonFor(kind) {
  if (kind === "on-this-day") return "今天没有符合条件且尚未处理的明确日期记忆。";
  if (kind === "long-unseen") return "今天可回访的记忆已经处理完了。";
  return "今天没有可用于随机漫游的记忆。";
}

function revisitError(message, code, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

module.exports = {
  DEFAULT_REVISIT_LIMIT: DEFAULT_LIMIT,
  MAX_REVISIT_LIMIT: MAX_LIMIT,
  REVISIT_INTENTS,
  REVISIT_KINDS,
  normalizeLocalContext,
  normalizeRevisitContext,
  parseExplicitCalendarDate,
  selectRevisits
};
