"use strict";

const crypto = require("node:crypto");

const MUSEUM_LOCK_STATE_FORMAT = "time-isle.museum-write-lock";
const MUSEUM_LOCK_STATE_VERSION = 1;
const RECOVERY_VERIFIER_FORMAT = "time-isle.recovery-verifier";
const RECOVERY_VERIFIER_VERSION = 1;
const LOCK_CONFIRMATION = "LOCK_MUSEUM_WRITES";
const UNLOCK_CONFIRMATION = "UNLOCK_MUSEUM_WRITES";
const LOCK_STATUSES = new Set(["unlocked", "locked"]);
const LOCK_ACTIONS = new Set(["lock", "unlock"]);
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const LOCK_CONTROL_PATHS = new Set(["/api/museum-lock/lock", "/api/museum-lock/unlock"]);
const LOCKED_READ_ONLY_POST_PATHS = new Set([
  "/api/archive/inspect",
  "/api/recovery-drills/structural"
]);
const TRANSITION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,95}$/u;
const STATE_ID_PATTERN = /^lock_[A-Za-z0-9_-]{24}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const MAX_SAFE_REVISION = Number.MAX_SAFE_INTEGER - 1;
const SENSITIVE_FIELD_PATTERN = /^(?:key|password|passphrase|rawSecret|recoveryKey|recoveryPhrase|secret)$/iu;

const MUSEUM_LOCK_SECURITY_BUDGET = deepFreeze({
  verifierJsonBytes: 2048,
  saltBytes: { minimum: 16, maximum: 64 },
  digestBytes: 32,
  scrypt: {
    cost: { minimum: 16384, maximum: 262144 },
    blockSize: { minimum: 8, maximum: 32 },
    parallelization: { minimum: 1, maximum: 8 },
    maximumMemoryBytes: 256 * 1024 * 1024,
    keyLength: 32
  },
  pbkdf2Sha256: {
    iterations: { minimum: 210000, maximum: 2000000 },
    keyLength: 32
  },
  transitionIdCharacters: 96
});

const MUSEUM_LOCK_ARCHIVE_POLICY = deepFreeze({
  ordinaryArchive: "excluded",
  logProjection: "public-state-only",
  reason: "The recovery verifier is authentication material and must not enter logs or ordinary collection archives."
});

function createInitialMuseumLockState(options = {}) {
  assertPlainObject(options, "options", "MUSEUM_LOCK_OPTIONS_INVALID");
  assertKnownKeys(options, new Set(["clock", "randomBytes"]), "options", "MUSEUM_LOCK_OPTIONS_INVALID");
  const at = readClock(options.clock);
  const stateId = `lock_${readRandomBytes(options.randomBytes, 18).toString("base64url")}`;
  return deepFreeze({
    format: MUSEUM_LOCK_STATE_FORMAT,
    formatVersion: MUSEUM_LOCK_STATE_VERSION,
    stateId,
    status: "unlocked",
    revision: 0,
    recoveryVerifier: null,
    createdAt: at,
    updatedAt: at,
    lockedAt: null,
    unlockedAt: at,
    lastTransition: null
  });
}

/**
 * Applies one compare-and-set lock transition. This function accepts only an
 * already-derived verifier; raw recovery keys, passwords and passphrases are
 * deliberately outside its API boundary.
 */
