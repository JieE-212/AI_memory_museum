const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { randomUUID } = require("crypto");
const { createMemoryStore } = require("./database");

const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, "public");

loadEnvFile(path.join(ROOT_DIR, ".env"));

const PORT = Number(process.env.PORT) || 3000;
const IS_VERCEL = Boolean(process.env.VERCEL);
const INTERVIEW_DEMO = parseEnvFlag(process.env.INTERVIEW_DEMO) || parseEnvFlag(process.env.DEMO_MODE);
const DB_PATH = process.env.DB_PATH || (INTERVIEW_DEMO
  ? path.join(os.tmpdir(), "ai-memory-museum-interview-demo.sqlite")
  : path.join(ROOT_DIR, "data", "memory-museum.sqlite"));
const APP_VERSION = "2.0.1";
const SCHEMA_VERSION = 2;
const MAX_RAW_LENGTH = 4000;
const MAX_BODY_LENGTH = 2 * 1024 * 1024;
const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS) || 20000;

const halls = [
  { id: "youth", name: "青春展厅", description: "校园、成长、毕业和那些没有说完的话。" },
  { id: "friends", name: "朋友展厅", description: "朋友、室友、群聊与共同经历。" },
  { id: "family", name: "家庭展厅", description: "家人、饭桌、节日和被照顾的瞬间。" },
  { id: "travel", name: "旅途展厅", description: "城市、车站、远方和路上的偶遇。" },
  { id: "low", name: "低谷展厅", description: "挫折、疲惫，以及重新站起来的过程。" },
  { id: "strange", name: "奇妙展厅", description: "荒诞、尴尬、离奇却难忘的片段。" },
  { id: "daily", name: "日常展厅", description: "普通日子里值得留下的小事。" }
];
const emotions = ["怀念", "快乐", "温暖", "感动", "兴奋", "紧张", "平静", "释然", "期待", "遗憾", "孤独", "委屈", "害怕", "迷茫"];
const sourceTypes = ["日记", "聊天片段", "照片描述", "旅行片段", "梦境", "物品", "语音转写", "其他"];
const importanceLabels = ["普通记录", "值得回看", "重要记忆", "珍贵记忆", "镇馆记忆"];
const hallIds = new Set(halls.map((hall) => hall.id));

resetInterviewDemoStorage();
const store = createMemoryStore({ dbPath: DB_PATH, halls, schemaVersion: SCHEMA_VERSION });
seedInterviewDemoData();

