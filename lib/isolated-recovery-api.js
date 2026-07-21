"use strict";

const { withRequestAbort } = require("./archive-http");
const {
  ISOLATED_RECOVERY_FORMAT,
  ISOLATED_RECOVERY_VERSION,
  ISOLATED_RECOVERY_KIND,
  ISOLATED_RECOVERY_MAXIMUM_BUDGET,
  LIMITATION_STATEMENT
} = require("./isolated-recovery-drill");

const ISOLATED_RECOVERY_PATH = "/api/recovery-drills/isolated-restore";
const ARCHIVE_CONTENT_TYPES = new Set([
  "application/vnd.time-isle",
  "application/gzip",
  "application/x-gzip",
  "application/octet-stream"
]);
const REQUEST_ID_PATTERN = /^recovery_[A-Za-z0-9_-]{24}$/u;
const COUNT_KEYS = Object.freeze([
  "memories", "mediaAssets", "mediaVariants", "voiceAssets", "exhibitions", "capsules", "entities",
  "revisions", "timeCalibrations", "oralHistoryQuestions", "oralHistoryAnswers", "curatorAgentRuns",
  "memoryInboxItems", "provenanceClaims", "coMemoryResponses", "revisitIntents"
]);

function createIsolatedRecoveryApi(options = {}) {
  const drill = options.drill;
  const sendJson = options.sendJson;
  const httpError = options.httpError;
  const interviewDemo = Boolean(options.interviewDemo);
  const requestAbort = options.withRequestAbort || withRequestAbort;
  if (!drill || typeof drill.run !== "function" || typeof sendJson !== "function" ||
      typeof httpError !== "function" || typeof requestAbort !== "function") {
    throw new TypeError("createIsolatedRecoveryApi dependencies are incomplete.");
  }

  async function handle(request, response, url) {
    if (url?.pathname !== ISOLATED_RECOVERY_PATH) return false;

    // Within this route handler, reject Demo writes before parsing the query,
    // archive Content-Type or body. The server's global Host/Origin validation
    // still runs first as the shared same-origin security boundary.
    if (!new Set(["GET", "HEAD"]).has(request.method) && interviewDemo) {
      return sendJson(response, 403, {
        error: "The public demo does not stage or restore private recovery archives and did not read this request body.",
        code: "ISOLATED_RECOVERY_DEMO_READ_ONLY",
        interviewDemo: true,
        bodyBytesRead: 0
      });
    }

    if (request.method !== "POST") {
      throw codedHttpError(
        httpError,
        405,
        "Isolated recovery rehearsal accepts POST archive uploads only.",
        "ISOLATED_RECOVERY_METHOD_NOT_ALLOWED"
      );
    }
    assertNoQuery(url, httpError);
    assertArchiveContentType(request, httpError);
    return requestAbort(request, response, async (signal) => {
      const report = await drill.run(request, { signal, demoMode: false });
      signal.throwIfAborted();
      const receipt = publicIsolatedRecoveryReceipt(report);
      response.setHeader("Cache-Control", "no-store");
      return sendJson(response, 200, { ok: true, receipt });
    });
  }

  return Object.freeze({ handle });
}

