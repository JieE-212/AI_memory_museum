"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createMemoryStore } = require("../database");
const { createMediaStorage } = require("../lib/media-storage");
const { createVoiceStorage } = require("../lib/voice-storage");
const { inspectVoice } = require("../lib/voice-format");
const { buildMediaArchive, prepareMediaArchive } = require("../lib/media-backup");
const { restorePreparedArchive } = require("../lib/media-restore");
const { validateArchaeologyBackup, restoreArchaeologyBackup } = require("../lib/archaeology-backup");
const { buildExhibitionPreview } = require("../lib/exhibition-curator");
const { buildClueBackup, remapClueBackup, validateClueBackup } = require("../lib/clue-backup");
const { memorySnapshotSha256 } = require("../lib/revision-backup");
const { buildSourceSetSha256, buildTimeCandidates } = require("../lib/time-calibration-service");

let assertions = 0;
const root = fs.mkdtempSync(path.join(os.tmpdir(), "time-isle-restore-"));
const halls = [{ id: "daily", name: "日常展厅", description: "测试" }];
let sourceStore;
let targetStore;
let failingStore;
let privacyConflictStore;
let corruptReusableStore;
let boundaryStore;
let privacyDefenseStore;
let exhibitionDefenseStore;
let exhibitionSourceStore;
let exhibitionTargetStore;
let revisitDefenseStore;
let revisitSourceStore;
let revisitTargetStore;
let entityDefenseStore;
let entitySourceStore;
let entityTargetStore;
let capsuleSourceStore;
let capsuleHandlerDefenseStore;
let capsuleTargetStore;
let capsuleMissingStore;
let capsuleCorruptStore;
let intentHandlerDefenseStore;
let intentTargetStore;
let intentIncompleteStore;
let calibrationHandlerDefenseStore;
let calibrationTargetStore;
let calibrationMapDefenseStore;
let calibrationIncompleteStore;
let calibrationRollbackStore;

function check(value, message) {
  assert.ok(value, message);
  assertions += 1;
}

function equal(actual, expected, message) {
  assert.equal(actual, expected, message);
  assertions += 1;
}

function deepEqual(actual, expected, message) {
  assert.deepEqual(actual, expected, message);
  assertions += 1;
}