async function handleRequest(request, response) {
  setSecurityHeaders(response);

  try {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

    if (request.method === "GET" && url.pathname === "/api/health") {
      return sendJson(response, 200, {
        ok: true,
        name: "时屿",
        englishName: "TIME ISLE",
        tagline: "AI 私人记忆策展工具",
        version: APP_VERSION,
        mode: INTERVIEW_DEMO ? "interview-demo" : "local",
        storage: INTERVIEW_DEMO ? "ephemeral-sqlite" : "local-sqlite",
        aiMode: process.env.AI_API_KEY ? "configured" : "mock-fallback",
        stats: store.getStats()
      });
    }

    if (request.method === "GET" && url.pathname === "/api/version") {
      return sendJson(response, 200, {
        name: "时屿",
        englishName: "TIME ISLE",
        tagline: "AI 私人记忆策展工具",
        version: APP_VERSION,
        runtime: `Node.js ${process.version}`,
        architecture: ["Vanilla JS", "Node.js HTTP", "SQLite"],
        productFlow: ["记录", "AI 整理", "检索与讲解", "回顾", "安全导出"],
        demo: buildInterviewDemoStatus()
      });
    }

    if (request.method === "GET" && url.pathname === "/api/demo/status") {
      return sendJson(response, 200, buildInterviewDemoStatus());
    }

    if (isInterviewDemoBlockedMutation(request, url)) {
      return sendJson(response, 403, {
        error: "公开 Demo 已禁用删除和清空操作。",
        interviewDemo: true,
        blockedAction: `${request.method} ${url.pathname}`
      });
    }

    if (request.method === "GET" && url.pathname === "/api/options") {
      return sendJson(response, 200, {
        schemaVersion: SCHEMA_VERSION,
        halls,
        emotions,
        sourceTypes,
        importanceLabels,
        limits: { rawContent: MAX_RAW_LENGTH, body: MAX_BODY_LENGTH }
      });
    }

    if (request.method === "GET" && url.pathname === "/api/memories") {
      return sendJson(response, 200, { schemaVersion: SCHEMA_VERSION, memories: store.listMemories() });
    }

    if (request.method === "GET" && url.pathname === "/api/memories/export") {
      const mode = url.searchParams.get("mode") === "redacted" ? "redacted" : "full";
      return sendJson(response, 200, buildCollectionExport(store.listMemories(), mode));
    }

    if (request.method === "POST" && url.pathname === "/api/memories/import") {
      const body = await readJsonBody(request);
      const incoming = Array.isArray(body) ? body : body.memories;
      if (!Array.isArray(incoming)) throw httpError(400, "memories 数组不能为空。");
      const existingIds = new Set(store.listMemories().map((memory) => memory.id));
      const normalized = incoming.slice(0, 500).map((memory) => {
        const item = normalizeMemory(memory);
        // The JSON backup currently contains memories, not the referenced Agent run tables.
        // Clearing the foreign reference avoids attaching an imported copy to an unrelated run.
        item.agentRunId = "";
        if (existingIds.has(item.id)) item.id = createId("memory");
        existingIds.add(item.id);
        return item;
      });
      const result = store.importMemories(normalized);
      return sendJson(response, 200, { imported: result.imported, memories: result.memories });
    }

    if (request.method === "DELETE" && url.pathname === "/api/memories/purge") {
      const body = await readJsonBody(request).catch(() => ({}));
      if (body.confirm !== "DELETE") throw httpError(400, "confirm 必须是 DELETE。");
      return sendJson(response, 200, { ok: true, purge: store.purgeAll() });
    }

    if (request.method === "POST" && url.pathname === "/api/analyze") {
      const body = await readJsonBody(request);
      const rawContent = limitText(body.rawContent, MAX_RAW_LENGTH);
      if (!rawContent) throw httpError(400, "请先写下一段记忆。");
      const result = await analyzeMemory(rawContent);
      const savedRun = store.saveAgentRun(result.workflow, { rawContent, mode: result.mode });
      result.workflow.run.persisted = true;
      result.workflow.run.eventCount = savedRun.eventCount;
      result.draft.agentRunId = savedRun.id;
      return sendJson(response, 200, result);
    }

    if (request.method === "GET" && url.pathname === "/api/search") {
      const query = limitText(url.searchParams.get("query") || url.searchParams.get("q"), 160);
      const mode = ["keyword", "semantic", "hybrid"].includes(url.searchParams.get("mode"))
        ? url.searchParams.get("mode")
        : "hybrid";
      const limit = clampInteger(url.searchParams.get("limit"), 1, 50, 20);
      const results = store.searchMemories(query, { mode, limit, includeMeta: true });
      return sendJson(response, 200, {
        query,
        mode,
        count: results.length,
        results: results.map((item) => ({
          memory: item.memory,
          score: item.score,
          matchedTerms: item.matchedTerms,
          matchedFields: item.matchedFields,
          confidence: item.confidence,
          reason: item.reason
        }))
      });
    }

    if (request.method === "POST" && url.pathname === "/api/guide") {
      const body = await readJsonBody(request);
      const question = limitText(body.question, 300);
      if (!question) throw httpError(400, "请输入想问讲解员的问题。");
      return sendJson(response, 200, await answerGuideQuestion(question));
    }

    if (request.method === "GET" && url.pathname === "/api/insights") {
      const filters = {
        hall: limitText(url.searchParams.get("hall"), 40),
        year: limitText(url.searchParams.get("year"), 4)
      };
      return sendJson(response, 200, buildInsights(store.listMemories(), filters));
    }

    if (request.method === "GET" && url.pathname === "/api/privacy") {
      return sendJson(response, 200, buildPrivacySummary());
    }

    if (request.method === "POST" && url.pathname === "/api/memories") {
      const body = await readJsonBody(request);
      const memory = normalizeMemory(body);
      if (memory.agentRunId && !store.getAgentRun(memory.agentRunId)) memory.agentRunId = "";
      if (store.getMemory(memory.id)) throw httpError(409, "这条记忆已经存在。");
      const saved = store.saveMemory(memory);
      if (saved.agentRunId) store.attachAgentRunToMemory(saved.agentRunId, saved.id);
      return sendJson(response, 201, { schemaVersion: SCHEMA_VERSION, memory: store.getMemory(saved.id) });
    }

    const memoryAgentRunMatch = url.pathname.match(/^\/api\/memories\/([a-zA-Z0-9_-]{1,120})\/agent-run$/);
    if (request.method === "GET" && memoryAgentRunMatch) {
      const memory = store.getMemory(memoryAgentRunMatch[1]);
      if (!memory) throw httpError(404, "没有找到这件展品。");
      const run = (memory.agentRunId && store.getAgentRun(memory.agentRunId)) || store.getAgentRunForMemory(memory.id);
      if (!run) throw httpError(404, "这件展品没有 Agent 整理记录。");
      return sendJson(response, 200, { memoryId: memory.id, run });
    }

    const memoryMatch = url.pathname.match(/^\/api\/memories\/([a-zA-Z0-9_-]{1,120})$/);
    if (memoryMatch) {
      const id = memoryMatch[1];
      const existing = store.getMemory(id);
      if (!existing) throw httpError(404, "没有找到这件展品。");

      if (request.method === "GET") return sendJson(response, 200, { memory: existing });

      if (request.method === "PUT") {
        const body = await readJsonBody(request);
        const memory = normalizeMemory({ ...existing, ...body, id, createdAt: existing.createdAt, updatedAt: new Date().toISOString() });
        if (memory.agentRunId && !store.getAgentRun(memory.agentRunId)) memory.agentRunId = "";
        const saved = store.saveMemory(memory);
        if (saved.agentRunId) store.attachAgentRunToMemory(saved.agentRunId, saved.id);
        return sendJson(response, 200, { memory: store.getMemory(saved.id) });
      }

      if (request.method === "DELETE") {
        return sendJson(response, 200, { ok: store.deleteMemory(id), id });
      }
    }

    const agentRunMatch = url.pathname.match(/^\/api\/agent-runs\/([a-zA-Z0-9_-]{1,120})$/);
    if (request.method === "GET" && agentRunMatch) {
      const run = store.getAgentRun(agentRunMatch[1]);
      if (!run) throw httpError(404, "没有找到这次 Agent 整理记录。");
      return sendJson(response, 200, { run });
    }

    if (url.pathname.startsWith("/api/")) throw httpError(404, "接口不存在。");
    if (request.method !== "GET") throw httpError(405, "不支持该请求方法。");
    return serveStatic(url.pathname, response);
  } catch (error) {
    return sendError(response, error);
  }
}

