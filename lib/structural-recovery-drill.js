"use strict";

const crypto = require("node:crypto");

const STRUCTURAL_RECOVERY_FORMAT = "time-isle.structural-recovery-verification";
const STRUCTURAL_RECOVERY_VERSION = 1;
const STRUCTURAL_VERIFICATION_KIND = "structural-verification";
const ARCHIVE_FORMAT = "time-isle-media-archive";
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/u;
const REQUEST_ID_PATTERN = /^drill_[A-Za-z0-9_-]{24}$/u;

const STRUCTURAL_RECOVERY_MAXIMUM_BUDGET = deepFreeze({
  maxEntries: 1000,
  maxEntryBytes: 25 * 1024 * 1024,
  maxExpandedBytes: 250 * 1024 * 1024,
  maxMemories: 10000,
  maxMediaAssets: 10000,
  maxReferenceEdges: 50000,
  maxObservations: 50000
});

/**
 * Builds a read-only recovery-drill runner around the archive preflight used
 * by real restore. The dependency boundary intentionally has no store,
 * restore, import, database or media-materialization callback.
 */
function createStructuralRecoveryDrill(dependencies = {}) {
  assertPlainObject(dependencies, "dependencies", "RECOVERY_DRILL_DEPENDENCY_INVALID");
  assertKnownKeys(
    dependencies,
    new Set(["prepareArchive", "clock", "randomBytes"]),
    "dependencies",
    "RECOVERY_DRILL_DEPENDENCY_INVALID"
  );
  if (typeof dependencies.prepareArchive !== "function") {
    throw drillError("prepareArchive is required.", "RECOVERY_DRILL_DEPENDENCY_INVALID", 500);
  }
  if (dependencies.clock !== undefined && typeof dependencies.clock !== "function") {
    throw drillError("clock must be a function.", "RECOVERY_DRILL_DEPENDENCY_INVALID", 500);
  }
  if (dependencies.randomBytes !== undefined && typeof dependencies.randomBytes !== "function") {
    throw drillError("randomBytes must be a function.", "RECOVERY_DRILL_DEPENDENCY_INVALID", 500);
  }

  async function run(archiveSource, options = {}) {
    assertPlainObject(options, "options", "RECOVERY_DRILL_REQUEST_INVALID");
    assertKnownKeys(
      options,
      new Set(["signal", "budget", "requestId", "demoMode"]),
      "options",
      "RECOVERY_DRILL_REQUEST_INVALID"
    );
    if (options.demoMode === true) {
      throw drillError(
        "The public demo does not stage uploaded recovery archives.",
        "RECOVERY_DRILL_DEMO_READ_ONLY",
        403
      );
    }
    throwIfAborted(options.signal);
    const budget = normalizeBudget(options.budget);
    const requestId = options.requestId === undefined
      ? `drill_${readRandomBytes(dependencies.randomBytes, 18).toString("base64url")}`
      : requirePattern(options.requestId, REQUEST_ID_PATTERN, "options.requestId", "RECOVERY_DRILL_REQUEST_INVALID");
    const startedAt = readClock(dependencies.clock);
    // Keep the caller-owned AbortSignal unfrozen; only the policy envelope and
    // its numeric limits are immutable.
    const preflightPolicy = Object.freeze({
      purpose: STRUCTURAL_VERIFICATION_KIND,
      mode: "verify-only",
      requireFullArchive: true,
      restore: false,
      writeCurrentCollection: false,
      signal: options.signal,
      limits: Object.freeze({
        maxEntries: budget.maxEntries,
        maxEntryBytes: budget.maxEntryBytes,
        maxTotalBytes: budget.maxExpandedBytes
      })
    });

    let prepared;
    try {
      prepared = await dependencies.prepareArchive(archiveSource, preflightPolicy);
    } catch (cause) {
      if (options.signal?.aborted || cause?.name === "AbortError") throw cause;
      if (String(cause?.code || "").startsWith("ARCHIVE_") ||
          String(cause?.code || "").startsWith("MEDIA_ARCHIVE_") ||
          String(cause?.code || "").startsWith("RECOVERY_DRILL_")) throw cause;
      throw drillError(
        "The archive did not complete trusted structural preflight.",
        "RECOVERY_DRILL_PREFLIGHT_FAILED",
        422,
        cause
      );
    }
    throwIfAborted(options.signal);

    const evidence = inspectPreparedArchive(prepared, budget);
    const completedAt = readClock(dependencies.clock);
    if (Date.parse(completedAt) < Date.parse(startedAt)) {
      throw drillError("Recovery drill clock moved backwards.", "RECOVERY_DRILL_CLOCK_INVALID", 500);
    }
    const archiveFingerprint = sha256(stableStringify({
      format: evidence.manifest.format,
      formatVersion: evidence.manifest.formatVersion,
      schemaVersion: evidence.manifest.schemaVersion,
      mode: evidence.manifest.mode,
      exportedAt: evidence.manifest.exportedAt,
      entries: evidence.manifest.entries.map((entry) => ({
        path: entry.path,
        bytes: entry.bytes,
        sha256: entry.sha256,
        mime: entry.mime
      }))
    }));

    return deepFreeze({
      format: STRUCTURAL_RECOVERY_FORMAT,
      version: STRUCTURAL_RECOVERY_VERSION,
      kind: STRUCTURAL_VERIFICATION_KIND,
      requestId,
      startedAt,
      completedAt,
      verdict: "passed-structural-verification",
      archive: {
        format: evidence.manifest.format,
        formatVersion: evidence.manifest.formatVersion,
        schemaVersion: evidence.manifest.schemaVersion,
        appVersion: evidence.manifest.appVersion,
        mode: "full",
        exportedAt: evidence.manifest.exportedAt,
        entryCount: evidence.entryCount,
        expandedBytes: evidence.expandedBytes,
        archiveFingerprint
      },
      checks: {
        manifest: {
          status: "passed",
          entriesDeclared: evidence.entryCount,
          requiredFullEntriesPresent: true
        },
        hashes: {
          status: "passed",
          entriesVerified: evidence.entryCount,
          descriptorBindingsRechecked: evidence.descriptorBindings,
          basis: "trusted-complete-archive-preflight"
        },
        references: {
          status: "passed",
          memoryCount: evidence.memoryCount,
          mediaAssetCount: evidence.assetCount,
          mediaLinksRechecked: evidence.linkCount,
          observationsRechecked: evidence.observationCount,
          declaredSectionsVerifiedByPreflight: evidence.sectionCount,
          basis: "trusted-complete-archive-preflight-plus-bounded-core-recheck"
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
        statement: "This is structural-verification only. It checks a full archive preflight, manifest, hashes and references without restoring into the current museum."
      }
    });
  }

  return Object.freeze({ run });
}

function inspectPreparedArchive(prepared, budget) {
  assertPlainObject(prepared, "prepared archive", "RECOVERY_DRILL_PREFLIGHT_INVALID");
  if (prepared.verified !== true) {
    throw drillError("Archive preflight did not attest verification.", "RECOVERY_DRILL_PREFLIGHT_INVALID", 422);
  }
  const manifest = normalizeManifest(prepared.manifest, budget);
  if (manifest.mode !== "full") {
    throw drillError(
      "A structural recovery drill requires a complete full archive, not a redacted export.",
      "RECOVERY_DRILL_FULL_ARCHIVE_REQUIRED",
      422
    );
  }
  const collection = requirePlainObject(prepared.collection, "prepared.collection", "RECOVERY_DRILL_PREFLIGHT_INVALID");
  if (collection.mode !== "full" || !Array.isArray(collection.memories)) {
    throw drillError("Full collection state is missing.", "RECOVERY_DRILL_FULL_ARCHIVE_REQUIRED", 422);
  }
  if (collection.memories.length > budget.maxMemories) {
    throw drillError("Memory count exceeds the drill safety budget.", "RECOVERY_DRILL_BUDGET_EXCEEDED", 413);
  }
  if (Number.isSafeInteger(collection.count) && collection.count !== collection.memories.length) {
    throw drillError("Collection memory count is inconsistent.", "RECOVERY_DRILL_REFERENCE_INVALID", 422);
  }
  const memoryIds = uniqueIds(collection.memories, "memory", budget.maxMemories);

  if (!Array.isArray(prepared.assets) || prepared.assets.length > budget.maxMediaAssets) {
    throw drillError("Media asset list exceeds the drill safety budget.", "RECOVERY_DRILL_BUDGET_EXCEEDED", 413);
  }
  if (!Array.isArray(prepared.links) || prepared.links.length > budget.maxReferenceEdges) {
    throw drillError("Media link list exceeds the drill safety budget.", "RECOVERY_DRILL_BUDGET_EXCEEDED", 413);
  }
  const observations = Array.isArray(prepared.mediaObservations)
    ? prepared.mediaObservations
    : prepared.media_observations;
  if (!Array.isArray(observations) || observations.length > budget.maxObservations) {
    throw drillError("Media observation list exceeds the drill safety budget.", "RECOVERY_DRILL_BUDGET_EXCEEDED", 413);
  }
  const assetIds = uniqueIds(prepared.assets, "media asset", budget.maxMediaAssets);
  const entriesByPath = new Map(manifest.entries.map((entry) => [entry.path, entry]));
  let descriptorBindings = 0;
  for (let index = 0; index < prepared.assets.length; index += 1) {
    const asset = requirePlainObject(prepared.assets[index], `assets[${index}]`, "RECOVERY_DRILL_REFERENCE_INVALID");
    if (!Array.isArray(asset.variants)) {
      throw drillError("Media asset variants are missing.", "RECOVERY_DRILL_REFERENCE_INVALID", 422);
    }
    for (let variantIndex = 0; variantIndex < asset.variants.length; variantIndex += 1) {
      const variant = requirePlainObject(
        asset.variants[variantIndex],
        `assets[${index}].variants[${variantIndex}]`,
        "RECOVERY_DRILL_REFERENCE_INVALID"
      );
      if (variant.assetId !== asset.id || !descriptorMatchesManifest(variant, entriesByPath)) {
        throw drillError("A media variant is not bound to its verified manifest entry.", "RECOVERY_DRILL_HASH_BINDING_INVALID", 422);
      }
      descriptorBindings += 1;
    }
  }
  const linkKeys = new Set();
  for (let index = 0; index < prepared.links.length; index += 1) {
    const link = requirePlainObject(prepared.links[index], `links[${index}]`, "RECOVERY_DRILL_REFERENCE_INVALID");
    const memoryId = requireId(link.memoryId, `links[${index}].memoryId`);
    const assetId = requireId(link.assetId, `links[${index}].assetId`);
    const key = `${memoryId}\u0000${assetId}`;
    if (!memoryIds.has(memoryId) || !assetIds.has(assetId) || linkKeys.has(key)) {
      throw drillError("A media link crosses the complete archive boundary.", "RECOVERY_DRILL_REFERENCE_INVALID", 422);
    }
    linkKeys.add(key);
  }
  const observationIds = new Set();
  for (let index = 0; index < observations.length; index += 1) {
    const observation = requirePlainObject(observations[index], `observations[${index}]`, "RECOVERY_DRILL_REFERENCE_INVALID");
    const id = requireId(observation.id, `observations[${index}].id`);
    const assetId = requireId(observation.assetId, `observations[${index}].assetId`);
    if (observationIds.has(id) || !assetIds.has(assetId)) {
      throw drillError("A media observation crosses the complete archive boundary.", "RECOVERY_DRILL_REFERENCE_INVALID", 422);
    }
    observationIds.add(id);
    const memoryId = observation.metadata?.memoryId;
    if (memoryId !== undefined &&
        (!memoryIds.has(requireId(memoryId, `observations[${index}].metadata.memoryId`)) ||
         !linkKeys.has(`${memoryId}\u0000${assetId}`))) {
      throw drillError("A media observation is not bound to its memory link.", "RECOVERY_DRILL_REFERENCE_INVALID", 422);
    }
  }

  const voiceFiles = Array.isArray(prepared.files?.voices) ? prepared.files.voices : [];
  for (let index = 0; index < voiceFiles.length; index += 1) {
    const descriptor = requirePlainObject(voiceFiles[index], `files.voices[${index}]`, "RECOVERY_DRILL_REFERENCE_INVALID");
    if (!descriptorMatchesManifest(descriptor, entriesByPath)) {
      throw drillError("A voice file is not bound to its verified manifest entry.", "RECOVERY_DRILL_HASH_BINDING_INVALID", 422);
    }
    descriptorBindings += 1;
  }
  const expandedBytes = manifest.entries.reduce((sum, entry) => sum + entry.bytes, 0);
  return {
    manifest,
    entryCount: manifest.entries.length,
    expandedBytes,
    memoryCount: memoryIds.size,
    assetCount: assetIds.size,
    linkCount: prepared.links.length,
    observationCount: observations.length,
    descriptorBindings,
    sectionCount: Array.isArray(manifest.sections) ? manifest.sections.length : 0
  };
}

function normalizeManifest(input, budget) {
  const manifest = requirePlainObject(input, "manifest", "RECOVERY_DRILL_MANIFEST_INVALID");
  if (manifest.format !== ARCHIVE_FORMAT || !Number.isSafeInteger(manifest.formatVersion) || manifest.formatVersion < 1 ||
      !Number.isSafeInteger(manifest.schemaVersion) || manifest.schemaVersion < 1 ||
      !validAppVersion(manifest.appVersion) ||
      typeof manifest.exportedAt !== "string" || !Number.isFinite(Date.parse(manifest.exportedAt)) ||
      !Array.isArray(manifest.entries) || manifest.entryCount !== manifest.entries.length) {
    throw drillError("Archive manifest is invalid.", "RECOVERY_DRILL_MANIFEST_INVALID", 422);
  }
  if (manifest.entries.length === 0 || manifest.entries.length > budget.maxEntries) {
    throw drillError("Archive entry count exceeds the drill safety budget.", "RECOVERY_DRILL_BUDGET_EXCEEDED", 413);
  }
  const seenPaths = new Set();
  const exactPaths = new Set();
  let expandedBytes = 0;
  const entries = manifest.entries.map((entry, index) => {
    requirePlainObject(entry, `manifest.entries[${index}]`, "RECOVERY_DRILL_MANIFEST_INVALID");
    const entryPath = requireArchivePath(entry.path, `manifest.entries[${index}].path`);
    const collisionKey = entryPath.normalize("NFC").toLocaleLowerCase("en-US");
    if (seenPaths.has(collisionKey)) {
      throw drillError("Archive manifest contains a duplicate path.", "RECOVERY_DRILL_MANIFEST_INVALID", 422);
    }
    seenPaths.add(collisionKey);
    exactPaths.add(entryPath);
    if (!Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || entry.bytes > budget.maxEntryBytes ||
        typeof entry.sha256 !== "string" || !SHA256_PATTERN.test(entry.sha256) ||
        typeof entry.mime !== "string" || !entry.mime || entry.mime.length > 120) {
      throw drillError("Archive manifest entry is invalid.", "RECOVERY_DRILL_MANIFEST_INVALID", 422);
    }
    expandedBytes += entry.bytes;
    if (!Number.isSafeInteger(expandedBytes) || expandedBytes > budget.maxExpandedBytes) {
      throw drillError("Expanded archive bytes exceed the drill safety budget.", "RECOVERY_DRILL_BUDGET_EXCEEDED", 413);
    }
    return deepFreeze({ path: entryPath, bytes: entry.bytes, sha256: entry.sha256, mime: entry.mime });
  });
  for (const required of ["collection.json", "media/assets.json", "media/links.json", "media/media_observations.json"]) {
    if (!exactPaths.has(required)) {
      throw drillError(`Full archive is missing ${required}.`, "RECOVERY_DRILL_FULL_ARCHIVE_REQUIRED", 422);
    }
  }
  return deepFreeze({
    format: manifest.format,
    formatVersion: manifest.formatVersion,
    schemaVersion: manifest.schemaVersion,
    appVersion: manifest.appVersion,
    mode: manifest.mode,
    exportedAt: new Date(manifest.exportedAt).toISOString(),
    entries,
    sections: Array.isArray(manifest.sections) ? manifest.sections.map((section) => ({ ...section })) : []
  });
}

function validAppVersion(value) {
  return (Number.isSafeInteger(value) && value >= 0) ||
    (typeof value === "string" && Boolean(value.trim()) && value.length <= 80);
}

function normalizeBudget(input) {
  if (input === undefined) return STRUCTURAL_RECOVERY_MAXIMUM_BUDGET;
  assertPlainObject(input, "options.budget", "RECOVERY_DRILL_REQUEST_INVALID");
  assertKnownKeys(input, new Set(Object.keys(STRUCTURAL_RECOVERY_MAXIMUM_BUDGET)),
    "options.budget", "RECOVERY_DRILL_REQUEST_INVALID");
  const normalized = {};
  for (const [key, maximum] of Object.entries(STRUCTURAL_RECOVERY_MAXIMUM_BUDGET)) {
    const value = input[key] === undefined ? maximum : input[key];
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
      throw drillError(`${key} exceeds its maximum safety budget.`, "RECOVERY_DRILL_REQUEST_INVALID", 400);
    }
    normalized[key] = value;
  }
  if (normalized.maxEntryBytes > normalized.maxExpandedBytes) {
    normalized.maxEntryBytes = normalized.maxExpandedBytes;
  }
  return deepFreeze(normalized);
}

