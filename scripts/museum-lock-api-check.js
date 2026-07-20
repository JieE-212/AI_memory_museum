"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const {
  LOCK_CONFIRMATION,
  RECOVERY_VERIFIER_FORMAT,
  UNLOCK_CONFIRMATION,
  applyMuseumLockTransition,
  createInitialMuseumLockState
} = require("../lib/museum-lock-service");
const {
  createRecoveryVerifier,
  deriveRecoveryVerifier,
  verifyRecoveryPassphrase
} = require("../lib/museum-lock-verifier");
const {
  MAX_MUSEUM_LOCK_BODY_BYTES,
  createMuseumLockApi,
  museumLockEtag
} = require("../lib/museum-lock-api");

let assertions = 0;

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  await checkVerifierDerivation();
  await checkApiLifecycle();
  await checkPreBodySafety();
  console.log(`museum-lock-api-check: ${assertions} assertions passed`);
}

async function checkVerifierDerivation() {
  const suppliedSalt = Buffer.alloc(16, 4);
  const verifier = await createRecoveryVerifier("correct horse battery staple", {
    randomBytes: (length) => {
      equal(length, 16, "verifier requests a bounded 16-byte salt");
      return suppliedSalt;
    }
  });
  equal(verifier.format, RECOVERY_VERIFIER_FORMAT, "derived verifier uses the explicit recovery format");
  equal(verifier.algorithm, "scrypt-sha256", "default verifier uses parameterized scrypt");
  equal(verifier.parameters.cost, 32768, "default scrypt cost is explicit");
  equal(verifier.salt, Buffer.alloc(16, 4).toString("base64url"), "injected salt is encoded canonically");
  check(/^[A-Za-z0-9_-]+$/u.test(verifier.digest), "derived digest is canonical base64url");
  check(!JSON.stringify(verifier).includes("correct horse battery staple"), "verifier never contains the raw passphrase");
  check(suppliedSalt.equals(Buffer.alloc(16, 4)), "caller-owned random bytes are not mutated during cleanup");
  check(await verifyRecoveryPassphrase("correct horse battery staple", verifier), "matching passphrase verifies");
  check(!(await verifyRecoveryPassphrase("incorrect horse battery staple", verifier)), "different passphrase does not verify");
  const rederived = await deriveRecoveryVerifier("correct horse battery staple", verifier);
  equal(rederived.digest, verifier.digest, "re-derivation preserves the configured KDF metadata and digest");

  const expected = crypto.scryptSync(
    Buffer.from("correct horse battery staple"),
    Buffer.alloc(16, 4),
    32,
    { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }
  ).toString("base64url");
  equal(verifier.digest, expected, "scrypt verifier matches Node's deterministic KDF result");

  const pbkdf2 = await createRecoveryVerifier("correct horse battery staple", {
    algorithm: "pbkdf2-sha256",
    parameters: { iterations: 210000, keyLength: 32 },
    randomBytes: (length) => Buffer.alloc(length, 5)
  });
  equal(pbkdf2.algorithm, "pbkdf2-sha256", "PBKDF2-SHA256 remains available for compatible verifiers");
  check(await verifyRecoveryPassphrase("correct horse battery staple", pbkdf2), "PBKDF2 verifier round-trips");
  await rejectsCode(() => createRecoveryVerifier("short"), "MUSEUM_LOCK_PASSPHRASE_INVALID",
    "short passphrases are rejected before KDF work");
  await rejectsCode(() => createRecoveryVerifier("        "), "MUSEUM_LOCK_PASSPHRASE_INVALID",
    "whitespace-only passphrases are rejected");
  await rejectsCode(() => createRecoveryVerifier("valid recovery phrase", {
    randomBytes: () => Buffer.alloc(15)
  }), "MUSEUM_LOCK_RANDOM_INVALID", "invalid salt randomness is rejected");
  const aborted = new AbortController();
  aborted.abort();
  await rejectsName(() => createRecoveryVerifier("valid recovery phrase", { signal: aborted.signal }), "AbortError",
    "already-aborted verifier work does not start");
}

