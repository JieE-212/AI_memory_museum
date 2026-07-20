"use strict";

const assert = require("node:assert/strict");
const {
  LIMITATION_STATEMENT,
  createStructuralRecoveryApi,
  publicStructuralVerification
} = require("../lib/structural-recovery-api");
const {
  STRUCTURAL_RECOVERY_FORMAT,
  STRUCTURAL_RECOVERY_MAXIMUM_BUDGET,
  STRUCTURAL_VERIFICATION_KIND
} = require("../lib/structural-recovery-drill");

let assertions = 0;

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  checkProjection();
  await checkApiLifecycle();
  await checkPreBodyAndFailureSafety();
  console.log(`structural-recovery-api-check: ${assertions} assertions passed`);
}

function checkProjection() {
  const source = validReport();
  source.privateMemoryText = "must never cross the API";
  source.archive.internalPath = "C:/private/archive.time-isle";
  source.safety.recoveryVerifier = { salt: "private", digest: "private" };
  const projected = publicStructuralVerification(source);
  equal(projected.format, STRUCTURAL_RECOVERY_FORMAT, "projection preserves explicit report format");
  equal(projected.kind, STRUCTURAL_VERIFICATION_KIND, "projection labels itself structural-verification");
  equal(projected.verdict, "passed-structural-verification", "projection returns a bounded structural verdict");
  equal(projected.archive.mode, "full", "projection confirms a full archive was checked");
  equal(projected.safety.currentCollectionWrites, 0, "projection reports zero collection writes");
  equal(projected.safety.currentMediaWrites, 0, "projection reports zero media writes");
  equal(projected.safety.restoreCallbacksAvailable, false, "projection confirms restore callbacks were unavailable");
  equal(projected.safety.verifierMaterialIncluded, false, "projection excludes lock verifier material");
  equal(projected.limitations.actualRestorePerformed, false, "projection does not claim a real restore");
  equal(projected.limitations.isolatedRestorePerformed, false, "projection does not claim an isolated restore");
  equal(projected.limitations.disasterRecoveryProven, false, "projection does not overclaim disaster recovery");
  equal(projected.limitations.diskEncryptionProvided, false, "projection does not imply disk encryption");
  check(!Object.hasOwn(projected, "privateMemoryText"), "root private fields are physically omitted");
  check(!Object.hasOwn(projected.archive, "internalPath"), "archive filesystem paths are physically omitted");
  check(!Object.hasOwn(projected.safety, "recoveryVerifier"), "verifier objects are physically omitted");
  check(!JSON.stringify(projected).includes("must never cross"), "private memory text is absent from serialization");
  check(Object.isFrozen(projected.limitations), "public verification is deeply immutable");

  throwsCode(() => publicStructuralVerification(mutatedReport((report) => {
    report.limitations.actualRestorePerformed = true;
  })), "RECOVERY_DRILL_UNSAFE_REPORT", "actual-restore overclaim is rejected");
  throwsCode(() => publicStructuralVerification(mutatedReport((report) => {
    report.limitations.isolatedRestorePerformed = true;
  })), "RECOVERY_DRILL_UNSAFE_REPORT", "isolated-restore overclaim is rejected");
  throwsCode(() => publicStructuralVerification(mutatedReport((report) => {
    report.safety.currentCollectionWrites = 1;
  })), "RECOVERY_DRILL_UNSAFE_REPORT", "nonzero current-collection writes are rejected");
  throwsCode(() => publicStructuralVerification(mutatedReport((report) => {
    report.safety.verifierMaterialIncluded = true;
  })), "RECOVERY_DRILL_UNSAFE_REPORT", "verifier-bearing reports are rejected");
  throwsCode(() => publicStructuralVerification(mutatedReport((report) => {
    report.checks.hashes.entriesVerified -= 1;
  })), "RECOVERY_DRILL_UNSAFE_REPORT", "partial hash verification cannot produce a passing report");
  throwsCode(() => publicStructuralVerification(mutatedReport((report) => {
    report.archive.mode = "redacted";
  })), "RECOVERY_DRILL_UNSAFE_REPORT", "redacted archive cannot pass a structural recovery drill");
  throwsCode(() => publicStructuralVerification(mutatedReport((report) => {
    report.completedAt = "2026-07-20T00:59:59.000Z";
  })), "RECOVERY_DRILL_UNSAFE_REPORT", "backwards drill timeline is rejected");
  throwsCode(() => publicStructuralVerification(mutatedReport((report) => {
    report.checks.references.memoryCount = report.safety.budget.maxMemories + 1;
  })), "RECOVERY_DRILL_UNSAFE_REPORT", "reported memory count cannot exceed the drill budget");
  throwsCode(() => publicStructuralVerification(mutatedReport((report) => {
    report.limitations.statement = "structural-verification only: private memory text";
  })), "RECOVERY_DRILL_UNSAFE_REPORT", "noncanonical limitation text cannot become a disclosure channel");
}

