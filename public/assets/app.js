const state = {
  memories: [],
  options: { halls: [], emotions: [], sourceTypes: [], importanceLabels: [] },
  demo: null,
  trust: null,
  trustError: "",
  privacy: null,
  health: null,
  draft: null,
  workflow: null,
  organizeExecution: null,
  organizeReceipt: null,
  organizeRequest: 0,
  composerOperation: null,
  composerOperationSequence: 0,
  composerRevision: 0,
  composerBaselineRevision: 0,
  composerResetting: false,
  inboxItem: null,
  editingMemoryId: "",
  pendingSaveMemoryId: "",
  searchResults: null,
  searchResponse: null,
  searchError: "",
  searchRequest: 0,
  searchTotal: 0,
  searchNextCursor: "",
  searchController: null,
  guideRequest: 0,
  guideController: null,
  collectionTotal: 0,
  collectionSummary: null,
  collectionNextCursor: "",
  collectionLoadingMore: false,
  insights: null,
  timeCalibrationTimeline: null,
  archaeologyOverview: {},
  route: null,
  routeFocusId: "",
  routeLoadedKey: null,
  routeRequest: 0,
  puzzle: null,
  puzzleSession: 0,
  puzzleBusyOwners: new Set(),
  selectedMemoryId: "",
  selectedMemory: null,
  detailOperation: null,
  detailOperationSequence: 0,
  dialogScrollY: 0,
  dialogTrigger: null
};
const elements = {
  navButtons: [...document.querySelectorAll("[data-view]")],
  viewPanels: [...document.querySelectorAll("[data-view-panel]")],
  runtimeBadge: document.querySelector("#runtimeBadge"),
  trustBar: document.querySelector("#trustBar"),
  trustDetails: document.querySelector("#trustDetails"),
  trustMode: document.querySelector("#trustMode"),
  trustStorage: document.querySelector("#trustStorage"),
  trustAi: document.querySelector("#trustAi"),
  trustExternal: document.querySelector("#trustExternal"),
  trustEncryption: document.querySelector("#trustEncryption"),
  trustDetailBody: document.querySelector("#trustDetailBody"),
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
  collectionFilterButton: document.querySelector("#collectionFilterButton"),
  collectionFilterDialog: document.querySelector("#collectionFilterDialog"),
  hallFilterMobile: document.querySelector("#hallFilterMobile"),
  sortSelectMobile: document.querySelector("#sortSelectMobile"),
  clearFiltersMobileButton: document.querySelector("#clearFiltersMobileButton"),
  collectionMoreButton: document.querySelector("#collectionMoreButton"),
  memoryForm: document.querySelector("#memoryForm"),
  rawContent: document.querySelector("#rawContent"),
  charCount: document.querySelector("#charCount"),
  sampleButton: document.querySelector("#sampleButton"),
  saveOriginalButton: document.querySelector("#saveOriginalButton"),
  analyzeButton: document.querySelector("#analyzeButton"),
  organizePanel: document.querySelector("#organizePanel"),
  organizeEngineBadge: document.querySelector("#organizeEngineBadge"),
  organizeExternalDisclosure: document.querySelector("#organizeExternalDisclosure"),
  organizeExternalConsent: document.querySelector("#organizeExternalConsent"),
  analyzeStatus: document.querySelector("#analyzeStatus"),
  originalSavedStatus: document.querySelector("#originalSavedStatus"),
  postSaveTools: document.querySelector("#postSaveTools"),
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
  guideEngineBadge: document.querySelector("#guideEngineBadge"),
  guideExternalDisclosure: document.querySelector("#guideExternalDisclosure"),
  guideExternalConsent: document.querySelector("#guideExternalConsent"),
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
  memoryLensMount: document.querySelector("#memoryLensMount"),
  privacySummary: document.querySelector("#privacySummary"),
  dataLocationList: document.querySelector("#dataLocationList"),
  dataLocationDetails: document.querySelector("#dataLocationDetails"),
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
  dialogCloseButton: document.querySelector('#memoryDialog [value="close"]'),
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
  recordingLeaveDialog: document.querySelector("#recordingLeaveDialog"),
  recordingLeaveKeep: document.querySelector("#recordingLeaveKeep"),
  recordingLeaveContinue: document.querySelector("#recordingLeaveContinue"),
  recordingLeaveDiscard: document.querySelector("#recordingLeaveDiscard"),
  moreRecallDetails: document.querySelector("#moreRecallDetails"),
  recallFieldButton: document.querySelector("#recallFieldButton"),
  recallSemanticButton: document.querySelector("#recallSemanticButton"),
  recallGuideButton: document.querySelector("#recallGuideButton"),
  connectionError: document.querySelector("#connectionError"),
  connectionErrorMessage: document.querySelector("#connectionErrorMessage"),
  reconnectButton: document.querySelector("#reconnectButton"),
  toast: document.querySelector("#toast"),
  footerVersion: document.querySelector("#footerVersion")
};
const sampleMemories = [
  "毕业那天傍晚，我们在操场尽头站了很久。大家都说以后常联系，但真正想说的话反而没有说出口。",
  "有次出差很晚才到家，妈妈没有多问，只把厨房里温着的面端出来。那一刻突然觉得，回家是有人替你留着一盏灯。",
  "雨停后我没有立刻回去，而是沿着河边多走了一段。路灯落在积水里，普通的一天忽然安静了下来。",
  "最迷茫的那段时间，一个朋友突然打来电话。他没有劝我振作，只陪我把混乱的话说完。"
];
let searchTimer = null, toastTimer = null;
let privacyPromise = null, archaeologyPromise = null;
let curatorModulePromise = null, capsuleModulePromise = null, oralHistoryPromise = null, detailModulePromise = null, initializationPromise = null;
const lazyFeatures = window.TimeIsleLazyFeatures?.createLoader?.();
if (!lazyFeatures) throw new Error("高级回看资源加载器未能初始化。");
let composerDisabledSnapshot = null;
let collectionFilterTrigger = null;
let activeView = "collection", pendingViewTransition = null;
let mediaController = null, voiceController = null;
let mediaEvidenceController = null, portabilityController = null, mediaCompareControllers = [], mediaLabController = null;
let exhibitionsController = null, capsulesController = null, curatorAgentController = null, revisitsController = null, cluesController = null, revisionsController = null, collectionHealthController = null, timeCalibrationController = null, oralHistoriesController = null, memoryInboxController = null, provenanceController = null, coMemoryLetterController = null, memoryLensController = null, multiPerspectiveController = null, semanticRecallController = null;
bindEvents(); initializationPromise = initialize();

async function initialize() {
  setRuntimeStatus("正在连接", "loading");
  elements.connectionError.hidden = true;
  state.trustError = "";
  try {
    const [options, memoriesPayload, trustResult] = await Promise.all([
      requestJson("/api/options"),
      requestJson("/api/memories?view=card&sort=recent&limit=30"),
      requestJson("/api/runtime/trust").then((value) => ({ value, error: null })).catch((error) => ({ value: null, error }))
    ]);
    state.options = options;
    state.memories = memoriesPayload.memories || [];
    state.collectionTotal = Number(memoriesPayload.total ?? state.memories.length);
    state.collectionSummary = memoriesPayload.summary || null;
    state.collectionNextCursor = String(memoriesPayload.nextCursor || "");
    state.trust = trustResult.value;
    state.trustError = trustResult.error?.message || "";
    state.demo = {
      interviewDemo: !state.trust || state.trust.audience === "public-demo",
      trustUnknown: !state.trust
    };
    initializeControllers(options, state.demo.interviewDemo);
    populateOptions();
    renderApp();
    elements.footerVersion.textContent = state.trust?.appVersion ? `v${state.trust.appVersion}` : "版本无法确认";
    setRuntimeStatus(state.trustError ? "信任状态待确认" : state.demo.interviewDemo ? "Demo 已连接" : "本地馆藏已连接", state.trustError ? "error" : "ready");
    const requestedHash = location.hash.replace("#", "");
    const initialView = normalizeView(requestedHash);
    switchView(initialView, { updateHash: false });
    if (requestedHash === "data-technical") openTechnicalEvidence();
    void loadArchaeologyAfterBootstrap();
    return true;
  } catch (error) {
    setRuntimeStatus("连接失败", "error");
    elements.collectionMeta.textContent = "馆藏暂时无法读取。";
    elements.connectionErrorMessage.textContent = humanRequestError(error, "暂时无法连接馆藏，请检查本地服务或网络后重试。");
    elements.connectionError.hidden = false;
    showVoiceUnavailable();
    return false;
  }
}

function initializeControllers(options, demo) {
  mediaController = window.TimeIsleMedia?.createController({ policy: options.mediaPolicy, demo, onChange: markComposerChanged }) || null;
  initializeVoiceController(options.voicePolicy, demo);
  portabilityController = window.TimeIslePortability?.createController({ demo, onRestored: reloadMemories }) || null;
  exhibitionsController = window.TimeIsleExhibitions?.createController({ demo, onOpenMemory: openMemory }) || null;
  memoryLensController = window.TimeIsleMemoryLensHost?.mount?.({
    mount: elements.memoryLensMount,
    demo,
    onOpenMemory: openMemory,
    preselectCurator: async (handoff) => {
      const controller = await ensureCuratorModule();
      return controller.preselectSources(handoff, elements.memoryLensMount?.querySelector("summary"));
    }
  }) || null;
  revisitsController = window.TimeIsleRevisits?.createController({ demo, onOpenMemory: openMemory }) || null;
  cluesController = window.TimeIsleClues?.createEntityDialogController({ demo, onOpenMemory: openMemory, onDataChanged: reloadMemories }) || null;
  collectionHealthController = window.TimeIsleCollectionHealth?.createController({ demo }) || null;
  memoryInboxController = window.TimeIsleMemoryInbox?.createController({ demo, onCompose: composeInboxItem }) || null;
  semanticRecallController = window.TimeIsleSemanticRecall?.createController({ onOpenMemory: openMemory, onFallback: (query) => { elements.searchInput.value = String(query || "").slice(0, 160); switchView("collection", { focusHeading: true }); if (elements.searchInput.value.trim()) performSearch(); else renderCollection(); } }) || null;
  initializeTimeCalibrationController(options.voicePolicy, demo);
}
function initializeVoiceController(policy, demo) {
  try {
    if (typeof window.TimeIsleVoice?.createController !== "function") throw new Error("声音模块未加载");
    voiceController = window.TimeIsleVoice.createController({ policy, demo, onChange: markComposerChanged });
    if (!voiceController) throw new Error("声音控制器未能创建");
  } catch (error) {
    console.error("声音模块初始化失败：", error); voiceController = null;
    showVoiceUnavailable("声音模块未能加载，请刷新页面重试。", "声音模块暂不可用；其他馆藏功能不受影响。");
  }
}
function initializeTimeCalibrationController(voicePolicy, demo) {
  try {
    if (typeof window.TimeIsleTimeCalibrations?.createController !== "function") throw new Error("时间校准模块未加载");
    timeCalibrationController = window.TimeIsleTimeCalibrations.createController({
      demo,
      onBusyChange: (busy) => setPuzzleBusy("calibration", busy),
      onChanged: async () => {
        state.insights = null;
        const timelineActive = elements.insightTabs.some((button) => button.dataset.insightTab === "timeline" && button.classList.contains("is-active"));
        if (timelineActive) await loadInsights(true);
        await oralHistoriesController?.refresh?.();
      }
    });
  } catch (error) {
    console.error("时间校准模块初始化失败：", error);
    timeCalibrationController = null;
  }
}

