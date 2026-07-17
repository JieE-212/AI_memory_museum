"use strict";

const MAX_QUERY_CODE_POINTS = 200;
const MAX_DIRECT_TERMS = 20;
const MAX_EXPANDED_TERMS = 40;
const MAX_TERM_CODE_POINTS = 80;
const RULE_EXPANSION_FACTOR = 0.72;
const CONFIRMED_ENTITY_BONUS = 4;

const FIELD_DEFINITIONS = Object.freeze([
  Object.freeze({ field: "title", label: "标题", weight: 6, properties: ["title"] }),
  Object.freeze({ field: "exhibit", label: "展品说明", weight: 4, properties: ["exhibit", "exhibitText", "exhibit_text"] }),
  Object.freeze({ field: "raw", label: "原文", weight: 3, properties: ["raw", "rawContent", "raw_content"] }),
  Object.freeze({ field: "voice", label: "确认文字稿", weight: 3, properties: ["voiceTranscript", "voiceText", "voice_text"] }),
  Object.freeze({ field: "location", label: "地点", weight: 4, properties: ["location"] }),
  Object.freeze({ field: "people", label: "人物", weight: 5, properties: ["people"] }),
  Object.freeze({ field: "themes", label: "主题", weight: 5, properties: ["themes", "theme", "tags"] }),
  Object.freeze({ field: "emotions", label: "情绪", weight: 3, properties: ["emotions", "emotion"] }),
  Object.freeze({ field: "source", label: "来源", weight: 2, properties: ["source", "sourceType", "sourceText", "source_text"] })
]);

const FIELD_BY_NAME = new Map(FIELD_DEFINITIONS.map((definition) => [definition.field, definition]));
const FIELD_ORDER = new Map(FIELD_DEFINITIONS.map((definition, index) => [definition.field, index]));

function normalizeClueText(value) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/gu, " ").trim();
}

function splitClueTerms(query) {
  const normalizedQuery = normalizeClueText(query);
  if (codePointLength(normalizedQuery) > MAX_QUERY_CODE_POINTS || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(normalizedQuery)) {
    throw clueError(`检索内容最多 ${MAX_QUERY_CODE_POINTS} 个字符，且不能包含控制字符。`, "CLUE_QUERY_INVALID");
  }
  if (!normalizedQuery) return [];
  const terms = uniqueTerms(normalizedQuery.split(" "));
  if (terms.length > MAX_DIRECT_TERMS) {
    throw clueError(`检索内容最多拆分为 ${MAX_DIRECT_TERMS} 个词。`, "CLUE_QUERY_LIMIT_EXCEEDED");
  }
  terms.forEach((term) => {
    if (codePointLength(term) > MAX_TERM_CODE_POINTS) {
      throw clueError(`单个检索词最多 ${MAX_TERM_CODE_POINTS} 个字符。`, "CLUE_QUERY_LIMIT_EXCEEDED");
    }
  });
  return terms;
}

function compileFtsQuery(terms) {
  return normalizeTermInput(terms)
    .filter((term) => !isShortClueTerm(term))
    .map((term) => `"${term.replace(/"/gu, '""')}"`)
    .join(" OR ");
}

function escapeLikePattern(value) {
  return String(value ?? "").replace(/[\\%_]/gu, (character) => `\\${character}`);
}

function buildSearchPlan(query, ruleExpansions = []) {
  const normalizedQuery = normalizeClueText(query);
  const directTerms = splitClueTerms(normalizedQuery);
  const expandedTerms = normalizeRuleExpansions(ruleExpansions, directTerms);
  const allTerms = uniqueTerms([...directTerms, ...expandedTerms]);
  return {
    normalizedQuery,
    directTerms,
    expandedTerms,
    ftsQuery: compileFtsQuery(allTerms),
    likeTerms: allTerms.map((term) => ({
      term,
      pattern: `%${escapeLikePattern(term)}%`,
      direct: hasTerm(directTerms, term),
      short: isShortClueTerm(term)
    })),
    shortQueryFallback: allTerms.some(isShortClueTerm)
  };
}

