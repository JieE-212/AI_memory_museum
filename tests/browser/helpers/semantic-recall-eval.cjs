"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createMemoryStore } = require("../../../database");

const SNAPSHOT_FORMAT = "time-isle-semantic-recall-snapshot-v1";
const MODEL_ID = "Xenova/bge-small-zh-v1.5";
const DISTRACTOR_VARIANTS = Object.freeze([
  "这是一条完全虚构的日常清点记录，只描述物品和步骤。",
  "一周后的虚构复查仍只留下数量、时间与普通工作备注。",
  "归档人确认这段合成文字不涉及亲友、真实地点或用户经历。"
]);

function loadEvaluationFixture(filePath) {
  const fixture = JSON.parse(fs.readFileSync(filePath, "utf8"));
  validateFixture(fixture);
  return fixture;
}

function buildEvaluationSet(fixture) {
  validateFixture(fixture);
  const documents = [];
  const queries = [];
  for (const topic of fixture.topics) {
    const positiveId = `eval-${topic.id}-p`;
    const negativeId = `eval-${topic.id}-n`;
    documents.push(projectDocument(positiveId, topic.positive));
    documents.push(projectDocument(negativeId, topic.hardNegative));
    queries.push({
      id: `query-${topic.id}-semantic`,
      text: topic.query,
      slice: "semantic-paraphrase",
      relevantIds: [positiveId],
      forbiddenIds: [negativeId]
    });
    queries.push({
      id: `query-${topic.id}-literal`,
      text: topic.literalQuery,
      slice: "literal-control",
      relevantIds: [positiveId],
      forbiddenIds: [negativeId]
    });
  }
  fixture.distractorScenes.forEach((scene, sceneIndex) => {
    DISTRACTOR_VARIANTS.forEach((variant, variantIndex) => {
      documents.push(projectDocument(`eval-distractor-${String(sceneIndex + 1).padStart(2, "0")}-${variantIndex + 1}`, {
        title: `${scene} · ${variantIndex + 1}`,
        exhibitText: `${scene}的虚构工作记录。`,
        rawContent: `${scene}。${variant}`,
        tags: ["虚构干扰项", "日常记录"]
      }));
    });
  });
  if (documents.length !== 100) throw new Error(`语义质量集必须精确为 100 件，实际为 ${documents.length}。`);
  const nullQueries = fixture.nullQueries.map((text, index) => ({
    id: `query-null-${index + 1}`,
    text,
    slice: "out-of-collection",
    relevantIds: [],
    forbiddenIds: []
  }));
  return Object.freeze({
    documents: Object.freeze(documents),
    queries: Object.freeze(queries),
    nullQueries: Object.freeze(nullQueries)
  });
}

function buildPerformanceCorpus(qualityDocuments, count = 500) {
  if (!Array.isArray(qualityDocuments) || qualityDocuments.length !== 100 || count !== 500) {
    throw new Error("500 件质量与性能集必须从固定 100 件质量集扩展生成。");
  }
  const documents = qualityDocuments.map((item) => ({ ...item, tags: [...item.tags], confirmedTranscripts: [] }));
  const nouns = ["纸船", "窗帘", "台阶", "玻璃瓶", "树影", "车票", "纽扣", "风筝", "雨靴", "邮票"];
  const actions = ["编号", "晾晒", "搬运", "擦拭", "测量", "装盒", "复核", "登记"];
  for (let index = documents.length; index < count; index += 1) {
    const noun = nouns[index % nouns.length];
    const action = actions[Math.floor(index / nouns.length) % actions.length];
    documents.push(projectDocument(`perf-distractor-${String(index + 1).padStart(3, "0")}`, {
      title: `虚构负载记录 ${index + 1}：${noun}${action}`,
      exhibitText: `用于固定负载测试的第 ${index + 1} 条合成干扰项。`,
      rawContent: `不存在的档案员在第 ${index + 1} 个普通工作日完成${noun}${action}，只留下数量和次序。`,
      tags: ["性能夹具", noun, action]
    }));
  }
  return Object.freeze(documents);
}

function buildSnapshot(documents) {
  const normalized = documents.map((document) => ({
    confirmedTranscripts: [],
    exhibitText: document.exhibitText,
    memoryId: document.memoryId,
    rawContent: document.rawContent,
    tags: [...document.tags],
    title: document.title
  }));
  const json = JSON.stringify(normalized);
  return Object.freeze({
    format: SNAPSHOT_FORMAT,
    collectionFingerprint: sha256(json),
    documentCount: normalized.length,
    documentUtf8Bytes: Buffer.byteLength(json, "utf8"),
    documents: normalized,
    model: {
      id: MODEL_ID,
      dimensions: 512,
      dtype: "q8",
      localModelPath: "/assets/models/v17/",
      remoteModelsAllowed: false
    },
    boundary: {
      execution: "browser-worker-memory-only",
      persisted: false,
      externalRequests: false
    }
  });
}

