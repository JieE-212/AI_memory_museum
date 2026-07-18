"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createArchiveInspectionApi, summarize } = require("../lib/archive-inspection-api");

let assertions = 0;

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "time-isle-inspection-check-"));
  try {
    await checkSchema12ForwardingAndCleanup(root);
    await checkSchema13OralHistoryForwarding(root);
    checkDependencyBoundary(root);
    checkSafeCounts();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log(`Archive inspection checks passed: ${assertions} assertions.`);
}

async function checkSchema13OralHistoryForwarding(root) {
  const oralValidator = () => true;
  let forwarded = null;
  const api = createArchiveInspectionApi({
    mediaRoot: root,
    supportedSchemaVersion: 13,
    validateVoiceBackup: () => true,
    validateTimeCalibrationBackup: () => true,
    validateOralHistoryBackup: oralValidator,
    prepareMediaArchive: async (_source, options) => {
      forwarded = options;
      return preparedFixture({ schemaVersion: 13, oralQuestionCount: 2, oralAnswerCount: 3, confirmedOralAnswerCount: 1 });
    },
    sendJson(_response, status, payload) { return { status, payload }; },
    httpError(statusCode, message) { return Object.assign(new Error(message), { statusCode }); }
  });
  const result = await api.handle(requestFixture(), responseFixture(), { pathname: "/api/archive/inspect" });
  equal(result.status, 200, "schema 13 口述史归档只读验真成功");
  equal(forwarded.validateOralHistoryBackup, oralValidator, "口述史严格 validator 转发到正式 prepare 链");
  equal(result.payload.inspection.counts.oralHistoryQuestions, 2, "验真摘要只公开口述问题安全计数");
  equal(result.payload.inspection.counts.oralHistoryAnswers, 3, "验真摘要只公开口述回答安全计数");
  equal(result.payload.inspection.counts.confirmedOralHistoryAnswers, 1, "验真摘要公开人工确认回答安全计数");
  const serialized = JSON.stringify(result.payload.inspection);
  equal(/(?:transcriptText|segmentStartMs|intervalStart|sourceKey|assetId)/u.test(serialized), false, "验真摘要不泄露口述文字、片段、日期、来源键或声音 ID");
}

async function checkSchema12ForwardingAndCleanup(root) {
  const validator = () => true;
  let forwarded = null;
  const api = createArchiveInspectionApi({
    mediaRoot: root,
    supportedSchemaVersion: 12,
    validateVoiceBackup: () => true,
    validateTimeCalibrationBackup: validator,
    prepareMediaArchive: async (source, options) => {
      forwarded = { source, options };
      return preparedFixture({ mode: "full", calibrationCount: 2 });
    },
    sendJson(response, status, payload) {
      response.writableFinished = true;
      return { status, payload };
    },
    httpError(statusCode, message) {
      return Object.assign(new Error(message), { statusCode });
    }
  });
  const request = requestFixture();
  const response = responseFixture();
  const result = await api.handle(request, response, { pathname: "/api/archive/inspect" });
  equal(result.status, 200, "schema 12 只读验真返回成功响应");
  equal(result.payload.inspection.counts.timeCalibrations, 2, "只读验真返回时间校准安全计数");
  equal(forwarded.source, request, "归档请求流原样交给正式 prepare 链");
  equal(forwarded.options.validateTimeCalibrationBackup, validator, "schema 12 校准 validator 明确转发给 prepareMediaArchive");
  equal(forwarded.options.supportedSchemaVersion, 12, "只读验真继续执行 future schema 上限");
  ok(forwarded.options.signal instanceof AbortSignal, "只读验真继续传递断连 AbortSignal");
  equal(fs.existsSync(path.join(root, ".inspect")), false, "成功验真后清理私有 staging 目录");

  let sent = false;
  const rejected = createArchiveInspectionApi({
    mediaRoot: root,
    supportedSchemaVersion: 12,
    validateVoiceBackup: () => true,
    validateTimeCalibrationBackup: validator,
    prepareMediaArchive: async (_source, options) => {
      equal(options.validateTimeCalibrationBackup, validator, "损坏归档同样走校准 validator");
      throw Object.assign(new Error("invalid calibration section"), { code: "MEDIA_ARCHIVE_FEATURE_INVALID" });
    },
    sendJson() { sent = true; },
    httpError(statusCode, message) { return Object.assign(new Error(message), { statusCode }); }
  });
  await rejectsCode(
    () => rejected.handle(requestFixture(), responseFixture(), { pathname: "/api/archive/inspect" }),
    "MEDIA_ARCHIVE_FEATURE_INVALID",
    "损坏 schema 12 时间校准 section 保持 fail closed"
  );
  equal(sent, false, "损坏校准归档不会返回可恢复摘要");
  equal(fs.existsSync(path.join(root, ".inspect")), false, "失败验真同样清理 staging 目录");
}

