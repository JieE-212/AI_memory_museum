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

    CREATE INDEX IF NOT EXISTS idx_memories_hall ON memories(hall_id);
    CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at);
    CREATE INDEX IF NOT EXISTS idx_memory_people_name ON memory_people(name);
    CREATE INDEX IF NOT EXISTS idx_memory_tags_tag ON memory_tags(tag);
    CREATE INDEX IF NOT EXISTS idx_memory_emotions_emotion ON memory_emotions(emotion);
    CREATE INDEX IF NOT EXISTS idx_agent_runs_memory ON agent_runs(memory_id);
    CREATE INDEX IF NOT EXISTS idx_agent_events_run ON agent_events(run_id);
  `);

  ensureColumn("memories", "cover_image", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("memories", "media_note", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("memories", "attachments_json", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn("memories", "agent_run_id", "TEXT NOT NULL DEFAULT ''");

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
    eventsForRun: db.prepare("SELECT * FROM agent_events WHERE run_id = ? ORDER BY datetime(created_at), id")
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
    if (transaction) db.exec("BEGIN");
    try {
      saveMemoryRow(memory);
      if (transaction) db.exec("COMMIT");
      return getMemory(memory.id);
    } catch (error) {
      if (transaction) db.exec("ROLLBACK");
      throw error;
    }
  }

  function importMemories(memories) {
    db.exec("BEGIN");
    try {
      memories.forEach(saveMemoryRow);
      db.exec("COMMIT");
      return { imported: memories.length, memories: listMemories() };
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function deleteMemory(id) {
    const memory = getMemory(id);
    if (!memory) return false;
    db.exec("BEGIN");
    try {
      const result = statements.deleteMemory.run(id);
      if (memory.agentRunId) statements.deleteAgentRun.run(memory.agentRunId);
      db.exec("COMMIT");
      return result.changes > 0;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function purgeAll() {
    const memoriesDeleted = Number(statements.countMemories.get()?.count) || 0;
    const agentRunsDeleted = Number(statements.countAgentRuns.get()?.count) || 0;
    db.exec("BEGIN");
    try {
      db.exec(`
        DELETE FROM memory_people;
        DELETE FROM memory_tags;
        DELETE FROM memory_emotions;
        DELETE FROM agent_events;
        DELETE FROM agent_steps;
        DELETE FROM agent_runs;
        DELETE FROM memories;
      `);
      db.exec("COMMIT");
      return { memoriesDeleted, agentRunsDeleted };
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function saveAgentRun(workflow, context = {}) {
    const run = normalizeAgentRun(workflow, context);
    db.exec("BEGIN");
    try {
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
      db.exec("COMMIT");
      return getAgentRun(run.id);
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
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
    db.exec("BEGIN");
    try {
      statements.updateAgentRunMemory.run(memoryId, now, runId);
      statements.updateMemoryAgentRun.run(runId, now, memoryId);
      db.exec("COMMIT");
      return getAgentRun(runId);
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
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
    getStats,
    searchMemories,
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
