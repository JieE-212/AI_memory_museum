"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { PREVIEW_WARNING, createClueApi } = require("../lib/clue-api");

const projectRoot = path.join(__dirname, "..");
const frontendSource = fs.readFileSync(path.join(projectRoot, "public", "assets", "clues.js"), "utf8");
const cssSource = fs.readFileSync(path.join(projectRoot, "public", "clues.css"), "utf8");
let assertions = 0;

function check(condition, message) {
  assertions += 1;
  assert.ok(condition, message);
}

function equal(actual, expected, message) {
  assertions += 1;
  assert.equal(actual, expected, message);
}

function throws(fn, matcher, message) {
  assertions += 1;
  assert.throws(fn, matcher, message);
}

const calls = {
  search: [],
  refs: [],
  list: [],
  detail: [],
  aliasPreview: [],
  aliasAdd: [],
  aliasDelete: [],
  mergePreview: [],
  merge: []
};

const store = {
  searchClues(query, options) {
    calls.search.push({ query, options });
    return {
      usedFallback: true,
      results: [
        {
          memory: { id: "memory_1", title: "和阿岚去西湖" },
          score: 18.25,
          matchedTerms: ["阿岚", "朋友"],
          matchedFields: ["people", "rawContent"],
          confidence: "strong",
          reason: "人物别名与原文同时命中",
          evidence: [{ kind: "field", field: "rawContent", term: "阿岚", label: "原始故事" }]
        },
        {
          memory: { id: "memory_2", title: "湖边散步" },
          score: 7,
          matchedTerms: ["西湖"],
          matchedFields: ["entity"],
          confidence: "medium",
          reason: "地点实体命中",
          entityMatches: [{ entityId: "place_westlake", type: "location", label: "西湖" }]
        }
      ]
    };
  },
  listEntities(input) {
    calls.list.push(input);
    return [
      { entityId: "person_lan", kind: "people", canonicalName: "阿岚", memoryCount: 2 },
      { id: "person_zhou", type: "person", label: "小周", memoryCount: 1 }
    ];
  },
  getEntityProfile(id) {
    calls.detail.push(id);
    if (id === "missing") return null;
    return {
      entityId: id,
      kind: "people",
      canonicalName: "阿岚",
      aliases: [{ aliasId: "alias_1", alias: "岚岚" }],
      memories: [{ id: "memory_1", title: "和阿岚去西湖" }]
    };
  },
  getMemoryEntityRefs(memoryId) {
    calls.refs.push(memoryId);
    return [{ entityId: "person_lan", kind: "people", canonicalName: "阿岚", matchedBy: "阿岚" }];
  },
  previewEntityAlias(entityId, input) {
    calls.aliasPreview.push({ entityId, input });
    return { alias: input.alias, affectedMemoryCount: 2 };
  },
  addEntityAlias(entityId, input) {
    calls.aliasAdd.push({ entityId, input });
    if (input.alias === "重复") {
      const error = new Error("别名已存在。");
      error.code = "CLUE_ALIAS_EXISTS";
      throw error;
    }
    return { id: "alias_2", alias: input.alias };
  },
  deleteEntityAlias(entityId, input) {
    calls.aliasDelete.push({ entityId, input });
    return { removed: true };
  },
  previewEntityMerge(input) {
    calls.mergePreview.push(input);
    return { movedMemoryCount: 3 };
  },
  mergeEntities(input) {
    calls.merge.push(input);
    return { targetEntityId: input.targetEntityId, removedEntityId: input.sourceEntityId };
  }
};

function makeApi(sourceStore = store, interviewDemo = false) {
  return createClueApi({
    store: sourceStore,
    interviewDemo,
    sendJson(response, statusCode, payload) {
      response.statusCode = statusCode;
      response.payload = payload;
      return true;
    },
    async readJsonBody(request) {
      return request.body || {};
    },
    httpError(statusCode, message) {
      const error = new Error(message);
      error.statusCode = statusCode;
      return error;
    }
  });
}

async function invoke(api, method, route, body) {
  const request = { method, body };
  const response = {};
  try {
    const handled = await api.handle(request, response, new URL(route, "http://127.0.0.1"));
    return { handled, response };
  } catch (error) {
    return { error, response };
  }
}

function expectError(result, statusCode, code, label) {
  check(result.error instanceof Error, `${label} 应抛出错误`);
  equal(result.error.statusCode, statusCode, `${label} 状态码`);
  equal(result.error.code, code, `${label} 错误码`);
}

