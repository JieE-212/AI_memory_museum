"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const provenance = require("../public/assets/provenance");

const root = path.resolve(__dirname, "..");
const html = read("public/index.html");
const app = read("public/assets/app.js");
const css = read("public/provenance.css");
const source = read("public/assets/provenance.js");
const pkg = JSON.parse(read("package.json"));
let assertions = 0;

function ok(value, message) {
  assertions += 1;
  assert.ok(value, message);
}

function equal(actual, expected, message) {
  assertions += 1;
  assert.equal(actual, expected, message);
}

function throwsCode(callback, message) {
  assertions += 1;
  assert.throws(callback, /UTF-16|原文/u, message);
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

const markup = provenance.renderPanel({ id: "memory-check" });
ok(markup.includes("来源护照"), "passport label is visible");
ok(markup.includes("<details") && !markup.includes("<details open"), "passport stays collapsed by default");
ok(markup.includes('data-provenance-passport="memory-check"'), "passport binds a safe memory id");
equal(provenance.renderPanel({ id: '\"><script>alert(1)</script>' }), "", "unsafe ids never enter markup");

const rawContent = "甲😀乙\r\n一段逐字原文";
const selection = provenance.buildMemoryTextSelection({ id: "memory-check", rawContent }, 1, 4);
equal(rawContent.slice(selection.locator.startOffset, selection.locator.endOffset), "😀乙", "UTF-16 offsets reproduce the selected text");
equal(selection.locator.offsetUnit, "utf16-code-unit", "text locator declares its offset unit");
equal(selection.sourceKind, "memory_text", "manual selection is typed as memory text");
equal(selection.relationKind, "supports", "manual text defaults to a visible support relation");
throwsCode(() => provenance.buildMemoryTextSelection({ id: "memory-check", rawContent }, -1, 2), "negative offsets are rejected");
throwsCode(() => provenance.buildMemoryTextSelection({ id: "memory-check", rawContent }, 2, 2), "empty ranges are rejected");
throwsCode(() => provenance.buildMemoryTextSelection({ id: "memory-check", rawContent: "   " }, 0, 3), "whitespace-only ranges are rejected");

const candidate = {
  kind: "document_excerpt",
  sourceKey: "document:abc",
  anchorKey: "range:def",
  locator: { startOffset: 0, endOffset: 4, offsetUnit: "utf16-code-unit" },
  label: "合成文档片段"
};
const request = provenance.toSourceRequest(candidate, "different_record");
equal(request.relationKind, "different_record", "different records remain an explicit relation");
equal(request.sourceKey, candidate.sourceKey, "source identity is preserved");
equal(provenance.toSourceRequest(candidate, "invented").relationKind, "supports", "unknown relations cannot pass through");

ok(html.includes(`/provenance.css?v=${pkg.version}`), "passport stylesheet is loaded");
ok(html.includes(`/assets/provenance.js?v=${pkg.version}`), "passport controller is loaded");
ok(html.indexOf("/assets/provenance.js") < html.indexOf("/assets/app.js"), "controller loads before the app");
ok(app.includes("TimeIsleProvenance?.renderPanel(memory)"), "memory detail renders the passport entry");
ok(app.includes("provenanceController?.open(memory, elements.dialogBody)"), "memory detail hydrates the passport on demand");
ok(app.includes("provenanceController?.close()"), "dialog cleanup aborts the passport session");
ok(source.includes("先存为草稿，之后再单独确认"), "draft and confirmation are separate user actions");
ok(source.includes("不是事实认证、可信度评分或公证"), "UI does not claim truth scoring or notarization");
ok(source.includes("不会改写原记忆"), "source review never promises to rewrite the memory");
ok(source.includes("公开 Demo 只展示合成来源护照"), "Demo boundary is explicit");
ok(!/localStorage|sessionStorage|indexedDB/iu.test(source), "passport controller creates no browser persistence");
ok(!/innerHTML\s*=|insertAdjacentHTML|document\.write/iu.test(source), "untrusted claim and source values use DOM text nodes");
ok(css.includes("@media (max-width: 650px)"), "mobile layout has a compact breakpoint");
ok(css.includes("@media (max-width: 390px)") && css.includes("@media (max-width: 320px)"), "narrow phone layouts are explicit");
ok(css.includes("min-height: 44px"), "touch controls keep a 44px target");
ok(css.includes("focus-visible"), "keyboard focus remains visible");
ok(css.includes(".provenance-claim-heading > strong") && css.includes(".provenance-source > strong") && css.includes("overflow-wrap: anywhere"), "long claims and source labels wrap inside narrow passports");
ok(css.includes("prefers-reduced-motion"), "reduced-motion preference is respected");
ok(!/gradient\s*\(/iu.test(css), "passport styling uses no gradients");

console.log(`Provenance UI checks passed: ${assertions} assertions.`);
