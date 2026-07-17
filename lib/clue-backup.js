"use strict";

const CLUE_SCHEMA_VERSION = 7;
const CLUE_BACKUP_LIMITS = Object.freeze({
  entities: 500,
  aliases: 2000,
  memoryLinks: 3000
});
const ENTITY_TYPES = new Set(["person", "location", "theme"]);
const ALIAS_SOURCES = new Set(["user", "merge", "import"]);
const LINK_SOURCE_FIELDS = new Set(["people", "location", "tags", "manual"]);
const ID_PATTERN = /^[a-zA-Z0-9_-]{1,120}$/u;
const REDACTED_NOTE = "实体名称、别名、展品 ID、逐条关系与精确时间已从脱敏导出中物理移除。";

const FULL_KEYS = Object.freeze(["mode", "schemaVersion", "entities"]);
const REDACTED_KEYS = Object.freeze(["mode", "entityCount", "personCount", "locationCount", "themeCount", "note"]);
const ENTITY_KEYS = Object.freeze(["id", "type", "canonicalName", "aliases", "memoryLinks"]);
const ALIAS_KEYS = Object.freeze(["id", "alias", "source", "confirmedAt", "createdAt", "updatedAt"]);
const LINK_KEYS = Object.freeze(["memoryId", "sourceField", "mentionText", "confirmedAt", "createdAt", "updatedAt"]);

function buildClueBackup(input, mode = "full", sourceMemoryIds) {
  const normalizedMode = normalizeMode(mode);
  const graph = buildEntityGraph(input);
  const boundary = sourceMemoryIds === undefined
    ? null
    : normalizeIdBoundary(sourceMemoryIds, "sourceMemoryIds");
  const entities = graph.map((entity) => ({
    ...entity,
    memoryLinks: boundary
      ? entity.memoryLinks.filter((link) => boundary.has(link.memoryId))
      : entity.memoryLinks
  })).filter((entity) => !boundary || entity.memoryLinks.length > 0);

  if (normalizedMode === "redacted-summary") {
    const backup = buildRedactedSummary(entities);
    validateClueBackup(backup, []);
    return backup;
  }

  const backup = {
    mode: "full",
    schemaVersion: CLUE_SCHEMA_VERSION,
    entities: sortEntityGraph(entities)
  };
  const validationBoundary = boundary || new Set(backup.entities.flatMap((entity) => entity.memoryLinks.map((link) => link.memoryId)));
  validateClueBackup(backup, [...validationBoundary]);
  return backup;
}

