"use strict";

/**
 * 私人记忆考古：可解释、可校验、零依赖的启发式算法层。
 *
 * 这里输出的“关联”始终只是漫游线索；模块不会自动判定两段记忆
 * 属于同一事件。所有拼图证据都带 UTF-16 字符位置，并可由调用方用
 * rawContent.slice(start, end) 再次校验。
 */

const MODULE_VERSION = "1.0";
const MAX_MEMORIES = 120;
const MAX_CONNECTIONS = 6;
const MAX_QUOTE_LENGTH = 120;

const FIELD_LABELS = Object.freeze({
  date: "时间",
  location: "地点",
  people: "人物",
  tags: "主题",
  emotions: "感受"
});

const FIELD_PRIORITY = Object.freeze({
  date: 100,
  location: 95,
  people: 85,
  emotions: 65,
  tags: 45
});

const KEYWORD_STOP_WORDS = new Set([
  "一个", "一些", "一样", "一起", "一直", "不会", "不是", "不过", "不能", "什么",
  "他们", "你们", "我们", "以及", "以后", "但是", "其实", "因为", "所以", "如果",
  "已经", "当时", "怎么", "时候", "然后", "现在", "真的", "知道", "觉得", "记得",
  "这个", "这些", "这里", "还是", "那一", "那个", "那些", "那里", "非常", "后来",
  "and", "the", "that", "this", "with", "from", "were", "was", "have", "had"
]);

const COMMON_CHINESE_GRAMS = new Set([
  "一起", "一个", "一直", "不会", "不是", "什么", "他们", "你们", "我们", "以后", "但是",
  "其实", "因为", "所以", "如果", "已经", "当时", "怎么", "时候", "然后", "现在", "真的",
  "知道", "觉得", "记得", "这个", "这些", "还是", "那个", "那些", "后来", "那天", "一天"
]);

function buildConnections(memories, options = {}) {
  const collection = normalizeMemories(memories);
  const requestedId = cleanText(options.focusId, 120);
  const focus = requestedId
    ? collection.find((memory) => memory.id === requestedId)
    : collection[0];
  const limit = clampInteger(options.limit, 1, MAX_CONNECTIONS, 3);

  if (!focus) {
    return {
      version: MODULE_VERSION,
      status: requestedId ? "focus_not_found" : "empty_collection",
      focus: null,
      connections: [],
      guidance: "关联只用于漫游，不代表这些记忆属于同一事件。"
    };
  }

  const connections = collection
    .filter((memory) => memory.id !== focus.id)
    .map((memory) => connectionBetween(focus, memory))
    .filter((connection) => connection.score > 0)
    .sort(compareConnections)
    .slice(0, limit);

  return {
    version: MODULE_VERSION,
    status: connections.length ? "ready" : "no_connections",
    focus: memoryReference(focus),
    connections,
    guidance: "关联只用于漫游，不代表这些记忆属于同一事件。"
  };
}

function buildPuzzle(leftInput, rightInput) {
  const left = normalizeMemory(leftInput, 0, "left-memory");
  const right = normalizeMemory(rightInput, 1, "right-memory");
  const buckets = {
    stable: [],
    differs: [],
    additions: [],
    unknowns: []
  };

  compareScalarField("date", left, right, buckets, dateAliases);
  compareScalarField("location", left, right, buckets);
  compareListField("people", left, right, buckets);
  compareListField("emotions", left, right, buckets);
  compareListField("tags", left, right, buckets);

  const limited = {
    stable: finalizeItems(buckets.stable, "stable", 8),
    differs: finalizeItems(buckets.differs, "differs", 5),
    additions: finalizeItems(buckets.additions, "additions", 8),
    unknowns: finalizeItems(buckets.unknowns, "unknowns", 6)
  };
  const omitted = Object.keys(buckets).reduce((total, key) => (
    total + Math.max(0, buckets[key].length - limited[key].length)
  ), 0);

  return {
    version: MODULE_VERSION,
    status: "ready",
    pair: {
      left: memoryReference(left),
      right: memoryReference(right)
    },
    stable: limited.stable,
    differs: limited.differs,
    additions: limited.additions,
    unknowns: limited.unknowns,
    summary: {
      stable: limited.stable.length,
      differs: limited.differs.length,
      additions: limited.additions.length,
      unknowns: limited.unknowns.length,
      omitted
    },
    guidance: "缺失只表示尚未记录，不会被当作矛盾；是否属于同一事件仍由用户确认。"
  };
}

