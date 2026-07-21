(function initializeTimeIsleMultiPerspectiveHost(root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.TimeIsleMultiPerspectiveHost = factory();
}(typeof globalThis !== "undefined" ? globalThis : self, function createMultiPerspectiveHostModule() {
  "use strict";

  const PATH_PREFIX = "/api/multi-perspective/memories/";
  const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/u;

  function createController(options = {}) {
    const documentRef = options.document || (typeof document !== "undefined" ? document : null);
    const ui = options.ui || (typeof globalThis !== "undefined" ? globalThis.TimeIsleMultiPerspective : null);
    const loadPreview = typeof options.loadPreview === "function"
      ? options.loadPreview
      : createPreviewClient({ fetch: options.fetch });
    if (!documentRef || typeof ui?.createController !== "function") return null;
    return ui.createController({
      document: documentRef,
      loadPreview,
      onHandoff: typeof options.onHandoff === "function"
        ? options.onHandoff
        : (kind, context) => defaultHandoff(documentRef, kind, context)
    });
  }

  function createPreviewClient(options = {}) {
    const fetchImpl = options.fetch || (typeof fetch === "function" ? fetch.bind(globalThis) : null);
    if (typeof fetchImpl !== "function") throw hostError("当前环境无法读取多视角对照。", "MULTI_PERSPECTIVE_FETCH_UNAVAILABLE");
    return async function loadPreview(memoryId, context = {}) {
      const id = safeId(memoryId);
      if (!id) throw hostError("展品 ID 无效。", "MULTI_PERSPECTIVE_MEMORY_ID_INVALID");
      const response = await fetchImpl(`${PATH_PREFIX}${encodeURIComponent(id)}`, {
        method: "GET",
        headers: { Accept: "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        signal: context.signal
      });
      let payload;
      try { payload = await response.json(); }
      catch { throw hostError("服务器没有返回可读取的多视角对照。", "MULTI_PERSPECTIVE_RESPONSE_INVALID"); }
      if (!response.ok) {
        const error = hostError(payload?.error || `多视角对照读取失败（${response.status}）。`, payload?.code || "MULTI_PERSPECTIVE_REQUEST_FAILED");
        error.status = Number(response.status) || 0;
        throw error;
      }
      return payload;
    };
  }

  function defaultHandoff(documentRef, kind, context = {}) {
    if (kind === "provenance") {
      const panel = context.panel?.parentElement?.querySelector?.("[data-provenance-passport]");
      return revealPanel(panel, "来源护照已经打开；仍需你亲手填写并确认关系。");
    }
    if (kind === "revisions") {
      const panel = context.panel?.parentElement?.querySelector?.(".memory-revision-panel");
      return revealPanel(panel, "记忆年轮已经打开；查看或恢复仍需单独操作。");
    }
    if (kind === "puzzle") {
      const dialog = documentRef.querySelector?.("#memoryDialog");
      if (dialog?.open && typeof dialog.close === "function") dialog.close();
      if (typeof location !== "undefined") location.hash = "#reflect";
      const focus = () => {
        const target = documentRef.querySelector?.("#routesPanel, #insightsTitle");
        target?.scrollIntoView?.({ block: "start", behavior: prefersReducedMotion() ? "auto" : "smooth" });
        target?.focus?.({ preventScroll: true });
      };
      if (typeof setTimeout === "function") setTimeout(focus, 0);
      else focus();
      return true;
    }
    return false;
  }

  function revealPanel(panel, statusCopy) {
    if (!panel) return false;
    panel.open = true;
    panel.scrollIntoView?.({ block: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" });
    panel.querySelector?.("summary")?.focus?.({ preventScroll: true });
    const status = panel.querySelector?.("[role='status']");
    if (status && !status.textContent.trim()) status.textContent = statusCopy;
    return true;
  }

  function prefersReducedMotion() {
    return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function safeId(value) {
    const id = String(value || "");
    return ID_PATTERN.test(id) ? id : "";
  }

  function hostError(message, code) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  return Object.freeze({ PATH_PREFIX, createController, createPreviewClient, defaultHandoff });
}));
