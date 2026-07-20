"use strict";

const { withRequestAbort } = require("./archive-http");
const {
  STRUCTURAL_RECOVERY_FORMAT,
  STRUCTURAL_RECOVERY_MAXIMUM_BUDGET,
  STRUCTURAL_RECOVERY_VERSION,
  STRUCTURAL_VERIFICATION_KIND
} = require("./structural-recovery-drill");

const ARCHIVE_CONTENT_TYPES = new Set([
  "application/vnd.time-isle",
  "application/gzip",
  "application/x-gzip",
  "application/octet-stream"
]);
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const REQUEST_ID_PATTERN = /^drill_[A-Za-z0-9_-]{24}$/u;
const HASH_BASIS = "trusted-complete-archive-preflight";
const REFERENCE_BASIS = "trusted-complete-archive-preflight-plus-bounded-core-recheck";
const LIMITATION_STATEMENT = "This is structural-verification only. It checks a full archive preflight, manifest, hashes and references without restoring into the current museum.";

function createStructuralRecoveryApi(options = {}) {
  const drill = options.drill;
  const sendJson = options.sendJson;
  const httpError = options.httpError;
  const interviewDemo = Boolean(options.interviewDemo);
  const requestAbort = options.withRequestAbort || withRequestAbort;
  if (!drill || typeof drill.run !== "function" || typeof sendJson !== "function" ||
      typeof httpError !== "function" || typeof requestAbort !== "function") {
    throw new TypeError("createStructuralRecoveryApi dependencies are incomplete.");
  }

  async function handle(request, response, url) {
    if (url?.pathname !== "/api/recovery-drills/structural") return false;

    // This branch deliberately precedes query parsing and header/body access.
    // Public demo requests therefore stage zero uploaded bytes.
    if (!new Set(["GET", "HEAD"]).has(request.method) && interviewDemo) {
      return sendJson(response, 403, {
        error: "The public demo does not stage structural recovery archives and did not read this request body.",
        code: "RECOVERY_DRILL_DEMO_READ_ONLY",
        interviewDemo: true,
        bodyBytesRead: 0
      });
    }

    if (request.method !== "POST") {
      throw codedHttpError(
        httpError,
        405,
        "Structural recovery verification accepts POST archive uploads only.",
        "RECOVERY_DRILL_METHOD_NOT_ALLOWED"
      );
    }
    assertNoQuery(url, httpError);
    assertArchiveContentType(request, httpError);
    return requestAbort(request, response, async (signal) => {
      const report = await drill.run(request, { signal, demoMode: false });
      signal.throwIfAborted();
      const verification = publicStructuralVerification(report);
      response.setHeader("Cache-Control", "no-store");
      return sendJson(response, 200, {
        ok: true,
        verification
      });
    });
  }

  return Object.freeze({ handle });
}

/**
 * A strict output projection. Even a future preflight implementation cannot
 * accidentally return memory text, IDs, verifier material or restore claims.
 */
