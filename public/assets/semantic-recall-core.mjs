export const SEMANTIC_RECALL_SNAPSHOT_FORMAT = "time-isle-semantic-recall-snapshot-v1";
export const SEMANTIC_RECALL_MODEL_ID = "Xenova/bge-small-zh-v1.5";
export const SEMANTIC_RECALL_DIMENSIONS = 512;
export const SEMANTIC_RECALL_MAX_DOCUMENTS = 500;
export const SEMANTIC_RECALL_MAX_QUERY_CHARS = 160;
export const SEMANTIC_RECALL_QUERY_PREFIX = "为这个句子生成表示以用于检索相关文章：";
export const SEMANTIC_RECALL_TEXT_LIMITS = Object.freeze({
  titleChars: 60,
  exhibitTextChars: 120,
  rawContentChars: 120,
  tags: 8,
  tagChars: 20,
  tagTotalChars: 50,
  confirmedTranscripts: 3,
  transcriptChars: 70,
  transcriptTotalChars: 70
});

const MEMORY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const DOCUMENT_KEYS = Object.freeze([
  "confirmedTranscripts", "exhibitText", "memoryId", "rawContent", "tags", "title"
]);

export function normalizeSemanticSnapshot(value) {
  if (!isRecord(value) || value.format !== SEMANTIC_RECALL_SNAPSHOT_FORMAT ||
      !SHA256_PATTERN.test(String(value.collectionFingerprint || "")) ||
      !Array.isArray(value.documents) || !Number.isSafeInteger(value.documentCount) ||
      value.documentCount !== value.documents.length || value.documents.length > SEMANTIC_RECALL_MAX_DOCUMENTS ||
      !Number.isSafeInteger(value.documentUtf8Bytes) || value.documentUtf8Bytes < 2 || value.documentUtf8Bytes > 1_048_576 ||
      new TextEncoder().encode(JSON.stringify(value.documents)).byteLength !== value.documentUtf8Bytes) {
    throw recallError("设备索引快照格式无效。", "SEMANTIC_RECALL_SNAPSHOT_INVALID");
  }
  if (!isRecord(value.model) || value.model.id !== SEMANTIC_RECALL_MODEL_ID ||
      value.model.remoteModelsAllowed !== false || value.model.dimensions !== SEMANTIC_RECALL_DIMENSIONS ||
      value.model.dtype !== "q8" || value.model.localModelPath !== "/assets/models/v17/") {
    throw recallError("设备模型边界与当前版本不一致。", "SEMANTIC_RECALL_MODEL_CONTRACT_INVALID");
  }
  if (!isRecord(value.boundary) || value.boundary.execution !== "browser-worker-memory-only" ||
      value.boundary.persisted !== false || value.boundary.externalRequests !== false) {
    throw recallError("设备语义隐私边界无效。", "SEMANTIC_RECALL_BOUNDARY_INVALID");
  }

  const seen = new Set();
  const documents = value.documents.map((document) => {
    if (!isRecord(document) || JSON.stringify(Object.keys(document).sort()) !== JSON.stringify(DOCUMENT_KEYS) ||
        !MEMORY_ID_PATTERN.test(String(document.memoryId || "")) || seen.has(document.memoryId) ||
        typeof document.title !== "string" || typeof document.exhibitText !== "string" ||
        typeof document.rawContent !== "string" || !Array.isArray(document.tags) ||
        !Array.isArray(document.confirmedTranscripts) ||
        document.tags.some((item) => typeof item !== "string") ||
        document.confirmedTranscripts.some((item) => typeof item !== "string") ||
        !withinDocumentTextLimits(document)) {
      throw recallError("设备索引中存在不安全的展品投影。", "SEMANTIC_RECALL_DOCUMENT_INVALID");
    }
    seen.add(document.memoryId);
    return Object.freeze({
      memoryId: document.memoryId,
      title: document.title,
      exhibitText: document.exhibitText,
      rawContent: document.rawContent,
      tags: Object.freeze([...document.tags]),
      confirmedTranscripts: Object.freeze([...document.confirmedTranscripts])
    });
  });
  return Object.freeze({
    format: value.format,
    collectionFingerprint: value.collectionFingerprint,
    documentCount: documents.length,
    documentUtf8Bytes: value.documentUtf8Bytes,
    documents: Object.freeze(documents),
    model: Object.freeze({ ...value.model }),
    boundary: Object.freeze({ ...value.boundary })
  });
}

