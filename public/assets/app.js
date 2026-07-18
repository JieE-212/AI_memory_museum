const state = {
  memories: [],
  options: { halls: [], emotions: [], sourceTypes: [], importanceLabels: [] },
  demo: null,
  privacy: null,
  health: null,
  draft: null,
  workflow: null,
  editingMemoryId: "",
  pendingSaveMemoryId: "",
  searchResults: null,
  searchResponse: null,
  searchError: "",
  searchRequest: 0,
  insights: null,
  timeCalibrationTimeline: null,
  archaeologyOverview: {},
  route: null,
  routeFocusId: "",
  routeLoadedKey: null,
  routeRequest: 0,
  puzzle: null,
  puzzleSession: 0,
  puzzleMutation: false,
  selectedMemoryId: ""
};

const elements = {
  navButtons: [...document.querySelectorAll("[data-view]")],
  viewPanels: [...document.querySelectorAll("[data-view-panel]")],
  runtimeBadge: document.querySelector("#runtimeBadge"),
  demoNotice: document.querySelector("#demoNotice"),
  statMemories: document.querySelector("#statMemories"),
  statHalls: document.querySelector("#statHalls"),
  statTags: document.querySelector("#statTags"),
  statFavorites: document.querySelector("#statFavorites"),
  collectionMeta: document.querySelector("#collectionMeta"),
  searchInput: document.querySelector("#searchInput"),
  hallFilter: document.querySelector("#hallFilter"),
  sortSelect: document.querySelector("#sortSelect"),
  clearFiltersButton: document.querySelector("#clearFiltersButton"),
  memoryGrid: document.querySelector("#memoryGrid"),
  emptyState: document.querySelector("#emptyState"),
  searchErrorState: document.querySelector("#searchErrorState"),
  searchErrorMessage: document.querySelector("#searchErrorMessage"),
  retrySearchButton: document.querySelector("#retrySearchButton"),
  memoryForm: document.querySelector("#memoryForm"),
  rawContent: document.querySelector("#rawContent"),
  charCount: document.querySelector("#charCount"),
  sampleButton: document.querySelector("#sampleButton"),
  analyzeButton: document.querySelector("#analyzeButton"),
  analyzeStatus: document.querySelector("#analyzeStatus"),
  draftPlaceholder: document.querySelector("#draftPlaceholder"),
  draftForm: document.querySelector("#draftForm"),
  draftTitleInput: document.querySelector("#draftTitleInput"),
  draftExhibitText: document.querySelector("#draftExhibitText"),
  draftHall: document.querySelector("#draftHall"),
  draftSource: document.querySelector("#draftSource"),
  draftDate: document.querySelector("#draftDate"),
  draftLocation: document.querySelector("#draftLocation"),
  draftPeople: document.querySelector("#draftPeople"),
  draftTags: document.querySelector("#draftTags"),
  draftEmotions: document.querySelector("#draftEmotions"),
  draftImportance: document.querySelector("#draftImportance"),
  draftEmotionIntensity: document.querySelector("#draftEmotionIntensity"),
  emotionIntensityOutput: document.querySelector("#emotionIntensityOutput"),
  draftFavorite: document.querySelector("#draftFavorite"),
  workflowSteps: document.querySelector("#workflowSteps"),
  resetDraftButton: document.querySelector("#resetDraftButton"),
  saveMemoryButton: document.querySelector("#saveMemoryButton"),
  guideForm: document.querySelector("#guideForm"),
  guideQuestion: document.querySelector("#guideQuestion"),
  guideAskButton: document.querySelector("#guideAskButton"),
  guideAnswer: document.querySelector("#guideAnswer"),
  citationList: document.querySelector("#citationList"),
  refreshInsightsButton: document.querySelector("#refreshInsightsButton"),
  insightSummary: document.querySelector("#insightSummary"),
  insightTabs: [...document.querySelectorAll("[data-insight-tab]")],
  insightPanels: [...document.querySelectorAll("[data-insight-panel]")],
  timelinePanel: document.querySelector("#timelinePanel"),
  themesPanel: document.querySelector("#themesPanel"),
  routesPanel: document.querySelector("#routesPanel"),
  reportPanel: document.querySelector("#reportPanel"),
  privacySummary: document.querySelector("#privacySummary"),
  dataLocationList: document.querySelector("#dataLocationList"),
  exportButton: document.querySelector("#exportButton"),
  exportRedactedButton: document.querySelector("#exportRedactedButton"),
  exportJsonButton: document.querySelector("#exportJsonButton"),
  exportRedactedJsonButton: document.querySelector("#exportRedactedJsonButton"),
  importFile: document.querySelector("#importFile"),
  purgeButton: document.querySelector("#purgeButton"),
  dataActionStatus: document.querySelector("#dataActionStatus"),
  memoryDialog: document.querySelector("#memoryDialog"),
  dialogHall: document.querySelector("#dialogHall"),
  dialogTitle: document.querySelector("#dialogTitle"),
  dialogBody: document.querySelector("#dialogBody"),
  dialogRouteButton: document.querySelector("#dialogRouteButton"),
  dialogTraceButton: document.querySelector("#dialogTraceButton"),
  dialogEditButton: document.querySelector("#dialogEditButton"),
  dialogDeleteButton: document.querySelector("#dialogDeleteButton"),
  puzzleDialog: document.querySelector("#puzzleDialog"),
  puzzleCloseButton: document.querySelector("#puzzleCloseButton"),
  puzzleStatus: document.querySelector("#puzzleStatus"),
  puzzleBody: document.querySelector("#puzzleBody"),
  puzzleQuestionSection: document.querySelector("#puzzleQuestionSection"),
  puzzleQuestionText: document.querySelector("#puzzleQuestionText"),
  puzzleAnswer: document.querySelector("#puzzleAnswer"),
  puzzleSaveAnswerButton: document.querySelector("#puzzleSaveAnswerButton"),
  puzzleUnknownButton: document.querySelector("#puzzleUnknownButton"),
  puzzleSkipButton: document.querySelector("#puzzleSkipButton"),
  puzzleConfirmButton: document.querySelector("#puzzleConfirmButton"),
  puzzleDecisionNote: document.querySelector("#puzzleDecisionNote"),
  toast: document.querySelector("#toast"),
  footerVersion: document.querySelector("#footerVersion")
};

const sampleMemories = [
  "毕业那天傍晚，我们在操场尽头站了很久。大家都说以后常联系，但真正想说的话反而没有说出口。",
  "有次出差很晚才到家，妈妈没有多问，只把厨房里温着的面端出来。那一刻突然觉得，回家是有人替你留着一盏灯。",
  "雨停后我没有立刻回去，而是沿着河边多走了一段。路灯落在积水里，普通的一天忽然安静了下来。",
  "最迷茫的那段时间，一个朋友突然打来电话。他没有劝我振作，只陪我把混乱的话说完。"
];

let searchTimer = null;
let toastTimer = null;
let mediaController = null, voiceController = null;
let mediaEvidenceController = null, portabilityController = null, mediaCompareControllers = [], mediaLabController = null;
let exhibitionsController = null, capsulesController = null, revisitsController = null, cluesController = null, revisionsController = null, collectionHealthController = null, timeCalibrationController = null;

bindEvents();
initialize();

