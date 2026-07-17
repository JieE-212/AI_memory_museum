"use strict";

const assert = require("node:assert/strict");
const {
  buildSearchPlan,
  codePointLength,
  compileFtsQuery,
  escapeLikePattern,
  isShortClueTerm,
  mergeClueCandidates,
  normalizeClueText,
  scoreClueCandidate,
  splitClueTerms
} = require("../lib/clue-service");
const {
  CLUE_BACKUP_LIMITS,
  CLUE_REDACTED_NOTE,
  buildClueBackup,
  remapClueBackup,
  validateClueBackup
} = require("../lib/clue-backup");

const TIMESTAMP = "2026-07-17T00:00:00.000Z";
let assertions = 0;

main();

function main() {
  checkNormalizationAndSearchPlan();
  checkExplainableScoring();
  checkCandidateMerge();
  checkFullAndPartialBackup();
  checkRedactedBackup();
  checkBackupDefenses();
  checkRemapPlan();
  console.log(`Clue service checks passed: ${assertions} assertions.`);
}

function checkNormalizationAndSearchPlan() {
  equal(normalizeClueText("  ＡＢＣ　 旧\t站\n"), "ABC 旧 站", "检索文本执行 NFKC 并折叠 Unicode 空白");
  deepEqual(splitClueTerms(" ＡＢＣ abc  外婆 "), ["ABC", "外婆"], "拆词保持首次顺序并按规范化大小写去重");
  equal(codePointLength("𠮷野家"), 3, "字符长度按 Unicode code point 而不是 UTF-16 code unit 计算");
  ok(isShortClueTerm("苏州") && !isShortClueTerm("旧站台"), "中文 2 字走短词分支而 3 字进入 trigram FTS");
  ok(isShortClueTerm("𠮷野") && !isShortClueTerm("𠮷野家"), "补充平面字符同样按 code point 判断 1–2 字边界");
  throwsCode(() => splitClueTerms("旧站\u0000台"), "CLUE_QUERY_INVALID", "NUL 控制字符在生成数据库参数前被拒绝");
  throwsCode(
    () => splitClueTerms(Array.from({ length: 21 }, (_, index) => `词${index}`).join(" ")),
    "CLUE_QUERY_LIMIT_EXCEEDED",
    "查询拆词数量有明确上限"
  );

  equal(
    compileFtsQuery(["苏州", "上海站", 'foo" OR title:*']),
    '"上海站" OR "foo"" OR title:*"',
    "FTS 只接收至少 3 字的完整短语并把双引号留在短语内部"
  );
  equal(compileFtsQuery(["一", "苏州"]), "", "全部为 1–2 字时不生成无法命中的 trigram MATCH 表达式");
  equal(escapeLikePattern("100%_\\记忆"), "100\\%\\_\\\\记忆", "LIKE 参数转义百分号、下划线和转义符自身");

  const plan = buildSearchPlan(" 苏州 旧站台 100%_\\ ", ["姑苏", "老站台", 'x" OR y:*', "旧站台"]);
  deepEqual(plan.directTerms, ["苏州", "旧站台", "100%_\\"], "搜索计划保留直接输入词");
  deepEqual(plan.expandedTerms, ["姑苏", "老站台", 'x" OR y:*'], "规则扩展与直接词分离且不重复直接词");
  ok(plan.ftsQuery.includes('"旧站台"') && plan.ftsQuery.includes('"x"" OR y:*"'), "恶意 FTS 字符始终处于转义短语中");
  equal(plan.likeTerms.find((item) => item.term === "100%_\\").pattern, "%100\\%\\_\\\\%", "FTS 兜底 LIKE 只输出可参数化 pattern");
  ok(plan.likeTerms.every((item) => Object.keys(item).sort().join(",") === "direct,pattern,short,term"), "LIKE 计划不携带 SQL 片段或任意字段");
  equal(plan.shortQueryFallback, true, "包含中文 2 字词时公开短词兜底标记");
  deepEqual(
    buildSearchPlan("外婆 杭州站", { 外婆: ["姥姥"], 无关: ["泄漏"] }).expandedTerms,
    ["姥姥"],
    "按直接词索引的规则只扩展实际查询词"
  );
  deepEqual(buildSearchPlan("   ").directTerms, [], "空白查询形成安全空计划");
}