function buildCuratorQuestion(puzzleInput) {
  const puzzle = puzzleInput && typeof puzzleInput === "object" ? puzzleInput : {};
  const differs = safeArray(puzzle.differs);
  const additions = safeArray(puzzle.additions);
  const unknowns = safeArray(puzzle.unknowns);
  const ranked = [
    ...differs.map((item) => ({ item, kind: "differs", base: 300 })),
    ...additions.map((item) => ({ item, kind: "additions", base: 200 })),
    ...unknowns.map((item) => ({ item, kind: "unknowns", base: 100 }))
  ].sort((a, b) => {
    const aScore = a.base + (FIELD_PRIORITY[a.item.field] || 0);
    const bScore = b.base + (FIELD_PRIORITY[b.item.field] || 0);
    if (aScore !== bScore) return bScore - aScore;
    return String(a.item.id || "").localeCompare(String(b.item.id || ""), "zh-CN");
  });

  const candidate = ranked[0];
  if (!candidate) {
    return {
      version: MODULE_VERSION,
      available: false,
      question: "",
      why: "当前拼图没有需要追问的差异或缺口。",
      basedOn: null,
      answerMode: "none",
      allowUnknown: true,
      actions: []
    };
  }

  return {
    version: MODULE_VERSION,
    available: true,
    question: cleanText(questionFor(candidate.kind, candidate.item), 180),
    why: cleanText(reasonForQuestion(candidate.kind, candidate.item), 100),
    basedOn: {
      kind: candidate.kind,
      itemId: cleanText(candidate.item.id, 40),
      field: cleanText(candidate.item.field, 30)
    },
    answerMode: "free_text_or_unknown",
    allowUnknown: true,
    actions: [
      { id: "answer", label: "补充这块拼图" },
      { id: "keep_unknown", label: "记不清了，保留不确定" },
      { id: "skip", label: "暂时跳过" }
    ]
  };
}

function buildFeaturedRoute(memories) {
  const collection = normalizeMemories(memories);
  if (!collection.length) {
    return {
      version: MODULE_VERSION,
      status: "empty_collection",
      id: "featured-route",
      title: "今日记忆航线",
      description: "馆藏中还没有可供漫游的记忆。",
      items: [],
      transitions: [],
      guidance: "加入第一件展品后，航线会在本地生成。"
    };
  }

  const pairMap = new Map();
  const graph = new Map(collection.map((memory) => [memory.id, []]));
  for (let leftIndex = 0; leftIndex < collection.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < collection.length; rightIndex += 1) {
      const left = collection[leftIndex];
      const right = collection[rightIndex];
      const connection = connectionBetween(left, right);
      if (connection.score <= 0) continue;
      const key = pairKey(left.id, right.id);
      pairMap.set(key, connection);
      graph.get(left.id).push({ id: right.id, score: connection.score });
      graph.get(right.id).push({ id: left.id, score: connection.score });
    }
  }

  const start = collection
    .map((memory) => ({
      memory,
      score: displayScore(memory) + graph.get(memory.id).reduce((sum, edge) => sum + edge.score, 0)
    }))
    .sort((a, b) => b.score - a.score || a.memory.id.localeCompare(b.memory.id, "zh-CN"))[0].memory;

  const route = [start];
  const used = new Set([start.id]);
  const transitions = [];
  while (route.length < Math.min(4, collection.length)) {
    const current = route[route.length - 1];
    const nextEdge = graph.get(current.id)
      .filter((edge) => !used.has(edge.id))
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id, "zh-CN"))[0];
    if (!nextEdge) break;

    const next = collection.find((memory) => memory.id === nextEdge.id);
    const connection = pairMap.get(pairKey(current.id, next.id));
    route.push(next);
    used.add(next.id);
    transitions.push({
      fromId: current.id,
      toId: next.id,
      score: connection.score,
      strength: connection.strength,
      summary: connection.summary,
      reasons: connection.reasons,
      sameEvent: "unassessed"
    });
  }

  const theme = transitions[0]?.reasons[0]?.values[0] || "一条线索";
  const title = transitions.length ? `沿着「${cleanText(theme, 18)}」漫游` : "今日记忆航线";
  return {
    version: MODULE_VERSION,
    status: transitions.length ? "ready" : "single_stop",
    id: "featured-route",
    title,
    description: transitions.length
      ? `从 ${route.length} 件展品中，沿可解释的共同线索缓慢漫游。`
      : "暂时没有足够的共同线索，先从这件展品开始。",
    items: route.map((memory, index) => ({
      order: index + 1,
      ...memoryReference(memory)
    })),
    transitions,
    guidance: "航线是探索建议，不会自动把不同记忆合并为同一事件。"
  };
}

