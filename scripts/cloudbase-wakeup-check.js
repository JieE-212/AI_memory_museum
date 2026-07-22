"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const wakeupRoot = path.join(root, "deploy", "cloudbase", "wakeup");
const html = read("deploy/cloudbase/wakeup/index.html");
const css = read("deploy/cloudbase/wakeup/wakeup.css");
const script = read("deploy/cloudbase/wakeup/wakeup.js");
const robots = read("deploy/cloudbase/wakeup/robots.txt");
const guide = read("deploy/cloudbase/README.md");
const { DEFAULT_CONFIG, createWakeupController } = require(path.join(wakeupRoot, "wakeup.js"));
const PRIMARY_ORIGIN = "https://shiyu-memory-demo-d3di282387d5c7-1456049152.ap-shanghai.app.tcloudbase.com";
const PRIMARY_URL = `${PRIMARY_ORIGIN}/#reflect`;
const FALLBACK_URL = "https://ai-memory-museum-demo.vercel.app/#reflect";
let assertions = 0;

check("wakeup package contains only four reviewed static files", canonical(fs.readdirSync(wakeupRoot).sort()) === canonical(["index.html", "robots.txt", "wakeup.css", "wakeup.js"]));
check("wakeup page declares a narrow noindex document", html.includes('<html lang="zh-CN">') && html.includes('name="robots" content="noindex, nofollow, noarchive"') && robots.trim() === "User-agent: *\nDisallow: /");
check("wakeup page uses only local external CSS and JavaScript", html.includes('href="./wakeup.css?v=1"') && html.includes('src="./wakeup.js?v=1"') && !/<style\b/iu.test(html) && !/<script(?![^>]*\bsrc=)[^>]*>/iu.test(html) && !/\sstyle\s*=/iu.test(html) && !/\son[a-z]+\s*=/iu.test(html));
check("wakeup page has no input, form, iframe or automatic navigation", !/<(?:input|form|iframe)\b/iu.test(html) && !/http-equiv="refresh"/iu.test(html) && !/rel="(?:preload|prefetch|preconnect)"/iu.test(html));
check("wakeup page exposes one polite atomic status and explicit actions", (html.match(/role="status"/gu) || []).length === 1 && html.includes('aria-live="polite"') && html.includes('aria-atomic="true"') && html.includes('id="wakeupButton"') && html.includes('id="directLink"') && html.includes('id="fallbackLink"'));
check("wakeup page fixes the primary and fallback destinations", html.includes(`href="${PRIMARY_URL}"`) && html.includes(`href="${FALLBACK_URL}"`) && (html.match(/rel="noreferrer"/gu) || []).length === 2);
check("wakeup CSP permits only the fixed image probe origin", html.includes("default-src 'none'") && html.includes("script-src 'self'") && html.includes("style-src 'self'") && html.includes(`img-src ${PRIMARY_ORIGIN}`) && html.includes("connect-src 'none'") && html.includes("form-action 'none'") && !html.includes("unsafe-inline") && !html.includes("unsafe-eval") && !html.includes("*;"));
check("wakeup copy discloses resource and privacy boundaries", html.includes("最小实例为 0") && html.includes("最多进行 3 次") && html.includes("不会保存浏览记录") && html.includes("请勿输入真实姓名") && html.includes("Vercel 备用入口"));
check("CloudBase guide keeps the static and container origins separate", guide.includes("time-isle-wakeup-002") && guide.includes("独立 hostname") && guide.includes("不修改云托管根路由") && guide.includes("最多请求 3 次") && guide.includes("国内简历入口候选"));
check("wakeup CSS stays clean, responsive and motion-aware", !/gradient\s*\(/iu.test(css) && !/@import/iu.test(css) && css.includes("min-width: 320px") && css.includes("min-height: 48px") && css.includes("@media (max-width: 600px)") && css.includes("@media (prefers-reduced-motion: reduce)") && css.includes("env(safe-area-inset-bottom)") && css.includes(":focus-visible"));

check("wakeup configuration is fixed and bounded", DEFAULT_CONFIG.primaryUrl === PRIMARY_URL && DEFAULT_CONFIG.fallbackUrl === FALLBACK_URL && DEFAULT_CONFIG.probeUrl === `${PRIMARY_ORIGIN}/assets/time-isle-192.png` && canonical(DEFAULT_CONFIG.attemptDelaysMs) === canonical([0, 2200, 4800]) && DEFAULT_CONFIG.probeTimeoutMs === 7000 && DEFAULT_CONFIG.expectedWidth === 192 && DEFAULT_CONFIG.expectedHeight === 192);
check("wakeup source avoids keepalive, storage and telemetry channels", !/(?:setInterval|WebSocket|EventSource|sendBeacon|fetch\s*\(|XMLHttpRequest|serviceWorker|localStorage|sessionStorage|indexedDB|caches\.)/u.test(script));
check("wakeup source does not derive targets from visitor-controlled state", !/(?:location\.(?:search|hash)|URLSearchParams|document\.cookie|message\s*\(|postMessage)/u.test(script) && script.includes('referrerPolicy = "no-referrer"') && !script.includes("crossOrigin"));

const successHarness = createHarness();
check("wakeup does not probe before explicit start", successHarness.images.length === 0 && successHarness.timers.pending() === 0);
check("first start schedules one finite round and busy-locks repeats", successHarness.controller.start() === true && successHarness.controller.start() === false && successHarness.timers.pending() === 1);
successHarness.timers.runNext();
check("first attempt uses the fixed cache-busted PNG without requiring CORS", successHarness.images.length === 1 && /^https:\/\/shiyu-memory-demo[^?]+\/assets\/time-isle-192\.png\?wake=1000-1$/u.test(successHarness.images[0].src) && successHarness.images[0].referrerPolicy === "no-referrer" && successHarness.images[0].crossOrigin === undefined);
const firstFailure = successHarness.images[0].onerror;
firstFailure();
successHarness.timers.runNext();
check("a failed image schedules only the next bounded attempt", successHarness.images.length === 2 && successHarness.controller.getAttemptCount() === 2);
successHarness.images[1].naturalWidth = 192;
successHarness.images[1].naturalHeight = 192;
const secondSuccess = successHarness.images[1].onload;
secondSuccess();
check("valid 192 by 192 image enters ready state without immediate navigation", successHarness.elements.body.dataset.wakeupState === "ready" && successHarness.navigations.length === 0 && successHarness.timers.pending() === 1);
successHarness.timers.runNext();
check("ready state replaces the page with the fixed CloudBase destination once", canonical(successHarness.navigations) === canonical([PRIMARY_URL]) && successHarness.timers.pending() === 0);

const wrongSizeHarness = createHarness({ attemptDelaysMs: [0] });
wrongSizeHarness.controller.start();
wrongSizeHarness.timers.runNext();
wrongSizeHarness.images[0].naturalWidth = 1;
wrongSizeHarness.images[0].naturalHeight = 1;
const wrongSizeLoad = wrongSizeHarness.images[0].onload;
wrongSizeLoad();
check("wrong-size responses cannot masquerade as a ready museum", wrongSizeHarness.navigations.length === 0 && wrongSizeHarness.elements.body.dataset.wakeupState === "unavailable" && wrongSizeHarness.timers.pending() === 0);

const failureHarness = createHarness({ attemptDelaysMs: [0, 1, 1] });
failureHarness.controller.start();
for (let index = 0; index < 3; index += 1) {
  failureHarness.timers.runNext();
  const reject = failureHarness.images[index].onerror;
  reject();
}
check("three failures stop permanently and expose a manual retry", failureHarness.images.length === 3 && failureHarness.elements.body.dataset.wakeupState === "unavailable" && failureHarness.elements.button.disabled === false && failureHarness.elements.button.textContent === "再次唤醒" && failureHarness.timers.pending() === 0);
check("failed round never navigates or starts a hidden heartbeat", failureHarness.navigations.length === 0 && failureHarness.timers.runAll() === 0 && failureHarness.images.length === 3);
check("manual retry starts a fresh but still bounded round", failureHarness.controller.start() === true && failureHarness.timers.pending() === 1 && failureHarness.controller.getAttemptCount() === 0);

const cancelHarness = createHarness();
cancelHarness.controller.start();
cancelHarness.timers.runNext();
const staleLoad = cancelHarness.images[0].onload;
cancelHarness.controller.stop({ reset: false });
staleLoad();
cancelHarness.controller.stop();
check("cancellation isolates late results and BFCache return resets the interface", cancelHarness.timers.pending() === 0 && cancelHarness.navigations.length === 0 && cancelHarness.controller.isRunning() === false && cancelHarness.elements.body.dataset.wakeupState === "idle" && cancelHarness.elements.button.disabled === false && script.includes('scope.addEventListener("pageshow"') && script.includes("event.persisted"));

console.log(`CloudBase wakeup checks passed: ${assertions} assertions.`);

function createHarness(config = {}) {
  const timers = createFakeTimers();
  const images = [];
  const navigations = [];
  class FakeImage {
    constructor() {
      this.onload = null;
      this.onerror = null;
      this.naturalWidth = 0;
      this.naturalHeight = 0;
      this.referrerPolicy = "";
      this.decoding = "";
      this.src = "";
      images.push(this);
    }
  }
  const elements = createElements();
  const controller = createWakeupController({
    elements,
    ImageCtor: FakeImage,
    setTimeoutFn: timers.setTimeout,
    clearTimeoutFn: timers.clearTimeout,
    nowFn: () => 1000,
    navigate: (url) => navigations.push(url),
    config
  });
  return { controller, elements, images, navigations, timers };
}

function createElements() {
  return {
    body: { dataset: {} },
    statusPanel: element(),
    statusTitle: element(),
    statusDetail: element(),
    progress: element(),
    button: element({ disabled: false })
  };
}

function element(initial = {}) {
  return {
    textContent: "",
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = String(value); },
    ...initial
  };
}

function createFakeTimers() {
  let nextId = 1;
  const queue = [];
  const cancelled = new Set();
  function setTimeout(callback, delay) {
    const timer = { id: nextId, callback, delay: Number(delay) || 0 };
    nextId += 1;
    queue.push(timer);
    return timer.id;
  }
  function clearTimeout(id) { cancelled.add(id); }
  function pendingItems() { return queue.filter((item) => !cancelled.has(item.id)); }
  function runNext() {
    const pending = pendingItems().sort((left, right) => left.delay - right.delay || left.id - right.id);
    if (!pending.length) return false;
    const next = pending[0];
    cancelled.add(next.id);
    next.callback();
    return true;
  }
  function runAll(limit = 50) {
    let count = 0;
    while (count < limit && runNext()) count += 1;
    return count;
  }
  return { setTimeout, clearTimeout, pending: () => pendingItems().length, runNext, runAll };
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8").replace(/\r\n/gu, "\n");
}

function canonical(value) { return JSON.stringify(value); }

function check(name, condition) {
  assertions += 1;
  if (!condition) throw new Error(`not ok - ${name}`);
  console.log(`ok - ${name}`);
}
