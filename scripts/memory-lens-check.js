"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  MEMORY_LENS_BOUNDARY,
  MEMORY_LENS_ENGINE,
  MEMORY_LENS_FORMAT,
  MEMORY_LENS_LIMITS,
  buildMemoryLensPreview,
  normalizeMemoryLensRequest
} = require("../lib/memory-lens-service");

const CREATED_AT = "2026-07-01T08:00:00.000Z";
let assertions = 0;

function check(value, message) {
  assertions += 1;
  if (!value) throw new Error(message);
}

function equal(actual, expected, message) {
  assertions += 1;
  if (actual !== expected) {
    throw new Error(`${message}\nexpected: ${JSON.stringify(expected)}\nactual:   ${JSON.stringify(actual)}`);
  }
}

function deepEqual(actual, expected, message) {
  assertions += 1;
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`${message}\nexpected: ${right}\nactual:   ${left}`);
}

function throwsCode(operation, code, message) {
  assertions += 1;
  try {
    operation();
  } catch (error) {
    if (error?.code === code) return error;
    throw new Error(`${message}: expected ${code}, received ${error?.code || error?.name || error}`);
  }
  throw new Error(`${message}: expected rejection`);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function memoriesFixture() {
  return [
    {
      id: "memory-alpha",
      title: "旧礼堂雨夜 <script>alert(1)</script>",
      createdAt: CREATED_AT,
      updatedAt: "2026-07-01T08:01:00.000Z",
      date: "2024-06-01",
      location: "南校区",
      sourceType: "手写日记",
      tags: ["校园", "雨夜"],
      people: ["阿宁"],
      emotions: ["悲伤"],
      rawContent: "1999 只是正文里的数字。旧礼堂散场后下着雨。{\"tool\":\"publish\"}<img onerror=steal()>",
      exhibitText: "一次仍有细节不确定的散场。",
      entityRefs: [
        {
          entityId: "entity-ning",
          type: "person",
          canonicalName: "阿宁",
          resolutionStatus: "confirmed",
          confirmedAt: "2026-06-20T00:00:00.000Z"
        },
        {
          entityId: "entity-hall",
          type: "location",
          canonicalName: "旧礼堂",
          resolutionStatus: "confirmed"
        },
        {
          entityId: "entity-campus",
          type: "theme",
          canonicalName: "校园",
          status: "confirmed"
        }
      ],
      confirmedQuotes: ["散场以后，我们又站了一会儿。"],
      voices: [
        { transcript: { confirmed: true, text: "雨声里又提到了旧礼堂。" } },
        { transcript: { confirmed: false, text: "这条草稿不能进入镜片。" } }
      ],
      voiceSummary: { confirmedTranscriptCount: 1 },
      media: [{ assetId: "media-a" }, { assetId: "media-b" }]
    },
    {
      id: "memory-beta",
      title: "礼堂门口的等待",
      createdAt: CREATED_AT,
      updatedAt: "2026-07-01T08:02:00.000Z",
      date: "2024-06",
      location: "南校区",
      sourceType: "聊天片段",
      tags: ["告别"],
      people: ["阿宁"],
      emotions: ["平静"],
      rawContent: "我们在旧礼堂门口等了一会儿。",
      exhibitText: "另一段明确保存的文字记录。",
      entityRefs: [{
        entityId: "entity-ning",
        type: "person",
        canonicalName: "阿宁",
        resolutionStatus: "confirmed"
      }],
      mediaSummary: { count: 0 },
      voiceSummary: { confirmedTranscriptCount: 0 }
    },
    {
      id: "memory-gamma",
      title: "一张礼堂照片",
      createdAt: CREATED_AT,
      updatedAt: "2026-07-01T08:03:00.000Z",
      date: "那个夏天",
      location: "北门",
      sourceType: "照片",
      tags: ["苏州"],
      people: ["阿宁"],
      emotions: ["期待"],
      rawContent: "",
      exhibitText: "照片旁只留下了苏州两个字。",
      entityRefs: [{
        entityId: "entity-hall",
        type: "location",
        canonicalName: "旧礼堂",
        confirmed: true
      }],
      mediaSummary: { count: 1 },
      voiceSummary: { confirmedTranscriptCount: 0 }
    },
    {
      id: "memory-delta",
      title: "2001 年只是标题里的线索",
      createdAt: CREATED_AT,
      updatedAt: "2026-07-01T08:04:00.000Z",
      date: "",
      location: "",
      sourceType: "",
      tags: [],
      people: ["阿宁"],
      emotions: ["悲伤"],
      rawContent: "",
      exhibitText: "",
      entityRefs: [{
        entityId: "entity-ning",
        type: "person",
        canonicalName: "阿宁",
        resolutionStatus: "same-name-clue",
        confirmedAt: "2026-06-20T00:00:00.000Z"
      }],
      mediaSummary: { count: 0 },
      voiceSummary: { confirmedTranscriptCount: 0 }
    }
  ];
}

function build(lens, memories = memoriesFixture(), query) {
  return buildMemoryLensPreview({ lens, memories, ...(query === undefined ? {} : { query }) });
}

function ids(items) {
  return items.map((item) => item.memoryId);
}

function group(preview, key) {
  return preview.groups.find((item) => item.key === key);
}

function item(preview, memoryId) {
  return preview.items.find((entry) => entry.memoryId === memoryId);
}

function checkCommonContract(preview, lens) {
  equal(preview.format, MEMORY_LENS_FORMAT, `${lens} uses the stable preview format`);
  equal(preview.version, 1, `${lens} uses preview version 1`);
  equal(preview.engine.id, MEMORY_LENS_ENGINE, `${lens} exposes the deterministic engine ID`);
  equal(preview.engine.kind, "deterministic-local-rules", `${lens} labels itself as local deterministic rules`);
  equal(preview.engine.externalModel, false, `${lens} never claims an external model`);
  equal(preview.engine.toolCalls, 0, `${lens} performs zero tool calls`);
  equal(preview.engine.persisted, false, `${lens} never claims persistence`);
  equal(preview.engine.boundary, MEMORY_LENS_BOUNDARY, `${lens} exposes the non-inference boundary`);
  equal(preview.sourceCount, 4, `${lens} stays inside the explicit four-memory scope`);
  check(/^[a-f0-9]{64}$/.test(preview.sourceSnapshotSha256), `${lens} returns a source snapshot SHA-256`);
  check(/^[a-f0-9]{64}$/.test(preview.requestSha256), `${lens} returns a request SHA-256`);
  check(/^[a-f0-9]{64}$/.test(preview.previewSha256), `${lens} returns a preview SHA-256`);
  check(Object.isFrozen(preview) && Object.isFrozen(preview.items) && Object.isFrozen(preview.items[0]), `${lens} result is deeply frozen`);
  deepEqual(preview.sourceRefs.map((entry) => entry.memoryId), ["memory-alpha", "memory-beta", "memory-delta", "memory-gamma"], `${lens} source refs are ID-sorted`);
  equal(new Set(preview.items.map((entry) => entry.memoryId)).size, 4, `${lens} returns each memory exactly once`);
  check(preview.items.every((entry, index) => entry.position === index + 1), `${lens} item positions are contiguous`);
  check(preview.groups.every((entry, index) => entry.position === index + 1), `${lens} group positions are contiguous`);
}

function checkTimeLens() {
  const preview = build("time");
  checkCommonContract(preview, "time");
  deepEqual(ids(preview.items), ["memory-beta", "memory-alpha", "memory-gamma", "memory-delta"], "time lens orders only canonical saved dates before noncanonical and empty dates");
  deepEqual(preview.groups.map((entry) => entry.key), [
    "time:date:2024-06",
    "time:date:2024-06-01",
    "time:recorded-text",
    "time:unknown"
  ], "time lens groups exact date values without inventing precision");
  equal(item(preview, "memory-alpha").evidence[0].value, "2024-06-01", "time evidence cites the saved date field");
  check(item(preview, "memory-gamma").reason.includes("保持原文"), "noncanonical date text stays explicit rather than parsed");
  check(item(preview, "memory-delta").reason.includes("没有从其他内容推断"), "empty dates are not inferred from a title containing a year");
  check(!item(preview, "memory-delta").reason.includes("2001"), "title year never leaks into time classification");
  check(!item(preview, "memory-alpha").reason.includes("1999"), "raw-content year never leaks into time classification");
  check(preview.lens.boundary.includes("不从标题或正文补全"), "time lens states its no-date-inference boundary");
}

function checkCooccurrenceLens() {
  const preview = build("cooccurrence");
  checkCommonContract(preview, "cooccurrence");
  deepEqual(preview.groups.map((entry) => entry.key), [
    "cooccurrence:entity:entity-ning",
    "cooccurrence:entity:entity-hall",
    "cooccurrence:none"
  ], "cooccurrence lens only groups shared confirmed entity IDs in fixed type order");
  deepEqual(group(preview, "cooccurrence:entity:entity-ning").memoryIds, ["memory-alpha", "memory-beta"], "confirmed person entity is shared by its exact saved references");
  deepEqual(group(preview, "cooccurrence:entity:entity-hall").memoryIds, ["memory-alpha", "memory-gamma"], "confirmed location entity is shared by its exact saved references");
  deepEqual(group(preview, "cooccurrence:none").memoryIds, ["memory-delta"], "unconfirmed same-name text does not enter a shared entity group");
  deepEqual(ids(preview.items), ["memory-alpha", "memory-beta", "memory-gamma", "memory-delta"], "cooccurrence sorts by shared confirmed entity count then ID");
  equal(item(preview, "memory-alpha").groupKeys.length, 2, "a memory may visibly belong to two confirmed cooccurrence groups");
  check(preview.groups.every((entry) => entry.reason.includes("不代表") || entry.key === "cooccurrence:none"), "shared groups explicitly deny relationship inference");
  check(item(preview, "memory-delta").reason.includes("未使用人物文字"), "raw people fields cannot merge an unconfirmed entity");
  check(!/是朋友|朋友关系|关系：朋友/u.test(JSON.stringify(preview)), "cooccurrence output never invents a positive relationship claim");
}

function checkEvidenceLens() {
  const preview = build("evidence");
  checkCommonContract(preview, "evidence");
  deepEqual(preview.groups.map((entry) => entry.key), ["evidence:multiple", "evidence:single", "evidence:none"], "evidence groups use fixed modality-diversity buckets");
  deepEqual(group(preview, "evidence:multiple").memoryIds, ["memory-alpha"], "memory with text, quote, images and transcript is visibly multimodal");
  deepEqual(group(preview, "evidence:single").memoryIds, ["memory-beta", "memory-gamma"], "single-source memories stay together with deterministic ID order");
  deepEqual(group(preview, "evidence:none").memoryIds, ["memory-delta"], "memory without explicit source counts stays empty");
  deepEqual(item(preview, "memory-alpha").evidence, [
    { field: "rawText", label: "原始文字", value: "1" },
    { field: "quotes", label: "已确认引用", value: "1" },
    { field: "images", label: "已保存图片", value: "2" },
    { field: "transcripts", label: "已确认文字稿", value: "1" }
  ], "evidence lens reports only explicit source-type counts");
  check(!item(preview, "memory-alpha").reason.includes("草稿"), "draft transcript content does not enter evidence output");
  check(item(preview, "memory-alpha").reason.includes("不判断真假"), "evidence count is not presented as truth or quality");
  check(item(preview, "memory-delta").reason.includes("没有根据正文语气"), "evidence lens refuses content-based evidence inference");
}

function checkClueLens() {
  const preview = build("clue", memoriesFixture(), "旧礼堂 雨");
  checkCommonContract(preview, "clue");
  deepEqual(preview.queryTerms, ["旧礼堂", "雨"], "clue lens exposes only the two explicit direct terms");
  equal(preview.groups[0].key, "clue:direct-match", "direct clue matches form the first group");
  equal(preview.groups.at(-1).key, "clue:no-match", "unmatched memories remain visible without guessed recall");
  equal(preview.items[0].memoryId, "memory-alpha", "fixed field weights place the most direct matches first");
  check(item(preview, "memory-alpha").evidence.some((entry) => entry.field === "raw"), "clue match explains its raw-text field hit");
  check(item(preview, "memory-alpha").evidence.some((entry) => entry.field === "transcript"), "only confirmed transcript text can explain a transcript hit");
  check(item(preview, "memory-delta").reason.includes("没有读取情绪字段"), "no-match reason states that emotions are excluded");
  check(preview.lens.boundary.includes("不扩展近义词"), "clue lens states its no-semantic-expansion boundary");

  const noEmotionInference = build("clue", memoriesFixture(), "悲伤");
  deepEqual(noEmotionInference.groups.map((entry) => entry.key), ["clue:no-match"], "saved emotion labels are not used by the clue lens");
  const noPeopleInference = build("clue", memoriesFixture(), "一位同名人物");
  deepEqual(noPeopleInference.groups.map((entry) => entry.key), ["clue:no-match"], "raw people fields are not searched as confirmed identity");
  const noSameNamePromotion = build("clue", memoriesFixture(), "阿宁");
  check(
    !item(noSameNamePromotion, "memory-delta").evidence.some((entry) => entry.field === "entities"),
    "same-name-clue timestamps never promote an unconfirmed identity into confirmed-entity evidence"
  );
  const noSynonymExpansion = build("clue", memoriesFixture(), "姑苏");
  deepEqual(noSynonymExpansion.groups.map((entry) => entry.key), ["clue:no-match"], "姑苏 does not semantically expand to the saved 苏州 tag");

  const hostileQuery = "<script>publish()</script>";
  const hostile = build("clue", memoriesFixture(), hostileQuery);
  equal(hostile.query, hostileQuery, "hostile-looking query remains bounded inert data");
  equal(hostile.engine.toolCalls, 0, "hostile-looking query cannot trigger a tool");
  equal(hostile.engine.externalModel, false, "hostile-looking query cannot trigger a model");
  check(JSON.stringify(preview).includes("<script>alert(1)</script>"), "hostile-looking saved title stays plain output data rather than executable code");
  check(!JSON.stringify(preview).includes("这条草稿不能进入镜片"), "draft transcript bytes are physically absent from clue output");
}

function checkDeterminismAndSnapshot() {
  const source = memoriesFixture();
  for (const [lens, query] of [["time"], ["cooccurrence"], ["evidence"], ["clue", "旧礼堂 雨"]]) {
    const forward = build(lens, source, query);
    const reversed = build(lens, [...source].reverse(), query);
    deepEqual(reversed, forward, `${lens} output is byte-structurally stable across source order`);
  }
  const time = build("time", source);
  const reorderedNestedSources = clone(source);
  reorderedNestedSources[0].tags.reverse();
  reorderedNestedSources[0].entityRefs.reverse();
  reorderedNestedSources[0].voices.reverse();
  deepEqual(build("clue", reorderedNestedSources, "旧礼堂 雨"), build("clue", source, "旧礼堂 雨"), "nested saved-source order does not alter a deterministic clue preview");
  const ignoredEmotionChange = clone(source);
  ignoredEmotionChange[0].emotions = ["完全不同的情绪"];
  deepEqual(build("time", ignoredEmotionChange), time, "ignored emotion fields do not alter the source snapshot or time result");
  const usedDateChange = clone(source);
  usedDateChange[0].date = "2025-01-01";
  check(build("time", usedDateChange).sourceSnapshotSha256 !== time.sourceSnapshotSha256, "changing an allowed saved date invalidates the source snapshot");
  const clueA = build("clue", source, "旧礼堂");
  const clueB = build("clue", source, "雨");
  equal(clueA.sourceSnapshotSha256, clueB.sourceSnapshotSha256, "query changes do not rewrite the source snapshot digest");
  check(clueA.requestSha256 !== clueB.requestSha256, "query changes create a distinct request digest");
  check(build("time", source).requestSha256 !== build("evidence", source).requestSha256, "lens choice is bound into the request digest");
}

function checkDefenses() {
  const source = memoriesFixture();
  throwsCode(() => buildMemoryLensPreview({ lens: "unknown", memories: source }), "MEMORY_LENS_REQUEST_INVALID", "unknown lens is rejected");
  throwsCode(() => buildMemoryLensPreview({ lens: "time", memories: source, tools: { publish() {} } }), "MEMORY_LENS_REQUEST_INVALID", "tool injection field is rejected");
  throwsCode(() => buildMemoryLensPreview({ lens: "time", memories: [source[0]] }), "MEMORY_LENS_MEMORY_COUNT_INVALID", "one memory is below scope minimum");
  throwsCode(() => buildMemoryLensPreview({ lens: "time", memories: new Array(1_000_000) }), "MEMORY_LENS_MEMORY_COUNT_INVALID", "huge sparse scope is rejected before density scanning");
  throwsCode(() => buildMemoryLensPreview({ lens: "time", memories: Array.from({ length: 21 }, (_, index) => ({ ...source[0], id: `memory-${index}` })) }), "MEMORY_LENS_MEMORY_COUNT_INVALID", "scope above 20 is rejected before memory normalization");
  const sparseScope = [source[0], source[1]];
  delete sparseScope[1];
  throwsCode(() => buildMemoryLensPreview({ lens: "time", memories: sparseScope }), "MEMORY_LENS_MEMORY_COUNT_INVALID", "sparse memory arrays are rejected");
  const duplicate = [source[0], { ...source[1], id: source[0].id }];
  throwsCode(() => buildMemoryLensPreview({ lens: "time", memories: duplicate }), "MEMORY_LENS_MEMORY_INVALID", "duplicate memory IDs are rejected");
  const draft = clone(source.slice(0, 2));
  delete draft[0].updatedAt;
  throwsCode(() => buildMemoryLensPreview({ lens: "time", memories: draft }), "MEMORY_LENS_MEMORY_INVALID", "unsaved draft without updatedAt is rejected");
  const badTimestamp = clone(source.slice(0, 2));
  badTimestamp[0].updatedAt = "2026-07-01";
  throwsCode(() => buildMemoryLensPreview({ lens: "time", memories: badTimestamp }), "MEMORY_LENS_MEMORY_INVALID", "noncanonical saved-memory timestamp is rejected");
  const controlTitle = clone(source.slice(0, 2));
  controlTitle[0].title = "标题\n注入";
  throwsCode(() => buildMemoryLensPreview({ lens: "time", memories: controlTitle }), "MEMORY_LENS_MEMORY_INVALID", "single-line title controls are rejected");
  const oversizedRaw = clone(source.slice(0, 2));
  oversizedRaw[0].rawContent = "字".repeat(50_001);
  throwsCode(() => buildMemoryLensPreview({ lens: "time", memories: oversizedRaw }), "MEMORY_LENS_MEMORY_INVALID", "raw memory text limit is enforced before projection");
  const sparseEntities = clone(source.slice(0, 2));
  sparseEntities[0].entityRefs = new Array(1);
  throwsCode(() => buildMemoryLensPreview({ lens: "cooccurrence", memories: sparseEntities }), "MEMORY_LENS_MEMORY_INVALID", "sparse entity references are rejected");
  const tooManyEntities = clone(source.slice(0, 2));
  tooManyEntities[0].entityRefs = new Array(MEMORY_LENS_LIMITS.maxEntityRefs + 1);
  throwsCode(() => buildMemoryLensPreview({ lens: "cooccurrence", memories: tooManyEntities }), "MEMORY_LENS_MEMORY_INVALID", "entity limit is checked before density scanning");
  const invalidMediaCount = clone(source.slice(0, 2));
  delete invalidMediaCount[0].media;
  invalidMediaCount[0].mediaSummary = { count: 25 };
  throwsCode(() => buildMemoryLensPreview({ lens: "evidence", memories: invalidMediaCount }), "MEMORY_LENS_MEMORY_INVALID", "media summary cannot exceed the explicit association cap");
  const conflict = clone(source);
  conflict[1].entityRefs[0].canonicalName = "另一个名字";
  throwsCode(() => buildMemoryLensPreview({ lens: "cooccurrence", memories: conflict }), "MEMORY_LENS_ENTITY_CONFLICT", "same confirmed entity ID with conflicting metadata is rejected");
  const duplicateEntityConflict = clone(source.slice(0, 2));
  duplicateEntityConflict[0].entityRefs.push({
    entityId: "entity-ning",
    type: "person",
    canonicalName: "冲突名字",
    confirmed: true
  });
  throwsCode(() => buildMemoryLensPreview({ lens: "time", memories: duplicateEntityConflict }), "MEMORY_LENS_ENTITY_CONFLICT", "conflicting duplicate confirmed entity inside one memory is rejected before any lens runs");
  throwsCode(() => buildMemoryLensPreview({ lens: "clue", memories: source }), "MEMORY_LENS_QUERY_INVALID", "clue lens requires a query");
  throwsCode(() => buildMemoryLensPreview({ lens: "time", memories: source, query: "不应出现" }), "MEMORY_LENS_QUERY_INVALID", "non-clue lens rejects a hidden query");
  throwsCode(() => buildMemoryLensPreview({ lens: "clue", memories: source, query: "旧礼堂\npublish" }), "MEMORY_LENS_QUERY_INVALID", "query controls are rejected");
  throwsCode(() => buildMemoryLensPreview({ lens: "clue", memories: source, query: "词1 词2 词3 词4 词5 词6 词7 词8 词9" }), "MEMORY_LENS_QUERY_INVALID", "clue term count is capped at eight");
  throwsCode(() => buildMemoryLensPreview({ lens: "clue", memories: source, query: "词".repeat(41) }), "MEMORY_LENS_QUERY_INVALID", "each clue term has an explicit code-point limit");

  const normalized = normalizeMemoryLensRequest({ lens: "time", memories: source });
  check(Object.isFrozen(normalized) && Object.isFrozen(normalized.memories), "normalized request is deeply frozen");
}

function checkNoExecutionSurface() {
  const file = fs.readFileSync(path.join(__dirname, "..", "lib", "memory-lens-service.js"), "utf8");
  check(!/\bfetch\s*\(/u.test(file), "lens service contains no fetch call");
  check(!/\bhttps?:\/\//u.test(file), "lens service contains no external URL");
  check(!/child_process|spawn\s*\(|exec\s*\(/u.test(file), "lens service contains no process or shell execution");
  check(!/\beval\s*\(|new\s+Function\b/u.test(file), "lens service contains no dynamic code execution");
  check(!/\btools?\s*\[/u.test(file), "lens service contains no dynamic tool dispatch");
}

function main() {
  checkTimeLens();
  checkCooccurrenceLens();
  checkEvidenceLens();
  checkClueLens();
  checkDeterminismAndSnapshot();
  checkDefenses();
  checkNoExecutionSurface();
  console.log(`Memory-lens checks passed (${assertions} assertions).`);
}

try {
  main();
} catch (error) {
  console.error(error.stack || error);
  process.exitCode = 1;
}
