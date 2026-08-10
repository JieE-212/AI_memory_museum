(function (global) {
  "use strict";

  const defaultVersion = (() => {
    try {
      return new URL(global.document?.currentScript?.src || global.location?.href || "http://localhost/", global.location?.href || "http://localhost/").searchParams.get("v") || "";
    } catch {
      return "";
    }
  })();

  function createLoader(options = {}) {
    const documentRef = options.document || global.document;
    const locationRef = options.location || global.location;
    const version = String(options.version ?? defaultVersion);
    const timeoutMs = Number.isSafeInteger(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : 12_000;
    const promises = new Map();
    if (!documentRef?.createElement || !documentRef.head || !locationRef?.href) return null;

    function loadScript(pathname, isReady) {
      const source = assetUrl(pathname);
      if (promises.has(source)) return promises.get(source);
      const verifyReady = typeof isReady === "function" ? isReady : () => true;
      const promise = new Promise((resolve, reject) => {
        const script = documentRef.createElement("script");
        let settled = false;
        const finish = (error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutId);
          if (error) {
            script.remove();
            promises.delete(source);
            reject(error);
          } else resolve(script);
        };
        const fileName = new URL(source).pathname.split("/").pop();
        const timeoutId = setTimeout(() => finish(new Error(`资源加载超时：${fileName}`)), timeoutMs);
        script.src = source;
        script.async = false;
        script.dataset.timeIsleLazy = "true";
        script.addEventListener("load", () => {
          try {
            if (!verifyReady()) throw new Error(`资源加载不完整：${fileName}`);
            finish();
          } catch (error) {
            finish(error instanceof Error ? error : new Error(`资源加载不完整：${fileName}`));
          }
        }, { once: true });
        script.addEventListener("error", () => finish(new Error(`资源加载失败：${fileName}`)), { once: true });
        documentRef.head.appendChild(script);
      });
      promises.set(source, promise);
      return promise;
    }

    function assetUrl(pathname) {
      const url = new URL(pathname, locationRef.href);
      if (version) url.searchParams.set("v", version);
      return url.href;
    }

    function markControlBusy(control) {
      if (!control) return () => {};
      const disabled = control.disabled;
      const ariaBusy = control.getAttribute("aria-busy");
      control.disabled = true;
      control.setAttribute("aria-busy", "true");
      return () => {
        control.disabled = disabled;
        if (ariaBusy === null) control.removeAttribute("aria-busy");
        else control.setAttribute("aria-busy", ariaBusy);
      };
    }

    return Object.freeze({ loadScript, markControlBusy });
  }

  const api = Object.freeze({ createLoader });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.TimeIsleLazyFeatures = api;
})(typeof window !== "undefined" ? window : globalThis);