async function ensureDetailModules() {
  if (!await initializationPromise) throw new Error("核心馆藏尚未连接，暂时不能打开项目幕后功能。");
  if (detailModulePromise) return detailModulePromise;
  detailModulePromise = Promise.all([
    (async () => {
      await lazyFeatures.loadScript("/assets/media-evidence.js", () => Boolean(window.TimeIsleMediaEvidence));
      await lazyFeatures.loadScript("/assets/media-ocr.js", () => Boolean(window.TimeIsleMediaOcr));
      await lazyFeatures.loadScript("/assets/media-lab.js", () => Boolean(window.TimeIsleMediaLab));
    })(),
    lazyFeatures.loadScript("/assets/revisions.js", () => Boolean(window.TimeIsleRevisions)),
    lazyFeatures.loadScript("/assets/provenance.js", () => Boolean(window.TimeIsleProvenance)),
    (async () => {
      await lazyFeatures.loadScript("/assets/co-memory-crypto.js", () => Boolean(window.TimeIsleCoMemoryCrypto));
      await lazyFeatures.loadScript("/assets/co-memory-letter.js", () => Boolean(window.TimeIsleCoMemoryLetters));
      await lazyFeatures.loadScript("/assets/co-memory-host.js", () => Boolean(window.TimeIsleCoMemoryHost));
    })(),
    (async () => {
      await lazyFeatures.loadScript("/assets/multi-perspective.js", () => Boolean(window.TimeIsleMultiPerspective));
      await lazyFeatures.loadScript("/assets/multi-perspective-host.js", () => Boolean(window.TimeIsleMultiPerspectiveHost));
    })()
  ])
    .then(() => {
      initializeDetailControllers();
      return true;
    })
    .catch((error) => {
      detailModulePromise = null;
      throw error;
    });
  return detailModulePromise;
}

function initializeDetailControllers() {
  const demo = state.demo?.interviewDemo !== false;
  mediaEvidenceController ||= window.TimeIsleMediaEvidence?.createController({ demo }) || null;
  mediaLabController ||= window.TimeIsleMediaLab?.createController({ demo }) || null;
  revisionsController ||= window.TimeIsleRevisions?.createController({ demo, onOpenMemory: openMemory, onRestored: async (memory) => { await reloadMemories(); await openMemory(memory.id); } }) || null;
  multiPerspectiveController ||= window.TimeIsleMultiPerspectiveHost?.createController() || null;
  provenanceController ||= window.TimeIsleProvenance?.createController({ demo, onChanged: () => multiPerspectiveController?.refresh?.() }) || null;
  coMemoryLetterController ||= window.TimeIsleCoMemoryHost?.createController({ demo, onChanged: () => { provenanceController?.refresh?.(); multiPerspectiveController?.refresh?.(); } }) || null;
  if (document.querySelector("#revisionTimelineDetails")?.open) void revisionsController?.loadTimeline?.();
}

function ensureRecallAdvancedModules() {
  return Promise.allSettled([
    ensureCuratorModule(),
    ensureCapsuleModule(),
    ensureOralHistoryModule(),
    ensureDetailModules()
  ]);
}

async function ensureCuratorModule() {
  if (!await initializationPromise) throw new Error("核心馆藏尚未连接，暂时不能打开高级回看方式。");
  if (curatorAgentController) return Promise.resolve(curatorAgentController);
  if (curatorModulePromise) return curatorModulePromise;
  const control = document.querySelector("#curatorAgentButton");
  const restoreControl = lazyFeatures.markControlBusy(control);
  curatorModulePromise = lazyFeatures.loadScript("/assets/curator-agent.js", () => typeof window.TimeIsleCuratorAgent?.createController === "function")
    .then(() => {
      const demo = state.demo?.interviewDemo !== false;
      curatorAgentController = window.TimeIsleCuratorAgent?.createController({
        demo,
        onOpenMemory: openMemory,
        onOpenShare: (exhibitionId, trigger) => {
          void ensureCapsuleModule()
            .then((controller) => controller.openForExhibition(exhibitionId, trigger))
            .catch((error) => showToast(`时光胶囊暂时无法打开：${error.message}`, true));
        }
      }) || null;
      if (!curatorAgentController) throw new Error("确定性策展工作流未能初始化");
      return curatorAgentController;
    })
    .catch((error) => {
      curatorModulePromise = null;
      throw error;
    })
    .finally(restoreControl);
  return curatorModulePromise;
}

async function ensureCapsuleModule() {
  if (!await initializationPromise) throw new Error("核心馆藏尚未连接，暂时不能打开高级回看方式。");
  if (capsulesController) return Promise.resolve(capsulesController);
  if (capsuleModulePromise) return capsuleModulePromise;
  const control = document.querySelector("#capsuleStudioButton");
  const restoreControl = lazyFeatures.markControlBusy(control);
  capsuleModulePromise = (async () => {
    await lazyFeatures.loadScript("/assets/capsule-crypto.js", () => Boolean(window.TimeIsleCapsuleCrypto));
    await lazyFeatures.loadScript("/assets/share-privacy.js", () => Boolean(window.TimeIsleSharePrivacy));
    await lazyFeatures.loadScript("/assets/capsules.js", () => typeof window.TimeIsleCapsules?.createController === "function");
    const demo = state.demo?.interviewDemo !== false;
    capsulesController = window.TimeIsleCapsules?.createController({ demo }) || null;
    if (!capsulesController) throw new Error("时光胶囊未能初始化");
    return capsulesController;
  })()
    .catch((error) => {
      capsuleModulePromise = null;
      throw error;
    })
    .finally(restoreControl);
  return capsuleModulePromise;
}

async function ensureOralHistoryModule() {
  if (!await initializationPromise) throw new Error("核心馆藏尚未连接，暂时不能打开高级回看方式。");
  if (oralHistoriesController) return Promise.resolve(oralHistoriesController);
  if (oralHistoryPromise) return oralHistoryPromise;
  oralHistoryPromise = lazyFeatures.loadScript("/assets/oral-histories.js", () => typeof window.TimeIsleOralHistories?.createController === "function")
    .then(() => {
      oralHistoriesController = window.TimeIsleOralHistories?.createController({
        policy: state.options.voicePolicy,
        demo: state.demo?.interviewDemo !== false,
        dialog: elements.puzzleDialog,
        closeButton: elements.puzzleCloseButton,
        onBusyChange: (busy) => setPuzzleBusy("oralHistory", busy),
        onChanged: () => setTimeout(() => timeCalibrationController?.refreshLedger?.(), 0)
      }) || null;
      if (!oralHistoriesController) throw new Error("口述史模块未能初始化");
      return oralHistoriesController;
    })
    .catch((error) => {
      oralHistoryPromise = null;
      throw error;
    });
  return oralHistoryPromise;
}

