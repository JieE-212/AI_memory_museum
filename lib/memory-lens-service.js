"use strict";

const { createHash } = require("node:crypto");

const MEMORY_LENS_FORMAT = "time-isle.memory-lens-preview";
const MEMORY_LENS_VERSION = 1;
const MEMORY_LENS_ENGINE = "deterministic-memory-lenses-v1";
const MIN_MEMORIES = 2;
const MAX_MEMORIES = 20;
const MAX_ENTITY_REFS = 24;
const MAX_EVIDENCE_ITEMS = 24;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/u;
const CONTROL_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u;
const SINGLE_LINE_CONTROL_PATTERN = /[\u0000-\u001F\u007F]/u;
const LENS_BOUNDARY = "镜片只重排明确保存的字段和已确认来源；不认定事实，不推断关系、日期或情绪。";
const ENTITY_TYPES = new Map([
  ["person", "person"],
  ["people", "person"],
  ["location", "location"],
  ["place", "location"],
  ["theme", "theme"],
  ["topic", "theme"],
  ["tag", "theme"]
]);
const ENTITY_TYPE_ORDER = new Map([["person", 0], ["location", 1], ["theme", 2]]);
const ENTITY_TYPE_LABELS = Object.freeze({ person: "人物线索", location: "地点线索", theme: "主题线索" });
const LENS_DEFINITIONS = Object.freeze({
  time: Object.freeze({
    code: "time",
    label: "时间镜片",
    boundary: "只读取已保存的日期字段；日期为空或格式不明确时保持原状，不从标题或正文补全。"
  }),
  cooccurrence: Object.freeze({
    code: "cooccurrence",
    label: "共同出现镜片",
    boundary: "只使用已确认实体引用；共同出现不代表朋友、亲属或任何其他关系。"
  }),
  evidence: Object.freeze({
    code: "evidence",
    label: "证据镜片",
    boundary: "只统计已保存的来源类型和已确认文字稿；数量不代表真实性或质量。"
  }),
  clue: Object.freeze({
    code: "clue",
    label: "线索镜片",
    boundary: "只做用户查询词的直接字段匹配；不扩展近义词，不调用模型，也不把匹配当成事实。"
  })
});
const CLUE_FIELDS = Object.freeze([
  Object.freeze({ field: "title", label: "标题", weight: 6, read: (memory) => memory.title }),
  Object.freeze({ field: "tags", label: "已保存标签", weight: 5, read: (memory) => memory.tags.join(" ") }),
  Object.freeze({ field: "entities", label: "已确认实体", weight: 5, read: (memory) => memory.entityRefs.map((entry) => entry.name).join(" ") }),
  Object.freeze({ field: "location", label: "已保存地点", weight: 4, read: (memory) => memory.location }),
  Object.freeze({ field: "exhibit", label: "展品说明", weight: 4, read: (memory) => memory.exhibitText }),
  Object.freeze({ field: "raw", label: "原始文字", weight: 3, read: (memory) => memory.rawContent }),
  Object.freeze({ field: "transcript", label: "已确认文字稿", weight: 3, read: (memory) => memory.confirmedTranscripts.join(" ") }),
  Object.freeze({ field: "source", label: "已保存来源类型", weight: 2, read: (memory) => memory.sourceType })
]);

/**
 * Build one read-only, deterministic projection over an explicit set of saved
 * memories. This module has no network, model, tool, persistence or callback
 * capability. Memory text is handled only as bounded data.
 */