function validateClueBackup(backup, sourceMemoryIds) {
  assertPlainObject(backup, "clue backup");
  if (backup.mode === "redacted-summary") return validateRedactedBackup(backup);
  assertExactKeys(backup, FULL_KEYS, "完整实体备份");
  if (backup.mode !== "full" || backup.schemaVersion !== CLUE_SCHEMA_VERSION) {
    throw backupError("完整实体备份的模式或 Schema 版本无效。", "CLUE_BACKUP_INVALID");
  }
  const allowedMemoryIds = normalizeIdBoundary(sourceMemoryIds, "sourceMemoryIds");
  const entities = requireArray(backup.entities, CLUE_BACKUP_LIMITS.entities, "entities");
  const entityIds = new Set();
  const aliasIds = new Set();
  let aliasCount = 0;
  let linkCount = 0;

  entities.forEach((entity, entityIndex) => {
    assertPlainObject(entity, `entities[${entityIndex}]`);
    assertExactKeys(entity, ENTITY_KEYS, `entities[${entityIndex}]`);
    const entityId = requireId(entity.id, `entities[${entityIndex}].id`);
    if (entityIds.has(entityId)) throw backupError("完整实体备份包含重复实体 ID。", "CLUE_BACKUP_DUPLICATE");
    entityIds.add(entityId);
    requireEnum(entity.type, ENTITY_TYPES, `entities[${entityIndex}].type`);
    requireText(entity.canonicalName, `entities[${entityIndex}].canonicalName`, 200, true);

    const aliases = requireArray(entity.aliases, CLUE_BACKUP_LIMITS.aliases, `entities[${entityIndex}].aliases`);
    aliasCount += aliases.length;
    if (aliasCount > CLUE_BACKUP_LIMITS.aliases) {
      throw backupError(`实体别名总数不能超过 ${CLUE_BACKUP_LIMITS.aliases}。`, "CLUE_BACKUP_LIMIT_EXCEEDED");
    }
    const normalizedAliases = new Set();
    aliases.forEach((alias, aliasIndex) => {
      const path = `entities[${entityIndex}].aliases[${aliasIndex}]`;
      assertPlainObject(alias, path);
      assertExactKeys(alias, ALIAS_KEYS, path);
      const aliasId = requireId(alias.id, `${path}.id`);
      if (aliasIds.has(aliasId)) throw backupError("完整实体备份包含重复别名 ID。", "CLUE_BACKUP_DUPLICATE");
      aliasIds.add(aliasId);
      const aliasText = requireText(alias.alias, `${path}.alias`, 200, true);
      const aliasKey = normalizedNameKey(aliasText);
      if (normalizedAliases.has(aliasKey)) throw backupError("同一实体不能包含重复别名。", "CLUE_BACKUP_DUPLICATE");
      normalizedAliases.add(aliasKey);
      requireEnum(alias.source, ALIAS_SOURCES, `${path}.source`);
      requireTimestamp(alias.confirmedAt, `${path}.confirmedAt`);
      requireTimestamp(alias.createdAt, `${path}.createdAt`);
      requireTimestamp(alias.updatedAt, `${path}.updatedAt`);
    });

    const memoryLinks = requireArray(entity.memoryLinks, CLUE_BACKUP_LIMITS.memoryLinks, `entities[${entityIndex}].memoryLinks`);
    linkCount += memoryLinks.length;
    if (linkCount > CLUE_BACKUP_LIMITS.memoryLinks) {
      throw backupError(`实体与展品关系总数不能超过 ${CLUE_BACKUP_LIMITS.memoryLinks}。`, "CLUE_BACKUP_LIMIT_EXCEEDED");
    }
    const linkedMemories = new Set();
    memoryLinks.forEach((link, linkIndex) => {
      const path = `entities[${entityIndex}].memoryLinks[${linkIndex}]`;
      assertPlainObject(link, path);
      assertExactKeys(link, LINK_KEYS, path);
      const memoryId = requireId(link.memoryId, `${path}.memoryId`);
      if (!allowedMemoryIds.has(memoryId)) {
        throw backupError("实体关系引用了备份边界之外的展品。", "CLUE_BACKUP_REFERENCE_INVALID");
      }
      if (linkedMemories.has(memoryId)) {
        throw backupError("同一实体不能重复关联同一件展品。", "CLUE_BACKUP_DUPLICATE");
      }
      linkedMemories.add(memoryId);
      requireEnum(link.sourceField, LINK_SOURCE_FIELDS, `${path}.sourceField`);
      requireText(link.mentionText, `${path}.mentionText`, 500, false);
      requireTimestamp(link.confirmedAt, `${path}.confirmedAt`);
      requireTimestamp(link.createdAt, `${path}.createdAt`);
      requireTimestamp(link.updatedAt, `${path}.updatedAt`);
    });
  });
  return true;
}

