"use strict";

const { randomUUID } = require("node:crypto");
const { applyMigrations } = require("./migrations");

const MAX_VOICE_PER_MEMORY = 3;
const MAX_VOICE_BYTES = 12 * 1024 * 1024;
const MAX_VOICE_DURATION_MS = 3 * 60 * 1000;
const MAX_TRANSCRIPT_LENGTH = 20000;
const MAX_BACKUP_ASSETS = 1500;
const ID_PATTERN = /^[a-zA-Z0-9_-]{1,120}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const MIME_CODECS = Object.freeze({
  "audio/webm": "opus",
  "audio/mp4": "aac"
});
const ASSET_STATUSES = new Set(["staging", "ready", "pending_delete"]);
const TRANSCRIPT_STATUSES = new Set(["draft", "confirmed"]);
const TRANSCRIPT_SOURCES = new Set(["manual", "import"]);

const VOICE_MIGRATION = Object.freeze({
  version: 8,
  name: "voice-memories-and-confirmed-transcripts",
  up(db) {
    db.exec(`
      CREATE TABLE voice_assets (
        id TEXT PRIMARY KEY,
        schema_version INTEGER NOT NULL DEFAULT 8 CHECK (schema_version = 8),
        content_sha256 TEXT NOT NULL UNIQUE,
        original_name TEXT NOT NULL DEFAULT '',
        mime_type TEXT NOT NULL CHECK (mime_type IN ('audio/webm', 'audio/mp4')),
        codec TEXT NOT NULL CHECK (codec IN ('opus', 'aac')),
        byte_size INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= ${MAX_VOICE_BYTES}),
        duration_ms INTEGER NOT NULL CHECK (duration_ms > 0 AND duration_ms <= ${MAX_VOICE_DURATION_MS}),
        storage_key TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'staging'
          CHECK (status IN ('staging', 'ready', 'pending_delete')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (
          (mime_type = 'audio/webm' AND codec = 'opus') OR
          (mime_type = 'audio/mp4' AND codec = 'aac')
        )
      );

      CREATE TABLE memory_voice (
        memory_id TEXT NOT NULL,
        asset_id TEXT NOT NULL,
        position INTEGER NOT NULL CHECK (position >= 0),
        label TEXT NOT NULL DEFAULT '' CHECK (length(label) <= 1000),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (memory_id, asset_id),
        UNIQUE (memory_id, position),
        FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE,
        FOREIGN KEY (asset_id) REFERENCES voice_assets(id) ON DELETE RESTRICT
      );

      CREATE TABLE voice_transcripts (
        memory_id TEXT NOT NULL,
        asset_id TEXT NOT NULL,
        text TEXT NOT NULL CHECK (length(trim(text)) > 0 AND length(text) <= ${MAX_TRANSCRIPT_LENGTH}),
        language TEXT NOT NULL DEFAULT '' CHECK (length(language) <= 35),
        source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'import')),
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed')),
        confirmed_at TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (memory_id, asset_id),
        FOREIGN KEY (memory_id, asset_id)
          REFERENCES memory_voice(memory_id, asset_id) ON DELETE CASCADE,
        CHECK (
          (status = 'draft' AND confirmed_at = '') OR
          (status = 'confirmed' AND confirmed_at <> '')
        )
      );

      CREATE INDEX idx_voice_assets_status_updated
        ON voice_assets(status, updated_at, id);
      CREATE INDEX idx_memory_voice_asset
        ON memory_voice(asset_id, memory_id);
      CREATE INDEX idx_voice_transcripts_status
        ON voice_transcripts(status, memory_id, asset_id);

      CREATE TRIGGER memory_voice_ready_insert
      BEFORE INSERT ON memory_voice
      WHEN NOT EXISTS (
        SELECT 1 FROM voice_assets asset
        WHERE asset.id = new.asset_id AND asset.status = 'ready'
      )
      BEGIN
        SELECT RAISE(ABORT, 'VOICE_ASSET_NOT_READY');
      END;

      CREATE TRIGGER memory_voice_limit_insert
      BEFORE INSERT ON memory_voice
      WHEN (SELECT COUNT(*) FROM memory_voice link WHERE link.memory_id = new.memory_id) >= ${MAX_VOICE_PER_MEMORY}
      BEGIN
        SELECT RAISE(ABORT, 'VOICE_MEMORY_LIMIT');
      END;

      CREATE TRIGGER memory_voice_position_insert
      BEFORE INSERT ON memory_voice
      WHEN new.position <> (
        SELECT COUNT(*) FROM memory_voice link WHERE link.memory_id = new.memory_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'VOICE_POSITION_NOT_CONTIGUOUS');
      END;

      CREATE TRIGGER memory_voice_identity_immutable
      BEFORE UPDATE OF memory_id, asset_id ON memory_voice
      WHEN new.memory_id <> old.memory_id OR new.asset_id <> old.asset_id
      BEGIN
        SELECT RAISE(ABORT, 'VOICE_ASSOCIATION_IMMUTABLE');
      END;

      CREATE TRIGGER memory_voice_position_guard
      BEFORE UPDATE OF position ON memory_voice
      WHEN new.position <> old.position
        AND new.position <> old.position + 10
        AND NOT (old.position >= 10 AND new.position = old.position - 11)
      BEGIN
        SELECT RAISE(ABORT, 'VOICE_POSITION_NOT_CONTIGUOUS');
      END;

      CREATE TRIGGER memory_voice_compact_after_delete
      AFTER DELETE ON memory_voice
      BEGIN
        UPDATE memory_voice
        SET position = position + 10
        WHERE memory_id = old.memory_id AND position > old.position;
        UPDATE memory_voice
        SET position = position - 11
        WHERE memory_id = old.memory_id AND position >= 10;
      END;

      CREATE TRIGGER voice_asset_ready_while_linked
      BEFORE UPDATE OF status ON voice_assets
      WHEN old.status = 'ready' AND new.status <> 'ready' AND EXISTS (
        SELECT 1 FROM memory_voice link WHERE link.asset_id = old.id
      )
      BEGIN
        SELECT RAISE(ABORT, 'VOICE_ASSET_IN_USE');
      END;
    `);

    upgradeSearchIndexForVoice(db);
  }
});

