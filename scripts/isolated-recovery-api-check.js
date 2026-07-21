"use strict";

const assert = require("node:assert/strict");
const {
  createIsolatedRecoveryApi,
  publicIsolatedRecoveryReceipt,
  ISOLATED_RECOVERY_PATH
} = require("../lib/isolated-recovery-api");
const { LIMITATION_STATEMENT } = require("../lib/isolated-recovery-drill");

let assertions = 0;

async function main() {
  await checkDemoRejectsBeforeRequestAccess();
  await checkSuccessProjection();
  await checkHttpBoundary();
  checkUnsafeReceiptFailsClosed();
  console.log(`Isolated recovery API checks passed: ${assertions}`);
}

async function checkDemoRejectsBeforeRequestAccess() {
  let bodyRead = false;
  let headersRead = false;
  let queryRead = false;
  let drillCalled = false;
  const request = {
    method: "POST",
    get headers() { headersRead = true; throw new Error("headers must not be read"); },
    [Symbol.asyncIterator]() { bodyRead = true; throw new Error("body must not be read"); }
  };
  const url = {
    pathname: ISOLATED_RECOVERY_PATH,
    get searchParams() { queryRead = true; throw new Error("query must not be read"); }
  };
  const api = createApi({
    interviewDemo: true,
    drill: { async run() { drillCalled = true; throw new Error("must not run"); } }
  });
  const result = await api.handle(request, responseFixture(), url);
  equal(result.status, 403, "public demo rejects isolated restore");
  equal(result.payload.bodyBytesRead, 0, "public demo attests zero body bytes read");
  equal(result.payload.interviewDemo, true, "public demo response is explicit");
  equal(headersRead, false, "public demo rejects before header access");
  equal(queryRead, false, "public demo rejects before query access");
  equal(bodyRead, false, "public demo rejects before body iteration");
  equal(drillCalled, false, "public demo never constructs a recovery copy");
}

async function checkSuccessProjection() {
  const report = receiptFixture();
  report.privateTitle = "private-title-canary";
  report.privateIdMap = { memory: "memory-private-canary" };
  report.privatePath = "C:\\private\\recovery-copy";
  const api = createApi({ drill: { async run() { return report; } } });
  const response = responseFixture();
  const result = await api.handle(
    { method: "POST", headers: { "content-type": "application/vnd.time-isle" } },
    response,
    urlFixture()
  );
  equal(result.status, 200, "valid rehearsal returns success");
  equal(response.headers["Cache-Control"], "no-store", "receipt cannot be cached");
  equal(result.payload.receipt.isolation.sandboxDestroyed, true, "public receipt confirms cleanup");
  equal(result.payload.receipt.checks.restore.counts.memories, 2, "safe count survives projection");
  const serialized = JSON.stringify(result.payload);
  equal(/private-title-canary|memory-private-canary|private\\recovery-copy/u.test(serialized), false,
    "public projection physically excludes ignored private fields");
  ok(Object.isFrozen(result.payload.receipt), "public receipt is immutable");
}

async function checkHttpBoundary() {
  const api = createApi();
  await rejectsCode(
    () => api.handle({ method: "GET", headers: {} }, responseFixture(), urlFixture()),
    "ISOLATED_RECOVERY_METHOD_NOT_ALLOWED",
    "only POST is accepted"
  );
  await rejectsCode(
    () => api.handle({ method: "POST", headers: { "content-type": "text/plain" } }, responseFixture(), urlFixture()),
    "ISOLATED_RECOVERY_CONTENT_TYPE_INVALID",
    "non-archive content type is rejected"
  );
  await rejectsCode(
    () => api.handle(
      { method: "POST", headers: { "content-type": "application/octet-stream" } },
      responseFixture(),
      urlFixture("debug=1")
    ),
    "ISOLATED_RECOVERY_QUERY_INVALID",
    "query parameters are rejected"
  );
  equal(await api.handle({ method: "GET", headers: {} }, responseFixture(), { pathname: "/api/other" }), false,
    "unrelated routes are not consumed");
}

function checkUnsafeReceiptFailsClosed() {
  const unsafe = receiptFixture();
  unsafe.isolation.sandboxDestroyed = false;
  assert.throws(
    () => publicIsolatedRecoveryReceipt(unsafe),
    (error) => error?.code === "ISOLATED_RECOVERY_UNSAFE_RECEIPT"
  );
  assertions += 1;
}

function createApi(overrides = {}) {
  return createIsolatedRecoveryApi({
    drill: overrides.drill || { async run() { return receiptFixture(); } },
    interviewDemo: Boolean(overrides.interviewDemo),
    sendJson(response, status, payload) {
      response.writableFinished = true;
      return { status, payload };
    },
    httpError(statusCode, message) {
      return Object.assign(new Error(message), { statusCode });
    },
    withRequestAbort: async (_request, _response, operation) => operation(new AbortController().signal)
  });
}

function receiptFixture() {
  return {
    format: "time-isle.isolated-recovery-receipt",
    version: 1,
    kind: "isolated-restore",
    requestId: "recovery_abcdefghijklmnopqrstuvwx",
    startedAt: "2026-07-21T00:00:00.000Z",
    completedAt: "2026-07-21T00:00:01.000Z",
    durationMs: 1000,
    verdict: "passed-isolated-restore",
    source: {
      format: "time-isle-media-archive",
      formatVersion: 2,
      schemaVersion: 19,
      mode: "full",
      entryCount: 8,
      expandedBytes: 1024
    },
    target: { schemaVersion: 19, kind: "single-use-copy" },
    checks: {
      archive: { status: "passed", entriesVerified: 8, referencesRechecked: 3 },
      restore: {
        status: "passed",
        counts: {
          memories: 2, mediaAssets: 1, mediaVariants: 3, voiceAssets: 1, exhibitions: 1, capsules: 1,
          entities: 2, revisions: 2, timeCalibrations: 1, oralHistoryQuestions: 0, oralHistoryAnswers: 0,
          curatorAgentRuns: 0, memoryInboxItems: 1, provenanceClaims: 1, coMemoryResponses: 0, revisitIntents: 1
        }
      },
      database: { status: "passed", passed: 12, total: 12, attention: 2 },
      references: { status: "passed", edgesChecked: 3 },
      media: { status: "passed", assetsVerified: 1, variantsVerified: 3 },
      voice: { status: "passed", assetsVerified: 1, filesVerified: 1 }
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
  };
}

function responseFixture() {
  return {
    writableFinished: false,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; }
  };
}

function urlFixture(query = "") {
  return {
    pathname: ISOLATED_RECOVERY_PATH,
    searchParams: new URLSearchParams(query)
  };
}

function ok(value, message) {
  assertions += 1;
  assert.ok(value, message);
}

function equal(actual, expected, message) {
  assertions += 1;
  assert.equal(actual, expected, message);
}

async function rejectsCode(operation, code, message) {
  assertions += 1;
  await assert.rejects(operation, (error) => error?.code === code, message);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