function remapClueBackup(backup, options = {}) {
  if (backup?.mode === "redacted-summary") {
    validateClueBackup(backup, []);
    return {
      backup: structuredClone(backup),
      idMap: { memories: {}, entities: {}, aliases: {} }
    };
  }
  assertPlainObject(options, "clue remap options");
  const sourceMemoryIds = [...new Set((Array.isArray(backup?.entities) ? backup.entities : [])
    .flatMap((entity) => (Array.isArray(entity?.memoryLinks) ? entity.memoryLinks : []))
    .map((link) => link?.memoryId))];
  validateClueBackup(backup, sourceMemoryIds);

  const memoryMap = normalizeIdMap(options.memoryIdMap, "memoryIdMap", true);
  const entityMap = normalizeIdMap(options.entityIdMap, "entityIdMap", false);
  const aliasMap = normalizeIdMap(options.aliasIdMap, "aliasIdMap", false);
  const occupiedEntityIds = normalizeOccupiedIds(options.occupiedEntityIds || options.existingEntityIds, "occupiedEntityIds");
  const occupiedAliasIds = normalizeOccupiedIds(options.occupiedAliasIds || options.existingAliasIds, "occupiedAliasIds");
  const mappedMemoryIds = mapRequiredIds(sourceMemoryIds, memoryMap, "展品", "CLUE_BACKUP_MAPPING_MISSING");
  const mappedEntityIds = mapOptionalIds(backup.entities.map((entity) => entity.id), entityMap, occupiedEntityIds, "实体");
  const sourceAliasIds = backup.entities.flatMap((entity) => entity.aliases.map((alias) => alias.id));
  const mappedAliasIds = mapOptionalIds(sourceAliasIds, aliasMap, occupiedAliasIds, "别名");

  const memoryTargets = assertUniqueTargets(mappedMemoryIds, "多个源展品不能映射到同一件目标展品。");
  assertUniqueTargets(mappedEntityIds, "多个源实体不能映射到同一个目标实体。");
  assertUniqueTargets(mappedAliasIds, "多个源别名不能映射到同一个目标别名。");

  const remapped = {
    mode: "full",
    schemaVersion: CLUE_SCHEMA_VERSION,
    entities: backup.entities.map((entity) => ({
      id: mappedEntityIds.get(entity.id),
      type: entity.type,
      canonicalName: entity.canonicalName,
      aliases: entity.aliases.map((alias) => ({
        id: mappedAliasIds.get(alias.id),
        alias: alias.alias,
        source: alias.source,
        confirmedAt: alias.confirmedAt,
        createdAt: alias.createdAt,
        updatedAt: alias.updatedAt
      })),
      memoryLinks: entity.memoryLinks.map((link) => ({
        memoryId: mappedMemoryIds.get(link.memoryId),
        sourceField: link.sourceField,
        mentionText: link.mentionText,
        confirmedAt: link.confirmedAt,
        createdAt: link.createdAt,
        updatedAt: link.updatedAt
      }))
    }))
  };
  remapped.entities = sortEntityGraph(remapped.entities);
  validateClueBackup(remapped, [...memoryTargets]);
  return {
    backup: remapped,
    idMap: {
      memories: Object.fromEntries(mappedMemoryIds),
      entities: Object.fromEntries(mappedEntityIds),
      aliases: Object.fromEntries(mappedAliasIds)
    }
  };
}

function buildEntityGraph(input) {
  assertPlainObject(input, "clue backup source");
  const sourceEntities = requireArray(input.entities, CLUE_BACKUP_LIMITS.entities, "entities");
  const flatAliases = input.aliases === undefined ? [] : requireArray(input.aliases, CLUE_BACKUP_LIMITS.aliases, "aliases");
  const flatLinks = input.memoryLinks === undefined ? [] : requireArray(input.memoryLinks, CLUE_BACKUP_LIMITS.memoryLinks, "memoryLinks");
  const entityIds = new Set();
  sourceEntities.forEach((entity, index) => {
    assertPlainObject(entity, `entities[${index}]`);
    const entityId = requireId(readValue(entity, "id"), `entities[${index}].id`);
    if (entityIds.has(entityId)) throw backupError("备份源包含重复实体 ID。", "CLUE_BACKUP_DUPLICATE");
    entityIds.add(entityId);
  });
  validateFlatReferences(flatAliases, entityIds, "alias");
  validateFlatReferences(flatLinks, entityIds, "memory link");

  return sourceEntities.map((entity, index) => {
    const id = requireId(readValue(entity, "id"), `entities[${index}].id`);
    const nestedAliases = Array.isArray(entity.aliases) ? entity.aliases : [];
    const nestedLinks = Array.isArray(entity.memoryLinks) ? entity.memoryLinks : [];
    return {
      id,
      type: readValue(entity, "type"),
      canonicalName: readValue(entity, "canonicalName", "canonical_name"),
      aliases: [...nestedAliases, ...flatAliases.filter((alias) => readValue(alias, "entityId", "entity_id") === id)].map(toPublicAlias),
      memoryLinks: [...nestedLinks, ...flatLinks.filter((link) => readValue(link, "entityId", "entity_id") === id)].map(toPublicMemoryLink)
    };
  });
}