async function initialize() {
  setRuntimeStatus("正在连接", "loading");
  try {
    const [options, memoriesPayload, demo, privacy, health, version, archaeology] = await Promise.all([
      requestJson("/api/options"),
      requestJson("/api/memories"),
      requestJson("/api/demo/status"),
      requestJson("/api/privacy"),
      requestJson("/api/health"),
      requestJson("/api/version"),
      requestJson("/api/archaeology/overview").catch(() => ({ overview: [] }))
    ]);
    state.options = options;
    state.memories = memoriesPayload.memories || [];
    state.demo = demo;
    state.privacy = privacy;
    state.health = health;
    state.archaeologyOverview = indexArchaeologyOverview(archaeology.overview);
    mediaController = window.TimeIsleMedia?.createController({ policy: options.mediaPolicy, demo: demo.interviewDemo }) || null;
    initializeVoiceController(options.voicePolicy, demo.interviewDemo);
    mediaEvidenceController = window.TimeIsleMediaEvidence?.createController({ demo: demo.interviewDemo }) || null;
    portabilityController = window.TimeIslePortability?.createController({
      demo: demo.interviewDemo,
      onRestored: reloadMemories
    }) || null;
    mediaLabController = window.TimeIsleMediaLab?.createController({ demo: demo.interviewDemo }) || null;
    exhibitionsController = window.TimeIsleExhibitions?.createController({ demo: demo.interviewDemo, onOpenMemory: openMemory }) || null;
    capsulesController = window.TimeIsleCapsules?.createController({ demo: demo.interviewDemo }) || null;
    revisitsController = window.TimeIsleRevisits?.createController({ demo: demo.interviewDemo, onOpenMemory: openMemory }) || null;
    cluesController = window.TimeIsleClues?.createEntityDialogController({ demo: demo.interviewDemo, onOpenMemory: openMemory, onDataChanged: reloadMemories }) || null;
    revisionsController = window.TimeIsleRevisions?.createController({ demo: demo.interviewDemo, onOpenMemory: openMemory, onRestored: async (memory) => { await reloadMemories(); await openMemory(memory.id); } }) || null;
    collectionHealthController = window.TimeIsleCollectionHealth?.createController({ demo: demo.interviewDemo }) || null;
    initializeTimeCalibrationController(demo.interviewDemo);
    populateOptions();
    renderApp();
    elements.footerVersion.textContent = `v${version.version || "8.0.0"}`;
    setRuntimeStatus(demo.interviewDemo ? "Demo 已连接" : "本地馆藏已连接", "ready");
    const initialView = normalizeView(location.hash.replace("#", ""));
    switchView(initialView, { updateHash: false });
  } catch (error) {
    setRuntimeStatus("连接失败", "error");
    elements.collectionMeta.textContent = error.message;
    showVoiceUnavailable();
    showToast(`无法连接项目：${error.message}`, true);
  }
}

function initializeVoiceController(policy, demo) {
  try {
    if (typeof window.TimeIsleVoice?.createController !== "function") throw new Error("声音模块未加载");
    voiceController = window.TimeIsleVoice.createController({ policy, demo });
    if (!voiceController) throw new Error("声音控制器未能创建");
  } catch (error) {
    console.error("声音模块初始化失败：", error); voiceController = null;
    showVoiceUnavailable("声音模块未能加载，请刷新页面重试。", "声音模块暂不可用；其他馆藏功能不受影响。");
  }
}

function initializeTimeCalibrationController(demo) {
  try {
    if (typeof window.TimeIsleTimeCalibrations?.createController !== "function") throw new Error("时间校准模块未加载");
    timeCalibrationController = window.TimeIsleTimeCalibrations.createController({
      demo,
      onBusyChange: (busy) => setPuzzleBusy(busy, { fromTimeCalibration: true }),
      onChanged: async () => {
        state.insights = null;
        const timelineActive = elements.insightTabs.some((button) => button.dataset.insightTab === "timeline" && button.classList.contains("is-active"));
        if (timelineActive) await loadInsights(true);
      }
    });
  } catch (error) {
    console.error("时间校准模块初始化失败：", error);
    timeCalibrationController = null;
  }
}

function bindEvents() {
  elements.navButtons.forEach((button) => button.addEventListener("click", () => switchView(button.dataset.view)));
  document.querySelectorAll("[data-go-view]").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.goView, { focusHeading: true })));
  document.querySelectorAll("[data-view-link]").forEach((link) => link.addEventListener("click", (event) => {
    event.preventDefault();
    switchView(link.dataset.viewLink);
  }));
  window.addEventListener("hashchange", () => switchView(normalizeView(location.hash.replace("#", "")), { updateHash: false }));

  elements.searchInput.addEventListener("input", scheduleSearch);
  elements.hallFilter.addEventListener("change", renderCollection);
  elements.sortSelect.addEventListener("change", renderCollection);
  elements.clearFiltersButton.addEventListener("click", clearFilters);
  elements.retrySearchButton.addEventListener("click", performSearch);
  elements.memoryGrid.addEventListener("click", handleMemoryLinkClick);
  elements.citationList.addEventListener("click", handleMemoryLinkClick);
  elements.timelinePanel.addEventListener("click", handleTimelineClick);
  elements.themesPanel.addEventListener("click", handleMemoryLinkClick);
  elements.routesPanel.addEventListener("click", handleRouteClick);
  elements.reportPanel.addEventListener("click", handleMemoryLinkClick);
  elements.dialogBody.addEventListener("click", handleMemoryLinkClick);

  elements.rawContent.addEventListener("input", updateCharCount);
  elements.sampleButton.addEventListener("click", insertSample);
  elements.memoryForm.addEventListener("submit", analyzeMemory);
  elements.draftForm.addEventListener("submit", saveDraft);
  elements.resetDraftButton.addEventListener("click", resetComposer);
  elements.draftEmotionIntensity.addEventListener("input", updateEmotionIntensity);

  elements.guideForm.addEventListener("submit", askGuide);
  document.querySelectorAll("[data-question]").forEach((button) => button.addEventListener("click", () => {
    elements.guideQuestion.value = button.dataset.question;
    elements.guideForm.requestSubmit();
  }));

  elements.refreshInsightsButton.addEventListener("click", () => {
    loadInsights(true);
    if (elements.insightTabs.some((button) => button.dataset.insightTab === "routes" && button.classList.contains("is-active"))) {
      loadRoutes(state.routeFocusId, true);
    }
  });
  elements.insightTabs.forEach((button) => {
    button.addEventListener("click", () => switchInsightTab(button.dataset.insightTab));
    button.addEventListener("keydown", handleInsightTabKeydown);
  });

  elements.exportJsonButton.addEventListener("click", () => exportMemories("full"));
  elements.exportRedactedJsonButton.addEventListener("click", () => exportMemories("redacted"));
  elements.importFile.addEventListener("change", importMemories);
  elements.purgeButton.addEventListener("click", purgeMemories);

  elements.dialogRouteButton.addEventListener("click", openSelectedMemoryRoute);
  elements.dialogTraceButton.addEventListener("click", showAgentTrace);
  elements.dialogEditButton.addEventListener("click", editSelectedMemory);
  elements.dialogDeleteButton.addEventListener("click", deleteSelectedMemory);
  elements.memoryDialog.addEventListener("close", () => { mediaEvidenceController?.close(); mediaLabController?.close(); });
  elements.puzzleSaveAnswerButton.addEventListener("click", () => savePuzzleAnswer("answer"));
  elements.puzzleUnknownButton.addEventListener("click", () => savePuzzleAnswer("keep_unknown"));
  elements.puzzleSkipButton.addEventListener("click", () => savePuzzleAnswer("skip"));
  elements.puzzleConfirmButton.addEventListener("click", confirmPuzzleEvent);
  elements.puzzleAnswer.addEventListener("input", updatePuzzleAnswerAction);
  elements.puzzleDialog.addEventListener("cancel", (event) => {
    if (state.puzzleMutation) event.preventDefault();
  });
  elements.puzzleDialog.addEventListener("close", () => {
    state.puzzleSession += 1;
    state.puzzleMutation = false;
    timeCalibrationController?.reset();
    destroyMediaCompare();
  });
}

function renderApp() {
  renderDemoStatus();
  renderStats();
  renderCollection();
  renderPrivacy();
  updateCharCount();
  updateEmotionIntensity();
}

function switchView(view, options = {}) {
  const target = normalizeView(view);
  elements.navButtons.forEach((button) => {
    const active = button.dataset.view === target;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-current", active ? "page" : "false");
  });
  elements.viewPanels.forEach((panel) => {
    const active = panel.dataset.viewPanel === target;
    panel.hidden = !active;
    panel.classList.toggle("is-active", active);
  });
  if (options.updateHash !== false && location.hash !== `#${target}`) history.pushState(null, "", `#${target}`);
  if (target === "reflect") {
    if (!state.insights) loadInsights();
    revisitsController?.load();
  }
  if (options.focusHeading) elements.viewPanels.find((panel) => !panel.hidden)?.querySelector("h1")?.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
}
function normalizeView(view) {
  return ["collection", "compose", "reflect", "data"].includes(view) ? view : "collection";
}

function renderDemoStatus() {
  const demo = Boolean(state.demo?.interviewDemo);
  mediaController?.setDemo(demo);
  voiceController?.setDemo(demo);
  mediaEvidenceController?.setDemo(demo);
  portabilityController?.setDemo(demo);
  mediaLabController?.setDemo(demo);
  exhibitionsController?.setDemo(demo);
  capsulesController?.setDemo(demo);
  revisitsController?.setDemo(demo);
  cluesController?.setDemo(demo);
  revisionsController?.setDemo(demo); collectionHealthController?.setDemo(demo);
  elements.demoNotice.hidden = !demo;
  elements.purgeButton.disabled = demo;
  elements.purgeButton.title = demo ? "公开 Demo 已禁用清空操作" : "永久清空本地 SQLite 馆藏";
  elements.dialogDeleteButton.disabled = demo;
  elements.importFile.disabled = demo;
  elements.importFile.previousElementSibling?.classList.toggle("is-disabled", demo);
  elements.importFile.previousElementSibling?.setAttribute("aria-disabled", String(demo));
}

