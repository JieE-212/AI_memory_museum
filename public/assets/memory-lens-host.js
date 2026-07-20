(function initializeTimeIsleMemoryLensHost(root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.TimeIsleMemoryLensHost = factory();
}(typeof globalThis !== "undefined" ? globalThis : self, function createMemoryLensHostModule() {
  "use strict";

  const PREVIEW_PATH = "/api/memory-lens/preview";
  const MEMORIES_PATH = "/api/memories";
  const CURATOR_HANDOFF_FORMAT = "time-isle.memory-lens-curator-handoff";
  const BRIEF_FORMAT = "time-isle.memory-lens-curator-brief";
  const LENSES = new Set(["time", "cooccurrence", "evidence", "clue"]);
  const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/u;
  const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
  const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
  const MIN_MEMORIES = 2;
  const MAX_MEMORIES = 20;
  const MAX_CURATOR_MEMORIES = 6;

  function mount(options = {}) {
    const documentRef = options.document || (typeof document !== "undefined" ? document : null);
    const mountElement = options.mount || documentRef?.querySelector?.("#memoryLensMount");
    const lensUi = options.lensUi || (typeof globalThis !== "undefined" ? globalThis.TimeIsleMemoryLens : null);
    if (!mountElement || typeof lensUi?.renderWorkbench !== "function") return null;
    try {
      mountElement.innerHTML = lensUi.renderWorkbench();
      const curator = options.curator;
      const preselectCurator = !options.demo && typeof curator?.preselectSources === "function"
        ? (handoff) => curator.preselectSources(handoff, mountElement.querySelector("summary"))
        : options.preselectCurator;
      return createHost({
        ...options,
        lensUi,
        root: mountElement.querySelector("[data-memory-lens-root]"),
        ...(typeof preselectCurator === "function" ? { preselectCurator } : {})
      });
    } catch {
      mountElement.textContent = "设备内镜片暂时不可用；其它馆藏功能不受影响。";
      return null;
    }
  }

  function createHost(options = {}) {
    const lensUi = options.lensUi || (typeof globalThis !== "undefined" ? globalThis.TimeIsleMemoryLens : null);
    if (!lensUi || typeof lensUi.createController !== "function") {
      throw hostError("设备内镜片界面模块尚未加载。", "MEMORY_LENS_UI_UNAVAILABLE");
    }
    const fetchImpl = options.fetch || (typeof fetch === "function" ? fetch.bind(globalThis) : null);
    const sourceLoader = typeof options.loadMemories === "function"
      ? options.loadMemories
      : createMemoryLoader({ fetch: fetchImpl });
    const previewClient = typeof options.buildPreview === "function"
      ? options.buildPreview
      : createPreviewClient({ fetch: fetchImpl });
    const preselectCurator = typeof options.preselectCurator === "function" ? options.preselectCurator : null;
    const onCurate = typeof options.onCurate === "function" ? options.onCurate : null;
    const curatorCallback = preselectCurator || onCurate;
    const rootElement = options.root || options.document?.querySelector?.("[data-memory-lens-root]") ||
      (typeof document !== "undefined" ? document.querySelector("[data-memory-lens-root]") : null);
    if (rootElement) rootElement.open = false;

    async function deliverToCurator(brief) {
      const orderedIds = Array.isArray(brief?.orderedMemoryIds) ? brief.orderedMemoryIds : [];
      if (orderedIds.length > MAX_CURATOR_MEMORIES) {
        throw hostError(
          "当前镜片包含 7–20 件展品。请重新明确选择 2–6 件；系统不会静默截断。",
          "MEMORY_LENS_CURATOR_RESELECT_REQUIRED"
        );
      }
      const payload = await sourceLoader({ purpose: "curator-freshness" });
      const currentMemories = Array.isArray(payload) ? payload : payload?.memories;
      const handoff = prepareCuratorHandoff(brief, currentMemories);
      if (preselectCurator) await preselectCurator(handoff, brief);
      else await onCurate(brief, handoff);
    }

    return lensUi.createController({
      ...options,
      root: rootElement || options.root,
      loadMemories: sourceLoader,
      buildPreview: previewClient,
      onCurate: curatorCallback ? deliverToCurator : null
    });
  }

  function createPreviewClient(options = {}) {
    const fetchImpl = options.fetch || (typeof fetch === "function" ? fetch.bind(globalThis) : null);
    if (typeof fetchImpl !== "function") {
      throw hostError("当前环境无法读取镜片预览。", "MEMORY_LENS_FETCH_UNAVAILABLE");
    }

    return async function buildPreview(request, context = {}) {
      const selection = normalizePreviewSelection(request);
      const params = new URLSearchParams();
      params.set("lens", selection.lens);
      selection.memoryIds.forEach((memoryId) => params.append("memoryId", memoryId));
      if (selection.lens === "clue") params.set("query", selection.query);
      const response = await fetchImpl(`${PREVIEW_PATH}?${params.toString()}`, {
        method: "GET",
        headers: { Accept: "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        signal: context.signal
      });
      return readJsonResponse(response);
    };
  }

  function createMemoryLoader(options = {}) {
    const fetchImpl = options.fetch || (typeof fetch === "function" ? fetch.bind(globalThis) : null);
    if (typeof fetchImpl !== "function") {
      throw hostError("当前环境无法读取馆藏。", "MEMORY_LENS_FETCH_UNAVAILABLE");
    }
    return async function loadMemories(context = {}) {
      const response = await fetchImpl(MEMORIES_PATH, {
        method: "GET",
        headers: { Accept: "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        signal: context.signal
      });
      const payload = await readJsonResponse(response);
      if (!Array.isArray(payload?.memories)) {
        throw hostError("馆藏返回内容不完整。", "MEMORY_LENS_COLLECTION_INVALID");
      }
      return payload;
    };
  }

  function normalizePreviewSelection(request) {
    if (!request || typeof request !== "object" || Array.isArray(request)) {
      throw hostError("镜片请求无效。", "MEMORY_LENS_REQUEST_INVALID");
    }
    const lens = String(request.lens || "");
    if (!LENSES.has(lens)) {
      throw hostError("请选择一个有效镜片。", "MEMORY_LENS_REQUEST_INVALID");
    }
    if (!Array.isArray(request.memories) || !isDenseArray(request.memories) ||
        request.memories.length < MIN_MEMORIES || request.memories.length > MAX_MEMORIES) {
      throw hostError("请明确选择 2–20 件展品。", "MEMORY_LENS_MEMORY_COUNT_INVALID");
    }
    const memoryIds = request.memories.map((memory) => String(memory?.id || "").trim());
    if (memoryIds.some((memoryId) => !ID_PATTERN.test(memoryId)) || new Set(memoryIds).size !== memoryIds.length) {
      throw hostError("镜片选择包含无效或重复的展品。", "MEMORY_LENS_MEMORY_INVALID");
    }
    const query = lens === "clue" ? validateQuery(request.query) : "";
    if (lens !== "clue" && Object.hasOwn(request, "query") && String(request.query || "") !== "") {
      throw hostError("只有线索镜片可以携带查询词。", "MEMORY_LENS_QUERY_INVALID");
    }
    return Object.freeze({ lens, memoryIds: Object.freeze(memoryIds), query });
  }

  function prepareCuratorHandoff(brief, currentMemories) {
    if (!brief || typeof brief !== "object" || Array.isArray(brief) || brief.format !== BRIEF_FORMAT ||
        brief.state !== "unsaved-preview" || brief.persisted !== false ||
        brief.engine !== "deterministic-memory-lenses-v1" || !LENSES.has(String(brief.lens?.code || "")) ||
        !SHA256_PATTERN.test(String(brief.sourceSnapshotSha256 || "")) ||
        !SHA256_PATTERN.test(String(brief.previewSha256 || ""))) {
      throw hostError("镜片简报格式无效。", "MEMORY_LENS_CURATOR_BRIEF_INVALID");
    }
    const orderedMemoryIds = normalizeIdList(brief.orderedMemoryIds);
    if (orderedMemoryIds.length < MIN_MEMORIES) {
      throw hostError("策展预选至少需要 2 件展品。", "MEMORY_LENS_CURATOR_BRIEF_INVALID");
    }
    if (orderedMemoryIds.length > MAX_CURATOR_MEMORIES) {
      throw hostError(
        "当前镜片包含 7–20 件展品。请重新明确选择 2–6 件；系统不会静默截断。",
        "MEMORY_LENS_CURATOR_RESELECT_REQUIRED"
      );
    }
    if (!Array.isArray(brief.sourceRefs) || brief.sourceRefs.length !== orderedMemoryIds.length) {
      throw hostError("镜片简报缺少完整来源回执。", "MEMORY_LENS_CURATOR_BRIEF_INVALID");
    }
    const sourceRefs = brief.sourceRefs.map((reference) => {
      const memoryId = String(reference?.memoryId || "").trim();
      const updatedAt = String(reference?.updatedAt || "");
      if (!ID_PATTERN.test(memoryId) || !isTimestamp(updatedAt)) {
        throw hostError("镜片简报来源回执无效。", "MEMORY_LENS_CURATOR_BRIEF_INVALID");
      }
      return { memoryId, updatedAt };
    });
    if (!sameIdSet(orderedMemoryIds, sourceRefs.map((entry) => entry.memoryId))) {
      throw hostError("镜片顺序与来源回执不一致。", "MEMORY_LENS_CURATOR_BRIEF_INVALID");
    }

    const currentById = new Map((Array.isArray(currentMemories) ? currentMemories : []).flatMap((memory) => {
      const memoryId = String(memory?.id || "").trim();
      return ID_PATTERN.test(memoryId) ? [[memoryId, memory]] : [];
    }));
    for (const reference of sourceRefs) {
      if (String(currentById.get(reference.memoryId)?.updatedAt || "") !== reference.updatedAt) {
        throw hostError(
          "至少一件来源展品已变化或不再存在。请重新生成镜片后再带入策展。",
          "MEMORY_LENS_SOURCE_STALE"
        );
      }
    }

    return deepFreeze({
      format: CURATOR_HANDOFF_FORMAT,
      version: 1,
      state: "unsaved-explicit-preselection",
      persisted: false,
      autoRun: false,
      autoSave: false,
      autoPublish: false,
      memoryIds: [...orderedMemoryIds],
      sourceRefs: sourceRefs.map((entry) => ({ ...entry })),
      lens: { ...brief.lens },
      query: String(brief.query || ""),
      sourceSnapshotSha256: String(brief.sourceSnapshotSha256 || ""),
      previewSha256: String(brief.previewSha256 || ""),
      boundary: "仅预选用户刚刚明确选择的 2–6 件展品；仍需用户决定策展内容，不自动运行、保存或发布。"
    });
  }

  async function readJsonResponse(response) {
    if (!response || typeof response.json !== "function") {
      throw hostError("服务器没有返回可读取的结果。", "MEMORY_LENS_RESPONSE_INVALID");
    }
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw hostError("服务器返回的镜片结果不是有效 JSON。", "MEMORY_LENS_RESPONSE_INVALID");
    }
    if (!response.ok) {
      const message = typeof payload?.error === "string"
        ? payload.error
        : typeof payload?.message === "string"
          ? payload.message
          : `镜片请求未完成（HTTP ${Number(response.status) || 0}）。`;
      const error = hostError(message, String(payload?.code || "MEMORY_LENS_REQUEST_FAILED"));
      error.statusCode = Number(response.status) || 0;
      throw error;
    }
    return payload;
  }

  function validateQuery(value) {
    if (typeof value !== "string" || value.length > 320 || /[\u0000-\u001F\u007F]/u.test(value)) {
      throw hostError("线索查询格式无效。", "MEMORY_LENS_QUERY_INVALID");
    }
    const query = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
    const terms = query ? query.split(" ") : [];
    const distinctTerms = new Set(terms.map((term) => term.normalize("NFKC").toLowerCase()));
    if ([...query].length < 1 || [...query].length > 160 || distinctTerms.size > 8 ||
        terms.some((term) => [...term].length > 40)) {
      throw hostError("线索查询需要 1–8 个明确词语。", "MEMORY_LENS_QUERY_INVALID");
    }
    return query;
  }

  function normalizeIdList(value) {
    if (!Array.isArray(value)) {
      throw hostError("镜片简报缺少展品顺序。", "MEMORY_LENS_CURATOR_BRIEF_INVALID");
    }
    const ids = value.map((item) => String(item || "").trim());
    if (ids.some((id) => !ID_PATTERN.test(id)) || new Set(ids).size !== ids.length) {
      throw hostError("镜片简报包含无效或重复展品。", "MEMORY_LENS_CURATOR_BRIEF_INVALID");
    }
    return ids;
  }

  function sameIdSet(left, right) {
    if (left.length !== right.length || new Set(right).size !== right.length) return false;
    const expected = new Set(left);
    return right.every((id) => expected.has(id));
  }

  function isTimestamp(value) {
    if (!TIMESTAMP_PATTERN.test(value)) return false;
    const parsed = new Date(value);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
  }

  function isDenseArray(value) {
    if (!Array.isArray(value)) return false;
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) return false;
    }
    return true;
  }

  function deepFreeze(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
    return value;
  }

  function hostError(message, code) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  return Object.freeze({
    PREVIEW_PATH,
    MEMORIES_PATH,
    CURATOR_HANDOFF_FORMAT,
    LIMITS: Object.freeze({ minMemories: MIN_MEMORIES, maxMemories: MAX_MEMORIES, maxCuratorMemories: MAX_CURATOR_MEMORIES }),
    mount,
    createHost,
    createPreviewClient,
    createMemoryLoader,
    normalizePreviewSelection,
    prepareCuratorHandoff
  });
}));
