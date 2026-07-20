"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { TextDecoder, TextEncoder } = require("node:util");
const { webcrypto } = require("node:crypto");
const crypto = require("../public/assets/co-memory-crypto.js");

let assertions = 0;

function check(value, message) {
  assertions += 1;
  if (!value) throw new Error(message);
}

function equal(actual, expected, message) {
  assertions += 1;
  if (actual !== expected) {
    throw new Error(`${message}\nexpected: ${JSON.stringify(expected)}\nactual:   ${JSON.stringify(actual)}`);
  }
}

function deepEqual(actual, expected, message) {
  assertions += 1;
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`${message}\nexpected: ${right}\nactual:   ${left}`);
}

async function rejects(operation, code, message) {
  assertions += 1;
  try {
    await operation();
  } catch (error) {
    if (!code || error?.code === code) return error;
    throw new Error(`${message}: expected ${code}, received ${error?.code || error?.name || error}`);
  }
  throw new Error(`${message}: expected rejection`);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function requestPayload() {
  return {
    format: crypto.REQUEST_FORMAT,
    version: crypto.VERSION,
    letterId: "letter_1234567890abcdef",
    question: "你还记得那天我们为什么在旧礼堂停留吗？",
    context: {
      title: "旧礼堂旁的合照",
      note: "这里只放入我明确选择的两条来源。",
      evidence: [
        { key: "evidence-1", kind: "quote", text: "散场以后，我们在礼堂门口又站了很久。" },
        { key: "evidence-2", kind: "transcript", text: "我只记得那天下过雨，具体日期仍不确定。" }
      ]
    },
    boundary: crypto.REQUEST_BOUNDARY
  };
}

function responsePayload(requestSha256) {
  return {
    format: crypto.RESPONSE_FORMAT,
    version: crypto.VERSION,
    letterId: "letter_1234567890abcdef",
    responseId: "response_abcdef1234567890",
    ...(requestSha256 ? { requestSha256 } : {}),
    identity: {
      label: "一位回信人（自述）",
      assurance: crypto.IDENTITY_ASSURANCE,
      verified: false
    },
    answer: "我记得停下来是为了等雨小一点；这是我的回忆，不保证日期准确。",
    boundary: crypto.RESPONSE_BOUNDARY
  };
}

function reverseObjectKeys(value) {
  if (Array.isArray(value)) return value.map(reverseObjectKeys);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reverseObjectKeys(item)]));
}

function flipBase64Url(value) {
  return `${value[0] === "A" ? "B" : "A"}${value.slice(1)}`;
}

function createBrowserModule() {
  const source = fs.readFileSync(path.join(__dirname, "..", "public", "assets", "co-memory-crypto.js"), "utf8");
  const context = vm.createContext({
    crypto: webcrypto,
    TextDecoder,
    TextEncoder,
    btoa: (value) => Buffer.from(value, "binary").toString("base64"),
    atob: (value) => Buffer.from(value, "base64").toString("binary")
  });
  vm.runInContext(source, context, { filename: "co-memory-crypto.js" });
  return context;
}

