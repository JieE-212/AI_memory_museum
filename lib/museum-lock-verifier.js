"use strict";

const crypto = require("node:crypto");
const {
  MUSEUM_LOCK_SECURITY_BUDGET,
  RECOVERY_VERIFIER_FORMAT,
  RECOVERY_VERIFIER_VERSION,
  normalizeRecoveryVerifier,
  sameRecoveryVerifier
} = require("./museum-lock-service");

const PASSPHRASE_MINIMUM_BYTES = 8;
const PASSPHRASE_MAXIMUM_BYTES = 1024;
const DEFAULT_SALT_BYTES = 16;

const DEFAULT_RECOVERY_VERIFIER_POLICY = deepFreeze({
  algorithm: "scrypt-sha256",
  saltBytes: DEFAULT_SALT_BYTES,
  passphraseBytes: {
    minimum: PASSPHRASE_MINIMUM_BYTES,
    maximum: PASSPHRASE_MAXIMUM_BYTES
  },
  scrypt: {
    cost: 32768,
    blockSize: 8,
    parallelization: 1,
    keyLength: 32
  },
  pbkdf2Sha256: {
    iterations: 310000,
    keyLength: 32
  }
});

/**
 * Creates the verifier stored by the museum lock. The passphrase is converted
 * to a short-lived Buffer and that Buffer is overwritten after the KDF has
 * completed. Callers receive only KDF metadata, salt and a derived digest.
 */
async function createRecoveryVerifier(passphrase, options = {}) {
  assertPlainObject(options, "options");
  assertKnownKeys(options, new Set(["algorithm", "parameters", "randomBytes", "saltBytes", "signal"]), "options");
  throwIfAborted(options.signal);
  const algorithm = options.algorithm === undefined
    ? DEFAULT_RECOVERY_VERIFIER_POLICY.algorithm
    : requireAlgorithm(options.algorithm);
  const parameters = normalizeCreationParameters(algorithm, options.parameters);
  const saltBytes = options.saltBytes === undefined
    ? DEFAULT_RECOVERY_VERIFIER_POLICY.saltBytes
    : requireSaltLength(options.saltBytes);
  const salt = readRandomBytes(options.randomBytes, saltBytes);
  try {
    return await deriveRecoveryVerifier(passphrase, {
      format: RECOVERY_VERIFIER_FORMAT,
      version: RECOVERY_VERIFIER_VERSION,
      algorithm,
      parameters,
      salt: salt.toString("base64url"),
      digest: Buffer.alloc(MUSEUM_LOCK_SECURITY_BUDGET.digestBytes).toString("base64url")
    }, { signal: options.signal });
  } finally {
    salt.fill(0);
  }
}

/**
 * Re-derives a verifier using an existing verifier's immutable KDF metadata.
 * It never accepts caller-selected work factors at this boundary.
 */
async function deriveRecoveryVerifier(passphrase, template, options = {}) {
  assertPlainObject(options, "options");
  assertKnownKeys(options, new Set(["signal"]), "options");
  const normalized = normalizeRecoveryVerifier(template);
  throwIfAborted(options.signal);
  const secret = readPassphrase(passphrase);
  const salt = Buffer.from(normalized.salt, "base64url");
  let digest = null;
  try {
    digest = normalized.algorithm === "scrypt-sha256"
      ? await runScrypt(secret, salt, normalized.parameters)
      : await runPbkdf2(secret, salt, normalized.parameters);
    throwIfAborted(options.signal);
    return normalizeRecoveryVerifier({
      format: normalized.format,
      version: normalized.version,
      algorithm: normalized.algorithm,
      parameters: normalized.parameters,
      salt: normalized.salt,
      digest: digest.toString("base64url")
    });
  } finally {
    secret.fill(0);
    salt.fill(0);
    if (digest) digest.fill(0);
  }
}

async function verifyRecoveryPassphrase(passphrase, verifier, options = {}) {
  const normalized = normalizeRecoveryVerifier(verifier);
  const candidate = await deriveRecoveryVerifier(passphrase, normalized, options);
  return sameRecoveryVerifier(normalized, candidate);
}

function runScrypt(secret, salt, parameters) {
  const estimatedBytes = 128 * parameters.cost * parameters.blockSize;
  const maxmem = Math.min(
    MUSEUM_LOCK_SECURITY_BUDGET.scrypt.maximumMemoryBytes,
    Math.max(64 * 1024 * 1024, estimatedBytes + (8 * 1024 * 1024))
  );
  return new Promise((resolve, reject) => {
    crypto.scrypt(secret, salt, parameters.keyLength, {
      N: parameters.cost,
      r: parameters.blockSize,
      p: parameters.parallelization,
      maxmem
    }, (error, derived) => {
      if (error) reject(verifierError("Recovery verifier derivation failed.", "MUSEUM_LOCK_KDF_FAILED", 500, error));
      else resolve(Buffer.from(derived));
    });
  });
}