function scoreClueCandidate(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw clueError("检索候选必须是对象。", "CLUE_CANDIDATE_INVALID");
  }
  const memory = input.memory && typeof input.memory === "object" && !Array.isArray(input.memory)
    ? input.memory
    : input;
  const memoryId = normalizeClueText(input.memoryId || memory.id || memory.memoryId);
  if (!memoryId) throw clueError("检索候选缺少展品 ID。", "CLUE_CANDIDATE_INVALID");

  const directTerms = normalizeTermInput(input.directTerms);
  const expandedTerms = normalizeTermInput(input.expandedTerms).filter((term) => !hasTerm(directTerms, term));
  const termDescriptors = [
    ...directTerms.map((term) => ({ term, direct: true, factor: 1 })),
    ...expandedTerms.map((term) => ({ term, direct: false, factor: RULE_EXPANSION_FACTOR }))
  ];
  const evidence = [];
  const contributionKeys = new Set();
  let score = 0;

  for (const descriptor of termDescriptors) {
    for (const definition of FIELD_DEFINITIONS) {
      const fieldText = readSearchableField(memory, definition.properties);
      if (!fieldText || !includesTerm(fieldText, descriptor.term)) continue;
      const key = `field\u0000${definition.field}\u0000${comparisonKey(descriptor.term)}`;
      if (contributionKeys.has(key)) continue;
      contributionKeys.add(key);
      score += definition.weight * descriptor.factor;
      evidence.push(createEvidence({
        kind: descriptor.direct ? "field" : "rule-expansion",
        field: definition.field,
        term: descriptor.term,
        label: descriptor.direct
          ? `${definition.label}包含“${descriptor.term}”`
          : `规则扩展词“${descriptor.term}”命中${definition.label}`
      }, descriptor.direct));
    }
  }

  const entityMatches = normalizeEntityMatches(input);
  const entityContributionKeys = new Set();
  for (const descriptor of termDescriptors) {
    for (const entity of entityMatches) {
      if (!entity.confirmed || !entityMatchesTerm(entity, descriptor.term)) continue;
      const field = normalizeEntityField(entity);
      const definition = FIELD_BY_NAME.get(field) || { field, label: "实体", weight: 4 };
      const matchKey = `${field}\u0000${comparisonKey(descriptor.term)}`;
      if (entityContributionKeys.has(matchKey)) continue;
      entityContributionKeys.add(matchKey);
      const fieldKey = `field\u0000${field}\u0000${comparisonKey(descriptor.term)}`;
      score += CONFIRMED_ENTITY_BONUS;
      if (!contributionKeys.has(fieldKey)) score += definition.weight * descriptor.factor;
      const entityName = entity.canonicalName || entity.name || descriptor.term;
      evidence.push(createEvidence({
        kind: descriptor.direct ? "entity" : "rule-expansion",
        field,
        term: descriptor.term,
        label: descriptor.direct
          ? `已确认${definition.label}实体“${entityName}”匹配“${descriptor.term}”`
          : `规则扩展词“${descriptor.term}”命中已确认${definition.label}实体“${entityName}”`,
        ...(entity.entityId ? { entityId: entity.entityId } : {})
      }, descriptor.direct));
    }
  }

  evidence.sort(compareEvidence(termDescriptors));
  const matchedTerms = termDescriptors
    .map(({ term }) => term)
    .filter((term) => evidence.some((item) => comparisonKey(item.term) === comparisonKey(term)));
  const matchedFields = [...new Set(evidence.map((item) => item.field))]
    .sort((left, right) => fieldRank(left) - fieldRank(right) || left.localeCompare(right, "en"));
  const directEvidenceCount = evidence.filter((item) => item.direct).length;
  const publicEvidence = evidence.map(({ direct, ...item }) => item);
  const roundedScore = roundScore(score);
  const confidence = confidenceFor({ score: roundedScore, directEvidenceCount, evidence: publicEvidence, directTerms });

  return {
    memoryId,
    score: roundedScore,
    matchedTerms,
    matchedFields,
    confidence,
    reason: reasonFor(publicEvidence, confidence),
    evidence: publicEvidence,
    directEvidenceCount
  };
}

