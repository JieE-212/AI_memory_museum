"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { withRequestAbort } = require("./archive-http");

function createArchiveInspectionApi(options = {}) {
  const {
    mediaRoot,
    prepareMediaArchive,
    validateVoiceBackup,
    validateTimeCalibrationBackup,
    validateOralHistoryBackup,
    validateCuratorAgentBackup,
    validateMemoryInboxBackup,
    validateProvenanceBackup,
    validateCoMemoryResponseBackup,
    supportedSchemaVersion,
    sendJson,
    httpError
  } = options;
  if (typeof mediaRoot !== "string" || !path.isAbsolute(mediaRoot) ||
      typeof prepareMediaArchive !== "function" || typeof validateVoiceBackup !== "function" ||
      (supportedSchemaVersion >= 12 && typeof validateTimeCalibrationBackup !== "function") ||
      (supportedSchemaVersion >= 13 && typeof validateOralHistoryBackup !== "function") ||
      (supportedSchemaVersion >= 14 && typeof validateCuratorAgentBackup !== "function") ||
      (supportedSchemaVersion >= 15 && typeof validateMemoryInboxBackup !== "function") ||
      (supportedSchemaVersion >= 16 && typeof validateProvenanceBackup !== "function") ||
      (supportedSchemaVersion >= 17 && typeof validateCoMemoryResponseBackup !== "function") ||
      !Number.isSafeInteger(supportedSchemaVersion) || supportedSchemaVersion < 1 ||
      typeof sendJson !== "function" || typeof httpError !== "function") {
    throw new TypeError("Archive inspection API dependencies are required.");
  }

  async function handle(request, response, url) {
    if (request.method !== "POST" || url.pathname !== "/api/archive/inspect") return false;
    assertContentType(request);
    return withRequestAbort(request, response, async (signal) => {
      const parent = path.join(mediaRoot, ".inspect");
      const stagingRoot = path.join(parent, `inspect-${randomUUID()}`);
      fs.mkdirSync(stagingRoot, { recursive: true, mode: 0o700 });
      try {
        const prepared = await prepareMediaArchive(request, {
          stagingRoot,
          validateVoiceBackup,
          validateTimeCalibrationBackup,
          validateOralHistoryBackup,
          validateCuratorAgentBackup,
          validateMemoryInboxBackup,
          validateProvenanceBackup,
          validateCoMemoryResponseBackup,
          supportedSchemaVersion,
          signal
        });
        signal.throwIfAborted();
        return sendJson(response, 200, { ok: true, inspection: summarize(prepared) });
      } finally {
        fs.rmSync(stagingRoot, { recursive: true, force: true });
        try { fs.rmdirSync(parent); } catch { /* another inspection may still use it */ }
      }
    });
  }

  function assertContentType(request) {
    const contentType = String(request.headers["content-type"] || "").split(";", 1)[0].trim().toLowerCase();
    if (!["application/vnd.time-isle", "application/gzip", "application/x-gzip", "application/octet-stream"].includes(contentType)) {
      throw httpError(415, "备份验真只接受 .time-isle 归档文件。");
    }
  }

  return Object.freeze({ handle });
}

function summarize(prepared) {
  const collection = prepared.collection || {};
  const entries = Array.isArray(prepared.manifest?.entries) ? prepared.manifest.entries : [];
  const countRecords = (value, key) => value?.mode === "full" && Array.isArray(value[key]) ? value[key].length : 0;
  return {
    restorable: Boolean(prepared.verified),
    formatVersion: Number(prepared.manifest?.formatVersion) || 0,
    schemaVersion: Number(prepared.manifest?.schemaVersion) || 0,
    mode: prepared.manifest?.mode || "",
    exportedAt: prepared.manifest?.exportedAt || "",
    entries: entries.length,
    expandedBytes: entries.reduce((sum, entry) => sum + (Number(entry.bytes) || 0), 0),
    counts: {
      memories: Array.isArray(collection.memories) ? collection.memories.length : 0,
      mediaAssets: Array.isArray(prepared.assets) ? prepared.assets.length : 0,
      voices: countRecords(collection.voices, "assets"),
      exhibitions: countRecords(collection.exhibitions, "exhibitions"),
      capsules: countRecords(collection.capsules, "capsules"),
      revisions: countRecords(collection.revisions, "revisions"),
      timeCalibrations: collection.timeCalibrations?.mode === "redacted-summary"
        ? Number(collection.timeCalibrations.calibrationCount) || 0
        : countRecords(collection.timeCalibrations, "calibrations"),
      oralHistoryQuestions: collection.oralHistories?.mode === "redacted-summary"
        ? Number(collection.oralHistories.questionCount) || 0
        : countRecords(collection.oralHistories, "questions"),
      oralHistoryAnswers: collection.oralHistories?.mode === "redacted-summary"
        ? Number(collection.oralHistories.answerCount) || 0
        : countRecords(collection.oralHistories, "answers"),
      confirmedOralHistoryAnswers: collection.oralHistories?.mode === "redacted-summary"
        ? Number(collection.oralHistories.confirmedAnswerCount) || 0
        : collection.oralHistories?.mode === "full" && Array.isArray(collection.oralHistories.answers)
          ? collection.oralHistories.answers.filter((answer) => answer?.status === "confirmed").length
          : 0,
      curatorAgentRuns: collection.curatorAgent?.mode === "redacted-summary"
        ? Number(collection.curatorAgent.runCount) || 0
        : countRecords(collection.curatorAgent, "runs"),
      curatorAgentProposals: collection.curatorAgent?.mode === "redacted-summary"
        ? Number(collection.curatorAgent.proposalCount) || 0
        : collection.curatorAgent?.mode === "full" && Array.isArray(collection.curatorAgent.runs)
          ? collection.curatorAgent.runs.filter((entry) => Boolean(entry?.proposal)).length
          : 0,
      curatorAgentDecisions: collection.curatorAgent?.mode === "redacted-summary"
        ? Number(collection.curatorAgent.decisionCount) || 0
        : collection.curatorAgent?.mode === "full" && Array.isArray(collection.curatorAgent.runs)
          ? collection.curatorAgent.runs.reduce((sum, entry) => sum + (Array.isArray(entry?.decisions) ? entry.decisions.length : 0), 0)
          : 0,
      memoryInboxItems: collection.memoryInbox?.mode === "redacted-summary"
        ? Number(collection.memoryInbox.itemCount) || 0
        : countRecords(collection.memoryInbox, "items"),
      provenanceClaims: collection.provenance?.mode === "redacted-summary"
        ? Number(collection.provenance.claimCount) || 0
        : countRecords(collection.provenance, "claims"),
      coMemoryResponses: collection.coMemoryResponses?.mode === "redacted-summary"
        ? Number(collection.coMemoryResponses.responseCount) || 0
        : countRecords(collection.coMemoryResponses, "responses"),
      revisitIntents: collection.revisitIntents?.mode === "redacted-summary"
        ? Number(collection.revisitIntents.intentCount) || 0
        : countRecords(collection.revisitIntents, "intents")
    }
  };
}

module.exports = { createArchiveInspectionApi, summarize };
