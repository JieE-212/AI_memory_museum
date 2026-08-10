"use strict";

const path = require("node:path");
const { test, expect } = require("@playwright/test");
const {
  buildEvaluationSet,
  buildPerformanceCorpus,
  buildSnapshot,
  calculateMetrics,
  calculateNullReturnRate,
  loadEvaluationFixture,
  percentile,
  runFtsBaseline,
  validateAgainstBaseline,
  writeReport
} = require("../helpers/semantic-recall-eval.cjs");

const fixturePath = path.resolve(__dirname, "../fixtures/semantic-recall-eval-v1.json");
const assetManifestPath = path.resolve(__dirname, "../../../public/assets/semantic-recall-assets.json");

test.describe("V17.1 semantic quality and performance evidence", () => {
  test.describe.configure({ retries: 0 });
  test("measures real q8 embeddings against a frozen fictional Chinese set", async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith("desktop-"), "真实模型质量只在固定桌面 Chromium 运行一次；移动端不扩大性能结论。");
    test.setTimeout(600_000);

    const fixture = loadEvaluationFixture(fixturePath);
    const evaluation = buildEvaluationSet(fixture);
    const corpus500 = buildPerformanceCorpus(evaluation.documents, 500);
    const snapshot100 = buildSnapshot(evaluation.documents);
    const snapshot500 = buildSnapshot(corpus500);
    const allQueries = [...evaluation.queries, ...evaluation.nullQueries];
    const origins = [];
    const modelRequests = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (["http:", "https:"].includes(url.protocol)) origins.push(url.origin);
      if (url.pathname.startsWith("/assets/models/v17/") || url.pathname.startsWith("/assets/vendor/transformers-3.8.1/")) {
        modelRequests.push(url.pathname);
      }
    });

    const response = await page.goto("/#reflect", { waitUntil: "domcontentloaded" });
    expect(response?.status()).toBe(200);
    await expect(page.locator("#runtimeBadge")).toHaveClass(/is-ready/);

    const workerResult = await page.evaluate(async ({ snapshot100: first, snapshot500: second, queries }) => {
      const worker = new Worker("/assets/semantic-recall-worker.js?v=17.1.2", { type: "module" });
      const waitForMessage = (session, expectedType, timeoutMs) => new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          cleanup();
          reject(new Error(`设备语义 ${expectedType} 等待超时`));
        }, timeoutMs);
        const onMessage = (event) => {
          const message = event.data;
          if (message?.session !== session) return;
          if (message.type === "error") {
            cleanup();
            reject(new Error(`${message.code}: ${message.message}`));
          } else if (message.type === expectedType) {
            cleanup();
            resolve(message);
          }
        };
        const onError = (event) => {
          cleanup();
          reject(new Error(event.message || "设备语义 Worker 失败"));
        };
        const cleanup = () => {
          clearTimeout(timeout);
          worker.removeEventListener("message", onMessage);
          worker.removeEventListener("error", onError);
        };
        worker.addEventListener("message", onMessage);
        worker.addEventListener("error", onError);
      });
      const prepare = async (session, snapshot) => {
        const waiting = waitForMessage(session, "ready", 300_000);
        const startedAt = performance.now();
        worker.postMessage({ type: "prepare", session, snapshot });
        const ready = await waiting;
        return { ready, elapsedMs: performance.now() - startedAt };
      };
      const query = async (session, item) => {
        const waiting = waitForMessage(session, "results", 30_000);
        const startedAt = performance.now();
        worker.postMessage({ type: "query", session, query: item.text });
        const result = await waiting;
        return { results: result.results, elapsedMs: performance.now() - startedAt };
      };
      try {
        const firstSession = "semantic-eval-100";
        const cold = await prepare(firstSession, first);
        const results100 = {};
        const query100Ms = [];
        for (const item of queries) {
          const result = await query(firstSession, item);
          results100[item.id] = result.results;
          query100Ms.push(result.elapsedMs);
        }

        const secondSession = "semantic-eval-500";
        const warm = await prepare(secondSession, second);
        const results500 = {};
        const query500Ms = [];
        for (const item of queries.filter((entry) => entry.relevantIds.length > 0)) {
          const result = await query(secondSession, item);
          results500[item.id] = result.results;
          query500Ms.push(result.elapsedMs);
        }
        return {
          coldPrepare100Ms: cold.elapsedMs,
          warmReindex500Ms: warm.elapsedMs,
          ready100: cold.ready,
          ready500: warm.ready,
          query100Ms,
          query500Ms,
          results100,
          results500
        };
      } finally {
        worker.terminate();
      }
    }, { snapshot100, snapshot500, queries: allQueries });

    expect(workerResult.ready100).toMatchObject({ documentCount: 100, dimensions: 512, modelMaximumTokens: 512 });
    expect(workerResult.ready500).toMatchObject({ documentCount: 500, dimensions: 512, modelMaximumTokens: 512 });
    expect(modelRequests.some((item) => item.endsWith("/onnx/model_quantized.onnx"))).toBe(true);
    expect([...new Set(origins)]).toEqual([new URL(page.url()).origin]);

    const quality100 = calculateMetrics(evaluation.queries, workerResult.results100);
    const quality500 = calculateMetrics(evaluation.queries, workerResult.results500);
    const fts = runFtsBaseline(evaluation.documents, evaluation.queries);
    const nullReturnAt3 = calculateNullReturnRate(evaluation.nullQueries, workerResult.results100);
    const performance = {
      coldPrepare100: Math.round(workerResult.coldPrepare100Ms),
      warmReindex500: Math.round(workerResult.warmReindex500Ms),
      query100P95: Math.round(percentile(workerResult.query100Ms, 0.95)),
      query500P95: Math.round(percentile(workerResult.query500Ms, 0.95))
    };
    const performanceRunnerId = String(process.env.SEMANTIC_EVAL_RUNNER_ID || "");
    const enforcePerformance = performanceRunnerId === fixture.baseline.performanceRunnerId;
    const failures100 = validateAgainstBaseline(quality100, performance, fixture.baseline, {
      enforcePerformance,
      labelPrefix: "100-doc"
    });
    const failures500 = validateAgainstBaseline(quality500, performance, fixture.baseline, {
      enforcePerformance: false,
      qualityBaseline: fixture.baseline.quality500,
      bySliceBaseline: fixture.baseline.bySlice500,
      labelPrefix: "500-doc"
    });
    const failures = [...failures100, ...failures500];
    const assetManifest = require(assetManifestPath);
    const onnx = assetManifest.files.find((item) => item.path.endsWith("model_quantized.onnx"));
    const report = {
      format: "time-isle-semantic-recall-evidence-v1",
      generatedAt: new Date().toISOString(),
      syntheticDataOnly: true,
      version: "17.1.2",
      schemaVersion: 19,
      model: { id: assetManifest.model.id, sha256: onnx.sha256, bytes: onnx.bytes, dtype: "q8", execution: "chromium-wasm-single-thread" },
      corpus: { qualityDocuments: 100, performanceDocuments: 500, positiveQueries: evaluation.queries.length, nullQueries: evaluation.nullQueries.length, fingerprint100: snapshot100.collectionFingerprint, fingerprint500: snapshot500.collectionFingerprint },
      runner: { platform: process.platform, arch: process.arch, node: process.version, chromium: page.context().browser().version(), project: testInfo.project.name },
      semantic100: quality100,
      semantic500: quality500,
      ftsCandidateAndFieldWeightBaseline100: fts,
      nullReturnAt3,
      limitation: "当前排序固定返回 Top-6，尚未实现馆外查询拒答阈值；NullReturn@3=1 是已知边界，不是成功率。",
      performanceMs: {
        ...performance,
        query100First: Math.round(workerResult.query100Ms[0]),
        query100P50: Math.round(percentile(workerResult.query100Ms, 0.5)),
        query500First: Math.round(workerResult.query500Ms[0]),
        query500P50: Math.round(percentile(workerResult.query500Ms, 0.5))
      },
      performanceGate: {
        enforced: enforcePerformance,
        expectedRunnerId: fixture.baseline.performanceRunnerId,
        actualRunnerId: performanceRunnerId || null,
        note: enforcePerformance ? "固定本机基线最多允许 20% 回退。" : "当前 runner 与冻结性能基线不匹配；仅记录耗时，不把跨机器差异冒充回退。"
      },
      frozenBaseline: fixture.baseline,
      gate: { passed: failures.length === 0, failures }
    };
    const reportTarget = process.env.SEMANTIC_EVAL_REPORT_PATH || testInfo.outputPath("semantic-recall-evidence.json");
    writeReport(report, reportTarget);
    console.log(`[semantic-eval] Recall@3=${quality100.recallAt3.toFixed(6)}/${quality500.recallAt3.toFixed(6)} MRR@3=${quality100.mrrAt3.toFixed(6)}/${quality500.mrrAt3.toFixed(6)} 100-index=${performance.coldPrepare100}ms 500-index=${performance.warmReindex500}ms query-P95=${performance.query100P95}/${performance.query500P95}ms gate=${failures.length ? "FAIL" : "PASS"}`);

    expect(nullReturnAt3).toBeLessThanOrEqual(fixture.baseline.maximumNullReturnAt3);
    expect(failures, JSON.stringify(report, null, 2)).toEqual([]);
  });
});
