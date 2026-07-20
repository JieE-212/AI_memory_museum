"use strict";

const ITEM_ID_PATTERN = /^[a-zA-Z0-9_-]{1,120}$/u;
const STATUS_SET = new Set(["pending", "dismissed", "accepted", "orphaned"]);
const CREATE_KEYS = new Set(["confirm", "displayName", "format", "mimeType", "rawBase64", "startOffset", "endOffset"]);
const ADMISSION_MEMORY_KEYS = new Set([
  "title", "exhibitText", "hall", "sourceType", "date", "location", "people", "tags",
  "emotions", "importance", "emotionIntensity", "favorite"
]);

function createMemoryInboxApi(options = {}) {
  const store = options.store;
  const normalizeMemory = options.normalizeMemory;
  const sendJson = options.sendJson;
  const readJsonBody = options.readJsonBody;
  const httpError = options.httpError;
  const interviewDemo = Boolean(options.interviewDemo);
  assertDependencies({ store, normalizeMemory, sendJson, readJsonBody, httpError });

  async function handle(request, response, url) {
    if (!url?.pathname.startsWith("/api/memory-inbox")) return false;

    if (request.method === "GET" && url.pathname === "/api/memory-inbox/sample") {
      assertNoQuery(url, httpError);
      return sendJson(response, 200, syntheticSample());
    }

    if (request.method === "GET" && url.pathname === "/api/memory-inbox") {
      const status = readOnlyStatusQuery(url, httpError);
      const items = store.listMemoryInboxItems(status ? { status } : {}).map(publicItem);
      return sendJson(response, 200, {
        items: items.map((item) => withSource(item, store)),
        counts: store.getMemoryInboxStats(),
        demo: interviewDemo,
        persisted: !interviewDemo
      });
    }

    const itemMatch = url.pathname.match(/^\/api\/memory-inbox\/items\/([a-zA-Z0-9_-]{1,120})$/u);
    if (request.method === "GET" && itemMatch) {
      assertNoQuery(url, httpError);
      const item = requireItem(store, itemMatch[1], httpError);
      response.setHeader("ETag", memoryInboxEtag(item));
      return sendJson(response, 200, { item: withSource(publicItem(item), store) });
    }

    if (!["GET", "HEAD"].includes(request.method) && interviewDemo) {
      return sendJson(response, 403, {
        error: "公开 Demo 的记忆收件箱只展示合成样例，不读取文件请求体，也不写入馆藏。",
        code: "MEMORY_INBOX_DEMO_READ_ONLY",
        interviewDemo: true
      });
    }

    if (request.method === "POST" && url.pathname === "/api/memory-inbox/items") {
      assertNoQuery(url, httpError);
      const body = await readJsonBody(request);
      assertExactObject(body, CREATE_KEYS, "收件箱片段", httpError);
      if (body.confirm !== true) throw httpError(400, "加入收件箱前必须明确确认。", "MEMORY_INBOX_CONFIRMATION_REQUIRED");
      const { confirm: _confirmed, ...selection } = body;
      const result = store.createMemoryInboxItem(selection, {
        idempotencyKey: requireIdempotencyKey(request, httpError)
      });
      const item = withSource(publicItem(result.item), store, result.source);
      response.setHeader("ETag", memoryInboxEtag(result.item));
      return sendJson(response, result.created ? 201 : 200, { ...result, item });
    }

    const actionMatch = url.pathname.match(/^\/api\/memory-inbox\/items\/([a-zA-Z0-9_-]{1,120})\/(dismiss|reopen|admit)$/u);
    if (request.method === "POST" && actionMatch) {
      assertNoQuery(url, httpError);
      const [, itemId, action] = actionMatch;
      const expectedVersion = requireIfMatch(request, httpError);
      const body = await readJsonBody(request);
      if (action === "admit") {
        assertExactObject(body, new Set(["confirm", "memory"]), "确认入馆请求", httpError);
        if (body.confirm !== true) throw httpError(400, "确认入馆需要 confirm: true。", "MEMORY_INBOX_CONFIRMATION_REQUIRED");
        assertExactObject(body.memory, ADMISSION_MEMORY_KEYS, "展品草稿", httpError);
        const memory = normalizeMemory({ ...body.memory, rawContent: "", agentRunId: "" });
        const result = store.admitMemoryInboxItem(itemId, memory, {
          confirm: true,
          expectedVersion,
          idempotencyKey: requireIdempotencyKey(request, httpError)
        });
        response.setHeader("ETag", memoryInboxEtag(result.item));
        return sendJson(response, result.admitted ? 201 : 200, {
          ...result,
          item: withSource(publicItem(result.item), store),
          memory: result.memory
        });
      }

      assertExactObject(body, new Set(["confirm"]), action === "dismiss" ? "暂不处理请求" : "重新打开请求", httpError);
      if (body.confirm !== true) throw httpError(400, "状态变更需要 confirm: true。", "MEMORY_INBOX_CONFIRMATION_REQUIRED");
      const result = action === "dismiss"
        ? store.dismissMemoryInboxItem(itemId, { confirm: true, expectedVersion })
        : store.reopenMemoryInboxItem(itemId, { confirm: true, expectedVersion });
      response.setHeader("ETag", memoryInboxEtag(result.item));
      return sendJson(response, 200, { ...result, item: withSource(publicItem(result.item), store) });
    }

    if (url.pathname.startsWith("/api/memory-inbox")) {
      throw httpError(request.method === "GET" ? 404 : 405, request.method === "GET" ? "记忆收件箱接口不存在。" : "记忆收件箱不支持该请求方法。");
    }
    return false;
  }

  return Object.freeze({ handle });
}

