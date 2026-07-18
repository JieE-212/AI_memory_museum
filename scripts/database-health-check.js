"use strict";

const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const { createDatabaseHealthReader } = require("../lib/database-health");
const { TIME_CALIBRATION_MIGRATION } = require("../lib/time-calibration-database");
const { ORAL_HISTORY_MIGRATION } = require("../lib/oral-history-database");
const { buildQuestionKey } = require("../lib/oral-history-service");
const { CURATOR_AGENT_MIGRATION } = require("../lib/curator-agent-database");
const {
  CURATOR_AGENT_SCHEMA_VERSION,
  FIXED_BUDGETS,
  buildCuratorRequestSha256
} = require("../lib/curator-agent-backup");

let assertions = 0;
const db = new DatabaseSync(":memory:");
try {
  db.exec(`
    PRAGMA foreign_keys = OFF;
    PRAGMA user_version = 10;
    CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY);
    INSERT INTO schema_migrations VALUES (10);
    CREATE TABLE memories (id TEXT PRIMARY KEY);
    CREATE TABLE memory_children (id TEXT PRIMARY KEY, memory_id TEXT REFERENCES memories(id));
    CREATE TABLE memory_search_documents (id INTEGER PRIMARY KEY, memory_id TEXT UNIQUE);
    CREATE TABLE memory_search_fts (placeholder TEXT);
    CREATE TABLE memory_search_fts_docsize (id INTEGER PRIMARY KEY);
    CREATE TABLE media_assets (id TEXT PRIMARY KEY);
    CREATE TABLE voice_assets (id TEXT PRIMARY KEY);
    CREATE TABLE exhibitions (id TEXT PRIMARY KEY, needs_review INTEGER);
    CREATE TABLE time_capsules (id TEXT PRIMARY KEY, needs_review INTEGER);
    CREATE TABLE entities (id TEXT PRIMARY KEY);
    CREATE TABLE memory_revisions (id TEXT PRIMARY KEY);
    CREATE TABLE memory_claims (memory_id TEXT, status TEXT);
    CREATE TABLE curator_questions (id TEXT PRIMARY KEY, status TEXT);
    CREATE TABLE voice_transcripts (memory_id TEXT, status TEXT);
    INSERT INTO memories VALUES ('memory-one');
    INSERT INTO memory_search_documents VALUES (1, 'memory-one');
    INSERT INTO memory_search_fts_docsize VALUES (1);
  `);
  const reader = createDatabaseHealthReader({ db, schemaVersion: 10 });
  const healthy = reader.snapshot();
  check(healthy.ok === true, "健康数据库通过全部结构检查");
  check(healthy.checks.length === 5 && healthy.checks.every((item) => item.ok), "快检、外键、schema、FTS 数量与成员均有独立事实");
  check(healthy.counts.memories === 1 && healthy.counts.searchDocuments === 1, "健康快照只返回业务计数");
  check(healthy.issues.length === 0, "健康数据库没有虚构待核对事项");

  db.exec("DELETE FROM memory_search_fts_docsize;");
  const ftsMismatch = reader.snapshot();
  check(ftsMismatch.checks.find((item) => item.code === "DATABASE_FTS_COUNT").ok === false, "FTS 文档数量不一致会被发现");
  db.exec("INSERT INTO memory_search_fts_docsize VALUES (1);");

  db.exec("DELETE FROM memory_search_fts_docsize; INSERT INTO memory_search_fts_docsize VALUES (2);");
  const ftsMembershipMismatch = reader.snapshot();
  check(ftsMembershipMismatch.checks.find((item) => item.code === "DATABASE_FTS_COUNT").ok === true, "等量错位场景不会被数量检查误报为不同数量");
  check(ftsMembershipMismatch.checks.find((item) => item.code === "DATABASE_FTS_MEMBERSHIP").ok === false, "FTS 等量但成员错位仍会被集合核对发现");
  db.exec("DELETE FROM memory_search_fts_docsize; INSERT INTO memory_search_fts_docsize VALUES (1);");

  db.exec("INSERT INTO memory_children VALUES ('orphan', 'missing-memory');");
  const foreignMismatch = reader.snapshot();
  check(foreignMismatch.checks.find((item) => item.code === "DATABASE_FOREIGN_KEYS").ok === false, "无效外键会被发现");
  db.exec("DELETE FROM memory_children;");

  db.exec(`
    INSERT INTO exhibitions VALUES ('exhibition-review', 1);
    INSERT INTO time_capsules VALUES ('capsule-review', 1);
    INSERT INTO memory_claims VALUES ('memory-one', 'source_invalidated');
    INSERT INTO curator_questions VALUES ('question-open', 'open');
    INSERT INTO voice_transcripts VALUES ('memory-one', 'draft');
  `);
  const reviews = reader.snapshot();
  check(reviews.issues.length === 5, "五类人工待核对事项分别汇总");
  check(reviews.issueCounts.length === 5 && reviews.issueCounts.every((item) => item.count === 1), "待核对总数独立于公开样本上限准确汇总");
  check(reviews.issues.every((item) => item.area === "curation" && item.severity === "attention"), "业务待核对项不冒充数据库损坏");
  check(reviews.issues.some((item) => item.code === "VOICE_TRANSCRIPT_DRAFT"), "草稿文字稿被标为待整理");
  check(!JSON.stringify(reviews).includes("missing-memory") && !JSON.stringify(reviews).includes("原始正文"), "健康快照不返回外键内容或私人正文");

  db.exec("PRAGMA user_version = 9;");
  const schemaMismatch = reader.snapshot();
  check(schemaMismatch.checks.find((item) => item.code === "DATABASE_SCHEMA").ok === false, "运行 schema 与账本不一致会被发现");
  check(schemaMismatch.ok === false, "任一结构检查失败会收敛为非健康状态");
  checkTimeCalibrationHealth();
  checkOralHistoryHealth();
  checkCuratorAgentHealth();
  console.log(`Database health checks passed: ${assertions} assertions.`);
} finally {
  db.close();
}

