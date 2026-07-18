"use strict";

const { createHash } = require("node:crypto");
const {
  buildStableSourceKey,
  compareIntervals,
  normalizeCalibrationResolution
} = require("./time-calibration-service");

const ORAL_HISTORY_SCHEMA_VERSION = 13;
const MAX_QUESTION_TEXT_LENGTH = 500;
const MAX_TRANSCRIPT_LENGTH = 8_000;
const MAX_ANSWERS_PER_QUESTION = 100;
const SOURCE_PRIORITIES = new Map([
  ["memory-current", 1],
  ["raw-claim", 2],
  ["exif", 3],
  ["revision", 4]
]);

function buildOralHistoryQuestionSet(input = {}) {
  const event = normalizeEvent(input.event || input.workspace?.target);
  const workspace = isPlainObject(input.workspace) ? input.workspace : {};
  const calibration = isPlainObject(workspace.calibration) ? workspace.calibration : null;
  const calibrationState = describeCalibrationState(calibration, workspace.needsReview === true);
  const candidates = Array.isArray(workspace.candidates)
    ? workspace.candidates.filter(isEligibleOriginSource)
    : [];
  const pair = selectDisjointPair(candidates);
  let reason = "ready";
  if (!event.id || event.status !== "confirmed" || event.memberCount < 2) reason = "event_not_confirmed";
  else if (!pair) reason = "no_verified_date_difference";
  else if (calibrationState === "resolved") reason = "time_already_resolved";
  const eligible = reason === "ready";
  const question = eligible ? buildQuestion(event, pair, workspace.sourceSetSha256) : null;
  const questionSetSha256 = sha256(stableStringify({
    calibration: calibration ? {
      intervalEnd: String(calibration.intervalEnd || ""),
      intervalStart: String(calibration.intervalStart || ""),
      resolutionKind: String(calibration.resolutionKind || ""),
      sourceSetSha256: String(calibration.sourceSetSha256 || ""),
      updatedAt: String(calibration.updatedAt || "")
    } : null,
    calibrationState,
    currentSourceSetSha256: String(workspace.sourceSetSha256 || ""),
    eventId: event.id,
    eventMemberCount: event.memberCount,
    eventStatus: event.status,
    questionKey: question?.questionKey || "",
    reason
  }));
  return Object.freeze({
    event,
    eligibility: Object.freeze({ eligible, reason, calibrationState, needsReview: workspace.needsReview === true }),
    question,
    questionSetSha256
  });
}

function buildQuestion(event, pair, sourceSetSha256) {
  const sources = pair.map(sourceSnapshot).sort(compareSnapshots);
  const questionKey = buildQuestionKey(event.id, sources);
  const left = describeSource(sources[0]);
  const right = describeSource(sources[1]);
  const text = `同一段往事留下了“${left}”和“${right}”两种时间记录。你愿意留下一段声音，说说它更接近什么时候吗？记不清也可以保留不确定。`;
  return Object.freeze({
    id: "",
    eventId: event.id,
    questionKey,
    text: text.slice(0, MAX_QUESTION_TEXT_LENGTH),
    persisted: false,
    sources: Object.freeze(sources.map(Object.freeze)),
    originSourceSetSha256: requireSha256(sourceSetSha256, "sourceSetSha256")
  });
}

function buildQuestionKey(eventId, sources) {
  requireId(eventId, "eventId");
  const normalized = normalizeOriginSources(sources).map((source) => ({
    intervalEnd: source.intervalEnd,
    intervalStart: source.intervalStart,
    precision: source.precision,
    sourceKey: source.sourceKey,
    sourceType: source.sourceType
  }));
  // The event identity is already an independent component of the eventual
  // time-source key. Keeping the question identity semantic makes it stable
  // when a full archive remaps the local event ID.
  return `oral-question:${sha256(stableStringify({ sources: normalized }))}`;
}

function normalizeOriginSources(value) {
  if (!Array.isArray(value) || value.length !== 2) {
    throw oralHistoryError("口述史问题必须来自两条时间来源。", "ORAL_HISTORY_ORIGIN_INVALID");
  }
  const sources = value.map((item, index) => normalizeOriginSource(item, index)).sort(compareSnapshots);
  if (sources[0].sourceKey === sources[1].sourceKey || compareIntervals(sources[0], sources[1]) !== "disjoint") {
    throw oralHistoryError("口述史问题必须来自两条互相冲突的时间来源。", "ORAL_HISTORY_ORIGIN_INVALID");
  }
  return sources;
}