function applyMuseumLockTransition(currentState, command, options = {}) {
  const state = normalizeMuseumLockState(currentState);
  assertPlainObject(command, "command", "MUSEUM_LOCK_COMMAND_INVALID");
  rejectPlaintextSecretFields(command, "command");
  assertKnownKeys(
    command,
    new Set(["action", "confirmation", "expectedRevision", "operationId", "verifier"]),
    "command",
    "MUSEUM_LOCK_COMMAND_INVALID"
  );
  assertPlainObject(options, "options", "MUSEUM_LOCK_OPTIONS_INVALID");
  assertKnownKeys(options, new Set(["clock", "demoMode"]), "options", "MUSEUM_LOCK_OPTIONS_INVALID");
  if (options.demoMode === true) {
    throw lockError(
      "The public demo cannot change museum write-lock state.",
      "MUSEUM_LOCK_DEMO_READ_ONLY",
      403
    );
  }

  const action = requireEnum(command.action, LOCK_ACTIONS, "command.action", "MUSEUM_LOCK_COMMAND_INVALID");
  const expectedConfirmation = action === "lock" ? LOCK_CONFIRMATION : UNLOCK_CONFIRMATION;
  if (command.confirmation !== expectedConfirmation) {
    throw lockError(
      `Explicit ${action} confirmation is required.`,
      "MUSEUM_LOCK_CONFIRMATION_REQUIRED",
      400
    );
  }
  const expectedRevision = requireSafeInteger(
    command.expectedRevision,
    "command.expectedRevision",
    0,
    MAX_SAFE_REVISION,
    "MUSEUM_LOCK_COMMAND_INVALID"
  );
  const operationId = requirePattern(
    command.operationId,
    TRANSITION_ID_PATTERN,
    "command.operationId",
    "MUSEUM_LOCK_COMMAND_INVALID"
  );
  const verifier = normalizeRecoveryVerifier(command.verifier);
  const fingerprint = transitionFingerprint({ action, expectedRevision, operationId, verifier });

  if (state.lastTransition?.operationId === operationId) {
    if (!constantTimeHexEqual(state.lastTransition.requestFingerprint, fingerprint)) {
      throw lockError(
        "The transition operation ID was already used with different input.",
        "MUSEUM_LOCK_OPERATION_REUSED",
        409
      );
    }
    return transitionResult(state, {
      operationId,
      action,
      changed: false,
      originalChanged: true,
      idempotent: true,
      replayed: true,
      fromStatus: state.lastTransition.fromStatus,
      toStatus: state.lastTransition.toStatus,
      revision: state.lastTransition.revision,
      at: state.lastTransition.at
    });
  }

  if (expectedRevision !== state.revision) {
    throw lockError(
      `Museum lock revision changed from ${expectedRevision} to ${state.revision}.`,
      "MUSEUM_LOCK_REVISION_CONFLICT",
      409,
      { expectedRevision, actualRevision: state.revision }
    );
  }

  if (state.recoveryVerifier !== null && !sameRecoveryVerifier(state.recoveryVerifier, verifier)) {
    throw lockError("The recovery verifier did not match.", "MUSEUM_LOCK_VERIFIER_MISMATCH", 401);
  }
  if (action === "unlock" && state.recoveryVerifier === null) {
    throw lockError(
      "No recovery verifier has been configured for this museum.",
      "MUSEUM_LOCK_VERIFIER_NOT_CONFIGURED",
      409
    );
  }

  const targetStatus = action === "lock" ? "locked" : "unlocked";
  if (state.status === targetStatus) {
    return transitionResult(state, {
      operationId,
      action,
      changed: false,
      originalChanged: false,
      idempotent: true,
      replayed: false,
      fromStatus: state.status,
      toStatus: state.status,
      revision: state.revision,
      at: state.updatedAt
    });
  }
  if (state.revision >= MAX_SAFE_REVISION) {
    throw lockError("Museum lock revision is exhausted.", "MUSEUM_LOCK_REVISION_EXHAUSTED", 409);
  }

  const at = readClock(options.clock);
  if (Date.parse(at) < Date.parse(state.updatedAt)) {
    throw lockError("Museum lock clock moved backwards.", "MUSEUM_LOCK_CLOCK_INVALID", 500);
  }
  const revision = state.revision + 1;
  const lastTransition = {
    operationId,
    action,
    requestFingerprint: fingerprint,
    fromStatus: state.status,
    toStatus: targetStatus,
    revision,
    at
  };
  const next = deepFreeze({
    ...state,
    status: targetStatus,
    revision,
    recoveryVerifier: state.recoveryVerifier || verifier,
    updatedAt: at,
    lockedAt: action === "lock" ? at : state.lockedAt,
    unlockedAt: action === "unlock" ? at : state.unlockedAt,
    lastTransition
  });
  return transitionResult(next, {
    operationId,
    action,
    changed: true,
    originalChanged: true,
    idempotent: false,
    replayed: false,
    fromStatus: state.status,
    toStatus: targetStatus,
    revision,
    at
  });
}