function publicStructuralVerification(report) {
  try {
    requireObject(report, "report");
    if (report.format !== STRUCTURAL_RECOVERY_FORMAT || report.version !== STRUCTURAL_RECOVERY_VERSION ||
        report.kind !== STRUCTURAL_VERIFICATION_KIND || report.verdict !== "passed-structural-verification") {
      throw new Error("Structural verification identity is invalid.");
    }
    const archive = requireObject(report.archive, "report.archive");
    const manifest = requireObject(report.checks?.manifest, "report.checks.manifest");
    const hashes = requireObject(report.checks?.hashes, "report.checks.hashes");
    const references = requireObject(report.checks?.references, "report.checks.references");
    const safety = requireObject(report.safety, "report.safety");
    const limitations = requireObject(report.limitations, "report.limitations");
    if (archive.format !== "time-isle-media-archive" || archive.mode !== "full" ||
        manifest.status !== "passed" || manifest.requiredFullEntriesPresent !== true ||
        hashes.status !== "passed" || references.status !== "passed" ||
        safety.currentCollectionWrites !== 0 || safety.currentMediaWrites !== 0 ||
        safety.restoreCallbacksAvailable !== false || safety.verifierMaterialIncluded !== false ||
        limitations.actualRestorePerformed !== false || limitations.isolatedRestorePerformed !== false ||
        limitations.disasterRecoveryProven !== false || limitations.diskEncryptionProvided !== false ||
        limitations.statement !== LIMITATION_STATEMENT || hashes.basis !== HASH_BASIS ||
        references.basis !== REFERENCE_BASIS) {
      throw new Error("Structural verification safety boundary is invalid.");
    }
    const startedAt = requireTimestamp(report.startedAt, "report.startedAt");
    const completedAt = requireTimestamp(report.completedAt, "report.completedAt");
    if (Date.parse(completedAt) < Date.parse(startedAt)) {
      throw new Error("Structural verification timeline is invalid.");
    }
    const entryCount = requireInteger(archive.entryCount, "archive.entryCount", 1);
    const entriesDeclared = requireInteger(manifest.entriesDeclared, "manifest.entriesDeclared", 1);
    const entriesVerified = requireInteger(hashes.entriesVerified, "hashes.entriesVerified", 1);
    if (entriesDeclared !== entryCount || entriesVerified !== entryCount) {
      throw new Error("Structural verification entry counts are inconsistent.");
    }
    const budget = normalizeBudget(safety.budget);
    const expandedBytes = requireInteger(archive.expandedBytes, "archive.expandedBytes", 0, budget.maxExpandedBytes);
    const memoryCount = requireInteger(references.memoryCount, "references.memoryCount", 0, budget.maxMemories);
    const mediaAssetCount = requireInteger(
      references.mediaAssetCount,
      "references.mediaAssetCount",
      0,
      budget.maxMediaAssets
    );
    const mediaLinksRechecked = requireInteger(
      references.mediaLinksRechecked,
      "references.mediaLinksRechecked",
      0,
      budget.maxReferenceEdges
    );
    const observationsRechecked = requireInteger(
      references.observationsRechecked,
      "references.observationsRechecked",
      0,
      budget.maxObservations
    );
    if (entryCount > budget.maxEntries) throw new Error("Structural verification entry count exceeds its budget.");
    return deepFreeze({
      format: STRUCTURAL_RECOVERY_FORMAT,
      version: STRUCTURAL_RECOVERY_VERSION,
      kind: STRUCTURAL_VERIFICATION_KIND,
      requestId: requirePattern(report.requestId, REQUEST_ID_PATTERN, "report.requestId"),
      startedAt,
      completedAt,
      verdict: "passed-structural-verification",
      archive: {
        format: "time-isle-media-archive",
        formatVersion: requireInteger(archive.formatVersion, "archive.formatVersion", 1),
        schemaVersion: requireInteger(archive.schemaVersion, "archive.schemaVersion", 1),
        appVersion: requireAppVersion(archive.appVersion),
        mode: "full",
        exportedAt: requireTimestamp(archive.exportedAt, "archive.exportedAt"),
        entryCount,
        expandedBytes,
        archiveFingerprint: requirePattern(archive.archiveFingerprint, SHA256_PATTERN, "archive.archiveFingerprint")
      },
      checks: {
        manifest: {
          status: "passed",
          entriesDeclared,
          requiredFullEntriesPresent: true
        },
        hashes: {
          status: "passed",
          entriesVerified,
          descriptorBindingsRechecked: requireInteger(
            hashes.descriptorBindingsRechecked,
            "hashes.descriptorBindingsRechecked",
            0
          ),
          basis: HASH_BASIS
        },
        references: {
          status: "passed",
          memoryCount,
          mediaAssetCount,
          mediaLinksRechecked,
          observationsRechecked,
          declaredSectionsVerifiedByPreflight: requireInteger(
            references.declaredSectionsVerifiedByPreflight,
            "references.declaredSectionsVerifiedByPreflight",
            0
          ),
          basis: REFERENCE_BASIS
        }
      },
      safety: {
        currentCollectionWrites: 0,
        currentMediaWrites: 0,
        restoreCallbacksAvailable: false,
        verifierMaterialIncluded: false,
        budget
      },
      limitations: {
        actualRestorePerformed: false,
        isolatedRestorePerformed: false,
        disasterRecoveryProven: false,
        diskEncryptionProvided: false,
        statement: LIMITATION_STATEMENT
      }
    });
  } catch (cause) {
    if (cause?.code === "RECOVERY_DRILL_UNSAFE_REPORT") throw cause;
    const error = new Error("Structural recovery drill produced an unsafe or invalid report.", { cause });
    error.code = "RECOVERY_DRILL_UNSAFE_REPORT";
    error.statusCode = 500;
    throw error;
  }
}

function normalizeBudget(input) {
  requireObject(input, "report.safety.budget");
  const result = {};
  for (const [key, maximum] of Object.entries(STRUCTURAL_RECOVERY_MAXIMUM_BUDGET)) {
    result[key] = requireInteger(input[key], `report.safety.budget.${key}`, 1, maximum);
  }
  if (result.maxEntryBytes > result.maxExpandedBytes) {
    throw new Error("Structural verification byte budgets are inconsistent.");
  }
  return result;
}

function assertArchiveContentType(request, httpError) {
  const contentType = String(request.headers?.["content-type"] || "").split(";", 1)[0].trim().toLowerCase();
  if (!ARCHIVE_CONTENT_TYPES.has(contentType)) {
    throw codedHttpError(
      httpError,
      415,
      "Structural recovery verification accepts .time-isle archives only.",
      "RECOVERY_DRILL_CONTENT_TYPE_INVALID"
    );
  }
}

function assertNoQuery(url, httpError) {
  if ([...url.searchParams.keys()].length) {
    throw codedHttpError(
      httpError,
      400,
      "Structural recovery verification does not accept query parameters.",
      "RECOVERY_DRILL_QUERY_INVALID"
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

function requireInteger(value, name, minimum, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} is outside its safety budget.`);
  }
  return value;
}

function requirePattern(value, pattern, name) {
  if (typeof value !== "string" || !pattern.test(value)) throw new Error(`${name} is invalid.`);
  return value;
}

function requireTimestamp(value, name) {
  if (typeof value !== "string" || value.length > 40 || !Number.isFinite(Date.parse(value)) ||
      new Date(value).toISOString() !== value) {
    throw new Error(`${name} is invalid.`);
  }
  return value;
}

function requireAppVersion(value) {
  if ((Number.isSafeInteger(value) && value >= 0) ||
      (typeof value === "string" && Boolean(value.trim()) && value.length <= 80)) return value;
  throw new Error("archive.appVersion is invalid.");
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
  ARCHIVE_CONTENT_TYPES,
  LIMITATION_STATEMENT,
  createStructuralRecoveryApi,
  publicStructuralVerification
};
