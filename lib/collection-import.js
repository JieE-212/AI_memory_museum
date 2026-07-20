"use strict";

const {
  referencedOralVoiceAssetIds,
  validateOralHistoryArchiveEnvelope
} = require("./oral-history-backup");
const { validateCuratorAgentArchiveState } = require("./curator-agent-backup");

const COLLECTION_ROOT_KEYS = new Set([
  "archaeology", "capsules", "coMemoryResponses", "count", "entities", "exhibitions", "exportedAt",
  "memories", "memoryInbox", "mode", "privacy", "product", "productEnglish", "provenance", "revisitIntents",
  "curatorAgent", "oralHistories", "revisions", "revisits", "schemaVersion", "timeCalibrations", "version", "voices"
]);

function createCollectionImporter({
  store,
  normalizeMemory,
  sanitizeId,
  createId,
  validateArchaeologyBackup,
  restoreArchaeologyBackup,
  httpError,
  schemaVersion = 7,
  maxMemories = 500
}) {
  if (
    !store ||
    typeof store.listMemories !== "function" ||
    typeof store.importMemories !== "function" ||
    typeof store.deleteMemory !== "function" ||
    typeof store.withTransaction !== "function" ||
    typeof store.validateExhibitionBackup !== "function" ||
    typeof store.restoreExhibitionBackup !== "function" ||
    typeof store.validateRevisitBackup !== "function" ||
    typeof store.restoreRevisitBackup !== "function" ||
    typeof store.validateClueBackup !== "function" ||
    typeof store.restoreClueBackup !== "function" ||
    (schemaVersion >= 8 && typeof store.validateVoiceBackup !== "function") ||
    (schemaVersion >= 9 && typeof store.validateCapsuleBackup !== "function") ||
    (schemaVersion >= 10 && (
      typeof store.validateRevisionBackup !== "function" ||
      typeof store.restoreRevisionBackup !== "function"
    )) ||
    (schemaVersion >= 11 && (
      typeof store.validateRevisitIntentBackup !== "function" ||
      typeof store.restoreRevisitIntentBackup !== "function"
    )) ||
    (schemaVersion >= 12 && (
      typeof store.validateTimeCalibrationBackup !== "function" ||
      typeof store.restoreTimeCalibrationBackup !== "function"
    )) ||
    (schemaVersion >= 13 && typeof store.validateOralHistoryBackup !== "function") ||
    (schemaVersion >= 14 && (
      typeof store.validateCuratorAgentBackup !== "function" ||
      typeof store.restoreCuratorAgentBackup !== "function"
    )) ||
    (schemaVersion >= 15 && (
      typeof store.validateMemoryInboxBackup !== "function" ||
      typeof store.restoreMemoryInboxBackup !== "function"
    )) ||
    (schemaVersion >= 16 && (
      typeof store.validateProvenanceBackup !== "function" ||
      typeof store.restoreProvenanceBackup !== "function"
    )) ||
    (schemaVersion >= 17 && (
      typeof store.validateCoMemoryResponseBackup !== "function" ||
      typeof store.restoreCoMemoryResponseBackup !== "function"
    )) ||
    typeof normalizeMemory !== "function" ||
    typeof sanitizeId !== "function" ||
    typeof createId !== "function" ||
    typeof validateArchaeologyBackup !== "function" ||
    typeof restoreArchaeologyBackup !== "function" ||
    typeof httpError !== "function" ||
    !Number.isSafeInteger(schemaVersion) ||
    schemaVersion < 7 ||
    !Number.isSafeInteger(maxMemories) ||
    maxMemories < 1
  ) {
    throw new TypeError("Collection importer dependencies are required.");
  }

  return function importCollection(body) {
    const objectBody = isObjectRecord(body) ? body : null;
    const incoming = Array.isArray(body) ? body : objectBody?.memories;
    if (!Array.isArray(incoming)) throw httpError(400, "memories 数组不能为空。");
    if (incoming.length > maxMemories) {
      throw httpError(400, `一次最多导入 ${maxMemories} 件展品，请拆分后重试。`);
    }

    const envelope = inspectCollectionEnvelope(objectBody, schemaVersion, httpError);
    assertCollectionRootKeys(objectBody, envelope, httpError);

    const backupArchaeology = objectBody?.archaeology;
    const backupExhibitions = objectBody?.exhibitions;
    const backupRevisits = objectBody?.revisits;
    const backupEntities = objectBody?.entities;
    const backupVoices = objectBody?.voices;
    const backupCapsules = objectBody?.capsules;
    const backupRevisions = objectBody?.revisions;
    const backupRevisitIntents = objectBody?.revisitIntents;
    const backupTimeCalibrations = objectBody?.timeCalibrations;
    const backupOralHistories = objectBody?.oralHistories;
    const backupCuratorAgent = objectBody?.curatorAgent;
    const backupMemoryInbox = objectBody?.memoryInbox;
    const backupProvenance = objectBody?.provenance;
    const backupCoMemoryResponses = objectBody?.coMemoryResponses;
    assertEntityEnvelope(envelope, backupEntities, httpError);
    assertVoiceEnvelope(envelope, backupVoices, httpError);
    assertCapsuleEnvelope(envelope, backupCapsules, httpError);
    assertRevisionEnvelope(envelope, backupRevisions, httpError);
    assertRevisitIntentEnvelope(envelope, backupRevisitIntents, httpError);
    assertTimeCalibrationEnvelope(envelope, backupTimeCalibrations, httpError);
    assertOralHistoryEnvelope(envelope, backupOralHistories, httpError);
    assertCuratorAgentEnvelope(envelope, backupCuratorAgent, httpError);
    assertMemoryInboxEnvelope(envelope, backupMemoryInbox, httpError);
    assertProvenanceEnvelope(envelope, backupProvenance, httpError);
    assertCoMemoryResponseEnvelope(envelope, backupCoMemoryResponses, httpError);
    const featureBackups = [
      backupArchaeology, backupExhibitions, backupRevisits, backupEntities,
      backupVoices, backupCapsules, backupRevisions, backupRevisitIntents,
      backupTimeCalibrations, backupOralHistories, backupCuratorAgent, backupMemoryInbox, backupProvenance,
      backupCoMemoryResponses
    ];
    const sourceMemoryIds = incoming.map((memory) => sanitizeId(memory?.id)).filter(Boolean);
    const sourceEventIds = Array.isArray(backupArchaeology?.events)
      ? backupArchaeology.events.map((event) => sanitizeId(event?.id)).filter(Boolean)
      : [];
    const sourceExhibitionIds = Array.isArray(backupExhibitions?.exhibitions)
      ? backupExhibitions.exhibitions.map((exhibition) => sanitizeId(exhibition?.id)).filter(Boolean)
      : [];
    let oralVoiceAssetIds = [];
    if (backupOralHistories !== null && backupOralHistories !== undefined) {
      try {
        validateOralHistoryArchiveEnvelope(backupOralHistories, envelope.mode);
        oralVoiceAssetIds = referencedOralVoiceAssetIds(backupOralHistories);
      } catch (error) {
        throw httpError(400, `口述史备份无法恢复：${errorMessage(error)}`);
      }
    }
    if (featureBackups.some(isReferenceBearingBackup) && hasDuplicates(sourceMemoryIds)) {
      throw httpError(400, "带关系数据的备份不能包含重复展品 ID。");
    }

    validateFeatureBackup({
      backup: backupArchaeology,
      validate: (value) => validateArchaeologyBackup(value, sourceMemoryIds),
      label: "记忆考古",
      httpError
    });
    validateFeatureBackup({
      backup: backupExhibitions,
      validate: (value) => store.validateExhibitionBackup(value, sourceMemoryIds),
      label: "主题展览",
      httpError
    });
    validateFeatureBackup({
      backup: backupRevisits,
      validate: (value) => store.validateRevisitBackup(value, sourceMemoryIds),
      label: "记忆回访",
      httpError
    });
    validateFeatureBackup({
      backup: backupEntities,
      validate: (value) => store.validateClueBackup(value, sourceMemoryIds),
      label: "实体线索",
      httpError
    });
    validateFeatureBackup({
      backup: backupVoices,
      validate: (value) => store.validateVoiceBackup(value, sourceMemoryIds, { additionalAssetIds: oralVoiceAssetIds }),
      label: "声音",
      httpError
    });
    validateFeatureBackup({
      backup: backupCapsules,
      validate: (value) => store.validateCapsuleBackup(value),
      label: "时光胶囊",
      httpError
    });
    validateFeatureBackup({
      backup: backupRevisions,
      validate: (value) => store.validateRevisionBackup(value, sourceMemoryIds),
      label: "记忆年轮",
      httpError
    });
    validateFeatureBackup({
      backup: backupRevisitIntents,
      validate: (value) => store.validateRevisitIntentBackup(value, sourceMemoryIds),
      label: "回访意愿",
      httpError
    });
    validateFeatureBackup({
      backup: backupTimeCalibrations,
      validate: (value) => store.validateTimeCalibrationBackup(value, sourceMemoryIds, sourceEventIds),
      label: "时间校准",
      httpError
    });
    validateFeatureBackup({
      backup: backupOralHistories,
      validate: (value) => store.validateOralHistoryBackup(value, {
        eventIds: sourceEventIds,
        voiceAssetIds: Array.isArray(backupVoices?.assets)
          ? backupVoices.assets.map((asset) => asset?.id).filter(Boolean)
          : []
      }),
      label: "口述史",
      httpError
    });
    validateFeatureBackup({
      backup: backupCuratorAgent,
      validate: (value) => {
        validateCuratorAgentArchiveState(value, {
          mode: envelope.mode,
          memoryIds: sourceMemoryIds,
          eventIds: sourceEventIds,
          exhibitionIds: sourceExhibitionIds
        });
        return store.validateCuratorAgentBackup(value);
      },
      label: "受限策展助手",
      httpError
    });
    validateFeatureBackup({
      backup: backupMemoryInbox,
      validate: (value) => store.validateMemoryInboxBackup(value, sourceMemoryIds),
      label: "记忆收件箱",
      httpError
    });
    validateFeatureBackup({
      backup: backupProvenance,
      validate: (value) => store.validateProvenanceBackup(value, sourceMemoryIds),
      label: "来源护照",
      httpError
    });
    validateFeatureBackup({
      backup: backupCoMemoryResponses,
      validate: (value) => store.validateCoMemoryResponseBackup(value, sourceMemoryIds),
      label: "共忆回信",
      httpError
    });

    if (requiresFullTimeIsleForOralHistory(envelope, backupOralHistories)) {
      return buildOralHistoryTimeIslePreflight({
        archaeology: backupArchaeology,
        exhibitions: backupExhibitions,
        revisits: backupRevisits,
        entities: backupEntities,
        voices: backupVoices,
        capsules: backupCapsules,
        revisions: backupRevisions,
        revisitIntents: backupRevisitIntents,
        timeCalibrations: backupTimeCalibrations,
        oralHistories: backupOralHistories,
        curatorAgent: backupCuratorAgent,
        memoryInbox: backupMemoryInbox,
        provenance: backupProvenance,
        coMemoryResponses: backupCoMemoryResponses
      });
    }

    const existingIds = new Set(store.listMemories().map((memory) => sanitizeId(memory?.id)).filter(Boolean));
    const preExistingIds = new Set(existingIds);
    const memoryIdMap = new Map();
    const normalized = incoming.map((memory, index) => {
      const sourceId = sanitizeId(memory?.id);
      let normalizedItem;
      try {
        normalizedItem = normalizeMemory(memory);
      } catch (error) {
        throw httpError(400, `第 ${index + 1} 件展品无法导入：${errorMessage(error)}`);
      }
      if (!isObjectRecord(normalizedItem)) {
        throw httpError(400, `第 ${index + 1} 件展品无法导入：规范化结果无效。`);
      }
      const item = { ...normalizedItem };
      // JSON backups omit Agent run tables, so imported copies must not inherit
      // a foreign reference that could point at an unrelated local run.
      item.agentRunId = "";
      try {
        item.id = claimMemoryId(item.id, existingIds, sanitizeId, createId);
      } catch (error) {
        throw httpError(400, `第 ${index + 1} 件展品无法分配安全 ID：${errorMessage(error)}`);
      }
      existingIds.add(item.id);
      if (sourceId) memoryIdMap.set(sourceId, item.id);
      return item;
    });

    let result;
    try {
      let archaeology;
      let exhibitions;
      let revisits;
      let entities;
      let voices;
      let capsules;
      let revisions;
      let revisitIntents;
      let timeCalibrations;
      let oralHistories;
      let curatorAgent;
      let memoryInbox;
      let coMemoryResponses;
      let provenance;
      store.withTransaction(() => {
        result = store.importMemories(normalized, {
          clueMode: envelope.clueMode,
          revisionMode: backupRevisions?.mode === "full" ? "defer" : "imported"
        });
        revisions = backupRevisions?.mode === "full"
          ? store.restoreRevisionBackup(backupRevisions, memoryIdMap)
          : emptyRevisionImportResult(backupRevisions);
        if (revisions.skipped) throw new Error(`${revisions.skipped} 条记忆修订未能恢复。`);
        memoryInbox = backupMemoryInbox?.mode === "full"
          ? store.restoreMemoryInboxBackup(backupMemoryInbox, { memoryIdMap })
          : emptyMemoryInboxImportResult(backupMemoryInbox);
        if (memoryInbox.skipped) throw new Error(`${memoryInbox.skipped} 条收件箱记录未能恢复。`);
        coMemoryResponses = backupCoMemoryResponses?.mode === "full"
          ? store.restoreCoMemoryResponseBackup(backupCoMemoryResponses, { memoryIdMap })
          : emptyCoMemoryResponseImportResult(backupCoMemoryResponses);
        if (coMemoryResponses.skipped) throw new Error(`${coMemoryResponses.skipped} 封共忆回信未能恢复。`);
        provenance = backupProvenance?.mode === "full"
          ? store.restoreProvenanceBackup(backupProvenance, { memoryIdMap })
          : emptyProvenanceImportResult(backupProvenance);
        if (provenance.skipped) throw new Error(`${provenance.skipped} 条来源主张未能恢复。`);
        archaeology = backupArchaeology
          ? restoreArchaeologyBackup(store, backupArchaeology, memoryIdMap)
          : emptyArchaeologyResult();
        if (archaeology.skipped) throw new Error(`${archaeology.skipped} 项关系数据未能恢复。`);

        timeCalibrations = backupTimeCalibrations?.mode === "full"
          ? store.restoreTimeCalibrationBackup(backupTimeCalibrations, {
              memoryIdMap,
              eventIdMap: new Map(Object.entries(archaeology.idMap?.events || {})),
              sourceMode: "json"
            })
          : emptyTimeCalibrationImportResult(backupTimeCalibrations);
        if (timeCalibrations.skipped && !timeCalibrations.requiresTimeIsle) {
          throw new Error(`${timeCalibrations.skipped} 项时间校准未能恢复。`);
        }

        exhibitions = backupExhibitions
          ? store.restoreExhibitionBackup(backupExhibitions, memoryIdMap)
          : { exhibitions: 0, skipped: 0, idMap: {} };
        if (exhibitions.skipped) throw new Error(`${exhibitions.skipped} 场主题展览未能恢复。`);

        curatorAgent = backupCuratorAgent?.mode === "full"
          ? normalizeCuratorAgentRestoreResult(store.restoreCuratorAgentBackup(backupCuratorAgent, {
              memoryIdMap,
              eventIdMap: new Map(Object.entries(archaeology.idMap?.events || {})),
              exhibitionIdMap: new Map(Object.entries(exhibitions.idMap || {})),
              createId
            }), backupCuratorAgent)
          : emptyCuratorAgentImportResult(backupCuratorAgent);
        if (curatorAgent.skipped) throw new Error(`${curatorAgent.skipped} 项受限策展运行未能恢复。`);

        revisits = backupRevisits
          ? store.restoreRevisitBackup(backupRevisits, memoryIdMap)
          : { states: 0, skipped: 0, idMap: {} };
        if (revisits.skipped) throw new Error(`${revisits.skipped} 条回访状态未能恢复。`);

        revisitIntents = backupRevisitIntents?.mode === "full"
          ? store.restoreRevisitIntentBackup(backupRevisitIntents, memoryIdMap)
          : emptyRevisitIntentImportResult(backupRevisitIntents);
        if (revisitIntents.skipped) throw new Error(`${revisitIntents.skipped} 条回访意愿未能恢复。`);

        entities = backupEntities?.mode === "full"
          ? store.restoreClueBackup(backupEntities, memoryIdMap)
          : emptyEntityResult();
        if (entities.skipped) throw new Error(`${entities.skipped} 条实体线索未能恢复。`);
        voices = emptyVoiceImportResult(backupVoices);
        oralHistories = emptyOralHistoryImportResult(backupOralHistories);
        capsules = emptyCapsuleImportResult(backupCapsules);
      });

      return {
        imported: result.imported,
        memories: result.memories,
        archaeology,
        exhibitions,
        revisits,
        entities,
        voices,
        oralHistories,
        curatorAgent,
        memoryInbox,
        coMemoryResponses,
        provenance,
        capsules,
        revisions,
        revisitIntents,
        timeCalibrations
      };
    } catch (error) {
      compensateNewMemories(store, normalized, preExistingIds);
      throw httpError(400, `导入已取消，未保留不完整数据：${errorMessage(error)}`);
    }
  };
}