function normalizeMuseumLockState(input) {
  assertPlainObject(input, "museum lock state", "MUSEUM_LOCK_STATE_INVALID");
  assertKnownKeys(
    input,
    new Set([
      "format", "formatVersion", "stateId", "status", "revision", "recoveryVerifier",
      "createdAt", "updatedAt", "lockedAt", "unlockedAt", "lastTransition"
    ]),
    "museum lock state",
    "MUSEUM_LOCK_STATE_INVALID"
  );
  if (input.format !== MUSEUM_LOCK_STATE_FORMAT || input.formatVersion !== MUSEUM_LOCK_STATE_VERSION) {
    throw lockError("Museum lock state format is unsupported.", "MUSEUM_LOCK_STATE_INVALID", 500);
  }
  const stateId = requirePattern(input.stateId, STATE_ID_PATTERN, "state.stateId", "MUSEUM_LOCK_STATE_INVALID");
  const status = requireEnum(input.status, LOCK_STATUSES, "state.status", "MUSEUM_LOCK_STATE_INVALID");
  const revision = requireSafeInteger(input.revision, "state.revision", 0, MAX_SAFE_REVISION, "MUSEUM_LOCK_STATE_INVALID");
  const createdAt = requireTimestamp(input.createdAt, "state.createdAt", "MUSEUM_LOCK_STATE_INVALID");
  const updatedAt = requireTimestamp(input.updatedAt, "state.updatedAt", "MUSEUM_LOCK_STATE_INVALID");
  const lockedAt = optionalTimestamp(input.lockedAt, "state.lockedAt", "MUSEUM_LOCK_STATE_INVALID");
  const unlockedAt = optionalTimestamp(input.unlockedAt, "state.unlockedAt", "MUSEUM_LOCK_STATE_INVALID");
  if (Date.parse(updatedAt) < Date.parse(createdAt) ||
      (lockedAt !== null && Date.parse(lockedAt) < Date.parse(createdAt)) ||
      (unlockedAt !== null && Date.parse(unlockedAt) < Date.parse(createdAt))) {
    throw lockError("Museum lock timestamps are inconsistent.", "MUSEUM_LOCK_STATE_INVALID", 500);
  }
  const recoveryVerifier = input.recoveryVerifier === null
    ? null
    : normalizeRecoveryVerifier(input.recoveryVerifier);
  if (status === "locked" && recoveryVerifier === null) {
    throw lockError("Locked state requires a recovery verifier.", "MUSEUM_LOCK_STATE_INVALID", 500);
  }
  if (revision === 0 && (status !== "unlocked" || recoveryVerifier !== null || input.lastTransition !== null)) {
    throw lockError("Initial museum lock state is inconsistent.", "MUSEUM_LOCK_STATE_INVALID", 500);
  }
  const lastTransition = normalizeLastTransition(input.lastTransition, revision, updatedAt);
  return deepFreeze({
    format: MUSEUM_LOCK_STATE_FORMAT,
    formatVersion: MUSEUM_LOCK_STATE_VERSION,
    stateId,
    status,
    revision,
    recoveryVerifier,
    createdAt,
    updatedAt,
    lockedAt,
    unlockedAt,
    lastTransition
  });
}

function normalizeRecoveryVerifier(input) {
  assertPlainObject(input, "recovery verifier", "MUSEUM_LOCK_VERIFIER_INVALID");
  rejectPlaintextSecretFields(input, "recovery verifier");
  assertKnownKeys(
    input,
    new Set(["format", "version", "algorithm", "parameters", "salt", "digest"]),
    "recovery verifier",
    "MUSEUM_LOCK_VERIFIER_INVALID"
  );
  let serialized;
  try { serialized = JSON.stringify(input); }
  catch (cause) { throw lockError("Recovery verifier is not JSON-safe.", "MUSEUM_LOCK_VERIFIER_INVALID", 400, null, cause); }
  if (Buffer.byteLength(serialized, "utf8") > MUSEUM_LOCK_SECURITY_BUDGET.verifierJsonBytes) {
    throw lockError("Recovery verifier exceeds its safety budget.", "MUSEUM_LOCK_VERIFIER_INVALID", 400);
  }
  if (input.format !== RECOVERY_VERIFIER_FORMAT || input.version !== RECOVERY_VERIFIER_VERSION) {
    throw lockError("Recovery verifier format is unsupported.", "MUSEUM_LOCK_VERIFIER_INVALID", 400);
  }
  const algorithm = requireEnum(
    input.algorithm,
    new Set(["scrypt-sha256", "pbkdf2-sha256"]),
    "verifier.algorithm",
    "MUSEUM_LOCK_VERIFIER_INVALID"
  );
  const parameters = algorithm === "scrypt-sha256"
    ? normalizeScryptParameters(input.parameters)
    : normalizePbkdf2Parameters(input.parameters);
  const salt = requireBase64urlBytes(
    input.salt,
    "verifier.salt",
    MUSEUM_LOCK_SECURITY_BUDGET.saltBytes.minimum,
    MUSEUM_LOCK_SECURITY_BUDGET.saltBytes.maximum
  );
  const digest = requireBase64urlBytes(
    input.digest,
    "verifier.digest",
    MUSEUM_LOCK_SECURITY_BUDGET.digestBytes,
    MUSEUM_LOCK_SECURITY_BUDGET.digestBytes
  );
  return deepFreeze({
    format: RECOVERY_VERIFIER_FORMAT,
    version: RECOVERY_VERIFIER_VERSION,
    algorithm,
    parameters,
    salt: salt.toString("base64url"),
    digest: digest.toString("base64url")
  });
}

