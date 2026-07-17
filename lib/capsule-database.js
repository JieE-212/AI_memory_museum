"use strict";

const { createHash, randomUUID } = require("node:crypto");
const { applyMigrations } = require("./migrations");
const {
  CAPSULE_LIMITS,
  CAPSULE_SCHEMA_VERSION,
  CEREMONIAL_GATE,
  normalizeTimezone,
  requireLocalDate,
  validateSafeSnapshot
} = require("./capsule-service");

const MAX_CAPSULES = 200;
const CAPSULE_REDACTED_NOTE = "胶囊标题、日期、时区、来源、内容快照、图片关联和内部 ID 已物理移除。";
const ID_PATTERN = /^[a-zA-Z0-9_-]{1,120}$/u;
const ITEM_KEY_PATTERN = /^item-[1-9]\d*$/u;
const FULL_BACKUP_KEYS = Object.freeze(["capsules", "mode", "schemaVersion"]);
const REDACTED_BACKUP_KEYS = Object.freeze([
  "capsuleCount", "mediaLinkCount", "mode", "note"
]);
const BACKUP_CAPSULE_KEYS = Object.freeze([
  "ceremonialGate", "createdAt", "exhibitionId", "id", "mediaLinks",
  "needsReview", "opensOn", "shellMessage", "snapshot", "timezone", "title", "updatedAt"
]);
const BACKUP_MEDIA_KEYS = Object.freeze(["altText", "assetId", "caption", "itemKey", "position"]);

