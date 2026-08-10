"use strict";

const crypto = require("node:crypto");

const CONSENT_RECEIPT_FORMAT = "time-isle-external-ai-consent-v1";
const DEFAULT_CONSENT_MAX_AGE_MS = 5 * 60 * 1000;
const EXECUTION_RECEIPT_FORMAT = "time-isle-organize-execution-receipt-v1";
const DEFAULT_RECEIPT_MAX_AGE_MS = 2 * 60 * 60 * 1000;

function createAiTrustService(options = {}) {
  const runtimeTrust = options.runtimeTrust;
  if (!runtimeTrust || !/^sha256:[a-f0-9]{64}$/u.test(String(runtimeTrust.contractId || ""))) {
    throw new TypeError("AI trust service requires a content-bound runtime contract.");
  }
  const secret = Buffer.from(options.secret || crypto.randomBytes(32));
  if (secret.length < 32) throw new TypeError("AI execution receipt secret must be at least 32 bytes.");
  const now = typeof options.now === "function" ? options.now : Date.now;
  const maxAgeMs = Number.isSafeInteger(options.maxAgeMs) && options.maxAgeMs > 0
    ? options.maxAgeMs
    : DEFAULT_RECEIPT_MAX_AGE_MS;
  const consentMaxAgeMs = Number.isSafeInteger(options.consentMaxAgeMs) && options.consentMaxAgeMs > 0
    ? options.consentMaxAgeMs
    : DEFAULT_CONSENT_MAX_AGE_MS;
  const consumedConsentNonces = new Map();

  function createExternalConsent(request = {}) {
    if (runtimeTrust.externalAi?.allowed !== true) throw consentError("AI_CONSENT_UNAVAILABLE", "当前运行模式不允许调用外部 AI。");
    if (request.acknowledged !== true || request.contractId !== runtimeTrust.contractId ||
        !validFeature(request.feature) || !validSha256(request.inputSha256)) {
      throw invalidConsentError();
    }
    const issuedAt = now();
    const payload = {
      format: CONSENT_RECEIPT_FORMAT,
      acknowledged: true,
      contractId: runtimeTrust.contractId,
      feature: request.feature,
      inputSha256: request.inputSha256,
      nonce: crypto.randomBytes(24).toString("base64url"),
      issuedAt,
      expiresAt: issuedAt + consentMaxAgeMs
    };
    return Object.freeze({ ...payload, signature: sign(payload) });
  }

  function consumeExplicitConsent(body, feature, input) {
    if (body?.allowExternalAi !== true) return false;
    const consent = body.externalAiConsent;
    const currentTime = now();
    pruneConsumedConsents(currentTime);
    if (!isPlainObject(consent) || consent.format !== CONSENT_RECEIPT_FORMAT ||
        consent.acknowledged !== true || consent.contractId !== runtimeTrust.contractId ||
        consent.feature !== feature || consent.inputSha256 !== digestInput(feature, input) ||
        !/^[A-Za-z0-9_-]{32}$/u.test(String(consent.nonce || "")) ||
        !Number.isSafeInteger(consent.issuedAt) || !Number.isSafeInteger(consent.expiresAt) ||
        consent.expiresAt <= consent.issuedAt || consent.expiresAt - consent.issuedAt !== consentMaxAgeMs ||
        currentTime < consent.issuedAt - 30_000 || currentTime > consent.expiresAt ||
        !validSha256(consent.signature)) {
      throw invalidConsentError();
    }
    const payload = {
      format: consent.format,
      acknowledged: consent.acknowledged,
      contractId: consent.contractId,
      feature: consent.feature,
      inputSha256: consent.inputSha256,
      nonce: consent.nonce,
      issuedAt: consent.issuedAt,
      expiresAt: consent.expiresAt
    };
    const expected = Buffer.from(sign(payload), "hex");
    const received = Buffer.from(consent.signature, "hex");
    if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) throw invalidConsentError();
    if (consumedConsentNonces.has(consent.nonce)) {
      throw consentError("AI_CONSENT_REPLAYED", "这次外部 AI 同意已经使用过，请重新核对后再试。");
    }
    consumedConsentNonces.set(consent.nonce, consent.expiresAt);
    return true;
  }

  function pruneConsumedConsents(currentTime) {
    for (const [nonce, expiresAt] of consumedConsentNonces) {
      if (expiresAt < currentTime) consumedConsentNonces.delete(nonce);
    }
  }

  function createExecutionReceipt({ feature, memoryId, input, execution }) {
    if (feature !== "organize" || !validMemoryId(memoryId) || !isPlainObject(execution)) {
      throw new TypeError("Execution receipt context is invalid.");
    }
    const issuedAt = now();
    const payload = {
      format: EXECUTION_RECEIPT_FORMAT,
      contractId: runtimeTrust.contractId,
      feature,
      memoryId,
      inputSha256: digestInput(feature, input),
      issuedAt,
      expiresAt: issuedAt + maxAgeMs,
      execution: cloneJson(execution)
    };
    return Object.freeze({ ...payload, signature: sign(payload) });
  }

  function verifyExecutionReceipt(receipt, { feature, memoryId, input }) {
    if (!isPlainObject(receipt) || receipt.format !== EXECUTION_RECEIPT_FORMAT ||
        receipt.contractId !== runtimeTrust.contractId || receipt.feature !== feature ||
        receipt.memoryId !== memoryId || receipt.inputSha256 !== digestInput(feature, input) ||
        !Number.isSafeInteger(receipt.issuedAt) || !Number.isSafeInteger(receipt.expiresAt) ||
        receipt.expiresAt <= receipt.issuedAt || receipt.expiresAt - receipt.issuedAt !== maxAgeMs ||
        now() < receipt.issuedAt - 30_000 || now() > receipt.expiresAt || !isPlainObject(receipt.execution) ||
        !/^[a-f0-9]{64}$/u.test(String(receipt.signature || ""))) {
      throw invalidReceiptError();
    }
    const payload = {
      format: receipt.format,
      contractId: receipt.contractId,
      feature: receipt.feature,
      memoryId: receipt.memoryId,
      inputSha256: receipt.inputSha256,
      issuedAt: receipt.issuedAt,
      expiresAt: receipt.expiresAt,
      execution: receipt.execution
    };
    const expected = Buffer.from(sign(payload), "hex");
    const received = Buffer.from(receipt.signature, "hex");
    if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) throw invalidReceiptError();
    return Object.freeze(cloneJson(receipt.execution));
  }

  function sign(payload) {
    return crypto.createHmac("sha256", secret).update(stableStringify(payload)).digest("hex");
  }

  return Object.freeze({ consumeExplicitConsent, createExecutionReceipt, createExternalConsent, verifyExecutionReceipt });
}

function digestInput(feature, input) {
  return crypto.createHash("sha256").update(`${String(feature || "")}\u0000${String(input || "")}`, "utf8").digest("hex");
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isPlainObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function cloneJson(value) { return JSON.parse(JSON.stringify(value)); }
function validMemoryId(value) { return /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/u.test(String(value || "")); }
function validFeature(value) { return ["organize", "guide"].includes(value); }
function validSha256(value) { return /^[a-f0-9]{64}$/u.test(String(value || "")); }
function isPlainObject(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
function consentError(code, message) { const error = new Error(message); error.code = code; return error; }
function invalidConsentError() { return consentError("AI_CONSENT_INVALID", "外部 AI 同意无效、已过期或与当前输入不匹配，请重新核对。"); }
function invalidReceiptError() { const error = new Error("整理执行回执无效、已过期或与当前原文不匹配。"); error.code = "AI_EXECUTION_RECEIPT_INVALID"; return error; }

module.exports = {
  CONSENT_RECEIPT_FORMAT,
  DEFAULT_CONSENT_MAX_AGE_MS,
  DEFAULT_RECEIPT_MAX_AGE_MS,
  EXECUTION_RECEIPT_FORMAT,
  createAiTrustService,
  digestInput,
  stableStringify
};