function checkCuratorAgentHealth() {
  const curatorDb = new DatabaseSync(":memory:");
  try {
    curatorDb.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA user_version = 14;
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY);
      INSERT INTO schema_migrations VALUES (14);
      CREATE TABLE memory_search_documents (id INTEGER PRIMARY KEY, memory_id TEXT UNIQUE);
      CREATE TABLE memory_search_fts_docsize (id INTEGER PRIMARY KEY);
    `);
    CURATOR_AGENT_MIGRATION.up(curatorDb);
    const timestamp = "2026-07-18T10:00:00.000Z";
    const request = {
      intent: "draft_exhibition",
      query: "private objective must never enter health output",
      memoryIds: [],
      title: "",
      theme: ""
    };
    const requestSha256 = buildCuratorRequestSha256(request);
    curatorDb.prepare(`
      INSERT INTO curator_agent_runs (
        id, idempotency_key, request_sha256, request_json, status, version,
        historical, needs_review, allow_decisions, created_at, started_at,
        updated_at, interrupted_at
      ) VALUES (?, ?, ?, ?, 'interrupted', 1, 0, 1, 0, ?, ?, ?, ?)
    `).run(
      "curator-run-health",
      "health-key-0001",
      requestSha256,
      JSON.stringify(request),
      timestamp,
      timestamp,
      timestamp,
      timestamp
    );
    const backup = {
      mode: "full",
      schemaVersion: CURATOR_AGENT_SCHEMA_VERSION,
      runs: [{
        run: {
          id: "curator-run-health",
          schemaVersion: CURATOR_AGENT_SCHEMA_VERSION,
          idempotencyKey: "health-key-0001",
          requestSha256,
          request,
          status: "interrupted",
          version: 1,
          budgets: { ...FIXED_BUDGETS },
          usage: { steps: 0, toolCalls: 0, resultBytes: 0, durationMs: 0 },
          historical: false,
          needsReview: true,
          allowDecisions: false,
          createdAt: timestamp,
          startedAt: timestamp,
          updatedAt: timestamp,
          completedAt: "",
          cancelledAt: "",
          interruptedAt: timestamp,
          failedAt: "",
          failureCode: "",
          failureMessage: ""
        },
        steps: [],
        proposal: null,
        decisions: []
      }]
    };
    const reader = createDatabaseHealthReader({
      db: curatorDb,
      schemaVersion: 14,
      getCuratorAgentBackup: () => backup,
      getCuratorAgentHealthSnapshot: () => ({
        runs: 1,
        steps: 0,
        proposals: 0,
        decisions: 0,
        completed: 0,
        interrupted: 1,
        needsReview: 1,
        objective: request.query,
        toolName: "read_memory_evidence",
        proposalSha256: "f".repeat(64)
      })
    });
    const healthy = reader.snapshot();
    check(healthy.checks.find((item) => item.code === "DATABASE_CURATOR_AGENT_STRUCTURE")?.ok === true,
      "schema 14 curator-agent tables and canonical full backup pass one frozen validator");
    check(JSON.stringify(Object.keys(healthy.counts).filter((key) => key.startsWith("curatorAgent")).sort()) === JSON.stringify([
      "curatorAgentCompleted", "curatorAgentDecisions", "curatorAgentInterrupted",
      "curatorAgentNeedsReview", "curatorAgentProposals", "curatorAgentRuns", "curatorAgentSteps"
    ]), "curator-agent health exposes only the seven safe counters");
    check(healthy.counts.curatorAgentRuns === 1 && healthy.counts.curatorAgentInterrupted === 1 &&
      healthy.counts.curatorAgentNeedsReview === 1, "interrupted and needs-review counts are projected without content");
    const curatorIssues = healthy.issues.filter((issue) => issue.code.startsWith("CURATOR_AGENT_"));
    check(curatorIssues.length === 2 && curatorIssues.every((issue) => (
      JSON.stringify(Object.keys(issue).sort()) === JSON.stringify(["area", "code", "recordId", "severity"])
    )), "curator-agent attention issues contain only code, severity, area, and a safe record id");
    const serialized = JSON.stringify(healthy);
    check(!serialized.includes(request.query) && !serialized.includes("read_memory_evidence") &&
      !serialized.includes("f".repeat(64)), "health output never exposes objective, tool, proposal, or hash content");

    const invalidBackup = JSON.parse(JSON.stringify(backup));
    invalidBackup.runs[0].run.budgets.maxSteps = 7;
    const invalid = createDatabaseHealthReader({
      db: curatorDb,
      schemaVersion: 14,
      getCuratorAgentBackup: () => invalidBackup
    }).snapshot();
    check(invalid.checks.find((item) => item.code === "DATABASE_CURATOR_AGENT_STRUCTURE")?.ok === false,
      "a full backup rejected by the canonical budget contract marks curator-agent structure invalid");
    check(!invalid.issues.some((issue) => issue.code.startsWith("CURATOR_AGENT_RUN_")),
      "corrupt curator-agent structure does not emit potentially misleading row attention items");

    curatorDb.exec("PRAGMA ignore_check_constraints = ON; UPDATE curator_agent_runs SET request_json = '[]';");
    const corruptJson = createDatabaseHealthReader({
      db: curatorDb,
      schemaVersion: 14,
      getCuratorAgentBackup: () => {
        const state = JSON.parse(JSON.stringify(backup));
        state.runs[0].run.request = JSON.parse(curatorDb.prepare(
          "SELECT request_json FROM curator_agent_runs WHERE id = 'curator-run-health'"
        ).get().request_json);
        return state;
      }
    }).snapshot();
    check(corruptJson.checks.find((item) => item.code === "DATABASE_CURATOR_AGENT_STRUCTURE")?.ok === false,
      "invalid curator-agent JSON is caught even without an injected backup reader");
    curatorDb.exec(`UPDATE curator_agent_runs SET request_json = '${JSON.stringify(request).replace(/'/gu, "''")}'; PRAGMA ignore_check_constraints = OFF;`);

    curatorDb.exec("DROP TABLE curator_agent_decisions;");
    const missingTable = createDatabaseHealthReader({
      db: curatorDb,
      schemaVersion: 14,
      getCuratorAgentBackup: () => backup
    }).snapshot();
    check(missingTable.checks.find((item) => item.code === "DATABASE_CURATOR_AGENT_STRUCTURE")?.ok === false,
      "all four curator-agent tables are required by schema 14 health");
  } finally {
    curatorDb.close();
  }
}

