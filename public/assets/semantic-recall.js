(function semanticRecallModule(globalScope, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.TimeIsleSemanticRecall = api;
})(typeof window !== "undefined" ? window : globalThis, function buildSemanticRecallModule() {
  "use strict";

  const SNAPSHOT_PATH = "/api/semantic-recall/snapshot";
  const WORKER_PATH = "/assets/semantic-recall-worker.js?v=17.0.0";
  const PHASES = new Set(["idle", "loading", "ready", "querying", "error"]);

  function createController(options = {}) {
    const doc = options.document || globalThis.document;
    const fetchImpl = options.fetch || globalThis.fetch?.bind(globalThis);
    const WorkerImpl = options.Worker || globalThis.Worker;
    const AbortControllerImpl = options.AbortController || globalThis.AbortController;
    const onOpenMemory = typeof options.onOpenMemory === "function" ? options.onOpenMemory : () => {};
    const onFallback = typeof options.onFallback === "function" ? options.onFallback : () => {};
    const elements = readElements(doc);
    if (!elements || typeof fetchImpl !== "function") return null;

    let worker = null;
    let session = "";
    let phase = "idle";
    let readyFingerprint = "";
    let destroyed = false;
    let prepareEpoch = 0;
    let snapshotAbort = null;

    elements.prepare.addEventListener("click", prepare);
    elements.stop.addEventListener("click", () => clearSession("已停止，并清除了本次设备索引。"));
    elements.clear.addEventListener("click", () => clearSession("已释放本页模型内存，并清除查询、向量和索引；同源模型文件仍可能留在浏览器普通 HTTP 缓存中。", true));
    elements.form.addEventListener("submit", search);
    elements.fallback.addEventListener("click", () => onFallback(elements.query.value.trim()));

    function setPhase(next) {
      phase = PHASES.has(next) ? next : "error";
      const busy = phase === "loading" || phase === "querying";
      elements.details.setAttribute("aria-busy", String(busy));
      elements.prepare.disabled = busy;
      elements.prepare.hidden = phase === "ready" || phase === "querying";
      elements.stop.hidden = !busy;
      elements.stop.textContent = phase === "querying" ? "停止寻找" : "停止准备";
      elements.clear.hidden = !(worker || phase === "ready" || phase === "querying" || phase === "error");
      elements.query.disabled = phase !== "ready";
      elements.submit.disabled = phase !== "ready";
      elements.form.hidden = !["ready", "querying"].includes(phase);
      elements.progress.hidden = !busy;
    }

    async function prepare() {
      if (destroyed || ["loading", "querying"].includes(phase)) return;
      terminateWorker();
      clearResults();
      setStatus("正在读取只包含可索引文字的馆藏快照…");
      updateProgress(0);
      setPhase("loading");
      const epoch = ++prepareEpoch;
      snapshotAbort?.abort();
      snapshotAbort = typeof AbortControllerImpl === "function" ? new AbortControllerImpl() : null;
      try {
        if (typeof WorkerImpl !== "function") throw publicError("当前浏览器不支持后台设备推理。", "SEMANTIC_RECALL_WORKER_UNAVAILABLE");
        const response = await fetchImpl(SNAPSHOT_PATH, {
          method: "GET",
          credentials: "same-origin",
          cache: "no-store",
          headers: { Accept: "application/json" },
          ...(snapshotAbort ? { signal: snapshotAbort.signal } : {})
        });
        const payload = await response.json().catch(() => ({}));
        if (destroyed || epoch !== prepareEpoch) return;
        snapshotAbort = null;
        if (!response.ok) throw publicError(payload.error || "无法读取设备索引快照。", payload.code || "SEMANTIC_RECALL_SNAPSHOT_UNAVAILABLE");
        const snapshot = validateSnapshotEnvelope(payload);
        if (!snapshot.documentCount) {
          setPhase("idle");
          setStatus("馆里还没有可理解的文字展品。先记录一段记忆，再回来准备设备语义。");
          return;
        }
        session = createSessionId();
        const candidate = new WorkerImpl(WORKER_PATH, { type: "module", name: "time-isle-semantic-recall" });
        worker = candidate;
        candidate.addEventListener("message", (event) => handleWorkerMessage(event, candidate));
        candidate.addEventListener("error", (event) => handleWorkerCrash(event, candidate));
        candidate.postMessage({ type: "prepare", session, snapshot });
      } catch (error) {
        if (destroyed || epoch !== prepareEpoch || error?.name === "AbortError") return;
        snapshotAbort = null;
        showUnavailable(error);
      }
    }

    function handleWorkerMessage(event, sourceWorker) {
      if (sourceWorker !== worker) return;
      const message = event?.data;
      if (!message || message.session !== session || typeof message.type !== "string") return;
      if (message.type === "progress") {
        updateProgress(message.percent);
        setStatus(safeStatusLabel(message));
        return;
      }
      if (message.type === "ready") {
        if (!/^[a-f0-9]{64}$/u.test(String(message.collectionFingerprint || "")) ||
            !Number.isSafeInteger(message.documentCount) || message.documentCount < 1 || message.documentCount > 500 ||
            !Number.isSafeInteger(message.maximumInputTokens) || !Number.isSafeInteger(message.modelMaximumTokens) ||
            message.maximumInputTokens < 1 || message.maximumInputTokens > message.modelMaximumTokens || message.modelMaximumTokens !== 512) {
          showUnavailable(publicError("设备索引回执无效。", "SEMANTIC_RECALL_RESULT_INVALID"));
          return;
        }
        readyFingerprint = message.collectionFingerprint;
        elements.details.setAttribute("data-semantic-max-tokens", String(message.maximumInputTokens));
        setPhase("ready");
        updateProgress(100);
        setStatus(`设备语义已准备：${message.documentCount} 件展品。输入一句自然描述即可按意思找回。`, "success");
        elements.query.focus({ preventScroll: true });
        return;
      }
      if (message.type === "results") {
        if (message.collectionFingerprint !== readyFingerprint || !Array.isArray(message.results)) {
          showUnavailable(publicError("设备语义结果已过期。", "SEMANTIC_RECALL_RESULT_INVALID"));
          return;
        }
        renderResults(message.results, onOpenMemory, elements.results, doc);
        setPhase("ready");
        setStatus(`已按文字含义排列 ${message.results.length} 件展品；最接近的结果也可能不相关，且不是事实、关系或真实性判断。`, "success");
        return;
      }
      if (message.type === "error") showUnavailable(publicError(message.message, message.code));
    }

    function handleWorkerCrash(event, sourceWorker) {
      if (sourceWorker !== worker) return;
      showUnavailable(publicError("设备语义不可用。模型运行被浏览器中止。", "SEMANTIC_RECALL_WORKER_CRASHED"));
    }

    function search(event) {
      event.preventDefault();
      if (!worker || phase !== "ready") return;
      const query = elements.query.value.normalize("NFKC").replace(/\s+/gu, " ").trim();
      const length = [...query].length;
      if (length < 2 || length > 160) {
        setStatus("请用 2–160 个字符描述想找的记忆。", "error");
        return;
      }
      clearResults();
      setPhase("querying");
      setStatus("正在按文字含义寻找；查询不会发送给服务端或第三方。 ");
      worker.postMessage({ type: "query", session, query });
    }

    function showUnavailable(error) {
      terminateWorker();
      readyFingerprint = "";
      setPhase("error");
      const reason = String(error?.message || "").trim();
      setStatus(`设备语义不可用。${reason ? ` ${reason}` : ""} 可改用字段与线索检索。`, "error");
    }

    function clearSession(message, clearQuery = false) {
      cancelPendingSnapshot();
      terminateWorker();
      readyFingerprint = "";
      if (clearQuery) elements.query.value = "";
      clearResults();
      updateProgress(0);
      setPhase("idle");
      setStatus(message);
    }

    function invalidate() {
      if (!worker && phase === "idle") return;
      clearSession("馆藏文字已变化，旧索引已清除。请重新准备设备语义。", false);
    }

    function terminateWorker() {
      if (worker) worker.terminate();
      worker = null;
      session = "";
    }

    function cancelPendingSnapshot() {
      prepareEpoch += 1;
      snapshotAbort?.abort();
      snapshotAbort = null;
    }

    function clearResults() {
      elements.results.replaceChildren();
      elements.results.hidden = true;
    }

    function updateProgress(value) {
      elements.progress.value = Math.max(0, Math.min(100, Number(value) || 0));
    }

    function setStatus(message, kind = "") {
      elements.status.textContent = message;
      elements.status.classList.toggle("is-error", kind === "error");
      elements.status.classList.toggle("is-success", kind === "success");
    }

    function destroy() {
      destroyed = true;
      cancelPendingSnapshot();
      terminateWorker();
      clearResults();
    }

    setPhase("idle");
    return Object.freeze({ destroy, invalidate, getPhase: () => phase });
  }

  function renderResults(results, onOpenMemory, container, doc) {
    container.replaceChildren();
    results.slice(0, 6).forEach((result, index) => {
      if (!validResult(result, index)) return;
      const card = doc.createElement("article");
      card.className = "semantic-recall-result";
      const button = doc.createElement("button");
      button.type = "button";
      button.addEventListener("click", () => onOpenMemory(result.memoryId));
      const meta = doc.createElement("span");
      meta.className = "semantic-recall-result-meta";
      meta.textContent = `第 ${index + 1} 个相似结果 · 文字含义排序`;
      const title = doc.createElement("strong");
      title.textContent = result.title;
      const excerpt = doc.createElement("span");
      excerpt.className = "semantic-recall-result-excerpt";
      excerpt.textContent = result.excerpt;
      button.append(meta, title, excerpt);
      if (result.tags.length) {
        const tags = doc.createElement("span");
        tags.className = "semantic-recall-result-tags";
        tags.textContent = result.tags.map((tag) => `#${tag}`).join("  ");
        button.append(tags);
      }
      card.append(button);
      container.append(card);
    });
    if (!container.children.length) {
      const empty = doc.createElement("p");
      empty.className = "muted";
      empty.textContent = "这次没有可展示的设备语义结果，可以换一种说法。";
      container.append(empty);
    }
    container.hidden = false;
  }

  function validResult(result, index) {
    return Boolean(result) && result.rank === index + 1 && /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/u.test(String(result.memoryId || "")) &&
      typeof result.title === "string" && typeof result.excerpt === "string" && Array.isArray(result.tags) &&
      result.tags.every((tag) => typeof tag === "string") && Number.isFinite(result.similarity);
  }

  function validateSnapshotEnvelope(payload) {
    const snapshot = payload?.snapshot;
    if (!snapshot || snapshot.format !== "time-isle-semantic-recall-snapshot-v1" ||
        !Number.isSafeInteger(snapshot.documentCount) || snapshot.documentCount !== snapshot.documents?.length ||
        snapshot.documentCount > 500 || !Number.isSafeInteger(snapshot.documentUtf8Bytes) ||
        snapshot.documentUtf8Bytes < 2 || snapshot.documentUtf8Bytes > 1_048_576 || snapshot.model?.remoteModelsAllowed !== false ||
        snapshot.boundary?.execution !== "browser-worker-memory-only" || snapshot.boundary?.persisted !== false) {
      throw publicError("设备索引快照未通过边界校验。", "SEMANTIC_RECALL_SNAPSHOT_INVALID");
    }
    return snapshot;
  }

  function safeStatusLabel(message) {
    const phase = String(message.phase || "");
    if (phase === "index" && Number.isSafeInteger(message.completed) && Number.isSafeInteger(message.total)) {
      return `正在理解馆藏文字 ${message.completed}/${message.total}…`;
    }
    if (phase === "query") return "正在按文字含义寻找…";
    const percent = Math.round(Math.max(0, Math.min(100, Number(message.percent) || 0)));
    return `正在加载设备模型 ${percent}%…`;
  }

  function readElements(doc) {
    if (!doc || typeof doc.querySelector !== "function") return null;
    const ids = {
      details: "#semanticRecallDetails",
      prepare: "#semanticRecallPrepare",
      stop: "#semanticRecallStop",
      clear: "#semanticRecallClear",
      status: "#semanticRecallStatus",
      progress: "#semanticRecallProgress",
      form: "#semanticRecallForm",
      query: "#semanticRecallQuery",
      submit: "#semanticRecallSubmit",
      fallback: "#semanticRecallFallback",
      results: "#semanticRecallResults"
    };
    const elements = Object.fromEntries(Object.entries(ids).map(([key, selector]) => [key, doc.querySelector(selector)]));
    return Object.values(elements).every(Boolean) ? elements : null;
  }

  function createSessionId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `semantic-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function publicError(message, code) {
    const error = new Error(String(message || "设备语义不可用。"));
    error.code = String(code || "SEMANTIC_RECALL_UNAVAILABLE");
    return error;
  }

  return Object.freeze({
    SNAPSHOT_PATH,
    WORKER_PATH,
    createController,
    renderResults,
    validateSnapshotEnvelope
  });
});