function renderStats() {
  const memories = state.memories;
  elements.statMemories.textContent = String(memories.length);
  elements.statHalls.textContent = String(new Set(memories.map((memory) => memory.hall)).size);
  elements.statTags.textContent = String(new Set(memories.flatMap((memory) => memory.tags || [])).size);
  elements.statFavorites.textContent = String(memories.filter((memory) => memory.favorite).length);
}

function populateOptions() {
  const hallOptions = state.options.halls.map((hall) => `<option value="${escapeHtml(hall.id)}">${escapeHtml(hall.name)}</option>`).join("");
  elements.hallFilter.innerHTML = `<option value="all">全部展厅</option>${hallOptions}`;
  elements.draftHall.innerHTML = hallOptions;
  elements.draftSource.innerHTML = state.options.sourceTypes.map((source) => `<option value="${escapeHtml(source)}">${escapeHtml(source)}</option>`).join("");
}

function scheduleSearch() {
  clearTimeout(searchTimer);
  state.searchRequest += 1;
  searchTimer = setTimeout(performSearch, 260);
}

async function performSearch() {
  clearTimeout(searchTimer);
  const query = elements.searchInput.value.trim();
  const requestId = ++state.searchRequest;
  if (!query) {
    state.searchResults = null;
    state.searchResponse = null;
    state.searchError = "";
    renderCollection();
    return;
  }
  state.searchError = "";
  elements.searchErrorState.hidden = true;
  elements.memoryGrid.setAttribute("aria-busy", "true");
  elements.collectionMeta.textContent = "正在沿语义线索寻找展品…";
  try {
    const payload = await requestJson(`/api/search?limit=50&query=${encodeURIComponent(query)}`);
    if (requestId !== state.searchRequest) return;
    state.searchResponse = window.TimeIsleClues?.normalizeSearchResponse(payload) || { results: payload.results || [], engine: {} };
    state.searchResults = state.searchResponse.results.map((item) => ({ ...state.memories.find((memory) => memory.id === item.memory.id), ...item.memory }));
    state.searchError = "";
    renderCollection();
  } catch (error) {
    if (requestId !== state.searchRequest) return;
    state.searchResults = [];
    state.searchResponse = null;
    state.searchError = error?.message
      ? `暂时无法完成这次检索：${error.message}`
      : "本次检索没有完成，请稍后重试。";
    renderCollection();
  }
}

function clearFilters() {
  elements.searchInput.value = "";
  elements.hallFilter.value = "all";
  elements.sortSelect.value = "recent";
  state.searchResults = null;
  state.searchResponse = null;
  state.searchError = "";
  state.searchRequest += 1;
  renderCollection();
}

function getVisibleMemories() {
  const source = state.searchResults === null ? state.memories : state.searchResults;
  const hall = elements.hallFilter.value;
  const memories = source.filter((memory) => hall === "all" || memory.hall === hall);
  const sort = elements.sortSelect.value;
  return memories.sort((a, b) => {
    if (sort === "oldest") return getMemoryTimestamp(a) - getMemoryTimestamp(b);
    if (sort === "importance") return Number(b.importance) - Number(a.importance) || getMemoryTimestamp(b) - getMemoryTimestamp(a);
    if (sort === "title") return String(a.title).localeCompare(String(b.title), "zh-CN");
    return getMemoryTimestamp(b) - getMemoryTimestamp(a);
  });
}

function renderCollection() {
  elements.memoryGrid.removeAttribute("aria-busy");
  if (state.searchError) {
    elements.collectionMeta.textContent = "检索失败，请重试。";
    elements.memoryGrid.innerHTML = "";
    elements.emptyState.hidden = true;
    elements.searchErrorMessage.textContent = state.searchError;
    elements.searchErrorState.hidden = false;
    return;
  }
  const visible = getVisibleMemories();
  const query = elements.searchInput.value.trim();
  const filterNote = elements.hallFilter.value === "all" ? "" : ` · ${hallName(elements.hallFilter.value)}`;
  elements.collectionMeta.textContent = query
    ? `“${query}”找到 ${visible.length} 件展品${filterNote}${state.searchResponse?.engine.shortQueryFallback ? " · 已兼容短线索" : ""}`
    : `馆内共有 ${state.memories.length} 件展品，当前显示 ${visible.length} 件${filterNote}`;
  elements.searchErrorState.hidden = true;
  elements.emptyState.hidden = visible.length > 0;
  elements.memoryGrid.innerHTML = visible.map(renderMemoryCard).join("");
}
function renderMemoryCard(memory) {
  const tags = [...(memory.tags || []), ...(memory.emotions || [])].slice(0, 4);
  const versionCount = state.archaeologyOverview[memory.id]?.versionCount || 1;
  const searchResult = state.searchResponse?.results.find((item) => item.memory.id === memory.id);
  return `
    <article class="memory-card">
      <button type="button" class="memory-card-button" data-memory-id="${escapeHtml(memory.id)}" aria-label="查看《${escapeHtml(memory.title)}》"></button>
      <div class="memory-kicker">
        <span>${escapeHtml(hallName(memory.hall))}${memory.date ? ` · ${escapeHtml(formatDate(memory.date))}` : ""}</span>
        ${memory.favorite ? '<span class="favorite-mark" aria-label="重点展品">★</span>' : ""}
      </div>
      ${window.TimeIsleMedia?.renderCardMedia(memory, escapeHtml) || ""}
      <h3>${escapeHtml(memory.title)}</h3>
      <p class="memory-excerpt">${escapeHtml(memory.exhibitText || memory.rawContent || "暂无展品说明")}</p>
      <div class="tag-list">${tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>
      ${window.TimeIsleVoice?.renderCardSummary(memory, escapeHtml) || ""}
      ${versionCount > 1 ? `<span class="memory-version-badge">${escapeHtml(String(versionCount))} 个记忆版本</span>` : ""}
      ${searchResult ? window.TimeIsleClues?.renderSearchEvidence(searchResult, state.searchResponse.engine) || "" : ""}
    </article>`;
}
function handleMemoryLinkClick(event) {
  const target = event.target.closest("[data-memory-id], [data-open-memory]");
  if (!target) return;
  const memoryId = target.dataset.memoryId || target.dataset.openMemory;
  void openMemory(memoryId).catch((error) => {
    console.error("打开展品详情失败：", error);
    showToast(`无法打开这件展品：${error.message}`, true);
  });
}

async function openMemory(id) {
  const updatingOpenDialog = elements.memoryDialog.open;
  let memory = state.memories.find((item) => item.id === id);
  if (!memory) {
    try {
      memory = (await requestJson(`/api/memories/${encodeURIComponent(id)}`)).memory;
    } catch (error) {
      showToast(error.message, true);
      return false;
    }
  }
  state.selectedMemoryId = memory.id;
  elements.dialogHall.textContent = hallName(memory.hall);
  elements.dialogTitle.textContent = memory.title;
  elements.dialogBody.innerHTML = renderMemoryDetail(memory);
  elements.dialogBody.scrollTop = 0;
  mediaEvidenceController?.open(memory, elements.dialogBody);
  mediaLabController?.open(memory, elements.dialogBody);
  revisionsController?.open(memory, elements.dialogBody);
  elements.dialogRouteButton.disabled = state.memories.length < 2;
  elements.dialogRouteButton.title = state.memories.length < 2 ? "至少需要两件展品才能生成航线" : "查看与这件展品有关的记忆";
  elements.dialogTraceButton.disabled = !memory.agentRunId;
  elements.dialogTraceButton.textContent = memory.agentRunId ? "查看整理记录" : "没有整理记录";
  elements.dialogDeleteButton.disabled = Boolean(state.demo?.interviewDemo);
  elements.dialogDeleteButton.hidden = Boolean(state.demo?.interviewDemo);
  const protectedDemoMemory = Boolean(state.demo?.interviewDemo && memory.id.startsWith("demo-"));
  elements.dialogEditButton.disabled = protectedDemoMemory;
  elements.dialogEditButton.title = protectedDemoMemory ? "公开 Demo 的预置展品不可修改" : "编辑这件展品";
  if (!elements.memoryDialog.open) elements.memoryDialog.showModal();
  else if (updatingOpenDialog) elements.dialogTitle.focus({ preventScroll: true });
  return true;
}

