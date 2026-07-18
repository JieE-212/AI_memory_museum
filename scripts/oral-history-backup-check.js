"use strict";

const assert = require("node:assert/strict");
const {
  ORAL_HISTORY_REDACTED_NOTE,
  assertRedactedOralHistoryPrivacy,
  oralHistoryEventIds,
  referencedOralVoiceAssetIds,
  validateOralHistoryArchiveEnvelope,
  validateOralHistoryArchiveState
} = require("../lib/oral-history-backup");
const { validateOralHistoryBackupPayload } = require("../lib/oral-history-database");
const { buildQuestionKey } = require("../lib/oral-history-service");

let assertions = 0;

main();

function main() {
  checkFullEnvelopeAndCrossSectionBoundary();
  checkStrictFailures();
  checkRedactedPrivacy();
  console.log(`Oral-history backup checks passed: ${assertions} assertions.`);
}

function checkFullEnvelopeAndCrossSectionBoundary() {
  const full = fullFixture();
  equal(validateOralHistoryArchiveEnvelope(full, "full"), 1, "完整口述史 section 以问题数作为安全 section count");
  deepEqual(referencedOralVoiceAssetIds(full), ["voice-oral"], "口述回答声音去重后进入声音归档边界");
  deepEqual(oralHistoryEventIds(full), ["event-oral"], "口述问题事件去重后进入事件恢复边界");

  let forwarded = null;
  equal(validateOralHistoryArchiveState(full, {
    mode: "full",
    eventIds: ["event-oral"],
    voiceAssetIds: ["voice-oral"],
    voiceAssets: [{ id: "voice-oral", status: "ready", durationMs: 20_000 }],
    validate(payload, boundaries) {
      forwarded = boundaries;
      return validateOralHistoryBackupPayload(payload, boundaries);
    }
  }), 1, "完整口述史同时通过归档根门禁和后端业务 validator");
  deepEqual(forwarded, { eventIds: ["event-oral"], voiceAssetIds: ["voice-oral"] }, "prepare 只向业务 validator 转发事件与声音 ID 边界");

  const duplicateAsset = structuredClone(full);
  duplicateAsset.answers.push({
    ...duplicateAsset.answers[0],
    id: "answer-oral-old",
    submissionId: "submission-oral-old",
    status: "superseded",
    supersededAt: "2026-07-18T10:01:00.000Z"
  });
  deepEqual(referencedOralVoiceAssetIds(duplicateAsset), ["voice-oral"], "多个历史回答共用声音时归档只携带一份真文件");
}

function checkStrictFailures() {
  const full = fullFixture();
  throwsCode(
    () => validateOralHistoryArchiveState(full, {
      mode: "full",
      eventIds: ["event-oral"],
      voiceAssetIds: ["voice-oral"],
      voiceAssets: [{ id: "voice-oral", status: "ready", durationMs: 20_000 }]
    }),
    "MEDIA_ARCHIVE_ORAL_HISTORY_VALIDATOR_REQUIRED",
    "完整口述史缺少业务 validator 时 fail closed"
  );
  throwsCode(
    () => validateOralHistoryArchiveState(full, {
      mode: "full",
      eventIds: ["event-outside"],
      voiceAssetIds: ["voice-oral"],
      voiceAssets: [{ id: "voice-oral", status: "ready", durationMs: 20_000 }],
      validate: validateOralHistoryBackupPayload
    }),
    "MEDIA_ARCHIVE_ORAL_HISTORY_INVALID",
    "馆藏外事件引用被统一包装为损坏口述史 section"
  );
  throwsCode(
    () => validateOralHistoryArchiveState(full, {
      mode: "full",
      eventIds: ["event-oral"],
      voiceAssetIds: ["voice-oral"],
      voiceAssets: [{ id: "voice-oral", status: "ready", durationMs: 5_000 }],
      validate: validateOralHistoryBackupPayload
    }),
    "MEDIA_ARCHIVE_ORAL_HISTORY_SEGMENT_INVALID",
    "片段终点越过已验真声音时长时在任何恢复写入前拒绝"
  );
  throwsCode(
    () => validateOralHistoryArchiveState(full, {
      mode: "full",
      eventIds: ["event-oral"],
      voiceAssetIds: ["voice-oral"],
      voiceAssets: [{ id: "voice-oral", status: "pending_delete", durationMs: 20_000 }],
      validate: validateOralHistoryBackupPayload
    }),
    "MEDIA_ARCHIVE_ORAL_HISTORY_INVALID",
    "口述回答不能引用非 ready 声音"
  );
  const unknown = { ...full, secret: true };
  throwsCode(() => validateOralHistoryArchiveEnvelope(unknown, "full"), "MEDIA_ARCHIVE_ORAL_HISTORY_INVALID", "完整 section 未知字段被精确门禁拒绝");
}

