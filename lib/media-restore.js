"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const {
  MAX_MEDIA_PER_MEMORY,
  MEDIA_ARCHIVE_LIMITS,
  mediaObservationPolicyViolation
} = require("./media-policy");
const { verifyVoiceBytes, voiceArchivePath, readyStorageKey } = require("./voice-backup");
const { referencedOralVoiceAssetIds } = require("./oral-history-backup");
const { validateCuratorAgentArchiveState } = require("./curator-agent-backup");
const { validateMemoryInboxBackupPayload } = require("./memory-inbox-backup");
const { validateProvenanceBackupPayload } = require("./provenance-backup");
const { validateCoMemoryResponseBackupPayload } = require("./co-memory-response-backup");

function restorePreparedArchive(options = {}) {
  const {
    prepared,
    store,
    storage,
    normalizeMemory,
    validateArchaeologyBackup,
    restoreArchaeologyBackup,
    validateExhibitionBackup,
    restoreExhibitionBackup,
    validateRevisitBackup,
    restoreRevisitBackup,
    validateEntityBackup,
    restoreEntityBackup,
    voiceStorage,
    validateVoiceBackup,
    restoreVoiceBackup,
    validateCapsuleBackup,
    restoreCapsuleBackup,
    validateRevisionBackup,
    restoreRevisionBackup,
    validateRevisitIntentBackup,
    restoreRevisitIntentBackup,
    validateTimeCalibrationBackup,
    restoreTimeCalibrationBackup,
    validateOralHistoryBackup,
    restoreOralHistoryBackup,
    validateCuratorAgentBackup,
    restoreCuratorAgentBackup,
    validateMemoryInboxBackup,
    restoreMemoryInboxBackup,
    validateProvenanceBackup,
    restoreProvenanceBackup,
    validateCoMemoryResponseBackup,
    restoreCoMemoryResponseBackup,
    createId
  } = options;
  assertDependencies({ prepared, store, storage, normalizeMemory, createId });
  assertPreparedArchiveLimits(prepared);

  const sourceMemories = prepared.collection.memories;
  const sourceIds = sourceMemories.map((memory) => requireId(memory.id, "memory.id"));
  const archaeology = prepared.collection.archaeology || null;
  const exhibitions = prepared.collection.exhibitions || null;
  const revisits = prepared.collection.revisits || null;
  const entities = prepared.collection.entities || null;
  const voices = prepared.collection.voices || null;
  const capsules = prepared.collection.capsules || null;
  const revisions = prepared.collection.revisions || null;
  const revisitIntents = prepared.collection.revisitIntents || null;
  const timeCalibrations = prepared.collection.timeCalibrations || null;
  const oralHistories = prepared.collection.oralHistories || null;
  const curatorAgent = prepared.collection.curatorAgent || null;
  const memoryInbox = prepared.collection.memoryInbox || null;
  const provenance = prepared.collection.provenance || null;
  const coMemoryResponses = prepared.collection.coMemoryResponses || null;
  if (prepared.manifest?.mode === "full" && Number(prepared.manifest?.schemaVersion) >= 12 && timeCalibrations?.mode !== "full") {
    throw restoreError(
      "Full schema 12 archives require time-calibration data.",
      "MEDIA_RESTORE_TIME_CALIBRATION_REQUIRED"
    );
  }
  if (prepared.manifest?.mode === "full" && Number(prepared.manifest?.schemaVersion) >= 13 && oralHistories?.mode !== "full") {
    throw restoreError(
      "完整 schema 13 归档必须包含口述史数据。",
      "MEDIA_RESTORE_ORAL_HISTORY_REQUIRED"
    );
  }
  if (prepared.manifest?.mode === "full" && Number(prepared.manifest?.schemaVersion) >= 14 && curatorAgent?.mode !== "full") {
    throw restoreError(
      "完整 schema 14 归档必须包含受限策展审计数据。",
      "MEDIA_RESTORE_CURATOR_AGENT_REQUIRED"
    );
  }
  if (prepared.manifest?.mode === "full" && Number(prepared.manifest?.schemaVersion) >= 15 && memoryInbox?.mode !== "full") {
    throw restoreError(
      "完整 schema 15 归档必须包含记忆收件箱来源回执。",
      "MEDIA_RESTORE_MEMORY_INBOX_REQUIRED"
    );
  }
  if (prepared.manifest?.mode === "full" && Number(prepared.manifest?.schemaVersion) >= 16 && provenance?.mode !== "full") {
    throw restoreError(
      "Full schema 16 archives require provenance state.",
      "MEDIA_RESTORE_PROVENANCE_REQUIRED"
    );
  }
  if (prepared.manifest?.mode === "full" && Number(prepared.manifest?.schemaVersion) >= 17 && coMemoryResponses?.mode !== "full") {
    throw restoreError(
      "Full schema 17 archives require co-memory response state.",
      "MEDIA_RESTORE_CO_MEMORY_REQUIRED"
    );
  }
  if (archaeology?.mode === "full" && (
    typeof validateArchaeologyBackup !== "function" || typeof restoreArchaeologyBackup !== "function"
  )) {
    throw restoreError("完整记忆考古缺少恢复处理器。", "MEDIA_RESTORE_ARCHAEOLOGY_HANDLER_REQUIRED");
  }
  if (exhibitions?.mode === "full" && (
    typeof validateExhibitionBackup !== "function" || typeof restoreExhibitionBackup !== "function"
  )) {
    throw restoreError("完整主题展览缺少恢复处理器。", "MEDIA_RESTORE_EXHIBITION_HANDLER_REQUIRED");
  }
  if (revisits?.mode === "full" && (
    typeof validateRevisitBackup !== "function" || typeof restoreRevisitBackup !== "function"
  )) {
    throw restoreError("完整记忆回访缺少恢复处理器。", "MEDIA_RESTORE_REVISIT_HANDLER_REQUIRED");
  }
  if (entities?.mode === "full" && (
    typeof validateEntityBackup !== "function" || typeof restoreEntityBackup !== "function"
  )) {
    throw restoreError("完整实体线索缺少恢复处理器。", "MEDIA_RESTORE_ENTITY_HANDLER_REQUIRED");
  }
  if (voices?.mode === "full" && (
    typeof validateVoiceBackup !== "function" || typeof restoreVoiceBackup !== "function"
  )) {
    throw restoreError("完整声音归档缺少恢复处理器。", "MEDIA_RESTORE_VOICE_HANDLER_REQUIRED");
  }
  if (capsules?.mode === "full" && (
    typeof validateCapsuleBackup !== "function" || typeof restoreCapsuleBackup !== "function"
  )) {
    throw restoreError("完整时间胶囊归档缺少恢复处理器。", "MEDIA_RESTORE_CAPSULE_HANDLER_REQUIRED");
  }
  if (revisions?.mode === "full" && (
    typeof validateRevisionBackup !== "function" || typeof restoreRevisionBackup !== "function"
  )) {
    throw restoreError("完整记忆年轮归档缺少恢复处理器。", "MEDIA_RESTORE_REVISION_HANDLER_REQUIRED");
  }
  if (timeCalibrations?.mode === "full" && (
    typeof validateTimeCalibrationBackup !== "function" || typeof restoreTimeCalibrationBackup !== "function"
  )) {
    throw restoreError(
      "Full time-calibration archives require validation and restore handlers.",
      "MEDIA_RESTORE_TIME_CALIBRATION_HANDLER_REQUIRED"
    );
  }
  if (revisitIntents?.mode === "full" && (
    typeof validateRevisitIntentBackup !== "function" || typeof restoreRevisitIntentBackup !== "function"
  )) {
    throw restoreError("完整回访意愿归档缺少恢复处理器。", "MEDIA_RESTORE_REVISIT_INTENT_HANDLER_REQUIRED");
  }
  if (oralHistories?.mode === "full" && (
    typeof validateOralHistoryBackup !== "function" || typeof restoreOralHistoryBackup !== "function"
  )) {
    throw restoreError("完整口述史归档缺少验证或恢复处理器。", "MEDIA_RESTORE_ORAL_HISTORY_HANDLER_REQUIRED");
  }
  if (curatorAgent?.mode === "full" && (
    typeof validateCuratorAgentBackup !== "function" || typeof restoreCuratorAgentBackup !== "function"
  )) {
    throw restoreError("完整受限策展归档缺少验证或恢复处理器。", "MEDIA_RESTORE_CURATOR_AGENT_HANDLER_REQUIRED");
  }
  if (memoryInbox?.mode === "full" && (
    typeof validateMemoryInboxBackup !== "function" || typeof restoreMemoryInboxBackup !== "function"
  )) {
    throw restoreError("完整记忆收件箱归档缺少验证或恢复处理器。", "MEDIA_RESTORE_MEMORY_INBOX_HANDLER_REQUIRED");
  }
  if (provenance?.mode === "full" && (
    typeof validateProvenanceBackup !== "function" || typeof restoreProvenanceBackup !== "function"
  )) {
    throw restoreError(
      "Full provenance archives require validation and restore handlers.",
      "MEDIA_RESTORE_PROVENANCE_HANDLER_REQUIRED"
    );
  }
  if (coMemoryResponses?.mode === "full" && (
    typeof validateCoMemoryResponseBackup !== "function" || typeof restoreCoMemoryResponseBackup !== "function"
  )) {
    throw restoreError(
      "Full co-memory response archives require validation and restore handlers.",
      "MEDIA_RESTORE_CO_MEMORY_HANDLER_REQUIRED"
    );
  }
  if (archaeology && typeof validateArchaeologyBackup === "function") validateFeatureBackup("记忆考古", archaeology, sourceIds, validateArchaeologyBackup);
  if (exhibitions && typeof validateExhibitionBackup === "function") {
    validateFeatureBackup("主题展览", exhibitions, sourceIds, validateExhibitionBackup);
  }
  if (revisits && typeof validateRevisitBackup === "function") {
    validateFeatureBackup("记忆回访", revisits, sourceIds, validateRevisitBackup);
  }
  if (entities && typeof validateEntityBackup === "function") {
    validateFeatureBackup("实体线索", entities, sourceIds, validateEntityBackup);
  }
  if (voices && typeof validateVoiceBackup === "function") {
    validateVoiceFeature(voices, sourceIds, oralHistories, validateVoiceBackup);
  }
  if (capsules && typeof validateCapsuleBackup === "function") {
    validateFeatureBackup("时间胶囊", capsules, sourceIds, validateCapsuleBackup);
  }
  if (revisions && typeof validateRevisionBackup === "function") {
    validateFeatureBackup("记忆年轮", revisions, sourceIds, validateRevisionBackup);
  }
  if (revisitIntents && typeof validateRevisitIntentBackup === "function") {
    validateFeatureBackup("回访意愿", revisitIntents, sourceIds, validateRevisitIntentBackup);
  }

  const sourceEventIds = timeCalibrations?.mode === "full" || oralHistories?.mode === "full" || curatorAgent?.mode === "full"
    ? sourceArchaeologyEventIds(archaeology)
    : [];
  if (timeCalibrations && typeof validateTimeCalibrationBackup === "function") {
    validateTimeCalibrationFeature(timeCalibrations, sourceIds, sourceEventIds, validateTimeCalibrationBackup);
  }
  if (oralHistories && typeof validateOralHistoryBackup === "function") {
    validateOralHistoryFeature(
      oralHistories,
      sourceEventIds,
      voices?.mode === "full" ? voices.assets.map((asset) => asset.id) : [],
      validateOralHistoryBackup
    );
  }
  if (curatorAgent && typeof validateCuratorAgentBackup === "function") {
    validateCuratorAgentFeature(
      curatorAgent,
      sourceIds,
      sourceEventIds,
      curatorAgent.mode === "full" ? sourceExhibitionIds(exhibitions) : [],
      validateCuratorAgentBackup
    );
  }
  if (memoryInbox && typeof validateMemoryInboxBackup === "function") {
    try {
      validateMemoryInboxBackupPayload(memoryInbox, memoryInbox.mode === "full" ? { memoryIds: sourceIds } : {});
      const valid = validateMemoryInboxBackup(memoryInbox, sourceIds);
      if (valid !== true) throw new TypeError("记忆收件箱备份未通过业务校验。");
    } catch (cause) {
      throw restoreError("记忆收件箱归档内容无效。", "MEDIA_RESTORE_MEMORY_INBOX_INVALID", cause);
    }
  }

  if (provenance) {
    validateProvenanceRestoreFeature(provenance, sourceIds, validateProvenanceBackup);
  }
  if (coMemoryResponses) {
    validateCoMemoryResponseRestoreFeature(coMemoryResponses, sourceIds, validateCoMemoryResponseBackup);
  }

  const memoryPlan = buildMemoryPlan(sourceMemories, store, normalizeMemory, createId);
  assertCoMemoryIdentityMapping(coMemoryResponses, memoryPlan.idMap);
  const assetPlan = buildAssetPlan(prepared, store, storage, createId);
  const linksByMemory = mapLinks(prepared.links, memoryPlan.idMap, assetPlan.idMap);
  const sourcePrivacyModes = new Map(prepared.assets.map((asset) => [asset.id, asset.privacyMode]));
  const observationPlan = buildObservationPlan(
    prepared.mediaObservations,
    memoryPlan.idMap,
    assetPlan.idMap,
    sourcePrivacyModes,
    store,
    createId
  );
  const voicePlan = buildVoiceRestorePlan({
    prepared,
    voices,
    store,
    voiceStorage,
    memoryIdMap: memoryPlan.idMap,
    createId
  });

  const movedDirectories = [];
  const createdVoiceFiles = [];
  const createdVoiceDirectories = [];
  try {
    materializeAssetFiles(assetPlan.newAssets, movedDirectories);
    materializeVoiceFiles(voicePlan, createdVoiceFiles, createdVoiceDirectories, voiceStorage);
    let archaeologyResult = { events: 0, claims: 0, decisions: 0, questions: 0, skipped: 0, idMap: { events: {} } };
    let exhibitionResult = { exhibitions: 0, skipped: 0, idMap: {} };
    let revisitResult = { states: 0, skipped: 0, idMap: {} };
    let entityResult = {
      entities: 0,
      aliases: 0,
      memoryLinks: 0,
      skipped: 0,
      idMap: { memories: {}, entities: {}, aliases: {} }
    };
    let voiceResult = emptyVoiceRestoreResult();
    let capsuleResult = { capsules: 0, mediaLinks: 0, idMap: {} };
    let revisionResult = { memories: 0, revisions: 0, skipped: 0, idMap: { memories: {}, revisions: {} } };
    let revisitIntentResult = { intents: 0, skipped: 0, idMap: {} };
    let timeCalibrationResult = { calibrations: 0, skipped: 0, idMap: {} };
    let oralHistoryResult = emptyOralHistoryRestoreResult();
    let curatorAgentResult = emptyCuratorAgentRestoreResult();
    let memoryInboxResult = emptyMemoryInboxRestoreResult();
    let coMemoryResponseResult = emptyCoMemoryResponseRestoreResult(coMemoryResponses);
    let provenanceResult = emptyProvenanceRestoreResult(provenance);
    const result = store.withTransaction(() => {
      store.importMemories(memoryPlan.memories, {
        clueMode: entities?.mode === "full" ? "defer" : prepared.manifest?.mode === "redacted" ? "none" : "derive",
        revisionMode: revisions?.mode === "full" ? "defer" : "imported"
      });
      if (revisions?.mode === "full" && typeof restoreRevisionBackup === "function") {
        revisionResult = restoreRevisionBackup(revisions, memoryPlan.idMap);
        if (revisionResult.skipped) throw restoreError("记忆修订未能完整恢复。", "MEDIA_RESTORE_REVISION_INCOMPLETE");
      }
      if (memoryInbox?.mode === "full" && typeof restoreMemoryInboxBackup === "function") {
        memoryInboxResult = restoreMemoryInboxBackup(memoryInbox, { memoryIdMap: memoryPlan.idMap });
        if (!memoryInboxResult || memoryInboxResult.skipped || memoryInboxResult.items !== memoryInbox.items.length) {
          throw restoreError("记忆收件箱来源回执未能完整恢复。", "MEDIA_RESTORE_MEMORY_INBOX_INCOMPLETE");
        }
      }
      for (const planned of assetPlan.newAssets) {
        store.createMediaAsset(planned.asset, planned.variants);
      }
      for (const [memoryId, links] of linksByMemory) {
        store.replaceMemoryMedia(memoryId, links);
      }
      for (const observation of observationPlan) store.saveMediaObservation(observation);
      if (archaeology?.mode === "full" && typeof restoreArchaeologyBackup === "function") {
        archaeologyResult = restoreArchaeologyBackup(store, archaeology, memoryPlan.idMap);
        if (archaeologyResult.skipped) {
          throw restoreError("时光拼图关系未能完整恢复。", "MEDIA_RESTORE_ARCHAEOLOGY_INCOMPLETE");
        }
      }
      if (voices?.mode === "full" && typeof restoreVoiceBackup === "function") {
        voiceResult = restoreVoiceBackup(voices, {
          memoryIdMap: memoryPlan.idMap,
          assetIdMap: voicePlan.explicitAssetIdMap,
          storageKeyMap: voicePlan.storageKeyMap,
          additionalAssetIds: oralHistories?.mode === "full"
            ? referencedOralVoiceAssetIds(oralHistories)
            : []
        });
        assertCompleteVoiceRestore(voices, voiceResult, voicePlan.idMap);
      }
      const eventIdMap = sourceEventIds.length
        ? requireCompleteEventIdMap(archaeologyResult?.idMap?.events, sourceEventIds)
        : new Map();
      if (oralHistories?.mode === "full" && typeof restoreOralHistoryBackup === "function") {
        oralHistoryResult = restoreOralHistoryBackup(oralHistories, {
          memoryIdMap: memoryPlan.idMap,
          eventIdMap,
          assetIdMap: new Map(Object.entries(toIdMapObject(voiceResult.idMap?.assets)))
        });
        assertCompleteOralHistoryRestore(oralHistories, oralHistoryResult);
      }
      if (coMemoryResponses?.mode === "full" && typeof restoreCoMemoryResponseBackup === "function") {
        coMemoryResponseResult = restoreCoMemoryResponseBackup(coMemoryResponses, { memoryIdMap: memoryPlan.idMap });
        assertCompleteCoMemoryResponseRestore(coMemoryResponses, coMemoryResponseResult);
      }
      if (provenance?.mode === "full" && typeof restoreProvenanceBackup === "function") {
        provenanceResult = restoreProvenanceBackup(provenance, { memoryIdMap: memoryPlan.idMap });
        assertCompleteProvenanceRestore(provenance, provenanceResult);
      }
      if (timeCalibrations?.mode === "full" && typeof restoreTimeCalibrationBackup === "function") {
        timeCalibrationResult = restoreTimeCalibrationBackup(timeCalibrations, {
          memoryIdMap: memoryPlan.idMap,
          eventIdMap,
          oralQuestionKeyMap: new Map(Object.entries(toIdMapObject(oralHistoryResult.idMap?.questionKeys)))
        });
        if (!timeCalibrationResult || timeCalibrationResult.skipped !== 0 ||
            timeCalibrationResult.calibrations !== timeCalibrations.calibrations.length) {
          throw restoreError(
            "Time calibrations were not restored completely.",
            "MEDIA_RESTORE_TIME_CALIBRATION_INCOMPLETE"
          );
        }
      }
      if (exhibitions?.mode === "full" && typeof restoreExhibitionBackup === "function") {
        exhibitionResult = restoreExhibitionBackup(exhibitions, memoryPlan.idMap);
        if (exhibitionResult.skipped) {
          throw restoreError("主题展览未能完整恢复。", "MEDIA_RESTORE_EXHIBITION_INCOMPLETE");
        }
      }
      if (curatorAgent?.mode === "full" && typeof restoreCuratorAgentBackup === "function") {
        curatorAgentResult = restoreCuratorAgentBackup(curatorAgent, {
          memoryIdMap: memoryPlan.idMap,
          eventIdMap,
          exhibitionIdMap: new Map(Object.entries(toIdMapObject(exhibitionResult.idMap))),
          createId
        });
        assertCompleteCuratorAgentRestore(curatorAgent, curatorAgentResult);
      }
      if (revisits?.mode === "full" && typeof restoreRevisitBackup === "function") {
        revisitResult = restoreRevisitBackup(revisits, memoryPlan.idMap);
        if (revisitResult.skipped) {
          throw restoreError("记忆回访状态未能完整恢复。", "MEDIA_RESTORE_REVISIT_INCOMPLETE");
        }
      }
      if (revisitIntents?.mode === "full" && typeof restoreRevisitIntentBackup === "function") {
        revisitIntentResult = restoreRevisitIntentBackup(revisitIntents, memoryPlan.idMap);
        if (revisitIntentResult.skipped || revisitIntentResult.intents !== revisitIntents.intents.length) {
          throw restoreError("回访意愿未能完整恢复。", "MEDIA_RESTORE_REVISIT_INTENT_INCOMPLETE");
        }
      }
      if (entities?.mode === "full" && typeof restoreEntityBackup === "function") {
        entityResult = restoreEntityBackup(entities, memoryPlan.idMap);
        if (entityResult.skipped) {
          throw restoreError("实体线索未能完整恢复。", "MEDIA_RESTORE_ENTITY_INCOMPLETE");
        }
      }
      if (capsules?.mode === "full" && typeof restoreCapsuleBackup === "function") {
        capsuleResult = restoreCapsuleBackup(capsules, {
          exhibitionIdMap: exhibitionResult.idMap || {},
          mediaAssetIdMap: assetPlan.idMap
        });
        const expectedMediaLinks = capsules.capsules.reduce((sum, capsule) => sum + capsule.mediaLinks.length, 0);
        if (capsuleResult.capsules !== capsules.capsules.length || capsuleResult.mediaLinks !== expectedMediaLinks) {
          throw restoreError("时间胶囊未能完整恢复。", "MEDIA_RESTORE_CAPSULE_INCOMPLETE");
        }
      }
      const entityIdMaps = normalizeEntityIdMaps(entityResult.idMap);
      return {
        imported: memoryPlan.memories.length,
        memories: memoryPlan.memories.map((memory) => store.getMemory(memory.id)),
        media: {
          assetsCreated: assetPlan.newAssets.length,
          assetsReused: assetPlan.reusedCount,
          links: [...linksByMemory.values()].reduce((sum, links) => sum + links.length, 0),
          observations: observationPlan.length
        },
        archaeology: archaeologyResult,
        exhibitions: exhibitionResult,
        revisits: revisitResult,
        entities: entityResult,
        voices: voiceResult,
        oralHistories: oralHistoryResult,
        curatorAgent: curatorAgentResult,
        memoryInbox: memoryInboxResult,
        coMemoryResponses: coMemoryResponseResult,
        provenance: provenanceResult,
        capsules: capsuleResult,
        revisions: revisionResult,
        revisitIntents: revisitIntentResult,
        timeCalibrations: timeCalibrationResult,
        idMap: {
          memories: Object.fromEntries(memoryPlan.idMap),
          assets: Object.fromEntries(assetPlan.idMap),
          exhibitions: exhibitionResult.idMap || {},
          revisits: revisitResult.idMap || {},
          entities: entityIdMaps.entities,
          aliases: entityIdMaps.aliases,
          voices: toIdMapObject(voiceResult.idMap?.assets),
          oralHistoryQuestions: toIdMapObject(oralHistoryResult.idMap?.questions),
          oralHistoryAnswers: toIdMapObject(oralHistoryResult.idMap?.answers),
          curatorAgentRuns: toIdMapObject(curatorAgentResult.idMap?.runs ?? curatorAgentResult.runIdMap),
          curatorAgentSteps: toIdMapObject(curatorAgentResult.idMap?.steps),
          curatorAgentProposals: toIdMapObject(curatorAgentResult.idMap?.proposals),
          curatorAgentDecisions: toIdMapObject(curatorAgentResult.idMap?.decisions),
          memoryInboxSources: toIdMapObject(memoryInboxResult.idMap?.sources),
          memoryInboxItems: toIdMapObject(memoryInboxResult.idMap?.items),
          coMemoryResponses: toIdMapObject(coMemoryResponseResult.idMap?.responses),
          provenanceClaims: toIdMapObject(provenanceResult.idMap?.claims),
          provenanceSources: toIdMapObject(provenanceResult.idMap?.sources),
          provenanceEvents: toIdMapObject(provenanceResult.idMap?.events),
          capsules: toIdMapObject(capsuleResult.idMap),
          revisions: toIdMapObject(revisionResult.idMap?.revisions),
          revisitIntents: toIdMapObject(revisitIntentResult.idMap),
          timeCalibrations: toIdMapObject(timeCalibrationResult.idMap?.calibrations ?? timeCalibrationResult.idMap)
        }
      };
    });
    return result;
  } catch (error) {
    cleanupVoiceFiles(createdVoiceFiles, createdVoiceDirectories, voiceStorage);
    cleanupMovedDirectories(movedDirectories);
    throw error;
  }
}