function buildMemoryLensPreview(input = {}) {
  const request = normalizeMemoryLensRequest(input);
  const sourceRefs = request.memories.map((memory) => ({
    memoryId: memory.id,
    updatedAt: memory.updatedAt
  }));
  const sourceSnapshotSha256 = sha256(stableStringify(request.memories));
  const requestSha256 = sha256(stableStringify({
    lens: request.lens,
    query: request.query,
    sourceRefs,
    sourceSnapshotSha256
  }));
  const projection = request.lens === "time"
    ? buildTimeProjection(request.memories)
    : request.lens === "cooccurrence"
      ? buildCooccurrenceProjection(request.memories)
      : request.lens === "evidence"
        ? buildEvidenceProjection(request.memories)
        : buildClueProjection(request.memories, request.queryTerms);
  const base = {
    format: MEMORY_LENS_FORMAT,
    version: MEMORY_LENS_VERSION,
    engine: {
      id: MEMORY_LENS_ENGINE,
      kind: "deterministic-local-rules",
      externalModel: false,
      toolCalls: 0,
      persisted: false,
      boundary: LENS_BOUNDARY
    },
    lens: { ...LENS_DEFINITIONS[request.lens] },
    query: request.query,
    queryTerms: [...request.queryTerms],
    sourceCount: request.memories.length,
    sourceRefs,
    sourceSnapshotSha256,
    requestSha256,
    groups: projection.groups,
    items: projection.items
  };
  return deepFreeze({
    ...base,
    previewSha256: sha256(stableStringify(base))
  });
}

function normalizeMemoryLensRequest(input = {}) {
  assertPlainObject(input, "lens request", "MEMORY_LENS_REQUEST_INVALID");
  assertKnownKeys(input, new Set(["lens", "memories", "query"]), "lens request", "MEMORY_LENS_REQUEST_INVALID");
  const lens = String(input.lens || "").trim();
  if (!Object.hasOwn(LENS_DEFINITIONS, lens)) {
    throw lensError("The lens must be time, cooccurrence, evidence or clue.", "MEMORY_LENS_REQUEST_INVALID");
  }
  if (!Array.isArray(input.memories) || input.memories.length < MIN_MEMORIES || input.memories.length > MAX_MEMORIES ||
      !isDenseArray(input.memories)) {
    throw lensError(`Select ${MIN_MEMORIES} to ${MAX_MEMORIES} saved memories.`, "MEMORY_LENS_MEMORY_COUNT_INVALID");
  }
  const ids = new Set();
  const memories = input.memories.map((memory, index) => {
    const normalized = normalizeMemory(memory, index);
    if (ids.has(normalized.id)) {
      throw lensError("The selected memories contain a duplicate ID.", "MEMORY_LENS_MEMORY_INVALID");
    }
    ids.add(normalized.id);
    return normalized;
  }).sort((left, right) => compareText(left.id, right.id));
  const query = normalizeQuery(input.query, lens === "clue");
  const queryTerms = lens === "clue" ? splitQueryTerms(query) : [];
  return deepFreeze({ lens, memories, query, queryTerms });
}

function normalizeMemory(input, index) {
  const label = `memories[${index}]`;
  assertPlainObject(input, label, "MEMORY_LENS_MEMORY_INVALID");
  const id = requireId(input.id, `${label}.id`);
  const title = normalizeText(input.title, `${label}.title`, 1, 160, true, "MEMORY_LENS_MEMORY_INVALID");
  const createdAt = requireCanonicalTimestamp(input.createdAt, `${label}.createdAt`);
  const updatedAt = requireCanonicalTimestamp(input.updatedAt, `${label}.updatedAt`);
  const tags = normalizeTextList(input.tags, `${label}.tags`, 20, 60);
  const entityRefs = normalizeConfirmedEntityRefs(input.entityRefs, `${label}.entityRefs`);
  const confirmedQuotes = normalizeConfirmedTextList(input.confirmedQuotes, `${label}.confirmedQuotes`);
  const confirmedTranscripts = normalizeConfirmedTranscripts(input, label);
  const mediaCount = normalizeMediaCount(input, label);
  const confirmedTranscriptCount = normalizeConfirmedTranscriptCount(input, label, confirmedTranscripts.length);
  return {
    id,
    title,
    createdAt,
    updatedAt,
    date: normalizeText(input.date ?? "", `${label}.date`, 0, 40, true, "MEMORY_LENS_MEMORY_INVALID"),
    location: normalizeText(input.location ?? "", `${label}.location`, 0, 120, true, "MEMORY_LENS_MEMORY_INVALID"),
    sourceType: normalizeText(input.sourceType ?? "", `${label}.sourceType`, 0, 80, true, "MEMORY_LENS_MEMORY_INVALID"),
    tags,
    rawContent: normalizeText(input.rawContent ?? "", `${label}.rawContent`, 0, 50_000, false, "MEMORY_LENS_MEMORY_INVALID"),
    exhibitText: normalizeText(input.exhibitText ?? "", `${label}.exhibitText`, 0, 8_000, false, "MEMORY_LENS_MEMORY_INVALID"),
    entityRefs,
    confirmedQuotes,
    confirmedTranscripts,
    evidence: {
      rawText: input.rawContent === undefined || input.rawContent === null || String(input.rawContent).trim() === "" ? 0 : 1,
      quotes: confirmedQuotes.length,
      images: mediaCount,
      transcripts: confirmedTranscriptCount
    }
  };
}