function renderMemoryDetail(memory) {
  return `
    ${window.TimeIsleMedia?.renderDetailGallery(memory, escapeHtml) || ""}
    ${window.TimeIsleVoice?.renderDetailVoices(memory, escapeHtml) || ""}
    ${window.TimeIsleMediaEvidence?.renderPanel(memory) || ""}
    ${window.TimeIsleMediaLab?.renderPanel(memory, escapeHtml) || ""}
    <div class="tag-list">${renderEntityChips(memory, "theme", memory.tags || [], true)}${(memory.emotions || []).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>
    <p class="detail-text">${escapeHtml(memory.exhibitText || "暂无展品说明")}</p>
    <div class="detail-grid">
      <div class="detail-field"><small>日期</small><strong>${escapeHtml(formatDate(memory.date) || "未注明")}</strong></div>
      <div class="detail-field"><small>地点</small>${renderEntityChips(memory, "place", memory.location)}</div>
      <div class="detail-field"><small>人物</small>${renderEntityChips(memory, "person", memory.people || [])}</div>
      <div class="detail-field"><small>来源</small><strong>${escapeHtml(memory.sourceType || "其他")}</strong></div>
      <div class="detail-field"><small>重要度</small><strong>${escapeHtml(String(memory.importance || 1))} / 5</strong></div>
      <div class="detail-field"><small>情绪强度</small><strong>${escapeHtml(String(memory.emotionIntensity || 3))} / 5</strong></div>
    </div>
    <h3>原始记忆</h3>
    <div class="detail-raw">${escapeHtml(memory.rawContent || "未保留原文")}</div>`;
}
function renderEntityChips(memory, type, fallback, tags = false) {
  const refs = (memory.entityRefs || memory.entities || []).filter((item) => ({ people: "person", location: "place" }[item.type] || item.type) === type && (item.id || item.entityId));
  if (!refs.length) {
    const values = Array.isArray(fallback) ? fallback : [fallback];
    return tags ? values.filter(Boolean).map((value) => `<span class="tag">${escapeHtml(value)}</span>`).join("") : `<strong>${escapeHtml(values.filter(Boolean).join("、") || "未注明")}</strong>`;
  }
  return `<span class="clue-entity-chips clue-detail-entities">${refs.map((item) => `<button type="button" class="clue-entity-chip" data-entity-id="${escapeHtml(item.id || item.entityId)}"><span aria-hidden="true">${type === "person" ? "人" : type === "place" ? "地" : "题"}</span>${escapeHtml(item.label || item.canonicalName || item.name || item.sourceValue || "未命名线索")}</button>`).join("")}</span>`;
}
function insertSample() {
  const current = elements.rawContent.value.trim();
  const candidates = sampleMemories.filter((sample) => sample !== current);
  elements.rawContent.value = candidates[Math.floor(Math.random() * candidates.length)] || sampleMemories[0];
  updateCharCount();
  elements.rawContent.focus();
}

async function analyzeMemory(event) {
  event.preventDefault();
  const rawContent = elements.rawContent.value.trim();
  if (!rawContent) return;
  setAnalyzeStatus("正在整理原始线索、展厅和说明…");
  elements.analyzeButton.disabled = true;
  elements.analyzeButton.textContent = "整理中…";
  try {
    const result = await requestJson("/api/analyze", {
      method: "POST",
      body: JSON.stringify({ rawContent })
    });
    state.draft = { ...result.draft, rawContent };
    state.workflow = result.workflow;
    populateDraft(state.draft);
    renderWorkflow(result.workflow);
    elements.draftPlaceholder.hidden = true;
    elements.draftForm.hidden = false;
    setAnalyzeStatus(result.notice || "整理完成，请确认后保存。", false, true);
    elements.draftTitleInput.focus();
  } catch (error) {
    setAnalyzeStatus(error.message, true);
  } finally {
    elements.analyzeButton.disabled = false;
    elements.analyzeButton.textContent = "AI 帮我整理";
  }
}

function populateDraft(draft) {
  elements.draftTitleInput.value = draft.title || "";
  elements.draftExhibitText.value = draft.exhibitText || "";
  elements.draftHall.value = draft.hall || "daily";
  elements.draftSource.value = draft.sourceType || "其他";
  elements.draftDate.value = draft.date || "";
  elements.draftLocation.value = draft.location || "";
  elements.draftPeople.value = (draft.people || []).join("，");
  elements.draftTags.value = (draft.tags || []).join("，");
  elements.draftEmotions.value = (draft.emotions || []).join("，");
  elements.draftImportance.value = String(draft.importance || 2);
  elements.draftEmotionIntensity.value = String(draft.emotionIntensity || 3);
  elements.draftFavorite.checked = Boolean(draft.favorite);
  updateEmotionIntensity();
}

function renderWorkflow(workflow) {
  const steps = workflow?.steps || [];
  elements.workflowSteps.className = "workflow-steps";
  elements.workflowSteps.innerHTML = steps.map((step, index) => `
    <div class="workflow-step">
      <span class="workflow-step-index">${index + 1}</span>
      <div><strong>${escapeHtml(step.agent)}</strong><span>${escapeHtml(step.output || step.duty)}</span></div>
    </div>`).join("");
}

async function saveDraft(event) {
  event.preventDefault();
  if (!state.draft) return;
  const memory = {
    ...state.draft,
    title: elements.draftTitleInput.value.trim(),
    exhibitText: elements.draftExhibitText.value.trim(),
    hall: elements.draftHall.value,
    sourceType: elements.draftSource.value,
    date: elements.draftDate.value.trim(),
    location: elements.draftLocation.value.trim(),
    people: parseList(elements.draftPeople.value),
    tags: parseList(elements.draftTags.value),
    emotions: parseList(elements.draftEmotions.value),
    importance: Number(elements.draftImportance.value),
    emotionIntensity: Number(elements.draftEmotionIntensity.value),
    favorite: elements.draftFavorite.checked,
    agentRunId: state.workflow?.run?.id || state.draft.agentRunId || ""
  };
  elements.saveMemoryButton.disabled = true;
  elements.saveMemoryButton.textContent = "保存中…";
  const editing = Boolean(state.editingMemoryId);
  const targetMemoryId = state.editingMemoryId || state.pendingSaveMemoryId;
  let contentSaved = false;
  let attachmentsSaved = Boolean(state.demo?.interviewDemo);
  if (targetMemoryId) { memory.id = targetMemoryId; memory.expectedUpdatedAt = state.draft.updatedAt || ""; }
  try {
    await runAttachmentControllers("waitForReady");
    const saved = await requestJson(targetMemoryId ? `/api/memories/${encodeURIComponent(targetMemoryId)}` : "/api/memories", {
      method: targetMemoryId ? "PUT" : "POST",
      body: JSON.stringify(memory)
    });
    contentSaved = true;
    state.draft = { ...saved.memory }; state.pendingSaveMemoryId = saved.memory.id;
    if (!state.demo?.interviewDemo) {
      await runAttachmentControllers("saveToMemory", saved.memory.id);
      attachmentsSaved = true;
    }
    await reloadMemories();
    resetComposer();
    switchView("collection", { focusHeading: true });
    showToast(editing ? "展品修改已保存。" : "记忆已经保存为展品。", false);
  } catch (error) {
    if (contentSaved && !attachmentsSaved) setAnalyzeStatus(`展品正文已保存，${error.message}。请修正后点击“继续完成保存”；不会重复创建展品。`, true);
    else if (contentSaved) setAnalyzeStatus(`展品已保存，但页面刷新失败：${error.message}。点击“继续完成保存”会复用同一件展品。`, true);
    else if (state.pendingSaveMemoryId) setAnalyzeStatus(`未能继续完成保存：${error.message}。再次尝试仍会复用同一件展品。`, true);
    else setAnalyzeStatus(error.message, true);
  } finally {
    elements.saveMemoryButton.disabled = false;
    elements.saveMemoryButton.textContent = saveButtonLabel();
  }
}

async function runAttachmentControllers(method, memoryId) {
  try { const results = await Promise.allSettled([mediaController?.[method](memoryId), voiceController?.[method](memoryId)]), failed = results.find((item) => item.status === "rejected"); if (failed) throw failed.reason; return results.map((item) => item.value); }
  catch (error) { throw new Error(`附件未完成：${error.message}`); }
}
function saveButtonLabel() {
  if (state.pendingSaveMemoryId) return "继续完成保存";
  return state.editingMemoryId ? "保存修改" : "保存到博物馆";
}

