const state = {
  memories: [],
  options: { halls: [], emotions: [], sourceTypes: [], importanceLabels: [] },
  demo: null,
  privacy: null,
  health: null,
  draft: null,
  workflow: null,
  editingMemoryId: "",
  searchResults: null,
  searchRequest: 0,
  insights: null,
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
  reportPanel: document.querySelector("#reportPanel"),
  privacySummary: document.querySelector("#privacySummary"),
  dataLocationList: document.querySelector("#dataLocationList"),
  exportButton: document.querySelector("#exportButton"),
  exportRedactedButton: document.querySelector("#exportRedactedButton"),
  importFile: document.querySelector("#importFile"),
  purgeButton: document.querySelector("#purgeButton"),
  dataActionStatus: document.querySelector("#dataActionStatus"),
  memoryDialog: document.querySelector("#memoryDialog"),
  dialogHall: document.querySelector("#dialogHall"),
  dialogTitle: document.querySelector("#dialogTitle"),
  dialogBody: document.querySelector("#dialogBody"),
  dialogTraceButton: document.querySelector("#dialogTraceButton"),
  dialogEditButton: document.querySelector("#dialogEditButton"),
  dialogDeleteButton: document.querySelector("#dialogDeleteButton"),
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

bindEvents();
initialize();

async function initialize() {
  setRuntimeStatus("正在连接", "loading");
  try {
    const [options, memoriesPayload, demo, privacy, health, version] = await Promise.all([
      requestJson("/api/options"),
      requestJson("/api/memories"),
      requestJson("/api/demo/status"),
      requestJson("/api/privacy"),
      requestJson("/api/health"),
      requestJson("/api/version")
    ]);
    state.options = options;
    state.memories = memoriesPayload.memories || [];
    state.demo = demo;
    state.privacy = privacy;
    state.health = health;
    populateOptions();
    renderApp();
    elements.footerVersion.textContent = `v${version.version || "2.0.1"}`;
    setRuntimeStatus(demo.interviewDemo ? "Demo 已连接" : "本地馆藏已连接", "ready");
    const initialView = normalizeView(location.hash.replace("#", ""));
    switchView(initialView, { updateHash: false });
  } catch (error) {
    setRuntimeStatus("连接失败", "error");
    elements.collectionMeta.textContent = error.message;
    showToast(`无法连接项目：${error.message}`, true);
  }
}

function bindEvents() {
  elements.navButtons.forEach((button) => button.addEventListener("click", () => switchView(button.dataset.view)));
  document.querySelectorAll("[data-go-view]").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.goView)));
  document.querySelectorAll("[data-view-link]").forEach((link) => link.addEventListener("click", (event) => {
    event.preventDefault();
    switchView(link.dataset.viewLink);
  }));
  window.addEventListener("hashchange", () => switchView(normalizeView(location.hash.replace("#", "")), { updateHash: false }));

  elements.searchInput.addEventListener("input", scheduleSearch);
  elements.hallFilter.addEventListener("change", renderCollection);
  elements.sortSelect.addEventListener("change", renderCollection);
  elements.clearFiltersButton.addEventListener("click", clearFilters);
  elements.memoryGrid.addEventListener("click", handleMemoryLinkClick);
  elements.citationList.addEventListener("click", handleMemoryLinkClick);
  elements.timelinePanel.addEventListener("click", handleMemoryLinkClick);
  elements.themesPanel.addEventListener("click", handleMemoryLinkClick);
  elements.reportPanel.addEventListener("click", handleMemoryLinkClick);

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

  elements.refreshInsightsButton.addEventListener("click", () => loadInsights(true));
  elements.insightTabs.forEach((button) => button.addEventListener("click", () => switchInsightTab(button.dataset.insightTab)));

  elements.exportButton.addEventListener("click", () => exportMemories("full"));
  elements.exportRedactedButton.addEventListener("click", () => exportMemories("redacted"));
  elements.importFile.addEventListener("change", importMemories);
  elements.purgeButton.addEventListener("click", purgeMemories);

  elements.dialogTraceButton.addEventListener("click", showAgentTrace);
  elements.dialogEditButton.addEventListener("click", editSelectedMemory);
  elements.dialogDeleteButton.addEventListener("click", deleteSelectedMemory);
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
  elements.navButtons.forEach((button) => button.classList.toggle("is-active", button.dataset.view === target));
  elements.viewPanels.forEach((panel) => {
    const active = panel.dataset.viewPanel === target;
    panel.hidden = !active;
    panel.classList.toggle("is-active", active);
  });
  if (options.updateHash !== false && location.hash !== `#${target}`) history.pushState(null, "", `#${target}`);
  if (target === "reflect" && !state.insights) loadInsights();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function normalizeView(view) {
  return ["collection", "compose", "reflect", "data"].includes(view) ? view : "collection";
}

