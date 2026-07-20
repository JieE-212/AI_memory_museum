"use strict";

const assert = require("node:assert/strict");
const { createCollectionHealthService, DEFAULT_RETENTION_MS, MAX_ISSUES } = require("../lib/collection-health");

let assertions = 0;

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});

async function main() {
  await checkHealthyScan();
  await checkTimeCalibrationReviewClassification();
  await checkOralHistoryReviewClassification();
  await checkCuratorAgentClassification();
  await checkCoMemoryResponseClassification();
  await checkIssueSanitizationAndTruncation();
  await checkSingleTaskAndCancellation();
  await checkFailurePrivacy();
  await checkRetentionAndIsolation();
  checkDependencyAndInputBoundaries();
  console.log(`Collection health checks passed: ${assertions} assertions.`);
}

async function checkCoMemoryResponseClassification() {
  const privateQuestion = "只用于馆藏体检注入的私人问题";
  const privateAnswer = "只用于馆藏体检注入的私人回答";
  const privateHash = "d".repeat(64);
  const counts = {
    coMemoryResponses: 2,
    coMemoryUnverifiedIdentity: 2,
    coMemoryEncryptedTransport: 2,
    coMemoryUnsigned: 2,
    coMemoryVerifiedIdentity: 99,
    coMemoryQuestionCount: 99
  };
  const healthyService = createCollectionHealthService({
    getDatabaseHealthSnapshot: async () => ({
      ok: true,
      checks: [{ code: "DATABASE_CO_MEMORY_RESPONSE_STRUCTURE", ok: true }],
      counts,
      issues: [],
      question: privateQuestion,
      answer: privateAnswer,
      responseSha256: privateHash
    }),
    media: { listAssets: async () => [], verifyVariant: async () => true },
    voice: { listAssets: async () => [], verifyAsset: async () => true },
    createId: () => "health-co-memory-safe"
  });
  const healthy = await healthyService.wait(healthyService.start().id);
  equal(healthy.summary.status, "healthy", "结构正常的共忆回信安全计数不会制造待处理问题");
  equal(healthy.summary.database.status, "pass", "共忆回信边界验真通过时数据库区域保持 pass");
  deepEqual(healthy.summary.database.records, {
    coMemoryResponses: 2,
    coMemoryUnverifiedIdentity: 2,
    coMemoryEncryptedTransport: 2,
    coMemoryUnsigned: 2
  }, "馆藏体检只投影共忆回信的四项固定安全计数");
  const serialized = JSON.stringify(healthy);
  equal(serialized.includes(privateQuestion) || serialized.includes(privateAnswer) || serialized.includes(privateHash), false,
    "馆藏体检不泄露共忆问题、回答或哈希");
  equal(serialized.includes("coMemoryVerifiedIdentity") || serialized.includes("coMemoryQuestionCount"), false,
    "未列入合同的共忆计数不能穿透安全白名单");
  healthyService.destroy();

  const blockerService = createCollectionHealthService({
    getDatabaseHealthSnapshot: async () => ({
      ok: false,
      checks: [{ code: "DATABASE_CO_MEMORY_RESPONSE_STRUCTURE", ok: false }],
      counts,
      issues: []
    }),
    media: { listAssets: async () => [], verifyVariant: async () => true },
    voice: { listAssets: async () => [], verifyAsset: async () => true },
    createId: () => "health-co-memory-blocker"
  });
  const blocker = await blockerService.wait(blockerService.start().id);
  equal(blocker.summary.status, "blocker", "共忆回信结构损坏会阻止健康结论");
  equal(blocker.issues[0]?.code, "DATABASE_CO_MEMORY_RESPONSE_STRUCTURE",
    "共忆结构问题保持固定且非敏感的错误码");
  equal(blocker.issues[0]?.message, "共忆回信的加密绑定、未核验身份边界或独立来源结构需要核对。",
    "共忆结构问题只返回固定安全文案");
  blockerService.destroy();
}