function inspectCollectionEnvelope(body, currentSchemaVersion, httpError) {
  if (!body) return { schemaVersion: 0, mode: "full", clueMode: "derive" };
  const hasSchemaVersion = Object.hasOwn(body, "schemaVersion");
  const declaredSchemaVersion = hasSchemaVersion ? body.schemaVersion : 0;
  if (hasSchemaVersion && (!Number.isSafeInteger(declaredSchemaVersion) || declaredSchemaVersion < 1)) {
    throw httpError(400, "schemaVersion 必须是正整数。");
  }
  if (declaredSchemaVersion > currentSchemaVersion) {
    throw httpError(400, `备份 schema ${declaredSchemaVersion} 高于当前支持的 schema ${currentSchemaVersion}，请先升级应用。`);
  }
  const mode = body.mode === undefined ? "full" : body.mode;
  if (!['full', 'redacted'].includes(mode)) throw httpError(400, "备份 mode 只能是 full 或 redacted。");
  return {
    schemaVersion: declaredSchemaVersion,
    mode,
    clueMode: mode === "redacted" ? "none" : declaredSchemaVersion >= 7 ? "defer" : "derive"
  };
}

function assertCollectionRootKeys(body, envelope, httpError) {
  if (!body) return;
  const unknown = Object.keys(body).filter((key) => !COLLECTION_ROOT_KEYS.has(key));
  if (unknown.length) {
    throw httpError(400, `备份包含当前 schema 不支持的根字段：${unknown.join(", ")}。`);
  }
  const gated = [
    ["entities", 7],
    ["voices", 8],
    ["capsules", 9],
    ["revisions", 10],
    ["revisitIntents", 11],
    ["timeCalibrations", 12],
    ["oralHistories", 13],
    ["curatorAgent", 14],
    ["memoryInbox", 15],
    ["provenance", 16],
    ["coMemoryResponses", 17]
  ];
  for (const [key, since] of gated) {
    if (Object.hasOwn(body, key) && envelope.schemaVersion < since) {
      throw httpError(400, `${key} 数据只能由 schema ${since} 或更高版本的备份声明。`);
    }
  }
}