function normalizeAnswerSubmission(input = {}, asset = {}) {
  if (!isPlainObject(input)) throw oralHistoryError("口述史回答必须是对象。", "ORAL_HISTORY_ANSWER_INVALID");
  assertExactKeys(input, [
    "assetId", "confirm", "confirmTranscript", "intervalEnd", "intervalStart",
    "questionSetSha256", "resolutionKind", "segmentEndMs", "segmentStartMs",
    "submissionId", "transcriptText"
  ], "口述史回答");
  if (input.confirm !== true) {
    throw oralHistoryError("保存口述史回答需要 confirm: true。", "ORAL_HISTORY_CONFIRMATION_REQUIRED");
  }
  if (typeof input.confirmTranscript !== "boolean") {
    throw oralHistoryError("confirmTranscript 必须是布尔值。", "ORAL_HISTORY_ANSWER_INVALID");
  }
  const assetId = requireId(input.assetId, "assetId");
  if (assetId !== String(asset.id || "") || asset.status !== "ready") {
    throw oralHistoryError("只有已准备好的声音资产才能用于口述史。", "ORAL_HISTORY_ASSET_NOT_READY", 409);
  }
  const segmentStartMs = requireInteger(input.segmentStartMs, "segmentStartMs", 0, 3 * 60 * 1000 - 1);
  const segmentEndMs = requireInteger(input.segmentEndMs, "segmentEndMs", 1, 3 * 60 * 1000);
  const durationMs = requireInteger(asset.durationMs, "asset.durationMs", 1, 3 * 60 * 1000);
  if (segmentStartMs >= segmentEndMs || segmentEndMs > durationMs) {
    throw oralHistoryError("声音时间段必须由用户划定，并且位于音频时长之内。", "ORAL_HISTORY_SEGMENT_INVALID");
  }
  const transcriptText = requireText(input.transcriptText, "transcriptText", MAX_TRANSCRIPT_LENGTH);
  const resolutionKind = String(input.resolutionKind || "").trim();
  if (!new Set(["day", "range", "uncertain"]).has(resolutionKind)) {
    throw oralHistoryError("resolutionKind 仅支持 day、range 或 uncertain。", "ORAL_HISTORY_RESOLUTION_INVALID");
  }
  const resolution = normalizeCalibrationResolution({
    resolutionKind,
    intervalStart: input.intervalStart,
    intervalEnd: input.intervalEnd
  });
  return Object.freeze({
    submissionId: requireSubmissionId(input.submissionId),
    assetId,
    segmentStartMs,
    segmentEndMs,
    transcriptText,
    status: input.confirmTranscript ? "confirmed" : "draft",
    resolutionKind: resolution.resolutionKind,
    intervalStart: resolution.intervalStart,
    intervalEnd: resolution.intervalEnd,
    questionSetSha256: requireSha256(input.questionSetSha256, "questionSetSha256")
  });
}

function buildSubmissionRequestSha256(submission) {
  if (!isPlainObject(submission)) {
    throw oralHistoryError("口述史提交摘要输入无效。", "ORAL_HISTORY_ANSWER_INVALID");
  }
  return sha256(stableStringify({
    assetId: requireId(submission.assetId, "assetId"),
    confirm: true,
    confirmTranscript: submission.status === "confirmed",
    intervalEnd: String(submission.intervalEnd || ""),
    intervalStart: String(submission.intervalStart || ""),
    questionSetSha256: requireSha256(submission.questionSetSha256, "questionSetSha256"),
    resolutionKind: String(submission.resolutionKind || ""),
    segmentEndMs: requireInteger(submission.segmentEndMs, "segmentEndMs", 1, 3 * 60 * 1000),
    segmentStartMs: requireInteger(submission.segmentStartMs, "segmentStartMs", 0, 3 * 60 * 1000 - 1),
    submissionId: requireSubmissionId(submission.submissionId),
    transcriptText: requireText(submission.transcriptText, "transcriptText", MAX_TRANSCRIPT_LENGTH)
  }));
}

