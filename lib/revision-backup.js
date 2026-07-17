"use strict";

const { createHash } = require("node:crypto");

const REVISION_SCHEMA_VERSION = 10;
const REVISION_BACKUP_LIMITS = Object.freeze({
  bytes: 20 * 1024 * 1024,
  memories: 500,
  revisions: 10000
});
const REVISION_REDACTED_NOTE = "旧版本正文、结构化字段、编辑备注、哈希、精确时间和内部 ID 已从脱敏导出中物理移除。";
const REVISION_CHANGE_KINDS = new Set(["baseline", "created", "edited", "restored", "imported"]);
const INITIAL_CHANGE_KINDS = new Set(["baseline", "created", "imported"]);
const ID_PATTERN = /^[a-zA-Z0-9_-]{1,120}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

const FULL_KEYS = Object.freeze(["mode", "schemaVersion", "revisions"]);
const REDACTED_KEYS = Object.freeze(["memoryCount", "mode", "note", "revisionCount"]);
const REVISION_KEYS = Object.freeze([
  "changeKind", "changeNote", "createdAt", "id", "memoryId", "parentSha256",
  "restoredFromRevisionId", "revisionNo", "snapshot", "snapshotSha256", "sourceUpdatedAt"
]);
const DATABASE_REVISION_KEYS = Object.freeze([
  "change_kind", "change_note", "created_at", "id", "memory_id", "parent_sha256",
  "restored_from_revision_id", "revision_no", "snapshot_json", "snapshot_sha256", "source_updated_at"
]);
const SNAPSHOT_KEYS = Object.freeze([
  "attachments", "coverImage", "date", "emotionIntensity", "emotions", "exhibitText",
  "favorite", "hall", "importance", "location", "mediaNote", "people", "rawContent",
  "sourceType", "tags", "title"
]);
const ATTACHMENT_KEYS = Object.freeze(["name", "note", "type"]);

function createMemorySnapshot(input = {}) {
  assertPlainObject(input, "memory snapshot source");
  return {
    attachments: normalizeAttachments(read(input, "attachments")),
    coverImage: normalizeText(read(input, "coverImage", "cover_image"), 300),
    date: normalizeText(read(input, "date", "memory_date"), 30),
    emotionIntensity: normalizeInteger(read(input, "emotionIntensity", "emotion_intensity"), 1, 5, 3),
    emotions: normalizeList(read(input, "emotions"), 6, 20),
    exhibitText: normalizeText(read(input, "exhibitText", "exhibit_text"), 800),
    favorite: normalizeBoolean(read(input, "favorite")),
    hall: normalizeRequiredText(read(input, "hall", "hall_id"), 40, "snapshot.hall"),
    importance: normalizeInteger(read(input, "importance"), 1, 5, 2),
    location: normalizeText(read(input, "location"), 80),
    mediaNote: normalizeText(read(input, "mediaNote", "media_note"), 500),
    people: normalizeList(read(input, "people"), 12, 30),
    rawContent: normalizeText(read(input, "rawContent", "raw_content"), 4000),
    sourceType: normalizeRequiredText(read(input, "sourceType", "source_type"), 40, "snapshot.sourceType"),
    tags: normalizeList(read(input, "tags"), 12, 30),
    title: normalizeRequiredText(read(input, "title"), 80, "snapshot.title")
  };
}

function validateMemorySnapshot(value, name = "snapshot") {
  assertPlainObject(value, name);
  assertExactKeys(value, SNAPSHOT_KEYS, name);
  const canonical = createMemorySnapshot(value);
  for (const key of SNAPSHOT_KEYS) {
    if (!jsonEqual(value[key], canonical[key])) {
      throw revisionBackupError(`${name}.${key} 不是规范值。`, "REVISION_SNAPSHOT_INVALID");
    }
  }
  return canonical;
}

function serializeMemorySnapshot(value) {
  return JSON.stringify(validateMemorySnapshot(createMemorySnapshot(value)));
}

function memorySnapshotSha256(value) {
  return sha256(serializeMemorySnapshot(value));
}

