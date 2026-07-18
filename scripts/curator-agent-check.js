"use strict";

const { DatabaseSync } = require("node:sqlite");
const {
  DEFAULT_BUDGETS,
  READ_ONLY_TOOL_NAMES,
  buildCuratorRequestSha256,
  evaluateCuratorAgentTrace,
  executeCuratorAgent,
  normalizeCuratorRunRequest,
  sha256,
  stableStringify
} = require("../lib/curator-agent-service");
const {
  CURATOR_AGENT_MIGRATION,
  MAX_CURATOR_AGENT_RUNS,
  decisionRequestSha256,
  initializeCuratorAgentDatabase
} = require("../lib/curator-agent-database");
const {
  createCuratorAgentApi,
  createCuratorAgentSample
} = require("../lib/curator-agent-api");

let assertions = 0;

function ok(value, message) {
  assertions += 1;
  if (!value) throw new Error(message);
}

function equal(actual, expected, message) {
  assertions += 1;
  if (actual !== expected) throw new Error(`${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
}

function deepEqual(actual, expected, message) {
  assertions += 1;
  if (stableStringify(actual) !== stableStringify(expected)) {
    throw new Error(`${message}: expected ${stableStringify(expected)}, received ${stableStringify(actual)}`);
  }
}

function throwsCode(operation, code, message) {
  assertions += 1;
  try {
    operation();
  } catch (error) {
    if (error?.code === code) return error;
    throw new Error(`${message}: expected ${code}, received ${error?.code || error?.message}`);
  }
  throw new Error(`${message}: expected ${code}, but nothing was thrown`);
}

async function rejectsCode(operation, code, message) {
  assertions += 1;
  try {
    await operation();
  } catch (error) {
    if (error?.code === code) return error;
    throw new Error(`${message}: expected ${code}, received ${error?.code || error?.message}`);
  }
  throw new Error(`${message}: expected ${code}, but nothing was thrown`);
}

function seedMigrationLedger(db) {
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY CHECK (version > 0),
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
  const insert = db.prepare("INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)");
  for (let version = 4; version <= 13; version += 1) {
    insert.run(version, version === 4 ? "baseline-v4" : `fixture-v${version}`, sha256(`fixture-${version}`), "2026-01-01T00:00:00.000Z");
  }
  db.exec("PRAGMA user_version = 13");
}

function createClock() {
  let value = Date.parse("2026-03-01T00:00:00.000Z");
  return {
    now() {
      value += 1;
      return new Date(value).toISOString();
    },
    monotonicNow() {
      value += 1;
      return value;
    }
  };
}

function createTransaction(db) {
  let depth = 0;
  return function withTransaction(operation) {
    if (depth) return operation();
    db.exec("BEGIN");
    depth += 1;
    try {
      const result = operation();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    } finally {
      depth -= 1;
    }
  };
}

function fixtureMemories() {
  return new Map([
    ["memory-one", {
      id: "memory-one",
      title: "First campus note",
      rawContent: "We met beside the old noticeboard after class and kept the ticket inside a blue notebook.",
      exhibitText: "A saved scene beside the old noticeboard.",
      updatedAt: "2026-02-01T00:00:00.000Z",
      date: "",
      location: "Old noticeboard",
      people: ["Lin"],
      tags: ["campus", "ticket"],
      emotions: []
    }],
    ["memory-two", {
      id: "memory-two",
      title: "Second campus photo",
      rawContent: "The photograph shows the old noticeboard with two handwritten notes and a paper ticket.",
      exhibitText: "Another saved view of the same campus corner.",
      updatedAt: "2026-02-02T00:00:00.000Z",
      date: "",
      location: "Old noticeboard",
      people: ["Kai"],
      tags: ["campus", "photo"],
      emotions: []
    }],
    ["memory-three", {
      id: "memory-three",
      title: "Library receipt",
      rawContent: "A folded library receipt remained between two pages of the borrowed book.",
      exhibitText: "A quiet paper trace from the library.",
      updatedAt: "2026-02-03T00:00:00.000Z",
      date: "",
      location: "Library",
      people: [],
      tags: ["paper"],
      emotions: []
    }]
  ]);
}

function initializeFixture(existing = {}) {
  const db = existing.db || new DatabaseSync(":memory:");
  if (!existing.db) {
    seedMigrationLedger(db);
    db.exec(`
      CREATE TABLE side_effects (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
    `);
  }
  const memories = existing.memories || fixtureMemories();
  const clock = existing.clock || createClock();
  const withTransaction = existing.withTransaction || createTransaction(db);
  const counters = existing.counters || new Map();
  const calls = existing.calls || Object.fromEntries(READ_ONLY_TOOL_NAMES.map((name) => [name, 0]));
  function next(prefix) {
    const value = (counters.get(prefix) || 0) + 1;
    counters.set(prefix, value);
    return `${prefix}-${value}`;
  }
  const tools = {
    search_memory_summaries(args) {
      calls.search_memory_summaries += 1;
      const ids = args.memoryIds.length ? args.memoryIds : [...memories.keys()];
      return { memories: ids.map((id) => memories.get(id)).filter(Boolean).slice(0, args.limit) };
    },
    read_memory_evidence(args) {
      calls.read_memory_evidence += 1;
      return { memories: args.memoryIds.map((id) => memories.get(id)).filter(Boolean) };
    },
    read_confirmed_relationships() {
      calls.read_confirmed_relationships += 1;
      return { relationships: [] };
    },
    read_exhibition_summaries() {
      calls.read_exhibition_summaries += 1;
      return { exhibitions: [] };
    }
  };
  const database = initializeCuratorAgentDatabase({
    db,
    withTransaction,
    schemaVersion: 14,
    now: clock.now,
    monotonicNow: clock.monotonicNow,
    createId: next,
    tools,
    getMemory(id) { return memories.get(id) || null; },
    saveExhibitionDraft(preview) {
      const id = next("exhibition");
      db.prepare("INSERT INTO side_effects (id, kind, status, payload_json) VALUES (?, 'exhibition', 'draft', ?)")
        .run(id, JSON.stringify(preview));
      return { id, status: "draft" };
    },
    confirmRelationship(relation) {
      const id = next("relationship");
      db.prepare("INSERT INTO side_effects (id, kind, status, payload_json) VALUES (?, 'relationship', 'confirmed', ?)")
        .run(id, JSON.stringify(relation));
      return { id, status: "confirmed" };
    },
    publishExhibition(exhibitionId) {
      const result = db.prepare("UPDATE side_effects SET status = 'published' WHERE id = ? AND kind = 'exhibition' AND status = 'draft'").run(exhibitionId);
      if (!result.changes) throw new Error("Draft exhibition not found.");
      return { id: exhibitionId, status: "published" };
    }
  });
  return { db, database, memories, clock, withTransaction, counters, calls, tools };
}

function runCoreChecks() {
  const fixture = initializeFixture();
  const { db, database, memories, calls } = fixture;
  equal(db.prepare("PRAGMA user_version").get().user_version, 14, "migration advances schema version to 14");
  const tables = db.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'curator_agent_%' ORDER BY name
  `).all().map((row) => row.name);
  deepEqual(tables, [
    "curator_agent_decisions",
    "curator_agent_proposals",
    "curator_agent_runs",
    "curator_agent_steps"
  ], "schema 14 uses exactly four curator-agent tables");
  equal(CURATOR_AGENT_MIGRATION.version, 14, "migration export is schema 14");
  deepEqual(DEFAULT_BUDGETS, {
    maxSteps: 6,
    maxToolCalls: 4,
    maxDurationMs: 2000,
    maxResultBytes: 262144,
    maxMemories: 6
  }, "budgets are fixed");
  deepEqual(READ_ONLY_TOOL_NAMES, [
    "search_memory_summaries",
    "read_memory_evidence",
    "read_confirmed_relationships",
    "read_exhibition_summaries"
  ], "tool whitelist is fixed and read-only");

  const request = {
    intent: "draft_exhibition",
    query: "campus traces",
    memoryIds: ["memory-one", "memory-two"],
    title: "Two campus traces",
    theme: "campus"
  };
  const created = database.createCuratorAgentRun(request, { idempotencyKey: "create-main" });
  ok(created.created, "run is created");
  equal(created.workspace.run.status, "created", "new run starts created");
  equal(created.workspace.run.version, 1, "new run version starts at one");
  equal(created.workspace.steps.length, 0, "create does not call tools");
  equal(created.workspace.proposal, null, "create does not generate a proposal");
  deepEqual(calls, Object.fromEntries(READ_ONLY_TOOL_NAMES.map((name) => [name, 0])), "create is request-only and performs no reads");
  const replay = database.createCuratorAgentRun(request, { idempotencyKey: "create-main" });
  ok(replay.idempotent && !replay.created, "identical create request replays exactly");
  equal(replay.workspace.run.id, created.workspace.run.id, "create replay returns the original run");
  throwsCode(
    () => database.createCuratorAgentRun({ ...request, title: "Different" }, { idempotencyKey: "create-main" }),
    "CURATOR_AGENT_IDEMPOTENCY_CONFLICT",
    "create key cannot be reused with a different request hash"
  );
  throwsCode(
    () => normalizeCuratorRunRequest({ ...request, date: "2020-01-01" }),
    "CURATOR_AGENT_FIELD_SET_INVALID",
    "agent request rejects fields that could smuggle inferred dates"
  );

  const runId = created.workspace.run.id;
  const executed = database.executeCuratorAgentRun(runId, {
    confirm: true,
    expectedVersion: 1,
    idempotencyKey: "execute-main"
  });
  ok(executed.executed, "execute completes synchronously");
  equal(executed.workspace.run.status, "completed", "successful run becomes completed");
  equal(executed.workspace.run.version, 3, "start and completion each advance CAS version");
  equal(executed.workspace.steps.length, 4, "execution stores four read-only receipts");
  equal(executed.workspace.run.usage.toolCalls, 4, "tool usage is persisted");
  equal(executed.workspace.proposal.actions.length, 3, "proposal exposes exactly three approval actions");
  ok(!executed.workspace.proposal.actions.some((item) => item.action.includes("share")), "sharing is never a backend action");
  equal(executed.workspace.proposal.relation.status, "candidate", "relationship is explicitly labelled candidate");
  ok(executed.workspace.proposal.relation.requiresConfirmation, "candidate relationship requires confirmation");
  equal(executed.workspace.proposal.relation.rationale, "两件已保存记忆含有相同的主题标签「campus」，仅作为待确认候选。", "candidate relationship renders a human-facing Chinese basis label");
  equal(executed.workspace.proposal.sourceRefs.length, 2, "proposal binds every selected source");
  executed.workspace.proposal.sourceRefs.forEach((reference) => {
    equal(reference.rawSha256, sha256(memories.get(reference.memoryId).rawContent), "source ref binds the complete raw SHA");
    equal(reference.updatedAt, memories.get(reference.memoryId).updatedAt, "source ref binds updatedAt");
  });
  ok(executed.workspace.steps.every((step) => READ_ONLY_TOOL_NAMES.includes(step.toolName)), "stored receipts only use whitelisted tools");
  ok(executed.workspace.steps.every((step) => !stableStringify(step.result).includes("blue notebook") || stableStringify(step.result).length < 10000), "evidence receipts remain bounded instead of copying a collection");
  const callsBeforeEvaluation = { ...calls };
  const evaluation = database.evaluateCuratorAgentRun(runId);
  ok(evaluation.passed, "persisted trace passes deterministic evaluation");
  deepEqual(calls, callsBeforeEvaluation, "evaluation never rereads tools");
  equal(evaluation.traceSha256.length, 64, "evaluation emits a replayable trace hash");
  const receiptTamper = JSON.parse(JSON.stringify(executed.workspace));
  const tamperedEvidence = receiptTamper.steps.find((step) => step.toolName === "read_memory_evidence");
  tamperedEvidence.result.memories[0].exhibitText = "Tampered bounded evidence.";
  tamperedEvidence.resultSha256 = sha256(stableStringify(tamperedEvidence.result));
  tamperedEvidence.resultBytes = Buffer.byteLength(stableStringify(tamperedEvidence.result), "utf8");
  const receiptTamperEvaluation = evaluateCuratorAgentTrace(receiptTamper);
  ok(!receiptTamperEvaluation.passed, "trace evaluation rejects a tampered receipt even when its receipt hash is recomputed");
  ok(receiptTamperEvaluation.checks.find((item) => item.name === "receipt-hashes").passed, "tamper fixture bypasses the simple receipt-hash check");
  ok(!receiptTamperEvaluation.checks.find((item) => item.name === "proposal-replay").passed, "pure replay detects receipt-to-proposal divergence");
  const proposalTamper = JSON.parse(JSON.stringify(executed.workspace));
  proposalTamper.proposal.preview.title = "Tampered proposal title";
  const proposalTamperEvaluation = evaluateCuratorAgentTrace(proposalTamper);
  ok(!proposalTamperEvaluation.passed, "trace evaluation rejects a tampered proposal");
  ok(!proposalTamperEvaluation.checks.find((item) => item.name === "proposal-replay").passed, "proposal tamper cannot match the receipt-only replay");
  const executionReplay = database.executeCuratorAgentRun(runId, {
    confirm: true,
    expectedVersion: 1,
    idempotencyKey: "execute-main"
  });
  ok(executionReplay.idempotent && !executionReplay.executed, "execute replay wins before stale CAS");
  deepEqual(calls, callsBeforeEvaluation, "execute replay does not rerun tools");
  throwsCode(
    () => database.executeCuratorAgentRun(runId, { confirm: true, expectedVersion: 3, idempotencyKey: "execute-other" }),
    "CURATOR_AGENT_IDEMPOTENCY_CONFLICT",
    "a completed execution cannot be rebound to a new key"
  );

  throwsCode(
    () => database.decideCuratorAgentRun(runId, { action: "share_exhibition", decision: "approve", confirm: true }, { expectedVersion: 3, idempotencyKey: "share-key" }),
    "CURATOR_AGENT_ACTION_INVALID",
    "share action is rejected"
  );
  throwsCode(
    () => database.decideCuratorAgentRun(runId, { action: "publish_exhibition", decision: "approve", confirm: true }, { expectedVersion: 3, idempotencyKey: "publish-too-early" }),
    "CURATOR_AGENT_PUBLISH_REQUIRES_SAVE",
    "publish cannot precede an independently approved save"
  );
  equal(database.getCuratorAgentRunWorkspace(runId).decisions.length, 0, "failed approval creates no decision receipt");
  const saved = database.decideCuratorAgentRun(runId, {
    action: "save_exhibition",
    decision: "approve",
    confirm: true
  }, { expectedVersion: 3, idempotencyKey: "save-main" });
  equal(saved.workspace.decisions[0].outcome.exhibitionStatus, "draft", "save approval can only create a draft");
  const exhibitionId = saved.workspace.decisions[0].outcome.exhibitionId;
  equal(db.prepare("SELECT status FROM side_effects WHERE id = ?").get(exhibitionId).status, "draft", "saved side effect is a draft");
  const savedReplay = database.decideCuratorAgentRun(runId, {
    action: "save_exhibition",
    decision: "approve",
    confirm: true
  }, { expectedVersion: 3, idempotencyKey: "save-main" });
  ok(savedReplay.idempotent, "decision replays by exact key and request hash before stale CAS");
  equal(db.prepare("SELECT COUNT(*) AS count FROM side_effects WHERE kind = 'exhibition'").get().count, 1, "decision replay creates no duplicate draft");
  throwsCode(
    () => database.decideCuratorAgentRun(runId, { action: "save_exhibition", decision: "approve", confirm: true }, { expectedVersion: 4, idempotencyKey: "save-other" }),
    "CURATOR_AGENT_ACTION_ALREADY_DECIDED",
    "each action receives one final decision"
  );
  const related = database.decideCuratorAgentRun(runId, {
    action: "confirm_relationship",
    decision: "approve",
    confirm: true
  }, { expectedVersion: 4, idempotencyKey: "relation-main" });
  equal(related.workspace.decisions.at(-1).outcome.relationType, "related_context", "relationship confirmation records the candidate type");
  equal(db.prepare("SELECT COUNT(*) AS count FROM side_effects WHERE kind = 'relationship'").get().count, 1, "relationship changes only after its own approval");
  const published = database.decideCuratorAgentRun(runId, {
    action: "publish_exhibition",
    decision: "approve",
    confirm: true
  }, { expectedVersion: 5, idempotencyKey: "publish-main" });
  equal(published.workspace.decisions.at(-1).outcome.exhibitionStatus, "published", "publish approval records a published outcome");
  equal(db.prepare("SELECT status FROM side_effects WHERE id = ?").get(exhibitionId).status, "published", "approved publish updates the saved draft only");

  const cancelledRun = database.createCuratorAgentRun(request, { idempotencyKey: "create-cancel" }).workspace.run;
  const cancelled = database.cancelCuratorAgentRun(cancelledRun.id, { confirm: true, expectedVersion: 1, idempotencyKey: "cancel-main" });
  equal(cancelled.workspace.run.status, "cancelled", "created run can be cancelled");
  const cancelReplay = database.cancelCuratorAgentRun(cancelledRun.id, { confirm: true, expectedVersion: 1, idempotencyKey: "cancel-main" });
  ok(cancelReplay.idempotent, "cancel replay is exact and does not require current CAS");
  throwsCode(
    () => database.executeCuratorAgentRun(cancelledRun.id, { confirm: true, expectedVersion: 2, idempotencyKey: "execute-cancelled" }),
    "CURATOR_AGENT_RUN_NOT_EXECUTABLE",
    "cancelled runs never execute"
  );

  const staleRun = database.createCuratorAgentRun(request, { idempotencyKey: "create-stale" }).workspace.run;
  const staleExecuted = database.executeCuratorAgentRun(staleRun.id, { confirm: true, expectedVersion: 1, idempotencyKey: "execute-stale" }).workspace;
  memories.get("memory-one").updatedAt = "2026-02-10T00:00:00.000Z";
  const staleError = throwsCode(
    () => database.decideCuratorAgentRun(staleRun.id, { action: "save_exhibition", decision: "approve", confirm: true }, { expectedVersion: staleExecuted.run.version, idempotencyKey: "save-stale" }),
    "CURATOR_AGENT_SOURCE_STALE",
    "approval refuses a changed source snapshot"
  );
  equal(staleError.memoryId, "memory-one", "stale error identifies the changed source");
  ok(database.getCuratorAgentRunWorkspace(staleRun.id).run.needsReview, "stale run is persistently marked for review");
  memories.get("memory-one").updatedAt = "2026-02-01T00:00:00.000Z";

  const rollbackRun = database.createCuratorAgentRun(request, { idempotencyKey: "create-rollback" }).workspace.run;
  const rollbackExecuted = database.executeCuratorAgentRun(rollbackRun.id, { confirm: true, expectedVersion: 1, idempotencyKey: "execute-rollback" }).workspace;
  const beforeEffects = db.prepare("SELECT COUNT(*) AS count FROM side_effects").get().count;
  db.exec(`
    CREATE TRIGGER fail_curator_decision_receipt
    BEFORE INSERT ON curator_agent_decisions
    BEGIN
      SELECT RAISE(ABORT, 'INJECTED_DECISION_FAILURE');
    END;
  `);
  assertions += 1;
  try {
    database.decideCuratorAgentRun(rollbackRun.id, { action: "save_exhibition", decision: "approve", confirm: true }, {
      expectedVersion: rollbackExecuted.run.version,
      idempotencyKey: "save-rollback"
    });
    throw new Error("fault injection did not fail");
  } catch (error) {
    if (!String(error.message).includes("INJECTED_DECISION_FAILURE")) throw error;
  }
  db.exec("DROP TRIGGER fail_curator_decision_receipt");
  equal(db.prepare("SELECT COUNT(*) AS count FROM side_effects").get().count, beforeEffects, "approved side effect rolls back if decision receipt fails");
  equal(database.getCuratorAgentRunWorkspace(rollbackRun.id).decisions.length, 0, "failed atomic approval leaves no decision");

  const interruptRun = database.createCuratorAgentRun(request, { idempotencyKey: "create-interrupt" }).workspace.run;
  db.prepare("UPDATE curator_agent_runs SET status = 'running', started_at = created_at WHERE id = ?").run(interruptRun.id);
  const reopened = initializeFixture(fixture);
  const interrupted = reopened.database.getCuratorAgentRunWorkspace(interruptRun.id);
  equal(interrupted.run.status, "interrupted", "startup marks abandoned running work interrupted");
  ok(interrupted.run.interruptedAt, "interruption receives a timestamp");
  throwsCode(
    () => reopened.database.executeCuratorAgentRun(interruptRun.id, { confirm: true, expectedVersion: interrupted.run.version, idempotencyKey: "resume-forbidden" }),
    "CURATOR_AGENT_RUN_NOT_EXECUTABLE",
    "interrupted work never resumes"
  );

  const backup = reopened.database.buildCuratorAgentBackup("full");
  equal(backup.mode, "full", "full private backup is available");
  equal(backup.schemaVersion, 14, "full backup records schema 14");
  ok(backup.runs.some((entry) => entry.run.id === runId), "full backup retains private audit traces");
  const redacted = reopened.database.buildCuratorAgentBackup("redacted");
  equal(redacted.mode, "redacted-summary", "redacted backup contains summary only");
  ok(!("runs" in redacted), "redacted backup excludes requests and evidence receipts");
  const singleBackup = { mode: "full", schemaVersion: 14, runs: [backup.runs.find((entry) => entry.run.id === runId)] };
  const restored = reopened.database.restoreCuratorAgentBackup(singleBackup);
  equal(restored.restoredRuns, 1, "one historical run restores");
  const historical = reopened.database.getCuratorAgentRunWorkspace(restored.runIdMap[runId]);
  ok(historical.run.historical && historical.run.needsReview && !historical.run.allowDecisions, "restored audit trace is historical, review-only, and cannot authorize actions");
  const historicalEvaluation = reopened.database.evaluateCuratorAgentRun(historical.run.id);
  ok(historicalEvaluation.passed, "restored historical trace remains replayable in its isolated request-hash domain");
  ok(historical.run.idempotencyKey !== singleBackup.runs[0].run.idempotencyKey, "restore domain-separates live idempotency keys");
  ok(historical.run.requestSha256 !== singleBackup.runs[0].run.requestSha256, "restore domain-separates request digests");
  const restoredDecisionIds = db.prepare("SELECT id FROM curator_agent_decisions WHERE run_id = ? ORDER BY id").all(historical.run.id).map((row) => row.id).sort();
  deepEqual(restoredDecisionIds, Object.values(restored.idMap.decisions).sort(), "restore decision idMap points at the actual database row IDs");
  throwsCode(
    () => reopened.database.decideCuratorAgentRun(historical.run.id, { action: "save_exhibition", decision: "approve", confirm: true }, { expectedVersion: historical.run.version, idempotencyKey: "historical-save" }),
    "CURATOR_AGENT_HISTORICAL_READ_ONLY",
    "historical trace cannot make a decision"
  );
  const historicalEntry = reopened.database.buildCuratorAgentBackup("full").runs.find((entry) => entry.run.id === historical.run.id);
  const restoredAgain = reopened.database.restoreCuratorAgentBackup({ mode: "full", schemaVersion: 14, runs: [historicalEntry] });
  const secondHistoricalId = restoredAgain.idMap.runs[historical.run.id];
  ok(secondHistoricalId && secondHistoricalId !== historical.run.id, "restoring a historical archive remaps it again instead of colliding");
  ok(reopened.database.getCuratorAgentRunWorkspace(secondHistoricalId).run.historical, "second-generation restore remains historical and read-only");

  const deleteRun = reopened.database.createCuratorAgentRun(request, { idempotencyKey: "create-delete" }).workspace.run;
  const deletion = reopened.database.deleteCuratorAgentRun(deleteRun.id, { confirm: true, expectedVersion: 1, idempotencyKey: "delete-main" });
  ok(deletion.deleted, "explicit delete removes the live audit workspace");
  equal(reopened.database.getCuratorAgentRunWorkspace(deleteRun.id), null, "deleted audit workspace is no longer readable");
  const deletionReplay = reopened.database.deleteCuratorAgentRun(deleteRun.id, { confirm: true, expectedVersion: 1, idempotencyKey: "delete-main" });
  ok(deletionReplay.idempotent, "delete retains only a minimal idempotency tombstone for exact replay");
  const tombstone = db.prepare("SELECT request_json, deletion_idempotency_key FROM curator_agent_runs WHERE id = ?").get(deleteRun.id);
  equal(tombstone.request_json, "{}", "delete scrubs the request body");
  equal(tombstone.deletion_idempotency_key, "delete-main", "delete tombstone binds the exact replay key");

  const privacyRun = reopened.database.createCuratorAgentRun({
    intent: "draft_exhibition",
    query: "find a small paper trail"
  }, { idempotencyKey: "create-privacy-purge" }).workspace.run;
  const privacyExecuted = reopened.database.executeCuratorAgentRun(privacyRun.id, {
    confirm: true,
    expectedVersion: privacyRun.version,
    idempotencyKey: "execute-privacy-purge"
  }).workspace;
  ok(privacyExecuted.proposal.sourceRefs.some((reference) => reference.memoryId === "memory-three"), "query-only run binds a memory not present in request.memoryIds");
  const privacyPurge = reopened.database.purgeCuratorAgentRunsForMemory("memory-three");
  ok(privacyPurge.runIds.includes(privacyRun.id), "memory purge discovers proposal and evidence receipt references");
  equal(reopened.database.getCuratorAgentRunWorkspace(privacyRun.id), null, "memory purge physically removes the matching run workspace");
  equal(db.prepare("SELECT COUNT(*) AS count FROM curator_agent_steps WHERE run_id = ?").get(privacyRun.id).count, 0, "memory purge cascades bounded evidence receipts");
  equal(db.prepare("SELECT COUNT(*) AS count FROM curator_agent_proposals WHERE run_id = ?").get(privacyRun.id).count, 0, "memory purge cascades proposal source references");

  const failedSearchFixture = initializeFixture();
  failedSearchFixture.memories.delete("memory-two");
  failedSearchFixture.memories.delete("memory-three");
  const failedSearchRun = failedSearchFixture.database.createCuratorAgentRun({
    intent: "draft_exhibition",
    query: "single retained summary"
  }, { idempotencyKey: "create-failed-search" }).workspace.run;
  throwsCode(
    () => failedSearchFixture.database.executeCuratorAgentRun(failedSearchRun.id, {
      confirm: true,
      expectedVersion: failedSearchRun.version,
      idempotencyKey: "execute-failed-search"
    }),
    "CURATOR_AGENT_MEMORY_COUNT_INVALID",
    "query-only execution fails safely after persisting one bounded search receipt"
  );
  const failedSearchWorkspace = failedSearchFixture.database.getCuratorAgentRunWorkspace(failedSearchRun.id);
  equal(failedSearchWorkspace.steps.length, 1, "failed query-only run retains one diagnostic search receipt");
  const failedSearchPurge = failedSearchFixture.database.purgeCuratorAgentRunsForMemory("memory-one");
  ok(failedSearchPurge.runIds.includes(failedSearchRun.id), "memory purge discovers IDs in failed search receipts before a proposal exists");
  equal(failedSearchFixture.database.getCuratorAgentRunWorkspace(failedSearchRun.id), null, "memory purge removes failed-run summaries for the deleted source");

  const exhibitionPurge = reopened.database.purgeCuratorAgentRunsForExhibition(exhibitionId);
  ok(exhibitionPurge.runIds.includes(runId), "exhibition purge discovers approved decision outcomes");
  equal(reopened.database.getCuratorAgentRunWorkspace(runId), null, "deleting an exhibition can remove its dangling curator audit evidence");

  return reopened;
}

function runCapacityAndClockChecks() {
  equal(MAX_CURATOR_AGENT_RUNS, 12, "retained curator workspaces have a fixed archive-safe limit");
  const request = {
    intent: "draft_exhibition",
    query: "bounded capacity",
    memoryIds: ["memory-one", "memory-two"],
    title: "Bounded capacity",
    theme: "audit"
  };
  const capacity = initializeFixture();
  for (let index = 0; index < MAX_CURATOR_AGENT_RUNS; index += 1) {
    capacity.database.createCuratorAgentRun(request, { idempotencyKey: `capacity-${index}` });
  }
  equal(
    capacity.db.prepare("SELECT COUNT(*) AS count FROM curator_agent_runs WHERE deleted_at = ''").get().count,
    MAX_CURATOR_AGENT_RUNS,
    "create retains every run up to the archive-safe limit"
  );
  ok(
    capacity.database.createCuratorAgentRun(request, { idempotencyKey: "capacity-0" }).idempotent,
    "an exact replay remains available when capacity is full"
  );
  throwsCode(
    () => capacity.database.createCuratorAgentRun(request, { idempotencyKey: "capacity-overflow" }),
    "CURATOR_AGENT_RUN_LIMIT",
    "count and insert reject a new run at the fixed capacity boundary"
  );
  equal(
    capacity.db.prepare("SELECT COUNT(*) AS count FROM curator_agent_runs WHERE deleted_at = ''").get().count,
    MAX_CURATOR_AGENT_RUNS,
    "capacity rejection leaves the retained run set unchanged"
  );

  const offsetClock = initializeFixture({
    clock: {
      now: () => "2026-03-01T08:00:00+08:00",
      monotonicNow: () => 0
    }
  });
  const normalized = offsetClock.database.createCuratorAgentRun(request, { idempotencyKey: "offset-clock" });
  equal(normalized.workspace.run.createdAt, "2026-03-01T00:00:00.000Z", "database timestamps normalize to canonical UTC before persistence");
}

function runServiceBoundaryChecks(fixture) {
  const request = normalizeCuratorRunRequest({ query: "campus", memoryIds: ["memory-one", "memory-two"] });
  throwsCode(
    () => executeCuratorAgent({
      request,
      tools: { ...fixture.tools, fetch_url() { return {}; } }
    }),
    "CURATOR_AGENT_TOOL_FORBIDDEN",
    "arbitrary network-like tools are forbidden"
  );
  let checks = 0;
  throwsCode(
    () => executeCuratorAgent({
      request,
      tools: fixture.tools,
      shouldCancel() { checks += 1; return checks >= 2; }
    }),
    "CURATOR_AGENT_CANCELLED",
    "executor checks cancellation between bounded steps"
  );
  const oversizedTools = {
    ...fixture.tools,
    search_memory_summaries() {
      return { memories: [
        { ...fixture.memories.get("memory-one"), title: "x".repeat(300000) },
        fixture.memories.get("memory-two")
      ] };
    }
  };
  const bounded = executeCuratorAgent({ request, tools: oversizedTools });
  ok(bounded.usage.resultBytes < DEFAULT_BUDGETS.maxResultBytes, "tool receipts truncate oversized fields before persistence");
  equal(buildCuratorRequestSha256(request), buildCuratorRequestSha256({ ...request }), "run request hash is deterministic");
  equal(decisionRequestSha256("run-one", { action: "save_exhibition", decision: "approve" }),
    sha256(stableStringify({ action: "save_exhibition", confirm: true, decision: "approve", runId: "run-one" })),
    "decision request digest uses the frozen exact material");
}

function makeRequest(method, headers = {}) {
  return { method, headers };
}

function makeResponse() {
  return {
    headers: {},
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; }
  };
}

