"use strict";

const { createHash } = require("node:crypto");

const SEMANTIC_RECALL_FORMAT = "time-isle-semantic-recall-snapshot-v1";
const MEMORY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/u;
const SEMANTIC_RECALL_LIMITS = Object.freeze({
  memories: 500,
  titleChars: 60,
  exhibitTextChars: 120,
  rawContentChars: 120,
  tags: 8,
  tagChars: 20,
  tagTotalChars: 50,
  confirmedTranscripts: 3,
  transcriptChars: 70,
  transcriptTotalChars: 70,
  documentUtf8Bytes: 1_048_576
});
const SEMANTIC_RECALL_MODEL = Object.freeze({
  id: "Xenova/bge-small-zh-v1.5",
  baseModel: "BAAI/bge-small-zh-v1.5",
  runtime: "Transformers.js 3.8.1 + ONNX Runtime Web WASM",
  dtype: "q8",
  dimensions: 512,
  downloadBytes: 46_979_724,
  localModelPath: "/assets/models/v17/",
  remoteModelsAllowed: false
});

/**
 * Build the only server payload that may enter the device-side embedding
 * worker. It deliberately excludes media, people, locations, entities,
 * provenance, internal voice IDs and every unconfirmed transcript.
 */
function buildSemanticRecallSnapshot(input = {}) {
  const memories = input.memories;
  const listVoiceForMemory = input.listVoiceForMemory;
  if (!Array.isArray(memories) || typeof listVoiceForMemory !== "function") {
    throw new TypeError("Semantic recall requires saved memories and a voice reader.");
  }
  if (memories.length > SEMANTIC_RECALL_LIMITS.memories) {
    throw semanticRecallError(
      `设备内语义回忆首版最多准备 ${SEMANTIC_RECALL_LIMITS.memories} 件展品。`,
      "SEMANTIC_RECALL_CAPACITY_EXCEEDED",
      409
    );
  }

  const seenIds = new Set();
  const documents = memories.map((memory) => {
    const memoryId = normalizeMemoryId(memory?.id);
    if (seenIds.has(memoryId)) {
      throw semanticRecallError("馆藏里存在重复展品标识，无法建立可靠索引。", "SEMANTIC_RECALL_SOURCE_INVALID", 500);
    }
    seenIds.add(memoryId);
    const voices = synchronous(listVoiceForMemory(memoryId), "listVoiceForMemory");
    if (!Array.isArray(voices)) {
      throw new TypeError("listVoiceForMemory must return an array.");
    }
    return Object.freeze({
      memoryId,
      title: sampleText(memory.title, SEMANTIC_RECALL_LIMITS.titleChars),
      exhibitText: sampleText(memory.exhibitText, SEMANTIC_RECALL_LIMITS.exhibitTextChars),
      rawContent: sampleText(memory.rawContent, SEMANTIC_RECALL_LIMITS.rawContentChars),
      tags: Object.freeze(normalizeTags(memory.tags)),
      confirmedTranscripts: Object.freeze(readConfirmedTranscripts(voices))
    });
  }).sort((left, right) => left.memoryId.localeCompare(right.memoryId, "en"));

  const canonicalDocuments = canonicalJson(documents);
  const documentUtf8Bytes = Buffer.byteLength(canonicalDocuments, "utf8");
  if (documentUtf8Bytes > SEMANTIC_RECALL_LIMITS.documentUtf8Bytes) {
    throw semanticRecallError(
      "设备内语义回忆快照超过本机内存预算。",
      "SEMANTIC_RECALL_SNAPSHOT_BUDGET_EXCEEDED",
      409
    );
  }
  const collectionFingerprint = createHash("sha256")
    .update(canonicalDocuments)
    .digest("hex");
  return Object.freeze({
    format: SEMANTIC_RECALL_FORMAT,
    collectionFingerprint,
    documentCount: documents.length,
    documentUtf8Bytes,
    documents: Object.freeze(documents),
    model: SEMANTIC_RECALL_MODEL,
    limits: SEMANTIC_RECALL_LIMITS,
    boundary: Object.freeze({
      execution: "browser-worker-memory-only",
      persisted: false,
      externalRequests: false,
      indexedFields: Object.freeze(["title", "exhibitText", "rawContent", "tags", "confirmedTranscripts"]),
      excluded: Object.freeze(["media", "unconfirmedTranscripts", "people", "locations", "entities", "provenance"])
    })
  });
}

function readConfirmedTranscripts(voices) {
  const texts = [];
  for (const voice of voices) {
    const transcript = voice?.transcript;
    const confirmed = transcript?.confirmed === true || transcript?.status === "confirmed";
    if (!confirmed) continue;
    texts.push(transcript.text);
    if (texts.length >= SEMANTIC_RECALL_LIMITS.confirmedTranscripts) break;
  }
  return fitTextList(texts, {
    maximumItems: SEMANTIC_RECALL_LIMITS.confirmedTranscripts,
    maximumItemChars: SEMANTIC_RECALL_LIMITS.transcriptChars,
    maximumTotalChars: SEMANTIC_RECALL_LIMITS.transcriptTotalChars,
    sampler: sampleText
  });
}

function normalizeTags(value) {
  if (!Array.isArray(value)) return [];
  return fitTextList(value, {
    maximumItems: SEMANTIC_RECALL_LIMITS.tags,
    maximumItemChars: SEMANTIC_RECALL_LIMITS.tagChars,
    maximumTotalChars: SEMANTIC_RECALL_LIMITS.tagTotalChars,
    sampler: clipText
  });
}

function normalizeMemoryId(value) {
  const memoryId = String(value || "");
  if (!MEMORY_ID_PATTERN.test(memoryId)) {
    throw semanticRecallError("展品标识不符合设备内索引契约。", "SEMANTIC_RECALL_SOURCE_INVALID", 500);
  }
  return memoryId;
}

function normalizeText(value) {
  return String(value || "").normalize("NFKC").replace(/\r\n?/gu, "\n").trim();
}

function sampleText(value, maximum) {
  const characters = [...normalizeText(value)];
  if (characters.length <= maximum) return characters.join("");
  const leading = Math.max(1, Math.floor((maximum - 1) / 2));
  const trailing = Math.max(1, maximum - 1 - leading);
  return `${characters.slice(0, leading).join("")}…${characters.slice(-trailing).join("")}`;
}

function clipText(value, maximum) {
  const characters = [...normalizeText(value)];
  return characters.length <= maximum ? characters.join("") : `${characters.slice(0, maximum - 1).join("")}…`;
}

function fitTextList(values, options) {
  const seen = new Set();
  const source = [];
  for (const value of values) {
    const normalized = normalizeText(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    source.push(normalized);
    if (source.length >= options.maximumItems) break;
  }
  let remaining = options.maximumTotalChars;
  return source.map((value, index) => {
    const remainingSlots = source.length - index;
    const allowance = Math.min(options.maximumItemChars, Math.max(1, Math.floor(remaining / remainingSlots)));
    const projected = options.sampler(value, allowance);
    remaining -= [...projected].length;
    return projected;
  }).filter(Boolean);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function synchronous(value, name) {
  if (value && typeof value.then === "function") throw new TypeError(`${name} must be synchronous.`);
  return value;
}

function semanticRecallError(message, code, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

module.exports = {
  SEMANTIC_RECALL_FORMAT,
  SEMANTIC_RECALL_LIMITS,
  SEMANTIC_RECALL_MODEL,
  buildSemanticRecallSnapshot,
  canonicalJson,
  readConfirmedTranscripts,
  sampleText,
  semanticRecallError
};