function descriptorMatchesManifest(descriptor, entriesByPath) {
  const archivePath = descriptor.archivePath;
  const bytes = descriptor.byteSize ?? descriptor.bytes;
  const hash = descriptor.sha256;
  if (typeof archivePath !== "string" || !Number.isSafeInteger(bytes) || typeof hash !== "string") return false;
  const entry = entriesByPath.get(archivePath);
  return Boolean(entry && entry.bytes === bytes && entry.sha256 === hash);
}

function uniqueIds(records, label, maximum) {
  if (!Array.isArray(records) || records.length > maximum) {
    throw drillError(`${label} list exceeds its safety budget.`, "RECOVERY_DRILL_BUDGET_EXCEEDED", 413);
  }
  const ids = new Set();
  records.forEach((record, index) => {
    const item = requirePlainObject(record, `${label}[${index}]`, "RECOVERY_DRILL_REFERENCE_INVALID");
    const id = requireId(item.id, `${label}[${index}].id`);
    if (ids.has(id)) throw drillError(`${label} IDs are duplicated.`, "RECOVERY_DRILL_REFERENCE_INVALID", 422);
    ids.add(id);
  });
  return ids;
}

function requireArchivePath(value, name) {
  if (typeof value !== "string" || !value || value.length > 255 || value.includes("\\") || value.startsWith("/") ||
      /^[A-Za-z]:/u.test(value) || value.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
    throw drillError(`${name} is invalid.`, "RECOVERY_DRILL_MANIFEST_INVALID", 422);
  }
  return value;
}

