"use strict";

const path = require("node:path");

require(path.join(__dirname, "..", "public", "assets", "voice-capture.js"));

const captureModule = globalThis.TimeIsleVoiceCapture;
let assertions = 0;

async function main() {
  check(captureModule && typeof captureModule === "object", "单段声音采集模块可独立加载");
  ["createController", "normalizePolicy", "preferredRecorderMime", "validateFile", "formatDuration"].forEach((name) => {
    check(typeof captureModule[name] === "function", `单段声音采集模块导出 ${name}`);
  });
  equal(captureModule.formatDuration(61_900), "01:01", "时长使用稳定分秒格式");
  check(captureModule.validateFile(namedBlob(8, "bad.wav", "audio/wav")).includes("仅支持"), "客户端拒绝非白名单声音");

  let demoMicrophoneCalls = 0;
  const demo = createHarness({
    demo: true,
    secure: true,
    MediaRecorder: SupportedRecorder,
    navigator: { mediaDevices: { getUserMedia: async () => { demoMicrophoneCalls += 1; throw new Error("不应调用"); } } }
  });
  check(demo.elements.fileInput.disabled, "Demo 真实禁用文件输入");
  check(demo.elements.recordButton.disabled, "Demo 禁用录音入口");
  await demo.elements.recordButton.dispatch("click");
  equal(demoMicrophoneCalls, 0, "Demo 不调用 getUserMedia");
  await rejects(() => demo.controller.addFile(namedBlob(8, "demo.webm", "audio/webm")), "公开 Demo", "Demo 程序化调用也零上传");
  equal(demo.requests.length, 0, "Demo 没有任何声音请求");

  const insecure = createHarness({ secure: false, MediaRecorder: SupportedRecorder });
  check(insecure.elements.recordButton.disabled, "非安全上下文禁用录音");
  check(!insecure.elements.fileInput.disabled, "非安全上下文仍可选择本地音频");
  check(insecure.elements.help.textContent.includes("仍可选择"), "无麦克风能力时提供文件降级说明");

  let resolvePermission;
  let lateTrackStops = 0;
  const permission = createHarness({
    secure: true,
    MediaRecorder: SupportedRecorder,
    navigator: { mediaDevices: { getUserMedia: () => new Promise((resolve) => { resolvePermission = resolve; }) } }
  });
  const pending = permission.elements.recordButton.dispatch("click");
  await Promise.resolve();
  equal(permission.elements.recordButton.textContent, "取消授权等待", "授权等待时主按钮可显式取消");
  equal(permission.elements.recordButton.getAttribute("aria-busy"), "true", "授权等待向辅助技术暴露 busy");
  await permission.elements.recordButton.dispatch("click");
  check(!permission.controller.getState().awaitingPermission, "取消后立即清理权限等待状态");
  resolvePermission({ getTracks: () => [{ stop: () => { lateTrackStops += 1; } }] });
  await pending;
  equal(lateTrackStops, 1, "已取消会话的迟到麦克风流立即关闭");
  check(!permission.controller.getState().recording, "迟到麦克风流不会重启录音");

  const upload = createHarness({ secure: false });
  await upload.controller.addFile(namedBlob(64, "answer.webm", "audio/webm"));
  const ready = upload.controller.getState();
  check(ready.ready && ready.assetId === "voice-ready", "声音上传后进入可选段状态");
  equal(ready.durationMs, 12_300, "时长以服务端验证结果为准");
  check(upload.elements.audio.src.includes("/api/voice/assets/voice-ready/content"), "上传后使用私有声音端点试听");
  upload.controller.reset({ cleanup: true });
  await flush();
  check(upload.requests.some((request) => request.method === "DELETE"), "放弃未关联声音时尝试清理孤儿资产");

  const retained = createHarness({ secure: false });
  await retained.controller.addFile(namedBlob(64, "retained.m4a", "audio/mp4"));
  retained.controller.markAttached();
  retained.controller.reset({ cleanup: true });
  await flush();
  check(!retained.requests.some((request) => request.method === "DELETE"), "已由口述史原子关联的声音不做孤儿删除");

  [demo, insecure, permission, upload, retained].forEach((item) => item.controller.destroy());
  console.log(`Voice capture UI checks passed: ${assertions} assertions.`);
}

function createHarness(options = {}) {
  const names = [
    "recordButton", "fileInput", "fileLabel", "help", "recording", "timer",
    "stopButton", "cancelButton", "audio", "status", "retryButton", "removeButton"
  ];
  const elements = Object.fromEntries(names.map((name) => [name, new FakeElement(name)]));
  const requests = [];
  const fetchImpl = options.fetch || (async (url, request = {}) => {
    const method = request.method || "GET";
    requests.push({ url, method, body: request.body });
    if (method === "DELETE") return responseJson({ ok: true });
    return responseJson({
      asset: {
        id: "voice-ready",
        durationMs: 12_300,
        mimeType: "audio/webm",
        originalName: "answer.webm",
        contentUrl: "/api/voice/assets/voice-ready/content"
      }
    }, 201);
  });
  const controller = captureModule.createController({
    elements,
    fetch: fetchImpl,
    demo: Boolean(options.demo),
    navigator: options.navigator || { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) } },
    MediaRecorder: options.MediaRecorder,
    isSecureContext: options.secure
  });
  return { controller, elements, requests };
}

class SupportedRecorder {
  static isTypeSupported(value) { return value === "audio/webm;codecs=opus"; }
}

class FakeElement {
  constructor(id) {
    this.id = id;
    this.hidden = false;
    this.disabled = false;
    this.value = "";
    this.files = [];
    this.textContent = "";
    this.dataset = {};
    this.attributes = new Map();
    this.listeners = new Map();
    this.classList = { toggle: () => {} };
    this.src = "";
    this.currentTime = 0;
  }
  addEventListener(type, handler) {
    const list = this.listeners.get(type) || [];
    list.push(handler);
    this.listeners.set(type, list);
  }
  removeEventListener(type, handler) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter((item) => item !== handler));
  }
  async dispatch(type, event = {}) {
    for (const handler of [...(this.listeners.get(type) || [])]) await handler({ target: this, preventDefault: () => {}, ...event });
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) || ""; }
  removeAttribute(name) { this.attributes.delete(name); if (name === "src") this.src = ""; }
  pause() {}
  load() {}
  async play() {}
}

function namedBlob(size, name, type) {
  const blob = new Blob([Buffer.alloc(size)], { type });
  Object.defineProperties(blob, { name: { value: name }, lastModified: { value: 1 } });
  return blob;
}

function responseJson(payload, status = 200, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => name.toLowerCase() === "content-type" ? "application/json" : headers[name] || "" },
    json: async () => payload,
    text: async () => JSON.stringify(payload)
  };
}

async function rejects(fn, includes, message) {
  try {
    await fn();
  } catch (error) {
    check(String(error.message).includes(includes), message);
    return;
  }
  throw new Error(`not ok - ${message}`);
}

async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
}

function check(condition, message) {
  assertions += 1;
  if (!condition) throw new Error(`not ok - ${message}`);
}

function equal(actual, expected, message) {
  check(actual === expected, `${message}\n  expected: ${JSON.stringify(expected)}\n  actual: ${JSON.stringify(actual)}`);
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