function buildTimeProjection(memories) {
  const records = memories.map((memory) => ({ memory, classification: classifyExplicitDate(memory.date) }))
    .sort((left, right) => compareTimeRecords(left, right));
  const grouped = new Map();
  for (const record of records) {
    const key = record.classification.key;
    if (!grouped.has(key)) {
      grouped.set(key, {
        position: grouped.size + 1,
        key,
        label: record.classification.groupLabel,
        reason: record.classification.groupReason,
        memoryIds: []
      });
    }
    grouped.get(key).memoryIds.push(record.memory.id);
  }
  const items = records.map((record, index) => ({
    position: index + 1,
    memoryId: record.memory.id,
    title: record.memory.title,
    groupKeys: [record.classification.key],
    reason: record.classification.itemReason,
    evidence: record.classification.evidence
  }));
  return { groups: [...grouped.values()], items };
}

function classifyExplicitDate(value) {
  const date = String(value || "");
  const canonical = canonicalDatePrecision(date);
  if (canonical) {
    return {
      rank: 0,
      sortValue: date,
      key: `time:date:${date}`,
      groupLabel: `${date} · 已保存${canonical.label}`,
      groupReason: `这些展品的日期字段明确保存为“${date}”；没有补足更精确的日期。`,
      itemReason: `日期字段明确记录为“${date}”（${canonical.label}）；没有读取标题或正文推断时间。`,
      evidence: [{ field: "date", label: "已保存日期", value: date }]
    };
  }
  if (date) {
    return {
      rank: 1,
      sortValue: "",
      key: "time:recorded-text",
      groupLabel: "已记录，但格式不明确",
      groupReason: "日期字段有用户保存的文字，但镜片不把它解释成标准日期。",
      itemReason: `日期字段保存为“${date}”；保持原文，不猜测年份、月份或日期。`,
      evidence: [{ field: "date", label: "已保存日期文字", value: date }]
    };
  }
  return {
    rank: 2,
    sortValue: "",
    key: "time:unknown",
    groupLabel: "日期仍为空",
    groupReason: "日期字段为空；镜片没有从标题、正文、照片或声音补全。",
    itemReason: "日期字段为空；没有从其他内容推断时间。",
    evidence: [{ field: "date", label: "已保存日期", value: "未填写" }]
  };
}

function canonicalDatePrecision(value) {
  if (/^[1-9]\d{3}$/u.test(value)) return { label: "年份" };
  if (/^[1-9]\d{3}-(?:0[1-9]|1[0-2])$/u.test(value)) return { label: "月份" };
  if (/^[1-9]\d{3}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/u.test(value)) {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (!Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value) return { label: "日期" };
  }
  return null;
}

function compareTimeRecords(left, right) {
  return left.classification.rank - right.classification.rank ||
    compareText(left.classification.sortValue, right.classification.sortValue) ||
    compareText(left.memory.id, right.memory.id);
}