function sameRecoveryVerifier(left, right) {
  const first = normalizeRecoveryVerifier(left);
  const second = normalizeRecoveryVerifier(right);
  const firstMetadata = verifierMetadata(first);
  const secondMetadata = verifierMetadata(second);
  const metadataMatches = constantTimeBufferEqual(Buffer.from(firstMetadata), Buffer.from(secondMetadata));
  const saltMatches = constantTimeBufferEqual(Buffer.from(first.salt, "base64url"), Buffer.from(second.salt, "base64url"));
  const digestMatches = constantTimeBufferEqual(Buffer.from(first.digest, "base64url"), Buffer.from(second.digest, "base64url"));
  return metadataMatches && saltMatches && digestMatches;
}

/**
 * Pure pre-body request gate. `mutation` may be supplied by a route registry;
 * otherwise non-safe methods are conservatively treated as mutations except
 * for the two explicitly read-only archive verification routes.
 */
function evaluateMuseumWriteGate(input = {}) {
  assertPlainObject(input, "request gate", "MUSEUM_LOCK_GATE_INVALID");
  assertKnownKeys(
    input,
    new Set(["method", "pathname", "lockState", "demoMode", "mutation"]),
    "request gate",
    "MUSEUM_LOCK_GATE_INVALID"
  );
  const method = requireHttpMethod(input.method);
  const pathname = requirePathname(input.pathname);
  const safeMethod = SAFE_METHODS.has(method);
  const conceptualReadOnlyPost = method === "POST" && LOCKED_READ_ONLY_POST_PATHS.has(pathname);
  const lockControl = method === "POST" && LOCK_CONTROL_PATHS.has(pathname);
  const declaredMutation = input.mutation === undefined
    ? !safeMethod
    : requireBoolean(input.mutation, "request gate.mutation");
  // These routes are part of the lock boundary itself or have a documented
  // verify-only contract, so a broad route registry cannot accidentally make
  // them impossible to use while locked.
  const mutation = conceptualReadOnlyPost || lockControl ? false : declaredMutation;

  if (input.demoMode === true && !safeMethod) {
    return gateDecision(false, 403, "MUSEUM_LOCK_DEMO_READ_ONLY", method, pathname, mutation,
      "The public demo rejects non-read requests before their body is read.");
  }
  if (safeMethod) {
    return gateDecision(true, 200, "MUSEUM_LOCK_READ_ALLOWED", method, pathname, false,
      "GET, HEAD and OPTIONS remain available.");
  }

  const state = normalizeMuseumLockState(input.lockState);
  if (state.status === "locked" && mutation) {
    return gateDecision(false, 423, "MUSEUM_LOCKED", method, pathname, true,
      "Museum write protection is locked; no request body should be read.");
  }
  if (state.status === "locked" && (conceptualReadOnlyPost || input.mutation === false)) {
    return gateDecision(true, 200, "MUSEUM_LOCK_READ_ONLY_OPERATION_ALLOWED", method, pathname, false,
      "Archive verification and structural recovery drills do not write the current collection.");
  }
  if (state.status === "locked" && lockControl) {
    return gateDecision(true, 200, "MUSEUM_LOCK_CONTROL_ALLOWED", method, pathname, false,
      "Explicit lock control remains available while locked.");
  }
  return gateDecision(true, 200, "MUSEUM_LOCK_WRITE_ALLOWED", method, pathname, mutation,
    "Museum write protection is unlocked.");
}