function resetComposer() {
  state.draft = null;
  state.workflow = null;
  state.editingMemoryId = "";
  state.pendingSaveMemoryId = "";
  mediaController?.reset();
  voiceController?.reset();
  elements.memoryForm.reset();
  elements.draftForm.reset();
  elements.draftForm.hidden = true;
  elements.draftPlaceholder.hidden = false;
  elements.workflowSteps.innerHTML = "";
  elements.saveMemoryButton.textContent = saveButtonLabel();
  setAnalyzeStatus("");
  updateCharCount();
  updateEmotionIntensity();
}

function updateCharCount() {
  elements.charCount.textContent = `${elements.rawContent.value.length} / 4000`;
}

function updateEmotionIntensity() {
  elements.emotionIntensityOutput.textContent = `${elements.draftEmotionIntensity.value} / 5`;
}

function setAnalyzeStatus(message, isError = false, isSuccess = false) {
  elements.analyzeStatus.textContent = message;
  elements.analyzeStatus.classList.toggle("is-error", isError);
  elements.analyzeStatus.classList.toggle("is-success", isSuccess);
}

async function askGuide(event) {
  event.preventDefault();
  const question = elements.guideQuestion.value.trim();
  if (!question) return;
  elements.guideAskButton.disabled = true;
  elements.guideAskButton.textContent = "查找中…";
  elements.guideAnswer.classList.add("is-loading");
  elements.guideAnswer.textContent = "正在检索馆藏并核对引用…";
  elements.citationList.innerHTML = "";
  try {
    const result = await requestJson("/api/guide", {
      method: "POST",
      body: JSON.stringify({ question })
    });
    elements.guideAnswer.classList.remove("is-loading");
    elements.guideAnswer.textContent = result.answer;
    elements.citationList.innerHTML = (result.citations || []).map((citation, index) => `
      <div class="citation-item">
        <button type="button" data-memory-id="${escapeHtml(citation.id)}">
          <strong>[${index + 1}] ${escapeHtml(citation.title)}</strong>
          <span>${escapeHtml(citation.reason || citation.confidence?.reason || "馆藏引用")}</span>
        </button>
      </div>`).join("");
  } catch (error) {
    elements.guideAnswer.classList.remove("is-loading");
    elements.guideAnswer.textContent = error.message;
  } finally {
    elements.guideAskButton.disabled = false;
    elements.guideAskButton.textContent = "提问";
  }
}

async function loadInsights(force = false) {
  if (state.insights && !force) {
    renderInsights();
    return;
  }
  elements.refreshInsightsButton.disabled = true;
  elements.insightSummary.textContent = "正在整理时间、主题和重点展品…";
  try {
    const [insights, timeCalibrationTimeline] = await Promise.all([
      requestJson("/api/insights"),
      requestJson("/api/timeline?limit=100&order=asc").catch(() => ({ count: 0, entries: [] }))
    ]);
    state.insights = insights;
    state.timeCalibrationTimeline = timeCalibrationTimeline;
    renderInsights();
  } catch (error) {
    elements.insightSummary.textContent = `回顾生成失败：${error.message}`;
  } finally {
    elements.refreshInsightsButton.disabled = false;
  }
}

function renderInsights() {
  const insights = state.insights;
  if (!insights) return;
  elements.insightSummary.innerHTML = insights.overview.total
    ? `<strong>${escapeHtml(String(insights.overview.total))} 件展品</strong> · ${escapeHtml(String(insights.overview.timelinePeriods))} 个时间段 · ${escapeHtml(String(insights.overview.themes))} 个主题 · ${escapeHtml(String(insights.overview.favorites))} 件重点`
    : "馆里还没有展品，先记录几段记忆再回来回顾。";

  const calibrationLedger = window.TimeIsleTimeCalibrations?.renderTimelineLedger(state.timeCalibrationTimeline?.entries || [], escapeHtml, formatDate) || "";
  elements.timelinePanel.innerHTML = calibrationLedger + (insights.timeline.length
    ? `<div class="timeline-list">${insights.timeline.map((item) => `
        <article class="timeline-item">
          <div class="timeline-item-header"><strong>${escapeHtml(item.label)}</strong><span>${escapeHtml(String(item.count))} 件</span></div>
          <div class="memory-links">${renderMemoryLinks(item.memories)}</div>
        </article>`).join("")}</div>`
    : '<p class="muted">展品补充日期后，会在这里形成时间线。</p>');

  elements.themesPanel.innerHTML = insights.themes.length
    ? `<div class="theme-list">${insights.themes.map((theme) => `
        <article class="theme-item">
          <div class="theme-item-header"><strong>${escapeHtml(theme.name)}</strong><span>${escapeHtml(theme.type)} · ${escapeHtml(String(theme.count))} 件</span></div>
          <p>${escapeHtml(theme.summary)}</p>
          <div class="memory-links">${renderMemoryLinks(theme.memories)}</div>
        </article>`).join("")}</div>`
    : '<p class="muted">继续补充标签、人物或情绪后，会出现主题聚合。</p>';

  elements.reportPanel.innerHTML = `
    <div class="report-content">
      <h3>${escapeHtml(insights.report.title)}</h3>
      <p>${escapeHtml(insights.report.summary)}</p>
      ${(insights.report.highlights || []).map((memory) => `<div class="report-highlight"><strong>${escapeHtml(memory.title)}</strong><p>${escapeHtml(memory.excerpt)}</p><div class="memory-links"><button type="button" data-open-memory="${escapeHtml(memory.id)}">查看展品</button></div></div>`).join("")}
    </div>`;
}

function handleTimelineClick(event) {
  const puzzleLink = event.target.closest("[data-puzzle-left][data-puzzle-right]");
  if (puzzleLink) {
    void openPuzzle(puzzleLink.dataset.puzzleLeft, puzzleLink.dataset.puzzleRight);
    return;
  }
  handleMemoryLinkClick(event);
}

function renderMemoryLinks(memories = []) {
  return memories.map((memory) => `<button type="button" data-open-memory="${escapeHtml(memory.id)}">${escapeHtml(memory.title)}</button>`).join("");
}

async function loadRoutes(focusId = "", force = false) {
  const normalizedFocus = String(focusId || "");
  if (!force && state.route && state.routeLoadedKey === normalizedFocus) {
    renderRoutes();
    return;
  }
  const requestId = ++state.routeRequest;
  state.routeFocusId = normalizedFocus;
  elements.routesPanel.innerHTML = '<p class="muted">正在寻找馆藏之间有依据的联系…</p>';
  try {
    const suffix = normalizedFocus ? `?focus=${encodeURIComponent(normalizedFocus)}&limit=4` : "";
    const payload = await requestJson(`/api/archaeology/routes${suffix}`);
    if (requestId !== state.routeRequest) return;
    state.route = payload;
    state.routeLoadedKey = normalizedFocus;
    state.archaeologyOverview = indexArchaeologyOverview(state.route.overview);
    renderRoutes();
    renderCollection();
  } catch (error) {
    if (requestId !== state.routeRequest) return;
    state.route = null;
    state.routeLoadedKey = null;
    elements.routesPanel.innerHTML = `<div class="route-empty"><strong>暂时无法生成航线</strong><span>${escapeHtml(error.message)}</span></div>`;
  }
}

function renderRoutes() {
  const payload = state.route;
  if (!payload?.route) return;
  const route = payload.route;
  if (payload.kind === "focus") {
    if (!route.focus || !route.connections?.length) {
      elements.routesPanel.innerHTML = '<button type="button" class="route-back" data-route-featured>← 返回今日航线</button><div class="route-empty"><strong>这座岛暂时没有清晰航线</strong><span>继续记录人物、地点、日期或主题，关系会逐渐出现。</span></div>';
      return;
    }
    elements.routesPanel.innerHTML = `
      <button type="button" class="route-back" data-route-featured>← 返回今日航线</button>
      <p class="route-intro">只展示少量可解释关联；它们不是“同一事件”的自动结论。</p>
      ${renderRouteFocus(route.focus, "当前展品")}
      <div class="route-list">${route.connections.map((connection, index) => renderRouteCard({
        index,
        leftId: route.focus.id,
        rightId: connection.memory.id,
        memory: connection.memory,
        summary: connection.summary,
        strength: connection.strength
      })).join("")}</div>`;
    return;
  }

  if (!route.items?.length || route.status === "empty_collection") {
    elements.routesPanel.innerHTML = '<div class="route-empty"><strong>馆藏还没有形成航线</strong><span>保存两段带人物、地点或主题的记忆后再来看看。</span></div>';
    return;
  }
  const itemMap = Object.fromEntries(route.items.map((item) => [item.id, item]));
  elements.routesPanel.innerHTML = `
    <p class="route-intro">${escapeHtml(route.description || "从少量展品开始漫游")}<span>${escapeHtml(route.guidance || "航线只提供关联建议。")}</span></p>
    ${renderRouteFocus(route.items[0], route.title || "今日记忆航线")}
    ${route.transitions?.length ? `<div class="route-list">${route.transitions.map((transition, index) => renderRouteCard({
      index,
      leftId: transition.fromId,
      rightId: transition.toId,
      memory: itemMap[transition.toId],
      summary: transition.summary,
      strength: transition.strength
    })).join("")}</div>` : '<div class="route-empty"><span>暂时只有一个停靠点，继续补充馆藏后会出现新的航线。</span></div>'}`;
}