async function checkApiLifecycle() {
  const fixture = createApiFixture();
  const { api, calls, store } = fixture;
  const getResponse = makeResponse();
  await api.handle(makeRequest("GET"), getResponse, new URL("http://localhost/api/museum-lock"));
  equal(getResponse.statusCode, 200, "GET returns public lock state");
  equal(getResponse.payload.state.status, "unlocked", "GET reports the initial unlocked state");
  equal(getResponse.payload.diskEncryptionProvided, false, "GET does not overclaim disk encryption");
  check(!Object.hasOwn(getResponse.payload.state, "recoveryVerifier"), "GET omits recovery verifier object");
  check(!JSON.stringify(getResponse.payload).includes(fixture.verifier.digest), "GET omits verifier digest");
  equal(getResponse.headers.ETag, museumLockEtag(getResponse.payload.state), "GET emits revision ETag");
  equal(getResponse.headers["Cache-Control"], "no-store", "lock status is not cached");

  const lockResponse = makeResponse();
  const lockRequest = makeRequest("POST", {
    confirmation: LOCK_CONFIRMATION,
    expectedRevision: 0,
    operationId: "api-lock-0001",
    passphrase: "correct recovery phrase"
  });
  await api.handle(lockRequest, lockResponse, new URL("http://localhost/api/museum-lock/lock"));
  equal(lockResponse.statusCode, 200, "lock transition succeeds");
  equal(lockResponse.payload.state.status, "locked", "lock response returns locked public state");
  equal(lockResponse.payload.state.revision, 1, "lock response exposes the new CAS revision");
  equal(lockResponse.payload.transition.action, "lock", "lock response includes a safe audit action");
  equal(lockResponse.payload.transition.secretMaterialIncluded, false, "audit explicitly excludes secret material");
  equal(lockResponse.payload.diskEncryptionProvided, false, "lock response remains honest about disk encryption");
  check(!JSON.stringify(lockResponse.payload).includes(fixture.verifier.digest), "lock HTTP response excludes verifier digest");
  check(!JSON.stringify(lockResponse.payload).includes(fixture.verifier.salt), "lock HTTP response excludes verifier salt");
  check(!JSON.stringify(lockResponse.payload).includes("correct recovery phrase"), "lock HTTP response excludes passphrase");
  equal(calls.bodyReads, 1, "lock body is read once");
  equal(calls.createPassphrases[0], "correct recovery phrase", "first lock derives a new verifier transiently");
  check(!Object.hasOwn(calls.commands[0], "passphrase"), "database command receives no raw passphrase");
  equal(calls.commands[0].verifier.digest, fixture.verifier.digest, "database command receives only the derived verifier");
  equal(calls.limits[0], MAX_MUSEUM_LOCK_BODY_BYTES, "lock body uses a small explicit byte budget");

  const wrongResponse = makeResponse();
  const wrongError = await captureAsync(() => api.handle(makeRequest("POST", {
    confirmation: UNLOCK_CONFIRMATION,
    expectedRevision: 1,
    operationId: "api-unlock-wrong",
    passphrase: "wrong recovery phrase"
  }), wrongResponse, new URL("http://localhost/api/museum-lock/unlock")));
  equal(wrongError?.code, "MUSEUM_LOCK_VERIFIER_MISMATCH", "wrong passphrase produces a generic verifier mismatch");
  equal(wrongError?.statusCode, 401, "wrong passphrase uses HTTP 401 semantics");
  equal(store.getMuseumLockState().revision, 1, "wrong passphrase writes no new revision");
  check(!String(wrongError?.message).includes("wrong recovery phrase"), "wrong passphrase is absent from error text");

  const unlockResponse = makeResponse();
  await api.handle(makeRequest("POST", {
    confirmation: UNLOCK_CONFIRMATION,
    expectedRevision: 1,
    operationId: "api-unlock-001",
    passphrase: "correct recovery phrase"
  }), unlockResponse, new URL("http://localhost/api/museum-lock/unlock"));
  equal(unlockResponse.payload.state.status, "unlocked", "matching passphrase unlocks the museum");
  equal(unlockResponse.payload.state.revision, 2, "unlock advances revision exactly once");
  equal(calls.derivePassphrases.at(-1), "correct recovery phrase", "unlock reuses stored KDF metadata transiently");
  check(!JSON.stringify(unlockResponse.payload).includes(fixture.verifier.digest), "unlock response excludes digest");
}

