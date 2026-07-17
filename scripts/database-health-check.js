"use strict";

const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const { createDatabaseHealthReader } = require("../lib/database-health");

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
  console.log(`Database health checks passed: ${assertions} assertions.`);
} finally {
  db.close();
}

function check(condition, message) {
  assertions += 1;
  assert.equal(Boolean(condition), true, message);
}
