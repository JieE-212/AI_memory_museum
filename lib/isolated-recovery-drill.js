"use strict";

const crypto = require("node:crypto");
const {
  inspectPreparedArchive,
  STRUCTURAL_RECOVERY_MAXIMUM_BUDGET
} = require("./structural-recovery-drill");

const ISOLATED_RECOVERY_FORMAT = "time-isle.isolated-recovery-receipt";
const ISOLATED_RECOVERY_VERSION = 1;
const ISOLATED_RECOVERY_KIND = "isolated-restore";
const REQUEST_ID_PATTERN = /^recovery_[A-Za-z0-9_-]{24}$/u;
const LIMITATION_STATEMENT = "This proves that this complete archive restored and passed integrity checks in a single-use copy on the current version and machine. It does not prove remote disaster recovery, production RTO/RPO, disk encryption or process isolation.";

const ISOLATED_RECOVERY_MAXIMUM_BUDGET = deepFreeze({
  maxEntries: Math.min(500, STRUCTURAL_RECOVERY_MAXIMUM_BUDGET.maxEntries),
  maxEntryBytes: Math.min(25 * 1024 * 1024, STRUCTURAL_RECOVERY_MAXIMUM_BUDGET.maxEntryBytes),
  maxExpandedBytes: Math.min(128 * 1024 * 1024, STRUCTURAL_RECOVERY_MAXIMUM_BUDGET.maxExpandedBytes),
  maxMemories: Math.min(5000, STRUCTURAL_RECOVERY_MAXIMUM_BUDGET.maxMemories),
  maxMediaAssets: Math.min(2000, STRUCTURAL_RECOVERY_MAXIMUM_BUDGET.maxMediaAssets),
  maxReferenceEdges: Math.min(25000, STRUCTURAL_RECOVERY_MAXIMUM_BUDGET.maxReferenceEdges),
  maxObservations: Math.min(25000, STRUCTURAL_RECOVERY_MAXIMUM_BUDGET.maxObservations)
});