async function checkCuratorAgentClassification() {
  const safeCounts = {
    curatorAgentRuns: 3,
    curatorAgentSteps: 8,
    curatorAgentProposals: 2,
    curatorAgentDecisions: 1,
    curatorAgentCompleted: 2,
    curatorAgentInterrupted: 1,
    curatorAgentNeedsReview: 2,
    curatorAgentObjectiveCount: 99,
    toolCalls: 8
  };
  const attentionService = createCollectionHealthService({
    getDatabaseHealthSnapshot: async () => ({
      ok: true,
      checks: [{ code: "DATABASE_CURATOR_AGENT_STRUCTURE", ok: true }],
      counts: safeCounts,
      issues: [
        { code: "CURATOR_AGENT_RUN_INTERRUPTED", area: "curation", severity: "attention", recordId: "curator-run-interrupted" },
        { code: "CURATOR_AGENT_RUN_NEEDS_REVIEW", area: "curation", severity: "attention", recordId: "curator-run-review" }
      ],
      issueCounts: [
        { code: "CURATOR_AGENT_RUN_INTERRUPTED", area: "curation", severity: "attention", count: 1 },
        { code: "CURATOR_AGENT_RUN_NEEDS_REVIEW", area: "curation", severity: "attention", count: 2 }
      ],
      objective: "private curator objective",
      proposalSha256: "f".repeat(64)
    }),
    media: { listAssets: async () => [], verifyVariant: async () => true },
    voice: { listAssets: async () => [], verifyAsset: async () => true },
    createId: () => "health-curator-agent-attention"
  });
  const attention = await attentionService.wait(attentionService.start().id);
  equal(attention.summary.status, "attention", "interrupted and needs-review curator runs remain gentle attention items");
  equal(attention.summary.database.status, "pass", "curator review state is not misclassified as database corruption");
  equal(attention.summary.curation.status, "attention", "curator run follow-up remains in the curation area");
  equal(attention.summary.curation.needsReview, 3, "curator attention totals preserve unsampled issue counts");
  deepEqual(attention.summary.database.records, {
    curatorAgentRuns: 3,
    curatorAgentSteps: 8,
    curatorAgentProposals: 2,
    curatorAgentDecisions: 1,
    curatorAgentCompleted: 2,
    curatorAgentInterrupted: 1,
    curatorAgentNeedsReview: 2
  }, "collection health exposes only the curator-agent safe counter projection");
  const attentionJson = JSON.stringify(attention);
  equal(attentionJson.includes("private curator objective"), false, "curator objective is excluded from collection health");
  equal(attentionJson.includes("f".repeat(64)), false, "curator hashes are excluded from collection health");
  attentionService.destroy();

  const blockerService = createCollectionHealthService({
    getDatabaseHealthSnapshot: async () => ({
      ok: false,
      checks: [{ code: "DATABASE_CURATOR_AGENT_STRUCTURE", ok: false }],
      counts: safeCounts,
      issues: []
    }),
    media: { listAssets: async () => [], verifyVariant: async () => true },
    voice: { listAssets: async () => [], verifyAsset: async () => true },
    createId: () => "health-curator-agent-blocker"
  });
  const blocker = await blockerService.wait(blockerService.start().id);
  equal(blocker.summary.status, "blocker", "curator-agent structural failure blocks a healthy conclusion");
  equal(blocker.summary.database.status, "blocker", "curator-agent structural failure is a database blocker");
  equal(blocker.issues[0]?.code, "DATABASE_CURATOR_AGENT_STRUCTURE", "the blocker keeps a fixed non-sensitive code");
  equal(blocker.issues[0]?.message, "策展助手的运行、步骤、提案或人工决定结构需要核对。", "the blocker uses fixed safe copy");
  blockerService.destroy();
}

