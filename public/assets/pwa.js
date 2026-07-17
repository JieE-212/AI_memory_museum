(function (global) {
  "use strict";

  const DEFAULT_IDS = Object.freeze({
    panel: "pwaInstallPanel",
    button: "pwaInstallButton",
    status: "pwaInstallStatus",
    state: "pwaInstallState",
    hint: "pwaInstallHint",
    instructions: "pwaInstallInstructions"
  });

  function createInstallController(options = {}) {
    const windowRef = options.window || global;
    const documentRef = options.document || windowRef.document;
    const navigatorRef = options.navigator || windowRef.navigator || {};
    const locationRef = options.location || windowRef.location || {};
    const ids = { ...DEFAULT_IDS, ...(options.ids || {}) };
    const elements = {
      panel: documentRef?.getElementById?.(ids.panel),
      button: documentRef?.getElementById?.(ids.button),
      status: documentRef?.getElementById?.(ids.status),
      state: documentRef?.getElementById?.(ids.state),
      hint: documentRef?.getElementById?.(ids.hint),
      instructions: documentRef?.getElementById?.(ids.instructions)
    };
    if (Object.values(elements).some((element) => !element)) return null;

    let deferredPrompt = null;
    let registration = null;
    let destroyed = false;
    const listeners = [];

    listen(windowRef, "beforeinstallprompt", handleBeforeInstallPrompt);
    listen(windowRef, "appinstalled", handleAppInstalled);
    listen(elements.button, "click", handleInstallClick);
    void initialize();

    return Object.freeze({
      destroy,
      getState: () => Object.freeze({
        installPromptReady: Boolean(deferredPrompt),
        registered: Boolean(registration),
        standalone: isStandaloneMode(windowRef, navigatorRef)
      })
    });

    async function initialize() {
      if (isStandaloneMode(windowRef, navigatorRef)) {
        showPanel("已安装", "已经可以从设备入口打开时屿");
        elements.button.hidden = true;
        elements.instructions.hidden = true;
        setStatus("时屿已作为独立应用打开；私人馆藏仍只由本地服务提供。", "success");
        return;
      }
      if (!isTrustedInstallOrigin(locationRef) || !navigatorRef.serviceWorker?.register) return;
      const ios = isIosLike(navigatorRef);
      if (ios) {
        showPanel("手动添加", "从 Safari 分享菜单添加到主屏幕");
        elements.button.hidden = true;
        elements.instructions.hidden = false;
        setStatus("安装只增加启动入口，不移动、不上传或缓存私人馆藏。");
      }
      try {
        registration = await navigatorRef.serviceWorker.register("/sw.js", {
          scope: "/",
          updateViaCache: "none"
        });
        if (destroyed) return;
        watchRegistration(registration);
        if (registration.waiting && !elements.panel.hidden) {
          setStatus("新版本已准备好；关闭所有时屿页面后重新打开即可更新。", "success");
        }
      } catch {
        if (!destroyed) elements.panel.hidden = true;
      }
    }

    function handleBeforeInstallPrompt(event) {
      event.preventDefault?.();
      deferredPrompt = event;
      showPanel("可安装", "从桌面或主屏幕直接打开时屿");
      elements.button.hidden = false;
      elements.button.disabled = false;
      elements.button.textContent = "安装到此设备";
      elements.instructions.hidden = true;
      setStatus("当前浏览器已允许安装；安装只固定应用入口，不缓存私人馆藏。", "success");
    }

    async function handleInstallClick() {
      if (!deferredPrompt) {
        setStatus(manualInstallMessage(navigatorRef));
        return;
      }
      const prompt = deferredPrompt;
      deferredPrompt = null;
      elements.button.disabled = true;
      elements.button.textContent = "等待浏览器确认…";
      setStatus("请在浏览器安装提示中确认或取消。", "");
      try {
        await prompt.prompt();
        const choice = await prompt.userChoice;
        elements.button.hidden = true;
        elements.button.disabled = false;
        elements.button.textContent = "安装到此设备";
        if (choice?.outcome === "accepted") {
          setStatus("浏览器正在完成安装；完成后可从设备入口打开时屿。", "success");
        } else {
          setStatus("这次没有安装；刷新或下次访问后可再试。", "");
        }
      } catch {
        elements.button.hidden = true;
        elements.button.disabled = false;
        elements.button.textContent = "安装到此设备";
        setStatus("浏览器没有完成安装提示；刷新或稍后从菜单重试。", "error");
      }
    }

    function handleAppInstalled() {
      deferredPrompt = null;
      showPanel("已安装", "已经可以从设备入口打开时屿");
      elements.button.hidden = true;
      elements.button.disabled = false;
      elements.instructions.hidden = true;
      setStatus("时屿已安装；离线时只显示数据边界页，不展示私人馆藏。", "success");
    }

    function watchRegistration(value) {
      if (!value?.addEventListener) return;
      const handleUpdateFound = () => {
        const worker = value.installing;
        if (!worker?.addEventListener) return;
        const handleStateChange = () => {
          if (worker.state === "installed" && navigatorRef.serviceWorker?.controller && !deferredPrompt && !elements.panel.hidden) {
            setStatus("新版本已准备好；关闭所有时屿页面后重新打开即可更新。", "success");
          }
        };
        worker.addEventListener("statechange", handleStateChange);
        listeners.push({ target: worker, type: "statechange", handler: handleStateChange });
      };
      value.addEventListener("updatefound", handleUpdateFound);
      listeners.push({ target: value, type: "updatefound", handler: handleUpdateFound });
    }

    function setStatus(text, state = "") {
      elements.status.textContent = text;
      if (state) elements.status.dataset.state = state;
      else delete elements.status.dataset.state;
    }

    function showPanel(state, hint) {
      elements.panel.hidden = false;
      elements.state.textContent = state;
      elements.hint.textContent = hint;
    }

    function listen(target, type, handler) {
      if (!target?.addEventListener) return;
      target.addEventListener(type, handler);
      listeners.push({ target, type, handler });
    }

    function destroy() {
      destroyed = true;
      deferredPrompt = null;
      listeners.splice(0).forEach(({ target, type, handler }) => target.removeEventListener?.(type, handler));
    }
  }

  function isTrustedInstallOrigin(locationValue = {}) {
    const protocol = String(locationValue.protocol || "").toLowerCase();
    const hostname = String(locationValue.hostname || "").toLowerCase();
    return protocol === "https:" || (protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(hostname));
  }

  function isStandaloneMode(windowValue = {}, navigatorValue = {}) {
    try {
      return Boolean(navigatorValue.standalone) || Boolean(windowValue.matchMedia?.("(display-mode: standalone)")?.matches);
    } catch {
      return Boolean(navigatorValue.standalone);
    }
  }

  function manualInstallMessage(navigatorValue = {}) {
    return isIosLike(navigatorValue)
      ? "可在 Safari 的分享菜单中选择“添加到主屏幕”；安装不会缓存私人馆藏。"
      : "如果浏览器支持，可从地址栏或菜单选择“安装应用”；安装不会缓存私人馆藏。";
  }

  function isIosLike(navigatorValue = {}) {
    const agent = String(navigatorValue.userAgent || "");
    return /iPad|iPhone|iPod/iu.test(agent) || (navigatorValue.platform === "MacIntel" && Number(navigatorValue.maxTouchPoints) > 1);
  }

  const api = Object.freeze({ createInstallController, isTrustedInstallOrigin, isStandaloneMode, manualInstallMessage, isIosLike });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.TimeIslePwa = api;
  if (global.document) createInstallController();
})(typeof window !== "undefined" ? window : globalThis);