function checkExplainableScoring() {
  const candidate = {
    memoryId: "memory-a",
    title: "旧站台的夏天",
    exhibitText: "一段回家路",
    rawContent: "在旧站台和外婆重逢",
    location: "杭州",
    people: ["外婆"],
    tags: ["回家"],
    emotions: "温暖",
    source: "手写日记",
    directTerms: ["外婆", "旧站台"],
    expandedTerms: ["杭州"],
    entityMatches: [
      { entityId: "entity-grandmother", type: "person", canonicalName: "外婆", confirmedAt: TIMESTAMP },
      { entityId: "entity-unconfirmed", type: "theme", canonicalName: "夏天", status: "suggested" }
    ]
  };
  const scored = scoreClueCandidate(candidate);
  equal(scored.memoryId, "memory-a", "打分结果稳定公开展品 ID");
  equal(scored.score, 23.88, "字段权重、规则扩展 0.72 系数与确认实体额外分按固定规则计算");
  deepEqual(scored.matchedTerms, ["外婆", "旧站台", "杭州"], "匹配词按直接词后扩展词稳定输出");
  deepEqual(scored.matchedFields, ["title", "raw", "location", "people"], "匹配字段按固定字段优先级稳定输出");
  equal(scored.confidence, "strong", "多项直接证据形成 strong 规则标签而非概率");
  ok(scored.evidence.some((item) => item.kind === "entity" && item.entityId === "entity-grandmother"), "已确认实体形成独立可解释证据");
  ok(!JSON.stringify(scored).includes("entity-unconfirmed"), "未确认实体不参与分数、理由或证据");
  ok(scored.evidence.some((item) => item.kind === "rule-expansion" && item.term === "杭州"), "规则扩展证据与直接命中明确分离");
  ok(scored.evidence.every(hasOnlyEvidenceKeys), "证据只含 kind/field/term/label 和可选 entityId 白名单");
  ok(!/(概率|embedding|向量)/iu.test(scored.reason), "理由不宣称概率、embedding 或向量能力");

  const ruleOnly = scoreClueCandidate({
    memoryId: "memory-rule",
    title: "老车站",
    directTerms: ["旧站台"],
    expandedTerms: ["老车站"]
  });
  equal(ruleOnly.score, 4.32, "单条标题规则扩展严格使用 title 6 × 0.72");
  equal(ruleOnly.directEvidenceCount, 0, "规则扩展不冒充直接证据");
  equal(ruleOnly.confidence, "medium", "规则证据使用可解释等级而非伪概率");

  const confirmedVoice = scoreClueCandidate({
    memoryId: "memory-voice",
    voiceText: "雨声里说起旧站台",
    directTerms: ["旧站台"],
    expandedTerms: []
  });
  deepEqual(confirmedVoice.matchedFields, ["voice"], "人工确认后的声音文字形成独立检索字段");
  ok(confirmedVoice.evidence[0].label.includes("确认文字稿"), "声音命中明确说明来自确认文字稿");

  const empty = scoreClueCandidate({ memoryId: "memory-empty", title: "雨夜", directTerms: ["晴天"], expandedTerms: [] });
  equal(empty.score, 0, "没有可核验证据时不凭 FTS rank 臆造分数");
  equal(empty.confidence, "weak", "零证据明确落入 weak 规则标签");
  equal(empty.evidence.length, 0, "零证据候选不生成虚构依据");

  const simplifiedEntity = scoreClueCandidate({
    memoryId: "memory-entity-name",
    entityNames: ["阿宁"],
    directTerms: ["阿宁"],
    expandedTerms: []
  });
  equal(simplifiedEntity.score, 8, "数据库已确认的简化实体名仍使用 manual 4 + 确认 4 的透明权重");
  equal(simplifiedEntity.evidence[0].kind, "entity", "简化实体候选仍标记为实体证据");
}