function buildOralHistoryTimeCandidate(input = {}) {
  const question = input.question;
  const answer = input.answer;
  const asset = input.asset;
  const event = input.event;
  if (!isPlainObject(question) || !isPlainObject(answer) || !isPlainObject(asset) || !isPlainObject(event)) return null;
  if (answer.status !== "confirmed" || !["day", "range"].includes(answer.resolutionKind) || asset.status !== "ready") return null;
  const resolution = normalizeCalibrationResolution(answer);
  const candidate = {
    sourceType: "oral-history",
    status: "confirmed",
    precision: resolution.precision,
    intervalStart: resolution.intervalStart,
    intervalEnd: resolution.intervalEnd,
    displayDate: resolution.value,
    eventId: requireId(event.id, "event.id"),
    eventTitle: String(event.title || "").trim().slice(0, 120),
    questionKey: requireQuestionKey(question.questionKey),
    assetContentSha256: requireSha256(asset.contentSha256, "asset.contentSha256"),
    segmentStartMs: requireInteger(answer.segmentStartMs, "segmentStartMs", 0, 3 * 60 * 1000 - 1),
    segmentEndMs: requireInteger(answer.segmentEndMs, "segmentEndMs", 1, 3 * 60 * 1000),
    transcriptSha256: sha256(String(answer.transcriptText || "")),
    transcriptExcerpt: String(answer.transcriptText || "").replace(/\s+/gu, " ").trim().slice(0, 180)
  };
  candidate.sourceKey = buildStableSourceKey(candidate);
  return Object.freeze(candidate);
}

function selectDisjointPair(candidates) {
  const pairs = [];
  for (let leftIndex = 0; leftIndex < candidates.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < candidates.length; rightIndex += 1) {
      const left = candidates[leftIndex];
      const right = candidates[rightIndex];
      if (compareIntervals(left, right) !== "disjoint") continue;
      pairs.push([left, right]);
    }
  }
  pairs.sort((left, right) => {
    const leftCrossMemory = Number(Boolean(left[0].memoryId && left[1].memoryId && left[0].memoryId !== left[1].memoryId));
    const rightCrossMemory = Number(Boolean(right[0].memoryId && right[1].memoryId && right[0].memoryId !== right[1].memoryId));
    if (leftCrossMemory !== rightCrossMemory) return rightCrossMemory - leftCrossMemory;
    const leftPriority = sourcePriority(left[0]) + sourcePriority(left[1]);
    const rightPriority = sourcePriority(right[0]) + sourcePriority(right[1]);
    return leftPriority - rightPriority || pairIdentity(left).localeCompare(pairIdentity(right), "en");
  });
  return pairs[0] || null;
}

function sourceSnapshot(source) {
  return {
    sourceKey: String(source.sourceKey || ""),
    sourceType: String(source.sourceType || ""),
    precision: String(source.precision || ""),
    intervalStart: String(source.intervalStart || ""),
    intervalEnd: String(source.intervalEnd || ""),
    memoryId: String(source.memoryId || ""),
    memoryTitle: String(source.memoryTitle || "").slice(0, 120)
  };
}

function normalizeOriginSource(source, index) {
  if (!isPlainObject(source)) throw oralHistoryError(`originSources[${index}] 无效。`, "ORAL_HISTORY_ORIGIN_INVALID");
  const result = sourceSnapshot(source);
  if (!/^time-source:[a-f0-9]{64}$/u.test(result.sourceKey) || !result.sourceType || result.sourceType === "oral-history" ||
      !["year", "month", "day", "range"].includes(result.precision) ||
      !/^\d{4}-\d{2}-\d{2}$/u.test(result.intervalStart) ||
      !/^\d{4}-\d{2}-\d{2}$/u.test(result.intervalEnd) || result.intervalStart > result.intervalEnd) {
    throw oralHistoryError(`originSources[${index}] 无效。`, "ORAL_HISTORY_ORIGIN_INVALID");
  }
  if (result.memoryId && !/^[a-zA-Z0-9_-]{1,120}$/u.test(result.memoryId)) {
    throw oralHistoryError(`originSources[${index}].memoryId 无效。`, "ORAL_HISTORY_ORIGIN_INVALID");
  }
  return result;
}

