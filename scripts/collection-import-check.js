"use strict";

const assert = require("node:assert/strict");
const { createCollectionImporter } = require("../lib/collection-import");
const { createCollectionExporter } = require("../lib/collection-export");
const { ORAL_HISTORY_REDACTED_NOTE } = require("../lib/oral-history-backup");

let assertionCount = 0;

function run() {
  checkSchema11Export();
  checkSchema12Export();
  checkSchema13Export();
  checkPrimitiveBodies();
  checkHardImportLimit();
  checkSchemaEnvelope();
  checkEntityRestoreModes();
  checkVoiceImportModes();
  checkCapsuleImportModes();
  checkRevisitIntentImportModes();
  checkTimeCalibrationImportModes();
  checkOralHistoryImportModes();
  checkDuplicateReferenceIds();
  checkFeaturePrevalidation();
  checkConflictMapping();
  checkAtomicRollbackAndSafeCompensation();
  checkSkippedRestores();
  checkSuccessfulResult();
  console.log(`Collection import checks passed: ${assertionCount} assertions.`);
}

function checkSchema13Export() {
  const calls = { oral: [], voice: [] };
  const store = {
    buildExhibitionBackup: (mode) => ({ mode, exhibitions: [] }),
    buildRevisitBackup: (mode) => ({ mode, states: [] }),
    buildClueBackup: (mode) => ({ mode, entities: [] }),
    buildVoiceBackup(mode, memoryIds, options) {
      calls.voice.push({ mode, memoryIds, options });
      return mode === "redacted"
        ? { mode: "redacted-summary", assetCount: 1 }
        : { mode: "full", schemaVersion: 8, assets: [], memoryLinks: [], transcripts: [] };
    },
    buildCapsuleBackup: (mode) => ({ mode, capsules: [] }),
    buildRevisionBackup: (mode) => ({ mode, revisions: [] }),
    buildRevisitIntentBackup: (mode) => ({ mode, intents: [] }),
    buildTimeCalibrationBackup: (mode) => ({ mode, calibrations: [] }),
    buildOralHistoryBackup(mode, eventIds) {
      calls.oral.push({ mode, eventIds });
      return mode === "redacted"
        ? { mode: "redacted-summary", questionCount: 1, answerCount: 1, confirmedAnswerCount: 1, note: ORAL_HISTORY_REDACTED_NOTE }
        : {
            mode: "full",
            schemaVersion: 13,
            questions: [],
            answers: [{ assetId: "voice-oral-only" }]
          };
    }
  };
  const build = createCollectionExporter({
    store,
    appVersion: "9.0.0",
    schemaVersion: 13,
    buildArchaeologyBackup: (_store, _memories, mode) => mode === "redacted"
      ? { mode: "redacted-summary" }
      : { mode: "full", events: [{ id: "event-export-oral" }], claims: [], pairDecisions: [], questions: [] }
  });
  const memories = [memory("export-oral")];
  const full = build(memories, "full");
  same(calls.oral[0], { mode: "full", eventIds: ["event-export-oral"] }, "schema 13 口述史导出严格限制在考古事件边界");
  same(calls.voice[0].options, { additionalAssetIds: ["voice-oral-only"] }, "没有 memory_voice link 的口述声音仍显式进入声音真文件归档边界");
  same(Object.keys(full.oralHistories).sort(), ["answers", "mode", "questions", "schemaVersion"], "schema 13 full JSON 显式导出口述问题与回答 exact 根");
  const redacted = build(memories, "redacted");
  same(Object.keys(redacted.oralHistories).sort(), ["answerCount", "confirmedAnswerCount", "mode", "note", "questionCount"], "schema 13 脱敏 JSON 只保留固定口述安全计数");
  same(calls.voice[1].options, { additionalAssetIds: [] }, "脱敏导出不向声音层传递口述资产 ID");

  const missing = { ...store };
  delete missing.buildOralHistoryBackup;
  const broken = createCollectionExporter({ store: missing, appVersion: "9.0.0", schemaVersion: 13, buildArchaeologyBackup: () => ({}) });
  assert.throws(() => broken(memories, "full"), /oral-history backup support/u, "schema 13 导出缺少口述史处理器时 fail closed");
  assertionCount += 1;
}