function assertEntityEnvelope(envelope, backup, httpError) {
  if (envelope.schemaVersion < 7) {
    if (backup !== null && backup !== undefined) {
      throw httpError(400, "实体线索数据只能由 schema 7 或更高版本的备份声明。");
    }
    return;
  }
  if (envelope.mode === "full" && (backup === null || backup === undefined)) {
    throw httpError(400, "完整 schema 7 备份缺少必需的 entities 实体线索数据。");
  }
  if (backup === null || backup === undefined) return;
  if (envelope.mode === "full" && backup.mode !== "full") {
    throw httpError(400, "完整 schema 7 备份必须包含完整实体线索数据。");
  }
  if (envelope.mode === "redacted" && backup.mode !== "redacted-summary") {
    throw httpError(400, "脱敏备份只能包含不带名称与关系的实体线索摘要。");
  }
}

function assertVoiceEnvelope(envelope, backup, httpError) {
  if (envelope.schemaVersion < 8) {
    if (backup !== null && backup !== undefined) throw httpError(400, "声音数据只能由 schema 8 或更高版本的备份声明。");
    return;
  }
  if (envelope.mode === "full" && (backup === null || backup === undefined)) {
    throw httpError(400, "完整 schema 8 备份缺少必需的 voices 声音数据。 ");
  }
  if (backup === null || backup === undefined) return;
  if (envelope.mode === "full" && backup.mode !== "full") {
    throw httpError(400, "完整 schema 8 备份必须包含完整声音索引。");
  }
  if (envelope.mode === "redacted" && backup.mode !== "redacted-summary") {
    throw httpError(400, "脱敏备份只能包含不带声音、文字稿、名称、哈希和 ID 的声音摘要。");
  }
}

