const http = require("http");
const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
const { createMemoryStore } = require("./database");
const { createOperationsService } = require("./src/services/operations");
const { createHealthRoutes } = require("./src/routes/health");
const { createOperationsRoutes } = require("./src/routes/operations");

const PORT = Number(process.env.PORT) || 3000;
const ROOT_DIR = __dirname;
const DB_PATH = process.env.DB_PATH || path.join(ROOT_DIR, "data", "memory-museum.sqlite");
const SCHEMA_VERSION = 2;
const PHASE = 19;
const PHASE_NAME = "个人知识生态和外部导入版";
const APP_VERSION = "0.9.8";
const BUILD_LABEL = "phase19-import-audit-ninth-edition";
const RELEASE_CHANNEL = process.env.RELEASE_CHANNEL || "local-preview";
const OPERATION_EVENT_LIMIT = 80;
const OPERATION_LOG_PATH = process.env.OPERATIONS_LOG_PATH || path.join(ROOT_DIR, "data", "operations-events.jsonl");
const MAX_RAW_LENGTH = 2000;
const MAX_BODY_LENGTH = 2 * 1024 * 1024;
const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS) || 20000;
const operationEvents = [];
let operationsService;
let healthRoutes;
let operationsRoutes;

loadEnvFile(path.join(ROOT_DIR, ".env"));

const halls = [
  { id: "youth", name: "青春展厅", description: "校园、毕业、成长和那些没说完的话。" },
  { id: "friends", name: "朋友展厅", description: "朋友、室友、群聊和共同经历。" },
  { id: "family", name: "家庭展厅", description: "家人、饭桌、节日和被照顾的瞬间。" },
  { id: "low", name: "低谷展厅", description: "挫折、疲惫、失眠和重新站起来。" },
  { id: "strange", name: "奇怪瞬间展厅", description: "荒诞、尴尬、离谱但很难忘。" },
  { id: "daily", name: "日常展厅", description: "普通日子里值得留下的细节。" }
];

const emotionOptions = ["怀念", "快乐", "遗憾", "平静", "荒诞", "感动", "兴奋", "紧张", "孤独", "委屈", "愤怒", "害怕", "释然", "期待", "温暖", "迷茫"];
const sourceTypes = ["日记", "聊天片段", "照片描述", "旅行片段", "梦境", "物品", "图片", "截图", "语音转写", "其他"];
const importanceLabels = ["普通展品", "值得一看", "重要展品", "珍贵展品", "镇馆级"];
const attachmentTypeOrder = ["图片", "OCR", "语音", "文档", "视频", "其他"];
const agentRoles = [
  { id: "archivist", name: "档案员 Agent", duty: "提取人物、地点、时间、来源和原始线索" },
  { id: "curator", name: "策展人 Agent", duty: "判断展厅、情绪和珍藏级别" },
  { id: "editor", name: "编辑 Agent", duty: "生成标题、标签和展品说明" },
  { id: "guide", name: "讲解员 Agent", duty: "整理面向参观者的导览提示" }
];
const workflowTemplates = [
  {
    id: "memory-curation",
    name: "展品整理工作流",
    purpose: "把一段原始记忆整理成可保存、可复核、可追溯的展品。",
    entry: "/api/analyze",
    maturity: "active",
    statusLabel: "可运行",
    nodes: [
      { id: "archivist", agent: "档案员 Agent", stage: "线索提取", interruptible: true, evidence: ["rawContent", "people", "location", "date"] },
      { id: "curator", agent: "策展人 Agent", stage: "展厅与情绪判断", interruptible: true, evidence: ["hall", "emotions", "emotionIntensity", "importance"] },
      { id: "editor", agent: "编辑 Agent", stage: "展品草稿", interruptible: true, evidence: ["title", "tags", "exhibitText"] },
      { id: "guide", agent: "讲解员 Agent", stage: "导览准备", interruptible: false, evidence: ["savedMemory", "ragCandidate"] }
    ],
    controls: ["confirm", "reject", "retry", "save"],
    pausePoints: ["needs_review", "approved", "rejected"],
    riskSignals: ["缺少时间", "缺少人物地点", "展品说明过短"],
    nextActions: ["补齐复核项", "保存工作流快照", "回看整理历史"],
    persistence: ["agent_runs", "agent_steps", "agent_events", "memories.agent_run_id"],
    replay: true
  },
  {
    id: "insight-report",
    name: "回忆报告工作流",
    purpose: "把已保存展品聚合成时间线、主题线索和可继续编辑的回忆报告。",
    entry: "/api/insights",
    maturity: "draft",
    statusLabel: "可预览",
    nodes: [
      { id: "timeline", agent: "时间线 Agent", stage: "时间分组", interruptible: false, evidence: ["date", "createdAt"] },
      { id: "theme", agent: "主题展 Agent", stage: "主题候选", interruptible: true, evidence: ["tags", "people", "location", "emotions"] },
      { id: "report", agent: "报告 Agent", stage: "叙事章节", interruptible: true, evidence: ["highlights", "references", "mediaSummary"] }
    ],
    controls: ["scope", "filter", "cite", "export"],
    pausePoints: ["scope_selected", "theme_review", "report_export"],
    riskSignals: ["缺少时间范围", "主题来源过少", "报告尚不可保存为专题资产"],
    nextActions: ["沉淀可保存报告草稿", "支持主题展命名", "增加报告编辑历史"],
    persistence: ["phase10Insights", "phase11WorkflowBlueprint"],
    replay: false
  },
  {
    id: "guided-tour",
    name: "讲解检索工作流",
    purpose: "把用户问题、混合检索和引用依据组织成可解释的讲解回答。",
    entry: "/api/guide",
    maturity: "active",
    statusLabel: "可提问",
    nodes: [
      { id: "query", agent: "提问理解 Agent", stage: "问题锚点", interruptible: false, evidence: ["question", "keywords"] },
      { id: "retrieval", agent: "检索 Agent", stage: "混合召回", interruptible: false, evidence: ["keyword", "semantic", "confidence"] },
      { id: "answer", agent: "讲解员 Agent", stage: "引用回答", interruptible: true, evidence: ["citations", "followUps", "boundary"] }
    ],
    controls: ["ask", "cite", "follow-up"],
    pausePoints: ["weak_evidence", "follow_up"],
    riskSignals: ["召回弱证据", "问题锚点过少", "引用展品数量不足"],
    nextActions: ["记录问答历史", "支持引用收藏", "增加跨主题导览路线"],
    persistence: ["search_meta", "citation_confidence"],
    replay: false
  }
];
const guideSearchVocabulary = [
  "青春", "校园", "毕业", "成长", "同学", "宿舍", "考试", "告别", "朋友", "室友", "群聊", "合照",
  "家", "家人", "家庭", "亲人", "父母", "妈妈", "爸爸", "饭桌", "学校", "旅行", "车站", "雨天",
  "梦", "梦境", "低谷", "挫折", "失眠", "崩溃", "疲惫", "日常", "散步", "晚风", "普通",
  "奇怪", "荒诞", "尴尬", "离谱", "怀念", "快乐", "开心", "温暖", "感动", "兴奋", "紧张",
  "孤独", "委屈", "愤怒", "害怕", "释然", "遗憾", "平静", "期待", "迷茫", "照片", "日记",
  "聊天", "物品", "最近", "重要", "珍贵"
];
const guideSearchStopWords = new Set(["帮我", "看看", "一下", "哪些", "有哪些", "有什么", "有没有", "什么", "为什么", "如何", "怎么", "能不能", "可以", "关于", "相关", "这个", "这些", "记忆", "展品", "讲讲", "总结", "推荐"]);
const fieldLimits = {
  title: 80,
  rawContent: MAX_RAW_LENGTH,
  exhibitText: 600,
  coverImage: 300,
  mediaNote: 800,
  attachmentName: 80,
  attachmentNote: 180,
  date: 30,
  location: 80,
  listItem: 30,
  listLength: 16
};
let store;
try {
  store = createMemoryStore({ dbPath: DB_PATH, halls, schemaVersion: SCHEMA_VERSION });
  hydrateOperationEvents();
  operationsService = createOperationsService({
    fs,
    path,
    port: PORT,
    schemaVersion: SCHEMA_VERSION,
    phase: PHASE,
    phaseName: PHASE_NAME,
    appVersion: APP_VERSION,
    buildLabel: BUILD_LABEL,
    releaseChannel: RELEASE_CHANNEL,
    operationEventLimit: OPERATION_EVENT_LIMIT,
    operationLogPath: OPERATION_LOG_PATH,
    operationEvents,
    getStats: () => store.getStats(),
    getDatabasePath: () => store.dbPath,
    isAiConfigured: () => Boolean(process.env.AI_API_KEY),
    getAiModel: () => process.env.AI_MODEL || "not-configured",
    buildStructuredMemory,
    hasMultimodalStructured
  });
  healthRoutes = createHealthRoutes({
    schemaVersion: SCHEMA_VERSION,
    phase: PHASE,
    phaseName: PHASE_NAME,
    store,
    operationsService,
    agentRoles,
    sendJson,
    buildPhase10Handoff,
    buildPhase11Handoff,
    buildPhase11WorkflowBlueprint,
    buildPhase12Sovereignty,
    buildPrivacyPolicy,
    isAiConfigured: () => Boolean(process.env.AI_API_KEY),
    getAiModel: () => process.env.AI_MODEL || "not-configured"
  });
  operationsRoutes = createOperationsRoutes({
    listMemories: () => store.listMemories(),
    operationsService,
    sendJson
  });
} catch (error) {
  console.error("数据库启动失败：无法打开 SQLite 数据库。");
  console.error(`数据库路径：${DB_PATH}`);
  console.error(`错误原因：${error.message}`);
  console.error("可以检查目录权限，或通过 DB_PATH 指定一个可写路径后重试。");
  process.exit(1);
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    startRequestTrace(request, response, url);

    if (healthRoutes.handleHealthRoute(request, response, url)) return;

    if (request.method === "GET" && url.pathname === "/api/options") {
      return sendJson(response, 200, {
        schemaVersion: SCHEMA_VERSION,
        halls,
        emotions: emotionOptions,
        sourceTypes,
        importanceLabels,
        agentRoles,
        workflowTemplates,
        limits: {
          rawContent: MAX_RAW_LENGTH,
          body: MAX_BODY_LENGTH,
          aiTimeoutMs: AI_TIMEOUT_MS
        }
      });
    }

    if (operationsRoutes.handleOperationsRoute(request, response, url)) return;

    if (request.method === "GET" && url.pathname === "/api/memories") {
      return sendJson(response, 200, { schemaVersion: SCHEMA_VERSION, memories: store.listMemories() });
    }

    if (request.method === "GET" && url.pathname === "/api/memories/export") {
      return sendJson(response, 200, buildCollectionExport(store.listMemories(), {
        mode: normalizeExportMode(url.searchParams.get("mode"))
      }));
    }

    if (request.method === "GET" && url.pathname === "/api/insights") {
      return sendJson(response, 200, buildPhase10Insights(store.listMemories(), {
        hall: limitText(url.searchParams.get("hall"), 40),
        year: limitText(url.searchParams.get("year"), 4),
        theme: limitText(url.searchParams.get("theme"), 80)
      }));
    }

    if (request.method === "GET" && url.pathname === "/api/assets") {
      return sendJson(response, 200, buildAssetCollection());
    }

    if (request.method === "GET" && url.pathname === "/api/exhibitions") {
      return sendJson(response, 200, {
        schemaVersion: SCHEMA_VERSION,
        phase: PHASE,
        savedExhibitions: store.listSavedExhibitions()
      });
    }

    if (request.method === "POST" && url.pathname === "/api/exhibitions") {
      const body = await readJsonBody(request);
      const existed = Boolean(body.id && store.getSavedExhibition(body.id));
      const saved = store.saveSavedExhibition(body);
      return sendJson(response, existed ? 200 : 201, {
        schemaVersion: SCHEMA_VERSION,
        phase: PHASE,
        savedExhibition: saved
      });
    }

    if (request.method === "POST" && url.pathname === "/api/exhibitions/from-theme") {
      const body = await readJsonBody(request);
      const draft = buildExhibitionDraftFromTheme(body);
      const existed = Boolean(draft.id && store.getSavedExhibition(draft.id));
      const saved = store.saveSavedExhibition(draft);
      return sendJson(response, existed ? 200 : 201, {
        schemaVersion: SCHEMA_VERSION,
        phase: PHASE,
        source: draft.source,
        savedExhibition: saved
      });
    }

    const exhibitionMatch = url.pathname.match(/^\/api\/exhibitions\/([a-zA-Z0-9_-]{1,120})$/);
    if (exhibitionMatch) {
      const id = exhibitionMatch[1];
      if (request.method === "GET") {
        const exhibition = store.getSavedExhibition(id);
        return exhibition
          ? sendJson(response, 200, { schemaVersion: SCHEMA_VERSION, phase: PHASE, savedExhibition: exhibition })
          : sendJson(response, 404, { error: "Saved exhibition not found." });
      }
      if (request.method === "DELETE") {
        return store.deleteSavedExhibition(id)
          ? sendJson(response, 200, { ok: true, id })
          : sendJson(response, 404, { error: "Saved exhibition not found." });
      }
    }

    if (request.method === "GET" && url.pathname === "/api/report-drafts") {
      return sendJson(response, 200, {
        schemaVersion: SCHEMA_VERSION,
        phase: PHASE,
        reportDrafts: store.listReportDrafts()
      });
    }

    if (request.method === "POST" && url.pathname === "/api/report-drafts") {
      const body = await readJsonBody(request);
      const existed = Boolean(body.id && store.getReportDraft(body.id));
      const saved = store.saveReportDraft(body);
      return sendJson(response, existed ? 200 : 201, {
        schemaVersion: SCHEMA_VERSION,
        phase: PHASE,
        reportDraft: saved
      });
    }

    if (request.method === "POST" && url.pathname === "/api/report-drafts/from-insights") {
      const body = await readJsonBody(request);
      const draft = buildReportDraftFromInsights(body);
      const existed = Boolean(draft.id && store.getReportDraft(draft.id));
      const saved = store.saveReportDraft(draft);
      return sendJson(response, existed ? 200 : 201, {
        schemaVersion: SCHEMA_VERSION,
        phase: PHASE,
        source: draft.source,
        reportDraft: saved
      });
    }

    const reportDraftMatch = url.pathname.match(/^\/api\/report-drafts\/([a-zA-Z0-9_-]{1,120})$/);
    if (reportDraftMatch) {
      const id = reportDraftMatch[1];
      if (request.method === "GET") {
        const draft = store.getReportDraft(id);
        return draft
          ? sendJson(response, 200, { schemaVersion: SCHEMA_VERSION, phase: PHASE, reportDraft: draft })
          : sendJson(response, 404, { error: "Report draft not found." });
      }
      if (request.method === "DELETE") {
        return store.deleteReportDraft(id)
          ? sendJson(response, 200, { ok: true, id })
          : sendJson(response, 404, { error: "Report draft not found." });
      }
    }

    if (request.method === "GET" && url.pathname === "/api/workflows") {
      return sendJson(response, 200, buildPhase11WorkflowBlueprint(store.listMemories()));
    }

    if (request.method === "GET" && url.pathname === "/api/privacy") {
      return sendJson(response, 200, buildPrivacyPolicy(store.listMemories()));
    }

    if (request.method === "GET" && url.pathname === "/api/search") {
      const query = limitText(url.searchParams.get("query") || url.searchParams.get("q") || "", 120);
      const limit = clampInteger(url.searchParams.get("limit"), 1, 50, 12);
      const mode = normalizeRetrievalMode(url.searchParams.get("mode"));
      const results = store.searchMemories(query, { limit, mode, includeMeta: true });
      return sendJson(response, 200, {
        schemaVersion: SCHEMA_VERSION,
        query,
        mode,
        count: results.length,
        results: results.map(buildSearchResult),
        memories: results.map((item) => item.memory)
      });
    }

    if (request.method === "POST" && url.pathname === "/api/guide") {
      const body = await readJsonBody(request);
      const question = limitText(body.question, 300);
      if (!question) {
        return sendJson(response, 400, { error: "question is required." });
      }

      const result = await answerGuideQuestion(question);
      return sendJson(response, 200, result);
    }

    if (request.method === "POST" && url.pathname === "/api/imports/preview") {
      const body = await readJsonBody(request);
      return sendJson(response, 200, buildPhase19ImportPreviewForServer({
        text: body.text || body.content || "",
        format: body.format || "auto",
        defaultSource: body.defaultSource || "日记",
        defaultHall: body.defaultHall || "auto",
        cleanupMode: body.cleanupMode || "balanced"
      }));
    }

    if (request.method === "POST" && url.pathname === "/api/memories/import") {
      const body = await readJsonBody(request);
      const imported = Array.isArray(body) ? body : body.memories;
      if (!Array.isArray(imported)) {
        return sendJson(response, 400, { error: "memories array is required." });
      }

      const existingIds = new Set(store.listMemories().map((memory) => memory.id));
      const normalized = normalizeMemoryList(imported, existingIds);
      const result = store.importMemories(normalized);
      return sendJson(response, 200, {
        schemaVersion: SCHEMA_VERSION,
        imported: result.imported,
        importedIds: normalized.map((memory) => memory.id),
        memories: result.memories
      });
    }

    if (request.method === "DELETE" && url.pathname === "/api/memories/purge") {
      const body = await readJsonBody(request).catch(() => ({}));
      if (body.confirm !== "DELETE") {
        return sendJson(response, 400, { error: "confirm must be DELETE." });
      }
      const result = store.purgeAll();
      return sendJson(response, 200, {
        ok: true,
        schemaVersion: SCHEMA_VERSION,
        phase: PHASE,
        purge: result,
        privacy: buildPrivacyPolicy(store.listMemories()).summary
      });
    }

    if (request.method === "POST" && url.pathname === "/api/memories") {
      const body = await readJsonBody(request);
      const memory = normalizeMemory(body);
      persistMemoryAgentWorkflow(body.agentWorkflow, memory, "create");
      normalizeMemoryAgentRun(memory);
      if (store.getMemory(memory.id)) {
        return sendJson(response, 409, { error: "Memory id already exists." });
      }
      const saved = store.saveMemory(memory);
      if (saved.agentRunId) store.attachAgentRunToMemory(saved.agentRunId, saved.id);
      return sendJson(response, 201, { schemaVersion: SCHEMA_VERSION, memory: saved });
    }

    const memoryAgentRunMatch = url.pathname.match(/^\/api\/memories\/([a-zA-Z0-9_-]{8,80})\/agent-run$/);
    if (memoryAgentRunMatch && request.method === "GET") {
      const id = memoryAgentRunMatch[1];
      const memory = store.getMemory(id);
      if (!memory) return sendJson(response, 404, { error: "Memory not found." });
      const run = (memory.agentRunId ? store.getAgentRun(memory.agentRunId) : null) || store.getAgentRunForMemory(id);
      return run
        ? sendJson(response, 200, { schemaVersion: SCHEMA_VERSION, memoryId: id, run })
        : sendJson(response, 404, { error: "Agent run not found." });
    }

    const memoryMatch = url.pathname.match(/^\/api\/memories\/([a-zA-Z0-9_-]{8,80})$/);
    if (memoryMatch) {
      const id = memoryMatch[1];

      if (request.method === "GET") {
        const memory = store.getMemory(id);
        return memory
          ? sendJson(response, 200, { schemaVersion: SCHEMA_VERSION, memory })
          : sendJson(response, 404, { error: "Memory not found." });
      }

      if (request.method === "PUT") {
        const existing = store.getMemory(id);
        if (!existing) return sendJson(response, 404, { error: "Memory not found." });
        const body = await readJsonBody(request);
        const memory = normalizeMemory({
          ...existing,
          ...body,
          id,
          createdAt: body.createdAt || existing.createdAt,
          updatedAt: body.updatedAt || new Date().toISOString()
        });
        persistMemoryAgentWorkflow(body.agentWorkflow, memory, "update");
        normalizeMemoryAgentRun(memory);
        const saved = store.saveMemory(memory);
        if (saved.agentRunId) store.attachAgentRunToMemory(saved.agentRunId, saved.id);
        return sendJson(response, 200, { schemaVersion: SCHEMA_VERSION, memory: saved });
      }

      if (request.method === "DELETE") {
        const deleted = store.deleteMemory(id);
        return deleted
          ? sendJson(response, 200, { ok: true, id })
          : sendJson(response, 404, { error: "Memory not found." });
      }
    }

    if (request.method === "POST" && url.pathname === "/api/analyze") {
      const body = await readJsonBody(request);
      const rawContent = String(body.rawContent || "").trim().slice(0, MAX_RAW_LENGTH);
      if (!rawContent) {
        return sendJson(response, 400, { error: "rawContent is required." });
      }

      const result = await analyzeMemory(rawContent);
      if (result.workflow) {
        const persistedRun = store.saveAgentRun(result.workflow, { rawContent, mode: result.mode });
        result.workflow.run = {
          ...result.workflow.run,
          persisted: true,
          eventCount: persistedRun.eventCount,
          memoryId: persistedRun.memoryId
        };
      }
      return sendJson(response, 200, result);
    }

    const agentRunMatch = url.pathname.match(/^\/api\/agent-runs\/([a-zA-Z0-9_-]{8,120})$/);
    if (agentRunMatch && request.method === "GET") {
      const run = store.getAgentRun(agentRunMatch[1]);
      return run
        ? sendJson(response, 200, { schemaVersion: SCHEMA_VERSION, run })
        : sendJson(response, 404, { error: "Agent run not found." });
    }

    if (request.method !== "GET") {
      return sendJson(response, 405, { error: "Method not allowed." });
    }

    return serveStatic(url.pathname, response);
  } catch (error) {
    response.operationError = error;
    return sendError(response, error);
  }
});

