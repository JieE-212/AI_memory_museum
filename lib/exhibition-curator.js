"use strict";

const MIN_MEMORIES = 2;
const MAX_MEMORIES = 12;
const MAX_SECTIONS = 3;
const MAX_QUOTE_LENGTH = 180;

const BASIS_LABELS = Object.freeze({
  tag: "主题",
  person: "人物",
  location: "地点",
  emotion: "情绪",
  year: "时间"
});
const BASIS_PRIORITY = Object.freeze({ tag: 0, person: 1, location: 2, year: 3, emotion: 4 });

/**
 * Build a deterministic exhibition draft from user-selected memories.
 * Every factual item citation is a byte-for-byte UTF-16 slice of rawContent.
 */
function buildExhibitionPreview(inputMemories, options = {}) {
  const memories = normalizeMemories(inputMemories);
  const requestedTheme = cleanText(options.theme, 60);
  const candidates = collectSharedCandidates(memories);
  const selectedCandidates = candidates.slice(0, 2);
  const groups = groupMemories(memories, selectedCandidates);
  const derivedTheme = requestedTheme || selectedCandidates[0]?.value || "用户选定记忆";
  const title = cleanText(options.title, 120) || (
    derivedTheme === "用户选定记忆"
      ? `${memories.length} 件记忆的小型展览`
      : `关于「${derivedTheme}」的主题展览`
  );
  const opening = cleanText(options.opening, 1200) || (
    `这场展览由用户选定的 ${memories.length} 件展品组成。叙事只采用已保存的标题、说明和原文引用，仍需用户确认后才能入馆。`
  );

  const sections = groups.slice(0, MAX_SECTIONS).map((group) => {
    const basis = group.basis;
    const sectionTitle = basis ? `${BASIS_LABELS[basis.type]} · ${basis.value}` : "用户选定的记忆";
    const summary = basis
      ? `本章收录 ${group.memories.length} 件带有「${basis.value}」已记录线索的展品。`
      : `本章按用户选定顺序收录 ${group.memories.length} 件展品。`;
    return {
      title: sectionTitle,
      summary,
      items: group.memories.map((memory) => buildItem(memory, basis))
    };
  });

  return {
    title,
    theme: derivedTheme,
    opening,
    mode: "evidence-rules",
    requiresConfirmation: true,
    memoryIds: memories.map((memory) => memory.id),
    sections,
    selection: {
      count: memories.length,
      memoryIds: memories.map((memory) => memory.id),
      grouping: groups.map((group) => ({
        sectionTitle: group.basis ? `${BASIS_LABELS[group.basis.type]} · ${group.basis.value}` : "用户选定的记忆",
        basis: group.basis ? { ...group.basis } : { type: "selection", value: "用户选择" },
        memoryIds: group.memories.map((memory) => memory.id)
      }))
    },
    guidance: "引用只来自展品原文；保存前必须由用户确认标题、章节和每条引用。"
  };
}

function buildItem(memory, basis) {
  const citation = buildCitation(memory, basis?.value || "");
  const curatorNote = basis
    ? `这件展品因已记录的${BASIS_LABELS[basis.type]}线索「${basis.value}」被编入本章。`
    : "这件展品按用户选定顺序编入本章。";
  return {
    memoryId: memory.id,
    title: memory.title,
    excerpt: cleanText(memory.exhibitText, 240) || citation.quote,
    curatorNote,
    citations: [citation]
  };
}