function renderDemoStatus() {
  const demo = Boolean(state.demo?.interviewDemo);
  elements.demoNotice.hidden = !demo;
  elements.purgeButton.disabled = demo;
  elements.purgeButton.title = demo ? "公开 Demo 已禁用清空操作" : "永久清空本地 SQLite 馆藏";
  elements.dialogDeleteButton.disabled = demo;
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
  searchTimer = setTimeout(performSearch, 260);
}

async function performSearch() {
  const query = elements.searchInput.value.trim();
  const requestId = ++state.searchRequest;
  if (!query) {
    state.searchResults = null;
    renderCollection();
    return;
  }
  elements.collectionMeta.textContent = "正在进行混合检索…";
  try {
    const payload = await requestJson(`/api/search?mode=hybrid&limit=50&query=${encodeURIComponent(query)}`);
    if (requestId !== state.searchRequest) return;
    state.searchResults = (payload.results || []).map((item) => item.memory);
    renderCollection();
  } catch (error) {
    if (requestId !== state.searchRequest) return;
    state.searchResults = [];
    elements.collectionMeta.textContent = `检索失败：${error.message}`;
  }
}

function clearFilters() {
  elements.searchInput.value = "";
  elements.hallFilter.value = "all";
  elements.sortSelect.value = "recent";
  state.searchResults = null;
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
  const visible = getVisibleMemories();
  const query = elements.searchInput.value.trim();
  const filterNote = elements.hallFilter.value === "all" ? "" : ` · ${hallName(elements.hallFilter.value)}`;
  elements.collectionMeta.textContent = query
    ? `“${query}”找到 ${visible.length} 件展品${filterNote}`
    : `馆内共有 ${state.memories.length} 件展品，当前显示 ${visible.length} 件${filterNote}`;
  elements.emptyState.hidden = visible.length > 0;
  elements.memoryGrid.innerHTML = visible.map(renderMemoryCard).join("");
}

function renderMemoryCard(memory) {
  const tags = [...(memory.tags || []), ...(memory.emotions || [])].slice(0, 4);
  return `
    <article class="memory-card">
      <button type="button" class="memory-card-button" data-memory-id="${escapeHtml(memory.id)}" aria-label="查看《${escapeHtml(memory.title)}》"></button>
      <div class="memory-kicker">
        <span>${escapeHtml(hallName(memory.hall))}${memory.date ? ` · ${escapeHtml(formatDate(memory.date))}` : ""}</span>
        ${memory.favorite ? '<span class="favorite-mark" aria-label="重点展品">★</span>' : ""}
      </div>
      <h3>${escapeHtml(memory.title)}</h3>
      <p class="memory-excerpt">${escapeHtml(memory.exhibitText || memory.rawContent || "暂无展品说明")}</p>
      <div class="tag-list">${tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>
    </article>`;
}