function buildRevisionBackup(input, mode = "full", sourceMemoryIds) {
  const revisions = normalizeRevisionSource(input);
  const boundary = sourceMemoryIds === undefined
    ? null
    : normalizeIdBoundary(sourceMemoryIds, "sourceMemoryIds");
  const selected = revisions.filter((revision) => !boundary || boundary.has(revision.memoryId));
  if (mode === "redacted" || mode === "redacted-summary") {
    const backup = {
      memoryCount: new Set(selected.map((revision) => revision.memoryId)).size,
      mode: "redacted-summary",
      note: REVISION_REDACTED_NOTE,
      revisionCount: selected.length
    };
    validateRevisionBackup(backup, []);
    return backup;
  }
  if (mode !== "full") throw revisionBackupError("修订备份模式必须是 full 或 redacted。", "REVISION_BACKUP_MODE_INVALID");
  const backup = {
    mode: "full",
    schemaVersion: REVISION_SCHEMA_VERSION,
    revisions: sortRevisions(selected)
  };
  const validationBoundary = boundary || new Set(selected.map((revision) => revision.memoryId));
  validateRevisionBackup(backup, [...validationBoundary]);
  return backup;
}

function validateRevisionBackup(backup, sourceMemoryIds) {
  assertPlainObject(backup, "revision backup");
  if (backup.mode === "redacted-summary") return validateRedactedBackup(backup);
  assertExactKeys(backup, FULL_KEYS, "完整修订备份");
  if (backup.mode !== "full" || backup.schemaVersion !== REVISION_SCHEMA_VERSION) {
    throw revisionBackupError("完整修订备份的模式或 Schema 版本无效。", "REVISION_BACKUP_INVALID");
  }
  const allowedMemoryIds = normalizeIdBoundary(sourceMemoryIds, "sourceMemoryIds");
  const revisions = requireArray(backup.revisions, REVISION_BACKUP_LIMITS.revisions, "revisions");
  const revisionIds = new Set();
  const byMemory = new Map();

  revisions.forEach((input, index) => {
    const path = `revisions[${index}]`;
    const revision = normalizeBackupRevision(input, path);
    if (!allowedMemoryIds.has(revision.memoryId)) {
      throw revisionBackupError("修订引用了备份边界之外的展品。", "REVISION_BACKUP_REFERENCE_INVALID");
    }
    if (revisionIds.has(revision.id)) throw revisionBackupError("修订备份包含重复 ID。", "REVISION_BACKUP_DUPLICATE");
    revisionIds.add(revision.id);
    if (!byMemory.has(revision.memoryId)) byMemory.set(revision.memoryId, []);
    byMemory.get(revision.memoryId).push(revision);
  });
  if (byMemory.size > REVISION_BACKUP_LIMITS.memories) {
    throw revisionBackupError("修订备份包含过多展品。", "REVISION_BACKUP_LIMIT_EXCEEDED");
  }

  for (const chain of byMemory.values()) validateRevisionChain(chain, revisionIds);
  assertFullBackupByteLimit(backup);
  return true;
}