function normalizeEntityIdMaps(value) {
  if (value instanceof Map) {
    return { entities: Object.fromEntries(value), aliases: {} };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { entities: {}, aliases: {} };
  }
  const nested = ["entities", "aliases", "memories"].some((key) => isIdMapContainer(value[key]));
  if (!nested) return { entities: { ...value }, aliases: {} };
  return {
    entities: toIdMapObject(value.entities),
    aliases: toIdMapObject(value.aliases)
  };
}

function isIdMapContainer(value) {
  return value instanceof Map || Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function toIdMapObject(value) {
  if (value instanceof Map) return Object.fromEntries(value);
  return value && typeof value === "object" && !Array.isArray(value) ? { ...value } : {};
}

function emptyVoiceRestoreResult() {
  return {
    assets: 0,
    assetsReused: 0,
    memoryLinks: 0,
    transcripts: 0,
    idMap: { memories: {}, assets: {}, storageKeys: {} }
  };
}

function emptyOralHistoryRestoreResult() {
  return {
    questions: 0,
    answers: 0,
    skipped: 0,
    idMap: { questions: {}, answers: {} }
  };
}

function emptyCuratorAgentRestoreResult() {
  return {
    restoredRuns: 0,
    runs: 0,
    steps: 0,
    proposals: 0,
    decisions: 0,
    historical: true,
    allowDecisions: false,
    idMap: { runs: {}, steps: {}, proposals: {}, decisions: {} }
  };
}

function emptyMemoryInboxRestoreResult() {
  return {
    sources: 0,
    items: 0,
    reused: 0,
    skipped: 0,
    summarized: false,
    idMap: { sources: {}, items: {} }
  };
}

function emptyProvenanceRestoreResult(provenance) {
  return {
    claims: 0,
    sources: 0,
    events: 0,
    skipped: 0,
    summarized: provenance?.mode === "redacted-summary",
    idMap: { claims: {}, sources: {}, events: {} }
  };
}

function emptyCoMemoryResponseRestoreResult(coMemoryResponses) {
  return {
    responses: 0,
    reused: 0,
    skipped: 0,
    summarized: coMemoryResponses?.mode === "redacted-summary",
    idMap: { responses: {} }
  };
}

function buildVoiceRestorePlan({ prepared, voices, store, voiceStorage, memoryIdMap, createId }) {
  const empty = {
    idMap: new Map(),
    explicitAssetIdMap: new Map(),
    storageKeyMap: new Map(),
    fileCopies: []
  };
  if (!voices || voices.mode !== "full") return empty;
  assertVoiceRestoreDependencies(store, voiceStorage);

  const preparedFiles = prepared.files?.voices;
  if (!Array.isArray(preparedFiles) || preparedFiles.length !== voices.assets.length) {
    throw restoreError("声音恢复缺少已验证文件。", "MEDIA_RESTORE_VOICE_FILE_MISSING");
  }
  const filesById = new Map();
  for (const file of preparedFiles) {
    const assetId = requireId(file?.assetId, "voice file.assetId");
    if (filesById.has(assetId)) throw restoreError("声音恢复文件描述重复。", "MEDIA_RESTORE_REFERENCE_COLLISION");
    filesById.set(assetId, file);
  }

  const existingAssets = listAllVoiceAssets(store);
  const occupiedIds = new Set(existingAssets.map((asset) => requireId(asset.id, "voice asset.id")));
  const occupiedStorageKeys = new Set(existingAssets.map((asset) => String(asset.storageKey || "")));
  const idMap = new Map();
  const explicitAssetIdMap = new Map();
  const storageKeyMap = new Map();
  const fileCopies = [];
  const reservedTargetPaths = new Set();

  for (const source of voices.assets) {
    const sourceId = requireId(source.id, "voice asset.id");
    const file = filesById.get(sourceId);
    if (!file) throw restoreError("声音资产缺少已验证音频。", "MEDIA_RESTORE_VOICE_FILE_MISSING");
    verifyPreparedVoiceFile(source, file, prepared.stagingRoot);

    const existingByHash = store.getVoiceAssetByHash(source.contentSha256);
    if (existingByHash) {
      assertReusableVoiceAsset(source, existingByHash, voiceStorage);
      if ([...idMap.values()].includes(existingByHash.id)) {
        throw restoreError("多个声音资产不能折叠到同一目标。", "MEDIA_RESTORE_REFERENCE_COLLISION");
      }
      idMap.set(sourceId, existingByHash.id);
      storageKeyMap.set(source.storageKey, existingByHash.storageKey);
      continue;
    }

    let targetId = sourceId;
    if (occupiedIds.has(targetId)) {
      targetId = uniqueId("voice", occupiedIds, createId, (candidate) => store.getVoiceAsset(candidate));
    }
    occupiedIds.add(targetId);
    const targetStorageKey = readyStorageKey(source);
    if (occupiedStorageKeys.has(targetStorageKey)) {
      throw restoreError("声音恢复的目标存储位置已被占用。", "MEDIA_RESTORE_VOICE_STORAGE_COLLISION");
    }
    occupiedStorageKeys.add(targetStorageKey);
    const destinationPath = voiceStorage.resolveStorageKey(targetStorageKey);
    const collisionKey = path.resolve(destinationPath).toLowerCase();
    if (reservedTargetPaths.has(collisionKey)) {
      throw restoreError("声音恢复目标文件重复。", "MEDIA_RESTORE_REFERENCE_COLLISION");
    }
    reservedTargetPaths.add(collisionKey);
    if (fs.existsSync(destinationPath)) {
      verifyExistingVoiceFile(destinationPath, source);
    } else {
      fileCopies.push({ sourcePath: file.filePath, destinationPath, source });
    }
    idMap.set(sourceId, targetId);
    explicitAssetIdMap.set(sourceId, targetId);
    storageKeyMap.set(source.storageKey, targetStorageKey);
  }

  if (filesById.size !== idMap.size) {
    throw restoreError("声音恢复包含额外或未引用的文件描述。", "MEDIA_RESTORE_REFERENCE_INVALID");
  }
  for (const sourceMemoryId of new Set(voices.memoryLinks.map((link) => link.memoryId))) {
    if (!memoryIdMap.has(sourceMemoryId)) {
      throw restoreError("声音恢复引用缺少展品映射。", "MEDIA_RESTORE_REFERENCE_INVALID");
    }
  }
  return { idMap, explicitAssetIdMap, storageKeyMap, fileCopies };
}

function assertVoiceRestoreDependencies(store, voiceStorage) {
  const methods = ["getVoiceAsset", "getVoiceAssetByHash", "listVoiceAssets"];
  if (!store || methods.some((name) => typeof store[name] !== "function")) {
    throw restoreError("声音恢复缺少 store 能力。", "MEDIA_RESTORE_VOICE_DEPENDENCY_INVALID");
  }
  if (!voiceStorage || typeof voiceStorage.resolveStorageKey !== "function" ||
      typeof voiceStorage.root !== "string" || !path.isAbsolute(voiceStorage.root)) {
    throw restoreError("声音恢复缺少 voiceStorage 能力。", "MEDIA_RESTORE_VOICE_STORAGE_REQUIRED");
  }
}

function listAllVoiceAssets(store) {
  const output = [];
  let offset = 0;
  while (true) {
    const page = store.listVoiceAssets({ limit: 5000, offset });
    if (!Array.isArray(page)) throw restoreError("声音资产查询结果无效。", "MEDIA_RESTORE_VOICE_DEPENDENCY_INVALID");
    output.push(...page);
    if (page.length < 5000) return output;
    offset += page.length;
  }
}

function verifyPreparedVoiceFile(source, file, stagingRoot) {
  const expectedArchivePath = voiceArchivePath(source);
  const resolvedRoot = path.resolve(stagingRoot);
  const resolvedFile = path.resolve(file.filePath);
  if (file.archivePath !== expectedArchivePath || (!resolvedFile.startsWith(`${resolvedRoot}${path.sep}`) && resolvedFile !== resolvedRoot)) {
    throw restoreError("声音暂存文件路径无效。", "MEDIA_RESTORE_VOICE_PATH_INVALID");
  }
  let stat;
  let data;
  try {
    stat = fs.lstatSync(file.filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("not a regular file");
    data = fs.readFileSync(file.filePath);
  } catch (cause) {
    throw restoreError("声音暂存文件不可用。", "MEDIA_RESTORE_VOICE_FILE_MISSING", cause);
  }
  const inspected = verifyVoiceBytes(data, source.mimeType, source.id);
  if (file.byteSize !== source.byteSize || file.sha256 !== source.contentSha256 ||
      file.mimeType !== source.mimeType || file.codec !== source.codec || file.durationMs !== source.durationMs ||
      stat.size !== source.byteSize || data.length !== source.byteSize || hashBuffer(data) !== source.contentSha256 ||
      inspected.codec !== source.codec || inspected.durationMs !== source.durationMs) {
    throw restoreError("声音暂存文件与已验证描述不一致。", "MEDIA_RESTORE_VOICE_FILE_MISMATCH");
  }
}

function assertReusableVoiceAsset(source, existing, voiceStorage) {
  if (existing.status !== "ready" || existing.mimeType !== source.mimeType || existing.codec !== source.codec ||
      existing.byteSize !== source.byteSize || existing.durationMs !== source.durationMs ||
      existing.contentSha256 !== source.contentSha256) {
    throw restoreError("已有同哈希声音与归档技术信息不一致。", "MEDIA_RESTORE_VOICE_ASSET_CONFLICT");
  }
  let filePath;
  try {
    filePath = voiceStorage.resolveStorageKey(existing.storageKey);
  } catch (cause) {
    throw restoreError("已有同哈希声音的存储位置无效。", "MEDIA_RESTORE_VOICE_ASSET_CONFLICT", cause);
  }
  verifyExistingVoiceFile(filePath, source);
}

function verifyExistingVoiceFile(filePath, source) {
  let stat;
  let data;
  try {
    stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== source.byteSize) throw new Error("invalid file");
    data = fs.readFileSync(filePath);
  } catch (cause) {
    throw restoreError("声音恢复目标文件缺失或损坏。", "MEDIA_RESTORE_VOICE_ASSET_CONFLICT", cause);
  }
  const inspected = verifyVoiceBytes(data, source.mimeType, source.id);
  if (hashBuffer(data) !== source.contentSha256 || inspected.codec !== source.codec ||
      inspected.durationMs !== source.durationMs || inspected.byteSize !== source.byteSize) {
    throw restoreError("声音恢复目标文件与归档不一致。", "MEDIA_RESTORE_VOICE_ASSET_CONFLICT");
  }
}

function materializeVoiceFiles(plan, createdFiles, createdDirectories, voiceStorage) {
  for (const item of plan.fileCopies) {
    ensureSafeVoiceParent(item.destinationPath, voiceStorage.root, createdDirectories);
    if (fs.existsSync(item.destinationPath)) {
      throw restoreError("声音恢复目标文件已存在。", "MEDIA_RESTORE_VOICE_FILE_CONFLICT");
    }
    try {
      fs.copyFileSync(item.sourcePath, item.destinationPath, fs.constants.COPYFILE_EXCL);
      createdFiles.push(item.destinationPath);
      verifyExistingVoiceFile(item.destinationPath, item.source);
    } catch (cause) {
      if (String(cause?.code || "").startsWith("MEDIA_RESTORE_")) throw cause;
      throw restoreError("声音文件无法安全物化。", "MEDIA_RESTORE_VOICE_FILE_CONFLICT", cause);
    }
  }
}

function ensureSafeVoiceParent(destinationPath, storageRoot, createdDirectories) {
  const root = path.resolve(storageRoot);
  const rootStat = fs.lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw restoreError("声音恢复根目录不安全。", "MEDIA_RESTORE_VOICE_PATH_INVALID");
  }
  const parent = path.dirname(destinationPath);
  const relative = path.relative(root, parent);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative) ||
      !relative.split(path.sep).every((segment) => segment && segment !== "." && segment !== "..")) {
    throw restoreError("声音恢复路径越界。", "MEDIA_RESTORE_VOICE_PATH_INVALID");
  }
  let current = root;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    if (fs.existsSync(current)) {
      const stat = fs.lstatSync(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw restoreError("声音恢复目录不安全。", "MEDIA_RESTORE_VOICE_PATH_INVALID");
      }
    } else {
      fs.mkdirSync(current, { mode: 0o700 });
      createdDirectories.push(current);
    }
  }
}

