"use strict";

const { randomUUID } = require("node:crypto");
const { applyMigrations } = require("./migrations");

const LIMITS = Object.freeze({
  exhibitions: 200,
  sections: 3,
  items: 12,
  citationsPerItem: 3,
  title: 120,
  theme: 60,
  opening: 1200,
  sectionTitle: 100,
  sectionSummary: 800,
  excerpt: 500,
  curatorNote: 500,
  quote: 240
});
const MODES = new Set(["evidence-rules", "manual", "ai"]);
const STATUSES = new Set(["draft", "published"]);
const ID_PATTERN = /^[a-zA-Z0-9_-]{1,120}$/;

const EXHIBITION_MIGRATION = Object.freeze({
  version: 5,
  name: "theme-exhibitions",
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS exhibitions (
        id TEXT PRIMARY KEY,
        schema_version INTEGER NOT NULL DEFAULT 5 CHECK (schema_version = 5),
        title TEXT NOT NULL,
        theme TEXT NOT NULL DEFAULT '',
        opening TEXT NOT NULL DEFAULT '',
        mode TEXT NOT NULL DEFAULT 'evidence-rules'
          CHECK (mode IN ('evidence-rules', 'manual', 'ai')),
        status TEXT NOT NULL DEFAULT 'draft'
          CHECK (status IN ('draft', 'published')),
        needs_review INTEGER NOT NULL DEFAULT 0 CHECK (needs_review IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        published_at TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS exhibition_sections (
        id TEXT PRIMARY KEY,
        exhibition_id TEXT NOT NULL,
        position INTEGER NOT NULL CHECK (position >= 0),
        title TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (exhibition_id, position),
        UNIQUE (id, exhibition_id),
        FOREIGN KEY (exhibition_id) REFERENCES exhibitions(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS exhibition_items (
        id TEXT PRIMARY KEY,
        exhibition_id TEXT NOT NULL,
        section_id TEXT NOT NULL,
        memory_id TEXT NOT NULL,
        position INTEGER NOT NULL CHECK (position >= 0),
        title TEXT NOT NULL,
        excerpt TEXT NOT NULL DEFAULT '',
        curator_note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (section_id, position),
        UNIQUE (exhibition_id, memory_id),
        UNIQUE (id, memory_id),
        FOREIGN KEY (section_id, exhibition_id)
          REFERENCES exhibition_sections(id, exhibition_id) ON DELETE CASCADE,
        FOREIGN KEY (exhibition_id) REFERENCES exhibitions(id) ON DELETE CASCADE,
        FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS exhibition_citations (
        id TEXT PRIMARY KEY,
        exhibition_item_id TEXT NOT NULL,
        memory_id TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
        quote_text TEXT NOT NULL,
        start_offset INTEGER NOT NULL CHECK (start_offset >= 0),
        end_offset INTEGER NOT NULL CHECK (end_offset > start_offset),
        evidence_valid INTEGER NOT NULL DEFAULT 1 CHECK (evidence_valid IN (0, 1)),
        field TEXT NOT NULL DEFAULT 'rawContent' CHECK (field = 'rawContent'),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (exhibition_item_id, position),
        FOREIGN KEY (exhibition_item_id, memory_id)
          REFERENCES exhibition_items(id, memory_id) ON DELETE CASCADE,
        FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_exhibitions_updated
        ON exhibitions(status, updated_at);
      CREATE INDEX IF NOT EXISTS idx_exhibition_sections_parent
        ON exhibition_sections(exhibition_id, position);
      CREATE INDEX IF NOT EXISTS idx_exhibition_items_parent
        ON exhibition_items(exhibition_id, section_id, position);
      CREATE INDEX IF NOT EXISTS idx_exhibition_items_memory
        ON exhibition_items(memory_id, exhibition_id);
      CREATE INDEX IF NOT EXISTS idx_exhibition_citations_item
        ON exhibition_citations(exhibition_item_id, position);
      CREATE INDEX IF NOT EXISTS idx_exhibition_citations_memory
        ON exhibition_citations(memory_id, evidence_valid);

      CREATE TRIGGER IF NOT EXISTS prune_exhibitions_after_memory_delete
      AFTER DELETE ON memories
      BEGIN
        DELETE FROM exhibition_sections
        WHERE NOT EXISTS (
          SELECT 1 FROM exhibition_items item
          WHERE item.section_id = exhibition_sections.id
        );
        DELETE FROM exhibitions
        WHERE (
          SELECT COUNT(*) FROM exhibition_items item
          WHERE item.exhibition_id = exhibitions.id
        ) < 2;
      END;

      CREATE TRIGGER IF NOT EXISTS mark_exhibitions_for_review_before_memory_delete
      BEFORE DELETE ON memories
      BEGIN
        UPDATE exhibitions
        SET needs_review = 1, status = 'draft', published_at = ''
        WHERE id IN (
          SELECT exhibition_id FROM exhibition_items WHERE memory_id = OLD.id
        );
      END;
    `);
  }
});

function initializeExhibitionDatabase(options = {}) {
  const db = requireDatabase(options.db);
  const now = typeof options.now === "function" ? options.now : () => new Date().toISOString();
  const createId = typeof options.createId === "function"
    ? options.createId
    : (prefix) => `${prefix}-${randomUUID()}`;
  const suppliedTransaction = typeof options.withTransaction === "function" ? options.withTransaction : null;

  const supportedVersion = Math.max(5, Number(options.schemaVersion) || 5);
  applyMigrations({ db, baselineVersion: 4, migrations: [EXHIBITION_MIGRATION], supportedVersion, now });

  const statements = {
    count: db.prepare("SELECT COUNT(*) AS count FROM exhibitions"),
    countPublished: db.prepare("SELECT COUNT(*) AS count FROM exhibitions WHERE status = 'published'"),
    list: db.prepare(`
      SELECT exhibition.*,
        (SELECT COUNT(*) FROM exhibition_sections section WHERE section.exhibition_id = exhibition.id) AS section_count,
        (SELECT COUNT(*) FROM exhibition_items item WHERE item.exhibition_id = exhibition.id) AS item_count
      FROM exhibitions exhibition
      ORDER BY datetime(exhibition.updated_at) DESC, datetime(exhibition.created_at) DESC, exhibition.id
    `),
    get: db.prepare("SELECT * FROM exhibitions WHERE id = ?"),
    insert: db.prepare(`
      INSERT INTO exhibitions (
        id, schema_version, title, theme, opening, mode, status, needs_review,
        created_at, updated_at, published_at
      ) VALUES (?, 5, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    update: db.prepare(`
      UPDATE exhibitions SET
        title = ?, theme = ?, opening = ?, mode = ?, status = ?,
        needs_review = ?, updated_at = ?, published_at = ?
      WHERE id = ?
    `),
    delete: db.prepare("DELETE FROM exhibitions WHERE id = ?"),
    clear: db.prepare("DELETE FROM exhibitions"),
    deleteSections: db.prepare("DELETE FROM exhibition_sections WHERE exhibition_id = ?"),
    insertSection: db.prepare(`
      INSERT INTO exhibition_sections (
        id, exhibition_id, position, title, summary, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `),
    sectionsFor: db.prepare("SELECT * FROM exhibition_sections WHERE exhibition_id = ? ORDER BY position, id"),
    insertItem: db.prepare(`
      INSERT INTO exhibition_items (
        id, exhibition_id, section_id, memory_id, position, title, excerpt,
        curator_note, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    itemsForSection: db.prepare("SELECT * FROM exhibition_items WHERE section_id = ? ORDER BY position, id"),
    insertCitation: db.prepare(`
      INSERT INTO exhibition_citations (
        id, exhibition_item_id, memory_id, position, quote_text, start_offset,
        end_offset, evidence_valid, field, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    citationsForItem: db.prepare("SELECT * FROM exhibition_citations WHERE exhibition_item_id = ? ORDER BY position, id"),
    citationsForMemory: db.prepare(`
      SELECT citation.* FROM exhibition_citations citation
      WHERE citation.memory_id = ? ORDER BY citation.id
    `),
    updateCitationValidity: db.prepare(`
      UPDATE exhibition_citations SET evidence_valid = ?, updated_at = ? WHERE id = ?
    `),
    markReviewByMemory: db.prepare(`
      UPDATE exhibitions
      SET needs_review = 1, status = 'draft', published_at = '', updated_at = ?
      WHERE id IN (SELECT exhibition_id FROM exhibition_items WHERE memory_id = ?)
    `),
    getMemory: db.prepare("SELECT id, title, raw_content FROM memories WHERE id = ?")
  };

  function runAtomic(operation) {
    if (suppliedTransaction) return suppliedTransaction(operation);
    const savepoint = `exhibition_write_${randomUUID().replace(/-/g, "")}`;
    db.exec(`SAVEPOINT ${savepoint}`);
    try {
      const result = operation();
      if (result && typeof result.then === "function") throw new TypeError("展览数据库事务必须同步执行。");
      db.exec(`RELEASE SAVEPOINT ${savepoint}`);
      return result;
    } catch (error) {
      try { db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`); } catch { /* keep original failure */ }
      try { db.exec(`RELEASE SAVEPOINT ${savepoint}`); } catch { /* keep original failure */ }
      throw error;
    }
  }

  function listExhibitions() {
    return statements.list.all().map(rowToSummary);
  }

  function getExhibition(id) {
    const normalizedId = requireExhibitionId(id, "exhibition id");
    const row = statements.get.get(normalizedId);
    return row ? hydrateExhibition(row) : null;
  }

  function createExhibition(input = {}) {
    requireConfirmation(input);
    if (Number(statements.count.get()?.count) >= LIMITS.exhibitions) {
      throw exhibitionError(`最多保存 ${LIMITS.exhibitions} 个主题展览。`, "EXHIBITION_LIMIT_REACHED", 409);
    }
    const requestedId = input.id ? requireExhibitionId(input.id, "exhibition.id") : newId("exhibition");
    if (statements.get.get(requestedId)) throw exhibitionError("主题展览 ID 已存在。", "EXHIBITION_EXISTS", 409);
    const timestamp = requireTimestamp(now());
    const normalized = normalizeExhibition({ ...input, id: requestedId, needsReview: false }, null, timestamp);
    return runAtomic(() => writeExhibition(normalized, false));
  }

  function updateExhibition(id, patch = {}) {
    requireConfirmation(patch);
    const normalizedId = requireExhibitionId(id, "exhibition id");
    const existing = getExhibition(normalizedId);
    if (!existing) throw exhibitionError("没有找到这个主题展览。", "EXHIBITION_NOT_FOUND", 404);
    const timestamp = requireTimestamp(now());
    const normalized = normalizeExhibition({ ...existing, ...patch, id: normalizedId, needsReview: false }, existing, timestamp);
    return runAtomic(() => writeExhibition(normalized, true));
  }

  function deleteExhibition(id) {
    const normalizedId = requireExhibitionId(id, "exhibition id");
    return runAtomic(() => statements.delete.run(normalizedId).changes > 0);
  }

  function clearExhibitions() {
    const count = Number(statements.count.get()?.count) || 0;
    return runAtomic(() => {
      statements.clear.run();
      return { exhibitionsDeleted: count };
    });
  }

  function getExhibitionStats() {
    const summaries = listExhibitions();
    return {
      exhibitions: summaries.length,
      published: Number(statements.countPublished.get()?.count) || 0,
      sections: summaries.reduce((sum, item) => sum + item.sectionCount, 0),
      items: summaries.reduce((sum, item) => sum + item.itemCount, 0)
    };
  }

  function revalidateCitationsForMemory(memoryId) {
    const id = requireId(memoryId, "memoryId");
    const memory = statements.getMemory.get(id);
    if (!memory) return [];
    const raw = String(memory.raw_content || "");
    const timestamp = requireTimestamp(now());
    return runAtomic(() => {
      const citations = statements.citationsForMemory.all(id).map((row) => {
        const startOffset = Number(row.start_offset);
        const endOffset = Number(row.end_offset);
        const valid = Number.isSafeInteger(startOffset) && Number.isSafeInteger(endOffset) &&
          startOffset >= 0 && endOffset > startOffset && endOffset <= raw.length &&
          raw.slice(startOffset, endOffset) === row.quote_text;
        statements.updateCitationValidity.run(valid ? 1 : 0, timestamp, row.id);
        return { ...rowToCitation(row), evidenceValid: valid, updatedAt: timestamp };
      });
      if (citations.some((citation) => !citation.evidenceValid)) statements.markReviewByMemory.run(timestamp, id);
      return citations;
    });
  }

  function buildExhibitionBackup(mode = "full") {
    if (mode === "redacted") {
      const stats = getExhibitionStats();
      return {
        mode: "redacted-summary",
        exhibitionCount: stats.exhibitions,
        publishedCount: stats.published,
        note: "展览叙事、成员和原文引用已从脱敏备份中移除。"
      };
    }
    return {
      mode: "full",
      schemaVersion: 5,
      exhibitions: listExhibitions().map((summary) => getExhibition(summary.id))
    };
  }

  function validateExhibitionBackup(backup, sourceMemoryIds) {
    if (!backup || typeof backup !== "object" || Array.isArray(backup)) throw new TypeError("主题展览备份格式无效。");
    if (backup.mode === "redacted-summary") return true;
    if (backup.mode !== "full" || backup.schemaVersion !== 5 || !Array.isArray(backup.exhibitions) || backup.exhibitions.length > LIMITS.exhibitions) {
      throw exhibitionError("主题展览备份数量或模式无效。", "EXHIBITION_BACKUP_INVALID", 400);
    }
    const existingCount = Number(statements.count.get()?.count) || 0;
    if (existingCount + backup.exhibitions.length > LIMITS.exhibitions) {
      throw exhibitionError(`恢复后主题展览不能超过 ${LIMITS.exhibitions} 个。`, "EXHIBITION_LIMIT_REACHED", 409);
    }
    const memorySet = new Set(Array.isArray(sourceMemoryIds) ? sourceMemoryIds : []);
    const exhibitionIds = new Set();
    backup.exhibitions.forEach((exhibition, exhibitionIndex) => {
      if (!exhibition || typeof exhibition !== "object" || Array.isArray(exhibition)) throw exhibitionError("主题展览备份条目无效。", "EXHIBITION_BACKUP_INVALID", 400);
      const id = requireExhibitionId(exhibition.id, `exhibitions[${exhibitionIndex}].id`);
      if (exhibitionIds.has(id)) throw exhibitionError("主题展览备份包含重复 ID。", "EXHIBITION_BACKUP_INVALID", 400);
      exhibitionIds.add(id);
      requireText(exhibition.title, `exhibitions[${exhibitionIndex}].title`, LIMITS.title);
      validateOptionalText(exhibition.theme, LIMITS.theme, `exhibitions[${exhibitionIndex}].theme`);
      validateOptionalText(exhibition.opening, LIMITS.opening, `exhibitions[${exhibitionIndex}].opening`);
      requireEnum(exhibition.mode, MODES, `exhibitions[${exhibitionIndex}].mode`);
      const status = requireEnum(exhibition.status, STATUSES, `exhibitions[${exhibitionIndex}].status`);
      if (exhibition.needsReview !== undefined && typeof exhibition.needsReview !== "boolean") {
        throw exhibitionError("主题展览复核状态无效。", "EXHIBITION_BACKUP_INVALID", 400);
      }
      requireTimestamp(exhibition.createdAt);
      if (status === "published") requireTimestamp(exhibition.publishedAt);
      const sections = requireArray(exhibition.sections, 1, LIMITS.sections, "exhibition.sections");
      const memberIds = sections.flatMap((section, sectionIndex) => {
        if (!section || typeof section !== "object" || Array.isArray(section)) throw exhibitionError("主题展览章节无效。", "EXHIBITION_BACKUP_INVALID", 400);
        if (section.id) requireId(section.id, `sections[${sectionIndex}].id`);
        requireText(section.title, `sections[${sectionIndex}].title`, LIMITS.sectionTitle);
        validateOptionalText(section.summary, LIMITS.sectionSummary, `sections[${sectionIndex}].summary`);
        requireTimestamp(section.createdAt);
        return requireArray(section.items, 1, LIMITS.items, "section.items").map((item, itemIndex) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) throw exhibitionError("主题展览成员无效。", "EXHIBITION_BACKUP_INVALID", 400);
          if (item.id) requireId(item.id, `items[${itemIndex}].id`);
          const memoryId = requireId(item.memoryId, `items[${itemIndex}].memoryId`);
          requireText(item.title, `items[${itemIndex}].title`, LIMITS.title);
          validateOptionalText(item.excerpt, LIMITS.excerpt, `items[${itemIndex}].excerpt`);
          validateOptionalText(item.curatorNote, LIMITS.curatorNote, `items[${itemIndex}].curatorNote`);
          requireTimestamp(item.createdAt);
          requireArray(item.citations, 1, LIMITS.citationsPerItem, "item.citations").forEach((citation, citationIndex) => {
            if (!citation || typeof citation !== "object" || Array.isArray(citation)) throw exhibitionError("主题展览引用无效。", "EXHIBITION_BACKUP_INVALID", 400);
            if (citation.id) requireId(citation.id, `citations[${citationIndex}].id`);
            requireText(citation.quote, `citations[${citationIndex}].quote`, LIMITS.quote);
            const startOffset = requireInteger(citation.startOffset, `citations[${citationIndex}].startOffset`, 0, 20000);
            requireInteger(citation.endOffset, `citations[${citationIndex}].endOffset`, startOffset + 1, 20000);
            requireEnum(citation.field, new Set(["rawContent"]), `citations[${citationIndex}].field`);
            requireTimestamp(citation.createdAt);
          });
          return memoryId;
        });
      });
      if (memberIds.length < 2 || memberIds.length > LIMITS.items || new Set(memberIds).size !== memberIds.length) {
        throw exhibitionError("主题展览备份成员数量或唯一性无效。", "EXHIBITION_BACKUP_INVALID", 400);
      }
      if (memberIds.some((memoryId) => !memorySet.has(memoryId))) {
        throw exhibitionError("主题展览引用了备份之外的展品。", "EXHIBITION_BACKUP_REFERENCE_INVALID", 400);
      }
    });
    return true;
  }

  function restoreExhibitionBackup(backup, memoryIdMap) {
    if (backup?.mode === "redacted-summary") return { exhibitions: 0, skipped: 0, idMap: {} };
    const sourceIds = Array.isArray(backup?.exhibitions)
      ? [...new Set(backup.exhibitions.flatMap((exhibition) => (exhibition.sections || []).flatMap((section) => (section.items || []).map((item) => item.memoryId))))]
      : [];
    validateExhibitionBackup(backup, sourceIds);
    if ((Number(statements.count.get()?.count) || 0) + backup.exhibitions.length > LIMITS.exhibitions) {
      throw exhibitionError(`恢复后主题展览不能超过 ${LIMITS.exhibitions} 个。`, "EXHIBITION_LIMIT_REACHED", 409);
    }
    const mapping = normalizeIdMap(memoryIdMap);
    const occupied = new Set(listExhibitions().map((item) => item.id));
    const resultMap = new Map();
    let restored = 0;

    runAtomic(() => {
      for (const source of backup.exhibitions) {
        let id = source.id;
        if (occupied.has(id)) id = uniqueId("exhibition", occupied);
        occupied.add(id);
        const sections = source.sections.map((section) => ({
          title: section.title,
          summary: section.summary,
          items: section.items.map((item) => {
            const mappedMemoryId = mapping.get(item.memoryId);
            if (!mappedMemoryId) throw exhibitionError("主题展览恢复缺少展品 ID 映射。", "EXHIBITION_BACKUP_REFERENCE_INVALID", 400);
            return {
              memoryId: mappedMemoryId,
              title: item.title,
              excerpt: item.excerpt,
              curatorNote: item.curatorNote,
              citations: item.citations.map((citation) => ({
                quote: citation.quote,
                startOffset: citation.startOffset,
                endOffset: citation.endOffset,
                field: citation.field
              }))
            };
          })
        }));
        const timestamp = requireTimestamp(now());
        const normalized = normalizeExhibition({
          id,
          title: source.title,
          theme: source.theme,
          opening: source.opening,
          mode: source.mode,
          status: source.status,
          needsReview: Boolean(source.needsReview),
          sections,
          createdAt: source.createdAt,
          publishedAt: source.publishedAt,
          confirmed: true
        }, null, timestamp, { allowInvalidCitations: true });
        writeExhibition(normalized, false);
        resultMap.set(source.id, id);
        restored += 1;
      }
    });
    return { exhibitions: restored, skipped: 0, idMap: Object.fromEntries(resultMap) };
  }

  function writeExhibition(exhibition, updating) {
    if (updating) {
      statements.update.run(
        exhibition.title,
        exhibition.theme,
        exhibition.opening,
        exhibition.mode,
        exhibition.status,
        exhibition.needsReview ? 1 : 0,
        exhibition.updatedAt,
        exhibition.publishedAt,
        exhibition.id
      );
      statements.deleteSections.run(exhibition.id);
    } else {
      statements.insert.run(
        exhibition.id,
        exhibition.title,
        exhibition.theme,
        exhibition.opening,
        exhibition.mode,
        exhibition.status,
        exhibition.needsReview ? 1 : 0,
        exhibition.createdAt,
        exhibition.updatedAt,
        exhibition.publishedAt
      );
    }

    exhibition.sections.forEach((section, sectionPosition) => {
      statements.insertSection.run(
        section.id,
        exhibition.id,
        sectionPosition,
        section.title,
        section.summary,
        section.createdAt,
        exhibition.updatedAt
      );
      section.items.forEach((item, itemPosition) => {
        statements.insertItem.run(
          item.id,
          exhibition.id,
          section.id,
          item.memoryId,
          itemPosition,
          item.title,
          item.excerpt,
          item.curatorNote,
          item.createdAt,
          exhibition.updatedAt
        );
        item.citations.forEach((citation, citationPosition) => statements.insertCitation.run(
          citation.id,
          item.id,
          item.memoryId,
          citationPosition,
          citation.quote,
          citation.startOffset,
          citation.endOffset,
          citation.evidenceValid ? 1 : 0,
          citation.field,
          citation.createdAt,
          exhibition.updatedAt
        ));
      });
    });
    return getExhibition(exhibition.id);
  }

  function normalizeExhibition(input, existing, timestamp, normalizationOptions = {}) {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("exhibition 必须是对象。");
    const id = requireExhibitionId(input.id, "exhibition.id");
    const requestedStatus = requireEnum(input.status || existing?.status || "draft", STATUSES, "exhibition.status");
    const mode = requireEnum(input.mode || existing?.mode || "evidence-rules", MODES, "exhibition.mode");
    const sections = normalizeSections(input.sections, timestamp, normalizationOptions);
    const needsReview = Boolean(input.needsReview) || sections.some((section) => (
      section.items.some((item) => item.citations.some((citation) => !citation.evidenceValid))
    ));
    const status = needsReview ? "draft" : requestedStatus;
    const createdAt = normalizeTimestamp(input.createdAt || existing?.createdAt, timestamp);
    const publishedAt = status === "published"
      ? normalizeTimestamp(input.publishedAt || existing?.publishedAt, timestamp)
      : "";
    return {
      id,
      title: requireText(input.title, "exhibition.title", LIMITS.title),
      theme: optionalText(input.theme, LIMITS.theme),
      opening: optionalText(input.opening, LIMITS.opening),
      mode,
      status,
      needsReview,
      createdAt,
      updatedAt: timestamp,
      publishedAt,
      sections
    };
  }

  function normalizeSections(value, timestamp, normalizationOptions = {}) {
    const sections = requireArray(value, 1, LIMITS.sections, "exhibition.sections");
    const seenMemories = new Set();
    const normalized = sections.map((section, sectionIndex) => {
      if (!section || typeof section !== "object" || Array.isArray(section)) throw new TypeError(`sections[${sectionIndex}] 必须是对象。`);
      const sectionId = section.id ? requireId(section.id, `sections[${sectionIndex}].id`) : newId("section");
      const items = requireArray(section.items, 1, LIMITS.items, `sections[${sectionIndex}].items`).map((item, itemIndex) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) throw new TypeError(`sections[${sectionIndex}].items[${itemIndex}] 必须是对象。`);
        const memoryId = requireId(item.memoryId, `sections[${sectionIndex}].items[${itemIndex}].memoryId`);
        if (seenMemories.has(memoryId)) throw exhibitionError("同一件展品在一个主题展览中只能出现一次。", "EXHIBITION_MEMORY_DUPLICATE", 400);
        seenMemories.add(memoryId);
        const memory = statements.getMemory.get(memoryId);
        if (!memory) throw exhibitionError(`没有找到展品 ${memoryId}。`, "EXHIBITION_MEMORY_NOT_FOUND", 404);
        const itemId = item.id ? requireId(item.id, `items[${itemIndex}].id`) : newId("exhibit-item");
        const citations = requireArray(item.citations, 1, LIMITS.citationsPerItem, `items[${itemIndex}].citations`).map((citation, citationIndex) => (
          normalizeCitation(citation, citationIndex, itemId, memory, timestamp, normalizationOptions)
        ));
        return {
          id: itemId,
          memoryId,
          title: requireText(item.title || memory.title, `items[${itemIndex}].title`, LIMITS.title),
          excerpt: optionalText(item.excerpt, LIMITS.excerpt),
          curatorNote: optionalText(item.curatorNote, LIMITS.curatorNote),
          createdAt: normalizeTimestamp(item.createdAt, timestamp),
          citations
        };
      });
      return {
        id: sectionId,
        title: requireText(section.title, `sections[${sectionIndex}].title`, LIMITS.sectionTitle),
        summary: optionalText(section.summary, LIMITS.sectionSummary),
        createdAt: normalizeTimestamp(section.createdAt, timestamp),
        items
      };
    });
    if (seenMemories.size < 2 || seenMemories.size > LIMITS.items) {
      throw exhibitionError(`主题展览必须包含 2 至 ${LIMITS.items} 件不同展品。`, "EXHIBITION_MEMORY_COUNT_INVALID", 400);
    }
    return normalized;
  }

  function normalizeCitation(input, index, itemId, memory, timestamp, normalizationOptions = {}) {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError(`citations[${index}] 必须是对象。`);
    const quote = requireText(input.quote, `citations[${index}].quote`, LIMITS.quote);
    const allowInvalid = normalizationOptions.allowInvalidCitations === true;
    const maximumOffset = allowInvalid ? 20000 : memory.raw_content.length;
    const startOffset = requireInteger(input.startOffset, `citations[${index}].startOffset`, 0, maximumOffset);
    const endOffset = requireInteger(input.endOffset, `citations[${index}].endOffset`, startOffset + 1, maximumOffset);
    const evidenceValid = endOffset <= memory.raw_content.length && memory.raw_content.slice(startOffset, endOffset) === quote;
    if (!evidenceValid && !allowInvalid) {
      throw exhibitionError(`展品 ${memory.id} 的原文引用无法核验。`, "EXHIBITION_EVIDENCE_INVALID", 400);
    }
    return {
      id: input.id ? requireId(input.id, `citations[${index}].id`) : newId("citation"),
      itemId,
      quote,
      startOffset,
      endOffset,
      evidenceValid,
      field: input.field === undefined ? "rawContent" : requireEnum(input.field, new Set(["rawContent"]), `citations[${index}].field`),
      createdAt: normalizeTimestamp(input.createdAt, timestamp)
    };
  }

  function hydrateExhibition(row) {
    const sections = statements.sectionsFor.all(row.id).map((section) => ({
      id: section.id,
      title: section.title,
      summary: section.summary || "",
      items: statements.itemsForSection.all(section.id).map((item) => ({
        id: item.id,
        memoryId: item.memory_id,
        title: item.title,
        excerpt: item.excerpt || "",
        curatorNote: item.curator_note || "",
        citations: statements.citationsForItem.all(item.id).map(rowToCitation),
        createdAt: item.created_at,
        updatedAt: item.updated_at
      })),
      createdAt: section.created_at,
      updatedAt: section.updated_at
    }));
    const needsReview = Boolean(row.needs_review) || sections.some((section) => (
      section.items.some((item) => item.citations.some((citation) => !citation.evidenceValid))
    ));
    return {
      id: row.id,
      title: row.title,
      theme: row.theme || "",
      opening: row.opening || "",
      mode: row.mode,
      status: row.status,
      needsReview,
      requiresConfirmation: needsReview,
      memoryIds: sections.flatMap((section) => section.items.map((item) => item.memoryId)),
      sections,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      publishedAt: row.published_at || ""
    };
  }

  function rowToSummary(row) {
    return {
      id: row.id,
      title: row.title,
      theme: row.theme || "",
      status: row.status,
      mode: row.mode,
      needsReview: Boolean(row.needs_review),
      requiresConfirmation: Boolean(row.needs_review),
      sectionCount: Number(row.section_count) || 0,
      itemCount: Number(row.item_count) || 0,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      publishedAt: row.published_at || ""
    };
  }

  function rowToCitation(row) {
    return {
      id: row.id,
      quote: row.quote_text,
      startOffset: Number(row.start_offset),
      endOffset: Number(row.end_offset),
      evidenceValid: Boolean(row.evidence_valid),
      field: row.field,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  function newId(prefix) {
    return requireId(createId(prefix), `${prefix} id`);
  }

  function uniqueId(prefix, occupied) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const id = newId(prefix);
      if (!occupied.has(id)) return id;
    }
    throw exhibitionError("无法生成唯一主题展览 ID。", "EXHIBITION_ID_EXHAUSTED", 500);
  }

  return Object.freeze({
    limits: LIMITS,
    listExhibitions,
    getExhibition,
    createExhibition,
    updateExhibition,
    deleteExhibition,
    clearExhibitions,
    getExhibitionStats,
    revalidateCitationsForMemory,
    buildExhibitionBackup,
    validateExhibitionBackup,
    restoreExhibitionBackup
  });
}

function requireConfirmation(input) {
  if (input?.confirmed !== true && input?.confirm !== true) {
    throw exhibitionError("保存主题展览前必须由用户明确确认。", "EXHIBITION_CONFIRMATION_REQUIRED", 400);
  }
}

function normalizeIdMap(value) {
  if (value instanceof Map) return value;
  if (value && typeof value === "object" && !Array.isArray(value)) return new Map(Object.entries(value));
  throw new TypeError("memoryIdMap 必须是 Map 或对象。");
}

function requireDatabase(db) {
  if (!db || typeof db.exec !== "function" || typeof db.prepare !== "function") {
    throw new TypeError("initializeExhibitionDatabase 需要同步 SQLite 数据库连接。");
  }
  return db;
}

function requireId(value, name) {
  const id = String(value || "").trim();
  if (!ID_PATTERN.test(id)) throw exhibitionError(`${name} 无效。`, "EXHIBITION_ID_INVALID", 400);
  return id;
}

function requireExhibitionId(value, name) {
  const id = requireId(value, name);
  if (id === "preview") throw exhibitionError(`${name} 使用了保留名称。`, "EXHIBITION_ID_INVALID", 400);
  return id;
}

function requireArray(value, minimum, maximum, name) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    throw exhibitionError(`${name} 必须包含 ${minimum} 至 ${maximum} 项。`, "EXHIBITION_LIMIT_INVALID", 400);
  }
  return value;
}

function requireText(value, name, maximum) {
  const text = String(value || "").trim();
  if (!text || text.length > maximum) throw exhibitionError(`${name} 不能为空且最多 ${maximum} 字。`, "EXHIBITION_TEXT_INVALID", 400);
  return text;
}

function optionalText(value, maximum) {
  return String(value || "").trim().slice(0, maximum);
}

function validateOptionalText(value, maximum, name) {
  const text = String(value || "").trim();
  if (text.length > maximum) throw exhibitionError(`${name} 最多 ${maximum} 字。`, "EXHIBITION_TEXT_INVALID", 400);
  return text;
}

function requireEnum(value, allowed, name) {
  const text = String(value || "");
  if (!allowed.has(text)) throw exhibitionError(`${name} 不在允许范围内。`, "EXHIBITION_VALUE_INVALID", 400);
  return text;
}

function requireInteger(value, name, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw exhibitionError(`${name} 必须是 ${minimum} 至 ${maximum} 的整数。`, "EXHIBITION_VALUE_INVALID", 400);
  }
  return value;
}

function requireTimestamp(value) {
  const text = String(value || "").trim();
  if (!text || Number.isNaN(Date.parse(text))) {
    throw exhibitionError("展览时间戳无效。", "EXHIBITION_VALUE_INVALID", 400);
  }
  return text.slice(0, 40);
}

function normalizeTimestamp(value, fallback) {
  const text = String(value || "").trim();
  return text && !Number.isNaN(Date.parse(text)) ? text.slice(0, 40) : fallback;
}

function exhibitionError(message, code, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

module.exports = {
  EXHIBITION_MIGRATION,
  EXHIBITION_LIMITS: LIMITS,
  initializeExhibitionDatabase
};
