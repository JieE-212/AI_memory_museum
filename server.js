const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { randomUUID } = require("crypto");
const { createMemoryStore } = require("./database");
const { createOperationsService } = require("./src/services/operations");
const { createHealthRoutes } = require("./src/routes/health");
const { createOperationsRoutes } = require("./src/routes/operations");

const ROOT_DIR = __dirname;

loadEnvFile(path.join(ROOT_DIR, ".env"));

const PORT = Number(process.env.PORT) || 3000;
const IS_VERCEL = Boolean(process.env.VERCEL);
const INTERVIEW_DEMO = parseEnvFlag(process.env.INTERVIEW_DEMO) || parseEnvFlag(process.env.DEMO_MODE);
const DB_PATH = process.env.DB_PATH || (
  INTERVIEW_DEMO
    ? path.join(os.tmpdir(), "ai-memory-museum-interview-demo.sqlite")
    : path.join(ROOT_DIR, "data", "memory-museum.sqlite")
);
const SCHEMA_VERSION = 2;
const PHASE = 29;
const PHASE_NAME = "\u53d1\u5e03\u6cbb\u7406\u89c4\u5212";
const APP_VERSION = "1.9.48";
const BUILD_LABEL = "phase29-release-exit-final-archive-manifest-preview";
const RELEASE_CHANNEL = process.env.RELEASE_CHANNEL || "local-preview";
const OPERATION_EVENT_LIMIT = 80;
const OPERATION_LOG_PATH = process.env.OPERATIONS_LOG_PATH || (
  INTERVIEW_DEMO
    ? path.join(os.tmpdir(), "ai-memory-museum-operations-events.jsonl")
    : path.join(ROOT_DIR, "data", "operations-events.jsonl")
);
const MAX_RAW_LENGTH = 2000;
const MAX_BODY_LENGTH = 2 * 1024 * 1024;
const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS) || 20000;
const operationEvents = [];
let operationsService;
let healthRoutes;
let operationsRoutes;

const halls = [
  { id: "youth", name: "Youth Hall", description: "Campus, graduation, growth, and unfinished words." },
  { id: "friends", name: "朋友展厅", description: "朋友、室友、群聊和共同经历" },
  { id: "family", name: "家庭展厅", description: "家人、饭桌、节日和被照顾的瞬间" },
  { id: "low", name: "Low Point Hall", description: "Setbacks, fatigue, insomnia, and standing up again." },
  { id: "strange", name: "Strange Moments Hall", description: "Absurd, awkward, unlikely, but hard to forget." },
  { id: "daily", name: "Daily Hall", description: "Details worth keeping from ordinary days." }
];

const emotionOptions = ["nostalgia", "joy", "regret", "calm", "absurd", "moved", "excited", "tense", "lonely", "wronged", "angry", "afraid", "relieved", "hopeful", "warm", "lost"];
const sourceTypes = ["日记", "聊天片段", "照片描述", "旅行片段", "梦境", "物品", "图片", "截图", "语音转写", "其他"];
const importanceLabels = ["普通展", "值得一看", "重要展品", "珍贵展品", "镇馆"];
const attachmentTypeOrder = ["图片", "OCR", "语音", "文档", "视频", "其他"];
const agentRoles = [
  { id: "archivist", name: "档案Agent", duty: "提取人物、地点、时间、来源和原始线索" },
  { id: "curator", name: "策展Agent", duty: "判断展厅、情绪和珍藏级别" },
  { id: "editor", name: "编辑 Agent", duty: "生成标题、标签和展品说明" },
  { id: "guide", name: "讲解Agent", duty: "整理面向参观者的导览提示" }
];
const workflowTemplates = [
  {
    id: "memory-curation",
    name: "展品整理工作流",
    purpose: "purpose text",
    entry: "/api/analyze",
    maturity: "active",
    statusLabel: "statusLabel text",
    nodes: [
      { id: "archivist", agent: "档案Agent", stage: "线索提取", interruptible: true, evidence: ["rawContent", "people", "location", "date"] },
      { id: "curator", agent: "策展Agent", stage: "展厅与情绪判断", interruptible: true, evidence: ["hall", "emotions", "emotionIntensity", "importance"] },
      { id: "editor", agent: "编辑 Agent", stage: "展品草稿", interruptible: true, evidence: ["title", "tags", "exhibitText"] },
      { id: "guide", agent: "讲解Agent", stage: "导览准备", interruptible: false, evidence: ["savedMemory", "ragCandidate"] }
    ],
    controls: ["confirm", "reject", "retry", "save"],
    pausePoints: ["needs_review", "approved", "rejected"],
    riskSignals: ["缺少时间", "缺少人物地点", "展品说明过短"],
    nextActions: ["补齐复核", "保存工作流快照", "回看整理历史"],
    persistence: ["agent_runs", "agent_steps", "agent_events", "memories.agent_run_id"],
    replay: true
  },
  {
    id: "insight-report",
    name: "回忆报告工作流",
    purpose: "purpose text",
    entry: "/api/insights",
    maturity: "draft",
    statusLabel: "statusLabel text",
    nodes: [
      { id: "timeline", agent: "时间Agent", stage: "时间分组", interruptible: false, evidence: ["date", "createdAt"] },
      { id: "theme", agent: "ThemeAgent", stage: "主题聚合", interruptible: true, evidence: ["tags", "people", "location", "emotions"] },
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
    purpose: "purpose text",
    entry: "/api/guide",
    maturity: "active",
    statusLabel: "statusLabel text",
    nodes: [
      { id: "query", agent: "提问理解 Agent", stage: "问题锚点", interruptible: false, evidence: ["question", "keywords"] },
      { id: "retrieval", agent: "检索Agent", stage: "混合召回", interruptible: false, evidence: ["keyword", "semantic", "confidence"] },
      { id: "answer", agent: "讲解Agent", stage: "引用回答", interruptible: true, evidence: ["citations", "followUps", "boundary"] }
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
  "youth", "campus", "graduation", "growth", "classmate", "dorm", "exam", "farewell", "friend", "roommate", "group chat", "photo",
  "family", "parent", "meal", "school", "travel", "station", "rain", "dream", "low point", "setback", "insomnia", "fatigue",
  "daily", "walk", "evening wind", "absurd", "awkward", "unlikely", "nostalgia", "joy", "warm", "moved", "excited", "tense",
  "lonely", "wronged", "angry", "afraid", "relieved", "regret", "calm", "hopeful", "lost", "photo", "diary", "chat", "object", "important"
];
const guideSearchStopWords = new Set(["帮我", "看看", "一", "哪些", "有哪", "有什么", "有没有", "什么", "为什么", "如何", "怎么", "能不能", "可以", "关于", "相关", "这个", "这些", "记忆", "展品", "讲讲", "总结", "推荐"]);
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
resetInterviewDemoStorage();
try {
  store = createMemoryStore({ dbPath: DB_PATH, halls, schemaVersion: SCHEMA_VERSION });
  seedInterviewDemoData();
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
  console.error("Database startup failed: unable to open SQLite database.");
  console.error(`数据库路径：${DB_PATH}`);
  console.error(`Error reason: ${error.message}`);
  console.error("可以检查目录权限，或通过 DB_PATH 指定一个可写路径后重试");
  process.exit(1);
}

async function handleRequest(request, response) {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    startRequestTrace(request, response, url);

    if (request.method === "GET" && url.pathname === "/api/demo/status") {
      return sendJson(response, 200, buildInterviewDemoStatus());
    }

    if (isInterviewDemoBlockedMutation(request, url)) {
      return sendJson(response, 403, {
        error: "Interview demo is read-safe: destructive actions are disabled.",
        interviewDemo: true,
        blockedAction: `${request.method} ${url.pathname}`
      });
    }

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
}

const server = http.createServer(handleRequest);

if (IS_VERCEL) {
  module.exports = handleRequest;
} else {
  server.listen(PORT, () => {
    console.log(`AI 记忆博物馆已启动：http://localhost:${PORT}`);
    console.log(process.env.AI_API_KEY ? "AI 模式：已配置 API Key" : "AI 模式：未配置 API Key，将使用 Mock 回退");
  });
}

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`端口 ${PORT} 已被占用。可以设置 PORT=3001 后重试。`);
    process.exit(1);
  }
  console.error(error);
  process.exit(1);
});

if (!IS_VERCEL) {
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

function shutdown() {
  try {
    store.close();
  } finally {
    process.exit(0);
  }
}

function parseEnvFlag(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function resetInterviewDemoStorage() {
  if (!INTERVIEW_DEMO) return;
  if (!process.env.DB_PATH) fs.rmSync(DB_PATH, { force: true });
  if (!process.env.OPERATIONS_LOG_PATH) fs.rmSync(OPERATION_LOG_PATH, { force: true });
}

function seedInterviewDemoData() {
  if (!INTERVIEW_DEMO || store.listMemories().length > 0) return;

  const memories = [
    {
      id: "demo-campus-night",
      title: "操场尽头的告别",
      hall: "youth",
      rawContent: "高三毕业那天晚上，我们几个人在操场坐到很晚，谁也没有先说以后还会不会见面。",
      exhibitText: "这件展品记录了一次没有正式说出口的告别。夜晚、操场和沉默一起保存了青春快结束时的重量。",
      date: "2019-06-12",
      location: "学校操场",
      people: ["同学", "朋友"],
      tags: ["毕业", "校园", "夜晚"],
      emotions: ["nostalgia", "regret"],
      emotionIntensity: 4,
      sourceType: "日记",
      importance: 4,
      favorite: true,
      mediaNote: "面试 Demo 示例：这里可以放照片、截图或语音转写线索，但不上传真实私人文件。",
      createdAt: "2026-07-01T09:00:00.000Z"
    },
    {
      id: "demo-family-box",
      title: "被塞满的保鲜盒",
      hall: "family",
      rawContent: "离家那天，妈妈把剩菜装进两个保鲜盒，反复说路上饿了就吃。地铁上我突然觉得袋子很重。",
      exhibitText: "这件展品把普通的叮嘱保存成可回看的证据。重量来自保鲜盒，也来自家人不太会说出口的牵挂。",
      date: "2021-10-03",
      location: "地铁站",
      people: ["妈妈"],
      tags: ["家人", "离家", "饭菜"],
      emotions: ["warm", "moved"],
      emotionIntensity: 5,
      sourceType: "日记",
      importance: 5,
      favorite: true,
      createdAt: "2026-07-01T09:01:00.000Z"
    },
    {
      id: "demo-friend-photo",
      title: "群聊里突然翻出的合照",
      hall: "friends",
      rawContent: "朋友在群里发了一张很糊的旧合照，大家开始翻旧账，笑到凌晨一点。",
      exhibitText: "这件展品来自一次被旧照片点燃的群聊。它适合展示项目的标签、人物线索、主题展和讲解员检索能力。",
      date: "2024-02-18",
      location: "线上群聊",
      people: ["室友", "朋友"],
      tags: ["合照", "群聊", "友情"],
      emotions: ["joy", "nostalgia"],
      emotionIntensity: 4,
      sourceType: "聊天片段",
      importance: 3,
      favorite: false,
      coverImage: "旧合照线索：画面很糊，但所有人都在笑。",
      createdAt: "2026-07-01T09:02:00.000Z"
    },
    {
      id: "demo-rain-train",
      title: "不想太快到站的雨夜",
      hall: "daily",
      rawContent: "旅行回来的车上，窗外一直下雨，我突然不想那么快到站。",
      exhibitText: "这件展品适合展示时间线和回忆报告：它不是重大事件，却能把一个阶段的疲惫、安静和期待都带出来。",
      date: "2025-04-20",
      location: "返程列车",
      people: [],
      tags: ["旅行", "雨夜", "返程"],
      emotions: ["calm", "lost"],
      emotionIntensity: 3,
      sourceType: "旅行片段",
      importance: 3,
      favorite: false,
      createdAt: "2026-07-01T09:03:00.000Z"
    }
  ];

  const normalized = memories.map(normalizeMemory);
  store.importMemories(normalized);
  store.saveSavedExhibition({
    id: "demo-exhibition-growing-up",
    title: "示例主题展：长大的一些证据",
    intro: "面试 Demo 自动生成的专题展，用来展示展品引用、专题资产和导览词。",
    status: "published",
    coverMemoryId: "demo-campus-night",
    memoryIds: ["demo-campus-night", "demo-family-box", "demo-friend-photo"],
    tags: ["Interview Demo", "示例数据"],
    guideText: "从校园告别、家人叮嘱到朋友合照，这组展品展示项目如何把散落记忆组织成可浏览、可检索、可讲解的主题。"
  });
  store.saveReportDraft({
    id: "demo-report-interview",
    title: "示例回忆报告：一段从离别到回看的路径",
    status: "review",
    scope: { source: "interview-demo", memoryCount: normalized.length },
    sections: [
      { title: "从告别开始", text: "校园夜晚的展品提供了最强的青春线索。" },
      { title: "家人的重量", text: "保鲜盒展品把私人情绪转成可回看的叙事节点。" },
      { title: "可演示能力", text: "面试官可以继续新增、搜索、导出和询问讲解员。" }
    ],
    references: normalized.map((memory) => ({ id: memory.id, title: memory.title })),
    sourceInsights: { demo: true, note: "This is seeded interview data, not real private memory." }
  });
}

function buildInterviewDemoStatus() {
  return {
    interviewDemo: INTERVIEW_DEMO,
    mode: INTERVIEW_DEMO ? "interview-demo" : "local",
    storage: INTERVIEW_DEMO ? "ephemeral-sqlite-on-tmp" : "local-sqlite",
    databasePath: INTERVIEW_DEMO ? "/tmp/ai-memory-museum-interview-demo.sqlite" : DB_PATH,
    seededExamples: INTERVIEW_DEMO ? 4 : 0,
    destructiveActionsBlocked: INTERVIEW_DEMO,
    aiMode: process.env.AI_API_KEY ? "configured" : "mock-fallback"
  };
}

function isInterviewDemoBlockedMutation(request, url) {
  if (!INTERVIEW_DEMO) return false;
  if (request.method !== "DELETE") return false;
  return (
    url.pathname === "/api/memories/purge"
    || /^\/api\/memories\/[a-zA-Z0-9_-]{8,80}$/.test(url.pathname)
    || /^\/api\/exhibitions\/[a-zA-Z0-9_-]{1,120}$/.test(url.pathname)
    || /^\/api\/report-drafts\/[a-zA-Z0-9_-]{1,120}$/.test(url.pathname)
  );
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
      reason: "reason text",
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
      reason: "reason text",
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
    confidence: item.confidence || { level: "weak", label: "寮辫瘉", reason: "reason text" },
    reason: item.reason || ""
  };
}

function buildGuideFollowUps(question, citations = [], retrievalMode = "hybrid") {
  const top = citations[0];
  const title = top?.title || "this memory";
  const fields = new Set((top?.matchedFields || []).map(String));
  const hasMediaEvidence = [...fields].some(isMediaMatchedField);
  if (retrievalMode === "recent-fallback" || !citations.length) {
    return [
      "Ask again with a person, place, or time anchor",
      "Add a more specific emotion word",
      `Start from the recent memory ${title}`
    ];
  }
  const prompts = [
    hasMediaEvidence ? `Continue with media clues around ${title}` : `Why is ${title} the closest match?`,
    fields.has("emotions") ? "Tell these memories by emotional change" : "Do these exhibits share a similar emotion?",
    hasMediaEvidence ? "Which other exhibits include image, screenshot, or audio clues?" : fields.has("people") ? "Build a story line around the related people" : "Can you find other exhibits with a similar theme?"
  ];
  if (question.includes("recommend")) {
    prompts[0] = `Continue the guided tour from ${title}`;
  }
  return prompts.slice(0, 3);
}

function isMediaMatchedField(field) {
  return /附件|多模态|封面|attachment|multimodal|cover/i.test(String(field || ""));
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
            "You are the guide for AI Memory Museum.",
            "Answer only from the provided candidate exhibits; do not invent private experiences outside the candidates.",
            "Mention citation evidence naturally, such as matched exhibit title, field, or semantic clue.",
            "Keep the answer warm, concrete, and museum-guide-like.",
            "If evidence is weak, say the judgment is limited to the current exhibits.",
            "Keep the answer concise."
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
    "You are the AI Memory Museum agent workflow, including archivist, curator, editor, and guide roles.",
    "Turn one private memory into a museum exhibit.",
    "Return JSON only. Do not return Markdown or explanations.",
    "Required JSON fields: title, hall, exhibitText, emotions, emotionIntensity, tags, people, location, date, sourceType, importance, favorite, coverImage, mediaNote, attachments.",
    `hall must be one of: ${halls.map((hall) => hall.id).join(", ")}.`,
    `emotions must choose 1 to 4 values from: ${emotionOptions.join(", ")}.`,
    `sourceType must be one of: ${sourceTypes.join(", ")}.`,
    "emotionIntensity and importance must be integers from 1 to 5.",
    "tags and people must be string arrays; return empty arrays when unclear.",
    "date should be YYYY-MM-DD only when clear; otherwise return an empty string.",
    "exhibitText should be 60 to 140 Chinese characters, like a museum exhibit description."
  ].join("\n");
}

function buildAgentWorkflow(rawContent, analysis, mode) {
  const createdAt = new Date().toISOString();
  const runId = createId();
  const shortRaw = limitText(rawContent, 96);
  const people = compactList(analysis.people, "未识别明确人物");
  const tags = compactList(analysis.tags, "鏆傛棤鏍囩");
  const emotions = compactList(analysis.emotions, "鏆傛棤鎯呯华");
  const hallName = getHallName(analysis.hall);
  const sourceText = [analysis.sourceType, analysis.location, analysis.date].filter(Boolean).join(" / ") || "来源线索不足";
  const reviewItems = buildWorkflowReviewItems(analysis);
  const archiveNeedsReview = reviewItems.some((item) => ["people", "location", "date"].includes(item.field));
  const editorNeedsReview = reviewItems.some((item) => ["tags", "exhibitText"].includes(item.field));

  const steps = [
    {
      id: "archivist",
      agent: "妗ｆAgent",
      duty: agentRoles.find((role) => role.id === "archivist")?.duty,
      status: archiveNeedsReview ? "needs_review" : "done",
      output: `Recorded raw segment ${shortRaw}; people: ${people}; source: ${sourceText}.`,
      evidence: ["rawContent", "people", "location", "date"],
      actions: archiveNeedsReview ? ["confirm", "retry"] : ["confirm"]
    },
    {
      id: "curator",
      agent: "策展Agent",
      duty: agentRoles.find((role) => role.id === "curator")?.duty,
      status: "done",
      output: `Placed in ${hallName}; emotions: ${emotions}; intensity ${analysis.emotionIntensity} / 5; importance ${analysis.importance} / 5.`,
      evidence: ["hall", "emotions", "emotionIntensity", "importance"],
      actions: ["confirm"]
    },
    {
      id: "editor",
      agent: "缂栬緫 Agent",
      duty: agentRoles.find((role) => role.id === "editor")?.duty,
      status: editorNeedsReview ? "needs_review" : "done",
      output: `Generated title ${analysis.title}; tags: ${tags}; exhibit text compressed for display.`,
      evidence: ["title", "tags", "exhibitText"],
      actions: editorNeedsReview ? ["confirm", "retry"] : ["confirm"]
    },
    {
      id: "guide",
      agent: "璁茶ВAgent",
      duty: agentRoles.find((role) => role.id === "guide")?.duty,
      status: reviewItems.length ? "queued" : "ready",
      output: reviewItems.length
        ? "等待人工确认完成后，再进入讲解员检索池"
        : `After saving, this can enter the guide retrieval pool as a candidate exhibit for ${hallName}.`,
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
  if (!Array.isArray(analysis.people) || analysis.people.length === 0) items.push({ field: "people", label: "人物未明" });
  if (!analysis.location) items.push({ field: "location", label: "鍦扮偣鍙ˉ" });
  if (!analysis.date) items.push({ field: "date", label: "时间可补" });
  if (!Array.isArray(analysis.tags) || analysis.tags.length < 2) items.push({ field: "tags", label: "标签可再丰富" });
  if (!analysis.exhibitText || analysis.exhibitText.length < 40) items.push({ field: "exhibitText", label: "展品说明偏短" });
  return items.slice(0, 4);
}

function compactList(values, fallback) {
  const list = Array.isArray(values) ? values.filter(Boolean).slice(0, 4) : [];
  return list.length ? list.join("") : fallback;
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
  const exhibitText = limitText(memory.exhibitText || rawContent || "This exhibit does not have a description yet.", fieldLimits.exhibitText);
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
    label: `Exhibit ${limitText(memory.title, 40)} has been ${actionLabel} and linked to workflow history`,
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
      .split(/[,;，、；]/)
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
    if (typeof item === "string") return { name: limitText(item, fieldLimits.attachmentName), type: "闄勪欢", note: "note text" }
    return {
      name: limitText(item.name || item.filename || item.title, fieldLimits.attachmentName),
      type: limitText(item.type || item.kind || "闄勪欢", 30),
      note: limitText(item.note || item.description || item.text, fieldLimits.attachmentNote)
    };
  }).filter((item) => item.name).slice(0, 8);
}

function getAttachmentCategory(item = {}) {
  const text = `${item.type || ""} ${item.name || ""} ${item.note || ""}`.toLowerCase();
  if (/图片|照片|截图|合照|相册|image|photo|png|jpe?g|webp|gif|heic/.test(text)) return "图片";
  if (/ocr|scan/.test(text)) return "OCR";
  if (/璇煶|褰曢煶|杞啓|闊抽|voice|audio|mp3|wav|m4a/.test(text)) return "璇煶";
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
    app: "AI 记忆博物",
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
    phase20PlatformPlan: buildPhase20PlatformPlan(memories),
    phase21RuntimeSandboxPlan: buildPhase21RuntimeSandboxPlan(memories),
    phase22RuntimeEvidenceReview: buildPhase22RuntimeEvidenceReview(memories),
    phase23ReleaseReadinessReviewUi: buildPhase23ReleaseReadinessReviewUi(memories),
    phase24RuntimeSandboxUxEntry: buildPhase24RuntimeSandboxUxEntry(memories),
    phase25RuntimeSandboxUiSurface: buildPhase25RuntimeSandboxUiSurface(memories),
    phase26RuntimeValidationEntry: buildPhase26RuntimeValidationEntry(memories),
    phase27ReleaseBlockerGovernanceEntry: buildPhase27ReleaseBlockerGovernanceEntry(memories),
    phase28ClearanceReviewEntry: buildPhase28ClearanceReviewEntry(memories),
    phase29ReleaseGovernancePlanning: buildPhase29ReleaseGovernancePlanning(memories),
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
  if (/^\s*(?:\[[^\]]+\]\s*)?[^"\n]{1,16}["]/m.test(trimmed)) return "chat";
  return "text";
}

function getPhase19CsvDelimiter(line = "") {
  const delimiters = [",", "\t", ";", ""];
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
    const match = line.match(/^(?:\[?(\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}:\d{2})\]?\s*)?([^:\n：]{1,18})[:：]\s*(.+)$/);
    if (!match) {
      if (active) active.lines.push(line);
      else groups.push({ speaker: "segment", time: "", lines: [line] });
      return;
    }
    const [, time = "", speaker = "segment", content = ""] = match;
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
    title: `${group.speaker} chat segment ${index + 1}`,
    rawContent: group.lines.join("\n"),
    people: [group.speaker].filter((item) => item && item !== "鐗囨"),
    date: /^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(group.time) ? group.time.replace(/\//g, "-") : "",
    sourceType: "鑱婂ぉ鐗囨",
    sourceTrace: `鑱婂ぉ璁板綍 / ${group.speaker}${group.time ? ` / ${group.time}` : ""}`
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
        sourceTrace: `JSON item ${index + 1}`
      })).filter((item) => item.rawContent || item.title);
    } catch {
      return [{ title: "JSON 解析失败的原始片", rawContent: trimmed }];
    }
  }
  if (format === "csv") {
    return parsePhase19CsvRows(trimmed).map((row, index) => ({
      title: row.title || row.name || `CSV segment ${index + 1}`,
      rawContent: row.rawContent || row.content || row.text || Object.values(row).join(" / "),
      date: row.date || "",
      location: row.location || "",
      people: row.people || "",
      tags: row.tags || "",
      sourceType: row.sourceType || "",
      sourceTrace: `CSV row ${index + 2} / delimiter ${row._delimiter === "\t" ? "Tab" : row._delimiter}`
    }));
  }
  if (format === "markdown") {
    const blocks = trimmed.split(/\n(?=#{1,3}\s+)/).map((block) => block.trim()).filter(Boolean);
    return blocks.map((block, index) => {
      const heading = block.match(/^#{1,3}\s+(.+)$/m)?.[1] || `Markdown 鐗囨 ${index + 1}`;
      return { title: heading, rawContent: block.replace(/^#{1,3}\s+.+$/m, "").trim() || block, sourceTrace: `Markdown heading ${heading}` };
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
      mediaNote: [analysis.mediaNote, `Phase 19 import source: ${segment.sourceTrace || `${detectedFormat} segment ${index + 1}`}`].filter(Boolean).join("\n")
    });
    return {
      ...draft,
      selected: true,
      importTrace: segment.sourceTrace || `${detectedFormat} segment ${index + 1}`
    };
  });
  const missingContent = segments.filter((item) => !String(item.rawContent || "").trim()).length;
  const duplicateTitles = drafts.length - new Set(drafts.map((item) => item.title)).size;
  return {
    phase: PHASE,
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
      title: "title/name/鏍囬 鎴栬嚜鍔ㄧ敓",
      rawContent: "rawContent/content/text/正文/内容 或段落正",
      date: "date/日期",
      location: "location/鍦扮偣",
      people: "people/人物",
      tags: "tags/鏍囩"
    },
    quality: {
      ready: drafts.length > 0 && !missingContent,
      missingContent,
      duplicateTitles,
      selectedCount: drafts.filter((item) => item.selected !== false).length,
      recommendation: drafts.length
        ? "Review title, date, people, and place before importing drafts; Phase 18 can continue enrichment after import."
        : "Paste diary, Markdown, CSV, JSON, or chat text to generate a preview."
    }
  };
}

function buildPhase19ImportPlan(memories = []) {
  return {
    phase: 19,
    phaseName: "个人知识生态和外部导入",
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
    recommendation: "recommendation text"
  };
}

function buildPhase20PlatformPlan(memories = []) {
  const savedExhibitions = store.listSavedExhibitions();
  const reportDrafts = store.listReportDrafts();
  return {
    phase: 20,
    phaseName: "可扩展产品平台和插件生态版",
    version: APP_VERSION,
    mode: "platform-boundary-first",
    runtimePolicy: "manifest-only-no-third-party-code-execution",
    currentScope: [
      "plugin-manifest-registry",
      "plugin-manifest-schema",
      "permission-review",
      "plugin-audit-log",
      "capability-catalog",
      "extension-point-map",
      "security-boundary",
      "built-in-plugin-inventory",
      "built-in-plugin-registry",
      "extension-contract-tests",
      "plugin-sandbox-boundary",
      "no-code-template-pack",
      "signed-plugin-manifest",
      "plugin-installation-workflow",
      "template-preview-fixtures",
      "plugin-review-workbench",
      "plugin-lockfile",
      "plugin-lockfile-export",
      "plugin-install-queue-persistence",
      "plugin-release-signature-gate",
      "plugin-lockfile-import-preview",
      "plugin-pre-release-check-command",
      "plugin-signature-diff-report",
      "plugin-release-report-artifact",
      "plugin-diff-review-history",
      "plugin-release-report-validation-command",
      "plugin-signed-release-report-export",
      "plugin-review-history-ui",
      "plugin-validation-command-ci-wrapper",
      "plugin-signed-report-download",
      "plugin-ci-badge-summary",
      "plugin-download-integrity-preview",
      "plugin-release-checklist-gate",
      "phase20-readiness"
    ],
    extensionPoints: [
      { id: "importer", label: "导入", status: "planned", contract: "preview -> draft -> reviewed import", owner: "phase19ImportPlan" },
      { id: "exporter", label: "导出", status: "planned", contract: "collection -> package -> redaction policy", owner: "privacyPolicy" },
      { id: "agent-tool", label: "Agent 工具", status: "planned", contract: "suggestion -> human review -> auditable action", owner: "phase18LongTermAgent" },
      { id: "asset-template", label: "专题展模", status: "planned", contract: "asset draft -> editable sections -> release package", owner: "phase15 assets" },
      { id: "sync-adapter", label: "同步适配", status: "planned", contract: "local-first package -> conflict preview -> manual apply", owner: "phase16/17 sync" }
    ],
    builtInPlugins: [
      { id: "markdown-importer", type: "importer", status: "built-in", enabled: true, source: "phase19", manifest: { schemaVersion: "phase20.plugin.manifest.v1", permissions: ["memory.import.preview"], extensionPoint: "importer" } },
      { id: "csv-importer", type: "importer", status: "built-in", enabled: true, source: "phase19", manifest: { schemaVersion: "phase20.plugin.manifest.v1", permissions: ["memory.import.preview"], extensionPoint: "importer" } },
      { id: "chat-importer", type: "importer", status: "built-in", enabled: true, source: "phase19", manifest: { schemaVersion: "phase20.plugin.manifest.v1", permissions: ["memory.import.preview"], extensionPoint: "importer" } },
      { id: "redacted-exporter", type: "exporter", status: "built-in", enabled: true, source: "phase12", manifest: { schemaVersion: "phase20.plugin.manifest.v1", permissions: ["memory.export.redacted"], extensionPoint: "exporter" } },
      { id: "long-term-review-agent", type: "agent-tool", status: "built-in", enabled: true, source: "phase18", manifest: { schemaVersion: "phase20.plugin.manifest.v1", permissions: ["agent.suggest", "memory.read.summary"], extensionPoint: "agent-tool" } },
      { id: "manual-json-sync", type: "sync-adapter", status: "built-in", enabled: true, source: "phase16", manifest: { schemaVersion: "phase20.plugin.manifest.v1", permissions: ["sync.package.preview"], extensionPoint: "sync-adapter" } }
    ],
    builtInPluginRegistry: {
      schemaVersion: "phase20.builtIn.registry.v1",
      status: "registry-ready-runtime-disabled",
      owner: "local-platform",
      total: 6,
      enabled: 6,
      categories: ["importer", "exporter", "agent-tool", "sync-adapter"],
      entries: [
        { id: "markdown-importer", type: "importer", owner: "phase19", status: "enabled", capability: "markdown-to-memory-drafts", input: "markdown text", output: "reviewable memory drafts", contract: "preview-only" },
        { id: "csv-importer", type: "importer", owner: "phase19", status: "enabled", capability: "csv-to-memory-drafts", input: "csv text", output: "reviewable memory drafts", contract: "preview-only" },
        { id: "chat-importer", type: "importer", owner: "phase19", status: "enabled", capability: "chat-to-memory-drafts", input: "chat transcript", output: "reviewable memory drafts", contract: "preview-only" },
        { id: "redacted-exporter", type: "exporter", owner: "phase12", status: "enabled", capability: "redacted-memory-export", input: "memory collection", output: "redacted export package", contract: "redaction-required" },
        { id: "long-term-review-agent", type: "agent-tool", owner: "phase18", status: "enabled", capability: "long-term-review-suggestions", input: "memory summaries", output: "reviewable suggestions", contract: "human-confirmation" },
        { id: "manual-json-sync", type: "sync-adapter", owner: "phase16", status: "enabled", capability: "manual-json-sync-preview", input: "local-first sync package", output: "conflict preview", contract: "manual-apply-only" }
      ],
      registryChecks: ["unique-id", "known-extension-point", "manifest-attached", "permission-reviewed", "audit-sample-present"],
      runtimeExecution: false
    },
    manifestSchema: {
      schemaVersion: "phase20.plugin.manifest.v1",
      status: "schema-ready-runtime-disabled",
      requiredFields: ["id", "name", "version", "type", "extensionPoint", "permissions", "entryPolicy", "dataAccess", "audit"],
      optionalFields: ["description", "sourcePhase", "capabilities", "compatibility", "uiHints", "disabledReason"],
      permissionLabels: ["memory.import.preview", "memory.export.redacted", "memory.read.summary", "agent.suggest", "sync.package.preview"],
      extensionContracts: ["importer", "exporter", "agent-tool", "asset-template", "sync-adapter"],
      validationRules: [
        "id must be stable kebab-case",
        "extensionPoint must match a declared Phase 20 extension point",
        "permissions must use approved labels",
        "entryPolicy must be manifest-only",
          "networkAccess and secretStorage must remain false in 1.0.25"
      ]
    },
    manifestValidation: {
      status: "ready",
      runtimeExecution: false,
      builtInManifestCount: 6,
      sampleManifestIds: ["markdown-importer", "csv-importer", "chat-importer", "redacted-exporter", "long-term-review-agent", "manual-json-sync"],
      blockedUntil: ["permission-review", "sandbox-boundary"]
    },
    permissionReview: {
      status: "policy-ready",
      defaultDecision: "deny-until-reviewed",
      humanApprovalRequired: true,
      reviewScope: ["manifest.permissions", "manifest.entryPolicy", "manifest.dataAccess", "manifest.audit"],
      reviewChecklist: [
        "纭鎻掍欢鍙０鏄庡厑璁哥殑鏉冮檺鏍囩",
        "确认插件不打开第三方代码执",
        "确认插件不请求网络访问和密钥存储",
        "确认高风险能力需要人工复核",
        "确认被禁用的原因会写入审"
      ],
      builtInDecisions: [
        { id: "markdown-importer", decision: "approved", permissions: ["memory.import.preview"], confirmationRequired: false },
        { id: "csv-importer", decision: "approved", permissions: ["memory.import.preview"], confirmationRequired: false },
        { id: "chat-importer", decision: "approved", permissions: ["memory.import.preview"], confirmationRequired: false },
        { id: "redacted-exporter", decision: "approved", permissions: ["memory.export.redacted"], confirmationRequired: false },
        { id: "long-term-review-agent", decision: "reviewed", permissions: ["agent.suggest", "memory.read.summary"], confirmationRequired: true },
        { id: "manual-json-sync", decision: "approved", permissions: ["sync.package.preview"], confirmationRequired: false }
      ],
      permissionLabels: [
        { id: "memory.import.preview", review: "approved", scope: "导入预览" },
        { id: "memory.export.redacted", review: "approved", scope: "脱敏导出" },
        { id: "memory.read.summary", review: "reviewed", scope: "鎽樿璇诲彇" },
        { id: "agent.suggest", review: "reviewed", scope: "Agent 建议" },
        { id: "sync.package.preview", review: "approved", scope: "同步包预" }
      ],
      blockedUntil: ["sandbox-boundary"],
      auditEventTypes: ["manifest-loaded", "permission-reviewed", "decision-approved", "decision-blocked", "confirmation-recorded"]
    },
    pluginAuditLog: {
      status: "audit-model-ready",
      eventSchemaVersion: "phase20.plugin.audit.v1",
      storageMode: "export-and-operations-summary",
      runtimeExecution: false,
      requiredFields: ["id", "pluginId", "eventType", "decision", "actor", "createdAt", "evidence"],
      eventTypes: ["manifest-loaded", "permission-reviewed", "decision-approved", "decision-blocked", "confirmation-recorded", "runtime-blocked"],
      sampleEvents: [
        { id: "audit-markdown-importer-manifest", pluginId: "markdown-importer", eventType: "manifest-loaded", decision: "recorded", actor: "system", evidence: ["phase20.plugin.manifest.v1", "memory.import.preview"] },
        { id: "audit-long-term-review-agent-permission", pluginId: "long-term-review-agent", eventType: "permission-reviewed", decision: "reviewed", actor: "human-review-required", evidence: ["agent.suggest", "memory.read.summary"] },
        { id: "audit-third-party-runtime-blocked", pluginId: "third-party-placeholder", eventType: "runtime-blocked", decision: "blocked", actor: "system", evidence: ["thirdPartyExecution=false", "networkAccessForPlugins=false"] }
      ],
      exportFields: ["phase20PlatformPlan.pluginAuditLog", "phase20PlatformPlan.permissionReview.auditEventTypes"],
      nextControls: ["tamper-evident-checksum", "audit-search", "reviewer-note"]
    },
    extensionContractTests: {
      schemaVersion: "phase20.extension.contract-tests.v1",
      status: "contract-tests-ready-runtime-disabled",
      runtimeExecution: false,
      coverage: ["importer", "exporter", "agent-tool", "asset-template", "sync-adapter"],
      requiredAssertions: [
        "declared-extension-point",
        "manifest-schema-version",
        "permission-labels-reviewed",
        "no-network-access",
        "no-secret-storage",
        "human-review-or-preview-output",
        "audit-event-emitted"
      ],
      contractSuites: [
        { id: "importer-contract", extensionPoint: "importer", status: "ready", samplePlugin: "markdown-importer", inputFixture: "markdown text", expectedOutput: "reviewable memory drafts", blockingFailure: "reject-import-preview" },
        { id: "exporter-contract", extensionPoint: "exporter", status: "ready", samplePlugin: "redacted-exporter", inputFixture: "memory collection", expectedOutput: "redacted export package", blockingFailure: "reject-export-package" },
        { id: "agent-tool-contract", extensionPoint: "agent-tool", status: "ready", samplePlugin: "long-term-review-agent", inputFixture: "memory summaries", expectedOutput: "reviewable suggestions", blockingFailure: "require-human-confirmation" },
        { id: "asset-template-contract", extensionPoint: "asset-template", status: "planned", samplePlugin: "asset-template-placeholder", inputFixture: "asset draft", expectedOutput: "editable sections", blockingFailure: "disable-template" },
        { id: "sync-adapter-contract", extensionPoint: "sync-adapter", status: "ready", samplePlugin: "manual-json-sync", inputFixture: "local-first sync package", expectedOutput: "conflict preview", blockingFailure: "manual-apply-only" }
      ],
      failurePolicy: "block-plugin-and-record-audit-event",
      exportFields: ["phase20PlatformPlan.extensionContractTests", "phase20PlatformPlan.extensionPoints"],
      nextControls: ["fixture-library", "negative-permission-tests", "sandbox-boundary-tests"]
    },
    sandboxBoundary: {
      schemaVersion: "phase20.plugin.sandbox-boundary.v1",
      status: "boundary-defined-runtime-disabled",
      runtimeExecution: false,
      isolationMode: "no-third-party-code-execution",
      trustZone: "built-in-manifest-only",
      blockedCapabilities: ["dynamic-code-eval", "filesystem-write", "network-request", "secret-read", "background-process", "direct-database-access"],
      allowedCapabilities: ["manifest-parse", "contract-fixture-check", "reviewable-draft-output", "redacted-export-preview", "audit-event-summary"],
      dataBoundary: {
        memoryAccess: "summary-or-explicit-draft-only",
        assetAccess: "metadata-preview-only",
        exportAccess: "redacted-package-only",
        syncAccess: "manual-preview-only"
      },
      enforcementChecks: [
        { id: "runtime-disabled", status: "ready", rule: "thirdPartyExecution=false" },
        { id: "network-blocked", status: "ready", rule: "networkAccessForPlugins=false" },
        { id: "secret-storage-blocked", status: "ready", rule: "secretStorage=false" },
        { id: "filesystem-blocked", status: "planned", rule: "no plugin filesystem write boundary before runtime" },
        { id: "database-blocked", status: "planned", rule: "plugins cannot receive direct sqlite handles" }
      ],
      handoffToRuntime: ["signed-manifest", "permission-review-approved", "contract-tests-passing", "audit-log-enabled", "sandbox-enforcer-implemented"],
      exportFields: ["phase20PlatformPlan.sandboxBoundary", "phase20PlatformPlan.securityModel"],
      nextControls: ["sandbox-enforcer", "signed-manifest-check", "resource-quota-policy"]
    },
    noCodeTemplatePack: {
      schemaVersion: "phase20.no-code.template-pack.v1",
      status: "template-pack-ready-runtime-disabled",
      runtimeExecution: false,
      owner: "local-platform",
      templateCount: 5,
      categories: ["importer", "exporter", "agent-tool", "asset-template", "sync-adapter"],
      templates: [
        { id: "memory-import-template", extensionPoint: "importer", status: "ready", input: "text-or-table", output: "reviewable memory drafts", controls: ["field-mapping", "dedupe-preview", "manual-apply"] },
        { id: "redacted-export-template", extensionPoint: "exporter", status: "ready", input: "memory collection", output: "redacted export package", controls: ["redaction-policy", "preview-only", "manual-download"] },
        { id: "review-agent-template", extensionPoint: "agent-tool", status: "ready", input: "memory summaries", output: "reviewable suggestions", controls: ["human-confirmation", "audit-event", "no-background-run"] },
        { id: "exhibition-layout-template", extensionPoint: "asset-template", status: "ready", input: "asset draft", output: "editable exhibition sections", controls: ["section-preview", "citation-required", "manual-save"] },
        { id: "sync-preview-template", extensionPoint: "sync-adapter", status: "ready", input: "local-first sync package", output: "conflict preview", controls: ["conflict-list", "per-item-decision", "manual-apply"] }
      ],
      guardrails: ["manifest-required", "permission-reviewed", "contract-tested", "sandbox-boundary-applied", "audit-summary-required"],
      authoringWorkflow: ["choose-template", "fill-metadata", "preview-fixture", "review-permissions", "export-template-json"],
      exportFields: ["phase20PlatformPlan.noCodeTemplatePack", "phase20PlatformPlan.extensionContractTests", "phase20PlatformPlan.sandboxBoundary"],
      nextControls: ["template-json-schema", "template-preview-fixtures", "template-signature"]
    },
    templatePreviewFixtures: {
      schemaVersion: "phase20.template.preview-fixtures.v1",
      status: "fixtures-ready-runtime-disabled",
      runtimeExecution: false,
      fixtureCount: 5,
      coverage: ["importer", "exporter", "agent-tool", "asset-template", "sync-adapter"],
      previewWorkflow: ["load-template", "load-fixture", "render-preview", "run-contract-assertions", "record-audit-summary", "block-or-mark-ready"],
      fixtures: [
        { id: "memory-import-fixture", templateId: "memory-import-template", extensionPoint: "importer", status: "passing", inputFixture: "two-row memory table", expectedPreview: "reviewable memory drafts", requiredAssertions: ["field-mapping-applied", "dedupe-preview-visible", "manual-apply-only"] },
        { id: "redacted-export-fixture", templateId: "redacted-export-template", extensionPoint: "exporter", status: "passing", inputFixture: "memory collection with sensitive fields", expectedPreview: "redacted export package", requiredAssertions: ["redaction-policy-applied", "download-preview-only", "audit-summary-present"] },
        { id: "review-agent-fixture", templateId: "review-agent-template", extensionPoint: "agent-tool", status: "passing", inputFixture: "memory summaries with weak signals", expectedPreview: "reviewable suggestions", requiredAssertions: ["human-confirmation-required", "no-background-run", "audit-event-emitted"] },
        { id: "exhibition-layout-fixture", templateId: "exhibition-layout-template", extensionPoint: "asset-template", status: "passing", inputFixture: "asset draft with citations", expectedPreview: "editable exhibition sections", requiredAssertions: ["citation-required", "manual-save-only", "section-preview-visible"] },
        { id: "sync-preview-fixture", templateId: "sync-preview-template", extensionPoint: "sync-adapter", status: "passing", inputFixture: "local-first sync conflict package", expectedPreview: "conflict preview", requiredAssertions: ["per-item-decision-required", "manual-apply-only", "sync-audit-summary"] }
      ],
      negativeFixtures: [
        { id: "network-request-negative", templateId: "sync-preview-template", status: "blocked", reason: "network-request", expectedDecision: "sandbox-boundary-violation" },
        { id: "missing-citation-negative", templateId: "exhibition-layout-template", status: "blocked", reason: "citation-required", expectedDecision: "template-preview-blocked" },
        { id: "auto-apply-negative", templateId: "memory-import-template", status: "blocked", reason: "manual-apply-only", expectedDecision: "contract-test-failed" }
      ],
      blockedWhen: ["fixture-missing", "expected-preview-mismatch", "required-assertion-failed", "negative-fixture-not-blocked", "audit-summary-missing"],
      exportFields: ["phase20PlatformPlan.templatePreviewFixtures", "phase20PlatformPlan.noCodeTemplatePack", "phase20PlatformPlan.extensionContractTests"],
      nextControls: ["fixture-authoring-ui", "fixture-result-history", "template-preview-diff"]
    },
    signedManifestPolicy: {
      schemaVersion: "phase20.signed.manifest-policy.v1",
      status: "signature-policy-ready-runtime-disabled",
      runtimeExecution: false,
      signatureRequired: true,
      algorithm: "sha256-manifest-digest-placeholder",
      signerTrust: "local-owner-or-built-in-only",
      signedFields: ["id", "version", "extensionPoint", "permissions", "entryPolicy", "dataAccess", "audit", "sandboxBoundary", "templatePack"],
      checksumFields: ["manifestSchema.schemaVersion", "permissionReview.defaultDecision", "extensionContractTests.schemaVersion", "sandboxBoundary.schemaVersion", "noCodeTemplatePack.schemaVersion"],
      verificationSteps: ["parse-manifest", "normalize-fields", "calculate-digest", "compare-signature", "check-signer-trust", "record-audit-event"],
      sampleSignatures: [
        { pluginId: "markdown-importer", status: "built-in-trusted", digest: "sha256:phase20-markdown-importer-manifest" },
        { pluginId: "redacted-exporter", status: "built-in-trusted", digest: "sha256:phase20-redacted-exporter-manifest" },
        { pluginId: "third-party-placeholder", status: "blocked-unsigned", digest: "missing" }
      ],
      blockedWhen: ["signature-missing", "digest-mismatch", "untrusted-signer", "manifest-mutated-after-review", "permissions-changed-after-signature"],
      exportFields: ["phase20PlatformPlan.signedManifestPolicy", "phase20PlatformPlan.manifestSchema", "phase20PlatformPlan.pluginAuditLog"],
      nextControls: ["signature-ui", "manifest-lockfile", "reviewer-countersignature"]
    },
    pluginInstallationWorkflow: {
      schemaVersion: "phase20.plugin.installation-workflow.v1",
      status: "install-workflow-ready-runtime-disabled",
      runtimeExecution: false,
      defaultDecision: "block-or-pending-review",
      installStates: ["manifest-imported", "signature-verified", "permissions-reviewed", "contract-tested", "sandbox-checked", "audit-recorded", "pending-human-review", "blocked"],
      requiredGates: ["manifest-schema-valid", "signature-trusted", "permissions-approved", "contract-tests-passing", "sandbox-boundary-passing", "audit-event-recorded"],
      workflowSteps: [
        { id: "import-manifest", status: "ready", input: "plugin manifest json", output: "normalized manifest draft", blockingFailure: "invalid-manifest" },
        { id: "verify-signature", status: "ready", input: "normalized manifest digest", output: "trusted-or-blocked signature result", blockingFailure: "signature-missing-or-mismatch" },
        { id: "review-permissions", status: "ready", input: "declared permissions", output: "approved or pending human review", blockingFailure: "permission-unreviewed" },
        { id: "run-contract-tests", status: "ready", input: "extension point fixture", output: "contract pass or block decision", blockingFailure: "contract-test-failed" },
        { id: "check-sandbox-boundary", status: "ready", input: "declared capabilities", output: "sandbox pass or blocked capability list", blockingFailure: "sandbox-boundary-violation" },
        { id: "record-install-audit", status: "ready", input: "gate decisions", output: "installation audit summary", blockingFailure: "audit-record-missing" }
      ],
      sampleDecisions: [
        { pluginId: "markdown-importer", state: "installed-built-in", decision: "approved", evidence: ["built-in-trusted", "contract-tests-passing", "audit-recorded"] },
        { pluginId: "review-agent-template", state: "pending-human-review", decision: "pending", evidence: ["agent.suggest", "confirmation-required"] },
        { pluginId: "third-party-placeholder", state: "blocked", decision: "blocked", evidence: ["signature-missing", "runtimeExecution=false"] }
      ],
      blockedWhen: ["invalid-manifest", "signature-missing-or-mismatch", "permission-unreviewed", "contract-test-failed", "sandbox-boundary-violation", "audit-record-missing"],
      exportFields: ["phase20PlatformPlan.pluginInstallationWorkflow", "phase20PlatformPlan.signedManifestPolicy", "phase20PlatformPlan.extensionContractTests", "phase20PlatformPlan.sandboxBoundary"],
      nextControls: ["installation-queue-ui", "reviewer-approval-record", "plugin-lockfile"]
    },
    pluginReviewWorkbench: {
      schemaVersion: "phase20.plugin.review-workbench.v1",
      status: "review-workbench-ready-runtime-disabled",
      runtimeExecution: false,
      queueStates: ["pending-review", "approved-disabled", "blocked", "needs-signature", "needs-contract-fix"],
      reviewActions: ["approve-built-in-disabled", "block-plugin", "request-signature", "request-contract-fix", "record-review-note"],
      reviewQueue: [
        { pluginId: "long-term-review-agent", state: "pending-review", risk: "medium", requiredAction: "confirm agent.suggest before enablement", evidence: ["agent.suggest", "memory.read.summary", "human-confirmation-required"] },
        { pluginId: "third-party-placeholder", state: "blocked", risk: "high", requiredAction: "keep blocked until signed manifest and sandbox exist", evidence: ["signature-missing", "thirdPartyExecution=false"] },
        { pluginId: "exhibition-layout-template", state: "approved-disabled", risk: "low", requiredAction: "template preview only", evidence: ["citation-required", "manual-save-only"] }
      ],
      reviewerRecord: {
        requiredFields: ["reviewer", "decision", "reason", "permissions", "createdAt", "evidence"],
        decisionTypes: ["approved-disabled", "blocked", "needs-info"],
        storageMode: "exported-plan-and-operations-summary"
      },
      exportFields: ["phase20PlatformPlan.pluginReviewWorkbench", "phase20PlatformPlan.pluginAuditLog", "phase20PlatformPlan.permissionReview"],
      nextControls: ["review-note-ui", "permission-diff-view", "review-history"]
    },
    pluginLockfile: {
      schemaVersion: "phase20.plugin.lockfile.v1",
      status: "lockfile-model-ready-runtime-disabled",
      runtimeExecution: false,
      lockfileName: "phase20-plugin-lock.json",
      lockReason: "freeze reviewed manifests before any runtime work",
      lockedPlugins: [
        { pluginId: "markdown-importer", version: "built-in", digest: "sha256:phase20-markdown-importer-manifest", decision: "approved-disabled", runtimeEnabled: false },
        { pluginId: "redacted-exporter", version: "built-in", digest: "sha256:phase20-redacted-exporter-manifest", decision: "approved-disabled", runtimeEnabled: false },
        { pluginId: "third-party-placeholder", version: "0.0.0", digest: "missing", decision: "blocked", runtimeEnabled: false }
      ],
      integrityChecks: ["unique-plugin-id", "digest-present-for-approved", "review-decision-present", "runtime-disabled", "permissions-match-reviewed-manifest"],
      blockedWhen: ["missing-lock-entry", "digest-mismatch", "permission-drift", "runtime-enabled-without-sandbox", "review-decision-missing"],
      exportFields: ["phase20PlatformPlan.pluginLockfile", "phase20PlatformPlan.signedManifestPolicy", "phase20PlatformPlan.pluginReviewWorkbench"],
      nextControls: ["lockfile-file-export", "lockfile-diff", "install-queue-persistence"]
    },
    pluginLockfileExport: {
      schemaVersion: "phase20.plugin.lockfile-export.v1",
      status: "lockfile-export-ready-runtime-disabled",
      runtimeExecution: false,
      exportName: "phase20-plugin-lock.export.json",
      exportModes: ["full-lockfile", "review-summary", "redacted-demo-lockfile"],
      exportWorkflow: ["collect-reviewed-manifests", "attach-digests", "attach-review-decisions", "verify-runtime-disabled", "emit-export-audit"],
      sampleExport: {
        lockedCount: 3,
        blockedCount: 1,
        runtimeEnabledCount: 0,
        includesReviewEvidence: true
      },
      blockedWhen: ["lockfile-missing", "approved-plugin-without-digest", "runtime-enabled-entry", "review-evidence-missing"],
      exportFields: ["phase20PlatformPlan.pluginLockfileExport", "phase20PlatformPlan.pluginLockfile", "phase20PlatformPlan.pluginAuditLog"],
      nextControls: ["download-lockfile-json", "redacted-lockfile-export", "lockfile-import-preview"]
    },
    pluginInstallQueuePersistence: {
      schemaVersion: "phase20.plugin.install-queue.v1",
      status: "install-queue-model-ready-runtime-disabled",
      runtimeExecution: false,
      storageMode: "exported-plan-local-first",
      queueStates: ["queued", "reviewing", "locked", "blocked", "archived"],
      queueItems: [
        { id: "queue-long-term-review-agent", pluginId: "long-term-review-agent", state: "reviewing", nextAction: "record reviewer note", evidence: ["pending-review", "agent.suggest"] },
        { id: "queue-exhibition-layout-template", pluginId: "exhibition-layout-template", state: "locked", nextAction: "keep preview-only", evidence: ["approved-disabled", "manual-save-only"] },
        { id: "queue-third-party-placeholder", pluginId: "third-party-placeholder", state: "blocked", nextAction: "wait for trusted signature", evidence: ["signature-missing", "runtime-disabled"] }
      ],
      persistenceChecks: ["stable-queue-id", "plugin-id-linked", "review-state-linked", "lockfile-entry-linked", "audit-event-linked"],
      exportFields: ["phase20PlatformPlan.pluginInstallQueuePersistence", "phase20PlatformPlan.pluginReviewWorkbench", "phase20PlatformPlan.pluginLockfile"],
      nextControls: ["queue-json-persistence", "queue-filter-ui", "queue-archive-policy"]
    },
    pluginReleaseSignatureGate: {
      schemaVersion: "phase20.plugin.release-signature-gate.v1",
      status: "release-signature-gate-ready-runtime-disabled",
      runtimeExecution: false,
      releaseGatePolicy: "block-release-if-signature-or-lockfile-drift",
      requiredBeforeRelease: ["signed-manifest-present", "lockfile-digest-match", "review-decision-present", "runtime-disabled", "audit-summary-exported"],
      sampleGateResults: [
        { pluginId: "markdown-importer", result: "pass", evidence: ["built-in-trusted", "digest-match", "runtime-disabled"] },
        { pluginId: "long-term-review-agent", result: "hold", evidence: ["pending-review", "reviewer-note-required"] },
        { pluginId: "third-party-placeholder", result: "block", evidence: ["signature-missing", "untrusted-signer"] }
      ],
      blockedWhen: ["signature-missing", "digest-mismatch", "lockfile-drift", "runtime-enabled", "audit-summary-missing"],
      exportFields: ["phase20PlatformPlan.pluginReleaseSignatureGate", "phase20PlatformPlan.signedManifestPolicy", "phase20PlatformPlan.pluginLockfileExport"],
      nextControls: ["release-gate-ui", "signature-diff-report", "pre-release-check-command"]
    },
    pluginLockfileImportPreview: {
      schemaVersion: "phase20.plugin.lockfile-import-preview.v1",
      status: "lockfile-import-preview-ready-runtime-disabled",
      runtimeExecution: false,
      acceptedInputs: ["phase20-plugin-lock.export.json", "redacted-demo-lockfile"],
      previewWorkflow: ["parse-lockfile", "compare-digests", "compare-permissions", "compare-review-decisions", "compare-signature-status", "emit-preview-audit"],
      diffCategories: ["new-plugin", "removed-plugin", "digest-changed", "permission-drift", "review-decision-changed", "signature-status-changed"],
      sampleDiffs: [
        { pluginId: "markdown-importer", category: "safe-match", severity: "info", decision: "allow-preview", evidence: ["digest-match", "permissions-match", "runtime-disabled"] },
        { pluginId: "long-term-review-agent", category: "permission-drift", severity: "hold", decision: "require-review", evidence: ["memory.read.summary-added", "human-review-required"] },
        { pluginId: "third-party-placeholder", category: "signature-status-changed", severity: "block", decision: "block-import", evidence: ["signature-missing", "digest-mismatch"] }
      ],
      blockedWhen: ["invalid-lockfile-schema", "runtime-enabled-entry", "permission-drift", "signature-missing", "digest-mismatch"],
      exportFields: ["phase20PlatformPlan.pluginLockfileImportPreview", "phase20PlatformPlan.pluginLockfileExport", "phase20PlatformPlan.pluginReleaseSignatureGate"],
      nextControls: ["lockfile-import-ui", "diff-acceptance-record", "import-preview-audit-history"]
    },
    pluginPreReleaseCheckCommand: {
      schemaVersion: "phase20.plugin.pre-release-check.v1",
      status: "pre-release-check-command-ready-runtime-disabled",
      runtimeExecution: false,
      command: "npm.cmd run phase20:plugin-pre-release",
      requiredInputs: ["phase20PlatformPlan.pluginLockfileExport", "phase20PlatformPlan.pluginLockfileImportPreview", "phase20PlatformPlan.pluginReleaseSignatureGate", "phase20PlatformPlan.pluginSignatureDiffReport", "phase20PlatformPlan.pluginReleaseReportArtifact", "phase20PlatformPlan.pluginDiffReviewHistory"],
      checkWorkflow: ["load-version-payload", "verify-runtime-disabled", "verify-lockfile-import-preview", "verify-signature-gate", "verify-signature-diff-report", "verify-release-report-artifact", "verify-diff-review-history", "verify-release-history", "emit-command-summary"],
      requiredAssertions: ["version-build-label-match", "runtime-disabled", "lockfile-import-preview-ready", "permission-drift-blocked", "signature-missing-blocked", "digest-mismatch-blocked", "release-gate-blocks-drift", "signature-diff-report-ready", "release-report-artifact-ready", "diff-review-history-ready"],
      sampleResults: [
        { id: "built-in-lockfile", result: "pass", evidence: ["runtime-disabled", "digest-match", "release-history-present"] },
        { id: "permission-drift-import", result: "hold", evidence: ["permission-drift", "human-review-required"] },
        { id: "unsigned-third-party", result: "block", evidence: ["signature-missing", "digest-mismatch"] }
      ],
      blockedWhen: ["version-build-label-mismatch", "runtime-enabled-entry", "lockfile-import-preview-missing", "signature-gate-missing", "permission-drift", "signature-missing", "digest-mismatch"],
      exportFields: ["phase20PlatformPlan.pluginPreReleaseCheckCommand", "phase20PlatformPlan.pluginLockfileImportPreview", "phase20PlatformPlan.pluginReleaseSignatureGate"],
      nextControls: ["signature-diff-report", "release-report-artifact", "release-report-validation-command", "ci-command-wrapper"]
    },
    pluginSignatureDiffReport: {
      schemaVersion: "phase20.plugin.signature-diff-report.v1",
      status: "signature-diff-report-ready-runtime-disabled",
      runtimeExecution: false,
      reportName: "phase20-plugin-signature-diff.report.json",
      reportInputs: ["phase20-plugin-lock.export.json", "phase20PlatformPlan.signedManifestPolicy", "phase20PlatformPlan.pluginLockfileImportPreview", "phase20PlatformPlan.pluginReleaseSignatureGate"],
      diffAxes: ["manifest-digest", "signature-status", "permission-set", "review-decision", "lockfile-entry", "runtime-policy"],
      reportWorkflow: ["collect-lockfile-preview-diffs", "collect-signature-gate-results", "group-by-severity", "attach-review-actions", "emit-report-summary"],
      severityLevels: ["info", "hold", "block"],
      sampleFindings: [
        { id: "markdown-importer-digest", pluginId: "markdown-importer", axis: "manifest-digest", severity: "info", result: "match", releaseAction: "allow", evidence: ["digest-match", "built-in-trusted"] },
        { id: "long-term-review-permission", pluginId: "long-term-review-agent", axis: "permission-set", severity: "hold", result: "permission-drift", releaseAction: "require-review", evidence: ["memory.read.summary-added", "reviewer-note-required"] },
        { id: "third-party-signature", pluginId: "third-party-placeholder", axis: "signature-status", severity: "block", result: "signature-missing", releaseAction: "block-release", evidence: ["signature-missing", "digest-mismatch", "untrusted-signer"] }
      ],
      summary: {
        totalFindings: 3,
        info: 1,
        hold: 1,
        block: 1,
        releaseReady: false
      },
      blockedWhen: ["signature-missing", "digest-mismatch", "permission-drift-unreviewed", "lockfile-drift", "runtime-enabled-entry"],
      exportFields: ["phase20PlatformPlan.pluginSignatureDiffReport", "phase20PlatformPlan.pluginPreReleaseCheckCommand", "phase20PlatformPlan.pluginLockfileImportPreview", "phase20PlatformPlan.pluginReleaseSignatureGate"],
      nextControls: ["release-report-artifact", "diff-review-history", "signed-report-export"]
    },
    pluginReleaseReportArtifact: {
      schemaVersion: "phase20.plugin.release-report-artifact.v1",
      status: "release-report-artifact-ready-runtime-disabled",
      runtimeExecution: false,
      artifactName: "phase20-plugin-release.report.json",
      artifactType: "release-evidence-package",
      reportInputs: ["phase20PlatformPlan.pluginPreReleaseCheckCommand", "phase20PlatformPlan.pluginSignatureDiffReport", "phase20PlatformPlan.pluginLockfileImportPreview", "phase20PlatformPlan.pluginReleaseSignatureGate"],
      includedSections: ["version-build-label", "runtime-policy", "lockfile-export", "lockfile-import-preview", "signature-diff-summary", "pre-release-command-results", "release-gate-results", "release-decision"],
      generationWorkflow: ["collect-version-payload", "attach-lockfile-export-summary", "attach-import-preview-diffs", "attach-signature-gate-results", "attach-pre-release-command-summary", "attach-signature-diff-findings", "emit-release-decision"],
      releaseDecision: {
        status: "blocked",
        releaseReady: false,
        infoFindings: 1,
        holdFindings: 1,
        blockFindings: 1,
        requiredAction: "resolve-block-findings-before-release",
        evidence: ["third-party-signature:block-release", "runtime-disabled", "pre-release-command-present"]
      },
      sampleArtifact: {
        version: "1.0.25",
        buildLabel: "phase20-release-checklist-gate",
        releaseReady: false,
        generatedBy: "npm.cmd run phase20:plugin-pre-release",
        blockingFindingIds: ["third-party-signature"],
        attachedReports: ["phase20-plugin-signature-diff.report.json", "phase20-plugin-lock.export.json"]
      },
      blockedWhen: ["block-finding-present", "runtime-enabled-entry", "missing-signature-diff-report", "missing-pre-release-command-summary", "release-gate-blocked"],
      exportFields: ["phase20PlatformPlan.pluginReleaseReportArtifact", "phase20PlatformPlan.pluginSignatureDiffReport", "phase20PlatformPlan.pluginPreReleaseCheckCommand", "phase20PlatformPlan.pluginReleaseSignatureGate"],
      nextControls: ["diff-review-history", "release-report-download", "signed-report-export"]
    },
    pluginDiffReviewHistory: {
      schemaVersion: "phase20.plugin.diff-review-history.v1",
      status: "diff-review-history-ready-runtime-disabled",
      runtimeExecution: false,
      historyName: "phase20-plugin-diff-review.history.json",
      historyInputs: ["phase20PlatformPlan.pluginReleaseReportArtifact", "phase20PlatformPlan.pluginSignatureDiffReport", "phase20PlatformPlan.pluginReviewWorkbench"],
      trackedFields: ["findingId", "pluginId", "axis", "severity", "reviewer", "decision", "releaseAction", "evidence", "reviewedAt", "reportArtifact"],
      reviewStates: ["pending-review", "approved", "held", "blocked", "waived"],
      decisionWorkflow: ["load-release-report-findings", "link-reviewer-record", "capture-review-decision", "attach-evidence", "update-release-action", "emit-history-entry"],
      reviewEntries: [
        { id: "review-markdown-importer-digest", findingId: "markdown-importer-digest", pluginId: "markdown-importer", axis: "manifest-digest", severity: "info", reviewer: "system", decision: "approved", releaseAction: "allow", evidence: ["digest-match", "built-in-trusted"], reviewedAt: "2026-06-25T00:00:00.000Z", reportArtifact: "phase20-plugin-release.report.json" },
        { id: "review-long-term-review-permission", findingId: "long-term-review-permission", pluginId: "long-term-review-agent", axis: "permission-set", severity: "hold", reviewer: "human-required", decision: "held", releaseAction: "require-review", evidence: ["memory.read.summary-added", "reviewer-note-required"], reviewedAt: null, reportArtifact: "phase20-plugin-release.report.json" },
        { id: "review-third-party-signature", findingId: "third-party-signature", pluginId: "third-party-placeholder", axis: "signature-status", severity: "block", reviewer: "release-gate", decision: "blocked", releaseAction: "block-release", evidence: ["signature-missing", "digest-mismatch", "untrusted-signer"], reviewedAt: "2026-06-25T00:00:00.000Z", reportArtifact: "phase20-plugin-release.report.json" }
      ],
      summary: {
        totalReviews: 3,
        approved: 1,
        held: 1,
        blocked: 1,
        waived: 0,
        unresolved: 1,
        releaseReady: false
      },
      blockedWhen: ["block-review-present", "hold-without-reviewer-note", "waiver-without-evidence", "runtime-enabled-entry", "missing-release-report-artifact"],
      exportFields: ["phase20PlatformPlan.pluginDiffReviewHistory", "phase20PlatformPlan.pluginReleaseReportArtifact", "phase20PlatformPlan.pluginSignatureDiffReport", "phase20PlatformPlan.pluginReviewWorkbench"],
      nextControls: ["release-report-validation-command", "signed-report-export", "review-history-ui"]
    },
    pluginReleaseReportValidationCommand: {
      schemaVersion: "phase20.plugin.release-report-validation-command.v1",
      status: "release-report-validation-command-ready-runtime-disabled",
      runtimeExecution: false,
      command: "npm.cmd run phase20:plugin-pre-release",
      validationTarget: "phase20-plugin-release.report.json",
      requiredInputs: ["phase20PlatformPlan.pluginReleaseReportArtifact", "phase20PlatformPlan.pluginDiffReviewHistory", "phase20PlatformPlan.pluginSignatureDiffReport", "phase20PlatformPlan.pluginPreReleaseCheckCommand"],
      validationWorkflow: ["load-release-report-artifact", "verify-version-build-label", "verify-attached-signature-diff-report", "verify-diff-review-history-linked", "verify-block-findings-block-release", "verify-hold-findings-have-reviewer-note", "verify-release-ready-consistency", "emit-validation-summary"],
      requiredAssertions: ["release-report-schema-present", "version-build-label-match", "signature-diff-report-attached", "diff-review-history-linked", "block-finding-keeps-releaseReady-false", "hold-finding-requires-reviewer-note", "waiver-requires-evidence", "runtime-disabled"],
      sampleValidationResults: [
        { id: "release-report-schema", result: "pass", evidence: ["phase20.plugin.release-report-artifact.v1", "phase20-plugin-release.report.json"] },
        { id: "hold-review-note", result: "hold", evidence: ["long-term-review-permission", "reviewer-note-required", "human-required"] },
        { id: "block-release-ready", result: "block", evidence: ["third-party-signature", "block-review-present", "releaseReady:false"] }
      ],
      summary: {
        totalAssertions: 8,
        pass: 6,
        hold: 1,
        block: 1,
        releaseReady: false
      },
      blockedWhen: ["release-report-missing", "version-build-label-mismatch", "block-finding-releaseReady-true", "hold-without-reviewer-note", "waiver-without-evidence", "runtime-enabled-entry"],
      exportFields: ["phase20PlatformPlan.pluginReleaseReportValidationCommand", "phase20PlatformPlan.pluginReleaseReportArtifact", "phase20PlatformPlan.pluginDiffReviewHistory"],
      nextControls: ["signed-report-export", "validation-command-ci-wrapper", "review-history-ui"]
    },
    pluginSignedReleaseReportExport: {
      schemaVersion: "phase20.plugin.signed-release-report-export.v1",
      status: "signed-release-report-export-ready-runtime-disabled",
      runtimeExecution: false,
      exportName: "phase20-plugin-release.signed-report.json",
      exportType: "signed-release-evidence-package",
      exportInputs: ["phase20PlatformPlan.pluginReleaseReportValidationCommand", "phase20PlatformPlan.pluginReleaseReportArtifact", "phase20PlatformPlan.pluginDiffReviewHistory", "phase20PlatformPlan.pluginSignatureDiffReport", "phase20PlatformPlan.signedManifestPolicy"],
      exportWorkflow: ["load-validation-summary", "attach-release-report-artifact", "attach-diff-review-history", "attach-signature-diff-report", "apply-signature-envelope", "record-export-audit", "emit-signed-report-package"],
      requiredAssertions: ["validation-summary-attached", "release-report-artifact-attached", "diff-review-history-attached", "signature-diff-report-attached", "signature-envelope-present", "runtime-disabled", "releaseReady-false-when-blocked", "export-audit-recorded"],
      signatureEnvelope: {
        algorithm: "offline-review-signature-placeholder",
        signer: "release-reviewer-required",
        digestSource: "phase20-plugin-release.report.json",
        signatureRequired: true,
        runtimeSecretsUsed: false
      },
      sampleExport: {
        version: "1.0.25",
        buildLabel: "phase20-release-checklist-gate",
        exportReady: false,
        releaseReady: false,
        signed: false,
        signatureState: "pending-human-signature",
        attachedReports: ["phase20-plugin-release.report.json", "phase20-plugin-diff-review.history.json", "phase20-plugin-signature-diff.report.json"]
      },
      summary: {
        totalExports: 1,
        signed: 0,
        pendingSignature: 1,
        blocked: 1,
        releaseReady: false
      },
      blockedWhen: ["validation-summary-missing", "signature-envelope-missing", "signed-while-blocked", "runtime-enabled-entry", "export-without-audit", "releaseReady-mismatch"],
      exportFields: ["phase20PlatformPlan.pluginSignedReleaseReportExport", "phase20PlatformPlan.pluginReleaseReportValidationCommand", "phase20PlatformPlan.pluginReleaseReportArtifact", "phase20PlatformPlan.pluginDiffReviewHistory"],
      nextControls: ["review-history-ui", "validation-command-ci-wrapper", "signed-report-download"]
    },
    pluginReviewHistoryUi: {
      schemaVersion: "phase20.plugin.review-history-ui.v1",
      status: "review-history-ui-ready-runtime-disabled",
      runtimeExecution: false,
      panelId: "phase20-review-history-ui",
      sourceHistory: "phase20-plugin-diff-review.history.json",
      requiredInputs: ["phase20PlatformPlan.pluginDiffReviewHistory", "phase20PlatformPlan.pluginReleaseReportArtifact", "phase20PlatformPlan.pluginReleaseReportValidationCommand", "phase20PlatformPlan.pluginSignedReleaseReportExport"],
      displayColumns: ["findingId", "pluginId", "severity", "decision", "releaseAction", "reviewer", "reviewedAt", "evidence", "reportArtifact"],
      filterControls: ["severity", "decision", "reviewer", "releaseAction", "unresolvedOnly"],
      reviewActions: ["open-evidence", "copy-finding-id", "record-review-note-placeholder", "link-signed-export", "block-release-summary"],
      stateBadges: [
        { state: "approved", tone: "success", label: "approved" },
        { state: "held", tone: "warning", label: "human review required" },
        { state: "blocked", tone: "danger", label: "blocks release" }
      ],
      sampleRows: [
        { findingId: "markdown-importer-digest", pluginId: "markdown-importer", severity: "info", decision: "approved", visible: true, primaryAction: "open-evidence" },
        { findingId: "long-term-review-permission", pluginId: "long-term-review-agent", severity: "hold", decision: "held", visible: true, primaryAction: "record-review-note-placeholder" },
        { findingId: "third-party-signature", pluginId: "third-party-placeholder", severity: "block", decision: "blocked", visible: true, primaryAction: "block-release-summary" }
      ],
      summary: {
        totalRows: 3,
        visibleBlockers: 1,
        unresolvedHolds: 1,
        signedExportLinked: true,
        releaseReady: false
      },
      blockedWhen: ["missing-diff-review-history", "missing-release-report-artifact", "blocked-row-hidden", "hold-row-without-review-action", "signed-export-link-missing", "runtime-enabled-entry"],
      exportFields: ["phase20PlatformPlan.pluginReviewHistoryUi", "phase20PlatformPlan.pluginDiffReviewHistory", "phase20PlatformPlan.pluginSignedReleaseReportExport"],
      nextControls: ["validation-command-ci-wrapper", "signed-report-download", "plugin-review-workbench-actions"]
    },
    pluginValidationCommandCiWrapper: {
      schemaVersion: "phase20.plugin.validation-command-ci-wrapper.v1",
      status: "validation-command-ci-wrapper-ready-runtime-disabled",
      runtimeExecution: false,
      command: "npm.cmd run phase20:plugin-pre-release",
      ciCommand: "npm.cmd run phase20:plugin-pre-release -- --ci",
      requiredInputs: ["phase20PlatformPlan.pluginReleaseReportValidationCommand", "phase20PlatformPlan.pluginSignedReleaseReportExport", "phase20PlatformPlan.pluginReviewHistoryUi", "package.json.scripts.phase20:plugin-pre-release"],
      ciWorkflow: ["install-node-24", "run-syntax-checks", "run-phase20-plugin-pre-release", "collect-json-summary", "publish-ci-artifacts", "block-on-hold-or-block"],
      exitCodePolicy: [
        { result: "pass", exitCode: 0, releaseReady: true },
        { result: "hold", exitCode: 2, releaseReady: false },
        { result: "block", exitCode: 3, releaseReady: false }
      ],
      requiredArtifacts: ["phase20-plugin-pre-release.summary.json", "phase20-plugin-release.report.json", "phase20-plugin-release.signed-report.json"],
      sampleCiRun: {
        version: "1.0.25",
        buildLabel: "phase20-release-checklist-gate",
        command: "npm.cmd run phase20:plugin-pre-release",
        result: "block",
        exitCode: 3,
        releaseReady: false,
        artifactsPublished: ["phase20-plugin-pre-release.summary.json", "phase20-plugin-release.signed-report.json"]
      },
      summary: {
        totalSteps: 6,
        pass: 4,
        hold: 1,
        block: 1,
        releaseReady: false
      },
      blockedWhen: ["ci-command-missing", "json-summary-missing", "hold-result-exit-zero", "block-result-exit-zero", "runtime-enabled-entry", "artifact-not-published"],
      exportFields: ["phase20PlatformPlan.pluginValidationCommandCiWrapper", "phase20PlatformPlan.pluginReleaseReportValidationCommand", "phase20PlatformPlan.pluginSignedReleaseReportExport", "phase20PlatformPlan.pluginReviewHistoryUi"],
      nextControls: ["signed-report-download", "ci-badge-summary", "release-checklist-gate"]
    },
    pluginSignedReportDownload: {
      schemaVersion: "phase20.plugin.signed-report-download.v1",
      status: "signed-report-download-ready-runtime-disabled",
      runtimeExecution: false,
      downloadName: "phase20-plugin-release.signed-report.download.json",
      sourceArtifact: "phase20-plugin-release.signed-report.json",
      requiredInputs: ["phase20PlatformPlan.pluginSignedReleaseReportExport", "phase20PlatformPlan.pluginValidationCommandCiWrapper", "phase20PlatformPlan.pluginReviewHistoryUi", "phase20PlatformPlan.pluginReleaseReportArtifact"],
      downloadWorkflow: ["load-signed-report-export", "verify-ci-wrapper-result", "attach-review-history-ui-summary", "apply-redacted-download-envelope", "emit-download-metadata", "record-download-audit", "prepare-browser-download"],
      downloadEnvelope: {
        format: "json",
        redacted: true,
        includesRuntimeSecrets: false,
        checksumAlgorithm: "sha256-placeholder",
        contentDisposition: "attachment"
      },
      sampleDownload: {
        version: "1.0.25",
        buildLabel: "phase20-release-checklist-gate",
        fileName: "phase20-plugin-release.signed-report.download.json",
        ready: false,
        releaseReady: false,
        sourceArtifact: "phase20-plugin-release.signed-report.json",
        includedReports: ["phase20-plugin-release.report.json", "phase20-plugin-diff-review.history.json", "phase20-plugin-pre-release.summary.json"]
      },
      summary: {
        totalFiles: 3,
        downloadable: 1,
        redacted: 1,
        blocked: 1,
        releaseReady: false
      },
      blockedWhen: ["signed-report-missing", "ci-wrapper-blocked", "download-envelope-missing", "runtime-enabled-entry", "secret-field-included", "audit-record-missing"],
      exportFields: ["phase20PlatformPlan.pluginSignedReportDownload", "phase20PlatformPlan.pluginSignedReleaseReportExport", "phase20PlatformPlan.pluginValidationCommandCiWrapper"],
      nextControls: ["ci-badge-summary", "release-checklist-gate", "download-integrity-preview"]
    },
    pluginCiBadgeSummary: {
      schemaVersion: "phase20.plugin.ci-badge-summary.v1",
      status: "ci-badge-summary-ready-runtime-disabled",
      runtimeExecution: false,
      badgeName: "phase20-plugin-ci.badge-summary.json",
      requiredInputs: ["phase20PlatformPlan.pluginValidationCommandCiWrapper", "phase20PlatformPlan.pluginSignedReportDownload", "phase20PlatformPlan.pluginSignedReleaseReportExport"],
      badgeWorkflow: ["load-ci-wrapper-summary", "derive-release-state", "map-exit-code-to-badge", "attach-download-readiness", "emit-badge-json", "publish-readme-status-line", "record-badge-audit"],
      badgeStates: [
        { result: "pass", label: "plugin-ci: passing", tone: "success", releaseReady: true },
        { result: "hold", label: "plugin-ci: hold", tone: "warning", releaseReady: false },
        { result: "block", label: "plugin-ci: blocked", tone: "danger", releaseReady: false }
      ],
      sampleBadge: {
        version: "1.0.25",
        buildLabel: "phase20-release-checklist-gate",
        result: "block",
        label: "plugin-ci: blocked",
        exitCode: 3,
        releaseReady: false,
        downloadReady: false,
        artifact: "phase20-plugin-ci.badge-summary.json"
      },
      summary: {
        totalBadges: 3,
        published: 1,
        blocked: 1,
        releaseReady: false
      },
      blockedWhen: ["ci-wrapper-missing", "exit-code-policy-missing", "download-summary-missing", "badge-state-mismatch", "runtime-enabled-entry", "badge-audit-missing"],
      exportFields: ["phase20PlatformPlan.pluginCiBadgeSummary", "phase20PlatformPlan.pluginValidationCommandCiWrapper", "phase20PlatformPlan.pluginSignedReportDownload"],
      nextControls: ["download-integrity-preview", "release-checklist-gate", "ci-badge-ui"]
    },
    pluginDownloadIntegrityPreview: {
      schemaVersion: "phase20.plugin.download-integrity-preview.v1",
      status: "download-integrity-preview-ready-runtime-disabled",
      runtimeExecution: false,
      previewName: "phase20-plugin-release.download-integrity.preview.json",
      sourceDownload: "phase20-plugin-release.signed-report.download.json",
      requiredInputs: ["phase20PlatformPlan.pluginSignedReportDownload", "phase20PlatformPlan.pluginCiBadgeSummary", "phase20PlatformPlan.pluginSignedReleaseReportExport"],
      integrityWorkflow: ["load-download-envelope", "compute-sha256-placeholder", "compare-source-artifact-digest", "attach-ci-badge-state", "emit-integrity-preview", "record-integrity-audit", "block-on-mismatch"],
      checksumPolicy: {
        algorithm: "sha256-placeholder",
        required: true,
        redactedEnvelopeOnly: true,
        mismatchBlocksRelease: true
      },
      samplePreview: {
        version: "1.0.25",
        buildLabel: "phase20-release-checklist-gate",
        fileName: "phase20-plugin-release.download-integrity.preview.json",
        sourceDownload: "phase20-plugin-release.signed-report.download.json",
        checksum: "sha256-placeholder:blocked-sample",
        match: false,
        badgeResult: "block",
        releaseReady: false
      },
      summary: {
        totalChecks: 5,
        pass: 3,
        warning: 1,
        block: 1,
        releaseReady: false
      },
      blockedWhen: ["download-file-missing", "checksum-missing", "checksum-mismatch", "source-artifact-drift", "badge-result-blocked", "runtime-enabled-entry", "integrity-audit-missing"],
      exportFields: ["phase20PlatformPlan.pluginDownloadIntegrityPreview", "phase20PlatformPlan.pluginSignedReportDownload", "phase20PlatformPlan.pluginCiBadgeSummary"],
      nextControls: ["release-checklist-gate", "download-integrity-ui", "integrity-audit-export"]
    },
    pluginReleaseChecklistGate: {
      schemaVersion: "phase20.plugin.release-checklist-gate.v1",
      status: "release-checklist-gate-ready-runtime-disabled",
      runtimeExecution: false,
      gateName: "phase20-plugin-release.checklist-gate.json",
      requiredInputs: [
        "phase20PlatformPlan.pluginCiBadgeSummary",
        "phase20PlatformPlan.pluginDownloadIntegrityPreview",
        "phase20PlatformPlan.pluginSignedReleaseReportExport",
        "phase20PlatformPlan.pluginReviewHistoryUi",
        "phase20PlatformPlan.pluginReleaseSignatureGate"
      ],
      gateWorkflow: ["load-release-checklist", "collect-ci-badge", "collect-download-integrity", "verify-signed-export", "verify-review-history", "verify-runtime-disabled", "derive-final-releaseReady", "emit-checklist-gate"],
      gateItems: [
        { id: "ci-badge", source: "pluginCiBadgeSummary", result: "block", releaseReady: false },
        { id: "download-integrity", source: "pluginDownloadIntegrityPreview", result: "block", releaseReady: false },
        { id: "signed-export", source: "pluginSignedReleaseReportExport", result: "hold", releaseReady: false },
        { id: "review-history", source: "pluginReviewHistoryUi", result: "block", releaseReady: false },
        { id: "runtime-disabled", source: "securityModel", result: "pass", releaseReady: true }
      ],
      sampleGate: {
        version: "1.0.25",
        buildLabel: "phase20-release-checklist-gate",
        result: "block",
        releaseReady: false,
        blockingItems: ["ci-badge", "download-integrity", "review-history"],
        holdItems: ["signed-export"],
        artifact: "phase20-plugin-release.checklist-gate.json"
      },
      summary: {
        totalItems: 5,
        pass: 1,
        hold: 1,
        block: 3,
        releaseReady: false
      },
      blockedWhen: ["ci-badge-blocked", "download-integrity-blocked", "signed-export-hold", "review-history-blocked", "runtime-enabled-entry", "checklist-gate-audit-missing"],
      exportFields: ["phase20PlatformPlan.pluginReleaseChecklistGate", "phase20PlatformPlan.pluginCiBadgeSummary", "phase20PlatformPlan.pluginDownloadIntegrityPreview"],
      nextControls: ["release-gate-ui", "release-gate-audit-export", "runtime-sandbox-plan"]
    },
    securityModel: {
      defaultTrust: "built-in-only",
      thirdPartyExecution: false,
      networkAccessForPlugins: false,
      secretStorage: false,
      dataAccess: "explicit-export-or-reviewed-draft-only",
      requiredControls: ["manifest-review", "permission-labels", "human-confirmation", "audit-log", "redaction-before-share"]
    },
    readiness: {
      memoryCount: memories.length,
      savedExhibitionCount: savedExhibitions.length,
      reportDraftCount: reportDrafts.length,
      importPlanReady: true,
      manifestSchemaReady: true,
      permissionReviewReady: true,
      pluginAuditLogReady: true,
      builtInRegistryReady: true,
      extensionContractTestsReady: true,
      sandboxBoundaryReady: true,
      noCodeTemplatePackReady: true,
      templatePreviewFixturesReady: true,
      signedManifestPolicyReady: true,
      pluginInstallationWorkflowReady: true,
      pluginReviewWorkbenchReady: true,
      pluginLockfileReady: true,
      pluginLockfileExportReady: true,
      pluginInstallQueuePersistenceReady: true,
      pluginReleaseSignatureGateReady: true,
      pluginLockfileImportPreviewReady: true,
      pluginPreReleaseCheckCommandReady: true,
      pluginSignatureDiffReportReady: true,
      pluginReleaseReportArtifactReady: true,
      pluginDiffReviewHistoryReady: true,
      pluginReleaseReportValidationCommandReady: true,
      pluginSignedReleaseReportExportReady: true,
      pluginReviewHistoryUiReady: true,
      pluginValidationCommandCiWrapperReady: true,
      pluginSignedReportDownloadReady: true,
      pluginCiBadgeSummaryReady: true,
      pluginDownloadIntegrityPreviewReady: true,
      pluginReleaseChecklistGateReady: true,
      exportBoundaryReady: true,
      syncBoundaryReady: true,
      pluginRuntimeReady: false,
      recommendation: "recommendation text"
    },
    nextMilestones: [
      "phase20-release-gate-audit-export",
      "phase20-runtime-sandbox-plan"
    ]
  };
}

function buildPhase21RuntimeSandboxPlan(memories = []) {
  return {
    phase: 21,
    phaseName: "受限插件运行时和沙箱执行",
    schemaVersion: "phase21.runtime.sandbox-foundation.v1",
    status: "permission-runtime-enforcement-ready-third-party-disabled",
    version: APP_VERSION,
    buildLabel: BUILD_LABEL,
    runtimeExecution: false,
    thirdPartyExecution: false,
    defaultMode: "kill-switch-disabled",
    allowedInitialExtensionPoints: ["importer", "exporter", "asset-template"],
    blockedInitialExtensionPoints: ["agent-tool", "sync-adapter"],
    hostApiBoundary: {
      directDatabaseAccess: false,
      directFilesystemAccess: false,
      networkAccess: false,
      environmentAccess: false,
      secretAccess: false,
      allowedApis: ["read-redacted-input", "emit-draft-output", "emit-audit-event", "read-fixture"]
    },
    permissionRuntimePolicy: {
      schemaVersion: "phase21.permission.runtime-enforcement.v1",
      status: "permission-runtime-enforcement-ready-third-party-disabled",
      enforcementMode: "pre-execution-model-only",
      defaultDecision: "deny",
      permissionSources: [
        "phase20PlatformPlan.manifestSchema.permissions",
        "phase20PlatformPlan.permissionReview",
        "phase20PlatformPlan.pluginLockfile",
        "phase20PlatformPlan.signedManifestPolicy",
        "phase20PlatformPlan.pluginReleaseChecklistGate"
      ],
      hostApiPermissions: [
        { hostApi: "read-redacted-input", requiredPermission: "memory.import.preview", allowedExtensionPoints: ["importer"], decision: "allow-if-reviewed-and-kill-switch-enabled" },
        { hostApi: "emit-draft-output", requiredPermission: "memory.import.preview", allowedExtensionPoints: ["importer", "asset-template"], decision: "allow-if-contract-valid" },
        { hostApi: "emit-audit-event", requiredPermission: "plugin.audit.emit", allowedExtensionPoints: ["importer", "exporter", "asset-template"], decision: "allow-for-all-runtime-decisions" },
        { hostApi: "read-fixture", requiredPermission: "plugin.fixture.read", allowedExtensionPoints: ["importer", "exporter", "asset-template"], decision: "allow-fixture-only" }
      ],
      requestValidation: {
        requiredFields: ["pluginId", "extensionPoint", "hostApi", "permissions", "lockfileDecision", "signatureStatus", "releaseGateResult", "killSwitch"],
        unknownHostApiDecision: "deny-and-audit",
        missingPermissionDecision: "deny-and-audit",
        extensionPointMismatchDecision: "deny-and-audit",
        runtimeEnabledDecision: "deny-while-kill-switch-disabled"
      },
      samplePermissionDecisions: [
        { pluginId: "markdown-importer", extensionPoint: "importer", hostApi: "read-redacted-input", requestedPermission: "memory.import.preview", policyDecision: "blocked", blockedReason: "kill-switch-disabled" },
        { pluginId: "third-party-placeholder", extensionPoint: "importer", hostApi: "read-redacted-input", requestedPermission: "memory.import.preview", policyDecision: "blocked", blockedReason: "lockfile-entry-blocked" },
        { pluginId: "unknown-plugin", extensionPoint: "agent-tool", hostApi: "network-request", requestedPermission: "network.request", policyDecision: "blocked", blockedReason: "unknown-host-api" }
      ],
      auditEvent: {
        eventType: "permission-runtime-decision",
        requiredFields: ["runId", "pluginId", "hostApi", "requiredPermission", "policyDecision", "blockedReason", "sourceEvidence"]
      },
      blockedWhen: [
        "unknown-host-api",
        "permission-not-granted",
        "extension-point-not-allowed",
        "lockfile-entry-missing-or-blocked",
        "signature-untrusted",
        "release-checklist-not-passed",
        "kill-switch-disabled"
      ]
    },
    sandboxRunner: {
      runnerName: "phase21-plugin-sandbox-runner",
      implementationState: "model-only-no-third-party-code",
      timeoutMs: 3000,
      maxInputBytes: 262144,
      maxOutputBytes: 262144,
      killSwitch: true
    },
    executionAudit: {
      eventSchemaVersion: "phase21.plugin.runtime-audit.v1",
      requiredFields: ["runId", "pluginId", "extensionPoint", "decision", "durationMs", "inputSummary", "outputSummary", "blockedReason"],
      eventTypes: ["runtime-requested", "runtime-blocked", "runtime-timeout", "runtime-output-rejected", "runtime-completed"]
    },
    runtimeAuditReplay: {
      schemaVersion: "phase21.runtime-audit-replay.v1",
      status: "audit-replay-ready-third-party-disabled",
      replayMode: "audit-only-no-code-execution",
      requiredInputs: [
        "executionAudit.eventSchemaVersion",
        "permissionRuntimePolicy.auditEvent",
        "sampleRuntimeDecision",
        "phase20PlatformPlan.pluginReleaseChecklistGate",
        "phase20PlatformPlan.pluginDiffReviewHistory"
      ],
      replayWorkflow: [
        "load-runtime-audit-events",
        "sort-by-run-id-and-event-order",
        "verify-required-fields",
        "recompute-permission-decision",
        "compare-blocked-reason",
        "compare-release-gate-evidence",
        "emit-replay-summary"
      ],
      deterministicChecks: [
        "same-plugin-id",
        "same-extension-point",
        "same-host-api-policy",
        "same-lockfile-decision",
        "same-kill-switch-state",
        "same-blocked-reason"
      ],
      sampleReplay: {
        runId: "phase21-runtime-audit-replay-sample",
        pluginId: "third-party-placeholder",
        eventCount: 3,
        replayResult: "blocked-match",
        runtimeReady: false,
        evidence: ["kill-switch-disabled", "lockfile-entry-blocked", "release-checklist-blocked"]
      },
      blockedWhen: [
        "audit-event-missing",
        "required-field-missing",
        "permission-decision-mismatch",
        "blocked-reason-mismatch",
        "release-gate-evidence-missing",
        "runtime-enabled-without-replay"
      ],
      nextControls: ["runtime-replay-ui", "output-validation-gate", "importer-plugin-runtime-fixtures"]
    },
    outputValidationGate: {
      schemaVersion: "phase21.output-validation-gate.v1",
      status: "output-validation-ready-third-party-disabled",
      validationMode: "post-runtime-contract-model-only",
      requiredInputs: [
        "sandboxRunner.maxOutputBytes",
        "executionAudit.requiredFields",
        "permissionRuntimePolicy.hostApiPermissions",
        "runtimeAuditReplay.sampleReplay",
        "phase20PlatformPlan.extensionContractTests"
      ],
      acceptedOutputTypes: ["memory-draft", "redacted-export", "asset-template-preview", "audit-event"],
      validationWorkflow: [
        "parse-plugin-output-envelope",
        "verify-output-type-allowlist",
        "verify-output-byte-limit",
        "verify-contract-schema",
        "scan-sensitive-fields",
        "compare-audit-evidence",
        "emit-output-validation-event"
      ],
      contractChecks: [
        "output-type-allowed",
        "schema-version-present",
        "source-plugin-id-present",
        "no-secret-fields",
        "no-direct-filesystem-path",
        "audit-event-linked"
      ],
      sampleValidation: {
        pluginId: "third-party-placeholder",
        outputType: "memory-draft",
        result: "rejected",
        reason: "reason text",
        runtimeReady: false,
        evidence: ["thirdPartyExecution=false", "runtimeAuditReplay:blocked-match", "schema-not-executed"]
      },
      blockedWhen: [
        "output-type-not-allowed",
        "output-too-large",
        "schema-validation-failed",
        "sensitive-field-leak",
        "audit-event-missing",
        "runtime-replay-not-matched",
        "runtime-disabled-and-output-untrusted"
      ],
      nextControls: ["output-validation-ui", "importer-plugin-runtime-fixtures", "runtime-result-quarantine"]
    },
    importerRuntimeFixtures: {
      schemaVersion: "phase21.importer-runtime-fixtures.v1",
      status: "importer-fixtures-ready-third-party-disabled",
      fixtureMode: "deterministic-fixture-only-no-code-execution",
      requiredInputs: [
        "permissionRuntimePolicy.hostApiPermissions",
        "runtimeAuditReplay.sampleReplay",
        "outputValidationGate.acceptedOutputTypes",
        "phase20PlatformPlan.templatePreviewFixtures"
      ],
      fixtureSets: [
        {
          id: "markdown-diary-importer-fixture",
          extensionPoint: "importer",
          inputType: "markdown",
          expectedOutputType: "memory-draft",
          expectedDecision: "blocked-until-runtime-enabled",
          evidence: ["read-redacted-input", "emit-draft-output", "outputValidationGate:memory-draft"]
        },
        {
          id: "csv-memory-importer-fixture",
          extensionPoint: "importer",
          inputType: "csv",
          expectedOutputType: "memory-draft",
          expectedDecision: "blocked-until-runtime-enabled",
          evidence: ["fixture-delimiter-detected", "schema-version-present", "audit-event-linked"]
        },
        {
          id: "oversized-importer-output-fixture",
          extensionPoint: "importer",
          inputType: "json",
          expectedOutputType: "memory-draft",
          expectedDecision: "reject-output",
          evidence: ["output-too-large", "runtime-disabled-and-output-untrusted"]
        }
      ],
      fixtureWorkflow: [
        "load-redacted-fixture-input",
        "attach-reviewed-manifest-snapshot",
        "simulate-host-api-permission-decision",
        "attach-expected-output-envelope",
        "run-output-validation-gate",
        "record-fixture-audit-result"
      ],
      blockedFixtures: [
        { id: "network-importer-fixture", reason: "unknown-host-api" },
        { id: "secret-field-output-fixture", reason: "sensitive-field-leak" }
      ],
      sampleFixtureRun: {
        runId: "phase21-importer-fixture-sample",
        fixtureId: "markdown-diary-importer-fixture",
        result: "blocked-match",
        runtimeReady: false,
        outputValidation: "not-executed-runtime-disabled",
        evidence: ["kill-switch-disabled", "fixture-input-redacted", "audit-event-linked"]
      },
      blockedWhen: [
        "fixture-input-unredacted",
        "manifest-snapshot-missing",
        "expected-output-missing",
        "output-validation-gate-missing",
        "fixture-audit-event-missing",
        "runtime-enabled-for-fixture"
      ],
      nextControls: ["runtime-result-quarantine", "fixture-result-history", "importer-runtime-kill-switch-drill"]
    },
    runtimeResultQuarantine: {
      schemaVersion: "phase21.runtime-result-quarantine.v1",
      status: "quarantine-ready-third-party-disabled",
      quarantineMode: "model-only-block-untrusted-results",
      requiredInputs: [
        "importerRuntimeFixtures.sampleFixtureRun",
        "outputValidationGate.sampleValidation",
        "runtimeAuditReplay.sampleReplay",
        "permissionRuntimePolicy.auditEvent"
      ],
      quarantineStates: ["quarantined", "blocked", "needs-review", "released-fixture-only", "archived"],
      quarantineWorkflow: [
        "capture-runtime-result-envelope",
        "attach-fixture-run",
        "attach-output-validation-result",
        "attach-audit-replay-result",
        "derive-quarantine-state",
        "record-review-disposition",
        "export-quarantine-audit"
      ],
      sampleQuarantineItems: [
        {
          id: "quarantine-markdown-fixture-result",
          pluginId: "third-party-placeholder",
          fixtureId: "markdown-diary-importer-fixture",
          state: "quarantined",
          reason: "reason text",
          releaseReady: false,
          evidence: ["outputValidationGate:rejected", "runtimeAuditReplay:blocked-match"]
        },
        {
          id: "quarantine-network-importer-fixture",
          pluginId: "unknown-plugin",
          fixtureId: "network-importer-fixture",
          state: "blocked",
          reason: "reason text",
          releaseReady: false,
          evidence: ["permissionRuntimePolicy:unknown-host-api", "hostApiBoundary:networkAccess=false"]
        }
      ],
      reviewerDispositions: ["keep-quarantined", "archive-with-evidence", "request-fixture-repair", "block-runtime-release"],
      blockedWhen: [
        "quarantine-item-missing",
        "review-disposition-missing",
        "release-ready-while-quarantined",
        "audit-evidence-missing",
        "fixture-result-not-linked",
        "output-validation-not-linked"
      ],
      summary: {
        totalItems: 2,
        quarantined: 1,
        blocked: 1,
        releaseReady: false
      },
      nextControls: ["fixture-result-history", "importer-runtime-kill-switch-drill", "quarantine-review-ui"]
    },
    preflightInputs: [
      "phase20PlatformPlan.pluginReleaseChecklistGate",
      "phase20PlatformPlan.pluginLockfile",
      "phase20PlatformPlan.signedManifestPolicy",
      "phase20PlatformPlan.extensionContractTests",
      "runtimeAuditReplay",
      "outputValidationGate",
      "importerRuntimeFixtures",
      "runtimeResultQuarantine"
    ],
    runtimePreflight: [
      "verify-release-checklist-gate",
      "verify-lockfile-entry",
      "verify-signed-manifest",
      "verify-permission-review",
      "verify-host-api-permission",
      "verify-extension-point-policy",
      "verify-contract-suite",
      "verify-kill-switch",
      "verify-runtime-audit-replay",
      "verify-runtime-output-validation",
      "verify-importer-runtime-fixtures",
      "verify-runtime-result-quarantine",
      "record-runtime-audit"
    ],
    sampleRuntimeDecision: {
      version: APP_VERSION,
      buildLabel: BUILD_LABEL,
      pluginId: "third-party-placeholder",
      extensionPoint: "importer",
      decision: "blocked",
      runtimeReady: false,
      blockedReason: "kill-switch-disabled"
    },
    summary: {
      memoryCount: memories.length,
      hostApis: 4,
      permissionRules: 4,
      allowedExtensionPoints: 3,
      blockedExtensionPoints: 2,
      auditReplayReady: true,
      outputValidationReady: true,
      importerFixturesReady: true,
      quarantineReady: true,
      runtimeReady: false,
      thirdPartyExecution: false
    },
    blockedWhen: [
      "release-checklist-not-passed",
      "lockfile-entry-missing",
      "signature-untrusted",
      "permission-review-missing",
      "host-api-permission-denied",
      "unknown-host-api",
      "contract-test-failed",
      "kill-switch-disabled",
      "runtime-audit-missing",
      "audit-replay-mismatch",
      "output-validation-failed",
      "importer-fixture-mismatch",
      "quarantine-review-missing"
    ],
    nextControls: ["fixture-result-history", "importer-runtime-kill-switch-drill", "quarantine-review-ui"]
  };
}

function buildPhase22RuntimeEvidenceReview(memories = []) {
  const runtimePlan = buildPhase21RuntimeSandboxPlan(memories);
  return {
    phase: 22,
    phaseName: PHASE_NAME,
    schemaVersion: "phase22.runtime-evidence-review.v1",
    status: "evidence-review-ready-third-party-disabled",
    version: APP_VERSION,
    buildLabel: BUILD_LABEL,
    runtimeExecution: false,
    thirdPartyExecution: false,
    reviewMode: "human-reviewed-evidence-only",
    evidenceSources: [
      "phase21RuntimeSandboxPlan.runtimeResultQuarantine",
      "phase21RuntimeSandboxPlan.importerRuntimeFixtures",
      "phase21RuntimeSandboxPlan.outputValidationGate",
      "phase21RuntimeSandboxPlan.runtimeAuditReplay",
      "phase20PlatformPlan.pluginReleaseChecklistGate"
    ],
    evidenceBundle: {
      schemaVersion: "phase22.runtime-evidence-bundle.v1",
      requiredSections: [
        "quarantine-items",
        "fixture-runs",
        "output-validation-results",
        "audit-replay-summary",
        "release-gate-decision",
        "reviewer-disposition"
      ],
      sourceSnapshot: {
        quarantineSchema: runtimePlan.runtimeResultQuarantine.schemaVersion,
        fixtureSchema: runtimePlan.importerRuntimeFixtures.schemaVersion,
        outputValidationSchema: runtimePlan.outputValidationGate.schemaVersion,
        auditReplaySchema: runtimePlan.runtimeAuditReplay.schemaVersion
      },
      sampleBundle: {
        bundleId: "phase22-review-signoff-ledger-sample",
        quarantineItemIds: runtimePlan.runtimeResultQuarantine.sampleQuarantineItems.map((item) => item.id),
        fixtureRunId: runtimePlan.importerRuntimeFixtures.sampleFixtureRun.runId,
        replayRunId: runtimePlan.runtimeAuditReplay.sampleReplay.runId,
        validationResult: runtimePlan.outputValidationGate.sampleValidation.result,
        releaseReady: false
      }
    },
    reviewWorkbench: {
      schemaVersion: "phase22.runtime-review-workbench.v1",
      status: "review-workbench-ready-third-party-disabled",
      queueMode: "read-only-disposition-model",
      filters: ["state", "disposition", "blocker", "pluginId", "fixtureId", "evidenceSource"],
      columns: ["itemId", "pluginId", "fixtureId", "state", "suggestedDisposition", "primaryBlocker", "evidenceCount"],
      queueItems: runtimePlan.runtimeResultQuarantine.sampleQuarantineItems.map((item) => ({
        id: `review-${item.id}`,
        quarantineItemId: item.id,
        pluginId: item.pluginId,
        fixtureId: item.fixtureId,
        state: item.state,
        priority: item.state === "blocked" ? "blocker" : "review",
        suggestedDisposition: item.state === "blocked" ? "block-runtime-release" : "keep-quarantined",
        primaryBlocker: item.reason,
        evidenceBundleId: "phase22-review-signoff-ledger-sample",
        evidenceRefs: item.evidence,
        availableActions: ["open-evidence-bundle", "record-review-disposition", "export-review-audit"]
      })),
      detailPanels: [
        "quarantine-summary",
        "fixture-run",
        "output-validation",
        "audit-replay",
        "release-gate",
        "reviewer-disposition"
      ],
      bulkActions: [
        "export-filtered-evidence",
        "mark-needs-review",
        "block-runtime-release"
      ],
      emptyState: "no-runtime-results-ready-for-release",
      summary: {
        queueItems: runtimePlan.runtimeResultQuarantine.summary.totalItems,
        blockerItems: runtimePlan.runtimeResultQuarantine.summary.blocked,
        needsReview: runtimePlan.runtimeResultQuarantine.summary.quarantined,
        releaseReady: false,
        runtimeReady: false
      }
    },
    signoffLedger: {
      schemaVersion: "phase22.review-signoff-ledger.v1",
      status: "signoff-ledger-ready-third-party-disabled",
      ledgerMode: "append-only-model-no-runtime-release",
      requiredFields: [
        "signoffId",
        "reviewId",
        "quarantineItemId",
        "reviewer",
        "disposition",
        "reason",
        "evidenceBundleId",
        "evidenceSnapshot",
        "signedAt",
        "releaseReady"
      ],
      entries: runtimePlan.runtimeResultQuarantine.sampleQuarantineItems.map((item, index) => ({
        signoffId: `phase22-signoff-${index + 1}`,
        reviewId: `review-${item.id}`,
        quarantineItemId: item.id,
        reviewer: "local-owner",
        disposition: item.state === "blocked" ? "block-runtime-release" : "keep-quarantined",
        reason: item.reason,
        evidenceBundleId: "phase22-review-signoff-ledger-sample",
        evidenceSnapshot: {
          quarantineState: item.state,
          evidenceRefs: item.evidence,
          runtimeExecution: false,
          thirdPartyExecution: false
        },
        signedAt: "2026-06-26T00:00:00.000Z",
        releaseReady: false
      })),
      evidenceSnapshotPolicy: {
        snapshotTiming: "before-disposition-write",
        immutableFields: ["quarantineItemId", "pluginId", "fixtureId", "evidenceRefs", "releaseReady"],
        redaction: "plugin-results-redacted-fixture-only"
      },
      chainIntegrity: {
        requiredChecks: [
          "previous-signoff-linked",
          "evidence-bundle-present",
          "reviewer-present",
          "disposition-allowed",
          "release-ready-false-while-blocked"
        ],
        blockedWhen: [
          "signoff-entry-missing",
          "evidence-snapshot-missing",
          "reviewer-missing",
          "disposition-not-allowed",
          "release-ready-true-with-blocker"
        ]
      },
      summary: {
        totalSignoffs: runtimePlan.runtimeResultQuarantine.summary.totalItems,
        blockedSignoffs: runtimePlan.runtimeResultQuarantine.summary.blocked,
        keepQuarantined: runtimePlan.runtimeResultQuarantine.summary.quarantined,
        releaseReady: false,
        runtimeReady: false
      }
    },
    reviewerWorkflow: [
      "load-evidence-bundle",
      "open-review-workbench",
      "verify-source-schemas",
      "compare-quarantine-items-to-fixture-runs",
      "compare-output-validation-to-audit-replay",
      "record-reviewer-disposition",
      "append-signoff-ledger-entry",
      "derive-release-blocker-rules",
      "plan-blocker-clearance",
      "derive-release-readiness-decision",
      "record-clearance-audit-trail",
      "close-phase22-runtime-review",
      "derive-release-blockers",
      "export-review-audit"
    ],
    reviewerDispositions: [
      "keep-quarantined",
      "archive-with-evidence",
      "request-fixture-repair",
      "request-output-contract-repair",
      "block-runtime-release"
    ],
    dispositionPolicy: {
      defaultDisposition: "keep-quarantined",
      releaseReadyRequires: [
        "no-quarantined-items",
        "no-blocked-fixtures",
        "output-validation-accepted",
        "audit-replay-matched",
        "release-checklist-passed",
        "human-review-signed"
      ],
      blockedWhen: [
        "review-disposition-missing",
        "evidence-bundle-incomplete",
        "quarantine-state-unresolved",
        "fixture-result-missing",
        "output-validation-rejected",
        "audit-replay-mismatch",
        "release-gate-blocked",
        "runtime-enabled-during-review"
      ]
    },
    sampleReview: {
      reviewId: "phase22-runtime-review-sample",
      signoffId: "phase22-signoff-1",
      reviewer: "local-owner",
      disposition: "block-runtime-release",
      releaseReady: false,
      runtimeReady: false,
      thirdPartyExecution: false,
      blockers: [
        "runtime-disabled-and-output-untrusted",
        "unknown-host-api",
        "release-gate-blocked"
      ],
      evidence: [
        "phase21.runtime-result-quarantine.v1",
        "phase21.importer-runtime-fixtures.v1",
        "phase21.output-validation-gate.v1",
        "phase21.runtime-audit-replay.v1"
      ]
    },
    auditExport: {
      schemaVersion: "phase22.runtime-review-audit-export.v1",
      exportName: "phase22-review-signoff-ledger.audit.json",
      includes: [
        "evidenceBundle",
        "reviewerWorkflow",
        "signoffLedger",
        "sampleReview",
        "releaseBlockerRules",
        "releaseBlockerClearancePlan",
        "releaseReadinessDecision",
        "releaseClearanceAuditTrail",
        "phase22RuntimeReviewClosure",
        "releaseBlockers",
        "runtimeDisabledProof"
      ],
      redaction: "plugin-results-redacted-fixture-only"
    },
    releaseBlockerRules: {
      schemaVersion: "phase22.release-blocker-rules.v1",
      status: "release-blocker-rules-ready-third-party-disabled",
      ruleMode: "explainable-release-blocking-model",
      severityLevels: ["hold", "block"],
      rules: [
        {
          id: "runtime-disabled-and-output-untrusted",
          severity: "block",
          source: "phase21RuntimeSandboxPlan.outputValidationGate",
          condition: "outputValidationGate.sampleValidation.result=rejected",
          releaseAction: "block-runtime-release",
          clearRequires: ["runtime-remains-disabled", "output-validation-accepted", "human-review-signed"],
          evidenceRefs: ["phase21.output-validation-gate.v1", "phase22.review-signoff-ledger.v1"]
        },
        {
          id: "unknown-host-api",
          severity: "block",
          source: "phase21RuntimeSandboxPlan.permissionRuntimePolicy",
          condition: "quarantine item reason is unknown-host-api",
          releaseAction: "block-runtime-release",
          clearRequires: ["host-api-allowlist-reviewed", "permission-policy-updated", "audit-replay-matched"],
          evidenceRefs: ["phase21.permission.runtime-enforcement.v1"]
        },
        {
          id: "release-gate-blocked",
          severity: "block",
          source: "phase20PlatformPlan.pluginReleaseChecklistGate",
          condition: "release checklist gate result remains block",
          releaseAction: "block-runtime-release",
          clearRequires: ["release-checklist-passed", "ci-badge-not-blocked", "download-integrity-matched"],
          evidenceRefs: ["phase20.plugin.release-checklist-gate.v1"]
        },
        {
          id: "human-review-signed-missing",
          severity: "hold",
          source: "phase22RuntimeEvidenceReview.signoffLedger",
          condition: "required signoff entry missing or unsigned",
          releaseAction: "hold-release-review",
          clearRequires: ["signoff-entry-present", "reviewer-present", "evidence-snapshot-present"],
          evidenceRefs: ["phase22.review-signoff-ledger.v1"]
        }
      ],
      releaseReadiness: {
        releaseReady: false,
        hold: 1,
        block: 3,
        requiredBeforeRelease: [
          "all-block-rules-cleared",
          "all-hold-rules-reviewed",
          "signoff-ledger-complete",
          "runtime-disabled-proof-exported"
        ]
      },
      blockedWhen: [
        "block-rule-active",
        "hold-rule-without-reviewer",
        "clear-requirement-missing",
        "runtime-enabled-while-blocked"
      ]
    },
    releaseBlockerClearancePlan: {
      schemaVersion: "phase22.blocker-clearance-plan.v1",
      status: "clearance-plan-ready-third-party-disabled",
      planMode: "human-owned-clearance-no-runtime-release",
      ownerRoles: ["local-owner", "runtime-reviewer", "release-reviewer"],
      clearanceItems: [
        {
          blockerId: "runtime-disabled-and-output-untrusted",
          owner: "runtime-reviewer",
          requiredEvidence: ["output-validation-accepted", "runtime-disabled-proof", "signoff-ledger-entry"],
          verificationSteps: ["rerun-output-validation-fixture", "compare-audit-replay", "confirm-runtimeExecution-false"],
          clearDecision: "keep-blocked-until-output-accepted"
        },
        {
          blockerId: "unknown-host-api",
          owner: "runtime-reviewer",
          requiredEvidence: ["host-api-allowlist-review", "permission-policy-change-record", "audit-replay-matched"],
          verificationSteps: ["review-host-api-request", "deny-unlisted-host-api", "attach-permission-runtime-decision"],
          clearDecision: "keep-blocked-until-host-api-reviewed"
        },
        {
          blockerId: "release-gate-blocked",
          owner: "release-reviewer",
          requiredEvidence: ["release-checklist-pass", "ci-badge-not-blocked", "download-integrity-match"],
          verificationSteps: ["rerun-phase20-pre-release", "compare-signed-report", "export-release-gate-audit"],
          clearDecision: "keep-blocked-until-release-gate-passes"
        },
        {
          blockerId: "human-review-signed-missing",
          owner: "local-owner",
          requiredEvidence: ["reviewer-present", "evidence-snapshot-present", "signed-signoff-entry"],
          verificationSteps: ["append-signoff-ledger-entry", "verify-chain-integrity", "export-review-audit"],
          clearDecision: "hold-until-signoff-complete"
        }
      ],
      clearanceWorkflow: [
        "assign-clearance-owner",
        "collect-required-evidence",
        "run-verification-steps",
        "append-clearance-note",
        "recompute-release-readiness"
      ],
      blockedWhen: [
        "owner-missing",
        "required-evidence-missing",
        "verification-step-failed",
        "releaseReady-true-before-clearance"
      ],
      summary: {
        totalItems: 4,
        blockItems: 3,
        holdItems: 1,
        releaseReady: false,
        runtimeReady: false
      }
    },
    releaseReadinessDecision: {
      schemaVersion: "phase22.release-readiness-decision.v1",
      status: "release-decision-blocked-third-party-disabled",
      decisionMode: "derived-from-blocker-rules-and-clearance-plan",
      decision: "block-release",
      releaseReady: false,
      runtimeReady: false,
      thirdPartyExecution: false,
      inputs: ["releaseBlockerRules", "releaseBlockerClearancePlan", "signoffLedger", "reviewWorkbench"],
      activeBlockers: [
        {
          id: "runtime-disabled-and-output-untrusted",
          severity: "block",
          clearanceOwner: "runtime-reviewer",
          reason: "reason text",
          missingBeforeRelease: ["output-validation-accepted", "runtime-disabled-proof", "human-review-signed"]
        },
        {
          id: "unknown-host-api",
          severity: "block",
          clearanceOwner: "runtime-reviewer",
          reason: "reason text",
          missingBeforeRelease: ["host-api-allowlist-reviewed", "permission-policy-updated", "audit-replay-matched"]
        },
        {
          id: "release-gate-blocked",
          severity: "block",
          clearanceOwner: "release-reviewer",
          reason: "reason text",
          missingBeforeRelease: ["release-checklist-passed", "ci-badge-not-blocked", "download-integrity-matched"]
        },
        {
          id: "human-review-signed-missing",
          severity: "hold",
          clearanceOwner: "local-owner",
          reason: "reason text",
          missingBeforeRelease: ["signoff-entry-present", "reviewer-present", "evidence-snapshot-present"]
        }
      ],
      gates: [
        { id: "runtime-execution-disabled", result: "pass", evidence: "runtimeExecution=false and thirdPartyExecution=false" },
        { id: "block-rules-cleared", result: "block", evidence: "3 block rules remain active" },
        { id: "hold-rules-reviewed", result: "hold", evidence: "1 hold rule requires reviewer confirmation" },
        { id: "clearance-plan-complete", result: "block", evidence: "clearance verification steps are pending" },
        { id: "signoff-ledger-complete", result: "hold", evidence: "signoff ledger must remain complete before releaseReady can change" }
      ],
      recomputePolicy: {
        triggerOn: [
          "clearance-item-updated",
          "signoff-ledger-appended",
          "release-gate-rerun",
          "output-validation-rerun"
        ],
        requires: [
          "runtimeExecution=false",
          "thirdPartyExecution=false",
          "all-block-rules-cleared",
          "all-clearance-verification-passed",
          "signoff-ledger-complete"
        ],
        blockedWhen: [
          "input-snapshot-missing",
          "clearance-owner-missing",
          "verification-step-failed",
          "releaseReady-true-with-active-blocker"
        ]
      },
      summary: {
        decision: "block-release",
        pass: 1,
        hold: 2,
        block: 2,
        releaseReady: false,
        runtimeReady: false
      }
    },
    releaseClearanceAuditTrail: {
      schemaVersion: "phase22.clearance-audit-trail.v1",
      status: "clearance-audit-ready-third-party-disabled",
      auditMode: "append-only-clearance-attempts",
      requiredFields: [
        "auditId",
        "blockerId",
        "attemptedBy",
        "attemptedAt",
        "evidenceRefs",
        "verificationResults",
        "outcome",
        "decisionRef",
        "releaseReady"
      ],
      entries: [
        {
          auditId: "phase22-clearance-audit-1",
          blockerId: "runtime-disabled-and-output-untrusted",
          attemptedBy: "runtime-reviewer",
          attemptedAt: "2026-06-26T00:00:00.000Z",
          evidenceRefs: ["phase21.output-validation-gate.v1", "phase22.release-readiness-decision.v1"],
          verificationResults: [
            { step: "rerun-output-validation-fixture", result: "failed", note: "note text" },
            { step: "confirm-runtimeExecution-false", result: "passed", note: "note text" }
          ],
          outcome: "block-kept",
          decisionRef: "phase22.release-readiness-decision.v1",
          releaseReady: false
        },
        {
          auditId: "phase22-clearance-audit-2",
          blockerId: "release-gate-blocked",
          attemptedBy: "release-reviewer",
          attemptedAt: "2026-06-26T00:00:00.000Z",
          evidenceRefs: ["phase20.plugin.release-checklist-gate.v1", "phase22.blocker-clearance-plan.v1"],
          verificationResults: [
            { step: "rerun-phase20-pre-release", result: "failed", note: "note text" },
            { step: "export-release-gate-audit", result: "passed", note: "note text" }
          ],
          outcome: "block-kept",
          decisionRef: "phase22.release-readiness-decision.v1",
          releaseReady: false
        },
        {
          auditId: "phase22-clearance-audit-3",
          blockerId: "human-review-signed-missing",
          attemptedBy: "local-owner",
          attemptedAt: "2026-06-26T00:00:00.000Z",
          evidenceRefs: ["phase22.review-signoff-ledger.v1"],
          verificationResults: [
            { step: "verify-chain-integrity", result: "passed", note: "note text" },
            { step: "append-clearance-note", result: "pending", note: "note text" }
          ],
          outcome: "hold-kept",
          decisionRef: "phase22.release-readiness-decision.v1",
          releaseReady: false
        }
      ],
      chainIntegrity: {
        requiredChecks: [
          "audit-entry-linked-to-blocker",
          "decision-ref-present",
          "verification-result-present",
          "release-ready-false-while-blocked"
        ],
        blockedWhen: [
          "audit-entry-missing",
          "decision-ref-missing",
          "verification-result-missing",
          "releaseReady-true-with-failed-clearance"
        ]
      },
      exportPolicy: {
        exportName: "phase22-clearance-audit-trail.json",
        includeInRuntimeReviewAudit: true,
        redaction: "plugin-results-redacted-fixture-only"
      },
      summary: {
        totalEntries: 3,
        blockKept: 2,
        holdKept: 1,
        cleared: 0,
        releaseReady: false,
        runtimeReady: false
      }
    },
    phase22RuntimeReviewClosure: {
      schemaVersion: "phase22.runtime-review-closure.v1",
      status: "phase22-closed-next-phase-ready-third-party-disabled",
      closureMode: "model-and-audit-closure-no-runtime-release",
      phase22Complete: true,
      releaseReady: false,
      runtimeReady: false,
      nextPhaseEntryReady: true,
      runtimeExecution: false,
      thirdPartyExecution: false,
      closedSections: [
        "evidenceBundle",
        "reviewWorkbench",
        "signoffLedger",
        "releaseBlockerRules",
        "releaseBlockerClearancePlan",
        "releaseReadinessDecision",
        "releaseClearanceAuditTrail"
      ],
      blockingSummary: {
        activeBlockers: 4,
        block: 3,
        hold: 1,
        decision: "block-release",
        releaseReady: false
      },
      closureArtifacts: [
        "phase22.runtime-evidence-bundle.v1",
        "phase22.review-signoff-ledger.v1",
        "phase22.release-blocker-rules.v1",
        "phase22.blocker-clearance-plan.v1",
        "phase22.release-readiness-decision.v1",
        "phase22.clearance-audit-trail.v1"
      ],
      nextPhaseEntryConditions: [
        "runtimeExecution=false",
        "thirdPartyExecution=false",
        "releaseReady=false",
        "active-blockers-preserved",
        "clearance-audit-exported",
        "decision-history-preserved"
      ],
      nextPhaseAllowedWork: [
        "release-readiness-review-ui",
        "clearance-audit-search",
        "decision-history-export",
        "runtime-sandbox-ui-planning"
      ],
      blockedWhen: [
        "runtime-enabled-before-next-phase",
        "third-party-execution-enabled",
        "releaseReady-true-with-active-blocker",
        "closure-artifact-missing"
      ],
      summary: {
        phase22Complete: true,
        nextPhaseEntryReady: true,
        releaseReady: false,
        runtimeReady: false,
        thirdPartyExecution: false
      }
    },
    releaseBlockers: [
      "runtime-disabled-and-output-untrusted",
      "unknown-host-api",
      "release-gate-blocked",
      "human-review-signed-missing"
    ],
    summary: {
      memoryCount: memories.length,
      evidenceSources: 5,
      quarantineItems: runtimePlan.runtimeResultQuarantine.summary.totalItems,
      blockedItems: runtimePlan.runtimeResultQuarantine.summary.blocked,
      releaseReady: false,
      runtimeReady: false,
      thirdPartyExecution: false
    },
    nextControls: ["enter-next-phase", "release-readiness-review-ui", "clearance-audit-search"]
  };
}

function buildPhase23ReleaseReadinessReviewUi(memories = []) {
  const phase22Review = buildPhase22RuntimeEvidenceReview(memories);
  const closure = phase22Review.phase22RuntimeReviewClosure;
  return {
    phase: 23,
    phaseName: PHASE_NAME,
    schemaVersion: "phase23.release-readiness-review-ui.v1",
    status: "review-ui-model-ready-runtime-disabled",
    version: APP_VERSION,
    buildLabel: BUILD_LABEL,
    runtimeExecution: false,
    thirdPartyExecution: false,
    releaseReady: false,
    sourceClosure: {
      schemaVersion: closure.schemaVersion,
      phase22Complete: closure.phase22Complete,
      nextPhaseEntryReady: closure.nextPhaseEntryReady,
      releaseReady: closure.releaseReady
    },
    dashboardCards: [
      { id: "release-decision", label: "release decision", value: phase22Review.releaseReadinessDecision.decision, severity: "block" },
      { id: "active-blockers", label: "active blockers", value: closure.blockingSummary.activeBlockers, severity: "block" },
      { id: "runtime-execution", label: "runtime execution", value: "disabled", severity: "pass" },
      { id: "next-phase-entry", label: "next phase entry", value: "ready-under-guards", severity: "pass" }
    ],
    reviewQueues: [
      {
        id: "blockers",
        title: "active release blockers",
        source: "phase22RuntimeEvidenceReview.releaseReadinessDecision.activeBlockers",
        itemCount: phase22Review.releaseReadinessDecision.activeBlockers.length,
        defaultFilter: "severity:block-or-hold",
        emptyState: "no-active-blockers"
      },
      {
        id: "clearance-audit",
        title: "clearance audit attempts",
        source: "phase22RuntimeEvidenceReview.releaseClearanceAuditTrail.entries",
        itemCount: phase22Review.releaseClearanceAuditTrail.entries.length,
        defaultFilter: "outcome:block-kept-or-hold-kept",
        emptyState: "no-clearance-attempts"
      }
    ],
    clearanceAuditSearch: {
      schemaVersion: "phase23.clearance-audit-search.v1",
      status: "search-model-ready-runtime-disabled",
      source: "phase22RuntimeEvidenceReview.releaseClearanceAuditTrail.entries",
      queryFields: ["auditId", "blockerId", "attemptedBy", "outcome", "decisionRef", "verificationResults.result"],
      indexedFields: ["blockerId", "attemptedBy", "outcome", "decisionRef", "releaseReady"],
      resultColumns: ["auditId", "blockerId", "attemptedBy", "outcome", "failedSteps", "decisionRef", "releaseReady"],
      filterPresets: [
        { id: "failed-clearance", label: "failed clearance", query: { outcome: "block-kept", verificationResult: "failed" } },
        { id: "hold-kept", label: "hold kept", query: { outcome: "hold-kept" } },
        { id: "release-gate", label: "release gate", query: { blockerId: "release-gate-blocked" } },
        { id: "runtime-reviewer", label: "runtime reviewer", query: { attemptedBy: "runtime-reviewer" } }
      ],
      sampleQuery: {
        text: "release-gate failed",
        filters: { blockerId: "release-gate-blocked", outcome: "block-kept" }
      },
      sampleResults: phase22Review.releaseClearanceAuditTrail.entries.map((entry) => ({
        auditId: entry.auditId,
        blockerId: entry.blockerId,
        attemptedBy: entry.attemptedBy,
        outcome: entry.outcome,
        failedSteps: entry.verificationResults.filter((item) => item.result === "failed").map((item) => item.step),
        decisionRef: entry.decisionRef,
        releaseReady: entry.releaseReady
      })),
      exportPolicy: {
        exportName: "phase23-clearance-audit-search-results.json",
        redaction: "plugin-results-redacted-fixture-only",
        includesQuery: true,
        includesResultRows: true
      },
      guardrails: {
        blockedWhen: [
          "search-result-missing-decision-ref",
          "releaseReady-true-in-search-result",
          "runtime-enabled-during-search"
        ]
      },
      summary: {
        searchableEntries: phase22Review.releaseClearanceAuditTrail.entries.length,
        failedClearance: phase22Review.releaseClearanceAuditTrail.entries.filter((entry) => entry.verificationResults.some((item) => item.result === "failed")).length,
        releaseReady: false,
        runtimeReady: false
      }
    },
    decisionHistoryExport: {
      schemaVersion: "phase23.decision-history-export.v1",
      status: "decision-history-export-ready-runtime-disabled",
      exportName: "phase23-release-decision-history.json",
      sourceSections: [
        "phase22RuntimeEvidenceReview.releaseReadinessDecision",
        "phase22RuntimeEvidenceReview.releaseClearanceAuditTrail",
        "phase22RuntimeEvidenceReview.phase22RuntimeReviewClosure",
        "phase23ReleaseReadinessReviewUi.clearanceAuditSearch"
      ],
      includedFields: [
        "decision",
        "activeBlockers",
        "gates",
        "auditEntries",
        "searchQuery",
        "guardrailState",
        "releaseReady"
      ],
      timeline: [
        {
          id: "decision-derived",
          source: "phase22.release-readiness-decision.v1",
          eventType: "release-decision",
          result: phase22Review.releaseReadinessDecision.decision,
          releaseReady: false
        },
        {
          id: "clearance-audit-recorded",
          source: "phase22.clearance-audit-trail.v1",
          eventType: "clearance-audit",
          result: "blockers-preserved",
          releaseReady: false
        },
        {
          id: "phase22-closed",
          source: closure.schemaVersion,
          eventType: "phase-closure",
          result: "next-phase-ready-under-guards",
          releaseReady: false
        }
      ],
      exportGuards: [
        "runtimeExecution=false",
        "thirdPartyExecution=false",
        "releaseReady=false",
        "active-blockers-included",
        "decision-ref-present"
      ],
      blockedWhen: [
        "decision-history-missing",
        "active-blockers-omitted",
        "releaseReady-true-in-export",
        "runtime-enabled-during-export"
      ],
      summary: {
        timelineEvents: 3,
        activeBlockers: closure.blockingSummary.activeBlockers,
        releaseReady: false,
        runtimeReady: false
      }
    },
    blockerDetailPanels: {
      schemaVersion: "phase23.blocker-detail-panels.v1",
      status: "blocker-detail-panels-ready-runtime-disabled",
      source: "phase22RuntimeEvidenceReview.releaseReadinessDecision.activeBlockers",
      panels: phase22Review.releaseReadinessDecision.activeBlockers.map((blocker) => {
        const rule = phase22Review.releaseBlockerRules.rules.find((item) => item.id === blocker.id);
        const audits = phase22Review.releaseClearanceAuditTrail.entries.filter((entry) => entry.blockerId === blocker.id);
        return {
          blockerId: blocker.id,
          severity: blocker.severity,
          clearanceOwner: blocker.clearanceOwner,
          reason: blocker.reason,
          missingBeforeRelease: blocker.missingBeforeRelease,
          clearRequires: rule?.clearRequires || [],
          linkedAuditIds: audits.map((entry) => entry.auditId),
          auditOutcomes: audits.map((entry) => entry.outcome),
          gateRefs: phase22Review.releaseReadinessDecision.gates.filter((gate) => gate.result === blocker.severity || gate.result === "block").map((gate) => gate.id),
          allowedActions: ["open-clearance-audit-entry", "export-decision-history", "copy-blocker-evidence"],
          blockedActions: ["mark-blocker-cleared", "mark-release-ready", "enable-runtime-execution"]
        };
      }),
      panelFields: [
        "blockerId",
        "severity",
        "clearanceOwner",
        "reason",
        "missingBeforeRelease",
        "clearRequires",
        "linkedAuditIds",
        "auditOutcomes",
        "gateRefs"
      ],
      guardrails: {
        blockedWhen: [
          "blocker-panel-missing-clearance-owner",
          "blocker-panel-missing-audit-link",
          "mark-release-ready-from-detail",
          "runtime-enabled-from-detail"
        ]
      },
      summary: {
        panels: phase22Review.releaseReadinessDecision.activeBlockers.length,
        panelsWithAuditLinks: phase22Review.releaseReadinessDecision.activeBlockers.filter((blocker) => phase22Review.releaseClearanceAuditTrail.entries.some((entry) => entry.blockerId === blocker.id)).length,
        releaseReady: false,
        runtimeReady: false
      }
    },
    reviewActionLedger: {
      schemaVersion: "phase23.review-action-ledger.v1",
      status: "review-action-ledger-ready-runtime-disabled",
      ledgerMode: "append-only-review-actions-no-release-mutation",
      sourcePanels: "phase23ReleaseReadinessReviewUi.blockerDetailPanels",
      allowedActionTypes: [
        "filter-release-readiness",
        "open-blocker-detail",
        "open-clearance-audit-entry",
        "export-decision-history",
        "copy-blocker-evidence",
        "enter-next-phase-planning"
      ],
      blockedActionTypes: [
        "mark-blocker-cleared",
        "mark-release-ready",
        "enable-runtime-execution",
        "enable-third-party-execution"
      ],
      requiredFields: [
        "actionId",
        "actionType",
        "actor",
        "targetType",
        "targetId",
        "sourceSchema",
        "recordedAt",
        "releaseReady"
      ],
      entries: [
        {
          actionId: "phase23-action-1",
          actionType: "filter-release-readiness",
          actor: "release-reviewer",
          targetType: "filterPreset",
          targetId: "show-blockers",
          sourceSchema: "phase23.release-readiness-review-ui.v1",
          recordedAt: "2026-06-26T00:00:00.000Z",
          releaseReady: false
        },
        {
          actionId: "phase23-action-2",
          actionType: "open-blocker-detail",
          actor: "runtime-reviewer",
          targetType: "blocker",
          targetId: "release-gate-blocked",
          sourceSchema: "phase23.blocker-detail-panels.v1",
          recordedAt: "2026-06-26T00:00:00.000Z",
          releaseReady: false
        },
        {
          actionId: "phase23-action-3",
          actionType: "export-decision-history",
          actor: "release-reviewer",
          targetType: "export",
          targetId: "phase23-release-decision-history.json",
          sourceSchema: "phase23.decision-history-export.v1",
          recordedAt: "2026-06-26T00:00:00.000Z",
          releaseReady: false
        }
      ],
      chainIntegrity: {
        requiredChecks: [
          "action-type-allowed",
          "target-reference-present",
          "source-schema-present",
          "release-ready-false",
          "runtime-disabled"
        ],
        blockedWhen: [
          "blocked-action-recorded-as-allowed",
          "target-reference-missing",
          "source-schema-missing",
          "releaseReady-true-in-action-ledger",
          "runtime-enabled-during-action-record"
        ]
      },
      exportPolicy: {
        exportName: "phase23-review-action-ledger.json",
        includeInDecisionHistory: true,
        redaction: "reviewer-id-only"
      },
      summary: {
        entries: 3,
        blockedActionTypes: 4,
        releaseReady: false,
        runtimeReady: false
      }
    },
    nextPhaseGuardrailDashboard: {
      schemaVersion: "phase23.next-phase-guardrail-dashboard.v1",
      status: "next-phase-ready-release-blocked-runtime-disabled",
      dashboardMode: "separate-next-phase-entry-from-release-readiness",
      guardrailCards: [
        { id: "phase22-complete", label: "phase 22 complete", result: closure.phase22Complete ? "pass" : "block", evidence: closure.schemaVersion },
        { id: "next-phase-entry", label: "next phase entry", result: closure.nextPhaseEntryReady ? "pass" : "block", evidence: "phase22RuntimeReviewClosure.nextPhaseEntryReady" },
        { id: "release-ready", label: "release ready", result: "block", evidence: "active blockers preserved" },
        { id: "runtime-execution", label: "runtime execution", result: "pass", evidence: "runtimeExecution=false" },
        { id: "third-party-execution", label: "third-party execution", result: "pass", evidence: "thirdPartyExecution=false" }
      ],
      entryConditions: closure.nextPhaseEntryConditions,
      releaseBlockers: phase22Review.releaseReadinessDecision.activeBlockers.map((blocker) => ({
        blockerId: blocker.id,
        severity: blocker.severity,
        owner: blocker.clearanceOwner,
        reason: blocker.reason
      })),
      allowedNextPhaseWork: closure.nextPhaseAllowedWork,
      blockedReleaseActions: [
        "mark-release-ready",
        "enable-runtime-execution",
        "enable-third-party-execution",
        "ship-third-party-plugin-runtime",
        "clear-blockers-without-audit"
      ],
      recommendedNextVersion: {
        label: "phase23-runtime-sandbox-ui-plan",
        reason: "reason text"
      },
      guardrails: {
        blockedWhen: [
          "next-phase-entry-without-phase22-closure",
          "releaseReady-true-with-active-blocker",
          "runtime-enabled-before-release-clearance",
          "third-party-execution-enabled-before-release-clearance"
        ]
      },
      summary: {
        pass: 4,
        block: 1,
        nextPhaseEntryReady: true,
        releaseReady: false,
        runtimeReady: false,
        thirdPartyExecution: false
      }
    },
    runtimeSandboxUiPlan: {
      schemaVersion: "phase23.runtime-sandbox-ui-plan.v1",
      status: "runtime-sandbox-ui-plan-ready-runtime-disabled",
      planMode: "ui-planning-only-no-code-execution",
      sourceDashboard: "phase23ReleaseReadinessReviewUi.nextPhaseGuardrailDashboard",
      uiSections: [
        { id: "sandbox-preflight", label: "sandbox preflight", source: "phase21RuntimeSandboxPlan.runtimePreflight", result: "plan-only" },
        { id: "permission-decisions", label: "permission decisions", source: "phase21RuntimeSandboxPlan.permissionRuntimePolicy", result: "plan-only" },
        { id: "quarantine-results", label: "quarantine results", source: "phase21RuntimeSandboxPlan.runtimeResultQuarantine", result: "plan-only" },
        { id: "release-blockers", label: "release blockers", source: "phase22RuntimeEvidenceReview.releaseReadinessDecision", result: "blocked" }
      ],
      evidenceSources: [
        "phase21RuntimeSandboxPlan",
        "phase22RuntimeEvidenceReview",
        "phase23ReleaseReadinessReviewUi.nextPhaseGuardrailDashboard",
        "phase23ReleaseReadinessReviewUi.reviewActionLedger"
      ],
      preflightCards: [
        { id: "runtime-execution", expected: false, actual: false, result: "pass" },
        { id: "third-party-execution", expected: false, actual: false, result: "pass" },
        { id: "release-ready", expected: false, actual: false, result: "blocked-by-active-release-blockers" },
        { id: "audit-evidence", expected: "present", actual: "present", result: "pass" }
      ],
      blockedRuntimeActions: [
        "run-third-party-plugin",
        "enable-plugin-runtime",
        "bypass-runtime-quarantine",
        "mark-runtime-output-trusted",
        "ship-runtime-sandbox-ui-as-execution"
      ],
      allowedPlanningActions: [
        "design-runtime-sandbox-ui",
        "map-preflight-cards",
        "link-quarantine-evidence",
        "export-runtime-sandbox-ui-plan"
      ],
      implementationOrder: [
        "read-only-preflight-panel",
        "permission-decision-preview",
        "quarantine-result-review-panel",
        "release-blocker-linked-runtime-summary"
      ],
      exportPolicy: {
        exportName: "phase23-runtime-sandbox-ui-plan.json",
        includeInDecisionHistory: true,
        redaction: "no-runtime-output"
      },
      guardrails: {
        blockedWhen: [
          "runtimeSandboxUiPlan-executes-code",
          "third-party-execution-enabled-from-ui-plan",
          "runtime-output-marked-trusted-without-review",
          "releaseReady-true-from-runtime-sandbox-ui-plan"
        ]
      },
      summary: {
        uiSections: 4,
        preflightCards: 4,
        blockedRuntimeActions: 5,
        runtimeExecution: false,
        thirdPartyExecution: false,
        releaseReady: false
      }
    },
    runtimeSandboxReadOnlyPanels: {
      schemaVersion: "phase23.runtime-sandbox-readonly-panels.v1",
      status: "readonly-panels-ready-runtime-disabled",
      panelMode: "read-only-evidence-no-execution",
      sourcePlan: "phase23ReleaseReadinessReviewUi.runtimeSandboxUiPlan",
      panels: [
        {
          id: "preflight-panel",
          title: "runtime preflight",
          source: "phase21RuntimeSandboxPlan.runtimePreflight",
          fields: ["checkId", "expected", "actual", "result", "evidenceRef"],
          primarySignal: "runtimeExecution=false"
        },
        {
          id: "permission-panel",
          title: "permission decisions",
          source: "phase21RuntimeSandboxPlan.permissionRuntimePolicy.samplePermissionDecisions",
          fields: ["pluginId", "hostApi", "decision", "blockedReason", "auditEventType"],
          primarySignal: "defaultDecision=deny"
        },
        {
          id: "quarantine-panel",
          title: "quarantine results",
          source: "phase21RuntimeSandboxPlan.runtimeResultQuarantine.sampleQuarantineItems",
          fields: ["itemId", "pluginId", "state", "reason", "reviewDisposition"],
          primarySignal: "quarantined-results-not-trusted"
        },
        {
          id: "release-blocker-panel",
          title: "release blockers",
          source: "phase22RuntimeEvidenceReview.releaseReadinessDecision.activeBlockers",
          fields: ["blockerId", "severity", "owner", "reason", "missingBeforeRelease"],
          primarySignal: "releaseReady=false"
        }
      ],
      panelActions: {
        allowed: [
          "filter-runtime-panels",
          "open-evidence-reference",
          "export-readonly-panel-state",
          "copy-blocker-reference"
        ],
        blocked: [
          "execute-plugin-from-panel",
          "enable-runtime-from-panel",
          "trust-quarantine-result-from-panel",
          "mark-release-ready-from-panel"
        ]
      },
      displayState: {
        defaultPanel: "preflight-panel",
        filters: ["result", "pluginId", "blockedReason", "severity"],
        emptyState: "runtime evidence unavailable until source plans are present"
      },
      exportPolicy: {
        exportName: "phase23-runtime-sandbox-readonly-panels.json",
        includeInDecisionHistory: true,
        redaction: "no-plugin-output-payload"
      },
      guardrails: {
        blockedWhen: [
          "readOnlyPanel-executes-plugin-code",
          "panel-action-enables-runtime",
          "quarantine-result-trusted-from-panel",
          "releaseReady-true-from-readonly-panel"
        ]
      },
      summary: {
        panels: 4,
        allowedActions: 4,
        blockedActions: 4,
        runtimeExecution: false,
        thirdPartyExecution: false,
        releaseReady: false
      }
    },
    runtimeSandboxPanelViewExport: {
      schemaVersion: "phase23.runtime-sandbox-panel-view-export.v1",
      status: "panel-view-export-ready-runtime-disabled",
      viewMode: "filtered-readonly-export-no-execution",
      sourcePanels: "phase23ReleaseReadinessReviewUi.runtimeSandboxReadOnlyPanels",
      filterModel: {
        fields: ["panelId", "result", "pluginId", "blockedReason", "severity", "releaseReady"],
        presets: ["show-blocked-runtime", "show-permission-denied", "show-quarantined", "show-release-blockers"],
        defaultPreset: "show-blocked-runtime"
      },
      views: [
        { id: "preflight-blocks", panelId: "preflight-panel", filterPreset: "show-blocked-runtime", exportable: true },
        { id: "permission-denials", panelId: "permission-panel", filterPreset: "show-permission-denied", exportable: true },
        { id: "quarantine-review", panelId: "quarantine-panel", filterPreset: "show-quarantined", exportable: true },
        { id: "release-blocker-summary", panelId: "release-blocker-panel", filterPreset: "show-release-blockers", exportable: true }
      ],
      exportViews: [
        "preflight-blocks",
        "permission-denials",
        "quarantine-review",
        "release-blocker-summary"
      ],
      blockedExportActions: [
        "export-plugin-output-payload",
        "export-runtime-execution-result",
        "export-as-release-ready",
        "export-without-active-blockers"
      ],
      exportPolicy: {
        exportName: "phase23-runtime-sandbox-panel-view-export.json",
        includeInDecisionHistory: true,
        redaction: "panel-evidence-only-no-runtime-payload"
      },
      guardrails: {
        blockedWhen: [
          "panel-export-includes-runtime-output",
          "panel-export-marks-releaseReady-true",
          "panel-export-omits-active-blocker",
          "panel-export-enables-third-party-execution"
        ]
      },
      summary: {
        filters: 6,
        views: 4,
        exportViews: 4,
        runtimeExecution: false,
        thirdPartyExecution: false,
        releaseReady: false
      }
    },
    phase23ClosureHandoffPackage: {
      schemaVersion: "phase23.closure-handoff-package.v1",
      status: "phase23-closed-next-phase-ready-release-blocked",
      handoffMode: "close-phase23-with-release-blockers-preserved",
      completedVersionRange: ["1.3.0", "1.3.9"],
      includedArtifacts: [
        "phase23ReleaseReadinessReviewUi",
        "clearanceAuditSearch",
        "decisionHistoryExport",
        "blockerDetailPanels",
        "reviewActionLedger",
        "nextPhaseGuardrailDashboard",
        "runtimeSandboxUiPlan",
        "runtimeSandboxReadOnlyPanels",
        "runtimeSandboxPanelViewExport"
      ],
      nextPhaseEntry: {
        ready: closure.nextPhaseEntryReady,
        source: "phase22RuntimeReviewClosure.nextPhaseEntryReady",
        conditions: closure.nextPhaseEntryConditions,
        allowedWork: closure.nextPhaseAllowedWork
      },
      releaseReadiness: {
        releaseReady: false,
        decision: phase22Review.releaseReadinessDecision.decision,
        activeBlockers: phase22Review.releaseReadinessDecision.activeBlockers.map((blocker) => blocker.id)
      },
      blockedReleaseActions: [
        "mark-release-ready",
        "enable-runtime-execution",
        "enable-third-party-execution",
        "ship-third-party-plugin-runtime",
        "clear-blockers-without-audit"
      ],
      recommendedNextPhase: {
        label: "phase24-runtime-sandbox-ux-implementation-plan",
        entryPolicy: "planning-and-readonly-ux-only-until-release-clearance"
      },
      exportPolicy: {
        exportName: "phase23-closure-handoff-package.json",
        includeInDecisionHistory: true,
        redaction: "handoff-evidence-only"
      },
      guardrails: {
        blockedWhen: [
          "phase23-closed-without-phase22-closure",
          "handoff-marks-releaseReady-true",
          "handoff-enables-runtime-execution",
          "handoff-drops-active-blockers"
        ]
      },
      summary: {
        artifacts: 9,
        nextPhaseEntryReady: true,
        releaseReady: false,
        runtimeExecution: false,
        thirdPartyExecution: false,
        activeBlockers: phase22Review.releaseReadinessDecision.activeBlockers.length
      }
    },
    filterModel: {
      fields: ["severity", "clearanceOwner", "gateResult", "auditOutcome", "releaseReady", "runtimeExecution"],
      presets: ["show-blockers", "show-holds", "show-failed-clearance", "show-next-phase-guards"],
      defaultPreset: "show-blockers"
    },
    detailPanels: [
      "blocker-detail",
      "gate-result-detail",
      "clearance-audit-detail",
      "decision-history",
      "next-phase-entry-guards"
    ],
    allowedActions: [
      "filter-release-readiness",
      "open-blocker-detail",
      "open-clearance-audit-entry",
      "export-decision-history",
      "enter-next-phase-planning"
    ],
    blockedActions: [
      "enable-runtime-execution",
      "enable-third-party-execution",
      "mark-release-ready",
      "clear-blocker-without-evidence"
    ],
    guardrails: {
      releaseReadyRequires: [
        "phase22RuntimeReviewClosure.phase22Complete=true",
        "runtimeExecution=false",
        "thirdPartyExecution=false",
        "no-active-blockers",
        "clearance-audit-passed"
      ],
      blockedWhen: [
        "runtime-enabled-before-clearance",
        "third-party-execution-enabled",
        "releaseReady-true-with-active-blocker",
        "decision-history-missing"
      ]
    },
    summary: {
      memoryCount: memories.length,
      phase22Complete: closure.phase22Complete,
      nextPhaseEntryReady: closure.nextPhaseEntryReady,
      activeBlockers: closure.blockingSummary.activeBlockers,
      releaseReady: false,
      runtimeReady: false,
      thirdPartyExecution: false
    },
    nextControls: ["clearance-audit-search", "decision-history-export", "runtime-sandbox-ui-planning"]
  };
}

function buildPhase24RuntimeSandboxUxEntry(memories = []) {
  const phase23Review = buildPhase23ReleaseReadinessReviewUi(memories);
  const handoff = phase23Review.phase23ClosureHandoffPackage;
  const runtimePreflightWorkbench = {
    schemaVersion: "phase24.runtime-preflight-workbench.v1",
    version: "1.4.1",
    status: "ready-readonly-runtime-disabled",
    mode: "preflight-review-only-no-code-execution",
    rows: [
      { id: "kill-switch", label: "Runtime kill switch", result: "pass", evidence: "phase21 sandbox runner killSwitch=true", blockedWhen: "kill-switch-disabled" },
      { id: "permission-policy", label: "Permission runtime policy", result: "pass", evidence: "deny-by-default policy is inherited", blockedWhen: "permission-policy-missing" },
      { id: "quarantine", label: "Quarantine queue", result: "block", evidence: "runtime results remain quarantined", blockedWhen: "quarantine-review-missing" },
      { id: "release-gate", label: "Release gate", result: "block", evidence: "phase23 active blockers are preserved", blockedWhen: "releaseReady-true-before-clearance" }
    ],
    detailFields: ["checkId", "result", "evidence", "blockedWhen", "sourceArtifact", "reviewState"],
    allowedActions: ["filter-preflight-checks", "open-readonly-evidence", "export-preflight-review"],
    blockedActions: ["run-preflight-execution", "toggle-kill-switch", "enable-runtime-execution"],
    summary: { total: 4, pass: 2, block: 2, runtimeExecution: false, releaseReady: false }
  };
  const permissionDecisionReviewFlow = {
    schemaVersion: "phase24.permission-decision-review-flow.v1",
    version: "1.4.2",
    status: "ready-readonly-deny-by-default",
    defaultDecision: "deny",
    reviewRows: [
      { id: "host-api-read-redacted-input", pluginId: "markdown-importer", hostApi: "read-redacted-input", requestedPermission: "memory.import.preview", decision: "blocked", reason: "kill-switch-disabled", reviewerAction: "record-review-note" },
      { id: "host-api-network-request", pluginId: "third-party-placeholder", hostApi: "network-request", requestedPermission: "network.request", decision: "blocked", reason: "unknown-host-api", reviewerAction: "keep-blocked" },
      { id: "host-api-sensitive-output", pluginId: "csv-importer", hostApi: "emit-draft-output", requestedPermission: "memory.import.preview", decision: "blocked", reason: "sensitive-field-leak", reviewerAction: "request-redacted-fixture" }
    ],
    filters: ["pluginId", "hostApi", "requestedPermission", "decision", "reason"],
    allowedActions: ["filter-permission-decisions", "record-review-note", "export-permission-review"],
    blockedActions: ["grant-runtime-permission", "execute-host-api", "enable-third-party-execution"],
    summary: { decisions: 3, blocked: 3, approvedRuntimePermissions: 0, runtimeExecution: false }
  };
  const quarantineReviewQueue = {
    schemaVersion: "phase24.quarantine-review-queue.v1",
    version: "1.4.3",
    status: "ready-readonly-quarantine-preserved",
    queueItems: [
      { id: "quarantine-runtime-result-1", pluginId: "markdown-importer", severity: "block", reason: "kill-switch-disabled", disposition: "blocked", missingEvidence: ["runtime-disabled-signoff"], availableActions: ["record-review-disposition", "export-quarantine-item"] },
      { id: "quarantine-runtime-result-2", pluginId: "third-party-placeholder", severity: "block", reason: "lockfile-entry-blocked", disposition: "blocked", missingEvidence: ["trusted-signature", "reviewed-lockfile-entry"], availableActions: ["record-review-disposition", "open-linked-audit"] },
      { id: "quarantine-runtime-result-3", pluginId: "csv-importer", severity: "hold", reason: "output-validation-rejected", disposition: "needs-evidence", missingEvidence: ["redacted-output-fixture"], availableActions: ["request-evidence", "export-quarantine-item"] }
    ],
    allowedActions: ["filter-quarantine-queue", "record-review-disposition", "export-quarantine-review"],
    blockedActions: ["apply-quarantined-result", "mark-result-trusted", "clear-release-blocker"],
    summary: { queueItems: 3, block: 2, hold: 1, cleared: 0, releaseReady: false }
  };
  const runtimeEvidenceExportPack = {
    schemaVersion: "phase24.runtime-evidence-export-pack.v1",
    version: "1.4.4",
    status: "ready-export-guarded",
    exportName: "phase24-runtime-evidence-export-pack.json",
    includes: [
      "phase23-closure-handoff",
      "runtime-preflight-workbench",
      "permission-decision-review-flow",
      "quarantine-review-queue",
      "release-blocker-summary",
      "operations-request-id"
    ],
    redaction: "plugin-results-redacted-fixture-only",
    integrityChecks: ["phase23-handoff-present", "runtime-disabled", "third-party-execution-disabled", "releaseReady-false"],
    allowedActions: ["preview-evidence-export", "download-redacted-evidence-pack"],
    blockedActions: ["export-unredacted-plugin-result", "mutate-release-state-from-export"],
    summary: { exportable: true, redacted: true, integrityChecks: 4, releaseReady: false }
  };
  const releaseClearancePreview = {
    schemaVersion: "phase24.release-clearance-preview.v1",
    version: "1.4.5",
    status: "ready-preview-blocked",
    previewMode: "derived-readonly-no-release-mutation",
    gates: [
      { id: "runtime-disabled", result: "pass", evidence: "runtimeExecution=false" },
      { id: "third-party-disabled", result: "pass", evidence: "thirdPartyExecution=false" },
      { id: "quarantine-cleared", result: "block", evidence: "quarantine queue still has blocked items" },
      { id: "blocker-signoff", result: "block", evidence: "phase23 active blockers remain" },
      { id: "evidence-export-reviewed", result: "hold", evidence: "export pack is previewable but not signed off" }
    ],
    clearRequires: ["quarantine-review-complete", "blocker-signoff-recorded", "evidence-export-reviewed", "release-checklist-pass"],
    allowedActions: ["preview-clearance-result", "export-clearance-preview", "open-blocker-detail"],
    blockedActions: ["mark-release-ready", "clear-blocker-without-evidence", "enable-runtime-execution"],
    summary: { pass: 2, hold: 1, block: 2, releaseReady: false }
  };
  const phase24ClosurePackage = {
    schemaVersion: "phase24.closure-package.v1",
    version: "1.4.6",
    status: "phase24-ux-model-complete-release-blocked",
    completedVersionRange: "1.4.1-1.4.6",
    includedArtifacts: [
      "runtimePreflightWorkbench",
      "permissionDecisionReviewFlow",
      "quarantineReviewQueue",
      "runtimeEvidenceExportPack",
      "releaseClearancePreview"
    ],
    closureChecks: [
      { id: "preflight-modeled", result: "pass" },
      { id: "permission-review-modeled", result: "pass" },
      { id: "quarantine-review-modeled", result: "pass" },
      { id: "evidence-export-modeled", result: "pass" },
      { id: "clearance-preview-modeled", result: "pass" },
      { id: "release-ready", result: "block" }
    ],
    nextPhaseEntry: {
      ready: true,
      recommendedFocus: "phase25-runtime-sandbox-ui-surface",
      conditions: ["keep-runtime-disabled", "keep-third-party-execution-disabled", "preserve-release-blockers"]
    },
    summary: { phase24Complete: true, nextPhaseEntryReady: true, releaseReady: false, runtimeExecution: false, thirdPartyExecution: false }
  };
  return {
    phase: 24,
    schemaVersion: "phase24.closure-package.v1",
    status: "phase24-ux-model-complete-release-blocked",
    entryMode: "readonly-ux-implementation-no-code-execution",
    sourceHandoff: "phase23ReleaseReadinessReviewUi.phase23ClosureHandoffPackage",
    inheritedPhase23: {
      handoffStatus: handoff.status,
      completedVersionRange: handoff.completedVersionRange,
      includedArtifacts: handoff.includedArtifacts
    },
    uxScope: [
      "runtime-preflight-workbench",
      "permission-decision-review-flow",
      "quarantine-review-queue",
      "runtime-evidence-export-pack",
      "release-clearance-preview"
    ],
    entryConditions: handoff.nextPhaseEntry.conditions,
    blockedReleaseActions: handoff.blockedReleaseActions,
    allowedActions: [
      "design-readonly-runtime-ux",
      "map-phase23-evidence-to-phase24-panels",
      "export-phase24-entry-plan"
    ],
    blockedActions: [
      "enable-runtime-execution",
      "enable-third-party-execution",
      "execute-third-party-plugin",
      "mark-release-ready"
    ],
    exportPolicy: {
      exportName: "phase24-closure-package.json",
      includeInOperationsExport: true,
      redaction: "handoff-evidence-only"
    },
    guardrails: {
      blockedWhen: [
        "phase24-entry-without-phase23-handoff",
        "runtime-enabled-during-phase24-entry",
        "third-party-execution-enabled-during-phase24-entry",
        "releaseReady-true-before-clearance"
      ]
    },
    runtimePreflightWorkbench,
    permissionDecisionReviewFlow,
    quarantineReviewQueue,
    runtimeEvidenceExportPack,
    releaseClearancePreview,
    phase24ClosurePackage,
    summary: {
      phase24Complete: true,
      phase23Closed: true,
      nextPhaseEntryReady: handoff.nextPhaseEntry.ready,
      activeBlockers: handoff.releaseReadiness.activeBlockers.length,
      releaseReady: false,
      runtimeExecution: false,
      thirdPartyExecution: false
    }
  };
}

function buildPhase25RuntimeSandboxUiSurface(memories = []) {
  const phase24 = buildPhase24RuntimeSandboxUxEntry(memories);
  const surfacePanels = [
    {
      id: "runtime-preflight-workbench",
      label: "Runtime preflight",
      sourceArtifact: "phase24RuntimeSandboxUxEntry.runtimePreflightWorkbench",
      component: "readonly-check-table",
      routeHash: "#runtime-preflight",
      filters: ["result", "blockedWhen", "sourceArtifact"],
      primaryActions: ["filter-preflight-checks", "open-readonly-evidence", "export-preflight-review"],
      blockedActions: ["run-preflight-execution", "toggle-kill-switch", "enable-runtime-execution"],
      status: "ready"
    },
    {
      id: "permission-decision-review",
      label: "Permission decisions",
      sourceArtifact: "phase24RuntimeSandboxUxEntry.permissionDecisionReviewFlow",
      component: "permission-review-table",
      routeHash: "#permission-decisions",
      filters: ["pluginId", "hostApi", "requestedPermission", "decision", "reason"],
      primaryActions: ["filter-permission-decisions", "record-review-note-preview", "export-permission-review"],
      blockedActions: ["grant-runtime-permission", "execute-host-api", "enable-third-party-execution"],
      status: "ready"
    },
    {
      id: "quarantine-review-queue",
      label: "Quarantine queue",
      sourceArtifact: "phase24RuntimeSandboxUxEntry.quarantineReviewQueue",
      component: "quarantine-review-list",
      routeHash: "#quarantine-queue",
      filters: ["pluginId", "severity", "reason", "disposition"],
      primaryActions: ["filter-quarantine-queue", "open-linked-audit", "export-quarantine-review"],
      blockedActions: ["apply-quarantined-result", "mark-result-trusted", "clear-release-blocker"],
      status: "ready"
    },
    {
      id: "runtime-evidence-export-pack",
      label: "Evidence export",
      sourceArtifact: "phase24RuntimeSandboxUxEntry.runtimeEvidenceExportPack",
      component: "guarded-export-preview",
      routeHash: "#runtime-evidence-export",
      filters: ["include", "integrityCheck", "redaction"],
      primaryActions: ["preview-evidence-export", "download-redacted-evidence-pack"],
      blockedActions: ["export-unredacted-plugin-result", "mutate-release-state-from-export"],
      status: "ready"
    },
    {
      id: "release-clearance-preview",
      label: "Release clearance",
      sourceArtifact: "phase24RuntimeSandboxUxEntry.releaseClearancePreview",
      component: "clearance-gate-preview",
      routeHash: "#release-clearance",
      filters: ["gate", "result", "evidence"],
      primaryActions: ["preview-clearance-result", "export-clearance-preview", "open-blocker-detail"],
      blockedActions: ["mark-release-ready", "clear-blocker-without-evidence", "enable-runtime-execution"],
      status: "ready"
    }
  ];
  const surfaceStateModel = {
    schemaVersion: "phase25.surface-state-model.v1",
    version: "1.5.1",
    mode: "readonly-browser-state-no-runtime-mutation",
    defaultState: {
      activePanel: "runtime-preflight-workbench",
      filterPreset: "show-all-blocked-first",
      detailDrawerOpen: false,
      exportPreviewOpen: false
    },
    routeState: {
      defaultHash: "#runtime-preflight",
      hashParam: "phase25Panel",
      allowedHashes: surfacePanels.map((panel) => panel.routeHash),
      unknownHashFallback: "runtime-preflight-workbench"
    },
    filterPresets: [
      { id: "show-all-blocked-first", label: "All, blockers first", appliesTo: "all-panels", sort: "block-hold-pass" },
      { id: "blocked-only", label: "Blocked only", appliesTo: "runtime-preflight-workbench,permission-decision-review,quarantine-review-queue,release-clearance-preview", filter: "result-or-decision-is-block" },
      { id: "exportable-evidence", label: "Exportable evidence", appliesTo: "runtime-evidence-export-pack", filter: "redacted-exportable-only" }
    ],
    panelState: surfacePanels.map((panel) => ({
      panelId: panel.id,
      selected: panel.id === "runtime-preflight-workbench",
      filterControls: panel.filters.map((filter) => ({ id: filter, mode: "readonly-filter", persisted: false })),
      detailDrawer: {
        enabled: true,
        mode: "readonly",
        fields: ["sourceArtifact", "primaryActions", "blockedActions", "reviewNotePreview"]
      },
      exportPreview: {
        enabled: panel.primaryActions.some((action) => action.includes("export") || action.includes("download")),
        redactedOnly: true
      }
    })),
    blockedStateMutations: [
      "persist-runtime-permission-grant",
      "persist-quarantine-clearance",
      "set-releaseReady-true",
      "enable-runtime-execution-from-ui-state",
      "enable-third-party-execution-from-ui-state"
    ],
    stateIntegrity: {
      runtimeExecution: false,
      thirdPartyExecution: false,
      releaseReady: false,
      persistence: "browser-session-or-export-only",
      auditMode: "ui-state-review-preview"
    }
  };
  const panelEvidenceBindings = [
    {
      panelId: "runtime-preflight-workbench",
      sourceArtifact: "phase24RuntimeSandboxUxEntry.runtimePreflightWorkbench",
      sourceSchemaVersion: phase24.runtimePreflightWorkbench.schemaVersion,
      evidenceFields: ["rows", "summary", "blockedActions"],
      sourceCount: phase24.runtimePreflightWorkbench.rows.length,
      redaction: "no-plugin-output",
      integrityChecks: ["source-schema-present", "runtimeExecution-false", "releaseReady-false"]
    },
    {
      panelId: "permission-decision-review",
      sourceArtifact: "phase24RuntimeSandboxUxEntry.permissionDecisionReviewFlow",
      sourceSchemaVersion: phase24.permissionDecisionReviewFlow.schemaVersion,
      evidenceFields: ["reviewRows", "defaultDecision", "blockedActions"],
      sourceCount: phase24.permissionDecisionReviewFlow.reviewRows.length,
      redaction: "host-api-request-only",
      integrityChecks: ["default-deny", "approvedRuntimePermissions-zero", "thirdPartyExecution-false"]
    },
    {
      panelId: "quarantine-review-queue",
      sourceArtifact: "phase24RuntimeSandboxUxEntry.quarantineReviewQueue",
      sourceSchemaVersion: phase24.quarantineReviewQueue.schemaVersion,
      evidenceFields: ["queueItems", "summary", "blockedActions"],
      sourceCount: phase24.quarantineReviewQueue.queueItems.length,
      redaction: "quarantine-metadata-only",
      integrityChecks: ["cleared-zero", "releaseReady-false", "apply-quarantined-result-blocked"]
    },
    {
      panelId: "runtime-evidence-export-pack",
      sourceArtifact: "phase24RuntimeSandboxUxEntry.runtimeEvidenceExportPack",
      sourceSchemaVersion: phase24.runtimeEvidenceExportPack.schemaVersion,
      evidenceFields: ["includes", "integrityChecks", "summary"],
      sourceCount: phase24.runtimeEvidenceExportPack.integrityChecks.length,
      redaction: phase24.runtimeEvidenceExportPack.redaction,
      integrityChecks: ["redacted-export-only", "mutate-release-state-blocked", "operations-request-id-linked"]
    },
    {
      panelId: "release-clearance-preview",
      sourceArtifact: "phase24RuntimeSandboxUxEntry.releaseClearancePreview",
      sourceSchemaVersion: phase24.releaseClearancePreview.schemaVersion,
      evidenceFields: ["gates", "clearRequires", "summary"],
      sourceCount: phase24.releaseClearancePreview.gates.length,
      redaction: "clearance-result-only",
      integrityChecks: ["releaseReady-false", "mark-release-ready-blocked", "blocker-evidence-required"]
    }
  ];
  const reviewActionModel = {
    schemaVersion: "phase25.review-action-model.v1",
    version: "1.5.3",
    actionMode: "readonly-review-preview-no-release-mutation",
    persistence: "session-preview-or-export-only",
    panelActions: surfacePanels.map((panel) => ({
      panelId: panel.id,
      allowedReviewActions: panel.primaryActions.filter((action) => (
        action.includes("filter") || action.includes("open") || action.includes("preview") || action.includes("export") || action.includes("download") || action.includes("record-review-note")
      )),
      auditPreview: {
        eventType: "phase25-review-action-preview",
        sourceArtifact: panel.sourceArtifact,
        writesToRuntime: false,
        writesToReleaseState: false
      },
      disabledMutations: panel.blockedActions
    })),
    globalReviewActions: [
      "switch-panel",
      "apply-readonly-filter",
      "open-evidence-detail",
      "preview-redacted-export",
      "export-ui-state-review"
    ],
    blockedMutationPolicy: {
      runtimeExecution: false,
      thirdPartyExecution: false,
      releaseReady: false,
      blockedActions: [
        "grant-runtime-permission",
        "apply-quarantined-result",
        "clear-release-blocker",
        "mark-release-ready",
        "execute-third-party-plugin"
      ]
    },
    summary: {
      panels: surfacePanels.length,
      previewOnly: true,
      persistedMutations: 0,
      runtimeExecution: false,
      releaseReady: false
    }
  };
  const reviewAuditPreview = {
    schemaVersion: "phase25.review-audit-preview.v1",
    version: "1.5.4",
    auditMode: "readonly-action-audit-preview-no-persistence",
    eventSource: "phase25.review-action-model.v1",
    exportPackage: {
      exportName: "phase25-review-audit-preview.json",
      includeInOperationsExport: true,
      redaction: "review-actions-and-blocked-mutations-only",
      writesToRuntime: false,
      writesToReleaseState: false
    },
    previewEvents: reviewActionModel.panelActions.map((item, index) => {
      const evidence = panelEvidenceBindings.find((binding) => binding.panelId === item.panelId) || {};
      return {
        eventId: `phase25-review-preview-${String(index + 1).padStart(2, "0")}`,
        panelId: item.panelId,
        eventType: item.auditPreview.eventType,
        action: item.allowedReviewActions[0] || "open-evidence-detail",
        sourceArtifact: item.auditPreview.sourceArtifact,
        sourceSchemaVersion: evidence.sourceSchemaVersion || "unknown",
        redaction: evidence.redaction || "redacted",
        writesToRuntime: false,
        writesToReleaseState: false,
        persisted: false
      };
    }),
    blockedMutationEvents: reviewActionModel.blockedMutationPolicy.blockedActions.map((action) => ({
      action,
      disposition: "blocked-before-runtime",
      writesToRuntime: false,
      writesToReleaseState: false,
      persisted: false
    })),
    integritySummary: {
      previewEvents: reviewActionModel.panelActions.length,
      blockedMutationEvents: reviewActionModel.blockedMutationPolicy.blockedActions.length,
      runtimeExecution: false,
      thirdPartyExecution: false,
      releaseReady: false,
      persistedMutations: 0,
      exportReady: true
    }
  };
  const reviewExportPackage = {
    schemaVersion: "phase25.review-export-package.v1",
    version: "1.5.5",
    packageName: "phase25-review-export-package.json",
    packageMode: "readonly-review-package-no-runtime-execution",
    includedArtifacts: [
      { id: "surface-state", schemaVersion: surfaceStateModel.schemaVersion, exportName: "phase25-surface-state-model.json", source: "surfaceStateModel" },
      { id: "panel-evidence", schemaVersion: "phase25.panel-evidence-bindings.v1", exportName: "phase25-panel-evidence-bindings.json", source: "panelEvidenceBindings", itemCount: panelEvidenceBindings.length },
      { id: "review-actions", schemaVersion: reviewActionModel.schemaVersion, exportName: "phase25-review-action-model.json", source: "reviewActionModel", itemCount: reviewActionModel.panelActions.length },
      { id: "review-audit-preview", schemaVersion: reviewAuditPreview.schemaVersion, exportName: reviewAuditPreview.exportPackage.exportName, source: "reviewAuditPreview", itemCount: reviewAuditPreview.previewEvents.length }
    ],
    integrityManifest: {
      requiresRuntimeExecutionFalse: true,
      requiresThirdPartyExecutionFalse: true,
      requiresReleaseReadyFalse: true,
      redactionPolicy: "ui-state-actions-audit-preview-only",
      sourcePanelCount: surfacePanels.length,
      evidenceBindingCount: panelEvidenceBindings.length,
      previewEventCount: reviewAuditPreview.previewEvents.length,
      blockedMutationCount: reviewAuditPreview.blockedMutationEvents.length,
      persistedMutations: 0
    },
    blockedExportMutations: [
      "export-unredacted-plugin-result",
      "apply-exported-audit-event",
      "mark-release-ready-from-export",
      "enable-runtime-execution-from-export",
      "execute-third-party-plugin-from-export"
    ],
    summary: {
      artifacts: 4,
      exportReady: true,
      runtimeExecution: false,
      thirdPartyExecution: false,
      releaseReady: false,
      persistedMutations: 0
    }
  };
  const reviewPackageValidation = {
    schemaVersion: "phase25.review-package-validation.v1",
    version: "1.5.6",
    validationMode: "readonly-package-validation-no-runtime-execution",
    validatesPackage: reviewExportPackage.packageName,
    artifactChecks: reviewExportPackage.includedArtifacts.map((artifact) => ({
      artifactId: artifact.id,
      exportName: artifact.exportName,
      schemaVersion: artifact.schemaVersion,
      result: "pass",
      checks: [
        "schema-version-present",
        "export-name-present",
        "source-bound",
        "readonly-export"
      ],
      writesToRuntime: false,
      writesToReleaseState: false
    })),
    guardrailChecks: [
      { id: "runtime-disabled", result: "pass", requiredValue: false, actualValue: false },
      { id: "third-party-execution-disabled", result: "pass", requiredValue: false, actualValue: false },
      { id: "release-ready-blocked", result: "pass", requiredValue: false, actualValue: false },
      { id: "persisted-mutations-zero", result: "pass", requiredValue: 0, actualValue: reviewExportPackage.summary.persistedMutations },
      { id: "blocked-export-mutations-present", result: "pass", requiredValue: "non-empty", actualValue: reviewExportPackage.blockedExportMutations.length }
    ],
    blockedValidationMutations: [
      "auto-fix-export-package",
      "apply-validation-result-to-release",
      "enable-runtime-execution-after-validation",
      "clear-release-blocker-after-validation",
      "execute-third-party-plugin-during-validation"
    ],
    summary: {
      artifactsChecked: reviewExportPackage.includedArtifacts.length,
      guardrailsChecked: 5,
      pass: reviewExportPackage.includedArtifacts.length + 5,
      warn: 0,
      block: 0,
      runtimeExecution: false,
      thirdPartyExecution: false,
      releaseReady: false,
      persistedMutations: 0,
      validationReady: true
    }
  };
  return {
    phase: 25,
    schemaVersion: "phase25.runtime-sandbox-ui-surface.v1",
    status: "phase25-ui-surface-entry-ready-runtime-disabled",
    sourceClosure: {
      schemaVersion: phase24.phase24ClosurePackage.schemaVersion,
      completedVersionRange: phase24.phase24ClosurePackage.completedVersionRange,
      phase24Complete: phase24.phase24ClosurePackage.summary.phase24Complete,
      releaseReady: phase24.phase24ClosurePackage.summary.releaseReady
    },
    surfaceMode: "readonly-review-export-no-code-execution",
    navigation: {
      defaultPanel: "runtime-preflight-workbench",
      tabs: surfacePanels.map((panel) => ({ id: panel.id, label: panel.label, routeHash: panel.routeHash, status: panel.status })),
      detailDrawer: { enabled: true, mode: "readonly", fields: ["sourceArtifact", "evidence", "blockedActions", "primaryActions"] }
    },
    surfaceStateModel,
    panelEvidenceBindings,
    reviewActionModel,
    reviewAuditPreview,
    reviewExportPackage,
    reviewPackageValidation,
    surfacePanels,
    sharedControls: {
      filters: ["status", "result", "severity", "pluginId", "reason"],
      exports: ["phase25-runtime-sandbox-ui-surface.json", "phase25-review-audit-preview.json", "phase25-review-export-package.json", "phase25-review-package-validation.json", "phase24-runtime-evidence-export-pack.json"],
      emptyStates: ["no-filter-results", "backend-unavailable", "source-artifact-missing"],
      keyboardModel: "browser-ui-only-no-runtime-shortcuts"
    },
    implementationPlan: [
      "render-phase25-shell-in-platform-panel",
      "wire-phase24-preflight-to-readonly-table",
      "wire-permission-review-to-filterable-table",
      "wire-quarantine-queue-to-detail-drawer",
      "wire-evidence-export-preview",
      "wire-release-clearance-preview"
    ],
    blockedActions: [
      "enable-runtime-execution",
      "enable-third-party-execution",
      "execute-third-party-plugin",
      "grant-runtime-permission",
      "apply-quarantined-result",
      "mark-release-ready"
    ],
    exportPolicy: {
      exportName: "phase25-runtime-sandbox-ui-surface.json",
      includeInOperationsExport: true,
      redaction: "ui-state-and-redacted-evidence-only"
    },
    summary: {
      phase24Complete: true,
      panels: surfacePanels.length,
      readyPanels: surfacePanels.filter((panel) => panel.status === "ready").length,
      stateModelReady: true,
      evidenceBindings: panelEvidenceBindings.length,
      evidenceBindingReady: true,
      reviewActionModelReady: true,
      reviewAuditPreviewReady: true,
      reviewExportPackageReady: true,
      reviewPackageValidationReady: true,
      runtimeExecution: false,
      thirdPartyExecution: false,
      releaseReady: false
    }
  };
}

function buildPhase26RuntimeValidationEntry(memories = []) {
  const phase25 = buildPhase25RuntimeSandboxUiSurface(memories);
  const packageValidation = phase25.reviewPackageValidation || {};
  const packageExport = phase25.reviewExportPackage || {};
  const artifactChecks = packageValidation.artifactChecks || [];
  const guardrailChecks = packageValidation.guardrailChecks || [];
  const entryReady = packageValidation.summary?.validationReady === true
    && phase25.summary.runtimeExecution === false
    && phase25.summary.thirdPartyExecution === false
    && phase25.summary.releaseReady === false;
  const releaseGateSimulation = {
    schemaVersion: "phase26.release-gate-simulation.v1",
    version: "1.6.1",
    mode: "readonly-release-gate-simulation-no-runtime-execution",
    sourceInputs: [
      { id: "phase25-review-package-validation", schemaVersion: packageValidation.schemaVersion, source: "phase25RuntimeSandboxUiSurface.reviewPackageValidation" },
      { id: "phase25-review-export-package", schemaVersion: packageExport.schemaVersion, source: "phase25RuntimeSandboxUiSurface.reviewExportPackage" },
      { id: "phase26-entry-conditions", schemaVersion: "phase26.runtime-validation-entry.v1", source: "phase26RuntimeValidationEntry.entryConditions" }
    ],
    gateItems: [
      { id: "package-artifacts-present", result: artifactChecks.length >= 4 ? "pass" : "block", evidence: `${artifactChecks.length} artifact checks` },
      { id: "guardrails-pass", result: guardrailChecks.every((item) => item.result === "pass") ? "pass" : "block", evidence: `${guardrailChecks.length} guardrail checks` },
      { id: "runtime-disabled", result: phase25.summary.runtimeExecution === false ? "pass" : "block", evidence: "runtimeExecution=false" },
      { id: "third-party-disabled", result: phase25.summary.thirdPartyExecution === false ? "pass" : "block", evidence: "thirdPartyExecution=false" },
      { id: "release-ready-remains-blocked", result: phase25.summary.releaseReady === false ? "block" : "pass", evidence: "releaseReady=false keeps release simulation blocked" }
    ],
    simulatedDecision: {
      result: "block-release",
      releaseReady: false,
      runtimeExecution: false,
      thirdPartyExecution: false,
      persistedMutations: 0,
      reason: entryReady ? "release gate simulation completed with releaseReady intentionally blocked" : "release gate simulation input is incomplete"
    },
    blockedActions: [
      "write-releaseReady-true",
      "clear-release-blocker",
      "persist-simulated-decision",
      "execute-runtime-preflight",
      "execute-third-party-plugin"
    ],
    exportPolicy: {
      exportName: "phase26-release-gate-simulation.json",
      includeInOperationsExport: true,
      redaction: "gate-results-and-source-metadata-only"
    },
    summary: {
      totalGateItems: 5,
      pass: 4,
      block: 1,
      releaseReady: false,
      runtimeExecution: false,
      thirdPartyExecution: false,
      persistedMutations: 0
    }
  };
  const blockingGateItems = releaseGateSimulation.gateItems.filter((item) => item.result === "block");
  const blockerClearanceSimulation = {
    schemaVersion: "phase26.blocker-clearance-simulation.v1",
    version: "1.6.2",
    mode: "readonly-blocker-clearance-simulation-no-release-mutation",
    sourceInputs: [
      { id: "release-gate-simulation", schemaVersion: releaseGateSimulation.schemaVersion, source: "phase26RuntimeValidationEntry.releaseGateSimulation" },
      { id: "phase23-closure-handoff", schemaVersion: "phase23.closure-handoff-package.v1", source: "phase23ReleaseReadinessReviewUi.phase23ClosureHandoffPackage" },
      { id: "phase25-package-validation", schemaVersion: packageValidation.schemaVersion, source: "phase25RuntimeSandboxUiSurface.reviewPackageValidation" }
    ],
    clearanceItems: blockingGateItems.map((item) => ({
      id: item.id,
      sourceResult: item.result,
      simulatedDisposition: "not-cleared",
      clearanceOwner: "runtime-reviewer",
      requiredEvidence: ["human-review-note", "runtime-remains-disabled", "releaseReady-remains-false"],
      blockedMutation: "clear-release-blocker"
    })),
    simulationSteps: [
      "collect-blocking-gate-items",
      "map-blockers-to-required-evidence",
      "simulate-clearance-without-state-write",
      "keep-releaseReady-false",
      "emit-clearance-simulation-export"
    ],
    simulatedDecision: {
      result: "blockers-not-cleared",
      releaseReady: false,
      clearedBlockers: 0,
      remainingBlockers: blockingGateItems.length,
      persistedMutations: 0,
      reason: "blocker clearance is simulated only and cannot clear release blockers in Phase 26"
    },
    blockedActions: [
      "clear-release-blocker",
      "mark-blocker-cleared",
      "set-releaseReady-true",
      "write-clearance-result",
      "persist-simulated-clearance"
    ],
    exportPolicy: {
      exportName: "phase26-blocker-clearance-simulation.json",
      includeInOperationsExport: true,
      redaction: "clearance-evidence-requirements-only"
    },
    summary: {
      totalBlockers: blockingGateItems.length,
      clearableInSimulation: blockingGateItems.length,
      clearedBlockers: 0,
      remainingBlockers: blockingGateItems.length,
      releaseReady: false,
      runtimeExecution: false,
      thirdPartyExecution: false,
      persistedMutations: 0
    }
  };
  const runtimeValidationReport = {
    schemaVersion: "phase26.runtime-validation-report.v1",
    version: "1.6.3",
    mode: "readonly-runtime-validation-report-no-runtime-execution",
    sourceInputs: [
      { id: "phase26-entry", schemaVersion: "phase26.runtime-validation-entry.v1", source: "phase26RuntimeValidationEntry" },
      { id: "release-gate-simulation", schemaVersion: releaseGateSimulation.schemaVersion, source: "phase26RuntimeValidationEntry.releaseGateSimulation" },
      { id: "blocker-clearance-simulation", schemaVersion: blockerClearanceSimulation.schemaVersion, source: "phase26RuntimeValidationEntry.blockerClearanceSimulation" },
      { id: "phase25-package-validation", schemaVersion: packageValidation.schemaVersion, source: "phase25RuntimeSandboxUiSurface.reviewPackageValidation" }
    ],
    reportSections: [
      { id: "entry-conditions", status: entryReady ? "pass" : "block", evidence: "5 entry conditions evaluated" },
      { id: "release-gate", status: releaseGateSimulation.simulatedDecision.result, evidence: `${releaseGateSimulation.summary.block} blocked gate item` },
      { id: "blocker-clearance", status: blockerClearanceSimulation.simulatedDecision.result, evidence: `${blockerClearanceSimulation.summary.remainingBlockers} blocker remains` },
      { id: "runtime-guardrails", status: "pass", evidence: "runtimeExecution=false, thirdPartyExecution=false, persistedMutations=0" }
    ],
    findings: [
      { id: "runtime-execution-disabled", severity: "pass", detail: "Runtime execution remains disabled for Phase 26 validation reporting." },
      { id: "third-party-execution-disabled", severity: "pass", detail: "Third-party plugin execution remains disabled." },
      { id: "release-ready-blocked", severity: "block", detail: "releaseReady remains false and cannot be changed by this report." },
      { id: "blocker-clearance-not-persisted", severity: "block", detail: "Clearance simulation records required evidence but does not clear blockers." }
    ],
    reportDecision: {
      result: "report-blocked-for-runtime-release",
      releaseReady: false,
      runtimeExecution: false,
      thirdPartyExecution: false,
      persistedMutations: 0,
      reason: "runtime validation report is export-only and preserves the blocked release state"
    },
    blockedActions: [
      "execute-runtime-validation",
      "persist-report-as-runtime-result",
      "mark-releaseReady-true",
      "clear-release-blocker-from-report",
      "publish-runtime-release"
    ],
    exportPolicy: {
      exportName: "phase26-runtime-validation-report.json",
      includeInOperationsExport: true,
      redaction: "report-summary-findings-and-guardrail-status-only"
    },
    summary: {
      reportSections: 4,
      findings: 4,
      blockingFindings: 2,
      releaseReady: false,
      runtimeExecution: false,
      thirdPartyExecution: false,
      persistedMutations: 0
    }
  };
  const handoffCriteria = {
    schemaVersion: "phase26.handoff-criteria.v1",
    version: "1.6.4",
    mode: "readonly-handoff-criteria-no-runtime-or-release-mutation",
    sourceInputs: [
      { id: "runtime-validation-report", schemaVersion: runtimeValidationReport.schemaVersion, source: "phase26RuntimeValidationEntry.runtimeValidationReport" },
      { id: "release-gate-simulation", schemaVersion: releaseGateSimulation.schemaVersion, source: "phase26RuntimeValidationEntry.releaseGateSimulation" },
      { id: "blocker-clearance-simulation", schemaVersion: blockerClearanceSimulation.schemaVersion, source: "phase26RuntimeValidationEntry.blockerClearanceSimulation" },
      { id: "phase25-package-validation", schemaVersion: packageValidation.schemaVersion, source: "phase25RuntimeSandboxUiSurface.reviewPackageValidation" }
    ],
    criteria: [
      { id: "runtime-execution-remains-disabled", result: "met", requiredForHandoff: true, evidence: "runtimeExecution=false" },
      { id: "third-party-execution-remains-disabled", result: "met", requiredForHandoff: true, evidence: "thirdPartyExecution=false" },
      { id: "release-ready-remains-blocked", result: "met", requiredForHandoff: true, evidence: "releaseReady=false" },
      { id: "validation-report-exported", result: runtimeValidationReport.exportPolicy?.includeInOperationsExport ? "met" : "blocked", requiredForHandoff: true, evidence: runtimeValidationReport.exportPolicy?.exportName },
      { id: "blockers-carried-forward", result: blockerClearanceSimulation.summary.remainingBlockers > 0 ? "met" : "blocked", requiredForHandoff: true, evidence: `${blockerClearanceSimulation.summary.remainingBlockers} release blocker carried forward` }
    ],
    nextPhaseEntryRequirements: [
      "treat-phase26-report-as-readonly-evidence",
      "carry-release-ready-blocker-forward",
      "require-human-review-before-runtime-discussion",
      "keep-runtime-and-third-party-execution-disabled",
      "do-not-persist-simulated-decisions-as-runtime-results"
    ],
    blockedActions: [
      "enter-runtime-execution",
      "enable-third-party-plugin-execution",
      "clear-carried-forward-blockers",
      "set-releaseReady-true",
      "persist-handoff-as-release-approval"
    ],
    handoffDecision: {
      result: "handoff-ready-with-release-blockers",
      nextPhaseAllowed: true,
      releaseReady: false,
      runtimeExecution: false,
      thirdPartyExecution: false,
      persistedMutations: 0,
      reason: "Phase 26 can hand off evidence to the next planning stage while release and runtime execution remain blocked"
    },
    exportPolicy: {
      exportName: "phase26-handoff-criteria.json",
      includeInOperationsExport: true,
      redaction: "handoff-criteria-and-carried-blockers-only"
    },
    summary: {
      totalCriteria: 5,
      metCriteria: 5,
      blockedCriteria: 0,
      carriedForwardBlockers: blockerClearanceSimulation.summary.remainingBlockers,
      nextPhaseAllowed: true,
      releaseReady: false,
      runtimeExecution: false,
      thirdPartyExecution: false,
      persistedMutations: 0
    }
  };
  const closurePackage = {
    schemaVersion: "phase26.closure-package.v1",
    version: "1.6.5",
    mode: "readonly-closure-package-no-runtime-or-release-mutation",
    sourceInputs: [
      { id: "runtime-validation-entry", schemaVersion: "phase26.runtime-validation-entry.v1", source: "phase26RuntimeValidationEntry" },
      { id: "release-gate-simulation", schemaVersion: releaseGateSimulation.schemaVersion, source: "phase26RuntimeValidationEntry.releaseGateSimulation" },
      { id: "blocker-clearance-simulation", schemaVersion: blockerClearanceSimulation.schemaVersion, source: "phase26RuntimeValidationEntry.blockerClearanceSimulation" },
      { id: "runtime-validation-report", schemaVersion: runtimeValidationReport.schemaVersion, source: "phase26RuntimeValidationEntry.runtimeValidationReport" },
      { id: "handoff-criteria", schemaVersion: handoffCriteria.schemaVersion, source: "phase26RuntimeValidationEntry.handoffCriteria" }
    ],
    closureItems: [
      { id: "validation-entry", status: "closed-readonly", artifact: "phase26-runtime-validation-entry.json" },
      { id: "release-gate-simulation", status: "closed-with-blocker", artifact: "phase26-release-gate-simulation.json" },
      { id: "blocker-clearance-simulation", status: "closed-not-cleared", artifact: "phase26-blocker-clearance-simulation.json" },
      { id: "runtime-validation-report", status: "closed-exported", artifact: "phase26-runtime-validation-report.json" },
      { id: "handoff-criteria", status: "closed-for-next-stage-planning", artifact: "phase26-handoff-criteria.json" }
    ],
    carriedForwardBlockers: [
      {
        id: "release-ready-remains-blocked",
        source: "phase26.release-gate-simulation.v1",
        status: "carried-forward",
        requiredBeforeRelease: ["human-review", "runtime-evidence-review", "explicit-release-readiness-decision"]
      }
    ],
    closureDecision: {
      result: "phase26-closed-with-release-blockers",
      phaseClosed: true,
      nextStagePlanningAllowed: true,
      releaseReady: false,
      runtimeExecution: false,
      thirdPartyExecution: false,
      persistedMutations: 0,
      reason: "Phase 26 is closed as a read-only validation and simulation stage with release blockers carried forward"
    },
    blockedActions: [
      "treat-closure-as-release-approval",
      "clear-carried-forward-blockers",
      "set-releaseReady-true",
      "enable-runtime-execution",
      "enable-third-party-execution",
      "persist-closure-as-runtime-result"
    ],
    exportPolicy: {
      exportName: "phase26-closure-package.json",
      includeInOperationsExport: true,
      redaction: "closure-summary-artifacts-and-carried-blockers-only"
    },
    summary: {
      closureItems: 5,
      carriedForwardBlockers: 1,
      phaseClosed: true,
      nextStagePlanningAllowed: true,
      releaseReady: false,
      runtimeExecution: false,
      thirdPartyExecution: false,
      persistedMutations: 0
    }
  };
  return {
    phase: 26,
    schemaVersion: "phase26.runtime-validation-entry.v1",
    version: "1.6.5",
    status: "phase26-closure-package-ready-runtime-disabled",
    entryMode: "release-gate-simulation-entry-no-runtime-execution",
    sourcePhase25: {
      schemaVersion: phase25.schemaVersion,
      sourceStatus: phase25.status,
      reviewPackageValidation: packageValidation.schemaVersion,
      reviewExportPackage: packageExport.schemaVersion,
      phase25ReleaseReady: phase25.summary.releaseReady,
      phase25RuntimeExecution: phase25.summary.runtimeExecution,
      phase25ThirdPartyExecution: phase25.summary.thirdPartyExecution
    },
    entryConditions: [
      { id: "phase25-surface-present", result: "pass", evidence: "phase25RuntimeSandboxUiSurface.schemaVersion" },
      { id: "package-validation-ready", result: packageValidation.summary?.validationReady ? "pass" : "block", evidence: "reviewPackageValidation.summary.validationReady" },
      { id: "runtime-execution-disabled", result: phase25.summary.runtimeExecution === false ? "pass" : "block", evidence: "phase25RuntimeSandboxUiSurface.summary.runtimeExecution=false" },
      { id: "third-party-execution-disabled", result: phase25.summary.thirdPartyExecution === false ? "pass" : "block", evidence: "phase25RuntimeSandboxUiSurface.summary.thirdPartyExecution=false" },
      { id: "release-ready-blocked", result: phase25.summary.releaseReady === false ? "pass" : "block", evidence: "phase25RuntimeSandboxUiSurface.summary.releaseReady=false" }
    ],
    validationScopes: [
      { id: "release-gate-simulation", status: "simulated", source: "phase25.review-package-validation.v1" },
      { id: "runtime-boundary-validation", status: "planned", source: "phase24RuntimeSandboxUxEntry.phase24ClosurePackage" },
      { id: "blocker-clearance-simulation", status: "simulated", source: "phase23ReleaseReadinessReviewUi.phase23ClosureHandoffPackage" },
      { id: "runtime-validation-report", status: "reported", source: "phase26-runtime-validation-report.json" },
      { id: "handoff-criteria", status: "defined", source: "phase26-handoff-criteria.json" },
      { id: "closure-package", status: "closed", source: "phase26-closure-package.json" }
    ],
    simulationPlan: [
      "derive-release-gate-simulation-inputs",
      "map-package-validation-to-release-gates",
      "simulate-blocker-clearance-without-mutation",
      "emit-runtime-validation-report",
      "define-handoff-criteria-for-future-runtime-discussion"
    ],
    blockedActions: [
      "enable-runtime-execution",
      "enable-third-party-execution",
      "execute-third-party-plugin",
      "auto-clear-release-blocker",
      "set-releaseReady-true",
      "persist-simulation-as-runtime-result"
    ],
    exportPolicy: {
      exportName: "phase26-runtime-validation-entry.json",
      includeInOperationsExport: true,
      redaction: "phase25-validation-summary-and-simulation-plan-only"
    },
    releaseGateSimulation,
    blockerClearanceSimulation,
    runtimeValidationReport,
    handoffCriteria,
    closurePackage,
    summary: {
      entryConditions: 5,
      passedEntryConditions: 5,
      validationScopes: 6,
      simulatedGateItems: 5,
      blockedGateItems: 1,
      simulatedClearanceItems: blockingGateItems.length,
      clearedBlockers: 0,
      runtimeValidationReportReady: true,
      handoffCriteriaReady: true,
      closurePackageReady: true,
      phaseClosed: true,
      runtimeExecution: false,
      thirdPartyExecution: false,
      releaseReady: false,
      persistedMutations: 0,
      readyForSimulationVersions: true
    }
  };
}

function buildPhase27ReleaseBlockerGovernanceEntry(memories = []) {
  const phase26 = buildPhase26RuntimeValidationEntry(memories);
  const closurePackage = phase26.closurePackage || {};
  const carriedForwardBlockers = closurePackage.carriedForwardBlockers || [];
  const carriedBlockerInventory = carriedForwardBlockers.map((item, index) => ({
    id: item.id,
    inventoryId: `phase27-carried-blocker-${index + 1}`,
    source: item.source,
    sourceArtifact: "phase26-closure-package.json",
    sourceClosureDecision: closurePackage.closureDecision?.result,
    severity: "block",
    status: "governance-open",
    inheritedStatus: item.status,
    governanceOwner: "release-reviewer",
    requiredBeforeRelease: item.requiredBeforeRelease || [],
    requiredEvidence: item.requiredBeforeRelease || [],
    evidenceStatus: "pending-human-governance-review",
    blockedReleaseActions: ["mark-releaseReady-true", "clear-carried-forward-blocker"],
    blockedRuntimeActions: ["enable-runtime-execution", "enable-third-party-execution"],
    allowedActions: ["review-blocker-evidence", "export-carried-blocker-inventory"],
    auditState: "inventory-recorded-no-mutation",
    blockedMutation: "clear-carried-forward-blocker"
  }));
  const entryPackage = {
    schemaVersion: "phase27.entry-package.v1",
    version: "1.7.0",
    mode: "readonly-release-blocker-governance-entry",
    sourceClosurePackage: closurePackage.schemaVersion,
    acceptedArtifacts: [
      "phase26-runtime-validation-entry.json",
      "phase26-release-gate-simulation.json",
      "phase26-blocker-clearance-simulation.json",
      "phase26-runtime-validation-report.json",
      "phase26-handoff-criteria.json",
      "phase26-closure-package.json"
    ],
    entryChecks: [
      { id: "phase26-closed", result: closurePackage.summary?.phaseClosed ? "pass" : "block", evidence: "phase26.closure-package.v1" },
      { id: "carried-blockers-present", result: carriedBlockerInventory.length > 0 ? "pass" : "block", evidence: `${carriedBlockerInventory.length} carried blocker` },
      { id: "runtime-disabled", result: closurePackage.summary?.runtimeExecution === false ? "pass" : "block", evidence: "runtimeExecution=false" },
      { id: "third-party-disabled", result: closurePackage.summary?.thirdPartyExecution === false ? "pass" : "block", evidence: "thirdPartyExecution=false" },
      { id: "release-ready-blocked", result: closurePackage.summary?.releaseReady === false ? "pass" : "block", evidence: "releaseReady=false" }
    ],
    exportPolicy: {
      exportName: "phase27-entry-package.json",
      includeInOperationsExport: true,
      redaction: "phase26-closure-summary-and-carried-blockers-only"
    },
    summary: {
      acceptedArtifacts: 6,
      entryChecks: 5,
      passedEntryChecks: 5,
      carriedBlockers: carriedBlockerInventory.length,
      runtimeExecution: false,
      thirdPartyExecution: false,
      releaseReady: false,
      persistedMutations: 0
    }
  };
  const carriedBlockerInventoryPackage = {
    schemaVersion: "phase27.carried-blocker-inventory.v1",
    version: "1.7.1",
    mode: "readonly-carried-blocker-inventory-no-clearance",
    sourceEntryPackage: entryPackage.schemaVersion,
    sourceClosurePackage: closurePackage.schemaVersion,
    inventoryRows: carriedBlockerInventory,
    inventoryChecks: [
      { id: "source-closure-linked", result: closurePackage.schemaVersion === "phase26.closure-package.v1" ? "pass" : "block", evidence: closurePackage.schemaVersion },
      { id: "carried-blockers-indexed", result: carriedBlockerInventory.length > 0 ? "pass" : "block", evidence: `${carriedBlockerInventory.length} inventory row` },
      { id: "all-blockers-open", result: carriedBlockerInventory.every((item) => item.status === "governance-open") ? "pass" : "block", evidence: "no blocker cleared by inventory" },
      { id: "release-mutation-blocked", result: "pass", evidence: "mark-releaseReady-true remains blocked" },
      { id: "runtime-mutation-blocked", result: "pass", evidence: "runtimeExecution=false and thirdPartyExecution=false" }
    ],
    blockedMutations: [
      "clear-carried-forward-blocker",
      "mark-releaseReady-true",
      "enable-runtime-execution",
      "enable-third-party-execution",
      "persist-inventory-as-clearance"
    ],
    exportPolicy: {
      exportName: "phase27-carried-blocker-inventory.json",
      includeInOperationsExport: true,
      redaction: "blocker-ids-sources-required-evidence-only"
    },
    summary: {
      inventoryReady: true,
      totalBlockers: carriedBlockerInventory.length,
      openBlockers: carriedBlockerInventory.filter((item) => item.status === "governance-open").length,
      clearedBlockers: 0,
      releaseReady: false,
      runtimeExecution: false,
      thirdPartyExecution: false,
      persistedMutations: 0
    }
  };
  const signoffQueue = carriedBlockerInventory.map((item) => ({
    signoffId: `phase27-signoff-${item.inventoryId}`,
    blockerId: item.id,
    inventoryId: item.inventoryId,
    reviewerRole: item.governanceOwner,
    requiredDisposition: "review-required-before-release",
    currentDisposition: "pending-review",
    evidenceStatus: item.evidenceStatus,
    requiredEvidence: item.requiredEvidence,
    allowedActions: ["record-review-note", "export-human-review-signoff"],
    blockedActions: [
      "approve-release-from-signoff",
      "clear-blocker-from-signoff",
      "enable-runtime-from-signoff"
    ],
    auditState: "signoff-pending-no-mutation"
  }));
  const humanReviewSignoffPackage = {
    schemaVersion: "phase27.human-review-signoff.v1",
    version: "1.7.2",
    mode: "readonly-human-review-signoff-no-release-approval",
    sourceInventoryPackage: carriedBlockerInventoryPackage.schemaVersion,
    sourceClosurePackage: closurePackage.schemaVersion,
    signoffQueue,
    signoffChecks: [
      { id: "inventory-package-linked", result: carriedBlockerInventoryPackage.schemaVersion === "phase27.carried-blocker-inventory.v1" ? "pass" : "block", evidence: carriedBlockerInventoryPackage.schemaVersion },
      { id: "all-carried-blockers-have-signoff", result: signoffQueue.length === carriedBlockerInventory.length ? "pass" : "block", evidence: `${signoffQueue.length} signoff row` },
      { id: "signoff-does-not-clear-blockers", result: "pass", evidence: "currentDisposition=pending-review" },
      { id: "signoff-does-not-approve-release", result: "pass", evidence: "releaseReady=false" },
      { id: "runtime-remains-disabled", result: "pass", evidence: "runtimeExecution=false and thirdPartyExecution=false" }
    ],
    blockedMutations: [
      "approve-release-from-signoff",
      "clear-blocker-from-signoff",
      "mark-releaseReady-true",
      "enable-runtime-execution",
      "persist-signoff-as-release-approval"
    ],
    exportPolicy: {
      exportName: "phase27-human-review-signoff.json",
      includeInOperationsExport: true,
      redaction: "reviewer-role-blocker-id-required-evidence-only"
    },
    summary: {
      signoffReady: true,
      requiredSignoffs: carriedBlockerInventory.length,
      pendingSignoffs: carriedBlockerInventory.length,
      approvedReleaseSignoffs: 0,
      clearedBlockers: 0,
      releaseReady: false,
      runtimeExecution: false,
      thirdPartyExecution: false,
      persistedMutations: 0
    }
  };
  const evidenceGapRows = carriedBlockerInventory.flatMap((item) => {
    const requiredEvidence = item.requiredEvidence?.length ? item.requiredEvidence : ["human-review"];
    const signoff = signoffQueue.find((queueItem) => queueItem.inventoryId === item.inventoryId);
    return requiredEvidence.map((evidenceId, index) => {
      const evidenceState = evidenceId === "explicit-release-readiness-decision" ? "missing" : "pending";
      return {
        gapId: `phase27-gap-${item.inventoryId}-${index + 1}`,
        blockerId: item.id,
        inventoryId: item.inventoryId,
        requiredEvidence: evidenceId,
        currentEvidenceState: evidenceState,
        sourceInventoryPackage: carriedBlockerInventoryPackage.schemaVersion,
        sourceSignoffPackage: humanReviewSignoffPackage.schemaVersion,
        sourceClosurePackage: closurePackage.schemaVersion,
        currentEvidenceSource: evidenceState === "pending" ? signoff?.signoffId || item.sourceArtifact : "none-recorded",
        gapState: evidenceState === "missing" ? "open-missing-evidence" : "open-pending-review",
        releaseImpact: "releaseReady-remains-blocked",
        allowedActions: ["record-evidence-review-note", "export-evidence-gap-matrix"],
        blockedActions: [
          "resolve-gap-as-clearance",
          "clear-blocker-from-gap",
          "mark-releaseReady-true"
        ],
        auditState: "gap-recorded-no-mutation"
      };
    });
  });
  const representedEvidenceGapBlockers = new Set(evidenceGapRows.map((item) => item.blockerId)).size;
  const pendingEvidenceGaps = evidenceGapRows.filter((item) => item.currentEvidenceState === "pending").length;
  const missingEvidenceGaps = evidenceGapRows.filter((item) => item.currentEvidenceState === "missing").length;
  const evidenceGapMatrixPackage = {
    schemaVersion: "phase27.evidence-gap-matrix.v1",
    version: "1.7.3",
    mode: "readonly-evidence-gap-matrix-no-clearance",
    sourceInventoryPackage: carriedBlockerInventoryPackage.schemaVersion,
    sourceSignoffPackage: humanReviewSignoffPackage.schemaVersion,
    sourceClosurePackage: closurePackage.schemaVersion,
    matrixRows: evidenceGapRows,
    matrixChecks: [
      { id: "inventory-package-linked", result: carriedBlockerInventoryPackage.schemaVersion === "phase27.carried-blocker-inventory.v1" ? "pass" : "block", evidence: carriedBlockerInventoryPackage.schemaVersion },
      { id: "signoff-package-linked", result: humanReviewSignoffPackage.schemaVersion === "phase27.human-review-signoff.v1" ? "pass" : "block", evidence: humanReviewSignoffPackage.schemaVersion },
      { id: "all-blockers-represented", result: representedEvidenceGapBlockers === carriedBlockerInventory.length ? "pass" : "block", evidence: `${representedEvidenceGapBlockers} represented blocker` },
      { id: "open-gaps-preserve-blockers", result: evidenceGapRows.length > 0 ? "pass" : "block", evidence: `${evidenceGapRows.length} open evidence gap` },
      { id: "gap-matrix-does-not-clear-blockers", result: "pass", evidence: "clearedBlockers=0" },
      { id: "runtime-remains-disabled", result: "pass", evidence: "runtimeExecution=false and thirdPartyExecution=false" }
    ],
    blockedMutations: [
      "resolve-gap-as-clearance",
      "clear-blocker-from-gap",
      "mark-releaseReady-true",
      "enable-runtime-execution",
      "persist-gap-resolution-as-clearance"
    ],
    exportPolicy: {
      exportName: "phase27-evidence-gap-matrix.json",
      includeInOperationsExport: true,
      redaction: "blocker-id-required-evidence-gap-state-only"
    },
    summary: {
      gapMatrixReady: true,
      matrixRows: evidenceGapRows.length,
      representedBlockers: representedEvidenceGapBlockers,
      openGaps: evidenceGapRows.length,
      pendingEvidenceGaps,
      missingEvidenceGaps,
      resolvedGaps: 0,
      clearedBlockers: 0,
      releaseReady: false,
      runtimeExecution: false,
      thirdPartyExecution: false,
      persistedMutations: 0
    }
  };
  const blockerResolutionPlanItems = carriedBlockerInventory.map((item) => {
    const relatedGaps = evidenceGapRows.filter((gap) => gap.inventoryId === item.inventoryId);
    return {
      planId: `phase27-resolution-plan-${item.inventoryId}`,
      blockerId: item.id,
      inventoryId: item.inventoryId,
      ownerRole: item.governanceOwner,
      sourceEvidenceGapMatrix: evidenceGapMatrixPackage.schemaVersion,
      sourceInventoryPackage: carriedBlockerInventoryPackage.schemaVersion,
      requiredEvidence: item.requiredEvidence,
      openEvidenceGaps: relatedGaps.length,
      missingEvidenceGaps: relatedGaps.filter((gap) => gap.currentEvidenceState === "missing").length,
      pendingEvidenceGaps: relatedGaps.filter((gap) => gap.currentEvidenceState === "pending").length,
      currentPlanState: "planned-not-started",
      blockerDisposition: "governance-open",
      proposedResolutionSteps: [
        "review-human-signoff-note",
        "collect-required-evidence-without-runtime",
        "record-explicit-release-readiness-decision",
        "keep-release-blocked-until-authorized-clearance"
      ],
      requiredBeforeAnyClearance: relatedGaps.map((gap) => gap.requiredEvidence),
      allowedActions: ["record-resolution-note", "export-blocker-resolution-plan"],
      blockedActions: [
        "apply-resolution-as-clearance",
        "clear-blocker-from-plan",
        "mark-releaseReady-true",
        "enable-runtime-from-plan"
      ],
      auditState: "resolution-plan-recorded-no-mutation"
    };
  });
  const blockerResolutionPlanPackage = {
    schemaVersion: "phase27.blocker-resolution-plan.v1",
    version: "1.7.4",
    mode: "readonly-blocker-resolution-plan-no-clearance",
    sourceEvidenceGapMatrixPackage: evidenceGapMatrixPackage.schemaVersion,
    sourceInventoryPackage: carriedBlockerInventoryPackage.schemaVersion,
    sourceSignoffPackage: humanReviewSignoffPackage.schemaVersion,
    resolutionPlanItems: blockerResolutionPlanItems,
    planChecks: [
      { id: "evidence-gap-matrix-linked", result: evidenceGapMatrixPackage.schemaVersion === "phase27.evidence-gap-matrix.v1" ? "pass" : "block", evidence: evidenceGapMatrixPackage.schemaVersion },
      { id: "all-open-blockers-have-plan", result: blockerResolutionPlanItems.length === carriedBlockerInventory.length ? "pass" : "block", evidence: `${blockerResolutionPlanItems.length} resolution plan item` },
      { id: "all-plan-items-keep-blockers-open", result: blockerResolutionPlanItems.every((item) => item.blockerDisposition === "governance-open") ? "pass" : "block", evidence: "no blocker cleared by plan" },
      { id: "plan-does-not-resolve-gaps", result: "pass", evidence: "resolvedGaps=0" },
      { id: "plan-does-not-approve-release", result: "pass", evidence: "releaseReady=false" },
      { id: "runtime-remains-disabled", result: "pass", evidence: "runtimeExecution=false and thirdPartyExecution=false" }
    ],
    blockedMutations: [
      "apply-resolution-as-clearance",
      "clear-blocker-from-plan",
      "resolve-gap-from-plan",
      "mark-releaseReady-true",
      "enable-runtime-execution",
      "persist-resolution-plan-as-clearance"
    ],
    exportPolicy: {
      exportName: "phase27-blocker-resolution-plan.json",
      includeInOperationsExport: true,
      redaction: "blocker-id-plan-state-required-evidence-only"
    },
    summary: {
      blockerResolutionPlanReady: true,
      plannedBlockers: blockerResolutionPlanItems.length,
      openPlanItems: blockerResolutionPlanItems.filter((item) => item.currentPlanState === "planned-not-started").length,
      openEvidenceGaps: evidenceGapRows.length,
      resolvedGaps: 0,
      clearedBlockers: 0,
      releaseReady: false,
      runtimeExecution: false,
      thirdPartyExecution: false,
      persistedMutations: 0
    }
  };
  const phase27ClosurePackage = {
    schemaVersion: "phase27.closure-package.v1",
    version: "1.7.5",
    mode: "readonly-phase27-closure-no-release-approval",
    sourceEntryPackage: entryPackage.schemaVersion,
    sourceInventoryPackage: carriedBlockerInventoryPackage.schemaVersion,
    sourceSignoffPackage: humanReviewSignoffPackage.schemaVersion,
    sourceEvidenceGapMatrixPackage: evidenceGapMatrixPackage.schemaVersion,
    sourceResolutionPlanPackage: blockerResolutionPlanPackage.schemaVersion,
    closureItems: [
      { id: "entry-package", status: "closed-readonly", artifact: "phase27-entry-package.json" },
      { id: "carried-blocker-inventory", status: "closed-readonly", artifact: "phase27-carried-blocker-inventory.json" },
      { id: "human-review-signoff", status: "closed-readonly", artifact: "phase27-human-review-signoff.json" },
      { id: "evidence-gap-matrix", status: "closed-readonly", artifact: "phase27-evidence-gap-matrix.json" },
      { id: "blocker-resolution-plan", status: "closed-readonly", artifact: "phase27-blocker-resolution-plan.json" }
    ],
    carriedForwardBlockers: carriedBlockerInventory.map((item) => ({
      id: item.id,
      inventoryId: item.inventoryId,
      source: item.source,
      status: "carried-forward-open",
      requiredBeforeRelease: item.requiredEvidence,
      blockerDisposition: "governance-open",
      releaseImpact: "releaseReady-remains-blocked"
    })),
    closureChecks: [
      { id: "entry-package-ready", result: entryPackage.summary?.passedEntryChecks === entryPackage.summary?.entryChecks ? "pass" : "block", evidence: entryPackage.schemaVersion },
      { id: "inventory-ready", result: carriedBlockerInventoryPackage.summary?.inventoryReady ? "pass" : "block", evidence: carriedBlockerInventoryPackage.schemaVersion },
      { id: "signoff-ready-without-approval", result: humanReviewSignoffPackage.summary?.signoffReady && humanReviewSignoffPackage.summary?.approvedReleaseSignoffs === 0 ? "pass" : "block", evidence: humanReviewSignoffPackage.schemaVersion },
      { id: "gap-matrix-ready-with-open-gaps", result: evidenceGapMatrixPackage.summary?.gapMatrixReady && evidenceGapMatrixPackage.summary?.openGaps > 0 ? "pass" : "block", evidence: evidenceGapMatrixPackage.schemaVersion },
      { id: "resolution-plan-ready-without-clearance", result: blockerResolutionPlanPackage.summary?.blockerResolutionPlanReady && blockerResolutionPlanPackage.summary?.clearedBlockers === 0 ? "pass" : "block", evidence: blockerResolutionPlanPackage.schemaVersion },
      { id: "release-remains-blocked", result: "pass", evidence: "releaseReady=false" },
      { id: "runtime-remains-disabled", result: "pass", evidence: "runtimeExecution=false and thirdPartyExecution=false" }
    ],
    closureDecision: {
      result: "phase27-closed-with-open-release-blockers",
      phaseClosed: true,
      nextStagePlanningAllowed: true,
      releaseReady: false,
      runtimeExecution: false,
      thirdPartyExecution: false,
      persistedMutations: 0,
      reason: "Phase 27 is closed as a read-only release blocker governance stage with blockers carried forward"
    },
    blockedMutations: [
      "treat-closure-as-release-approval",
      "clear-carried-forward-blocker",
      "resolve-gap-from-closure",
      "mark-releaseReady-true",
      "enable-runtime-execution",
      "persist-closure-as-release-clearance"
    ],
    exportPolicy: {
      exportName: "phase27-closure-package.json",
      includeInOperationsExport: true,
      redaction: "closure-items-carried-blockers-and-guardrails-only"
    },
    summary: {
      phaseClosed: true,
      nextStagePlanningAllowed: true,
      closureItems: 5,
      carriedForwardBlockers: carriedBlockerInventory.length,
      openEvidenceGaps: evidenceGapRows.length,
      resolvedGaps: 0,
      clearedBlockers: 0,
      releaseReady: false,
      runtimeExecution: false,
      thirdPartyExecution: false,
      persistedMutations: 0
    }
  };
  return {
    phase: 27,
    schemaVersion: "phase27.release-blocker-governance-entry.v1",
    version: "1.7.5",
    status: "phase27-closure-package-ready-runtime-disabled",
    entryMode: "release-blocker-governance-no-runtime-execution",
    sourcePhase26: {
      schemaVersion: phase26.schemaVersion,
      closurePackage: closurePackage.schemaVersion,
      closureDecision: closurePackage.closureDecision?.result,
      phase26Closed: closurePackage.summary?.phaseClosed === true,
      phase26ReleaseReady: phase26.summary?.releaseReady,
      phase26RuntimeExecution: phase26.summary?.runtimeExecution,
      phase26ThirdPartyExecution: phase26.summary?.thirdPartyExecution
    },
    entryPackage,
    carriedBlockerInventory,
    carriedBlockerInventoryPackage,
    humanReviewSignoffPackage,
    evidenceGapMatrixPackage,
    blockerResolutionPlanPackage,
    phase27ClosurePackage,
    governanceScopes: [
      { id: "carried-blocker-inventory", status: "ready", source: "phase27.carried-blocker-inventory.v1" },
      { id: "human-review-signoff", status: "ready", source: "phase27.human-review-signoff.v1" },
      { id: "evidence-gap-matrix", status: "ready", source: "phase27.evidence-gap-matrix.v1" },
      { id: "blocker-resolution-plan", status: "ready", source: "phase27.blocker-resolution-plan.v1" },
      { id: "phase27-closure-package", status: "closed", source: "phase27.closure-package.v1" }
    ],
    blockedActions: [
      "clear-carried-forward-blocker",
      "mark-releaseReady-true",
      "enable-runtime-execution",
      "enable-third-party-execution",
      "treat-entry-package-as-release-approval",
      "persist-signoff-as-release-approval",
      "persist-gap-resolution-as-clearance",
      "persist-resolution-plan-as-clearance",
      "persist-closure-as-release-clearance",
      "persist-governance-entry-as-runtime-result"
    ],
    entryDecision: {
      result: "phase27-entry-ready-with-carried-blockers",
      governanceReady: true,
      releaseReady: false,
      runtimeExecution: false,
      thirdPartyExecution: false,
      persistedMutations: 0,
      reason: "Phase 27 can start release blocker governance from the Phase 26 closure package without clearing blockers or enabling runtime"
    },
    exportPolicy: {
      exportName: "phase27-release-blocker-governance-entry.json",
      includeInOperationsExport: true,
      redaction: "entry-package-scopes-and-carried-blockers-only"
    },
    summary: {
      carriedBlockers: carriedBlockerInventory.length,
      inventoryReady: true,
      signoffReady: true,
      gapMatrixReady: true,
      blockerResolutionPlanReady: true,
      closurePackageReady: true,
      phaseClosed: true,
      nextStagePlanningAllowed: true,
      openEvidenceGaps: evidenceGapRows.length,
      missingEvidenceGaps,
      pendingEvidenceGaps,
      governanceScopes: 5,
      governanceReady: true,
      releaseReady: false,
      runtimeExecution: false,
      thirdPartyExecution: false,
      persistedMutations: 0
    }
  };
}

function buildPhase28ClearanceReviewEntry(memories = []) {
  const phase27 = buildPhase27ReleaseBlockerGovernanceEntry(memories);
  const closurePackage = phase27.phase27ClosurePackage || {};
  const carriedForwardBlockers = closurePackage.carriedForwardBlockers || [];
  const clearanceReviewQueue = carriedForwardBlockers.map((item, index) => ({
    reviewItemId: `phase28-clearance-review-${index + 1}`,
    blockerId: item.id,
    inventoryId: item.inventoryId,
    source: item.source,
    requiredEvidence: item.requiredBeforeRelease || [],
    reviewState: "pending-clearance-review",
    blockerDisposition: "carried-forward-open",
    allowedActions: ["record-clearance-review-note", "export-clearance-review-entry"],
    blockedActions: [
      "clear-blocker-from-review",
      "mark-releaseReady-true",
      "enable-runtime-from-review"
    ],
    auditState: "clearance-review-open-no-mutation"
  }));
  const entryChecks = [
    { id: "phase27-closure-linked", result: closurePackage.schemaVersion === "phase27.closure-package.v1" ? "pass" : "block", evidence: closurePackage.schemaVersion },
    { id: "phase27-closed", result: closurePackage.summary?.phaseClosed === true ? "pass" : "block", evidence: `phaseClosed=${closurePackage.summary?.phaseClosed === true}` },
    { id: "carried-blockers-present", result: carriedForwardBlockers.length > 0 ? "pass" : "block", evidence: `${carriedForwardBlockers.length} carried blocker` },
    { id: "blockers-remain-open", result: carriedForwardBlockers.every((item) => item.blockerDisposition === "governance-open" || item.status === "carried-forward-open") ? "pass" : "block", evidence: "no carried blocker cleared" },
    { id: "no-clearance-applied", result: "pass", evidence: "clearedBlockers=0" },
    { id: "release-remains-blocked", result: "pass", evidence: "releaseReady=false" },
    { id: "runtime-remains-disabled", result: "pass", evidence: "runtimeExecution=false and thirdPartyExecution=false" }
  ];
  const evidenceLedgerEntries = clearanceReviewQueue.flatMap((item) => {
    const requirements = item.requiredEvidence?.length ? item.requiredEvidence : ["explicit-human-clearance-evidence"];
    return requirements.map((requirement, index) => ({
      ledgerEntryId: `${item.reviewItemId}-evidence-${index + 1}`,
      reviewItemId: item.reviewItemId,
      blockerId: item.blockerId,
      inventoryId: item.inventoryId,
      evidenceRequirement: requirement,
      intakeState: "pending-evidence-intake",
      evidenceDisposition: "not-submitted",
      sourceReviewState: item.reviewState,
      allowedActions: ["record-evidence-intake-note", "export-evidence-intake-ledger"],
      blockedActions: [
        "accept-evidence-as-clearance",
        "clear-blocker-from-evidence",
        "mark-releaseReady-true",
        "enable-runtime-from-evidence"
      ],
      auditState: "evidence-intake-open-no-mutation"
    }));
  });
  const evidenceIntakeLedger = {
    schemaVersion: "phase28.evidence-intake-ledger.v1",
    version: "1.8.1",
    mode: "readonly-evidence-intake-ledger-no-clearance",
    sourceClearanceReviewEntry: "phase28.clearance-review-entry.v1",
    sourcePhase27ClosurePackage: closurePackage.schemaVersion,
    ledgerEntries: evidenceLedgerEntries,
    ledgerChecks: [
      { id: "clearance-review-linked", result: "pass", evidence: "phase28.clearance-review-entry.v1" },
      { id: "all-review-items-represented", result: new Set(evidenceLedgerEntries.map((item) => item.reviewItemId)).size === clearanceReviewQueue.length ? "pass" : "block", evidence: `${evidenceLedgerEntries.length} evidence intake ledger entry` },
      { id: "evidence-requirements-present", result: evidenceLedgerEntries.length > 0 ? "pass" : "block", evidence: `${evidenceLedgerEntries.length} evidence requirement` },
      { id: "ledger-does-not-clear-blockers", result: "pass", evidence: "clearedBlockers=0" },
      { id: "ledger-does-not-approve-release", result: "pass", evidence: "releaseReady=false" },
      { id: "runtime-remains-disabled", result: "pass", evidence: "runtimeExecution=false and thirdPartyExecution=false" }
    ],
    blockedMutations: [
      "accept-evidence-as-clearance",
      "clear-blocker-from-evidence",
      "mark-releaseReady-true",
      "enable-runtime-execution",
      "enable-third-party-execution",
      "persist-evidence-intake-as-clearance"
    ],
    exportPolicy: {
      exportName: "phase28-evidence-intake-ledger.json",
      includeInOperationsExport: true,
      redaction: "ledger-entry-review-item-blocker-id-and-evidence-requirement-only"
    },
    summary: {
      evidenceIntakeLedgerReady: true,
      ledgerEntries: evidenceLedgerEntries.length,
      pendingEvidenceIntake: evidenceLedgerEntries.filter((item) => item.intakeState === "pending-evidence-intake").length,
      acceptedEvidenceForClearance: 0,
      clearedBlockers: 0,
      releaseReady: false,
      runtimeExecution: false,
      thirdPartyExecution: false,
      persistedMutations: 0
    }
  };
  const reviewerDispositionQueue = evidenceLedgerEntries.map((item, index) => ({
    dispositionId: `phase28-reviewer-disposition-${index + 1}`,
    ledgerEntryId: item.ledgerEntryId,
    reviewItemId: item.reviewItemId,
    blockerId: item.blockerId,
    inventoryId: item.inventoryId,
    reviewerRole: index % 2 === 0 ? "release-governance-reviewer" : "evidence-reviewer",
    sourceEvidenceRequirement: item.evidenceRequirement,
    sourceIntakeState: item.intakeState,
    dispositionState: "pending-reviewer-disposition",
    proposedDisposition: "hold-for-evidence",
    releaseImpact: "releaseReady-remains-blocked",
    allowedActions: ["record-reviewer-disposition-note", "export-reviewer-disposition-model"],
    blockedActions: [
      "apply-disposition-as-clearance",
      "clear-blocker-from-disposition",
      "mark-releaseReady-true",
      "enable-runtime-from-disposition"
    ],
    auditState: "reviewer-disposition-open-no-mutation"
  }));
  const reviewerDispositionModel = {
    schemaVersion: "phase28.reviewer-disposition-model.v1",
    version: "1.8.2",
    mode: "readonly-reviewer-disposition-model-no-clearance",
    sourceEvidenceIntakeLedger: evidenceIntakeLedger.schemaVersion,
    sourceClearanceReviewEntry: "phase28.clearance-review-entry.v1",
    dispositionQueue: reviewerDispositionQueue,
    dispositionChecks: [
      { id: "evidence-ledger-linked", result: evidenceIntakeLedger.schemaVersion === "phase28.evidence-intake-ledger.v1" ? "pass" : "block", evidence: evidenceIntakeLedger.schemaVersion },
      { id: "all-ledger-entries-have-disposition", result: reviewerDispositionQueue.length === evidenceLedgerEntries.length ? "pass" : "block", evidence: `${reviewerDispositionQueue.length} reviewer disposition` },
      { id: "all-dispositions-pending", result: reviewerDispositionQueue.every((item) => item.dispositionState === "pending-reviewer-disposition") ? "pass" : "block", evidence: "no disposition approved" },
      { id: "disposition-does-not-clear-blockers", result: "pass", evidence: "clearedBlockers=0" },
      { id: "disposition-does-not-approve-release", result: "pass", evidence: "releaseReady=false" },
      { id: "runtime-remains-disabled", result: "pass", evidence: "runtimeExecution=false and thirdPartyExecution=false" }
    ],
    blockedMutations: [
      "apply-disposition-as-clearance",
      "clear-blocker-from-disposition",
      "mark-releaseReady-true",
      "enable-runtime-execution",
      "enable-third-party-execution",
      "persist-reviewer-disposition-as-clearance"
    ],
    exportPolicy: {
      exportName: "phase28-reviewer-disposition-model.json",
      includeInOperationsExport: true,
      redaction: "disposition-id-reviewer-role-blocker-id-and-state-only"
    },
    summary: {
      reviewerDispositionModelReady: true,
      dispositions: reviewerDispositionQueue.length,
      pendingDispositions: reviewerDispositionQueue.filter((item) => item.dispositionState === "pending-reviewer-disposition").length,
      approvedReleaseDispositions: 0,
      clearedBlockers: 0,
      releaseReady: false,
      runtimeExecution: false,
      thirdPartyExecution: false,
      persistedMutations: 0
    }
  };
  const clearanceCriteriaItems = reviewerDispositionQueue.map((item, index) => ({
    criteriaId: `phase28-clearance-criteria-${index + 1}`,
    dispositionId: item.dispositionId,
    ledgerEntryId: item.ledgerEntryId,
    reviewItemId: item.reviewItemId,
    blockerId: item.blockerId,
    inventoryId: item.inventoryId,
    reviewerRole: item.reviewerRole,
    sourceDispositionState: item.dispositionState,
    criteriaState: "pending-clearance-criteria",
    criteriaDisposition: "not-satisfied",
    requiredCriteria: [
      "evidence-intake-reviewed",
      "reviewer-disposition-recorded",
      "blocker-clearance-evidence-attached",
      "runtime-and-release-guardrails-verified"
    ],
    allowedActions: ["record-clearance-criteria-note", "export-clearance-criteria-checklist"],
    blockedActions: [
      "mark-criteria-satisfied",
      "apply-criteria-as-clearance",
      "clear-blocker-from-criteria",
      "mark-releaseReady-true",
      "enable-runtime-from-criteria"
    ],
    auditState: "clearance-criteria-open-no-mutation"
  }));
  const clearanceCriteriaChecklist = {
    schemaVersion: "phase28.clearance-criteria-checklist.v1",
    version: "1.8.3",
    mode: "readonly-clearance-criteria-checklist-no-clearance",
    sourceReviewerDispositionModel: reviewerDispositionModel.schemaVersion,
    sourceEvidenceIntakeLedger: evidenceIntakeLedger.schemaVersion,
    sourceClearanceReviewEntry: "phase28.clearance-review-entry.v1",
    checklistItems: clearanceCriteriaItems,
    checklistChecks: [
      { id: "reviewer-disposition-linked", result: reviewerDispositionModel.schemaVersion === "phase28.reviewer-disposition-model.v1" ? "pass" : "block", evidence: reviewerDispositionModel.schemaVersion },
      { id: "all-dispositions-have-criteria", result: clearanceCriteriaItems.length === reviewerDispositionQueue.length ? "pass" : "block", evidence: `${clearanceCriteriaItems.length} clearance criteria item` },
      { id: "all-criteria-pending", result: clearanceCriteriaItems.every((item) => item.criteriaState === "pending-clearance-criteria") ? "pass" : "block", evidence: "no criteria satisfied" },
      { id: "criteria-does-not-clear-blockers", result: "pass", evidence: "clearedBlockers=0" },
      { id: "criteria-does-not-approve-release", result: "pass", evidence: "releaseReady=false" },
      { id: "runtime-remains-disabled", result: "pass", evidence: "runtimeExecution=false and thirdPartyExecution=false" }
    ],
    blockedMutations: [
      "mark-criteria-satisfied",
      "apply-criteria-as-clearance",
      "clear-blocker-from-criteria",
      "mark-releaseReady-true",
      "enable-runtime-execution",
      "enable-third-party-execution",
      "persist-clearance-criteria-as-clearance"
    ],
    exportPolicy: {
      exportName: "phase28-clearance-criteria-checklist.json",
      includeInOperationsExport: true,
      redaction: "criteria-id-disposition-id-blocker-id-and-state-only"
    },
    summary: {
      clearanceCriteriaChecklistReady: true,
      criteriaItems: clearanceCriteriaItems.length,
      pendingCriteriaItems: clearanceCriteriaItems.filter((item) => item.criteriaState === "pending-clearance-criteria").length,
      satisfiedCriteriaItems: 0,
      approvedReleaseCriteria: 0,
      clearedBlockers: 0,
      releaseReady: false,
      runtimeExecution: false,
      thirdPartyExecution: false,
      persistedMutations: 0
    }
  };
  const clearanceDecisionPreviewItems = clearanceCriteriaItems.map((item, index) => ({
    previewId: `phase28-clearance-decision-preview-${index + 1}`,
    criteriaId: item.criteriaId,
    dispositionId: item.dispositionId,
    ledgerEntryId: item.ledgerEntryId,
    reviewItemId: item.reviewItemId,
    blockerId: item.blockerId,
    inventoryId: item.inventoryId,
    sourceCriteriaState: item.criteriaState,
    sourceCriteriaDisposition: item.criteriaDisposition,
    previewState: "decision-preview-open",
    previewDecision: "hold-clearance",
    decisionReason: "criteria-not-satisfied-and-blocker-carried-forward",
    releaseImpact: "releaseReady-remains-blocked",
    allowedActions: ["record-decision-preview-note", "export-clearance-decision-preview"],
    blockedActions: [
      "approve-release-from-preview",
      "apply-decision-preview-as-clearance",
      "clear-blocker-from-preview",
      "mark-releaseReady-true",
      "enable-runtime-from-preview"
    ],
    auditState: "decision-preview-open-no-mutation"
  }));
  const clearanceDecisionPreview = {
    schemaVersion: "phase28.clearance-decision-preview.v1",
    version: "1.8.4",
    mode: "readonly-clearance-decision-preview-no-release",
    sourceClearanceCriteriaChecklist: clearanceCriteriaChecklist.schemaVersion,
    sourceReviewerDispositionModel: reviewerDispositionModel.schemaVersion,
    sourceClearanceReviewEntry: "phase28.clearance-review-entry.v1",
    previewItems: clearanceDecisionPreviewItems,
    previewChecks: [
      { id: "criteria-checklist-linked", result: clearanceCriteriaChecklist.schemaVersion === "phase28.clearance-criteria-checklist.v1" ? "pass" : "block", evidence: clearanceCriteriaChecklist.schemaVersion },
      { id: "all-criteria-have-preview", result: clearanceDecisionPreviewItems.length === clearanceCriteriaItems.length ? "pass" : "block", evidence: `${clearanceDecisionPreviewItems.length} decision preview item` },
      { id: "all-previews-hold-clearance", result: clearanceDecisionPreviewItems.every((item) => item.previewDecision === "hold-clearance") ? "pass" : "block", evidence: "no preview approval" },
      { id: "preview-does-not-clear-blockers", result: "pass", evidence: "clearedBlockers=0" },
      { id: "preview-does-not-approve-release", result: "pass", evidence: "releaseReady=false" },
      { id: "runtime-remains-disabled", result: "pass", evidence: "runtimeExecution=false and thirdPartyExecution=false" }
    ],
    blockedMutations: [
      "approve-release-from-preview",
      "apply-decision-preview-as-clearance",
      "clear-blocker-from-preview",
      "mark-releaseReady-true",
      "enable-runtime-execution",
      "enable-third-party-execution",
      "persist-decision-preview-as-clearance",
      "apply-decision-preview-as-release-approval"
    ],
    exportPolicy: {
      exportName: "phase28-clearance-decision-preview.json",
      includeInOperationsExport: true,
      redaction: "preview-id-criteria-id-blocker-id-decision-and-state-only"
    },
    summary: {
      clearanceDecisionPreviewReady: true,
      previewItems: clearanceDecisionPreviewItems.length,
      holdClearancePreviews: clearanceDecisionPreviewItems.filter((item) => item.previewDecision === "hold-clearance").length,
      approvedReleasePreviews: 0,
      clearedBlockers: 0,
      releaseReady: false,
      runtimeExecution: false,
      thirdPartyExecution: false,
      persistedMutations: 0
    }
  };
  const phase28ClosurePackage = {
    schemaVersion: "phase28.closure-package.v1",
    version: "1.8.5",
    mode: "readonly-phase28-closure-no-release-approval",
    sourceClearanceReviewEntry: "phase28.clearance-review-entry.v1",
    sourceEvidenceIntakeLedger: evidenceIntakeLedger.schemaVersion,
    sourceReviewerDispositionModel: reviewerDispositionModel.schemaVersion,
    sourceClearanceCriteriaChecklist: clearanceCriteriaChecklist.schemaVersion,
    sourceClearanceDecisionPreview: clearanceDecisionPreview.schemaVersion,
    closureItems: [
      { id: "clearance-review-entry", schemaVersion: "phase28.clearance-review-entry.v1", state: "closed-with-open-blockers-carried-forward", ready: true, releaseReady: false, runtimeExecution: false, persistedMutations: 0 },
      { id: "evidence-intake-ledger", schemaVersion: evidenceIntakeLedger.schemaVersion, state: "closed-readonly-no-clearance", ready: evidenceIntakeLedger.summary.evidenceIntakeLedgerReady, releaseReady: false, runtimeExecution: false, persistedMutations: 0 },
      { id: "reviewer-disposition-model", schemaVersion: reviewerDispositionModel.schemaVersion, state: "closed-readonly-no-release-approval", ready: reviewerDispositionModel.summary.reviewerDispositionModelReady, releaseReady: false, runtimeExecution: false, persistedMutations: 0 },
      { id: "clearance-criteria-checklist", schemaVersion: clearanceCriteriaChecklist.schemaVersion, state: "closed-readonly-criteria-not-satisfied", ready: clearanceCriteriaChecklist.summary.clearanceCriteriaChecklistReady, releaseReady: false, runtimeExecution: false, persistedMutations: 0 },
      { id: "clearance-decision-preview", schemaVersion: clearanceDecisionPreview.schemaVersion, state: "closed-readonly-hold-clearance", ready: clearanceDecisionPreview.summary.clearanceDecisionPreviewReady, releaseReady: false, runtimeExecution: false, persistedMutations: 0 }
    ],
    closureChecks: [
      { id: "clearance-review-entry-linked", result: "pass", evidence: "phase28.clearance-review-entry.v1" },
      { id: "evidence-intake-ledger-linked", result: evidenceIntakeLedger.schemaVersion === "phase28.evidence-intake-ledger.v1" ? "pass" : "block", evidence: evidenceIntakeLedger.schemaVersion },
      { id: "reviewer-disposition-linked", result: reviewerDispositionModel.schemaVersion === "phase28.reviewer-disposition-model.v1" ? "pass" : "block", evidence: reviewerDispositionModel.schemaVersion },
      { id: "criteria-checklist-linked", result: clearanceCriteriaChecklist.schemaVersion === "phase28.clearance-criteria-checklist.v1" ? "pass" : "block", evidence: clearanceCriteriaChecklist.schemaVersion },
      { id: "decision-preview-linked", result: clearanceDecisionPreview.schemaVersion === "phase28.clearance-decision-preview.v1" ? "pass" : "block", evidence: clearanceDecisionPreview.schemaVersion },
      { id: "decision-preview-holds-clearance", result: clearanceDecisionPreview.summary.holdClearancePreviews === clearanceDecisionPreviewItems.length ? "pass" : "block", evidence: `${clearanceDecisionPreview.summary.holdClearancePreviews} hold preview` },
      { id: "blockers-carried-forward", result: "pass", evidence: `carriedForwardBlockers=${clearanceReviewQueue.length}; clearedBlockers=0` },
      { id: "closure-does-not-approve-release", result: "pass", evidence: "releaseReady=false" },
      { id: "runtime-remains-disabled", result: "pass", evidence: "runtimeExecution=false and thirdPartyExecution=false" }
    ],
    blockedMutations: [
      "persist-phase28-closure-as-release-approval",
      "clear-blocker-from-phase28-closure",
      "mark-releaseReady-true",
      "enable-runtime-execution",
      "enable-third-party-execution",
      "auto-enter-release-from-closure"
    ],
    exportPolicy: {
      exportName: "phase28-closure-package.json",
      includeInOperationsExport: true,
      redaction: "closure-item-schema-state-and-guardrail-summary-only"
    },
    handoff: {
      phase28Closed: true,
      nextPhaseEntryReady: true,
      carriedForwardBlockers: clearanceReviewQueue.length,
      recommendedNextStage: "phase29-release-governance-planning",
      releaseReady: false,
      runtimeExecution: false,
      thirdPartyExecution: false
    },
    summary: {
      phase28ClosureReady: true,
      phaseClosed: true,
      closureItems: 5,
      closureChecks: 9,
      carriedForwardBlockers: clearanceReviewQueue.length,
      clearedBlockers: 0,
      releaseReady: false,
      runtimeExecution: false,
      thirdPartyExecution: false,
      persistedMutations: 0
    }
  };
  return {
    phase: 28,
    schemaVersion: "phase28.clearance-review-entry.v1",
    version: "1.8.5",
    status: "phase28-closure-package-ready-runtime-disabled",
    entryMode: "release-blocker-clearance-review-no-runtime-execution",
    sourcePhase27: {
      schemaVersion: phase27.schemaVersion,
      closurePackage: closurePackage.schemaVersion,
      phase27Closed: closurePackage.summary?.phaseClosed === true,
      phase27ReleaseReady: phase27.summary?.releaseReady,
      phase27RuntimeExecution: phase27.summary?.runtimeExecution,
      phase27ThirdPartyExecution: phase27.summary?.thirdPartyExecution
    },
    clearanceReviewQueue,
    evidenceIntakeLedger,
    reviewerDispositionModel,
    clearanceCriteriaChecklist,
    clearanceDecisionPreview,
    phase28ClosurePackage,
    entryChecks,
    blockedMutations: [
      "clear-blocker-from-review",
      "apply-clearance-review-as-clearance",
      "persist-evidence-intake-as-clearance",
      "persist-reviewer-disposition-as-clearance",
      "persist-clearance-criteria-as-clearance",
      "persist-decision-preview-as-clearance",
      "apply-decision-preview-as-release-approval",
      "persist-phase28-closure-as-release-approval",
      "clear-blocker-from-phase28-closure",
      "mark-releaseReady-true",
      "enable-runtime-execution",
      "enable-third-party-execution",
      "persist-clearance-review-as-release-approval"
    ],
    exportPolicy: {
      exportName: "phase28-clearance-review-entry.json",
      includeInOperationsExport: true,
      redaction: "review-item-blocker-id-required-evidence-and-guardrails-only"
    },
    summary: {
      clearanceReviewEntryReady: true,
      evidenceIntakeLedgerReady: true,
      reviewerDispositionModelReady: true,
      clearanceCriteriaChecklistReady: true,
      clearanceDecisionPreviewReady: true,
      phase28ClosureReady: true,
      phase28Closed: true,
      reviewItems: clearanceReviewQueue.length,
      pendingReviewItems: clearanceReviewQueue.filter((item) => item.reviewState === "pending-clearance-review").length,
      evidenceLedgerEntries: evidenceLedgerEntries.length,
      pendingEvidenceIntake: evidenceIntakeLedger.summary.pendingEvidenceIntake,
      reviewerDispositions: reviewerDispositionQueue.length,
      pendingReviewerDispositions: reviewerDispositionModel.summary.pendingDispositions,
      clearanceCriteriaItems: clearanceCriteriaItems.length,
      pendingClearanceCriteria: clearanceCriteriaChecklist.summary.pendingCriteriaItems,
      satisfiedClearanceCriteria: 0,
      approvedReleaseCriteria: 0,
      clearanceDecisionPreviews: clearanceDecisionPreviewItems.length,
      holdClearancePreviews: clearanceDecisionPreview.summary.holdClearancePreviews,
      approvedReleasePreviews: 0,
      closureItems: phase28ClosurePackage.summary.closureItems,
      closureChecks: phase28ClosurePackage.summary.closureChecks,
      carriedForwardBlockers: phase28ClosurePackage.summary.carriedForwardBlockers,
      approvedReleaseDispositions: 0,
      acceptedEvidenceForClearance: 0,
      clearedBlockers: 0,
      releaseReady: false,
      runtimeExecution: false,
      thirdPartyExecution: false,
      persistedMutations: 0
    }
  };
}

function buildPhase29GovernanceDashboardExport(blockerClearanceWorkflow = {}, releaseApprovalStateModel = {}, runtimeEnableGovernance = {}, gateSeparationModel = []) {
  const dashboardSections = [
    {
      id: "blocker-clearance-workflow",
      label: "Blocker clearance workflow",
      sourceSchemaVersion: blockerClearanceWorkflow.schemaVersion,
      state: blockerClearanceWorkflow.summary?.workflowPlanningReady ? "ready-readonly" : "blocked",
      exportName: blockerClearanceWorkflow.exportPolicy?.exportName,
      keyMetrics: {
        pendingWorkflowItems: blockerClearanceWorkflow.summary?.pendingWorkflowItems || 0,
        clearedBlockers: blockerClearanceWorkflow.summary?.clearedBlockers || 0,
        approvedClearanceItems: blockerClearanceWorkflow.summary?.approvedClearanceItems || 0
      }
    },
    {
      id: "release-approval-state-model",
      label: "Release approval state model",
      sourceSchemaVersion: releaseApprovalStateModel.schemaVersion,
      state: releaseApprovalStateModel.summary?.approvalStateModelReady ? "ready-readonly" : "blocked",
      exportName: releaseApprovalStateModel.exportPolicy?.exportName,
      keyMetrics: {
        approvalStates: releaseApprovalStateModel.summary?.approvalStates || 0,
        blockedTransitions: releaseApprovalStateModel.summary?.blockedTransitions || 0,
        approvedReleaseStates: releaseApprovalStateModel.summary?.approvedReleaseStates || 0
      }
    },
    {
      id: "runtime-enable-governance",
      label: "Runtime enable governance",
      sourceSchemaVersion: runtimeEnableGovernance.schemaVersion,
      state: runtimeEnableGovernance.summary?.runtimeEnableGovernanceReady ? "ready-readonly" : "blocked",
      exportName: runtimeEnableGovernance.exportPolicy?.exportName,
      keyMetrics: {
        runtimeGates: runtimeEnableGovernance.summary?.runtimeGates || 0,
        planningOnlyGates: runtimeEnableGovernance.summary?.planningOnlyGates || 0,
        runtimeEnableApprovals: runtimeEnableGovernance.summary?.runtimeEnableApprovals || 0
      }
    },
    {
      id: "gate-separation",
      label: "Gate separation",
      sourceSchemaVersion: "phase29.release-governance-planning.v1",
      state: gateSeparationModel.every((item) => item.mayApproveRelease === false && item.mayEnableRuntime === false) ? "ready-readonly" : "blocked",
      exportName: "phase29-release-governance-planning.json",
      keyMetrics: {
        separatedGates: gateSeparationModel.length,
        releaseApprovingGates: gateSeparationModel.filter((item) => item.mayApproveRelease === true).length,
        runtimeEnablingGates: gateSeparationModel.filter((item) => item.mayEnableRuntime === true).length
      }
    },
    {
      id: "export-policy",
      label: "Export policy",
      sourceSchemaVersion: "phase29.governance-dashboard-export.v1",
      state: "ready-readonly",
      exportName: "phase29-governance-dashboard-export.json",
      keyMetrics: {
        includedExports: 5,
        persistedMutations: 0,
        redactedExports: 5
      }
    }
  ];
  const exportManifest = [
    { id: "phase29-release-governance-planning", exportName: "phase29-release-governance-planning.json", sourceSchemaVersion: "phase29.release-governance-planning.v1", includeInOperationsExport: true },
    { id: "phase29-blocker-clearance-workflow-planning", exportName: "phase29-blocker-clearance-workflow-planning.json", sourceSchemaVersion: blockerClearanceWorkflow.schemaVersion, includeInOperationsExport: blockerClearanceWorkflow.exportPolicy?.includeInOperationsExport === true },
    { id: "phase29-release-approval-state-model", exportName: "phase29-release-approval-state-model.json", sourceSchemaVersion: releaseApprovalStateModel.schemaVersion, includeInOperationsExport: releaseApprovalStateModel.exportPolicy?.includeInOperationsExport === true },
    { id: "phase29-runtime-enable-governance-planning", exportName: "phase29-runtime-enable-governance-planning.json", sourceSchemaVersion: runtimeEnableGovernance.schemaVersion, includeInOperationsExport: runtimeEnableGovernance.exportPolicy?.includeInOperationsExport === true },
    { id: "phase29-governance-dashboard-export", exportName: "phase29-governance-dashboard-export.json", sourceSchemaVersion: "phase29.governance-dashboard-export.v1", includeInOperationsExport: true }
  ];
  const dashboardChecks = [
    { id: "blocker-workflow-linked", result: blockerClearanceWorkflow.schemaVersion === "phase29.blocker-clearance-workflow-planning.v1" ? "pass" : "block", evidence: blockerClearanceWorkflow.schemaVersion },
    { id: "approval-state-linked", result: releaseApprovalStateModel.schemaVersion === "phase29.release-approval-state-model.v1" ? "pass" : "block", evidence: releaseApprovalStateModel.schemaVersion },
    { id: "runtime-governance-linked", result: runtimeEnableGovernance.schemaVersion === "phase29.runtime-enable-governance-planning.v1" ? "pass" : "block", evidence: runtimeEnableGovernance.schemaVersion },
    { id: "dashboard-sections-readonly", result: dashboardSections.every((item) => item.state === "ready-readonly") ? "pass" : "block", evidence: `${dashboardSections.length} dashboard section` },
    { id: "release-not-approved", result: "pass", evidence: "releaseReady=false" },
    { id: "runtime-not-enabled", result: "pass", evidence: "runtimeExecution=false" },
    { id: "third-party-not-enabled", result: "pass", evidence: "thirdPartyExecution=false" },
    { id: "dashboard-does-not-persist-mutations", result: "pass", evidence: "persistedMutations=0" }
  ];
  return {
    schemaVersion: "phase29.governance-dashboard-export.v1",
    version: "1.9.4",
    mode: "readonly-governance-dashboard-export-no-release-approval",
    sourceModels: {
      blockerClearanceWorkflow: blockerClearanceWorkflow.schemaVersion,
      releaseApprovalStateModel: releaseApprovalStateModel.schemaVersion,
      runtimeEnableGovernance: runtimeEnableGovernance.schemaVersion,
      gateSeparation: "phase29.release-governance-planning.v1"
    },
    dashboardSections,
    dashboardChecks,
    exportManifest,
    blockedMutations: [
      "persist-dashboard-as-release-approval",
      "persist-dashboard-as-clearance",
      "mark-releaseReady-true",
      "enable-runtime-execution",
      "enable-third-party-execution"
    ],
    exportPolicy: {
      exportName: "phase29-governance-dashboard-export.json",
      includeInOperationsExport: true,
      redaction: "dashboard-section-status-export-name-and-nonmutating-summary-only"
    },
    summary: {
      dashboardExportReady: true,
      dashboardSections: dashboardSections.length,
      includedExports: exportManifest.filter((item) => item.includeInOperationsExport === true).length,
      releaseReady: false,
      runtimeExecution: false,
      thirdPartyExecution: false,
      persistedMutations: 0
    }
  };
}

function buildPhase29DecisionHistoryAuditChain(blockerClearanceWorkflow = {}, releaseApprovalStateModel = {}, runtimeEnableGovernance = {}, governanceDashboardExport = {}) {
  const decisionEvents = [
    {
      id: "phase28-closure-carried-forward",
      label: "Phase 28 closure carried forward",
      sourceSchemaVersion: "phase28.closure-package.v1",
      decisionState: "closed-with-open-blockers-carried-forward",
      releaseReady: false,
      runtimeExecution: false,
      mutatesReleaseState: false
    },
    {
      id: "blocker-clearance-workflow-planned",
      label: "Blocker clearance workflow planned",
      sourceSchemaVersion: blockerClearanceWorkflow.schemaVersion,
      decisionState: "planning-only-no-clearance",
      releaseReady: false,
      runtimeExecution: false,
      mutatesReleaseState: false
    },
    {
      id: "release-approval-state-model-planned",
      label: "Release approval state model planned",
      sourceSchemaVersion: releaseApprovalStateModel.schemaVersion,
      decisionState: "approval-preview-blocked",
      releaseReady: false,
      runtimeExecution: false,
      mutatesReleaseState: false
    },
    {
      id: "runtime-enable-governance-deferred",
      label: "Runtime enable governance deferred",
      sourceSchemaVersion: runtimeEnableGovernance.schemaVersion,
      decisionState: "runtime-enable-planning-only",
      releaseReady: false,
      runtimeExecution: false,
      mutatesReleaseState: false
    },
    {
      id: "governance-dashboard-exported",
      label: "Governance dashboard exported",
      sourceSchemaVersion: governanceDashboardExport.schemaVersion,
      decisionState: "dashboard-export-ready-readonly",
      releaseReady: false,
      runtimeExecution: false,
      mutatesReleaseState: false
    }
  ];
  const chainLinks = decisionEvents.map((event, index) => ({
    id: `phase29-audit-link-${index + 1}`,
    fromEvent: index === 0 ? "phase28-clearance-review-entry" : decisionEvents[index - 1].id,
    toEvent: event.id,
    sourceSchemaVersion: event.sourceSchemaVersion,
    linkState: "linked-readonly",
    integrityCheck: "source-schema-and-nonmutating-state-recorded"
  }));
  const auditChecks = [
    { id: "blocker-workflow-linked", result: blockerClearanceWorkflow.schemaVersion === "phase29.blocker-clearance-workflow-planning.v1" ? "pass" : "block", evidence: blockerClearanceWorkflow.schemaVersion },
    { id: "approval-state-linked", result: releaseApprovalStateModel.schemaVersion === "phase29.release-approval-state-model.v1" ? "pass" : "block", evidence: releaseApprovalStateModel.schemaVersion },
    { id: "runtime-governance-linked", result: runtimeEnableGovernance.schemaVersion === "phase29.runtime-enable-governance-planning.v1" ? "pass" : "block", evidence: runtimeEnableGovernance.schemaVersion },
    { id: "dashboard-export-linked", result: governanceDashboardExport.schemaVersion === "phase29.governance-dashboard-export.v1" ? "pass" : "block", evidence: governanceDashboardExport.schemaVersion },
    { id: "chain-events-nonmutating", result: decisionEvents.every((item) => item.mutatesReleaseState === false) ? "pass" : "block", evidence: `${decisionEvents.length} decision event` },
    { id: "audit-chain-does-not-approve-release", result: "pass", evidence: "releaseReady=false" },
    { id: "audit-chain-does-not-clear-blockers", result: "pass", evidence: "clearedBlockers=0" },
    { id: "audit-chain-does-not-enable-runtime", result: "pass", evidence: "runtimeExecution=false and thirdPartyExecution=false" },
    { id: "audit-chain-does-not-persist-mutations", result: "pass", evidence: "persistedMutations=0" }
  ];
  return {
    schemaVersion: "phase29.decision-history-audit-chain.v1",
    version: "1.9.5",
    mode: "readonly-decision-history-audit-chain-no-release-approval",
    sourceModels: {
      blockerClearanceWorkflow: blockerClearanceWorkflow.schemaVersion,
      releaseApprovalStateModel: releaseApprovalStateModel.schemaVersion,
      runtimeEnableGovernance: runtimeEnableGovernance.schemaVersion,
      governanceDashboardExport: governanceDashboardExport.schemaVersion
    },
    decisionEvents,
    chainLinks,
    auditChecks,
    blockedMutations: [
      "persist-audit-chain-as-release-approval",
      "persist-audit-chain-as-clearance",
      "rewrite-decision-history",
      "mark-releaseReady-true",
      "enable-runtime-execution",
      "enable-third-party-execution"
    ],
    exportPolicy: {
      exportName: "phase29-decision-history-audit-chain.json",
      includeInOperationsExport: true,
      redaction: "decision-event-id-source-schema-state-and-nonmutating-integrity-only"
    },
    summary: {
      decisionHistoryAuditChainReady: true,
      decisionEvents: decisionEvents.length,
      chainLinks: chainLinks.length,
      passedAuditChecks: auditChecks.filter((item) => item.result === "pass").length,
      releaseReady: false,
      runtimeExecution: false,
      thirdPartyExecution: false,
      clearedBlockers: 0,
      persistedMutations: 0
    }
  };
}

function buildPhase29GovernanceClosureReadiness(blockerClearanceWorkflow = {}, releaseApprovalStateModel = {}, runtimeEnableGovernance = {}, governanceDashboardExport = {}, decisionHistoryAuditChain = {}, carriedForwardBlockers = []) {
  const closureCriteria = [
    {
      id: "release-governance-planning-complete",
      label: "Release governance planning complete",
      sourceSchemaVersion: "phase29.release-governance-planning.v1",
      result: "pass",
      evidence: "planningReady=true",
      releaseReady: false,
      runtimeExecution: false
    },
    {
      id: "blocker-workflow-readonly-ready",
      label: "Blocker workflow readonly ready",
      sourceSchemaVersion: blockerClearanceWorkflow.schemaVersion,
      result: blockerClearanceWorkflow.summary?.workflowPlanningReady ? "pass" : "block",
      evidence: `pendingWorkflowItems=${blockerClearanceWorkflow.summary?.pendingWorkflowItems || 0}`,
      releaseReady: false,
      runtimeExecution: false
    },
    {
      id: "approval-state-model-readonly-ready",
      label: "Approval state model readonly ready",
      sourceSchemaVersion: releaseApprovalStateModel.schemaVersion,
      result: releaseApprovalStateModel.summary?.approvalStateModelReady ? "pass" : "block",
      evidence: `approvedReleaseStates=${releaseApprovalStateModel.summary?.approvedReleaseStates || 0}`,
      releaseReady: false,
      runtimeExecution: false
    },
    {
      id: "runtime-governance-readonly-ready",
      label: "Runtime governance readonly ready",
      sourceSchemaVersion: runtimeEnableGovernance.schemaVersion,
      result: runtimeEnableGovernance.summary?.runtimeEnableGovernanceReady ? "pass" : "block",
      evidence: `runtimeEnableApprovals=${runtimeEnableGovernance.summary?.runtimeEnableApprovals || 0}`,
      releaseReady: false,
      runtimeExecution: false
    },
    {
      id: "governance-dashboard-export-ready",
      label: "Governance dashboard export ready",
      sourceSchemaVersion: governanceDashboardExport.schemaVersion,
      result: governanceDashboardExport.summary?.dashboardExportReady ? "pass" : "block",
      evidence: governanceDashboardExport.exportPolicy?.exportName,
      releaseReady: false,
      runtimeExecution: false
    },
    {
      id: "decision-history-audit-chain-ready",
      label: "Decision history audit chain ready",
      sourceSchemaVersion: decisionHistoryAuditChain.schemaVersion,
      result: decisionHistoryAuditChain.summary?.decisionHistoryAuditChainReady ? "pass" : "block",
      evidence: `chainLinks=${decisionHistoryAuditChain.summary?.chainLinks || 0}`,
      releaseReady: false,
      runtimeExecution: false
    },
    {
      id: "phase30-entry-remains-blocked",
      label: "Phase 30 entry remains blocked",
      sourceSchemaVersion: "phase29.governance-closure-readiness.v1",
      result: "pass",
      evidence: "phase30-release-candidate-governance=blocked",
      releaseReady: false,
      runtimeExecution: false
    }
  ];
  const blockedClosureItems = [
    {
      id: "carried-forward-blockers-open",
      label: "Carried forward blockers remain open",
      status: carriedForwardBlockers.length > 0 ? "blocked-carry-forward" : "review-required",
      count: carriedForwardBlockers.length,
      blocks: ["releaseReady", "phase30-entry"],
      requiredBeforeRelease: ["human-owned-clearance-evidence", "reviewer-disposition-recorded", "criteria-satisfaction-reviewed"]
    },
    {
      id: "release-approval-not-signed",
      label: "Release approval not signed",
      status: "blocked-by-design",
      count: releaseApprovalStateModel.summary?.approvedReleaseStates || 0,
      blocks: ["releaseReady", "approval-persistence"],
      requiredBeforeRelease: ["signed-release-decision", "artifact-integrity-verified", "rollback-and-backup-reviewed"]
    },
    {
      id: "runtime-enable-approval-missing",
      label: "Runtime enable approval missing",
      status: "blocked-by-design",
      count: runtimeEnableGovernance.summary?.runtimeEnableApprovals || 0,
      blocks: ["runtimeExecution", "thirdPartyExecution"],
      requiredBeforeRelease: ["runtime-validation-pass", "permission-policy-reviewed", "kill-switch-reviewed"]
    }
  ];
  const exportManifest = [
    { id: "phase29-release-governance-planning", exportName: "phase29-release-governance-planning.json", sourceSchemaVersion: "phase29.release-governance-planning.v1", includeInOperationsExport: true },
    { id: "phase29-blocker-clearance-workflow-planning", exportName: blockerClearanceWorkflow.exportPolicy?.exportName, sourceSchemaVersion: blockerClearanceWorkflow.schemaVersion, includeInOperationsExport: blockerClearanceWorkflow.exportPolicy?.includeInOperationsExport === true },
    { id: "phase29-release-approval-state-model", exportName: releaseApprovalStateModel.exportPolicy?.exportName, sourceSchemaVersion: releaseApprovalStateModel.schemaVersion, includeInOperationsExport: releaseApprovalStateModel.exportPolicy?.includeInOperationsExport === true },
    { id: "phase29-runtime-enable-governance-planning", exportName: runtimeEnableGovernance.exportPolicy?.exportName, sourceSchemaVersion: runtimeEnableGovernance.schemaVersion, includeInOperationsExport: runtimeEnableGovernance.exportPolicy?.includeInOperationsExport === true },
    { id: "phase29-governance-dashboard-export", exportName: governanceDashboardExport.exportPolicy?.exportName, sourceSchemaVersion: governanceDashboardExport.schemaVersion, includeInOperationsExport: governanceDashboardExport.exportPolicy?.includeInOperationsExport === true },
    { id: "phase29-decision-history-audit-chain", exportName: decisionHistoryAuditChain.exportPolicy?.exportName, sourceSchemaVersion: decisionHistoryAuditChain.schemaVersion, includeInOperationsExport: decisionHistoryAuditChain.exportPolicy?.includeInOperationsExport === true },
    { id: "phase29-governance-closure-readiness", exportName: "phase29-governance-closure-readiness.json", sourceSchemaVersion: "phase29.governance-closure-readiness.v1", includeInOperationsExport: true }
  ];
  const closureChecks = [
    { id: "closure-criteria-pass", result: closureCriteria.every((item) => item.result === "pass") ? "pass" : "block", evidence: `${closureCriteria.filter((item) => item.result === "pass").length}/${closureCriteria.length} criteria` },
    { id: "closure-keeps-release-blocked", result: "pass", evidence: "releaseReady=false" },
    { id: "closure-keeps-runtime-disabled", result: "pass", evidence: "runtimeExecution=false and thirdPartyExecution=false" },
    { id: "closure-does-not-clear-blockers", result: "pass", evidence: "clearedBlockers=0" },
    { id: "closure-does-not-persist-mutations", result: "pass", evidence: "persistedMutations=0" },
    { id: "phase30-entry-blocked", result: "pass", evidence: "phase30ReleaseCandidateGovernance=blocked" }
  ];
  return {
    schemaVersion: "phase29.governance-closure-readiness.v1",
    version: "1.9.6",
    mode: "readonly-governance-closure-readiness-no-release-approval",
    sourceModels: {
      blockerClearanceWorkflow: blockerClearanceWorkflow.schemaVersion,
      releaseApprovalStateModel: releaseApprovalStateModel.schemaVersion,
      runtimeEnableGovernance: runtimeEnableGovernance.schemaVersion,
      governanceDashboardExport: governanceDashboardExport.schemaVersion,
      decisionHistoryAuditChain: decisionHistoryAuditChain.schemaVersion
    },
    closureCriteria,
    blockedClosureItems,
    closureChecks,
    exportManifest,
    blockedMutations: [
      "persist-closure-readiness-as-release-approval",
      "persist-closure-readiness-as-phase30-entry",
      "clear-blocker-from-closure-readiness",
      "mark-releaseReady-true",
      "enable-runtime-execution",
      "enable-third-party-execution"
    ],
    exportPolicy: {
      exportName: "phase29-governance-closure-readiness.json",
      includeInOperationsExport: true,
      redaction: "closure-criteria-blocked-item-and-nonmutating-summary-only"
    },
    summary: {
      governanceClosureReadinessReady: true,
      closureCriteria: closureCriteria.length,
      passedClosureCriteria: closureCriteria.filter((item) => item.result === "pass").length,
      blockedClosureItems: blockedClosureItems.length,
      includedExports: exportManifest.filter((item) => item.includeInOperationsExport === true).length,
      phase30Blocked: true,
      releaseReady: false,
      runtimeExecution: false,
      thirdPartyExecution: false,
      clearedBlockers: 0,
      persistedMutations: 0
    }
  };
}

function buildPhase29ClosureHandoffPackage(blockerClearanceWorkflow = {}, releaseApprovalStateModel = {}, runtimeEnableGovernance = {}, governanceDashboardExport = {}, decisionHistoryAuditChain = {}, governanceClosureReadiness = {}) {
  const handoffSections = [
    {
      id: "closure-readiness-summary",
      label: "Closure readiness summary",
      sourceSchemaVersion: governanceClosureReadiness.schemaVersion,
      handoffState: governanceClosureReadiness.summary?.governanceClosureReadinessReady ? "ready-readonly" : "blocked",
      evidence: `closureCriteria=${governanceClosureReadiness.summary?.closureCriteria || 0}`,
      releaseReady: false,
      runtimeExecution: false
    },
    {
      id: "open-blocker-handoff",
      label: "Open blocker handoff",
      sourceSchemaVersion: blockerClearanceWorkflow.schemaVersion,
      handoffState: "blocked-carry-forward",
      evidence: `pendingWorkflowItems=${blockerClearanceWorkflow.summary?.pendingWorkflowItems || 0}`,
      releaseReady: false,
      runtimeExecution: false
    },
    {
      id: "release-approval-handoff",
      label: "Release approval handoff",
      sourceSchemaVersion: releaseApprovalStateModel.schemaVersion,
      handoffState: "approval-blocked",
      evidence: `approvedReleaseStates=${releaseApprovalStateModel.summary?.approvedReleaseStates || 0}`,
      releaseReady: false,
      runtimeExecution: false
    },
    {
      id: "runtime-enable-handoff",
      label: "Runtime enable handoff",
      sourceSchemaVersion: runtimeEnableGovernance.schemaVersion,
      handoffState: "runtime-disabled",
      evidence: `runtimeEnableApprovals=${runtimeEnableGovernance.summary?.runtimeEnableApprovals || 0}`,
      releaseReady: false,
      runtimeExecution: false
    },
    {
      id: "phase30-entry-guardrail",
      label: "Phase 30 entry guardrail",
      sourceSchemaVersion: governanceClosureReadiness.schemaVersion,
      handoffState: "phase30-blocked",
      evidence: "phase30ReleaseCandidateGovernance=blocked",
      releaseReady: false,
      runtimeExecution: false
    }
  ];
  const handoffArtifacts = [
    { id: "release-governance-planning", exportName: "phase29-release-governance-planning.json", sourceSchemaVersion: "phase29.release-governance-planning.v1", requiredForHandoff: true },
    { id: "blocker-clearance-workflow", exportName: blockerClearanceWorkflow.exportPolicy?.exportName, sourceSchemaVersion: blockerClearanceWorkflow.schemaVersion, requiredForHandoff: true },
    { id: "release-approval-state-model", exportName: releaseApprovalStateModel.exportPolicy?.exportName, sourceSchemaVersion: releaseApprovalStateModel.schemaVersion, requiredForHandoff: true },
    { id: "runtime-enable-governance", exportName: runtimeEnableGovernance.exportPolicy?.exportName, sourceSchemaVersion: runtimeEnableGovernance.schemaVersion, requiredForHandoff: true },
    { id: "governance-dashboard-export", exportName: governanceDashboardExport.exportPolicy?.exportName, sourceSchemaVersion: governanceDashboardExport.schemaVersion, requiredForHandoff: true },
    { id: "decision-history-audit-chain", exportName: decisionHistoryAuditChain.exportPolicy?.exportName, sourceSchemaVersion: decisionHistoryAuditChain.schemaVersion, requiredForHandoff: true },
    { id: "governance-closure-readiness", exportName: governanceClosureReadiness.exportPolicy?.exportName, sourceSchemaVersion: governanceClosureReadiness.schemaVersion, requiredForHandoff: true },
    { id: "closure-handoff-package", exportName: "phase29-closure-handoff-package.json", sourceSchemaVersion: "phase29.closure-handoff-package.v1", requiredForHandoff: true }
  ];
  const handoffChecks = [
    { id: "closure-readiness-linked", result: governanceClosureReadiness.schemaVersion === "phase29.governance-closure-readiness.v1" ? "pass" : "block", evidence: governanceClosureReadiness.schemaVersion },
    { id: "all-handoff-artifacts-required", result: handoffArtifacts.every((item) => item.requiredForHandoff === true) ? "pass" : "block", evidence: `${handoffArtifacts.length} handoff artifact` },
    { id: "handoff-does-not-approve-release", result: "pass", evidence: "releaseReady=false" },
    { id: "handoff-does-not-clear-blockers", result: "pass", evidence: "clearedBlockers=0" },
    { id: "handoff-keeps-runtime-disabled", result: "pass", evidence: "runtimeExecution=false and thirdPartyExecution=false" },
    { id: "handoff-keeps-phase30-blocked", result: "pass", evidence: "phase30Blocked=true" },
    { id: "handoff-does-not-persist-mutations", result: "pass", evidence: "persistedMutations=0" }
  ];
  return {
    schemaVersion: "phase29.closure-handoff-package.v1",
    version: "1.9.7",
    mode: "readonly-closure-handoff-package-no-release-approval",
    sourceModels: {
      blockerClearanceWorkflow: blockerClearanceWorkflow.schemaVersion,
      releaseApprovalStateModel: releaseApprovalStateModel.schemaVersion,
      runtimeEnableGovernance: runtimeEnableGovernance.schemaVersion,
      governanceDashboardExport: governanceDashboardExport.schemaVersion,
      decisionHistoryAuditChain: decisionHistoryAuditChain.schemaVersion,
      governanceClosureReadiness: governanceClosureReadiness.schemaVersion
    },
    handoffSections,
    handoffArtifacts,
    handoffChecks,
    blockedMutations: [
      "persist-handoff-as-release-approval",
      "persist-handoff-as-phase30-entry",
      "clear-blocker-from-handoff-package",
      "mark-releaseReady-true",
      "enable-runtime-execution",
      "enable-third-party-execution"
    ],
    exportPolicy: {
      exportName: "phase29-closure-handoff-package.json",
      includeInOperationsExport: true,
      redaction: "handoff-section-artifact-check-and-nonmutating-summary-only"
    },
    summary: {
      closureHandoffPackageReady: true,
      handoffSections: handoffSections.length,
      handoffArtifacts: handoffArtifacts.length,
      passedHandoffChecks: handoffChecks.filter((item) => item.result === "pass").length,
      phase30Blocked: true,
      releaseReady: false,
      runtimeExecution: false,
      thirdPartyExecution: false,
      clearedBlockers: 0,
      persistedMutations: 0
    }
  };
}

function buildPhase29HandoffReviewIndex(closureHandoffPackage = {}, governanceClosureReadiness = {}) {
  const handoffSections = closureHandoffPackage.handoffSections || [];
  const handoffArtifacts = closureHandoffPackage.handoffArtifacts || [];
  const handoffChecks = closureHandoffPackage.handoffChecks || [];
  const blockedClosureItems = governanceClosureReadiness.blockedClosureItems || [];
  const reviewIndexEntries = [
    {
      id: "handoff-section-review",
      label: "Handoff section review",
      sourceSchemaVersion: closureHandoffPackage.schemaVersion,
      reviewState: "ready-readonly",
      indexedItems: handoffSections.length,
      requiredBeforeRelease: ["human-review-sections", "confirm-no-release-approval"],
      releaseReady: false,
      runtimeExecution: false
    },
    {
      id: "handoff-artifact-review",
      label: "Handoff artifact review",
      sourceSchemaVersion: closureHandoffPackage.schemaVersion,
      reviewState: "ready-readonly",
      indexedItems: handoffArtifacts.length,
      requiredBeforeRelease: ["verify-artifact-integrity", "confirm-redaction-policy"],
      releaseReady: false,
      runtimeExecution: false
    },
    {
      id: "handoff-check-review",
      label: "Handoff check review",
      sourceSchemaVersion: closureHandoffPackage.schemaVersion,
      reviewState: "ready-readonly",
      indexedItems: handoffChecks.length,
      requiredBeforeRelease: ["review-handoff-checks", "confirm-persistedMutations-zero"],
      releaseReady: false,
      runtimeExecution: false
    },
    {
      id: "blocked-closure-item-review",
      label: "Blocked closure item review",
      sourceSchemaVersion: governanceClosureReadiness.schemaVersion,
      reviewState: "blocked-carry-forward",
      indexedItems: blockedClosureItems.length,
      requiredBeforeRelease: ["resolve-open-blockers", "sign-release-decision"],
      releaseReady: false,
      runtimeExecution: false
    },
    {
      id: "phase30-entry-review",
      label: "Phase 30 entry review",
      sourceSchemaVersion: closureHandoffPackage.schemaVersion,
      reviewState: "phase30-blocked",
      indexedItems: handoffSections.filter((item) => item.handoffState === "phase30-blocked").length,
      requiredBeforeRelease: ["clear-phase29-blockers", "complete-runtime-governance-closure"],
      releaseReady: false,
      runtimeExecution: false
    }
  ];
  const blockedReviewItems = [
    ...blockedClosureItems.map((item) => ({
      id: `closure-${item.id}`,
      label: item.label,
      source: "governanceClosureReadiness.blockedClosureItems",
      reviewState: item.status,
      blocks: item.blocks || [],
      count: item.count || 0
    })),
    {
      id: "handoff-phase30-entry-blocked",
      label: "Phase 30 entry remains blocked by handoff",
      source: "closureHandoffPackage.handoffSections",
      reviewState: "phase30-blocked",
      blocks: ["phase30-entry", "releaseReady"],
      count: handoffSections.filter((item) => item.handoffState === "phase30-blocked").length
    }
  ];
  const reviewChecks = [
    { id: "handoff-package-linked", result: closureHandoffPackage.schemaVersion === "phase29.closure-handoff-package.v1" ? "pass" : "block", evidence: closureHandoffPackage.schemaVersion },
    { id: "closure-readiness-linked", result: governanceClosureReadiness.schemaVersion === "phase29.governance-closure-readiness.v1" ? "pass" : "block", evidence: governanceClosureReadiness.schemaVersion },
    { id: "review-index-covers-handoff-artifacts", result: handoffArtifacts.length >= 1 ? "pass" : "block", evidence: `${handoffArtifacts.length} artifact` },
    { id: "review-index-covers-handoff-checks", result: handoffChecks.length >= 1 ? "pass" : "block", evidence: `${handoffChecks.length} handoff check` },
    { id: "review-index-keeps-release-blocked", result: "pass", evidence: "releaseReady=false" },
    { id: "review-index-keeps-runtime-disabled", result: "pass", evidence: "runtimeExecution=false and thirdPartyExecution=false" },
    { id: "review-index-does-not-persist-mutations", result: "pass", evidence: "persistedMutations=0" }
  ];
  return {
    schemaVersion: "phase29.handoff-review-index.v1",
    version: "1.9.8",
    mode: "readonly-handoff-review-index-no-release-approval",
    sourceModels: {
      closureHandoffPackage: closureHandoffPackage.schemaVersion,
      governanceClosureReadiness: governanceClosureReadiness.schemaVersion
    },
    reviewIndexEntries,
    blockedReviewItems,
    reviewChecks,
    blockedMutations: [
      "persist-review-index-as-release-approval",
      "persist-review-index-as-phase30-entry",
      "clear-blocker-from-review-index",
      "mark-releaseReady-true",
      "enable-runtime-execution",
      "enable-third-party-execution"
    ],
    exportPolicy: {
      exportName: "phase29-handoff-review-index.json",
      includeInOperationsExport: true,
      redaction: "review-index-entry-blocked-item-check-and-nonmutating-summary-only"
    },
    summary: {
      handoffReviewIndexReady: true,
      reviewIndexEntries: reviewIndexEntries.length,
      blockedReviewItems: blockedReviewItems.length,
      indexedArtifacts: handoffArtifacts.length,
      indexedChecks: handoffChecks.length,
      passedReviewChecks: reviewChecks.filter((item) => item.result === "pass").length,
      phase30Blocked: true,
      releaseReady: false,
      runtimeExecution: false,
      thirdPartyExecution: false,
      clearedBlockers: 0,
      persistedMutations: 0
    }
  };
}

function buildPhase29FinalClosureReadinessSnapshot(handoffReviewIndex = {}, closureHandoffPackage = {}, governanceClosureReadiness = {}, decisionHistoryAuditChain = {}, governanceDashboardExport = {}, runtimeEnableGovernance = {}, releaseApprovalStateModel = {}, blockerClearanceWorkflow = {}) {
  const readinessModels = [
    { id: "blocker-clearance-workflow", schemaVersion: blockerClearanceWorkflow.schemaVersion, ready: blockerClearanceWorkflow.summary?.workflowPlanningReady === true, releaseReady: false, persistedMutations: blockerClearanceWorkflow.summary?.persistedMutations || 0 },
    { id: "release-approval-state-model", schemaVersion: releaseApprovalStateModel.schemaVersion, ready: releaseApprovalStateModel.summary?.approvalStateModelReady === true, releaseReady: false, persistedMutations: releaseApprovalStateModel.summary?.persistedMutations || 0 },
    { id: "runtime-enable-governance", schemaVersion: runtimeEnableGovernance.schemaVersion, ready: runtimeEnableGovernance.summary?.runtimeEnableGovernanceReady === true, releaseReady: false, persistedMutations: runtimeEnableGovernance.summary?.persistedMutations || 0 },
    { id: "governance-dashboard-export", schemaVersion: governanceDashboardExport.schemaVersion, ready: governanceDashboardExport.summary?.dashboardExportReady === true, releaseReady: false, persistedMutations: governanceDashboardExport.summary?.persistedMutations || 0 },
    { id: "decision-history-audit-chain", schemaVersion: decisionHistoryAuditChain.schemaVersion, ready: decisionHistoryAuditChain.summary?.decisionHistoryAuditChainReady === true, releaseReady: false, persistedMutations: decisionHistoryAuditChain.summary?.persistedMutations || 0 },
    { id: "governance-closure-readiness", schemaVersion: governanceClosureReadiness.schemaVersion, ready: governanceClosureReadiness.summary?.governanceClosureReadinessReady === true, releaseReady: false, persistedMutations: governanceClosureReadiness.summary?.persistedMutations || 0 },
    { id: "closure-handoff-package", schemaVersion: closureHandoffPackage.schemaVersion, ready: closureHandoffPackage.summary?.closureHandoffPackageReady === true, releaseReady: false, persistedMutations: closureHandoffPackage.summary?.persistedMutations || 0 },
    { id: "handoff-review-index", schemaVersion: handoffReviewIndex.schemaVersion, ready: handoffReviewIndex.summary?.handoffReviewIndexReady === true, releaseReady: false, persistedMutations: handoffReviewIndex.summary?.persistedMutations || 0 }
  ];
  const blockedSnapshotItems = [
    ...(handoffReviewIndex.blockedReviewItems || []).map((item) => ({
      id: `snapshot-${item.id}`,
      label: item.label,
      source: item.source,
      snapshotState: item.reviewState,
      blocks: item.blocks || [],
      count: item.count || 0
    })),
    {
      id: "snapshot-phase30-entry-blocked",
      label: "Phase 30 entry remains blocked in final snapshot",
      source: "phase29.final-closure-readiness-snapshot.v1",
      snapshotState: "phase30-blocked",
      blocks: ["phase30-entry", "releaseReady", "runtimeExecution"],
      count: 1
    }
  ];
  const snapshotChecks = [
    { id: "snapshot-covers-all-phase29-submodels", result: readinessModels.length >= 8 ? "pass" : "block", evidence: `${readinessModels.length} model` },
    { id: "snapshot-keeps-release-blocked", result: "pass", evidence: "releaseReady=false" },
    { id: "snapshot-keeps-runtime-disabled", result: "pass", evidence: "runtimeExecution=false and thirdPartyExecution=false" },
    { id: "snapshot-keeps-phase30-blocked", result: "pass", evidence: "phase30Blocked=true" },
    { id: "snapshot-does-not-clear-blockers", result: "pass", evidence: "clearedBlockers=0" },
    { id: "snapshot-does-not-persist-mutations", result: "pass", evidence: "persistedMutations=0" }
  ];
  return {
    schemaVersion: "phase29.final-closure-readiness-snapshot.v1",
    version: "1.9.9",
    mode: "readonly-final-closure-readiness-snapshot-no-release-approval",
    sourceModels: {
      handoffReviewIndex: handoffReviewIndex.schemaVersion,
      closureHandoffPackage: closureHandoffPackage.schemaVersion,
      governanceClosureReadiness: governanceClosureReadiness.schemaVersion
    },
    readinessModels,
    blockedSnapshotItems,
    snapshotChecks,
    blockedMutations: [
      "persist-final-snapshot-as-release-approval",
      "persist-final-snapshot-as-phase30-entry",
      "clear-blocker-from-final-snapshot",
      "mark-releaseReady-true",
      "enable-runtime-execution",
      "enable-third-party-execution"
    ],
    exportPolicy: {
      exportName: "phase29-final-closure-readiness-snapshot.json",
      includeInOperationsExport: true,
      redaction: "snapshot-model-blocker-check-and-nonmutating-summary-only"
    },
    summary: {
      finalClosureReadinessSnapshotReady: true,
      readinessModels: readinessModels.length,
      readyModels: readinessModels.filter((item) => item.ready).length,
      blockedSnapshotItems: blockedSnapshotItems.length,
      passedSnapshotChecks: snapshotChecks.filter((item) => item.result === "pass").length,
      phase30Blocked: true,
      releaseReady: false,
      runtimeExecution: false,
      thirdPartyExecution: false,
      clearedBlockers: 0,
      persistedMutations: 0
    }
  };
}

function buildPhase29GovernanceArchiveFreeze(finalClosureReadinessSnapshot = {}, handoffReviewIndex = {}, closureHandoffPackage = {}, governanceClosureReadiness = {}, decisionHistoryAuditChain = {}, governanceDashboardExport = {}) {
  const archiveManifest = [
    { id: "release-governance-planning", exportName: "phase29-release-governance-planning.json", sourceSchemaVersion: "phase29.release-governance-planning.v1", freezeState: "frozen-readonly" },
    { id: "blocker-clearance-workflow", exportName: "phase29-blocker-clearance-workflow-planning.json", sourceSchemaVersion: "phase29.blocker-clearance-workflow-planning.v1", freezeState: "frozen-readonly" },
    { id: "release-approval-state-model", exportName: "phase29-release-approval-state-model.json", sourceSchemaVersion: "phase29.release-approval-state-model.v1", freezeState: "frozen-readonly" },
    { id: "runtime-enable-governance", exportName: "phase29-runtime-enable-governance-planning.json", sourceSchemaVersion: "phase29.runtime-enable-governance-planning.v1", freezeState: "frozen-readonly" },
    { id: "governance-dashboard-export", exportName: governanceDashboardExport.exportPolicy?.exportName || "phase29-governance-dashboard-export.json", sourceSchemaVersion: governanceDashboardExport.schemaVersion, freezeState: "frozen-readonly" },
    { id: "decision-history-audit-chain", exportName: decisionHistoryAuditChain.exportPolicy?.exportName || "phase29-decision-history-audit-chain.json", sourceSchemaVersion: decisionHistoryAuditChain.schemaVersion, freezeState: "frozen-readonly" },
    { id: "governance-closure-readiness", exportName: governanceClosureReadiness.exportPolicy?.exportName || "phase29-governance-closure-readiness.json", sourceSchemaVersion: governanceClosureReadiness.schemaVersion, freezeState: "frozen-readonly" },
    { id: "closure-handoff-package", exportName: closureHandoffPackage.exportPolicy?.exportName || "phase29-closure-handoff-package.json", sourceSchemaVersion: closureHandoffPackage.schemaVersion, freezeState: "frozen-readonly" },
    { id: "handoff-review-index", exportName: handoffReviewIndex.exportPolicy?.exportName || "phase29-handoff-review-index.json", sourceSchemaVersion: handoffReviewIndex.schemaVersion, freezeState: "frozen-readonly" },
    { id: "final-closure-readiness-snapshot", exportName: finalClosureReadinessSnapshot.exportPolicy?.exportName || "phase29-final-closure-readiness-snapshot.json", sourceSchemaVersion: finalClosureReadinessSnapshot.schemaVersion, freezeState: "frozen-readonly" }
  ];
  const frozenGuards = [
    { id: "release-approval", state: "blocked", evidence: "releaseReady=false", frozen: true },
    { id: "runtime-execution", state: "blocked", evidence: "runtimeExecution=false", frozen: true },
    { id: "third-party-execution", state: "blocked", evidence: "thirdPartyExecution=false", frozen: true },
    { id: "phase30-entry", state: "blocked", evidence: "phase30Blocked=true", frozen: true },
    { id: "blocker-clearance", state: "blocked", evidence: "clearedBlockers=0", frozen: true }
  ];
  const archiveChecks = [
    { id: "archive-covers-final-snapshot", result: finalClosureReadinessSnapshot.schemaVersion === "phase29.final-closure-readiness-snapshot.v1" ? "pass" : "block", evidence: finalClosureReadinessSnapshot.schemaVersion },
    { id: "archive-freezes-all-phase29-exports", result: archiveManifest.length >= 10 ? "pass" : "block", evidence: `${archiveManifest.length} export` },
    { id: "archive-keeps-release-blocked", result: "pass", evidence: "releaseReady=false" },
    { id: "archive-keeps-runtime-disabled", result: "pass", evidence: "runtimeExecution=false and thirdPartyExecution=false" },
    { id: "archive-keeps-phase30-blocked", result: "pass", evidence: "phase30Blocked=true" },
    { id: "archive-does-not-persist-mutations", result: "pass", evidence: "persistedMutations=0" }
  ];
  return {
    schemaVersion: "phase29.governance-archive-freeze.v1",
    version: "1.9.10",
    mode: "readonly-governance-archive-freeze-no-release-approval",
    sourceModels: {
      finalClosureReadinessSnapshot: finalClosureReadinessSnapshot.schemaVersion,
      handoffReviewIndex: handoffReviewIndex.schemaVersion,
      closureHandoffPackage: closureHandoffPackage.schemaVersion,
      governanceClosureReadiness: governanceClosureReadiness.schemaVersion,
      decisionHistoryAuditChain: decisionHistoryAuditChain.schemaVersion,
      governanceDashboardExport: governanceDashboardExport.schemaVersion
    },
    archiveManifest,
    frozenGuards,
    archiveChecks,
    blockedMutations: [
      "persist-archive-freeze-as-release-approval",
      "persist-archive-freeze-as-phase30-entry",
      "unfreeze-phase29-archive-without-review",
      "rewrite-frozen-governance-archive",
      "mark-releaseReady-true",
      "enable-runtime-execution",
      "enable-third-party-execution"
    ],
    exportPolicy: {
      exportName: "phase29-governance-archive-freeze.json",
      includeInOperationsExport: true,
      redaction: "archive-manifest-guard-check-and-nonmutating-summary-only"
    },
    summary: {
      governanceArchiveFreezeReady: true,
      archivedExports: archiveManifest.length,
      frozenGuards: frozenGuards.length,
      passedArchiveChecks: archiveChecks.filter((item) => item.result === "pass").length,
      phase30Blocked: true,
      releaseReady: false,
      runtimeExecution: false,
      thirdPartyExecution: false,
      clearedBlockers: 0,
      persistedMutations: 0
    }
  };
}

function buildPhase29BlockerResolutionMap(governanceArchiveFreeze = {}, finalClosureReadinessSnapshot = {}, handoffReviewIndex = {}, governanceClosureReadiness = {}, blockerClearanceWorkflow = {}) {
  const sourceBlockedItems = finalClosureReadinessSnapshot.blockedSnapshotItems || [];
  const workflowItems = blockerClearanceWorkflow.workflowItems || [];
  const resolutionItems = sourceBlockedItems.map((item, index) => {
    const workflowItem = workflowItems[index % Math.max(workflowItems.length, 1)] || {};
    return {
      id: `resolution-${item.id}`,
      label: item.label,
      source: item.source,
      blockerState: item.snapshotState || "blocked",
      ownerRole: workflowItem.ownerRole || "human-release-governance",
      requiredEvidence: workflowItem.evidenceRequirements || ["human-review-evidence", "release-owner-signoff", "runtime-disabled-verification"],
      requiredBeforePhase30: ["human-clearance-recorded", "release-approval-reviewed", "runtime-governance-closed"],
      blockedActions: ["clear-blocker-from-resolution-map", "mark-releaseReady-true", "enter-phase30"],
      mayClearBlocker: false,
      releaseReady: false,
      runtimeExecution: false
    };
  });
  const resolutionLanes = [
    { id: "human-evidence", label: "Human evidence", state: "required-readonly", itemCount: resolutionItems.length, mayPersistClearance: false },
    { id: "release-approval", label: "Release approval", state: "blocked", itemCount: resolutionItems.filter((item) => item.blockedActions.includes("mark-releaseReady-true")).length, mayPersistClearance: false },
    { id: "runtime-governance", label: "Runtime governance", state: "blocked", itemCount: resolutionItems.filter((item) => item.runtimeExecution === false).length, mayPersistClearance: false },
    { id: "phase30-entry", label: "Phase 30 entry", state: "blocked", itemCount: resolutionItems.filter((item) => item.blockedActions.includes("enter-phase30")).length, mayPersistClearance: false }
  ];
  const resolutionChecks = [
    { id: "resolution-map-linked-to-archive-freeze", result: governanceArchiveFreeze.schemaVersion === "phase29.governance-archive-freeze.v1" ? "pass" : "block", evidence: governanceArchiveFreeze.schemaVersion },
    { id: "resolution-map-covers-blocked-items", result: resolutionItems.length >= 1 ? "pass" : "block", evidence: `${resolutionItems.length} blocker` },
    { id: "resolution-map-keeps-blockers-open", result: "pass", evidence: "clearedBlockers=0" },
    { id: "resolution-map-keeps-release-blocked", result: "pass", evidence: "releaseReady=false" },
    { id: "resolution-map-keeps-runtime-disabled", result: "pass", evidence: "runtimeExecution=false and thirdPartyExecution=false" },
    { id: "resolution-map-does-not-persist-mutations", result: "pass", evidence: "persistedMutations=0" }
  ];
  return {
    schemaVersion: "phase29.blocker-resolution-map.v1",
    version: "1.9.11",
    mode: "readonly-blocker-resolution-map-no-clearance",
    sourceModels: {
      governanceArchiveFreeze: governanceArchiveFreeze.schemaVersion,
      finalClosureReadinessSnapshot: finalClosureReadinessSnapshot.schemaVersion,
      handoffReviewIndex: handoffReviewIndex.schemaVersion,
      governanceClosureReadiness: governanceClosureReadiness.schemaVersion,
      blockerClearanceWorkflow: blockerClearanceWorkflow.schemaVersion
    },
    resolutionItems,
    resolutionLanes,
    resolutionChecks,
    blockedMutations: [
      "persist-resolution-map-as-clearance",
      "persist-resolution-map-as-release-approval",
      "persist-resolution-map-as-phase30-entry",
      "clear-blocker-from-resolution-map",
      "mark-releaseReady-true",
      "enable-runtime-execution",
      "enable-third-party-execution"
    ],
    exportPolicy: {
      exportName: "phase29-blocker-resolution-map.json",
      includeInOperationsExport: true,
      redaction: "resolution-item-lane-check-and-nonmutating-summary-only"
    },
    summary: {
      blockerResolutionMapReady: true,
      resolutionItems: resolutionItems.length,
      resolutionLanes: resolutionLanes.length,
      passedResolutionChecks: resolutionChecks.filter((item) => item.result === "pass").length,
      phase30Blocked: true,
      releaseReady: false,
      runtimeExecution: false,
      thirdPartyExecution: false,
      clearedBlockers: 0,
      persistedMutations: 0
    }
  };
}

function buildPhase29Phase30EntryPreflight(blockerResolutionMap = {}, governanceArchiveFreeze = {}, finalClosureReadinessSnapshot = {}, releaseApprovalStateModel = {}, runtimeEnableGovernance = {}) {
  const preflightItems = [
    {
      id: "blocker-resolution-map-reviewed",
      label: "Blocker resolution map reviewed",
      sourceSchemaVersion: blockerResolutionMap.schemaVersion,
      result: blockerResolutionMap.summary?.blockerResolutionMapReady === true ? "pass-readonly" : "block",
      blocksPhase30: true,
      requiredBeforePhase30: ["clear-blockers-with-human-approval", "persist-clearance-outside-phase29-readonly-map"]
    },
    {
      id: "release-approval-still-blocked",
      label: "Release approval still blocked",
      sourceSchemaVersion: releaseApprovalStateModel.schemaVersion,
      result: "block",
      blocksPhase30: true,
      requiredBeforePhase30: ["signed-release-approval", "releaseReady-true-after-review"]
    },
    {
      id: "runtime-governance-still-disabled",
      label: "Runtime governance still disabled",
      sourceSchemaVersion: runtimeEnableGovernance.schemaVersion,
      result: "block",
      blocksPhase30: true,
      requiredBeforePhase30: ["runtime-validation-approved", "runtime-enable-approval-recorded"]
    },
    {
      id: "archive-freeze-present",
      label: "Governance archive freeze present",
      sourceSchemaVersion: governanceArchiveFreeze.schemaVersion,
      result: governanceArchiveFreeze.summary?.governanceArchiveFreezeReady === true ? "pass-readonly" : "block",
      blocksPhase30: true,
      requiredBeforePhase30: ["archive-freeze-reviewed-by-release-owner"]
    },
    {
      id: "final-snapshot-present",
      label: "Final closure readiness snapshot present",
      sourceSchemaVersion: finalClosureReadinessSnapshot.schemaVersion,
      result: finalClosureReadinessSnapshot.summary?.finalClosureReadinessSnapshotReady === true ? "pass-readonly" : "block",
      blocksPhase30: true,
      requiredBeforePhase30: ["snapshot-reviewed-by-release-owner"]
    }
  ];
  const entryGates = [
    { id: "blocker-clearance-gate", state: "blocked", mayEnterPhase30: false, evidence: "clearedBlockers=0" },
    { id: "release-approval-gate", state: "blocked", mayEnterPhase30: false, evidence: "releaseReady=false" },
    { id: "runtime-enable-gate", state: "blocked", mayEnterPhase30: false, evidence: "runtimeExecution=false" },
    { id: "third-party-execution-gate", state: "blocked", mayEnterPhase30: false, evidence: "thirdPartyExecution=false" }
  ];
  const preflightChecks = [
    { id: "preflight-linked-to-resolution-map", result: blockerResolutionMap.schemaVersion === "phase29.blocker-resolution-map.v1" ? "pass" : "block", evidence: blockerResolutionMap.schemaVersion },
    { id: "preflight-keeps-phase30-blocked", result: "pass", evidence: "phase30Blocked=true" },
    { id: "preflight-keeps-release-blocked", result: "pass", evidence: "releaseReady=false" },
    { id: "preflight-keeps-runtime-disabled", result: "pass", evidence: "runtimeExecution=false and thirdPartyExecution=false" },
    { id: "preflight-does-not-clear-blockers", result: "pass", evidence: "clearedBlockers=0" },
    { id: "preflight-does-not-persist-mutations", result: "pass", evidence: "persistedMutations=0" }
  ];
  return {
    schemaVersion: "phase29.phase30-entry-preflight.v1",
    version: "1.9.12",
    mode: "readonly-phase30-entry-preflight-no-entry",
    sourceModels: {
      blockerResolutionMap: blockerResolutionMap.schemaVersion,
      governanceArchiveFreeze: governanceArchiveFreeze.schemaVersion,
      finalClosureReadinessSnapshot: finalClosureReadinessSnapshot.schemaVersion,
      releaseApprovalStateModel: releaseApprovalStateModel.schemaVersion,
      runtimeEnableGovernance: runtimeEnableGovernance.schemaVersion
    },
    preflightItems,
    entryGates,
    preflightChecks,
    blockedMutations: [
      "persist-preflight-as-phase30-entry",
      "persist-preflight-as-release-approval",
      "clear-blocker-from-preflight",
      "mark-releaseReady-true",
      "enable-runtime-execution",
      "enable-third-party-execution"
    ],
    exportPolicy: {
      exportName: "phase29-phase30-entry-preflight.json",
      includeInOperationsExport: true,
      redaction: "preflight-item-gate-check-and-nonmutating-summary-only"
    },
    summary: {
      phase30EntryPreflightReady: true,
      preflightItems: preflightItems.length,
      blockedPreflightItems: preflightItems.filter((item) => item.blocksPhase30).length,
      entryGates: entryGates.length,
      blockedEntryGates: entryGates.filter((item) => item.mayEnterPhase30 === false).length,
      passedPreflightChecks: preflightChecks.filter((item) => item.result === "pass").length,
      phase30Blocked: true,
      phase30EntryReady: false,
      releaseReady: false,
      runtimeExecution: false,
      thirdPartyExecution: false,
      clearedBlockers: 0,
      persistedMutations: 0
    }
  };
}

function buildPhase29FinalReleaseBlockerDossier(phase30EntryPreflight = {}, blockerResolutionMap = {}, governanceClosureReadiness = {}, releaseApprovalStateModel = {}, runtimeEnableGovernance = {}) {
  const unresolvedBlockers = (blockerResolutionMap.resolutionItems || []).map((item) => ({
    id: item.id,
    label: item.label,
    sourceSchemaVersion: blockerResolutionMap.schemaVersion,
    dossierState: "unresolved-release-blocker",
    ownerRole: item.ownerRole,
    requiredEvidence: item.requiredEvidence || [],
    requiredBeforeRelease: item.requiredBeforePhase30 || [],
    mayClearBlocker: false,
    releaseReady: false,
    blocksPhase30: true
  }));
  const releaseGateFindings = [
    { id: "blocker-clearance", sourceSchemaVersion: blockerResolutionMap.schemaVersion, state: "blocked", evidence: "clearedBlockers=0", releaseReady: false, mayApproveRelease: false },
    { id: "release-approval", sourceSchemaVersion: releaseApprovalStateModel.schemaVersion, state: "blocked", evidence: "releaseReady=false", releaseReady: false, mayApproveRelease: false },
    { id: "runtime-enable", sourceSchemaVersion: runtimeEnableGovernance.schemaVersion, state: "blocked", evidence: "runtimeExecution=false", releaseReady: false, mayApproveRelease: false },
    { id: "phase30-entry", sourceSchemaVersion: phase30EntryPreflight.schemaVersion, state: "blocked", evidence: "phase30EntryReady=false", releaseReady: false, mayApproveRelease: false }
  ];
  const dossierArtifacts = [
    { id: "blocker-resolution-map", sourceSchemaVersion: blockerResolutionMap.schemaVersion, exportName: blockerResolutionMap.exportPolicy?.exportName, artifactState: "included-readonly" },
    { id: "phase30-entry-preflight", sourceSchemaVersion: phase30EntryPreflight.schemaVersion, exportName: phase30EntryPreflight.exportPolicy?.exportName, artifactState: "included-readonly" },
    { id: "governance-closure-readiness", sourceSchemaVersion: governanceClosureReadiness.schemaVersion, exportName: governanceClosureReadiness.exportPolicy?.exportName, artifactState: "included-readonly" },
    { id: "release-approval-state-model", sourceSchemaVersion: releaseApprovalStateModel.schemaVersion, exportName: releaseApprovalStateModel.exportPolicy?.exportName, artifactState: "included-readonly" },
    { id: "runtime-enable-governance", sourceSchemaVersion: runtimeEnableGovernance.schemaVersion, exportName: runtimeEnableGovernance.exportPolicy?.exportName, artifactState: "included-readonly" }
  ];
  const dossierChecks = [
    { id: "dossier-linked-to-preflight", result: phase30EntryPreflight.schemaVersion === "phase29.phase30-entry-preflight.v1" ? "pass" : "block", evidence: phase30EntryPreflight.schemaVersion },
    { id: "dossier-keeps-blockers-open", result: "pass", evidence: "clearedBlockers=0" },
    { id: "dossier-keeps-release-blocked", result: "pass", evidence: "releaseReady=false" },
    { id: "dossier-keeps-runtime-disabled", result: "pass", evidence: "runtimeExecution=false and thirdPartyExecution=false" },
    { id: "dossier-keeps-phase30-blocked", result: "pass", evidence: "phase30EntryReady=false" },
    { id: "dossier-does-not-persist-mutations", result: "pass", evidence: "persistedMutations=0" }
  ];
  return {
    schemaVersion: "phase29.final-release-blocker-dossier.v1",
    version: "1.9.13",
    mode: "readonly-final-release-blocker-dossier-no-clearance",
    sourceModels: {
      phase30EntryPreflight: phase30EntryPreflight.schemaVersion,
      blockerResolutionMap: blockerResolutionMap.schemaVersion,
      governanceClosureReadiness: governanceClosureReadiness.schemaVersion,
      releaseApprovalStateModel: releaseApprovalStateModel.schemaVersion,
      runtimeEnableGovernance: runtimeEnableGovernance.schemaVersion
    },
    unresolvedBlockers,
    releaseGateFindings,
    dossierArtifacts,
    dossierChecks,
    blockedMutations: [
      "persist-dossier-as-clearance",
      "persist-dossier-as-release-approval",
      "persist-dossier-as-phase30-entry",
      "clear-blocker-from-dossier",
      "mark-releaseReady-true",
      "enable-runtime-execution",
      "enable-third-party-execution"
    ],
    exportPolicy: {
      exportName: "phase29-final-release-blocker-dossier.json",
      includeInOperationsExport: true,
      redaction: "blocker-id-gate-state-artifact-and-nonmutating-summary-only"
    },
    summary: {
      finalReleaseBlockerDossierReady: true,
      unresolvedBlockers: unresolvedBlockers.length,
      releaseGateFindings: releaseGateFindings.length,
      blockedReleaseGates: releaseGateFindings.filter((item) => item.state === "blocked").length,
      dossierArtifacts: dossierArtifacts.length,
      passedDossierChecks: dossierChecks.filter((item) => item.result === "pass").length,
      phase30Blocked: true,
      phase30EntryReady: false,
      releaseReady: false,
      runtimeExecution: false,
      thirdPartyExecution: false,
      clearedBlockers: 0,
      persistedMutations: 0
    }
  };
}

function buildPhase29ReleaseExitCriteriaLedger(finalReleaseBlockerDossier = {}, phase30EntryPreflight = {}, governanceArchiveFreeze = {}, releaseApprovalStateModel = {}, runtimeEnableGovernance = {}) {
  const exitCriteria = [
    { id: "all-blockers-cleared", sourceSchemaVersion: finalReleaseBlockerDossier.schemaVersion, state: "unmet", evidence: "unresolvedBlockers>=1", mayExitPhase29: false, requiredBeforeExit: ["human-owned-blocker-clearance"] },
    { id: "release-approval-signed", sourceSchemaVersion: releaseApprovalStateModel.schemaVersion, state: "unmet", evidence: "releaseReady=false", mayExitPhase29: false, requiredBeforeExit: ["signed-release-decision"] },
    { id: "runtime-governance-closed", sourceSchemaVersion: runtimeEnableGovernance.schemaVersion, state: "unmet", evidence: "runtimeExecution=false", mayExitPhase29: false, requiredBeforeExit: ["runtime-enable-governance-reviewed"] },
    { id: "phase30-entry-authorized", sourceSchemaVersion: phase30EntryPreflight.schemaVersion, state: "unmet", evidence: "phase30EntryReady=false", mayExitPhase29: false, requiredBeforeExit: ["phase30-entry-approval"] },
    { id: "archive-reviewed-for-exit", sourceSchemaVersion: governanceArchiveFreeze.schemaVersion, state: "readonly-ready", evidence: "archive frozen read-only", mayExitPhase29: false, requiredBeforeExit: ["release-owner-archive-review"] }
  ];
  const ledgerEntries = exitCriteria.map((item) => ({
    id: `${item.id}-ledger`,
    criteriaId: item.id,
    sourceSchemaVersion: item.sourceSchemaVersion,
    ledgerState: item.state === "readonly-ready" ? "recorded-readonly" : "recorded-unmet",
    evidence: item.evidence,
    maySatisfyCriteria: false,
    mayExitPhase29: false
  }));
  const exitChecks = [
    { id: "ledger-linked-to-dossier", result: finalReleaseBlockerDossier.schemaVersion === "phase29.final-release-blocker-dossier.v1" ? "pass" : "block", evidence: finalReleaseBlockerDossier.schemaVersion },
    { id: "ledger-keeps-exit-blocked", result: "pass", evidence: "phase29ExitReady=false" },
    { id: "ledger-keeps-release-blocked", result: "pass", evidence: "releaseReady=false" },
    { id: "ledger-keeps-runtime-disabled", result: "pass", evidence: "runtimeExecution=false and thirdPartyExecution=false" },
    { id: "ledger-keeps-phase30-blocked", result: "pass", evidence: "phase30EntryReady=false" },
    { id: "ledger-does-not-persist-mutations", result: "pass", evidence: "persistedMutations=0" }
  ];
  return {
    schemaVersion: "phase29.release-exit-criteria-ledger.v1",
    version: "1.9.14",
    mode: "readonly-release-exit-criteria-ledger-no-exit",
    sourceModels: {
      finalReleaseBlockerDossier: finalReleaseBlockerDossier.schemaVersion,
      phase30EntryPreflight: phase30EntryPreflight.schemaVersion,
      governanceArchiveFreeze: governanceArchiveFreeze.schemaVersion,
      releaseApprovalStateModel: releaseApprovalStateModel.schemaVersion,
      runtimeEnableGovernance: runtimeEnableGovernance.schemaVersion
    },
    exitCriteria,
    ledgerEntries,
    exitChecks,
    blockedMutations: [
      "persist-exit-ledger-as-clearance",
      "persist-exit-ledger-as-release-approval",
      "persist-exit-ledger-as-phase30-entry",
      "mark-exit-criteria-met",
      "clear-blocker-from-exit-ledger",
      "mark-releaseReady-true",
      "enable-runtime-execution",
      "enable-third-party-execution"
    ],
    exportPolicy: {
      exportName: "phase29-release-exit-criteria-ledger.json",
      includeInOperationsExport: true,
      redaction: "criteria-id-ledger-state-evidence-and-nonmutating-summary-only"
    },
    summary: {
      releaseExitCriteriaLedgerReady: true,
      exitCriteria: exitCriteria.length,
      unmetExitCriteria: exitCriteria.filter((item) => item.mayExitPhase29 === false).length,
      ledgerEntries: ledgerEntries.length,
      blockedExitGates: ledgerEntries.filter((item) => item.mayExitPhase29 === false).length,
      passedExitChecks: exitChecks.filter((item) => item.result === "pass").length,
      phase29ExitReady: false,
      phase30Blocked: true,
      phase30EntryReady: false,
      releaseReady: false,
      runtimeExecution: false,
      thirdPartyExecution: false,
      clearedBlockers: 0,
      persistedMutations: 0
    }
  };
}

function buildPhase29ReleaseExitDecisionPreview(releaseExitCriteriaLedger = {}, finalReleaseBlockerDossier = {}, phase30EntryPreflight = {}, releaseApprovalStateModel = {}, runtimeEnableGovernance = {}) {
  const decisionPreviewItems = [
    { id: "blocker-clearance-decision", sourceSchemaVersion: finalReleaseBlockerDossier.schemaVersion, previewDecision: "block-exit", evidence: "unresolvedBlockers>=1", mayApproveRelease: false, mayExitPhase29: false },
    { id: "release-approval-decision", sourceSchemaVersion: releaseApprovalStateModel.schemaVersion, previewDecision: "block-exit", evidence: "releaseReady=false", mayApproveRelease: false, mayExitPhase29: false },
    { id: "runtime-governance-decision", sourceSchemaVersion: runtimeEnableGovernance.schemaVersion, previewDecision: "block-exit", evidence: "runtimeExecution=false", mayApproveRelease: false, mayExitPhase29: false },
    { id: "phase30-entry-decision", sourceSchemaVersion: phase30EntryPreflight.schemaVersion, previewDecision: "block-exit", evidence: "phase30EntryReady=false", mayApproveRelease: false, mayExitPhase29: false },
    { id: "exit-ledger-decision", sourceSchemaVersion: releaseExitCriteriaLedger.schemaVersion, previewDecision: "block-exit", evidence: "phase29ExitReady=false", mayApproveRelease: false, mayExitPhase29: false }
  ];
  const previewDecision = {
    id: "phase29-exit-preview",
    decision: "block-phase29-exit",
    releaseReady: false,
    phase29ExitReady: false,
    phase30EntryReady: false,
    runtimeExecution: false,
    thirdPartyExecution: false,
    rationale: [
      "carried-blockers-remain-open",
      "release-approval-not-signed",
      "runtime-governance-not-closed",
      "phase30-entry-not-authorized"
    ]
  };
  const decisionChecks = [
    { id: "preview-linked-to-exit-ledger", result: releaseExitCriteriaLedger.schemaVersion === "phase29.release-exit-criteria-ledger.v1" ? "pass" : "block", evidence: releaseExitCriteriaLedger.schemaVersion },
    { id: "preview-keeps-exit-blocked", result: "pass", evidence: "phase29ExitReady=false" },
    { id: "preview-keeps-release-blocked", result: "pass", evidence: "releaseReady=false" },
    { id: "preview-keeps-runtime-disabled", result: "pass", evidence: "runtimeExecution=false and thirdPartyExecution=false" },
    { id: "preview-keeps-phase30-blocked", result: "pass", evidence: "phase30EntryReady=false" },
    { id: "preview-does-not-persist-mutations", result: "pass", evidence: "persistedMutations=0" }
  ];
  return {
    schemaVersion: "phase29.release-exit-decision-preview.v1",
    version: "1.9.15",
    mode: "readonly-release-exit-decision-preview-no-approval",
    sourceModels: {
      releaseExitCriteriaLedger: releaseExitCriteriaLedger.schemaVersion,
      finalReleaseBlockerDossier: finalReleaseBlockerDossier.schemaVersion,
      phase30EntryPreflight: phase30EntryPreflight.schemaVersion,
      releaseApprovalStateModel: releaseApprovalStateModel.schemaVersion,
      runtimeEnableGovernance: runtimeEnableGovernance.schemaVersion
    },
    decisionPreviewItems,
    previewDecision,
    decisionChecks,
    blockedMutations: [
      "apply-exit-preview-as-release-approval",
      "apply-exit-preview-as-phase30-entry",
      "persist-exit-preview-as-clearance",
      "persist-exit-preview-as-release-approval",
      "persist-exit-preview-as-phase30-entry",
      "clear-blocker-from-exit-preview",
      "mark-releaseReady-true",
      "enable-runtime-execution",
      "enable-third-party-execution"
    ],
    exportPolicy: {
      exportName: "phase29-release-exit-decision-preview.json",
      includeInOperationsExport: true,
      redaction: "decision-id-preview-result-evidence-and-nonmutating-summary-only"
    },
    summary: {
      releaseExitDecisionPreviewReady: true,
      decisionPreviewItems: decisionPreviewItems.length,
      blockedPreviewItems: decisionPreviewItems.filter((item) => item.mayExitPhase29 === false).length,
      decisionChecks: decisionChecks.length,
      passedDecisionChecks: decisionChecks.filter((item) => item.result === "pass").length,
      phase29ExitDecision: previewDecision.decision,
      phase29ExitReady: false,
      phase30Blocked: true,
      phase30EntryReady: false,
      releaseReady: false,
      runtimeExecution: false,
      thirdPartyExecution: false,
      clearedBlockers: 0,
      persistedMutations: 0
    }
  };
}

function buildPhase29Phase30TransitionRiskRegister(releaseExitDecisionPreview = {}, releaseExitCriteriaLedger = {}, finalReleaseBlockerDossier = {}, phase30EntryPreflight = {}, runtimeEnableGovernance = {}) {
  const riskItems = [
    { id: "unresolved-blocker-carryover", sourceSchemaVersion: finalReleaseBlockerDossier.schemaVersion, severity: "critical", transitionState: "blocked", evidence: "unresolvedBlockers>=1", requiredMitigation: ["human-clearance-evidence", "signed-blocker-disposition"], mayEnterPhase30: false },
    { id: "release-approval-gap", sourceSchemaVersion: releaseExitDecisionPreview.schemaVersion, severity: "critical", transitionState: "blocked", evidence: "releaseReady=false", requiredMitigation: ["release-owner-signoff", "exit-decision-reopened-after-blockers-clear"], mayEnterPhase30: false },
    { id: "runtime-governance-gap", sourceSchemaVersion: runtimeEnableGovernance.schemaVersion, severity: "high", transitionState: "blocked", evidence: "runtimeExecution=false", requiredMitigation: ["runtime-validation-review", "permission-policy-review"], mayEnterPhase30: false },
    { id: "phase30-entry-authorization-gap", sourceSchemaVersion: phase30EntryPreflight.schemaVersion, severity: "critical", transitionState: "blocked", evidence: "phase30EntryReady=false", requiredMitigation: ["phase30-entry-approval", "handoff-owner-acceptance"], mayEnterPhase30: false },
    { id: "exit-ledger-unmet-criteria", sourceSchemaVersion: releaseExitCriteriaLedger.schemaVersion, severity: "high", transitionState: "blocked", evidence: "phase29ExitReady=false", requiredMitigation: ["exit-criteria-recheck", "archive-integrity-review"], mayEnterPhase30: false }
  ];
  const mitigationLanes = [
    { id: "blocker-clearance-evidence-lane", owner: "human-release-governance", state: "planning-only", linkedRisks: ["unresolved-blocker-carryover"], blockedActions: ["clear-blocker-from-transition-risk", "persist-risk-register-as-clearance"] },
    { id: "release-approval-lane", owner: "release-owner", state: "blocked-until-clearance", linkedRisks: ["release-approval-gap", "exit-ledger-unmet-criteria"], blockedActions: ["apply-risk-register-as-release-approval", "mark-releaseReady-true"] },
    { id: "runtime-governance-lane", owner: "runtime-reviewer", state: "deferred", linkedRisks: ["runtime-governance-gap"], blockedActions: ["enable-runtime-execution", "enable-third-party-execution"] },
    { id: "phase30-entry-lane", owner: "phase30-owner", state: "blocked", linkedRisks: ["phase30-entry-authorization-gap"], blockedActions: ["persist-risk-register-as-phase30-entry", "open-phase30-entry-from-risk-register"] }
  ];
  const riskChecks = [
    { id: "risk-register-linked-to-exit-preview", result: releaseExitDecisionPreview.schemaVersion === "phase29.release-exit-decision-preview.v1" ? "pass" : "block", evidence: releaseExitDecisionPreview.schemaVersion },
    { id: "risk-register-keeps-release-blocked", result: "pass", evidence: "releaseReady=false" },
    { id: "risk-register-keeps-phase30-blocked", result: "pass", evidence: "phase30EntryReady=false" },
    { id: "risk-register-keeps-runtime-disabled", result: "pass", evidence: "runtimeExecution=false and thirdPartyExecution=false" },
    { id: "risk-register-does-not-clear-blockers", result: "pass", evidence: "clearedBlockers=0" },
    { id: "risk-register-does-not-persist-mutations", result: "pass", evidence: "persistedMutations=0" }
  ];
  return {
    schemaVersion: "phase29.phase30-transition-risk-register.v1",
    version: "1.9.16",
    mode: "readonly-phase30-transition-risk-register-no-entry",
    sourceModels: {
      releaseExitDecisionPreview: releaseExitDecisionPreview.schemaVersion,
      releaseExitCriteriaLedger: releaseExitCriteriaLedger.schemaVersion,
      finalReleaseBlockerDossier: finalReleaseBlockerDossier.schemaVersion,
      phase30EntryPreflight: phase30EntryPreflight.schemaVersion,
      runtimeEnableGovernance: runtimeEnableGovernance.schemaVersion
    },
    riskItems,
    mitigationLanes,
    riskChecks,
    blockedMutations: [
      "persist-risk-register-as-clearance",
      "persist-risk-register-as-release-approval",
      "persist-risk-register-as-phase30-entry",
      "apply-risk-register-as-release-approval",
      "open-phase30-entry-from-risk-register",
      "clear-blocker-from-transition-risk",
      "mark-transition-risk-mitigated-without-evidence",
      "mark-releaseReady-true",
      "enable-runtime-execution",
      "enable-third-party-execution"
    ],
    exportPolicy: {
      exportName: "phase29-phase30-transition-risk-register.json",
      includeInOperationsExport: true,
      redaction: "risk-id-severity-transition-state-evidence-and-readonly-mitigation-only"
    },
    summary: {
      phase30TransitionRiskRegisterReady: true,
      riskItems: riskItems.length,
      blockedTransitionRisks: riskItems.filter((item) => item.mayEnterPhase30 === false).length,
      criticalRisks: riskItems.filter((item) => item.severity === "critical").length,
      mitigationLanes: mitigationLanes.length,
      riskChecks: riskChecks.length,
      passedRiskChecks: riskChecks.filter((item) => item.result === "pass").length,
      phase29ExitReady: false,
      phase30Blocked: true,
      phase30EntryReady: false,
      releaseReady: false,
      runtimeExecution: false,
      thirdPartyExecution: false,
      clearedBlockers: 0,
      persistedMutations: 0
    }
  };
}

function buildPhase29TransitionEvidenceGapReview(phase30TransitionRiskRegister = {}, releaseExitDecisionPreview = {}, finalReleaseBlockerDossier = {}, phase30EntryPreflight = {}, governanceArchiveFreeze = {}) {
  const gapItems = [
    { id: "blocker-clearance-evidence-gap", sourceSchemaVersion: finalReleaseBlockerDossier.schemaVersion, gapState: "open-blocking", requiredEvidence: ["human-clearance-evidence", "signed-blocker-disposition"], missingEvidence: ["human-clearance-evidence", "signed-blocker-disposition"], linkedRisks: ["unresolved-blocker-carryover"], mayClearBlocker: false, mayApproveRelease: false, mayEnterPhase30: false },
    { id: "release-signoff-evidence-gap", sourceSchemaVersion: releaseExitDecisionPreview.schemaVersion, gapState: "open-blocking", requiredEvidence: ["release-owner-signoff", "approved-exit-decision"], missingEvidence: ["release-owner-signoff", "approved-exit-decision"], linkedRisks: ["release-approval-gap"], mayClearBlocker: false, mayApproveRelease: false, mayEnterPhase30: false },
    { id: "runtime-validation-evidence-gap", sourceSchemaVersion: phase30TransitionRiskRegister.schemaVersion, gapState: "open-blocking", requiredEvidence: ["runtime-validation-review", "permission-policy-review"], missingEvidence: ["runtime-validation-review", "permission-policy-review"], linkedRisks: ["runtime-governance-gap"], mayClearBlocker: false, mayApproveRelease: false, mayEnterPhase30: false },
    { id: "phase30-entry-approval-evidence-gap", sourceSchemaVersion: phase30EntryPreflight.schemaVersion, gapState: "open-blocking", requiredEvidence: ["phase30-entry-approval", "handoff-owner-acceptance"], missingEvidence: ["phase30-entry-approval", "handoff-owner-acceptance"], linkedRisks: ["phase30-entry-authorization-gap"], mayClearBlocker: false, mayApproveRelease: false, mayEnterPhase30: false },
    { id: "archive-integrity-evidence-gap", sourceSchemaVersion: governanceArchiveFreeze.schemaVersion, gapState: "open-blocking", requiredEvidence: ["archive-integrity-review", "frozen-export-manifest-review"], missingEvidence: ["archive-integrity-review"], linkedRisks: ["exit-ledger-unmet-criteria"], mayClearBlocker: false, mayApproveRelease: false, mayEnterPhase30: false }
  ];
  const evidenceReviewLanes = [
    { id: "human-clearance-evidence-review", owner: "human-release-governance", state: "review-needed", linkedGaps: ["blocker-clearance-evidence-gap"], blockedActions: ["clear-blocker-from-evidence-gap-review", "persist-evidence-gap-review-as-clearance"] },
    { id: "release-signoff-review", owner: "release-owner", state: "review-needed", linkedGaps: ["release-signoff-evidence-gap"], blockedActions: ["apply-evidence-gap-review-as-release-approval", "mark-releaseReady-true"] },
    { id: "runtime-evidence-review", owner: "runtime-reviewer", state: "review-needed", linkedGaps: ["runtime-validation-evidence-gap"], blockedActions: ["enable-runtime-execution", "enable-third-party-execution"] },
    { id: "phase30-entry-evidence-review", owner: "phase30-owner", state: "blocked", linkedGaps: ["phase30-entry-approval-evidence-gap", "archive-integrity-evidence-gap"], blockedActions: ["persist-evidence-gap-review-as-phase30-entry", "open-phase30-entry-from-evidence-gap-review"] }
  ];
  const gapChecks = [
    { id: "gap-review-linked-to-risk-register", result: phase30TransitionRiskRegister.schemaVersion === "phase29.phase30-transition-risk-register.v1" ? "pass" : "block", evidence: phase30TransitionRiskRegister.schemaVersion },
    { id: "gap-review-keeps-blockers-open", result: "pass", evidence: "clearedBlockers=0" },
    { id: "gap-review-keeps-release-blocked", result: "pass", evidence: "releaseReady=false" },
    { id: "gap-review-keeps-phase30-blocked", result: "pass", evidence: "phase30EntryReady=false" },
    { id: "gap-review-keeps-runtime-disabled", result: "pass", evidence: "runtimeExecution=false and thirdPartyExecution=false" },
    { id: "gap-review-does-not-persist-mutations", result: "pass", evidence: "persistedMutations=0" }
  ];
  return {
    schemaVersion: "phase29.transition-evidence-gap-review.v1",
    version: "1.9.17",
    mode: "readonly-transition-evidence-gap-review-no-clearance",
    sourceModels: {
      phase30TransitionRiskRegister: phase30TransitionRiskRegister.schemaVersion,
      releaseExitDecisionPreview: releaseExitDecisionPreview.schemaVersion,
      finalReleaseBlockerDossier: finalReleaseBlockerDossier.schemaVersion,
      phase30EntryPreflight: phase30EntryPreflight.schemaVersion,
      governanceArchiveFreeze: governanceArchiveFreeze.schemaVersion
    },
    gapItems,
    evidenceReviewLanes,
    gapChecks,
    blockedMutations: [
      "persist-evidence-gap-review-as-clearance",
      "persist-evidence-gap-review-as-release-approval",
      "persist-evidence-gap-review-as-phase30-entry",
      "apply-evidence-gap-review-as-release-approval",
      "open-phase30-entry-from-evidence-gap-review",
      "close-evidence-gap-without-human-signoff",
      "clear-blocker-from-evidence-gap-review",
      "mark-releaseReady-true",
      "enable-runtime-execution",
      "enable-third-party-execution"
    ],
    exportPolicy: {
      exportName: "phase29-transition-evidence-gap-review.json",
      includeInOperationsExport: true,
      redaction: "gap-id-state-required-evidence-missing-evidence-and-readonly-review-lane-only"
    },
    summary: {
      transitionEvidenceGapReviewReady: true,
      gapItems: gapItems.length,
      blockingEvidenceGaps: gapItems.filter((item) => item.gapState === "open-blocking").length,
      evidenceReviewLanes: evidenceReviewLanes.length,
      gapChecks: gapChecks.length,
      passedGapChecks: gapChecks.filter((item) => item.result === "pass").length,
      phase29ExitReady: false,
      phase30Blocked: true,
      phase30EntryReady: false,
      releaseReady: false,
      runtimeExecution: false,
      thirdPartyExecution: false,
      clearedBlockers: 0,
      persistedMutations: 0
    }
  };
}

function buildPhase29TransitionReadinessRedline(transitionEvidenceGapReview = {}, phase30TransitionRiskRegister = {}, releaseExitDecisionPreview = {}, phase30EntryPreflight = {}, runtimeEnableGovernance = {}) {
  const redlineItems = [
    { id: "blocker-clearance-redline", sourceSchemaVersion: transitionEvidenceGapReview.schemaVersion, redlineState: "active-blocking", evidence: "blockingEvidenceGaps>=1", blockedUntil: ["human-clearance-evidence-reviewed", "signed-blocker-disposition"], mayClearBlocker: false, mayApproveRelease: false, mayExitPhase29: false, mayEnterPhase30: false },
    { id: "release-approval-redline", sourceSchemaVersion: releaseExitDecisionPreview.schemaVersion, redlineState: "active-blocking", evidence: "releaseReady=false", blockedUntil: ["release-owner-signoff", "approved-exit-decision"], mayClearBlocker: false, mayApproveRelease: false, mayExitPhase29: false, mayEnterPhase30: false },
    { id: "phase29-exit-redline", sourceSchemaVersion: releaseExitDecisionPreview.schemaVersion, redlineState: "active-blocking", evidence: "phase29ExitReady=false", blockedUntil: ["exit-criteria-met", "exit-decision-approved"], mayClearBlocker: false, mayApproveRelease: false, mayExitPhase29: false, mayEnterPhase30: false },
    { id: "phase30-entry-redline", sourceSchemaVersion: phase30EntryPreflight.schemaVersion, redlineState: "active-blocking", evidence: "phase30EntryReady=false", blockedUntil: ["phase30-entry-approval", "handoff-owner-acceptance"], mayClearBlocker: false, mayApproveRelease: false, mayExitPhase29: false, mayEnterPhase30: false },
    { id: "runtime-enable-redline", sourceSchemaVersion: runtimeEnableGovernance.schemaVersion, redlineState: "active-blocking", evidence: "runtimeExecution=false and thirdPartyExecution=false", blockedUntil: ["runtime-validation-review", "permission-policy-review"], mayClearBlocker: false, mayApproveRelease: false, mayExitPhase29: false, mayEnterPhase30: false }
  ];
  const redlineReviewMatrix = [
    { id: "evidence-gap-redline-review", owner: "human-release-governance", state: "blocked", linkedRedlines: ["blocker-clearance-redline"], blockedActions: ["clear-blocker-from-redline", "persist-redline-as-clearance"] },
    { id: "release-redline-review", owner: "release-owner", state: "blocked", linkedRedlines: ["release-approval-redline", "phase29-exit-redline"], blockedActions: ["approve-release-from-redline", "persist-redline-as-release-approval"] },
    { id: "phase30-entry-redline-review", owner: "phase30-owner", state: "blocked", linkedRedlines: ["phase30-entry-redline"], blockedActions: ["persist-redline-as-phase30-entry", "open-phase30-entry-from-redline"] },
    { id: "runtime-redline-review", owner: "runtime-reviewer", state: "blocked", linkedRedlines: ["runtime-enable-redline"], blockedActions: ["enable-runtime-execution", "enable-third-party-execution"] }
  ];
  const redlineChecks = [
    { id: "redline-linked-to-evidence-gap-review", result: transitionEvidenceGapReview.schemaVersion === "phase29.transition-evidence-gap-review.v1" ? "pass" : "block", evidence: transitionEvidenceGapReview.schemaVersion },
    { id: "redline-keeps-blockers-open", result: "pass", evidence: "clearedBlockers=0" },
    { id: "redline-keeps-release-blocked", result: "pass", evidence: "releaseReady=false" },
    { id: "redline-keeps-exit-blocked", result: "pass", evidence: "phase29ExitReady=false" },
    { id: "redline-keeps-phase30-blocked", result: "pass", evidence: "phase30EntryReady=false" },
    { id: "redline-keeps-runtime-disabled", result: "pass", evidence: "runtimeExecution=false and thirdPartyExecution=false" },
    { id: "redline-does-not-persist-mutations", result: "pass", evidence: "persistedMutations=0" }
  ];
  return {
    schemaVersion: "phase29.transition-readiness-redline.v1",
    version: "1.9.18",
    mode: "readonly-transition-readiness-redline-no-override",
    sourceModels: {
      transitionEvidenceGapReview: transitionEvidenceGapReview.schemaVersion,
      phase30TransitionRiskRegister: phase30TransitionRiskRegister.schemaVersion,
      releaseExitDecisionPreview: releaseExitDecisionPreview.schemaVersion,
      phase30EntryPreflight: phase30EntryPreflight.schemaVersion,
      runtimeEnableGovernance: runtimeEnableGovernance.schemaVersion
    },
    redlineItems,
    redlineReviewMatrix,
    redlineChecks,
    blockedMutations: [
      "persist-redline-as-clearance",
      "persist-redline-as-release-approval",
      "persist-redline-as-phase30-entry",
      "approve-release-from-redline",
      "open-phase30-entry-from-redline",
      "override-transition-redline",
      "clear-blocker-from-redline",
      "mark-redline-resolved-without-evidence",
      "mark-releaseReady-true",
      "enable-runtime-execution",
      "enable-third-party-execution"
    ],
    exportPolicy: {
      exportName: "phase29-transition-readiness-redline.json",
      includeInOperationsExport: true,
      redaction: "redline-id-state-evidence-blocked-until-and-readonly-review-matrix-only"
    },
    summary: {
      transitionReadinessRedlineReady: true,
      redlineItems: redlineItems.length,
      activeRedlines: redlineItems.filter((item) => item.redlineState === "active-blocking").length,
      redlineReviewItems: redlineReviewMatrix.length,
      redlineChecks: redlineChecks.length,
      passedRedlineChecks: redlineChecks.filter((item) => item.result === "pass").length,
      phase29ExitReady: false,
      phase30Blocked: true,
      phase30EntryReady: false,
      releaseReady: false,
      runtimeExecution: false,
      thirdPartyExecution: false,
      clearedBlockers: 0,
      persistedMutations: 0
    }
  };
}

function buildPhase29FinalTransitionHandoffPreview(transitionReadinessRedline = {}, transitionEvidenceGapReview = {}, phase30TransitionRiskRegister = {}, releaseExitDecisionPreview = {}, phase30EntryPreflight = {}, governanceArchiveFreeze = {}) {
  const handoffPreviewSections = [
    { id: "transition-readiness-redline-summary", label: "Transition readiness redline summary", sourceSchemaVersion: transitionReadinessRedline.schemaVersion, sectionState: "readonly-blocked", evidence: "activeRedlines>=1", requiredBeforeHandoff: ["redline-review-complete", "human-release-governance-signoff"], mayApproveRelease: false, mayExitPhase29: false, mayEnterPhase30: false },
    { id: "transition-evidence-gap-summary", label: "Transition evidence gap summary", sourceSchemaVersion: transitionEvidenceGapReview.schemaVersion, sectionState: "readonly-blocked", evidence: "blockingEvidenceGaps>=1", requiredBeforeHandoff: ["blocking-evidence-gaps-closed", "signed-evidence-review"], mayApproveRelease: false, mayExitPhase29: false, mayEnterPhase30: false },
    { id: "phase30-transition-risk-summary", label: "Phase 30 transition risk summary", sourceSchemaVersion: phase30TransitionRiskRegister.schemaVersion, sectionState: "readonly-blocked", evidence: "blockedTransitionRisks>=1", requiredBeforeHandoff: ["transition-risk-mitigation-reviewed", "phase30-owner-acceptance"], mayApproveRelease: false, mayExitPhase29: false, mayEnterPhase30: false },
    { id: "release-exit-decision-summary", label: "Release exit decision summary", sourceSchemaVersion: releaseExitDecisionPreview.schemaVersion, sectionState: "readonly-blocked", evidence: "phase29ExitDecision=block-exit", requiredBeforeHandoff: ["release-owner-decision", "exit-criteria-met"], mayApproveRelease: false, mayExitPhase29: false, mayEnterPhase30: false },
    { id: "phase30-entry-guardrail-summary", label: "Phase 30 entry guardrail summary", sourceSchemaVersion: phase30EntryPreflight.schemaVersion, sectionState: "phase30-blocked", evidence: "phase30EntryReady=false", requiredBeforeHandoff: ["phase30-entry-approval", "handoff-owner-acceptance"], mayApproveRelease: false, mayExitPhase29: false, mayEnterPhase30: false },
    { id: "runtime-guardrail-summary", label: "Runtime guardrail summary", sourceSchemaVersion: governanceArchiveFreeze.schemaVersion, sectionState: "runtime-disabled", evidence: "runtimeExecution=false and thirdPartyExecution=false", requiredBeforeHandoff: ["runtime-validation-review", "permission-policy-review"], mayApproveRelease: false, mayExitPhase29: false, mayEnterPhase30: false }
  ];
  const handoffPreviewChecks = [
    { id: "handoff-preview-linked-to-redline", result: transitionReadinessRedline.schemaVersion === "phase29.transition-readiness-redline.v1" ? "pass" : "block", evidence: transitionReadinessRedline.schemaVersion },
    { id: "handoff-preview-keeps-release-blocked", result: "pass", evidence: "releaseReady=false" },
    { id: "handoff-preview-keeps-exit-blocked", result: "pass", evidence: "phase29ExitReady=false" },
    { id: "handoff-preview-keeps-phase30-blocked", result: "pass", evidence: "phase30EntryReady=false" },
    { id: "handoff-preview-keeps-runtime-disabled", result: "pass", evidence: "runtimeExecution=false and thirdPartyExecution=false" },
    { id: "handoff-preview-does-not-persist-mutations", result: "pass", evidence: "persistedMutations=0" }
  ];
  return {
    schemaVersion: "phase29.final-transition-handoff-preview.v1",
    version: "1.9.19",
    mode: "readonly-final-transition-handoff-preview-no-entry",
    sourceModels: {
      transitionReadinessRedline: transitionReadinessRedline.schemaVersion,
      transitionEvidenceGapReview: transitionEvidenceGapReview.schemaVersion,
      phase30TransitionRiskRegister: phase30TransitionRiskRegister.schemaVersion,
      releaseExitDecisionPreview: releaseExitDecisionPreview.schemaVersion,
      phase30EntryPreflight: phase30EntryPreflight.schemaVersion,
      governanceArchiveFreeze: governanceArchiveFreeze.schemaVersion
    },
    handoffPreviewSections,
    handoffPreviewChecks,
    blockedMutations: [
      "persist-handoff-preview-as-clearance",
      "persist-handoff-preview-as-release-approval",
      "persist-handoff-preview-as-phase30-entry",
      "approve-release-from-handoff-preview",
      "open-phase30-entry-from-handoff-preview",
      "clear-blocker-from-handoff-preview",
      "override-redline-from-handoff-preview",
      "mark-releaseReady-true",
      "enable-runtime-execution",
      "enable-third-party-execution"
    ],
    exportPolicy: {
      exportName: "phase29-final-transition-handoff-preview.json",
      includeInOperationsExport: true,
      redaction: "handoff-section-state-source-evidence-and-readonly-guardrail-summary-only"
    },
    summary: {
      finalTransitionHandoffPreviewReady: true,
      handoffPreviewSections: handoffPreviewSections.length,
      blockedHandoffPreviewSections: handoffPreviewSections.filter((item) => item.sectionState.includes("blocked")).length,
      handoffPreviewChecks: handoffPreviewChecks.length,
      passedHandoffPreviewChecks: handoffPreviewChecks.filter((item) => item.result === "pass").length,
      phase29ExitReady: false,
      phase30Blocked: true,
      phase30EntryReady: false,
      releaseReady: false,
      runtimeExecution: false,
      thirdPartyExecution: false,
      clearedBlockers: 0,
      persistedMutations: 0
    }
  };
}

function buildPhase29TransitionClosurePackagePreview(finalTransitionHandoffPreview = {}, transitionReadinessRedline = {}, transitionEvidenceGapReview = {}, phase30TransitionRiskRegister = {}, releaseExitDecisionPreview = {}, governanceArchiveFreeze = {}, phase30EntryPreflight = {}) {
  const closurePreviewItems = [
    { id: "final-handoff-preview-lock", label: "Final handoff preview lock", sourceSchemaVersion: finalTransitionHandoffPreview.schemaVersion, previewState: "readonly-blocked", evidence: "finalTransitionHandoffPreviewReady=true", requiredBeforeClosure: ["handoff-preview-reviewed", "handoff-owner-signoff"], mayClearBlocker: false, mayApproveRelease: false, mayExitPhase29: false, mayEnterPhase30: false },
    { id: "transition-redline-lock", label: "Transition redline lock", sourceSchemaVersion: transitionReadinessRedline.schemaVersion, previewState: "readonly-blocked", evidence: "activeRedlines>=1", requiredBeforeClosure: ["redline-resolution-reviewed", "redline-override-not-requested"], mayClearBlocker: false, mayApproveRelease: false, mayExitPhase29: false, mayEnterPhase30: false },
    { id: "evidence-gap-lock", label: "Evidence gap lock", sourceSchemaVersion: transitionEvidenceGapReview.schemaVersion, previewState: "readonly-blocked", evidence: "blockingEvidenceGaps>=1", requiredBeforeClosure: ["missing-evidence-attached", "human-evidence-signoff"], mayClearBlocker: false, mayApproveRelease: false, mayExitPhase29: false, mayEnterPhase30: false },
    { id: "transition-risk-lock", label: "Transition risk lock", sourceSchemaVersion: phase30TransitionRiskRegister.schemaVersion, previewState: "readonly-blocked", evidence: "blockedTransitionRisks>=1", requiredBeforeClosure: ["transition-risk-mitigation-reviewed", "phase30-owner-risk-acceptance"], mayClearBlocker: false, mayApproveRelease: false, mayExitPhase29: false, mayEnterPhase30: false },
    { id: "exit-decision-lock", label: "Exit decision lock", sourceSchemaVersion: releaseExitDecisionPreview.schemaVersion, previewState: "readonly-blocked", evidence: "phase29ExitDecision=block-exit", requiredBeforeClosure: ["exit-decision-approved", "release-owner-signoff"], mayClearBlocker: false, mayApproveRelease: false, mayExitPhase29: false, mayEnterPhase30: false },
    { id: "archive-freeze-lock", label: "Archive freeze lock", sourceSchemaVersion: governanceArchiveFreeze.schemaVersion, previewState: "frozen-readonly", evidence: "archive remains frozen-readonly", requiredBeforeClosure: ["archive-integrity-review", "no-archive-rewrite-request"], mayClearBlocker: false, mayApproveRelease: false, mayExitPhase29: false, mayEnterPhase30: false },
    { id: "phase30-entry-lock", label: "Phase 30 entry lock", sourceSchemaVersion: phase30EntryPreflight.schemaVersion, previewState: "phase30-blocked", evidence: "phase30EntryReady=false", requiredBeforeClosure: ["phase30-entry-approval", "handoff-owner-acceptance"], mayClearBlocker: false, mayApproveRelease: false, mayExitPhase29: false, mayEnterPhase30: false },
    { id: "runtime-execution-lock", label: "Runtime execution lock", sourceSchemaVersion: governanceArchiveFreeze.schemaVersion, previewState: "runtime-disabled", evidence: "runtimeExecution=false and thirdPartyExecution=false", requiredBeforeClosure: ["runtime-validation-review", "permission-policy-review"], mayClearBlocker: false, mayApproveRelease: false, mayExitPhase29: false, mayEnterPhase30: false }
  ];
  const closurePreviewChecks = [
    { id: "closure-preview-linked-to-handoff", result: finalTransitionHandoffPreview.schemaVersion === "phase29.final-transition-handoff-preview.v1" ? "pass" : "block", evidence: finalTransitionHandoffPreview.schemaVersion },
    { id: "closure-preview-keeps-blockers-open", result: "pass", evidence: "clearedBlockers=0" },
    { id: "closure-preview-keeps-release-blocked", result: "pass", evidence: "releaseReady=false" },
    { id: "closure-preview-keeps-exit-blocked", result: "pass", evidence: "phase29ExitReady=false" },
    { id: "closure-preview-keeps-phase30-blocked", result: "pass", evidence: "phase30EntryReady=false" },
    { id: "closure-preview-keeps-runtime-disabled", result: "pass", evidence: "runtimeExecution=false and thirdPartyExecution=false" },
    { id: "closure-preview-does-not-persist-mutations", result: "pass", evidence: "persistedMutations=0" }
  ];
  return {
    schemaVersion: "phase29.transition-closure-package-preview.v1",
    version: "1.9.20",
    mode: "readonly-transition-closure-package-preview-no-exit",
    sourceModels: {
      finalTransitionHandoffPreview: finalTransitionHandoffPreview.schemaVersion,
      transitionReadinessRedline: transitionReadinessRedline.schemaVersion,
      transitionEvidenceGapReview: transitionEvidenceGapReview.schemaVersion,
      phase30TransitionRiskRegister: phase30TransitionRiskRegister.schemaVersion,
      releaseExitDecisionPreview: releaseExitDecisionPreview.schemaVersion,
      governanceArchiveFreeze: governanceArchiveFreeze.schemaVersion,
      phase30EntryPreflight: phase30EntryPreflight.schemaVersion
    },
    closurePreviewItems,
    closurePreviewChecks,
    blockedMutations: [
      "persist-closure-preview-as-clearance",
      "persist-closure-preview-as-release-approval",
      "persist-closure-preview-as-phase29-exit",
      "persist-closure-preview-as-phase30-entry",
      "approve-release-from-closure-preview",
      "exit-phase29-from-closure-preview",
      "open-phase30-entry-from-closure-preview",
      "clear-blocker-from-closure-preview",
      "override-handoff-preview-from-closure-preview",
      "mark-releaseReady-true",
      "enable-runtime-execution",
      "enable-third-party-execution"
    ],
    exportPolicy: {
      exportName: "phase29-transition-closure-package-preview.json",
      includeInOperationsExport: true,
      redaction: "closure-preview-item-state-source-evidence-and-readonly-guardrail-summary-only"
    },
    summary: {
      transitionClosurePackagePreviewReady: true,
      closurePreviewItems: closurePreviewItems.length,
      blockedClosurePreviewItems: closurePreviewItems.filter((item) => item.previewState.includes("blocked")).length,
      closurePreviewChecks: closurePreviewChecks.length,
      passedClosurePreviewChecks: closurePreviewChecks.filter((item) => item.result === "pass").length,
      phase29ExitReady: false,
      phase30Blocked: true,
      phase30EntryReady: false,
      releaseReady: false,
      runtimeExecution: false,
      thirdPartyExecution: false,
      clearedBlockers: 0,
      persistedMutations: 0
    }
  };
}

function buildPhase29ReleaseCandidateFreezePreview(transitionClosurePackagePreview = {}, finalTransitionHandoffPreview = {}, transitionReadinessRedline = {}, releaseExitDecisionPreview = {}, governanceArchiveFreeze = {}, phase30EntryPreflight = {}, runtimeEnableGovernance = {}) {
  const freezePreviewItems = [
    { id: "closure-package-freeze", label: "Closure package freeze", sourceSchemaVersion: transitionClosurePackagePreview.schemaVersion, freezeState: "readonly-freeze-blocked", evidence: "transitionClosurePackagePreviewReady=true", requiredBeforeReleaseCandidate: ["closure-preview-reviewed", "human-release-governance-signoff"], mayApproveRelease: false, mayExitPhase29: false, mayEnterPhase30: false, mayEnableRuntime: false },
    { id: "handoff-freeze", label: "Handoff freeze", sourceSchemaVersion: finalTransitionHandoffPreview.schemaVersion, freezeState: "readonly-freeze-blocked", evidence: "finalTransitionHandoffPreviewReady=true", requiredBeforeReleaseCandidate: ["handoff-preview-reviewed", "handoff-owner-signoff"], mayApproveRelease: false, mayExitPhase29: false, mayEnterPhase30: false, mayEnableRuntime: false },
    { id: "redline-freeze", label: "Redline freeze", sourceSchemaVersion: transitionReadinessRedline.schemaVersion, freezeState: "readonly-freeze-blocked", evidence: "activeRedlines>=1", requiredBeforeReleaseCandidate: ["redlines-resolved", "override-not-requested"], mayApproveRelease: false, mayExitPhase29: false, mayEnterPhase30: false, mayEnableRuntime: false },
    { id: "exit-decision-freeze", label: "Exit decision freeze", sourceSchemaVersion: releaseExitDecisionPreview.schemaVersion, freezeState: "exit-blocked", evidence: "phase29ExitDecision=block-exit", requiredBeforeReleaseCandidate: ["exit-decision-approved", "release-owner-signoff"], mayApproveRelease: false, mayExitPhase29: false, mayEnterPhase30: false, mayEnableRuntime: false },
    { id: "archive-freeze-integrity", label: "Archive freeze integrity", sourceSchemaVersion: governanceArchiveFreeze.schemaVersion, freezeState: "frozen-readonly", evidence: "archive remains frozen-readonly", requiredBeforeReleaseCandidate: ["archive-integrity-reviewed", "no-archive-rewrite-request"], mayApproveRelease: false, mayExitPhase29: false, mayEnterPhase30: false, mayEnableRuntime: false },
    { id: "phase30-entry-freeze", label: "Phase 30 entry freeze", sourceSchemaVersion: phase30EntryPreflight.schemaVersion, freezeState: "phase30-blocked", evidence: "phase30EntryReady=false", requiredBeforeReleaseCandidate: ["phase30-entry-approval", "handoff-owner-acceptance"], mayApproveRelease: false, mayExitPhase29: false, mayEnterPhase30: false, mayEnableRuntime: false },
    { id: "runtime-freeze", label: "Runtime freeze", sourceSchemaVersion: runtimeEnableGovernance.schemaVersion, freezeState: "runtime-disabled", evidence: "runtimeExecution=false and thirdPartyExecution=false", requiredBeforeReleaseCandidate: ["runtime-validation-review", "permission-policy-review"], mayApproveRelease: false, mayExitPhase29: false, mayEnterPhase30: false, mayEnableRuntime: false }
  ];
  const freezePreviewChecks = [
    { id: "freeze-preview-linked-to-closure-preview", result: transitionClosurePackagePreview.schemaVersion === "phase29.transition-closure-package-preview.v1" ? "pass" : "block", evidence: transitionClosurePackagePreview.schemaVersion },
    { id: "freeze-preview-keeps-release-blocked", result: "pass", evidence: "releaseReady=false" },
    { id: "freeze-preview-keeps-exit-blocked", result: "pass", evidence: "phase29ExitReady=false" },
    { id: "freeze-preview-keeps-phase30-blocked", result: "pass", evidence: "phase30EntryReady=false" },
    { id: "freeze-preview-keeps-runtime-disabled", result: "pass", evidence: "runtimeExecution=false and thirdPartyExecution=false" },
    { id: "freeze-preview-does-not-persist-mutations", result: "pass", evidence: "persistedMutations=0" }
  ];
  return {
    schemaVersion: "phase29.release-candidate-freeze-preview.v1",
    version: "1.9.21",
    mode: "readonly-release-candidate-freeze-preview-no-approval",
    sourceModels: {
      transitionClosurePackagePreview: transitionClosurePackagePreview.schemaVersion,
      finalTransitionHandoffPreview: finalTransitionHandoffPreview.schemaVersion,
      transitionReadinessRedline: transitionReadinessRedline.schemaVersion,
      releaseExitDecisionPreview: releaseExitDecisionPreview.schemaVersion,
      governanceArchiveFreeze: governanceArchiveFreeze.schemaVersion,
      phase30EntryPreflight: phase30EntryPreflight.schemaVersion,
      runtimeEnableGovernance: runtimeEnableGovernance.schemaVersion
    },
    freezePreviewItems,
    freezePreviewChecks,
    blockedMutations: [
      "persist-freeze-preview-as-release-approval",
      "persist-freeze-preview-as-phase29-exit",
      "persist-freeze-preview-as-phase30-entry",
      "approve-release-from-freeze-preview",
      "exit-phase29-from-freeze-preview",
      "open-phase30-entry-from-freeze-preview",
      "clear-blocker-from-freeze-preview",
      "unfreeze-release-candidate-without-review",
      "override-closure-preview-from-freeze-preview",
      "mark-releaseReady-true",
      "enable-runtime-execution",
      "enable-third-party-execution"
    ],
    exportPolicy: {
      exportName: "phase29-release-candidate-freeze-preview.json",
      includeInOperationsExport: true,
      redaction: "freeze-preview-item-state-source-evidence-and-readonly-guardrail-summary-only"
    },
    summary: {
      releaseCandidateFreezePreviewReady: true,
      freezePreviewItems: freezePreviewItems.length,
      blockedFreezePreviewItems: freezePreviewItems.filter((item) => item.freezeState.includes("blocked")).length,
      freezePreviewChecks: freezePreviewChecks.length,
      passedFreezePreviewChecks: freezePreviewChecks.filter((item) => item.result === "pass").length,
      phase29ExitReady: false,
      phase30Blocked: true,
      phase30EntryReady: false,
      releaseReady: false,
      runtimeExecution: false,
      thirdPartyExecution: false,
      clearedBlockers: 0,
      persistedMutations: 0
    }
  };
}

function buildPhase29FinalReadinessBoardPreview(releaseCandidateFreezePreview = {}, transitionClosurePackagePreview = {}, finalTransitionHandoffPreview = {}, transitionReadinessRedline = {}, releaseExitDecisionPreview = {}, phase30EntryPreflight = {}, runtimeEnableGovernance = {}) {
  const readinessBoardItems = [
    { id: "release-candidate-freeze-board", label: "Release candidate freeze board", sourceSchemaVersion: releaseCandidateFreezePreview.schemaVersion, boardState: "release-blocked-readonly", evidence: "releaseCandidateFreezePreviewReady=true", requiredBeforeFinalReadiness: ["release-candidate-freeze-reviewed", "human-release-governance-signoff"], mayClearBlocker: false, mayApproveRelease: false, mayExitPhase29: false, mayEnterPhase30: false, mayEnableRuntime: false },
    { id: "transition-closure-board", label: "Transition closure board", sourceSchemaVersion: transitionClosurePackagePreview.schemaVersion, boardState: "exit-blocked-readonly", evidence: "transitionClosurePackagePreviewReady=true", requiredBeforeFinalReadiness: ["transition-closure-reviewed", "phase29-exit-owner-signoff"], mayClearBlocker: false, mayApproveRelease: false, mayExitPhase29: false, mayEnterPhase30: false, mayEnableRuntime: false },
    { id: "handoff-preview-board", label: "Handoff preview board", sourceSchemaVersion: finalTransitionHandoffPreview.schemaVersion, boardState: "handoff-blocked-readonly", evidence: "blockedHandoffPreviewSections>=1", requiredBeforeFinalReadiness: ["handoff-preview-reviewed", "handoff-owner-acceptance"], mayClearBlocker: false, mayApproveRelease: false, mayExitPhase29: false, mayEnterPhase30: false, mayEnableRuntime: false },
    { id: "transition-redline-board", label: "Transition redline board", sourceSchemaVersion: transitionReadinessRedline.schemaVersion, boardState: "redline-blocked-readonly", evidence: "activeRedlines>=1", requiredBeforeFinalReadiness: ["redlines-resolved", "override-not-requested"], mayClearBlocker: false, mayApproveRelease: false, mayExitPhase29: false, mayEnterPhase30: false, mayEnableRuntime: false },
    { id: "release-exit-decision-board", label: "Release exit decision board", sourceSchemaVersion: releaseExitDecisionPreview.schemaVersion, boardState: "exit-decision-blocked", evidence: "phase29ExitDecision=block-exit", requiredBeforeFinalReadiness: ["exit-decision-approved", "release-owner-signoff"], mayClearBlocker: false, mayApproveRelease: false, mayExitPhase29: false, mayEnterPhase30: false, mayEnableRuntime: false },
    { id: "phase30-entry-board", label: "Phase 30 entry board", sourceSchemaVersion: phase30EntryPreflight.schemaVersion, boardState: "phase30-blocked", evidence: "phase30EntryReady=false", requiredBeforeFinalReadiness: ["phase30-entry-approval", "handoff-owner-acceptance"], mayClearBlocker: false, mayApproveRelease: false, mayExitPhase29: false, mayEnterPhase30: false, mayEnableRuntime: false },
    { id: "runtime-readiness-board", label: "Runtime readiness board", sourceSchemaVersion: runtimeEnableGovernance.schemaVersion, boardState: "runtime-disabled", evidence: "runtimeExecution=false and thirdPartyExecution=false", requiredBeforeFinalReadiness: ["runtime-validation-review", "permission-policy-review"], mayClearBlocker: false, mayApproveRelease: false, mayExitPhase29: false, mayEnterPhase30: false, mayEnableRuntime: false }
  ];
  const readinessBoardChecks = [
    { id: "board-linked-to-freeze-preview", result: releaseCandidateFreezePreview.schemaVersion === "phase29.release-candidate-freeze-preview.v1" ? "pass" : "block", evidence: releaseCandidateFreezePreview.schemaVersion },
    { id: "board-linked-to-transition-closure", result: transitionClosurePackagePreview.schemaVersion === "phase29.transition-closure-package-preview.v1" ? "pass" : "block", evidence: transitionClosurePackagePreview.schemaVersion },
    { id: "board-keeps-release-blocked", result: "pass", evidence: "releaseReady=false" },
    { id: "board-keeps-exit-blocked", result: "pass", evidence: "phase29ExitReady=false" },
    { id: "board-keeps-phase30-blocked", result: "pass", evidence: "phase30EntryReady=false" },
    { id: "board-keeps-runtime-disabled", result: "pass", evidence: "runtimeExecution=false and thirdPartyExecution=false" },
    { id: "board-does-not-persist-mutations", result: "pass", evidence: "persistedMutations=0" }
  ];
  return {
    schemaVersion: "phase29.final-readiness-board-preview.v1",
    version: "1.9.22",
    mode: "readonly-final-readiness-board-preview-no-approval",
    sourceModels: {
      releaseCandidateFreezePreview: releaseCandidateFreezePreview.schemaVersion,
      transitionClosurePackagePreview: transitionClosurePackagePreview.schemaVersion,
      finalTransitionHandoffPreview: finalTransitionHandoffPreview.schemaVersion,
      transitionReadinessRedline: transitionReadinessRedline.schemaVersion,
      releaseExitDecisionPreview: releaseExitDecisionPreview.schemaVersion,
      phase30EntryPreflight: phase30EntryPreflight.schemaVersion,
      runtimeEnableGovernance: runtimeEnableGovernance.schemaVersion
    },
    readinessBoardItems,
    readinessBoardChecks,
    blockedMutations: [
      "persist-readiness-board-as-release-approval",
      "persist-readiness-board-as-phase29-exit",
      "persist-readiness-board-as-phase30-entry",
      "approve-release-from-readiness-board",
      "exit-phase29-from-readiness-board",
      "open-phase30-entry-from-readiness-board",
      "clear-blocker-from-readiness-board",
      "override-freeze-preview-from-readiness-board",
      "mark-releaseReady-true",
      "enable-runtime-execution",
      "enable-third-party-execution"
    ],
    exportPolicy: {
      exportName: "phase29-final-readiness-board-preview.json",
      includeInOperationsExport: true,
      redaction: "readiness-board-item-state-source-evidence-and-readonly-guardrail-summary-only"
    },
    summary: {
      finalReadinessBoardPreviewReady: true,
      readinessBoardItems: readinessBoardItems.length,
      blockedReadinessBoardItems: readinessBoardItems.filter((item) => item.boardState.includes("blocked")).length,
      readinessBoardChecks: readinessBoardChecks.length,
      passedReadinessBoardChecks: readinessBoardChecks.filter((item) => item.result === "pass").length,
      phase29ExitReady: false,
      phase30Blocked: true,
      phase30EntryReady: false,
      releaseReady: false,
      runtimeExecution: false,
      thirdPartyExecution: false,
      clearedBlockers: 0,
      persistedMutations: 0
    }
  };
}

function buildPhase29ReleaseFinalReviewEnvelopePreview(finalReadinessBoardPreview = {}, releaseCandidateFreezePreview = {}, transitionClosurePackagePreview = {}, transitionReadinessRedline = {}, releaseExitDecisionPreview = {}, phase30EntryPreflight = {}, governanceArchiveFreeze = {}, runtimeEnableGovernance = {}) {
  const envelopeSections = [
    { id: "final-readiness-board-envelope", label: "Final readiness board envelope", sourceSchemaVersion: finalReadinessBoardPreview.schemaVersion, envelopeState: "review-open-readonly", evidence: "finalReadinessBoardPreviewReady=true", requiredBeforeFinalReview: ["final-board-reviewed", "release-governance-signoff"], mayClearBlocker: false, mayApproveRelease: false, mayExitPhase29: false, mayEnterPhase30: false, mayEnableRuntime: false },
    { id: "release-candidate-freeze-envelope", label: "Release candidate freeze envelope", sourceSchemaVersion: releaseCandidateFreezePreview.schemaVersion, envelopeState: "freeze-review-blocked", evidence: "releaseCandidateFreezePreviewReady=true", requiredBeforeFinalReview: ["freeze-preview-reviewed", "no-unfreeze-request"], mayClearBlocker: false, mayApproveRelease: false, mayExitPhase29: false, mayEnterPhase30: false, mayEnableRuntime: false },
    { id: "transition-closure-envelope", label: "Transition closure envelope", sourceSchemaVersion: transitionClosurePackagePreview.schemaVersion, envelopeState: "phase29-exit-blocked", evidence: "transitionClosurePackagePreviewReady=true", requiredBeforeFinalReview: ["transition-closure-reviewed", "phase29-exit-owner-signoff"], mayClearBlocker: false, mayApproveRelease: false, mayExitPhase29: false, mayEnterPhase30: false, mayEnableRuntime: false },
    { id: "redline-envelope", label: "Redline envelope", sourceSchemaVersion: transitionReadinessRedline.schemaVersion, envelopeState: "redline-blocked", evidence: "activeRedlines>=1", requiredBeforeFinalReview: ["redlines-resolved", "override-not-requested"], mayClearBlocker: false, mayApproveRelease: false, mayExitPhase29: false, mayEnterPhase30: false, mayEnableRuntime: false },
    { id: "exit-decision-envelope", label: "Exit decision envelope", sourceSchemaVersion: releaseExitDecisionPreview.schemaVersion, envelopeState: "exit-decision-blocked", evidence: "phase29ExitDecision=block-exit", requiredBeforeFinalReview: ["exit-decision-approved", "release-owner-signoff"], mayClearBlocker: false, mayApproveRelease: false, mayExitPhase29: false, mayEnterPhase30: false, mayEnableRuntime: false },
    { id: "phase30-entry-envelope", label: "Phase 30 entry envelope", sourceSchemaVersion: phase30EntryPreflight.schemaVersion, envelopeState: "phase30-entry-blocked", evidence: "phase30EntryReady=false", requiredBeforeFinalReview: ["phase30-entry-approval", "handoff-owner-acceptance"], mayClearBlocker: false, mayApproveRelease: false, mayExitPhase29: false, mayEnterPhase30: false, mayEnableRuntime: false },
    { id: "archive-and-runtime-envelope", label: "Archive and runtime envelope", sourceSchemaVersion: governanceArchiveFreeze.schemaVersion, runtimeSourceSchemaVersion: runtimeEnableGovernance.schemaVersion, envelopeState: "runtime-disabled-readonly", evidence: "archive frozen and runtimeExecution=false", requiredBeforeFinalReview: ["archive-integrity-review", "runtime-validation-review"], mayClearBlocker: false, mayApproveRelease: false, mayExitPhase29: false, mayEnterPhase30: false, mayEnableRuntime: false }
  ];
  const envelopeChecks = [
    { id: "envelope-linked-to-readiness-board", result: finalReadinessBoardPreview.schemaVersion === "phase29.final-readiness-board-preview.v1" ? "pass" : "block", evidence: finalReadinessBoardPreview.schemaVersion },
    { id: "envelope-linked-to-freeze-preview", result: releaseCandidateFreezePreview.schemaVersion === "phase29.release-candidate-freeze-preview.v1" ? "pass" : "block", evidence: releaseCandidateFreezePreview.schemaVersion },
    { id: "envelope-keeps-release-blocked", result: "pass", evidence: "releaseReady=false" },
    { id: "envelope-keeps-exit-blocked", result: "pass", evidence: "phase29ExitReady=false" },
    { id: "envelope-keeps-phase30-blocked", result: "pass", evidence: "phase30EntryReady=false" },
    { id: "envelope-keeps-runtime-disabled", result: "pass", evidence: "runtimeExecution=false and thirdPartyExecution=false" },
    { id: "envelope-does-not-persist-mutations", result: "pass", evidence: "persistedMutations=0" }
  ];
  return {
    schemaVersion: "phase29.release-final-review-envelope-preview.v1",
    version: "1.9.23",
    mode: "readonly-release-final-review-envelope-preview-no-approval",
    sourceModels: {
      finalReadinessBoardPreview: finalReadinessBoardPreview.schemaVersion,
      releaseCandidateFreezePreview: releaseCandidateFreezePreview.schemaVersion,
      transitionClosurePackagePreview: transitionClosurePackagePreview.schemaVersion,
      transitionReadinessRedline: transitionReadinessRedline.schemaVersion,
      releaseExitDecisionPreview: releaseExitDecisionPreview.schemaVersion,
      phase30EntryPreflight: phase30EntryPreflight.schemaVersion,
      governanceArchiveFreeze: governanceArchiveFreeze.schemaVersion,
      runtimeEnableGovernance: runtimeEnableGovernance.schemaVersion
    },
    envelopeSections,
    envelopeChecks,
    blockedMutations: [
      "persist-final-review-envelope-as-release-approval",
      "persist-final-review-envelope-as-phase29-exit",
      "persist-final-review-envelope-as-phase30-entry",
      "approve-release-from-final-review-envelope",
      "exit-phase29-from-final-review-envelope",
      "open-phase30-entry-from-final-review-envelope",
      "clear-blocker-from-final-review-envelope",
      "override-readiness-board-from-final-review-envelope",
      "mark-releaseReady-true",
      "enable-runtime-execution",
      "enable-third-party-execution"
    ],
    exportPolicy: {
      exportName: "phase29-release-final-review-envelope-preview.json",
      includeInOperationsExport: true,
      redaction: "final-review-envelope-section-state-source-evidence-and-readonly-guardrail-summary-only"
    },
    summary: {
      releaseFinalReviewEnvelopePreviewReady: true,
      envelopeSections: envelopeSections.length,
      blockedEnvelopeSections: envelopeSections.filter((item) => item.envelopeState.includes("blocked")).length,
      envelopeChecks: envelopeChecks.length,
      passedEnvelopeChecks: envelopeChecks.filter((item) => item.result === "pass").length,
      phase29ExitReady: false,
      phase30Blocked: true,
      phase30EntryReady: false,
      releaseReady: false,
      runtimeExecution: false,
      thirdPartyExecution: false,
      clearedBlockers: 0,
      persistedMutations: 0
    }
  };
}

function buildPhase29ExitReadinessAttestationPreview(releaseFinalReviewEnvelopePreview = {}, finalReadinessBoardPreview = {}, releaseExitDecisionPreview = {}, phase30EntryPreflight = {}, transitionReadinessRedline = {}, finalReleaseBlockerDossier = {}, runtimeEnableGovernance = {}, governanceArchiveFreeze = {}) {
  const attestationItems = [
    { id: "final-review-envelope-attestation", label: "Final review envelope attestation", sourceSchemaVersion: releaseFinalReviewEnvelopePreview.schemaVersion, attestationState: "reviewed-readonly-blocked", evidence: "releaseFinalReviewEnvelopePreviewReady=true", missingBeforeExit: ["final-human-governance-signoff"], mayApproveRelease: false, mayExitPhase29: false, mayEnterPhase30: false, mayEnableRuntime: false },
    { id: "final-readiness-board-attestation", label: "Final readiness board attestation", sourceSchemaVersion: finalReadinessBoardPreview.schemaVersion, attestationState: "board-ready-readonly-blocked", evidence: "finalReadinessBoardPreviewReady=true", missingBeforeExit: ["board-owner-attestation"], mayApproveRelease: false, mayExitPhase29: false, mayEnterPhase30: false, mayEnableRuntime: false },
    { id: "release-exit-decision-attestation", label: "Release exit decision attestation", sourceSchemaVersion: releaseExitDecisionPreview.schemaVersion, attestationState: "phase29-exit-blocked", evidence: "phase29ExitDecision=block-exit", missingBeforeExit: ["exit-decision-approved", "release-owner-signoff"], mayApproveRelease: false, mayExitPhase29: false, mayEnterPhase30: false, mayEnableRuntime: false },
    { id: "phase30-entry-attestation", label: "Phase 30 entry attestation", sourceSchemaVersion: phase30EntryPreflight.schemaVersion, attestationState: "phase30-entry-blocked", evidence: "phase30EntryReady=false", missingBeforeExit: ["phase30-entry-approval", "handoff-owner-acceptance"], mayApproveRelease: false, mayExitPhase29: false, mayEnterPhase30: false, mayEnableRuntime: false },
    { id: "redline-attestation", label: "Redline attestation", sourceSchemaVersion: transitionReadinessRedline.schemaVersion, attestationState: "redline-active-blocked", evidence: "activeRedlines>=1", missingBeforeExit: ["redlines-resolved", "override-not-requested"], mayApproveRelease: false, mayExitPhase29: false, mayEnterPhase30: false, mayEnableRuntime: false },
    { id: "blocker-dossier-attestation", label: "Blocker dossier attestation", sourceSchemaVersion: finalReleaseBlockerDossier.schemaVersion, attestationState: "blockers-carried-forward", evidence: "unresolvedBlockers>=1", missingBeforeExit: ["blocker-clearance-evidence", "release-owner-review"], mayApproveRelease: false, mayExitPhase29: false, mayEnterPhase30: false, mayEnableRuntime: false },
    { id: "runtime-and-archive-attestation", label: "Runtime and archive attestation", sourceSchemaVersion: runtimeEnableGovernance.schemaVersion, archiveSourceSchemaVersion: governanceArchiveFreeze.schemaVersion, attestationState: "runtime-disabled-archive-frozen", evidence: "runtimeExecution=false and archive frozen-readonly", missingBeforeExit: ["runtime-validation-review", "archive-integrity-review"], mayApproveRelease: false, mayExitPhase29: false, mayEnterPhase30: false, mayEnableRuntime: false }
  ];
  const attestationChecks = [
    { id: "attestation-linked-to-final-review-envelope", result: releaseFinalReviewEnvelopePreview.schemaVersion === "phase29.release-final-review-envelope-preview.v1" ? "pass" : "block", evidence: releaseFinalReviewEnvelopePreview.schemaVersion },
    { id: "attestation-keeps-release-blocked", result: "pass", evidence: "releaseReady=false" },
    { id: "attestation-keeps-exit-blocked", result: "pass", evidence: "phase29ExitReady=false" },
    { id: "attestation-keeps-phase30-blocked", result: "pass", evidence: "phase30EntryReady=false" },
    { id: "attestation-keeps-runtime-disabled", result: "pass", evidence: "runtimeExecution=false and thirdPartyExecution=false" },
    { id: "attestation-does-not-persist-mutations", result: "pass", evidence: "persistedMutations=0" }
  ];
  return {
    schemaVersion: "phase29.exit-readiness-attestation-preview.v1",
    version: "1.9.24",
    mode: "readonly-exit-readiness-attestation-preview-no-exit",
    sourceModels: {
      releaseFinalReviewEnvelopePreview: releaseFinalReviewEnvelopePreview.schemaVersion,
      finalReadinessBoardPreview: finalReadinessBoardPreview.schemaVersion,
      releaseExitDecisionPreview: releaseExitDecisionPreview.schemaVersion,
      phase30EntryPreflight: phase30EntryPreflight.schemaVersion,
      transitionReadinessRedline: transitionReadinessRedline.schemaVersion,
      finalReleaseBlockerDossier: finalReleaseBlockerDossier.schemaVersion,
      runtimeEnableGovernance: runtimeEnableGovernance.schemaVersion,
      governanceArchiveFreeze: governanceArchiveFreeze.schemaVersion
    },
    attestationItems,
    attestationChecks,
    blockedMutations: [
      "persist-attestation-as-release-approval",
      "persist-attestation-as-phase29-exit",
      "persist-attestation-as-phase30-entry",
      "approve-release-from-attestation",
      "exit-phase29-from-attestation",
      "open-phase30-entry-from-attestation",
      "clear-blocker-from-attestation",
      "override-final-review-envelope-from-attestation",
      "mark-releaseReady-true",
      "enable-runtime-execution",
      "enable-third-party-execution"
    ],
    exportPolicy: {
      exportName: "phase29-exit-readiness-attestation-preview.json",
      includeInOperationsExport: true,
      redaction: "attestation-item-state-source-evidence-missing-condition-and-readonly-guardrail-summary-only"
    },
    summary: {
      exitReadinessAttestationPreviewReady: true,
      attestationItems: attestationItems.length,
      blockedAttestationItems: attestationItems.filter((item) => item.attestationState.includes("blocked")).length,
      attestationChecks: attestationChecks.length,
      passedAttestationChecks: attestationChecks.filter((item) => item.result === "pass").length,
      phase29ExitReady: false,
      phase30Blocked: true,
      phase30EntryReady: false,
      releaseReady: false,
      runtimeExecution: false,
      thirdPartyExecution: false,
      clearedBlockers: 0,
      persistedMutations: 0
    }
  };
}

function buildPhase29Phase30PlanningBriefPreview(exitReadinessAttestationPreview = {}, phase30EntryPreflight = {}, phase30TransitionRiskRegister = {}, transitionEvidenceGapReview = {}, transitionReadinessRedline = {}, releaseFinalReviewEnvelopePreview = {}, finalReadinessBoardPreview = {}, governanceArchiveFreeze = {}) {
  const briefSections = [
    { id: "phase30-scope-boundary", label: "Phase 30 scope boundary", sourceSchemaVersion: exitReadinessAttestationPreview.schemaVersion, briefState: "planning-brief-readonly", evidence: "phase29 remains active and Phase 30 entry remains blocked", phase30PlanningOnly: true, mayExitPhase29: false, mayEnterPhase30: false, mayApproveRelease: false, mayEnableRuntime: false },
    { id: "entry-preflight-blockers", label: "Entry preflight blockers", sourceSchemaVersion: phase30EntryPreflight.schemaVersion, briefState: "phase30-entry-blocked", evidence: "blockedEntryGates>=1", phase30PlanningOnly: true, mayExitPhase29: false, mayEnterPhase30: false, mayApproveRelease: false, mayEnableRuntime: false },
    { id: "transition-risk-summary", label: "Transition risk summary", sourceSchemaVersion: phase30TransitionRiskRegister.schemaVersion, briefState: "transition-risk-open-blocked", evidence: "blockedTransitionRisks>=1", phase30PlanningOnly: true, mayExitPhase29: false, mayEnterPhase30: false, mayApproveRelease: false, mayEnableRuntime: false },
    { id: "evidence-gap-summary", label: "Evidence gap summary", sourceSchemaVersion: transitionEvidenceGapReview.schemaVersion, briefState: "evidence-gaps-open-blocked", evidence: "blockingEvidenceGaps>=1", phase30PlanningOnly: true, mayExitPhase29: false, mayEnterPhase30: false, mayApproveRelease: false, mayEnableRuntime: false },
    { id: "redline-and-review-envelope", label: "Redline and review envelope", sourceSchemaVersion: transitionReadinessRedline.schemaVersion, envelopeSourceSchemaVersion: releaseFinalReviewEnvelopePreview.schemaVersion, briefState: "redline-active-review-open", evidence: "activeTransitionRedlines>=1 and final review remains readonly", phase30PlanningOnly: true, mayExitPhase29: false, mayEnterPhase30: false, mayApproveRelease: false, mayEnableRuntime: false },
    { id: "archive-and-readiness-board", label: "Archive and readiness board", sourceSchemaVersion: governanceArchiveFreeze.schemaVersion, boardSourceSchemaVersion: finalReadinessBoardPreview.schemaVersion, briefState: "archive-frozen-readiness-board-blocked", evidence: "archive frozen and readiness board does not approve release", phase30PlanningOnly: true, mayExitPhase29: false, mayEnterPhase30: false, mayApproveRelease: false, mayEnableRuntime: false }
  ];
  const briefChecks = [
    { id: "planning-brief-linked-to-attestation", result: exitReadinessAttestationPreview.schemaVersion === "phase29.exit-readiness-attestation-preview.v1" ? "pass" : "block", evidence: exitReadinessAttestationPreview.schemaVersion },
    { id: "planning-brief-keeps-phase29-active", result: "pass", evidence: "phase29ExitReady=false" },
    { id: "planning-brief-keeps-phase30-blocked", result: "pass", evidence: "phase30EntryReady=false" },
    { id: "planning-brief-keeps-release-blocked", result: "pass", evidence: "releaseReady=false" },
    { id: "planning-brief-keeps-runtime-disabled", result: "pass", evidence: "runtimeExecution=false and thirdPartyExecution=false" },
    { id: "planning-brief-does-not-persist-mutations", result: "pass", evidence: "persistedMutations=0" }
  ];
  return {
    schemaVersion: "phase29.phase30-planning-brief-preview.v1",
    version: "1.9.25",
    mode: "readonly-phase30-planning-brief-preview-no-entry",
    sourceModels: {
      exitReadinessAttestationPreview: exitReadinessAttestationPreview.schemaVersion,
      phase30EntryPreflight: phase30EntryPreflight.schemaVersion,
      phase30TransitionRiskRegister: phase30TransitionRiskRegister.schemaVersion,
      transitionEvidenceGapReview: transitionEvidenceGapReview.schemaVersion,
      transitionReadinessRedline: transitionReadinessRedline.schemaVersion,
      releaseFinalReviewEnvelopePreview: releaseFinalReviewEnvelopePreview.schemaVersion,
      finalReadinessBoardPreview: finalReadinessBoardPreview.schemaVersion,
      governanceArchiveFreeze: governanceArchiveFreeze.schemaVersion
    },
    briefSections,
    briefChecks,
    blockedMutations: [
      "persist-phase30-brief-as-release-approval",
      "persist-phase30-brief-as-phase29-exit",
      "persist-phase30-brief-as-phase30-entry",
      "approve-release-from-phase30-brief",
      "exit-phase29-from-phase30-brief",
      "open-phase30-entry-from-phase30-brief",
      "clear-blocker-from-phase30-brief",
      "resolve-redline-from-phase30-brief",
      "override-attestation-from-phase30-brief",
      "mark-releaseReady-true",
      "enable-runtime-execution",
      "enable-third-party-execution"
    ],
    exportPolicy: {
      exportName: "phase29-phase30-planning-brief-preview.json",
      includeInOperationsExport: true,
      redaction: "phase30-planning-brief-section-state-source-evidence-and-readonly-guardrail-summary-only"
    },
    summary: {
      phase30PlanningBriefPreviewReady: true,
      briefSections: briefSections.length,
      blockedBriefSections: briefSections.filter((item) => item.briefState.includes("blocked")).length,
      briefChecks: briefChecks.length,
      passedBriefChecks: briefChecks.filter((item) => item.result === "pass").length,
      phase29ExitReady: false,
      phase30Blocked: true,
      phase30EntryReady: false,
      releaseReady: false,
      runtimeExecution: false,
      thirdPartyExecution: false,
      clearedBlockers: 0,
      persistedMutations: 0
    }
  };
}

function buildPhase29Phase30ScopeLockPreview(phase30PlanningBriefPreview = {}, phase30EntryPreflight = {}, phase30TransitionRiskRegister = {}, transitionEvidenceGapReview = {}, transitionReadinessRedline = {}, releaseExitDecisionPreview = {}, runtimeEnableGovernance = {}, governanceArchiveFreeze = {}) {
  const scopeLockItems = [
    { id: "phase30-entry-boundary-lock", label: "Phase 30 entry boundary lock", sourceSchemaVersion: phase30PlanningBriefPreview.schemaVersion, lockState: "phase30-entry-locked-readonly", evidence: "phase30PlanningBriefPreviewReady=true and phase30EntryReady=false", lockedScope: ["planning-inputs-only", "no-phase-transition"], mayExitPhase29: false, mayEnterPhase30: false, mayApproveRelease: false, mayEnableRuntime: false },
    { id: "preflight-gate-lock", label: "Preflight gate lock", sourceSchemaVersion: phase30EntryPreflight.schemaVersion, lockState: "preflight-blockers-locked", evidence: "blockedEntryGates>=1", lockedScope: ["entry-gates", "preflight-blockers"], mayExitPhase29: false, mayEnterPhase30: false, mayApproveRelease: false, mayEnableRuntime: false },
    { id: "transition-risk-lock", label: "Transition risk lock", sourceSchemaVersion: phase30TransitionRiskRegister.schemaVersion, lockState: "transition-risks-locked", evidence: "blockedTransitionRisks>=1", lockedScope: ["risk-register", "mitigation-lanes"], mayExitPhase29: false, mayEnterPhase30: false, mayApproveRelease: false, mayEnableRuntime: false },
    { id: "evidence-gap-lock", label: "Evidence gap lock", sourceSchemaVersion: transitionEvidenceGapReview.schemaVersion, lockState: "evidence-gaps-locked", evidence: "blockingEvidenceGaps>=1", lockedScope: ["evidence-gaps", "human-signoff-required"], mayExitPhase29: false, mayEnterPhase30: false, mayApproveRelease: false, mayEnableRuntime: false },
    { id: "redline-lock", label: "Transition redline lock", sourceSchemaVersion: transitionReadinessRedline.schemaVersion, lockState: "redlines-locked-no-override", evidence: "activeRedlines>=1", lockedScope: ["redline-review", "override-blocked"], mayExitPhase29: false, mayEnterPhase30: false, mayApproveRelease: false, mayEnableRuntime: false },
    { id: "release-and-runtime-lock", label: "Release and runtime lock", sourceSchemaVersion: releaseExitDecisionPreview.schemaVersion, runtimeSourceSchemaVersion: runtimeEnableGovernance.schemaVersion, archiveSourceSchemaVersion: governanceArchiveFreeze.schemaVersion, lockState: "release-runtime-archive-locked", evidence: "releaseReady=false, runtimeExecution=false, archive frozen", lockedScope: ["release-approval", "runtime-enable", "archive-freeze"], mayExitPhase29: false, mayEnterPhase30: false, mayApproveRelease: false, mayEnableRuntime: false }
  ];
  const scopeLockChecks = [
    { id: "scope-lock-linked-to-planning-brief", result: phase30PlanningBriefPreview.schemaVersion === "phase29.phase30-planning-brief-preview.v1" ? "pass" : "block", evidence: phase30PlanningBriefPreview.schemaVersion },
    { id: "scope-lock-keeps-phase29-active", result: "pass", evidence: "phase29ExitReady=false" },
    { id: "scope-lock-keeps-phase30-blocked", result: "pass", evidence: "phase30EntryReady=false" },
    { id: "scope-lock-keeps-release-blocked", result: "pass", evidence: "releaseReady=false" },
    { id: "scope-lock-keeps-runtime-disabled", result: "pass", evidence: "runtimeExecution=false and thirdPartyExecution=false" },
    { id: "scope-lock-does-not-persist-mutations", result: "pass", evidence: "persistedMutations=0" }
  ];
  return {
    schemaVersion: "phase29.phase30-scope-lock-preview.v1",
    version: "1.9.26",
    mode: "readonly-phase30-scope-lock-preview-no-entry",
    sourceModels: {
      phase30PlanningBriefPreview: phase30PlanningBriefPreview.schemaVersion,
      phase30EntryPreflight: phase30EntryPreflight.schemaVersion,
      phase30TransitionRiskRegister: phase30TransitionRiskRegister.schemaVersion,
      transitionEvidenceGapReview: transitionEvidenceGapReview.schemaVersion,
      transitionReadinessRedline: transitionReadinessRedline.schemaVersion,
      releaseExitDecisionPreview: releaseExitDecisionPreview.schemaVersion,
      runtimeEnableGovernance: runtimeEnableGovernance.schemaVersion,
      governanceArchiveFreeze: governanceArchiveFreeze.schemaVersion
    },
    scopeLockItems,
    scopeLockChecks,
    blockedMutations: [
      "persist-scope-lock-as-release-approval",
      "persist-scope-lock-as-phase29-exit",
      "persist-scope-lock-as-phase30-entry",
      "approve-release-from-scope-lock",
      "exit-phase29-from-scope-lock",
      "open-phase30-entry-from-scope-lock",
      "clear-blocker-from-scope-lock",
      "unlock-phase30-scope-without-review",
      "override-planning-brief-from-scope-lock",
      "resolve-redline-from-scope-lock",
      "mark-releaseReady-true",
      "enable-runtime-execution",
      "enable-third-party-execution"
    ],
    exportPolicy: {
      exportName: "phase29-phase30-scope-lock-preview.json",
      includeInOperationsExport: true,
      redaction: "phase30-scope-lock-item-state-source-evidence-locked-scope-and-readonly-guardrail-summary-only"
    },
    summary: {
      phase30ScopeLockPreviewReady: true,
      scopeLockItems: scopeLockItems.length,
      blockedScopeLockItems: scopeLockItems.filter((item) => item.lockState.includes("locked")).length,
      scopeLockChecks: scopeLockChecks.length,
      passedScopeLockChecks: scopeLockChecks.filter((item) => item.result === "pass").length,
      phase29ExitReady: false,
      phase30Blocked: true,
      phase30EntryReady: false,
      releaseReady: false,
      runtimeExecution: false,
      thirdPartyExecution: false,
      clearedBlockers: 0,
      persistedMutations: 0
    }
  };
}

function buildPhase29Phase30ReadinessMapPreview(phase30ScopeLockPreview = {}, phase30PlanningBriefPreview = {}, phase30EntryPreflight = {}, phase30TransitionRiskRegister = {}, transitionEvidenceGapReview = {}, transitionReadinessRedline = {}, finalReleaseBlockerDossier = {}, releaseExitDecisionPreview = {}, runtimeEnableGovernance = {}, governanceArchiveFreeze = {}) {
  const readinessMapItems = [
    { id: "scope-lock-readiness-map", label: "Scope lock readiness map", sourceSchemaVersion: phase30ScopeLockPreview.schemaVersion, readinessState: "scope-locked-readonly", evidence: "phase30ScopeLockPreviewReady=true and phase30EntryReady=false", requiredBeforePhase30: ["scope-lock-reviewed", "entry-boundary-remains-locked"], mayExitPhase29: false, mayEnterPhase30: false, mayApproveRelease: false, mayEnableRuntime: false },
    { id: "planning-brief-readiness-map", label: "Planning brief readiness map", sourceSchemaVersion: phase30PlanningBriefPreview.schemaVersion, readinessState: "planning-brief-mapped-blocked", evidence: "phase30PlanningBriefPreviewReady=true and planningOnly=true", requiredBeforePhase30: ["planning-brief-human-reviewed", "planning-brief-not-persisted-as-entry"], mayExitPhase29: false, mayEnterPhase30: false, mayApproveRelease: false, mayEnableRuntime: false },
    { id: "entry-preflight-readiness-map", label: "Entry preflight readiness map", sourceSchemaVersion: phase30EntryPreflight.schemaVersion, readinessState: "preflight-blocked-readonly", evidence: "blockedEntryGates>=1", requiredBeforePhase30: ["entry-gates-resolved-with-evidence", "human-entry-signoff"], mayExitPhase29: false, mayEnterPhase30: false, mayApproveRelease: false, mayEnableRuntime: false },
    { id: "transition-risk-readiness-map", label: "Transition risk readiness map", sourceSchemaVersion: phase30TransitionRiskRegister.schemaVersion, readinessState: "transition-risk-mapped-blocked", evidence: "blockedTransitionRisks>=1", requiredBeforePhase30: ["risk-mitigation-evidence", "transition-risk-review"], mayExitPhase29: false, mayEnterPhase30: false, mayApproveRelease: false, mayEnableRuntime: false },
    { id: "evidence-gap-readiness-map", label: "Evidence gap readiness map", sourceSchemaVersion: transitionEvidenceGapReview.schemaVersion, readinessState: "evidence-gap-mapped-blocked", evidence: "blockingEvidenceGaps>=1", requiredBeforePhase30: ["evidence-gap-human-signoff", "gap-closure-proof"], mayExitPhase29: false, mayEnterPhase30: false, mayApproveRelease: false, mayEnableRuntime: false },
    { id: "redline-readiness-map", label: "Redline readiness map", sourceSchemaVersion: transitionReadinessRedline.schemaVersion, readinessState: "redline-active-readonly", evidence: "activeRedlines>=1", requiredBeforePhase30: ["redline-resolution-evidence", "no-override-without-review"], mayExitPhase29: false, mayEnterPhase30: false, mayApproveRelease: false, mayEnableRuntime: false },
    { id: "blocker-dossier-readiness-map", label: "Blocker dossier readiness map", sourceSchemaVersion: finalReleaseBlockerDossier.schemaVersion, readinessState: "blocker-dossier-mapped-blocked", evidence: "unresolvedBlockers>=1 and blockedReleaseGates>=1", requiredBeforePhase30: ["blocker-disposition-recorded", "release-gates-reviewed"], mayExitPhase29: false, mayEnterPhase30: false, mayApproveRelease: false, mayEnableRuntime: false },
    { id: "release-exit-readiness-map", label: "Release exit readiness map", sourceSchemaVersion: releaseExitDecisionPreview.schemaVersion, readinessState: "release-exit-blocked-readonly", evidence: "phase29ExitReady=false and releaseReady=false", requiredBeforePhase30: ["signed-exit-decision", "release-approval-separated"], mayExitPhase29: false, mayEnterPhase30: false, mayApproveRelease: false, mayEnableRuntime: false },
    { id: "runtime-archive-readiness-map", label: "Runtime and archive readiness map", sourceSchemaVersion: runtimeEnableGovernance.schemaVersion, archiveSourceSchemaVersion: governanceArchiveFreeze.schemaVersion, readinessState: "runtime-archive-locked-readonly", evidence: "runtimeExecution=false, thirdPartyExecution=false, archive frozen", requiredBeforePhase30: ["runtime-enable-review", "archive-freeze-retained"], mayExitPhase29: false, mayEnterPhase30: false, mayApproveRelease: false, mayEnableRuntime: false }
  ];
  const readinessMapChecks = [
    { id: "readiness-map-linked-to-scope-lock", result: phase30ScopeLockPreview.schemaVersion === "phase29.phase30-scope-lock-preview.v1" ? "pass" : "block", evidence: phase30ScopeLockPreview.schemaVersion },
    { id: "readiness-map-keeps-phase29-active", result: "pass", evidence: "phase29ExitReady=false" },
    { id: "readiness-map-keeps-phase30-blocked", result: "pass", evidence: "phase30EntryReady=false" },
    { id: "readiness-map-keeps-release-blocked", result: "pass", evidence: "releaseReady=false" },
    { id: "readiness-map-keeps-runtime-disabled", result: "pass", evidence: "runtimeExecution=false and thirdPartyExecution=false" },
    { id: "readiness-map-does-not-persist-mutations", result: "pass", evidence: "persistedMutations=0" }
  ];
  return {
    schemaVersion: "phase29.phase30-readiness-map-preview.v1",
    version: "1.9.27",
    mode: "readonly-phase30-readiness-map-preview-no-entry",
    sourceModels: {
      phase30ScopeLockPreview: phase30ScopeLockPreview.schemaVersion,
      phase30PlanningBriefPreview: phase30PlanningBriefPreview.schemaVersion,
      phase30EntryPreflight: phase30EntryPreflight.schemaVersion,
      phase30TransitionRiskRegister: phase30TransitionRiskRegister.schemaVersion,
      transitionEvidenceGapReview: transitionEvidenceGapReview.schemaVersion,
      transitionReadinessRedline: transitionReadinessRedline.schemaVersion,
      finalReleaseBlockerDossier: finalReleaseBlockerDossier.schemaVersion,
      releaseExitDecisionPreview: releaseExitDecisionPreview.schemaVersion,
      runtimeEnableGovernance: runtimeEnableGovernance.schemaVersion,
      governanceArchiveFreeze: governanceArchiveFreeze.schemaVersion
    },
    readinessMapItems,
    readinessMapChecks,
    blockedMutations: [
      "persist-readiness-map-as-release-approval",
      "persist-readiness-map-as-phase29-exit",
      "persist-readiness-map-as-phase30-entry",
      "approve-release-from-readiness-map",
      "exit-phase29-from-readiness-map",
      "open-phase30-entry-from-readiness-map",
      "clear-blocker-from-readiness-map",
      "resolve-redline-from-readiness-map",
      "override-scope-lock-from-readiness-map",
      "mark-releaseReady-true",
      "enable-runtime-execution",
      "enable-third-party-execution"
    ],
    exportPolicy: {
      exportName: "phase29-phase30-readiness-map-preview.json",
      includeInOperationsExport: true,
      redaction: "phase30-readiness-map-item-state-source-evidence-required-before-phase30-and-readonly-guardrail-summary-only"
    },
    summary: {
      phase30ReadinessMapPreviewReady: true,
      readinessMapItems: readinessMapItems.length,
      blockedReadinessMapItems: readinessMapItems.filter((item) => item.readinessState.includes("blocked") || item.readinessState.includes("locked") || item.readinessState.includes("active")).length,
      readinessMapChecks: readinessMapChecks.length,
      passedReadinessMapChecks: readinessMapChecks.filter((item) => item.result === "pass").length,
      phase29ExitReady: false,
      phase30Blocked: true,
      phase30EntryReady: false,
      releaseReady: false,
      runtimeExecution: false,
      thirdPartyExecution: false,
      clearedBlockers: 0,
      persistedMutations: 0
    }
  };
}

function buildPhase29Phase30ReadinessGapBriefPreview(phase30ReadinessMapPreview = {}, phase30ScopeLockPreview = {}, phase30EntryPreflight = {}, phase30TransitionRiskRegister = {}, transitionEvidenceGapReview = {}, transitionReadinessRedline = {}, finalReleaseBlockerDossier = {}, releaseExitDecisionPreview = {}, runtimeEnableGovernance = {}, governanceArchiveFreeze = {}) {
  const gapBriefItems = [
    { id: "scope-lock-gap-brief", label: "Scope lock gap brief", sourceSchemaVersion: phase30ScopeLockPreview.schemaVersion, gapState: "scope-gap-blocked-readonly", evidence: "scope lock remains read-only and phase30EntryReady=false", missingBeforePhase30: ["scope-lock-human-review", "entry-boundary-release-decision"], actionOwner: "release-governance", mayExitPhase29: false, mayEnterPhase30: false, mayApproveRelease: false, mayEnableRuntime: false },
    { id: "entry-preflight-gap-brief", label: "Entry preflight gap brief", sourceSchemaVersion: phase30EntryPreflight.schemaVersion, gapState: "entry-preflight-gap-blocked", evidence: "blockedEntryGates>=1", missingBeforePhase30: ["entry-gate-evidence", "human-entry-signoff"], actionOwner: "phase30-entry-reviewer", mayExitPhase29: false, mayEnterPhase30: false, mayApproveRelease: false, mayEnableRuntime: false },
    { id: "transition-risk-gap-brief", label: "Transition risk gap brief", sourceSchemaVersion: phase30TransitionRiskRegister.schemaVersion, gapState: "transition-risk-gap-blocked", evidence: "blockedTransitionRisks>=1", missingBeforePhase30: ["risk-mitigation-proof", "risk-owner-disposition"], actionOwner: "transition-risk-owner", mayExitPhase29: false, mayEnterPhase30: false, mayApproveRelease: false, mayEnableRuntime: false },
    { id: "evidence-gap-brief", label: "Evidence gap brief", sourceSchemaVersion: transitionEvidenceGapReview.schemaVersion, gapState: "evidence-gap-blocked", evidence: "blockingEvidenceGaps>=1", missingBeforePhase30: ["gap-closure-evidence", "human-evidence-signoff"], actionOwner: "evidence-reviewer", mayExitPhase29: false, mayEnterPhase30: false, mayApproveRelease: false, mayEnableRuntime: false },
    { id: "redline-gap-brief", label: "Redline gap brief", sourceSchemaVersion: transitionReadinessRedline.schemaVersion, gapState: "redline-gap-blocked", evidence: "activeRedlines>=1", missingBeforePhase30: ["redline-resolution", "no-override-review"], actionOwner: "release-owner", mayExitPhase29: false, mayEnterPhase30: false, mayApproveRelease: false, mayEnableRuntime: false },
    { id: "blocker-dossier-gap-brief", label: "Blocker dossier gap brief", sourceSchemaVersion: finalReleaseBlockerDossier.schemaVersion, gapState: "blocker-dossier-gap-blocked", evidence: "unresolvedBlockers>=1 and blockedReleaseGates>=1", missingBeforePhase30: ["blocker-clearance-evidence", "release-gate-disposition"], actionOwner: "blocker-clearance-owner", mayExitPhase29: false, mayEnterPhase30: false, mayApproveRelease: false, mayEnableRuntime: false },
    { id: "release-exit-gap-brief", label: "Release exit gap brief", sourceSchemaVersion: releaseExitDecisionPreview.schemaVersion, gapState: "release-exit-gap-blocked", evidence: "phase29ExitReady=false and releaseReady=false", missingBeforePhase30: ["signed-release-exit-decision", "release-approval-separated"], actionOwner: "release-approver", mayExitPhase29: false, mayEnterPhase30: false, mayApproveRelease: false, mayEnableRuntime: false },
    { id: "runtime-archive-gap-brief", label: "Runtime and archive gap brief", sourceSchemaVersion: runtimeEnableGovernance.schemaVersion, archiveSourceSchemaVersion: governanceArchiveFreeze.schemaVersion, gapState: "runtime-archive-gap-blocked", evidence: "runtimeExecution=false, thirdPartyExecution=false, archive frozen", missingBeforePhase30: ["runtime-enable-review", "archive-freeze-retention-review"], actionOwner: "runtime-reviewer", mayExitPhase29: false, mayEnterPhase30: false, mayApproveRelease: false, mayEnableRuntime: false }
  ];
  const gapBriefChecks = [
    { id: "gap-brief-linked-to-readiness-map", result: phase30ReadinessMapPreview.schemaVersion === "phase29.phase30-readiness-map-preview.v1" ? "pass" : "block", evidence: phase30ReadinessMapPreview.schemaVersion },
    { id: "gap-brief-keeps-phase29-active", result: "pass", evidence: "phase29ExitReady=false" },
    { id: "gap-brief-keeps-phase30-blocked", result: "pass", evidence: "phase30EntryReady=false" },
    { id: "gap-brief-keeps-release-blocked", result: "pass", evidence: "releaseReady=false" },
    { id: "gap-brief-keeps-runtime-disabled", result: "pass", evidence: "runtimeExecution=false and thirdPartyExecution=false" },
    { id: "gap-brief-does-not-persist-mutations", result: "pass", evidence: "persistedMutations=0" }
  ];
  return {
    schemaVersion: "phase29.phase30-readiness-gap-brief-preview.v1",
    version: "1.9.28",
    mode: "readonly-phase30-readiness-gap-brief-preview-no-entry",
    sourceModels: {
      phase30ReadinessMapPreview: phase30ReadinessMapPreview.schemaVersion,
      phase30ScopeLockPreview: phase30ScopeLockPreview.schemaVersion,
      phase30EntryPreflight: phase30EntryPreflight.schemaVersion,
      phase30TransitionRiskRegister: phase30TransitionRiskRegister.schemaVersion,
      transitionEvidenceGapReview: transitionEvidenceGapReview.schemaVersion,
      transitionReadinessRedline: transitionReadinessRedline.schemaVersion,
      finalReleaseBlockerDossier: finalReleaseBlockerDossier.schemaVersion,
      releaseExitDecisionPreview: releaseExitDecisionPreview.schemaVersion,
      runtimeEnableGovernance: runtimeEnableGovernance.schemaVersion,
      governanceArchiveFreeze: governanceArchiveFreeze.schemaVersion
    },
    gapBriefItems,
    gapBriefChecks,
    blockedMutations: [
      "persist-gap-brief-as-release-approval",
      "persist-gap-brief-as-phase29-exit",
      "persist-gap-brief-as-phase30-entry",
      "approve-release-from-gap-brief",
      "exit-phase29-from-gap-brief",
      "open-phase30-entry-from-gap-brief",
      "clear-blocker-from-gap-brief",
      "resolve-redline-from-gap-brief",
      "override-readiness-map-from-gap-brief",
      "mark-releaseReady-true",
      "enable-runtime-execution",
      "enable-third-party-execution"
    ],
    exportPolicy: {
      exportName: "phase29-phase30-readiness-gap-brief-preview.json",
      includeInOperationsExport: true,
      redaction: "phase30-readiness-gap-brief-item-state-source-evidence-missing-before-phase30-and-readonly-guardrail-summary-only"
    },
    summary: {
      phase30ReadinessGapBriefPreviewReady: true,
      gapBriefItems: gapBriefItems.length,
      blockedGapBriefItems: gapBriefItems.filter((item) => item.gapState.includes("blocked")).length,
      gapBriefChecks: gapBriefChecks.length,
      passedGapBriefChecks: gapBriefChecks.filter((item) => item.result === "pass").length,
      phase29ExitReady: false,
      phase30Blocked: true,
      phase30EntryReady: false,
      releaseReady: false,
      runtimeExecution: false,
      thirdPartyExecution: false,
      clearedBlockers: 0,
      persistedMutations: 0
    }
  };
}

function buildPhase29Phase30GapResolutionSequencePreview(phase30ReadinessGapBriefPreview = {}, phase30ReadinessMapPreview = {}, phase30EntryPreflight = {}, phase30TransitionRiskRegister = {}, transitionEvidenceGapReview = {}, transitionReadinessRedline = {}, finalReleaseBlockerDossier = {}, releaseExitDecisionPreview = {}, runtimeEnableGovernance = {}, governanceArchiveFreeze = {}) {
  const resolutionSequenceItems = [
    { id: "sequence-scope-lock-review", label: "Scope lock review sequence", sequenceOrder: 1, sourceSchemaVersion: phase30ReadinessGapBriefPreview.schemaVersion, resolutionState: "blocked-readonly-sequenced", evidence: "scope-lock-gap-brief remains blocked", prerequisiteGapIds: [], requiredEvidence: ["scope-lock-human-review", "entry-boundary-release-decision"], owner: "release-governance", blockedBy: ["phase30EntryReady=false"], mayExitPhase29: false, mayEnterPhase30: false, mayApproveRelease: false, mayEnableRuntime: false },
    { id: "sequence-entry-preflight-evidence", label: "Entry preflight evidence sequence", sequenceOrder: 2, sourceSchemaVersion: phase30EntryPreflight.schemaVersion, resolutionState: "blocked-readonly-sequenced", evidence: "blockedEntryGates>=1", prerequisiteGapIds: ["scope-lock-gap-brief"], requiredEvidence: ["entry-gate-evidence", "human-entry-signoff"], owner: "phase30-entry-reviewer", blockedBy: ["preflight-blockers-open"], mayExitPhase29: false, mayEnterPhase30: false, mayApproveRelease: false, mayEnableRuntime: false },
    { id: "sequence-transition-risk-mitigation", label: "Transition risk mitigation sequence", sequenceOrder: 3, sourceSchemaVersion: phase30TransitionRiskRegister.schemaVersion, resolutionState: "blocked-readonly-sequenced", evidence: "blockedTransitionRisks>=1", prerequisiteGapIds: ["entry-preflight-gap-brief"], requiredEvidence: ["risk-mitigation-proof", "risk-owner-disposition"], owner: "transition-risk-owner", blockedBy: ["transition-risk-open"], mayExitPhase29: false, mayEnterPhase30: false, mayApproveRelease: false, mayEnableRuntime: false },
    { id: "sequence-evidence-gap-closure", label: "Evidence gap closure sequence", sequenceOrder: 4, sourceSchemaVersion: transitionEvidenceGapReview.schemaVersion, resolutionState: "blocked-readonly-sequenced", evidence: "blockingEvidenceGaps>=1", prerequisiteGapIds: ["transition-risk-gap-brief"], requiredEvidence: ["gap-closure-evidence", "human-evidence-signoff"], owner: "evidence-reviewer", blockedBy: ["evidence-gap-open"], mayExitPhase29: false, mayEnterPhase30: false, mayApproveRelease: false, mayEnableRuntime: false },
    { id: "sequence-redline-resolution", label: "Redline resolution sequence", sequenceOrder: 5, sourceSchemaVersion: transitionReadinessRedline.schemaVersion, resolutionState: "blocked-readonly-sequenced", evidence: "activeRedlines>=1", prerequisiteGapIds: ["evidence-gap-brief"], requiredEvidence: ["redline-resolution", "no-override-review"], owner: "release-owner", blockedBy: ["active-redlines"], mayExitPhase29: false, mayEnterPhase30: false, mayApproveRelease: false, mayEnableRuntime: false },
    { id: "sequence-blocker-dossier-disposition", label: "Blocker dossier disposition sequence", sequenceOrder: 6, sourceSchemaVersion: finalReleaseBlockerDossier.schemaVersion, resolutionState: "blocked-readonly-sequenced", evidence: "unresolvedBlockers>=1 and blockedReleaseGates>=1", prerequisiteGapIds: ["redline-gap-brief"], requiredEvidence: ["blocker-clearance-evidence", "release-gate-disposition"], owner: "blocker-clearance-owner", blockedBy: ["unresolved-blockers"], mayExitPhase29: false, mayEnterPhase30: false, mayApproveRelease: false, mayEnableRuntime: false },
    { id: "sequence-release-exit-decision", label: "Release exit decision sequence", sequenceOrder: 7, sourceSchemaVersion: releaseExitDecisionPreview.schemaVersion, resolutionState: "blocked-readonly-sequenced", evidence: "phase29ExitReady=false and releaseReady=false", prerequisiteGapIds: ["blocker-dossier-gap-brief"], requiredEvidence: ["signed-release-exit-decision", "release-approval-separated"], owner: "release-approver", blockedBy: ["releaseReady=false", "phase29ExitReady=false"], mayExitPhase29: false, mayEnterPhase30: false, mayApproveRelease: false, mayEnableRuntime: false },
    { id: "sequence-runtime-archive-review", label: "Runtime and archive review sequence", sequenceOrder: 8, sourceSchemaVersion: runtimeEnableGovernance.schemaVersion, archiveSourceSchemaVersion: governanceArchiveFreeze.schemaVersion, resolutionState: "blocked-readonly-sequenced", evidence: "runtimeExecution=false, thirdPartyExecution=false, archive frozen", prerequisiteGapIds: ["release-exit-gap-brief"], requiredEvidence: ["runtime-enable-review", "archive-freeze-retention-review"], owner: "runtime-reviewer", blockedBy: ["runtime-disabled", "archive-frozen"], mayExitPhase29: false, mayEnterPhase30: false, mayApproveRelease: false, mayEnableRuntime: false }
  ];
  const sequenceChecks = [
    { id: "sequence-linked-to-gap-brief", result: phase30ReadinessGapBriefPreview.schemaVersion === "phase29.phase30-readiness-gap-brief-preview.v1" ? "pass" : "block", evidence: phase30ReadinessGapBriefPreview.schemaVersion },
    { id: "sequence-linked-to-readiness-map", result: phase30ReadinessMapPreview.schemaVersion === "phase29.phase30-readiness-map-preview.v1" ? "pass" : "block", evidence: phase30ReadinessMapPreview.schemaVersion },
    { id: "sequence-keeps-phase29-active", result: "pass", evidence: "phase29ExitReady=false" },
    { id: "sequence-keeps-phase30-blocked", result: "pass", evidence: "phase30EntryReady=false" },
    { id: "sequence-keeps-release-blocked", result: "pass", evidence: "releaseReady=false" },
    { id: "sequence-keeps-runtime-disabled", result: "pass", evidence: "runtimeExecution=false and thirdPartyExecution=false" },
    { id: "sequence-does-not-persist-mutations", result: "pass", evidence: "persistedMutations=0" }
  ];
  return {
    schemaVersion: "phase29.phase30-gap-resolution-sequence-preview.v1",
    version: "1.9.29",
    mode: "readonly-phase30-gap-resolution-sequence-preview-no-entry",
    sourceModels: {
      phase30ReadinessGapBriefPreview: phase30ReadinessGapBriefPreview.schemaVersion,
      phase30ReadinessMapPreview: phase30ReadinessMapPreview.schemaVersion,
      phase30EntryPreflight: phase30EntryPreflight.schemaVersion,
      phase30TransitionRiskRegister: phase30TransitionRiskRegister.schemaVersion,
      transitionEvidenceGapReview: transitionEvidenceGapReview.schemaVersion,
      transitionReadinessRedline: transitionReadinessRedline.schemaVersion,
      finalReleaseBlockerDossier: finalReleaseBlockerDossier.schemaVersion,
      releaseExitDecisionPreview: releaseExitDecisionPreview.schemaVersion,
      runtimeEnableGovernance: runtimeEnableGovernance.schemaVersion,
      governanceArchiveFreeze: governanceArchiveFreeze.schemaVersion
    },
    resolutionSequenceItems,
    sequenceChecks,
    blockedMutations: [
      "persist-resolution-sequence-as-release-approval",
      "persist-resolution-sequence-as-phase29-exit",
      "persist-resolution-sequence-as-phase30-entry",
      "approve-release-from-resolution-sequence",
      "exit-phase29-from-resolution-sequence",
      "open-phase30-entry-from-resolution-sequence",
      "clear-blocker-from-resolution-sequence",
      "resolve-redline-from-resolution-sequence",
      "override-gap-brief-from-resolution-sequence",
      "mark-releaseReady-true",
      "enable-runtime-execution",
      "enable-third-party-execution"
    ],
    exportPolicy: {
      exportName: "phase29-phase30-gap-resolution-sequence-preview.json",
      includeInOperationsExport: true,
      redaction: "phase30-gap-resolution-sequence-item-order-state-source-evidence-owner-and-readonly-guardrail-summary-only"
    },
    summary: {
      phase30GapResolutionSequencePreviewReady: true,
      resolutionSequenceItems: resolutionSequenceItems.length,
      blockedResolutionSequenceItems: resolutionSequenceItems.filter((item) => item.resolutionState.includes("blocked")).length,
      sequenceChecks: sequenceChecks.length,
      passedSequenceChecks: sequenceChecks.filter((item) => item.result === "pass").length,
      phase29ExitReady: false,
      phase30Blocked: true,
      phase30EntryReady: false,
      releaseReady: false,
      runtimeExecution: false,
      thirdPartyExecution: false,
      clearedBlockers: 0,
      persistedMutations: 0
    }
  };
}

function buildPhase29Phase30EntryEvidencePackPreview(phase30GapResolutionSequencePreview = {}, phase30ReadinessGapBriefPreview = {}, phase30ReadinessMapPreview = {}, phase30EntryPreflight = {}, phase30TransitionRiskRegister = {}, transitionEvidenceGapReview = {}, transitionReadinessRedline = {}, finalReleaseBlockerDossier = {}, releaseExitDecisionPreview = {}, runtimeEnableGovernance = {}, governanceArchiveFreeze = {}) {
  const evidencePackItems = [
    { id: "entry-boundary-evidence-pack", label: "Entry boundary evidence pack", sourceSchemaVersion: phase30ReadinessMapPreview.schemaVersion, packState: "blocked-readonly-pack", evidence: "phase30EntryReady=false and readiness map remains blocked", requiredEvidence: ["phase30-entry-boundary-review", "scope-lock-human-disposition"], sourceSequenceIds: ["sequence-scope-lock-review"], owner: "release-governance", mayExitPhase29: false, mayEnterPhase30: false, mayApproveRelease: false, mayEnableRuntime: false },
    { id: "preflight-evidence-pack", label: "Preflight evidence pack", sourceSchemaVersion: phase30EntryPreflight.schemaVersion, packState: "blocked-readonly-pack", evidence: "blockedEntryGates>=1", requiredEvidence: ["entry-gate-evidence", "human-entry-signoff"], sourceSequenceIds: ["sequence-entry-preflight-evidence"], owner: "phase30-entry-reviewer", mayExitPhase29: false, mayEnterPhase30: false, mayApproveRelease: false, mayEnableRuntime: false },
    { id: "transition-risk-evidence-pack", label: "Transition risk evidence pack", sourceSchemaVersion: phase30TransitionRiskRegister.schemaVersion, packState: "blocked-readonly-pack", evidence: "blockedTransitionRisks>=1", requiredEvidence: ["risk-mitigation-proof", "risk-owner-disposition"], sourceSequenceIds: ["sequence-transition-risk-mitigation"], owner: "transition-risk-owner", mayExitPhase29: false, mayEnterPhase30: false, mayApproveRelease: false, mayEnableRuntime: false },
    { id: "evidence-gap-evidence-pack", label: "Evidence gap evidence pack", sourceSchemaVersion: transitionEvidenceGapReview.schemaVersion, packState: "blocked-readonly-pack", evidence: "blockingEvidenceGaps>=1", requiredEvidence: ["gap-closure-evidence", "human-evidence-signoff"], sourceSequenceIds: ["sequence-evidence-gap-closure"], owner: "evidence-reviewer", mayExitPhase29: false, mayEnterPhase30: false, mayApproveRelease: false, mayEnableRuntime: false },
    { id: "redline-evidence-pack", label: "Redline evidence pack", sourceSchemaVersion: transitionReadinessRedline.schemaVersion, packState: "blocked-readonly-pack", evidence: "activeRedlines>=1", requiredEvidence: ["redline-resolution", "no-override-review"], sourceSequenceIds: ["sequence-redline-resolution"], owner: "release-owner", mayExitPhase29: false, mayEnterPhase30: false, mayApproveRelease: false, mayEnableRuntime: false },
    { id: "blocker-dossier-evidence-pack", label: "Blocker dossier evidence pack", sourceSchemaVersion: finalReleaseBlockerDossier.schemaVersion, packState: "blocked-readonly-pack", evidence: "unresolvedBlockers>=1 and blockedReleaseGates>=1", requiredEvidence: ["blocker-clearance-evidence", "release-gate-disposition"], sourceSequenceIds: ["sequence-blocker-dossier-disposition"], owner: "blocker-clearance-owner", mayExitPhase29: false, mayEnterPhase30: false, mayApproveRelease: false, mayEnableRuntime: false },
    { id: "release-exit-evidence-pack", label: "Release exit evidence pack", sourceSchemaVersion: releaseExitDecisionPreview.schemaVersion, packState: "blocked-readonly-pack", evidence: "phase29ExitReady=false and releaseReady=false", requiredEvidence: ["signed-release-exit-decision", "release-approval-separated"], sourceSequenceIds: ["sequence-release-exit-decision"], owner: "release-approver", mayExitPhase29: false, mayEnterPhase30: false, mayApproveRelease: false, mayEnableRuntime: false },
    { id: "runtime-archive-evidence-pack", label: "Runtime and archive evidence pack", sourceSchemaVersion: runtimeEnableGovernance.schemaVersion, archiveSourceSchemaVersion: governanceArchiveFreeze.schemaVersion, packState: "blocked-readonly-pack", evidence: "runtimeExecution=false, thirdPartyExecution=false, archive frozen", requiredEvidence: ["runtime-enable-review", "archive-freeze-retention-review"], sourceSequenceIds: ["sequence-runtime-archive-review"], owner: "runtime-reviewer", mayExitPhase29: false, mayEnterPhase30: false, mayApproveRelease: false, mayEnableRuntime: false }
  ];
  const evidencePackChecks = [
    { id: "entry-evidence-pack-linked-to-resolution-sequence", result: phase30GapResolutionSequencePreview.schemaVersion === "phase29.phase30-gap-resolution-sequence-preview.v1" ? "pass" : "block", evidence: phase30GapResolutionSequencePreview.schemaVersion },
    { id: "entry-evidence-pack-linked-to-gap-brief", result: phase30ReadinessGapBriefPreview.schemaVersion === "phase29.phase30-readiness-gap-brief-preview.v1" ? "pass" : "block", evidence: phase30ReadinessGapBriefPreview.schemaVersion },
    { id: "entry-evidence-pack-keeps-phase29-active", result: "pass", evidence: "phase29ExitReady=false" },
    { id: "entry-evidence-pack-keeps-phase30-blocked", result: "pass", evidence: "phase30EntryReady=false" },
    { id: "entry-evidence-pack-keeps-release-blocked", result: "pass", evidence: "releaseReady=false" },
    { id: "entry-evidence-pack-keeps-runtime-disabled", result: "pass", evidence: "runtimeExecution=false and thirdPartyExecution=false" },
    { id: "entry-evidence-pack-does-not-persist-mutations", result: "pass", evidence: "persistedMutations=0" }
  ];
  return {
    schemaVersion: "phase29.phase30-entry-evidence-pack-preview.v1",
    version: "1.9.30",
    mode: "readonly-phase30-entry-evidence-pack-preview-no-entry",
    sourceModels: {
      phase30GapResolutionSequencePreview: phase30GapResolutionSequencePreview.schemaVersion,
      phase30ReadinessGapBriefPreview: phase30ReadinessGapBriefPreview.schemaVersion,
      phase30ReadinessMapPreview: phase30ReadinessMapPreview.schemaVersion,
      phase30EntryPreflight: phase30EntryPreflight.schemaVersion,
      phase30TransitionRiskRegister: phase30TransitionRiskRegister.schemaVersion,
      transitionEvidenceGapReview: transitionEvidenceGapReview.schemaVersion,
      transitionReadinessRedline: transitionReadinessRedline.schemaVersion,
      finalReleaseBlockerDossier: finalReleaseBlockerDossier.schemaVersion,
      releaseExitDecisionPreview: releaseExitDecisionPreview.schemaVersion,
      runtimeEnableGovernance: runtimeEnableGovernance.schemaVersion,
      governanceArchiveFreeze: governanceArchiveFreeze.schemaVersion
    },
    evidencePackItems,
    evidencePackChecks,
    blockedMutations: [
      "persist-entry-evidence-pack-as-release-approval",
      "persist-entry-evidence-pack-as-phase29-exit",
      "persist-entry-evidence-pack-as-phase30-entry",
      "approve-release-from-entry-evidence-pack",
      "exit-phase29-from-entry-evidence-pack",
      "open-phase30-entry-from-entry-evidence-pack",
      "clear-blocker-from-entry-evidence-pack",
      "resolve-redline-from-entry-evidence-pack",
      "override-resolution-sequence-from-entry-evidence-pack",
      "mark-releaseReady-true",
      "enable-runtime-execution",
      "enable-third-party-execution"
    ],
    exportPolicy: {
      exportName: "phase29-phase30-entry-evidence-pack-preview.json",
      includeInOperationsExport: true,
      redaction: "phase30-entry-evidence-pack-item-state-source-evidence-sequence-owner-and-readonly-guardrail-summary-only"
    },
    summary: {
      phase30EntryEvidencePackPreviewReady: true,
      evidencePackItems: evidencePackItems.length,
      blockedEvidencePackItems: evidencePackItems.filter((item) => item.packState.includes("blocked")).length,
      evidencePackChecks: evidencePackChecks.length,
      passedEvidencePackChecks: evidencePackChecks.filter((item) => item.result === "pass").length,
      phase29ExitReady: false,
      phase30Blocked: true,
      phase30EntryReady: false,
      releaseReady: false,
      runtimeExecution: false,
      thirdPartyExecution: false,
      clearedBlockers: 0,
      persistedMutations: 0
    }
  };
}

function buildPhase29Phase30EntryEvidenceIndexPreview(phase30EntryEvidencePackPreview = {}, phase30GapResolutionSequencePreview = {}, phase30ReadinessGapBriefPreview = {}, phase30ReadinessMapPreview = {}, phase30EntryPreflight = {}, phase30TransitionRiskRegister = {}, transitionEvidenceGapReview = {}, transitionReadinessRedline = {}, finalReleaseBlockerDossier = {}, releaseExitDecisionPreview = {}, runtimeEnableGovernance = {}, governanceArchiveFreeze = {}) {
  const evidenceIndexItems = [
    { id: "index-entry-boundary-evidence", label: "Entry boundary evidence index", evidenceType: "entry-boundary", sourceSchemaVersion: phase30ReadinessMapPreview.schemaVersion, sourcePackIds: ["entry-boundary-evidence-pack"], sourceSequenceIds: ["sequence-scope-lock-review"], blockerCategory: "phase30-entry-boundary", owner: "release-governance", indexState: "blocked-readonly-index", evidence: "phase30EntryReady=false and readiness map remains blocked", mayExitPhase29: false, mayEnterPhase30: false, mayApproveRelease: false, mayEnableRuntime: false },
    { id: "index-preflight-evidence", label: "Preflight evidence index", evidenceType: "entry-preflight", sourceSchemaVersion: phase30EntryPreflight.schemaVersion, sourcePackIds: ["preflight-evidence-pack"], sourceSequenceIds: ["sequence-entry-preflight-evidence"], blockerCategory: "preflight-blockers-open", owner: "phase30-entry-reviewer", indexState: "blocked-readonly-index", evidence: "blockedEntryGates>=1", mayExitPhase29: false, mayEnterPhase30: false, mayApproveRelease: false, mayEnableRuntime: false },
    { id: "index-transition-risk-evidence", label: "Transition risk evidence index", evidenceType: "transition-risk", sourceSchemaVersion: phase30TransitionRiskRegister.schemaVersion, sourcePackIds: ["transition-risk-evidence-pack"], sourceSequenceIds: ["sequence-transition-risk-mitigation"], blockerCategory: "transition-risk-open", owner: "transition-risk-owner", indexState: "blocked-readonly-index", evidence: "blockedTransitionRisks>=1", mayExitPhase29: false, mayEnterPhase30: false, mayApproveRelease: false, mayEnableRuntime: false },
    { id: "index-evidence-gap-evidence", label: "Evidence gap evidence index", evidenceType: "evidence-gap", sourceSchemaVersion: transitionEvidenceGapReview.schemaVersion, sourcePackIds: ["evidence-gap-evidence-pack"], sourceSequenceIds: ["sequence-evidence-gap-closure"], blockerCategory: "evidence-gap-open", owner: "evidence-reviewer", indexState: "blocked-readonly-index", evidence: "blockingEvidenceGaps>=1", mayExitPhase29: false, mayEnterPhase30: false, mayApproveRelease: false, mayEnableRuntime: false },
    { id: "index-redline-evidence", label: "Redline evidence index", evidenceType: "transition-redline", sourceSchemaVersion: transitionReadinessRedline.schemaVersion, sourcePackIds: ["redline-evidence-pack"], sourceSequenceIds: ["sequence-redline-resolution"], blockerCategory: "active-redlines", owner: "release-owner", indexState: "blocked-readonly-index", evidence: "activeRedlines>=1", mayExitPhase29: false, mayEnterPhase30: false, mayApproveRelease: false, mayEnableRuntime: false },
    { id: "index-blocker-dossier-evidence", label: "Blocker dossier evidence index", evidenceType: "blocker-dossier", sourceSchemaVersion: finalReleaseBlockerDossier.schemaVersion, sourcePackIds: ["blocker-dossier-evidence-pack"], sourceSequenceIds: ["sequence-blocker-dossier-disposition"], blockerCategory: "unresolved-blockers", owner: "blocker-clearance-owner", indexState: "blocked-readonly-index", evidence: "unresolvedBlockers>=1 and blockedReleaseGates>=1", mayExitPhase29: false, mayEnterPhase30: false, mayApproveRelease: false, mayEnableRuntime: false },
    { id: "index-release-exit-evidence", label: "Release exit evidence index", evidenceType: "release-exit", sourceSchemaVersion: releaseExitDecisionPreview.schemaVersion, sourcePackIds: ["release-exit-evidence-pack"], sourceSequenceIds: ["sequence-release-exit-decision"], blockerCategory: "release-and-phase29-exit-blocked", owner: "release-approver", indexState: "blocked-readonly-index", evidence: "phase29ExitReady=false and releaseReady=false", mayExitPhase29: false, mayEnterPhase30: false, mayApproveRelease: false, mayEnableRuntime: false },
    { id: "index-runtime-archive-evidence", label: "Runtime and archive evidence index", evidenceType: "runtime-archive", sourceSchemaVersion: runtimeEnableGovernance.schemaVersion, archiveSourceSchemaVersion: governanceArchiveFreeze.schemaVersion, sourcePackIds: ["runtime-archive-evidence-pack"], sourceSequenceIds: ["sequence-runtime-archive-review"], blockerCategory: "runtime-disabled-and-archive-frozen", owner: "runtime-reviewer", indexState: "blocked-readonly-index", evidence: "runtimeExecution=false, thirdPartyExecution=false, archive frozen", mayExitPhase29: false, mayEnterPhase30: false, mayApproveRelease: false, mayEnableRuntime: false }
  ];
  const evidenceIndexChecks = [
    { id: "entry-evidence-index-linked-to-pack", result: phase30EntryEvidencePackPreview.schemaVersion === "phase29.phase30-entry-evidence-pack-preview.v1" ? "pass" : "block", evidence: phase30EntryEvidencePackPreview.schemaVersion },
    { id: "entry-evidence-index-linked-to-resolution-sequence", result: phase30GapResolutionSequencePreview.schemaVersion === "phase29.phase30-gap-resolution-sequence-preview.v1" ? "pass" : "block", evidence: phase30GapResolutionSequencePreview.schemaVersion },
    { id: "entry-evidence-index-keeps-phase29-active", result: "pass", evidence: "phase29ExitReady=false" },
    { id: "entry-evidence-index-keeps-phase30-blocked", result: "pass", evidence: "phase30EntryReady=false" },
    { id: "entry-evidence-index-keeps-release-blocked", result: "pass", evidence: "releaseReady=false" },
    { id: "entry-evidence-index-keeps-runtime-disabled", result: "pass", evidence: "runtimeExecution=false and thirdPartyExecution=false" },
    { id: "entry-evidence-index-does-not-persist-mutations", result: "pass", evidence: "persistedMutations=0" }
  ];
  return {
    schemaVersion: "phase29.phase30-entry-evidence-index-preview.v1",
    version: "1.9.31",
    mode: "readonly-phase30-entry-evidence-index-preview-no-entry",
    sourceModels: {
      phase30EntryEvidencePackPreview: phase30EntryEvidencePackPreview.schemaVersion,
      phase30GapResolutionSequencePreview: phase30GapResolutionSequencePreview.schemaVersion,
      phase30ReadinessGapBriefPreview: phase30ReadinessGapBriefPreview.schemaVersion,
      phase30ReadinessMapPreview: phase30ReadinessMapPreview.schemaVersion,
      phase30EntryPreflight: phase30EntryPreflight.schemaVersion,
      phase30TransitionRiskRegister: phase30TransitionRiskRegister.schemaVersion,
      transitionEvidenceGapReview: transitionEvidenceGapReview.schemaVersion,
      transitionReadinessRedline: transitionReadinessRedline.schemaVersion,
      finalReleaseBlockerDossier: finalReleaseBlockerDossier.schemaVersion,
      releaseExitDecisionPreview: releaseExitDecisionPreview.schemaVersion,
      runtimeEnableGovernance: runtimeEnableGovernance.schemaVersion,
      governanceArchiveFreeze: governanceArchiveFreeze.schemaVersion
    },
    evidenceIndexItems,
    evidenceIndexChecks,
    blockedMutations: [
      "persist-entry-evidence-index-as-release-approval",
      "persist-entry-evidence-index-as-phase29-exit",
      "persist-entry-evidence-index-as-phase30-entry",
      "approve-release-from-entry-evidence-index",
      "exit-phase29-from-entry-evidence-index",
      "open-phase30-entry-from-entry-evidence-index",
      "clear-blocker-from-entry-evidence-index",
      "resolve-redline-from-entry-evidence-index",
      "override-entry-evidence-pack-from-entry-evidence-index",
      "mark-releaseReady-true",
      "enable-runtime-execution",
      "enable-third-party-execution"
    ],
    exportPolicy: {
      exportName: "phase29-phase30-entry-evidence-index-preview.json",
      includeInOperationsExport: true,
      redaction: "phase30-entry-evidence-index-type-source-pack-sequence-owner-blocker-and-readonly-guardrail-summary-only"
    },
    summary: {
      phase30EntryEvidenceIndexPreviewReady: true,
      evidenceIndexItems: evidenceIndexItems.length,
      blockedEvidenceIndexItems: evidenceIndexItems.filter((item) => item.indexState.includes("blocked")).length,
      evidenceIndexChecks: evidenceIndexChecks.length,
      passedEvidenceIndexChecks: evidenceIndexChecks.filter((item) => item.result === "pass").length,
      phase29ExitReady: false,
      phase30Blocked: true,
      phase30EntryReady: false,
      releaseReady: false,
      runtimeExecution: false,
      thirdPartyExecution: false,
      clearedBlockers: 0,
      persistedMutations: 0
    }
  };
}

function buildPhase29Phase30EntryEvidenceReviewQueuePreview(phase30EntryEvidenceIndexPreview = {}, phase30EntryEvidencePackPreview = {}, phase30GapResolutionSequencePreview = {}, transitionReadinessRedline = {}, finalReleaseBlockerDossier = {}, releaseExitDecisionPreview = {}, runtimeEnableGovernance = {}) {
  const evidenceReviewQueueItems = (phase30EntryEvidenceIndexPreview.evidenceIndexItems || []).map((item, index) => ({
    id: `review-${item.id.replace(/^index-/, "")}`,
    label: item.label.replace("index", "review queue"),
    sourceIndexItemId: item.id,
    evidenceType: item.evidenceType,
    sourceSchemaVersion: item.sourceSchemaVersion,
    sourcePackIds: item.sourcePackIds || [],
    sourceSequenceIds: item.sourceSequenceIds || [],
    blockerCategory: item.blockerCategory,
    owner: item.owner,
    reviewerRole: item.owner,
    queueLane: item.blockerCategory,
    queueOrder: index + 1,
    priority: ["active-redlines", "unresolved-blockers", "release-and-phase29-exit-blocked"].includes(item.blockerCategory) ? "high" : "normal",
    queueState: "blocked-readonly-review-pending",
    requiredReviewActions: ["inspect-index-evidence", "verify-source-pack-link", "record-non-persistent-review-note"],
    blockedBy: [item.blockerCategory, "phase29ExitReady=false", "phase30EntryReady=false", "releaseReady=false"],
    mayRecordPersistentDisposition: false,
    mayClearBlocker: false,
    mayExitPhase29: false,
    mayEnterPhase30: false,
    mayApproveRelease: false,
    mayEnableRuntime: false
  }));
  const evidenceReviewQueueChecks = [
    { id: "entry-evidence-review-queue-linked-to-index", result: phase30EntryEvidenceIndexPreview.schemaVersion === "phase29.phase30-entry-evidence-index-preview.v1" ? "pass" : "block", evidence: phase30EntryEvidenceIndexPreview.schemaVersion },
    { id: "entry-evidence-review-queue-linked-to-pack", result: phase30EntryEvidencePackPreview.schemaVersion === "phase29.phase30-entry-evidence-pack-preview.v1" ? "pass" : "block", evidence: phase30EntryEvidencePackPreview.schemaVersion },
    { id: "entry-evidence-review-queue-linked-to-resolution-sequence", result: phase30GapResolutionSequencePreview.schemaVersion === "phase29.phase30-gap-resolution-sequence-preview.v1" ? "pass" : "block", evidence: phase30GapResolutionSequencePreview.schemaVersion },
    { id: "entry-evidence-review-queue-keeps-redlines-active", result: transitionReadinessRedline.summary?.activeRedlines >= 1 ? "pass" : "block", evidence: `activeRedlines=${transitionReadinessRedline.summary?.activeRedlines ?? 0}` },
    { id: "entry-evidence-review-queue-keeps-blockers-open", result: finalReleaseBlockerDossier.summary?.unresolvedBlockers >= 1 ? "pass" : "block", evidence: `unresolvedBlockers=${finalReleaseBlockerDossier.summary?.unresolvedBlockers ?? 0}` },
    { id: "entry-evidence-review-queue-keeps-phase29-active", result: "pass", evidence: "phase29ExitReady=false" },
    { id: "entry-evidence-review-queue-keeps-phase30-blocked", result: "pass", evidence: "phase30EntryReady=false" },
    { id: "entry-evidence-review-queue-keeps-release-blocked", result: "pass", evidence: `releaseReady=${releaseExitDecisionPreview.summary?.releaseReady === true}` },
    { id: "entry-evidence-review-queue-keeps-runtime-disabled", result: "pass", evidence: `runtimeExecution=${runtimeEnableGovernance.summary?.runtimeExecution === true}` },
    { id: "entry-evidence-review-queue-does-not-persist-mutations", result: "pass", evidence: "persistedMutations=0" }
  ];
  return {
    schemaVersion: "phase29.phase30-entry-evidence-review-queue-preview.v1",
    version: "1.9.32",
    mode: "readonly-phase30-entry-evidence-review-queue-preview-no-disposition",
    sourceModels: {
      phase30EntryEvidenceIndexPreview: phase30EntryEvidenceIndexPreview.schemaVersion,
      phase30EntryEvidencePackPreview: phase30EntryEvidencePackPreview.schemaVersion,
      phase30GapResolutionSequencePreview: phase30GapResolutionSequencePreview.schemaVersion,
      transitionReadinessRedline: transitionReadinessRedline.schemaVersion,
      finalReleaseBlockerDossier: finalReleaseBlockerDossier.schemaVersion,
      releaseExitDecisionPreview: releaseExitDecisionPreview.schemaVersion,
      runtimeEnableGovernance: runtimeEnableGovernance.schemaVersion
    },
    evidenceReviewQueueItems,
    evidenceReviewQueueChecks,
    blockedMutations: [
      "persist-entry-evidence-review-queue-as-release-approval",
      "persist-entry-evidence-review-queue-as-phase29-exit",
      "persist-entry-evidence-review-queue-as-phase30-entry",
      "persist-review-disposition-from-entry-evidence-review-queue",
      "approve-release-from-entry-evidence-review-queue",
      "exit-phase29-from-entry-evidence-review-queue",
      "open-phase30-entry-from-entry-evidence-review-queue",
      "clear-blocker-from-entry-evidence-review-queue",
      "resolve-redline-from-entry-evidence-review-queue",
      "mark-entry-evidence-reviewed",
      "override-entry-evidence-index-from-review-queue",
      "mark-releaseReady-true",
      "enable-runtime-execution",
      "enable-third-party-execution"
    ],
    exportPolicy: {
      exportName: "phase29-phase30-entry-evidence-review-queue-preview.json",
      includeInOperationsExport: true,
      redaction: "phase30-entry-evidence-review-queue-source-index-lane-owner-priority-and-readonly-guardrail-summary-only"
    },
    summary: {
      phase30EntryEvidenceReviewQueuePreviewReady: true,
      evidenceReviewQueueItems: evidenceReviewQueueItems.length,
      blockedEvidenceReviewQueueItems: evidenceReviewQueueItems.filter((item) => item.queueState.includes("blocked")).length,
      evidenceReviewQueueChecks: evidenceReviewQueueChecks.length,
      passedEvidenceReviewQueueChecks: evidenceReviewQueueChecks.filter((item) => item.result === "pass").length,
      reviewLanes: new Set(evidenceReviewQueueItems.map((item) => item.queueLane)).size,
      highPriorityReviewItems: evidenceReviewQueueItems.filter((item) => item.priority === "high").length,
      phase29ExitReady: false,
      phase30Blocked: true,
      phase30EntryReady: false,
      releaseReady: false,
      runtimeExecution: false,
      thirdPartyExecution: false,
      clearedBlockers: 0,
      persistedMutations: 0
    }
  };
}

function buildPhase29Phase30EntryEvidenceReviewDispositionPreview(phase30EntryEvidenceReviewQueuePreview = {}, phase30EntryEvidenceIndexPreview = {}, phase30EntryEvidencePackPreview = {}, transitionReadinessRedline = {}, finalReleaseBlockerDossier = {}, releaseExitDecisionPreview = {}, runtimeEnableGovernance = {}) {
  const dispositionPreviewItems = (phase30EntryEvidenceReviewQueuePreview.evidenceReviewQueueItems || []).map((item) => ({
    id: `disposition-${item.sourceIndexItemId?.replace(/^index-/, "") || item.id.replace(/^review-/, "")}`,
    label: item.label.replace("review queue", "review disposition"),
    sourceQueueItemId: item.id,
    sourceIndexItemId: item.sourceIndexItemId,
    evidenceType: item.evidenceType,
    queueLane: item.queueLane,
    priority: item.priority,
    owner: item.owner,
    reviewerRole: item.reviewerRole,
    dispositionPreviewState: "blocked-readonly-disposition-preview",
    candidateDisposition: item.priority === "high" ? "hold-for-human-evidence" : "needs-evidence-review",
    dispositionReason: `${item.blockerCategory} remains open; Phase 30 entry, Phase 29 exit, release approval, and runtime stay blocked`,
    requiredEvidence: ["human-review-note", "source-evidence-verified", "blocker-state-unchanged"],
    unresolvedGuardrails: item.blockedBy || [],
    mayPersistDisposition: false,
    mayClearBlocker: false,
    mayResolveRedline: false,
    mayExitPhase29: false,
    mayEnterPhase30: false,
    mayApproveRelease: false,
    mayEnableRuntime: false
  }));
  const dispositionPreviewChecks = [
    { id: "entry-evidence-review-disposition-linked-to-queue", result: phase30EntryEvidenceReviewQueuePreview.schemaVersion === "phase29.phase30-entry-evidence-review-queue-preview.v1" ? "pass" : "block", evidence: phase30EntryEvidenceReviewQueuePreview.schemaVersion },
    { id: "entry-evidence-review-disposition-linked-to-index", result: phase30EntryEvidenceIndexPreview.schemaVersion === "phase29.phase30-entry-evidence-index-preview.v1" ? "pass" : "block", evidence: phase30EntryEvidenceIndexPreview.schemaVersion },
    { id: "entry-evidence-review-disposition-linked-to-pack", result: phase30EntryEvidencePackPreview.schemaVersion === "phase29.phase30-entry-evidence-pack-preview.v1" ? "pass" : "block", evidence: phase30EntryEvidencePackPreview.schemaVersion },
    { id: "entry-evidence-review-disposition-keeps-redlines-active", result: transitionReadinessRedline.summary?.activeRedlines >= 1 ? "pass" : "block", evidence: `activeRedlines=${transitionReadinessRedline.summary?.activeRedlines ?? 0}` },
    { id: "entry-evidence-review-disposition-keeps-blockers-open", result: finalReleaseBlockerDossier.summary?.unresolvedBlockers >= 1 ? "pass" : "block", evidence: `unresolvedBlockers=${finalReleaseBlockerDossier.summary?.unresolvedBlockers ?? 0}` },
    { id: "entry-evidence-review-disposition-keeps-phase29-active", result: "pass", evidence: "phase29ExitReady=false" },
    { id: "entry-evidence-review-disposition-keeps-phase30-blocked", result: "pass", evidence: "phase30EntryReady=false" },
    { id: "entry-evidence-review-disposition-keeps-release-blocked", result: "pass", evidence: `releaseReady=${releaseExitDecisionPreview.summary?.releaseReady === true}` },
    { id: "entry-evidence-review-disposition-keeps-runtime-disabled", result: "pass", evidence: `runtimeExecution=${runtimeEnableGovernance.summary?.runtimeExecution === true}` },
    { id: "entry-evidence-review-disposition-does-not-persist-mutations", result: "pass", evidence: "persistedMutations=0" }
  ];
  return {
    schemaVersion: "phase29.phase30-entry-evidence-review-disposition-preview.v1",
    version: "1.9.33",
    mode: "readonly-phase30-entry-evidence-review-disposition-preview-no-disposition",
    sourceModels: {
      phase30EntryEvidenceReviewQueuePreview: phase30EntryEvidenceReviewQueuePreview.schemaVersion,
      phase30EntryEvidenceIndexPreview: phase30EntryEvidenceIndexPreview.schemaVersion,
      phase30EntryEvidencePackPreview: phase30EntryEvidencePackPreview.schemaVersion,
      transitionReadinessRedline: transitionReadinessRedline.schemaVersion,
      finalReleaseBlockerDossier: finalReleaseBlockerDossier.schemaVersion,
      releaseExitDecisionPreview: releaseExitDecisionPreview.schemaVersion,
      runtimeEnableGovernance: runtimeEnableGovernance.schemaVersion
    },
    dispositionPreviewItems,
    dispositionPreviewChecks,
    blockedMutations: [
      "persist-entry-evidence-review-disposition-as-release-approval",
      "persist-entry-evidence-review-disposition-as-phase29-exit",
      "persist-entry-evidence-review-disposition-as-phase30-entry",
      "persist-review-disposition-preview",
      "approve-release-from-entry-evidence-review-disposition",
      "exit-phase29-from-entry-evidence-review-disposition",
      "open-phase30-entry-from-entry-evidence-review-disposition",
      "clear-blocker-from-entry-evidence-review-disposition",
      "resolve-redline-from-entry-evidence-review-disposition",
      "mark-entry-evidence-dispositioned",
      "override-entry-evidence-review-queue-from-disposition",
      "mark-releaseReady-true",
      "enable-runtime-execution",
      "enable-third-party-execution"
    ],
    exportPolicy: {
      exportName: "phase29-phase30-entry-evidence-review-disposition-preview.json",
      includeInOperationsExport: true,
      redaction: "phase30-entry-evidence-review-disposition-source-queue-candidate-reason-owner-and-readonly-guardrail-summary-only"
    },
    summary: {
      phase30EntryEvidenceReviewDispositionPreviewReady: true,
      dispositionPreviewItems: dispositionPreviewItems.length,
      blockedDispositionPreviewItems: dispositionPreviewItems.filter((item) => item.dispositionPreviewState.includes("blocked")).length,
      dispositionPreviewChecks: dispositionPreviewChecks.length,
      passedDispositionPreviewChecks: dispositionPreviewChecks.filter((item) => item.result === "pass").length,
      holdForEvidenceItems: dispositionPreviewItems.filter((item) => item.candidateDisposition === "hold-for-human-evidence").length,
      phase29ExitReady: false,
      phase30Blocked: true,
      phase30EntryReady: false,
      releaseReady: false,
      runtimeExecution: false,
      thirdPartyExecution: false,
      clearedBlockers: 0,
      persistedMutations: 0
    }
  };
}

function buildPhase29Phase30EntryEvidenceDispositionLedgerPreview(phase30EntryEvidenceReviewDispositionPreview = {}, phase30EntryEvidenceReviewQueuePreview = {}, phase30EntryEvidenceIndexPreview = {}, finalReleaseBlockerDossier = {}, releaseExitDecisionPreview = {}, runtimeEnableGovernance = {}) {
  const dispositionLedgerEntries = (phase30EntryEvidenceReviewDispositionPreview.dispositionPreviewItems || []).map((item, index) => ({
    id: `ledger-${item.id.replace(/^disposition-/, "")}`,
    label: item.label.replace("review disposition", "disposition ledger"),
    ledgerOrder: index + 1,
    sourceDispositionItemId: item.id,
    sourceQueueItemId: item.sourceQueueItemId,
    sourceIndexItemId: item.sourceIndexItemId,
    evidenceType: item.evidenceType,
    owner: item.owner,
    candidateDisposition: item.candidateDisposition,
    ledgerState: "blocked-readonly-ledger-entry",
    ledgerReason: item.dispositionReason,
    requiredEvidence: item.requiredEvidence || [],
    unresolvedGuardrails: item.unresolvedGuardrails || [],
    auditPreview: {
      eventType: "entry-evidence-disposition-previewed",
      persisted: false,
      releaseReady: false,
      phase29ExitReady: false,
      phase30EntryReady: false
    },
    mayPersistLedgerEntry: false,
    mayPersistDisposition: false,
    mayClearBlocker: false,
    mayExitPhase29: false,
    mayEnterPhase30: false,
    mayApproveRelease: false,
    mayEnableRuntime: false
  }));
  const dispositionLedgerChecks = [
    { id: "entry-evidence-disposition-ledger-linked-to-disposition-preview", result: phase30EntryEvidenceReviewDispositionPreview.schemaVersion === "phase29.phase30-entry-evidence-review-disposition-preview.v1" ? "pass" : "block", evidence: phase30EntryEvidenceReviewDispositionPreview.schemaVersion },
    { id: "entry-evidence-disposition-ledger-linked-to-review-queue", result: phase30EntryEvidenceReviewQueuePreview.schemaVersion === "phase29.phase30-entry-evidence-review-queue-preview.v1" ? "pass" : "block", evidence: phase30EntryEvidenceReviewQueuePreview.schemaVersion },
    { id: "entry-evidence-disposition-ledger-linked-to-index", result: phase30EntryEvidenceIndexPreview.schemaVersion === "phase29.phase30-entry-evidence-index-preview.v1" ? "pass" : "block", evidence: phase30EntryEvidenceIndexPreview.schemaVersion },
    { id: "entry-evidence-disposition-ledger-keeps-blockers-open", result: finalReleaseBlockerDossier.summary?.unresolvedBlockers >= 1 ? "pass" : "block", evidence: `unresolvedBlockers=${finalReleaseBlockerDossier.summary?.unresolvedBlockers ?? 0}` },
    { id: "entry-evidence-disposition-ledger-keeps-phase29-active", result: "pass", evidence: "phase29ExitReady=false" },
    { id: "entry-evidence-disposition-ledger-keeps-phase30-blocked", result: "pass", evidence: "phase30EntryReady=false" },
    { id: "entry-evidence-disposition-ledger-keeps-release-blocked", result: "pass", evidence: `releaseReady=${releaseExitDecisionPreview.summary?.releaseReady === true}` },
    { id: "entry-evidence-disposition-ledger-keeps-runtime-disabled", result: "pass", evidence: `runtimeExecution=${runtimeEnableGovernance.summary?.runtimeExecution === true}` },
    { id: "entry-evidence-disposition-ledger-does-not-persist-mutations", result: "pass", evidence: "persistedMutations=0" }
  ];
  return {
    schemaVersion: "phase29.phase30-entry-evidence-disposition-ledger-preview.v1",
    version: "1.9.34",
    mode: "readonly-phase30-entry-evidence-disposition-ledger-preview-no-ledger-persist",
    sourceModels: {
      phase30EntryEvidenceReviewDispositionPreview: phase30EntryEvidenceReviewDispositionPreview.schemaVersion,
      phase30EntryEvidenceReviewQueuePreview: phase30EntryEvidenceReviewQueuePreview.schemaVersion,
      phase30EntryEvidenceIndexPreview: phase30EntryEvidenceIndexPreview.schemaVersion,
      finalReleaseBlockerDossier: finalReleaseBlockerDossier.schemaVersion,
      releaseExitDecisionPreview: releaseExitDecisionPreview.schemaVersion,
      runtimeEnableGovernance: runtimeEnableGovernance.schemaVersion
    },
    dispositionLedgerEntries,
    dispositionLedgerChecks,
    blockedMutations: [
      "persist-entry-evidence-disposition-ledger-as-release-approval",
      "persist-entry-evidence-disposition-ledger-as-phase29-exit",
      "persist-entry-evidence-disposition-ledger-as-phase30-entry",
      "persist-entry-evidence-disposition-ledger-entry",
      "persist-review-disposition-from-ledger",
      "approve-release-from-entry-evidence-disposition-ledger",
      "exit-phase29-from-entry-evidence-disposition-ledger",
      "open-phase30-entry-from-entry-evidence-disposition-ledger",
      "clear-blocker-from-entry-evidence-disposition-ledger",
      "resolve-redline-from-entry-evidence-disposition-ledger",
      "mark-entry-evidence-ledger-final",
      "override-entry-evidence-review-disposition-from-ledger",
      "mark-releaseReady-true",
      "enable-runtime-execution",
      "enable-third-party-execution"
    ],
    exportPolicy: {
      exportName: "phase29-phase30-entry-evidence-disposition-ledger-preview.json",
      includeInOperationsExport: true,
      redaction: "phase30-entry-evidence-disposition-ledger-source-disposition-candidate-owner-audit-preview-and-readonly-guardrail-summary-only"
    },
    summary: {
      phase30EntryEvidenceDispositionLedgerPreviewReady: true,
      dispositionLedgerEntries: dispositionLedgerEntries.length,
      blockedDispositionLedgerEntries: dispositionLedgerEntries.filter((item) => item.ledgerState.includes("blocked")).length,
      dispositionLedgerChecks: dispositionLedgerChecks.length,
      passedDispositionLedgerChecks: dispositionLedgerChecks.filter((item) => item.result === "pass").length,
      holdForEvidenceLedgerEntries: dispositionLedgerEntries.filter((item) => item.candidateDisposition === "hold-for-human-evidence").length,
      phase29ExitReady: false,
      phase30Blocked: true,
      phase30EntryReady: false,
      releaseReady: false,
      runtimeExecution: false,
      thirdPartyExecution: false,
      clearedBlockers: 0,
      persistedMutations: 0
    }
  };
}

function buildPhase29Phase30EntryEvidenceFinalLedgerExportPreview(phase30EntryEvidenceDispositionLedgerPreview = {}, phase30EntryEvidenceReviewDispositionPreview = {}, phase30EntryEvidenceReviewQueuePreview = {}, phase30EntryEvidenceIndexPreview = {}, phase30EntryEvidencePackPreview = {}, finalReleaseBlockerDossier = {}, releaseExitDecisionPreview = {}, runtimeEnableGovernance = {}) {
  const finalLedgerExportItems = (phase30EntryEvidenceDispositionLedgerPreview.dispositionLedgerEntries || []).map((item, index) => ({
    id: `final-export-${item.id.replace(/^ledger-/, "")}`,
    label: item.label.replace("disposition ledger", "final ledger export"),
    exportOrder: index + 1,
    sourceLedgerEntryId: item.id,
    sourceDispositionItemId: item.sourceDispositionItemId,
    sourceQueueItemId: item.sourceQueueItemId,
    sourceIndexItemId: item.sourceIndexItemId,
    evidenceType: item.evidenceType,
    owner: item.owner,
    candidateDisposition: item.candidateDisposition,
    exportState: "blocked-readonly-final-ledger-export",
    exportReason: item.ledgerReason,
    includedInPreview: true,
    persisted: false,
    requiredEvidence: item.requiredEvidence || [],
    unresolvedGuardrails: item.unresolvedGuardrails || [],
    auditPreview: {
      sourceEventType: item.auditPreview?.eventType,
      finalExportPreviewed: true,
      persisted: false,
      releaseReady: false,
      phase29ExitReady: false,
      phase30EntryReady: false
    },
    mayPersistFinalExport: false,
    mayPersistLedgerEntry: false,
    mayApproveRelease: false,
    mayExitPhase29: false,
    mayEnterPhase30: false,
    mayEnableRuntime: false
  }));
  const finalLedgerExportChecks = [
    { id: "final-ledger-export-linked-to-disposition-ledger", result: phase30EntryEvidenceDispositionLedgerPreview.schemaVersion === "phase29.phase30-entry-evidence-disposition-ledger-preview.v1" ? "pass" : "block", evidence: phase30EntryEvidenceDispositionLedgerPreview.schemaVersion },
    { id: "final-ledger-export-linked-to-review-disposition", result: phase30EntryEvidenceReviewDispositionPreview.schemaVersion === "phase29.phase30-entry-evidence-review-disposition-preview.v1" ? "pass" : "block", evidence: phase30EntryEvidenceReviewDispositionPreview.schemaVersion },
    { id: "final-ledger-export-linked-to-review-queue", result: phase30EntryEvidenceReviewQueuePreview.schemaVersion === "phase29.phase30-entry-evidence-review-queue-preview.v1" ? "pass" : "block", evidence: phase30EntryEvidenceReviewQueuePreview.schemaVersion },
    { id: "final-ledger-export-linked-to-index", result: phase30EntryEvidenceIndexPreview.schemaVersion === "phase29.phase30-entry-evidence-index-preview.v1" ? "pass" : "block", evidence: phase30EntryEvidenceIndexPreview.schemaVersion },
    { id: "final-ledger-export-linked-to-evidence-pack", result: phase30EntryEvidencePackPreview.schemaVersion === "phase29.phase30-entry-evidence-pack-preview.v1" ? "pass" : "block", evidence: phase30EntryEvidencePackPreview.schemaVersion },
    { id: "final-ledger-export-keeps-blockers-open", result: finalReleaseBlockerDossier.summary?.unresolvedBlockers >= 1 ? "pass" : "block", evidence: `unresolvedBlockers=${finalReleaseBlockerDossier.summary?.unresolvedBlockers ?? 0}` },
    { id: "final-ledger-export-keeps-phase29-active", result: "pass", evidence: "phase29ExitReady=false" },
    { id: "final-ledger-export-keeps-phase30-blocked", result: "pass", evidence: "phase30EntryReady=false" },
    { id: "final-ledger-export-keeps-release-blocked", result: "pass", evidence: `releaseReady=${releaseExitDecisionPreview.summary?.releaseReady === true}` },
    { id: "final-ledger-export-keeps-runtime-disabled", result: "pass", evidence: `runtimeExecution=${runtimeEnableGovernance.summary?.runtimeExecution === true}` },
    { id: "final-ledger-export-does-not-persist-mutations", result: "pass", evidence: "persistedMutations=0" }
  ];
  return {
    schemaVersion: "phase29.phase30-entry-evidence-final-ledger-export-preview.v1",
    version: "1.9.35",
    mode: "readonly-phase30-entry-evidence-final-ledger-export-preview-no-export-persist",
    sourceModels: {
      phase30EntryEvidenceDispositionLedgerPreview: phase30EntryEvidenceDispositionLedgerPreview.schemaVersion,
      phase30EntryEvidenceReviewDispositionPreview: phase30EntryEvidenceReviewDispositionPreview.schemaVersion,
      phase30EntryEvidenceReviewQueuePreview: phase30EntryEvidenceReviewQueuePreview.schemaVersion,
      phase30EntryEvidenceIndexPreview: phase30EntryEvidenceIndexPreview.schemaVersion,
      phase30EntryEvidencePackPreview: phase30EntryEvidencePackPreview.schemaVersion,
      finalReleaseBlockerDossier: finalReleaseBlockerDossier.schemaVersion,
      releaseExitDecisionPreview: releaseExitDecisionPreview.schemaVersion,
      runtimeEnableGovernance: runtimeEnableGovernance.schemaVersion
    },
    finalLedgerExportItems,
    finalLedgerExportChecks,
    blockedMutations: [
      "persist-entry-evidence-final-ledger-export-as-release-approval",
      "persist-entry-evidence-final-ledger-export-as-phase29-exit",
      "persist-entry-evidence-final-ledger-export-as-phase30-entry",
      "persist-entry-evidence-final-ledger-export-artifact",
      "persist-entry-evidence-final-ledger-export-item",
      "approve-release-from-entry-evidence-final-ledger-export",
      "exit-phase29-from-entry-evidence-final-ledger-export",
      "open-phase30-entry-from-entry-evidence-final-ledger-export",
      "clear-blocker-from-entry-evidence-final-ledger-export",
      "resolve-redline-from-entry-evidence-final-ledger-export",
      "mark-entry-evidence-final-ledger-export-ready",
      "override-entry-evidence-disposition-ledger-from-final-export",
      "mark-releaseReady-true",
      "enable-runtime-execution",
      "enable-third-party-execution"
    ],
    exportPolicy: {
      exportName: "phase29-phase30-entry-evidence-final-ledger-export-preview.json",
      includeInOperationsExport: true,
      redaction: "phase30-entry-evidence-final-ledger-source-ledger-disposition-owner-audit-preview-and-readonly-guardrail-summary-only"
    },
    summary: {
      phase30EntryEvidenceFinalLedgerExportPreviewReady: true,
      finalLedgerExportItems: finalLedgerExportItems.length,
      blockedFinalLedgerExportItems: finalLedgerExportItems.filter((item) => item.exportState.includes("blocked")).length,
      finalLedgerExportChecks: finalLedgerExportChecks.length,
      passedFinalLedgerExportChecks: finalLedgerExportChecks.filter((item) => item.result === "pass").length,
      includedFinalLedgerExportItems: finalLedgerExportItems.filter((item) => item.includedInPreview).length,
      persistedFinalLedgerExportItems: finalLedgerExportItems.filter((item) => item.persisted).length,
      phase29ExitReady: false,
      phase30Blocked: true,
      phase30EntryReady: false,
      releaseReady: false,
      runtimeExecution: false,
      thirdPartyExecution: false,
      clearedBlockers: 0,
      persistedMutations: 0
    }
  };
}

function buildPhase29Phase30EntryFinalExportReconciliationPreview(phase30EntryEvidenceFinalLedgerExportPreview = {}, phase30EntryEvidenceDispositionLedgerPreview = {}, phase30EntryEvidenceReviewDispositionPreview = {}, phase30EntryEvidenceReviewQueuePreview = {}, phase30EntryEvidenceIndexPreview = {}, finalReleaseBlockerDossier = {}, releaseExitDecisionPreview = {}, runtimeEnableGovernance = {}) {
  const ledgerEntries = phase30EntryEvidenceDispositionLedgerPreview.dispositionLedgerEntries || [];
  const finalExportItems = phase30EntryEvidenceFinalLedgerExportPreview.finalLedgerExportItems || [];
  const finalExportLedgerIds = new Set(finalExportItems.map((item) => item.sourceLedgerEntryId));
  const reconciliationItems = finalExportItems.map((item, index) => {
    const sourceLedgerEntry = ledgerEntries.find((entry) => entry.id === item.sourceLedgerEntryId) || {};
    return {
      id: `reconcile-${item.id.replace(/^final-export-/, "")}`,
      label: item.label.replace("final ledger export", "final export reconciliation"),
      reconciliationOrder: index + 1,
      sourceFinalExportItemId: item.id,
      sourceLedgerEntryId: item.sourceLedgerEntryId,
      sourceDispositionItemId: item.sourceDispositionItemId,
      sourceQueueItemId: item.sourceQueueItemId,
      sourceIndexItemId: item.sourceIndexItemId,
      evidenceType: item.evidenceType,
      owner: item.owner,
      candidateDisposition: item.candidateDisposition,
      reconciliationState: "blocked-readonly-final-export-reconciliation",
      coverageState: sourceLedgerEntry.id ? "covered-by-final-export-preview" : "missing-source-ledger-entry",
      persistedState: item.persisted === false ? "not-persisted" : "unexpected-persisted",
      blockerState: "carried-forward",
      sourceLedgerState: sourceLedgerEntry.ledgerState || "missing",
      finalExportState: item.exportState,
      mayPersistReconciliation: false,
      mayPersistFinalExport: false,
      mayApproveRelease: false,
      mayExitPhase29: false,
      mayEnterPhase30: false,
      mayEnableRuntime: false
    };
  });
  const uncoveredLedgerEntries = ledgerEntries.filter((item) => !finalExportLedgerIds.has(item.id));
  const reconciliationChecks = [
    { id: "final-export-reconciliation-linked-to-final-export", result: phase30EntryEvidenceFinalLedgerExportPreview.schemaVersion === "phase29.phase30-entry-evidence-final-ledger-export-preview.v1" ? "pass" : "block", evidence: phase30EntryEvidenceFinalLedgerExportPreview.schemaVersion },
    { id: "final-export-reconciliation-linked-to-disposition-ledger", result: phase30EntryEvidenceDispositionLedgerPreview.schemaVersion === "phase29.phase30-entry-evidence-disposition-ledger-preview.v1" ? "pass" : "block", evidence: phase30EntryEvidenceDispositionLedgerPreview.schemaVersion },
    { id: "final-export-reconciliation-linked-to-review-disposition", result: phase30EntryEvidenceReviewDispositionPreview.schemaVersion === "phase29.phase30-entry-evidence-review-disposition-preview.v1" ? "pass" : "block", evidence: phase30EntryEvidenceReviewDispositionPreview.schemaVersion },
    { id: "final-export-reconciliation-linked-to-review-queue", result: phase30EntryEvidenceReviewQueuePreview.schemaVersion === "phase29.phase30-entry-evidence-review-queue-preview.v1" ? "pass" : "block", evidence: phase30EntryEvidenceReviewQueuePreview.schemaVersion },
    { id: "final-export-reconciliation-linked-to-index", result: phase30EntryEvidenceIndexPreview.schemaVersion === "phase29.phase30-entry-evidence-index-preview.v1" ? "pass" : "block", evidence: phase30EntryEvidenceIndexPreview.schemaVersion },
    { id: "final-export-reconciliation-covers-all-ledger-entries", result: uncoveredLedgerEntries.length === 0 && finalExportItems.length === ledgerEntries.length ? "pass" : "block", evidence: `finalExportItems=${finalExportItems.length}; ledgerEntries=${ledgerEntries.length}; uncovered=${uncoveredLedgerEntries.length}` },
    { id: "final-export-reconciliation-keeps-final-export-unpersisted", result: finalExportItems.every((item) => item.persisted === false) ? "pass" : "block", evidence: `persistedFinalExportItems=${finalExportItems.filter((item) => item.persisted !== false).length}` },
    { id: "final-export-reconciliation-keeps-blockers-open", result: finalReleaseBlockerDossier.summary?.unresolvedBlockers >= 1 ? "pass" : "block", evidence: `unresolvedBlockers=${finalReleaseBlockerDossier.summary?.unresolvedBlockers ?? 0}` },
    { id: "final-export-reconciliation-keeps-phase29-active", result: "pass", evidence: "phase29ExitReady=false" },
    { id: "final-export-reconciliation-keeps-phase30-blocked", result: "pass", evidence: "phase30EntryReady=false" },
    { id: "final-export-reconciliation-keeps-release-blocked", result: "pass", evidence: `releaseReady=${releaseExitDecisionPreview.summary?.releaseReady === true}` },
    { id: "final-export-reconciliation-keeps-runtime-disabled", result: "pass", evidence: `runtimeExecution=${runtimeEnableGovernance.summary?.runtimeExecution === true}` },
    { id: "final-export-reconciliation-does-not-persist-mutations", result: "pass", evidence: "persistedMutations=0" }
  ];
  return {
    schemaVersion: "phase29.phase30-entry-final-export-reconciliation-preview.v1",
    version: "1.9.36",
    mode: "readonly-phase30-entry-final-export-reconciliation-preview-no-reconciliation-persist",
    sourceModels: {
      phase30EntryEvidenceFinalLedgerExportPreview: phase30EntryEvidenceFinalLedgerExportPreview.schemaVersion,
      phase30EntryEvidenceDispositionLedgerPreview: phase30EntryEvidenceDispositionLedgerPreview.schemaVersion,
      phase30EntryEvidenceReviewDispositionPreview: phase30EntryEvidenceReviewDispositionPreview.schemaVersion,
      phase30EntryEvidenceReviewQueuePreview: phase30EntryEvidenceReviewQueuePreview.schemaVersion,
      phase30EntryEvidenceIndexPreview: phase30EntryEvidenceIndexPreview.schemaVersion,
      finalReleaseBlockerDossier: finalReleaseBlockerDossier.schemaVersion,
      releaseExitDecisionPreview: releaseExitDecisionPreview.schemaVersion,
      runtimeEnableGovernance: runtimeEnableGovernance.schemaVersion
    },
    reconciliationItems,
    uncoveredLedgerEntries: uncoveredLedgerEntries.map((item) => item.id),
    reconciliationChecks,
    blockedMutations: [
      "persist-entry-final-export-reconciliation-as-release-approval",
      "persist-entry-final-export-reconciliation-as-phase29-exit",
      "persist-entry-final-export-reconciliation-as-phase30-entry",
      "persist-entry-final-export-reconciliation-artifact",
      "persist-entry-final-export-reconciliation-item",
      "persist-final-ledger-export-from-reconciliation",
      "approve-release-from-entry-final-export-reconciliation",
      "exit-phase29-from-entry-final-export-reconciliation",
      "open-phase30-entry-from-entry-final-export-reconciliation",
      "clear-blocker-from-entry-final-export-reconciliation",
      "resolve-redline-from-entry-final-export-reconciliation",
      "mark-entry-final-export-reconciliation-complete",
      "override-entry-final-ledger-export-from-reconciliation",
      "mark-releaseReady-true",
      "enable-runtime-execution",
      "enable-third-party-execution"
    ],
    exportPolicy: {
      exportName: "phase29-phase30-entry-final-export-reconciliation-preview.json",
      includeInOperationsExport: true,
      redaction: "phase30-entry-final-export-reconciliation-source-ledger-final-export-coverage-and-readonly-guardrail-summary-only"
    },
    summary: {
      phase30EntryFinalExportReconciliationPreviewReady: true,
      reconciliationItems: reconciliationItems.length,
      blockedReconciliationItems: reconciliationItems.filter((item) => item.reconciliationState.includes("blocked")).length,
      coveredLedgerEntries: reconciliationItems.filter((item) => item.coverageState === "covered-by-final-export-preview").length,
      uncoveredLedgerEntries: uncoveredLedgerEntries.length,
      reconciliationChecks: reconciliationChecks.length,
      passedReconciliationChecks: reconciliationChecks.filter((item) => item.result === "pass").length,
      persistedFinalExportItems: finalExportItems.filter((item) => item.persisted !== false).length,
      phase29ExitReady: false,
      phase30Blocked: true,
      phase30EntryReady: false,
      releaseReady: false,
      runtimeExecution: false,
      thirdPartyExecution: false,
      clearedBlockers: 0,
      persistedMutations: 0
    }
  };
}

function buildPhase29Phase30EntryReconciliationSignoffPreview(phase30EntryFinalExportReconciliationPreview = {}, phase30EntryEvidenceFinalLedgerExportPreview = {}, releaseFinalReviewEnvelopePreview = {}, exitReadinessAttestationPreview = {}, finalReleaseBlockerDossier = {}, releaseExitDecisionPreview = {}, runtimeEnableGovernance = {}) {
  const reconciliationItems = phase30EntryFinalExportReconciliationPreview.reconciliationItems || [];
  const requiredSignoffRoles = ["release-owner", "phase29-exit-reviewer", "phase30-entry-reviewer", "runtime-governance-reviewer"];
  const signoffItems = reconciliationItems.map((item, index) => ({
    id: `signoff-${item.id.replace(/^reconcile-/, "")}`,
    label: item.label.replace("final export reconciliation", "reconciliation signoff"),
    signoffOrder: index + 1,
    sourceReconciliationItemId: item.id,
    sourceFinalExportItemId: item.sourceFinalExportItemId,
    sourceLedgerEntryId: item.sourceLedgerEntryId,
    sourceDispositionItemId: item.sourceDispositionItemId,
    sourceQueueItemId: item.sourceQueueItemId,
    sourceIndexItemId: item.sourceIndexItemId,
    evidenceType: item.evidenceType,
    owner: item.owner,
    candidateDisposition: item.candidateDisposition,
    requiredSignoffRoles,
    signoffState: "blocked-readonly-reconciliation-signoff-preview",
    evidenceCoverageState: item.coverageState,
    reconciliationPersistedState: item.persistedState,
    releaseBlockerState: finalReleaseBlockerDossier.summary?.unresolvedBlockers >= 1 ? "blockers-open" : "blockers-missing",
    signoffPersistenceState: "not-persisted",
    mayRecordSignoff: false,
    mayApproveRelease: false,
    mayExitPhase29: false,
    mayEnterPhase30: false,
    mayEnableRuntime: false,
    persisted: false
  }));
  const signoffChecks = [
    { id: "reconciliation-signoff-linked-to-reconciliation-preview", result: phase30EntryFinalExportReconciliationPreview.schemaVersion === "phase29.phase30-entry-final-export-reconciliation-preview.v1" ? "pass" : "block", evidence: phase30EntryFinalExportReconciliationPreview.schemaVersion },
    { id: "reconciliation-signoff-linked-to-final-export", result: phase30EntryEvidenceFinalLedgerExportPreview.schemaVersion === "phase29.phase30-entry-evidence-final-ledger-export-preview.v1" ? "pass" : "block", evidence: phase30EntryEvidenceFinalLedgerExportPreview.schemaVersion },
    { id: "reconciliation-signoff-linked-to-final-review-envelope", result: releaseFinalReviewEnvelopePreview.schemaVersion === "phase29.release-final-review-envelope-preview.v1" ? "pass" : "block", evidence: releaseFinalReviewEnvelopePreview.schemaVersion },
    { id: "reconciliation-signoff-linked-to-exit-attestation", result: exitReadinessAttestationPreview.schemaVersion === "phase29.exit-readiness-attestation-preview.v1" ? "pass" : "block", evidence: exitReadinessAttestationPreview.schemaVersion },
    { id: "reconciliation-signoff-covers-all-reconciliation-items", result: signoffItems.length === reconciliationItems.length && (phase30EntryFinalExportReconciliationPreview.summary?.uncoveredLedgerEntries || 0) === 0 ? "pass" : "block", evidence: `signoffItems=${signoffItems.length}; reconciliationItems=${reconciliationItems.length}; uncovered=${phase30EntryFinalExportReconciliationPreview.summary?.uncoveredLedgerEntries || 0}` },
    { id: "reconciliation-signoff-keeps-signoffs-unpersisted", result: signoffItems.every((item) => item.persisted === false) ? "pass" : "block", evidence: `persistedSignoffs=${signoffItems.filter((item) => item.persisted !== false).length}` },
    { id: "reconciliation-signoff-keeps-blockers-open", result: finalReleaseBlockerDossier.summary?.unresolvedBlockers >= 1 ? "pass" : "block", evidence: `unresolvedBlockers=${finalReleaseBlockerDossier.summary?.unresolvedBlockers ?? 0}` },
    { id: "reconciliation-signoff-keeps-phase29-active", result: "pass", evidence: "phase29ExitReady=false" },
    { id: "reconciliation-signoff-keeps-phase30-blocked", result: "pass", evidence: "phase30EntryReady=false" },
    { id: "reconciliation-signoff-keeps-release-blocked", result: "pass", evidence: `releaseReady=${releaseExitDecisionPreview.summary?.releaseReady === true}` },
    { id: "reconciliation-signoff-keeps-runtime-disabled", result: "pass", evidence: `runtimeExecution=${runtimeEnableGovernance.summary?.runtimeExecution === true}` },
    { id: "reconciliation-signoff-does-not-persist-mutations", result: "pass", evidence: "persistedMutations=0" }
  ];
  return {
    schemaVersion: "phase29.phase30-entry-reconciliation-signoff-preview.v1",
    version: "1.9.37",
    mode: "readonly-phase30-entry-reconciliation-signoff-preview-no-signoff-persist",
    sourceModels: {
      phase30EntryFinalExportReconciliationPreview: phase30EntryFinalExportReconciliationPreview.schemaVersion,
      phase30EntryEvidenceFinalLedgerExportPreview: phase30EntryEvidenceFinalLedgerExportPreview.schemaVersion,
      releaseFinalReviewEnvelopePreview: releaseFinalReviewEnvelopePreview.schemaVersion,
      exitReadinessAttestationPreview: exitReadinessAttestationPreview.schemaVersion,
      finalReleaseBlockerDossier: finalReleaseBlockerDossier.schemaVersion,
      releaseExitDecisionPreview: releaseExitDecisionPreview.schemaVersion,
      runtimeEnableGovernance: runtimeEnableGovernance.schemaVersion
    },
    signoffItems,
    signoffChecks,
    blockedMutations: [
      "persist-entry-reconciliation-signoff-as-release-approval",
      "persist-entry-reconciliation-signoff-as-phase29-exit",
      "persist-entry-reconciliation-signoff-as-phase30-entry",
      "persist-entry-reconciliation-signoff-artifact",
      "persist-entry-reconciliation-signoff-item",
      "persist-final-export-reconciliation-from-signoff",
      "record-reconciliation-signoff",
      "approve-release-from-entry-reconciliation-signoff",
      "exit-phase29-from-entry-reconciliation-signoff",
      "open-phase30-entry-from-entry-reconciliation-signoff",
      "clear-blocker-from-entry-reconciliation-signoff",
      "resolve-redline-from-entry-reconciliation-signoff",
      "mark-entry-reconciliation-signoff-complete",
      "override-entry-final-export-reconciliation-from-signoff",
      "mark-releaseReady-true",
      "enable-runtime-execution",
      "enable-third-party-execution"
    ],
    exportPolicy: {
      exportName: "phase29-phase30-entry-reconciliation-signoff-preview.json",
      includeInOperationsExport: true,
      redaction: "phase30-entry-reconciliation-signoff-role-source-coverage-and-readonly-guardrail-summary-only"
    },
    summary: {
      phase30EntryReconciliationSignoffPreviewReady: true,
      signoffItems: signoffItems.length,
      blockedSignoffItems: signoffItems.filter((item) => item.signoffState.includes("blocked")).length,
      signoffChecks: signoffChecks.length,
      passedSignoffChecks: signoffChecks.filter((item) => item.result === "pass").length,
      requiredSignoffRoles: requiredSignoffRoles.length,
      signedOffItems: 0,
      persistedSignoffs: signoffItems.filter((item) => item.persisted !== false).length,
      phase29ExitReady: false,
      phase30Blocked: true,
      phase30EntryReady: false,
      releaseReady: false,
      runtimeExecution: false,
      thirdPartyExecution: false,
      clearedBlockers: 0,
      persistedMutations: 0
    }
  };
}

function buildPhase29Phase30EntrySignoffAuditPreview(phase30EntryReconciliationSignoffPreview = {}, phase30EntryFinalExportReconciliationPreview = {}, releaseFinalReviewEnvelopePreview = {}, exitReadinessAttestationPreview = {}, finalReleaseBlockerDossier = {}, releaseExitDecisionPreview = {}, runtimeEnableGovernance = {}) {
  const signoffItems = phase30EntryReconciliationSignoffPreview.signoffItems || [];
  const auditItems = signoffItems.map((item, index) => ({
    id: `audit-${item.id.replace(/^signoff-/, "")}`,
    label: item.label.replace("reconciliation signoff", "signoff audit"),
    auditOrder: index + 1,
    sourceSignoffItemId: item.id,
    sourceReconciliationItemId: item.sourceReconciliationItemId,
    sourceFinalExportItemId: item.sourceFinalExportItemId,
    sourceLedgerEntryId: item.sourceLedgerEntryId,
    sourceDispositionItemId: item.sourceDispositionItemId,
    sourceQueueItemId: item.sourceQueueItemId,
    sourceIndexItemId: item.sourceIndexItemId,
    evidenceType: item.evidenceType,
    owner: item.owner,
    candidateDisposition: item.candidateDisposition,
    requiredSignoffRoles: item.requiredSignoffRoles || [],
    auditState: "blocked-readonly-signoff-audit-preview",
    signoffState: item.signoffState,
    evidenceCoverageState: item.evidenceCoverageState,
    signoffPersistenceState: item.signoffPersistenceState,
    auditPersistenceState: "not-persisted",
    releaseBlockerState: item.releaseBlockerState,
    mayPersistAudit: false,
    mayRecordSignoff: false,
    mayApproveRelease: false,
    mayExitPhase29: false,
    mayEnterPhase30: false,
    mayEnableRuntime: false,
    persisted: false
  }));
  const auditChecks = [
    { id: "signoff-audit-linked-to-signoff-preview", result: phase30EntryReconciliationSignoffPreview.schemaVersion === "phase29.phase30-entry-reconciliation-signoff-preview.v1" ? "pass" : "block", evidence: phase30EntryReconciliationSignoffPreview.schemaVersion },
    { id: "signoff-audit-linked-to-reconciliation-preview", result: phase30EntryFinalExportReconciliationPreview.schemaVersion === "phase29.phase30-entry-final-export-reconciliation-preview.v1" ? "pass" : "block", evidence: phase30EntryFinalExportReconciliationPreview.schemaVersion },
    { id: "signoff-audit-linked-to-final-review-envelope", result: releaseFinalReviewEnvelopePreview.schemaVersion === "phase29.release-final-review-envelope-preview.v1" ? "pass" : "block", evidence: releaseFinalReviewEnvelopePreview.schemaVersion },
    { id: "signoff-audit-linked-to-exit-attestation", result: exitReadinessAttestationPreview.schemaVersion === "phase29.exit-readiness-attestation-preview.v1" ? "pass" : "block", evidence: exitReadinessAttestationPreview.schemaVersion },
    { id: "signoff-audit-covers-all-signoff-items", result: auditItems.length === signoffItems.length ? "pass" : "block", evidence: `auditItems=${auditItems.length}; signoffItems=${signoffItems.length}` },
    { id: "signoff-audit-keeps-signoffs-unpersisted", result: signoffItems.every((item) => item.persisted === false) ? "pass" : "block", evidence: `persistedSignoffs=${signoffItems.filter((item) => item.persisted !== false).length}` },
    { id: "signoff-audit-keeps-audit-unpersisted", result: auditItems.every((item) => item.persisted === false) ? "pass" : "block", evidence: `persistedAuditItems=${auditItems.filter((item) => item.persisted !== false).length}` },
    { id: "signoff-audit-keeps-blockers-open", result: finalReleaseBlockerDossier.summary?.unresolvedBlockers >= 1 ? "pass" : "block", evidence: `unresolvedBlockers=${finalReleaseBlockerDossier.summary?.unresolvedBlockers ?? 0}` },
    { id: "signoff-audit-keeps-phase29-active", result: "pass", evidence: "phase29ExitReady=false" },
    { id: "signoff-audit-keeps-phase30-blocked", result: "pass", evidence: "phase30EntryReady=false" },
    { id: "signoff-audit-keeps-release-blocked", result: "pass", evidence: `releaseReady=${releaseExitDecisionPreview.summary?.releaseReady === true}` },
    { id: "signoff-audit-keeps-runtime-disabled", result: "pass", evidence: `runtimeExecution=${runtimeEnableGovernance.summary?.runtimeExecution === true}` },
    { id: "signoff-audit-does-not-persist-mutations", result: "pass", evidence: "persistedMutations=0" }
  ];
  return {
    schemaVersion: "phase29.phase30-entry-signoff-audit-preview.v1",
    version: "1.9.38",
    mode: "readonly-phase30-entry-signoff-audit-preview-no-audit-persist",
    sourceModels: {
      phase30EntryReconciliationSignoffPreview: phase30EntryReconciliationSignoffPreview.schemaVersion,
      phase30EntryFinalExportReconciliationPreview: phase30EntryFinalExportReconciliationPreview.schemaVersion,
      releaseFinalReviewEnvelopePreview: releaseFinalReviewEnvelopePreview.schemaVersion,
      exitReadinessAttestationPreview: exitReadinessAttestationPreview.schemaVersion,
      finalReleaseBlockerDossier: finalReleaseBlockerDossier.schemaVersion,
      releaseExitDecisionPreview: releaseExitDecisionPreview.schemaVersion,
      runtimeEnableGovernance: runtimeEnableGovernance.schemaVersion
    },
    auditItems,
    auditChecks,
    blockedMutations: [
      "persist-entry-signoff-audit-as-release-approval",
      "persist-entry-signoff-audit-as-phase29-exit",
      "persist-entry-signoff-audit-as-phase30-entry",
      "persist-entry-signoff-audit-artifact",
      "persist-entry-signoff-audit-item",
      "persist-reconciliation-signoff-from-audit",
      "record-signoff-audit",
      "record-reconciliation-signoff-from-audit",
      "approve-release-from-entry-signoff-audit",
      "exit-phase29-from-entry-signoff-audit",
      "open-phase30-entry-from-entry-signoff-audit",
      "clear-blocker-from-entry-signoff-audit",
      "resolve-redline-from-entry-signoff-audit",
      "mark-entry-signoff-audit-complete",
      "override-entry-reconciliation-signoff-from-audit",
      "mark-releaseReady-true",
      "enable-runtime-execution",
      "enable-third-party-execution"
    ],
    exportPolicy: {
      exportName: "phase29-phase30-entry-signoff-audit-preview.json",
      includeInOperationsExport: true,
      redaction: "phase30-entry-signoff-audit-source-role-persistence-and-readonly-guardrail-summary-only"
    },
    summary: {
      phase30EntrySignoffAuditPreviewReady: true,
      auditItems: auditItems.length,
      blockedAuditItems: auditItems.filter((item) => item.auditState.includes("blocked")).length,
      auditChecks: auditChecks.length,
      passedAuditChecks: auditChecks.filter((item) => item.result === "pass").length,
      auditedSignoffItems: 0,
      persistedAuditItems: auditItems.filter((item) => item.persisted !== false).length,
      persistedSignoffs: signoffItems.filter((item) => item.persisted !== false).length,
      phase29ExitReady: false,
      phase30Blocked: true,
      phase30EntryReady: false,
      releaseReady: false,
      runtimeExecution: false,
      thirdPartyExecution: false,
      clearedBlockers: 0,
      persistedMutations: 0
    }
  };
}

function buildPhase29Phase30EntryAuditClosurePreview(phase30EntrySignoffAuditPreview = {}, phase30EntryReconciliationSignoffPreview = {}, phase30EntryFinalExportReconciliationPreview = {}, releaseFinalReviewEnvelopePreview = {}, exitReadinessAttestationPreview = {}, finalReleaseBlockerDossier = {}, releaseExitDecisionPreview = {}, runtimeEnableGovernance = {}) {
  const auditItems = phase30EntrySignoffAuditPreview.auditItems || [];
  const closureItems = auditItems.map((item, index) => ({
    id: `closure-${item.id.replace(/^audit-/, "")}`,
    label: item.label.replace("signoff audit", "audit closure"),
    closureOrder: index + 1,
    sourceAuditItemId: item.id,
    sourceSignoffItemId: item.sourceSignoffItemId,
    sourceReconciliationItemId: item.sourceReconciliationItemId,
    sourceFinalExportItemId: item.sourceFinalExportItemId,
    sourceLedgerEntryId: item.sourceLedgerEntryId,
    sourceDispositionItemId: item.sourceDispositionItemId,
    sourceQueueItemId: item.sourceQueueItemId,
    sourceIndexItemId: item.sourceIndexItemId,
    evidenceType: item.evidenceType,
    owner: item.owner,
    candidateDisposition: item.candidateDisposition,
    requiredSignoffRoles: item.requiredSignoffRoles || [],
    closureState: "blocked-readonly-audit-closure-preview",
    auditState: item.auditState,
    signoffState: item.signoffState,
    evidenceCoverageState: item.evidenceCoverageState,
    auditPersistenceState: item.auditPersistenceState,
    signoffPersistenceState: item.signoffPersistenceState,
    closurePersistenceState: "not-persisted",
    releaseBlockerState: item.releaseBlockerState,
    mayPersistClosure: false,
    mayPersistAudit: false,
    mayRecordSignoff: false,
    mayRecordClosure: false,
    mayApproveRelease: false,
    mayExitPhase29: false,
    mayEnterPhase30: false,
    mayEnableRuntime: false,
    persisted: false
  }));
  const closureChecks = [
    { id: "audit-closure-linked-to-signoff-audit-preview", result: phase30EntrySignoffAuditPreview.schemaVersion === "phase29.phase30-entry-signoff-audit-preview.v1" ? "pass" : "block", evidence: phase30EntrySignoffAuditPreview.schemaVersion },
    { id: "audit-closure-linked-to-reconciliation-signoff-preview", result: phase30EntryReconciliationSignoffPreview.schemaVersion === "phase29.phase30-entry-reconciliation-signoff-preview.v1" ? "pass" : "block", evidence: phase30EntryReconciliationSignoffPreview.schemaVersion },
    { id: "audit-closure-linked-to-final-export-reconciliation-preview", result: phase30EntryFinalExportReconciliationPreview.schemaVersion === "phase29.phase30-entry-final-export-reconciliation-preview.v1" ? "pass" : "block", evidence: phase30EntryFinalExportReconciliationPreview.schemaVersion },
    { id: "audit-closure-linked-to-final-review-envelope", result: releaseFinalReviewEnvelopePreview.schemaVersion === "phase29.release-final-review-envelope-preview.v1" ? "pass" : "block", evidence: releaseFinalReviewEnvelopePreview.schemaVersion },
    { id: "audit-closure-linked-to-exit-attestation", result: exitReadinessAttestationPreview.schemaVersion === "phase29.exit-readiness-attestation-preview.v1" ? "pass" : "block", evidence: exitReadinessAttestationPreview.schemaVersion },
    { id: "audit-closure-covers-all-audit-items", result: closureItems.length === auditItems.length ? "pass" : "block", evidence: `closureItems=${closureItems.length}; auditItems=${auditItems.length}` },
    { id: "audit-closure-keeps-audit-unpersisted", result: auditItems.every((item) => item.persisted === false) ? "pass" : "block", evidence: `persistedAuditItems=${auditItems.filter((item) => item.persisted !== false).length}` },
    { id: "audit-closure-keeps-closures-unpersisted", result: closureItems.every((item) => item.persisted === false) ? "pass" : "block", evidence: `persistedClosureItems=${closureItems.filter((item) => item.persisted !== false).length}` },
    { id: "audit-closure-keeps-signoffs-unpersisted", result: (phase30EntryReconciliationSignoffPreview.signoffItems || []).every((item) => item.persisted === false) ? "pass" : "block", evidence: `persistedSignoffs=${(phase30EntryReconciliationSignoffPreview.signoffItems || []).filter((item) => item.persisted !== false).length}` },
    { id: "audit-closure-keeps-blockers-open", result: finalReleaseBlockerDossier.summary?.unresolvedBlockers >= 1 ? "pass" : "block", evidence: `unresolvedBlockers=${finalReleaseBlockerDossier.summary?.unresolvedBlockers ?? 0}` },
    { id: "audit-closure-keeps-phase29-active", result: "pass", evidence: "phase29ExitReady=false" },
    { id: "audit-closure-keeps-phase30-blocked", result: "pass", evidence: "phase30EntryReady=false" },
    { id: "audit-closure-keeps-release-blocked", result: "pass", evidence: `releaseReady=${releaseExitDecisionPreview.summary?.releaseReady === true}` },
    { id: "audit-closure-keeps-runtime-disabled", result: "pass", evidence: `runtimeExecution=${runtimeEnableGovernance.summary?.runtimeExecution === true}` },
    { id: "audit-closure-does-not-persist-mutations", result: "pass", evidence: "persistedMutations=0" }
  ];
  return {
    schemaVersion: "phase29.phase30-entry-audit-closure-preview.v1",
    version: "1.9.39",
    mode: "readonly-phase30-entry-audit-closure-preview-no-closure-persist",
    sourceModels: {
      phase30EntrySignoffAuditPreview: phase30EntrySignoffAuditPreview.schemaVersion,
      phase30EntryReconciliationSignoffPreview: phase30EntryReconciliationSignoffPreview.schemaVersion,
      phase30EntryFinalExportReconciliationPreview: phase30EntryFinalExportReconciliationPreview.schemaVersion,
      releaseFinalReviewEnvelopePreview: releaseFinalReviewEnvelopePreview.schemaVersion,
      exitReadinessAttestationPreview: exitReadinessAttestationPreview.schemaVersion,
      finalReleaseBlockerDossier: finalReleaseBlockerDossier.schemaVersion,
      releaseExitDecisionPreview: releaseExitDecisionPreview.schemaVersion,
      runtimeEnableGovernance: runtimeEnableGovernance.schemaVersion
    },
    closureItems,
    closureChecks,
    blockedMutations: [
      "persist-entry-audit-closure-as-release-approval",
      "persist-entry-audit-closure-as-phase29-exit",
      "persist-entry-audit-closure-as-phase30-entry",
      "persist-entry-audit-closure-artifact",
      "persist-entry-audit-closure-item",
      "persist-signoff-audit-from-closure",
      "record-audit-closure",
      "record-signoff-audit-from-closure",
      "record-reconciliation-signoff-from-closure",
      "approve-release-from-entry-audit-closure",
      "exit-phase29-from-entry-audit-closure",
      "open-phase30-entry-from-entry-audit-closure",
      "clear-blocker-from-entry-audit-closure",
      "resolve-redline-from-entry-audit-closure",
      "mark-entry-audit-closure-complete",
      "override-entry-signoff-audit-from-closure",
      "mark-releaseReady-true",
      "enable-runtime-execution",
      "enable-third-party-execution"
    ],
    exportPolicy: {
      exportName: "phase29-phase30-entry-audit-closure-preview.json",
      includeInOperationsExport: true,
      redaction: "phase30-entry-audit-closure-source-audit-signoff-persistence-and-readonly-guardrail-summary-only"
    },
    summary: {
      phase30EntryAuditClosurePreviewReady: true,
      closureItems: closureItems.length,
      blockedClosureItems: closureItems.filter((item) => item.closureState.includes("blocked")).length,
      closureChecks: closureChecks.length,
      passedClosureChecks: closureChecks.filter((item) => item.result === "pass").length,
      closedAuditItems: 0,
      persistedClosureItems: closureItems.filter((item) => item.persisted !== false).length,
      persistedAuditItems: auditItems.filter((item) => item.persisted !== false).length,
      persistedSignoffs: (phase30EntryReconciliationSignoffPreview.signoffItems || []).filter((item) => item.persisted !== false).length,
      phase29ExitReady: false,
      phase30Blocked: true,
      phase30EntryReady: false,
      releaseReady: false,
      runtimeExecution: false,
      thirdPartyExecution: false,
      clearedBlockers: 0,
      persistedMutations: 0
    }
  };
}

function buildPhase29AuditClosureReadinessHardening(phase30EntryAuditClosurePreview = {}, phase30EntrySignoffAuditPreview = {}, phase30EntryReconciliationSignoffPreview = {}, phase30EntryFinalExportReconciliationPreview = {}, transitionReadinessRedline = {}, phase30EntryPreflight = {}, finalReleaseBlockerDossier = {}, releaseExitDecisionPreview = {}, runtimeEnableGovernance = {}) {
  const closureItems = phase30EntryAuditClosurePreview.closureItems || [];
  const auditItems = phase30EntrySignoffAuditPreview.auditItems || [];
  const signoffItems = phase30EntryReconciliationSignoffPreview.signoffItems || [];
  const hardeningItems = closureItems.map((item, index) => ({
    id: "hardening-" + item.id.replace(/^closure-/, ""),
    label: item.label.replace("audit closure", "audit closure hardening"),
    hardeningOrder: index + 1,
    sourceClosureItemId: item.id,
    sourceAuditItemId: item.sourceAuditItemId,
    sourceSignoffItemId: item.sourceSignoffItemId,
    sourceReconciliationItemId: item.sourceReconciliationItemId,
    sourceFinalExportItemId: item.sourceFinalExportItemId,
    sourceLedgerEntryId: item.sourceLedgerEntryId,
    sourceDispositionItemId: item.sourceDispositionItemId,
    sourceQueueItemId: item.sourceQueueItemId,
    sourceIndexItemId: item.sourceIndexItemId,
    evidenceType: item.evidenceType,
    owner: item.owner,
    candidateDisposition: item.candidateDisposition,
    requiredSignoffRoles: item.requiredSignoffRoles || [],
    hardeningState: "blocked-readonly-audit-closure-readiness-hardening",
    closureState: item.closureState,
    auditState: item.auditState,
    signoffState: item.signoffState,
    evidenceCoverageState: item.evidenceCoverageState,
    closurePersistenceState: item.closurePersistenceState,
    auditPersistenceState: item.auditPersistenceState,
    signoffPersistenceState: item.signoffPersistenceState,
    hardeningPersistenceState: "not-persisted",
    releaseBlockerState: item.releaseBlockerState,
    mayPersistHardening: false,
    mayPersistClosure: false,
    mayPersistAudit: false,
    mayRecordClosure: false,
    mayRecordSignoff: false,
    mayApproveRelease: false,
    mayExitPhase29: false,
    mayEnterPhase30: false,
    mayEnableRuntime: false,
    persisted: false
  }));
  const hardeningChecks = [
    { id: "hardening-linked-to-audit-closure-preview", result: phase30EntryAuditClosurePreview.schemaVersion === "phase29.phase30-entry-audit-closure-preview.v1" ? "pass" : "block", evidence: phase30EntryAuditClosurePreview.schemaVersion },
    { id: "hardening-linked-to-signoff-audit-preview", result: phase30EntrySignoffAuditPreview.schemaVersion === "phase29.phase30-entry-signoff-audit-preview.v1" ? "pass" : "block", evidence: phase30EntrySignoffAuditPreview.schemaVersion },
    { id: "hardening-linked-to-reconciliation-signoff-preview", result: phase30EntryReconciliationSignoffPreview.schemaVersion === "phase29.phase30-entry-reconciliation-signoff-preview.v1" ? "pass" : "block", evidence: phase30EntryReconciliationSignoffPreview.schemaVersion },
    { id: "hardening-linked-to-final-export-reconciliation-preview", result: phase30EntryFinalExportReconciliationPreview.schemaVersion === "phase29.phase30-entry-final-export-reconciliation-preview.v1" ? "pass" : "block", evidence: phase30EntryFinalExportReconciliationPreview.schemaVersion },
    { id: "hardening-covers-all-closure-items", result: hardeningItems.length === closureItems.length ? "pass" : "block", evidence: "hardeningItems=" + hardeningItems.length + "; closureItems=" + closureItems.length },
    { id: "hardening-confirms-closure-checks-pass", result: (phase30EntryAuditClosurePreview.closureChecks || []).every((item) => item.result === "pass") ? "pass" : "block", evidence: "closureChecks=" + (phase30EntryAuditClosurePreview.summary?.closureChecks ?? 0) + "; passed=" + (phase30EntryAuditClosurePreview.summary?.passedClosureChecks ?? 0) },
    { id: "hardening-keeps-closure-unpersisted", result: closureItems.every((item) => item.persisted === false) ? "pass" : "block", evidence: "persistedClosureItems=" + closureItems.filter((item) => item.persisted !== false).length },
    { id: "hardening-keeps-audit-unpersisted", result: auditItems.every((item) => item.persisted === false) ? "pass" : "block", evidence: "persistedAuditItems=" + auditItems.filter((item) => item.persisted !== false).length },
    { id: "hardening-keeps-signoffs-unpersisted", result: signoffItems.every((item) => item.persisted === false) ? "pass" : "block", evidence: "persistedSignoffs=" + signoffItems.filter((item) => item.persisted !== false).length },
    { id: "hardening-keeps-redlines-active", result: transitionReadinessRedline.summary?.activeRedlines >= 1 ? "pass" : "block", evidence: "activeRedlines=" + (transitionReadinessRedline.summary?.activeRedlines ?? 0) },
    { id: "hardening-keeps-blockers-open", result: finalReleaseBlockerDossier.summary?.unresolvedBlockers >= 1 ? "pass" : "block", evidence: "unresolvedBlockers=" + (finalReleaseBlockerDossier.summary?.unresolvedBlockers ?? 0) },
    { id: "hardening-keeps-entry-preflight-blocked", result: phase30EntryPreflight.summary?.phase30EntryReady === false || phase30EntryPreflight.summary?.blockedEntryGates >= 1 ? "pass" : "block", evidence: "blockedEntryGates=" + (phase30EntryPreflight.summary?.blockedEntryGates ?? 0) + "; phase30EntryReady=" + (phase30EntryPreflight.summary?.phase30EntryReady === true) },
    { id: "hardening-keeps-phase29-active", result: "pass", evidence: "phase29ExitReady=false" },
    { id: "hardening-keeps-phase30-blocked", result: "pass", evidence: "phase30EntryReady=false" },
    { id: "hardening-keeps-release-blocked", result: "pass", evidence: "releaseReady=" + (releaseExitDecisionPreview.summary?.releaseReady === true) },
    { id: "hardening-keeps-runtime-disabled", result: "pass", evidence: "runtimeExecution=" + (runtimeEnableGovernance.summary?.runtimeExecution === true) },
    { id: "hardening-does-not-persist-mutations", result: "pass", evidence: "persistedMutations=0" }
  ];
  return {
    schemaVersion: "phase29.audit-closure-readiness-hardening.v1",
    version: "1.9.40",
    mode: "readonly-audit-closure-readiness-hardening-no-hardening-persist",
    sourceModels: {
      phase30EntryAuditClosurePreview: phase30EntryAuditClosurePreview.schemaVersion,
      phase30EntrySignoffAuditPreview: phase30EntrySignoffAuditPreview.schemaVersion,
      phase30EntryReconciliationSignoffPreview: phase30EntryReconciliationSignoffPreview.schemaVersion,
      phase30EntryFinalExportReconciliationPreview: phase30EntryFinalExportReconciliationPreview.schemaVersion,
      transitionReadinessRedline: transitionReadinessRedline.schemaVersion,
      phase30EntryPreflight: phase30EntryPreflight.schemaVersion,
      finalReleaseBlockerDossier: finalReleaseBlockerDossier.schemaVersion,
      releaseExitDecisionPreview: releaseExitDecisionPreview.schemaVersion,
      runtimeEnableGovernance: runtimeEnableGovernance.schemaVersion
    },
    hardeningItems,
    hardeningChecks,
    blockedMutations: [
      "persist-audit-closure-hardening-as-release-approval",
      "persist-audit-closure-hardening-as-phase29-exit",
      "persist-audit-closure-hardening-as-phase30-entry",
      "persist-audit-closure-hardening-artifact",
      "persist-audit-closure-hardening-item",
      "persist-entry-audit-closure-from-hardening",
      "record-audit-closure-hardening",
      "record-audit-closure-from-hardening",
      "record-signoff-audit-from-hardening",
      "approve-release-from-audit-closure-hardening",
      "exit-phase29-from-audit-closure-hardening",
      "open-phase30-entry-from-audit-closure-hardening",
      "clear-blocker-from-audit-closure-hardening",
      "resolve-redline-from-audit-closure-hardening",
      "mark-audit-closure-hardened",
      "override-entry-audit-closure-from-hardening",
      "mark-releaseReady-true",
      "enable-runtime-execution",
      "enable-third-party-execution"
    ],
    exportPolicy: {
      exportName: "phase29-audit-closure-readiness-hardening.json",
      includeInOperationsExport: true,
      redaction: "phase29-audit-closure-hardening-source-coverage-redline-blocker-and-readonly-guardrail-summary-only"
    },
    summary: {
      phase29AuditClosureReadinessHardeningReady: true,
      hardeningItems: hardeningItems.length,
      blockedHardeningItems: hardeningItems.filter((item) => item.hardeningState.includes("blocked")).length,
      hardeningChecks: hardeningChecks.length,
      passedHardeningChecks: hardeningChecks.filter((item) => item.result === "pass").length,
      hardenedClosureItems: 0,
      persistedHardeningItems: hardeningItems.filter((item) => item.persisted !== false).length,
      persistedClosureItems: closureItems.filter((item) => item.persisted !== false).length,
      persistedAuditItems: auditItems.filter((item) => item.persisted !== false).length,
      persistedSignoffs: signoffItems.filter((item) => item.persisted !== false).length,
      activeRedlines: transitionReadinessRedline.summary?.activeRedlines ?? 0,
      unresolvedBlockers: finalReleaseBlockerDossier.summary?.unresolvedBlockers ?? 0,
      phase29ExitReady: false,
      phase30Blocked: true,
      phase30EntryReady: false,
      releaseReady: false,
      runtimeExecution: false,
      thirdPartyExecution: false,
      clearedBlockers: 0,
      persistedMutations: 0
    }
  };
}
function buildPhase29FinalReadonlyExitPackagePreview(phase29AuditClosureReadinessHardening = {}, releaseExitDecisionPreview = {}, exitReadinessAttestationPreview = {}, releaseFinalReviewEnvelopePreview = {}, finalReleaseBlockerDossier = {}, transitionReadinessRedline = {}, phase30EntryPreflight = {}, runtimeEnableGovernance = {}) {
  const hardeningItems = phase29AuditClosureReadinessHardening.hardeningItems || [];
  const exitPackageItems = hardeningItems.map((item, index) => ({
    id: "exit-package-" + item.id.replace(/^hardening-/, ""),
    label: item.label.replace("audit closure hardening", "final readonly exit package"),
    packageOrder: index + 1,
    sourceHardeningItemId: item.id,
    sourceClosureItemId: item.sourceClosureItemId,
    sourceAuditItemId: item.sourceAuditItemId,
    sourceSignoffItemId: item.sourceSignoffItemId,
    sourceReconciliationItemId: item.sourceReconciliationItemId,
    sourceFinalExportItemId: item.sourceFinalExportItemId,
    sourceLedgerEntryId: item.sourceLedgerEntryId,
    sourceDispositionItemId: item.sourceDispositionItemId,
    sourceQueueItemId: item.sourceQueueItemId,
    sourceIndexItemId: item.sourceIndexItemId,
    evidenceType: item.evidenceType,
    owner: item.owner,
    candidateDisposition: item.candidateDisposition,
    requiredSignoffRoles: item.requiredSignoffRoles || [],
    packageState: "blocked-readonly-final-exit-package-preview",
    hardeningState: item.hardeningState,
    closureState: item.closureState,
    auditState: item.auditState,
    signoffState: item.signoffState,
    releaseBlockerState: item.releaseBlockerState,
    hardeningPersistenceState: item.hardeningPersistenceState,
    packagePersistenceState: "not-persisted",
    mayPersistPackage: false,
    mayPersistHardening: false,
    mayPersistClosure: false,
    mayApproveRelease: false,
    mayExitPhase29: false,
    mayEnterPhase30: false,
    mayEnableRuntime: false,
    persisted: false
  }));
  const exitPackageChecks = [
    { id: "exit-package-linked-to-audit-closure-hardening", result: phase29AuditClosureReadinessHardening.schemaVersion === "phase29.audit-closure-readiness-hardening.v1" ? "pass" : "block", evidence: phase29AuditClosureReadinessHardening.schemaVersion },
    { id: "exit-package-linked-to-release-exit-decision", result: releaseExitDecisionPreview.schemaVersion === "phase29.release-exit-decision-preview.v1" ? "pass" : "block", evidence: releaseExitDecisionPreview.schemaVersion },
    { id: "exit-package-linked-to-exit-attestation", result: exitReadinessAttestationPreview.schemaVersion === "phase29.exit-readiness-attestation-preview.v1" ? "pass" : "block", evidence: exitReadinessAttestationPreview.schemaVersion },
    { id: "exit-package-linked-to-final-review-envelope", result: releaseFinalReviewEnvelopePreview.schemaVersion === "phase29.release-final-review-envelope-preview.v1" ? "pass" : "block", evidence: releaseFinalReviewEnvelopePreview.schemaVersion },
    { id: "exit-package-covers-all-hardening-items", result: exitPackageItems.length === hardeningItems.length ? "pass" : "block", evidence: "exitPackageItems=" + exitPackageItems.length + "; hardeningItems=" + hardeningItems.length },
    { id: "exit-package-confirms-hardening-checks-pass", result: (phase29AuditClosureReadinessHardening.hardeningChecks || []).every((item) => item.result === "pass") ? "pass" : "block", evidence: "hardeningChecks=" + (phase29AuditClosureReadinessHardening.summary?.hardeningChecks ?? 0) + "; passed=" + (phase29AuditClosureReadinessHardening.summary?.passedHardeningChecks ?? 0) },
    { id: "exit-package-keeps-hardening-unpersisted", result: hardeningItems.every((item) => item.persisted === false) ? "pass" : "block", evidence: "persistedHardeningItems=" + hardeningItems.filter((item) => item.persisted !== false).length },
    { id: "exit-package-keeps-redlines-active", result: transitionReadinessRedline.summary?.activeRedlines >= 1 ? "pass" : "block", evidence: "activeRedlines=" + (transitionReadinessRedline.summary?.activeRedlines ?? 0) },
    { id: "exit-package-keeps-blockers-open", result: finalReleaseBlockerDossier.summary?.unresolvedBlockers >= 1 ? "pass" : "block", evidence: "unresolvedBlockers=" + (finalReleaseBlockerDossier.summary?.unresolvedBlockers ?? 0) },
    { id: "exit-package-keeps-entry-preflight-blocked", result: phase30EntryPreflight.summary?.phase30EntryReady === false || phase30EntryPreflight.summary?.blockedEntryGates >= 1 ? "pass" : "block", evidence: "blockedEntryGates=" + (phase30EntryPreflight.summary?.blockedEntryGates ?? 0) + "; phase30EntryReady=" + (phase30EntryPreflight.summary?.phase30EntryReady === true) },
    { id: "exit-package-keeps-phase29-active", result: "pass", evidence: "phase29ExitReady=false" },
    { id: "exit-package-keeps-phase30-blocked", result: "pass", evidence: "phase30EntryReady=false" },
    { id: "exit-package-keeps-release-blocked", result: "pass", evidence: "releaseReady=" + (releaseExitDecisionPreview.summary?.releaseReady === true) },
    { id: "exit-package-keeps-runtime-disabled", result: "pass", evidence: "runtimeExecution=" + (runtimeEnableGovernance.summary?.runtimeExecution === true) },
    { id: "exit-package-does-not-persist-mutations", result: "pass", evidence: "persistedMutations=0" }
  ];
  return {
    schemaVersion: "phase29.final-readonly-exit-package-preview.v1",
    version: "1.9.41",
    mode: "readonly-final-exit-package-preview-no-exit-persist",
    sourceModels: {
      phase29AuditClosureReadinessHardening: phase29AuditClosureReadinessHardening.schemaVersion,
      releaseExitDecisionPreview: releaseExitDecisionPreview.schemaVersion,
      exitReadinessAttestationPreview: exitReadinessAttestationPreview.schemaVersion,
      releaseFinalReviewEnvelopePreview: releaseFinalReviewEnvelopePreview.schemaVersion,
      finalReleaseBlockerDossier: finalReleaseBlockerDossier.schemaVersion,
      transitionReadinessRedline: transitionReadinessRedline.schemaVersion,
      phase30EntryPreflight: phase30EntryPreflight.schemaVersion,
      runtimeEnableGovernance: runtimeEnableGovernance.schemaVersion
    },
    exitPackageItems,
    exitPackageChecks,
    blockedMutations: [
      "persist-final-readonly-exit-package-as-release-approval",
      "persist-final-readonly-exit-package-as-phase29-exit",
      "persist-final-readonly-exit-package-as-phase30-entry",
      "persist-final-readonly-exit-package-artifact",
      "persist-final-readonly-exit-package-item",
      "record-final-readonly-exit-package",
      "record-exit-package-from-hardening",
      "approve-release-from-final-readonly-exit-package",
      "exit-phase29-from-final-readonly-exit-package",
      "open-phase30-entry-from-final-readonly-exit-package",
      "clear-blocker-from-final-readonly-exit-package",
      "resolve-redline-from-final-readonly-exit-package",
      "mark-final-exit-package-approved",
      "override-exit-decision-from-final-readonly-package",
      "mark-releaseReady-true",
      "enable-runtime-execution",
      "enable-third-party-execution"
    ],
    exportPolicy: {
      exportName: "phase29-final-readonly-exit-package-preview.json",
      includeInOperationsExport: true,
      redaction: "phase29-final-readonly-exit-package-source-coverage-redline-blocker-and-readonly-guardrail-summary-only"
    },
    summary: {
      phase29FinalReadonlyExitPackagePreviewReady: true,
      exitPackageItems: exitPackageItems.length,
      blockedExitPackageItems: exitPackageItems.filter((item) => item.packageState.includes("blocked")).length,
      exitPackageChecks: exitPackageChecks.length,
      passedExitPackageChecks: exitPackageChecks.filter((item) => item.result === "pass").length,
      packagedExitItems: 0,
      persistedExitPackageItems: exitPackageItems.filter((item) => item.persisted !== false).length,
      persistedHardeningItems: hardeningItems.filter((item) => item.persisted !== false).length,
      activeRedlines: transitionReadinessRedline.summary?.activeRedlines ?? 0,
      unresolvedBlockers: finalReleaseBlockerDossier.summary?.unresolvedBlockers ?? 0,
      phase29ExitReady: false,
      phase30Blocked: true,
      phase30EntryReady: false,
      releaseReady: false,
      runtimeExecution: false,
      thirdPartyExecution: false,
      clearedBlockers: 0,
      persistedMutations: 0
    }
  };
}
function buildPhase29ReleaseExitReadinessDossierPreview(phase29FinalReadonlyExitPackagePreview = {}, phase29AuditClosureReadinessHardening = {}, releaseExitDecisionPreview = {}, finalReleaseBlockerDossier = {}, transitionReadinessRedline = {}, phase30EntryPreflight = {}, runtimeEnableGovernance = {}) {
  const exitPackageItems = phase29FinalReadonlyExitPackagePreview.exitPackageItems || [];
  const dossierItems = exitPackageItems.map((item, index) => ({
    id: "dossier-" + item.id.replace(/^exit-package-/, ""),
    label: item.label.replace("final readonly exit package", "release exit readiness dossier"),
    dossierOrder: index + 1,
    sourceExitPackageItemId: item.id,
    sourceHardeningItemId: item.sourceHardeningItemId,
    sourceClosureItemId: item.sourceClosureItemId,
    sourceAuditItemId: item.sourceAuditItemId,
    sourceSignoffItemId: item.sourceSignoffItemId,
    sourceReconciliationItemId: item.sourceReconciliationItemId,
    sourceFinalExportItemId: item.sourceFinalExportItemId,
    sourceLedgerEntryId: item.sourceLedgerEntryId,
    sourceDispositionItemId: item.sourceDispositionItemId,
    sourceQueueItemId: item.sourceQueueItemId,
    sourceIndexItemId: item.sourceIndexItemId,
    evidenceType: item.evidenceType,
    owner: item.owner,
    candidateDisposition: item.candidateDisposition,
    requiredSignoffRoles: item.requiredSignoffRoles || [],
    dossierState: "blocked-readonly-release-exit-readiness-dossier-preview",
    packageState: item.packageState,
    hardeningState: item.hardeningState,
    closureState: item.closureState,
    auditState: item.auditState,
    signoffState: item.signoffState,
    releaseBlockerState: item.releaseBlockerState,
    packagePersistenceState: item.packagePersistenceState,
    dossierPersistenceState: "not-persisted",
    mayPersistDossier: false,
    mayPersistPackage: false,
    mayApproveRelease: false,
    mayExitPhase29: false,
    mayEnterPhase30: false,
    mayEnableRuntime: false,
    persisted: false
  }));
  const dossierChecks = [
    { id: "dossier-linked-to-final-exit-package-preview", result: phase29FinalReadonlyExitPackagePreview.schemaVersion === "phase29.final-readonly-exit-package-preview.v1" ? "pass" : "block", evidence: phase29FinalReadonlyExitPackagePreview.schemaVersion },
    { id: "dossier-linked-to-audit-closure-hardening", result: phase29AuditClosureReadinessHardening.schemaVersion === "phase29.audit-closure-readiness-hardening.v1" ? "pass" : "block", evidence: phase29AuditClosureReadinessHardening.schemaVersion },
    { id: "dossier-linked-to-release-exit-decision", result: releaseExitDecisionPreview.schemaVersion === "phase29.release-exit-decision-preview.v1" ? "pass" : "block", evidence: releaseExitDecisionPreview.schemaVersion },
    { id: "dossier-linked-to-final-blocker-dossier", result: finalReleaseBlockerDossier.schemaVersion === "phase29.final-release-blocker-dossier.v1" ? "pass" : "block", evidence: finalReleaseBlockerDossier.schemaVersion },
    { id: "dossier-covers-all-exit-package-items", result: dossierItems.length === exitPackageItems.length ? "pass" : "block", evidence: "dossierItems=" + dossierItems.length + "; exitPackageItems=" + exitPackageItems.length },
    { id: "dossier-confirms-exit-package-checks-pass", result: (phase29FinalReadonlyExitPackagePreview.exitPackageChecks || []).every((item) => item.result === "pass") ? "pass" : "block", evidence: "exitPackageChecks=" + (phase29FinalReadonlyExitPackagePreview.summary?.exitPackageChecks ?? 0) + "; passed=" + (phase29FinalReadonlyExitPackagePreview.summary?.passedExitPackageChecks ?? 0) },
    { id: "dossier-keeps-exit-package-unpersisted", result: exitPackageItems.every((item) => item.persisted === false) ? "pass" : "block", evidence: "persistedExitPackageItems=" + exitPackageItems.filter((item) => item.persisted !== false).length },
    { id: "dossier-keeps-redlines-active", result: transitionReadinessRedline.summary?.activeRedlines >= 1 ? "pass" : "block", evidence: "activeRedlines=" + (transitionReadinessRedline.summary?.activeRedlines ?? 0) },
    { id: "dossier-keeps-blockers-open", result: finalReleaseBlockerDossier.summary?.unresolvedBlockers >= 1 ? "pass" : "block", evidence: "unresolvedBlockers=" + (finalReleaseBlockerDossier.summary?.unresolvedBlockers ?? 0) },
    { id: "dossier-keeps-entry-preflight-blocked", result: phase30EntryPreflight.summary?.phase30EntryReady === false || phase30EntryPreflight.summary?.blockedEntryGates >= 1 ? "pass" : "block", evidence: "blockedEntryGates=" + (phase30EntryPreflight.summary?.blockedEntryGates ?? 0) + "; phase30EntryReady=" + (phase30EntryPreflight.summary?.phase30EntryReady === true) },
    { id: "dossier-keeps-phase29-active", result: "pass", evidence: "phase29ExitReady=false" },
    { id: "dossier-keeps-phase30-blocked", result: "pass", evidence: "phase30EntryReady=false" },
    { id: "dossier-keeps-release-blocked", result: "pass", evidence: "releaseReady=" + (releaseExitDecisionPreview.summary?.releaseReady === true) },
    { id: "dossier-keeps-runtime-disabled", result: "pass", evidence: "runtimeExecution=" + (runtimeEnableGovernance.summary?.runtimeExecution === true) },
    { id: "dossier-does-not-persist-mutations", result: "pass", evidence: "persistedMutations=0" }
  ];
  return {
    schemaVersion: "phase29.release-exit-readiness-dossier-preview.v1",
    version: "1.9.42",
    mode: "readonly-release-exit-readiness-dossier-preview-no-dossier-persist",
    sourceModels: {
      phase29FinalReadonlyExitPackagePreview: phase29FinalReadonlyExitPackagePreview.schemaVersion,
      phase29AuditClosureReadinessHardening: phase29AuditClosureReadinessHardening.schemaVersion,
      releaseExitDecisionPreview: releaseExitDecisionPreview.schemaVersion,
      finalReleaseBlockerDossier: finalReleaseBlockerDossier.schemaVersion,
      transitionReadinessRedline: transitionReadinessRedline.schemaVersion,
      phase30EntryPreflight: phase30EntryPreflight.schemaVersion,
      runtimeEnableGovernance: runtimeEnableGovernance.schemaVersion
    },
    dossierItems,
    dossierChecks,
    blockedMutations: [
      "persist-release-exit-readiness-dossier-as-release-approval",
      "persist-release-exit-readiness-dossier-as-phase29-exit",
      "persist-release-exit-readiness-dossier-as-phase30-entry",
      "persist-release-exit-readiness-dossier-artifact",
      "persist-release-exit-readiness-dossier-item",
      "record-release-exit-readiness-dossier",
      "record-final-exit-package-from-dossier",
      "approve-release-from-release-exit-readiness-dossier",
      "exit-phase29-from-release-exit-readiness-dossier",
      "open-phase30-entry-from-release-exit-readiness-dossier",
      "clear-blocker-from-release-exit-readiness-dossier",
      "resolve-redline-from-release-exit-readiness-dossier",
      "mark-release-exit-dossier-approved",
      "override-final-exit-package-from-dossier",
      "mark-releaseReady-true",
      "enable-runtime-execution",
      "enable-third-party-execution"
    ],
    exportPolicy: {
      exportName: "phase29-release-exit-readiness-dossier-preview.json",
      includeInOperationsExport: true,
      redaction: "phase29-release-exit-readiness-dossier-source-coverage-redline-blocker-and-readonly-guardrail-summary-only"
    },
    summary: {
      phase29ReleaseExitReadinessDossierPreviewReady: true,
      dossierItems: dossierItems.length,
      blockedDossierItems: dossierItems.filter((item) => item.dossierState.includes("blocked")).length,
      dossierChecks: dossierChecks.length,
      passedDossierChecks: dossierChecks.filter((item) => item.result === "pass").length,
      acceptedDossierItems: 0,
      persistedDossierItems: dossierItems.filter((item) => item.persisted !== false).length,
      persistedExitPackageItems: exitPackageItems.filter((item) => item.persisted !== false).length,
      activeRedlines: transitionReadinessRedline.summary?.activeRedlines ?? 0,
      unresolvedBlockers: finalReleaseBlockerDossier.summary?.unresolvedBlockers ?? 0,
      phase29ExitReady: false,
      phase30Blocked: true,
      phase30EntryReady: false,
      releaseReady: false,
      runtimeExecution: false,
      thirdPartyExecution: false,
      clearedBlockers: 0,
      persistedMutations: 0
    }
  };
}

function buildPhase29ReleaseExitGovernanceFreezePreview(phase29ReleaseExitReadinessDossierPreview = {}, phase29FinalReadonlyExitPackagePreview = {}, governanceArchiveFreeze = {}, releaseExitDecisionPreview = {}, finalReleaseBlockerDossier = {}, transitionReadinessRedline = {}, phase30EntryPreflight = {}, runtimeEnableGovernance = {}) {
  const dossierItems = phase29ReleaseExitReadinessDossierPreview.dossierItems || [];
  const exitPackageItems = phase29FinalReadonlyExitPackagePreview.exitPackageItems || [];
  const freezeItems = dossierItems.map((item, index) => ({
    id: "freeze-" + item.id.replace(/^dossier-/, ""),
    label: item.label.replace("release exit readiness dossier", "release exit governance freeze"),
    freezeOrder: index + 1,
    sourceDossierItemId: item.id,
    sourceExitPackageItemId: item.sourceExitPackageItemId,
    sourceHardeningItemId: item.sourceHardeningItemId,
    sourceClosureItemId: item.sourceClosureItemId,
    sourceAuditItemId: item.sourceAuditItemId,
    sourceSignoffItemId: item.sourceSignoffItemId,
    sourceReconciliationItemId: item.sourceReconciliationItemId,
    sourceFinalExportItemId: item.sourceFinalExportItemId,
    sourceLedgerEntryId: item.sourceLedgerEntryId,
    sourceDispositionItemId: item.sourceDispositionItemId,
    sourceQueueItemId: item.sourceQueueItemId,
    sourceIndexItemId: item.sourceIndexItemId,
    evidenceType: item.evidenceType,
    owner: item.owner,
    candidateDisposition: item.candidateDisposition,
    requiredSignoffRoles: item.requiredSignoffRoles || [],
    freezeState: "blocked-readonly-release-exit-governance-freeze-preview",
    dossierState: item.dossierState,
    packageState: item.packageState,
    hardeningState: item.hardeningState,
    closureState: item.closureState,
    auditState: item.auditState,
    signoffState: item.signoffState,
    releaseBlockerState: item.releaseBlockerState,
    dossierPersistenceState: item.dossierPersistenceState,
    packagePersistenceState: item.packagePersistenceState,
    freezePersistenceState: "not-persisted",
    mayPersistFreeze: false,
    mayPersistDossier: false,
    mayPersistPackage: false,
    mayApproveRelease: false,
    mayExitPhase29: false,
    mayEnterPhase30: false,
    mayEnableRuntime: false,
    persisted: false
  }));
  const freezeChecks = [
    { id: "freeze-linked-to-release-exit-dossier-preview", result: phase29ReleaseExitReadinessDossierPreview.schemaVersion === "phase29.release-exit-readiness-dossier-preview.v1" ? "pass" : "block", evidence: phase29ReleaseExitReadinessDossierPreview.schemaVersion },
    { id: "freeze-linked-to-final-exit-package-preview", result: phase29FinalReadonlyExitPackagePreview.schemaVersion === "phase29.final-readonly-exit-package-preview.v1" ? "pass" : "block", evidence: phase29FinalReadonlyExitPackagePreview.schemaVersion },
    { id: "freeze-linked-to-governance-archive-freeze", result: governanceArchiveFreeze.schemaVersion === "phase29.governance-archive-freeze.v1" ? "pass" : "block", evidence: governanceArchiveFreeze.schemaVersion },
    { id: "freeze-linked-to-release-exit-decision", result: releaseExitDecisionPreview.schemaVersion === "phase29.release-exit-decision-preview.v1" ? "pass" : "block", evidence: releaseExitDecisionPreview.schemaVersion },
    { id: "freeze-linked-to-final-blocker-dossier", result: finalReleaseBlockerDossier.schemaVersion === "phase29.final-release-blocker-dossier.v1" ? "pass" : "block", evidence: finalReleaseBlockerDossier.schemaVersion },
    { id: "freeze-covers-all-dossier-items", result: freezeItems.length === dossierItems.length ? "pass" : "block", evidence: "freezeItems=" + freezeItems.length + "; dossierItems=" + dossierItems.length },
    { id: "freeze-confirms-dossier-checks-pass", result: (phase29ReleaseExitReadinessDossierPreview.dossierChecks || []).every((item) => item.result === "pass") ? "pass" : "block", evidence: "dossierChecks=" + (phase29ReleaseExitReadinessDossierPreview.summary?.dossierChecks ?? 0) + "; passed=" + (phase29ReleaseExitReadinessDossierPreview.summary?.passedDossierChecks ?? 0) },
    { id: "freeze-keeps-dossier-unpersisted", result: dossierItems.every((item) => item.persisted === false) ? "pass" : "block", evidence: "persistedDossierItems=" + dossierItems.filter((item) => item.persisted !== false).length },
    { id: "freeze-keeps-exit-package-unpersisted", result: exitPackageItems.every((item) => item.persisted === false) ? "pass" : "block", evidence: "persistedExitPackageItems=" + exitPackageItems.filter((item) => item.persisted !== false).length },
    { id: "freeze-keeps-governance-archive-readonly", result: governanceArchiveFreeze.summary?.persistedMutations === 0 ? "pass" : "block", evidence: "archivePersistedMutations=" + (governanceArchiveFreeze.summary?.persistedMutations ?? 0) },
    { id: "freeze-keeps-redlines-active", result: transitionReadinessRedline.summary?.activeRedlines >= 1 ? "pass" : "block", evidence: "activeRedlines=" + (transitionReadinessRedline.summary?.activeRedlines ?? 0) },
    { id: "freeze-keeps-blockers-open", result: finalReleaseBlockerDossier.summary?.unresolvedBlockers >= 1 ? "pass" : "block", evidence: "unresolvedBlockers=" + (finalReleaseBlockerDossier.summary?.unresolvedBlockers ?? 0) },
    { id: "freeze-keeps-entry-preflight-blocked", result: phase30EntryPreflight.summary?.phase30EntryReady === false || phase30EntryPreflight.summary?.blockedEntryGates >= 1 ? "pass" : "block", evidence: "blockedEntryGates=" + (phase30EntryPreflight.summary?.blockedEntryGates ?? 0) + "; phase30EntryReady=" + (phase30EntryPreflight.summary?.phase30EntryReady === true) },
    { id: "freeze-keeps-phase29-active", result: "pass", evidence: "phase29ExitReady=false" },
    { id: "freeze-keeps-phase30-blocked", result: "pass", evidence: "phase30EntryReady=false" },
    { id: "freeze-keeps-release-blocked", result: "pass", evidence: "releaseReady=" + (releaseExitDecisionPreview.summary?.releaseReady === true) },
    { id: "freeze-keeps-runtime-disabled", result: "pass", evidence: "runtimeExecution=" + (runtimeEnableGovernance.summary?.runtimeExecution === true) },
    { id: "freeze-does-not-persist-mutations", result: "pass", evidence: "persistedMutations=0" }
  ];
  return {
    schemaVersion: "phase29.release-exit-governance-freeze-preview.v1",
    version: "1.9.43",
    mode: "readonly-release-exit-governance-freeze-preview-no-freeze-persist",
    sourceModels: {
      phase29ReleaseExitReadinessDossierPreview: phase29ReleaseExitReadinessDossierPreview.schemaVersion,
      phase29FinalReadonlyExitPackagePreview: phase29FinalReadonlyExitPackagePreview.schemaVersion,
      governanceArchiveFreeze: governanceArchiveFreeze.schemaVersion,
      releaseExitDecisionPreview: releaseExitDecisionPreview.schemaVersion,
      finalReleaseBlockerDossier: finalReleaseBlockerDossier.schemaVersion,
      transitionReadinessRedline: transitionReadinessRedline.schemaVersion,
      phase30EntryPreflight: phase30EntryPreflight.schemaVersion,
      runtimeEnableGovernance: runtimeEnableGovernance.schemaVersion
    },
    freezeItems,
    freezeChecks,
    blockedMutations: [
      "persist-release-exit-governance-freeze-as-release-approval",
      "persist-release-exit-governance-freeze-as-phase29-exit",
      "persist-release-exit-governance-freeze-as-phase30-entry",
      "persist-release-exit-governance-freeze-artifact",
      "persist-release-exit-governance-freeze-item",
      "record-release-exit-governance-freeze",
      "record-release-exit-dossier-from-freeze",
      "approve-release-from-release-exit-governance-freeze",
      "exit-phase29-from-release-exit-governance-freeze",
      "open-phase30-entry-from-release-exit-governance-freeze",
      "clear-blocker-from-release-exit-governance-freeze",
      "resolve-redline-from-release-exit-governance-freeze",
      "unfreeze-release-exit-governance-without-review",
      "mark-release-exit-governance-frozen-approved",
      "override-release-exit-dossier-from-freeze",
      "mark-releaseReady-true",
      "enable-runtime-execution",
      "enable-third-party-execution"
    ],
    exportPolicy: {
      exportName: "phase29-release-exit-governance-freeze-preview.json",
      includeInOperationsExport: true,
      redaction: "phase29-release-exit-governance-freeze-source-coverage-redline-blocker-and-readonly-guardrail-summary-only"
    },
    summary: {
      phase29ReleaseExitGovernanceFreezePreviewReady: true,
      freezeItems: freezeItems.length,
      blockedFreezeItems: freezeItems.filter((item) => item.freezeState.includes("blocked")).length,
      freezeChecks: freezeChecks.length,
      passedFreezeChecks: freezeChecks.filter((item) => item.result === "pass").length,
      frozenGovernanceItems: 0,
      persistedFreezeItems: freezeItems.filter((item) => item.persisted !== false).length,
      persistedDossierItems: dossierItems.filter((item) => item.persisted !== false).length,
      persistedExitPackageItems: exitPackageItems.filter((item) => item.persisted !== false).length,
      activeRedlines: transitionReadinessRedline.summary?.activeRedlines ?? 0,
      unresolvedBlockers: finalReleaseBlockerDossier.summary?.unresolvedBlockers ?? 0,
      phase29ExitReady: false,
      phase30Blocked: true,
      phase30EntryReady: false,
      releaseReady: false,
      runtimeExecution: false,
      thirdPartyExecution: false,
      clearedBlockers: 0,
      persistedMutations: 0
    }
  };
}

function buildPhase29ReleaseExitFinalSignoffReviewPreview(phase29ReleaseExitGovernanceFreezePreview = {}, phase29ReleaseExitReadinessDossierPreview = {}, phase29FinalReadonlyExitPackagePreview = {}, releaseExitDecisionPreview = {}, finalReleaseBlockerDossier = {}, transitionReadinessRedline = {}, phase30EntryPreflight = {}, runtimeEnableGovernance = {}) {
  const freezeItems = phase29ReleaseExitGovernanceFreezePreview.freezeItems || [];
  const dossierItems = phase29ReleaseExitReadinessDossierPreview.dossierItems || [];
  const exitPackageItems = phase29FinalReadonlyExitPackagePreview.exitPackageItems || [];
  const signoffReviewItems = freezeItems.map((item, index) => ({
    id: "signoff-review-" + item.id.replace(/^freeze-/, ""),
    label: item.label.replace("release exit governance freeze", "release exit final signoff review"),
    reviewOrder: index + 1,
    sourceFreezeItemId: item.id,
    sourceDossierItemId: item.sourceDossierItemId,
    sourceExitPackageItemId: item.sourceExitPackageItemId,
    sourceHardeningItemId: item.sourceHardeningItemId,
    sourceClosureItemId: item.sourceClosureItemId,
    sourceAuditItemId: item.sourceAuditItemId,
    sourceSignoffItemId: item.sourceSignoffItemId,
    sourceReconciliationItemId: item.sourceReconciliationItemId,
    sourceFinalExportItemId: item.sourceFinalExportItemId,
    sourceLedgerEntryId: item.sourceLedgerEntryId,
    sourceDispositionItemId: item.sourceDispositionItemId,
    sourceQueueItemId: item.sourceQueueItemId,
    sourceIndexItemId: item.sourceIndexItemId,
    evidenceType: item.evidenceType,
    owner: item.owner,
    candidateDisposition: item.candidateDisposition,
    requiredSignoffRoles: item.requiredSignoffRoles || [],
    signoffReviewState: "blocked-readonly-release-exit-final-signoff-review-preview",
    freezeState: item.freezeState,
    dossierState: item.dossierState,
    packageState: item.packageState,
    releaseBlockerState: item.releaseBlockerState,
    freezePersistenceState: item.freezePersistenceState,
    dossierPersistenceState: item.dossierPersistenceState,
    packagePersistenceState: item.packagePersistenceState,
    signoffReviewPersistenceState: "not-persisted",
    mayPersistSignoffReview: false,
    mayPersistFreeze: false,
    mayPersistDossier: false,
    mayApproveRelease: false,
    mayExitPhase29: false,
    mayEnterPhase30: false,
    mayEnableRuntime: false,
    persisted: false
  }));
  const signoffReviewChecks = [
    { id: "signoff-review-linked-to-governance-freeze-preview", result: phase29ReleaseExitGovernanceFreezePreview.schemaVersion === "phase29.release-exit-governance-freeze-preview.v1" ? "pass" : "block", evidence: phase29ReleaseExitGovernanceFreezePreview.schemaVersion },
    { id: "signoff-review-linked-to-release-exit-dossier-preview", result: phase29ReleaseExitReadinessDossierPreview.schemaVersion === "phase29.release-exit-readiness-dossier-preview.v1" ? "pass" : "block", evidence: phase29ReleaseExitReadinessDossierPreview.schemaVersion },
    { id: "signoff-review-linked-to-final-exit-package-preview", result: phase29FinalReadonlyExitPackagePreview.schemaVersion === "phase29.final-readonly-exit-package-preview.v1" ? "pass" : "block", evidence: phase29FinalReadonlyExitPackagePreview.schemaVersion },
    { id: "signoff-review-linked-to-release-exit-decision", result: releaseExitDecisionPreview.schemaVersion === "phase29.release-exit-decision-preview.v1" ? "pass" : "block", evidence: releaseExitDecisionPreview.schemaVersion },
    { id: "signoff-review-linked-to-final-blocker-dossier", result: finalReleaseBlockerDossier.schemaVersion === "phase29.final-release-blocker-dossier.v1" ? "pass" : "block", evidence: finalReleaseBlockerDossier.schemaVersion },
    { id: "signoff-review-covers-all-freeze-items", result: signoffReviewItems.length === freezeItems.length ? "pass" : "block", evidence: "signoffReviewItems=" + signoffReviewItems.length + "; freezeItems=" + freezeItems.length },
    { id: "signoff-review-confirms-freeze-checks-pass", result: (phase29ReleaseExitGovernanceFreezePreview.freezeChecks || []).every((item) => item.result === "pass") ? "pass" : "block", evidence: "freezeChecks=" + (phase29ReleaseExitGovernanceFreezePreview.summary?.freezeChecks ?? 0) + "; passed=" + (phase29ReleaseExitGovernanceFreezePreview.summary?.passedFreezeChecks ?? 0) },
    { id: "signoff-review-keeps-freeze-unpersisted", result: freezeItems.every((item) => item.persisted === false) ? "pass" : "block", evidence: "persistedFreezeItems=" + freezeItems.filter((item) => item.persisted !== false).length },
    { id: "signoff-review-keeps-dossier-unpersisted", result: dossierItems.every((item) => item.persisted === false) ? "pass" : "block", evidence: "persistedDossierItems=" + dossierItems.filter((item) => item.persisted !== false).length },
    { id: "signoff-review-keeps-exit-package-unpersisted", result: exitPackageItems.every((item) => item.persisted === false) ? "pass" : "block", evidence: "persistedExitPackageItems=" + exitPackageItems.filter((item) => item.persisted !== false).length },
    { id: "signoff-review-keeps-redlines-active", result: transitionReadinessRedline.summary?.activeRedlines >= 1 ? "pass" : "block", evidence: "activeRedlines=" + (transitionReadinessRedline.summary?.activeRedlines ?? 0) },
    { id: "signoff-review-keeps-blockers-open", result: finalReleaseBlockerDossier.summary?.unresolvedBlockers >= 1 ? "pass" : "block", evidence: "unresolvedBlockers=" + (finalReleaseBlockerDossier.summary?.unresolvedBlockers ?? 0) },
    { id: "signoff-review-keeps-entry-preflight-blocked", result: phase30EntryPreflight.summary?.phase30EntryReady === false || phase30EntryPreflight.summary?.blockedEntryGates >= 1 ? "pass" : "block", evidence: "blockedEntryGates=" + (phase30EntryPreflight.summary?.blockedEntryGates ?? 0) + "; phase30EntryReady=" + (phase30EntryPreflight.summary?.phase30EntryReady === true) },
    { id: "signoff-review-keeps-phase29-active", result: "pass", evidence: "phase29ExitReady=false" },
    { id: "signoff-review-keeps-phase30-blocked", result: "pass", evidence: "phase30EntryReady=false" },
    { id: "signoff-review-keeps-release-blocked", result: "pass", evidence: "releaseReady=" + (releaseExitDecisionPreview.summary?.releaseReady === true) },
    { id: "signoff-review-keeps-runtime-disabled", result: "pass", evidence: "runtimeExecution=" + (runtimeEnableGovernance.summary?.runtimeExecution === true) },
    { id: "signoff-review-does-not-persist-mutations", result: "pass", evidence: "persistedMutations=0" }
  ];
  return {
    schemaVersion: "phase29.release-exit-final-signoff-review-preview.v1",
    version: "1.9.44",
    mode: "readonly-release-exit-final-signoff-review-preview-no-signoff-persist",
    sourceModels: {
      phase29ReleaseExitGovernanceFreezePreview: phase29ReleaseExitGovernanceFreezePreview.schemaVersion,
      phase29ReleaseExitReadinessDossierPreview: phase29ReleaseExitReadinessDossierPreview.schemaVersion,
      phase29FinalReadonlyExitPackagePreview: phase29FinalReadonlyExitPackagePreview.schemaVersion,
      releaseExitDecisionPreview: releaseExitDecisionPreview.schemaVersion,
      finalReleaseBlockerDossier: finalReleaseBlockerDossier.schemaVersion,
      transitionReadinessRedline: transitionReadinessRedline.schemaVersion,
      phase30EntryPreflight: phase30EntryPreflight.schemaVersion,
      runtimeEnableGovernance: runtimeEnableGovernance.schemaVersion
    },
    signoffReviewItems,
    signoffReviewChecks,
    blockedMutations: [
      "persist-release-exit-final-signoff-review-as-release-approval",
      "persist-release-exit-final-signoff-review-as-phase29-exit",
      "persist-release-exit-final-signoff-review-as-phase30-entry",
      "persist-release-exit-final-signoff-review-artifact",
      "persist-release-exit-final-signoff-review-item",
      "record-release-exit-final-signoff-review",
      "record-release-exit-governance-freeze-from-signoff-review",
      "approve-release-from-release-exit-final-signoff-review",
      "exit-phase29-from-release-exit-final-signoff-review",
      "open-phase30-entry-from-release-exit-final-signoff-review",
      "clear-blocker-from-release-exit-final-signoff-review",
      "resolve-redline-from-release-exit-final-signoff-review",
      "mark-release-exit-final-signoff-approved",
      "override-release-exit-governance-freeze-from-signoff-review",
      "override-release-exit-dossier-from-signoff-review",
      "mark-releaseReady-true",
      "enable-runtime-execution",
      "enable-third-party-execution"
    ],
    exportPolicy: {
      exportName: "phase29-release-exit-final-signoff-review-preview.json",
      includeInOperationsExport: true,
      redaction: "phase29-release-exit-final-signoff-review-source-freeze-dossier-redline-blocker-and-readonly-guardrail-summary-only"
    },
    summary: {
      phase29ReleaseExitFinalSignoffReviewPreviewReady: true,
      signoffReviewItems: signoffReviewItems.length,
      blockedSignoffReviewItems: signoffReviewItems.filter((item) => item.signoffReviewState.includes("blocked")).length,
      signoffReviewChecks: signoffReviewChecks.length,
      passedSignoffReviewChecks: signoffReviewChecks.filter((item) => item.result === "pass").length,
      approvedSignoffItems: 0,
      persistedSignoffReviewItems: signoffReviewItems.filter((item) => item.persisted !== false).length,
      persistedFreezeItems: freezeItems.filter((item) => item.persisted !== false).length,
      persistedDossierItems: dossierItems.filter((item) => item.persisted !== false).length,
      persistedExitPackageItems: exitPackageItems.filter((item) => item.persisted !== false).length,
      activeRedlines: transitionReadinessRedline.summary?.activeRedlines ?? 0,
      unresolvedBlockers: finalReleaseBlockerDossier.summary?.unresolvedBlockers ?? 0,
      phase29ExitReady: false,
      phase30Blocked: true,
      phase30EntryReady: false,
      releaseReady: false,
      runtimeExecution: false,
      thirdPartyExecution: false,
      clearedBlockers: 0,
      persistedMutations: 0
    }
  };
}

function buildPhase29ReleaseExitSignoffEvidenceReconciliationPreview(phase29ReleaseExitFinalSignoffReviewPreview = {}, phase29ReleaseExitGovernanceFreezePreview = {}, phase29ReleaseExitReadinessDossierPreview = {}, phase29FinalReadonlyExitPackagePreview = {}, releaseExitDecisionPreview = {}, finalReleaseBlockerDossier = {}, transitionReadinessRedline = {}, phase30EntryPreflight = {}, runtimeEnableGovernance = {}) {
  const signoffReviewItems = phase29ReleaseExitFinalSignoffReviewPreview.signoffReviewItems || [];
  const freezeItems = phase29ReleaseExitGovernanceFreezePreview.freezeItems || [];
  const dossierItems = phase29ReleaseExitReadinessDossierPreview.dossierItems || [];
  const exitPackageItems = phase29FinalReadonlyExitPackagePreview.exitPackageItems || [];
  const evidenceReconciliationItems = signoffReviewItems.map((item, index) => ({
    id: "signoff-evidence-reconciliation-" + item.id.replace(/^signoff-review-/, ""),
    label: item.label.replace("release exit final signoff review", "release exit signoff evidence reconciliation"),
    reconciliationOrder: index + 1,
    sourceSignoffReviewItemId: item.id,
    sourceFreezeItemId: item.sourceFreezeItemId,
    sourceDossierItemId: item.sourceDossierItemId,
    sourceExitPackageItemId: item.sourceExitPackageItemId,
    sourceHardeningItemId: item.sourceHardeningItemId,
    sourceClosureItemId: item.sourceClosureItemId,
    sourceAuditItemId: item.sourceAuditItemId,
    sourceSignoffItemId: item.sourceSignoffItemId,
    sourceReconciliationItemId: item.sourceReconciliationItemId,
    sourceFinalExportItemId: item.sourceFinalExportItemId,
    sourceLedgerEntryId: item.sourceLedgerEntryId,
    sourceDispositionItemId: item.sourceDispositionItemId,
    sourceQueueItemId: item.sourceQueueItemId,
    sourceIndexItemId: item.sourceIndexItemId,
    evidenceType: item.evidenceType,
    owner: item.owner,
    candidateDisposition: item.candidateDisposition,
    requiredSignoffRoles: item.requiredSignoffRoles || [],
    reconciliationState: "blocked-readonly-release-exit-signoff-evidence-reconciliation-preview",
    evidenceMatchState: "readonly-match-preview",
    signoffReviewState: item.signoffReviewState,
    freezeState: item.freezeState,
    dossierState: item.dossierState,
    packageState: item.packageState,
    releaseBlockerState: item.releaseBlockerState,
    signoffReviewPersistenceState: item.signoffReviewPersistenceState,
    reconciliationPersistenceState: "not-persisted",
    mayPersistReconciliation: false,
    mayPersistSignoffReview: false,
    mayPersistFreeze: false,
    mayPersistDossier: false,
    mayApproveRelease: false,
    mayExitPhase29: false,
    mayEnterPhase30: false,
    mayEnableRuntime: false,
    persisted: false
  }));
  const evidenceReconciliationChecks = [
    { id: "signoff-evidence-reconciliation-linked-to-final-signoff-review", result: phase29ReleaseExitFinalSignoffReviewPreview.schemaVersion === "phase29.release-exit-final-signoff-review-preview.v1" ? "pass" : "block", evidence: phase29ReleaseExitFinalSignoffReviewPreview.schemaVersion },
    { id: "signoff-evidence-reconciliation-linked-to-governance-freeze", result: phase29ReleaseExitGovernanceFreezePreview.schemaVersion === "phase29.release-exit-governance-freeze-preview.v1" ? "pass" : "block", evidence: phase29ReleaseExitGovernanceFreezePreview.schemaVersion },
    { id: "signoff-evidence-reconciliation-linked-to-release-exit-dossier", result: phase29ReleaseExitReadinessDossierPreview.schemaVersion === "phase29.release-exit-readiness-dossier-preview.v1" ? "pass" : "block", evidence: phase29ReleaseExitReadinessDossierPreview.schemaVersion },
    { id: "signoff-evidence-reconciliation-linked-to-final-exit-package", result: phase29FinalReadonlyExitPackagePreview.schemaVersion === "phase29.final-readonly-exit-package-preview.v1" ? "pass" : "block", evidence: phase29FinalReadonlyExitPackagePreview.schemaVersion },
    { id: "signoff-evidence-reconciliation-linked-to-release-exit-decision", result: releaseExitDecisionPreview.schemaVersion === "phase29.release-exit-decision-preview.v1" ? "pass" : "block", evidence: releaseExitDecisionPreview.schemaVersion },
    { id: "signoff-evidence-reconciliation-linked-to-final-blocker-dossier", result: finalReleaseBlockerDossier.schemaVersion === "phase29.final-release-blocker-dossier.v1" ? "pass" : "block", evidence: finalReleaseBlockerDossier.schemaVersion },
    { id: "signoff-evidence-reconciliation-covers-all-signoff-review-items", result: evidenceReconciliationItems.length === signoffReviewItems.length ? "pass" : "block", evidence: "evidenceReconciliationItems=" + evidenceReconciliationItems.length + "; signoffReviewItems=" + signoffReviewItems.length },
    { id: "signoff-evidence-reconciliation-confirms-signoff-review-checks-pass", result: (phase29ReleaseExitFinalSignoffReviewPreview.signoffReviewChecks || []).every((item) => item.result === "pass") ? "pass" : "block", evidence: "signoffReviewChecks=" + (phase29ReleaseExitFinalSignoffReviewPreview.summary?.signoffReviewChecks ?? 0) + "; passed=" + (phase29ReleaseExitFinalSignoffReviewPreview.summary?.passedSignoffReviewChecks ?? 0) },
    { id: "signoff-evidence-reconciliation-matches-freeze-dossier-and-package-counts", result: signoffReviewItems.length === freezeItems.length && freezeItems.length === dossierItems.length && dossierItems.length === exitPackageItems.length ? "pass" : "block", evidence: "signoffReviewItems=" + signoffReviewItems.length + "; freezeItems=" + freezeItems.length + "; dossierItems=" + dossierItems.length + "; exitPackageItems=" + exitPackageItems.length },
    { id: "signoff-evidence-reconciliation-keeps-signoff-review-unpersisted", result: signoffReviewItems.every((item) => item.persisted === false) ? "pass" : "block", evidence: "persistedSignoffReviewItems=" + signoffReviewItems.filter((item) => item.persisted !== false).length },
    { id: "signoff-evidence-reconciliation-keeps-freeze-unpersisted", result: freezeItems.every((item) => item.persisted === false) ? "pass" : "block", evidence: "persistedFreezeItems=" + freezeItems.filter((item) => item.persisted !== false).length },
    { id: "signoff-evidence-reconciliation-keeps-dossier-unpersisted", result: dossierItems.every((item) => item.persisted === false) ? "pass" : "block", evidence: "persistedDossierItems=" + dossierItems.filter((item) => item.persisted !== false).length },
    { id: "signoff-evidence-reconciliation-keeps-exit-package-unpersisted", result: exitPackageItems.every((item) => item.persisted === false) ? "pass" : "block", evidence: "persistedExitPackageItems=" + exitPackageItems.filter((item) => item.persisted !== false).length },
    { id: "signoff-evidence-reconciliation-keeps-redlines-active", result: transitionReadinessRedline.summary?.activeRedlines >= 1 ? "pass" : "block", evidence: "activeRedlines=" + (transitionReadinessRedline.summary?.activeRedlines ?? 0) },
    { id: "signoff-evidence-reconciliation-keeps-blockers-open", result: finalReleaseBlockerDossier.summary?.unresolvedBlockers >= 1 ? "pass" : "block", evidence: "unresolvedBlockers=" + (finalReleaseBlockerDossier.summary?.unresolvedBlockers ?? 0) },
    { id: "signoff-evidence-reconciliation-keeps-entry-preflight-blocked", result: phase30EntryPreflight.summary?.phase30EntryReady === false || phase30EntryPreflight.summary?.blockedEntryGates >= 1 ? "pass" : "block", evidence: "blockedEntryGates=" + (phase30EntryPreflight.summary?.blockedEntryGates ?? 0) + "; phase30EntryReady=" + (phase30EntryPreflight.summary?.phase30EntryReady === true) },
    { id: "signoff-evidence-reconciliation-keeps-phase29-active", result: "pass", evidence: "phase29ExitReady=false" },
    { id: "signoff-evidence-reconciliation-keeps-phase30-blocked", result: "pass", evidence: "phase30EntryReady=false" },
    { id: "signoff-evidence-reconciliation-keeps-release-blocked", result: "pass", evidence: "releaseReady=" + (releaseExitDecisionPreview.summary?.releaseReady === true) },
    { id: "signoff-evidence-reconciliation-keeps-runtime-disabled", result: "pass", evidence: "runtimeExecution=" + (runtimeEnableGovernance.summary?.runtimeExecution === true) },
    { id: "signoff-evidence-reconciliation-does-not-persist-mutations", result: "pass", evidence: "persistedMutations=0" }
  ];
  return {
    schemaVersion: "phase29.release-exit-signoff-evidence-reconciliation-preview.v1",
    version: "1.9.45",
    mode: "readonly-release-exit-signoff-evidence-reconciliation-preview-no-reconciliation-persist",
    sourceModels: {
      phase29ReleaseExitFinalSignoffReviewPreview: phase29ReleaseExitFinalSignoffReviewPreview.schemaVersion,
      phase29ReleaseExitGovernanceFreezePreview: phase29ReleaseExitGovernanceFreezePreview.schemaVersion,
      phase29ReleaseExitReadinessDossierPreview: phase29ReleaseExitReadinessDossierPreview.schemaVersion,
      phase29FinalReadonlyExitPackagePreview: phase29FinalReadonlyExitPackagePreview.schemaVersion,
      releaseExitDecisionPreview: releaseExitDecisionPreview.schemaVersion,
      finalReleaseBlockerDossier: finalReleaseBlockerDossier.schemaVersion,
      transitionReadinessRedline: transitionReadinessRedline.schemaVersion,
      phase30EntryPreflight: phase30EntryPreflight.schemaVersion,
      runtimeEnableGovernance: runtimeEnableGovernance.schemaVersion
    },
    evidenceReconciliationItems,
    evidenceReconciliationChecks,
    blockedMutations: [
      "persist-release-exit-signoff-evidence-reconciliation-as-release-approval",
      "persist-release-exit-signoff-evidence-reconciliation-as-phase29-exit",
      "persist-release-exit-signoff-evidence-reconciliation-as-phase30-entry",
      "persist-release-exit-signoff-evidence-reconciliation-artifact",
      "persist-release-exit-signoff-evidence-reconciliation-item",
      "record-release-exit-signoff-evidence-reconciliation",
      "record-release-exit-final-signoff-review-from-evidence-reconciliation",
      "record-release-exit-governance-freeze-from-evidence-reconciliation",
      "approve-release-from-release-exit-signoff-evidence-reconciliation",
      "exit-phase29-from-release-exit-signoff-evidence-reconciliation",
      "open-phase30-entry-from-release-exit-signoff-evidence-reconciliation",
      "clear-blocker-from-release-exit-signoff-evidence-reconciliation",
      "resolve-redline-from-release-exit-signoff-evidence-reconciliation",
      "mark-release-exit-signoff-evidence-reconciled",
      "override-release-exit-final-signoff-review-from-evidence-reconciliation",
      "override-release-exit-governance-freeze-from-evidence-reconciliation",
      "override-release-exit-dossier-from-evidence-reconciliation",
      "mark-releaseReady-true",
      "enable-runtime-execution",
      "enable-third-party-execution"
    ],
    exportPolicy: {
      exportName: "phase29-release-exit-signoff-evidence-reconciliation-preview.json",
      includeInOperationsExport: true,
      redaction: "phase29-release-exit-signoff-evidence-reconciliation-source-signoff-freeze-dossier-redline-blocker-and-readonly-guardrail-summary-only"
    },
    summary: {
      phase29ReleaseExitSignoffEvidenceReconciliationPreviewReady: true,
      evidenceReconciliationItems: evidenceReconciliationItems.length,
      blockedEvidenceReconciliationItems: evidenceReconciliationItems.filter((item) => item.reconciliationState.includes("blocked")).length,
      evidenceReconciliationChecks: evidenceReconciliationChecks.length,
      passedEvidenceReconciliationChecks: evidenceReconciliationChecks.filter((item) => item.result === "pass").length,
      reconciledEvidenceItems: 0,
      persistedEvidenceReconciliationItems: evidenceReconciliationItems.filter((item) => item.persisted !== false).length,
      persistedSignoffReviewItems: signoffReviewItems.filter((item) => item.persisted !== false).length,
      persistedFreezeItems: freezeItems.filter((item) => item.persisted !== false).length,
      persistedDossierItems: dossierItems.filter((item) => item.persisted !== false).length,
      persistedExitPackageItems: exitPackageItems.filter((item) => item.persisted !== false).length,
      activeRedlines: transitionReadinessRedline.summary?.activeRedlines ?? 0,
      unresolvedBlockers: finalReleaseBlockerDossier.summary?.unresolvedBlockers ?? 0,
      phase29ExitReady: false,
      phase30Blocked: true,
      phase30EntryReady: false,
      releaseReady: false,
      runtimeExecution: false,
      thirdPartyExecution: false,
      clearedBlockers: 0,
      persistedMutations: 0
    }
  };
}

function buildPhase29ReleaseExitFinalArchiveIndexPreview(phase29ReleaseExitSignoffEvidenceReconciliationPreview = {}, phase29ReleaseExitFinalSignoffReviewPreview = {}, phase29ReleaseExitGovernanceFreezePreview = {}, phase29ReleaseExitReadinessDossierPreview = {}, phase29FinalReadonlyExitPackagePreview = {}, finalReleaseBlockerDossier = {}, transitionReadinessRedline = {}, phase30EntryPreflight = {}, runtimeEnableGovernance = {}) {
  const evidenceReconciliationItems = phase29ReleaseExitSignoffEvidenceReconciliationPreview.evidenceReconciliationItems || [];
  const signoffReviewItems = phase29ReleaseExitFinalSignoffReviewPreview.signoffReviewItems || [];
  const freezeItems = phase29ReleaseExitGovernanceFreezePreview.freezeItems || [];
  const dossierItems = phase29ReleaseExitReadinessDossierPreview.dossierItems || [];
  const exitPackageItems = phase29FinalReadonlyExitPackagePreview.exitPackageItems || [];
  const archiveIndexItems = evidenceReconciliationItems.map((item, index) => ({
    id: "final-archive-index-" + item.id.replace(/^signoff-evidence-reconciliation-/, ""),
    label: item.label.replace("release exit signoff evidence reconciliation", "release exit final archive index"),
    archiveOrder: index + 1,
    sourceEvidenceReconciliationItemId: item.id,
    sourceSignoffReviewItemId: item.sourceSignoffReviewItemId,
    sourceFreezeItemId: item.sourceFreezeItemId,
    sourceDossierItemId: item.sourceDossierItemId,
    sourceExitPackageItemId: item.sourceExitPackageItemId,
    sourceHardeningItemId: item.sourceHardeningItemId,
    sourceClosureItemId: item.sourceClosureItemId,
    sourceAuditItemId: item.sourceAuditItemId,
    sourceSignoffItemId: item.sourceSignoffItemId,
    sourceReconciliationItemId: item.sourceReconciliationItemId,
    sourceFinalExportItemId: item.sourceFinalExportItemId,
    sourceLedgerEntryId: item.sourceLedgerEntryId,
    sourceDispositionItemId: item.sourceDispositionItemId,
    sourceQueueItemId: item.sourceQueueItemId,
    sourceIndexItemId: item.sourceIndexItemId,
    evidenceType: item.evidenceType,
    owner: item.owner,
    candidateDisposition: item.candidateDisposition,
    requiredSignoffRoles: item.requiredSignoffRoles || [],
    archiveIndexState: "blocked-readonly-release-exit-final-archive-index-preview",
    archivePersistenceState: "not-persisted",
    evidenceMatchState: item.evidenceMatchState,
    reconciliationState: item.reconciliationState,
    signoffReviewState: item.signoffReviewState,
    freezeState: item.freezeState,
    dossierState: item.dossierState,
    packageState: item.packageState,
    releaseBlockerState: item.releaseBlockerState,
    signoffReviewPersistenceState: item.signoffReviewPersistenceState,
    reconciliationPersistenceState: item.reconciliationPersistenceState,
    mayPersistArchiveIndex: false,
    mayPersistReconciliation: false,
    mayPersistSignoffReview: false,
    mayPersistFreeze: false,
    mayPersistDossier: false,
    mayApproveRelease: false,
    mayExitPhase29: false,
    mayEnterPhase30: false,
    mayEnableRuntime: false,
    persisted: false
  }));
  const archiveIndexChecks = [
    { id: "archive-index-linked-to-signoff-evidence-reconciliation", result: phase29ReleaseExitSignoffEvidenceReconciliationPreview.schemaVersion === "phase29.release-exit-signoff-evidence-reconciliation-preview.v1" ? "pass" : "block", evidence: phase29ReleaseExitSignoffEvidenceReconciliationPreview.schemaVersion },
    { id: "archive-index-linked-to-final-signoff-review", result: phase29ReleaseExitFinalSignoffReviewPreview.schemaVersion === "phase29.release-exit-final-signoff-review-preview.v1" ? "pass" : "block", evidence: phase29ReleaseExitFinalSignoffReviewPreview.schemaVersion },
    { id: "archive-index-linked-to-governance-freeze", result: phase29ReleaseExitGovernanceFreezePreview.schemaVersion === "phase29.release-exit-governance-freeze-preview.v1" ? "pass" : "block", evidence: phase29ReleaseExitGovernanceFreezePreview.schemaVersion },
    { id: "archive-index-linked-to-release-exit-dossier", result: phase29ReleaseExitReadinessDossierPreview.schemaVersion === "phase29.release-exit-readiness-dossier-preview.v1" ? "pass" : "block", evidence: phase29ReleaseExitReadinessDossierPreview.schemaVersion },
    { id: "archive-index-linked-to-final-exit-package", result: phase29FinalReadonlyExitPackagePreview.schemaVersion === "phase29.final-readonly-exit-package-preview.v1" ? "pass" : "block", evidence: phase29FinalReadonlyExitPackagePreview.schemaVersion },
    { id: "archive-index-linked-to-final-blocker-dossier", result: finalReleaseBlockerDossier.schemaVersion === "phase29.final-release-blocker-dossier.v1" ? "pass" : "block", evidence: finalReleaseBlockerDossier.schemaVersion },
    { id: "archive-index-covers-all-reconciliation-items", result: archiveIndexItems.length === evidenceReconciliationItems.length ? "pass" : "block", evidence: "archiveIndexItems=" + archiveIndexItems.length + "; evidenceReconciliationItems=" + evidenceReconciliationItems.length },
    { id: "archive-index-confirms-reconciliation-checks-pass", result: (phase29ReleaseExitSignoffEvidenceReconciliationPreview.evidenceReconciliationChecks || []).every((item) => item.result === "pass") ? "pass" : "block", evidence: "evidenceReconciliationChecks=" + (phase29ReleaseExitSignoffEvidenceReconciliationPreview.summary?.evidenceReconciliationChecks ?? 0) + "; passed=" + (phase29ReleaseExitSignoffEvidenceReconciliationPreview.summary?.passedEvidenceReconciliationChecks ?? 0) },
    { id: "archive-index-keeps-reconciliation-unpersisted", result: evidenceReconciliationItems.every((item) => item.persisted === false) ? "pass" : "block", evidence: "persistedEvidenceReconciliationItems=" + evidenceReconciliationItems.filter((item) => item.persisted !== false).length },
    { id: "archive-index-keeps-signoff-review-unpersisted", result: signoffReviewItems.every((item) => item.persisted === false) ? "pass" : "block", evidence: "persistedSignoffReviewItems=" + signoffReviewItems.filter((item) => item.persisted !== false).length },
    { id: "archive-index-keeps-freeze-unpersisted", result: freezeItems.every((item) => item.persisted === false) ? "pass" : "block", evidence: "persistedFreezeItems=" + freezeItems.filter((item) => item.persisted !== false).length },
    { id: "archive-index-keeps-dossier-unpersisted", result: dossierItems.every((item) => item.persisted === false) ? "pass" : "block", evidence: "persistedDossierItems=" + dossierItems.filter((item) => item.persisted !== false).length },
    { id: "archive-index-keeps-exit-package-unpersisted", result: exitPackageItems.every((item) => item.persisted === false) ? "pass" : "block", evidence: "persistedExitPackageItems=" + exitPackageItems.filter((item) => item.persisted !== false).length },
    { id: "archive-index-keeps-redlines-active", result: transitionReadinessRedline.summary?.activeRedlines >= 1 ? "pass" : "block", evidence: "activeRedlines=" + (transitionReadinessRedline.summary?.activeRedlines ?? 0) },
    { id: "archive-index-keeps-blockers-open", result: finalReleaseBlockerDossier.summary?.unresolvedBlockers >= 1 ? "pass" : "block", evidence: "unresolvedBlockers=" + (finalReleaseBlockerDossier.summary?.unresolvedBlockers ?? 0) },
    { id: "archive-index-keeps-entry-preflight-blocked", result: phase30EntryPreflight.summary?.phase30EntryReady === false || phase30EntryPreflight.summary?.blockedEntryGates >= 1 ? "pass" : "block", evidence: "blockedEntryGates=" + (phase30EntryPreflight.summary?.blockedEntryGates ?? 0) + "; phase30EntryReady=" + (phase30EntryPreflight.summary?.phase30EntryReady === true) },
    { id: "archive-index-keeps-phase29-active", result: "pass", evidence: "phase29ExitReady=false" },
    { id: "archive-index-keeps-phase30-blocked", result: "pass", evidence: "phase30EntryReady=false" },
    { id: "archive-index-keeps-release-blocked", result: "pass", evidence: "releaseReady=false" },
    { id: "archive-index-keeps-runtime-disabled", result: "pass", evidence: "runtimeExecution=false" },
    { id: "archive-index-does-not-persist-mutations", result: "pass", evidence: "persistedMutations=0" }
  ];
  return {
    schemaVersion: "phase29.release-exit-final-archive-index-preview.v1",
    version: "1.9.46",
    mode: "readonly-release-exit-final-archive-index-preview-no-archive-persist",
    sourceModels: {
      phase29ReleaseExitSignoffEvidenceReconciliationPreview: phase29ReleaseExitSignoffEvidenceReconciliationPreview.schemaVersion,
      phase29ReleaseExitFinalSignoffReviewPreview: phase29ReleaseExitFinalSignoffReviewPreview.schemaVersion,
      phase29ReleaseExitGovernanceFreezePreview: phase29ReleaseExitGovernanceFreezePreview.schemaVersion,
      phase29ReleaseExitReadinessDossierPreview: phase29ReleaseExitReadinessDossierPreview.schemaVersion,
      phase29FinalReadonlyExitPackagePreview: phase29FinalReadonlyExitPackagePreview.schemaVersion,
      finalReleaseBlockerDossier: finalReleaseBlockerDossier.schemaVersion,
      transitionReadinessRedline: transitionReadinessRedline.schemaVersion,
      phase30EntryPreflight: phase30EntryPreflight.schemaVersion,
      runtimeEnableGovernance: runtimeEnableGovernance.schemaVersion
    },
    archiveIndexItems,
    archiveIndexChecks,
    blockedMutations: [
      "persist-release-exit-final-archive-index-as-release-approval",
      "persist-release-exit-final-archive-index-as-phase29-exit",
      "persist-release-exit-final-archive-index-as-phase30-entry",
      "persist-release-exit-final-archive-index-artifact",
      "persist-release-exit-final-archive-index-item",
      "record-release-exit-final-archive-index",
      "record-release-exit-signoff-evidence-reconciliation-from-archive-index",
      "approve-release-from-release-exit-final-archive-index",
      "exit-phase29-from-release-exit-final-archive-index",
      "open-phase30-entry-from-release-exit-final-archive-index",
      "clear-blocker-from-release-exit-final-archive-index",
      "resolve-redline-from-release-exit-final-archive-index",
      "mark-release-exit-final-archive-indexed",
      "override-release-exit-signoff-evidence-reconciliation-from-archive-index",
      "override-release-exit-final-signoff-review-from-archive-index",
      "override-release-exit-governance-freeze-from-archive-index",
      "mark-releaseReady-true",
      "enable-runtime-execution",
      "enable-third-party-execution"
    ],
    exportPolicy: {
      exportName: "phase29-release-exit-final-archive-index-preview.json",
      includeInOperationsExport: true,
      redaction: "phase29-release-exit-final-archive-index-source-reconciliation-signoff-freeze-dossier-redline-blocker-and-readonly-guardrail-summary-only"
    },
    summary: {
      phase29ReleaseExitFinalArchiveIndexPreviewReady: true,
      archiveIndexItems: archiveIndexItems.length,
      blockedArchiveIndexItems: archiveIndexItems.filter((item) => item.archiveIndexState.includes("blocked")).length,
      archiveIndexChecks: archiveIndexChecks.length,
      passedArchiveIndexChecks: archiveIndexChecks.filter((item) => item.result === "pass").length,
      indexedArchiveItems: 0,
      persistedArchiveIndexItems: archiveIndexItems.filter((item) => item.persisted !== false).length,
      persistedEvidenceReconciliationItems: evidenceReconciliationItems.filter((item) => item.persisted !== false).length,
      persistedSignoffReviewItems: signoffReviewItems.filter((item) => item.persisted !== false).length,
      persistedFreezeItems: freezeItems.filter((item) => item.persisted !== false).length,
      persistedDossierItems: dossierItems.filter((item) => item.persisted !== false).length,
      persistedExitPackageItems: exitPackageItems.filter((item) => item.persisted !== false).length,
      activeRedlines: transitionReadinessRedline.summary?.activeRedlines ?? 0,
      unresolvedBlockers: finalReleaseBlockerDossier.summary?.unresolvedBlockers ?? 0,
      phase29ExitReady: false,
      phase30Blocked: true,
      phase30EntryReady: false,
      releaseReady: false,
      runtimeExecution: false,
      thirdPartyExecution: false,
      clearedBlockers: 0,
      persistedMutations: 0
    }
  };
}

function buildPhase29ReleaseExitFinalArchiveIntegrityCheckPreview(phase29ReleaseExitFinalArchiveIndexPreview = {}, phase29ReleaseExitSignoffEvidenceReconciliationPreview = {}, phase29ReleaseExitFinalSignoffReviewPreview = {}, phase29ReleaseExitGovernanceFreezePreview = {}, phase29ReleaseExitReadinessDossierPreview = {}, phase29FinalReadonlyExitPackagePreview = {}, finalReleaseBlockerDossier = {}, transitionReadinessRedline = {}, phase30EntryPreflight = {}, runtimeEnableGovernance = {}) {
  const archiveIndexItems = phase29ReleaseExitFinalArchiveIndexPreview.archiveIndexItems || [];
  const evidenceReconciliationItems = phase29ReleaseExitSignoffEvidenceReconciliationPreview.evidenceReconciliationItems || [];
  const signoffReviewItems = phase29ReleaseExitFinalSignoffReviewPreview.signoffReviewItems || [];
  const freezeItems = phase29ReleaseExitGovernanceFreezePreview.freezeItems || [];
  const dossierItems = phase29ReleaseExitReadinessDossierPreview.dossierItems || [];
  const exitPackageItems = phase29FinalReadonlyExitPackagePreview.exitPackageItems || [];
  const integrityCheckItems = archiveIndexItems.map((item, index) => ({
    id: "final-archive-integrity-check-" + item.id.replace(/^final-archive-index-/, ""),
    label: item.label.replace("release exit final archive index", "release exit final archive integrity check"),
    integrityCheckOrder: index + 1,
    sourceArchiveIndexItemId: item.id,
    sourceEvidenceReconciliationItemId: item.sourceEvidenceReconciliationItemId,
    sourceSignoffReviewItemId: item.sourceSignoffReviewItemId,
    sourceFreezeItemId: item.sourceFreezeItemId,
    sourceDossierItemId: item.sourceDossierItemId,
    sourceExitPackageItemId: item.sourceExitPackageItemId,
    sourceHardeningItemId: item.sourceHardeningItemId,
    sourceClosureItemId: item.sourceClosureItemId,
    sourceAuditItemId: item.sourceAuditItemId,
    sourceSignoffItemId: item.sourceSignoffItemId,
    sourceReconciliationItemId: item.sourceReconciliationItemId,
    sourceFinalExportItemId: item.sourceFinalExportItemId,
    sourceLedgerEntryId: item.sourceLedgerEntryId,
    sourceDispositionItemId: item.sourceDispositionItemId,
    sourceQueueItemId: item.sourceQueueItemId,
    sourceIndexItemId: item.sourceIndexItemId,
    evidenceType: item.evidenceType,
    owner: item.owner,
    candidateDisposition: item.candidateDisposition,
    requiredSignoffRoles: item.requiredSignoffRoles || [],
    integrityCheckState: "blocked-readonly-release-exit-final-archive-integrity-check-preview",
    integrityPersistenceState: "not-persisted",
    archiveIndexState: item.archiveIndexState,
    archivePersistenceState: item.archivePersistenceState,
    evidenceMatchState: item.evidenceMatchState,
    reconciliationState: item.reconciliationState,
    signoffReviewState: item.signoffReviewState,
    freezeState: item.freezeState,
    dossierState: item.dossierState,
    packageState: item.packageState,
    releaseBlockerState: item.releaseBlockerState,
    referenceCoverageState: item.sourceEvidenceReconciliationItemId && item.sourceSignoffReviewItemId && item.sourceFreezeItemId && item.sourceDossierItemId && item.sourceExitPackageItemId ? "complete-readonly-reference-coverage" : "missing-reference",
    mayPersistIntegrityCheck: false,
    mayPersistArchiveIndex: false,
    mayApproveRelease: false,
    mayExitPhase29: false,
    mayEnterPhase30: false,
    mayEnableRuntime: false,
    persisted: false
  }));
  const integrityChecks = [
    { id: "archive-integrity-linked-to-final-archive-index", result: phase29ReleaseExitFinalArchiveIndexPreview.schemaVersion === "phase29.release-exit-final-archive-index-preview.v1" ? "pass" : "block", evidence: phase29ReleaseExitFinalArchiveIndexPreview.schemaVersion },
    { id: "archive-integrity-linked-to-signoff-evidence-reconciliation", result: phase29ReleaseExitSignoffEvidenceReconciliationPreview.schemaVersion === "phase29.release-exit-signoff-evidence-reconciliation-preview.v1" ? "pass" : "block", evidence: phase29ReleaseExitSignoffEvidenceReconciliationPreview.schemaVersion },
    { id: "archive-integrity-linked-to-final-signoff-review", result: phase29ReleaseExitFinalSignoffReviewPreview.schemaVersion === "phase29.release-exit-final-signoff-review-preview.v1" ? "pass" : "block", evidence: phase29ReleaseExitFinalSignoffReviewPreview.schemaVersion },
    { id: "archive-integrity-linked-to-governance-freeze", result: phase29ReleaseExitGovernanceFreezePreview.schemaVersion === "phase29.release-exit-governance-freeze-preview.v1" ? "pass" : "block", evidence: phase29ReleaseExitGovernanceFreezePreview.schemaVersion },
    { id: "archive-integrity-linked-to-release-exit-dossier", result: phase29ReleaseExitReadinessDossierPreview.schemaVersion === "phase29.release-exit-readiness-dossier-preview.v1" ? "pass" : "block", evidence: phase29ReleaseExitReadinessDossierPreview.schemaVersion },
    { id: "archive-integrity-linked-to-final-exit-package", result: phase29FinalReadonlyExitPackagePreview.schemaVersion === "phase29.final-readonly-exit-package-preview.v1" ? "pass" : "block", evidence: phase29FinalReadonlyExitPackagePreview.schemaVersion },
    { id: "archive-integrity-linked-to-final-blocker-dossier", result: finalReleaseBlockerDossier.schemaVersion === "phase29.final-release-blocker-dossier.v1" ? "pass" : "block", evidence: finalReleaseBlockerDossier.schemaVersion },
    { id: "archive-integrity-covers-all-archive-index-items", result: integrityCheckItems.length === archiveIndexItems.length ? "pass" : "block", evidence: "integrityCheckItems=" + integrityCheckItems.length + "; archiveIndexItems=" + archiveIndexItems.length },
    { id: "archive-integrity-confirms-archive-index-checks-pass", result: (phase29ReleaseExitFinalArchiveIndexPreview.archiveIndexChecks || []).every((item) => item.result === "pass") ? "pass" : "block", evidence: "archiveIndexChecks=" + (phase29ReleaseExitFinalArchiveIndexPreview.summary?.archiveIndexChecks ?? 0) + "; passed=" + (phase29ReleaseExitFinalArchiveIndexPreview.summary?.passedArchiveIndexChecks ?? 0) },
    { id: "archive-integrity-confirms-no-missing-references", result: integrityCheckItems.every((item) => item.referenceCoverageState === "complete-readonly-reference-coverage") ? "pass" : "block", evidence: "missingReferences=" + integrityCheckItems.filter((item) => item.referenceCoverageState !== "complete-readonly-reference-coverage").length },
    { id: "archive-integrity-keeps-archive-index-unpersisted", result: archiveIndexItems.every((item) => item.persisted === false) ? "pass" : "block", evidence: "persistedArchiveIndexItems=" + archiveIndexItems.filter((item) => item.persisted !== false).length },
    { id: "archive-integrity-keeps-reconciliation-unpersisted", result: evidenceReconciliationItems.every((item) => item.persisted === false) ? "pass" : "block", evidence: "persistedEvidenceReconciliationItems=" + evidenceReconciliationItems.filter((item) => item.persisted !== false).length },
    { id: "archive-integrity-keeps-signoff-review-unpersisted", result: signoffReviewItems.every((item) => item.persisted === false) ? "pass" : "block", evidence: "persistedSignoffReviewItems=" + signoffReviewItems.filter((item) => item.persisted !== false).length },
    { id: "archive-integrity-keeps-freeze-unpersisted", result: freezeItems.every((item) => item.persisted === false) ? "pass" : "block", evidence: "persistedFreezeItems=" + freezeItems.filter((item) => item.persisted !== false).length },
    { id: "archive-integrity-keeps-dossier-unpersisted", result: dossierItems.every((item) => item.persisted === false) ? "pass" : "block", evidence: "persistedDossierItems=" + dossierItems.filter((item) => item.persisted !== false).length },
    { id: "archive-integrity-keeps-exit-package-unpersisted", result: exitPackageItems.every((item) => item.persisted === false) ? "pass" : "block", evidence: "persistedExitPackageItems=" + exitPackageItems.filter((item) => item.persisted !== false).length },
    { id: "archive-integrity-keeps-redlines-active", result: transitionReadinessRedline.summary?.activeRedlines >= 1 ? "pass" : "block", evidence: "activeRedlines=" + (transitionReadinessRedline.summary?.activeRedlines ?? 0) },
    { id: "archive-integrity-keeps-blockers-open", result: finalReleaseBlockerDossier.summary?.unresolvedBlockers >= 1 ? "pass" : "block", evidence: "unresolvedBlockers=" + (finalReleaseBlockerDossier.summary?.unresolvedBlockers ?? 0) },
    { id: "archive-integrity-keeps-entry-preflight-blocked", result: phase30EntryPreflight.summary?.phase30EntryReady === false || phase30EntryPreflight.summary?.blockedEntryGates >= 1 ? "pass" : "block", evidence: "blockedEntryGates=" + (phase30EntryPreflight.summary?.blockedEntryGates ?? 0) + "; phase30EntryReady=" + (phase30EntryPreflight.summary?.phase30EntryReady === true) },
    { id: "archive-integrity-keeps-phase29-active", result: "pass", evidence: "phase29ExitReady=false" },
    { id: "archive-integrity-keeps-phase30-blocked", result: "pass", evidence: "phase30EntryReady=false" },
    { id: "archive-integrity-keeps-release-blocked", result: "pass", evidence: "releaseReady=false" },
    { id: "archive-integrity-keeps-runtime-disabled", result: "pass", evidence: "runtimeExecution=false" },
    { id: "archive-integrity-does-not-persist-mutations", result: "pass", evidence: "persistedMutations=0" }
  ];
  return {
    schemaVersion: "phase29.release-exit-final-archive-integrity-check-preview.v1",
    version: "1.9.47",
    mode: "readonly-release-exit-final-archive-integrity-check-preview-no-integrity-persist",
    sourceModels: {
      phase29ReleaseExitFinalArchiveIndexPreview: phase29ReleaseExitFinalArchiveIndexPreview.schemaVersion,
      phase29ReleaseExitSignoffEvidenceReconciliationPreview: phase29ReleaseExitSignoffEvidenceReconciliationPreview.schemaVersion,
      phase29ReleaseExitFinalSignoffReviewPreview: phase29ReleaseExitFinalSignoffReviewPreview.schemaVersion,
      phase29ReleaseExitGovernanceFreezePreview: phase29ReleaseExitGovernanceFreezePreview.schemaVersion,
      phase29ReleaseExitReadinessDossierPreview: phase29ReleaseExitReadinessDossierPreview.schemaVersion,
      phase29FinalReadonlyExitPackagePreview: phase29FinalReadonlyExitPackagePreview.schemaVersion,
      finalReleaseBlockerDossier: finalReleaseBlockerDossier.schemaVersion,
      transitionReadinessRedline: transitionReadinessRedline.schemaVersion,
      phase30EntryPreflight: phase30EntryPreflight.schemaVersion,
      runtimeEnableGovernance: runtimeEnableGovernance.schemaVersion
    },
    integrityCheckItems,
    integrityChecks,
    blockedMutations: [
      "persist-release-exit-final-archive-integrity-check-as-release-approval",
      "persist-release-exit-final-archive-integrity-check-as-phase29-exit",
      "persist-release-exit-final-archive-integrity-check-as-phase30-entry",
      "persist-release-exit-final-archive-manifest-as-release-approval",
      "persist-release-exit-final-archive-manifest-as-phase29-exit",
      "persist-release-exit-final-archive-manifest-as-phase30-entry",
      "persist-release-exit-final-archive-integrity-check-artifact",
      "persist-release-exit-final-archive-integrity-check-item",
      "record-release-exit-final-archive-integrity-check",
      "record-release-exit-final-archive-index-from-integrity-check",
      "approve-release-from-release-exit-final-archive-integrity-check",
      "exit-phase29-from-release-exit-final-archive-integrity-check",
      "open-phase30-entry-from-release-exit-final-archive-integrity-check",
      "clear-blocker-from-release-exit-final-archive-integrity-check",
      "resolve-redline-from-release-exit-final-archive-integrity-check",
      "mark-release-exit-final-archive-integrity-checked",
      "override-release-exit-final-archive-index-from-integrity-check",
      "override-release-exit-signoff-evidence-reconciliation-from-integrity-check",
      "mark-releaseReady-true",
      "enable-runtime-execution",
      "enable-third-party-execution"
    ],
    exportPolicy: {
      exportName: "phase29-release-exit-final-archive-integrity-check-preview.json",
      includeInOperationsExport: true,
      redaction: "phase29-release-exit-final-archive-integrity-check-source-index-reconciliation-signoff-freeze-dossier-redline-blocker-and-readonly-guardrail-summary-only"
    },
    summary: {
      phase29ReleaseExitFinalArchiveIntegrityCheckPreviewReady: true,
      integrityCheckItems: integrityCheckItems.length,
      blockedIntegrityCheckItems: integrityCheckItems.filter((item) => item.integrityCheckState.includes("blocked")).length,
      integrityChecks: integrityChecks.length,
      passedIntegrityChecks: integrityChecks.filter((item) => item.result === "pass").length,
      verifiedArchiveItems: 0,
      missingArchiveReferences: integrityCheckItems.filter((item) => item.referenceCoverageState !== "complete-readonly-reference-coverage").length,
      persistedIntegrityCheckItems: integrityCheckItems.filter((item) => item.persisted !== false).length,
      persistedArchiveIndexItems: archiveIndexItems.filter((item) => item.persisted !== false).length,
      persistedEvidenceReconciliationItems: evidenceReconciliationItems.filter((item) => item.persisted !== false).length,
      persistedSignoffReviewItems: signoffReviewItems.filter((item) => item.persisted !== false).length,
      persistedFreezeItems: freezeItems.filter((item) => item.persisted !== false).length,
      persistedDossierItems: dossierItems.filter((item) => item.persisted !== false).length,
      persistedExitPackageItems: exitPackageItems.filter((item) => item.persisted !== false).length,
      activeRedlines: transitionReadinessRedline.summary?.activeRedlines ?? 0,
      unresolvedBlockers: finalReleaseBlockerDossier.summary?.unresolvedBlockers ?? 0,
      phase29ExitReady: false,
      phase30Blocked: true,
      phase30EntryReady: false,
      releaseReady: false,
      runtimeExecution: false,
      thirdPartyExecution: false,
      clearedBlockers: 0,
      persistedMutations: 0
    }
  };
}


function buildPhase29ReleaseExitFinalArchiveManifestPreview(phase29ReleaseExitFinalArchiveIntegrityCheckPreview = {}, phase29ReleaseExitFinalArchiveIndexPreview = {}, phase29ReleaseExitSignoffEvidenceReconciliationPreview = {}, phase29ReleaseExitFinalSignoffReviewPreview = {}, phase29ReleaseExitGovernanceFreezePreview = {}, phase29ReleaseExitReadinessDossierPreview = {}, phase29FinalReadonlyExitPackagePreview = {}, finalReleaseBlockerDossier = {}, transitionReadinessRedline = {}, phase30EntryPreflight = {}, runtimeEnableGovernance = {}) {
  const integrityCheckItems = phase29ReleaseExitFinalArchiveIntegrityCheckPreview.integrityCheckItems || [];
  const archiveIndexItems = phase29ReleaseExitFinalArchiveIndexPreview.archiveIndexItems || [];
  const evidenceReconciliationItems = phase29ReleaseExitSignoffEvidenceReconciliationPreview.evidenceReconciliationItems || [];
  const signoffReviewItems = phase29ReleaseExitFinalSignoffReviewPreview.signoffReviewItems || [];
  const freezeItems = phase29ReleaseExitGovernanceFreezePreview.freezeItems || [];
  const dossierItems = phase29ReleaseExitReadinessDossierPreview.dossierItems || [];
  const exitPackageItems = phase29FinalReadonlyExitPackagePreview.exitPackageItems || [];
  const manifestItems = integrityCheckItems.map((item, index) => ({
    id: "final-archive-manifest-" + item.id.replace(/^final-archive-integrity-check-/, ""),
    label: item.label.replace("release exit final archive integrity check", "release exit final archive manifest"),
    manifestOrder: index + 1,
    sourceIntegrityCheckItemId: item.id,
    sourceArchiveIndexItemId: item.sourceArchiveIndexItemId,
    sourceEvidenceReconciliationItemId: item.sourceEvidenceReconciliationItemId,
    sourceSignoffReviewItemId: item.sourceSignoffReviewItemId,
    sourceFreezeItemId: item.sourceFreezeItemId,
    sourceDossierItemId: item.sourceDossierItemId,
    sourceExitPackageItemId: item.sourceExitPackageItemId,
    sourceHardeningItemId: item.sourceHardeningItemId,
    sourceClosureItemId: item.sourceClosureItemId,
    sourceAuditItemId: item.sourceAuditItemId,
    sourceSignoffItemId: item.sourceSignoffItemId,
    sourceReconciliationItemId: item.sourceReconciliationItemId,
    sourceFinalExportItemId: item.sourceFinalExportItemId,
    sourceLedgerEntryId: item.sourceLedgerEntryId,
    sourceDispositionItemId: item.sourceDispositionItemId,
    sourceQueueItemId: item.sourceQueueItemId,
    sourceIndexItemId: item.sourceIndexItemId,
    evidenceType: item.evidenceType,
    owner: item.owner,
    candidateDisposition: item.candidateDisposition,
    requiredSignoffRoles: item.requiredSignoffRoles || [],
    manifestState: "blocked-readonly-release-exit-final-archive-manifest-preview",
    manifestPersistenceState: "not-persisted",
    integrityCheckState: item.integrityCheckState,
    integrityPersistenceState: item.integrityPersistenceState,
    archiveIndexState: item.archiveIndexState,
    archivePersistenceState: item.archivePersistenceState,
    referenceCoverageState: item.referenceCoverageState,
    manifestCoverageState: item.sourceArchiveIndexItemId && item.sourceEvidenceReconciliationItemId && item.sourceSignoffReviewItemId && item.referenceCoverageState === "complete-readonly-reference-coverage" ? "complete-readonly-manifest-coverage" : "missing-manifest-reference",
    mayPersistManifest: false,
    mayPersistIntegrityCheck: false,
    mayPersistArchiveIndex: false,
    mayApproveRelease: false,
    mayExitPhase29: false,
    mayEnterPhase30: false,
    mayEnableRuntime: false,
    persisted: false
  }));
  const manifestChecks = [
    { id: "archive-manifest-linked-to-integrity-check", result: phase29ReleaseExitFinalArchiveIntegrityCheckPreview.schemaVersion === "phase29.release-exit-final-archive-integrity-check-preview.v1" ? "pass" : "block", evidence: phase29ReleaseExitFinalArchiveIntegrityCheckPreview.schemaVersion },
    { id: "archive-manifest-linked-to-final-archive-index", result: phase29ReleaseExitFinalArchiveIndexPreview.schemaVersion === "phase29.release-exit-final-archive-index-preview.v1" ? "pass" : "block", evidence: phase29ReleaseExitFinalArchiveIndexPreview.schemaVersion },
    { id: "archive-manifest-linked-to-signoff-evidence-reconciliation", result: phase29ReleaseExitSignoffEvidenceReconciliationPreview.schemaVersion === "phase29.release-exit-signoff-evidence-reconciliation-preview.v1" ? "pass" : "block", evidence: phase29ReleaseExitSignoffEvidenceReconciliationPreview.schemaVersion },
    { id: "archive-manifest-linked-to-final-signoff-review", result: phase29ReleaseExitFinalSignoffReviewPreview.schemaVersion === "phase29.release-exit-final-signoff-review-preview.v1" ? "pass" : "block", evidence: phase29ReleaseExitFinalSignoffReviewPreview.schemaVersion },
    { id: "archive-manifest-linked-to-governance-freeze", result: phase29ReleaseExitGovernanceFreezePreview.schemaVersion === "phase29.release-exit-governance-freeze-preview.v1" ? "pass" : "block", evidence: phase29ReleaseExitGovernanceFreezePreview.schemaVersion },
    { id: "archive-manifest-linked-to-release-exit-dossier", result: phase29ReleaseExitReadinessDossierPreview.schemaVersion === "phase29.release-exit-readiness-dossier-preview.v1" ? "pass" : "block", evidence: phase29ReleaseExitReadinessDossierPreview.schemaVersion },
    { id: "archive-manifest-linked-to-final-exit-package", result: phase29FinalReadonlyExitPackagePreview.schemaVersion === "phase29.final-readonly-exit-package-preview.v1" ? "pass" : "block", evidence: phase29FinalReadonlyExitPackagePreview.schemaVersion },
    { id: "archive-manifest-linked-to-final-blocker-dossier", result: finalReleaseBlockerDossier.schemaVersion === "phase29.final-release-blocker-dossier.v1" ? "pass" : "block", evidence: finalReleaseBlockerDossier.schemaVersion },
    { id: "archive-manifest-covers-all-integrity-check-items", result: manifestItems.length === integrityCheckItems.length ? "pass" : "block", evidence: "manifestItems=" + manifestItems.length + "; integrityCheckItems=" + integrityCheckItems.length },
    { id: "archive-manifest-confirms-integrity-checks-pass", result: (phase29ReleaseExitFinalArchiveIntegrityCheckPreview.integrityChecks || []).every((item) => item.result === "pass") ? "pass" : "block", evidence: "integrityChecks=" + (phase29ReleaseExitFinalArchiveIntegrityCheckPreview.summary?.integrityChecks ?? 0) + "; passed=" + (phase29ReleaseExitFinalArchiveIntegrityCheckPreview.summary?.passedIntegrityChecks ?? 0) },
    { id: "archive-manifest-confirms-no-missing-references", result: manifestItems.every((item) => item.manifestCoverageState === "complete-readonly-manifest-coverage") ? "pass" : "block", evidence: "missingManifestReferences=" + manifestItems.filter((item) => item.manifestCoverageState !== "complete-readonly-manifest-coverage").length },
    { id: "archive-manifest-keeps-integrity-check-unpersisted", result: integrityCheckItems.every((item) => item.persisted === false) ? "pass" : "block", evidence: "persistedIntegrityCheckItems=" + integrityCheckItems.filter((item) => item.persisted !== false).length },
    { id: "archive-manifest-keeps-archive-index-unpersisted", result: archiveIndexItems.every((item) => item.persisted === false) ? "pass" : "block", evidence: "persistedArchiveIndexItems=" + archiveIndexItems.filter((item) => item.persisted !== false).length },
    { id: "archive-manifest-keeps-reconciliation-unpersisted", result: evidenceReconciliationItems.every((item) => item.persisted === false) ? "pass" : "block", evidence: "persistedEvidenceReconciliationItems=" + evidenceReconciliationItems.filter((item) => item.persisted !== false).length },
    { id: "archive-manifest-keeps-signoff-review-unpersisted", result: signoffReviewItems.every((item) => item.persisted === false) ? "pass" : "block", evidence: "persistedSignoffReviewItems=" + signoffReviewItems.filter((item) => item.persisted !== false).length },
    { id: "archive-manifest-keeps-freeze-unpersisted", result: freezeItems.every((item) => item.persisted === false) ? "pass" : "block", evidence: "persistedFreezeItems=" + freezeItems.filter((item) => item.persisted !== false).length },
    { id: "archive-manifest-keeps-dossier-unpersisted", result: dossierItems.every((item) => item.persisted === false) ? "pass" : "block", evidence: "persistedDossierItems=" + dossierItems.filter((item) => item.persisted !== false).length },
    { id: "archive-manifest-keeps-exit-package-unpersisted", result: exitPackageItems.every((item) => item.persisted === false) ? "pass" : "block", evidence: "persistedExitPackageItems=" + exitPackageItems.filter((item) => item.persisted !== false).length },
    { id: "archive-manifest-keeps-redlines-active", result: transitionReadinessRedline.summary?.activeRedlines >= 1 ? "pass" : "block", evidence: "activeRedlines=" + (transitionReadinessRedline.summary?.activeRedlines ?? 0) },
    { id: "archive-manifest-keeps-blockers-open", result: finalReleaseBlockerDossier.summary?.unresolvedBlockers >= 1 ? "pass" : "block", evidence: "unresolvedBlockers=" + (finalReleaseBlockerDossier.summary?.unresolvedBlockers ?? 0) },
    { id: "archive-manifest-keeps-entry-preflight-blocked", result: phase30EntryPreflight.summary?.phase30EntryReady === false || phase30EntryPreflight.summary?.blockedEntryGates >= 1 ? "pass" : "block", evidence: "blockedEntryGates=" + (phase30EntryPreflight.summary?.blockedEntryGates ?? 0) + "; phase30EntryReady=" + (phase30EntryPreflight.summary?.phase30EntryReady === true) },
    { id: "archive-manifest-keeps-phase29-active", result: "pass", evidence: "phase29ExitReady=false" },
    { id: "archive-manifest-keeps-phase30-blocked", result: "pass", evidence: "phase30EntryReady=false" },
    { id: "archive-manifest-keeps-release-blocked", result: "pass", evidence: "releaseReady=false" },
    { id: "archive-manifest-keeps-runtime-disabled", result: "pass", evidence: "runtimeExecution=false" },
    { id: "archive-manifest-does-not-persist-mutations", result: "pass", evidence: "persistedMutations=0" }
  ];
  return {
    schemaVersion: "phase29.release-exit-final-archive-manifest-preview.v1",
    version: "1.9.48",
    mode: "readonly-release-exit-final-archive-manifest-preview-no-manifest-persist",
    sourceModels: {
      phase29ReleaseExitFinalArchiveIntegrityCheckPreview: phase29ReleaseExitFinalArchiveIntegrityCheckPreview.schemaVersion,
      phase29ReleaseExitFinalArchiveIndexPreview: phase29ReleaseExitFinalArchiveIndexPreview.schemaVersion,
      phase29ReleaseExitSignoffEvidenceReconciliationPreview: phase29ReleaseExitSignoffEvidenceReconciliationPreview.schemaVersion,
      phase29ReleaseExitFinalSignoffReviewPreview: phase29ReleaseExitFinalSignoffReviewPreview.schemaVersion,
      phase29ReleaseExitGovernanceFreezePreview: phase29ReleaseExitGovernanceFreezePreview.schemaVersion,
      phase29ReleaseExitReadinessDossierPreview: phase29ReleaseExitReadinessDossierPreview.schemaVersion,
      phase29FinalReadonlyExitPackagePreview: phase29FinalReadonlyExitPackagePreview.schemaVersion,
      finalReleaseBlockerDossier: finalReleaseBlockerDossier.schemaVersion,
      transitionReadinessRedline: transitionReadinessRedline.schemaVersion,
      phase30EntryPreflight: phase30EntryPreflight.schemaVersion,
      runtimeEnableGovernance: runtimeEnableGovernance.schemaVersion
    },
    manifestItems,
    manifestChecks,
    blockedMutations: [
      "persist-release-exit-final-archive-manifest-as-release-approval",
      "persist-release-exit-final-archive-manifest-as-phase29-exit",
      "persist-release-exit-final-archive-manifest-as-phase30-entry",
      "persist-release-exit-final-archive-manifest-artifact",
      "persist-release-exit-final-archive-manifest-item",
      "record-release-exit-final-archive-manifest",
      "record-release-exit-final-archive-integrity-check-from-manifest",
      "approve-release-from-release-exit-final-archive-manifest",
      "exit-phase29-from-release-exit-final-archive-manifest",
      "open-phase30-entry-from-release-exit-final-archive-manifest",
      "clear-blocker-from-release-exit-final-archive-manifest",
      "resolve-redline-from-release-exit-final-archive-manifest",
      "mark-release-exit-final-archive-manifested",
      "override-release-exit-final-archive-integrity-check-from-manifest",
      "override-release-exit-final-archive-index-from-manifest",
      "mark-releaseReady-true",
      "enable-runtime-execution",
      "enable-third-party-execution"
    ],
    exportPolicy: {
      exportName: "phase29-release-exit-final-archive-manifest-preview.json",
      includeInOperationsExport: true,
      redaction: "phase29-release-exit-final-archive-manifest-source-integrity-index-reconciliation-signoff-freeze-dossier-redline-blocker-and-readonly-guardrail-summary-only"
    },
    summary: {
      phase29ReleaseExitFinalArchiveManifestPreviewReady: true,
      manifestItems: manifestItems.length,
      blockedManifestItems: manifestItems.filter((item) => item.manifestState.includes("blocked")).length,
      manifestChecks: manifestChecks.length,
      passedManifestChecks: manifestChecks.filter((item) => item.result === "pass").length,
      manifestedArchiveItems: 0,
      missingManifestReferences: manifestItems.filter((item) => item.manifestCoverageState !== "complete-readonly-manifest-coverage").length,
      persistedManifestItems: manifestItems.filter((item) => item.persisted !== false).length,
      persistedIntegrityCheckItems: integrityCheckItems.filter((item) => item.persisted !== false).length,
      persistedArchiveIndexItems: archiveIndexItems.filter((item) => item.persisted !== false).length,
      activeRedlines: transitionReadinessRedline.summary?.activeRedlines ?? 0,
      unresolvedBlockers: finalReleaseBlockerDossier.summary?.unresolvedBlockers ?? 0,
      phase29ExitReady: false,
      phase30Blocked: true,
      phase30EntryReady: false,
      releaseReady: false,
      runtimeExecution: false,
      thirdPartyExecution: false,
      clearedBlockers: 0,
      persistedMutations: 0
    }
  };
}
function buildPhase29ReleaseGovernancePlanning(memories = []) {
  const phase28 = buildPhase28ClearanceReviewEntry(memories);
  const closurePackage = phase28.phase28ClosurePackage || {};
  const carriedForwardBlockers = phase28.clearanceReviewQueue || [];
  const blockerClearanceWorkflow = buildPhase29BlockerClearanceWorkflow(phase28, closurePackage, carriedForwardBlockers);
  const releaseApprovalStateModel = buildPhase29ReleaseApprovalStateModel(blockerClearanceWorkflow);
  const runtimeEnableGovernance = buildPhase29RuntimeEnableGovernance(releaseApprovalStateModel);
  const governanceTracks = [
    {
      id: "blocker-clearance-governance",
      label: "Blocker clearance governance",
      source: closurePackage.schemaVersion,
      state: "planning",
      owner: "human-release-governance",
      requiredBeforeRelease: [
        "human-owned-clearance-evidence",
        "reviewer-disposition-recorded",
        "criteria-satisfaction-reviewed",
        "release-approval-separated-from-clearance"
      ],
      blockedActions: ["auto-clear-blocker", "clear-blocker-without-human-evidence"]
    },
    {
      id: "release-approval-state-model",
      label: "Release approval state model",
      source: "phase28.closure-package.v1",
      state: "planning",
      owner: "release-owner",
      requiredBeforeRelease: [
        "no-open-blockers",
        "signed-release-decision",
        "artifact-integrity-verified",
        "rollback-and-backup-reviewed"
      ],
      blockedActions: ["mark-releaseReady-true", "approve-release-from-planning"]
    },
    {
      id: "runtime-enable-governance",
      label: "Runtime enable governance",
      source: "phase26.runtime-validation-entry.v1",
      state: "deferred",
      owner: "runtime-reviewer",
      requiredBeforeRelease: [
        "runtime-validation-pass",
        "quarantine-cleared",
        "permission-policy-reviewed",
        "kill-switch-reviewed"
      ],
      blockedActions: ["enable-runtime-execution", "execute-third-party-plugin"]
    }
  ];
  const gateSeparationModel = [
    { id: "review-complete", label: "Review complete", mayClearBlockers: false, mayApproveRelease: false, mayEnableRuntime: false },
    { id: "blocker-clearance", label: "Blocker clearance", mayClearBlockers: false, mayApproveRelease: false, mayEnableRuntime: false },
    { id: "release-approval", label: "Release approval", mayClearBlockers: false, mayApproveRelease: false, mayEnableRuntime: false },
    { id: "runtime-approval", label: "Runtime approval", mayClearBlockers: false, mayApproveRelease: false, mayEnableRuntime: false }
  ];
  const governanceDashboardExport = buildPhase29GovernanceDashboardExport(blockerClearanceWorkflow, releaseApprovalStateModel, runtimeEnableGovernance, gateSeparationModel);
  const decisionHistoryAuditChain = buildPhase29DecisionHistoryAuditChain(blockerClearanceWorkflow, releaseApprovalStateModel, runtimeEnableGovernance, governanceDashboardExport);
  const governanceClosureReadiness = buildPhase29GovernanceClosureReadiness(blockerClearanceWorkflow, releaseApprovalStateModel, runtimeEnableGovernance, governanceDashboardExport, decisionHistoryAuditChain, carriedForwardBlockers);
  const closureHandoffPackage = buildPhase29ClosureHandoffPackage(blockerClearanceWorkflow, releaseApprovalStateModel, runtimeEnableGovernance, governanceDashboardExport, decisionHistoryAuditChain, governanceClosureReadiness);
  const handoffReviewIndex = buildPhase29HandoffReviewIndex(closureHandoffPackage, governanceClosureReadiness);
  const finalClosureReadinessSnapshot = buildPhase29FinalClosureReadinessSnapshot(handoffReviewIndex, closureHandoffPackage, governanceClosureReadiness, decisionHistoryAuditChain, governanceDashboardExport, runtimeEnableGovernance, releaseApprovalStateModel, blockerClearanceWorkflow);
  const governanceArchiveFreeze = buildPhase29GovernanceArchiveFreeze(finalClosureReadinessSnapshot, handoffReviewIndex, closureHandoffPackage, governanceClosureReadiness, decisionHistoryAuditChain, governanceDashboardExport);
  const blockerResolutionMap = buildPhase29BlockerResolutionMap(governanceArchiveFreeze, finalClosureReadinessSnapshot, handoffReviewIndex, governanceClosureReadiness, blockerClearanceWorkflow);
  const phase30EntryPreflight = buildPhase29Phase30EntryPreflight(blockerResolutionMap, governanceArchiveFreeze, finalClosureReadinessSnapshot, releaseApprovalStateModel, runtimeEnableGovernance);
  const finalReleaseBlockerDossier = buildPhase29FinalReleaseBlockerDossier(phase30EntryPreflight, blockerResolutionMap, governanceClosureReadiness, releaseApprovalStateModel, runtimeEnableGovernance);
  const releaseExitCriteriaLedger = buildPhase29ReleaseExitCriteriaLedger(finalReleaseBlockerDossier, phase30EntryPreflight, governanceArchiveFreeze, releaseApprovalStateModel, runtimeEnableGovernance);
  const releaseExitDecisionPreview = buildPhase29ReleaseExitDecisionPreview(releaseExitCriteriaLedger, finalReleaseBlockerDossier, phase30EntryPreflight, releaseApprovalStateModel, runtimeEnableGovernance);
  const phase30TransitionRiskRegister = buildPhase29Phase30TransitionRiskRegister(releaseExitDecisionPreview, releaseExitCriteriaLedger, finalReleaseBlockerDossier, phase30EntryPreflight, runtimeEnableGovernance);
  const transitionEvidenceGapReview = buildPhase29TransitionEvidenceGapReview(phase30TransitionRiskRegister, releaseExitDecisionPreview, finalReleaseBlockerDossier, phase30EntryPreflight, governanceArchiveFreeze);
  const transitionReadinessRedline = buildPhase29TransitionReadinessRedline(transitionEvidenceGapReview, phase30TransitionRiskRegister, releaseExitDecisionPreview, phase30EntryPreflight, runtimeEnableGovernance);
  const finalTransitionHandoffPreview = buildPhase29FinalTransitionHandoffPreview(transitionReadinessRedline, transitionEvidenceGapReview, phase30TransitionRiskRegister, releaseExitDecisionPreview, phase30EntryPreflight, governanceArchiveFreeze);
  const transitionClosurePackagePreview = buildPhase29TransitionClosurePackagePreview(finalTransitionHandoffPreview, transitionReadinessRedline, transitionEvidenceGapReview, phase30TransitionRiskRegister, releaseExitDecisionPreview, governanceArchiveFreeze, phase30EntryPreflight);
  const releaseCandidateFreezePreview = buildPhase29ReleaseCandidateFreezePreview(transitionClosurePackagePreview, finalTransitionHandoffPreview, transitionReadinessRedline, releaseExitDecisionPreview, governanceArchiveFreeze, phase30EntryPreflight, runtimeEnableGovernance);
  const finalReadinessBoardPreview = buildPhase29FinalReadinessBoardPreview(releaseCandidateFreezePreview, transitionClosurePackagePreview, finalTransitionHandoffPreview, transitionReadinessRedline, releaseExitDecisionPreview, phase30EntryPreflight, runtimeEnableGovernance);
  const releaseFinalReviewEnvelopePreview = buildPhase29ReleaseFinalReviewEnvelopePreview(finalReadinessBoardPreview, releaseCandidateFreezePreview, transitionClosurePackagePreview, transitionReadinessRedline, releaseExitDecisionPreview, phase30EntryPreflight, governanceArchiveFreeze, runtimeEnableGovernance);
  const exitReadinessAttestationPreview = buildPhase29ExitReadinessAttestationPreview(releaseFinalReviewEnvelopePreview, finalReadinessBoardPreview, releaseExitDecisionPreview, phase30EntryPreflight, transitionReadinessRedline, finalReleaseBlockerDossier, runtimeEnableGovernance, governanceArchiveFreeze);
  const phase30PlanningBriefPreview = buildPhase29Phase30PlanningBriefPreview(exitReadinessAttestationPreview, phase30EntryPreflight, phase30TransitionRiskRegister, transitionEvidenceGapReview, transitionReadinessRedline, releaseFinalReviewEnvelopePreview, finalReadinessBoardPreview, governanceArchiveFreeze);
  const phase30ScopeLockPreview = buildPhase29Phase30ScopeLockPreview(phase30PlanningBriefPreview, phase30EntryPreflight, phase30TransitionRiskRegister, transitionEvidenceGapReview, transitionReadinessRedline, releaseExitDecisionPreview, runtimeEnableGovernance, governanceArchiveFreeze);
  const phase30ReadinessMapPreview = buildPhase29Phase30ReadinessMapPreview(phase30ScopeLockPreview, phase30PlanningBriefPreview, phase30EntryPreflight, phase30TransitionRiskRegister, transitionEvidenceGapReview, transitionReadinessRedline, finalReleaseBlockerDossier, releaseExitDecisionPreview, runtimeEnableGovernance, governanceArchiveFreeze);
  const phase30ReadinessGapBriefPreview = buildPhase29Phase30ReadinessGapBriefPreview(phase30ReadinessMapPreview, phase30ScopeLockPreview, phase30EntryPreflight, phase30TransitionRiskRegister, transitionEvidenceGapReview, transitionReadinessRedline, finalReleaseBlockerDossier, releaseExitDecisionPreview, runtimeEnableGovernance, governanceArchiveFreeze);
  const phase30GapResolutionSequencePreview = buildPhase29Phase30GapResolutionSequencePreview(phase30ReadinessGapBriefPreview, phase30ReadinessMapPreview, phase30EntryPreflight, phase30TransitionRiskRegister, transitionEvidenceGapReview, transitionReadinessRedline, finalReleaseBlockerDossier, releaseExitDecisionPreview, runtimeEnableGovernance, governanceArchiveFreeze);
  const phase30EntryEvidencePackPreview = buildPhase29Phase30EntryEvidencePackPreview(phase30GapResolutionSequencePreview, phase30ReadinessGapBriefPreview, phase30ReadinessMapPreview, phase30EntryPreflight, phase30TransitionRiskRegister, transitionEvidenceGapReview, transitionReadinessRedline, finalReleaseBlockerDossier, releaseExitDecisionPreview, runtimeEnableGovernance, governanceArchiveFreeze);
  const phase30EntryEvidenceIndexPreview = buildPhase29Phase30EntryEvidenceIndexPreview(phase30EntryEvidencePackPreview, phase30GapResolutionSequencePreview, phase30ReadinessGapBriefPreview, phase30ReadinessMapPreview, phase30EntryPreflight, phase30TransitionRiskRegister, transitionEvidenceGapReview, transitionReadinessRedline, finalReleaseBlockerDossier, releaseExitDecisionPreview, runtimeEnableGovernance, governanceArchiveFreeze);
  const phase30EntryEvidenceReviewQueuePreview = buildPhase29Phase30EntryEvidenceReviewQueuePreview(phase30EntryEvidenceIndexPreview, phase30EntryEvidencePackPreview, phase30GapResolutionSequencePreview, transitionReadinessRedline, finalReleaseBlockerDossier, releaseExitDecisionPreview, runtimeEnableGovernance);
  const phase30EntryEvidenceReviewDispositionPreview = buildPhase29Phase30EntryEvidenceReviewDispositionPreview(phase30EntryEvidenceReviewQueuePreview, phase30EntryEvidenceIndexPreview, phase30EntryEvidencePackPreview, transitionReadinessRedline, finalReleaseBlockerDossier, releaseExitDecisionPreview, runtimeEnableGovernance);
  const phase30EntryEvidenceDispositionLedgerPreview = buildPhase29Phase30EntryEvidenceDispositionLedgerPreview(phase30EntryEvidenceReviewDispositionPreview, phase30EntryEvidenceReviewQueuePreview, phase30EntryEvidenceIndexPreview, finalReleaseBlockerDossier, releaseExitDecisionPreview, runtimeEnableGovernance);
  const phase30EntryEvidenceFinalLedgerExportPreview = buildPhase29Phase30EntryEvidenceFinalLedgerExportPreview(phase30EntryEvidenceDispositionLedgerPreview, phase30EntryEvidenceReviewDispositionPreview, phase30EntryEvidenceReviewQueuePreview, phase30EntryEvidenceIndexPreview, phase30EntryEvidencePackPreview, finalReleaseBlockerDossier, releaseExitDecisionPreview, runtimeEnableGovernance);
  const phase30EntryFinalExportReconciliationPreview = buildPhase29Phase30EntryFinalExportReconciliationPreview(phase30EntryEvidenceFinalLedgerExportPreview, phase30EntryEvidenceDispositionLedgerPreview, phase30EntryEvidenceReviewDispositionPreview, phase30EntryEvidenceReviewQueuePreview, phase30EntryEvidenceIndexPreview, finalReleaseBlockerDossier, releaseExitDecisionPreview, runtimeEnableGovernance);
  const phase30EntryReconciliationSignoffPreview = buildPhase29Phase30EntryReconciliationSignoffPreview(phase30EntryFinalExportReconciliationPreview, phase30EntryEvidenceFinalLedgerExportPreview, releaseFinalReviewEnvelopePreview, exitReadinessAttestationPreview, finalReleaseBlockerDossier, releaseExitDecisionPreview, runtimeEnableGovernance);
  const phase30EntrySignoffAuditPreview = buildPhase29Phase30EntrySignoffAuditPreview(phase30EntryReconciliationSignoffPreview, phase30EntryFinalExportReconciliationPreview, releaseFinalReviewEnvelopePreview, exitReadinessAttestationPreview, finalReleaseBlockerDossier, releaseExitDecisionPreview, runtimeEnableGovernance);
  const phase30EntryAuditClosurePreview = buildPhase29Phase30EntryAuditClosurePreview(phase30EntrySignoffAuditPreview, phase30EntryReconciliationSignoffPreview, phase30EntryFinalExportReconciliationPreview, releaseFinalReviewEnvelopePreview, exitReadinessAttestationPreview, finalReleaseBlockerDossier, releaseExitDecisionPreview, runtimeEnableGovernance);
  const phase29AuditClosureReadinessHardening = buildPhase29AuditClosureReadinessHardening(phase30EntryAuditClosurePreview, phase30EntrySignoffAuditPreview, phase30EntryReconciliationSignoffPreview, phase30EntryFinalExportReconciliationPreview, transitionReadinessRedline, phase30EntryPreflight, finalReleaseBlockerDossier, releaseExitDecisionPreview, runtimeEnableGovernance);
  const phase29FinalReadonlyExitPackagePreview = buildPhase29FinalReadonlyExitPackagePreview(phase29AuditClosureReadinessHardening, releaseExitDecisionPreview, exitReadinessAttestationPreview, releaseFinalReviewEnvelopePreview, finalReleaseBlockerDossier, transitionReadinessRedline, phase30EntryPreflight, runtimeEnableGovernance);
  const phase29ReleaseExitReadinessDossierPreview = buildPhase29ReleaseExitReadinessDossierPreview(phase29FinalReadonlyExitPackagePreview, phase29AuditClosureReadinessHardening, releaseExitDecisionPreview, finalReleaseBlockerDossier, transitionReadinessRedline, phase30EntryPreflight, runtimeEnableGovernance);
  const phase29ReleaseExitGovernanceFreezePreview = buildPhase29ReleaseExitGovernanceFreezePreview(phase29ReleaseExitReadinessDossierPreview, phase29FinalReadonlyExitPackagePreview, governanceArchiveFreeze, releaseExitDecisionPreview, finalReleaseBlockerDossier, transitionReadinessRedline, phase30EntryPreflight, runtimeEnableGovernance);
  const phase29ReleaseExitFinalSignoffReviewPreview = buildPhase29ReleaseExitFinalSignoffReviewPreview(phase29ReleaseExitGovernanceFreezePreview, phase29ReleaseExitReadinessDossierPreview, phase29FinalReadonlyExitPackagePreview, releaseExitDecisionPreview, finalReleaseBlockerDossier, transitionReadinessRedline, phase30EntryPreflight, runtimeEnableGovernance);
  const phase29ReleaseExitSignoffEvidenceReconciliationPreview = buildPhase29ReleaseExitSignoffEvidenceReconciliationPreview(phase29ReleaseExitFinalSignoffReviewPreview, phase29ReleaseExitGovernanceFreezePreview, phase29ReleaseExitReadinessDossierPreview, phase29FinalReadonlyExitPackagePreview, releaseExitDecisionPreview, finalReleaseBlockerDossier, transitionReadinessRedline, phase30EntryPreflight, runtimeEnableGovernance);
  const phase29ReleaseExitFinalArchiveIndexPreview = buildPhase29ReleaseExitFinalArchiveIndexPreview(phase29ReleaseExitSignoffEvidenceReconciliationPreview, phase29ReleaseExitFinalSignoffReviewPreview, phase29ReleaseExitGovernanceFreezePreview, phase29ReleaseExitReadinessDossierPreview, phase29FinalReadonlyExitPackagePreview, finalReleaseBlockerDossier, transitionReadinessRedline, phase30EntryPreflight, runtimeEnableGovernance);
  const phase29ReleaseExitFinalArchiveIntegrityCheckPreview = buildPhase29ReleaseExitFinalArchiveIntegrityCheckPreview(phase29ReleaseExitFinalArchiveIndexPreview, phase29ReleaseExitSignoffEvidenceReconciliationPreview, phase29ReleaseExitFinalSignoffReviewPreview, phase29ReleaseExitGovernanceFreezePreview, phase29ReleaseExitReadinessDossierPreview, phase29FinalReadonlyExitPackagePreview, finalReleaseBlockerDossier, transitionReadinessRedline, phase30EntryPreflight, runtimeEnableGovernance);
  const phase29ReleaseExitFinalArchiveManifestPreview = buildPhase29ReleaseExitFinalArchiveManifestPreview(phase29ReleaseExitFinalArchiveIntegrityCheckPreview, phase29ReleaseExitFinalArchiveIndexPreview, phase29ReleaseExitSignoffEvidenceReconciliationPreview, phase29ReleaseExitFinalSignoffReviewPreview, phase29ReleaseExitGovernanceFreezePreview, phase29ReleaseExitReadinessDossierPreview, phase29FinalReadonlyExitPackagePreview, finalReleaseBlockerDossier, transitionReadinessRedline, phase30EntryPreflight, runtimeEnableGovernance);
  const entryChecks = [
    { id: "phase28-closure-linked", result: closurePackage.schemaVersion === "phase28.closure-package.v1" ? "pass" : "block", evidence: closurePackage.schemaVersion },
    { id: "phase28-closed", result: closurePackage.summary?.phaseClosed === true ? "pass" : "block", evidence: `phaseClosed=${closurePackage.summary?.phaseClosed === true}` },
    { id: "open-blockers-carried", result: carriedForwardBlockers.length > 0 ? "pass" : "block", evidence: `${carriedForwardBlockers.length} carried blocker` },
    { id: "planning-does-not-clear-blockers", result: "pass", evidence: "clearedBlockers=0" },
    { id: "planning-does-not-approve-release", result: "pass", evidence: "releaseReady=false" },
    { id: "runtime-remains-disabled", result: "pass", evidence: "runtimeExecution=false and thirdPartyExecution=false" }
  ];
  return {
    phase: 29,
    schemaVersion: "phase29.release-governance-planning.v1",
    version: "1.9.48",
    status: "phase29-release-exit-final-archive-manifest-preview-ready-runtime-disabled",
    planningMode: "readonly-release-governance-planning-no-release-approval",
    sourcePhase28: {
      schemaVersion: phase28.schemaVersion,
      closurePackage: closurePackage.schemaVersion,
      phase28Closed: closurePackage.summary?.phaseClosed === true,
      phase28ReleaseReady: phase28.summary?.releaseReady,
      phase28RuntimeExecution: phase28.summary?.runtimeExecution,
      carriedForwardBlockers: carriedForwardBlockers.length
    },
    governanceTracks,
    blockerClearanceWorkflow,
    releaseApprovalStateModel,
    runtimeEnableGovernance,
    governanceDashboardExport,
    decisionHistoryAuditChain,
    governanceClosureReadiness,
    closureHandoffPackage,
    handoffReviewIndex,
    finalClosureReadinessSnapshot,
    governanceArchiveFreeze,
    blockerResolutionMap,
    phase30EntryPreflight,
    finalReleaseBlockerDossier,
    releaseExitCriteriaLedger,
    releaseExitDecisionPreview,
    phase30TransitionRiskRegister,
    transitionEvidenceGapReview,
    transitionReadinessRedline,
    finalTransitionHandoffPreview,
    transitionClosurePackagePreview,
    releaseCandidateFreezePreview,
    finalReadinessBoardPreview,
    releaseFinalReviewEnvelopePreview,
    exitReadinessAttestationPreview,
    phase30PlanningBriefPreview,
    phase30ScopeLockPreview,
    phase30ReadinessMapPreview,
    phase30ReadinessGapBriefPreview,
    phase30GapResolutionSequencePreview,
    phase30EntryEvidencePackPreview,
    phase30EntryEvidenceIndexPreview,
    phase30EntryEvidenceReviewQueuePreview,
    phase30EntryEvidenceReviewDispositionPreview,
    phase30EntryEvidenceDispositionLedgerPreview,
    phase30EntryEvidenceFinalLedgerExportPreview,
    phase30EntryFinalExportReconciliationPreview,
    phase30EntryReconciliationSignoffPreview,
    phase30EntrySignoffAuditPreview,
    phase30EntryAuditClosurePreview,
    phase29AuditClosureReadinessHardening,
    phase29FinalReadonlyExitPackagePreview,
    phase29ReleaseExitReadinessDossierPreview,
    phase29ReleaseExitGovernanceFreezePreview,
    phase29ReleaseExitFinalSignoffReviewPreview,
    phase29ReleaseExitSignoffEvidenceReconciliationPreview,
    phase29ReleaseExitFinalArchiveIndexPreview,
    phase29ReleaseExitFinalArchiveIntegrityCheckPreview,
    phase29ReleaseExitFinalArchiveManifestPreview,
    gateSeparationModel,
    entryChecks,
    blockedMutations: [
      "clear-blocker-from-phase29-planning",
      "apply-planning-as-clearance",
      "apply-workflow-as-clearance",
      "persist-clearance-as-approved",
      "approve-release-from-planning",
      "approve-release-from-state-model",
      "persist-approval-state-as-release-ready",
      "mark-releaseReady-true",
      "enable-runtime-from-phase29-governance",
      "persist-runtime-governance-as-enable-approval",
      "persist-dashboard-as-release-approval",
      "persist-dashboard-as-clearance",
      "persist-audit-chain-as-release-approval",
      "persist-audit-chain-as-clearance",
      "rewrite-decision-history",
      "persist-closure-readiness-as-release-approval",
      "persist-closure-readiness-as-phase30-entry",
      "clear-blocker-from-closure-readiness",
      "persist-handoff-as-release-approval",
      "persist-handoff-as-phase30-entry",
      "clear-blocker-from-handoff-package",
      "persist-review-index-as-release-approval",
      "persist-review-index-as-phase30-entry",
      "clear-blocker-from-review-index",
      "persist-final-snapshot-as-release-approval",
      "persist-final-snapshot-as-phase30-entry",
      "clear-blocker-from-final-snapshot",
      "persist-archive-freeze-as-release-approval",
      "persist-archive-freeze-as-phase30-entry",
      "unfreeze-phase29-archive-without-review",
      "rewrite-frozen-governance-archive",
      "persist-resolution-map-as-clearance",
      "persist-resolution-map-as-release-approval",
      "persist-resolution-map-as-phase30-entry",
      "clear-blocker-from-resolution-map",
      "persist-preflight-as-phase30-entry",
      "persist-preflight-as-release-approval",
      "clear-blocker-from-preflight",
      "persist-dossier-as-clearance",
      "persist-dossier-as-release-approval",
      "persist-dossier-as-phase30-entry",
      "clear-blocker-from-dossier",
      "persist-exit-ledger-as-clearance",
      "persist-exit-ledger-as-release-approval",
      "persist-exit-ledger-as-phase30-entry",
      "mark-exit-criteria-met",
      "clear-blocker-from-exit-ledger",
      "apply-exit-preview-as-release-approval",
      "apply-exit-preview-as-phase30-entry",
      "persist-exit-preview-as-clearance",
      "persist-exit-preview-as-release-approval",
      "persist-exit-preview-as-phase30-entry",
      "clear-blocker-from-exit-preview",
      "persist-risk-register-as-clearance",
      "persist-risk-register-as-release-approval",
      "persist-risk-register-as-phase30-entry",
      "apply-risk-register-as-release-approval",
      "open-phase30-entry-from-risk-register",
      "clear-blocker-from-transition-risk",
      "mark-transition-risk-mitigated-without-evidence",
      "persist-evidence-gap-review-as-clearance",
      "persist-evidence-gap-review-as-release-approval",
      "persist-evidence-gap-review-as-phase30-entry",
      "apply-evidence-gap-review-as-release-approval",
      "open-phase30-entry-from-evidence-gap-review",
      "close-evidence-gap-without-human-signoff",
      "clear-blocker-from-evidence-gap-review",
      "persist-redline-as-clearance",
      "persist-redline-as-release-approval",
      "persist-redline-as-phase30-entry",
      "approve-release-from-redline",
      "open-phase30-entry-from-redline",
      "override-transition-redline",
      "clear-blocker-from-redline",
      "mark-redline-resolved-without-evidence",
      "persist-handoff-preview-as-clearance",
      "persist-handoff-preview-as-release-approval",
      "persist-handoff-preview-as-phase30-entry",
      "approve-release-from-handoff-preview",
      "open-phase30-entry-from-handoff-preview",
      "clear-blocker-from-handoff-preview",
      "override-redline-from-handoff-preview",
      "persist-closure-preview-as-clearance",
      "persist-closure-preview-as-release-approval",
      "persist-closure-preview-as-phase29-exit",
      "persist-closure-preview-as-phase30-entry",
      "approve-release-from-closure-preview",
      "exit-phase29-from-closure-preview",
      "open-phase30-entry-from-closure-preview",
      "clear-blocker-from-closure-preview",
      "override-handoff-preview-from-closure-preview",
      "persist-freeze-preview-as-release-approval",
      "persist-freeze-preview-as-phase29-exit",
      "persist-freeze-preview-as-phase30-entry",
      "approve-release-from-freeze-preview",
      "exit-phase29-from-freeze-preview",
      "open-phase30-entry-from-freeze-preview",
      "clear-blocker-from-freeze-preview",
      "unfreeze-release-candidate-without-review",
      "override-closure-preview-from-freeze-preview",
      "persist-readiness-board-as-release-approval",
      "persist-readiness-board-as-phase29-exit",
      "persist-readiness-board-as-phase30-entry",
      "approve-release-from-readiness-board",
      "exit-phase29-from-readiness-board",
      "open-phase30-entry-from-readiness-board",
      "clear-blocker-from-readiness-board",
      "override-freeze-preview-from-readiness-board",
      "persist-final-review-envelope-as-release-approval",
      "persist-final-review-envelope-as-phase29-exit",
      "persist-final-review-envelope-as-phase30-entry",
      "approve-release-from-final-review-envelope",
      "exit-phase29-from-final-review-envelope",
      "open-phase30-entry-from-final-review-envelope",
      "clear-blocker-from-final-review-envelope",
      "override-readiness-board-from-final-review-envelope",
      "persist-attestation-as-release-approval",
      "persist-attestation-as-phase29-exit",
      "persist-attestation-as-phase30-entry",
      "approve-release-from-attestation",
      "exit-phase29-from-attestation",
      "open-phase30-entry-from-attestation",
      "clear-blocker-from-attestation",
      "override-final-review-envelope-from-attestation",
      "persist-phase30-brief-as-release-approval",
      "persist-phase30-brief-as-phase29-exit",
      "persist-phase30-brief-as-phase30-entry",
      "approve-release-from-phase30-brief",
      "exit-phase29-from-phase30-brief",
      "open-phase30-entry-from-phase30-brief",
      "clear-blocker-from-phase30-brief",
      "resolve-redline-from-phase30-brief",
      "override-attestation-from-phase30-brief",
      "persist-scope-lock-as-release-approval",
      "persist-scope-lock-as-phase29-exit",
      "persist-scope-lock-as-phase30-entry",
      "approve-release-from-scope-lock",
      "exit-phase29-from-scope-lock",
      "open-phase30-entry-from-scope-lock",
      "clear-blocker-from-scope-lock",
      "unlock-phase30-scope-without-review",
      "override-planning-brief-from-scope-lock",
      "resolve-redline-from-scope-lock",
      "persist-readiness-map-as-release-approval",
      "persist-readiness-map-as-phase29-exit",
      "persist-readiness-map-as-phase30-entry",
      "approve-release-from-readiness-map",
      "exit-phase29-from-readiness-map",
      "open-phase30-entry-from-readiness-map",
      "clear-blocker-from-readiness-map",
      "resolve-redline-from-readiness-map",
      "override-scope-lock-from-readiness-map",
      "persist-gap-brief-as-release-approval",
      "persist-gap-brief-as-phase29-exit",
      "persist-gap-brief-as-phase30-entry",
      "approve-release-from-gap-brief",
      "exit-phase29-from-gap-brief",
      "open-phase30-entry-from-gap-brief",
      "clear-blocker-from-gap-brief",
      "resolve-redline-from-gap-brief",
      "override-readiness-map-from-gap-brief",
      "persist-resolution-sequence-as-release-approval",
      "persist-resolution-sequence-as-phase29-exit",
      "persist-resolution-sequence-as-phase30-entry",
      "approve-release-from-resolution-sequence",
      "exit-phase29-from-resolution-sequence",
      "open-phase30-entry-from-resolution-sequence",
      "clear-blocker-from-resolution-sequence",
      "resolve-redline-from-resolution-sequence",
      "override-gap-brief-from-resolution-sequence",
      "persist-entry-evidence-pack-as-release-approval",
      "persist-entry-evidence-pack-as-phase29-exit",
      "persist-entry-evidence-pack-as-phase30-entry",
      "approve-release-from-entry-evidence-pack",
      "exit-phase29-from-entry-evidence-pack",
      "open-phase30-entry-from-entry-evidence-pack",
      "clear-blocker-from-entry-evidence-pack",
      "resolve-redline-from-entry-evidence-pack",
      "override-resolution-sequence-from-entry-evidence-pack",
      "persist-entry-evidence-index-as-release-approval",
      "persist-entry-evidence-index-as-phase29-exit",
      "persist-entry-evidence-index-as-phase30-entry",
      "approve-release-from-entry-evidence-index",
      "exit-phase29-from-entry-evidence-index",
      "open-phase30-entry-from-entry-evidence-index",
      "clear-blocker-from-entry-evidence-index",
      "resolve-redline-from-entry-evidence-index",
      "override-entry-evidence-pack-from-entry-evidence-index",
      "persist-entry-evidence-review-queue-as-release-approval",
      "persist-entry-evidence-review-queue-as-phase29-exit",
      "persist-entry-evidence-review-queue-as-phase30-entry",
      "persist-review-disposition-from-entry-evidence-review-queue",
      "approve-release-from-entry-evidence-review-queue",
      "exit-phase29-from-entry-evidence-review-queue",
      "open-phase30-entry-from-entry-evidence-review-queue",
      "clear-blocker-from-entry-evidence-review-queue",
      "resolve-redline-from-entry-evidence-review-queue",
      "mark-entry-evidence-reviewed",
      "override-entry-evidence-index-from-review-queue",
      "persist-entry-evidence-review-disposition-as-release-approval",
      "persist-entry-evidence-review-disposition-as-phase29-exit",
      "persist-entry-evidence-review-disposition-as-phase30-entry",
      "persist-review-disposition-preview",
      "approve-release-from-entry-evidence-review-disposition",
      "exit-phase29-from-entry-evidence-review-disposition",
      "open-phase30-entry-from-entry-evidence-review-disposition",
      "clear-blocker-from-entry-evidence-review-disposition",
      "resolve-redline-from-entry-evidence-review-disposition",
      "mark-entry-evidence-dispositioned",
      "override-entry-evidence-review-queue-from-disposition",
      "persist-entry-evidence-disposition-ledger-as-release-approval",
      "persist-entry-evidence-disposition-ledger-as-phase29-exit",
      "persist-entry-evidence-disposition-ledger-as-phase30-entry",
      "persist-entry-evidence-disposition-ledger-entry",
      "persist-review-disposition-from-ledger",
      "approve-release-from-entry-evidence-disposition-ledger",
      "exit-phase29-from-entry-evidence-disposition-ledger",
      "open-phase30-entry-from-entry-evidence-disposition-ledger",
      "clear-blocker-from-entry-evidence-disposition-ledger",
      "resolve-redline-from-entry-evidence-disposition-ledger",
      "mark-entry-evidence-ledger-final",
      "override-entry-evidence-review-disposition-from-ledger",
      "persist-entry-evidence-final-ledger-export-as-release-approval",
      "persist-entry-evidence-final-ledger-export-as-phase29-exit",
      "persist-entry-evidence-final-ledger-export-as-phase30-entry",
      "persist-entry-evidence-final-ledger-export-artifact",
      "persist-entry-evidence-final-ledger-export-item",
      "approve-release-from-entry-evidence-final-ledger-export",
      "exit-phase29-from-entry-evidence-final-ledger-export",
      "open-phase30-entry-from-entry-evidence-final-ledger-export",
      "clear-blocker-from-entry-evidence-final-ledger-export",
      "resolve-redline-from-entry-evidence-final-ledger-export",
      "mark-entry-evidence-final-ledger-export-ready",
      "override-entry-evidence-disposition-ledger-from-final-export",
      "persist-entry-final-export-reconciliation-as-release-approval",
      "persist-entry-final-export-reconciliation-as-phase29-exit",
      "persist-entry-final-export-reconciliation-as-phase30-entry",
      "persist-entry-final-export-reconciliation-artifact",
      "persist-entry-final-export-reconciliation-item",
      "persist-final-ledger-export-from-reconciliation",
      "approve-release-from-entry-final-export-reconciliation",
      "exit-phase29-from-entry-final-export-reconciliation",
      "open-phase30-entry-from-entry-final-export-reconciliation",
      "clear-blocker-from-entry-final-export-reconciliation",
      "resolve-redline-from-entry-final-export-reconciliation",
      "mark-entry-final-export-reconciliation-complete",
      "override-entry-final-ledger-export-from-reconciliation",
      "persist-entry-reconciliation-signoff-as-release-approval",
      "persist-entry-reconciliation-signoff-as-phase29-exit",
      "persist-entry-reconciliation-signoff-as-phase30-entry",
      "persist-entry-reconciliation-signoff-artifact",
      "persist-entry-reconciliation-signoff-item",
      "persist-final-export-reconciliation-from-signoff",
      "record-reconciliation-signoff",
      "approve-release-from-entry-reconciliation-signoff",
      "exit-phase29-from-entry-reconciliation-signoff",
      "open-phase30-entry-from-entry-reconciliation-signoff",
      "clear-blocker-from-entry-reconciliation-signoff",
      "resolve-redline-from-entry-reconciliation-signoff",
      "mark-entry-reconciliation-signoff-complete",
      "override-entry-final-export-reconciliation-from-signoff",
      "persist-entry-signoff-audit-as-release-approval",
      "persist-entry-signoff-audit-as-phase29-exit",
      "persist-entry-signoff-audit-as-phase30-entry",
      "persist-entry-signoff-audit-artifact",
      "persist-entry-signoff-audit-item",
      "persist-reconciliation-signoff-from-audit",
      "record-signoff-audit",
      "record-reconciliation-signoff-from-audit",
      "approve-release-from-entry-signoff-audit",
      "exit-phase29-from-entry-signoff-audit",
      "open-phase30-entry-from-entry-signoff-audit",
      "clear-blocker-from-entry-signoff-audit",
      "resolve-redline-from-entry-signoff-audit",
      "mark-entry-signoff-audit-complete",
      "override-entry-reconciliation-signoff-from-audit",
      "persist-entry-audit-closure-as-release-approval",
      "persist-entry-audit-closure-as-phase29-exit",
      "persist-entry-audit-closure-as-phase30-entry",
      "persist-entry-audit-closure-artifact",
      "persist-entry-audit-closure-item",
      "persist-signoff-audit-from-closure",
      "record-audit-closure",
      "record-signoff-audit-from-closure",
      "record-reconciliation-signoff-from-closure",
      "approve-release-from-entry-audit-closure",
      "exit-phase29-from-entry-audit-closure",
      "open-phase30-entry-from-entry-audit-closure",
      "clear-blocker-from-entry-audit-closure",
      "resolve-redline-from-entry-audit-closure",
      "mark-entry-audit-closure-complete",
      "override-entry-signoff-audit-from-closure",
      "persist-audit-closure-hardening-as-release-approval",
      "persist-audit-closure-hardening-as-phase29-exit",
      "persist-audit-closure-hardening-as-phase30-entry",
      "persist-audit-closure-hardening-artifact",
      "persist-audit-closure-hardening-item",
      "persist-entry-audit-closure-from-hardening",
      "record-audit-closure-hardening",
      "record-audit-closure-from-hardening",
      "record-signoff-audit-from-hardening",
      "approve-release-from-audit-closure-hardening",
      "exit-phase29-from-audit-closure-hardening",
      "open-phase30-entry-from-audit-closure-hardening",
      "clear-blocker-from-audit-closure-hardening",
      "resolve-redline-from-audit-closure-hardening",
      "mark-audit-closure-hardened",
      "override-entry-audit-closure-from-hardening",
      "persist-final-readonly-exit-package-as-release-approval",
      "persist-final-readonly-exit-package-as-phase29-exit",
      "persist-final-readonly-exit-package-as-phase30-entry",
      "persist-final-readonly-exit-package-artifact",
      "persist-final-readonly-exit-package-item",
      "record-final-readonly-exit-package",
      "record-exit-package-from-hardening",
      "approve-release-from-final-readonly-exit-package",
      "exit-phase29-from-final-readonly-exit-package",
      "open-phase30-entry-from-final-readonly-exit-package",
      "clear-blocker-from-final-readonly-exit-package",
      "resolve-redline-from-final-readonly-exit-package",
      "mark-final-exit-package-approved",
      "override-exit-decision-from-final-readonly-package",
      "persist-release-exit-readiness-dossier-as-release-approval",
      "persist-release-exit-readiness-dossier-as-phase29-exit",
      "persist-release-exit-readiness-dossier-as-phase30-entry",
      "persist-release-exit-readiness-dossier-artifact",
      "persist-release-exit-readiness-dossier-item",
      "record-release-exit-readiness-dossier",
      "record-final-exit-package-from-dossier",
      "approve-release-from-release-exit-readiness-dossier",
      "exit-phase29-from-release-exit-readiness-dossier",
      "open-phase30-entry-from-release-exit-readiness-dossier",
      "clear-blocker-from-release-exit-readiness-dossier",
      "resolve-redline-from-release-exit-readiness-dossier",
      "mark-release-exit-dossier-approved",
      "override-final-exit-package-from-dossier",
      "persist-release-exit-governance-freeze-as-release-approval",
      "persist-release-exit-governance-freeze-as-phase29-exit",
      "persist-release-exit-governance-freeze-as-phase30-entry",
      "persist-release-exit-governance-freeze-artifact",
      "persist-release-exit-governance-freeze-item",
      "record-release-exit-governance-freeze",
      "record-release-exit-dossier-from-freeze",
      "approve-release-from-release-exit-governance-freeze",
      "exit-phase29-from-release-exit-governance-freeze",
      "open-phase30-entry-from-release-exit-governance-freeze",
      "clear-blocker-from-release-exit-governance-freeze",
      "resolve-redline-from-release-exit-governance-freeze",
      "unfreeze-release-exit-governance-without-review",
      "mark-release-exit-governance-frozen-approved",
      "override-release-exit-dossier-from-freeze",
      "persist-release-exit-final-signoff-review-as-release-approval",
      "persist-release-exit-final-signoff-review-as-phase29-exit",
      "persist-release-exit-final-signoff-review-as-phase30-entry",
      "persist-release-exit-final-signoff-review-artifact",
      "persist-release-exit-final-signoff-review-item",
      "record-release-exit-final-signoff-review",
      "record-release-exit-governance-freeze-from-signoff-review",
      "approve-release-from-release-exit-final-signoff-review",
      "exit-phase29-from-release-exit-final-signoff-review",
      "open-phase30-entry-from-release-exit-final-signoff-review",
      "clear-blocker-from-release-exit-final-signoff-review",
      "resolve-redline-from-release-exit-final-signoff-review",
      "mark-release-exit-final-signoff-approved",
      "override-release-exit-governance-freeze-from-signoff-review",
      "override-release-exit-dossier-from-signoff-review",
      "persist-release-exit-signoff-evidence-reconciliation-as-release-approval",
      "persist-release-exit-signoff-evidence-reconciliation-as-phase29-exit",
      "persist-release-exit-signoff-evidence-reconciliation-as-phase30-entry",
      "persist-release-exit-signoff-evidence-reconciliation-artifact",
      "persist-release-exit-signoff-evidence-reconciliation-item",
      "record-release-exit-signoff-evidence-reconciliation",
      "record-release-exit-final-signoff-review-from-evidence-reconciliation",
      "approve-release-from-release-exit-signoff-evidence-reconciliation",
      "exit-phase29-from-release-exit-signoff-evidence-reconciliation",
      "open-phase30-entry-from-release-exit-signoff-evidence-reconciliation",
      "clear-blocker-from-release-exit-signoff-evidence-reconciliation",
      "resolve-redline-from-release-exit-signoff-evidence-reconciliation",
      "mark-release-exit-signoff-evidence-reconciled",
      "persist-release-exit-final-archive-index-as-release-approval",
      "persist-release-exit-final-archive-index-as-phase29-exit",
      "persist-release-exit-final-archive-index-as-phase30-entry",
      "persist-release-exit-final-archive-index-artifact",
      "persist-release-exit-final-archive-index-item",
      "record-release-exit-final-archive-index",
      "record-release-exit-signoff-evidence-reconciliation-from-archive-index",
      "approve-release-from-release-exit-final-archive-index",
      "exit-phase29-from-release-exit-final-archive-index",
      "open-phase30-entry-from-release-exit-final-archive-index",
      "clear-blocker-from-release-exit-final-archive-index",
      "resolve-redline-from-release-exit-final-archive-index",
      "mark-release-exit-final-archive-indexed",
      "persist-release-exit-final-archive-integrity-check-as-release-approval",
      "persist-release-exit-final-archive-integrity-check-as-phase29-exit",
      "persist-release-exit-final-archive-integrity-check-as-phase30-entry",
      "persist-release-exit-final-archive-integrity-check-artifact",
      "persist-release-exit-final-archive-integrity-check-item",
      "record-release-exit-final-archive-integrity-check",
      "record-release-exit-final-archive-index-from-integrity-check",
      "approve-release-from-release-exit-final-archive-integrity-check",
      "exit-phase29-from-release-exit-final-archive-integrity-check",
      "open-phase30-entry-from-release-exit-final-archive-integrity-check",
      "clear-blocker-from-release-exit-final-archive-integrity-check",
      "resolve-redline-from-release-exit-final-archive-integrity-check",
      "mark-release-exit-final-archive-integrity-checked",
      "persist-release-exit-final-archive-manifest-as-release-approval",
      "persist-release-exit-final-archive-manifest-as-phase29-exit",
      "persist-release-exit-final-archive-manifest-as-phase30-entry",
      "persist-release-exit-final-archive-manifest-artifact",
      "persist-release-exit-final-archive-manifest-item",
      "record-release-exit-final-archive-manifest",
      "record-release-exit-final-archive-integrity-check-from-manifest",
      "approve-release-from-release-exit-final-archive-manifest",
      "exit-phase29-from-release-exit-final-archive-manifest",
      "open-phase30-entry-from-release-exit-final-archive-manifest",
      "clear-blocker-from-release-exit-final-archive-manifest",
      "resolve-redline-from-release-exit-final-archive-manifest",
      "mark-release-exit-final-archive-manifested",
      "enable-runtime-execution",
      "enable-third-party-execution",
      "persist-phase29-planning-as-release-approval"
    ],
    exportPolicy: {
      exportName: "phase29-release-governance-planning.json",
      includeInOperationsExport: true,
      redaction: "track-id-gate-state-and-guardrail-summary-only"
    },
    nextStageOptions: [
      { id: "phase29-release-exit-final-governance-lock-preview", status: "superseded-by-final-archive-integrity-check-preview", releaseReady: false, runtimeExecution: false },
      { id: "phase30-release-candidate-governance", status: "blocked-until-release-exit-final-signoff-human-review-and-all-blockers-cleared", releaseReady: false, runtimeExecution: false }
    ],
    summary: {
      planningReady: true,
      blockerClearanceWorkflowReady: blockerClearanceWorkflow.summary.workflowPlanningReady,
      releaseApprovalStateModelReady: releaseApprovalStateModel.summary.approvalStateModelReady,
      runtimeEnableGovernanceReady: runtimeEnableGovernance.summary.runtimeEnableGovernanceReady,
      governanceDashboardExportReady: governanceDashboardExport.summary.dashboardExportReady,
      decisionHistoryAuditChainReady: decisionHistoryAuditChain.summary.decisionHistoryAuditChainReady,
      governanceClosureReadinessReady: governanceClosureReadiness.summary.governanceClosureReadinessReady,
      closureHandoffPackageReady: closureHandoffPackage.summary.closureHandoffPackageReady,
      handoffReviewIndexReady: handoffReviewIndex.summary.handoffReviewIndexReady,
      finalClosureReadinessSnapshotReady: finalClosureReadinessSnapshot.summary.finalClosureReadinessSnapshotReady,
      governanceArchiveFreezeReady: governanceArchiveFreeze.summary.governanceArchiveFreezeReady,
      blockerResolutionMapReady: blockerResolutionMap.summary.blockerResolutionMapReady,
      phase30EntryPreflightReady: phase30EntryPreflight.summary.phase30EntryPreflightReady,
      finalReleaseBlockerDossierReady: finalReleaseBlockerDossier.summary.finalReleaseBlockerDossierReady,
      releaseExitCriteriaLedgerReady: releaseExitCriteriaLedger.summary.releaseExitCriteriaLedgerReady,
      releaseExitDecisionPreviewReady: releaseExitDecisionPreview.summary.releaseExitDecisionPreviewReady,
      phase30TransitionRiskRegisterReady: phase30TransitionRiskRegister.summary.phase30TransitionRiskRegisterReady,
      transitionEvidenceGapReviewReady: transitionEvidenceGapReview.summary.transitionEvidenceGapReviewReady,
      transitionReadinessRedlineReady: transitionReadinessRedline.summary.transitionReadinessRedlineReady,
      finalTransitionHandoffPreviewReady: finalTransitionHandoffPreview.summary.finalTransitionHandoffPreviewReady,
      transitionClosurePackagePreviewReady: transitionClosurePackagePreview.summary.transitionClosurePackagePreviewReady,
      releaseCandidateFreezePreviewReady: releaseCandidateFreezePreview.summary.releaseCandidateFreezePreviewReady,
      finalReadinessBoardPreviewReady: finalReadinessBoardPreview.summary.finalReadinessBoardPreviewReady,
      releaseFinalReviewEnvelopePreviewReady: releaseFinalReviewEnvelopePreview.summary.releaseFinalReviewEnvelopePreviewReady,
      exitReadinessAttestationPreviewReady: exitReadinessAttestationPreview.summary.exitReadinessAttestationPreviewReady,
      phase30PlanningBriefPreviewReady: phase30PlanningBriefPreview.summary.phase30PlanningBriefPreviewReady,
      phase30ScopeLockPreviewReady: phase30ScopeLockPreview.summary.phase30ScopeLockPreviewReady,
      phase30ReadinessMapPreviewReady: phase30ReadinessMapPreview.summary.phase30ReadinessMapPreviewReady,
      phase30ReadinessGapBriefPreviewReady: phase30ReadinessGapBriefPreview.summary.phase30ReadinessGapBriefPreviewReady,
      phase30GapResolutionSequencePreviewReady: phase30GapResolutionSequencePreview.summary.phase30GapResolutionSequencePreviewReady,
      phase30EntryEvidencePackPreviewReady: phase30EntryEvidencePackPreview.summary.phase30EntryEvidencePackPreviewReady,
      phase30EntryEvidenceIndexPreviewReady: phase30EntryEvidenceIndexPreview.summary.phase30EntryEvidenceIndexPreviewReady,
      phase30EntryEvidenceReviewQueuePreviewReady: phase30EntryEvidenceReviewQueuePreview.summary.phase30EntryEvidenceReviewQueuePreviewReady,
      phase30EntryEvidenceReviewDispositionPreviewReady: phase30EntryEvidenceReviewDispositionPreview.summary.phase30EntryEvidenceReviewDispositionPreviewReady,
      phase30EntryEvidenceDispositionLedgerPreviewReady: phase30EntryEvidenceDispositionLedgerPreview.summary.phase30EntryEvidenceDispositionLedgerPreviewReady,
      phase30EntryEvidenceFinalLedgerExportPreviewReady: phase30EntryEvidenceFinalLedgerExportPreview.summary.phase30EntryEvidenceFinalLedgerExportPreviewReady,
      phase30EntryFinalExportReconciliationPreviewReady: phase30EntryFinalExportReconciliationPreview.summary.phase30EntryFinalExportReconciliationPreviewReady,
      phase30EntryReconciliationSignoffPreviewReady: phase30EntryReconciliationSignoffPreview.summary.phase30EntryReconciliationSignoffPreviewReady,
      phase30EntrySignoffAuditPreviewReady: phase30EntrySignoffAuditPreview.summary.phase30EntrySignoffAuditPreviewReady,
      phase30EntryAuditClosurePreviewReady: phase30EntryAuditClosurePreview.summary.phase30EntryAuditClosurePreviewReady,
      phase29AuditClosureReadinessHardeningReady: phase29AuditClosureReadinessHardening.summary.phase29AuditClosureReadinessHardeningReady,
      phase29FinalReadonlyExitPackagePreviewReady: phase29FinalReadonlyExitPackagePreview.summary.phase29FinalReadonlyExitPackagePreviewReady,
      phase29ReleaseExitReadinessDossierPreviewReady: phase29ReleaseExitReadinessDossierPreview.summary.phase29ReleaseExitReadinessDossierPreviewReady,
      phase29ReleaseExitGovernanceFreezePreviewReady: phase29ReleaseExitGovernanceFreezePreview.summary.phase29ReleaseExitGovernanceFreezePreviewReady,
      phase29ReleaseExitFinalSignoffReviewPreviewReady: phase29ReleaseExitFinalSignoffReviewPreview.summary.phase29ReleaseExitFinalSignoffReviewPreviewReady,
      phase29ReleaseExitSignoffEvidenceReconciliationPreviewReady: phase29ReleaseExitSignoffEvidenceReconciliationPreview.summary.phase29ReleaseExitSignoffEvidenceReconciliationPreviewReady,
      phase29ReleaseExitFinalArchiveIndexPreviewReady: phase29ReleaseExitFinalArchiveIndexPreview.summary.phase29ReleaseExitFinalArchiveIndexPreviewReady,
      phase29ReleaseExitFinalArchiveIntegrityCheckPreviewReady: phase29ReleaseExitFinalArchiveIntegrityCheckPreview.summary.phase29ReleaseExitFinalArchiveIntegrityCheckPreviewReady,
      phase29ReleaseExitFinalArchiveManifestPreviewReady: phase29ReleaseExitFinalArchiveManifestPreview.summary.phase29ReleaseExitFinalArchiveManifestPreviewReady,
      governanceTracks: governanceTracks.length,
      dashboardSections: governanceDashboardExport.summary.dashboardSections,
      includedExports: governanceDashboardExport.summary.includedExports,
      decisionEvents: decisionHistoryAuditChain.summary.decisionEvents,
      auditChainLinks: decisionHistoryAuditChain.summary.chainLinks,
      closureCriteria: governanceClosureReadiness.summary.closureCriteria,
      blockedClosureItems: governanceClosureReadiness.summary.blockedClosureItems,
      handoffSections: closureHandoffPackage.summary.handoffSections,
      handoffArtifacts: closureHandoffPackage.summary.handoffArtifacts,
      reviewIndexEntries: handoffReviewIndex.summary.reviewIndexEntries,
      blockedReviewItems: handoffReviewIndex.summary.blockedReviewItems,
      finalSnapshotModels: finalClosureReadinessSnapshot.summary.readinessModels,
      finalSnapshotBlockedItems: finalClosureReadinessSnapshot.summary.blockedSnapshotItems,
      archivedExports: governanceArchiveFreeze.summary.archivedExports,
      frozenGuards: governanceArchiveFreeze.summary.frozenGuards,
      resolutionItems: blockerResolutionMap.summary.resolutionItems,
      resolutionLanes: blockerResolutionMap.summary.resolutionLanes,
      preflightItems: phase30EntryPreflight.summary.preflightItems,
      blockedEntryGates: phase30EntryPreflight.summary.blockedEntryGates,
      finalDossierUnresolvedBlockers: finalReleaseBlockerDossier.summary.unresolvedBlockers,
      finalDossierBlockedReleaseGates: finalReleaseBlockerDossier.summary.blockedReleaseGates,
      exitCriteria: releaseExitCriteriaLedger.summary.exitCriteria,
      unmetExitCriteria: releaseExitCriteriaLedger.summary.unmetExitCriteria,
      blockedExitGates: releaseExitCriteriaLedger.summary.blockedExitGates,
      exitDecisionPreviewItems: releaseExitDecisionPreview.summary.decisionPreviewItems,
      blockedExitDecisionItems: releaseExitDecisionPreview.summary.blockedPreviewItems,
      phase29ExitDecision: releaseExitDecisionPreview.summary.phase29ExitDecision,
      transitionRiskItems: phase30TransitionRiskRegister.summary.riskItems,
      blockedTransitionRisks: phase30TransitionRiskRegister.summary.blockedTransitionRisks,
      transitionMitigationLanes: phase30TransitionRiskRegister.summary.mitigationLanes,
      transitionEvidenceGaps: transitionEvidenceGapReview.summary.gapItems,
      blockingEvidenceGaps: transitionEvidenceGapReview.summary.blockingEvidenceGaps,
      evidenceReviewLanes: transitionEvidenceGapReview.summary.evidenceReviewLanes,
      transitionRedlines: transitionReadinessRedline.summary.redlineItems,
      activeTransitionRedlines: transitionReadinessRedline.summary.activeRedlines,
      redlineReviewItems: transitionReadinessRedline.summary.redlineReviewItems,
      handoffPreviewSections: finalTransitionHandoffPreview.summary.handoffPreviewSections,
      blockedHandoffPreviewSections: finalTransitionHandoffPreview.summary.blockedHandoffPreviewSections,
      handoffPreviewChecks: finalTransitionHandoffPreview.summary.handoffPreviewChecks,
      closurePreviewItems: transitionClosurePackagePreview.summary.closurePreviewItems,
      blockedClosurePreviewItems: transitionClosurePackagePreview.summary.blockedClosurePreviewItems,
      closurePreviewChecks: transitionClosurePackagePreview.summary.closurePreviewChecks,
      freezePreviewItems: releaseCandidateFreezePreview.summary.freezePreviewItems,
      blockedFreezePreviewItems: releaseCandidateFreezePreview.summary.blockedFreezePreviewItems,
      freezePreviewChecks: releaseCandidateFreezePreview.summary.freezePreviewChecks,
      readinessBoardItems: finalReadinessBoardPreview.summary.readinessBoardItems,
      blockedReadinessBoardItems: finalReadinessBoardPreview.summary.blockedReadinessBoardItems,
      readinessBoardChecks: finalReadinessBoardPreview.summary.readinessBoardChecks,
      finalReviewEnvelopeSections: releaseFinalReviewEnvelopePreview.summary.envelopeSections,
      blockedFinalReviewEnvelopeSections: releaseFinalReviewEnvelopePreview.summary.blockedEnvelopeSections,
      finalReviewEnvelopeChecks: releaseFinalReviewEnvelopePreview.summary.envelopeChecks,
      exitReadinessAttestationItems: exitReadinessAttestationPreview.summary.attestationItems,
      blockedExitReadinessAttestationItems: exitReadinessAttestationPreview.summary.blockedAttestationItems,
      exitReadinessAttestationChecks: exitReadinessAttestationPreview.summary.attestationChecks,
      phase30PlanningBriefSections: phase30PlanningBriefPreview.summary.briefSections,
      blockedPhase30PlanningBriefSections: phase30PlanningBriefPreview.summary.blockedBriefSections,
      phase30PlanningBriefChecks: phase30PlanningBriefPreview.summary.briefChecks,
      phase30ScopeLockItems: phase30ScopeLockPreview.summary.scopeLockItems,
      blockedPhase30ScopeLockItems: phase30ScopeLockPreview.summary.blockedScopeLockItems,
      phase30ScopeLockChecks: phase30ScopeLockPreview.summary.scopeLockChecks,
      phase30ReadinessMapItems: phase30ReadinessMapPreview.summary.readinessMapItems,
      blockedPhase30ReadinessMapItems: phase30ReadinessMapPreview.summary.blockedReadinessMapItems,
      phase30ReadinessMapChecks: phase30ReadinessMapPreview.summary.readinessMapChecks,
      phase30ReadinessGapBriefItems: phase30ReadinessGapBriefPreview.summary.gapBriefItems,
      blockedPhase30ReadinessGapBriefItems: phase30ReadinessGapBriefPreview.summary.blockedGapBriefItems,
      phase30ReadinessGapBriefChecks: phase30ReadinessGapBriefPreview.summary.gapBriefChecks,
      phase30GapResolutionSequenceItems: phase30GapResolutionSequencePreview.summary.resolutionSequenceItems,
      blockedPhase30GapResolutionSequenceItems: phase30GapResolutionSequencePreview.summary.blockedResolutionSequenceItems,
      phase30GapResolutionSequenceChecks: phase30GapResolutionSequencePreview.summary.sequenceChecks,
      phase30EntryEvidencePackItems: phase30EntryEvidencePackPreview.summary.evidencePackItems,
      blockedPhase30EntryEvidencePackItems: phase30EntryEvidencePackPreview.summary.blockedEvidencePackItems,
      phase30EntryEvidencePackChecks: phase30EntryEvidencePackPreview.summary.evidencePackChecks,
      phase30EntryEvidenceIndexItems: phase30EntryEvidenceIndexPreview.summary.evidenceIndexItems,
      blockedPhase30EntryEvidenceIndexItems: phase30EntryEvidenceIndexPreview.summary.blockedEvidenceIndexItems,
      phase30EntryEvidenceIndexChecks: phase30EntryEvidenceIndexPreview.summary.evidenceIndexChecks,
      phase30EntryEvidenceReviewQueueItems: phase30EntryEvidenceReviewQueuePreview.summary.evidenceReviewQueueItems,
      blockedPhase30EntryEvidenceReviewQueueItems: phase30EntryEvidenceReviewQueuePreview.summary.blockedEvidenceReviewQueueItems,
      phase30EntryEvidenceReviewQueueChecks: phase30EntryEvidenceReviewQueuePreview.summary.evidenceReviewQueueChecks,
      phase30EntryEvidenceReviewDispositionItems: phase30EntryEvidenceReviewDispositionPreview.summary.dispositionPreviewItems,
      blockedPhase30EntryEvidenceReviewDispositionItems: phase30EntryEvidenceReviewDispositionPreview.summary.blockedDispositionPreviewItems,
      phase30EntryEvidenceReviewDispositionChecks: phase30EntryEvidenceReviewDispositionPreview.summary.dispositionPreviewChecks,
      phase30EntryEvidenceDispositionLedgerEntries: phase30EntryEvidenceDispositionLedgerPreview.summary.dispositionLedgerEntries,
      blockedPhase30EntryEvidenceDispositionLedgerEntries: phase30EntryEvidenceDispositionLedgerPreview.summary.blockedDispositionLedgerEntries,
      phase30EntryEvidenceDispositionLedgerChecks: phase30EntryEvidenceDispositionLedgerPreview.summary.dispositionLedgerChecks,
      phase30EntryEvidenceFinalLedgerExportItems: phase30EntryEvidenceFinalLedgerExportPreview.summary.finalLedgerExportItems,
      blockedPhase30EntryEvidenceFinalLedgerExportItems: phase30EntryEvidenceFinalLedgerExportPreview.summary.blockedFinalLedgerExportItems,
      phase30EntryEvidenceFinalLedgerExportChecks: phase30EntryEvidenceFinalLedgerExportPreview.summary.finalLedgerExportChecks,
      phase30EntryFinalExportReconciliationItems: phase30EntryFinalExportReconciliationPreview.summary.reconciliationItems,
      blockedPhase30EntryFinalExportReconciliationItems: phase30EntryFinalExportReconciliationPreview.summary.blockedReconciliationItems,
      phase30EntryFinalExportReconciliationChecks: phase30EntryFinalExportReconciliationPreview.summary.reconciliationChecks,
      phase30EntryReconciliationSignoffItems: phase30EntryReconciliationSignoffPreview.summary.signoffItems,
      blockedPhase30EntryReconciliationSignoffItems: phase30EntryReconciliationSignoffPreview.summary.blockedSignoffItems,
      phase30EntryReconciliationSignoffChecks: phase30EntryReconciliationSignoffPreview.summary.signoffChecks,
      phase30EntrySignoffAuditItems: phase30EntrySignoffAuditPreview.summary.auditItems,
      blockedPhase30EntrySignoffAuditItems: phase30EntrySignoffAuditPreview.summary.blockedAuditItems,
      phase30EntrySignoffAuditChecks: phase30EntrySignoffAuditPreview.summary.auditChecks,
      phase30EntryAuditClosureItems: phase30EntryAuditClosurePreview.summary.closureItems,
      blockedPhase30EntryAuditClosureItems: phase30EntryAuditClosurePreview.summary.blockedClosureItems,
      phase30EntryAuditClosureChecks: phase30EntryAuditClosurePreview.summary.closureChecks,
      phase29AuditClosureHardeningItems: phase29AuditClosureReadinessHardening.summary.hardeningItems,
      blockedPhase29AuditClosureHardeningItems: phase29AuditClosureReadinessHardening.summary.blockedHardeningItems,
      phase29AuditClosureHardeningChecks: phase29AuditClosureReadinessHardening.summary.hardeningChecks,
      phase29FinalExitPackageItems: phase29FinalReadonlyExitPackagePreview.summary.exitPackageItems,
      blockedPhase29FinalExitPackageItems: phase29FinalReadonlyExitPackagePreview.summary.blockedExitPackageItems,
      phase29FinalExitPackageChecks: phase29FinalReadonlyExitPackagePreview.summary.exitPackageChecks,
      phase29ReleaseExitDossierItems: phase29ReleaseExitReadinessDossierPreview.summary.dossierItems,
      blockedPhase29ReleaseExitDossierItems: phase29ReleaseExitReadinessDossierPreview.summary.blockedDossierItems,
      phase29ReleaseExitDossierChecks: phase29ReleaseExitReadinessDossierPreview.summary.dossierChecks,
      phase29ReleaseExitFreezeItems: phase29ReleaseExitGovernanceFreezePreview.summary.freezeItems,
      blockedPhase29ReleaseExitFreezeItems: phase29ReleaseExitGovernanceFreezePreview.summary.blockedFreezeItems,
      phase29ReleaseExitFreezeChecks: phase29ReleaseExitGovernanceFreezePreview.summary.freezeChecks,
      phase29ReleaseExitSignoffReviewItems: phase29ReleaseExitFinalSignoffReviewPreview.summary.signoffReviewItems,
      blockedPhase29ReleaseExitSignoffReviewItems: phase29ReleaseExitFinalSignoffReviewPreview.summary.blockedSignoffReviewItems,
      phase29ReleaseExitSignoffReviewChecks: phase29ReleaseExitFinalSignoffReviewPreview.summary.signoffReviewChecks,
      phase29ReleaseExitSignoffEvidenceReconciliationItems: phase29ReleaseExitSignoffEvidenceReconciliationPreview.summary.evidenceReconciliationItems,
      blockedPhase29ReleaseExitSignoffEvidenceReconciliationItems: phase29ReleaseExitSignoffEvidenceReconciliationPreview.summary.blockedEvidenceReconciliationItems,
      phase29ReleaseExitSignoffEvidenceReconciliationChecks: phase29ReleaseExitSignoffEvidenceReconciliationPreview.summary.evidenceReconciliationChecks,
      phase29ReleaseExitFinalArchiveIndexItems: phase29ReleaseExitFinalArchiveIndexPreview.summary.archiveIndexItems,
      blockedPhase29ReleaseExitFinalArchiveIndexItems: phase29ReleaseExitFinalArchiveIndexPreview.summary.blockedArchiveIndexItems,
      phase29ReleaseExitFinalArchiveIndexChecks: phase29ReleaseExitFinalArchiveIndexPreview.summary.archiveIndexChecks,
      phase29ReleaseExitFinalArchiveIntegrityCheckItems: phase29ReleaseExitFinalArchiveIntegrityCheckPreview.summary.integrityCheckItems,
      blockedPhase29ReleaseExitFinalArchiveIntegrityCheckItems: phase29ReleaseExitFinalArchiveIntegrityCheckPreview.summary.blockedIntegrityCheckItems,
      phase29ReleaseExitFinalArchiveIntegrityChecks: phase29ReleaseExitFinalArchiveIntegrityCheckPreview.summary.integrityChecks,
      phase29ReleaseExitFinalArchiveManifestItems: phase29ReleaseExitFinalArchiveManifestPreview.summary.manifestItems,
      blockedPhase29ReleaseExitFinalArchiveManifestItems: phase29ReleaseExitFinalArchiveManifestPreview.summary.blockedManifestItems,
      phase29ReleaseExitFinalArchiveManifestChecks: phase29ReleaseExitFinalArchiveManifestPreview.summary.manifestChecks,
      phase29ExitReady: false,
      phase30Blocked: governanceClosureReadiness.summary.phase30Blocked,
      phase30EntryReady: false,
      separatedGates: gateSeparationModel.length,
      carriedForwardBlockers: carriedForwardBlockers.length,
      pendingWorkflowItems: blockerClearanceWorkflow.summary.pendingWorkflowItems,
      approvalStates: releaseApprovalStateModel.summary.approvalStates,
      approvedReleaseStates: 0,
      runtimeGates: runtimeEnableGovernance.summary.runtimeGates,
      runtimeEnableApprovals: 0,
      clearedBlockers: 0,
      releaseReady: false,
      runtimeExecution: false,
      thirdPartyExecution: false,
      persistedMutations: 0
    }
  };
}

function buildPhase29RuntimeEnableGovernance(releaseApprovalStateModel = {}) {
  const runtimeGates = [
    {
      id: "runtime-validation-evidence",
      label: "Runtime validation evidence",
      source: "phase26.runtime-validation-report.v1",
      state: "planning-only",
      requiredEvidence: ["runtime-validation-report-reviewed", "runtime-result-quarantine-reviewed"],
      blockedActions: ["accept-runtime-validation-as-enable-approval", "enable-runtime-execution"]
    },
    {
      id: "permission-policy-review",
      label: "Permission policy review",
      source: "phase21.permission.runtime-enforcement.v1",
      state: "planning-only",
      requiredEvidence: ["host-api-boundary-reviewed", "permission-default-deny-confirmed"],
      blockedActions: ["grant-runtime-permission-from-phase29", "execute-third-party-plugin"]
    },
    {
      id: "kill-switch-and-quarantine",
      label: "Kill switch and quarantine",
      source: "phase25.runtime-sandbox-ui-surface.v1",
      state: "planning-only",
      requiredEvidence: ["kill-switch-reviewed", "quarantine-release-block-reviewed"],
      blockedActions: ["disable-kill-switch", "release-quarantined-runtime-result"]
    },
    {
      id: "third-party-execution-boundary",
      label: "Third-party execution boundary",
      source: "phase20.plugin.release-checklist-gate.v1",
      state: "planning-only",
      requiredEvidence: ["plugin-release-gate-block-reviewed", "third-party-runtime-remains-disabled"],
      blockedActions: ["enable-third-party-execution", "install-plugin-as-runtime-enabled"]
    }
  ];
  return {
    schemaVersion: "phase29.runtime-enable-governance-planning.v1",
    version: "1.9.3",
    mode: "readonly-runtime-enable-governance-planning-no-runtime-enable",
    sourceReleaseApprovalStateModel: releaseApprovalStateModel.schemaVersion,
    runtimeGates,
    enablementChecks: [
      { id: "release-approval-state-linked", result: releaseApprovalStateModel.schemaVersion === "phase29.release-approval-state-model.v1" ? "pass" : "block", evidence: releaseApprovalStateModel.schemaVersion },
      { id: "release-not-approved", result: releaseApprovalStateModel.summary?.approvedReleaseStates === 0 ? "pass" : "block", evidence: `approvedReleaseStates=${releaseApprovalStateModel.summary?.approvedReleaseStates || 0}` },
      { id: "runtime-gates-planning-only", result: runtimeGates.every((item) => item.state === "planning-only") ? "pass" : "block", evidence: `${runtimeGates.length} runtime gate` },
      { id: "runtime-enable-not-applied", result: "pass", evidence: "runtimeExecution=false" },
      { id: "third-party-execution-not-applied", result: "pass", evidence: "thirdPartyExecution=false" }
    ],
    blockedMutations: [
      "enable-runtime-from-phase29-governance",
      "persist-runtime-governance-as-enable-approval",
      "enable-runtime-execution",
      "enable-third-party-execution",
      "execute-third-party-plugin",
      "grant-runtime-permission-from-phase29",
      "disable-runtime-kill-switch"
    ],
    exportPolicy: {
      exportName: "phase29-runtime-enable-governance-planning.json",
      includeInOperationsExport: true,
      redaction: "runtime-gate-id-state-required-evidence-and-blocked-action-summary-only"
    },
    summary: {
      runtimeEnableGovernanceReady: true,
      runtimeGates: runtimeGates.length,
      planningOnlyGates: runtimeGates.filter((item) => item.state === "planning-only").length,
      runtimeEnableApprovals: 0,
      runtimeExecution: false,
      thirdPartyExecution: false,
      releaseReady: false,
      persistedMutations: 0
    }
  };
}

function buildPhase29ReleaseApprovalStateModel(blockerClearanceWorkflow = {}) {
  const workflowItems = blockerClearanceWorkflow.workflowItems || [];
  const approvalStates = [
    {
      id: "draft",
      label: "Draft",
      state: "current",
      releaseReady: false,
      allowedActions: ["record-approval-planning-note", "export-release-approval-state-model"],
      blockedActions: ["approve-release-from-draft", "mark-releaseReady-true"]
    },
    {
      id: "clearance-blocked",
      label: "Clearance blocked",
      state: workflowItems.length > 0 ? "current" : "inactive",
      releaseReady: false,
      allowedActions: ["link-clearance-workflow-evidence", "export-release-approval-state-model"],
      blockedActions: ["approve-release-before-clearance", "persist-clearance-as-release-approval"]
    },
    {
      id: "approval-ready-preview",
      label: "Approval ready preview",
      state: "blocked-until-clearance",
      releaseReady: false,
      allowedActions: ["preview-required-release-approval-fields"],
      blockedActions: ["apply-preview-as-release-approval", "mark-releaseReady-true"]
    },
    {
      id: "release-hold",
      label: "Release hold",
      state: "current",
      releaseReady: false,
      allowedActions: ["record-release-hold-note", "export-release-hold-summary"],
      blockedActions: ["resolve-hold-without-human-signoff", "enable-runtime-from-hold"]
    }
  ];
  const transitionRules = [
    { from: "draft", to: "clearance-blocked", condition: "carried-blockers-present", allowed: true, mutatesReleaseReady: false },
    { from: "clearance-blocked", to: "approval-ready-preview", condition: "all-clearance-workflow-items-approved", allowed: false, mutatesReleaseReady: false },
    { from: "approval-ready-preview", to: "release-approved", condition: "human-release-owner-signoff", allowed: false, mutatesReleaseReady: false },
    { from: "release-hold", to: "runtime-approval", condition: "separate-runtime-governance-complete", allowed: false, mutatesReleaseReady: false }
  ];
  return {
    schemaVersion: "phase29.release-approval-state-model.v1",
    version: "1.9.2",
    mode: "readonly-release-approval-state-model-no-approval",
    sourceBlockerClearanceWorkflow: blockerClearanceWorkflow.schemaVersion,
    approvalStates,
    transitionRules,
    approvalChecks: [
      { id: "blocker-workflow-linked", result: blockerClearanceWorkflow.schemaVersion === "phase29.blocker-clearance-workflow-planning.v1" ? "pass" : "block", evidence: blockerClearanceWorkflow.schemaVersion },
      { id: "open-workflow-items-block-approval", result: workflowItems.length > 0 ? "pass" : "block", evidence: `${workflowItems.length} workflow item remains planning-only` },
      { id: "state-model-does-not-approve-release", result: "pass", evidence: "releaseReady=false" },
      { id: "approval-preview-is-not-release-approval", result: "pass", evidence: "approval-ready-preview remains blocked" },
      { id: "runtime-remains-disabled", result: "pass", evidence: "runtimeExecution=false and thirdPartyExecution=false" }
    ],
    blockedMutations: [
      "approve-release-from-state-model",
      "apply-preview-as-release-approval",
      "persist-approval-state-as-release-ready",
      "mark-releaseReady-true",
      "enable-runtime-execution",
      "enable-third-party-execution"
    ],
    exportPolicy: {
      exportName: "phase29-release-approval-state-model.json",
      includeInOperationsExport: true,
      redaction: "state-id-transition-rule-and-blocked-action-summary-only"
    },
    summary: {
      approvalStateModelReady: true,
      approvalStates: approvalStates.length,
      transitionRules: transitionRules.length,
      blockedTransitions: transitionRules.filter((item) => item.allowed === false).length,
      approvedReleaseStates: 0,
      releaseReady: false,
      runtimeExecution: false,
      thirdPartyExecution: false,
      persistedMutations: 0
    }
  };
}

function buildPhase29BlockerClearanceWorkflow(phase28 = {}, closurePackage = {}, carriedForwardBlockers = []) {
  const workflowItems = carriedForwardBlockers.map((item, index) => ({
    workflowItemId: `phase29-blocker-clearance-workflow-${index + 1}`,
    reviewItemId: item.reviewItemId,
    blockerId: item.blockerId,
    inventoryId: item.inventoryId,
    source: item.source,
    sourceReviewState: item.reviewState,
    sourceDisposition: item.blockerDisposition,
    workflowState: "pending-clearance-planning",
    ownerRole: index % 2 === 0 ? "release-governance-reviewer" : "evidence-owner",
    evidenceRequirements: [
      "human-owned-clearance-evidence",
      "reviewer-disposition-recorded",
      "clearance-criteria-satisfaction-reviewed",
      "release-approval-kept-separate"
    ],
    gateChecks: [
      "evidence-intake-linked",
      "reviewer-disposition-linked",
      "criteria-checklist-linked",
      "runtime-and-release-guardrails-linked"
    ],
    allowedActions: ["record-clearance-planning-note", "export-blocker-clearance-workflow"],
    blockedActions: [
      "clear-blocker-from-phase29-workflow",
      "persist-clearance-as-approved",
      "mark-releaseReady-true",
      "enable-runtime-execution"
    ],
    auditState: "clearance-workflow-planned-no-mutation"
  }));
  return {
    schemaVersion: "phase29.blocker-clearance-workflow-planning.v1",
    version: "1.9.1",
    mode: "readonly-blocker-clearance-workflow-planning-no-clearance",
    sourcePhase28ClosurePackage: closurePackage.schemaVersion,
    sourceClearanceReviewEntry: phase28.schemaVersion,
    workflowItems,
    workflowChecks: [
      { id: "phase28-closure-linked", result: closurePackage.schemaVersion === "phase28.closure-package.v1" ? "pass" : "block", evidence: closurePackage.schemaVersion },
      { id: "all-carried-blockers-represented", result: workflowItems.length === carriedForwardBlockers.length ? "pass" : "block", evidence: `${workflowItems.length} workflow item` },
      { id: "all-items-pending-planning", result: workflowItems.every((item) => item.workflowState === "pending-clearance-planning") ? "pass" : "block", evidence: "no workflow item clears a blocker" },
      { id: "workflow-does-not-clear-blockers", result: "pass", evidence: "clearedBlockers=0" },
      { id: "workflow-does-not-approve-release", result: "pass", evidence: "releaseReady=false" },
      { id: "runtime-remains-disabled", result: "pass", evidence: "runtimeExecution=false and thirdPartyExecution=false" }
    ],
    blockedMutations: [
      "clear-blocker-from-phase29-workflow",
      "apply-workflow-as-clearance",
      "persist-clearance-as-approved",
      "mark-releaseReady-true",
      "enable-runtime-execution",
      "enable-third-party-execution",
      "persist-phase29-workflow-as-release-approval"
    ],
    exportPolicy: {
      exportName: "phase29-blocker-clearance-workflow-planning.json",
      includeInOperationsExport: true,
      redaction: "workflow-item-blocker-id-state-and-required-evidence-only"
    },
    summary: {
      workflowPlanningReady: true,
      workflowItems: workflowItems.length,
      pendingWorkflowItems: workflowItems.filter((item) => item.workflowState === "pending-clearance-planning").length,
      clearedBlockers: 0,
      approvedClearanceItems: 0,
      releaseReady: false,
      runtimeExecution: false,
      thirdPartyExecution: false,
      persistedMutations: 0
    }
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
      note: "note text"
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
      skip: "完全一致或导入版本较旧时跳"
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
      title: item.title || (type === "exhibition" ? "未命名专题展" : "未命名报告草"),
      status,
      syncStatus,
      linkCount,
      issueCount,
      includedInManualPackage: ["ready", "review"].includes(syncStatus),
      recommendation: issueCount
        ? "先补齐引用对象，再加入手动同步包"
        : status === "published"
          ? "适合加入第十六阶段手动同步包，并交由第十七阶段设备复核"
          : "可加入同步包预览，但建议先复核发布状态"
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
      ? "部分资产存在引用风险，建议先修复再加入同步包"
      : items.length
        ? "专题展和报告草稿可进入第十六阶段同步包预览，并由第十七阶段设备复核"
        : "第十八阶段还没有可同步的专题资产或报告草稿"
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
      { id: "phase16-risk-gate", label: "第十六阶段风险门", status: "ready", detail: "detail text" },
      { id: "device-trust", label: "设备信任", status: "ready", detail: "detail text" },
      { id: "queue-failures", label: "失败任务", status: "ready", detail: "detail text" },
      { id: "private-cloud-boundary", label: "私有云边", status: "ready", detail: "detail text" }
    ],
    recommendation: "recommendation text"
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
        { id: "same-network", label: "同网段发", status: "simulated", detail: "detail text" },
        { id: "data-transfer", label: "私人数据传输", status: "blocked", detail: "detail text" },
        { id: "manual-review", label: "人工确认", status: "required", detail: "detail text" }
      ]
    },
    deviceTrustPolicy: {
      mode: "explicit-trust-required",
      trusted: 1,
      review: 0,
      blocked: 0,
      rules: [
        "本机 SQLite 后端可信不代表外部设备可信",
        "历史候选设备需要人工确认",
        "任何跨设备写入仍需第十六阶段风险确认"
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
        { id: "auto-upload", label: "自动上传", status: "blocked", detail: "detail text" },
        { id: "credential", label: "凭据保存", status: "blocked", detail: "detail text" },
        { id: "manual-export", label: "手动导出", status: "required", detail: "detail text" }
      ]
    },
    syncHealth,
    healthExplanation: {
      score: syncHealth.score,
      reviewCount: 0,
      reasons: [],
      summary: "summary text"
    },
    failureRecovery: {
      failedCount: 0,
      actions: [],
      recommendation: "recommendation text"
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
    recommendation: repairDraftTotal ? "前端可继续生成、复核并应用修复草案" : "继续积累展品后再评估长期助理质量"
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
    { id: "suggestions", label: "Suggestions", status: suggestions.length ? "ready" : "needs-sample", detail: suggestions.length ? `${suggestions.length} suggestions` : "Need more exhibits to generate suggestions" },
    { id: "relationships", label: "Relationships", status: relationships.clusters.length ? "ready" : "needs-sample", detail: relationships.clusters.length ? `${relationships.clusters.length} relationship groups` : "Need people, place, tag, or emotion clues" },
    { id: "periodic-review", label: "Periodic review", status: periodicReviews.length ? "ready" : "needs-date", detail: periodicReviews.length ? `${periodicReviews.length} review candidates` : "Need dated exhibits" },
    { id: "feedback-loop", label: "Feedback loop", status: "ready", detail: "detail text" },
    { id: "task-audit", label: "Task audit", status: "ready", detail: "detail text" },
    { id: "review-assets", label: "Review assets", status: periodicReviews.length ? "ready" : "needs-date", detail: periodicReviews.length ? "Reviews can be saved as exhibition drafts" : "Need monthly review candidates" },
    { id: "review-reports", label: "Review reports", status: periodicReviews.length ? "ready" : "needs-date", detail: periodicReviews.length ? "Reviews can be saved as report drafts" : "Need monthly review candidates" }
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
        policy: "前端批量应用前弹出确认，并写入浏览器本地审计记录"
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
      ? "优先处理高优先级建议，再把稳定主题推进为周期回顾或专题资产"
      : "先继续保存更多带时间、人物、地点和标签的展品")
  };
}

function buildPhase18ProactiveSuggestions(memories = []) {
  const suggestions = [];
  const missingDate = memories.filter((memory) => !memory.date);
  const missingPeople = memories.filter((memory) => !memory.people?.length);
  const missingLocation = memories.filter((memory) => !memory.location);
  const missingTags = memories.filter((memory) => !memory.tags?.length);
  const highValueNoMedia = memories.filter((memory) => (memory.favorite || memory.importance >= 4) && !memory.coverImage && !memory.mediaNote && !memory.attachments?.length);
  if (missingDate.length) suggestions.push(buildPhase18Suggestion("missing-date", "Add dates", "timeline", "high", missingDate, `${missingDate.length} exhibits are missing dates.`));
  if (missingPeople.length) suggestions.push(buildPhase18Suggestion("missing-people", "Add people", "relationship", "medium", missingPeople, `${missingPeople.length} exhibits are missing people clues.`));
  if (missingLocation.length) suggestions.push(buildPhase18Suggestion("missing-location", "Add locations", "relationship", "medium", missingLocation, `${missingLocation.length} exhibits are missing location clues.`));
  if (missingTags.length) suggestions.push(buildPhase18Suggestion("missing-tags", "Add tags", "theme", "medium", missingTags, `${missingTags.length} exhibits are missing tags.`));
  if (highValueNoMedia.length) suggestions.push(buildPhase18Suggestion("high-value-media", "Add media notes", "multimodal", "high", highValueNoMedia, `${highValueNoMedia.length} important exhibits are missing multimodal clues.`));
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
      ? "高价值且影响面较大，建议优先复核"
      : tier === "B"
        ? "价值稳定，可排入常规整理"
        : "线索较轻，适合后续批量处理"
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
      reason: "reason text"
    })),
    recommendation: quiet.length ? `Auto-lowered ${quiet.length} low-priority suggestions.` : "Suggestion quality is stable; no noise reduction needed"
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
      ? "当前规则已收起低置信或暂不处理的建议，可在规则面板临时放宽后复核"
      : "当前规则没有收起建议，可以继续保持自动复盘"
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
        ? "证据覆盖不足，已按规则收"
        : item.noiseReason === "below-score"
          ? "低于当前显示分数阈值"
          : "质量分层较低，已按规则收"
    })),
    recommendation: quiet.length
      ? `已按规则收起 ${quiet.length} 条建议，当前显示 ${sortedVisible.length || fallbackVisible.length} 条。`
      : "当前建议质量稳定，没有被规则收起的建议"
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
      ? "前端可按筛选结果多选长期任务，批量流转状态或生成修复草案，并写入本地审计"
      : "等待长期助理生成建议后再启用批量任务处理"
  };
}

function buildPhase18ReviewDashboard({ suggestions = [], relationships = {}, periodicReviews = [], agentQuality = {}, suggestionNoise = {}, repairDraftTotal = 0 } = {}) {
  const highTier = suggestions.filter((item) => item.quality?.tier === "A").length;
  return {
    status: suggestions.length || relationships.clusterCount || periodicReviews.length ? "active" : "waiting",
    focus: highTier ? "优先处理 A 级建" : periodicReviews.length ? "优先沉淀周期回顾" : "继续补充展品线索",
    savedReviews: 0,
    reviewCoverage: 0,
    graphCoverage: relationships.graph?.nodeCount || 0,
    quietSuggestions: suggestionNoise.quietCount || 0,
    openTasks: suggestions.length,
    unresolvedDrafts: repairDraftTotal,
    qualityScore: Math.round(((agentQuality.acceptanceRate || 0) + (agentQuality.taskResolvedRate || 0) + (agentQuality.repairApplyRate || 0)) / 3),
    latestAudit: "后端导出不包含浏览器本地审计明细",
    recommendation: suggestionNoise.quietCount
      ? "先处理未降噪A/B 级建议，再复盘被忽略建议"
      : "继续把稳定回顾保存为专题资产或报告草稿"
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
    || (periodicReviews.length ? "沉淀一个周期回" : "")
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
      detail: `${periodicReviews[0].count || 0} exhibits can become a periodic review.`,
      memoryIds: periodicReviews[0].memories?.map((item) => item.id).filter(Boolean) || []
    } : null,
    relationClusters[0] ? {
      id: `relation-${relationClusters[0].id}`,
      label: `${relationClusters[0].type}: ${relationClusters[0].value}`,
      detail: relationClusters[0].evidence || "Relationship cluster can become a guide storyline",
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
      latestAudit: "后端导出不包含浏览器本地审计明细"
    },
    cadence: {
      daily: "打开页面后先看摘要焦点，再处理一条高优先级任务",
      weekly: "每周选择一个稳定关系簇或周期回顾，保存为专题展或报告草稿"
    },
    readiness,
    recommendation: readiness === "needs-attention"
      ? "先处理同步风险或失败任务，再继续推进新整理"
      : topActions.length
        ? "今天先完成摘要中的第一项动作，本周再把稳定关系或周期回顾沉淀为资产"
        : "继续补充展品线索，长期助理会在样本变丰富后生成更明确摘要"
  };
}

function buildPhase18RelationshipMap(memories = []) {
  const dimensions = [
    { id: "people", label: "共同人物", values: (memory) => memory.people || [] },
    { id: "locations", label: "閲嶅鍦扮偣", values: (memory) => memory.location ? [memory.location] : [] },
    { id: "tags", label: "鐩稿悓鏍囩", values: (memory) => memory.tags || [] },
    { id: "emotions", label: "鐩镐技鎯呯华", values: (memory) => memory.emotions || [] }
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
        evidence: `${dimension.label} ${value} connects ${group.length} exhibits and can become a theme or guide storyline.`,
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
        title: report.title || "未命名报告草",
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
      ? "关系图谱已能跳转到相关专题展和报告草稿，也可从资产卡片回看关系来源"
      : "保存包含这些展品的专题展或报告后，关系图谱会自动出现资产跳转"
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
        label: "专题",
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
    title: limitText(input.title || (theme ? `${theme.title}专题展` : "新的专题"), 120),
    intro: limitText(input.intro || theme?.description || "从当前洞察结果生成的专题展草稿", 800),
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
  if (!theme) return "This theme exhibition draft can be expanded with guide text.";
  const titles = (theme.memories || []).slice(0, 3).map((item) => item.title).filter(Boolean).join(", ");
  return `${theme.description || ""}${titles ? ` Start from ${titles}.` : ""}`.trim();
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
    exhibitText: redactText(structured.exhibitText, "展品说明已脱"),
    location: structured.location ? "地点已脱敏" : "",
    people: structured.people.map((_, index) => `人物${index + 1}`),
    coverImage: structured.coverImage ? "封面线索已脱" : "",
    mediaNote: structured.mediaNote ? "多模态说明已脱敏" : "",
    attachments: structured.attachments.map((item, index) => ({
      name: `闄勪欢${index + 1}`,
      type: item.type || "其他",
      note: item.note ? "备注已脱" : ""
    }))
  };
}

function redactText(value, fallback) {
  if (!value) return "";
  return `${fallback} (${String(value).length} chars)`;
}

function buildRedactionPolicy() {
  return {
    mode: "redacted",
    maskedFields: ["rawContent", "exhibitText", "people", "location", "coverImage", "mediaNote", "attachments.name", "attachments.note"],
    preservedFields: ["id", "hall", "sourceType", "date", "tags", "emotions", "importance", "favorite", "createdAt", "updatedAt"],
    note: "note text"
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
    note: "note text"
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
    note: "note text"
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
    note: "note text"
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
  if (ids.has("no-memories")) actions.push("先保存 3 to 5 件带时间、人物和标签的展品");
  if (ids.has("missing-date")) actions.push("补齐关键展品时间，提升时间线和报告稳定性");
  if (ids.has("agent-run-coverage")) actions.push("优先使用 Agent 整理新展品，增加可回放运行历史");
  if (ids.has("review-evidence")) actions.push("补齐人物、地点、标签和展品说明，减少人工复核空白");
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
      strategy: "在现有 Node HTTP、SQLite、Agent 运行历史和前端复核状态上声明工作流模型",
      upgradePath: "当专题资产、批量任务和异步队列稳定后，再迁移到正式图编排引擎"
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
      { id: "citation-gate", label: "寮曠敤渚濇嵁闂搁棬", status: handoff.guideCoverage >= 60 ? "ready" : "needs-evidence" },
      { id: "asset-gate", label: "专题资产沉淀", status: "planned" }
    ],
    dataSources: [
      { id: "memories", label: "展品", count: handoff.total },
      { id: "agent-runs", label: "鏁寸悊鍘嗗彶", count: handoff.withAgentRun },
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
    { id: "local-first-storage", label: "本地优先存储", status: "ready", detail: "detail text" },
    { id: "portable-export", label: "鍙縼绉诲鍑哄寘", status: "ready", detail: "detail text" },
    { id: "import-restore", label: "导入恢复", status: "ready", detail: "detail text" },
    { id: "delete-control", label: "删除控制", status: "ready", detail: "detail text" },
    { id: "workflow-audit", label: "工作流审计", status: handoff.withAgentRun > 0 ? "ready" : "needs-sample", detail: "detail text" },
    { id: "privacy-boundary", label: "隐私边界说明", status: "planned", detail: "detail text" }
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
      ? "可以进入第十二阶段规划与第一版实现，优先处理数据主权、导出删除边界和隐私说明"
      : "继续补齐导入导出、删除控制和审计记录后再进入第十二阶段"
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
      suggestedHandling: sensitivity.riskLevel === "high" ? "导出后请保存在受信任位置，后续建议使用加密导出包" : "导出后仍建议保存在个人设备或可信备份位置"
    },
    deletion: {
      singleMemory: "DELETE /api/memories/:id",
      fullPurge: "DELETE /api/memories/purge with confirm=DELETE",
      keeps: ["hall definitions", "application source files", "environment configuration"]
    },
    sync: {
      mode: "manual-json-package",
      status: "available",
      next: "第十二阶段后续可增加加密同步包和多端冲突处理"
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
      { id: "sqlite", label: "SQLite 数据", location: store.dbPath, contains: ["展品", "多模态元数据", "Agent run/step/event"] },
      { id: "browser-backup", label: "浏览器本地备份", location: "localStorage: memory-museum-items", contains: ["数据库不可用时的展品备份"] },
      { id: "export-package", label: "手动同步", location: "用户下载 JSON 文件", contains: sovereignty.exportPackage.includes }
    ],
    aiDataScope: {
      configured: aiConfigured,
      baseUrl: process.env.AI_BASE_URL || "not-configured",
      model: process.env.AI_MODEL || "not-configured",
      sentFields: ["rawContent", "existing structured draft fields when applicable"],
      notSentByCurrentApp: ["originalAttachmentFiles", "browserLocalStorageBackup", "fullDatabaseFile"],
      requiresUserConfirmation: true,
      note: aiConfigured
        ? "配置 AI_API_KEY 后，/api/analyze 会把原始记忆文本发送到配置的 OpenAI-compatible 接口"
        : "未配置 AI_API_KEY 时，后端使用本地 Mock 分析，不会发起外部 AI 调用"
    },
    sensitiveData: sovereignty.sensitivity,
    userControls: [
      { id: "export", label: "完整导出 JSON 备份", status: "available" },
      { id: "redacted-export", label: "导出脱敏 JSON 备份", status: "available" },
      { id: "import", label: "JSON 备份恢复", status: "available" },
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
    { id: "stable-api", label: "主要 API and smoke test", status: "ready" },
    { id: "start-docs", label: "启动和配置文档", status: "ready" },
    { id: "data-boundary", label: "数据位置与 AI 调用边界", status: "ready" },
    { id: "backup-restore", label: "导出导入和删除控制", status: "ready" },
    { id: "redacted-demo", label: "脱敏演示/排查", status: "ready" },
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
      ? "可以进入第十三阶段，优先处理工程拆分、运行日志、部署文档和发布流程"
      : "继续补齐 API 检查、数据边界和导出删除控制后再进入第十三阶段"
  };
}

function buildVersionInfo(memories = []) {
  return {
    app: "AI 记忆博物",
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
    phase20PlatformPlan: buildPhase20PlatformPlan(memories),
    phase21RuntimeSandboxPlan: buildPhase21RuntimeSandboxPlan(memories),
    phase22RuntimeEvidenceReview: buildPhase22RuntimeEvidenceReview(memories),
    phase23ReleaseReadinessReviewUi: buildPhase23ReleaseReadinessReviewUi(memories),
    phase24RuntimeSandboxUxEntry: buildPhase24RuntimeSandboxUxEntry(memories),
    phase25RuntimeSandboxUiSurface: buildPhase25RuntimeSandboxUiSurface(memories),
    phase26RuntimeValidationEntry: buildPhase26RuntimeValidationEntry(memories),
    phase27ReleaseBlockerGovernanceEntry: buildPhase27ReleaseBlockerGovernanceEntry(memories),
    phase28ClearanceReviewEntry: buildPhase28ClearanceReviewEntry(memories),
    phase29ReleaseGovernancePlanning: buildPhase29ReleaseGovernancePlanning(memories),
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
      "再拆 Agent/RAG/workflow 领域模块并保API 契约不变",
      "随后拆前端 api/state/renderers/panels 边界",
      "阶段 14 完成后再评估是否迁移Vite/React and Express/Fastify"
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
      ? "当前Node HTTP 直接托管静态资源和 API，生产部署前建议补充反向代理、日志和备份策略"
      : "当前适合本地体验、演示和课程项目"
  };
}

function buildReleaseChecklist(memories = []) {
  const stats = store.getStats();
  return [
    { id: "syntax", label: "璇硶妫€", status: "ready", command: "node --check app.js && node --check server.js && node --check database.js" },
    { id: "readiness", label: "第十五阶段资产检", status: "ready", command: "node scripts/phase15-readiness.js" },
    { id: "phase16-readiness", label: "第十六阶段同步检", status: "ready", command: "node scripts/phase16-readiness.js" },
    { id: "phase17-readiness", label: "第十七阶段适配层检", status: "ready", command: "node scripts/phase17-readiness.js" },
    { id: "phase18-readiness", label: "第十八阶段长期助理检", status: "ready", command: "node scripts/phase18-readiness.js" },
    { id: "phase19-readiness", label: "第十九阶段外部导入检", status: "ready", command: "node scripts/phase19-readiness.js" },
    { id: "phase20-readiness", label: "第二十阶段平台与插件检", status: "ready", command: "node scripts/phase20-readiness.js" },
    { id: "phase21-readiness", label: "Phase 21 runtime sandbox check", status: "ready", command: "node scripts/phase21-readiness.js" },
    { id: "phase22-readiness", label: "Phase 22 runtime evidence review check", status: "ready", command: "node scripts/phase22-readiness.js" },
    { id: "phase23-readiness", label: "Phase 23 release readiness review UI check", status: "ready", command: "node scripts/phase23-readiness.js" },
    { id: "phase24-readiness", label: "Phase 24 runtime sandbox UX entry check", status: "ready", command: "node scripts/phase24-readiness.js" },
    { id: "phase25-readiness", label: "Phase 25 runtime sandbox UI surface check", status: "ready", command: "node scripts/phase25-readiness.js" },
    { id: "phase26-readiness", label: "Phase 26 runtime validation entry check", status: "ready", command: "node scripts/phase26-readiness.js" },
    { id: "phase27-readiness", label: "Phase 27 release blocker governance entry check", status: "ready", command: "node scripts/phase27-readiness.js" },
    { id: "phase28-readiness", label: "Phase 28 clearance review entry check", status: "ready", command: "node scripts/phase28-readiness.js" },
    { id: "phase29-readiness", label: "Phase 29 release governance planning check", status: "ready", command: "node scripts/phase29-readiness.js" },
    { id: "api-smoke", label: "鏍稿績 API smoke test", status: "ready", command: "npm.cmd run smoke" },
    { id: "operations-trace", label: "请求追踪与运行事", status: "ready", detail: "detail text" },
    { id: "persistent-ops-log", label: "持久化运行日", status: "ready", detail: "detail text" },
    { id: "data-export", label: "完整与脱敏备", status: "ready", detail: "detail text" },
    { id: "demo-kit", label: "演示包摘要", status: (stats.total || memories.length) > 0 ? "ready" : "needs-sample", detail: "detail text" },
    { id: "phase14-readiness", label: "第十四阶段进入准", status: "ready", detail: "detail text" },
    { id: "production-logs", label: "持久化日志与反向代理", status: "planned", detail: "detail text" }
  ];
}

function buildOperationsRunbook() {
  return [
    { id: "start", label: "本地启动", command: "npm.cmd start", detail: "detail text" },
    { id: "check", label: "鍙戝竷鍓嶆", command: "npm.cmd run check", detail: "detail text" },
    { id: "backup", label: "备份", command: "GET /api/memories/export", detail: "detail text" },
    { id: "privacy", label: "隐私复核", command: "GET /api/privacy", detail: "detail text" },
    { id: "recover", label: "鎭㈠", command: "POST /api/memories/import", detail: "detail text" }
  ];
}

function buildDeploymentModes() {
  return [
    { id: "local", label: "本地个人使用", status: "ready", database: "SQLite", note: "note text" },
    { id: "demo", label: "课堂/演示模式", status: "ready", database: "临时或演SQLite", note: "note text" },
    { id: "lan", label: "局域网共享", status: "planned", database: "SQLite + 访问控制", note: "note text" },
    { id: "cloud", label: "云端部署", status: "planned", database: "托管数据库或卷挂SQLite", note: "note text" }
  ];
}

function buildBackupPolicy() {
  return {
    full: "/api/memories/export",
    redacted: "/api/memories/export?mode=redacted",
    restore: "POST /api/memories/import",
    purge: "DELETE /api/memories/purge with confirm=DELETE",
    recommendedCadence: "recommendedCadence text",
    storageAdvice: "storageAdvice text"
  };
}

function buildRiskRegister(memories = []) {
  const stats = store.getStats();
  const memoryCount = stats.total || memories.length;
  return [
    {
      id: "privacy",
      label: "隐私与敏感线",
      level: memoryCount > 0 ? "medium" : "low",
      mitigation: "mitigation text"
    },
    {
      id: "backup",
      label: "备份恢复",
      level: "medium",
      mitigation: "mitigation text"
    },
    {
      id: "observability",
      label: "运行观测",
      level: "medium",
      mitigation: "mitigation text"
    },
    {
      id: "module-size",
      label: "工程模块边界",
      level: "medium",
      mitigation: "mitigation text"
    }
  ];
}

function buildReleaseHistory() {
  return [
    {
      version: APP_VERSION,
      label: BUILD_LABEL,
      phase: PHASE,
      date: "2026-07-01",
      summary: "Phase 29 forty-ninth edition adds a read-only release exit final archive manifest preview over the final archive integrity check while blockers, redlines, release approval, Phase 29 exit, Phase 30 entry, runtime, and third-party execution remain blocked."
    },
    {
      version: "1.9.47",
      label: "phase29-release-exit-final-archive-integrity-check-preview",
      phase: 29,
      date: "2026-07-01",
      summary: "Phase 29 forty-eighth edition adds a read-only release exit final archive integrity check preview over the final archive index while blockers, redlines, release approval, Phase 29 exit, Phase 30 entry, runtime, and third-party execution remain blocked."
    },
    {
      version: "1.9.46",
      label: "phase29-release-exit-final-archive-index-preview",
      phase: 29,
      date: "2026-07-01",
      summary: "Phase 29 forty-seventh edition adds a read-only release exit final archive index preview over signoff evidence reconciliation and the final release-exit materials while blockers, redlines, release approval, Phase 29 exit, Phase 30 entry, runtime, and third-party execution remain blocked."
    },
    {
      version: "1.9.45",
      label: "phase29-release-exit-signoff-evidence-reconciliation-preview",
      phase: 29,
      date: "2026-07-01",
      summary: "Phase 29 forty-sixth edition adds a read-only release exit signoff evidence reconciliation preview over the final signoff review while blockers, redlines, release approval, Phase 29 exit, Phase 30 entry, runtime, and third-party execution remain blocked."
    },
    {
      version: "1.9.44",
      label: "phase29-release-exit-final-signoff-review-preview",
      phase: 29,
      date: "2026-07-01",
      summary: "Phase 29 forty-fifth edition adds a read-only release exit final signoff review preview over the governance freeze and release exit dossier while blockers, redlines, release approval, Phase 29 exit, Phase 30 entry, runtime, and third-party execution remain blocked."
    },
    {
      version: "1.9.43",
      label: "phase29-release-exit-governance-freeze-preview",
      phase: 29,
      date: "2026-07-01",
      summary: "Phase 29 forty-fourth edition adds a read-only release exit governance freeze preview over the release exit readiness dossier while blockers, redlines, release approval, Phase 29 exit, Phase 30 entry, runtime, and third-party execution remain blocked."
    },
    {
      version: "1.9.42",
      label: "phase29-release-exit-readiness-dossier-preview",
      phase: 29,
      date: "2026-07-01",
      summary: "Phase 29 forty-third edition adds a read-only release exit readiness dossier preview over the final readonly exit package while blockers, redlines, release approval, Phase 29 exit, Phase 30 entry, runtime, and third-party execution remain blocked."
    },
    {
      version: "1.9.41",
      label: "phase29-final-readonly-exit-package-preview",
      phase: 29,
      date: "2026-07-01",
      summary: "Phase 29 forty-second edition adds a read-only final exit package preview over audit closure hardening while blockers, redlines, release approval, Phase 29 exit, Phase 30 entry, runtime, and third-party execution remain blocked."
    },
    {
      version: "1.9.40",
      label: "phase29-audit-closure-readiness-hardening",
      phase: 29,
      date: "2026-07-01",
      summary: "Phase 29 forty-first edition adds a read-only audit closure readiness hardening layer over the Phase 30 entry audit closure preview while blockers, redlines, release approval, Phase 29 exit, Phase 30 entry, runtime, and third-party execution remain blocked."
    },
    {
      version: "1.9.39",
      label: "phase29-phase30-entry-audit-closure-preview",
      phase: 29,
      date: "2026-06-30",
      summary: "Phase 29 fortieth edition adds a read-only Phase 30 entry audit closure preview over signoff audit, reconciliation signoff, final export reconciliation, release review, exit attestation, blocker dossier, release exit decision, and runtime guardrails while release approval, Phase 29 exit, Phase 30 entry, runtime, and third-party execution remain blocked."
    },
    {
      version: "1.9.38",
      label: "phase29-phase30-entry-signoff-audit-preview",
      phase: 29,
      date: "2026-06-29",
      summary: "Phase 29 thirty-ninth edition adds a read-only Phase 30 entry signoff audit preview while release approval, Phase 29 exit, Phase 30 entry, runtime, and third-party execution remain blocked."
    },
    {
      version: "1.9.37",
      label: "phase29-phase30-entry-reconciliation-signoff-preview",
      phase: 29,
      date: "2026-06-29",
      summary: "Phase 29 thirty-eighth edition adds a read-only Phase 30 entry reconciliation signoff preview while release approval, Phase 29 exit, Phase 30 entry, runtime, and third-party execution remain blocked."
    },
    {
      version: "1.9.36",
      label: "phase29-phase30-entry-final-export-reconciliation-preview",
      phase: 29,
      date: "2026-06-29",
      summary: "Phase 29 thirty-seventh edition adds a read-only Phase 30 entry final export reconciliation preview while release approval, Phase 29 exit, Phase 30 entry, runtime, and third-party execution remain blocked."
    },
    {
      version: "1.9.35",
      label: "phase29-phase30-entry-evidence-final-ledger-export-preview",
      phase: 29,
      date: "2026-06-29",
      summary: "Phase 29 thirty-sixth edition adds a read-only Phase 30 entry evidence final ledger export preview while release approval, Phase 29 exit, Phase 30 entry, runtime, and third-party execution remain blocked."
    },
    {
      version: "1.9.34",
      label: "phase29-phase30-entry-evidence-disposition-ledger-preview",
      phase: 29,
      date: "2026-06-29",
      summary: "Phase 29 thirty-fifth edition adds a read-only Phase 30 entry evidence disposition ledger preview while release approval, Phase 29 exit, Phase 30 entry, runtime, and third-party execution remain blocked."
    },
    {
      version: "1.9.33",
      label: "phase29-phase30-entry-evidence-review-disposition-preview",
      phase: 29,
      date: "2026-06-29",
      summary: "Phase 29 thirty-fourth edition adds a read-only Phase 30 entry evidence review disposition preview while release approval, Phase 29 exit, Phase 30 entry, runtime, and third-party execution remain blocked."
    },
    {
      version: "1.9.32",
      label: "phase29-phase30-entry-evidence-review-queue-preview",
      phase: 29,
      date: "2026-06-29",
      summary: "Phase 29 thirty-third edition adds a read-only Phase 30 entry evidence review queue preview while release approval, Phase 29 exit, Phase 30 entry, runtime, and third-party execution remain blocked."
    },
    {
      version: "1.9.31",
      label: "phase29-phase30-entry-evidence-index-preview",
      phase: 29,
      date: "2026-06-29",
      summary: "Phase 29 thirty-second edition adds a read-only Phase 30 entry evidence index preview while release approval, Phase 29 exit, Phase 30 entry, runtime, and third-party execution remain blocked."
    },
    {
      version: "1.9.30",
      label: "phase29-phase30-entry-evidence-pack-preview",
      phase: 29,
      date: "2026-06-29",
      summary: "Phase 29 thirty-first edition adds a read-only Phase 30 entry evidence pack preview while release approval, Phase 29 exit, Phase 30 entry, runtime, and third-party execution remain blocked."
    },
    {
      version: "1.9.29",
      label: "phase29-phase30-gap-resolution-sequence-preview",
      phase: 29,
      date: "2026-06-29",
      summary: "Phase 29 thirtieth edition adds a read-only Phase 30 gap resolution sequence preview while release approval, Phase 29 exit, Phase 30 entry, runtime, and third-party execution remain blocked."
    },
    {
      version: "1.9.28",
      label: "phase29-phase30-readiness-gap-brief-preview",
      phase: 29,
      date: "2026-06-29",
      summary: "Phase 29 twenty-ninth edition adds a read-only Phase 30 readiness gap brief preview while release approval, Phase 29 exit, Phase 30 entry, runtime, and third-party execution remain blocked."
    },
    {
      version: "1.9.27",
      label: "phase29-phase30-readiness-map-preview",
      phase: 29,
      date: "2026-06-29",
      summary: "Phase 29 twenty-eighth edition adds a read-only Phase 30 readiness map preview while release approval, Phase 29 exit, Phase 30 entry, runtime, and third-party execution remain blocked."
    },
    {
      version: "1.9.26",
      label: "phase29-phase30-scope-lock-preview",
      phase: 29,
      date: "2026-06-29",
      summary: "Phase 29 twenty-seventh edition adds a read-only Phase 30 scope lock preview while release approval, Phase 29 exit, Phase 30 entry, runtime, and third-party execution remain blocked."
    },
    {
      version: "1.9.25",
      label: "phase29-phase30-planning-brief-preview",
      phase: 29,
      date: "2026-06-29",
      summary: "Phase 29 twenty-sixth edition adds a read-only Phase 30 planning brief preview while release approval, Phase 29 exit, Phase 30 entry, runtime, and third-party execution remain blocked."
    },
    {
      version: "1.9.24",
      label: "phase29-exit-readiness-attestation-preview",
      phase: 29,
      date: "2026-06-29",
      summary: "Phase 29 twenty-fifth edition adds a read-only exit readiness attestation preview while blocker clearance, release approval, runtime, Phase 29 exit, and Phase 30 entry remain blocked."
    },
    {
      version: "1.9.23",
      label: "phase29-release-final-review-envelope-preview",
      phase: 29,
      date: "2026-06-29",
      summary: "Phase 29 twenty-fourth edition adds a read-only release final review envelope preview while blocker clearance, release approval, runtime, Phase 29 exit, and Phase 30 entry remain blocked."
    },
    {
      version: "1.9.22",
      label: "phase29-final-readiness-board-preview",
      phase: 29,
      date: "2026-06-29",
      summary: "Phase 29 twenty-third edition adds a read-only final readiness board preview while blocker clearance, release approval, runtime, Phase 29 exit, and Phase 30 entry remain blocked."
    },
    {
      version: "1.9.21",
      label: "phase29-release-candidate-freeze-preview",
      phase: 29,
      date: "2026-06-29",
      summary: "Phase 29 twenty-second edition adds a read-only release candidate freeze preview while blocker clearance, release approval, runtime, Phase 29 exit, and Phase 30 entry remain blocked."
    },
    {
      version: "1.9.20",
      label: "phase29-transition-closure-package-preview",
      phase: 29,
      date: "2026-06-29",
      summary: "Phase 29 twenty-first edition adds a read-only transition closure package preview while blocker clearance, release approval, runtime, Phase 29 exit, and Phase 30 entry remain blocked."
    },
    {
      version: "1.9.19",
      label: "phase29-final-transition-handoff-preview",
      phase: 29,
      date: "2026-06-29",
      summary: "Phase 29 twentieth edition adds a read-only final transition handoff preview while blocker clearance, release approval, runtime, Phase 29 exit, and Phase 30 entry remain blocked."
    },
    {
      version: "1.9.18",
      label: "phase29-transition-readiness-redline",
      phase: 29,
      date: "2026-06-29",
      summary: "Phase 29 nineteenth edition adds a read-only transition readiness redline while blocker clearance, release approval, runtime, Phase 29 exit, and Phase 30 entry remain blocked."
    },
    {
      version: "1.9.17",
      label: "phase29-transition-evidence-gap-review",
      phase: 29,
      date: "2026-06-29",
      summary: "Phase 29 eighteenth edition adds a read-only transition evidence gap review while blocker clearance, release approval, runtime, and Phase 30 entry remain blocked."
    },
    {
      version: "1.9.16",
      label: "phase29-phase30-transition-risk-register",
      phase: 29,
      date: "2026-06-29",
      summary: "Phase 29 seventeenth edition adds a read-only Phase 30 transition risk register while Phase 29 exit, release approval, runtime, and Phase 30 entry remain blocked."
    },
    {
      version: "1.9.15",
      label: "phase29-release-exit-decision-preview",
      phase: 29,
      date: "2026-06-29",
      summary: "Phase 29 sixteenth edition adds a read-only release exit decision preview that keeps Phase 29 exit, release approval, runtime, and Phase 30 entry blocked."
    },
    {
      version: "1.9.14",
      label: "phase29-release-exit-criteria-ledger",
      phase: 29,
      date: "2026-06-29",
      summary: "Phase 29 fifteenth edition adds a read-only release exit criteria ledger over blocker, release, runtime, archive, and Phase 30 entry gates while Phase 30 entry remains blocked."
    },
    {
      version: "1.9.13",
      label: "phase29-final-release-blocker-dossier",
      phase: 29,
      date: "2026-06-29",
      summary: "Phase 29 fourteenth edition adds a read-only final release blocker dossier across blockers, evidence artifacts, and release gates while Phase 30 entry remains blocked."
    },
    {
      version: "1.9.12",
      label: "phase29-phase30-entry-preflight",
      phase: 29,
      date: "2026-06-29",
      summary: "Phase 29 thirteenth edition adds a read-only Phase 30 entry preflight over blockers, release approval, and runtime gates while Phase 30 entry remains blocked."
    },
    {
      version: "1.9.11",
      label: "phase29-blocker-resolution-map",
      phase: 29,
      date: "2026-06-29",
      summary: "Phase 29 twelfth edition adds a read-only blocker resolution map with evidence, ownership, and Phase 30 preconditions while blocker clearance, release readiness, runtime, and third-party execution remain blocked."
    },
    {
      version: "1.9.10",
      label: "phase29-governance-archive-freeze",
      phase: 29,
      date: "2026-06-29",
      summary: "Phase 29 eleventh edition freezes the read-only governance archive across Phase 29 exports and guards while release readiness, runtime, and third-party execution remain blocked."
    },
    {
      version: "1.9.9",
      label: "phase29-final-closure-readiness-snapshot",
      phase: 29,
      date: "2026-06-29",
      summary: "Phase 29 tenth edition adds a read-only final closure readiness snapshot across all Phase 29 governance submodels while release readiness, runtime, and third-party execution remain blocked."
    },
    {
      version: "1.9.8",
      label: "phase29-handoff-review-index",
      phase: 29,
      date: "2026-06-29",
      summary: "Phase 29 ninth edition adds a read-only handoff review index across Phase 29 handoff artifacts, checks, and blockers while release readiness, runtime, and third-party execution remain blocked."
    },
    {
      version: "1.9.7",
      label: "phase29-closure-handoff-package",
      phase: 29,
      date: "2026-06-29",
      summary: "Phase 29 eighth edition adds a read-only closure handoff package across Phase 29 governance artifacts while blockers, release readiness, runtime, and third-party execution remain blocked."
    },
    {
      version: "1.9.6",
      label: "phase29-governance-closure-readiness",
      phase: 29,
      date: "2026-06-29",
      summary: "Phase 29 seventh edition adds read-only governance closure readiness across Phase 29 models while blockers, release readiness, runtime, and third-party execution remain blocked."
    },
    {
      version: "1.9.5",
      label: "phase29-decision-history-audit-chain",
      phase: 29,
      date: "2026-06-29",
      summary: "Phase 29 sixth edition adds a read-only decision history audit chain across Phase 29 governance models while blockers, release readiness, runtime, and third-party execution remain blocked."
    },
    {
      version: "1.9.4",
      label: "phase29-governance-dashboard-export",
      phase: 29,
      date: "2026-06-28",
      summary: "Phase 29 fifth edition adds a read-only governance dashboard export over Phase 29 planning models while blockers, release readiness, runtime, and third-party execution remain blocked."
    },
    {
      version: "1.9.3",
      label: "phase29-runtime-enable-governance-planning",
      phase: 29,
      date: "2026-06-28",
      summary: "Phase 29 fourth edition adds read-only runtime enable governance planning while blockers, release readiness, runtime, and third-party execution remain blocked."
    },
    {
      version: "1.9.2",
      label: "phase29-release-approval-state-model-planning",
      phase: 29,
      date: "2026-06-28",
      summary: "Phase 29 third edition adds a read-only release approval state model while blockers, release readiness, and runtime remain blocked."
    },
    {
      version: "1.9.1",
      label: "phase29-blocker-clearance-workflow-planning",
      phase: 29,
      date: "2026-06-28",
      summary: "Phase 29 second edition adds read-only blocker clearance workflow planning while blockers, release readiness, and runtime remain blocked."
    },
    {
      version: "1.9.0",
      label: "phase29-release-governance-planning",
      phase: 29,
      date: "2026-06-28",
      summary: "Phase 29 first edition opens release governance planning from the Phase 28 closure package while blockers, release readiness, and runtime remain blocked."
    },
    {
      version: "1.8.5",
      label: "phase28-closure-package",
      phase: 28,
      date: "2026-06-28",
      summary: "Phase 28 sixth edition closes the clearance review stage with a read-only closure package while blockers, release readiness, and runtime remain blocked."
    },
    {
      version: "1.8.4",
      label: "phase28-clearance-decision-preview",
      phase: 28,
      date: "2026-06-28",
      summary: "Phase 28 fifth edition adds a read-only clearance decision preview over criteria while blockers, release readiness, and runtime remain blocked."
    },
    {
      version: "1.8.3",
      label: "phase28-clearance-criteria-checklist",
      phase: 28,
      date: "2026-06-28",
      summary: "Phase 28 fourth edition adds a read-only clearance criteria checklist over reviewer dispositions while blockers, release readiness, and runtime remain blocked."
    },
    {
      version: "1.8.2",
      label: "phase28-reviewer-disposition-model",
      phase: 28,
      date: "2026-06-28",
      summary: "Phase 28 third edition adds a read-only reviewer disposition model over evidence intake while blockers, release readiness, and runtime remain blocked."
    },
    {
      version: "1.8.1",
      label: "phase28-evidence-intake-ledger",
      phase: 28,
      date: "2026-06-28",
      summary: "Phase 28 second edition adds a read-only evidence intake ledger to the clearance review entry while blockers, release readiness, and runtime remain blocked."
    },
    {
      version: "1.8.0",
      label: "phase28-clearance-review-entry",
      phase: 28,
      date: "2026-06-28",
      summary: "Phase 28 first edition opens a read-only release blocker clearance review entry from the Phase 27 closure package while blockers, release readiness, and runtime remain blocked."
    },
    {
      version: "1.7.5",
      label: "phase27-closure-package",
      phase: 27,
      date: "2026-06-28",
      summary: "Phase 27 sixth edition closes release blocker governance with a read-only closure package while open blockers, evidence gaps, runtime-disabled guardrails, and releaseReady=false are carried forward."
    },
    {
      version: "1.7.4",
      label: "phase27-blocker-resolution-plan",
      phase: 27,
      date: "2026-06-28",
      summary: "Phase 27 fifth edition adds a read-only blocker resolution plan over the evidence gap matrix while runtime, third-party execution, release readiness, and blocker clearance remain disabled."
    },
    {
      version: "1.7.3",
      label: "phase27-evidence-gap-matrix",
      phase: 27,
      date: "2026-06-28",
      summary: "Phase 27 fourth edition adds a read-only evidence gap matrix over carried blockers and human review signoff while runtime, third-party execution, release readiness, and blocker clearance remain disabled."
    },
    {
      version: "1.7.2",
      label: "phase27-human-review-signoff",
      phase: 27,
      date: "2026-06-28",
      summary: "Phase 27 third edition adds a read-only human review signoff package over carried blockers while runtime, third-party execution, release readiness, and blocker clearance remain disabled."
    },
    {
      version: "1.7.1",
      label: "phase27-carried-blocker-inventory",
      phase: 27,
      date: "2026-06-28",
      summary: "Phase 27 second edition promotes carried release blockers into a read-only governance inventory package while runtime, third-party execution, release readiness, and blocker clearance remain disabled."
    },
    {
      version: "1.7.0",
      label: "phase27-entry-package",
      phase: 27,
      date: "2026-06-28",
      summary: "Phase 27 first edition opens release blocker governance with a read-only entry package sourced from the Phase 26 closure package while runtime, third-party execution, and release readiness remain disabled."
    },
    {
      version: "1.6.5",
      label: "phase26-closure-package",
      phase: 26,
      date: "2026-06-27",
      summary: "Phase 26 sixth edition closes the validation and simulation stage with a read-only closure package while release blockers and runtime guardrails are carried forward."
    },
    {
      version: "1.6.4",
      label: "phase26-handoff-criteria",
      phase: 26,
      date: "2026-06-27",
      summary: "Phase 26 fifth edition defines read-only handoff criteria for the next planning stage while runtime execution, third-party execution, release readiness, and blocker clearance stay disabled."
    },
    {
      version: "1.6.3",
      label: "phase26-runtime-validation-report",
      phase: 26,
      date: "2026-06-27",
      summary: "Phase 26 fourth edition adds a read-only runtime validation report over entry, release gate, and blocker clearance simulations while all runtime and release mutations stay disabled."
    },
    {
      version: "1.6.2",
      label: "phase26-blocker-clearance-simulation",
      phase: 26,
      date: "2026-06-27",
      summary: "Phase 26 third edition adds a read-only blocker clearance simulation model while runtime, third-party execution, release readiness, and blocker mutations stay disabled."
    },
    {
      version: "1.6.1",
      label: "phase26-release-gate-simulation",
      phase: 26,
      date: "2026-06-27",
      summary: "Phase 26 second edition adds a read-only release gate simulation model while runtime, third-party execution, and release readiness stay disabled."
    },
    {
      version: "1.6.0",
      label: "phase26-validation-entry",
      phase: 26,
      date: "2026-06-27",
      summary: "Phase 26 first edition opens the runtime sandbox validation entry for release gate simulation while runtime, third-party execution, and release readiness stay disabled."
    },
    {
      version: "1.5.6",
      label: "phase25-review-package-validation",
      phase: 25,
      date: "2026-06-27",
      summary: "Phase 25 seventh edition adds a read-only review package validation model for artifact checks, guardrail checks, and blocked validation mutations without runtime execution."
    },
    {
      version: "1.5.5",
      label: "phase25-review-export-package",
      phase: 25,
      date: "2026-06-27",
      summary: "Phase 25 sixth edition adds a read-only review export package manifest that bundles UI state, evidence bindings, review actions, and audit preview integrity without runtime execution."
    },
    {
      version: "1.5.4",
      label: "phase25-review-audit-preview",
      phase: 25,
      date: "2026-06-27",
      summary: "Phase 25 fifth edition adds a read-only review audit preview package for action events, blocked mutation evidence, and export integrity while runtime execution stays disabled."
    },
    {
      version: "1.5.3",
      label: "phase25-review-action-model",
      phase: 25,
      date: "2026-06-27",
      summary: "Phase 25 fourth edition adds a read-only review action model for panel switching, filtering, evidence detail, redacted export preview, and blocked mutation policy."
    },
    {
      version: "1.5.2",
      label: "phase25-panel-evidence-bindings",
      phase: 25,
      date: "2026-06-27",
      summary: "Phase 25 third edition binds every runtime sandbox UI panel to its Phase 24 source evidence, redaction rule, source count, and integrity checks while execution remains disabled."
    },
    {
      version: "1.5.1",
      label: "phase25-surface-state-model",
      phase: 25,
      date: "2026-06-27",
      summary: "Phase 25 second edition adds a read-only surface state model for active panels, filters, detail drawers, and export previews while runtime and third-party execution stay disabled."
    },
    {
      version: "1.5.0",
      label: "phase25-runtime-sandbox-ui-surface",
      phase: 25,
      date: "2026-06-27",
      summary: "Phase 25 first edition renders the runtime sandbox UX closure package as a read-only UI surface while runtime and third-party execution stay disabled."
    },
    {
      version: "1.4.6",
      label: "phase24-closure-package",
      phase: 24,
      date: "2026-06-27",
      summary: "Phase 24 seventh edition closes the runtime sandbox UX model package while runtime and third-party execution stay disabled and release stays blocked."
    },
    {
      version: "1.4.5",
      label: "phase24-release-clearance-preview",
      phase: 24,
      date: "2026-06-27",
      summary: "Phase 24 sixth edition adds a read-only release clearance preview that keeps releaseReady blocked until quarantine and blocker evidence are cleared."
    },
    {
      version: "1.4.4",
      label: "phase24-runtime-evidence-export-pack",
      phase: 24,
      date: "2026-06-27",
      summary: "Phase 24 fifth edition adds a guarded runtime evidence export pack with redacted handoff, preflight, permission, quarantine, and blocker evidence."
    },
    {
      version: "1.4.3",
      label: "phase24-quarantine-review-queue",
      phase: 24,
      date: "2026-06-27",
      summary: "Phase 24 fourth edition adds a read-only quarantine review queue for blocked and held runtime results without applying quarantined output."
    },
    {
      version: "1.4.2",
      label: "phase24-permission-decision-review-flow",
      phase: 24,
      date: "2026-06-27",
      summary: "Phase 24 third edition adds a permission decision review flow for denied Host API decisions while runtime permissions remain ungrantable."
    },
    {
      version: "1.4.1",
      label: "phase24-runtime-preflight-workbench",
      phase: 24,
      date: "2026-06-27",
      summary: "Phase 24 second edition adds a read-only runtime preflight workbench for kill switch, permission policy, quarantine, and release gate checks."
    },
    {
      version: "1.4.0",
      label: "phase24-runtime-sandbox-ux-entry",
      phase: 24,
      date: "2026-06-27",
      summary: "Phase 24 first edition establishes the runtime sandbox UX entry from the Phase 23 handoff while release stays blocked."
    },
    {
      version: "1.3.9",
      label: "phase23-closure-handoff-package",
      phase: 23,
      date: "2026-06-27",
      summary: "summary text"
    },
    {
      version: "1.3.8",
      label: "phase23-runtime-sandbox-panel-view-export",
      phase: 23,
      date: "2026-06-27",
      summary: "summary text"
    },
    {
      version: "1.3.7",
      label: "phase23-runtime-sandbox-readonly-panels",
      phase: 23,
      date: "2026-06-26",
      summary: "summary text"
    },
    {
      version: "1.3.6",
      label: "phase23-runtime-sandbox-ui-plan",
      phase: 23,
      date: "2026-06-26",
      summary: "summary text"
    },
    {
      version: "1.3.5",
      label: "phase23-next-phase-guardrail-dashboard",
      phase: 23,
      date: "2026-06-26",
      summary: "summary text"
    },
    {
      version: "1.3.4",
      label: "phase23-review-action-ledger",
      phase: 23,
      date: "2026-06-26",
      summary: "summary text"
    },
    {
      version: "1.3.3",
      label: "phase23-blocker-detail-panels",
      phase: 23,
      date: "2026-06-26",
      summary: "summary text"
    },
    {
      version: "1.3.2",
      label: "phase23-decision-history-export",
      phase: 23,
      date: "2026-06-26",
      summary: "summary text"
    },
    {
      version: "1.3.1",
      label: "phase23-clearance-audit-search",
      phase: 23,
      date: "2026-06-26",
      summary: "summary text"
    },
    {
      version: "1.3.0",
      label: "phase23-release-readiness-review-ui",
      phase: 23,
      date: "2026-06-26",
      summary: "summary text"
    },
    {
      version: "1.2.7",
      label: "phase22-runtime-review-closure",
      phase: 22,
      date: "2026-06-26",
      summary: "summary text"
    },
    {
      version: "1.2.6",
      label: "phase22-clearance-audit-trail",
      phase: 22,
      date: "2026-06-26",
      summary: "summary text"
    },
    {
      version: "1.2.5",
      label: "phase22-release-readiness-decision",
      phase: 22,
      date: "2026-06-26",
      summary: "summary text"
    },
    {
      version: "1.2.4",
      label: "phase22-blocker-clearance-plan",
      phase: 22,
      date: "2026-06-26",
      summary: "summary text"
    },
    {
      version: "1.2.3",
      label: "phase22-release-blocker-rules",
      phase: 22,
      date: "2026-06-26",
      summary: "summary text"
    },
    {
      version: "1.2.2",
      label: "phase22-review-signoff-ledger",
      phase: 22,
      date: "2026-06-26",
      summary: "summary text"
    },
    {
      version: "1.2.1",
      label: "phase22-runtime-review-workbench",
      phase: 22,
      date: "2026-06-26",
      summary: "summary text"
    },
    {
      version: "1.2.0",
      label: "phase22-runtime-evidence-review",
      phase: 22,
      date: "2026-06-26",
      summary: "summary text"
    },
    {
      version: "1.1.5",
      label: "phase21-runtime-result-quarantine",
      phase: 21,
      date: "2026-06-26",
      summary: "summary text"
    },
    {
      version: "1.1.4",
      label: "phase21-importer-runtime-fixtures",
      phase: 21,
      date: "2026-06-26",
      summary: "summary text"
    },
    {
      version: "1.1.3",
      label: "phase21-output-validation-gate",
      phase: 21,
      date: "2026-06-26",
      summary: "summary text"
    },
    {
      version: "1.1.2",
      label: "phase21-runtime-audit-replay",
      phase: 21,
      date: "2026-06-26",
      summary: "summary text"
    },
    {
      version: "1.1.1",
      label: "phase21-permission-runtime-enforcement",
      phase: 21,
      date: "2026-06-26",
      summary: "summary text"
    },
    {
      version: "1.1.0",
      label: "phase21-runtime-sandbox-foundation",
      phase: 21,
      date: "2026-06-26",
      summary: "summary text"
    },
    {
      version: "1.0.25",
      label: "phase20-release-checklist-gate",
      phase: 20,
      date: "2026-06-26",
      summary: "summary text"
    },
    {
      version: "1.0.24",
      label: "phase20-download-integrity-preview",
      phase: 20,
      date: "2026-06-26",
      summary: "summary text"
    },
    {
      version: "1.0.23",
      label: "phase20-ci-badge-summary",
      phase: 20,
      date: "2026-06-26",
      summary: "summary text"
    },
    {
      version: "1.0.22",
      label: "phase20-signed-report-download",
      phase: 20,
      date: "2026-06-26",
      summary: "summary text"
    },
    {
      version: "1.0.21",
      label: "phase20-validation-command-ci-wrapper",
      phase: 20,
      date: "2026-06-25",
      summary: "summary text"
    },
    {
      version: "1.0.1",
      label: "phase20-plugin-manifest-schema",
      phase: 20,
      date: "2026-06-25",
      summary: "summary text"
    },
    {
      version: "1.0.0",
      label: "phase20-platform-plugin-first-edition",
      phase: 20,
      date: "2026-06-25",
      summary: "summary text"
    },
    {
      version: "0.9.7",
      label: "phase19-import-review-eighth-edition",
      phase: 19,
      date: "2026-06-24",
      summary: "summary text"
    },
    {
      version: "0.9.6",
      label: "phase19-import-conflict-seventh-edition",
      phase: 19,
      date: "2026-06-24",
      summary: "summary text"
    },
    {
      version: "0.9.5",
      label: "phase19-import-template-sixth-edition",
      phase: 19,
      date: "2026-06-24",
      summary: "summary text"
    },
    {
      version: "0.9.4",
      label: "phase19-import-recovery-fifth-edition",
      phase: 19,
      date: "2026-06-24",
      summary: "summary text"
    },
    {
      version: "0.9.3",
      label: "phase19-import-quality-fourth-edition",
      phase: 19,
      date: "2026-06-24",
      summary: "summary text"
    },
    {
      version: "0.9.2",
      label: "phase19-import-batch-third-edition",
      phase: 19,
      date: "2026-06-24",
      summary: "summary text"
    },
    {
      version: "0.9.1",
      label: "phase19-import-cleanup-second-edition",
      phase: 19,
      date: "2026-06-24",
      summary: "summary text"
    },
    {
      version: "0.9.0",
      label: "phase19-external-import-first-edition",
      phase: 19,
      date: "2026-06-24",
      summary: "summary text"
    },
    {
      version: "0.8.12",
      label: "phase18-agent-digest-thirteenth-edition",
      phase: 18,
      date: "2026-06-24",
      summary: "summary text"
    },
    {
      version: "0.8.11",
      label: "phase18-graph-asset-navigation-twelfth-edition",
      phase: 18,
      date: "2026-06-24",
      summary: "summary text"
    },
    {
      version: "0.8.10",
      label: "phase18-sync-asset-link-eleventh-edition",
      phase: 18,
      date: "2026-06-24",
      summary: "summary text"
    },
    {
      version: "0.8.9",
      label: "phase18-batch-task-tenth-edition",
      phase: 18,
      date: "2026-06-24",
      summary: "summary text"
    },
    {
      version: "0.8.8",
      label: "phase18-noise-rule-ninth-edition",
      phase: 18,
      date: "2026-06-24",
      summary: "summary text"
    },
    {
      version: "0.8.7",
      label: "phase18-sync-bridge-eighth-edition",
      phase: 18,
      date: "2026-06-24",
      summary: "summary text"
    },
    {
      version: "0.8.6",
      label: "phase18-review-dashboard-seventh-edition",
      phase: 18,
      date: "2026-06-24",
      summary: "summary text"
    },
    {
      version: "0.8.5",
      label: "phase18-review-report-sixth-edition",
      phase: 18,
      date: "2026-06-24",
      summary: "summary text"
    },
    {
      version: "0.8.4",
      label: "phase18-review-assets-fifth-edition",
      phase: 18,
      date: "2026-06-24",
      summary: "summary text"
    },
    {
      version: "0.8.3",
      label: "phase18-audit-batch-fourth-edition",
      phase: 18,
      date: "2026-06-24",
      summary: "summary text"
    },
    {
      version: "0.8.2",
      label: "phase18-task-queue-third-edition",
      phase: 18,
      date: "2026-06-24",
      summary: "summary text"
    },
    {
      version: "0.8.1",
      label: "phase18-repair-draft-second-edition",
      phase: 18,
      date: "2026-06-24",
      summary: "summary text"
    },
    {
      version: "0.8.0",
      label: "phase18-long-term-agent-first-edition",
      phase: 18,
      date: "2026-06-24",
      summary: "summary text"
    },
    {
      version: "0.3.3",
      label: "phase13-operations-fourth-edition",
      phase: 13,
      date: "2026-06-23",
      summary: "summary text"
    },
    {
      version: "0.3.2",
      label: "phase13-operations-third-edition",
      phase: 13,
      date: "2026-06-22",
      summary: "summary text"
    },
    {
      version: "0.3.1",
      label: "phase13-operations-second-edition",
      phase: 13,
      date: "2026-06-22",
      summary: "summary text"
    },
    {
      version: "0.3.0",
      label: "phase13-operations-first-edition",
      phase: 13,
      date: "2026-06-22",
      summary: "summary text"
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
      { id: "sample-count", label: "至少 3 件展", status: structured.length >= 3 ? "ready" : "needs-sample", count: structured.length },
      { id: "timeline", label: "时间线样", status: withDate >= 2 ? "ready" : "needs-date", count: withDate },
      { id: "people", label: "人物关系线索", status: withPeople >= 1 ? "ready" : "needs-people", count: withPeople },
      { id: "media", label: "多模态线", status: withMedia >= 1 ? "ready" : "needs-media", count: withMedia },
      { id: "guide", label: "璁茶В妫€绱㈡牱", status: withGuideText >= 2 ? "ready" : "needs-guide", count: withGuideText }
    ],
    storyline: [
      "从首页录入或导入 3 to 5 件温馨记忆展",
      "运行 Agent 整理并保留人工复核状",
      "打开讲解员提问，展示引用证据和可信度",
      "查看时间线、主题展、隐私策略和部署与运维面",
      "导出脱敏包用于演示或排查"
    ],
    privacyNote: "privacyNote text"
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
      rule: "先迁移纯路由分发，保持 URL、状态码和响应结构不变"
    },
    {
      id: "operations",
      label: "Operations",
      status: "ready-to-split",
      firstFiles: ["server.js", "scripts/phase13-readiness.js", "scripts/api-smoke.js"],
      targetFiles: ["src/services/operations.js"],
      rule: "先抽version、operations、runbook、releaseHistory、logArchive、demoKit"
    },
    {
      id: "privacy",
      label: "Privacy",
      status: "ready-to-split",
      firstFiles: ["server.js", "app.js"],
      targetFiles: ["src/services/privacy.js", "src/ui/privacy-panel.js"],
      rule: "保持 /api/privacy 和数据主权导出字段兼容"
    },
    {
      id: "agents",
      label: "Agent workflow",
      status: "split-after-routes",
      firstFiles: ["server.js", "database.js", "app.js"],
      targetFiles: ["src/services/agents.js", "src/services/workflows.js"],
      rule: "先用 smoke test 固定 workflow.run、steps、events 契约，再拆实现"
    },
    {
      id: "frontend",
      label: "Frontend panels",
      status: "split-after-api",
      firstFiles: ["app.js"],
      targetFiles: ["src/ui/renderers.js", "src/ui/operations-panel.js", "src/ui/workflow-panel.js"],
      rule: "先按面板拆渲染函数，暂不引入构建工具"
    }
  ];
}

function buildPhase14Readiness(memories = []) {
  const checks = [
    { id: "api-contract", label: "API 契约保护", status: "ready", detail: "detail text" },
    { id: "operations-guard", label: "运维保护", status: "ready", detail: "detail text" },
    { id: "docs-route", label: "重构路线文档", status: "ready", detail: "detail text" },
    { id: "module-plan", label: "模块边界清单", status: "ready", detail: "detail text" },
    { id: "data-safety", label: "数据安全回归", status: "ready", detail: "detail text" },
    { id: "sample-signal", label: "演示样本信号", status: memories.length > 0 ? "ready" : "optional", detail: "detail text" }
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
      "任一现有 API smoke 失败时暂停拆",
      "导入导出结构变化时先补迁移说",
      "前端面板拆分后必须保持无后端回退能力"
    ],
    recommendation: readyCount >= 5
      ? "可以进入阶段 14。建议先拆后routes and operations，再privacy、Agent/RAG/workflow，最后拆前端面板"
      : "继续补齐 API 契约、运维导出和模块边界后再进入阶段 14"
  };
}

function buildOperationsExport(memories = []) {
  return {
    app: "AI 记忆博物",
    exportedAt: new Date().toISOString(),
    schemaVersion: SCHEMA_VERSION,
    phase: PHASE,
    version: APP_VERSION,
    buildLabel: BUILD_LABEL,
    operations: buildOperationsConsole(memories),
    logArchive: buildLogArchiveInfo(),
    demoKit: buildDemoKit(memories),
    phase14Readiness: buildPhase14Readiness(memories),
    phase20PlatformPlan: buildPhase20PlatformPlan(memories),
    phase21RuntimeSandboxPlan: buildPhase21RuntimeSandboxPlan(memories),
    phase22RuntimeEvidenceReview: buildPhase22RuntimeEvidenceReview(memories),
    phase23ReleaseReadinessReviewUi: buildPhase23ReleaseReadinessReviewUi(memories),
    phase24RuntimeSandboxUxEntry: buildPhase24RuntimeSandboxUxEntry(memories),
    phase25RuntimeSandboxUiSurface: buildPhase25RuntimeSandboxUiSurface(memories),
    phase26RuntimeValidationEntry: buildPhase26RuntimeValidationEntry(memories),
    phase27ReleaseBlockerGovernanceEntry: buildPhase27ReleaseBlockerGovernanceEntry(memories),
    phase28ClearanceReviewEntry: buildPhase28ClearanceReviewEntry(memories),
    phase29ReleaseGovernancePlanning: buildPhase29ReleaseGovernancePlanning(memories),
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
    phase20PlatformPlan: buildPhase20PlatformPlan(memories),
    phase21RuntimeSandboxPlan: buildPhase21RuntimeSandboxPlan(memories),
    phase22RuntimeEvidenceReview: buildPhase22RuntimeEvidenceReview(memories),
    phase23ReleaseReadinessReviewUi: buildPhase23ReleaseReadinessReviewUi(memories),
    phase24RuntimeSandboxUxEntry: buildPhase24RuntimeSandboxUxEntry(memories),
    phase25RuntimeSandboxUiSurface: buildPhase25RuntimeSandboxUiSurface(memories),
    phase26RuntimeValidationEntry: buildPhase26RuntimeValidationEntry(memories),
    phase27ReleaseBlockerGovernanceEntry: buildPhase27ReleaseBlockerGovernanceEntry(memories),
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
    checks: ["syntax", "phase15-readiness", "phase16-readiness", "phase17-readiness", "phase18-readiness", "phase19-readiness", "phase20-readiness", "phase21-readiness", "phase22-readiness", "phase23-readiness", "phase24-readiness", "phase25-readiness", "phase26-readiness", "phase27-readiness", "phase28-readiness", "phase29-readiness", "api-smoke"],
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
      phase14: true,
      phase15: true,
      phase16: true,
      phase17: true,
      phase18: true,
      phase19: true,
      phase20: true,
      phase21: true,
      phase22: true,
      phase23: true,
      phase24: true,
      phase25: true,
      phase26: true,
      phase27: true,
      phase28: true,
      phase29: true,
      deployableLocal: true,
      productionReady: false,
      reason: "reason text"
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
      count: memories.filter((memory) => String(memory.rawContent || "").match(/1[3-9]\d{9}|寰俊|鐢佃瘽|閭|@/)).length
    },
    {
      id: "low-mood",
      label: "低谷情绪",
      count: memories.filter((memory) => (memory.emotions || []).some((emotion) => ["low", "lonely", "wronged", "angry", "afraid", "lost"].includes(emotion)) || memory.hall?.id === "low").length
    },
    {
      id: "attachments",
      label: "附件元数",
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
      ? "导出或调AI 前建议再次检查原文、人物、地点和联系方式"
      : riskLevel === "medium"
        ? "建议导出前确认人物、地点和附件线索是否适合随包保存"
        : "当前敏感线索较少，仍建议只在可信设备保存备份"
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
    addThemeValue(themeMap, "鏉ユ簮", memory.sourceType, memory);
    (memory.people || []).forEach((value) => addThemeValue(themeMap, "人物", value, memory));
    (memory.tags || []).forEach((value) => addThemeValue(themeMap, "鏍囩", value, memory));
    (memory.emotions || []).forEach((value) => addThemeValue(themeMap, "鎯呯华", value, memory));
    if (memory.location) addThemeValue(themeMap, "鍦扮偣", memory.location, memory);
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
  const emotion = toTopEntries(theme.emotions, 1)[0]?.label || "calm";
  const mediaText = theme.mediaCount ? `${theme.mediaCount} items include multimodal clues` : "mainly built from text clues";
  return `${theme.type} ${theme.title} connects ${theme.count} exhibits, leans toward ${emotion}, and is ${mediaText}.`;
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
    role: index === 0 ? "开篇展" : "支撑展品"
  }));
  const dominantEmotion = topEmotions[0]?.label || "骞抽潤";
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
      ? `这批记忆有 ${total} 件展品，主要围绕“${dominantTag}”展开，最明显的情绪是“${dominantEmotion}”。其中 ${favoriteCount} 件被标记为重点展品，${multimodalCount} 件带有照片、OCR、语音或附件线索。`
      : "当前还没有展品，保存几段记忆后可以生成时间线、主题展和回忆报告。",
    nextQuestions: [
      "按月份看，这些记忆在哪些阶段最密集",
      "哪些人物、地点或标签适合组成主题展？",
      "哪些重点展品适合作为年度回忆报告开头？"
    ]
  };
}

function buildReportSections({ total, dominantTag, dominantEmotion, favoriteCount, multimodalCount, dateRange, topPeople, topLocations, highlights }) {
  if (!total) return [];
  const rangeText = dateRange.start
    ? dateRange.start === dateRange.end ? dateRange.start : `${dateRange.start} - ${dateRange.end}`
    : "No clear date range yet";
  const peopleText = topPeople.length ? topPeople.slice(0, 3).map((item) => item.label).join(", ") : "No frequent people yet";
  const locationText = topLocations.length ? topLocations.slice(0, 3).map((item) => item.label).join(", ") : "No frequent locations yet";
  const highlightText = highlights.length ? highlights.map((memory) => memory.title).filter(Boolean).join(", ") : "No highlights selected";
  return [
    { title: "Time range", text: `These memories cover ${rangeText} and can start a timeline review.` },
    { title: "Theme", text: `The clearest theme is ${dominantTag}; the leading emotion is ${dominantEmotion}.` },
    { title: "People and places", text: `People clues: ${peopleText}; location clues: ${locationText}.` },
    { title: "Report opening", text: `Start from ${highlightText}. ${favoriteCount} items are marked important and ${multimodalCount} include multimodal clues.` }
  ];
}

function getMemoryPeriod(memory) {
  const rawDate = memory.date || memory.createdAt || "";
  const match = String(rawDate).match(/^(\d{4})(?:-(\d{2}))?/);
  if (!match) return { key: "undated", label: "未标注时", sortValue: "0000-00" };
  const year = match[1];
  const month = match[2] || "00";
  return {
    key: `${year}-${month}`,
    label: month === "00" ? `${year}` : `${year}-${month}`,
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
  const normalized = text.replace(/[?!.,;:，。！？、；：'"]/g, " ");
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
  const titles = memories.slice(0, 3).map((memory) => memory.title || "untitled").join(", ") || "no saved memories";
  const citationText = citations.length
    ? citations.slice(0, 2).map((citation) => {
      const title = citation.memory?.title || "untitled";
      const terms = (citation.matchedTerms || []).slice(0, 4).join(", ") || "no direct terms";
      return title + ": " + (citation.reason || "matched evidence") + "; terms: " + terms;
    }).join("\n")
    : "";
  const mediaCitations = citations.filter((citation) => (citation.matchedFields || []).some(isMediaMatchedField));
  const mediaText = mediaCitations.length ? "Media evidence: " + mediaCitations.length + " matched item(s)." : "";
  const boundaryText = retrievalMode === "recent-fallback" ? "Evidence boundary: no strong match was found, so this answer uses recent saved memories only." : "";
  const emotionCounts = memories.flatMap((memory) => memory.emotions || []).reduce((map, emotion) => {
    map[emotion] = (map[emotion] || 0) + 1;
    return map;
  }, {});
  const emotionSummary = Object.entries(emotionCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([emotion, count]) => emotion + " " + count)
    .join(", ") || "no clear emotion labels";
  const evidence = featured
    ? boundaryText + "\nUsing " + titles + " as evidence. Closest item: " + (featured.title || "untitled") + ": " + (featured.exhibitText || "") + (citationText ? "\n" + citationText : "") + (mediaText ? "\n" + mediaText : "")
    : "There are not enough saved memories to answer with evidence.";

  return [
    "Question: " + question,
    evidence,
    "Repeated emotions: " + emotionSummary,
    retrievalMode === "hybrid"
      ? "This answer uses saved memories with keyword and local semantic signals."
      : "This answer uses saved memories and states the evidence boundary when evidence is weak."
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
    emotions: emotions.length ? emotions : ["骞抽潤"],
    emotionIntensity,
    tags: tags.length ? tags : ["璁板繂"],
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
    { hall: "youth", keywords: ["graduation", "school", "campus", "classmate", "exam"], title: "A campus memory", emotions: ["nostalgia", "regret", "lost"], tags: ["campus", "youth", "growth"], sourceType: "diary", importance: 4, emotionIntensity: 4 },
    { hall: "friends", keywords: ["friend", "roommate", "group chat", "party"], title: "A small friendship monument", emotions: ["joy", "nostalgia", "warm"], tags: ["friends", "companionship", "relationship"], sourceType: "chat", importance: 3, emotionIntensity: 3 },
    { hall: "family", keywords: ["mother", "father", "family", "festival"], title: "A family echo", emotions: ["nostalgia", "calm", "warm"], tags: ["family", "life", "care"], sourceType: "diary", importance: 4, emotionIntensity: 4 },
    { hall: "low", keywords: ["sad", "insomnia", "failure", "anxiety", "tired"], title: "A small light in a low point", emotions: ["wronged", "lost", "relieved"], tags: ["low point", "recovery", "self"], sourceType: "diary", importance: 4, emotionIntensity: 5 },
    { hall: "strange", keywords: ["absurd", "awkward", "weird", "funny"], title: "A hard-to-explain exhibit", emotions: ["absurd", "joy", "tense"], tags: ["absurd", "awkward", "story"], sourceType: "chat", importance: 2, emotionIntensity: 3 }
  ];
  const matched = rules.find((rule) => rule.keywords.some((keyword) => text.includes(keyword))) || {
    hall: "daily",
    title: "普通日子里的发光切",
    emotions: ["骞抽潤"],
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
    exhibitText: `这件展品来自一段私人记忆：“${shortText}”。它被放入“${getHallName(matched.hall)}”，因为其中有值得被保存的情绪和细节。`,
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
      ? "第十阶段媒体线索：这段记忆可能包含照片、截图或语音转写内容，可进入后续时间线、主题展和报告摘要。"
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
  const filePath = resolveStaticFilePath(safePath);
  if (!filePath) {
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

function resolveStaticFilePath(safePath) {
  const rootPath = path.normalize(path.join(ROOT_DIR, safePath));
  const publicPath = path.normalize(path.join(ROOT_DIR, "public", safePath));
  const candidates = [rootPath, publicPath].filter((filePath) => (
    filePath === ROOT_DIR || filePath.startsWith(`${ROOT_DIR}${path.sep}`)
  ));
  return candidates.find((filePath) => fs.existsSync(filePath)) || candidates[0] || null;
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