const CAPSULE_MIGRATION = Object.freeze({
  version: CAPSULE_SCHEMA_VERSION,
  name: "time-capsules",
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS time_capsules (
        id TEXT PRIMARY KEY,
        schema_version INTEGER NOT NULL DEFAULT 9 CHECK (schema_version = 9),
        title TEXT NOT NULL,
        shell_message TEXT NOT NULL DEFAULT '',
        opens_on TEXT NOT NULL,
        timezone TEXT NOT NULL,
        ceremonial_gate TEXT NOT NULL DEFAULT 'local-date-ritual'
          CHECK (ceremonial_gate = 'local-date-ritual'),
        needs_review INTEGER NOT NULL DEFAULT 0 CHECK (needs_review IN (0, 1)),
        source_exhibition_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (source_exhibition_id) REFERENCES exhibitions(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS time_capsule_payloads (
        capsule_id TEXT PRIMARY KEY,
        safe_snapshot_json TEXT NOT NULL,
        payload_sha256 TEXT NOT NULL CHECK (
          length(payload_sha256) = 64 AND payload_sha256 NOT GLOB '*[^0-9a-f]*'
        ),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (capsule_id) REFERENCES time_capsules(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS time_capsule_media (
        capsule_id TEXT NOT NULL,
        asset_id TEXT NOT NULL,
        item_key TEXT NOT NULL,
        position INTEGER NOT NULL CHECK (position >= 0),
        alt_text TEXT NOT NULL DEFAULT '',
        caption TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        PRIMARY KEY (capsule_id, asset_id),
        UNIQUE (capsule_id, position),
        FOREIGN KEY (capsule_id) REFERENCES time_capsules(id) ON DELETE CASCADE,
        FOREIGN KEY (asset_id) REFERENCES media_assets(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_time_capsules_opening
        ON time_capsules(opens_on, created_at, id);
      CREATE INDEX IF NOT EXISTS idx_time_capsules_source
        ON time_capsules(source_exhibition_id, needs_review);
      CREATE INDEX IF NOT EXISTS idx_time_capsule_media_asset
        ON time_capsule_media(asset_id, capsule_id);

      CREATE TRIGGER IF NOT EXISTS mark_time_capsules_for_review_before_media_delete
      BEFORE DELETE ON media_assets
      BEGIN
        UPDATE time_capsules
        SET needs_review = 1,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id IN (
          SELECT capsule_id FROM time_capsule_media WHERE asset_id = OLD.id
        );
      END;
    `);
  }
});

function initializeCapsuleDatabase(options = {}) {
  const db = requireDatabase(options.db);
  const now = typeof options.now === "function" ? options.now : () => new Date().toISOString();
  const createId = typeof options.createId === "function"
    ? options.createId
    : (prefix) => `${prefix}-${randomUUID()}`;
  const suppliedTransaction = typeof options.withTransaction === "function" ? options.withTransaction : null;
  if (options.applyMigrations !== false) {
    const supportedVersion = Math.max(CAPSULE_SCHEMA_VERSION, Number(options.schemaVersion) || CAPSULE_SCHEMA_VERSION);
    applyMigrations({
      db,
      baselineVersion: 4,
      migrations: [CAPSULE_MIGRATION],
      supportedVersion,
      now
    });
  }

  const statements = prepareStatements(db);

  function runAtomic(operation) {
    if (suppliedTransaction) return suppliedTransaction(operation);
    const savepoint = `capsule_write_${randomUUID().replace(/-/gu, "")}`;
    db.exec(`SAVEPOINT ${savepoint}`);
    try {
      const result = operation();
      if (result && typeof result.then === "function") throw new TypeError("时间胶囊数据库事务必须同步执行。");
      db.exec(`RELEASE SAVEPOINT ${savepoint}`);
      return result;
    } catch (error) {
      try { db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`); } catch { /* preserve original */ }
      try { db.exec(`RELEASE SAVEPOINT ${savepoint}`); } catch { /* preserve original */ }
      throw error;
    }
  }

  // These two shell readers intentionally select only time_capsules. They do
  // not join, parse, count or otherwise touch time_capsule_payloads.
  function listCapsuleShells() {
    return statements.listShells.all().map(rowToShell);
  }

  function getCapsuleShell(id) {
    const row = statements.getShell.get(requireId(id, "capsule id"));
    return row ? rowToShell(row) : null;
  }

  function getCapsulePayload(id) {
    const capsuleId = requireId(id, "capsule id");
    const row = statements.getPayload.get(capsuleId);
    if (!row) return null;
    const actualHash = sha256(row.safe_snapshot_json);
    if (row.payload_sha256 !== actualHash) {
      throw capsuleError("时间胶囊安全快照完整性校验失败。", "CAPSULE_PAYLOAD_INTEGRITY_FAILED", 500);
    }
    let snapshot;
    try {
      snapshot = JSON.parse(row.safe_snapshot_json);
    } catch {
      throw capsuleError("时间胶囊安全快照损坏。", "CAPSULE_PAYLOAD_INVALID", 500);
    }
    validateSafeSnapshot(snapshot);
    return {
      snapshot,
      mediaLinks: statements.mediaForCapsule.all(capsuleId).map(rowToMediaLink)
    };
  }

  function createCapsule(input = {}) {
    assertPlainObject(input, "capsule");
    assertKnownKeys(input, new Set([
      "ceremonialGate", "confirm", "createdAt", "exhibitionId", "id", "mediaLinks",
      "needsReview", "opensOn", "shellMessage", "snapshot", "sourceExhibitionId",
      "timezone", "title", "updatedAt"
    ]), "capsule");
    if (input.confirm !== true) {
      throw capsuleError("创建时间胶囊前需要用户明确确认。", "CAPSULE_CONFIRMATION_REQUIRED");
    }
    if (Number(statements.countCapsules.get()?.count) >= MAX_CAPSULES) {
      throw capsuleError(`最多保存 ${MAX_CAPSULES} 个时间胶囊。`, "CAPSULE_LIMIT_REACHED", 409);
    }
    const id = input.id === undefined ? newId("capsule") : requireId(input.id, "capsule.id");
    if (statements.getShell.get(id)) throw capsuleError("时间胶囊 ID 已存在。", "CAPSULE_EXISTS", 409);
    const snapshot = input.snapshot;
    validateSafeSnapshot(snapshot);
    const title = input.title === undefined
      ? requireText(snapshot.title, "capsule.title", CAPSULE_LIMITS.title)
      : requireText(input.title, "capsule.title", CAPSULE_LIMITS.title);
    const shellMessage = optionalText(input.shellMessage, "capsule.shellMessage", CAPSULE_LIMITS.shellMessage);
    const opensOn = requireLocalDate(input.opensOn, "capsule.opensOn");
    const timezone = normalizeTimezone(input.timezone);
    const ceremonialGate = input.ceremonialGate === undefined ? CEREMONIAL_GATE : String(input.ceremonialGate);
    if (ceremonialGate !== CEREMONIAL_GATE) {
      throw capsuleError("时间胶囊日期门槛必须明确标记为仪式门槛。", "CAPSULE_GATE_INVALID");
    }
    if (input.exhibitionId && input.sourceExhibitionId && input.exhibitionId !== input.sourceExhibitionId) {
      throw capsuleError("展览来源字段互相冲突。", "CAPSULE_SOURCE_INVALID");
    }
    const sourceExhibitionId = input.exhibitionId || input.sourceExhibitionId
      ? requireId(input.exhibitionId || input.sourceExhibitionId, "capsule.exhibitionId")
      : "";
    if (sourceExhibitionId) requireReviewSafeSource(sourceExhibitionId);
    const needsReview = normalizeBoolean(input.needsReview, false, "capsule.needsReview");
    const createdAt = input.createdAt === undefined
      ? getNow()
      : requireTimestamp(input.createdAt, "capsule.createdAt");
    const updatedAt = input.updatedAt === undefined
      ? createdAt
      : requireTimestamp(input.updatedAt, "capsule.updatedAt");
    const mediaLinks = normalizeMediaLinks(input.mediaLinks, snapshot);
    mediaLinks.forEach((link) => requireDisplayAsset(link.assetId));

    const serializedSnapshot = JSON.stringify(snapshot);
    const payloadSha256 = sha256(serializedSnapshot);
    return runAtomic(() => {
      statements.insertCapsule.run(
        id,
        title,
        shellMessage,
        opensOn,
        timezone,
        ceremonialGate,
        needsReview ? 1 : 0,
        sourceExhibitionId || null,
        createdAt,
        updatedAt
      );
      statements.insertPayload.run(id, serializedSnapshot, payloadSha256, createdAt, updatedAt);
      mediaLinks.forEach((link) => statements.insertMedia.run(
        id,
        link.assetId,
        link.itemKey,
        link.position,
        link.altText,
        link.caption,
        createdAt
      ));
      return getCapsuleShell(id);
    });
  }

  function deleteCapsule(id) {
    const capsuleId = requireId(id, "capsule id");
    return runAtomic(() => statements.deleteCapsule.run(capsuleId).changes > 0);
  }

  function clearCapsules() {
    const stats = getCapsuleStats();
    return runAtomic(() => {
      statements.clearCapsules.run();
      return {
        capsulesDeleted: stats.capsules,
        payloadsDeleted: stats.payloads,
        mediaLinksDeleted: stats.mediaLinks
      };
    });
  }

  function getCapsuleStats() {
    const row = statements.stats.get() || {};
    return {
      capsules: Number(row.capsules) || 0,
      payloads: Number(row.payloads) || 0,
      mediaLinks: Number(row.media_links) || 0,
      needsReview: Number(row.needs_review) || 0
    };
  }

  function buildCapsuleBackup(mode = "full") {
    if (mode === "redacted") {
      const stats = getCapsuleStats();
      return {
        mode: "redacted-summary",
        capsuleCount: stats.capsules,
        mediaLinkCount: stats.mediaLinks,
        note: CAPSULE_REDACTED_NOTE
      };
    }
    if (mode !== "full") throw capsuleError("时间胶囊备份模式无效。", "CAPSULE_BACKUP_INVALID");
    return {
      mode: "full",
      schemaVersion: CAPSULE_SCHEMA_VERSION,
      capsules: statements.backupCapsules.all().map((row) => {
        const content = getCapsulePayload(row.id);
        return {
          id: row.id,
          title: row.title,
          shellMessage: row.shell_message || "",
          opensOn: row.opens_on,
          timezone: row.timezone,
          ceremonialGate: row.ceremonial_gate,
          needsReview: Boolean(row.needs_review),
          exhibitionId: row.source_exhibition_id || "",
          snapshot: content.snapshot,
          mediaLinks: content.mediaLinks,
          createdAt: row.created_at,
          updatedAt: row.updated_at
        };
      })
    };
  }

  function validateCapsuleBackup(backup) {
    assertPlainObject(backup, "capsule backup");
    if (backup.mode === "redacted-summary") {
      assertExactKeys(backup, REDACTED_BACKUP_KEYS, "redacted capsule backup");
      if (!isCount(backup.capsuleCount, MAX_CAPSULES) ||
          !isCount(backup.mediaLinkCount, MAX_CAPSULES * CAPSULE_LIMITS.mediaLinks) ||
          backup.note !== CAPSULE_REDACTED_NOTE) {
        throw capsuleError("脱敏时间胶囊备份无效。", "CAPSULE_BACKUP_INVALID");
      }
      return true;
    }
    assertExactKeys(backup, FULL_BACKUP_KEYS, "capsule backup");
    if (backup.mode !== "full" || backup.schemaVersion !== CAPSULE_SCHEMA_VERSION ||
        !Array.isArray(backup.capsules) || backup.capsules.length > MAX_CAPSULES) {
      throw capsuleError("完整时间胶囊备份无效。", "CAPSULE_BACKUP_INVALID");
    }
    const ids = new Set();
    backup.capsules.forEach((capsule, index) => {
      assertPlainObject(capsule, `capsules[${index}]`);
      assertExactKeys(capsule, BACKUP_CAPSULE_KEYS, `capsules[${index}]`);
      const id = requireId(capsule.id, `capsules[${index}].id`);
      if (ids.has(id)) throw capsuleError("时间胶囊备份包含重复 ID。", "CAPSULE_BACKUP_DUPLICATE", 409);
      ids.add(id);
      requireText(capsule.title, `capsules[${index}].title`, CAPSULE_LIMITS.title);
      optionalText(capsule.shellMessage, `capsules[${index}].shellMessage`, CAPSULE_LIMITS.shellMessage);
      requireLocalDate(capsule.opensOn, `capsules[${index}].opensOn`);
      normalizeTimezone(capsule.timezone);
      if (capsule.ceremonialGate !== CEREMONIAL_GATE || typeof capsule.needsReview !== "boolean") {
        throw capsuleError("时间胶囊备份外壳状态无效。", "CAPSULE_BACKUP_INVALID");
      }
      if (capsule.exhibitionId) requireId(capsule.exhibitionId, `capsules[${index}].exhibitionId`);
      validateSafeSnapshot(capsule.snapshot);
      normalizeMediaLinks(capsule.mediaLinks, capsule.snapshot);
      requireTimestamp(capsule.createdAt, `capsules[${index}].createdAt`);
      requireTimestamp(capsule.updatedAt, `capsules[${index}].updatedAt`);
    });
    return true;
  }

  function restoreCapsuleBackup(backup, restoreOptions = {}) {
    validateCapsuleBackup(backup);
    if (backup.mode === "redacted-summary") return { capsules: 0, mediaLinks: 0, idMap: {} };
    assertPlainObject(restoreOptions, "capsule restore options");
    assertKnownKeys(restoreOptions, new Set([
      "capsuleIdMap", "exhibitionIdMap", "mediaAssetIdMap", "skipMissingMedia"
    ]), "capsule restore options");
    if (getCapsuleStats().capsules + backup.capsules.length > MAX_CAPSULES) {
      throw capsuleError(`恢复后时间胶囊不能超过 ${MAX_CAPSULES} 个。`, "CAPSULE_LIMIT_REACHED", 409);
    }
    const requestedCapsuleMap = normalizeIdMap(restoreOptions.capsuleIdMap, "capsuleIdMap");
    const exhibitionMap = normalizeIdMap(restoreOptions.exhibitionIdMap, "exhibitionIdMap");
    const mediaMap = normalizeIdMap(restoreOptions.mediaAssetIdMap, "mediaAssetIdMap");
    const skipMissingMedia = normalizeBoolean(restoreOptions.skipMissingMedia, false, "skipMissingMedia");
    const occupied = new Set(statements.listIds.all().map((row) => row.id));
    const planned = new Map();
    for (const source of backup.capsules) {
      let target = requestedCapsuleMap.get(source.id) || source.id;
      target = requireId(target, `target capsule id for ${source.id}`);
      if (occupied.has(target) || [...planned.values()].includes(target)) target = uniqueId("capsule", occupied, planned);
      planned.set(source.id, target);
      occupied.add(target);
    }

    let mediaLinks = 0;
    runAtomic(() => {
      for (const source of backup.capsules) {
        const targetId = planned.get(source.id);
        const sourceExhibitionId = source.exhibitionId;
        let targetExhibitionId = "";
        if (sourceExhibitionId) {
          const candidate = exhibitionMap.get(sourceExhibitionId) || sourceExhibitionId;
          if (statements.getReviewSafeExhibition.get(candidate)) targetExhibitionId = candidate;
        }
        const mappedLinks = [];
        for (const link of source.mediaLinks) {
          const candidate = mediaMap.get(link.assetId) || link.assetId;
          const targetAssetId = requireId(candidate, `target media id for ${link.assetId}`);
          try {
            requireDisplayAsset(targetAssetId);
          } catch (error) {
            if (skipMissingMedia && ["CAPSULE_MEDIA_NOT_FOUND", "CAPSULE_MEDIA_VARIANT_INVALID"].includes(error.code)) continue;
            throw capsuleError(
              `恢复时间胶囊缺少图片映射：${link.assetId}。`,
              "CAPSULE_BACKUP_REFERENCE_INVALID",
              400
            );
          }
          mappedLinks.push({ ...link, assetId: targetAssetId, position: mappedLinks.length });
        }
        createCapsule({
          id: targetId,
          title: source.title,
          shellMessage: source.shellMessage,
          opensOn: source.opensOn,
          timezone: source.timezone,
          ceremonialGate: source.ceremonialGate,
          needsReview: source.needsReview,
          exhibitionId: targetExhibitionId,
          snapshot: source.snapshot,
          mediaLinks: mappedLinks,
          createdAt: source.createdAt,
          updatedAt: source.updatedAt,
          confirm: true
        });
        mediaLinks += mappedLinks.length;
      }
    });
    return { capsules: backup.capsules.length, mediaLinks, idMap: Object.fromEntries(planned) };
  }

  function requireReviewSafeSource(exhibitionId) {
    const row = statements.getExhibition.get(exhibitionId);
    if (!row) throw capsuleError("没有找到来源展览。", "CAPSULE_SOURCE_NOT_FOUND", 404);
    if (row.status !== "published" || Boolean(row.needs_review)) {
      throw capsuleError("来源展览必须已发布且无需复核。", "CAPSULE_SOURCE_REVIEW_REQUIRED", 409);
    }
    return row;
  }

  function requireDisplayAsset(assetId) {
    const row = statements.getDisplayAsset.get(requireId(assetId, "media asset id"));
    if (!row) throw capsuleError("没有找到所选图片。", "CAPSULE_MEDIA_NOT_FOUND", 404);
    if (row.status !== "ready" || row.kind !== "display" || row.mime_type !== "image/webp") {
      throw capsuleError("时间胶囊只能链接已就绪的 display WebP。", "CAPSULE_MEDIA_VARIANT_INVALID", 409);
    }
    return row;
  }

  function getNow() {
    return requireTimestamp(now(), "now()");
  }

  function newId(prefix) {
    return requireId(createId(prefix), `${prefix} id`);
  }

  function uniqueId(prefix, occupied, planned) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const id = newId(prefix);
      if (!occupied.has(id) && ![...planned.values()].includes(id)) return id;
    }
    throw capsuleError("无法为恢复生成无碰撞时间胶囊 ID。", "CAPSULE_ID_EXHAUSTED", 500);
  }

  return Object.freeze({
    buildCapsuleBackup,
    buildTimeCapsuleBackup: buildCapsuleBackup,
    clearCapsules,
    clearTimeCapsules: clearCapsules,
    createCapsule,
    createCapsuleRecord: createCapsule,
    createTimeCapsuleRecord: createCapsule,
    deleteCapsule,
    deleteTimeCapsule: deleteCapsule,
    getCapsulePayload,
    getCapsuleShell,
    getCapsuleStats,
    getTimeCapsule: getCapsuleShell,
    getTimeCapsulePayload: getCapsulePayload,
    getTimeCapsuleStats: getCapsuleStats,
    listCapsuleShells,
    listTimeCapsules: listCapsuleShells,
    restoreCapsuleBackup,
    restoreTimeCapsuleBackup: restoreCapsuleBackup,
    validateCapsuleBackup,
    validateTimeCapsuleBackup: validateCapsuleBackup
  });
}

function prepareStatements(db) {
  return {
    countCapsules: db.prepare("SELECT COUNT(*) AS count FROM time_capsules"),
    listShells: db.prepare(`
      SELECT id, title, shell_message, opens_on, timezone, ceremonial_gate,
        needs_review, created_at
      FROM time_capsules
      ORDER BY opens_on, datetime(created_at), id
    `),
    getShell: db.prepare(`
      SELECT id, title, shell_message, opens_on, timezone, ceremonial_gate,
        needs_review, created_at
      FROM time_capsules WHERE id = ?
    `),
    getPayload: db.prepare("SELECT safe_snapshot_json, payload_sha256 FROM time_capsule_payloads WHERE capsule_id = ?"),
    mediaForCapsule: db.prepare(`
      SELECT asset_id, item_key, position, alt_text, caption
      FROM time_capsule_media WHERE capsule_id = ? ORDER BY position, asset_id
    `),
    insertCapsule: db.prepare(`
      INSERT INTO time_capsules (
        id, schema_version, title, shell_message, opens_on, timezone,
        ceremonial_gate, needs_review, source_exhibition_id, created_at, updated_at
      ) VALUES (?, 9, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    insertPayload: db.prepare(`
      INSERT INTO time_capsule_payloads (
        capsule_id, safe_snapshot_json, payload_sha256, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?)
    `),
    insertMedia: db.prepare(`
      INSERT INTO time_capsule_media (
        capsule_id, asset_id, item_key, position, alt_text, caption, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `),
    deleteCapsule: db.prepare("DELETE FROM time_capsules WHERE id = ?"),
    clearCapsules: db.prepare("DELETE FROM time_capsules"),
    stats: db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM time_capsules) AS capsules,
        (SELECT COUNT(*) FROM time_capsule_payloads) AS payloads,
        (SELECT COUNT(*) FROM time_capsule_media) AS media_links,
        (SELECT COUNT(*) FROM time_capsules WHERE needs_review = 1) AS needs_review
    `),
    backupCapsules: db.prepare("SELECT * FROM time_capsules ORDER BY id"),
    listIds: db.prepare("SELECT id FROM time_capsules ORDER BY id"),
    getExhibition: db.prepare("SELECT id, status, needs_review FROM exhibitions WHERE id = ?"),
    getReviewSafeExhibition: db.prepare(`
      SELECT id FROM exhibitions WHERE id = ? AND status = 'published' AND needs_review = 0
    `),
    getDisplayAsset: db.prepare(`
      SELECT asset.id, asset.status, variant.kind, variant.mime_type
      FROM media_assets asset
      LEFT JOIN media_variants variant
        ON variant.asset_id = asset.id AND variant.kind = 'display'
      WHERE asset.id = ?
    `)
  };
}

function normalizeMediaLinks(value, snapshot) {
  const links = value === undefined || value === null ? [] : value;
  if (!Array.isArray(links) || links.length > CAPSULE_LIMITS.mediaLinks) {
    throw capsuleError(`mediaLinks 必须是最多 ${CAPSULE_LIMITS.mediaLinks} 项的数组。`, "CAPSULE_MEDIA_LIMIT");
  }
  const itemKeys = new Set(snapshot.sections.flatMap((section) => section.items.map((item) => item.key)));
  const assetIds = new Set();
  const positions = new Set();
  return links.map((link, index) => {
    assertPlainObject(link, `mediaLinks[${index}]`);
    assertExactKeys(link, BACKUP_MEDIA_KEYS, `mediaLinks[${index}]`);
    const assetId = requireId(link.assetId, `mediaLinks[${index}].assetId`);
    if (assetIds.has(assetId)) throw capsuleError("mediaLinks 包含重复图片。", "CAPSULE_MEDIA_DUPLICATE", 409);
    assetIds.add(assetId);
    const itemKey = String(link.itemKey || "");
    if (!ITEM_KEY_PATTERN.test(itemKey) || !itemKeys.has(itemKey)) {
      throw capsuleError("mediaLinks 引用了快照之外的匿名展品键。", "CAPSULE_MEDIA_REFERENCE_INVALID");
    }
    const position = link.position;
    if (!Number.isSafeInteger(position) || position < 0 || position >= links.length || positions.has(position)) {
      throw capsuleError("mediaLinks position 必须唯一且连续。", "CAPSULE_MEDIA_POSITION_INVALID");
    }
    positions.add(position);
    return {
      assetId,
      itemKey,
      position,
      altText: optionalText(link.altText, `mediaLinks[${index}].altText`, CAPSULE_LIMITS.altText),
      caption: optionalText(link.caption, `mediaLinks[${index}].caption`, CAPSULE_LIMITS.caption)
    };
  }).sort((left, right) => left.position - right.position);
}

function rowToShell(row) {
  return {
    id: row.id,
    title: row.title,
    shellMessage: row.shell_message || "",
    opensOn: row.opens_on,
    timezone: row.timezone,
    ceremonialGate: row.ceremonial_gate,
    needsReview: Boolean(row.needs_review),
    createdAt: row.created_at
  };
}

function rowToMediaLink(row) {
  return {
    assetId: row.asset_id,
    itemKey: row.item_key,
    position: Number(row.position),
    altText: row.alt_text || "",
    caption: row.caption || ""
  };
}

function normalizeIdMap(value, name) {
  if (value === undefined || value === null) return new Map();
  if (value instanceof Map) return new Map(value);
  if (isPlainObject(value)) return new Map(Object.entries(value));
  throw capsuleError(`${name} 必须是 Map 或对象。`, "CAPSULE_BACKUP_MAPPING_INVALID");
}

function normalizeBoolean(value, fallback, name) {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw capsuleError(`${name} 必须是布尔值。`, "CAPSULE_VALUE_INVALID");
  return value;
}

function requireDatabase(db) {
  if (!db || typeof db.exec !== "function" || typeof db.prepare !== "function") {
    throw new TypeError("initializeCapsuleDatabase 需要同步 SQLite 数据库连接。");
  }
  return db;
}

function requireId(value, name) {
  const id = String(value || "").trim();
  if (!ID_PATTERN.test(id)) throw capsuleError(`${name} 无效。`, "CAPSULE_ID_INVALID");
  return id;
}

function requireText(value, name, maximum) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || [...text].length > maximum || text.includes("\u0000")) {
    throw capsuleError(`${name} 不能为空且最多 ${maximum} 个字符。`, "CAPSULE_TEXT_INVALID");
  }
  return text;
}

