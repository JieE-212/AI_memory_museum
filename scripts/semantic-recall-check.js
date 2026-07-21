"use strict";

const assert = require("node:assert/strict");
const {
  SEMANTIC_RECALL_FORMAT,
  SEMANTIC_RECALL_LIMITS,
  SEMANTIC_RECALL_MODEL,
  buildSemanticRecallSnapshot
} = require("../lib/semantic-recall-service");

let assertions = 0;

function build(memories = fixtureMemories(), voices = fixtureVoices()) {
  return buildSemanticRecallSnapshot({
    memories,
    listVoiceForMemory: (memoryId) => voices.get(memoryId) || []
  });
}

const snapshot = build();
equal(snapshot.format, SEMANTIC_RECALL_FORMAT, "snapshot uses a versioned contract");
equal(snapshot.documentCount, 2, "snapshot covers the complete saved collection");
deepEqual(snapshot.documents.map((item) => item.memoryId), ["memory-a", "memory-b"], "documents have deterministic ID order");
deepEqual(Object.keys(snapshot.documents[0]).sort(), ["confirmedTranscripts", "exhibitText", "memoryId", "rawContent", "tags", "title"].sort(), "document projection has only indexable text fields");
deepEqual(snapshot.documents[0].confirmedTranscripts, ["爷爷撑着蓝伞来接我。"], "only confirmed transcript text enters the snapshot");
const serialized = JSON.stringify(snapshot);
for (const canary of ["草稿文字暗号", "原始音频暗号", "gps-canary", "person-secret", "entity-secret", "provenance-secret"]) {
  ok(!serialized.includes(canary), `snapshot excludes ${canary}`);
}
equal(snapshot.model, SEMANTIC_RECALL_MODEL, "snapshot uses the pinned model contract");
equal(snapshot.model.downloadBytes, 46_979_726, "UI download disclosure is backed by exact static bytes");
equal(snapshot.model.remoteModelsAllowed, false, "remote model loading is explicitly forbidden");
deepEqual(snapshot.boundary.indexedFields, ["title", "exhibitText", "rawContent", "tags", "confirmedTranscripts"], "boundary lists the five allowed source fields");
ok(Object.isFrozen(snapshot) && Object.isFrozen(snapshot.documents) && Object.isFrozen(snapshot.documents[0]), "snapshot is immutable");
ok(/^[a-f0-9]{64}$/u.test(snapshot.collectionFingerprint), "collection fingerprint is SHA-256");

const reordered = build([...fixtureMemories()].reverse());
equal(reordered.collectionFingerprint, snapshot.collectionFingerprint, "source order cannot change the semantic collection fingerprint");
const edited = fixtureMemories();
edited[0].rawContent += " 新增一句。";
notEqual(build(edited).collectionFingerprint, snapshot.collectionFingerprint, "saved text changes invalidate the fingerprint");
const voiceEdited = fixtureVoices();
voiceEdited.get("memory-a")[0].transcript.text = "确认文字稿已经修改。";
notEqual(build(fixtureMemories(), voiceEdited).collectionFingerprint, snapshot.collectionFingerprint, "confirmed transcript changes invalidate the fingerprint");
const draftEdited = fixtureVoices();
draftEdited.get("memory-a")[1].transcript.text = "另一个草稿";
equal(build(fixtureMemories(), draftEdited).collectionFingerprint, snapshot.collectionFingerprint, "draft transcript changes stay outside the index boundary");

const long = fixtureMemories().slice(0, 1);
long[0].title = "题".repeat(200);
long[0].rawContent = "文".repeat(20_000);
long[0].tags = Array.from({ length: 30 }, (_, index) => `标签${index}`);
const bounded = build(long);
equal([...bounded.documents[0].title].length, SEMANTIC_RECALL_LIMITS.titleChars, "title sample is bounded by Unicode characters");
equal([...bounded.documents[0].rawContent].length, SEMANTIC_RECALL_LIMITS.rawContentChars, "raw text sample is bounded");
equal(bounded.documents[0].tags.length, SEMANTIC_RECALL_LIMITS.tags, "tag count is bounded");
ok(bounded.documents[0].rawContent.includes("…") && bounded.documents[0].rawContent.endsWith("文"), "long text sampling keeps both beginning and ending context");

const pressure = build(Array.from({ length: SEMANTIC_RECALL_LIMITS.memories }, (_, index) => ({
  id: `pressure-${index}`,
  title: "题".repeat(500),
  exhibitText: "展".repeat(5_000),
  rawContent: "文".repeat(50_000),
  tags: Array.from({ length: 30 }, (__, tagIndex) => `标签${tagIndex}`.repeat(20))
})));
equal(pressure.documentCount, 500, "maximum collection remains explicitly supported");
ok(pressure.documentUtf8Bytes <= SEMANTIC_RECALL_LIMITS.documentUtf8Bytes, "500 worst-case projections stay inside the aggregate UTF-8 budget");
ok(Buffer.byteLength(JSON.stringify(pressure), "utf8") < 1_100_000, "complete worst-case JSON remains bounded for mobile cloning");

let voiceReads = 0;
throwsCode(() => buildSemanticRecallSnapshot({
  memories: Array.from({ length: SEMANTIC_RECALL_LIMITS.memories + 1 }, (_, index) => ({ id: `m-${index}` })),
  listVoiceForMemory() { voiceReads += 1; return []; }
}), "SEMANTIC_RECALL_CAPACITY_EXCEEDED", "over-capacity collection is rejected");
equal(voiceReads, 0, "capacity rejection happens before any transcript read");
throwsCode(() => build([{ ...fixtureMemories()[0] }, { ...fixtureMemories()[0] }]), "SEMANTIC_RECALL_SOURCE_INVALID", "duplicate memory IDs are rejected");
assert.throws(() => buildSemanticRecallSnapshot({ memories: fixtureMemories(), listVoiceForMemory: () => Promise.resolve([]) }), /must be synchronous/u);
assertions += 1;

console.log(`Semantic recall core checks passed (${assertions} assertions).`);

function fixtureMemories() {
  return [
    { id: "memory-b", title: "河边散步", exhibitText: "雨停以后沿河回家。", rawContent: "路灯映在积水里。", tags: ["雨夜"] },
    { id: "memory-a", title: "等爷爷的雨天", exhibitText: "放学后在屋檐下等待。", rawContent: "小时候下雨，爷爷会带伞来接我。", tags: ["童年", "家人"], people: ["person-secret"], location: "gps-canary", entityRefs: ["entity-secret"], provenance: "provenance-secret", media: [{ secret: "原始音频暗号" }] }
  ];
}

function fixtureVoices() {
  return new Map([["memory-a", [
    { asset: { originalName: "原始音频暗号" }, transcript: { status: "confirmed", confirmed: true, text: "爷爷撑着蓝伞来接我。" } },
    { transcript: { status: "draft", confirmed: false, text: "草稿文字暗号" } }
  ]]]);
}

function ok(value, message) { assert.ok(value, message); assertions += 1; }
function equal(actual, expected, message) { assert.equal(actual, expected, message); assertions += 1; }
function notEqual(actual, expected, message) { assert.notEqual(actual, expected, message); assertions += 1; }
function deepEqual(actual, expected, message) { assert.deepEqual(actual, expected, message); assertions += 1; }
function throwsCode(callback, code, message) { assert.throws(callback, (error) => error?.code === code, message); assertions += 1; }