function mergeClueCandidates(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw clueError("候选集合必须是对象。", "CLUE_CANDIDATES_INVALID");
  }
  const grouped = new Map();
  addCandidateGroup(grouped, input.ftsCandidates, "fts");
  addCandidateGroup(grouped, input.likeCandidates, "like");
  addCandidateGroup(grouped, input.entityCandidates, "entity");

  return [...grouped.values()].map((candidate) => {
    const scored = scoreClueCandidate({
      memory: candidate.memory,
      memoryId: candidate.memoryId,
      ftsRank: candidate.ftsRank,
      entityMatches: candidate.entityMatches,
      entityNames: candidate.entityNames,
      directTerms: input.directTerms,
      expandedTerms: input.expandedTerms
    });
    return {
      memory: candidate.memory,
      ...scored,
      retrievalSources: [...candidate.sources].sort((left, right) => left.localeCompare(right, "en"))
    };
  }).sort(compareClueResults);
}

function compareClueResults(left, right) {
  return Number(right?.score || 0) - Number(left?.score || 0)
    || Number(right?.directEvidenceCount || 0) - Number(left?.directEvidenceCount || 0)
    || String(left?.memoryId || "").localeCompare(String(right?.memoryId || ""), "en");
}

function addCandidateGroup(grouped, value, source) {
  if (value === undefined || value === null) return;
  if (!Array.isArray(value)) throw clueError(`${source}Candidates 必须是数组。`, "CLUE_CANDIDATES_INVALID");
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const memory = entry.memory && typeof entry.memory === "object" && !Array.isArray(entry.memory) ? entry.memory : entry;
    const memoryId = normalizeClueText(entry.memoryId || memory.id || memory.memoryId);
    if (!memoryId) continue;
    const current = grouped.get(memoryId) || {
      memoryId,
      memory: {},
      ftsRank: null,
      entityMatches: [],
      entityNames: [],
      sources: new Set()
    };
    current.memory = mergeDefined(current.memory, memory);
    const rank = Number(entry.ftsRank);
    if (Number.isFinite(rank) && (current.ftsRank === null || rank < current.ftsRank)) current.ftsRank = rank;
    if (Array.isArray(entry.entityMatches)) current.entityMatches.push(...entry.entityMatches);
    else if (entry.entityMatch && typeof entry.entityMatch === "object") current.entityMatches.push(entry.entityMatch);
    else if (source === "entity" && (entry.entityId || entry.canonicalName || entry.name)) current.entityMatches.push(entry);
    if (Array.isArray(entry.entityNames)) current.entityNames.push(...entry.entityNames);
    current.sources.add(source);
    grouped.set(memoryId, current);
  }
}

function normalizeRuleExpansions(value, directTerms) {
  let entries = [];
  if (Array.isArray(value)) {
    entries = value;
  } else if (value && typeof value === "object") {
    for (const directTerm of directTerms) {
      const matchingKey = Object.keys(value).find((key) => comparisonKey(key) === comparisonKey(directTerm));
      if (matchingKey) entries.push(...(Array.isArray(value[matchingKey]) ? value[matchingKey] : [value[matchingKey]]));
    }
  } else if (value !== undefined && value !== null) {
    throw clueError("规则扩展必须是数组或按原词索引的对象。", "CLUE_EXPANSION_INVALID");
  }
  const terms = uniqueTerms(entries.map((entry) => (
    entry && typeof entry === "object" && !Array.isArray(entry) ? entry.term : entry
  ))).filter((term) => !hasTerm(directTerms, term));
  if (terms.length > MAX_EXPANDED_TERMS) {
    throw clueError(`规则扩展最多包含 ${MAX_EXPANDED_TERMS} 个词。`, "CLUE_EXPANSION_LIMIT_EXCEEDED");
  }
  terms.forEach((term) => {
    if (codePointLength(term) > MAX_TERM_CODE_POINTS) {
      throw clueError(`单个规则扩展词最多 ${MAX_TERM_CODE_POINTS} 个字符。`, "CLUE_EXPANSION_LIMIT_EXCEEDED");
    }
  });
  return terms;
}

