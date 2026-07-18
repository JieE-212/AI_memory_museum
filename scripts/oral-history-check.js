"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const { createMemoryStore } = require("../database");
const { createOralHistoryApi } = require("../lib/oral-history-api");
const { buildQuestionKey, MAX_ANSWERS_PER_QUESTION } = require("../lib/oral-history-service");

let assertions = 0;

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  checkQuestionIdentity();
  const source = createFixture("source", { memoryA: "memory-a", memoryB: "memory-b", eventId: "event-a", assetId: "voice-a" });
  let backup;
  let timeBackup;
  try {
    checkMigration(source);
    const initial = source.store.getOralHistoryEventWorkspace(source.eventId);
    equal(initial.eligibility.eligible, true, "confirmed event with disjoint dates is eligible");
    equal(initial.eligibility.calibrationState, "empty", "empty calibration remains unresolved");
    equal(initial.question.persisted, false, "GET returns a proposal without persisting it");
    equal(source.store.getOralHistoryStats().questions, 0, "proposal GET performs zero writes");
    equal(initial.question.sources.length, 2, "proposal carries exactly two verified sources");

    const draftInput = answerInput(initial, source.assetId, "submission-draft-0001", false, "day", "2021-01-01", "2021-01-01");
    let saved = source.store.saveOralHistoryAnswer(source.eventId, draftInput);
    equal(saved.created, true, "draft submission creates an append-only answer");
    equal(saved.workspace.currentDraft.status, "draft", "confirmTranscript false saves a draft");
    equal(saved.workspace.currentConfirmed, null, "draft does not invent a confirmed answer");
    equal(oralCandidates(source).length, 0, "draft never becomes a time candidate");
    equal(source.store.getVoiceUsage(source.assetId).oralHistoryCount, 1, "voice usage includes oral-history rows");
    equal(source.store.listUnreferencedVoiceAssets({ status: "ready" }).length, 0, "voice GC excludes oral-history assets");

    saved = source.store.saveOralHistoryAnswer(source.eventId, draftInput);
    equal(saved.created, false, "submissionId retry is idempotent");
    equal(saved.idempotent, true, "idempotent retry is reported explicitly");
    equal(source.store.getOralHistoryStats().answers, 1, "idempotent retry does not append a duplicate");

    const confirmedInput = answerInput(initial, source.assetId, "submission-confirmed-0001", true, "day", "2021-01-01", "2021-01-01");
    saved = source.store.saveOralHistoryAnswer(source.eventId, confirmedInput);
    equal(saved.workspace.currentConfirmed.status, "confirmed", "manual confirmation creates the current confirmed answer");
    equal(saved.workspace.history.find((item) => item.submissionId === draftInput.submissionId).status, "superseded", "new confirmation supersedes the prior draft atomically");
    equal(oralCandidates(source).length, 1, "confirmed day answer becomes one time candidate");
    equal(oralCandidates(source)[0].eventId, source.eventId, "oral source is anchored to the event, not an arbitrary member");
    equal(oralCandidates(source)[0].transcriptExcerpt, confirmedInput.transcriptText, "manual transcript remains reviewable");

    const uncertainInput = answerInput(saved.workspace, source.assetId, "submission-confirmed-uncertain", true, "uncertain", "", "");
    saved = source.store.saveOralHistoryAnswer(source.eventId, uncertainInput);
    equal(saved.workspace.currentConfirmed.resolutionKind, "uncertain", "confirmed uncertainty remains valid oral evidence");
    equal(oralCandidates(source).length, 0, "confirmed uncertainty never masquerades as a dated time source");

    const secondInput = answerInput(saved.workspace, source.assetId, "submission-confirmed-0002", true, "range", "2021-01-01", "2021-01-03");
    saved = source.store.saveOralHistoryAnswer(source.eventId, secondInput);
    equal(saved.workspace.currentConfirmed.submissionId, secondInput.submissionId, "latest confirmed answer is current");
    equal(saved.workspace.history.find((item) => item.submissionId === confirmedInput.submissionId).status, "superseded", "new confirmation supersedes the old confirmation");
    equal(oralCandidates(source)[0].precision, "range", "manual range is preserved without transcript inference");

    const calibrationWorkspace = source.store.getEventCalibrationWorkspace(source.eventId);
    const oralSource = calibrationWorkspace.candidates.find((item) => item.sourceType === "oral-history");
    source.store.saveEventTimeCalibration(source.eventId, {
      resolutionKind: "range",
      intervalStart: oralSource.intervalStart,
      intervalEnd: oralSource.intervalEnd,
      selectedSourceKeys: [oralSource.sourceKey],
      sourceSetSha256: calibrationWorkspace.sourceSetSha256,
      note: "只确认口述来源支持的范围"
    });
    equal(source.store.getEventCalibrationWorkspace(source.eventId).needsReview, false, "calibration can explicitly select the confirmed oral source");
    const resolvedWorkspace = source.store.getOralHistoryEventWorkspace(source.eventId);
    equal(resolvedWorkspace.eligibility.reason, "time_already_resolved", "resolved calibration stops generating an answerable question");
    equal(resolvedWorkspace.eligibility.canAnswer, false, "persisted question becomes read-only after time is resolved");
    throwsCode(
      () => source.store.saveOralHistoryAnswer(source.eventId, answerInput(
        resolvedWorkspace, source.assetId, "submission-after-resolved", false, "uncertain", "", ""
      )),
      "ORAL_HISTORY_NOT_ELIGIBLE",
      "resolved event rejects a new oral answer"
    );

    throwsCode(
      () => source.store.saveOralHistoryAnswer(source.eventId, { ...secondInput, questionSetSha256: source.store.getOralHistoryEventWorkspace(source.eventId).questionSetSha256, submissionId: "submission-bad-segment", segmentEndMs: 20_000 }),
      "ORAL_HISTORY_SEGMENT_INVALID",
      "segment cannot exceed real asset duration"
    );
    throwsCode(
      () => source.store.saveOralHistoryAnswer(source.eventId, { ...secondInput, questionSetSha256: source.store.getOralHistoryEventWorkspace(source.eventId).questionSetSha256, submissionId: "submission-bad-fields", transcriptText: undefined }),
      "ORAL_HISTORY_VALUE_INVALID",
      "manual transcript is required"
    );
    throwsCode(
      () => source.store.saveOralHistoryAnswer(source.eventId, { ...secondInput, submissionId: "submission-stale-set", questionSetSha256: "f".repeat(64) }),
      "ORAL_HISTORY_QUESTION_SET_CHANGED",
      "changed question set rejects stale writes"
    );
    throwsCode(
      () => source.store.deleteVoiceAsset(source.assetId),
      "VOICE_ASSET_IN_USE",
      "ordinary voice deletion cannot remove an oral-history asset"
    );

    backup = source.store.buildOralHistoryBackup("full");
    timeBackup = source.store.buildTimeCalibrationBackup("full", ["memory-a", "memory-b"]);
    equal(backup.schemaVersion, 13, "full oral-history backup declares schema 13");
    equal(backup.questions.length, 1, "full backup contains the persisted question");
    equal(backup.answers.length, 4, "full backup preserves append-only answer history");
    const reversedLifecycle = structuredClone(backup);
    const supersededAnswer = reversedLifecycle.answers.find((answer) => answer.status === "superseded");
    supersededAnswer.supersededAt = "2000-01-01T00:00:00.000Z";
    throwsCode(
      () => source.store.validateOralHistoryBackup(reversedLifecycle, {
        eventIds: [source.eventId], voiceAssetIds: [source.assetId]
      }),
      "ORAL_HISTORY_BACKUP_INVALID",
      "backup rejects lifecycle timestamps earlier than answer creation"
    );

    const overLimitBackup = structuredClone(backup);
    const historicalAnswer = overLimitBackup.answers.find((answer) => answer.status === "superseded");
    overLimitBackup.answers = Array.from({ length: MAX_ANSWERS_PER_QUESTION + 1 }, (_, index) => ({
      ...historicalAnswer,
      id: `answer-backup-limit-${String(index).padStart(3, "0")}`,
      submissionId: `submission-backup-limit-${String(index).padStart(3, "0")}`
    }));
    throwsCode(
      () => source.store.validateOralHistoryBackup(overLimitBackup, {
        eventIds: [source.eventId], voiceAssetIds: [source.assetId]
      }),
      "ORAL_HISTORY_BACKUP_INVALID",
      "backup validator rejects the 101st answer for one question"
    );
    const beforeRejectedRestore = source.store.getOralHistoryStats();
    throwsCode(
      () => source.store.restoreOralHistoryBackup(overLimitBackup, {
        memoryIdMap: new Map([["memory-a", "memory-a"], ["memory-b", "memory-b"]]),
        eventIdMap: new Map([["event-a", "event-a"]]),
        assetIdMap: new Map([["voice-a", "voice-a"]])
      }),
      "ORAL_HISTORY_BACKUP_INVALID",
      "restore rejects the 101st answer before opening a write transaction"
    );
    deepEqual(source.store.getOralHistoryStats(), beforeRejectedRestore, "rejected over-limit restore performs zero writes");

    const dualTerminalBackup = structuredClone(backup);
    const dualTerminalAnswer = dualTerminalBackup.answers.find((answer) => answer.status === "superseded");
    dualTerminalAnswer.status = "withdrawn";
    dualTerminalAnswer.withdrawnAt = dualTerminalAnswer.supersededAt;
    throwsCode(
      () => source.store.validateOralHistoryBackup(dualTerminalBackup, {
        eventIds: [source.eventId], voiceAssetIds: [source.assetId]
      }),
      "ORAL_HISTORY_BACKUP_INVALID",
      "withdrawn backup answer rejects a simultaneous superseded terminal timestamp"
    );

    const beforeWithdraw = source.store.getOralHistoryEventWorkspace(source.eventId);
    const withdrawn = source.store.withdrawOralHistoryAnswers(source.eventId, {
      questionSetSha256: beforeWithdraw.questionSetSha256,
      confirm: true
    });
    equal(withdrawn.withdrawnCount, 1, "DELETE lifecycle withdraws the current confirmation");
    equal(withdrawn.workspace.currentConfirmed, null, "withdraw leaves no active confirmed source");
    equal(oralCandidates(source).length, 0, "withdrawn answer no longer becomes a time candidate");
    equal(source.store.getVoiceUsage(source.assetId).oralHistoryCount, 4, "withdraw does not delete answer provenance or audio references");

    await checkApi(source);
    const purged = source.store.purgeAll();
    equal(purged.oralHistoryQuestionsDeleted, 1, "purge clears oral questions before voice assets");
    equal(purged.oralHistoryAnswersDeleted, 6, "purge clears all append-only oral answers before voice assets");
    equal(source.store.getVoiceStats().assets, 0, "purge can remove voice assets after oral references are cleared");
  } finally {
    source.close();
  }

  const target = createFixture("target", {
    memoryA: "target-memory-a", memoryB: "target-memory-b", eventId: "target-event", assetId: "target-voice"
  });
  try {
    const restored = target.store.restoreOralHistoryBackup(backup, {
      memoryIdMap: new Map([["memory-a", "target-memory-a"], ["memory-b", "target-memory-b"]]),
      eventIdMap: new Map([["event-a", "target-event"]]),
      assetIdMap: new Map([["voice-a", "target-voice"]])
    });
    equal(restored.questions, 1, "restore maps every question");
    equal(restored.answers, 4, "restore maps the append-only answer history");
    equal(restored.skipped, 0, "restore is all-or-nothing");
    const workspace = target.store.getOralHistoryEventWorkspace(target.eventId);
    ok(workspace.question.sources.every((source) => source.memoryId.startsWith("target-memory-")), "restore rewrites source memory IDs");
    ok(workspace.question.sources.every((source) => source.sourceKey.startsWith("time-source:")), "restore rebuilds stable source keys");
    equal(workspace.currentConfirmed.resolutionKind, "range", "restored current confirmation remains active");
    equal(oralCandidates(target).length, 1, "restored confirmation re-enters the time source set");
    equal(oralCandidates(target)[0].eventId, "target-event", "restored oral source uses mapped event identity");
    const restoredCalibration = target.store.restoreTimeCalibrationBackup(timeBackup, {
      memoryIdMap: new Map([["memory-a", "target-memory-a"], ["memory-b", "target-memory-b"]]),
      eventIdMap: new Map([["event-a", "target-event"]]),
      oralQuestionKeyMap: new Map(Object.entries(restored.idMap.questionKeys)),
      sourceMode: "time-isle"
    });
    equal(restoredCalibration.calibrations, 1, "time calibration selected oral source restores completely");
    const targetCalibrationWorkspace = target.store.getEventCalibrationWorkspace(target.eventId);
    equal(targetCalibrationWorkspace.needsReview, false, "mapped oral source preserves the calibration current boundary");
    equal(targetCalibrationWorkspace.calibration.selectedSourceKeys[0], oralCandidates(target)[0].sourceKey, "selected oral source key maps to the target event identity");
  } finally {
    target.close();
  }

  checkQuestionRotation();
  checkAnswerLimit();

  console.log(`Oral-history checks passed: ${assertions} assertions.`);
}

