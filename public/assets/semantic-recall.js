(function semanticRecallModule(globalScope, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.TimeIsleSemanticRecall = api;
})(typeof window !== "undefined" ? window : globalThis, function buildSemanticRecallModule() {
  "use strict";

  const SNAPSHOT_PATH = "/api/semantic-recall/snapshot";
  const WORKER_PATH = "/assets/semantic-recall-worker.js?v=17.2.2";
  const INDEX_PATH = "/api/semantic-index";
  const PHASES = new Set(["idle", "loading", "ready", "querying", "error"]);

  function createController(options = {}) {
    const doc = options.document || globalThis.document;
    const fetchImpl = options.fetch || globalThis.fetch?.bind(globalThis);
    const WorkerImpl = options.Worker || globalThis.Worker;
    const AbortControllerImpl = options.AbortController || globalThis.AbortController;
    const onOpenMemory = typeof options.onOpenMemory === "function" ? options.onOpenMemory : () => {};
    const onFallback = typeof options.onFallback === "function" ? options.onFallback : () => {};
    const onIndexChanged = typeof options.onIndexChanged === "function" ? options.onIndexChanged : () => {};
    const getPersistentIndexStatus = typeof options.getPersistentIndexStatus === "function" ? options.getPersistentIndexStatus : async () => null;
    const onPersistentSearch = typeof options.onPersistentSearch === "function" ? options.onPersistentSearch : null;
    const demo = options.demo === true;
    const elements = readElements(doc);
    if (!elements || typeof fetchImpl !== "function") return null;

    let worker = null;
    let session = "";
    let phase = "idle";
    let readyFingerprint = "";
    let destroyed = false;
    let prepareEpoch = 0;
    let snapshotAbort = null;
    let cachedEntries = [];
    let persisting = false;
    let persistentIndexReady = false;

    elements.prepare.addEventListener("click", prepare);
    elements.stop.addEventListener("click", () => clearSession("已停止，并清除了本次设备索引。"));
    elements.clear.addEventListener("click", () => clearSession("已释放本页模型内存，并清除查询、向量和索引；同源模型文件仍可能留在浏览器普通 HTTP 缓存中。", true));
    elements.persist.addEventListener("click", persistIndex);
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
      elements.persist.hidden = demo || phase !== "ready";
      elements.persist.disabled = demo || phase !== "ready" || persisting || !cachedEntries.length;
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
        const indexStatus = demo ? null : await Promise.resolve(getPersistentIndexStatus(snapshot));
        if (destroyed || epoch !== prepareEpoch) return;
        persistentIndexReady = isPersistentIndexReady(indexStatus, snapshot);
        session = createSessionId();
        const candidate = new WorkerImpl(WORKER_PATH, { type: "module", name: "time-isle-semantic-recall" });
        worker = candidate;
        candidate.addEventListener("message", (event) => handleWorkerMessage(event, candidate));
        candidate.addEventListener("error", (event) => handleWorkerCrash(event, candidate));
        candidate.postMessage({ type: "prepare", session, snapshot, usePersistentIndex: persistentIndexReady });
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
        const usesPersistentIndex = message.persistentIndexReady === true;
        if (usesPersistentIndex !== persistentIndexReady) {
          showUnavailable(publicError("设备索引模式回执不一致。", "SEMANTIC_INDEX_RESULT_INVALID"));
          return;
        }
        const entries = usesPersistentIndex ? [] : validateIndexEntries(message.entries, message.documentCount);
        readyFingerprint = message.collectionFingerprint;
        cachedEntries = entries;
        elements.details.setAttribute("data-semantic-max-tokens", String(message.maximumInputTokens));
        setPhase("ready");
        updateProgress(100);
        setStatus(`设备语义已准备：${message.documentCount} 件展品。${usesPersistentIndex ? "本次将复用本机派生索引，并与文字命中合并排序。" : `输入一句自然描述即可按意思找回。${demo ? "" : " 如需下次直接使用，请选择保存派生索引。"}`}`, "success");
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
      if (message.type === "persistent-query") {
        if (!persistentIndexReady || message.collectionFingerprint !== readyFingerprint || !onPersistentSearch || !(message.vector instanceof Float32Array)) {
          showUnavailable(publicError("本机派生索引查询回执无效。", "SEMANTIC_INDEX_RESULT_INVALID"));
          return;
        }
        Promise.resolve(onPersistentSearch(message.query, message.vector)).then((results) => {
          if (destroyed || sourceWorker !== worker || phase !== "querying") return;
          renderResults(results, onOpenMemory, elements.results, doc);
          setPhase("ready");
          setStatus(`已合并文字命中与意思相近结果，共 ${results.length} 件；结果并不表示事实或关系判断。`, "success");
        }).catch((error) => {
          if (destroyed || sourceWorker !== worker) return;
          const query = String(message.query || "").trim();
          Promise.resolve(onFallback(query)).finally(() => {
            if (destroyed || sourceWorker !== worker) return;
            clearResults();
            setPhase("ready");
            setStatus("本机派生索引暂时不可用，已改用字段与线索检索；字段结果不会伪装为按意思找回。", "error");
          });
        });
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
      setStatus(persistentIndexReady
        ? "正在按文字含义寻找；查询向量只发送给当前设备的同源本地服务做融合，不发送给第三方。"
        : "正在按文字含义寻找；查询只在浏览器 Worker 内处理，不发送给服务端或第三方。"
      );
      worker.postMessage({ type: "query", session, query });
    }

    function showUnavailable(error) {
      terminateWorker();
      readyFingerprint = "";
      cachedEntries = [];
      persistentIndexReady = false;
      setPhase("error");
      const reason = String(error?.message || "").trim();
      setStatus(`设备语义不可用。${reason ? ` ${reason}` : ""} 可改用字段与线索检索。`, "error");
    }

    function clearSession(message, clearQuery = false) {
      cancelPendingSnapshot();
      terminateWorker();
      readyFingerprint = "";
      cachedEntries = [];
      persistentIndexReady = false;
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

    async function persistIndex() {
      if (demo || persisting || phase !== "ready" || !cachedEntries.length) return;
      persisting = true;
      setPhase(phase);
      setStatus("正在把派生向量保存到本机 SQLite；记忆正文、照片和声音不会随此请求发送。", "");
      try {
        const response = await fetchImpl(`${INDEX_PATH}/upsert`, {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            entries: cachedEntries.map((entry) => ({
              memoryId: entry.memoryId,
              sourceSha256: entry.sourceSha256,
              vector: vectorToBase64(entry.vector)
            })),
            modelId: "Xenova/bge-small-zh-v1.5",
            modelSha256: "15b717c382bcb518ba457b93ea6850ede7f4f1cd8937454aa06972366cd19bcc",
            projectionVersion: "v1"
          })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw publicError(payload.error || "无法保存派生索引。", payload.code || "SEMANTIC_INDEX_PERSIST_FAILED");
        const requested = Number(payload.requested) || cachedEntries.length;
        const stored = Number(payload.stored) || 0;
        const stale = Number(payload.stale) || 0;
        if (stored < requested || stale > 0) {
          await Promise.resolve(onIndexChanged());
          setStatus("馆藏内容已变化，请重新准备索引后再保存。", "error");
          return;
        }
        setStatus(`已保存 ${stored} 件派生索引到本机 SQLite；它未静态加密，可随时在“我的”中移除。`, "success");
        await Promise.resolve(onIndexChanged());
      } catch (error) {
        setStatus(`派生索引未保存。${String(error?.message || "请稍后重试。")}`, "error");
      } finally {
        persisting = false;
        setPhase(phase);
      }
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
    results.slice(0, 20).forEach((result, index) => {
      if (!validResult(result, index)) return;
      const card = doc.createElement("article");
      card.className = "semantic-recall-result";
      const button = doc.createElement("button");
      button.type = "button";
      button.addEventListener("click", () => onOpenMemory(result.memoryId));
      const meta = doc.createElement("span");
      meta.className = "semantic-recall-result-meta";
      meta.textContent = result.matchLabel || `第 ${index + 1} 个相似结果 · 文字含义排序`;
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
      result.tags.every((tag) => typeof tag === "string") && Number.isFinite(result.similarity) &&
      (result.matchLabel === undefined || ["文字命中", "意思相近", "两者都命中"].includes(result.matchLabel));
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
      persist: "#semanticRecallPersist",
      results: "#semanticRecallResults"
    };
    const elements = Object.fromEntries(Object.entries(ids).map(([key, selector]) => [key, doc.querySelector(selector)]));
    return Object.values(elements).every(Boolean) ? elements : null;
  }

  function createSessionId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `semantic-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function validateIndexEntries(entries, expectedCount) {
    if (!Array.isArray(entries) || entries.length !== expectedCount) {
      throw publicError("设备索引回执缺少可保存的派生向量。", "SEMANTIC_INDEX_RESULT_INVALID");
    }
    const seen = new Set();
    return entries.map((entry) => {
      const memoryId = String(entry?.memoryId || "");
      const sourceSha256 = String(entry?.sourceSha256 || "");
      const vector = entry?.vector instanceof Float32Array ? entry.vector : null;
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/u.test(memoryId) || !/^[a-f0-9]{64}$/u.test(sourceSha256) ||
          !vector || vector.length !== 512 || seen.has(memoryId)) {
        throw publicError("设备索引回执格式无效。", "SEMANTIC_INDEX_RESULT_INVALID");
      }
      for (const value of vector) if (!Number.isFinite(value)) throw publicError("设备索引包含无效向量。", "SEMANTIC_INDEX_RESULT_INVALID");
      seen.add(memoryId);
      return { memoryId, sourceSha256, vector };
    });
  }

  function isPersistentIndexReady(status, snapshot) {
    return Boolean(status) && status.allowed === true && status.persistence === "local-sqlite-derived-cache" &&
      status.modelId === "Xenova/bge-small-zh-v1.5" &&
      status.modelSha256 === "15b717c382bcb518ba457b93ea6850ede7f4f1cd8937454aa06972366cd19bcc" &&
      status.projectionVersion === "v1" && status.cachedCount === snapshot.documentCount &&
      status.fresh === snapshot.documentCount && status.stale === 0 && status.orphaned === 0;
  }

  function vectorToBase64(vector) {
    const bytes = new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength);
    let binary = "";
    for (let index = 0; index < bytes.length; index += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    }
    return btoa(binary);
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
    validateSnapshotEnvelope,
    validateIndexEntries,
    vectorToBase64,
    isPersistentIndexReady
  });
});