function remapRevisionBackup(backup, options = {}) {
  assertPlainObject(options, "revision remap options");
  if (backup?.mode === "redacted-summary") {
    validateRevisionBackup(backup, []);
    return { backup: cloneJson(backup), idMap: { memories: {}, revisions: {} } };
  }
  const sourceMemoryIds = unique((Array.isArray(backup?.revisions) ? backup.revisions : []).map((item) => item?.memoryId));
  validateRevisionBackup(backup, sourceMemoryIds);
  const memoryMap = normalizeIdMap(options.memoryIdMap, "memoryIdMap", true);
  const requestedRevisionMap = normalizeIdMap(options.revisionIdMap, "revisionIdMap", false);
  const occupied = normalizeOccupiedIds(options.occupiedRevisionIds || options.existingRevisionIds, "occupiedRevisionIds");
  const createId = typeof options.createId === "function" ? options.createId : null;
  const mappedMemories = new Map();
  const memoryTargets = new Set();
  for (const sourceId of sourceMemoryIds) {
    if (!memoryMap.has(sourceId)) throw revisionBackupError("修订恢复缺少展品 ID 映射。", "REVISION_BACKUP_MAPPING_MISSING");
    const targetId = requireId(memoryMap.get(sourceId), "target memory id");
    if (memoryTargets.has(targetId)) {
      throw revisionBackupError("多个源展品不能映射到同一目标展品。", "REVISION_BACKUP_MAPPING_COLLISION", 409);
    }
    memoryTargets.add(targetId);
    mappedMemories.set(sourceId, targetId);
  }

  const mappedRevisions = new Map();
  const targets = new Set(occupied);
  for (const revision of backup.revisions) {
    let target = requestedRevisionMap.has(revision.id)
      ? requireId(requestedRevisionMap.get(revision.id), `target revision id for ${revision.id}`)
      : revision.id;
    if (targets.has(target)) {
      if (!createId) throw revisionBackupError("修订目标 ID 已存在且没有安全 ID 生成器。", "REVISION_BACKUP_ID_COLLISION", 409);
      target = claimGeneratedId(createId, targets);
    }
    if (targets.has(target)) throw revisionBackupError("多个源修订映射到同一目标 ID。", "REVISION_BACKUP_MAPPING_COLLISION", 409);
    targets.add(target);
    mappedRevisions.set(revision.id, target);
  }

  const remapped = {
    mode: "full",
    schemaVersion: REVISION_SCHEMA_VERSION,
    revisions: backup.revisions.map((revision) => ({
      ...cloneJson(revision),
      id: mappedRevisions.get(revision.id),
      memoryId: mappedMemories.get(revision.memoryId),
      restoredFromRevisionId: revision.restoredFromRevisionId
        ? mappedRevisions.get(revision.restoredFromRevisionId)
        : ""
    }))
  };
  remapped.revisions = sortRevisions(remapped.revisions);
  validateRevisionBackup(remapped, [...memoryTargets]);
  return {
    backup: remapped,
    idMap: {
      memories: Object.fromEntries(mappedMemories),
      revisions: Object.fromEntries(mappedRevisions)
    }
  };
}

function validateRevisionChain(sourceChain, allRevisionIds) {
  const chain = [...sourceChain].sort((left, right) => left.revisionNo - right.revisionNo);
  const chainIds = new Set(chain.map((revision) => revision.id));
  const chainById = new Map(chain.map((revision) => [revision.id, revision]));
  let previous = null;
  for (let index = 0; index < chain.length; index += 1) {
    const revision = chain[index];
    if (revision.revisionNo !== index + 1) {
      throw revisionBackupError("同一展品的修订序号必须从 1 开始且连续。", "REVISION_BACKUP_CHAIN_INVALID");
    }
    if (!previous) {
      if (revision.parentSha256 || !INITIAL_CHANGE_KINDS.has(revision.changeKind)) {
        throw revisionBackupError("首条修订必须是无父节点的 baseline、created 或 imported。", "REVISION_BACKUP_CHAIN_INVALID");
      }
    } else {
      if (revision.parentSha256 !== previous.snapshotSha256 || INITIAL_CHANGE_KINDS.has(revision.changeKind)) {
        throw revisionBackupError("修订父哈希或变更类型与链顺序不一致。", "REVISION_BACKUP_CHAIN_INVALID");
      }
    }
    if (revision.changeKind === "restored") {
      if (!revision.restoredFromRevisionId || !allRevisionIds.has(revision.restoredFromRevisionId) ||
          !chainIds.has(revision.restoredFromRevisionId)) {
        throw revisionBackupError("恢复修订必须引用同一展品链中的旧版本。", "REVISION_BACKUP_REFERENCE_INVALID");
      }
      const target = chainById.get(revision.restoredFromRevisionId);
      if (!target || target.revisionNo >= revision.revisionNo) {
        throw revisionBackupError("恢复来源必须早于新 head。", "REVISION_BACKUP_REFERENCE_INVALID");
      }
    } else if (revision.restoredFromRevisionId) {
      throw revisionBackupError("非恢复修订不能声明 restoredFromRevisionId。", "REVISION_BACKUP_REFERENCE_INVALID");
    }
    previous = revision;
  }
  return true;
}