function checkOralHistoryHealth() {
  const oralDb = new DatabaseSync(":memory:");
  try {
    oralDb.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA user_version = 13;
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY);
      INSERT INTO schema_migrations VALUES (13);
      CREATE TABLE memories (id TEXT PRIMARY KEY);
      CREATE TABLE memory_events (id TEXT PRIMARY KEY, title TEXT, status TEXT);
      CREATE TABLE event_members (event_id TEXT, memory_id TEXT);
      CREATE TABLE memory_search_documents (id INTEGER PRIMARY KEY, memory_id TEXT UNIQUE);
      CREATE TABLE memory_search_fts_docsize (id INTEGER PRIMARY KEY);
      CREATE TABLE voice_assets (
        id TEXT PRIMARY KEY,
        content_sha256 TEXT,
        original_name TEXT,
        mime_type TEXT,
        codec TEXT,
        byte_size INTEGER,
        duration_ms INTEGER,
        storage_key TEXT,
        status TEXT,
        created_at TEXT,
        updated_at TEXT
      );
      CREATE TABLE time_calibrations (
        id TEXT, memory_id TEXT, event_id TEXT, resolution_kind TEXT,
        interval_start TEXT, interval_end TEXT, selected_source_keys_json TEXT,
        selected_source_snapshots_json TEXT, source_set_sha256 TEXT, note TEXT,
        created_at TEXT, updated_at TEXT
      );
      INSERT INTO memory_events VALUES ('event-oral-health', '一次重逢', 'confirmed');
      INSERT INTO voice_assets VALUES (
        'voice-oral-health', '${"a".repeat(64)}', '', 'audio/webm', 'opus', 100,
        20000, 'ready/aa/${"a".repeat(64)}.webm', 'ready',
        '2026-07-18T10:00:00.000Z', '2026-07-18T10:00:00.000Z'
      );
    `);
    ORAL_HISTORY_MIGRATION.up(oralDb);
    const sources = [
      oralSource("b", "2018-01-01", "memory-left"),
      oralSource("c", "2020-01-01", "memory-right")
    ];
    oralDb.prepare(`
      INSERT INTO oral_history_questions (
        id, event_id, question_key, question_text, origin_sources_json,
        origin_source_set_sha256, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "oral-question-health",
      "event-oral-health",
      buildQuestionKey("event-oral-health", sources),
      "这段往事更接近什么时候？",
      JSON.stringify(sources),
      "d".repeat(64),
      "2026-07-18T10:00:00.000Z",
      "2026-07-18T10:00:00.000Z"
    );
    oralDb.prepare(`
      INSERT INTO oral_history_answers (
        id, question_id, submission_id, request_sha256, asset_id, segment_start_ms,
        segment_end_ms, transcript_text, status, resolution_kind,
        interval_start, interval_end, created_at, confirmed_at,
        superseded_at, withdrawn_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', 'day', ?, ?, ?, ?, '', '')
    `).run(
      "oral-answer-health", "oral-question-health", "oral-submission-health",
      "e".repeat(64), "voice-oral-health", 1000, 9000, "只用于健康检查的私人文字稿",
      "2020-01-01", "2020-01-01", "2026-07-18T10:00:00.000Z", "2026-07-18T10:00:00.000Z"
    );

    const healthy = createDatabaseHealthReader({ db: oralDb, schemaVersion: 13 }).snapshot();
    check(healthy.checks.find((item) => item.code === "DATABASE_ORAL_HISTORY_STRUCTURE")?.ok === true, "schema 13 口述问题、回答、事件、声音与片段边界通过统一合同验真");
    check(healthy.counts.oralHistoryQuestions === 1 && healthy.counts.oralHistoryAnswers === 1 && healthy.counts.confirmedOralHistoryAnswers === 1, "数据库健康快照只公开口述史安全计数");
    check(!JSON.stringify(healthy).includes("私人文字稿"), "数据库健康快照不泄露口述文字稿");

    oralDb.exec("DROP TRIGGER oral_history_answer_content_immutable; UPDATE oral_history_answers SET segment_end_ms = 30000;");
    const corrupt = createDatabaseHealthReader({ db: oralDb, schemaVersion: 13 }).snapshot();
    check(corrupt.checks.find((item) => item.code === "DATABASE_ORAL_HISTORY_STRUCTURE")?.ok === false, "片段越过声音真时长时口述史结构检查失败");
    oralDb.exec("UPDATE oral_history_answers SET segment_end_ms = 9000;");

    const secondSources = [oralSource("e", "2017-01-01", "memory-left"), oralSource("f", "2021-01-01", "memory-right")];
    oralDb.prepare(`INSERT INTO oral_history_questions
      (id, event_id, question_key, question_text, origin_sources_json, origin_source_set_sha256, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "oral-question-open", "event-oral-health", buildQuestionKey("event-oral-health", secondSources),
      "另一个尚未确认的问题", JSON.stringify(secondSources), "1".repeat(64),
      "2026-07-18T10:01:00.000Z", "2026-07-18T10:01:00.000Z"
    );
    oralDb.prepare(`INSERT INTO oral_history_answers
      (id, question_id, submission_id, request_sha256, asset_id, segment_start_ms, segment_end_ms,
       transcript_text, status, resolution_kind, interval_start, interval_end,
       created_at, confirmed_at, superseded_at, withdrawn_at)
      VALUES (?, ?, ?, ?, ?, 0, 1000, ?, 'draft', 'uncertain', '', '', ?, '', '', '')`
    ).run(
      "oral-answer-draft", "oral-question-open", "oral-submission-draft", "f".repeat(64), "voice-oral-health",
      "尚未确认的草稿", "2026-07-18T10:01:00.000Z"
    );
    const reviews = createDatabaseHealthReader({ db: oralDb, schemaVersion: 13 }).snapshot();
    check(reviews.issues.some((item) => item.code === "ORAL_HISTORY_ANSWER_DRAFT"), "口述草稿进入温和待整理事项");
    check(reviews.issues.some((item) => item.code === "ORAL_HISTORY_QUESTION_OPEN"), "没有确认回答的问题进入开放问题提醒");
    check(!JSON.stringify(reviews).includes("尚未确认的草稿"), "口述健康提醒只含固定 code 和安全 ID，不泄露草稿正文");
  } finally {
    oralDb.close();
  }
}

function oralSource(seed, day, memoryId) {
  return {
    sourceKey: `time-source:${seed.repeat(64)}`,
    sourceType: "memory-current",
    precision: "day",
    intervalStart: day,
    intervalEnd: day,
    memoryId,
    memoryTitle: memoryId
  };
}

function checkTimeCalibrationHealth() {
  const calibrationDb = new DatabaseSync(":memory:");
  try {
    calibrationDb.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA user_version = 12;
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY);
      INSERT INTO schema_migrations VALUES (12);
      CREATE TABLE memories (id TEXT PRIMARY KEY);
      CREATE TABLE memory_events (id TEXT PRIMARY KEY);
      CREATE TABLE memory_search_documents (id INTEGER PRIMARY KEY, memory_id TEXT UNIQUE);
      CREATE TABLE memory_search_fts_docsize (id INTEGER PRIMARY KEY);
      INSERT INTO memories VALUES ('memory-calibration');
      INSERT INTO memory_search_documents VALUES (1, 'memory-calibration');
      INSERT INTO memory_search_fts_docsize VALUES (1);
    `);
    TIME_CALIBRATION_MIGRATION.up(calibrationDb);
    calibrationDb.prepare(`
      INSERT INTO time_calibrations (
        id, memory_id, event_id, resolution_kind, interval_start, interval_end,
        selected_source_keys_json, source_set_sha256, note, created_at, updated_at
      ) VALUES (?, ?, NULL, 'uncertain', '', '', '[]', ?, '', ?, ?)
    `).run(
      "calibration-health",
      "memory-calibration",
      "a".repeat(64),
      "2026-07-18T10:00:00.000Z",
      "2026-07-18T10:00:00.000Z"
    );

    const structuralOnly = createDatabaseHealthReader({ db: calibrationDb, schemaVersion: 12 }).snapshot();
    check(structuralOnly.checks.find((item) => item.code === "DATABASE_TIME_CALIBRATION_STRUCTURE")?.ok === true, "schema 12 时间校准目标、枚举、JSON 与摘要结构通过统一合同验真");
    check(structuralOnly.counts.timeCalibrations === 1, "数据库健康快照包含时间校准计数");
    check(!structuralOnly.issueCounts.some((item) => item.code === "TIME_CALIBRATION_NEEDS_REVIEW"), "未注入动态来源核验时不会用 SQL 猜测待复核状态");

    const dynamic = createDatabaseHealthReader({
      db: calibrationDb,
      schemaVersion: 12,
      getTimeCalibrationHealthSnapshot: () => ({ calibrations: 1, needsReview: 1 })
    }).snapshot();
    const review = dynamic.issues.find((item) => item.code === "TIME_CALIBRATION_NEEDS_REVIEW");
    check(review?.area === "curation" && review?.severity === "attention", "动态来源摘要变化只形成策展待复核而不冒充数据库损坏");
    check(dynamic.issueCounts.find((item) => item.code === "TIME_CALIBRATION_NEEDS_REVIEW")?.count === 1, "动态待复核总数独立准确汇总");

    calibrationDb.exec("UPDATE time_calibrations SET selected_source_keys_json = '{}';");
    check(calibrationStructureOk(calibrationDb) === false, "时间校准来源键 JSON 不是规范数组时结构检查失败");
    let dynamicCalls = 0;
    const corruptSnapshot = createDatabaseHealthReader({
      db: calibrationDb,
      schemaVersion: 12,
      getTimeCalibrationHealthSnapshot: () => { dynamicCalls += 1; throw new Error("must not run"); }
    }).snapshot();
    check(dynamicCalls === 0 && corruptSnapshot.ok === false, "结构损坏时跳过动态来源重建并保留可读诊断结果");
    calibrationDb.exec("UPDATE time_calibrations SET selected_source_keys_json = '[]';");

    calibrationDb.exec("PRAGMA ignore_check_constraints = ON; UPDATE time_calibrations SET selected_source_snapshots_json = '{}';");
    check(calibrationStructureOk(calibrationDb) === false, "时间校准保存时来源快照不是规范数组时结构检查失败");
    calibrationDb.exec("UPDATE time_calibrations SET selected_source_snapshots_json = '[]'; PRAGMA ignore_check_constraints = OFF;");

    calibrationDb.exec("PRAGMA ignore_check_constraints = ON; UPDATE time_calibrations SET source_set_sha256 = 'bad';");
    check(calibrationStructureOk(calibrationDb) === false, "时间校准来源摘要不是 SHA-256 时结构检查失败");
    calibrationDb.exec(`UPDATE time_calibrations SET source_set_sha256 = '${"a".repeat(64)}';`);

    calibrationDb.exec("UPDATE time_calibrations SET resolution_kind = 'guessed';");
    check(calibrationStructureOk(calibrationDb) === false, "未知时间分辨率枚举不会被健康检查接受");
    calibrationDb.exec("UPDATE time_calibrations SET resolution_kind = 'uncertain';");

    calibrationDb.exec("UPDATE time_calibrations SET memory_id = NULL, event_id = NULL;");
    check(calibrationStructureOk(calibrationDb) === false, "时间校准缺少唯一 memory/event 目标时结构检查失败");
    calibrationDb.exec("UPDATE time_calibrations SET memory_id = 'memory-calibration'; PRAGMA ignore_check_constraints = OFF;");
  } finally {
    calibrationDb.close();
  }
}

function calibrationStructureOk(db) {
  const snapshot = createDatabaseHealthReader({ db, schemaVersion: 12 }).snapshot();
  return snapshot.checks.find((item) => item.code === "DATABASE_TIME_CALIBRATION_STRUCTURE")?.ok === true;
}

function check(condition, message) {
  assertions += 1;
  assert.equal(Boolean(condition), true, message);
}
