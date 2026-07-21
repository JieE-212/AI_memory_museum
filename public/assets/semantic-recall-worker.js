import { env, pipeline } from "/assets/vendor/transformers-3.8.1/transformers.min.js";
import {
  SEMANTIC_RECALL_MODEL_ID,
  buildSemanticDocumentText,
  buildSemanticQueryText,
  normalizeSemanticQuery,
  normalizeSemanticSnapshot,
  rankSemanticResults,
  tensorRows
} from "/assets/semantic-recall-core.mjs";

env.allowLocalModels = true;
env.allowRemoteModels = false;
env.localModelPath = "/assets/models/v17/";
env.useBrowserCache = false;
env.useFSCache = false;
env.backends.onnx.wasm.wasmPaths = "/assets/vendor/transformers-3.8.1/";
env.backends.onnx.wasm.numThreads = 1;

let extractor = null;
let indexed = [];
let collectionFingerprint = "";
let activeSession = "";

self.addEventListener("message", (event) => {
  const message = event.data;
  if (!message || typeof message !== "object" || typeof message.session !== "string") return;
  if (message.type === "prepare") {
    activeSession = message.session;
    prepare(message).catch((error) => fail(message.session, error));
    return;
  }
  if (message.session !== activeSession) return;
  if (message.type === "query") query(message).catch((error) => fail(message.session, error));
});

async function prepare(message) {
  const snapshot = normalizeSemanticSnapshot(message.snapshot);
  indexed = [];
  collectionFingerprint = "";
  post(message.session, "progress", { phase: "model", percent: 0, label: "正在加载约 47 MB 的设备模型…" });
  if (!extractor) {
    extractor = await pipeline("feature-extraction", SEMANTIC_RECALL_MODEL_ID, {
      device: "wasm",
      dtype: "q8",
      progress_callback: (progress) => {
        if (message.session !== activeSession) return;
        const percent = Number.isFinite(progress?.progress) ? Math.max(0, Math.min(100, progress.progress)) : 0;
        post(message.session, "progress", { phase: "model", percent, label: modelProgressLabel(progress, percent) });
      }
    });
  }
  assertActive(message.session);
  const tokenizerBudget = await measureTokenizerBudget(extractor.tokenizer);
  if (tokenizerBudget.maximumInputTokens > tokenizerBudget.modelMaximumTokens) {
    throw recallError("设备索引文字超过模型的安全输入范围。", "SEMANTIC_RECALL_TOKEN_BUDGET_EXCEEDED");
  }
  const documents = snapshot.documents;
  const batchSize = 8;
  for (let offset = 0; offset < documents.length; offset += batchSize) {
    assertActive(message.session);
    const batch = documents.slice(offset, offset + batchSize);
    const output = await extractor(batch.map(buildSemanticDocumentText), { pooling: "mean", normalize: true });
    const vectors = tensorRows(output, batch.length);
    batch.forEach((document, index) => indexed.push(Object.freeze({ document, vector: vectors[index] })));
    const completed = Math.min(documents.length, offset + batch.length);
    post(message.session, "progress", {
      phase: "index",
      percent: documents.length ? completed / documents.length * 100 : 100,
      completed,
      total: documents.length,
      label: `正在理解馆藏文字 ${completed}/${documents.length}…`
    });
  }
  collectionFingerprint = snapshot.collectionFingerprint;
  post(message.session, "ready", {
    documentCount: indexed.length,
    collectionFingerprint,
    dimensions: 512,
    maximumInputTokens: tokenizerBudget.maximumInputTokens,
    modelMaximumTokens: tokenizerBudget.modelMaximumTokens
  });
}

async function query(message) {
  if (!extractor || !collectionFingerprint) {
    throw recallError("请先准备设备语义。", "SEMANTIC_RECALL_NOT_READY");
  }
  const queryText = normalizeSemanticQuery(message.query);
  post(message.session, "progress", { phase: "query", percent: 30, label: "正在按文字含义寻找…" });
  const output = await extractor(buildSemanticQueryText(queryText), { pooling: "mean", normalize: true });
  assertActive(message.session);
  const [vector] = tensorRows(output, 1);
  const results = rankSemanticResults(vector, indexed, 6);
  post(message.session, "results", { query: queryText, results, collectionFingerprint });
}

function modelProgressLabel(progress, percent) {
  const file = String(progress?.file || "");
  if (file.endsWith("model_quantized.onnx")) return `正在加载中文含义模型 ${Math.round(percent)}%…`;
  if (file.includes("tokenizer")) return `正在加载中文分词文件 ${Math.round(percent)}%…`;
  return percent > 0 ? `正在加载设备模型 ${Math.round(percent)}%…` : "正在加载约 47 MB 的设备模型…";
}

async function measureTokenizerBudget(tokenizer) {
  if (typeof tokenizer !== "function") throw recallError("设备模型缺少可核对的 tokenizer。", "SEMANTIC_RECALL_TOKENIZER_INVALID");
  const worstDocument = {
    memoryId: "token-budget",
    title: "题".repeat(60),
    exhibitText: "展".repeat(120),
    rawContent: "文".repeat(120),
    tags: ["标".repeat(20), "签".repeat(20), "词".repeat(10)],
    confirmedTranscripts: ["声".repeat(35), "音".repeat(35)]
  };
  const inputs = [buildSemanticDocumentText(worstDocument), buildSemanticQueryText("问".repeat(160))];
  let maximumInputTokens = 0;
  for (const input of inputs) {
    const encoded = await Promise.resolve(tokenizer(input, { padding: false, truncation: false }));
    const count = Number(encoded?.input_ids?.data?.length ?? encoded?.input_ids?.size);
    if (!Number.isSafeInteger(count) || count < 1) {
      throw recallError("无法核对设备模型的输入长度。", "SEMANTIC_RECALL_TOKENIZER_INVALID");
    }
    maximumInputTokens = Math.max(maximumInputTokens, count);
  }
  return { maximumInputTokens, modelMaximumTokens: 512 };
}

function assertActive(session) {
  if (session !== activeSession) throw recallError("本次设备语义任务已停止。", "SEMANTIC_RECALL_CANCELLED");
}

function fail(session, error) {
  if (session !== activeSession || error?.code === "SEMANTIC_RECALL_CANCELLED") return;
  indexed = [];
  collectionFingerprint = "";
  const safeCode = String(error?.code || "").startsWith("SEMANTIC_RECALL_")
    ? String(error.code)
    : "SEMANTIC_RECALL_MODEL_UNAVAILABLE";
  post(session, "error", {
    code: safeCode,
    message: safeCode === "SEMANTIC_RECALL_MODEL_UNAVAILABLE"
      ? "设备语义不可用。模型文件可能未完整加载或当前浏览器不支持 WASM 推理。"
      : String(error?.message || "设备语义不可用。")
  });
}

function post(session, type, payload = {}) {
  self.postMessage({ session, type, ...payload });
}

function recallError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}