async function analyzeMemory(rawContent) {
  const fallback = mockAnalyzeMemory(rawContent);
  let draft = fallback;
  let mode = "mock-fallback";
  let notice = "未配置 AI Key，已使用本地整理规则。";

  if (process.env.AI_API_KEY) {
    try {
      const content = await callAi([
        {
          role: "system",
          content: "你是私人记忆策展助手。只返回 JSON，字段为 title、hall、sourceType、exhibitText、date、location、people、tags、emotions、emotionIntensity、importance。hall 只能是 youth、friends、family、travel、low、strange、daily。数组使用中文短词，importance 和 emotionIntensity 为 1 到 5。不要编造原文没有的人名、地点或日期。"
        },
        { role: "user", content: rawContent }
      ]);
      draft = normalizeAnalysis(parseAiJson(content), rawContent, fallback);
      mode = "ai";
      notice = "AI 整理完成，请确认后保存。";
    } catch {
      notice = "AI 暂时不可用，已自动切换到本地整理规则。";
    }
  }

  return {
    mode,
    notice,
    draft,
    workflow: buildAgentWorkflow(draft, rawContent, mode)
  };
}

async function answerGuideQuestion(question) {
  let matches = store.searchMemories(question, { mode: "hybrid", limit: 4, includeMeta: true });
  if (!matches.length) {
    matches = store.listMemories().slice(0, 3).map((memory) => ({
      memory,
      score: 0,
      matchedTerms: [],
      matchedFields: [],
      confidence: { level: "weak", label: "补充参考", reason: "没有直接命中，按最近展品提供参考。" },
      reason: "最近展品参考"
    }));
  }

  const citations = matches.map((item) => ({
    id: item.memory.id,
    title: item.memory.title,
    hall: item.memory.hall,
    excerpt: limitText(item.memory.exhibitText || item.memory.rawContent, 120),
    confidence: item.confidence,
    reason: item.reason
  }));

  let answer = buildMockGuideAnswer(question, matches);
  let mode = "mock-fallback";

  if (process.env.AI_API_KEY && matches.length) {
    try {
      const evidence = matches.map((item, index) => ({
        ref: index + 1,
        title: item.memory.title,
        date: item.memory.date,
        hall: getHallName(item.memory.hall),
        exhibitText: limitText(item.memory.exhibitText, 300),
        tags: item.memory.tags
      }));
      answer = await callAi([
        {
          role: "system",
          content: "你是“时屿”的私人记忆讲解员。只能依据提供的展品证据回答，使用自然、克制的中文，并用 [1] [2] 标注引用。证据不足时明确说明，不要编造。"
        },
        { role: "user", content: `问题：${question}\n展品证据：${JSON.stringify(evidence)}` }
      ]);
      mode = "ai";
    } catch {
      // The local answer remains available when the configured model fails.
    }
  }

  return {
    question,
    mode,
    answer,
    citations,
    followUps: buildFollowUps(matches)
  };
}

function buildMockGuideAnswer(question, matches) {
  if (!matches.length) return "馆里还没有足够的展品可以回答这个问题。先记录一段相关记忆，再回来问我。";
  const lines = matches.slice(0, 3).map((item, index) => {
    const memory = item.memory;
    return `[${index + 1}]《${memory.title}》记录了${limitText(memory.exhibitText || memory.rawContent, 90)}。`;
  });
  const evidenceNote = matches.some((item) => item.score > 0)
    ? "这些展品与问题中的关键词、人物、地点或情绪形成了关联。"
    : "没有找到直接命中，以下内容来自最近展品，只作为回看线索。";
  return `关于“${question}”，我找到 ${matches.length} 件可以一起看的展品。${evidenceNote}\n\n${lines.join("\n")}`;
}