function renderRouteFocus(memory, label) {
  return `<div class="route-focus"><small>${escapeHtml(label)}</small><strong>${escapeHtml(memory.title)}</strong><span>${escapeHtml(memory.date ? formatDate(memory.date) : memory.excerpt || "从这件展品出发")}</span></div>`;
}

function renderRouteCard({ index, leftId, rightId, memory, summary, strength }) {
  if (!memory) return "";
  const strengthLabel = strength === "strong" ? "关联较强" : strength === "medium" ? "可参考" : "轻关联";
  return `
    <button type="button" class="route-card" data-puzzle-left="${escapeHtml(leftId)}" data-puzzle-right="${escapeHtml(rightId)}">
      <span class="route-marker">${escapeHtml(String(index + 1).padStart(2, "0"))}</span>
      <span class="route-card-copy"><strong>${escapeHtml(memory.title)}</strong><span>${escapeHtml(summary || memory.excerpt || "查看关联依据")}</span></span>
      <span class="route-strength">${escapeHtml(strengthLabel)} · 查看拼图</span>
    </button>`;
}

function handleRouteClick(event) {
  if (event.target.closest("[data-route-featured]")) {
    loadRoutes("", true);
    return;
  }
  const puzzleLink = event.target.closest("[data-puzzle-left][data-puzzle-right]");
  if (puzzleLink) openPuzzle(puzzleLink.dataset.puzzleLeft, puzzleLink.dataset.puzzleRight);
}

function openSelectedMemoryRoute() {
  if (!state.selectedMemoryId || state.memories.length < 2) return;
  const focusId = state.selectedMemoryId;
  elements.memoryDialog.close();
  state.routeFocusId = focusId;
  switchView("reflect");
  switchInsightTab("routes");
  elements.routesPanel.focus({ preventScroll: true });
}

async function openPuzzle(leftId, rightId) {
  if (!leftId || !rightId || leftId === rightId) return;
  const session = ++state.puzzleSession;
  state.puzzle = null;
  state.puzzleMutation = false;
  resetPuzzleDialog();
  if (!elements.puzzleDialog.open) elements.puzzleDialog.showModal();
  requestAnimationFrame(() => document.querySelector("#puzzleTitle")?.focus({ preventScroll: true }));
  try {
    const query = new URLSearchParams({ memoryId: leftId, relatedId: rightId });
    const payload = await requestJson(`/api/archaeology/puzzle?${query}`);
    if (session !== state.puzzleSession) return;
    state.puzzle = payload;
    renderPuzzle();
  } catch (error) {
    if (session !== state.puzzleSession) return;
    elements.puzzleStatus.textContent = error.message;
    elements.puzzleStatus.classList.add("is-error");
    elements.puzzleBody.innerHTML = '<div class="route-empty"><span>没有生成任何未经核验的比较结论。</span></div>';
  }
}

function renderPuzzle() {
  const payload = state.puzzle;
  const puzzle = payload?.puzzle;
  if (!puzzle) return;
  elements.puzzleStatus.classList.remove("is-success", "is-error");
  elements.puzzleStatus.textContent = `${puzzle.summary.stable} 条稳定线索 · ${puzzle.summary.differs} 处描述差异 · ${puzzle.summary.additions} 条单侧补充`;
  elements.puzzleBody.innerHTML = `
    <div class="puzzle-source-grid">
      ${renderPuzzleSource("第一段记录", puzzle.pair.left)}
      ${renderPuzzleSource("第二段记录", puzzle.pair.right)}
    </div>
    ${payload.imageCompare?.left?.length && payload.imageCompare?.right?.length ? window.TimeIsleMediaCompare?.renderComparison(payload.imageCompare, escapeHtml) || "" : ""}
    ${renderPuzzleGroup("稳定锚点", "两段原文都能核对", puzzle.stable, "is-stable", 3)}
    ${renderPuzzleGroup("描述不同", "只展示双侧都有原文依据的差异", puzzle.differs, "is-different", 3)}
    ${renderPuzzleGroup("后来补充", "另一段未提及，不代表矛盾", puzzle.additions, "", 3)}
    ${renderPuzzleGroup("仍未确定", "缺少原文锚点，因此不下结论", puzzle.unknowns, "", 2)}`;
  mediaCompareControllers = window.TimeIsleMediaCompare?.hydrate(elements.puzzleBody) || [];

  const confirmed = payload.decision?.decision === "same_event" || Boolean(payload.event);
  const demoConfirmed = confirmed && Boolean(state.demo?.interviewDemo);
  elements.puzzleConfirmButton.disabled = demoConfirmed;
  elements.puzzleConfirmButton.classList.toggle("primary", !confirmed);
  elements.puzzleConfirmButton.classList.toggle("secondary", confirmed);
  elements.puzzleConfirmButton.textContent = confirmed ? demoConfirmed ? "Demo 中已分组" : "解除版本分组" : "确认属于同一往事";
  elements.puzzleDecisionNote.textContent = confirmed
    ? `已保存为“${payload.event?.title || "时光拼图"}”，原文仍分别保留；需要时可以解除分组。`
    : "确认会保存版本分组，但不会合并或改写原文。";

  const calibrationTarget = timeCalibrationController?.syncPuzzle({
    payload,
    demo: Boolean(state.demo?.interviewDemo),
    sessionKey: state.puzzleSession
  });

  const questionAlreadyHandled = (payload.savedQuestions || []).some((item) => item.question === payload.question?.question);
  const dateQuestionHandledByCalibration = calibrationTarget?.handlesDateQuestion && payload.question?.basedOn?.field === "date";
  elements.puzzleQuestionSection.hidden = !payload.question?.available || questionAlreadyHandled || dateQuestionHandledByCalibration;
  if (!elements.puzzleQuestionSection.hidden) {
    elements.puzzleQuestionText.textContent = payload.question.question;
    elements.puzzleAnswer.value = "";
    updatePuzzleAnswerAction();
  } else if (questionAlreadyHandled) {
    elements.puzzleStatus.textContent += " · 这块拼图已经留下处理记录";
  }
}

function renderPuzzleSource(label, memory) {
  return `<article class="puzzle-source"><small>${escapeHtml(label)}${memory.date ? ` · ${escapeHtml(formatDate(memory.date))}` : ""}</small><strong>${escapeHtml(memory.title)}</strong><span>${escapeHtml(memory.excerpt || "未提供摘要")}</span></article>`;
}

function renderPuzzleGroup(title, note, items = [], modifier = "", visibleLimit = 3) {
  if (!items.length) return "";
  const visible = items.slice(0, visibleLimit);
  const remaining = items.slice(visibleLimit);
  return `
    <section class="puzzle-group">
      <div class="puzzle-group-header"><h3>${escapeHtml(title)}</h3><span>${escapeHtml(note)}</span></div>
      <div class="puzzle-evidence-grid">${visible.map((item) => renderPuzzleEvidence(item, modifier)).join("")}</div>
      ${remaining.length ? `<details class="puzzle-more"><summary>查看其余 ${remaining.length} 条</summary><div class="puzzle-evidence-grid">${remaining.map((item) => renderPuzzleEvidence(item, modifier)).join("")}</div></details>` : ""}
    </section>`;
}

function renderPuzzleEvidence(item, modifier) {
  return `
    <article class="puzzle-evidence ${modifier}">
      <strong>${escapeHtml(item.statement)}</strong>
      <span>${escapeHtml(item.fieldLabel || "线索")} · ${item.verified ? "原文已核验" : "保留未知"}</span>
      ${(item.sources || []).filter((source) => source.valid).map((source) => `<q>${escapeHtml(source.sourceQuote)}</q>`).join("")}
    </article>`;
}

