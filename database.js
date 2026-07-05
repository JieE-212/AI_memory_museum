const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

function createMemoryStore({ dbPath, halls, schemaVersion }) {
  const normalizedDbPath = path.resolve(dbPath);
  fs.mkdirSync(path.dirname(normalizedDbPath), { recursive: true });

  const db = new DatabaseSync(normalizedDbPath);
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
      phase INTEGER NOT NULL DEFAULT 7,
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

    CREATE TABLE IF NOT EXISTS saved_exhibitions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      intro TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft',
      cover_memory_id TEXT NOT NULL DEFAULT '',
      memory_ids_json TEXT NOT NULL DEFAULT '[]',
      sort_json TEXT NOT NULL DEFAULT '[]',
      guide_text TEXT NOT NULL DEFAULT '',
      tags_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS report_drafts (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      scope_json TEXT NOT NULL DEFAULT '{}',
      sections_json TEXT NOT NULL DEFAULT '[]',
      references_json TEXT NOT NULL DEFAULT '[]',
      source_insights_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_memories_hall_id ON memories(hall_id);
    CREATE INDEX IF NOT EXISTS idx_memories_created_at ON memories(created_at);
    CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance);
    CREATE INDEX IF NOT EXISTS idx_memories_favorite ON memories(favorite);
    CREATE INDEX IF NOT EXISTS idx_memory_tags_tag ON memory_tags(tag);
    CREATE INDEX IF NOT EXISTS idx_memory_emotions_emotion ON memory_emotions(emotion);
    CREATE INDEX IF NOT EXISTS idx_memory_people_name ON memory_people(name);
    CREATE INDEX IF NOT EXISTS idx_agent_runs_memory_id ON agent_runs(memory_id);
    CREATE INDEX IF NOT EXISTS idx_agent_events_run_id ON agent_events(run_id);
    CREATE INDEX IF NOT EXISTS idx_saved_exhibitions_status ON saved_exhibitions(status);
    CREATE INDEX IF NOT EXISTS idx_report_drafts_status ON report_drafts(status);
  `);
  ensureColumn("memories", "agent_run_id", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("memories", "cover_image", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("memories", "media_note", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("memories", "attachments_json", "TEXT NOT NULL DEFAULT '[]'");
  db.exec("CREATE INDEX IF NOT EXISTS idx_memories_agent_run_id ON memories(agent_run_id);");

  const upsertHall = db.prepare(`
    INSERT INTO halls (id, name, description)
    VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      description = excluded.description
  `);
  halls.forEach((hall) => upsertHall.run(hall.id, hall.name, hall.description || ""));

  const statements = {
    list: db.prepare("SELECT * FROM memories ORDER BY datetime(created_at) DESC, title ASC"),
    get: db.prepare("SELECT * FROM memories WHERE id = ?"),
    upsert: db.prepare(`
      INSERT INTO memories (
        id, schema_version, title, hall_id, source_type, raw_content, exhibit_text,
        memory_date, location, emotion_intensity, importance, favorite, cover_image, media_note, attachments_json,
        agent_run_id, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    peopleFor: db.prepare("SELECT name FROM memory_people WHERE memory_id = ? ORDER BY name ASC"),
    tagsFor: db.prepare("SELECT tag FROM memory_tags WHERE memory_id = ? ORDER BY tag ASC"),
    emotionsFor: db.prepare("SELECT emotion FROM memory_emotions WHERE memory_id = ? ORDER BY emotion ASC"),
    upsertAgentRun: db.prepare(`
      INSERT INTO agent_runs (
        id, phase, mode, status, raw_preview, summary_json, event_count, memory_id, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    deleteAgentSteps: db.prepare("DELETE FROM agent_steps WHERE run_id = ?"),
    insertAgentStep: db.prepare(`
      INSERT INTO agent_steps (
        run_id, step_id, position, agent, duty, status, output, evidence_json, actions_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    deleteAgentEvents: db.prepare("DELETE FROM agent_events WHERE run_id = ?"),
    insertAgentEvent: db.prepare(`
      INSERT INTO agent_events (
        id, run_id, step_id, type, label, payload_json, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `),
    getAgentRun: db.prepare("SELECT * FROM agent_runs WHERE id = ?"),
    getAgentRunForMemory: db.prepare("SELECT * FROM agent_runs WHERE memory_id = ? ORDER BY datetime(updated_at) DESC, datetime(created_at) DESC LIMIT 1"),
    stepsForRun: db.prepare("SELECT * FROM agent_steps WHERE run_id = ? ORDER BY position ASC"),
    eventsForRun: db.prepare("SELECT * FROM agent_events WHERE run_id = ? ORDER BY datetime(created_at) ASC"),
    attachAgentRunToMemory: db.prepare("UPDATE agent_runs SET memory_id = ?, updated_at = ? WHERE id = ?"),
    countAgentRuns: db.prepare("SELECT COUNT(*) AS count FROM agent_runs"),
    countMemories: db.prepare("SELECT COUNT(*) AS count FROM memories"),
    deleteAllMemoryPeople: db.prepare("DELETE FROM memory_people"),
    deleteAllMemoryTags: db.prepare("DELETE FROM memory_tags"),
    deleteAllMemoryEmotions: db.prepare("DELETE FROM memory_emotions"),
    deleteAllAgentEvents: db.prepare("DELETE FROM agent_events"),
    deleteAllAgentSteps: db.prepare("DELETE FROM agent_steps"),
    deleteAllAgentRuns: db.prepare("DELETE FROM agent_runs"),
    deleteAllSavedExhibitions: db.prepare("DELETE FROM saved_exhibitions"),
    deleteAllReportDrafts: db.prepare("DELETE FROM report_drafts"),
    deleteAllMemories: db.prepare("DELETE FROM memories"),
    listSavedExhibitions: db.prepare("SELECT * FROM saved_exhibitions ORDER BY datetime(updated_at) DESC, datetime(created_at) DESC"),
    getSavedExhibition: db.prepare("SELECT * FROM saved_exhibitions WHERE id = ?"),
    upsertSavedExhibition: db.prepare(`
      INSERT INTO saved_exhibitions (
        id, title, intro, status, cover_memory_id, memory_ids_json, sort_json, guide_text, tags_json, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        intro = excluded.intro,
        status = excluded.status,
        cover_memory_id = excluded.cover_memory_id,
        memory_ids_json = excluded.memory_ids_json,
        sort_json = excluded.sort_json,
        guide_text = excluded.guide_text,
        tags_json = excluded.tags_json,
        updated_at = excluded.updated_at
    `),
    deleteSavedExhibition: db.prepare("DELETE FROM saved_exhibitions WHERE id = ?"),
    listReportDrafts: db.prepare("SELECT * FROM report_drafts ORDER BY datetime(updated_at) DESC, datetime(created_at) DESC"),
    getReportDraft: db.prepare("SELECT * FROM report_drafts WHERE id = ?"),
    upsertReportDraft: db.prepare(`
      INSERT INTO report_drafts (
        id, title, status, scope_json, sections_json, references_json, source_insights_json, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        status = excluded.status,
        scope_json = excluded.scope_json,
        sections_json = excluded.sections_json,
        references_json = excluded.references_json,
        source_insights_json = excluded.source_insights_json,
        updated_at = excluded.updated_at
    `),
    deleteReportDraft: db.prepare("DELETE FROM report_drafts WHERE id = ?")
  };

  function ensureColumn(table, column, definition) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name);
    if (!columns.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }

  function listMemories() {
    return statements.list.all().map(rowToMemory);
  }

  function getMemory(id) {
    const row = statements.get.get(id);
    return row ? rowToMemory(row) : null;
  }

  function saveMemory(memory, options = {}) {
    const useTransaction = options.transaction !== false;
    if (useTransaction) db.exec("BEGIN");
    try {
      saveMemoryRow(memory);
      if (useTransaction) db.exec("COMMIT");
      return getMemory(memory.id);
    } catch (error) {
      if (useTransaction) db.exec("ROLLBACK");
      throw error;
    }
  }

  function importMemories(memories) {
    db.exec("BEGIN");
    try {
      memories.forEach(saveMemoryRow);
      db.exec("COMMIT");
      return {
        imported: memories.length,
        memories: listMemories()
      };
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function deleteMemory(id) {
    const result = statements.deleteMemory.run(id);
    return result.changes > 0;
  }

  function purgeAll() {
    const memoryCount = Number(statements.countMemories.get()?.count) || 0;
    const agentRunCount = Number(statements.countAgentRuns.get()?.count) || 0;
    db.exec("BEGIN");
    try {
      statements.deleteAllMemoryPeople.run();
      statements.deleteAllMemoryTags.run();
      statements.deleteAllMemoryEmotions.run();
      statements.deleteAllAgentEvents.run();
      statements.deleteAllAgentSteps.run();
      statements.deleteAllAgentRuns.run();
      statements.deleteAllSavedExhibitions.run();
      statements.deleteAllReportDrafts.run();
      statements.deleteAllMemories.run();
      db.exec("COMMIT");
      return { memoriesDeleted: memoryCount, agentRunsDeleted: agentRunCount };
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function saveAgentRun(workflow, context = {}) {
    const normalized = normalizeAgentRun(workflow, context);
    db.exec("BEGIN");
    try {
      statements.upsertAgentRun.run(
        normalized.id,
        normalized.phase,
        normalized.mode,
        normalized.status,
        normalized.rawPreview,
        JSON.stringify(normalized.summary),
        normalized.eventCount,
        normalized.memoryId,
        normalized.createdAt,
        normalized.updatedAt
      );
      statements.deleteAgentSteps.run(normalized.id);
      normalized.steps.forEach((step, index) => {
        statements.insertAgentStep.run(
          normalized.id,
          step.id,
          index,
          step.agent,
          step.duty,
          step.status,
          step.output,
          JSON.stringify(step.evidence),
          JSON.stringify(step.actions)
        );
      });
      statements.deleteAgentEvents.run(normalized.id);
      normalized.events.forEach((event, index) => {
        statements.insertAgentEvent.run(
          event.id || `${normalized.id}-event-${index + 1}`,
          normalized.id,
          event.step || "",
          event.type,
          event.label,
          JSON.stringify(event.payload || {}),
          event.at
        );
      });
      db.exec("COMMIT");
      return getAgentRun(normalized.id);
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function attachAgentRunToMemory(runId, memoryId) {
    if (!runId || !memoryId) return null;
    const now = new Date().toISOString();
    statements.attachAgentRunToMemory.run(memoryId, now, runId);
    const run = getAgentRun(runId);
    return run && run.memoryId === memoryId ? run : null;
  }

  function getAgentRun(id) {
    const row = statements.getAgentRun.get(id);
    return row ? rowToAgentRun(row) : null;
  }

  function getAgentRunForMemory(memoryId) {
    const row = statements.getAgentRunForMemory.get(memoryId);
    return row ? rowToAgentRun(row) : null;
  }

  function getStats() {
    const memories = listMemories();
    return {
      memories: memories.length,
      halls: new Set(memories.map((memory) => memory.hall)).size,
      tags: new Set(memories.flatMap((memory) => memory.tags || [])).size,
      emotions: new Set(memories.flatMap((memory) => memory.emotions || [])).size,
      people: new Set(memories.flatMap((memory) => memory.people || [])).size,
      favorites: memories.filter((memory) => memory.favorite).length,
      multimodal: memories.filter(hasMultimodalMetadata).length,
      agentRuns: statements.countAgentRuns.get().count,
      savedExhibitions: statements.listSavedExhibitions.all().length,
      reportDrafts: statements.listReportDrafts.all().length
    };
  }

  function listSavedExhibitions() {
    return statements.listSavedExhibitions.all().map(rowToSavedExhibition);
  }

  function getSavedExhibition(id) {
    const row = statements.getSavedExhibition.get(id);
    return row ? rowToSavedExhibition(row) : null;
  }

  function saveSavedExhibition(exhibition) {
    const normalized = normalizeSavedExhibition(exhibition);
    statements.upsertSavedExhibition.run(
      normalized.id,
      normalized.title,
      normalized.intro,
      normalized.status,
      normalized.coverMemoryId,
      JSON.stringify(normalized.memoryIds),
      JSON.stringify(normalized.sort),
      normalized.guideText,
      JSON.stringify(normalized.tags),
      normalized.createdAt,
      normalized.updatedAt
    );
    return getSavedExhibition(normalized.id);
  }

  function deleteSavedExhibition(id) {
    return statements.deleteSavedExhibition.run(id).changes > 0;
  }

  function listReportDrafts() {
    return statements.listReportDrafts.all().map(rowToReportDraft);
  }

  function getReportDraft(id) {
    const row = statements.getReportDraft.get(id);
    return row ? rowToReportDraft(row) : null;
  }

  function saveReportDraft(draft) {
    const normalized = normalizeReportDraft(draft);
    statements.upsertReportDraft.run(
      normalized.id,
      normalized.title,
      normalized.status,
      JSON.stringify(normalized.scope),
      JSON.stringify(normalized.sections),
      JSON.stringify(normalized.references),
      JSON.stringify(normalized.sourceInsights),
      normalized.createdAt,
      normalized.updatedAt
    );
    return getReportDraft(normalized.id);
  }

  function deleteReportDraft(id) {
    return statements.deleteReportDraft.run(id).changes > 0;
  }

  function searchMemories(query, options = {}) {
    const limit = Math.min(50, Math.max(1, Number(options.limit) || 12));
    const mode = ["keyword", "semantic", "hybrid"].includes(options.mode) ? options.mode : "hybrid";
    const keywordTerms = buildSearchTerms(query);
    const semanticTerms = mode === "keyword" ? [] : buildSemanticTerms(keywordTerms, query);
    const terms = mode === "semantic"
      ? [...new Set([...semanticTerms, ...keywordTerms])]
      : [...new Set([...keywordTerms, ...semanticTerms])];
    if (terms.length === 0) {
      const recent = listMemories().slice(0, limit);
      return options.includeMeta ? recent.map((memory, index) => ({
        memory,
        score: 0,
        matchedTerms: [],
        semanticTerms: [],
        matchedFields: [],
        confidence: { level: "weak", label: "弱证据", reason: "未提供有效检索词，仅作为最近展品回看" },
        reason: index === 0 ? "未提供检索词，按最近展品回看" : "最近展品回看"
      })) : recent;
    }

    const results = listMemories()
      .map((memory, index) => {
        const detail = scoreMemory(memory, terms, semanticTerms);
        return { memory, index, ...detail };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, limit);
    return options.includeMeta ? results.map(({ index, ...item }) => item) : results.map((item) => item.memory);
  }

  function replaceRelated(memoryId, type, values) {
    const config = {
      people: { clear: statements.deletePeople, insert: statements.insertPerson },
      tags: { clear: statements.deleteTags, insert: statements.insertTag },
      emotions: { clear: statements.deleteEmotions, insert: statements.insertEmotion }
    }[type];

    config.clear.run(memoryId);
    [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))]
      .forEach((value) => config.insert.run(memoryId, value));
  }

  function saveMemoryRow(memory) {
    statements.upsert.run(
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
    replaceRelated(memory.id, "people", memory.people || []);
    replaceRelated(memory.id, "tags", memory.tags || []);
    replaceRelated(memory.id, "emotions", memory.emotions || []);
  }

  function rowToMemory(row) {
    return {
      schemaVersion: row.schema_version,
      id: row.id,
      title: row.title,
      hall: row.hall_id,
      rawContent: row.raw_content,
      exhibitText: row.exhibit_text,
      date: row.memory_date || "",
      location: row.location || "",
      people: statements.peopleFor.all(row.id).map((item) => item.name),
      tags: statements.tagsFor.all(row.id).map((item) => item.tag),
      emotions: statements.emotionsFor.all(row.id).map((item) => item.emotion),
      emotionIntensity: row.emotion_intensity,
      sourceType: row.source_type,
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
    const run = workflow.run || {};
    const id = sanitizeId(run.id) || sanitizeId(workflow.runId) || context.createId?.() || `${Date.now()}`;
    const steps = Array.isArray(workflow.steps) ? workflow.steps : [];
    const events = Array.isArray(run.events) && run.events.length
      ? run.events
      : [{ type: "workflow_created", label: "Agent 工作流已创建", at: run.createdAt || now }];
    return {
      id,
      phase: Number(run.phase || workflow.phase || 9) || 9,
      mode: String(run.mode || workflow.mode || context.mode || "mock").slice(0, 40),
      status: String(workflow.summary?.status || "created").slice(0, 40),
      rawPreview: String(context.rawContent || "").slice(0, 160),
      summary: workflow.summary || {},
      eventCount: Math.max(Number(run.eventCount) || events.length, events.length),
      memoryId: String(run.memoryId || context.memoryId || "").slice(0, 80),
      createdAt: String(run.createdAt || now).slice(0, 40),
      updatedAt: now,
      steps: steps.map((step, index) => ({
        id: sanitizeId(step.id) || `step-${index + 1}`,
        agent: String(step.agent || "Agent").slice(0, 80),
        duty: String(step.duty || "").slice(0, 180),
        status: String(step.status || "done").slice(0, 40),
        output: String(step.output || "").slice(0, 600),
        evidence: Array.isArray(step.evidence) ? step.evidence.slice(0, 12).map(String) : [],
        actions: Array.isArray(step.actions) ? step.actions.slice(0, 8).map(String) : []
      })),
      events: events.map((event, index) => ({
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
    const steps = statements.stepsForRun.all(row.id).map((step) => ({
      id: step.step_id,
      agent: step.agent,
      duty: step.duty || "",
      status: step.status,
      output: step.output || "",
      evidence: parseJson(step.evidence_json, []),
      actions: parseJson(step.actions_json, [])
    }));
    const events = statements.eventsForRun.all(row.id).map((event) => ({
      id: event.id,
      type: event.type,
      label: event.label,
      step: event.step_id || "",
      at: event.created_at,
      payload: parseJson(event.payload_json, {})
    }));
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
      steps,
      events
    };
  }

  function normalizeSavedExhibition(value = {}) {
    const now = new Date().toISOString();
    const memoryIds = Array.isArray(value.memoryIds) ? value.memoryIds : [];
    return {
      id: sanitizeId(value.id) || `exhibition-${Date.now()}`,
      title: String(value.title || "未命名专题展").slice(0, 120),
      intro: String(value.intro || "").slice(0, 800),
      status: normalizeAssetStatus(value.status),
      coverMemoryId: String(value.coverMemoryId || memoryIds[0] || "").slice(0, 80),
      memoryIds: [...new Set(memoryIds.map((item) => String(item || "").slice(0, 80)).filter(Boolean))].slice(0, 80),
      sort: Array.isArray(value.sort) ? value.sort.slice(0, 80) : [],
      guideText: String(value.guideText || "").slice(0, 2000),
      tags: Array.isArray(value.tags) ? [...new Set(value.tags.map((item) => String(item || "").slice(0, 40)).filter(Boolean))].slice(0, 20) : [],
      createdAt: String(value.createdAt || now).slice(0, 40),
      updatedAt: now
    };
  }

  function rowToSavedExhibition(row) {
    return {
      id: row.id,
      title: row.title,
      intro: row.intro || "",
      status: row.status || "draft",
      coverMemoryId: row.cover_memory_id || "",
      memoryIds: parseJson(row.memory_ids_json, []),
      sort: parseJson(row.sort_json, []),
      guideText: row.guide_text || "",
      tags: parseJson(row.tags_json, []),
      createdAt: row.created_at,
      updatedAt: row.updated_at || ""
    };
  }

  function normalizeReportDraft(value = {}) {
    const now = new Date().toISOString();
    return {
      id: sanitizeId(value.id) || `report-${Date.now()}`,
      title: String(value.title || "未命名回忆报告").slice(0, 120),
      status: normalizeAssetStatus(value.status),
      scope: value.scope && typeof value.scope === "object" ? value.scope : {},
      sections: Array.isArray(value.sections) ? value.sections.slice(0, 30) : [],
      references: Array.isArray(value.references) ? value.references.slice(0, 120) : [],
      sourceInsights: value.sourceInsights && typeof value.sourceInsights === "object" ? value.sourceInsights : {},
      createdAt: String(value.createdAt || now).slice(0, 40),
      updatedAt: now
    };
  }

  function rowToReportDraft(row) {
    return {
      id: row.id,
      title: row.title,
      status: row.status || "draft",
      scope: parseJson(row.scope_json, {}),
      sections: parseJson(row.sections_json, []),
      references: parseJson(row.references_json, []),
      sourceInsights: parseJson(row.source_insights_json, {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at || ""
    };
  }

  function normalizeAssetStatus(value) {
    return ["draft", "review", "published", "archived"].includes(value) ? value : "draft";
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
    listSavedExhibitions,
    getSavedExhibition,
    saveSavedExhibition,
    deleteSavedExhibition,
    listReportDrafts,
    getReportDraft,
    saveReportDraft,
    deleteReportDraft,
    getStats,
    searchMemories,
    close: () => db.close()
  };
}

const searchVocabulary = [
  "青春", "校园", "毕业", "成长", "同学", "宿舍", "考试", "告别", "朋友", "室友", "群聊", "合照",
  "家", "家人", "家庭", "亲人", "父母", "妈妈", "爸爸", "饭桌", "学校", "旅行", "车站", "雨天",
  "梦", "梦境", "低谷", "挫折", "失眠", "崩溃", "疲惫", "日常", "散步", "晚风", "普通",
  "奇怪", "荒诞", "尴尬", "离谱", "怀念", "快乐", "开心", "温暖", "感动", "兴奋", "紧张",
  "孤独", "委屈", "愤怒", "害怕", "释然", "遗憾", "平静", "期待", "迷茫", "照片", "日记",
  "聊天", "物品", "最近", "重要", "珍贵"
];
const searchStopWords = new Set(["帮我", "看看", "一下", "哪些", "有哪些", "有什么", "有没有", "什么", "为什么", "如何", "怎么", "能不能", "可以", "关于", "相关", "这个", "这些", "记忆", "展品", "讲讲", "总结", "推荐"]);

function buildSearchTerms(query) {
  const text = String(query || "").trim().toLowerCase();
  if (!text) return [];

  const normalized = text.replace(/[?？!！。，、；;：“”"'()[\]{}<>《》]/g, " ");
  const tokens = normalized.split(/\s+/).map((item) => item.trim()).filter((item) => item && !searchStopWords.has(item));
  const vocabularyHits = searchVocabulary.filter((word) => text.includes(word.toLowerCase()));
  return [...new Set([...vocabularyHits, ...tokens])].slice(0, 12);
}

const semanticGroups = [
  ["失落", "难过", "低谷", "委屈", "崩溃", "疲惫", "孤独", "迷茫", "遗憾"],
  ["被朋友拉了一把", "朋友", "陪伴", "室友", "群聊", "合照", "一起", "温暖"],
  ["家", "家人", "妈妈", "爸爸", "饭桌", "亲人", "春节", "牵挂"],
  ["照片", "相册", "合影", "镜头", "拍照", "照片描述", "怀念"],
  ["旅行", "车站", "机场", "海边", "城市", "路上", "期待", "兴奋"],
  ["学校", "校园", "毕业", "青春", "操场", "教室", "同学", "成长"],
  ["平静", "日常", "普通", "散步", "晚风", "生活", "片段"],
  ["荒诞", "尴尬", "离谱", "奇怪", "社死", "快乐"]
];

function buildSemanticTerms(keywordTerms, query) {
  const text = String(query || "");
  const seeds = new Set(keywordTerms);
  semanticGroups.forEach((group) => {
    if (group.some((term) => text.includes(term) || keywordTerms.includes(term))) {
      group.forEach((term) => seeds.add(term));
    }
  });
  if (/拉.*一把|帮.*我|陪/.test(text)) ["朋友", "陪伴", "温暖"].forEach((term) => seeds.add(term));
  if (/小时候|童年|以前|过去/.test(text)) ["怀念", "家庭", "校园", "照片"].forEach((term) => seeds.add(term));
  return [...seeds].filter((term) => !keywordTerms.includes(term)).slice(0, 12);
}

function scoreMemory(memory, terms, semanticTerms = []) {
  const matchedTerms = new Set();
  const matchedFields = new Set();
  const semanticSet = new Set(semanticTerms);
  const score = terms.reduce((total, term) => {
    if (!term) return total;
    const multiplier = semanticSet.has(term) ? 0.72 : 1;
    const before = total;
    total += scoreField(memory.title, term, 6, "标题", matchedFields) * multiplier;
    total += scoreField(memory.exhibitText, term, 4, "展品说明", matchedFields) * multiplier;
    total += scoreField(memory.rawContent, term, 3, "原始记忆", matchedFields) * multiplier;
    total += scoreField(memory.location, term, 3, "地点", matchedFields) * multiplier;
    total += scoreField(memory.coverImage, term, 2, "封面线索", matchedFields) * multiplier;
    total += scoreField(memory.mediaNote, term, 3, "多模态线索", matchedFields) * multiplier;
    total += scoreField(memory.sourceType, term, 2, "来源", matchedFields) * multiplier;
    total += scoreField(memory.hall, term, 2, "展厅", matchedFields) * multiplier;
    total += scoreList(memory.tags, term, 5, "标签", matchedFields) * multiplier;
    total += scoreList(memory.emotions, term, 5, "情绪", matchedFields) * multiplier;
    total += scoreList(memory.people, term, 4, "人物", matchedFields) * multiplier;
    total += scoreAttachments(memory.attachments, term, 3, matchedFields) * multiplier;
    if (total > before) matchedTerms.add(term);
    return total;
  }, 0);
  return {
    score: Number(score.toFixed(2)),
    matchedTerms: [...matchedTerms].slice(0, 8),
    semanticTerms: [...matchedTerms].filter((term) => semanticSet.has(term)).slice(0, 8),
    matchedFields: [...matchedFields].slice(0, 8),
    confidence: buildSearchConfidence(score, matchedTerms, matchedFields, semanticSet),
    reason: buildSearchReason(matchedTerms, matchedFields, semanticSet)
  };
}

function buildSearchConfidence(score, matchedTerms, matchedFields, semanticSet) {
  const semanticHits = [...matchedTerms].filter((term) => semanticSet.has(term));
  if (score >= 12 && matchedTerms.size >= 2 && matchedFields.size >= 2) {
    return { level: "high", label: "强证据", reason: "多字段、多线索同时命中" };
  }
  if (score >= 6 || semanticHits.length > 0) {
    return { level: "medium", label: "可参考", reason: semanticHits.length ? "包含语义扩展命中" : "存在明确字段命中" };
  }
  if (score > 0) {
    return { level: "low", label: "弱关联", reason: "命中线索较少，适合作为补充参考" };
  }
  return { level: "weak", label: "弱证据", reason: "未形成有效命中" };
}

function buildSearchReason(matchedTerms, matchedFields, semanticSet) {
  const semanticHits = [...matchedTerms].filter((term) => semanticSet.has(term));
  const fields = [...matchedFields].join("、") || "未命中字段";
  return semanticHits.length
    ? `命中${fields}，并扩展语义线索：${semanticHits.slice(0, 4).join("、")}`
    : `命中${fields}`;
}

function scoreField(value, term, weight, fieldName, matchedFields) {
  if (!String(value || "").toLowerCase().includes(term)) return 0;
  matchedFields.add(fieldName);
  return weight;
}

function scoreList(values, term, weight, fieldName, matchedFields) {
  if (!(values || []).some((value) => String(value || "").toLowerCase().includes(term))) return 0;
  matchedFields.add(fieldName);
  return weight;
}

function scoreAttachments(values, term, weight, matchedFields) {
  const matched = (values || []).some((item) => {
    if (typeof item === "string") return item.toLowerCase().includes(term);
    return [item.name, item.type, item.note].some((value) => String(value || "").toLowerCase().includes(term));
  });
  if (!matched) return 0;
  matchedFields.add("附件");
  return weight;
}

function hasMultimodalMetadata(memory = {}) {
  return Boolean(
    memory.coverImage
    || memory.mediaNote
    || (Array.isArray(memory.attachments) && memory.attachments.length > 0)
  );
}

module.exports = { createMemoryStore };
