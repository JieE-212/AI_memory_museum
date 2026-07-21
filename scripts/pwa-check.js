"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const html = read("public/index.html");
const offline = read("public/offline.html");
const css = read("public/pwa.css");
const app = read("public/assets/pwa.js");
const worker = read("public/sw.js");
const server = read("server.js");
const staticAssetPolicy = read("lib/static-asset-policy.js");
const mediaApi = read("lib/media-api.js");
const manifest = JSON.parse(read("public/manifest.webmanifest"));
const vercel = JSON.parse(read("vercel.json"));
const pkg = JSON.parse(read("package.json"));
const pwa = require(path.join(root, "public", "assets", "pwa.js"));
let assertions = 0;

async function main() {
  equal(manifest.id, "/", "Manifest 使用稳定应用 ID");
  equal(manifest.start_url, "/#collection", "Manifest 从现有展品库入口启动");
  equal(manifest.scope, "/", "Manifest 作用域保持站点根目录");
  equal(manifest.display, "standalone", "PWA 使用独立窗口展示");
  equal(manifest.lang, "zh-CN", "Manifest 声明中文语言");
  equal(manifest.theme_color, "#f4f1ea", "Manifest 主题色沿用清爽纸张背景");
  check(!Object.hasOwn(manifest, "shortcuts"), "Manifest 不额外制造系统级功能导航");
  check(Array.isArray(manifest.icons) && manifest.icons.length === 2, "Manifest 只声明必要的普通与 maskable 图标");
  check(manifest.icons.some((icon) => icon.sizes === "192x192" && icon.purpose === "any"), "Manifest 包含 192 像素普通图标");
  check(manifest.icons.some((icon) => icon.sizes === "512x512" && icon.purpose === "maskable"), "Manifest 包含 512 像素 maskable 图标");
  deepEqual(pngSize("public/assets/time-isle-192.png"), { width: 192, height: 192 }, "192 图标具有真实 PNG 尺寸");
  deepEqual(pngSize("public/assets/time-isle-512.png"), { width: 512, height: 512 }, "512 图标具有真实 PNG 尺寸");
  deepEqual(pngSize("public/assets/time-isle-apple-touch.png"), { width: 180, height: 180 }, "Apple 图标具有真实 PNG 尺寸");

  check(html.includes(`rel="manifest" href="/manifest.webmanifest?v=${pkg.version}"`), "页面声明带版本的 Manifest");
  check(html.includes('rel="apple-touch-icon" href="/assets/time-isle-apple-touch.png"'), "页面声明 Apple 主屏图标");
  check((html.match(/class="nav-button/g) || []).length === 4, "PWA 仍严格保持四项主导航");
  const dataStart = html.indexOf('data-view-panel="data"');
  const installStart = html.indexOf('id="pwaInstallPanel"');
  const appScript = html.indexOf(`/assets/pwa.js?v=${pkg.version}`);
  check(dataStart >= 0 && installStart > dataStart && installStart < html.indexOf("</main>"), "安装入口只位于数据与项目页");
  check(/<details class="pwa-install-panel" id="pwaInstallPanel" hidden>/u.test(html), "安装入口默认隐藏且渐进披露");
  check(html.includes('id="pwaInstallStatus" role="status" aria-live="polite" aria-atomic="true"'), "安装状态通过单一 live region 宣告");
  check(appScript > html.indexOf(`/assets/capsules.js?v=${pkg.version}`) && appScript < html.indexOf(`/assets/app.js?v=${pkg.version}`), "PWA 模块独立且在主应用前载入");

  check(css.includes("min-height: 44px;") && css.includes("min-height: 52px;"), "安装入口保持触控边界");
  check(css.includes("@media (display-mode: standalone)") && ["safe-area-inset-top", "safe-area-inset-right", "safe-area-inset-left"].every((token) => css.includes(token)), "standalone 平板布局覆盖顶部与横向安全区");
  check(css.includes("@media (max-width: 390px)") && css.includes("width: 100%;"), "窄屏安装按钮占满可用宽度");
  check(css.includes("@media (prefers-reduced-motion: reduce)") && !/gradient\s*\(/iu.test(css), "PWA 样式尊重减少动态且不使用渐变");

  ["createInstallController", "isTrustedInstallOrigin", "isStandaloneMode", "manualInstallMessage", "isIosLike"].forEach((name) => {
    check(typeof pwa[name] === "function", `PWA 模块导出 ${name}`);
  });
  check(pwa.isTrustedInstallOrigin({ protocol: "https:", hostname: "demo.example" }), "HTTPS 允许安装");
  check(pwa.isTrustedInstallOrigin({ protocol: "http:", hostname: "127.0.0.1" }), "本机回环 HTTP 允许安装");
  check(!pwa.isTrustedInstallOrigin({ protocol: "http:", hostname: "192.168.1.2" }), "局域网明文 HTTP 不冒充安全安装来源");
  check(!/localStorage|sessionStorage|indexedDB|\bcaches\b/iu.test(app), "安装控制器不持久化私人或安装状态");
  check(app.indexOf("async function handleInstallClick") < app.indexOf("await prompt.prompt()"), "安装提示只在用户点击处理器内调用");
  check(app.includes('updateViaCache: "none"') && app.includes('register("/sw.js"'), "Service Worker 固定根地址且更新绕过 HTTP 缓存");

  await checkChromiumInstallFlow();
  checkIosManualFlow();
  checkUnsupportedOriginFlow();
  checkStandaloneFlow();

  const shellBlock = /const SHELL_ASSETS = Object\.freeze\(\[([\s\S]*?)\]\);/u.exec(worker)?.[1] || "";
  check(shellBlock.includes("OFFLINE_URL") && shellBlock.includes(`"/pwa.css?v=${pkg.version}"`), "Service Worker 只预缓存离线边界壳");
  check(!/index\.html|assets\/app|manifest\.webmanifest|\/api\//u.test(shellBlock), "预缓存白名单不含主应用、Manifest 或 API");
  check(worker.includes('request.mode === "navigate"') && worker.includes("fetch(request).catch(() => caches.match(OFFLINE_URL))"), "断网导航明确回退独立离线页");
  check(worker.includes('request.method !== "GET"') && worker.includes("url.origin !== self.location.origin"), "写请求与跨源请求完全旁路");
  check(worker.includes("PRIVATE_PATH_PREFIXES") && worker.includes('"/api/"'), "API 与媒体声音接口显式旁路");
  check(worker.includes("CACHEABLE_PATHS.has") && !worker.includes("cache.put") && !worker.includes("skipWaiting") && !worker.includes("clients.claim"), "Service Worker 不动态缓存响应也不强制接管旧页面");
  check(worker.includes("name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME"), "升级只清理自身前缀的旧缓存");
  await checkWorkerRuntime();

  check(!/<script\b/iu.test(offline) && !/localStorage|sessionStorage|indexedDB/iu.test(offline), "离线页不运行脚本或读取持久存储");
  check(offline.includes("不会展示馆藏、照片、声音或导出内容"), "离线页明确说明私人数据不进入缓存");
  check(!/https?:\/\//iu.test(offline), "离线页不依赖第三方网络资源");

  check(staticAssetPolicy.includes('".webmanifest": "application/manifest+json; charset=utf-8"'), "本地服务返回正确 Manifest 类型");
  check(staticAssetPolicy.includes('["index.html", "sw.js", "manifest.webmanifest"].includes(fileName)'), "本地服务禁止缓存 Worker 与 Manifest");
  check(staticAssetPolicy.includes('serviceWorkerAllowed: fileName === "sw.js"') && server.includes('response.setHeader("Service-Worker-Allowed", "/")'), "本地服务显式允许根作用域");
  check(server.includes("worker-src 'self'; manifest-src 'self'"), "本地 CSP 显式限制 Worker 与 Manifest 来源");
  check(mediaApi.includes('response.setHeader("Cache-Control", "private, no-store")') && !mediaApi.includes("immutable"), "所有私人图片变体统一禁用浏览器缓存");
  const swHeaders = vercel.headers.find((entry) => entry.source === "/sw.js")?.headers || [];
  check(swHeaders.some((header) => header.key === "Cache-Control" && header.value.includes("no-store")), "Vercel 禁止缓存 Service Worker");
  check(swHeaders.some((header) => header.key === "Service-Worker-Allowed" && header.value === "/"), "Vercel Worker 作用域固定为根目录");

  console.log(`PWA checks passed: ${assertions} assertions.`);
}

async function checkChromiumInstallFlow() {
  const harness = createHarness();
  const controller = pwa.createInstallController(harness.options);
  await Promise.resolve();
  await Promise.resolve();
  equal(harness.registerCalls.length, 1, "安全来源只注册一次 Service Worker");
  deepEqual(harness.registerCalls[0], { url: "/sw.js", options: { scope: "/", updateViaCache: "none" } }, "注册参数固定且可审计");
  check(harness.elements.panel.hidden, "收到浏览器安装资格前入口不闪烁");
  let prevented = 0;
  let prompted = 0;
  await harness.window.dispatch("beforeinstallprompt", {
    preventDefault: () => { prevented += 1; },
    prompt: async () => { prompted += 1; },
    userChoice: Promise.resolve({ outcome: "accepted" })
  });
  equal(prevented, 1, "安装资格事件被保存而不自动弹窗");
  check(!harness.elements.panel.hidden && !harness.elements.button.hidden, "Chromium 可安装时才显示入口和按钮");
  equal(prompted, 0, "未点击按钮前绝不调用安装提示");
  await harness.elements.button.dispatch("click");
  equal(prompted, 1, "用户点击后只调用一次安装提示");
  check(harness.elements.button.hidden && harness.elements.status.textContent.includes("正在完成安装"), "接受后收起已消费按钮并反馈状态");
  await harness.window.dispatch("appinstalled");
  equal(harness.elements.state.textContent, "已安装", "安装完成后呈现已安装状态");
  controller.destroy();
}

function checkIosManualFlow() {
  const harness = createHarness({ userAgent: "iPhone", platform: "iPhone" });
  const controller = pwa.createInstallController(harness.options);
  check(!harness.elements.panel.hidden && harness.elements.button.hidden && !harness.elements.instructions.hidden, "iOS 只展示手动添加步骤而不伪造安装按钮");
  equal(harness.elements.state.textContent, "手动添加", "iOS 状态标签准确");
  controller.destroy();
}

function checkUnsupportedOriginFlow() {
  const harness = createHarness({ location: { protocol: "http:", hostname: "192.168.1.2" } });
  const controller = pwa.createInstallController(harness.options);
  check(harness.elements.panel.hidden && harness.registerCalls.length === 0, "不安全来源静默隐藏入口且不注册 Worker");
  controller.destroy();
}

function checkStandaloneFlow() {
  const harness = createHarness({ standalone: true });
  const controller = pwa.createInstallController(harness.options);
  check(!harness.elements.panel.hidden && harness.elements.button.hidden, "standalone 模式展示已安装说明而不再显示按钮");
  equal(harness.elements.state.textContent, "已安装", "standalone 状态准确");
  controller.destroy();
}

async function checkWorkerRuntime() {
  const listeners = new Map();
  const addedAssets = [];
  const deletedCaches = [];
  const matched = [];
  const fetches = [];
  const cachesApi = {
    open: async () => ({ addAll: async (assets) => { addedAssets.push(...assets); } }),
    keys: async () => ["unrelated-cache", "time-isle-public-shell-v7.0.0", "time-isle-public-shell-v7.2.0", "time-isle-public-shell-v7.3.0", "time-isle-public-shell-v8.0.0", "time-isle-public-shell-v9.0.0", "time-isle-public-shell-v10.0.0", `time-isle-public-shell-v${pkg.version}`],
    delete: async (name) => { deletedCaches.push(name); return true; },
    match: async (input) => {
      const pathname = typeof input === "string" ? input : new URL(input.url).pathname;
      matched.push(pathname);
      if (pathname === "/offline.html") return "offline-response";
      if (pathname === "/pwa.css") return "cached-pwa-css";
      return undefined;
    }
  };
  const self = {
    location: { origin: "https://demo.example" },
    addEventListener: (type, handler) => { listeners.set(type, handler); }
  };
  const fetchImpl = async (request) => {
    fetches.push(request.url);
    if (request.mode === "navigate") throw new Error("offline");
    return "network-response";
  };
  vm.runInNewContext(worker, { self, caches: cachesApi, fetch: fetchImpl, URL, Set, Object, Promise }, { filename: "public/sw.js" });

  let installWork;
  listeners.get("install")({ waitUntil: (promise) => { installWork = promise; } });
  await installWork;
  deepEqual(addedAssets, ["/offline.html", `/pwa.css?v=${pkg.version}`, "/assets/time-isle-icon.svg"], "Worker 安装只写入三项公开离线壳资源");

  let activateWork;
  listeners.get("activate")({ waitUntil: (promise) => { activateWork = promise; } });
  await activateWork;
  deepEqual(deletedCaches, ["time-isle-public-shell-v7.0.0", "time-isle-public-shell-v7.2.0", "time-isle-public-shell-v7.3.0", "time-isle-public-shell-v8.0.0", "time-isle-public-shell-v9.0.0", "time-isle-public-shell-v10.0.0"], "Worker 激活只删除自身旧版本缓存");

  const offlineNavigation = await dispatchWorkerFetch(listeners, { method: "GET", mode: "navigate", url: "https://demo.example/#collection" });
  equal(await offlineNavigation, "offline-response", "断网导航返回独立离线页");
  check(matched.includes("/offline.html"), "断网导航只读取离线页缓存");
  equal(await dispatchWorkerFetch(listeners, { method: "GET", mode: "cors", url: "https://demo.example/api/memories" }), undefined, "API GET 完全旁路 Worker");
  equal(await dispatchWorkerFetch(listeners, { method: "POST", mode: "cors", url: "https://demo.example/api/memories" }), undefined, "写请求完全旁路 Worker");
  equal(await dispatchWorkerFetch(listeners, { method: "GET", mode: "cors", url: "https://cdn.example/photo.webp" }), undefined, "跨源媒体完全旁路 Worker");
  equal(await dispatchWorkerFetch(listeners, { method: "GET", mode: "cors", url: "https://demo.example/assets/app.js" }), undefined, "主应用脚本不进入离线缓存策略");
  equal(await dispatchWorkerFetch(listeners, { method: "GET", mode: "cors", url: `https://demo.example/pwa.css?v=${pkg.version}` }), "cached-pwa-css", "唯一公开壳样式可从缓存读取");
  equal(fetches.length, 1, "只有导航尝试网络；旁路请求由浏览器默认处理");
}

function dispatchWorkerFetch(listeners, request) {
  let response;
  listeners.get("fetch")({ request, respondWith: (value) => { response = value; } });
  return response;
}

function createHarness(overrides = {}) {
  const elements = {
    panel: target({ hidden: true }),
    button: target({ hidden: true, disabled: false, textContent: "安装到此设备" }),
    status: target({ textContent: "", dataset: {} }),
    state: target({ textContent: "可安装" }),
    hint: target({ textContent: "" }),
    instructions: target({ hidden: true })
  };
  const ids = new Map([
    ["pwaInstallPanel", elements.panel], ["pwaInstallButton", elements.button],
    ["pwaInstallStatus", elements.status], ["pwaInstallState", elements.state],
    ["pwaInstallHint", elements.hint], ["pwaInstallInstructions", elements.instructions]
  ]);
  const registerCalls = [];
  const registration = target({ waiting: null, installing: null });
  const serviceWorker = target({
    controller: {},
    register: async (url, options) => {
      registerCalls.push({ url, options });
      return registration;
    }
  });
  const navigator = {
    serviceWorker,
    standalone: false,
    userAgent: overrides.userAgent || "Chromium",
    platform: overrides.platform || "Win32",
    maxTouchPoints: overrides.maxTouchPoints || 0
  };
  const window = target({
    navigator,
    location: overrides.location || { protocol: "https:", hostname: "demo.example" },
    matchMedia: () => ({ matches: Boolean(overrides.standalone) })
  });
  const document = { getElementById: (id) => ids.get(id) || null };
  return { elements, registerCalls, window, options: { window, document, navigator, location: window.location } };
}

function target(properties = {}) {
  const listeners = new Map();
  return Object.assign({
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(handler);
    },
    removeEventListener(type, handler) {
      listeners.get(type)?.delete(handler);
    },
    async dispatch(type, event = {}) {
      for (const handler of listeners.get(type) || []) await handler(event);
    }
  }, properties);
}

function pngSize(relativePath) {
  const bytes = fs.readFileSync(path.join(root, relativePath));
  check(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), `${relativePath} 是真实 PNG`);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function check(condition, message) {
  assertions += 1;
  if (!condition) throw new Error(message);
}

function equal(actual, expected, message) {
  check(actual === expected, `${message}；实际 ${JSON.stringify(actual)}`);
}

function deepEqual(actual, expected, message) {
  check(JSON.stringify(actual) === JSON.stringify(expected), `${message}；实际 ${JSON.stringify(actual)}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
