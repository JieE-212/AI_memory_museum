"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { createLoader } = require("../public/assets/lazy-features");

const root = path.resolve(__dirname, "..");
const publicRoot = path.join(root, "public");
const frontendBudget = Object.freeze({
  rawJavaScriptBytes: 722 * 1024,
  compressedShellBytes: 275 * 1024,
  shellSubresources: 57
});

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  checkFrontendBudget();
  const harness = createHarness();
  const loader = createLoader({
    document: harness.document,
    location: { href: "http://127.0.0.1:3000/#collection" },
    version: "17.1.2",
    timeoutMs: 25
  });

  let ready = false;
  const first = loader.loadScript("/assets/curator-agent.js", () => ready);
  const concurrent = loader.loadScript("/assets/curator-agent.js", () => ready);
  assert.strictEqual(first, concurrent, "并发加载必须共享同一个 Promise");
  assert.equal(harness.scripts.length, 1, "并发加载只插入一段脚本");
  assert.equal(harness.scripts[0].src, "http://127.0.0.1:3000/assets/curator-agent.js?v=17.1.2");
  ready = true;
  harness.scripts[0].dispatch("load");
  await first;
  assert.strictEqual(loader.loadScript("/assets/curator-agent.js", () => ready), first, "成功资源继续复用缓存 Promise");

  const incomplete = loader.loadScript("/assets/oral-histories.js", () => false);
  harness.scripts.at(-1).dispatch("load");
  await assert.rejects(incomplete, /资源加载不完整：oral-histories\.js/u);
  assert.equal(harness.scripts.at(-1).removed, true, "注册不完整的脚本会被移除");
  const incompleteRetry = loader.loadScript("/assets/oral-histories.js", () => true);
  assert.equal(harness.scripts.length, 3, "注册不完整后允许重新插入脚本");
  harness.scripts.at(-1).dispatch("load");
  await incompleteRetry;

  const failed = loader.loadScript("/assets/capsules.js");
  harness.scripts.at(-1).dispatch("error");
  await assert.rejects(failed, /资源加载失败：capsules\.js/u);
  assert.equal(harness.scripts.at(-1).removed, true, "网络失败脚本会被移除");
  const failedRetry = loader.loadScript("/assets/capsules.js");
  harness.scripts.at(-1).dispatch("load");
  await failedRetry;

  const timedOut = loader.loadScript("/assets/share-privacy.js");
  await assert.rejects(timedOut, /资源加载超时：share-privacy\.js/u);
  assert.equal(harness.scripts.at(-1).removed, true, "超时脚本会被移除");
  const timeoutRetry = loader.loadScript("/assets/share-privacy.js");
  harness.scripts.at(-1).dispatch("load");
  await timeoutRetry;

  const control = createControl(true, "mixed");
  const restore = loader.markControlBusy(control);
  assert.equal(control.disabled, true);
  assert.equal(control.getAttribute("aria-busy"), "true");
  restore();
  assert.equal(control.disabled, true, "恢复控件原 disabled 状态");
  assert.equal(control.getAttribute("aria-busy"), "mixed", "恢复控件原 aria-busy 状态");

  const enabledControl = createControl(false, null);
  const restoreEnabled = loader.markControlBusy(enabledControl);
  restoreEnabled();
  assert.equal(enabledControl.disabled, false);
  assert.equal(enabledControl.getAttribute("aria-busy"), null);
  console.log("Lazy feature checks passed: dedupe, versioning, readiness, retry, timeout and busy restoration.");
}

