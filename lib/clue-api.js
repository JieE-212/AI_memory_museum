"use strict";

const ENTITY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/u;
const ENTITY_ITEM_PATH = /^\/api\/entities\/([^/]+)$/u;
const ALIAS_COLLECTION_PATH = /^\/api\/entities\/([^/]+)\/aliases$/u;
const ALIAS_PREVIEW_PATH = /^\/api\/entities\/([^/]+)\/aliases\/preview$/u;
const ALIAS_ITEM_PATH = /^\/api\/entities\/([^/]+)\/aliases\/([^/]+)$/u;
const MERGE_PATH = /^\/api\/entities\/([^/]+)\/merge$/u;
const MERGE_PREVIEW_PATH = /^\/api\/entities\/([^/]+)\/merge\/preview$/u;
const ENTITY_TYPES = new Map([
  ["person", "person"],
  ["people", "person"],
  ["place", "location"],
  ["location", "location"],
  ["theme", "theme"],
  ["topic", "theme"],
  ["tag", "theme"]
]);
const PREVIEW_WARNING = "本次预览不会修改旧人物、地点或标签字段；只有再次确认后才会更新线索实体。";

function createClueApi(options = {}) {
  const store = options.store || options.database;
  const sendJson = options.sendJson;
  const readJsonBody = options.readJsonBody;
  const makeHttpError = options.httpError;
  const interviewDemo = Boolean(options.interviewDemo);
  const decorateMemory = typeof options.decorateMemory === "function" ? options.decorateMemory : (memory) => memory;
  assertDependencies({ store, sendJson, readJsonBody, makeHttpError });

  async function handle(request, response, url) {
    if (!isCluePath(url.pathname)) return false;

    try {
      if (url.pathname === "/api/search") return await handleSearch(request, response, url);
      if (url.pathname === "/api/entities") return await handleEntityList(request, response, url);

      let match = url.pathname.match(ALIAS_PREVIEW_PATH);
      if (match) return await handleAliasPreview(request, response, match[1]);
      match = url.pathname.match(ALIAS_COLLECTION_PATH);
      if (match) return await handleAliasCreate(request, response, match[1]);
      match = url.pathname.match(ALIAS_ITEM_PATH);
      if (match) return await handleAliasDelete(request, response, match[1], match[2]);
      match = url.pathname.match(MERGE_PREVIEW_PATH);
      if (match) return await handleMergePreview(request, response, match[1]);
      match = url.pathname.match(MERGE_PATH);
      if (match) return await handleMerge(request, response, match[1]);
      match = url.pathname.match(ENTITY_ITEM_PATH);
      if (match) return await handleEntityDetail(request, response, match[1]);

      throw apiError(400, "CLUE_ROUTE_INVALID", "实体线索地址无效。");
    } catch (error) {
      throw normalizeApiError(error, makeHttpError);
    }
  }

  async function handleSearch(request, response, url) {
    assertMethod(request, "GET", "搜索只支持 GET。", makeHttpError);
    const query = requiredText(
      url.searchParams.get("q") ?? url.searchParams.get("query"),
      160,
      "CLUE_QUERY_REQUIRED",
      "CLUE_QUERY_TOO_LONG",
      "请输入要寻找的记忆线索。",
      "搜索线索不能超过 160 个字符。"
    );
    const limit = strictLimit(url.searchParams.get("limit"), 50, 50);
    const search = typeof store.searchClues === "function" ? store.searchClues : store.searchMemories;
    const raw = await Promise.resolve(search.call(store, query, {
      limit,
      includeMeta: true,
      mode: "clue"
    }));
    const sourceResults = Array.isArray(raw) ? raw : Array.isArray(raw?.results) ? raw.results : [];
    const results = await Promise.all(sourceResults.slice(0, limit).map(async (item) => {
      let normalized = normalizeSearchResult(item);
      const decoratedMemory = await Promise.resolve(decorateMemory(normalized.memory));
      normalized = {
        ...normalized,
        memory: decoratedMemory || normalized.memory,
        entityRefs: normalizeEntityRefs(normalized.entityRefs.length ? normalized.entityRefs : decoratedMemory?.entityRefs)
      };
      if (!normalized.memory?.id || normalized.entityRefs.length || typeof store.getMemoryEntityRefs !== "function") {
        return normalized;
      }
      const refs = await Promise.resolve(store.getMemoryEntityRefs(normalized.memory.id));
      return { ...normalized, entityRefs: normalizeEntityRefs(refs) };
    }));
    const shortQueryFallback = Boolean(
      (!Array.isArray(raw) && (raw?.shortQueryFallback ?? raw?.usedFallback ?? raw?.engine?.shortQueryFallback))
    );
    return sendJson(response, 200, {
      query,
      count: results.length,
      results,
      engine: {
        mode: "clue",
        label: "字段与线索检索",
        fts: "fts5-trigram",
        shortQueryFallback
      }
    });
  }

  async function handleEntityList(request, response, url) {
    assertMethod(request, "GET", "实体档案列表只支持 GET。", makeHttpError);
    const type = normalizeEntityType(url.searchParams.get("kind") ?? url.searchParams.get("type"), true);
    const query = optionalText(url.searchParams.get("q") ?? url.searchParams.get("query"), 80, "CLUE_ENTITY_QUERY_TOO_LONG", "实体筛选词不能超过 80 个字符。");
    const limit = strictLimit(url.searchParams.get("limit"), 50, 100);
    const offset = strictOffset(url.searchParams.get("offset"));
    const raw = await Promise.resolve(store.listEntities({ type, kind: type, query, limit, offset }));
    const source = Array.isArray(raw) ? raw : Array.isArray(raw?.entities) ? raw.entities : [];
    const entities = source.slice(0, limit).map(normalizeEntity);
    return sendJson(response, 200, { entities, count: entities.length, type, query, offset });
  }

  async function handleEntityDetail(request, response, encodedId) {
    assertMethod(request, "GET", "实体档案详情只支持 GET。", makeHttpError);
    const id = strictId(encodedId, "CLUE_ENTITY_ID_INVALID", "实体 ID 无效。");
    const raw = await Promise.resolve(store.getEntityProfile(id));
    if (!raw) throw apiError(404, "CLUE_ENTITY_NOT_FOUND", "没有找到这个实体档案。");
    const entity = normalizeEntity(raw);
    return sendJson(response, 200, { entity, profile: entity });
  }

  async function handleAliasPreview(request, response, encodedId) {
    assertMethod(request, "POST", "别名预览只支持 POST。", makeHttpError);
    const entityId = strictId(encodedId, "CLUE_ENTITY_ID_INVALID", "实体 ID 无效。");
    const body = await readJsonBody(request);
    const alias = requiredText(body?.alias, 80, "CLUE_ALIAS_INVALID", "CLUE_ALIAS_TOO_LONG", "请输入要核对的别名。", "别名不能超过 80 个字符。");
    const preview = await Promise.resolve(store.previewEntityAlias(entityId, { alias }));
    return sendJson(response, 200, { preview, warning: PREVIEW_WARNING, requiresConfirmation: true });
  }

  async function handleAliasCreate(request, response, encodedId) {
    assertMethod(request, "POST", "新增别名只支持 POST。", makeHttpError);
    assertPersistentWritesAllowed();
    const entityId = strictId(encodedId, "CLUE_ENTITY_ID_INVALID", "实体 ID 无效。");
    const body = await readJsonBody(request);
    assertConfirmed(body);
    const alias = requiredText(body?.alias, 80, "CLUE_ALIAS_INVALID", "CLUE_ALIAS_TOO_LONG", "请输入要保存的别名。", "别名不能超过 80 个字符。");
    const result = await Promise.resolve(store.addEntityAlias(entityId, { alias, confirm: true }));
    return sendJson(response, 201, { ok: true, entityId, alias, result });
  }

  async function handleAliasDelete(request, response, encodedEntityId, encodedAliasId) {
    assertMethod(request, "DELETE", "删除别名只支持 DELETE。", makeHttpError);
    assertPersistentWritesAllowed();
    const entityId = strictId(encodedEntityId, "CLUE_ENTITY_ID_INVALID", "实体 ID 无效。");
    const aliasId = strictId(encodedAliasId, "CLUE_ALIAS_ID_INVALID", "别名 ID 无效。");
    const body = await readJsonBody(request);
    assertConfirmed(body);
    const result = await Promise.resolve(store.deleteEntityAlias(entityId, { aliasId, confirm: true }));
    return sendJson(response, 200, { ok: true, entityId, aliasId, result });
  }

  async function handleMergePreview(request, response, encodedTargetId) {
    assertMethod(request, "POST", "实体合并预览只支持 POST。", makeHttpError);
    const targetEntityId = strictId(encodedTargetId, "CLUE_ENTITY_ID_INVALID", "目标实体 ID 无效。");
    const body = await readJsonBody(request);
    const sourceEntityId = strictId(body?.sourceEntityId, "CLUE_MERGE_SOURCE_INVALID", "请选择要并入当前档案的来源实体。");
    assertDifferentEntities(sourceEntityId, targetEntityId);
    const preview = await Promise.resolve(store.previewEntityMerge({ sourceEntityId, targetEntityId }));
    return sendJson(response, 200, { preview, warning: PREVIEW_WARNING, requiresConfirmation: true });
  }

  async function handleMerge(request, response, encodedTargetId) {
    assertMethod(request, "POST", "确认实体合并只支持 POST。", makeHttpError);
    assertPersistentWritesAllowed();
    const targetEntityId = strictId(encodedTargetId, "CLUE_ENTITY_ID_INVALID", "目标实体 ID 无效。");
    const body = await readJsonBody(request);
    assertConfirmed(body);
    const sourceEntityId = strictId(body?.sourceEntityId, "CLUE_MERGE_SOURCE_INVALID", "请选择要并入当前档案的来源实体。");
    assertDifferentEntities(sourceEntityId, targetEntityId);
    const result = await Promise.resolve(store.mergeEntities({ sourceEntityId, targetEntityId, confirm: true }));
    return sendJson(response, 200, { ok: true, redirectEntityId: targetEntityId, result });
  }

  function assertPersistentWritesAllowed() {
    if (!interviewDemo) return;
    const error = apiError(403, "CLUE_DEMO_READ_ONLY", "公开 Demo 可以浏览实体档案和进行预览，但不会保存别名、删除或合并操作。");
    error.interviewDemo = true;
    throw error;
  }

  function assertConfirmed(body) {
    if (body?.confirm === true || body?.confirmed === true) return;
    throw apiError(400, "CLUE_CONFIRMATION_REQUIRED", "此操作需要先预览，再由用户明确确认。");
  }

  return Object.freeze({ handle });
}