function assertCapsuleEnvelope(envelope, backup, httpError) {
  if (envelope.schemaVersion < 9) {
    if (backup !== null && backup !== undefined) throw httpError(400, "时间胶囊数据只能由 schema 9 或更高版本的备份声明。");
    return;
  }
  if (envelope.mode === "full" && (backup === null || backup === undefined)) {
    throw httpError(400, "完整 schema 9 备份缺少必需的 capsules 时间胶囊数据。");
  }
  if (backup === null || backup === undefined) return;
  if (envelope.mode === "full" && backup.mode !== "full") {
    throw httpError(400, "完整 schema 9 备份必须包含完整时间胶囊索引。");
  }
  if (envelope.mode === "redacted" && backup.mode !== "redacted-summary") {
    throw httpError(400, "脱敏备份只能包含不带标题、日期、内容、来源和 ID 的时间胶囊摘要。");
  }
}

function assertRevisionEnvelope(envelope, backup, httpError) {
  if (envelope.schemaVersion < 10) {
    if (backup !== null && backup !== undefined) throw httpError(400, "记忆修订数据只能由 schema 10 或更高版本的备份声明。");
    return;
  }
  if (envelope.mode === "full" && (backup === null || backup === undefined)) {
    throw httpError(400, "完整 schema 10 备份缺少必需的 revisions 记忆修订数据。");
  }
  if (backup === null || backup === undefined) return;
  if (envelope.mode === "full" && backup.mode !== "full") {
    throw httpError(400, "完整 schema 10 备份必须包含完整记忆修订数据。");
  }
  if (envelope.mode === "redacted" && backup.mode !== "redacted-summary") {
    throw httpError(400, "脱敏备份只能包含不带正文、哈希、时间和内部 ID 的修订计数摘要。");
  }
}