function checkQuestionIdentity() {
  const baseSources = [{
    sourceKey: `time-source:${"1".repeat(64)}`,
    sourceType: "memory-current", precision: "day",
    intervalStart: "2020-01-01", intervalEnd: "2020-01-01",
    memoryId: "identity-a", memoryTitle: "A"
  }, {
    sourceKey: `time-source:${"2".repeat(64)}`,
    sourceType: "memory-current", precision: "day",
    intervalStart: "2021-01-01", intervalEnd: "2021-01-01",
    memoryId: "identity-b", memoryTitle: "B"
  }];
  const changedSource = [{ ...baseSources[0], sourceKey: `time-source:${"3".repeat(64)}` }, baseSources[1]];
  notEqual(
    buildQuestionKey("identity-event", baseSources),
    buildQuestionKey("identity-event", changedSource),
    "question identity binds the exact origin source keys even when type and dates match"
  );
}

function checkQuestionRotation() {
  const fixture = createFixture("rotation", {
    memoryA: "rotation-memory-a", memoryB: "rotation-memory-b",
    eventId: "rotation-event", assetId: "rotation-voice"
  });
  try {
    const initial = fixture.store.getOralHistoryEventWorkspace(fixture.eventId);
    fixture.store.saveOralHistoryAnswer(
      fixture.eventId,
      answerInput(initial, fixture.assetId, "rotation-submission-0001", false, "uncertain", "", "")
    );
    const oldKey = fixture.store.getOralHistoryEventWorkspace(fixture.eventId).question.questionKey;
    const memory = fixture.store.getMemory("rotation-memory-b");
    fixture.store.saveMemory({ ...memory, date: "2022-01-01" }, { expectedUpdatedAt: memory.updatedAt });
    const rotated = fixture.store.getOralHistoryEventWorkspace(fixture.eventId);
    notEqual(rotated.question.questionKey, oldKey, "changed verified source produces a new question identity");
    equal(rotated.question.persisted, false, "new source set returns a fresh proposal instead of the latest old question");
    equal(rotated.currentDraft, null, "old question draft is not presented as the new question answer");
    equal(rotated.eligibility.canAnswer, true, "current eligible proposal remains answerable");
  } finally {
    fixture.close();
  }
}

