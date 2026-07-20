"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { createStructuralRecoveryDrill } = require("./structural-recovery-drill");

function createStructuralRecoveryRuntime(options = {}) {
  const mediaRoot = requireAbsolutePath(options.mediaRoot, "mediaRoot");
  const prepareMediaArchive = requireFunction(options.prepareMediaArchive, "prepareMediaArchive");
  const supportedSchemaVersion = Number(options.supportedSchemaVersion);
  if (!Number.isSafeInteger(supportedSchemaVersion) || supportedSchemaVersion < 1) {
    throw new TypeError("supportedSchemaVersion must be a positive integer.");
  }
  const validators = Object.freeze({
    validateVoiceBackup: requireFunction(options.validateVoiceBackup, "validateVoiceBackup"),
    validateTimeCalibrationBackup: requireFunction(options.validateTimeCalibrationBackup, "validateTimeCalibrationBackup"),
    validateOralHistoryBackup: requireFunction(options.validateOralHistoryBackup, "validateOralHistoryBackup"),
    validateCuratorAgentBackup: requireFunction(options.validateCuratorAgentBackup, "validateCuratorAgentBackup"),
    validateMemoryInboxBackup: requireFunction(options.validateMemoryInboxBackup, "validateMemoryInboxBackup"),
    validateProvenanceBackup: requireFunction(options.validateProvenanceBackup, "validateProvenanceBackup"),
    validateCoMemoryResponseBackup: requireFunction(options.validateCoMemoryResponseBackup, "validateCoMemoryResponseBackup")
  });

  return createStructuralRecoveryDrill({
    prepareArchive: async (source, policy) => {
      const parent = path.join(mediaRoot, ".drill");
      const stagingRoot = path.join(parent, `drill-${randomUUID()}`);
      fs.mkdirSync(stagingRoot, { recursive: true, mode: 0o700 });
      try {
        return await prepareMediaArchive(source, {
          stagingRoot,
          supportedSchemaVersion,
          ...validators,
          signal: policy.signal,
          limits: policy.limits
        });
      } finally {
        fs.rmSync(stagingRoot, { recursive: true, force: true });
        try { fs.rmdirSync(parent); } catch { /* another drill may still use it */ }
      }
    }
  });
}

function requireAbsolutePath(value, name) {
  if (typeof value !== "string" || !path.isAbsolute(value)) throw new TypeError(`${name} must be an absolute path.`);
  return path.resolve(value);
}

function requireFunction(value, name) {
  if (typeof value !== "function") throw new TypeError(`${name} must be a function.`);
  return value;
}

module.exports = { createStructuralRecoveryRuntime };
