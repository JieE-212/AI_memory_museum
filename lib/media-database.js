"use strict";

const { MAX_MEDIA_PER_MEMORY, mediaObservationPolicyViolation } = require("./media-policy");

const ASSET_STATUSES = new Set(["staging", "ready", "pending_delete"]);
const PRIVACY_MODES = new Set(["preserve_original", "sanitized_only"]);
const STORAGE_DRIVERS = new Set(["local"]);
const MEDIA_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const VARIANT_KINDS = new Set(["original", "display", "thumb"]);
const MEDIA_ROLES = new Set(["cover", "gallery", "evidence"]);
const OBSERVATION_STATUSES = new Set(["suggested", "confirmed", "rejected"]);
const OBSERVATION_SOURCES = new Set(["user", "exif", "ocr", "system", "model", "import"]);
const DAY_IN_MS = 24 * 60 * 60 * 1000;

/**
 * Adds the V4 media tables to an existing memory database and returns the
 * database operations used by the HTTP/media layers. The module deliberately
 * knows nothing about the filesystem: storage keys are opaque, validated,
 * relative identifiers and file cleanup remains the caller's responsibility.
 */
function initializeMediaDatabase({ db, withTransaction, now, createId } = {}) {
  if (!db || typeof db.exec !== "function" || typeof db.prepare !== "function") {
    throw new TypeError("initializeMediaDatabase requires a sqlite database connection.");
  }
  if (typeof withTransaction !== "function") {
    throw new TypeError("initializeMediaDatabase requires withTransaction(fn).");
  }
  if (typeof now !== "function") {
    throw new TypeError("initializeMediaDatabase requires now().");
  }
  if (typeof createId !== "function") {
    throw new TypeError("initializeMediaDatabase requires createId(prefix).");
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS media_assets (
      id TEXT PRIMARY KEY,
      schema_version INTEGER NOT NULL DEFAULT 4 CHECK (schema_version = 4),
      content_sha256 TEXT NOT NULL UNIQUE,
      original_name TEXT NOT NULL DEFAULT '',
      source_mime_type TEXT NOT NULL,
      source_byte_size INTEGER NOT NULL CHECK (source_byte_size > 0),
      width INTEGER NOT NULL CHECK (width > 0),
      height INTEGER NOT NULL CHECK (height > 0),
      storage_driver TEXT NOT NULL DEFAULT 'local' CHECK (storage_driver IN ('local')),
      privacy_mode TEXT NOT NULL DEFAULT 'sanitized_only'
        CHECK (privacy_mode IN ('preserve_original', 'sanitized_only')),
      status TEXT NOT NULL DEFAULT 'staging'
        CHECK (status IN ('staging', 'ready', 'pending_delete')),
      safe_metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS media_variants (
      asset_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('original', 'display', 'thumb')),
      storage_key TEXT NOT NULL UNIQUE,
      mime_type TEXT NOT NULL,
      byte_size INTEGER NOT NULL CHECK (byte_size > 0),
      width INTEGER NOT NULL CHECK (width > 0),
      height INTEGER NOT NULL CHECK (height > 0),
      sha256 TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (asset_id, kind),
      FOREIGN KEY (asset_id) REFERENCES media_assets(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS memory_media (
      memory_id TEXT NOT NULL,
      asset_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'gallery' CHECK (role IN ('cover', 'gallery', 'evidence')),
      position INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
      caption TEXT NOT NULL DEFAULT '',
      alt_text TEXT NOT NULL DEFAULT '',
      back_note TEXT NOT NULL DEFAULT '',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (memory_id, asset_id),
      FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE,
      FOREIGN KEY (asset_id) REFERENCES media_assets(id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS media_observations (
      id TEXT PRIMARY KEY,
      asset_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      source TEXT NOT NULL,
      value_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'suggested'
        CHECK (status IN ('suggested', 'confirmed', 'rejected')),
      confidence REAL,
      sensitive INTEGER NOT NULL DEFAULT 0 CHECK (sensitive IN (0, 1)),
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (asset_id) REFERENCES media_assets(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_media_assets_status_updated
      ON media_assets(status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_media_variants_asset
      ON media_variants(asset_id, kind);
    CREATE INDEX IF NOT EXISTS idx_memory_media_memory_position
      ON memory_media(memory_id, position, asset_id);
    CREATE INDEX IF NOT EXISTS idx_memory_media_asset
      ON memory_media(asset_id, memory_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_media_one_cover
      ON memory_media(memory_id) WHERE role = 'cover';
    CREATE INDEX IF NOT EXISTS idx_media_observations_asset
      ON media_observations(asset_id, status, kind, created_at);
  `);

  const statements = {
    memoryExists: db.prepare("SELECT 1 AS found FROM memories WHERE id = ?"),
    insertAsset: db.prepare(`
      INSERT INTO media_assets (
        id, schema_version, content_sha256, original_name, source_mime_type,
        source_byte_size, width, height, storage_driver, privacy_mode, status,
        safe_metadata_json, created_at, updated_at
      ) VALUES (?, 4, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    getAsset: db.prepare("SELECT * FROM media_assets WHERE id = ?"),
    getAssetByHash: db.prepare("SELECT * FROM media_assets WHERE content_sha256 = ?"),
    listAssets: db.prepare("SELECT * FROM media_assets ORDER BY datetime(created_at) DESC, id"),
    updateAsset: db.prepare(`
      UPDATE media_assets SET
        original_name = ?, privacy_mode = ?, status = ?, safe_metadata_json = ?, updated_at = ?
      WHERE id = ?
    `),
    deleteAsset: db.prepare("DELETE FROM media_assets WHERE id = ?"),
    insertVariant: db.prepare(`
      INSERT INTO media_variants (
        asset_id, kind, storage_key, mime_type, byte_size, width, height,
        sha256, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(asset_id, kind) DO UPDATE SET
        storage_key = excluded.storage_key,
        mime_type = excluded.mime_type,
        byte_size = excluded.byte_size,
        width = excluded.width,
        height = excluded.height,
        sha256 = excluded.sha256,
        updated_at = excluded.updated_at
    `),
    getVariant: db.prepare("SELECT * FROM media_variants WHERE asset_id = ? AND kind = ?"),
    listVariants: db.prepare("SELECT * FROM media_variants WHERE asset_id = ? ORDER BY CASE kind WHEN 'original' THEN 0 WHEN 'display' THEN 1 ELSE 2 END"),
    listAllVariants: db.prepare("SELECT * FROM media_variants ORDER BY asset_id, kind"),
    deleteVariant: db.prepare("DELETE FROM media_variants WHERE asset_id = ? AND kind = ?"),
    getMemoryMedia: db.prepare("SELECT * FROM memory_media WHERE memory_id = ? AND asset_id = ?"),
    listMemoryMedia: db.prepare("SELECT * FROM memory_media WHERE memory_id = ? ORDER BY position, datetime(created_at), asset_id"),
    upsertMemoryMedia: db.prepare(`
      INSERT INTO memory_media (
        memory_id, asset_id, role, position, caption, alt_text, back_note,
        metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(memory_id, asset_id) DO UPDATE SET
        role = excluded.role,
        position = excluded.position,
        caption = excluded.caption,
        alt_text = excluded.alt_text,
        back_note = excluded.back_note,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at
    `),
    demoteCovers: db.prepare("UPDATE memory_media SET role = 'gallery', updated_at = ? WHERE memory_id = ? AND role = 'cover' AND asset_id <> ?"),
    promoteCover: db.prepare("UPDATE memory_media SET role = 'cover', updated_at = ? WHERE memory_id = ? AND asset_id = ?"),
    countCovers: db.prepare("SELECT COUNT(*) AS count FROM memory_media WHERE memory_id = ? AND role = 'cover'"),
    updatePosition: db.prepare("UPDATE memory_media SET position = ?, updated_at = ? WHERE memory_id = ? AND asset_id = ?"),
    deleteMemoryMedia: db.prepare("DELETE FROM memory_media WHERE memory_id = ? AND asset_id = ?"),
    deleteAllMemoryMedia: db.prepare("DELETE FROM memory_media WHERE memory_id = ?"),
    usageForAsset: db.prepare(`
      SELECT a.id AS asset_id, a.status,
        COUNT(DISTINCT mm.memory_id) AS memory_count,
        COUNT(DISTINCT mv.kind) AS variant_count,
        COUNT(DISTINCT mo.id) AS observation_count
      FROM media_assets a
      LEFT JOIN memory_media mm ON mm.asset_id = a.id
      LEFT JOIN media_variants mv ON mv.asset_id = a.id
      LEFT JOIN media_observations mo ON mo.asset_id = a.id
      WHERE a.id = ?
      GROUP BY a.id
    `),
    allUsage: db.prepare(`
      SELECT a.id AS asset_id, a.status,
        (SELECT COUNT(*) FROM memory_media mm WHERE mm.asset_id = a.id) AS memory_count,
        (SELECT COUNT(*) FROM media_variants mv WHERE mv.asset_id = a.id) AS variant_count,
        (SELECT COUNT(*) FROM media_observations mo WHERE mo.asset_id = a.id) AS observation_count
      FROM media_assets a ORDER BY a.id
    `),
    usageMemoryIds: db.prepare("SELECT memory_id FROM memory_media WHERE asset_id = ? ORDER BY memory_id"),
    listUnreferencedAssets: db.prepare(`
      SELECT a.* FROM media_assets a
      WHERE NOT EXISTS (SELECT 1 FROM memory_media mm WHERE mm.asset_id = a.id)
      ORDER BY datetime(a.updated_at), a.id
    `),
    insertObservation: db.prepare(`
      INSERT INTO media_observations (
        id, asset_id, kind, source, value_json, status, confidence, sensitive,
        metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        kind = excluded.kind,
        source = excluded.source,
        value_json = excluded.value_json,
        status = excluded.status,
        confidence = excluded.confidence,
        sensitive = excluded.sensitive,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at
    `),
    getObservation: db.prepare("SELECT * FROM media_observations WHERE id = ?"),
    listObservations: db.prepare("SELECT * FROM media_observations ORDER BY datetime(created_at), id"),
    deleteObservation: db.prepare("DELETE FROM media_observations WHERE id = ?")
  };

  function createMediaAsset(input = {}, variants = []) {
    assertPlainObject(input, "asset");
    assertKnownKeys(input, new Set([
      "id", "contentSha256", "sha256", "hash", "originalName", "originalFilename",
      "fileName", "sourceMimeType", "mimeType", "sourceByteSize", "byteSize", "size",
      "width", "height", "storageDriver", "privacyMode", "status", "safeMetadata",
      "metadata", "createdAt", "updatedAt", "variants"
    ]), "asset");
    if (input.variants !== undefined && arguments.length > 1 && variants !== undefined && variants.length) {
      throw new Error("Provide variants either as asset.variants or as the second argument, not both.");
    }
    const suppliedVariants = input.variants !== undefined ? input.variants : variants;
    if (!Array.isArray(suppliedVariants)) throw new TypeError("variants must be an array.");
    if (suppliedVariants.length > 3) throw new RangeError("An asset supports at most three variants.");

    const timestamp = getNow();
    const id = input.id === undefined ? newId("media") : requireId(input.id, "asset.id");
    const contentSha256 = requireSha256(firstDefined(input.contentSha256, input.sha256, input.hash), "asset.contentSha256");
    const sourceMimeType = requireEnum(firstDefined(input.sourceMimeType, input.mimeType), MEDIA_MIME_TYPES, "asset.sourceMimeType");
    const sourceByteSize = requireInteger(firstDefined(input.sourceByteSize, input.byteSize, input.size), "asset.sourceByteSize", 1, 100 * 1024 * 1024);
    const width = requireInteger(input.width, "asset.width", 1, 100000);
    const height = requireInteger(input.height, "asset.height", 1, 100000);
    const status = optionalEnum(input.status, ASSET_STATUSES, "asset.status", "staging");
    const asset = {
      id,
      contentSha256,
      originalName: normalizeFilename(firstDefined(input.originalName, input.originalFilename, input.fileName), "asset.originalName"),
      sourceMimeType,
      sourceByteSize,
      width,
      height,
      storageDriver: optionalEnum(input.storageDriver, STORAGE_DRIVERS, "asset.storageDriver", "local"),
      privacyMode: optionalEnum(input.privacyMode, PRIVACY_MODES, "asset.privacyMode", "sanitized_only"),
      status,
      safeMetadata: requireJsonObject(firstDefined(input.safeMetadata, input.metadata, {}), "asset.safeMetadata", 65536),
      createdAt: optionalTimestamp(input.createdAt, "asset.createdAt", timestamp),
      updatedAt: optionalTimestamp(input.updatedAt, "asset.updatedAt", timestamp)
    };

    return withTransaction(() => {
      if (statements.getAsset.get(asset.id)) throw conflict(`Media asset already exists: ${asset.id}`, "MEDIA_ASSET_ID_EXISTS");
      if (statements.getAssetByHash.get(asset.contentSha256)) {
        throw conflict(`Media content already exists: ${asset.contentSha256}`, "MEDIA_ASSET_HASH_EXISTS");
      }
      statements.insertAsset.run(
        asset.id,
        asset.contentSha256,
        asset.originalName,
        asset.sourceMimeType,
        asset.sourceByteSize,
        asset.width,
        asset.height,
        asset.storageDriver,
        asset.privacyMode,
        asset.status,
        stringifyJson(asset.safeMetadata, "asset.safeMetadata"),
        asset.createdAt,
        asset.updatedAt
      );
      const kinds = new Set();
      suppliedVariants.forEach((variant) => {
        const normalized = normalizeVariant({ ...variant, assetId: asset.id }, asset);
        if (kinds.has(normalized.kind)) throw new Error(`Duplicate media variant kind: ${normalized.kind}`);
        kinds.add(normalized.kind);
        writeVariant(normalized);
      });
      if (asset.status === "ready") assertReadyVariants(asset.id, asset.privacyMode);
      return getMediaAsset(asset.id);
    });
  }

  function getMediaAsset(id) {
    const assetId = requireId(id, "assetId");
    const row = statements.getAsset.get(assetId);
    return row ? hydrateAsset(row) : null;
  }

  function getMediaAssetByHash(hash) {
    const row = statements.getAssetByHash.get(requireSha256(hash, "hash"));
    return row ? hydrateAsset(row) : null;
  }

  function listMediaAssets(filters = {}) {
    assertPlainObject(filters, "filters");
    assertKnownKeys(filters, new Set(["status", "privacyMode", "limit", "offset"]), "filters");
    const status = filters.status === undefined ? "" : requireEnum(filters.status, ASSET_STATUSES, "filters.status");
    const privacyMode = filters.privacyMode === undefined ? "" : requireEnum(filters.privacyMode, PRIVACY_MODES, "filters.privacyMode");
    const limit = optionalInteger(filters.limit, "filters.limit", 1, 500, 100);
    const offset = optionalInteger(filters.offset, "filters.offset", 0, 1000000, 0);
    return statements.listAssets.all()
      .filter((row) => !status || row.status === status)
      .filter((row) => !privacyMode || row.privacy_mode === privacyMode)
      .slice(offset, offset + limit)
      .map(hydrateAsset);
  }

  function updateMediaAsset(id, patch = {}) {
    const assetId = requireId(id, "assetId");
    assertPlainObject(patch, "asset patch");
    assertKnownKeys(patch, new Set(["originalName", "privacyMode", "status", "safeMetadata", "metadata"]), "asset patch");
    const existing = getMediaAsset(assetId);
    if (!existing) throw notFound(`Media asset not found: ${assetId}`, "MEDIA_ASSET_NOT_FOUND");
    if (!Object.keys(patch).length) return existing;
    const status = patch.status === undefined ? existing.status : requireEnum(patch.status, ASSET_STATUSES, "asset.status");
    const privacyMode = patch.privacyMode === undefined
      ? existing.privacyMode
      : requireEnum(patch.privacyMode, PRIVACY_MODES, "asset.privacyMode");
    if (status === "ready") assertReadyVariants(assetId, privacyMode);
    const updatedAt = getNow();
    statements.updateAsset.run(
      patch.originalName === undefined ? existing.originalName : normalizeFilename(patch.originalName, "asset.originalName"),
      privacyMode,
      status,
      stringifyJson(
        patch.safeMetadata === undefined && patch.metadata === undefined
          ? existing.safeMetadata
          : requireJsonObject(firstDefined(patch.safeMetadata, patch.metadata), "asset.safeMetadata", 65536),
        "asset.safeMetadata"
      ),
      updatedAt,
      assetId
    );
    return getMediaAsset(assetId);
  }

  function markMediaReady(id) {
    return updateMediaAsset(id, { status: "ready" });
  }

  function markMediaPendingDelete(id) {
    const usage = getMediaUsage(id);
    if (!usage) throw notFound(`Media asset not found: ${id}`, "MEDIA_ASSET_NOT_FOUND");
    if (usage.memoryCount > 0) {
      throw conflict("A referenced media asset cannot be marked for deletion.", "MEDIA_ASSET_IN_USE", usage);
    }
    return updateMediaAsset(id, { status: "pending_delete" });
  }

  function deleteMediaAsset(id) {
    const assetId = requireId(id, "assetId");
    const asset = getMediaAsset(assetId);
    if (!asset) return null;
    const usage = getMediaUsage(assetId);
    if (usage.memoryCount > 0) {
      throw conflict("A referenced media asset cannot be deleted.", "MEDIA_ASSET_IN_USE", usage);
    }
    return withTransaction(() => {
      const result = statements.deleteAsset.run(assetId);
      return result.changes > 0 ? asset : null;
    });
  }

  function saveMediaVariant(assetOrInput, maybeInput = {}) {
    const input = typeof assetOrInput === "string"
      ? { ...maybeInput, assetId: assetOrInput }
      : assetOrInput;
    assertPlainObject(input, "variant");
    const assetId = requireId(input.assetId, "variant.assetId");
    const asset = getMediaAsset(assetId);
    if (!asset) throw notFound(`Media asset not found: ${assetId}`, "MEDIA_ASSET_NOT_FOUND");
    const variant = normalizeVariant(input, asset);
    return withTransaction(() => {
      writeVariant(variant);
      return getMediaVariant(assetId, variant.kind);
    });
  }

  function getMediaVariant(assetId, kind) {
    const normalizedAssetId = requireId(assetId, "assetId");
    const normalizedKind = requireEnum(kind, VARIANT_KINDS, "variant.kind");
    const row = statements.getVariant.get(normalizedAssetId, normalizedKind);
    return row ? rowToVariant(row) : null;
  }

  function listMediaVariants(assetId) {
    const normalizedAssetId = requireId(assetId, "assetId");
    return statements.listVariants.all(normalizedAssetId).map(rowToVariant);
  }

  function deleteMediaVariant(assetId, kind) {
    const normalizedAssetId = requireId(assetId, "assetId");
    const normalizedKind = requireEnum(kind, VARIANT_KINDS, "variant.kind");
    const variant = getMediaVariant(normalizedAssetId, normalizedKind);
    if (!variant) return null;
    if (normalizedKind === "original") {
      const usage = getMediaUsage(normalizedAssetId);
      if (usage?.memoryCount > 0) {
        throw conflict("The original variant of a referenced asset cannot be deleted.", "MEDIA_ASSET_IN_USE", usage);
      }
      const asset = getMediaAsset(normalizedAssetId);
      if (asset?.status === "ready") {
        throw conflict("Mark the asset as staging or pending_delete before removing its original variant.", "MEDIA_ORIGINAL_REQUIRED");
      }
    }
    statements.deleteVariant.run(normalizedAssetId, normalizedKind);
    return variant;
  }

  function listMediaForMemory(memoryId) {
    const normalizedMemoryId = requireId(memoryId, "memoryId");
    return statements.listMemoryMedia.all(normalizedMemoryId).map((row) => {
      const link = rowToMemoryMedia(row);
      const assetRow = statements.getAsset.get(link.assetId);
      return {
        ...link,
        asset: assetRow ? rowToAsset(assetRow) : null,
        variants: statements.listVariants.all(link.assetId).map(rowToVariant)
      };
    });
  }

  function attachMedia(memoryId, assetId, details = {}) {
    const normalizedMemoryId = requireId(memoryId, "memoryId");
    const normalizedAssetId = requireId(assetId, "assetId");
    assertMemoryExists(normalizedMemoryId);
    const asset = getMediaAsset(normalizedAssetId);
    if (!asset) throw notFound(`Media asset not found: ${normalizedAssetId}`, "MEDIA_ASSET_NOT_FOUND");
    if (asset.status !== "ready") throw conflict("Only ready media assets can be attached.", "MEDIA_ASSET_NOT_READY");
    assertPlainObject(details, "media association");
    const existingRow = statements.getMemoryMedia.get(normalizedMemoryId, normalizedAssetId);
    const existing = existingRow ? rowToMemoryMedia(existingRow) : null;
    const currentRows = statements.listMemoryMedia.all(normalizedMemoryId);
    if (!existing && currentRows.length >= MAX_MEDIA_PER_MEMORY) {
      throw limitExceeded(
        `A memory supports at most ${MAX_MEDIA_PER_MEMORY} media associations.`,
        "MEMORY_MEDIA_LIMIT_EXCEEDED",
        { limit: MAX_MEDIA_PER_MEMORY }
      );
    }
    const normalized = normalizeMemoryMedia(details, existing, currentRows.length === 0);
    const requestedPosition = details.position === undefined
      ? existing?.position ?? currentRows.length
      : requireInteger(details.position, "media association.position", 0, Math.max(currentRows.length, 0));
    const order = currentRows.map((row) => row.asset_id).filter((id) => id !== normalizedAssetId);
    order.splice(Math.min(requestedPosition, order.length), 0, normalizedAssetId);
    const timestamp = getNow();

    return withTransaction(() => {
      if (normalized.role === "cover") {
        statements.demoteCovers.run(timestamp, normalizedMemoryId, normalizedAssetId);
      }
      statements.upsertMemoryMedia.run(
        normalizedMemoryId,
        normalizedAssetId,
        normalized.role,
        requestedPosition,
        normalized.caption,
        normalized.altText,
        normalized.backNote,
        stringifyJson(normalized.metadata, "media association.metadata"),
        existing?.createdAt || timestamp,
        timestamp
      );
      ensureMemoryCover(normalizedMemoryId, timestamp);
      writeMemoryOrder(normalizedMemoryId, order, timestamp);
      return listMediaForMemory(normalizedMemoryId).find((item) => item.assetId === normalizedAssetId) || null;
    });
  }

  function replaceMemoryMedia(memoryId, items = []) {
    const normalizedMemoryId = requireId(memoryId, "memoryId");
    assertMemoryExists(normalizedMemoryId);
    if (!Array.isArray(items)) throw new TypeError("items must be an array.");
    if (items.length > MAX_MEDIA_PER_MEMORY) {
      throw limitExceeded(
        `A memory supports at most ${MAX_MEDIA_PER_MEMORY} media associations.`,
        "MEMORY_MEDIA_LIMIT_EXCEEDED",
        { limit: MAX_MEDIA_PER_MEMORY }
      );
    }
    const existingById = new Map(
      statements.listMemoryMedia.all(normalizedMemoryId).map((row) => [row.asset_id, rowToMemoryMedia(row)])
    );
    const seen = new Set();
    let coverCount = 0;
    const normalizedItems = items.map((item, index) => {
      assertPlainObject(item, `items[${index}]`);
      assertKnownKeys(item, new Set(["assetId", "id", "role", "position", "caption", "altText", "backNote", "metadata"]), `items[${index}]`);
      if (item.position !== undefined) {
        const position = requireInteger(
          item.position,
          `items[${index}].position`,
          0,
          MAX_MEDIA_PER_MEMORY - 1
        );
        if (position !== index) {
          const error = new RangeError(`items[${index}].position must equal its array index (${index}).`);
          error.code = "MEMORY_MEDIA_POSITION_MISMATCH";
          throw error;
        }
      }
      const assetId = requireId(firstDefined(item.assetId, item.id), `items[${index}].assetId`);
      if (seen.has(assetId)) throw new Error(`Duplicate media asset in replacement: ${assetId}`);
      seen.add(assetId);
      const asset = getMediaAsset(assetId);
      if (!asset) throw notFound(`Media asset not found: ${assetId}`, "MEDIA_ASSET_NOT_FOUND");
      if (asset.status !== "ready") throw conflict(`Media asset is not ready: ${assetId}`, "MEDIA_ASSET_NOT_READY");
      const normalized = normalizeMemoryMedia(item, existingById.get(assetId) || null, index === 0);
      if (normalized.role === "cover") coverCount += 1;
      return { assetId, ...normalized, createdAt: existingById.get(assetId)?.createdAt || getNow() };
    });
    if (coverCount > 1) throw new Error("A memory can have only one cover image.");
    if (normalizedItems.length && coverCount === 0) normalizedItems[0].role = "cover";
    const timestamp = getNow();

    return withTransaction(() => {
      statements.deleteAllMemoryMedia.run(normalizedMemoryId);
      normalizedItems.forEach((item, position) => statements.upsertMemoryMedia.run(
        normalizedMemoryId,
        item.assetId,
        item.role,
        position,
        item.caption,
        item.altText,
        item.backNote,
        stringifyJson(item.metadata, "media association.metadata"),
        item.createdAt,
        timestamp
      ));
      return listMediaForMemory(normalizedMemoryId);
    });
  }

  function detachMedia(memoryId, assetId) {
    const normalizedMemoryId = requireId(memoryId, "memoryId");
    const normalizedAssetId = requireId(assetId, "assetId");
    const existingRow = statements.getMemoryMedia.get(normalizedMemoryId, normalizedAssetId);
    if (!existingRow) return null;
    const existing = rowToMemoryMedia(existingRow);
    const timestamp = getNow();
    return withTransaction(() => {
      statements.deleteMemoryMedia.run(normalizedMemoryId, normalizedAssetId);
      ensureMemoryCover(normalizedMemoryId, timestamp);
      normalizeMemoryPositions(normalizedMemoryId, timestamp);
      return existing;
    });
  }

  function setMemoryCover(memoryId, assetId) {
    const normalizedMemoryId = requireId(memoryId, "memoryId");
    const normalizedAssetId = requireId(assetId, "assetId");
    if (!statements.getMemoryMedia.get(normalizedMemoryId, normalizedAssetId)) {
      throw notFound("The media asset is not attached to this memory.", "MEMORY_MEDIA_NOT_FOUND");
    }
    const timestamp = getNow();
    return withTransaction(() => {
      statements.demoteCovers.run(timestamp, normalizedMemoryId, normalizedAssetId);
      statements.promoteCover.run(timestamp, normalizedMemoryId, normalizedAssetId);
      return listMediaForMemory(normalizedMemoryId).find((item) => item.assetId === normalizedAssetId) || null;
    });
  }

  function reorderMemoryMedia(memoryId, assetIds = []) {
    const normalizedMemoryId = requireId(memoryId, "memoryId");
    if (!Array.isArray(assetIds)) throw new TypeError("assetIds must be an array.");
    const normalizedIds = assetIds.map((id, index) => requireId(id, `assetIds[${index}]`));
    if (new Set(normalizedIds).size !== normalizedIds.length) throw new Error("assetIds contains duplicates.");
    const currentIds = statements.listMemoryMedia.all(normalizedMemoryId).map((row) => row.asset_id);
    if (normalizedIds.length !== currentIds.length || currentIds.some((id) => !normalizedIds.includes(id))) {
      throw new Error("assetIds must contain every media asset attached to the memory exactly once.");
    }
    const timestamp = getNow();
    return withTransaction(() => {
      writeMemoryOrder(normalizedMemoryId, normalizedIds, timestamp);
      return listMediaForMemory(normalizedMemoryId);
    });
  }

  function getMediaUsage(assetId) {
    if (assetId === undefined || assetId === null || assetId === "") {
      return statements.allUsage.all().map(rowToUsage);
    }
    const normalizedAssetId = requireId(assetId, "assetId");
    const row = statements.usageForAsset.get(normalizedAssetId);
    if (!row) return null;
    return rowToUsage(row);
  }

  function listUnreferencedMediaAssets(filters = {}) {
    assertPlainObject(filters, "filters");
    assertKnownKeys(filters, new Set(["status", "before", "limit"]), "filters");
    const status = filters.status === undefined ? "" : requireEnum(filters.status, ASSET_STATUSES, "filters.status");
    const before = filters.before === undefined ? "" : requireTimestamp(filters.before, "filters.before");
    const limit = optionalInteger(filters.limit, "filters.limit", 1, 1000, 100);
    return statements.listUnreferencedAssets.all()
      .filter((row) => !status || row.status === status)
      .filter((row) => !before || Date.parse(row.updated_at) < Date.parse(before))
      .slice(0, limit)
      .map(hydrateAsset);
  }

  function listStaleMediaAssets(options = {}) {
    assertPlainObject(options, "options");
    assertKnownKeys(options, new Set(["before", "staleAfterMs", "statuses", "includeReferenced", "limit"]), "options");
    const statuses = options.statuses === undefined
      ? ["staging", "pending_delete"]
      : requireEnumArray(options.statuses, ASSET_STATUSES, "options.statuses", 3);
    const includeReferenced = optionalBoolean(options.includeReferenced, "options.includeReferenced", false);
    const before = options.before === undefined
      ? new Date(Date.parse(getNow()) - optionalInteger(options.staleAfterMs, "options.staleAfterMs", 60000, 30 * DAY_IN_MS, DAY_IN_MS)).toISOString()
      : requireTimestamp(options.before, "options.before");
    const limit = optionalInteger(options.limit, "options.limit", 1, 1000, 100);
    return statements.listAssets.all()
      .filter((row) => statuses.includes(row.status))
      .filter((row) => Date.parse(row.updated_at) < Date.parse(before))
      .filter((row) => includeReferenced || getMediaUsage(row.id).memoryCount === 0)
      .slice(0, limit)
      .map(hydrateAsset);
  }

  function listStaleMediaVariants(options = {}) {
    const staleAssetIds = new Set(listStaleMediaAssets(options).map((asset) => asset.id));
    return statements.listAllVariants.all()
      .filter((row) => staleAssetIds.has(row.asset_id))
      .map(rowToVariant);
  }

  function saveMediaObservation(assetOrInput, maybeInput = {}) {
    const input = typeof assetOrInput === "string"
      ? { ...maybeInput, assetId: assetOrInput }
      : assetOrInput;
    assertPlainObject(input, "observation");
    assertKnownKeys(input, new Set([
      "id", "assetId", "kind", "source", "value", "valueJson", "status",
      "confidence", "sensitive", "metadata", "createdAt", "updatedAt"
    ]), "observation");
    const rawId = input.id === undefined ? "" : requireId(input.id, "observation.id");
    const existingRow = rawId ? statements.getObservation.get(rawId) : null;
    const existing = existingRow ? rowToObservation(existingRow) : null;
    const id = rawId || newId("observation");
    const assetId = input.assetId === undefined && existing
      ? existing.assetId
      : requireId(input.assetId, "observation.assetId");
    if (existing && existing.assetId !== assetId) throw new Error("An observation cannot be moved to another asset.");
    const assetRow = statements.getAsset.get(assetId);
    if (!assetRow) throw notFound(`Media asset not found: ${assetId}`, "MEDIA_ASSET_NOT_FOUND");
    const timestamp = getNow();
    const value = input.value === undefined && input.valueJson === undefined
      ? existing?.value
      : firstDefined(input.value, input.valueJson);
    if (value === undefined) throw new Error("observation.value is required.");
    const observation = {
      id,
      assetId,
      kind: input.kind === undefined && existing ? existing.kind : requireToken(input.kind, "observation.kind", 40),
      source: input.source === undefined && existing ? existing.source : optionalEnum(input.source, OBSERVATION_SOURCES, "observation.source", "user"),
      value: requireJsonValue(value, "observation.value", 65536),
      status: input.status === undefined && existing ? existing.status : optionalEnum(input.status, OBSERVATION_STATUSES, "observation.status", "suggested"),
      confidence: input.confidence === undefined && existing ? existing.confidence : optionalConfidence(input.confidence, "observation.confidence"),
      sensitive: input.sensitive === undefined && existing ? existing.sensitive : optionalBoolean(input.sensitive, "observation.sensitive", false),
      metadata: input.metadata === undefined && existing ? existing.metadata : requireJsonObject(input.metadata || {}, "observation.metadata", 32768),
      createdAt: existing?.createdAt || optionalTimestamp(input.createdAt, "observation.createdAt", timestamp),
      updatedAt: optionalTimestamp(input.updatedAt, "observation.updatedAt", timestamp)
    };
    const privacyViolation = mediaObservationPolicyViolation(observation, assetRow.privacy_mode);
    if (privacyViolation) {
      throw limitExceeded(privacyViolation, "MEDIA_OBSERVATION_PRIVACY_INVALID", {
        assetId,
        privacyMode: assetRow.privacy_mode
      });
    }
    statements.insertObservation.run(
      observation.id,
      observation.assetId,
      observation.kind,
      observation.source,
      stringifyJson(observation.value, "observation.value"),
      observation.status,
      observation.confidence,
      observation.sensitive ? 1 : 0,
      stringifyJson(observation.metadata, "observation.metadata"),
      observation.createdAt,
      observation.updatedAt
    );
    return getMediaObservation(observation.id);
  }

  function getMediaObservation(id) {
    const row = statements.getObservation.get(requireId(id, "observationId"));
    return row ? rowToObservation(row) : null;
  }

  function listMediaObservations(filters = {}) {
    if (typeof filters === "string") filters = { assetId: filters };
    assertPlainObject(filters, "filters");
    assertKnownKeys(filters, new Set(["assetId", "kind", "source", "status", "sensitive", "limit"]), "filters");
    const assetId = filters.assetId === undefined ? "" : requireId(filters.assetId, "filters.assetId");
    const kind = filters.kind === undefined ? "" : requireToken(filters.kind, "filters.kind", 40);
    const source = filters.source === undefined ? "" : requireEnum(filters.source, OBSERVATION_SOURCES, "filters.source");
    const status = filters.status === undefined ? "" : requireEnum(filters.status, OBSERVATION_STATUSES, "filters.status");
    const sensitive = filters.sensitive === undefined ? null : requireBoolean(filters.sensitive, "filters.sensitive");
    const limit = optionalInteger(filters.limit, "filters.limit", 1, 1000, 200);
    return statements.listObservations.all()
      .map(rowToObservation)
      .filter((item) => !assetId || item.assetId === assetId)
      .filter((item) => !kind || item.kind === kind)
      .filter((item) => !source || item.source === source)
      .filter((item) => !status || item.status === status)
      .filter((item) => sensitive === null || item.sensitive === sensitive)
      .slice(0, limit);
  }

  function deleteMediaObservation(id) {
    const observation = getMediaObservation(id);
    if (!observation) return null;
    statements.deleteObservation.run(observation.id);
    return observation;
  }

  function normalizeVariant(input, asset) {
    assertPlainObject(input, "variant");
    assertKnownKeys(input, new Set([
      "assetId", "kind", "storageKey", "mimeType", "byteSize", "size", "width",
      "height", "sha256", "hash", "createdAt", "updatedAt"
    ]), "variant");
    const timestamp = getNow();
    const kind = requireEnum(input.kind, VARIANT_KINDS, "variant.kind");
    const variant = {
      assetId: requireId(input.assetId, "variant.assetId"),
      kind,
      storageKey: requireStorageKey(input.storageKey, "variant.storageKey"),
      mimeType: requireEnum(input.mimeType, MEDIA_MIME_TYPES, "variant.mimeType"),
      byteSize: requireInteger(firstDefined(input.byteSize, input.size), "variant.byteSize", 1, 100 * 1024 * 1024),
      width: requireInteger(input.width, "variant.width", 1, 100000),
      height: requireInteger(input.height, "variant.height", 1, 100000),
      sha256: requireSha256(firstDefined(input.sha256, input.hash), "variant.sha256"),
      createdAt: optionalTimestamp(input.createdAt, "variant.createdAt", timestamp),
      updatedAt: optionalTimestamp(input.updatedAt, "variant.updatedAt", timestamp)
    };
    if (variant.assetId !== asset.id) throw new Error("variant.assetId does not match its media asset.");
    if (kind === "original") {
      if (variant.sha256 !== asset.contentSha256) throw new Error("The original variant hash must match the asset content hash.");
      if (variant.mimeType !== asset.sourceMimeType || variant.byteSize !== asset.sourceByteSize) {
        throw new Error("The original variant hash, MIME type and byte size must match the source asset.");
      }
    }
    return variant;
  }

  function writeVariant(variant) {
    const existing = statements.getVariant.get(variant.assetId, variant.kind);
    statements.insertVariant.run(
      variant.assetId,
      variant.kind,
      variant.storageKey,
      variant.mimeType,
      variant.byteSize,
      variant.width,
      variant.height,
      variant.sha256,
      existing?.created_at || variant.createdAt,
      variant.updatedAt
    );
  }

  function assertReadyVariants(assetId, privacyMode) {
    const available = new Set(statements.listVariants.all(assetId).map((row) => row.kind));
    const required = privacyMode === "sanitized_only"
      ? ["display", "thumb"]
      : ["original", "display", "thumb"];
    const missing = required.filter((kind) => !available.has(kind));
    if (missing.length) {
      throw new Error(`A ready ${privacyMode} media asset requires these variants: ${required.join(", ")}. Missing: ${missing.join(", ")}.`);
    }
  }

  function normalizeMemoryMedia(input, existing, firstAssociation) {
    assertKnownKeys(input, new Set(["assetId", "id", "role", "position", "caption", "altText", "backNote", "metadata"]), "media association");
    return {
      role: input.role === undefined
        ? existing?.role || (firstAssociation ? "cover" : "gallery")
        : requireEnum(input.role, MEDIA_ROLES, "media association.role"),
      caption: input.caption === undefined ? existing?.caption || "" : requireString(input.caption, "media association.caption", 1000, true),
      altText: input.altText === undefined ? existing?.altText || "" : requireString(input.altText, "media association.altText", 1000, true),
      backNote: input.backNote === undefined ? existing?.backNote || "" : requireString(input.backNote, "media association.backNote", 4000, true),
      metadata: input.metadata === undefined ? existing?.metadata || {} : requireJsonObject(input.metadata, "media association.metadata", 32768)
    };
  }

  function ensureMemoryCover(memoryId, timestamp) {
    const rows = statements.listMemoryMedia.all(memoryId);
    if (!rows.length || Number(statements.countCovers.get(memoryId)?.count) > 0) return;
    statements.promoteCover.run(timestamp, memoryId, rows[0].asset_id);
  }

  function normalizeMemoryPositions(memoryId, timestamp) {
    const order = statements.listMemoryMedia.all(memoryId).map((row) => row.asset_id);
    writeMemoryOrder(memoryId, order, timestamp);
  }

  function writeMemoryOrder(memoryId, order, timestamp) {
    order.forEach((assetId, position) => statements.updatePosition.run(position, timestamp, memoryId, assetId));
  }

  function hydrateAsset(row) {
    return { ...rowToAsset(row), variants: statements.listVariants.all(row.id).map(rowToVariant) };
  }

  function rowToAsset(row) {
    return {
      id: row.id,
      schemaVersion: Number(row.schema_version) || 4,
      contentSha256: row.content_sha256,
      originalName: row.original_name || "",
      sourceMimeType: row.source_mime_type,
      sourceByteSize: Number(row.source_byte_size) || 0,
      width: Number(row.width) || 0,
      height: Number(row.height) || 0,
      storageDriver: row.storage_driver,
      privacyMode: row.privacy_mode,
      status: row.status,
      safeMetadata: parseJsonObject(row.safe_metadata_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  function rowToVariant(row) {
    return {
      assetId: row.asset_id,
      kind: row.kind,
      storageKey: row.storage_key,
      mimeType: row.mime_type,
      byteSize: Number(row.byte_size) || 0,
      width: Number(row.width) || 0,
      height: Number(row.height) || 0,
      sha256: row.sha256,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  function rowToMemoryMedia(row) {
    return {
      memoryId: row.memory_id,
      assetId: row.asset_id,
      role: row.role,
      position: Number(row.position) || 0,
      caption: row.caption || "",
      altText: row.alt_text || "",
      backNote: row.back_note || "",
      metadata: parseJsonObject(row.metadata_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  function rowToObservation(row) {
    return {
      id: row.id,
      assetId: row.asset_id,
      kind: row.kind,
      source: row.source,
      value: parseJson(row.value_json, null),
      status: row.status,
      confidence: row.confidence === null || row.confidence === undefined ? null : Number(row.confidence),
      sensitive: Boolean(row.sensitive),
      metadata: parseJsonObject(row.metadata_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  function rowToUsage(row) {
    const assetId = row.asset_id;
    return {
      assetId,
      status: row.status,
      memoryCount: Number(row.memory_count) || 0,
      memoryIds: statements.usageMemoryIds.all(assetId).map((item) => item.memory_id),
      variantCount: Number(row.variant_count) || 0,
      observationCount: Number(row.observation_count) || 0
    };
  }

  function assertMemoryExists(memoryId) {
    if (!statements.memoryExists.get(memoryId)) throw notFound(`Memory not found: ${memoryId}`, "MEMORY_NOT_FOUND");
  }

  function getNow() {
    return requireTimestamp(now(), "now()");
  }

  function newId(prefix) {
    return requireId(createId(prefix), `${prefix} id`);
  }

  return {
    createMediaAsset,
    getMediaAsset,
    getMediaAssetByHash,
    listMediaAssets,
    updateMediaAsset,
    markMediaReady,
    markMediaPendingDelete,
    deleteMediaAsset,
    saveMediaVariant,
    createMediaVariant: saveMediaVariant,
    updateMediaVariant: saveMediaVariant,
    getMediaVariant,
    listMediaVariants,
    deleteMediaVariant,
    listMediaForMemory,
    attachMedia,
    updateMemoryMedia: attachMedia,
    replaceMemoryMedia,
    detachMedia,
    setMemoryCover,
    reorderMemoryMedia,
    getMediaUsage,
    listUnreferencedMediaAssets,
    listStaleMediaAssets,
    listStaleMediaVariants,
    saveMediaObservation,
    getMediaObservation,
    listMediaObservations,
    listMediaObservation: listMediaObservations,
    deleteMediaObservation
  };
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined);
}

function assertPlainObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object.`);
  }
}

function assertKnownKeys(value, keys, name) {
  const unknown = Object.keys(value).filter((key) => !keys.has(key));
  if (unknown.length) throw new Error(`${name} contains unsupported field(s): ${unknown.join(", ")}.`);
}

function requireId(value, name) {
  const id = String(value ?? "").trim();
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(id)) throw new Error(`${name} is invalid.`);
  return id;
}

function requireSha256(value, name) {
  const hash = String(value ?? "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error(`${name} must be a SHA-256 digest.`);
  return hash;
}

function requireEnum(value, allowed, name) {
  if (typeof value !== "string" || !allowed.has(value)) {
    throw new Error(`${name} must be one of: ${[...allowed].join(", ")}.`);
  }
  return value;
}

function optionalEnum(value, allowed, name, fallback) {
  return value === undefined ? fallback : requireEnum(value, allowed, name);
}

function requireInteger(value, name, minimum, maximum) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be an integer from ${minimum} to ${maximum}.`);
  }
  return value;
}

function optionalInteger(value, name, minimum, maximum, fallback) {
  return value === undefined ? fallback : requireInteger(value, name, minimum, maximum);
}

function requireBoolean(value, name) {
  if (typeof value !== "boolean") throw new TypeError(`${name} must be a boolean.`);
  return value;
}

function optionalBoolean(value, name, fallback) {
  return value === undefined ? fallback : requireBoolean(value, name);
}

function requireString(value, name, maximum, allowEmpty = false) {
  if (typeof value !== "string") throw new TypeError(`${name} must be a string.`);
  const normalized = value.trim();
  if (!allowEmpty && !normalized) throw new Error(`${name} is required.`);
  if (normalized.length > maximum) throw new RangeError(`${name} must not exceed ${maximum} characters.`);
  if (normalized.includes("\0")) throw new Error(`${name} contains an invalid character.`);
  return normalized;
}

function requireToken(value, name, maximum) {
  const token = requireString(value, name, maximum);
  if (!/^[a-z][a-z0-9_-]*$/.test(token)) throw new Error(`${name} must be a lowercase identifier.`);
  return token;
}

function normalizeFilename(value, name) {
  const filename = value === undefined ? "" : requireString(value, name, 255, true);
  if (/[\\/]/.test(filename) || filename === "." || filename === "..") {
    throw new Error(`${name} must be a filename without a path.`);
  }
  return filename;
}

function requireStorageKey(value, name) {
  const key = requireString(value, name, 500);
  if (key.startsWith("/") || key.includes("\\") || key.includes(":") || key.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error(`${name} must be a safe relative path.`);
  }
  if (!/^[a-zA-Z0-9._/-]+$/.test(key)) throw new Error(`${name} contains unsupported characters.`);
  return key;
}

function requireTimestamp(value, name) {
  if (typeof value !== "string" || !value || value.length > 40 || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${name} must be a valid timestamp.`);
  }
  return value;
}

function optionalTimestamp(value, name, fallback) {
  return value === undefined ? fallback : requireTimestamp(value, name);
}

function optionalConfidence(value, name) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${name} must be null or a number from 0 to 1.`);
  }
  return value;
}

function requireEnumArray(value, allowed, name, maximum) {
  if (!Array.isArray(value) || !value.length || value.length > maximum) {
    throw new Error(`${name} must be a non-empty array with at most ${maximum} values.`);
  }
  const normalized = value.map((item, index) => requireEnum(item, allowed, `${name}[${index}]`));
  if (new Set(normalized).size !== normalized.length) throw new Error(`${name} contains duplicate values.`);
  return normalized;
}

function requireJsonObject(value, name, maximumBytes) {
  assertPlainObject(value, name);
  ensureJsonSize(value, name, maximumBytes);
  return value;
}

function requireJsonValue(value, name, maximumBytes) {
  if (value === undefined || typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") {
    throw new TypeError(`${name} must be JSON-compatible.`);
  }
  ensureJsonSize(value, name, maximumBytes);
  return value;
}

function ensureJsonSize(value, name, maximumBytes) {
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new TypeError(`${name} must be JSON-compatible.`);
  }
  if (serialized === undefined) throw new TypeError(`${name} must be JSON-compatible.`);
  if (Buffer.byteLength(serialized, "utf8") > maximumBytes) {
    throw new RangeError(`${name} exceeds ${maximumBytes} bytes.`);
  }
}

function stringifyJson(value, name) {
  try {
    return JSON.stringify(value);
  } catch {
    throw new TypeError(`${name} must be JSON-compatible.`);
  }
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function parseJsonObject(value) {
  const parsed = parseJson(value, {});
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
}

function conflict(message, code, details) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

function limitExceeded(message, code, details) {
  const error = new RangeError(message);
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

function notFound(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

module.exports = { initializeMediaDatabase };