function checkAnswerLimit() {
  const fixture = createFixture("limit", {
    memoryA: "limit-memory-a", memoryB: "limit-memory-b",
    eventId: "limit-event", assetId: "limit-voice"
  });
  try {
    const workspace = fixture.store.getOralHistoryEventWorkspace(fixture.eventId);
    for (let index = 0; index < 100; index += 1) {
      fixture.store.saveOralHistoryAnswer(
        fixture.eventId,
        answerInput(
          workspace,
          fixture.assetId,
          `limit-submission-${String(index).padStart(4, "0")}`,
          false,
          "uncertain",
          "",
          ""
        )
      );
    }
    equal(fixture.store.getOralHistoryStats().answers, 100, "answer history reaches its explicit per-question cap");
    throwsCode(
      () => fixture.store.saveOralHistoryAnswer(
        fixture.eventId,
        answerInput(workspace, fixture.assetId, "limit-submission-0100", false, "uncertain", "", "")
      ),
      "ORAL_HISTORY_ANSWER_LIMIT",
      "the 101st distinct answer is rejected inside the transaction"
    );
    equal(fixture.store.getOralHistoryStats().answers, 100, "answer limit rejection performs zero writes");
    equal(fixture.store.getOralHistoryEventWorkspace(fixture.eventId).history.length, 100, "workspace hydration remains bounded to 100 answers");
  } finally {
    fixture.close();
  }
}

