"use strict";

const { randomUUID } = require("node:crypto");
const { applyMigrations } = require("./migrations");
const {
  MAX_MEMORY_INBOX_ITEMS,
  MAX_MEMORY_INBOX_SOURCES,
  buildMemoryInboxBackup,
  normalizeBackupItem,
  normalizeBackupSource,
  validateMemoryInboxBackupPayload
} = require("./memory-inbox-backup");
const {
  MAX_DISPLAY_NAME_LENGTH,
  MAX_EXCERPT_LENGTH,
  MAX_SOURCE_BYTES,
  MEMORY_INBOX_SCHEMA_VERSION,
  memoryInboxError,
  stableStringify,
  sha256Utf8,
  verifyMemoryInboxSelection
} = require("./memory-inbox-service");

const ID_PATTERN = /^[a-zA-Z0-9_-]{1,120}$/u;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9_-]{8,120}$/u;
const STATUS_SET = new Set(["pending", "dismissed", "accepted", "orphaned"]);

const MEMORY_INBOX_MIGRATION = Object.freeze({
  version: MEMORY_INBOX_SCHEMA_VERSION,
  name: "verifiable-text-memory-inbox",
  up(db) {
    db.exec(`
      CREATE TABLE memory_inbox_sources (
        id TEXT PRIMARY KEY,
        schema_version INTEGER NOT NULL DEFAULT 15 CHECK (schema_version = 15),
        source_key TEXT NOT NULL UNIQUE CHECK (
          length(source_key) = 76 AND substr(source_key, 1, 12) = 'text-source:'
          AND substr(source_key, 13) NOT GLOB '*[^0-9a-f]*'
        ),
        kind TEXT NOT NULL CHECK (kind = 'local-text-document'),
        display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND ${MAX_DISPLAY_NAME_LENGTH}),
        format TEXT NOT NULL CHECK (format IN ('txt', 'markdown')),
        mime_type TEXT NOT NULL CHECK (mime_type IN ('text/plain', 'text/markdown', 'text/x-markdown')),
        byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND ${MAX_SOURCE_BYTES}),
        decoded_length INTEGER NOT NULL CHECK (decoded_length BETWEEN 1 AND ${MAX_SOURCE_BYTES}),
        raw_sha256 TEXT NOT NULL UNIQUE CHECK (
          length(raw_sha256) = 64 AND raw_sha256 NOT GLOB '*[^0-9a-f]*'
        ),
        decoded_text_sha256 TEXT NOT NULL CHECK (
          length(decoded_text_sha256) = 64 AND decoded_text_sha256 NOT GLOB '*[^0-9a-f]*'
        ),
        encoding TEXT NOT NULL CHECK (encoding = 'utf-8'),
        offset_unit TEXT NOT NULL CHECK (offset_unit = 'utf16-code-unit'),
        retention_mode TEXT NOT NULL CHECK (retention_mode = 'anchors-only'),
        verified_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        CHECK (substr(source_key, 13) = raw_sha256)
      );

      CREATE TABLE memory_inbox_items (
        id TEXT PRIMARY KEY,
        schema_version INTEGER NOT NULL DEFAULT 15 CHECK (schema_version = 15),
        source_id TEXT NOT NULL,
        anchor_key TEXT NOT NULL UNIQUE CHECK (
          length(anchor_key) = 76 AND substr(anchor_key, 1, 12) = 'text-anchor:'
          AND substr(anchor_key, 13) NOT GLOB '*[^0-9a-f]*'
        ),
        offset_unit TEXT NOT NULL CHECK (offset_unit = 'utf16-code-unit'),
        start_offset INTEGER NOT NULL CHECK (start_offset >= 0),
        end_offset INTEGER NOT NULL CHECK (
          end_offset > start_offset AND end_offset - start_offset <= ${MAX_EXCERPT_LENGTH}
        ),
        start_line INTEGER NOT NULL CHECK (start_line >= 1),
        start_column INTEGER NOT NULL CHECK (start_column >= 1),
        end_line INTEGER NOT NULL CHECK (end_line >= start_line),
        end_column INTEGER NOT NULL CHECK (end_column >= 1),
        excerpt_text TEXT NOT NULL CHECK (length(excerpt_text) BETWEEN 1 AND ${MAX_EXCERPT_LENGTH}),
        excerpt_sha256 TEXT NOT NULL CHECK (
          length(excerpt_sha256) = 64 AND excerpt_sha256 NOT GLOB '*[^0-9a-f]*'
        ),
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'dismissed', 'accepted', 'orphaned')),
        needs_review INTEGER NOT NULL DEFAULT 0 CHECK (needs_review IN (0, 1)),
        memory_id TEXT UNIQUE,
        version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
        create_idempotency_key TEXT UNIQUE,
        create_request_sha256 TEXT,
        admission_idempotency_key TEXT UNIQUE,
        admission_request_sha256 TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        dismissed_at TEXT NOT NULL DEFAULT '',
        accepted_at TEXT NOT NULL DEFAULT '',
        FOREIGN KEY (source_id) REFERENCES memory_inbox_sources(id) ON DELETE RESTRICT,
        FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE RESTRICT,
        CHECK (
          (create_idempotency_key IS NULL AND create_request_sha256 IS NULL) OR
          (create_idempotency_key IS NOT NULL AND create_request_sha256 IS NOT NULL
            AND length(create_idempotency_key) BETWEEN 8 AND 120
            AND create_idempotency_key NOT GLOB '*[^A-Za-z0-9_-]*'
            AND length(create_request_sha256) = 64
            AND create_request_sha256 NOT GLOB '*[^0-9a-f]*')
        ),
        CHECK (
          (admission_idempotency_key IS NULL AND admission_request_sha256 IS NULL) OR
          (admission_idempotency_key IS NOT NULL AND admission_request_sha256 IS NOT NULL
            AND length(admission_idempotency_key) BETWEEN 8 AND 120
            AND admission_idempotency_key NOT GLOB '*[^A-Za-z0-9_-]*'
            AND length(admission_request_sha256) = 64
            AND admission_request_sha256 NOT GLOB '*[^0-9a-f]*')
        ),
        CHECK (
          (status = 'pending' AND memory_id IS NULL AND accepted_at = '' AND dismissed_at = '' AND needs_review = 0) OR
          (status = 'dismissed' AND memory_id IS NULL AND accepted_at = '' AND dismissed_at <> '' AND needs_review = 0) OR
          (status = 'accepted' AND memory_id IS NOT NULL AND accepted_at <> '' AND dismissed_at = '' AND needs_review = 0) OR
          (status = 'orphaned' AND memory_id IS NULL AND accepted_at <> '' AND dismissed_at = '' AND needs_review = 1)
        )
      );

      CREATE INDEX idx_memory_inbox_items_status
        ON memory_inbox_items(status, updated_at DESC, id);
      CREATE INDEX idx_memory_inbox_items_source
        ON memory_inbox_items(source_id, start_offset, end_offset, id);
      CREATE INDEX idx_memory_inbox_items_review
        ON memory_inbox_items(needs_review, updated_at DESC, id);

      CREATE TRIGGER memory_inbox_anchor_immutable
      BEFORE UPDATE OF source_id, anchor_key, offset_unit, start_offset, end_offset,
        start_line, start_column, end_line, end_column, excerpt_text, excerpt_sha256
      ON memory_inbox_items
      BEGIN
        SELECT RAISE(ABORT, 'MEMORY_INBOX_ANCHOR_IMMUTABLE');
      END;

      CREATE TRIGGER memory_inbox_source_immutable
      BEFORE UPDATE ON memory_inbox_sources
      BEGIN
        SELECT RAISE(ABORT, 'MEMORY_INBOX_SOURCE_IMMUTABLE');
      END;

      CREATE TRIGGER memory_inbox_terminal_state
      BEFORE UPDATE ON memory_inbox_items
      WHEN OLD.status IN ('accepted', 'orphaned') AND NOT (
        OLD.status = 'accepted' AND NEW.status = 'orphaned'
        AND NEW.memory_id IS NULL AND NEW.needs_review = 1
        AND NEW.accepted_at = OLD.accepted_at AND NEW.dismissed_at = ''
      )
      BEGIN
        SELECT RAISE(ABORT, 'MEMORY_INBOX_ITEM_TERMINAL');
      END;
    `);
  }
});