function cleanupVoiceFiles(files, directories, voiceStorage) {
  for (const file of files.slice().reverse()) {
    try { fs.rmSync(file, { force: true }); } catch { /* best effort after DB rollback */ }
  }
  const root = path.resolve(String(voiceStorage?.root || "."));
  for (const directory of directories.slice().reverse()) {
    try {
      const resolved = path.resolve(directory);
      const relative = path.relative(root, resolved);
      if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) fs.rmdirSync(resolved);
    } catch { /* keep non-empty or concurrently used directories */ }
  }
}

function assertCompleteVoiceRestore(source, result, plannedIdMap) {
  const resultMap = toIdMapObject(result?.idMap?.assets);
  if (!result || result.assets + result.assetsReused !== source.assets.length ||
      result.memoryLinks !== source.memoryLinks.length || result.transcripts !== source.transcripts.length ||
      Object.keys(resultMap).length !== plannedIdMap.size ||
      [...plannedIdMap].some(([sourceId, targetId]) => resultMap[sourceId] !== targetId)) {
    throw restoreError("声音数据未能完整恢复。", "MEDIA_RESTORE_VOICE_INCOMPLETE");
  }
}

function assertCompleteOralHistoryRestore(source, result) {
  const questionMap = toIdMapObject(result?.idMap?.questions);
  const answerMap = toIdMapObject(result?.idMap?.answers);
  const questionIds = source.questions.map((item) => requireId(item?.id, "oral question.id"));
  const answerIds = source.answers.map((item) => requireId(item?.id, "oral answer.id"));
  const questionTargets = Object.values(questionMap).map((id) => requireId(id, "restored oral question.id"));
  const answerTargets = Object.values(answerMap).map((id) => requireId(id, "restored oral answer.id"));
  if (!result || result.skipped !== 0 || result.questions !== questionIds.length || result.answers !== answerIds.length ||
      Object.keys(questionMap).length !== questionIds.length || Object.keys(answerMap).length !== answerIds.length ||
      questionIds.some((id) => !questionMap[id]) || answerIds.some((id) => !answerMap[id]) ||
      new Set(questionTargets).size !== questionTargets.length || new Set(answerTargets).size !== answerTargets.length) {
    throw restoreError("口述史数据未能完整恢复。", "MEDIA_RESTORE_ORAL_HISTORY_INCOMPLETE");
  }
}