function checkCandidateMerge() {
  const input = {
    directTerms: ["旧站台"],
    expandedTerms: [],
    ftsCandidates: [
      { memoryId: "memory-b", title: "旧站台", ftsRank: -2 },
      { memoryId: "memory-a", title: "旧站台", ftsRank: -1 }
    ],
    likeCandidates: [
      { memoryId: "memory-a", rawContent: "旧站台的钟声" },
      { memoryId: "memory-b", rawContent: "无额外命中" }
    ],
    entityCandidates: [
      {
        memoryId: "memory-a",
        entityMatches: [{ entityId: "entity-station", type: "theme", canonicalName: "旧站台", confirmedAt: TIMESTAMP }]
      }
    ]
  };
  const merged = mergeClueCandidates(input);
  equal(merged.length, 2, "FTS、LIKE 和实体召回的同一展品只保留一项");
  equal(merged[0].memoryId, "memory-a", "合并后按可解释分数降序排列");
  deepEqual(merged[0].retrievalSources, ["entity", "fts", "like"], "召回来源去重并稳定排序");
  ok(merged[0].evidence.some((item) => item.kind === "entity"), "实体候选证据进入统一结果");

  const reversed = mergeClueCandidates({
    ...input,
    ftsCandidates: [...input.ftsCandidates].reverse(),
    likeCandidates: [...input.likeCandidates].reverse(),
    entityCandidates: [...input.entityCandidates].reverse()
  });
  deepEqual(projectResults(reversed), projectResults(merged), "候选来源顺序不会改变最终排序和解释");

  const ties = mergeClueCandidates({
    directTerms: ["车站"],
    expandedTerms: [],
    ftsCandidates: [
      { memoryId: "memory-z", title: "车站" },
      { memoryId: "memory-c", title: "车站" }
    ]
  });
  deepEqual(ties.map((item) => item.memoryId), ["memory-c", "memory-z"], "分数和直接证据数相同时按 memoryId 稳定排序");
}

function checkFullAndPartialBackup() {
  const source = backupSource();
  const full = buildClueBackup(source, "full", ["memory-a", "memory-b"]);
  deepEqual(Object.keys(full), ["mode", "schemaVersion", "entities"], "完整备份顶层字段固定");
  equal(full.schemaVersion, 7, "实体完整备份固定声明 schemaVersion 7");
  deepEqual(full.entities.map((entity) => entity.id), ["entity-location", "entity-person", "entity-theme"], "完整备份按实体 ID 确定性排序");
  ok(full.entities.every((entity) => sameKeys(entity, ["id", "type", "canonicalName", "aliases", "memoryLinks"])), "实体对象严格使用固定字段");
  ok(full.entities.flatMap((entity) => entity.aliases).every((alias) => sameKeys(alias, ["id", "alias", "source", "confirmedAt", "createdAt", "updatedAt"])), "别名对象严格使用固定字段");
  ok(full.entities.flatMap((entity) => entity.memoryLinks).every((link) => sameKeys(link, ["memoryId", "sourceField", "mentionText", "confirmedAt", "createdAt", "updatedAt"])), "展品关系严格使用固定字段");
  equal(validateClueBackup(full, ["memory-a", "memory-b"]), true, "完整备份通过独立严格验证");

  const partial = buildClueBackup(source, "full", ["memory-a"]);
  deepEqual(partial.entities.map((entity) => entity.id), ["entity-person", "entity-theme"], "局部导出移除没有边界内关系的实体");
  ok(partial.entities.flatMap((entity) => entity.memoryLinks).every((link) => link.memoryId === "memory-a"), "局部导出物理移除边界之外的逐条关系");
  equal(partial.entities.find((entity) => entity.id === "entity-person").aliases.length, 1, "保留下来的实体继续携带其已确认别名");
  deepEqual(buildClueBackup(source, "full", []).entities, [], "空 sourceMemoryIds 生成明确的空实体图");

  const reversedSource = {
    entities: [...source.entities].reverse(),
    aliases: [...source.aliases].reverse(),
    memoryLinks: [...source.memoryLinks].reverse()
  };
  deepEqual(buildClueBackup(reversedSource, "full", ["memory-a", "memory-b"]), full, "源查询顺序不影响完整备份字节级结构");
}