server.listen(PORT, () => {
  console.log(`AI 记忆博物馆已启动：http://localhost:${PORT}`);
  console.log(process.env.AI_API_KEY ? "AI 模式：已配置 API Key" : "AI 模式：未配置 API Key，将使用 Mock 回退");
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`端口 ${PORT} 已被占用。可以设置 PORT=3001 后重试。`);
    process.exit(1);
  }
  console.error(error);
  process.exit(1);
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function shutdown() {
  try {
    store.close();
  } finally {
    process.exit(0);
  }
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex === -1) return;

    const key = trimmed.slice(0, equalsIndex).trim();
    const value = trimmed.slice(equalsIndex + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = value;
  });
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    let settled = false;
    request.on("data", (chunk) => {
      if (settled) return;
      body += chunk;
      if (body.length > MAX_BODY_LENGTH) {
        settled = true;
        request.destroy();
        reject(createHttpError(413, "Request body is too large."));
      }
    });
    request.on("end", () => {
      if (settled) return;
      settled = true;
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(createHttpError(400, "Invalid JSON body."));
      }
    });
    request.on("error", reject);
  });
}

async function analyzeMemory(rawContent) {
  if (!process.env.AI_API_KEY) {
    const data = mockAnalyzeMemory(rawContent);
    return {
      mode: "mock",
      reason: "AI_API_KEY is not configured.",
      data,
      workflow: buildAgentWorkflow(rawContent, data, "mock")
    };
  }

  try {
    const data = normalizeAnalysis(await callAiProvider(rawContent), rawContent);
    return {
      mode: "ai",
      model: process.env.AI_MODEL || "gpt-4.1-mini",
      data,
      workflow: buildAgentWorkflow(rawContent, data, "ai")
    };
  } catch (error) {
    const data = mockAnalyzeMemory(rawContent);
    return {
      mode: "mock",
      reason: `AI request failed: ${error.message}`,
      data,
      workflow: buildAgentWorkflow(rawContent, data, "mock")
    };
  }
}

async function answerGuideQuestion(question) {
  const query = buildSearchQuery(question);
  let searchResults = store.searchMemories(query, { limit: 6, mode: "hybrid", includeMeta: true });
  let retrievalMode = "hybrid";
  if (searchResults.length === 0) {
    searchResults = store.searchMemories("", { limit: 6, mode: "hybrid", includeMeta: true });
    retrievalMode = "recent-fallback";
  }
  const candidates = searchResults.map((item) => item.memory);
  const citations = searchResults.map(buildSearchResult);
  const followUps = buildGuideFollowUps(question, citations, retrievalMode);

  if (candidates.length === 0) {
    return {
      mode: "empty",
      retrievalMode,
      question,
      query,
      answer: "现在数据库里还没有展品。先添加几段记忆，我就可以基于这些展品为你导览和回答。",
      followUps: ["先添加一段文字记忆", "导入已有记忆备份", "保存几件展品后再问讲解员"],
      citations: [],
      memories: []
    };
  }

  if (!process.env.AI_API_KEY) {
    return {
      mode: "mock",
      reason: "AI_API_KEY is not configured.",
      retrievalMode,
      question,
      query,
      answer: buildMockGuideAnswer(question, candidates, retrievalMode, citations),
      followUps,
      citations,
      memories: candidates.map(buildStructuredMemory)
    };
  }

  try {
    const answer = await callGuideProvider(question, candidates, citations);
    return {
      mode: "ai",
      model: process.env.AI_MODEL || "gpt-4.1-mini",
      retrievalMode,
      question,
      query,
      answer,
      followUps,
      citations,
      memories: candidates.map(buildStructuredMemory)
    };
  } catch (error) {
    return {
      mode: "mock",
      reason: `AI request failed: ${error.message}`,
      retrievalMode,
      question,
      query,
      answer: buildMockGuideAnswer(question, candidates, retrievalMode, citations),
      followUps,
      citations,
      memories: candidates.map(buildStructuredMemory)
    };
  }
}

function normalizeRetrievalMode(value) {
  return ["keyword", "semantic", "hybrid"].includes(value) ? value : "hybrid";
}

function buildSearchResult(item) {
  return {
    memory: buildStructuredMemory(item.memory),
    score: item.score || 0,
    matchedTerms: item.matchedTerms || [],
    semanticTerms: item.semanticTerms || [],
    matchedFields: item.matchedFields || [],
    confidence: item.confidence || { level: "weak", label: "弱证据", reason: "未提供可信度信息" },
    reason: item.reason || ""
  };
}

function buildGuideFollowUps(question, citations = [], retrievalMode = "hybrid") {
  const top = citations[0];
  const title = top?.memory?.title || "这件展品";
  const fields = new Set(citations.flatMap((citation) => citation.matchedFields || []));
  const hasMediaEvidence = fields.has("附件") || fields.has("多模态线索") || fields.has("封面线索");
  if (retrievalMode === "recent-fallback" || !citations.length) {
    return [
      "换成人物、地点或时间再问一次",
      "补充一个更具体的情绪词",
      `先查看最近的《${title}》`
    ];
  }
  const prompts = [
    hasMediaEvidence ? `围绕《${title}》的附件线索继续讲` : `为什么《${title}》最相关？`,
    fields.has("情绪") ? "把这些记忆按情绪变化讲一遍" : "这些展品里有没有相似情绪？",
    hasMediaEvidence ? "还有哪些展品带有图片、截图或语音线索？" : fields.has("人物") ? "围绕相关人物整理一条故事线" : "还能找到相似主题的其他展品吗？"
  ];
  if (question.includes("推荐") || question.includes("看")) {
    prompts[0] = `从《${title}》开始继续导览`;
  }
  return prompts.slice(0, 3);
}

async function callAiProvider(rawContent) {
  const baseUrl = (process.env.AI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const model = process.env.AI_MODEL || "gpt-4.1-mini";
  const endpoint = `${baseUrl}/chat/completions`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  const response = await fetch(endpoint, {
    method: "POST",
    signal: controller.signal,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.AI_API_KEY}`
    },
    body: JSON.stringify({
      model,
      temperature: 0.4,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: buildSystemPrompt()
        },
        {
          role: "user",
          content: rawContent
        }
      ]
    })
  }).finally(() => clearTimeout(timeout));

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`provider returned ${response.status}: ${text.slice(0, 240)}`);
  }

  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("provider returned empty content");
  return parseJsonContent(content);
}

async function callGuideProvider(question, memories, citations = []) {
  const baseUrl = (process.env.AI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const model = process.env.AI_MODEL || "gpt-4.1-mini";
  const endpoint = `${baseUrl}/chat/completions`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  const response = await fetch(endpoint, {
    method: "POST",
    signal: controller.signal,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.AI_API_KEY}`
    },
    body: JSON.stringify({
      model,
      temperature: 0.45,
      messages: [
        {
          role: "system",
          content: [
            "你是 AI 记忆博物馆的讲解员。",
            "你只能基于提供的候选展品回答，不要编造候选展品以外的私人经历。",
            "回答中要自然提到引用依据，例如命中的展品标题、字段或语义线索。",
            "回答要温柔、具体、像私人博物馆导览词。",
            "如果证据不足，要明确说明只能基于当前展品做有限判断。",
            "回答控制在 120 到 260 个中文字。"
          ].join("\n")
        },
        {
          role: "user",
          content: JSON.stringify({
            question,
            memories: memories.map(buildStructuredMemory),
            citations
          })
        }
      ]
    })
  }).finally(() => clearTimeout(timeout));

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`provider returned ${response.status}: ${text.slice(0, 240)}`);
  }

  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("provider returned empty content");
  return limitText(content, 1200);
}

function buildSystemPrompt() {
  return [
    "你是 AI 记忆博物馆的多 Agent 工作流，包含档案员、策展人、编辑和讲解员。",
    "你需要协作把用户的一段私人记忆整理成一件博物馆展品。",
    "只返回 JSON，不要 Markdown，不要解释。",
    "JSON 字段必须为：title, hall, exhibitText, emotions, emotionIntensity, tags, people, location, date, sourceType, importance, favorite, coverImage, mediaNote, attachments。",
    `hall 必须是这些 id 之一：${halls.map((hall) => hall.id).join(", ")}。`,
    `emotions 从这些值中选择 1 到 4 个：${emotionOptions.join(", ")}。`,
    `sourceType 必须是这些值之一：${sourceTypes.join(", ")}。`,
    "emotionIntensity 和 importance 都是 1 到 5 的整数。",
    "tags 和 people 都返回字符串数组；无法判断时返回空数组。",
    "date 只在能判断明确日期时返回 YYYY-MM-DD；无法判断明确日期时返回空字符串。",
    "exhibitText 用中文写 60 到 140 字，像博物馆展品说明。"
  ].join("\n");
}

function buildAgentWorkflow(rawContent, analysis, mode) {
  const createdAt = new Date().toISOString();
  const runId = createId();
  const shortRaw = limitText(rawContent, 96);
  const people = compactList(analysis.people, "未识别明确人物");
  const tags = compactList(analysis.tags, "暂无标签");
  const emotions = compactList(analysis.emotions, "暂无情绪");
  const hallName = getHallName(analysis.hall);
  const sourceText = [analysis.sourceType, analysis.location, analysis.date].filter(Boolean).join(" / ") || "来源线索不足";
  const reviewItems = buildWorkflowReviewItems(analysis);
  const archiveNeedsReview = reviewItems.some((item) => ["people", "location", "date"].includes(item.field));
  const editorNeedsReview = reviewItems.some((item) => ["tags", "exhibitText"].includes(item.field));

  const steps = [
    {
      id: "archivist",
      agent: "档案员 Agent",
      duty: agentRoles.find((role) => role.id === "archivist")?.duty,
      status: archiveNeedsReview ? "needs_review" : "done",
      output: `已记录原始片段“${shortRaw}”，提取人物：${people}；来源线索：${sourceText}。`,
      evidence: ["rawContent", "people", "location", "date"],
      actions: archiveNeedsReview ? ["confirm", "retry"] : ["confirm"]
    },
    {
      id: "curator",
      agent: "策展人 Agent",
      duty: agentRoles.find((role) => role.id === "curator")?.duty,
      status: "done",
      output: `已放入${hallName}，情绪为 ${emotions}，情绪强度 ${analysis.emotionIntensity} / 5，珍藏级别 ${analysis.importance} / 5。`,
      evidence: ["hall", "emotions", "emotionIntensity", "importance"],
      actions: ["confirm"]
    },
    {
      id: "editor",
      agent: "编辑 Agent",
      duty: agentRoles.find((role) => role.id === "editor")?.duty,
      status: editorNeedsReview ? "needs_review" : "done",
      output: `已生成标题《${analysis.title}》，标签：${tags}；展品说明已压缩为适合展示的导览文字。`,
      evidence: ["title", "tags", "exhibitText"],
      actions: editorNeedsReview ? ["confirm", "retry"] : ["confirm"]
    },
    {
      id: "guide",
      agent: "讲解员 Agent",
      duty: agentRoles.find((role) => role.id === "guide")?.duty,
      status: reviewItems.length ? "queued" : "ready",
      output: reviewItems.length
        ? "等待人工确认完成后，再进入讲解员检索池。"
        : `保存后可进入讲解员检索池，后续提问时会作为 ${hallName} 的候选展品参与 RAG 召回。`,
      evidence: ["savedMemory", "ragCandidate"],
      actions: reviewItems.length ? [] : ["confirm"]
    }
  ];

  return {
    version: 2,
    mode,
    phase: PHASE,
    run: {
      id: runId,
      phase: PHASE,
      mode,
      createdAt,
      eventCount: 1,
      events: [
        {
          type: "workflow_created",
          label: "Agent 工作流已创建",
          at: createdAt
        }
      ]
    },
    stateMachine: {
      statuses: ["queued", "running", "needs_review", "approved", "rejected", "failed", "done", "ready"],
      actions: ["confirm", "reject", "retry", "save"]
    },
    roles: agentRoles,
    summary: buildWorkflowSummary(steps, analysis, reviewItems),
    steps
  };
}

function buildWorkflowSummary(steps, analysis = {}, reviewItems = buildWorkflowReviewItems(analysis)) {
  const done = steps.filter((step) => step.status === "done").length;
  const ready = steps.filter((step) => step.status === "ready").length;
  const running = steps.filter((step) => step.status === "running").length;
  const needsReview = steps.filter((step) => step.status === "needs_review").length;
  const approved = steps.filter((step) => step.status === "approved").length;
  const rejected = steps.filter((step) => step.status === "rejected").length;
  const completed = done + ready + approved + rejected;
  const status = running > 0
    ? "running"
    : needsReview > 0
      ? "needs_review"
      : ready > 0 && completed >= steps.length
        ? "ready"
        : completed >= steps.length
          ? "done"
          : "pending";
  return {
    total: steps.length,
    done,
    ready,
    running,
    needsReview,
    approved,
    rejected,
    status,
    progress: steps.length ? Math.round((completed / steps.length) * 100) : 0,
    requiresHumanReview: reviewItems.length > 0,
    confirmationItems: reviewItems.map((item) => ({
      ...item,
      state: "pending",
      action: "confirm"
    })),
    reviewItems,
    nextAction: reviewItems.length
      ? "补全复核项并确认后，可以保存展品"
      : ready > 0
        ? "保存展品后可进入讲解员检索池"
        : "继续等待 Agent 工作流完成"
  };
}

function buildWorkflowReviewItems(analysis = {}) {
  const items = [];
  if (!Array.isArray(analysis.people) || analysis.people.length === 0) items.push({ field: "people", label: "人物未明确" });
  if (!analysis.location) items.push({ field: "location", label: "地点可补充" });
  if (!analysis.date) items.push({ field: "date", label: "时间可补充" });
  if (!Array.isArray(analysis.tags) || analysis.tags.length < 2) items.push({ field: "tags", label: "标签可再丰富" });
  if (!analysis.exhibitText || analysis.exhibitText.length < 40) items.push({ field: "exhibitText", label: "展品说明偏短" });
  return items.slice(0, 4);
}

function compactList(values, fallback) {
  const list = Array.isArray(values) ? values.filter(Boolean).slice(0, 4) : [];
  return list.length ? list.join("、") : fallback;
}

function parseJsonContent(content) {
  const cleaned = content.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    const extracted = extractFirstJsonObject(cleaned);
    if (!extracted) throw new Error("provider returned invalid JSON");
    return JSON.parse(extracted);
  }
}

function extractFirstJsonObject(text) {
  const start = text.indexOf("{");
  if (start === -1) return "";

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === "\"") {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) return text.slice(start, index + 1);
  }

  return "";
}

function createId() {
  return randomUUID();
}

function simpleChecksum(text = "") {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function normalizeId(value) {
  const id = String(value || "").trim();
  return /^[a-zA-Z0-9_-]{8,80}$/.test(id) ? id : createId();
}

function normalizeMemoryList(values, existingIds = new Set()) {
  const seenIds = new Set();
  return values.map((value) => {
    const memory = normalizeMemory(value);
    if (seenIds.has(memory.id) || existingIds.has(memory.id)) memory.id = createId();
    seenIds.add(memory.id);
    return memory;
  });
}

function normalizeMemory(memory = {}) {
  const now = new Date().toISOString();
  const hallId = typeof memory.hall === "object" ? memory.hall?.id : memory.hall;
  const hall = halls.some((item) => item.id === hallId) ? hallId : "daily";
  const rawContent = limitText(memory.rawContent, fieldLimits.rawContent);
  const title = limitText(memory.title, fieldLimits.title);
  const exhibitText = limitText(memory.exhibitText || rawContent || "这件展品还没有说明。", fieldLimits.exhibitText);
  const sourceType = sourceTypes.includes(memory.sourceType) ? memory.sourceType : "日记";

  return {
    schemaVersion: SCHEMA_VERSION,
    id: normalizeId(memory.id),
    title: title || "未命名展品",
    hall,
    rawContent,
    exhibitText,
    date: limitText(memory.date, fieldLimits.date),
    location: limitText(memory.location, fieldLimits.location),
    people: normalizeMemoryListField(memory.people),
    tags: normalizeMemoryListField(memory.tags),
    emotions: normalizeMemoryListField(memory.emotions).filter((emotion) => emotionOptions.includes(emotion)),
    emotionIntensity: clampInteger(memory.emotionIntensity, 1, 5, 3),
    sourceType,
    importance: clampInteger(memory.importance, 1, 5, 1),
    favorite: parseBoolean(memory.favorite),
    coverImage: limitText(memory.coverImage, fieldLimits.coverImage),
    mediaNote: limitText(memory.mediaNote, fieldLimits.mediaNote),
    attachments: normalizeAttachments(memory.attachments),
    agentRunId: limitText(memory.agentRunId, 120),
    createdAt: limitText(memory.createdAt, 40) || now,
    updatedAt: limitText(memory.updatedAt, 40)
  };
}

function normalizeMemoryAgentRun(memory) {
  if (!memory.agentRunId) return memory;
  if (!store.getAgentRun(memory.agentRunId)) memory.agentRunId = "";
  return memory;
}

function persistMemoryAgentWorkflow(workflow, memory, action = "save") {
  if (!workflow || typeof workflow !== "object" || !Array.isArray(workflow.steps)) return null;
  const workflowRunId = limitText(workflow.run?.id, 120);
  if (memory.agentRunId && workflowRunId && memory.agentRunId !== workflowRunId) return null;
  const workflowWithSaveEvent = appendMemorySavedEvent(workflow, memory, action);
  const persistedRun = store.saveAgentRun(workflowWithSaveEvent, {
    memoryId: memory.id,
    rawContent: memory.rawContent,
    mode: workflowWithSaveEvent.mode || workflowWithSaveEvent.run?.mode || "mock"
  });
  if (persistedRun?.id) memory.agentRunId = persistedRun.id;
  return persistedRun;
}

function appendMemorySavedEvent(workflow, memory, action = "save") {
  const now = new Date().toISOString();
  const run = { ...(workflow.run || {}) };
  const events = Array.isArray(run.events) ? [...run.events] : [];
  const actionLabel = action === "update" ? "更新" : action === "create" ? "保存" : "保存";
  events.push({
    type: "memory_saved",
    label: `展品《${limitText(memory.title, 40)}》已${actionLabel}并关联整理历史`,
    at: now,
    payload: {
      action,
      memoryId: memory.id,
      title: memory.title
    }
  });
  run.events = events;
  run.eventCount = Math.max(Number(run.eventCount) || 0, events.length);
  return { ...workflow, run };
}

function normalizeMemoryListField(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map((item) => limitText(item, fieldLimits.listItem)).filter(Boolean))].slice(0, fieldLimits.listLength);
  }
  if (typeof value === "string") {
    return [...new Set(value
      .split(/[,，、]/)
      .map((item) => limitText(item, fieldLimits.listItem))
      .filter(Boolean))]
      .slice(0, fieldLimits.listLength);
  }
  return [];
}