function buildCooccurrenceProjection(memories) {
  const entities = new Map();
  for (const memory of memories) {
    for (const entity of memory.entityRefs) {
      const current = entities.get(entity.id);
      if (current && (current.type !== entity.type || current.name !== entity.name)) {
        throw lensError(
          `Confirmed entity ${entity.id} has conflicting saved metadata.`,
          "MEMORY_LENS_ENTITY_CONFLICT"
        );
      }
      const record = current || { ...entity, memoryIds: new Set() };
      record.memoryIds.add(memory.id);
      entities.set(entity.id, record);
    }
  }
  const shared = [...entities.values()].filter((entity) => entity.memoryIds.size >= 2).sort(compareSharedEntities);
  const sharedByMemory = new Map(memories.map((memory) => [memory.id, []]));
  const groups = shared.map((entity, index) => {
    const key = `cooccurrence:entity:${entity.id}`;
    const memoryIds = [...entity.memoryIds].sort(compareText);
    memoryIds.forEach((memoryId) => sharedByMemory.get(memoryId).push({ key, entity }));
    return {
      position: index + 1,
      key,
      label: `共同出现 · ${ENTITY_TYPE_LABELS[entity.type]}“${entity.name}”`,
      reason: `${memoryIds.length} 件展品引用了同一个已确认${ENTITY_TYPE_LABELS[entity.type]}；这只表示共同出现，不代表任何关系。`,
      memoryIds
    };
  });
  const withoutShared = memories.map((memory) => memory.id).filter((id) => !sharedByMemory.get(id).length).sort(compareText);
  if (withoutShared.length) {
    groups.push({
      position: groups.length + 1,
      key: "cooccurrence:none",
      label: "没有共同的已确认实体",
      reason: "这些展品没有与本次范围内其他展品共享已确认实体；镜片没有使用同名文字猜测身份。",
      memoryIds: withoutShared
    });
  }
  const items = memories.map((memory) => ({ memory, shared: sharedByMemory.get(memory.id) }))
    .sort((left, right) => right.shared.length - left.shared.length || compareText(left.memory.id, right.memory.id))
    .map((entry, index) => ({
      position: index + 1,
      memoryId: entry.memory.id,
      title: entry.memory.title,
      groupKeys: entry.shared.length ? entry.shared.map((item) => item.key) : ["cooccurrence:none"],
      reason: entry.shared.length
        ? `与其他展品共同引用 ${entry.shared.length} 个已确认实体；共同出现不等于人物关系。`
        : "没有共同的已确认实体；未使用人物文字、地点文字或标签自动合并实体。",
      evidence: entry.shared.map(({ entity }) => ({
        field: "entityRefs",
        label: `已确认${ENTITY_TYPE_LABELS[entity.type]}`,
        value: entity.name
      }))
    }));
  return { groups, items };
}

function compareSharedEntities(left, right) {
  return (ENTITY_TYPE_ORDER.get(left.type) ?? 9) - (ENTITY_TYPE_ORDER.get(right.type) ?? 9) ||
    compareText(left.name, right.name) ||
    compareText(left.id, right.id);
}

function buildEvidenceProjection(memories) {
  const records = memories.map((memory) => {
    const categories = [
      ["rawText", "原始文字", memory.evidence.rawText],
      ["quotes", "已确认引用", memory.evidence.quotes],
      ["images", "已保存图片", memory.evidence.images],
      ["transcripts", "已确认文字稿", memory.evidence.transcripts]
    ].filter((entry) => entry[2] > 0);
    const diversity = categories.length;
    const total = categories.reduce((sum, entry) => sum + entry[2], 0);
    const groupKey = diversity >= 2 ? "evidence:multiple" : diversity === 1 ? "evidence:single" : "evidence:none";
    return { memory, categories, diversity, total, groupKey };
  }).sort((left, right) => evidenceGroupRank(left.groupKey) - evidenceGroupRank(right.groupKey) ||
    right.diversity - left.diversity || right.total - left.total || compareText(left.memory.id, right.memory.id));
  const groupDefinitions = [
    ["evidence:multiple", "多种已保存来源", "至少包含两种明确保存的来源类型；来源数量不代表真实性或质量。"],
    ["evidence:single", "一种已保存来源", "当前只记录了一种来源类型；镜片不会自动补充其他证据。"],
    ["evidence:none", "尚无可计数来源", "没有可计数的已保存来源；镜片不会从文字内容猜测证据。"]
  ];
  const groups = groupDefinitions.flatMap(([key, label, reason]) => {
    const memoryIds = records.filter((record) => record.groupKey === key).map((record) => record.memory.id);
    return memoryIds.length ? [{ position: 0, key, label, reason, memoryIds }] : [];
  }).map((group, index) => ({ ...group, position: index + 1 }));
  const items = records.map((record, index) => ({
    position: index + 1,
    memoryId: record.memory.id,
    title: record.memory.title,
    groupKeys: [record.groupKey],
    reason: record.categories.length
      ? `明确记录了 ${record.categories.map((entry) => `${entry[1]} ${entry[2]} 项`).join("、")}；只统计来源类型，不判断真假。`
      : "没有可计数的已保存来源；没有根据正文语气或内容推断证据。",
    evidence: record.categories.map(([field, label, count]) => ({ field, label, value: String(count) }))
  }));
  return { groups, items };
}