async function main() {
  try {
    checkOralHistoryRestoreOrdering(path.join(root, "oral-history-order"));
    const source = createFixture(path.join(root, "source"));
    sourceStore = source.store;
    const archive = buildMediaArchive({
      collection: source.collection,
      store: source.store,
      storage: source.storage,
      appVersion: "4.0.0",
      schemaVersion: 4
    });

    const target = createTarget(path.join(root, "target"));
    targetStore = target.store;
    const firstPrepared = await prepareMediaArchive(archive, {
      stagingRoot: path.join(target.storage.root, ".restore", "first")
    });
    let idCounter = 0;
    const first = restorePreparedArchive({
      prepared: firstPrepared,
      store: target.store,
      storage: target.storage,
      normalizeMemory: normalizeMemory,
      validateArchaeologyBackup,
      restoreArchaeologyBackup,
      createId: (prefix) => `${prefix}-restored-${++idCounter}`
    });
    equal(first.imported, 1, "应恢复一件展品");
    equal(first.media.assetsCreated, 1, "首次恢复应创建媒体资产");
    equal(first.media.links, 1, "应恢复图片关联");
    equal(first.media.observations, 1, "应恢复图片区域证据");
    const restoredMemoryId = first.idMap.memories["memory-source"];
    const restoredMedia = target.store.listMediaForMemory(restoredMemoryId);
    equal(restoredMedia.length, 1, "恢复后的展品应能读取图片");
    check(restoredMedia[0].variants.every((variant) => fs.existsSync(target.storage.resolveStorageKey(variant.storageKey))), "所有媒体文件都应落在最终内容寻址目录");
    equal(target.store.listMediaObservations({ assetId: restoredMedia[0].assetId }).length, 1, "恢复后的媒体观察应可查询");

    const exhibitionDefense = createTarget(path.join(root, "exhibition-defense"));
    exhibitionDefenseStore = exhibitionDefense.store;
    const fullExhibitionShell = {
      ...firstPrepared,
      collection: {
        ...firstPrepared.collection,
        exhibitions: { mode: "full", schemaVersion: 5, exhibitions: [] }
      }
    };
    assert.throws(() => restorePreparedArchive({
      prepared: fullExhibitionShell,
      store: exhibitionDefense.store,
      storage: exhibitionDefense.storage,
      normalizeMemory,
      validateArchaeologyBackup,
      restoreArchaeologyBackup,
      createId: (prefix) => `${prefix}-missing-handler-${++idCounter}`
    }), (error) => error?.code === "MEDIA_RESTORE_EXHIBITION_HANDLER_REQUIRED");
    assertions += 1;
    equal(exhibitionDefense.store.listMemories().length, 0, "缺少展览恢复处理器时必须在任何写入前整包拒绝");

    const fullIntentShell = {
      ...firstPrepared,
      assets: [],
      links: [],
      mediaObservations: [],
      files: { ...firstPrepared.files, variants: [] },
      collection: {
        ...firstPrepared.collection,
        revisitIntents: {
          mode: "full",
          schemaVersion: 11,
          intents: [{
            memoryId: "memory-source",
            intent: "welcome",
            notBeforeLocalDate: "",
            notBeforeTimezone: "",
            createdAt: "2026-07-18T10:00:00.000Z",
            updatedAt: "2026-07-18T10:00:00.000Z"
          }]
        }
      }
    };
    const intentHandlerDefense = createTarget(path.join(root, "intent-handler-defense"));
    intentHandlerDefenseStore = intentHandlerDefense.store;
    assert.throws(() => restorePreparedArchive({
      prepared: fullIntentShell,
      store: intentHandlerDefense.store,
      storage: intentHandlerDefense.storage,
      normalizeMemory,
      validateArchaeologyBackup,
      restoreArchaeologyBackup,
      createId: (prefix) => `${prefix}-missing-intent-handler-${++idCounter}`
    }), (error) => error?.code === "MEDIA_RESTORE_REVISIT_INTENT_HANDLER_REQUIRED");
    assertions += 1;
    equal(intentHandlerDefense.store.listMemories().length, 0, "缺少回访意愿处理器时在物化文件和数据库写入前拒绝");

    const intentTarget = createTarget(path.join(root, "intent-target"));
    intentTargetStore = intentTarget.store;
    let validatedIntentIds = [];
    let restoredIntentMap = null;
    const restoredIntentArchive = restorePreparedArchive({
      prepared: fullIntentShell,
      store: intentTarget.store,
      storage: intentTarget.storage,
      normalizeMemory,
      validateArchaeologyBackup,
      restoreArchaeologyBackup,
      validateRevisitIntentBackup(backup, sourceIds) {
        validatedIntentIds = [...sourceIds];
        return backup.intents.length === 1;
      },
      restoreRevisitIntentBackup(backup, memoryIdMap) {
        restoredIntentMap = new Map(memoryIdMap);
        return { intents: backup.intents.length, skipped: 0, idMap: Object.fromEntries(memoryIdMap) };
      },
      createId: (prefix) => `${prefix}-intent-${++idCounter}`
    });
    deepEqual(validatedIntentIds, ["memory-source"], "回访意愿在恢复规划前按归档展品边界验真");
    equal(restoredIntentArchive.revisitIntents.intents, 1, "完整 .time-isle 在同一事务恢复回访意愿");
    equal(
      restoredIntentArchive.idMap.revisitIntents["memory-source"],
      restoredIntentArchive.idMap.memories["memory-source"],
      "回访意愿 ID 映射与本次恢复展品映射一致"
    );
    equal(restoredIntentMap.get("memory-source"), restoredIntentArchive.idMap.memories["memory-source"], "恢复处理器收到统一 memoryIdMap");

    const intentIncomplete = createTarget(path.join(root, "intent-incomplete"));
    intentIncompleteStore = intentIncomplete.store;
    assert.throws(() => restorePreparedArchive({
      prepared: fullIntentShell,
      store: intentIncomplete.store,
      storage: intentIncomplete.storage,
      normalizeMemory,
      validateArchaeologyBackup,
      restoreArchaeologyBackup,
      validateRevisitIntentBackup: () => true,
      restoreRevisitIntentBackup: () => ({ intents: 0, skipped: 1, idMap: {} }),
      createId: (prefix) => `${prefix}-incomplete-intent-${++idCounter}`
    }), (error) => error?.code === "MEDIA_RESTORE_REVISIT_INTENT_INCOMPLETE");
    assertions += 1;
    equal(intentIncomplete.store.listMemories().length, 0, "回访意愿 skipped 会回滚同一事务内的展品写入");
    const incompleteAssetRoot = path.join(intentIncomplete.storage.root, "assets");
    equal(countFiles(incompleteAssetRoot), 0, "回访意愿恢复失败会补偿本次物化媒体文件");

    const calibrationEventId = "event-time-calibration-source";
    const calibrationBasePrepared = await prepareMediaArchive(archive, {
      stagingRoot: path.join(root, "calibration-prepared-success")
    });
    const calibrationBackup = timeCalibrationRestoreBackup(calibrationBasePrepared.collection.memories[0]);
    const calibrationPrepared = {
      ...calibrationBasePrepared,
      manifest: { ...calibrationBasePrepared.manifest, mode: "full", schemaVersion: 12 },
      collection: {
        ...calibrationBasePrepared.collection,
        mode: "full",
        schemaVersion: 12,
        memories: [
          calibrationBasePrepared.collection.memories[0],
          normalizeMemory({
            id: "memory-time-calibration-second",
            title: "Second calibration memory",
            rawContent: "A second memory establishes the event boundary."
          })
        ],
        archaeology: {
          mode: "full",
          events: [{
            id: calibrationEventId,
            title: "Calibration event",
            summary: "Two memories mapped as one event.",
            status: "confirmed",
            metadata: {},
            createdAt: "2026-07-18T12:00:00.000Z",
            updatedAt: "2026-07-18T12:00:00.000Z",
            members: [{
              memoryId: "memory-source",
              position: 0,
              relation: "same_event",
              confirmationNote: "",
              confirmedAt: "2026-07-18T12:00:00.000Z",
              metadata: {}
            }, {
              memoryId: "memory-time-calibration-second",
              position: 1,
              relation: "same_event",
              confirmationNote: "",
              confirmedAt: "2026-07-18T12:00:00.000Z",
              metadata: {}
            }]
          }],
          claims: [],
          pairDecisions: [],
          questions: []
        },
        exhibitions: { mode: "full", schemaVersion: 5, exhibitions: [] },
        timeCalibrations: calibrationBackup
      }
    };
    const { exhibitions: _omittedCalibrationExhibitions, ...calibrationOnlyCollection } = calibrationPrepared.collection;
    const calibrationOnlyPrepared = { ...calibrationPrepared, collection: calibrationOnlyCollection };
    const freshCalibrationOnlyPrepared = async (label) => {
      const base = await prepareMediaArchive(archive, {
        stagingRoot: path.join(root, `calibration-prepared-${label}`)
      });
      return {
        ...calibrationOnlyPrepared,
        stagingRoot: base.stagingRoot,
        manifest: { ...base.manifest, mode: "full", schemaVersion: 12 },
        descriptor: base.descriptor,
        assets: base.assets,
        links: base.links,
        mediaObservations: base.mediaObservations,
        media_observations: base.media_observations,
        files: base.files
      };
    };

    const calibrationHandlerDefense = createTarget(path.join(root, "calibration-handler-defense"), 12);
    calibrationHandlerDefenseStore = calibrationHandlerDefense.store;
    assert.throws(() => restorePreparedArchive({
      prepared: calibrationOnlyPrepared,
      store: calibrationHandlerDefense.store,
      storage: calibrationHandlerDefense.storage,
      normalizeMemory,
      validateArchaeologyBackup,
      restoreArchaeologyBackup,
      createId: (prefix) => `${prefix}-missing-calibration-handler-${++idCounter}`
    }), (error) => error?.code === "MEDIA_RESTORE_TIME_CALIBRATION_HANDLER_REQUIRED");
    assertions += 1;
    equal(calibrationHandlerDefense.store.listMemories().length, 0, "missing calibration handlers fail before any memory write");
    equal(countFiles(path.join(calibrationHandlerDefense.storage.root, "assets")), 0, "missing calibration handlers fail before media materialization");

    const calibrationTarget = createTarget(path.join(root, "calibration-target"), 12);
    calibrationTargetStore = calibrationTarget.store;
    calibrationTarget.store.saveMemory(normalizeMemory({
      id: "memory-source",
      title: "Pre-existing source ID collision",
      rawContent: "This forces memory ID remapping."
    }));
    const originalGetCalibrationEvent = calibrationTarget.store.getMemoryEvent;
    calibrationTarget.store.getMemoryEvent = (eventId) => eventId === calibrationEventId
      ? { id: calibrationEventId }
      : originalGetCalibrationEvent(eventId);
    const calibrationOrder = [];
    const originalSaveCalibrationObservation = calibrationTarget.store.saveMediaObservation;
    calibrationTarget.store.saveMediaObservation = (...args) => {
      calibrationOrder.push("observations");
      return originalSaveCalibrationObservation(...args);
    };
    let validatedCalibrationBoundary = null;
    let capturedCalibrationMaps = null;
    const calibrationRestored = restorePreparedArchive({
      prepared: calibrationPrepared,
      store: calibrationTarget.store,
      storage: calibrationTarget.storage,
      normalizeMemory,
      validateArchaeologyBackup,
      restoreArchaeologyBackup(store, backup, memoryIdMap) {
        calibrationOrder.push("archaeology");
        return restoreArchaeologyBackup(store, backup, memoryIdMap);
      },
      validateTimeCalibrationBackup(backup, sourceMemoryIds, sourceEventIds) {
        validatedCalibrationBoundary = {
          memoryIds: [...sourceMemoryIds],
          eventIds: [...sourceEventIds]
        };
        return calibrationTarget.store.validateTimeCalibrationBackup(backup, sourceMemoryIds, sourceEventIds);
      },
      restoreTimeCalibrationBackup(backup, maps) {
        calibrationOrder.push("time-calibrations");
        capturedCalibrationMaps = {
          memoryIdMap: new Map(maps.memoryIdMap),
          eventIdMap: new Map(maps.eventIdMap)
        };
        return calibrationTarget.store.restoreTimeCalibrationBackup(backup, maps);
      },
      validateExhibitionBackup: calibrationTarget.store.validateExhibitionBackup,
      restoreExhibitionBackup(backup, memoryIdMap) {
        calibrationOrder.push("exhibitions");
        return calibrationTarget.store.restoreExhibitionBackup(backup, memoryIdMap);
      },
      createId: (prefix) => `${prefix}-calibration-${++idCounter}`
    });
    deepEqual(calibrationOrder, ["observations", "archaeology", "time-calibrations", "exhibitions"], "calibrations restore after media and archaeology but before downstream consumers");
    deepEqual(validatedCalibrationBoundary, {
      memoryIds: ["memory-source", "memory-time-calibration-second"],
      eventIds: [calibrationEventId]
    }, "calibration validation receives both frozen source boundaries before planning writes");
    const mappedCalibrationMemoryId = calibrationRestored.idMap.memories["memory-source"];
    check(mappedCalibrationMemoryId !== "memory-source", "memory target is remapped when its source ID collides");
    equal(capturedCalibrationMaps.memoryIdMap.get("memory-source"), mappedCalibrationMemoryId, "calibration restore receives the shared memory ID map");
    const mappedCalibrationEventId = capturedCalibrationMaps.eventIdMap.get(calibrationEventId);
    check(mappedCalibrationEventId && mappedCalibrationEventId !== calibrationEventId, "event target uses archaeology's remapped event ID");
    equal(calibrationRestored.timeCalibrations.calibrations, 2, "both memory and event calibrations restore in the archive transaction");
    check(Boolean(calibrationTarget.store.getTimeCalibrationForMemory(mappedCalibrationMemoryId)), "memory calibration points at the restored memory copy");
    check(Boolean(calibrationTarget.store.getTimeCalibrationForEvent(mappedCalibrationEventId)), "event calibration points at the restored archaeology event");
    equal(
      calibrationRestored.idMap.timeCalibrations[calibrationBackup.calibrations[0].id],
      calibrationTarget.store.getTimeCalibrationForEvent(mappedCalibrationEventId).id,
      "result exposes a direct calibration ID map"
    );

    const calibrationSourceMismatchPrepared = await freshCalibrationOnlyPrepared("source-mismatch");
    calibrationSourceMismatchPrepared.collection = {
      ...calibrationSourceMismatchPrepared.collection,
      timeCalibrations: {
        ...calibrationBackup,
        calibrations: calibrationBackup.calibrations.map((item, index) => ({
          ...item,
          currentSourceSetSha256: index === 0 ? "0".repeat(64) : item.currentSourceSetSha256
        }))
      }
    };
    const calibrationSourceMismatch = createTarget(path.join(root, "calibration-source-mismatch"), 12);
    assert.throws(() => restorePreparedArchive({
      prepared: calibrationSourceMismatchPrepared,
      store: calibrationSourceMismatch.store,
      storage: calibrationSourceMismatch.storage,
      normalizeMemory,
      validateArchaeologyBackup,
      restoreArchaeologyBackup,
      validateTimeCalibrationBackup: calibrationSourceMismatch.store.validateTimeCalibrationBackup,
      restoreTimeCalibrationBackup: calibrationSourceMismatch.store.restoreTimeCalibrationBackup,
      createId: (prefix) => `${prefix}-calibration-source-mismatch-${++idCounter}`
    }), (error) => error?.code === "CALIBRATION_ARCHIVE_SOURCES_MISMATCH");
    assertions += 1;
    assertEmptyCalibrationRestoreTarget(calibrationSourceMismatch, "archive source-boundary mismatch");
    calibrationSourceMismatch.store.close();

    const calibrationMapPrepared = await freshCalibrationOnlyPrepared("map-defense");
    const calibrationMapDefense = createTarget(path.join(root, "calibration-map-defense"), 12);
    calibrationMapDefenseStore = calibrationMapDefense.store;
    assert.throws(() => restorePreparedArchive({
      prepared: calibrationMapPrepared,
      store: calibrationMapDefense.store,
      storage: calibrationMapDefense.storage,
      normalizeMemory,
      validateArchaeologyBackup,
      restoreArchaeologyBackup: () => ({ events: 1, claims: 0, decisions: 0, questions: 0, skipped: 0, idMap: {} }),
      validateTimeCalibrationBackup: calibrationMapDefense.store.validateTimeCalibrationBackup,
      restoreTimeCalibrationBackup: () => { throw new Error("calibration restore must not run without an event map"); },
      createId: (prefix) => `${prefix}-calibration-map-defense-${++idCounter}`
    }), (error) => error?.code === "MEDIA_RESTORE_TIME_CALIBRATION_EVENT_MAP_REQUIRED");
    assertions += 1;
    assertEmptyCalibrationRestoreTarget(calibrationMapDefense, "missing archaeology event map");

    const calibrationIncompletePrepared = await freshCalibrationOnlyPrepared("incomplete");
    const calibrationIncomplete = createTarget(path.join(root, "calibration-incomplete"), 12);
    calibrationIncompleteStore = calibrationIncomplete.store;
    assert.throws(() => restorePreparedArchive({
      prepared: calibrationIncompletePrepared,
      store: calibrationIncomplete.store,
      storage: calibrationIncomplete.storage,
      normalizeMemory,
      validateArchaeologyBackup,
      restoreArchaeologyBackup,
      validateTimeCalibrationBackup: calibrationIncomplete.store.validateTimeCalibrationBackup,
      restoreTimeCalibrationBackup: () => ({ calibrations: 1, skipped: 1, idMap: { calibrations: {} } }),
      createId: (prefix) => `${prefix}-calibration-incomplete-${++idCounter}`
    }), (error) => error?.code === "MEDIA_RESTORE_TIME_CALIBRATION_INCOMPLETE");
    assertions += 1;
    assertEmptyCalibrationRestoreTarget(calibrationIncomplete, "incomplete calibration result");

    const calibrationRollbackPrepared = await freshCalibrationOnlyPrepared("rollback");
    const calibrationRollback = createTarget(path.join(root, "calibration-rollback"), 12);
    calibrationRollbackStore = calibrationRollback.store;
    assert.throws(() => restorePreparedArchive({
      prepared: calibrationRollbackPrepared,
      store: calibrationRollback.store,
      storage: calibrationRollback.storage,
      normalizeMemory,
      validateArchaeologyBackup,
      restoreArchaeologyBackup,
      validateTimeCalibrationBackup: calibrationRollback.store.validateTimeCalibrationBackup,
      restoreTimeCalibrationBackup(backup, maps) {
        calibrationRollback.store.restoreTimeCalibrationBackup({
          ...backup,
          calibrations: [backup.calibrations[0]]
        }, maps);
        throw new Error("forced failure after one calibration write");
      },
      createId: (prefix) => `${prefix}-calibration-rollback-${++idCounter}`
    }), /forced failure after one calibration write/);
    assertions += 1;
    assertEmptyCalibrationRestoreTarget(calibrationRollback, "failure after a partial calibration write");

    const malformedPrepared = {
      ...firstPrepared,
      collection: {
        ...firstPrepared.collection,
        memories: [
          firstPrepared.collection.memories[0],
          normalizeMemory({ id: "memory-malformed-second", title: "第二件展品", rawContent: "第二段可核对的原始记忆。" })
        ],
        exhibitions: malformedExhibitionBackup()
      }
    };
    assert.throws(() => restorePreparedArchive({
      prepared: malformedPrepared,
      store: exhibitionDefense.store,
      storage: exhibitionDefense.storage,
      normalizeMemory,
      validateArchaeologyBackup,
      restoreArchaeologyBackup,
      validateExhibitionBackup: exhibitionDefense.store.validateExhibitionBackup,
      restoreExhibitionBackup: exhibitionDefense.store.restoreExhibitionBackup,
      createId: (prefix) => `${prefix}-malformed-${++idCounter}`
    }), (error) => error?.code === "MEDIA_RESTORE_FEATURE_INVALID" && error.cause?.code === "EXHIBITION_LIMIT_INVALID");
    assertions += 1;
    equal(exhibitionDefense.store.listMemories().length, 0, "展览树深层损坏时不得写入展品");
    equal(exhibitionDefense.store.listMediaAssets({ limit: 20 }).length, 0, "展览树深层损坏时不得移动或登记媒体");

    const exhibitionSource = createExhibitionFixture(path.join(root, "exhibition-source"));
    exhibitionSourceStore = exhibitionSource.store;
    const exhibitionArchive = buildMediaArchive({
      collection: exhibitionSource.collection,
      store: exhibitionSource.store,
      storage: exhibitionSource.storage,
      appVersion: "5.0.0",
      schemaVersion: 5
    });
    const exhibitionTarget = createTarget(path.join(root, "exhibition-target"));
    exhibitionTargetStore = exhibitionTarget.store;
    const exhibitionPrepared = await prepareMediaArchive(exhibitionArchive, {
      stagingRoot: path.join(exhibitionTarget.storage.root, ".restore", "full-exhibition")
    });
    const exhibitionRestored = restorePreparedArchive({
      prepared: exhibitionPrepared,
      store: exhibitionTarget.store,
      storage: exhibitionTarget.storage,
      normalizeMemory,
      validateArchaeologyBackup,
      restoreArchaeologyBackup,
      validateExhibitionBackup: exhibitionTarget.store.validateExhibitionBackup,
      restoreExhibitionBackup: exhibitionTarget.store.restoreExhibitionBackup,
      createId: (prefix) => `${prefix}-exhibition-${++idCounter}`
    });
    equal(exhibitionRestored.imported, 2, "完整归档可在同一事务恢复展品与主题展览");
    equal(exhibitionRestored.exhibitions.exhibitions, 1, "非空主题展览被完整恢复");
    const restoredExhibitionId = exhibitionRestored.idMap.exhibitions[exhibitionSource.exhibition.id];
    const restoredExhibition = exhibitionTarget.store.getExhibition(restoredExhibitionId);
    check(restoredExhibition?.memoryIds.every((id) => Object.values(exhibitionRestored.idMap.memories).includes(id)), "主题展览恢复后重写全部展品 ID");

    const redactedArchive = buildMediaArchive({
      collection: {
        ...exhibitionSource.collection,
        mode: "redacted",
        exhibitions: exhibitionSource.store.buildExhibitionBackup("redacted")
      },
      store: exhibitionSource.store,
      storage: exhibitionSource.storage,
      appVersion: "5.0.0",
      schemaVersion: 5
    });
    const redactedPrepared = await prepareMediaArchive(redactedArchive, {
      stagingRoot: path.join(exhibitionTarget.storage.root, ".restore", "redacted-exhibition")
    });
    check(redactedPrepared.collection.exhibitions.mode === "redacted-summary" && !redactedPrepared.collection.exhibitions.exhibitions, "脱敏归档物理排除展览叙事、成员与原文引用");

    const revisitSource = createRevisitFixture(path.join(root, "revisit-source"));
    revisitSourceStore = revisitSource.store;
    const revisitArchive = buildMediaArchive({
      collection: revisitSource.collection,
      store: revisitSource.store,
      storage: revisitSource.storage,
      appVersion: "5.1.0",
      schemaVersion: 6
    });
    const revisitDefense = createTarget(path.join(root, "revisit-defense"));
    revisitDefenseStore = revisitDefense.store;
    const revisitPrepared = await prepareMediaArchive(revisitArchive, {
      stagingRoot: path.join(revisitDefense.storage.root, ".restore", "full-revisit")
    });
    deepEqual(
      revisitPrepared.manifest.sections.find((section) => section.name === "revisits"),
      { name: "revisits", path: "revisits/state.json", count: 1, required: true, version: 1 },
      "schema 6 非空回访备份应作为 required section 通过验真"
    );
    deepEqual(revisitPrepared.collection.revisits, revisitSource.collection.revisits, "prepare 应无损重挂非空回访备份");

    assert.throws(() => restorePreparedArchive({
      prepared: revisitPrepared,
      store: revisitDefense.store,
      storage: revisitDefense.storage,
      normalizeMemory,
      validateArchaeologyBackup,
      restoreArchaeologyBackup,
      validateExhibitionBackup: revisitDefense.store.validateExhibitionBackup,
      restoreExhibitionBackup: revisitDefense.store.restoreExhibitionBackup,
      createId: (prefix) => `${prefix}-missing-revisit-handler-${++idCounter}`
    }), (error) => error?.code === "MEDIA_RESTORE_REVISIT_HANDLER_REQUIRED");
    assertions += 1;
    equal(revisitDefense.store.listMemories().length, 0, "缺少回访处理器时不得写入展品");
    equal(revisitDefense.store.listMediaAssets({ limit: 20 }).length, 0, "缺少回访处理器时不得登记媒体");

    const invalidRevisitPrepared = {
      ...revisitPrepared,
      collection: {
        ...revisitPrepared.collection,
        revisits: {
          ...revisitPrepared.collection.revisits,
          states: revisitPrepared.collection.revisits.states.map((state, index) => (
            index === 0 ? { ...state, memoryId: "memory-outside-archive" } : state
          ))
        }
      }
    };
    assert.throws(() => restorePreparedArchive({
      prepared: invalidRevisitPrepared,
      store: revisitDefense.store,
      storage: revisitDefense.storage,
      normalizeMemory,
      validateArchaeologyBackup,
      restoreArchaeologyBackup,
      validateExhibitionBackup: revisitDefense.store.validateExhibitionBackup,
      restoreExhibitionBackup: revisitDefense.store.restoreExhibitionBackup,
      validateRevisitBackup: revisitDefense.store.validateRevisitBackup,
      restoreRevisitBackup: revisitDefense.store.restoreRevisitBackup,
      createId: (prefix) => `${prefix}-invalid-revisit-${++idCounter}`
    }), (error) => (
      error?.code === "MEDIA_RESTORE_FEATURE_INVALID"
        && error.cause?.code === "REVISIT_BACKUP_REFERENCE_INVALID"
    ));
    assertions += 1;
    equal(revisitDefense.store.listMemories().length, 0, "回访非法引用被包装为统一错误后仍须零展品写入");
    equal(revisitDefense.store.listMediaAssets({ limit: 20 }).length, 0, "回访非法引用必须在媒体登记前被拒绝");
    equal(revisitDefense.store.listRevisitStates().length, 0, "回访非法引用不得留下部分状态");
    check(revisitPrepared.files.variants.every((file) => fs.existsSync(file.filePath)), "回访校验失败后已验真媒体仍留在暂存区，未发生落盘移动");
    equal(fs.readdirSync(path.join(revisitDefense.storage.root, "assets")).length, 0, "回访校验失败不得在最终媒体目录落盘");

    const revisitTarget = createTarget(path.join(root, "revisit-target"));
    revisitTargetStore = revisitTarget.store;
    const revisitRoundtripPrepared = await prepareMediaArchive(revisitArchive, {
      stagingRoot: path.join(revisitTarget.storage.root, ".restore", "full-revisit")
    });
    const revisitRestored = restorePreparedArchive({
      prepared: revisitRoundtripPrepared,
      store: revisitTarget.store,
      storage: revisitTarget.storage,
      normalizeMemory,
      validateArchaeologyBackup,
      restoreArchaeologyBackup,
      validateExhibitionBackup: revisitTarget.store.validateExhibitionBackup,
      restoreExhibitionBackup: revisitTarget.store.restoreExhibitionBackup,
      validateRevisitBackup: revisitTarget.store.validateRevisitBackup,
      restoreRevisitBackup: revisitTarget.store.restoreRevisitBackup,
      createId: (prefix) => `${prefix}-revisit-roundtrip-${++idCounter}`
    });
    equal(revisitRestored.imported, 2, "schema 6 归档应完整恢复两件展品");
    equal(revisitRestored.media.assetsCreated, 1, "schema 6 回访往返不得影响媒体恢复");
    equal(revisitRestored.revisits.states, 1, "非空回访 section 应在同一事务恢复");
    const restoredRevisitMemoryId = revisitRestored.idMap.memories[revisitSource.revisitMemoryId];
    equal(revisitRestored.idMap.revisits[revisitSource.revisitMemoryId], restoredRevisitMemoryId, "回访恢复结果应暴露展品 ID 重写映射");
    const sourceRevisitState = revisitSource.store.getRevisitState(revisitSource.revisitMemoryId);
    const targetRevisitState = revisitTarget.store.getRevisitState(restoredRevisitMemoryId);
    deepEqual(
      { ...targetRevisitState, memoryId: revisitSource.revisitMemoryId },
      sourceRevisitState,
      "回访往返应保留查看次数、本地日期、时区与精确时间"
    );

    const entitySource = createEntityFixture(path.join(root, "entity-source"));
    entitySourceStore = entitySource.store;
    const entityArchive = buildMediaArchive({
      collection: entitySource.collection,
      store: entitySource.store,
      storage: entitySource.storage,
      appVersion: "6.0.0",
      schemaVersion: 7
    });
    const entityDefense = createTarget(path.join(root, "entity-defense"));
    entityDefenseStore = entityDefense.store;
    const entityPrepared = await prepareMediaArchive(entityArchive, {
      stagingRoot: path.join(entityDefense.storage.root, ".restore", "full-entities")
    });
    deepEqual(
      entityPrepared.manifest.sections.find((section) => section.name === "entities"),
      { name: "entities", path: "entities/state.json", count: 1, required: true, version: 1 },
      "schema 7 非空实体图应作为 required section 通过验真"
    );
    deepEqual(entityPrepared.entities, entitySource.collection.entities, "prepare 顶层应无损暴露非空实体图");
    deepEqual(
      entityPrepared.collection.entities,
      entityPrepared.entities,
      "prepared.collection.entities 与 prepared.entities 应保持等价"
    );

    assert.throws(() => restorePreparedArchive({
      prepared: entityPrepared,
      store: entityDefense.store,
      storage: entityDefense.storage,
      normalizeMemory,
      validateArchaeologyBackup,
      restoreArchaeologyBackup,
      validateExhibitionBackup: entityDefense.store.validateExhibitionBackup,
      restoreExhibitionBackup: entityDefense.store.restoreExhibitionBackup,
      validateRevisitBackup: entityDefense.store.validateRevisitBackup,
      restoreRevisitBackup: entityDefense.store.restoreRevisitBackup,
      restoreEntityBackup: () => ({ entities: 0, aliases: 0, memoryLinks: 0, idMap: {} }),
      createId: (prefix) => `${prefix}-missing-entity-validator-${++idCounter}`
    }), (error) => error?.code === "MEDIA_RESTORE_ENTITY_HANDLER_REQUIRED");
    assertions += 1;
    equal(entityDefense.store.listMemories().length, 0, "缺少实体 validate 处理器时必须在任何展品写入前拒绝");

    assert.throws(() => restorePreparedArchive({
      prepared: entityPrepared,
      store: entityDefense.store,
      storage: entityDefense.storage,
      normalizeMemory,
      validateArchaeologyBackup,
      restoreArchaeologyBackup,
      validateExhibitionBackup: entityDefense.store.validateExhibitionBackup,
      restoreExhibitionBackup: entityDefense.store.restoreExhibitionBackup,
      validateRevisitBackup: entityDefense.store.validateRevisitBackup,
      restoreRevisitBackup: entityDefense.store.restoreRevisitBackup,
      validateEntityBackup: validateClueBackup,
      createId: (prefix) => `${prefix}-missing-entity-restorer-${++idCounter}`
    }), (error) => error?.code === "MEDIA_RESTORE_ENTITY_HANDLER_REQUIRED");
    assertions += 1;
    equal(entityDefense.store.listMemories().length, 0, "缺少实体 restore 处理器时必须保持零展品写入");
    equal(entityDefense.store.listMediaAssets({ limit: 20 }).length, 0, "任一实体处理器缺失时不得登记媒体");

    const invalidEntityCollection = {
      ...entitySource.collection,
      entities: {
        ...entitySource.collection.entities,
        entities: entitySource.collection.entities.entities.map((entity, entityIndex) => ({
          ...entity,
          memoryLinks: entity.memoryLinks.map((link, linkIndex) => (
            entityIndex === 0 && linkIndex === 0 ? { ...link, memoryId: "memory-outside-archive" } : link
          ))
        }))
      }
    };
    const invalidEntityArchive = buildMediaArchive({
      collection: invalidEntityCollection,
      store: entitySource.store,
      storage: entitySource.storage,
      appVersion: "6.0.0",
      schemaVersion: 7
    });
    const invalidEntityPrepared = await prepareMediaArchive(invalidEntityArchive, {
      stagingRoot: path.join(entityDefense.storage.root, ".restore", "invalid-entity-reference")
    });
    assert.throws(() => restorePreparedArchive({
      prepared: invalidEntityPrepared,
      store: entityDefense.store,
      storage: entityDefense.storage,
      normalizeMemory,
      validateArchaeologyBackup,
      restoreArchaeologyBackup,
      validateExhibitionBackup: entityDefense.store.validateExhibitionBackup,
      restoreExhibitionBackup: entityDefense.store.restoreExhibitionBackup,
      validateRevisitBackup: entityDefense.store.validateRevisitBackup,
      restoreRevisitBackup: entityDefense.store.restoreRevisitBackup,
      validateEntityBackup: validateClueBackup,
      restoreEntityBackup: () => { throw new Error("非法实体备份不应进入 restore 处理器"); },
      createId: (prefix) => `${prefix}-invalid-entity-${++idCounter}`
    }), (error) => (
      error?.code === "MEDIA_RESTORE_FEATURE_INVALID"
        && error.cause?.code === "CLUE_BACKUP_REFERENCE_INVALID"
    ));
    assertions += 1;
    equal(entityDefense.store.listMemories().length, 0, "实体越界引用应在展品事务开始前被拒绝");
    equal(entityDefense.store.listMediaAssets({ limit: 20 }).length, 0, "实体越界引用应在媒体登记前被拒绝");
    check(invalidEntityPrepared.files.variants.every((file) => fs.existsSync(file.filePath)), "实体校验失败后媒体仍应留在已验真的暂存区");
    const entityDefenseAssets = path.join(entityDefense.storage.root, "assets");
    equal(fs.existsSync(entityDefenseAssets) ? fs.readdirSync(entityDefenseAssets).length : 0, 0, "实体校验失败不得在最终媒体目录落盘");

    const entityTarget = createTarget(path.join(root, "entity-target"));
    entityTargetStore = entityTarget.store;
    const entityRoundtripPrepared = await prepareMediaArchive(entityArchive, {
      stagingRoot: path.join(entityTarget.storage.root, ".restore", "full-entities")
    });
    let restoredEntityGraph = null;
    const restoreEntityGraph = (backup, memoryIdMap) => {
      const entityIdMap = Object.fromEntries(backup.entities.map((entity) => [entity.id, `restored-${entity.id}`]));
      const aliasIdMap = Object.fromEntries(backup.entities.flatMap((entity) => (
        entity.aliases.map((alias) => [alias.id, `restored-${alias.id}`])
      )));
      const remapped = remapClueBackup(backup, { memoryIdMap, entityIdMap, aliasIdMap });
      restoredEntityGraph = remapped.backup;
      return {
        entities: remapped.backup.entities.length,
        aliases: remapped.backup.entities.reduce((sum, entity) => sum + entity.aliases.length, 0),
        memoryLinks: remapped.backup.entities.reduce((sum, entity) => sum + entity.memoryLinks.length, 0),
        skipped: 0,
        idMap: remapped.idMap
      };
    };
    const entityRestored = restorePreparedArchive({
      prepared: entityRoundtripPrepared,
      store: entityTarget.store,
      storage: entityTarget.storage,
      normalizeMemory,
      validateArchaeologyBackup,
      restoreArchaeologyBackup,
      validateExhibitionBackup: entityTarget.store.validateExhibitionBackup,
      restoreExhibitionBackup: entityTarget.store.restoreExhibitionBackup,
      validateRevisitBackup: entityTarget.store.validateRevisitBackup,
      restoreRevisitBackup: entityTarget.store.restoreRevisitBackup,
      validateEntityBackup: validateClueBackup,
      restoreEntityBackup: restoreEntityGraph,
      createId: (prefix) => `${prefix}-entity-roundtrip-${++idCounter}`
    });
    equal(entityRestored.imported, 2, "schema 7 完整归档应恢复实体图边界内的两件展品");
    equal(entityRestored.media.assetsCreated, 1, "实体图往返不得影响媒体恢复");
    equal(entityRestored.entities.entities, 1, "非空实体 section 应在同一事务交给恢复处理器");
    equal(entityRestored.entities.aliases, 1, "实体别名应完整进入恢复处理器");
    equal(entityRestored.entities.memoryLinks, 1, "实体与展品关系应完整进入恢复处理器");
    const sourceEntity = entitySource.collection.entities.entities[0];
    const sourceAlias = sourceEntity.aliases[0];
    equal(entityRestored.idMap.entities[sourceEntity.id], `restored-${sourceEntity.id}`, "顶层恢复结果应直接暴露实体 ID 映射");
    equal(entityRestored.idMap.aliases[sourceAlias.id], `restored-${sourceAlias.id}`, "顶层恢复结果应直接暴露实体别名 ID 映射");
    equal(
      restoredEntityGraph.entities[0].memoryLinks[0].memoryId,
      entityRestored.idMap.memories[sourceEntity.memoryLinks[0].memoryId],
      "实体关系中的展品 ID 应按本次恢复映射重写"
    );
    equal(restoredEntityGraph.entities[0].canonicalName, sourceEntity.canonicalName, "非空实体图往返应保留规范名称");
    equal(restoredEntityGraph.entities[0].aliases[0].alias, sourceAlias.alias, "非空实体图往返应保留别名文本");

    const capsuleSource = createCapsuleFixture(path.join(root, "capsule-source"));
    capsuleSourceStore = capsuleSource.store;
    const capsuleArchive = buildMediaArchive({
      collection: capsuleSource.collection,
      store: capsuleSource.store,
      storage: capsuleSource.storage,
      voiceStorage: capsuleSource.voiceStorage,
      appVersion: "7.0.0",
      schemaVersion: 9
    });

    const capsuleHandlerDefense = createCapsuleTarget(path.join(root, "capsule-handler-defense"));
    capsuleHandlerDefenseStore = capsuleHandlerDefense.store;
    const capsuleHandlerPrepared = await prepareMediaArchive(capsuleArchive, {
      stagingRoot: path.join(capsuleHandlerDefense.storage.root, ".restore", "missing-capsule-handler"),
      validateVoiceBackup: capsuleSource.store.validateVoiceBackup
    });
    assert.throws(() => restorePreparedArchive({
      prepared: capsuleHandlerPrepared,
      ...capsuleRestoreDependencies(capsuleHandlerDefense),
      createId: (prefix) => `${prefix}-missing-capsule-handler-${++idCounter}`,
      validateCapsuleBackup: undefined,
      restoreCapsuleBackup: undefined
    }), (error) => error?.code === "MEDIA_RESTORE_CAPSULE_HANDLER_REQUIRED");
    assertions += 1;
    assertCapsuleTargetEmpty(capsuleHandlerDefense, "缺少胶囊处理器");

    const capsuleTarget = createCapsuleTarget(path.join(root, "capsule-target"));
    capsuleTargetStore = capsuleTarget.store;
    const seededConflicts = seedCapsuleRestoreConflicts(capsuleTarget, capsuleSource);
    const capsulePrepared = await prepareMediaArchive(capsuleArchive, {
      stagingRoot: path.join(capsuleTarget.storage.root, ".restore", "full-capsule"),
      validateVoiceBackup: capsuleSource.store.validateVoiceBackup
    });
    const capsuleRestored = restorePreparedArchive({
      prepared: capsulePrepared,
      ...capsuleRestoreDependencies(capsuleTarget),
      createId: (prefix) => `${prefix}-capsule-roundtrip-${++idCounter}`
    });
    equal(capsuleRestored.imported, capsuleSource.collection.memories.length, "schema 9 归档应在同一事务恢复胶囊依赖的全部展品");
    equal(capsuleRestored.capsules.capsules, 1, "完整胶囊 section 应恢复一个外壳与安全快照");
    equal(capsuleRestored.capsules.mediaLinks, 1, "完整胶囊 section 应恢复一个图片链接");
    const sourceCapsule = capsuleSource.collection.capsules.capsules[0];
    const restoredCapsuleId = capsuleRestored.idMap.capsules[sourceCapsule.id];
    check(Boolean(restoredCapsuleId), "顶层 idMap.capsules 应暴露源胶囊到目标胶囊的映射");
    equal(capsuleRestored.capsules.idMap[sourceCapsule.id], restoredCapsuleId, "胶囊结果与顶层 idMap 应暴露同一映射");
    check(restoredCapsuleId !== sourceCapsule.id, "目标胶囊 ID 冲突时应生成无碰撞 ID");
    const restoredCapsulePayload = capsuleTarget.store.getCapsulePayload(restoredCapsuleId);
    deepEqual(restoredCapsulePayload.snapshot, sourceCapsule.snapshot, "恢复应原样保留匿名安全快照");
    const mappedAssetId = capsuleRestored.idMap.assets[sourceCapsule.mediaLinks[0].assetId];
    check(mappedAssetId && mappedAssetId !== sourceCapsule.mediaLinks[0].assetId, "媒体 ID 冲突时应生成并暴露新资产映射");
    equal(restoredCapsulePayload.mediaLinks[0].assetId, mappedAssetId, "胶囊图片链接应使用本次媒体恢复映射");
    const mappedExhibitionId = capsuleRestored.idMap.exhibitions[sourceCapsule.exhibitionId];
    check(mappedExhibitionId && mappedExhibitionId !== sourceCapsule.exhibitionId, "展览 ID 冲突时应生成并暴露新展览映射");
    const restoredCapsuleRecord = capsuleTarget.store.buildCapsuleBackup("full").capsules
      .find((capsule) => capsule.id === restoredCapsuleId);
    equal(restoredCapsuleRecord.exhibitionId, mappedExhibitionId, "胶囊来源应重写为本次恢复得到的展览 ID");
    equal(capsuleTarget.store.listMemories().length, seededConflicts.memoryCount + capsuleRestored.imported, "胶囊成功恢复不应覆盖预先存在的展品");
    equal(capsuleTarget.store.getCapsuleStats().capsules, seededConflicts.capsuleCount + 1, "胶囊成功恢复应只新增归档内记录");

    const missingCapsuleCollection = structuredClone(capsuleSource.collection);
    missingCapsuleCollection.capsules.capsules[0].mediaLinks[0].assetId = "asset-capsule-missing";
    const missingCapsuleArchive = buildMediaArchive({
      collection: missingCapsuleCollection,
      store: capsuleSource.store,
      storage: capsuleSource.storage,
      voiceStorage: capsuleSource.voiceStorage,
      appVersion: "7.0.0",
      schemaVersion: 9
    });
    const capsuleMissing = createCapsuleTarget(path.join(root, "capsule-missing-reference"));
    capsuleMissingStore = capsuleMissing.store;
    const missingCapsulePrepared = await prepareMediaArchive(missingCapsuleArchive, {
      stagingRoot: path.join(capsuleMissing.storage.root, ".restore", "missing-reference"),
      validateVoiceBackup: capsuleSource.store.validateVoiceBackup
    });
    assert.throws(() => restorePreparedArchive({
      prepared: missingCapsulePrepared,
      ...capsuleRestoreDependencies(capsuleMissing),
      createId: (prefix) => `${prefix}-capsule-missing-${++idCounter}`
    }), (error) => error?.code === "CAPSULE_BACKUP_REFERENCE_INVALID");
    assertions += 1;
    assertCapsuleTargetEmpty(capsuleMissing, "胶囊缺少图片映射");
    equal(countFiles(path.join(capsuleMissing.storage.root, "assets")), 0, "胶囊缺少图片映射时已物化媒体必须清理");

    const corruptCapsuleCollection = structuredClone(capsuleSource.collection);
    corruptCapsuleCollection.capsules.capsules[0].mediaLinks[0].itemKey = "item-999";
    const corruptCapsuleArchive = buildMediaArchive({
      collection: corruptCapsuleCollection,
      store: capsuleSource.store,
      storage: capsuleSource.storage,
      voiceStorage: capsuleSource.voiceStorage,
      appVersion: "7.0.0",
      schemaVersion: 9
    });
    const capsuleCorrupt = createCapsuleTarget(path.join(root, "capsule-corrupt-reference"));
    capsuleCorruptStore = capsuleCorrupt.store;
    const corruptCapsulePrepared = await prepareMediaArchive(corruptCapsuleArchive, {
      stagingRoot: path.join(capsuleCorrupt.storage.root, ".restore", "corrupt-reference"),
      validateVoiceBackup: capsuleSource.store.validateVoiceBackup
    });
    assert.throws(() => restorePreparedArchive({
      prepared: corruptCapsulePrepared,
      ...capsuleRestoreDependencies(capsuleCorrupt),
      createId: (prefix) => `${prefix}-capsule-corrupt-${++idCounter}`
    }), (error) => (
      error?.code === "MEDIA_RESTORE_FEATURE_INVALID"
        && error.cause?.code === "CAPSULE_MEDIA_REFERENCE_INVALID"
    ));
    assertions += 1;
    assertCapsuleTargetEmpty(capsuleCorrupt, "胶囊匿名展品引用损坏");
    check(corruptCapsulePrepared.files.variants.every((file) => fs.existsSync(file.filePath)), "胶囊预校验失败时已验真媒体应留在暂存区");
    equal(countFiles(path.join(capsuleCorrupt.storage.root, "assets")), 0, "胶囊预校验失败不得在最终媒体目录落盘");

    const boundary = createTarget(path.join(root, "boundary"));
    boundaryStore = boundary.store;
    const boundaryArchive = buildMediaArchive({
      collection: boundaryCollection(500),
      appVersion: "4.0.0",
      schemaVersion: 4
    });
    const boundaryPrepared = await prepareMediaArchive(boundaryArchive, {
      stagingRoot: path.join(boundary.storage.root, ".restore", "five-hundred")
    });
    let boundaryId = 0;
    const boundaryResult = restorePreparedArchive({
      prepared: boundaryPrepared,
      store: boundary.store,
      storage: boundary.storage,
      normalizeMemory,
      validateArchaeologyBackup,
      restoreArchaeologyBackup,
      createId: (prefix) => `${prefix}-boundary-${++boundaryId}`
    });
    equal(boundaryResult.imported, 500, "默认共享上限应允许 500 件展品完整导出、prepare 与恢复");
    equal(boundary.store.listMemories().length, 500, "500 件边界恢复应在单次事务后全部可见");

    const tooManyPrepared = {
      ...boundaryPrepared,
      collection: boundaryCollection(501)
    };
    assert.throws(() => restorePreparedArchive({
      prepared: tooManyPrepared,
      store: boundary.store,
      storage: boundary.storage,
      normalizeMemory,
      validateArchaeologyBackup,
      restoreArchaeologyBackup,
      createId: (prefix) => `${prefix}-too-many-${++boundaryId}`
    }), (error) => error?.code === "MEDIA_RESTORE_TOO_MANY_MEMORIES");
    assertions += 1;
    equal(boundary.store.listMemories().length, 500, "第 501 件被拒绝时恢复目标必须零增量写入");

    const privacyDefense = createTarget(path.join(root, "privacy-defense"));
    privacyDefenseStore = privacyDefense.store;
    const maliciousPrepared = {
      ...firstPrepared,
      mediaObservations: firstPrepared.mediaObservations.map((observation, index) => (
        index === 0
          ? { ...observation, kind: "gps_coordinates", source: "user", status: "confirmed", sensitive: false }
          : observation
      ))
    };
    assert.throws(() => restorePreparedArchive({
      prepared: maliciousPrepared,
      store: privacyDefense.store,
      storage: privacyDefense.storage,
      normalizeMemory,
      validateArchaeologyBackup,
      restoreArchaeologyBackup,
      createId: (prefix) => `${prefix}-privacy-defense-${++boundaryId}`
    }), (error) => error?.code === "MEDIA_RESTORE_OBSERVATION_PRIVACY_INVALID");
    assertions += 1;
    equal(privacyDefense.store.listMemories().length, 0, "恢复层拒绝恶意 GPS descriptor 时不得写入展品");
    equal(privacyDefense.store.listMediaAssets({ limit: 20 }).length, 0, "恢复层拒绝恶意 GPS descriptor 时不得写入媒体");

    const secondPrepared = await prepareMediaArchive(archive, {
      stagingRoot: path.join(target.storage.root, ".restore", "second")
    });
    const second = restorePreparedArchive({
      prepared: secondPrepared,
      store: target.store,
      storage: target.storage,
      normalizeMemory,
      validateArchaeologyBackup,
      restoreArchaeologyBackup,
      createId: (prefix) => `${prefix}-restored-${++idCounter}`
    });
    equal(second.media.assetsCreated, 0, "相同 SHA-256 的图片应复用现有资产");
    equal(second.media.assetsReused, 1, "复用必须在结果中可见");
    equal(target.store.listMemories().length, 2, "ID 冲突的展品应作为新副本恢复");
    equal(target.store.listMediaAssets({ limit: 20 }).length, 1, "重复恢复不能复制相同媒体文件");

    const privacyConflict = createTarget(path.join(root, "privacy-conflict"));
    privacyConflictStore = privacyConflict.store;
    seedReusableAsset(privacyConflict, source, { privacyMode: "sanitized_only" });
    const privacyPrepared = await prepareMediaArchive(archive, {
      stagingRoot: path.join(privacyConflict.storage.root, ".restore", "privacy")
    });
    assert.throws(() => restorePreparedArchive({
      prepared: privacyPrepared,
      store: privacyConflict.store,
      storage: privacyConflict.storage,
      normalizeMemory,
      validateArchaeologyBackup,
      restoreArchaeologyBackup,
      createId: (prefix) => `${prefix}-privacy-${++idCounter}`
    }), (error) => error?.code === "MEDIA_RESTORE_ASSET_CONFLICT");
    assertions += 1;
    equal(privacyConflict.store.listMemories().length, 0, "隐私策略冲突时恢复必须零写入");

    const corruptReusable = createTarget(path.join(root, "corrupt-reusable"));
    corruptReusableStore = corruptReusable.store;
    const corruptedDisplay = seedReusableAsset(corruptReusable, source, { corruptKind: "display" });
    const corruptPrepared = await prepareMediaArchive(archive, {
      stagingRoot: path.join(corruptReusable.storage.root, ".restore", "corrupt")
    });
    assert.throws(() => restorePreparedArchive({
      prepared: corruptPrepared,
      store: corruptReusable.store,
      storage: corruptReusable.storage,
      normalizeMemory,
      validateArchaeologyBackup,
      restoreArchaeologyBackup,
      createId: (prefix) => `${prefix}-corrupt-${++idCounter}`
    }), (error) => error?.code === "MEDIA_RESTORE_ASSET_CONFLICT");
    assertions += 1;
    check(fs.existsSync(corruptedDisplay), "损坏的既有资产应保留给用户检查，不能用归档静默覆盖");
    equal(corruptReusable.store.listMemories().length, 0, "现有文件损坏时恢复必须零写入");

    const failing = createTarget(path.join(root, "failing"));
    failingStore = failing.store;
    const rejectedPrepared = await prepareMediaArchive(archive, {
      stagingRoot: path.join(failing.storage.root, ".restore", "rejected")
    });
    const originalCreate = failing.store.createMediaAsset;
    failing.store.createMediaAsset = () => { throw new Error("forced DB failure"); };
    assert.throws(() => restorePreparedArchive({
      prepared: rejectedPrepared,
      store: failing.store,
      storage: failing.storage,
      normalizeMemory,
      validateArchaeologyBackup,
      restoreArchaeologyBackup,
      createId: (prefix) => `${prefix}-rollback-${++idCounter}`
    }), /forced DB failure/);
    assertions += 1;
    failing.store.createMediaAsset = originalCreate;
    equal(failing.store.listMemories().length, 0, "DB 失败时展品事务必须回滚");
    equal(failing.store.listMediaAssets({ limit: 20 }).length, 0, "DB 失败时媒体记录必须回滚");
    const finalAssetRoot = path.join(failing.storage.root, "assets", source.asset.contentSha256.slice(0, 2));
    const leftovers = fs.existsSync(finalAssetRoot) ? fs.readdirSync(finalAssetRoot) : [];
    equal(leftovers.length, 0, "DB 失败时已移动的最终媒体目录必须删除");

    console.log(`Media restore checks passed: ${assertions} assertions.`);
  } finally {
    for (const store of [
      sourceStore,
      targetStore,
      failingStore,
      privacyConflictStore,
      corruptReusableStore,
      boundaryStore,
      privacyDefenseStore,
      exhibitionDefenseStore,
      exhibitionSourceStore,
      exhibitionTargetStore,
      revisitDefenseStore,
      revisitSourceStore,
      revisitTargetStore,
      entityDefenseStore,
      entitySourceStore,
      entityTargetStore,
      capsuleSourceStore,
      capsuleHandlerDefenseStore,
      capsuleTargetStore,
      capsuleMissingStore,
      capsuleCorruptStore,
      intentHandlerDefenseStore,
      intentTargetStore,
      intentIncompleteStore,
      calibrationHandlerDefenseStore,
      calibrationTargetStore,
      calibrationMapDefenseStore,
      calibrationIncompleteStore,
      calibrationRollbackStore
    ]) {
      try { store?.close(); } catch { /* already closed */ }
    }
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

function checkOralHistoryRestoreOrdering(directory) {
  fs.mkdirSync(directory, { recursive: true });
  const stagingRoot = path.join(directory, "staging");
  fs.mkdirSync(path.join(stagingRoot, "voices"), { recursive: true });
  const bytes = makeOralRestoreWebm(12_000);
  const inspected = inspectVoice(bytes, { declaredMimeType: "audio/webm" });
  const contentSha256 = sha256(bytes);
  const sourceVoiceId = "voice-oral-source";
  const sourceAsset = {
    id: sourceVoiceId,
    schemaVersion: 8,
    contentSha256,
    originalName: "private-oral.webm",
    mimeType: "audio/webm",
    codec: inspected.codec,
    byteSize: bytes.length,
    durationMs: inspected.durationMs,
    storageKey: `ready/${contentSha256.slice(0, 2)}/${contentSha256}.webm`,
    status: "ready",
    createdAt: "2026-07-18T10:00:00.000Z",
    updatedAt: "2026-07-18T10:00:00.000Z"
  };
  const stagedVoicePath = path.join(stagingRoot, "voices", "oral.webm");
  fs.writeFileSync(stagedVoicePath, bytes);
  const sourceMemory = normalizeMemory({
    id: "memory-oral-source",
    title: "口述史冲突展品",
    rawContent: "用于验证完整恢复顺序。",
    exhibitText: "完整恢复顺序。"
  });
  const oralHistories = {
    mode: "full",
    schemaVersion: 13,
    questions: [{ id: "oral-question-source", eventId: "event-oral-source" }],
    answers: [{ id: "oral-answer-source", assetId: sourceVoiceId }]
  };
  const prepared = {
    verified: true,
    stagingRoot,
    manifest: { mode: "full", schemaVersion: 13, entries: [] },
    collection: {
      memories: [sourceMemory],
      revisions: { mode: "full", schemaVersion: 10, revisions: [] },
      archaeology: {
        mode: "full",
        events: [{ id: "event-oral-source", members: [{ memoryId: sourceMemory.id }] }],
        claims: [],
        pairDecisions: [],
        questions: []
      },
      voices: { mode: "full", schemaVersion: 8, assets: [sourceAsset], memoryLinks: [], transcripts: [] },
      oralHistories,
      timeCalibrations: { mode: "full", schemaVersion: 12, calibrations: [] },
      exhibitions: { mode: "full", schemaVersion: 5, exhibitions: [] },
      revisits: { mode: "full", schemaVersion: 6, states: [] },
      revisitIntents: { mode: "full", schemaVersion: 11, intents: [] },
      entities: { mode: "full", schemaVersion: 7, entities: [] }
    },
    assets: [],
    links: [],
    mediaObservations: [],
    files: {
      variants: [],
      voices: [{
        assetId: sourceVoiceId,
        archivePath: `voices/assets/${sourceVoiceId}/audio.webm`,
        filePath: stagedVoicePath,
        byteSize: bytes.length,
        sha256: contentSha256,
        mimeType: "audio/webm",
        codec: inspected.codec,
        durationMs: inspected.durationMs
      }]
    }
  };
  const storage = createMediaStorage({ root: path.join(directory, "media") });
  const voiceStorage = createVoiceStorage({ root: path.join(directory, "voice") });
  const order = [];
  const captured = {};
  const store = {
    listMemories: () => [{ ...sourceMemory }],
    listMediaAssets: () => [],
    listMediaObservations: () => [],
    listVoiceAssets: () => [{
      ...sourceAsset,
      contentSha256: "f".repeat(64),
      storageKey: "ready/ff/preexisting.webm"
    }],
    getVoiceAssetByHash: () => null,
    getVoiceAsset: () => null,
    withTransaction(operation) { return operation(); },
    importMemories(memories) { order.push("memories"); captured.memories = memories; return { imported: memories.length, memories }; },
    createMediaAsset() {},
    replaceMemoryMedia() {},
    saveMediaObservation() {},
    getMemory(id) { return captured.memories?.find((memory) => memory.id === id) || null; }
  };
  const createId = (prefix) => ({
    memory: "memory-oral-remapped",
    voice: "voice-oral-remapped"
  })[prefix] || `${prefix}-remapped`;
  const base = {
    prepared,
    store,
    storage,
    voiceStorage,
    normalizeMemory,
    createId,
    validateRevisionBackup: () => true,
    restoreRevisionBackup(_backup, memoryIdMap) {
      order.push("revisions");
      captured.revisionMemoryMap = new Map(memoryIdMap);
      return { memories: 0, revisions: 0, skipped: 0, idMap: { memories: {}, revisions: {} } };
    },
    validateArchaeologyBackup: () => true,
    restoreArchaeologyBackup(_store, _backup, memoryIdMap) {
      order.push("archaeology");
      captured.archaeologyMemoryMap = new Map(memoryIdMap);
      return { events: 1, claims: 0, decisions: 0, questions: 0, skipped: 0, idMap: { events: { "event-oral-source": "event-oral-remapped" } } };
    },
    validateVoiceBackup: () => true,
    restoreVoiceBackup(_backup, options) {
      order.push("voices");
      captured.voiceOptions = options;
      return {
        assets: 1,
        assetsReused: 0,
        memoryLinks: 0,
        transcripts: 0,
        idMap: {
          memories: {},
          assets: Object.fromEntries(options.assetIdMap),
          storageKeys: Object.fromEntries(options.storageKeyMap)
        }
      };
    },
    validateOralHistoryBackup: () => true,
    restoreOralHistoryBackup(_backup, options) {
      order.push("oral-history");
      captured.oralOptions = options;
      return {
        questions: 1,
        answers: 1,
        skipped: 0,
        idMap: {
          questions: { "oral-question-source": "oral-question-remapped" },
          answers: { "oral-answer-source": "oral-answer-remapped" },
          questionKeys: {
            [`oral-question:${"a".repeat(64)}`]: `oral-question:${"b".repeat(64)}`
          }
        }
      };
    },
    validateTimeCalibrationBackup: () => true,
    restoreTimeCalibrationBackup(_backup, options) {
      order.push("time-calibrations");
      captured.timeOptions = options;
      return { calibrations: 0, skipped: 0, idMap: { calibrations: {} } };
    },
    validateExhibitionBackup: () => true,
    restoreExhibitionBackup() { order.push("exhibitions"); return { exhibitions: 0, skipped: 0, idMap: {} }; },
    validateRevisitBackup: () => true,
    restoreRevisitBackup() { order.push("revisits"); return { states: 0, skipped: 0, idMap: {} }; },
    validateRevisitIntentBackup: () => true,
    restoreRevisitIntentBackup() { order.push("revisit-intents"); return { intents: 0, skipped: 0, idMap: {} }; },
    validateEntityBackup: () => true,
    restoreEntityBackup() { order.push("entities"); return { entities: 0, aliases: 0, memoryLinks: 0, skipped: 0, idMap: {} }; }
  };

  const restored = restorePreparedArchive(base);
  deepEqual(order, [
    "memories", "revisions", "archaeology", "voices", "oral-history",
    "time-calibrations", "exhibitions", "revisits", "revisit-intents", "entities"
  ], "完整恢复冻结顺序为 memories/revisions/media → archaeology → voices → oral → time → 其余模块");
  deepEqual(Object.fromEntries(captured.oralOptions.memoryIdMap), { "memory-oral-source": "memory-oral-remapped" }, "口述恢复收到完整 memoryIdMap 以重写来源身份");
  deepEqual(Object.fromEntries(captured.oralOptions.eventIdMap), { "event-oral-source": "event-oral-remapped" }, "口述恢复收到考古 eventIdMap 以重算 questionKey");
  deepEqual(Object.fromEntries(captured.oralOptions.assetIdMap), { "voice-oral-source": "voice-oral-remapped" }, "口述恢复收到声音 assetIdMap 以重写回答引用");
  deepEqual(Object.fromEntries(captured.timeOptions.oralQuestionKeyMap), {
    [`oral-question:${"a".repeat(64)}`]: `oral-question:${"b".repeat(64)}`
  }, "时间校准恢复收到口述问题 old→new key 映射以重建归档来源键");
  deepEqual(captured.voiceOptions.additionalAssetIds, [sourceVoiceId], "声音恢复显式允许没有 memory_voice link 的口述资产");
  equal(restored.idMap.oralHistoryQuestions["oral-question-source"], "oral-question-remapped", "恢复结果公开完整问题 ID 映射");
  equal(restored.idMap.oralHistoryAnswers["oral-answer-source"], "oral-answer-remapped", "恢复结果公开完整回答 ID 映射");

  const blockedRoot = path.join(directory, "blocked-voice");
  const blockedVoiceStorage = createVoiceStorage({ root: blockedRoot });
  assert.throws(() => restorePreparedArchive({
    ...base,
    voiceStorage: blockedVoiceStorage,
    restoreOralHistoryBackup: undefined
  }), (error) => error?.code === "MEDIA_RESTORE_ORAL_HISTORY_HANDLER_REQUIRED");
  assertions += 1;
  equal(listRegularFiles(blockedRoot).length, 0, "缺口述恢复 handler 时在声音物化前整包拒绝");

  const rollbackRoot = path.join(directory, "rollback-voice");
  const rollbackVoiceStorage = createVoiceStorage({ root: rollbackRoot });
  assert.throws(() => restorePreparedArchive({
    ...base,
    voiceStorage: rollbackVoiceStorage,
    restoreOralHistoryBackup() {
      order.push("oral-history-failed");
      throw new Error("forced oral restore failure");
    }
  }), /forced oral restore failure/);
  assertions += 1;
  equal(listRegularFiles(rollbackRoot).length, 0, "口述 DB 恢复失败时删除本轮新物化声音文件");
}

function listRegularFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile());
}

