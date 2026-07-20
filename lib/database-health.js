"use strict";

const { validateTimeCalibrationBackupPayload } = require("./time-calibration-database");
const { validateOralHistoryBackupPayload } = require("./oral-history-database");
const {
  CURATOR_AGENT_SCHEMA_VERSION,
  validateCuratorAgentArchiveEnvelope
} = require("./curator-agent-backup");
const { MEMORY_INBOX_SCHEMA_VERSION } = require("./memory-inbox-service");
const { validateMemoryInboxBackupPayload } = require("./memory-inbox-backup");
const { validateProvenanceBackupPayload } = require("./provenance-backup");
const { PROVENANCE_SCHEMA_VERSION } = require("./provenance-service");
const { validateCoMemoryResponseBackupPayload } = require("./co-memory-response-backup");
const { CO_MEMORY_RESPONSE_SCHEMA_VERSION } = require("./co-memory-response-service");
const { MUSEUM_LOCK_SCHEMA_VERSION } = require("./museum-lock-database");
const { normalizeMuseumLockState, publicMuseumLockState } = require("./museum-lock-service");

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
  const getMemoryInboxBackup = optionalFunction(
    options.getMemoryInboxBackup || options.buildMemoryInboxBackup,
    "getMemoryInboxBackup"
  );
  const getMemoryInboxHealthSnapshot = optionalFunction(
    options.getMemoryInboxHealthSnapshot || options.getMemoryInboxStats,
    "getMemoryInboxHealthSnapshot"
  );
  const getProvenanceBackup = optionalFunction(
    options.getProvenanceBackup || options.buildProvenanceBackup,
    "getProvenanceBackup"
  );
  const getProvenanceHealthSnapshot = optionalFunction(
    options.getProvenanceHealthSnapshot || options.getProvenanceStats,
    "getProvenanceHealthSnapshot"
  );
  const getCoMemoryResponseBackup = optionalFunction(
    options.getCoMemoryResponseBackup || options.buildCoMemoryResponseBackup,
    "getCoMemoryResponseBackup"
  );
  const getCoMemoryResponseHealthSnapshot = optionalFunction(
    options.getCoMemoryResponseHealthSnapshot || options.getCoMemoryResponseStats,
    "getCoMemoryResponseHealthSnapshot"
  );
  const getMuseumLockState = optionalFunction(options.getMuseumLockState, "getMuseumLockState");

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
    let memoryInboxHealth = emptyMemoryInboxHealth();
    let memoryInboxStructureOk = true;
    if (schemaVersion >= MEMORY_INBOX_SCHEMA_VERSION) {
      try {
        memoryInboxStructureOk = validateMemoryInboxRows();
        if (memoryInboxStructureOk) memoryInboxHealth = readMemoryInboxHealth();
      } catch {
        memoryInboxStructureOk = false;
      }
      checks.push({ code: "DATABASE_MEMORY_INBOX_STRUCTURE", ok: memoryInboxStructureOk });
    }
    let provenanceHealth = emptyProvenanceHealth();
    let provenanceStructureOk = true;
    if (schemaVersion >= PROVENANCE_SCHEMA_VERSION) {
      try {
        provenanceStructureOk = validateProvenanceRows();
        if (provenanceStructureOk) provenanceHealth = readProvenanceHealth();
      } catch {
        provenanceStructureOk = false;
      }
      checks.push({ code: "DATABASE_PROVENANCE_STRUCTURE", ok: provenanceStructureOk });
    }
    let coMemoryResponseHealth = emptyCoMemoryResponseHealth();
    let coMemoryResponseStructureOk = true;
    if (schemaVersion >= CO_MEMORY_RESPONSE_SCHEMA_VERSION) {
      try {
        coMemoryResponseStructureOk = validateCoMemoryResponseRows();
        if (coMemoryResponseStructureOk) coMemoryResponseHealth = readCoMemoryResponseHealth();
      } catch {
        coMemoryResponseStructureOk = false;
      }
      checks.push({ code: "DATABASE_CO_MEMORY_RESPONSE_STRUCTURE", ok: coMemoryResponseStructureOk });
    }
    if (schemaVersion >= MUSEUM_LOCK_SCHEMA_VERSION) {
      let museumLockStructureOk = true;
      try {
        museumLockStructureOk = validateMuseumLockRows();
      } catch {
        museumLockStructureOk = false;
      }
      checks.push({ code: "DATABASE_MUSEUM_LOCK_STRUCTURE", ok: museumLockStructureOk });
    }
    const reviewSpecs = [
      ["memory_claims", "status = 'source_invalidated'", "CLAIM_SOURCE_INVALIDATED", "memory_id"],
      ["exhibitions", "needs_review = 1", "EXHIBITION_NEEDS_REVIEW", "id"],
      ["time_capsules", "needs_review = 1", "CAPSULE_NEEDS_REVIEW", "id"],
      ["curator_questions", "status = 'open'", "CURATOR_QUESTION_OPEN", "id"],
      ["voice_transcripts", "status = 'draft'", "VOICE_TRANSCRIPT_DRAFT", "memory_id"],
      ["oral_history_answers", "status = 'draft'", "ORAL_HISTORY_ANSWER_DRAFT", "id"],
      ["oral_history_questions", "NOT EXISTS (SELECT 1 FROM oral_history_answers answer WHERE answer.question_id = oral_history_questions.id AND answer.status = 'confirmed')", "ORAL_HISTORY_QUESTION_OPEN", "id"]
      , ["memory_inbox_items", "status = 'pending'", "MEMORY_INBOX_PENDING", "id"]
      , ["memory_inbox_items", "needs_review = 1", "MEMORY_INBOX_NEEDS_REVIEW", "id"]
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
    if (provenanceStructureOk && schemaVersion >= PROVENANCE_SCHEMA_VERSION && provenanceHealth.needsReview > 0) {
      issues.push({ code: "PROVENANCE_CLAIM_NEEDS_REVIEW", severity: "attention", area: "curation" });
      issueCounts.push({
        code: "PROVENANCE_CLAIM_NEEDS_REVIEW",
        severity: "attention",
        area: "curation",
        count: provenanceHealth.needsReview
      });
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
        } : {}),
        ...(schemaVersion >= MEMORY_INBOX_SCHEMA_VERSION ? {
          memoryInboxSources: memoryInboxHealth.sources,
          memoryInboxItems: memoryInboxHealth.items,
          memoryInboxPending: memoryInboxHealth.pending,
          memoryInboxAccepted: memoryInboxHealth.accepted,
          memoryInboxNeedsReview: memoryInboxHealth.needsReview
        } : {}),
        ...(schemaVersion >= PROVENANCE_SCHEMA_VERSION ? {
          provenanceClaims: provenanceHealth.claims,
          provenanceSources: provenanceHealth.sources,
          provenanceEvents: provenanceHealth.events,
          provenanceConfirmed: provenanceHealth.confirmed,
          provenanceNeedsReview: provenanceHealth.needsReview
        } : {}),
        ...(schemaVersion >= CO_MEMORY_RESPONSE_SCHEMA_VERSION ? {
          coMemoryResponses: coMemoryResponseHealth.responses,
          coMemoryUnverifiedIdentity: coMemoryResponseHealth.unverifiedIdentity,
          coMemoryEncryptedTransport: coMemoryResponseHealth.encryptedTransport,
          coMemoryUnsigned: coMemoryResponseHealth.unsigned
        } : {})
      }
    };
  }

  function validateMemoryInboxRows() {
    if (!tableExists("memory_inbox_sources") || !tableExists("memory_inbox_items") || !getMemoryInboxBackup) return false;
    const sourceSql = normalizedTableSql("memory_inbox_sources");
    const itemSql = normalizedTableSql("memory_inbox_items");
    if (!sourceSql.includes("schema_version = 15") || !itemSql.includes("schema_version = 15") ||
        !itemSql.includes("status in ('pending', 'dismissed', 'accepted', 'orphaned')")) return false;
    if (!hasForeignKey("memory_inbox_items", "source_id", "memory_inbox_sources", "id", "RESTRICT") ||
        !hasForeignKey("memory_inbox_items", "memory_id", "memories", "id", "RESTRICT")) return false;
    const backup = getMemoryInboxBackup("full");
    if (backup && typeof backup.then === "function") return false;
    validateMemoryInboxBackupPayload(backup, { memoryIds: db.prepare("SELECT id FROM memories ORDER BY id").all().map((row) => row.id) });
    return true;
  }

  function readMemoryInboxHealth() {
    const direct = {
      sources: count("memory_inbox_sources"),
      items: count("memory_inbox_items"),
      pending: inboxCount("status = 'pending'"),
      accepted: inboxCount("status = 'accepted'"),
      needsReview: inboxCount("needs_review = 1")
    };
    if (!getMemoryInboxHealthSnapshot) return direct;
    const supplied = getMemoryInboxHealthSnapshot();
    const projected = {
      sources: safeHealthCount(supplied?.sources, "memoryInbox.sources"),
      items: safeHealthCount(supplied?.items, "memoryInbox.items"),
      pending: safeHealthCount(supplied?.pending, "memoryInbox.pending"),
      accepted: safeHealthCount(supplied?.accepted, "memoryInbox.accepted"),
      needsReview: safeHealthCount(supplied?.needsReview, "memoryInbox.needsReview")
    };
    if (Object.keys(direct).some((key) => direct[key] !== projected[key])) {
      throw new TypeError("Memory-inbox health counts do not match the database.");
    }
    return projected;
  }

  function inboxCount(where) {
    return Number(db.prepare(`SELECT COUNT(*) AS count FROM memory_inbox_items WHERE ${where}`).get()?.count) || 0;
  }

  function validateProvenanceRows() {
    const tables = ["provenance_claims", "provenance_claim_sources", "provenance_claim_events"];
    if (tables.some((table) => !tableExists(table)) || !getProvenanceBackup) return false;
    const claimSql = normalizedTableSql("provenance_claims");
    const sourceSql = normalizedTableSql("provenance_claim_sources");
    const eventSql = normalizedTableSql("provenance_claim_events");
    if (!claimSql.includes("schema_version = 16") ||
        !sourceSql.includes("relation_kind in ('supports', 'supplements', 'different_record')") ||
        (schemaVersion >= 18 && !sourceSql.includes("'co_memory_response'")) ||
        !eventSql.includes("action in ('created', 'confirmed', 'withdrawn')")) return false;
    if (!hasForeignKey("provenance_claims", "memory_id", "memories", "id") ||
        !hasForeignKey("provenance_claim_sources", "claim_id", "provenance_claims", "id") ||
        !hasForeignKey("provenance_claim_events", "claim_id", "provenance_claims", "id")) return false;
    const backup = getProvenanceBackup("full");
    if (backup && typeof backup.then === "function") return false;
    validateProvenanceBackupPayload(backup, {
      memoryIds: db.prepare("SELECT id FROM memories ORDER BY id").all().map((row) => row.id)
    });
    return true;
  }

  function readProvenanceHealth() {
    const direct = {
      claims: count("provenance_claims"),
      sources: count("provenance_claim_sources"),
      events: count("provenance_claim_events")
    };
    if (!getProvenanceHealthSnapshot) return { ...emptyProvenanceHealth(), ...direct };
    const supplied = getProvenanceHealthSnapshot();
    const projected = {
      claims: safeHealthCount(supplied?.claims, "provenance.claims"),
      sources: safeHealthCount(supplied?.sources, "provenance.sources"),
      events: safeHealthCount(supplied?.events, "provenance.events"),
      confirmed: safeHealthCount(supplied?.confirmed, "provenance.confirmed"),
      needsReview: safeHealthCount(supplied?.needsReview, "provenance.needsReview")
    };
    if (["claims", "sources", "events"].some((key) => direct[key] !== projected[key])) {
      throw new TypeError("Provenance health counts do not match the database.");
    }
    return projected;
  }

  function validateCoMemoryResponseRows() {
    if (!tableExists("co_memory_responses") || !getCoMemoryResponseBackup) return false;
    const sql = normalizedTableSql("co_memory_responses");
    const required = [
      "schema_version = 17",
      "kind = 'co_memory_response'",
      "relation_kind = 'supplements'",
      "identity_assurance = 'self-asserted-unverified'",
      "identity_verified = 0",
      "encrypted = 1",
      "signed = 0",
      "confirmation = 'user_confirmed_unverified'"
    ];
    if (required.some((fragment) => !sql.includes(fragment)) ||
        !hasForeignKey("co_memory_responses", "memory_id", "memories", "id")) return false;
    const backup = getCoMemoryResponseBackup("full");
    if (backup && typeof backup.then === "function") return false;
    validateCoMemoryResponseBackupPayload(backup, {
      memoryIds: db.prepare("SELECT id FROM memories ORDER BY id").all().map((row) => row.id)
    });
    return true;
  }

  function readCoMemoryResponseHealth() {
    const direct = {
      responses: count("co_memory_responses"),
      unverifiedIdentity: coMemoryResponseCount("identity_verified = 0"),
      encryptedTransport: coMemoryResponseCount("encrypted = 1"),
      unsigned: coMemoryResponseCount("signed = 0")
    };
    if (!getCoMemoryResponseHealthSnapshot) return direct;
    const supplied = getCoMemoryResponseHealthSnapshot();
    const projected = {
      responses: safeHealthCount(supplied?.responses, "coMemory.responses"),
      unverifiedIdentity: safeHealthCount(supplied?.unverifiedIdentity, "coMemory.unverifiedIdentity"),
      encryptedTransport: safeHealthCount(supplied?.encryptedTransport, "coMemory.encryptedTransport"),
      unsigned: safeHealthCount(supplied?.unsigned, "coMemory.unsigned")
    };
    if (Object.keys(direct).some((key) => direct[key] !== projected[key])) {
      throw new TypeError("Co-memory response health counts do not match the database.");
    }
    return projected;
  }

  function coMemoryResponseCount(where) {
    return Number(db.prepare(`SELECT COUNT(*) AS count FROM co_memory_responses WHERE ${where}`).get()?.count) || 0;
  }

  function validateMuseumLockRows() {
    if (!tableExists("museum_lock_state") || !getMuseumLockState || count("museum_lock_state") !== 1) return false;
    const sql = normalizedTableSql("museum_lock_state");
    if (!sql.includes("singleton_key = 1") || !sql.includes("schema_version = 19") ||
        !sql.includes("status in ('unlocked', 'locked')") || !sql.includes("json_valid(recovery_verifier_json)")) return false;
    const state = getMuseumLockState();
    if (state && typeof state.then === "function") return false;
    const normalized = normalizeMuseumLockState(state);
    const projection = publicMuseumLockState(normalized);
    return projection.revision === normalized.revision && projection.status === normalized.status &&
      !Object.hasOwn(projection, "recoveryVerifier") && !Object.hasOwn(projection, "salt") && !Object.hasOwn(projection, "digest");
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

  function hasForeignKey(tableName, fromColumn, targetTable, targetColumn, onDelete = "CASCADE") {
    const rows = db.prepare(`
      SELECT "table" AS target_table, "from" AS from_column, "to" AS target_column, on_delete
      FROM pragma_foreign_key_list(?)
    `).all(tableName);
    return rows.some((row) => row.from_column === fromColumn && row.target_table === targetTable &&
      row.target_column === targetColumn && String(row.on_delete || "").toUpperCase() === String(onDelete).toUpperCase());
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

function emptyMemoryInboxHealth() {
  return { sources: 0, items: 0, pending: 0, accepted: 0, needsReview: 0 };
}

function emptyProvenanceHealth() {
  return { claims: 0, sources: 0, events: 0, confirmed: 0, needsReview: 0 };
}

function emptyCoMemoryResponseHealth() {
  return { responses: 0, unverifiedIdentity: 0, encryptedTransport: 0, unsigned: 0 };
}

function safeHealthCount(value, name) {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) throw new TypeError(`Curator-agent ${name} count is invalid.`);
  return count;
}

module.exports = { createDatabaseHealthReader };