function withSource(item, store, sourceValue) {
  const source = sourceValue || store.getMemoryInboxSource(item.sourceId);
  return {
    ...item,
    etag: memoryInboxEtag(item),
    source: source ? {
      displayName: source.displayName,
      format: source.format,
      mimeType: source.mimeType,
      byteSize: source.byteSize,
      encoding: source.encoding,
      offsetUnit: source.offsetUnit,
      retentionMode: source.retentionMode,
      sourceKey: source.sourceKey,
      rawSha256: source.rawSha256
    } : null,
    anchor: {
      anchorKey: item.anchorKey,
      startOffset: item.startOffset,
      endOffset: item.endOffset,
      startLine: item.startLine,
      startColumn: item.startColumn,
      endLine: item.endLine,
      endColumn: item.endColumn,
      offsetUnit: item.offsetUnit,
      label: `第 ${item.startLine}–${item.endLine} 行 · UTF-16 精确区间`
    }
  };
}

function publicItem(item) {
  return {
    id: item.id,
    sourceId: item.sourceId,
    anchorKey: item.anchorKey,
    offsetUnit: item.offsetUnit,
    startOffset: item.startOffset,
    endOffset: item.endOffset,
    startLine: item.startLine,
    startColumn: item.startColumn,
    endLine: item.endLine,
    endColumn: item.endColumn,
    excerpt: item.excerpt,
    excerptSha256: item.excerptSha256,
    status: item.status,
    needsReview: Boolean(item.needsReview),
    memoryId: item.memoryId || "",
    version: item.version,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    dismissedAt: item.dismissedAt || "",
    acceptedAt: item.acceptedAt || ""
  };
}

function memoryInboxEtag(item) {
  return `\"memory-inbox-${Number(item?.version) || 1}\"`;
}

function requireIfMatch(request, httpError) {
  const raw = String(request.headers["if-match"] || "").trim();
  const match = raw.match(/^(?:W\/)?"(?:memory-inbox-)?([1-9]\d*)"$/u);
  if (!match) {
    const error = httpError(428, "缺少当前收件箱条目的 If-Match 版本条件。");
    error.code = "MEMORY_INBOX_PRECONDITION_REQUIRED";
    throw error;
  }
  const version = Number(match[1]);
  if (!Number.isSafeInteger(version)) throw httpError(400, "If-Match 版本无效。");
  return version;
}

function requireIdempotencyKey(request, httpError) {
  const value = String(request.headers["idempotency-key"] || "").trim();
  if (!/^[a-zA-Z0-9_-]{8,120}$/u.test(value)) {
    const error = httpError(400, "Idempotency-Key 必须包含 8 至 120 个字母、数字、下划线或连字符。");
    error.code = "MEMORY_INBOX_IDEMPOTENCY_KEY_INVALID";
    throw error;
  }
  return value;
}

function readOnlyStatusQuery(url, httpError) {
  const keys = [...url.searchParams.keys()];
  if (keys.some((key) => key !== "status") || url.searchParams.getAll("status").length > 1) {
    throw httpError(400, "收件箱列表只允许一个 status 查询参数。");
  }
  const status = url.searchParams.get("status") || "";
  if (status && !STATUS_SET.has(status)) throw httpError(400, "status 不是受支持的收件箱状态。");
  return status;
}

function requireItem(store, id, httpError) {
  if (!ITEM_ID_PATTERN.test(String(id || ""))) throw httpError(400, "收件箱条目 ID 无效。");
  const item = store.getMemoryInboxItem(id);
  if (!item) throw httpError(404, "没有找到这条收件箱记录。");
  return item;
}

function assertExactObject(value, keys, label, httpError) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw httpError(400, `${label}必须是 JSON 对象。`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw httpError(400, `${label}包含缺失或不支持的字段。`);
  }
}

function assertNoQuery(url, httpError) {
  if ([...url.searchParams.keys()].length) throw httpError(400, "该收件箱接口不接受查询参数。");
}

function syntheticSample() {
  return {
    demo: true,
    persisted: false,
    source: { displayName: "合成示例.md", encoding: "utf-8", retentionMode: "none" },
    excerpts: [
      "2024 年春天，我们在旧图书馆门口等雨停。\n没有人急着给这段往事下结论。",
      "后来翻到那天的聊天记录，我只想先保存逐字原文，再自己核对日期和人物。"
    ],
    boundary: "合成样例只用于预览；不会创建来源、条目或展品。"
  };
}

function assertDependencies({ store, normalizeMemory, sendJson, readJsonBody, httpError }) {
  const methods = [
    "listMemoryInboxItems", "getMemoryInboxStats", "getMemoryInboxSource", "getMemoryInboxItem",
    "createMemoryInboxItem", "dismissMemoryInboxItem", "reopenMemoryInboxItem", "admitMemoryInboxItem"
  ];
  if (!store || methods.some((name) => typeof store[name] !== "function") ||
      typeof normalizeMemory !== "function" || typeof sendJson !== "function" ||
      typeof readJsonBody !== "function" || typeof httpError !== "function") {
    throw new TypeError("createMemoryInboxApi 依赖不完整。");
  }
}

module.exports = { createMemoryInboxApi, memoryInboxEtag, publicItem, requireIfMatch, syntheticSample };
