"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ui = require("../public/assets/multi-perspective.js");
const host = require("../public/assets/multi-perspective-host.js");
const { buildSyntheticMultiPerspectivePreview } = require("../lib/multi-perspective-api");

let assertions = 0;

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function run() {
  const panel = ui.renderPanel({ id: "memory-a" });
  ok(panel.includes('<details class="multi-perspective-panel"'), "detail panel uses progressive disclosure");
  ok(!/<details[^>]*\sopen(?:\s|>)/u.test(panel), "detail panel is closed by default");
  ok(panel.includes("多视角记忆对照") && panel.includes("不会自动保存或判断谁对谁错"),
    "default copy explains the human boundary");
  equal(ui.renderPanel({ id: '<script>alert(1)</script>' }), "", "invalid memory ID cannot enter panel HTML");

  const raw = buildSyntheticMultiPerspectivePreview("memory-a");
  const normalized = ui.normalizePreview(raw, "memory-a");
  equal(normalized.synthetic, true, "synthetic boundary reaches the UI");
  equal(normalized.target.id, "memory-a", "UI binds preview to the open memory");
  equal(normalized.perspectives.length, 2, "UI accepts owner and reply perspectives");
  equal(normalized.perspectives[1].identity.verified, false, "UI cannot upgrade reply identity");
  equal(normalized.perspectives[1].identity.signed, false, "UI cannot claim a reply signature");
  equal(normalized.comparisonClaims[0].sources[1].relationKind, "different_record",
    "UI keeps only provenance relation vocabulary");
  equal(normalized.editHistory[0].authorBoundary, "same-owner-edit-history",
    "UI keeps same-owner revision wording");
  ok(Object.isFrozen(normalized) && Object.isFrozen(normalized.perspectives), "normalized DTO is deeply frozen");

  const malicious = clone(raw);
  malicious.perspectives[1].label = '<img src=x onerror="alert(1)">';
  malicious.perspectives[1].excerpt = "<script>alert(2)</script>";
  malicious.comparisonClaims[0].statement = "<svg onload=alert(3)>";
  const safeData = ui.normalizePreview(malicious, "memory-a");
  equal(safeData.perspectives[1].label, '<img src=x onerror="alert(1)">',
    "normalizer treats markup as inert text instead of rewriting evidence");
  equal(safeData.comparisonClaims[0].statement, "<svg onload=alert(3)>",
    "claim text remains available for textContent rendering");

  const wrongMemory = clone(raw);
  wrongMemory.target.id = "memory-b";
  throwsCode(() => ui.normalizePreview(wrongMemory, "memory-a"), "MULTI_PERSPECTIVE_RESPONSE_INVALID",
    "cross-dialog stale preview is rejected");
  const wrongEngine = clone(raw);
  wrongEngine.execution.engine = "model-generated-comparison";
  throwsCode(() => ui.normalizePreview(wrongEngine, "memory-a"), "MULTI_PERSPECTIVE_RESPONSE_INVALID",
    "non-deterministic engine is rejected");
  const overstated = clone(raw);
  overstated.perspectives[1].identity.verified = true;
  throwsCode(() => ui.normalizePreview(overstated, "memory-a"), "MULTI_PERSPECTIVE_RESPONSE_INVALID",
    "verified reply identity is rejected");
  const invented = clone(raw);
  invented.comparisonClaims[0].sources[0].relationKind = "contradicts";
  throwsCode(() => ui.normalizePreview(invented, "memory-a"), "MULTI_PERSPECTIVE_RESPONSE_INVALID",
    "invented relation label is rejected");
  const leakedRevision = clone(raw);
  leakedRevision.editHistory[0].id = "synthetic-revision-old";
  throwsCode(() => ui.normalizePreview(leakedRevision, "memory-a"), "MULTI_PERSPECTIVE_RESPONSE_INVALID",
    "non-opaque revision ID is rejected");

  const requested = [];
  const client = host.createPreviewClient({ fetch: async (url, options) => {
    requested.push({ url, options });
    return { ok: true, status: 200, json: async () => ({ preview: raw }) };
  } });
  const payload = await client("memory-a", { signal: { marker: true } });
  equal(payload.preview.format, raw.format, "host returns API payload");
  equal(requested.length, 1, "host performs exactly one request");
  equal(requested[0].url, "/api/multi-perspective/memories/memory-a", "host requests only the fixed memory route");
  equal(requested[0].options.method, "GET", "host uses GET only");
  equal(requested[0].options.cache, "no-store", "host bypasses browser cache");
  equal(requested[0].options.credentials, "same-origin", "host keeps same-origin credentials boundary");
  await rejectsCode(() => client("../other", {}), "MULTI_PERSPECTIVE_MEMORY_ID_INVALID",
    "host rejects path-like memory IDs");

  const uiSource = read("public/assets/multi-perspective.js");
  const hostSource = read("public/assets/multi-perspective-host.js");
  const css = read("public/multi-perspective.css");
  ok(!/\.innerHTML\b|insertAdjacentHTML|outerHTML|document\.write/iu.test(uiSource),
    "all dynamic UI values use DOM text nodes");
  ok(uiSource.includes("textContent = item.label") && uiSource.includes("textContent = claim.statement") &&
    uiSource.includes("textContent = source.excerpt"), "untrusted labels, claims and excerpts use textContent");
  ok(!/\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon/u.test(uiSource),
    "UI renderer has no direct network capability");
  ok(!/localStorage|sessionStorage|indexedDB/u.test(uiSource + hostSource),
    "preview and handoff create no browser persistence");
  ok(!/method:\s*["'](?:POST|PUT|PATCH|DELETE)/u.test(hostSource), "host exposes no write request");
  ok(hostSource.includes('location.hash = "#reflect"') && hostSource.includes("[data-provenance-passport]") &&
    hostSource.includes(".memory-revision-panel"), "host only reveals existing provenance, revision and puzzle areas");
  ok(uiSource.includes("AbortController") && uiSource.includes("session !== active") && uiSource.includes("controller.abort()"),
    "dialog close and stale requests are guarded");
  ok(uiSource.includes("身份未核验") && uiSource.includes("文件未签名"),
    "identity-unverified boundary is permanent UI copy");
  ok(uiSource.includes("不负责宣布谁对谁错") && uiSource.includes("不等于另一人的记忆"),
    "beginner copy avoids truth adjudication and revision confusion");
  ok(!/gradient\s*\(/iu.test(css), "multi-perspective styling uses no gradients");
  ok(css.includes("grid-template-columns: repeat(2, minmax(0, 1fr))") &&
    css.includes("@media (max-width: 390px)") && css.includes("@media (max-width: 320px)"),
    "desktop and both narrow breakpoints are permanent");
  ok(/@media \(max-width: 650px\)[\s\S]*grid-template-columns: minmax\(0, 1fr\)/u.test(css),
    "mobile cards collapse to one column");
  ok(css.includes("min-height: 44px") && css.includes("overflow-wrap: anywhere"),
    "touch targets and long text remain safe");
  ok(css.includes(".multi-perspective-card.is-reply .multi-perspective-badge"),
    "reply identity badge has a persistent visual rule");

  console.log(`Multi-perspective UI checks passed: ${assertions} assertions.`);
}

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function read(file) { return fs.readFileSync(path.join(__dirname, "..", file), "utf8"); }
function ok(value, message) { assert.ok(value, message); assertions += 1; }
function equal(actual, expected, message) { assert.equal(actual, expected, message); assertions += 1; }
function throwsCode(callback, code, message) {
  assert.throws(callback, (error) => error?.code === code, message);
  assertions += 1;
}
async function rejectsCode(callback, code, message) {
  await assert.rejects(callback, (error) => error?.code === code, message);
  assertions += 1;
}