async function main() {
  const passphrase = "time-isle-letter-passphrase-2026";
  const request = requestPayload();

  equal(crypto.PBKDF2_ITERATIONS, 310000, "PBKDF2 iteration budget is fixed");
  equal(crypto.REQUEST_CONTENT_TYPE, "application/vnd.time-isle.co-memory-request+json", "request content type is domain-specific");
  equal(crypto.RESPONSE_CONTENT_TYPE, "application/vnd.time-isle.co-memory-response+json", "response content type is domain-specific");
  check(crypto.REQUEST_FORMAT !== crypto.RESPONSE_FORMAT, "request and response formats are distinct");
  check(crypto.REQUEST_CONTENT_TYPE !== crypto.RESPONSE_CONTENT_TYPE, "request and response content types are distinct");
  equal(crypto.IDENTITY_ASSURANCE, "self-asserted-unverified", "identity assurance cannot imply verification");
  check(crypto.MAX_REQUEST_FILE_BYTES > crypto.MAX_REQUEST_BYTES, "request file cap includes base64url envelope overhead");
  check(crypto.MAX_RESPONSE_FILE_BYTES > crypto.MAX_RESPONSE_BYTES, "response file cap includes base64url envelope overhead");
  const randomLetterId = crypto.createLetterId();
  const secondRandomLetterId = crypto.createLetterId();
  check(/^letter_[a-f0-9]{32}$/.test(randomLetterId), "letter ID helper uses a 128-bit lowercase CSPRNG value");
  check(randomLetterId !== secondRandomLetterId, "letter ID helper does not repeat adjacent random values");
  check(/^response_[a-f0-9]{32}$/.test(crypto.createResponseId()), "response ID helper uses a 128-bit lowercase CSPRNG value");
  equal(crypto.validateRequestPayload(request).boundary, crypto.REQUEST_BOUNDARY, "request boundary is fixed");
  equal(crypto.validateRequestPayload(request).context.evidence.length, 2, "selected text evidence is accepted");

  const digest = await crypto.digestRequestPayload(request);
  check(/^[a-f0-9]{64}$/.test(digest), "request digest is lowercase SHA-256");
  equal(await crypto.digestRequestPayload(reverseObjectKeys(request)), digest, "request digest is independent of object key insertion order");
  const changedRequest = clone(request);
  changedRequest.question = "这是另一个问题。";
  check(await crypto.digestRequestPayload(changedRequest) !== digest, "request digest changes with the canonical question");

  const requestEnvelope = await crypto.createRequestEnvelope(request, passphrase);
  equal(requestEnvelope.header.format, crypto.REQUEST_FORMAT, "request header carries the request format");
  equal(requestEnvelope.header.contentType, crypto.REQUEST_CONTENT_TYPE, "request header carries the request content type");
  equal(requestEnvelope.header.kdf.name, "PBKDF2", "request header declares PBKDF2");
  equal(requestEnvelope.header.kdf.hash, "SHA-256", "request header declares SHA-256");
  equal(requestEnvelope.header.kdf.iterations, 310000, "request header authenticates the iteration count");
  equal(requestEnvelope.header.cipher.name, "AES-GCM", "request header declares AES-GCM");
  equal(requestEnvelope.header.cipher.keyBits, 256, "request header declares AES-256");
  equal(requestEnvelope.header.cipher.ivBytes, 12, "request header declares a 96-bit IV");
  equal(requestEnvelope.header.cipher.tagBits, 128, "request header declares a 128-bit tag");
  equal(requestEnvelope.binding.kind, "request", "request AAD binding is domain-separated");
  equal(requestEnvelope.binding.requestSha256, digest, "request envelope authenticates the canonical request digest");
  check(!requestEnvelope.salt.includes("="), "salt uses unpadded base64url");
  check(!requestEnvelope.iv.includes("="), "IV uses unpadded base64url");
  check(!requestEnvelope.ciphertext.includes("="), "ciphertext uses unpadded base64url");
  const serializedEnvelope = JSON.stringify(requestEnvelope);
  check(Buffer.byteLength(serializedEnvelope, "utf8") <= crypto.MAX_REQUEST_FILE_BYTES, "generated request fits the exported pre-parse file cap");
  check(!serializedEnvelope.includes(passphrase), "the passphrase is absent from the envelope");
  check(!serializedEnvelope.includes(request.question), "request plaintext is absent from the envelope");
  deepEqual(crypto.validateRequestEnvelope(requestEnvelope), requestEnvelope, "request envelope validates without rewriting fields");
  const ignoredPrivateShell = await crypto.createRequestEnvelope(request, passphrase, {
    title: "不应公开的事件标题",
    note: "不应公开的问题"
  });
  deepEqual(ignoredPrivateShell.shell, crypto.DEFAULT_SHELLS.request, "V1 request shell stays generic even if a caller supplies extra metadata");

  const openedRequest = await crypto.openRequestEnvelope(requestEnvelope, passphrase);
  deepEqual(openedRequest.payload, request, "request decrypts to the normalized payload");
  equal(openedRequest.requestSha256, digest, "opened request returns its verified digest");
  deepEqual(openedRequest.shell, crypto.DEFAULT_SHELLS.request, "request uses the generic public shell");

  const browser = createBrowserModule();
  check(Boolean(browser.TimeIsleCoMemoryCrypto), "browser UMD branch exposes TimeIsleCoMemoryCrypto");
  equal(browser.TimeIsleCoMemoryCrypto.REQUEST_FORMAT, crypto.REQUEST_FORMAT, "browser and Node builds share the request protocol");
  browser.envelopeJson = JSON.stringify(requestEnvelope);
  browser.passphrase = passphrase;
  const browserOpened = await vm.runInContext(
    "TimeIsleCoMemoryCrypto.openRequestEnvelope(JSON.parse(envelopeJson), passphrase)",
    browser
  );
  deepEqual(JSON.parse(JSON.stringify(browserOpened.payload)), request, "browser build opens a Node-created request envelope");
  browser.requestJson = JSON.stringify(request);
  const browserEnvelope = await vm.runInContext(
    "TimeIsleCoMemoryCrypto.createRequestEnvelope(JSON.parse(requestJson), passphrase)",
    browser
  );
  const nodeOpenedBrowserEnvelope = await crypto.openRequestEnvelope(JSON.parse(JSON.stringify(browserEnvelope)), passphrase);
  deepEqual(nodeOpenedBrowserEnvelope.payload, request, "Node build opens a browser-created request envelope");

  const secondEnvelope = await crypto.createRequestEnvelope(request, passphrase);
  check(secondEnvelope.salt !== requestEnvelope.salt, "each request receives a fresh random salt");
  check(secondEnvelope.iv !== requestEnvelope.iv, "each request receives a fresh random IV");
  check(secondEnvelope.ciphertext !== requestEnvelope.ciphertext, "randomized requests do not repeat ciphertext");

  const response = responsePayload();
  const responseEnvelope = await crypto.createResponseEnvelope(response, passphrase, openedRequest);
  equal(responseEnvelope.header.format, crypto.RESPONSE_FORMAT, "response header carries an independent format");
  equal(responseEnvelope.header.contentType, crypto.RESPONSE_CONTENT_TYPE, "response header carries an independent content type");
  equal(responseEnvelope.binding.kind, "response", "response AAD binding is domain-separated");
  equal(responseEnvelope.binding.requestSha256, digest, "response envelope binds to the exact request digest");
  check(!JSON.stringify(responseEnvelope).includes(response.answer), "response plaintext is absent from the envelope");
  check(Buffer.byteLength(JSON.stringify(responseEnvelope), "utf8") <= crypto.MAX_RESPONSE_FILE_BYTES, "generated response fits the exported pre-parse file cap");
  deepEqual(crypto.validateResponseEnvelope(responseEnvelope), responseEnvelope, "response envelope validates without rewriting fields");

  const openedResponse = await crypto.openResponseEnvelope(responseEnvelope, passphrase, openedRequest);
  equal(openedResponse.payload.requestSha256, digest, "response payload repeats the authenticated request digest");
  equal(openedResponse.payload.letterId, request.letterId, "response stays bound to the request letter ID");
  equal(openedResponse.payload.identity.assurance, crypto.IDENTITY_ASSURANCE, "opened response keeps unverified identity assurance");
  equal(openedResponse.payload.identity.verified, false, "opened response can never claim verified identity");
  equal(openedResponse.payload.answer, response.answer, "response answer round-trips exactly");
  const openedByRequestPayload = await crypto.openResponseEnvelope(responseEnvelope, passphrase, request);
  equal(openedByRequestPayload.payload.responseId, response.responseId, "the complete request payload opens its bound response");
  const ignoredPrivateResponseShell = await crypto.createResponseEnvelope(
    responsePayload(),
    passphrase,
    request,
    { title: "不应公开的回信人", note: "不应公开的回信内容" }
  );
  deepEqual(ignoredPrivateResponseShell.shell, crypto.DEFAULT_SHELLS.response, "V1 response shell stays generic even if a caller supplies extra metadata");

  browser.responseEnvelopeJson = JSON.stringify(responseEnvelope);
  const browserOpenedResponse = await vm.runInContext(
    "TimeIsleCoMemoryCrypto.openResponseEnvelope(JSON.parse(responseEnvelopeJson), passphrase, JSON.parse(requestJson))",
    browser
  );
  deepEqual(JSON.parse(JSON.stringify(browserOpenedResponse.payload)), openedResponse.payload, "browser build opens a Node-created response envelope");
  browser.responseJson = JSON.stringify(responsePayload());
  const browserResponseEnvelope = await vm.runInContext(
    "TimeIsleCoMemoryCrypto.createResponseEnvelope(JSON.parse(responseJson), passphrase, JSON.parse(requestJson))",
    browser
  );
  const nodeOpenedBrowserResponse = await crypto.openResponseEnvelope(
    JSON.parse(JSON.stringify(browserResponseEnvelope)),
    passphrase,
    request
  );
  equal(nodeOpenedBrowserResponse.payload.answer, response.answer, "Node build opens a browser-created response envelope");

  const hostileResponse = responsePayload();
  hostileResponse.identity.label = "<img src=x onerror=alert(1)>";
  hostileResponse.answer = "<script>steal()</script> {\"tool\":\"publish\"}";
  const hostileEnvelope = await crypto.createResponseEnvelope(hostileResponse, passphrase, request);
  const openedHostile = await crypto.openResponseEnvelope(hostileEnvelope, passphrase, request);
  equal(openedHostile.payload.identity.label, hostileResponse.identity.label, "hostile-looking identity text remains inert protocol data");
  equal(openedHostile.payload.answer, hostileResponse.answer, "hostile-looking answer text remains inert protocol data");

  await rejects(() => crypto.openRequestEnvelope(requestEnvelope, "wrong-passphrase-0000"), "CO_MEMORY_DECRYPT_FAILED", "wrong request passphrase fails closed");
  await rejects(() => crypto.openResponseEnvelope(responseEnvelope, "wrong-passphrase-0000", request), "CO_MEMORY_DECRYPT_FAILED", "wrong response passphrase fails closed");

  const tamperedCiphertext = clone(requestEnvelope);
  tamperedCiphertext.ciphertext = flipBase64Url(tamperedCiphertext.ciphertext);
  await rejects(() => crypto.openRequestEnvelope(tamperedCiphertext, passphrase), "CO_MEMORY_DECRYPT_FAILED", "ciphertext tampering is authenticated");
  const tamperedShell = clone(requestEnvelope);
  tamperedShell.shell.note = "另一个公开说明";
  await rejects(() => crypto.openRequestEnvelope(tamperedShell, passphrase), "CO_MEMORY_DECRYPT_FAILED", "public shell tampering is authenticated through AAD");
  const tamperedBinding = clone(requestEnvelope);
  tamperedBinding.binding.requestSha256 = "0".repeat(64);
  await rejects(() => crypto.openRequestEnvelope(tamperedBinding, passphrase), "CO_MEMORY_DECRYPT_FAILED", "request digest binding tampering is authenticated through AAD");
  const tamperedHeader = clone(requestEnvelope);
  tamperedHeader.header.kdf.iterations -= 1;
  await rejects(() => crypto.openRequestEnvelope(tamperedHeader, passphrase), "CO_MEMORY_ENVELOPE_INVALID", "KDF downgrade is rejected before decryption");
  const tamperedSalt = clone(requestEnvelope);
  tamperedSalt.salt = flipBase64Url(tamperedSalt.salt);
  await rejects(() => crypto.openRequestEnvelope(tamperedSalt, passphrase), "CO_MEMORY_DECRYPT_FAILED", "salt tampering cannot derive a usable request key");
  const tamperedIv = clone(requestEnvelope);
  tamperedIv.iv = flipBase64Url(tamperedIv.iv);
  await rejects(() => crypto.openRequestEnvelope(tamperedIv, passphrase), "CO_MEMORY_DECRYPT_FAILED", "IV tampering is detected by AES-GCM");

  await rejects(() => crypto.openRequestEnvelope(responseEnvelope, passphrase), "CO_MEMORY_ENVELOPE_INVALID", "response envelopes cannot be opened as requests");
  await rejects(() => crypto.openResponseEnvelope(requestEnvelope, passphrase, request), "CO_MEMORY_ENVELOPE_INVALID", "request envelopes cannot be opened as responses");
  const wrongKind = clone(requestEnvelope);
  wrongKind.binding.kind = "response";
  await rejects(() => Promise.resolve(crypto.validateRequestEnvelope(wrongKind)), "CO_MEMORY_ENVELOPE_INVALID", "binding kind cannot cross protocol domains");

  const paddedSalt = clone(requestEnvelope);
  paddedSalt.salt += "=";
  await rejects(() => Promise.resolve(crypto.validateRequestEnvelope(paddedSalt)), "CO_MEMORY_ENVELOPE_INVALID", "padded base64 is not accepted as base64url");
  const invalidIv = clone(requestEnvelope);
  invalidIv.iv = "A";
  await rejects(() => Promise.resolve(crypto.validateRequestEnvelope(invalidIv)), "CO_MEMORY_ENVELOPE_INVALID", "invalid base64url lengths are rejected");
  const shortCiphertext = clone(requestEnvelope);
  shortCiphertext.ciphertext = "AA";
  await rejects(() => Promise.resolve(crypto.validateRequestEnvelope(shortCiphertext)), "CO_MEMORY_ENVELOPE_INVALID", "ciphertext shorter than the authentication tag is rejected");
  const oversizedCiphertext = clone(requestEnvelope);
  oversizedCiphertext.ciphertext = "A".repeat(Math.ceil((crypto.MAX_REQUEST_BYTES + 64) * 4 / 3));
  await rejects(() => Promise.resolve(crypto.validateRequestEnvelope(oversizedCiphertext)), "CO_MEMORY_ENVELOPE_INVALID", "oversized ciphertext is rejected before base64 decoding");
  const extraEnvelopeField = clone(requestEnvelope);
  extraEnvelopeField.debug = true;
  await rejects(() => Promise.resolve(crypto.validateRequestEnvelope(extraEnvelopeField)), "CO_MEMORY_ENVELOPE_INVALID", "unknown envelope fields are rejected");
  const extraHeaderField = clone(requestEnvelope);
  extraHeaderField.header.kdf.debug = true;
  await rejects(() => Promise.resolve(crypto.validateRequestEnvelope(extraHeaderField)), "CO_MEMORY_ENVELOPE_INVALID", "unknown cryptographic header fields are rejected");
  const nonCanonicalShell = clone(requestEnvelope);
  nonCanonicalShell.shell.title = ` ${nonCanonicalShell.shell.title}`;
  await rejects(() => Promise.resolve(crypto.validateRequestEnvelope(nonCanonicalShell)), "CO_MEMORY_SHELL_INVALID", "non-canonical public shell text is rejected");

  await rejects(() => crypto.createRequestEnvelope(request, "too-short", undefined), "CO_MEMORY_PASSPHRASE_INVALID", "short passphrases are rejected");
  await rejects(() => crypto.createRequestEnvelope(request, "valid-length\u0000bad", undefined), "CO_MEMORY_PASSPHRASE_INVALID", "passphrase controls are rejected");
  await rejects(() => crypto.createRequestEnvelope(request, "valid-length\npassphrase", undefined), "CO_MEMORY_PASSPHRASE_INVALID", "passphrase line feeds are rejected");
  await rejects(() => crypto.createRequestEnvelope(request, "valid-length\rpassphrase", undefined), "CO_MEMORY_PASSPHRASE_INVALID", "passphrase carriage returns are rejected");
  await rejects(() => crypto.openResponseEnvelope(responseEnvelope, passphrase, null), "CO_MEMORY_REQUEST_BINDING_INVALID", "response opening always requires an expected request binding");
  await rejects(() => crypto.openResponseEnvelope(responseEnvelope, passphrase, digest), "CO_MEMORY_REQUEST_BINDING_INVALID", "digest-only response opening cannot skip the letter ID check");
  await rejects(() => crypto.createResponseEnvelope(responsePayload(), passphrase, digest), "CO_MEMORY_REQUEST_BINDING_INVALID", "digest-only response creation cannot skip the letter ID check");
  await rejects(() => crypto.openResponseEnvelope(responseEnvelope, passphrase, {
    requestSha256: digest,
    letterId: request.letterId
  }), "CO_MEMORY_REQUEST_BINDING_INVALID", "an unverified digest and letter ID pair cannot impersonate a request payload");

  const mismatchedResponse = responsePayload("f".repeat(64));
  await rejects(() => crypto.createResponseEnvelope(mismatchedResponse, passphrase, request), "CO_MEMORY_REQUEST_BINDING_INVALID", "response creation rejects a supplied digest mismatch");
  const mismatchedLetter = responsePayload();
  mismatchedLetter.letterId = "letter_fedcba0987654321";
  await rejects(() => crypto.createResponseEnvelope(mismatchedLetter, passphrase, request), "CO_MEMORY_REQUEST_BINDING_INVALID", "response creation rejects a letter ID mismatch");
  const tamperedOpenedRequest = clone(openedRequest);
  tamperedOpenedRequest.requestSha256 = "e".repeat(64);
  await rejects(() => crypto.createResponseEnvelope(responsePayload(), passphrase, tamperedOpenedRequest), "CO_MEMORY_REQUEST_BINDING_INVALID", "opened request result digest is independently remeasured");

  const badIdentity = responsePayload(digest);
  badIdentity.identity.verified = true;
  await rejects(() => Promise.resolve(crypto.validateResponsePayload(badIdentity)), "CO_MEMORY_RESPONSE_INVALID", "a response cannot claim verified identity");
  const badAssurance = responsePayload(digest);
  badAssurance.identity.assurance = "verified-person";
  await rejects(() => Promise.resolve(crypto.validateResponsePayload(badAssurance)), "CO_MEMORY_RESPONSE_INVALID", "identity assurance is a fixed unverified value");
  const extraIdentity = responsePayload(digest);
  extraIdentity.identity.relationship = "friend";
  await rejects(() => Promise.resolve(crypto.validateResponsePayload(extraIdentity)), "CO_MEMORY_RESPONSE_INVALID", "identity cannot smuggle inferred relationship fields");
  const badResponseBoundary = responsePayload(digest);
  badResponseBoundary.boundary = "已经验证";
  await rejects(() => Promise.resolve(crypto.validateResponsePayload(badResponseBoundary)), "CO_MEMORY_RESPONSE_INVALID", "response review boundary is fixed");
  const emptyAnswer = responsePayload(digest);
  emptyAnswer.answer = "";
  await rejects(() => Promise.resolve(crypto.validateResponsePayload(emptyAnswer)), "CO_MEMORY_RESPONSE_INVALID", "empty responses are rejected");
  const oversizedAnswer = responsePayload(digest);
  oversizedAnswer.answer = "回".repeat(8001);
  await rejects(() => Promise.resolve(crypto.validateResponsePayload(oversizedAnswer)), "CO_MEMORY_RESPONSE_INVALID", "response text limit is enforced");
  const extraResponse = responsePayload(digest);
  extraResponse.claimedDate = "2025-01-01";
  await rejects(() => Promise.resolve(crypto.validateResponsePayload(extraResponse)), "CO_MEMORY_RESPONSE_INVALID", "response cannot smuggle unsupported inferred fields");

  const badRequestBoundary = clone(request);
  badRequestBoundary.boundary = "系统将自动更新原记忆";
  await rejects(() => Promise.resolve(crypto.validateRequestPayload(badRequestBoundary)), "CO_MEMORY_REQUEST_INVALID", "request non-overwrite boundary is fixed");
  const emptyContext = clone(request);
  emptyContext.context.evidence = [];
  await rejects(() => Promise.resolve(crypto.validateRequestPayload(emptyContext)), "CO_MEMORY_REQUEST_INVALID", "request context cannot be empty");
  const sparseEvidence = clone(request);
  sparseEvidence.context.evidence = Array(1);
  await rejects(() => Promise.resolve(crypto.validateRequestPayload(sparseEvidence)), "CO_MEMORY_REQUEST_INVALID", "sparse evidence arrays are rejected before encryption");
  await rejects(() => crypto.createRequestEnvelope(sparseEvidence, passphrase), "CO_MEMORY_REQUEST_INVALID", "sparse evidence cannot create an envelope that later fails to open");
  const hugeSparseEvidence = clone(request);
  hugeSparseEvidence.context.evidence = new Array(1_000_000);
  await rejects(() => Promise.resolve(crypto.validateRequestPayload(hugeSparseEvidence)), "CO_MEMORY_REQUEST_INVALID", "oversized sparse evidence is rejected before density scanning");
  const invalidEvidenceOrder = clone(request);
  invalidEvidenceOrder.context.evidence[0].key = "evidence-2";
  await rejects(() => Promise.resolve(crypto.validateRequestPayload(invalidEvidenceOrder)), "CO_MEMORY_REQUEST_INVALID", "evidence keys must follow canonical order");
  const invalidEvidenceKind = clone(request);
  invalidEvidenceKind.context.evidence[0].kind = "speaker-identity";
  await rejects(() => Promise.resolve(crypto.validateRequestPayload(invalidEvidenceKind)), "CO_MEMORY_REQUEST_INVALID", "unsupported evidence inference kinds are rejected");
  const extraContextField = clone(request);
  extraContextField.context.people = ["自动识别的人物"];
  await rejects(() => Promise.resolve(crypto.validateRequestPayload(extraContextField)), "CO_MEMORY_REQUEST_INVALID", "context cannot smuggle inferred people fields");
  const invalidId = clone(request);
  invalidId.letterId = "short";
  await rejects(() => Promise.resolve(crypto.validateRequestPayload(invalidId)), "CO_MEMORY_REQUEST_INVALID", "short or malformed letter IDs are rejected");
  const controlQuestion = clone(request);
  controlQuestion.question = "问题\u0000注入";
  await rejects(() => Promise.resolve(crypto.validateRequestPayload(controlQuestion)), "CO_MEMORY_REQUEST_INVALID", "request text controls are rejected");
  const oversizedQuestion = clone(request);
  oversizedQuestion.question = "问".repeat(1001);
  await rejects(() => Promise.resolve(crypto.validateRequestPayload(oversizedQuestion)), "CO_MEMORY_REQUEST_INVALID", "request question limit is enforced");
  const tooManyEvidence = clone(request);
  tooManyEvidence.context.evidence = Array.from({ length: crypto.MAX_EVIDENCE_ITEMS + 1 }, (_, index) => ({
    key: `evidence-${index + 1}`,
    kind: "note",
    text: `来源 ${index + 1}`
  }));
  await rejects(() => Promise.resolve(crypto.validateRequestPayload(tooManyEvidence)), "CO_MEMORY_REQUEST_INVALID", "evidence count limit is enforced");
  const cyclicResponse = responsePayload();
  cyclicResponse.answer = cyclicResponse;
  await rejects(() => crypto.createResponseEnvelope(cyclicResponse, passphrase, request), "CO_MEMORY_RESPONSE_INVALID", "cyclic response values are rejected before encryption");

  console.log(`Co-memory crypto checks passed (${assertions} assertions).`);
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
