"use strict";

const { randomUUID } = require("node:crypto");
const { applyMigrations } = require("./migrations");
const {
  CURATOR_AGENT_LIMITS,
  CURATOR_AGENT_REDACTED_NOTE,
  curatorAgentDecisionMapKey,
  remapCuratorAgentState,
  validateCuratorAgentArchiveEnvelope
} = require("./curator-agent-backup");
const {
  CURATOR_ACTIONS,
  CURATOR_AGENT_SCHEMA_VERSION,
  DEFAULT_BUDGETS,
  READ_ONLY_TOOL_NAMES,
  RUN_STATUSES,
  buildCuratorRequestSha256,
  curatorAgentError,
  evaluateCuratorAgentTrace,
  executeCuratorAgent,
  normalizeCuratorRunRequest,
  sha256,
  stableStringify
} = require("./curator-agent-service");

const RUN_STATUS_SET = new Set(RUN_STATUSES);
const ACTION_SET = new Set(CURATOR_ACTIONS);
const DECISION_SET = new Set(["approve", "reject"]);
const MAX_RUNS = CURATOR_AGENT_LIMITS.runs;
const ID_PATTERN = /^[a-zA-Z0-9_-]{1,120}$/u;

const CURATOR_AGENT_MIGRATION = Object.freeze({
  version: CURATOR_AGENT_SCHEMA_VERSION,
  name: "bounded-curator-agent-proposals-and-approvals",
  up(db) {
    db.exec(`
      CREATE TABLE curator_agent_runs (
        id TEXT PRIMARY KEY,
        schema_version INTEGER NOT NULL DEFAULT 14 CHECK (schema_version = 14),
        idempotency_key TEXT NOT NULL UNIQUE,
        request_sha256 TEXT NOT NULL CHECK (length(request_sha256) = 64 AND request_sha256 NOT GLOB '*[^0-9a-f]*'),
        request_json TEXT NOT NULL CHECK (json_valid(request_json) AND json_type(request_json) = 'object'),
        status TEXT NOT NULL CHECK (status IN ('created', 'running', 'completed', 'cancelled', 'failed', 'interrupted')),
        version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
        max_steps INTEGER NOT NULL DEFAULT 6 CHECK (max_steps = 6),
        max_tool_calls INTEGER NOT NULL DEFAULT 4 CHECK (max_tool_calls = 4),
        max_duration_ms INTEGER NOT NULL DEFAULT 2000 CHECK (max_duration_ms = 2000),
        max_result_bytes INTEGER NOT NULL DEFAULT 262144 CHECK (max_result_bytes = 262144),
        max_memories INTEGER NOT NULL DEFAULT 6 CHECK (max_memories = 6),
        step_count INTEGER NOT NULL DEFAULT 0 CHECK (step_count BETWEEN 0 AND 6),
        tool_call_count INTEGER NOT NULL DEFAULT 0 CHECK (tool_call_count BETWEEN 0 AND 4),
        result_bytes INTEGER NOT NULL DEFAULT 0 CHECK (result_bytes BETWEEN 0 AND 262144),
        duration_ms INTEGER NOT NULL DEFAULT 0 CHECK (duration_ms >= 0),
        execute_idempotency_key TEXT NOT NULL DEFAULT '',
        execute_request_sha256 TEXT NOT NULL DEFAULT '',
        cancel_idempotency_key TEXT NOT NULL DEFAULT '',
        cancel_request_sha256 TEXT NOT NULL DEFAULT '',
        historical INTEGER NOT NULL DEFAULT 0 CHECK (historical IN (0, 1)),
        needs_review INTEGER NOT NULL DEFAULT 0 CHECK (needs_review IN (0, 1)),
        allow_decisions INTEGER NOT NULL DEFAULT 1 CHECK (allow_decisions IN (0, 1)),
        created_at TEXT NOT NULL,
        started_at TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL,
        completed_at TEXT NOT NULL DEFAULT '',
        cancelled_at TEXT NOT NULL DEFAULT '',
        interrupted_at TEXT NOT NULL DEFAULT '',
        failed_at TEXT NOT NULL DEFAULT '',
        failure_code TEXT NOT NULL DEFAULT '',
        failure_message TEXT NOT NULL DEFAULT '',
        deleted_at TEXT NOT NULL DEFAULT '',
        deletion_idempotency_key TEXT NOT NULL DEFAULT '',
        deletion_request_sha256 TEXT NOT NULL DEFAULT '',
        CHECK (execute_request_sha256 = '' OR (length(execute_request_sha256) = 64 AND execute_request_sha256 NOT GLOB '*[^0-9a-f]*')),
        CHECK (cancel_request_sha256 = '' OR (length(cancel_request_sha256) = 64 AND cancel_request_sha256 NOT GLOB '*[^0-9a-f]*')),
        CHECK (deletion_request_sha256 = '' OR (length(deletion_request_sha256) = 64 AND deletion_request_sha256 NOT GLOB '*[^0-9a-f]*')),
        CHECK (historical = 0 OR (needs_review = 1 AND allow_decisions = 0))
      );

      CREATE TABLE curator_agent_steps (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        position INTEGER NOT NULL CHECK (position BETWEEN 0 AND 5),
        tool_name TEXT NOT NULL CHECK (tool_name IN (
          'search_memory_summaries', 'read_memory_evidence',
          'read_confirmed_relationships', 'read_exhibition_summaries'
        )),
        args_json TEXT NOT NULL CHECK (json_valid(args_json) AND json_type(args_json) = 'object'),
        result_json TEXT NOT NULL CHECK (json_valid(result_json) AND json_type(result_json) = 'object'),
        result_sha256 TEXT NOT NULL CHECK (length(result_sha256) = 64 AND result_sha256 NOT GLOB '*[^0-9a-f]*'),
        result_bytes INTEGER NOT NULL CHECK (result_bytes >= 0),
        duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
        summary TEXT NOT NULL CHECK (length(summary) <= 240),
        created_at TEXT NOT NULL,
        UNIQUE (run_id, position),
        FOREIGN KEY (run_id) REFERENCES curator_agent_runs(id) ON DELETE CASCADE
      );

      CREATE TABLE curator_agent_proposals (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL UNIQUE,
        schema_version INTEGER NOT NULL DEFAULT 14 CHECK (schema_version = 14),
        engine_version TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind = 'curator-agent-proposal'),
        request_sha256 TEXT NOT NULL CHECK (length(request_sha256) = 64 AND request_sha256 NOT GLOB '*[^0-9a-f]*'),
        proposal_sha256 TEXT NOT NULL CHECK (length(proposal_sha256) = 64 AND proposal_sha256 NOT GLOB '*[^0-9a-f]*'),
        source_set_sha256 TEXT NOT NULL CHECK (length(source_set_sha256) = 64 AND source_set_sha256 NOT GLOB '*[^0-9a-f]*'),
        source_refs_json TEXT NOT NULL CHECK (
          json_valid(source_refs_json) AND json_type(source_refs_json) = 'array' AND
          json_array_length(source_refs_json) BETWEEN 2 AND 6
        ),
        preview_json TEXT NOT NULL CHECK (json_valid(preview_json) AND json_type(preview_json) = 'object'),
        relation_json TEXT NOT NULL CHECK (json_valid(relation_json) AND json_type(relation_json) IN ('object', 'null')),
        actions_json TEXT NOT NULL CHECK (
          json_valid(actions_json) AND json_type(actions_json) = 'array' AND json_array_length(actions_json) = 3
        ),
        duplicate_context_json TEXT NOT NULL CHECK (json_valid(duplicate_context_json) AND json_type(duplicate_context_json) = 'array'),
        created_at TEXT NOT NULL,
        FOREIGN KEY (run_id) REFERENCES curator_agent_runs(id) ON DELETE CASCADE
      );

      CREATE TABLE curator_agent_decisions (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        action TEXT NOT NULL CHECK (action IN ('save_exhibition', 'confirm_relationship', 'publish_exhibition')),
        decision TEXT NOT NULL CHECK (decision IN ('approve', 'reject')),
        idempotency_key TEXT NOT NULL UNIQUE,
        request_sha256 TEXT NOT NULL CHECK (length(request_sha256) = 64 AND request_sha256 NOT GLOB '*[^0-9a-f]*'),
        outcome_json TEXT NOT NULL CHECK (json_valid(outcome_json) AND json_type(outcome_json) = 'object'),
        created_at TEXT NOT NULL,
        UNIQUE (run_id, action),
        FOREIGN KEY (run_id) REFERENCES curator_agent_runs(id) ON DELETE CASCADE
      );

      CREATE INDEX idx_curator_agent_runs_recent
        ON curator_agent_runs(deleted_at, updated_at DESC, id);
      CREATE INDEX idx_curator_agent_steps_run
        ON curator_agent_steps(run_id, position);
      CREATE INDEX idx_curator_agent_decisions_run
        ON curator_agent_decisions(run_id, created_at, id);

      CREATE TRIGGER curator_agent_step_immutable
      BEFORE UPDATE ON curator_agent_steps
      BEGIN
        SELECT RAISE(ABORT, 'CURATOR_AGENT_STEP_IMMUTABLE');
      END;

      CREATE TRIGGER curator_agent_proposal_immutable
      BEFORE UPDATE ON curator_agent_proposals
      BEGIN
        SELECT RAISE(ABORT, 'CURATOR_AGENT_PROPOSAL_IMMUTABLE');
      END;

      CREATE TRIGGER curator_agent_decision_immutable
      BEFORE UPDATE ON curator_agent_decisions
      BEGIN
        SELECT RAISE(ABORT, 'CURATOR_AGENT_DECISION_IMMUTABLE');
      END;
    `);
  }
});