function normalizeAttachments(value) {
  const items = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/\n+/).map((line) => {
        const [name = "", type = "", note = ""] = line.split("|").map((part) => part.trim());
        return { name, type, note };
      })
      : [];
  return items.map((item) => {
    if (typeof item === "string") return { name: limitText(item, fieldLimits.attachmentName), type: "附件", note: "" };
    return {
      name: limitText(item.name || item.filename || item.title, fieldLimits.attachmentName),
      type: limitText(item.type || item.kind || "附件", 30),
      note: limitText(item.note || item.description || item.text, fieldLimits.attachmentNote)
    };
  }).filter((item) => item.name).slice(0, 8);
}

function getAttachmentCategory(item = {}) {
  const text = `${item.type || ""} ${item.name || ""} ${item.note || ""}`.toLowerCase();
  if (/图片|照片|截图|合照|相册|image|photo|png|jpe?g|webp|gif|heic/.test(text)) return "图片";
  if (/ocr|扫描|截图文字|识别文字|文字提取|scan/.test(text)) return "OCR";
  if (/语音|录音|转写|音频|voice|audio|mp3|wav|m4a/.test(text)) return "语音";
  if (/文档|报告|笔记|pdf|docx?|txt|md|markdown/.test(text)) return "文档";
  if (/视频|录像|video|mp4|mov|avi/.test(text)) return "视频";
  return "其他";
}

function buildAttachmentTypeCounts(attachments = []) {
  return normalizeAttachments(attachments).reduce((counts, item) => {
    const category = getAttachmentCategory(item);
    counts[category] = (counts[category] || 0) + 1;
    return counts;
  }, {});
}

function sortAttachmentTypeCounts(counts = {}) {
  return Object.entries(counts).sort((a, b) => {
    const orderDelta = attachmentTypeOrder.indexOf(a[0]) - attachmentTypeOrder.indexOf(b[0]);
    return orderDelta || b[1] - a[1] || a[0].localeCompare(b[0]);
  });
}

function buildStructuredMemory(memory) {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: memory.id,
    title: memory.title,
    hall: {
      id: memory.hall,
      name: getHallName(memory.hall)
    },
    sourceType: memory.sourceType,
    rawContent: memory.rawContent,
    exhibitText: memory.exhibitText,
    date: memory.date,
    location: memory.location,
    people: memory.people || [],
    emotions: memory.emotions || [],
    emotionIntensity: memory.emotionIntensity,
    tags: memory.tags || [],
    importance: memory.importance,
    importanceLabel: importanceLabels[(Number(memory.importance) || 1) - 1] || importanceLabels[0],
    favorite: memory.favorite,
    coverImage: memory.coverImage || "",
    mediaNote: memory.mediaNote || "",
    attachments: Array.isArray(memory.attachments) ? memory.attachments : [],
    agentRunId: memory.agentRunId || "",
    createdAt: memory.createdAt,
    updatedAt: memory.updatedAt || ""
  };
}

function normalizeExportMode(value) {
  return value === "redacted" ? "redacted" : "full";
}

function buildCollectionExport(memories, options = {}) {
  const mode = normalizeExportMode(options.mode);
  const exportMemories = mode === "redacted"
    ? memories.map(buildRedactedMemory)
    : memories.map(buildStructuredMemory);
  return {
    app: "AI 记忆博物馆",
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    exportMode: mode,
    redacted: mode === "redacted",
    storage: "sqlite",
    halls,
    emotions: emotionOptions,
    sourceTypes,
    mediaSummary: buildMediaSummary(memories),
    phase10Handoff: buildPhase10Handoff(memories),
    phase10Insights: buildPhase10Insights(memories),
    phase11WorkflowBlueprint: buildPhase11WorkflowBlueprint(memories),
    phase12Sovereignty: buildPhase12Sovereignty(memories),
    phase16Sync: buildPhase16SyncManifest(memories),
    phase17SyncAdapter: buildPhase17SyncAdapter(memories),
    phase18LongTermAgent: buildPhase18LongTermAgent(memories),
    phase19ImportPlan: buildPhase19ImportPlan(memories),
    privacyPolicy: buildPrivacyPolicy(memories),
    savedExhibitions: store.listSavedExhibitions(),
    reportDrafts: store.listReportDrafts(),
    memories: exportMemories,
    redaction: mode === "redacted" ? buildRedactionPolicy() : null
  };
}

function detectPhase19ImportFormat(text = "", requested = "auto") {
  if (requested && requested !== "auto") return requested;
  const trimmed = String(text || "").trim();
  if (!trimmed) return "text";
  if ((trimmed.startsWith("[") || trimmed.startsWith("{")) && /"?(memories|items|rawContent|content|text)"?\s*:/.test(trimmed)) return "json";
  if (/^#{1,3}\s+/m.test(trimmed)) return "markdown";
  if (/^.+,.+\n.+,.+/m.test(trimmed)) return "csv";
  if (/^\s*(?:\[[^\]]+\]\s*)?[^：:\n]{1,16}[：:]/m.test(trimmed)) return "chat";
  return "text";
}

function getPhase19CsvDelimiter(line = "") {
  const delimiters = [",", "\t", ";", "，"];
  return delimiters
    .map((delimiter) => ({ delimiter, count: String(line || "").split(delimiter).length - 1 }))
    .sort((a, b) => b.count - a.count)[0]?.delimiter || ",";
}

function splitPhase19CsvLine(line = "", delimiter = ",") {
  const cells = [];
  let current = "";
  let quoted = false;
  String(line || "").split("").forEach((char) => {
    if (char === "\"") {
      quoted = !quoted;
      return;
    }
    if (char === delimiter && !quoted) {
      cells.push(current.trim());
      current = "";
      return;
    }
    current += char;
  });
  cells.push(current.trim());
  return cells;
}

function parsePhase19CsvRows(text = "") {
  const lines = String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const delimiter = getPhase19CsvDelimiter(lines[0]);
  const headers = splitPhase19CsvLine(lines[0], delimiter);
  return lines.slice(1).map((line) => {
    const cells = splitPhase19CsvLine(line, delimiter);
    return headers.reduce((row, header, index) => {
      row[header] = cells[index] || "";
      return row;
    }, { _delimiter: delimiter });
  });
}