function toPublicAlias(alias) {
  assertPlainObject(alias, "alias");
  return {
    id: readValue(alias, "id"),
    alias: readValue(alias, "alias"),
    source: readValue(alias, "source"),
    confirmedAt: readValue(alias, "confirmedAt", "confirmed_at"),
    createdAt: readValue(alias, "createdAt", "created_at"),
    updatedAt: readValue(alias, "updatedAt", "updated_at")
  };
}

function toPublicMemoryLink(link) {
  assertPlainObject(link, "memory link");
  return {
    memoryId: readValue(link, "memoryId", "memory_id"),
    sourceField: readValue(link, "sourceField", "source_field"),
    mentionText: readValue(link, "mentionText", "mention_text") ?? "",
    confirmedAt: readValue(link, "confirmedAt", "confirmed_at"),
    createdAt: readValue(link, "createdAt", "created_at"),
    updatedAt: readValue(link, "updatedAt", "updated_at")
  };
}

function buildRedactedSummary(entities) {
  const counts = { person: 0, location: 0, theme: 0 };
  entities.forEach((entity) => {
    if (Object.hasOwn(counts, entity.type)) counts[entity.type] += 1;
  });
  return {
    mode: "redacted-summary",
    entityCount: entities.length,
    personCount: counts.person,
    locationCount: counts.location,
    themeCount: counts.theme,
    note: REDACTED_NOTE
  };
}

function validateRedactedBackup(backup) {
  assertExactKeys(backup, REDACTED_KEYS, "脱敏实体摘要");
  if (backup.mode !== "redacted-summary" || backup.note !== REDACTED_NOTE) {
    throw backupError("脱敏实体摘要的模式或固定说明无效。", "CLUE_BACKUP_INVALID");
  }
  const entityCount = requireCount(backup.entityCount, "entityCount");
  const personCount = requireCount(backup.personCount, "personCount");
  const locationCount = requireCount(backup.locationCount, "locationCount");
  const themeCount = requireCount(backup.themeCount, "themeCount");
  if (entityCount > CLUE_BACKUP_LIMITS.entities || personCount + locationCount + themeCount !== entityCount) {
    throw backupError("脱敏实体摘要的计数无效。", "CLUE_BACKUP_INVALID");
  }
  return true;
}

function sortEntityGraph(entities) {
  return entities.map((entity) => ({
    ...entity,
    aliases: [...entity.aliases].sort((left, right) => left.id.localeCompare(right.id, "en")),
    memoryLinks: [...entity.memoryLinks].sort((left, right) => (
      left.memoryId.localeCompare(right.memoryId, "en") || left.sourceField.localeCompare(right.sourceField, "en")
    ))
  })).sort((left, right) => left.id.localeCompare(right.id, "en"));
}

function mapRequiredIds(sourceIds, mapping, label, missingCode) {
  const output = new Map();
  sourceIds.forEach((sourceId) => {
    if (!mapping.has(sourceId)) throw backupError(`${label}恢复缺少 ID 映射。`, missingCode);
    output.set(sourceId, requireId(mapping.get(sourceId), `${label} target ID`));
  });
  return output;
}

function mapOptionalIds(sourceIds, mapping, occupied, label) {
  const output = new Map();
  sourceIds.forEach((sourceId) => {
    const targetId = requireId(mapping.has(sourceId) ? mapping.get(sourceId) : sourceId, `${label} target ID`);
    if (occupied.has(targetId)) throw backupError(`${label}目标 ID 已存在，恢复计划会发生碰撞。`, "CLUE_BACKUP_ID_COLLISION", 409);
    output.set(sourceId, targetId);
  });
  return output;
}

function assertUniqueTargets(mapping, message) {
  const targets = new Set();
  mapping.forEach((target) => {
    if (targets.has(target)) throw backupError(message, "CLUE_BACKUP_MAPPING_COLLISION", 409);
    targets.add(target);
  });
  return targets;
}