function checkDependencyBoundary(root) {
  const base = {
    mediaRoot: root,
    prepareMediaArchive: async () => preparedFixture(),
    validateVoiceBackup: () => true,
    sendJson: () => {},
    httpError: () => new Error("http")
  };
  throws(
    () => createArchiveInspectionApi({ ...base, supportedSchemaVersion: 12 }),
    TypeError,
    "schema 12 验真缺少时间校准 validator 时构造即失败"
  );
  throws(
    () => createArchiveInspectionApi({
      ...base,
      supportedSchemaVersion: 13,
      validateTimeCalibrationBackup: () => true
    }),
    TypeError,
    "schema 13 验真缺少口述史 validator 时构造即失败"
  );
  ok(
    createArchiveInspectionApi({ ...base, supportedSchemaVersion: 11 }),
    "schema 11 兼容验真不虚构 schema 12 依赖"
  );
}

function checkSafeCounts() {
  const full = summarize(preparedFixture({ mode: "full", calibrationCount: 3 }));
  equal(full.counts.timeCalibrations, 3, "完整归档只公开时间校准条数");
  const redacted = summarize(preparedFixture({ mode: "redacted", calibrationCount: 4 }));
  equal(redacted.counts.timeCalibrations, 4, "脱敏归档从固定摘要读取时间校准条数");
  const serialized = JSON.stringify(redacted);
  equal(serialized.includes("sourceSetSha256"), false, "验真摘要不暴露校准来源摘要");
  equal(serialized.includes("selectedSourceKeys"), false, "验真摘要不暴露所选来源键");
}

function preparedFixture(options = {}) {
  const count = options.calibrationCount || 0;
  const mode = options.mode || "full";
  const schemaVersion = options.schemaVersion || 12;
  const timeCalibrations = mode === "redacted"
    ? { mode: "redacted-summary", calibrationCount: count, uncertainCount: count, alternativesCount: 0, note: "fixed" }
    : { mode: "full", schemaVersion: 12, calibrations: Array.from({ length: count }, (_, index) => ({ id: `calibration-${index + 1}` })) };
  return {
    verified: true,
    manifest: {
      formatVersion: 2,
      schemaVersion,
      mode,
      exportedAt: "2026-07-18T10:00:00.000Z",
      entries: []
    },
    collection: {
      memories: [],
      timeCalibrations,
      ...(schemaVersion >= 13 ? {
        oralHistories: mode === "redacted"
          ? {
              mode: "redacted-summary",
              questionCount: options.oralQuestionCount || 0,
              answerCount: options.oralAnswerCount || 0,
              confirmedAnswerCount: options.confirmedOralAnswerCount || 0,
              note: "fixed"
            }
          : {
              mode: "full",
              schemaVersion: 13,
              questions: Array.from({ length: options.oralQuestionCount || 0 }, (_, index) => ({ id: `oral-question-${index}` })),
              answers: Array.from({ length: options.oralAnswerCount || 0 }, (_, index) => ({
                id: `oral-answer-${index}`,
                status: index < (options.confirmedOralAnswerCount || 0) ? "confirmed" : "draft"
              }))
            }
      } : {})
    },
    assets: []
  };
}

function requestFixture() {
  const request = new EventEmitter();
  request.method = "POST";
  request.headers = { "content-type": "application/vnd.time-isle" };
  return request;
}

function responseFixture() {
  const response = new EventEmitter();
  response.writableFinished = false;
  return response;
}

function ok(value, message) {
  assertions += 1;
  assert.ok(value, message);
}

function equal(actual, expected, message) {
  assertions += 1;
  assert.equal(actual, expected, message);
}

function throws(operation, expected, message) {
  assertions += 1;
  assert.throws(operation, expected, message);
}

async function rejectsCode(operation, code, message) {
  assertions += 1;
  await assert.rejects(operation, (error) => error?.code === code, message);
}