function normalizeRevisionSource(input) {
  const value = Array.isArray(input) ? input : input?.revisions;
  const rows = requireArray(value, REVISION_BACKUP_LIMITS.revisions, "revisions");
  return rows.map((row, index) => normalizeBackupRevision(row, `revisions[${index}]`, true));
}

function normalizeBackupRevision(input, name, allowDatabaseRow = false) {
  assertPlainObject(input, name);
  const canonicalInput = Object.hasOwn(input, "snapshot");
  if (canonicalInput) {
    assertExactKeys(input, REVISION_KEYS, name);
  } else if (allowDatabaseRow) {
    assertExactKeys(input, DATABASE_REVISION_KEYS, name);
  } else {
    assertExactKeys(input, REVISION_KEYS, name);
  }
  const candidate = canonicalInput ? {
    changeKind: input.changeKind,
    changeNote: input.changeNote,
    createdAt: input.createdAt,
    id: input.id,
    memoryId: input.memoryId,
    parentSha256: input.parentSha256,
    restoredFromRevisionId: input.restoredFromRevisionId,
    revisionNo: input.revisionNo,
    snapshot: input.snapshot,
    snapshotSha256: input.snapshotSha256,
    sourceUpdatedAt: input.sourceUpdatedAt
  } : {
    changeKind: input.change_kind,
    changeNote: input.change_note,
    createdAt: input.created_at,
    id: input.id,
    memoryId: input.memory_id,
    parentSha256: input.parent_sha256,
    restoredFromRevisionId: input.restored_from_revision_id,
    revisionNo: input.revision_no,
    snapshot: parseDatabaseSnapshot(input.snapshot_json, name),
    snapshotSha256: input.snapshot_sha256,
    sourceUpdatedAt: input.source_updated_at
  };
  candidate.id = requireId(candidate.id, `${name}.id`);
  candidate.memoryId = requireId(candidate.memoryId, `${name}.memoryId`);
  candidate.revisionNo = requirePositiveInteger(candidate.revisionNo, `${name}.revisionNo`);
  candidate.changeKind = requireEnum(candidate.changeKind, REVISION_CHANGE_KINDS, `${name}.changeKind`);
  candidate.changeNote = requireText(candidate.changeNote, `${name}.changeNote`, 500, false);
  candidate.parentSha256 = requireOptionalSha256(candidate.parentSha256, `${name}.parentSha256`);
  candidate.restoredFromRevisionId = candidate.restoredFromRevisionId
    ? requireId(candidate.restoredFromRevisionId, `${name}.restoredFromRevisionId`)
    : "";
  candidate.sourceUpdatedAt = requireTimestamp(candidate.sourceUpdatedAt, `${name}.sourceUpdatedAt`);
  candidate.createdAt = requireTimestamp(candidate.createdAt, `${name}.createdAt`);
  candidate.snapshot = validateMemorySnapshot(candidate.snapshot, `${name}.snapshot`);
  candidate.snapshotSha256 = requireSha256(candidate.snapshotSha256, `${name}.snapshotSha256`);
  if (candidate.snapshotSha256 !== memorySnapshotSha256(candidate.snapshot)) {
    throw revisionBackupError("修订快照 SHA-256 与规范快照不一致。", "REVISION_BACKUP_HASH_MISMATCH");
  }
  return candidate;
}

function parseDatabaseSnapshot(serialized, name) {
  if (typeof serialized !== "string") throw revisionBackupError(`${name}.snapshot 缺失。`, "REVISION_BACKUP_INVALID");
  try { return JSON.parse(serialized); } catch { throw revisionBackupError(`${name}.snapshotJson 不是 JSON。`, "REVISION_BACKUP_INVALID"); }
}

function assertFullBackupByteLimit(backup) {
  let bytes;
  try {
    bytes = Buffer.byteLength(JSON.stringify(backup), "utf8");
  } catch {
    throw revisionBackupError("完整修订备份无法序列化为 UTF-8 JSON。", "REVISION_BACKUP_INVALID");
  }
  if (bytes > REVISION_BACKUP_LIMITS.bytes) {
    throw revisionBackupError("完整修订备份超过 UTF-8 JSON 容量限制。", "REVISION_BACKUP_LIMIT_EXCEEDED", 413);
  }
  return bytes;
}