function checkRedactedBackup() {
  const redacted = buildClueBackup(backupSource(), "redacted", ["memory-a", "memory-b"]);
  deepEqual(
    Object.keys(redacted),
    ["mode", "entityCount", "personCount", "locationCount", "themeCount", "note"],
    "脱敏摘要顶层只保留固定计数字段与固定说明"
  );
  deepEqual(
    [redacted.entityCount, redacted.personCount, redacted.locationCount, redacted.themeCount],
    [3, 1, 1, 1],
    "脱敏摘要只统计三类实体"
  );
  equal(redacted.note, CLUE_REDACTED_NOTE, "脱敏说明为不可注入私人内容的固定常量");
  const serialized = JSON.stringify(redacted);
  for (const secret of ["外婆", "杭州", "回家", "entity-person", "alias-grandmother", "memory-a", TIMESTAMP]) {
    ok(!serialized.includes(secret), `脱敏摘要物理排除私人值：${secret}`);
  }
  equal(validateClueBackup(redacted, []), true, "脱敏摘要可以独立严格验证");
  equal(buildClueBackup(backupSource(), "redacted", ["memory-a"]).entityCount, 2, "局部脱敏计数同样遵守 sourceMemoryIds 边界");

  throwsCode(
    () => validateClueBackup({ ...redacted, entities: [] }, []),
    "CLUE_BACKUP_INVALID",
    "标为脱敏的备份不能夹带逐条实体"
  );
  throwsCode(
    () => validateClueBackup({ ...redacted, note: `${redacted.note} 外婆` }, []),
    "CLUE_BACKUP_INVALID",
    "脱敏 note 不能被用作名称泄漏旁路"
  );
  throwsCode(
    () => validateClueBackup({ ...redacted, personCount: 2 }, []),
    "CLUE_BACKUP_INVALID",
    "脱敏分类计数必须与实体总数一致"
  );
}

function checkBackupDefenses() {
  const full = buildClueBackup(backupSource(), "full", ["memory-a", "memory-b"]);
  const extraTop = structuredClone(full);
  extraTop.privateNames = ["外婆"];
  throwsCode(() => validateClueBackup(extraTop, ["memory-a", "memory-b"]), "CLUE_BACKUP_INVALID", "完整备份拒绝顶层额外字段");

  const extraEntity = structuredClone(full);
  extraEntity.entities[0].createdAt = TIMESTAMP;
  throwsCode(() => validateClueBackup(extraEntity, ["memory-a", "memory-b"]), "CLUE_BACKUP_INVALID", "实体对象拒绝合同之外的时间字段");

  const extraAlias = structuredClone(full);
  extraAlias.entities.find((entity) => entity.aliases.length).aliases[0].entityId = "entity-person";
  throwsCode(() => validateClueBackup(extraAlias, ["memory-a", "memory-b"]), "CLUE_BACKUP_INVALID", "嵌套别名拒绝冗余实体引用字段");

  const extraLink = structuredClone(full);
  extraLink.entities[0].memoryLinks[0].confidence = 0.99;
  throwsCode(() => validateClueBackup(extraLink, ["memory-a", "memory-b"]), "CLUE_BACKUP_INVALID", "逐条关系拒绝伪概率字段");

  const outside = structuredClone(full);
  outside.entities[0].memoryLinks[0].memoryId = "memory-outside";
  throwsCode(() => validateClueBackup(outside, ["memory-a", "memory-b"]), "CLUE_BACKUP_REFERENCE_INVALID", "完整备份拒绝边界外展品引用");

  const duplicateEntity = structuredClone(full);
  duplicateEntity.entities.push(structuredClone(duplicateEntity.entities[0]));
  throwsCode(() => validateClueBackup(duplicateEntity, ["memory-a", "memory-b"]), "CLUE_BACKUP_DUPLICATE", "重复实体 ID 被拒绝");

  const duplicateAlias = structuredClone(full);
  const entityWithAlias = duplicateAlias.entities.find((entity) => entity.aliases.length);
  entityWithAlias.aliases.push(structuredClone(entityWithAlias.aliases[0]));
  throwsCode(() => validateClueBackup(duplicateAlias, ["memory-a", "memory-b"]), "CLUE_BACKUP_DUPLICATE", "重复别名 ID 被拒绝");

  const duplicateLink = structuredClone(full);
  duplicateLink.entities[0].memoryLinks.push(structuredClone(duplicateLink.entities[0].memoryLinks[0]));
  throwsCode(() => validateClueBackup(duplicateLink, ["memory-a", "memory-b"]), "CLUE_BACKUP_DUPLICATE", "同一实体的重复展品关系被拒绝");

  const invalidField = structuredClone(full);
  invalidField.entities[0].memoryLinks[0].sourceField = "rawContent";
  throwsCode(() => validateClueBackup(invalidField, ["memory-a", "memory-b"]), "CLUE_BACKUP_INVALID", "关系来源字段只允许 people/location/tags/manual");

  throwsCode(
    () => buildClueBackup({
      entities: backupSource().entities,
      aliases: [],
      memoryLinks: [{ ...memoryLink("missing", "memory-a", "manual", ""), entityId: "missing" }]
    }, "full", ["memory-a"]),
    "CLUE_BACKUP_REFERENCE_INVALID",
    "扁平源数据不能引用未知实体"
  );
  throwsCode(
    () => buildClueBackup(backupSource(), "full", ["memory-a", "memory-a"]),
    "CLUE_BACKUP_DUPLICATE",
    "sourceMemoryIds 边界拒绝重复 ID"
  );
  throwsCode(
    () => buildClueBackup({ entities: Array.from({ length: CLUE_BACKUP_LIMITS.entities + 1 }, (_, index) => ({ id: `entity-${index}`, type: "theme", canonicalName: `主题 ${index}` })) }, "full"),
    "CLUE_BACKUP_LIMIT_EXCEEDED",
    "完整备份在 501 个实体边界拒绝而不是截断"
  );
  throwsCode(
    () => buildClueBackup({
      entities: [{ id: "entity-alias-limit", type: "person", canonicalName: "人物" }],
      aliases: Array.from({ length: CLUE_BACKUP_LIMITS.aliases + 1 }, (_, index) => alias(`alias-${index}`, "entity-alias-limit", `别名 ${index}`)),
      memoryLinks: []
    }, "full"),
    "CLUE_BACKUP_LIMIT_EXCEEDED",
    "完整备份在 2001 个别名边界拒绝而不是截断"
  );
  throwsCode(
    () => buildClueBackup({
      entities: [{ id: "entity-link-limit", type: "theme", canonicalName: "主题" }],
      aliases: [],
      memoryLinks: Array.from({ length: CLUE_BACKUP_LIMITS.memoryLinks + 1 }, (_, index) => ({
        ...memoryLink("entity-link-limit", `memory-${index}`, "manual", ""),
        entityId: "entity-link-limit"
      }))
    }, "full"),
    "CLUE_BACKUP_LIMIT_EXCEEDED",
    "完整备份在 3001 条关系边界拒绝而不是截断"
  );
}