function assertCompleteProvenanceRestore(source, result) {
  const claimIds = source.claims.map((item) => requireId(item?.id, "provenance claim.id"));
  const sourceIds = source.sources.map((item) => requireId(item?.id, "provenance source.id"));
  const eventIds = source.events.map((item) => requireId(item?.id, "provenance event.id"));
  if (!result || result.skipped !== 0 || result.summarized === true ||
      result.claims !== claimIds.length || result.sources !== sourceIds.length || result.events !== eventIds.length ||
      !completeIdMap(result.idMap?.claims, claimIds, "provenance claim") ||
      !completeIdMap(result.idMap?.sources, sourceIds, "provenance source") ||
      !completeIdMap(result.idMap?.events, eventIds, "provenance event")) {
    throw restoreError("Provenance state was not restored completely.", "MEDIA_RESTORE_PROVENANCE_INCOMPLETE");
  }
}

function assertCompleteCoMemoryResponseRestore(source, result) {
  const responseIds = source.responses.map((item) => requireId(item?.id, "co-memory response.id"));
  const idMap = toIdMapObject(result?.idMap?.responses);
  if (!result || result.skipped !== 0 || result.summarized === true ||
      result.responses !== responseIds.length || Object.keys(idMap).length !== responseIds.length ||
      responseIds.some((id) => idMap[id] !== id)) {
    throw restoreError(
      "Co-memory responses were not restored completely without identity remapping.",
      "MEDIA_RESTORE_CO_MEMORY_INCOMPLETE"
    );
  }
}

