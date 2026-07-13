const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const { initializeMediaDatabase } = require("./lib/media-database");

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

  const mediaDatabase = initializeMediaDatabase({
    db,
    withTransaction,
    now: () => new Date().toISOString(),
    createId
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
    updateMemoryAgentRun: db.prepare("UPDATE memories SET agent_run_id = ?, updated_at = ? WHERE id = ?"),
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
      saveMemoryRow(memory);
      return getMemory(memory.id);
    };
    return transaction ? withTransaction(writeMemory) : writeMemory();
  }

  function importMemories(memories) {
    return withTransaction(() => {
      memories.forEach(saveMemoryRow);
      return { imported: memories.length, memories: listMemories() };
    });
  }

  function deleteMemory(id) {
    const memory = getMemory(id);
    if (!memory) return false;
    return withTransaction(() => {
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

  function purgeAll() {
    const memoriesDeleted = Number(statements.countMemories.get()?.count) || 0;
    const agentRunsDeleted = Number(statements.countAgentRuns.get()?.count) || 0;
    const memoryEventsDeleted = Number(statements.countMemoryEvents.get()?.count) || 0;
    return withTransaction(() => {
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
      return { memoriesDeleted, agentRunsDeleted, memoryEventsDeleted };
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
      statements.updateMemoryAgentRun.run(runId, now, memoryId);
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
    return {
      memories: memories.length,
      halls: new Set(memories.map((memory) => memory.hall)).size,
      tags: new Set(memories.flatMap((memory) => memory.tags)).size,
      emotions: new Set(memories.flatMap((memory) => memory.emotions)).size,
      people: new Set(memories.flatMap((memory) => memory.people)).size,
      favorites: memories.filter((memory) => memory.favorite).length,
      agentRuns: Number(statements.countAgentRuns.get()?.count) || 0
    };
  }

  function searchMemories(query, options = {}) {
    const limit = Math.min(50, Math.max(1, Number(options.limit) || 12));
    const mode = ["keyword", "semantic", "hybrid"].includes(options.mode) ? options.mode : "hybrid";
    const keywordTerms = buildSearchTerms(query);
    const semanticTerms = mode === "keyword" ? [] : buildSemanticTerms(keywordTerms, query);
    const terms = [...new Set([...keywordTerms, ...semanticTerms])];

    if (!terms.length) {
      const recent = listMemories().slice(0, limit);
      return options.includeMeta ? recent.map((memory) => ({
        memory,
        score: 0,
        matchedTerms: [],
        matchedFields: [],
        confidence: { level: "weak", label: "最近展品", reason: "没有有效检索词。" },
        reason: "按最近记录返回"
      })) : recent;
    }

    const results = listMemories()
      .map((memory, index) => ({ memory, index, ...scoreMemory(memory, terms, semanticTerms) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, limit);
    return options.includeMeta
      ? results.map(({ index, ...item }) => item)
      : results.map((item) => item.memory);
  }

  function saveMemoryRow(memory) {
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
        if (locatedAt >= 0) {
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

  return {
    dbPath: normalizedDbPath,
    listMemories,
    getMemory,
    saveMemory,
    importMemories,
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
    searchMemories,
    withTransaction,
    ...mediaDatabase,
    close: () => db.close()
  };
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

function scoreMemory(memory, terms, semanticTerms) {
  let score = 0;
  const matchedTerms = new Set();
  const matchedFields = new Set();
  const semanticSet = new Set(semanticTerms);
  for (const term of terms) {
    const multiplier = semanticSet.has(term) ? 0.72 : 1;
    const before = score;
    score += scoreField(memory.title, term, 6, "标题", matchedFields) * multiplier;
    score += scoreField(memory.exhibitText, term, 4, "展品说明", matchedFields) * multiplier;
    score += scoreField(memory.rawContent, term, 3, "原始记忆", matchedFields) * multiplier;
    score += scoreField(memory.location, term, 3, "地点", matchedFields) * multiplier;
    score += scoreField(memory.sourceType, term, 2, "来源", matchedFields) * multiplier;
    score += scoreList(memory.tags, term, 5, "标签", matchedFields) * multiplier;
    score += scoreList(memory.emotions, term, 5, "情绪", matchedFields) * multiplier;
    score += scoreList(memory.people, term, 4, "人物", matchedFields) * multiplier;
    if (score > before) matchedTerms.add(term);
  }
  const semanticHits = [...matchedTerms].filter((term) => semanticSet.has(term));
  const confidence = score >= 12 && matchedFields.size >= 2
    ? { level: "high", label: "强证据", reason: "多个字段同时命中。" }
    : score >= 6 || semanticHits.length
      ? { level: "medium", label: "可参考", reason: semanticHits.length ? "包含语义扩展命中。" : "存在明确字段命中。" }
      : { level: "low", label: "弱关联", reason: "命中线索较少。" };
  const fieldText = [...matchedFields].join("、") || "未命中字段";
  return {
    score: Number(score.toFixed(2)),
    matchedTerms: [...matchedTerms].slice(0, 8),
    matchedFields: [...matchedFields].slice(0, 8),
    confidence,
    reason: semanticHits.length ? `命中${fieldText}，并扩展语义：${semanticHits.slice(0, 4).join("、")}` : `命中${fieldText}`
  };
}

function scoreField(value, term, weight, field, matches) {
  if (!String(value || "").toLowerCase().includes(term)) return 0;
  matches.add(field);
  return weight;
}

function scoreList(values, term, weight, field, matches) {
  if (!(values || []).some((value) => String(value || "").toLowerCase().includes(term))) return 0;
  matches.add(field);
  return weight;
}

module.exports = { createMemoryStore };