async function savePuzzleAnswer(action) {
  const pair = state.puzzle?.puzzle?.pair;
  if (!pair || state.puzzleMutation) return;
  const answer = elements.puzzleAnswer.value.trim();
  if (action === "answer" && !answer) {
    elements.puzzleStatus.textContent = "请先写下补充，或选择保留不确定。";
    elements.puzzleStatus.classList.add("is-error");
    return;
  }
  const session = state.puzzleSession;
  const activePair = puzzlePairKey(pair);
  setPuzzleBusy(true);
  try {
    const result = await requestJson("/api/archaeology/questions", {
      method: "POST",
      body: JSON.stringify({
        memoryId: pair.left.id,
        relatedId: pair.right.id,
        action,
        answer
      })
    });
    if (!isCurrentPuzzleSession(session, activePair)) return;
    state.puzzle.savedQuestions = [...(state.puzzle.savedQuestions || []), result.question];
    renderPuzzle();
    elements.puzzleStatus.textContent = action === "answer" ? "补充已经单独保存，原始记忆没有被覆盖。" : action === "keep_unknown" ? "已明确保留这处不确定。" : "已跳过这道问题。";
    elements.puzzleStatus.classList.remove("is-error");
    elements.puzzleStatus.classList.add("is-success");
  } catch (error) {
    if (!isCurrentPuzzleSession(session, activePair)) return;
    elements.puzzleStatus.textContent = error.message;
    elements.puzzleStatus.classList.remove("is-success");
    elements.puzzleStatus.classList.add("is-error");
  } finally {
    if (session === state.puzzleSession) setPuzzleBusy(false);
  }
}

async function confirmPuzzleEvent() {
  const pair = state.puzzle?.puzzle?.pair;
  if (!pair || state.puzzleMutation) return;
  if (state.puzzle?.event) {
    if (state.demo?.interviewDemo) return;
    await removePuzzleEvent();
    return;
  }
  if (!window.confirm("确认把这两段记录保存为同一往事的两个版本吗？原文不会被合并或改写。")) return;
  const session = state.puzzleSession;
  const activePair = puzzlePairKey(pair);
  setPuzzleBusy(true);
  elements.puzzleConfirmButton.textContent = "保存中…";
  try {
    const result = await requestJson("/api/archaeology/events", {
      method: "POST",
      body: JSON.stringify({ memoryIds: [pair.left.id, pair.right.id] })
    });
    if (!isCurrentPuzzleSession(session, activePair)) return;
    state.archaeologyOverview = indexArchaeologyOverview(result.overview);
    state.puzzle.event = result.event;
    state.puzzle.decision = { decision: "same_event" };
    renderCollection();
    renderPuzzle();
    await loadRoutes(state.routeFocusId, true);
    showToast("时光拼图已保存，两段原文仍分别保留。", false);
  } catch (error) {
    if (!isCurrentPuzzleSession(session, activePair)) return;
    elements.puzzleStatus.textContent = error.message;
    elements.puzzleStatus.classList.remove("is-success");
    elements.puzzleStatus.classList.add("is-error");
    elements.puzzleConfirmButton.disabled = false;
    elements.puzzleConfirmButton.textContent = "确认属于同一往事";
  } finally {
    if (session === state.puzzleSession) setPuzzleBusy(false);
  }
}

async function removePuzzleEvent() {
  const eventId = state.puzzle?.event?.id;
  const pair = state.puzzle?.puzzle?.pair;
  if (!eventId || !pair || state.puzzleMutation) return;
  if (!window.confirm("解除这组时光拼图吗？两段原文会继续保留；已保存的字段证据与这组时间校准会被移除。")) return;
  const session = state.puzzleSession;
  const activePair = puzzlePairKey(pair);
  setPuzzleBusy(true);
  elements.puzzleConfirmButton.textContent = "解除中…";
  try {
    const result = await requestJson(`/api/archaeology/events/${encodeURIComponent(eventId)}`, { method: "DELETE" });
    if (!isCurrentPuzzleSession(session, activePair)) return;
    state.archaeologyOverview = indexArchaeologyOverview(result.overview);
    state.puzzle.event = null;
    state.puzzle.decision = null;
    timeCalibrationController?.reset();
    renderCollection();
    renderPuzzle();
    await loadRoutes(state.routeFocusId, true);
    showToast("版本分组已解除，两段原文仍保留。", false);
  } catch (error) {
    if (!isCurrentPuzzleSession(session, activePair)) return;
    renderPuzzle();
    elements.puzzleStatus.textContent = error.message;
    elements.puzzleStatus.classList.remove("is-success");
    elements.puzzleStatus.classList.add("is-error");
  } finally {
    if (session === state.puzzleSession) setPuzzleBusy(false);
  }
}

function setPuzzleBusy(busy, options = {}) {
  state.puzzleMutation = busy;
  elements.puzzleSaveAnswerButton.disabled = busy || !elements.puzzleAnswer.value.trim();
  elements.puzzleUnknownButton.disabled = busy;
  elements.puzzleSkipButton.disabled = busy;
  elements.puzzleConfirmButton.disabled = busy || Boolean(state.demo?.interviewDemo && state.puzzle?.event);
  elements.puzzleCloseButton.disabled = busy;
  if (!options.fromTimeCalibration) timeCalibrationController?.setHostBusy?.(busy);
}

function updatePuzzleAnswerAction() {
  elements.puzzleSaveAnswerButton.disabled = state.puzzleMutation || !elements.puzzleAnswer.value.trim();
}

function resetPuzzleDialog() {
  destroyMediaCompare();
  timeCalibrationController?.reset();
  elements.puzzleBody.innerHTML = "";
  elements.puzzleStatus.textContent = "正在逐条核对原文证据…";
  elements.puzzleStatus.classList.remove("is-success", "is-error");
  elements.puzzleQuestionSection.hidden = true;
  elements.puzzleAnswer.value = "";
  elements.puzzleConfirmButton.disabled = true;
  elements.puzzleConfirmButton.textContent = "确认属于同一往事";
  elements.puzzleConfirmButton.classList.add("primary");
  elements.puzzleConfirmButton.classList.remove("secondary");
  elements.puzzleDecisionNote.textContent = "系统只提供关联建议，不会自动合并原文。";
  elements.puzzleCloseButton.disabled = false;
  updatePuzzleAnswerAction();
}

function destroyMediaCompare() {
  mediaCompareControllers.forEach((controller) => controller.destroy());
  mediaCompareControllers = [];
}

function puzzlePairKey(pair) {
  return [pair?.left?.id, pair?.right?.id].filter(Boolean).sort().join("|");
}

function isCurrentPuzzleSession(session, pairKey) {
  return session === state.puzzleSession && pairKey === puzzlePairKey(state.puzzle?.puzzle?.pair);
}

function indexArchaeologyOverview(items = []) {
  return Object.fromEntries((items || []).map((item) => [item.memoryId, item]));
}

function switchInsightTab(tab) {
  elements.insightTabs.forEach((button) => {
    const active = button.dataset.insightTab === tab;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  });
  elements.insightPanels.forEach((panel) => {
    panel.hidden = panel.dataset.insightPanel !== tab;
  });
  if (tab === "routes") loadRoutes(state.routeFocusId);
}

function handleInsightTabKeydown(event) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const current = elements.insightTabs.indexOf(event.currentTarget);
  const next = event.key === "Home"
    ? 0
    : event.key === "End"
      ? elements.insightTabs.length - 1
      : (current + (event.key === "ArrowRight" ? 1 : -1) + elements.insightTabs.length) % elements.insightTabs.length;
  const button = elements.insightTabs[next];
  switchInsightTab(button.dataset.insightTab);
  button.focus();
}

function renderPrivacy() {
  if (!state.privacy) return;
  elements.privacySummary.textContent = state.privacy.summary;
  elements.dataLocationList.innerHTML = (state.privacy.dataLocations || []).map((item) => `
    <div class="data-location-item"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.location)}</span></div>`).join("");
}

async function exportMemories(mode) {
  setDataStatus("正在准备导出…");
  try {
    const suffix = mode === "redacted" ? "?mode=redacted" : "";
    const payload = await requestJson(`/api/memories/export${suffix}`);
    downloadJson(payload, `time-isle-${mode}-${new Date().toISOString().slice(0, 10)}.json`);
    setDataStatus(mode === "redacted" ? "脱敏版本已下载。" : "馆藏与记忆考古备份已下载；整理运行日志不在备份内。", false, true);
  } catch (error) {
    setDataStatus(error.message, true);
  }
}