function connectionBetween(focus, memory) {
  const reasons = collectConnectionReasons(focus, memory)
    .sort((a, b) => b.weight - a.weight || a.type.localeCompare(b.type));
  const score = roundOne(Math.min(10, reasons.reduce((sum, reason) => sum + reason.weight, 0)));
  const strength = score >= 6 ? "strong" : score >= 3 ? "medium" : "weak";
  const visibleReasons = reasons.slice(0, 4).map(({ weight, ...reason }) => reason);
  return {
    id: `connection-${focus.id}-${memory.id}`.slice(0, 260),
    relation: "possible_connection",
    sameEvent: "unassessed",
    requiresConfirmation: true,
    score,
    strength,
    summary: visibleReasons.length
      ? cleanText(visibleReasons.map((reason) => reason.label).join("；"), 120)
      : "暂无可解释的共同线索",
    reasons: visibleReasons,
    memory: memoryReference(memory)
  };
}

function collectConnectionReasons(left, right) {
  const reasons = [];
  const people = intersectValues(left.people, right.people);
  if (people.length) {
    reasons.push(makeReason("people", `都提到了${joinChinese(people)}`, people, Math.min(7, people.length * 4)));
  }

  const locations = intersectValues(splitLocation(left.location), splitLocation(right.location));
  if (locations.length) {
    reasons.push(makeReason("location", `地点同为${joinChinese(locations)}`, locations, 3.4));
  }

  const dateRelation = compareDates(left.date, right.date);
  if (dateRelation) reasons.push(makeReason("date", dateRelation.label, [dateRelation.value], dateRelation.weight));

  const tags = intersectValues(left.tags, right.tags);
  if (tags.length) {
    reasons.push(makeReason("tags", `共享主题${joinChinese(tags)}`, tags, Math.min(4, tags.length * 2)));
  }

  const emotions = intersectValues(left.emotions, right.emotions);
  if (emotions.length) {
    reasons.push(makeReason("emotions", `都有${joinChinese(emotions)}的感受`, emotions, Math.min(1.6, emotions.length * 0.8)));
  }

  const keywords = intersectValues(extractKeywords(left), extractKeywords(right)).slice(0, 3);
  if (keywords.length) {
    reasons.push(makeReason("keywords", `原文都出现${joinChinese(keywords)}`, keywords, Math.min(1.5, keywords.length * 0.5)));
  }
  return reasons;
}

function makeReason(type, label, values, weight) {
  return {
    type,
    label: cleanText(label, 60),
    values: values.slice(0, 3).map((value) => cleanText(value, 30)),
    weight
  };
}