async function checkApi(fixture) {
  const api = createOralHistoryApi({
    store: fixture.store,
    interviewDemo: false,
    readJsonBody: async (request) => request.body,
    sendJson(response, statusCode, payload) { response.statusCode = statusCode; response.payload = payload; return payload; },
    httpError(statusCode, message) { const error = new Error(message); error.statusCode = statusCode; return error; }
  });
  const before = fixture.store.getOralHistoryStats();
  const get = await callApi(api, "GET", fixture.eventId);
  equal(get.statusCode, 200, "GET workspace succeeds");
  ok(/^"oral-history-[a-f0-9]{64}"$/u.test(get.headers.etag), "GET returns a strong semantic ETag");
  deepEqual(fixture.store.getOralHistoryStats(), before, "API GET performs zero writes");

  await rejectsCode(() => callApi(api, "DELETE", fixture.eventId, {
    body: { questionSetSha256: get.payload.questionSetSha256, confirm: true }
  }), "ORAL_HISTORY_PRECONDITION_REQUIRED", "write requires If-Match");
  await rejectsCode(() => callApi(api, "DELETE", fixture.eventId, {
    headers: { "if-match": '"oral-history-stale"' },
    body: { questionSetSha256: get.payload.questionSetSha256, confirm: true }
  }), "ORAL_HISTORY_VERSION_CONFLICT", "stale If-Match is rejected");

  const put = await callApi(api, "PUT", fixture.eventId, {
    headers: { "if-match": get.headers.etag },
    body: {
      questionSetSha256: get.payload.questionSetSha256,
      submissionId: "submission-api-draft-0001",
      assetId: fixture.assetId,
      segmentStartMs: 200,
      segmentEndMs: 2_000,
      transcriptText: "这是一段完全由用户手工填写的草稿。",
      resolutionKind: "uncertain",
      intervalStart: "",
      intervalEnd: "",
      confirmTranscript: false,
      confirm: true
    }
  });
  equal(put.statusCode, 201, "current If-Match can save an append-only draft through the API");
  equal(put.payload.currentDraft.status, "draft", "API returns the saved draft state");
  equal(oralCandidates(fixture).length, 0, "API draft remains outside time candidates");
  const replay = await callApi(api, "PUT", fixture.eventId, {
    headers: { "if-match": get.headers.etag },
    body: {
      questionSetSha256: get.payload.questionSetSha256,
      submissionId: "submission-api-draft-0001",
      assetId: fixture.assetId,
      segmentStartMs: 200,
      segmentEndMs: 2_000,
      transcriptText: "这是一段完全由用户手工填写的草稿。",
      resolutionKind: "uncertain",
      intervalStart: "",
      intervalEnd: "",
      confirmTranscript: false,
      confirm: true
    }
  });
  equal(replay.statusCode, 200, "submissionId replay takes precedence over a stale ETag without mutating");
  equal(replay.payload.idempotent, true, "API identifies an exact submission replay");
  const deleted = await callApi(api, "DELETE", fixture.eventId, {
    headers: { "if-match": put.headers.etag },
    body: { questionSetSha256: put.payload.questionSetSha256, confirm: true }
  });
  equal(deleted.statusCode, 200, "DELETE with current If-Match succeeds");
  equal(deleted.payload.withdrawnCount, 1, "DELETE marks the active draft withdrawn");
  equal(deleted.payload.currentDraft, null, "DELETE never leaves a hidden active draft");

  const confirmedBody = {
    questionSetSha256: deleted.payload.questionSetSha256,
    submissionId: "submission-api-confirmed-0001",
    assetId: fixture.assetId,
    segmentStartMs: 300,
    segmentEndMs: 2_500,
    transcriptText: "这是一条用于模拟响应丢失的人工确认回答。",
    resolutionKind: "day",
    intervalStart: "2021-01-01",
    intervalEnd: "2021-01-01",
    confirmTranscript: true,
    confirm: true
  };
  const confirmed = await callApi(api, "PUT", fixture.eventId, {
    headers: { "if-match": deleted.headers.etag }, body: confirmedBody
  });
  equal(confirmed.statusCode, 201, "confirmed HTTP submission succeeds once");
  const answerCountAfterConfirmed = fixture.store.getOralHistoryStats().answers;
  const confirmedReplay = await callApi(api, "PUT", fixture.eventId, {
    headers: { "if-match": deleted.headers.etag }, body: confirmedBody
  });
  equal(confirmedReplay.statusCode, 200, "lost confirmed response can replay with the original stale If-Match");
  equal(confirmedReplay.payload.idempotent, true, "confirmed stale replay is explicitly idempotent");
  equal(fixture.store.getOralHistoryStats().answers, answerCountAfterConfirmed, "confirmed stale replay appends no row");
  const changedReplay = { ...confirmedBody, transcriptText: "篡改后的不同正文。" };
  await rejectsCode(() => callApi(api, "PUT", fixture.eventId, {
    headers: { "if-match": deleted.headers.etag }, body: changedReplay
  }), "ORAL_HISTORY_VERSION_CONFLICT", "same submissionId with different body and stale ETag remains a 412");
  await rejectsCode(() => callApi(api, "PUT", fixture.eventId, {
    headers: { "if-match": confirmed.headers.etag }, body: changedReplay
  }), "ORAL_HISTORY_SUBMISSION_CONFLICT", "same submissionId with different body and current ETag is a 409");
  equal(fixture.store.getOralHistoryStats().answers, answerCountAfterConfirmed, "conflicting retries perform zero writes");
  const confirmedWithdraw = await callApi(api, "DELETE", fixture.eventId, {
    headers: { "if-match": confirmed.headers.etag },
    body: { questionSetSha256: confirmed.payload.questionSetSha256, confirm: true }
  });
  equal(confirmedWithdraw.payload.withdrawnCount, 1, "confirmed API replay fixture is withdrawn without deletion");
  const replayAfterWithdraw = await callApi(api, "PUT", fixture.eventId, {
    headers: { "if-match": deleted.headers.etag }, body: confirmedBody
  });
  equal(replayAfterWithdraw.statusCode, 200, "exact submission replay remains idempotent after lifecycle status changes");
  equal(replayAfterWithdraw.payload.idempotent, true, "withdrawn row preserves its original request identity");

  const demoApi = createOralHistoryApi({
    store: fixture.store,
    interviewDemo: true,
    readJsonBody: async () => { throw new Error("Demo must reject before body read"); },
    sendJson(response, statusCode, payload) { response.statusCode = statusCode; response.payload = payload; return payload; },
    httpError(statusCode, message) { const error = new Error(message); error.statusCode = statusCode; return error; }
  });
  await rejectsCode(() => callApi(demoApi, "PUT", fixture.eventId, {
    headers: { "if-match": get.headers.etag }, body: {}
  }), "ORAL_HISTORY_DEMO_READ_ONLY", "Demo blocks oral-history writes before reading private input");
}