async function checkOralHistoryReviewClassification() {
  const service = createCollectionHealthService({
    getDatabaseHealthSnapshot: async () => ({
      ok: true,
      checks: [{ code: "DATABASE_ORAL_HISTORY_STRUCTURE", ok: true }],
      counts: { oralHistoryQuestions: 2, oralHistoryAnswers: 3, confirmedOralHistoryAnswers: 1 },
      issues: [
        { code: "ORAL_HISTORY_ANSWER_DRAFT", area: "curation", severity: "attention", recordId: "oral-answer-draft" },
        { code: "ORAL_HISTORY_QUESTION_OPEN", area: "curation", severity: "attention", recordId: "oral-question-open" }
      ],
      issueCounts: [
        { code: "ORAL_HISTORY_ANSWER_DRAFT", area: "curation", severity: "attention", count: 1 },
        { code: "ORAL_HISTORY_QUESTION_OPEN", area: "curation", severity: "attention", count: 1 }
      ]
    }),
    media: { listAssets: async () => [], verifyVariant: async () => true },
    voice: { listAssets: async () => [], verifyAsset: async () => true },
    createId: () => "health-oral-history"
  });
  const finished = await service.wait(service.start().id);
  equal(finished.summary.database.status, "pass", "口述草稿和开放问题不冒充数据库损坏");
  deepEqual(finished.summary.database.records, {
    oralHistoryQuestions: 2,
    oralHistoryAnswers: 3,
    confirmedOralHistoryAnswers: 1
  }, "馆藏体检只公开口述史安全计数");
  equal(finished.summary.curation.needsReview, 2, "口述草稿与开放问题进入策展待整理汇总");
  equal(finished.issues.find((item) => item.code === "ORAL_HISTORY_ANSWER_DRAFT")?.message, "一段口述回答仍是草稿，确认后才会成为时间来源。", "口述草稿使用固定安全文案");
  equal(finished.issues.find((item) => item.code === "ORAL_HISTORY_QUESTION_OPEN")?.message, "一个口述问题还没有人工确认的回答。", "开放问题使用固定安全文案");
  equal(/(?:transcript|segment|interval|sourceKey)/u.test(JSON.stringify(finished)), false, "馆藏体检不泄露口述文字、片段、日期或来源键");
  service.destroy();
}

async function checkTimeCalibrationReviewClassification() {
  const service = createCollectionHealthService({
    getDatabaseHealthSnapshot: async () => ({
      ok: true,
      checks: [{ code: "DATABASE_TIME_CALIBRATION_STRUCTURE", ok: true }],
      counts: { timeCalibrations: 2 },
      issues: [{
        code: "TIME_CALIBRATION_NEEDS_REVIEW",
        area: "curation",
        severity: "attention",
        recordId: "calibration-review"
      }],
      issueCounts: [{
        code: "TIME_CALIBRATION_NEEDS_REVIEW",
        area: "curation",
        severity: "attention",
        count: 2
      }]
    }),
    media: { listAssets: async () => [], verifyVariant: async () => true },
    voice: { listAssets: async () => [], verifyAsset: async () => true },
    createId: () => "health-time-calibration"
  });
  const finished = await service.wait(service.start().id);
  const issue = finished.issues.find((item) => item.code === "TIME_CALIBRATION_NEEDS_REVIEW");
  equal(finished.summary.database.status, "pass", "来源变化不会把时间校准误报为数据库损坏");
  equal(finished.summary.database.records.timeCalibrations, 2, "馆藏体检公开安全的时间校准计数");
  equal(finished.summary.curation.needsReview, 2, "时间校准动态待复核数量进入策展汇总");
  equal(issue?.area, "curation", "时间校准待复核保持 curation 分类");
  equal(issue?.severity, "attention", "时间校准待复核保持温和 attention 严重度");
  equal(issue?.message, "一项时间校准的来源已经变化，需要重新核对。", "时间校准待复核使用固定中文安全文案");
  equal(Object.hasOwn(issue || {}, "details"), false, "时间校准健康问题不暴露来源摘要或私人内容");
  service.destroy();
}