function completeIdMap(value, sourceIds, label) {
  const map = toIdMapObject(value);
  const targets = [];
  if (Object.keys(map).length !== sourceIds.length || sourceIds.some((id) => !Object.hasOwn(map, id))) return false;
  try {
    for (const sourceId of sourceIds) targets.push(requireId(map[sourceId], `restored ${label}.id`));
  } catch {
    return false;
  }
  return new Set(targets).size === targets.length;
}

function assertCompleteCuratorAgentRestore(source, result) {
  const expectedRuns = source.runs.length;
  const expectedSteps = source.runs.reduce((sum, entry) => sum + entry.steps.length, 0);
  const expectedProposals = source.runs.reduce((sum, entry) => sum + (entry.proposal ? 1 : 0), 0);
  const expectedDecisions = source.runs.reduce((sum, entry) => sum + entry.decisions.length, 0);
  const maps = result?.idMap || {};
  const runMap = toIdMapObject(maps.runs ?? result?.runIdMap);
  const stepMap = toIdMapObject(maps.steps);
  const proposalMap = toIdMapObject(maps.proposals);
  const decisionMap = toIdMapObject(maps.decisions);
  const restoredRuns = Number(result?.restoredRuns ?? result?.runs);
  if (restoredRuns !== expectedRuns || Object.keys(runMap).length !== expectedRuns ||
      Object.keys(stepMap).length !== expectedSteps || Object.keys(proposalMap).length !== expectedProposals ||
      Object.keys(decisionMap).length !== expectedDecisions || result?.allowDecisions === true) {
    throw restoreError("受限策展审计数据未能完整恢复为只读历史。", "MEDIA_RESTORE_CURATOR_AGENT_INCOMPLETE");
  }
}