function isCluePath(pathname) {
  return pathname === "/api/search" || pathname === "/api/entities" || pathname.startsWith("/api/entities/");
}

function assertMethod(request, expected, message, makeHttpError) {
  if (request.method === expected) return;
  const error = makeHttpError(405, message);
  error.code = "CLUE_METHOD_NOT_ALLOWED";
  error.allow = expected;
  throw error;
}

function strictLimit(value, fallback, maximum) {
  if (value === null || value === undefined || value === "") return fallback;
  if (!/^\d+$/u.test(String(value))) throw apiError(400, "CLUE_LIMIT_INVALID", `limit 必须是 1 至 ${maximum} 的整数。`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > maximum) {
    throw apiError(400, "CLUE_LIMIT_INVALID", `limit 必须是 1 至 ${maximum} 的整数。`);
  }
  return number;
}

function strictOffset(value) {
  if (value === null || value === undefined || value === "") return 0;
  if (!/^\d+$/u.test(String(value))) throw apiError(400, "CLUE_OFFSET_INVALID", "offset 必须是非负整数。");
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || number > 10000) {
    throw apiError(400, "CLUE_OFFSET_INVALID", "offset 必须是 0 至 10000 的整数。");
  }
  return number;
}

function strictId(value, code, message) {
  let id;
  try { id = decodeURIComponent(String(value ?? "")); } catch { throw apiError(400, code, message); }
  if (!ENTITY_ID_PATTERN.test(id)) throw apiError(400, code, message);
  return id;
}