function evidenceGroupRank(value) {
  return ({ "evidence:multiple": 0, "evidence:single": 1, "evidence:none": 2 })[value] ?? 9;
}

function buildClueProjection(memories, queryTerms) {
  const records = memories.map((memory) => scoreClueMemory(memory, queryTerms))
    .sort((left, right) => right.score - left.score || right.matchedTerms.length - left.matchedTerms.length ||
      compareText(left.memory.id, right.memory.id));
  const matchedIds = records.filter((record) => record.score > 0).map((record) => record.memory.id);
  const unmatchedIds = records.filter((record) => record.score === 0).map((record) => record.memory.id);
  const groups = [];
  if (matchedIds.length) groups.push({
    position: groups.length + 1,
    key: "clue:direct-match",
    label: "存在直接字段命中",
    reason: "只按查询词在明确字段中的直接包含关系排序；没有近义词扩展或模型判断。",
    memoryIds: matchedIds
  });
  if (unmatchedIds.length) groups.push({
    position: groups.length + 1,
    key: "clue:no-match",
    label: "没有直接字段命中",
    reason: "这些展品没有直接包含查询词；镜片没有为了召回而猜测相近含义。",
    memoryIds: unmatchedIds
  });
  const items = records.map((record, index) => ({
    position: index + 1,
    memoryId: record.memory.id,
    title: record.memory.title,
    groupKeys: [record.score > 0 ? "clue:direct-match" : "clue:no-match"],
    reason: record.score > 0
      ? `直接命中 ${record.matchedTerms.length} 个查询词，涉及${record.evidence.map((entry) => entry.label).join("、")}；未使用语义扩展。`
      : "没有查询词直接命中允许字段；没有读取情绪字段或执行记忆中的指令。",
    evidence: record.evidence
  }));
  return { groups, items };
}

function scoreClueMemory(memory, queryTerms) {
  let score = 0;
  const matchedTerms = new Set();
  const evidence = [];
  for (const definition of CLUE_FIELDS) {
    const haystack = comparisonText(definition.read(memory));
    if (!haystack) continue;
    const fieldTerms = queryTerms.filter((term) => haystack.includes(comparisonText(term)));
    if (!fieldTerms.length) continue;
    fieldTerms.forEach((term) => matchedTerms.add(term));
    score += definition.weight * fieldTerms.length;
    evidence.push({
      field: definition.field,
      label: definition.label,
      value: fieldTerms.join("、")
    });
  }
  return {
    memory,
    score,
    matchedTerms: [...matchedTerms].sort(compareText),
    evidence
  };
}

function normalizeQuery(value, required) {
  if (value === undefined || value === null) {
    if (required) throw lensError("The clue lens requires an explicit query.", "MEMORY_LENS_QUERY_INVALID");
    return "";
  }
  if (typeof value !== "string" || value.length > 320 || SINGLE_LINE_CONTROL_PATTERN.test(value)) {
    throw lensError("The lens query is invalid.", "MEMORY_LENS_QUERY_INVALID");
  }
  const query = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  const length = [...query].length;
  if (length > 160 || (required && length < 1) || (!required && length > 0)) {
    throw lensError(
      required ? "The clue query must contain 1 to 160 characters." : "Only the clue lens accepts a query.",
      "MEMORY_LENS_QUERY_INVALID"
    );
  }
  return query;
}