function bindEvents() {
  elements.navButtons.forEach((button) => button.addEventListener("click", () => switchView(button.dataset.view)));
  document.querySelectorAll("[data-go-view]").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.goView, { focusHeading: true })));
  document.querySelectorAll("[data-view-link]").forEach((link) => link.addEventListener("click", (event) => {
    event.preventDefault();
    switchView(link.dataset.viewLink);
  }));
  window.addEventListener("hashchange", () => {
    const requestedHash = location.hash.replace("#", "");
    switchView(normalizeView(requestedHash), { updateHash: false });
    if (requestedHash === "data-technical") openTechnicalEvidence();
  });

  elements.searchInput.addEventListener("input", scheduleSearch);
  elements.hallFilter.addEventListener("change", () => syncFilters("desktop"));
  elements.sortSelect.addEventListener("change", () => syncFilters("desktop"));
  elements.hallFilterMobile.addEventListener("change", () => syncFilters("mobile"));
  elements.sortSelectMobile.addEventListener("change", () => syncFilters("mobile"));
  elements.clearFiltersButton.addEventListener("click", clearFilters);
  elements.clearFiltersMobileButton.addEventListener("click", clearFilters);
  elements.collectionFilterButton.addEventListener("click", () => {
    elements.hallFilterMobile.value = elements.hallFilter.value;
    elements.sortSelectMobile.value = elements.sortSelect.value;
    collectionFilterTrigger = elements.collectionFilterButton;
    try {
      elements.collectionFilterDialog.showModal();
    } catch (error) {
      collectionFilterTrigger = null;
      showToast(`筛选面板暂时无法打开：${error.message}`, true);
    }
  });
  elements.collectionFilterDialog.addEventListener("close", () => {
    const trigger = collectionFilterTrigger;
    collectionFilterTrigger = null;
    if (trigger?.isConnected) requestAnimationFrame(() => trigger.focus({ preventScroll: true }));
  });
  elements.collectionMoreButton.addEventListener("click", loadMoreMemories);
  elements.retrySearchButton.addEventListener("click", performSearch);
  elements.reconnectButton.addEventListener("click", () => location.reload());
  elements.memoryGrid.addEventListener("click", handleMemoryLinkClick);
  elements.citationList.addEventListener("click", handleMemoryLinkClick);
  elements.timelinePanel.addEventListener("click", handleTimelineClick);
  elements.themesPanel.addEventListener("click", handleMemoryLinkClick);
  elements.routesPanel.addEventListener("click", handleRouteClick);
  elements.reportPanel.addEventListener("click", handleMemoryLinkClick);
  elements.dialogBody.addEventListener("click", handleMemoryLinkClick);

  elements.rawContent.addEventListener("input", (event) => {
    handleRawContentInput();
    clearFieldValidation(event.target, elements.analyzeStatus);
  });
  elements.sampleButton.addEventListener("click", insertSample);
  elements.memoryForm.addEventListener("submit", saveOriginalMemory);
  elements.analyzeButton.addEventListener("click", analyzeMemory);
  elements.draftForm.addEventListener("submit", saveDraft);
  elements.draftForm.addEventListener("input", markComposerChanged);
  elements.draftForm.addEventListener("input", (event) => clearFieldValidation(event.target, elements.analyzeStatus));
  elements.draftForm.addEventListener("change", markComposerChanged);
  elements.resetDraftButton.addEventListener("click", requestComposerReset);
  elements.draftEmotionIntensity.addEventListener("input", updateEmotionIntensity);

  elements.guideForm.addEventListener("submit", askGuide);
  elements.guideQuestion.addEventListener("input", (event) => {
    elements.guideForm.dataset.questionId = "";
    clearFieldValidation(event.target, elements.guideAnswer);
  });
  document.querySelectorAll("[data-question]").forEach((button) => button.addEventListener("click", () => {
    elements.guideQuestion.value = button.dataset.question;
    elements.guideForm.dataset.questionId = button.dataset.questionId || "";
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
  elements.memoryDialog.addEventListener("cancel", (event) => {
    if (state.detailOperation) event.preventDefault();
  });
  elements.memoryDialog.addEventListener("close", () => {
    cancelDetailOperation();
    mediaEvidenceController?.close(); mediaLabController?.close(); provenanceController?.close(); coMemoryLetterController?.close(); multiPerspectiveController?.close();
    unlockMemoryDialogBackground();
  });
  elements.puzzleSaveAnswerButton.addEventListener("click", () => savePuzzleAnswer("answer"));
  elements.puzzleUnknownButton.addEventListener("click", () => savePuzzleAnswer("keep_unknown"));
  elements.puzzleSkipButton.addEventListener("click", () => savePuzzleAnswer("skip"));
  elements.puzzleConfirmButton.addEventListener("click", confirmPuzzleEvent);
  elements.puzzleAnswer.addEventListener("input", updatePuzzleAnswerAction);
  elements.puzzleDialog.addEventListener("cancel", (event) => {
    if (state.puzzleBusyOwners.size) event.preventDefault();
  });
  elements.puzzleDialog.addEventListener("close", () => {
    state.puzzleSession += 1;
    state.puzzleBusyOwners.clear();
    timeCalibrationController?.reset();
    oralHistoriesController?.reset();
    destroyMediaCompare();
  });
  elements.recordingLeaveKeep.addEventListener("click", () => completePendingViewTransition("keep"));
  elements.recordingLeaveDiscard.addEventListener("click", () => completePendingViewTransition("discard"));
  elements.recordingLeaveContinue.addEventListener("click", cancelPendingViewTransition);
  elements.recordingLeaveDialog.addEventListener("cancel", (event) => { event.preventDefault(); cancelPendingViewTransition(); });
  elements.moreRecallDetails.addEventListener("toggle", () => {
    if (!elements.moreRecallDetails.open) return;
    if (!state.insights) loadInsights();
    void ensureRecallAdvancedModules().then((results) => {
      const failures = results.filter((result) => result.status === "rejected");
      if (failures.length) showToast(`有 ${failures.length} 项高级回看方式暂时未加载；收起后再次展开即可重试。`, true);
    });
  });
  elements.recallFieldButton.addEventListener("click", () => {
    switchView("collection");
    requestAnimationFrame(() => elements.searchInput.focus());
  });
  elements.recallSemanticButton.addEventListener("click", () => {
    document.querySelector("#semanticRecallDetails").open = true;
    document.querySelector("#semanticRecallDetails").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  elements.recallGuideButton.addEventListener("click", () => {
    elements.guideQuestion.focus();
    elements.guideQuestion.scrollIntoView({ behavior: "smooth", block: "center" });
  });
  window.addEventListener("online", () => {
    if (!elements.connectionError.hidden) elements.connectionErrorMessage.textContent = "网络已恢复，可以重新连接馆藏。";
  });
  window.addEventListener("offline", () => {
    setRuntimeStatus("当前离线", "error");
    elements.connectionErrorMessage.textContent = "当前设备已离线；私人馆藏不会写入离线缓存。";
    elements.connectionError.hidden = false;
  });
}

function renderApp() {
  renderTrustStatus();
  renderDemoStatus();
  renderStats();
  renderCollection();
  renderPrivacy();
  updateCharCount();
  updateEmotionIntensity();
}

function switchView(view, options = {}) {
  const target = normalizeView(view);
  if (state.composerOperation && activeView === "compose" && target !== "compose" && options.skipComposerGuard !== true) {
    if (location.hash === `#${target}`) history.replaceState(null, "", `#${activeView}`);
    showToast("正在保存这段记忆，请等待当前步骤完成后再离开。", true);
    elements.saveOriginalButton.focus({ preventScroll: true });
    return false;
  }
  const voiceState = voiceController?.getState?.();
  const recordingNeedsDecision = activeView === "compose" && target !== "compose" && (voiceState?.recording || voiceState?.awaitingPermission);
  if (recordingNeedsDecision && options.skipRecordingGuard !== true) {
    pendingViewTransition = {
      target,
      options: { ...options, updateHash: true, skipRecordingGuard: true }
    };
    if (location.hash === `#${target}`) history.replaceState(null, "", `#${activeView}`);
    if (!elements.recordingLeaveDialog.open) elements.recordingLeaveDialog.showModal();
    elements.recordingLeaveKeep.focus();
    return false;
  }
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
  activeView = target;
  if (options.updateHash !== false && location.hash !== `#${target}`) history.pushState(null, "", `#${target}`);
  if (target === "reflect") {
    revisitsController?.load();
  }
  if (target === "data") void loadPrivacy();
  if (options.focusHeading) elements.viewPanels.find((panel) => !panel.hidden)?.querySelector("h1")?.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  return true;
}
function normalizeView(view) {
  if (view === "data-technical") return "data";
  return ["collection", "compose", "reflect", "data"].includes(view) ? view : "collection";
}

async function completePendingViewTransition(action) {
  const transition = pendingViewTransition;
  if (!transition) return;
  pendingViewTransition = null;
  elements.recordingLeaveKeep.disabled = true;
  elements.recordingLeaveDiscard.disabled = true;
  try {
    await voiceController?.prepareForViewLeave?.(action);
    elements.recordingLeaveDialog.close();
    switchView(transition.target, transition.options);
  } catch (error) {
    showToast(`未能安全停止录音：${error.message}`, true);
  } finally {
    elements.recordingLeaveKeep.disabled = false;
    elements.recordingLeaveDiscard.disabled = false;
  }
}

function cancelPendingViewTransition() {
  pendingViewTransition = null;
  if (elements.recordingLeaveDialog.open) elements.recordingLeaveDialog.close();
  if (location.hash !== `#${activeView}`) history.replaceState(null, "", `#${activeView}`);
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
  curatorAgentController?.setDemo(demo);
  revisitsController?.setDemo(demo);
  cluesController?.setDemo(demo);
  revisionsController?.setDemo(demo); collectionHealthController?.setDemo(demo);
  memoryInboxController?.setDemo(demo);
  elements.demoNotice.hidden = !demo;
  elements.purgeButton.disabled = demo;
  elements.purgeButton.title = demo ? "公开 Demo 已禁用清空操作" : "永久清空本地 SQLite 馆藏";
  elements.dialogDeleteButton.disabled = demo;
  elements.importFile.disabled = demo;
  elements.importFile.previousElementSibling?.classList.toggle("is-disabled", demo);
  elements.importFile.previousElementSibling?.setAttribute("aria-disabled", String(demo));
  elements.rawContent.readOnly = demo;
  elements.guideQuestion.readOnly = demo;
  elements.saveOriginalButton.disabled = demo;
  elements.saveMemoryButton.disabled = demo;
  elements.saveOriginalButton.textContent = demo ? "公开 Demo 不保存" : "保存记忆";
  elements.analyzeButton.textContent = demo ? "查看虚构整理样例" : "可选：整理这件展品";
  elements.organizePanel.hidden = !demo && !state.pendingSaveMemoryId && !state.editingMemoryId;
  elements.postSaveTools.hidden = demo || (!state.pendingSaveMemoryId && !state.editingMemoryId);
  elements.originalSavedStatus.hidden = demo || !state.pendingSaveMemoryId;
}

function renderTrustStatus() {
  const trust = state.trust;
  if (!trust) {
    elements.trustBar.dataset.audience = "unknown";
    [elements.trustMode, elements.trustStorage, elements.trustAi, elements.trustExternal, elements.trustEncryption].forEach((element) => {
      element.textContent = "无法确认";
    });
    setTrustAccessibleLabel(elements.trustMode, "模式", "无法确认");
    setTrustAccessibleLabel(elements.trustStorage, "保存位置", "无法确认");
    setTrustAccessibleLabel(elements.trustAi, "AI 模式", "无法确认");
    setTrustAccessibleLabel(elements.trustExternal, "内容外发", "无法确认");
    setTrustAccessibleLabel(elements.trustEncryption, "静态加密", "无法确认");
    elements.trustDetails.querySelector(":scope > summary").setAttribute("aria-label", "当前信任状态：模式无法确认；保存位置无法确认；AI 模式无法确认；内容外发无法确认；静态加密无法确认。点击展开完整说明。");
    elements.trustDetailBody.innerHTML = `<div><strong>状态未知</strong><span>无法核对运行时信任合同。页面已按只读模式降级，外部 AI 入口保持隐藏；请重新连接后再操作私人内容。</span></div>`;
    elements.organizeExternalDisclosure.hidden = true;
    elements.guideExternalDisclosure.hidden = true;
    return;
  }
  const demo = trust.audience === "public-demo";
  const external = trust.externalAi || {};
  const trustLabels = {
    mode: demo ? ["公开 Demo", "公开只读 Demo"] : ["私人本地", "私人本地馆藏"],
    storage: demo ? ["临时样例", "虚构样例 · 临时实例"] : ["本机保存", "本机 SQLite + 媒体目录"],
    ai: external.configured ? ["外部可选", "本地规则 / 外部模型可选"] : ["本地/设备", "本地规则 + 设备 embedding"],
    external: external.configured ? ["逐次确认", "外发前逐次确认"] : ["不外发", "当前不外发"],
    encryption: trust.encryptionAtRest?.enabled ? ["已加密", "已静态加密"] : ["未加密", "未做静态加密"]
  };
  setTrustValue(elements.trustMode, "模式", trustLabels.mode);
  setTrustValue(elements.trustStorage, "保存位置", trustLabels.storage);
  setTrustValue(elements.trustAi, "AI 模式", trustLabels.ai);
  setTrustValue(elements.trustExternal, "内容外发", trustLabels.external);
  setTrustValue(elements.trustEncryption, "静态加密", trustLabels.encryption);
  elements.trustDetails.querySelector(":scope > summary").setAttribute("aria-label", `当前信任状态：模式${trustLabels.mode[1]}；保存位置${trustLabels.storage[1]}；AI 模式${trustLabels.ai[1]}；内容外发${trustLabels.external[1]}；静态加密${trustLabels.encryption[1]}。点击展开完整说明。`);
  elements.trustBar.dataset.audience = trust.audience;
  elements.trustDetailBody.innerHTML = `
    <div><strong>部署</strong><span>${escapeHtml(trust.deployment?.kind || "local")} · ${demo ? "共享匿名只读" : "单设备馆主"}</span></div>
    <div><strong>写入</strong><span>${demo ? "POST / PUT / PATCH / DELETE 均在读取正文前拒绝" : "仅当前本地服务可写；保存后进入本机馆藏"}</span></div>
    <div><strong>外部 AI</strong><span>${external.configured ? `${escapeHtml(external.providerLabel || "OpenAI-compatible provider")} · ${escapeHtml(external.model || "未标注模型")} · 每次操作前列出发送字段` : "未配置；整理与讲解使用本地规则，设备语义不上传"}</span></div>
    <div><strong>静态加密</strong><span>${escapeHtml(trust.encryptionAtRest?.boundary || "当前未做数据库与媒体静态加密")}</span></div>`;

  const organize = trust.features?.organize || {};
  const guide = trust.features?.guide || {};
  elements.organizeEngineBadge.textContent = external.configured ? "外部模型（需同意）/ 本地规则" : "本地规则";
  elements.guideEngineBadge.textContent = demo ? "固定虚构问题 · 本地规则" : external.configured ? "外部模型（需同意）/ 本地规则" : "本地规则";
  elements.organizeExternalDisclosure.hidden = !external.configured || demo;
  elements.guideExternalDisclosure.hidden = !external.configured || demo;
  if (external.configured && !demo) {
    const endpoint = external.endpointOrigin || "未公开目的地址";
    elements.organizeExternalDisclosure.querySelector("p").textContent = `提供方：${external.providerLabel}；模型：${external.model}；目的地址：${endpoint}；发送字段：${(organize.inputFieldsSent || []).join("、") || "rawContent"}。`;
    elements.guideExternalDisclosure.querySelector("p").textContent = `提供方：${external.providerLabel}；模型：${external.model}；目的地址：${endpoint}；发送字段：${(guide.inputFieldsSent || []).join("、")}。`;
  }
}

function setTrustValue(element, label, values) {
  element.textContent = values[0];
  setTrustAccessibleLabel(element, label, values[1]);
}

function setTrustAccessibleLabel(element, label, value) {
  element.title = value;
}

function renderStats() {
  const memories = state.memories;
  elements.statMemories.textContent = String(state.collectionSummary?.memories ?? state.collectionTotal ?? memories.length);
  elements.statHalls.textContent = String(state.collectionSummary?.halls ?? new Set(memories.map((memory) => memory.hall)).size);
  elements.statTags.textContent = String(state.collectionSummary?.tags ?? new Set(memories.flatMap((memory) => memory.tags || [])).size);
  elements.statFavorites.textContent = String(state.collectionSummary?.favorites ?? memories.filter((memory) => memory.favorite).length);
}

function populateOptions() {
  const hallOptions = state.options.halls.map((hall) => `<option value="${escapeHtml(hall.id)}">${escapeHtml(hall.name)}</option>`).join("");
  elements.hallFilter.innerHTML = `<option value="all">全部展厅</option>${hallOptions}`;
  elements.hallFilterMobile.innerHTML = `<option value="all">全部展厅</option>${hallOptions}`;
  elements.draftHall.innerHTML = hallOptions;
  elements.draftSource.innerHTML = state.options.sourceTypes.map((source) => `<option value="${escapeHtml(source)}">${escapeHtml(source)}</option>`).join("");
}

function scheduleSearch() {
  clearTimeout(searchTimer);
  state.searchController?.abort();
  state.searchRequest += 1;
  searchTimer = setTimeout(performSearch, 260);
}

async function performSearch(options = {}) {
  clearTimeout(searchTimer);
  const query = elements.searchInput.value.trim();
  const append = Boolean(options.append);
  const requestId = ++state.searchRequest;
  if (!query) {
    state.searchController?.abort();
    state.searchResults = null;
    state.searchResponse = null;
    state.searchTotal = 0;
    state.searchNextCursor = "";
    state.searchError = "";
    await loadCollectionPage({ reset: true });
    return;
  }
  state.searchController?.abort();
  const controller = new AbortController();
  state.searchController = controller;
  state.searchError = "";
  elements.searchErrorState.hidden = true;
  elements.memoryGrid.setAttribute("aria-busy", "true");
  elements.collectionMeta.textContent = append ? "正在显示更多匹配展品…" : "正在按字段与线索寻找展品…";
  try {
    const params = new URLSearchParams({ query, limit: "30", sort: elements.sortSelect.value });
    if (elements.hallFilter.value !== "all") params.set("hall", elements.hallFilter.value);
    if (options.cursor) params.set("cursor", options.cursor);
    const payload = await requestJson(`/api/search?${params}`, { signal: controller.signal });
    if (requestId !== state.searchRequest) return;
    const normalized = window.TimeIsleClues?.normalizeSearchResponse(payload) || { results: payload.results || [], engine: payload.engine || {} };
    const previousResults = append ? state.searchResponse?.results || [] : [];
    state.searchResponse = { ...normalized, results: [...previousResults, ...normalized.results] };
    state.searchResults = state.searchResponse.results.map((item) => ({ ...state.memories.find((memory) => memory.id === item.memory.id), ...item.memory }));
    state.searchTotal = Number(payload.total ?? state.searchResults.length);
    state.searchNextCursor = String(payload.nextCursor || "");
    state.searchError = "";
    renderCollection();
  } catch (error) {
    if (requestId !== state.searchRequest || error?.name === "AbortError") return;
    state.searchResults = [];
    state.searchResponse = null;
    state.searchTotal = 0;
    state.searchNextCursor = "";
    state.searchError = error?.message
      ? humanRequestError(error, `暂时无法完成这次检索：${error.message}`)
      : "本次检索没有完成，请稍后重试。";
    renderCollection();
  } finally {
    if (state.searchController === controller) state.searchController = null;
  }
}

function clearFilters() {
  state.searchController?.abort();
  elements.searchInput.value = "";
  elements.hallFilter.value = "all";
  elements.hallFilterMobile.value = "all";
  elements.sortSelect.value = "recent";
  elements.sortSelectMobile.value = "recent";
  state.searchResults = null;
  state.searchResponse = null;
  state.searchTotal = 0;
  state.searchNextCursor = "";
  state.searchError = "";
  state.searchRequest += 1;
  if (elements.collectionFilterDialog.open) elements.collectionFilterDialog.close("clear");
  void loadCollectionPage({ reset: true });
}

function getVisibleMemories() {
  return state.searchResults === null ? state.memories : state.searchResults;
}

function renderCollection() {
  elements.memoryGrid.removeAttribute("aria-busy");
  if (state.searchError) {
    elements.collectionMeta.textContent = "检索失败，请重试。";
    elements.memoryGrid.innerHTML = "";
    elements.emptyState.hidden = true;
    elements.collectionMoreButton.hidden = true;
    elements.searchErrorMessage.textContent = state.searchError;
    elements.searchErrorState.hidden = false;
    return;
  }
  const visible = getVisibleMemories();
  const query = elements.searchInput.value.trim();
  const filterNote = elements.hallFilter.value === "all" ? "" : ` · ${hallName(elements.hallFilter.value)}`;
  elements.collectionMeta.textContent = query
    ? `“${query}”找到 ${state.searchTotal} 件展品，已显示 ${visible.length} 件${filterNote}${state.searchResponse?.engine.shortQueryFallback ? " · 已兼容短线索" : ""}`
    : `馆内共有 ${state.collectionTotal} 件展品，当前显示 ${visible.length} 件${filterNote}`;
  elements.searchErrorState.hidden = true;
  elements.emptyState.hidden = visible.length > 0;
  if (!visible.length) {
    const trulyEmpty = state.collectionTotal === 0 && !query;
    elements.emptyState.querySelector("h3").textContent = trulyEmpty ? "先留下一段原文" : "还没有匹配的展品";
    elements.emptyState.querySelector("p").textContent = trulyEmpty
      ? "不用先整理，写下当时发生了什么就好。原文会先保存，AI 整理可以以后再做。"
      : "换一个名字、地点或原句，也可以回到“找回”尝试按画面寻找。";
    elements.emptyState.querySelector("button").textContent = trulyEmpty ? "记录第一段记忆" : "记录一段新记忆";
  }
  elements.memoryGrid.innerHTML = visible.map(renderMemoryCard).join("");
  const nextCursor = query ? state.searchNextCursor : state.collectionNextCursor;
  elements.collectionMoreButton.hidden = !nextCursor;
  elements.collectionMoreButton.disabled = state.collectionLoadingMore;
  elements.collectionMoreButton.textContent = state.collectionLoadingMore ? "正在显示更多…" : "显示更多";
}

function syncFilters(source) {
  if (source === "mobile") {
    elements.hallFilter.value = elements.hallFilterMobile.value;
    elements.sortSelect.value = elements.sortSelectMobile.value;
  } else {
    elements.hallFilterMobile.value = elements.hallFilter.value;
    elements.sortSelectMobile.value = elements.sortSelect.value;
  }
  if (elements.searchInput.value.trim()) void performSearch();
  else void loadCollectionPage({ reset: true });
}

async function loadCollectionPage({ reset = false, cursor = "" } = {}) {
  const params = new URLSearchParams({ view: "card", limit: "30", sort: elements.sortSelect.value });
  if (elements.hallFilter.value !== "all") params.set("hall", elements.hallFilter.value);
  if (cursor) params.set("cursor", cursor);
  state.collectionLoadingMore = Boolean(cursor);
  renderCollection();
  try {
    const payload = await requestJson(`/api/memories?${params}`);
    state.memories = reset ? payload.memories || [] : [...state.memories, ...(payload.memories || [])];
    state.collectionTotal = Number(payload.total ?? state.memories.length);
    state.collectionSummary = payload.summary || state.collectionSummary;
    state.collectionNextCursor = String(payload.nextCursor || "");
    state.searchResults = null;
    state.searchResponse = null;
    state.searchError = "";
    renderStats();
    renderCollection();
  } catch (error) {
    state.searchError = humanRequestError(error, "馆藏加载失败，请稍后重试。");
    renderCollection();
  } finally {
    state.collectionLoadingMore = false;
    renderCollection();
  }
}

function loadMoreMemories() {
  if (state.collectionLoadingMore) return;
  if (elements.searchInput.value.trim()) void performSearch({ append: true, cursor: state.searchNextCursor });
  else void loadCollectionPage({ cursor: state.collectionNextCursor });
}
function renderMemoryCard(memory) {
  const facets = buildMemoryCardFacets(memory);
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
      <div class="tag-list">${facets.map((facet) => `<span class="tag" aria-label="${escapeHtml(`${facet.type}：${facet.label}`)}">${escapeHtml(facet.label)}</span>`).join("")}</div>
      ${window.TimeIsleVoice?.renderCardSummary(memory, escapeHtml) || ""}
      ${versionCount > 1 ? `<span class="memory-version-badge">${escapeHtml(String(versionCount))} 个记忆版本</span>` : ""}
      ${searchResult ? window.TimeIsleClues?.renderSearchEvidence(searchResult, state.searchResponse.engine) || "" : ""}
    </article>`;
}

function buildMemoryCardFacets(memory) {
  const facets = [];
  const seen = new Set();
  for (const [values, type] of [[memory.emotions, "情绪"], [memory.tags, "标签"]]) {
    for (const value of values || []) {
      const label = String(value || "").trim().replace(/\s+/gu, " ");
      const key = label.normalize("NFKC").toLocaleLowerCase("zh-CN");
      if (!label || seen.has(key)) continue;
      seen.add(key);
      facets.push({ label, type });
    }
  }
  return facets.slice(0, 4);
}

function handleMemoryLinkClick(event) {
  const target = event.target.closest("[data-memory-id], [data-open-memory]");
  if (!target) return;
  const memoryId = target.dataset.memoryId || target.dataset.openMemory;
  void openMemory(memoryId, target).catch((error) => {
    console.error("打开展品详情失败：", error);
    showToast(`无法打开这件展品：${error.message}`, true);
  });
}

async function openMemory(id, trigger = null) {
  const requestedScrollY = window.scrollY;
  const updatingOpenDialog = elements.memoryDialog.open;
  let memory;
  try {
    memory = (await requestJson(`/api/memories/${encodeURIComponent(id)}`)).memory;
  } catch (error) {
    showToast(humanRequestError(error, "暂时无法读取这件展品，请重试。"), true);
    return false;
  }
  state.selectedMemoryId = memory.id;
  state.selectedMemory = memory;
  elements.dialogHall.textContent = hallName(memory.hall);
  elements.dialogTitle.textContent = memory.title;
  elements.dialogBody.innerHTML = renderMemoryDetail(memory);
  elements.dialogBody.scrollTop = 0;
  const advancedDetails = elements.dialogBody.querySelector(".detail-advanced");
  advancedDetails?.addEventListener("toggle", () => {
    if (advancedDetails.open) void hydrateDetailAdvanced(memory, advancedDetails);
  });
  elements.dialogRouteButton.disabled = state.collectionTotal < 2;
  elements.dialogRouteButton.title = state.collectionTotal < 2 ? "至少需要两件展品才能生成航线" : "查看与这件展品有关的记忆";
  elements.dialogTraceButton.disabled = !memory.agentRunId;
  elements.dialogTraceButton.textContent = memory.agentRunId ? "查看整理记录" : "没有整理记录";
  elements.dialogTraceButton.dataset.view = "detail";
  elements.dialogDeleteButton.disabled = Boolean(state.demo?.interviewDemo);
  elements.dialogDeleteButton.hidden = Boolean(state.demo?.interviewDemo);
  const protectedDemoMemory = Boolean(state.demo?.interviewDemo && memory.id.startsWith("demo-"));
  elements.dialogEditButton.disabled = protectedDemoMemory;
  elements.dialogEditButton.title = protectedDemoMemory ? "公开 Demo 的预置展品不可修改" : "编辑这件展品";
  if (!elements.memoryDialog.open) {
    const focusReturnTarget = trigger || (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    lockMemoryDialogBackground(focusReturnTarget, requestedScrollY);
    try {
      elements.memoryDialog.showModal();
    } catch (error) {
      unlockMemoryDialogBackground();
      throw error;
    }
  }
  resetMemoryDialogReadingPosition(memory.id, updatingOpenDialog);
  return true;
}

function resetMemoryDialogReadingPosition(memoryId, focusImmediately = false) {
  elements.dialogBody.scrollTop = 0;
  if (focusImmediately) elements.dialogTitle.focus({ preventScroll: true });
  requestAnimationFrame(() => {
    if (!elements.memoryDialog.open || state.selectedMemoryId !== memoryId) return;
    elements.dialogBody.scrollTop = 0;
    elements.dialogTitle.focus({ preventScroll: true });
  });
}

function renderMemoryDetail(memory) {
  return `
    ${window.TimeIsleMedia?.renderDetailGallery(memory, escapeHtml) || ""}
    <p class="detail-text detail-exhibit-text">${escapeHtml(memory.exhibitText || "暂无展品说明")}</p>
    <h3>原始记忆</h3>
    <div class="detail-raw">${escapeHtml(memory.rawContent || "未保留原文")}</div>
    <div class="detail-grid">
      <div class="detail-field"><small>日期</small><strong>${escapeHtml(formatDate(memory.date) || "未注明")}</strong></div>
      <div class="detail-field"><small>地点</small>${renderEntityChips(memory, "place", memory.location)}</div>
      <div class="detail-field"><small>人物</small>${renderEntityChips(memory, "person", memory.people || [])}</div>
      <div class="detail-field"><small>来源</small><strong>${escapeHtml(memory.sourceType || "其他")}</strong></div>
      <div class="detail-field"><small>重要度</small><strong>${escapeHtml(String(memory.importance || 1))} / 5</strong></div>
      <div class="detail-field"><small>情绪强度</small><strong>${escapeHtml(String(memory.emotionIntensity || 3))} / 5</strong></div>
    </div>
    <div class="tag-list detail-tags">${renderEntityChips(memory, "theme", memory.tags || [], true)}${(memory.emotions || []).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>
    ${window.TimeIsleVoice?.renderDetailVoices(memory, escapeHtml) || ""}
    <details class="detail-advanced">
      <summary><span><strong>来源护照与更多视角</strong><small>年轮、来源、多视角和影像实验工具</small></span><span aria-hidden="true">＋</span></summary>
      <div class="detail-advanced-body">
        <p class="detail-advanced-status" role="status">展开后按需加载年轮、来源、多视角和影像实验工具。</p>
      </div>
    </details>`;
}
async function hydrateDetailAdvanced(memory, details) {
  if (!details?.isConnected || details.dataset.loaded === "true" || details.dataset.loading === "true") return;
  const body = details.querySelector(".detail-advanced-body");
  if (!body) return;
  details.dataset.loading = "true";
  body.setAttribute("aria-busy", "true");
  body.innerHTML = '<p class="detail-advanced-status" role="status">正在按需加载项目幕后工具…</p>';
  try {
    await ensureDetailModules();
    if (!details.isConnected || state.selectedMemoryId !== memory.id) return;
    body.innerHTML = renderDetailAdvancedPanels(memory);
    mediaEvidenceController?.open(memory, elements.dialogBody);
    mediaLabController?.open(memory, elements.dialogBody);
    revisionsController?.open(memory, elements.dialogBody);
    provenanceController?.open(memory, elements.dialogBody);
    coMemoryLetterController?.open(memory, elements.dialogBody);
    multiPerspectiveController?.open(memory, elements.dialogBody);
    details.dataset.loaded = "true";
  } catch (error) {
    if (!details.isConnected) return;
    body.replaceChildren();
    const status = document.createElement("p");
    status.className = "detail-advanced-status is-error";
    status.setAttribute("role", "alert");
    status.textContent = "更多视角暂时无法加载：" + error.message;
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "button text-button compact";
    retry.textContent = "重新加载";
    retry.addEventListener("click", () => hydrateDetailAdvanced(memory, details), { once: true });
    body.append(status, retry);
  } finally {
    delete details.dataset.loading;
    body.removeAttribute("aria-busy");
  }
}

function renderDetailAdvancedPanels(memory) {
  return [
    window.TimeIsleProvenance?.renderPanel(memory) || "",
    window.TimeIsleCoMemoryLetters?.renderPanel(memory) || "",
    window.TimeIsleMultiPerspective?.renderPanel(memory) || "",
    window.TimeIsleMediaEvidence?.renderPanel(memory) || "",
    window.TimeIsleMediaLab?.renderPanel(memory, escapeHtml) || ""
  ].join("");
}

function renderEntityChips(memory, type, fallback, tags = false) {
  const refs = (memory.entityRefs || memory.entities || []).filter((item) => ({ people: "person", location: "place" }[item.type] || item.type) === type && (item.id || item.entityId));
  if (!refs.length) {
    const values = Array.isArray(fallback) ? fallback : [fallback];
    return tags ? values.filter(Boolean).map((value) => `<span class="tag">${escapeHtml(value)}</span>`).join("") : `<strong>${escapeHtml(values.filter(Boolean).join("、") || "未注明")}</strong>`;
  }
  return `<span class="clue-entity-chips clue-detail-entities">${refs.map((item) => `<button type="button" class="clue-entity-chip" data-entity-id="${escapeHtml(item.id || item.entityId)}"><span aria-hidden="true">${type === "person" ? "人" : type === "place" ? "地" : "题"}</span>${escapeHtml(item.label || item.canonicalName || item.name || item.sourceValue || "未命名线索")}</button>`).join("")}</span>`;
}

function composeInboxItem(item) {
  if (!memoryInboxController) return;
  if (hasComposerWork() && !window.confirm("整理这段文档会替换记录页当前未保存的草稿和附件。是否继续？")) return false;
  resetComposer({ internal: true, silent: true });
  const prepared = memoryInboxController.prepareComposer(item);
  state.inboxItem = prepared.item;
  state.draft = prepared.draft;
  state.workflow = prepared.workflow;
  populateDraft(state.draft);
  elements.draftPlaceholder.hidden = true;
  elements.draftForm.hidden = false;
  elements.organizePanel.hidden = false;
  renderWorkflow(state.workflow);
  updateCharCount();
  setAnalyzeStatus("这段文字仍在收件箱。请先点击“保存记忆”，它会与来源回执一起入馆；随后可以继续补充草稿。", false, true);
  switchView("compose", { focusHeading: true });
  state.composerRevision += 1;
  elements.draftTitleInput.focus();
  return true;
}

function leaveInboxComposeMode() {
  state.inboxItem = null;
  memoryInboxController?.setComposerLocked(false);
}

function insertSample() {
  if (state.composerOperation) return;
  if (hasComposerWork() && !window.confirm("放入示例会开始一条新记录，并清除当前未保存的草稿、照片和声音。是否继续？")) return;
  resetComposer({ internal: true, silent: true });
  const current = elements.rawContent.value.trim();
  const candidates = sampleMemories.filter((sample) => sample !== current);
  elements.rawContent.value = candidates[Math.floor(Math.random() * candidates.length)] || sampleMemories[0];
  handleRawContentInput();
  elements.rawContent.focus();
}

async function saveOriginalMemory(event) {
  event.preventDefault();
  if (!validateForm(elements.memoryForm, elements.analyzeStatus)) return;
  const rawContent = elements.rawContent.value.trim();
  if (state.demo?.interviewDemo) {
    setAnalyzeStatus("公开 Demo 为只读展馆，只能查看下方虚构整理样例。", true);
    return;
  }
  const operation = beginComposerOperation("save-original");
  if (!operation) return;
  elements.saveOriginalButton.textContent = "正在先保存原文…";
  const targetMemoryId = state.editingMemoryId || state.pendingSaveMemoryId;
  const inboxAdmission = Boolean(state.inboxItem && !targetMemoryId);
  let saved = null;
  let attachmentError = null;
  try {
    if (inboxAdmission) {
      saved = await memoryInboxController.admit(state.inboxItem, { ...state.draft, rawContent });
      state.inboxItem = null;
    } else {
      const body = targetMemoryId
        ? { rawContent, expectedUpdatedAt: state.draft?.updatedAt || "", changeNote: "更新原始记忆" }
        : { rawContent };
      saved = await requestJson(targetMemoryId ? `/api/memories/${encodeURIComponent(targetMemoryId)}` : "/api/memories", {
        method: targetMemoryId ? "PUT" : "POST",
        body: JSON.stringify(body)
      });
    }
    ensureComposerOperation(operation);
    state.draft = { ...saved.memory };
    state.pendingSaveMemoryId = saved.memory.id;
    elements.organizePanel.hidden = false;
    elements.postSaveTools.hidden = false;
    elements.originalSavedStatus.hidden = false;
    setAnalyzeStatus("原文已经先保存。接下来可以直接离开，也可以选择 AI 整理；照片或声音失败不会影响这段原文。", false, true);

    try {
      await runAttachmentControllers("waitForReady");
      ensureComposerOperation(operation);
      await runAttachmentControllers("saveToMemory", saved.memory.id);
      ensureComposerOperation(operation);
    } catch (error) {
      attachmentError = error;
    }
    await reloadMemories();
    ensureComposerOperation(operation);
    const latest = state.memories.find((item) => item.id === saved.memory.id);
    if (latest) state.draft = { ...latest };
    elements.saveOriginalButton.textContent = "原文已保存";
    showToast(attachmentError ? "原文已保存；附件可以修正后再继续。" : "原文和已就绪附件都已保存。", Boolean(attachmentError));
    if (attachmentError) setAnalyzeStatus(`原文已安全保存；${attachmentError.message}。修正附件后再次点击“原文已保存”即可继续关联。`, true);
    else markComposerBaseline();
  } catch (error) {
    if (!isComposerOperationCancelled(error)) setAnalyzeStatus(error.message, true);
  } finally {
    finishComposerOperation(operation);
    if (!state.pendingSaveMemoryId) elements.saveOriginalButton.textContent = "保存记忆";
  }
}

async function analyzeMemory() {
  const demo = Boolean(state.demo?.interviewDemo);
  let rawContent = elements.rawContent.value.trim();
  if (!rawContent) {
    markFieldValidation(elements.rawContent, elements.analyzeStatus, "请先写下一段记忆正文。");
    return;
  }
  if (!demo && !state.pendingSaveMemoryId && !state.editingMemoryId) {
    setAnalyzeStatus("请先点击“保存记忆”。原文落库后，整理才会成为可选步骤。", true);
    return;
  }
  setAnalyzeStatus(demo ? "正在生成只读虚构样例…" : "正在生成一份尚未写回的整理草稿…");
  state.organizeExecution = null;
  state.organizeReceipt = null;
  elements.saveMemoryButton.textContent = saveButtonLabel();
  const requestId = ++state.organizeRequest;
  elements.analyzeButton.disabled = true;
  elements.analyzeButton.textContent = "整理中…";
  try {
    if (!demo && state.draft?.rawContent !== rawContent) {
      const targetId = state.editingMemoryId || state.pendingSaveMemoryId;
      const refreshed = await requestJson(`/api/memories/${encodeURIComponent(targetId)}`, {
        method: "PUT",
        body: JSON.stringify({
          rawContent,
          expectedUpdatedAt: state.draft?.updatedAt || "",
          changeNote: "整理前同步当前原文"
        })
      });
      state.draft = { ...refreshed.memory };
      await reloadMemories();
    }
    const allowExternalAi = !demo && Boolean(elements.organizeExternalConsent?.checked);
    if (elements.organizeExternalConsent) elements.organizeExternalConsent.checked = false;
    const targetMemoryId = state.editingMemoryId || state.pendingSaveMemoryId;
    const externalAiConsent = allowExternalAi ? await buildExternalAiConsent("organize", rawContent) : null;
    const result = demo
      ? await requestJson("/api/demo/compose-sample")
      : await requestJson("/api/analyze", {
          method: "POST",
          body: JSON.stringify({
            rawContent,
            memoryId: targetMemoryId,
            allowExternalAi,
            externalAiConsent
          })
        });
    if (requestId !== state.organizeRequest || (!demo && elements.rawContent.value.trim() !== rawContent)) {
      setAnalyzeStatus("原文在整理期间发生了变化，本次旧结果未采用；请确认当前原文后重新整理。", false, true);
      return;
    }
    rawContent = demo ? result.rawContent : rawContent;
    if (demo) {
      elements.rawContent.value = rawContent;
      updateCharCount();
    }
    state.draft = { ...state.draft, ...result.draft, rawContent };
    state.workflow = result.workflow;
    state.organizeExecution = result.execution || null;
    state.organizeReceipt = result.executionReceipt || null;
    elements.saveMemoryButton.textContent = saveButtonLabel();
    populateDraft(state.draft);
    renderWorkflow(result.workflow);
    elements.draftPlaceholder.hidden = true;
    elements.draftForm.hidden = false;
    const executionLabel = executionLabelFor(result.execution);
    setAnalyzeStatus(`${result.notice || "整理完成，请确认后更新。"}${executionLabel ? ` · 实际执行：${executionLabel}` : ""}`, false, true);
    elements.draftTitleInput.focus();
  } catch (error) {
    if (requestId !== state.organizeRequest) return;
    setAnalyzeStatus(error.message, true);
  } finally {
    elements.analyzeButton.disabled = false;
    elements.analyzeButton.textContent = demo ? "查看虚构整理样例" : "重新生成整理草稿";
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
  if (!validateForm(elements.draftForm, elements.analyzeStatus)) return;
  if (!state.draft) return;
  if (state.demo?.interviewDemo) {
    setAnalyzeStatus("公开 Demo 的整理草稿不会写回；这是固定虚构样例。", false, true);
    return;
  }
  const targetMemoryId = state.editingMemoryId || state.pendingSaveMemoryId;
  if (!targetMemoryId) {
    setAnalyzeStatus("请先保存原文，再确认整理草稿。", true);
    return;
  }
  const memory = {
    ...state.draft,
    rawContent: elements.rawContent.value.trim(),
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
    expectedUpdatedAt: state.draft.updatedAt || "",
    changeNote: state.organizeReceipt ? "确认并写回可选整理草稿" : "保存展品信息修改",
    ...(state.organizeReceipt ? {
      organizeReceipt: { confirmed: true, receipt: state.organizeReceipt }
    } : {})
  };
  const operation = beginComposerOperation("save-draft");
  if (!operation) return;
  elements.saveMemoryButton.textContent = "保存中…";
  const editing = Boolean(state.editingMemoryId);
  const organizing = Boolean(state.organizeReceipt);
  let contentSaved = false;
  let attachmentsSaved = false;
  memory.id = targetMemoryId;
  try {
    const saved = await requestJson(`/api/memories/${encodeURIComponent(targetMemoryId)}`, {
      method: "PUT",
      body: JSON.stringify(memory)
    });
    ensureComposerOperation(operation);
    contentSaved = true;
    state.draft = { ...saved.memory }; state.pendingSaveMemoryId = saved.memory.id;
    await runAttachmentControllers("waitForReady");
    ensureComposerOperation(operation);
    await runAttachmentControllers("saveToMemory", saved.memory.id);
    ensureComposerOperation(operation);
    attachmentsSaved = true;
    await reloadMemories();
    ensureComposerOperation(operation);
    resetComposer({ internal: true, silent: true });
    switchView("collection", { focusHeading: true, skipComposerGuard: true });
    showToast(organizing ? "整理草稿已确认，并写回同一件展品。" : editing ? "展品修改已保存。" : "记忆已经保存为展品。", false);
  } catch (error) {
    if (isComposerOperationCancelled(error)) return;
    if (contentSaved && !attachmentsSaved) setAnalyzeStatus(`展品正文已保存，${error.message}。请修正后点击“继续完成保存”；不会重复创建展品。`, true);
    else if (contentSaved) setAnalyzeStatus(`展品已保存，但页面刷新失败：${error.message}。点击“继续完成保存”会复用同一件展品。`, true);
    else if (state.pendingSaveMemoryId) setAnalyzeStatus(`未能继续完成保存：${error.message}。再次尝试仍会复用同一件展品。`, true);
    else setAnalyzeStatus(error.message, true);
  } finally {
    finishComposerOperation(operation);
    elements.saveMemoryButton.textContent = saveButtonLabel();
  }
}

async function runAttachmentControllers(method, memoryId) {
  try { const results = await Promise.allSettled([mediaController?.[method](memoryId), voiceController?.[method](memoryId)]), failed = results.find((item) => item.status === "rejected"); if (failed) throw failed.reason; return results.map((item) => item.value); }
  catch (error) { throw new Error(`附件未完成：${error.message}`); }
}
function saveButtonLabel() {
  if (state.organizeReceipt) return "确认整理并更新展品";
  return state.editingMemoryId ? "保存修改" : "更新这件展品";
}

function requestComposerReset() {
  if (state.composerOperation) return;
  if (hasComposerWork() && !window.confirm("重新开始会清除当前未保存的草稿、照片和声音；已经入馆的原文不会被删除。是否继续？")) return;
  resetComposer({ internal: true });
  elements.rawContent.focus();
}

function resetComposer(options = {}) {
  if (state.composerOperation && options.internal !== true) return false;
  state.composerResetting = true;
  try {
    state.organizeRequest += 1;
    state.draft = null;
    state.workflow = null;
    state.organizeExecution = null;
    state.organizeReceipt = null;
    state.editingMemoryId = "";
    state.pendingSaveMemoryId = "";
    state.inboxItem = null;
    mediaController?.reset();
    voiceController?.reset();
    elements.memoryForm.reset();
    memoryInboxController?.setComposerLocked(false);
    elements.draftForm.reset();
    [elements.rawContent, elements.draftTitleInput, elements.draftExhibitText].forEach((field) => resetFieldValidation(field, elements.analyzeStatus));
    delete elements.analyzeStatus.dataset.validationFor;
    elements.draftForm.hidden = true;
    elements.draftPlaceholder.hidden = false;
    elements.organizePanel.hidden = Boolean(state.demo?.interviewDemo) ? false : true;
    elements.postSaveTools.hidden = true;
    elements.originalSavedStatus.hidden = true;
    if (elements.organizeExternalConsent) elements.organizeExternalConsent.checked = false;
    if (elements.guideExternalConsent) elements.guideExternalConsent.checked = false;
    elements.workflowSteps.innerHTML = "";
    elements.saveMemoryButton.textContent = saveButtonLabel();
    elements.saveOriginalButton.textContent = state.demo?.interviewDemo ? "公开 Demo 不保存" : "保存记忆";
    if (!options.keepStatus) setAnalyzeStatus("");
    updateCharCount();
    updateEmotionIntensity();
  } finally {
    state.composerResetting = false;
  }
  state.composerRevision += 1;
  markComposerBaseline();
  return true;
}

function markComposerChanged() {
  if (state.composerResetting || state.composerOperation || activeView !== "compose") return;
  state.composerRevision += 1;
}

function markComposerBaseline() {
  state.composerBaselineRevision = state.composerRevision;
}

function hasComposerWork() {
  if (state.composerRevision !== state.composerBaselineRevision) return true;
  if (elements.rawContent.value.trim() || state.draft || state.editingMemoryId || state.pendingSaveMemoryId || state.inboxItem) return true;
  if (mediaController?.getSnapshot?.().count) return true;
  if (voiceController?.getState?.().count) return true;
  return false;
}

function beginComposerOperation(kind) {
  if (state.composerOperation) {
    showToast("当前保存步骤尚未完成，请稍候。", true);
    return null;
  }
  const operation = {
    id: ++state.composerOperationSequence,
    kind,
    revision: state.composerRevision
  };
  state.composerOperation = operation;
  const controls = [...new Set([
    ...elements.memoryForm.querySelectorAll("input, textarea, select, button"),
    ...elements.draftForm.querySelectorAll("input, textarea, select, button"),
    elements.sampleButton,
    elements.analyzeButton,
    elements.resetDraftButton
  ].filter(Boolean))];
  composerDisabledSnapshot = new Map(controls.map((control) => [control, control.disabled]));
  controls.forEach((control) => { control.disabled = true; });
  elements.memoryForm.setAttribute("aria-busy", "true");
  elements.draftForm.setAttribute("aria-busy", "true");
  mediaController?.setExternalBusy?.(true);
  voiceController?.setExternalBusy?.(true);
  return operation;
}

function ensureComposerOperation(operation) {
  if (state.composerOperation !== operation || state.composerRevision !== operation.revision) {
    const error = new Error("当前保存步骤已经失效。");
    error.name = "AbortError";
    error.code = "COMPOSER_OPERATION_CANCELLED";
    throw error;
  }
}

function isComposerOperationCancelled(error) {
  return error?.code === "COMPOSER_OPERATION_CANCELLED";
}

function finishComposerOperation(operation) {
  if (state.composerOperation !== operation) return;
  state.composerOperation = null;
  mediaController?.setExternalBusy?.(false);
  voiceController?.setExternalBusy?.(false);
  composerDisabledSnapshot?.forEach((disabled, control) => {
    if (control?.isConnected) control.disabled = disabled;
  });
  composerDisabledSnapshot = null;
  elements.memoryForm.removeAttribute("aria-busy");
  elements.draftForm.removeAttribute("aria-busy");
}

function updateCharCount() {
  elements.charCount.textContent = `${elements.rawContent.value.length} / 4000`;
}

function handleRawContentInput() {
  updateCharCount();
  markComposerChanged();
  const invalidatedPendingRequest = elements.analyzeButton.disabled;
  state.organizeRequest += 1;
  if (invalidatedPendingRequest && !state.organizeReceipt) {
    setAnalyzeStatus("原文仍可继续修改；正在返回的旧整理结果将不会采用。", false, true);
    return;
  }
  if (!state.organizeReceipt) return;
  state.organizeReceipt = null;
  state.organizeExecution = null;
  elements.saveMemoryButton.textContent = saveButtonLabel();
  setAnalyzeStatus("原文已变化，上一份整理回执已失效；可以重新整理，也可以直接保存当前修改。", false, true);
}

function updateEmotionIntensity() {
  elements.emotionIntensityOutput.textContent = `${elements.draftEmotionIntensity.value} / 5`;
}

function setAnalyzeStatus(message, isError = false, isSuccess = false) {
  elements.analyzeStatus.textContent = message;
  elements.analyzeStatus.classList.toggle("is-error", isError);
  elements.analyzeStatus.classList.toggle("is-success", isSuccess);
}

function validateForm(form, status) {
  const fields = [...form.elements].filter((field) => field.matches?.("input, textarea, select") && !field.disabled);
  fields.forEach((field) => resetFieldValidation(field, status));
  const invalid = fields.find((field) => !isFieldValid(field));
  if (!invalid) return true;
  const messages = { rawContent: "请先写下一段记忆正文。", draftTitleInput: "请为这件展品填写标题。", draftExhibitText: "请为这件展品填写展签说明。", guideQuestion: "请先写下一个问题。" };
  markFieldValidation(invalid, status, messages[invalid.id] || invalid.validationMessage || "请先填写这个必填项。");
  return false;
}

function isFieldValid(field) {
  if (field.required && typeof field.value === "string" && !field.value.trim()) return false;
  return typeof field.checkValidity !== "function" || field.checkValidity();
}

function markFieldValidation(field, status, message) {
  if (!field || !status) return;
  field.setAttribute("aria-invalid", "true"); field.setAttribute("aria-describedby", status.id);
  status.dataset.validationFor = field.id; status.textContent = message;
  status.classList.add("is-error"); status.classList.remove("is-success");
  field.focus({ preventScroll: false });
}

function clearFieldValidation(field, status) {
  if (!field || !status || !isFieldValid(field)) return;
  resetFieldValidation(field, status);
  if (status.dataset.validationFor !== field.id) return;
  delete status.dataset.validationFor; status.textContent = "";
  status.classList.remove("is-error", "is-success");
}

function resetFieldValidation(field, status) {
  field.removeAttribute("aria-invalid"); if (field.getAttribute("aria-describedby") === status.id) field.removeAttribute("aria-describedby");
}

async function askGuide(event) {
  event.preventDefault();
  if (!validateForm(elements.guideForm, elements.guideAnswer)) return;
  const question = elements.guideQuestion.value.trim();
  const demo = Boolean(state.demo?.interviewDemo);
  const fixedQuestionId = elements.guideForm.dataset.questionId || "";
  if (demo && !fixedQuestionId) {
    elements.guideAnswer.textContent = "公开 Demo 只回答下方三个固定虚构问题，请任选一个。";
    return;
  }
  state.guideController?.abort();
  const controller = new AbortController();
  const requestId = ++state.guideRequest;
  state.guideController = controller;
  setGuideBusy(true);
  elements.guideAskButton.textContent = "查找中…";
  elements.guideAnswer.classList.add("is-loading");
  elements.guideAnswer.textContent = "正在检索馆藏并核对引用…";
  elements.citationList.innerHTML = "";
  try {
    const allowExternalAi = !demo && Boolean(elements.guideExternalConsent?.checked);
    if (elements.guideExternalConsent) elements.guideExternalConsent.checked = false;
    const externalAiConsent = allowExternalAi ? await buildExternalAiConsent("guide", question, controller.signal) : null;
    const result = demo
      ? await requestJson(`/api/demo/guide?id=${encodeURIComponent(fixedQuestionId)}`, { signal: controller.signal })
      : await requestJson("/api/guide", {
          method: "POST",
          signal: controller.signal,
          body: JSON.stringify({
            question,
            allowExternalAi,
            externalAiConsent
          })
        });
    if (requestId !== state.guideRequest) return;
    elements.guideAnswer.classList.remove("is-loading");
    elements.guideAnswer.textContent = `${normalizeAnswerPunctuation(result.answer)}\n\n实际执行：${executionLabelFor(result.execution)}`;
    elements.citationList.innerHTML = (result.citations || []).map((citation, index) => `
      <div class="citation-item">
        <button type="button" data-memory-id="${escapeHtml(citation.id)}">
          <strong>[${index + 1}] ${escapeHtml(citation.title)}</strong>
          <span>${escapeHtml(citation.reason || citation.confidence?.reason || "馆藏引用")}</span>
        </button>
      </div>`).join("");
  } catch (error) {
    if (requestId !== state.guideRequest || error?.name === "AbortError") return;
    elements.guideAnswer.classList.remove("is-loading");
    elements.guideAnswer.textContent = humanRequestError(error, "本次提问没有完成，请稍后重试。");
  } finally {
    if (requestId === state.guideRequest) {
      elements.guideForm.dataset.questionId = "";
      state.guideController = null;
      setGuideBusy(false);
      elements.guideAskButton.textContent = "提问";
    }
  }
}

function setGuideBusy(busy) {
  elements.guideAskButton.disabled = busy;
  elements.guideForm.setAttribute("aria-busy", String(busy));
  document.querySelectorAll("[data-question]").forEach((button) => { button.disabled = busy; });
}

function normalizeAnswerPunctuation(value) {
  return String(value || "").replace(/([。！？])\1+/gu, "$1").replace(/。([！？])/gu, "$1");
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
  if (!state.selectedMemoryId || state.collectionTotal < 2) return;
  const focusId = state.selectedMemoryId;
  elements.memoryDialog.close();
  state.routeFocusId = focusId;
  switchView("reflect");
  elements.moreRecallDetails.open = true;
  switchInsightTab("routes");
  elements.routesPanel.focus({ preventScroll: true });
}

async function openPuzzle(leftId, rightId) {
  if (!leftId || !rightId || leftId === rightId) return;
  const session = ++state.puzzleSession;
  state.puzzle = null;
  state.puzzleBusyOwners.clear();
  resetPuzzleDialog();
  if (!elements.puzzleDialog.open) elements.puzzleDialog.showModal();
  requestAnimationFrame(() => document.querySelector("#puzzleTitle")?.focus({ preventScroll: true }));
  const oralModule = ensureOralHistoryModule()
    .then((controller) => {
      if (session !== state.puzzleSession || !state.puzzle) return;
      controller.syncPuzzle({ payload: state.puzzle, demo: state.demo?.interviewDemo !== false, sessionKey: state.puzzleSession });
    })
    .catch((error) => {
      if (session === state.puzzleSession) showToast(`口述补充暂时不可用；基础拼图仍可查看：${error.message}`, true);
    });
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
  void oralModule;
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
  oralHistoriesController?.syncPuzzle({ payload, demo: Boolean(state.demo?.interviewDemo), sessionKey: state.puzzleSession });

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
  if (!pair || state.puzzleBusyOwners.size) return;
  const answer = elements.puzzleAnswer.value.trim();
  if (action === "answer" && !answer) {
    elements.puzzleStatus.textContent = "请先写下补充，或选择保留不确定。";
    elements.puzzleStatus.classList.add("is-error");
    return;
  }
  const session = state.puzzleSession;
  const activePair = puzzlePairKey(pair);
  setPuzzleBusy("host", true);
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
    if (session === state.puzzleSession) setPuzzleBusy("host", false);
  }
}

async function confirmPuzzleEvent() {
  const pair = state.puzzle?.puzzle?.pair;
  if (!pair || state.puzzleBusyOwners.size) return;
  if (state.puzzle?.event) {
    if (state.demo?.interviewDemo) return;
    await removePuzzleEvent();
    return;
  }
  if (!window.confirm("确认把这两段记录保存为同一往事的两个版本吗？原文不会被合并或改写。")) return;
  const session = state.puzzleSession;
  const activePair = puzzlePairKey(pair);
  setPuzzleBusy("host", true);
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
    if (session === state.puzzleSession) setPuzzleBusy("host", false);
  }
}

async function removePuzzleEvent() {
  const eventId = state.puzzle?.event?.id;
  const pair = state.puzzle?.puzzle?.pair;
  if (!eventId || !pair || state.puzzleBusyOwners.size) return;
  if (!window.confirm("解除这组时光拼图吗？两段原文会继续保留；已保存的字段证据、时间校准与这组口述来源会一并移除。")) return;
  const session = state.puzzleSession;
  const activePair = puzzlePairKey(pair);
  setPuzzleBusy("host", true);
  elements.puzzleConfirmButton.textContent = "解除中…";
  try {
    const result = await requestJson(`/api/archaeology/events/${encodeURIComponent(eventId)}`, { method: "DELETE" });
    if (!isCurrentPuzzleSession(session, activePair)) return;
    state.archaeologyOverview = indexArchaeologyOverview(result.overview);
    state.puzzle.event = null;
    state.puzzle.decision = null;
    timeCalibrationController?.reset();
    oralHistoriesController?.reset();
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
    if (session === state.puzzleSession) setPuzzleBusy("host", false);
  }
}

function setPuzzleBusy(owner, busy) {
  if (busy) state.puzzleBusyOwners.add(owner); else state.puzzleBusyOwners.delete(owner);
  const active = state.puzzleBusyOwners.size > 0;
  elements.puzzleSaveAnswerButton.disabled = active || !elements.puzzleAnswer.value.trim();
  elements.puzzleUnknownButton.disabled = active;
  elements.puzzleSkipButton.disabled = active;
  elements.puzzleConfirmButton.disabled = active || Boolean(state.demo?.interviewDemo && state.puzzle?.event);
  elements.puzzleCloseButton.disabled = active;
  timeCalibrationController?.setHostBusy?.([...state.puzzleBusyOwners].some((item) => item !== "calibration"));
  oralHistoriesController?.setHostBusy?.([...state.puzzleBusyOwners].some((item) => item !== "oralHistory"));
}

function updatePuzzleAnswerAction() {
  elements.puzzleSaveAnswerButton.disabled = Boolean(state.puzzleBusyOwners.size) || !elements.puzzleAnswer.value.trim();
}

function resetPuzzleDialog() {
  destroyMediaCompare();
  timeCalibrationController?.reset();
  oralHistoriesController?.reset();
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
  const locations = state.privacy.dataLocations || [];
  elements.dataLocationList.innerHTML = locations.slice(0, 4).map((item) => `
    <div class="data-location-item"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.location)}</span></div>`).join("");
  elements.dataLocationDetails.innerHTML = locations.slice(4).map((item) => `
    <div class="data-location-item"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.location)}</span></div>`).join("");
}

async function loadPrivacy() {
  if (state.privacy) {
    renderPrivacy();
    return state.privacy;
  }
  if (privacyPromise) return privacyPromise;
  elements.privacySummary.textContent = "正在读取数据保存位置…";
  privacyPromise = requestJson("/api/privacy")
    .then((privacy) => {
      state.privacy = privacy;
      renderPrivacy();
      return privacy;
    })
    .catch((error) => {
      elements.privacySummary.textContent = humanRequestError(error, "数据位置暂时无法读取；馆藏其它功能仍可使用。");
      return null;
    })
    .finally(() => { privacyPromise = null; });
  return privacyPromise;
}

async function loadArchaeologyAfterBootstrap(force = false) {
  if (archaeologyPromise && !force) return archaeologyPromise;
  archaeologyPromise = requestJson("/api/archaeology/overview")
    .then((payload) => {
      state.archaeologyOverview = indexArchaeologyOverview(payload.overview);
      renderCollection();
      return payload;
    })
    .catch(() => ({ overview: [] }))
    .finally(() => { archaeologyPromise = null; });
  return archaeologyPromise;
}

function openTechnicalEvidence() {
  const details = document.querySelector("#data-technical");
  if (!details) return;
  details.open = true;
  requestAnimationFrame(() => {
    const title = details.querySelector("#aboutTitle");
    title?.focus({ preventScroll: true });
    details.scrollIntoView({ block: "start", behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  });
}

function lockMemoryDialogBackground(trigger, scrollY = window.scrollY) {
  if (document.body.classList.contains("has-memory-dialog")) return;
  state.dialogScrollY = scrollY;
  state.dialogTrigger = trigger || (document.activeElement instanceof HTMLElement ? document.activeElement : null);
  document.body.style.top = `-${state.dialogScrollY}px`;
  document.body.classList.add("has-memory-dialog");
}

function unlockMemoryDialogBackground() {
  if (!document.body.classList.contains("has-memory-dialog")) return;
  document.body.classList.remove("has-memory-dialog");
  document.body.style.top = "";
  const scrollY = state.dialogScrollY;
  const trigger = state.dialogTrigger;
  state.dialogTrigger = null;
  requestAnimationFrame(() => { trigger?.isConnected && trigger.focus({ preventScroll: true }); window.scrollTo({ top: scrollY, behavior: "auto" }); });
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
  const draftNote = hasComposerWork() ? "记录页当前未保存的草稿和附件也会被清除。" : "";
  const phrase = window.prompt(`该操作会永久清空本地 SQLite 馆藏。${draftNote}请输入 DELETE 确认：`);
  if (phrase !== "DELETE") {
    setDataStatus("已取消清空操作。");
    return;
  }
  try {
    const result = await requestJson("/api/memories/purge", { method: "DELETE", body: JSON.stringify({ confirm: "DELETE" }) });
    resetComposer({ internal: true, silent: true });
    state.selectedMemoryId = "";
    if (elements.memoryDialog.open) elements.memoryDialog.close();
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
  const memory = state.selectedMemory;
  if (!memory?.agentRunId) return;
  if (elements.dialogTraceButton.dataset.view === "trace") {
    await openMemory(memory.id);
    return;
  }
  elements.dialogTraceButton.disabled = true;
  elements.dialogTraceButton.textContent = "读取中…";
  try {
    const payload = await requestJson(`/api/memories/${encodeURIComponent(memory.id)}/agent-run`);
    const run = payload.run;
    mediaEvidenceController?.close();
    mediaLabController?.close();
    provenanceController?.close();
    coMemoryLetterController?.close();
    elements.dialogBody.innerHTML = `
      <h3 id="agentTraceTitle" tabindex="-1">《${escapeHtml(memory.title)}》的整理记录</h3>
      <p class="muted">本次整理模式：${escapeHtml(run.mode)} · ${escapeHtml(formatDateTime(run.createdAt))}</p>
      <div class="agent-run-detail">${(run.steps || []).map((step, index) => `
        <article><strong>${index + 1}. ${escapeHtml(step.agent)}</strong><span>${escapeHtml(step.duty)}</span><p>${escapeHtml(step.output)}</p></article>`).join("")}</div>`;
    elements.dialogBody.scrollTop = 0;
    elements.dialogTraceButton.disabled = false;
    elements.dialogTraceButton.dataset.view = "trace";
    elements.dialogTraceButton.textContent = "返回展品详情";
    elements.dialogBody.querySelector("#agentTraceTitle")?.focus({ preventScroll: true });
  } catch (error) {
    showToast(error.message, true);
    elements.dialogTraceButton.disabled = false;
    elements.dialogTraceButton.textContent = "查看整理记录";
  }
}

async function editSelectedMemory() {
  const memory = state.selectedMemory;
  if (!memory) return;
  if (hasComposerWork() && state.editingMemoryId !== memory.id && !window.confirm("进入另一件展品会清除当前记录页里未保存的草稿和附件。是否继续？")) return;
  const operation = beginDetailOperation("edit", memory.id);
  if (!operation) return;
  elements.dialogEditButton.textContent = "正在准备编辑…";
  try {
    const workflowPromise = memory.agentRunId
      ? requestJson(`/api/memories/${encodeURIComponent(memory.id)}/agent-run`).catch(() => null)
      : Promise.resolve(null);
    const [, , workflowPayload] = await Promise.all([
      Promise.resolve(mediaController?.loadMemory(memory)),
      Promise.resolve(voiceController?.loadMemory(memory)),
      workflowPromise
    ]);
    ensureDetailOperation(operation);
    state.editingMemoryId = memory.id;
    state.pendingSaveMemoryId = "";
    leaveInboxComposeMode();
    state.draft = { ...memory };
    state.workflow = null;
    state.organizeExecution = null;
    state.organizeReceipt = null;
    elements.rawContent.value = memory.rawContent || "";
    populateDraft(memory);
    elements.draftPlaceholder.hidden = true;
    elements.draftForm.hidden = false;
    elements.organizePanel.hidden = false;
    elements.postSaveTools.hidden = false;
    elements.originalSavedStatus.hidden = true;
    elements.saveOriginalButton.textContent = "先保存当前原文";
    elements.saveMemoryButton.textContent = "保存修改";
    elements.workflowSteps.innerHTML = '<p class="muted">这件展品没有可读取的整理记录。</p>';
    if (workflowPayload?.run) {
      state.workflow = { run: workflowPayload.run, steps: workflowPayload.run.steps || [] };
      renderWorkflow(state.workflow);
    }
    updateCharCount();
    setAnalyzeStatus(`正在编辑《${memory.title}》。修改后点击“保存修改”。`, false, true);
    finishDetailOperation(operation);
    elements.memoryDialog.close();
    switchView("compose", { focusHeading: true });
    markComposerBaseline();
  } catch (error) {
    if (!isDetailOperationCancelled(error)) showToast(`暂时无法进入编辑：${error.message}`, true);
  } finally {
    finishDetailOperation(operation);
  }
}

async function deleteSelectedMemory() {
  if (state.demo?.interviewDemo || !state.selectedMemoryId) return;
  const memory = state.selectedMemory;
  if (!window.confirm(`确定删除《${memory?.title || "这件展品"}》吗？该操作无法撤销。`)) return;
  const memoryId = state.selectedMemoryId;
  const operation = beginDetailOperation("delete", memoryId);
  if (!operation) return;
  elements.dialogDeleteButton.textContent = "正在删除…";
  try {
    await requestJson(`/api/memories/${encodeURIComponent(memoryId)}`, { method: "DELETE" });
    ensureDetailOperation(operation);
    if ([state.editingMemoryId, state.pendingSaveMemoryId].includes(memoryId)) resetComposer({ internal: true, silent: true });
    await reloadMemories();
    ensureDetailOperation(operation);
    finishDetailOperation(operation);
    elements.memoryDialog.close();
    state.selectedMemory = null;
    showToast("展品已删除。", false);
  } catch (error) {
    if (!isDetailOperationCancelled(error)) showToast(error.message, true);
  } finally {
    finishDetailOperation(operation);
  }
}

function beginDetailOperation(kind, memoryId) {
  if (state.detailOperation) return null;
  const operation = {
    id: ++state.detailOperationSequence,
    kind,
    memoryId,
    controls: [elements.dialogRouteButton, elements.dialogTraceButton, elements.dialogEditButton, elements.dialogDeleteButton, elements.dialogCloseButton]
      .filter(Boolean)
      .map((control) => ({ control, disabled: control.disabled, text: control.textContent }))
  };
  state.detailOperation = operation;
  operation.controls.forEach(({ control }) => { control.disabled = true; });
  elements.memoryDialog.setAttribute("aria-busy", "true");
  return operation;
}

function ensureDetailOperation(operation) {
  if (state.detailOperation !== operation || state.selectedMemoryId !== operation.memoryId) {
    const error = new Error("详情操作已经取消。");
    error.code = "DETAIL_OPERATION_CANCELLED";
    throw error;
  }
}

function isDetailOperationCancelled(error) {
  return error?.code === "DETAIL_OPERATION_CANCELLED";
}

function finishDetailOperation(operation) {
  if (state.detailOperation !== operation) return;
  state.detailOperation = null;
  operation.controls.forEach(({ control, disabled, text }) => {
    if (!control?.isConnected) return;
    control.disabled = disabled;
    control.textContent = text;
  });
  elements.memoryDialog.removeAttribute("aria-busy");
}

function cancelDetailOperation() {
  const operation = state.detailOperation;
  if (!operation) return;
  finishDetailOperation(operation);
}

async function reloadMemories() {
  const params = new URLSearchParams({ view: "card", limit: "30", sort: elements.sortSelect.value });
  if (elements.hallFilter.value !== "all") params.set("hall", elements.hallFilter.value);
  const payload = await requestJson(`/api/memories?${params}`);
  state.memories = payload.memories || [];
  state.collectionTotal = Number(payload.total ?? state.memories.length);
  state.collectionSummary = payload.summary || state.collectionSummary;
  state.collectionNextCursor = String(payload.nextCursor || "");
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
  memoryLensController?.invalidate?.();
  semanticRecallController?.invalidate?.();
  memoryInboxController?.load();
  renderStats();
  void loadArchaeologyAfterBootstrap(true);
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

function executionLabelFor(execution = {}) {
  if (execution.mode === "external-model") return `外部模型 · ${execution.provider || "OpenAI-compatible provider"} · ${execution.model || "未标注模型"}`;
  if (execution.mode === "local-rules-fallback") return execution.externalRequestOccurred ? "外部请求失败后回退到本地规则" : "本地规则回退";
  if (execution.mode === "public-fixture") return "公开 Mock";
  return execution.engineId === "local-evidence-guide-v1" ? "本地规则讲解" : "本地规则整理";
}

async function buildExternalAiConsent(feature, input, signal) {
  const contractId = state.trust?.contractId;
  if (!/^sha256:[a-f0-9]{64}$/u.test(String(contractId || "")) || !globalThis.crypto?.subtle) {
    throw new Error("当前页面无法核对外部 AI 信任合同，请刷新后重试。");
  }
  const bytes = new TextEncoder().encode(`${feature}\u0000${input}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const acknowledgement = {
    acknowledged: true,
    contractId,
    feature,
    inputSha256: [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("")
  };
  const result = await requestJson("/api/ai/consent", {
    method: "POST",
    signal,
    body: JSON.stringify(acknowledgement)
  });
  if (!result?.consent) throw new Error("外部 AI 的一次性同意没有签发，请重新核对后再试。");
  return result.consent;
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
  const method = String(options.method || "GET").toUpperCase();
  const maximumAttempts = method === "GET" ? 2 : 1;
  const deadline = Date.now() + 20_000;
  let lastError;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    if (options.signal?.aborted) throw options.signal.reason || new DOMException("请求已取消", "AbortError");
    const attemptsLeft = maximumAttempts - attempt + 1;
    const remaining = Math.max(1, deadline - Date.now());
    const attemptBudget = Math.max(1, Math.floor(remaining / attemptsLeft));
    const controller = new AbortController();
    let timedOut = false;
    const relayAbort = () => controller.abort(options.signal?.reason || new DOMException("请求已取消", "AbortError"));
    options.signal?.addEventListener("abort", relayAbort, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort(new DOMException("请求超时", "TimeoutError"));
    }, attemptBudget);
    try {
      const { signal: _externalSignal, ...fetchOptions } = options;
      const response = await fetch(url, {
        ...fetchOptions,
        signal: controller.signal,
        headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) }
      });
      const contentType = response.headers.get("content-type") || "";
      const payload = contentType.includes("application/json") ? await response.json() : await response.text();
      if (!response.ok) {
        const error = new Error((typeof payload === "object" ? payload.error : payload) || `请求失败（${response.status}）`);
        Object.assign(error, { status: response.status, code: payload?.code || "", updatedAt: payload?.updatedAt || "" });
        throw error;
      }
      return payload;
    } catch (error) {
      if (options.signal?.aborted) throw options.signal.reason || new DOMException("请求已取消", "AbortError");
      lastError = timedOut ? Object.assign(new Error("请求超过 20 秒仍未完成。"), { code: "REQUEST_TIMEOUT", name: "TimeoutError" }) : error;
      if (attempt >= maximumAttempts || !shouldRetryGet(lastError)) throw lastError;
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", relayAbort);
    }
  }
  throw lastError || new Error("请求未完成。");
}

function shouldRetryGet(error) {
  if (!error) return false;
  if (error.name === "AbortError") return false;
  if (!error.status) return true;
  return [408, 502, 503, 504].includes(Number(error.status));
}

function humanRequestError(error, fallback) {
  if (error?.code === "REQUEST_TIMEOUT" || error?.name === "TimeoutError") return "请求等待超过 20 秒，请检查服务状态后重试。";
  if (!navigator.onLine) return "当前设备已离线；恢复网络后请重试。";
  if (error?.message === "Failed to fetch" || error instanceof TypeError) return "无法连接服务，请确认本地服务或网络可用后重试。";
  return String(error?.message || fallback || "请求暂时无法完成，请稍后重试。");
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