function makeOralRestoreWebm(durationMs) {
  const opusHead = Buffer.alloc(19);
  opusHead.write("OpusHead", 0, "ascii");
  opusHead[8] = 1;
  opusHead[9] = 1;
  opusHead.writeUInt32LE(48_000, 12);
  const audio = oralEbmlElement("e1", Buffer.concat([oralEbmlUInt("9f", 1), oralEbmlFloat("b5", 48_000)]));
  const track = oralEbmlElement("ae", Buffer.concat([
    oralEbmlUInt("d7", 1),
    oralEbmlUInt("83", 2),
    oralEbmlElement("86", Buffer.from("A_OPUS")),
    oralEbmlElement("63a2", opusHead),
    audio
  ]));
  const segment = oralEbmlElement("18538067", Buffer.concat([
    oralEbmlElement("1549a966", Buffer.concat([oralEbmlUInt("2ad7b1", 1_000_000), oralEbmlFloat("4489", durationMs)])),
    oralEbmlElement("1654ae6b", track),
    oralEbmlElement("1f43b675", Buffer.concat([oralEbmlUInt("e7", 0), oralEbmlElement("a3", Buffer.from([0x81, 0, 0, 0x80, 0xf8]))]))
  ]));
  return Buffer.concat([oralEbmlElement("1a45dfa3", oralEbmlElement("4282", Buffer.from("webm"))), segment]);
}