async function checkApiLifecycle() {
  const calls = { runs: 0, source: null, options: null };
  const report = validReport();
  report.privateMemoryText = "private body";
  const drill = {
    async run(source, options) {
      calls.runs += 1;
      calls.source = source;
      calls.options = options;
      return report;
    }
  };
  const api = createStructuralRecoveryApi({
    drill,
    sendJson,
    httpError,
    withRequestAbort: immediateAbortBoundary
  });
  const request = makeRequest("POST", "application/vnd.time-isle");
  const response = makeResponse();
  await api.handle(request, response, new URL("http://localhost/api/recovery-drills/structural"));
  equal(calls.runs, 1, "API invokes one structural drill");
  equal(calls.source, request, "archive request stream is passed directly to trusted preflight");
  check(calls.options.signal instanceof AbortSignal, "drill receives the request AbortSignal");
  equal(calls.options.demoMode, false, "local structural drill is explicitly non-demo");
  check(!Object.hasOwn(calls.options, "restore"), "API supplies no restore option or callback");
  equal(response.statusCode, 200, "passing structural verification returns HTTP 200");
  equal(response.payload.ok, true, "passing response has an explicit success marker");
  equal(response.payload.verification.kind, "structural-verification", "response uses the bounded verification kind");
  equal(response.payload.verification.archive.entryCount, 5, "response reports only bounded archive counts");
  equal(response.payload.verification.checks.references.memoryCount, 1, "response reports bounded reference counts");
  equal(response.payload.verification.limitations.actualRestorePerformed, false,
    "HTTP response explicitly states that no restore occurred");
  check(!JSON.stringify(response.payload).includes("private body"), "HTTP response physically omits private report extras");
  equal(response.headers["Cache-Control"], "no-store", "verification response is not cached");

  for (const contentType of ["application/gzip", "application/x-gzip", "application/octet-stream"]) {
    const accepted = makeResponse();
    await api.handle(makeRequest("POST", `${contentType}; charset=binary`), accepted,
      new URL("http://localhost/api/recovery-drills/structural"));
    equal(accepted.statusCode, 200, `${contentType} archive upload is accepted`);
  }
  const unrelated = await api.handle(makeRequest("GET"), makeResponse(), new URL("http://localhost/api/memories"));
  equal(unrelated, false, "unrelated routes fall through");
}