function calculateMetrics(queries, resultMap) {
  const positives = queries.filter((query) => query.relevantIds.length > 0);
  const rows = positives.map((query) => {
    const top3 = (resultMap[query.id] || []).slice(0, 3).map((item) => item.memoryId);
    const relevant = new Set(query.relevantIds);
    const forbidden = new Set(query.forbiddenIds);
    const hits = top3.filter((id) => relevant.has(id)).length;
    const firstRank = top3.findIndex((id) => relevant.has(id));
    return {
      queryId: query.id,
      slice: query.slice,
      recall: hits / relevant.size,
      reciprocalRank: firstRank < 0 ? 0 : 1 / (firstRank + 1),
      forbiddenInTop3: top3.some((id) => forbidden.has(id)),
      forbiddenAt1: forbidden.has(top3[0]),
      top3
    };
  });
  const bySlice = Object.fromEntries([...new Set(rows.map((row) => row.slice))].map((slice) => {
    const sliceRows = rows.filter((row) => row.slice === slice);
    return [slice, aggregateRows(sliceRows)];
  }));
  return Object.freeze({ ...aggregateRows(rows), bySlice, rows });
}

function calculateNullReturnRate(nullQueries, resultMap) {
  if (!nullQueries.length) return 0;
  return nullQueries.filter((query) => (resultMap[query.id] || []).slice(0, 3).length > 0).length / nullQueries.length;
}

function runFtsBaseline(documents, queries) {
  const tempRoot = path.join(os.tmpdir(), `ai-memory-museum-semantic-fts-${process.pid}-${Date.now()}-${crypto.randomUUID()}`);
  fs.mkdirSync(tempRoot, { recursive: true });
  let store = null;
  try {
    store = createMemoryStore({
      dbPath: path.join(tempRoot, "evaluation.sqlite"),
      schemaVersion: 19,
      halls: [{ id: "daily", name: "日常展厅", description: "完全虚构评测" }]
    });
    const timestamp = "2026-01-01T00:00:00.000Z";
    for (const document of documents) {
      store.saveMemory({
        id: document.memoryId,
        schemaVersion: 19,
        title: document.title,
        hall: "daily",
        sourceType: "完全虚构评测",
        rawContent: document.rawContent,
        exhibitText: document.exhibitText,
        date: "",
        location: "",
        people: [],
        tags: [...document.tags],
        emotions: [],
        emotionIntensity: 1,
        importance: 1,
        favorite: false,
        coverImage: "",
        mediaNote: "",
        attachments: [],
        agentRunId: "",
        createdAt: timestamp,
        updatedAt: timestamp
      }, { requireNew: true });
    }
    const results = {};
    for (const query of queries) {
      results[query.id] = store.searchClues(query.text, { mode: "keyword", limit: 3 }).results.map((item) => ({ memoryId: item.memoryId }));
    }
    return calculateMetrics(queries, results);
  } finally {
    try { store?.close(); } finally { fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); }
  }
}

function percentile(values, ratio) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))];
}

function validateAgainstBaseline(metrics, performance, baseline, options = {}) {
  const failures = [];
  const ratio = 1 + baseline.maximumRegressionRatio;
  const inverseRatio = 1 - baseline.maximumRegressionRatio;
  const qualityBaseline = options.qualityBaseline || baseline.quality;
  const bySliceBaseline = options.bySliceBaseline || baseline.bySlice;
  const labelPrefix = String(options.labelPrefix || "").trim();
  const label = (value) => labelPrefix ? `${labelPrefix} ${value}` : value;
  validateQualitySet(metrics, qualityBaseline, label("overall"), failures, ratio, inverseRatio, baseline.maximumRegressionRatio);
  for (const [slice, quality] of Object.entries(bySliceBaseline || {})) {
    validateQualitySet(metrics.bySlice?.[slice], quality, label(slice), failures, ratio, inverseRatio, baseline.maximumRegressionRatio);
  }
  if (options.enforcePerformance !== true) return failures;
  for (const [key, reference] of Object.entries(baseline.performanceMs)) {
    if (performance[key] > reference * ratio) failures.push(`${key} ${performance[key]}ms > ${Math.round(reference * ratio)}ms`);
  }
  return failures;
}