function normalizeIdMap(value, name, required) {
  if (value instanceof Map) return new Map(value);
  if (value && typeof value === "object" && !Array.isArray(value)) return new Map(Object.entries(value));
  if (!required && (value === undefined || value === null)) return new Map();
  throw backupError(`${name} 必须是 Map 或普通对象。`, "CLUE_BACKUP_MAPPING_INVALID");
}

function normalizeOccupiedIds(value, name) {
  if (value === undefined || value === null) return new Set();
  const entries = value instanceof Set ? [...value] : value;
  if (!Array.isArray(entries)) throw backupError(`${name} 必须是数组或 Set。`, "CLUE_BACKUP_MAPPING_INVALID");
  return new Set(entries.map((id) => requireId(id, name)));
}

function normalizeIdBoundary(value, name) {
  if (!Array.isArray(value)) throw backupError(`${name} 必须是展品 ID 数组。`, "CLUE_BACKUP_REFERENCE_INVALID");
  const output = new Set();
  value.forEach((id) => {
    const normalized = requireId(id, name);
    if (output.has(normalized)) throw backupError(`${name} 不能包含重复展品 ID。`, "CLUE_BACKUP_DUPLICATE");
    output.add(normalized);
  });
  return output;
}

function validateFlatReferences(rows, entityIds, label) {
  rows.forEach((row, index) => {
    assertPlainObject(row, `${label}[${index}]`);
    const entityId = requireId(readValue(row, "entityId", "entity_id"), `${label}[${index}].entityId`);
    if (!entityIds.has(entityId)) throw backupError(`${label} 引用了不存在的实体。`, "CLUE_BACKUP_REFERENCE_INVALID");
  });
}

function assertExactKeys(value, allowedKeys, name) {
  const actual = Object.keys(value).sort();
  const expected = [...allowedKeys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw backupError(`${name} 包含缺失或未允许的字段。`, "CLUE_BACKUP_INVALID");
  }
}

function assertPlainObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw backupError(`${name} 必须是对象。`, "CLUE_BACKUP_INVALID");
  }
}

function requireArray(value, maximum, name) {
  if (!Array.isArray(value) || value.length > maximum) {
    throw backupError(`${name} 必须是数组且最多包含 ${maximum} 项。`, "CLUE_BACKUP_LIMIT_EXCEEDED");
  }
  return value;
}

function requireId(value, name) {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    throw backupError(`${name} 无效。`, "CLUE_BACKUP_INVALID");
  }
  return value;
}

function requireText(value, name, maximum, required) {
  if (typeof value !== "string" || value !== value.trim() || value.includes("\u0000") || [...value].length > maximum || (required && !value)) {
    throw backupError(`${name} 格式无效或超过 ${maximum} 个字符。`, "CLUE_BACKUP_INVALID");
  }
  return value;
}

function requireEnum(value, allowed, name) {
  if (typeof value !== "string" || !allowed.has(value)) {
    throw backupError(`${name} 不在允许范围内。`, "CLUE_BACKUP_INVALID");
  }
  return value;
}

function requireTimestamp(value, name) {
  if (typeof value !== "string" || value.length < 1 || value.length > 40 || !Number.isFinite(Date.parse(value))) {
    throw backupError(`${name} 必须是有效时间戳。`, "CLUE_BACKUP_INVALID");
  }
  return value;
}

function requireCount(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) throw backupError(`${name} 必须是非负整数。`, "CLUE_BACKUP_INVALID");
  return value;
}

function readValue(value, ...names) {
  for (const name of names) {
    if (Object.hasOwn(value, name)) return value[name];
  }
  return undefined;
}

function normalizedNameKey(value) {
  return String(value).normalize("NFKC").replace(/\s+/gu, " ").trim().toLowerCase();
}

function normalizeMode(value) {
  if (value === "full") return "full";
  if (value === "redacted" || value === "redacted-summary") return "redacted-summary";
  throw backupError("实体备份模式必须是 full 或 redacted。", "CLUE_BACKUP_MODE_INVALID");
}

function backupError(message, code, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

module.exports = {
  CLUE_BACKUP_LIMITS,
  CLUE_REDACTED_NOTE: REDACTED_NOTE,
  CLUE_SCHEMA_VERSION,
  buildClueBackup,
  remapClueBackup,
  validateClueBackup
};