function assertRevisitIntentEnvelope(envelope, backup, httpError) {
  if (envelope.schemaVersion < 11) {
    if (backup !== null && backup !== undefined) {
      throw httpError(400, "回访意愿数据只能由 schema 11 或更高版本的备份声明。");
    }
    return;
  }
  if (envelope.mode === "full" && (backup === null || backup === undefined)) {
    throw httpError(400, "完整 schema 11 备份缺少必需的 revisitIntents 回访意愿数据。");
  }
  if (backup === null || backup === undefined) return;
  if (envelope.mode === "full" && backup.mode !== "full") {
    throw httpError(400, "完整 schema 11 备份必须包含完整回访意愿数据。");
  }
  if (envelope.mode === "redacted" && backup.mode !== "redacted-summary") {
    throw httpError(400, "脱敏备份只能包含不带展品 ID、选择、日期、时区和时间的回访意愿计数摘要。");
  }
}

function assertTimeCalibrationEnvelope(envelope, backup, httpError) {
  if (envelope.schemaVersion < 12) {
    if (backup !== null && backup !== undefined) {
      throw httpError(400, "时间校准数据只能由 schema 12 或更高版本的备份声明。");
    }
    return;
  }
  if (envelope.mode === "full" && (backup === null || backup === undefined)) {
    throw httpError(400, "完整 schema 12 备份缺少必需的 timeCalibrations 时间校准数据。");
  }
  if (backup === null || backup === undefined) return;
  if (envelope.mode === "full" && backup.mode !== "full") {
    throw httpError(400, "完整 schema 12 备份必须包含完整时间校准数据。");
  }
  if (envelope.mode === "redacted" && backup.mode !== "redacted-summary") {
    throw httpError(400, "脱敏备份只能包含不带日期、来源、备注、内部 ID 与校准哈希的时间校准计数摘要。");
  }
}

function assertOralHistoryEnvelope(envelope, backup, httpError) {
  if (envelope.schemaVersion < 13) {
    if (backup !== null && backup !== undefined) {
      throw httpError(400, "口述史数据只能由 schema 13 或更高版本的备份声明。");
    }
    return;
  }
  if (envelope.mode === "full" && (backup === null || backup === undefined)) {
    throw httpError(400, "完整 schema 13 备份缺少必需的 oralHistories 口述史数据。");
  }
  if (backup === null || backup === undefined) return;
  if (envelope.mode === "full" && backup.mode !== "full") {
    throw httpError(400, "完整 schema 13 备份必须包含完整口述史数据。");
  }
  if (envelope.mode === "redacted" && backup.mode !== "redacted-summary") {
    throw httpError(400, "脱敏备份只能包含不带问题、回答、声音片段、文字稿、日期、ID 与哈希的口述史摘要。");
  }
}