function checkRemapPlan() {
  const full = buildClueBackup(backupSource(), "full", ["memory-a", "memory-b"]);
  const snapshot = JSON.stringify(full);
  const remapped = remapClueBackup(full, {
    memoryIdMap: { "memory-a": "target-a", "memory-b": "target-b" },
    entityIdMap: { "entity-person": "target-person", "entity-location": "target-location", "entity-theme": "target-theme" },
    aliasIdMap: { "alias-grandmother": "target-alias-grandmother", "alias-home": "target-alias-home" }
  });
  equal(JSON.stringify(full), snapshot, "恢复计划不修改源备份");
  deepEqual(remapped.idMap.memories, { "memory-a": "target-a", "memory-b": "target-b" }, "恢复计划公开完整展品 ID 映射");
  deepEqual(remapped.idMap.entities, { "entity-location": "target-location", "entity-person": "target-person", "entity-theme": "target-theme" }, "恢复计划公开完整实体 ID 映射");
  equal(remapped.backup.entities.find((entity) => entity.id === "target-person").aliases[0].id, "target-alias-grandmother", "恢复计划重写别名 ID");
  ok(remapped.backup.entities.flatMap((entity) => entity.memoryLinks).every((link) => link.memoryId.startsWith("target-")), "恢复计划重写全部展品引用");
  equal(validateClueBackup(remapped.backup, ["target-a", "target-b"]), true, "重映射结果可在数据库写入前独立复验");

  const identityIds = remapClueBackup(full, { memoryIdMap: { "memory-a": "target-a", "memory-b": "target-b" } });
  ok(identityIds.backup.entities.some((entity) => entity.id === "entity-person"), "未提供实体/别名映射时使用无碰撞身份计划");

  throwsCode(
    () => remapClueBackup(full, { memoryIdMap: { "memory-a": "target-a" } }),
    "CLUE_BACKUP_MAPPING_MISSING",
    "恢复计划拒绝缺失的展品 ID 映射"
  );
  throwsCode(
    () => remapClueBackup(full, { memoryIdMap: { "memory-a": "target", "memory-b": "target" } }),
    "CLUE_BACKUP_MAPPING_COLLISION",
    "两个源展品不能折叠到同一个目标 ID"
  );
  throwsCode(
    () => remapClueBackup(full, {
      memoryIdMap: { "memory-a": "target-a", "memory-b": "target-b" },
      entityIdMap: { "entity-person": "target-entity", "entity-location": "target-entity" }
    }),
    "CLUE_BACKUP_MAPPING_COLLISION",
    "两个源实体不能折叠到同一个目标 ID"
  );
  throwsCode(
    () => remapClueBackup(full, {
      memoryIdMap: { "memory-a": "target-a", "memory-b": "target-b" },
      aliasIdMap: { "alias-grandmother": "target-alias", "alias-home": "target-alias" }
    }),
    "CLUE_BACKUP_MAPPING_COLLISION",
    "两个源别名不能折叠到同一个目标 ID"
  );
  throwsCode(
    () => remapClueBackup(full, {
      memoryIdMap: { "memory-a": "target-a", "memory-b": "target-b" },
      occupiedEntityIds: ["entity-person"]
    }),
    "CLUE_BACKUP_ID_COLLISION",
    "身份映射命中已有实体 ID 时在写库前拒绝"
  );
  throwsCode(
    () => remapClueBackup(full, {
      memoryIdMap: { "memory-a": "target-a", "memory-b": "target-b" },
      aliasIdMap: { "alias-home": "bad id" }
    }),
    "CLUE_BACKUP_INVALID",
    "恢复计划拒绝非法目标 ID"
  );

  const redacted = buildClueBackup(backupSource(), "redacted", ["memory-a", "memory-b"]);
  deepEqual(
    remapClueBackup(redacted),
    { backup: redacted, idMap: { memories: {}, entities: {}, aliases: {} } },
    "脱敏摘要重映射为明确的零关系计划"
  );
}