function oralEbmlElement(id, payload) {
  return Buffer.concat([Buffer.from(id, "hex"), oralEbmlSize(payload.length), payload]);
}

function oralEbmlUInt(id, value) {
  let hex = BigInt(value).toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  return oralEbmlElement(id, Buffer.from(hex, "hex"));
}

function oralEbmlFloat(id, value) {
  const data = Buffer.alloc(8);
  data.writeDoubleBE(value);
  return oralEbmlElement(id, data);
}

function oralEbmlSize(value) {
  const number = BigInt(value);
  for (let width = 1; width <= 8; width += 1) {
    if (number >= (1n << BigInt(7 * width)) - 1n) continue;
    let marked = number | (1n << BigInt(7 * width));
    const output = Buffer.alloc(width);
    for (let index = width - 1; index >= 0; index -= 1) {
      output[index] = Number(marked & 0xffn);
      marked >>= 8n;
    }
    return output;
  }
  throw new Error("fixture too large");
}

function createFixture(directory) {
  fs.mkdirSync(directory, { recursive: true });
  const store = createMemoryStore({ dbPath: path.join(directory, "museum.sqlite"), halls, schemaVersion: 4 });
  const storage = createMediaStorage({ root: path.join(directory, "media") });
  const memory = store.saveMemory(normalizeMemory({
    id: "memory-source",
    title: "旧相册",
    rawContent: "翻开旧相册时，看见了那天的雨。",
    exhibitText: "一张被保存下来的旧照片。",
    date: "2024-06",
    tags: ["相册"]
  }));
  const data = createWebp(12, 8);
  const hash = sha256(data);
  const asset = {
    id: "asset-source-photo",
    contentSha256: hash,
    originalName: "旧相册.webp",
    sourceMimeType: "image/webp",
    sourceByteSize: data.length,
    width: 12,
    height: 8,
    storageDriver: "local",
    privacyMode: "preserve_original",
    status: "ready",
    safeMetadata: { canonicalVariant: "display", coordinateSpace: "canonical-preview-v1" }
  };
  const variants = ["original", "display", "thumb"].map((kind) => {
    const storageKey = `assets/source/${kind}.webp`;
    const filePath = storage.resolveStorageKey(storageKey);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, data);
    return { assetId: asset.id, kind, storageKey, mimeType: "image/webp", byteSize: data.length, width: 12, height: 8, sha256: hash };
  });
  store.createMediaAsset(asset, variants);
  store.attachMedia(memory.id, asset.id, { role: "cover", position: 0, caption: "雨天旧照", altText: "窗边的一张旧照片", backNote: "照片背面写着六月。", metadata: {} });
  store.saveMediaObservation({
    id: "observation-source-region",
    assetId: asset.id,
    kind: "image_region",
    source: "user",
    value: { label: "窗边", locator: { coordinateSpace: "canonical-preview-v1", x: 0.1, y: 0.1, width: 0.4, height: 0.4 } },
    status: "confirmed",
    confidence: 1,
    sensitive: false,
    metadata: { memoryId: memory.id }
  });
  const collection = {
    product: "时屿",
    version: "4.0.0",
    schemaVersion: 4,
    mode: "full",
    exportedAt: "2026-07-12T00:00:00.000Z",
    memories: [memory],
    archaeology: { mode: "full", events: [], claims: [], pairDecisions: [], questions: [] }
  };
  return { store, storage, collection, asset };
}