async function checkApi() {
  throws(() => createClueApi({}), /依赖不完整/u, "缺少依赖必须提前失败");
  const api = makeApi();
  const unrelated = await invoke(api, "GET", "/api/memories");
  equal(unrelated.handled, false, "非线索路由应交还主服务器");

  const search = await invoke(api, "GET", "/api/search?q=%E9%98%BF%E5%B2%9A&limit=2&mode=hybrid");
  equal(search.response.statusCode, 200, "q 搜索成功");
  equal(search.response.payload.engine.mode, "clue", "搜索引擎统一为 clue");
  equal(search.response.payload.engine.label, "语义线索检索", "搜索引擎有用户可读标签");
  equal(search.response.payload.engine.fts, "fts5-trigram", "搜索引擎声明 FTS5 trigram");
  equal(search.response.payload.engine.shortQueryFallback, true, "短词回退只透传 store metadata");
  equal(search.response.payload.results.length, 2, "搜索保留结果");
  equal(search.response.payload.results[0].memory.id, "memory_1", "兼容 memory 字段");
  equal(search.response.payload.results[0].score, 18.25, "兼容 score 字段");
  equal(search.response.payload.results[0].confidence, "strong", "兼容 confidence 字段");
  equal(search.response.payload.results[0].reason, "人物别名与原文同时命中", "兼容 reason 字段");
  check(search.response.payload.results[0].matchedTerms.includes("阿岚"), "兼容 matchedTerms 字段");
  check(search.response.payload.results[0].matchedFields.includes("people"), "兼容 matchedFields 字段");
  equal(search.response.payload.results[0].evidence[0].kind, "field", "返回检索 evidence");
  equal(search.response.payload.results[0].entityRefs[0].type, "person", "缺失实体引用时从 store 补齐并规范类型");
  equal(search.response.payload.results[1].entityRefs[0].type, "location", "entityMatches 兼容为 entityRefs 且沿用持久层类型");
  equal(calls.search[0].options.mode, "clue", "旧 mode 参数不会改变新引擎");
  equal(calls.search[0].options.limit, 2, "严格 limit 传入 store");
  check(calls.refs.includes("memory_1"), "API 会补齐记忆实体引用");

  const queryAlias = await invoke(api, "GET", "/api/search?query=%E8%A5%BF%E6%B9%96");
  equal(queryAlias.response.payload.query, "西湖", "兼容 query 参数");
  expectError(await invoke(api, "POST", "/api/search?q=x"), 405, "CLUE_METHOD_NOT_ALLOWED", "搜索错误方法");
  expectError(await invoke(api, "GET", "/api/search?q=%20%20"), 400, "CLUE_QUERY_REQUIRED", "空搜索词");
  expectError(await invoke(api, "GET", `/api/search?q=${encodeURIComponent("记".repeat(161))}`), 400, "CLUE_QUERY_TOO_LONG", "过长搜索词");
  for (const value of ["0", "101", "1.5", "x", "-1"]) {
    expectError(await invoke(api, "GET", `/api/search?q=x&limit=${encodeURIComponent(value)}`), 400, "CLUE_LIMIT_INVALID", `非法 limit ${value}`);
  }

  const entities = await invoke(api, "GET", "/api/entities?kind=people&q=%E5%B2%9A&limit=20&offset=0");
  equal(entities.response.statusCode, 200, "实体列表成功");
  equal(calls.list.at(-1).type, "person", "kind 兼容并传出 canonical type");
  equal(calls.list.at(-1).query, "岚", "实体列表传入 query");
  equal(entities.response.payload.entities[0].type, "person", "实体列表统一输出 type");
  equal(entities.response.payload.entities[0].label, "阿岚", "实体列表统一输出 label");
  const typeAlias = await invoke(api, "GET", "/api/entities?type=location");
  equal(typeAlias.response.payload.type, "location", "type 参数兼容 location 并保持统一类型");
  expectError(await invoke(api, "GET", "/api/entities?type=unknown"), 400, "CLUE_ENTITY_TYPE_INVALID", "非法实体类型");
  expectError(await invoke(api, "GET", `/api/entities?q=${"x".repeat(81)}`), 400, "CLUE_ENTITY_QUERY_TOO_LONG", "过长实体筛选词");
  expectError(await invoke(api, "GET", "/api/entities?offset=-1"), 400, "CLUE_OFFSET_INVALID", "非法 offset");
  expectError(await invoke(api, "POST", "/api/entities"), 405, "CLUE_METHOD_NOT_ALLOWED", "实体列表错误方法");

  const detail = await invoke(api, "GET", "/api/entities/person_lan");
  equal(detail.response.payload.entity.id, "person_lan", "实体详情统一 ID");
  equal(detail.response.payload.entity.type, "person", "实体详情统一 type");
  equal(detail.response.payload.entity.aliases[0].id, "alias_1", "实体别名统一 ID");
  expectError(await invoke(api, "GET", "/api/entities/missing"), 404, "CLUE_ENTITY_NOT_FOUND", "缺失实体");
  expectError(await invoke(api, "GET", "/api/entities/%E4%BA%BA"), 400, "CLUE_ENTITY_ID_INVALID", "非法实体 ID");
  expectError(await invoke(api, "POST", "/api/entities/person_lan"), 405, "CLUE_METHOD_NOT_ALLOWED", "实体详情错误方法");

  const aliasPreviewWrites = calls.aliasAdd.length + calls.aliasDelete.length;
  const aliasPreview = await invoke(api, "POST", "/api/entities/person_lan/aliases/preview", { alias: "岚岚" });
  equal(aliasPreview.response.statusCode, 200, "别名预览成功");
  equal(aliasPreview.response.payload.warning, PREVIEW_WARNING, "别名预览明确旧字段零修改");
  equal(aliasPreview.response.payload.requiresConfirmation, true, "别名预览要求二次确认");
  equal(calls.aliasAdd.length + calls.aliasDelete.length, aliasPreviewWrites, "别名预览零写入");
  expectError(await invoke(api, "GET", "/api/entities/person_lan/aliases/preview"), 405, "CLUE_METHOD_NOT_ALLOWED", "别名预览错误方法");
  expectError(await invoke(api, "POST", "/api/entities/person_lan/aliases/preview", { alias: "" }), 400, "CLUE_ALIAS_INVALID", "空别名");
  expectError(await invoke(api, "POST", "/api/entities/person_lan/aliases/preview", { alias: "名".repeat(81) }), 400, "CLUE_ALIAS_TOO_LONG", "过长别名");

  expectError(await invoke(api, "POST", "/api/entities/person_lan/aliases", { alias: "小岚" }), 400, "CLUE_CONFIRMATION_REQUIRED", "别名未确认");
  const aliasCreate = await invoke(api, "POST", "/api/entities/person_lan/aliases", { alias: "小岚", confirm: true });
  equal(aliasCreate.response.statusCode, 201, "确认后新增别名");
  equal(calls.aliasAdd.at(-1).input.confirm, true, "新增别名向 store 传确认标记");
  expectError(await invoke(api, "POST", "/api/entities/person_lan/aliases", { alias: "重复", confirm: true }), 409, "CLUE_ALIAS_EXISTS", "store 冲突映射为 409");

  expectError(await invoke(api, "DELETE", "/api/entities/person_lan/aliases/alias_1", {}), 400, "CLUE_CONFIRMATION_REQUIRED", "删除别名未确认");
  expectError(await invoke(api, "DELETE", "/api/entities/person_lan/aliases/%E5%88%AB%E5%90%8D", { confirm: true }), 400, "CLUE_ALIAS_ID_INVALID", "非法别名 ID");
  const aliasDelete = await invoke(api, "DELETE", "/api/entities/person_lan/aliases/alias_1", { confirm: true });
  equal(aliasDelete.response.statusCode, 200, "确认后删除别名");
  equal(calls.aliasDelete.at(-1).input.aliasId, "alias_1", "删除传入 aliasId");

  const mergeWrites = calls.merge.length;
  const mergePreview = await invoke(api, "POST", "/api/entities/person_lan/merge/preview", { sourceEntityId: "person_zhou" });
  equal(mergePreview.response.statusCode, 200, "合并预览成功");
  equal(mergePreview.response.payload.warning, PREVIEW_WARNING, "合并预览明确旧字段零修改");
  equal(calls.merge.length, mergeWrites, "合并预览零写入");
  equal(calls.mergePreview.at(-1).targetEntityId, "person_lan", "路径实体是合并目标");
  expectError(await invoke(api, "POST", "/api/entities/person_lan/merge/preview", { sourceEntityId: "person_lan" }), 400, "CLUE_MERGE_SAME_ENTITY", "禁止自合并");
  expectError(await invoke(api, "POST", "/api/entities/person_lan/merge/preview", { sourceEntityId: "人" }), 400, "CLUE_MERGE_SOURCE_INVALID", "非法来源实体 ID");
  expectError(await invoke(api, "POST", "/api/entities/person_lan/merge", { sourceEntityId: "person_zhou" }), 400, "CLUE_CONFIRMATION_REQUIRED", "合并未确认");
  const merged = await invoke(api, "POST", "/api/entities/person_lan/merge", { sourceEntityId: "person_zhou", confirm: true });
  equal(merged.response.statusCode, 200, "确认后合并成功");
  equal(merged.response.payload.redirectEntityId, "person_lan", "合并成功指回保留目标实体");
  equal(calls.merge.at(-1).confirm, true, "合并向 store 传确认标记");

  const demoApi = makeApi(store, true);
  const beforeDemo = { aliasAdd: calls.aliasAdd.length, aliasDelete: calls.aliasDelete.length, merge: calls.merge.length };
  const demoSearch = await invoke(demoApi, "GET", "/api/search?q=%E9%98%BF%E5%B2%9A");
  equal(demoSearch.response.statusCode, 200, "Demo 可搜索");
  const demoDetail = await invoke(demoApi, "GET", "/api/entities/person_lan");
  equal(demoDetail.response.statusCode, 200, "Demo 可浏览档案");
  const demoAliasPreview = await invoke(demoApi, "POST", "/api/entities/person_lan/aliases/preview", { alias: "演示别名" });
  equal(demoAliasPreview.response.statusCode, 200, "Demo 可预览别名");
  const demoMergePreview = await invoke(demoApi, "POST", "/api/entities/person_lan/merge/preview", { sourceEntityId: "person_zhou" });
  equal(demoMergePreview.response.statusCode, 200, "Demo 可预览合并");
  expectError(await invoke(demoApi, "POST", "/api/entities/person_lan/aliases", { alias: "演示别名", confirm: true }), 403, "CLUE_DEMO_READ_ONLY", "Demo 禁止新增别名");
  expectError(await invoke(demoApi, "DELETE", "/api/entities/person_lan/aliases/alias_1", { confirm: true }), 403, "CLUE_DEMO_READ_ONLY", "Demo 禁止删除别名");
  expectError(await invoke(demoApi, "POST", "/api/entities/person_lan/merge", { sourceEntityId: "person_zhou", confirm: true }), 403, "CLUE_DEMO_READ_ONLY", "Demo 禁止合并");
  equal(calls.aliasAdd.length, beforeDemo.aliasAdd, "Demo 新增别名零写入");
  equal(calls.aliasDelete.length, beforeDemo.aliasDelete, "Demo 删除别名零写入");
  equal(calls.merge.length, beforeDemo.merge, "Demo 合并零写入");

  const legacyStore = { ...store };
  delete legacyStore.searchClues;
  legacyStore.searchMemories = (query, options) => [{
    id: "legacy_memory",
    title: query,
    confidence: { level: "weak", reason: "旧检索兼容" },
    score: 0
  }].slice(0, options.limit);
  const legacy = await invoke(makeApi(legacyStore), "GET", "/api/search?query=legacy&limit=1");
  equal(legacy.response.statusCode, 200, "兼容只有 searchMemories 的 store");
  equal(legacy.response.payload.results[0].memory.id, "legacy_memory", "兼容旧搜索的裸 memory 结果");
  equal(legacy.response.payload.engine.shortQueryFallback, false, "无 metadata 时不猜测短词回退");
}

