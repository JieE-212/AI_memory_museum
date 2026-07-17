"use strict";

const path = require("node:path");

require(path.join(__dirname, "..", "public", "assets", "voice.js"));

const voice = globalThis.TimeIsleVoice;
let assertions = 0;

async function main() {
  check(voice && typeof voice === "object", "声音模块应可独立加载");
  ["createController", "renderCardSummary", "renderDetailVoices", "preferredRecorderMime", "normalizePolicy"].forEach((name) => {
    check(typeof voice[name] === "function", `模块应暴露 ${name}`);
  });

  const recorder = class FakeRecorder {};
  recorder.isTypeSupported = (mime) => mime === "audio/webm;codecs=opus";
  equal(voice.preferredRecorderMime(recorder), "audio/webm;codecs=opus", "应优先协商 WebM/Opus");
  const mp4Recorder = class FakeMp4Recorder {};
  mp4Recorder.isTypeSupported = (mime) => mime === "audio/mp4;codecs=mp4a.40.2";
  equal(voice.preferredRecorderMime(mp4Recorder), "audio/mp4;codecs=mp4a.40.2", "WebM 不可用时应协商 MP4/AAC");
  equal(voice.preferredRecorderMime(class UnsupportedRecorder {}), "", "缺少能力声明时不应冒险录音");

  const bounded = voice.normalizePolicy({ maxBytes: 99, maxDurationMs: 999_999, maxVoicesPerMemory: 99, acceptedMimeTypes: ["audio/mp4", "audio/wav"] });
  equal(bounded.maxBytes, 99, "大小策略应可由服务端收紧");
  equal(bounded.maxDurationMs, 180_000, "时长不得突破三分钟上限");
  equal(bounded.maxVoicesPerMemory, 3, "段数不得突破三段上限");
  deepEqual(bounded.acceptedMimeTypes, ["audio/mp4"], "只保留受支持的 MIME");

  const card = voice.renderCardSummary({ voiceSummary: { count: 3 } });
  check(card.includes("3 段声音"), "卡片应显示紧凑声音计数");
  equal(voice.renderCardSummary({ voices: [] }), "", "无声音时不应留下空徽标");
  const apiConfirmedVoice = makeVoice("", "", "窗边的雨");
  apiConfirmedVoice.transcript = { confirmed: true, text: "人工确认后展示" };
  const detail = voice.renderDetailVoices({ voices: [apiConfirmedVoice, makeVoice("draft", "草稿不得展示", "旧录音")] });
  check(detail.includes("<audio controls"), "详情应使用原生 audio 控件");
  check(detail.includes("窗边的雨"), "详情应展示用户标签");
  check(detail.includes("人工确认后展示"), "详情应展示 confirmed 文字稿");
  check(!detail.includes("草稿不得展示"), "详情不得泄漏 draft 文字稿");
  check(!detail.includes("status=\"draft\""), "详情不得暴露草稿状态");

  let microphoneCalls = 0;
  const demoHarness = createHarness({
    demo: true,
    secure: true,
    MediaRecorder: recorder,
    navigator: { mediaDevices: { getUserMedia: async () => { microphoneCalls += 1; throw new Error("不应调用"); } } }
  });
  const demoController = demoHarness.controller;
  check(demoHarness.elements.voiceRecordButton.hidden, "Demo 应隐藏录音入口");
  check(demoHarness.elements.voiceFileInput.disabled, "Demo 应禁用文件输入");
  check(demoHarness.elements.voiceFallbackHelp.textContent.includes("不会请求麦克风权限"), "Demo 应解释零麦克风行为");
  demoHarness.elements.voiceRecordButton.dispatch("click", { target: demoHarness.elements.voiceRecordButton });
  equal(microphoneCalls, 0, "Demo 点击录音也不得调用 getUserMedia");
  await rejects(() => demoController.saveToMemory("memory-demo"), "公开 Demo", "Demo 应阻止全部声音写入");
  equal(demoHarness.requests.length, 0, "Demo 阻止操作时不应发起请求");

  const insecureHarness = createHarness({ demo: false, secure: false, MediaRecorder: recorder });
  check(insecureHarness.elements.voiceRecordButton.hidden, "非安全上下文应隐藏录音入口");
  check(!insecureHarness.elements.voiceFileInput.disabled, "非安全上下文仍应允许选择文件");
  check(insecureHarness.elements.voiceFallbackHelp.textContent.includes("仍可选择"), "降级提示应保留上传解释");

  let rejectMicrophonePermission;
  const permissionHarness = createHarness({
    demo: false,
    secure: true,
    MediaRecorder: recorder,
    navigator: {
      mediaDevices: {
        getUserMedia: () => new Promise((resolve, reject) => { rejectMicrophonePermission = reject; })
      }
    }
  });
  const permissionAttempt = permissionHarness.elements.voiceRecordButton.dispatch("click", { target: permissionHarness.elements.voiceRecordButton });
  await Promise.resolve();
  check(!permissionHarness.elements.voiceRecordButton.disabled, "等待麦克风授权时应保留可见取消入口");
  equal(permissionHarness.elements.voiceRecordButton.textContent, "取消授权等待", "授权等待状态应直接显示在主按钮上");
  equal(permissionHarness.elements.voiceRecordButton.getAttribute("aria-busy"), "true", "授权等待状态应向辅助技术暴露忙碌语义");
  check(permissionHarness.elements.voiceFileInput.disabled, "等待授权时不应并发打开音频选择");
  check(permissionHarness.controller.getState().awaitingPermission, "控制器状态应显式暴露授权等待");
  check(permissionHarness.controller.getState().busy && !permissionHarness.controller.getState().ready, "授权等待期间不得被视为附件已就绪");
  await rejects(() => permissionHarness.controller.waitForReady(), "仍在等待麦克风授权", "授权等待期间应阻止保存流程");
  const deniedPermission = new Error("Permission denied");
  deniedPermission.name = "NotAllowedError";
  rejectMicrophonePermission(deniedPermission);
  await permissionAttempt;
  check(!permissionHarness.elements.voiceRecordButton.disabled, "授权拒绝后应恢复录音入口");
  equal(permissionHarness.elements.voiceRecordButton.textContent, "开始录音", "授权结束后应恢复按钮文案");
  check(permissionHarness.elements.voiceStatus.textContent.includes("未获得麦克风权限"), "授权拒绝应提供可见中文降级说明");
  check(!permissionHarness.controller.getState().awaitingPermission, "授权结束后不应残留等待状态");

  let resolveCancelledPermission;
  let cancelledPermissionCalls = 0;
  let lateTrackStops = 0;
  const cancellationHarness = createHarness({
    demo: false,
    secure: true,
    MediaRecorder: recorder,
    navigator: {
      mediaDevices: {
        getUserMedia: () => {
          cancelledPermissionCalls += 1;
          return new Promise((resolve) => { resolveCancelledPermission = resolve; });
        }
      }
    }
  });
  const cancelledAttempt = cancellationHarness.elements.voiceRecordButton.dispatch("click", { target: cancellationHarness.elements.voiceRecordButton });
  await Promise.resolve();
  await cancellationHarness.elements.voiceRecordButton.dispatch("click", { target: cancellationHarness.elements.voiceRecordButton });
  equal(cancelledPermissionCalls, 1, "取消等待不得发起第二次麦克风请求");
  check(!cancellationHarness.controller.getState().awaitingPermission, "取消后应立即清除授权等待状态");
  check(cancellationHarness.elements.voiceStatus.textContent.includes("已取消等待"), "取消授权等待应提供可见反馈");
  resolveCancelledPermission({ getTracks: () => [{ stop: () => { lateTrackStops += 1; } }] });
  await cancelledAttempt;
  equal(lateTrackStops, 1, "取消后晚到的麦克风流必须立即关闭");
  check(!cancellationHarness.controller.getState().recording, "取消后晚到的麦克风流不得开始录音");
  check(cancellationHarness.elements.voiceStatus.textContent.includes("已取消等待"), "晚到结果不得覆盖取消反馈");

  const permissionQueue = [];
  ControlledRecorder.instances.length = 0;
  const raceHarness = createHarness({
    demo: false,
    secure: true,
    MediaRecorder: ControlledRecorder,
    navigator: {
      mediaDevices: {
        getUserMedia: () => new Promise((resolve, reject) => permissionQueue.push({ resolve, reject }))
      }
    }
  });
  const oldPermissionAttempt = raceHarness.elements.voiceRecordButton.dispatch("click", { target: raceHarness.elements.voiceRecordButton });
  await Promise.resolve();
  raceHarness.controller.reset({ silent: true });
  const newPermissionAttempt = raceHarness.elements.voiceRecordButton.dispatch("click", { target: raceHarness.elements.voiceRecordButton });
  permissionQueue[1].resolve({ getTracks: () => [{ stop: () => {} }] });
  await newPermissionAttempt;
  check(raceHarness.controller.getState().recording, "新会话授权成功后应开始录音");
  const lateDenied = new Error("Old permission denied");
  lateDenied.name = "NotAllowedError";
  permissionQueue[0].reject(lateDenied);
  await oldPermissionAttempt;
  check(raceHarness.controller.getState().recording, "旧权限请求晚到失败不得清除新会话录音");
  const activeRecorder = ControlledRecorder.instances[ControlledRecorder.instances.length - 1];
  raceHarness.controller.reset();
  equal(raceHarness.elements.voiceStatus.textContent, "", "重置新会话后应先清空旧录音状态");
  activeRecorder.emit("stop");
  check(!raceHarness.controller.getState().recording && raceHarness.controller.getState().count === 0, "旧 stop 事件不得恢复或生成声音草稿");
  equal(raceHarness.elements.voiceStatus.textContent, "", "旧 stop 事件不得覆盖新会话状态");

  let transcriptStatus = "draft";
  const calls = [];
  const functionalHarness = createHarness({
    demo: false,
    secure: true,
    MediaRecorder: recorder,
    fetch: async (url, options = {}) => {
      const method = options.method || "GET";
      calls.push({ url, method, body: options.body ? JSON.parse(options.body) : null });
      if (method === "GET") return responseJson({
        memoryId: "memory-check",
        voices: [makeVoice(transcriptStatus, "一段旧文字", "外婆讲述")],
        count: 1,
        policy: { maxBytes: 12 * 1024 * 1024, maxDurationMs: 180_000, maxVoicesPerMemory: 3, acceptedMimeTypes: ["audio/webm", "audio/mp4"] }
      });
      if (url.endsWith("/transcript") && method === "PUT") {
        transcriptStatus = options.body.includes('"confirm":true') ? "confirmed" : "draft";
        return responseJson({ ok: true, transcript: { status: transcriptStatus } });
      }
      if (url.endsWith("/transcript") && method === "DELETE") return responseJson({ ok: true, transcript: null });
      if (url.endsWith("/voices") && method === "PUT") return responseJson({ ok: true, voices: [makeVoice(transcriptStatus, "一段旧文字", "外婆讲述")] });
      return responseJson({ ok: true });
    }
  });
  const controller = functionalHarness.controller;
  ["loadMemory", "waitForReady", "saveToMemory", "reset", "setDemo", "getState"].forEach((name) => {
    check(typeof controller[name] === "function", `控制器应实现 ${name}`);
  });
  await controller.loadMemory({ id: "memory-check" });
  await controller.waitForReady();
  equal(controller.getState().count, 1, "编辑时应加载已有声音");
  check(controller.getState().ready, "已有声音读取后应处于就绪态");
  check(functionalHarness.elements.voiceList.innerHTML.includes("草稿，不在普通详情展示"), "编辑器应明确草稿边界");

  const localId = /data-voice-id="([^"]+)"/u.exec(functionalHarness.elements.voiceList.innerHTML)?.[1];
  check(Boolean(localId), "声音行应具有稳定本地操作 ID");
  functionalHarness.elements.voiceList.dispatch("input", {
    target: fakeActionTarget({ voiceId: localId }, "transcript", "我已亲自核对这段声音。")
  });
  functionalHarness.elements.voiceList.dispatch("click", {
    target: fakeClickTarget({ voiceAction: "confirm", voiceId: localId })
  });
  equal(controller.getState().items[0].transcriptStatus, "confirmed", "人工确认按钮应把暂存状态设为 confirmed");
  check(controller.getState().items[0].transcriptDirty, "人工确认后应等待随展品保存");

  await controller.saveToMemory("memory-check");
  const association = calls.find((call) => call.method === "PUT" && call.url.endsWith("/voices"));
  deepEqual(association.body, { items: [{ assetId: "voice-check", label: "外婆讲述" }] }, "关联写入只应包含 assetId 与 label");
  const transcript = calls.find((call) => call.method === "PUT" && call.url.endsWith("/transcript"));
  deepEqual(transcript.body, { text: "我已亲自核对这段声音。", confirm: true }, "人工确认应明确写入 confirm true");
  check(calls.filter((call) => call.method === "GET" && call.url.endsWith("/voices")).length >= 2, "保存后应重新读取服务端真值");
  check(functionalHarness.elements.voiceStatus.textContent.includes("已保存 1 段声音"), "保存成功应提供状态反馈");
  check(!controller.getState().items[0].transcriptDirty, "服务端回读后不应残留脏状态");

  controller.reset();
  equal(controller.getState().count, 0, "重置应清空声音草稿");
  check(!controller.getState().recording, "重置后不得保留录音会话");
  controller.destroy();
  demoController.destroy();
  insecureHarness.controller.destroy();
  permissionHarness.controller.destroy();
  cancellationHarness.controller.destroy();
  raceHarness.controller.destroy();

  console.log(`Voice UI checks passed: ${assertions} assertions.`);
}