function handleMemoryLinkClick(event) {
  const target = event.target.closest("[data-memory-id], [data-open-memory]");
  if (!target) return;
  openMemory(target.dataset.memoryId || target.dataset.openMemory);
}

async function openMemory(id) {
  let memory = state.memories.find((item) => item.id === id);
  if (!memory) {
    try {
      memory = (await requestJson(`/api/memories/${encodeURIComponent(id)}`)).memory;
    } catch (error) {
      showToast(error.message, true);
      return;
    }
  }
  state.selectedMemoryId = memory.id;
  elements.dialogHall.textContent = hallName(memory.hall);
  elements.dialogTitle.textContent = memory.title;
  elements.dialogBody.innerHTML = renderMemoryDetail(memory);
  elements.dialogTraceButton.disabled = !memory.agentRunId;
  elements.dialogTraceButton.textContent = memory.agentRunId ? "查看 Agent 记录" : "没有 Agent 记录";
  elements.dialogDeleteButton.disabled = Boolean(state.demo?.interviewDemo);
  elements.dialogDeleteButton.hidden = Boolean(state.demo?.interviewDemo);
  if (!elements.memoryDialog.open) elements.memoryDialog.showModal();
}

function renderMemoryDetail(memory) {
  const tags = [...(memory.tags || []), ...(memory.emotions || [])];
  return `
    <div class="tag-list">${tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>
    <p class="detail-text">${escapeHtml(memory.exhibitText || "暂无展品说明")}</p>
    <div class="detail-grid">
      <div class="detail-field"><small>日期</small><strong>${escapeHtml(formatDate(memory.date) || "未注明")}</strong></div>
      <div class="detail-field"><small>地点</small><strong>${escapeHtml(memory.location || "未注明")}</strong></div>
      <div class="detail-field"><small>人物</small><strong>${escapeHtml((memory.people || []).join("、") || "未注明")}</strong></div>
      <div class="detail-field"><small>来源</small><strong>${escapeHtml(memory.sourceType || "其他")}</strong></div>
      <div class="detail-field"><small>重要度</small><strong>${escapeHtml(String(memory.importance || 1))} / 5</strong></div>
      <div class="detail-field"><small>情绪强度</small><strong>${escapeHtml(String(memory.emotionIntensity || 3))} / 5</strong></div>
    </div>
    <h3>原始记忆</h3>
    <div class="detail-raw">${escapeHtml(memory.rawContent || "未保留原文")}</div>`;
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
  if (editing) memory.id = state.editingMemoryId;
  try {
    await requestJson(editing ? `/api/memories/${encodeURIComponent(state.editingMemoryId)}` : "/api/memories", {
      method: editing ? "PUT" : "POST",
      body: JSON.stringify(memory)
    });
    await reloadMemories();
    resetComposer();
    switchView("collection");
    showToast(editing ? "展品修改已保存。" : "记忆已经保存为展品。", false);
  } catch (error) {
    setAnalyzeStatus(error.message, true);
  } finally {
    elements.saveMemoryButton.disabled = false;
    elements.saveMemoryButton.textContent = "保存到博物馆";
  }
}

