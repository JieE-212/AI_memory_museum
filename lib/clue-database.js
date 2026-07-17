"use strict";

const { createHash, randomUUID } = require("node:crypto");
const { applyMigrations } = require("./migrations");
const {
  buildSearchPlan,
  mergeClueCandidates,
  normalizeClueText
} = require("./clue-service");
const {
  buildClueBackup: buildBackupContract,
  remapClueBackup,
  validateClueBackup: validateBackupContract
} = require("./clue-backup");

const ENTITY_TYPES = new Set(["person", "location", "theme"]);
const LEGACY_FIELDS = new Set(["people", "location", "tags"]);
const ID_PATTERN = /^[a-zA-Z0-9_-]{1,120}$/u;
const LIMITS = Object.freeze({
  aliasesPerEntity: 50,
  entityName: 200,
  list: 100,
  search: 50,
  searchCandidates: 250
});

const CLUE_MIGRATION = Object.freeze({
  version: 7,
  name: "search-and-entity-clues",
  up(db) {
    db.exec(`
      CREATE TABLE entities (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK (type IN ('person', 'location', 'theme')),
        canonical_name TEXT NOT NULL,
        normalized_name TEXT NOT NULL,
        provenance TEXT NOT NULL DEFAULT 'legacy'
          CHECK (provenance IN ('legacy', 'user', 'merge', 'import')),
        resolution_status TEXT NOT NULL DEFAULT 'same-name-clue'
          CHECK (resolution_status IN ('same-name-clue', 'confirmed')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE entity_aliases (
        id TEXT PRIMARY KEY,
        entity_id TEXT NOT NULL,
        alias TEXT NOT NULL,
        normalized_alias TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'user'
          CHECK (source IN ('user', 'merge', 'import')),
        confirmed_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (entity_id, normalized_alias),
        FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE
      );

      CREATE TABLE memory_entities (
        memory_id TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        source_field TEXT NOT NULL
          CHECK (source_field IN ('people', 'location', 'tags', 'manual')),
        mention_text TEXT NOT NULL DEFAULT '',
        confidence REAL NOT NULL DEFAULT 1 CHECK (confidence >= 0 AND confidence <= 1),
        reason TEXT NOT NULL DEFAULT '',
        confirmed_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (memory_id, entity_id),
        FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE,
        FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE
      );

      CREATE TABLE memory_search_documents (
        id INTEGER PRIMARY KEY,
        memory_id TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL DEFAULT '',
        exhibit_text TEXT NOT NULL DEFAULT '',
        raw_content TEXT NOT NULL DEFAULT '',
        location_text TEXT NOT NULL DEFAULT '',
        people_text TEXT NOT NULL DEFAULT '',
        tags_text TEXT NOT NULL DEFAULT '',
        emotions_text TEXT NOT NULL DEFAULT '',
        source_text TEXT NOT NULL DEFAULT '',
        entity_text TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL,
        FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
      );

      CREATE INDEX idx_entities_type_name
        ON entities(type, normalized_name, id);
      CREATE INDEX idx_entity_aliases_name
        ON entity_aliases(normalized_alias, entity_id);
      CREATE INDEX idx_memory_entities_entity
        ON memory_entities(entity_id, memory_id);
      CREATE INDEX idx_memory_entities_source
        ON memory_entities(memory_id, source_field, mention_text);
      CREATE INDEX idx_memory_search_documents_memory
        ON memory_search_documents(memory_id);

      CREATE TRIGGER prune_clue_entities_after_memory_delete
      AFTER DELETE ON memories
      BEGIN
        DELETE FROM entities
        WHERE NOT EXISTS (
          SELECT 1 FROM memory_entities link WHERE link.entity_id = entities.id
        );
      END;
    `);

    createFtsSchema(db);
    backfillLegacyClues(db);
  }
});

