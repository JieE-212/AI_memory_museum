const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { randomUUID } = require("crypto");
const { createMemoryStore } = require("./database");
const { createCollectionExporter } = require("./lib/collection-export");
const { createCollectionImporter } = require("./lib/collection-import");
const { createExhibitionApi } = require("./lib/exhibition-api");
const { seedInterviewDemoData } = require("./lib/demo-seed");
const { createRevisitApi } = require("./lib/revisit-api");
const { createClueApi } = require("./lib/clue-api");
const { createCapsuleApi } = require("./lib/capsule-api");
const { createOfflineExhibitApi } = require("./lib/offline-exhibit-api");
const { createRevisionApi, memoryEtag, requireMemoryPrecondition } = require("./lib/revision-api");
const { buildSafeSnapshot } = require("./lib/capsule-service");
const { createPrivacySummary } = require("./lib/privacy-summary");
const { createMediaStorage } = require("./lib/media-storage");
const { createMediaApi } = require("./lib/media-api");
const { createVoiceStorage } = require("./lib/voice-storage");
const { createVoiceApi, publicAsset: publicVoiceAsset, publicTranscript: publicVoiceTranscript } = require("./lib/voice-api");
const { listImageEvidenceForMemory } = require("./lib/media-evidence");
const {
  buildConnections,
  buildPuzzle,
  buildCuratorQuestion,
  buildFeaturedRoute
} = require("./lib/archaeology");
const { buildArchaeologyBackup, restoreArchaeologyBackup, validateArchaeologyBackup } = require("./lib/archaeology-backup");
const { buildMediaArchiveFile, prepareMediaArchive } = require("./lib/media-backup");
const { restorePreparedArchive } = require("./lib/media-restore");
const { sendArchiveFile, withRequestAbort } = require("./lib/archive-http");
const { cleanupArchiveStaging } = require("./lib/archive-staging");
const { resetDemoStorage, createDemoCapacityGuard } = require("./lib/demo-safety");
const { createRequestSecurity, platformHostsFromEnv } = require("./lib/request-security");
const { createRuntimeMetadata } = require("./lib/runtime-metadata");
const { createCollectionHealthApi } = require("./lib/collection-health-api");
const { createArchiveInspectionApi } = require("./lib/archive-inspection-api");

const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
loadEnvFile(path.join(ROOT_DIR, ".env"));

const PORT = Number(process.env.PORT) || 3000;
const IS_VERCEL = Boolean(process.env.VERCEL);
const requestSecurity = createRequestSecurity({ deployment: IS_VERCEL, allowedHosts: process.env.ALLOWED_HOSTS, platformHosts: platformHostsFromEnv(process.env) });
const INTERVIEW_DEMO = parseEnvFlag(process.env.INTERVIEW_DEMO) || parseEnvFlag(process.env.DEMO_MODE);
const DB_PATH = process.env.DB_PATH || (INTERVIEW_DEMO
  ? path.join(os.tmpdir(), "ai-memory-museum-interview-demo.sqlite")
  : path.join(ROOT_DIR, "data", "memory-museum.sqlite"));
const MEDIA_ROOT = process.env.MEDIA_ROOT || (INTERVIEW_DEMO
  ? path.join(os.tmpdir(), "ai-memory-museum-interview-demo-media")
  : path.join(path.dirname(DB_PATH), "media"));
const VOICE_ROOT = INTERVIEW_DEMO ? path.join(MEDIA_ROOT, "voice") : (process.env.VOICE_ROOT || path.join(MEDIA_ROOT, "voice"));
const APP_VERSION = "7.3.0";
const SCHEMA_VERSION = 11;
const MAX_RAW_LENGTH = 4000;
const MAX_BODY_LENGTH = 2 * 1024 * 1024;
const MAX_IMPORT_BODY_LENGTH = 64 * 1024 * 1024;
const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS) || 20000;
const AI_ENABLED = Boolean(process.env.AI_API_KEY) && !INTERVIEW_DEMO;
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