function createExhibitionFixture(directory) {
  const fixture = createFixture(directory);
  const second = fixture.store.saveMemory(normalizeMemory({
    id: "memory-exhibition-second",
    title: "雨停后的车站",
    rawContent: "雨停以后，我们在车站门口等了很久，最后一起走回旧街。",
    exhibitText: "雨停后一起回家的那段路。"
  }));
  const memories = [...fixture.collection.memories, second];
  const preview = buildExhibitionPreview(memories, { theme: "雨天与归途", title: "雨停以后" });
  const exhibition = fixture.store.createExhibition({ ...preview, confirmed: true });
  return {
    ...fixture,
    exhibition,
    collection: {
      ...fixture.collection,
      version: "5.0.0",
      schemaVersion: 5,
      memories,
      exhibitions: fixture.store.buildExhibitionBackup("full")
    }
  };
}

function createRevisitFixture(directory) {
  const fixture = createExhibitionFixture(directory);
  const revisitMemoryId = fixture.collection.memories[0].id;
  const localContext = { memoryId: revisitMemoryId, localDate: "2026-07-16", timezone: "Asia/Shanghai" };
  fixture.store.markRevisitViewed(localContext);
  fixture.store.markRevisitViewed(localContext);
  fixture.store.markRevisitDismissed(localContext);
  return {
    ...fixture,
    revisitMemoryId,
    collection: {
      ...fixture.collection,
      version: "5.1.0",
      schemaVersion: 6,
      revisits: fixture.store.buildRevisitBackup("full", fixture.collection.memories.map((memory) => memory.id))
    }
  };
}