function normalizeEntityMatches(input) {
  const output = [];
  const sourceMatches = Array.isArray(input.entityMatches) ? input.entityMatches : [];
  sourceMatches.forEach((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return;
    const confirmed = entry.confirmed === true || entry.status === "confirmed" || validTimestamp(entry.confirmedAt);
    output.push({
      entityId: normalizeClueText(entry.entityId || entry.id),
      type: normalizeClueText(entry.type),
      sourceField: normalizeClueText(entry.sourceField || entry.field),
      canonicalName: normalizeClueText(entry.canonicalName || entry.name || entry.label),
      name: normalizeClueText(entry.name || entry.alias || entry.mentionText),
      matchedTerm: normalizeClueText(entry.matchedTerm || entry.term),
      aliases: Array.isArray(entry.aliases) ? entry.aliases.map((item) => normalizeClueText(item?.alias || item)).filter(Boolean) : [],
      confirmed
    });
  });
  const entityNames = Array.isArray(input.entityNames) ? input.entityNames : [];
  entityNames.forEach((entry) => {
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      output.push({
        entityId: normalizeClueText(entry.entityId || entry.id),
        type: normalizeClueText(entry.type),
        sourceField: normalizeClueText(entry.sourceField || entry.field || "manual"),
        canonicalName: normalizeClueText(entry.canonicalName || entry.name || entry.label),
        name: normalizeClueText(entry.name || entry.alias),
        matchedTerm: normalizeClueText(entry.matchedTerm || entry.term),
        aliases: Array.isArray(entry.aliases) ? entry.aliases.map((item) => normalizeClueText(item?.alias || item)).filter(Boolean) : [],
        confirmed: true
      });
    } else {
      const name = normalizeClueText(entry);
      if (name) output.push({ entityId: "", type: "", sourceField: "manual", canonicalName: name, name, matchedTerm: "", aliases: [], confirmed: true });
    }
  });
  return output.sort((left, right) => (
    normalizeEntityField(left).localeCompare(normalizeEntityField(right), "en")
    || (left.entityId || left.canonicalName).localeCompare(right.entityId || right.canonicalName, "en")
  ));
}

function normalizeEntityField(entity) {
  const source = entity.sourceField === "tags" ? "themes" : entity.sourceField;
  if (FIELD_BY_NAME.has(source)) return source;
  if (entity.type === "person") return "people";
  if (entity.type === "location") return "location";
  if (entity.type === "theme") return "themes";
  return "manual";
}

function entityMatchesTerm(entity, term) {
  const values = [entity.matchedTerm, entity.canonicalName, entity.name, ...(entity.aliases || [])].filter(Boolean);
  return values.some((value) => includesTerm(value, term));
}

function readSearchableField(memory, properties) {
  const values = properties.flatMap((property) => flattenTextValues(memory?.[property]));
  return normalizeClueText(values.join(" "));
}

function flattenTextValues(value) {
  if (Array.isArray(value)) return value.flatMap(flattenTextValues);
  if (typeof value === "string" || typeof value === "number") return [String(value)];
  return [];
}

function createEvidence(value, direct) {
  return { ...value, direct };
}