function initializeVoiceDatabase(options = {}) {
  const db = requireDatabase(options.db);
  const now = typeof options.now === "function" ? options.now : () => new Date().toISOString();
  const createId = typeof options.createId === "function"
    ? options.createId
    : (prefix) => `${prefix}-${randomUUID()}`;
  const suppliedTransaction = typeof options.withTransaction === "function" ? options.withTransaction : null;
  const onConfirmedTranscriptChanged = typeof options.onConfirmedTranscriptChanged === "function"
    ? options.onConfirmedTranscriptChanged
    : null;

  if (options.applyMigrations !== false) {
    const supportedVersion = Math.max(8, Number(options.schemaVersion) || 8);
    applyMigrations({ db, baselineVersion: 4, migrations: [VOICE_MIGRATION], supportedVersion, now });
  }
  if (!tableExists(db, "voice_assets") || !tableExists(db, "memory_voice") || !tableExists(db, "voice_transcripts")) {
    throw voiceError("声音数据表尚未迁移到 V8。", "VOICE_SCHEMA_NOT_READY", 500);
  }

  const statements = prepareStatements(db);

  function runAtomic(operation) {
    if (suppliedTransaction) {
      try {
        return requireSynchronous(suppliedTransaction(() => requireSynchronous(operation())));
      } catch (error) {
        throw normalizeSqliteError(error);
      }
    }
    const savepoint = `voice_write_${randomUUID().replace(/-/gu, "")}`;
    db.exec(`SAVEPOINT ${savepoint}`);
    try {
      const result = requireSynchronous(operation());
      db.exec(`RELEASE SAVEPOINT ${savepoint}`);
      return result;
    } catch (error) {
      try { db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`); } catch { /* preserve the original failure */ }
      try { db.exec(`RELEASE SAVEPOINT ${savepoint}`); } catch { /* preserve the original failure */ }
      throw normalizeSqliteError(error);
    }
  }

  function createVoiceAsset(input = {}) {
    const asset = normalizeAssetInput(input, { now: getNow(), createId: newId });
    return runAtomic(() => {
      if (statements.getAsset.get(asset.id)) {
        throw voiceError(`声音资产已存在：${asset.id}。`, "VOICE_ASSET_ID_EXISTS", 409);
      }
      if (statements.getAssetByHash.get(asset.contentSha256)) {
        throw voiceError("相同内容的声音资产已经存在。", "VOICE_ASSET_HASH_EXISTS", 409);
      }
      if (statements.getAssetByStorageKey.get(asset.storageKey)) {
        throw voiceError("声音存储位置已经被占用。", "VOICE_STORAGE_KEY_EXISTS", 409);
      }
      statements.insertAsset.run(
        asset.id,
        asset.contentSha256,
        asset.originalName,
        asset.mimeType,
        asset.codec,
        asset.byteSize,
        asset.durationMs,
        asset.storageKey,
        asset.status,
        asset.createdAt,
        asset.updatedAt
      );
      return getVoiceAsset(asset.id);
    });
  }

  function getVoiceAsset(assetId) {
    const row = statements.getAsset.get(requireId(assetId, "assetId"));
    return row ? rowToAsset(row) : null;
  }

  function getVoiceAssetByHash(hash) {
    const row = statements.getAssetByHash.get(requireSha256(hash, "hash"));
    return row ? rowToAsset(row) : null;
  }

  function listVoiceAssets(filters = {}) {
    assertPlainObject(filters, "filters");
    assertKnownKeys(filters, new Set(["status", "mimeType", "before", "unreferenced", "limit", "offset"]), "filters");
    const status = filters.status === undefined ? "" : requireEnum(filters.status, ASSET_STATUSES, "filters.status");
    const mimeType = filters.mimeType === undefined ? "" : requireMimeType(filters.mimeType, "filters.mimeType");
    const before = filters.before === undefined ? "" : requireTimestamp(filters.before, "filters.before");
    const unreferenced = filters.unreferenced === undefined
      ? false
      : requireBoolean(filters.unreferenced, "filters.unreferenced");
    const limit = optionalInteger(filters.limit, "filters.limit", 1, 5000, MAX_BACKUP_ASSETS);
    const offset = optionalInteger(filters.offset, "filters.offset", 0, 1000000, 0);
    return statements.listAssetsWithUsage.all()
      .filter((row) => !status || row.status === status)
      .filter((row) => !mimeType || row.mime_type === mimeType)
      .filter((row) => !before || Date.parse(row.updated_at) < Date.parse(before))
      .filter((row) => !unreferenced || Number(row.reference_count) === 0)
      .slice(offset, offset + limit)
      .map((row) => ({ ...rowToAsset(row), referenceCount: Number(row.reference_count) || 0 }));
  }

  function listUnreferencedVoiceAssets(filters = {}) {
    assertPlainObject(filters, "filters");
    assertKnownKeys(filters, new Set(["status", "before", "limit"]), "filters");
    return listVoiceAssets({ ...filters, unreferenced: true, offset: 0 });
  }

  function updateVoiceAsset(assetId, patch = {}) {
    const id = requireId(assetId, "assetId");
    assertPlainObject(patch, "asset patch");
    assertKnownKeys(patch, new Set(["originalName", "status"]), "asset patch");
    const existing = getVoiceAsset(id);
    if (!existing) throw voiceError(`没有找到声音资产 ${id}。`, "VOICE_ASSET_NOT_FOUND", 404);
    if (!Object.keys(patch).length) return existing;
    const status = patch.status === undefined
      ? existing.status
      : requireEnum(patch.status, ASSET_STATUSES, "asset.status");
    const originalName = patch.originalName === undefined
      ? existing.originalName
      : normalizeFilename(patch.originalName, "asset.originalName");
    if (status === "pending_delete" && statements.countLinksForAsset.get(id).count > 0) {
      throw voiceError("仍被展品使用的声音不能进入待删除状态。", "VOICE_ASSET_IN_USE", 409);
    }
    return runAtomic(() => {
      statements.updateAsset.run(originalName, status, getNow(), id);
      return getVoiceAsset(id);
    });
  }

  function markVoiceReady(assetId) {
    return updateVoiceAsset(assetId, { status: "ready" });
  }

  function markVoicePendingDelete(assetId) {
    return updateVoiceAsset(assetId, { status: "pending_delete" });
  }

  function deleteVoiceAsset(assetId) {
    const id = requireId(assetId, "assetId");
    const existing = getVoiceAsset(id);
    if (!existing) return null;
    if (Number(statements.countLinksForAsset.get(id)?.count) > 0) {
      throw voiceError("仍被展品使用的声音不能删除。", "VOICE_ASSET_IN_USE", 409);
    }
    return runAtomic(() => {
      statements.deleteAsset.run(id);
      return existing;
    });
  }

  function getVoiceUsage(assetId) {
    const id = requireId(assetId, "assetId");
    const asset = getVoiceAsset(id);
    if (!asset) return null;
    const memoryIds = statements.memoryIdsForAsset.all(id).map((row) => row.memory_id);
    return {
      assetId: id,
      status: asset.status,
      memoryCount: memoryIds.length,
      memoryIds,
      transcriptCount: Number(statements.countTranscriptsForAsset.get(id)?.count) || 0
    };
  }

  function listVoiceForMemory(memoryId) {
    const id = requireId(memoryId, "memoryId");
    requireMemory(id);
    return statements.listLinksForMemory.all(id).map((row) => hydrateLink(row));
  }

  function replaceMemoryVoice(memoryId, associations = []) {
    const id = requireId(memoryId, "memoryId");
    requireMemory(id);
    if (!Array.isArray(associations) || associations.length > MAX_VOICE_PER_MEMORY) {
      throw voiceError(`每件展品最多关联 ${MAX_VOICE_PER_MEMORY} 段声音。`, "VOICE_MEMORY_LIMIT", 400);
    }
    const normalized = associations.map((entry, position) => normalizeAssociation(entry, position));
    if (new Set(normalized.map((entry) => entry.assetId)).size !== normalized.length) {
      throw voiceError("同一段声音不能在一件展品中重复出现。", "VOICE_ASSOCIATION_DUPLICATE", 409);
    }
    normalized.forEach((entry) => requireReadyAsset(entry.assetId));
    const existingLinks = new Map(statements.listLinksForMemory.all(id).map((row) => [row.asset_id, row]));
    const existingTranscripts = new Map(statements.listTranscriptsForMemory.all(id).map((row) => [row.asset_id, row]));
    const removedConfirmed = [...existingTranscripts.values()].filter((row) =>
      row.status === "confirmed" && !normalized.some((entry) => entry.assetId === row.asset_id)
    );
    const timestamp = getNow();

    return runAtomic(() => {
      statements.deleteLinksForMemory.run(id);
      for (const entry of normalized) {
        const previousLink = existingLinks.get(entry.assetId);
        statements.insertLink.run(
          id,
          entry.assetId,
          entry.position,
          entry.label,
          previousLink?.created_at || timestamp,
          timestamp
        );
        const transcript = existingTranscripts.get(entry.assetId);
        if (transcript) insertTranscriptRow(transcript);
      }
      for (const transcript of removedConfirmed) {
        notifyConfirmedTranscriptChanged(id, {
          assetId: transcript.asset_id,
          reason: "association-removed",
          previousTranscript: rowToTranscript(transcript),
          transcript: null
        });
      }
      refreshMemoryVoiceText(id, timestamp);
      return listVoiceForMemory(id);
    });
  }

  function detachVoice(memoryId, assetId) {
    const normalizedMemoryId = requireId(memoryId, "memoryId");
    const normalizedAssetId = requireId(assetId, "assetId");
    requireMemory(normalizedMemoryId);
    const row = statements.getLink.get(normalizedMemoryId, normalizedAssetId);
    if (!row) return null;
    const hydrated = hydrateLink(row);
    const timestamp = getNow();
    return runAtomic(() => {
      statements.deleteLink.run(normalizedMemoryId, normalizedAssetId);
      if (hydrated.transcript?.status === "confirmed") {
        notifyConfirmedTranscriptChanged(normalizedMemoryId, {
          assetId: normalizedAssetId,
          reason: "association-removed",
          previousTranscript: hydrated.transcript,
          transcript: null
        });
      }
      refreshMemoryVoiceText(normalizedMemoryId, timestamp);
      return hydrated;
    });
  }

  function getVoiceTranscript(memoryId, assetId) {
    const row = statements.getTranscript.get(
      requireId(memoryId, "memoryId"),
      requireId(assetId, "assetId")
    );
    return row ? rowToTranscript(row) : null;
  }

  function upsertVoiceTranscript(input = {}) {
    assertPlainObject(input, "transcript");
    assertKnownKeys(input, new Set([
      "memoryId", "assetId", "text", "language", "source", "status",
      "confirmed", "confirmedAt", "createdAt", "updatedAt"
    ]), "transcript");
    const memoryId = requireId(input.memoryId, "transcript.memoryId");
    const assetId = requireId(input.assetId, "transcript.assetId");
    if (!statements.getLink.get(memoryId, assetId)) {
      throw voiceError("转写必须属于现有的展品声音关联。", "VOICE_ASSOCIATION_NOT_FOUND", 404);
    }
    const existingRow = statements.getTranscript.get(memoryId, assetId);
    const existing = existingRow ? rowToTranscript(existingRow) : null;
    const timestamp = getNow();
    const status = normalizeTranscriptStatus(input, existing);
    const text = input.text === undefined && existing
      ? existing.text
      : requireText(input.text, "transcript.text", MAX_TRANSCRIPT_LENGTH);
    const language = input.language === undefined && existing
      ? existing.language
      : normalizeLanguage(input.language, "transcript.language");
    const source = input.source === undefined && existing
      ? existing.source
      : optionalEnum(input.source, TRANSCRIPT_SOURCES, "transcript.source", "manual");
    let confirmedAt = "";
    if (status === "confirmed") {
      const unchangedConfirmation = existing?.status === "confirmed" && existing.text === text;
      confirmedAt = input.confirmedAt === undefined
        ? (unchangedConfirmation ? existing.confirmedAt : timestamp)
        : requireTimestamp(input.confirmedAt, "transcript.confirmedAt");
    } else if (input.confirmedAt !== undefined && input.confirmedAt !== "") {
      throw voiceError("草稿转写不能包含确认时间。", "VOICE_TRANSCRIPT_CONFIRMATION_INVALID", 400);
    }
    const transcript = {
      memoryId,
      assetId,
      text,
      language,
      source,
      status,
      confirmedAt,
      createdAt: existing?.createdAt || optionalTimestamp(input.createdAt, "transcript.createdAt", timestamp),
      updatedAt: optionalTimestamp(input.updatedAt, "transcript.updatedAt", timestamp)
    };
    validateTimestampOrder(transcript.createdAt, transcript.updatedAt, transcript.confirmedAt, "transcript");
    const previousConfirmedText = existing?.status === "confirmed" ? existing.text : "";
    const nextConfirmedText = transcript.status === "confirmed" ? transcript.text : "";

    return runAtomic(() => {
      statements.upsertTranscript.run(
        transcript.memoryId,
        transcript.assetId,
        transcript.text,
        transcript.language,
        transcript.source,
        transcript.status,
        transcript.confirmedAt,
        transcript.createdAt,
        transcript.updatedAt
      );
      const saved = getVoiceTranscript(memoryId, assetId);
      if (previousConfirmedText !== nextConfirmedText) {
        notifyConfirmedTranscriptChanged(memoryId, {
          assetId,
          reason: existing ? "transcript-updated" : "transcript-created",
          previousTranscript: existing,
          transcript: saved
        });
      }
      refreshMemoryVoiceText(memoryId, timestamp);
      return saved;
    });
  }

  function deleteVoiceTranscript(memoryId, assetId) {
    const normalizedMemoryId = requireId(memoryId, "memoryId");
    const normalizedAssetId = requireId(assetId, "assetId");
    const existing = getVoiceTranscript(normalizedMemoryId, normalizedAssetId);
    if (!existing) return null;
    const timestamp = getNow();
    return runAtomic(() => {
      statements.deleteTranscript.run(normalizedMemoryId, normalizedAssetId);
      if (existing.status === "confirmed") {
        notifyConfirmedTranscriptChanged(normalizedMemoryId, {
          assetId: normalizedAssetId,
          reason: "transcript-deleted",
          previousTranscript: existing,
          transcript: null
        });
      }
      refreshMemoryVoiceText(normalizedMemoryId, timestamp);
      return existing;
    });
  }

  function getVoiceStats() {
    const row = statements.stats.get();
    return {
      assets: Number(row.assets) || 0,
      ready: Number(row.ready) || 0,
      staging: Number(row.staging) || 0,
      pendingDelete: Number(row.pending_delete) || 0,
      memoryLinks: Number(row.memory_links) || 0,
      transcripts: Number(row.transcripts) || 0,
      confirmedTranscripts: Number(row.confirmed_transcripts) || 0,
      draftTranscripts: Number(row.draft_transcripts) || 0,
      totalBytes: Number(row.total_bytes) || 0,
      totalDurationMs: Number(row.total_duration_ms) || 0
    };
  }

  function clearVoiceData() {
    const before = getVoiceStats();
    const affectedMemoryIds = statements.memoryIdsWithConfirmedTranscripts.all().map((row) => row.memory_id);
    const timestamp = getNow();
    return runAtomic(() => {
      statements.clearTranscripts.run();
      statements.clearLinks.run();
      statements.clearAssets.run();
      statements.clearVoiceSearchText.run(timestamp);
      for (const memoryId of affectedMemoryIds) {
        notifyConfirmedTranscriptChanged(memoryId, {
          assetId: null,
          reason: "purge",
          previousTranscript: null,
          transcript: null
        });
      }
      return {
        voiceAssetsDeleted: before.assets,
        memoryVoiceLinksDeleted: before.memoryLinks,
        voiceTranscriptsDeleted: before.transcripts,
        confirmedTranscriptsDeleted: before.confirmedTranscripts
      };
    });
  }

  function exportVoiceData(mode = "full", sourceMemoryIds) {
    const sourceIds = sourceMemoryIds === undefined
      ? statements.listMemoryIds.all().map((row) => row.id)
      : normalizeSourceMemoryIds(sourceMemoryIds);
    const sourceSet = new Set(sourceIds);
    const links = statements.listAllLinks.all().filter((row) => sourceSet.has(row.memory_id));
    const assetIds = new Set(links.map((row) => row.asset_id));
    const assets = statements.listAssets.all().filter((row) => assetIds.has(row.id)).map(rowToAsset);
    const transcripts = statements.listAllTranscripts.all()
      .filter((row) => sourceSet.has(row.memory_id) && assetIds.has(row.asset_id))
      .map(rowToTranscript);
    if (mode === "redacted") {
      return {
        mode: "redacted-summary",
        assetCount: assets.length,
        memoryLinkCount: links.length,
        transcriptCount: transcripts.length,
        confirmedTranscriptCount: transcripts.filter((item) => item.status === "confirmed").length,
        totalDurationMs: assets.reduce((sum, item) => sum + item.durationMs, 0),
        note: "声音文件、文件名、哈希、路径、展品 ID、转写文字与精确时间已从脱敏备份中移除。"
      };
    }
    if (mode !== "full") throw voiceError("声音备份模式无效。", "VOICE_BACKUP_INVALID", 400);
    return {
      mode: "full",
      schemaVersion: 8,
      assets,
      memoryLinks: links.map(rowToLink),
      transcripts
    };
  }

  function validateVoiceData(data, sourceMemoryIds) {
    normalizeVoiceBackup(data, sourceMemoryIds);
    return true;
  }

  function restoreVoiceData(data, restoreOptions = {}) {
    if (data?.mode === "redacted-summary") {
      normalizeVoiceBackup(data, []);
      return {
        assets: 0,
        assetsReused: 0,
        memoryLinks: 0,
        transcripts: 0,
        idMap: { memories: {}, assets: {}, storageKeys: {} }
      };
    }
    const optionsObject = restoreOptions instanceof Map
      ? { memoryIdMap: restoreOptions }
      : restoreOptions;
    assertPlainObject(optionsObject, "restore options");
    assertKnownKeys(optionsObject, new Set(["memoryIdMap", "assetIdMap", "storageKeyMap"]), "restore options");
    const memoryMap = normalizeOptionalIdMap(optionsObject.memoryIdMap, "memoryIdMap");
    const sourceBoundary = memoryMap ? [...memoryMap.keys()] : undefined;
    const normalized = normalizeVoiceBackup(data, sourceBoundary);
    const sourceMemoryIds = [...new Set(normalized.memoryLinks.map((link) => link.memoryId))];
    const resolvedMemoryMap = memoryMap || new Map(sourceMemoryIds.map((id) => [id, id]));
    if (new Set([...resolvedMemoryMap.values()]).size !== resolvedMemoryMap.size) {
      throw voiceError("多个源展品不能映射到同一件目标展品。", "VOICE_BACKUP_MAPPING_COLLISION", 409);
    }
    for (const sourceId of sourceMemoryIds) {
      if (!resolvedMemoryMap.has(sourceId)) {
        throw voiceError("声音恢复缺少展品 ID 映射。", "VOICE_BACKUP_REFERENCE_INVALID", 400);
      }
      requireMemory(resolvedMemoryMap.get(sourceId));
    }
    const explicitAssetMap = normalizeOptionalIdMap(optionsObject.assetIdMap, "assetIdMap") || new Map();
    const storageKeyMap = normalizeOptionalStorageMap(optionsObject.storageKeyMap);
    const assetPlans = planAssetRestore(normalized.assets, explicitAssetMap, storageKeyMap);
    const assetMap = new Map(assetPlans.map((plan) => [plan.source.id, plan.targetId]));
    const storageMap = new Map(assetPlans.map((plan) => [plan.source.storageKey, plan.targetStorageKey]));
    const linksByTargetMemory = new Map();
    for (const link of normalized.memoryLinks) {
      const targetMemoryId = resolvedMemoryMap.get(link.memoryId);
      const targetAssetId = assetMap.get(link.assetId);
      if (!targetMemoryId || !targetAssetId) {
        throw voiceError("声音恢复引用缺少目标映射。", "VOICE_BACKUP_REFERENCE_INVALID", 400);
      }
      const list = linksByTargetMemory.get(targetMemoryId) || [];
      list.push({ source: link, targetAssetId });
      linksByTargetMemory.set(targetMemoryId, list);
    }
    for (const [targetMemoryId, links] of linksByTargetMemory) {
      const existing = statements.listLinksForMemory.all(targetMemoryId);
      const combinedIds = existing.map((row) => row.asset_id).concat(links.map((entry) => entry.targetAssetId));
      if (combinedIds.length > MAX_VOICE_PER_MEMORY) {
        throw voiceError(`恢复后每件展品仍只能保留 ${MAX_VOICE_PER_MEMORY} 段声音。`, "VOICE_MEMORY_LIMIT", 409);
      }
      if (new Set(combinedIds).size !== combinedIds.length) {
        throw voiceError("恢复会制造重复的展品声音关联。", "VOICE_BACKUP_MAPPING_COLLISION", 409);
      }
    }
    const transcriptByLink = new Map(normalized.transcripts.map((item) => [associationKey(item.memoryId, item.assetId), item]));
    const timestamp = getNow();

    return runAtomic(() => {
      for (const plan of assetPlans) {
        if (plan.reused) continue;
        const source = plan.source;
        statements.insertAsset.run(
          plan.targetId,
          source.contentSha256,
          source.originalName,
          source.mimeType,
          source.codec,
          source.byteSize,
          source.durationMs,
          plan.targetStorageKey,
          source.status,
          source.createdAt,
          source.updatedAt
        );
      }
      let linksRestored = 0;
      let transcriptsRestored = 0;
      const confirmedMemories = new Set();
      for (const [targetMemoryId, links] of linksByTargetMemory) {
        const existingCount = statements.listLinksForMemory.all(targetMemoryId).length;
        links.sort((left, right) => left.source.position - right.source.position || left.source.assetId.localeCompare(right.source.assetId));
        links.forEach((plan, index) => {
          const link = plan.source;
          statements.insertLink.run(
            targetMemoryId,
            plan.targetAssetId,
            existingCount + index,
            link.label,
            link.createdAt,
            link.updatedAt
          );
          linksRestored += 1;
          const sourceTranscript = transcriptByLink.get(associationKey(link.memoryId, link.assetId));
          if (!sourceTranscript) return;
          statements.upsertTranscript.run(
            targetMemoryId,
            plan.targetAssetId,
            sourceTranscript.text,
            sourceTranscript.language,
            sourceTranscript.source,
            sourceTranscript.status,
            sourceTranscript.confirmedAt,
            sourceTranscript.createdAt,
            sourceTranscript.updatedAt
          );
          transcriptsRestored += 1;
          if (sourceTranscript.status === "confirmed") confirmedMemories.add(targetMemoryId);
        });
      }
      for (const memoryId of linksByTargetMemory.keys()) {
        if (confirmedMemories.has(memoryId)) {
          notifyConfirmedTranscriptChanged(memoryId, {
            assetId: null,
            reason: "restore",
            previousTranscript: null,
            transcript: null
          });
        }
        refreshMemoryVoiceText(memoryId, timestamp);
      }
      return {
        assets: assetPlans.filter((plan) => !plan.reused).length,
        assetsReused: assetPlans.filter((plan) => plan.reused).length,
        memoryLinks: linksRestored,
        transcripts: transcriptsRestored,
        idMap: {
          memories: Object.fromEntries(resolvedMemoryMap),
          assets: Object.fromEntries(assetMap),
          storageKeys: Object.fromEntries(storageMap)
        }
      };
    });
  }

  function planAssetRestore(assets, explicitAssetMap, storageKeyMap) {
    const reservedIds = new Set();
    const reservedStorageKeys = new Set();
    return assets.map((source) => {
      const existingByHash = statements.getAssetByHash.get(source.contentSha256);
      const hasExplicitId = explicitAssetMap.has(source.id);
      if (existingByHash && !hasExplicitId) {
        assertReusableAsset(existingByHash, source);
        if (reservedIds.has(existingByHash.id)) {
          throw voiceError("多个备份声音不能复用同一目标资产。", "VOICE_BACKUP_MAPPING_COLLISION", 409);
        }
        reservedIds.add(existingByHash.id);
        return {
          source,
          targetId: existingByHash.id,
          targetStorageKey: existingByHash.storage_key,
          reused: true
        };
      }
      let targetId;
      if (hasExplicitId) {
        targetId = explicitAssetMap.get(source.id);
        if (statements.getAsset.get(targetId) || reservedIds.has(targetId)) {
          throw voiceError("显式指定的声音资产 ID 已被占用。", "VOICE_BACKUP_ID_COLLISION", 409);
        }
        if (existingByHash) {
          throw voiceError("显式恢复映射与已有内容哈希冲突。", "VOICE_BACKUP_HASH_COLLISION", 409);
        }
      } else if (!statements.getAsset.get(source.id) && !reservedIds.has(source.id)) {
        targetId = source.id;
      } else {
        targetId = createUniqueAssetId(reservedIds);
      }
      let targetStorageKey = storageKeyMap.get(source.storageKey) || source.storageKey;
      targetStorageKey = requireStorageKey(targetStorageKey, "mapped storageKey");
      if (statements.getAssetByStorageKey.get(targetStorageKey) || reservedStorageKeys.has(targetStorageKey)) {
        throw voiceError("声音恢复的目标存储位置已被占用。", "VOICE_BACKUP_STORAGE_COLLISION", 409);
      }
      reservedIds.add(targetId);
      reservedStorageKeys.add(targetStorageKey);
      return { source, targetId, targetStorageKey, reused: false };
    });
  }

  function createUniqueAssetId(reservedIds) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const id = newId("voice");
      if (!reservedIds.has(id) && !statements.getAsset.get(id)) return id;
    }
    throw voiceError("无法生成不冲突的声音资产 ID。", "VOICE_BACKUP_ID_COLLISION", 409);
  }

  function assertReusableAsset(row, source) {
    const existing = rowToAsset(row);
    if (
      existing.mimeType !== source.mimeType ||
      existing.codec !== source.codec ||
      existing.byteSize !== source.byteSize ||
      existing.durationMs !== source.durationMs ||
      (source.status === "ready" && existing.status !== "ready")
    ) {
      throw voiceError("已有同哈希声音的技术信息与备份不一致。", "VOICE_BACKUP_HASH_COLLISION", 409);
    }
  }

  function refreshMemoryVoiceText(memoryId, timestamp) {
    const text = statements.confirmedTextForMemory.all(memoryId)
      .map((row) => row.text.trim())
      .filter(Boolean)
      .join("\n");
    statements.updateVoiceSearchText.run(text, timestamp, memoryId);
    return text;
  }

  function notifyConfirmedTranscriptChanged(memoryId, event) {
    if (!onConfirmedTranscriptChanged) return;
    const result = onConfirmedTranscriptChanged(memoryId, Object.freeze({ memoryId, ...event }));
    requireSynchronous(result);
  }

  function hydrateLink(row) {
    const link = rowToLink(row);
    return {
      ...link,
      asset: rowToAsset(statements.getAsset.get(link.assetId)),
      transcript: getVoiceTranscript(link.memoryId, link.assetId)
    };
  }

  function insertTranscriptRow(row) {
    statements.upsertTranscript.run(
      row.memory_id,
      row.asset_id,
      row.text,
      row.language,
      row.source,
      row.status,
      row.confirmed_at,
      row.created_at,
      row.updated_at
    );
  }

  function requireMemory(memoryId) {
    if (!statements.memoryExists.get(memoryId)) {
      throw voiceError(`没有找到展品 ${memoryId}。`, "VOICE_MEMORY_NOT_FOUND", 404);
    }
  }

  function requireReadyAsset(assetId) {
    const row = statements.getAsset.get(assetId);
    if (!row) throw voiceError(`没有找到声音资产 ${assetId}。`, "VOICE_ASSET_NOT_FOUND", 404);
    if (row.status !== "ready") {
      throw voiceError("只有处理完成的声音才能关联到展品。", "VOICE_ASSET_NOT_READY", 409);
    }
    return row;
  }

  function getNow() {
    return requireTimestamp(now(), "now()");
  }

  function newId(prefix) {
    return requireId(createId(prefix), `${prefix} id`);
  }

  return Object.freeze({
    buildVoiceBackup: exportVoiceData,
    clearVoiceData,
    createVoiceAsset,
    deleteVoiceAsset,
    deleteVoiceTranscript,
    detachVoice,
    exportVoiceData,
    getVoiceAsset,
    getVoiceAssetByHash,
    getVoiceStats,
    getVoiceTranscript,
    getVoiceUsage,
    listVoiceAssets,
    listVoiceForMemory,
    listUnreferencedVoiceAssets,
    markVoicePendingDelete,
    markVoiceReady,
    purgeVoiceData: clearVoiceData,
    replaceMemoryVoice,
    replaceMemoryVoices: replaceMemoryVoice,
    restoreVoiceBackup: restoreVoiceData,
    restoreVoiceData,
    updateVoiceAsset,
    upsertVoiceTranscript,
    validateVoiceBackup: validateVoiceData,
    validateVoiceData
  });
}

function prepareStatements(db) {
  return {
    memoryExists: db.prepare("SELECT 1 AS found FROM memories WHERE id = ?"),
    listMemoryIds: db.prepare("SELECT id FROM memories ORDER BY id"),
    insertAsset: db.prepare(`
      INSERT INTO voice_assets (
        id, schema_version, content_sha256, original_name, mime_type, codec,
        byte_size, duration_ms, storage_key, status, created_at, updated_at
      ) VALUES (?, 8, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    updateAsset: db.prepare("UPDATE voice_assets SET original_name = ?, status = ?, updated_at = ? WHERE id = ?"),
    deleteAsset: db.prepare("DELETE FROM voice_assets WHERE id = ?"),
    getAsset: db.prepare("SELECT * FROM voice_assets WHERE id = ?"),
    getAssetByHash: db.prepare("SELECT * FROM voice_assets WHERE content_sha256 = ?"),
    getAssetByStorageKey: db.prepare("SELECT * FROM voice_assets WHERE storage_key = ?"),
    listAssets: db.prepare("SELECT * FROM voice_assets ORDER BY datetime(created_at) DESC, id"),
    listAssetsWithUsage: db.prepare(`
      SELECT asset.*,
        (SELECT COUNT(*) FROM memory_voice link WHERE link.asset_id = asset.id) AS reference_count
      FROM voice_assets asset
      ORDER BY datetime(asset.created_at) DESC, asset.id
    `),
    countLinksForAsset: db.prepare("SELECT COUNT(*) AS count FROM memory_voice WHERE asset_id = ?"),
    countTranscriptsForAsset: db.prepare("SELECT COUNT(*) AS count FROM voice_transcripts WHERE asset_id = ?"),
    memoryIdsForAsset: db.prepare("SELECT memory_id FROM memory_voice WHERE asset_id = ? ORDER BY memory_id"),
    insertLink: db.prepare(`
      INSERT INTO memory_voice (
        memory_id, asset_id, position, label, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `),
    getLink: db.prepare("SELECT * FROM memory_voice WHERE memory_id = ? AND asset_id = ?"),
    listLinksForMemory: db.prepare(`
      SELECT * FROM memory_voice
      WHERE memory_id = ?
      ORDER BY position, asset_id
    `),
    listAllLinks: db.prepare("SELECT * FROM memory_voice ORDER BY memory_id, position, asset_id"),
    deleteLink: db.prepare("DELETE FROM memory_voice WHERE memory_id = ? AND asset_id = ?"),
    deleteLinksForMemory: db.prepare("DELETE FROM memory_voice WHERE memory_id = ?"),
    getTranscript: db.prepare("SELECT * FROM voice_transcripts WHERE memory_id = ? AND asset_id = ?"),
    listTranscriptsForMemory: db.prepare("SELECT * FROM voice_transcripts WHERE memory_id = ? ORDER BY asset_id"),
    listAllTranscripts: db.prepare("SELECT * FROM voice_transcripts ORDER BY memory_id, asset_id"),
    upsertTranscript: db.prepare(`
      INSERT INTO voice_transcripts (
        memory_id, asset_id, text, language, source, status, confirmed_at,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(memory_id, asset_id) DO UPDATE SET
        text = excluded.text,
        language = excluded.language,
        source = excluded.source,
        status = excluded.status,
        confirmed_at = excluded.confirmed_at,
        updated_at = excluded.updated_at
    `),
    deleteTranscript: db.prepare("DELETE FROM voice_transcripts WHERE memory_id = ? AND asset_id = ?"),
    confirmedTextForMemory: db.prepare(`
      SELECT transcript.text
      FROM memory_voice link
      JOIN voice_transcripts transcript
        ON transcript.memory_id = link.memory_id AND transcript.asset_id = link.asset_id
      WHERE link.memory_id = ? AND transcript.status = 'confirmed'
      ORDER BY link.position, link.asset_id
    `),
    updateVoiceSearchText: db.prepare(`
      UPDATE memory_search_documents
      SET voice_text = ?, updated_at = ?
      WHERE memory_id = ?
    `),
    clearVoiceSearchText: db.prepare(`
      UPDATE memory_search_documents
      SET voice_text = '', updated_at = ?
      WHERE voice_text <> ''
    `),
    memoryIdsWithConfirmedTranscripts: db.prepare(`
      SELECT DISTINCT memory_id FROM voice_transcripts
      WHERE status = 'confirmed' ORDER BY memory_id
    `),
    stats: db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM voice_assets) AS assets,
        (SELECT COUNT(*) FROM voice_assets WHERE status = 'ready') AS ready,
        (SELECT COUNT(*) FROM voice_assets WHERE status = 'staging') AS staging,
        (SELECT COUNT(*) FROM voice_assets WHERE status = 'pending_delete') AS pending_delete,
        (SELECT COUNT(*) FROM memory_voice) AS memory_links,
        (SELECT COUNT(*) FROM voice_transcripts) AS transcripts,
        (SELECT COUNT(*) FROM voice_transcripts WHERE status = 'confirmed') AS confirmed_transcripts,
        (SELECT COUNT(*) FROM voice_transcripts WHERE status = 'draft') AS draft_transcripts,
        (SELECT COALESCE(SUM(byte_size), 0) FROM voice_assets) AS total_bytes,
        (SELECT COALESCE(SUM(duration_ms), 0) FROM voice_assets) AS total_duration_ms
    `),
    clearTranscripts: db.prepare("DELETE FROM voice_transcripts"),
    clearLinks: db.prepare("DELETE FROM memory_voice"),
    clearAssets: db.prepare("DELETE FROM voice_assets")
  };
}

function upgradeSearchIndexForVoice(db) {
  db.exec("ALTER TABLE memory_search_documents ADD COLUMN voice_text TEXT NOT NULL DEFAULT ''");
  db.exec(`
    DROP TRIGGER IF EXISTS memory_search_documents_ai;
    DROP TRIGGER IF EXISTS memory_search_documents_ad;
    DROP TRIGGER IF EXISTS memory_search_documents_au;
    DROP TABLE IF EXISTS memory_search_fts;
  `);
  try {
    db.exec(`
      CREATE VIRTUAL TABLE memory_search_fts USING fts5(
        title, exhibit_text, raw_content, location_text, people_text,
        tags_text, emotions_text, source_text, entity_text, voice_text,
        content = 'memory_search_documents',
        content_rowid = 'id',
        tokenize = 'trigram'
      );

      CREATE TRIGGER memory_search_documents_ai
      AFTER INSERT ON memory_search_documents BEGIN
        INSERT INTO memory_search_fts(
          rowid, title, exhibit_text, raw_content, location_text, people_text,
          tags_text, emotions_text, source_text, entity_text, voice_text
        ) VALUES (
          new.id, new.title, new.exhibit_text, new.raw_content, new.location_text,
          new.people_text, new.tags_text, new.emotions_text, new.source_text,
          new.entity_text, new.voice_text
        );
      END;

      CREATE TRIGGER memory_search_documents_ad
      AFTER DELETE ON memory_search_documents BEGIN
        INSERT INTO memory_search_fts(
          memory_search_fts, rowid, title, exhibit_text, raw_content,
          location_text, people_text, tags_text, emotions_text, source_text,
          entity_text, voice_text
        ) VALUES (
          'delete', old.id, old.title, old.exhibit_text, old.raw_content,
          old.location_text, old.people_text, old.tags_text, old.emotions_text,
          old.source_text, old.entity_text, old.voice_text
        );
      END;

      CREATE TRIGGER memory_search_documents_au
      AFTER UPDATE ON memory_search_documents BEGIN
        INSERT INTO memory_search_fts(
          memory_search_fts, rowid, title, exhibit_text, raw_content,
          location_text, people_text, tags_text, emotions_text, source_text,
          entity_text, voice_text
        ) VALUES (
          'delete', old.id, old.title, old.exhibit_text, old.raw_content,
          old.location_text, old.people_text, old.tags_text, old.emotions_text,
          old.source_text, old.entity_text, old.voice_text
        );
        INSERT INTO memory_search_fts(
          rowid, title, exhibit_text, raw_content, location_text, people_text,
          tags_text, emotions_text, source_text, entity_text, voice_text
        ) VALUES (
          new.id, new.title, new.exhibit_text, new.raw_content, new.location_text,
          new.people_text, new.tags_text, new.emotions_text, new.source_text,
          new.entity_text, new.voice_text
        );
      END;

      INSERT INTO memory_search_fts(memory_search_fts) VALUES ('rebuild');
    `);
  } catch (error) {
    try {
      db.exec(`
        DROP TRIGGER IF EXISTS memory_search_documents_ai;
        DROP TRIGGER IF EXISTS memory_search_documents_ad;
        DROP TRIGGER IF EXISTS memory_search_documents_au;
        DROP TABLE IF EXISTS memory_search_fts;
      `);
    } catch { /* LIKE remains available when FTS5/trigram is unavailable. */ }
    if (!isFtsUnavailable(error)) throw error;
  }
}

function normalizeAssetInput(input, helpers) {
  assertPlainObject(input, "asset");
  assertKnownKeys(input, new Set([
    "id", "contentSha256", "sha256", "originalName", "mimeType", "sourceMimeType",
    "codec", "byteSize", "sourceByteSize", "durationMs", "storageKey", "status",
    "createdAt", "updatedAt"
  ]), "asset");
  const timestamp = helpers.now;
  const mimeType = requireMimeType(firstDefined(input.mimeType, input.sourceMimeType), "asset.mimeType");
  const codec = String(input.codec || MIME_CODECS[mimeType]).trim().toLowerCase();
  if (codec !== MIME_CODECS[mimeType]) {
    throw voiceError("声音 MIME 与编码组合无效。", "VOICE_FORMAT_INVALID", 400);
  }
  const asset = {
    id: input.id === undefined ? helpers.createId("voice") : requireId(input.id, "asset.id"),
    contentSha256: requireSha256(firstDefined(input.contentSha256, input.sha256), "asset.contentSha256"),
    originalName: normalizeFilename(input.originalName, "asset.originalName"),
    mimeType,
    codec,
    byteSize: requireInteger(firstDefined(input.byteSize, input.sourceByteSize), "asset.byteSize", 1, MAX_VOICE_BYTES),
    durationMs: requireInteger(input.durationMs, "asset.durationMs", 1, MAX_VOICE_DURATION_MS),
    storageKey: requireStorageKey(input.storageKey, "asset.storageKey"),
    status: optionalEnum(input.status, ASSET_STATUSES, "asset.status", "staging"),
    createdAt: optionalTimestamp(input.createdAt, "asset.createdAt", timestamp),
    updatedAt: optionalTimestamp(input.updatedAt, "asset.updatedAt", timestamp)
  };
  validateTimestampOrder(asset.createdAt, asset.updatedAt, "", "asset");
  return asset;
}

function normalizeAssociation(input, position) {
  assertPlainObject(input, `associations[${position}]`);
  assertKnownKeys(input, new Set(["assetId", "id", "label", "position"]), `associations[${position}]`);
  if (input.position !== undefined && input.position !== position) {
    throw voiceError("声音顺序必须从 0 连续排列。", "VOICE_POSITION_NOT_CONTIGUOUS", 400);
  }
  return {
    assetId: requireId(firstDefined(input.assetId, input.id), `associations[${position}].assetId`),
    position,
    label: optionalText(input.label, `associations[${position}].label`, 1000)
  };
}

function normalizeTranscriptStatus(input, existing) {
  if (input.confirmed !== undefined && typeof input.confirmed !== "boolean") {
    throw voiceError("transcript.confirmed 必须是布尔值。", "VOICE_TRANSCRIPT_INVALID", 400);
  }
  const fromBoolean = input.confirmed === undefined ? "" : input.confirmed ? "confirmed" : "draft";
  const fromStatus = input.status === undefined ? "" : requireEnum(input.status, TRANSCRIPT_STATUSES, "transcript.status");
  if (fromBoolean && fromStatus && fromBoolean !== fromStatus) {
    throw voiceError("转写确认状态互相矛盾。", "VOICE_TRANSCRIPT_INVALID", 400);
  }
  return fromStatus || fromBoolean || existing?.status || "draft";
}

function normalizeVoiceBackup(data, sourceMemoryIds) {
  assertPlainObject(data, "voice backup");
  if (data.mode === "redacted-summary") {
    assertExactKeys(data, [
      "assetCount", "confirmedTranscriptCount", "memoryLinkCount", "mode",
      "note", "totalDurationMs", "transcriptCount"
    ], "redacted voice backup");
    const assetCount = requireNonNegativeInteger(data.assetCount, "assetCount", MAX_BACKUP_ASSETS);
    const linkCount = requireNonNegativeInteger(data.memoryLinkCount, "memoryLinkCount", MAX_BACKUP_ASSETS * MAX_VOICE_PER_MEMORY);
    const transcriptCount = requireNonNegativeInteger(data.transcriptCount, "transcriptCount", linkCount);
    const confirmedCount = requireNonNegativeInteger(data.confirmedTranscriptCount, "confirmedTranscriptCount", transcriptCount);
    requireNonNegativeInteger(data.totalDurationMs, "totalDurationMs", MAX_BACKUP_ASSETS * MAX_VOICE_DURATION_MS);
    requireText(data.note, "note", 300);
    if (linkCount < assetCount && assetCount > 0) {
      throw voiceError("脱敏声音统计互相矛盾。", "VOICE_BACKUP_INVALID", 400);
    }
    return { mode: data.mode, assets: [], memoryLinks: [], transcripts: [], assetCount, linkCount, transcriptCount, confirmedCount };
  }
  assertExactKeys(data, ["assets", "memoryLinks", "mode", "schemaVersion", "transcripts"], "voice backup");
  if (data.mode !== "full" || data.schemaVersion !== 8) {
    throw voiceError("声音备份模式或版本无效。", "VOICE_BACKUP_INVALID", 400);
  }
  if (!Array.isArray(data.assets) || data.assets.length > MAX_BACKUP_ASSETS ||
      !Array.isArray(data.memoryLinks) || data.memoryLinks.length > MAX_BACKUP_ASSETS * MAX_VOICE_PER_MEMORY ||
      !Array.isArray(data.transcripts) || data.transcripts.length > data.memoryLinks.length) {
    throw voiceError("声音备份数量无效。", "VOICE_BACKUP_INVALID", 400);
  }
  const boundary = sourceMemoryIds === undefined ? null : new Set(normalizeSourceMemoryIds(sourceMemoryIds));
  const assets = data.assets.map((item, index) => normalizeBackupAsset(item, index));
  assertUnique(assets.map((item) => item.id), "声音资产 ID", "VOICE_BACKUP_DUPLICATE");
  assertUnique(assets.map((item) => item.contentSha256), "声音内容哈希", "VOICE_BACKUP_DUPLICATE");
  assertUnique(assets.map((item) => item.storageKey), "声音存储位置", "VOICE_BACKUP_DUPLICATE");
  const assetById = new Map(assets.map((item) => [item.id, item]));
  const memoryLinks = data.memoryLinks.map((item, index) => normalizeBackupLink(item, index));
  const linkKeys = memoryLinks.map((item) => associationKey(item.memoryId, item.assetId));
  assertUnique(linkKeys, "展品声音关联", "VOICE_BACKUP_DUPLICATE");
  const linksByMemory = new Map();
  for (const link of memoryLinks) {
    if (boundary && !boundary.has(link.memoryId)) {
      throw voiceError("声音关联引用了备份边界之外的展品。", "VOICE_BACKUP_REFERENCE_INVALID", 400);
    }
    const asset = assetById.get(link.assetId);
    if (!asset) throw voiceError("声音关联引用了缺失的资产。", "VOICE_BACKUP_REFERENCE_INVALID", 400);
    if (asset.status !== "ready") {
      throw voiceError("声音关联只能引用 ready 资产。", "VOICE_BACKUP_REFERENCE_INVALID", 400);
    }
    const list = linksByMemory.get(link.memoryId) || [];
    list.push(link);
    linksByMemory.set(link.memoryId, list);
  }
  for (const links of linksByMemory.values()) {
    if (links.length > MAX_VOICE_PER_MEMORY) {
      throw voiceError("声音备份超出单件展品上限。", "VOICE_MEMORY_LIMIT", 400);
    }
    const positions = links.map((item) => item.position).sort((a, b) => a - b);
    if (positions.some((position, index) => position !== index)) {
      throw voiceError("声音备份顺序不连续。", "VOICE_POSITION_NOT_CONTIGUOUS", 400);
    }
  }
  const linkSet = new Set(linkKeys);
  const transcripts = data.transcripts.map((item, index) => normalizeBackupTranscript(item, index));
  const transcriptKeys = transcripts.map((item) => associationKey(item.memoryId, item.assetId));
  assertUnique(transcriptKeys, "声音转写", "VOICE_BACKUP_DUPLICATE");
  for (const transcript of transcripts) {
    if (!linkSet.has(associationKey(transcript.memoryId, transcript.assetId))) {
      throw voiceError("转写引用了缺失的展品声音关联。", "VOICE_BACKUP_REFERENCE_INVALID", 400);
    }
  }
  const usedAssetIds = new Set(memoryLinks.map((item) => item.assetId));
  if (assets.some((asset) => !usedAssetIds.has(asset.id))) {
    throw voiceError("声音备份包含未被所选展品引用的资产。", "VOICE_BACKUP_REFERENCE_INVALID", 400);
  }
  return { mode: "full", assets, memoryLinks, transcripts };
}

function normalizeBackupAsset(input, index) {
  assertPlainObject(input, `assets[${index}]`);
  assertExactKeys(input, [
    "byteSize", "codec", "contentSha256", "createdAt", "durationMs", "id",
    "mimeType", "originalName", "schemaVersion", "status", "storageKey", "updatedAt"
  ], `assets[${index}]`);
  if (input.schemaVersion !== 8) throw voiceError("声音资产 schemaVersion 无效。", "VOICE_BACKUP_INVALID", 400);
  const { schemaVersion: _schemaVersion, ...assetInput } = input;
  return normalizeAssetInput(assetInput, {
    now: requireTimestamp(input.updatedAt, `assets[${index}].updatedAt`),
    createId: () => requireId(input.id, `assets[${index}].id`)
  });
}

function normalizeBackupLink(input, index) {
  assertPlainObject(input, `memoryLinks[${index}]`);
  assertExactKeys(input, ["assetId", "createdAt", "label", "memoryId", "position", "updatedAt"], `memoryLinks[${index}]`);
  const result = {
    memoryId: requireId(input.memoryId, `memoryLinks[${index}].memoryId`),
    assetId: requireId(input.assetId, `memoryLinks[${index}].assetId`),
    position: requireInteger(input.position, `memoryLinks[${index}].position`, 0, MAX_VOICE_PER_MEMORY - 1),
    label: optionalText(input.label, `memoryLinks[${index}].label`, 1000),
    createdAt: requireTimestamp(input.createdAt, `memoryLinks[${index}].createdAt`),
    updatedAt: requireTimestamp(input.updatedAt, `memoryLinks[${index}].updatedAt`)
  };
  validateTimestampOrder(result.createdAt, result.updatedAt, "", `memoryLinks[${index}]`);
  return result;
}

function normalizeBackupTranscript(input, index) {
  assertPlainObject(input, `transcripts[${index}]`);
  assertExactKeys(input, [
    "assetId", "confirmedAt", "createdAt", "language", "memoryId", "source",
    "status", "text", "updatedAt"
  ], `transcripts[${index}]`);
  const status = requireEnum(input.status, TRANSCRIPT_STATUSES, `transcripts[${index}].status`);
  const confirmedAt = status === "confirmed"
    ? requireTimestamp(input.confirmedAt, `transcripts[${index}].confirmedAt`)
    : String(input.confirmedAt || "");
  if (status === "draft" && confirmedAt) {
    throw voiceError("草稿转写不能包含确认时间。", "VOICE_BACKUP_INVALID", 400);
  }
  const result = {
    memoryId: requireId(input.memoryId, `transcripts[${index}].memoryId`),
    assetId: requireId(input.assetId, `transcripts[${index}].assetId`),
    text: requireText(input.text, `transcripts[${index}].text`, MAX_TRANSCRIPT_LENGTH),
    language: normalizeLanguage(input.language, `transcripts[${index}].language`),
    source: requireEnum(input.source, TRANSCRIPT_SOURCES, `transcripts[${index}].source`),
    status,
    confirmedAt,
    createdAt: requireTimestamp(input.createdAt, `transcripts[${index}].createdAt`),
    updatedAt: requireTimestamp(input.updatedAt, `transcripts[${index}].updatedAt`)
  };
  validateTimestampOrder(result.createdAt, result.updatedAt, result.confirmedAt, `transcripts[${index}]`);
  return result;
}

function rowToAsset(row) {
  return {
    id: row.id,
    schemaVersion: Number(row.schema_version) || 8,
    contentSha256: row.content_sha256,
    originalName: row.original_name || "",
    mimeType: row.mime_type,
    codec: row.codec,
    byteSize: Number(row.byte_size) || 0,
    durationMs: Number(row.duration_ms) || 0,
    storageKey: row.storage_key,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToLink(row) {
  return {
    memoryId: row.memory_id,
    assetId: row.asset_id,
    position: Number(row.position) || 0,
    label: row.label || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToTranscript(row) {
  return {
    memoryId: row.memory_id,
    assetId: row.asset_id,
    text: row.text,
    language: row.language || "",
    source: row.source,
    status: row.status,
    confirmedAt: row.confirmed_at || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function requireDatabase(db) {
  if (!db || typeof db.exec !== "function" || typeof db.prepare !== "function") {
    throw new TypeError("initializeVoiceDatabase 需要同步 SQLite 数据库连接。");
  }
  return db;
}

function requireSynchronous(result) {
  if (result && typeof result.then === "function") {
    throw new TypeError("声音数据库事务与回调必须同步执行。");
  }
  return result;
}

function requireId(value, name) {
  const id = String(value ?? "").trim();
  if (!ID_PATTERN.test(id)) throw voiceError(`${name} 无效。`, "VOICE_ID_INVALID", 400);
  return id;
}

function requireSha256(value, name) {
  const hash = String(value ?? "").trim().toLowerCase();
  if (!SHA256_PATTERN.test(hash)) throw voiceError(`${name} 必须是 SHA-256。`, "VOICE_HASH_INVALID", 400);
  return hash;
}

function requireMimeType(value, name) {
  const mimeType = String(value || "").trim().toLowerCase();
  if (!Object.hasOwn(MIME_CODECS, mimeType)) {
    throw voiceError(`${name} 仅支持 audio/webm 或 audio/mp4。`, "VOICE_FORMAT_INVALID", 400);
  }
  return mimeType;
}

function requireStorageKey(value, name) {
  const key = requireText(value, name, 500);
  if (key.startsWith("/") || key.includes("\\") || key.includes(":") ||
      key.split("/").some((part) => !part || part === "." || part === "..") ||
      !/^[a-zA-Z0-9._/-]+$/u.test(key)) {
    throw voiceError(`${name} 必须是安全的相对路径。`, "VOICE_STORAGE_KEY_INVALID", 400);
  }
  return key;
}

function normalizeFilename(value, name) {
  const filename = value === undefined ? "" : optionalText(value, name, 255);
  if (/[\\/]/u.test(filename) || filename === "." || filename === "..") {
    throw voiceError(`${name} 不能包含路径。`, "VOICE_FILENAME_INVALID", 400);
  }
  return filename;
}

function requireText(value, name, maximum) {
  if (typeof value !== "string") throw voiceError(`${name} 必须是文本。`, "VOICE_TEXT_INVALID", 400);
  const text = value.trim();
  if (!text || text.length > maximum || text.includes("\0")) {
    throw voiceError(`${name} 不能为空且最多 ${maximum} 字。`, "VOICE_TEXT_INVALID", 400);
  }
  return text;
}

function optionalText(value, name, maximum) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw voiceError(`${name} 必须是文本。`, "VOICE_TEXT_INVALID", 400);
  const text = value.trim();
  if (text.length > maximum || text.includes("\0")) {
    throw voiceError(`${name} 最多 ${maximum} 字。`, "VOICE_TEXT_INVALID", 400);
  }
  return text;
}

function normalizeLanguage(value, name) {
  const language = optionalText(value, name, 35);
  if (language && !/^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/u.test(language)) {
    throw voiceError(`${name} 必须是有效的语言标签。`, "VOICE_TRANSCRIPT_INVALID", 400);
  }
  return language;
}

function requireTimestamp(value, name) {
  const timestamp = String(value || "").trim();
  if (!timestamp || timestamp.length > 40 || !Number.isFinite(Date.parse(timestamp))) {
    throw voiceError(`${name} 必须是有效时间戳。`, "VOICE_TIMESTAMP_INVALID", 400);
  }
  return timestamp;
}

function optionalTimestamp(value, name, fallback) {
  return value === undefined ? fallback : requireTimestamp(value, name);
}

function validateTimestampOrder(createdAt, updatedAt, confirmedAt, name) {
  if (Date.parse(createdAt) > Date.parse(updatedAt) || (confirmedAt && Date.parse(confirmedAt) > Date.parse(updatedAt))) {
    throw voiceError(`${name} 的时间顺序无效。`, "VOICE_TIMESTAMP_INVALID", 400);
  }
}

function requireEnum(value, allowed, name) {
  if (typeof value !== "string" || !allowed.has(value)) {
    throw voiceError(`${name} 无效。`, "VOICE_VALUE_INVALID", 400);
  }
  return value;
}

function optionalEnum(value, allowed, name, fallback) {
  return value === undefined ? fallback : requireEnum(value, allowed, name);
}

function requireInteger(value, name, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw voiceError(`${name} 必须是 ${minimum} 至 ${maximum} 的整数。`, "VOICE_VALUE_INVALID", 400);
  }
  return value;
}

function optionalInteger(value, name, minimum, maximum, fallback) {
  return value === undefined ? fallback : requireInteger(value, name, minimum, maximum);
}

function requireBoolean(value, name) {
  if (typeof value !== "boolean") {
    throw voiceError(`${name} 必须是布尔值。`, "VOICE_VALUE_INVALID", 400);
  }
  return value;
}

function requireNonNegativeInteger(value, name, maximum) {
  return requireInteger(value, name, 0, maximum);
}

function normalizeSourceMemoryIds(value) {
  if (!Array.isArray(value) || value.length > MAX_BACKUP_ASSETS) {
    throw voiceError("sourceMemoryIds 数量无效。", "VOICE_BACKUP_INVALID", 400);
  }
  const ids = value.map((item, index) => requireId(item, `sourceMemoryIds[${index}]`));
  assertUnique(ids, "sourceMemoryIds", "VOICE_BACKUP_DUPLICATE");
  return ids;
}

function normalizeOptionalIdMap(value, name) {
  if (value === undefined || value === null) return null;
  const entries = value instanceof Map
    ? [...value.entries()]
    : value && typeof value === "object" && !Array.isArray(value)
      ? Object.entries(value)
      : null;
  if (!entries) throw voiceError(`${name} 必须是 Map 或对象。`, "VOICE_BACKUP_MAPPING_INVALID", 400);
  return new Map(entries.map(([source, target]) => [requireId(source, `${name} source`), requireId(target, `${name} target`)]));
}

function normalizeOptionalStorageMap(value) {
  if (value === undefined || value === null) return new Map();
  const entries = value instanceof Map
    ? [...value.entries()]
    : value && typeof value === "object" && !Array.isArray(value)
      ? Object.entries(value)
      : null;
  if (!entries) throw voiceError("storageKeyMap 必须是 Map 或对象。", "VOICE_BACKUP_MAPPING_INVALID", 400);
  return new Map(entries.map(([source, target]) => [
    requireStorageKey(source, "source storageKey"),
    requireStorageKey(target, "target storageKey")
  ]));
}

function assertPlainObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw voiceError(`${name} 必须是对象。`, "VOICE_VALUE_INVALID", 400);
  }
}

function assertKnownKeys(value, allowed, name) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) throw voiceError(`${name} 包含不支持的字段：${unknown.join(", ")}。`, "VOICE_VALUE_INVALID", 400);
}

function assertExactKeys(value, expected, name) {
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (keys.length !== wanted.length || keys.some((key, index) => key !== wanted[index])) {
    throw voiceError(`${name} 字段无效。`, "VOICE_BACKUP_INVALID", 400);
  }
}

function assertUnique(values, name, code) {
  if (new Set(values).size !== values.length) {
    throw voiceError(`${name} 不能重复。`, code, 409);
  }
}

function associationKey(memoryId, assetId) {
  return `${memoryId}\0${assetId}`;
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined);
}

function tableExists(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

function isFtsUnavailable(error) {
  const text = `${error?.code || ""} ${error?.message || ""}`.toLowerCase();
  return text.includes("fts5") || text.includes("trigram") || text.includes("no such module");
}

function normalizeSqliteError(error) {
  const message = String(error?.message || "");
  const known = [
    "VOICE_ASSET_NOT_READY",
    "VOICE_MEMORY_LIMIT",
    "VOICE_POSITION_NOT_CONTIGUOUS",
    "VOICE_ASSOCIATION_IMMUTABLE",
    "VOICE_ASSET_IN_USE"
  ].find((code) => message.includes(code));
  if (!known || error?.code === known) return error;
  const statusCode = known === "VOICE_MEMORY_LIMIT" || known === "VOICE_POSITION_NOT_CONTIGUOUS" ? 400 : 409;
  return voiceError(message, known, statusCode, error);
}

function voiceError(message, code, statusCode = 400, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

module.exports = {
  MAX_TRANSCRIPT_LENGTH,
  MAX_VOICE_BYTES,
  MAX_VOICE_DURATION_MS,
  MAX_VOICE_PER_MEMORY,
  VOICE_MIGRATION,
  initializeVoiceDatabase
};