function buildCitation(memory, preferredAnchor = "") {
  const raw = memory.rawContent;
  const anchors = uniqueStrings([
    preferredAnchor,
    ...memory.tags,
    ...memory.people,
    memory.location,
    ...memory.emotions,
    memory.date
  ]);
  let match = null;
  for (const anchor of anchors) {
    const index = indexOfText(raw, anchor);
    if (index >= 0) {
      match = { index, length: anchor.length };
      break;
    }
  }

  const range = quoteRange(raw, match?.index ?? firstVisibleIndex(raw), match ? match.index + match.length : -1);
  const quote = raw.slice(range.start, range.end);
  const citation = {
    quote,
    startOffset: range.start,
    endOffset: range.end,
    evidenceValid: Boolean(quote) && raw.slice(range.start, range.end) === quote,
    field: "rawContent"
  };
  if (!citation.evidenceValid) throw curatorError(`展品 ${memory.id} 无法生成可核验原文引用。`, "EXHIBITION_EVIDENCE_INVALID");
  return citation;
}

function quoteRange(raw, anchorStart, anchorEnd) {
  if (!raw) return { start: 0, end: 0 };
  let start = Math.max(0, Number.isInteger(anchorStart) && anchorStart >= 0 ? anchorStart : firstVisibleIndex(raw));
  if (start < 0) start = 0;
  let end = Number.isInteger(anchorEnd) && anchorEnd > start ? anchorEnd : start + 1;

  const leftBoundary = Math.max(0, start - 60);
  for (let cursor = start - 1; cursor >= leftBoundary; cursor -= 1) {
    if (/[。！？!?；;\n]/u.test(raw[cursor])) {
      start = cursor + 1;
      break;
    }
    if (cursor === leftBoundary) start = leftBoundary;
  }
  while (start < raw.length && /\s/u.test(raw[start])) start += 1;

  const hardEnd = Math.min(raw.length, start + MAX_QUOTE_LENGTH);
  end = Math.max(end, start + 1);
  while (end < hardEnd && !/[。！？!?；;\n]/u.test(raw[end - 1])) end += 1;
  end = Math.min(end, hardEnd);
  while (end > start && /\s/u.test(raw[end - 1])) end -= 1;
  if (end <= start) end = Math.min(raw.length, start + MAX_QUOTE_LENGTH);
  return { start, end };
}

function collectSharedCandidates(memories) {
  const byKey = new Map();
  memories.forEach((memory, memoryIndex) => {
    const values = [
      ...memory.tags.map((value) => ({ type: "tag", value })),
      ...memory.people.map((value) => ({ type: "person", value })),
      ...(memory.location ? [{ type: "location", value: memory.location }] : []),
      ...memory.emotions.map((value) => ({ type: "emotion", value })),
      ...(/^\d{4}/u.test(memory.date) ? [{ type: "year", value: memory.date.slice(0, 4) }] : [])
    ];
    const seen = new Set();
    values.forEach(({ type, value }) => {
      const key = `${type}\0${canonical(value)}`;
      if (!value || seen.has(key)) return;
      seen.add(key);
      if (!byKey.has(key)) byKey.set(key, { type, value, count: 0, firstIndex: memoryIndex, memoryIds: [] });
      const candidate = byKey.get(key);
      candidate.count += 1;
      candidate.memoryIds.push(memory.id);
    });
  });
  return [...byKey.values()]
    .filter((candidate) => candidate.count >= 2)
    .sort((left, right) => (
      right.count - left.count ||
      BASIS_PRIORITY[left.type] - BASIS_PRIORITY[right.type] ||
      left.firstIndex - right.firstIndex ||
      left.value.localeCompare(right.value, "zh-CN")
    ));
}

function groupMemories(memories, candidates) {
  if (!candidates.length) return [{ basis: null, memories: [...memories] }];
  const groups = candidates.map((basis) => ({ basis, memories: [] }));
  const remainder = [];
  memories.forEach((memory) => {
    const index = candidates.findIndex((candidate) => memoryHasCandidate(memory, candidate));
    if (index >= 0) groups[index].memories.push(memory);
    else remainder.push(memory);
  });
  const nonEmpty = groups.filter((group) => group.memories.length);
  if (remainder.length) nonEmpty.push({ basis: null, memories: remainder });
  return nonEmpty.slice(0, MAX_SECTIONS);
}