function optionalText(value, name, maximum) {
  if (value === undefined || value === null) return "";
  const text = typeof value === "string" ? value.trim() : "";
  if ([...text].length > maximum || text.includes("\u0000")) {
    throw capsuleError(`${name} 最多 ${maximum} 个字符。`, "CAPSULE_TEXT_INVALID");
  }
  return text;
}

function requireTimestamp(value, name) {
  const text = String(value || "").trim();
  if (!text || text.length > 40 || !Number.isFinite(Date.parse(text))) {
    throw capsuleError(`${name} 必须是有效时间戳。`, "CAPSULE_TIMESTAMP_INVALID");
  }
  return text;
}

function assertPlainObject(value, name) {
  if (!isPlainObject(value)) throw capsuleError(`${name} 必须是对象。`, "CAPSULE_VALUE_INVALID");
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertKnownKeys(value, allowed, name) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw capsuleError(`${name} 包含未知字段 ${key}。`, "CAPSULE_VALUE_INVALID");
  }
}

function assertExactKeys(value, expected, name) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw capsuleError(`${name} 字段集合无效。`, "CAPSULE_BACKUP_INVALID");
  }
}

function isCount(value, maximum) {
  return Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}

function sha256(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

function capsuleError(message, code, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

module.exports = {
  CAPSULE_LIMITS,
  CAPSULE_MIGRATION,
  CAPSULE_REDACTED_NOTE,
  CAPSULE_SCHEMA_VERSION,
  CEREMONIAL_GATE,
  MAX_CAPSULES,
  initializeCapsuleDatabase
};