function hashBuffer(data) {
  return createHash("sha256").update(data).digest("hex");
}

function buildMemoryPlan(sourceMemories, store, normalizeMemory, createId) {
  const occupied = new Set(store.listMemories().map((memory) => memory.id));
  const idMap = new Map();
  const memories = sourceMemories.map((source) => {
    const sourceId = requireId(source.id, "memory.id");
    let targetId = sourceId;
    if (occupied.has(targetId)) targetId = uniqueId("memory", occupied, createId);
    occupied.add(targetId);
    idMap.set(sourceId, targetId);
    const normalized = normalizeMemory({ ...source, id: targetId, agentRunId: "", coverImage: "" });
    normalized.id = targetId;
    normalized.agentRunId = "";
    normalized.coverImage = "";
    return normalized;
  });
  return { memories, idMap };
}

function buildAssetPlan(prepared, store, storage, createId) {
  const existingAssets = listAllAssets(store);
  const anyByHash = new Map(existingAssets.map((asset) => [asset.contentSha256, asset]));
  const byHash = new Map(existingAssets.filter((asset) => asset.status === "ready").map((asset) => [asset.contentSha256, asset]));
  const occupied = new Set(existingAssets.map((asset) => asset.id));
  const variantFileByKey = new Map(prepared.files.variants.map((file) => [`${file.assetId}\0${file.kind}`, file]));
  const idMap = new Map();
  const newAssets = [];
  let reusedCount = 0;

  for (const sourceAsset of prepared.assets) {
    if (anyByHash.has(sourceAsset.contentSha256) && !byHash.has(sourceAsset.contentSha256)) {
      throw restoreError("相同内容的媒体正在等待回收，请完成清理后再恢复归档。", "MEDIA_RESTORE_ASSET_NOT_READY");
    }
    const reusable = byHash.get(sourceAsset.contentSha256);
    if (reusable) {
      assertReusableAsset(sourceAsset, reusable, storage);
      idMap.set(sourceAsset.id, reusable.id);
      reusedCount += 1;
      continue;
    }
    let targetId = sourceAsset.id;
    if (occupied.has(targetId)) targetId = uniqueId("asset", occupied, createId);
    occupied.add(targetId);
    idMap.set(sourceAsset.id, targetId);
    const directoryKey = `assets/${sourceAsset.contentSha256.slice(0, 2)}/${targetId}`;
    const destinationDirectory = storage.resolveStorageKey(directoryKey);
    if (fs.existsSync(destinationDirectory)) {
      throw restoreError("媒体恢复目标目录已经存在。", "MEDIA_RESTORE_TARGET_EXISTS");
    }
    const variants = sourceAsset.variants.map((variant) => {
      const staged = variantFileByKey.get(`${sourceAsset.id}\0${variant.kind}`);
      if (!staged) throw restoreError("媒体恢复缺少已验证文件。", "MEDIA_RESTORE_FILE_MISSING");
      const fileName = variantFileName(variant.kind, variant.mimeType);
      return {
        descriptor: {
          assetId: targetId,
          kind: variant.kind,
          storageKey: `${directoryKey}/${fileName}`,
          mimeType: variant.mimeType,
          byteSize: variant.byteSize,
          width: variant.width,
          height: variant.height,
          sha256: variant.sha256,
          createdAt: variant.createdAt,
          updatedAt: variant.updatedAt
        },
        sourcePath: staged.filePath,
        destinationPath: storage.resolveStorageKey(`${directoryKey}/${fileName}`)
      };
    });
    const planned = {
      sourceId: sourceAsset.id,
      directory: destinationDirectory,
      asset: {
        id: targetId,
        contentSha256: sourceAsset.contentSha256,
        originalName: sourceAsset.originalName,
        sourceMimeType: sourceAsset.sourceMimeType,
        sourceByteSize: sourceAsset.sourceByteSize,
        width: sourceAsset.width,
        height: sourceAsset.height,
        storageDriver: "local",
        privacyMode: sourceAsset.privacyMode,
        status: "ready",
        safeMetadata: { ...(sourceAsset.safeMetadata || {}) },
        createdAt: sourceAsset.createdAt,
        updatedAt: sourceAsset.updatedAt
      },
      variants: variants.map((variant) => variant.descriptor),
      fileMoves: variants
    };
    newAssets.push(planned);
    byHash.set(sourceAsset.contentSha256, planned.asset);
  }
  return { idMap, newAssets, reusedCount };
}

function assertReusableAsset(sourceAsset, reusable, storage) {
  if (sourceAsset.privacyMode !== reusable.privacyMode) {
    throw restoreError("相同内容的现有媒体使用了不同的原图保存策略，无法安全复用。", "MEDIA_RESTORE_ASSET_CONFLICT");
  }
  const sourceVariants = new Map((sourceAsset.variants || []).map((variant) => [variant.kind, variant]));
  const reusableVariants = new Map((reusable.variants || []).map((variant) => [variant.kind, variant]));
  if (sourceVariants.size !== reusableVariants.size || [...sourceVariants.keys()].some((kind) => !reusableVariants.has(kind))) {
    throw restoreError("相同内容的现有媒体变体集合与归档不一致。", "MEDIA_RESTORE_ASSET_CONFLICT");
  }
  for (const [kind, source] of sourceVariants) {
    const current = reusableVariants.get(kind);
    const descriptorMatches = ["sha256", "mimeType", "byteSize", "width", "height"]
      .every((field) => String(current?.[field]) === String(source?.[field]));
    if (!descriptorMatches || !verifyStoredVariant(storage, current)) {
      throw restoreError("相同内容的现有媒体文件缺失、损坏或与归档预览不一致。", "MEDIA_RESTORE_ASSET_CONFLICT");
    }
  }
}