function runPbkdf2(secret, salt, parameters) {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(secret, salt, parameters.iterations, parameters.keyLength, "sha256", (error, derived) => {
      if (error) reject(verifierError("Recovery verifier derivation failed.", "MUSEUM_LOCK_KDF_FAILED", 500, error));
      else resolve(Buffer.from(derived));
    });
  });
}

function normalizeCreationParameters(algorithm, value) {
  const defaults = algorithm === "scrypt-sha256"
    ? DEFAULT_RECOVERY_VERIFIER_POLICY.scrypt
    : DEFAULT_RECOVERY_VERIFIER_POLICY.pbkdf2Sha256;
  const parameters = value === undefined ? defaults : value;
  if (!parameters || typeof parameters !== "object" || Array.isArray(parameters) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(parameters))) {
    throw verifierError("Recovery KDF parameters are invalid.", "MUSEUM_LOCK_VERIFIER_OPTIONS_INVALID", 400);
  }
  const candidate = normalizeRecoveryVerifier({
    format: RECOVERY_VERIFIER_FORMAT,
    version: RECOVERY_VERIFIER_VERSION,
    algorithm,
    parameters: { ...parameters },
    salt: Buffer.alloc(DEFAULT_SALT_BYTES).toString("base64url"),
    digest: Buffer.alloc(MUSEUM_LOCK_SECURITY_BUDGET.digestBytes).toString("base64url")
  });
  return candidate.parameters;
}

function readPassphrase(value) {
  if (typeof value !== "string" || !/\S/u.test(value)) {
    throw verifierError(
      "Recovery passphrase must contain non-whitespace text.",
      "MUSEUM_LOCK_PASSPHRASE_INVALID",
      400
    );
  }
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length < PASSPHRASE_MINIMUM_BYTES || bytes.length > PASSPHRASE_MAXIMUM_BYTES) {
    bytes.fill(0);
    throw verifierError(
      `Recovery passphrase must be ${PASSPHRASE_MINIMUM_BYTES}-${PASSPHRASE_MAXIMUM_BYTES} UTF-8 bytes.`,
      "MUSEUM_LOCK_PASSPHRASE_INVALID",
      400
    );
  }
  return bytes;
}

function readRandomBytes(source, length) {
  if (source !== undefined && typeof source !== "function") {
    throw verifierError("randomBytes must be a function.", "MUSEUM_LOCK_VERIFIER_OPTIONS_INVALID", 500);
  }
  const value = typeof source === "function" ? source(length) : crypto.randomBytes(length);
  if (!(Buffer.isBuffer(value) || value instanceof Uint8Array) || value.byteLength !== length) {
    throw verifierError("Random source returned invalid salt bytes.", "MUSEUM_LOCK_RANDOM_INVALID", 500);
  }
  return Buffer.from(value);
}

function requireAlgorithm(value) {
  if (!new Set(["scrypt-sha256", "pbkdf2-sha256"]).has(value)) {
    throw verifierError("Recovery verifier algorithm is unsupported.", "MUSEUM_LOCK_VERIFIER_OPTIONS_INVALID", 400);
  }
  return value;
}

function requireSaltLength(value) {
  const budget = MUSEUM_LOCK_SECURITY_BUDGET.saltBytes;
  if (!Number.isSafeInteger(value) || value < budget.minimum || value > budget.maximum) {
    throw verifierError("Recovery verifier salt length is invalid.", "MUSEUM_LOCK_VERIFIER_OPTIONS_INVALID", 400);
  }
  return value;
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  if (typeof signal.throwIfAborted === "function") signal.throwIfAborted();
  const error = new Error("Recovery verifier derivation was aborted.");
  error.name = "AbortError";
  error.code = "ABORT_ERR";
  throw error;
}

function assertPlainObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw verifierError(`${name} must be a plain object.`, "MUSEUM_LOCK_VERIFIER_OPTIONS_INVALID", 400);
  }
}

function assertKnownKeys(value, allowed, name) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) {
    throw verifierError(
      `${name} contains unsupported fields: ${unknown.join(", ")}.`,
      "MUSEUM_LOCK_VERIFIER_OPTIONS_INVALID",
      400
    );
  }
}

function verifierError(message, code, statusCode, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  Object.values(value).forEach((item) => deepFreeze(item, seen));
  return Object.freeze(value);
}

module.exports = {
  DEFAULT_RECOVERY_VERIFIER_POLICY,
  PASSPHRASE_MAXIMUM_BYTES,
  PASSPHRASE_MINIMUM_BYTES,
  createRecoveryVerifier,
  deriveRecoveryVerifier,
  verifyRecoveryPassphrase
};