async function checkHealthyScan() {
  const mediaAssets = [
    mediaAsset("asset-safe", "sanitized_only", [variant("display", "a"), variant("thumb", "b")], "a"),
    mediaAsset("asset-original", "preserve_original", [variant("original", "c"), variant("display", "d"), variant("thumb", "e")], "c"),
    { ...mediaAsset("asset-pending", "sanitized_only", [], "f"), status: "pending_delete" }
  ];
  const voiceAssets = [voiceAsset("voice-ready"), { ...voiceAsset("voice-pending"), status: "pending_delete" }];
  const before = JSON.stringify({ mediaAssets, voiceAssets });
  let mediaVerified = 0;
  let voiceVerified = 0;
  let exclusiveRuns = 0;
  const service = createCollectionHealthService({
    getDatabaseHealthSnapshot: async () => ({
      ok: true,
      checks: [
        { code: "DATABASE_QUICK_CHECK", ok: true },
        { code: "DATABASE_FOREIGN_KEYS", ok: true }
      ],
      counts: { memories: 4, mediaAssets: 3, ignored_key: 9, title: "private" },
      issues: [{ code: "CURATION_REVIEW_ITEM", area: "curation", recordId: "exhibition-review" }],
      issueCounts: [{ code: "CURATION_REVIEW_ITEM", area: "curation", severity: "attention", count: 3 }]
    }),
    media: {
      listAssets: async () => mediaAssets,
      verifyVariant: async () => { mediaVerified += 1; return { ok: true, storagePath: "C:\\private" }; }
    },
    voice: {
      listAssets: async () => voiceAssets,
      verifyAsset: async () => { voiceVerified += 1; return true; }
    },
    runExclusive: async (operation) => { exclusiveRuns += 1; return operation(); },
    createId: () => "health-healthy"
  });

  const started = service.start({ scope: "full" });
  equal(started.state, "running", "启动立即返回运行态而不阻塞调用方");
  equal(started.summary, undefined, "运行态不暴露尚未完成的半份诊断结论");
  const finished = await service.wait(started.id);
  equal(finished.state, "completed", "健康扫描完成");
  equal(finished.summary.status, "attention", "策展待复核与存储损坏分离但会形成温和提醒");
  equal(finished.summary.database.status, "pass", "数据库检查通过");
  equal(finished.summary.database.checks, 2, "数据库快照的检查数量被汇总");
  deepEqual(finished.summary.database.records, { memories: 4, mediaAssets: 3 }, "数据库只返回安全的非负数计数");
  equal(finished.summary.media.assets, 3, "图片资产总数被汇总");
  equal(finished.summary.media.ready, 2, "只把 ready 图片计入完整核验数量");
  equal(finished.summary.media.variants, 5, "图片变体数量被汇总");
  equal(finished.summary.voices.ready, 1, "只把 ready 声音计入完整核验数量");
  equal(mediaVerified, 5, "逐一核验 ready 图片的全部变体");
  equal(voiceVerified, 1, "逐一核验 ready 声音文件");
  equal(exclusiveRuns, 1, "一次扫描只进入一次注入的只读独占边界");
  equal(finished.progress.checked, finished.progress.total, "完成态进度闭合");
  equal(finished.issues.some((issue) => issue.code === "MEDIA_ASSET_STATUS_REVIEW"), true, "待删除图片被报告为待核对而非尝试清理");
  equal(finished.issues.some((issue) => issue.code === "VOICE_ASSET_STATUS_REVIEW"), true, "待删除声音被报告为待核对而非尝试清理");
  equal(finished.issues.some((issue) => issue.code === "CURATION_REVIEW_ITEM"), true, "策展待复核由数据库快照进入独立区域");
  equal(finished.summary.curation.needsReview, 3, "待复核总数不受公开样本条数限制");
  equal(JSON.stringify({ mediaAssets, voiceAssets }), before, "体检不修改注入的图片或声音记录");
  const external = service.get(started.id);
  external.progress.checked = -1;
  external.issues[0].message = "mutated";
  equal(service.get(started.id).progress.checked, finished.progress.total, "公开快照修改不会污染内部扫描状态");
  notEqual(service.get(started.id).issues[0].message, "mutated", "问题快照同样与内部状态隔离");
  service.destroy();
}