function checkOralHistoryImportModes() {
  const required = {
    entities: fullBackup(),
    voices: {
      mode: "full",
      schemaVersion: 8,
      assets: [{ id: "voice-oral-json" }],
      memoryLinks: [],
      transcripts: []
    },
    capsules: { mode: "full", schemaVersion: 9, capsules: [] },
    revisions: { mode: "full", schemaVersion: 10, revisions: [] },
    revisitIntents: { mode: "full", schemaVersion: 11, intents: [] },
    timeCalibrations: { mode: "full", schemaVersion: 12, calibrations: [] },
    archaeology: { mode: "full", events: [{ id: "event-oral-json", members: [{ memoryId: "source-oral-json" }] }], claims: [], pairDecisions: [], questions: [] }
  };
  const oral = {
    mode: "full",
    schemaVersion: 13,
    questions: [],
    answers: [{ assetId: "voice-oral-json" }]
  };
  const missing = createFixture({ schemaVersion: 13 });
  const missingError = captureError(() => missing.importCollection({
    schemaVersion: 13,
    mode: "full",
    memories: [memory("source-oral-json")],
    ...required
  }));
  ok(missingError?.statusCode === 400 && missingError.message.includes("oralHistories"), "schema 13 full 即使零条口述史也必须显式声明 oralHistories");
  ok(missing.calls.normalizes === 0 && missing.calls.transactions === 0, "缺失口述史在规范化和事务前拒绝");

  const full = createFixture({ schemaVersion: 13 });
  const result = full.importCollection({
    schemaVersion: 13,
    mode: "full",
    memories: [memory("source-oral-json")],
    ...required,
    oralHistories: oral
  });
  ok(full.calls.validations.oralHistories === 1 && !full.calls.events.includes("normalize"), "口述史完成全部只读验真后在任何展品规范化前短路");
  same(full.calls.oralBoundaries, { eventIds: ["event-oral-json"], voiceAssetIds: ["voice-oral-json"] }, "JSON 口述史 validator 同时收到事件与声音资产边界");
  ok(result.imported === 0 && result.memories.length === 0 && result.oralHistories.questions === 0 && result.oralHistories.answers === 0 && result.oralHistories.requiresTimeIsle === true && result.oralHistories.skipped === 1, "含口述史的 full JSON 整包返回 requiresTimeIsle 且零记录写入");
  ok(full.calls.normalizes === 0 && full.calls.transactions === 0 && full.calls.imports === 0, "非空口述史预检在 normalize、transaction 与 importMemories 前短路");
  ok(Object.values(full.calls.restores).every((count) => count === 0), "非空口述史预检不会半恢复考古、展览、回访、实体、年轮、意愿或时间校准");
  ok(full.state.memories.size === 0 && result.archaeology.events === 0 && result.timeCalibrations.calibrations === 0, "非空口述史 JSON 保持馆藏与所有依赖模块零写入");

  const empty = createFixture({ schemaVersion: 13 });
  const emptyResult = empty.importCollection({
    schemaVersion: 13,
    mode: "full",
    memories: [memory("source-oral-json")],
    ...required,
    oralHistories: { mode: "full", schemaVersion: 13, questions: [], answers: [] }
  });
  ok(emptyResult.imported === 1 && empty.calls.transactions === 1 && empty.calls.imports === 1, "schema 13 空口述史继续允许兼容 JSON 导入普通馆藏");

  const redacted = createFixture({ schemaVersion: 13 });
  const redactedResult = redacted.importCollection({
    schemaVersion: 13,
    mode: "redacted",
    memories: [memory("source-oral-redacted")],
    entities: { mode: "redacted-summary" },
    voices: { mode: "redacted-summary", assetCount: 1 },
    capsules: { mode: "redacted-summary", capsuleCount: 0 },
    revisions: { mode: "redacted-summary", revisionCount: 0 },
    revisitIntents: { mode: "redacted-summary", intentCount: 0, note: "fixed" },
    timeCalibrations: { mode: "redacted-summary", calibrationCount: 0, uncertainCount: 0, alternativesCount: 0, note: "fixed" },
    oralHistories: { mode: "redacted-summary", questionCount: 2, answerCount: 3, confirmedAnswerCount: 1, note: ORAL_HISTORY_REDACTED_NOTE }
  });
  ok(redactedResult.oralHistories.summarized === true && redactedResult.oralHistories.requiresTimeIsle === false, "脱敏 JSON 只承认安全计数而不恢复口述内容");

  const legacy = createFixture({ schemaVersion: 12 });
  const legacyError = captureError(() => legacy.importCollection({
    schemaVersion: 12,
    mode: "full",
    memories: [],
    oralHistories: oral
  }));
  ok(legacyError?.statusCode === 400 && legacyError.message.includes("oralHistories"), "schema 12 伪装携带口述史字段被版本 gate 拒绝");

  const unknown = createFixture({ schemaVersion: 13 });
  const unknownError = captureError(() => unknown.importCollection({
    schemaVersion: 13,
    mode: "full",
    memories: [memory("source-oral-json")],
    ...required,
    oralHistories: { ...oral, leakedTranscript: "秘密" }
  }));
  ok(unknownError?.statusCode === 400 && unknown.calls.normalizes === 0, "口述史 exact 根出现未知字段时零写入拒绝");
}

function checkSchema12Export() {
  const calls = [];
  const store = {
    buildExhibitionBackup: (mode) => ({ mode, exhibitions: [] }),
    buildRevisitBackup: (mode) => ({ mode, states: [] }),
    buildClueBackup: (mode) => ({ mode, entities: [] }),
    buildVoiceBackup: (mode) => ({ mode, assets: [] }),
    buildCapsuleBackup: (mode) => ({ mode, capsules: [] }),
    buildRevisionBackup: (mode) => ({ mode, revisions: [] }),
    buildRevisitIntentBackup: (mode) => ({ mode, intents: [] }),
    buildTimeCalibrationBackup(mode, memoryIds) {
      calls.push({ mode, memoryIds });
      return mode === "redacted"
        ? { mode: "redacted-summary", calibrationCount: 1, uncertainCount: 0, alternativesCount: 1, note: "固定说明" }
        : { mode: "full", schemaVersion: 12, calibrations: [] };
    }
  };
  const build = createCollectionExporter({
    store,
    appVersion: "8.0.0",
    schemaVersion: 12,
    buildArchaeologyBackup: () => ({ mode: "full", events: [], claims: [], pairDecisions: [], questions: [] })
  });
  const memories = [memory("export-calibration")];
  const full = build(memories, "full");
  same(full.timeCalibrations, { mode: "full", schemaVersion: 12, calibrations: [] }, "schema 12 full JSON 显式导出 timeCalibrations");
  same(calls[0], { mode: "full", memoryIds: ["export-calibration"] }, "完整时间校准导出严格限制在本次展品边界");
  const redacted = build(memories, "redacted");
  same(Object.keys(redacted.timeCalibrations).sort(), ["alternativesCount", "calibrationCount", "mode", "note", "uncertainCount"], "schema 12 脱敏 JSON 只导出固定计数摘要");
  same(calls[1], { mode: "redacted", memoryIds: ["export-calibration"] }, "脱敏时间校准使用同一展品边界");

  const missing = { ...store };
  delete missing.buildTimeCalibrationBackup;
  const broken = createCollectionExporter({ store: missing, appVersion: "8.0.0", schemaVersion: 12, buildArchaeologyBackup: () => ({}) });
  assert.throws(() => broken(memories, "full"), /time calibration backup support/u, "schema 12 导出缺少时间校准处理器时 fail closed");
  assertionCount += 1;
}