function publicIsolatedRecoveryReceipt(report) {
  try {
    requireObject(report, "report");
    if (report.format !== ISOLATED_RECOVERY_FORMAT || report.version !== ISOLATED_RECOVERY_VERSION ||
        report.kind !== ISOLATED_RECOVERY_KIND || report.verdict !== "passed-isolated-restore") {
      throw new Error("Isolated recovery receipt identity is invalid.");
    }
    const source = requireObject(report.source, "report.source");
    const target = requireObject(report.target, "report.target");
    const checks = requireObject(report.checks, "report.checks");
    const archive = passedGroup(checks.archive, "checks.archive");
    const restore = passedGroup(checks.restore, "checks.restore");
    const database = passedGroup(checks.database, "checks.database");
    const references = passedGroup(checks.references, "checks.references");
    const media = passedGroup(checks.media, "checks.media");
    const voice = passedGroup(checks.voice, "checks.voice");
    const isolation = requireObject(report.isolation, "report.isolation");
    const limitations = requireObject(report.limitations, "report.limitations");
    if (source.format !== "time-isle-media-archive" || source.mode !== "full" || target.kind !== "single-use-copy" ||
        isolation.target !== "single-use-copy" || isolation.currentMuseumCapabilityProvided !== false ||
        isolation.currentMuseumWrites !== 0 || isolation.sandboxDestroyed !== true ||
        limitations.currentMuseumModifiedByRehearsal !== false || limitations.disasterRecoveryProven !== false ||
        limitations.remoteRestoreTested !== false || limitations.productionRtoRpoProven !== false ||
        limitations.diskEncryptionProvided !== false || limitations.processIsolationProvided !== false ||
        limitations.statement !== LIMITATION_STATEMENT) {
      throw new Error("Isolated recovery safety boundary is invalid.");
    }
    const startedAt = timestamp(report.startedAt, "report.startedAt");
    const completedAt = timestamp(report.completedAt, "report.completedAt");
    const durationMs = integer(report.durationMs, "report.durationMs", 0, 24 * 60 * 60 * 1000);
    if (Date.parse(completedAt) - Date.parse(startedAt) !== durationMs) {
      throw new Error("Isolated recovery receipt timeline is inconsistent.");
    }
    const entryCount = integer(source.entryCount, "source.entryCount", 1, ISOLATED_RECOVERY_MAXIMUM_BUDGET.maxEntries);
    const expandedBytes = integer(source.expandedBytes, "source.expandedBytes", 0, ISOLATED_RECOVERY_MAXIMUM_BUDGET.maxExpandedBytes);
    const counts = normalizeCounts(restore.counts);
    const entriesVerified = integer(archive.entriesVerified, "archive.entriesVerified", 1, entryCount);
    if (entriesVerified !== entryCount || counts.mediaAssets !== integer(media.assetsVerified, "media.assetsVerified", 0) ||
        counts.mediaVariants !== integer(media.variantsVerified, "media.variantsVerified", 0) ||
        counts.voiceAssets !== integer(voice.assetsVerified, "voice.assetsVerified", 0) ||
        counts.voiceAssets !== integer(voice.filesVerified, "voice.filesVerified", 0)) {
      throw new Error("Isolated recovery receipt counts are inconsistent.");
    }
    const databasePassed = integer(database.passed, "database.passed", 1);
    const databaseTotal = integer(database.total, "database.total", 1);
    if (databasePassed !== databaseTotal) throw new Error("Database checks are incomplete.");

    return deepFreeze({
      format: ISOLATED_RECOVERY_FORMAT,
      version: ISOLATED_RECOVERY_VERSION,
      kind: ISOLATED_RECOVERY_KIND,
      requestId: pattern(report.requestId, REQUEST_ID_PATTERN, "report.requestId"),
      startedAt,
      completedAt,
      durationMs,
      verdict: "passed-isolated-restore",
      source: {
        format: "time-isle-media-archive",
        formatVersion: integer(source.formatVersion, "source.formatVersion", 1),
        schemaVersion: integer(source.schemaVersion, "source.schemaVersion", 1),
        mode: "full",
        entryCount,
        expandedBytes
      },
      target: {
        schemaVersion: integer(target.schemaVersion, "target.schemaVersion", 1),
        kind: "single-use-copy"
      },
      checks: {
        archive: {
          status: "passed",
          entriesVerified,
          referencesRechecked: integer(archive.referencesRechecked, "archive.referencesRechecked", 0)
        },
        restore: { status: "passed", counts },
        database: {
          status: "passed",
          passed: databasePassed,
          total: databaseTotal,
          attention: integer(database.attention, "database.attention", 0)
        },
        references: {
          status: "passed",
          edgesChecked: integer(references.edgesChecked, "references.edgesChecked", 0)
        },
        media: {
          status: "passed",
          assetsVerified: counts.mediaAssets,
          variantsVerified: counts.mediaVariants
        },
        voice: {
          status: "passed",
          assetsVerified: counts.voiceAssets,
          filesVerified: counts.voiceAssets
        }
      },
      isolation: {
        target: "single-use-copy",
        currentMuseumCapabilityProvided: false,
        currentMuseumWrites: 0,
        sandboxDestroyed: true
      },
      limitations: {
        currentMuseumModifiedByRehearsal: false,
        disasterRecoveryProven: false,
        remoteRestoreTested: false,
        productionRtoRpoProven: false,
        diskEncryptionProvided: false,
        processIsolationProvided: false,
        statement: LIMITATION_STATEMENT
      }
    });
  } catch (cause) {
    if (cause?.code === "ISOLATED_RECOVERY_UNSAFE_RECEIPT") throw cause;
    const error = new Error("Isolated recovery rehearsal produced an unsafe or invalid receipt.", { cause });
    error.code = "ISOLATED_RECOVERY_UNSAFE_RECEIPT";
    error.statusCode = 500;
    throw error;
  }
}

function normalizeCounts(value) {
  requireObject(value, "checks.restore.counts");
  const result = {};
  for (const key of COUNT_KEYS) result[key] = integer(value[key], `counts.${key}`, 0);
  return result;
}

function passedGroup(value, name) {
  requireObject(value, name);
  if (value.status !== "passed") throw new Error(`${name} did not pass.`);
  return value;
}

function assertArchiveContentType(request, httpError) {
  const contentType = String(request.headers?.["content-type"] || "").split(";", 1)[0].trim().toLowerCase();
  if (!ARCHIVE_CONTENT_TYPES.has(contentType)) {
    throw codedHttpError(
      httpError,
      415,
      "Isolated recovery rehearsal accepts .time-isle archives only.",
      "ISOLATED_RECOVERY_CONTENT_TYPE_INVALID"
    );
  }
}

function assertNoQuery(url, httpError) {
  if ([...url.searchParams.keys()].length) {
    throw codedHttpError(
      httpError,
      400,
      "Isolated recovery rehearsal does not accept query parameters.",
      "ISOLATED_RECOVERY_QUERY_INVALID"
    );
  }
}

function requireObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new Error(`${name} must be a plain object.`);
  }
  return value;
}

function integer(value, name, minimum, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`${name} is invalid.`);
  return value;
}

function timestamp(value, name) {
  if (typeof value !== "string" || value.length > 40 || !Number.isFinite(Date.parse(value)) ||
      new Date(value).toISOString() !== value) throw new Error(`${name} is invalid.`);
  return value;
}

function pattern(value, expected, name) {
  if (typeof value !== "string" || !expected.test(value)) throw new Error(`${name} is invalid.`);
  return value;
}

function codedHttpError(httpError, statusCode, message, code) {
  const error = httpError(statusCode, message);
  error.code = code;
  return error;
}

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  Object.values(value).forEach((item) => deepFreeze(item, seen));
  return Object.freeze(value);
}

module.exports = {
  createIsolatedRecoveryApi,
  publicIsolatedRecoveryReceipt,
  ISOLATED_RECOVERY_PATH,
  ARCHIVE_CONTENT_TYPES
};