async function checkPreBodySafety() {
  let headerReads = 0;
  let bodyReads = 0;
  let stateReads = 0;
  const demoApi = createMuseumLockApi({
    store: {
      getMuseumLockState() { stateReads += 1; throw new Error("must not read state"); },
      transitionMuseumLock() { throw new Error("must not write"); }
    },
    sendJson,
    readJsonBody: async () => { bodyReads += 1; return {}; },
    httpError,
    interviewDemo: true,
    withRequestAbort: immediateAbortBoundary
  });
  const demoRequest = { method: "POST" };
  Object.defineProperty(demoRequest, "headers", {
    get() { headerReads += 1; return { "content-type": "application/json" }; }
  });
  const demoResponse = makeResponse();
  await demoApi.handle(demoRequest, demoResponse, new URL("http://localhost/api/museum-lock/lock"));
  equal(demoResponse.statusCode, 403, "public demo lock returns 403");
  equal(demoResponse.payload.bodyBytesRead, 0, "public demo response attests zero body bytes");
  equal(headerReads, 0, "public demo rejects before Content-Type access");
  equal(bodyReads, 0, "public demo rejects before body parsing");
  equal(stateReads, 0, "public demo rejects before persisted lock state access");

  const invalidType = createApiFixture();
  const badTypeError = await captureAsync(() => invalidType.api.handle(
    makeRequest("POST", {}, "text/plain"),
    makeResponse(),
    new URL("http://localhost/api/museum-lock/lock")
  ));
  equal(badTypeError?.code, "MUSEUM_LOCK_CONTENT_TYPE_INVALID", "non-JSON lock body is rejected");
  equal(invalidType.calls.bodyReads, 0, "invalid Content-Type consumes zero body bytes");
  equal(invalidType.calls.stateReads, 0, "invalid Content-Type is rejected before database access");

  const corrupt = createApiFixture({ stateError: museumError("damaged", "MUSEUM_LOCK_STATE_CORRUPT", 500) });
  const corruptError = await captureAsync(() => corrupt.api.handle(
    makeRequest("POST", {
      confirmation: LOCK_CONFIRMATION,
      expectedRevision: 0,
      operationId: "api-lock-damaged",
      passphrase: "correct recovery phrase"
    }),
    makeResponse(),
    new URL("http://localhost/api/museum-lock/lock")
  ));
  equal(corruptError?.code, "MUSEUM_LOCK_STATE_CORRUPT", "damaged lock singleton fails closed at API boundary");
  equal(corrupt.calls.bodyReads, 0, "damaged singleton is detected before passphrase body consumption");

  const extra = createApiFixture();
  const extraError = await captureAsync(() => extra.api.handle(makeRequest("POST", {
    confirmation: LOCK_CONFIRMATION,
    expectedRevision: 0,
    operationId: "api-lock-extra",
    passphrase: "correct recovery phrase",
    verifier: makeVerifier()
  }), makeResponse(), new URL("http://localhost/api/museum-lock/lock")));
  equal(extraError?.code, "MUSEUM_LOCK_REQUEST_INVALID", "client-supplied verifier fields are rejected");
  equal(extra.calls.commands.length, 0, "invalid request performs no lock transition");

  const unconfirmed = createApiFixture();
  const confirmationError = await captureAsync(() => unconfirmed.api.handle(makeRequest("POST", {
    confirmation: true,
    expectedRevision: 0,
    operationId: "api-lock-unconfirmed",
    passphrase: "correct recovery phrase"
  }), makeResponse(), new URL("http://localhost/api/museum-lock/lock")));
  equal(confirmationError?.code, "MUSEUM_LOCK_CONFIRMATION_REQUIRED", "boolean confirmation is rejected");
  equal(unconfirmed.calls.createPassphrases.length, 0, "invalid command does not spend KDF work");
  equal(unconfirmed.calls.commands.length, 0, "invalid command performs zero database transitions");

  const query = createApiFixture();
  const queryError = await captureAsync(() => query.api.handle(
    makeRequest("GET"),
    makeResponse(),
    new URL("http://localhost/api/museum-lock?debug=1")
  ));
  equal(queryError?.code, "MUSEUM_LOCK_QUERY_INVALID", "lock status rejects query parameters");
  const unrelated = await query.api.handle(
    makeRequest("GET"),
    makeResponse(),
    new URL("http://localhost/api/memories")
  );
  equal(unrelated, false, "unrelated routes fall through");
}