function checkFrontendBudget() {
  const html = fs.readFileSync(path.join(publicRoot, "index.html"));
  const htmlText = html.toString("utf8");
  const stylesheetUrls = extractTagUrls(htmlText, "link", "href", (tag) =>
    /\brel\s*=\s*["']stylesheet["']/iu.test(tag)
  );
  const scriptUrls = extractTagUrls(htmlText, "script", "src");
  const shellUrls = [...stylesheetUrls, ...scriptUrls];

  assert.equal(
    new Set(shellUrls).size,
    shellUrls.length,
    "首屏 HTML 不应重复声明同一 CSS/JS 资源"
  );
  assert.ok(
    shellUrls.length <= frontendBudget.shellSubresources,
    "首屏 CSS/JS 资源数 " + shellUrls.length + " 超过 " + frontendBudget.shellSubresources
  );

  const assets = shellUrls.map(resolvePublicAsset);
  const javascriptAssets = assets.filter((asset) => /\.(?:m?js)$/iu.test(asset.relativePath));
  const rawJavaScriptBytes = sum(javascriptAssets.map((asset) => asset.source.length));
  assert.ok(
    rawJavaScriptBytes <= frontendBudget.rawJavaScriptBytes,
    "首屏 JavaScript 原始体积 " + formatKiB(rawJavaScriptBytes) + " 超过 " + formatKiB(frontendBudget.rawJavaScriptBytes)
  );

  const compressedShellBytes = gzipSize(html) + sum(assets.map((asset) => gzipSize(asset.source)));
  assert.ok(
    compressedShellBytes <= frontendBudget.compressedShellBytes,
    "首屏 HTML/CSS/JS 压缩体积 " + formatKiB(compressedShellBytes) + " 超过 " + formatKiB(frontendBudget.compressedShellBytes)
  );

  console.log([
    "Frontend budget checks passed:",
    javascriptAssets.length + " JS / " + formatKiB(rawJavaScriptBytes) + " raw",
    assets.length + " CSS+JS resources",
    formatKiB(compressedShellBytes) + " compressed HTML+CSS+JS"
  ].join(" "));
}

function extractTagUrls(source, tagName, attributeName, predicate = () => true) {
  const tagPattern = new RegExp("<" + tagName + "\\b[^>]*>", "giu");
  const attributePattern = new RegExp("\\b" + attributeName + "\\s*=\\s*[\"']([^\"']+)[\"']", "iu");
  const urls = [];
  for (const match of source.matchAll(tagPattern)) {
    if (!predicate(match[0])) continue;
    const attribute = attributePattern.exec(match[0]);
    if (!attribute) continue;
    urls.push(normalizeLocalUrl(attribute[1]));
  }
  return urls;
}

function normalizeLocalUrl(value) {
  assert.ok(value.startsWith("/"), "首屏资源必须使用可本地核验的站内绝对路径：" + value);
  const pathname = value.split(/[?#]/u, 1)[0];
  return decodeURIComponent(pathname);
}

function resolvePublicAsset(urlPath) {
  const relativePath = urlPath.replace(/^\/+/, "");
  const filePath = path.resolve(publicRoot, relativePath);
  assert.ok(
    filePath.startsWith(publicRoot + path.sep),
    "首屏资源路径越出 public 目录：" + urlPath
  );
  assert.ok(fs.statSync(filePath).isFile(), "首屏资源不存在：" + urlPath);
  return { relativePath, source: fs.readFileSync(filePath) };
}

function gzipSize(source) {
  return zlib.gzipSync(source, { level: zlib.constants.Z_BEST_SPEED }).length;
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function formatKiB(bytes) {
  return (bytes / 1024).toFixed(1) + " KiB";
}

function createHarness() {
  const scripts = [];
  const document = {
    head: { appendChild(script) { scripts.push(script); } },
    createElement(tagName) {
      assert.equal(tagName, "script");
      const listeners = new Map();
      return {
        dataset: {},
        removed: false,
        addEventListener(type, listener) { listeners.set(type, listener); },
        dispatch(type) { listeners.get(type)?.(); },
        remove() { this.removed = true; }
      };
    }
  };
  return { document, scripts };
}

function createControl(disabled, ariaBusy) {
  const attributes = new Map();
  if (ariaBusy !== null) attributes.set("aria-busy", ariaBusy);
  return {
    disabled,
    getAttribute(name) { return attributes.has(name) ? attributes.get(name) : null; },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    removeAttribute(name) { attributes.delete(name); }
  };
}