if (INTERVIEW_DEMO) resetDemoStorage({ dbPath: DB_PATH, mediaRoot: MEDIA_ROOT });
const store = createMemoryStore({ dbPath: DB_PATH, halls, schemaVersion: SCHEMA_VERSION });
const demoCapacity = createDemoCapacityGuard({ enabled: INTERVIEW_DEMO, withTransaction: store.withTransaction, errorFactory: httpError });
const runtimeMetadata = createRuntimeMetadata({ appVersion: APP_VERSION, interviewDemo: INTERVIEW_DEMO, aiEnabled: AI_ENABLED, demoLimits: demoCapacity.limits });
const mediaStorage = createMediaStorage({ root: MEDIA_ROOT });
const mediaApi = createMediaApi({ store, storage: mediaStorage, interviewDemo: INTERVIEW_DEMO, sendJson, readJsonBody, httpError });
const voiceStorage = createVoiceStorage({ root: VOICE_ROOT });
const voiceApi = createVoiceApi({ store, storage: voiceStorage, interviewDemo: INTERVIEW_DEMO, sendJson, readJsonBody, httpError });
const exhibitionApi = createExhibitionApi({ database: store, store, interviewDemo: INTERVIEW_DEMO, sendJson, readJsonBody, httpError });
const revisitApi = createRevisitApi({ database: store, store, interviewDemo: INTERVIEW_DEMO, decorateMemory: withMemoryMedia, sendJson, readJsonBody, httpError });
const clueApi = createClueApi({ database: store, store, interviewDemo: INTERVIEW_DEMO, decorateMemory: withMemoryMedia, sendJson, readJsonBody, httpError });
const capsuleApi = createCapsuleApi({ database: store, store, buildSafeSnapshot, interviewDemo: INTERVIEW_DEMO, sendJson, readJsonBody, httpError });
const offlineExhibitApi = createOfflineExhibitApi({ database: store, store, buildSafeSnapshot, interviewDemo: INTERVIEW_DEMO, sendJson, readJsonBody, httpError });
const revisionApi = createRevisionApi({ store, sendJson, readJsonBody, httpError, decorateMemory: withMemoryMedia, normalizeNote: (value) => limitText(value, 500) });
const collectionHealthApi = createCollectionHealthApi({ store, mediaStorage, voiceStorage, mediaApi, voiceApi, sendJson, readJsonBody, httpError });
const archiveInspectionApi = createArchiveInspectionApi({ mediaRoot: MEDIA_ROOT, prepareMediaArchive, validateVoiceBackup: store.validateVoiceBackup, supportedSchemaVersion: SCHEMA_VERSION, sendJson, httpError });
const buildCollectionExport = createCollectionExporter({ store, appVersion: APP_VERSION, schemaVersion: SCHEMA_VERSION, buildArchaeologyBackup });
const importCollection = createCollectionImporter({
  store,
  normalizeMemory,
  sanitizeId,
  createId,
  validateArchaeologyBackup,
  restoreArchaeologyBackup,
  httpError,
  schemaVersion: SCHEMA_VERSION
});
const buildPrivacySummary = createPrivacySummary({
  interviewDemo: INTERVIEW_DEMO,
  aiEnabled: AI_ENABLED,
  featureLocations: [
    { name: "记忆年轮与并发保护", location: "正文历史以可校验快照保存在本机 SQLite；每次恢复都会生成新的 head，不覆盖旧版本" },
    { name: "时光胶囊与加密离线展览", location: "胶囊外壳与安全快照分表保存在本机 SQLite；分享口令只在浏览器内用于加密，不发送给服务端，也不写入导出文件" },
    { name: "回访状态与明确意愿", location: "查看/略过状态、欢迎出现、指定日期以后或暂停主动出现均只保存在本机 SQLite；later 会保存用户选择的本地日期与 IANA 时区，不生成心理判断" },
    { name: "实体线索、别名与检索索引", location: "仅保存于本机 SQLite；同名默认只是线索，只有明确确认后才会新增别名或合并档案" },
    { name: "声音片段与人工文字稿", location: "声音文件仅保存在本机内容寻址目录；只有人工确认的文字稿会进入本地检索，不发送给外部模型" }
  ],
  featureControls: ["编辑与历史恢复必须匹配当前展品版本，冲突时不会覆盖较新的内容", "回访意愿只接受用户明确确认；恢复自然回访会删除对应长期意愿记录", "实体别名与合并必须先预览，再由用户明确确认", "声音文字稿只有人工确认后才会公开展示并进入检索"]
});
seedInterviewDemoData({
  enabled: INTERVIEW_DEMO,
  store,
  normalizeMemory,
  buildAgentWorkflow
});
let mediaMaintenancePromise = null;
const startupMaintenance = runMediaMaintenance().catch((error) => console.error("媒体维护失败：", error.message));

function runMediaMaintenance(minimumAgeMs = 0) {
  if (mediaMaintenancePromise) return mediaMaintenancePromise;
  mediaMaintenancePromise = performMediaMaintenance(minimumAgeMs).finally(() => { mediaMaintenancePromise = null; });
  return mediaMaintenancePromise;
}