function createHarness(options = {}) {
  const ids = [
    "voiceRecordButton", "voiceFileInput", "voiceFileLabel", "voiceFallbackHelp", "voiceRecording",
    "voiceRecordingTimer", "voiceStopButton", "voiceCancelButton", "voiceList", "voiceStatus"
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, new FakeElement(id)]));
  const requests = [];
  const fetchImpl = options.fetch || (async (url, requestOptions = {}) => {
    requests.push({ url, method: requestOptions.method || "GET" });
    return responseJson({ voices: [], count: 0, policy: {} });
  });
  const controller = voice.createController({
    document: { getElementById: (id) => elements[id] || null },
    fetch: fetchImpl,
    navigator: options.navigator || { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) } },
    MediaRecorder: options.MediaRecorder,
    isSecureContext: options.secure,
    demo: options.demo
  });
  return { controller, elements, requests };
}

class ControlledRecorder {
  constructor(stream, options = {}) {
    this.stream = stream;
    this.mimeType = options.mimeType || "audio/webm;codecs=opus";
    this.state = "inactive";
    this.listeners = new Map();
    ControlledRecorder.instances.push(this);
  }
  addEventListener(type, handler, options = {}) {
    const listeners = this.listeners.get(type) || [];
    listeners.push({ handler, once: Boolean(options.once) });
    this.listeners.set(type, listeners);
  }
  start() { this.state = "recording"; }
  stop() { this.state = "inactive"; }
  emit(type, event = {}) {
    const listeners = [...(this.listeners.get(type) || [])];
    this.listeners.set(type, listeners.filter((listener) => !listener.once));
    listeners.forEach((listener) => listener.handler(event));
  }
}
ControlledRecorder.instances = [];
ControlledRecorder.isTypeSupported = (mime) => mime === "audio/webm;codecs=opus";