function resetComposer() {
  state.draft = null;
  state.workflow = null;
  state.editingMemoryId = "";
  elements.memoryForm.reset();
  elements.draftForm.reset();
  elements.draftForm.hidden = true;
  elements.draftPlaceholder.hidden = false;
  elements.workflowSteps.innerHTML = "";
  elements.saveMemoryButton.textContent = "保存到博物馆";
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
    state.insights = await requestJson("/api/insights");
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

  elements.timelinePanel.innerHTML = insights.timeline.length
    ? `<div class="timeline-list">${insights.timeline.map((item) => `
        <article class="timeline-item">
          <div class="timeline-item-header"><strong>${escapeHtml(item.label)}</strong><span>${escapeHtml(String(item.count))} 件</span></div>
          <div class="memory-links">${renderMemoryLinks(item.memories)}</div>
        </article>`).join("")}</div>`
    : '<p class="muted">展品补充日期后，会在这里形成时间线。</p>';

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

function renderMemoryLinks(memories = []) {
  return memories.map((memory) => `<button type="button" data-open-memory="${escapeHtml(memory.id)}">${escapeHtml(memory.title)}</button>`).join("");
}

function switchInsightTab(tab) {
  elements.insightTabs.forEach((button) => {
    const active = button.dataset.insightTab === tab;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });
  elements.insightPanels.forEach((panel) => {
    panel.hidden = panel.dataset.insightPanel !== tab;
  });
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
    setDataStatus(mode === "redacted" ? "脱敏版本已下载。" : "完整备份已下载，请妥善保管。", false, true);
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
      body: JSON.stringify({ memories })
    });
    await reloadMemories();
    setDataStatus(`已导入 ${result.imported} 条记忆。`, false, true);
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
    await requestJson("/api/memories/purge", { method: "DELETE", body: JSON.stringify({ confirm: "DELETE" }) });
    await reloadMemories();
    setDataStatus("本地馆藏已经清空。", false, true);
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
    elements.dialogBody.innerHTML = `
      <p class="muted">本次整理模式：${escapeHtml(run.mode)} · ${escapeHtml(formatDateTime(run.createdAt))}</p>
      <div class="agent-run-detail">${(run.steps || []).map((step, index) => `
        <article><strong>${index + 1}. ${escapeHtml(step.agent)}</strong><span>${escapeHtml(step.duty)}</span><p>${escapeHtml(step.output)}</p></article>`).join("")}</div>`;
    elements.dialogTraceButton.textContent = "已显示 Agent 记录";
  } catch (error) {
    showToast(error.message, true);
    elements.dialogTraceButton.disabled = false;
    elements.dialogTraceButton.textContent = "查看 Agent 记录";
  }
}

async function editSelectedMemory() {
  const memory = state.memories.find((item) => item.id === state.selectedMemoryId);
  if (!memory) return;
  state.editingMemoryId = memory.id;
  state.draft = { ...memory };
  state.workflow = null;
  elements.rawContent.value = memory.rawContent || "";
  populateDraft(memory);
  elements.draftPlaceholder.hidden = true;
  elements.draftForm.hidden = false;
  elements.saveMemoryButton.textContent = "保存修改";
  elements.workflowSteps.innerHTML = '<p class="muted">这件展品没有可读取的 Agent 整理记录。</p>';
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
  switchView("compose");
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
  const payload = await requestJson("/api/memories");
  state.memories = payload.memories || [];
  state.searchResults = null;
  state.insights = null;
  renderStats();
  renderCollection();
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
  elements.runtimeBadge.classList.toggle("is-ready", status === "ready");
  elements.runtimeBadge.classList.toggle("is-error", status === "error");
}

function showToast(message, isError) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.toggle("is-error", Boolean(isError));
  elements.toast.hidden = false;
  toastTimer = setTimeout(() => { elements.toast.hidden = true; }, 3600);
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    }
  });
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) {
    const message = typeof payload === "object" ? payload.error : payload;
    throw new Error(message || `请求失败（${response.status}）`);
  }
  return payload;
}

function hallName(id) {
  return state.options.halls.find((hall) => hall.id === id)?.name || "日常展厅";
}

function parseList(value) {
  return [...new Set(String(value || "").split(/[，,、\n]/).map((item) => item.trim()).filter(Boolean))];
}

function getMemoryTimestamp(memory) {
  const value = memory.date || memory.createdAt || "";
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function formatDate(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const match = text.match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/);
  if (!match) return text;
  if (match[3]) return `${match[1]}.${match[2]}.${match[3]}`;
  if (match[2]) return `${match[1]}.${match[2]}`;
  return match[1];
}

function formatDateTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value || "") : date.toLocaleString("zh-CN", { hour12: false });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