function initializeMemoryInboxDatabase(options = {}) {
  const db = requireDatabase(options.db);
  const suppliedTransaction = typeof options.withTransaction === "function" ? options.withTransaction : null;
  const now = typeof options.now === "function" ? options.now : () => new Date().toISOString();
  const createId = typeof options.createId === "function" ? options.createId : (prefix) => `${prefix}-${randomUUID()}`;
  const saveMemory = typeof options.saveMemory === "function" ? options.saveMemory : null;
  const getMemory = typeof options.getMemory === "function" ? options.getMemory : null;

  if (options.applyMigrations !== false) {
    applyMigrations({
      db,
      baselineVersion: 4,
      migrations: [MEMORY_INBOX_MIGRATION],
      supportedVersion: Math.max(MEMORY_INBOX_SCHEMA_VERSION, Number(options.schemaVersion) || MEMORY_INBOX_SCHEMA_VERSION),
      now
    });
  }

  const statements = prepareStatements(db);

  function runAtomic(operation) {
    if (suppliedTransaction) return suppliedTransaction(operation);
    const savepoint = `memory_inbox_${randomUUID().replace(/-/gu, "")}`;
    db.exec(`SAVEPOINT ${savepoint}`);
    try {
      const result = operation();
      if (result && typeof result.then === "function") throw new TypeError("Memory-inbox database operations must be synchronous.");
      db.exec(`RELEASE SAVEPOINT ${savepoint}`);
      return result;
    } catch (error) {
      try { db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`); } catch { /* preserve the original error */ }
      try { db.exec(`RELEASE SAVEPOINT ${savepoint}`); } catch { /* preserve the original error */ }
      throw normalizeDatabaseError(error);
    }
  }

  function createMemoryInboxItem(input = {}, mutation = {}) {
    const verified = verifyMemoryInboxSelection(input);
    const idempotencyKey = requireIdempotencyKey(mutation.idempotencyKey);
    const requestSha256 = sha256Utf8(stableStringify({
      source: verified.source,
      anchor: verified.anchor
    }));
    let outcome;
    runAtomic(() => {
      const replay = statements.itemByCreateKey.get(idempotencyKey);
      if (replay) {
        if (replay.create_request_sha256 !== requestSha256) throw idempotencyConflict();
        outcome = { created: false, idempotent: true, item: rowToItem(replay), source: getMemoryInboxSource(replay.source_id) };
        return;
      }
      const duplicate = statements.itemByAnchor.get(verified.anchor.anchorKey);
      if (duplicate) {
        throw memoryInboxError("This exact source anchor is already in the inbox.", "MEMORY_INBOX_ANCHOR_EXISTS", 409);
      }
      if (itemCount() >= MAX_MEMORY_INBOX_ITEMS) {
        throw memoryInboxError(`At most ${MAX_MEMORY_INBOX_ITEMS} inbox items may be retained.`, "MEMORY_INBOX_ITEM_LIMIT", 409);
      }
      const timestamp = requireTimestamp(now());
      let sourceRow = statements.sourceByKey.get(verified.source.sourceKey);
      if (!sourceRow) {
        if (sourceCount() >= MAX_MEMORY_INBOX_SOURCES) {
          throw memoryInboxError(`At most ${MAX_MEMORY_INBOX_SOURCES} inbox sources may be retained.`, "MEMORY_INBOX_SOURCE_LIMIT", 409);
        }
        const sourceId = allocateId("inbox-source", statements.sourceOrItemById);
        statements.insertSource.run(sourceInsertParameters(sourceId, verified.source, timestamp));
        sourceRow = statements.sourceById.get(sourceId);
      } else {
        assertSourceIdentity(rowToSource(sourceRow), verified.source);
      }
      const itemId = allocateId("inbox-item", statements.sourceOrItemById);
      statements.insertItem.run(itemInsertParameters({
        id: itemId,
        sourceId: sourceRow.id,
        anchor: verified.anchor,
        createIdempotencyKey: idempotencyKey,
        createRequestSha256: requestSha256,
        createdAt: timestamp,
        updatedAt: timestamp
      }));
      outcome = {
        created: true,
        idempotent: false,
        item: getMemoryInboxItem(itemId),
        source: getMemoryInboxSource(sourceRow.id)
      };
    });
    return outcome;
  }

  function getMemoryInboxSource(sourceId) {
    const row = statements.sourceById.get(requireId(sourceId, "sourceId"));
    return row ? rowToSource(row) : null;
  }

  function listMemoryInboxSources() {
    return statements.listSources.all().map(rowToSource);
  }

  function getMemoryInboxItem(itemId) {
    const row = statements.itemById.get(requireId(itemId, "itemId"));
    return row ? rowToItem(row) : null;
  }

  function listMemoryInboxItems(options = {}) {
    assertPlainObject(options, "list options");
    const status = options.status === undefined ? "" : requireStatus(options.status);
    const limit = boundedInteger(options.limit, 1, MAX_MEMORY_INBOX_ITEMS, 100);
    return (status ? statements.listItemsByStatus.all(status, limit) : statements.listItems.all(limit)).map(rowToItem);
  }

  function getMemoryInboxReceiptForMemory(memoryId) {
    const id = requireId(memoryId, "memoryId");
    const row = statements.itemByMemory.get(id);
    if (!row) return null;
    return { item: rowToItem(row), source: getMemoryInboxSource(row.source_id) };
  }

  function dismissMemoryInboxItem(itemId, mutation = {}) {
    requireConfirmation(mutation);
    const item = requireItem(itemId);
    assertExpectedVersion(item, mutation.expectedVersion);
    if (item.status !== "pending") {
      throw memoryInboxError("Only a pending inbox item can be dismissed.", "MEMORY_INBOX_STATE_INVALID", 409);
    }
    return runAtomic(() => {
      const timestamp = nextTimestamp(now(), item.updatedAt);
      const result = statements.dismissItem.run(timestamp, timestamp, item.id, item.version);
      if (Number(result.changes) !== 1) throw versionConflict();
      return { changed: true, item: getMemoryInboxItem(item.id) };
    });
  }

  function reopenMemoryInboxItem(itemId, mutation = {}) {
    requireConfirmation(mutation);
    const item = requireItem(itemId);
    assertExpectedVersion(item, mutation.expectedVersion);
    if (item.status !== "dismissed") {
      throw memoryInboxError("Only a dismissed inbox item can be reopened.", "MEMORY_INBOX_STATE_INVALID", 409);
    }
    return runAtomic(() => {
      const timestamp = nextTimestamp(now(), item.updatedAt);
      const result = statements.reopenItem.run(timestamp, item.id, item.version);
      if (Number(result.changes) !== 1) throw versionConflict();
      return { changed: true, item: getMemoryInboxItem(item.id) };
    });
  }

  function admitMemoryInboxItem(itemId, memory, mutation = {}) {
    requireConfirmation(mutation);
    const id = requireId(itemId, "itemId");
    const idempotencyKey = requireIdempotencyKey(mutation.idempotencyKey);
    assertPlainObject(memory, "memory");
    let current = requireItem(id);
    const admissionMemory = { ...memory, rawContent: current.excerpt, agentRunId: "" };
    const requestSha256 = sha256Utf8(stableStringify({ itemId: id, memory: admissionMemory }));
    const replay = statements.itemByAdmissionKey.get(idempotencyKey);
    if (replay) {
      if (replay.id !== id || replay.admission_request_sha256 !== requestSha256) throw idempotencyConflict();
      const saved = readAdmittedMemory(replay.memory_id, getMemory);
      return { admitted: false, idempotent: true, item: rowToItem(replay), memory: saved };
    }
    assertExpectedVersion(current, mutation.expectedVersion);
    if (current.status !== "pending") {
      throw memoryInboxError("Only a pending inbox item can be admitted.", "MEMORY_INBOX_STATE_INVALID", 409);
    }
    if (!saveMemory || !getMemory) {
      throw memoryInboxError("Memory admission callbacks are not configured.", "MEMORY_INBOX_ADMISSION_UNAVAILABLE", 503);
    }
    return runAtomic(() => {
      current = requireItem(id);
      assertExpectedVersion(current, mutation.expectedVersion);
      if (current.status !== "pending") throw versionConflict();
      const saved = requireSynchronousResult(saveMemory(admissionMemory, {
        transaction: false,
        requireNew: true,
        changeKind: "created",
        changeNote: "Created from a verified memory-inbox source anchor."
      }));
      const memoryId = requireId(saved?.id || admissionMemory.id, "saved memory id");
      const persisted = getMemory(memoryId);
      if (!persisted) throw memoryInboxError("The admitted memory was not persisted.", "MEMORY_INBOX_ADMISSION_FAILED", 500);
      const acceptedAt = nextTimestamp(now(), current.updatedAt);
      const result = statements.admitItem.run(
        memoryId,
        idempotencyKey,
        requestSha256,
        acceptedAt,
        acceptedAt,
        id,
        current.version
      );
      if (Number(result.changes) !== 1) throw versionConflict();
      return { admitted: true, idempotent: false, item: getMemoryInboxItem(id), memory: persisted };
    });
  }

  function detachMemoryInboxAdmission(memoryId) {
    const id = requireId(memoryId, "memoryId");
    const current = statements.itemByMemory.get(id);
    if (!current) return { detached: 0, item: null };
    const item = rowToItem(current);
    return runAtomic(() => {
      const updatedAt = nextTimestamp(now(), item.updatedAt);
      const result = statements.orphanItem.run(updatedAt, item.id, item.version);
      if (Number(result.changes) !== 1) throw versionConflict();
      return { detached: 1, item: getMemoryInboxItem(item.id) };
    });
  }

  function clearMemoryInbox() {
    return runAtomic(() => {
      const itemsDeleted = itemCount();
      const sourcesDeleted = sourceCount();
      statements.clearItems.run();
      statements.clearSources.run();
      return { memoryInboxItemsDeleted: itemsDeleted, memoryInboxSourcesDeleted: sourcesDeleted };
    });
  }

  function getMemoryInboxStats() {
    const stats = { sources: sourceCount(), items: 0, pending: 0, dismissed: 0, accepted: 0, orphaned: 0, needsReview: 0 };
    for (const row of statements.countItemsByStatus.all()) {
      const count = Number(row.count) || 0;
      if (Object.hasOwn(stats, row.status)) stats[row.status] = count;
      stats.items += count;
    }
    stats.needsReview = Number(statements.countNeedsReview.get()?.count) || 0;
    return stats;
  }

  function buildMemoryInboxDatabaseBackup(mode = "full", sourceMemoryIds) {
    let items = statements.listAllItems.all().map(rowToItem);
    if (sourceMemoryIds !== undefined) {
      const memorySet = new Set(normalizeIdList(sourceMemoryIds, "sourceMemoryIds"));
      items = items.filter((item) => item.memoryId && memorySet.has(item.memoryId));
    }
    const sourceIds = new Set(items.map((item) => item.sourceId));
    const sources = statements.listSources.all().map(rowToSource).filter((source) => sourceIds.has(source.id));
    return buildMemoryInboxBackup({ sources, items }, mode);
  }

  function validateMemoryInboxBackup(backup, sourceMemoryIds) {
    return validateMemoryInboxBackupPayload(backup, {
      ...(sourceMemoryIds === undefined ? {} : { memoryIds: normalizeIdList(sourceMemoryIds, "sourceMemoryIds") })
    });
  }

  function restoreMemoryInboxBackup(backup, restoreOptions = {}) {
    if (backup?.mode === "redacted-summary") {
      validateMemoryInboxBackupPayload(backup);
      return { sources: 0, items: 0, reused: 0, skipped: 0, summarized: true, idMap: { sources: {}, items: {} } };
    }
    assertPlainObject(restoreOptions, "restore options");
    assertKnownKeys(restoreOptions, new Set(["memoryIdMap"]), "restore options");
    const memoryIdMap = normalizeIdMap(restoreOptions.memoryIdMap);
    validateMemoryInboxBackupPayload(backup, { memoryIds: [...memoryIdMap.keys()] });
    const sourcePlans = planSourceRestore(backup.sources);
    const sourceMap = new Map(sourcePlans.map((plan) => [plan.source.id, plan.targetId]));
    const itemPlans = planItemRestore(
      backup.items,
      backup.sources,
      sourceMap,
      memoryIdMap,
      new Set(sourcePlans.map((plan) => plan.targetId))
    );

    return runAtomic(() => {
      const newSourceCount = sourcePlans.filter((plan) => !plan.reused).length;
      const newItemCount = itemPlans.filter((plan) => !plan.reused).length;
      if (sourceCount() + newSourceCount > MAX_MEMORY_INBOX_SOURCES) {
        throw memoryInboxError("Restoring this backup would exceed the inbox source limit.", "MEMORY_INBOX_SOURCE_LIMIT", 409);
      }
      if (itemCount() + newItemCount > MAX_MEMORY_INBOX_ITEMS) {
        throw memoryInboxError("Restoring this backup would exceed the inbox item limit.", "MEMORY_INBOX_ITEM_LIMIT", 409);
      }
      for (const plan of sourcePlans) {
        if (plan.reused) continue;
        statements.restoreSource.run(sourceInsertParameters(plan.targetId, plan.source, plan.source.createdAt, plan.source.verifiedAt));
      }
      for (const plan of itemPlans) {
        if (plan.reused) continue;
        statements.restoreItem.run(itemRestoreParameters(plan));
      }
      return {
        sources: sourcePlans.length,
        items: itemPlans.length,
        reused: sourcePlans.filter((plan) => plan.reused).length + itemPlans.filter((plan) => plan.reused).length,
        skipped: 0,
        summarized: false,
        idMap: {
          sources: Object.fromEntries(sourcePlans.map((plan) => [plan.source.id, plan.targetId])),
          items: Object.fromEntries(itemPlans.map((plan) => [plan.item.id, plan.targetId]))
        }
      };
    });
  }

  function planSourceRestore(sources) {
    const reserved = new Set();
    return sources.map((value, index) => {
      const source = normalizeBackupSource(value, index);
      const existingByKey = statements.sourceByKey.get(source.sourceKey);
      if (existingByKey) {
        assertSourceIdentity(rowToSource(existingByKey), source);
        reserved.add(existingByKey.id);
        return { source, targetId: existingByKey.id, reused: true };
      }
      let targetId = source.id;
      if (reserved.has(targetId) || statements.sourceOrItemById.get(targetId)) {
        targetId = allocateId("inbox-source", { get: (id) => reserved.has(id) || statements.sourceOrItemById.get(id) });
      }
      reserved.add(targetId);
      return { source, targetId, reused: false };
    });
  }

  function planItemRestore(items, backupSources, sourceIdMap, memoryIdMap, reservedIds) {
    const validationSourceMap = new Map(backupSources.map((source, index) => {
      const normalized = normalizeBackupSource(source, index);
      return [normalized.id, normalized];
    }));
    const reserved = new Set(reservedIds);
    const reservedMemoryIds = new Set();
    return items.map((value, index) => {
      const source = validationSourceMap.get(value.sourceId);
      const item = normalizeBackupItem(value, index, new Map([[value.sourceId, source]]));
      const targetSourceId = sourceIdMap.get(item.sourceId);
      if (!targetSourceId) throw backupReferenceError("Inbox restore is missing a source ID mapping.");
      const targetMemoryId = item.memoryId ? memoryIdMap.get(item.memoryId) : "";
      if (item.memoryId && !targetMemoryId) throw backupReferenceError("Inbox restore is missing a memory ID mapping.");
      if (targetMemoryId && !statements.memoryExists.get(requireId(targetMemoryId, "mapped memoryId"))) {
        throw backupReferenceError("Inbox restore references a missing target memory.");
      }
      if (targetMemoryId) {
        if (reservedMemoryIds.has(targetMemoryId)) {
          throw memoryInboxError("Multiple inbox receipts map to the same target memory.", "MEMORY_INBOX_BACKUP_MAPPING_COLLISION", 409);
        }
        reservedMemoryIds.add(targetMemoryId);
        const linked = statements.itemByMemory.get(targetMemoryId);
        if (linked && linked.anchor_key !== item.anchorKey) {
          throw memoryInboxError("The target memory already has a different inbox receipt.", "MEMORY_INBOX_BACKUP_MAPPING_COLLISION", 409);
        }
      }
      const projected = { ...item, sourceId: targetSourceId, memoryId: targetMemoryId || "" };
      const existingByAnchor = statements.itemByAnchor.get(item.anchorKey);
      if (existingByAnchor) {
        const existing = rowToItem(existingByAnchor);
        if (!sameRestoredItem(existing, projected)) {
          throw memoryInboxError("An existing inbox anchor has different receipt state.", "MEMORY_INBOX_BACKUP_MAPPING_COLLISION", 409);
        }
        reserved.add(existing.id);
        return { item, value: projected, targetId: existing.id, reused: true };
      }
      let targetId = item.id;
      if (reserved.has(targetId) || statements.sourceOrItemById.get(targetId)) {
        targetId = allocateId("inbox-item", { get: (id) => reserved.has(id) || statements.sourceOrItemById.get(id) });
      }
      reserved.add(targetId);
      return { item, value: projected, targetId, reused: false };
    });
  }

  function sourceCount() {
    return Number(statements.countSources.get()?.count) || 0;
  }

  function itemCount() {
    return Number(statements.countItems.get()?.count) || 0;
  }

  function requireItem(itemId) {
    const item = getMemoryInboxItem(itemId);
    if (!item) throw memoryInboxError("The memory-inbox item was not found.", "MEMORY_INBOX_ITEM_NOT_FOUND", 404);
    return item;
  }

  function allocateId(prefix, lookup) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const candidate = requireId(createId(prefix), `${prefix} id`);
      if (!lookup.get(candidate)) return candidate;
    }
    throw memoryInboxError("A unique memory-inbox ID could not be allocated.", "MEMORY_INBOX_ID_CONFLICT", 500);
  }

  return Object.freeze({
    createMemoryInboxItem,
    getMemoryInboxSource,
    listMemoryInboxSources,
    getMemoryInboxItem,
    listMemoryInboxItems,
    getMemoryInboxReceiptForMemory,
    dismissMemoryInboxItem,
    reopenMemoryInboxItem,
    admitMemoryInboxItem,
    detachMemoryInboxAdmission,
    clearMemoryInbox,
    getMemoryInboxStats,
    buildMemoryInboxBackup: buildMemoryInboxDatabaseBackup,
    validateMemoryInboxBackup,
    restoreMemoryInboxBackup
  });
}

function prepareStatements(db) {
  return {
    sourceById: db.prepare("SELECT * FROM memory_inbox_sources WHERE id = ?"),
    sourceByKey: db.prepare("SELECT * FROM memory_inbox_sources WHERE source_key = ?"),
    listSources: db.prepare("SELECT * FROM memory_inbox_sources ORDER BY created_at, id"),
    sourceOrItemById: db.prepare(`
      SELECT id FROM memory_inbox_sources WHERE id = ?1
      UNION ALL SELECT id FROM memory_inbox_items WHERE id = ?1 LIMIT 1
    `),
    insertSource: db.prepare(`
      INSERT INTO memory_inbox_sources (
        id, schema_version, source_key, kind, display_name, format, mime_type,
        byte_size, decoded_length, raw_sha256, decoded_text_sha256, encoding,
        offset_unit, retention_mode, verified_at, created_at
      ) VALUES (
        @id, @schemaVersion, @sourceKey, @kind, @displayName, @format, @mimeType,
        @byteSize, @decodedLength, @rawSha256, @decodedTextSha256, @encoding,
        @offsetUnit, @retentionMode, @verifiedAt, @createdAt
      )
    `),
    restoreSource: db.prepare(`
      INSERT INTO memory_inbox_sources (
        id, schema_version, source_key, kind, display_name, format, mime_type,
        byte_size, decoded_length, raw_sha256, decoded_text_sha256, encoding,
        offset_unit, retention_mode, verified_at, created_at
      ) VALUES (
        @id, @schemaVersion, @sourceKey, @kind, @displayName, @format, @mimeType,
        @byteSize, @decodedLength, @rawSha256, @decodedTextSha256, @encoding,
        @offsetUnit, @retentionMode, @verifiedAt, @createdAt
      )
    `),
    itemById: db.prepare("SELECT * FROM memory_inbox_items WHERE id = ?"),
    itemByAnchor: db.prepare("SELECT * FROM memory_inbox_items WHERE anchor_key = ?"),
    itemByCreateKey: db.prepare("SELECT * FROM memory_inbox_items WHERE create_idempotency_key = ?"),
    itemByAdmissionKey: db.prepare("SELECT * FROM memory_inbox_items WHERE admission_idempotency_key = ?"),
    itemByMemory: db.prepare("SELECT * FROM memory_inbox_items WHERE memory_id = ?"),
    listItems: db.prepare("SELECT * FROM memory_inbox_items ORDER BY updated_at DESC, id LIMIT ?"),
    listItemsByStatus: db.prepare("SELECT * FROM memory_inbox_items WHERE status = ? ORDER BY updated_at DESC, id LIMIT ?"),
    listAllItems: db.prepare("SELECT * FROM memory_inbox_items ORDER BY created_at, id"),
    insertItem: db.prepare(`
      INSERT INTO memory_inbox_items (
        id, schema_version, source_id, anchor_key, offset_unit, start_offset, end_offset,
        start_line, start_column, end_line, end_column, excerpt_text, excerpt_sha256,
        status, needs_review, memory_id, version, create_idempotency_key,
        create_request_sha256, admission_idempotency_key, admission_request_sha256,
        created_at, updated_at, dismissed_at, accepted_at
      ) VALUES (
        @id, @schemaVersion, @sourceId, @anchorKey, @offsetUnit, @startOffset, @endOffset,
        @startLine, @startColumn, @endLine, @endColumn, @excerpt, @excerptSha256,
        'pending', 0, NULL, 1, @createIdempotencyKey, @createRequestSha256, NULL, NULL,
        @createdAt, @updatedAt, '', ''
      )
    `),
    restoreItem: db.prepare(`
      INSERT INTO memory_inbox_items (
        id, schema_version, source_id, anchor_key, offset_unit, start_offset, end_offset,
        start_line, start_column, end_line, end_column, excerpt_text, excerpt_sha256,
        status, needs_review, memory_id, version, create_idempotency_key,
        create_request_sha256, admission_idempotency_key, admission_request_sha256,
        created_at, updated_at, dismissed_at, accepted_at
      ) VALUES (
        @id, @schemaVersion, @sourceId, @anchorKey, @offsetUnit, @startOffset, @endOffset,
        @startLine, @startColumn, @endLine, @endColumn, @excerpt, @excerptSha256,
        @status, @needsReview, @memoryId, @version, NULL, NULL, NULL, NULL,
        @createdAt, @updatedAt, @dismissedAt, @acceptedAt
      )
    `),
    dismissItem: db.prepare(`
      UPDATE memory_inbox_items SET status = 'dismissed', dismissed_at = ?, updated_at = ?, version = version + 1
      WHERE id = ? AND version = ? AND status = 'pending'
    `),
    reopenItem: db.prepare(`
      UPDATE memory_inbox_items SET status = 'pending', dismissed_at = '', updated_at = ?, version = version + 1
      WHERE id = ? AND version = ? AND status = 'dismissed'
    `),
    admitItem: db.prepare(`
      UPDATE memory_inbox_items SET status = 'accepted', memory_id = ?,
        admission_idempotency_key = ?, admission_request_sha256 = ?, accepted_at = ?,
        updated_at = ?, version = version + 1
      WHERE id = ? AND version = ? AND status = 'pending'
    `),
    orphanItem: db.prepare(`
      UPDATE memory_inbox_items SET status = 'orphaned', memory_id = NULL,
        needs_review = 1, updated_at = ?, version = version + 1
      WHERE id = ? AND version = ? AND status = 'accepted'
    `),
    countSources: db.prepare("SELECT COUNT(*) AS count FROM memory_inbox_sources"),
    countItems: db.prepare("SELECT COUNT(*) AS count FROM memory_inbox_items"),
    countItemsByStatus: db.prepare("SELECT status, COUNT(*) AS count FROM memory_inbox_items GROUP BY status"),
    countNeedsReview: db.prepare("SELECT COUNT(*) AS count FROM memory_inbox_items WHERE needs_review = 1"),
    memoryExists: db.prepare("SELECT 1 FROM memories WHERE id = ?"),
    clearItems: db.prepare("DELETE FROM memory_inbox_items"),
    clearSources: db.prepare("DELETE FROM memory_inbox_sources")
  };
}

function sourceInsertParameters(id, source, createdAt, verifiedAt = createdAt) {
  return {
    id,
    schemaVersion: MEMORY_INBOX_SCHEMA_VERSION,
    sourceKey: source.sourceKey,
    kind: source.kind,
    displayName: source.displayName,
    format: source.format,
    mimeType: source.mimeType,
    byteSize: source.byteSize,
    decodedLength: source.decodedLength,
    rawSha256: source.rawSha256,
    decodedTextSha256: source.decodedTextSha256,
    encoding: source.encoding,
    offsetUnit: source.offsetUnit,
    retentionMode: source.retentionMode,
    verifiedAt,
    createdAt
  };
}

function itemInsertParameters(input) {
  return {
    id: input.id,
    schemaVersion: MEMORY_INBOX_SCHEMA_VERSION,
    sourceId: input.sourceId,
    anchorKey: input.anchor.anchorKey,
    offsetUnit: input.anchor.offsetUnit,
    startOffset: input.anchor.startOffset,
    endOffset: input.anchor.endOffset,
    startLine: input.anchor.startLine,
    startColumn: input.anchor.startColumn,
    endLine: input.anchor.endLine,
    endColumn: input.anchor.endColumn,
    excerpt: input.anchor.excerpt,
    excerptSha256: input.anchor.excerptSha256,
    createIdempotencyKey: input.createIdempotencyKey,
    createRequestSha256: input.createRequestSha256,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt
  };
}

function itemRestoreParameters(plan) {
  const value = plan.value;
  return {
    id: plan.targetId,
    schemaVersion: MEMORY_INBOX_SCHEMA_VERSION,
    sourceId: value.sourceId,
    anchorKey: value.anchorKey,
    offsetUnit: value.offsetUnit,
    startOffset: value.startOffset,
    endOffset: value.endOffset,
    startLine: value.startLine,
    startColumn: value.startColumn,
    endLine: value.endLine,
    endColumn: value.endColumn,
    excerpt: value.excerpt,
    excerptSha256: value.excerptSha256,
    status: value.status,
    needsReview: value.needsReview ? 1 : 0,
    memoryId: value.memoryId || null,
    version: value.version,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    dismissedAt: value.dismissedAt,
    acceptedAt: value.acceptedAt
  };
}

function rowToSource(row) {
  return {
    schemaVersion: Number(row.schema_version),
    id: row.id,
    sourceKey: row.source_key,
    kind: row.kind,
    displayName: row.display_name,
    format: row.format,
    mimeType: row.mime_type,
    byteSize: Number(row.byte_size),
    decodedLength: Number(row.decoded_length),
    rawSha256: row.raw_sha256,
    decodedTextSha256: row.decoded_text_sha256,
    encoding: row.encoding,
    offsetUnit: row.offset_unit,
    retentionMode: row.retention_mode,
    verifiedAt: row.verified_at,
    createdAt: row.created_at
  };
}

function rowToItem(row) {
  return {
    schemaVersion: Number(row.schema_version),
    id: row.id,
    sourceId: row.source_id,
    anchorKey: row.anchor_key,
    offsetUnit: row.offset_unit,
    startOffset: Number(row.start_offset),
    endOffset: Number(row.end_offset),
    startLine: Number(row.start_line),
    startColumn: Number(row.start_column),
    endLine: Number(row.end_line),
    endColumn: Number(row.end_column),
    excerpt: row.excerpt_text,
    excerptSha256: row.excerpt_sha256,
    status: row.status,
    needsReview: Boolean(row.needs_review),
    memoryId: row.memory_id || "",
    version: Number(row.version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    dismissedAt: row.dismissed_at,
    acceptedAt: row.accepted_at
  };
}

function assertSourceIdentity(existing, incoming) {
  const keys = ["sourceKey", "kind", "byteSize", "decodedLength", "rawSha256", "decodedTextSha256", "encoding", "offsetUnit", "retentionMode"];
  if (keys.some((key) => existing[key] !== incoming[key])) {
    throw memoryInboxError("An existing source key has different immutable metadata.", "MEMORY_INBOX_SOURCE_COLLISION", 409);
  }
}

function sameRestoredItem(existing, incoming) {
  const keys = [
    "sourceId", "anchorKey", "offsetUnit", "startOffset", "endOffset", "startLine", "startColumn",
    "endLine", "endColumn", "excerpt", "excerptSha256", "status", "needsReview", "memoryId",
    "dismissedAt", "acceptedAt"
  ];
  return keys.every((key) => existing[key] === incoming[key]);
}

function requireDatabase(db) {
  if (!db || typeof db.exec !== "function" || typeof db.prepare !== "function") {
    throw new TypeError("initializeMemoryInboxDatabase requires a synchronous SQLite database.");
  }
  return db;
}

function requireId(value, name) {
  const id = String(value || "").trim();
  if (!ID_PATTERN.test(id)) throw memoryInboxError(`${name} is invalid.`, "MEMORY_INBOX_ID_INVALID");
  return id;
}

function requireIdempotencyKey(value) {
  const key = String(value || "").trim();
  if (!IDEMPOTENCY_PATTERN.test(key)) {
    throw memoryInboxError("Idempotency-Key must contain 8 to 120 letters, digits, underscores, or hyphens.", "MEMORY_INBOX_IDEMPOTENCY_KEY_INVALID");
  }
  return key;
}

function requireStatus(value) {
  const status = String(value || "");
  if (!STATUS_SET.has(status)) throw memoryInboxError("Inbox status is invalid.", "MEMORY_INBOX_STATUS_INVALID");
  return status;
}

function requireConfirmation(mutation) {
  if (!mutation || mutation.confirm !== true) {
    throw memoryInboxError("This operation requires confirm: true.", "MEMORY_INBOX_CONFIRMATION_REQUIRED");
  }
}

function assertExpectedVersion(item, value) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw memoryInboxError("The current item version is required.", "MEMORY_INBOX_PRECONDITION_REQUIRED", 428);
  }
  if (item.version !== value) throw versionConflict();
}

function requireTimestamp(value) {
  const timestamp = String(value || "");
  if (!timestamp || timestamp.length > 40 || !Number.isFinite(Date.parse(timestamp)) ||
      new Date(timestamp).toISOString() !== timestamp) {
    throw new TypeError("Memory-inbox timestamps must be valid ISO timestamps.");
  }
  return timestamp;
}

function nextTimestamp(now, previous) {
  const candidate = requireTimestamp(now);
  if (!previous || Date.parse(candidate) > Date.parse(previous)) return candidate;
  return new Date(Date.parse(previous) + 1).toISOString();
}

function boundedInteger(value, minimum, maximum, fallback) {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw memoryInboxError("A numeric option is outside its supported range.", "MEMORY_INBOX_OPTIONS_INVALID");
  }
  return number;
}

function normalizeIdList(value, name) {
  if (!Array.isArray(value) && !(value instanceof Set)) throw memoryInboxError(`${name} must be an array or Set.`, "MEMORY_INBOX_BACKUP_MAPPING_INVALID");
  return [...value].map((id) => requireId(id, name));
}

function normalizeIdMap(value) {
  if (value instanceof Map) return new Map([...value].map(([source, target]) => [requireId(source, "source memoryId"), requireId(target, "target memoryId")]));
  if (value && typeof value === "object" && !Array.isArray(value)) return normalizeIdMap(new Map(Object.entries(value)));
  throw memoryInboxError("memoryIdMap must be a Map or object.", "MEMORY_INBOX_BACKUP_MAPPING_INVALID");
}

function assertPlainObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw memoryInboxError(`${name} must be an object.`, "MEMORY_INBOX_INPUT_INVALID");
  }
}

function assertKnownKeys(value, allowed, name) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) {
    throw memoryInboxError(`${name} contains unsupported field(s): ${unknown.join(", ")}.`, "MEMORY_INBOX_FIELD_SET_INVALID");
  }
}

function requireSynchronousResult(value) {
  if (value && typeof value.then === "function") throw new TypeError("Memory admission callbacks must be synchronous.");
  return value;
}

function readAdmittedMemory(memoryId, getMemory) {
  if (!memoryId) throw memoryInboxError("The idempotent admission receipt has no memory.", "MEMORY_INBOX_ADMISSION_FAILED", 500);
  if (typeof getMemory !== "function") return { id: memoryId };
  const memory = getMemory(memoryId);
  if (!memory) throw memoryInboxError("The admitted memory no longer exists.", "MEMORY_INBOX_ADMISSION_ORPHANED", 409);
  return memory;
}

function idempotencyConflict() {
  return memoryInboxError("The idempotency key was already used for a different request.", "MEMORY_INBOX_IDEMPOTENCY_CONFLICT", 409);
}

function versionConflict() {
  return memoryInboxError("The inbox item changed; refresh before continuing.", "MEMORY_INBOX_VERSION_CONFLICT", 412);
}

function backupReferenceError(message) {
  return memoryInboxError(message, "MEMORY_INBOX_BACKUP_REFERENCE_INVALID");
}

function normalizeDatabaseError(error) {
  const message = String(error?.message || "");
  if (message.includes("UNIQUE constraint failed: memory_inbox_items.create_idempotency_key") ||
      message.includes("UNIQUE constraint failed: memory_inbox_items.admission_idempotency_key")) return idempotencyConflict();
  if (message.includes("MEMORY_INBOX_ANCHOR_IMMUTABLE")) {
    return memoryInboxError("A persisted inbox anchor cannot be changed.", "MEMORY_INBOX_ANCHOR_IMMUTABLE", 409);
  }
  if (message.includes("MEMORY_INBOX_SOURCE_IMMUTABLE")) {
    return memoryInboxError("A persisted inbox source descriptor cannot be changed.", "MEMORY_INBOX_SOURCE_IMMUTABLE", 409);
  }
  if (message.includes("MEMORY_INBOX_ITEM_TERMINAL")) {
    return memoryInboxError("An accepted or orphaned inbox item is immutable.", "MEMORY_INBOX_ITEM_TERMINAL", 409);
  }
  return error;
}

module.exports = {
  MEMORY_INBOX_MIGRATION,
  initializeMemoryInboxDatabase,
  rowToItem,
  rowToSource
};