async function callApi(api, method, eventId, options = {}) {
  const response = {
    headers: {},
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = String(value); }
  };
  const request = { method, headers: options.headers || {}, body: options.body };
  await api.handle(request, response, new URL(`http://local/api/oral-histories/events/${eventId}`));
  return response;
}

function createFixture(name, ids) {
  const root = path.join(os.tmpdir(), `time-isle-oral-history-${name}-${randomUUID()}`);
  fs.mkdirSync(root, { recursive: true });
  const dbPath = path.join(root, "museum.sqlite");
  const store = createMemoryStore({ dbPath, halls: [{ id: "daily", name: "Daily", description: "" }], schemaVersion: 13 });
  store.saveMemory(memory(ids.memoryA, "First account", "2020-01-01"), { requireNew: true });
  store.saveMemory(memory(ids.memoryB, "Second account", "2021-01-01"), { requireNew: true });
  store.saveArchaeologyConfirmation({
    event: { eventId: ids.eventId, memoryIds: [ids.memoryA, ids.memoryB], title: "Shared event", confirmedBy: "user" },
    pairDecision: { memoryAId: ids.memoryA, memoryBId: ids.memoryB, decision: "same_event" },
    claimsByMemory: { [ids.memoryA]: [], [ids.memoryB]: [] }
  });
  store.createVoiceAsset({
    id: ids.assetId,
    contentSha256: "a".repeat(64),
    originalName: `${name}.webm`, mimeType: "audio/webm", codec: "opus",
    byteSize: 100, durationMs: 10_000,
    storageKey: `ready/${name.slice(0, 2).padEnd(2, "x")}/${"a".repeat(64)}.webm`,
    status: "ready"
  });
  return {
    root, dbPath, store, eventId: ids.eventId, assetId: ids.assetId,
    close() { try { store.close(); } finally { fs.rmSync(root, { recursive: true, force: true }); } }
  };
}