function createEntityFixture(directory) {
  const fixture = createRevisitFixture(directory);
  const memoryId = fixture.collection.memories[0].id;
  return {
    ...fixture,
    collection: {
      ...fixture.collection,
      version: "6.0.0",
      schemaVersion: 7,
      entities: buildClueBackup(entityBackupSource(memoryId), "full", [memoryId])
    }
  };
}

function createCapsuleFixture(directory) {
  const fixture = createEntityFixture(directory);
  const publishedExhibition = fixture.store.updateExhibition(fixture.exhibition.id, {
    status: "published",
    confirm: true
  });
  const snapshot = capsuleSnapshotFixture();
  fixture.store.createCapsule({
    id: "capsule-source",
    title: snapshot.title,
    shellMessage: "等到那一天，再慢慢打开。",
    opensOn: "2040-02-29",
    timezone: "Asia/Shanghai",
    exhibitionId: publishedExhibition.id,
    snapshot,
    mediaLinks: [{
      assetId: fixture.asset.id,
      itemKey: "item-1",
      position: 0,
      altText: "窗边的一张旧照片",
      caption: "雨天旧照"
    }],
    confirm: true
  });
  const memoryIds = fixture.collection.memories.map((memory) => memory.id);
  return {
    ...fixture,
    exhibition: publishedExhibition,
    voiceStorage: createVoiceStorage({ root: path.join(directory, "voice") }),
    collection: {
      ...fixture.collection,
      version: "7.0.0",
      schemaVersion: 9,
      exhibitions: fixture.store.buildExhibitionBackup("full"),
      voices: fixture.store.buildVoiceBackup("full", memoryIds),
      capsules: fixture.store.buildCapsuleBackup("full")
    }
  };
}