function compareScalarField(field, left, right, buckets, aliasBuilder) {
  const leftValue = cleanText(left[field], 80);
  const rightValue = cleanText(right[field], 80);
  const leftSource = evidenceFor(left, "left", leftValue, aliasBuilder?.(leftValue));
  const rightSource = evidenceFor(right, "right", rightValue, aliasBuilder?.(rightValue));
  const label = FIELD_LABELS[field];

  if (!leftValue && !rightValue) {
    buckets.unknowns.push({
      field,
      fieldLabel: label,
      statement: `两段记忆都没有记录${label}。`,
      values: [],
      sides: ["left", "right"],
      reason: "missing_both",
      verified: false,
      sources: [leftSource, rightSource]
    });
    return;
  }

  if (!leftValue || !rightValue) {
    const presentSide = leftValue ? "left" : "right";
    const presentValue = leftValue || rightValue;
    const source = leftValue ? leftSource : rightSource;
    if (source.valid) {
      buckets.additions.push({
        field,
        fieldLabel: label,
        statement: `只有${sideLabel(presentSide)}记录了${label}“${presentValue}”。`,
        values: [presentValue],
        side: presentSide,
        note: "另一段未记录，不代表与此矛盾。",
        verified: true,
        sources: [source]
      });
    } else {
      buckets.unknowns.push(unverifiedItem(field, [presentValue], [source]));
    }
    return;
  }

  if (field === "date" && compatiblePartialDates(leftValue, rightValue)
    && !equivalentFieldValue(field, leftValue, rightValue)) {
    if (leftSource.valid && rightSource.valid) {
      const side = dateSpecificity(rightValue) > dateSpecificity(leftValue) ? "right" : "left";
      buckets.additions.push({
        field,
        fieldLabel: label,
        statement: `${sideLabel(side)}把时间补充得更具体，但两段记录并不冲突。`,
        values: [leftValue, rightValue],
        side,
        note: "较粗略的时间没有被当作矛盾。",
        verified: true,
        sources: [leftSource, rightSource]
      });
    } else {
      buckets.unknowns.push(unverifiedItem(field, [leftValue, rightValue], [leftSource, rightSource]));
    }
    return;
  }

  if (equivalentFieldValue(field, leftValue, rightValue)) {
    if (leftSource.valid && rightSource.valid) {
      buckets.stable.push({
        field,
        fieldLabel: label,
        statement: `两段记忆都记录了${label}“${leftValue}”。`,
        values: [leftValue],
        verified: true,
        sources: [leftSource, rightSource]
      });
    } else {
      buckets.unknowns.push(unverifiedItem(field, [leftValue], [leftSource, rightSource]));
    }
    return;
  }

  if (leftSource.valid && rightSource.valid) {
    buckets.differs.push({
      field,
      fieldLabel: label,
      statement: `两段记忆对${label}的记录不同。`,
      values: [leftValue, rightValue],
      verified: true,
      sources: [leftSource, rightSource]
    });
  } else {
    buckets.unknowns.push(unverifiedItem(field, [leftValue, rightValue], [leftSource, rightSource]));
  }
}

function compareListField(field, left, right, buckets) {
  const leftValues = left[field];
  const rightValues = right[field];
  const shared = intersectValues(leftValues, rightValues);
  const sharedKeys = new Set(shared.map(canonical));
  const leftOnly = leftValues.filter((value) => !sharedKeys.has(canonical(value)));
  const rightOnly = rightValues.filter((value) => !sharedKeys.has(canonical(value)));

  shared.forEach((value) => {
    const leftSource = evidenceFor(left, "left", value);
    const rightSource = evidenceFor(right, "right", value);
    if (leftSource.valid && rightSource.valid) {
      buckets.stable.push({
        field,
        fieldLabel: FIELD_LABELS[field],
        statement: stableListStatement(field, value),
        values: [value],
        verified: true,
        sources: [leftSource, rightSource]
      });
    } else {
      buckets.unknowns.push(unverifiedItem(field, [value], [leftSource, rightSource]));
    }
  });

  [
    ...leftOnly.map((value) => ({ value, side: "left", memory: left })),
    ...rightOnly.map((value) => ({ value, side: "right", memory: right }))
  ].forEach(({ value, side, memory }) => {
    const source = evidenceFor(memory, side, value);
    if (source.valid) {
      buckets.additions.push({
        field,
        fieldLabel: FIELD_LABELS[field],
        statement: `只有${sideLabel(side)}提到了${FIELD_LABELS[field]}“${value}”。`,
        values: [value],
        side,
        note: "另一段未提及，不代表与此矛盾。",
        verified: true,
        sources: [source]
      });
    } else {
      buckets.unknowns.push(unverifiedItem(field, [value], [source]));
    }
  });

  if (!leftValues.length && !rightValues.length) {
    buckets.unknowns.push({
      field,
      fieldLabel: FIELD_LABELS[field],
      statement: `两段记忆都没有记录${FIELD_LABELS[field]}。`,
      values: [],
      sides: ["left", "right"],
      reason: "missing_both",
      verified: false,
      sources: [missingEvidence(left, "left"), missingEvidence(right, "right")]
    });
  }
}

