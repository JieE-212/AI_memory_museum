"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const inbox = require("../public/assets/memory-inbox");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "public", "memory-inbox.css"), "utf8");
const app = fs.readFileSync(path.join(root, "public", "assets", "app.js"), "utf8");
const moduleSource = fs.readFileSync(path.join(root, "public", "assets", "memory-inbox.js"), "utf8");
let assertions = 0;

function ok(value, message) {
  assertions += 1;
  assert.ok(value, message);
}

function equal(actual, expected, message) {
  assertions += 1;
  assert.equal(actual, expected, message);
}

const requiredIds = [
  "memoryInboxEntry", "memoryInboxOpenButton", "memoryInboxDialog", "memoryInboxTitle",
  "memoryInboxFile", "memoryInboxCandidates", "memoryInboxItems", "memoryInboxStatus"
];
for (const id of requiredIds) ok(html.includes(`id="${id}"`), `DOM contains #${id}`);

ok(html.includes("从文档整理") && html.includes("逐段确认后才入馆"), "compose keeps inbox behind progressive disclosure");
ok(html.includes("accept=\".txt,.md,.markdown,text/plain,text/markdown\""), "file chooser is limited to text and Markdown");
ok(html.includes("公开 Demo 只展示合成样例") && moduleSource.includes("elements.file.disabled = demo"), "Demo disables private file selection");
ok(moduleSource.includes("textContent = segment.excerpt") && !moduleSource.includes("preview.innerHTML"), "untrusted excerpts render only as text");
ok(moduleSource.includes("fileState.bytes.fill(0)") && moduleSource.includes("elements.file.value = \"\""), "dialog cleanup releases file bytes and chooser state");
ok(moduleSource.includes("rawBase64") && moduleSource.includes("Idempotency-Key"), "client sends raw bytes for server verification with idempotency");
ok(app.includes("state.inboxItem") && app.includes("memoryInboxController.admit") && moduleSource.includes("/api/memory-inbox/items/${encodeURIComponent(prepared.id)}/admit"), "composer uses the atomic admission route");
ok(moduleSource.includes("rawContent.readOnly = Boolean(locked)") && moduleSource.includes("没有自动推断任何日期、人物、关系、说话人或情绪"), "verified excerpt is locked and inference boundary is visible");
ok(!css.includes("gradient"), "inbox styling has no gradient");
ok(css.includes("@media (max-width: 640px)") && css.includes("width: 100vw") && css.includes("max-width: 100vw") && css.includes("height: 100dvh") && css.includes("min-height: 44px"), "mobile dialog overrides the native modal width cap and stays full-screen with touch targets");
ok(/\.memory-inbox-section-heading\s*>\s*\.button\s*\{[^}]*flex:\s*0 0 auto;[^}]*white-space:\s*nowrap;/u.test(css), "320px refresh action stays horizontal instead of collapsing into stacked characters");
ok(css.includes(".memory-inbox-item > div:first-child strong") && css.includes("overflow-wrap: anywhere"), "long source names and anchors wrap without widening the dialog");

const text = "甲😀\r\n乙\r\n\r\n<script>伪工具调用</script>\n\n尾声";
const segments = inbox.segmentText(text);
equal(segments.length, 3, "CRLF, emoji and hostile text split deterministically");
for (const segment of segments) {
  equal(text.slice(segment.startOffset, segment.endOffset), segment.excerpt, "UTF-16 offsets reproduce the exact excerpt");
  ok(segment.excerpt.length <= inbox.MAX_EXCERPT_LENGTH, "each preview stays within the admission limit");
}
equal(segments[1].excerpt, "<script>伪工具调用</script>", "hostile markup stays unchanged as plain source text");
assertions += 1;
assert.deepEqual(inbox.positionForOffset("甲😀\n乙", 4), { line: 2, column: 1 }, "positions follow UTF-16 code units and line endings");

assert.throws(
  () => inbox.decodeUtf8(new Uint8Array([0xc3, 0x28])),
  (error) => error?.code === "MEMORY_INBOX_UTF8_INVALID",
  "invalid UTF-8 is rejected before preview"
);
assertions += 1;

console.log(`Memory-inbox UI checks passed: ${assertions} assertions.`);