function normalizeEntityType(value, optional = false) {
  const source = String(value ?? "").trim().toLowerCase();
  if (!source && optional) return "";
  const type = ENTITY_TYPES.get(source);
  if (!type) throw apiError(400, "CLUE_ENTITY_TYPE_INVALID", "实体类型只能是 person、location 或 theme。");
  return type;
}

function requiredText(value, maximum, emptyCode, longCode, emptyMessage, longMessage) {
  const text = String(value ?? "").replace(/\s+/gu, " ").trim();
  if (!text) throw apiError(400, emptyCode, emptyMessage);
  if ([...text].length > maximum) throw apiError(400, longCode, longMessage);
  return text;
}

function optionalText(value, maximum, code, message) {
  const text = String(value ?? "").replace(/\s+/gu, " ").trim();
  if ([...text].length > maximum) throw apiError(400, code, message);
  return text;
}

function assertDifferentEntities(sourceEntityId, targetEntityId) {
  if (sourceEntityId !== targetEntityId) return;
  throw apiError(400, "CLUE_MERGE_SAME_ENTITY", "不能把实体档案合并到自己。");
}

function normalizeSearchResult(value) {
  const source = value && typeof value === "object" ? value : {};
  const memory = source.memory && typeof source.memory === "object" ? source.memory : source;
  const confidenceSource = typeof source.confidence === "object" ? source.confidence.level : source.confidence;
  const confidence = ["strong", "medium", "weak"].includes(confidenceSource) ? confidenceSource : "weak";
  const evidence = normalizeEvidence(source.evidence);
  const entityRefs = normalizeEntityRefs(source.entityRefs || source.entityMatches);
  return {
    memory,
    score: Number.isFinite(Number(source.score)) ? Number(source.score) : 0,
    matchedTerms: uniqueStrings(source.matchedTerms, 24),
    matchedFields: uniqueStrings(source.matchedFields, 16),
    confidence,
    reason: String(source.reason || (typeof source.confidence === "object" ? source.confidence.reason : "") || "根据馆藏中的直接线索找到。"),
    evidence,
    entityRefs
  };
}

