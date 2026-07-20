(function initializeTimeIsleCoMemoryCrypto(root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("node:crypto").webcrypto);
    return;
  }
  root.TimeIsleCoMemoryCrypto = factory(root.crypto);
}(typeof globalThis !== "undefined" ? globalThis : self, function createCoMemoryCrypto(webCrypto) {
  "use strict";

  /**
   * Stateless, client-side protocol core for one encrypted request and one
   * encrypted response. Request and response use different authenticated
   * domains so neither envelope can be replayed as the other. The shared
   * passphrase provides confidentiality and tamper detection only: it does not
   * authenticate a person, relationship, speaker or historical claim.
   */
  const VERSION = 1;
  const REQUEST_FORMAT = "time-isle.co-memory-request";
  const RESPONSE_FORMAT = "time-isle.co-memory-response";
  const REQUEST_CONTENT_TYPE = "application/vnd.time-isle.co-memory-request+json";
  const RESPONSE_CONTENT_TYPE = "application/vnd.time-isle.co-memory-response+json";
  const REQUEST_BOUNDARY = "这封信笺只携带你明确选择的素材；回信不会自动改写原记忆。";
  const RESPONSE_BOUNDARY = "回信内容和署名均未经身份或事实核验；导入后仍需馆主明确确认。";
  const IDENTITY_ASSURANCE = "self-asserted-unverified";
  const DEFAULT_SHELLS = Object.freeze({
    request: Object.freeze({
      title: "一封加密共忆信笺",
      note: "输入口令后阅读；下载后无法撤回。"
    }),
    response: Object.freeze({
      title: "一封加密共忆回信",
      note: "输入口令后阅读；署名尚未核验。"
    })
  });

  const PBKDF2_ITERATIONS = 310000;
  const SALT_BYTES = 16;
  const IV_BYTES = 12;
  const KEY_BITS = 256;
  const TAG_BITS = 128;
  const TAG_BYTES = TAG_BITS / 8;
  const MIN_PASSPHRASE_LENGTH = 12;
  const MAX_PASSPHRASE_LENGTH = 1024;
  const MAX_REQUEST_BYTES = 512 * 1024;
  const MAX_RESPONSE_BYTES = 256 * 1024;
  const MAX_REQUEST_FILE_BYTES = Math.ceil((MAX_REQUEST_BYTES + TAG_BYTES) * 4 / 3) + 4096;
  const MAX_RESPONSE_FILE_BYTES = Math.ceil((MAX_RESPONSE_BYTES + TAG_BYTES) * 4 / 3) + 4096;
  const MAX_EVIDENCE_ITEMS = 24;
  const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
  const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
  const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{15,119}$/u;
  const CONTROL_PATTERN = /[\u0000-\u0009\u000B\u000C\u000E-\u001F\u007F]/u;
  const PASSPHRASE_CONTROL_PATTERN = /[\u0000-\u001F\u007F]/u;
  const EVIDENCE_KINDS = new Set(["quote", "transcript", "note"]);
  const encoder = new TextEncoder();
  const decoder = new TextDecoder("utf-8", { fatal: true });

  function protocolFor(kind) {
    if (kind === "request") {
      return {
        kind,
        format: REQUEST_FORMAT,
        contentType: REQUEST_CONTENT_TYPE,
        maximumBytes: MAX_REQUEST_BYTES
      };
    }
    if (kind === "response") {
      return {
        kind,
        format: RESPONSE_FORMAT,
        contentType: RESPONSE_CONTENT_TYPE,
        maximumBytes: MAX_RESPONSE_BYTES
      };
    }
    throw cryptoError("Unsupported co-memory protocol kind.", "CO_MEMORY_PROTOCOL_INVALID");
  }

  function makeHeader(kind) {
    const protocol = protocolFor(kind);
    return {
      format: protocol.format,
      version: VERSION,
      contentType: protocol.contentType,
      kdf: {
        name: "PBKDF2",
        hash: "SHA-256",
        iterations: PBKDF2_ITERATIONS,
        saltBytes: SALT_BYTES
      },
      cipher: {
        name: "AES-GCM",
        keyBits: KEY_BITS,
        ivBytes: IV_BYTES,
        tagBits: TAG_BITS
      }
    };
  }

  function createLetterId() {
    return randomProtocolId("letter");
  }

  function createResponseId() {
    return randomProtocolId("response");
  }

  function randomProtocolId(prefix) {
    return `${prefix}_${toHex(randomBytes(requireCrypto(), 16))}`;
  }

  async function createRequestEnvelope(input, passphrase) {
    const payload = normalizeRequestPayload(input, false);
    const requestSha256 = await digestNormalizedRequest(payload);
    return encryptEnvelope("request", payload, passphrase, DEFAULT_SHELLS.request, requestSha256);
  }

  async function openRequestEnvelope(input, passphrase) {
    const envelope = validateEnvelope(input, "request");
    const payload = normalizeRequestPayload(await decryptPayload(envelope, passphrase, "request"), true);
    const requestSha256 = await digestNormalizedRequest(payload);
    if (requestSha256 !== envelope.binding.requestSha256) {
      throw cryptoError("The request digest does not match its authenticated binding.", "CO_MEMORY_REQUEST_BINDING_INVALID");
    }
    return {
      payload,
      requestSha256,
      shell: envelope.shell
    };
  }

  async function createResponseEnvelope(input, passphrase, requestReference) {
    const reference = await resolveRequestReference(requestReference);
    assertPlainObject(input, "response payload", "CO_MEMORY_RESPONSE_INVALID");
    const source = { ...input };
    if (!Object.hasOwn(source, "requestSha256")) source.requestSha256 = reference.requestSha256;
    if (source.requestSha256 !== reference.requestSha256) {
      throw cryptoError("The response is bound to a different request digest.", "CO_MEMORY_REQUEST_BINDING_INVALID");
    }
    const payload = normalizeResponsePayload(source, false);
    if (reference.letterId && payload.letterId !== reference.letterId) {
      throw cryptoError("The response letter ID does not match the request.", "CO_MEMORY_REQUEST_BINDING_INVALID");
    }
    return encryptEnvelope("response", payload, passphrase, DEFAULT_SHELLS.response, reference.requestSha256);
  }

  async function openResponseEnvelope(input, passphrase, requestReference) {
    const reference = await resolveRequestReference(requestReference);
    const envelope = validateEnvelope(input, "response");
    if (envelope.binding.requestSha256 !== reference.requestSha256) {
      throw cryptoError("The encrypted response belongs to a different request.", "CO_MEMORY_REQUEST_BINDING_INVALID");
    }
    const payload = normalizeResponsePayload(await decryptPayload(envelope, passphrase, "response"), true);
    if (payload.requestSha256 !== reference.requestSha256 || (reference.letterId && payload.letterId !== reference.letterId)) {
      throw cryptoError("The response payload does not match the expected request.", "CO_MEMORY_REQUEST_BINDING_INVALID");
    }
    return {
      payload,
      requestSha256: reference.requestSha256,
      shell: envelope.shell
    };
  }

  async function digestRequestPayload(input) {
    return digestNormalizedRequest(normalizeRequestPayload(input, false));
  }

  async function digestNormalizedRequest(payload) {
    const cryptoApi = requireCrypto();
    const bytes = encoder.encode(stableStringify(payload));
    const digest = await cryptoApi.subtle.digest("SHA-256", bytes);
    return toHex(new Uint8Array(digest));
  }

  async function resolveRequestReference(value) {
    if (!isPlainObject(value)) {
      throw cryptoError(
        "A complete request payload or a verified opened-request result is required.",
        "CO_MEMORY_REQUEST_BINDING_INVALID"
      );
    }
    if (typeof value.requestSha256 === "string") {
      if (!isPlainObject(value.payload) || value.payload.format !== REQUEST_FORMAT) {
        throw cryptoError(
          "A request digest is accepted only with the complete verified request payload.",
          "CO_MEMORY_REQUEST_BINDING_INVALID"
        );
      }
      const payload = normalizeRequestPayload(value.payload, true);
      const requestSha256 = requireSha256(value.requestSha256, "request digest");
      const measured = await digestNormalizedRequest(payload);
      if (measured !== requestSha256) {
        throw cryptoError("The supplied request result has an invalid digest.", "CO_MEMORY_REQUEST_BINDING_INVALID");
      }
      return {
        requestSha256,
        letterId: payload.letterId
      };
    }
    if (value.format === REQUEST_FORMAT) {
      const payload = normalizeRequestPayload(value, true);
      return {
        requestSha256: await digestNormalizedRequest(payload),
        letterId: payload.letterId
      };
    }
    throw cryptoError(
      "A complete request payload or a verified opened-request result is required.",
      "CO_MEMORY_REQUEST_BINDING_INVALID"
    );
  }

  async function encryptEnvelope(kind, payload, passphrase, shellValue, requestSha256) {
    const cryptoApi = requireCrypto();
    const password = requirePassphrase(passphrase);
    const protocol = protocolFor(kind);
    const shell = normalizeShell(shellValue, false);
    const header = makeHeader(kind);
    const binding = { kind, requestSha256: requireSha256(requestSha256, "request digest") };
    const plaintext = encoder.encode(stableStringify(payload));
    if (plaintext.byteLength > protocol.maximumBytes) {
      throw cryptoError("The co-memory payload exceeds its encrypted format limit.", "CO_MEMORY_PAYLOAD_LIMIT");
    }
    const salt = randomBytes(cryptoApi, SALT_BYTES);
    const iv = randomBytes(cryptoApi, IV_BYTES);
    const key = await deriveKey(cryptoApi, password, salt, ["encrypt"]);
    const ciphertext = await cryptoApi.subtle.encrypt({
      name: "AES-GCM",
      iv,
      additionalData: authenticatedBytes(header, shell, binding),
      tagLength: TAG_BITS
    }, key, plaintext);
    return {
      header,
      shell,
      binding,
      salt: toBase64Url(salt),
      iv: toBase64Url(iv),
      ciphertext: toBase64Url(new Uint8Array(ciphertext))
    };
  }

  async function decryptPayload(envelope, passphrase, kind) {
    const cryptoApi = requireCrypto();
    const password = requirePassphrase(passphrase);
    const protocol = protocolFor(kind);
    const salt = fromBase64Url(envelope.salt, SALT_BYTES, SALT_BYTES, "salt");
    const iv = fromBase64Url(envelope.iv, IV_BYTES, IV_BYTES, "iv");
    const ciphertext = fromBase64Url(
      envelope.ciphertext,
      null,
      protocol.maximumBytes + TAG_BYTES,
      "ciphertext"
    );
    try {
      const key = await deriveKey(cryptoApi, password, salt, ["decrypt"]);
      const decrypted = await cryptoApi.subtle.decrypt({
        name: "AES-GCM",
        iv,
        additionalData: authenticatedBytes(envelope.header, envelope.shell, envelope.binding),
        tagLength: TAG_BITS
      }, key, ciphertext);
      if (decrypted.byteLength > protocol.maximumBytes) {
        throw cryptoError("The decrypted payload exceeds its format limit.", "CO_MEMORY_PAYLOAD_LIMIT");
      }
      const text = decoder.decode(decrypted);
      return JSON.parse(text);
    } catch (error) {
      if (String(error?.code || "").startsWith("CO_MEMORY_")) throw error;
      throw cryptoError(
        "Unable to unlock this co-memory file. The passphrase or file may be incorrect.",
        "CO_MEMORY_DECRYPT_FAILED"
      );
    }
  }

  function validateRequestEnvelope(input) {
    return validateEnvelope(input, "request");
  }

  function validateResponseEnvelope(input) {
    return validateEnvelope(input, "response");
  }

  function validateEnvelope(input, kind) {
    assertPlainObject(input, "envelope", "CO_MEMORY_ENVELOPE_INVALID");
    assertExactKeys(input, ["header", "shell", "binding", "salt", "iv", "ciphertext"], "envelope", "CO_MEMORY_ENVELOPE_INVALID");
    const protocol = protocolFor(kind);
    const header = normalizeHeader(input.header, kind);
    const shell = normalizeShell(input.shell, true);
    const binding = normalizeBinding(input.binding, kind);
    const salt = requireBase64Url(input.salt, "salt", maxBase64UrlLength(SALT_BYTES));
    const iv = requireBase64Url(input.iv, "iv", maxBase64UrlLength(IV_BYTES));
    const ciphertext = requireBase64Url(
      input.ciphertext,
      "ciphertext",
      maxBase64UrlLength(protocol.maximumBytes + TAG_BYTES)
    );
    fromBase64Url(salt, SALT_BYTES, SALT_BYTES, "salt");
    fromBase64Url(iv, IV_BYTES, IV_BYTES, "iv");
    const ciphertextBytes = fromBase64Url(ciphertext, null, protocol.maximumBytes + TAG_BYTES, "ciphertext");
    if (ciphertextBytes.byteLength <= TAG_BYTES) {
      throw cryptoError("The encrypted payload is too short.", "CO_MEMORY_ENVELOPE_INVALID");
    }
    return { header, shell, binding, salt, iv, ciphertext };
  }

  function normalizeHeader(input, kind) {
    assertPlainObject(input, "header", "CO_MEMORY_ENVELOPE_INVALID");
    assertExactKeys(input, ["format", "version", "contentType", "kdf", "cipher"], "header", "CO_MEMORY_ENVELOPE_INVALID");
    assertPlainObject(input.kdf, "header.kdf", "CO_MEMORY_ENVELOPE_INVALID");
    assertExactKeys(input.kdf, ["name", "hash", "iterations", "saltBytes"], "header.kdf", "CO_MEMORY_ENVELOPE_INVALID");
    assertPlainObject(input.cipher, "header.cipher", "CO_MEMORY_ENVELOPE_INVALID");
    assertExactKeys(input.cipher, ["name", "keyBits", "ivBytes", "tagBits"], "header.cipher", "CO_MEMORY_ENVELOPE_INVALID");
    const expected = makeHeader(kind);
    if (stableStringify(input) !== stableStringify(expected)) {
      throw cryptoError("The cryptographic header is unsupported.", "CO_MEMORY_ENVELOPE_INVALID");
    }
    return expected;
  }

  function normalizeShell(input, validating) {
    assertPlainObject(input, "shell", "CO_MEMORY_SHELL_INVALID");
    assertExactKeys(input, ["title", "note"], "shell", "CO_MEMORY_SHELL_INVALID");
    return {
      title: normalizeText(input.title, "shell.title", 1, 120, validating, "CO_MEMORY_SHELL_INVALID"),
      note: normalizeText(input.note, "shell.note", 0, 240, validating, "CO_MEMORY_SHELL_INVALID")
    };
  }

  function normalizeBinding(input, kind) {
    assertPlainObject(input, "binding", "CO_MEMORY_ENVELOPE_INVALID");
    assertExactKeys(input, ["kind", "requestSha256"], "binding", "CO_MEMORY_ENVELOPE_INVALID");
    if (input.kind !== kind) {
      throw cryptoError("The envelope binding belongs to another protocol.", "CO_MEMORY_ENVELOPE_INVALID");
    }
    return {
      kind,
      requestSha256: requireSha256(input.requestSha256, "binding.requestSha256")
    };
  }

  function validateRequestPayload(input) {
    return normalizeRequestPayload(input, true);
  }

  function normalizeRequestPayload(input, validating) {
    assertPlainObject(input, "request payload", "CO_MEMORY_REQUEST_INVALID");
    assertExactKeys(
      input,
      ["format", "version", "letterId", "question", "context", "boundary"],
      "request payload",
      "CO_MEMORY_REQUEST_INVALID"
    );
    if (input.format !== REQUEST_FORMAT || input.version !== VERSION || input.boundary !== REQUEST_BOUNDARY) {
      throw cryptoError("The co-memory request contract is unsupported.", "CO_MEMORY_REQUEST_INVALID");
    }
    const payload = {
      format: REQUEST_FORMAT,
      version: VERSION,
      letterId: requireId(input.letterId, "letterId", "CO_MEMORY_REQUEST_INVALID"),
      question: normalizeText(input.question, "question", 1, 1000, validating, "CO_MEMORY_REQUEST_INVALID"),
      context: normalizeContext(input.context, validating),
      boundary: REQUEST_BOUNDARY
    };
    assertPayloadBytes(payload, MAX_REQUEST_BYTES, "CO_MEMORY_PAYLOAD_LIMIT");
    return payload;
  }

  function normalizeContext(input, validating) {
    assertPlainObject(input, "context", "CO_MEMORY_REQUEST_INVALID");
    assertExactKeys(input, ["title", "note", "evidence"], "context", "CO_MEMORY_REQUEST_INVALID");
    if (!Array.isArray(input.evidence) || input.evidence.length < 1 ||
        input.evidence.length > MAX_EVIDENCE_ITEMS || !isDenseArray(input.evidence)) {
      throw cryptoError("The request context must contain a bounded evidence selection.", "CO_MEMORY_REQUEST_INVALID");
    }
    const evidence = input.evidence.map((entry, index) => normalizeEvidence(entry, index, validating));
    return {
      title: normalizeText(input.title, "context.title", 0, 160, validating, "CO_MEMORY_REQUEST_INVALID"),
      note: normalizeText(input.note, "context.note", 0, 1200, validating, "CO_MEMORY_REQUEST_INVALID"),
      evidence
    };
  }

  function normalizeEvidence(input, index, validating) {
    const label = `context.evidence[${index}]`;
    assertPlainObject(input, label, "CO_MEMORY_REQUEST_INVALID");
    assertExactKeys(input, ["key", "kind", "text"], label, "CO_MEMORY_REQUEST_INVALID");
    if (input.key !== `evidence-${index + 1}` || !EVIDENCE_KINDS.has(input.kind)) {
      throw cryptoError("The request evidence order or kind is invalid.", "CO_MEMORY_REQUEST_INVALID");
    }
    return {
      key: input.key,
      kind: input.kind,
      text: normalizeText(input.text, `${label}.text`, 1, 4000, validating, "CO_MEMORY_REQUEST_INVALID")
    };
  }

  function validateResponsePayload(input) {
    return normalizeResponsePayload(input, true);
  }

  function normalizeResponsePayload(input, validating) {
    assertPlainObject(input, "response payload", "CO_MEMORY_RESPONSE_INVALID");
    assertExactKeys(
      input,
      ["format", "version", "letterId", "responseId", "requestSha256", "identity", "answer", "boundary"],
      "response payload",
      "CO_MEMORY_RESPONSE_INVALID"
    );
    if (input.format !== RESPONSE_FORMAT || input.version !== VERSION || input.boundary !== RESPONSE_BOUNDARY) {
      throw cryptoError("The co-memory response contract is unsupported.", "CO_MEMORY_RESPONSE_INVALID");
    }
    assertPlainObject(input.identity, "identity", "CO_MEMORY_RESPONSE_INVALID");
    assertExactKeys(input.identity, ["label", "assurance", "verified"], "identity", "CO_MEMORY_RESPONSE_INVALID");
    if (input.identity.assurance !== IDENTITY_ASSURANCE || input.identity.verified !== false) {
      throw cryptoError("Co-memory responses cannot claim a verified identity.", "CO_MEMORY_RESPONSE_INVALID");
    }
    const payload = {
      format: RESPONSE_FORMAT,
      version: VERSION,
      letterId: requireId(input.letterId, "letterId", "CO_MEMORY_RESPONSE_INVALID"),
      responseId: requireId(input.responseId, "responseId", "CO_MEMORY_RESPONSE_INVALID"),
      requestSha256: requireSha256(input.requestSha256, "requestSha256"),
      identity: {
        label: normalizeText(input.identity.label, "identity.label", 0, 120, validating, "CO_MEMORY_RESPONSE_INVALID"),
        assurance: IDENTITY_ASSURANCE,
        verified: false
      },
      answer: normalizeText(input.answer, "answer", 1, 8000, validating, "CO_MEMORY_RESPONSE_INVALID"),
      boundary: RESPONSE_BOUNDARY
    };
    assertPayloadBytes(payload, MAX_RESPONSE_BYTES, "CO_MEMORY_PAYLOAD_LIMIT");
    return payload;
  }

  function assertPayloadBytes(value, maximum, code) {
    if (encoder.encode(stableStringify(value)).byteLength > maximum) {
      throw cryptoError("The co-memory payload exceeds its format limit.", code);
    }
  }

  function authenticatedBytes(header, shell, binding) {
    return encoder.encode(stableStringify({ header, shell, binding }));
  }

  async function deriveKey(cryptoApi, passphrase, salt, usages) {
    const material = await cryptoApi.subtle.importKey(
      "raw",
      encoder.encode(passphrase),
      { name: "PBKDF2" },
      false,
      ["deriveKey"]
    );
    return cryptoApi.subtle.deriveKey({
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256"
    }, material, { name: "AES-GCM", length: KEY_BITS }, false, usages);
  }

  function requirePassphrase(value) {
    if (typeof value !== "string") {
      throw cryptoError("A passphrase is required.", "CO_MEMORY_PASSPHRASE_INVALID");
    }
    if (value.length > MAX_PASSPHRASE_LENGTH * 2) {
      throw cryptoError(
        `The passphrase must contain ${MIN_PASSPHRASE_LENGTH} to ${MAX_PASSPHRASE_LENGTH} characters without controls.`,
        "CO_MEMORY_PASSPHRASE_INVALID"
      );
    }
    const length = [...value].length;
    if (length < MIN_PASSPHRASE_LENGTH || length > MAX_PASSPHRASE_LENGTH || PASSPHRASE_CONTROL_PATTERN.test(value)) {
      throw cryptoError(
        `The passphrase must contain ${MIN_PASSPHRASE_LENGTH} to ${MAX_PASSPHRASE_LENGTH} characters without controls.`,
        "CO_MEMORY_PASSPHRASE_INVALID"
      );
    }
    return value;
  }

  function requireCrypto() {
    if (!webCrypto?.subtle || typeof webCrypto.getRandomValues !== "function") {
      throw cryptoError("Web Crypto is unavailable.", "CO_MEMORY_CRYPTO_UNAVAILABLE");
    }
    return webCrypto;
  }

  function randomBytes(cryptoApi, length) {
    const bytes = new Uint8Array(length);
    cryptoApi.getRandomValues(bytes);
    return bytes;
  }

  function normalizeText(value, label, minimum, maximum, validating, code) {
    if (typeof value !== "string") throw cryptoError(`${label} must be text.`, code);
    if (value.length > maximum * 2) {
      throw cryptoError(`${label} has an invalid length, characters or canonical form.`, code);
    }
    const normalized = value.replace(/\r\n?/gu, "\n").trim();
    const length = [...normalized].length;
    if ((validating && normalized !== value) || length < minimum || length > maximum || CONTROL_PATTERN.test(normalized)) {
      throw cryptoError(`${label} has an invalid length, characters or canonical form.`, code);
    }
    return normalized;
  }

  function requireId(value, label, code) {
    if (typeof value !== "string" || !ID_PATTERN.test(value)) {
      throw cryptoError(`${label} is invalid.`, code);
    }
    return value;
  }

  function requireSha256(value, label) {
    if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
      throw cryptoError(`${label} must be a lowercase SHA-256 digest.`, "CO_MEMORY_REQUEST_BINDING_INVALID");
    }
    return value;
  }

  function requireBase64Url(
    value,
    label,
    maximumCharacters = Number.MAX_SAFE_INTEGER,
    code = "CO_MEMORY_ENVELOPE_INVALID"
  ) {
    if (typeof value !== "string" || value.length > maximumCharacters || !BASE64URL_PATTERN.test(value) || value.length % 4 === 1) {
      throw cryptoError(`${label} is not canonical base64url.`, code);
    }
    return value;
  }

  function toBase64Url(value) {
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    const encoded = typeof btoa === "function"
      ? btoa(binary)
      : Buffer.from(bytes).toString("base64");
    return encoded.replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
  }

  function fromBase64Url(value, expectedLength, maximumBytes, label, code = "CO_MEMORY_ENVELOPE_INVALID") {
    try {
      requireBase64Url(value, label, maxBase64UrlLength(maximumBytes), code);
      const base64 = value.replace(/-/gu, "+").replace(/_/gu, "/") + "=".repeat((4 - value.length % 4) % 4);
      let bytes;
      if (typeof atob === "function") {
        const binary = atob(base64);
        bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      } else {
        bytes = new Uint8Array(Buffer.from(base64, "base64"));
      }
      if (bytes.byteLength > maximumBytes || (expectedLength !== null && bytes.byteLength !== expectedLength) || toBase64Url(bytes) !== value) {
        throw new Error("invalid base64url length or canonical form");
      }
      return bytes;
    } catch (error) {
      if (String(error?.code || "").startsWith("CO_MEMORY_")) throw error;
      throw cryptoError(`${label} is not valid canonical base64url.`, code);
    }
  }

  function maxBase64UrlLength(bytes) {
    return Math.ceil(Math.max(0, Number(bytes) || 0) * 4 / 3) + 2;
  }

  function stableStringify(value) {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
    if (isPlainObject(value)) {
      return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
    }
    return JSON.stringify(value);
  }

  function assertPlainObject(value, label, code) {
    if (!isPlainObject(value)) throw cryptoError(`${label} must be a plain object.`, code);
  }

  function isPlainObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function isDenseArray(value) {
    if (!Array.isArray(value)) return false;
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) return false;
    }
    return true;
  }

  function assertExactKeys(value, expected, label, code) {
    const actual = Object.keys(value).sort();
    const wanted = [...expected].sort();
    if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
      throw cryptoError(`${label} contains unsupported or missing fields.`, code);
    }
  }

  function toHex(bytes) {
    return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function cryptoError(message, code) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  return Object.freeze({
    VERSION,
    REQUEST_FORMAT,
    RESPONSE_FORMAT,
    REQUEST_CONTENT_TYPE,
    RESPONSE_CONTENT_TYPE,
    REQUEST_BOUNDARY,
    RESPONSE_BOUNDARY,
    IDENTITY_ASSURANCE,
    DEFAULT_SHELLS,
    PBKDF2_ITERATIONS,
    MIN_PASSPHRASE_LENGTH,
    MAX_PASSPHRASE_LENGTH,
    MAX_REQUEST_BYTES,
    MAX_RESPONSE_BYTES,
    MAX_REQUEST_FILE_BYTES,
    MAX_RESPONSE_FILE_BYTES,
    MAX_EVIDENCE_ITEMS,
    createLetterId,
    createResponseId,
    createRequestEnvelope,
    openRequestEnvelope,
    createResponseEnvelope,
    openResponseEnvelope,
    digestRequestPayload,
    validateRequestEnvelope,
    validateResponseEnvelope,
    validateRequestPayload,
    validateResponsePayload
  });
}));