async function checkIssueSanitizationAndTruncation() {
  const secretHash = "a".repeat(64);
  const secretPath = "C:\\Users\\private\\photo.webp";
  const mediaAssets = Array.from({ length: MAX_ISSUES + 7 }, (_, index) => (
    mediaAsset(`asset-bad-${index}`, "sanitized_only", [variant("display", `hash-${index}`)], `hash-${index}`)
  ));
  const service = createCollectionHealthService({
    getDatabaseHealthSnapshot: async () => ({
      checks: [{ code: "bad/path", ok: false, message: `${secretPath} ${secretHash}` }],
      issues: [{ code: secretHash.toUpperCase(), area: "database", recordId: secretHash, message: secretPath }]
    }),
    media: {
      listAssets: async () => mediaAssets,
      verifyVariant: async () => { throw new Error(`cannot read ${secretPath} sha256=${secretHash}`); }
    },
    voice: { listAssets: async () => [], verifyAsset: async () => true },
    createId: () => "health-truncated"
  });
  const finished = await service.wait(service.start().id);
  equal(finished.state, "completed", "单项核验失败形成诊断结果而不使整次扫描崩溃");
  equal(finished.issues.length, MAX_ISSUES, "公开问题严格截断为 200 条");
  ok(finished.summary.issuesTotal > MAX_ISSUES, "总问题数继续准确统计截断后的项目");
  equal(finished.summary.issuesTruncated, true, "结果明确声明问题列表已截断");
  const serialized = JSON.stringify(finished);
  equal(serialized.includes(secretPath), false, "依赖异常中的绝对路径不会进入公开结果");
  equal(serialized.includes(secretHash), false, "依赖异常中的 SHA-256 不会进入公开结果");
  equal(serialized.toLowerCase().includes(secretHash), false, "大写形式的 SHA-256 同样不会借问题代码泄漏");
  equal(finished.issues.every((issue) => issue.repairAction === null), true, "MVP 不为任何诊断偷偷附加修复动作");
  equal(finished.issues.every((issue) => !Object.hasOwn(issue, "storageKey") && !Object.hasOwn(issue, "details")), true, "问题合同不暴露内部存储字段");
  service.destroy();
}

async function checkSingleTaskAndCancellation() {
  let releaseDatabase;
  let markDatabaseEntered;
  let observedAbort = false;
  const databaseGate = new Promise((resolve) => { releaseDatabase = resolve; });
  const databaseEntered = new Promise((resolve) => { markDatabaseEntered = resolve; });
  const service = createCollectionHealthService({
    getDatabaseHealthSnapshot: async ({ signal }) => {
      signal.addEventListener("abort", () => { observedAbort = true; }, { once: true });
      markDatabaseEntered();
      await databaseGate;
      if (signal.aborted) throw abortError();
      return { checks: [] };
    },
    media: { listAssets: async () => [], verifyVariant: async () => true },
    voice: { listAssets: async () => [], verifyAsset: async () => true },
    createId: sequenceIds("health-cancelled", "health-next")
  });
  const first = service.start();
  throwsCode(() => service.start(), "COLLECTION_HEALTH_SCAN_BUSY", 409, "同一时刻只允许一项扫描");
  await databaseEntered;
  const cancelling = service.cancel(first.id);
  equal(cancelling.state, "cancelling", "取消先进入可观察的 cancelling 状态");
  equal(service.cancel(first.id).state, "cancelling", "重复取消保持幂等");
  releaseDatabase();
  const cancelled = await service.wait(first.id);
  equal(cancelled.state, "cancelled", "依赖在边界返回后扫描稳定收敛为 cancelled");
  equal(cancelled.summary.status, "incomplete", "取消结果不会冒充健康结论");
  equal(observedAbort, true, "AbortSignal 传入数据库快照依赖");
  const next = await service.wait(service.start().id);
  equal(next.state, "completed", "取消完成后可以启动下一项扫描");
  equal(service.cancel(next.id).state, "completed", "取消终态扫描不会改写既有结果");
  equal(service.cancel("health-missing"), null, "取消未知扫描安全返回空结果");
  service.destroy();
}

async function checkFailurePrivacy() {
  const service = createCollectionHealthService({
    getDatabaseHealthSnapshot: async () => { throw new Error("C:\\private\\museum.sqlite aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"); },
    media: { listAssets: async () => [], verifyVariant: async () => true },
    voice: { listAssets: async () => [], verifyAsset: async () => true },
    createId: () => "health-failed"
  });
  const failed = await service.wait(service.start().id);
  equal(failed.state, "failed", "未处理的依赖失败形成稳定 failed 终态");
  equal(failed.summary.status, "incomplete", "失败扫描不输出健康结论");
  deepEqual(failed.issues, [{
    code: "COLLECTION_HEALTH_SCAN_FAILED",
    severity: "error",
    area: "system",
    message: "本次馆藏体检未能完整执行。",
    repairAction: null
  }], "失败响应只返回固定安全问题");
  equal(JSON.stringify(failed).includes("private"), false, "底层异常消息不会泄漏到失败响应");
  service.destroy();
}