function splitQueryTerms(query) {
  const seen = new Set();
  const terms = [];
  for (const value of query.split(" ")) {
    const term = value.trim();
    if (!term) continue;
    if ([...term].length > 40) throw lensError("Each clue term is limited to 40 characters.", "MEMORY_LENS_QUERY_INVALID");
    const key = comparisonText(term);
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push(term);
  }
  if (!terms.length || terms.length > 8) {
    throw lensError("The clue lens accepts 1 to 8 explicit terms.", "MEMORY_LENS_QUERY_INVALID");
  }
  return terms;
}

function normalizeConfirmedEntityRefs(value, label) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_ENTITY_REFS || !isDenseArray(value)) {
    throw lensError(`${label} exceeds the confirmed-entity limit.`, "MEMORY_LENS_MEMORY_INVALID");
  }
  const seen = new Map();
  const output = [];
  value.forEach((entry, index) => {
    if (!isPlainObject(entry) || !isConfirmedEntity(entry)) return;
    const id = requireId(entry.entityId ?? entry.id, `${label}[${index}].entityId`);
    const rawType = String(entry.type ?? entry.kind ?? "").trim().toLowerCase();
    const type = ENTITY_TYPES.get(rawType);
    if (!type) return;
    const name = normalizeText(
      entry.canonicalName ?? entry.name ?? entry.label,
      `${label}[${index}].canonicalName`,
      1,
      80,
      true,
      "MEMORY_LENS_MEMORY_INVALID"
    );
    const existing = seen.get(id);
    if (existing) {
      if (existing.type !== type || existing.name !== name) {
        throw lensError(
          `Confirmed entity ${id} has conflicting saved metadata.`,
          "MEMORY_LENS_ENTITY_CONFLICT"
        );
      }
      return;
    }
    const normalized = { id, type, name };
    seen.set(id, normalized);
    output.push(normalized);
  });
  return output.sort((left, right) => compareSharedEntities(left, right));
}

function isConfirmedEntity(value) {
  return value.confirmed === true || value.resolutionStatus === "confirmed" || value.status === "confirmed";
}

function normalizeConfirmedTextList(value, label) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_EVIDENCE_ITEMS || !isDenseArray(value)) {
    throw lensError(`${label} exceeds the confirmed-text limit.`, "MEMORY_LENS_MEMORY_INVALID");
  }
  return uniqueSortedTexts(value.map((entry, index) => normalizeText(
    typeof entry === "string" ? entry : entry?.text ?? entry?.quote,
    `${label}[${index}]`,
    1,
    4_000,
    false,
    "MEMORY_LENS_MEMORY_INVALID"
  )));
}

function normalizeConfirmedTranscripts(memory, label) {
  const output = normalizeConfirmedTextList(memory.confirmedTranscripts, `${label}.confirmedTranscripts`);
  if (memory.voices === undefined || memory.voices === null) return output;
  if (!Array.isArray(memory.voices) || memory.voices.length > MAX_EVIDENCE_ITEMS || !isDenseArray(memory.voices)) {
    throw lensError(`${label}.voices exceeds the voice limit.`, "MEMORY_LENS_MEMORY_INVALID");
  }
  memory.voices.forEach((voice, index) => {
    if (!isPlainObject(voice) || !isPlainObject(voice.transcript) || voice.transcript.confirmed !== true) return;
    output.push(normalizeText(
      voice.transcript.text,
      `${label}.voices[${index}].transcript.text`,
      1,
      8_000,
      false,
      "MEMORY_LENS_MEMORY_INVALID"
    ));
  });
  return uniqueSortedTexts(output);
}

function normalizeMediaCount(memory, label) {
  if (memory.media !== undefined && memory.media !== null) {
    if (!Array.isArray(memory.media) || memory.media.length > MAX_EVIDENCE_ITEMS || !isDenseArray(memory.media)) {
      throw lensError(`${label}.media exceeds the media-association limit.`, "MEMORY_LENS_MEMORY_INVALID");
    }
    return memory.media.length;
  }
  const value = memory.mediaSummary?.count ?? 0;
  return requireCount(value, `${label}.mediaSummary.count`, MAX_EVIDENCE_ITEMS);
}