function checkTimeCalibrationImportModes() {
  const required = {
    entities: fullBackup(),
    voices: { mode: "full", assetCount: 0, assets: [] },
    capsules: { mode: "full", schemaVersion: 9, capsules: [] },
    revisions: { mode: "full", schemaVersion: 10, revisions: [] },
    revisitIntents: { mode: "full", schemaVersion: 11, intents: [] },
    archaeology: { mode: "full", events: [{ id: "source-event", members: [{ memoryId: "source-calibration" }] }], claims: [], pairDecisions: [], questions: [] }
  };
  const fullBackupValue = {
    mode: "full",
    schemaVersion: 12,
    calibrations: [{ id: "source-calibration-record", memoryId: "source-calibration" }]
  };

  const missing = createFixture({ schemaVersion: 12 });
  const missingError = captureError(() => missing.importCollection({
    schemaVersion: 12,
    mode: "full",
    memories: [memory("source-calibration")],
    ...required
  }));
  ok(missingError?.statusCode === 400 && missingError.message.includes("timeCalibrations"), "schema 12 full 即使零项校准也必须显式声明 timeCalibrations");
  ok(missing.calls.normalizes === 0 && missing.calls.transactions === 0, "缺失时间校准在规范化和事务前拒绝");

  const full = createFixture({
    schemaVersion: 12,
    restoreHandlers: {
      archaeology: () => ({ events: 1, claims: 0, decisions: 1, questions: 0, skipped: 0, idMap: { events: { "source-event": "restored-event" } } }),
      timeCalibrations: ({ backup }) => ({ calibrations: backup.calibrations.length, skipped: 0, requiresTimeIsle: false, idMap: {} })
    }
  });
  const fullResult = full.importCollection({
    schemaVersion: 12,
    mode: "full",
    memories: [memory("source-calibration")],
    ...required,
    timeCalibrations: fullBackupValue
  });
  ok(full.calls.validations.timeCalibrations === 1 && full.calls.events.indexOf("validate-time-calibrations") < full.calls.events.indexOf("normalize"), "时间校准在展品规范化前先验真");
  ok(full.calls.restores.timeCalibrations === 1 && fullResult.timeCalibrations.calibrations === 1, "schema 12 JSON 在修订与记忆考古后恢复时间校准");
  same(mapObject(full.calls.restoreMaps.timeCalibrations.memoryIdMap), { "source-calibration": "source-calibration" }, "时间校准复用展品 ID 映射");
  same(mapObject(full.calls.restoreMaps.timeCalibrations.eventIdMap), { "source-event": "restored-event" }, "时间校准复用事件 ID 映射");

  const redacted = createFixture({ schemaVersion: 12 });
  const redactedResult = redacted.importCollection({
    schemaVersion: 12,
    mode: "redacted",
    memories: [memory("source-redacted")],
    entities: { mode: "redacted-summary" },
    voices: { mode: "redacted-summary", assetCount: 0 },
    capsules: { mode: "redacted-summary", capsuleCount: 0 },
    revisions: { mode: "redacted-summary", revisionCount: 0 },
    revisitIntents: { mode: "redacted-summary", intentCount: 0, note: "固定说明" },
    timeCalibrations: { mode: "redacted-summary", calibrationCount: 2, uncertainCount: 1, alternativesCount: 1, note: "固定说明" }
  });
  ok(redacted.calls.validations.timeCalibrations === 1 && redacted.calls.restores.timeCalibrations === 0, "脱敏时间校准只验真且保持零写入");
  ok(redactedResult.timeCalibrations.summarized === true && redactedResult.timeCalibrations.calibrations === 0, "脱敏 JSON 返回明确的时间校准摘要结果");

  const legacy = createFixture({ schemaVersion: 11 });
  const legacyError = captureError(() => legacy.importCollection({
    schemaVersion: 11,
    mode: "full",
    memories: [memory("source-calibration")],
    ...required,
    timeCalibrations: fullBackupValue
  }));
  ok(legacyError?.statusCode === 400 && legacyError.message.includes("schema 12"), "schema 11 不得越级声明时间校准");
}

function checkSchema11Export() {
  const calls = [];
  const store = {
    buildExhibitionBackup: (mode) => ({ mode, exhibitions: [] }),
    buildRevisitBackup: (mode) => ({ mode, states: [] }),
    buildClueBackup: (mode) => ({ mode, entities: [] }),
    buildVoiceBackup: (mode) => ({ mode, assets: [] }),
    buildCapsuleBackup: (mode) => ({ mode, capsules: [] }),
    buildRevisionBackup: (mode) => ({ mode, revisions: [] }),
    buildRevisitIntentBackup(mode, memoryIds) {
      calls.push({ mode, memoryIds });
      return mode === "redacted"
        ? { mode: "redacted-summary", intentCount: 0, note: "固定说明" }
        : { mode: "full", schemaVersion: 11, intents: [] };
    }
  };
  const build = createCollectionExporter({
    store,
    appVersion: "7.3.0",
    schemaVersion: 11,
    buildArchaeologyBackup: () => ({ mode: "full", events: [], claims: [], pairDecisions: [], questions: [] })
  });
  const memories = [memory("export-intent")];
  const full = build(memories, "full");
  same(full.revisitIntents, { mode: "full", schemaVersion: 11, intents: [] }, "schema 11 full JSON 即使零条意愿也显式导出 revisitIntents");
  same(calls[0], { mode: "full", memoryIds: ["export-intent"] }, "完整回访意愿导出严格限制在本次展品边界");
  const redacted = build(memories, "redacted");
  same(Object.keys(redacted.revisitIntents).sort(), ["intentCount", "mode", "note"], "schema 11 脱敏 JSON 只导出总数与固定说明");
  same(calls[1], { mode: "redacted", memoryIds: ["export-intent"] }, "脱敏回访意愿使用同一展品边界");

  const missing = { ...store };
  delete missing.buildRevisitIntentBackup;
  const broken = createCollectionExporter({
    store: missing,
    appVersion: "7.3.0",
    schemaVersion: 11,
    buildArchaeologyBackup: () => ({})
  });
  assert.throws(() => broken(memories, "full"), /revisit intent backup support/u, "schema 11 导出缺少回访意愿处理器时 fail closed");
  assertionCount += 1;
}