async function checkRetentionAndIsolation() {
  const service = createCollectionHealthService({
    getDatabaseHealthSnapshot: async () => ({ checks: [] }),
    media: { listAssets: async () => [], verifyVariant: async () => true },
    voice: { listAssets: async () => [], verifyAsset: async () => true },
    retentionMs: 20,
    maxIssues: 999,
    createId: () => "health-expiring"
  });
  const finished = await service.wait(service.start().id);
  ok(finished.expiresAt, "终态结果带内存过期时间");
  equal(finished.summary.issuesTotal, 0, "空馆藏可以得到零问题健康结果");
  equal(finished.summary.status, "healthy", "空馆藏不会被误报为异常");
  await delay(35);
  equal(service.get(finished.id), null, "终态扫描在配置的保留期后从内存移除");
  equal(service.wait(finished.id) instanceof Promise, true, "等待未知扫描仍返回 Promise");
  equal(await service.wait(finished.id), null, "等待已过期扫描返回空结果");
  service.destroy();
  throwsCode(() => service.get(finished.id), "COLLECTION_HEALTH_SERVICE_CLOSED", 503, "关闭后服务拒绝继续读取");
  equal(DEFAULT_RETENTION_MS, 10 * 60 * 1000, "默认结果只在内存保留十分钟");
}

function checkDependencyAndInputBoundaries() {
  const base = {
    getDatabaseHealthSnapshot: async () => ({ checks: [] }),
    media: { listAssets: async () => [], verifyVariant: async () => true },
    voice: { listAssets: async () => [], verifyAsset: async () => true }
  };
  throws(() => createCollectionHealthService({}), TypeError, "缺少依赖时启动即失败");
  throws(() => createCollectionHealthService({ ...base, media: {} }), TypeError, "图片依赖必须同时提供枚举和核验函数");
  throws(() => createCollectionHealthService({ ...base, voice: {} }), TypeError, "声音依赖必须同时提供枚举和核验函数");
  throws(() => createCollectionHealthService({ ...base, retentionMs: 0 }), TypeError, "保留时间不能为零");
  const service = createCollectionHealthService({ ...base, createId: sequenceIds("health-input", "health-input-2") });
  throwsCode(() => service.start({ scope: "media" }), "COLLECTION_HEALTH_SCOPE_INVALID", 400, "首版拒绝伪装成局部体检");
  throws(() => service.start({ unknown: true }), TypeError, "启动参数拒绝未知字段");
  throwsCode(() => service.get("../private"), "COLLECTION_HEALTH_ID_INVALID", 400, "扫描 ID 拒绝路径字符");
  service.destroy();
}

function mediaAsset(id, privacyMode, variants, contentSha256) {
  return { id, status: "ready", privacyMode, contentSha256, variants };
}

function variant(kind, sha256) {
  return { kind, sha256, byteSize: 10, storageKey: `private/${sha256}` };
}

function voiceAsset(id) {
  return { id, status: "ready", byteSize: 20, contentSha256: "f".repeat(64), storageKey: "ready/private" };
}

function sequenceIds(...ids) {
  let index = 0;
  return () => ids[index++] || `health-sequence-${index}`;
}

function abortError() {
  const error = new Error("cancelled");
  error.name = "AbortError";
  return error;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ok(value, message) {
  assertions += 1;
  assert.ok(value, message);
}

function equal(actual, expected, message) {
  assertions += 1;
  assert.equal(actual, expected, message);
}

function notEqual(actual, expected, message) {
  assertions += 1;
  assert.notEqual(actual, expected, message);
}

function deepEqual(actual, expected, message) {
  assertions += 1;
  assert.deepEqual(actual, expected, message);
}

function throws(operation, expected, message) {
  assertions += 1;
  assert.throws(operation, expected, message);
}

function throwsCode(operation, code, statusCode, message) {
  assertions += 1;
  assert.throws(operation, (error) => error?.code === code && error?.statusCode === statusCode, message);
}
