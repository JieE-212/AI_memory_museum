"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { withRequestAbort } = require("./archive-http");

function createArchiveInspectionApi(options = {}) {
  const { mediaRoot, prepareMediaArchive, validateVoiceBackup, supportedSchemaVersion, sendJson, httpError } = options;
  if (typeof mediaRoot !== "string" || !path.isAbsolute(mediaRoot) ||
      typeof prepareMediaArchive !== "function" || typeof validateVoiceBackup !== "function" ||
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
      revisitIntents: collection.revisitIntents?.mode === "redacted-summary"
        ? Number(collection.revisitIntents.intentCount) || 0
        : countRecords(collection.revisitIntents, "intents")
    }
  };
}

module.exports = { createArchiveInspectionApi, summarize };