async function performMediaMaintenance(minimumAgeMs = 0) {
  const before = minimumAgeMs ? new Date(Date.now() - minimumAgeMs).toISOString() : "";
  cleanupArchiveStaging({ mediaRoot: MEDIA_ROOT, minimumAgeMs: Math.max(60 * 60 * 1000, Number(minimumAgeMs) || 0) });
  await mediaApi.withMediaOperation(() => mediaStorage.cleanupStaleStages());
  await mediaApi.reconcileQuarantine({ minimumAgeMs });
  await mediaApi.reconcileAssetDirectories();
  await mediaApi.garbageCollect({ status: "pending_delete", before, limit: 500 });
  await mediaApi.garbageCollect({ status: "ready", limit: 500 });
  await voiceApi.reconcileQuarantine({ minimumAgeMs });
  await voiceApi.withVoiceOperation(() => voiceStorage.cleanupStaleStages());
  await voiceApi.garbageCollect({ status: "pending_delete", before, limit: 500 });
  await voiceApi.garbageCollect({ status: "ready", limit: 500 });
}

async function handleRequest(request, response) {
  setSecurityHeaders(response);
  try {
    const requestContext = requestSecurity.validate(request);
    await startupMaintenance;
    const url = new URL(request.url, requestContext.origin);
    if (
      url.pathname.startsWith("/api/") &&
      ["POST", "PUT"].includes(request.method) &&
      !mediaApi.isRawMediaRequest(request, url) &&
      !voiceApi.isRawVoiceRequest(request, url) &&
      !isArchiveBinaryRequest(request, url) &&
      !String(request.headers["content-type"] || "").toLowerCase().includes("application/json")
    ) {
      throw httpError(415, "写入接口只接受 application/json。");
    }

    if (request.method === "GET" && url.pathname === "/api/health") {
      return sendJson(response, 200, {
        ok: true,
        name: "时屿",
        englishName: "TIME ISLE",
        tagline: "AI 私人记忆策展工具",
        version: APP_VERSION,
        schemaVersion: SCHEMA_VERSION,
        mode: INTERVIEW_DEMO ? "interview-demo" : "local",
        storage: INTERVIEW_DEMO ? "ephemeral-sqlite" : "local-sqlite",
        aiMode: AI_ENABLED ? "configured" : "mock-fallback",
        search: {
          mode: "semantic-clues",
          engine: "fts5-trigram",
          shortQueryFallback: "parameterized-like",
          externalModelRequired: false
        },
        stats: store.getStats()
      });
    }

    if (request.method === "GET" && url.pathname === "/api/version") {
      return sendJson(response, 200, runtimeMetadata.version());
    }

    if (request.method === "GET" && url.pathname === "/api/demo/status") {
      return sendJson(response, 200, runtimeMetadata.demoStatus());
    }

    if (isInterviewDemoBlockedMutation(request, url)) {
      return sendJson(response, 403, {
        error: "公开 Demo 已阻止这项会影响示例稳定性的操作。",
        interviewDemo: true,
        blockedAction: `${request.method} ${url.pathname}`
      });
    }

    const mediaHandled = await mediaApi.handle(request, response, url);
    if (mediaHandled !== false) return mediaHandled;
    const voiceHandled = await voiceApi.handle(request, response, url);
    if (voiceHandled !== false) return voiceHandled;
    const exhibitionHandled = await exhibitionApi.handle(request, response, url);
    if (exhibitionHandled !== false) return exhibitionHandled;
    const revisitHandled = await revisitApi.handle(request, response, url);
    if (revisitHandled !== false) return revisitHandled;
    const clueHandled = await clueApi.handle(request, response, url);
    if (clueHandled !== false) return clueHandled;
    const capsuleHandled = await capsuleApi.handle(request, response, url);
    if (capsuleHandled !== false) return capsuleHandled;
    const offlineExhibitHandled = await offlineExhibitApi.handle(request, response, url);
    if (offlineExhibitHandled !== false) return offlineExhibitHandled;
    const revisionHandled = await revisionApi.handle(request, response, url);
    if (revisionHandled !== false) return revisionHandled;
    const collectionHealthHandled = await collectionHealthApi.handle(request, response, url);
    if (collectionHealthHandled !== false) return collectionHealthHandled;
    const archiveInspectionHandled = await archiveInspectionApi.handle(request, response, url);
    if (archiveInspectionHandled !== false) return archiveInspectionHandled;

    if (request.method === "GET" && url.pathname === "/api/archive/export") {
      const mode = url.searchParams.get("mode") === "redacted" ? "redacted" : "full";
      return await withRequestAbort(request, response, async (signal) => {
        const archive = await mediaApi.withMediaOperation(() => voiceApi.withVoiceOperation(() => {
          const collection = buildCollectionExport(store.listMemories().map(withMemoryMedia), mode);
          return buildMediaArchiveFile({ collection, store, storage: mediaStorage, voiceStorage, appVersion: APP_VERSION, schemaVersion: SCHEMA_VERSION, outputRoot: path.join(MEDIA_ROOT, ".exports"), signal });
        }));
        try { return await sendArchiveFile(response, archive, mode, { signal }); }
        finally { await archive.cleanup(); try { fs.rmdirSync(path.join(MEDIA_ROOT, ".exports")); } catch { /* another export may still use it */ } }
      });
    }

    if (request.method === "POST" && url.pathname === "/api/archive/restore") {
      assertArchiveContentType(request);
      return await withRequestAbort(request, response, async (signal) => {
        const restoreParent = path.join(MEDIA_ROOT, ".restore");
        const stagingRoot = path.join(restoreParent, `restore-${randomUUID()}`);
        try {
          const prepared = await prepareMediaArchive(request, { stagingRoot, validateVoiceBackup: store.validateVoiceBackup, supportedSchemaVersion: SCHEMA_VERSION, signal });
          signal.throwIfAborted();
          const restored = await mediaApi.withMediaOperation(() => voiceApi.withVoiceOperation(() => {
            signal.throwIfAborted();
            return restorePreparedArchive({
              prepared, store, storage: mediaStorage, voiceStorage, normalizeMemory,
              validateArchaeologyBackup, restoreArchaeologyBackup,
              validateExhibitionBackup: store.validateExhibitionBackup, restoreExhibitionBackup: store.restoreExhibitionBackup,
              validateRevisitBackup: store.validateRevisitBackup, restoreRevisitBackup: store.restoreRevisitBackup,
              validateRevisitIntentBackup: store.validateRevisitIntentBackup,
              restoreRevisitIntentBackup: store.restoreRevisitIntentBackup,
              validateEntityBackup: store.validateClueBackup, restoreEntityBackup: store.restoreClueBackup,
              validateVoiceBackup: store.validateVoiceBackup, restoreVoiceBackup: store.restoreVoiceBackup,
              validateCapsuleBackup: store.validateCapsuleBackup, restoreCapsuleBackup: store.restoreCapsuleBackup,
              validateRevisionBackup: store.validateRevisionBackup, restoreRevisionBackup: store.restoreRevisionBackup, createId
            });
          }));
          return sendJson(response, 200, { ok: true, ...restored });
        } catch (error) {
          if (/^(ARCHIVE|MEDIA_ARCHIVE|MEDIA_RESTORE)_/.test(String(error?.code || ""))) throw httpError(400, String(error.code).startsWith("ARCHIVE_") ? "备份文件损坏、未完整传输或格式不受支持。" : error.message);
          throw error;
        } finally {
          fs.rmSync(stagingRoot, { recursive: true, force: true });
          try { fs.rmdirSync(restoreParent); } catch { /* another restore may still use it */ }
        }
      });
    }

    if (request.method === "GET" && url.pathname === "/api/options") {
      return sendJson(response, 200, {
        schemaVersion: SCHEMA_VERSION,
        halls,
        emotions,
        sourceTypes,
        importanceLabels,
        limits: { rawContent: MAX_RAW_LENGTH, body: MAX_BODY_LENGTH, importBody: MAX_IMPORT_BODY_LENGTH },
        mediaPolicy: mediaStorage.policy,
        voicePolicy: voiceApi.policy
      });
    }

    if (request.method === "GET" && url.pathname === "/api/memories") {
      return sendJson(response, 200, { schemaVersion: SCHEMA_VERSION, memories: store.listMemories().map(withMemoryMedia) });
    }

    if (request.method === "GET" && url.pathname === "/api/memories/export") {
      const mode = url.searchParams.get("mode") === "redacted" ? "redacted" : "full";
      return sendJson(response, 200, buildCollectionExport(store.listMemories().map(withMemoryMedia), mode));
    }

    if (request.method === "POST" && url.pathname === "/api/memories/import") {
      const body = await readJsonBody(request, MAX_IMPORT_BODY_LENGTH);
      return sendJson(response, 200, importCollection(body));
    }

    if (request.method === "DELETE" && url.pathname === "/api/memories/purge") {
      const body = await readJsonBody(request).catch(() => ({}));
      if (body.confirm !== "DELETE") throw httpError(400, "confirm 必须是 DELETE。");
      let result;
      try {
        result = await mediaApi.purgeAll(() => voiceApi.purgeAll(() => store.purgeAll()));
      } catch (error) {
        if (error.rollbackError) console.error("清空馆藏失败且媒体隔离回滚不完整：", error.rollbackError);
        throw error;
      }
      return sendJson(response, 200, {
        ok: true,
        purge: result.purge.purge,
        mediaCleanupPending: result.cleanup.pending.length > 0 || result.purge.cleanup.pending.length > 0,
        mediaFilesRemoved: result.cleanup.removed.length,
        voiceFilesRemoved: result.purge.cleanup.removed.length
      });
    }

    if (request.method === "POST" && url.pathname === "/api/analyze") {
      demoCapacity.assert("agentRuns", store.getStats().agentRuns);
      const body = await readJsonBody(request);
      const rawContent = limitText(body.rawContent, MAX_RAW_LENGTH);
      if (!rawContent) throw httpError(400, "请先写下一段记忆。");
      const result = await analyzeMemory(rawContent);
      const savedRun = demoCapacity.write("agentRuns", () => store.getStats().agentRuns, () => (
        store.saveAgentRun(result.workflow, { rawContent, mode: result.mode })
      ));
      result.workflow.run.persisted = true;
      result.workflow.run.eventCount = savedRun.eventCount;
      result.draft.agentRunId = savedRun.id;
      return sendJson(response, 200, result);
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

    if (request.method === "GET" && url.pathname === "/api/archaeology/overview") {
      return sendJson(response, 200, {
        mode: "evidence-rules",
        overview: store.getArchaeologyOverview(),
        events: store.listMemoryEvents().map(summarizeMemoryEvent)
      });
    }

    if (request.method === "GET" && url.pathname === "/api/archaeology/routes") {
      const focusId = sanitizeId(url.searchParams.get("focus") || "");
      const memories = store.listMemories();
      const route = focusId
        ? buildConnections(memories, { focusId, limit: clampInteger(url.searchParams.get("limit"), 1, 6, 4) })
        : buildFeaturedRoute(memories);
      return sendJson(response, 200, {
        mode: "evidence-rules",
        kind: focusId ? "focus" : "featured",
        route,
        overview: store.getArchaeologyOverview()
      });
    }

    if (request.method === "GET" && url.pathname === "/api/archaeology/puzzle") {
      const memoryId = sanitizeId(url.searchParams.get("memoryId"));
      const relatedId = sanitizeId(url.searchParams.get("relatedId"));
      if (!memoryId || !relatedId || memoryId === relatedId) throw httpError(400, "请选择两件不同的展品进行拼图。");
      const left = store.getMemory(memoryId);
      const right = store.getMemory(relatedId);
      if (!left || !right) throw httpError(404, "没有找到用于拼图的展品。");
      const puzzle = buildPuzzle(left, right);
      const event = sharedMemoryEvent(memoryId, relatedId);
      const savedQuestions = event
        ? dedupeById([...store.listCuratorQuestions({ eventId: event.id }), ...store.listCuratorQuestions({ memoryId })])
        : store.listCuratorQuestions({ memoryId });
      return sendJson(response, 200, {
        mode: "evidence-rules",
        puzzle,
        imageEvidence: {
          left: listImageEvidenceForMemory(store, mediaApi, memoryId),
          right: listImageEvidenceForMemory(store, mediaApi, relatedId)
        },
        imageCompare: {
          left: mediaApi.publicMediaList(memoryId),
          right: mediaApi.publicMediaList(relatedId)
        },
        question: buildCuratorQuestion(puzzle),
        decision: store.getPairDecision(memoryId, relatedId),
        event: event ? summarizeMemoryEvent(event) : null,
        savedQuestions
      });
    }

    if (request.method === "POST" && url.pathname === "/api/archaeology/events") {
      demoCapacity.assert("memoryEvents", store.listMemoryEvents().length);
      const body = await readJsonBody(request);
      const memoryIds = normalizeList(body.memoryIds, 2, 120).map(sanitizeId).filter(Boolean);
      if (memoryIds.length !== 2 || memoryIds[0] === memoryIds[1]) throw httpError(400, "确认同一往事需要两件不同的展品。");
      const left = store.getMemory(memoryIds[0]);
      const right = store.getMemory(memoryIds[1]);
      if (!left || !right) throw httpError(404, "没有找到需要关联的展品。");
      const puzzle = buildPuzzle(left, right);
      const connection = buildConnections([left, right], { focusId: left.id, limit: 1 }).connections[0] || null;
      const leftEvent = store.getMemoryEventForMemory(left.id);
      const rightEvent = store.getMemoryEventForMemory(right.id);
      if (leftEvent && rightEvent && leftEvent.id !== rightEvent.id) {
        throw httpError(409, "这两件展品已分别属于不同的时光拼图，请先核对现有分组。");
      }
      const existing = leftEvent || rightEvent;
      const confirmation = demoCapacity.write("memoryEvents", () => store.listMemoryEvents().length, () => store.saveArchaeologyConfirmation({
        event: {
          eventId: existing?.id || sanitizeId(body.eventId),
          memoryIds,
          title: limitText(body.title, 100) || `《${left.title}》的时光拼图`,
          summary: `${puzzle.summary.stable} 条稳定线索，${puzzle.summary.differs} 处描述差异，${puzzle.summary.additions} 条后来补充。`,
          confirmedBy: "user"
        },
        pairDecision: {
          memoryAId: left.id,
          memoryBId: right.id,
          decision: "same_event",
          rationale: "用户确认这两段记录属于同一往事。",
          evidence: connection?.reasons || [],
          metadata: { score: connection?.score || 0 }
        },
        claimsByMemory: buildPuzzleClaims(puzzle, [left.id, right.id])
      }));
      return sendJson(response, 201, {
        ok: true,
        event: summarizeMemoryEvent(confirmation.event),
        overview: store.getArchaeologyOverview()
      });
    }

    if (request.method === "POST" && url.pathname === "/api/archaeology/questions") {
      demoCapacity.assert("curatorQuestions", store.listCuratorQuestions().length);
      const body = await readJsonBody(request);
      const memoryId = sanitizeId(body.memoryId);
      const relatedId = sanitizeId(body.relatedId);
      const left = store.getMemory(memoryId);
      const right = store.getMemory(relatedId);
      if (!left || !right || left.id === right.id) throw httpError(400, "补充问题需要两件不同的展品。");
      const puzzle = buildPuzzle(left, right);
      const generated = buildCuratorQuestion(puzzle);
      if (!generated.available) throw httpError(409, "当前拼图没有需要补充的问题。");
      const action = ["answer", "keep_unknown", "skip"].includes(body.action) ? body.action : "answer";
      const answer = limitText(body.answer, 400);
      if (action === "answer" && !answer) throw httpError(400, "请写下补充内容，或选择保留不确定。");
      const event = sharedMemoryEvent(left.id, right.id);
      const saved = demoCapacity.write("curatorQuestions", () => store.listCuratorQuestions().length, () => store.saveCuratorQuestion({
        id: createId("question"),
        memoryId: left.id,
        eventId: event?.id || "",
        question: generated.question,
        reason: generated.why,
        status: action === "answer" ? "answered" : action === "keep_unknown" ? "unknown" : "skipped",
        answer: action === "answer" ? answer : "",
        priority: questionPriority(generated.basedOn?.field),
        evidence: generated.basedOn ? [generated.basedOn] : [],
        metadata: { relatedMemoryId: right.id, action, targetField: generated.basedOn?.field || "" }
      }));
      return sendJson(response, 201, { ok: true, question: saved });
    }

    const archaeologyEventMatch = url.pathname.match(/^\/api\/archaeology\/events\/([a-zA-Z0-9_-]{1,120})$/);
    if (request.method === "DELETE" && archaeologyEventMatch) {
      const removed = store.deleteMemoryEvent(archaeologyEventMatch[1]);
      if (!removed) throw httpError(404, "没有找到这组时光拼图。");
      return sendJson(response, 200, { ok: true, removed, overview: store.getArchaeologyOverview() });
    }

    if (request.method === "GET" && url.pathname === "/api/privacy") {
      return sendJson(response, 200, buildPrivacySummary());
    }

    if (request.method === "POST" && url.pathname === "/api/memories") {
      demoCapacity.assert("memories", store.getStats().memories);
      const body = await readJsonBody(request);
      const memory = normalizeMemory(body);
      if (memory.agentRunId && !store.getAgentRun(memory.agentRunId)) memory.agentRunId = "";
      const saved = demoCapacity.write("memories", () => store.getStats().memories, () => {
        const item = store.saveMemory(memory, { requireNew: true });
        if (item.agentRunId) store.attachAgentRunToMemory(item.agentRunId, item.id);
        return item;
      });
      const created = withMemoryMedia(store.getMemory(saved.id));
      return sendMemoryJson(response, 201, { schemaVersion: SCHEMA_VERSION, memory: created }, created);
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

      if (request.method === "GET") {
        const memory = withMemoryMedia(existing);
        return sendMemoryJson(response, 200, { memory }, memory);
      }

      if (request.method === "PUT") {
        const body = await readJsonBody(request);
        const expectedUpdatedAt = requireMemoryPrecondition(request, body, existing, httpError);
        const memory = normalizeMemory({ ...existing, ...body, id, createdAt: existing.createdAt, updatedAt: new Date().toISOString() });
        if (memory.agentRunId && !store.getAgentRun(memory.agentRunId)) memory.agentRunId = "";
        const saved = store.saveMemory(memory, {
          requireExisting: true,
          expectedUpdatedAt,
          changeNote: limitText(body.changeNote, 500)
        });
        if (saved.agentRunId) store.attachAgentRunToMemory(saved.agentRunId, saved.id);
        const updated = withMemoryMedia(store.getMemory(saved.id));
        return sendMemoryJson(response, 200, { memory: updated }, updated);
      }

      if (request.method === "DELETE") {
        const deleted = store.deleteMemory(id);
        let mediaCleanupPending = false;
        let voiceCleanupPending = false;
        if (deleted) {
          try { await mediaApi.garbageCollect({ status: "ready", limit: 500 }); } catch { mediaCleanupPending = true; }
          try { await voiceApi.garbageCollect({ status: "ready", limit: 500 }); } catch { voiceCleanupPending = true; }
        }
        return sendJson(response, 200, { ok: deleted, id, mediaCleanupPending, voiceCleanupPending });
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

  if (AI_ENABLED) {
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

  if (AI_ENABLED && matches.length) {
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

function sharedMemoryEvent(leftId, rightId) {
  const event = store.getMemoryEventForMemory(leftId);
  if (!event) return null;
  return event.members?.some((member) => member.memoryId === rightId) ? event : null;
}

function summarizeMemoryEvent(event) {
  if (!event) return null;
  return {
    id: event.id,
    title: event.title,
    summary: event.summary,
    status: event.status,
    versionCount: event.versionCount || event.members?.length || 0,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
    members: (event.members || []).map((member) => ({
      memoryId: member.memoryId,
      title: member.title,
      date: member.date,
      sourceType: member.sourceType,
      relation: member.relation,
      confirmedAt: member.confirmedAt
    }))
  };
}

function withMemoryMedia(memory) {
  if (!memory) return memory;
  const storedMemory = memory.id ? store.getMemory(memory.id) : null;
  const resolvedMemory = storedMemory ? { ...storedMemory, ...memory } : memory;
  const media = mediaApi.publicMediaList(resolvedMemory.id);
  const cover = media.find((item) => item.role === "cover") || media[0] || null;
  const entityRefs = typeof store.getMemoryEntityRefs === "function"
    ? store.getMemoryEntityRefs(resolvedMemory.id)
    : Array.isArray(resolvedMemory.entityRefs) ? resolvedMemory.entityRefs : [];
  const voices = typeof store.listVoiceForMemory === "function"
    ? store.listVoiceForMemory(resolvedMemory.id).map((item, index) => ({
        assetId: item.assetId,
        position: Number.isSafeInteger(item.position) ? item.position : index,
        label: item.label || "",
        asset: publicVoiceAsset(item.asset || { id: item.assetId }),
        transcript: item.transcript ? publicVoiceTranscript(item.transcript) : null
      }))
    : [];
  return {
    ...resolvedMemory,
    entityRefs,
    voices,
    voiceSummary: {
      count: voices.length,
      confirmedTranscriptCount: voices.filter((item) => item.transcript?.confirmed === true).length
    },
    media,
    mediaSummary: {
      count: media.length,
      coverAssetId: cover?.assetId || "",
      coverThumbnailUrl: cover?.urls?.thumb || ""
    }
  };
}

function buildPuzzleClaims(puzzle, memoryIds) {
  const groups = ["stable", "differs", "additions", "unknowns"];
  return Object.fromEntries(memoryIds.map((memoryId) => {
    const existing = store.getMemoryClaims(memoryId).map((claim) => ({
      id: claim.id,
      claimKey: claim.claimKey,
      type: claim.type,
      value: claim.value,
      quote: claim.quote,
      startOffset: claim.startOffset,
      endOffset: claim.endOffset,
      confidence: claim.confidence,
      status: claim.status,
      metadata: claim.payload || {}
    }));
    const additions = groups.flatMap((group) => (puzzle[group] || []).flatMap((item) => (
      (item.sources || [])
        .filter((source) => source.memoryId === memoryId && source.valid)
        .map((source) => ({
          claimKey: item.field,
          type: group,
          value: source.value || item.statement,
          quote: source.sourceQuote,
          startOffset: source.start,
          endOffset: source.end,
          confidence: 1,
          status: "source_verified",
          metadata: { itemId: item.id, statement: item.statement }
        }))
    )));
    const seen = new Set();
    const claims = [...existing, ...additions].filter((claim) => {
      const key = `${claim.claimKey}|${claim.value}|${claim.startOffset}|${claim.endOffset}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return [memoryId, claims];
  }));
}

function questionPriority(field) {
  return ({ date: 100, location: 90, people: 80, emotions: 60, tags: 40 })[field] || 20;
}

function dedupeById(items) {
  const seen = new Set();
  return items.filter((item) => item?.id && !seen.has(item.id) && seen.add(item.id));
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

function isInterviewDemoBlockedMutation(request, url) {
  if (!INTERVIEW_DEMO) return false;
  if (request.method === "DELETE" || url.pathname === "/api/memories/purge" || url.pathname === "/api/memories/import" || url.pathname === "/api/archive/restore") return true;
  if (request.method === "POST" && /^\/api\/memories\/[a-zA-Z0-9_-]+\/revisions\/[a-zA-Z0-9_-]+\/restore$/.test(url.pathname)) return true;
  if (request.method === "PUT" && /^\/api\/revisits\/[a-zA-Z0-9_-]+\/intent$/.test(url.pathname)) return true;
  if ((request.method === "POST" || request.method === "DELETE") && url.pathname.startsWith("/api/collection-health/")) return true;
  if (request.method === "POST" && url.pathname === "/api/archive/inspect") return true;
  return request.method === "PUT" && /^\/api\/memories\/[a-zA-Z0-9_-]+$/.test(url.pathname);
}

function isArchiveBinaryRequest(request, url) {
  return request.method === "POST" && ["/api/archive/restore", "/api/archive/inspect"].includes(url.pathname);
}

function assertArchiveContentType(request) {
  const contentType = String(request.headers["content-type"] || "").split(";", 1)[0].trim().toLowerCase();
  if (!["application/vnd.time-isle", "application/gzip", "application/x-gzip", "application/octet-stream"].includes(contentType)) {
    throw httpError(415, "完整备份恢复只接受 .time-isle 归档文件。");
  }
}

async function readJsonBody(request, maximumBytes = MAX_BODY_LENGTH) {
  const limit = Number.isSafeInteger(maximumBytes) && maximumBytes > 0 ? maximumBytes : MAX_BODY_LENGTH;
  let total = 0;
  const chunks = [];
  for await (const chunk of request) {
    total += chunk.length;
    if (total > limit) throw httpError(413, "请求内容过大。");
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
  const fileName = path.basename(filePath).toLowerCase(); const noCache = ["index.html", "sw.js", "manifest.webmanifest"].includes(fileName);
  response.setHeader("Cache-Control", noCache ? "no-cache, no-store, must-revalidate" : "public, max-age=300"); if (fileName === "sw.js") response.setHeader("Service-Worker-Allowed", "/");
  fs.createReadStream(filePath).pipe(response);
}

function getContentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json; charset=utf-8",
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
  response.setHeader("Permissions-Policy", `camera=(), microphone=${INTERVIEW_DEMO ? "()" : "(self)"}, geolocation=()`);
  response.setHeader("Content-Security-Policy", "default-src 'self'; connect-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self'; script-src 'self'; worker-src 'self'; manifest-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
}

function sendJson(response, statusCode, payload) {
  if (response.headersSent) return;
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(payload));
}

function sendMemoryJson(response, statusCode, payload, memory) { response.setHeader("ETag", memoryEtag(memory)); return sendJson(response, statusCode, payload); }

function sendError(response, error) {
  const statusCode = Number(error.statusCode) || 500;
  if (statusCode >= 500) console.error(error);
  const payload = { error: statusCode >= 500 ? "服务器暂时无法完成请求。" : error.message };
  if (error.interviewDemo === true) payload.interviewDemo = true;
  if (/^[A-Z0-9_]{3,80}$/.test(String(error.code || ""))) payload.code = error.code;
  if (statusCode === 412 && error.currentUpdatedAt) {
    payload.updatedAt = error.currentUpdatedAt;
    response.setHeader("ETag", memoryEtag({ updatedAt: error.currentUpdatedAt }));
  }
  return sendJson(response, statusCode, payload);
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
    console.log(AI_ENABLED ? "AI 模式：已配置模型" : "AI 模式：本地 Mock 回退");
  });
  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") console.error(`端口 ${PORT} 已被占用，请设置其他 PORT。`);
    else console.error(error);
    process.exit(1);
  });
  const maintenanceTimer = setInterval(() => runMediaMaintenance(60 * 1000).catch((error) => console.error("媒体维护失败：", error.message)), 5 * 60 * 1000);
  maintenanceTimer.unref();
  const shutdown = () => {
    try {
      clearInterval(maintenanceTimer);
      store.close();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