function capsuleSnapshotFixture() {
  return {
    version: 1,
    title: "给未来的雨天展览",
    theme: "雨天与归途",
    opening: "等雨停以后，再一起走回旧街。",
    sections: [{
      key: "section-1",
      title: "第一章",
      summary: "匿名且经过确认的展览快照。",
      items: [{
        key: "item-1",
        title: "旧相册",
        excerpt: "翻开旧相册时，看见了那天的雨。",
        curatorNote: "留给未来。",
        confirmedQuotes: ["翻开旧相册时"],
        confirmedTranscripts: []
      }, {
        key: "item-2",
        title: "雨停后的车站",
        excerpt: "雨停以后，我们一起走回旧街。",
        curatorNote: "第二件展品。",
        confirmedQuotes: ["雨停以后"],
        confirmedTranscripts: []
      }]
    }]
  };
}

function createCapsuleTarget(directory) {
  const target = createTarget(directory);
  return {
    ...target,
    voiceStorage: createVoiceStorage({ root: path.join(directory, "voice") })
  };
}

function capsuleRestoreDependencies(target) {
  return {
    store: target.store,
    storage: target.storage,
    voiceStorage: target.voiceStorage,
    normalizeMemory,
    validateArchaeologyBackup,
    restoreArchaeologyBackup,
    validateExhibitionBackup: target.store.validateExhibitionBackup,
    restoreExhibitionBackup: target.store.restoreExhibitionBackup,
    validateRevisitBackup: target.store.validateRevisitBackup,
    restoreRevisitBackup: target.store.restoreRevisitBackup,
    validateEntityBackup: target.store.validateClueBackup,
    restoreEntityBackup: target.store.restoreClueBackup,
    validateVoiceBackup: target.store.validateVoiceBackup,
    restoreVoiceBackup: target.store.restoreVoiceBackup,
    validateCapsuleBackup: target.store.validateCapsuleBackup,
    restoreCapsuleBackup: target.store.restoreCapsuleBackup
  };
}