function memory(id, title, date) {
  return {
    id, schemaVersion: 13, title, hall: "daily", sourceType: "日记",
    rawContent: `Date ${date}`, exhibitText: title, date, location: "",
    people: [], tags: [], emotions: [], emotionIntensity: 3, importance: 1,
    favorite: false, coverImage: "", mediaNote: "", attachments: [], agentRunId: "",
    createdAt: "2026-07-18T00:00:00.000Z", updatedAt: "2026-07-18T00:00:00.000Z"
  };
}

function answerInput(workspace, assetId, submissionId, confirmTranscript, resolutionKind, intervalStart, intervalEnd) {
  return {
    questionSetSha256: workspace.questionSetSha256,
    submissionId,
    assetId,
    segmentStartMs: 100,
    segmentEndMs: 9_000,
    transcriptText: "我记得是在二零二一年元旦。",
    resolutionKind,
    intervalStart,
    intervalEnd,
    confirmTranscript,
    confirm: true
  };
}

function oralCandidates(fixture) {
  return fixture.store.getEventCalibrationWorkspace(fixture.eventId).candidates.filter((item) => item.sourceType === "oral-history");
}

function checkMigration(fixture) {
  const db = new DatabaseSync(fixture.dbPath);
  try {
    equal(Number(db.prepare("PRAGMA user_version").get().user_version), 13, "database migrates to schema 13");
    for (const table of ["oral_history_questions", "oral_history_answers"]) {
      equal(Number(db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name=?").get(table).count), 1, `migration creates ${table}`);
    }
  } finally {
    db.close();
  }
}

function equal(actual, expected, message) { assertions += 1; assert.equal(actual, expected, message); }
function deepEqual(actual, expected, message) { assertions += 1; assert.deepEqual(actual, expected, message); }
function ok(value, message) { assertions += 1; assert.ok(value, message); }
function notEqual(actual, expected, message) { assertions += 1; assert.notEqual(actual, expected, message); }
function throwsCode(operation, code, message) {
  assertions += 1;
  assert.throws(operation, (error) => error?.code === code, message);
}
async function rejectsCode(operation, code, message) {
  assertions += 1;
  await assert.rejects(operation, (error) => error?.code === code, message);
}
