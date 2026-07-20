"use strict";

const {
  createRequestSecurity,
  parseAuthority,
  platformHostsFromEnv
} = require("../lib/request-security");

let assertions = 0;

accept("local accepts canonical IPv4 loopback", local(), request("GET", "127.0.0.1"));
accept("local accepts IPv4 loopback with a legal port", local(), request("GET", "127.0.0.1:3000"));
accept("local accepts localhost case-insensitively", local(), request("GET", "LOCALHOST:3000"));
accept("local accepts bracketed IPv6 loopback", local(), request("GET", "[::1]"));
accept("local accepts bracketed IPv6 loopback with maximum port", local(), request("GET", "[::1]:65535"));
reject("local rejects missing Host", local(), request("GET", null), 421, "HOST_NOT_ALLOWED");
reject("local rejects a DNS rebinding hostname", local(), request("GET", "attacker.example"), 421, "HOST_NOT_ALLOWED");
reject("local ignores ALLOWED_HOSTS and remains loopback-only", local("attacker.example"), request("GET", "attacker.example"), 421, "HOST_NOT_ALLOWED");
reject("local rejects abbreviated loopback", local(), request("GET", "127.1"), 421, "HOST_NOT_ALLOWED");
reject("local rejects integer-encoded loopback", local(), request("GET", "2130706433"), 421, "HOST_NOT_ALLOWED");
reject("local rejects wildcard bind addresses", local(), request("GET", "0.0.0.0:3000"), 421, "HOST_NOT_ALLOWED");
reject("local rejects host userinfo", local(), request("GET", "user@localhost:3000"), 421, "HOST_NOT_ALLOWED");
reject("local rejects a trailing-dot alias", local(), request("GET", "localhost.:3000"), 421, "HOST_NOT_ALLOWED");
reject("local rejects port zero", local(), request("GET", "localhost:0"), 421, "HOST_NOT_ALLOWED");
reject("local rejects an out-of-range port", local(), request("GET", "localhost:65536"), 421, "HOST_NOT_ALLOWED");
reject("local rejects an empty port", local(), request("GET", "localhost:"), 421, "HOST_NOT_ALLOWED");
reject("local rejects duplicate raw Host headers", local(), request("GET", "localhost", {}, ["Host", "localhost", "Host", "127.0.0.1"]), 421, "HOST_NOT_ALLOWED");

const deployed = createRequestSecurity({
  deployment: true,
  platformHosts: ["preview-one.vercel.app", "https://production.vercel.app"],
  allowedHosts: "memories.example, api.memories.example:8443"
});
accept("deployment accepts the Vercel preview host", deployed, request("GET", "preview-one.vercel.app"));
accept("deployment accepts a URL-shaped platform host value", deployed, request("GET", "production.vercel.app"));
accept("deployment accepts an explicit custom host", deployed, request("GET", "memories.example"));
accept("deployment accepts an explicitly port-scoped host", deployed, request("GET", "api.memories.example:8443"));
reject("deployment rejects an unlisted host", deployed, request("GET", "other.vercel.app"), 421, "HOST_NOT_ALLOWED");
reject("deployment does not implicitly trust loopback", deployed, request("GET", "localhost"), 421, "HOST_NOT_ALLOWED");
reject("deployment host ports must match explicitly", deployed, request("GET", "api.memories.example"), 421, "HOST_NOT_ALLOWED");
reject("forwarded host cannot replace an unlisted Host", deployed, request("GET", "attacker.example", { "x-forwarded-host": "memories.example" }), 421, "HOST_NOT_ALLOWED");
reject("deployment with no platform or explicit hosts fails closed", createRequestSecurity({ deployment: true }), request("GET", "anything.example"), 421, "HOST_NOT_ALLOWED");
throws("invalid deployment host configuration fails at startup", () => createRequestSecurity({ deployment: true, allowedHosts: "*.example.com" }), TypeError);