function checkRevisitIntentImportModes() {
  const fullBackupValue = {
    mode: "full",
    schemaVersion: 11,
    intents: [{
      memoryId: "source-intent",
      intent: "welcome",
      notBeforeLocalDate: "",
      notBeforeTimezone: "",
      createdAt: "2026-07-18T09:00:00.000Z",
      updatedAt: "2026-07-18T09:00:00.000Z"
    }]
  };
  const required = {
    entities: fullBackup(),
    voices: { mode: "full", assetCount: 0, assets: [] },
    capsules: { mode: "full", schemaVersion: 9, capsules: [] },
    revisions: { mode: "full", schemaVersion: 10, revisions: [] }
  };
  const missing = createFixture({ schemaVersion: 11 });
  const missingError = captureError(() => missing.importCollection({
    schemaVersion: 11,
    mode: "full",
    memories: [memory("source-intent")],
    ...required
  }));
  ok(missingError?.statusCode === 400 && missingError.message.includes("revisitIntents"), "schema 11 full 即使零条意愿也必须显式声明 revisitIntents");
  ok(missing.calls.normalizes === 0 && missing.calls.transactions === 0, "缺失回访意愿在规范化和事务前拒绝");

  const nullIntent = createFixture({ schemaVersion: 11 });
  const nullIntentError = captureError(() => nullIntent.importCollection({
    schemaVersion: 11,
    mode: "full",
    memories: [memory("source-intent")],
    ...required,
    revisitIntents: null
  }));
  ok(nullIntentError?.statusCode === 400 && nullIntentError.message.includes("revisitIntents"), "schema 11 full 不能用 null 冒充必需回访意愿 section");
  ok(nullIntent.calls.normalizes === 0 && nullIntent.calls.transactions === 0, "null 回访意愿在规范化和事务前拒绝");

  const full = createFixture({ schemaVersion: 11 });
  const fullResult = full.importCollection({
    schemaVersion: 11,
    mode: "full",
    memories: [memory("source-intent")],
    ...required,
    revisitIntents: fullBackupValue
  });
  ok(full.calls.validations.revisitIntents === 1 && full.calls.events.indexOf("validate-revisit-intents") < full.calls.events.indexOf("normalize"), "回访意愿在展品规范化前先验真");
  ok(full.calls.restores.revisitIntents === 1 && fullResult.revisitIntents.intents === 1, "schema 11 JSON 在同一事务恢复完整回访意愿");
  same(mapObject(full.calls.restoreMaps.revisitIntents), { "source-intent": "source-intent" }, "回访意愿复用无歧义展品 ID 映射");

  const redacted = createFixture({ schemaVersion: 11 });
  const redactedResult = redacted.importCollection({
    schemaVersion: 11,
    mode: "redacted",
    memories: [memory("source-redacted")],
    entities: { mode: "redacted-summary" },
    voices: { mode: "redacted-summary", assetCount: 0 },
    capsules: { mode: "redacted-summary", capsuleCount: 0 },
    revisions: { mode: "redacted-summary", revisionCount: 0 },
    revisitIntents: { mode: "redacted-summary", intentCount: 2, note: "固定脱敏说明" }
  });
  ok(redacted.calls.validations.revisitIntents === 1 && redacted.calls.restores.revisitIntents === 0, "脱敏回访意愿只验真且保持零写入");
  ok(redactedResult.revisitIntents.summarized === true && redactedResult.revisitIntents.intents === 0, "脱敏 JSON 返回明确的计数摘要结果");

  const legacy = createFixture({ schemaVersion: 10 });
  const legacyError = captureError(() => legacy.importCollection({
    schemaVersion: 10,
    mode: "full",
    memories: [memory("source-intent")],
    ...required,
    revisitIntents: fullBackupValue
  }));
  ok(legacyError?.statusCode === 400 && legacyError.message.includes("schema 11"), "schema 10 不得越级声明回访意愿");

  const unknown = createFixture({ schemaVersion: 11 });
  const unknownError = captureError(() => unknown.importCollection({
    schemaVersion: 11,
    mode: "full",
    memories: [memory("source-intent")],
    ...required,
    revisitIntents: { mode: "full", schemaVersion: 11, intents: [] },
    shareDrafts: [{ rawContent: "不能搭便车" }]
  }));
  ok(unknownError?.statusCode === 400 && unknownError.message.includes("shareDrafts"), "完整 JSON 根对象拒绝 shareDrafts 与未知字段");
  ok(unknown.calls.normalizes === 0 && unknown.calls.transactions === 0, "未知根字段保持馆藏零写入");

  const incomplete = createFixture({
    schemaVersion: 11,
    restoreHandlers: { revisitIntents: () => ({ intents: 0, skipped: 1, idMap: {} }) }
  });
  const incompleteError = captureError(() => incomplete.importCollection({
    schemaVersion: 11,
    mode: "full",
    memories: [memory("source-intent")],
    ...required,
    revisitIntents: fullBackupValue
  }));
  ok(incompleteError?.statusCode === 400 && incompleteError.message.includes("回访意愿"), "回访意愿 skipped 会取消整次 JSON 恢复");
  ok(incomplete.state.memories.size === 0, "回访意愿恢复不完整会回滚已导入展品");
}

function checkCapsuleImportModes() {
  const missing = createFixture({ schemaVersion: 9 });
  const missingError = captureError(() => missing.importCollection({
    schemaVersion: 9,
    mode: "full",
    memories: [memory("source-a")],
    entities: fullBackup(),
    voices: { mode: "full", assetCount: 0, assets: [] }
  }));
  ok(missingError?.statusCode === 400 && missingError.message.includes("capsules"), "schema 9 完整 JSON 必须显式声明时间胶囊边界");
  ok(missing.calls.normalizes === 0 && missing.calls.transactions === 0, "缺失胶囊 section 在规范化与写入前拒绝");

  const full = createFixture({ schemaVersion: 9 });
  const fullResult = full.importCollection({
    schemaVersion: 9,
    mode: "full",
    memories: [memory("source-a")],
    entities: fullBackup(),
    voices: { mode: "full", assetCount: 0, assets: [] },
    capsules: { mode: "full", schemaVersion: 9, capsules: [{ id: "capsule-source" }] }
  });
  ok(full.calls.validations.capsules === 1 && full.calls.events.indexOf("validate-capsules") < full.calls.events.indexOf("normalize"), "胶囊索引先验真再导入展品");
  ok(fullResult.capsules.requiresTimeIsle === true && fullResult.capsules.skipped === 1, "JSON 明确提示胶囊需由 .time-isle 无损恢复");

  const redacted = createFixture({ schemaVersion: 9 });
  const redactedResult = redacted.importCollection({
    schemaVersion: 9,
    mode: "redacted",
    memories: [memory("source-redacted")],
    entities: { mode: "redacted-summary" },
    voices: { mode: "redacted-summary", assetCount: 0 },
    capsules: { mode: "redacted-summary", capsuleCount: 2 }
  });
  ok(redacted.calls.validations.capsules === 1 && redactedResult.capsules.capsules === 0, "脱敏胶囊摘要只验真且零胶囊写入");

  const legacy = createFixture({ schemaVersion: 8 });
  const legacyError = captureError(() => legacy.importCollection({
    schemaVersion: 8,
    mode: "full",
    memories: [memory("source-a")],
    entities: fullBackup(),
    voices: { mode: "full", assetCount: 0, assets: [] },
    capsules: { mode: "full", schemaVersion: 9, capsules: [] }
  }));
  ok(legacyError?.statusCode === 400 && legacyError.message.includes("schema 9"), "旧 schema 不得越级声明时间胶囊数据");
}