function buildFollowUps(matches) {
  const memory = matches[0]?.memory;
  if (!memory) return ["我可以先记录什么？", "怎样让检索更准确？"];
  const tag = memory.tags?.[0];
  return [
    `继续讲讲《${memory.title}》`,
    tag ? `还有哪些关于“${tag}”的记忆？` : "这段记忆里最重要的情绪是什么？",
    "把这些展品整理成一条回顾线索"
  ];
}

function buildInsights(memories, filters = {}) {
  const filtered = memories.filter((memory) => {
    if (filters.hall && filters.hall !== "all" && memory.hall !== filters.hall) return false;
    if (filters.year && !getMemoryDate(memory).startsWith(filters.year)) return false;
    return true;
  });

  const timelineMap = new Map();
  filtered.forEach((memory) => {
    const date = getMemoryDate(memory);
    const period = date ? date.slice(0, 7) : "未注明时间";
    if (!timelineMap.has(period)) timelineMap.set(period, []);
    timelineMap.get(period).push(memory);
  });
  const timeline = [...timelineMap.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([period, items]) => ({
      period,
      label: period === "未注明时间" ? period : period.replace("-", " 年 ") + " 月",
      count: items.length,
      memories: items.slice(0, 6).map(buildMemoryReference)
    }));

  const themeMap = new Map();
  filtered.forEach((memory) => {
    const values = [
      ...(memory.tags || []).map((name) => ({ name, type: "标签" })),
      ...(memory.emotions || []).map((name) => ({ name, type: "情绪" })),
      ...(memory.people || []).map((name) => ({ name, type: "人物" }))
    ];
    values.forEach(({ name, type }) => {
      const key = `${type}:${name}`;
      if (!themeMap.has(key)) themeMap.set(key, { name, type, memories: [] });
      themeMap.get(key).memories.push(memory);
    });
  });
  const themes = [...themeMap.values()]
    .sort((a, b) => b.memories.length - a.memories.length || a.name.localeCompare(b.name, "zh-CN"))
    .slice(0, 8)
    .map((theme) => ({
      name: theme.name,
      type: theme.type,
      count: theme.memories.length,
      summary: `${theme.memories.length} 件展品共同指向“${theme.name}”，适合继续补充或整理成专题回顾。`,
      memories: theme.memories.slice(0, 6).map(buildMemoryReference)
    }));

  const topTheme = themes[0];
  const favoriteCount = filtered.filter((memory) => memory.favorite).length;
  const datedCount = filtered.filter((memory) => getMemoryDate(memory)).length;
  const report = {
    title: filtered.length ? "这段记忆的回顾" : "等待更多展品",
    summary: filtered.length
      ? `当前范围内共有 ${filtered.length} 件展品，${datedCount} 件带有时间，${favoriteCount} 件被标为重点。${topTheme ? `最集中的线索是“${topTheme.name}”。` : "继续补充标签后会出现更清晰的主题。"}`
      : "先保存几段记忆，系统会在这里生成时间线、主题和回顾摘要。",
    highlights: filtered.slice(0, 5).map(buildMemoryReference)
  };

  return {
    filters,
    overview: { total: filtered.length, timelinePeriods: timeline.length, themes: themes.length, favorites: favoriteCount },
    timeline,
    themes,
    report
  };
}

function buildCollectionExport(memories, mode) {
  const exported = mode === "redacted" ? memories.map(redactMemory) : memories;
  return {
    product: "时屿",
    productEnglish: "TIME ISLE",
    version: APP_VERSION,
    schemaVersion: SCHEMA_VERSION,
    mode,
    exportedAt: new Date().toISOString(),
    count: exported.length,
    privacy: mode === "redacted" ? "原始正文、人物、地点和媒体备注已隐藏。" : "包含完整记忆，请妥善保管。",
    memories: exported
  };
}

function redactMemory(memory) {
  return {
    ...memory,
    rawContent: "[已隐藏原始记忆]",
    exhibitText: limitText(memory.exhibitText, 160),
    people: memory.people?.length ? ["[已隐藏人物]"] : [],
    location: memory.location ? "[已隐藏地点]" : "",
    coverImage: "",
    mediaNote: memory.mediaNote ? "[已隐藏媒体备注]" : "",
    attachments: []
  };
}

function buildPrivacySummary() {
  return {
    mode: INTERVIEW_DEMO ? "interview-demo" : "local-first",
    summary: INTERVIEW_DEMO
      ? "当前是公开面试 Demo，只使用示例数据和临时 SQLite。"
      : "记忆默认保存在本机 SQLite，只有配置 AI Key 并主动整理或提问时才会调用模型。",
    dataLocations: [
      { name: "记忆与 Agent 记录", location: INTERVIEW_DEMO ? "Vercel /tmp 临时 SQLite" : "本机 data/memory-museum.sqlite" },
      { name: "AI 请求", location: process.env.AI_API_KEY ? "配置的 OpenAI-compatible API" : "未发送，使用本地 Mock" },
      { name: "导出文件", location: "由浏览器下载到用户选择的位置" }
    ],
    controls: ["完整 JSON 备份", "脱敏 JSON 导出", "JSON 恢复", "明确确认后清空本地数据库"],
    destructiveActionsBlocked: INTERVIEW_DEMO
  };
}