function assertCuratorAgentEnvelope(envelope, backup, httpError) {
  if (envelope.schemaVersion < 14) {
    if (backup !== null && backup !== undefined) {
      throw httpError(400, "受限策展助手数据只能由 schema 14 或更高版本的备份声明。");
    }
    return;
  }
  if (envelope.mode === "full" && (backup === null || backup === undefined)) {
    throw httpError(400, "完整 schema 14 备份缺少必需的 curatorAgent 受限策展审计数据。");
  }
  if (backup === null || backup === undefined) return;
  if (envelope.mode === "full" && backup.mode !== "full") {
    throw httpError(400, "完整 schema 14 备份必须包含完整受限策展审计数据。");
  }
  if (envelope.mode === "redacted" && backup.mode !== "redacted-summary") {
    throw httpError(400, "脱敏备份只能包含不带请求、工具回执、提案、决定、ID、哈希与时间的受限策展计数摘要。");
  }
}

function assertMemoryInboxEnvelope(envelope, backup, httpError) {
  if (envelope.schemaVersion < 15) {
    if (backup !== null && backup !== undefined) {
      throw httpError(400, "记忆收件箱数据只能由 schema 15 或更高版本的备份声明。");
    }
    return;
  }
  if (envelope.mode === "full" && (backup === null || backup === undefined)) {
    throw httpError(400, "完整 schema 15 备份缺少必需的 memoryInbox 来源回执数据。");
  }
  if (backup === null || backup === undefined) return;
  if (envelope.mode === "full" && backup.mode !== "full") {
    throw httpError(400, "完整 schema 15 备份必须包含完整记忆收件箱来源回执。");
  }
  if (envelope.mode === "redacted" && backup.mode !== "redacted-summary") {
    throw httpError(400, "脱敏备份只能包含不带文件名、哈希、摘录、区间、ID 与展品关联的收件箱计数摘要。");
  }
}

function assertProvenanceEnvelope(envelope, backup, httpError) {
  if (envelope.schemaVersion < 16) {
    if (backup !== null && backup !== undefined) {
      throw httpError(400, "来源护照数据只能由 schema 16 或更高版本的备份声明。");
    }
    return;
  }
  if (envelope.mode === "full" && (backup === null || backup === undefined)) {
    throw httpError(400, "完整 schema 16 备份缺少必需的 provenance 来源护照数据。");
  }
  if (backup === null || backup === undefined) return;
  if (envelope.mode === "full" && backup.mode !== "full") {
    throw httpError(400, "完整 schema 16 备份必须包含完整来源护照与人工主张事件链。");
  }
  if (envelope.mode === "redacted" && backup.mode !== "redacted-summary") {
    throw httpError(400, "脱敏备份只能包含不带主张、摘录、定位、ID 与哈希的来源护照计数摘要。");
  }
}

function assertCoMemoryResponseEnvelope(envelope, backup, httpError) {
  if (envelope.schemaVersion < 17) {
    if (backup !== null && backup !== undefined) {
      throw httpError(400, "共忆回信数据只能由 schema 17 或更高版本的备份声明。");
    }
    return;
  }
  if (envelope.mode === "full" && (backup === null || backup === undefined)) {
    throw httpError(400, "完整 schema 17 备份缺少必需的 coMemoryResponses 共忆回信数据。");
  }
  if (backup === null || backup === undefined) return;
  if (envelope.mode === "full" && backup.mode !== "full") {
    throw httpError(400, "完整 schema 17 备份必须包含完整共忆回信。");
  }
  if (envelope.mode === "redacted" && backup.mode !== "redacted-summary") {
    throw httpError(400, "脱敏备份只能包含不带问题、回答、身份、展品 ID、信笺 ID 或哈希的共忆回信计数摘要。");
  }
}

function validateFeatureBackup({ backup, validate, label, httpError }) {
  if (backup === null || backup === undefined) return;
  try {
    validate(backup);
  } catch (error) {
    throw httpError(400, `${label}备份无法恢复：${errorMessage(error)}`);
  }
}

function requiresFullTimeIsleForOralHistory(envelope, backup) {
  return envelope.mode === "full" && envelope.schemaVersion >= 13 && backup?.mode === "full" &&
    (backup.questions.length > 0 || backup.answers.length > 0);
}