function checkVoiceImportModes() {
  const missing = createFixture({ schemaVersion: 8 });
  const missingError = captureError(() => missing.importCollection({
    schemaVersion: 8,
    mode: "full",
    memories: [memory("source-a")],
    entities: fullBackup()
  }));
  ok(missingError?.statusCode === 400 && missingError.message.includes("voices"), "schema 8 完整 JSON 必须显式声明声音边界");
  ok(missing.calls.normalizes === 0 && missing.calls.transactions === 0, "缺失声音 section 在规范化与写入前拒绝");

  const full = createFixture({ schemaVersion: 8 });
  const fullResult = full.importCollection({
    schemaVersion: 8,
    mode: "full",
    memories: [memory("source-a")],
    entities: fullBackup(),
    voices: { mode: "full", assetCount: 1, assets: [{ id: "voice-source" }] }
  });
  ok(full.calls.validations.voices === 1 && full.calls.events.indexOf("validate-voices") < full.calls.events.indexOf("normalize"), "声音索引先验真再导入展品");
  ok(fullResult.voices.requiresTimeIsle === true && fullResult.voices.skipped === 1, "JSON 明确提示声音字节需由 .time-isle 恢复");

  const redacted = createFixture({ schemaVersion: 8 });
  const redactedResult = redacted.importCollection({
    schemaVersion: 8,
    mode: "redacted",
    memories: [memory("source-redacted")],
    entities: { mode: "redacted-summary" },
    voices: { mode: "redacted-summary", assetCount: 2 }
  });
  ok(redacted.calls.validations.voices === 1 && redactedResult.voices.assets === 0, "脱敏声音摘要只验真且零声音写入");

  const legacy = createFixture();
  const legacyError = captureError(() => legacy.importCollection({
    schemaVersion: 7,
    mode: "full",
    memories: [memory("source-a")],
    entities: fullBackup(),
    voices: { mode: "full", assets: [] }
  }));
  ok(legacyError?.statusCode === 400 && legacyError.message.includes("schema 8"), "旧 schema 不得越级声明声音数据");
}

function checkSchemaEnvelope() {
  const future = createFixture();
  const futureError = captureError(() => future.importCollection({
    schemaVersion: 8,
    mode: "full",
    memories: [memory("source-a")],
    entities: fullBackup()
  }));
  ok(futureError?.statusCode === 400 && futureError.message.includes("高于当前支持"), "未来 schema 在任何规范化或写入前被拒绝");
  ok(future.calls.normalizes === 0 && future.calls.transactions === 0, "未来 schema 保持馆藏零写入");

  const missing = createFixture();
  const missingError = captureError(() => missing.importCollection({
    schemaVersion: 7,
    mode: "full",
    memories: [memory("source-a")]
  }));
  ok(missingError?.statusCode === 400 && missingError.message.includes("缺少必需的 entities"), "schema 7 完整备份即使实体为空也必须显式携带 entities");
  ok(missing.calls.normalizes === 0 && missing.calls.transactions === 0, "缺少 schema 7 实体 section 时零写入");

  const legacyWithEntities = createFixture();
  const legacyEntityError = captureError(() => legacyWithEntities.importCollection({
    schemaVersion: 6,
    mode: "full",
    memories: [memory("source-a")],
    entities: fullBackup()
  }));
  ok(legacyEntityError?.statusCode === 400 && legacyEntityError.message.includes("只能由 schema 7"), "旧 schema 不得越级声明实体线索图");
  ok(legacyWithEntities.calls.normalizes === 0 && legacyWithEntities.calls.transactions === 0, "越级声明实体图时零写入");
}

function checkEntityRestoreModes() {
  const full = createFixture({
    restoreHandlers: {
      entities: () => ({
        entities: 2,
        aliases: 1,
        memoryLinks: 2,
        skipped: 0,
        idMap: { memories: { "source-a": "source-a" }, entities: { source: "target" }, aliases: {} }
      })
    }
  });
  const fullResult = full.importCollection({
    schemaVersion: 7,
    mode: "full",
    memories: [memory("source-a")],
    entities: fullBackup()
  });
  ok(full.calls.importOptions[0]?.clueMode === "defer", "schema 7 完整导入延迟自动实体派生");
  ok(full.calls.restores.entities === 1 && fullResult.entities.entities === 2, "完整实体图在展品写入后的同一事务恢复");
  same(mapObject(full.calls.restoreMaps.entities), { "source-a": "source-a" }, "实体图复用展品冲突映射");
  same(full.calls.events, ["validate-entities", "normalize", "transaction", "import", "restore-entities"], "完整实体图先验真，再延迟派生并于同一事务恢复");

  const redacted = createFixture();
  const redactedResult = redacted.importCollection({
    schemaVersion: 7,
    mode: "redacted",
    memories: [memory("source-redacted", { people: ["[已隐藏人物]"] })],
    entities: { mode: "redacted-summary" }
  });
  ok(redacted.calls.importOptions[0]?.clueMode === "none", "脱敏导入明确禁止从占位文字制造实体");
  ok(redacted.calls.validations.entities === 1 && redacted.calls.restores.entities === 0, "脱敏实体摘要只验真且保持零实体写入");
  same(redactedResult.entities, emptyEntityResultFixture(), "脱敏导入返回明确的零实体恢复结果");

  const legacy = createFixture();
  legacy.importCollection({ schemaVersion: 6, mode: "full", memories: [memory("legacy-a")] });
  ok(legacy.calls.importOptions[0]?.clueMode === "derive", "旧完整备份继续从旧字段派生实体线索");

  const failed = createFixture({
    restoreHandlers: {
      entities: ({ state }) => {
        state.entities.push("partial-entity");
        return { entities: 0, aliases: 0, memoryLinks: 0, skipped: 1, idMap: {} };
      }
    }
  });
  const failedError = captureError(() => failed.importCollection({
    schemaVersion: 7,
    mode: "full",
    memories: [memory("source-a")],
    entities: fullBackup()
  }));
  ok(failedError?.statusCode === 400 && failedError.message.includes("实体线索未能恢复"), "实体图返回 skipped 时取消整次导入");
  same([...failed.state.memories.keys()], [], "实体恢复不完整会回滚展品写入");
  same(failed.state.entities, [], "实体恢复不完整会回滚部分实体写入");
}

function checkPrimitiveBodies() {
  [null, undefined, 0, 1, false, true, "memories"].forEach((body) => {
    const fixture = createFixture();
    const error = captureError(() => fixture.importCollection(body));
    ok(error?.statusCode === 400, `顶层 ${String(body)} 请求体返回 400`);
    ok(fixture.calls.imports === 0 && fixture.calls.transactions === 0, `顶层 ${String(body)} 请求体不会开始写入`);
  });
}