function checkRedactedPrivacy() {
  const redacted = {
    mode: "redacted-summary",
    questionCount: 1,
    answerCount: 2,
    confirmedAnswerCount: 1,
    note: ORAL_HISTORY_REDACTED_NOTE
  };
  equal(validateOralHistoryArchiveEnvelope(redacted, "redacted"), 1, "脱敏口述史只接受固定安全计数摘要");
  equal(assertRedactedOralHistoryPrivacy(redacted), true, "固定摘要通过物理隐私检查");
  for (const [name, payload] of [
    ["extra transcript", { ...redacted, transcriptText: "只存在于口述稿的秘密" }],
    ["extra offset", { ...redacted, segmentStartMs: 1234 }],
    ["extra hash", { ...redacted, note: `${ORAL_HISTORY_REDACTED_NOTE}${"a".repeat(64)}` }],
    ["contradictory count", { ...redacted, confirmedAnswerCount: 3 }]
  ]) {
    throwsCode(
      () => assertRedactedOralHistoryPrivacy(payload),
      name === "extra hash" ? "MEDIA_ARCHIVE_REDACTED_ORAL_HISTORY_FORBIDDEN" : undefined,
      `脱敏摘要拒绝 ${name}`
    );
  }
  const serialized = JSON.stringify(redacted);
  equal(/(?:event-oral|voice-oral|answer-oral|transcriptText|segmentStartMs|intervalStart|time-source:)/u.test(serialized), false, "脱敏摘要不含事件、声音、回答、文字稿、偏移、日期或来源键");
}

function fullFixture() {
  const sources = [
    source("a", "2018-06-01", "memory-left"),
    source("b", "2020-09-01", "memory-right")
  ];
  return {
    mode: "full",
    schemaVersion: 13,
    questions: [{
      id: "question-oral",
      eventId: "event-oral",
      questionKey: buildQuestionKey("event-oral", sources),
      text: "这段往事更接近什么时候？",
      sources,
      originSourceSetSha256: "c".repeat(64),
      createdAt: "2026-07-18T10:00:00.000Z",
      updatedAt: "2026-07-18T10:00:00.000Z"
    }],
    answers: [{
      id: "answer-oral",
      questionId: "question-oral",
      submissionId: "submission-oral",
      assetId: "voice-oral",
      segmentStartMs: 1_000,
      segmentEndMs: 10_000,
      transcriptText: "我记得是在二零二零年九月。",
      status: "confirmed",
      resolutionKind: "day",
      intervalStart: "2020-09-01",
      intervalEnd: "2020-09-01",
      createdAt: "2026-07-18T10:00:00.000Z",
      confirmedAt: "2026-07-18T10:00:00.000Z",
      supersededAt: "",
      withdrawnAt: ""
    }]
  };
}

function source(seed, day, memoryId) {
  return {
    sourceKey: `time-source:${seed.repeat(64)}`,
    sourceType: "memory-current",
    precision: "day",
    intervalStart: day,
    intervalEnd: day,
    memoryId,
    memoryTitle: `展品 ${memoryId}`
  };
}

function throwsCode(operation, expectedCode, message) {
  assertions += 1;
  assert.throws(operation, (error) => expectedCode ? error?.code === expectedCode : Boolean(error?.code), message);
}

function equal(actual, expected, message) {
  assertions += 1;
  assert.equal(actual, expected, message);
}

function deepEqual(actual, expected, message) {
  assertions += 1;
  assert.deepEqual(actual, expected, message);
}