accept("safe GET does not require Origin", local(), request("GET", "localhost:3000"));
accept("safe HEAD does not require Origin", local(), request("HEAD", "localhost:3000"));
accept("write accepts an exact local Origin without Fetch Metadata", local(), request("POST", "localhost:3000", { origin: "http://localhost:3000" }));
accept("write accepts an exact Origin marked same-origin", local(), request("PUT", "127.0.0.1:3000", { origin: "http://127.0.0.1:3000", "sec-fetch-site": "same-origin" }));
accept("deployment write requires HTTPS and accepts matching Origin", deployed, request("DELETE", "memories.example", { origin: "https://memories.example", "sec-fetch-site": "same-origin" }));
accept("deployment write accepts an exact HTTPS Origin with its allowed port", deployed, request("POST", "api.memories.example:8443", { origin: "https://api.memories.example:8443" }));
accept("forwarded protocol cannot weaken an exact HTTPS Origin", deployed, request("POST", "memories.example", { origin: "https://memories.example", "x-forwarded-proto": "http" }));
reject("write rejects a missing Origin", local(), request("POST", "localhost:3000"), 403, "ORIGIN_REQUIRED");
reject("deployment write rejects an Origin missing the allowed host port", deployed, request("POST", "api.memories.example:8443", { origin: "https://api.memories.example" }), 403, "ORIGIN_MISMATCH");
reject("deployment write rejects duplicate raw Origin headers", deployed, request("POST", "memories.example", {}, ["Host", "memories.example", "Origin", "https://memories.example", "Origin", "https://memories.example"]), 403, "ORIGIN_REQUIRED");
reject("deployment write rejects duplicate Fetch Metadata headers", deployed, request("POST", "memories.example", {}, ["Host", "memories.example", "Origin", "https://memories.example", "Sec-Fetch-Site", "same-origin", "Sec-Fetch-Site", "same-origin"]), 403, "FETCH_SITE_INVALID");
reject("write rejects a foreign Origin", local(), request("POST", "localhost:3000", { origin: "http://attacker.example" }), 403, "ORIGIN_MISMATCH");
reject("write rejects the opaque null Origin", local(), request("POST", "localhost:3000", { origin: "null" }), 403, "ORIGIN_INVALID");
reject("write rejects an Origin with a path", local(), request("POST", "localhost:3000", { origin: "http://localhost:3000/path" }), 403, "ORIGIN_MISMATCH");
reject("write rejects a mismatched scheme", local(), request("POST", "localhost:3000", { origin: "https://localhost:3000" }), 403, "ORIGIN_MISMATCH");
reject("write rejects a mismatched port", local(), request("POST", "localhost:3000", { origin: "http://localhost:3001" }), 403, "ORIGIN_MISMATCH");
reject("write rejects cross-site Fetch Metadata", local(), request("POST", "localhost:3000", { origin: "http://localhost:3000", "sec-fetch-site": "cross-site" }), 403, "FETCH_SITE_MISMATCH");
reject("write rejects same-site Fetch Metadata", local(), request("POST", "localhost:3000", { origin: "http://localhost:3000", "sec-fetch-site": "same-site" }), 403, "FETCH_SITE_MISMATCH");
reject("absolute-form request targets cannot replace the validated host", local(), request("GET", "localhost:3000", {}, null, "http://attacker.example/api/health"), 400, "REQUEST_TARGET_INVALID");
reject("backslash network-path targets cannot replace the validated host", local(), request("GET", "localhost:3000", {}, null, "/\\attacker.example/api/health"), 400, "REQUEST_TARGET_INVALID");

equal("authority parser canonicalizes host case and port", parseAuthority("LOCALHOST:03000").authority, "localhost:3000");
equal("platform host discovery uses only documented Vercel variables", platformHostsFromEnv({ VERCEL_URL: "one.vercel.app", VERCEL_BRANCH_URL: "two.vercel.app", VERCEL_PROJECT_PRODUCTION_URL: "three.vercel.app", OTHER: "ignored.example" }).join(","), "one.vercel.app,two.vercel.app,three.vercel.app");

console.log(`Request security checks passed: ${assertions} assertions.`);

function local(allowedHosts = "") {
  return createRequestSecurity({ deployment: false, allowedHosts });
}

function request(method, host, extraHeaders = {}, rawHeaders = null, url = "/api/health") {
  const headers = { ...extraHeaders };
  if (host !== null) headers.host = host;
  return { method, url, headers, ...(rawHeaders ? { rawHeaders } : {}) };
}

function accept(name, security, candidate) {
  let result;
  try {
    result = security.validate(candidate);
  } catch (error) {
    throw new Error(`not ok - ${name}: ${error.code || error.message}`);
  }
  check(name, Boolean(result?.origin));
}

function reject(name, security, candidate, statusCode, code) {
  let caught = null;
  try {
    security.validate(candidate);
  } catch (error) {
    caught = error;
  }
  check(name, caught?.statusCode === statusCode && caught?.code === code);
}

function throws(name, operation, ErrorType) {
  let caught = null;
  try {
    operation();
  } catch (error) {
    caught = error;
  }
  check(name, caught instanceof ErrorType);
}

function equal(name, actual, expected) {
  check(name, actual === expected);
}

function check(name, condition) {
  assertions += 1;
  if (!condition) throw new Error(`not ok - ${name}`);
  console.log(`ok - ${name}`);
}