function validateRedactedBackup(backup) {
  assertExactKeys(backup, REDACTED_KEYS, "脱敏修订摘要");
  if (backup.mode !== "redacted-summary" || backup.note !== REVISION_REDACTED_NOTE) {
    throw revisionBackupError("脱敏修订摘要的模式或固定说明无效。", "REVISION_BACKUP_INVALID");
  }
  const memoryCount = requireCount(backup.memoryCount, "memoryCount", REVISION_BACKUP_LIMITS.memories);
  const revisionCount = requireCount(backup.revisionCount, "revisionCount", REVISION_BACKUP_LIMITS.revisions);
  if (memoryCount > revisionCount) throw revisionBackupError("脱敏修订摘要计数互相矛盾。", "REVISION_BACKUP_INVALID");
  return true;
}

function normalizeAttachments(value) {
  const source = value === undefined ? [] : value;
  if (!Array.isArray(source) || source.length > 12) throw revisionBackupError("snapshot.attachments 数组无效。", "REVISION_SNAPSHOT_INVALID");
  return source.map((item, index) => {
    assertPlainObject(item, `snapshot.attachments[${index}]`);
    const attachment = {
      name: normalizeRequiredText(item.name, 80, `snapshot.attachments[${index}].name`),
      note: normalizeText(item.note, 180),
      type: normalizeRequiredText(item.type, 30, `snapshot.attachments[${index}].type`)
    };
    if (Object.keys(item).length !== ATTACHMENT_KEYS.length || !ATTACHMENT_KEYS.every((key) => Object.hasOwn(item, key))) {
      throw revisionBackupError("snapshot attachment 字段集合无效。", "REVISION_SNAPSHOT_INVALID");
    }
    return attachment;
  });
}

function normalizeList(value, maximum, itemMaximum) {
  if (!Array.isArray(value) || value.length > maximum) throw revisionBackupError("snapshot 列表字段无效。", "REVISION_SNAPSHOT_INVALID");
  const values = value.map((item) => normalizeRequiredText(item, itemMaximum, "snapshot list item"));
  return unique(values).sort(compareText);
}

function normalizeText(value, maximum) {
  const text = String(value ?? "").trim();
  if (text.length > maximum || text.includes("\u0000")) throw revisionBackupError("snapshot 文本字段无效。", "REVISION_SNAPSHOT_INVALID");
  return text;
}

function normalizeRequiredText(value, maximum, name) {
  const text = normalizeText(value, maximum);
  if (!text) throw revisionBackupError(`${name} 不能为空。`, "REVISION_SNAPSHOT_INVALID");
  return text;
}

function normalizeInteger(value, minimum, maximum, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isInteger(number) && number >= minimum && number <= maximum ? number : fallback;
}

function normalizeBoolean(value) {
  return value === true || value === 1 || value === "1" || value === "true";
}

function sortRevisions(revisions) {
  return [...revisions].sort((left, right) => (
    compareText(left.memoryId, right.memoryId) || left.revisionNo - right.revisionNo || compareText(left.id, right.id)
  ));
}

function claimGeneratedId(createId, occupied) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = requireId(createId("revision"), "generated revision id");
    if (!occupied.has(candidate)) return candidate;
  }
  throw revisionBackupError("连续生成的修订 ID 均已占用。", "REVISION_BACKUP_ID_EXHAUSTED", 500);
}

function normalizeIdBoundary(value, name) {
  if (!Array.isArray(value)) throw revisionBackupError(`${name} 必须是展品 ID 数组。`, "REVISION_BACKUP_REFERENCE_INVALID");
  const output = new Set();
  value.forEach((item) => {
    const id = requireId(item, name);
    if (output.has(id)) throw revisionBackupError(`${name} 不能包含重复 ID。`, "REVISION_BACKUP_DUPLICATE");
    output.add(id);
  });
  return output;
}