function createIsolatedRecoveryDrill(dependencies = {}) {
  assertPlainObject(dependencies, "dependencies", "ISOLATED_RECOVERY_DEPENDENCY_INVALID");
  assertKnownKeys(
    dependencies,
    new Set(["createSandbox", "prepareArchive", "restoreArchive", "verifySandbox", "destroySandbox", "clock", "randomBytes"]),
    "dependencies",
    "ISOLATED_RECOVERY_DEPENDENCY_INVALID"
  );
  for (const name of ["createSandbox", "prepareArchive", "restoreArchive", "verifySandbox", "destroySandbox"]) {
    if (typeof dependencies[name] !== "function") {
      throw recoveryError(`${name} is required.`, "ISOLATED_RECOVERY_DEPENDENCY_INVALID", 500);
    }
  }
  if (dependencies.clock !== undefined && typeof dependencies.clock !== "function") {
    throw recoveryError("clock must be a function.", "ISOLATED_RECOVERY_DEPENDENCY_INVALID", 500);
  }
  if (dependencies.randomBytes !== undefined && typeof dependencies.randomBytes !== "function") {
    throw recoveryError("randomBytes must be a function.", "ISOLATED_RECOVERY_DEPENDENCY_INVALID", 500);
  }

  let active = false;
  let pendingCleanup = null;

  async function run(archiveSource, options = {}) {
    assertPlainObject(options, "options", "ISOLATED_RECOVERY_REQUEST_INVALID");
    assertKnownKeys(
      options,
      new Set(["signal", "budget", "requestId", "demoMode"]),
      "options",
      "ISOLATED_RECOVERY_REQUEST_INVALID"
    );
    if (options.demoMode === true) {
      throw recoveryError(
        "The public demo does not stage recovery archives.",
        "ISOLATED_RECOVERY_DEMO_READ_ONLY",
        403
      );
    }
    if (active) {
      throw recoveryError(
        "Another isolated recovery rehearsal is already running.",
        "ISOLATED_RECOVERY_BUSY",
        409
      );
    }

    active = true;
    try {
      if (pendingCleanup) {
        try {
          const retried = await dependencies.destroySandbox(pendingCleanup);
          if (retried?.destroyed !== true) throw new Error("cleanup remains incomplete");
          pendingCleanup = null;
        } catch (cause) {
          throw recoveryError(
            "A previous single-use recovery copy still requires cleanup. No new archive was read.",
            "ISOLATED_RECOVERY_CLEANUP_REQUIRED",
            503,
            cause
          );
        }
      }

      const budget = normalizeBudget(options.budget);
      const requestId = options.requestId === undefined
        ? `recovery_${readRandomBytes(dependencies.randomBytes, 18).toString("base64url")}`
        : requirePattern(options.requestId, REQUEST_ID_PATTERN, "options.requestId", "ISOLATED_RECOVERY_REQUEST_INVALID");
      const startedAt = readClock(dependencies.clock);
      let sandbox = null;
      let prepared = null;
      let evidence = null;
      let verification = null;
      let failure = null;

      throwIfAborted(options.signal);
      try {
        sandbox = await dependencies.createSandbox({ requestId, signal: options.signal, budget });
        throwIfAborted(options.signal);
        requireSandboxHandle(sandbox);

        prepared = await dependencies.prepareArchive(archiveSource, {
          sandbox,
          signal: options.signal,
          purpose: ISOLATED_RECOVERY_KIND,
          mode: "isolated-restore",
          requireFullArchive: true,
          writeCurrentCollection: false,
          limits: Object.freeze({
            maxEntries: budget.maxEntries,
            maxEntryBytes: budget.maxEntryBytes,
            maxTotalBytes: budget.maxExpandedBytes
          })
        });
        throwIfAborted(options.signal);
        evidence = inspectPreparedArchive(prepared, budget);

        const restored = await dependencies.restoreArchive({
          sandbox,
          prepared,
          evidence,
          signal: options.signal,
          budget
        });
        throwIfAborted(options.signal);
        verification = normalizeVerification(await dependencies.verifySandbox({
          sandbox,
          prepared,
          evidence,
          restored,
          signal: options.signal,
          budget
        }), evidence, budget);
        throwIfAborted(options.signal);
      } catch (error) {
        failure = normalizeExecutionError(error);
      }

      let destroyed = false;
      if (sandbox !== null) {
        try {
          const cleanupRequest = { sandbox, requestId };
          const cleanup = await dependencies.destroySandbox(cleanupRequest);
          destroyed = cleanup?.destroyed === true;
          if (!destroyed) throw new Error("cleanup remains incomplete");
        } catch (cleanupError) {
          pendingCleanup = { sandbox, requestId };
          throw recoveryError(
            "The single-use recovery copy could not be destroyed safely. New rehearsals are blocked until cleanup succeeds.",
            "ISOLATED_RECOVERY_CLEANUP_FAILED",
            500,
            cleanupError
          );
        }
      }

      if (failure) throw failure;
      if (!prepared || !evidence || !verification || !destroyed) {
        throw recoveryError(
          "The isolated recovery rehearsal did not produce a complete receipt.",
          "ISOLATED_RECOVERY_INCOMPLETE",
          500
        );
      }

      const completedAt = readClock(dependencies.clock);
      const durationMs = Date.parse(completedAt) - Date.parse(startedAt);
      if (!Number.isSafeInteger(durationMs) || durationMs < 0) {
        throw recoveryError("Recovery rehearsal clock moved backwards.", "ISOLATED_RECOVERY_CLOCK_INVALID", 500);
      }
      return deepFreeze({
      format: ISOLATED_RECOVERY_FORMAT,
      version: ISOLATED_RECOVERY_VERSION,
      kind: ISOLATED_RECOVERY_KIND,
      requestId,
      startedAt,
      completedAt,
      durationMs,
      verdict: "passed-isolated-restore",
      source: {
        format: evidence.manifest.format,
        formatVersion: evidence.manifest.formatVersion,
        schemaVersion: evidence.manifest.schemaVersion,
        mode: "full",
        entryCount: evidence.entryCount,
        expandedBytes: evidence.expandedBytes
      },
      target: {
        schemaVersion: verification.targetSchemaVersion,
        kind: "single-use-copy"
      },
      checks: {
        archive: {
          status: "passed",
          entriesVerified: evidence.entryCount,
          referencesRechecked: safeAdd(evidence.linkCount, evidence.observationCount)
        },
        restore: {
          status: "passed",
          counts: verification.counts
        },
        database: verification.database,
        references: verification.references,
        media: verification.media,
        voice: verification.voice
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
    } finally {
      active = false;
    }
  }

  return Object.freeze({ run });
}

function normalizeVerification(input, evidence, budget) {
  assertPlainObject(input, "sandbox verification", "ISOLATED_RECOVERY_VERIFICATION_INVALID");
  assertKnownKeys(
    input,
    new Set(["targetSchemaVersion", "counts", "database", "references", "media", "voice"]),
    "sandbox verification",
    "ISOLATED_RECOVERY_VERIFICATION_INVALID"
  );
  const targetSchemaVersion = requireInteger(input.targetSchemaVersion, "targetSchemaVersion", 1, 1000000);
  const counts = normalizeCounts(input.counts, budget);
  const database = normalizeCheckGroup(input.database, "database", new Set(["status", "passed", "total", "attention"]));
  const references = normalizeCheckGroup(input.references, "references", new Set(["status", "edgesChecked"]));
  const media = normalizeCheckGroup(input.media, "media", new Set(["status", "assetsVerified", "variantsVerified"]));
  const voice = normalizeCheckGroup(input.voice, "voice", new Set(["status", "assetsVerified", "filesVerified"]));
  if (database.passed !== database.total || database.total < 1 || references.edgesChecked < 0 ||
      media.assetsVerified !== evidence.assetCount || voice.assetsVerified !== counts.voiceAssets) {
    throw recoveryError(
      "The isolated recovery verification counts are inconsistent.",
      "ISOLATED_RECOVERY_VERIFICATION_INVALID",
      500
    );
  }
  return deepFreeze({ targetSchemaVersion, counts, database, references, media, voice });
}

function normalizeCounts(value, budget) {
  assertPlainObject(value, "verification.counts", "ISOLATED_RECOVERY_VERIFICATION_INVALID");
  const allowed = new Set([
    "memories", "mediaAssets", "mediaVariants", "voiceAssets", "exhibitions", "capsules", "entities",
    "revisions", "timeCalibrations", "oralHistoryQuestions", "oralHistoryAnswers", "curatorAgentRuns",
    "memoryInboxItems", "provenanceClaims", "coMemoryResponses", "revisitIntents"
  ]);
  assertKnownKeys(value, allowed, "verification.counts", "ISOLATED_RECOVERY_VERIFICATION_INVALID");
  const result = {};
  for (const key of allowed) {
    const maximum = key === "memories" ? budget.maxMemories
      : key === "mediaAssets" ? budget.maxMediaAssets
        : Number.MAX_SAFE_INTEGER;
    result[key] = requireInteger(value[key], `verification.counts.${key}`, 0, maximum);
  }
  return deepFreeze(result);
}

function normalizeCheckGroup(value, name, allowed) {
  assertPlainObject(value, `verification.${name}`, "ISOLATED_RECOVERY_VERIFICATION_INVALID");
  assertKnownKeys(value, allowed, `verification.${name}`, "ISOLATED_RECOVERY_VERIFICATION_INVALID");
  if (value.status !== "passed") {
    throw recoveryError(`${name} verification did not pass.`, "ISOLATED_RECOVERY_VERIFICATION_FAILED", 422);
  }
  const result = { status: "passed" };
  for (const key of allowed) {
    if (key === "status") continue;
    result[key] = requireInteger(value[key], `verification.${name}.${key}`, 0);
  }
  return deepFreeze(result);
}

function normalizeBudget(input) {
  if (input === undefined) return ISOLATED_RECOVERY_MAXIMUM_BUDGET;
  assertPlainObject(input, "options.budget", "ISOLATED_RECOVERY_REQUEST_INVALID");
  assertKnownKeys(input, new Set(Object.keys(ISOLATED_RECOVERY_MAXIMUM_BUDGET)), "options.budget", "ISOLATED_RECOVERY_REQUEST_INVALID");
  const result = {};
  for (const [key, maximum] of Object.entries(ISOLATED_RECOVERY_MAXIMUM_BUDGET)) {
    const value = input[key] === undefined ? maximum : input[key];
    result[key] = requireInteger(value, `options.budget.${key}`, 1, maximum);
  }
  if (result.maxEntryBytes > result.maxExpandedBytes) result.maxEntryBytes = result.maxExpandedBytes;
  return deepFreeze(result);
}

function requireSandboxHandle(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw recoveryError("Sandbox creation did not return an isolated handle.", "ISOLATED_RECOVERY_SANDBOX_INVALID", 500);
  }
}

function normalizeExecutionError(error) {
  if (error?.name === "AbortError") return error;
  if (String(error?.code || "").startsWith("ISOLATED_RECOVERY_")) return error;
  const code = String(error?.code || "");
  if (/^(?:ARCHIVE|MEDIA_ARCHIVE|RECOVERY_DRILL)_/u.test(code)) {
    return recoveryError(
      "The archive did not pass complete recovery preflight.",
      "ISOLATED_RECOVERY_ARCHIVE_INVALID",
      code.includes("BUDGET") || code.includes("LIMIT") ? 413 : 422,
      error
    );
  }
  if (/^MEDIA_RESTORE_/u.test(code)) {
    return recoveryError(
      "The archive could not be restored completely in the single-use copy.",
      "ISOLATED_RECOVERY_RESTORE_FAILED",
      422,
      error
    );
  }
  return recoveryError(
    "The isolated recovery rehearsal failed safely.",
    "ISOLATED_RECOVERY_FAILED",
    500,
    error
  );
}

function readClock(clock) {
  const value = typeof clock === "function" ? clock() : new Date();
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw recoveryError("Clock returned an invalid time.", "ISOLATED_RECOVERY_CLOCK_INVALID", 500);
  }
  return parsed.toISOString();
}

function readRandomBytes(randomSource, length) {
  const value = typeof randomSource === "function" ? randomSource(length) : crypto.randomBytes(length);
  if (!(Buffer.isBuffer(value) || value instanceof Uint8Array) || value.byteLength !== length) {
    throw recoveryError("Random source returned invalid bytes.", "ISOLATED_RECOVERY_RANDOM_INVALID", 500);
  }
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  if (typeof signal.throwIfAborted === "function") signal.throwIfAborted();
  const error = new Error("Isolated recovery rehearsal was aborted.");
  error.name = "AbortError";
  throw error;
}

function safeAdd(left, right) {
  const result = Number(left) + Number(right);
  if (!Number.isSafeInteger(result) || result < 0) {
    throw recoveryError("Recovery receipt count overflowed.", "ISOLATED_RECOVERY_VERIFICATION_INVALID", 500);
  }
  return result;
}

function requireInteger(value, name, minimum, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw recoveryError(`${name} is outside its safety budget.`, "ISOLATED_RECOVERY_VERIFICATION_INVALID", 500);
  }
  return value;
}

function requirePattern(value, pattern, name, code) {
  if (typeof value !== "string" || !pattern.test(value)) throw recoveryError(`${name} is invalid.`, code, 400);
  return value;
}

function assertPlainObject(value, name, code) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw recoveryError(`${name} must be a plain object.`, code, 400);
  }
}

function assertKnownKeys(value, allowed, name, code) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) throw recoveryError(`${name} contains unsupported fields: ${unknown.join(", ")}.`, code, 400);
}

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  Object.values(value).forEach((item) => deepFreeze(item, seen));
  return Object.freeze(value);
}

function recoveryError(message, code, statusCode, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

module.exports = {
  createIsolatedRecoveryDrill,
  ISOLATED_RECOVERY_FORMAT,
  ISOLATED_RECOVERY_VERSION,
  ISOLATED_RECOVERY_KIND,
  ISOLATED_RECOVERY_MAXIMUM_BUDGET,
  LIMITATION_STATEMENT,
  normalizeVerification
};