function backupSource() {
  return {
    entities: [
      { id: "entity-theme", type: "theme", canonicalName: "回家", internalScore: 99 },
      { id: "entity-person", type: "person", canonicalName: "外婆", privateNote: "不应导出" },
      { id: "entity-location", type: "location", canonicalName: "杭州" }
    ],
    aliases: [
      alias("alias-home", "entity-theme", "归途", "merge"),
      alias("alias-grandmother", "entity-person", "姥姥", "user")
    ],
    memoryLinks: [
      { ...memoryLink("entity-person", "memory-b", "people", "外婆"), entityId: "entity-person" },
      { ...memoryLink("entity-location", "memory-b", "location", "杭州"), entityId: "entity-location" },
      { ...memoryLink("entity-theme", "memory-a", "tags", "回家"), entityId: "entity-theme" },
      { ...memoryLink("entity-person", "memory-a", "manual", "姥姥"), entityId: "entity-person" }
    ]
  };
}

function alias(id, entityId, value, source = "import") {
  return {
    id,
    entityId,
    alias: value,
    source,
    confirmedAt: TIMESTAMP,
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP
  };
}

function memoryLink(entityId, memoryId, sourceField, mentionText) {
  return {
    entityId,
    memoryId,
    sourceField,
    mentionText,
    confirmedAt: TIMESTAMP,
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP
  };
}

function hasOnlyEvidenceKeys(value) {
  const keys = Object.keys(value).sort();
  const withoutEntity = ["field", "kind", "label", "term"];
  const withEntity = ["entityId", ...withoutEntity].sort();
  return deepKeysEqual(keys, value.entityId ? withEntity : withoutEntity);
}

function sameKeys(value, expected) {
  return deepKeysEqual(Object.keys(value).sort(), [...expected].sort());
}

function deepKeysEqual(left, right) {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function projectResults(value) {
  return value.map((item) => ({
    memoryId: item.memoryId,
    score: item.score,
    matchedTerms: item.matchedTerms,
    matchedFields: item.matchedFields,
    confidence: item.confidence,
    reason: item.reason,
    evidence: item.evidence,
    directEvidenceCount: item.directEvidenceCount,
    retrievalSources: item.retrievalSources
  }));
}

function ok(value, message) {
  assertions += 1;
  assert.ok(value, message);
}

function equal(actual, expected, message) {
  assertions += 1;
  assert.equal(actual, expected, message);
}

function deepEqual(actual, expected, message) {
  assertions += 1;
  assert.deepEqual(actual, expected, message);
}

function throwsCode(operation, expectedCode, message) {
  assertions += 1;
  assert.throws(operation, (error) => error?.code === expectedCode, message);
}