function checkHardImportLimit() {
  const fixture = createFixture({ maxMemories: 2 });
  const error = captureError(() => fixture.importCollection({
    memories: [memory("source-a"), memory("source-b"), memory("source-c")]
  }));
  ok(error?.statusCode === 400 && error.message.includes("最多导入 2"), "超出上限会明确拒绝而不是静默截断");
  ok(fixture.calls.normalizes === 0 && fixture.calls.imports === 0, "超限备份在规范化与写入前终止");
  same([...fixture.state.memories.keys()], [], "超限备份保持馆藏零写入");
}

function checkDuplicateReferenceIds() {
  const fixture = createFixture();
  const error = captureError(() => fixture.importCollection({
    memories: [memory("source-a"), memory("source-a", { title: "重复来源" })],
    exhibitions: fullBackup()
  }));
  ok(error?.statusCode === 400 && error.message.includes("重复展品 ID"), "带引用备份拒绝重复来源展品 ID");
  ok(fixture.calls.normalizes === 0 && fixture.calls.imports === 0, "歧义来源 ID 不会形成映射或写入");
}

function checkFeaturePrevalidation() {
  const cases = [
    { feature: "archaeology", body: { archaeology: fullBackup() } },
    { feature: "exhibitions", body: { archaeology: fullBackup(), exhibitions: fullBackup() } },
    { feature: "revisits", body: { archaeology: fullBackup(), exhibitions: fullBackup(), revisits: fullBackup() } }
  ];

  cases.forEach(({ feature, body }) => {
    const fixture = createFixture({ validationFailure: feature });
    const before = stateSnapshot(fixture.state);
    const error = captureError(() => fixture.importCollection({ memories: [memory("source-a")], ...body }));
    ok(error?.statusCode === 400 && error.message.includes("备份无法恢复"), `${feature} 非法备份转换为可读的 400`);
    ok(fixture.calls.imports === 0 && fixture.calls.transactions === 0, `${feature} 非法备份不会开始事务写入`);
    ok(fixture.calls.normalizes === 0, `${feature} 非法备份在展品规范化前被拦截`);
    same(stateSnapshot(fixture.state), before, `${feature} 非法备份保持三类数据零写入`);
  });
}

function checkConflictMapping() {
  const fixture = createFixture({
    existingMemories: [
      memory("source-a", { title: "本机既有 A" }),
      memory("occupied-id", { title: "本机既有 B" })
    ],
    generatedIds: ["occupied-id", "imported-source-a"]
  });
  const result = fixture.importCollection({
    memories: [
      memory("source-a", { title: "导入 A", agentRunId: "foreign-run" }),
      memory("source-b", { title: "导入 B" })
    ],
    archaeology: fullBackup(),
    exhibitions: fullBackup(),
    revisits: fullBackup()
  });

  ok(result.imported === 2, "冲突馆藏仍完整导入两件展品");
  ok(fixture.state.memories.get("source-a")?.title === "本机既有 A", "来源 ID 冲突不会覆盖本机既有展品");
  ok(fixture.state.memories.get("occupied-id")?.title === "本机既有 B", "生成 ID 冲突会继续重试而不覆盖另一件展品");
  ok(fixture.state.memories.get("imported-source-a")?.agentRunId === "", "冲突副本使用新 ID 且清除外部 Agent 引用");
  ok(fixture.state.memories.has("source-b"), "未冲突来源 ID 保持稳定");
  same(mapObject(fixture.calls.restoreMaps.archaeology), { "source-a": "imported-source-a", "source-b": "source-b" }, "记忆考古收到无歧义冲突映射");
  same(mapObject(fixture.calls.restoreMaps.exhibitions), mapObject(fixture.calls.restoreMaps.archaeology), "主题展览复用同一份冲突映射");
  same(mapObject(fixture.calls.restoreMaps.revisits), mapObject(fixture.calls.restoreMaps.archaeology), "记忆回访复用同一份冲突映射");
}

function checkAtomicRollbackAndSafeCompensation() {
  const fixture = createFixture({
    existingMemories: [
      memory("source-a", { title: "不可删除 A" }),
      memory("occupied-id", { title: "不可删除 B" })
    ],
    existingExhibitions: ["existing-exhibition"],
    generatedIds: ["occupied-id", "new-import-id"],
    restoreHandlers: {
      archaeology({ state }) {
        state.archaeology.push("restored-archaeology");
        return { events: 1, claims: 0, decisions: 0, questions: 0, skipped: 0 };
      },
      exhibitions({ state }) {
        state.exhibitions.push("new-exhibition");
        return { exhibitions: 1, skipped: 0, idMap: { source: "new" } };
      },
      revisits({ state }) {
        state.revisits.push("new-revisit");
        throw new Error("revisit write failed");
      }
    }
  });
  const error = captureError(() => fixture.importCollection({
    memories: [memory("source-a", { title: "导入副本" })],
    archaeology: fullBackup(),
    exhibitions: fullBackup(),
    revisits: fullBackup()
  }));

  ok(error?.statusCode === 400 && error.message.includes("导入已取消"), "关系恢复失败会取消整次导入");
  same([...fixture.state.memories.keys()].sort(), ["occupied-id", "source-a"], "同一事务回滚全部新展品");
  ok(fixture.state.memories.get("source-a")?.title === "不可删除 A" && fixture.state.memories.get("occupied-id")?.title === "不可删除 B", "回滚与补偿都不会改写既有展品");
  same(fixture.state.archaeology, [], "事务回滚已写入的记忆考古关系");
  same(fixture.state.exhibitions, ["existing-exhibition"], "失败补偿不会删除既有主题展览");
  same(fixture.state.revisits, [], "事务回滚已写入的回访状态");
  ok(fixture.calls.deletes.every((id) => id !== "source-a" && id !== "occupied-id"), "补偿删除名单严格排除事务前既有展品");
}

function checkSkippedRestores() {
  const cases = [
    {
      feature: "archaeology",
      body: { archaeology: fullBackup() },
      result: { events: 0, claims: 0, decisions: 0, questions: 0, skipped: 1 }
    },
    {
      feature: "exhibitions",
      body: { exhibitions: fullBackup() },
      result: { exhibitions: 0, skipped: 1, idMap: {} }
    },
    {
      feature: "revisits",
      body: { revisits: fullBackup() },
      result: { states: 0, skipped: 1, idMap: {} }
    }
  ];

  cases.forEach(({ feature, body, result }) => {
    const fixture = createFixture({
      restoreHandlers: {
        [feature]() { return result; }
      }
    });
    const error = captureError(() => fixture.importCollection({ memories: [memory("source-a")], ...body }));
    ok(error?.statusCode === 400 && error.message.includes("未能恢复"), `${feature} 返回 skipped 时明确取消恢复`);
    same([...fixture.state.memories.keys()], [], `${feature} skipped 会回滚已导入展品`);
    ok(fixture.calls.restores[feature] === 1, `${feature} skipped 结果已被导入器检查`);
  });
}