function parsePhase19ChatSegments(text = "", cleanupMode = "balanced") {
  const lines = String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const groups = [];
  let active = null;
  lines.forEach((line) => {
    const match = line.match(/^(?:\[?(\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[:：]\d{2})\]?\s*)?([^：:\n]{1,18})[：:]\s*(.+)$/);
    if (!match) {
      if (active) active.lines.push(line);
      else groups.push({ speaker: "片段", time: "", lines: [line] });
      return;
    }
    const [, time = "", speaker = "片段", content = ""] = match;
    const shouldMerge = active
      && active.speaker === speaker
      && (cleanupMode === "compact" || active.lines.length < 4);
    if (!shouldMerge) {
      active = { speaker, time, lines: [] };
      groups.push(active);
    }
    active.lines.push(content);
  });
  return groups.map((group, index) => ({
    title: `${group.speaker}的聊天片段 ${index + 1}`,
    rawContent: group.lines.join("\n"),
    people: [group.speaker].filter((item) => item && item !== "片段"),
    date: /^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(group.time) ? group.time.replace(/\//g, "-") : "",
    sourceType: "聊天片段",
    sourceTrace: `聊天记录 / ${group.speaker}${group.time ? ` / ${group.time}` : ""}`
  }));
}

function splitPhase19ImportText(text = "", format = "text", cleanupMode = "balanced") {
  const trimmed = String(text || "").trim();
  if (!trimmed) return [];
  if (format === "json") {
    try {
      const parsed = JSON.parse(trimmed);
      const rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed.memories) ? parsed.memories : Array.isArray(parsed.items) ? parsed.items : [parsed];
      return rows.map((item, index) => ({
        title: item.title || item.name || `导入片段 ${index + 1}`,
        rawContent: item.rawContent || item.content || item.text || item.body || item.exhibitText || "",
        date: item.date || item.memoryDate || "",
        location: item.location || "",
        people: item.people || item.person || "",
        tags: item.tags || "",
        sourceType: item.sourceType || item.source || "",
        sourceTrace: `JSON 第 ${index + 1} 项`
      })).filter((item) => item.rawContent || item.title);
    } catch {
      return [{ title: "JSON 解析失败的原始片段", rawContent: trimmed }];
    }
  }
  if (format === "csv") {
    return parsePhase19CsvRows(trimmed).map((row, index) => ({
      title: row.title || row.标题 || row.name || `CSV 片段 ${index + 1}`,
      rawContent: row.rawContent || row.content || row.text || row.正文 || row.内容 || Object.values(row).join(" / "),
      date: row.date || row.日期 || "",
      location: row.location || row.地点 || "",
      people: row.people || row.人物 || "",
      tags: row.tags || row.标签 || "",
      sourceType: row.sourceType || row.来源 || "",
      sourceTrace: `CSV 第 ${index + 2} 行 / 分隔符 ${row._delimiter === "\t" ? "Tab" : row._delimiter}`
    }));
  }
  if (format === "markdown") {
    const blocks = trimmed.split(/\n(?=#{1,3}\s+)/).map((block) => block.trim()).filter(Boolean);
    return blocks.map((block, index) => {
      const heading = block.match(/^#{1,3}\s+(.+)$/m)?.[1] || `Markdown 片段 ${index + 1}`;
      return { title: heading, rawContent: block.replace(/^#{1,3}\s+.+$/m, "").trim() || block, sourceTrace: `Markdown 标题：${heading}` };
    });
  }
  if (format === "chat") {
    return parsePhase19ChatSegments(trimmed, cleanupMode);
  }
  return trimmed.split(/\n{2,}|-{3,}/).map((block, index) => ({
    title: `文本片段 ${index + 1}`,
    rawContent: block.trim(),
    sourceTrace: `文本段落 ${index + 1}`
  })).filter((item) => item.rawContent);
}

function buildPhase19ImportPreviewForServer({ text = "", format = "auto", defaultSource = "日记", defaultHall = "auto", cleanupMode = "balanced" } = {}) {
  const detectedFormat = detectPhase19ImportFormat(text, format);
  const segments = splitPhase19ImportText(text, detectedFormat, cleanupMode).slice(0, 30);
  const drafts = segments.map((segment, index) => {
    const rawContent = limitText(segment.rawContent || segment.title, fieldLimits.rawContent);
    const analysis = mockAnalyzeMemory(rawContent || segment.title || "");
    const sourceType = sourceTypes.includes(segment.sourceType) ? segment.sourceType : defaultSource;
    const hall = defaultHall && defaultHall !== "auto" ? defaultHall : analysis.hall;
    const draft = normalizeMemory({
      id: `phase19-import-${Date.now()}-${index}-${simpleChecksum(`${segment.title}:${rawContent}`).slice(0, 8)}`,
      title: limitText(segment.title && !/^(文本片段|聊天片段|CSV 片段|Markdown 片段)/.test(segment.title) ? segment.title : analysis.title, fieldLimits.title),
      hall,
      rawContent,
      exhibitText: analysis.exhibitText,
      date: segment.date || "",
      location: segment.location || analysis.location || "",
      people: segment.people || analysis.people || [],
      tags: [...normalizeMemoryListField(segment.tags || analysis.tags), "外部导入", detectedFormat].filter(Boolean),
      emotions: analysis.emotions,
      emotionIntensity: analysis.emotionIntensity,
      sourceType,
      importance: analysis.importance,
      favorite: analysis.favorite,
      mediaNote: [analysis.mediaNote, `第十九阶段导入来源：${segment.sourceTrace || `${detectedFormat} 第 ${index + 1} 段`}`].filter(Boolean).join("\n")
    });
    return {
      ...draft,
      selected: true,
      importTrace: segment.sourceTrace || `${detectedFormat} 第 ${index + 1} 段`
    };
  });
  const missingContent = segments.filter((item) => !String(item.rawContent || "").trim()).length;
  const duplicateTitles = drafts.length - new Set(drafts.map((item) => item.title)).size;
  return {
    phase: 19,
    mode: "external-import-preview",
    detectedFormat,
    cleanupMode,
    sourceLength: String(text || "").length,
    segmentCount: segments.length,
    draftCount: drafts.length,
    drafts,
    mapping: {
      defaultSource,
      defaultHall,
      cleanupMode,
      title: "title/name/标题 或自动生成",
      rawContent: "rawContent/content/text/正文/内容 或段落正文",
      date: "date/日期",
      location: "location/地点",
      people: "people/人物",
      tags: "tags/标签"
    },
    quality: {
      ready: drafts.length > 0 && !missingContent,
      missingContent,
      duplicateTitles,
      selectedCount: drafts.filter((item) => item.selected !== false).length,
      recommendation: drafts.length
        ? "先检查标题、日期、人物和地点，再导入为展品草稿；导入后第十八阶段长期助理会继续给出补全建议。"
        : "粘贴日记、Markdown、CSV、JSON 或聊天记录后再生成预览。"
    }
  };
}

function buildPhase19ImportPlan(memories = []) {
  return {
    phase: 19,
    phaseName: "个人知识生态和外部导入版",
    mode: "external-source-preview-first",
    supportedFormats: ["text", "markdown", "csv", "json", "chat"],
    cleanupFeatures: ["delimiter-detection", "chat-speaker-grouping", "draft-selection", "draft-field-editing", "field-mapping-template", "custom-mapping-template", "mapping-template-persistence", "template-rule-defaults", "field-alias-rules", "batch-naming", "duplicate-precheck", "duplicate-decision", "conflict-preview", "conflict-review-desk", "review-status-flow", "cross-batch-compare", "batch-filter-compare", "audit-search", "import-report-view", "post-import-cleanup-queue", "batch-audit-export", "import-quality-score", "batch-detail", "source-trace", "import-batch-history", "batch-rollback", "item-rollback", "failed-item-retention", "phase18-followup-task", "followup-task-status", "quality-trend"],
    importEndpoint: "/api/imports/preview",
    applyEndpoint: "/api/memories/import",
    currentMemories: memories.length,
    safety: {
      previewBeforeWrite: true,
      silentOverwrite: false,
      inheritsPhase16ConflictPolicy: true,
      afterImportAssistant: "phase18LongTermAgent"
    },
    recommendation: "先用导入预览拆分外部资料，确认字段后再写入展品库；写入后交给第十八阶段长期助理继续补全。"
  };
}

function buildPhase16SyncManifest(memories = []) {
  const exportedAt = new Date().toISOString();
  return {
    phase: 16,
    phaseName: "真实多端同步和冲突处理版",
    mode: "manual-json-local-first",
    batchId: `sync-${exportedAt.replace(/[-:.TZ]/g, "").slice(0, 14)}-server`,
    exportedAt,
    device: {
      id: "server-sqlite",
      label: "SQLite 后端",
      owner: "本地馆主"
    },
    itemCount: memories.length,
    assetCount: store.listSavedExhibitions().length + store.listReportDrafts().length,
    assetBoundary: {
      savedExhibitions: store.listSavedExhibitions().length,
      reportDrafts: store.listReportDrafts().length,
      importPolicy: "phase16-v5-memory-first-assets-preview",
      note: "第十六阶段第五版先同步展品；专题展和报告草稿进入逐项合并预览，不在导入时静默合并。"
    },
    items: memories.map((memory) => ({
      id: memory.id,
      title: memory.title,
      updatedAt: memory.updatedAt || memory.createdAt || ""
    })),
    conflictPolicy: {
      create: "新增展品直接写入",
      update: "导入版本较新时默认覆盖同 ID 本地展品，也可在前端预览中改为保留本地或复制",
      conflict: "冲突项默认保留本地并复制导入项为新展品，也支持逐项选择导入覆盖",
      skip: "完全一致或导入版本较旧时跳过"
    }
  };
}

function buildPhase18AssetSyncStateForServer() {
  const exhibitions = store.listSavedExhibitions();
  const reports = store.listReportDrafts();
  const buildItem = (type, item) => {
    const linkCount = type === "exhibition"
      ? (Array.isArray(item.memoryIds) ? item.memoryIds.length : 0)
      : (Array.isArray(item.references) ? item.references.length : 0);
    const issueCount = linkCount ? 0 : 1;
    const status = item.status || "draft";
    const syncStatus = issueCount ? "risk" : status === "published" ? "ready" : status === "archived" ? "archived" : "review";
    return {
      id: item.id,
      type,
      title: item.title || (type === "exhibition" ? "未命名专题展" : "未命名报告草稿"),
      status,
      syncStatus,
      linkCount,
      issueCount,
      includedInManualPackage: ["ready", "review"].includes(syncStatus),
      recommendation: issueCount
        ? "先补齐引用对象，再加入手动同步包。"
        : status === "published"
          ? "适合加入第十六阶段手动同步包，并交由第十七阶段设备复核。"
          : "可加入同步包预览，但建议先复核发布状态。"
    };
  };
  const items = [
    ...exhibitions.map((item) => buildItem("exhibition", item)),
    ...reports.map((item) => buildItem("report", item))
  ];
  const ready = items.filter((item) => item.syncStatus === "ready").length;
  const review = items.filter((item) => item.syncStatus === "review").length;
  const risk = items.filter((item) => item.syncStatus === "risk").length;
  const packageCandidates = items.filter((item) => item.includedInManualPackage).length;
  return {
    phase: 18,
    mode: "phase17-manual-sync-link",
    total: items.length,
    exhibitions: exhibitions.length,
    reports: reports.length,
    ready,
    review,
    risk,
    packageCandidates,
    activePhase18Tasks: 0,
    previewDrafts: 0,
    items: items.slice(0, 8),
    readiness: risk ? "review" : items.length ? "asset-ready" : "waiting",
    recommendation: risk
      ? "部分资产存在引用风险，建议先修复再加入同步包。"
      : items.length
        ? "专题展和报告草稿可进入第十六阶段同步包预览，并由第十七阶段设备复核。"
        : "第十八阶段还没有可同步的专题资产或报告草稿。"
  };
}

function buildPhase18SyncAdvisoryForServer() {
  const assetSyncState = buildPhase18AssetSyncStateForServer();
  return {
    assetCount: assetSyncState.total,
    exhibitions: assetSyncState.exhibitions,
    reports: assetSyncState.reports,
    activePhase18Tasks: assetSyncState.activePhase18Tasks,
    previewDrafts: assetSyncState.previewDrafts,
    readiness: assetSyncState.readiness,
    packageCandidates: assetSyncState.packageCandidates,
    riskAssets: assetSyncState.risk,
    readyAssets: assetSyncState.ready,
    assetSyncState,
    recommendation: assetSyncState.recommendation
  };
}

function buildPhase17SyncAdapter(memories = []) {
  const generatedAt = new Date().toISOString();
  const localFingerprint = simpleChecksum(`server-sqlite:${PHASE_NAME}`).slice(0, 12);
  const syncHealth = {
    status: "ready",
    score: 100,
    deviceCount: 1,
    pendingTasks: 0,
    failedTasks: 0,
    checks: [
      { id: "phase16-risk-gate", label: "第十六阶段风险门禁", status: "ready", detail: "后端导出继续携带 phase16Sync。" },
      { id: "device-trust", label: "设备信任", status: "ready", detail: "SQLite 后端作为本地可信设备。" },
      { id: "queue-failures", label: "失败任务", status: "ready", detail: "后端静态导出暂无失败任务。" },
      { id: "private-cloud-boundary", label: "私有云边界", status: "ready", detail: "后端不保存云端凭据。" }
    ],
    recommendation: "后端导出摘要已具备第十七阶段维护补丁健康度字段。"
  };
  const assetCount = store.listSavedExhibitions().length + store.listReportDrafts().length;
  return {
    phase: 17,
    phaseName: "真实多设备同步适配层版",
    buildLabel: "phase17-sync-health-sixth-edition",
    mode: "adapter-layer-local-first",
    generatedAt,
    dependsOn: ["phase16Sync", "manual-json-local-first"],
    deviceRegistry: {
      localDeviceId: "server-sqlite",
      deviceCount: 1,
      devices: [
        {
          id: "server-sqlite",
          label: "SQLite 后端",
          owner: "本地馆主",
          role: "local-database",
          status: "trusted",
          syncMode: "manual-json"
        }
      ]
    },
    adapters: [
      { id: "manual-json", label: "手动 JSON 同步", status: "active", writable: true },
      { id: "lan-bridge", label: "局域网桥接", status: "simulated", writable: false },
      { id: "private-cloud", label: "私有云适配", status: "planned", writable: false }
    ],
    queue: {
      pending: 0,
      failures: 0,
      resolved: 0,
      byStatus: {},
      byChannel: {},
      recent: []
    },
    lanHandshake: {
      channel: "lan-bridge",
      status: "standby",
      mode: "read-only-handshake-simulation",
      localEndpoint: "server-sqlite",
      localFingerprint,
      peerCandidates: [],
      checks: [
        { id: "same-network", label: "同网段发现", status: "simulated", detail: "后端导出只声明握手模型，不扫描局域网。" },
        { id: "data-transfer", label: "私人数据传输", status: "blocked", detail: "第二版不传输展品正文、附件或专题资产。" },
        { id: "manual-review", label: "人工确认", status: "required", detail: "进入真实交换前必须回到第十六阶段风险确认。" }
      ]
    },
    deviceTrustPolicy: {
      mode: "explicit-trust-required",
      trusted: 1,
      review: 0,
      blocked: 0,
      rules: [
        "本机 SQLite 后端可信不代表外部设备可信。",
        "历史候选设备需要人工确认。",
        "任何跨设备写入仍需第十六阶段风险确认。"
      ]
    },
    privateCloudBoundary: {
      channel: "private-cloud",
      status: "not-configured",
      provider: "none",
      endpoint: "not-configured",
      enabled: false,
      credentialStored: false,
      policy: "configuration-boundary-only",
      checks: [
        { id: "auto-upload", label: "自动上传", status: "blocked", detail: "后端不会自动上传同步包。" },
        { id: "credential", label: "凭据保存", status: "blocked", detail: "后端导出不包含云端密钥。" },
        { id: "manual-export", label: "手动导出", status: "required", detail: "外部通道仍依赖手动同步包。" }
      ]
    },
    syncHealth,
    healthExplanation: {
      score: syncHealth.score,
      reviewCount: 0,
      reasons: [],
      summary: "后端同步健康度稳定，可以继续作为第十八阶段长期助理的同步底座。"
    },
    failureRecovery: {
      failedCount: 0,
      actions: [],
      recommendation: "后端静态导出暂无失败任务；可保留当前同步节奏。"
    },
    phase18SyncAdvisory: buildPhase18SyncAdvisoryForServer(),
    syncScope: {
      memories: memories.length,
      assets: assetCount,
      assetPolicy: "preview-first-no-silent-merge"
    },
    safety: {
      localFirst: true,
      autoUpload: false,
      requiresReview: true,
      inheritsPhase16RiskGate: true
    }
  };
}

function buildPhase18LongTermAgent(memories = []) {
  const structured = memories.map(buildStructuredMemory);
  const suggestions = buildPhase18ProactiveSuggestions(structured);
  const relationships = buildPhase18RelationshipMap(structured);
  const periodicReviews = buildPhase18PeriodicReviews(structured);
  const suggestionNoise = buildPhase18SuggestionNoisePolicy(suggestions);
  const repairDraftTotal = suggestions.reduce((sum, item) => sum + (item.memoryIds?.length || 0), 0);
  const agentQuality = {
    feedbackTotal: 0,
    acceptanceRate: 0,
    taskResolvedRate: 0,
    repairApplyRate: 0,
    appliedDrafts: 0,
    previewDrafts: repairDraftTotal,
    failedTasks: 0,
    recommendation: repairDraftTotal ? "前端可继续生成、复核并应用修复草案。" : "继续积累展品后再评估长期助理质量。"
  };
  const reviewDashboard = buildPhase18ReviewDashboard({
    suggestions,
    relationships,
    periodicReviews,
    agentQuality,
    suggestionNoise,
    repairDraftTotal
  });
  const assetSyncState = buildPhase18AssetSyncStateForServer();
  const agentDigest = buildPhase18AgentDigestForServer({
    structured,
    suggestions,
    relationships,
    periodicReviews,
    agentQuality,
    suggestionNoise,
    repairDraftTotal,
    assetSyncState
  });
  const readinessChecks = [
    { id: "suggestions", label: "主动整理建议", status: suggestions.length ? "ready" : "needs-sample", detail: suggestions.length ? `${suggestions.length} 条建议` : "需要更多展品生成建议。" },
    { id: "relationships", label: "跨展品关系", status: relationships.clusters.length ? "ready" : "needs-sample", detail: relationships.clusters.length ? `${relationships.clusters.length} 组关系` : "需要人物、地点、标签或情绪线索。" },
    { id: "periodic-review", label: "周期回顾", status: periodicReviews.length ? "ready" : "needs-date", detail: periodicReviews.length ? `${periodicReviews.length} 个回顾候选` : "需要带日期的展品。" },
    { id: "feedback-loop", label: "反馈闭环", status: "ready", detail: "前端本地记录采纳和忽略反馈。" },
    { id: "task-audit", label: "任务审计", status: "ready", detail: "前端本地记录任务状态、草案生成和批量应用。" },
    { id: "review-assets", label: "回顾资产", status: periodicReviews.length ? "ready" : "needs-date", detail: periodicReviews.length ? "周期回顾可保存为专题展草稿。" : "需要月度回顾候选。" },
    { id: "review-reports", label: "回顾报告", status: periodicReviews.length ? "ready" : "needs-date", detail: periodicReviews.length ? "周期回顾可保存为报告草稿。" : "需要月度回顾候选。" }
  ];
  return {
    phase: 18,
    phaseName: "Agent 能力进阶和长期记忆助理版",
    buildLabel: "phase18-agent-digest-thirteenth-edition",
    mode: "local-long-term-memory-assistant",
    generatedAt: new Date().toISOString(),
    sourceCount: structured.length,
    suggestions,
    visibleSuggestions: suggestionNoise.visible,
    suggestionNoise,
    relationships,
    periodicReviews,
    taskQueue: {
      total: suggestions.length,
      active: suggestions.length,
      queued: suggestions.filter((item) => item.priority !== "high").length,
      reviewing: suggestions.filter((item) => item.priority === "high").length,
      applied: 0,
      dismissed: 0,
      failed: 0,
      persistence: "browser-localStorage",
      recent: suggestions.slice(0, 8).map((item, index) => ({
        id: `phase18-task-${item.id || index}`,
        status: item.priority === "high" ? "reviewing" : "queued",
        label: item.title,
        source: item.type,
        priority: item.priority,
        memoryIds: item.memoryIds || []
      })),
      batchReview: buildPhase18TaskBatchPlan(suggestions)
    },
    feedbackLoop: {
      total: 0,
      accepted: 0,
      dismissed: 0,
      recent: []
    },
    agentQuality,
    agentDigest,
    reviewDashboard,
    repairDrafts: {
      total: repairDraftTotal,
      preview: repairDraftTotal,
      applied: 0,
      policy: "preview-first-user-applies",
      batchReview: {
        ready: repairDraftTotal > 0,
        previewCount: repairDraftTotal,
        targetCount: new Set(suggestions.flatMap((item) => item.memoryIds || [])).size,
        policy: "前端批量应用前弹出确认，并写入浏览器本地审计记录。"
      }
    },
    taskAudit: {
      total: 0,
      persistence: "browser-localStorage",
      recent: []
    },
    periodicAssetPlan: {
      ready: periodicReviews.length > 0,
      candidates: periodicReviews.length,
      persistence: "sqlite-saved-exhibitions"
    },
    periodicReportPlan: {
      ready: periodicReviews.length > 0,
      candidates: periodicReviews.length,
      persistence: "sqlite-report-drafts"
    },
    assetSyncState,
    suggestionQuality: {
      high: suggestions.filter((item) => item.quality?.tier === "A").length,
      medium: suggestions.filter((item) => item.quality?.tier === "B").length,
      low: suggestions.filter((item) => item.quality?.tier === "C").length,
      averageScore: suggestions.length ? Math.round(suggestions.reduce((sum, item) => sum + (item.quality?.score || 0), 0) / suggestions.length) : 0
    },
    readinessChecks,
    nextStep: agentDigest.recommendation || (suggestions.length || relationships.clusters.length
      ? "优先处理高优先级建议，再把稳定主题推进为周期回顾或专题资产。"
      : "先继续保存更多带时间、人物、地点和标签的展品。")
  };
}

function buildPhase18ProactiveSuggestions(memories = []) {
  const suggestions = [];
  const missingDate = memories.filter((memory) => !memory.date);
  const missingPeople = memories.filter((memory) => !memory.people?.length);
  const missingLocation = memories.filter((memory) => !memory.location);
  const missingTags = memories.filter((memory) => !memory.tags?.length);
  const highValueNoMedia = memories.filter((memory) => (memory.favorite || memory.importance >= 4) && !memory.coverImage && !memory.mediaNote && !memory.attachments?.length);
  if (missingDate.length) suggestions.push(buildPhase18Suggestion("missing-date", "补全时间线日期", "timeline", "high", missingDate, `有 ${missingDate.length} 件展品缺少日期，周期回顾会受影响。`));
  if (missingPeople.length) suggestions.push(buildPhase18Suggestion("missing-people", "补充相关人物", "relationship", "medium", missingPeople, `有 ${missingPeople.length} 件展品缺少人物线索。`));
  if (missingLocation.length) suggestions.push(buildPhase18Suggestion("missing-location", "补充地点线索", "relationship", "medium", missingLocation, `有 ${missingLocation.length} 件展品缺少地点线索。`));
  if (missingTags.length) suggestions.push(buildPhase18Suggestion("missing-tags", "补充主题标签", "theme", "medium", missingTags, `有 ${missingTags.length} 件展品缺少标签。`));
  if (highValueNoMedia.length) suggestions.push(buildPhase18Suggestion("high-value-media", "为重点展品补附件说明", "multimodal", "high", highValueNoMedia, `有 ${highValueNoMedia.length} 件重点展品缺少多模态线索。`));
  return suggestions;
}

function buildPhase18Suggestion(id, title, type, priority, matches, detail) {
  const quality = buildPhase18SuggestionQuality(type, priority, matches);
  return {
    id,
    title,
    type,
    priority,
    quality,
    detail,
    count: matches.length,
    memoryIds: matches.slice(0, 6).map((memory) => memory.id),
    examples: matches.slice(0, 3).map(buildMemoryReference)
  };
}

function buildPhase18SuggestionQuality(type, priority, matches = []) {
  const count = matches.length;
  const evidenceRich = matches.filter((memory) => (
    memory.date ||
    memory.location ||
    memory.people?.length ||
    memory.tags?.length ||
    memory.emotions?.length ||
    memory.mediaNote ||
    memory.attachments?.length
  )).length;
  const coverage = count ? Math.round((evidenceRich / count) * 100) : 0;
  const urgency = priority === "high" ? 34 : priority === "medium" ? 22 : 12;
  const breadth = Math.min(34, count * 6);
  const score = Math.min(100, urgency + breadth + Math.round(coverage / 4));
  const tier = score >= 72 ? "A" : score >= 48 ? "B" : "C";
  return {
    tier,
    score,
    coverage,
    evidenceRich,
    reason: tier === "A"
      ? "高价值且影响面较大，建议优先复核。"
      : tier === "B"
        ? "价值稳定，可排入常规整理。"
        : "线索较轻，适合后续批量处理。"
  };
}

function buildPhase18SuggestionNoisePolicy(suggestions = []) {
  const quiet = suggestions.filter((item) => item.quality?.tier === "C");
  const visible = suggestions.filter((item) => item.quality?.tier !== "C").sort((a, b) => (b.quality?.score || 0) - (a.quality?.score || 0));
  return {
    mode: "auto-tier-and-feedback",
    quietCount: quiet.length,
    visible: visible.length ? visible : suggestions.slice().sort((a, b) => (b.quality?.score || 0) - (a.quality?.score || 0)),
    quiet: quiet.map((item) => ({
      id: item.id,
      title: item.title,
      tier: item.quality?.tier || "C",
      reason: "质量分层较低，自动降噪"
    })),
    recommendation: quiet.length ? `已自动降噪 ${quiet.length} 条低优先级建议。` : "当前建议质量稳定，无需降噪。"
  };
}

function getDefaultPhase18NoiseRuleConfig() {
  return {
    mode: "configurable-tier-feedback",
    hideLowTier: true,
    hideDismissed: true,
    hideWeakEvidence: false,
    minVisibleScore: 48,
    keepHighPriority: true
  };
}

function normalizePhase18NoiseRuleConfig(config = {}) {
  const defaults = getDefaultPhase18NoiseRuleConfig();
  const score = Number(config.minVisibleScore);
  return {
    ...defaults,
    ...config,
    minVisibleScore: Number.isFinite(score) ? Math.min(90, Math.max(0, Math.round(score))) : defaults.minVisibleScore,
    hideLowTier: config.hideLowTier !== false,
    hideDismissed: config.hideDismissed !== false,
    hideWeakEvidence: config.hideWeakEvidence === true,
    keepHighPriority: config.keepHighPriority !== false
  };
}

function buildPhase18NoiseRulePreview({ suggestions = [], quiet = [], visible = [], config = {} } = {}) {
  const quietIds = new Set(quiet.map((item) => item.id));
  const recoverable = suggestions.filter((item) => quietIds.has(item.id) && (
    item.quality?.tier === "B" ||
    item.priority === "high" ||
    (item.quality?.score || 0) >= Math.max(0, (config.minVisibleScore || 0) - 8)
  ));
  return {
    total: suggestions.length,
    visibleCount: visible.length,
    quietCount: quiet.length,
    recoverableCount: recoverable.length,
    hiddenByTier: quiet.filter((item) => item.noiseReason === "low-tier").length,
    hiddenByFeedback: quiet.filter((item) => item.noiseReason === "dismissed").length,
    hiddenByWeakEvidence: quiet.filter((item) => item.noiseReason === "weak-evidence").length,
    hiddenByScore: quiet.filter((item) => item.noiseReason === "below-score").length,
    recoverable: recoverable.slice(0, 4).map((item) => ({
      id: item.id,
      title: item.title,
      tier: item.quality?.tier || "C",
      score: item.quality?.score || 0
    })),
    recommendation: quiet.length
      ? "当前规则已收起低置信或暂不处理的建议，可在规则面板临时放宽后复核。"
      : "当前规则没有收起建议，可以继续保持自动复盘。"
  };
}

function buildPhase18SuggestionNoisePolicy(suggestions = [], configInput = getDefaultPhase18NoiseRuleConfig()) {
  const config = normalizePhase18NoiseRuleConfig(configInput);
  const scored = suggestions.map((item) => {
    const score = item.quality?.score || 0;
    let noiseReason = "";
    if (config.hideLowTier && item.quality?.tier === "C") noiseReason = "low-tier";
    if (!noiseReason && config.hideWeakEvidence && (item.quality?.coverage || 0) < 35) noiseReason = "weak-evidence";
    if (!noiseReason && score < config.minVisibleScore) noiseReason = "below-score";
    if (config.keepHighPriority && item.priority === "high") noiseReason = "";
    return { ...item, noiseReason };
  });
  const quiet = scored.filter((item) => item.noiseReason);
  const visible = scored.filter((item) => !item.noiseReason);
  const sortedVisible = visible.sort((a, b) => (b.quality?.score || 0) - (a.quality?.score || 0));
  const fallbackVisible = suggestions.slice().sort((a, b) => (b.quality?.score || 0) - (a.quality?.score || 0));
  const preview = buildPhase18NoiseRulePreview({ suggestions: scored, quiet, visible: sortedVisible, config });
  return {
    mode: config.mode,
    config,
    preview,
    quietCount: quiet.length,
    visible: sortedVisible.length ? sortedVisible : fallbackVisible,
    quiet: quiet.map((item) => ({
      id: item.id,
      title: item.title,
      tier: item.quality?.tier || "C",
      score: item.quality?.score || 0,
      noiseReason: item.noiseReason,
      reason: item.noiseReason === "weak-evidence"
        ? "证据覆盖不足，已按规则收起"
        : item.noiseReason === "below-score"
          ? "低于当前显示分数阈值"
          : "质量分层较低，已按规则收起"
    })),
    recommendation: quiet.length
      ? `已按规则收起 ${quiet.length} 条建议，当前显示 ${sortedVisible.length || fallbackVisible.length} 条。`
      : "当前建议质量稳定，没有被规则收起的建议。"
  };
}

function buildPhase18TaskBatchPlan(suggestions = []) {
  const taskCount = suggestions.length;
  const draftableSuggestions = suggestions.filter((item) => ["missing-date", "missing-people", "missing-location", "missing-tags", "high-value-media"].includes(item.id));
  return {
    mode: "browser-selected-batch-actions",
    ready: taskCount > 0,
    selectable: taskCount,
    draftableSuggestions: draftableSuggestions.length,
    actions: ["select-visible", "batch-reviewing", "batch-applied", "batch-dismissed", "batch-failed", "batch-repair-drafts"],
    auditAction: "task-batch-status-changed",
    recommendation: taskCount
      ? "前端可按筛选结果多选长期任务，批量流转状态或生成修复草案，并写入本地审计。"
      : "等待长期助理生成建议后再启用批量任务处理。"
  };
}

function buildPhase18ReviewDashboard({ suggestions = [], relationships = {}, periodicReviews = [], agentQuality = {}, suggestionNoise = {}, repairDraftTotal = 0 } = {}) {
  const highTier = suggestions.filter((item) => item.quality?.tier === "A").length;
  return {
    status: suggestions.length || relationships.clusterCount || periodicReviews.length ? "active" : "waiting",
    focus: highTier ? "优先处理 A 级建议" : periodicReviews.length ? "优先沉淀周期回顾" : "继续补充展品线索",
    savedReviews: 0,
    reviewCoverage: 0,
    graphCoverage: relationships.graph?.nodeCount || 0,
    quietSuggestions: suggestionNoise.quietCount || 0,
    openTasks: suggestions.length,
    unresolvedDrafts: repairDraftTotal,
    qualityScore: Math.round(((agentQuality.acceptanceRate || 0) + (agentQuality.taskResolvedRate || 0) + (agentQuality.repairApplyRate || 0)) / 3),
    latestAudit: "后端导出不包含浏览器本地审计明细。",
    recommendation: suggestionNoise.quietCount
      ? "先处理未降噪的 A/B 级建议，再复盘被忽略建议。"
      : "继续把稳定回顾保存为专题资产或报告草稿。"
  };
}

function buildPhase18AgentDigestForServer({
  structured = [],
  suggestions = [],
  relationships = {},
  periodicReviews = [],
  agentQuality = {},
  suggestionNoise = {},
  repairDraftTotal = 0,
  assetSyncState = {}
} = {}) {
  const highSuggestions = suggestions.filter((item) => item.priority === "high" || item.quality?.tier === "A");
  const relationClusters = relationships.clusters || [];
  const riskAssets = assetSyncState.items?.filter((item) => item.syncStatus === "risk") || [];
  const todayFocus = highSuggestions[0]?.title
    || (repairDraftTotal ? "复核可生成的修复草案" : "")
    || (periodicReviews.length ? "沉淀一个周期回顾" : "")
    || "补充展品的时间、人物、地点和标签线索";
  const weeklyFocus = relationClusters.length >= 2
    ? "把稳定关系簇整理成专题展或报告草稿"
    : periodicReviews.length
      ? "选择一个月度回顾保存为长期资产"
      : "持续积累可用于长期助理学习的展品样本";
  const topActions = [
    highSuggestions[0] ? {
      id: `suggestion-${highSuggestions[0].id}`,
      label: highSuggestions[0].title,
      detail: highSuggestions[0].detail,
      memoryIds: highSuggestions[0].memoryIds || []
    } : null,
    periodicReviews[0] ? {
      id: `review-${periodicReviews[0].id}`,
      label: periodicReviews[0].label,
      detail: `${periodicReviews[0].count || 0} 件展品可沉淀为周期回顾。`,
      memoryIds: periodicReviews[0].memories?.map((item) => item.id).filter(Boolean) || []
    } : null,
    relationClusters[0] ? {
      id: `relation-${relationClusters[0].id}`,
      label: `${relationClusters[0].type}：${relationClusters[0].value}`,
      detail: relationClusters[0].evidence || "关系簇可继续整理成讲解线索。",
      memoryIds: relationClusters[0].memories?.map((item) => item.id).filter(Boolean) || []
    } : null
  ].filter(Boolean).slice(0, 3);
  const readiness = riskAssets.length || agentQuality.failedTasks || agentQuality.failedTransitions
    ? "needs-attention"
    : (suggestions.length || repairDraftTotal || periodicReviews.length ? "ready" : "warming-up");
  return {
    mode: "daily-weekly-memory-assistant-digest",
    generatedAt: new Date().toISOString(),
    todayFocus,
    weeklyFocus,
    topActions,
    signals: {
      memories: structured.length,
      activeTasks: suggestions.length,
      quietSuggestions: suggestionNoise.quietCount || 0,
      relationClusters: relationClusters.length,
      reviewCandidates: periodicReviews.length,
      savedReviews: 0,
      previewDrafts: repairDraftTotal,
      assetSyncRisk: riskAssets.length,
      latestAudit: "后端导出不包含浏览器本地审计明细。"
    },
    cadence: {
      daily: "打开页面后先看摘要焦点，再处理一条高优先级任务。",
      weekly: "每周选择一个稳定关系簇或周期回顾，保存为专题展或报告草稿。"
    },
    readiness,
    recommendation: readiness === "needs-attention"
      ? "先处理同步风险或失败任务，再继续推进新整理。"
      : topActions.length
        ? "今天先完成摘要中的第一项动作，本周再把稳定关系或周期回顾沉淀为资产。"
        : "继续补充展品线索，长期助理会在样本变丰富后生成更明确摘要。"
  };
}

function buildPhase18RelationshipMap(memories = []) {
  const dimensions = [
    { id: "people", label: "共同人物", values: (memory) => memory.people || [] },
    { id: "locations", label: "重复地点", values: (memory) => memory.location ? [memory.location] : [] },
    { id: "tags", label: "相同标签", values: (memory) => memory.tags || [] },
    { id: "emotions", label: "相似情绪", values: (memory) => memory.emotions || [] }
  ];
  const clusters = dimensions.flatMap((dimension) => {
    const map = new Map();
    memories.forEach((memory) => {
      dimension.values(memory).forEach((value) => {
        const key = limitText(value, 40);
        if (!key) return;
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(memory);
      });
    });
    return [...map.entries()]
      .filter(([, group]) => group.length >= 2)
      .map(([value, group]) => ({
        id: `${dimension.id}-${simpleChecksum(value)}`,
        type: dimension.label,
        value,
        count: group.length,
        strength: group.length >= 5 ? "strong" : group.length >= 3 ? "medium" : "light",
        evidence: `${dimension.label}“${value}”连接了 ${group.length} 件展品，可作为专题展或讲解线索。`,
        memories: group.slice(0, 5).map(buildMemoryReference)
      }));
  }).sort((a, b) => b.count - a.count).slice(0, 8);
  const assetNavigation = buildPhase18AssetNavigationIndexForServer(clusters);
  const enrichedClusters = clusters.map((cluster) => ({
    ...cluster,
    assetLinks: assetNavigation.byCluster[cluster.id]?.assets || [],
    reportLinks: assetNavigation.byCluster[cluster.id]?.reports || []
  }));
  return { clusterCount: enrichedClusters.length, clusters: enrichedClusters, assetNavigation, graph: buildPhase18RelationshipGraph(enrichedClusters) };
}

function getReportReferenceIdsForServer(report = {}) {
  return (Array.isArray(report.references) ? report.references : [])
    .map((ref) => ref.memoryId || ref.id || ref.memory_id || "")
    .filter(Boolean);
}

function buildPhase18AssetNavigationIndexForServer(clusters = []) {
  const exhibitions = store.listSavedExhibitions();
  const reports = store.listReportDrafts();
  const byCluster = {};
  const assetLookup = {};
  const reportLookup = {};
  clusters.forEach((cluster) => {
    const clusterMemoryIds = new Set((cluster.memories || []).map((memory) => memory.id).filter(Boolean));
    const assets = exhibitions.map((asset) => {
      const ids = Array.isArray(asset.memoryIds) ? asset.memoryIds : [];
      const overlap = ids.filter((id) => clusterMemoryIds.has(id));
      return overlap.length ? {
        id: asset.id,
        title: asset.title || "未命名专题展",
        type: "exhibition",
        overlapCount: overlap.length,
        status: asset.status || "draft"
      } : null;
    }).filter(Boolean).slice(0, 3);
    const linkedReports = reports.map((report) => {
      const ids = getReportReferenceIdsForServer(report);
      const overlap = ids.filter((id) => clusterMemoryIds.has(id));
      return overlap.length ? {
        id: report.id,
        title: report.title || "未命名报告草稿",
        type: "report",
        overlapCount: overlap.length,
        status: report.status || "draft"
      } : null;
    }).filter(Boolean).slice(0, 3);
    byCluster[cluster.id] = { assets, reports: linkedReports };
    assets.forEach((asset) => {
      assetLookup[asset.id] = [...(assetLookup[asset.id] || []), {
        id: cluster.id,
        label: `${cluster.type}:${cluster.value}`,
        overlapCount: asset.overlapCount
      }].slice(0, 4);
    });
    linkedReports.forEach((report) => {
      reportLookup[report.id] = [...(reportLookup[report.id] || []), {
        id: cluster.id,
        label: `${cluster.type}:${cluster.value}`,
        overlapCount: report.overlapCount
      }].slice(0, 4);
    });
  });
  return {
    byCluster,
    assetLookup,
    reportLookup,
    linkedAssetCount: Object.keys(assetLookup).length,
    linkedReportCount: Object.keys(reportLookup).length,
    recommendation: Object.keys(assetLookup).length || Object.keys(reportLookup).length
      ? "关系图谱已能跳转到相关专题展和报告草稿，也可从资产卡片回看关系来源。"
      : "保存包含这些展品的专题展或报告后，关系图谱会自动出现资产跳转。"
  };
}

function buildPhase18RelationshipGraph(clusters = []) {
  const nodes = [];
  const edges = [];
  const nodeIds = new Set();
  const addNode = (id, label, type, weight = 1) => {
    if (nodeIds.has(id)) return;
    nodeIds.add(id);
    nodes.push({ id, label: limitText(label, 60), type, weight });
  };
  clusters.slice(0, 6).forEach((cluster) => {
    const clusterId = `cluster-${cluster.id}`;
    addNode(clusterId, `${cluster.type}:${cluster.value}`, "cluster", cluster.count);
    (cluster.memories || []).slice(0, 4).forEach((memory) => {
      const memoryId = `memory-${memory.id}`;
      addNode(memoryId, memory.title, "memory", 1);
      edges.push({
        from: clusterId,
        to: memoryId,
        label: cluster.type,
        strength: cluster.strength || "light"
      });
    });
    (cluster.assetLinks || []).slice(0, 2).forEach((asset) => {
      const assetId = `asset-${asset.id}`;
      addNode(assetId, asset.title, "asset", asset.overlapCount || 1);
      edges.push({
        from: clusterId,
        to: assetId,
        label: "专题展",
        strength: asset.overlapCount >= 3 ? "medium" : "light"
      });
    });
    (cluster.reportLinks || []).slice(0, 2).forEach((report) => {
      const reportId = `report-${report.id}`;
      addNode(reportId, report.title, "report", report.overlapCount || 1);
      edges.push({
        from: clusterId,
        to: reportId,
        label: "报告",
        strength: report.overlapCount >= 3 ? "medium" : "light"
      });
    });
  });
  return {
    nodeCount: nodes.length,
    edgeCount: edges.length,
    nodes: nodes.slice(0, 18),
    edges: edges.slice(0, 24),
    summary: nodes.length ? `${nodes.length} 个节点 / ${edges.length} 条关系` : "等待更多关系线索"
  };
}

function buildPhase18PeriodicReviews(memories = []) {
  const byMonth = memories.reduce((map, memory) => {
    const month = String(memory.date || memory.createdAt || "").slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) return map;
    if (!map.has(month)) map.set(month, []);
    map.get(month).push(memory);
    return map;
  }, new Map());
  return [...byMonth.entries()]
    .filter(([, group]) => group.length >= 2)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 6)
    .map(([month, group]) => ({
      id: `review-${month}`,
      period: month,
      label: `${month} 月度回顾`,
      count: group.length,
      topEmotions: toTopEntries(countValues(group.flatMap((memory) => memory.emotions || [])), 3),
      memories: group.slice(0, 5).map(buildMemoryReference),
      assetCandidate: {
        title: `${month} 月度回顾专题展`,
        memoryIds: group.slice(0, 12).map((memory) => memory.id),
        tags: ["周期回顾", month, ...toTopEntries(countValues(group.flatMap((memory) => memory.emotions || [])), 3).map((item) => item.label)].filter(Boolean).slice(0, 8)
      }
    }));
}

function buildAssetCollection() {
  return {
    schemaVersion: SCHEMA_VERSION,
    phase: PHASE,
    phaseName: PHASE_NAME,
    generatedAt: new Date().toISOString(),
    savedExhibitions: store.listSavedExhibitions(),
    reportDrafts: store.listReportDrafts(),
    phase15Readiness: operationsService.buildPhase15Readiness(store.listMemories()),
    phase15AssetPlan: operationsService.buildPhase15AssetPlan(store.listMemories())
  };
}

function buildExhibitionDraftFromTheme(input = {}) {
  const filters = {
    hall: limitText(input.hall, 40),
    year: limitText(input.year, 4),
    theme: limitText(input.theme || input.themeTitle, 80)
  };
  const insights = buildPhase10Insights(store.listMemories(), filters);
  const requestedTheme = String(input.themeTitle || input.theme || "").trim();
  const theme = insights.themes.find((item) => (
    requestedTheme
      ? item.title === requestedTheme || item.title.includes(requestedTheme) || requestedTheme.includes(item.title)
      : true
  )) || insights.themes[0];
  const memories = theme?.memories || [];
  const memoryIds = memories.map((item) => item.id).filter(Boolean);
  const now = Date.now();
  return {
    id: input.id || `theme-exhibition-${now}`,
    title: limitText(input.title || (theme ? `${theme.title}专题展` : "新的专题展"), 120),
    intro: limitText(input.intro || theme?.description || "从当前洞察结果生成的专题展草稿。", 800),
    status: input.status || "draft",
    coverMemoryId: input.coverMemoryId || theme?.coverMemory?.id || memoryIds[0] || "",
    memoryIds,
    sort: memoryIds.map((id, index) => ({ id, position: index + 1 })),
    guideText: limitText(input.guideText || buildThemeGuideText(theme), 2000),
    tags: [theme?.type, theme?.title, filters.year].filter(Boolean),
    source: {
      type: "theme-insights",
      filters,
      theme: theme ? { type: theme.type, title: theme.title, count: theme.count } : null,
      generatedAt: new Date().toISOString()
    }
  };
}

function buildReportDraftFromInsights(input = {}) {
  const filters = {
    hall: limitText(input.hall, 40),
    year: limitText(input.year, 4),
    theme: limitText(input.theme, 80)
  };
  const insights = buildPhase10Insights(store.listMemories(), filters);
  const now = Date.now();
  return {
    id: input.id || `insights-report-${now}`,
    title: limitText(input.title || buildReportDraftTitle(filters), 120),
    status: input.status || "draft",
    scope: {
      ...insights.filters,
      sourceTotal: insights.sourceTotal,
      filteredTotal: insights.filteredTotal
    },
    sections: Array.isArray(input.sections) && input.sections.length ? input.sections : insights.report.sections,
    references: Array.isArray(input.references) && input.references.length ? input.references : insights.report.references,
    sourceInsights: {
      generatedAt: insights.generatedAt,
      filters: insights.filters,
      sourceTotal: insights.sourceTotal,
      filteredTotal: insights.filteredTotal,
      topThemes: insights.themes.slice(0, 5).map((theme) => ({
        type: theme.type,
        title: theme.title,
        count: theme.count
      })),
      timeline: insights.timeline.slice(0, 6).map((item) => ({
        key: item.key,
        label: item.label,
        count: item.count
      }))
    },
    source: {
      type: "phase10-insights",
      filters,
      generatedAt: new Date().toISOString()
    }
  };
}

function buildThemeGuideText(theme) {
  if (!theme) return "这是一条从洞察结果生成的专题展草稿，可继续补充导览词。";
  const titles = (theme.memories || []).slice(0, 3).map((item) => `《${item.title}》`).join("、");
  return `${theme.description || ""}${titles ? ` 建议从 ${titles} 开始讲述。` : ""}`.trim();
}

function buildReportDraftTitle(filters = {}) {
  if (filters.theme) return `${filters.theme}回忆报告`;
  if (filters.year) return `${filters.year}年度回忆报告`;
  return "回忆报告草稿";
}

function buildRedactedMemory(memory) {
  const structured = buildStructuredMemory(memory);
  return {
    ...structured,
    rawContent: redactText(structured.rawContent, "原始记忆已脱敏"),
    exhibitText: redactText(structured.exhibitText, "展品说明已脱敏"),
    location: structured.location ? "地点已脱敏" : "",
    people: structured.people.map((_, index) => `人物${index + 1}`),
    coverImage: structured.coverImage ? "封面线索已脱敏" : "",
    mediaNote: structured.mediaNote ? "多模态说明已脱敏" : "",
    attachments: structured.attachments.map((item, index) => ({
      name: `附件${index + 1}`,
      type: item.type || "其他",
      note: item.note ? "备注已脱敏" : ""
    }))
  };
}

function redactText(value, fallback) {
  if (!value) return "";
  return `${fallback}（${String(value).length} 字）`;
}

function buildRedactionPolicy() {
  return {
    mode: "redacted",
    maskedFields: ["rawContent", "exhibitText", "people", "location", "coverImage", "mediaNote", "attachments.name", "attachments.note"],
    preservedFields: ["id", "hall", "sourceType", "date", "tags", "emotions", "importance", "favorite", "createdAt", "updatedAt"],
    note: "脱敏包用于演示、排查和跨设备预览，不适合作为完整恢复备份。"
  };
}

function buildMediaSummary(memories = []) {
  const structured = memories.map(buildStructuredMemory);
  const attachmentTypeCounts = structured.reduce((counts, memory) => {
    Object.entries(buildAttachmentTypeCounts(memory.attachments)).forEach(([type, count]) => {
      counts[type] = (counts[type] || 0) + count;
    });
    return counts;
  }, {});
  return {
    withCover: structured.filter((memory) => memory.coverImage).length,
    withMediaNote: structured.filter((memory) => memory.mediaNote).length,
    withAttachments: structured.filter((memory) => memory.attachments.length > 0).length,
    attachmentCount: structured.reduce((total, memory) => total + memory.attachments.length, 0),
    attachmentTypeCounts,
    attachmentTypes: sortAttachmentTypeCounts(attachmentTypeCounts).map(([type, count]) => ({ type, count })),
    fileStorage: "metadata-only",
    note: "当前导出包含附件清单和线索，不包含原始附件文件。"
  };
}

function buildPhase10Handoff(memories = []) {
  const structured = memories.map(buildStructuredMemory);
  const timelineReady = structured.filter((memory) => memory.date).length;
  const themeReady = structured.filter((memory) => (
    memory.tags.length
    || memory.people.length
    || memory.location
    || memory.emotions.length
    || memory.hall?.id
    || memory.sourceType
  )).length;
  const reportReady = structured.filter((memory) => (
    memory.rawContent
    && memory.exhibitText
    && (memory.tags.length || memory.emotions.length || memory.mediaNote || memory.attachments.length)
  )).length;
  const multimodalEvidence = structured.filter((memory) => (
    memory.coverImage
    || memory.mediaNote
    || memory.attachments.length
  )).length;
  return {
    total: structured.length,
    timelineReady,
    themeReady,
    reportReady,
    multimodalEvidence,
    missingDate: Math.max(0, structured.length - timelineReady),
    readyForPhase10: structured.length > 0 && themeReady > 0 && reportReady > 0,
    note: "阶段十将基于时间、人物、地点、标签、情绪和多模态证据生成时间线、主题展和回忆报告。"
  };
}

function buildPhase11Handoff(memories = []) {
  const structured = memories.map(buildStructuredMemory);
  const phase10 = buildPhase10Handoff(memories);
  const withAgentRun = structured.filter((memory) => memory.agentRunId).length;
  const withReviewEvidence = structured.filter((memory) => (
    memory.rawContent
    && memory.exhibitText
    && (memory.tags.length || memory.people.length || memory.emotions.length)
  )).length;
  const withGuideEvidence = structured.filter((memory) => (
    memory.exhibitText
    && (memory.tags.length || memory.mediaNote || memory.attachments.length || memory.people.length)
  )).length;
  const runCoverage = buildCoverageRatio(withAgentRun, structured.length);
  const reviewCoverage = buildCoverageRatio(withReviewEvidence, structured.length);
  const guideCoverage = buildCoverageRatio(withGuideEvidence, structured.length);
  const gaps = buildPhase11Gaps({ structured, phase10, withAgentRun, withReviewEvidence, withGuideEvidence });
  return {
    total: structured.length,
    templates: workflowTemplates.length,
    withAgentRun,
    withReviewEvidence,
    withGuideEvidence,
    runCoverage,
    reviewCoverage,
    guideCoverage,
    gaps,
    recommendedNextActions: buildPhase11NextActions(gaps),
    readyForPhase11: structured.length > 0 && phase10.readyForPhase10 && (withAgentRun > 0 || withReviewEvidence > 0),
    nextEngine: "lightweight-orchestrator",
    note: "阶段十一会先用轻量编排层固化模板、暂停点、复核项和回放线索，后续再评估接入正式图编排引擎。"
  };
}

function buildCoverageRatio(value, total) {
  if (!total) return 0;
  return Math.round((Number(value) / Math.max(Number(total), 1)) * 100);
}

function buildPhase11Gaps({ structured, phase10, withAgentRun, withReviewEvidence, withGuideEvidence }) {
  const gaps = [];
  if (!structured.length) gaps.push({ id: "no-memories", label: "还没有展品样本", severity: "high" });
  if (phase10.missingDate > 0) gaps.push({ id: "missing-date", label: `${phase10.missingDate} 件展品缺少时间`, severity: "medium" });
  if (withAgentRun < structured.length) gaps.push({ id: "agent-run-coverage", label: `${structured.length - withAgentRun} 件展品没有整理历史`, severity: "medium" });
  if (withReviewEvidence < structured.length) gaps.push({ id: "review-evidence", label: `${structured.length - withReviewEvidence} 件展品复核依据不足`, severity: "medium" });
  if (withGuideEvidence < structured.length) gaps.push({ id: "guide-evidence", label: `${structured.length - withGuideEvidence} 件展品导览证据不足`, severity: "low" });
  if (!gaps.length) gaps.push({ id: "stable", label: "当前样本已具备轻量编排基础", severity: "low" });
  return gaps.slice(0, 5);
}

function buildPhase11NextActions(gaps = []) {
  const actions = [];
  const ids = new Set(gaps.map((gap) => gap.id));
  if (ids.has("no-memories")) actions.push("先保存 3 到 5 件带时间、人物和标签的展品");
  if (ids.has("missing-date")) actions.push("补齐关键展品时间，提升时间线和报告稳定性");
  if (ids.has("agent-run-coverage")) actions.push("优先使用 Agent 整理新展品，增加可回放运行历史");
  if (ids.has("review-evidence")) actions.push("补齐人物、地点、标签和展品说明，减少人工复核空洞");
  if (ids.has("guide-evidence")) actions.push("补充多模态线索或引用字段，提高讲解检索可信度");
  if (!actions.length) actions.push("进入可保存专题展和报告草稿的设计准备");
  return actions.slice(0, 4);
}

function buildPhase11WorkflowBlueprint(memories = []) {
  const handoff = buildPhase11Handoff(memories);
  const phase12Readiness = buildPhase12Readiness(memories, handoff);
  return {
    schemaVersion: SCHEMA_VERSION,
    phase: PHASE,
    phaseName: PHASE_NAME,
    generatedAt: new Date().toISOString(),
    engine: {
      id: "memory-museum-light-orchestrator",
      name: "轻量工作流编排层",
      dependency: "none",
      strategy: "在现有 Node HTTP、SQLite、Agent 运行历史和前端复核状态上声明工作流模板。",
      upgradePath: "当专题资产、批量任务和异步队列稳定后，再迁移到正式图编排引擎。"
    },
    capabilities: {
      templates: true,
      humanReview: true,
      retryAndReject: true,
      persistedRuns: true,
      replay: true,
      citations: true,
      scopedInsights: true
    },
    qualityGates: [
      { id: "review-gate", label: "人工复核闸门", status: handoff.reviewCoverage >= 60 ? "ready" : "needs-data" },
      { id: "run-history-gate", label: "运行历史回放", status: handoff.runCoverage > 0 ? "ready" : "needs-run" },
      { id: "citation-gate", label: "引用依据闸门", status: handoff.guideCoverage >= 60 ? "ready" : "needs-evidence" },
      { id: "asset-gate", label: "专题资产沉淀", status: "planned" }
    ],
    dataSources: [
      { id: "memories", label: "展品表", count: handoff.total },
      { id: "agent-runs", label: "整理历史", count: handoff.withAgentRun },
      { id: "review-evidence", label: "复核依据", count: handoff.withReviewEvidence },
      { id: "guide-evidence", label: "导览证据", count: handoff.withGuideEvidence }
    ],
    phase12Readiness,
    handoff,
    templates: workflowTemplates
  };
}

function buildPhase12Readiness(memories = [], handoff = buildPhase11Handoff(memories)) {
  const checks = [
    { id: "local-first-storage", label: "本地优先存储", status: "ready", detail: "SQLite 主存储，浏览器本地备份作为回退。" },
    { id: "portable-export", label: "可迁移导出包", status: "ready", detail: "导出包含展品、多模态摘要、阶段十洞察和阶段十一蓝图。" },
    { id: "import-restore", label: "导入恢复", status: "ready", detail: "JSON 备份可以导入数据库并处理 ID 冲突。" },
    { id: "delete-control", label: "删除控制", status: "ready", detail: "展品支持按 ID 删除，后续可扩展为彻底清理策略。" },
    { id: "workflow-audit", label: "工作流审计", status: handoff.withAgentRun > 0 ? "ready" : "needs-sample", detail: "Agent run/step/event 已持久化并可关联展品。" },
    { id: "privacy-boundary", label: "隐私边界说明", status: "planned", detail: "第十二阶段需要补账号、加密、AI 调用范围确认和彻底删除说明。" }
  ];
  const readyCount = checks.filter((item) => item.status === "ready").length;
  return {
    targetPhase: 12,
    targetName: "账号、多端同步、隐私和数据主权",
    planningReady: readyCount >= 4,
    score: Math.round((readyCount / checks.length) * 100),
    checks,
    blockers: checks.filter((item) => item.status !== "ready").map((item) => item.label),
    recommendation: readyCount >= 4
      ? "可以进入第十二阶段规划与第一版实现，优先处理数据主权、导出删除边界和隐私说明。"
      : "继续补齐导入导出、删除控制和审计记录后再进入第十二阶段。"
  };
}

function buildPhase12Sovereignty(memories = []) {
  const structured = memories.map(buildStructuredMemory);
  const withAgentRun = structured.filter((memory) => memory.agentRunId).length;
  const withAttachments = structured.filter((memory) => memory.attachments.length > 0).length;
  const withMultimodal = structured.filter((memory) => hasMultimodalStructured(memory)).length;
  const sensitivity = buildSensitivitySummary(structured);
  return {
    phase: PHASE,
    phaseName: PHASE_NAME,
    localUserMode: "single-user-local-profile",
    databasePath: store.dbPath,
    memoryCount: structured.length,
    agentRunLinkedCount: withAgentRun,
    attachmentMetadataCount: withAttachments,
    multimodalCount: withMultimodal,
    sensitivity,
    exportPackage: {
      format: "json",
      modes: ["full", "redacted"],
      includes: ["memories", "halls", "mediaSummary", "phase10Insights", "phase11WorkflowBlueprint", "phase12Sovereignty", "privacyPolicy"],
      excludes: ["originalAttachmentFiles", "remoteAccountCredentials"],
      portable: true,
      riskLevel: sensitivity.riskLevel,
      suggestedHandling: sensitivity.riskLevel === "high" ? "导出后请保存在受信任位置，后续建议使用加密导出包。" : "导出后仍建议保存在个人设备或可信备份位置。"
    },
    deletion: {
      singleMemory: "DELETE /api/memories/:id",
      fullPurge: "DELETE /api/memories/purge with confirm=DELETE",
      keeps: ["hall definitions", "application source files", "environment configuration"]
    },
    sync: {
      mode: "manual-json-package",
      status: "available",
      next: "第十二阶段后续可增加加密同步包和多端冲突处理。"
    },
    phase13Readiness: buildPhase13Readiness()
  };
}

function buildPrivacyPolicy(memories = []) {
  const sovereignty = buildPhase12Sovereignty(memories);
  const aiConfigured = Boolean(process.env.AI_API_KEY);
  return {
    schemaVersion: SCHEMA_VERSION,
    phase: PHASE,
    phaseName: PHASE_NAME,
    generatedAt: new Date().toISOString(),
    summary: {
      storageMode: "local-first",
      accountMode: "local-single-user",
      syncMode: sovereignty.sync.mode,
      aiMode: aiConfigured ? "configured" : "mock",
      databasePath: store.dbPath,
      memoryCount: sovereignty.memoryCount
    },
    dataLocations: [
      { id: "sqlite", label: "SQLite 数据库", location: store.dbPath, contains: ["展品", "多模态元数据", "Agent run/step/event"] },
      { id: "browser-backup", label: "浏览器本地备份", location: "localStorage: memory-museum-items", contains: ["数据库不可用时的展品备份"] },
      { id: "export-package", label: "手动同步包", location: "用户下载的 JSON 文件", contains: sovereignty.exportPackage.includes }
    ],
    aiDataScope: {
      configured: aiConfigured,
      baseUrl: process.env.AI_BASE_URL || "not-configured",
      model: process.env.AI_MODEL || "not-configured",
      sentFields: ["rawContent", "existing structured draft fields when applicable"],
      notSentByCurrentApp: ["originalAttachmentFiles", "browserLocalStorageBackup", "fullDatabaseFile"],
      requiresUserConfirmation: true,
      note: aiConfigured
        ? "配置 AI_API_KEY 后，/api/analyze 会把原始记忆文本发送到配置的 OpenAI-compatible 接口。"
        : "未配置 AI_API_KEY 时，后端使用本地 Mock 分析，不会发起外部 AI 调用。"
    },
    sensitiveData: sovereignty.sensitivity,
    userControls: [
      { id: "export", label: "完整导出 JSON 备份", status: "available" },
      { id: "redacted-export", label: "导出脱敏 JSON 包", status: "available" },
      { id: "import", label: "从 JSON 备份恢复", status: "available" },
      { id: "delete-one", label: "删除单件展品", status: "available" },
      { id: "purge-all", label: "清空本地数据库展品和整理历史", status: "available" },
      { id: "local-profile", label: "本地用户配置", status: "browser-local" },
      { id: "encryption", label: "导出包加密", status: "planned" }
    ],
    productizationReadiness: sovereignty.phase13Readiness,
    sovereignty
  };
}

function buildPhase13Readiness() {
  const checks = [
    { id: "stable-api", label: "主要 API 有 smoke test", status: "ready" },
    { id: "start-docs", label: "启动和配置文档", status: "ready" },
    { id: "data-boundary", label: "数据位置和 AI 调用边界", status: "ready" },
    { id: "backup-restore", label: "导出导入和删除控制", status: "ready" },
    { id: "redacted-demo", label: "脱敏演示/排查包", status: "ready" },
    { id: "module-boundary", label: "工程模块拆分", status: "planned" }
  ];
  const readyCount = checks.filter((item) => item.status === "ready").length;
  return {
    targetPhase: 13,
    targetName: "产品化、部署和运维",
    ready: readyCount >= 5,
    score: Math.round((readyCount / checks.length) * 100),
    checks,
    recommendation: readyCount >= 5
      ? "可以进入第十三阶段，优先处理工程拆分、运行日志、部署文档和发布流程。"
      : "继续补齐 API 检查、数据边界和导出删除控制后再进入第十三阶段。"
  };
}

function buildVersionInfo(memories = []) {
  return {
    app: "AI 记忆博物馆",
    packageName: "ai-memory-museum",
    version: APP_VERSION,
    schemaVersion: SCHEMA_VERSION,
    phase: PHASE,
    phaseName: PHASE_NAME,
    releaseChannel: RELEASE_CHANNEL,
    buildLabel: BUILD_LABEL,
    generatedAt: new Date().toISOString(),
    runtime: buildRuntimeInfo(),
    deployment: buildDeploymentProfile(),
    operations: buildOperationsSummary(memories),
    operationsConsole: buildOperationsConsole(memories),
    releaseChecklist: buildReleaseChecklist(memories),
    runbook: buildOperationsRunbook(),
    deploymentModes: buildDeploymentModes(),
    backupPolicy: buildBackupPolicy(),
    riskRegister: buildRiskRegister(memories),
    logArchive: buildLogArchiveInfo(),
    demoKit: buildDemoKit(memories),
    phase14Readiness: buildPhase14Readiness(memories),
    moduleBoundaryPlan: buildModuleBoundaryPlan(),
    releaseHistory: buildReleaseHistory(),
    apiSurface: [
      "GET /api/health",
      "GET /api/version",
      "GET /api/operations",
      "GET /api/operations/export",
      "GET /api/options",
      "GET /api/privacy",
      "GET /api/workflows",
      "GET /api/insights",
      "GET /api/assets",
      "GET /api/exhibitions",
      "GET /api/report-drafts",
      "GET /api/memories/export?mode=full|redacted",
      "POST /api/imports/preview",
      "POST /api/analyze",
      "POST /api/guide",
      "POST /api/exhibitions/from-theme",
      "POST /api/report-drafts/from-insights",
      "DELETE /api/memories/purge"
    ],
    checks: {
      full: "npm.cmd run check",
      smoke: "npm.cmd run smoke",
      syntax: "node --check app.js && node --check server.js && node --check database.js"
    },
    nextEngineeringSteps: [
      "先拆后端 routes/services/operations/privacy 边界",
      "再拆 Agent/RAG/workflow 领域模块并保持 API 契约不变",
      "随后拆前端 api/state/renderers/panels 边界",
      "阶段 14 完成后再评估是否迁移到 Vite/React 或 Express/Fastify"
    ]
  };
}

function buildRuntimeInfo() {
  return {
    node: process.version,
    platform: process.platform,
    pid: process.pid,
    uptimeSeconds: Math.round(process.uptime()),
    port: PORT,
    databasePath: store.dbPath,
    aiConfigured: Boolean(process.env.AI_API_KEY),
    aiModel: process.env.AI_MODEL || "not-configured"
  };
}

function buildDeploymentProfile() {
  const mode = process.env.NODE_ENV === "production" ? "production" : "local";
  return {
    mode,
    releaseChannel: RELEASE_CHANNEL,
    staticHosting: "node-http",
    database: "node:sqlite",
    assetMode: "same-origin-static",
    configFiles: [".env", "package.json"],
    startCommand: "npm.cmd start",
    healthCheck: "/api/health",
    versionCheck: "/api/version",
    notes: mode === "production"
      ? "当前以 Node HTTP 直接托管静态资源和 API，生产部署前建议补充反向代理、日志和备份策略。"
      : "当前适合本地体验、演示和课程项目。"
  };
}

function buildReleaseChecklist(memories = []) {
  const stats = store.getStats();
  return [
    { id: "syntax", label: "语法检查", status: "ready", command: "node --check app.js && node --check server.js && node --check database.js" },
    { id: "readiness", label: "第十五阶段资产检查", status: "ready", command: "node scripts/phase15-readiness.js" },
    { id: "phase16-readiness", label: "第十六阶段同步检查", status: "ready", command: "node scripts/phase16-readiness.js" },
    { id: "phase17-readiness", label: "第十七阶段适配层检查", status: "ready", command: "node scripts/phase17-readiness.js" },
    { id: "phase18-readiness", label: "第十八阶段长期助理检查", status: "ready", command: "node scripts/phase18-readiness.js" },
    { id: "phase19-readiness", label: "第十九阶段外部导入检查", status: "ready", command: "node scripts/phase19-readiness.js" },
    { id: "api-smoke", label: "核心 API smoke test", status: "ready", command: "npm.cmd run smoke" },
    { id: "operations-trace", label: "请求追踪与运行事件", status: "ready", detail: "API 响应带 X-Request-Id，/api/operations 可查看最近运行事件。" },
    { id: "persistent-ops-log", label: "持久化运行日志", status: "ready", detail: "最近 API 请求会追加到 JSONL 运维日志，可随 /api/operations/export 导出。" },
    { id: "data-export", label: "完整与脱敏备份", status: "ready", detail: "发布前可以导出完整包，演示或排查时优先使用脱敏包。" },
    { id: "demo-kit", label: "演示包摘要", status: (stats.total || memories.length) > 0 ? "ready" : "needs-sample", detail: "演示包会汇总样本数量、推荐路线和隐私提示。" },
    { id: "phase14-readiness", label: "第十四阶段进入准备", status: "ready", detail: "模块边界、迁移顺序、风险闸门和检查保护网已经声明。" },
    { id: "production-logs", label: "持久化日志与反向代理", status: "planned", detail: "生产部署前仍需补充文件日志、HTTPS 和反向代理说明。" }
  ];
}

function buildOperationsRunbook() {
  return [
    { id: "start", label: "本地启动", command: "npm.cmd start", detail: "启动后打开 http://127.0.0.1:3000，并先查看 /api/health。" },
    { id: "check", label: "发布前检查", command: "npm.cmd run check", detail: "包含语法检查、Phase 15-19 readiness 和 API smoke test。" },
    { id: "backup", label: "备份", command: "GET /api/memories/export", detail: "长期保存前导出完整 JSON；对外演示或排查使用 redacted 模式。" },
    { id: "privacy", label: "隐私复核", command: "GET /api/privacy", detail: "确认 AI 调用范围、敏感线索和删除控制符合当前使用场景。" },
    { id: "recover", label: "恢复", command: "POST /api/memories/import", detail: "从 JSON 备份恢复展品，导入时会处理 ID 冲突。" }
  ];
}

function buildDeploymentModes() {
  return [
    { id: "local", label: "本地个人使用", status: "ready", database: "SQLite", note: "适合单机长期整理私人记忆。" },
    { id: "demo", label: "课堂/演示模式", status: "ready", database: "临时或演示 SQLite", note: "建议使用脱敏数据和明确的 AI 调用说明。" },
    { id: "lan", label: "局域网共享", status: "planned", database: "SQLite + 访问控制", note: "进入前需要账号、权限和备份策略。" },
    { id: "cloud", label: "云端部署", status: "planned", database: "托管数据库或卷挂载 SQLite", note: "进入前需要 HTTPS、日志、备份、反向代理和密钥管理。" }
  ];
}

function buildBackupPolicy() {
  return {
    full: "/api/memories/export",
    redacted: "/api/memories/export?mode=redacted",
    restore: "POST /api/memories/import",
    purge: "DELETE /api/memories/purge with confirm=DELETE",
    recommendedCadence: "每次集中整理后导出一次完整包；对外演示只使用脱敏包。",
    storageAdvice: "完整包建议保存到个人可信设备或加密盘，脱敏包可用于演示、排查和跨设备预览。"
  };
}

function buildRiskRegister(memories = []) {
  const stats = store.getStats();
  const memoryCount = stats.total || memories.length;
  return [
    {
      id: "privacy",
      label: "隐私与敏感线索",
      level: memoryCount > 0 ? "medium" : "low",
      mitigation: "导出、演示和 AI 调用前先查看 /api/privacy 与脱敏包。"
    },
    {
      id: "backup",
      label: "备份恢复",
      level: "medium",
      mitigation: "本阶段已有 JSON 导出/导入，后续需要加密包和自动备份。"
    },
    {
      id: "observability",
      label: "运行观测",
      level: "medium",
      mitigation: "当前有 health/version；生产部署前补请求日志、错误日志和 request id。"
    },
    {
      id: "module-size",
      label: "工程模块边界",
      level: "medium",
      mitigation: "后续拆分 server、agent、rag、workflow、privacy、operations 模块。"
    }
  ];
}

function buildReleaseHistory() {
  return [
    {
      version: APP_VERSION,
      label: BUILD_LABEL,
      phase: PHASE,
      date: "2026-06-24",
      summary: "阶段 19 第九版补充复核状态流转、字段别名规则、导入报告视图和批次审计检索。"
    },
    {
      version: "0.9.7",
      label: "phase19-import-review-eighth-edition",
      phase: 19,
      date: "2026-06-24",
      summary: "阶段 19 第八版补充模板规则默认值、导入后整理队列、冲突复核台和批次审计导出。"
    },
    {
      version: "0.9.6",
      label: "phase19-import-conflict-seventh-edition",
      phase: 19,
      date: "2026-06-24",
      summary: "阶段 19 第七版补充自定义映射模板、重复项导入决策、导入前冲突预览和批次筛选对比。"
    },
    {
      version: "0.9.5",
      label: "phase19-import-template-sixth-edition",
      phase: 19,
      date: "2026-06-24",
      summary: "阶段 19 第六版补充字段映射模板、批次命名、重复项预判和跨批次对比。"
    },
    {
      version: "0.9.4",
      label: "phase19-import-recovery-fifth-edition",
      phase: 19,
      date: "2026-06-24",
      summary: "阶段 19 第五版补充失败项保留、批次内单项撤销、补全任务状态回看和质量趋势。"
    },
    {
      version: "0.9.3",
      label: "phase19-import-quality-fourth-edition",
      phase: 19,
      date: "2026-06-24",
      summary: "阶段 19 第四版补充导入完整度评分、批次详情和第十八阶段补全任务。"
    },
    {
      version: "0.9.2",
      label: "phase19-import-batch-third-edition",
      phase: 19,
      date: "2026-06-24",
      summary: "阶段 19 第三版补充草稿字段编辑、导入批次记录和批次撤销。"
    },
    {
      version: "0.9.1",
      label: "phase19-import-cleanup-second-edition",
      phase: 19,
      date: "2026-06-24",
      summary: "阶段 19 第二版补充导入清洗策略、CSV 分隔符容错、聊天聚合、草稿选择和来源追踪。"
    },
    {
      version: "0.9.0",
      label: "phase19-external-import-first-edition",
      phase: 19,
      date: "2026-06-24",
      summary: "阶段 19 第一版启动外部资料导入预览，支持文本、Markdown、CSV、JSON 和聊天片段生成展品草稿。"
    },
    {
      version: "0.8.12",
      label: "phase18-agent-digest-thirteenth-edition",
      phase: 18,
      date: "2026-06-24",
      summary: "阶段 18 第十三版补充长期助理摘要、今日/本周焦点和摘要任务入口。"
    },
    {
      version: "0.8.11",
      label: "phase18-graph-asset-navigation-twelfth-edition",
      phase: 18,
      date: "2026-06-24",
      summary: "阶段 18 第十二版补充关系图谱与专题展/报告的双向跳转。"
    },
    {
      version: "0.8.10",
      label: "phase18-sync-asset-link-eleventh-edition",
      phase: 18,
      date: "2026-06-24",
      summary: "阶段 18 第十一版补充资产同步状态、第十七阶段同步提示联动和导出结构。"
    },
    {
      version: "0.8.9",
      label: "phase18-batch-task-tenth-edition",
      phase: 18,
      date: "2026-06-24",
      summary: "阶段 18 第十版补充复盘任务批量选择、批量状态流转和批量生成修复草案。"
    },
    {
      version: "0.8.8",
      label: "phase18-noise-rule-ninth-edition",
      phase: 18,
      date: "2026-06-24",
      summary: "阶段 18 第九版补充可配置降噪规则、规则预览和被收起建议恢复提示。"
    },
    {
      version: "0.8.7",
      label: "phase18-sync-bridge-eighth-edition",
      phase: 18,
      date: "2026-06-24",
      summary: "阶段 18 第八版补充第十七阶段同步维护桥接、复盘任务生成和图谱节点打开展品。"
    },
    {
      version: "0.8.6",
      label: "phase18-review-dashboard-seventh-edition",
      phase: 18,
      date: "2026-06-24",
      summary: "阶段 18 第七版补充长期助理复盘面板、建议自动降噪、关系图筛选和资产/报告回看入口。"
    },
    {
      version: "0.8.5",
      label: "phase18-review-report-sixth-edition",
      phase: 18,
      date: "2026-06-24",
      summary: "阶段 18 第六版补充周期回顾报告草稿、建议质量分层和关系图谱。"
    },
    {
      version: "0.8.4",
      label: "phase18-review-assets-fifth-edition",
      phase: 18,
      date: "2026-06-24",
      summary: "阶段 18 第五版补充周期回顾生成专题资产、Agent 质量统计和跨展品关系证据增强。"
    },
    {
      version: "0.8.3",
      label: "phase18-audit-batch-fourth-edition",
      phase: 18,
      date: "2026-06-24",
      summary: "阶段 18 第四版补充长期任务审计、批量应用前复核和修复草案批量处理。"
    },
    {
      version: "0.8.2",
      label: "phase18-task-queue-third-edition",
      phase: 18,
      date: "2026-06-24",
      summary: "阶段 18 第三版补充长期任务队列持久化、筛选、状态流转和清理能力。"
    },
    {
      version: "0.8.1",
      label: "phase18-repair-draft-second-edition",
      phase: 18,
      date: "2026-06-24",
      summary: "阶段 18 第二版补充建议采纳后的半自动修复草案、预览和逐条应用。"
    },
    {
      version: "0.8.0",
      label: "phase18-long-term-agent-first-edition",
      phase: 18,
      date: "2026-06-24",
      summary: "阶段 18 第一版启动长期记忆助理、主动整理建议、跨展品关系、周期回顾和反馈闭环。"
    },
    {
      version: "0.3.3",
      label: "phase13-operations-fourth-edition",
      phase: 13,
      date: "2026-06-23",
      summary: "第四版补充持久化 JSONL 运维日志、/api/operations/export、演示包摘要和页面日志/演示面板。"
    },
    {
      version: "0.3.2",
      label: "phase13-operations-third-edition",
      phase: 13,
      date: "2026-06-22",
      summary: "第三版补充 X-Request-Id、/api/operations、最近运行事件、发布记录和页面运行事件面板。"
    },
    {
      version: "0.3.1",
      label: "phase13-operations-second-edition",
      phase: 13,
      date: "2026-06-22",
      summary: "第二版补充发布清单、运行手册、部署模式、备份策略和风险登记。"
    },
    {
      version: "0.3.0",
      label: "phase13-operations-first-edition",
      phase: 13,
      date: "2026-06-22",
      summary: "第一版补充 /api/version、operations 健康摘要和部署与运维面板。"
    }
  ];
}

function buildLogArchiveInfo() {
  const exists = fs.existsSync(OPERATION_LOG_PATH);
  const sizeBytes = exists ? fs.statSync(OPERATION_LOG_PATH).size : 0;
  return {
    format: "jsonl",
    path: OPERATION_LOG_PATH,
    exists,
    sizeBytes,
    inMemoryEvents: operationEvents.length,
    exportEndpoint: "/api/operations/export",
    retention: `last ${OPERATION_EVENT_LIMIT} events in memory; file keeps append-only local history`
  };
}

function buildDemoKit(memories = []) {
  const structured = memories.map(buildStructuredMemory);
  const withDate = structured.filter((memory) => memory.date).length;
  const withPeople = structured.filter((memory) => memory.people.length).length;
  const withMedia = structured.filter(hasMultimodalStructured).length;
  const withGuideText = structured.filter((memory) => memory.exhibitText && (memory.tags.length || memory.emotions.length)).length;
  const readyScore = Math.round(([
    structured.length >= 3,
    withDate >= 2,
    withPeople >= 1,
    withMedia >= 1,
    withGuideText >= 2
  ].filter(Boolean).length / 5) * 100);
  return {
    ready: readyScore >= 60,
    score: readyScore,
    sampleCount: structured.length,
    checks: [
      { id: "sample-count", label: "至少 3 件展品", status: structured.length >= 3 ? "ready" : "needs-sample", count: structured.length },
      { id: "timeline", label: "时间线样本", status: withDate >= 2 ? "ready" : "needs-date", count: withDate },
      { id: "people", label: "人物关系线索", status: withPeople >= 1 ? "ready" : "needs-people", count: withPeople },
      { id: "media", label: "多模态线索", status: withMedia >= 1 ? "ready" : "needs-media", count: withMedia },
      { id: "guide", label: "讲解检索样本", status: withGuideText >= 2 ? "ready" : "needs-guide", count: withGuideText }
    ],
    storyline: [
      "从首页录入或导入 3 到 5 件温馨记忆展品",
      "运行 Agent 整理并保留人工复核状态",
      "打开讲解员提问，展示引用证据和可信度",
      "查看时间线、主题展、隐私策略和部署与运维面板",
      "导出脱敏包用于演示或排查"
    ],
    privacyNote: "演示前优先使用脱敏导出包，避免展示真实人物、地点、联系方式和原始附件线索。"
  };
}

function buildModuleBoundaryPlan() {
  return [
    {
      id: "routes",
      label: "HTTP routes",
      status: "ready-to-split",
      firstFiles: ["server.js"],
      targetFiles: ["src/routes/health.js", "src/routes/memories.js", "src/routes/operations.js"],
      rule: "先迁移纯路由分发，保持 URL、状态码和响应结构不变。"
    },
    {
      id: "operations",
      label: "Operations",
      status: "ready-to-split",
      firstFiles: ["server.js", "scripts/phase13-readiness.js", "scripts/api-smoke.js"],
      targetFiles: ["src/services/operations.js"],
      rule: "先抽离 version、operations、runbook、releaseHistory、logArchive、demoKit。"
    },
    {
      id: "privacy",
      label: "Privacy",
      status: "ready-to-split",
      firstFiles: ["server.js", "app.js"],
      targetFiles: ["src/services/privacy.js", "src/ui/privacy-panel.js"],
      rule: "保持 /api/privacy 和数据主权导出字段兼容。"
    },
    {
      id: "agents",
      label: "Agent workflow",
      status: "split-after-routes",
      firstFiles: ["server.js", "database.js", "app.js"],
      targetFiles: ["src/services/agents.js", "src/services/workflows.js"],
      rule: "先用 smoke test 固定 workflow.run、steps、events 契约，再拆实现。"
    },
    {
      id: "frontend",
      label: "Frontend panels",
      status: "split-after-api",
      firstFiles: ["app.js"],
      targetFiles: ["src/ui/renderers.js", "src/ui/operations-panel.js", "src/ui/workflow-panel.js"],
      rule: "先按面板拆渲染函数，暂不引入构建工具。"
    }
  ];
}

function buildPhase14Readiness(memories = []) {
  const checks = [
    { id: "api-contract", label: "API 契约保护", status: "ready", detail: "api-smoke 已覆盖 health/version/operations/privacy/workflows/analyze/search/guide/insights。" },
    { id: "operations-guard", label: "运维保护网", status: "ready", detail: "已有 X-Request-Id、运行事件、JSONL 日志和运维导出包。" },
    { id: "docs-route", label: "重构路线文档", status: "ready", detail: "项目规划和白皮书已声明阶段 14 模块化目标。" },
    { id: "module-plan", label: "模块边界清单", status: "ready", detail: "routes、operations、privacy、agents、frontend 边界已列出。" },
    { id: "data-safety", label: "数据安全回归", status: "ready", detail: "导入、导出、脱敏、清空、隐私策略均有 smoke 回归。" },
    { id: "sample-signal", label: "演示样本信号", status: memories.length > 0 ? "ready" : "optional", detail: "无样本也可进入重构；有样本时更利于视觉回归。" }
  ];
  const readyCount = checks.filter((item) => item.status === "ready").length;
  return {
    targetPhase: 14,
    targetName: "工程模块化和服务边界重构",
    ready: readyCount >= 5,
    score: Math.round((readyCount / checks.length) * 100),
    checks,
    recommendedOrder: ["routes", "operations", "privacy", "agents", "rag", "workflow", "frontend-panels"],
    stopConditions: [
      "任一现有 API smoke 失败时暂停拆分",
      "导入导出结构变化时先补迁移说明",
      "前端面板拆分后必须保持无后端回退能力"
    ],
    recommendation: readyCount >= 5
      ? "可以进入阶段 14。建议先拆后端 routes 与 operations，再拆 privacy、Agent/RAG/workflow，最后拆前端面板。"
      : "继续补齐 API 契约、运维导出和模块边界后再进入阶段 14。"
  };
}

function buildOperationsExport(memories = []) {
  return {
    app: "AI 记忆博物馆",
    exportedAt: new Date().toISOString(),
    schemaVersion: SCHEMA_VERSION,
    phase: PHASE,
    version: APP_VERSION,
    buildLabel: BUILD_LABEL,
    operations: buildOperationsConsole(memories),
    logArchive: buildLogArchiveInfo(),
    demoKit: buildDemoKit(memories),
    phase14Readiness: buildPhase14Readiness(memories),
    moduleBoundaryPlan: buildModuleBoundaryPlan(),
    recentEvents: operationEvents.slice(0, OPERATION_EVENT_LIMIT)
  };
}

function buildOperationsConsole(memories = []) {
  return {
    schemaVersion: SCHEMA_VERSION,
    phase: PHASE,
    phaseName: PHASE_NAME,
    version: APP_VERSION,
    buildLabel: BUILD_LABEL,
    generatedAt: new Date().toISOString(),
    summary: buildOperationsSummary(memories),
    recentEvents: operationEvents.slice(0, 20),
    releaseHistory: buildReleaseHistory(),
    releaseChecklist: buildReleaseChecklist(memories),
    runbook: buildOperationsRunbook(),
    backupPolicy: buildBackupPolicy(),
    riskRegister: buildRiskRegister(memories),
    logArchive: buildLogArchiveInfo(),
    demoKit: buildDemoKit(memories),
    phase14Readiness: buildPhase14Readiness(memories),
    moduleBoundaryPlan: buildModuleBoundaryPlan()
  };
}

function buildOperationsSummary(memories = []) {
  const stats = store.getStats();
  const checklist = buildReleaseChecklist(memories);
  const readyCount = checklist.filter((item) => item.status === "ready").length;
  return {
    status: "operational",
    mode: process.env.NODE_ENV === "production" ? "production" : "local",
    checks: ["syntax", "phase13-readiness", "api-smoke"],
    release: {
      channel: RELEASE_CHANNEL,
      label: BUILD_LABEL,
      checklistReady: readyCount,
      checklistTotal: checklist.length
    },
    data: {
      memories: stats.total || memories.length,
      multimodal: stats.multimodal || 0,
      agentRuns: stats.agentRuns || 0,
      databasePath: store.dbPath
    },
    backup: {
      fullExport: "/api/memories/export",
      redactedExport: "/api/memories/export?mode=redacted",
      purge: "/api/memories/purge"
    },
    observability: {
      health: "/api/health",
      version: "/api/version",
      operations: "/api/operations",
      logs: "in-memory-recent-events",
      requestId: "X-Request-Id",
      recentEvents: operationEvents.length
    },
    backupPolicy: buildBackupPolicy(),
    readiness: {
      phase13: true,
      deployableLocal: true,
      productionReady: false,
      reason: "本地可交付能力已具备；生产部署还需要日志、备份、反向代理和模块拆分。"
    }
  };
}

function buildSensitivitySummary(memories = []) {
  const categories = [
    {
      id: "people",
      label: "人物关系",
      count: memories.filter((memory) => memory.people?.length).length
    },
    {
      id: "location",
      label: "地点线索",
      count: memories.filter((memory) => memory.location || String(memory.rawContent || "").match(/家|学校|公司|医院|车站|地址|上海|北京|广州|深圳/)).length
    },
    {
      id: "contact",
      label: "联系方式",
      count: memories.filter((memory) => String(memory.rawContent || "").match(/1[3-9]\d{9}|微信|电话|邮箱|@/)).length
    },
    {
      id: "low-mood",
      label: "低谷情绪",
      count: memories.filter((memory) => (memory.emotions || []).some((emotion) => ["低谷", "孤独", "委屈", "愤怒", "害怕", "迷茫"].includes(emotion)) || memory.hall?.id === "low").length
    },
    {
      id: "attachments",
      label: "附件元数据",
      count: memories.filter((memory) => memory.attachments?.length || memory.coverImage || memory.mediaNote).length
    }
  ];
  const matched = categories.filter((category) => category.count > 0);
  const totalSignals = matched.reduce((sum, category) => sum + category.count, 0);
  const riskLevel = matched.some((item) => item.id === "contact" && item.count > 0) || matched.length >= 4
    ? "high"
    : matched.length >= 2 ? "medium" : matched.length === 1 ? "low" : "none";
  return {
    riskLevel,
    totalSignals,
    categories,
    matchedCategories: matched.map((item) => item.label),
    recommendation: riskLevel === "high"
      ? "导出或调用 AI 前建议再次检查原文、人物、地点和联系方式。"
      : riskLevel === "medium"
        ? "建议导出前确认人物、地点和附件线索是否适合随包保存。"
        : "当前敏感线索较少，仍建议只在可信设备保存备份。"
  };
}

function buildPhase10Insights(memories = [], filters = {}) {
  const structuredAll = memories.map(buildStructuredMemory);
  const structured = filterInsightMemories(structuredAll, filters);
  const normalizedFilters = normalizeInsightFilters(filters);
  return {
    schemaVersion: SCHEMA_VERSION,
    phase: PHASE,
    phaseName: PHASE_NAME,
    generatedAt: new Date().toISOString(),
    filters: normalizedFilters,
    sourceTotal: structuredAll.length,
    filteredTotal: structured.length,
    handoff: buildPhase10Handoff(structured),
    timeline: buildTimelineInsights(structured),
    themes: buildThemeInsights(structured),
    report: buildMemoryReport(structured)
  };
}

function normalizeInsightFilters(filters = {}) {
  return {
    hall: limitText(filters.hall, 40),
    year: /^\d{4}$/.test(String(filters.year || "")) ? String(filters.year) : "",
    theme: limitText(filters.theme, 80)
  };
}

function filterInsightMemories(memories = [], filters = {}) {
  const normalized = normalizeInsightFilters(filters);
  const theme = normalized.theme.toLowerCase();
  return memories.filter((memory) => {
    const hallId = memory.hall?.id || memory.hall;
    if (normalized.hall && normalized.hall !== "all" && hallId !== normalized.hall) return false;
    if (normalized.year) {
      const date = memory.date || memory.createdAt || "";
      if (!String(date).startsWith(normalized.year)) return false;
    }
    if (theme) {
      const haystack = [
        memory.title,
        memory.exhibitText,
        memory.rawContent,
        memory.location,
        memory.sourceType,
        memory.coverImage,
        memory.mediaNote,
        memory.hall?.name,
        ...(memory.people || []),
        ...(memory.tags || []),
        ...(memory.emotions || []),
        ...(memory.attachments || []).flatMap((item) => [item.name, item.type, item.note])
      ].join(" ").toLowerCase();
      if (!haystack.includes(theme)) return false;
    }
    return true;
  });
}

function buildTimelineInsights(memories = []) {
  const groups = memories.reduce((map, memory) => {
    const period = getMemoryPeriod(memory);
    if (!map.has(period.key)) {
      map.set(period.key, {
        key: period.key,
        label: period.label,
        sortValue: period.sortValue,
        count: 0,
        mediaCount: 0,
        memories: [],
        emotions: {}
      });
    }
    const group = map.get(period.key);
    group.count += 1;
    if (hasMultimodalStructured(memory)) group.mediaCount += 1;
    group.memories.push(buildMemoryReference(memory));
    (memory.emotions || []).forEach((emotion) => {
      group.emotions[emotion] = (group.emotions[emotion] || 0) + 1;
    });
    return map;
  }, new Map());

  return [...groups.values()]
    .sort((a, b) => b.sortValue.localeCompare(a.sortValue))
    .map((group) => ({
      key: group.key,
      label: group.label,
      count: group.count,
      mediaCount: group.mediaCount,
      topEmotions: toTopEntries(group.emotions, 3),
      memories: group.memories.slice(0, 5)
    }));
}

function buildThemeInsights(memories = []) {
  const themeMap = new Map();
  memories.forEach((memory) => {
    addThemeValue(themeMap, "展厅", memory.hall?.name || getHallName(memory.hall?.id), memory);
    addThemeValue(themeMap, "来源", memory.sourceType, memory);
    (memory.people || []).forEach((value) => addThemeValue(themeMap, "人物", value, memory));
    (memory.tags || []).forEach((value) => addThemeValue(themeMap, "标签", value, memory));
    (memory.emotions || []).forEach((value) => addThemeValue(themeMap, "情绪", value, memory));
    if (memory.location) addThemeValue(themeMap, "地点", memory.location, memory);
  });

  return [...themeMap.values()]
    .sort((a, b) => b.count - a.count || b.mediaCount - a.mediaCount || a.title.localeCompare(b.title, "zh-CN"))
    .slice(0, 8)
    .map((theme) => ({
      type: theme.type,
      title: theme.title,
      count: theme.count,
      mediaCount: theme.mediaCount,
      description: buildThemeDescription(theme),
      coverMemory: theme.memories[0] || null,
      topEmotions: toTopEntries(theme.emotions, 3),
      memories: theme.memories.slice(0, 4)
    }));
}

function buildThemeDescription(theme) {
  const emotion = toTopEntries(theme.emotions, 1)[0]?.label || "平静";
  const mediaText = theme.mediaCount ? `其中 ${theme.mediaCount} 件带有多模态线索` : "目前主要由文字线索构成";
  return `${theme.type}“${theme.title}”串联了 ${theme.count} 件展品，主导情绪偏向“${emotion}”，${mediaText}。`;
}

function addThemeValue(themeMap, type, value, memory) {
  const title = limitText(value, 40);
  if (!title) return;
  const key = `${type}:${title}`;
  if (!themeMap.has(key)) {
    themeMap.set(key, { type, title, count: 0, mediaCount: 0, emotions: {}, memories: [] });
  }
  const theme = themeMap.get(key);
  theme.count += 1;
  if (hasMultimodalStructured(memory)) theme.mediaCount += 1;
  theme.memories.push(buildMemoryReference(memory));
  (memory.emotions || []).forEach((emotion) => {
    theme.emotions[emotion] = (theme.emotions[emotion] || 0) + 1;
  });
}

function buildMemoryReport(memories = []) {
  const total = memories.length;
  const favoriteCount = memories.filter((memory) => memory.favorite).length;
  const multimodalCount = memories.filter(hasMultimodalStructured).length;
  const topEmotions = toTopEntries(countValues(memories.flatMap((memory) => memory.emotions || [])), 5);
  const topTags = toTopEntries(countValues(memories.flatMap((memory) => memory.tags || [])), 5);
  const topPeople = toTopEntries(countValues(memories.flatMap((memory) => memory.people || [])), 5);
  const topLocations = toTopEntries(countValues(memories.map((memory) => memory.location).filter(Boolean)), 5);
  const halls = toTopEntries(countValues(memories.map((memory) => memory.hall?.name || getHallName(memory.hall?.id))), 6);
  const dateRange = buildDateRange(memories);
  const highlights = [...memories]
    .sort((a, b) => Number(b.favorite) - Number(a.favorite) || (b.importance || 1) - (a.importance || 1))
    .slice(0, 3)
    .map(buildMemoryReference);
  const references = highlights.map((memory, index) => ({
    ...memory,
    role: index === 0 ? "开篇展品" : "支撑展品"
  }));
  const dominantEmotion = topEmotions[0]?.label || "平静";
  const dominantTag = topTags[0]?.label || halls[0]?.label || "日常";
  const sections = buildReportSections({
    total,
    dominantTag,
    dominantEmotion,
    favoriteCount,
    multimodalCount,
    dateRange,
    topPeople,
    topLocations,
    highlights
  });

  return {
    total,
    favoriteCount,
    multimodalCount,
    dateRange,
    topEmotions,
    topTags,
    topPeople,
    topLocations,
    halls,
    highlights,
    references,
    sections,
    summary: total
      ? `这批记忆共 ${total} 件展品，主要围绕“${dominantTag}”展开，最明显的情绪是“${dominantEmotion}”。其中 ${favoriteCount} 件被标记为重点展品，${multimodalCount} 件带有照片、OCR、语音或附件线索。`
      : "当前还没有展品，保存几段记忆后可以生成时间线、主题展和回忆报告。",
    nextQuestions: [
      "按月份看，这些记忆在哪些阶段最密集？",
      "哪些人物、地点或标签适合组成主题展？",
      "哪些重点展品适合作为年度回忆报告开头？"
    ]
  };
}

function buildReportSections({ total, dominantTag, dominantEmotion, favoriteCount, multimodalCount, dateRange, topPeople, topLocations, highlights }) {
  if (!total) return [];
  const rangeText = dateRange.start
    ? dateRange.start === dateRange.end ? dateRange.start : `${dateRange.start} 至 ${dateRange.end}`
    : "尚未形成明确时间范围";
  const peopleText = topPeople.length ? topPeople.slice(0, 3).map((item) => item.label).join("、") : "暂未形成高频人物";
  const locationText = topLocations.length ? topLocations.slice(0, 3).map((item) => item.label).join("、") : "暂未形成高频地点";
  const highlightText = highlights.length ? highlights.map((memory) => `《${memory.title}》`).join("、") : "暂未选出重点展品";
  return [
    { title: "时间范围", text: `这批记忆覆盖 ${rangeText}，可以作为时间线回看的起点。` },
    { title: "主题主线", text: `当前最明显的主题是“${dominantTag}”，主导情绪是“${dominantEmotion}”。` },
    { title: "人物与地点", text: `人物线索集中在 ${peopleText}；地点线索集中在 ${locationText}。` },
    { title: "报告开头", text: `建议从 ${highlightText} 开始讲述，其中 ${favoriteCount} 件是重点展品，${multimodalCount} 件带多模态线索。` }
  ];
}

function getMemoryPeriod(memory) {
  const rawDate = memory.date || memory.createdAt || "";
  const match = String(rawDate).match(/^(\d{4})(?:-(\d{2}))?/);
  if (!match) return { key: "undated", label: "未标注时间", sortValue: "0000-00" };
  const year = match[1];
  const month = match[2] || "00";
  return {
    key: `${year}-${month}`,
    label: month === "00" ? `${year} 年` : `${year} 年 ${month} 月`,
    sortValue: `${year}-${month}`
  };
}

function buildMemoryReference(memory) {
  return {
    id: memory.id,
    title: memory.title,
    hall: memory.hall?.name || getHallName(memory.hall?.id),
    date: memory.date || "",
    importance: memory.importance,
    favorite: memory.favorite,
    media: hasMultimodalStructured(memory)
  };
}

function hasMultimodalStructured(memory = {}) {
  return Boolean(memory.coverImage || memory.mediaNote || (memory.attachments || []).length);
}

function countValues(values = []) {
  return values.filter(Boolean).reduce((counts, value) => {
    counts[value] = (counts[value] || 0) + 1;
    return counts;
  }, {});
}

function toTopEntries(counts = {}, limit = 5) {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN"))
    .slice(0, limit)
    .map(([label, count]) => ({ label, count }));
}

function buildDateRange(memories = []) {
  const dates = memories
    .map((memory) => memory.date)
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
    .sort();
  return dates.length ? { start: dates[0], end: dates[dates.length - 1] } : { start: "", end: "" };
}

function buildSearchQuery(question) {
  const text = String(question || "").trim();
  const normalized = text.replace(/[?？!！。，、；;：“”"']/g, " ");
  const tokens = normalized.split(/\s+/).map((item) => item.trim()).filter(Boolean);
  const keywordHits = guideSearchVocabulary.filter((word) => text.includes(word));
  const shortTokens = tokens.filter((token) => {
    const hasCjk = /[\u4e00-\u9fff]/.test(token);
    return (!hasCjk || token.length <= 8) && !guideSearchStopWords.has(token);
  });
  const terms = [...new Set([...keywordHits, ...shortTokens])].slice(0, 8);
  return terms.join(" ") || text;
}

function buildMockGuideAnswer(question, memories, retrievalMode = "keyword", citations = []) {
  const featured = memories[0];
  const titles = memories.slice(0, 3).map((memory) => `《${memory.title}》`).join("、");
  const citationText = citations.length
    ? `召回依据：${citations.slice(0, 2).map((citation) => {
      const title = citation.memory?.title || "未命名展品";
      const terms = (citation.matchedTerms || []).slice(0, 4).join("、") || "暂无直接命中词";
      const confidence = citation.confidence?.label ? `，可信度：${citation.confidence.label}` : "";
      return `《${title}》${citation.reason || "命中结构化字段"}，命中词：${terms}${confidence}`;
    }).join("；")}。`
    : "";
  const mediaCitations = citations.filter((citation) => (citation.matchedFields || []).some((field) => ["附件", "多模态线索", "封面线索"].includes(field)));
  const mediaText = mediaCitations.length
    ? `多模态线索：这次还参考了 ${mediaCitations.slice(0, 2).map((citation) => `《${citation.memory?.title || "未命名展品"}》`).join("、")} 的附件、封面或图片/OCR/语音说明。`
    : "";
  const boundaryText = retrievalMode === "recent-fallback"
    ? "证据边界：这次没有找到强匹配展品，只能基于最近保存的展品临时回答，建议继续补充更明确的记忆线索。"
    : "";
  const emotionCounts = memories.flatMap((memory) => memory.emotions || []).reduce((map, emotion) => {
    map[emotion] = (map[emotion] || 0) + 1;
    return map;
  }, {});
  const emotionSummary = Object.entries(emotionCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([emotion, count]) => `${emotion} ${count} 次`)
    .join("，") || "暂时没有明显情绪标签";
  const evidence = featured
    ? retrievalMode === "recent-fallback"
      ? `这次没有直接命中的关键词，我先回看最近的 ${titles} 作为临时依据。可以先从《${featured.title}》看起：${featured.exhibitText}\n${boundaryText}`
      : `我会先把 ${titles} 作为回答依据。最贴近这个问题的是《${featured.title}》：${featured.exhibitText}${citationText ? `\n${citationText}` : ""}${mediaText ? `\n${mediaText}` : ""}`
    : "目前还没有足够展品作为依据。";

  return [
    `你的问题是：“${question}”。`,
    evidence,
    `从这些候选展品看，当前反复出现的情绪是 ${emotionSummary}。`,
    retrievalMode === "hybrid"
      ? "这是基于 SQLite 中已保存展品的混合 RAG 回答：当前同时参考了关键词命中和本地语义线索。"
      : "这是基于 SQLite 中已保存展品的 RAG 回答；证据不足时我会说明召回边界。"
  ].join("\n\n");
}

function normalizeAnalysis(value, rawContent) {
  const hallId = typeof value.hall === "object" ? value.hall?.id : value.hall;
  const hall = halls.some((item) => item.id === hallId) ? hallId : "daily";
  const title = limitText(value.title, 80) || mockAnalyzeMemory(rawContent).title;
  const emotions = normalizeList(value.emotions, emotionOptions, 4);
  const tags = normalizeFreeList(value.tags, 8);
  const people = normalizeFreeList(value.people, 8);
  const emotionIntensity = clampInteger(value.emotionIntensity, 1, 5, 3);
  const importance = clampInteger(value.importance, 1, 5, 2);
  const sourceType = sourceTypes.includes(value.sourceType) ? value.sourceType : "日记";

  return {
    schemaVersion: SCHEMA_VERSION,
    title,
    hall,
    exhibitText: limitText(value.exhibitText, 600) || mockAnalyzeMemory(rawContent).exhibitText,
    emotions: emotions.length ? emotions : ["平静"],
    emotionIntensity,
    tags: tags.length ? tags : ["记忆"],
    people,
    location: limitText(value.location, 80),
    date: limitText(value.date, 30),
    sourceType,
    importance,
    favorite: parseBoolean(value.favorite) || importance >= 4,
    coverImage: limitText(value.coverImage, fieldLimits.coverImage),
    mediaNote: limitText(value.mediaNote, fieldLimits.mediaNote),
    attachments: normalizeAttachments(value.attachments)
  };
}

function mockAnalyzeMemory(rawContent) {
  const text = rawContent.trim();
  const rules = [
    { hall: "youth", keywords: ["毕业", "学校", "操场", "高三", "同学", "考试", "教室", "校园"], title: "被留在校园里的片段", emotions: ["怀念", "遗憾", "迷茫"], tags: ["校园", "青春", "成长"], sourceType: "日记", importance: 4, emotionIntensity: 4 },
    { hall: "friends", keywords: ["朋友", "室友", "兄弟", "姐妹", "群聊", "聚会", "一起"], title: "朋友之间的小型纪念碑", emotions: ["快乐", "怀念", "温暖"], tags: ["朋友", "陪伴", "关系"], sourceType: "聊天片段", importance: 3, emotionIntensity: 3 },
    { hall: "family", keywords: ["妈妈", "爸爸", "家", "爷爷", "奶奶", "外婆", "饭", "春节"], title: "家里传来的回声", emotions: ["怀念", "平静", "温暖"], tags: ["家庭", "生活", "牵挂"], sourceType: "日记", importance: 4, emotionIntensity: 4 },
    { hall: "low", keywords: ["难过", "失眠", "崩溃", "失败", "累", "焦虑", "哭", "撑不住"], title: "低谷里的小灯", emotions: ["委屈", "迷茫", "释然"], tags: ["低谷", "恢复", "自我"], sourceType: "日记", importance: 4, emotionIntensity: 5 },
    { hall: "strange", keywords: ["离谱", "尴尬", "奇怪", "抽象", "荒唐", "笑死", "社死"], title: "一件很难解释的展品", emotions: ["荒诞", "快乐", "紧张"], tags: ["离谱", "尴尬", "趣事"], sourceType: "聊天片段", importance: 2, emotionIntensity: 3 }
  ];
  const matched = rules.find((rule) => rule.keywords.some((keyword) => text.includes(keyword))) || {
    hall: "daily",
    title: "普通日子里的发光切片",
    emotions: ["平静"],
    tags: ["日常", "片段", "记录"],
    sourceType: "日记",
    importance: 1,
    emotionIntensity: 2
  };
  const shortText = text.length > 62 ? `${text.slice(0, 62)}...` : text;

  return {
    schemaVersion: SCHEMA_VERSION,
    title: matched.title,
    hall: matched.hall,
    exhibitText: `这件展品来自一段私人记忆：“${shortText}”。它被放入${getHallName(matched.hall)}，因为其中有值得被保存的情绪和细节。`,
    emotions: matched.emotions,
    emotionIntensity: matched.emotionIntensity,
    tags: matched.tags,
    people: [],
    location: "",
    date: "",
    sourceType: matched.sourceType,
    importance: matched.importance,
    favorite: matched.importance >= 4,
    coverImage: "",
    mediaNote: text.includes("照片") || text.includes("截图") || text.includes("语音")
      ? `第十阶段媒体线索：这段记忆可能包含照片、截图或语音转写内容，可进入后续时间线、主题展和报告摘要。`
      : "",
    attachments: []
  };
}

function getHallName(hallId) {
  return halls.find((hall) => hall.id === hallId)?.name || "日常展厅";
}

function normalizeList(value, allowed, maxLength) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item).trim()).filter((item) => allowed.includes(item)))].slice(0, maxLength);
}