function unverifiedItem(field, values, sources) {
  return {
    field,
    fieldLabel: FIELD_LABELS[field],
    statement: `${FIELD_LABELS[field]}信息没有足够的原文锚点，暂不下结论。`,
    values: values.map((value) => cleanText(value, 80)).slice(0, 3),
    reason: "unverified_source",
    verified: false,
    sources
  };
}

function evidenceFor(memory, side, value, aliases = []) {
  const raw = String(memory.rawContent || "");
  const candidates = unique([value, ...safeArray(aliases)]).filter(Boolean);
  let match = null;
  for (const candidate of candidates) {
    const index = indexOfText(raw, candidate);
    if (index >= 0) {
      match = { index, length: candidate.length };
      break;
    }
  }
  if (!match) return missingEvidence(memory, side, value);

  const range = quoteRange(raw, match.index, match.index + match.length);
  const sourceQuote = raw.slice(range.start, range.end);
  return {
    memoryId: memory.id,
    side,
    value: cleanText(value, 80),
    sourceQuote,
    start: range.start,
    end: range.end,
    valid: Boolean(sourceQuote) && raw.slice(range.start, range.end) === sourceQuote
  };
}

function missingEvidence(memory, side, value = "") {
  return {
    memoryId: memory.id,
    side,
    value: cleanText(value, 80),
    sourceQuote: "",
    start: -1,
    end: -1,
    valid: false
  };
}

function quoteRange(raw, matchStart, matchEnd) {
  const boundaries = "。！？!?；;\n\r";
  let start = matchStart;
  let end = matchEnd;
  while (start > 0 && !boundaries.includes(raw[start - 1])) start -= 1;
  while (end < raw.length && !boundaries.includes(raw[end])) end += 1;
  if (end < raw.length && !"\n\r".includes(raw[end])) end += 1;

  while (start < matchStart && /\s/.test(raw[start])) start += 1;
  while (end > matchEnd && /\s/.test(raw[end - 1])) end -= 1;
  if (end - start <= MAX_QUOTE_LENGTH) return { start, end };

  const padding = Math.floor((MAX_QUOTE_LENGTH - (matchEnd - matchStart)) / 2);
  start = Math.max(0, matchStart - Math.max(8, padding));
  end = Math.min(raw.length, Math.max(matchEnd, start + MAX_QUOTE_LENGTH));
  if (end - start > MAX_QUOTE_LENGTH) start = end - MAX_QUOTE_LENGTH;
  return { start, end };
}

function questionFor(kind, item) {
  const field = item.field;
  const values = safeArray(item.values);
  if (kind === "differs") {
    return `两段记录中的${FIELD_LABELS[field] || "信息"}分别是“${values[0] || "未注明"}”和“${values[1] || "未注明"}”。哪一种更接近当时，还是保留这处不确定？`;
  }
  if (kind === "additions") {
    const sourceSide = item.side === "right" ? "第二段" : "第一段";
    if (field === "people") {
      return `只有${sourceSide}提到了“${values[0] || "这个人物"}”。这个人也在另一段记忆所说的经历中吗？记不清也可以保留不确定。`;
    }
    return `只有${sourceSide}记录了${FIELD_LABELS[field] || "信息"}“${values[0] || ""}”。它也适用于另一段记忆吗？记不清也可以保留不确定。`;
  }
  return `两段记录都没有留下确切的${FIELD_LABELS[field] || "信息"}。你还记得这部分吗？记不清也可以保留不确定。`;
}

function reasonForQuestion(kind, item) {
  if (kind === "differs") return `先澄清${item.fieldLabel || "关键"}差异，最能减少误合并。`;
  if (kind === "additions") return `确认这条单侧信息是否属于共同经历。`;
  return `补充${item.fieldLabel || "关键"}缺口，可以让拼图更完整。`;
}

