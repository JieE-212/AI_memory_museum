"use strict";

function createDatabaseHealthReader(options = {}) {
  const db = options.db;
  const schemaVersion = Number(options.schemaVersion);
  if (!db || typeof db.prepare !== "function" || !Number.isSafeInteger(schemaVersion) || schemaVersion < 1) {
    throw new TypeError("Database health reader dependencies are required.");
  }

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
    const reviewSpecs = [
      ["memory_claims", "status = 'source_invalidated'", "CLAIM_SOURCE_INVALIDATED", "memory_id"],
      ["exhibitions", "needs_review = 1", "EXHIBITION_NEEDS_REVIEW", "id"],
      ["time_capsules", "needs_review = 1", "CAPSULE_NEEDS_REVIEW", "id"],
      ["curator_questions", "status = 'open'", "CURATOR_QUESTION_OPEN", "id"],
      ["voice_transcripts", "status = 'draft'", "VOICE_TRANSCRIPT_DRAFT", "memory_id"]
    ];
    const issues = reviewSpecs.flatMap((spec) => reviewRows(...spec));
    const issueCounts = reviewSpecs.map((spec) => reviewCount(...spec)).filter((item) => item.count > 0);
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
        searchDocuments: documentCount
      }
    };
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

module.exports = { createDatabaseHealthReader };
