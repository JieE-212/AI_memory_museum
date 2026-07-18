"use strict";

const ORAL_HISTORY_SCHEMA_VERSION = 13;
const ORAL_HISTORY_SECTION_VERSION = 1;
const ORAL_HISTORY_SECTION_NAME = "oral-history";
const ORAL_HISTORY_SECTION_PATH = "oral-history/state.json";
const ORAL_HISTORY_ARCHIVE_PREFIX = "oral-history/";
const ORAL_HISTORY_REDACTED_NOTE = "口述问题、回答、声音片段、文字稿、日期、内部标识、哈希与文件名已从脱敏备份中移除。";
const MAX_ORAL_HISTORY_QUESTIONS = 1000;
const MAX_ORAL_HISTORY_ANSWERS = 100000;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,120}$/u;
const FULL_KEYS = Object.freeze(["answers", "mode", "questions", "schemaVersion"]);
const REDACTED_KEYS = Object.freeze([
  "answerCount",
  "confirmedAnswerCount",
  "mode",
  "note",
  "questionCount"
]);

function validateOralHistoryArchiveEnvelope(payload, mode) {
  assertPlainObject(payload, "oral-history state");
  if (payload.mode === "full") {
    assertExactKeys(payload, FULL_KEYS, "oral-history full state");
    if (mode !== undefined && mode !== "full") {
      fail("口述史状态与归档隐私模式不一致。", "MEDIA_ARCHIVE_MODE_MISMATCH");
    }
    if (payload.schemaVersion !== ORAL_HISTORY_SCHEMA_VERSION ||
        !Array.isArray(payload.questions) || payload.questions.length > MAX_ORAL_HISTORY_QUESTIONS ||
        !Array.isArray(payload.answers) || payload.answers.length > MAX_ORAL_HISTORY_ANSWERS) {
      fail("完整口述史状态的版本或数量无效。", "MEDIA_ARCHIVE_ORAL_HISTORY_INVALID");
    }
    return payload.questions.length;
  }

  if (payload.mode !== "redacted-summary") {
    fail("口述史备份模式无效。", "MEDIA_ARCHIVE_ORAL_HISTORY_INVALID");
  }
  assertExactKeys(payload, REDACTED_KEYS, "oral-history redacted state");
  if (mode !== undefined && mode !== "redacted") {
    fail("口述史状态与归档隐私模式不一致。", "MEDIA_ARCHIVE_MODE_MISMATCH");
  }
  const questionCount = requireCount(payload.questionCount, "questionCount", MAX_ORAL_HISTORY_QUESTIONS);
  const answerCount = requireCount(payload.answerCount, "answerCount", MAX_ORAL_HISTORY_ANSWERS);
  const confirmedAnswerCount = requireCount(
    payload.confirmedAnswerCount,
    "confirmedAnswerCount",
    answerCount
  );
  if (typeof payload.note !== "string" || payload.note !== ORAL_HISTORY_REDACTED_NOTE ||
      confirmedAnswerCount > answerCount || (questionCount === 0 && answerCount !== 0)) {
    fail("脱敏口述史摘要无效或统计互相矛盾。", "MEDIA_ARCHIVE_REDACTED_ORAL_HISTORY_FORBIDDEN");
  }
  return questionCount;
}

function validateOralHistoryArchiveState(payload, options = {}) {
  assertPlainObject(options, "oral-history validation options");
  const count = validateOralHistoryArchiveEnvelope(payload, options.mode);
  if (payload.mode !== "full") return count;
  if (typeof options.validate !== "function") {
    fail("完整口述史归档缺少严格校验处理器。", "MEDIA_ARCHIVE_ORAL_HISTORY_VALIDATOR_REQUIRED");
  }
  const eventIds = normalizeIdList(options.eventIds, "eventIds");
  const voiceAssetIds = normalizeIdList(options.voiceAssetIds, "voiceAssetIds");
  if (options.voiceAssets !== undefined) validateOralVoiceBoundaries(payload, options.voiceAssets);
  try {
    const result = options.validate(payload, { eventIds, voiceAssetIds });
    if (result && typeof result.then === "function") {
      throw new TypeError("validateOralHistoryBackup 必须同步执行。");
    }
    if (result !== true) {
      fail("口述史状态未通过业务校验。", "MEDIA_ARCHIVE_ORAL_HISTORY_INVALID");
    }
  } catch (cause) {
    if (String(cause?.code || "").startsWith("MEDIA_ARCHIVE_")) throw cause;
    fail(
      `口述史状态无法通过业务校验：${cause?.message || "未知错误"}`,
      "MEDIA_ARCHIVE_ORAL_HISTORY_INVALID",
      cause
    );
  }
  return count;
}