function finalizeItems(items, kind, limit) {
  return items
    .sort((a, b) => {
      const priority = (FIELD_PRIORITY[b.field] || 0) - (FIELD_PRIORITY[a.field] || 0);
      if (priority) return priority;
      return String(a.statement).localeCompare(String(b.statement), "zh-CN");
    })
    .slice(0, limit)
    .map((item, index) => ({
      id: `${kind}-${String(index + 1).padStart(2, "0")}`,
      kind,
      ...item,
      statement: cleanText(item.statement, 140),
      values: safeArray(item.values).map((value) => cleanText(value, 80)).slice(0, 3)
    }));
}

function stableListStatement(field, value) {
  if (field === "people") return `两段记忆都提到了“${value}”。`;
  if (field === "emotions") return `两段记忆都保留了“${value}”的感受。`;
  return `两段记忆都出现了主题“${value}”。`;
}

function equivalentFieldValue(field, left, right) {
  if (field === "date") {
    const a = parseDateParts(left);
    const b = parseDateParts(right);
    if (a.year && b.year) {
      return a.year === b.year && a.month === b.month && a.day === b.day;
    }
  }
  return canonical(left) === canonical(right);
}

function compatiblePartialDates(left, right) {
  const a = parseDateParts(left);
  const b = parseDateParts(right);
  if (!a.year || !b.year || a.year !== b.year) return false;
  if (a.month && b.month && a.month !== b.month) return false;
  if (a.day && b.day && a.day !== b.day) return false;
  return dateSpecificity(left) !== dateSpecificity(right);
}

function dateSpecificity(value) {
  const parts = parseDateParts(value);
  return parts.day ? 3 : parts.month ? 2 : parts.year ? 1 : 0;
}

function dateAliases(value) {
  const parts = parseDateParts(value);
  if (!parts.year) return [];
  if (!parts.month) return [String(parts.year), `${parts.year}年`];

  const month = String(parts.month);
  const paddedMonth = month.padStart(2, "0");
  if (!parts.day) {
    return unique([
      `${parts.year}-${paddedMonth}`,
      `${parts.year}/${paddedMonth}`,
      `${parts.year}.${paddedMonth}`,
      `${parts.year}年${month}月`
    ]);
  }

  const day = String(parts.day);
  const paddedDay = day.padStart(2, "0");
  return unique([
    `${parts.year}-${paddedMonth}-${paddedDay}`,
    `${parts.year}/${paddedMonth}/${paddedDay}`,
    `${parts.year}.${paddedMonth}.${paddedDay}`,
    `${parts.year}年${month}月${day}日`
  ]);
}

function compareDates(left, right) {
  const a = parseDateParts(left);
  const b = parseDateParts(right);
  if (!a.year || !b.year || a.year !== b.year) return null;
  if (a.month && b.month && a.month === b.month) {
    if (a.day && b.day && a.day === b.day) {
      return { label: "发生在同一天", value: formatDateParts(a), weight: 3.8 };
    }
    return { label: "发生在同一个月", value: `${a.year}-${String(a.month).padStart(2, "0")}`, weight: 2.2 };
  }
  return { label: "发生在同一年", value: String(a.year), weight: 1.1 };
}

function parseDateParts(value) {
  const text = String(value || "").trim();
  const match = text.match(/(19\d{2}|20\d{2})(?:\s*[年/.\-]\s*(1[0-2]|0?[1-9]))?(?:\s*[月/.\-]\s*(3[01]|[12]\d|0?[1-9]))?/);
  return {
    year: match ? Number(match[1]) : 0,
    month: match?.[2] ? Number(match[2]) : 0,
    day: match?.[3] ? Number(match[3]) : 0
  };
}