function normalizeMemory(input = {}) {
  const now = new Date().toISOString();
  const rawContent = limitText(input.rawContent, MAX_RAW_LENGTH);
  const title = limitText(input.title, 80) || buildTitle(rawContent) || "未命名记忆";
  return {
    schemaVersion: SCHEMA_VERSION,
    id: sanitizeId(input.id) || createId("memory"),
    title,
    hall: hallIds.has(input.hall) ? input.hall : "daily",
    sourceType: sourceTypes.includes(input.sourceType) ? input.sourceType : "其他",
    rawContent,
    exhibitText: limitText(input.exhibitText, 800) || rawContent,
    date: limitText(input.date, 30),
    location: limitText(input.location, 80),
    people: normalizeList(input.people, 12, 30),
    tags: normalizeList(input.tags, 12, 30),
    emotions: normalizeList(input.emotions, 6, 20),
    emotionIntensity: clampInteger(input.emotionIntensity, 1, 5, 3),
    importance: clampInteger(input.importance, 1, 5, 2),
    favorite: parseBoolean(input.favorite),
    coverImage: limitText(input.coverImage, 300),
    mediaNote: limitText(input.mediaNote, 500),
    attachments: normalizeAttachments(input.attachments),
    agentRunId: sanitizeId(input.agentRunId),
    createdAt: normalizeDateTime(input.createdAt, now),
    updatedAt: input.updatedAt ? normalizeDateTime(input.updatedAt, now) : ""
  };
}

function normalizeAnalysis(value, rawContent, fallback = mockAnalyzeMemory(rawContent)) {
  return {
    ...fallback,
    title: limitText(value?.title, 80) || fallback.title,
    hall: hallIds.has(value?.hall) ? value.hall : fallback.hall,
    sourceType: sourceTypes.includes(value?.sourceType) ? value.sourceType : fallback.sourceType,
    exhibitText: limitText(value?.exhibitText, 800) || fallback.exhibitText,
    date: limitText(value?.date, 30) || fallback.date,
    location: limitText(value?.location, 80) || fallback.location,
    people: normalizeList(value?.people, 12, 30).length ? normalizeList(value.people, 12, 30) : fallback.people,
    tags: normalizeList(value?.tags, 12, 30).length ? normalizeList(value.tags, 12, 30) : fallback.tags,
    emotions: normalizeList(value?.emotions, 6, 20).length ? normalizeList(value.emotions, 6, 20) : fallback.emotions,
    emotionIntensity: clampInteger(value?.emotionIntensity, 1, 5, fallback.emotionIntensity),
    importance: clampInteger(value?.importance, 1, 5, fallback.importance),
    rawContent
  };
}

function mockAnalyzeMemory(rawContent) {
  const text = rawContent.trim();
  const hall = inferHall(text);
  const inferredEmotions = inferEmotions(text);
  const date = extractDate(text);
  const location = extractLocation(text);
  const people = extractPeople(text);
  const sourceType = inferSourceType(text);
  const tags = inferTags(text, hall, inferredEmotions);
  return {
    title: buildTitle(text),
    hall,
    sourceType,
    rawContent: text,
    exhibitText: `这件展品记录了${stripEnding(limitText(text, 180))}。它被保留下来，不是为了给经历下结论，而是为了以后还能找到当时的人、地点和感受。`,
    date,
    location,
    people,
    tags,
    emotions: inferredEmotions,
    emotionIntensity: /崩溃|大哭|狂喜|激动|害怕|愤怒/.test(text) ? 5 : /难过|遗憾|开心|温暖|紧张/.test(text) ? 4 : 3,
    importance: /第一次|最后一次|毕业|告别|重要|永远|离开|家人/.test(text) ? 4 : text.length > 180 ? 3 : 2,
    favorite: false,
    coverImage: "",
    mediaNote: "",
    attachments: []
  };
}