function publicMuseumLockState(input) {
  const state = normalizeMuseumLockState(input);
  return deepFreeze({
    format: state.format,
    formatVersion: state.formatVersion,
    stateId: state.stateId,
    status: state.status,
    revision: state.revision,
    verifierConfigured: state.recoveryVerifier !== null,
    verifierAlgorithm: state.recoveryVerifier?.algorithm || null,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    lockedAt: state.lockedAt,
    unlockedAt: state.unlockedAt,
    boundary: "Application-level write protection only; this is not disk or database encryption."
  });
}

function auditMuseumLockTransition(result) {
  assertPlainObject(result, "transition result", "MUSEUM_LOCK_AUDIT_INVALID");
  assertPlainObject(result.transition, "transition result.transition", "MUSEUM_LOCK_AUDIT_INVALID");
  const transition = result.transition;
  return deepFreeze({
    format: "time-isle.museum-write-lock-audit",
    version: 1,
    operationId: String(transition.operationId || ""),
    action: String(transition.action || ""),
    changed: Boolean(transition.changed),
    idempotent: Boolean(transition.idempotent),
    replayed: Boolean(transition.replayed),
    fromStatus: String(transition.fromStatus || ""),
    toStatus: String(transition.toStatus || ""),
    revision: Number(transition.revision),
    at: String(transition.at || ""),
    secretMaterialIncluded: false
  });
}

function assertNoRecoveryVerifier(value, label = "ordinary archive or log payload") {
  const visited = new Set();
  const stack = [value];
  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== "object") continue;
    if (visited.has(current)) continue;
    visited.add(current);
    if (current.format === RECOVERY_VERIFIER_FORMAT || Object.hasOwn(current, "recoveryVerifier")) {
      throw lockError(
        `${label} must exclude the recovery verifier.`,
        "MUSEUM_LOCK_VERIFIER_EXPORT_FORBIDDEN",
        500
      );
    }
    if (Array.isArray(current)) current.forEach((item) => stack.push(item));
    else Object.values(current).forEach((item) => stack.push(item));
  }
  return true;
}

function transitionResult(record, transition) {
  const safeTransition = deepFreeze({ ...transition });
  return deepFreeze({
    persistenceRecord: record,
    publicState: publicMuseumLockState(record),
    transition: safeTransition
  });
}

function normalizeScryptParameters(input) {
  assertPlainObject(input, "verifier.parameters", "MUSEUM_LOCK_VERIFIER_INVALID");
  assertKnownKeys(
    input,
    new Set(["cost", "blockSize", "parallelization", "keyLength"]),
    "verifier.parameters",
    "MUSEUM_LOCK_VERIFIER_INVALID"
  );
  const budget = MUSEUM_LOCK_SECURITY_BUDGET.scrypt;
  const cost = requireSafeInteger(input.cost, "verifier.parameters.cost", budget.cost.minimum, budget.cost.maximum,
    "MUSEUM_LOCK_VERIFIER_INVALID");
  if ((cost & (cost - 1)) !== 0) {
    throw lockError("Scrypt cost must be a power of two.", "MUSEUM_LOCK_VERIFIER_INVALID", 400);
  }
  const blockSize = requireSafeInteger(input.blockSize, "verifier.parameters.blockSize",
    budget.blockSize.minimum, budget.blockSize.maximum, "MUSEUM_LOCK_VERIFIER_INVALID");
  const parallelization = requireSafeInteger(input.parallelization, "verifier.parameters.parallelization",
    budget.parallelization.minimum, budget.parallelization.maximum, "MUSEUM_LOCK_VERIFIER_INVALID");
  const keyLength = requireSafeInteger(input.keyLength, "verifier.parameters.keyLength",
    budget.keyLength, budget.keyLength, "MUSEUM_LOCK_VERIFIER_INVALID");
  const memoryBytes = 128 * cost * blockSize;
  if (!Number.isSafeInteger(memoryBytes) || memoryBytes > budget.maximumMemoryBytes) {
    throw lockError("Scrypt parameters exceed the memory safety budget.", "MUSEUM_LOCK_VERIFIER_INVALID", 400);
  }
  return deepFreeze({ cost, blockSize, parallelization, keyLength });
}

