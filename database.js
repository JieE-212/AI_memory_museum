const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const { initializeMediaDatabase } = require("./lib/media-database");
const { initializeExhibitionDatabase } = require("./lib/exhibition-database");
const { initializeRevisitDatabase } = require("./lib/revisit-database");
const { initializeClueDatabase } = require("./lib/clue-database");
const { initializeVoiceDatabase } = require("./lib/voice-database");
const { initializeCapsuleDatabase } = require("./lib/capsule-database");
const { initializeRevisionDatabase } = require("./lib/revision-database");
const { initializeRevisitIntentDatabase } = require("./lib/revisit-intent-database");
const { initializeTimeCalibrationDatabase } = require("./lib/time-calibration-database");
const { initializeOralHistoryDatabase } = require("./lib/oral-history-database");
const { initializeCuratorAgentDatabase } = require("./lib/curator-agent-database");
const { initializeMemoryInboxDatabase } = require("./lib/memory-inbox-database");
const { PROVENANCE_MIGRATION, initializeProvenanceDatabase } = require("./lib/provenance-database");
const { createProvenanceSourceCatalog } = require("./lib/provenance-sources");
const { createStoredCatalogSourceResolver } = require("./lib/provenance-runtime");
const { CO_MEMORY_RESPONSE_MIGRATION, initializeCoMemoryResponseDatabase } = require("./lib/co-memory-response-database");
const { PROVENANCE_CO_MEMORY_MIGRATION } = require("./lib/provenance-co-memory-migration");
const { MUSEUM_LOCK_MIGRATION, initializeMuseumLockDatabase } = require("./lib/museum-lock-database");
const { applyMigrations } = require("./lib/migrations");
const { createDatabaseHealthReader } = require("./lib/database-health");