function buildAgentWorkflow(draft, rawContent, mode) {
  const now = new Date().toISOString();
  const id = createId("run");
  const reviewItems = [];
  if (!draft.date) reviewItems.push("时间未注明");
  if (!draft.location) reviewItems.push("地点未注明");
  if (!draft.people.length) reviewItems.push("人物未注明");
  return {
    phase: 1,
    mode,
    run: {
      id,
      phase: 1,
      mode,
      createdAt: now,
      persisted: false,
      events: [
        { id: `${id}-event-1`, type: "started", label: "开始读取原始记忆", step: "archive", at: now },
        { id: `${id}-event-2`, type: "structured", label: "完成结构化整理", step: "curate", at: now },
        { id: `${id}-event-3`, type: "ready", label: "生成可确认的展品草稿", step: "write", at: now }
      ]
    },
    summary: {
      status: "ready_for_review",
      title: draft.title,
      hall: draft.hall,
      reviewItems
    },
    steps: [
      {
        id: "archive",
        agent: "档案 Agent",
        duty: "提取原始线索",
        status: "done",
        output: `识别来源“${draft.sourceType}”，提取时间、地点和人物线索。`,
        evidence: [limitText(rawContent, 120)],
        actions: ["提取事实", "保留原文"]
      },
      {
        id: "curate",
        agent: "策展 Agent",
        duty: "判断展厅与情绪",
        status: "done",
        output: `建议进入${getHallName(draft.hall)}，情绪为${draft.emotions.join("、") || "待确认"}。`,
        evidence: draft.tags,
        actions: ["展厅分类", "情绪标注", "重要度判断"]
      },
      {
        id: "write",
        agent: "编辑 Agent",
        duty: "生成展品草稿",
        status: "done",
        output: `生成标题《${draft.title}》和展品说明，等待用户确认。`,
        evidence: [draft.title, ...draft.tags.slice(0, 3)],
        actions: ["标题生成", "说明撰写", "人工确认"]
      }
    ]
  };
}

function inferHall(text) {
  const rules = [
    ["family", /家人|妈妈|母亲|爸爸|父亲|爷爷|奶奶|外婆|外公|饭桌|春节|家里/],
    ["friends", /朋友|同学|室友|群聊|伙伴|闺蜜|兄弟/],
    ["youth", /校园|学校|毕业|青春|操场|教室|考试|老师|大学|高中|初中/],
    ["travel", /旅行|车站|机场|酒店|海边|景点|远方|出发|城市|航班/],
    ["low", /低谷|崩溃|失眠|挫折|失败|疲惫|孤独|迷茫|难过|告别/],
    ["strange", /梦见|梦里|荒诞|尴尬|离谱|奇怪|社死/]
  ];
  return rules.find(([, pattern]) => pattern.test(text))?.[0] || "daily";
}

function inferEmotions(text) {
  const rules = [
    ["怀念", /怀念|想起|从前|小时候|过去|曾经/],
    ["快乐", /开心|快乐|大笑|高兴|有趣/],
    ["温暖", /温暖|陪伴|照顾|拥抱|安慰/],
    ["感动", /感动|泪目|被打动/],
    ["兴奋", /兴奋|激动|期待已久/],
    ["紧张", /紧张|忐忑|考试|面试/],
    ["平静", /平静|安静|散步|晚风/],
    ["释然", /释然|放下|想通/],
    ["期待", /期待|希望|盼望/],
    ["遗憾", /遗憾|错过|没来得及|最后一次/],
    ["孤独", /孤独|一个人|没人/],
    ["委屈", /委屈|误解/],
    ["害怕", /害怕|恐惧|担心/],
    ["迷茫", /迷茫|不知道怎么办|没有方向/]
  ];
  const matched = rules.filter(([, pattern]) => pattern.test(text)).map(([emotion]) => emotion);
  return matched.length ? matched.slice(0, 3) : ["平静"];
}

function inferTags(text, hall, inferredEmotions) {
  const words = ["毕业", "校园", "朋友", "家人", "旅行", "照片", "日记", "告别", "成长", "雨天", "晚风", "生日", "春节", "第一次", "梦境"];
  const hits = words.filter((word) => text.includes(word));
  return [...new Set([getHallName(hall).replace("展厅", ""), ...hits, ...inferredEmotions.slice(0, 1)])].slice(0, 6);
}

function inferSourceType(text) {
  if (/照片|相册|拍下|镜头/.test(text)) return "照片描述";
  if (/聊天|群聊|消息|他说|她说/.test(text)) return "聊天片段";
  if (/旅行|车站|机场|酒店|景点/.test(text)) return "旅行片段";
  if (/梦见|梦里|做了一个梦/.test(text)) return "梦境";
  if (/语音|录音/.test(text)) return "语音转写";
  return "日记";
}

function extractDate(text) {
  const full = text.match(/((?:19|20)\d{2})[年\-/.](\d{1,2})(?:[月\-/.](\d{1,2})日?)?/);
  if (full) return `${full[1]}-${String(full[2]).padStart(2, "0")}${full[3] ? `-${String(full[3]).padStart(2, "0")}` : ""}`;
  const year = text.match(/((?:19|20)\d{2})年/);
  return year ? year[1] : "";
}

function extractLocation(text) {
  const match = text.match(/(?:在|到了|来到)([\u4e00-\u9fa5A-Za-z0-9·]{2,12})(?:时|的时候|，|。|、|和|一起|附近|门口)/);
  return match ? match[1] : "";
}

function extractPeople(text) {
  const labels = ["妈妈", "爸爸", "母亲", "父亲", "爷爷", "奶奶", "外婆", "外公", "姐姐", "哥哥", "弟弟", "妹妹", "老师", "室友", "同学", "朋友"];
  return labels.filter((label) => text.includes(label)).slice(0, 8);
}

