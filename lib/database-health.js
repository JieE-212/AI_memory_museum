"use strict";

const { validateTimeCalibrationBackupPayload } = require("./time-calibration-database");
const { validateOralHistoryBackupPayload } = require("./oral-history-database");
const {
  CURATOR_AGENT_SCHEMA_VERSION,
  validateCuratorAgentArchiveEnvelope
} = require("./curator-agent-backup");

const TIME_CALIBRATION_SCHEMA_VERSION = 12;
const ORAL_HISTORY_SCHEMA_VERSION = 13;

function createDatabaseHealthReader(options = {}) {
  const db = options.db;
  const schemaVersion = Number(options.schemaVersion);
  if (!db || typeof db.prepare !== "function" || !Number.isSafeInteger(schemaVersion) || schemaVersion < 1) {
    throw new TypeError("Database health reader dependencies are required.");
  }
  const getTimeCalibrationHealthSnapshot = optionalFunction(
    options.getTimeCalibrationHealthSnapshot || options.getTimeCalibrationStats,
    "getTimeCalibrationHealthSnapshot"
  );
  const getCuratorAgentBackup = optionalFunction(
    options.getCuratorAgentBackup || options.buildCuratorAgentBackup,
    "getCuratorAgentBackup"
  );
  const getCuratorAgentHealthSnapshot = optionalFunction(
    options.getCuratorAgentHealthSnapshot || options.getCuratorAgentStats,
    "getCuratorAgentHealthSnapshot"
  );

  function snapshot() {
    const quickRows = db.prepare("PRAGMA quick_check").all();
    const quickOk = quickRows.length === 1 && String(Object.values(quickRows[0])[0] || "").toLowerCase() === "ok";
    const foreignRows = db.prepare("PRAGMA foreign_key_check").all();
    const userVersion = Number(db.prepare("PRAGMA user_version").get()?.user_version) || 0;
    const ledgerVersion = tableExists("schema_migrations")
      ? Number(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()?.version) || 0
      : 0;
    const documentCount = count("memory_search_documents");
    const ftsCount = count("memory_search_fts_docsize");
    const ftsMembershipOk = sameSearchMembership();
    const checks = [
      { code: "DATABASE_QUICK_CHECK", ok: quickOk },
      { code: "DATABASE_FOREIGN_KEYS", ok: foreignRows.length === 0 },
      { code: "DATABASE_SCHEMA", ok: userVersion === schemaVersion && ledgerVersion === schemaVersion },
      { code: "DATABASE_FTS_COUNT", ok: documentCount === ftsCount },
      { code: "DATABASE_FTS_MEMBERSHIP", ok: ftsMembershipOk }
    ];
    const timeCalibrationCount = count("time_calibrations");
    let timeCalibrationStructureOk = true;
    if (schemaVersion >= TIME_CALIBRATION_SCHEMA_VERSION) {
      timeCalibrationStructureOk = validateTimeCalibrationRows();
      checks.push({ code: "DATABASE_TIME_CALIBRATION_STRUCTURE", ok: timeCalibrationStructureOk });
    }
    const oralHistoryQuestionCount = count("oral_history_questions");
    const oralHistoryAnswerCount = count("oral_history_answers");
    let oralHistoryStructureOk = true;
    if (schemaVersion >= ORAL_HISTORY_SCHEMA_VERSION) {
      oralHistoryStructureOk = validateOralHistoryRows();
      checks.push({ code: "DATABASE_ORAL_HISTORY_STRUCTURE", ok: oralHistoryStructureOk });
    }
    let curatorAgentHealth = emptyCuratorAgentHealth();
    let curatorAgentStructureOk = true;
    if (schemaVersion >= CURATOR_AGENT_SCHEMA_VERSION) {
      try {
        curatorAgentStructureOk = validateCuratorAgentRows();
        if (curatorAgentStructureOk) curatorAgentHealth = readCuratorAgentHealth();
      } catch {
        curatorAgentStructureOk = false;
      }
      checks.push({ code: "DATABASE_CURATOR_AGENT_STRUCTURE", ok: curatorAgentStructureOk });
    }
    const reviewSpecs = [
      ["memory_claims", "status = 'source_invalidated'", "CLAIM_SOURCE_INVALIDATED", "memory_id"],
      ["exhibitions", "needs_review = 1", "EXHIBITION_NEEDS_REVIEW", "id"],
      ["time_capsules", "needs_review = 1", "CAPSULE_NEEDS_REVIEW", "id"],
      ["curator_questions", "status = 'open'", "CURATOR_QUESTION_OPEN", "id"],
      ["voice_transcripts", "status = 'draft'", "VOICE_TRANSCRIPT_DRAFT", "memory_id"],
      ["oral_history_answers", "status = 'draft'", "ORAL_HISTORY_ANSWER_DRAFT", "id"],
      ["oral_history_questions", "NOT EXISTS (SELECT 1 FROM oral_history_answers answer WHERE answer.question_id = oral_history_questions.id AND answer.status = 'confirmed')", "ORAL_HISTORY_QUESTION_OPEN", "id"]
    ];
    const issues = reviewSpecs.flatMap((spec) => reviewRows(...spec));
    const issueCounts = reviewSpecs.map((spec) => reviewCount(...spec)).filter((item) => item.count > 0);
    const calibrationReview = timeCalibrationStructureOk
      ? readTimeCalibrationReview(timeCalibrationCount)
      : { count: 0, ids: [] };
    if (calibrationReview.count > 0) {
      const sampledIds = calibrationReview.ids.slice(0, 20);
      if (sampledIds.length) {
        issues.push(...sampledIds.map((recordId) => ({
          code: "TIME_CALIBRATION_NEEDS_REVIEW",
          severity: "attention",
          area: "curation",
          recordId
        })));
      } else {
        issues.push({ code: "TIME_CALIBRATION_NEEDS_REVIEW", severity: "attention", area: "curation" });
      }
      issueCounts.push({
        code: "TIME_CALIBRATION_NEEDS_REVIEW",
        severity: "attention",
        area: "curation",
        count: calibrationReview.count
      });
    }
    if (curatorAgentStructureOk && schemaVersion >= CURATOR_AGENT_SCHEMA_VERSION) {
      appendCuratorAgentReview(
        issues,
        issueCounts,
        "CURATOR_AGENT_RUN_INTERRUPTED",
        curatorAgentHealth.interrupted,
        "status = 'interrupted'"
      );
      appendCuratorAgentReview(
        issues,
        issueCounts,
        "CURATOR_AGENT_RUN_NEEDS_REVIEW",
        curatorAgentHealth.needsReview,
        "needs_review = 1"
      );
    }
    return {
      ok: checks.every((check) => check.ok),
      checks,
      issues,
      issueCounts,
      counts: {
        memories: count("memories"),
        mediaAssets: count("media_assets"),
        voiceAssets: count("voice_assets"),
        exhibitions: count("exhibitions"),
        capsules: count("time_capsules"),
        entities: count("entities"),
        revisions: count("memory_revisions"),
        timeCalibrations: timeCalibrationCount,
        oralHistoryQuestions: oralHistoryQuestionCount,
        oralHistoryAnswers: oralHistoryAnswerCount,
        confirmedOralHistoryAnswers: tableExists("oral_history_answers")
          ? Number(db.prepare("SELECT COUNT(*) AS count FROM oral_history_answers WHERE status = 'confirmed'").get()?.count) || 0
          : 0,
        searchDocuments: documentCount,
        ...(schemaVersion >= CURATOR_AGENT_SCHEMA_VERSION ? {
          curatorAgentRuns: curatorAgentHealth.runs,
          curatorAgentSteps: curatorAgentHealth.steps,
          curatorAgentProposals: curatorAgentHealth.proposals,
          curatorAgentDecisions: curatorAgentHealth.decisions,
          curatorAgentCompleted: curatorAgentHealth.completed,
          curatorAgentInterrupted: curatorAgentHealth.interrupted,
          curatorAgentNeedsReview: curatorAgentHealth.needsReview
        } : {})
      }
    };
  }

  function validateCuratorAgentRows() {
    const tableNames = [
      "curator_agent_runs",
      "curator_agent_steps",
      "curator_agent_proposals",
      "curator_agent_decisions"
    ];
    if (tableNames.some((tableName) => !tableExists(tableName))) return false;
    try {
      if (!getCuratorAgentBackup || !validateCuratorAgentSchema()) return false;
      const backup = getCuratorAgentBackup("full");
      if (backup && typeof backup.then === "function") return false;
      validateCuratorAgentArchiveEnvelope(backup, "full");
      return true;
    } catch {
      return false;
    }
  }

  function validateCuratorAgentSchema() {
    const runSql = normalizedTableSql("curator_agent_runs");
    const stepSql = normalizedTableSql("curator_agent_steps");
    const proposalSql = normalizedTableSql("curator_agent_proposals");
    const decisionSql = normalizedTableSql("curator_agent_decisions");
    if (!runSql || !stepSql || !proposalSql || !decisionSql) return false;
    const requiredRunFragments = [
      "schema_version = 14",
      "status in ('created', 'running', 'completed', 'cancelled', 'failed', 'interrupted')",
      "max_steps = 6",
      "max_tool_calls = 4",
      "max_duration_ms = 2000",
      "max_result_bytes = 262144",
      "max_memories = 6",
      "json_valid(request_json)",
      "json_type(request_json) = 'object'"
    ];
    if (requiredRunFragments.some((fragment) => !runSql.includes(fragment))) return false;
    if (!["args_json", "result_json"].every((column) => hasJsonConstraint(stepSql, column))) return false;
    if (!["source_refs_json", "preview_json", "relation_json", "actions_json", "duplicate_context_json"]
      .every((column) => hasJsonConstraint(proposalSql, column))) return false;
    if (!hasJsonConstraint(decisionSql, "outcome_json")) return false;
    if (!hasForeignKey("curator_agent_steps", "run_id", "curator_agent_runs", "id") ||
        !hasForeignKey("curator_agent_proposals", "run_id", "curator_agent_runs", "id") ||
        !hasForeignKey("curator_agent_decisions", "run_id", "curator_agent_runs", "id")) return false;
    return hasUniqueColumns("curator_agent_runs", ["idempotency_key"]) &&
      hasUniqueColumns("curator_agent_steps", ["run_id", "position"]) &&
      hasUniqueColumns("curator_agent_proposals", ["run_id"]) &&
      hasUniqueColumns("curator_agent_decisions", ["idempotency_key"]) &&
      hasUniqueColumns("curator_agent_decisions", ["run_id", "action"]);
  }

  function readCuratorAgentHealth() {
    const direct = {
      runs: curatorCount("SELECT COUNT(*) AS count FROM curator_agent_runs WHERE deleted_at = ''"),
      steps: curatorCount("SELECT COUNT(*) AS count FROM curator_agent_steps step JOIN curator_agent_runs run ON run.id = step.run_id WHERE run.deleted_at = ''"),
      proposals: curatorCount("SELECT COUNT(*) AS count FROM curator_agent_proposals proposal JOIN curator_agent_runs run ON run.id = proposal.run_id WHERE run.deleted_at = ''"),
      decisions: curatorCount("SELECT COUNT(*) AS count FROM curator_agent_decisions decision JOIN curator_agent_runs run ON run.id = decision.run_id WHERE run.deleted_at = ''"),
      completed: curatorCount("SELECT COUNT(*) AS count FROM curator_agent_runs WHERE deleted_at = '' AND status = 'completed'"),
      interrupted: curatorCount("SELECT COUNT(*) AS count FROM curator_agent_runs WHERE deleted_at = '' AND status = 'interrupted'"),
      needsReview: curatorCount("SELECT COUNT(*) AS count FROM curator_agent_runs WHERE deleted_at = '' AND needs_review = 1")
    };
    if (!getCuratorAgentHealthSnapshot) return direct;
    const supplied = getCuratorAgentHealthSnapshot();
    if (!supplied || typeof supplied !== "object" || Array.isArray(supplied) ||
        supplied && typeof supplied.then === "function") {
      throw new TypeError("Curator-agent health snapshot must be an object.");
    }
    const projected = {
      runs: safeHealthCount(supplied.runs ?? supplied.curatorAgentRuns, "runs"),
      steps: safeHealthCount(supplied.steps ?? supplied.curatorAgentSteps, "steps"),
      proposals: safeHealthCount(supplied.proposals ?? supplied.curatorAgentProposals, "proposals"),
      decisions: safeHealthCount(supplied.decisions ?? supplied.curatorAgentDecisions, "decisions"),
      completed: safeHealthCount(supplied.completed ?? supplied.curatorAgentCompleted, "completed"),
      interrupted: safeHealthCount(supplied.interrupted ?? supplied.curatorAgentInterrupted, "interrupted"),
      needsReview: safeHealthCount(supplied.needsReview ?? supplied.curatorAgentNeedsReview, "needsReview")
    };
    if (Object.keys(direct).some((key) => direct[key] !== projected[key])) {
      throw new TypeError("Curator-agent health counts do not match the database.");
    }
    return projected;
  }

  function appendCuratorAgentReview(issues, issueCounts, code, total, where) {
    if (total < 1) return;
    const sampled = db.prepare(`
      SELECT id AS record_id FROM curator_agent_runs
      WHERE deleted_at = '' AND ${where}
      ORDER BY id LIMIT 20
    `).all();
    issues.push(...sampled.map((row) => ({
      code,
      severity: "attention",
      area: "curation",
      recordId: row.record_id
    })));
    issueCounts.push({ code, severity: "attention", area: "curation", count: total });
  }

  function validateTimeCalibrationRows() {
    if (!tableExists("time_calibrations")) return false;
    try {
      const calibrations = db.prepare(`
        SELECT id, memory_id, event_id, resolution_kind, interval_start, interval_end,
          selected_source_keys_json, selected_source_snapshots_json,
          source_set_sha256, note, created_at, updated_at
        FROM time_calibrations
      `).all().map((row) => ({
        id: row.id,
        memoryId: row.memory_id || "",
        eventId: row.event_id || "",
        resolutionKind: row.resolution_kind,
        intervalStart: row.interval_start,
        intervalEnd: row.interval_end,
        selectedSourceKeys: JSON.parse(row.selected_source_keys_json),
        selectedSourceSnapshots: JSON.parse(row.selected_source_snapshots_json),
        currentSourceSetSha256: row.source_set_sha256,
        sourceSetSha256: row.source_set_sha256,
        note: row.note,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }));
      calibrations.sort((left, right) => {
        const leftTarget = left.memoryId ? `memory:${left.memoryId}` : `event:${left.eventId}`;
        const rightTarget = right.memoryId ? `memory:${right.memoryId}` : `event:${right.eventId}`;
        return leftTarget.localeCompare(rightTarget, "en") || String(left.id).localeCompare(String(right.id), "en");
      });
      validateTimeCalibrationBackupPayload({
        mode: "full",
        schemaVersion: TIME_CALIBRATION_SCHEMA_VERSION,
        calibrations
      });
      return true;
    } catch {
      return false;
    }
  }

  function validateOralHistoryRows() {
    if (!tableExists("oral_history_questions") || !tableExists("oral_history_answers") ||
        !tableExists("memory_events") || !tableExists("voice_assets")) return false;
    try {
      const questions = db.prepare(`
        SELECT id, event_id, question_key, question_text, origin_sources_json,
          origin_source_set_sha256, created_at, updated_at
        FROM oral_history_questions
        ORDER BY event_id, id
      `).all().map((row) => ({
        id: row.id,
        eventId: row.event_id,
        questionKey: row.question_key,
        text: row.question_text,
        sources: JSON.parse(row.origin_sources_json),
        originSourceSetSha256: row.origin_source_set_sha256,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }));
      const answers = db.prepare(`
        SELECT id, question_id, submission_id, asset_id, segment_start_ms,
          segment_end_ms, transcript_text, status, resolution_kind,
          interval_start, interval_end, created_at, confirmed_at,
          superseded_at, withdrawn_at
        FROM oral_history_answers
        ORDER BY question_id, created_at, id
      `).all().map((row) => ({
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
      }));
      const eventIds = db.prepare("SELECT id FROM memory_events ORDER BY id").all().map((row) => row.id);
      const voiceAssetIds = db.prepare("SELECT id FROM voice_assets ORDER BY id").all().map((row) => row.id);
      validateOralHistoryBackupPayload(
        { mode: "full", schemaVersion: ORAL_HISTORY_SCHEMA_VERSION, questions, answers },
        { eventIds, voiceAssetIds }
      );
      const invalidSegment = db.prepare(`
        SELECT 1 AS invalid
        FROM oral_history_answers answer
        LEFT JOIN voice_assets asset ON asset.id = answer.asset_id
        WHERE asset.id IS NULL OR asset.status <> 'ready'
          OR answer.segment_start_ms < 0
          OR answer.segment_end_ms <= answer.segment_start_ms
          OR answer.segment_end_ms > asset.duration_ms
        LIMIT 1
      `).get();
      return !invalidSegment;
    } catch {
      return false;
    }
  }

  function readTimeCalibrationReview(calibrationCount) {
    if (!getTimeCalibrationHealthSnapshot || calibrationCount < 1) return { count: 0, ids: [] };
    const snapshot = getTimeCalibrationHealthSnapshot();
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
      throw new TypeError("Time calibration health snapshot must be an object.");
    }
    const count = Number(snapshot.needsReview);
    if (!Number.isSafeInteger(count) || count < 0 || count > calibrationCount) {
      throw new TypeError("Time calibration needsReview count is invalid.");
    }
    const rawIds = snapshot.needsReviewIds === undefined ? [] : snapshot.needsReviewIds;
    if (!Array.isArray(rawIds)) throw new TypeError("Time calibration needsReviewIds must be an array.");
    const ids = [...new Set(rawIds.filter((value) => /^[A-Za-z][A-Za-z0-9_-]{0,119}$/u.test(String(value))))]
      .map(String)
      .slice(0, 20);
    return { count, ids };
  }

  function normalizedTableSql(tableName) {
    const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName)?.sql;
    return String(sql || "").replace(/\s+/gu, " ").toLowerCase();
  }

  function hasJsonConstraint(sql, column) {
    return sql.includes(`json_valid(${column})`) && sql.includes(`json_type(${column})`);
  }

  function hasForeignKey(tableName, fromColumn, targetTable, targetColumn) {
    const rows = db.prepare(`
      SELECT "table" AS target_table, "from" AS from_column, "to" AS target_column, on_delete
      FROM pragma_foreign_key_list(?)
    `).all(tableName);
    return rows.some((row) => row.from_column === fromColumn && row.target_table === targetTable &&
      row.target_column === targetColumn && String(row.on_delete || "").toUpperCase() === "CASCADE");
  }

  function hasUniqueColumns(tableName, expectedColumns) {
    const indexes = db.prepare(`
      SELECT name FROM pragma_index_list(?) WHERE "unique" = 1
    `).all(tableName);
    return indexes.some((index) => {
      const columns = db.prepare("SELECT name FROM pragma_index_info(?) ORDER BY seqno").all(index.name)
        .map((row) => row.name);
      return columns.length === expectedColumns.length &&
        columns.every((column, position) => column === expectedColumns[position]);
    });
  }

  function curatorCount(sql) {
    const value = Number(db.prepare(sql).get()?.count);
    if (!Number.isSafeInteger(value) || value < 0) throw new TypeError("Curator-agent count is invalid.");
    return value;
  }

  function count(tableName) {
    return tableExists(tableName) ? Number(db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get()?.count) || 0 : 0;
  }

  function reviewRows(tableName, where, code, idColumn) {
    if (!tableExists(tableName)) return [];
    return db.prepare(`SELECT ${idColumn} AS record_id FROM ${tableName} WHERE ${where} ORDER BY ${idColumn} LIMIT 20`).all()
      .map((row) => ({ code, severity: "attention", area: "curation", recordId: row.record_id }));
  }

  function reviewCount(tableName, where, code) {
    if (!tableExists(tableName)) return { code, severity: "attention", area: "curation", count: 0 };
    const value = Number(db.prepare(`SELECT COUNT(*) AS count FROM ${tableName} WHERE ${where}`).get()?.count) || 0;
    return { code, severity: "attention", area: "curation", count: value };
  }

  function sameSearchMembership() {
    if (!tableExists("memory_search_documents") || !tableExists("memory_search_fts_docsize")) return false;
    const mismatch = db.prepare(`
      SELECT 1 AS mismatch
      FROM (
        SELECT documents.id
        FROM memory_search_documents AS documents
        LEFT JOIN memory_search_fts_docsize AS indexed ON indexed.id = documents.id
        WHERE indexed.id IS NULL
        UNION ALL
        SELECT indexed.id
        FROM memory_search_fts_docsize AS indexed
        LEFT JOIN memory_search_documents AS documents ON documents.id = indexed.id
        WHERE documents.id IS NULL
      )
      LIMIT 1
    `).get();
    return !mismatch;
  }

  function tableExists(tableName) {
    return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE name = ? AND type IN ('table', 'view')").get(tableName));
  }

  return Object.freeze({ snapshot });
}

function optionalFunction(value, name) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "function") throw new TypeError(`${name} must be a function.`);
  return value;
}

function emptyCuratorAgentHealth() {
  return { runs: 0, steps: 0, proposals: 0, decisions: 0, completed: 0, interrupted: 0, needsReview: 0 };
}

function safeHealthCount(value, name) {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) throw new TypeError(`Curator-agent ${name} count is invalid.`);
  return count;
}

module.exports = { createDatabaseHealthReader };