function createApiFixture(options = {}) {
  let state = createInitialMuseumLockState({
    clock: () => "2026-07-20T00:00:00.000Z",
    randomBytes: (length) => Buffer.alloc(length, 1)
  });
  const verifier = makeVerifier();
  const calls = {
    bodyReads: 0,
    limits: [],
    stateReads: 0,
    commands: [],
    createPassphrases: [],
    derivePassphrases: []
  };
  let transitionMinute = 1;
  const store = {
    getMuseumLockState() {
      calls.stateReads += 1;
      if (options.stateError) throw options.stateError;
      return state;
    },
    transitionMuseumLock(command) {
      calls.commands.push(structuredClone(command));
      const result = applyMuseumLockTransition(state, command, {
        clock: () => `2026-07-20T00:0${transitionMinute++}:00.000Z`
      });
      state = result.persistenceRecord;
      return result;
    }
  };
  const api = createMuseumLockApi({
    store,
    sendJson,
    readJsonBody: async (request, limit) => {
      calls.bodyReads += 1;
      calls.limits.push(limit);
      return request.body;
    },
    httpError,
    withRequestAbort: immediateAbortBoundary,
    createRecoveryVerifier: async (passphrase) => {
      calls.createPassphrases.push(passphrase);
      return verifier;
    },
    deriveRecoveryVerifier: async (passphrase) => {
      calls.derivePassphrases.push(passphrase);
      return passphrase === "correct recovery phrase" ? verifier : makeVerifier({ digestByte: 9 });
    }
  });
  return { api, calls, store, verifier };
}

function makeVerifier(options = {}) {
  return {
    format: RECOVERY_VERIFIER_FORMAT,
    version: 1,
    algorithm: "scrypt-sha256",
    parameters: { cost: 32768, blockSize: 8, parallelization: 1, keyLength: 32 },
    salt: Buffer.alloc(16, options.saltByte ?? 2).toString("base64url"),
    digest: Buffer.alloc(32, options.digestByte ?? 3).toString("base64url")
  };
}

function makeRequest(method, body = null, contentType = "application/json") {
  return {
    method,
    headers: { "content-type": contentType },
    body
  };
}

function makeResponse() {
  return {
    headers: {},
    statusCode: 0,
    payload: null,
    setHeader(name, value) { this.headers[name] = value; }
  };
}

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.payload = payload;
  return payload;
}

function httpError(statusCode, message) {
  return museumError(message, "", statusCode);
}

function museumError(message, code, statusCode) {
  const error = new Error(message);
  if (code) error.code = code;
  error.statusCode = statusCode;
  return error;
}

async function immediateAbortBoundary(_request, _response, operation) {
  return operation(new AbortController().signal);
}

async function captureAsync(operation) {
  try { await operation(); return null; }
  catch (error) { return error; }
}

function check(condition, message) {
  assert.ok(condition, message);
  assertions += 1;
}

function equal(actual, expected, message) {
  assert.equal(actual, expected, message);
  assertions += 1;
}

async function rejectsCode(operation, code, message) {
  equal((await captureAsync(operation))?.code, code, message);
}

async function rejectsName(operation, name, message) {
  equal((await captureAsync(operation))?.name, name, message);
}
