"use strict";

const { randomUUID } = require("node:crypto");
const { applyMigrations } = require("./migrations");
const {
  MAX_ORAL_HISTORY_QUESTIONS,
  ORAL_HISTORY_REDACTED_NOTE
} = require("./oral-history-backup");
const { buildSourceSetSha256, buildStableSourceKey } = require("./time-calibration-service");
const {
  MAX_ANSWERS_PER_QUESTION,
  MAX_QUESTION_TEXT_LENGTH,
  MAX_TRANSCRIPT_LENGTH,
  ORAL_HISTORY_SCHEMA_VERSION,
  buildOralHistoryQuestionSet,
  buildOralHistoryTimeCandidate,
  buildQuestionKey,
  buildSubmissionRequestSha256,
  normalizeAnswerSubmission,
  normalizeOriginSources,
  oralHistoryError,
  sha256,
  stableStringify
} = require("./oral-history-service");

const MAX_QUESTIONS = MAX_ORAL_HISTORY_QUESTIONS;
const ANSWER_STATUSES = new Set(["draft", "confirmed", "superseded", "withdrawn"]);
const ORAL_HISTORY_MIGRATION = Object.freeze({
  version: ORAL_HISTORY_SCHEMA_VERSION,
  name: "event-oral-histories-and-manual-time-segments",
  up(db) {
    db.exec(`
      CREATE TABLE oral_history_questions (
        id TEXT PRIMARY KEY,
        schema_version INTEGER NOT NULL DEFAULT 13 CHECK (schema_version = 13),
        event_id TEXT NOT NULL,
        question_key TEXT NOT NULL,
        question_text TEXT NOT NULL CHECK (length(trim(question_text)) > 0 AND length(question_text) <= ${MAX_QUESTION_TEXT_LENGTH}),
        origin_sources_json TEXT NOT NULL CHECK (
          json_valid(origin_sources_json) AND json_type(origin_sources_json) = 'array' AND json_array_length(origin_sources_json) = 2
        ),
        origin_source_set_sha256 TEXT NOT NULL CHECK (
          length(origin_source_set_sha256) = 64 AND origin_source_set_sha256 NOT GLOB '*[^0-9a-f]*'
        ),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (event_id) REFERENCES memory_events(id) ON DELETE CASCADE,
        UNIQUE (event_id, question_key)
      );

      CREATE TABLE oral_history_answers (
        id TEXT PRIMARY KEY,
        schema_version INTEGER NOT NULL DEFAULT 13 CHECK (schema_version = 13),
        question_id TEXT NOT NULL,
        submission_id TEXT NOT NULL UNIQUE,
        request_sha256 TEXT NOT NULL CHECK (
          length(request_sha256) = 64 AND request_sha256 NOT GLOB '*[^0-9a-f]*'
        ),
        asset_id TEXT NOT NULL,
        segment_start_ms INTEGER NOT NULL CHECK (segment_start_ms >= 0),
        segment_end_ms INTEGER NOT NULL CHECK (segment_end_ms > segment_start_ms),
        transcript_text TEXT NOT NULL CHECK (length(trim(transcript_text)) > 0 AND length(transcript_text) <= ${MAX_TRANSCRIPT_LENGTH}),
        status TEXT NOT NULL CHECK (status IN ('draft', 'confirmed', 'superseded', 'withdrawn')),
        resolution_kind TEXT NOT NULL CHECK (resolution_kind IN ('day', 'range', 'uncertain')),
        interval_start TEXT NOT NULL DEFAULT '',
        interval_end TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        confirmed_at TEXT NOT NULL DEFAULT '',
        superseded_at TEXT NOT NULL DEFAULT '',
        withdrawn_at TEXT NOT NULL DEFAULT '',
        FOREIGN KEY (question_id) REFERENCES oral_history_questions(id) ON DELETE CASCADE,
        FOREIGN KEY (asset_id) REFERENCES voice_assets(id) ON DELETE RESTRICT,
        CHECK (
          (resolution_kind = 'uncertain' AND interval_start = '' AND interval_end = '') OR
          (resolution_kind IN ('day', 'range') AND interval_start <> '' AND interval_end <> '')
        ),
        CHECK (
          (status = 'confirmed' AND confirmed_at <> '' AND superseded_at = '' AND withdrawn_at = '') OR
          (status = 'draft' AND confirmed_at = '' AND superseded_at = '' AND withdrawn_at = '') OR
          (status = 'superseded' AND superseded_at <> '' AND withdrawn_at = '') OR
          (status = 'withdrawn' AND withdrawn_at <> '')
        )
      );

      CREATE UNIQUE INDEX idx_oral_history_current_draft
        ON oral_history_answers(question_id) WHERE status = 'draft';
      CREATE UNIQUE INDEX idx_oral_history_current_confirmed
        ON oral_history_answers(question_id) WHERE status = 'confirmed';
      CREATE INDEX idx_oral_history_questions_event
        ON oral_history_questions(event_id, updated_at DESC, id);
      CREATE INDEX idx_oral_history_answers_question
        ON oral_history_answers(question_id, created_at DESC, id);
      CREATE INDEX idx_oral_history_answers_asset
        ON oral_history_answers(asset_id, status, id);

      CREATE TRIGGER oral_history_answer_asset_insert
      BEFORE INSERT ON oral_history_answers
      WHEN NOT EXISTS (
        SELECT 1 FROM voice_assets asset
        WHERE asset.id = new.asset_id AND asset.status = 'ready'
          AND new.segment_start_ms < new.segment_end_ms
          AND new.segment_end_ms <= asset.duration_ms
      )
      BEGIN
        SELECT RAISE(ABORT, 'ORAL_HISTORY_ASSET_OR_SEGMENT_INVALID');
      END;

      CREATE TRIGGER oral_history_answer_content_immutable
      BEFORE UPDATE OF question_id, submission_id, request_sha256, asset_id, segment_start_ms,
        segment_end_ms, transcript_text, resolution_kind, interval_start, interval_end,
        created_at, confirmed_at ON oral_history_answers
      BEGIN
        SELECT RAISE(ABORT, 'ORAL_HISTORY_ANSWER_IMMUTABLE');
      END;

      CREATE TRIGGER oral_history_voice_asset_in_use
      BEFORE UPDATE OF status ON voice_assets
      WHEN old.status = 'ready' AND new.status <> 'ready' AND EXISTS (
        SELECT 1 FROM oral_history_answers answer WHERE answer.asset_id = old.id
      )
      BEGIN
        SELECT RAISE(ABORT, 'VOICE_ASSET_IN_USE');
      END;
    `);
  }
});