export function normalizeSemanticQuery(value) {
  const query = String(value || "").normalize("NFKC").replace(/\s+/gu, " ").trim();
  const length = [...query].length;
  if (length < 2 || length > SEMANTIC_RECALL_MAX_QUERY_CHARS || /[\u0000-\u001F\u007F]/u.test(query)) {
    throw recallError("请用 2–160 个字符描述想找的记忆。", "SEMANTIC_RECALL_QUERY_INVALID");
  }
  return query;
}

export function buildSemanticDocumentText(document) {
  const title = document.title;
  const tags = document.tags.join("、");
  const exhibit = document.exhibitText;
  const raw = document.rawContent;
  const transcripts = document.confirmedTranscripts.join("。");
  return [
    title && `标题：${title}`,
    tags && `标签：${tags}`,
    exhibit && `展品说明：${exhibit}`,
    raw && `正文片段：${raw}`,
    transcripts && `已确认文字稿：${transcripts}`
  ].filter(Boolean).join("\n") || "尚未填写文字的展品";
}

export function buildSemanticQueryText(query) {
  return `${SEMANTIC_RECALL_QUERY_PREFIX}${normalizeSemanticQuery(query)}`;
}

export function rankSemanticResults(queryVector, indexed, limit = 6) {
  if (!isVector(queryVector) || !Array.isArray(indexed)) {
    throw recallError("设备语义结果格式无效。", "SEMANTIC_RECALL_RESULT_INVALID");
  }
  const maximum = Math.min(10, Math.max(1, Number(limit) || 6));
  return indexed.map((item) => {
    if (!isRecord(item) || !isVector(item.vector) || item.vector.length !== queryVector.length ||
        !isRecord(item.document)) {
      throw recallError("设备语义索引格式无效。", "SEMANTIC_RECALL_RESULT_INVALID");
    }
    return { item, score: dot(queryVector, item.vector) };
  }).sort((left, right) => right.score - left.score ||
    String(left.item.document.memoryId).localeCompare(String(right.item.document.memoryId), "en"))
    .slice(0, maximum)
    .map(({ item, score }, index) => Object.freeze({
      rank: index + 1,
      memoryId: item.document.memoryId,
      title: item.document.title || "未命名展品",
      excerpt: clip(item.document.exhibitText || item.document.rawContent || "暂无文字说明", 140),
      tags: Object.freeze(item.document.tags.slice(0, 4)),
      similarity: Number(score.toFixed(6))
    }));
}

export function tensorRows(output, expectedRows) {
  const rows = output?.tolist?.();
  if (!Array.isArray(rows) || rows.length !== expectedRows ||
      rows.some((row) => !Array.isArray(row) || row.length !== SEMANTIC_RECALL_DIMENSIONS ||
        row.some((value) => !Number.isFinite(value)))) {
    throw recallError("设备模型没有返回预期的 512 维向量。", "SEMANTIC_RECALL_MODEL_OUTPUT_INVALID");
  }
  return rows.map((row) => Float32Array.from(row));
}

function dot(left, right) {
  let value = 0;
  for (let index = 0; index < left.length; index += 1) value += left[index] * right[index];
  return value;
}

function clip(value, maximum) {
  const characters = [...String(value || "").replace(/\s+/gu, " ").trim()];
  return characters.length <= maximum ? characters.join("") : `${characters.slice(0, maximum - 1).join("")}…`;
}

function isVector(value) {
  return (Array.isArray(value) || value instanceof Float32Array) && value.length === SEMANTIC_RECALL_DIMENSIONS &&
    Array.from(value).every(Number.isFinite);
}

function withinDocumentTextLimits(document) {
  const limits = SEMANTIC_RECALL_TEXT_LIMITS;
  return length(document.title) <= limits.titleChars &&
    length(document.exhibitText) <= limits.exhibitTextChars &&
    length(document.rawContent) <= limits.rawContentChars &&
    document.tags.length <= limits.tags && document.tags.every((item) => length(item) <= limits.tagChars) &&
    length(document.tags.join("")) <= limits.tagTotalChars &&
    document.confirmedTranscripts.length <= limits.confirmedTranscripts &&
    document.confirmedTranscripts.every((item) => length(item) <= limits.transcriptChars) &&
    length(document.confirmedTranscripts.join("")) <= limits.transcriptTotalChars;
}

function length(value) { return [...String(value || "")].length; }

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function recallError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}
