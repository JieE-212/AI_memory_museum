"use strict";

(function initializeWakeupModule(scope) {
  const DEFAULT_CONFIG = Object.freeze({
    primaryUrl: "https://shiyu-memory-demo-d3di282387d5c7-1456049152.ap-shanghai.app.tcloudbase.com/#reflect",
    fallbackUrl: "https://ai-memory-museum-demo.vercel.app/#reflect",
    probeUrl: "https://shiyu-memory-demo-d3di282387d5c7-1456049152.ap-shanghai.app.tcloudbase.com/assets/time-isle-192.png",
    attemptDelaysMs: Object.freeze([0, 2200, 4800]),
    probeTimeoutMs: 7000,
    readyDelayMs: 650,
    expectedWidth: 192,
    expectedHeight: 192
  });

  function createWakeupController(options = {}) {
    const documentRef = options.documentRef || scope.document;
    const ImageCtor = options.ImageCtor || scope.Image;
    const locationRef = options.locationRef || scope.location;
    const setTimeoutFn = options.setTimeoutFn || scope.setTimeout.bind(scope);
    const clearTimeoutFn = options.clearTimeoutFn || scope.clearTimeout.bind(scope);
    const nowFn = options.nowFn || Date.now;
    const config = Object.freeze({ ...DEFAULT_CONFIG, ...(options.config || {}) });
    const elements = options.elements || collectElements(documentRef);
    const navigate = options.navigate || ((url) => locationRef.replace(url));
    const timers = new Set();
    let activeImage = null;
    let cycle = 0;
    let attempt = 0;
    let running = false;

    function schedule(callback, delayMs) {
      let timerId = null;
      timerId = setTimeoutFn(() => {
        timers.delete(timerId);
        callback();
      }, delayMs);
      timers.add(timerId);
      return timerId;
    }

    function cancelTimer(timerId) {
      if (timerId === null || timerId === undefined) return;
      clearTimeoutFn(timerId);
      timers.delete(timerId);
    }

    function clearPending() {
      for (const timerId of timers) clearTimeoutFn(timerId);
      timers.clear();
      if (!activeImage) return;
      activeImage.onload = null;
      activeImage.onerror = null;
      activeImage = null;
    }

    function setState(state, title, detail, progress) {
      elements.body.dataset.wakeupState = state;
      elements.statusPanel.setAttribute("aria-busy", state === "checking" ? "true" : "false");
      elements.statusTitle.textContent = title;
      elements.statusDetail.textContent = detail;
      elements.progress.textContent = progress;
    }

    function finishUnavailable() {
      running = false;
      elements.button.disabled = false;
      elements.button.textContent = "再次唤醒";
      setState(
        "unavailable",
        "展馆暂时没有回应",
        "本轮有限尝试已经结束。你可以重新唤醒，或直接使用下方备用入口。",
        `已完成 ${config.attemptDelaysMs.length} 次尝试，没有继续后台请求`
      );
    }

    function finishReady(token) {
      elements.button.disabled = true;
      elements.button.textContent = "正在进入";
      setState("ready", "展馆已经苏醒", "连接准备完成，正在带你进入讲解与回顾。", "已确认展馆静态资源可用");
      schedule(() => {
        if (token !== cycle) return;
        running = false;
        navigate(config.primaryUrl);
      }, config.readyDelayMs);
    }

    function runAttempt(token) {
      if (!running || token !== cycle) return;
      if (attempt >= config.attemptDelaysMs.length) return finishUnavailable();
      attempt += 1;
      setState(
        "checking",
        attempt === 1 ? "正在唤醒展馆" : "展馆还在准备",
        "正在请求一项无隐私的公开图片，用来确认服务已经能够响应。",
        `第 ${attempt} / ${config.attemptDelaysMs.length} 次有限尝试`
      );

      const image = new ImageCtor();
      activeImage = image;
      let settled = false;
      const timeoutId = schedule(() => settle(false), config.probeTimeoutMs);

      function settle(loaded) {
        if (settled) return;
        settled = true;
        cancelTimer(timeoutId);
        image.onload = null;
        image.onerror = null;
        if (activeImage === image) activeImage = null;
        if (!running || token !== cycle) return;
        const validImage = loaded && image.naturalWidth === config.expectedWidth && image.naturalHeight === config.expectedHeight;
        if (validImage) return finishReady(token);
        if (attempt >= config.attemptDelaysMs.length) return finishUnavailable();
        setState(
          "checking",
          "展馆还在准备",
          "首次唤醒可能短暂返回 503；我们会稍等片刻再试，不会无限重连。",
          `已完成 ${attempt} 次尝试，等待下一次连接`
        );
        schedule(() => runAttempt(token), config.attemptDelaysMs[attempt]);
      }

      image.onload = () => settle(true);
      image.onerror = () => settle(false);
      image.referrerPolicy = "no-referrer";
      image.decoding = "async";
      image.src = `${config.probeUrl}?wake=${encodeURIComponent(`${nowFn()}-${attempt}`)}`;
    }

    function start() {
      if (running) return false;
      clearPending();
      cycle += 1;
      attempt = 0;
      running = true;
      elements.button.disabled = true;
      elements.button.textContent = "正在唤醒";
      setState("checking", "正在准备唤醒", "只会执行一轮有限尝试，不会在后台持续保活。", "准备连接…");
      const token = cycle;
      schedule(() => runAttempt(token), config.attemptDelaysMs[0]);
      return true;
    }

    function stop({ reset = true } = {}) {
      cycle += 1;
      running = false;
      attempt = 0;
      clearPending();
      if (!reset) return;
      elements.button.disabled = false;
      elements.button.textContent = "唤醒并进入";
      setState("idle", "展馆正在休息", "点击下方按钮后开始；页面不会在后台持续保活。", "尚未发起连接");
    }

    return Object.freeze({
      start,
      stop,
      isRunning: () => running,
      getAttemptCount: () => attempt,
      getPendingTimerCount: () => timers.size
    });
  }

  function collectElements(documentRef) {
    const elements = {
      body: documentRef.body,
      statusPanel: documentRef.getElementById("wakeupStatusPanel"),
      statusTitle: documentRef.getElementById("wakeupStatusTitle"),
      statusDetail: documentRef.getElementById("wakeupStatusDetail"),
      progress: documentRef.getElementById("wakeupProgress"),
      button: documentRef.getElementById("wakeupButton")
    };
    if (!Object.values(elements).every(Boolean)) throw new Error("唤醒入口缺少必要界面元素。");
    return elements;
  }

  function bootWakeupPage() {
    const controller = createWakeupController();
    const button = scope.document.getElementById("wakeupButton");
    const directLink = scope.document.getElementById("directLink");
    const fallbackLink = scope.document.getElementById("fallbackLink");
    directLink.href = DEFAULT_CONFIG.primaryUrl;
    fallbackLink.href = DEFAULT_CONFIG.fallbackUrl;
    button.addEventListener("click", () => controller.start());
    scope.addEventListener("pagehide", () => controller.stop({ reset: false }));
    scope.addEventListener("pageshow", (event) => {
      if (event.persisted) controller.stop();
    });
    return controller;
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { DEFAULT_CONFIG, createWakeupController };
  }
  if (scope && scope.document && typeof scope.Image === "function") bootWakeupPage();
})(typeof globalThis !== "undefined" ? globalThis : this);