function normalizeConfirmedTranscriptCount(memory, label, knownCount) {
  const supplied = memory.voiceSummary?.confirmedTranscriptCount;
  if (supplied === undefined || supplied === null) return knownCount;
  return Math.max(knownCount, requireCount(supplied, `${label}.voiceSummary.confirmedTranscriptCount`, MAX_EVIDENCE_ITEMS));
}

function requireCount(value, label, maximum) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw lensError(`${label} must be an integer from 0 to ${maximum}.`, "MEMORY_LENS_MEMORY_INVALID");
  }
  return value;
}

function normalizeTextList(value, label, maximumItems, maximumText) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > maximumItems || !isDenseArray(value)) {
    throw lensError(`${label} exceeds its list limit.`, "MEMORY_LENS_MEMORY_INVALID");
  }
  return uniqueSortedTexts(value.map((entry, index) => normalizeText(
    entry,
    `${label}[${index}]`,
    1,
    maximumText,
    true,
    "MEMORY_LENS_MEMORY_INVALID"
  )));
}

function uniqueSortedTexts(values) {
  const byKey = new Map();
  for (const value of values) {
    const key = comparisonText(value);
    const current = byKey.get(key);
    if (current === undefined || compareText(value, current) < 0) byKey.set(key, value);
  }
  return [...byKey.values()].sort(compareText);
}

function normalizeText(value, label, minimum, maximum, singleLine, code) {
  if (typeof value !== "string" || value.length > maximum * 2) {
    throw lensError(`${label} must be bounded text.`, code);
  }
  const normalized = value.replace(/\r\n?/gu, "\n").trim();
  const length = [...normalized].length;
  const pattern = singleLine ? SINGLE_LINE_CONTROL_PATTERN : CONTROL_PATTERN;
  if (length < minimum || length > maximum || pattern.test(normalized) || (singleLine && normalized.includes("\n"))) {
    throw lensError(`${label} must be bounded canonical text.`, code);
  }
  return normalized;
}

function requireId(value, label) {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    throw lensError(`${label} is invalid.`, "MEMORY_LENS_MEMORY_INVALID");
  }
  return value;
}

function requireCanonicalTimestamp(value, label) {
  if (!isCanonicalTimestamp(value)) {
    throw lensError(`${label} must be a canonical UTC timestamp from a saved memory.`, "MEMORY_LENS_MEMORY_INVALID");
  }
  return value;
}

function isCanonicalTimestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function comparisonText(value) {
  return String(value || "").normalize("NFKC").toLowerCase();
}

function compareText(left, right) {
  const a = String(left ?? "");
  const b = String(right ?? "");
  return a < b ? -1 : a > b ? 1 : 0;
}

function isDenseArray(value) {
  if (!Array.isArray(value)) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) return false;
  }
  return true;
}

function assertPlainObject(value, label, code) {
  if (!isPlainObject(value)) throw lensError(`${label} must be a plain object.`, code);
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertKnownKeys(value, allowed, label, code) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw lensError(`${label} contains unsupported field ${key}.`, code);
  }
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

function lensError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

module.exports = {
  MEMORY_LENS_FORMAT,
  MEMORY_LENS_VERSION,
  MEMORY_LENS_ENGINE,
  MEMORY_LENS_BOUNDARY: LENS_BOUNDARY,
  MEMORY_LENS_DEFINITIONS: LENS_DEFINITIONS,
  MEMORY_LENS_LIMITS: Object.freeze({
    minMemories: MIN_MEMORIES,
    maxMemories: MAX_MEMORIES,
    maxEntityRefs: MAX_ENTITY_REFS,
    maxEvidenceItems: MAX_EVIDENCE_ITEMS
  }),
  buildMemoryLensPreview,
  createMemoryLensPreview: buildMemoryLensPreview,
  normalizeMemoryLensRequest
};