class FakeElement {
  constructor(id) {
    this.id = id;
    this.hidden = false;
    this.disabled = false;
    this.value = "";
    this.textContent = "";
    this.innerHTML = "";
    this.files = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.classList = { toggle: () => {}, add: () => {}, remove: () => {} };
  }
  addEventListener(type, handler) { this.listeners.set(type, handler); }
  removeEventListener(type) { this.listeners.delete(type); }
  dispatch(type, event = {}) { return this.listeners.get(type)?.({ target: this, ...event }); }
  getAttribute(name) { return this.attributes.get(name) || ""; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  contains() { return true; }
}

function fakeActionTarget(dataset, kind, value) {
  return {
    dataset,
    value,
    matches: (selector) => kind === "transcript" ? selector === "[data-voice-transcript]" : selector === "[data-voice-label]"
  };
}

function fakeClickTarget(dataset) {
  const button = { dataset };
  return { closest: (selector) => selector === "[data-voice-action]" ? button : null };
}

function makeVoice(status, text, label) {
  return {
    assetId: "voice-check",
    position: 0,
    label,
    asset: {
      id: "voice-check",
      originalName: "memory.webm",
      mimeType: "audio/webm",
      codec: "opus",
      byteSize: 1200,
      durationMs: 3100,
      contentUrl: "/api/voice/assets/voice-check/content"
    },
    transcript: status ? { status, confirmed: status === "confirmed", text } : null
  };
}

function responseJson(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => name.toLowerCase() === "content-type" ? "application/json" : "" },
    json: async () => payload,
    text: async () => JSON.stringify(payload)
  };
}

async function rejects(operation, message, label) {
  assertions += 1;
  try {
    await operation();
  } catch (error) {
    if (String(error.message).includes(message)) return;
    throw new Error(`${label}：错误信息不符（${error.message}）`);
  }
  throw new Error(`${label}：预期拒绝但成功`);
}

function check(condition, message) {
  assertions += 1;
  if (!condition) throw new Error(message);
}

function equal(actual, expected, message) {
  assertions += 1;
  if (actual !== expected) throw new Error(`${message}：${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
}

function deepEqual(actual, expected, message) {
  assertions += 1;
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}：${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