function makeApi(store, options = {}) {
  let body = options.body || {};
  return {
    setBody(value) { body = value; },
    api: createCuratorAgentApi({
      store,
      interviewDemo: Boolean(options.interviewDemo),
      readJsonBody: async () => body,
      sendJson: (_response, statusCode, payload) => ({ statusCode, payload }),
      httpError(statusCode, message) {
        const error = new Error(message);
        error.statusCode = statusCode;
        return error;
      }
    })
  };
}

async function runApiChecks(fixture) {
  const sample = createCuratorAgentSample();
  equal(sample.run.status, "completed", "sample is a completed synthetic workspace");
  equal(sample.steps.length, 4, "sample includes four bounded receipts");
  ok(sample.evaluation.passed, "sample trace is internally evaluable");
  ok(!sample.proposal.actions.some((action) => action.action.includes("share")), "sample also excludes backend sharing");

  const local = makeApi(fixture.database);
  let response = makeResponse();
  let result = await local.api.handle(makeRequest("GET"), response, new URL("http://local/api/curator-agent/sample"));
  equal(result.statusCode, 200, "sample endpoint responds locally");
  ok(result.payload.synthetic, "sample endpoint is clearly synthetic");
  equal(result.payload.decisions.length, 0, "sample performs no approval writes");

  local.setBody({ query: "library", memoryIds: ["memory-one", "memory-two"] });
  response = makeResponse();
  result = await local.api.handle(makeRequest("POST", { "idempotency-key": "api-create" }), response, new URL("http://local/api/curator-agent/runs"));
  equal(result.statusCode, 201, "API creates a request-bound run");
  ok(/^"curator-agent-.+-v1"$/u.test(result.payload.etag), "create response includes run ETag");
  const runId = result.payload.run.id;
  const etag = result.payload.etag;
  local.setBody({ confirm: true });
  response = makeResponse();
  result = await local.api.handle(makeRequest("POST", { "idempotency-key": "api-execute", "if-match": etag }), response,
    new URL(`http://local/api/curator-agent/runs/${runId}/execute`));
  equal(result.statusCode, 200, "API execute is synchronous");
  equal(result.payload.run.status, "completed", "API execute returns completed workspace");
  equal(result.payload.freshness.status, "bound", "API surfaces source freshness binding");
  ok(result.payload.etag !== etag, "execute advances ETag");
  response = makeResponse();
  const evaluationResult = await local.api.handle(makeRequest("GET"), response,
    new URL(`http://local/api/curator-agent/runs/${runId}/evaluation`));
  ok(evaluationResult.payload.evaluation.passed, "evaluation endpoint uses persisted trace");
  result = await local.api.handle(makeRequest("GET"), makeResponse(), new URL("http://local/api/curator-agent/runs?limit=2"));
  equal(result.statusCode, 200, "recent-run listing is available");
  ok(result.payload.runs.length <= 2, "recent-run list honors bounded limit");
  await rejectsCode(
    () => local.api.handle(makeRequest("POST", { "idempotency-key": "missing-if-match" }), makeResponse(),
      new URL(`http://local/api/curator-agent/runs/${runId}/cancel`)),
    "CURATOR_AGENT_PRECONDITION_REQUIRED",
    "mutating API requires If-Match"
  );
  local.setBody({ query: "delete through API", memoryIds: ["memory-one", "memory-two"] });
  const apiDeleteCreated = await local.api.handle(makeRequest("POST", { "idempotency-key": "api-delete-create" }), makeResponse(),
    new URL("http://local/api/curator-agent/runs"));
  local.setBody({ confirm: true });
  const deleteHeaders = { "idempotency-key": "api-delete-run", "if-match": apiDeleteCreated.payload.etag };
  const apiDeleted = await local.api.handle(makeRequest("DELETE", deleteHeaders), makeResponse(),
    new URL(`http://local/api/curator-agent/runs/${apiDeleteCreated.payload.run.id}`));
  ok(apiDeleted.payload.deleted, "DELETE API removes the audit workspace");
  const apiDeleteReplay = await local.api.handle(makeRequest("DELETE", deleteHeaders), makeResponse(),
    new URL(`http://local/api/curator-agent/runs/${apiDeleteCreated.payload.run.id}`));
  ok(apiDeleteReplay.payload.idempotent, "DELETE API replay reaches the minimal tombstone without a workspace pre-read");

  let demoWrites = 0;
  const demoStore = new Proxy({}, { get() { return () => { demoWrites += 1; }; } });
  const demo = makeApi(demoStore, { interviewDemo: true, body: { query: "private" } });
  result = await demo.api.handle(makeRequest("GET"), makeResponse(), new URL("http://local/api/curator-agent/sample"));
  equal(result.statusCode, 200, "Demo exposes the synthetic sample");
  ok(result.payload.demo && result.payload.synthetic, "Demo marks sample read-only and synthetic");
  await rejectsCode(
    () => demo.api.handle(makeRequest("POST", { "idempotency-key": "demo-write" }), makeResponse(), new URL("http://local/api/curator-agent/runs")),
    "CURATOR_AGENT_DEMO_READ_ONLY",
    "Demo rejects every V10 write before reading a body"
  );
  equal(demoWrites, 0, "Demo sample and rejected POST make zero store calls");
}

async function main() {
  const fixture = runCoreChecks();
  runCapacityAndClockChecks();
  runServiceBoundaryChecks(fixture);
  await runApiChecks(fixture);
  console.log(`Curator-agent checks passed (${assertions} assertions).`);
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