function validateQualitySet(metrics, quality, label, failures, ratio, inverseRatio, regressionRatio) {
  if (!metrics || !quality) {
    failures.push(`${label} quality metrics are missing`);
    return;
  }
  const minimumRecall = quality.recallAt3 * inverseRatio;
  const minimumMrr = quality.mrrAt3 * inverseRatio;
  const maximumHardNegative = Math.min(1, quality.hardNegativeIntrusionAt3 * ratio);
  const maximumForbiddenAt1 = quality.forbiddenAt1 === 0 ? 0 : Math.min(1, quality.forbiddenAt1 * ratio);
  if (metrics.recallAt3 < minimumRecall) failures.push(`${label} Recall@3 ${metrics.recallAt3} < ${round(minimumRecall)}（基线最多回退 ${regressionRatio * 100}%）`);
  if (metrics.mrrAt3 < minimumMrr) failures.push(`${label} MRR@3 ${metrics.mrrAt3} < ${round(minimumMrr)}（基线最多回退 ${regressionRatio * 100}%）`);
  if (metrics.hardNegativeIntrusionAt3 > maximumHardNegative) failures.push(`${label} HardNegativeIntrusion@3 ${metrics.hardNegativeIntrusionAt3} > ${round(maximumHardNegative)}（基线最多恶化 ${regressionRatio * 100}%）`);
  if (metrics.forbiddenAt1 > maximumForbiddenAt1) failures.push(`${label} Forbidden@1 ${metrics.forbiddenAt1} > ${round(maximumForbiddenAt1)}（基线最多恶化 ${regressionRatio * 100}%）`);
}

function writeReport(report, targetPath) {
  if (!targetPath) return "";
  const resolved = path.resolve(targetPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return resolved;
}

function validateFixture(fixture) {
  if (!fixture || fixture.format !== "time-isle-semantic-recall-eval-v1" || fixture.syntheticDataOnly !== true) {
    throw new Error("语义评测夹具必须明确为完全虚构 v1。 ");
  }
  if (!Array.isArray(fixture.topics) || fixture.topics.length !== 20 || !Array.isArray(fixture.distractorScenes) || fixture.distractorScenes.length !== 20) {
    throw new Error("语义评测夹具必须包含 20 组人工主题和 20 个干扰场景。 ");
  }
  const ids = new Set();
  for (const topic of fixture.topics) {
    if (!/^[a-z0-9-]{3,60}$/u.test(topic.id) || ids.has(topic.id)) throw new Error("语义主题 ID 无效或重复。 ");
    ids.add(topic.id);
    if (![topic.query, topic.literalQuery].every((text) => [...String(text || "")].length >= 2)) throw new Error(`主题 ${topic.id} 查询无效。`);
    for (const document of [topic.positive, topic.hardNegative]) projectDocument("validation-id", document);
  }
}

function projectDocument(memoryId, source) {
  const document = {
    memoryId,
    title: String(source?.title || "").trim(),
    exhibitText: String(source?.exhibitText || "").trim(),
    rawContent: String(source?.rawContent || "").trim(),
    tags: Array.isArray(source?.tags) ? source.tags.map((item) => String(item).trim()).filter(Boolean) : [],
    confirmedTranscripts: []
  };
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/u.test(memoryId) || !document.title ||
      [...document.title].length > 60 || [...document.exhibitText].length > 120 || [...document.rawContent].length > 120 ||
      document.tags.length > 8 || document.tags.some((item) => [...item].length > 20) ||
      [...document.tags.join("")].length > 50) {
    throw new Error(`语义展品投影不符合生产边界：${memoryId}`);
  }
  return Object.freeze(document);
}

function aggregateRows(rows) {
  const count = rows.length || 1;
  return {
    queryCount: rows.length,
    recallAt3: round(rows.reduce((sum, row) => sum + row.recall, 0) / count),
    mrrAt3: round(rows.reduce((sum, row) => sum + row.reciprocalRank, 0) / count),
    hardNegativeIntrusionAt3: round(rows.filter((row) => row.forbiddenInTop3).length / count),
    forbiddenAt1: round(rows.filter((row) => row.forbiddenAt1).length / count)
  };
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function round(value) {
  return Number(value.toFixed(6));
}

module.exports = {
  buildEvaluationSet,
  buildPerformanceCorpus,
  buildSnapshot,
  calculateMetrics,
  calculateNullReturnRate,
  loadEvaluationFixture,
  percentile,
  runFtsBaseline,
  validateAgainstBaseline,
  writeReport
};