function verifyStoredVariant(storage, variant) {
  let descriptor;
  try {
    const filePath = storage.resolveStorageKey(variant.storageKey);
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== Number(variant.byteSize)) return false;
    const hash = createHash("sha256");
    const handle = fs.openSync(filePath, "r");
    try {
      const buffer = Buffer.allocUnsafe(64 * 1024);
      let bytesRead;
      while ((bytesRead = fs.readSync(handle, buffer, 0, buffer.length, null)) > 0) {
        hash.update(buffer.subarray(0, bytesRead));
      }
    } finally {
      fs.closeSync(handle);
    }
    descriptor = hash.digest("hex");
  } catch {
    return false;
  }
  return descriptor === variant.sha256;
}

function mapLinks(sourceLinks, memoryIdMap, assetIdMap) {
  const groups = new Map();
  const seen = new Set();
  for (const link of sourceLinks) {
    const memoryId = memoryIdMap.get(link.memoryId);
    const assetId = assetIdMap.get(link.assetId);
    if (!memoryId || !assetId) throw restoreError("媒体关联无法映射到恢复对象。", "MEDIA_RESTORE_REFERENCE_INVALID");
    const key = `${memoryId}\0${assetId}`;
    if (seen.has(key)) {
      throw restoreError("两项媒体在恢复时折叠成了同一关联，请先整理源归档。", "MEDIA_RESTORE_REFERENCE_COLLISION");
    }
    seen.add(key);
    const list = groups.get(memoryId) || [];
    if (list.length >= MAX_MEDIA_PER_MEMORY) {
      throw restoreError(
        `每件展品最多恢复 ${MAX_MEDIA_PER_MEMORY} 张图片。`,
        "MEDIA_RESTORE_MEDIA_LIMIT_EXCEEDED"
      );
    }
    list.push({
      restorePosition: link.position,
      assetId,
      role: link.role,
      caption: link.caption,
      altText: link.altText,
      backNote: link.backNote,
      metadata: { ...(link.metadata || {}) }
    });
    groups.set(memoryId, list);
  }
  for (const [memoryId, links] of groups) {
    groups.set(memoryId, links
      .sort((left, right) => left.restorePosition - right.restorePosition)
      .map(({ restorePosition, ...item }) => item));
  }
  return groups;
}

function buildObservationPlan(sourceObservations, memoryIdMap, assetIdMap, sourcePrivacyModes, store, createId) {
  const occupied = new Set();
  const output = [];
  for (const source of sourceObservations) {
    const privacyMode = sourcePrivacyModes.get(source.assetId);
    const privacyViolation = mediaObservationPolicyViolation(source, privacyMode);
    if (!privacyMode || privacyViolation) {
      throw restoreError(
        privacyViolation || "图片线索引用了未知媒体资产。",
        "MEDIA_RESTORE_OBSERVATION_PRIVACY_INVALID"
      );
    }
    let id = source.id;
    if (occupied.has(id) || store.getMediaObservation(id)) id = uniqueId("observation", occupied, createId, store.getMediaObservation);
    occupied.add(id);
    const assetId = assetIdMap.get(source.assetId);
    if (!assetId) throw restoreError("图片线索无法映射到媒体资产。", "MEDIA_RESTORE_REFERENCE_INVALID");
    const metadata = { ...(source.metadata || {}) };
    if (metadata.memoryId) {
      metadata.memoryId = memoryIdMap.get(metadata.memoryId);
      if (!metadata.memoryId) throw restoreError("图片线索无法映射到展品。", "MEDIA_RESTORE_REFERENCE_INVALID");
    }
    output.push({
      id,
      assetId,
      kind: source.kind,
      source: source.source,
      value: source.value,
      status: source.status,
      confidence: source.confidence,
      sensitive: source.sensitive,
      metadata,
      createdAt: source.createdAt,
      updatedAt: source.updatedAt
    });
  }
  return output;
}

function materializeAssetFiles(plans, movedDirectories) {
  for (const planned of plans) {
    fs.mkdirSync(path.dirname(planned.directory), { recursive: true });
    fs.mkdirSync(planned.directory, { recursive: false });
    movedDirectories.push(planned.directory);
    for (const move of planned.fileMoves) {
      if (!fs.statSync(move.sourcePath).isFile() || fs.existsSync(move.destinationPath)) {
        throw restoreError("媒体暂存文件不可用或目标已存在。", "MEDIA_RESTORE_FILE_CONFLICT");
      }
      fs.renameSync(move.sourcePath, move.destinationPath);
    }
  }
}

function cleanupMovedDirectories(directories) {
  for (const directory of directories.slice().reverse()) {
    try { fs.rmSync(directory, { recursive: true, force: true }); } catch { /* best effort after DB rollback */ }
  }
}

function listAllAssets(store) {
  const assets = [];
  let offset = 0;
  while (true) {
    const page = store.listMediaAssets({ limit: 500, offset });
    assets.push(...page);
    if (page.length < 500) return assets;
    offset += page.length;
  }
}

function uniqueId(prefix, occupied, createId, additionalCheck = null) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const id = requireId(createId(prefix), `${prefix}.id`);
    if (!occupied.has(id) && !(typeof additionalCheck === "function" && additionalCheck.call(null, id))) return id;
  }
  throw restoreError("无法为恢复对象生成唯一 ID。", "MEDIA_RESTORE_ID_EXHAUSTED");
}

function variantFileName(kind, mimeType) {
  if (kind === "display" || kind === "thumb") return `${kind}.webp`;
  const extension = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" })[mimeType];
  if (!extension) throw restoreError("媒体格式不受支持。", "MEDIA_RESTORE_MIME_UNSUPPORTED");
  return `original.${extension}`;
}

function assertPreparedArchiveLimits(prepared) {
  const limits = MEDIA_ARCHIVE_LIMITS;
  if (prepared.collection.memories.length > limits.maxMemories) {
    throw restoreError(
      `一次最多恢复 ${limits.maxMemories} 件展品。`,
      "MEDIA_RESTORE_TOO_MANY_MEMORIES"
    );
  }
  if (prepared.assets.length > limits.maxAssets ||
      prepared.links.length > limits.maxLinks ||
      prepared.mediaObservations.length > limits.maxObservations) {
    throw restoreError("归档业务记录超过恢复上限。", "MEDIA_RESTORE_LIMIT_EXCEEDED");
  }
  if (prepared.manifest.entries.length + 1 > limits.maxEntries) {
    throw restoreError("归档条目数量超过恢复上限。", "MEDIA_RESTORE_LIMIT_EXCEEDED");
  }

  let manifestBytes;
  try {
    manifestBytes = Buffer.byteLength(`${JSON.stringify(prepared.manifest, null, 2)}\n`, "utf8");
  } catch {
    throw restoreError("归档清单无法验证。", "MEDIA_RESTORE_NOT_PREPARED");
  }
  if (manifestBytes > limits.maxEntryBytes) {
    throw restoreError("归档清单超过单项字节上限。", "MEDIA_RESTORE_LIMIT_EXCEEDED");
  }
  let totalBytes = manifestBytes;
  for (const entry of prepared.manifest.entries) {
    const bytes = entry?.bytes;
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > limits.maxEntryBytes) {
      throw restoreError("归档条目字节数超过恢复上限。", "MEDIA_RESTORE_LIMIT_EXCEEDED");
    }
    totalBytes += bytes;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > limits.maxTotalBytes) {
      throw restoreError("归档总字节数超过恢复上限。", "MEDIA_RESTORE_LIMIT_EXCEEDED");
    }
  }
}