function requireId(value, name) {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    throw drillError(`${name} is invalid.`, "RECOVERY_DRILL_REFERENCE_INVALID", 422);
  }
  return value;
}

function requirePattern(value, pattern, name, code) {
  if (typeof value !== "string" || !pattern.test(value)) throw drillError(`${name} is invalid.`, code, 400);
  return value;
}

function requirePlainObject(value, name, code) {
  assertPlainObject(value, name, code);
  return value;
}

function assertPlainObject(value, name, code) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw drillError(`${name} must be a plain object.`, code, 400);
  }
}

function assertKnownKeys(value, allowed, name, code) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) throw drillError(`${name} contains unsupported fields: ${unknown.join(", ")}.`, code, 400);
}

function readClock(clock) {
  const value = typeof clock === "function" ? clock() : new Date();
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw drillError("Clock returned an invalid time.", "RECOVERY_DRILL_CLOCK_INVALID", 500);
  return parsed.toISOString();
}

function readRandomBytes(randomSource, length) {
  const value = typeof randomSource === "function" ? randomSource(length) : crypto.randomBytes(length);
  if (!(Buffer.isBuffer(value) || value instanceof Uint8Array) || value.byteLength !== length) {
    throw drillError("Random source returned an invalid byte sequence.", "RECOVERY_DRILL_RANDOM_INVALID", 500);
  }
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  if (typeof signal.throwIfAborted === "function") signal.throwIfAborted();
  const error = new Error("Structural recovery drill was aborted.");
  error.name = "AbortError";
  throw error;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  Object.values(value).forEach((item) => deepFreeze(item, seen));
  return Object.freeze(value);
}

function drillError(message, code, statusCode, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

module.exports = {
  createStructuralRecoveryDrill,
  inspectPreparedArchive,
  STRUCTURAL_RECOVERY_FORMAT,
  STRUCTURAL_RECOVERY_MAXIMUM_BUDGET,
  STRUCTURAL_RECOVERY_VERSION,
  STRUCTURAL_VERIFICATION_KIND
};
