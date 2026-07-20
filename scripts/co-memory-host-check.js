"use strict";

const assert = require("node:assert/strict");
const host = require("../public/assets/co-memory-host.js");

let assertions = 0;

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});

async function main() {
  const contract = { requestSha256: "a".repeat(64), confirm: true };
  equal(host.createIdempotencyKey(contract), `co-memory-confirm:${"a".repeat(64)}`,
    "host derives one stable retry key from the verified request digest");
  throwsCode(() => host.createIdempotencyKey({}), "CO_MEMORY_REQUEST_BINDING_INVALID",
    "host refuses to invent a non-replayable idempotency key");

  const calls = [];
  const signal = new AbortController().signal;
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return jsonResponse(201, { record: { kind: "co_memory_response", id: "response-1" } });
  };
  const first = await host.confirmResponse(fetchImpl, contract, { signal });
  const second = await host.confirmResponse(fetchImpl, contract, { signal });
  equal(first.id, "response-1", "host returns only the saved independent source record");
  equal(calls.length, 2, "an explicit retry performs a second request");
  equal(calls[0].url, "/api/co-memory-responses/confirm", "host uses the dedicated confirmation route");
  equal(calls[0].options.method, "POST", "host uses POST for explicit confirmation");
  equal(calls[0].options.headers["Content-Type"], "application/json", "host sends the strict JSON content type");
  equal(calls[0].options.headers["Idempotency-Key"], calls[1].options.headers["Idempotency-Key"],
    "lost-response retry reuses the exact idempotency key");
  equal(calls[0].options.signal, signal, "host forwards the dialog AbortSignal to fetch");
  equal(calls[0].options.credentials, "same-origin", "host keeps the confirmation on the current origin");
  deepEqual(JSON.parse(calls[0].options.body), contract, "host sends only the confirmation contract");

  let capturedOptions = null;
  const letters = {
    createController(options) {
      capturedOptions = options;
      return { close() {} };
    }
  };
  const onChanged = () => {};
  const controller = host.createController({ letters, fetch: fetchImpl, demo: true, onChanged });
  ok(controller && typeof controller.close === "function", "host creates the isolated letter controller");
  equal(capturedOptions.demo, true, "host passes the Demo read-only state through");
  equal(capturedOptions.fetch, fetchImpl, "crypto-source loading and confirmation share the injected fetch boundary");
  equal(capturedOptions.onChanged, onChanged, "host preserves the post-save source refresh callback");
  ok(typeof capturedOptions.confirmResponse === "function", "host supplies the confirmation callback");

  let failed = null;
  try {
    await host.confirmResponse(async () => jsonResponse(409, { error: "duplicate", code: "CO_MEMORY_DUPLICATE_REQUEST" }), contract);
  } catch (error) { failed = error; }
  equal(failed?.status, 409, "host preserves the HTTP status for a rejected confirmation");
  equal(failed?.code, "CO_MEMORY_DUPLICATE_REQUEST", "host preserves the stable server error code");
  await rejectsCode(() => host.confirmResponse(async () => jsonResponse(200, { ok: true }), contract),
    "CO_MEMORY_RESPONSE_RESULT_INVALID", "host rejects a success payload without an independent source record");

  console.log(`Co-memory host checks passed: ${assertions} assertions.`);
}

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => "application/json" },
    json: async () => payload,
    text: async () => JSON.stringify(payload)
  };
}

function ok(value, message) { assert.ok(value, message); assertions += 1; }
function equal(actual, expected, message) { assert.equal(actual, expected, message); assertions += 1; }
function deepEqual(actual, expected, message) { assert.deepEqual(actual, expected, message); assertions += 1; }
function throwsCode(operation, code, message) {
  assert.throws(operation, (error) => error?.code === code, message);
  assertions += 1;
}
async function rejectsCode(operation, code, message) {
  await assert.rejects(operation, (error) => error?.code === code, message);
  assertions += 1;
}