async function checkPreBodyAndFailureSafety() {
  let headerReads = 0;
  let runs = 0;
  const demoApi = createStructuralRecoveryApi({
    drill: { async run() { runs += 1; throw new Error("must not run"); } },
    sendJson,
    httpError,
    interviewDemo: true,
    withRequestAbort: immediateAbortBoundary
  });
  const demoRequest = { method: "POST" };
  Object.defineProperty(demoRequest, "headers", {
    get() { headerReads += 1; return { "content-type": "application/vnd.time-isle" }; }
  });
  const demoResponse = makeResponse();
  await demoApi.handle(demoRequest, demoResponse, new URL("http://localhost/api/recovery-drills/structural"));
  equal(demoResponse.statusCode, 403, "public demo structural upload returns 403");
  equal(demoResponse.payload.bodyBytesRead, 0, "public demo attests zero consumed body bytes");
  equal(headerReads, 0, "public demo rejects before Content-Type access");
  equal(runs, 0, "public demo does not stage or inspect the archive");

  const localCalls = { runs: 0 };
  const localApi = createStructuralRecoveryApi({
    drill: { async run() { localCalls.runs += 1; return validReport(); } },
    sendJson,
    httpError,
    withRequestAbort: immediateAbortBoundary
  });
  const typeError = await captureAsync(() => localApi.handle(
    makeRequest("POST", "application/json"),
    makeResponse(),
    new URL("http://localhost/api/recovery-drills/structural")
  ));
  equal(typeError?.code, "RECOVERY_DRILL_CONTENT_TYPE_INVALID", "JSON is rejected as an archive upload");
  equal(typeError?.statusCode, 415, "invalid archive Content-Type uses HTTP 415");
  equal(localCalls.runs, 0, "invalid Content-Type calls no preflight");

  const queryError = await captureAsync(() => localApi.handle(
    makeRequest("POST"),
    makeResponse(),
    new URL("http://localhost/api/recovery-drills/structural?restore=true")
  ));
  equal(queryError?.code, "RECOVERY_DRILL_QUERY_INVALID", "restore-like query parameters are rejected");
  equal(localCalls.runs, 0, "invalid query calls no preflight");
  const methodError = await captureAsync(() => localApi.handle(
    makeRequest("GET"),
    makeResponse(),
    new URL("http://localhost/api/recovery-drills/structural")
  ));
  equal(methodError?.code, "RECOVERY_DRILL_METHOD_NOT_ALLOWED", "GET cannot masquerade as a recovery drill");

  const unsafeApi = createStructuralRecoveryApi({
    drill: { async run() { return mutatedReport((report) => { report.limitations.disasterRecoveryProven = true; }); } },
    sendJson,
    httpError,
    withRequestAbort: immediateAbortBoundary
  });
  const unsafeResponse = makeResponse();
  const unsafeError = await captureAsync(() => unsafeApi.handle(
    makeRequest("POST"),
    unsafeResponse,
    new URL("http://localhost/api/recovery-drills/structural")
  ));
  equal(unsafeError?.code, "RECOVERY_DRILL_UNSAFE_REPORT", "unsafe downstream report fails closed");
  equal(unsafeResponse.statusCode, 0, "unsafe downstream report is never serialized");

  const archiveFailure = museumError("hash mismatch", "MEDIA_ARCHIVE_HASH_MISMATCH", 422);
  const failureApi = createStructuralRecoveryApi({
    drill: { async run() { throw archiveFailure; } },
    sendJson,
    httpError,
    withRequestAbort: immediateAbortBoundary
  });
  const propagated = await captureAsync(() => failureApi.handle(
    makeRequest("POST"),
    makeResponse(),
    new URL("http://localhost/api/recovery-drills/structural")
  ));
  equal(propagated, archiveFailure, "archive-integrity failures remain inspectable by the HTTP error layer");
}

function validReport() {
  return {
    format: STRUCTURAL_RECOVERY_FORMAT,
    version: 1,
    kind: STRUCTURAL_VERIFICATION_KIND,
    requestId: "drill_AAAAAAAAAAAAAAAAAAAAAAAA",
    startedAt: "2026-07-20T01:00:00.000Z",
    completedAt: "2026-07-20T01:00:02.000Z",
    verdict: "passed-structural-verification",
    archive: {
      format: "time-isle-media-archive",
      formatVersion: 2,
      schemaVersion: 19,
      appVersion: "14.0.0",
      mode: "full",
      exportedAt: "2026-07-20T00:30:00.000Z",
      entryCount: 5,
      expandedBytes: 2048,
      archiveFingerprint: "a".repeat(64)
    },
    checks: {
      manifest: { status: "passed", entriesDeclared: 5, requiredFullEntriesPresent: true },
      hashes: {
        status: "passed",
        entriesVerified: 5,
        descriptorBindingsRechecked: 1,
        basis: "trusted-complete-archive-preflight"
      },
      references: {
        status: "passed",
        memoryCount: 1,
        mediaAssetCount: 1,
        mediaLinksRechecked: 1,
        observationsRechecked: 1,
        declaredSectionsVerifiedByPreflight: 2,
        basis: "trusted-complete-archive-preflight-plus-bounded-core-recheck"
      }
    },
    safety: {
      currentCollectionWrites: 0,
      currentMediaWrites: 0,
      restoreCallbacksAvailable: false,
      verifierMaterialIncluded: false,
      budget: { ...STRUCTURAL_RECOVERY_MAXIMUM_BUDGET }
    },
    limitations: {
      actualRestorePerformed: false,
      isolatedRestorePerformed: false,
      disasterRecoveryProven: false,
      diskEncryptionProvided: false,
      statement: LIMITATION_STATEMENT
    }
  };
}

function mutatedReport(mutate) {
  const report = validReport();
  mutate(report);
  return report;
}

function makeRequest(method, contentType = "application/vnd.time-isle") {
  return { method, headers: { "content-type": contentType } };
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

function capture(operation) {
  try { operation(); return null; }
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

function throwsCode(operation, code, message) {
  equal(capture(operation)?.code, code, message);
}