function initializeClueDatabase(options = {}) {
  const db = requireDatabase(options.db);
  const now = typeof options.now === "function" ? options.now : () => new Date().toISOString();
  const createId = typeof options.createId === "function"
    ? options.createId
    : (prefix) => `${prefix}-${randomUUID()}`;
  const suppliedTransaction = typeof options.withTransaction === "function" ? options.withTransaction : null;

  if (options.applyMigrations !== false) {
    const supportedVersion = Math.max(7, Number(options.schemaVersion) || 7);
    applyMigrations({ db, baselineVersion: 4, migrations: [CLUE_MIGRATION], supportedVersion, now });
  }

  const statements = prepareStatements(db);
  let ftsOperational = tableExists(db, "memory_search_fts");

  function runAtomic(operation) {
    if (suppliedTransaction) return suppliedTransaction(operation);
    const savepoint = `clue_write_${randomUUID().replace(/-/gu, "")}`;
    db.exec(`SAVEPOINT ${savepoint}`);
    try {
      const result = operation();
      if (result && typeof result.then === "function") throw new TypeError("线索数据库事务必须同步执行。");
      db.exec(`RELEASE SAVEPOINT ${savepoint}`);
      return result;
    } catch (error) {
      try { db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`); } catch { /* preserve original error */ }
      try { db.exec(`RELEASE SAVEPOINT ${savepoint}`); } catch { /* preserve original error */ }
      throw error;
    }
  }

  function syncMemoryClues(memoryId) {
    const id = requireId(memoryId, "memoryId");
    if (!statements.getMemory.get(id)) {
      throw clueError(`没有找到展品 ${id}。`, "CLUE_MEMORY_NOT_FOUND", 404);
    }
    return runAtomic(() => syncMemoryCluesInternal(id));
  }

  function syncMemoryCluesInternal(memoryId) {
    syncLegacyEntityLinks(memoryId);
    writeSearchDocument(db, memoryId, requireTimestamp(now(), "now"));
    return {
      memoryId,
      entityRefs: getMemoryEntityRefs(memoryId),
      indexed: Boolean(statements.getDocument.get(memoryId))
    };
  }

  function removeMemoryClues(memoryId) {
    const id = requireId(memoryId, "memoryId");
    return runAtomic(() => {
      const documentDeleted = statements.deleteDocument.run(id).changes > 0;
      const linksDeleted = statements.deleteMemoryLinks.run(id).changes;
      const entitiesPruned = pruneOrphanEntities();
      return { memoryId: id, documentDeleted, linksDeleted, entitiesPruned };
    });
  }

  function rebuildClueIndex() {
    return runAtomic(() => {
      const ids = statements.listMemoryIds.all().map((row) => row.id);
      ids.forEach(syncMemoryCluesInternal);
      const staleDocumentsDeleted = statements.deleteStaleDocuments.run().changes;
      const entitiesPruned = pruneOrphanEntities();
      return { memoriesIndexed: ids.length, staleDocumentsDeleted, entitiesPruned };
    });
  }

  function searchClues(query, options = {}) {
    const limit = requireLimit(options.limit, LIMITS.search, 12);
    const plan = buildSearchPlan(query, options.ruleExpansions || []);
    if (!plan.directTerms.length && !plan.expandedTerms.length) {
      const recent = statements.recentDocuments.all(limit).map((row) => candidateFromRow(row));
      return {
        query: plan.normalizedQuery,
        strategy: "recent",
        usedFallback: false,
        directTerms: [],
        expandedTerms: [],
        results: recent.map((candidate) => ({
          memory: candidate.memory,
          memoryId: candidate.memoryId,
          score: 0,
          matchedTerms: [],
          matchedFields: [],
          confidence: "weak",
          reason: "没有有效检索词，按最近记录返回。",
          evidence: [],
          directEvidenceCount: 0,
          retrievalSources: ["recent"]
        }))
      };
    }

    let ftsCandidates = [];
    let ftsUsed = false;
    if (ftsOperational && plan.ftsQuery) {
      try {
        ftsCandidates = searchFts(plan.ftsQuery, Math.min(LIMITS.searchCandidates, limit * 8));
        ftsUsed = true;
      } catch (error) {
        if (!isFtsUnavailable(error)) throw error;
        ftsOperational = false;
      }
    }

    const likeTerms = ftsUsed
      ? plan.likeTerms.filter((entry) => entry.short)
      : plan.likeTerms;
    const likeCandidates = likeTerms.length
      ? searchLike(likeTerms, Math.min(LIMITS.searchCandidates, limit * 8))
      : [];
    const scored = mergeClueCandidates({
      ftsCandidates,
      likeCandidates,
      entityCandidates: [],
      directTerms: plan.directTerms,
      expandedTerms: plan.expandedTerms
    }).filter((item) => item.score > 0).slice(0, limit);

    return {
      query: plan.normalizedQuery,
      strategy: ftsUsed && likeCandidates.length ? "fts5-trigram+like" : ftsUsed ? "fts5-trigram" : "like",
      usedFallback: !ftsUsed || plan.shortQueryFallback,
      directTerms: plan.directTerms,
      expandedTerms: plan.expandedTerms,
      results: scored
    };
  }

  function searchFts(ftsQuery, limit) {
    const voiceWeight = columnExists(db, "memory_search_documents", "voice_text") ? ", 3.0" : "";
    const rows = db.prepare(`
      SELECT document.*, bm25(memory_search_fts, 7.0, 4.0, 3.0, 4.0, 5.0, 5.0, 3.0, 2.0, 5.0${voiceWeight}) AS fts_rank
      FROM memory_search_fts
      JOIN memory_search_documents document ON document.id = memory_search_fts.rowid
      WHERE memory_search_fts MATCH ?
      ORDER BY fts_rank, document.memory_id
      LIMIT ?
    `).all(ftsQuery, limit);
    return rows.map((row) => candidateFromRow(row, "fts"));
  }

  function searchLike(terms, limit) {
    const columns = [
      "title", "exhibit_text", "raw_content", "location_text", "people_text",
      "tags_text", "emotions_text", "source_text", "entity_text"
    ];
    if (columnExists(db, "memory_search_documents", "voice_text")) columns.push("voice_text");
    const termClause = `(${columns.map((column) => `${column} LIKE ? ESCAPE '\\'`).join(" OR ")})`;
    const sql = `
      SELECT document.*
      FROM memory_search_documents document
      WHERE ${terms.map(() => termClause).join(" OR ")}
      ORDER BY document.memory_id
      LIMIT ?
    `;
    const parameters = terms.flatMap((entry) => columns.map(() => entry.pattern));
    const rows = db.prepare(sql).all(...parameters, limit);
    return rows.map((row) => candidateFromRow(row, "like"));
  }

  function candidateFromRow(row, source = "recent") {
    const memory = rowToSearchMemory(row, statements.getMemory.get(row.memory_id));
    const entityMatches = getMemoryEntityRefs(row.memory_id).map((ref) => ({
      entityId: ref.entityId,
      type: ref.type,
      canonicalName: ref.canonicalName,
      aliases: ref.aliases,
      sourceField: ref.sourceField,
      confirmedAt: ref.confirmedAt,
      confirmed: true
    }));
    return {
      memory,
      memoryId: row.memory_id,
      ftsRank: Number.isFinite(Number(row.fts_rank)) ? Number(row.fts_rank) : null,
      entityMatches,
      entityNames: [],
      retrievalSources: [source]
    };
  }

  function listEntities(filters = {}) {
    const input = isPlainObject(filters) ? filters : {};
    const type = input.type ? requireEntityType(input.type) : "";
    const query = normalizeOptionalText(input.query, "query", LIMITS.entityName);
    const pattern = `%${escapeLike(query)}%`;
    const limit = requireLimit(input.limit, LIMITS.list, 50);
    const offset = requireOffset(input.offset);
    return statements.listEntities.all(type, type, query, pattern, pattern, limit, offset).map(rowToEntitySummary);
  }

  function getEntityProfile(entityId) {
    const id = requireId(entityId, "entityId");
    const row = statements.getEntity.get(id);
    if (!row) return null;
    const memories = statements.memoriesForEntity.all(id).map(rowToEntityMemory);
    return {
      ...rowToEntity(row),
      aliases: statements.aliasesForEntity.all(id).map(rowToAlias),
      memories,
      memoryLinks: memories
    };
  }

  function getMemoryEntityRefs(memoryId) {
    const id = requireId(memoryId, "memoryId");
    return statements.entitiesForMemory.all(id).map((row) => ({
      entityId: row.id,
      type: row.type,
      canonicalName: row.canonical_name,
      resolutionStatus: row.resolution_status,
      sourceField: row.source_field,
      mentionText: row.mention_text,
      sourceValue: row.mention_text,
      confidence: Number(row.confidence),
      reason: row.reason,
      confirmedAt: row.confirmed_at,
      aliases: statements.aliasesForEntity.all(row.id).map((alias) => alias.alias),
      createdAt: row.link_created_at,
      updatedAt: row.link_updated_at
    }));
  }

  function previewEntityAlias(entityId, input = {}) {
    const entity = requireEntity(entityId);
    const alias = requireName(input.alias, "alias");
    const normalizedAlias = comparisonKey(alias);
    const existing = statements.aliasByNormalized.get(entity.id, normalizedAlias);
    const canonicalMatch = comparisonKey(entity.canonical_name) === normalizedAlias;
    const conflicts = statements.aliasConflicts.all(entity.type, entity.id, normalizedAlias, normalizedAlias)
      .map((row) => ({ id: row.id, type: row.type, canonicalName: row.canonical_name }));
    const noOp = canonicalMatch || Boolean(existing);
    return {
      entity: rowToEntity(entity),
      alias,
      normalizedAlias,
      noOp,
      existingAlias: existing ? rowToAlias(existing) : null,
      conflicts,
      requiresConfirmation: !noOp,
      effect: noOp ? "别名已经属于该实体，不会重复写入。" : "确认后会把该称呼加入实体档案。"
    };
  }

  function addEntityAlias(entityId, input = {}) {
    requireConfirmation(input);
    const preview = previewEntityAlias(entityId, input);
    if (preview.noOp) {
      return { created: false, alias: preview.existingAlias, entity: getEntityProfile(preview.entity.id), preview };
    }
    if (statements.countAliases.get(preview.entity.id).count >= LIMITS.aliasesPerEntity) {
      throw clueError(`每个实体最多保存 ${LIMITS.aliasesPerEntity} 个别名。`, "CLUE_ALIAS_LIMIT_REACHED", 409);
    }
    return runAtomic(() => {
      const timestamp = requireTimestamp(now(), "now");
      const id = uniqueId("alias", statements.aliasIdExists, createId);
      statements.insertAlias.run(
        id, preview.entity.id, preview.alias, preview.normalizedAlias,
        "user", timestamp, timestamp, timestamp
      );
      statements.markEntityConfirmed.run(timestamp, preview.entity.id);
      refreshEntityDocuments(preview.entity.id, timestamp);
      return { created: true, alias: rowToAlias(statements.getAlias.get(id)), entity: getEntityProfile(preview.entity.id), preview };
    });
  }

  function deleteEntityAlias(entityId, input = {}) {
    requireConfirmation(input);
    const entity = requireEntity(entityId);
    const aliasId = requireId(input.aliasId, "aliasId");
    const alias = statements.getAlias.get(aliasId);
    if (!alias || alias.entity_id !== entity.id) {
      throw clueError("没有找到这个实体别名。", "CLUE_ALIAS_NOT_FOUND", 404);
    }
    return runAtomic(() => {
      statements.deleteAlias.run(aliasId, entity.id);
      refreshEntityDocuments(entity.id, requireTimestamp(now(), "now"));
      return { deleted: true, alias: rowToAlias(alias), entity: getEntityProfile(entity.id) };
    });
  }

  function previewEntityMerge(input = {}) {
    assertPlainObject(input, "merge input");
    const sourceId = requireId(input.sourceEntityId, "sourceEntityId");
    const targetId = requireId(input.targetEntityId, "targetEntityId");
    if (sourceId === targetId) throw clueError("源实体与目标实体不能相同。", "CLUE_MERGE_SAME_ENTITY");
    const source = requireEntity(sourceId);
    const target = requireEntity(targetId);
    if (source.type !== target.type) {
      throw clueError("只有同一类型的实体才能合并。", "CLUE_ENTITY_TYPE_MISMATCH", 409);
    }
    const sourceLinks = statements.linksForEntity.all(source.id);
    const targetMemoryIds = new Set(statements.linksForEntity.all(target.id).map((row) => row.memory_id));
    const targetNames = new Set([
      comparisonKey(target.canonical_name),
      ...statements.aliasesForEntity.all(target.id).map((row) => row.normalized_alias)
    ]);
    const sourceNames = [
      { alias: source.canonical_name, normalized: comparisonKey(source.canonical_name) },
      ...statements.aliasesForEntity.all(source.id).map((row) => ({ alias: row.alias, normalized: row.normalized_alias }))
    ];
    const aliasesAdded = sourceNames.filter((item) => !targetNames.has(item.normalized));
    return {
      source: rowToEntity(source),
      target: rowToEntity(target),
      requiresConfirmation: true,
      effect: {
        memoriesAdded: sourceLinks.filter((row) => !targetMemoryIds.has(row.memory_id)).length,
        duplicateMemoryLinks: sourceLinks.filter((row) => targetMemoryIds.has(row.memory_id)).length,
        aliasesAdded: aliasesAdded.length,
        aliasDuplicates: sourceNames.length - aliasesAdded.length,
        sourceWillBeDeleted: true
      },
      warnings: ["目标实体会保留；同一展品关系和相同别名只保留一份。", "旧人物、地点和标签字段不会被反写。"]
    };
  }

  function mergeEntities(input = {}) {
    requireConfirmation(input);
    const preview = previewEntityMerge(input);
    const sourceId = preview.source.id;
    const targetId = preview.target.id;
    const sourceAliases = statements.aliasesForEntity.all(sourceId);
    const sourceLinks = statements.linksForEntity.all(sourceId);
    const targetAliasCount = Number(statements.countAliases.get(targetId)?.count) || 0;
    if (targetAliasCount + preview.effect.aliasesAdded > LIMITS.aliasesPerEntity) {
      throw clueError(`合并后别名会超过 ${LIMITS.aliasesPerEntity} 个。`, "CLUE_ALIAS_LIMIT_REACHED", 409);
    }

    return runAtomic(() => {
      const timestamp = requireTimestamp(now(), "now");
      const targetNames = new Set([
        comparisonKey(preview.target.canonicalName),
        ...statements.aliasesForEntity.all(targetId).map((row) => row.normalized_alias)
      ]);
      const aliasPlans = [
        { alias: preview.source.canonicalName, normalized: comparisonKey(preview.source.canonicalName), created_at: timestamp },
        ...sourceAliases.map((row) => ({ alias: row.alias, normalized: row.normalized_alias, created_at: row.created_at }))
      ];
      for (const plan of aliasPlans) {
        if (targetNames.has(plan.normalized)) continue;
        targetNames.add(plan.normalized);
        const aliasId = uniqueId("alias", statements.aliasIdExists, createId);
        statements.insertAlias.run(aliasId, targetId, plan.alias, plan.normalized, "merge", timestamp, plan.created_at, timestamp);
      }

      const affectedMemoryIds = new Set(
        statements.memoryIdsForEntity.all(targetId).map((row) => row.memory_id)
      );
      for (const link of sourceLinks) {
        affectedMemoryIds.add(link.memory_id);
        if (!statements.getMemoryEntity.get(link.memory_id, targetId)) {
          statements.insertMemoryEntity.run(
            link.memory_id, targetId, link.source_field, link.mention_text,
            Math.max(0.9, Number(link.confidence) || 0),
            "经用户确认合并为同一实体。", timestamp, link.created_at, timestamp
          );
        }
      }
      statements.deleteEntity.run(sourceId);
      statements.markEntityConfirmed.run(timestamp, targetId);
      refreshMemoryDocuments([...affectedMemoryIds], timestamp);
      return {
        merged: true,
        sourceEntityId: sourceId,
        targetEntityId: targetId,
        preview,
        entity: getEntityProfile(targetId)
      };
    });
  }

  function getClueStats() {
    const row = statements.stats.get();
    return {
      entities: Number(row.entities) || 0,
      people: Number(row.people) || 0,
      locations: Number(row.locations) || 0,
      themes: Number(row.themes) || 0,
      aliases: Number(row.aliases) || 0,
      memoryLinks: Number(row.memory_links) || 0,
      searchDocuments: Number(row.search_documents) || 0,
      ftsAvailable: ftsOperational
    };
  }

  function clearClues() {
    const stats = getClueStats();
    return runAtomic(() => {
      statements.clearDocuments.run();
      statements.clearEntities.run();
      return {
        entitiesDeleted: stats.entities,
        aliasesDeleted: stats.aliases,
        memoryEntityLinksDeleted: stats.memoryLinks,
        searchDocumentsDeleted: stats.searchDocuments
      };
    });
  }

  function buildClueBackup(mode = "full", sourceMemoryIds) {
    return buildBackupContract({
      entities: statements.backupEntities.all().map(rowToEntity),
      aliases: statements.backupAliases.all().map(rowToAliasBackup),
      memoryLinks: statements.backupLinks.all().map(rowToLinkBackup)
    }, mode, sourceMemoryIds);
  }

  function validateClueBackup(backup, sourceMemoryIds) {
    return validateBackupContract(backup, sourceMemoryIds);
  }

  function restoreClueBackup(backup, mappingOrOptions = {}, optionalEntityIdMap) {
    if (backup?.mode === "redacted-summary") {
      validateBackupContract(backup, []);
      return { entities: 0, aliases: 0, memoryLinks: 0, idMap: { memories: {}, entities: {}, aliases: {} } };
    }
    const options = normalizeRestoreOptions(mappingOrOptions, optionalEntityIdMap);
    const sourceMemoryIds = backup.entities.flatMap((entity) => entity.memoryLinks.map((link) => link.memoryId));
    validateBackupContract(backup, [...new Set(sourceMemoryIds)]);
    const occupiedEntityIds = statements.backupEntities.all().map((row) => row.id);
    const occupiedAliasIds = statements.backupAliases.all().map((row) => row.id);
    const entityIdMap = planCollisionFreeIds(
      backup.entities.map((entity) => entity.id),
      options.entityIdMap,
      occupiedEntityIds,
      "entity",
      createId
    );
    const aliasIdMap = planCollisionFreeIds(
      backup.entities.flatMap((entity) => entity.aliases.map((alias) => alias.id)),
      options.aliasIdMap,
      occupiedAliasIds,
      "alias",
      createId
    );
    const remapped = remapClueBackup(backup, {
      memoryIdMap: options.memoryIdMap,
      entityIdMap,
      aliasIdMap,
      occupiedEntityIds,
      occupiedAliasIds
    });
    const targetMemoryIds = [...new Set(remapped.backup.entities.flatMap((entity) => entity.memoryLinks.map((link) => link.memoryId)))];
    targetMemoryIds.forEach((memoryId) => {
      if (!statements.getMemory.get(memoryId)) {
        throw clueError(`实体恢复引用了不存在的展品 ${memoryId}。`, "CLUE_BACKUP_REFERENCE_INVALID");
      }
    });

    return runAtomic(() => {
      for (const entity of remapped.backup.entities) {
        const timestamp = entity.memoryLinks[0]?.updatedAt || entity.aliases[0]?.updatedAt || requireTimestamp(now(), "now");
        const status = entity.memoryLinks.length > 1 || entity.aliases.length ? "confirmed" : "same-name-clue";
        statements.insertEntity.run(
          entity.id, entity.type, entity.canonicalName, comparisonKey(entity.canonicalName),
          "import", status, timestamp, timestamp
        );
        entity.aliases.forEach((alias) => statements.insertAlias.run(
          alias.id, entity.id, alias.alias, comparisonKey(alias.alias),
          "import", alias.confirmedAt, alias.createdAt, alias.updatedAt
        ));
        entity.memoryLinks.forEach((link) => statements.insertMemoryEntity.run(
          link.memoryId, entity.id, link.sourceField, link.mentionText,
          1, "从完整备份恢复的实体关系。", link.confirmedAt, link.createdAt, link.updatedAt
        ));
      }
      refreshMemoryDocuments(targetMemoryIds, requireTimestamp(now(), "now"));
      return {
        entities: remapped.backup.entities.length,
        aliases: remapped.backup.entities.reduce((sum, entity) => sum + entity.aliases.length, 0),
        memoryLinks: remapped.backup.entities.reduce((sum, entity) => sum + entity.memoryLinks.length, 0),
        idMap: remapped.idMap
      };
    });
  }

  function syncLegacyEntityLinks(memoryId) {
    const desired = legacyMentionsForMemory(statements, memoryId);
    const desiredKeys = new Set(desired.map(mentionKey));
    const existing = statements.legacyLinksForMemory.all(memoryId);
    const existingByKey = new Map(existing.map((row) => [mentionKey({ sourceField: row.source_field, mentionText: row.mention_text }), row]));
    const satisfiedKeys = new Set();
    const retainedEntityIds = new Set();

    for (const mention of desired) {
      const key = mentionKey(mention);
      const exact = existingByKey.get(key);
      if (exact) {
        satisfiedKeys.add(key);
        retainedEntityIds.add(exact.entity_id);
        continue;
      }
      const resolved = existing.find((row) => (
        row.source_field === mention.sourceField && entityRepresentsMention(row.entity_id, mention)
      ));
      if (resolved) {
        satisfiedKeys.add(key);
        retainedEntityIds.add(resolved.entity_id);
      }
    }

    existing.forEach((row) => {
      if (!desiredKeys.has(mentionKey({ sourceField: row.source_field, mentionText: row.mention_text })) &&
          !retainedEntityIds.has(row.entity_id)) {
        statements.deleteMemoryEntity.run(memoryId, row.entity_id);
      }
    });
    pruneOrphanEntities();

    const timestamp = requireTimestamp(now(), "now");
    for (const mention of desired) {
      if (satisfiedKeys.has(mentionKey(mention))) continue;
      const entityId = legacyEntityId(memoryId, mention.type, mention.sourceField, mention.mentionText);
      if (!statements.getEntity.get(entityId)) {
        statements.insertEntity.run(
          entityId, mention.type, mention.mentionText, comparisonKey(mention.mentionText),
          "legacy", "same-name-clue", timestamp, timestamp
        );
      }
      statements.insertMemoryEntity.run(
        memoryId, entityId, mention.sourceField, mention.mentionText, 1,
        "来自原有字段；同名仅作为线索，不自动认定为同一身份。",
        timestamp, timestamp, timestamp
      );
    }
  }

  function entityRepresentsMention(entityId, mention) {
    const entity = statements.getEntity.get(entityId);
    if (!entity || entity.type !== mention.type) return false;
    const key = comparisonKey(mention.mentionText);
    if (comparisonKey(entity.canonical_name) === key) return true;
    return statements.aliasesForEntity.all(entityId).some((alias) => alias.normalized_alias === key);
  }

  function pruneOrphanEntities() {
    return statements.pruneEntities.run().changes;
  }

  function refreshEntityDocuments(entityId, timestamp) {
    refreshMemoryDocuments(statements.memoryIdsForEntity.all(entityId).map((row) => row.memory_id), timestamp);
  }

  function refreshMemoryDocuments(memoryIds, timestamp) {
    [...new Set(memoryIds)].forEach((memoryId) => {
      if (statements.getMemory.get(memoryId)) writeSearchDocument(db, memoryId, timestamp);
      else statements.deleteDocument.run(memoryId);
    });
  }

  function requireEntity(entityId) {
    const id = requireId(entityId, "entityId");
    const row = statements.getEntity.get(id);
    if (!row) throw clueError("没有找到这个实体。", "CLUE_ENTITY_NOT_FOUND", 404);
    return row;
  }

  return Object.freeze({
    addEntityAlias,
    buildClueBackup,
    clearClues,
    deleteEntityAlias,
    getClueStats,
    getEntityProfile,
    getMemoryEntityRefs,
    listEntities,
    mergeEntities,
    previewEntityAlias,
    previewEntityMerge,
    rebuildClueIndex,
    removeMemoryClues,
    restoreClueBackup,
    searchClues,
    searchMemories: searchClues,
    syncMemoryClues,
    validateClueBackup
  });
}

function prepareStatements(db) {
  return {
    getMemory: db.prepare("SELECT * FROM memories WHERE id = ?"),
    listMemoryIds: db.prepare("SELECT id FROM memories ORDER BY id"),
    peopleForMemory: db.prepare("SELECT name FROM memory_people WHERE memory_id = ? ORDER BY name"),
    tagsForMemory: db.prepare("SELECT tag FROM memory_tags WHERE memory_id = ? ORDER BY tag"),
    emotionsForMemory: db.prepare("SELECT emotion FROM memory_emotions WHERE memory_id = ? ORDER BY emotion"),
    getDocument: db.prepare("SELECT * FROM memory_search_documents WHERE memory_id = ?"),
    deleteDocument: db.prepare("DELETE FROM memory_search_documents WHERE memory_id = ?"),
    deleteStaleDocuments: db.prepare("DELETE FROM memory_search_documents WHERE memory_id NOT IN (SELECT id FROM memories)"),
    recentDocuments: db.prepare(`
      SELECT document.* FROM memory_search_documents document
      JOIN memories memory ON memory.id = document.memory_id
      ORDER BY datetime(memory.created_at) DESC, document.memory_id
      LIMIT ?
    `),
    getEntity: db.prepare("SELECT * FROM entities WHERE id = ?"),
    insertEntity: db.prepare(`
      INSERT INTO entities (
        id, type, canonical_name, normalized_name, provenance,
        resolution_status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    deleteEntity: db.prepare("DELETE FROM entities WHERE id = ?"),
    markEntityConfirmed: db.prepare("UPDATE entities SET resolution_status = 'confirmed', updated_at = ? WHERE id = ?"),
    pruneEntities: db.prepare("DELETE FROM entities WHERE NOT EXISTS (SELECT 1 FROM memory_entities link WHERE link.entity_id = entities.id)"),
    listEntities: db.prepare(`
      SELECT entity.*,
        (SELECT COUNT(*) FROM entity_aliases alias WHERE alias.entity_id = entity.id) AS alias_count,
        (SELECT COUNT(*) FROM memory_entities link WHERE link.entity_id = entity.id) AS memory_count
      FROM entities entity
      WHERE (? = '' OR entity.type = ?)
        AND (? = '' OR entity.canonical_name LIKE ? ESCAPE '\\'
          OR EXISTS (
            SELECT 1 FROM entity_aliases alias
            WHERE alias.entity_id = entity.id AND alias.alias LIKE ? ESCAPE '\\'
          ))
      ORDER BY entity.type, entity.normalized_name, entity.id
      LIMIT ? OFFSET ?
    `),
    aliasesForEntity: db.prepare("SELECT * FROM entity_aliases WHERE entity_id = ? ORDER BY normalized_alias, id"),
    countAliases: db.prepare("SELECT COUNT(*) AS count FROM entity_aliases WHERE entity_id = ?"),
    getAlias: db.prepare("SELECT * FROM entity_aliases WHERE id = ?"),
    aliasIdExists: db.prepare("SELECT 1 FROM entity_aliases WHERE id = ?"),
    aliasByNormalized: db.prepare("SELECT * FROM entity_aliases WHERE entity_id = ? AND normalized_alias = ?"),
    aliasConflicts: db.prepare(`
      SELECT DISTINCT entity.id, entity.type, entity.canonical_name
      FROM entities entity
      LEFT JOIN entity_aliases alias ON alias.entity_id = entity.id
      WHERE entity.type = ? AND entity.id <> ?
        AND (entity.normalized_name = ? OR alias.normalized_alias = ?)
      ORDER BY entity.id
    `),
    insertAlias: db.prepare(`
      INSERT INTO entity_aliases (
        id, entity_id, alias, normalized_alias, source,
        confirmed_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    deleteAlias: db.prepare("DELETE FROM entity_aliases WHERE id = ? AND entity_id = ?"),
    getMemoryEntity: db.prepare("SELECT * FROM memory_entities WHERE memory_id = ? AND entity_id = ?"),
    insertMemoryEntity: db.prepare(`
      INSERT INTO memory_entities (
        memory_id, entity_id, source_field, mention_text, confidence,
        reason, confirmed_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    deleteMemoryEntity: db.prepare("DELETE FROM memory_entities WHERE memory_id = ? AND entity_id = ?"),
    deleteMemoryLinks: db.prepare("DELETE FROM memory_entities WHERE memory_id = ?"),
    legacyLinksForMemory: db.prepare(`
      SELECT * FROM memory_entities
      WHERE memory_id = ? AND source_field IN ('people', 'location', 'tags')
      ORDER BY source_field, mention_text, entity_id
    `),
    linksForEntity: db.prepare("SELECT * FROM memory_entities WHERE entity_id = ? ORDER BY memory_id"),
    memoryIdsForEntity: db.prepare("SELECT memory_id FROM memory_entities WHERE entity_id = ? ORDER BY memory_id"),
    entitiesForMemory: db.prepare(`
      SELECT entity.*, link.source_field, link.mention_text, link.confidence,
        link.reason, link.confirmed_at, link.created_at AS link_created_at,
        link.updated_at AS link_updated_at
      FROM memory_entities link
      JOIN entities entity ON entity.id = link.entity_id
      WHERE link.memory_id = ?
      ORDER BY entity.type, entity.normalized_name, entity.id
    `),
    memoriesForEntity: db.prepare(`
      SELECT memory.id, memory.title, memory.memory_date, memory.location,
        link.source_field, link.mention_text, link.confidence, link.reason,
        link.confirmed_at, link.created_at, link.updated_at
      FROM memory_entities link
      JOIN memories memory ON memory.id = link.memory_id
      WHERE link.entity_id = ?
      ORDER BY datetime(memory.memory_date) DESC, memory.id
    `),
    stats: db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM entities) AS entities,
        (SELECT COUNT(*) FROM entities WHERE type = 'person') AS people,
        (SELECT COUNT(*) FROM entities WHERE type = 'location') AS locations,
        (SELECT COUNT(*) FROM entities WHERE type = 'theme') AS themes,
        (SELECT COUNT(*) FROM entity_aliases) AS aliases,
        (SELECT COUNT(*) FROM memory_entities) AS memory_links,
        (SELECT COUNT(*) FROM memory_search_documents) AS search_documents
    `),
    clearDocuments: db.prepare("DELETE FROM memory_search_documents"),
    clearEntities: db.prepare("DELETE FROM entities"),
    backupEntities: db.prepare("SELECT * FROM entities ORDER BY id"),
    backupAliases: db.prepare("SELECT * FROM entity_aliases ORDER BY id"),
    backupLinks: db.prepare("SELECT * FROM memory_entities ORDER BY entity_id, memory_id")
  };
}

function createFtsSchema(db) {
  try {
    db.exec(`
      CREATE VIRTUAL TABLE memory_search_fts USING fts5(
        title, exhibit_text, raw_content, location_text, people_text,
        tags_text, emotions_text, source_text, entity_text,
        content = 'memory_search_documents',
        content_rowid = 'id',
        tokenize = 'trigram'
      );

      CREATE TRIGGER memory_search_documents_ai
      AFTER INSERT ON memory_search_documents BEGIN
        INSERT INTO memory_search_fts(
          rowid, title, exhibit_text, raw_content, location_text, people_text,
          tags_text, emotions_text, source_text, entity_text
        ) VALUES (
          new.id, new.title, new.exhibit_text, new.raw_content, new.location_text,
          new.people_text, new.tags_text, new.emotions_text, new.source_text, new.entity_text
        );
      END;

      CREATE TRIGGER memory_search_documents_ad
      AFTER DELETE ON memory_search_documents BEGIN
        INSERT INTO memory_search_fts(
          memory_search_fts, rowid, title, exhibit_text, raw_content,
          location_text, people_text, tags_text, emotions_text, source_text, entity_text
        ) VALUES (
          'delete', old.id, old.title, old.exhibit_text, old.raw_content,
          old.location_text, old.people_text, old.tags_text, old.emotions_text,
          old.source_text, old.entity_text
        );
      END;

      CREATE TRIGGER memory_search_documents_au
      AFTER UPDATE ON memory_search_documents BEGIN
        INSERT INTO memory_search_fts(
          memory_search_fts, rowid, title, exhibit_text, raw_content,
          location_text, people_text, tags_text, emotions_text, source_text, entity_text
        ) VALUES (
          'delete', old.id, old.title, old.exhibit_text, old.raw_content,
          old.location_text, old.people_text, old.tags_text, old.emotions_text,
          old.source_text, old.entity_text
        );
        INSERT INTO memory_search_fts(
          rowid, title, exhibit_text, raw_content, location_text, people_text,
          tags_text, emotions_text, source_text, entity_text
        ) VALUES (
          new.id, new.title, new.exhibit_text, new.raw_content, new.location_text,
          new.people_text, new.tags_text, new.emotions_text, new.source_text, new.entity_text
        );
      END;
    `);
  } catch (error) {
    try {
      db.exec(`
        DROP TRIGGER IF EXISTS memory_search_documents_ai;
        DROP TRIGGER IF EXISTS memory_search_documents_ad;
        DROP TRIGGER IF EXISTS memory_search_documents_au;
        DROP TABLE IF EXISTS memory_search_fts;
      `);
    } catch { /* LIKE remains a complete fallback when FTS5/trigram is unavailable. */ }
    if (!isFtsUnavailable(error)) throw error;
  }
}

function backfillLegacyClues(db) {
  const timestamp = new Date().toISOString();
  const statements = prepareBackfillStatements(db);
  const memoryIds = statements.listMemoryIds.all().map((row) => row.id);
  for (const memoryId of memoryIds) {
    for (const mention of legacyMentionsForMemory(statements, memoryId)) {
      const entityId = legacyEntityId(memoryId, mention.type, mention.sourceField, mention.mentionText);
      statements.insertEntity.run(
        entityId, mention.type, mention.mentionText, comparisonKey(mention.mentionText),
        "legacy", "same-name-clue", timestamp, timestamp
      );
      statements.insertMemoryEntity.run(
        memoryId, entityId, mention.sourceField, mention.mentionText, 1,
        "来自原有字段；同名仅作为线索，不自动认定为同一身份。",
        timestamp, timestamp, timestamp
      );
    }
    writeSearchDocument(db, memoryId, timestamp);
  }
}

function prepareBackfillStatements(db) {
  return {
    listMemoryIds: db.prepare("SELECT id FROM memories ORDER BY id"),
    getMemory: db.prepare("SELECT * FROM memories WHERE id = ?"),
    peopleForMemory: db.prepare("SELECT name FROM memory_people WHERE memory_id = ? ORDER BY name"),
    tagsForMemory: db.prepare("SELECT tag FROM memory_tags WHERE memory_id = ? ORDER BY tag"),
    emotionsForMemory: db.prepare("SELECT emotion FROM memory_emotions WHERE memory_id = ? ORDER BY emotion"),
    insertEntity: db.prepare(`
      INSERT OR IGNORE INTO entities (
        id, type, canonical_name, normalized_name, provenance,
        resolution_status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    insertMemoryEntity: db.prepare(`
      INSERT OR IGNORE INTO memory_entities (
        memory_id, entity_id, source_field, mention_text, confidence,
        reason, confirmed_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
  };
}

function writeSearchDocument(db, memoryId, timestamp) {
  const memory = db.prepare("SELECT * FROM memories WHERE id = ?").get(memoryId);
  if (!memory) return false;
  const people = db.prepare("SELECT name FROM memory_people WHERE memory_id = ? ORDER BY name").all(memoryId).map((row) => row.name);
  const tags = db.prepare("SELECT tag FROM memory_tags WHERE memory_id = ? ORDER BY tag").all(memoryId).map((row) => row.tag);
  const emotions = db.prepare("SELECT emotion FROM memory_emotions WHERE memory_id = ? ORDER BY emotion").all(memoryId).map((row) => row.emotion);
  const entities = db.prepare(`
    SELECT entity.canonical_name, alias.alias
    FROM memory_entities link
    JOIN entities entity ON entity.id = link.entity_id
    LEFT JOIN entity_aliases alias ON alias.entity_id = entity.id
    WHERE link.memory_id = ?
    ORDER BY entity.id, alias.id
  `).all(memoryId).flatMap((row) => [row.canonical_name, row.alias]).filter(Boolean);
  db.prepare(`
    INSERT INTO memory_search_documents (
      memory_id, title, exhibit_text, raw_content, location_text, people_text,
      tags_text, emotions_text, source_text, entity_text, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(memory_id) DO UPDATE SET
      title = excluded.title,
      exhibit_text = excluded.exhibit_text,
      raw_content = excluded.raw_content,
      location_text = excluded.location_text,
      people_text = excluded.people_text,
      tags_text = excluded.tags_text,
      emotions_text = excluded.emotions_text,
      source_text = excluded.source_text,
      entity_text = excluded.entity_text,
      updated_at = excluded.updated_at
  `).run(
    memoryId,
    optionalText(memory.title),
    optionalText(memory.exhibit_text),
    optionalText(memory.raw_content),
    optionalText(memory.location),
    joinSearchValues(people),
    joinSearchValues(tags),
    joinSearchValues(emotions),
    optionalText(memory.source_type),
    joinSearchValues(entities),
    timestamp
  );
  if (columnExists(db, "memory_search_documents", "voice_text")) {
    const voiceText = tableExists(db, "voice_transcripts")
      ? joinSearchValues(db.prepare(`
          SELECT text FROM voice_transcripts
          WHERE memory_id = ? AND status = 'confirmed'
          ORDER BY asset_id
        `).all(memoryId).map((row) => row.text))
      : "";
    db.prepare("UPDATE memory_search_documents SET voice_text = ? WHERE memory_id = ?").run(voiceText, memoryId);
  }
  return true;
}

function legacyMentionsForMemory(statements, memoryId) {
  const memory = statements.getMemory.get(memoryId);
  if (!memory) return [];
  const mentions = [];
  statements.peopleForMemory.all(memoryId).forEach((row) => mentions.push({ type: "person", sourceField: "people", mentionText: row.name }));
  if (normalizeClueText(memory.location)) mentions.push({ type: "location", sourceField: "location", mentionText: memory.location });
  statements.tagsForMemory.all(memoryId).forEach((row) => mentions.push({ type: "theme", sourceField: "tags", mentionText: row.tag }));
  const seen = new Set();
  return mentions.map((mention) => ({ ...mention, mentionText: requireName(mention.mentionText, "legacy mention") }))
    .filter((mention) => {
      const key = mentionKey(mention);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function rowToSearchMemory(row, memory = {}) {
  return {
    schemaVersion: Number(memory.schema_version) || 0,
    id: row.memory_id,
    title: row.title,
    hall: memory.hall_id || "",
    exhibitText: row.exhibit_text,
    rawContent: row.raw_content,
    date: memory.memory_date || "",
    location: row.location_text,
    people: splitSearchValues(row.people_text),
    tags: splitSearchValues(row.tags_text),
    emotions: splitSearchValues(row.emotions_text),
    sourceType: row.source_text,
    voiceText: row.voice_text || "",
    emotionIntensity: Number(memory.emotion_intensity) || 0,
    importance: Number(memory.importance) || 0,
    favorite: Boolean(memory.favorite),
    coverImage: memory.cover_image || "",
    mediaNote: memory.media_note || "",
    createdAt: memory.created_at || "",
    updatedAt: memory.updated_at || ""
  };
}

function rowToEntity(row) {
  return {
    id: row.id,
    type: row.type,
    canonicalName: row.canonical_name,
    provenance: row.provenance,
    resolutionStatus: row.resolution_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToEntitySummary(row) {
  return {
    ...rowToEntity(row),
    aliasCount: Number(row.alias_count) || 0,
    memoryCount: Number(row.memory_count) || 0
  };
}

function rowToAlias(row) {
  return {
    id: row.id,
    entityId: row.entity_id,
    alias: row.alias,
    source: row.source,
    confirmedAt: row.confirmed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToEntityMemory(row) {
  return {
    memoryId: row.id,
    title: row.title,
    date: row.memory_date || "",
    location: row.location || "",
    sourceField: row.source_field,
    mentionText: row.mention_text,
    confidence: Number(row.confidence),
    reason: row.reason,
    confirmedAt: row.confirmed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToAliasBackup(row) {
  return {
    id: row.id,
    entityId: row.entity_id,
    alias: row.alias,
    source: row.source,
    confirmedAt: row.confirmed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToLinkBackup(row) {
  return {
    entityId: row.entity_id,
    memoryId: row.memory_id,
    sourceField: row.source_field,
    mentionText: row.mention_text,
    confirmedAt: row.confirmed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function normalizeRestoreOptions(value, optionalEntityIdMap) {
  const looksLikeOptions = isPlainObject(value) && Object.hasOwn(value, "memoryIdMap") &&
    (value.memoryIdMap instanceof Map || isPlainObject(value.memoryIdMap));
  if (value instanceof Map || (isPlainObject(value) && !looksLikeOptions)) {
    return { memoryIdMap: value, entityIdMap: optionalEntityIdMap };
  }
  if (!isPlainObject(value)) throw clueError("恢复映射必须是 Map 或对象。", "CLUE_BACKUP_MAPPING_INVALID");
  return value;
}

function planCollisionFreeIds(sourceIds, suppliedMap, occupiedIds, prefix, createId) {
  const mapping = normalizeOptionalIdMap(suppliedMap, `${prefix}IdMap`);
  const occupied = new Set(occupiedIds);
  const reserved = new Set([...mapping.values()].map((id) => requireId(id, `${prefix} target id`)));
  for (const sourceId of sourceIds) {
    if (mapping.has(sourceId) || !occupied.has(sourceId)) continue;
    let targetId = "";
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const candidate = requireId(createId(prefix), `${prefix} target id`);
      if (!occupied.has(candidate) && !reserved.has(candidate)) {
        targetId = candidate;
        break;
      }
    }
    if (!targetId) throw clueError("无法为恢复数据生成无碰撞 ID。", "CLUE_BACKUP_ID_COLLISION", 409);
    mapping.set(sourceId, targetId);
    reserved.add(targetId);
  }
  return mapping;
}

function normalizeOptionalIdMap(value, name) {
  if (value === undefined || value === null) return new Map();
  if (value instanceof Map) return new Map(value);
  if (isPlainObject(value)) return new Map(Object.entries(value));
  throw clueError(`${name} 必须是 Map 或对象。`, "CLUE_BACKUP_MAPPING_INVALID");
}

function requireDatabase(db) {
  if (!db || typeof db.exec !== "function" || typeof db.prepare !== "function") {
    throw new TypeError("initializeClueDatabase 需要同步 SQLite 数据库连接。");
  }
  return db;
}

function requireEntityType(value) {
  const supplied = String(value || "").trim().toLowerCase();
  const type = ({ people: "person", place: "location", topic: "theme", tag: "theme" })[supplied] || supplied;
  if (!ENTITY_TYPES.has(type)) throw clueError("实体类型无效。", "CLUE_ENTITY_TYPE_INVALID");
  return type;
}

function requireName(value, name) {
  const text = normalizeClueText(value);
  if (!text || [...text].length > LIMITS.entityName || text.includes("\u0000")) {
    throw clueError(`${name} 不能为空且最多 ${LIMITS.entityName} 个字符。`, "CLUE_NAME_INVALID");
  }
  return text;
}

function normalizeOptionalText(value, name, maximum) {
  const text = normalizeClueText(value);
  if ([...text].length > maximum || text.includes("\u0000")) throw clueError(`${name} 无效。`, "CLUE_QUERY_INVALID");
  return text;
}

function requireId(value, name) {
  const id = String(value || "").trim();
  if (!ID_PATTERN.test(id)) throw clueError(`${name} 无效。`, "CLUE_ID_INVALID");
  return id;
}

function requireTimestamp(value, name) {
  const timestamp = String(value || "").trim();
  if (!timestamp || timestamp.length > 40 || !Number.isFinite(Date.parse(timestamp))) {
    throw clueError(`${name} 必须是有效时间戳。`, "CLUE_TIMESTAMP_INVALID");
  }
  return timestamp;
}

function requireLimit(value, maximum, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > maximum) {
    throw clueError(`limit 必须是 1 至 ${maximum} 的整数。`, "CLUE_LIMIT_INVALID");
  }
  return number;
}

function requireOffset(value) {
  if (value === undefined || value === null || value === "") return 0;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || number > 100000) {
    throw clueError("offset 必须是非负整数。", "CLUE_OFFSET_INVALID");
  }
  return number;
}

function requireConfirmation(value) {
  if (!isPlainObject(value) || value.confirm !== true) {
    throw clueError("写入实体关系前需要显式确认。", "CLUE_CONFIRMATION_REQUIRED");
  }
}

function assertPlainObject(value, name) {
  if (!isPlainObject(value)) throw clueError(`${name} 必须是对象。`, "CLUE_VALUE_INVALID");
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function uniqueId(prefix, existsStatement, createId) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const id = requireId(createId(prefix), `${prefix} id`);
    if (!existsStatement.get(id)) return id;
  }
  throw clueError("无法生成唯一实体 ID。", "CLUE_ID_COLLISION", 409);
}

function legacyEntityId(memoryId, type, sourceField, mentionText) {
  const digest = createHash("sha256")
    .update(`${memoryId}\u0000${type}\u0000${sourceField}\u0000${comparisonKey(mentionText)}`, "utf8")
    .digest("hex")
    .slice(0, 32);
  return `entity-${type}-${digest}`;
}

function mentionKey(mention) {
  return `${mention.sourceField}\u0000${normalizeClueText(mention.mentionText)}`;
}

function comparisonKey(value) {
  return normalizeClueText(value).toLowerCase();
}

function escapeLike(value) {
  return String(value || "").replace(/[\\%_]/gu, (character) => `\\${character}`);
}

function joinSearchValues(values) {
  return [...new Set(values.map((value) => normalizeClueText(value)).filter(Boolean))].join("\n");
}

function splitSearchValues(value) {
  return String(value || "").split("\n").filter(Boolean);
}

function optionalText(value) {
  return typeof value === "string" ? value : "";
}

function tableExists(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

function columnExists(db, tableName, columnName) {
  if (!/^[a-zA-Z0-9_]+$/u.test(tableName)) return false;
  return db.prepare(`PRAGMA table_info(${tableName})`).all().some((column) => column.name === columnName);
}

function isFtsUnavailable(error) {
  const text = `${error?.code || ""} ${error?.message || ""}`.toLowerCase();
  return text.includes("fts5") || text.includes("trigram") || text.includes("no such table: memory_search_fts") || text.includes("no such module");
}

function clueError(message, code, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

module.exports = {
  CLUE_LIMITS: LIMITS,
  CLUE_MIGRATION,
  initializeClueDatabase
};