function initializeOralHistoryDatabase(options = {}) {
  const db = requireDatabase(options.db);
  const suppliedTransaction = typeof options.withTransaction === "function" ? options.withTransaction : null;
  const now = typeof options.now === "function" ? options.now : () => new Date().toISOString();
  const createId = typeof options.createId === "function" ? options.createId : (prefix) => `${prefix}-${randomUUID()}`;
  const getEventCalibrationWorkspace = options.getEventCalibrationWorkspace;
  if (typeof getEventCalibrationWorkspace !== "function") {
    throw new TypeError("initializeOralHistoryDatabase 需要 getEventCalibrationWorkspace。 ");
  }
  if (options.applyMigrations !== false) {
    applyMigrations({
      db,
      baselineVersion: 4,
      migrations: [ORAL_HISTORY_MIGRATION],
      supportedVersion: Math.max(ORAL_HISTORY_SCHEMA_VERSION, Number(options.schemaVersion) || ORAL_HISTORY_SCHEMA_VERSION),
      now
    });
  }
  const statements = prepareStatements(db);

  function runAtomic(operation) {
    if (suppliedTransaction) return suppliedTransaction(operation);
    const savepoint = `oral_history_${randomUUID().replace(/-/gu, "")}`;
    db.exec(`SAVEPOINT ${savepoint}`);
    try {
      const result = operation();
      if (result && typeof result.then === "function") throw new TypeError("口述史事务必须同步执行。");
      db.exec(`RELEASE SAVEPOINT ${savepoint}`);
      return result;
    } catch (error) {
      try { db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`); } catch { /* preserve original */ }
      try { db.exec(`RELEASE SAVEPOINT ${savepoint}`); } catch { /* preserve original */ }
      throw normalizeSqliteError(error);
    }
  }

  function getOralHistoryEventWorkspace(eventId) {
    const id = requireId(eventId, "eventId");
    const event = readEvent(id);
    if (!event) throw oralHistoryError("没有找到这组时光拼图。", "ORAL_HISTORY_EVENT_NOT_FOUND", 404);
    const calibrationWorkspace = getEventCalibrationWorkspace(id);
    const generated = buildOralHistoryQuestionSet({ event, workspace: calibrationWorkspace });
    const generatedRow = generated.question ? statements.getQuestionByKey.get(id, generated.question.questionKey) : null;
    const historyOnlyRow = generated.question ? null : statements.latestQuestionForEvent.get(id);
    const persisted = generatedRow ? rowToQuestion(generatedRow) : historyOnlyRow ? rowToQuestion(historyOnlyRow) : null;
    const question = generated.question ? (persisted || generated.question) : persisted;
    const history = persisted ? statements.answersForQuestion.all(persisted.id).map(hydrateAnswer) : [];
    const currentDraft = history.find((answer) => answer.status === "draft") || null;
    const currentConfirmed = history.find((answer) => answer.status === "confirmed") || null;
    return {
      event,
      eligibility: {
        ...generated.eligibility,
        canAnswer: Boolean(generated.eligibility.eligible && generated.question && question && event.status === "confirmed")
      },
      question: question ? { ...question, persisted: Boolean(persisted) } : null,
      questionSetSha256: generated.questionSetSha256,
      currentDraft,
      currentConfirmed,
      history
    };
  }

  function saveOralHistoryAnswer(eventId, input = {}) {
    const id = requireId(eventId, "eventId");
    return runAtomic(() => {
      const before = getOralHistoryEventWorkspace(id);
      const asset = requireReadyAsset(input.assetId);
      const submission = normalizeAnswerSubmission(input, asset);
      const requestSha256 = buildSubmissionRequestSha256(submission);
      const duplicate = statements.getAnswerBySubmission.get(submission.submissionId);
      if (duplicate) {
        const existing = rowToAnswer(duplicate);
        const duplicateQuestion = statements.getQuestion.get(existing.questionId);
        if (duplicateQuestion?.event_id !== id || duplicate.request_sha256 !== requestSha256 || !sameSubmission(existing, submission)) {
          throw oralHistoryError("submissionId 已用于不同的口述史回答。", "ORAL_HISTORY_SUBMISSION_CONFLICT", 409);
        }
        return { created: false, idempotent: true, workspace: getOralHistoryEventWorkspace(id) };
      }
      if (submission.questionSetSha256 !== before.questionSetSha256) throw questionSetChanged();
      if (!before.question || !before.eligibility.canAnswer) {
        throw oralHistoryError("当前没有可回答的时间差异问题。", "ORAL_HISTORY_NOT_ELIGIBLE", 409);
      }

      let question = before.question.persisted ? before.question : null;
      const timestamp = timestampAfter(now(), question?.updatedAt || "");
      if (!question) {
        const questionId = newId("oral-question");
        statements.insertQuestion.run(
          questionId,
          id,
          before.question.questionKey,
          before.question.text,
          JSON.stringify(before.question.sources),
          before.question.originSourceSetSha256,
          timestamp,
          timestamp
        );
        question = rowToQuestion(statements.getQuestion.get(questionId));
      }

      if ((Number(statements.countAnswersForQuestion.get(question.id)?.count) || 0) >= MAX_ANSWERS_PER_QUESTION) {
        throw oralHistoryError(
          `每个口述问题最多保留 ${MAX_ANSWERS_PER_QUESTION} 条回答历史。`,
          "ORAL_HISTORY_ANSWER_LIMIT",
          409
        );
      }

      if (submission.status === "confirmed") {
        statements.supersedeActiveAnswers.run(timestamp, question.id, timestamp);
      } else {
        statements.supersedeDraft.run(timestamp, question.id, timestamp);
      }
      const answerId = newId("oral-answer");
      statements.insertAnswer.run(
        answerId,
        question.id,
        submission.submissionId,
        requestSha256,
        submission.assetId,
        submission.segmentStartMs,
        submission.segmentEndMs,
        submission.transcriptText,
        submission.status,
        submission.resolutionKind,
        submission.intervalStart,
        submission.intervalEnd,
        timestamp,
        submission.status === "confirmed" ? timestamp : "",
        "",
        ""
      );
      statements.touchQuestion.run(timestampAfter(now(), timestamp), question.id);
      return { created: true, idempotent: false, workspace: getOralHistoryEventWorkspace(id) };
    });
  }

  function isOralHistorySubmissionReplay(eventId, input = {}) {
    const id = requireId(eventId, "eventId");
    try {
      const asset = requireReadyAsset(input.assetId);
      const submission = normalizeAnswerSubmission(input, asset);
      const requestSha256 = buildSubmissionRequestSha256(submission);
      const row = statements.getAnswerBySubmission.get(submission.submissionId);
      if (!row) return false;
      const answer = rowToAnswer(row);
      const question = statements.getQuestion.get(answer.questionId);
      return question?.event_id === id && row.request_sha256 === requestSha256 && sameSubmission(answer, submission);
    } catch {
      return false;
    }
  }

  function withdrawOralHistoryAnswers(eventId, input = {}) {
    const id = requireId(eventId, "eventId");
    if (!isPlainObject(input) || Object.keys(input).sort().join("\0") !== ["confirm", "questionSetSha256"].sort().join("\0")) {
      throw oralHistoryError("撤回请求字段集合无效。", "ORAL_HISTORY_FIELD_SET_INVALID");
    }
    if (input.confirm !== true) throw oralHistoryError("撤回答复需要 confirm: true。", "ORAL_HISTORY_CONFIRMATION_REQUIRED");
    return runAtomic(() => {
      const before = getOralHistoryEventWorkspace(id);
      if (input.questionSetSha256 !== before.questionSetSha256) throw questionSetChanged();
      if (!before.question?.persisted) throw oralHistoryError("当前没有可撤回的口述史回答。", "ORAL_HISTORY_ANSWER_NOT_FOUND", 404);
      const timestamp = timestampAfter(now(), before.question.updatedAt);
      const changed = Number(statements.withdrawActive.run(timestamp, before.question.id, timestamp).changes) || 0;
      if (!changed) throw oralHistoryError("当前没有可撤回的口述史回答。", "ORAL_HISTORY_ANSWER_NOT_FOUND", 404);
      statements.touchQuestion.run(timestampAfter(now(), timestamp), before.question.id);
      return { withdrawnCount: changed, workspace: getOralHistoryEventWorkspace(id) };
    });
  }

  function listConfirmedOralHistoryEvidence(memoryIds = []) {
    const normalizedIds = Array.isArray(memoryIds) ? memoryIds.map((id) => requireId(id, "memoryId")) : [];
    if (!normalizedIds.length) return [];
    const placeholders = normalizedIds.map(() => "?").join(", ");
    const rows = db.prepare(`
      SELECT DISTINCT question.id AS question_id, question.question_key,
        answer.id AS answer_id, answer.asset_id, answer.segment_start_ms,
        answer.segment_end_ms, answer.transcript_text, answer.status,
        answer.resolution_kind, answer.interval_start, answer.interval_end,
        event.id AS event_id, event.title AS event_title, event.status AS event_status,
        asset.content_sha256, asset.duration_ms, asset.mime_type, asset.status AS asset_status
      FROM oral_history_answers answer
      JOIN oral_history_questions question ON question.id = answer.question_id
      JOIN memory_events event ON event.id = question.event_id
      JOIN event_members member ON member.event_id = event.id
      JOIN voice_assets asset ON asset.id = answer.asset_id
      WHERE member.memory_id IN (${placeholders})
        AND answer.status = 'confirmed'
        AND answer.resolution_kind IN ('day', 'range')
        AND event.status = 'confirmed'
        AND asset.status = 'ready'
      ORDER BY event.id, question.id, answer.id
    `).all(...normalizedIds);
    return rows.map((row) => buildOralHistoryTimeCandidate({
      question: { id: row.question_id, questionKey: row.question_key },
      answer: {
        id: row.answer_id,
        status: row.status,
        resolutionKind: row.resolution_kind,
        intervalStart: row.interval_start,
        intervalEnd: row.interval_end,
        segmentStartMs: Number(row.segment_start_ms),
        segmentEndMs: Number(row.segment_end_ms),
        transcriptText: row.transcript_text
      },
      asset: {
        id: row.asset_id,
        contentSha256: row.content_sha256,
        durationMs: Number(row.duration_ms),
        mimeType: row.mime_type,
        status: row.asset_status
      },
      event: { id: row.event_id, title: row.event_title, status: row.event_status }
    })).filter(Boolean);
  }

  function getOralVoiceAssetUsage(assetId) {
    const id = requireId(assetId, "assetId");
    return Number(statements.countAnswersForAsset.get(id)?.count) || 0;
  }

  function listReferencedOralVoiceAssetIds() {
    return statements.referencedAssetIds.all().map((row) => row.asset_id);
  }

  function getOralHistoryStats() {
    const row = statements.stats.get();
    return {
      questions: Number(row.questions) || 0,
      answers: Number(row.answers) || 0,
      drafts: Number(row.drafts) || 0,
      confirmed: Number(row.confirmed) || 0,
      superseded: Number(row.superseded) || 0,
      withdrawn: Number(row.withdrawn) || 0
    };
  }

  function clearOralHistories() {
    const before = getOralHistoryStats();
    return runAtomic(() => {
      statements.clearAnswers.run();
      statements.clearQuestions.run();
      return { oralHistoryQuestionsDeleted: before.questions, oralHistoryAnswersDeleted: before.answers };
    });
  }

  function buildOralHistoryBackup(mode = "full", eventIds) {
    const boundary = mode === "full" && eventIds !== undefined
      ? new Set(eventIds.map((id) => requireId(id, "eventId")))
      : null;
    const questions = statements.allQuestions.all().map(rowToQuestion).filter((item) => !boundary || boundary.has(item.eventId));
    const questionIds = new Set(questions.map((item) => item.id));
    const answers = statements.allAnswers.all().map(rowToAnswer).filter((item) => questionIds.has(item.questionId));
    if (mode === "redacted" || mode === "redacted-summary") {
      return {
        mode: "redacted-summary",
        questionCount: questions.length,
        answerCount: answers.length,
        confirmedAnswerCount: answers.filter((item) => item.status === "confirmed").length,
        note: ORAL_HISTORY_REDACTED_NOTE
      };
    }
    if (mode !== "full") throw oralHistoryError("口述史备份模式无效。", "ORAL_HISTORY_BACKUP_INVALID");
    const backup = { mode: "full", schemaVersion: 13, questions, answers };
    validateOralHistoryBackupPayload(backup, { eventIds: boundary ? [...boundary] : undefined, voiceAssetIds: listReferencedOralVoiceAssetIds() });
    return backup;
  }

  function validateOralHistoryBackup(backup, boundaries = {}) {
    return validateOralHistoryBackupPayload(backup, boundaries);
  }

  function restoreOralHistoryBackup(backup, restoreOptions = {}) {
    const memoryIdMap = normalizeIdMap(restoreOptions.memoryIdMap, "memoryIdMap");
    const eventIdMap = normalizeIdMap(restoreOptions.eventIdMap, "eventIdMap");
    const assetIdMap = normalizeIdMap(restoreOptions.assetIdMap, "assetIdMap");
    const eventIds = [...eventIdMap.keys()];
    const voiceAssetIds = [...assetIdMap.keys()];
    const normalized = validateOralHistoryBackupPayload(backup, { eventIds, voiceAssetIds, returnNormalized: true });
    if (normalized.mode === "redacted-summary") return {
      questions: 0,
      answers: 0,
      skipped: 0,
      idMap: { questions: {}, answers: {}, questionKeys: {} }
    };
    return runAtomic(() => {
      const questionMap = new Map();
      const answerMap = new Map();
      const questionKeyMap = new Map();
      for (const source of normalized.questions) {
        const targetEventId = eventIdMap.get(source.eventId);
        if (!targetEventId || !readEvent(targetEventId)) throw oralHistoryError("口述史恢复缺少事件映射。", "ORAL_HISTORY_RESTORE_MAPPING_INVALID");
        const targetWorkspace = getEventCalibrationWorkspace(targetEventId);
        const remappedSources = remapOriginSources(source.sources, targetWorkspace.candidates, memoryIdMap);
        const remappedBoundary = remapOriginSourceBoundary(
          source.originSourceSetSha256,
          targetWorkspace,
          memoryIdMap,
          eventIdMap
        );
        const targetId = uniqueId(source.id, "oral-question");
        const targetKey = buildQuestionKey(targetEventId, remappedSources);
        statements.insertQuestion.run(targetId, targetEventId, targetKey, source.text, JSON.stringify(remappedSources), remappedBoundary, source.createdAt, source.updatedAt);
        questionMap.set(source.id, targetId);
        questionKeyMap.set(source.questionKey, targetKey);
      }
      for (const source of normalized.answers) {
        const targetQuestionId = questionMap.get(source.questionId);
        const targetAssetId = assetIdMap.get(source.assetId);
        if (!targetQuestionId || !targetAssetId) throw oralHistoryError("口述史恢复缺少回答映射。", "ORAL_HISTORY_RESTORE_MAPPING_INVALID");
        const targetId = uniqueId(source.id, "oral-answer");
        const submissionId = statements.getAnswerBySubmission.get(source.submissionId) ? newId("oral-submission") : source.submissionId;
        statements.insertAnswer.run(targetId, targetQuestionId, submissionId, restoredSubmissionSha256(source), targetAssetId, source.segmentStartMs, source.segmentEndMs,
          source.transcriptText, source.status, source.resolutionKind, source.intervalStart, source.intervalEnd,
          source.createdAt, source.confirmedAt, source.supersededAt, source.withdrawnAt);
        answerMap.set(source.id, targetId);
      }
      return {
        questions: questionMap.size,
        answers: answerMap.size,
        skipped: 0,
        idMap: {
          questions: Object.fromEntries(questionMap),
          answers: Object.fromEntries(answerMap),
          questionKeys: Object.fromEntries(questionKeyMap)
        }
      };
    });
  }

  function readEvent(eventId) {
    const row = statements.getEvent.get(eventId);
    return row ? {
      id: row.id,
      title: row.title || "",
      status: row.status || "",
      memberCount: Number(row.member_count) || 0
    } : null;
  }

  function requireReadyAsset(assetId) {
    const row = statements.getAsset.get(requireId(assetId, "assetId"));
    if (!row) throw oralHistoryError("没有找到这段声音。", "ORAL_HISTORY_ASSET_NOT_FOUND", 404);
    return rowToAsset(row);
  }

  function hydrateAnswer(row) {
    const answer = rowToAnswer(row);
    const asset = rowToAsset(statements.getAsset.get(answer.assetId));
    return { ...answer, asset };
  }

  function uniqueId(preferred, prefix) {
    const preferredId = /^[a-zA-Z0-9_-]{1,120}$/u.test(String(preferred || "")) ? String(preferred) : "";
    const get = prefix === "oral-question" ? statements.getQuestion : statements.getAnswer;
    if (preferredId && !get.get(preferredId)) return preferredId;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const id = newId(prefix);
      if (!get.get(id)) return id;
    }
    throw oralHistoryError("无法生成不冲突的口述史 ID。", "ORAL_HISTORY_ID_COLLISION", 409);
  }

  function newId(prefix) {
    return requireId(createId(prefix), `${prefix} id`);
  }

  return Object.freeze({
    buildOralHistoryBackup,
    clearOralHistories,
    getOralHistoryEventWorkspace,
    getOralHistoryStats,
    getOralVoiceAssetUsage,
    listConfirmedOralHistoryEvidence,
    listReferencedOralVoiceAssetIds,
    isOralHistorySubmissionReplay,
    restoreOralHistoryBackup,
    saveOralHistoryAnswer,
    validateOralHistoryBackup,
    withdrawOralHistoryAnswers
  });
}

function remapOriginSources(sources, currentCandidates, memoryIdMap) {
  const sourceByTarget = new Map([...memoryIdMap.entries()].map(([sourceId, targetId]) => [targetId, sourceId]));
  const currentByArchiveKey = new Map();
  for (const candidate of Array.isArray(currentCandidates) ? currentCandidates : []) {
    if (candidate.sourceType === "oral-history") continue;
    const sourceMemoryId = sourceByTarget.get(candidate.memoryId);
    if (!sourceMemoryId) continue;
    const archiveKey = buildStableSourceKey({ ...candidate, memoryId: sourceMemoryId, eventId: "", sourceKey: "" });
    if (currentByArchiveKey.has(archiveKey)) {
      throw oralHistoryError("口述史来源恢复映射不唯一。", "ORAL_HISTORY_RESTORE_SOURCE_AMBIGUOUS", 409);
    }
    currentByArchiveKey.set(archiveKey, candidate);
  }
  return normalizeOriginSources(sources).map((source) => {
    const candidate = currentByArchiveKey.get(source.sourceKey);
    if (!candidate) throw oralHistoryError("口述史来源无法映射到恢复后的馆藏。", "ORAL_HISTORY_RESTORE_SOURCE_MISSING", 409);
    return {
      ...source,
      sourceKey: candidate.sourceKey,
      memoryId: candidate.memoryId || "",
      memoryTitle: candidate.memoryTitle || source.memoryTitle || ""
    };
  });
}

function remapOriginSourceBoundary(archivedBoundary, targetWorkspace, memoryIdMap, eventIdMap) {
  const memorySourceByTarget = new Map([...memoryIdMap.entries()].map(([sourceId, targetId]) => [targetId, sourceId]));
  const eventSourceByTarget = new Map([...eventIdMap.entries()].map(([sourceId, targetId]) => [targetId, sourceId]));
  const archiveCandidates = [];
  for (const candidate of Array.isArray(targetWorkspace?.candidates) ? targetWorkspace.candidates : []) {
    const oral = candidate.sourceType === "oral-history";
    const sourceMemoryId = oral ? "" : memorySourceByTarget.get(candidate.memoryId);
    const sourceEventId = oral ? eventSourceByTarget.get(candidate.eventId) : "";
    if ((oral && !sourceEventId) || (!oral && !sourceMemoryId)) continue;
    const archiveCandidate = {
      ...candidate,
      memoryId: oral ? "" : sourceMemoryId,
      eventId: oral ? sourceEventId : "",
      sourceKey: ""
    };
    archiveCandidate.sourceKey = buildStableSourceKey(archiveCandidate);
    archiveCandidates.push(archiveCandidate);
  }
  const archivedCurrent = buildSourceSetSha256(archiveCandidates);
  return archivedBoundary === archivedCurrent
    ? String(targetWorkspace.sourceSetSha256 || "")
    : archivedBoundary;
}

function prepareStatements(db) {
  return {
    getEvent: db.prepare(`SELECT event.id, event.title, event.status, COUNT(member.memory_id) AS member_count
      FROM memory_events event LEFT JOIN event_members member ON member.event_id = event.id
      WHERE event.id = ? GROUP BY event.id`),
    getAsset: db.prepare("SELECT * FROM voice_assets WHERE id = ?"),
    getQuestion: db.prepare("SELECT * FROM oral_history_questions WHERE id = ?"),
    getQuestionByKey: db.prepare("SELECT * FROM oral_history_questions WHERE event_id = ? AND question_key = ?"),
    latestQuestionForEvent: db.prepare("SELECT * FROM oral_history_questions WHERE event_id = ? ORDER BY updated_at DESC, id LIMIT 1"),
    insertQuestion: db.prepare(`INSERT INTO oral_history_questions
      (id, schema_version, event_id, question_key, question_text, origin_sources_json, origin_source_set_sha256, created_at, updated_at)
      VALUES (?, 13, ?, ?, ?, ?, ?, ?, ?)`),
    touchQuestion: db.prepare("UPDATE oral_history_questions SET updated_at = ? WHERE id = ?"),
    getAnswer: db.prepare("SELECT * FROM oral_history_answers WHERE id = ?"),
    getAnswerBySubmission: db.prepare("SELECT * FROM oral_history_answers WHERE submission_id = ?"),
    answersForQuestion: db.prepare(`SELECT * FROM oral_history_answers
      WHERE question_id = ? ORDER BY created_at DESC, id DESC LIMIT ${MAX_ANSWERS_PER_QUESTION}`),
    countAnswersForQuestion: db.prepare("SELECT COUNT(*) AS count FROM oral_history_answers WHERE question_id = ?"),
    insertAnswer: db.prepare(`INSERT INTO oral_history_answers
      (id, schema_version, question_id, submission_id, request_sha256, asset_id, segment_start_ms, segment_end_ms,
       transcript_text, status, resolution_kind, interval_start, interval_end, created_at, confirmed_at, superseded_at, withdrawn_at)
      VALUES (?, 13, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    supersedeActiveAnswers: db.prepare(`UPDATE oral_history_answers SET status = 'superseded', superseded_at = ?
      WHERE question_id = ? AND status IN ('draft', 'confirmed') AND ? <> ''`),
    supersedeDraft: db.prepare(`UPDATE oral_history_answers SET status = 'superseded', superseded_at = ?
      WHERE question_id = ? AND status = 'draft' AND ? <> ''`),
    withdrawActive: db.prepare(`UPDATE oral_history_answers SET status = 'withdrawn', withdrawn_at = ?
      WHERE question_id = ? AND status IN ('draft', 'confirmed') AND ? <> ''`),
    countAnswersForAsset: db.prepare("SELECT COUNT(*) AS count FROM oral_history_answers WHERE asset_id = ?"),
    referencedAssetIds: db.prepare("SELECT DISTINCT asset_id FROM oral_history_answers ORDER BY asset_id"),
    allQuestions: db.prepare("SELECT * FROM oral_history_questions ORDER BY event_id, id"),
    allAnswers: db.prepare("SELECT * FROM oral_history_answers ORDER BY question_id, created_at, id"),
    stats: db.prepare(`SELECT
      (SELECT COUNT(*) FROM oral_history_questions) AS questions,
      (SELECT COUNT(*) FROM oral_history_answers) AS answers,
      (SELECT COUNT(*) FROM oral_history_answers WHERE status = 'draft') AS drafts,
      (SELECT COUNT(*) FROM oral_history_answers WHERE status = 'confirmed') AS confirmed,
      (SELECT COUNT(*) FROM oral_history_answers WHERE status = 'superseded') AS superseded,
      (SELECT COUNT(*) FROM oral_history_answers WHERE status = 'withdrawn') AS withdrawn`),
    clearAnswers: db.prepare("DELETE FROM oral_history_answers"),
    clearQuestions: db.prepare("DELETE FROM oral_history_questions")
  };
}

function rowToQuestion(row) {
  const sources = normalizeOriginSources(JSON.parse(row.origin_sources_json));
  return {
    id: row.id,
    eventId: row.event_id,
    questionKey: row.question_key,
    text: row.question_text,
    sources,
    originSourceSetSha256: row.origin_source_set_sha256,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToAnswer(row) {
  return {
    id: row.id,
    questionId: row.question_id,
    submissionId: row.submission_id,
    assetId: row.asset_id,
    segmentStartMs: Number(row.segment_start_ms),
    segmentEndMs: Number(row.segment_end_ms),
    transcriptText: row.transcript_text,
    status: row.status,
    resolutionKind: row.resolution_kind,
    intervalStart: row.interval_start,
    intervalEnd: row.interval_end,
    createdAt: row.created_at,
    confirmedAt: row.confirmed_at || "",
    supersededAt: row.superseded_at || "",
    withdrawnAt: row.withdrawn_at || ""
  };
}

function rowToAsset(row) {
  return row ? {
    id: row.id,
    contentSha256: row.content_sha256,
    mimeType: row.mime_type,
    codec: row.codec,
    byteSize: Number(row.byte_size),
    durationMs: Number(row.duration_ms),
    status: row.status,
    originalName: row.original_name || ""
  } : null;
}

function validateOralHistoryBackupPayload(payload, options = {}) {
  if (!isPlainObject(payload)) throw oralHistoryError("口述史备份格式无效。", "ORAL_HISTORY_BACKUP_INVALID");
  if (payload.mode === "redacted-summary") {
    assertExactKeys(payload, ["answerCount", "confirmedAnswerCount", "mode", "note", "questionCount"], "脱敏口述史备份");
    for (const key of ["questionCount", "answerCount", "confirmedAnswerCount"]) requireCount(payload[key], key, MAX_QUESTIONS * MAX_ANSWERS_PER_QUESTION);
    if (payload.confirmedAnswerCount > payload.answerCount || payload.note !== ORAL_HISTORY_REDACTED_NOTE) {
      throw oralHistoryError("脱敏口述史备份统计无效。", "ORAL_HISTORY_BACKUP_INVALID");
    }
    return options.returnNormalized ? { mode: payload.mode, questions: [], answers: [] } : true;
  }
  assertExactKeys(payload, ["answers", "mode", "questions", "schemaVersion"], "口述史备份");
  if (payload.mode !== "full" || payload.schemaVersion !== 13 || !Array.isArray(payload.questions) || !Array.isArray(payload.answers) ||
      payload.questions.length > MAX_QUESTIONS || payload.answers.length > MAX_QUESTIONS * MAX_ANSWERS_PER_QUESTION) {
    throw oralHistoryError("口述史完整备份格式无效。", "ORAL_HISTORY_BACKUP_INVALID");
  }
  const eventBoundary = options.eventIds === undefined ? null : new Set(options.eventIds.map((id) => requireId(id, "eventId")));
  const assetBoundary = options.voiceAssetIds === undefined ? null : new Set(options.voiceAssetIds.map((id) => requireId(id, "assetId")));
  const questions = payload.questions.map((item, index) => normalizeBackupQuestion(item, index));
  assertUnique(questions.map((item) => item.id), "口述史问题 ID");
  assertUnique(questions.map((item) => `${item.eventId}\0${item.questionKey}`), "事件口述史问题 key");
  for (const question of questions) {
    if (eventBoundary && !eventBoundary.has(question.eventId)) throw oralHistoryError("口述史问题引用了边界外事件。", "ORAL_HISTORY_BACKUP_REFERENCE_INVALID");
    if (question.questionKey !== buildQuestionKey(question.eventId, question.sources)) {
      throw oralHistoryError("口述史问题稳定标识与来源不一致。", "ORAL_HISTORY_BACKUP_INVALID");
    }
  }
  const questionIds = new Set(questions.map((item) => item.id));
  const answers = payload.answers.map((item, index) => normalizeBackupAnswer(item, index));
  assertUnique(answers.map((item) => item.id), "口述史回答 ID");
  assertUnique(answers.map((item) => item.submissionId), "口述史 submissionId");
  const activeByQuestion = new Map();
  const answerCountByQuestion = new Map();
  for (const answer of answers) {
    if (!questionIds.has(answer.questionId)) throw oralHistoryError("口述史回答引用了缺失问题。", "ORAL_HISTORY_BACKUP_REFERENCE_INVALID");
    if (assetBoundary && !assetBoundary.has(answer.assetId)) throw oralHistoryError("口述史回答引用了边界外声音。", "ORAL_HISTORY_BACKUP_REFERENCE_INVALID");
    const answerCount = (answerCountByQuestion.get(answer.questionId) || 0) + 1;
    if (answerCount > MAX_ANSWERS_PER_QUESTION) {
      throw oralHistoryError("单个口述史问题的回答数量超过安全上限。", "ORAL_HISTORY_BACKUP_INVALID");
    }
    answerCountByQuestion.set(answer.questionId, answerCount);
    if (["draft", "confirmed"].includes(answer.status)) {
      const key = `${answer.questionId}\0${answer.status}`;
      if (activeByQuestion.has(key)) throw oralHistoryError("每个问题最多保留一条当前草稿和一条当前确认回答。", "ORAL_HISTORY_BACKUP_INVALID");
      activeByQuestion.set(key, answer.id);
    }
  }
  return options.returnNormalized ? { mode: "full", questions, answers } : true;
}

function normalizeBackupQuestion(item, index) {
  assertExactKeys(item, ["createdAt", "eventId", "id", "originSourceSetSha256", "questionKey", "sources", "text", "updatedAt"], `questions[${index}]`);
  const result = {
    id: requireId(item.id, `questions[${index}].id`),
    eventId: requireId(item.eventId, `questions[${index}].eventId`),
    questionKey: String(item.questionKey || ""),
    text: requireText(item.text, `questions[${index}].text`, MAX_QUESTION_TEXT_LENGTH),
    sources: normalizeOriginSources(item.sources),
    originSourceSetSha256: requireSha256(item.originSourceSetSha256, `questions[${index}].originSourceSetSha256`),
    createdAt: requireTimestamp(item.createdAt, `questions[${index}].createdAt`),
    updatedAt: requireTimestamp(item.updatedAt, `questions[${index}].updatedAt`)
  };
  if (Date.parse(result.createdAt) > Date.parse(result.updatedAt)) throw oralHistoryError("口述史问题时间顺序无效。", "ORAL_HISTORY_BACKUP_INVALID");
  return result;
}

function normalizeBackupAnswer(item, index) {
  assertExactKeys(item, ["assetId", "confirmedAt", "createdAt", "id", "intervalEnd", "intervalStart", "questionId",
    "resolutionKind", "segmentEndMs", "segmentStartMs", "status", "submissionId", "supersededAt", "transcriptText", "withdrawnAt"], `answers[${index}]`);
  const status = String(item.status || "");
  if (!ANSWER_STATUSES.has(status)) throw oralHistoryError("口述史回答状态无效。", "ORAL_HISTORY_BACKUP_INVALID");
  const result = {
    id: requireId(item.id, `answers[${index}].id`),
    questionId: requireId(item.questionId, `answers[${index}].questionId`),
    submissionId: requireSubmissionId(item.submissionId),
    assetId: requireId(item.assetId, `answers[${index}].assetId`),
    segmentStartMs: requireInteger(item.segmentStartMs, "segmentStartMs", 0, 3 * 60 * 1000 - 1),
    segmentEndMs: requireInteger(item.segmentEndMs, "segmentEndMs", 1, 3 * 60 * 1000),
    transcriptText: requireText(item.transcriptText, "transcriptText", MAX_TRANSCRIPT_LENGTH),
    status,
    resolutionKind: String(item.resolutionKind || ""),
    intervalStart: String(item.intervalStart || ""),
    intervalEnd: String(item.intervalEnd || ""),
    createdAt: requireTimestamp(item.createdAt, "createdAt"),
    confirmedAt: optionalTimestamp(item.confirmedAt, "confirmedAt"),
    supersededAt: optionalTimestamp(item.supersededAt, "supersededAt"),
    withdrawnAt: optionalTimestamp(item.withdrawnAt, "withdrawnAt")
  };
  if (result.segmentStartMs >= result.segmentEndMs || !["day", "range", "uncertain"].includes(result.resolutionKind)) {
    throw oralHistoryError("口述史回答片段或时间含义无效。", "ORAL_HISTORY_BACKUP_INVALID");
  }
  const normalized = require("./time-calibration-service").normalizeCalibrationResolution(result);
  if (normalized.intervalStart !== result.intervalStart || normalized.intervalEnd !== result.intervalEnd) {
    throw oralHistoryError("口述史回答时间区间不规范。", "ORAL_HISTORY_BACKUP_INVALID");
  }
  const lifecycleValid =
    (status === "draft" && !result.confirmedAt && !result.supersededAt && !result.withdrawnAt) ||
    (status === "confirmed" && result.confirmedAt && !result.supersededAt && !result.withdrawnAt) ||
    (status === "superseded" && result.supersededAt && !result.withdrawnAt) ||
    (status === "withdrawn" && result.withdrawnAt && !result.supersededAt);
  if (!lifecycleValid) {
    throw oralHistoryError("口述史回答生命周期时间无效。", "ORAL_HISTORY_BACKUP_INVALID");
  }
  const createdTime = Date.parse(result.createdAt);
  const lifecycleTimes = [result.confirmedAt, result.supersededAt, result.withdrawnAt]
    .filter(Boolean)
    .map(Date.parse);
  if (lifecycleTimes.some((timestamp) => timestamp < createdTime) ||
      (result.confirmedAt && result.supersededAt && Date.parse(result.confirmedAt) > Date.parse(result.supersededAt)) ||
      (result.confirmedAt && result.withdrawnAt && Date.parse(result.confirmedAt) > Date.parse(result.withdrawnAt))) {
    throw oralHistoryError("口述史回答生命周期时间顺序无效。", "ORAL_HISTORY_BACKUP_INVALID");
  }
  return result;
}

function sameSubmission(existing, next) {
  return existing.assetId === next.assetId && existing.segmentStartMs === next.segmentStartMs &&
    existing.segmentEndMs === next.segmentEndMs && existing.transcriptText === next.transcriptText &&
    originalSubmissionStatus(existing) === next.status && existing.resolutionKind === next.resolutionKind &&
    existing.intervalStart === next.intervalStart && existing.intervalEnd === next.intervalEnd;
}

function originalSubmissionStatus(answer) {
  return answer.confirmedAt ? "confirmed" : "draft";
}

function restoredSubmissionSha256(answer) {
  // Legacy/full archives intentionally expose no idempotency request digest.
  // Use a domain-separated value so a restored row can never be mistaken for
  // a live HTTP retry whose exact original question-set boundary is unknown.
  return sha256(stableStringify({
    restoredOralHistorySubmission: true,
    answer: {
      assetId: answer.assetId,
      intervalEnd: answer.intervalEnd,
      intervalStart: answer.intervalStart,
      resolutionKind: answer.resolutionKind,
      segmentEndMs: answer.segmentEndMs,
      segmentStartMs: answer.segmentStartMs,
      submissionId: answer.submissionId,
      transcriptText: answer.transcriptText
    }
  }));
}

function normalizeIdMap(value, name) {
  const entries = value instanceof Map ? [...value] : isPlainObject(value) ? Object.entries(value) : [];
  const result = new Map(entries.map(([source, target]) => [requireId(source, `${name} source`), requireId(target, `${name} target`)]));
  if (new Set(result.values()).size !== result.size) throw oralHistoryError(`${name} 映射发生碰撞。`, "ORAL_HISTORY_RESTORE_MAPPING_INVALID");
  return result;
}

function questionSetChanged() {
  return oralHistoryError("时间差异来源已经变化，请刷新后再继续。", "ORAL_HISTORY_QUESTION_SET_CHANGED", 409);
}

function timestampAfter(value, previous) {
  const raw = requireTimestamp(value, "now()");
  const next = Math.max(Date.parse(raw), Number.isFinite(Date.parse(previous)) ? Date.parse(previous) + 1 : 0);
  return new Date(next).toISOString();
}

function normalizeSqliteError(error) {
  const text = String(error?.message || "");
  if (text.includes("ORAL_HISTORY_ASSET_OR_SEGMENT_INVALID")) return oralHistoryError("声音资产或时间段已经变化。", "ORAL_HISTORY_ASSET_OR_SEGMENT_INVALID", 409);
  if (text.includes("ORAL_HISTORY_ANSWER_IMMUTABLE")) return oralHistoryError("口述史回答正文不可原地覆盖。", "ORAL_HISTORY_ANSWER_IMMUTABLE", 409);
  return error;
}

function requireDatabase(db) {
  if (!db || typeof db.prepare !== "function" || typeof db.exec !== "function") throw new TypeError("口述史数据库需要同步 SQLite 连接。");
  return db;
}

function requireId(value, name) {
  const id = String(value || "").trim();
  if (!/^[a-zA-Z0-9_-]{1,120}$/u.test(id)) throw oralHistoryError(`${name} 无效。`, "ORAL_HISTORY_ID_INVALID");
  return id;
}

function requireSubmissionId(value) {
  const id = String(value || "").trim();
  if (!/^[a-zA-Z0-9_-]{8,120}$/u.test(id)) throw oralHistoryError("submissionId 无效。", "ORAL_HISTORY_SUBMISSION_ID_INVALID");
  return id;
}

function requireSha256(value, name) {
  const hash = String(value || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(hash)) throw oralHistoryError(`${name} 必须是 SHA-256。`, "ORAL_HISTORY_HASH_INVALID");
  return hash;
}

function requireInteger(value, name, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw oralHistoryError(`${name} 无效。`, "ORAL_HISTORY_VALUE_INVALID");
  return value;
}

function requireText(value, name, maximum) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maximum || value.includes("\0")) throw oralHistoryError(`${name} 无效。`, "ORAL_HISTORY_VALUE_INVALID");
  return value.trim();
}

function requireTimestamp(value, name) {
  const timestamp = String(value || "").trim();
  if (!timestamp || timestamp.length > 40 || !Number.isFinite(Date.parse(timestamp))) throw oralHistoryError(`${name} 时间戳无效。`, "ORAL_HISTORY_TIMESTAMP_INVALID");
  return timestamp;
}

function optionalTimestamp(value, name) {
  return value ? requireTimestamp(value, name) : "";
}

function requireCount(value, name, maximum) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) throw oralHistoryError(`${name} 无效。`, "ORAL_HISTORY_BACKUP_INVALID");
}

function assertUnique(values, name) {
  if (new Set(values).size !== values.length) throw oralHistoryError(`${name} 不能重复。`, "ORAL_HISTORY_BACKUP_INVALID");
}

function assertExactKeys(value, expected, name) {
  if (!isPlainObject(value)) throw oralHistoryError(`${name} 必须是对象。`, "ORAL_HISTORY_BACKUP_INVALID");
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) throw oralHistoryError(`${name} 字段集合无效。`, "ORAL_HISTORY_BACKUP_INVALID");
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

module.exports = {
  MAX_QUESTIONS,
  ORAL_HISTORY_MIGRATION,
  ORAL_HISTORY_REDACTED_NOTE,
  initializeOralHistoryDatabase,
  validateOralHistoryBackupPayload
};
