"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { getStaticAssetPolicy } = require("../lib/static-asset-policy");

const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(read("public/assets/semantic-recall-assets.json"));
let assertions = 0;

equal(manifest.format, "time-isle-semantic-recall-assets-v1", "asset manifest is versioned");
equal(manifest.model.license, "MIT", "base model SPDX license is frozen");
equal(manifest.runtime.license, "Apache-2.0", "Transformers.js SPDX license is frozen");
equal(manifest.runtime.version, "3.8.1", "runtime version is pinned");
equal(manifest.files.length, 7, "manifest pins every executable and model asset");
let totalBytes = 0;
for (const entry of manifest.files) {
  const file = path.join(root, entry.path);
  ok(fs.existsSync(file), `${entry.path} exists`);
  equal(fs.statSync(file).size, entry.bytes, `${entry.path} byte length is pinned`);
  equal(sha256(file), entry.sha256, `${entry.path} SHA-256 is pinned`);
  totalBytes += entry.bytes;
}
equal(totalBytes, manifest.totalRuntimeAndModelBytes, "47 MB disclosure equals exact runtime and model bytes");
equal(totalBytes, 46_979_724, "reviewed asset total cannot drift silently");

const modelNotice = read("public/assets/models/v17/MODEL-NOTICE.md");
const transformersLicense = read("public/assets/vendor/transformers-3.8.1/LICENSE");
ok(modelNotice.includes("SPDX") && modelNotice.includes("`MIT`") && modelNotice.includes("Permission is hereby granted"), "model ships source, SPDX identity and full MIT grant");
ok(modelNotice.includes(manifest.model.modelCardSha256AtReview), "model notice binds the reviewed upstream card hash");
ok(transformersLicense.includes("Apache License") && transformersLicense.includes("Version 2.0"), "Transformers.js ships its Apache-2.0 license text");

const wasm = getStaticAssetPolicy("assets/models/v17/runtime.wasm", "runtime.wasm");
const modulePolicy = getStaticAssetPolicy("assets/vendor/transformers-3.8.1/runtime.mjs", "runtime.mjs");
const modelPolicy = getStaticAssetPolicy("assets/models/v17/Xenova/bge/model.onnx", "model.onnx");
equal(wasm.contentType, "application/wasm", "WASM is served with the required MIME type");
equal(modulePolicy.contentType, "application/javascript; charset=utf-8", "ORT module is served as JavaScript");
ok(modelPolicy.cacheControl.includes("31536000") && modelPolicy.cacheControl.includes("immutable"), "versioned model assets use immutable browser HTTP caching");
equal(getStaticAssetPolicy("assets/app.js", "app.js").cacheControl, "public, max-age=300", "ordinary mutable shell assets keep short caching");

const serverSource = read("server.js");
const vercel = read("vercel.json");
for (const [label, policy] of [["Node", serverSource], ["Vercel", vercel]]) {
  ok(policy.includes("script-src 'self' 'wasm-unsafe-eval'"), `${label} CSP grants only the WebAssembly compiler capability`);
  ok(!/(?:^|\s)'unsafe-eval'(?:\s|;)/u.test(policy), `${label} CSP never grants JavaScript unsafe-eval`);
  ok(policy.includes("worker-src 'self'"), `${label} CSP keeps workers same-origin`);
}

console.log(`Semantic recall asset checks passed (${assertions} assertions).`);

function read(file) { return fs.readFileSync(path.join(root, file), "utf8"); }
function sha256(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function ok(value, message) { assert.ok(value, message); assertions += 1; }
function equal(actual, expected, message) { assert.equal(actual, expected, message); assertions += 1; }