function normalizePbkdf2Parameters(input) {
  assertPlainObject(input, "verifier.parameters", "MUSEUM_LOCK_VERIFIER_INVALID");
  assertKnownKeys(
    input,
    new Set(["iterations", "keyLength"]),
    "verifier.parameters",
    "MUSEUM_LOCK_VERIFIER_INVALID"
  );
  const budget = MUSEUM_LOCK_SECURITY_BUDGET.pbkdf2Sha256;
  const iterations = requireSafeInteger(input.iterations, "verifier.parameters.iterations",
    budget.iterations.minimum, budget.iterations.maximum, "MUSEUM_LOCK_VERIFIER_INVALID");
  const keyLength = requireSafeInteger(input.keyLength, "verifier.parameters.keyLength",
    budget.keyLength, budget.keyLength, "MUSEUM_LOCK_VERIFIER_INVALID");
  return deepFreeze({ iterations, keyLength });
}

function normalizeLastTransition(input, revision, updatedAt) {
  if (input === null) {
    if (revision !== 0) throw lockError("Museum lock transition history is missing.", "MUSEUM_LOCK_STATE_INVALID", 500);
    return null;
  }
  assertPlainObject(input, "state.lastTransition", "MUSEUM_LOCK_STATE_INVALID");
  assertKnownKeys(
    input,
    new Set(["operationId", "action", "requestFingerprint", "fromStatus", "toStatus", "revision", "at"]),
    "state.lastTransition",
    "MUSEUM_LOCK_STATE_INVALID"
  );
  const normalized = {
    operationId: requirePattern(input.operationId, TRANSITION_ID_PATTERN, "lastTransition.operationId", "MUSEUM_LOCK_STATE_INVALID"),
    action: requireEnum(input.action, LOCK_ACTIONS, "lastTransition.action", "MUSEUM_LOCK_STATE_INVALID"),
    requestFingerprint: requirePattern(input.requestFingerprint, SHA256_PATTERN, "lastTransition.requestFingerprint",
      "MUSEUM_LOCK_STATE_INVALID"),
    fromStatus: requireEnum(input.fromStatus, LOCK_STATUSES, "lastTransition.fromStatus", "MUSEUM_LOCK_STATE_INVALID"),
    toStatus: requireEnum(input.toStatus, LOCK_STATUSES, "lastTransition.toStatus", "MUSEUM_LOCK_STATE_INVALID"),
    revision: requireSafeInteger(input.revision, "lastTransition.revision", 1, MAX_SAFE_REVISION,
      "MUSEUM_LOCK_STATE_INVALID"),
    at: requireTimestamp(input.at, "lastTransition.at", "MUSEUM_LOCK_STATE_INVALID")
  };
  const expectedAction = normalized.toStatus === "locked" ? "lock" : "unlock";
  if (normalized.revision !== revision || normalized.at !== updatedAt || normalized.action !== expectedAction ||
      normalized.fromStatus === normalized.toStatus) {
    throw lockError("Museum lock transition history is inconsistent.", "MUSEUM_LOCK_STATE_INVALID", 500);
  }
  return deepFreeze(normalized);
}

function transitionFingerprint({ action, expectedRevision, operationId, verifier }) {
  return crypto.createHash("sha256").update(stableStringify({
    action,
    expectedRevision,
    operationId,
    verifier
  })).digest("hex");
}

function verifierMetadata(verifier) {
  return stableStringify({
    format: verifier.format,
    version: verifier.version,
    algorithm: verifier.algorithm,
    parameters: verifier.parameters
  });
}

function gateDecision(allowed, statusCode, code, method, pathname, mutation, reason) {
  return deepFreeze({
    allowed,
    statusCode,
    code,
    method,
    pathname,
    mutation,
    decisionStage: "pre-body",
    bodyBytesRead: 0,
    reason,
    boundary: "Application-level write protection only; this is not disk or database encryption."
  });
}

function readClock(clock) {
  const value = typeof clock === "function" ? clock() : new Date();
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw lockError("Clock returned an invalid time.", "MUSEUM_LOCK_CLOCK_INVALID", 500);
  return parsed.toISOString();
}

function readRandomBytes(randomSource, length) {
  const value = typeof randomSource === "function" ? randomSource(length) : crypto.randomBytes(length);
  if (!(Buffer.isBuffer(value) || value instanceof Uint8Array) || value.byteLength !== length) {
    throw lockError("Random source returned an invalid byte sequence.", "MUSEUM_LOCK_RANDOM_INVALID", 500);
  }
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}