function buildOralHistoryTimeIslePreflight(backups) {
  const oralHistories = emptyOralHistoryImportResult(backups.oralHistories);
  oralHistories.note = "口述史与声音、事件和时间来源必须作为一个整体恢复；本次 JSON 已完成只读验真但未写入任何记录，请使用 .time-isle 完整备份。";
  const revisions = emptyRevisionImportResult(backups.revisions);
  revisions.skipped = recordCount(backups.revisions, "revisions");
  revisions.note = "整包恢复已转交 .time-isle，未写入记忆年轮。";
  const revisitIntents = emptyRevisitIntentImportResult(backups.revisitIntents);
  revisitIntents.skipped = recordCount(backups.revisitIntents, "intents");
  revisitIntents.note = "整包恢复已转交 .time-isle，未写入回访意愿。";
  const timeCalibrations = emptyTimeCalibrationImportResult(backups.timeCalibrations);
  timeCalibrations.skipped = recordCount(backups.timeCalibrations, "calibrations");
  timeCalibrations.requiresTimeIsle = true;
  timeCalibrations.note = "整包恢复已转交 .time-isle，未写入时间校准。";
  const curatorAgent = emptyCuratorAgentImportResult(backups.curatorAgent);
  curatorAgent.skipped = recordCount(backups.curatorAgent, "runs");
  curatorAgent.requiresTimeIsle = curatorAgent.skipped > 0;
  curatorAgent.note = curatorAgent.skipped
    ? "整包恢复已转交 .time-isle，受限策展运行仅完成验真，未恢复为历史审计记录。"
    : curatorAgent.note;
  const memoryInbox = emptyMemoryInboxImportResult(backups.memoryInbox);
  memoryInbox.skipped = recordCount(backups.memoryInbox, "items");
  memoryInbox.requiresTimeIsle = memoryInbox.skipped > 0;
  memoryInbox.note = memoryInbox.skipped
    ? "整包恢复已转交 .time-isle，记忆收件箱来源回执仅完成验真，未写入记录。"
    : memoryInbox.note;
  const provenance = emptyProvenanceImportResult(backups.provenance);
  provenance.skipped = recordCount(backups.provenance, "claims");
  provenance.requiresTimeIsle = provenance.skipped > 0;
  provenance.note = provenance.skipped
    ? "整包恢复已转交 .time-isle，来源护照仅完成验真，未写入主张账本。"
    : provenance.note;
  const coMemoryResponses = emptyCoMemoryResponseImportResult(backups.coMemoryResponses);
  coMemoryResponses.skipped = recordCount(backups.coMemoryResponses, "responses");
  coMemoryResponses.requiresTimeIsle = coMemoryResponses.skipped > 0;
  coMemoryResponses.note = coMemoryResponses.skipped
    ? "整包恢复已转交 .time-isle；共忆回信仅完成验真，未写入任何内容。"
    : coMemoryResponses.note;
  return {
    imported: 0,
    memories: [],
    archaeology: {
      events: 0,
      claims: 0,
      decisions: 0,
      questions: 0,
      skipped: recordCount(backups.archaeology, "events") +
        recordCount(backups.archaeology, "claims") +
        recordCount(backups.archaeology, "pairDecisions") +
        recordCount(backups.archaeology, "questions"),
      idMap: { events: {} }
    },
    exhibitions: {
      exhibitions: 0,
      skipped: recordCount(backups.exhibitions, "exhibitions"),
      idMap: {}
    },
    revisits: {
      states: 0,
      skipped: recordCount(backups.revisits, "states"),
      idMap: {}
    },
    entities: {
      ...emptyEntityResult(),
      skipped: recordCount(backups.entities, "entities")
    },
    voices: emptyVoiceImportResult(backups.voices),
    oralHistories,
    curatorAgent,
    memoryInbox,
    coMemoryResponses,
    provenance,
    capsules: emptyCapsuleImportResult(backups.capsules),
    revisions,
    revisitIntents,
    timeCalibrations
  };
}

function recordCount(backup, key) {
  return backup?.mode === "full" && Array.isArray(backup[key]) ? backup[key].length : 0;
}

function claimMemoryId(preferredId, occupiedIds, sanitizeId, createId) {
  const preferred = sanitizeId(preferredId);
  if (preferred && !occupiedIds.has(preferred)) return preferred;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = sanitizeId(createId("memory"));
    if (candidate && !occupiedIds.has(candidate)) return candidate;
  }
  throw new Error("连续生成的 ID 均无效或已被占用。");
}

function compensateNewMemories(store, memories, preExistingIds) {
  memories.slice().reverse().forEach((memory) => {
    if (preExistingIds.has(memory.id)) return;
    try { store.deleteMemory(memory.id); } catch { /* Best-effort cleanup for a non-atomic store implementation. */ }
  });
}

function isObjectRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isReferenceBearingBackup(value) {
  return isObjectRecord(value) && value.mode !== "redacted-summary";
}

function hasDuplicates(values) {
  return new Set(values).size !== values.length;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error || "未知错误");
}

function emptyArchaeologyResult() {
  return { events: 0, claims: 0, decisions: 0, questions: 0, skipped: 0, idMap: { events: {} } };
}

function emptyEntityResult() {
  return {
    entities: 0,
    aliases: 0,
    memoryLinks: 0,
    skipped: 0,
    idMap: { memories: {}, entities: {}, aliases: {} }
  };
}

function emptyVoiceImportResult(backup) {
  const assetCount = Number(backup?.assetCount ?? backup?.assets?.length) || 0;
  return {
    assets: 0,
    memoryLinks: 0,
    transcripts: 0,
    skipped: assetCount,
    requiresTimeIsle: assetCount > 0,
    note: assetCount ? "JSON 兼容导入不含声音字节；请使用 .time-isle 完整备份恢复声音。" : ""
  };
}