function seedCapsuleRestoreConflicts(target, source) {
  seedAssetIdCollision(target, source.asset.id);
  const memoryIdMap = {};
  for (const memory of source.collection.memories) {
    const targetId = `preexisting-${memory.id}`;
    target.store.saveMemory(normalizeMemory({
      ...memory,
      id: targetId,
      rawContent: memory.rawContent,
      exhibitText: memory.exhibitText
    }));
    memoryIdMap[memory.id] = targetId;
  }
  const seededExhibitions = target.store.restoreExhibitionBackup(source.collection.exhibitions, memoryIdMap);
  const sourceExhibitionId = source.collection.exhibitions.exhibitions[0].id;
  if (seededExhibitions.idMap[sourceExhibitionId] !== sourceExhibitionId) {
    throw new Error("胶囊恢复夹具未能预占源展览 ID。");
  }
  const sourceCapsule = source.collection.capsules.capsules[0];
  target.store.createCapsule({
    id: sourceCapsule.id,
    title: "预存同 ID 胶囊",
    shellMessage: "用于验证无碰撞恢复。",
    opensOn: "2039-01-01",
    timezone: "Asia/Shanghai",
    snapshot: sourceCapsule.snapshot,
    mediaLinks: [],
    confirm: true
  });
  return {
    memoryCount: target.store.listMemories().length,
    capsuleCount: target.store.getCapsuleStats().capsules
  };
}

function seedAssetIdCollision(target, assetId) {
  const data = createWebp(7, 5);
  const hash = sha256(data);
  const variants = ["original", "display", "thumb"].map((kind) => {
    const storageKey = `assets/preexisting/${assetId}/${kind}.webp`;
    const filePath = target.storage.resolveStorageKey(storageKey);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, data);
    return {
      assetId,
      kind,
      storageKey,
      mimeType: "image/webp",
      byteSize: data.length,
      width: 7,
      height: 5,
      sha256: hash
    };
  });
  target.store.createMediaAsset({
    id: assetId,
    contentSha256: hash,
    originalName: "预存冲突.webp",
    sourceMimeType: "image/webp",
    sourceByteSize: data.length,
    width: 7,
    height: 5,
    storageDriver: "local",
    privacyMode: "preserve_original",
    status: "ready",
    safeMetadata: { canonicalVariant: "display", coordinateSpace: "canonical-preview-v1" }
  }, variants);
}

function assertCapsuleTargetEmpty(target, reason) {
  equal(target.store.listMemories().length, 0, `${reason}时必须保持零展品写入`);
  equal(target.store.listMediaAssets({ limit: 20 }).length, 0, `${reason}时必须保持零媒体写入`);
  equal(target.store.listExhibitions().length, 0, `${reason}时必须保持零展览写入`);
  equal(target.store.listRevisitStates().length, 0, `${reason}时必须保持零回访写入`);
  deepEqual(
    target.store.getCapsuleStats(),
    { capsules: 0, payloads: 0, mediaLinks: 0, needsReview: 0 },
    `${reason}时必须保持胶囊三表零写入`
  );
}

function timeCalibrationRestoreBackup(memory) {
  const candidates = buildTimeCandidates({
    memories: [{
      id: memory.id,
      date: memory.date,
      snapshotSha256: memorySnapshotSha256(memory)
    }]
  });
  const currentSourceSetSha256 = buildSourceSetSha256(candidates);
  return {
    mode: "full",
    schemaVersion: 12,
    calibrations: [{
      id: "calibration-event-source",
      memoryId: "",
      eventId: "event-time-calibration-source",
      resolutionKind: "uncertain",
      intervalStart: "",
      intervalEnd: "",
      selectedSourceKeys: [],
      selectedSourceSnapshots: [],
      sourceSetSha256: "e".repeat(64),
      currentSourceSetSha256,
      note: "Event date remains uncertain.",
      createdAt: "2026-07-18T12:10:00.000Z",
      updatedAt: "2026-07-18T12:20:00.000Z"
    }, {
      id: "calibration-memory-source",
      memoryId: "memory-source",
      eventId: "",
      resolutionKind: "uncertain",
      intervalStart: "",
      intervalEnd: "",
      selectedSourceKeys: [],
      selectedSourceSnapshots: [],
      sourceSetSha256: "f".repeat(64),
      currentSourceSetSha256,
      note: "Memory date remains uncertain.",
      createdAt: "2026-07-18T12:10:00.000Z",
      updatedAt: "2026-07-18T12:20:00.000Z"
    }]
  };
}

function assertEmptyCalibrationRestoreTarget(target, reason) {
  equal(target.store.listMemories().length, 0, `${reason} must roll back memories`);
  equal(target.store.listMediaAssets({ limit: 20 }).length, 0, `${reason} must roll back media assets`);
  equal(target.store.listMediaObservations({ limit: 20 }).length, 0, `${reason} must roll back observations`);
  equal(target.store.listMemoryEvents().length, 0, `${reason} must roll back archaeology events`);
  equal(target.store.getTimeCalibrationStats().calibrations, 0, `${reason} must roll back calibrations`);
  equal(countFiles(path.join(target.storage.root, "assets")), 0, `${reason} must clean materialized media files`);
}

function countFiles(directory) {
  if (!fs.existsSync(directory)) return 0;
  return fs.readdirSync(directory, { withFileTypes: true }).reduce((count, entry) => {
    const entryPath = path.join(directory, entry.name);
    return count + (entry.isDirectory() ? countFiles(entryPath) : entry.isFile() ? 1 : 0);
  }, 0);
}

function entityBackupSource(memoryId) {
  const timestamp = "2026-07-16T00:00:00.000Z";
  return {
    entities: [{ id: "entity-archive-person", type: "person", canonicalName: "林岚" }],
    aliases: [{
      id: "alias-archive-person",
      entityId: "entity-archive-person",
      alias: "岚姨",
      source: "user",
      confirmedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp
    }],
    memoryLinks: [{
      entityId: "entity-archive-person",
      memoryId,
      sourceField: "people",
      mentionText: "岚姨",
      confirmedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp
    }]
  };
}

function malformedExhibitionBackup() {
  const timestamp = "2026-07-16T00:00:00.000Z";
  const item = (id, memoryId, quote) => ({
    id,
    memoryId,
    title: id,
    excerpt: "",
    curatorNote: "",
    citations: [{ id: `${id}-citation`, quote, startOffset: 0, endOffset: quote.length, evidenceValid: true, field: "rawContent", createdAt: timestamp }],
    createdAt: timestamp
  });
  const first = item("malformed-item-one", "memory-source", "翻开旧相册时");
  first.citations = null;
  return {
    mode: "full",
    schemaVersion: 5,
    exhibitions: [{
      id: "malformed-exhibition",
      title: "损坏展览",
      theme: "测试",
      opening: "应在媒体写入前被拒绝。",
      mode: "evidence-rules",
      status: "draft",
      needsReview: false,
      createdAt: timestamp,
      sections: [{
        id: "malformed-section",
        title: "第一章",
        summary: "",
        createdAt: timestamp,
        items: [first, item("malformed-item-two", "memory-malformed-second", "第二段可核对")]
      }]
    }]
  };
}

function createTarget(directory, schemaVersion = 4) {
  fs.mkdirSync(directory, { recursive: true });
  return {
    store: createMemoryStore({ dbPath: path.join(directory, "museum.sqlite"), halls, schemaVersion }),
    storage: createMediaStorage({ root: path.join(directory, "media") })
  };
}

function seedReusableAsset(target, source, options = {}) {
  const sourceAsset = source.store.getMediaAsset(source.asset.id);
  const privacyMode = options.privacyMode || sourceAsset.privacyMode;
  const sourceVariants = privacyMode === "sanitized_only"
    ? sourceAsset.variants.filter((variant) => variant.kind !== "original")
    : sourceAsset.variants;
  const targetId = `asset-existing-${privacyMode}`;
  const variants = sourceVariants.map((variant) => {
    const sourcePath = source.storage.resolveStorageKey(variant.storageKey);
    const data = fs.readFileSync(sourcePath);
    const storageKey = `assets/existing/${targetId}/${variant.kind}.webp`;
    const targetPath = target.storage.resolveStorageKey(storageKey);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, data);
    return { ...variant, assetId: targetId, storageKey };
  });
  target.store.createMediaAsset({
    id: targetId,
    contentSha256: sourceAsset.contentSha256,
    originalName: sourceAsset.originalName,
    sourceMimeType: sourceAsset.sourceMimeType,
    sourceByteSize: sourceAsset.sourceByteSize,
    width: sourceAsset.width,
    height: sourceAsset.height,
    storageDriver: sourceAsset.storageDriver,
    privacyMode,
    status: "ready",
    safeMetadata: sourceAsset.safeMetadata,
    createdAt: sourceAsset.createdAt,
    updatedAt: sourceAsset.updatedAt
  }, variants);
  const corrupt = variants.find((variant) => variant.kind === options.corruptKind);
  if (!corrupt) return "";
  const corruptPath = target.storage.resolveStorageKey(corrupt.storageKey);
  const bytes = fs.readFileSync(corruptPath);
  bytes[bytes.length - 1] ^= 0x01;
  fs.writeFileSync(corruptPath, bytes);
  return corruptPath;
}

function boundaryCollection(count) {
  return {
    product: "时屿",
    version: "4.0.0",
    schemaVersion: 4,
    mode: "redacted",
    exportedAt: "2026-07-12T00:00:00.000Z",
    memories: Array.from({ length: count }, (_, index) => ({
      id: `memory-boundary-${String(index + 1).padStart(3, "0")}`,
      title: `边界展品 ${index + 1}`,
      rawContent: "[已隐藏原始记忆]",
      attachments: [],
      media: []
    }))
  };
}

function normalizeMemory(input = {}) {
  const now = "2026-07-12T00:00:00.000Z";
  return {
    schemaVersion: 4,
    id: input.id,
    title: String(input.title || "未命名记忆"),
    hall: "daily",
    sourceType: "其他",
    rawContent: String(input.rawContent || ""),
    exhibitText: String(input.exhibitText || input.rawContent || ""),
    date: String(input.date || ""),
    location: String(input.location || ""),
    people: Array.isArray(input.people) ? input.people : [],
    tags: Array.isArray(input.tags) ? input.tags : [],
    emotions: Array.isArray(input.emotions) ? input.emotions : [],
    emotionIntensity: 3,
    importance: 2,
    favorite: false,
    coverImage: "",
    mediaNote: "",
    attachments: [],
    agentRunId: "",
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || ""
  };
}

function createWebp(width, height) {
  const frame = Buffer.alloc(10);
  frame[3] = 0x9d;
  frame[4] = 0x01;
  frame[5] = 0x2a;
  frame.writeUInt16LE(width, 6);
  frame.writeUInt16LE(height, 8);
  const chunk = Buffer.alloc(18);
  chunk.write("VP8 ", 0, 4, "ascii");
  chunk.writeUInt32LE(frame.length, 4);
  frame.copy(chunk, 8);
  const body = Buffer.concat([Buffer.from("WEBP", "ascii"), chunk]);
  const header = Buffer.alloc(8);
  header.write("RIFF", 0, 4, "ascii");
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

function sha256(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