function checkSuccessfulResult() {
  const expected = {
    archaeology: { events: 1, claims: 2, decisions: 1, questions: 1, skipped: 0 },
    exhibitions: { exhibitions: 1, skipped: 0, idMap: { exhibition: "exhibition" } },
    revisits: { states: 1, skipped: 0, idMap: { "source-a": "source-a" } }
  };
  const fixture = createFixture({
    restoreHandlers: {
      archaeology: () => expected.archaeology,
      exhibitions: () => expected.exhibitions,
      revisits: () => expected.revisits
    }
  });
  const result = fixture.importCollection({
    memories: [memory("source-a", { agentRunId: "foreign-run" })],
    archaeology: fullBackup(),
    exhibitions: fullBackup(),
    revisits: fullBackup()
  });

  ok(result.imported === 1 && result.memories.length === 1, "成功导入返回 imported 与最新馆藏");
  same(result.archaeology, expected.archaeology, "成功导入返回记忆考古恢复结果");
  same(result.exhibitions, expected.exhibitions, "成功导入返回主题展览恢复结果");
  same(result.revisits, expected.revisits, "成功导入返回记忆回访恢复结果");
  ok(fixture.state.memories.get("source-a")?.agentRunId === "", "成功导入不会继承外部 Agent run ID");
  same(
    fixture.calls.events,
    [
      "validate-archaeology", "validate-exhibitions", "validate-revisits",
      "normalize", "transaction", "import", "restore-archaeology",
      "restore-exhibitions", "restore-revisits"
    ],
    "三类备份全部先验验证后才规范化并进入同一事务恢复"
  );
}

function createFixture(options = {}) {
  const state = {
    memories: new Map((options.existingMemories || []).map((item) => [item.id, clone(item)])),
    archaeology: [],
    exhibitions: [...(options.existingExhibitions || [])],
    revisits: [],
    entities: [],
    timeCalibrations: []
  };
  const calls = {
    normalizes: 0,
    imports: 0,
    transactions: 0,
    deletes: [],
    importOptions: [],
    validations: {
      archaeology: 0, exhibitions: 0, revisits: 0, entities: 0,
      voices: 0, capsules: 0, revisions: 0, revisitIntents: 0,
      timeCalibrations: 0, oralHistories: 0
    },
    restores: { archaeology: 0, exhibitions: 0, revisits: 0, entities: 0, revisions: 0, revisitIntents: 0, timeCalibrations: 0 },
    restoreMaps: {},
    oralBoundaries: null,
    events: []
  };
  const generatedIds = [...(options.generatedIds || [])];
  let generatedCount = 0;

  const store = {
    listMemories() {
      return [...state.memories.values()].map(clone);
    },
    importMemories(items, importOptions = {}) {
      calls.imports += 1;
      calls.importOptions.push(clone(importOptions));
      calls.events.push("import");
      items.forEach((item) => state.memories.set(item.id, clone(item)));
      return { imported: items.length, memories: [...state.memories.values()].map(clone) };
    },
    deleteMemory(id) {
      calls.deletes.push(id);
      return state.memories.delete(id);
    },
    withTransaction(callback) {
      calls.transactions += 1;
      calls.events.push("transaction");
      const snapshot = cloneState(state);
      try {
        return callback();
      } catch (error) {
        restoreState(state, snapshot);
        throw error;
      }
    },
    validateExhibitionBackup(backup, sourceIds) {
      calls.validations.exhibitions += 1;
      calls.events.push("validate-exhibitions");
      if (options.validationFailure === "exhibitions") throw new Error("invalid exhibitions");
      return Boolean(backup && Array.isArray(sourceIds));
    },
    restoreExhibitionBackup(backup, memoryIdMap) {
      calls.restores.exhibitions += 1;
      calls.events.push("restore-exhibitions");
      calls.restoreMaps.exhibitions = new Map(memoryIdMap);
      return callRestoreHandler("exhibitions", { backup, memoryIdMap });
    },
    validateRevisitBackup(backup, sourceIds) {
      calls.validations.revisits += 1;
      calls.events.push("validate-revisits");
      if (options.validationFailure === "revisits") throw new Error("invalid revisits");
      return Boolean(backup && Array.isArray(sourceIds));
    },
    restoreRevisitBackup(backup, memoryIdMap) {
      calls.restores.revisits += 1;
      calls.events.push("restore-revisits");
      calls.restoreMaps.revisits = new Map(memoryIdMap);
      return callRestoreHandler("revisits", { backup, memoryIdMap });
    },
    validateClueBackup(backup, sourceIds) {
      calls.validations.entities += 1;
      calls.events.push("validate-entities");
      if (options.validationFailure === "entities") throw new Error("invalid entities");
      return Boolean(backup && Array.isArray(sourceIds));
    },
    restoreClueBackup(backup, memoryIdMap) {
      calls.restores.entities += 1;
      calls.events.push("restore-entities");
      calls.restoreMaps.entities = new Map(memoryIdMap);
      return callRestoreHandler("entities", { backup, memoryIdMap });
    },
    validateVoiceBackup(backup, sourceIds, restoreOptions = {}) {
      calls.validations.voices += 1;
      calls.events.push("validate-voices");
      if (options.validationFailure === "voices") throw new Error("invalid voices");
      calls.voiceAdditionalAssetIds = [...(restoreOptions.additionalAssetIds || [])];
      return Boolean(backup && Array.isArray(sourceIds));
    },
    validateCapsuleBackup(backup) {
      calls.validations.capsules += 1;
      calls.events.push("validate-capsules");
      if (options.validationFailure === "capsules") throw new Error("invalid capsules");
      return Boolean(backup);
    },
    validateRevisionBackup(backup, sourceIds) {
      calls.validations.revisions += 1;
      calls.events.push("validate-revisions");
      if (options.validationFailure === "revisions") throw new Error("invalid revisions");
      return Boolean(backup && Array.isArray(sourceIds));
    },
    restoreRevisionBackup(backup, memoryIdMap) {
      calls.restores.revisions += 1;
      calls.events.push("restore-revisions");
      calls.restoreMaps.revisions = new Map(memoryIdMap);
      return callRestoreHandler("revisions", { backup, memoryIdMap });
    },
    validateRevisitIntentBackup(backup, sourceIds) {
      calls.validations.revisitIntents += 1;
      calls.events.push("validate-revisit-intents");
      if (options.validationFailure === "revisitIntents") throw new Error("invalid revisit intents");
      return Boolean(backup && Array.isArray(sourceIds));
    },
    restoreRevisitIntentBackup(backup, memoryIdMap) {
      calls.restores.revisitIntents += 1;
      calls.events.push("restore-revisit-intents");
      calls.restoreMaps.revisitIntents = new Map(memoryIdMap);
      return callRestoreHandler("revisitIntents", { backup, memoryIdMap });
    },
    validateTimeCalibrationBackup(backup, sourceIds, sourceEventIds) {
      calls.validations.timeCalibrations += 1;
      calls.events.push("validate-time-calibrations");
      if (options.validationFailure === "timeCalibrations") throw new Error("invalid time calibrations");
      return Boolean(backup && Array.isArray(sourceIds) && Array.isArray(sourceEventIds));
    },
    restoreTimeCalibrationBackup(backup, restoreOptions) {
      calls.restores.timeCalibrations += 1;
      calls.events.push("restore-time-calibrations");
      calls.restoreMaps.timeCalibrations = {
        memoryIdMap: new Map(restoreOptions.memoryIdMap),
        eventIdMap: new Map(restoreOptions.eventIdMap)
      };
      return callRestoreHandler("timeCalibrations", { backup, ...restoreOptions });
    },
    validateOralHistoryBackup(backup, boundaries = {}) {
      calls.validations.oralHistories += 1;
      calls.events.push("validate-oral-histories");
      calls.oralBoundaries = {
        eventIds: [...(boundaries.eventIds || [])],
        voiceAssetIds: [...(boundaries.voiceAssetIds || [])]
      };
      if (options.validationFailure === "oralHistories") throw new Error("invalid oral histories");
      return Boolean(backup);
    }
  };

  function validateArchaeologyBackup(backup, sourceIds) {
    calls.validations.archaeology += 1;
    calls.events.push("validate-archaeology");
    if (options.validationFailure === "archaeology") throw new Error("invalid archaeology");
    return Boolean(backup && Array.isArray(sourceIds));
  }

  function restoreArchaeologyBackup(storeArgument, backup, memoryIdMap) {
    assert.equal(storeArgument, store);
    calls.restores.archaeology += 1;
    calls.events.push("restore-archaeology");
    calls.restoreMaps.archaeology = new Map(memoryIdMap);
    return callRestoreHandler("archaeology", { backup, memoryIdMap });
  }

  function callRestoreHandler(feature, context) {
    const handler = options.restoreHandlers?.[feature];
    if (handler) return handler({ ...context, state, calls, store });
    if (feature === "archaeology") return { events: 0, claims: 0, decisions: 0, questions: 0, skipped: 0, idMap: { events: {} } };
    if (feature === "exhibitions") return { exhibitions: 0, skipped: 0, idMap: {} };
    if (feature === "entities") return emptyEntityResultFixture();
    if (feature === "revisions") return { memories: 0, revisions: 0, skipped: 0, idMap: { memories: {}, revisions: {} } };
    if (feature === "revisitIntents") {
      return {
        intents: Array.isArray(context.backup?.intents) ? context.backup.intents.length : 0,
        skipped: 0,
        idMap: Object.fromEntries(context.memoryIdMap)
      };
    }
    if (feature === "timeCalibrations") {
      return {
        calibrations: Array.isArray(context.backup?.calibrations) ? context.backup.calibrations.length : 0,
        skipped: 0,
        requiresTimeIsle: false,
        idMap: {}
      };
    }
    return { states: 0, skipped: 0, idMap: {} };
  }

  function normalizeMemory(input) {
    calls.normalizes += 1;
    calls.events.push("normalize");
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("memory must be an object");
    return {
      ...clone(input),
      id: sanitizeId(input.id) || `normalized-${calls.normalizes}`,
      title: String(input.title || "未命名记忆"),
      agentRunId: String(input.agentRunId || "")
    };
  }

  function createId(prefix) {
    generatedCount += 1;
    return generatedIds.length ? generatedIds.shift() : `${prefix}-generated-${generatedCount}`;
  }

  const importCollection = createCollectionImporter({
    store,
    normalizeMemory,
    sanitizeId,
    createId,
    validateArchaeologyBackup,
    restoreArchaeologyBackup,
    httpError,
    schemaVersion: options.schemaVersion || 7,
    maxMemories: options.maxMemories || 500
  });
  return { importCollection, state, calls };
}