function normalizeIdMap(value, name, required) {
  if (value instanceof Map) return new Map(value);
  if (value && typeof value === "object" && !Array.isArray(value)) return new Map(Object.entries(value));
  if (!required && (value === undefined || value === null)) return new Map();
  throw revisionBackupError(`${name} 必须是 Map 或普通对象。`, "REVISION_BACKUP_MAPPING_INVALID");
}

function normalizeOccupiedIds(value, name) {
  if (value === undefined || value === null) return new Set();
  const entries = value instanceof Set ? [...value] : value;
  if (!Array.isArray(entries)) throw revisionBackupError(`${name} 必须是数组或 Set。`, "REVISION_BACKUP_MAPPING_INVALID");
  return new Set(entries.map((id) => requireId(id, name)));
}

function assertExactKeys(value, expected, name) {
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (keys.length !== wanted.length || keys.some((key, index) => key !== wanted[index])) {
    throw revisionBackupError(`${name} 字段集合无效。`, "REVISION_BACKUP_INVALID");
  }
}

function assertPlainObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw revisionBackupError(`${name} 必须是普通对象。`, "REVISION_BACKUP_INVALID");
  }
}

function requireArray(value, maximum, name) {
  if (!Array.isArray(value) || value.length > maximum) {
    throw revisionBackupError(`${name} 数组无效或超过限制。`, "REVISION_BACKUP_LIMIT_EXCEEDED");
  }
  return value;
}

function requireId(value, name) {
  const id = String(value || "").trim();
  if (!ID_PATTERN.test(id)) throw revisionBackupError(`${name} 无效。`, "REVISION_BACKUP_INVALID");
  return id;
}

function requireSha256(value, name) {
  const hash = String(value || "");
  if (!SHA256_PATTERN.test(hash)) throw revisionBackupError(`${name} 必须是小写 SHA-256。`, "REVISION_BACKUP_INVALID");
  return hash;
}

function requireOptionalSha256(value, name) {
  return value === "" ? "" : requireSha256(value, name);
}

function requirePositiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) throw revisionBackupError(`${name} 必须是正整数。`, "REVISION_BACKUP_INVALID");
  return value;
}

function requireEnum(value, allowed, name) {
  if (!allowed.has(value)) throw revisionBackupError(`${name} 无效。`, "REVISION_BACKUP_INVALID");
  return value;
}

function requireText(value, name, maximum, required) {
  if (typeof value !== "string" || value.includes("\u0000") || value.length > maximum || (required && !value)) {
    throw revisionBackupError(`${name} 文本无效。`, "REVISION_BACKUP_INVALID");
  }
  if (value !== value.trim()) throw revisionBackupError(`${name} 必须是规范文本。`, "REVISION_BACKUP_INVALID");
  return value;
}

function requireTimestamp(value, name) {
  if (typeof value !== "string" || !value || value.length > 40) throw revisionBackupError(`${name} 时间无效。`, "REVISION_BACKUP_INVALID");
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== value) throw revisionBackupError(`${name} 必须是规范 UTC 时间。`, "REVISION_BACKUP_INVALID");
  return value;
}

function requireCount(value, name, maximum) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw revisionBackupError(`${name} 计数无效。`, "REVISION_BACKUP_INVALID");
  }
  return value;
}

function read(object, ...keys) {
  for (const key of keys) if (Object.hasOwn(object, key)) return object[key];
  return undefined;
}

function sha256(text) {
  return createHash("sha256").update(String(text), "utf8").digest("hex");
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function unique(values) {
  return [...new Set(values)];
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function jsonEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function revisionBackupError(message, code, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

module.exports = {
  REVISION_BACKUP_LIMITS,
  REVISION_CHANGE_KINDS,
  REVISION_REDACTED_NOTE,
  REVISION_SCHEMA_VERSION,
  buildRevisionBackup,
  createMemorySnapshot,
  memorySnapshotSha256,
  remapRevisionBackup,
  serializeMemorySnapshot,
  validateMemorySnapshot,
  validateRevisionBackup,
  validateRevisionChain
};