function createMemoryStore({ dbPath, halls, schemaVersion }) {
  const normalizedDbPath = path.resolve(dbPath);
  fs.mkdirSync(path.dirname(normalizedDbPath), { recursive: true });

  const db = new DatabaseSync(normalizedDbPath);
  const internalTransaction = Symbol("internal-transaction");
  let transactionDepth = 0;

  function withTransaction(fn) {
    if (transactionDepth > 0) return fn(internalTransaction);

    db.exec("BEGIN");
    transactionDepth += 1;
    try {
      const result = fn(internalTransaction);
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    } finally {
      transactionDepth -= 1;
    }
  }

  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS halls (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      schema_version INTEGER NOT NULL DEFAULT 1,
      title TEXT NOT NULL,
      hall_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      raw_content TEXT NOT NULL,
      exhibit_text TEXT NOT NULL,
      memory_date TEXT NOT NULL DEFAULT '',
      location TEXT NOT NULL DEFAULT '',
      emotion_intensity INTEGER NOT NULL DEFAULT 3,
      importance INTEGER NOT NULL DEFAULT 1,
      favorite INTEGER NOT NULL DEFAULT 0,
      cover_image TEXT NOT NULL DEFAULT '',
      media_note TEXT NOT NULL DEFAULT '',
      attachments_json TEXT NOT NULL DEFAULT '[]',
      agent_run_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (hall_id) REFERENCES halls(id)
    );

    CREATE TABLE IF NOT EXISTS memory_people (
      memory_id TEXT NOT NULL,
      name TEXT NOT NULL,
      PRIMARY KEY (memory_id, name),
      FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS memory_tags (
      memory_id TEXT NOT NULL,
      tag TEXT NOT NULL,
      PRIMARY KEY (memory_id, tag),
      FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS memory_emotions (
      memory_id TEXT NOT NULL,
      emotion TEXT NOT NULL,
      PRIMARY KEY (memory_id, emotion),
      FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY,
      phase INTEGER NOT NULL DEFAULT 1,
      mode TEXT NOT NULL DEFAULT 'mock',
      status TEXT NOT NULL DEFAULT 'created',
      raw_preview TEXT NOT NULL DEFAULT '',
      summary_json TEXT NOT NULL DEFAULT '{}',
      event_count INTEGER NOT NULL DEFAULT 0,
      memory_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS agent_steps (
      run_id TEXT NOT NULL,
      step_id TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      agent TEXT NOT NULL,
      duty TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'done',
      output TEXT NOT NULL DEFAULT '',
      evidence_json TEXT NOT NULL DEFAULT '[]',
      actions_json TEXT NOT NULL DEFAULT '[]',
      PRIMARY KEY (run_id, step_id),
      FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS agent_events (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      step_id TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL,
      label TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS memory_events (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'confirmed',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS event_members (
      event_id TEXT NOT NULL,
      memory_id TEXT NOT NULL UNIQUE,
      position INTEGER NOT NULL DEFAULT 0,
      relation TEXT NOT NULL DEFAULT 'version',
      confirmation_note TEXT NOT NULL DEFAULT '',
      confirmed_at TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      PRIMARY KEY (event_id, memory_id),
      FOREIGN KEY (event_id) REFERENCES memory_events(id) ON DELETE CASCADE,
      FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS memory_claims (
      id TEXT PRIMARY KEY,
      memory_id TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      claim_key TEXT NOT NULL DEFAULT '',
      claim_type TEXT NOT NULL DEFAULT 'fact',
      value_json TEXT NOT NULL DEFAULT 'null',
      quote_text TEXT NOT NULL DEFAULT '',
      start_offset INTEGER,
      end_offset INTEGER,
      evidence_valid INTEGER NOT NULL DEFAULT 0,
      confidence REAL,
      status TEXT NOT NULL DEFAULT 'extracted',
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS memory_pair_decisions (
      pair_key TEXT PRIMARY KEY,
      memory_a_id TEXT NOT NULL,
      memory_b_id TEXT NOT NULL,
      decision TEXT NOT NULL,
      rationale TEXT NOT NULL DEFAULT '',
      evidence_json TEXT NOT NULL DEFAULT '[]',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT '',
      CHECK (memory_a_id <> memory_b_id),
      FOREIGN KEY (memory_a_id) REFERENCES memories(id) ON DELETE CASCADE,
      FOREIGN KEY (memory_b_id) REFERENCES memories(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS curator_questions (
      id TEXT PRIMARY KEY,
      memory_id TEXT,
      event_id TEXT,
      question TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open',
      answer TEXT NOT NULL DEFAULT '',
      priority INTEGER NOT NULL DEFAULT 0,
      evidence_json TEXT NOT NULL DEFAULT '[]',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT '',
      answered_at TEXT NOT NULL DEFAULT '',
      CHECK (memory_id IS NOT NULL OR event_id IS NOT NULL),
      FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE,
      FOREIGN KEY (event_id) REFERENCES memory_events(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_memories_hall ON memories(hall_id);
    CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at);
    CREATE INDEX IF NOT EXISTS idx_memory_people_name ON memory_people(name);
    CREATE INDEX IF NOT EXISTS idx_memory_tags_tag ON memory_tags(tag);
    CREATE INDEX IF NOT EXISTS idx_memory_emotions_emotion ON memory_emotions(emotion);
    CREATE INDEX IF NOT EXISTS idx_agent_runs_memory ON agent_runs(memory_id);
    CREATE INDEX IF NOT EXISTS idx_agent_events_run ON agent_events(run_id);
    CREATE INDEX IF NOT EXISTS idx_event_members_event ON event_members(event_id, position);
    CREATE INDEX IF NOT EXISTS idx_memory_claims_memory ON memory_claims(memory_id, position);
    CREATE INDEX IF NOT EXISTS idx_pair_decisions_a ON memory_pair_decisions(memory_a_id);
    CREATE INDEX IF NOT EXISTS idx_pair_decisions_b ON memory_pair_decisions(memory_b_id);
    CREATE INDEX IF NOT EXISTS idx_curator_questions_memory ON curator_questions(memory_id, status);
    CREATE INDEX IF NOT EXISTS idx_curator_questions_event ON curator_questions(event_id, status);
  `);

  ensureColumn("memories", "cover_image", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("memories", "media_note", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("memories", "attachments_json", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn("memories", "agent_run_id", "TEXT NOT NULL DEFAULT ''");

  let oralHistoryDatabase = null;
  let curatorAgentDatabase = null;
  let memoryInboxDatabase = null;
  let provenanceDatabase = null;
  let provenanceSourceCatalog = null;
  let coMemoryResponseDatabase = null;
  let museumLockDatabase = null;
  const mediaDatabase = initializeMediaDatabase({
    db,
    withTransaction,
    now: () => new Date().toISOString(),
    createId
  });
  const exhibitionDatabase = initializeExhibitionDatabase({
    db,
    withTransaction,
    schemaVersion,
    now: () => new Date().toISOString(),
    createId
  });
  const revisitDatabase = initializeRevisitDatabase({
    db,
    withTransaction,
    schemaVersion,
    now: () => new Date().toISOString()
  });
  const clueDatabase = initializeClueDatabase({
    db,
    withTransaction,
    schemaVersion,
    now: () => new Date().toISOString(),
    createId
  });
  const voiceDatabase = initializeVoiceDatabase({
    db,
    withTransaction,
    schemaVersion,
    now: () => new Date().toISOString(),
    createId,
    onConfirmedTranscriptChanged: (memoryId) => clueDatabase.syncMemoryClues(memoryId),
    getAdditionalAssetUsage: (assetId) => oralHistoryDatabase?.getOralVoiceAssetUsage(assetId) || 0
  });
  const capsuleDatabase = initializeCapsuleDatabase({
    db,
    withTransaction,
    schemaVersion,
    now: () => new Date().toISOString(),
    createId
  });
  const revisionDatabase = Number(schemaVersion) >= 10
    ? initializeRevisionDatabase({
        db,
        withTransaction,
        schemaVersion,
        now: () => new Date().toISOString(),
        createId
      })
    : null;
  const revisitIntentDatabase = Number(schemaVersion) >= 11
    ? initializeRevisitIntentDatabase({
        db,
        withTransaction,
        schemaVersion,
        now: () => new Date().toISOString()
      })
    : null;
  const timeCalibrationDatabase = Number(schemaVersion) >= 12
    ? initializeTimeCalibrationDatabase({
        db,
        withTransaction,
        schemaVersion,
        now: () => new Date().toISOString(),
        createId,
        listOralHistoryEvidence: (memoryIds) => oralHistoryDatabase?.listConfirmedOralHistoryEvidence(memoryIds) || []
      })
    : null;
  oralHistoryDatabase = Number(schemaVersion) >= 13
    ? initializeOralHistoryDatabase({
        db,
        withTransaction,
        schemaVersion,
        now: () => new Date().toISOString(),
        createId,
        getEventCalibrationWorkspace: (eventId) => timeCalibrationDatabase.getEventCalibrationWorkspace(eventId)
      })
    : null;
  curatorAgentDatabase = Number(schemaVersion) >= 14
    ? initializeCuratorAgentDatabase({
        db,
        withTransaction,
        schemaVersion,
        now: () => new Date().toISOString(),
        createId,
        searchMemorySummaries: ({ query, memoryIds = [], limit = 6 }) => {
          const selected = memoryIds.length
            ? memoryIds.map((id) => getMemory(id)).filter(Boolean)
            : searchMemories(query, { limit });
          return {
            memories: selected.slice(0, limit).map((memory) => ({
              ...memory,
              summary: String(memory.exhibitText || memory.rawContent || "").slice(0, 320)
            }))
          };
        },
        readMemoryEvidence: ({ memoryIds = [] }) => ({
          memories: memoryIds.map((id) => getMemory(id)).filter(Boolean),
          provenance: provenanceDatabase?.listConfirmedProvenanceForAgent(memoryIds) || {}
        }),
        readConfirmedRelationships: ({ memoryIds = [] }) => {
          const relationships = [];
          for (let left = 0; left < memoryIds.length; left += 1) {
            for (let right = left + 1; right < memoryIds.length; right += 1) {
              const decision = getPairDecision(memoryIds[left], memoryIds[right]);
              if (!decision || !["confirmed", "same_event", "related"].includes(String(decision.decision || ""))) continue;
              relationships.push({
                memoryAId: decision.memoryAId,
                memoryBId: decision.memoryBId,
                relationType: decision.decision,
                confirmedAt: decision.updatedAt || decision.createdAt || ""
              });
            }
          }
          return { relationships };
        },
        readExhibitionSummaries: ({ memoryIds = [] }) => ({
          exhibitions: exhibitionDatabase.listExhibitions().map((summary) => {
            const exhibition = exhibitionDatabase.getExhibition(summary.id);
            const sourceIds = exhibition?.sections?.flatMap((section) => (
              section.items?.map((item) => item.memoryId) || []
            )) || [];
            return { ...summary, memoryIds: sourceIds };
          }).filter((item) => item.memoryIds.some((id) => memoryIds.includes(id)))
        }),
        saveExhibitionDraft: (preview) => exhibitionDatabase.createExhibition({
          ...preview,
          status: "draft",
          confirm: true,
          confirmed: true
        }),
        confirmRelationship: (relation) => savePairDecision({
          memoryAId: relation.memoryAId,
          memoryBId: relation.memoryBId,
          decision: "related",
          rationale: relation.rationale,
          evidence: relation.basis ? [relation.basis] : [],
          metadata: {
            source: "curator-agent",
            runId: relation.runId,
            proposalSha256: relation.proposalSha256,
            relationType: relation.relationType
          }
        }),
        publishExhibition: (exhibitionId) => exhibitionDatabase.updateExhibition(exhibitionId, {
          status: "published",
          confirm: true,
          confirmed: true
        }),
        getMemory
      })
    : null;
  memoryInboxDatabase = Number(schemaVersion) >= 15
    ? initializeMemoryInboxDatabase({
        db,
        withTransaction,
        schemaVersion,
        now: () => new Date().toISOString(),
        createId,
        saveMemory: (memory, options) => saveMemory(memory, options),
        getMemory
      })
    : null;
  const postInboxMigrations = [
    PROVENANCE_MIGRATION,
    CO_MEMORY_RESPONSE_MIGRATION,
    PROVENANCE_CO_MEMORY_MIGRATION,
    MUSEUM_LOCK_MIGRATION
  ].filter((migration) => migration.version <= Number(schemaVersion));
  if (postInboxMigrations.length) {
    applyMigrations({
      db,
      baselineVersion: 4,
      migrations: postInboxMigrations,
      supportedVersion: Number(schemaVersion),
      now: () => new Date().toISOString()
    });
  }
  if (Number(schemaVersion) >= 16) {
    const catalogProxy = {
      listSources: (memoryId) => provenanceSourceCatalog?.listSources(memoryId) || [],
      resolveSource: (memoryId, selection) => provenanceSourceCatalog?.resolveSource(memoryId, selection) || {
        status: "missing",
        kind: String(selection?.kind || ""),
        referenceId: String(selection?.referenceId || ""),
        sourceKey: String(selection?.sourceKey || "")
      }
    };
    provenanceDatabase = initializeProvenanceDatabase({
      db,
      withTransaction,
      schemaVersion,
      applyMigrations: false,
      now: () => new Date().toISOString(),
      createId,
      sourceResolver: createStoredCatalogSourceResolver({ catalog: catalogProxy })
    });
  }
  coMemoryResponseDatabase = Number(schemaVersion) >= 17
    ? initializeCoMemoryResponseDatabase({
        db,
        withTransaction,
        schemaVersion,
        applyMigrations: false,
        now: () => new Date().toISOString(),
        createId
      })
    : null;
  museumLockDatabase = Number(schemaVersion) >= 19
    ? initializeMuseumLockDatabase({
        db,
        withTransaction,
        schemaVersion,
        applyMigrations: false,
        now: () => new Date().toISOString()
      })
    : null;
  if (Number(schemaVersion) >= 16) {
    provenanceSourceCatalog = createProvenanceSourceCatalog({
      store: {
        getMemory,
        getMemoryInboxReceiptForMemory: memoryInboxDatabase.getMemoryInboxReceiptForMemory,
        listMediaForMemory: mediaDatabase.listMediaForMemory,
        listMediaObservations: mediaDatabase.listMediaObservations,
        listVoiceForMemory: voiceDatabase.listVoiceForMemory,
        listConfirmedOralHistoryEvidence: oralHistoryDatabase?.listConfirmedOralHistoryEvidence || (() => []),
        listCoMemoryResponseSources: coMemoryResponseDatabase?.listCoMemoryResponseSources || (() => [])
      }
    });
  }
  const databaseHealth = createDatabaseHealthReader({
    db,
    schemaVersion,
    getTimeCalibrationHealthSnapshot: timeCalibrationDatabase?.getTimeCalibrationStats,
    getCuratorAgentHealthSnapshot: curatorAgentDatabase?.getCuratorAgentStats,
    getCuratorAgentBackup: curatorAgentDatabase?.buildCuratorAgentBackup,
    getMemoryInboxHealthSnapshot: memoryInboxDatabase?.getMemoryInboxStats,
    getMemoryInboxBackup: memoryInboxDatabase?.buildMemoryInboxBackup,
    getProvenanceHealthSnapshot: provenanceDatabase?.getProvenanceStats,
    getProvenanceBackup: provenanceDatabase?.buildProvenanceBackup,
    getCoMemoryResponseHealthSnapshot: coMemoryResponseDatabase?.getCoMemoryResponseStats,
    getCoMemoryResponseBackup: coMemoryResponseDatabase?.buildCoMemoryResponseBackup,
    getMuseumLockState: museumLockDatabase?.getMuseumLockState
  });

  const upsertHall = db.prepare(`
    INSERT INTO halls (id, name, description) VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description
  `);
  halls.forEach((hall) => upsertHall.run(hall.id, hall.name, hall.description || ""));

  const statements = {
    listMemories: db.prepare("SELECT * FROM memories ORDER BY datetime(created_at) DESC, title ASC"),
    getMemory: db.prepare("SELECT * FROM memories WHERE id = ?"),
    upsertMemory: db.prepare(`
      INSERT INTO memories (
        id, schema_version, title, hall_id, source_type, raw_content, exhibit_text,
        memory_date, location, emotion_intensity, importance, favorite, cover_image,
        media_note, attachments_json, agent_run_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        schema_version = excluded.schema_version,
        title = excluded.title,
        hall_id = excluded.hall_id,
        source_type = excluded.source_type,
        raw_content = excluded.raw_content,
        exhibit_text = excluded.exhibit_text,
        memory_date = excluded.memory_date,
        location = excluded.location,
        emotion_intensity = excluded.emotion_intensity,
        importance = excluded.importance,
        favorite = excluded.favorite,
        cover_image = excluded.cover_image,
        media_note = excluded.media_note,
        attachments_json = excluded.attachments_json,
        agent_run_id = excluded.agent_run_id,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
    `),
    deleteMemory: db.prepare("DELETE FROM memories WHERE id = ?"),
    deletePeople: db.prepare("DELETE FROM memory_people WHERE memory_id = ?"),
    deleteTags: db.prepare("DELETE FROM memory_tags WHERE memory_id = ?"),
    deleteEmotions: db.prepare("DELETE FROM memory_emotions WHERE memory_id = ?"),
    insertPerson: db.prepare("INSERT OR IGNORE INTO memory_people (memory_id, name) VALUES (?, ?)"),
    insertTag: db.prepare("INSERT OR IGNORE INTO memory_tags (memory_id, tag) VALUES (?, ?)"),
    insertEmotion: db.prepare("INSERT OR IGNORE INTO memory_emotions (memory_id, emotion) VALUES (?, ?)"),
    peopleFor: db.prepare("SELECT name FROM memory_people WHERE memory_id = ? ORDER BY name"),
    tagsFor: db.prepare("SELECT tag FROM memory_tags WHERE memory_id = ? ORDER BY tag"),
    emotionsFor: db.prepare("SELECT emotion FROM memory_emotions WHERE memory_id = ? ORDER BY emotion"),
    countMemories: db.prepare("SELECT COUNT(*) AS count FROM memories"),
    countAgentRuns: db.prepare("SELECT COUNT(*) AS count FROM agent_runs"),
    upsertAgentRun: db.prepare(`
      INSERT INTO agent_runs (
        id, phase, mode, status, raw_preview, summary_json, event_count, memory_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        phase = excluded.phase,
        mode = excluded.mode,
        status = excluded.status,
        raw_preview = excluded.raw_preview,
        summary_json = excluded.summary_json,
        event_count = excluded.event_count,
        memory_id = excluded.memory_id,
        updated_at = excluded.updated_at
    `),
    getAgentRun: db.prepare("SELECT * FROM agent_runs WHERE id = ?"),
    getAgentRunForMemory: db.prepare("SELECT * FROM agent_runs WHERE memory_id = ? ORDER BY datetime(created_at) DESC LIMIT 1"),
    updateAgentRunMemory: db.prepare("UPDATE agent_runs SET memory_id = ?, updated_at = ? WHERE id = ?"),
    updateMemoryAgentRun: db.prepare("UPDATE memories SET agent_run_id = ? WHERE id = ?"),
    deleteAgentRun: db.prepare("DELETE FROM agent_runs WHERE id = ?"),
    deleteAgentSteps: db.prepare("DELETE FROM agent_steps WHERE run_id = ?"),
    deleteAgentEvents: db.prepare("DELETE FROM agent_events WHERE run_id = ?"),
    insertAgentStep: db.prepare(`
      INSERT INTO agent_steps (run_id, step_id, position, agent, duty, status, output, evidence_json, actions_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    insertAgentEvent: db.prepare(`
      INSERT INTO agent_events (id, run_id, step_id, type, label, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `),
    stepsForRun: db.prepare("SELECT * FROM agent_steps WHERE run_id = ? ORDER BY position"),
    eventsForRun: db.prepare("SELECT * FROM agent_events WHERE run_id = ? ORDER BY datetime(created_at), id"),
    upsertMemoryEvent: db.prepare(`
      INSERT INTO memory_events (id, title, summary, status, metadata_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        summary = excluded.summary,
        status = excluded.status,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at
    `),
    getMemoryEvent: db.prepare("SELECT * FROM memory_events WHERE id = ?"),
    deleteMemoryEvent: db.prepare("DELETE FROM memory_events WHERE id = ?"),
    listMemoryEvents: db.prepare(`
      SELECT event.*, COUNT(member.memory_id) AS version_count
      FROM memory_events event
      LEFT JOIN event_members member ON member.event_id = event.id
      GROUP BY event.id
      ORDER BY datetime(event.updated_at) DESC, datetime(event.created_at) DESC, event.id
    `),
    getEventMemberForMemory: db.prepare("SELECT * FROM event_members WHERE memory_id = ?"),
    getEventMembers: db.prepare(`
      SELECT member.*, memory.title, memory.memory_date, memory.source_type,
        memory.raw_content, memory.exhibit_text, memory.created_at AS memory_created_at,
        memory.updated_at AS memory_updated_at
      FROM event_members member
      JOIN memories memory ON memory.id = member.memory_id
      WHERE member.event_id = ?
      ORDER BY member.position, datetime(memory.created_at), member.memory_id
    `),
    maxEventMemberPosition: db.prepare("SELECT COALESCE(MAX(position), -1) AS position FROM event_members WHERE event_id = ?"),
    insertEventMember: db.prepare(`
      INSERT INTO event_members (
        event_id, memory_id, position, relation, confirmation_note, confirmed_at, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(event_id, memory_id) DO UPDATE SET
        position = excluded.position,
        relation = excluded.relation,
        confirmation_note = excluded.confirmation_note,
        confirmed_at = excluded.confirmed_at,
        metadata_json = excluded.metadata_json
    `),
    deleteSmallMemoryEvents: db.prepare(`
      DELETE FROM memory_events
      WHERE id IN (
        SELECT event.id
        FROM memory_events event
        LEFT JOIN event_members member ON member.event_id = event.id
        GROUP BY event.id
        HAVING COUNT(member.memory_id) < 2
      )
    `),
    listSmallMemoryEvents: db.prepare(`
      SELECT event.id
      FROM memory_events event
      LEFT JOIN event_members member ON member.event_id = event.id
      GROUP BY event.id
      HAVING COUNT(member.memory_id) < 2
    `),
    detachSurvivingEventQuestions: db.prepare(`
      UPDATE curator_questions
      SET event_id = NULL, updated_at = ?
      WHERE event_id = ? AND memory_id IS NOT NULL
    `),
    archaeologyOverview: db.prepare(`
      SELECT memory.id AS memory_id, event.id AS event_id, event.title AS event_title,
        CASE WHEN event.id IS NULL THEN 0 ELSE 1 END AS event_count,
        CASE WHEN event.id IS NULL THEN 1 ELSE COUNT(sibling.memory_id) END AS version_count
      FROM memories memory
      LEFT JOIN event_members member ON member.memory_id = memory.id
      LEFT JOIN memory_events event ON event.id = member.event_id
      LEFT JOIN event_members sibling ON sibling.event_id = event.id
      GROUP BY memory.id, event.id
      ORDER BY datetime(memory.created_at) DESC, memory.id
    `),
    archaeologyOverviewForMemory: db.prepare(`
      SELECT memory.id AS memory_id, event.id AS event_id, event.title AS event_title,
        CASE WHEN event.id IS NULL THEN 0 ELSE 1 END AS event_count,
        CASE WHEN event.id IS NULL THEN 1 ELSE COUNT(sibling.memory_id) END AS version_count
      FROM memories memory
      LEFT JOIN event_members member ON member.memory_id = memory.id
      LEFT JOIN memory_events event ON event.id = member.event_id
      LEFT JOIN event_members sibling ON sibling.event_id = event.id
      WHERE memory.id = ?
      GROUP BY memory.id, event.id
    `),
    deleteMemoryClaims: db.prepare("DELETE FROM memory_claims WHERE memory_id = ?"),
    insertMemoryClaim: db.prepare(`
      INSERT INTO memory_claims (
        id, memory_id, position, claim_key, claim_type, value_json, quote_text,
        start_offset, end_offset, evidence_valid, confidence, status, payload_json,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    getMemoryClaims: db.prepare("SELECT * FROM memory_claims WHERE memory_id = ? ORDER BY position, id"),
    upsertPairDecision: db.prepare(`
      INSERT INTO memory_pair_decisions (
        pair_key, memory_a_id, memory_b_id, decision, rationale, evidence_json,
        metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(pair_key) DO UPDATE SET
        decision = excluded.decision,
        rationale = excluded.rationale,
        evidence_json = excluded.evidence_json,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at
    `),
    getPairDecision: db.prepare("SELECT * FROM memory_pair_decisions WHERE pair_key = ?"),
    deletePairDecision: db.prepare("DELETE FROM memory_pair_decisions WHERE pair_key = ?"),
    upsertCuratorQuestion: db.prepare(`
      INSERT INTO curator_questions (
        id, memory_id, event_id, question, reason, status, answer, priority,
        evidence_json, metadata_json, created_at, updated_at, answered_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        memory_id = excluded.memory_id,
        event_id = excluded.event_id,
        question = excluded.question,
        reason = excluded.reason,
        status = excluded.status,
        answer = excluded.answer,
        priority = excluded.priority,
        evidence_json = excluded.evidence_json,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at,
        answered_at = excluded.answered_at
    `),
    getCuratorQuestion: db.prepare("SELECT * FROM curator_questions WHERE id = ?"),
    listCuratorQuestions: db.prepare(`
      SELECT * FROM curator_questions
      ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, priority DESC, datetime(created_at) DESC, id
    `),
    countMemoryEvents: db.prepare("SELECT COUNT(*) AS count FROM memory_events")
  };

  function ensureColumn(tableName, columnName, definition) {
    const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
    if (!columns.some((column) => column.name === columnName)) {
      db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
    }
  }

  function listMemories() {
    return statements.listMemories.all().map(rowToMemory);
  }

  function getMemory(id) {
    const row = statements.getMemory.get(id);
    return row ? rowToMemory(row) : null;
  }

  function saveMemory(memory, options = {}) {
    const transaction = options.transaction !== false;
    const writeMemory = () => {
      const existing = getMemory(memory.id);
      if (options.requireExisting && !existing) {
        throw memoryWriteError("没有找到这件展品。", "MEMORY_NOT_FOUND", 404);
      }
      if (options.requireNew && existing) {
        throw memoryWriteError("这条记忆已经存在。", "MEMORY_ALREADY_EXISTS", 409);
      }
      if (existing && options.expectedUpdatedAt !== undefined) {
        assertExpectedMemoryVersion(existing, options.expectedUpdatedAt);
      }

      if (!existing) {
        const timestamp = normalizeStoredTimestamp(memory.updatedAt || memory.createdAt);
        const created = { ...memory, updatedAt: timestamp };
        saveMemoryRow(created, options);
        const saved = getMemory(created.id);
        revisionDatabase?.recordMemoryCreation(saved, {
          changeKind: options.changeKind === "imported" ? "imported" : "created",
          changeNote: normalizeRevisionNote(options.changeNote)
        });
        return getMemory(created.id);
      }

      const next = {
        ...memory,
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: nextMemoryUpdatedAt(existing.updatedAt)
      };
      const transition = revisionDatabase?.recordMemoryTransition(existing, next, {
        changeKind: options.changeKind === "restored" ? "restored" : "edited",
        changeNote: normalizeRevisionNote(options.changeNote),
        restoredFromRevisionId: options.restoredFromRevisionId
      });
      if (revisionDatabase && !transition.changed) {
        if ((next.agentRunId || "") !== (existing.agentRunId || "")) {
          saveMemoryRow(next, options);
        }
        return getMemory(existing.id);
      }
      saveMemoryRow(next, options);
      return getMemory(next.id);
    };
    return transaction ? withTransaction(writeMemory) : writeMemory();
  }

  function importMemories(memories, options = {}) {
    return withTransaction(() => {
      memories.forEach((memory) => {
        const timestamp = normalizeStoredTimestamp(memory.updatedAt || memory.createdAt);
        const imported = { ...memory, updatedAt: timestamp };
        saveMemoryRow(imported, options);
        if (revisionDatabase && options.revisionMode !== "defer") {
          revisionDatabase.recordMemoryCreation(getMemory(imported.id), {
            changeKind: "imported",
            changeNote: normalizeRevisionNote(options.changeNote)
          });
        }
      });
      return { imported: memories.length, memories: listMemories() };
    });
  }

  function listRecentMemoryRevisions(options = {}) {
    if (!revisionDatabase) return [];
    const limit = Math.min(100, Math.max(1, Number(options.limit) || 30));
    return revisionDatabase.listRecentMemoryRevisions({ limit });
  }

  function runDatabaseHealthChecks(options = {}) {
    options.signal?.throwIfAborted?.();
    const snapshot = databaseHealth.snapshot();
    if (!revisionDatabase) return snapshot;
    let revisionOk = true;
    try {
      const memories = listMemories();
      const memoryIds = memories.map((memory) => memory.id);
      const backup = revisionDatabase.buildRevisionBackup("full", memoryIds);
      revisionDatabase.validateRevisionBackup(backup, memoryIds);
      revisionOk = memories.every((memory) => revisionDatabase.verifyMemoryHead(memory).matches);
    } catch {
      revisionOk = false;
    }
    snapshot.checks.push({ code: "DATABASE_REVISION_CHAIN", ok: revisionOk });
    snapshot.ok = snapshot.ok && revisionOk;
    options.signal?.throwIfAborted?.();
    return snapshot;
  }

  function restoreMemoryRevision(memoryId, revisionId, options = {}) {
    if (!revisionDatabase) throw memoryWriteError("当前数据库尚未启用记忆年轮。", "REVISION_SCHEMA_NOT_READY", 409);
    return withTransaction(() => {
      const existing = getMemory(String(memoryId || ""));
      if (!existing) throw memoryWriteError("没有找到这件展品。", "MEMORY_NOT_FOUND", 404);
      assertExpectedMemoryVersion(existing, options.expectedUpdatedAt);
      const source = revisionDatabase.getMemoryRevision(existing.id, String(revisionId || ""));
      if (!source) throw memoryWriteError("没有找到要恢复的历史版本。", "REVISION_NOT_FOUND", 404);
      const beforeHead = revisionDatabase.getMemoryRevisionHead(existing.id);
      const next = {
        ...existing,
        ...source.snapshot,
        id: existing.id,
        schemaVersion,
        agentRunId: existing.agentRunId,
        createdAt: existing.createdAt
      };
      const memory = saveMemory(next, {
        transaction: false,
        expectedUpdatedAt: existing.updatedAt,
        changeKind: "restored",
        restoredFromRevisionId: source.id,
        changeNote: options.changeNote || `恢复到第 ${source.revisionNo} 版`
      });
      const head = revisionDatabase.getMemoryRevisionHead(existing.id);
      return {
        changed: Boolean(head && head.id !== beforeHead?.id),
        memory,
        revision: head
      };
    });
  }

  function deleteMemory(id) {
    const memory = getMemory(id);
    if (!memory) return false;
    return withTransaction(() => {
      curatorAgentDatabase?.purgeCuratorAgentRunsForMemory?.(id);
      memoryInboxDatabase?.detachMemoryInboxAdmission?.(id);
      clueDatabase.removeMemoryClues(id);
      const result = statements.deleteMemory.run(id);
      if (memory.agentRunId) statements.deleteAgentRun.run(memory.agentRunId);
      const now = new Date().toISOString();
      statements.listSmallMemoryEvents.all().forEach((event) => (
        statements.detachSurvivingEventQuestions.run(now, event.id)
      ));
      statements.deleteSmallMemoryEvents.run();
      return result.changes > 0;
    });
  }

  function deleteExhibition(id) {
    return withTransaction(() => {
      const removed = exhibitionDatabase.deleteExhibition(id);
      if (removed) curatorAgentDatabase?.purgeCuratorAgentRunsForExhibition?.(id);
      return removed;
    });
  }

  function purgeAll() {
    const memoriesDeleted = Number(statements.countMemories.get()?.count) || 0;
    const agentRunsDeleted = Number(statements.countAgentRuns.get()?.count) || 0;
    const memoryEventsDeleted = Number(statements.countMemoryEvents.get()?.count) || 0;
    return withTransaction(() => {
      const curatorAgentCleanup = curatorAgentDatabase?.clearCuratorAgentRuns() || {
        runsDeleted: 0
      };
      const memoryInboxCleanup = memoryInboxDatabase?.clearMemoryInbox() || {
        memoryInboxItemsDeleted: 0,
        memoryInboxSourcesDeleted: 0
      };
      const provenanceCleanup = provenanceDatabase?.clearProvenanceClaims() || {
        claimsDeleted: 0,
        sourcesDeleted: 0,
        eventsDeleted: 0
      };
      const coMemoryCleanup = coMemoryResponseDatabase?.clearCoMemoryResponses?.() || {
        coMemoryResponsesDeleted: 0
      };
      const capsuleCleanup = capsuleDatabase.clearCapsules();
      const oralHistoryCleanup = oralHistoryDatabase?.clearOralHistories() || {
        oralHistoryQuestionsDeleted: 0,
        oralHistoryAnswersDeleted: 0
      };
      const voiceCleanup = voiceDatabase.clearVoiceData();
      const clueCleanup = clueDatabase.clearClues();
      const revisitStatesDeleted = revisitDatabase.clearRevisitStates().revisitStatesDeleted;
      const revisitIntentsDeleted = revisitIntentDatabase?.clearRevisitIntents().revisitIntentsDeleted || 0;
      const timeCalibrationsDeleted = timeCalibrationDatabase?.clearTimeCalibrations().calibrationsDeleted || 0;
      const exhibitionsDeleted = exhibitionDatabase.clearExhibitions().exhibitionsDeleted;
      db.exec(`
        DELETE FROM media_observations;
        DELETE FROM memory_media;
        DELETE FROM media_variants;
        DELETE FROM media_assets;
        DELETE FROM curator_questions;
        DELETE FROM memory_pair_decisions;
        DELETE FROM memory_claims;
        DELETE FROM event_members;
        DELETE FROM memory_events;
        DELETE FROM memory_people;
        DELETE FROM memory_tags;
        DELETE FROM memory_emotions;
        DELETE FROM agent_events;
        DELETE FROM agent_steps;
        DELETE FROM agent_runs;
        DELETE FROM memories;
      `);
      return { memoriesDeleted, agentRunsDeleted, memoryEventsDeleted, exhibitionsDeleted, revisitStatesDeleted, revisitIntentsDeleted, timeCalibrationsDeleted, ...memoryInboxCleanup, ...provenanceCleanup, ...coMemoryCleanup, ...curatorAgentCleanup, ...capsuleCleanup, ...oralHistoryCleanup, ...clueCleanup, ...voiceCleanup };
    });
  }

  function saveAgentRun(workflow, context = {}) {
    const run = normalizeAgentRun(workflow, context);
    return withTransaction(() => {
      statements.upsertAgentRun.run(
        run.id,
        run.phase,
        run.mode,
        run.status,
        run.rawPreview,
        JSON.stringify(run.summary),
        run.events.length,
        run.memoryId,
        run.createdAt,
        run.updatedAt
      );
      statements.deleteAgentSteps.run(run.id);
      run.steps.forEach((step, index) => statements.insertAgentStep.run(
        run.id,
        step.id,
        index,
        step.agent,
        step.duty,
        step.status,
        step.output,
        JSON.stringify(step.evidence),
        JSON.stringify(step.actions)
      ));
      statements.deleteAgentEvents.run(run.id);
      run.events.forEach((event) => statements.insertAgentEvent.run(
        event.id,
        run.id,
        event.step,
        event.type,
        event.label,
        JSON.stringify(event.payload),
        event.at
      ));
      return getAgentRun(run.id);
    });
  }

  function getAgentRun(id) {
    const row = statements.getAgentRun.get(id);
    return row ? rowToAgentRun(row) : null;
  }

  function getAgentRunForMemory(memoryId) {
    const row = statements.getAgentRunForMemory.get(memoryId);
    return row ? rowToAgentRun(row) : null;
  }

  function attachAgentRunToMemory(runId, memoryId) {
    if (!runId || !memoryId || !getAgentRun(runId) || !getMemory(memoryId)) return null;
    const now = new Date().toISOString();
    return withTransaction(() => {
      statements.updateAgentRunMemory.run(memoryId, now, runId);
      statements.updateMemoryAgentRun.run(runId, memoryId);
      return getAgentRun(runId);
    });
  }

  function createOrExtendMemoryEvent(input = {}, transactionToken) {
    if (!isPlainObject(input)) throw new TypeError("Memory event input must be an object.");

    const memberInputs = Array.isArray(input.members) ? input.members : [];
    const requestedMemoryIds = uniqueStrings([
      ...(Array.isArray(input.memoryIds) ? input.memoryIds : []),
      ...memberInputs.map((member) => isPlainObject(member) ? member.memoryId || member.id : member)
    ]);
    if (!requestedMemoryIds.length) throw new Error("At least one memoryId is required.");

    const memories = requestedMemoryIds.map((memoryId) => {
      const memory = getMemory(memoryId);
      if (!memory) throw new Error(`Memory not found: ${memoryId}`);
      return memory;
    });
    const memberships = requestedMemoryIds
      .map((memoryId) => statements.getEventMemberForMemory.get(memoryId))
      .filter(Boolean);
    const occupiedEventIds = [...new Set(memberships.map((member) => member.event_id))];

    const rawEventId = String(input.eventId || input.id || "").trim();
    const requestedEventId = rawEventId ? sanitizeId(rawEventId) : "";
    if (rawEventId && !requestedEventId) throw new Error("Invalid memory event id.");
    if (occupiedEventIds.length > 1) {
      throw new Error("The selected memories already belong to different memory events.");
    }

    const eventId = requestedEventId || occupiedEventIds[0] || createId("event");
    if (occupiedEventIds.length && occupiedEventIds[0] !== eventId) {
      throw new Error("A memory can belong to only one memory event.");
    }

    const existingRow = statements.getMemoryEvent.get(eventId);
    const existingEvent = existingRow ? rowToMemoryEvent(existingRow) : null;
    const newMemberIds = requestedMemoryIds.filter((memoryId) => (
      !statements.getEventMemberForMemory.get(memoryId)
    ));
    const existingVersionCount = existingEvent ? existingEvent.versionCount : 0;
    if (existingVersionCount + newMemberIds.length < 2) {
      throw new Error("A new memory event requires at least two confirmed memory versions.");
    }

    const now = new Date().toISOString();
    const title = String(
      input.title !== undefined
        ? input.title
        : existingEvent?.title || `关于「${memories[0].title}」的时光拼图`
    ).trim().slice(0, 160);
    const summary = String(
      input.summary !== undefined ? input.summary : existingEvent?.summary || ""
    ).trim().slice(0, 1200);
    const status = existingEvent?.status || "confirmed";
    const eventMetadata = {
      ...(existingEvent?.metadata || {}),
      ...toJsonObject(input.metadata)
    };
    if (!eventMetadata.confirmationSource) eventMetadata.confirmationSource = "user";
    if (input.confirmedBy) eventMetadata.confirmedBy = String(input.confirmedBy).slice(0, 120);

    function writeMemoryEvent() {
      statements.upsertMemoryEvent.run(
        eventId,
        title,
        summary,
        status,
        stringifyJson(eventMetadata, "{}"),
        existingEvent?.createdAt || normalizeTimestamp(input.createdAt, now),
        now
      );

      let nextPosition = Number(statements.maxEventMemberPosition.get(eventId)?.position ?? -1) + 1;
      for (const memoryId of requestedMemoryIds) {
        const currentMember = statements.getEventMemberForMemory.get(memoryId);
        const providedMemberInput = memberInputs.find((member) => (
          isPlainObject(member) && String(member.memoryId || member.id || "") === memoryId
        ));
        const memberInput = providedMemberInput || {};
        const hasMemberUpdate = !currentMember || Boolean(providedMemberInput) ||
          input.relation !== undefined || input.confirmationNote !== undefined ||
          input.confirmedAt !== undefined || input.confirmedBy !== undefined;
        if (!hasMemberUpdate) continue;
        const memberMetadata = {
          ...toJsonObject(currentMember?.metadata_json),
          ...toJsonObject(memberInput.metadata)
        };
        if (input.confirmedBy && !memberMetadata.confirmedBy) {
          memberMetadata.confirmedBy = String(input.confirmedBy).slice(0, 120);
        }
        statements.insertEventMember.run(
          eventId,
          memoryId,
          currentMember ? Number(currentMember.position) || 0 : nextPosition,
          String(memberInput.relation ?? input.relation ?? currentMember?.relation ?? "version").slice(0, 60),
          String(
            memberInput.confirmationNote ?? input.confirmationNote ?? currentMember?.confirmation_note ?? ""
          ).slice(0, 800),
          normalizeTimestamp(
            memberInput.confirmedAt ?? input.confirmedAt ?? currentMember?.confirmed_at,
            now
          ),
          stringifyJson(memberMetadata, "{}")
        );
        if (!currentMember) nextPosition += 1;
      }
      return getMemoryEvent(eventId);
    }

    if (transactionToken === internalTransaction) return writeMemoryEvent();
    return withTransaction(writeMemoryEvent);
  }

  function getMemoryEvent(eventId) {
    const row = statements.getMemoryEvent.get(String(eventId || ""));
    return row ? rowToMemoryEvent(row) : null;
  }

  function getMemoryEventForMemory(memoryId) {
    const member = statements.getEventMemberForMemory.get(String(memoryId || ""));
    return member ? getMemoryEvent(member.event_id) : null;
  }

  function deleteMemoryEvent(eventId) {
    const event = getMemoryEvent(String(eventId || ""));
    if (!event) return null;
    const memoryIds = event.members.map((member) => member.memoryId);
    const pairKeys = memoryIds.flatMap((leftId, index) => (
      memoryIds.slice(index + 1).map((rightId) => normalizeMemoryPair(leftId, rightId).pairKey)
    ));
    const now = new Date().toISOString();
    return withTransaction(() => {
      statements.detachSurvivingEventQuestions.run(now, event.id);
      memoryIds.forEach((memoryId) => statements.deleteMemoryClaims.run(memoryId));
      pairKeys.forEach((pairKey) => statements.deletePairDecision.run(pairKey));
      statements.deleteMemoryEvent.run(event.id);
      return { id: event.id, memoryIds };
    });
  }

  function listMemoryEvents(options = {}) {
    const events = statements.listMemoryEvents.all().map(rowToMemoryEvent);
    const limit = Number(options?.limit);
    return Number.isInteger(limit) && limit >= 0 ? events.slice(0, limit) : events;
  }

  function getArchaeologyOverview(memoryId = "") {
    const requestedId = String(memoryId || "").trim();
    const rows = requestedId
      ? statements.archaeologyOverviewForMemory.all(requestedId)
      : statements.archaeologyOverview.all();
    return rows.map((row) => ({
      memoryId: row.memory_id,
      eventId: row.event_id || "",
      eventTitle: row.event_title || "",
      eventCount: Number(row.event_count) || 0,
      versionCount: Number(row.version_count) || 1
    }));
  }

  function replaceMemoryClaims(memoryId, claims = [], transactionToken) {
    const memory = getMemory(String(memoryId || ""));
    if (!memory) throw new Error(`Memory not found: ${memoryId}`);
    if (!Array.isArray(claims)) throw new TypeError("claims must be an array.");

    const now = new Date().toISOString();
    const normalizedClaims = claims.map((claim, index) => normalizeMemoryClaim(memory, claim, index, now));
    function writeMemoryClaims() {
      statements.deleteMemoryClaims.run(memory.id);
      normalizedClaims.forEach((claim) => statements.insertMemoryClaim.run(
        claim.id,
        memory.id,
        claim.position,
        claim.claimKey,
        claim.type,
        stringifyJson(claim.value, "null"),
        claim.quote,
        claim.startOffset,
        claim.endOffset,
        claim.evidenceValid ? 1 : 0,
        claim.confidence,
        claim.status,
        stringifyJson(claim.payload, "{}"),
        claim.createdAt,
        claim.updatedAt
      ));
      return getMemoryClaims(memory.id);
    }

    if (transactionToken === internalTransaction) return writeMemoryClaims();
    return withTransaction(writeMemoryClaims);
  }

  function getMemoryClaims(memoryId) {
    return statements.getMemoryClaims.all(String(memoryId || "")).map(rowToMemoryClaim);
  }

  function saveArchaeologyConfirmation(input = {}) {
    if (!isPlainObject(input)) throw new TypeError("Archaeology confirmation input must be an object.");
    if (!isPlainObject(input.event)) throw new Error("event is required.");
    const requestedDecisions = Array.isArray(input.pairDecisions)
      ? input.pairDecisions.filter(isPlainObject)
      : isPlainObject(input.pairDecision) ? [input.pairDecision] : [];
    if (!requestedDecisions.length) throw new Error("pairDecision is required.");

    const claimEntries = normalizeClaimsByMemory(input.claimsByMemory);
    const eventMemoryIds = uniqueStrings([
      ...(Array.isArray(input.event.memoryIds) ? input.event.memoryIds : []),
      ...(Array.isArray(input.event.members)
        ? input.event.members.map((member) => isPlainObject(member) ? member.memoryId || member.id : member)
        : [])
    ]);
    const pairInputs = requestedDecisions.map((decision, index) => ({
      ...decision,
      memoryAId: decision.memoryAId || decision.leftMemoryId || eventMemoryIds[index] || eventMemoryIds[0],
      memoryBId: decision.memoryBId || decision.rightMemoryId || eventMemoryIds[index + 1] || eventMemoryIds[1]
    }));

    return withTransaction(() => {
      const event = createOrExtendMemoryEvent(input.event, internalTransaction);
      const decisions = pairInputs.map((pairInput) => savePairDecision({
        ...pairInput,
        metadata: {
          ...toJsonObject(pairInput.metadata),
          eventId: event.id
        }
      }));
      const savedClaimEntries = [];
      for (const [memoryId, claims] of claimEntries) {
        savedClaimEntries.push([
          memoryId,
          replaceMemoryClaims(memoryId, claims, internalTransaction)
        ]);
      }
      const saved = {
        event: getMemoryEvent(event.id),
        decision: decisions[0],
        decisions,
        claimsByMemory: Object.fromEntries(savedClaimEntries)
      };
      return saved;
    });
  }

  function savePairDecision(memoryAId, memoryBId, decisionOrDetails = {}, options = {}) {
    let input;
    if (isPlainObject(memoryAId)) {
      input = memoryAId;
    } else if (isPlainObject(decisionOrDetails)) {
      input = { ...decisionOrDetails, ...options, memoryAId, memoryBId };
    } else {
      input = { ...options, memoryAId, memoryBId, decision: decisionOrDetails };
    }

    const pair = normalizeMemoryPair(
      input.memoryAId || input.leftMemoryId,
      input.memoryBId || input.rightMemoryId
    );
    if (!getMemory(pair.memoryAId)) throw new Error(`Memory not found: ${pair.memoryAId}`);
    if (!getMemory(pair.memoryBId)) throw new Error(`Memory not found: ${pair.memoryBId}`);

    const existingRow = statements.getPairDecision.get(pair.pairKey);
    const existing = existingRow ? rowToPairDecision(existingRow) : null;
    const now = new Date().toISOString();
    const decision = String(input.decision || input.status || "pending").trim().slice(0, 40) || "pending";
    statements.upsertPairDecision.run(
      pair.pairKey,
      pair.memoryAId,
      pair.memoryBId,
      decision,
      String(input.rationale ?? input.reason ?? existing?.rationale ?? "").slice(0, 1600),
      stringifyJson(Array.isArray(input.evidence) ? input.evidence : existing?.evidence || [], "[]"),
      stringifyJson({
        ...(existing?.metadata || {}),
        ...toJsonObject(input.metadata)
      }, "{}"),
      existing?.createdAt || normalizeTimestamp(input.createdAt, now),
      now
    );
    return getPairDecision(pair.memoryAId, pair.memoryBId);
  }

  function getPairDecision(memoryAId, memoryBId) {
    const input = isPlainObject(memoryAId)
      ? memoryAId
      : { memoryAId, memoryBId };
    const firstId = input.memoryAId || input.leftMemoryId;
    const secondId = input.memoryBId || input.rightMemoryId;
    if (!firstId || !secondId || String(firstId) === String(secondId)) return null;
    const pair = normalizeMemoryPair(firstId, secondId);
    const row = statements.getPairDecision.get(pair.pairKey);
    return row ? rowToPairDecision(row) : null;
  }

  function saveCuratorQuestion(input = {}, details = {}) {
    if (typeof input === "string") input = { ...details, memoryId: input };
    if (!isPlainObject(input)) throw new TypeError("Curator question input must be an object.");

    const rawId = String(input.id || "").trim();
    const id = rawId ? sanitizeId(rawId) : createId("question");
    if (!id) throw new Error("Invalid curator question id.");
    const existingRow = statements.getCuratorQuestion.get(id);
    const existing = existingRow ? rowToCuratorQuestion(existingRow) : null;
    const memoryId = input.memoryId !== undefined
      ? String(input.memoryId || "").trim()
      : existing?.memoryId || "";
    const eventId = input.eventId !== undefined
      ? String(input.eventId || "").trim()
      : existing?.eventId || "";
    if (!memoryId && !eventId) throw new Error("A curator question requires a memoryId or eventId.");
    if (memoryId && !getMemory(memoryId)) throw new Error(`Memory not found: ${memoryId}`);
    if (eventId && !getMemoryEvent(eventId)) throw new Error(`Memory event not found: ${eventId}`);
    if (memoryId && eventId) {
      const memoryEvent = getMemoryEventForMemory(memoryId);
      if (!memoryEvent || memoryEvent.id !== eventId) {
        throw new Error("The memory is not a member of the selected memory event.");
      }
    }

    const now = new Date().toISOString();
    const question = String(input.question !== undefined ? input.question : existing?.question || "").trim();
    if (!question) throw new Error("question is required.");
    const status = String(input.status !== undefined ? input.status : existing?.status || "open").slice(0, 40);
    const isAnswered = status === "answered";
    const answer = String(
      input.answer !== undefined ? input.answer : isAnswered ? existing?.answer || "" : ""
    ).slice(0, 4000);
    const answeredAt = !isAnswered || !answer
      ? ""
      : input.answeredAt !== undefined
        ? normalizeTimestamp(input.answeredAt, "")
        : existing?.answeredAt || now;
    statements.upsertCuratorQuestion.run(
      id,
      memoryId || null,
      eventId || null,
      question.slice(0, 1200),
      String(input.reason !== undefined ? input.reason : existing?.reason || "").slice(0, 1600),
      status || "open",
      answer,
      normalizeInteger(input.priority, existing?.priority || 0),
      stringifyJson(
        Array.isArray(input.evidence) ? input.evidence : existing?.evidence || [],
        "[]"
      ),
      stringifyJson({
        ...(existing?.metadata || {}),
        ...toJsonObject(input.metadata)
      }, "{}"),
      existing?.createdAt || normalizeTimestamp(input.createdAt, now),
      now,
      answeredAt
    );
    return rowToCuratorQuestion(statements.getCuratorQuestion.get(id));
  }

  function listCuratorQuestions(filters = {}) {
    if (typeof filters === "string") filters = { memoryId: filters };
    const input = isPlainObject(filters) ? filters : {};
    let questions = statements.listCuratorQuestions.all().map(rowToCuratorQuestion);
    if (input.memoryId) questions = questions.filter((item) => item.memoryId === String(input.memoryId));
    if (input.eventId) questions = questions.filter((item) => item.eventId === String(input.eventId));
    if (input.status) questions = questions.filter((item) => item.status === String(input.status));
    const limit = Number(input.limit);
    return Number.isInteger(limit) && limit >= 0 ? questions.slice(0, limit) : questions;
  }

  function getStats() {
    const memories = listMemories();
    const clueStats = clueDatabase.getClueStats();
    const voiceStats = voiceDatabase.getVoiceStats();
    const capsuleStats = capsuleDatabase.getCapsuleStats();
    const timeCalibrationStats = timeCalibrationDatabase?.getTimeCalibrationStats?.() || { calibrations: 0, needsReview: 0 };
    const oralHistoryStats = oralHistoryDatabase?.getOralHistoryStats?.() || { questions: 0, answers: 0, confirmed: 0 };
    const curatorAgentStats = curatorAgentDatabase?.getCuratorAgentStats?.() || {
      runs: 0,
      completed: 0,
      interrupted: 0,
      needsReview: 0,
      historical: 0,
      steps: 0,
      proposals: 0,
      decisions: 0
    };
    const memoryInboxStats = memoryInboxDatabase?.getMemoryInboxStats?.() || {
      sources: 0,
      items: 0,
      pending: 0,
      dismissed: 0,
      accepted: 0,
      orphaned: 0,
      needsReview: 0
    };
    const provenanceStats = provenanceDatabase?.getProvenanceStats?.() || {
      claims: 0,
      sources: 0,
      events: 0,
      draft: 0,
      confirmed: 0,
      needsReview: 0,
      withdrawn: 0
    };
    const coMemoryStats = coMemoryResponseDatabase?.getCoMemoryResponseStats?.() || {
      responses: 0,
      memories: 0,
      unverifiedIdentity: 0,
      encryptedTransport: 0,
      unsigned: 0
    };
    return {
      memories: memories.length,
      halls: new Set(memories.map((memory) => memory.hall)).size,
      tags: new Set(memories.flatMap((memory) => memory.tags)).size,
      emotions: new Set(memories.flatMap((memory) => memory.emotions)).size,
      people: new Set(memories.flatMap((memory) => memory.people)).size,
      favorites: memories.filter((memory) => memory.favorite).length,
      agentRuns: Number(statements.countAgentRuns.get()?.count) || 0,
      exhibitions: exhibitionDatabase.getExhibitionStats().exhibitions,
      revisitStates: revisitDatabase.getRevisitStats().states,
      revisitIntents: revisitIntentDatabase?.getRevisitIntentStats().intents || 0,
      timeCalibrations: timeCalibrationStats.calibrations || 0,
      timeCalibrationsNeedsReview: timeCalibrationStats.needsReview || 0,
      entities: clueStats.entities,
      entityAliases: clueStats.aliases,
      searchDocuments: clueStats.searchDocuments,
      voiceAssets: voiceStats.assets,
      voiceLinks: voiceStats.memoryLinks,
      voiceTranscripts: voiceStats.transcripts,
      confirmedVoiceTranscripts: voiceStats.confirmedTranscripts,
      oralHistoryQuestions: oralHistoryStats.questions,
      oralHistoryAnswers: oralHistoryStats.answers,
      confirmedOralHistoryAnswers: oralHistoryStats.confirmed,
      curatorAgentRuns: curatorAgentStats.runs,
      curatorAgentCompletedRuns: curatorAgentStats.completed,
      curatorAgentInterruptedRuns: curatorAgentStats.interrupted,
      curatorAgentProposals: curatorAgentStats.proposals,
      curatorAgentDecisions: curatorAgentStats.decisions,
      memoryInboxSources: memoryInboxStats.sources,
      memoryInboxItems: memoryInboxStats.items,
      memoryInboxPending: memoryInboxStats.pending,
      memoryInboxAccepted: memoryInboxStats.accepted,
      memoryInboxNeedsReview: memoryInboxStats.needsReview,
      provenanceClaims: provenanceStats.claims,
      provenanceSources: provenanceStats.sources,
      provenanceEvents: provenanceStats.events,
      provenanceConfirmed: provenanceStats.confirmed,
      provenanceNeedsReview: provenanceStats.needsReview,
      coMemoryResponses: coMemoryStats.responses,
      coMemoryUnverifiedIdentity: coMemoryStats.unverifiedIdentity,
      capsules: capsuleStats.capsules,
      capsuleMediaLinks: capsuleStats.mediaLinks
    };
  }

  function searchClues(query, options = {}) {
    const limit = Math.min(50, Math.max(1, Number(options.limit) || 12));
    const mode = ["keyword", "semantic", "hybrid"].includes(options.mode) ? options.mode : "hybrid";
    const keywordTerms = buildSearchTerms(query);
    const semanticTerms = mode === "keyword" ? [] : buildSemanticTerms(keywordTerms, query);
    const response = clueDatabase.searchClues(keywordTerms.join(" "), {
      limit,
      ruleExpansions: semanticTerms
    });
    return {
      ...response,
      originalQuery: String(query || ""),
      results: response.results.map((item) => ({
        ...item,
        memory: getMemory(item.memoryId) || item.memory,
        entityRefs: clueDatabase.getMemoryEntityRefs(item.memoryId)
      }))
    };
  }

  function searchMemories(query, options = {}) {
    const response = searchClues(query, options);
    return options.includeMeta ? response.results : response.results.map((item) => item.memory);
  }

  function saveMemoryRow(memory, options = {}) {
    statements.upsertMemory.run(
      memory.id,
      memory.schemaVersion || schemaVersion,
      memory.title,
      memory.hall,
      memory.sourceType,
      memory.rawContent,
      memory.exhibitText,
      memory.date || "",
      memory.location || "",
      memory.emotionIntensity,
      memory.importance,
      memory.favorite ? 1 : 0,
      memory.coverImage || "",
      memory.mediaNote || "",
      JSON.stringify(memory.attachments || []),
      memory.agentRunId || "",
      memory.createdAt,
      memory.updatedAt || ""
    );
    replaceRelated(memory.id, statements.deletePeople, statements.insertPerson, memory.people || []);
    replaceRelated(memory.id, statements.deleteTags, statements.insertTag, memory.tags || []);
    replaceRelated(memory.id, statements.deleteEmotions, statements.insertEmotion, memory.emotions || []);
    revalidateMemoryClaims(memory.id);
    exhibitionDatabase.revalidateCitationsForMemory(memory.id);
    if (!['defer', 'none'].includes(options.clueMode)) clueDatabase.syncMemoryClues(memory.id);
  }

  function revalidateMemoryClaims(memoryId) {
    const claims = getMemoryClaims(memoryId);
    if (!claims.length) return;
    const memory = getMemory(memoryId);
    const revised = claims.map((claim) => {
      const quote = String(claim.quote || "");
      const evidenceStillExists = Boolean(quote) && String(memory.rawContent || "").includes(quote);
      return {
        ...claim,
        status: evidenceStillExists
          ? claim.status === "source_invalidated" ? "source_verified" : claim.status
          : "source_invalidated"
      };
    });
    replaceMemoryClaims(memoryId, revised, internalTransaction);
  }

  function replaceRelated(memoryId, clearStatement, insertStatement, values) {
    clearStatement.run(memoryId);
    [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))]
      .forEach((value) => insertStatement.run(memoryId, value));
  }

  function rowToMemory(row) {
    return {
      schemaVersion: row.schema_version,
      id: row.id,
      title: row.title,
      hall: row.hall_id,
      sourceType: row.source_type,
      rawContent: row.raw_content,
      exhibitText: row.exhibit_text,
      date: row.memory_date || "",
      location: row.location || "",
      people: statements.peopleFor.all(row.id).map((item) => item.name),
      tags: statements.tagsFor.all(row.id).map((item) => item.tag),
      emotions: statements.emotionsFor.all(row.id).map((item) => item.emotion),
      emotionIntensity: row.emotion_intensity,
      importance: row.importance,
      favorite: Boolean(row.favorite),
      coverImage: row.cover_image || "",
      mediaNote: row.media_note || "",
      attachments: parseJson(row.attachments_json, []),
      agentRunId: row.agent_run_id || "",
      createdAt: row.created_at,
      updatedAt: row.updated_at || ""
    };
  }

  function normalizeAgentRun(workflow = {}, context = {}) {
    const now = new Date().toISOString();
    const input = workflow.run || {};
    const id = sanitizeId(input.id || workflow.runId) || `run-${Date.now()}`;
    const steps = Array.isArray(workflow.steps) ? workflow.steps : [];
    const sourceEvents = Array.isArray(input.events) && input.events.length
      ? input.events
      : [{ type: "created", label: "Agent 工作流已创建", at: now }];
    return {
      id,
      phase: Number(input.phase || workflow.phase || 1) || 1,
      mode: String(input.mode || workflow.mode || context.mode || "mock").slice(0, 40),
      status: String(workflow.summary?.status || "created").slice(0, 40),
      rawPreview: String(context.rawContent || "").slice(0, 160),
      summary: workflow.summary && typeof workflow.summary === "object" ? workflow.summary : {},
      memoryId: String(input.memoryId || context.memoryId || "").slice(0, 120),
      createdAt: String(input.createdAt || now).slice(0, 40),
      updatedAt: now,
      steps: steps.map((step, index) => ({
        id: sanitizeId(step.id) || `step-${index + 1}`,
        agent: String(step.agent || "Agent").slice(0, 80),
        duty: String(step.duty || "").slice(0, 180),
        status: String(step.status || "done").slice(0, 40),
        output: String(step.output || "").slice(0, 800),
        evidence: Array.isArray(step.evidence) ? step.evidence.slice(0, 12).map(String) : [],
        actions: Array.isArray(step.actions) ? step.actions.slice(0, 8).map(String) : []
      })),
      events: sourceEvents.map((event, index) => ({
        id: sanitizeId(event.id) || `${id}-event-${index + 1}`,
        type: String(event.type || "event").slice(0, 60),
        label: String(event.label || "已记录工作流事件").slice(0, 120),
        step: String(event.step || "").slice(0, 80),
        at: String(event.at || now).slice(0, 40),
        payload: event.payload && typeof event.payload === "object" ? event.payload : {}
      }))
    };
  }

  function rowToAgentRun(row) {
    return {
      id: row.id,
      phase: row.phase,
      mode: row.mode,
      status: row.status,
      rawPreview: row.raw_preview || "",
      summary: parseJson(row.summary_json, {}),
      eventCount: row.event_count,
      memoryId: row.memory_id || "",
      createdAt: row.created_at,
      updatedAt: row.updated_at || "",
      steps: statements.stepsForRun.all(row.id).map((step) => ({
        id: step.step_id,
        agent: step.agent,
        duty: step.duty || "",
        status: step.status,
        output: step.output || "",
        evidence: parseJson(step.evidence_json, []),
        actions: parseJson(step.actions_json, [])
      })),
      events: statements.eventsForRun.all(row.id).map((event) => ({
        id: event.id,
        type: event.type,
        label: event.label,
        step: event.step_id || "",
        at: event.created_at,
        payload: parseJson(event.payload_json, {})
      }))
    };
  }

  function rowToMemoryEvent(row) {
    const members = statements.getEventMembers.all(row.id).map((member) => ({
      memoryId: member.memory_id,
      title: member.title,
      date: member.memory_date || "",
      sourceType: member.source_type,
      rawContent: member.raw_content,
      exhibitText: member.exhibit_text,
      position: Number(member.position) || 0,
      relation: member.relation || "version",
      confirmationNote: member.confirmation_note || "",
      confirmedAt: member.confirmed_at,
      metadata: toJsonObject(member.metadata_json),
      createdAt: member.memory_created_at,
      updatedAt: member.memory_updated_at || ""
    }));
    return {
      id: row.id,
      title: row.title || "",
      summary: row.summary || "",
      status: row.status || "confirmed",
      metadata: toJsonObject(row.metadata_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at || "",
      versionCount: members.length,
      members
    };
  }

  function normalizeMemoryClaim(memory, claim, index, now) {
    const input = isPlainObject(claim) ? claim : { value: claim };
    const evidence = toJsonObject(input.evidence);
    let quote = String(
      input.quote ?? input.quoteText ?? input.sourceText ?? evidence.quote ?? evidence.text ?? ""
    );
    let startOffset = normalizeNullableInteger(
      input.startOffset ?? input.start ?? evidence.startOffset ?? evidence.start
    );
    let endOffset = normalizeNullableInteger(
      input.endOffset ?? input.end ?? evidence.endOffset ?? evidence.end
    );
    const rawContent = String(memory.rawContent || "");
    let evidenceValid = false;

    if (quote) {
      if (
        startOffset !== null && endOffset !== null &&
        startOffset >= 0 && endOffset >= startOffset &&
        rawContent.slice(startOffset, endOffset) === quote
      ) {
        evidenceValid = true;
      } else {
        const locatedAt = rawContent.indexOf(quote);
        const repeatedAt = locatedAt < 0 ? -1 : rawContent.indexOf(quote, locatedAt + 1);
        if (locatedAt >= 0 && repeatedAt < 0) {
          startOffset = locatedAt;
          endOffset = locatedAt + quote.length;
          evidenceValid = true;
        } else {
          startOffset = null;
          endOffset = null;
        }
      }
    } else if (
      startOffset !== null && endOffset !== null &&
      startOffset >= 0 && endOffset > startOffset && endOffset <= rawContent.length
    ) {
      quote = rawContent.slice(startOffset, endOffset);
      evidenceValid = Boolean(quote);
    }

    const rawId = String(input.id || input.claimId || "").trim();
    const id = rawId ? sanitizeId(rawId) : createId("claim");
    if (!id) throw new Error(`Invalid claim id at index ${index}.`);
    const value = input.value !== undefined
      ? input.value
      : input.text !== undefined
        ? input.text
        : input.statement ?? null;
    return {
      id,
      position: index,
      claimKey: String(input.claimKey || input.key || input.field || "").slice(0, 160),
      type: String(input.type || input.claimType || "fact").slice(0, 60),
      value,
      quote,
      startOffset,
      endOffset,
      evidenceValid,
      confidence: normalizeNullableNumber(input.confidence),
      status: String(input.status || "extracted").slice(0, 40),
      payload: {
        ...toJsonObject(input.payload),
        ...toJsonObject(input.metadata)
      },
      createdAt: normalizeTimestamp(input.createdAt, now),
      updatedAt: now
    };
  }

  function rowToMemoryClaim(row) {
    return {
      id: row.id,
      memoryId: row.memory_id,
      position: Number(row.position) || 0,
      claimKey: row.claim_key || "",
      type: row.claim_type || "fact",
      value: parseJson(row.value_json, null),
      quote: row.quote_text || "",
      startOffset: row.start_offset === null ? null : Number(row.start_offset),
      endOffset: row.end_offset === null ? null : Number(row.end_offset),
      evidenceValid: Boolean(row.evidence_valid),
      confidence: row.confidence === null ? null : Number(row.confidence),
      status: row.status || "extracted",
      payload: toJsonObject(row.payload_json),
      metadata: toJsonObject(row.payload_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at || ""
    };
  }

  function normalizeMemoryPair(firstId, secondId) {
    const first = String(firstId || "").trim();
    const second = String(secondId || "").trim();
    if (!first || !second) throw new Error("Two memory ids are required.");
    if (first === second) throw new Error("A memory cannot be paired with itself.");
    const [memoryAId, memoryBId] = first < second ? [first, second] : [second, first];
    return {
      memoryAId,
      memoryBId,
      pairKey: stringifyJson([memoryAId, memoryBId], "[]")
    };
  }

  function rowToPairDecision(row) {
    return {
      pairKey: row.pair_key,
      memoryAId: row.memory_a_id,
      memoryBId: row.memory_b_id,
      decision: row.decision,
      rationale: row.rationale || "",
      evidence: parseJsonArray(row.evidence_json),
      metadata: toJsonObject(row.metadata_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at || ""
    };
  }

  function rowToCuratorQuestion(row) {
    return {
      id: row.id,
      memoryId: row.memory_id || "",
      eventId: row.event_id || "",
      question: row.question,
      reason: row.reason || "",
      status: row.status || "open",
      answer: row.answer || "",
      priority: Number(row.priority) || 0,
      evidence: parseJsonArray(row.evidence_json),
      metadata: toJsonObject(row.metadata_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at || "",
      answeredAt: row.answered_at || ""
    };
  }

  function createId(prefix) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function uniqueStrings(values) {
    return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
  }

  function normalizeClaimsByMemory(value) {
    if (value === null || value === undefined) return [];
    const entries = Array.isArray(value)
      ? value.map((item) => {
        if (Array.isArray(item)) return item;
        if (isPlainObject(item)) return [item.memoryId, item.claims];
        throw new TypeError("claimsByMemory entries must identify a memory and claims array.");
      })
      : isPlainObject(value)
        ? Object.entries(value)
        : null;
    if (!entries) throw new TypeError("claimsByMemory must be an object or array.");

    const seen = new Set();
    return entries.map(([memoryId, claims]) => {
      const normalizedMemoryId = String(memoryId || "").trim();
      if (!normalizedMemoryId) throw new Error("claimsByMemory contains an empty memoryId.");
      if (seen.has(normalizedMemoryId)) throw new Error(`Duplicate claims entry: ${normalizedMemoryId}`);
      if (!Array.isArray(claims)) throw new TypeError(`Claims for ${normalizedMemoryId} must be an array.`);
      seen.add(normalizedMemoryId);
      return [normalizedMemoryId, claims];
    });
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function toJsonObject(value) {
    if (isPlainObject(value)) return value;
    if (typeof value !== "string") return {};
    const parsed = parseJson(value, {});
    return isPlainObject(parsed) ? parsed : {};
  }

  function parseJsonArray(value) {
    const parsed = parseJson(value, []);
    return Array.isArray(parsed) ? parsed : [];
  }

  function stringifyJson(value, fallback) {
    try {
      const serialized = JSON.stringify(value);
      return serialized === undefined ? fallback : serialized;
    } catch {
      return fallback;
    }
  }

  function normalizeNullableInteger(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isInteger(number) ? number : null;
  }

  function normalizeInteger(value, fallback = 0) {
    const number = Number(value);
    return Number.isInteger(number) ? number : fallback;
  }

  function normalizeNullableNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function normalizeTimestamp(value, fallback) {
    const timestamp = String(value || "").trim();
    return timestamp ? timestamp.slice(0, 40) : fallback;
  }

  function parseJson(value, fallback) {
    try {
      return JSON.parse(value || "");
    } catch {
      return fallback;
    }
  }

  function sanitizeId(value) {
    const id = String(value || "").trim();
    return /^[a-zA-Z0-9_-]{1,120}$/.test(id) ? id : "";
  }

  function assertExpectedMemoryVersion(memory, expectedUpdatedAt) {
    const expected = String(expectedUpdatedAt ?? "").trim();
    if (!expected) throw memoryWriteError("缺少展品版本条件。", "MEMORY_PRECONDITION_REQUIRED", 428);
    if (expected !== String(memory.updatedAt || "")) {
      const error = memoryWriteError("这件展品已在别处更新，请刷新后再修改。", "MEMORY_VERSION_CONFLICT", 412);
      error.currentUpdatedAt = memory.updatedAt || "";
      throw error;
    }
  }

  function normalizeStoredTimestamp(value) {
    const parsed = new Date(value || "");
    return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
  }

  function normalizeRevisionNote(value) {
    return String(value || "").trim().slice(0, 500);
  }

  return {
    dbPath: normalizedDbPath,
    listMemories,
    getMemory,
    saveMemory,
    importMemories,
    runDatabaseHealthChecks,
    restoreMemoryRevision,
    deleteMemory,
    purgeAll,
    saveAgentRun,
    getAgentRun,
    getAgentRunForMemory,
    attachAgentRunToMemory,
    createOrExtendMemoryEvent,
    getMemoryEvent,
    getMemoryEventForMemory,
    deleteMemoryEvent,
    listMemoryEvents,
    getArchaeologyOverview,
    replaceMemoryClaims,
    getMemoryClaims,
    saveArchaeologyConfirmation,
    savePairDecision,
    getPairDecision,
    saveCuratorQuestion,
    listCuratorQuestions,
    getStats,
    withTransaction,
    ...mediaDatabase,
    ...exhibitionDatabase,
    ...revisitDatabase,
    ...clueDatabase,
    ...voiceDatabase,
    ...capsuleDatabase,
    ...(revisionDatabase || {}),
    ...(revisitIntentDatabase || {}),
    ...(timeCalibrationDatabase || {}),
    ...(oralHistoryDatabase || {}),
    ...(curatorAgentDatabase || {}),
    ...(memoryInboxDatabase || {}),
    ...(provenanceDatabase || {}),
    ...(coMemoryResponseDatabase || {}),
    ...(museumLockDatabase || {}),
    ...(provenanceSourceCatalog ? {
      listProvenanceSources: provenanceSourceCatalog.listSources,
      resolveProvenanceSource: provenanceSourceCatalog.resolveSource
    } : {}),
    deleteExhibition,
    listRecentMemoryRevisions,
    searchClues,
    searchMemories,
    close: () => db.close()
  };
}

function memoryWriteError(message, code, statusCode) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function nextMemoryUpdatedAt(previousValue) {
  const previous = Date.parse(String(previousValue || ""));
  const current = Date.now();
  const next = Number.isFinite(previous) ? Math.max(current, previous + 1) : current;
  return new Date(next).toISOString();
}

const searchVocabulary = [
  "青春", "校园", "毕业", "成长", "同学", "宿舍", "告别", "朋友", "室友", "陪伴", "群聊", "合照",
  "家", "家人", "妈妈", "爸爸", "饭桌", "春节", "旅行", "车站", "机场", "海边", "雨天",
  "梦", "低谷", "挫折", "失眠", "疲惫", "日常", "散步", "晚风", "怀念", "快乐", "温暖",
  "感动", "兴奋", "紧张", "孤独", "委屈", "害怕", "释然", "遗憾", "平静", "期待", "迷茫",
  "照片", "日记", "聊天", "重要", "珍贵"
];
const searchStopWords = new Set(["帮我", "看看", "一下", "哪些", "有什么", "有没有", "什么", "为什么", "如何", "怎么", "关于", "相关", "这个", "这些", "记忆", "展品", "讲讲", "总结", "推荐"]);
const semanticGroups = [
  ["低谷", "难过", "委屈", "疲惫", "孤独", "迷茫", "遗憾"],
  ["朋友", "陪伴", "室友", "同学", "群聊", "合照", "温暖"],
  ["家", "家人", "妈妈", "爸爸", "饭桌", "春节", "牵挂"],
  ["照片", "相册", "合影", "镜头", "怀念"],
  ["旅行", "车站", "机场", "海边", "城市", "期待", "兴奋"],
  ["校园", "毕业", "青春", "操场", "教室", "同学", "成长"],
  ["平静", "日常", "散步", "晚风", "生活"],
  ["荒诞", "尴尬", "离谱", "奇怪", "快乐"]
];

function buildSearchTerms(query) {
  const text = String(query || "").trim().toLowerCase();
  if (!text) return [];
  const normalized = text.replace(/[?？!！。，、；;：“”"'()[\]{}<>《》]/g, " ");
  const tokens = normalized.split(/\s+/).map((item) => item.trim()).filter((item) => item && !searchStopWords.has(item));
  const vocabularyHits = searchVocabulary.filter((word) => text.includes(word));
  return [...new Set([...vocabularyHits, ...tokens])].slice(0, 12);
}

function buildSemanticTerms(keywords, query) {
  const text = String(query || "");
  const expanded = new Set();
  semanticGroups.forEach((group) => {
    if (group.some((term) => text.includes(term) || keywords.includes(term))) group.forEach((term) => expanded.add(term));
  });
  return [...expanded].filter((term) => !keywords.includes(term)).slice(0, 12);
}

module.exports = { createMemoryStore };