function isEligibleOriginSource(source) {
  return isPlainObject(source) && source.sourceType !== "oral-history" &&
    /^time-source:[a-f0-9]{64}$/u.test(String(source.sourceKey || "")) &&
    /^\d{4}-\d{2}-\d{2}$/u.test(String(source.intervalStart || "")) &&
    /^\d{4}-\d{2}-\d{2}$/u.test(String(source.intervalEnd || ""));
}

function normalizeEvent(value) {
  const source = isPlainObject(value) ? value : {};
  return Object.freeze({
    id: /^[a-zA-Z0-9_-]{1,120}$/u.test(String(source.id || "")) ? String(source.id) : "",
    title: String(source.title || "").trim().slice(0, 160),
    status: String(source.status || ""),
    memberCount: Number.isSafeInteger(Number(source.memberCount)) ? Number(source.memberCount) : 0
  });
}

function describeCalibrationState(calibration, needsReview) {
  if (needsReview) return "needs_review";
  if (!calibration) return "empty";
  if (calibration.resolutionKind === "alternatives") return "alternatives";
  if (calibration.resolutionKind === "uncertain") return "uncertain";
  return "resolved";
}

function describeSource(source) {
  if (source.intervalStart === source.intervalEnd) return source.intervalStart;
  if (source.precision === "year") return source.intervalStart.slice(0, 4);
  if (source.precision === "month") return source.intervalStart.slice(0, 7);
  return `${source.intervalStart} 至 ${source.intervalEnd}`;
}

function compareSnapshots(left, right) {
  return left.intervalStart.localeCompare(right.intervalStart, "en") ||
    left.intervalEnd.localeCompare(right.intervalEnd, "en") ||
    left.sourceKey.localeCompare(right.sourceKey, "en");
}

function pairIdentity(pair) {
  return pair.map((source) => String(source.sourceKey || "")).sort().join("\0");
}

function sourcePriority(source) {
  return SOURCE_PRIORITIES.get(source.sourceType) || 9;
}

function requireId(value, name) {
  const id = String(value || "").trim();
  if (!/^[a-zA-Z0-9_-]{1,120}$/u.test(id)) throw oralHistoryError(`${name} 无效。`, "ORAL_HISTORY_ID_INVALID");
  return id;
}

function requireSubmissionId(value) {
  const id = String(value || "").trim();
  if (!/^[a-zA-Z0-9_-]{8,120}$/u.test(id)) {
    throw oralHistoryError("submissionId 无效。", "ORAL_HISTORY_SUBMISSION_ID_INVALID");
  }
  return id;
}

function requireQuestionKey(value) {
  const key = String(value || "");
  if (!/^oral-question:[a-f0-9]{64}$/u.test(key)) {
    throw oralHistoryError("questionKey 无效。", "ORAL_HISTORY_QUESTION_KEY_INVALID");
  }
  return key;
}

function requireSha256(value, name) {
  const hash = String(value || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(hash)) throw oralHistoryError(`${name} 必须是 SHA-256。`, "ORAL_HISTORY_HASH_INVALID");
  return hash;
}

function requireInteger(value, name, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw oralHistoryError(`${name} 必须是 ${minimum} 至 ${maximum} 的整数。`, "ORAL_HISTORY_VALUE_INVALID");
  }
  return value;
}

function requireText(value, name, maximum) {
  if (typeof value !== "string") throw oralHistoryError(`${name} 必须是文本。`, "ORAL_HISTORY_VALUE_INVALID");
  const text = value.trim();
  if (!text || text.length > maximum || text.includes("\0")) {
    throw oralHistoryError(`${name} 不能为空且最多 ${maximum} 字。`, "ORAL_HISTORY_VALUE_INVALID");
  }
  return text;
}

function assertExactKeys(value, expected, name) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw oralHistoryError(`${name} 字段集合无效。`, "ORAL_HISTORY_FIELD_SET_INVALID");
  }
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function oralHistoryError(message, code, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

module.exports = {
  MAX_ANSWERS_PER_QUESTION,
  MAX_QUESTION_TEXT_LENGTH,
  MAX_TRANSCRIPT_LENGTH,
  ORAL_HISTORY_SCHEMA_VERSION,
  buildSubmissionRequestSha256,
  buildOralHistoryQuestionSet,
  buildOralHistoryTimeCandidate,
  buildQuestionKey,
  normalizeAnswerSubmission,
  normalizeOriginSources,
  oralHistoryError,
  sha256,
  stableStringify
};
