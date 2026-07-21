"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

let assertions = 0;

run().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});

async function run() {
  const core = await import(pathToFileUrl(path.join(__dirname, "..", "public", "assets", "semantic-recall-core.mjs")));
  const snapshot = core.normalizeSemanticSnapshot(snapshotFixture());
  equal(snapshot.documentCount, 2, "worker core accepts the strict server snapshot");
  ok(Object.isFrozen(snapshot) && Object.isFrozen(snapshot.documents[0]), "normalized worker input is immutable");
  const text = core.buildSemanticDocumentText(snapshot.documents[0]);
  for (const expected of ["标题：", "标签：", "展品说明：", "正文片段：", "已确认文字稿："]) {
    ok(text.includes(expected), `embedding text includes ${expected}`);
  }
  ok([...text].length < 480, "balanced embedding input remains inside the BERT token budget vicinity");
  equal(core.normalizeSemanticQuery("  雨天   等爷爷 "), "雨天 等爷爷", "query is normalized only in worker memory");
  ok(core.buildSemanticQueryText("雨天等爷爷").startsWith(core.SEMANTIC_RECALL_QUERY_PREFIX), "Chinese retrieval instruction is applied only to queries");
  throwsCode(() => core.normalizeSemanticQuery("x"), "SEMANTIC_RECALL_QUERY_INVALID", "single-character query is rejected");

  const query = vector(0, 1);
  const ranked = core.rankSemanticResults(query, [
    { document: snapshot.documents[1], vector: vector(1, 1) },
    { document: snapshot.documents[0], vector: vector(0, 1) }
  ]);
  deepEqual(ranked.map((item) => item.memoryId), ["memory-a", "memory-b"], "cosine-ready dot ranking returns closest semantic result first");
  equal(ranked[0].similarity, 1, "ranking retains similarity as a score, not a probability label");
  equal(ranked[0].rank, 1, "result rank is explicit and contiguous");
  const tensor = { tolist: () => [Array.from(vector(0, 0.5))] };
  equal(core.tensorRows(tensor, 1)[0].length, 512, "real model output contract requires 512 dimensions");
  throwsCode(() => core.tensorRows({ tolist: () => [[1, 2]] }, 1), "SEMANTIC_RECALL_MODEL_OUTPUT_INVALID", "wrong model dimensions fail closed");

  const extraField = snapshotFixture();
  extraField.documents[0].media = [{ secret: true }];
  extraField.documentUtf8Bytes = new TextEncoder().encode(JSON.stringify(extraField.documents)).byteLength;
  throwsCode(() => core.normalizeSemanticSnapshot(extraField), "SEMANTIC_RECALL_DOCUMENT_INVALID", "unexpected source fields cannot enter the worker");
  const remote = snapshotFixture();
  remote.model.remoteModelsAllowed = true;
  throwsCode(() => core.normalizeSemanticSnapshot(remote), "SEMANTIC_RECALL_MODEL_CONTRACT_INVALID", "remote model permission is rejected");
  const wrongBoundary = snapshotFixture();
  wrongBoundary.boundary.persisted = true;
  throwsCode(() => core.normalizeSemanticSnapshot(wrongBoundary), "SEMANTIC_RECALL_BOUNDARY_INVALID", "persistent index claims are rejected");

  const worker = read("public/assets/semantic-recall-worker.js");
  ok(worker.includes("pipeline(\"feature-extraction\"") && worker.includes('dtype: "q8"') && worker.includes('device: "wasm"'), "worker runs a real q8 WASM embedding pipeline");
  ok(worker.includes("env.allowRemoteModels = false") && worker.includes('env.localModelPath = "/assets/models/v17/"'), "worker is pinned to same-origin model files");
  ok(worker.includes("env.useBrowserCache = false") && worker.includes("env.useFSCache = false"), "Transformers cache persistence is disabled");
  ok(worker.includes("numThreads = 1"), "mobile-safe single-thread WASM avoids SharedArrayBuffer requirements");
  ok(worker.includes("measureTokenizerBudget") && worker.includes("truncation: false") && worker.includes("SEMANTIC_RECALL_TOKEN_BUDGET_EXCEEDED"), "real tokenizer checks the frozen worst-case input before indexing");
  ok(!/localStorage|sessionStorage|indexedDB|caches\.open|https?:\/\//u.test(worker), "worker has no browser persistence or third-party URL");
  ok(!/\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon/u.test(worker), "worker itself has no arbitrary network surface");
  ok(worker.includes("let extractor = null") && worker.includes("let indexed = []"), "model and vectors remain worker-owned session state");
  console.log(`Semantic recall worker checks passed (${assertions} assertions).`);
}

function snapshotFixture() {
  const documents = [
    { memoryId: "memory-a", title: "雨天等爷爷", exhibitText: "放学后在屋檐下等。", rawContent: "爷爷撑伞来接我。", tags: ["童年"], confirmedTranscripts: ["雨声很大"] },
    { memoryId: "memory-b", title: "海边晚风", exhibitText: "沿着海岸散步。", rawContent: "风很轻。", tags: ["旅行"], confirmedTranscripts: [] }
  ];
  return {
    format: "time-isle-semantic-recall-snapshot-v1",
    collectionFingerprint: "a".repeat(64),
    documentCount: 2,
    documents,
    documentUtf8Bytes: new TextEncoder().encode(JSON.stringify(documents)).byteLength,
    model: { id: "Xenova/bge-small-zh-v1.5", dimensions: 512, dtype: "q8", localModelPath: "/assets/models/v17/", remoteModelsAllowed: false },
    boundary: { execution: "browser-worker-memory-only", persisted: false, externalRequests: false }
  };
}

function vector(index, value) { const result = new Float32Array(512); result[index] = value; return result; }
function pathToFileUrl(file) { return new URL(`file:///${file.replace(/\\/gu, "/")}`); }
function read(file) { return fs.readFileSync(path.join(__dirname, "..", file), "utf8"); }
function ok(value, message) { assert.ok(value, message); assertions += 1; }
function equal(actual, expected, message) { assert.equal(actual, expected, message); assertions += 1; }
function deepEqual(actual, expected, message) { assert.deepEqual(actual, expected, message); assertions += 1; }
function throwsCode(callback, code, message) { assert.throws(callback, (error) => error?.code === code, message); assertions += 1; }