function formatDateParts(parts) {
  if (!parts.year) return "";
  if (!parts.month) return String(parts.year);
  if (!parts.day) return `${parts.year}-${String(parts.month).padStart(2, "0")}`;
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function extractKeywords(memory) {
  const text = `${memory.title} ${memory.exhibitText} ${memory.rawContent.slice(0, 1600)}`.toLowerCase();
  const result = [];
  const latinWords = text.match(/[a-z][a-z0-9_-]{2,19}/g) || [];
  latinWords.forEach((word) => {
    if (!KEYWORD_STOP_WORDS.has(word)) result.push(word);
  });

  const chineseRuns = text.match(/[\u3400-\u9fff]{2,24}/g) || [];
  chineseRuns.forEach((run) => {
    const fragments = run.split(/[的了和与是在有把被让从到于中上下我你他她它也都很还又就而及]/).filter(Boolean);
    fragments.forEach((fragment) => {
      if (fragment.length >= 2 && fragment.length <= 8 && !KEYWORD_STOP_WORDS.has(fragment)) result.push(fragment);
      for (let size = 2; size <= Math.min(3, fragment.length); size += 1) {
        for (let index = 0; index <= fragment.length - size; index += 1) {
          const gram = fragment.slice(index, index + size);
          if (!COMMON_CHINESE_GRAMS.has(gram)) result.push(gram);
        }
      }
    });
  });
  return unique(result).slice(0, 60);
}

function normalizeMemories(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  const result = [];
  input.slice(0, MAX_MEMORIES).forEach((item, index) => {
    const memory = normalizeMemory(item, index);
    let id = memory.id;
    if (seen.has(id)) id = `${id}-${index + 1}`.slice(0, 120);
    seen.add(id);
    result.push({ ...memory, id });
  });
  return result;
}

function normalizeMemory(input, index = 0, fallbackId = "") {
  const value = input && typeof input === "object" ? input : {};
  return {
    id: cleanText(value.id, 120) || fallbackId || `memory-${index + 1}`,
    title: cleanText(value.title, 80) || "未命名记忆",
    rawContent: String(value.rawContent || "").slice(0, 20000),
    exhibitText: cleanText(value.exhibitText, 800),
    date: cleanText(value.date, 40),
    location: cleanText(value.location, 80),
    people: normalizeList(value.people, 12, 30),
    tags: normalizeList(value.tags, 12, 30),
    emotions: normalizeList(value.emotions, 8, 20),
    favorite: Boolean(value.favorite),
    importance: clampInteger(value.importance, 1, 5, 3)
  };
}

function memoryReference(memory) {
  return {
    id: memory.id,
    title: memory.title,
    date: memory.date,
    excerpt: cleanText(memory.exhibitText || memory.rawContent, 110)
  };
}

function displayScore(memory) {
  return memory.importance * 0.8
    + (memory.favorite ? 2 : 0)
    + (memory.rawContent ? 0.6 : 0)
    + (memory.date ? 0.4 : 0);
}

function splitLocation(value) {
  const text = cleanText(value, 80);
  if (!text) return [];
  return normalizeList(text.split(/[·,，、/\\>|]+/), 6, 40);
}

function intersectValues(left, right) {
  const rightKeys = new Set(safeArray(right).map(canonical).filter(Boolean));
  return unique(safeArray(left).filter((value) => rightKeys.has(canonical(value))));
}

function normalizeList(value, maxItems, maxLength) {
  const input = Array.isArray(value) ? value : [];
  const seen = new Set();
  const result = [];
  for (const item of input) {
    const cleaned = cleanText(item, maxLength);
    const key = canonical(cleaned);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
    if (result.length >= maxItems) break;
  }
  return result;
}

function canonical(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

function cleanText(value, maxLength) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!maxLength || text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(1, maxLength - 1))}…`;
}

function indexOfText(raw, candidate) {
  if (!raw || !candidate) return -1;
  const exact = raw.indexOf(candidate);
  if (exact >= 0) return exact;
  if (/^[\x00-\x7F]+$/.test(candidate)) return raw.toLowerCase().indexOf(candidate.toLowerCase());
  return -1;
}

function compareConnections(left, right) {
  if (left.score !== right.score) return right.score - left.score;
  return left.memory.id.localeCompare(right.memory.id, "zh-CN");
}

function pairKey(leftId, rightId) {
  return [leftId, rightId].sort().join("\u0000");
}

function sideLabel(side) {
  return side === "right" ? "第二段" : "第一段";
}

function joinChinese(values) {
  return values.slice(0, 3).map((value) => `“${cleanText(value, 24)}”`).join("、");
}

function unique(values) {
  const seen = new Set();
  return safeArray(values).filter((value) => {
    const key = canonical(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function clampInteger(value, min, max, fallback) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function roundOne(value) {
  return Math.round(value * 10) / 10;
}

module.exports = {
  buildConnections,
  buildPuzzle,
  buildCuratorQuestion,
  buildFeaturedRoute
};