function initializeCuratorAgentDatabase(options = {}) {
  const db = requireDatabase(options.db);
  const suppliedTransaction = typeof options.withTransaction === "function" ? options.withTransaction : null;
  const now = typeof options.now === "function" ? options.now : () => new Date().toISOString();
  const monotonicNow = typeof options.monotonicNow === "function" ? options.monotonicNow : () => Date.now();
  const createId = typeof options.createId === "function" ? options.createId : (prefix) => `${prefix}-${randomUUID()}`;
  const parentStore = options.store || null;
  if (options.applyMigrations !== false) {
    applyMigrations({
      db,
      baselineVersion: 4,
      migrations: [CURATOR_AGENT_MIGRATION],
      supportedVersion: Math.max(CURATOR_AGENT_SCHEMA_VERSION, Number(options.schemaVersion) || CURATOR_AGENT_SCHEMA_VERSION),
      now
    });
  }
  const statements = prepareStatements(db);
  const tools = buildReadOnlyTools(options, parentStore);
  const actions = buildActionCallbacks(options, parentStore);
  const interruptedAt = requireTimestamp(now());
  statements.interruptRunning.run(interruptedAt);

  function runAtomic(operation) {
    if (suppliedTransaction) return suppliedTransaction(operation);
    const savepoint = `curator_agent_${randomUUID().replace(/-/gu, "")}`;
    db.exec(`SAVEPOINT ${savepoint}`);
    try {
      const result = operation();
      if (result && typeof result.then === "function") throw new TypeError("Curator-agent database operations must be synchronous.");
      db.exec(`RELEASE SAVEPOINT ${savepoint}`);
      return result;
    } catch (error) {
      try { db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`); } catch { /* preserve original */ }
      try { db.exec(`RELEASE SAVEPOINT ${savepoint}`); } catch { /* preserve original */ }
      throw normalizeDatabaseError(error);
    }
  }

  function createCuratorAgentRun(input = {}, mutation = {}) {
    const request = normalizeCuratorRunRequest(input);
    const idempotencyKey = requireIdempotencyKey(mutation.idempotencyKey);
    const requestSha256 = buildCuratorRequestSha256(request);
    let id = "";
    let created = false;
    runAtomic(() => {
      const duplicate = statements.getByCreateIdempotency.get(idempotencyKey);
      if (duplicate) {
        if (duplicate.request_sha256 !== requestSha256 || duplicate.deleted_at) throw idempotencyConflict();
        id = duplicate.id;
        return;
      }
      if (Number(statements.countLive.get()?.count) >= MAX_RUNS) {
        throw curatorAgentError(`At most ${MAX_RUNS} curator-agent runs may be retained.`, "CURATOR_AGENT_RUN_LIMIT", 409);
      }
      const timestamp = requireTimestamp(now());
      id = newId("curator-run");
      statements.insertRun.run(runInsertParameters({
        id,
        idempotencyKey,
        requestSha256,
        request,
        status: "created",
        version: 1,
        createdAt: timestamp,
        updatedAt: timestamp
      }));
      assertRunArchiveable(id);
      created = true;
    });
    return { created, idempotent: !created, workspace: getCuratorAgentRunWorkspace(id) };
  }

  function executeCuratorAgentRun(runId, mutation = {}) {
    const id = requireId(runId, "runId");
    const idempotencyKey = requireIdempotencyKey(mutation.idempotencyKey);
    if (mutation.confirm !== true) throw confirmationRequired();
    const requestSha256 = mutationSha256({ confirm: true, runId: id, operation: "execute" });
    let run = requireLiveRun(id);
    if (run.execute_idempotency_key) {
      if (run.execute_idempotency_key === idempotencyKey && run.execute_request_sha256 === requestSha256) {
        return { executed: false, idempotent: true, workspace: getCuratorAgentRunWorkspace(id) };
      }
      throw idempotencyConflict();
    }
    assertExpectedVersion(run, mutation.expectedVersion);
    assertLiveMutableRun(run, "execute");
    if (run.status !== "created") {
      throw curatorAgentError("Only a newly created run can be executed; interrupted runs never resume.", "CURATOR_AGENT_RUN_NOT_EXECUTABLE", 409);
    }
    const startedAt = latestTimestamp(now(), run.updated_at, run.created_at);
    runAtomic(() => {
      const result = statements.startRun.run(idempotencyKey, requestSha256, startedAt, startedAt, id, run.version);
      if (Number(result.changes) !== 1) throw versionConflict();
    });

    let executionStartedMs = null;
    try {
      executionStartedMs = readMonotonicValue(monotonicNow());
      const execution = executeCuratorAgent({
        request: parseJson(run.request_json, {}),
        tools,
        budgets: DEFAULT_BUDGETS,
        monotonicNow,
        shouldCancel: () => {
          const current = statements.getRun.get(id);
          return !current || current.status === "cancelled" || Boolean(current.deleted_at);
        },
        onStep: (step) => {
          runAtomic(() => {
            const current = requireLiveRun(id);
            if (current.status !== "running") throw curatorAgentError("The run is no longer running.", "CURATOR_AGENT_CANCELLED", 409);
            const createdAt = latestTimestamp(now(), current.updated_at, current.created_at);
            const durationMs = boundedRunDuration(Number(current.duration_ms) + Number(step.durationMs));
            statements.insertStep.run(
              newId("curator-step"), id, step.position, step.toolName,
              JSON.stringify(step.args), JSON.stringify(step.result), step.resultSha256,
              step.resultBytes, step.durationMs, step.summary, createdAt
            );
            statements.updateRunningUsage.run(step.position + 1, step.position + 1,
              Number(current.result_bytes) + step.resultBytes, durationMs, createdAt, id);
            assertRunArchiveable(id);
          });
        }
      });
      runAtomic(() => {
        const current = requireLiveRun(id);
        if (current.status !== "running") throw curatorAgentError("The run was cancelled before completion.", "CURATOR_AGENT_CANCELLED", 409);
        const completedAt = latestTimestamp(now(), current.updated_at, current.started_at);
        insertProposal(id, execution.proposal, completedAt);
        const result = statements.completeRun.run(
          execution.usage.steps,
          execution.usage.toolCalls,
          execution.usage.resultBytes,
          execution.usage.durationMs,
          completedAt,
          completedAt,
          id,
          current.version
        );
        if (Number(result.changes) !== 1) throw versionConflict();
        assertRunArchiveable(id);
      });
      return { executed: true, idempotent: false, workspace: getCuratorAgentRunWorkspace(id) };
    } catch (error) {
      const current = statements.getRun.get(id);
      if (current && !current.deleted_at && current.status === "running") {
        const failedAt = latestTimestamp(now(), current.updated_at, current.started_at);
        const code = String(error?.code || "CURATOR_AGENT_EXECUTION_FAILED").slice(0, 80);
        const message = String(error?.message || "Curator-agent execution failed.").slice(0, 500);
        const durationMs = failedRunDuration(current, executionStartedMs, monotonicNow);
        runAtomic(() => {
          statements.failRun.run(
            failedAt,
            failedAt,
            code,
            message,
            durationMs,
            id,
            current.version
          );
          assertRunArchiveable(id);
        });
      }
      error.workspace = getCuratorAgentRunWorkspace(id);
      throw error;
    }
  }

  function cancelCuratorAgentRun(runId, mutation = {}) {
    const id = requireId(runId, "runId");
    const idempotencyKey = requireIdempotencyKey(mutation.idempotencyKey);
    if (mutation.confirm !== true) throw confirmationRequired();
    const requestSha256 = mutationSha256({ confirm: true, runId: id, operation: "cancel" });
    const run = requireLiveRun(id);
    if (run.cancel_idempotency_key) {
      if (run.cancel_idempotency_key === idempotencyKey && run.cancel_request_sha256 === requestSha256) {
        return { cancelled: false, idempotent: true, workspace: getCuratorAgentRunWorkspace(id) };
      }
      throw idempotencyConflict();
    }
    assertExpectedVersion(run, mutation.expectedVersion);
    assertLiveMutableRun(run, "cancel");
    if (!["created", "running"].includes(run.status)) {
      throw curatorAgentError("This terminal run cannot be cancelled.", "CURATOR_AGENT_RUN_NOT_CANCELLABLE", 409);
    }
    const timestamp = latestTimestamp(now(), run.updated_at, run.created_at);
    runAtomic(() => {
      const result = statements.cancelRun.run(idempotencyKey, requestSha256, timestamp, timestamp, id, run.version);
      if (Number(result.changes) !== 1) throw versionConflict();
      assertRunArchiveable(id);
    });
    return { cancelled: true, idempotent: false, workspace: getCuratorAgentRunWorkspace(id) };
  }

  function decideCuratorAgentRun(runId, input = {}, mutation = {}) {
    const id = requireId(runId, "runId");
    const idempotencyKey = requireIdempotencyKey(mutation.idempotencyKey);
    const decisionInput = normalizeDecisionInput(input, id);
    const requestSha256 = decisionRequestSha256(id, decisionInput);
    const duplicate = statements.getDecisionByIdempotency.get(idempotencyKey);
    if (duplicate) {
      if (duplicate.run_id === id && duplicate.action === decisionInput.action &&
          duplicate.decision === decisionInput.decision && duplicate.request_sha256 === requestSha256) {
        return { decided: false, idempotent: true, workspace: getCuratorAgentRunWorkspace(id) };
      }
      throw idempotencyConflict();
    }
    let run = requireLiveRun(id);
    assertExpectedVersion(run, mutation.expectedVersion);
    assertDecisionAllowed(run);
    const existing = statements.getDecisionForAction.get(id, decisionInput.action);
    if (existing) throw curatorAgentError("This action already has a final decision.", "CURATOR_AGENT_ACTION_ALREADY_DECIDED", 409);
    const proposal = getProposalRow(id);
    if (!proposal) throw curatorAgentError("The run has no proposal.", "CURATOR_AGENT_PROPOSAL_NOT_FOUND", 404);
    const publicProposal = rowToProposal(proposal);
    const action = publicProposal.actions.find((item) => item.action === decisionInput.action);
    if (!action || action.enabled !== true) throw curatorAgentError("This proposal action is unavailable.", "CURATOR_AGENT_ACTION_DISABLED", 409);
    if (decisionInput.decision === "approve") {
      const stale = findStaleSource(publicProposal.sourceRefs);
      if (stale) {
        const timestamp = latestTimestamp(now(), run.updated_at, run.created_at);
        runAtomic(() => {
          statements.markNeedsReview.run(timestamp, id);
          assertRunArchiveable(id);
        });
        const error = curatorAgentError(`Source memory changed: ${stale.memoryId}`, "CURATOR_AGENT_SOURCE_STALE", 409);
        error.memoryId = stale.memoryId;
        throw error;
      }
    }
    let outcome;
    runAtomic(() => {
      run = requireLiveRun(id);
      assertDecisionAllowed(run);
      const timestamp = latestTimestamp(now(), run.updated_at, run.created_at);
      if (statements.getDecisionForAction.get(id, decisionInput.action)) {
        throw curatorAgentError("This action already has a final decision.", "CURATOR_AGENT_ACTION_ALREADY_DECIDED", 409);
      }
      // Keep the approved side effect and its append-only decision receipt in
      // one parent transaction. Existing store callbacks reuse that parent
      // transaction, so a later receipt/CAS failure cannot leave an
      // unrecorded exhibition, relationship, or publication behind.
      outcome = decisionInput.decision === "reject"
        ? { status: "rejected" }
        : executeApprovedAction(id, decisionInput.action, publicProposal);
      statements.insertDecision.run(
        newId("curator-decision"), id, decisionInput.action, decisionInput.decision,
        idempotencyKey, requestSha256, JSON.stringify(outcome), timestamp
      );
      const result = statements.touchRun.run(timestamp, id, run.version);
      if (Number(result.changes) !== 1) throw versionConflict();
      assertRunArchiveable(id);
    });
    return { decided: true, idempotent: false, workspace: getCuratorAgentRunWorkspace(id) };
  }

  function executeApprovedAction(runId, action, proposal) {
    if (action === "save_exhibition") {
      const saved = actions.saveExhibitionDraft({
        ...cloneJson(proposal.preview),
        status: "draft",
        confirm: true
      }, { runId, proposalSha256: proposal.proposalSha256 });
      const exhibitionId = requireId(saved?.id || saved?.exhibitionId || saved, "exhibitionId");
      const status = String(saved?.status || "draft");
      if (status !== "draft") throw curatorAgentError("Save approval may only create a draft exhibition.", "CURATOR_AGENT_SAVE_NOT_DRAFT", 409);
      return { status: "approved", exhibitionId, exhibitionStatus: "draft" };
    }
    if (action === "confirm_relationship") {
      const relation = proposal.relation;
      if (!relation || relation.status !== "candidate") {
        throw curatorAgentError("There is no relationship candidate to confirm.", "CURATOR_AGENT_RELATION_NOT_FOUND", 409);
      }
      actions.confirmRelationship({
        ...cloneJson(relation),
        confirm: true,
        runId,
        proposalSha256: proposal.proposalSha256
      });
      return {
        status: "approved",
        memoryAId: relation.memoryAId,
        memoryBId: relation.memoryBId,
        relationType: relation.relationType
      };
    }
    if (action === "publish_exhibition") {
      const saved = statements.getDecisionForAction.get(runId, "save_exhibition");
      const savedOutcome = parseJson(saved?.outcome_json, {});
      if (!saved || saved.decision !== "approve" || !savedOutcome.exhibitionId) {
        throw curatorAgentError("Publishing requires an independently approved saved draft.", "CURATOR_AGENT_PUBLISH_REQUIRES_SAVE", 409);
      }
      const published = actions.publishExhibition(savedOutcome.exhibitionId, {
        confirm: true,
        runId,
        proposalSha256: proposal.proposalSha256
      });
      const exhibitionId = requireId(published?.id || published?.exhibitionId || savedOutcome.exhibitionId, "exhibitionId");
      const status = String(published?.status || "published");
      if (status !== "published") throw curatorAgentError("Publish approval did not publish the saved draft.", "CURATOR_AGENT_PUBLISH_FAILED", 409);
      return { status: "approved", exhibitionId, exhibitionStatus: "published" };
    }
    throw curatorAgentError("Unknown curator-agent action.", "CURATOR_AGENT_ACTION_INVALID");
  }

  function getCuratorAgentRunWorkspace(runId) {
    const id = requireId(runId, "runId");
    const row = statements.getRun.get(id);
    if (!row || row.deleted_at) return null;
    const run = rowToRun(row);
    const steps = statements.stepsForRun.all(id).map(rowToStep);
    const proposalRow = statements.proposalForRun.get(id);
    const decisions = statements.decisionsForRun.all(id).map(rowToDecision);
    return { run, steps, proposal: proposalRow ? rowToProposal(proposalRow) : null, decisions };
  }

  function listCuratorAgentRuns(options = {}) {
    const limit = Math.min(100, Math.max(1, Number(options.limit) || 20));
    return statements.listRuns.all(limit).map(rowToRun);
  }

  function evaluateCuratorAgentRun(runId) {
    const workspace = getCuratorAgentRunWorkspace(runId);
    if (!workspace) throw curatorAgentError("Curator-agent run was not found.", "CURATOR_AGENT_RUN_NOT_FOUND", 404);
    return evaluateCuratorAgentTrace(workspace);
  }

  function deleteCuratorAgentRun(runId, mutation = {}) {
    const id = requireId(runId, "runId");
    const idempotencyKey = requireIdempotencyKey(mutation.idempotencyKey);
    if (mutation.confirm !== true) throw confirmationRequired();
    const requestSha256 = mutationSha256({ confirm: true, runId: id, operation: "delete" });
    const row = statements.getRun.get(id);
    if (!row) throw curatorAgentError("Curator-agent run was not found.", "CURATOR_AGENT_RUN_NOT_FOUND", 404);
    if (row.deleted_at) {
      if (row.deletion_idempotency_key === idempotencyKey && row.deletion_request_sha256 === requestSha256) {
        return { deleted: false, idempotent: true };
      }
      throw curatorAgentError("Curator-agent run was not found.", "CURATOR_AGENT_RUN_NOT_FOUND", 404);
    }
    assertExpectedVersion(row, mutation.expectedVersion);
    const timestamp = latestTimestamp(now(), row.updated_at, row.created_at);
    runAtomic(() => {
      statements.deleteSteps.run(id);
      statements.deleteProposal.run(id);
      statements.deleteDecisions.run(id);
      const result = statements.tombstoneRun.run(
        sha256(`deleted\0${row.request_sha256}`),
        idempotencyKey,
        requestSha256,
        timestamp,
        timestamp,
        id,
        row.version
      );
      if (Number(result.changes) !== 1) throw versionConflict();
    });
    return { deleted: true, idempotent: false };
  }

  function clearCuratorAgentRuns() {
    const count = Number(statements.countLive.get()?.count) || 0;
    return runAtomic(() => {
      statements.clearRuns.run();
      return { runsDeleted: count };
    });
  }

  function purgeCuratorAgentRunsForMemory(memoryId) {
    const id = requireId(memoryId, "memoryId");
    const runIds = statements.runIdsForMemory.all(id).map((row) => row.id);
    return runAtomic(() => {
      for (const runId of runIds) statements.hardDeleteRun.run(runId);
      return { runsDeleted: runIds.length, runIds };
    });
  }

  function purgeCuratorAgentRunsForExhibition(exhibitionId) {
    const id = requireId(exhibitionId, "exhibitionId");
    const runIds = statements.runIdsForExhibition.all(id).map((row) => row.id);
    return runAtomic(() => {
      for (const runId of runIds) statements.hardDeleteRun.run(runId);
      return { runsDeleted: runIds.length, runIds };
    });
  }

  function getCuratorAgentStats() {
    const row = statements.stats.get();
    return {
      runs: Number(row.runs) || 0,
      completed: Number(row.completed) || 0,
      cancelled: Number(row.cancelled) || 0,
      interrupted: Number(row.interrupted) || 0,
      needsReview: Number(row.needs_review) || 0,
      historical: Number(row.historical) || 0,
      steps: Number(row.steps) || 0,
      proposals: Number(row.proposals) || 0,
      decisions: Number(row.decisions) || 0,
      approved: Number(row.approved) || 0,
      rejected: Number(row.rejected) || 0
    };
  }

  function buildCuratorAgentBackup(mode = "full") {
    if (mode === "redacted") {
      const stats = getCuratorAgentStats();
      return {
        mode: "redacted-summary",
        runCount: stats.runs,
        completedRunCount: stats.completed,
        cancelledRunCount: stats.cancelled,
        proposalCount: stats.proposals,
        decisionCount: stats.decisions,
        approvedCount: stats.approved,
        rejectedCount: stats.rejected,
        note: CURATOR_AGENT_REDACTED_NOTE
      };
    }
    if (mode !== "full") throw curatorAgentError("Unsupported curator-agent backup mode.", "CURATOR_AGENT_BACKUP_INVALID");
    const liveCount = Number(statements.countLive.get()?.count) || 0;
    if (liveCount > MAX_RUNS) {
      throw curatorAgentError(`At most ${MAX_RUNS} curator-agent runs may be retained.`, "CURATOR_AGENT_RUN_LIMIT", 409);
    }
    const runs = statements.listRuns.all(MAX_RUNS).map(rowToRun);
    if (runs.length !== liveCount) {
      throw curatorAgentError("Curator-agent backup could not enumerate every retained run.", "CURATOR_AGENT_BACKUP_INCOMPLETE", 500);
    }
    const state = {
      mode: "full",
      schemaVersion: CURATOR_AGENT_SCHEMA_VERSION,
      runs: runs.map((run) => toArchiveWorkspace(getCuratorAgentRunWorkspace(run.id)))
    };
    validateCuratorAgentArchiveEnvelope(state, "full");
    return state;
  }

  function validateCuratorAgentBackup(backup) {
    validateCuratorAgentArchiveEnvelope(backup, backup?.mode === "redacted-summary" ? "redacted" : "full");
    return true;
  }

  function restoreCuratorAgentBackup(backup, restoreOptions = {}) {
    validateCuratorAgentBackup(backup);
    if (backup.mode === "redacted-summary") return { restoredRuns: 0, runIdMap: {}, idMap: { runs: {}, steps: {}, proposals: {}, decisions: {} } };
    // Every import is a fresh historical copy, including an import of an
    // already-historical archive. This prevents a second restore from
    // colliding with prior IDs or replay domains.
    const remapped = remapCuratorAgentState(backup, {
      memoryIdMap: restoreOptions.memoryIdMap || collectIdentityMemoryIdMap(backup),
      eventIdMap: restoreOptions.eventIdMap || new Map(),
      exhibitionIdMap: restoreOptions.exhibitionIdMap || collectIdentityExhibitionIdMap(backup),
      createId: restoreOptions.createId || ((prefix) => newId(`${prefix}-history`))
    });
    const state = remapped.state;
    const idMap = remapped.idMap;
    validateCuratorAgentArchiveEnvelope(state, "full");
    const runIdMap = { ...(idMap.runs || {}) };
    runAtomic(() => {
      if (Number(statements.countLive.get()?.count) + state.runs.length > MAX_RUNS) {
        throw curatorAgentError(`Restore would exceed ${MAX_RUNS} curator-agent runs.`, "CURATOR_AGENT_RUN_LIMIT", 409);
      }
      for (let entryIndex = 0; entryIndex < state.runs.length; entryIndex += 1) {
        const sourceEntry = backup.runs[entryIndex];
        const entry = cloneJson(state.runs[entryIndex]);
        validateBackupEntry(entry);
        const newRunId = entry.run.id;
        const timestamp = requireTimestamp(now());
        const restoredUpdatedAt = latestTimestamp(timestamp, entry.run.updatedAt, entry.run.createdAt);
        if (!Object.values(runIdMap).includes(newRunId)) runIdMap[newRunId] = newRunId;
        const status = entry.run.status;
        statements.insertRun.run(runInsertParameters({
          id: newRunId,
          idempotencyKey: entry.run.idempotencyKey,
          requestSha256: entry.run.requestSha256,
          request: entry.run.request,
          status,
          version: Math.max(1, Number(entry.run.version) || 1),
          historical: true,
          needsReview: true,
          allowDecisions: false,
          usage: entry.run.usage,
          createdAt: entry.run.createdAt || timestamp,
          startedAt: entry.run.startedAt,
          updatedAt: restoredUpdatedAt,
          completedAt: entry.run.completedAt,
          cancelledAt: entry.run.cancelledAt,
          interruptedAt: entry.run.interruptedAt,
          failedAt: entry.run.failedAt,
          failureCode: entry.run.failureCode,
          failureMessage: entry.run.failureMessage
        }));
        entry.steps.forEach((step, index) => statements.insertStep.run(
          step.id, newRunId, index, step.toolName,
          JSON.stringify(step.args), JSON.stringify(step.result), step.resultSha256,
          step.resultBytes, step.durationMs, String(step.summary || "").slice(0, 240), step.createdAt || timestamp
        ));
        if (entry.proposal) insertRestoredProposal(newRunId, entry.proposal, timestamp, true);
        entry.decisions.forEach((decision, decisionIndex) => {
          const sourceDecision = sourceEntry.decisions[decisionIndex];
          const sourceDecisionKey = curatorAgentDecisionMapKey(sourceEntry.run.id, decisionIndex, sourceDecision);
          const decisionId = idMap.decisions[sourceDecisionKey];
          if (!decisionId) throw new TypeError("Curator-agent decision remap ID is missing.");
          statements.insertDecision.run(
            decisionId, newRunId, decision.action, decision.decision,
            decision.idempotencyKey, decision.requestSha256,
            JSON.stringify(decision.outcome), decision.createdAt || timestamp
          );
        });
      }
    });
    return { restoredRuns: state.runs.length, runIdMap, idMap };
  }

  function insertProposal(runId, proposal, timestamp) {
    statements.insertProposal.run(
      newId("curator-proposal"), runId, proposal.engineVersion, proposal.kind,
      proposal.requestSha256, proposal.proposalSha256, proposal.sourceSetSha256,
      JSON.stringify(proposal.sourceRefs), JSON.stringify(proposal.preview),
      JSON.stringify(proposal.relation), JSON.stringify(proposal.actions),
      JSON.stringify(proposal.duplicateContext), timestamp
    );
  }

  function insertRestoredProposal(runId, proposal, timestamp, preserveId = false) {
    statements.insertProposal.run(
      preserveId ? proposal.id : newId("curator-proposal-history"), runId, proposal.engineVersion, proposal.kind,
      proposal.requestSha256, proposal.proposalSha256, proposal.sourceSetSha256,
      JSON.stringify(proposal.sourceRefs), JSON.stringify(proposal.preview),
      JSON.stringify(proposal.relation), JSON.stringify(proposal.actions),
      JSON.stringify(proposal.duplicateContext || []), proposal.createdAt || timestamp
    );
  }

  function findStaleSource(sourceRefs) {
    if (typeof actions.getMemory !== "function") {
      throw new TypeError("Curator-agent decisions require getMemory for source freshness checks.");
    }
    for (const reference of sourceRefs) {
      const memory = actions.getMemory(reference.memoryId);
      if (!memory) return reference;
      const updatedAt = String(memory.updatedAt || memory.updated_at || memory.createdAt || memory.created_at || "");
      const rawContent = String(memory.rawContent ?? memory.raw_content ?? "");
      const rawHash = memory.rawSha256 || sha256(rawContent);
      if (updatedAt !== reference.updatedAt || rawHash !== reference.rawSha256) return reference;
    }
    return null;
  }

  function getProposalRow(runId) {
    return statements.proposalForRun.get(runId);
  }

  function assertRunArchiveable(runId) {
    const workspace = getCuratorAgentRunWorkspace(runId);
    if (!workspace) throw curatorAgentError("Curator-agent run was not found.", "CURATOR_AGENT_RUN_NOT_FOUND", 404);
    validateCuratorAgentArchiveEnvelope({
      mode: "full",
      schemaVersion: CURATOR_AGENT_SCHEMA_VERSION,
      runs: [toArchiveWorkspace(workspace)]
    }, "full");
    return true;
  }

  function requireLiveRun(runId) {
    const row = statements.getRun.get(runId);
    if (!row || row.deleted_at) throw curatorAgentError("Curator-agent run was not found.", "CURATOR_AGENT_RUN_NOT_FOUND", 404);
    return row;
  }

  function newId(prefix) {
    return requireId(createId(prefix), `${prefix} id`);
  }

  return Object.freeze({
    createCuratorAgentRun,
    executeCuratorAgentRun,
    cancelCuratorAgentRun,
    decideCuratorAgentRun,
    getCuratorAgentRunWorkspace,
    listCuratorAgentRuns,
    evaluateCuratorAgentRun,
    deleteCuratorAgentRun,
    clearCuratorAgentRuns,
    purgeCuratorAgentRunsForMemory,
    purgeCuratorAgentRunsForExhibition,
    getCuratorAgentStats,
    buildCuratorAgentBackup,
    validateCuratorAgentBackup,
    restoreCuratorAgentBackup
  });
}

function prepareStatements(db) {
  return {
    interruptRunning: db.prepare(`
      UPDATE curator_agent_runs SET status = 'interrupted',
        interrupted_at = CASE WHEN julianday(updated_at) > julianday(?1) THEN updated_at ELSE ?1 END,
        updated_at = CASE WHEN julianday(updated_at) > julianday(?1) THEN updated_at ELSE ?1 END,
        allow_decisions = 0, version = version + 1
      WHERE status = 'running' AND deleted_at = ''
    `),
    insertRun: db.prepare(`
      INSERT INTO curator_agent_runs (
        id, schema_version, idempotency_key, request_sha256, request_json, status, version,
        max_steps, max_tool_calls, max_duration_ms, max_result_bytes, max_memories,
        step_count, tool_call_count, result_bytes, duration_ms,
        execute_idempotency_key, execute_request_sha256, cancel_idempotency_key, cancel_request_sha256,
        historical, needs_review, allow_decisions, created_at, started_at, updated_at,
        completed_at, cancelled_at, interrupted_at, failed_at, failure_code, failure_message,
        deleted_at, deletion_idempotency_key, deletion_request_sha256
      ) VALUES (
        @id, 14, @idempotencyKey, @requestSha256, @requestJson, @status, @version,
        6, 4, 2000, 262144, 6,
        @stepCount, @toolCallCount, @resultBytes, @durationMs,
        '', '', '', '',
        @historical, @needsReview, @allowDecisions, @createdAt, @startedAt, @updatedAt,
        @completedAt, @cancelledAt, @interruptedAt, @failedAt, @failureCode, @failureMessage,
        '', '', ''
      )
    `),
    getRun: db.prepare("SELECT * FROM curator_agent_runs WHERE id = ?"),
    getByCreateIdempotency: db.prepare("SELECT * FROM curator_agent_runs WHERE idempotency_key = ?"),
    countLive: db.prepare("SELECT COUNT(*) AS count FROM curator_agent_runs WHERE deleted_at = ''"),
    listRuns: db.prepare(`
      SELECT * FROM curator_agent_runs WHERE deleted_at = ''
      ORDER BY datetime(updated_at) DESC, datetime(created_at) DESC, id LIMIT ?
    `),
    startRun: db.prepare(`
      UPDATE curator_agent_runs SET status = 'running', execute_idempotency_key = ?,
        execute_request_sha256 = ?, started_at = ?, updated_at = ?, version = version + 1,
        failure_code = '', failure_message = ''
      WHERE id = ? AND version = ? AND status = 'created' AND deleted_at = ''
    `),
    updateRunningUsage: db.prepare(`
      UPDATE curator_agent_runs SET step_count = ?, tool_call_count = ?, result_bytes = ?,
        duration_ms = ?, updated_at = ?
      WHERE id = ? AND status = 'running' AND deleted_at = ''
    `),
    completeRun: db.prepare(`
      UPDATE curator_agent_runs SET status = 'completed', step_count = ?, tool_call_count = ?,
        result_bytes = ?, duration_ms = ?, completed_at = ?, updated_at = ?, version = version + 1
        , allow_decisions = 1
      WHERE id = ? AND version = ? AND status = 'running' AND deleted_at = ''
    `),
    failRun: db.prepare(`
      UPDATE curator_agent_runs SET status = 'failed', failed_at = ?, updated_at = ?,
        failure_code = ?, failure_message = ?, duration_ms = ?, version = version + 1
        , allow_decisions = 0
      WHERE id = ? AND version = ? AND status = 'running' AND deleted_at = ''
    `),
    cancelRun: db.prepare(`
      UPDATE curator_agent_runs SET status = 'cancelled', cancel_idempotency_key = ?,
        cancel_request_sha256 = ?, cancelled_at = ?, updated_at = ?, version = version + 1
        , allow_decisions = 0
      WHERE id = ? AND version = ? AND status IN ('created', 'running') AND deleted_at = ''
    `),
    touchRun: db.prepare(`
      UPDATE curator_agent_runs SET updated_at = ?, version = version + 1
      WHERE id = ? AND version = ? AND deleted_at = ''
    `),
    markNeedsReview: db.prepare(`
      UPDATE curator_agent_runs SET needs_review = 1, allow_decisions = 0,
        version = version + 1, updated_at = ?
      WHERE id = ? AND deleted_at = ''
    `),
    insertStep: db.prepare(`
      INSERT INTO curator_agent_steps (
        id, run_id, position, tool_name, args_json, result_json, result_sha256,
        result_bytes, duration_ms, summary, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    stepsForRun: db.prepare("SELECT * FROM curator_agent_steps WHERE run_id = ? ORDER BY position, id"),
    insertProposal: db.prepare(`
      INSERT INTO curator_agent_proposals (
        id, run_id, schema_version, engine_version, kind, request_sha256, proposal_sha256,
        source_set_sha256, source_refs_json, preview_json, relation_json, actions_json,
        duplicate_context_json, created_at
      ) VALUES (?, ?, 14, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    proposalForRun: db.prepare("SELECT * FROM curator_agent_proposals WHERE run_id = ?"),
    insertDecision: db.prepare(`
      INSERT INTO curator_agent_decisions (
        id, run_id, action, decision, idempotency_key, request_sha256, outcome_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    getDecisionByIdempotency: db.prepare("SELECT * FROM curator_agent_decisions WHERE idempotency_key = ?"),
    getDecisionForAction: db.prepare("SELECT * FROM curator_agent_decisions WHERE run_id = ? AND action = ?"),
    decisionsForRun: db.prepare(`
      SELECT * FROM curator_agent_decisions WHERE run_id = ?
      ORDER BY julianday(created_at),
        CASE action
          WHEN 'save_exhibition' THEN 0
          WHEN 'confirm_relationship' THEN 1
          WHEN 'publish_exhibition' THEN 2
          ELSE 3
        END,
        id
    `),
    deleteSteps: db.prepare("DELETE FROM curator_agent_steps WHERE run_id = ?"),
    deleteProposal: db.prepare("DELETE FROM curator_agent_proposals WHERE run_id = ?"),
    deleteDecisions: db.prepare("DELETE FROM curator_agent_decisions WHERE run_id = ?"),
    tombstoneRun: db.prepare(`
      UPDATE curator_agent_runs SET request_sha256 = ?, request_json = '{}', status = 'cancelled',
        step_count = 0, tool_call_count = 0, result_bytes = 0, duration_ms = 0,
        execute_idempotency_key = '', execute_request_sha256 = '',
        cancel_idempotency_key = '', cancel_request_sha256 = '',
        failure_code = '', failure_message = '', allow_decisions = 0, deletion_idempotency_key = ?,
        deletion_request_sha256 = ?, deleted_at = ?, updated_at = ?, version = version + 1
      WHERE id = ? AND version = ? AND deleted_at = ''
    `),
    clearRuns: db.prepare("DELETE FROM curator_agent_runs"),
    hardDeleteRun: db.prepare("DELETE FROM curator_agent_runs WHERE id = ?"),
    runIdsForMemory: db.prepare(`
      WITH target(target_id) AS (SELECT ?)
      SELECT DISTINCT run.id
      FROM curator_agent_runs run
      CROSS JOIN target
      LEFT JOIN curator_agent_proposals proposal ON proposal.run_id = run.id
      WHERE run.deleted_at = '' AND (
        EXISTS (
          SELECT 1 FROM json_each(run.request_json, '$.memoryIds') requested
          WHERE requested.value = target.target_id
        ) OR EXISTS (
          SELECT 1 FROM json_each(proposal.source_refs_json) source
          WHERE json_extract(source.value, '$.memoryId') = target.target_id
        ) OR EXISTS (
          SELECT 1 FROM curator_agent_steps step, json_each(step.args_json, '$.memoryIds') reference
          WHERE step.run_id = run.id AND reference.value = target.target_id
        ) OR EXISTS (
          SELECT 1 FROM curator_agent_steps step, json_each(step.result_json, '$.memories') memory
          WHERE step.run_id = run.id AND json_extract(memory.value, '$.id') = target.target_id
        ) OR EXISTS (
          SELECT 1 FROM curator_agent_steps step, json_each(step.result_json, '$.relationships') relation
          WHERE step.run_id = run.id AND (
            json_extract(relation.value, '$.memoryAId') = target.target_id OR
            json_extract(relation.value, '$.memoryBId') = target.target_id
          )
        ) OR EXISTS (
          SELECT 1
          FROM curator_agent_steps step,
            json_each(step.result_json, '$.exhibitions') exhibition,
            json_each(exhibition.value, '$.memoryIds') member
          WHERE step.run_id = run.id AND member.value = target.target_id
        )
      )
      ORDER BY run.id
    `),
    runIdsForExhibition: db.prepare(`
      WITH target(target_id) AS (SELECT ?)
      SELECT DISTINCT run.id
      FROM curator_agent_runs run
      CROSS JOIN target
      LEFT JOIN curator_agent_proposals proposal ON proposal.run_id = run.id
      WHERE run.deleted_at = '' AND (
        EXISTS (
          SELECT 1 FROM json_each(proposal.duplicate_context_json) duplicate
          WHERE json_extract(duplicate.value, '$.id') = target.target_id
        ) OR EXISTS (
          SELECT 1 FROM curator_agent_steps step, json_each(step.result_json, '$.exhibitions') exhibition
          WHERE step.run_id = run.id AND json_extract(exhibition.value, '$.id') = target.target_id
        ) OR EXISTS (
          SELECT 1 FROM curator_agent_decisions decision
          WHERE decision.run_id = run.id AND json_extract(decision.outcome_json, '$.exhibitionId') = target.target_id
        )
      )
      ORDER BY run.id
    `),
    stats: db.prepare(`
      SELECT
        COUNT(*) AS runs,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
        SUM(CASE WHEN status = 'interrupted' THEN 1 ELSE 0 END) AS interrupted,
        SUM(needs_review) AS needs_review,
        SUM(historical) AS historical,
        (SELECT COUNT(*) FROM curator_agent_steps step JOIN curator_agent_runs run ON run.id = step.run_id WHERE run.deleted_at = '') AS steps,
        (SELECT COUNT(*) FROM curator_agent_proposals proposal JOIN curator_agent_runs run ON run.id = proposal.run_id WHERE run.deleted_at = '') AS proposals,
        (SELECT COUNT(*) FROM curator_agent_decisions decision JOIN curator_agent_runs run ON run.id = decision.run_id WHERE run.deleted_at = '') AS decisions,
        (SELECT COUNT(*) FROM curator_agent_decisions decision JOIN curator_agent_runs run ON run.id = decision.run_id WHERE run.deleted_at = '' AND decision.decision = 'approve') AS approved,
        (SELECT COUNT(*) FROM curator_agent_decisions decision JOIN curator_agent_runs run ON run.id = decision.run_id WHERE run.deleted_at = '' AND decision.decision = 'reject') AS rejected
      FROM curator_agent_runs WHERE deleted_at = ''
    `)
  };
}

function buildReadOnlyTools(options, store) {
  const supplied = isPlainObject(options.tools) ? options.tools : {};
  const callbacks = {
    search_memory_summaries: supplied.search_memory_summaries || options.searchMemorySummaries,
    read_memory_evidence: supplied.read_memory_evidence || options.readMemoryEvidence,
    read_confirmed_relationships: supplied.read_confirmed_relationships || options.readConfirmedRelationships,
    read_exhibition_summaries: supplied.read_exhibition_summaries || options.readExhibitionSummaries
  };
  callbacks.search_memory_summaries ||= (args) => {
    const selected = args.memoryIds.length
      ? args.memoryIds.map((id) => store?.getMemory?.(id)).filter(Boolean)
      : store?.searchMemories?.(args.query, { limit: args.limit }) || [];
    return { memories: selected.slice(0, args.limit) };
  };
  callbacks.read_memory_evidence ||= (args) => ({
    memories: args.memoryIds.map((id) => store?.getMemory?.(id)).filter(Boolean)
  });
  callbacks.read_confirmed_relationships ||= (args) => {
    const relationships = [];
    for (let left = 0; left < args.memoryIds.length; left += 1) {
      for (let right = left + 1; right < args.memoryIds.length; right += 1) {
        const relation = store?.getPairDecision?.(args.memoryIds[left], args.memoryIds[right]);
        if (relation && ["confirmed", "same_event", "related"].includes(String(relation.decision || relation.status || ""))) relationships.push(relation);
      }
    }
    return { relationships };
  };
  callbacks.read_exhibition_summaries ||= (args) => ({
    exhibitions: (store?.listExhibitions?.() || []).filter((summary) => {
      const exhibition = store?.getExhibition?.(summary.id);
      const memoryIds = exhibition?.sections?.flatMap((section) => section.items?.map((item) => item.memoryId) || []) || [];
      summary.memoryIds = memoryIds;
      return memoryIds.some((id) => args.memoryIds.includes(id));
    })
  });
  const missing = READ_ONLY_TOOL_NAMES.filter((name) => typeof callbacks[name] !== "function");
  if (missing.length) throw new TypeError(`Missing curator-agent tool: ${missing[0]}`);
  return Object.freeze(callbacks);
}

function buildActionCallbacks(options, store) {
  const saveExhibitionDraft = options.saveExhibitionDraft || ((preview) => store?.createExhibition?.(preview));
  const confirmRelationship = options.confirmRelationship || ((relation) => store?.savePairDecision?.(
    relation.memoryAId,
    relation.memoryBId,
    {
      decision: "confirmed",
      rationale: relation.rationale,
      evidence: [relation.basis],
      metadata: { source: "curator-agent", runId: relation.runId, proposalSha256: relation.proposalSha256 }
    }
  ));
  const publishExhibition = options.publishExhibition || ((exhibitionId) => store?.updateExhibition?.(exhibitionId, { status: "published", confirm: true }));
  const getMemory = options.getMemory || store?.getMemory?.bind(store);
  if (typeof saveExhibitionDraft !== "function" || typeof confirmRelationship !== "function" || typeof publishExhibition !== "function") {
    throw new TypeError("Curator-agent action callbacks are required.");
  }
  return Object.freeze({ saveExhibitionDraft, confirmRelationship, publishExhibition, getMemory });
}

function runInsertParameters(input) {
  const usage = isPlainObject(input.usage) ? input.usage : {};
  return {
    id: input.id,
    idempotencyKey: input.idempotencyKey,
    requestSha256: input.requestSha256,
    requestJson: JSON.stringify(input.request || {}),
    status: input.status,
    version: input.version,
    stepCount: Number(usage.steps) || 0,
    toolCallCount: Number(usage.toolCalls) || 0,
    resultBytes: Number(usage.resultBytes) || 0,
    durationMs: Number(usage.durationMs) || 0,
    historical: input.historical ? 1 : 0,
    needsReview: input.needsReview ? 1 : 0,
    allowDecisions: input.allowDecisions === undefined
      ? (input.status === "completed" && !input.historical ? 1 : 0)
      : (input.allowDecisions ? 1 : 0),
    createdAt: String(input.createdAt || ""),
    startedAt: String(input.startedAt || ""),
    updatedAt: String(input.updatedAt || input.createdAt || ""),
    completedAt: String(input.completedAt || ""),
    cancelledAt: String(input.cancelledAt || ""),
    interruptedAt: String(input.interruptedAt || ""),
    failedAt: String(input.failedAt || ""),
    failureCode: String(input.failureCode || "").slice(0, 80),
    failureMessage: String(input.failureMessage || "").slice(0, 500)
  };
}

function rowToRun(row) {
  return {
    id: row.id,
    schemaVersion: Number(row.schema_version),
    idempotencyKey: row.idempotency_key,
    requestSha256: row.request_sha256,
    request: parseJson(row.request_json, {}),
    status: row.status,
    version: Number(row.version),
    budgets: {
      maxSteps: Number(row.max_steps),
      maxToolCalls: Number(row.max_tool_calls),
      maxDurationMs: Number(row.max_duration_ms),
      maxResultBytes: Number(row.max_result_bytes),
      maxMemories: Number(row.max_memories)
    },
    usage: {
      steps: Number(row.step_count),
      toolCalls: Number(row.tool_call_count),
      resultBytes: Number(row.result_bytes),
      durationMs: Number(row.duration_ms)
    },
    historical: Boolean(row.historical),
    needsReview: Boolean(row.needs_review),
    allowDecisions: Boolean(row.allow_decisions),
    createdAt: row.created_at,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    cancelledAt: row.cancelled_at,
    interruptedAt: row.interrupted_at,
    failedAt: row.failed_at,
    failureCode: row.failure_code,
    failureMessage: row.failure_message
  };
}

function rowToStep(row) {
  return {
    id: row.id,
    runId: row.run_id,
    position: Number(row.position),
    toolName: row.tool_name,
    args: parseJson(row.args_json, {}),
    result: parseJson(row.result_json, {}),
    resultSha256: row.result_sha256,
    resultBytes: Number(row.result_bytes),
    durationMs: Number(row.duration_ms),
    summary: row.summary,
    createdAt: row.created_at
  };
}

function rowToProposal(row) {
  return {
    id: row.id,
    runId: row.run_id,
    schemaVersion: Number(row.schema_version),
    engineVersion: row.engine_version,
    kind: row.kind,
    requestSha256: row.request_sha256,
    proposalSha256: row.proposal_sha256,
    sourceSetSha256: row.source_set_sha256,
    sourceRefs: parseJson(row.source_refs_json, []),
    preview: parseJson(row.preview_json, {}),
    relation: parseJson(row.relation_json, null),
    actions: parseJson(row.actions_json, []),
    duplicateContext: parseJson(row.duplicate_context_json, []),
    createdAt: row.created_at
  };
}

function rowToDecision(row) {
  return {
    id: row.id,
    runId: row.run_id,
    action: row.action,
    decision: row.decision,
    idempotencyKey: row.idempotency_key,
    requestSha256: row.request_sha256,
    outcome: parseJson(row.outcome_json, {}),
    createdAt: row.created_at
  };
}

function toArchiveWorkspace(workspace) {
  return {
    run: cloneJson(workspace.run),
    steps: cloneJson(workspace.steps),
    proposal: workspace.proposal ? cloneJson(workspace.proposal) : null,
    decisions: workspace.decisions.map(({ id: _databaseRowId, ...decision }) => cloneJson(decision))
  };
}

function collectIdentityMemoryIdMap(state) {
  const ids = new Set();
  const visit = (value, key = "") => {
    if (Array.isArray(value)) {
      if (key === "memoryIds") value.forEach((id) => ids.add(String(id)));
      else value.forEach((item) => visit(item));
      return;
    }
    if (!isPlainObject(value)) {
      if (["memoryId", "memoryAId", "memoryBId"].includes(key) && value) ids.add(String(value));
      return;
    }
    Object.entries(value).forEach(([childKey, item]) => visit(item, childKey));
  };
  visit(state);
  return new Map([...ids].filter((id) => ID_PATTERN.test(id)).map((id) => [id, id]));
}

function collectIdentityExhibitionIdMap(state) {
  const ids = new Set();
  for (const entry of state.runs || []) {
    for (const item of entry.proposal?.duplicateContext || []) if (item.id) ids.add(String(item.id));
    for (const step of entry.steps || []) {
      if (step.toolName === "read_exhibition_summaries") {
        for (const item of step.result?.exhibitions || []) if (item.id) ids.add(String(item.id));
      }
    }
    for (const decision of entry.decisions || []) if (decision.outcome?.exhibitionId) ids.add(String(decision.outcome.exhibitionId));
  }
  return new Map([...ids].filter((id) => ID_PATTERN.test(id)).map((id) => [id, id]));
}

function normalizeDecisionInput(input, runId) {
  if (!isPlainObject(input)) throw curatorAgentError("Decision request must be an object.", "CURATOR_AGENT_DECISION_INVALID");
  const keys = Object.keys(input).sort();
  const expected = ["action", "confirm", "decision"].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw curatorAgentError("Decision fields are invalid.", "CURATOR_AGENT_FIELD_SET_INVALID");
  }
  if (input.confirm !== true) throw confirmationRequired();
  const action = String(input.action || "");
  const decision = String(input.decision || "");
  if (!ACTION_SET.has(action)) throw curatorAgentError("Decision action is invalid.", "CURATOR_AGENT_ACTION_INVALID");
  if (!DECISION_SET.has(decision)) throw curatorAgentError("Decision must be approve or reject.", "CURATOR_AGENT_DECISION_INVALID");
  return { action, decision, confirm: true, runId };
}

function decisionRequestSha256(runId, input) {
  return sha256(stableStringify({
    action: input.action,
    confirm: true,
    decision: input.decision,
    runId
  }));
}

function validateBackupEntry(entry) {
  if (!isPlainObject(entry) || !isPlainObject(entry.run) || !Array.isArray(entry.steps) ||
      !Array.isArray(entry.decisions) || !(entry.proposal === null || isPlainObject(entry.proposal))) {
    throw curatorAgentError("Curator-agent backup run entry is invalid.", "CURATOR_AGENT_BACKUP_INVALID");
  }
  requireId(entry.run.id, "run.id");
  requireIdempotencyKey(entry.run.idempotencyKey);
  if (!RUN_STATUS_SET.has(entry.run.status) || entry.steps.length > DEFAULT_BUDGETS.maxSteps || entry.decisions.length > CURATOR_ACTIONS.length) {
    throw curatorAgentError("Curator-agent backup state is invalid.", "CURATOR_AGENT_BACKUP_INVALID");
  }
  entry.steps.forEach((step, index) => {
    if (!isPlainObject(step) || step.position !== index || !READ_ONLY_TOOL_NAMES.includes(step.toolName)) {
      throw curatorAgentError("Curator-agent backup step is invalid.", "CURATOR_AGENT_BACKUP_INVALID");
    }
  });
  entry.decisions.forEach((decision) => {
    if (!isPlainObject(decision) || !ACTION_SET.has(decision.action) || !DECISION_SET.has(decision.decision)) {
      throw curatorAgentError("Curator-agent backup decision is invalid.", "CURATOR_AGENT_BACKUP_INVALID");
    }
  });
  return true;
}

function assertExpectedVersion(run, expectedVersion) {
  const expected = Number(expectedVersion);
  if (!Number.isSafeInteger(expected) || expected < 1) {
    throw curatorAgentError("If-Match is required for this mutation.", "CURATOR_AGENT_PRECONDITION_REQUIRED", 428);
  }
  if (Number(run.version) !== expected) throw versionConflict();
}

function assertLiveMutableRun(run, operation) {
  if (run.historical) {
    throw curatorAgentError(`Historical runs cannot ${operation}.`, "CURATOR_AGENT_HISTORICAL_READ_ONLY", 409);
  }
  if (!run.allow_decisions && operation === "make decisions") {
    throw curatorAgentError("Decisions are disabled for this run.", "CURATOR_AGENT_DECISIONS_DISABLED", 409);
  }
}

function assertDecisionAllowed(run) {
  assertLiveMutableRun(run, "make decisions");
  if (run.status !== "completed") {
    throw curatorAgentError("Decisions require a completed proposal.", "CURATOR_AGENT_RUN_NOT_COMPLETED", 409);
  }
}

function mutationSha256(value) {
  return sha256(stableStringify(value));
}

function requireIdempotencyKey(value) {
  const key = String(value || "").normalize("NFKC").trim();
  if (!/^[A-Za-z0-9_-]{8,120}$/u.test(key)) {
    throw curatorAgentError("Idempotency-Key must contain 8 to 120 letters, digits, underscores, or hyphens.", "CURATOR_AGENT_IDEMPOTENCY_KEY_INVALID", 400);
  }
  return key;
}

function requireId(value, name) {
  const id = String(value || "").trim();
  if (!ID_PATTERN.test(id)) throw curatorAgentError(`${name} is invalid.`, "CURATOR_AGENT_ID_INVALID");
  return id;
}

function requireTimestamp(value) {
  const timestamp = String(value || "").trim();
  const parsed = new Date(timestamp);
  if (!timestamp || Number.isNaN(parsed.getTime())) throw new TypeError("Curator-agent timestamp is invalid.");
  return parsed.toISOString();
}

function latestTimestamp(...values) {
  let latest = "";
  let latestMs = -Infinity;
  for (const value of values) {
    if (value === undefined || value === null || value === "") continue;
    const timestamp = requireTimestamp(value);
    const milliseconds = Date.parse(timestamp);
    if (milliseconds > latestMs || (milliseconds === latestMs && timestamp > latest)) {
      latest = timestamp;
      latestMs = milliseconds;
    }
  }
  if (!latest) throw new TypeError("Curator-agent timestamp is invalid.");
  return latest;
}

function readMonotonicValue(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError("Curator-agent monotonic clock is invalid.");
  return number;
}

function boundedRunDuration(value) {
  const duration = Math.floor(Number(value));
  if (!Number.isSafeInteger(duration) || duration < 0 || duration > DEFAULT_BUDGETS.maxDurationMs) {
    throw curatorAgentError("The run exceeded its duration budget.", "CURATOR_AGENT_DURATION_BUDGET_EXCEEDED", 409);
  }
  return duration;
}

function failedRunDuration(run, startedAtMs, monotonicNow) {
  let elapsed = 0;
  try {
    if (Number.isFinite(startedAtMs)) elapsed = Math.max(0, readMonotonicValue(monotonicNow()) - startedAtMs);
  } catch {
    elapsed = 0;
  }
  const persisted = Number.isSafeInteger(Number(run?.duration_ms)) ? Number(run.duration_ms) : 0;
  return Math.min(DEFAULT_BUDGETS.maxDurationMs, Math.max(0, persisted, Math.floor(elapsed)));
}

function confirmationRequired() {
  return curatorAgentError("This operation requires confirm: true.", "CURATOR_AGENT_CONFIRMATION_REQUIRED", 400);
}

function idempotencyConflict() {
  return curatorAgentError("Idempotency-Key was already used for a different request.", "CURATOR_AGENT_IDEMPOTENCY_CONFLICT", 409);
}

function versionConflict() {
  return curatorAgentError("The curator-agent run changed; refresh before continuing.", "CURATOR_AGENT_VERSION_CONFLICT", 412);
}

function requireDatabase(db) {
  if (!db || typeof db.exec !== "function" || typeof db.prepare !== "function") {
    throw new TypeError("initializeCuratorAgentDatabase requires a synchronous SQLite database.");
  }
  return db;
}

function normalizeDatabaseError(error) {
  const message = String(error?.message || "");
  if (message.includes("UNIQUE constraint failed: curator_agent_runs.idempotency_key") ||
      message.includes("UNIQUE constraint failed: curator_agent_decisions.idempotency_key")) return idempotencyConflict();
  if (message.includes("UNIQUE constraint failed: curator_agent_decisions.run_id, curator_agent_decisions.action")) {
    return curatorAgentError("This action already has a final decision.", "CURATOR_AGENT_ACTION_ALREADY_DECIDED", 409);
  }
  return error;
}

function parseJson(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

module.exports = {
  CURATOR_AGENT_MIGRATION,
  MAX_CURATOR_AGENT_RUNS: MAX_RUNS,
  decisionRequestSha256,
  initializeCuratorAgentDatabase,
  rowToDecision,
  rowToProposal,
  rowToRun,
  rowToStep
};