function checkFrontend() {
  const sandbox = { globalThis: {} };
  vm.runInNewContext(frontendSource, sandbox, { filename: "public/assets/clues.js" });
  const clues = sandbox.globalThis.TimeIsleClues;
  check(clues && typeof clues === "object", "前端模块应导出 TimeIsleClues");
  check(typeof clues.normalizeSearchResponse === "function", "导出 normalizeSearchResponse");
  check(typeof clues.renderSearchEvidence === "function", "导出 renderSearchEvidence");
  check(typeof clues.createEntityDialogController === "function", "导出实体档案 controller");
  equal(clues.DIALOG_IDS.dialog, "entityDialog", "输出明确 DOM 合同");

  const normalized = clues.normalizeSearchResponse({
    query: "阿岚",
    engine: { shortQueryFallback: true },
    results: [{
      memory: { id: "memory_1", title: "一段记忆" },
      score: "9.5",
      confidence: { level: "strong", reason: "原文命中" },
      evidence: [{ kind: "field", field: "rawContent", term: "阿岚", label: "原始故事" }],
      entityRefs: [{ entityId: "person_lan", kind: "people", canonicalName: "阿岚" }]
    }]
  });
  equal(normalized.results[0].score, 9.5, "前端规范化 score");
  equal(normalized.results[0].confidence, "strong", "前端兼容对象 confidence");
  equal(normalized.results[0].entityRefs[0].type, "person", "前端规范化实体类型");
  equal(normalized.engine.shortQueryFallback, true, "前端保留短词回退提示");

  const hostile = clues.renderSearchEvidence({
    memory: { id: "memory_1" },
    confidence: "strong",
    reason: '<img src=x onerror="globalThis.pwned=1">',
    evidence: [{ field: "rawContent", term: "<script>bad()</script>", label: "</li><img src=x>" }],
    entityRefs: [{ id: "person_lan", type: "person", label: '阿岚" onclick="bad()' }]
  }, { shortQueryFallback: true });
  check(!hostile.includes("<script>"), "匹配依据转义 script");
  check(!hostile.includes("<img src=x"), "匹配依据转义注入标签");
  check(!hostile.includes('onclick="bad()"'), "实体 chip 属性转义");
  check(hostile.includes("&lt;script&gt;"), "转义后仍保留用户可读文本");
  check(hostile.includes('data-entity-id="person_lan"'), "实体 chip 使用委托 data-entity-id");
  check(hostile.includes("短词已使用兼容检索"), "短词回退以克制文案呈现");
  check(!hostile.includes("概率"), "score 不被描述为概率");

  throws(
    () => clues.createEntityDialogController({ document: { getElementById: () => null }, fetch: async () => ({ ok: true, text: async () => "{}" }) }),
    /缺少 DOM/u,
    "实体 controller 对 DOM 依赖提前失败"
  );

  const requiredFrontendContracts = [
    "[data-entity-id]",
    "data-entity-retry",
    "data-entity-alias-form",
    "data-alias-confirm",
    "data-alias-delete",
    "data-entity-merge-details",
    "data-entity-merge-form",
    "data-merge-confirm",
    "/aliases/preview",
    "/merge/preview",
    "redirectEntityId",
    "AbortController",
    "restoreFocus",
    "lastTriggerEntityId",
    "aria-busy",
    "Demo 不保存"
  ];
  requiredFrontendContracts.forEach((token) => check(frontendSource.includes(token), `前端合同缺少 ${token}`));
  check(frontendSource.includes("if (!profile || !aliasPreview || mutationBusy || demo) return"), "Demo 在客户端阻断别名确认");
  check(frontendSource.includes("if (!profile || mutationBusy || demo) return"), "Demo 在客户端阻断别名删除");
  check(frontendSource.includes("if (!profile || !mergePreview || mutationBusy || demo) return"), "Demo 在客户端阻断合并确认");
  check(!frontendSource.includes("localStorage"), "实体档案不在浏览器持久化私人状态");
  check(!frontendSource.includes("window.confirm"), "二次确认使用页面内渐进披露而非阻塞弹窗");
  check(!frontendSource.includes("/api/search?mode"), "单一搜索框不发送模式开关");
  check(!/TODO|FIXME|TEMP_HOOK/u.test(frontendSource), "前端没有临时钩子或墓碑标记");

  check(cssSource.includes("min-height: 44px"), "交互控件覆盖 44px 触控区");
  check(cssSource.includes("env(safe-area-inset-bottom)"), "移动档案对底部安全区留白");
  check(cssSource.includes("@media (max-width: 650px)"), "覆盖手机断点");
  check(cssSource.includes("@media (max-width: 390px)"), "覆盖 390/320 窄屏细化");
  check(cssSource.includes("grid-template-columns: 1fr"), "手机表单回落为单列");
  check(cssSource.includes("overflow-wrap: anywhere"), "长实体文本不会撑出横向溢出");
  check(!/gradient/iu.test(cssSource), "线索 UI 不使用渐变");
  check(!/TODO|FIXME|TEMP_HOOK/u.test(cssSource), "CSS 没有临时钩子或墓碑标记");

  console.log(`Entity dialog DOM contract: #${Object.values(clues.DIALOG_IDS).join(", #")} + [data-entity-close]; delegated opener: [data-entity-id].`);
}

(async () => {
  await checkApi();
  checkFrontend();
  console.log(`Clue API/UI checks passed: ${assertions} assertions.`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