function normalizeEvidence(value) {
  return (Array.isArray(value) ? value : []).slice(0, 32).map((item) => ({
    kind: ["field", "entity", "rule-expansion"].includes(item?.kind) ? item.kind : "field",
    field: String(item?.field || ""),
    term: String(item?.term || ""),
    label: String(item?.label || item?.term || "线索命中"),
    ...(item?.entityId ? { entityId: String(item.entityId) } : {})
  }));
}

function normalizeEntityRefs(value) {
  return (Array.isArray(value) ? value : []).slice(0, 32).map((item) => ({
    id: String(item?.id || item?.entityId || ""),
    type: normalizeEntityTypeForOutput(item?.type || item?.kind),
    label: String(item?.label || item?.name || item?.canonicalName || "未命名线索"),
    matchedBy: String(item?.matchedBy || item?.alias || "")
  })).filter((item) => item.id && ENTITY_ID_PATTERN.test(item.id));
}

function normalizeEntity(value) {
  const source = value && typeof value === "object" ? value : {};
  const aliases = (Array.isArray(source.aliases) ? source.aliases : []).map((item) => (
    typeof item === "string"
      ? { id: "", value: item, label: item }
      : { ...item, id: String(item?.id || item?.aliasId || ""), value: String(item?.value || item?.alias || item?.label || ""), label: String(item?.label || item?.value || item?.alias || "") }
  ));
  return {
    ...source,
    id: String(source.id || source.entityId || ""),
    type: normalizeEntityTypeForOutput(source.type || source.kind),
    label: String(source.label || source.name || source.canonicalName || "未命名线索"),
    aliases
  };
}

function normalizeEntityTypeForOutput(value) {
  return ENTITY_TYPES.get(String(value || "").toLowerCase()) || "theme";
}

function uniqueStrings(value, maximum) {
  return [...new Set((Array.isArray(value) ? value : []).map((item) => String(item || "").trim()).filter(Boolean))].slice(0, maximum);
}

function apiError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function normalizeApiError(error, makeHttpError) {
  if (error?.statusCode && !String(error?.code || "").startsWith("CLUE_")) return error;
  if (error?.statusCode || error instanceof TypeError || error instanceof RangeError || String(error?.code || "").startsWith("CLUE_")) {
    const code = String(error?.code || "CLUE_REQUEST_INVALID");
    const status = Number(error?.statusCode) || statusForCode(code);
    const wrapped = makeHttpError(status, error.message || "实体线索请求无效。");
    wrapped.code = code;
    if (error?.interviewDemo) wrapped.interviewDemo = true;
    if (error?.allow) wrapped.allow = error.allow;
    return wrapped;
  }
  return error;
}

function statusForCode(code) {
  if (code.includes("NOT_FOUND")) return 404;
  if (code.includes("EXISTS") || code.includes("TYPE_MISMATCH")) return 409;
  return 400;
}

function assertDependencies({ store, sendJson, readJsonBody, makeHttpError }) {
  const hasSearch = typeof store?.searchClues === "function" || typeof store?.searchMemories === "function";
  const methods = [
    "listEntities", "getEntityProfile", "previewEntityAlias", "addEntityAlias",
    "deleteEntityAlias", "previewEntityMerge", "mergeEntities", "getMemoryEntityRefs"
  ];
  if (!store || !hasSearch || methods.some((name) => typeof store[name] !== "function") ||
      typeof sendJson !== "function" || typeof readJsonBody !== "function" || typeof makeHttpError !== "function") {
    throw new TypeError("createClueApi 依赖不完整。");
  }
}

module.exports = {
  PREVIEW_WARNING,
  createClueApi,
  normalizeSearchResult,
  normalizeEntity
};