function compareEvidence(termDescriptors) {
  const termOrder = new Map(termDescriptors.map(({ term }, index) => [comparisonKey(term), index]));
  const kindOrder = new Map([["field", 0], ["entity", 1], ["rule-expansion", 2]]);
  return (left, right) => (
    (termOrder.get(comparisonKey(left.term)) ?? Number.MAX_SAFE_INTEGER) - (termOrder.get(comparisonKey(right.term)) ?? Number.MAX_SAFE_INTEGER)
    || fieldRank(left.field) - fieldRank(right.field)
    || (kindOrder.get(left.kind) ?? 9) - (kindOrder.get(right.kind) ?? 9)
    || String(left.entityId || "").localeCompare(String(right.entityId || ""), "en")
  );
}

function confidenceFor({ score, directEvidenceCount, evidence, directTerms }) {
  const directKeys = new Set(directTerms.map(comparisonKey));
  const hasDirectEntity = evidence.some((item) => item.kind === "entity" && directKeys.has(comparisonKey(item.term)));
  if ((directEvidenceCount >= 2 && score >= 10) || (hasDirectEntity && score >= 9)) return "strong";
  if (score >= 4 || directEvidenceCount >= 1) return "medium";
  return "weak";
}

function reasonFor(evidence, confidence) {
  if (!evidence.length) return "没有找到可核验的字段或已确认实体匹配。";
  const fieldCount = new Set(evidence.map((item) => item.field)).size;
  const entityCount = evidence.filter((item) => item.kind === "entity" || item.entityId).length;
  const expansionCount = evidence.filter((item) => item.kind === "rule-expansion").length;
  const parts = [`${confidenceLabel(confidence)}：命中 ${fieldCount} 个可核验字段`];
  if (entityCount) parts.push(`含 ${entityCount} 条已确认实体依据`);
  if (expansionCount) parts.push(`含 ${expansionCount} 条规则扩展依据`);
  return `${parts.join("；")}。`;
}

function confidenceLabel(value) {
  if (value === "strong") return "强线索";
  if (value === "medium") return "中等线索";
  return "弱线索";
}

function normalizeTermInput(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw clueError("检索词必须是数组。", "CLUE_TERMS_INVALID");
  return uniqueTerms(value);
}

function uniqueTerms(values) {
  const seen = new Set();
  const output = [];
  for (const value of values) {
    const term = normalizeClueText(value);
    if (!term) continue;
    const key = comparisonKey(term);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(term);
  }
  return output;
}

function hasTerm(terms, term) {
  const key = comparisonKey(term);
  return terms.some((item) => comparisonKey(item) === key);
}

function includesTerm(value, term) {
  return comparisonKey(value).includes(comparisonKey(term));
}

function comparisonKey(value) {
  return normalizeClueText(value).toLowerCase();
}

function isShortClueTerm(value) {
  const length = codePointLength(normalizeClueText(value));
  return length > 0 && length <= 2;
}

function codePointLength(value) {
  return [...String(value ?? "")].length;
}

function fieldRank(field) {
  return FIELD_ORDER.get(field) ?? FIELD_DEFINITIONS.length;
}

function mergeDefined(target, source) {
  const output = { ...target };
  Object.entries(source || {}).forEach(([key, value]) => {
    if (value !== undefined) output[key] = value;
  });
  return output;
}

function validTimestamp(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 40 && Number.isFinite(Date.parse(value));
}

function roundScore(value) {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

function clueError(message, code, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

module.exports = {
  CLUE_FIELD_WEIGHTS: Object.freeze(Object.fromEntries(FIELD_DEFINITIONS.map(({ field, weight }) => [field, weight]))),
  CLUE_RULE_EXPANSION_FACTOR: RULE_EXPANSION_FACTOR,
  buildSearchPlan,
  codePointLength,
  compareClueResults,
  compileFtsQuery,
  escapeLikePattern,
  isShortClueTerm,
  mergeClueCandidates,
  normalizeClueText,
  scoreClueCandidate,
  splitClueTerms
};