function memoryHasCandidate(memory, candidate) {
  const key = canonical(candidate.value);
  if (candidate.type === "tag") return memory.tags.some((value) => canonical(value) === key);
  if (candidate.type === "person") return memory.people.some((value) => canonical(value) === key);
  if (candidate.type === "location") return canonical(memory.location) === key;
  if (candidate.type === "emotion") return memory.emotions.some((value) => canonical(value) === key);
  if (candidate.type === "year") return memory.date.startsWith(candidate.value);
  return false;
}

function normalizeMemories(value) {
  if (!Array.isArray(value) || value.length < MIN_MEMORIES || value.length > MAX_MEMORIES) {
    throw curatorError(`主题展览必须选择 ${MIN_MEMORIES} 至 ${MAX_MEMORIES} 件展品。`, "EXHIBITION_MEMORY_COUNT_INVALID");
  }
  const seen = new Set();
  return value.map((input, index) => {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw curatorError(`memories[${index}] 格式无效。`, "EXHIBITION_MEMORY_INVALID");
    }
    const id = String(input.id || "").trim();
    if (!/^[a-zA-Z0-9_-]{1,120}$/.test(id)) throw curatorError(`memories[${index}].id 无效。`, "EXHIBITION_MEMORY_INVALID");
    if (seen.has(id)) throw curatorError("主题展览不能重复选择同一件展品。", "EXHIBITION_MEMORY_DUPLICATE");
    seen.add(id);
    const rawContent = String(input.rawContent || "");
    if (!rawContent.trim()) throw curatorError(`展品 ${id} 缺少可引用的原文。`, "EXHIBITION_SOURCE_EMPTY");
    return {
      id,
      title: cleanText(input.title, 120) || "未命名展品",
      rawContent: rawContent.slice(0, 20000),
      exhibitText: cleanText(input.exhibitText, 1200),
      date: cleanText(input.date, 40),
      location: cleanText(input.location, 80),
      people: normalizeList(input.people, 12, 40),
      tags: normalizeList(input.tags, 12, 40),
      emotions: normalizeList(input.emotions, 8, 30)
    };
  });
}

function verifyCitation(memory, citation) {
  const raw = String(memory?.rawContent || "");
  const quote = String(citation?.quote || "");
  const start = Number(citation?.startOffset);
  const end = Number(citation?.endOffset);
  return Boolean(quote) && Number.isInteger(start) && Number.isInteger(end) &&
    start >= 0 && end > start && end <= raw.length && raw.slice(start, end) === quote;
}

function normalizeList(value, maximum, itemLength) {
  if (!Array.isArray(value)) return [];
  return uniqueStrings(value.map((item) => cleanText(item, itemLength))).slice(0, maximum);
}

function uniqueStrings(values) {
  const seen = new Set();
  return values.filter((value) => {
    const text = String(value || "").trim();
    const key = canonical(text);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((value) => String(value).trim());
}

function canonical(value) {
  return String(value || "").normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

function cleanText(value, maximum) {
  const text = String(value || "").replace(/\s+/gu, " ").trim();
  return maximum && text.length > maximum ? text.slice(0, maximum) : text;
}

function indexOfText(raw, candidate) {
  if (!raw || !candidate) return -1;
  const exact = raw.indexOf(candidate);
  if (exact >= 0) return exact;
  return /^[\x00-\x7F]+$/u.test(candidate) ? raw.toLowerCase().indexOf(candidate.toLowerCase()) : -1;
}

function firstVisibleIndex(value) {
  const match = /\S/u.exec(value);
  return match ? match.index : -1;
}

function curatorError(message, code) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = 400;
  return error;
}

module.exports = {
  MAX_MEMORIES,
  MAX_QUOTE_LENGTH,
  MAX_SECTIONS,
  MIN_MEMORIES,
  buildExhibitionPreview,
  verifyCitation
};