function validateOralVoiceBoundaries(payload, voiceAssets) {
  if (!Array.isArray(voiceAssets)) {
    fail("voiceAssets 必须是声音资产数组。", "MEDIA_ARCHIVE_ORAL_HISTORY_INVALID");
  }
  const assets = new Map();
  for (let index = 0; index < voiceAssets.length; index += 1) {
    const asset = voiceAssets[index];
    if (!asset || typeof asset !== "object" || Array.isArray(asset)) {
      fail(`voiceAssets[${index}] 必须是对象。`, "MEDIA_ARCHIVE_ORAL_HISTORY_INVALID");
    }
    const id = requireId(asset.id, `voiceAssets[${index}].id`);
    if (assets.has(id) || asset.status !== "ready" || !Number.isSafeInteger(asset.durationMs) || asset.durationMs < 1) {
      fail("口述史引用的声音资产边界无效。", "MEDIA_ARCHIVE_ORAL_HISTORY_INVALID");
    }
    assets.set(id, asset);
  }
  for (let index = 0; index < payload.answers.length; index += 1) {
    const answer = payload.answers[index];
    if (!answer || typeof answer !== "object" || Array.isArray(answer)) {
      fail(`answers[${index}] 必须是对象。`, "MEDIA_ARCHIVE_ORAL_HISTORY_INVALID");
    }
    const asset = assets.get(requireId(answer.assetId, `answers[${index}].assetId`));
    if (!asset || !Number.isSafeInteger(answer.segmentStartMs) || !Number.isSafeInteger(answer.segmentEndMs) ||
        answer.segmentStartMs < 0 || answer.segmentEndMs <= answer.segmentStartMs ||
        answer.segmentEndMs > asset.durationMs) {
      fail("口述史声音片段越过已验真声音边界。", "MEDIA_ARCHIVE_ORAL_HISTORY_SEGMENT_INVALID");
    }
  }
}

function referencedOralVoiceAssetIds(payload) {
  validateOralHistoryArchiveEnvelope(payload);
  if (payload.mode !== "full") return [];
  const output = [];
  const seen = new Set();
  for (let index = 0; index < payload.answers.length; index += 1) {
    const answer = payload.answers[index];
    if (!answer || typeof answer !== "object" || Array.isArray(answer)) {
      fail(`answers[${index}] 必须是对象。`, "MEDIA_ARCHIVE_ORAL_HISTORY_INVALID");
    }
    const assetId = requireId(answer.assetId, `answers[${index}].assetId`);
    if (seen.has(assetId)) continue;
    seen.add(assetId);
    output.push(assetId);
  }
  return output.sort((left, right) => left.localeCompare(right, "en"));
}

function oralHistoryEventIds(payload) {
  validateOralHistoryArchiveEnvelope(payload);
  if (payload.mode !== "full") return [];
  const output = [];
  const seen = new Set();
  for (let index = 0; index < payload.questions.length; index += 1) {
    const question = payload.questions[index];
    if (!question || typeof question !== "object" || Array.isArray(question)) {
      fail(`questions[${index}] 必须是对象。`, "MEDIA_ARCHIVE_ORAL_HISTORY_INVALID");
    }
    const eventId = requireId(question.eventId, `questions[${index}].eventId`);
    if (seen.has(eventId)) continue;
    seen.add(eventId);
    output.push(eventId);
  }
  return output.sort((left, right) => left.localeCompare(right, "en"));
}

function assertRedactedOralHistoryPrivacy(payload) {
  validateOralHistoryArchiveEnvelope(payload, "redacted");
  const serialized = JSON.stringify(payload);
  if (/"(?:questions|answers|id|eventId|questionId|assetId|questionKey|text|transcriptText|segmentStartMs|segmentEndMs|resolutionKind|intervalStart|intervalEnd|originSources|originSourceSetSha256|submissionId|createdAt|confirmedAt|supersededAt|withdrawnAt|filename|path|hash|sourceKey)"\s*:/iu.test(serialized) ||
      /[a-f0-9]{64}/iu.test(serialized)) {
    fail(
      "脱敏口述史摘要泄露了问题、回答、片段、日期、标识、哈希或精确时间。",
      "MEDIA_ARCHIVE_REDACTED_ORAL_HISTORY_FORBIDDEN"
    );
  }
  return true;
}

function normalizeIdList(value, name) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) && !(value instanceof Set)) {
    fail(`${name} 必须是 ID 集合。`, "MEDIA_ARCHIVE_ORAL_HISTORY_INVALID");
  }
  const output = [...value].map((item, index) => requireId(item, `${name}[${index}]`));
  if (new Set(output).size !== output.length) {
    fail(`${name} 不能包含重复 ID。`, "MEDIA_ARCHIVE_ORAL_HISTORY_INVALID");
  }
  return output;
}

function requireId(value, name) {
  const id = String(value || "").trim();
  if (!ID_PATTERN.test(id)) {
    fail(`${name} 无效。`, "MEDIA_ARCHIVE_ORAL_HISTORY_INVALID");
  }
  return id;
}

function requireCount(value, name, maximum) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    fail(`${name} 无效。`, "MEDIA_ARCHIVE_ORAL_HISTORY_INVALID");
  }
  return value;
}

function assertPlainObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${name} 必须是对象。`, "MEDIA_ARCHIVE_ORAL_HISTORY_INVALID");
  }
  return value;
}

function assertExactKeys(value, expected, name) {
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (keys.length !== wanted.length || keys.some((key, index) => key !== wanted[index])) {
    fail(`${name} 字段无效。`, "MEDIA_ARCHIVE_ORAL_HISTORY_INVALID");
  }
}

function fail(message, code, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  error.statusCode = 400;
  throw error;
}

module.exports = {
  MAX_ORAL_HISTORY_ANSWERS,
  MAX_ORAL_HISTORY_QUESTIONS,
  ORAL_HISTORY_ARCHIVE_PREFIX,
  ORAL_HISTORY_REDACTED_NOTE,
  ORAL_HISTORY_SCHEMA_VERSION,
  ORAL_HISTORY_SECTION_NAME,
  ORAL_HISTORY_SECTION_PATH,
  ORAL_HISTORY_SECTION_VERSION,
  assertRedactedOralHistoryPrivacy,
  oralHistoryEventIds,
  referencedOralVoiceAssetIds,
  validateOralHistoryArchiveEnvelope,
  validateOralHistoryArchiveState
};