function requireBase64urlBytes(value, name, minimum, maximum) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw lockError(`${name} must be canonical base64url without padding.`, "MUSEUM_LOCK_VERIFIER_INVALID", 400);
  }
  let bytes;
  try { bytes = Buffer.from(value, "base64url"); }
  catch (cause) { throw lockError(`${name} is invalid.`, "MUSEUM_LOCK_VERIFIER_INVALID", 400, null, cause); }
  if (bytes.toString("base64url") !== value || bytes.length < minimum || bytes.length > maximum) {
    throw lockError(`${name} has an invalid byte length.`, "MUSEUM_LOCK_VERIFIER_INVALID", 400);
  }
  return bytes;
}

function requireHttpMethod(value) {
  if (typeof value !== "string" || !/^[A-Z]+$/u.test(value.toUpperCase()) || value.length > 16) {
    throw lockError("request gate.method is invalid.", "MUSEUM_LOCK_GATE_INVALID", 500);
  }
  return value.toUpperCase();
}

function requirePathname(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.includes("\0") || value.length > 2048) {
    throw lockError("request gate.pathname is invalid.", "MUSEUM_LOCK_GATE_INVALID", 500);
  }
  return value;
}

function requireBoolean(value, name) {
  if (typeof value !== "boolean") throw lockError(`${name} must be boolean.`, "MUSEUM_LOCK_GATE_INVALID", 500);
  return value;
}

function requireSafeInteger(value, name, minimum, maximum, code) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw lockError(`${name} is outside its safety budget.`, code, 400);
  }
  return value;
}

function requireEnum(value, allowed, name, code) {
  if (typeof value !== "string" || !allowed.has(value)) throw lockError(`${name} is invalid.`, code, 400);
  return value;
}

function requirePattern(value, pattern, name, code) {
  if (typeof value !== "string" || !pattern.test(value)) throw lockError(`${name} is invalid.`, code, 400);
  return value;
}

function requireTimestamp(value, name, code) {
  if (typeof value !== "string" || value.length > 40) throw lockError(`${name} is invalid.`, code, 500);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) throw lockError(`${name} is invalid.`, code, 500);
  return value;
}

function optionalTimestamp(value, name, code) {
  return value === null ? null : requireTimestamp(value, name, code);
}

function rejectPlaintextSecretFields(value, label) {
  for (const key of Object.keys(value)) {
    if (SENSITIVE_FIELD_PATTERN.test(key)) {
      throw lockError(`${label} cannot contain raw secret material.`, "MUSEUM_LOCK_PLAINTEXT_SECRET_FORBIDDEN", 400);
    }
  }
}

function assertPlainObject(value, name, code) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw lockError(`${name} must be a plain object.`, code, 400);
  }
}

function assertKnownKeys(value, allowed, name, code) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) throw lockError(`${name} contains unsupported fields: ${unknown.join(", ")}.`, code, 400);
}

function constantTimeHexEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string" || !SHA256_PATTERN.test(left) || !SHA256_PATTERN.test(right)) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function constantTimeBufferEqual(left, right) {
  if (!Buffer.isBuffer(left) || !Buffer.isBuffer(right) || left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
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

function lockError(message, code, statusCode, details = null, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  error.statusCode = statusCode;
  if (details) error.details = deepFreeze({ ...details });
  return error;
}

module.exports = {
  applyMuseumLockTransition,
  assertNoRecoveryVerifier,
  auditMuseumLockTransition,
  createInitialMuseumLockState,
  evaluateMuseumWriteGate,
  normalizeMuseumLockState,
  normalizeRecoveryVerifier,
  publicMuseumLockState,
  sameRecoveryVerifier,
  LOCK_CONFIRMATION,
  LOCKED_READ_ONLY_POST_PATHS,
  MUSEUM_LOCK_ARCHIVE_POLICY,
  MUSEUM_LOCK_SECURITY_BUDGET,
  MUSEUM_LOCK_STATE_FORMAT,
  MUSEUM_LOCK_STATE_VERSION,
  RECOVERY_VERIFIER_FORMAT,
  RECOVERY_VERIFIER_VERSION,
  UNLOCK_CONFIRMATION
};