function normalizeFreeList(value, maxLength) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => limitText(item, 30)).filter(Boolean))].slice(0, maxLength);
}

function clampInteger(value, min, max, fallback) {
  const number = Number.parseInt(value, 10);
  if (Number.isNaN(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function limitText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function parseBoolean(value) {
  if (value === true || value === false) return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "y"].includes(normalized)) return true;
    if (["false", "0", "no", "n", ""].includes(normalized)) return false;
  }
  if (typeof value === "number") return value === 1;
  return false;
}

function serveStatic(urlPath, response) {
  const safePath = urlPath === "/" ? "/index.html" : decodeURIComponent(urlPath);
  const filePath = path.normalize(path.join(ROOT_DIR, safePath));
  if (filePath !== ROOT_DIR && !filePath.startsWith(`${ROOT_DIR}${path.sep}`)) {
    return sendJson(response, 403, { error: "Forbidden." });
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      return sendJson(response, 404, { error: "Not found." });
    }
    response.writeHead(200, { "Content-Type": getContentType(filePath) });
    response.end(content);
  });
}

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js") return "application/javascript; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  return "application/octet-stream";
}

function startRequestTrace(request, response, url) {
  const incomingId = String(request.headers["x-request-id"] || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
  const requestId = incomingId || randomUUID();
  const startedAt = Date.now();
  const pathname = url.pathname;
  response.operationContext = {
    requestId,
    method: request.method,
    path: pathname,
    startedAt
  };
  response.setHeader("X-Request-Id", requestId);
  response.on("finish", () => {
    if (!pathname.startsWith("/api")) return;
    const durationMs = Date.now() - startedAt;
    const statusCode = response.statusCode || 0;
    recordOperationEvent({
      id: requestId,
      type: "request",
      method: request.method,
      path: pathname,
      statusCode,
      durationMs,
      level: statusCode >= 500 ? "error" : statusCode >= 400 ? "warning" : "info",
      error: response.operationError?.message,
      at: new Date().toISOString()
    });
  });
}

function recordOperationEvent(event) {
  const normalized = {
    id: event.id || randomUUID(),
    type: event.type || "event",
    method: event.method || "",
    path: event.path || "",
    statusCode: event.statusCode || 0,
    durationMs: event.durationMs || 0,
    level: event.level || "info",
    error: event.error || "",
    at: event.at || new Date().toISOString()
  };
  operationEvents.unshift(normalized);
  if (operationEvents.length > OPERATION_EVENT_LIMIT) {
    operationEvents.length = OPERATION_EVENT_LIMIT;
  }
  appendOperationEvent(normalized);
}

function appendOperationEvent(event) {
  try {
    fs.mkdirSync(path.dirname(OPERATION_LOG_PATH), { recursive: true });
    fs.appendFileSync(OPERATION_LOG_PATH, `${JSON.stringify(event)}\n`, "utf8");
  } catch (error) {
    console.warn(`operations log append failed: ${error.message}`);
  }
}

function hydrateOperationEvents() {
  try {
    if (!fs.existsSync(OPERATION_LOG_PATH)) return;
    const lines = fs.readFileSync(OPERATION_LOG_PATH, "utf8").trim().split(/\r?\n/).filter(Boolean);
    const recent = lines.slice(-OPERATION_EVENT_LIMIT).map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    }).filter(Boolean).reverse();
    operationEvents.splice(0, operationEvents.length, ...recent);
  } catch (error) {
    console.warn(`operations log hydrate failed: ${error.message}`);
  }
}

function sendJson(response, statusCode, payload) {
  const headers = { "Content-Type": "application/json; charset=utf-8" };
  if (response.operationContext?.requestId) headers["X-Request-Id"] = response.operationContext.requestId;
  response.writeHead(statusCode, headers);
  response.end(JSON.stringify(payload));
}

function sendError(response, error) {
  const statusCode = error.statusCode || 500;
  return sendJson(response, statusCode, {
    error: statusCode >= 500 ? "Server error." : error.message,
    detail: statusCode >= 500 ? error.message : undefined
  });
}

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}