function buildTitle(text) {
  const first = String(text || "").split(/[。！？!?\n]/).map((item) => item.trim()).find(Boolean) || "一段值得留下的记忆";
  const cleaned = first.replace(/^(今天|昨天|那天|我记得|想起|有一次)[，,：:\s]*/, "").trim();
  return limitText(cleaned || first, 26);
}

function buildMemoryReference(memory) {
  return {
    id: memory.id,
    title: memory.title,
    date: memory.date,
    hall: memory.hall,
    hallName: getHallName(memory.hall),
    excerpt: limitText(memory.exhibitText || memory.rawContent, 100)
  };
}

async function callAi(messages) {
  const baseUrl = String(process.env.AI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.AI_API_KEY}`
      },
      body: JSON.stringify({
        model: process.env.AI_MODEL || "gpt-4.1-mini",
        messages,
        temperature: 0.3
      }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`AI request failed: ${response.status}`);
    const payload = await response.json();
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error("AI response was empty");
    return content.trim();
  } finally {
    clearTimeout(timeout);
  }
}

function parseAiJson(content) {
  const cleaned = String(content || "").replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("AI response did not contain JSON");
    return JSON.parse(cleaned.slice(start, end + 1));
  }
}

function seedInterviewDemoData() {
  if (!INTERVIEW_DEMO || store.listMemories().length) return;
  const samples = [
    {
      id: "demo-campus-farewell",
      title: "操场尽头的告别",
      hall: "youth",
      sourceType: "日记",
      rawContent: "毕业那天傍晚，我们在操场尽头站了很久。大家都说以后常联系，但真正想说的话反而没有说出口。",
      exhibitText: "毕业傍晚的操场保存了青春快结束时的重量：热闹散去以后，沉默也成了一种告别。",
      date: "2021-06-18",
      location: "学校操场",
      people: ["同学"],
      tags: ["毕业", "校园", "告别"],
      emotions: ["怀念", "遗憾"],
      emotionIntensity: 4,
      importance: 4,
      favorite: true
    },
    {
      id: "demo-family-noodles",
      title: "凌晨到家的一碗面",
      hall: "family",
      sourceType: "日记",
      rawContent: "有次出差很晚才到家，妈妈没有多问，只把厨房里温着的面端出来。那一刻突然觉得，回家是有人替你留着一盏灯。",
      exhibitText: "一碗深夜的面，把家最具体的样子留了下来：不追问理由，只先照顾疲惫。",
      date: "2023-11-02",
      location: "家里",
      people: ["妈妈"],
      tags: ["家人", "回家", "饭桌"],
      emotions: ["温暖", "感动"],
      emotionIntensity: 5,
      importance: 4,
      favorite: true
    },
    {
      id: "demo-rain-walk",
      title: "雨停以后绕远的路",
      hall: "daily",
      sourceType: "照片描述",
      rawContent: "雨停后我没有立刻回去，而是沿着河边多走了一段。路灯落在积水里，普通的一天忽然安静了下来。",
      exhibitText: "这不是重大事件，只是一段雨后的绕路。正因为普通，它提醒人生活也会在没有预告时变得柔软。",
      date: "2024-04-12",
      location: "河边",
      people: [],
      tags: ["雨天", "散步", "日常"],
      emotions: ["平静", "释然"],
      emotionIntensity: 2,
      importance: 2,
      favorite: false
    },
    {
      id: "demo-friend-call",
      title: "低谷里打来的电话",
      hall: "friends",
      sourceType: "聊天片段",
      rawContent: "最迷茫的那段时间，一个朋友突然打来电话。他没有劝我振作，只陪我把混乱的话说完。后来想起，真正的帮助有时只是没有提前挂断。",
      exhibitText: "这通电话没有解决所有问题，却留下了陪伴最可信的证据：在混乱被说完以前，对方一直都在。",
      date: "2022-09",
      location: "",
      people: ["朋友"],
      tags: ["朋友", "陪伴", "低谷"],
      emotions: ["迷茫", "温暖"],
      emotionIntensity: 4,
      importance: 4,
      favorite: true
    }
  ];

  samples.forEach((sample, index) => {
    const memory = normalizeMemory({
      ...sample,
      createdAt: new Date(Date.now() - index * 3600000).toISOString()
    });
    if (index === 0) {
      const workflow = buildAgentWorkflow(memory, memory.rawContent, "mock-seed");
      workflow.run.memoryId = memory.id;
      const savedRun = store.saveAgentRun(workflow, { rawContent: memory.rawContent, mode: "mock-seed", memoryId: memory.id });
      memory.agentRunId = savedRun.id;
    }
    store.saveMemory(memory);
    if (memory.agentRunId) store.attachAgentRunToMemory(memory.agentRunId, memory.id);
  });
}

function buildInterviewDemoStatus() {
  return {
    interviewDemo: INTERVIEW_DEMO,
    mode: INTERVIEW_DEMO ? "interview-demo" : "local",
    storage: INTERVIEW_DEMO ? "ephemeral-sqlite-on-tmp" : "local-sqlite",
    seededExamples: INTERVIEW_DEMO ? 4 : 0,
    destructiveActionsBlocked: INTERVIEW_DEMO,
    aiMode: process.env.AI_API_KEY ? "configured" : "mock-fallback"
  };
}

function isInterviewDemoBlockedMutation(request, url) {
  return INTERVIEW_DEMO && (request.method === "DELETE" || url.pathname === "/api/memories/purge");
}

function resetInterviewDemoStorage() {
  if (!INTERVIEW_DEMO) return;
  [DB_PATH, `${DB_PATH}-shm`, `${DB_PATH}-wal`].forEach((filePath) => {
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {
      // A concurrent warm instance may already own the file; seeding remains idempotent.
    }
  });
}

async function readJsonBody(request) {
  let total = 0;
  const chunks = [];
  for await (const chunk of request) {
    total += chunk.length;
    if (total > MAX_BODY_LENGTH) throw httpError(413, "请求内容过大。");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw httpError(400, "请求不是有效的 JSON。");
  }
}

function serveStatic(urlPath, response) {
  let pathname = urlPath === "/" ? "/index.html" : urlPath;
  try {
    pathname = decodeURIComponent(pathname);
  } catch {
    throw httpError(400, "无效路径。");
  }
  const relative = path.normalize(pathname).replace(/^([/\\])+/, "");
  const filePath = path.resolve(PUBLIC_DIR, relative);
  if (!filePath.startsWith(`${PUBLIC_DIR}${path.sep}`) && filePath !== path.join(PUBLIC_DIR, "index.html")) {
    throw httpError(403, "禁止访问该路径。");
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) throw httpError(404, "页面不存在。");
  response.statusCode = 200;
  response.setHeader("Content-Type", getContentType(filePath));
  response.setHeader("Cache-Control", filePath.endsWith("index.html") ? "no-cache" : "public, max-age=300");
  fs.createReadStream(filePath).pipe(response);
}

function getContentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp"
  }[extension] || "application/octet-stream";
}

function setSecurityHeaders(response) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "same-origin");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader("Content-Security-Policy", "default-src 'self'; connect-src 'self'; img-src 'self' data: https:; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
}

function sendJson(response, statusCode, payload) {
  if (response.headersSent) return;
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(payload));
}

function sendError(response, error) {
  const statusCode = Number(error.statusCode) || 500;
  if (statusCode >= 500) console.error(error);
  return sendJson(response, statusCode, {
    error: statusCode >= 500 ? "服务器暂时无法完成请求。" : error.message
  });
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeList(value, maxLength, itemLength) {
  const values = Array.isArray(value) ? value : String(value || "").split(/[，,、\n]/);
  return [...new Set(values.map((item) => limitText(item, itemLength)).filter(Boolean))].slice(0, maxLength);
}

function normalizeAttachments(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 12).map((item) => ({
    name: limitText(typeof item === "string" ? item : item?.name, 80),
    type: limitText(typeof item === "object" ? item?.type : "其他", 30) || "其他",
    note: limitText(typeof item === "object" ? item?.note : "", 180)
  })).filter((item) => item.name);
}

function normalizeDateTime(value, fallback) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

function sanitizeId(value) {
  const id = String(value || "").trim();
  return /^[a-zA-Z0-9_-]{1,120}$/.test(id) ? id : "";
}

function createId(prefix) {
  return `${prefix}-${randomUUID()}`;
}

function limitText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function clampInteger(value, min, max, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function parseBoolean(value) {
  return value === true || value === 1 || value === "1" || value === "true" || value === "on";
}

function parseEnvFlag(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function getHallName(id) {
  return halls.find((hall) => hall.id === id)?.name || "日常展厅";
}

function getMemoryDate(memory) {
  const date = limitText(memory.date, 30);
  if (/^\d{4}/.test(date)) return date;
  const created = limitText(memory.createdAt, 40);
  return /^\d{4}/.test(created) ? created.slice(0, 10) : "";
}

function stripEnding(value) {
  return String(value || "").replace(/[。！？!?；;，,]+$/, "");
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8");
  content.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const separator = trimmed.indexOf("=");
    if (separator < 1) return;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  });
}

if (IS_VERCEL) {
  module.exports = handleRequest;
} else {
  const server = http.createServer(handleRequest);
  server.listen(PORT, "127.0.0.1", () => {
    console.log(`时屿（TIME ISLE）已启动：http://127.0.0.1:${PORT}`);
    console.log(process.env.AI_API_KEY ? "AI 模式：已配置模型" : "AI 模式：本地 Mock 回退");
  });
  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") console.error(`端口 ${PORT} 已被占用，请设置其他 PORT。`);
    else console.error(error);
    process.exit(1);
  });
  const shutdown = () => {
    try {
      store.close();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