function assertDependencies({ prepared, store, storage, normalizeMemory, createId }) {
  if (!prepared?.verified || !prepared.collection || !Array.isArray(prepared.collection.memories)
      || !Array.isArray(prepared.assets) || !Array.isArray(prepared.links)
      || !Array.isArray(prepared.mediaObservations) || !Array.isArray(prepared.files?.variants)
      || !prepared.manifest || !Array.isArray(prepared.manifest.entries)) {
    throw restoreError("归档尚未完成全量验证。", "MEDIA_RESTORE_NOT_PREPARED");
  }
  if (!store || typeof store.withTransaction !== "function" || typeof store.importMemories !== "function"
      || !storage || typeof storage.resolveStorageKey !== "function"
      || typeof normalizeMemory !== "function" || typeof createId !== "function") {
    throw new TypeError("媒体恢复依赖不完整。");
  }
}

function requireId(value, name) {
  const id = String(value || "").trim();
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(id)) throw restoreError(`${name} 无效。`, "MEDIA_RESTORE_ID_INVALID");
  return id;
}

function validateFeatureBackup(label, backup, sourceIds, validate) {
  try {
    return validate(backup, sourceIds);
  } catch (cause) {
    throw restoreError(`${label}备份无法恢复：${cause.message}`, "MEDIA_RESTORE_FEATURE_INVALID", cause);
  }
}

function validateVoiceFeature(backup, sourceIds, oralHistories, validate) {
  const additionalAssetIds = oralHistories?.mode === "full"
    ? [...new Set(oralHistories.answers.map((answer) => requireId(answer?.assetId, "oral answer.assetId")))]
    : [];
  try {
    return validate(backup, sourceIds, { additionalAssetIds });
  } catch (cause) {
    throw restoreError(`声音备份无法恢复：${cause.message}`, "MEDIA_RESTORE_FEATURE_INVALID", cause);
  }
}

function validateOralHistoryFeature(backup, eventIds, voiceAssetIds, validate) {
  try {
    return validate(backup, { eventIds, voiceAssetIds });
  } catch (cause) {
    throw restoreError(`口述史备份无法恢复：${cause.message}`, "MEDIA_RESTORE_FEATURE_INVALID", cause);
  }
}

function validateCuratorAgentFeature(backup, memoryIds, eventIds, exhibitionIds, validate) {
  try {
    validateCuratorAgentArchiveState(backup, {
      mode: backup?.mode === "redacted-summary" ? "redacted" : "full",
      memoryIds,
      eventIds,
      exhibitionIds
    });
    const result = validate(backup);
    if (result && typeof result.then === "function") throw new TypeError("validateCuratorAgentBackup 必须同步执行。");
    if (result !== true) throw new TypeError("受限策展归档未通过业务校验。");
    return true;
  } catch (cause) {
    throw restoreError(`受限策展归档无法恢复：${cause.message}`, "MEDIA_RESTORE_FEATURE_INVALID", cause);
  }
}

function validateTimeCalibrationFeature(backup, sourceMemoryIds, sourceEventIds, validate) {
  try {
    return validate(backup, sourceMemoryIds, sourceEventIds);
  } catch (cause) {
    throw restoreError(`Time-calibration backup cannot be restored: ${cause.message}`, "MEDIA_RESTORE_FEATURE_INVALID", cause);
  }
}

function validateProvenanceRestoreFeature(backup, sourceMemoryIds, validate) {
  try {
    validateProvenanceBackupPayload(backup, backup?.mode === "full" ? { memoryIds: sourceMemoryIds } : {});
    if (backup?.mode === "full") {
      const result = validate(backup, sourceMemoryIds);
      if (result && typeof result.then === "function") {
        throw new TypeError("validateProvenanceBackup must run synchronously.");
      }
      if (result !== true) throw new TypeError("Provenance backup did not pass the injected validator.");
    }
    return true;
  } catch (cause) {
    throw restoreError(
      `Provenance backup cannot be restored: ${cause.message}`,
      "MEDIA_RESTORE_PROVENANCE_INVALID",
      cause
    );
  }
}

function validateCoMemoryResponseRestoreFeature(backup, sourceMemoryIds, validate) {
  try {
    validateCoMemoryResponseBackupPayload(backup, backup?.mode === "full" ? { memoryIds: sourceMemoryIds } : {});
    if (backup?.mode === "full") {
      const result = validate(backup, sourceMemoryIds);
      if (result && typeof result.then === "function") {
        throw new TypeError("validateCoMemoryResponseBackup must run synchronously.");
      }
      if (result !== true) throw new TypeError("Co-memory response backup did not pass the injected validator.");
    }
    return true;
  } catch (cause) {
    throw restoreError(
      `Co-memory response backup cannot be restored: ${cause.message}`,
      "MEDIA_RESTORE_CO_MEMORY_INVALID",
      cause
    );
  }
}

function assertCoMemoryIdentityMapping(backup, memoryIdMap) {
  if (!backup || backup.mode !== "full") return;
  for (const response of backup.responses) {
    const sourceMemoryId = requireId(response?.memoryId, "co-memory response.memoryId");
    if (memoryIdMap.get(sourceMemoryId) !== sourceMemoryId) {
      throw restoreError(
        "Encrypted co-memory responses cannot be restored onto a conflict-remapped memory.",
        "MEDIA_RESTORE_CO_MEMORY_REBIND_FORBIDDEN"
      );
    }
  }
}

function sourceArchaeologyEventIds(archaeology) {
  if (!archaeology || archaeology.mode !== "full" || !Array.isArray(archaeology.events)) {
    throw restoreError(
      "Full time-calibration restore requires full archaeology events.",
      "MEDIA_RESTORE_TIME_CALIBRATION_EVENT_MAP_REQUIRED"
    );
  }
  const ids = [];
  const seen = new Set();
  for (const event of archaeology.events) {
    const id = requireId(event?.id, "archaeology event.id");
    if (seen.has(id)) {
      throw restoreError("Archaeology event IDs must be unique.", "MEDIA_RESTORE_REFERENCE_COLLISION");
    }
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function sourceExhibitionIds(exhibitions) {
  if (!exhibitions || exhibitions.mode !== "full" || !Array.isArray(exhibitions.exhibitions)) {
    throw restoreError(
      "完整受限策展恢复需要完整主题展览边界。",
      "MEDIA_RESTORE_CURATOR_AGENT_EXHIBITION_MAP_REQUIRED"
    );
  }
  const ids = [];
  const seen = new Set();
  for (const exhibition of exhibitions.exhibitions) {
    const id = requireId(exhibition?.id, "exhibition.id");
    if (seen.has(id)) throw restoreError("主题展览 ID 不能重复。", "MEDIA_RESTORE_REFERENCE_COLLISION");
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function requireCompleteEventIdMap(value, sourceEventIds) {
  if (!isIdMapContainer(value)) {
    throw restoreError(
      "Archaeology restore did not return its event ID map.",
      "MEDIA_RESTORE_TIME_CALIBRATION_EVENT_MAP_REQUIRED"
    );
  }
  const entries = value instanceof Map ? [...value] : Object.entries(value);
  const sourceSet = new Set(sourceEventIds);
  const targetSet = new Set();
  const map = new Map();
  for (const [rawSourceId, rawTargetId] of entries) {
    const sourceId = requireId(rawSourceId, "archaeology event map source ID");
    const targetId = requireId(rawTargetId, "archaeology event map target ID");
    if (!sourceSet.has(sourceId) || map.has(sourceId) || targetSet.has(targetId)) {
      throw restoreError("Archaeology event ID map is invalid.", "MEDIA_RESTORE_TIME_CALIBRATION_EVENT_MAP_INVALID");
    }
    map.set(sourceId, targetId);
    targetSet.add(targetId);
  }
  if (map.size !== sourceEventIds.length || sourceEventIds.some((id) => !map.has(id))) {
    throw restoreError(
      "Archaeology event ID map is incomplete.",
      "MEDIA_RESTORE_TIME_CALIBRATION_EVENT_MAP_REQUIRED"
    );
  }
  return map;
}

function restoreError(message, code, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  error.statusCode = 400;
  return error;
}

module.exports = { restorePreparedArchive };