function emptyOralHistoryImportResult(backup) {
  const summarized = backup?.mode === "redacted-summary";
  const questionCount = Number(backup?.questionCount ?? backup?.questions?.length) || 0;
  const answerCount = Number(backup?.answerCount ?? backup?.answers?.length) || 0;
  const skipped = summarized ? 0 : questionCount + answerCount;
  return {
    questions: 0,
    answers: 0,
    skipped,
    summarized,
    requiresTimeIsle: skipped > 0,
    note: summarized
      ? "脱敏备份只保留口述史安全计数，不恢复问题、回答或时间来源。"
      : skipped
        ? "JSON 兼容导入不含口述回答依赖的声音字节；请使用 .time-isle 完整备份恢复口述史。"
        : ""
  };
}

function emptyCapsuleImportResult(backup) {
  const capsuleCount = Number(backup?.capsuleCount ?? backup?.capsules?.length) || 0;
  return {
    capsules: 0,
    mediaLinks: 0,
    skipped: capsuleCount,
    requiresTimeIsle: capsuleCount > 0,
    note: capsuleCount ? "JSON 兼容导入不含胶囊所需的安全展示图字节；请使用 .time-isle 完整备份恢复时间胶囊。" : ""
  };
}

function emptyRevisionImportResult(backup) {
  return {
    memories: 0,
    revisions: 0,
    skipped: 0,
    summarized: backup?.mode === "redacted-summary",
    note: backup?.mode === "redacted-summary" ? "脱敏备份只保留修订计数，不恢复旧版本正文。" : ""
  };
}

function emptyRevisitIntentImportResult(backup) {
  return {
    intents: 0,
    skipped: 0,
    summarized: backup?.mode === "redacted-summary",
    note: backup?.mode === "redacted-summary" ? "脱敏备份只保留回访意愿总数，不恢复具体选择。" : ""
  };
}

function emptyTimeCalibrationImportResult(backup) {
  return {
    calibrations: 0,
    skipped: 0,
    summarized: backup?.mode === "redacted-summary",
    requiresTimeIsle: false,
    note: backup?.mode === "redacted-summary" ? "脱敏备份只保留时间校准计数，不恢复日期、来源或备注。" : ""
  };
}

function emptyCuratorAgentImportResult(backup) {
  const summarized = backup?.mode === "redacted-summary";
  const runCount = Number(backup?.runCount ?? backup?.runs?.length) || 0;
  return {
    runs: 0,
    steps: 0,
    proposals: 0,
    decisions: 0,
    skipped: summarized ? 0 : runCount,
    summarized,
    historical: true,
    allowDecisions: false,
    requiresTimeIsle: false,
    idMap: { runs: {}, steps: {}, proposals: {}, decisions: {} },
    note: summarized
      ? "脱敏备份只保留受限策展运行安全计数，不恢复请求、回执、提案或人工决定。"
      : ""
  };
}

function emptyMemoryInboxImportResult(backup) {
  const summarized = backup?.mode === "redacted-summary";
  return {
    sources: 0,
    items: 0,
    pending: 0,
    dismissed: 0,
    accepted: 0,
    orphaned: 0,
    skipped: 0,
    summarized,
    requiresTimeIsle: false,
    idMap: { sources: {}, items: {} },
    note: summarized
      ? "脱敏备份只保留记忆收件箱安全计数，不恢复文件名、来源哈希、摘录、区间或展品关联。"
      : ""
  };
}

function emptyProvenanceImportResult(backup) {
  const summarized = backup?.mode === "redacted-summary";
  return {
    claims: 0,
    sources: 0,
    events: 0,
    skipped: 0,
    summarized,
    requiresTimeIsle: false,
    idMap: { claims: {}, sources: {}, events: {} },
    note: summarized
      ? "脱敏备份只保留来源护照安全计数，不恢复主张、摘录、定位、内部 ID 或哈希。"
      : ""
  };
}

function emptyCoMemoryResponseImportResult(backup) {
  const summarized = backup?.mode === "redacted-summary";
  return {
    responses: 0,
    reused: 0,
    skipped: 0,
    summarized,
    requiresTimeIsle: false,
    idMap: { responses: {} },
    note: summarized
      ? "脱敏备份只保留共忆回信安全计数，不恢复问题、回答、身份自述、内部 ID 或哈希。"
      : ""
  };
}

function normalizeCuratorAgentRestoreResult(result, backup) {
  const value = isObjectRecord(result) ? result : {};
  const expectedRuns = Array.isArray(backup?.runs) ? backup.runs.length : 0;
  const runs = Number(value.restoredRuns ?? value.runs) || 0;
  if (runs !== expectedRuns) throw new Error("受限策展运行未能完整恢复。");
  const idMap = isObjectRecord(value.idMap) ? value.idMap : {
    runs: value.runIdMap || {}, steps: {}, proposals: {}, decisions: {}
  };
  return {
    ...value,
    runs,
    steps: Object.keys(idMap.steps || {}).length,
    proposals: Object.keys(idMap.proposals || {}).length,
    decisions: Object.keys(idMap.decisions || {}).length,
    skipped: 0,
    summarized: false,
    historical: true,
    allowDecisions: false,
    requiresTimeIsle: false,
    idMap,
    note: runs ? "已恢复为只读历史审计；所有提案均需重新运行和逐项确认。" : ""
  };
}

module.exports = { createCollectionImporter };