async function importMemories(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  setDataStatus(`正在读取 ${file.name}…`);
  try {
    const payload = JSON.parse(await file.text());
    const memories = Array.isArray(payload) ? payload : payload.memories;
    if (!Array.isArray(memories)) throw new Error("文件中没有 memories 数组。");
    if (!window.confirm(`准备导入 ${memories.length} 条记忆。已有相同 ID 的记录会作为新展品保存，是否继续？`)) return;
    const result = await requestJson("/api/memories/import", {
      method: "POST",
      body: JSON.stringify({ memories, ...(payload?.archaeology ? { archaeology: payload.archaeology } : {}) })
    });
    await reloadMemories();
    const archaeologyNote = result.archaeology?.events
      ? `，并恢复 ${result.archaeology.events} 组时光拼图`
      : "";
    setDataStatus(`已导入 ${result.imported} 条记忆${archaeologyNote}。`, false, true);
  } catch (error) {
    setDataStatus(`导入失败：${error.message}`, true);
  } finally {
    elements.importFile.value = "";
  }
}
async function purgeMemories() {
  if (state.demo?.interviewDemo) return;
  const phrase = window.prompt("该操作会永久清空本地 SQLite 馆藏。请输入 DELETE 确认：");
  if (phrase !== "DELETE") {
    setDataStatus("已取消清空操作。");
    return;
  }
  try {
    const result = await requestJson("/api/memories/purge", { method: "DELETE", body: JSON.stringify({ confirm: "DELETE" }) });
    await reloadMemories();
    if (result.mediaCleanupPending) setDataStatus("馆藏记录已清空；部分隔离图片仍在后台重试物理清理。", false, false);
    else setDataStatus("本地馆藏和媒体文件已经清空。", false, true);
  } catch (error) {
    setDataStatus(error.message, true);
  }
}

function setDataStatus(message, isError = false, isSuccess = false) {
  elements.dataActionStatus.textContent = message;
  elements.dataActionStatus.classList.toggle("is-error", isError);
  elements.dataActionStatus.classList.toggle("is-success", isSuccess);
}

async function showAgentTrace() {
  const memory = state.memories.find((item) => item.id === state.selectedMemoryId);
  if (!memory?.agentRunId) return;
  elements.dialogTraceButton.disabled = true;
  elements.dialogTraceButton.textContent = "读取中…";
  try {
    const payload = await requestJson(`/api/memories/${encodeURIComponent(memory.id)}/agent-run`);
    const run = payload.run;
    mediaEvidenceController?.close();
    mediaLabController?.close();
    elements.dialogBody.innerHTML = `
      <p class="muted">本次整理模式：${escapeHtml(run.mode)} · ${escapeHtml(formatDateTime(run.createdAt))}</p>
      <div class="agent-run-detail">${(run.steps || []).map((step, index) => `
        <article><strong>${index + 1}. ${escapeHtml(step.agent)}</strong><span>${escapeHtml(step.duty)}</span><p>${escapeHtml(step.output)}</p></article>`).join("")}</div>`;
    elements.dialogTraceButton.textContent = "已显示整理记录";
  } catch (error) {
    showToast(error.message, true);
    elements.dialogTraceButton.disabled = false;
    elements.dialogTraceButton.textContent = "查看整理记录";
  }
}

async function editSelectedMemory() {
  const memory = state.memories.find((item) => item.id === state.selectedMemoryId);
  if (!memory) return;
  state.editingMemoryId = memory.id;
  state.pendingSaveMemoryId = "";
  state.draft = { ...memory };
  state.workflow = null;
  mediaController?.loadMemory(memory);
  voiceController?.loadMemory(memory);
  elements.rawContent.value = memory.rawContent || "";
  populateDraft(memory);
  elements.draftPlaceholder.hidden = true;
  elements.draftForm.hidden = false;
  elements.saveMemoryButton.textContent = "保存修改";
  elements.workflowSteps.innerHTML = '<p class="muted">这件展品没有可读取的整理记录。</p>';
  if (memory.agentRunId) {
    try {
      const payload = await requestJson(`/api/memories/${encodeURIComponent(memory.id)}/agent-run`);
      state.workflow = { run: payload.run, steps: payload.run.steps || [] };
      renderWorkflow(state.workflow);
    } catch {
      // Editing remains available even if an old workflow record is missing.
    }
  }
  updateCharCount();
  setAnalyzeStatus(`正在编辑《${memory.title}》。修改后点击“保存修改”。`, false, true);
  elements.memoryDialog.close();
  switchView("compose", { focusHeading: true });
}

async function deleteSelectedMemory() {
  if (state.demo?.interviewDemo || !state.selectedMemoryId) return;
  const memory = state.memories.find((item) => item.id === state.selectedMemoryId);
  if (!window.confirm(`确定删除《${memory?.title || "这件展品"}》吗？该操作无法撤销。`)) return;
  try {
    await requestJson(`/api/memories/${encodeURIComponent(state.selectedMemoryId)}`, { method: "DELETE" });
    elements.memoryDialog.close();
    await reloadMemories();
    showToast("展品已删除。", false);
  } catch (error) {
    showToast(error.message, true);
  }
}

async function reloadMemories() {
  const [payload, archaeology] = await Promise.all([
    requestJson("/api/memories"),
    requestJson("/api/archaeology/overview").catch(() => ({ overview: [] }))
  ]);
  state.memories = payload.memories || [];
  state.archaeologyOverview = indexArchaeologyOverview(archaeology.overview);
  state.searchResults = null;
  state.searchResponse = null;
  state.searchError = "";
  state.insights = null;
  state.timeCalibrationTimeline = null;
  state.route = null;
  state.routeFocusId = "";
  state.routeLoadedKey = null;
  state.routeRequest += 1;
  exhibitionsController?.refresh();
  capsulesController?.refresh();
  revisitsController?.invalidate();
  renderStats();
  if (elements.searchInput.value.trim()) await performSearch(); else renderCollection();
}

function downloadJson(payload, filename) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function setRuntimeStatus(message, status) {
  elements.runtimeBadge.textContent = message;
  elements.runtimeBadge.classList.toggle("is-ready", status === "ready"); elements.runtimeBadge.classList.toggle("is-error", status === "error");
}

function showVoiceUnavailable(statusMessage = "请先启动本地服务，再刷新页面重试。", helpMessage = "本地服务未连接，声音录制与音频选择暂不可用。") {
  voiceController?.destroy(); voiceController = null;
  const recordButton = document.querySelector("#voiceRecordButton"), fileInput = document.querySelector("#voiceFileInput");
  const fileLabel = document.querySelector("#voiceFileLabel"), fallbackHelp = document.querySelector("#voiceFallbackHelp"), status = document.querySelector("#voiceStatus");
  if (recordButton) { recordButton.hidden = false; recordButton.disabled = true; recordButton.textContent = "录音暂不可用"; recordButton.setAttribute("aria-busy", "false"); }
  if (fileInput) fileInput.disabled = true;
  if (fileLabel) { fileLabel.classList.add("is-disabled"); fileLabel.setAttribute("aria-disabled", "true"); }
  if (fallbackHelp) fallbackHelp.textContent = helpMessage;
  if (status) { status.textContent = statusMessage; status.classList.add("is-error"); status.classList.remove("is-loading", "is-success"); }
}

function showToast(message, isError) {
  clearTimeout(toastTimer); elements.toast.textContent = message;
  elements.toast.classList.toggle("is-error", Boolean(isError));
  elements.toast.hidden = false;
  toastTimer = setTimeout(() => { elements.toast.hidden = true; }, 3600);
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) }
  });
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) {
    const error = new Error((typeof payload === "object" ? payload.error : payload) || `请求失败（${response.status}）`);
    Object.assign(error, { status: response.status, code: payload?.code || "", updatedAt: payload?.updatedAt || "" }); throw error;
  }
  return payload;
}

function hallName(id) { return state.options.halls.find((hall) => hall.id === id)?.name || "日常展厅"; }

function parseList(value) { return [...new Set(String(value || "").split(/[，,、\n]/).map((item) => item.trim()).filter(Boolean))]; }

function getMemoryTimestamp(memory) {
  const value = memory.date || memory.createdAt || "";
  const timestamp = Date.parse(value); return Number.isNaN(timestamp) ? 0 : timestamp;
}

function formatDate(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const match = text.match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/);
  if (!match) return text;
  if (match[3]) return `${match[1]}.${match[2]}.${match[3]}`; if (match[2]) return `${match[1]}.${match[2]}`;
  return match[1];
}

function formatDateTime(value) {
  const date = new Date(value); return Number.isNaN(date.getTime()) ? String(value || "") : date.toLocaleString("zh-CN", { hour12: false });
}

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