function memory(id, patch = {}) {
  return { id, title: `展品 ${id}`, agentRunId: "", ...patch };
}

function fullBackup() {
  return { mode: "full" };
}

function sanitizeId(value) {
  const id = String(value || "").trim();
  return /^[a-zA-Z0-9_-]{1,120}$/.test(id) ? id : "";
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function captureError(operation) {
  try {
    operation();
    return null;
  } catch (error) {
    return error;
  }
}

function clone(value) {
  return structuredClone(value);
}

function cloneState(state) {
  return {
    memories: clone(state.memories),
    archaeology: clone(state.archaeology),
    exhibitions: clone(state.exhibitions),
    revisits: clone(state.revisits),
    entities: clone(state.entities),
    timeCalibrations: clone(state.timeCalibrations)
  };
}

function restoreState(target, snapshot) {
  target.memories = snapshot.memories;
  target.archaeology = snapshot.archaeology;
  target.exhibitions = snapshot.exhibitions;
  target.revisits = snapshot.revisits;
  target.entities = snapshot.entities;
  target.timeCalibrations = snapshot.timeCalibrations;
}

function stateSnapshot(state) {
  return {
    memories: [...state.memories.entries()],
    archaeology: state.archaeology,
    exhibitions: state.exhibitions,
    revisits: state.revisits,
    entities: state.entities,
    timeCalibrations: state.timeCalibrations
  };
}

function emptyEntityResultFixture() {
  return {
    entities: 0,
    aliases: 0,
    memoryLinks: 0,
    skipped: 0,
    idMap: { memories: {}, entities: {}, aliases: {} }
  };
}

function mapObject(value) {
  return Object.fromEntries(value || []);
}

function ok(condition, label) {
  assertionCount += 1;
  assert.ok(condition, label);
  console.log(`ok - ${label}`);
}

function same(actual, expected, label) {
  assertionCount += 1;
  assert.deepEqual(actual, expected, label);
  console.log(`ok - ${label}`);
}

run();
