"use strict";

const { createStructuralRecoveryApi } = require("./structural-recovery-api");
const { createStructuralRecoveryRuntime } = require("./structural-recovery-runtime");
const { createIsolatedRecoveryApi } = require("./isolated-recovery-api");
const { createIsolatedRecoveryRuntime } = require("./isolated-recovery-runtime");

function createRecoveryDrillApis(options = {}) {
  const structuralRecoveryApi = createStructuralRecoveryApi({
    drill: createStructuralRecoveryRuntime({
      mediaRoot: options.mediaRoot,
      prepareMediaArchive: options.prepareMediaArchive,
      validateVoiceBackup: options.store?.validateVoiceBackup,
      validateTimeCalibrationBackup: options.store?.validateTimeCalibrationBackup,
      validateOralHistoryBackup: options.store?.validateOralHistoryBackup,
      validateCuratorAgentBackup: options.store?.validateCuratorAgentBackup,
      validateMemoryInboxBackup: options.store?.validateMemoryInboxBackup,
      validateProvenanceBackup: options.store?.validateProvenanceBackup,
      validateCoMemoryResponseBackup: options.store?.validateCoMemoryResponseBackup,
      supportedSchemaVersion: options.schemaVersion
    }),
    interviewDemo: options.interviewDemo,
    sendJson: options.sendJson,
    httpError: options.httpError
  });
  // The real restore receives only configuration and pure normalization/ID
  // functions. The live store, DB path and media root are deliberately absent.
  const isolatedRecoveryApi = createIsolatedRecoveryApi({
    drill: createIsolatedRecoveryRuntime({
      temporaryRoot: options.temporaryRoot,
      schemaVersion: options.schemaVersion,
      halls: options.halls,
      normalizeMemory: options.normalizeMemory,
      createId: options.createId
    }),
    interviewDemo: options.interviewDemo,
    sendJson: options.sendJson,
    httpError: options.httpError
  });
  return Object.freeze({ structuralRecoveryApi, isolatedRecoveryApi });
}

module.exports = { createRecoveryDrillApis };
