const STORAGE_KEY = "memory-museum-items";
const PROFILE_KEY = "memory-museum-local-profile";
const ASSET_AUDIT_KEY = "memory-museum-asset-audit";
const ASSET_SNAPSHOT_KEY = "memory-museum-asset-snapshots";
const PHASE16_SYNC_AUDIT_KEY = "memory-museum-phase16-sync-audit";
const PHASE17_DEVICE_REGISTRY_KEY = "memory-museum-phase17-device-registry";
const PHASE17_SYNC_QUEUE_KEY = "memory-museum-phase17-sync-queue";
const PHASE17_PRIVATE_CLOUD_KEY = "memory-museum-phase17-private-cloud-boundary";
const PHASE18_AGENT_FEEDBACK_KEY = "memory-museum-phase18-agent-feedback";
const PHASE18_REPAIR_DRAFT_KEY = "memory-museum-phase18-repair-drafts";
const PHASE18_TASK_QUEUE_KEY = "memory-museum-phase18-task-queue";
const PHASE18_TASK_AUDIT_KEY = "memory-museum-phase18-task-audit";
const PHASE18_NOISE_RULE_KEY = "memory-museum-phase18-noise-rules";
const PHASE19_IMPORT_PREVIEW_KEY = "memory-museum-phase19-import-preview";
const PHASE19_IMPORT_BATCHES_KEY = "memory-museum-phase19-import-batches";
const PHASE19_CUSTOM_TEMPLATES_KEY = "memory-museum-phase19-custom-templates";
const SCHEMA_VERSION = 2;
const API_MEMORIES = "/api/memories";
const API_WORKFLOWS = "/api/workflows";
const API_PRIVACY = "/api/privacy";
const API_VERSION = "/api/version";
const API_OPERATIONS = "/api/operations";
const API_ASSETS = "/api/assets";
const API_EXHIBITIONS = "/api/exhibitions";
const API_REPORT_DRAFTS = "/api/report-drafts";

const emotionOptions = [
  "怀念",
  "快乐",
  "遗憾",
  "平静",
  "荒诞",
  "感动",
  "兴奋",
  "紧张",
  "孤独",
  "委屈",
  "愤怒",
  "害怕",
  "释然",
  "期待",
  "温暖",
  "迷茫"
];

const sourceTypes = ["日记", "聊天片段", "照片描述", "旅行片段", "梦境", "物品", "图片", "截图", "语音转写", "其他"];
const importanceLabels = ["普通展品", "值得一看", "重要展品", "珍贵展品", "镇馆级"];
const attachmentTypeOrder = ["图片", "OCR", "语音", "文档", "视频", "其他"];
const AI_BUTTON_TEXT = "Agent 整理";
const AI_BUTTON_PENDING_TEXT = "整理中...";
const workflowTemplates = [
  {
    id: "memory-curation",
    name: "展品整理工作流",
    purpose: "原始记忆到展品草稿",
    entry: "/api/analyze",
    nodes: ["档案员", "策展人", "编辑", "讲解员"],
    controls: ["确认", "驳回", "重试", "保存"],
    statusLabel: "可运行",
    maturity: "active",
    pausePoints: ["待复核", "已确认", "已驳回"],
    riskSignals: ["缺少时间", "缺少人物地点", "说明过短"],
    nextActions: ["补齐复核项", "保存快照", "回看历史"],
    persistence: "运行历史 + 展品关联",
    warmCue: "像把一张旧票夹进相册：每一步都留下来历。"
  },
  {
    id: "insight-report",
    name: "回忆报告工作流",
    purpose: "展品集合到时间线、主题展和报告",
    entry: "/api/insights",
    nodes: ["时间线", "主题展", "报告"],
    controls: ["范围", "筛选", "引用", "导出"],
    statusLabel: "可预览",
    maturity: "draft",
    pausePoints: ["范围选择", "主题复核", "报告导出"],
    riskSignals: ["缺少时间范围", "主题来源过少", "报告不可保存"],
    nextActions: ["保存报告草稿", "主题展命名", "编辑历史"],
    persistence: "洞察快照 + 导出备份",
    warmCue: "把散落灯光排成一条能回看的路。"
  },
  {
    id: "guided-tour",
    name: "讲解检索工作流",
    purpose: "提问到带引用的讲解回答",
    entry: "/api/guide",
    nodes: ["提问理解", "混合检索", "引用回答"],
    controls: ["提问", "引用", "追问"],
    statusLabel: "可提问",
    maturity: "active",
    pausePoints: ["弱证据", "继续追问"],
    riskSignals: ["召回弱证据", "问题锚点少", "引用不足"],
    nextActions: ["记录问答历史", "收藏引用", "导览路线"],
    persistence: "检索依据 + 可信度",
    warmCue: "讲解员会说明它为什么想起这些展品。"
  }
];
const fieldLimits = {
  title: 80,
  rawContent: 2000,
  exhibitText: 600,
  coverImage: 300,
  mediaNote: 800,
  attachmentName: 80,
  attachmentNote: 180,
  date: 30,
  location: 80,
  listItem: 30,
  listLength: 16
};

const halls = [
  { id: "all", name: "全部展品", description: "查看所有被保存下来的记忆。" },
  { id: "youth", name: "青春展厅", description: "校园、毕业、成长和那些没说完的话。" },
  { id: "friends", name: "朋友展厅", description: "朋友、室友、群聊和共同经历。" },
  { id: "family", name: "家庭展厅", description: "家人、饭桌、节日和被照顾的瞬间。" },
  { id: "low", name: "低谷展厅", description: "挫折、疲惫、失眠和重新站起来。" },
  { id: "strange", name: "奇怪瞬间展厅", description: "荒诞、尴尬、离谱但很难忘。" },
  { id: "daily", name: "日常展厅", description: "普通日子里值得留下的细节。" }
];

const seedMemories = [
  {
    id: createId(),
    title: "操场尽头的告别",
    hall: "youth",
    rawContent: "高三毕业那天晚上，我们几个人在操场坐到很晚，谁也没说以后还会不会见面。",
    exhibitText: "这件展品记录了一次没有正式说出口的告别。夜晚、操场和沉默一起保存了青春快结束时的重量。",
    date: "",
    location: "学校操场",
    people: ["同学", "朋友"],
    tags: ["毕业", "夜晚", "校园"],
    emotions: ["怀念", "遗憾"],
    emotionIntensity: 4,
    sourceType: "日记",
    importance: 4,
    favorite: true,
    createdAt: new Date().toISOString()
  },
  {
    id: createId(),
    title: "洒掉的外卖和没坏掉的一天",
    hall: "daily",
    rawContent: "今天起床晚了，外卖还洒了一半，但晚上散步的时候风很舒服。",
    exhibitText: "这件展品属于普通生活的修复时刻。它提醒参观者，一天可以从混乱开始，也可以被一阵晚风重新整理。",
    date: "",
    location: "宿舍附近",
    people: [],
    tags: ["日常", "晚风", "倒霉"],
    emotions: ["平静"],
    emotionIntensity: 2,
    sourceType: "日记",
    importance: 2,
    favorite: false,
    createdAt: new Date().toISOString()
  }
];

const samplePrompts = [
  "毕业那天晚上，我们在操场绕了一圈又一圈，谁都没有先说再见。",
  "妈妈把剩下的菜装进保鲜盒，非要让我带回去。地铁上我突然觉得那个袋子很重。",
  "群聊里朋友发了一张很糊的合照，大家开始翻旧账，笑到凌晨一点。",
  "昨晚梦到自己在一个没有出口的车站，醒来以后还记得广播声。",
  "今天本来很崩溃，晚上路过一家小店，老板多送了一个茶叶蛋。",
  "旅行回来的车上，窗外一直下雨，我突然不想那么快到站。",
  "拍照的时候所有人都在笑，只有我盯着镜头旁边那盏坏掉的灯。",
  "那天发生了一件特别离谱的事，我在电梯里把外卖递给了完全不认识的人。"
];

let memories = loadMemories();
let activeHall = "all";
let searchKeyword = "";
let sortMode = "newest";
let emotionFilter = "all";
let editingId = null;
let isAnalyzing = false;
let isPersisting = false;
let isGuideAsking = false;
let databaseAvailable = false;
let databaseNeedsMigration = false;
let backendStats = null;
let backendAiConfigured = false;
let latestAgentDraft = null;
let latestAgentWorkflow = null;
let insightScope = "all";
let backendWorkflowBlueprint = null;
let workflowBlueprintSource = "local";
let activeWorkflowTemplateId = "memory-curation";
let localProfile = loadLocalProfile();
let privacyPolicy = null;
let privacyPolicySource = "local";
let versionInfo = null;
let operationsSource = "local";
let assetCollection = null;
let assetSource = "local";
let activeAssetDialog = null;
let assetAuditSearchTerm = "";
let selectedAssetSnapshotId = "";
let pendingSyncImportPlan = null;
let phase16AuditFilter = "all";
let phase18TaskFilter = "active";
let phase18SelectedTaskIds = new Set();
let phase18GraphFilter = "all";
let phase19ImportPreview = null;
let phase19ImportBatches = loadPhase19ImportBatches();
let activePhase19BatchId = "";
let phase19BatchFilter = "all";
let phase19AuditSearch = "";
let phase19CustomTemplates = loadPhase19CustomMappingTemplates();
let activeFeaturePanel = "home";
const featurePanelIds = ["insightsSection", "phase19ImportSection", "workflowOrchestration", "privacySection", "operationsSection", "phase20PlatformSection"];

const $ = (selector) => document.querySelector(selector);
const elements = {
  hallNav: $("#hallNav"),
  hallSelect: $("#hallSelect"),
  memoryForm: $("#memoryForm"),
  rawContent: $("#rawContent"),
  rawCount: $("#rawCount"),
  titleInput: $("#titleInput"),
  memoryDate: $("#memoryDate"),
  locationInput: $("#locationInput"),
  peopleInput: $("#peopleInput"),
  exhibitText: $("#exhibitText"),
  coverImageInput: $("#coverImageInput"),
  mediaNoteInput: $("#mediaNoteInput"),
  attachmentsInput: $("#attachmentsInput"),
  tagsInput: $("#tagsInput"),
  sampleButton: $("#sampleButton"),
  mockAiButton: $("#mockAiButton"),
  aiStatus: $("#aiStatus"),
  useAgentSuggestionButton: $("#useAgentSuggestionButton"),
  clearAgentWorkflowButton: $("#clearAgentWorkflowButton"),
  resetButton: $("#resetButton"),
  cancelEditButton: $("#cancelEditButton"),
  saveButton: $("#saveButton"),
  formModeHint: $("#formModeHint"),
  memoryGrid: $("#memoryGrid"),
  memoryCount: $("#memoryCount"),
  hallCount: $("#hallCount"),
  tagCount: $("#tagCount"),
  emotionCount: $("#emotionCount"),
  mediaCount: $("#mediaCount"),
  agentRunCount: $("#agentRunCount"),
  timelineCount: $("#timelineCount"),
  timelineList: $("#timelineList"),
  themeCount: $("#themeCount"),
  themeList: $("#themeList"),
  reportMeta: $("#reportMeta"),
  reportPanel: $("#reportPanel"),
  assetSummaryMeta: $("#assetSummaryMeta"),
  savedAssetsPanel: $("#savedAssetsPanel"),
  phase18AgentPanel: $("#phase18AgentPanel"),
  phase19ImportSection: $("#phase19ImportSection"),
  phase19ImportFormat: $("#phase19ImportFormat"),
  phase19DefaultSource: $("#phase19DefaultSource"),
  phase19DefaultHall: $("#phase19DefaultHall"),
  phase19CleanupMode: $("#phase19CleanupMode"),
  phase19MappingTemplate: $("#phase19MappingTemplate"),
  phase19TemplateTags: $("#phase19TemplateTags"),
  phase19TemplatePeople: $("#phase19TemplatePeople"),
  phase19TemplateDateRule: $("#phase19TemplateDateRule"),
  phase19TemplateAliases: $("#phase19TemplateAliases"),
  phase19BatchName: $("#phase19BatchName"),
  phase19AuditSearch: $("#phase19AuditSearch"),
  phase19BatchFilter: $("#phase19BatchFilter"),
  phase19ImportText: $("#phase19ImportText"),
  phase19SampleButton: $("#phase19SampleButton"),
  phase19SaveTemplateButton: $("#phase19SaveTemplateButton"),
  phase19PreviewButton: $("#phase19PreviewButton"),
  phase19ApplyButton: $("#phase19ApplyButton"),
  phase19ImportPreview: $("#phase19ImportPreview"),
  insightScopeSelect: $("#insightScopeSelect"),
  insightScopeMeta: $("#insightScopeMeta"),
  workflowOrchestration: $("#workflowOrchestration"),
  workflowSummaryMeta: $("#workflowSummaryMeta"),
  workflowReadinessGrid: $("#workflowReadinessGrid"),
  workflowGapList: $("#workflowGapList"),
  phase12ReadinessPanel: $("#phase12ReadinessPanel"),
  workflowDetailPanel: $("#workflowDetailPanel"),
  workflowTemplateList: $("#workflowTemplateList"),
  workflowCapabilityList: $("#workflowCapabilityList"),
  privacySection: $("#privacySection"),
  profileNameInput: $("#profileNameInput"),
  profileDeviceInput: $("#profileDeviceInput"),
  profileSyncSelect: $("#profileSyncSelect"),
  profileAiConsentInput: $("#profileAiConsentInput"),
  saveProfileButton: $("#saveProfileButton"),
  privacySummary: $("#privacySummary"),
  dataLocationList: $("#dataLocationList"),
  aiScopePanel: $("#aiScopePanel"),
  sensitivityPanel: $("#sensitivityPanel"),
  userControlList: $("#userControlList"),
  exportRedactedButton: $("#exportRedactedButton"),
  purgeDatabaseButton: $("#purgeDatabaseButton"),
  phase16SyncPanel: $("#phase16SyncPanel"),
  phase13ReadinessPanel: $("#phase13ReadinessPanel"),
  operationsSection: $("#operationsSection"),
  operationsSummaryGrid: $("#operationsSummaryGrid"),
  runtimePanel: $("#runtimePanel"),
  deploymentPanel: $("#deploymentPanel"),
  checksPanel: $("#checksPanel"),
  engineeringPanel: $("#engineeringPanel"),
  releaseChecklistPanel: $("#releaseChecklistPanel"),
  runbookPanel: $("#runbookPanel"),
  backupPolicyPanel: $("#backupPolicyPanel"),
  riskPanel: $("#riskPanel"),
  operationEventsPanel: $("#operationEventsPanel"),
  releaseHistoryPanel: $("#releaseHistoryPanel"),
  logArchivePanel: $("#logArchivePanel"),
  demoKitPanel: $("#demoKitPanel"),
  phase14Panel: $("#phase14Panel"),
  moduleBoundaryPanel: $("#moduleBoundaryPanel"),
  phase15Panel: $("#phase15Panel"),
  phase15AssetPanel: $("#phase15AssetPanel"),
  phase20PlatformSection: $("#phase20PlatformSection"),
  phase20SummaryGrid: $("#phase20SummaryGrid"),
  phase20ExtensionPanel: $("#phase20ExtensionPanel"),
  phase20PluginPanel: $("#phase20PluginPanel"),
  phase20RegistryPanel: $("#phase20RegistryPanel"),
  phase20ManifestPanel: $("#phase20ManifestPanel"),
  phase20PermissionPanel: $("#phase20PermissionPanel"),
  phase20AuditPanel: $("#phase20AuditPanel"),
  phase20ContractPanel: $("#phase20ContractPanel"),
  phase20SandboxPanel: $("#phase20SandboxPanel"),
  phase20TemplatePanel: $("#phase20TemplatePanel"),
  phase20FixturePanel: $("#phase20FixturePanel"),
  phase20SignaturePanel: $("#phase20SignaturePanel"),
  phase20InstallPanel: $("#phase20InstallPanel"),
  phase20SecurityPanel: $("#phase20SecurityPanel"),
  phase20MilestonePanel: $("#phase20MilestonePanel"),
  draftPreview: $("#draftPreview"),
  guideCopy: $("#guideCopy"),
  agentWorkflow: $("#agentWorkflow"),
  guideAskForm: $("#guideAskForm"),
  guideQuestionInput: $("#guideQuestionInput"),
  guideAskButton: $("#guideAskButton"),
  searchInput: $("#searchInput"),
  sortSelect: $("#sortSelect"),
  emotionFilterSelect: $("#emotionFilterSelect"),
  clearFiltersButton: $("#clearFiltersButton"),
  storageStatus: $("#storageStatus"),
  syncDatabaseButton: $("#syncDatabaseButton"),
  migrateLocalButton: $("#migrateLocalButton"),
  emotionOptions: $("#emotionOptions"),
  emotionIntensity: $("#emotionIntensity"),
  emotionIntensityOutput: $("#emotionIntensityOutput"),
  sourceType: $("#sourceType"),
  importanceSelect: $("#importanceSelect"),
  favoriteInput: $("#favoriteInput"),
  exportButton: $("#exportButton"),
  importFile: $("#importFile"),
  memoryDialog: $("#memoryDialog"),
  dialogContent: $("#dialogContent"),
  closeDialog: $("#closeDialog")
};

function setActiveFeaturePanel(panelId = "home", scrollTargetId = "", shouldScroll = true) {
  const nextPanel = featurePanelIds.includes(panelId) ? panelId : "home";
  activeFeaturePanel = nextPanel;
  featurePanelIds.forEach((id) => {
    const panel = document.getElementById(id);
    if (!panel) return;
    const isVisible = id === nextPanel;
    panel.classList.toggle("is-visible", isVisible);
    panel.setAttribute("aria-hidden", isVisible ? "false" : "true");
  });
  document.querySelectorAll("[data-feature-target]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.featureTarget === nextPanel);
  });
  const target = document.getElementById(scrollTargetId || (nextPanel === "home" ? "homeGateway" : nextPanel));
  if (shouldScroll && target) target.scrollIntoView({ behavior: "smooth", block: "start" });
}

function scrollHomeTarget(targetId) {
  setActiveFeaturePanel("home", targetId);
}

function createId() {
  return globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `memory-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeId(value) {
  const id = String(value || "").trim();
  return /^[a-zA-Z0-9_-]{8,80}$/.test(id) ? id : createId();
}

function persistMemories(nextMemories) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextMemories));
    return true;
  } catch {
    return false;
  }
}

function loadLocalProfile() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PROFILE_KEY) || "{}");
    return normalizeLocalProfile(parsed);
  } catch {
    return normalizeLocalProfile({});
  }
}

function normalizeLocalProfile(profile = {}) {
  return {
    deviceId: normalizeId(profile.deviceId || `device-${createId()}`),
    displayName: limitText(profile.displayName, 40) || "本地馆主",
    deviceLabel: limitText(profile.deviceLabel, 60) || "这台设备",
    syncPreference: ["manual-json", "local-only"].includes(profile.syncPreference) ? profile.syncPreference : "manual-json",
    aiConsent: profile.aiConsent === true
  };
}

function persistLocalProfile(profile) {
  localProfile = normalizeLocalProfile(profile);
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(localProfile));
    return true;
  } catch {
    return false;
  }
}

function loadPhase16SyncAudit() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PHASE16_SYNC_AUDIT_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.slice(0, 30) : [];
  } catch {
    return [];
  }
}

function recordPhase16SyncAuditEvent(event = {}) {
  const entry = {
    id: createId(),
    at: new Date().toISOString(),
    phase: 16,
    deviceId: localProfile.deviceId,
    deviceLabel: localProfile.deviceLabel,
    action: event.action || "sync",
    label: limitText(event.label, 80) || "同步事件",
    detail: limitText(event.detail, 180),
    batchId: limitText(event.batchId, 120),
    summary: event.summary || null
  };
  try {
    const current = loadPhase16SyncAudit();
    localStorage.setItem(PHASE16_SYNC_AUDIT_KEY, JSON.stringify([entry, ...current].slice(0, 30)));
  } catch {
    return entry;
  }
  return entry;
}

function filterPhase16SyncAudit(entries = loadPhase16SyncAudit()) {
  if (phase16AuditFilter === "all") return entries;
  const groups = {
    export: ["export"],
    preview: ["preview"],
    drill: ["drill-export"],
    apply: ["apply", "apply-empty"],
    cancel: ["cancel-preview"]
  };
  const actions = groups[phase16AuditFilter] || [];
  return entries.filter((entry) => actions.includes(entry.action));
}

function loadPhase17DeviceRegistry() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PHASE17_DEVICE_REGISTRY_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function savePhase17DeviceRegistry(devices = []) {
  try {
    localStorage.setItem(PHASE17_DEVICE_REGISTRY_KEY, JSON.stringify(devices.slice(0, 12)));
  } catch {
    return false;
  }
  return true;
}

function normalizePhase17Device(device = {}) {
  const trust = ["trusted", "review", "blocked"].includes(device.status) ? device.status : "review";
  return {
    id: limitText(device.id || createId(), 80),
    label: limitText(device.label || "未命名设备", 80),
    owner: limitText(device.owner || localProfile.displayName || "本地馆主", 80),
    role: limitText(device.role || "device", 40),
    status: trust,
    trustLevel: trust === "trusted" ? "可信" : trust === "blocked" ? "已阻止" : "待复核",
    note: limitText(device.note || "", 120),
    firstSeenAt: device.firstSeenAt || new Date().toISOString(),
    lastSeenAt: device.lastSeenAt || device.firstSeenAt || new Date().toISOString(),
    syncMode: ["manual-json", "local-only"].includes(device.syncMode) ? device.syncMode : "manual-json"
  };
}

function registerPhase17CurrentDevice() {
  const now = new Date().toISOString();
  const current = normalizePhase17Device({
    id: localProfile.deviceId,
    label: localProfile.deviceLabel,
    owner: localProfile.displayName,
    role: "primary-local",
    status: "trusted",
    firstSeenAt: now,
    lastSeenAt: now,
    syncMode: localProfile.syncPreference || "manual-json"
  });
  const devices = loadPhase17DeviceRegistry().map(normalizePhase17Device);
  const existing = devices.find((device) => device.id === current.id);
  const next = existing
    ? devices.map((device) => device.id === current.id ? { ...device, ...current, firstSeenAt: device.firstSeenAt || now } : device)
    : [current, ...devices];
  savePhase17DeviceRegistry(next);
  return next;
}

function addPhase17ReviewDevice() {
  const now = new Date().toISOString();
  const devices = registerPhase17CurrentDevice().map(normalizePhase17Device);
  const reviewCount = devices.filter((device) => device.status === "review").length + 1;
  const device = normalizePhase17Device({
    id: `review-device-${simpleChecksum(`${now}:${reviewCount}`).slice(0, 8)}`,
    label: `待复核设备 ${reviewCount}`,
    owner: localProfile.displayName,
    role: "peer-candidate",
    status: "review",
    note: "手动登记的跨设备同步候选，进入真实交换前需要确认来源。",
    firstSeenAt: now,
    lastSeenAt: now,
    syncMode: "manual-json"
  });
  savePhase17DeviceRegistry([device, ...devices].slice(0, 12));
  return device;
}

function updatePhase17DeviceTrust(id, nextStatus) {
  if (!["trusted", "review", "blocked"].includes(nextStatus)) return false;
  const devices = registerPhase17CurrentDevice().map(normalizePhase17Device);
  let changed = false;
  const next = devices.map((device) => {
    if (device.id !== id || device.id === localProfile.deviceId) return device;
    changed = true;
    return {
      ...device,
      status: nextStatus,
      trustLevel: nextStatus === "trusted" ? "可信" : nextStatus === "blocked" ? "已阻止" : "待复核",
      lastSeenAt: new Date().toISOString()
    };
  });
  if (changed) savePhase17DeviceRegistry(next);
  return changed;
}

function buildPhase17DeviceTrustPolicy(devices = []) {
  const normalized = devices.map(normalizePhase17Device);
  return {
    mode: "explicit-trust-required",
    trusted: normalized.filter((device) => device.status === "trusted").length,
    review: normalized.filter((device) => device.status === "review").length,
    blocked: normalized.filter((device) => device.status === "blocked").length,
    rules: [
      "本机设备自动可信，但不能代表其他设备。",
      "历史候选设备默认进入待复核，不参与自动导入。",
      "已阻止设备不会出现在局域网握手候选里。",
      "任何跨设备写入仍需第十六阶段风险确认。"
    ]
  };
}

function loadPhase17SyncQueue() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PHASE17_SYNC_QUEUE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function savePhase17SyncQueue(queue = []) {
  try {
    localStorage.setItem(PHASE17_SYNC_QUEUE_KEY, JSON.stringify(queue.slice(0, 40)));
  } catch {
    return false;
  }
  return true;
}

function normalizePhase17QueueTask(task = {}) {
  const now = new Date().toISOString();
  const allowedStatuses = ["queued", "reviewing", "ready", "exported", "imported", "failed", "resolved", "cancelled"];
  const allowedChannels = ["manual-json", "lan-bridge", "private-cloud"];
  const status = allowedStatuses.includes(task.status) ? task.status : "queued";
  const channel = allowedChannels.includes(task.channel) ? task.channel : "manual-json";
  return {
    id: task.id || createId(),
    phase: 17,
    status,
    channel,
    action: limitText(task.action || "sync-preview", 60),
    label: limitText(task.label, 80) || "同步任务",
    detail: limitText(task.detail, 180),
    risk: ["low", "review", "blocked"].includes(task.risk) ? task.risk : (channel === "manual-json" ? "low" : "review"),
    batchId: limitText(task.batchId || "", 80),
    deviceId: task.deviceId || localProfile.deviceId,
    deviceLabel: task.deviceLabel || localProfile.deviceLabel,
    createdAt: task.createdAt || now,
    updatedAt: task.updatedAt || task.createdAt || now
  };
}

function enqueuePhase17SyncTask(task = {}) {
  const entry = normalizePhase17QueueTask(task);
  const queue = [entry, ...loadPhase17SyncQueue().map(normalizePhase17QueueTask)].slice(0, 40);
  savePhase17SyncQueue(queue);
  return entry;
}

function updatePhase17QueueTaskStatus(id, nextStatus) {
  const allowedStatuses = ["reviewing", "ready", "exported", "imported", "failed", "resolved", "cancelled"];
  if (!allowedStatuses.includes(nextStatus)) return false;
  const queue = loadPhase17SyncQueue().map(normalizePhase17QueueTask);
  const next = queue.map((item) => item.id === id ? { ...item, status: nextStatus, updatedAt: new Date().toISOString() } : item);
  savePhase17SyncQueue(next);
  return next.some((item) => item.id === id);
}

function buildPhase17QueueMetrics(queue = loadPhase17SyncQueue()) {
  const normalized = queue.map(normalizePhase17QueueTask);
  const byStatus = normalized.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {});
  const byChannel = normalized.reduce((acc, item) => {
    acc[item.channel] = (acc[item.channel] || 0) + 1;
    return acc;
  }, {});
  return {
    total: normalized.length,
    pending: normalized.filter((item) => ["queued", "reviewing", "ready"].includes(item.status)).length,
    failures: byStatus.failed || 0,
    resolved: (byStatus.resolved || 0) + (byStatus.imported || 0),
    byStatus,
    byChannel,
    recent: normalized.slice(0, 8)
  };
}

function getPhase17QueueStatusLabel(status = "queued") {
  const labels = {
    queued: "等待处理",
    reviewing: "复核中",
    ready: "可同步",
    exported: "已导出",
    imported: "已导入",
    failed: "失败",
    resolved: "已完成",
    cancelled: "已取消"
  };
  return labels[status] || status;
}

function getPhase17QueueNextActions(status = "queued") {
  if (status === "queued") {
    return [
      { status: "reviewing", label: "复核" },
      { status: "failed", label: "标记失败" }
    ];
  }
  if (status === "reviewing") {
    return [
      { status: "ready", label: "通过" },
      { status: "cancelled", label: "取消" }
    ];
  }
  if (status === "ready") {
    return [
      { status: "exported", label: "已导出" },
      { status: "failed", label: "失败" }
    ];
  }
  if (status === "exported" || status === "imported" || status === "failed") {
    return [{ status: "resolved", label: "完成" }];
  }
  return [];
}

function buildPhase17LanHandshake(devices = []) {
  const localFingerprint = simpleChecksum(`${localProfile.deviceId}:${localProfile.deviceLabel}:${localProfile.displayName}`).slice(0, 12);
  const peerCandidates = devices.filter((device) => device.id !== localProfile.deviceId && device.status !== "blocked").slice(0, 3);
  return {
    channel: "lan-bridge",
    status: peerCandidates.length ? "review" : "standby",
    mode: "read-only-handshake-simulation",
    localEndpoint: "browser-localhost",
    localFingerprint,
    peerCandidates: peerCandidates.map((device) => ({
      id: device.id,
      label: device.label,
      status: device.status,
      fingerprint: simpleChecksum(`${device.id}:${device.label}`).slice(0, 12)
    })),
    checks: [
      { id: "same-network", label: "同网段发现", status: "simulated", detail: "当前只展示握手模型，不扫描局域网。" },
      { id: "data-transfer", label: "私人数据传输", status: "blocked", detail: "第二版不传输展品正文、附件或专题资产。" },
      { id: "manual-review", label: "人工确认", status: "required", detail: "进入真实交换前必须回到第十六阶段风险确认。" }
    ]
  };
}

function loadPhase17PrivateCloudBoundary() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PHASE17_PRIVATE_CLOUD_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function savePhase17PrivateCloudBoundary(config = {}) {
  try {
    localStorage.setItem(PHASE17_PRIVATE_CLOUD_KEY, JSON.stringify(config));
  } catch {
    return false;
  }
  return true;
}

function createPhase17PrivateCloudDraft() {
  const draft = {
    provider: "webdav-or-s3",
    endpoint: "not-configured",
    enabled: false,
    credentialStored: false,
    createdAt: new Date().toISOString(),
    note: "第五版只保存适配边界草案，不保存密钥，不连接云端。"
  };
  savePhase17PrivateCloudBoundary(draft);
  return draft;
}

function clearPhase17PrivateCloudDraft() {
  savePhase17PrivateCloudBoundary({});
}

function buildPhase17PrivateCloudBoundary() {
  const draft = loadPhase17PrivateCloudBoundary();
  const hasDraft = Boolean(draft.provider);
  return {
    channel: "private-cloud",
    status: hasDraft ? "draft" : "not-configured",
    provider: draft.provider || "none",
    endpoint: draft.endpoint || "not-configured",
    enabled: false,
    credentialStored: false,
    policy: "configuration-boundary-only",
    checks: [
      { id: "auto-upload", label: "自动上传", status: "blocked", detail: "第五版不允许任何自动上传。" },
      { id: "credential", label: "凭据保存", status: "blocked", detail: "本地不保存 WebDAV/S3/API 密钥。" },
      { id: "manual-export", label: "手动导出", status: "required", detail: "需要先生成第十六阶段同步包并人工确认。" },
      { id: "redaction", label: "脱敏边界", status: "recommended", detail: "外部通道优先使用脱敏导出包。" }
    ],
    updatedAt: draft.createdAt || null
  };
}

function buildPhase17SyncHealth({ devices = [], queueMetrics = {}, lanHandshake = {}, deviceTrustPolicy = {}, privateCloudBoundary = {} } = {}) {
  const failedTasks = queueMetrics.failures || 0;
  const reviewDevices = deviceTrustPolicy.review || 0;
  const blockedDevices = deviceTrustPolicy.blocked || 0;
  const pendingTasks = queueMetrics.pending || 0;
  const checks = [
    { id: "phase16-risk-gate", label: "第十六阶段风险门禁", status: "ready", detail: "冲突决策、恢复演练和导入前确认继续保留。" },
    { id: "device-trust", label: "设备信任", status: reviewDevices ? "review" : "ready", detail: reviewDevices ? `${reviewDevices} 台设备仍需复核。` : "暂无待复核设备。" },
    { id: "blocked-device", label: "阻止设备", status: blockedDevices ? "review" : "ready", detail: blockedDevices ? `${blockedDevices} 台设备已阻止，不参与握手。` : "暂无已阻止设备。" },
    { id: "queue-failures", label: "失败任务", status: failedTasks ? "review" : "ready", detail: failedTasks ? `${failedTasks} 个任务需要处理。` : "暂无失败任务。" },
    { id: "queue-pending", label: "待处理任务", status: pendingTasks > 8 ? "review" : "ready", detail: pendingTasks ? `${pendingTasks} 个任务等待推进。` : "队列当前清爽。" },
    { id: "lan-handshake", label: "局域网握手", status: lanHandshake.status === "review" ? "review" : "ready", detail: "只读握手模拟已具备，不传输私人数据。" },
    { id: "private-cloud-boundary", label: "私有云边界", status: privateCloudBoundary.status === "draft" ? "review" : "ready", detail: privateCloudBoundary.status === "draft" ? "已有草案，仍保持关闭。" : "未配置外部通道。" }
  ];
  const reviewCount = checks.filter((item) => item.status === "review").length;
  const readyCount = checks.filter((item) => item.status === "ready").length;
  const score = Math.round((readyCount / checks.length) * 100);
  return {
    status: reviewCount ? "review" : "ready",
    score,
    deviceCount: devices.length,
    pendingTasks,
    failedTasks,
    checks,
    recommendation: reviewCount
      ? "继续留在第十七阶段处理设备复核、队列失败和外部通道边界。"
      : "第十七阶段同步适配层已具备进入第十八阶段评估的基础。"
  };
}

function buildPhase17HealthExplanation(syncHealth = {}) {
  const checks = Array.isArray(syncHealth.checks) ? syncHealth.checks : [];
  const reviewChecks = checks.filter((item) => item.status === "review");
  return {
    score: syncHealth.score || 0,
    reviewCount: reviewChecks.length,
    reasons: reviewChecks.map((item) => ({
      id: item.id,
      label: item.label,
      impact: item.id === "queue-failures" ? "优先处理失败任务，避免下一次手动同步重复出错。"
        : item.id === "device-trust" ? "确认设备来源后再交换同步包。"
          : item.id === "private-cloud-boundary" ? "外部通道仍保持关闭，先使用手动同步包。"
            : item.detail
    })),
    summary: reviewChecks.length
      ? `健康度有 ${reviewChecks.length} 项需要复核。`
      : "同步健康度稳定，可以继续作为第十八阶段长期助理的同步底座。"
  };
}

function buildPhase17FailureRecovery(queue = loadPhase17SyncQueue()) {
  const failed = queue.map(normalizePhase17QueueTask).filter((item) => item.status === "failed");
  return {
    failedCount: failed.length,
    actions: failed.slice(0, 5).map((item) => ({
      id: item.id,
      label: item.label,
      action: item.channel === "private-cloud" ? "保持外部通道关闭，改用手动 JSON 同步包重试。"
        : item.channel === "lan-bridge" ? "重新生成只读握手，确认设备后再导出同步包。"
          : "重新导出第十六阶段同步包，并重新做导入前风险确认。",
      risk: item.risk
    })),
    recommendation: failed.length
      ? "先逐条完成或取消失败任务，再继续添加新的同步任务。"
      : "暂无失败任务；可保留当前同步节奏。"
  };
}

function buildPhase17Phase18SyncAdvisory() {
  const collection = getAssetCollection();
  const exhibitions = Array.isArray(collection.savedExhibitions) ? collection.savedExhibitions : [];
  const reports = Array.isArray(collection.reportDrafts) ? collection.reportDrafts : [];
  const phase18Tasks = loadPhase18TaskQueue();
  const repairDrafts = loadPhase18RepairDrafts();
  const assetCount = exhibitions.length + reports.length;
  const previewDrafts = repairDrafts.filter((item) => item.status === "preview").length;
  return {
    assetCount,
    exhibitions: exhibitions.length,
    reports: reports.length,
    activePhase18Tasks: phase18Tasks.filter((item) => ["queued", "reviewing", "failed"].includes(item.status)).length,
    previewDrafts,
    readiness: previewDrafts ? "review" : assetCount ? "asset-ready" : "waiting",
    recommendation: previewDrafts
      ? "仍有第十八阶段修复草案未应用，建议先复核后再同步资产。"
      : assetCount
        ? "专题展和报告草稿可进入第十六阶段同步包预览，但仍不静默合并。"
        : "第十八阶段还没有可同步的专题资产或报告草稿。"
  };
}

function buildPhase18AssetSyncState(collection = getAssetCollection()) {
  const exhibitions = Array.isArray(collection.savedExhibitions) ? collection.savedExhibitions : [];
  const reports = Array.isArray(collection.reportDrafts) ? collection.reportDrafts : [];
  const phase18Tasks = loadPhase18TaskQueue();
  const repairDrafts = loadPhase18RepairDrafts();
  const previewDrafts = repairDrafts.filter((item) => item.status === "preview").length;
  const activeTasks = phase18Tasks.filter((item) => ["queued", "reviewing", "failed"].includes(item.status)).length;
  const buildItem = (type, item) => {
    const issues = getAssetIssueList(type, item);
    const linkCount = type === "exhibition"
      ? (Array.isArray(item.memoryIds) ? item.memoryIds.length : 0)
      : (Array.isArray(item.references) ? item.references.length : 0);
    const status = item.status || "draft";
    const syncStatus = issues.length ? "risk" : status === "published" ? "ready" : status === "archived" ? "archived" : "review";
    return {
      id: item.id,
      type,
      title: item.title || (type === "exhibition" ? "未命名专题展" : "未命名报告草稿"),
      status,
      syncStatus,
      linkCount,
      issueCount: issues.length,
      includedInManualPackage: ["ready", "review"].includes(syncStatus),
      recommendation: issues.length
        ? "先修复资产字段和引用问题，再加入手动同步包。"
        : status === "published"
          ? "适合加入第十六阶段手动同步包，并交由第十七阶段设备复核。"
          : "可加入同步包预览，但建议先复核发布状态。"
    };
  };
  const items = [
    ...exhibitions.map((item) => buildItem("exhibition", item)),
    ...reports.map((item) => buildItem("report", item))
  ];
  const ready = items.filter((item) => item.syncStatus === "ready").length;
  const review = items.filter((item) => item.syncStatus === "review").length;
  const risk = items.filter((item) => item.syncStatus === "risk").length;
  const packageCandidates = items.filter((item) => item.includedInManualPackage).length;
  return {
    phase: 18,
    mode: "phase17-manual-sync-link",
    total: items.length,
    exhibitions: exhibitions.length,
    reports: reports.length,
    ready,
    review,
    risk,
    packageCandidates,
    activePhase18Tasks: activeTasks,
    previewDrafts,
    items: items.slice(0, 8),
    readiness: previewDrafts || risk ? "review" : items.length ? "asset-ready" : "waiting",
    recommendation: previewDrafts
      ? "仍有第十八阶段修复草案未应用，建议先复核后再同步资产。"
      : risk
        ? "部分资产存在字段或引用风险，建议先修复再加入同步包。"
        : items.length
          ? "专题展和报告草稿可进入第十六阶段同步包预览，并由第十七阶段设备复核。"
          : "第十八阶段还没有可同步的专题资产或报告草稿。"
  };
}

function buildPhase17Phase18SyncAdvisory() {
  const assetSyncState = buildPhase18AssetSyncState();
  return {
    assetCount: assetSyncState.total,
    exhibitions: assetSyncState.exhibitions,
    reports: assetSyncState.reports,
    activePhase18Tasks: assetSyncState.activePhase18Tasks,
    previewDrafts: assetSyncState.previewDrafts,
    readiness: assetSyncState.readiness,
    packageCandidates: assetSyncState.packageCandidates,
    riskAssets: assetSyncState.risk,
    readyAssets: assetSyncState.ready,
    assetSyncState,
    recommendation: assetSyncState.recommendation
  };
}

function loadPhase18AgentFeedback() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PHASE18_AGENT_FEEDBACK_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.slice(0, 40) : [];
  } catch {
    return [];
  }
}

function savePhase18AgentFeedback(entries = []) {
  try {
    localStorage.setItem(PHASE18_AGENT_FEEDBACK_KEY, JSON.stringify(entries.slice(0, 40)));
  } catch {
    return false;
  }
  return true;
}

function recordPhase18AgentFeedback(action, targetId, label = "") {
  const entry = {
    id: createId(),
    phase: 18,
    action: ["accepted", "dismissed"].includes(action) ? action : "accepted",
    targetId: limitText(targetId, 100),
    label: limitText(label, 120),
    at: new Date().toISOString()
  };
  savePhase18AgentFeedback([entry, ...loadPhase18AgentFeedback()]);
  return entry;
}

function loadPhase18TaskAudit() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PHASE18_TASK_AUDIT_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.slice(0, 120) : [];
  } catch {
    return [];
  }
}

function savePhase18TaskAudit(entries = []) {
  try {
    localStorage.setItem(PHASE18_TASK_AUDIT_KEY, JSON.stringify(entries.slice(0, 120)));
  } catch {
    return false;
  }
  return true;
}

function recordPhase18TaskAudit(action, targetId, detail = "", meta = {}) {
  const entry = {
    id: createId(),
    phase: 18,
    action: limitText(action, 80),
    targetId: limitText(targetId, 120),
    detail: limitText(detail, 220),
    meta,
    at: new Date().toISOString()
  };
  savePhase18TaskAudit([entry, ...loadPhase18TaskAudit()]);
  return entry;
}

function loadPhase18RepairDrafts() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PHASE18_REPAIR_DRAFT_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.slice(0, 80) : [];
  } catch {
    return [];
  }
}

function savePhase18RepairDrafts(drafts = []) {
  try {
    localStorage.setItem(PHASE18_REPAIR_DRAFT_KEY, JSON.stringify(drafts.slice(0, 80)));
  } catch {
    return false;
  }
  return true;
}

function buildPhase18RepairDraftsForSuggestion(suggestionId) {
  const targets = getPhase18SuggestionTargets(suggestionId);
  const now = new Date().toISOString();
  return targets.map((memory) => {
    const patch = buildPhase18RepairPatch(suggestionId, memory);
    return {
      id: `repair-${suggestionId}-${memory.id}`,
      phase: 18,
      suggestionId,
      memoryId: memory.id,
      memoryTitle: memory.title,
      status: "preview",
      patch,
      reason: getPhase18RepairReason(suggestionId),
      createdAt: now,
      updatedAt: now
    };
  }).filter((draft) => Object.keys(draft.patch).length > 0);
}

function getPhase18SuggestionTargets(suggestionId) {
  const normalized = memories.map(normalizeMemory);
  if (suggestionId === "missing-date") return normalized.filter((memory) => !memory.date);
  if (suggestionId === "missing-people") return normalized.filter((memory) => !memory.people?.length);
  if (suggestionId === "missing-location") return normalized.filter((memory) => !memory.location);
  if (suggestionId === "missing-tags") return normalized.filter((memory) => !memory.tags?.length);
  if (suggestionId === "high-value-media") {
    return normalized.filter((memory) => (memory.favorite || memory.importance >= 4) && !memory.coverImage && !memory.mediaNote && !normalizeAttachments(memory.attachments).length);
  }
  return [];
}

function buildPhase18RepairPatch(suggestionId, memory) {
  if (suggestionId === "missing-date") {
    const fallbackDate = String(memory.createdAt || new Date().toISOString()).slice(0, 10);
    return fallbackDate ? { date: fallbackDate } : {};
  }
  if (suggestionId === "missing-people") return { people: ["待确认人物"] };
  if (suggestionId === "missing-location") return { location: "待确认地点" };
  if (suggestionId === "missing-tags") {
    const baseTag = memory.hall ? getHallName(memory.hall).replace("展厅", "") : "待整理";
    return { tags: Array.from(new Set([...(memory.tags || []), baseTag, "待复核"].filter(Boolean))).slice(0, fieldLimits.listLength) };
  }
  if (suggestionId === "high-value-media") return { mediaNote: "待补充图片、OCR、语音或附件线索。" };
  return {};
}

function getPhase18RepairReason(suggestionId) {
  const reasons = {
    "missing-date": "使用创建时间作为时间线草案，应用后仍建议人工复核。",
    "missing-people": "补入占位人物，提醒后续人工替换为真实人物。",
    "missing-location": "补入占位地点，提醒后续人工替换为真实地点。",
    "missing-tags": "根据展厅补充轻量标签，并标记待复核。",
    "high-value-media": "为重点展品添加多模态补充提示，不生成虚假附件。"
  };
  return reasons[suggestionId] || "长期助理生成的修复草案，需要人工确认。";
}

function queuePhase18RepairDrafts(suggestionId) {
  const drafts = buildPhase18RepairDraftsForSuggestion(suggestionId);
  if (!drafts.length) return [];
  const existing = loadPhase18RepairDrafts();
  const existingIds = new Set(existing.map((item) => item.id));
  const next = [...drafts.filter((draft) => !existingIds.has(draft.id)), ...existing];
  savePhase18RepairDrafts(next);
  recordPhase18TaskAudit("repair-drafts-generated", suggestionId, `生成 ${drafts.length} 条修复草案。`, {
    draftCount: drafts.length,
    fields: Array.from(new Set(drafts.flatMap((draft) => Object.keys(draft.patch || {}))))
  });
  return drafts;
}

function applyPhase18RepairDraft(draftId, options = {}) {
  const drafts = loadPhase18RepairDrafts();
  const draft = drafts.find((item) => item.id === draftId);
  if (!draft || draft.status === "applied") return false;
  const index = memories.findIndex((memory) => memory.id === draft.memoryId);
  if (index < 0) return false;
  const nextMemory = normalizeMemory({
    ...memories[index],
    ...draft.patch,
    updatedAt: new Date().toISOString()
  });
  memories = memories.map((memory) => memory.id === nextMemory.id ? nextMemory : memory);
  saveMemories(memories);
  savePhase18RepairDrafts(drafts.map((item) => item.id === draftId ? { ...item, status: "applied", updatedAt: new Date().toISOString() } : item));
  if (!options.skipAudit) {
    recordPhase18TaskAudit("repair-draft-applied", draftId, `应用到《${draft.memoryTitle || draft.memoryId}》。`, {
      memoryId: draft.memoryId,
      fields: Object.keys(draft.patch || {})
    });
  }
  return true;
}

function clearPhase18RepairDrafts() {
  const total = loadPhase18RepairDrafts().length;
  savePhase18RepairDrafts([]);
  recordPhase18TaskAudit("repair-drafts-cleared", "all", `清空 ${total} 条修复草案。`, { total });
}

function buildPhase18RepairBatchReview(drafts = loadPhase18RepairDrafts()) {
  const previewDrafts = drafts.filter((draft) => draft.status === "preview");
  const fields = countValues(previewDrafts.flatMap((draft) => Object.keys(draft.patch || {})));
  return {
    ready: previewDrafts.length > 0,
    previewCount: previewDrafts.length,
    targetCount: new Set(previewDrafts.map((draft) => draft.memoryId)).size,
    fields: toTopEntries(fields, 8),
    highRiskCount: previewDrafts.filter((draft) => Object.values(draft.patch || {}).some((value) => String(Array.isArray(value) ? value.join(" ") : value).includes("待确认"))).length,
    recent: previewDrafts.slice(0, 5).map((draft) => ({
      id: draft.id,
      memoryTitle: draft.memoryTitle || draft.memoryId,
      fields: Object.keys(draft.patch || {}),
      reason: draft.reason || ""
    })),
    policy: "逐条预览，批量应用前需要浏览器确认；所有变更写入本地审计记录。"
  };
}

function applyPhase18RepairDraftBatch() {
  const drafts = loadPhase18RepairDrafts().filter((draft) => draft.status === "preview");
  let applied = 0;
  drafts.forEach((draft) => {
    if (applyPhase18RepairDraft(draft.id, { skipAudit: true })) applied += 1;
  });
  recordPhase18TaskAudit("repair-drafts-batch-applied", "preview-drafts", `批量应用 ${applied} / ${drafts.length} 条修复草案。`, {
    requested: drafts.length,
    applied,
    fields: Array.from(new Set(drafts.flatMap((draft) => Object.keys(draft.patch || {}))))
  });
  return applied;
}

function loadPhase18TaskQueue() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PHASE18_TASK_QUEUE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.map(normalizePhase18Task).slice(0, 80) : [];
  } catch {
    return [];
  }
}

function savePhase18TaskQueue(tasks = []) {
  try {
    localStorage.setItem(PHASE18_TASK_QUEUE_KEY, JSON.stringify(tasks.map(normalizePhase18Task).slice(0, 80)));
  } catch {
    return false;
  }
  return true;
}

function normalizePhase18Task(task = {}) {
  const now = new Date().toISOString();
  const statuses = ["queued", "reviewing", "applied", "dismissed", "failed"];
  const status = statuses.includes(task.status) ? task.status : "queued";
  return {
    id: limitText(task.id || createId(), 120),
    phase: 18,
    status,
    label: limitText(task.label || "长期助理任务", 120),
    source: limitText(task.source || "suggestion", 60),
    priority: ["high", "medium", "low"].includes(task.priority) ? task.priority : "medium",
    memoryIds: Array.isArray(task.memoryIds) ? task.memoryIds.slice(0, 12).map((id) => limitText(id, 100)) : [],
    detail: limitText(task.detail || "", 180),
    createdAt: task.createdAt || now,
    updatedAt: task.updatedAt || task.createdAt || now
  };
}

function syncPhase18TaskQueue(suggestions = []) {
  const existing = loadPhase18TaskQueue();
  const existingIds = new Set(existing.map((task) => task.id));
  const generated = suggestions.slice(0, 12).map((item) => normalizePhase18Task({
    id: `phase18-task-${item.id}`,
    status: item.priority === "high" ? "reviewing" : "queued",
    label: item.title,
    source: item.type,
    priority: item.priority,
    memoryIds: item.memoryIds || [],
    detail: item.detail
  })).filter((task) => !existingIds.has(task.id));
  const next = [...generated, ...existing].slice(0, 80);
  if (generated.length) savePhase18TaskQueue(next);
  return next;
}

function updatePhase18TaskStatus(taskId, nextStatus) {
  if (!["queued", "reviewing", "applied", "dismissed", "failed"].includes(nextStatus)) return false;
  const tasks = loadPhase18TaskQueue();
  let changed = false;
  let previousStatus = "";
  let targetLabel = "";
  const next = tasks.map((task) => {
    if (task.id !== taskId) return task;
    changed = true;
    previousStatus = task.status;
    targetLabel = task.label;
    return { ...task, status: nextStatus, updatedAt: new Date().toISOString() };
  });
  if (changed) {
    savePhase18TaskQueue(next);
    recordPhase18TaskAudit("task-status-changed", taskId, `${targetLabel}：${getPhase18TaskStatusLabel(previousStatus)} -> ${getPhase18TaskStatusLabel(nextStatus)}`, {
      from: previousStatus,
      to: nextStatus
    });
  }
  return changed;
}

function clearResolvedPhase18Tasks() {
  const tasks = loadPhase18TaskQueue();
  const next = tasks.filter((task) => !["applied", "dismissed"].includes(task.status));
  savePhase18TaskQueue(next);
  recordPhase18TaskAudit("resolved-tasks-cleared", "task-queue", `清理 ${tasks.length - next.length} 条已完成或已忽略任务。`, {
    cleared: tasks.length - next.length
  });
}

function prunePhase18TaskSelection(tasks = loadPhase18TaskQueue()) {
  const validIds = new Set(tasks.map((task) => task.id));
  phase18SelectedTaskIds = new Set(Array.from(phase18SelectedTaskIds).filter((id) => validIds.has(id)));
  return phase18SelectedTaskIds;
}

function togglePhase18TaskSelection(taskId, selected) {
  if (!taskId) return phase18SelectedTaskIds;
  if (selected) {
    phase18SelectedTaskIds.add(taskId);
  } else {
    phase18SelectedTaskIds.delete(taskId);
  }
  return phase18SelectedTaskIds;
}

function selectVisiblePhase18Tasks(tasks = loadPhase18TaskQueue()) {
  filterPhase18Tasks(tasks).slice(0, 10).forEach((task) => phase18SelectedTaskIds.add(task.id));
  return phase18SelectedTaskIds;
}

function clearPhase18TaskSelection() {
  phase18SelectedTaskIds = new Set();
  return phase18SelectedTaskIds;
}

function getPhase18SuggestionIdFromTask(task = {}) {
  const id = String(task.id || "");
  if (id.startsWith("phase18-task-")) return id.replace(/^phase18-task-/, "");
  return "";
}

function buildPhase18TaskBatchReview(tasks = loadPhase18TaskQueue(), selectedIds = Array.from(phase18SelectedTaskIds)) {
  const selectedSet = new Set(selectedIds);
  const selected = tasks.map(normalizePhase18Task).filter((task) => selectedSet.has(task.id));
  const statusCounts = selected.reduce((acc, task) => {
    acc[task.status] = (acc[task.status] || 0) + 1;
    return acc;
  }, {});
  const sources = Array.from(new Set(selected.map((task) => task.source).filter(Boolean)));
  const memoryIds = Array.from(new Set(selected.flatMap((task) => task.memoryIds || [])));
  const suggestionIds = Array.from(new Set(selected.map(getPhase18SuggestionIdFromTask).filter(Boolean)));
  const draftableSuggestions = suggestionIds.filter((id) => buildPhase18RepairDraftsForSuggestion(id).length);
  return {
    selectedCount: selected.length,
    activeCount: selected.filter((task) => ["queued", "reviewing", "failed"].includes(task.status)).length,
    memoryCount: memoryIds.length,
    sources,
    statusCounts,
    draftableSuggestions,
    draftableCount: draftableSuggestions.length,
    canBatch: selected.length > 0,
    recommendation: selected.length
      ? `已选择 ${selected.length} 条任务，可批量流转状态或生成 ${draftableSuggestions.length} 组修复草案。`
      : "先选择任务，再进行批量复核、完成、忽略、失败或生成修复草案。"
  };
}

function updatePhase18SelectedTasksStatus(nextStatus) {
  if (!["queued", "reviewing", "applied", "dismissed", "failed"].includes(nextStatus)) return { changed: 0 };
  const tasks = loadPhase18TaskQueue();
  prunePhase18TaskSelection(tasks);
  const selected = new Set(phase18SelectedTaskIds);
  let changed = 0;
  const statusBefore = {};
  const next = tasks.map((task) => {
    if (!selected.has(task.id) || task.status === nextStatus) return task;
    changed += 1;
    statusBefore[task.status] = (statusBefore[task.status] || 0) + 1;
    return { ...task, status: nextStatus, updatedAt: new Date().toISOString() };
  });
  if (changed) {
    savePhase18TaskQueue(next);
    recordPhase18TaskAudit("task-batch-status-changed", "selected-tasks", `批量更新 ${changed} 条长期任务为 ${getPhase18TaskStatusLabel(nextStatus)}。`, {
      changed,
      to: nextStatus,
      from: statusBefore,
      selected: Array.from(selected).slice(0, 20)
    });
  }
  clearPhase18TaskSelection();
  return { changed, status: nextStatus };
}

function queuePhase18RepairDraftsForSelectedTasks() {
  const tasks = loadPhase18TaskQueue();
  prunePhase18TaskSelection(tasks);
  const selected = tasks.filter((task) => phase18SelectedTaskIds.has(task.id));
  const suggestionIds = Array.from(new Set(selected.map(getPhase18SuggestionIdFromTask).filter(Boolean)));
  const drafts = suggestionIds.flatMap((id) => buildPhase18RepairDraftsForSuggestion(id));
  if (!drafts.length) return { generated: 0, suggestionCount: suggestionIds.length };
  const existing = loadPhase18RepairDrafts();
  const existingIds = new Set(existing.map((item) => item.id));
  const fresh = drafts.filter((draft) => !existingIds.has(draft.id));
  savePhase18RepairDrafts([...fresh, ...existing]);
  recordPhase18TaskAudit("task-batch-repair-drafts-generated", "selected-tasks", `从 ${selected.length} 条任务批量生成 ${fresh.length} 条修复草案。`, {
    selectedTasks: selected.length,
    suggestionCount: suggestionIds.length,
    generated: fresh.length,
    fields: Array.from(new Set(fresh.flatMap((draft) => Object.keys(draft.patch || {}))))
  });
  clearPhase18TaskSelection();
  return { generated: fresh.length, suggestionCount: suggestionIds.length };
}

function createPhase18ReviewDashboardTask() {
  const agent = buildPhase18LongTermAgent();
  const dashboard = agent.reviewDashboard || {};
  const task = normalizePhase18Task({
    id: `phase18-review-dashboard-${simpleChecksum(`${dashboard.focus || ""}:${dashboard.latestAudit || ""}`)}`,
    status: "reviewing",
    label: dashboard.focus || "长期助理复盘任务",
    source: "review-dashboard",
    priority: dashboard.quietSuggestions || dashboard.unresolvedDrafts ? "high" : "medium",
    memoryIds: [],
    detail: dashboard.recommendation || "根据长期助理复盘结果生成的下一步任务。"
  });
  const tasks = loadPhase18TaskQueue();
  const exists = tasks.some((item) => item.id === task.id);
  savePhase18TaskQueue(exists ? tasks.map((item) => item.id === task.id ? { ...item, ...task, updatedAt: new Date().toISOString() } : item) : [task, ...tasks]);
  recordPhase18TaskAudit("review-dashboard-task-created", task.id, `由复盘面板生成任务：${task.label}`, {
    priority: task.priority,
    focus: dashboard.focus || ""
  });
  return task;
}

function createPhase18DigestTask() {
  const agent = buildPhase18LongTermAgent();
  const digest = agent.agentDigest || {};
  const signalKey = `${digest.todayFocus || ""}:${digest.weeklyFocus || ""}:${digest.recommendation || ""}`;
  const task = normalizePhase18Task({
    id: `phase18-agent-digest-${simpleChecksum(signalKey)}`,
    status: "reviewing",
    label: digest.todayFocus || "长期助理摘要任务",
    source: "agent-digest",
    priority: digest.readiness === "needs-attention" ? "high" : "medium",
    memoryIds: Array.from(new Set((digest.topActions || []).flatMap((item) => item.memoryIds || []))).slice(0, 8),
    detail: digest.recommendation || "根据长期助理每日/每周摘要生成的跟进任务。"
  });
  const tasks = loadPhase18TaskQueue();
  const exists = tasks.some((item) => item.id === task.id);
  savePhase18TaskQueue(exists ? tasks.map((item) => item.id === task.id ? { ...item, ...task, updatedAt: new Date().toISOString() } : item) : [task, ...tasks]);
  recordPhase18TaskAudit("agent-digest-task-created", task.id, `由长期助理摘要生成任务：${task.label}`, {
    priority: task.priority,
    readiness: digest.readiness || "unknown"
  });
  return task;
}

function buildPhase18TaskMetrics(tasks = []) {
  const normalized = tasks.map(normalizePhase18Task);
  const byStatus = normalized.reduce((acc, task) => {
    acc[task.status] = (acc[task.status] || 0) + 1;
    return acc;
  }, {});
  const active = normalized.filter((task) => ["queued", "reviewing", "failed"].includes(task.status));
  return {
    total: normalized.length,
    active: active.length,
    queued: byStatus.queued || 0,
    reviewing: byStatus.reviewing || 0,
    applied: byStatus.applied || 0,
    dismissed: byStatus.dismissed || 0,
    failed: byStatus.failed || 0,
    byStatus,
    recent: normalized.slice(0, 12)
  };
}

function filterPhase18Tasks(tasks = [], filter = phase18TaskFilter) {
  const normalized = tasks.map(normalizePhase18Task);
  if (filter === "all") return normalized;
  if (filter === "active") return normalized.filter((task) => ["queued", "reviewing", "failed"].includes(task.status));
  return normalized.filter((task) => task.status === filter);
}

function getPhase18TaskStatusLabel(status = "queued") {
  const labels = {
    queued: "等待中",
    reviewing: "复核中",
    applied: "已应用",
    dismissed: "已忽略",
    failed: "失败"
  };
  return labels[status] || status;
}

function getPhase18TaskNextActions(status = "queued") {
  if (status === "queued") return [{ status: "reviewing", label: "复核" }, { status: "dismissed", label: "忽略" }];
  if (status === "reviewing") return [{ status: "applied", label: "完成" }, { status: "failed", label: "失败" }];
  if (status === "failed") return [{ status: "reviewing", label: "重试" }, { status: "dismissed", label: "忽略" }];
  return [];
}

function buildPhase18LongTermAgent(sourceMemories = memories) {
  const structured = sourceMemories.map(normalizeMemory);
  const feedback = loadPhase18AgentFeedback();
  const repairDrafts = loadPhase18RepairDrafts();
  const taskAudit = loadPhase18TaskAudit();
  const repairBatchReview = buildPhase18RepairBatchReview(repairDrafts);
  const suggestions = buildPhase18ProactiveSuggestions(structured);
  const relationships = buildPhase18RelationshipMap(structured);
  const periodicReviews = enrichPhase18PeriodicReviewsWithAssets(buildPhase18PeriodicReviews(structured));
  const taskQueue = syncPhase18TaskQueue(suggestions);
  prunePhase18TaskSelection(taskQueue);
  const taskMetrics = buildPhase18TaskMetrics(taskQueue);
  const taskBatchReview = buildPhase18TaskBatchReview(taskQueue);
  const agentQuality = buildPhase18AgentQuality(feedback, taskMetrics, repairDrafts, taskAudit);
  const suggestionNoise = buildPhase18SuggestionNoisePolicy(suggestions, feedback);
  const assetSyncState = buildPhase18AssetSyncState();
  const reviewDashboard = buildPhase18ReviewDashboard({ suggestions, relationships, periodicReviews, taskMetrics, agentQuality, repairDrafts, taskAudit, suggestionNoise });
  const agentDigest = buildPhase18AgentDigest({ structured, suggestions, relationships, periodicReviews, taskMetrics, repairDrafts, taskAudit, agentQuality, assetSyncState, suggestionNoise });
  const readinessChecks = [
    { id: "suggestions", label: "主动整理建议", status: suggestions.length ? "ready" : "needs-sample", detail: suggestions.length ? `${suggestions.length} 条建议` : "需要更多展品生成建议。" },
    { id: "relationships", label: "跨展品关系", status: relationships.clusters.length ? "ready" : "needs-sample", detail: relationships.clusters.length ? `${relationships.clusters.length} 组关系` : "需要人物、地点、标签或情绪线索。" },
    { id: "periodic-review", label: "周期回顾", status: periodicReviews.length ? "ready" : "needs-date", detail: periodicReviews.length ? `${periodicReviews.length} 个回顾候选` : "需要带日期的展品。" },
    { id: "feedback-loop", label: "反馈闭环", status: feedback.length ? "learning" : "ready", detail: feedback.length ? `${feedback.length} 条采纳/忽略记录` : "已具备反馈记录入口。" },
    { id: "task-audit", label: "任务审计", status: taskAudit.length ? "learning" : "ready", detail: taskAudit.length ? `${taskAudit.length} 条任务审计` : "状态流转和批量修复会写入本地审计。" },
    { id: "review-assets", label: "回顾资产", status: periodicReviews.length ? "ready" : "needs-date", detail: periodicReviews.length ? "周期回顾可保存为专题展草稿。" : "需要月度回顾候选。" },
    { id: "review-reports", label: "回顾报告", status: periodicReviews.length ? "ready" : "needs-date", detail: periodicReviews.length ? "周期回顾可保存为报告草稿。" : "需要月度回顾候选。" }
  ];
  return {
    phase: 18,
    phaseName: "Agent 能力进阶和长期记忆助理版",
    buildLabel: "phase18-agent-digest-thirteenth-edition",
    mode: "local-long-term-memory-assistant",
    generatedAt: new Date().toISOString(),
    sourceCount: structured.length,
    suggestions,
    visibleSuggestions: suggestionNoise.visible,
    suggestionNoise,
    relationships,
    periodicReviews,
    taskQueue: {
      ...taskMetrics,
      filter: phase18TaskFilter,
      selectedIds: Array.from(phase18SelectedTaskIds),
      batchReview: taskBatchReview,
      visible: filterPhase18Tasks(taskQueue).slice(0, 10)
    },
    feedbackLoop: {
      total: feedback.length,
      accepted: feedback.filter((item) => item.action === "accepted").length,
      dismissed: feedback.filter((item) => item.action === "dismissed").length,
      recent: feedback.slice(0, 6)
    },
    agentQuality,
    agentDigest,
    reviewDashboard,
    repairDrafts: {
      total: repairDrafts.length,
      preview: repairDrafts.filter((item) => item.status === "preview").length,
      applied: repairDrafts.filter((item) => item.status === "applied").length,
      recent: repairDrafts.slice(0, 8),
      batchReview: repairBatchReview
    },
    taskAudit: {
      total: taskAudit.length,
      recent: taskAudit.slice(0, 8)
    },
    periodicAssetPlan: {
      ready: periodicReviews.length > 0,
      candidates: periodicReviews.length,
      persistence: databaseAvailable ? "sqlite-saved-exhibitions" : "requires-node-sqlite"
    },
    periodicReportPlan: {
      ready: periodicReviews.length > 0,
      candidates: periodicReviews.length,
      persistence: databaseAvailable ? "sqlite-report-drafts" : "requires-node-sqlite"
    },
    assetSyncState,
    suggestionQuality: {
      high: suggestions.filter((item) => item.quality?.tier === "A").length,
      medium: suggestions.filter((item) => item.quality?.tier === "B").length,
      low: suggestions.filter((item) => item.quality?.tier === "C").length,
      averageScore: suggestions.length ? Math.round(suggestions.reduce((sum, item) => sum + (item.quality?.score || 0), 0) / suggestions.length) : 0
    },
    readinessChecks,
    nextStep: agentDigest.recommendation || (suggestions.length || relationships.clusters.length
      ? "优先处理高优先级建议，再把稳定月度回顾保存为专题资产。"
      : "先继续保存更多带时间、人物、地点和标签的展品。")
  };
}

function buildPhase18AgentQuality(feedback = [], taskMetrics = {}, repairDrafts = [], taskAudit = []) {
  const accepted = feedback.filter((item) => item.action === "accepted").length;
  const dismissed = feedback.filter((item) => item.action === "dismissed").length;
  const feedbackTotal = accepted + dismissed;
  const appliedDrafts = repairDrafts.filter((item) => item.status === "applied").length;
  const previewDrafts = repairDrafts.filter((item) => item.status === "preview").length;
  const statusChanges = taskAudit.filter((item) => item.action === "task-status-changed");
  const failedChanges = statusChanges.filter((item) => item.meta?.to === "failed");
  return {
    feedbackTotal,
    acceptanceRate: feedbackTotal ? Math.round((accepted / feedbackTotal) * 100) : 0,
    dismissalRate: feedbackTotal ? Math.round((dismissed / feedbackTotal) * 100) : 0,
    taskResolvedRate: taskMetrics.total ? Math.round(((taskMetrics.applied + taskMetrics.dismissed) / taskMetrics.total) * 100) : 0,
    repairApplyRate: repairDrafts.length ? Math.round((appliedDrafts / repairDrafts.length) * 100) : 0,
    appliedDrafts,
    previewDrafts,
    failedTasks: taskMetrics.failed || 0,
    failedTransitions: failedChanges.length,
    recommendation: failedChanges.length
      ? "先复盘失败任务，再继续批量修复。"
      : previewDrafts
        ? "可从预览草案中选择低风险字段批量应用。"
        : "继续积累反馈，质量统计会更稳定。"
  };
}

function buildPhase18SuggestionNoisePolicy(suggestions = [], feedback = []) {
  const dismissedTargets = new Set(feedback.filter((item) => item.action === "dismissed").map((item) => item.targetId));
  const quiet = suggestions.filter((item) => item.quality?.tier === "C" || dismissedTargets.has(item.id));
  const visible = suggestions.filter((item) => !quiet.some((quietItem) => quietItem.id === item.id));
  const sortedVisible = visible.sort((a, b) => (b.quality?.score || 0) - (a.quality?.score || 0));
  return {
    mode: "auto-tier-and-feedback",
    quietCount: quiet.length,
    visible: sortedVisible.length ? sortedVisible : suggestions.slice().sort((a, b) => (b.quality?.score || 0) - (a.quality?.score || 0)),
    quiet: quiet.map((item) => ({
      id: item.id,
      title: item.title,
      tier: item.quality?.tier || "C",
      reason: dismissedTargets.has(item.id) ? "用户已暂不处理" : "质量分层较低，自动降噪"
    })),
    recommendation: quiet.length
      ? `已自动降噪 ${quiet.length} 条低优先级或被忽略建议。`
      : "当前建议质量稳定，无需降噪。"
  };
}

function getDefaultPhase18NoiseRuleConfig() {
  return {
    mode: "configurable-tier-feedback",
    hideLowTier: true,
    hideDismissed: true,
    hideWeakEvidence: false,
    minVisibleScore: 48,
    keepHighPriority: true
  };
}

function normalizePhase18NoiseRuleConfig(config = {}) {
  const defaults = getDefaultPhase18NoiseRuleConfig();
  const score = Number(config.minVisibleScore);
  return {
    ...defaults,
    ...config,
    minVisibleScore: Number.isFinite(score) ? Math.min(90, Math.max(0, Math.round(score))) : defaults.minVisibleScore,
    hideLowTier: config.hideLowTier !== false,
    hideDismissed: config.hideDismissed !== false,
    hideWeakEvidence: config.hideWeakEvidence === true,
    keepHighPriority: config.keepHighPriority !== false
  };
}

function loadPhase18NoiseRuleConfig() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PHASE18_NOISE_RULE_KEY) || "{}");
    return normalizePhase18NoiseRuleConfig(parsed);
  } catch (error) {
    return getDefaultPhase18NoiseRuleConfig();
  }
}

function savePhase18NoiseRuleConfig(config) {
  const normalized = normalizePhase18NoiseRuleConfig(config);
  localStorage.setItem(PHASE18_NOISE_RULE_KEY, JSON.stringify(normalized));
  return normalized;
}

function updatePhase18NoiseRuleSetting(key, value) {
  const current = loadPhase18NoiseRuleConfig();
  return savePhase18NoiseRuleConfig({ ...current, [key]: value });
}

function resetPhase18NoiseRuleConfig() {
  localStorage.removeItem(PHASE18_NOISE_RULE_KEY);
  return getDefaultPhase18NoiseRuleConfig();
}

function buildPhase18NoiseRulePreview({ suggestions = [], quiet = [], visible = [], config = {} } = {}) {
  const quietIds = new Set(quiet.map((item) => item.id));
  const recoverable = suggestions.filter((item) => quietIds.has(item.id) && (
    item.quality?.tier === "B" ||
    item.priority === "high" ||
    (item.quality?.score || 0) >= Math.max(0, (config.minVisibleScore || 0) - 8)
  ));
  return {
    total: suggestions.length,
    visibleCount: visible.length,
    quietCount: quiet.length,
    recoverableCount: recoverable.length,
    hiddenByTier: quiet.filter((item) => item.noiseReason === "low-tier").length,
    hiddenByFeedback: quiet.filter((item) => item.noiseReason === "dismissed").length,
    hiddenByWeakEvidence: quiet.filter((item) => item.noiseReason === "weak-evidence").length,
    hiddenByScore: quiet.filter((item) => item.noiseReason === "below-score").length,
    recoverable: recoverable.slice(0, 4).map((item) => ({
      id: item.id,
      title: item.title,
      tier: item.quality?.tier || "C",
      score: item.quality?.score || 0
    })),
    recommendation: quiet.length
      ? "当前规则已收起低置信或暂不处理的建议，可在规则面板临时放宽后复核。"
      : "当前规则没有收起建议，可以继续保持自动复盘。"
  };
}

function buildPhase18SuggestionNoisePolicy(suggestions = [], feedback = [], configInput = loadPhase18NoiseRuleConfig()) {
  const config = normalizePhase18NoiseRuleConfig(configInput);
  const dismissedTargets = new Set(feedback.filter((item) => item.action === "dismissed").map((item) => item.targetId));
  const scored = suggestions.map((item) => {
    const score = item.quality?.score || 0;
    let noiseReason = "";
    if (config.hideDismissed && dismissedTargets.has(item.id)) noiseReason = "dismissed";
    if (!noiseReason && config.hideLowTier && item.quality?.tier === "C") noiseReason = "low-tier";
    if (!noiseReason && config.hideWeakEvidence && (item.quality?.coverage || 0) < 35) noiseReason = "weak-evidence";
    if (!noiseReason && score < config.minVisibleScore) noiseReason = "below-score";
    if (config.keepHighPriority && item.priority === "high" && noiseReason !== "dismissed") noiseReason = "";
    return { ...item, noiseReason };
  });
  const quiet = scored.filter((item) => item.noiseReason);
  const visible = scored.filter((item) => !item.noiseReason);
  const sortedVisible = visible.sort((a, b) => (b.quality?.score || 0) - (a.quality?.score || 0));
  const fallbackVisible = suggestions.slice().sort((a, b) => (b.quality?.score || 0) - (a.quality?.score || 0));
  const preview = buildPhase18NoiseRulePreview({ suggestions: scored, quiet, visible: sortedVisible, config });
  return {
    mode: config.mode,
    config,
    preview,
    quietCount: quiet.length,
    visible: sortedVisible.length ? sortedVisible : fallbackVisible,
    quiet: quiet.map((item) => ({
      id: item.id,
      title: item.title,
      tier: item.quality?.tier || "C",
      score: item.quality?.score || 0,
      noiseReason: item.noiseReason,
      reason: item.noiseReason === "dismissed"
        ? "用户已标记暂不处理"
        : item.noiseReason === "weak-evidence"
          ? "证据覆盖不足，已按规则收起"
          : item.noiseReason === "below-score"
            ? "低于当前显示分数阈值"
            : "质量分层较低，已按规则收起"
    })),
    recommendation: quiet.length
      ? `已按规则收起 ${quiet.length} 条建议，当前显示 ${sortedVisible.length || fallbackVisible.length} 条。`
      : "当前建议质量稳定，没有被规则收起的建议。"
  };
}

function buildPhase18ReviewDashboard({ suggestions = [], relationships = {}, periodicReviews = [], taskMetrics = {}, agentQuality = {}, repairDrafts = [], taskAudit = [], suggestionNoise = {} } = {}) {
  const savedReviews = periodicReviews.filter((item) => item.assetLink?.exists || item.reportLink?.exists).length;
  const highTier = suggestions.filter((item) => item.quality?.tier === "A").length;
  const latestAudit = taskAudit[0]?.detail || "暂无审计记录";
  return {
    status: suggestions.length || relationships.clusterCount || periodicReviews.length ? "active" : "waiting",
    focus: highTier ? "优先处理 A 级建议" : periodicReviews.length ? "优先沉淀周期回顾" : "继续补充展品线索",
    savedReviews,
    reviewCoverage: periodicReviews.length ? Math.round((savedReviews / periodicReviews.length) * 100) : 0,
    graphCoverage: relationships.graph?.nodeCount || 0,
    quietSuggestions: suggestionNoise.quietCount || 0,
    openTasks: taskMetrics.active || 0,
    unresolvedDrafts: repairDrafts.filter((item) => item.status === "preview").length,
    qualityScore: Math.round(((agentQuality.acceptanceRate || 0) + (agentQuality.taskResolvedRate || 0) + (agentQuality.repairApplyRate || 0)) / 3),
    latestAudit,
    recommendation: suggestionNoise.quietCount
      ? "先处理未降噪的 A/B 级建议，再复盘被忽略建议。"
      : "继续把稳定回顾保存为专题资产或报告草稿。"
  };
}

function buildPhase18AgentDigest({
  structured = [],
  suggestions = [],
  relationships = {},
  periodicReviews = [],
  taskMetrics = {},
  repairDrafts = [],
  taskAudit = [],
  agentQuality = {},
  assetSyncState = {},
  suggestionNoise = {}
} = {}) {
  const highSuggestions = suggestions.filter((item) => item.priority === "high" || item.quality?.tier === "A");
  const previewDrafts = repairDrafts.filter((item) => item.status === "preview");
  const savedReviews = periodicReviews.filter((item) => item.assetLink?.exists || item.reportLink?.exists);
  const riskAssets = assetSyncState.items?.filter((item) => item.syncStatus === "risk") || [];
  const relationClusters = relationships.clusters || [];
  const activeTasks = taskMetrics.active || 0;
  const quietSuggestions = suggestionNoise.quietCount || 0;
  const reviewCandidates = periodicReviews.length;
  const todayFocus = highSuggestions[0]?.title
    || (previewDrafts.length ? "复核待应用修复草案" : "")
    || (activeTasks ? "推进长期任务队列" : "")
    || (reviewCandidates ? "沉淀一个周期回顾" : "")
    || "补充展品的时间、人物、地点和标签线索";
  const weeklyFocus = relationClusters.length >= 2
    ? "把稳定关系簇整理成专题展或报告草稿"
    : reviewCandidates
      ? "选择一个月度回顾保存为长期资产"
      : "持续积累可用于长期助理学习的展品样本";
  const topActions = [
    highSuggestions[0] ? {
      id: `suggestion-${highSuggestions[0].id}`,
      label: highSuggestions[0].title,
      detail: highSuggestions[0].detail,
      memoryIds: highSuggestions[0].memoryIds || []
    } : null,
    previewDrafts.length ? {
      id: "repair-preview",
      label: "复核修复草案",
      detail: `当前有 ${previewDrafts.length} 条草案等待确认，适合先处理低风险字段。`,
      memoryIds: previewDrafts.map((item) => item.memoryId).filter(Boolean)
    } : null,
    periodicReviews[0] ? {
      id: `review-${periodicReviews[0].id}`,
      label: periodicReviews[0].label,
      detail: `${periodicReviews[0].count || 0} 件展品可沉淀为周期回顾。`,
      memoryIds: periodicReviews[0].memories?.map((item) => item.id).filter(Boolean) || []
    } : null,
    relationClusters[0] ? {
      id: `relation-${relationClusters[0].id}`,
      label: `${relationClusters[0].type}：${relationClusters[0].value}`,
      detail: relationClusters[0].evidence || "关系簇可继续整理成讲解线索。",
      memoryIds: relationClusters[0].memories?.map((item) => item.id).filter(Boolean) || []
    } : null
  ].filter(Boolean).slice(0, 3);
  const readiness = riskAssets.length || agentQuality.failedTasks || agentQuality.failedTransitions
    ? "needs-attention"
    : (activeTasks || highSuggestions.length || previewDrafts.length || reviewCandidates ? "ready" : "warming-up");
  const recommendation = readiness === "needs-attention"
    ? "先处理同步风险、失败任务或高风险草案，再继续推进新整理。"
    : topActions.length
      ? "今天先完成摘要中的第一项动作，本周再把稳定关系或周期回顾沉淀为资产。"
      : "继续补充展品线索，长期助理会在样本变丰富后生成更明确摘要。";
  return {
    mode: "daily-weekly-memory-assistant-digest",
    generatedAt: new Date().toISOString(),
    todayFocus,
    weeklyFocus,
    topActions,
    signals: {
      memories: structured.length,
      activeTasks,
      quietSuggestions,
      relationClusters: relationClusters.length,
      reviewCandidates,
      savedReviews: savedReviews.length,
      previewDrafts: previewDrafts.length,
      assetSyncRisk: riskAssets.length,
      latestAudit: taskAudit[0]?.detail || "暂无审计记录"
    },
    cadence: {
      daily: "打开页面后先看摘要焦点，再处理一条高优先级任务。",
      weekly: "每周选择一个稳定关系簇或周期回顾，保存为专题展或报告草稿。"
    },
    readiness,
    recommendation
  };
}

function buildPhase18ProactiveSuggestions(items = []) {
  const suggestions = [];
  const missingDate = items.filter((memory) => !memory.date);
  const missingPeople = items.filter((memory) => !memory.people?.length);
  const missingLocation = items.filter((memory) => !memory.location);
  const missingTags = items.filter((memory) => !memory.tags?.length);
  const highValueNoMedia = items.filter((memory) => (memory.favorite || memory.importance >= 4) && !memory.coverImage && !memory.mediaNote && !normalizeAttachments(memory.attachments).length);
  if (missingDate.length) suggestions.push(buildPhase18Suggestion("missing-date", "补全时间线日期", "timeline", "high", missingDate, `有 ${missingDate.length} 件展品缺少日期，周期回顾会受影响。`));
  if (missingPeople.length) suggestions.push(buildPhase18Suggestion("missing-people", "补充相关人物", "relationship", "medium", missingPeople, `有 ${missingPeople.length} 件展品缺少人物线索，跨展品关系较难发现。`));
  if (missingLocation.length) suggestions.push(buildPhase18Suggestion("missing-location", "补充地点线索", "relationship", "medium", missingLocation, `有 ${missingLocation.length} 件展品缺少地点，可补成城市、房间或场景。`));
  if (missingTags.length) suggestions.push(buildPhase18Suggestion("missing-tags", "补充主题标签", "theme", "medium", missingTags, `有 ${missingTags.length} 件展品缺少标签，主题展候选会偏弱。`));
  if (highValueNoMedia.length) suggestions.push(buildPhase18Suggestion("high-value-media", "为重点展品补附件说明", "multimodal", "high", highValueNoMedia, `有 ${highValueNoMedia.length} 件重点展品缺少图片、OCR、语音或附件线索。`));
  return suggestions;
}

function buildPhase18Suggestion(id, title, type, priority, matches, detail) {
  const quality = buildPhase18SuggestionQuality(type, priority, matches);
  return {
    id,
    title,
    type,
    priority,
    quality,
    detail,
    count: matches.length,
    memoryIds: matches.slice(0, 6).map((memory) => memory.id),
    examples: matches.slice(0, 3).map(buildMemoryReference)
  };
}

function buildPhase18SuggestionQuality(type, priority, matches = []) {
  const count = matches.length;
  const evidenceRich = matches.filter((memory) => (
    memory.date ||
    memory.location ||
    memory.people?.length ||
    memory.tags?.length ||
    memory.emotions?.length ||
    memory.mediaNote ||
    normalizeAttachments(memory.attachments).length
  )).length;
  const coverage = count ? Math.round((evidenceRich / count) * 100) : 0;
  const urgency = priority === "high" ? 34 : priority === "medium" ? 22 : 12;
  const breadth = Math.min(34, count * 6);
  const score = Math.min(100, urgency + breadth + Math.round(coverage / 4));
  const tier = score >= 72 ? "A" : score >= 48 ? "B" : "C";
  return {
    tier,
    score,
    coverage,
    evidenceRich,
    reason: tier === "A"
      ? "高价值且影响面较大，建议优先复核。"
      : tier === "B"
        ? "价值稳定，可排入常规整理。"
        : "线索较轻，适合后续批量处理。"
  };
}

function buildPhase18RelationshipMap(items = []) {
  const dimensions = [
    { id: "people", label: "共同人物", values: (memory) => memory.people || [] },
    { id: "locations", label: "重复地点", values: (memory) => memory.location ? [memory.location] : [] },
    { id: "tags", label: "相同标签", values: (memory) => memory.tags || [] },
    { id: "emotions", label: "相似情绪", values: (memory) => memory.emotions || [] }
  ];
  const clusters = dimensions.flatMap((dimension) => {
    const map = new Map();
    items.forEach((memory) => {
      dimension.values(memory).forEach((value) => {
        const key = limitText(value, 40);
        if (!key) return;
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(memory);
      });
    });
    return [...map.entries()]
      .filter(([, memoriesInCluster]) => memoriesInCluster.length >= 2)
      .map(([value, memoriesInCluster]) => ({
        id: `${dimension.id}-${simpleChecksum(value)}`,
        type: dimension.label,
        value,
        count: memoriesInCluster.length,
        strength: memoriesInCluster.length >= 5 ? "strong" : memoriesInCluster.length >= 3 ? "medium" : "light",
        evidence: `${dimension.label}“${value}”连接了 ${memoriesInCluster.length} 件展品，可作为专题展或讲解线索。`,
        memories: memoriesInCluster.slice(0, 5).map(buildMemoryReference)
      }));
  }).sort((a, b) => b.count - a.count).slice(0, 8);
  const assetNavigation = buildPhase18AssetNavigationIndex(clusters);
  const enrichedClusters = clusters.map((cluster) => ({
    ...cluster,
    assetLinks: assetNavigation.byCluster[cluster.id]?.assets || [],
    reportLinks: assetNavigation.byCluster[cluster.id]?.reports || []
  }));
  return {
    clusterCount: enrichedClusters.length,
    clusters: enrichedClusters,
    assetNavigation,
    graph: buildPhase18RelationshipGraph(enrichedClusters)
  };
}

function getReportReferenceIds(report = {}) {
  return (Array.isArray(report.references) ? report.references : [])
    .map((ref) => ref.memoryId || ref.id || ref.memory_id || "")
    .filter(Boolean);
}

function buildPhase18AssetNavigationIndex(clusters = [], collection = getAssetCollection()) {
  const exhibitions = Array.isArray(collection.savedExhibitions) ? collection.savedExhibitions : [];
  const reports = Array.isArray(collection.reportDrafts) ? collection.reportDrafts : [];
  const byCluster = {};
  const assetLookup = {};
  const reportLookup = {};
  clusters.forEach((cluster) => {
    const clusterMemoryIds = new Set((cluster.memories || []).map((memory) => memory.id).filter(Boolean));
    const assets = exhibitions.map((asset) => {
      const ids = Array.isArray(asset.memoryIds) ? asset.memoryIds : [];
      const overlap = ids.filter((id) => clusterMemoryIds.has(id));
      return overlap.length ? {
        id: asset.id,
        title: asset.title || "未命名专题展",
        type: "exhibition",
        overlapCount: overlap.length,
        status: asset.status || "draft"
      } : null;
    }).filter(Boolean).slice(0, 3);
    const linkedReports = reports.map((report) => {
      const ids = getReportReferenceIds(report);
      const overlap = ids.filter((id) => clusterMemoryIds.has(id));
      return overlap.length ? {
        id: report.id,
        title: report.title || "未命名报告草稿",
        type: "report",
        overlapCount: overlap.length,
        status: report.status || "draft"
      } : null;
    }).filter(Boolean).slice(0, 3);
    byCluster[cluster.id] = { assets, reports: linkedReports };
    assets.forEach((asset) => {
      assetLookup[asset.id] = [...(assetLookup[asset.id] || []), {
        id: cluster.id,
        label: `${cluster.type}:${cluster.value}`,
        overlapCount: asset.overlapCount
      }].slice(0, 4);
    });
    linkedReports.forEach((report) => {
      reportLookup[report.id] = [...(reportLookup[report.id] || []), {
        id: cluster.id,
        label: `${cluster.type}:${cluster.value}`,
        overlapCount: report.overlapCount
      }].slice(0, 4);
    });
  });
  const linkedAssetCount = Object.keys(assetLookup).length;
  const linkedReportCount = Object.keys(reportLookup).length;
  return {
    byCluster,
    assetLookup,
    reportLookup,
    linkedAssetCount,
    linkedReportCount,
    recommendation: linkedAssetCount || linkedReportCount
      ? "关系图谱已能跳转到相关专题展和报告草稿，也可从资产卡片回看关系来源。"
      : "保存包含这些展品的专题展或报告后，关系图谱会自动出现资产跳转。"
  };
}

function buildPhase18RelationshipGraph(clusters = []) {
  const nodes = [];
  const edges = [];
  const nodeIds = new Set();
  const addNode = (id, label, type, weight = 1) => {
    if (nodeIds.has(id)) return;
    nodeIds.add(id);
    nodes.push({ id, label: limitText(label, 60), type, weight });
  };
  clusters.slice(0, 6).forEach((cluster) => {
    const clusterId = `cluster-${cluster.id}`;
    addNode(clusterId, `${cluster.type}:${cluster.value}`, "cluster", cluster.count);
    (cluster.memories || []).slice(0, 4).forEach((memory) => {
      const memoryId = `memory-${memory.id}`;
      addNode(memoryId, memory.title, "memory", 1);
      edges.push({
        from: clusterId,
        to: memoryId,
        label: cluster.type,
        strength: cluster.strength || "light"
      });
    });
    (cluster.assetLinks || []).slice(0, 2).forEach((asset) => {
      const assetId = `asset-${asset.id}`;
      addNode(assetId, asset.title, "asset", asset.overlapCount || 1);
      edges.push({
        from: clusterId,
        to: assetId,
        label: "专题展",
        strength: asset.overlapCount >= 3 ? "medium" : "light"
      });
    });
    (cluster.reportLinks || []).slice(0, 2).forEach((report) => {
      const reportId = `report-${report.id}`;
      addNode(reportId, report.title, "report", report.overlapCount || 1);
      edges.push({
        from: clusterId,
        to: reportId,
        label: "报告",
        strength: report.overlapCount >= 3 ? "medium" : "light"
      });
    });
  });
  return {
    nodeCount: nodes.length,
    edgeCount: edges.length,
    nodes: nodes.slice(0, 18),
    edges: edges.slice(0, 24),
    summary: nodes.length ? `${nodes.length} 个节点 / ${edges.length} 条关系` : "等待更多关系线索"
  };
}

function filterPhase18RelationshipGraph(graph = {}, filter = phase18GraphFilter) {
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph.edges) ? graph.edges : [];
  if (filter === "all") return { ...graph, filter, visibleNodes: nodes.slice(0, 12), visibleEdges: edges.slice(0, 8) };
  const visibleNodes = nodes.filter((node) => node.type === filter).slice(0, 12);
  const visibleIds = new Set(visibleNodes.map((node) => node.id));
  const visibleEdges = edges.filter((edge) => visibleIds.has(edge.from) || visibleIds.has(edge.to)).slice(0, 8);
  return { ...graph, filter, visibleNodes, visibleEdges };
}

function buildPhase18PeriodicReviews(items = []) {
  const byMonth = items.reduce((map, memory) => {
    const sourceDate = memory.date || memory.createdAt || "";
    const month = String(sourceDate).slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) return map;
    if (!map.has(month)) map.set(month, []);
    map.get(month).push(memory);
    return map;
  }, new Map());
  return [...byMonth.entries()]
    .filter(([, monthItems]) => monthItems.length >= 2)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 6)
    .map(([month, monthItems]) => ({
      id: `review-${month}`,
      period: month,
      label: `${month} 月度回顾`,
      count: monthItems.length,
      topEmotions: toTopEntries(countValues(monthItems.flatMap((memory) => memory.emotions || [])), 3),
      memories: monthItems.slice(0, 5).map(buildMemoryReference),
      assetCandidate: {
        title: `${month} 月度回顾专题展`,
        memoryIds: monthItems.slice(0, 12).map((memory) => memory.id),
        tags: ["周期回顾", month, ...toTopEntries(countValues(monthItems.flatMap((memory) => memory.emotions || [])), 3).map((item) => item.label)].filter(Boolean).slice(0, 8)
      }
    }));
}

function enrichPhase18PeriodicReviewsWithAssets(reviews = []) {
  const collection = getAssetCollection();
  const exhibitions = Array.isArray(collection.savedExhibitions) ? collection.savedExhibitions : [];
  const reports = Array.isArray(collection.reportDrafts) ? collection.reportDrafts : [];
  return reviews.map((review) => {
    const assetId = `phase18-review-${review.period}`;
    const reportId = `phase18-review-report-${review.period}`;
    const asset = exhibitions.find((item) => item.id === assetId);
    const report = reports.find((item) => item.id === reportId);
    return {
      ...review,
      assetLink: {
        id: assetId,
        exists: Boolean(asset),
        title: asset?.title || review.assetCandidate?.title || `${review.label}专题展`
      },
      reportLink: {
        id: reportId,
        exists: Boolean(report),
        title: report?.title || `${review.label}报告草稿`
      }
    };
  });
}

async function savePhase18PeriodicReviewAsset(reviewId) {
  const agent = buildPhase18LongTermAgent();
  const review = agent.periodicReviews.find((item) => item.id === reviewId);
  if (!review) {
    setStorageStatus("没有找到这条第十八阶段周期回顾。", "warning");
    return;
  }
  if (!databaseAvailable) {
    setStorageStatus("需要先连接 Node 后端和 SQLite，才能把周期回顾保存为专题展资产。", "warning");
    renderAssetCollectionPanel();
    return;
  }
  const memoryIds = review.assetCandidate?.memoryIds?.length
    ? review.assetCandidate.memoryIds
    : review.memories.map((memory) => memory.id);
  const title = review.assetCandidate?.title || `${review.label}专题展`;
  const topEmotionText = review.topEmotions.map((item) => `${item.label} ${item.count}`).join(" / ") || "情绪待补充";
  const payload = {
    id: `phase18-review-${review.period}`,
    title,
    intro: `${review.label}包含 ${review.count} 件展品，适合整理成一条温和的月度回顾线。`,
    status: "draft",
    coverMemoryId: memoryIds[0] || "",
    memoryIds,
    sort: memoryIds,
    guideText: `这组回顾来自第十八阶段长期记忆助理。建议从时间、人物、地点和情绪线索切入，当前情绪线索为：${topEmotionText}。`,
    tags: review.assetCandidate?.tags || ["周期回顾", "第十八阶段"]
  };
  setStorageStatus(`正在保存周期回顾专题展：${title}`, "loading");
  try {
    const response = await requestJson(API_EXHIBITIONS, {
      method: "POST",
      body: JSON.stringify(payload)
    });
    const saved = response.savedExhibition;
    recordPhase18TaskAudit("periodic-review-asset-saved", review.id, `保存周期回顾专题展《${saved?.title || title}》。`, {
      assetId: saved?.id || payload.id,
      memoryCount: memoryIds.length
    });
    recordAssetAuditEvent({
      action: "phase18-review-asset",
      label: `第十八阶段周期回顾生成专题展《${saved?.title || title}》`,
      detail: `${review.label} / ${memoryIds.length} 件展品`
    });
    await syncAssetCollection({ quiet: true });
    renderInsights();
    setStorageStatus(`已保存周期回顾专题展：${saved?.title || title}`, "success");
  } catch (error) {
    recordPhase18TaskAudit("periodic-review-asset-failed", review.id, `周期回顾专题展保存失败：${error.message}`, { memoryCount: memoryIds.length });
    setStorageStatus(`周期回顾专题展保存失败：${error.message}`, "warning");
  }
}

function buildPhase18PeriodicReviewReportPayload(review) {
  const memoryIds = review.assetCandidate?.memoryIds?.length
    ? review.assetCandidate.memoryIds
    : review.memories.map((memory) => memory.id);
  const emotionText = review.topEmotions.map((item) => `${item.label} ${item.count}`).join(" / ") || "情绪待补充";
  const references = review.memories.slice(0, 8).map((memory, index) => ({
    memoryId: memory.id,
    title: memory.title,
    role: index === 0 ? "开篇展品" : "回顾引用"
  }));
  return {
    id: `phase18-review-report-${review.period}`,
    title: `${review.label}报告草稿`,
    status: "draft",
    scope: {
      source: "phase18-periodic-review",
      period: review.period,
      memoryIds
    },
    sections: [
      {
        title: "报告开头",
        text: `${review.label}收纳了 ${review.count} 件展品，可以从时间、情绪和代表展品三个角度打开这段记忆。`
      },
      {
        title: "情绪线索",
        text: `当前最明显的情绪线索是：${emotionText}。这些词适合作为后续人工润色报告时的语气锚点。`
      },
      {
        title: "后续整理建议",
        text: "建议先复核日期、人物、地点和附件线索，再把稳定展品推进到专题展或正式回忆报告。"
      }
    ],
    references,
    sourceInsights: {
      phase: 18,
      type: "periodic-review",
      reviewId: review.id,
      generatedAt: new Date().toISOString()
    }
  };
}

async function savePhase18PeriodicReviewReport(reviewId) {
  const agent = buildPhase18LongTermAgent();
  const review = agent.periodicReviews.find((item) => item.id === reviewId);
  if (!review) {
    setStorageStatus("没有找到这条第十八阶段周期回顾。", "warning");
    return;
  }
  if (!databaseAvailable) {
    setStorageStatus("需要先连接 Node 后端和 SQLite，才能把周期回顾保存为报告草稿。", "warning");
    renderAssetCollectionPanel();
    return;
  }
  const payload = buildPhase18PeriodicReviewReportPayload(review);
  setStorageStatus(`正在保存周期回顾报告草稿：${payload.title}`, "loading");
  try {
    const response = await requestJson(API_REPORT_DRAFTS, {
      method: "POST",
      body: JSON.stringify(payload)
    });
    const saved = response.reportDraft;
    recordPhase18TaskAudit("periodic-review-report-saved", review.id, `保存周期回顾报告草稿《${saved?.title || payload.title}》。`, {
      reportId: saved?.id || payload.id,
      sectionCount: payload.sections.length,
      referenceCount: payload.references.length
    });
    recordAssetAuditEvent({
      action: "phase18-review-report",
      label: `第十八阶段周期回顾生成报告草稿《${saved?.title || payload.title}》`,
      detail: `${review.label} / ${payload.references.length} 条引用`
    });
    await syncAssetCollection({ quiet: true });
    renderInsights();
    setStorageStatus(`已保存周期回顾报告草稿：${saved?.title || payload.title}`, "success");
  } catch (error) {
    recordPhase18TaskAudit("periodic-review-report-failed", review.id, `周期回顾报告草稿保存失败：${error.message}`, {
      sectionCount: payload.sections.length,
      referenceCount: payload.references.length
    });
    setStorageStatus(`周期回顾报告草稿保存失败：${error.message}`, "warning");
  }
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function limitText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function parseBoolean(value) {
  if (value === true || value === false) return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "y"].includes(normalized)) return true;
    if (["false", "0", "no", "n", ""].includes(normalized)) return false;
  }
  if (typeof value === "number") return value === 1;
  return false;
}

function normalizeList(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => limitText(item, fieldLimits.listItem))
      .filter(Boolean)
      .slice(0, fieldLimits.listLength);
  }
  if (typeof value === "string") return splitList(value);
  return [];
}

function normalizeMemory(memory) {
  const hallId = typeof memory.hall === "object" ? memory.hall?.id : memory.hall;
  const hallExists = halls.some((hall) => hall.id === hallId && hall.id !== "all");
  const now = new Date().toISOString();
  const rawContent = limitText(memory.rawContent, fieldLimits.rawContent);
  const title = limitText(memory.title, fieldLimits.title);
  const emotionIntensity = Math.min(5, Math.max(1, Number(memory.emotionIntensity) || 3));
  const importance = Math.min(5, Math.max(1, Number(memory.importance) || 1));
  const sourceType = sourceTypes.includes(memory.sourceType) ? memory.sourceType : "日记";

  return {
    schemaVersion: SCHEMA_VERSION,
    id: normalizeId(memory.id),
    title: title || "未命名展品",
    hall: hallExists ? hallId : "daily",
    rawContent,
    exhibitText: limitText(memory.exhibitText || rawContent || "这件展品还没有说明。", fieldLimits.exhibitText),
    date: limitText(memory.date, fieldLimits.date),
    location: limitText(memory.location, fieldLimits.location),
    people: normalizeList(memory.people),
    tags: normalizeList(memory.tags),
    emotions: normalizeList(memory.emotions),
    emotionIntensity,
    sourceType,
    importance,
    favorite: parseBoolean(memory.favorite),
    coverImage: limitText(memory.coverImage, fieldLimits.coverImage),
    mediaNote: limitText(memory.mediaNote, fieldLimits.mediaNote),
    attachments: normalizeAttachments(memory.attachments),
    agentRunId: limitText(memory.agentRunId, 120),
    createdAt: memory.createdAt || now,
    updatedAt: memory.updatedAt || ""
  };
}

function normalizeAttachments(value) {
  const items = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/\n+/).map((line) => {
        const [name = "", type = "", note = ""] = line.split("|").map((part) => part.trim());
        return { name, type, note };
      })
      : [];
  return items.map((item) => {
    if (typeof item === "string") return { name: limitText(item, fieldLimits.attachmentName), type: "附件", note: "" };
    return {
      name: limitText(item.name || item.filename || item.title, fieldLimits.attachmentName),
      type: limitText(item.type || item.kind || "附件", 30),
      note: limitText(item.note || item.description || item.text, fieldLimits.attachmentNote)
    };
  }).filter((item) => item.name).slice(0, 8);
}

function formatAttachmentsInput(attachments = []) {
  return normalizeAttachments(attachments).map((item) => [item.name, item.type, item.note].filter(Boolean).join(" | ")).join("\n");
}

function detectPhase19ImportFormat(text = "", requested = "auto") {
  if (requested && requested !== "auto") return requested;
  const trimmed = String(text || "").trim();
  if (!trimmed) return "text";
  if ((trimmed.startsWith("[") || trimmed.startsWith("{")) && /"?(memories|items|rawContent|content|text)"?\s*:/.test(trimmed)) return "json";
  if (/^#{1,3}\s+/m.test(trimmed)) return "markdown";
  if (/^.+,.+\n.+,.+/m.test(trimmed)) return "csv";
  if (/^\s*(?:\[[^\]]+\]\s*)?[^：:\n]{1,16}[：:]/m.test(trimmed)) return "chat";
  return "text";
}

function getPhase19CsvDelimiter(line = "") {
  const delimiters = [",", "\t", ";", "，"];
  return delimiters
    .map((delimiter) => ({ delimiter, count: String(line || "").split(delimiter).length - 1 }))
    .sort((a, b) => b.count - a.count)[0]?.delimiter || ",";
}

function splitPhase19CsvLine(line = "", delimiter = ",") {
  const cells = [];
  let current = "";
  let quoted = false;
  String(line || "").split("").forEach((char) => {
    if (char === "\"") {
      quoted = !quoted;
      return;
    }
    if (char === delimiter && !quoted) {
      cells.push(current.trim());
      current = "";
      return;
    }
    current += char;
  });
  cells.push(current.trim());
  return cells;
}

function parsePhase19CsvRows(text = "") {
  const lines = String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const delimiter = getPhase19CsvDelimiter(lines[0]);
  const headers = splitPhase19CsvLine(lines[0], delimiter);
  return lines.slice(1).map((line) => {
    const cells = splitPhase19CsvLine(line, delimiter);
    return headers.reduce((row, header, index) => {
      row[header] = cells[index] || "";
      return row;
    }, { _delimiter: delimiter });
  });
}

function parsePhase19ChatSegments(text = "", cleanupMode = "balanced") {
  const lines = String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const groups = [];
  let active = null;
  lines.forEach((line) => {
    const match = line.match(/^(?:\[?(\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[:：]\d{2})\]?\s*)?([^：:\n]{1,18})[：:]\s*(.+)$/);
    if (!match) {
      if (active) active.lines.push(line);
      else groups.push({ speaker: "片段", time: "", lines: [line] });
      return;
    }
    const [, time = "", speaker = "片段", content = ""] = match;
    const shouldMerge = active
      && active.speaker === speaker
      && (cleanupMode === "compact" || active.lines.length < 4);
    if (!shouldMerge) {
      active = { speaker, time, lines: [] };
      groups.push(active);
    }
    active.lines.push(content);
  });
  return groups.map((group, index) => ({
    title: `${group.speaker}的聊天片段 ${index + 1}`,
    rawContent: group.lines.join("\n"),
    people: [group.speaker].filter((item) => item && item !== "片段"),
    date: /^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(group.time) ? group.time.replace(/\//g, "-") : "",
    sourceType: "聊天片段",
    sourceTrace: `聊天记录 / ${group.speaker}${group.time ? ` / ${group.time}` : ""}`
  }));
}

function splitPhase19ImportText(text = "", format = "text", cleanupMode = "balanced") {
  const trimmed = String(text || "").trim();
  if (!trimmed) return [];
  if (format === "json") {
    try {
      const parsed = JSON.parse(trimmed);
      const rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed.memories) ? parsed.memories : Array.isArray(parsed.items) ? parsed.items : [parsed];
      return rows.map((item, index) => ({
        title: item.title || item.name || `导入片段 ${index + 1}`,
        rawContent: item.rawContent || item.content || item.text || item.body || item.exhibitText || "",
        date: item.date || item.memoryDate || "",
        location: item.location || "",
        people: item.people || item.person || "",
        tags: item.tags || "",
        sourceType: item.sourceType || item.source || "",
        fieldSource: item,
        sourceTrace: `JSON 第 ${index + 1} 项`
      })).filter((item) => item.rawContent || item.title);
    } catch {
      return [{ title: "JSON 解析失败的原始片段", rawContent: trimmed }];
    }
  }
  if (format === "csv") {
    return parsePhase19CsvRows(trimmed).map((row, index) => ({
      title: row.title || row.标题 || row.name || `CSV 片段 ${index + 1}`,
      rawContent: row.rawContent || row.content || row.text || row.正文 || row.内容 || Object.values(row).join(" / "),
      date: row.date || row.日期 || "",
      location: row.location || row.地点 || "",
      people: row.people || row.人物 || "",
      tags: row.tags || row.标签 || "",
      sourceType: row.sourceType || row.来源 || "",
      sourceTrace: `CSV 第 ${index + 2} 行 / 分隔符 ${row._delimiter === "\t" ? "Tab" : row._delimiter}`
    }));
  }
  if (format === "markdown") {
    const blocks = trimmed.split(/\n(?=#{1,3}\s+)/).map((block) => block.trim()).filter(Boolean);
    return blocks.map((block, index) => {
      const heading = block.match(/^#{1,3}\s+(.+)$/m)?.[1] || `Markdown 片段 ${index + 1}`;
      return { title: heading, rawContent: block.replace(/^#{1,3}\s+.+$/m, "").trim() || block, sourceTrace: `Markdown 标题：${heading}` };
    });
  }
  if (format === "chat") {
    return parsePhase19ChatSegments(trimmed, cleanupMode);
  }
  return trimmed.split(/\n{2,}|-{3,}/).map((block, index) => ({
    title: `文本片段 ${index + 1}`,
    rawContent: block.trim(),
    sourceTrace: `文本段落 ${index + 1}`
  })).filter((item) => item.rawContent);
}

function getPhase19MappingTemplate(template = "auto", detectedFormat = "text") {
  const templates = {
    diary: { label: "日记整理", sourceType: "日记", tags: ["日记", "个人记录"], hall: "" },
    chat: { label: "聊天归档", sourceType: "聊天片段", tags: ["聊天", "关系线索"], hall: "friends" },
    album: { label: "相册批注", sourceType: "照片描述", tags: ["相册", "照片线索"], hall: "family" },
    travel: { label: "旅行记录", sourceType: "旅行片段", tags: ["旅行", "地点线索"], hall: "travel" },
    auto: { label: "自动模板", sourceType: "", tags: [detectedFormat], hall: "" }
  };
  const custom = phase19CustomTemplates.find((item) => item.id === template);
  return custom || templates[template] || templates.auto;
}

function loadPhase19CustomMappingTemplates() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PHASE19_CUSTOM_TEMPLATES_KEY) || "[]");
    return Array.isArray(parsed)
      ? parsed.map(normalizePhase19CustomMappingTemplate).filter(Boolean).slice(0, 8)
      : [];
  } catch {
    return [];
  }
}

function normalizePhase19CustomMappingTemplate(template = {}) {
  const label = limitText(template.label || template.name, 30);
  if (!label) return null;
  return {
    id: limitText(template.id || `custom-${simpleChecksum(label).slice(0, 8)}`, 40),
    label,
    sourceType: sourceTypes.includes(template.sourceType) ? template.sourceType : "",
    hall: halls.some((hall) => hall.id === template.hall && hall.id !== "all") ? template.hall : "",
    tags: normalizeList(template.tags).slice(0, 6),
    people: normalizeList(template.people).slice(0, 6),
    dateRule: limitText(template.dateRule, 40),
    fieldAliases: normalizePhase19FieldAliases(template.fieldAliases),
    createdAt: template.createdAt || new Date().toISOString()
  };
}

function parsePhase19FieldAliasInput(value = "") {
  return String(value || "").split(";").reduce((rules, chunk) => {
    const [field, aliases] = chunk.split("=").map((part) => part.trim());
    if (!field || !aliases) return rules;
    rules[field] = aliases.split(/[,，、|]/).map((item) => item.trim()).filter(Boolean).slice(0, 8);
    return rules;
  }, {});
}

function normalizePhase19FieldAliases(value = {}) {
  const source = typeof value === "string" ? parsePhase19FieldAliasInput(value) : value;
  const allowed = ["title", "rawContent", "date", "location", "people", "tags", "sourceType"];
  return allowed.reduce((rules, field) => {
    const aliases = Array.isArray(source?.[field]) ? source[field] : typeof source?.[field] === "string" ? source[field].split(/[,，、|]/) : [];
    rules[field] = aliases.map((item) => limitText(item, 24)).filter(Boolean).slice(0, 8);
    return rules;
  }, {});
}

function getPhase19FieldSources(text = "", format = "text") {
  if (format === "csv") return parsePhase19CsvRows(text);
  if (format === "json") {
    try {
      const parsed = JSON.parse(String(text || "").trim());
      return Array.isArray(parsed) ? parsed : Array.isArray(parsed.memories) ? parsed.memories : Array.isArray(parsed.items) ? parsed.items : [parsed];
    } catch {
      return [];
    }
  }
  return [];
}

function readPhase19AliasValue(source = {}, aliases = []) {
  if (!source || typeof source !== "object") return "";
  const keys = Object.keys(source);
  const key = aliases.find((alias) => keys.some((item) => item.toLowerCase() === String(alias).toLowerCase()));
  if (!key) return "";
  const actual = keys.find((item) => item.toLowerCase() === String(key).toLowerCase());
  return source[actual];
}

function applyPhase19FieldAliases(segment = {}, template = {}) {
  const source = segment.fieldSource;
  if (!source) return segment;
  const rules = normalizePhase19FieldAliases(template.fieldAliases);
  return ["title", "rawContent", "date", "location", "people", "tags", "sourceType"].reduce((next, field) => {
    const value = readPhase19AliasValue(source, rules[field]);
    return value ? { ...next, [field]: value } : next;
  }, segment);
}

function persistPhase19CustomMappingTemplates() {
  localStorage.setItem(PHASE19_CUSTOM_TEMPLATES_KEY, JSON.stringify(phase19CustomTemplates.slice(0, 8)));
}

function renderPhase19MappingTemplateOptions() {
  if (!elements.phase19MappingTemplate) return;
  const selected = elements.phase19MappingTemplate.value || "auto";
  const defaults = [
    ["auto", "自动模板"],
    ["diary", "日记整理"],
    ["chat", "聊天归档"],
    ["album", "相册批注"],
    ["travel", "旅行记录"]
  ];
  const values = [...defaults.map(([value]) => value), ...phase19CustomTemplates.map((item) => item.id)];
  elements.phase19MappingTemplate.innerHTML = [
    ...defaults.map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`),
    ...phase19CustomTemplates.map((template) => `<option value="${escapeHtml(template.id)}">${escapeHtml(template.label)}</option>`)
  ].join("");
  elements.phase19MappingTemplate.value = values.includes(selected) ? selected : "auto";
}

function savePhase19CustomMappingTemplate() {
  const label = limitText(elements.phase19BatchName?.value || elements.phase19TemplateTags?.value || `导入模板 ${phase19CustomTemplates.length + 1}`, 30);
  const tags = normalizeList(elements.phase19TemplateTags?.value || label);
  const id = `custom-${Date.now().toString(36)}-${simpleChecksum(`${label}:${tags.join("|")}`).slice(0, 6)}`;
  const template = normalizePhase19CustomMappingTemplate({
    id,
    label,
    sourceType: elements.phase19DefaultSource?.value || "",
    hall: elements.phase19DefaultHall?.value === "auto" ? "" : elements.phase19DefaultHall?.value,
    tags,
    people: elements.phase19TemplatePeople?.value || "",
    dateRule: elements.phase19TemplateDateRule?.value || "",
    fieldAliases: parsePhase19FieldAliasInput(elements.phase19TemplateAliases?.value || ""),
    createdAt: new Date().toISOString()
  });
  if (!template) return;
  phase19CustomTemplates = [template, ...phase19CustomTemplates.filter((item) => item.label !== template.label)].slice(0, 8);
  persistPhase19CustomMappingTemplates();
  renderPhase19MappingTemplateOptions();
  elements.phase19MappingTemplate.value = template.id;
  setStorageStatus(`已保存第十九阶段自定义映射模板：${template.label}`, "success");
}

function applyPhase19MappingTemplate(draft = {}, templateId = "auto", detectedFormat = "text") {
  const template = getPhase19MappingTemplate(templateId, detectedFormat);
  const sourceType = template.sourceType && sourceTypes.includes(template.sourceType) ? template.sourceType : draft.sourceType;
  const hall = template.hall && halls.some((item) => item.id === template.hall) ? template.hall : draft.hall;
  const date = draft.date || template.dateRule || "";
  return normalizeMemory({
    ...draft,
    sourceType,
    hall,
    date,
    people: [...normalizeList(draft.people), ...normalizeList(template.people)].filter(Boolean),
    tags: [...normalizeList(draft.tags), ...normalizeList(template.tags), template.label].filter(Boolean)
  });
}

function buildPhase19DuplicateRisk(draft = {}, items = memories) {
  const title = String(draft.title || "").trim().toLowerCase();
  const raw = String(draft.rawContent || "").trim();
  const rawHash = simpleChecksum(raw.slice(0, 360));
  const candidate = items.find((memory) => {
    const sameTitle = title && String(memory.title || "").trim().toLowerCase() === title;
    const sameRaw = raw && simpleChecksum(String(memory.rawContent || "").trim().slice(0, 360)) === rawHash;
    return sameTitle || sameRaw;
  });
  return candidate
    ? { level: "high", memoryId: candidate.id, title: candidate.title, reason: "标题或正文片段与现有展品接近" }
    : { level: "low", memoryId: "", title: "", reason: "未发现明显重复" };
}

function annotatePhase19DuplicateRisks(drafts = []) {
  return drafts.map((draft) => ({
    ...draft,
    duplicateRisk: buildPhase19DuplicateRisk(draft)
  })).map((draft) => ({
    ...draft,
    duplicateAction: draft.duplicateRisk?.level === "high" ? "skip" : "new",
    selected: draft.duplicateRisk?.level === "high" ? false : draft.selected
  }));
}

function buildPhase19ConflictPreview(plan = phase19ImportPreview) {
  const drafts = plan?.drafts || [];
  const risky = drafts.filter((draft) => draft.duplicateRisk?.level === "high");
  const decisionCounts = drafts.reduce((acc, draft) => {
    const action = draft.duplicateAction || "new";
    acc[action] = (acc[action] || 0) + 1;
    return acc;
  }, {});
  return {
    total: risky.length,
    skip: decisionCounts.skip || 0,
    asNew: decisionCounts.new || 0,
    review: decisionCounts.review || 0,
    items: risky.slice(0, 6).map((draft) => ({
      title: draft.title,
      matchedTitle: draft.duplicateRisk?.title || "",
      action: draft.duplicateAction || "skip"
    }))
  };
}

function renderPhase19ConflictPreview(plan = phase19ImportPreview) {
  const preview = buildPhase19ConflictPreview(plan);
  if (!preview.total) return "";
  return `
    <div class="phase19-conflict-preview">
      <span><b>${escapeHtml(preview.total)}</b><small>疑似重复</small></span>
      <span><b>${escapeHtml(preview.skip)}</b><small>跳过</small></span>
      <span><b>${escapeHtml(preview.asNew)}</b><small>作为新展品</small></span>
      <span><b>${escapeHtml(preview.review)}</b><small>待复核</small></span>
      <small>${preview.items.map((item) => `${item.title} -> ${item.matchedTitle || item.action}`).join(" / ")}</small>
    </div>
  `;
}

function buildPhase19BatchComparison(batches = phase19ImportBatches) {
  const active = batches.filter((batch) => batch.status !== "failed").slice(0, 2);
  if (active.length < 2) return null;
  const [latest, previous] = active;
  const latestTitles = new Set((latest.titles || []).map((title) => String(title).toLowerCase()));
  const overlap = (previous.titles || []).filter((title) => latestTitles.has(String(title).toLowerCase()));
  return {
    latestName: latest.name || latest.id,
    previousName: previous.name || previous.id,
    scoreDelta: (latest.quality?.averageScore || 0) - (previous.quality?.averageScore || 0),
    countDelta: (latest.count || 0) - (previous.count || 0),
    overlap
  };
}

function getPhase19FilteredBatches() {
  const value = phase19BatchFilter || elements.phase19BatchFilter?.value || "all";
  const searched = phase19ImportBatches.filter((batch) => {
    const keyword = String(phase19AuditSearch || elements.phase19AuditSearch?.value || "").trim().toLowerCase();
    if (!keyword) return true;
    const haystack = [
      batch.id,
      batch.name,
      batch.format,
      ...(batch.titles || []),
      ...(batch.draftSummaries || []).map((item) => item.title),
      ...(batch.cleanupQueue || []).map((item) => `${item.title} ${item.reason}`),
      ...(batch.conflictReviewItems || []).map((item) => `${item.title} ${item.matchedTitle}`)
    ].join(" ").toLowerCase();
    return haystack.includes(keyword);
  });
  if (value === "active") return searched.filter((batch) => batch.status === "active");
  if (value === "failed") return searched.filter((batch) => batch.status === "failed");
  if (value === "needs-review") return searched.filter((batch) => (batch.quality?.needsReviewCount || 0) > 0);
  if (value === "duplicate") return searched.filter((batch) => (batch.conflictSummary?.duplicateRiskCount || 0) > 0);
  return searched;
}

function renderPhase19BatchFilters(filtered = getPhase19FilteredBatches()) {
  return `
    <div class="phase19-batch-filters">
      <span><b>${escapeHtml(filtered.length)}</b><small>当前批次</small></span>
      <span><b>${escapeHtml(phase19ImportBatches.filter((batch) => batch.status === "active").length)}</b><small>有效</small></span>
      <span><b>${escapeHtml(phase19ImportBatches.filter((batch) => (batch.conflictSummary?.duplicateRiskCount || 0) > 0).length)}</b><small>含重复风险</small></span>
      <small>筛选：${escapeHtml(phase19BatchFilter || "all")}</small>
    </div>
  `;
}

function renderPhase19BatchComparison(batches = phase19ImportBatches) {
  const comparison = buildPhase19BatchComparison(batches);
  if (!comparison) return "";
  const scoreLabel = comparison.scoreDelta > 0 ? `+${comparison.scoreDelta}` : String(comparison.scoreDelta);
  const countLabel = comparison.countDelta > 0 ? `+${comparison.countDelta}` : String(comparison.countDelta);
  return `
    <div class="phase19-batch-comparison">
      <span><b>${escapeHtml(scoreLabel)}</b><small>质量变化</small></span>
      <span><b>${escapeHtml(countLabel)}</b><small>数量变化</small></span>
      <span><b>${escapeHtml(comparison.overlap.length)}</b><small>标题重叠</small></span>
      <small>${escapeHtml(comparison.latestName)} 对比 ${escapeHtml(comparison.previousName)}</small>
    </div>
  `;
}

function buildPhase19ImportReport(batches = getPhase19FilteredBatches()) {
  const active = batches.filter((batch) => batch.status !== "reverted");
  const imported = active.reduce((sum, batch) => sum + (batch.count || batch.importedIds?.length || 0), 0);
  const reviewItems = active.reduce((sum, batch) => sum + (batch.conflictReviewItems || []).filter((item) => item.status !== "resolved" && item.status !== "ignored").length, 0);
  const cleanupItems = active.reduce((sum, batch) => sum + (batch.cleanupQueue || []).filter((item) => item.status !== "done").length, 0);
  const avgQuality = active.length
    ? Math.round(active.reduce((sum, batch) => sum + (batch.quality?.averageScore || 0), 0) / active.length)
    : 0;
  return {
    batchCount: active.length,
    imported,
    avgQuality,
    reviewItems,
    cleanupItems,
    failed: batches.filter((batch) => batch.status === "failed").length,
    recommendation: reviewItems || cleanupItems
      ? "建议先处理冲突复核和导入后整理队列，再继续导入下一批资料。"
      : "当前筛选范围内导入状态较稳定，可以继续导入或导出审计包。"
  };
}

function renderPhase19ImportReport(batches = getPhase19FilteredBatches()) {
  if (!phase19ImportBatches.length) return "";
  const report = buildPhase19ImportReport(batches);
  return `
    <div class="phase19-import-report">
      <span><b>${escapeHtml(report.batchCount)}</b><small>报告批次</small></span>
      <span><b>${escapeHtml(report.imported)}</b><small>导入展品</small></span>
      <span><b>${escapeHtml(report.avgQuality)}</b><small>平均质量</small></span>
      <span><b>${escapeHtml(report.reviewItems)}</b><small>复核项</small></span>
      <span><b>${escapeHtml(report.cleanupItems)}</b><small>整理项</small></span>
      <small>${escapeHtml(report.recommendation)}</small>
    </div>
  `;
}

function buildPhase19ConflictReviewDesk(batches = phase19ImportBatches) {
  const items = batches.flatMap((batch) => (batch.conflictReviewItems || []).map((item) => ({
    ...item,
    batchId: batch.id,
    batchName: batch.name || batch.id,
    batchStatus: batch.status || "active"
  })));
  const pending = items.filter((item) => ["review", "skip"].includes(item.action) && item.status !== "resolved");
  return {
    total: items.length,
    pendingCount: pending.length,
    importedAsNew: items.filter((item) => item.action === "new").length,
    skipped: items.filter((item) => item.action === "skip").length,
    review: items.filter((item) => item.action === "review").length,
    items: pending.slice(0, 6)
  };
}

function renderPhase19ConflictReviewDesk() {
  const desk = buildPhase19ConflictReviewDesk();
  if (!desk.total) return "";
  return `
    <div class="phase19-review-desk">
      <div>
        <strong>冲突复核台</strong>
        <small>集中回看被跳过或保留待复核的疑似重复资料。</small>
      </div>
      <div class="phase19-review-strip">
        <span><b>${escapeHtml(desk.pendingCount)}</b><small>待复核</small></span>
        <span><b>${escapeHtml(desk.importedAsNew)}</b><small>作为新展品</small></span>
        <span><b>${escapeHtml(desk.skipped)}</b><small>跳过</small></span>
        <span><b>${escapeHtml(desk.review)}</b><small>保留</small></span>
      </div>
      ${desk.items.map((item) => `
        <article>
          <b>${escapeHtml(item.title || "未命名资料")}</b>
          <small>${escapeHtml(item.batchName)} / 匹配：${escapeHtml(item.matchedTitle || item.matchedId || "现有展品")}</small>
          <span>${escapeHtml(item.action === "skip" ? "已跳过，建议确认是否需要重新导入" : "保留待复核，建议补充字段后再导入")}</span>
          <div class="phase19-review-actions">
            <button type="button" data-phase19-review-status="${escapeHtml(item.id)}" data-phase19-review-batch="${escapeHtml(item.batchId)}" data-phase19-review-next="resolved">已处理</button>
            <button type="button" data-phase19-review-status="${escapeHtml(item.id)}" data-phase19-review-batch="${escapeHtml(item.batchId)}" data-phase19-review-next="ignored">忽略</button>
            <button type="button" data-phase19-review-status="${escapeHtml(item.id)}" data-phase19-review-batch="${escapeHtml(item.batchId)}" data-phase19-review-next="queued">加入整理</button>
          </div>
        </article>
      `).join("")}
    </div>
  `;
}

function updatePhase19ConflictReviewStatus(batchId, itemId, status) {
  const batch = phase19ImportBatches.find((item) => item.id === batchId);
  if (!batch) return false;
  const nextStatus = ["resolved", "ignored", "queued"].includes(status) ? status : "resolved";
  let target = null;
  batch.conflictReviewItems = (batch.conflictReviewItems || []).map((item) => {
    if (item.id !== itemId) return item;
    target = item;
    return { ...item, status: nextStatus, resolvedAt: new Date().toISOString() };
  });
  if (target && nextStatus === "queued") {
    batch.cleanupQueue = [
      ...(batch.cleanupQueue || []),
      {
        id: `phase19-cleanup-conflict-${simpleChecksum(`${batchId}:${itemId}`).slice(0, 10)}`,
        memoryId: target.id,
        title: target.title,
        reason: "冲突复核",
        priority: "high",
        status: "queued",
        recommendation: "该资料曾被判定为疑似重复，建议人工确认后再决定是否重新导入。"
      }
    ].slice(0, 16);
  }
  persistPhase19ImportBatches();
  renderPhase19ImportPreview(phase19ImportPreview);
  return Boolean(target);
}

function buildPhase19CleanupQueue(batches = phase19ImportBatches) {
  const items = batches.flatMap((batch) => (batch.cleanupQueue || []).map((item) => ({
    ...item,
    batchId: batch.id,
    batchName: batch.name || batch.id,
    batchStatus: batch.status || "active"
  })));
  const active = items.filter((item) => item.status !== "done" && item.batchStatus !== "reverted");
  return {
    total: items.length,
    activeCount: active.length,
    highCount: active.filter((item) => item.priority === "high").length,
    byReason: active.reduce((acc, item) => {
      acc[item.reason] = (acc[item.reason] || 0) + 1;
      return acc;
    }, {}),
    items: active.slice(0, 6)
  };
}

function renderPhase19CleanupQueue() {
  const queue = buildPhase19CleanupQueue();
  if (!queue.total) return "";
  return `
    <div class="phase19-cleanup-queue">
      <div>
        <strong>导入后整理队列</strong>
        <small>把缺字段、低分草稿和冲突复核集中成下一步整理清单。</small>
      </div>
      <div class="phase19-review-strip">
        <span><b>${escapeHtml(queue.activeCount)}</b><small>待整理</small></span>
        <span><b>${escapeHtml(queue.highCount)}</b><small>高优先级</small></span>
        <span><b>${escapeHtml(Object.keys(queue.byReason).length)}</b><small>问题类型</small></span>
      </div>
      ${queue.items.map((item) => `
        <article>
          <b>${escapeHtml(item.title || item.memoryId || "未命名展品")}</b>
          <small>${escapeHtml(item.batchName)} / ${escapeHtml(item.reason || "待补全")}</small>
          <span>${escapeHtml(item.recommendation || "交给第十八阶段长期助理继续补全。")}</span>
        </article>
      `).join("")}
    </div>
  `;
}

function buildPhase19BatchAuditPackage(batch) {
  if (!batch) return null;
  return {
    schemaVersion: SCHEMA_VERSION,
    phase: 19,
    exportedAt: new Date().toISOString(),
    auditType: "phase19-import-batch",
    batch: {
      id: batch.id,
      name: batch.name,
      createdAt: batch.createdAt,
      status: batch.status,
      storage: batch.storage,
      format: batch.format,
      cleanupMode: batch.cleanupMode,
      count: batch.count,
      importedIds: batch.importedIds || [],
      titles: batch.titles || [],
      quality: batch.quality || {},
      conflictSummary: batch.conflictSummary || {},
      draftSummaries: batch.draftSummaries || [],
      conflictReviewItems: batch.conflictReviewItems || [],
      cleanupQueue: batch.cleanupQueue || [],
      itemRollbacks: batch.itemRollbacks || [],
      failedItems: batch.failedItems || [],
      followupTaskIds: batch.followupTaskIds || []
    },
    recommendation: "用于复盘某次外部资料导入的质量、冲突处理、撤销和后续整理任务。"
  };
}

function exportPhase19BatchAudit(batchId) {
  const batch = phase19ImportBatches.find((item) => item.id === batchId);
  const payload = buildPhase19BatchAuditPackage(batch);
  if (!payload) {
    setStorageStatus("未找到可导出的第十九阶段导入批次。", "warning");
    return;
  }
  downloadJsonPayload(payload, `memory-museum-phase19-audit-${batch.id}.json`);
  setStorageStatus(`已导出第十九阶段批次审计包：${batch.name || batch.id}`, "success");
}

function buildPhase19ImportPreview({ text = "", format = "auto", defaultSource = "日记", defaultHall = "auto", cleanupMode = "balanced", mappingTemplate = "auto" } = {}) {
  const detectedFormat = detectPhase19ImportFormat(text, format);
  const template = getPhase19MappingTemplate(mappingTemplate, detectedFormat);
  const segments = splitPhase19ImportText(text, detectedFormat, cleanupMode).slice(0, 30);
  const fieldSources = getPhase19FieldSources(text, detectedFormat);
  const drafts = annotatePhase19DuplicateRisks(segments.map((segment, index) => {
    const mappedSegment = applyPhase19FieldAliases({ ...segment, fieldSource: segment.fieldSource || fieldSources[index] }, template);
    const rawContent = limitText(mappedSegment.rawContent || mappedSegment.title, fieldLimits.rawContent);
    const analysis = mockAnalyzeMemory(rawContent || mappedSegment.title || "");
    const sourceType = sourceTypes.includes(mappedSegment.sourceType) ? mappedSegment.sourceType : defaultSource;
    const hall = defaultHall && defaultHall !== "auto" ? defaultHall : analysis.hall;
    Object.assign(segment, {
      title: mappedSegment.title,
      rawContent: mappedSegment.rawContent,
      date: mappedSegment.date,
      location: mappedSegment.location,
      people: mappedSegment.people,
      tags: mappedSegment.tags,
      sourceType: mappedSegment.sourceType,
      sourceTrace: mappedSegment.sourceTrace
    });
    return normalizeMemory({
      id: `phase19-import-${Date.now()}-${index}-${simpleChecksum(`${mappedSegment.title}:${rawContent}`).slice(0, 8)}`,
      title: limitText(segment.title && !/^(文本片段|聊天片段|CSV 片段|Markdown 片段)/.test(segment.title) ? segment.title : analysis.title, fieldLimits.title),
      hall,
      rawContent,
      exhibitText: analysis.exhibitText,
      date: segment.date || "",
      location: segment.location || analysis.location || "",
      people: segment.people || analysis.people || [],
      tags: [...normalizeList(segment.tags || analysis.tags), "外部导入", detectedFormat].filter(Boolean),
      emotions: analysis.emotions,
      emotionIntensity: analysis.emotionIntensity,
      sourceType,
      importance: analysis.importance,
      favorite: analysis.favorite,
      mediaNote: [analysis.mediaNote, `第十九阶段导入来源：${segment.sourceTrace || `${detectedFormat} 第 ${index + 1} 段`}`].filter(Boolean).join("\n")
    });
    return {
      ...applyPhase19MappingTemplate(draft, mappingTemplate, detectedFormat),
      selected: true,
      importTrace: segment.sourceTrace || `${detectedFormat} 第 ${index + 1} 段`
    };
  }));
  const missingContent = segments.filter((item) => !String(item.rawContent || "").trim()).length;
  const duplicateTitles = drafts.length - new Set(drafts.map((item) => item.title)).size;
  const plan = {
    phase: 19,
    mode: "external-import-preview",
    detectedFormat,
    cleanupMode,
    sourceLength: String(text || "").length,
    segmentCount: segments.length,
    draftCount: drafts.length,
    drafts,
    mapping: {
      defaultSource,
      defaultHall,
    cleanupMode,
    mappingTemplate,
    templateLabel: template.label,
      templateRules: {
        people: normalizeList(template.people),
        dateRule: template.dateRule || "",
        tags: normalizeList(template.tags)
      },
      title: "title/name/标题 或自动生成",
      rawContent: "rawContent/content/text/正文/内容 或段落正文",
      date: "date/日期",
      location: "location/地点",
      people: "people/人物",
      tags: "tags/标签"
    },
    quality: {
      ready: drafts.length > 0 && !missingContent,
      missingContent,
      duplicateTitles,
      duplicateRiskCount: drafts.filter((item) => item.duplicateRisk?.level === "high").length,
      selectedCount: drafts.filter((item) => item.selected !== false).length,
      recommendation: drafts.length
        ? "先检查标题、日期、人物和地点，再导入为展品草稿；导入后第十八阶段长期助理会继续给出补全建议。"
        : "粘贴日记、Markdown、CSV、JSON 或聊天记录后再生成预览。"
    }
  };
  localStorage.setItem(PHASE19_IMPORT_PREVIEW_KEY, JSON.stringify({ ...plan, drafts: drafts.slice(0, 10) }));
  return plan;
}

function buildPhase19ImportPlan(items = memories) {
  return {
    phase: 19,
    phaseName: "个人知识生态和外部导入版",
    mode: "external-source-preview-first",
    supportedFormats: ["text", "markdown", "csv", "json", "chat"],
    cleanupFeatures: ["delimiter-detection", "chat-speaker-grouping", "draft-selection", "draft-field-editing", "field-mapping-template", "custom-mapping-template", "mapping-template-persistence", "template-rule-defaults", "field-alias-rules", "batch-naming", "duplicate-precheck", "duplicate-decision", "conflict-preview", "conflict-review-desk", "review-status-flow", "cross-batch-compare", "batch-filter-compare", "audit-search", "import-report-view", "post-import-cleanup-queue", "batch-audit-export", "import-quality-score", "batch-detail", "source-trace", "import-batch-history", "batch-rollback", "item-rollback", "failed-item-retention", "phase18-followup-task", "followup-task-status", "quality-trend"],
    importEndpoint: "/api/imports/preview",
    applyEndpoint: "/api/memories/import",
    currentMemories: items.length,
    safety: {
      previewBeforeWrite: true,
      silentOverwrite: false,
      inheritsPhase16ConflictPolicy: true,
      afterImportAssistant: "phase18LongTermAgent"
    },
    recommendation: "先用导入预览拆分外部资料，确认字段后再写入展品库；写入后交给第十八阶段长期助理继续补全。"
  };
}

function loadPhase19ImportBatches() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PHASE19_IMPORT_BATCHES_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.slice(0, 12) : [];
  } catch {
    return [];
  }
}

function persistPhase19ImportBatches() {
  localStorage.setItem(PHASE19_IMPORT_BATCHES_KEY, JSON.stringify(phase19ImportBatches.slice(0, 12)));
}

function updatePhase19ImportPreviewStorage() {
  if (!phase19ImportPreview) return;
  localStorage.setItem(PHASE19_IMPORT_PREVIEW_KEY, JSON.stringify({
    ...phase19ImportPreview,
    drafts: phase19ImportPreview.drafts.slice(0, 10)
  }));
}

function normalizePhase19DraftField(field, value) {
  if (["people", "tags", "emotions"].includes(field)) return normalizeList(value);
  if (field === "hall") return halls.some((hall) => hall.id === value) ? value : "daily";
  if (field === "emotionIntensity" || field === "importance") return Math.min(5, Math.max(1, Number(value) || 1));
  if (field === "favorite") return parseBoolean(value);
  return String(value || "").trim();
}

function updatePhase19DraftField(index, field, value) {
  if (!phase19ImportPreview?.drafts?.[index]) return;
  const previous = phase19ImportPreview.drafts[index];
  const next = normalizeMemory({
    ...previous,
    [field]: normalizePhase19DraftField(field, value)
  });
  next.selected = previous.selected !== false;
  next.importTrace = previous.importTrace || `${phase19ImportPreview.detectedFormat} 第 ${index + 1} 段`;
  phase19ImportPreview.drafts[index] = next;
  updatePhase19ImportPreviewStorage();
}

function buildPhase19DraftQuality(draft = {}) {
  const checks = [
    { id: "title", label: "标题", ok: Boolean(String(draft.title || "").trim()) },
    { id: "rawContent", label: "正文", ok: String(draft.rawContent || draft.exhibitText || "").trim().length >= 12 },
    { id: "date", label: "日期", ok: Boolean(String(draft.date || "").trim()) },
    { id: "location", label: "地点", ok: Boolean(String(draft.location || "").trim()) },
    { id: "people", label: "人物", ok: Array.isArray(draft.people) && draft.people.length > 0 },
    { id: "tags", label: "标签", ok: Array.isArray(draft.tags) && draft.tags.length >= 2 }
  ];
  const missing = checks.filter((item) => !item.ok);
  const score = Math.round(((checks.length - missing.length) / checks.length) * 100);
  return {
    score,
    status: score >= 84 ? "ready" : score >= 60 ? "review" : "needs-work",
    missing: missing.map((item) => item.id),
    labels: missing.map((item) => item.label),
    recommendation: missing.length
      ? `建议补全：${missing.map((item) => item.label).join("、")}`
      : "字段完整度较好，可导入后继续交给长期助理维护。"
  };
}

function summarizePhase19DraftQuality(drafts = []) {
  const qualities = drafts.map(buildPhase19DraftQuality);
  const averageScore = qualities.length
    ? Math.round(qualities.reduce((sum, item) => sum + item.score, 0) / qualities.length)
    : 0;
  const needsReviewCount = qualities.filter((item) => item.status !== "ready").length;
  const issueCounts = qualities.flatMap((item) => item.labels).reduce((acc, label) => {
    acc[label] = (acc[label] || 0) + 1;
    return acc;
  }, {});
  return {
    averageScore,
    needsReviewCount,
    readyCount: qualities.filter((item) => item.status === "ready").length,
    issueCounts,
    topIssues: Object.entries(issueCounts).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([label, count]) => ({ label, count }))
  };
}

function createPhase19FollowupTasks(batch, drafts = []) {
  if (!batch?.id) return [];
  const importedIdSet = new Set(batch.importedIds || []);
  const tasks = drafts
    .map((draft, index) => {
      const quality = buildPhase19DraftQuality(draft);
      const memoryId = batch.importedIds?.[index] || draft.id;
      if (quality.status === "ready" || !importedIdSet.has(memoryId)) return null;
      return normalizePhase18Task({
        id: `phase18-task-phase19-${batch.id}-${simpleChecksum(memoryId).slice(0, 8)}`,
        status: quality.status === "needs-work" ? "reviewing" : "queued",
        label: `补全导入展品：${draft.title || memoryId}`,
        source: "phase19-import",
        priority: quality.status === "needs-work" ? "high" : "medium",
        memoryIds: [memoryId],
        detail: `${quality.recommendation}；来源批次 ${batch.id}`
      });
    })
    .filter(Boolean);
  if (!tasks.length) return [];
  const existing = loadPhase18TaskQueue();
  const existingIds = new Set(existing.map((task) => task.id));
  const fresh = tasks.filter((task) => !existingIds.has(task.id));
  if (fresh.length) {
    savePhase18TaskQueue([...fresh, ...existing].slice(0, 80));
    recordPhase18TaskAudit("phase19-import-followup-created", batch.id, `第十九阶段导入后生成 ${fresh.length} 条补全任务。`, {
      batchId: batch.id,
      taskCount: fresh.length,
      memoryIds: fresh.flatMap((task) => task.memoryIds || [])
    });
  }
  return fresh;
}

function getPhase19FollowupTaskSummary(batch = {}) {
  const ids = new Set(batch.followupTaskIds || []);
  const tasks = loadPhase18TaskQueue().filter((task) => ids.has(task.id));
  const byStatus = tasks.reduce((acc, task) => {
    acc[task.status] = (acc[task.status] || 0) + 1;
    return acc;
  }, {});
  return {
    total: tasks.length,
    active: tasks.filter((task) => ["queued", "reviewing", "failed"].includes(task.status)).length,
    completed: tasks.filter((task) => task.status === "applied").length,
    dismissed: tasks.filter((task) => task.status === "dismissed").length,
    byStatus
  };
}

function buildPhase19QualityTrend(batches = phase19ImportBatches) {
  const scored = batches.filter((batch) => typeof batch.quality?.averageScore === "number");
  if (!scored.length) return null;
  const active = scored.filter((batch) => batch.status !== "failed");
  const latest = active[0] || scored[0];
  const previous = active[1];
  const average = Math.round(active.reduce((sum, batch) => sum + (batch.quality?.averageScore || 0), 0) / Math.max(1, active.length));
  const delta = previous ? (latest.quality.averageScore || 0) - (previous.quality.averageScore || 0) : 0;
  return {
    latestScore: latest.quality?.averageScore || 0,
    averageScore: average,
    delta,
    failedCount: batches.filter((batch) => batch.status === "failed").length,
    reviewCount: active.reduce((sum, batch) => sum + (batch.quality?.needsReviewCount || 0), 0)
  };
}

function renderPhase19QualityTrend() {
  const trend = buildPhase19QualityTrend();
  if (!trend) return "";
  const deltaLabel = trend.delta > 0 ? `+${trend.delta}` : String(trend.delta);
  return `
    <div class="phase19-quality-trend">
      <span><b>${escapeHtml(trend.latestScore)}</b><small>最近批次</small></span>
      <span><b>${escapeHtml(trend.averageScore)}</b><small>平均分</small></span>
      <span><b>${escapeHtml(deltaLabel)}</b><small>较上批</small></span>
      <span><b>${escapeHtml(trend.reviewCount)}</b><small>待补全</small></span>
      <span><b>${escapeHtml(trend.failedCount)}</b><small>失败批次</small></span>
    </div>
  `;
}

function togglePhase19BatchDetail(batchId) {
  activePhase19BatchId = activePhase19BatchId === batchId ? "" : batchId;
  renderPhase19ImportPreview(phase19ImportPreview);
}

function createPhase19ImportBatchRecord(drafts = [], result = {}) {
  const importedIds = Array.isArray(result.importedIds) && result.importedIds.length
    ? result.importedIds
    : drafts.map((draft) => draft.id).filter(Boolean);
  const quality = summarizePhase19DraftQuality(drafts);
  const createdAt = new Date().toISOString();
  const previewDrafts = phase19ImportPreview?.drafts || drafts;
  const conflictReviewItems = previewDrafts
    .filter((draft) => draft.duplicateRisk?.level === "high")
    .map((draft) => ({
      id: draft.id,
      title: draft.title,
      matchedId: draft.duplicateRisk?.memoryId || "",
      matchedTitle: draft.duplicateRisk?.title || "",
      action: draft.duplicateAction || "skip",
      status: draft.duplicateAction === "new" ? "imported" : "pending",
      reason: draft.duplicateRisk?.reason || ""
    })).slice(0, 12);
  const cleanupQueue = drafts.map((draft, index) => {
    const itemQuality = buildPhase19DraftQuality(draft);
    if (itemQuality.status === "ready") return null;
    return {
      id: `phase19-cleanup-${simpleChecksum(`${importedIds[index] || draft.id}:${itemQuality.score}`).slice(0, 10)}`,
      memoryId: importedIds[index] || draft.id,
      title: draft.title,
      reason: itemQuality.labels.join("、") || "字段待补全",
      priority: itemQuality.status === "needs-work" ? "high" : "medium",
      status: "queued",
      recommendation: itemQuality.recommendation
    };
  }).filter(Boolean).slice(0, 12);
  return {
    id: `phase19-batch-${createdAt.replace(/[-:.TZ]/g, "").slice(0, 14)}-${simpleChecksum(importedIds.join("|")).slice(0, 6)}`,
    name: limitText(elements.phase19BatchName?.value || `导入批次 ${createdAt.slice(0, 10)}`, 60),
    createdAt,
    status: "active",
    storage: databaseAvailable ? "sqlite" : "browser",
    format: phase19ImportPreview?.detectedFormat || "unknown",
    cleanupMode: phase19ImportPreview?.cleanupMode || "balanced",
    count: importedIds.length,
    importedIds,
    titles: drafts.map((draft) => draft.title).filter(Boolean).slice(0, 6),
    quality,
    conflictSummary: {
      duplicateRiskCount: conflictReviewItems.length,
      importedAsNewCount: drafts.filter((draft) => draft.duplicateAction === "new" && draft.duplicateRisk?.level === "high").length,
      skippedCount: previewDrafts.filter((draft) => draft.duplicateAction === "skip").length || 0,
      reviewCount: previewDrafts.filter((draft) => draft.duplicateAction === "review").length || 0
    },
    draftSummaries: drafts.map((draft, index) => ({
      id: importedIds[index] || draft.id,
      title: draft.title,
      quality: buildPhase19DraftQuality(draft),
      importTrace: draft.importTrace || "",
      duplicateAction: draft.duplicateAction || "new",
      status: "active"
    })).slice(0, 12),
    failedItems: [],
    itemRollbacks: [],
    conflictReviewItems,
    cleanupQueue,
    followupTaskIds: []
  };
}

function createPhase19FailedImportBatch(drafts = [], error = {}) {
  const createdAt = new Date().toISOString();
  const conflictReviewItems = drafts
    .filter((draft) => draft.duplicateRisk?.level === "high")
    .map((draft) => ({
      id: draft.id,
      title: draft.title,
      matchedId: draft.duplicateRisk?.memoryId || "",
      matchedTitle: draft.duplicateRisk?.title || "",
      action: draft.duplicateAction || "review",
      status: "pending",
      reason: draft.duplicateRisk?.reason || ""
    })).slice(0, 12);
  return {
    id: `phase19-failed-${createdAt.replace(/[-:.TZ]/g, "").slice(0, 14)}-${simpleChecksum(`${error.message || "failed"}:${drafts.length}`).slice(0, 6)}`,
    name: limitText(elements.phase19BatchName?.value || `失败批次 ${createdAt.slice(0, 10)}`, 60),
    createdAt,
    status: "failed",
    storage: databaseAvailable ? "sqlite" : "browser",
    format: phase19ImportPreview?.detectedFormat || "unknown",
    cleanupMode: phase19ImportPreview?.cleanupMode || "balanced",
    count: 0,
    importedIds: [],
    titles: drafts.map((draft) => draft.title).filter(Boolean).slice(0, 6),
    quality: summarizePhase19DraftQuality(drafts),
    conflictSummary: {
      duplicateRiskCount: drafts.filter((draft) => draft.duplicateRisk?.level === "high").length,
      importedAsNewCount: 0,
      skippedCount: drafts.filter((draft) => draft.duplicateAction === "skip").length,
      reviewCount: drafts.filter((draft) => draft.duplicateAction === "review").length
    },
    draftSummaries: drafts.map((draft) => ({
      id: draft.id,
      title: draft.title,
      quality: buildPhase19DraftQuality(draft),
      importTrace: draft.importTrace || "",
      status: "failed",
      error: error.message || "import failed"
    })).slice(0, 12),
    failedItems: drafts.map((draft) => ({ id: draft.id, title: draft.title, error: error.message || "import failed" })).slice(0, 12),
    itemRollbacks: [],
    conflictReviewItems,
    cleanupQueue: drafts.map((draft) => ({
      id: `phase19-cleanup-failed-${simpleChecksum(draft.id).slice(0, 10)}`,
      memoryId: draft.id,
      title: draft.title,
      reason: "导入失败",
      priority: "high",
      status: "queued",
      recommendation: error.message || "保留失败项，修复后重新导入。"
    })).slice(0, 12),
    followupTaskIds: []
  };
}

function recordPhase19ImportBatch(record) {
  if (!record?.importedIds?.length && !record?.failedItems?.length) return;
  phase19ImportBatches = [record, ...phase19ImportBatches.filter((batch) => batch.id !== record.id)].slice(0, 12);
  persistPhase19ImportBatches();
}

function renderPhase19BatchHistory() {
  if (!phase19ImportBatches.length) return "";
  return `
    <div class="phase19-batch-history">
      <div class="phase19-batch-heading">
        <strong>最近导入批次</strong>
        <small>可撤销仍存在的批次展品</small>
      </div>
      ${phase19ImportBatches.slice(0, 4).map((batch) => `
        <article data-status="${escapeHtml(batch.status || "active")}">
          <span>
            <b>${escapeHtml(batch.count || batch.importedIds?.length || 0)} 件</b>
            <small>${escapeHtml(batch.format || "unknown")} / ${escapeHtml(batch.cleanupMode || "balanced")}</small>
          </span>
          <small>${escapeHtml((batch.titles || []).join("、") || batch.id)}</small>
          <button type="button" data-phase19-rollback="${escapeHtml(batch.id)}" ${batch.status === "reverted" ? "disabled" : ""}>${batch.status === "reverted" ? "已撤销" : "撤销批次"}</button>
        </article>
      `).join("")}
    </div>
  `;
}

function renderPhase19BatchHistoryV4() {
  if (!phase19ImportBatches.length) return "";
  return `
    <div class="phase19-batch-history">
      <div class="phase19-batch-heading">
        <strong>最近导入批次</strong>
        <small>查看质量、补全任务和撤销状态</small>
      </div>
      ${phase19ImportBatches.slice(0, 4).map((batch) => `
        <article data-status="${escapeHtml(batch.status || "active")}">
          <span>
            <b>${escapeHtml(batch.count || batch.importedIds?.length || 0)} 件</b>
            <small>${escapeHtml(batch.format || "unknown")} / ${escapeHtml(batch.cleanupMode || "balanced")}</small>
          </span>
          <span>
            <b>${escapeHtml(batch.quality?.averageScore ?? "-")} 分</b>
            <small>${escapeHtml(batch.quality?.needsReviewCount || 0)} 件待补全</small>
          </span>
          <small>${escapeHtml((batch.titles || []).join("、") || batch.id)}</small>
          <button type="button" data-phase19-batch-toggle="${escapeHtml(batch.id)}">${activePhase19BatchId === batch.id ? "收起详情" : "查看详情"}</button>
          <button type="button" data-phase19-rollback="${escapeHtml(batch.id)}" ${batch.status === "reverted" ? "disabled" : ""}>${batch.status === "reverted" ? "已撤销" : "撤销批次"}</button>
        </article>
        ${activePhase19BatchId === batch.id ? `
          <div class="phase19-batch-detail">
            ${(batch.draftSummaries || []).map((item) => `
              <span data-quality="${escapeHtml(item.quality?.status || "review")}">
                <b>${escapeHtml(item.title || item.id)}</b>
                <small>${escapeHtml(item.quality?.score ?? "-")} 分 / ${escapeHtml(item.quality?.recommendation || "等待复核")}</small>
              </span>
            `).join("")}
            ${(batch.followupTaskIds || []).length ? `<small>已生成第十八阶段补全任务：${escapeHtml(batch.followupTaskIds.length)} 条</small>` : ""}
          </div>
        ` : ""}
      `).join("")}
    </div>
  `;
}

function renderPhase19BatchHistoryV5() {
  if (!phase19ImportBatches.length) return "";
  const filteredBatches = getPhase19FilteredBatches();
  return `
    <div class="phase19-batch-history">
      <div class="phase19-batch-heading">
        <strong>最近导入批次</strong>
        <small>质量趋势、失败项、补全任务和撤销状态</small>
      </div>
      ${renderPhase19BatchFilters(filteredBatches)}
      ${renderPhase19ImportReport(filteredBatches)}
      ${renderPhase19QualityTrend()}
      ${renderPhase19BatchComparison(filteredBatches)}
      ${renderPhase19CleanupQueue()}
      ${renderPhase19ConflictReviewDesk()}
      ${filteredBatches.slice(0, 4).map((batch) => {
        const taskSummary = getPhase19FollowupTaskSummary(batch);
        return `
          <article data-status="${escapeHtml(batch.status || "active")}">
            <span>
              <b>${escapeHtml(batch.count || batch.importedIds?.length || 0)} 件</b>
              <small>${escapeHtml(batch.format || "unknown")} / ${escapeHtml(batch.cleanupMode || "balanced")}</small>
            </span>
            <span>
              <b>${escapeHtml(batch.quality?.averageScore ?? "-")} 分</b>
              <small>${escapeHtml(batch.quality?.needsReviewCount || 0)} 件待补全</small>
            </span>
            <span>
              <b>${escapeHtml(taskSummary.active)}</b>
              <small>活跃补全任务</small>
            </span>
            <span>
              <b>${escapeHtml(batch.conflictSummary?.duplicateRiskCount || 0)}</b>
              <small>重复风险</small>
            </span>
            <small>${escapeHtml(batch.name || (batch.titles || []).join("、") || batch.id)}</small>
            <button type="button" data-phase19-batch-toggle="${escapeHtml(batch.id)}">${activePhase19BatchId === batch.id ? "收起详情" : "查看详情"}</button>
            <button type="button" data-phase19-export-audit="${escapeHtml(batch.id)}">导出审计</button>
            <button type="button" data-phase19-rollback="${escapeHtml(batch.id)}" ${batch.status === "reverted" || batch.status === "failed" ? "disabled" : ""}>${batch.status === "reverted" ? "已撤销" : batch.status === "failed" ? "导入失败" : "撤销批次"}</button>
          </article>
          ${activePhase19BatchId === batch.id ? `
            <div class="phase19-batch-detail">
              ${batch.status === "failed" ? `<small>失败项已保留：${escapeHtml((batch.failedItems || []).map((item) => item.title || item.id).join("、") || "无标题草稿")}</small>` : ""}
              ${batch.conflictSummary?.duplicateRiskCount ? `<small>重复处理：跳过 ${escapeHtml(batch.conflictSummary.skippedCount || 0)} / 作为新展品 ${escapeHtml(batch.conflictSummary.importedAsNewCount || 0)} / 待复核 ${escapeHtml(batch.conflictSummary.reviewCount || 0)}</small>` : ""}
              ${(batch.cleanupQueue || []).length ? `<small>整理队列：${escapeHtml((batch.cleanupQueue || []).filter((item) => item.status !== "done").length)} 条待处理</small>` : ""}
              ${(batch.conflictReviewItems || []).length ? `<small>冲突复核：${escapeHtml((batch.conflictReviewItems || []).filter((item) => item.status !== "resolved").length)} 条未关闭</small>` : ""}
              ${(batch.draftSummaries || []).map((item) => `
                <span data-quality="${escapeHtml(item.quality?.status || "review")}" data-status="${escapeHtml(item.status || "active")}">
                  <b>${escapeHtml(item.title || item.id)}</b>
                  <small>${escapeHtml(item.quality?.score ?? "-")} 分 / ${escapeHtml(item.error || item.quality?.recommendation || "等待复核")}</small>
                  ${batch.status !== "failed" ? `<button type="button" data-phase19-item-rollback="${escapeHtml(item.id)}" data-phase19-item-batch="${escapeHtml(batch.id)}" ${item.status === "reverted" ? "disabled" : ""}>${item.status === "reverted" ? "已撤销" : "撤销单项"}</button>` : ""}
                </span>
              `).join("")}
              ${(batch.followupTaskIds || []).length ? `<small>第十八阶段补全任务：${escapeHtml(taskSummary.active)} 条活跃 / ${escapeHtml(taskSummary.completed)} 条完成 / ${escapeHtml(taskSummary.dismissed)} 条忽略</small>` : ""}
              ${(batch.itemRollbacks || []).length ? `<small>已单项撤销：${escapeHtml((batch.itemRollbacks || []).map((item) => item.title || item.id).join("、"))}</small>` : ""}
            </div>
          ` : ""}
        `;
      }).join("")}
    </div>
  `;
}

async function rollbackPhase19ImportBatch(batchId) {
  const batch = phase19ImportBatches.find((item) => item.id === batchId);
  if (!batch || batch.status === "reverted") {
    setStorageStatus("没有可撤销的第十九阶段导入批次。", "warning");
    return;
  }
  const ids = Array.isArray(batch.importedIds) ? batch.importedIds.filter(Boolean) : [];
  if (!ids.length) {
    setStorageStatus("该导入批次没有记录展品 ID，无法撤销。", "warning");
    return;
  }
  const confirmed = window.confirm(`即将撤销第十九阶段导入批次中的 ${ids.length} 件展品。是否继续？`);
  if (!confirmed) return;
  try {
    if (batch.storage === "sqlite") {
      if (!databaseAvailable) {
        setStorageStatus("该批次写入 SQLite，但当前数据库未连接，暂时无法撤销。", "warning");
        return;
      }
      for (const id of ids) await deleteMemoryFromDatabase(id);
      await loadMemoriesFromDatabase({ silent: true });
    } else {
      const idSet = new Set(ids);
      memories = memories.filter((memory) => !idSet.has(memory.id));
      persistMemories(memories);
    }
    batch.status = "reverted";
    batch.revertedAt = new Date().toISOString();
    persistPhase19ImportBatches();
    render();
    setStorageStatus(`已撤销第十九阶段导入批次：移除 ${ids.length} 件展品。`, "success");
  } catch (error) {
    setStorageStatus(`撤销第十九阶段导入批次失败：${error.message}`, "warning");
  }
}

async function rollbackPhase19ImportItem(batchId, itemId) {
  const batch = phase19ImportBatches.find((item) => item.id === batchId);
  if (!batch || batch.status === "reverted" || batch.status === "failed") {
    setStorageStatus("该第十九阶段批次没有可撤销的单项展品。", "warning");
    return;
  }
  const target = (batch.draftSummaries || []).find((item) => item.id === itemId);
  if (!target || target.status === "reverted") {
    setStorageStatus("该展品已经撤销或不在批次中。", "warning");
    return;
  }
  const confirmed = window.confirm(`即将从当前导入批次中撤销《${target.title || itemId}》。是否继续？`);
  if (!confirmed) return;
  try {
    if (batch.storage === "sqlite") {
      if (!databaseAvailable) {
        setStorageStatus("该单项写入 SQLite，但当前数据库未连接，暂时无法撤销。", "warning");
        return;
      }
      await deleteMemoryFromDatabase(itemId);
      await loadMemoriesFromDatabase({ silent: true });
    } else {
      memories = memories.filter((memory) => memory.id !== itemId);
      persistMemories(memories);
    }
    const now = new Date().toISOString();
    batch.draftSummaries = (batch.draftSummaries || []).map((item) => item.id === itemId ? { ...item, status: "reverted", revertedAt: now } : item);
    batch.itemRollbacks = [...(batch.itemRollbacks || []), { id: itemId, title: target.title || itemId, revertedAt: now }].slice(-20);
    const activeCount = (batch.draftSummaries || []).filter((item) => item.status !== "reverted").length;
    if (!activeCount) {
      batch.status = "reverted";
      batch.revertedAt = now;
    }
    persistPhase19ImportBatches();
    render();
    setStorageStatus(`已撤销第十九阶段批次内展品：${target.title || itemId}。`, "success");
  } catch (error) {
    setStorageStatus(`撤销第十九阶段批次单项失败：${error.message}`, "warning");
  }
}

function renderPhase19ImportPreview(plan = phase19ImportPreview) {
  if (!elements.phase19ImportPreview) return;
  if (!plan?.drafts?.length) {
    elements.phase19ImportPreview.innerHTML = `
      <div class="phase19-empty">
        <strong>等待外部资料</strong>
        <small>第十九阶段会先生成导入预览，不会静默写入展品库。</small>
      </div>
      ${renderPhase19BatchHistoryV5()}
    `;
    if (elements.phase19ApplyButton) elements.phase19ApplyButton.disabled = true;
    return;
  }
  if (elements.phase19ApplyButton) elements.phase19ApplyButton.disabled = false;
  const selectedCount = plan.drafts.filter((draft) => draft.selected !== false).length;
  elements.phase19ImportPreview.innerHTML = `
    <div class="phase19-import-summary">
      <span><b>${escapeHtml(plan.detectedFormat)}</b><small>识别格式</small></span>
      <span><b>${escapeHtml(plan.draftCount)}</b><small>展品草稿</small></span>
      <span><b>${escapeHtml(selectedCount)}</b><small>已选择</small></span>
      <span><b>${escapeHtml(plan.quality?.duplicateTitles || 0)}</b><small>重名标题</small></span>
      <span><b>${escapeHtml(plan.quality?.duplicateRiskCount || 0)}</b><small>疑似重复</small></span>
    </div>
    <div class="phase19-selection-tools">
      <button type="button" data-phase19-select-all>全选草稿</button>
      <button type="button" data-phase19-select-none>清空选择</button>
      <small>${escapeHtml(plan.mapping?.templateLabel || "自动模板")} / ${escapeHtml(plan.mapping?.cleanupMode || "balanced")} / ${escapeHtml(plan.quality?.missingContent || 0)} 条空内容</small>
    </div>
    <div class="phase19-template-meta">
      <span><b>${escapeHtml(phase19CustomTemplates.length)}</b><small>自定义模板</small></span>
      <small>当前模板会影响来源、展厅和标签；可用“模板标签 + 批次名称”保存下一次复用。</small>
    </div>
    ${renderPhase19ConflictPreview(plan)}
    <small>${escapeHtml(plan.quality?.recommendation || "")}</small>
    <div class="phase19-draft-list">
      ${plan.drafts.slice(0, 8).map((draft, index) => `
        <article data-selected="${draft.selected !== false ? "true" : "false"}">
          <label class="phase19-draft-select">
            <input type="checkbox" data-phase19-draft-select="${escapeHtml(index)}" ${draft.selected !== false ? "checked" : ""}>
            <strong>${escapeHtml(draft.title)}</strong>
          </label>
          <small>${escapeHtml(getHallName(draft.hall))} / ${escapeHtml(draft.sourceType)} / ${escapeHtml(draft.date || "日期待补")}</small>
          <small>${escapeHtml(draft.importTrace || "来源待确认")}</small>
          ${draft.duplicateRisk?.level === "high" ? `<small class="phase19-duplicate-risk">疑似重复：${escapeHtml(draft.duplicateRisk.title || draft.duplicateRisk.reason)}</small>` : ""}
          ${draft.duplicateRisk?.level === "high" ? `
            <label class="phase19-duplicate-action">重复处理
              <select data-phase19-duplicate-action="${escapeHtml(index)}">
                <option value="skip" ${draft.duplicateAction === "skip" ? "selected" : ""}>跳过导入</option>
                <option value="new" ${draft.duplicateAction === "new" ? "selected" : ""}>作为新展品</option>
                <option value="review" ${draft.duplicateAction === "review" ? "selected" : ""}>保留待复核</option>
              </select>
            </label>
          ` : ""}
          <div class="phase19-quality" data-quality="${escapeHtml(buildPhase19DraftQuality(draft).status)}">
            <b>${escapeHtml(buildPhase19DraftQuality(draft).score)} 分</b>
            <small>${escapeHtml(buildPhase19DraftQuality(draft).recommendation)}</small>
          </div>
          <div class="phase19-draft-editor">
            <label>标题<input data-phase19-draft-field="title" data-phase19-draft-index="${escapeHtml(index)}" value="${escapeHtml(draft.title)}" maxlength="80"></label>
            <label>日期<input data-phase19-draft-field="date" data-phase19-draft-index="${escapeHtml(index)}" value="${escapeHtml(draft.date || "")}" maxlength="20"></label>
            <label>地点<input data-phase19-draft-field="location" data-phase19-draft-index="${escapeHtml(index)}" value="${escapeHtml(draft.location || "")}" maxlength="80"></label>
            <label>人物<input data-phase19-draft-field="people" data-phase19-draft-index="${escapeHtml(index)}" value="${escapeHtml((draft.people || []).join("、"))}" maxlength="120"></label>
            <label class="wide">标签<input data-phase19-draft-field="tags" data-phase19-draft-index="${escapeHtml(index)}" value="${escapeHtml((draft.tags || []).join("、"))}" maxlength="160"></label>
            <label class="wide">正文<textarea data-phase19-draft-field="rawContent" data-phase19-draft-index="${escapeHtml(index)}" maxlength="3000">${escapeHtml(draft.rawContent || draft.exhibitText || "")}</textarea></label>
          </div>
          <div>${draft.tags.slice(0, 4).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>
        </article>
      `).join("")}
    </div>
    ${renderPhase19BatchHistoryV5()}
  `;
}

function setPhase19DraftSelection(index, selected) {
  if (!phase19ImportPreview?.drafts?.[index]) return;
  phase19ImportPreview.drafts[index].selected = selected;
  updatePhase19ImportPreviewStorage();
  renderPhase19ImportPreview(phase19ImportPreview);
}

function setAllPhase19DraftSelection(selected) {
  if (!phase19ImportPreview?.drafts?.length) return;
  phase19ImportPreview.drafts = phase19ImportPreview.drafts.map((draft) => ({ ...draft, selected }));
  updatePhase19ImportPreviewStorage();
  renderPhase19ImportPreview(phase19ImportPreview);
}

function setPhase19DuplicateAction(index, action) {
  if (!phase19ImportPreview?.drafts?.[index]) return;
  const nextAction = ["skip", "new", "review"].includes(action) ? action : "new";
  phase19ImportPreview.drafts[index] = {
    ...phase19ImportPreview.drafts[index],
    duplicateAction: nextAction,
    selected: nextAction === "new"
  };
  updatePhase19ImportPreviewStorage();
  renderPhase19ImportPreview(phase19ImportPreview);
}

function renderPhase19ImportLab() {
  if (!elements.phase19ImportSection) return;
  renderPhase19MappingTemplateOptions();
  if (elements.phase19BatchFilter) elements.phase19BatchFilter.value = phase19BatchFilter;
  renderPhase19ImportPreview(phase19ImportPreview);
}

function loadPhase19Sample() {
  if (!elements.phase19ImportText) return;
  elements.phase19ImportFormat.value = "markdown";
  elements.phase19DefaultSource.value = "日记";
  elements.phase19ImportText.value = [
    "# 外婆家的晚饭",
    "2021 年冬天，外婆把热汤端到桌上，窗外很冷，但屋里都是饭菜的香气。",
    "",
    "# 毕业前的操场",
    "我们在操场边拍了最后一张照片，大家都在笑，但心里知道以后很难再这样聚齐。"
  ].join("\n");
  setStorageStatus("已放入第十九阶段导入示例。", "success");
}

function previewPhase19Import() {
  const text = elements.phase19ImportText?.value || "";
  phase19ImportPreview = buildPhase19ImportPreview({
    text,
    format: elements.phase19ImportFormat?.value || "auto",
    defaultSource: elements.phase19DefaultSource?.value || "日记",
    defaultHall: elements.phase19DefaultHall?.value || "auto",
    cleanupMode: elements.phase19CleanupMode?.value || "balanced",
    mappingTemplate: elements.phase19MappingTemplate?.value || "auto"
  });
  renderPhase19ImportPreview(phase19ImportPreview);
  setStorageStatus(`已生成第十九阶段导入预览：${phase19ImportPreview.draftCount} 件草稿。`, phase19ImportPreview.draftCount ? "success" : "warning");
}

async function applyPhase19ImportPreview() {
  if (!phase19ImportPreview?.drafts?.length) {
    setStorageStatus("请先生成第十九阶段导入预览。", "warning");
    return;
  }
  const drafts = phase19ImportPreview.drafts
    .filter((draft) => draft.selected !== false && !["skip", "review"].includes(draft.duplicateAction))
    .map((draft) => ({
      ...normalizeMemory(draft),
      duplicateRisk: draft.duplicateRisk,
      duplicateAction: draft.duplicateAction || "new",
      importTrace: draft.importTrace || ""
    }));
  if (!drafts.length) {
    setStorageStatus("请至少选择一件第十九阶段导入草稿。", "warning");
    return;
  }
  try {
    let importResult = { importedIds: drafts.map((draft) => draft.id).filter(Boolean) };
    if (databaseAvailable) {
      const result = await importMemoriesToDatabase(drafts);
      importResult = result;
      memories = result.memories;
    } else {
      memories = [...drafts, ...memories].map(normalizeMemory);
    }
    const batchRecord = createPhase19ImportBatchRecord(drafts, importResult);
    const followupTasks = createPhase19FollowupTasks(batchRecord, drafts);
    batchRecord.followupTaskIds = followupTasks.map((task) => task.id);
    recordPhase19ImportBatch(batchRecord);
    persistMemories(memories);
    phase19ImportPreview = null;
    localStorage.removeItem(PHASE19_IMPORT_PREVIEW_KEY);
    render();
    setStorageStatus(`第十九阶段导入完成：写入 ${drafts.length} 件展品草稿。`, "success");
  } catch (error) {
    recordPhase19ImportBatch(createPhase19FailedImportBatch(drafts, error));
    renderPhase19ImportPreview(phase19ImportPreview);
    setStorageStatus(`第十九阶段导入失败：${error.message}`, "warning");
  }
}

function getAttachmentCategory(item = {}) {
  const text = `${item.type || ""} ${item.name || ""} ${item.note || ""}`.toLowerCase();
  if (/图片|照片|截图|合照|相册|image|photo|png|jpe?g|webp|gif|heic/.test(text)) return "图片";
  if (/ocr|扫描|截图文字|识别文字|文字提取|scan/.test(text)) return "OCR";
  if (/语音|录音|转写|音频|voice|audio|mp3|wav|m4a/.test(text)) return "语音";
  if (/文档|报告|笔记|pdf|docx?|txt|md|markdown/.test(text)) return "文档";
  if (/视频|录像|video|mp4|mov|avi/.test(text)) return "视频";
  return "其他";
}

function buildAttachmentTypeCounts(attachments = []) {
  return normalizeAttachments(attachments).reduce((counts, item) => {
    const category = getAttachmentCategory(item);
    counts[category] = (counts[category] || 0) + 1;
    return counts;
  }, {});
}

function sortAttachmentTypeCounts(counts = {}) {
  return Object.entries(counts).sort((a, b) => {
    const orderDelta = attachmentTypeOrder.indexOf(a[0]) - attachmentTypeOrder.indexOf(b[0]);
    return orderDelta || b[1] - a[1] || a[0].localeCompare(b[0]);
  });
}

function formatAttachmentTypeSummary(attachments = [], maxItems = 3) {
  const counts = buildAttachmentTypeCounts(attachments);
  return sortAttachmentTypeCounts(counts)
    .slice(0, maxItems)
    .map(([type, count]) => `${type} ${count}`)
    .join(" / ");
}

function loadMemories() {
  let stored = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch {
    return seedMemories.map(normalizeMemory);
  }

  if (!stored) {
    const seeded = seedMemories.map(normalizeMemory);
    persistMemories(seeded);
    return seeded;
  }

  try {
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) throw new Error("Stored memories must be an array.");
    const normalized = parsed.map(normalizeMemory);
    persistMemories(normalized);
    return normalized;
  } catch {
    const seeded = seedMemories.map(normalizeMemory);
    persistMemories(seeded);
    return seeded;
  }
}

function saveMemories(nextMemories = memories) {
  if (persistMemories(nextMemories)) return true;

  alert("保存失败：浏览器本地存储空间可能已满。可以先导出备份，再删除一些展品。");
  return false;
}

function splitList(value) {
  return value
    .split(/[,，、]/)
    .map((item) => limitText(item, fieldLimits.listItem))
    .filter(Boolean)
    .slice(0, fieldLimits.listLength);
}

function selectedEmotions() {
  return Array.from(document.querySelectorAll('input[name="emotion"]:checked')).map((item) => item.value);
}

function setSelectedEmotions(emotions) {
  document.querySelectorAll('input[name="emotion"]').forEach((item) => {
    item.checked = emotions.includes(item.value);
  });
}

function getHallName(hallId) {
  return halls.find((hall) => hall.id === hallId)?.name || "日常展厅";
}

function getImportanceLabel(value) {
  return importanceLabels[(Number(value) || 1) - 1] || importanceLabels[0];
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function pillHtml(value, className = "") {
  return `<span class="pill ${className}">${escapeHtml(value)}</span>`;
}

function buildStructuredMemory(memory) {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: memory.id,
    title: memory.title,
    hall: {
      id: memory.hall,
      name: getHallName(memory.hall)
    },
    sourceType: memory.sourceType,
    rawContent: memory.rawContent,
    exhibitText: memory.exhibitText,
    date: memory.date,
    location: memory.location,
    people: memory.people || [],
    emotions: memory.emotions || [],
    emotionIntensity: memory.emotionIntensity,
    tags: memory.tags || [],
    importance: memory.importance,
    importanceLabel: getImportanceLabel(memory.importance),
    favorite: memory.favorite,
    coverImage: memory.coverImage || "",
    mediaNote: memory.mediaNote || "",
    attachments: Array.isArray(memory.attachments) ? memory.attachments : [],
    agentRunId: memory.agentRunId || "",
    createdAt: memory.createdAt,
    updatedAt: memory.updatedAt || ""
  };
}

function buildCollectionExport() {
  const exportedAt = new Date().toISOString();
  return {
    app: "AI 记忆博物馆",
    schemaVersion: SCHEMA_VERSION,
    exportedAt,
    phase16Sync: buildPhase16SyncManifest(memories, { exportedAt }),
    phase17SyncAdapter: buildPhase17SyncAdapter(memories, { exportedAt }),
    phase18LongTermAgent: buildPhase18LongTermAgent(memories),
    phase19ImportPlan: buildPhase19ImportPlan(memories),
    halls: halls.filter((hall) => hall.id !== "all").map((hall) => ({
      id: hall.id,
      name: hall.name,
      description: hall.description
    })),
    emotions: emotionOptions,
    sourceTypes,
    mediaSummary: buildMediaSummary(memories),
    phase10Handoff: buildPhase10Handoff(memories),
    phase10Insights: buildPhase10Insights(memories),
    phase11WorkflowBlueprint: buildPhase11WorkflowBlueprint(memories),
    phase12Sovereignty: buildLocalPhase12Sovereignty(memories),
    ...buildPhase15AssetExportReview(),
    privacyPolicy: getPrivacyPolicy(),
    memories: memories.map(buildStructuredMemory)
  };
}

function buildPhase16SyncManifest(sourceMemories = memories, options = {}) {
  const exportedAt = options.exportedAt || new Date().toISOString();
  const assetItems = buildAssetPackageItems();
  const items = sourceMemories.map((memory) => {
    const structured = buildStructuredMemory(memory);
    return {
      id: structured.id,
      title: structured.title,
      updatedAt: structured.updatedAt || structured.createdAt || "",
      checksum: simpleChecksum(stableStringify({
        title: structured.title,
        hall: structured.hall?.id || structured.hall,
        rawContent: structured.rawContent,
        exhibitText: structured.exhibitText,
        date: structured.date,
        location: structured.location,
        people: structured.people,
        emotions: structured.emotions,
        tags: structured.tags,
        importance: structured.importance,
        attachments: structured.attachments
      }))
    };
  });
  return {
    phase: 17,
    phaseName: "真实多设备同步适配层版",
    mode: "manual-json-local-first",
    batchId: `sync-${exportedAt.replace(/[-:.TZ]/g, "").slice(0, 14)}-${simpleChecksum(localProfile.deviceId).slice(0, 4)}`,
    exportedAt,
    device: {
      id: localProfile.deviceId,
      label: localProfile.deviceLabel,
      owner: localProfile.displayName
    },
    itemCount: items.length,
    assetCount: assetItems.length,
    assetBoundary: {
      savedExhibitions: (getAssetCollection().savedExhibitions || []).length,
      reportDrafts: (getAssetCollection().reportDrafts || []).length,
      importPolicy: "phase16-v5-memory-first-assets-preview",
      note: "第十六阶段第五版先同步展品；专题展和报告草稿进入逐项合并预览，不在导入时静默合并。"
    },
    items,
    syncAudit: loadPhase16SyncAudit().slice(0, 5).map((entry) => ({
      at: entry.at,
      action: entry.action,
      label: entry.label,
      batchId: entry.batchId,
      summary: entry.summary
    })),
    conflictPolicy: {
      create: "新增展品直接写入",
      update: "导入版本较新时默认覆盖同 ID 本地展品，也可改为保留本地或复制",
      conflict: "冲突项默认保留本地并复制导入项为新展品，也支持逐项选择导入覆盖",
      skip: "完全一致或导入版本较旧时跳过"
    }
  };
}

function buildPhase17SyncAdapter(sourceMemories = memories, options = {}) {
  const exportedAt = options.exportedAt || new Date().toISOString();
  const devices = registerPhase17CurrentDevice();
  const queue = loadPhase17SyncQueue().map(normalizePhase17QueueTask);
  const queueMetrics = buildPhase17QueueMetrics(queue);
  const lanHandshake = buildPhase17LanHandshake(devices);
  const deviceTrustPolicy = buildPhase17DeviceTrustPolicy(devices);
  const privateCloudBoundary = buildPhase17PrivateCloudBoundary();
  const syncHealth = buildPhase17SyncHealth({ devices, queueMetrics, lanHandshake, deviceTrustPolicy, privateCloudBoundary });
  const healthExplanation = buildPhase17HealthExplanation(syncHealth);
  const failureRecovery = buildPhase17FailureRecovery(queue);
  const phase18SyncAdvisory = buildPhase17Phase18SyncAdvisory();
  return {
    phase: 17,
    phaseName: "真实多设备同步适配层版",
    buildLabel: "phase17-sync-health-sixth-edition",
    mode: "adapter-layer-local-first",
    generatedAt: exportedAt,
    dependsOn: ["phase16Sync", "manual-json-local-first"],
    deviceRegistry: {
      localDeviceId: localProfile.deviceId,
      deviceCount: devices.length,
      devices: devices.slice(0, 6)
    },
    adapters: [
      { id: "manual-json", label: "手动 JSON 同步", status: "active", writable: true, detail: "沿用第十六阶段同步包、冲突预览、风险确认和恢复演练。" },
      { id: "lan-bridge", label: "局域网桥接", status: "simulated", writable: false, detail: "第二版提供只读握手模拟，当前不扫描网络、不交换私人数据。" },
      { id: "private-cloud", label: "私有云适配", status: privateCloudBoundary.status === "draft" ? "draft" : "planned", writable: false, detail: "第五版只提供配置边界草案，默认关闭，不保存密钥。" }
    ],
    queue: {
      ...queueMetrics,
      recent: queueMetrics.recent
    },
    lanHandshake,
    deviceTrustPolicy,
    privateCloudBoundary,
    syncHealth,
    healthExplanation,
    failureRecovery,
    phase18SyncAdvisory,
    syncScope: {
      memories: sourceMemories.length,
      assets: buildAssetPackageItems().length,
      assetPolicy: "preview-first-no-silent-merge"
    },
    safety: {
      localFirst: true,
      autoUpload: false,
      requiresReview: true,
      inheritsPhase16RiskGate: true
    }
  };
}

function buildPhase15AssetExportReview(collection = getAssetCollection()) {
  return {
    phase15AssetQuality: buildAssetQualitySummary(collection),
    phase15AssetReferences: buildAssetReferenceGraph(collection),
    phase15RepairSuggestions: buildAssetRepairSuggestions(collection),
    phase15PackageItems: buildAssetPackageItems(collection),
    phase15ReleaseTimeline: buildAssetReleaseTimeline(collection),
    phase15PackageComparison: buildAssetPackageComparison(collection),
    phase15AssetAuditLog: loadAssetAuditLog(),
    phase15AssetSnapshots: loadAssetSnapshots(),
    phase15PackageValidation: buildAssetPackageValidationSummary(collection),
    phase15SnapshotComparison: buildAssetSnapshotComparison(collection),
    phase15AuditFilters: buildAssetAuditFilters(),
    phase15AuditSearch: buildAssetAuditSearch(),
    phase15SelectedSnapshot: getSelectedAssetSnapshot(),
    phase15SignatureRecovery: buildAssetSignatureAnomalyPlan({ checked: true, ok: true }),
    phase15PackageSignature: buildAssetPackageSignature(collection)
  };
}

function buildRedactedCollectionExport() {
  const payload = buildCollectionExport();
  const redactedMemories = memories.map(buildRedactedMemory);
  return {
    ...payload,
    exportMode: "redacted",
    redacted: true,
    phase16Sync: buildPhase16SyncManifest(redactedMemories, { exportedAt: payload.exportedAt }),
    phase17SyncAdapter: buildPhase17SyncAdapter(redactedMemories, { exportedAt: payload.exportedAt }),
    phase18LongTermAgent: buildPhase18LongTermAgent(redactedMemories),
    phase19ImportPlan: buildPhase19ImportPlan(redactedMemories),
    memories: redactedMemories,
    redaction: buildRedactionPolicy()
  };
}

function buildRedactedMemory(memory) {
  const structured = buildStructuredMemory(memory);
  return {
    ...structured,
    rawContent: redactText(structured.rawContent, "原始记忆已脱敏"),
    exhibitText: redactText(structured.exhibitText, "展品说明已脱敏"),
    location: structured.location ? "地点已脱敏" : "",
    people: structured.people.map((_, index) => `人物${index + 1}`),
    coverImage: structured.coverImage ? "封面线索已脱敏" : "",
    mediaNote: structured.mediaNote ? "多模态说明已脱敏" : "",
    attachments: structured.attachments.map((item, index) => ({
      name: `附件${index + 1}`,
      type: item.type || "其他",
      note: item.note ? "备注已脱敏" : ""
    }))
  };
}

function redactText(value, fallback) {
  if (!value) return "";
  return `${fallback}（${String(value).length} 字）`;
}

function buildRedactionPolicy() {
  return {
    mode: "redacted",
    maskedFields: ["rawContent", "exhibitText", "people", "location", "coverImage", "mediaNote", "attachments.name", "attachments.note"],
    preservedFields: ["id", "hall", "sourceType", "date", "tags", "emotions", "importance", "favorite", "createdAt", "updatedAt"],
    note: "脱敏包用于演示、排查和跨设备预览，不适合作为完整恢复备份。"
  };
}

function buildLocalPhase12Sovereignty(items = []) {
  const structured = items.map(buildStructuredMemory);
  const sensitivity = buildLocalSensitivitySummary(structured);
  return {
    phase: 18,
    phaseName: "Agent 能力进阶和长期记忆助理版",
    localUserMode: "single-user-local-profile",
    memoryCount: structured.length,
    agentRunLinkedCount: structured.filter((memory) => memory.agentRunId).length,
    sensitivity,
    exportPackage: {
      format: "json",
      modes: ["full", "redacted"],
      includes: ["memories", "phase10Insights", "phase11WorkflowBlueprint", "phase12Sovereignty", "phase16Sync", "phase17SyncAdapter", "phase18LongTermAgent", "phase19ImportPlan", "privacyPolicy"],
      excludes: ["originalAttachmentFiles", "remoteAccountCredentials"],
      portable: true,
      riskLevel: sensitivity.riskLevel,
      suggestedHandling: sensitivity.riskLevel === "high" ? "导出后请保存在受信任位置，后续建议使用加密导出包。" : "导出后仍建议保存在个人设备或可信备份位置。"
    },
    deletion: {
      singleMemory: "available",
      fullPurge: databaseAvailable ? "DELETE /api/memories/purge" : "clear local backup manually",
      keeps: ["local profile", "application source files"]
    },
    sync: {
      mode: localProfile.syncPreference,
      status: "available"
    },
    phase13Readiness: buildLocalPhase13Readiness()
  };
}

function buildLocalPhase13Readiness() {
  const checks = [
    { id: "stable-api", label: "主要 API 有 smoke test", status: "ready" },
    { id: "start-docs", label: "启动和配置文档", status: "ready" },
    { id: "data-boundary", label: "数据位置和 AI 调用边界", status: "ready" },
    { id: "backup-restore", label: "导出导入和删除控制", status: "ready" },
    { id: "redacted-demo", label: "脱敏演示/排查包", status: "ready" },
    { id: "module-boundary", label: "工程模块拆分", status: "planned" }
  ];
  const readyCount = checks.filter((item) => item.status === "ready").length;
  return {
    targetPhase: 13,
    targetName: "产品化、部署和运维",
    ready: readyCount >= 5,
    score: Math.round((readyCount / checks.length) * 100),
    checks,
    recommendation: readyCount >= 5
      ? "可以进入第十三阶段，优先处理工程拆分、运行日志、部署文档和发布流程。"
      : "继续补齐 API 检查、数据边界和导出删除控制后再进入第十三阶段。"
  };
}

function buildMediaSummary(items = []) {
  const structured = items.map(buildStructuredMemory);
  const attachmentTypeCounts = structured.reduce((counts, memory) => {
    Object.entries(buildAttachmentTypeCounts(memory.attachments)).forEach(([type, count]) => {
      counts[type] = (counts[type] || 0) + count;
    });
    return counts;
  }, {});
  return {
    withCover: structured.filter((memory) => memory.coverImage).length,
    withMediaNote: structured.filter((memory) => memory.mediaNote).length,
    withAttachments: structured.filter((memory) => memory.attachments.length > 0).length,
    attachmentCount: structured.reduce((total, memory) => total + memory.attachments.length, 0),
    attachmentTypeCounts,
    attachmentTypes: sortAttachmentTypeCounts(attachmentTypeCounts).map(([type, count]) => ({ type, count })),
    fileStorage: "metadata-only",
    note: "当前导出包含附件清单和线索，不包含原始附件文件。"
  };
}

function buildPhase10Handoff(items = []) {
  const structured = items.map(buildStructuredMemory);
  const timelineReady = structured.filter((memory) => memory.date).length;
  const themeReady = structured.filter((memory) => (
    memory.tags.length
    || memory.people.length
    || memory.location
    || memory.emotions.length
    || memory.hall?.id
    || memory.sourceType
  )).length;
  const reportReady = structured.filter((memory) => (
    memory.rawContent
    && memory.exhibitText
    && (memory.tags.length || memory.emotions.length || memory.mediaNote || memory.attachments.length)
  )).length;
  const multimodalEvidence = structured.filter(hasMultimodalMetadata).length;
  return {
    total: structured.length,
    timelineReady,
    themeReady,
    reportReady,
    multimodalEvidence,
    missingDate: Math.max(0, structured.length - timelineReady),
    readyForPhase10: structured.length > 0 && themeReady > 0 && reportReady > 0,
    note: "阶段十将基于时间、人物、地点、标签、情绪和多模态证据生成时间线、主题展和回忆报告。"
  };
}

function buildPhase11Handoff(items = []) {
  const structured = items.map(buildStructuredMemory);
  const phase10 = buildPhase10Handoff(items);
  const withAgentRun = structured.filter((memory) => memory.agentRunId).length;
  const withReviewEvidence = structured.filter((memory) => (
    memory.rawContent
    && memory.exhibitText
    && (memory.tags.length || memory.people.length || memory.emotions.length)
  )).length;
  const withGuideEvidence = structured.filter((memory) => (
    memory.exhibitText
    && (memory.tags.length || memory.mediaNote || memory.attachments.length || memory.people.length)
  )).length;
  const runCoverage = buildCoverageRatio(withAgentRun, structured.length);
  const reviewCoverage = buildCoverageRatio(withReviewEvidence, structured.length);
  const guideCoverage = buildCoverageRatio(withGuideEvidence, structured.length);
  const gaps = buildPhase11Gaps({ structured, phase10, withAgentRun, withReviewEvidence, withGuideEvidence });
  return {
    total: structured.length,
    templates: workflowTemplates.length,
    withAgentRun,
    withReviewEvidence,
    withGuideEvidence,
    runCoverage,
    reviewCoverage,
    guideCoverage,
    gaps,
    recommendedNextActions: buildPhase11NextActions(gaps),
    readyForPhase11: structured.length > 0 && phase10.readyForPhase10 && (withAgentRun > 0 || withReviewEvidence > 0),
    nextEngine: "lightweight-orchestrator"
  };
}

function buildCoverageRatio(value, total) {
  if (!total) return 0;
  return Math.round((Number(value) / Math.max(Number(total), 1)) * 100);
}

function buildPhase11Gaps({ structured, phase10, withAgentRun, withReviewEvidence, withGuideEvidence }) {
  const gaps = [];
  if (!structured.length) gaps.push({ id: "no-memories", label: "还没有展品样本", severity: "high" });
  if (phase10.missingDate > 0) gaps.push({ id: "missing-date", label: `${phase10.missingDate} 件展品缺少时间`, severity: "medium" });
  if (withAgentRun < structured.length) gaps.push({ id: "agent-run-coverage", label: `${structured.length - withAgentRun} 件展品没有整理历史`, severity: "medium" });
  if (withReviewEvidence < structured.length) gaps.push({ id: "review-evidence", label: `${structured.length - withReviewEvidence} 件展品复核依据不足`, severity: "medium" });
  if (withGuideEvidence < structured.length) gaps.push({ id: "guide-evidence", label: `${structured.length - withGuideEvidence} 件展品导览证据不足`, severity: "low" });
  if (!gaps.length) gaps.push({ id: "stable", label: "当前样本已具备轻量编排基础", severity: "low" });
  return gaps.slice(0, 5);
}

function buildPhase11NextActions(gaps = []) {
  const actions = [];
  const ids = new Set(gaps.map((gap) => gap.id));
  if (ids.has("no-memories")) actions.push("先保存 3 到 5 件带时间、人物和标签的展品");
  if (ids.has("missing-date")) actions.push("补齐关键展品时间，提升时间线和报告稳定性");
  if (ids.has("agent-run-coverage")) actions.push("优先使用 Agent 整理新展品，增加可回放运行历史");
  if (ids.has("review-evidence")) actions.push("补齐人物、地点、标签和展品说明，减少人工复核空洞");
  if (ids.has("guide-evidence")) actions.push("补充多模态线索或引用字段，提高讲解检索可信度");
  if (!actions.length) actions.push("进入可保存专题展和报告草稿的设计准备");
  return actions.slice(0, 4);
}

function buildPhase11WorkflowBlueprint(items = []) {
  const handoff = buildPhase11Handoff(items);
  const phase12Readiness = buildPhase12Readiness(items, handoff);
  return {
    phase: 18,
    phaseName: "Agent 能力进阶和长期记忆助理版",
    engine: {
      id: "memory-museum-light-orchestrator",
      name: "轻量工作流编排层",
      dependency: "none"
    },
    capabilities: {
      templates: true,
      humanReview: true,
      retryAndReject: true,
      persistedRuns: true,
      replay: true,
      citations: true,
      scopedInsights: true
    },
    qualityGates: [
      { id: "review-gate", label: "人工复核闸门", status: handoff.reviewCoverage >= 60 ? "ready" : "needs-data" },
      { id: "run-history-gate", label: "运行历史回放", status: handoff.runCoverage > 0 ? "ready" : "needs-run" },
      { id: "citation-gate", label: "引用依据闸门", status: handoff.guideCoverage >= 60 ? "ready" : "needs-evidence" },
      { id: "asset-gate", label: "专题资产沉淀", status: "planned" }
    ],
    dataSources: [
      { id: "memories", label: "展品表", count: handoff.total },
      { id: "agent-runs", label: "整理历史", count: handoff.withAgentRun },
      { id: "review-evidence", label: "复核依据", count: handoff.withReviewEvidence },
      { id: "guide-evidence", label: "导览证据", count: handoff.withGuideEvidence }
    ],
    phase12Readiness,
    handoff,
    templates: workflowTemplates
  };
}

function buildPhase12Readiness(items = [], handoff = buildPhase11Handoff(items)) {
  const checks = [
    { id: "local-first-storage", label: "本地优先存储", status: "ready", detail: "SQLite 主存储，本地备份回退。" },
    { id: "portable-export", label: "可迁移导出包", status: "ready", detail: "导出包含展品、洞察和工作流蓝图。" },
    { id: "import-restore", label: "导入恢复", status: "ready", detail: "JSON 备份可以导入并处理 ID 冲突。" },
    { id: "delete-control", label: "删除控制", status: "ready", detail: "展品支持按 ID 删除。" },
    { id: "workflow-audit", label: "工作流审计", status: handoff.withAgentRun > 0 ? "ready" : "needs-sample", detail: "整理历史可关联展品。" },
    { id: "privacy-boundary", label: "隐私边界说明", status: "planned", detail: "第十二阶段补账号、加密和 AI 调用范围确认。" }
  ];
  const readyCount = checks.filter((item) => item.status === "ready").length;
  return {
    targetPhase: 12,
    targetName: "账号、多端同步、隐私和数据主权",
    planningReady: readyCount >= 4,
    score: Math.round((readyCount / checks.length) * 100),
    checks,
    blockers: checks.filter((item) => item.status !== "ready").map((item) => item.label),
    recommendation: readyCount >= 4
      ? "可以进入第十二阶段规划与第一版实现，优先处理数据主权、导出删除边界和隐私说明。"
      : "继续补齐导入导出、删除控制和审计记录后再进入第十二阶段。"
  };
}

function getWorkflowBlueprint() {
  if (backendWorkflowBlueprint?.phase >= 15 && Array.isArray(backendWorkflowBlueprint.templates)) {
    workflowBlueprintSource = "server";
    return backendWorkflowBlueprint;
  }
  workflowBlueprintSource = databaseAvailable ? "server-fallback" : "local";
  return buildPhase11WorkflowBlueprint(memories);
}

async function syncWorkflowBlueprint({ quiet = false } = {}) {
  if (!databaseAvailable && !quiet) {
    backendWorkflowBlueprint = null;
    workflowBlueprintSource = "local";
    renderWorkflowOrchestration();
    return null;
  }
  try {
    const response = await fetch(API_WORKFLOWS);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    if ((payload?.phase || 0) < 15 || !Array.isArray(payload.templates)) throw new Error("workflow blueprint is invalid");
    backendWorkflowBlueprint = payload;
    workflowBlueprintSource = "server";
    renderWorkflowOrchestration();
    return payload;
  } catch (error) {
    backendWorkflowBlueprint = null;
    workflowBlueprintSource = databaseAvailable ? "server-fallback" : "local";
    if (!quiet) renderWorkflowOrchestration();
    return null;
  }
}

function buildLocalPrivacyPolicy() {
  const sovereignty = buildLocalPhase12Sovereignty(memories);
  return {
    phase: 18,
    phaseName: "Agent 能力进阶和长期记忆助理版",
    summary: {
      storageMode: databaseAvailable ? "local-first" : "browser-local",
      accountMode: "local-single-user",
      syncMode: localProfile.syncPreference,
      aiMode: databaseAvailable ? "backend-or-mock" : "frontend-local",
      databasePath: databaseAvailable ? "SQLite 后端已连接" : "未连接后端",
      memoryCount: memories.length
    },
    dataLocations: [
      { id: "browser-backup", label: "浏览器本地备份", location: `localStorage: ${STORAGE_KEY}`, contains: ["展品备份", "本地馆主配置"] },
      { id: "export-package", label: "手动同步包", location: "用户下载的 JSON 文件", contains: ["memories", "phase10Insights", "phase11WorkflowBlueprint", "phase12Sovereignty", "privacyPolicy"] }
    ],
    aiDataScope: {
      configured: false,
      baseUrl: "frontend-local",
      model: "local-mock",
      sentFields: localProfile.aiConsent ? ["rawContent when backend AI is configured"] : [],
      notSentByCurrentApp: ["originalAttachmentFiles", "fullDatabaseFile"],
      requiresUserConfirmation: true,
      note: localProfile.aiConsent
        ? "本地配置允许在后端 AI 已配置时发送原始记忆；当前策略仍以实际后端 /api/privacy 为准。"
        : "本地配置未允许 AI 数据发送；前端本地 Mock 不会外发数据。"
    },
    sensitiveData: sovereignty.sensitivity,
    userControls: [
      { id: "export", label: "完整导出 JSON 备份", status: "available" },
      { id: "redacted-export", label: "导出脱敏 JSON 包", status: "available" },
      { id: "import", label: "从 JSON 备份恢复", status: "available" },
      { id: "delete-one", label: "删除单件展品", status: "available" },
      { id: "local-profile", label: "本地用户配置", status: "browser-local" }
    ],
    productizationReadiness: sovereignty.phase13Readiness
  };
}

function buildLocalSensitivitySummary(items = []) {
  const categories = [
    { id: "people", label: "人物关系", count: items.filter((memory) => memory.people?.length).length },
    { id: "location", label: "地点线索", count: items.filter((memory) => memory.location || String(memory.rawContent || "").match(/家|学校|公司|医院|车站|地址|上海|北京|广州|深圳/)).length },
    { id: "contact", label: "联系方式", count: items.filter((memory) => String(memory.rawContent || "").match(/1[3-9]\d{9}|微信|电话|邮箱|@/)).length },
    { id: "low-mood", label: "低谷情绪", count: items.filter((memory) => (memory.emotions || []).some((emotion) => ["低谷", "孤独", "委屈", "愤怒", "害怕", "迷茫"].includes(emotion)) || memory.hall?.id === "low").length },
    { id: "attachments", label: "附件元数据", count: items.filter((memory) => memory.attachments?.length || memory.coverImage || memory.mediaNote).length }
  ];
  const matched = categories.filter((category) => category.count > 0);
  const totalSignals = matched.reduce((sum, category) => sum + category.count, 0);
  const riskLevel = matched.some((item) => item.id === "contact" && item.count > 0) || matched.length >= 4
    ? "high"
    : matched.length >= 2 ? "medium" : matched.length === 1 ? "low" : "none";
  return {
    riskLevel,
    totalSignals,
    categories,
    matchedCategories: matched.map((item) => item.label),
    recommendation: riskLevel === "high"
      ? "导出或调用 AI 前建议再次检查原文、人物、地点和联系方式。"
      : riskLevel === "medium"
        ? "建议导出前确认人物、地点和附件线索是否适合随包保存。"
        : "当前敏感线索较少，仍建议只在可信设备保存备份。"
  };
}

function getPrivacyPolicy() {
  if (privacyPolicy?.phase >= 15) {
    privacyPolicySource = "server";
    return privacyPolicy;
  }
  privacyPolicySource = "local";
  return buildLocalPrivacyPolicy();
}

async function syncPrivacyPolicy({ quiet = false } = {}) {
  if (!databaseAvailable && !quiet) {
    privacyPolicy = null;
    privacyPolicySource = "local";
    renderPrivacyPanel();
    return null;
  }
  try {
    const response = await fetch(API_PRIVACY);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    if ((payload?.phase || 0) < 15) throw new Error("privacy policy is invalid");
    privacyPolicy = payload;
    privacyPolicySource = "server";
    renderPrivacyPanel();
    return payload;
  } catch {
    privacyPolicy = null;
    privacyPolicySource = "local";
    if (!quiet) renderPrivacyPanel();
    return null;
  }
}

function buildLocalVersionInfo() {
  return {
    app: "AI 记忆博物馆",
    packageName: "ai-memory-museum",
    version: "1.0.10",
    schemaVersion: SCHEMA_VERSION,
    phase: 20,
    phaseName: "可扩展产品平台和插件生态版",
    releaseChannel: "phase20-v1-10-browser-fallback",
    buildLabel: "phase20-template-preview-fixtures",
    runtime: {
      node: "not-connected",
      platform: "browser",
      uptimeSeconds: 0,
      port: "not-connected",
      databasePath: databaseAvailable ? "SQLite 后端已连接" : "未连接后端",
      aiConfigured: backendAiConfigured,
      aiModel: backendAiConfigured ? "configured" : "not-configured"
    },
    deployment: {
      mode: "browser-fallback",
      staticHosting: "local-file-or-node-static",
      database: databaseAvailable ? "node:sqlite" : "localStorage",
      startCommand: "npm.cmd start",
      healthCheck: "/api/health",
      versionCheck: "/api/version",
      notes: "未连接后端时，页面会显示浏览器本地备份能力。"
    },
    operations: {
      status: databaseAvailable ? "operational" : "degraded",
      mode: databaseAvailable ? "local" : "browser-fallback",
      checks: ["syntax", "phase15-readiness", "phase16-readiness", "phase17-readiness", "phase18-readiness", "phase19-readiness", "phase20-readiness", "api-smoke"],
      release: {
        channel: databaseAvailable ? "local-preview" : "browser-fallback",
        label: "phase20-template-preview-fixtures",
        checklistReady: buildLocalReleaseChecklist().filter((item) => item.status === "ready").length,
        checklistTotal: buildLocalReleaseChecklist().length
      },
      data: {
        memories: memories.length,
        multimodal: memories.filter(hasMultimodalMetadata).length,
        agentRuns: memories.filter((memory) => memory.agentRunId).length,
        databasePath: databaseAvailable ? "SQLite 后端已连接" : "localStorage"
      },
      backup: {
        fullExport: "导出",
        redactedExport: "导出脱敏包",
        purge: "清空数据库展品"
      },
      observability: {
        health: "/api/health",
        version: "/api/version",
        operations: "/api/operations",
        logs: databaseAvailable ? "jsonl-and-memory-events" : "browser-local-summary",
        requestId: "X-Request-Id",
        recentEvents: 0
      },
      backupPolicy: buildLocalBackupPolicy(),
      readiness: {
        phase14: true,
        phase15: true,
        phase16: true,
        phase17: true,
        phase18: true,
        phase19: true,
        phase20: true,
        modularizationReady: true,
        assetModelReady: true,
        deployableLocal: databaseAvailable,
        productionReady: false,
        reason: "阶段 20 第十一版已补充平台边界、内置插件清单、扩展点、安全策略、模板预览 fixtures 和插件安装流程模型。"
      }
    },
    checks: {
      full: "npm.cmd run check",
      smoke: "npm.cmd run smoke",
      syntax: "node --check app.js && node --check server.js && node --check database.js"
    },
    releaseChecklist: buildLocalReleaseChecklist(),
    runbook: buildLocalOperationsRunbook(),
    deploymentModes: buildLocalDeploymentModes(),
    backupPolicy: buildLocalBackupPolicy(),
    riskRegister: buildLocalRiskRegister(),
    logArchive: buildLocalLogArchive(),
    demoKit: buildLocalDemoKit(),
    phase14Readiness: buildLocalPhase14Readiness(),
    phase15Readiness: buildLocalPhase15Readiness(),
    phase15AssetPlan: buildLocalPhase15AssetPlan(),
    phase20PlatformPlan: buildLocalPhase20PlatformPlan(),
    moduleBoundaryPlan: buildLocalModuleBoundaryPlan(),
    recentEvents: buildLocalOperationEvents(),
    releaseHistory: buildLocalReleaseHistory(),
    apiSurface: ["/api/health", "/api/version", "/api/operations", "/api/operations/export", "/api/privacy", "/api/workflows", "/api/insights", "/api/assets", "/api/exhibitions", "/api/report-drafts"],
    nextEngineeringSteps: [
      "阶段 20 第十一版固定平台边界、插件清单、扩展点、安全策略、模板预览 fixtures 和插件安装流程模型",
      "第 19 阶段外部导入能力作为内置导入器来源保留",
      "第 18 阶段长期助理作为内置 Agent 工具来源保留",
      "真实第三方插件运行时等待权限、沙箱和审计闭环完成后再启用"
    ]
  };
}

function buildLocalReleaseChecklist() {
  return [
    { id: "syntax", label: "语法检查", status: "ready", command: "node --check app.js && node --check server.js && node --check database.js && node --check src/services/operations.js && node --check src/routes/health.js && node --check src/routes/operations.js" },
    { id: "readiness", label: "第十五阶段资产检查", status: "ready", command: "node scripts/phase15-readiness.js" },
    { id: "phase16-readiness", label: "第十六阶段同步检查", status: "ready", command: "node scripts/phase16-readiness.js" },
    { id: "phase17-readiness", label: "第十七阶段适配层检查", status: "ready", command: "node scripts/phase17-readiness.js" },
    { id: "phase18-readiness", label: "第十八阶段长期助理检查", status: "ready", command: "node scripts/phase18-readiness.js" },
    { id: "phase19-readiness", label: "第十九阶段外部导入检查", status: "ready", command: "node scripts/phase19-readiness.js" },
    { id: "phase20-readiness", label: "第二十阶段平台与插件检查", status: "ready", command: "node scripts/phase20-readiness.js" },
    { id: "api-smoke", label: "核心 API smoke test", status: databaseAvailable ? "ready" : "needs-backend", command: "npm.cmd run smoke" },
    { id: "operations-trace", label: "请求追踪与运行事件", status: databaseAvailable ? "ready" : "browser-local", detail: "后端在线时 API 响应带 X-Request-Id，/api/operations 可查看最近运行事件。" },
    { id: "persistent-ops-log", label: "持久化运行日志", status: databaseAvailable ? "ready" : "browser-local", detail: "后端在线时最近 API 请求会追加到 JSONL 运维日志。" },
    { id: "data-export", label: "完整与脱敏备份", status: "ready", detail: "发布前导出完整包；演示和排查优先使用脱敏包。" },
    { id: "demo-kit", label: "演示包摘要", status: memories.length > 0 ? "ready" : "needs-sample", detail: "演示包会汇总样本数量、推荐路线和隐私提示。" },
    { id: "phase14-readiness", label: "第十四阶段模块化基线", status: "ready", detail: "模块边界、迁移顺序、风险闸门和检查保护网已经声明。" },
    { id: "phase15-readiness", label: "第十五阶段准备", status: "ready", detail: "专题资产、报告草稿、引用来源、导出边界和工作流状态已形成进入计划。" },
    { id: "production-logs", label: "持久化日志与反向代理", status: "planned", detail: "生产部署前仍需补充文件日志、HTTPS 和反向代理说明。" }
  ];
}

function buildLocalOperationsRunbook() {
  return [
    { id: "start", label: "本地启动", command: "npm.cmd start", detail: "启动后打开 http://127.0.0.1:3000，并先查看 /api/health。" },
    { id: "check", label: "发布前检查", command: "npm.cmd run check", detail: "包含语法检查、Phase 15-20 readiness 和 API smoke test。" },
    { id: "backup", label: "备份", command: "GET /api/memories/export", detail: "长期保存前导出完整 JSON；对外演示或排查使用 redacted 模式。" },
    { id: "privacy", label: "隐私复核", command: "GET /api/privacy", detail: "确认 AI 调用范围、敏感线索和删除控制。" },
    { id: "recover", label: "恢复", command: "POST /api/memories/import", detail: "从 JSON 备份恢复展品，导入时处理 ID 冲突。" }
  ];
}

function buildLocalDeploymentModes() {
  return [
    { id: "local", label: "本地个人使用", status: databaseAvailable ? "ready" : "needs-backend", database: databaseAvailable ? "SQLite" : "localStorage", note: "适合单机长期整理私人记忆。" },
    { id: "demo", label: "课堂/演示模式", status: "ready", database: databaseAvailable ? "演示 SQLite" : "浏览器本地备份", note: "建议使用脱敏数据和明确的 AI 调用说明。" },
    { id: "lan", label: "局域网共享", status: "planned", database: "SQLite + 访问控制", note: "进入前需要账号、权限和备份策略。" },
    { id: "cloud", label: "云端部署", status: "planned", database: "托管数据库或卷挂载 SQLite", note: "进入前需要 HTTPS、日志、备份、反向代理和密钥管理。" }
  ];
}

function buildLocalBackupPolicy() {
  return {
    full: databaseAvailable ? "/api/memories/export" : "浏览器导出",
    redacted: databaseAvailable ? "/api/memories/export?mode=redacted" : "导出脱敏包",
    restore: databaseAvailable ? "POST /api/memories/import" : "导入 JSON",
    purge: databaseAvailable ? "DELETE /api/memories/purge with confirm=DELETE" : "清空本地备份",
    recommendedCadence: "每次集中整理后导出一次完整包；对外演示只使用脱敏包。",
    storageAdvice: "完整包建议保存到个人可信设备或加密盘，脱敏包可用于演示、排查和跨设备预览。"
  };
}

function buildLocalRiskRegister() {
  return [
    { id: "privacy", label: "隐私与敏感线索", level: memories.length > 0 ? "medium" : "low", mitigation: "导出、演示和 AI 调用前先查看隐私策略与脱敏包。" },
    { id: "backup", label: "备份恢复", level: "medium", mitigation: "当前已有 JSON 导出/导入，后续需要加密包和自动备份。" },
    { id: "observability", label: "运行观测", level: "medium", mitigation: "当前有 health/version；生产部署前补请求日志、错误日志和 request id。" },
    { id: "module-size", label: "工程模块边界", level: "medium", mitigation: "后续拆分 server、agent、rag、workflow、privacy、operations 模块。" }
  ];
}

function buildLocalOperationEvents() {
  return [
    {
      id: "browser-fallback",
      type: "local",
      method: "UI",
      path: "browser",
      statusCode: databaseAvailable ? 200 : 0,
      durationMs: 0,
      level: databaseAvailable ? "info" : "warning",
      at: new Date().toISOString(),
      error: databaseAvailable ? "" : "后端未连接，显示浏览器本地摘要。"
    }
  ];
}

function buildLocalLogArchive() {
  return {
    format: databaseAvailable ? "jsonl" : "browser-summary",
    path: databaseAvailable ? "data/operations-events.jsonl" : "localStorage/session",
    exists: databaseAvailable,
    sizeBytes: 0,
    inMemoryEvents: 0,
    exportEndpoint: "/api/operations/export",
    retention: "后端在线时保留 JSONL 运维日志；本地回退仅展示当前页面摘要。"
  };
}

function buildLocalDemoKit() {
  const withDate = memories.filter((memory) => memory.date).length;
  const withPeople = memories.filter((memory) => memory.people?.length).length;
  const withMedia = memories.filter(hasMultimodalMetadata).length;
  const withGuideText = memories.filter((memory) => memory.exhibitText && ((memory.tags || []).length || (memory.emotions || []).length)).length;
  const score = Math.round(([
    memories.length >= 3,
    withDate >= 2,
    withPeople >= 1,
    withMedia >= 1,
    withGuideText >= 2
  ].filter(Boolean).length / 5) * 100);
  return {
    ready: score >= 60,
    score,
    sampleCount: memories.length,
    checks: [
      { id: "sample-count", label: "至少 3 件展品", status: memories.length >= 3 ? "ready" : "needs-sample", count: memories.length },
      { id: "timeline", label: "时间线样本", status: withDate >= 2 ? "ready" : "needs-date", count: withDate },
      { id: "people", label: "人物关系线索", status: withPeople >= 1 ? "ready" : "needs-people", count: withPeople },
      { id: "media", label: "多模态线索", status: withMedia >= 1 ? "ready" : "needs-media", count: withMedia },
      { id: "guide", label: "讲解检索样本", status: withGuideText >= 2 ? "ready" : "needs-guide", count: withGuideText }
    ],
    storyline: [
      "录入或导入 3 到 5 件温馨记忆展品",
      "运行 Agent 整理并保留人工复核状态",
      "打开讲解员提问，展示引用证据和可信度",
      "查看时间线、主题展、隐私策略和部署与运维面板",
      "导出脱敏包用于演示或排查"
    ],
    privacyNote: "演示前优先使用脱敏导出包，避免展示真实人物、地点、联系方式和原始附件线索。"
  };
}

function buildLocalPhase20PlatformPlan() {
  return {
    phase: 20,
    phaseName: "可扩展产品平台和插件生态版",
    version: "1.0.10",
    mode: "platform-boundary-first",
    runtimePolicy: "manifest-only-no-third-party-code-execution",
    currentScope: [
      "plugin-manifest-registry",
      "plugin-manifest-schema",
      "permission-review",
      "plugin-audit-log",
      "capability-catalog",
      "extension-point-map",
      "security-boundary",
      "built-in-plugin-inventory",
      "built-in-plugin-registry",
      "extension-contract-tests",
      "plugin-sandbox-boundary",
      "no-code-template-pack",
      "signed-plugin-manifest",
      "plugin-installation-workflow",
      "template-preview-fixtures",
      "phase20-readiness"
    ],
    extensionPoints: [
      { id: "importer", label: "导入器", status: "planned", contract: "preview -> draft -> reviewed import", owner: "phase19ImportPlan" },
      { id: "exporter", label: "导出器", status: "planned", contract: "collection -> package -> redaction policy", owner: "privacyPolicy" },
      { id: "agent-tool", label: "Agent 工具", status: "planned", contract: "suggestion -> human review -> auditable action", owner: "phase18LongTermAgent" },
      { id: "asset-template", label: "专题展模板", status: "planned", contract: "asset draft -> editable sections -> release package", owner: "phase15 assets" },
      { id: "sync-adapter", label: "同步适配器", status: "planned", contract: "local-first package -> conflict preview -> manual apply", owner: "phase16/17 sync" }
    ],
    builtInPlugins: [
      { id: "markdown-importer", type: "importer", status: "built-in", enabled: true, source: "phase19", manifest: { schemaVersion: "phase20.plugin.manifest.v1", permissions: ["memory.import.preview"], extensionPoint: "importer" } },
      { id: "csv-importer", type: "importer", status: "built-in", enabled: true, source: "phase19", manifest: { schemaVersion: "phase20.plugin.manifest.v1", permissions: ["memory.import.preview"], extensionPoint: "importer" } },
      { id: "chat-importer", type: "importer", status: "built-in", enabled: true, source: "phase19", manifest: { schemaVersion: "phase20.plugin.manifest.v1", permissions: ["memory.import.preview"], extensionPoint: "importer" } },
      { id: "redacted-exporter", type: "exporter", status: "built-in", enabled: true, source: "phase12", manifest: { schemaVersion: "phase20.plugin.manifest.v1", permissions: ["memory.export.redacted"], extensionPoint: "exporter" } },
      { id: "long-term-review-agent", type: "agent-tool", status: "built-in", enabled: true, source: "phase18", manifest: { schemaVersion: "phase20.plugin.manifest.v1", permissions: ["agent.suggest", "memory.read.summary"], extensionPoint: "agent-tool" } },
      { id: "manual-json-sync", type: "sync-adapter", status: "built-in", enabled: true, source: "phase16", manifest: { schemaVersion: "phase20.plugin.manifest.v1", permissions: ["sync.package.preview"], extensionPoint: "sync-adapter" } }
    ],
    builtInPluginRegistry: {
      schemaVersion: "phase20.builtIn.registry.v1",
      status: "registry-ready-runtime-disabled",
      owner: "local-platform",
      total: 6,
      enabled: 6,
      categories: ["importer", "exporter", "agent-tool", "sync-adapter"],
      entries: [
        { id: "markdown-importer", type: "importer", owner: "phase19", status: "enabled", capability: "markdown-to-memory-drafts", input: "markdown text", output: "reviewable memory drafts", contract: "preview-only" },
        { id: "csv-importer", type: "importer", owner: "phase19", status: "enabled", capability: "csv-to-memory-drafts", input: "csv text", output: "reviewable memory drafts", contract: "preview-only" },
        { id: "chat-importer", type: "importer", owner: "phase19", status: "enabled", capability: "chat-to-memory-drafts", input: "chat transcript", output: "reviewable memory drafts", contract: "preview-only" },
        { id: "redacted-exporter", type: "exporter", owner: "phase12", status: "enabled", capability: "redacted-memory-export", input: "memory collection", output: "redacted export package", contract: "redaction-required" },
        { id: "long-term-review-agent", type: "agent-tool", owner: "phase18", status: "enabled", capability: "long-term-review-suggestions", input: "memory summaries", output: "reviewable suggestions", contract: "human-confirmation" },
        { id: "manual-json-sync", type: "sync-adapter", owner: "phase16", status: "enabled", capability: "manual-json-sync-preview", input: "local-first sync package", output: "conflict preview", contract: "manual-apply-only" }
      ],
      registryChecks: ["unique-id", "known-extension-point", "manifest-attached", "permission-reviewed", "audit-sample-present"],
      runtimeExecution: false
    },
    manifestSchema: {
      schemaVersion: "phase20.plugin.manifest.v1",
      status: "schema-ready-runtime-disabled",
      requiredFields: ["id", "name", "version", "type", "extensionPoint", "permissions", "entryPolicy", "dataAccess", "audit"],
      optionalFields: ["description", "sourcePhase", "capabilities", "compatibility", "uiHints", "disabledReason"],
      permissionLabels: ["memory.import.preview", "memory.export.redacted", "memory.read.summary", "agent.suggest", "sync.package.preview"],
      extensionContracts: ["importer", "exporter", "agent-tool", "asset-template", "sync-adapter"],
      validationRules: [
        "id must be stable kebab-case",
        "extensionPoint must match a declared Phase 20 extension point",
        "permissions must use approved labels",
        "entryPolicy must be manifest-only",
        "networkAccess and secretStorage must remain false in 1.0.10"
      ]
    },
    manifestValidation: {
      status: "ready",
      runtimeExecution: false,
      builtInManifestCount: 6,
      sampleManifestIds: ["markdown-importer", "csv-importer", "chat-importer", "redacted-exporter", "long-term-review-agent", "manual-json-sync"],
      blockedUntil: ["permission-review", "sandbox-boundary"]
    },
    permissionReview: {
      status: "policy-ready",
      defaultDecision: "deny-until-reviewed",
      humanApprovalRequired: true,
      reviewScope: ["manifest.permissions", "manifest.entryPolicy", "manifest.dataAccess", "manifest.audit"],
      reviewChecklist: [
        "确认插件只声明允许的权限标签",
        "确认插件不打开第三方代码执行",
        "确认插件不请求网络访问和密钥存储",
        "确认高风险能力需要人工复核",
        "确认被禁用的原因会写入审计"
      ],
      builtInDecisions: [
        { id: "markdown-importer", decision: "approved", permissions: ["memory.import.preview"], confirmationRequired: false },
        { id: "csv-importer", decision: "approved", permissions: ["memory.import.preview"], confirmationRequired: false },
        { id: "chat-importer", decision: "approved", permissions: ["memory.import.preview"], confirmationRequired: false },
        { id: "redacted-exporter", decision: "approved", permissions: ["memory.export.redacted"], confirmationRequired: false },
        { id: "long-term-review-agent", decision: "reviewed", permissions: ["agent.suggest", "memory.read.summary"], confirmationRequired: true },
        { id: "manual-json-sync", decision: "approved", permissions: ["sync.package.preview"], confirmationRequired: false }
      ],
      permissionLabels: [
        { id: "memory.import.preview", review: "approved", scope: "导入预览" },
        { id: "memory.export.redacted", review: "approved", scope: "脱敏导出" },
        { id: "memory.read.summary", review: "reviewed", scope: "摘要读取" },
        { id: "agent.suggest", review: "reviewed", scope: "Agent 建议" },
        { id: "sync.package.preview", review: "approved", scope: "同步包预览" }
      ],
      blockedUntil: ["sandbox-boundary"],
      auditEventTypes: ["manifest-loaded", "permission-reviewed", "decision-approved", "decision-blocked", "confirmation-recorded"]
    },
    pluginAuditLog: {
      status: "audit-model-ready",
      eventSchemaVersion: "phase20.plugin.audit.v1",
      storageMode: "export-and-operations-summary",
      runtimeExecution: false,
      requiredFields: ["id", "pluginId", "eventType", "decision", "actor", "createdAt", "evidence"],
      eventTypes: ["manifest-loaded", "permission-reviewed", "decision-approved", "decision-blocked", "confirmation-recorded", "runtime-blocked"],
      sampleEvents: [
        { id: "audit-markdown-importer-manifest", pluginId: "markdown-importer", eventType: "manifest-loaded", decision: "recorded", actor: "system", evidence: ["phase20.plugin.manifest.v1", "memory.import.preview"] },
        { id: "audit-long-term-review-agent-permission", pluginId: "long-term-review-agent", eventType: "permission-reviewed", decision: "reviewed", actor: "human-review-required", evidence: ["agent.suggest", "memory.read.summary"] },
        { id: "audit-third-party-runtime-blocked", pluginId: "third-party-placeholder", eventType: "runtime-blocked", decision: "blocked", actor: "system", evidence: ["thirdPartyExecution=false", "networkAccessForPlugins=false"] }
      ],
      exportFields: ["phase20PlatformPlan.pluginAuditLog", "phase20PlatformPlan.permissionReview.auditEventTypes"],
      nextControls: ["tamper-evident-checksum", "audit-search", "reviewer-note"]
    },
    extensionContractTests: {
      schemaVersion: "phase20.extension.contract-tests.v1",
      status: "contract-tests-ready-runtime-disabled",
      runtimeExecution: false,
      coverage: ["importer", "exporter", "agent-tool", "asset-template", "sync-adapter"],
      requiredAssertions: [
        "declared-extension-point",
        "manifest-schema-version",
        "permission-labels-reviewed",
        "no-network-access",
        "no-secret-storage",
        "human-review-or-preview-output",
        "audit-event-emitted"
      ],
      contractSuites: [
        { id: "importer-contract", extensionPoint: "importer", status: "ready", samplePlugin: "markdown-importer", inputFixture: "markdown text", expectedOutput: "reviewable memory drafts", blockingFailure: "reject-import-preview" },
        { id: "exporter-contract", extensionPoint: "exporter", status: "ready", samplePlugin: "redacted-exporter", inputFixture: "memory collection", expectedOutput: "redacted export package", blockingFailure: "reject-export-package" },
        { id: "agent-tool-contract", extensionPoint: "agent-tool", status: "ready", samplePlugin: "long-term-review-agent", inputFixture: "memory summaries", expectedOutput: "reviewable suggestions", blockingFailure: "require-human-confirmation" },
        { id: "asset-template-contract", extensionPoint: "asset-template", status: "planned", samplePlugin: "asset-template-placeholder", inputFixture: "asset draft", expectedOutput: "editable sections", blockingFailure: "disable-template" },
        { id: "sync-adapter-contract", extensionPoint: "sync-adapter", status: "ready", samplePlugin: "manual-json-sync", inputFixture: "local-first sync package", expectedOutput: "conflict preview", blockingFailure: "manual-apply-only" }
      ],
      failurePolicy: "block-plugin-and-record-audit-event",
      exportFields: ["phase20PlatformPlan.extensionContractTests", "phase20PlatformPlan.extensionPoints"],
      nextControls: ["fixture-library", "negative-permission-tests", "sandbox-boundary-tests"]
    },
    sandboxBoundary: {
      schemaVersion: "phase20.plugin.sandbox-boundary.v1",
      status: "boundary-defined-runtime-disabled",
      runtimeExecution: false,
      isolationMode: "no-third-party-code-execution",
      trustZone: "built-in-manifest-only",
      blockedCapabilities: ["dynamic-code-eval", "filesystem-write", "network-request", "secret-read", "background-process", "direct-database-access"],
      allowedCapabilities: ["manifest-parse", "contract-fixture-check", "reviewable-draft-output", "redacted-export-preview", "audit-event-summary"],
      dataBoundary: {
        memoryAccess: "summary-or-explicit-draft-only",
        assetAccess: "metadata-preview-only",
        exportAccess: "redacted-package-only",
        syncAccess: "manual-preview-only"
      },
      enforcementChecks: [
        { id: "runtime-disabled", status: "ready", rule: "thirdPartyExecution=false" },
        { id: "network-blocked", status: "ready", rule: "networkAccessForPlugins=false" },
        { id: "secret-storage-blocked", status: "ready", rule: "secretStorage=false" },
        { id: "filesystem-blocked", status: "planned", rule: "no plugin filesystem write boundary before runtime" },
        { id: "database-blocked", status: "planned", rule: "plugins cannot receive direct sqlite handles" }
      ],
      handoffToRuntime: ["signed-manifest", "permission-review-approved", "contract-tests-passing", "audit-log-enabled", "sandbox-enforcer-implemented"],
      exportFields: ["phase20PlatformPlan.sandboxBoundary", "phase20PlatformPlan.securityModel"],
      nextControls: ["sandbox-enforcer", "signed-manifest-check", "resource-quota-policy"]
    },
    noCodeTemplatePack: {
      schemaVersion: "phase20.no-code.template-pack.v1",
      status: "template-pack-ready-runtime-disabled",
      runtimeExecution: false,
      owner: "local-platform",
      templateCount: 5,
      categories: ["importer", "exporter", "agent-tool", "asset-template", "sync-adapter"],
      templates: [
        { id: "memory-import-template", extensionPoint: "importer", status: "ready", input: "text-or-table", output: "reviewable memory drafts", controls: ["field-mapping", "dedupe-preview", "manual-apply"] },
        { id: "redacted-export-template", extensionPoint: "exporter", status: "ready", input: "memory collection", output: "redacted export package", controls: ["redaction-policy", "preview-only", "manual-download"] },
        { id: "review-agent-template", extensionPoint: "agent-tool", status: "ready", input: "memory summaries", output: "reviewable suggestions", controls: ["human-confirmation", "audit-event", "no-background-run"] },
        { id: "exhibition-layout-template", extensionPoint: "asset-template", status: "ready", input: "asset draft", output: "editable exhibition sections", controls: ["section-preview", "citation-required", "manual-save"] },
        { id: "sync-preview-template", extensionPoint: "sync-adapter", status: "ready", input: "local-first sync package", output: "conflict preview", controls: ["conflict-list", "per-item-decision", "manual-apply"] }
      ],
      guardrails: ["manifest-required", "permission-reviewed", "contract-tested", "sandbox-boundary-applied", "audit-summary-required"],
      authoringWorkflow: ["choose-template", "fill-metadata", "preview-fixture", "review-permissions", "export-template-json"],
      exportFields: ["phase20PlatformPlan.noCodeTemplatePack", "phase20PlatformPlan.extensionContractTests", "phase20PlatformPlan.sandboxBoundary"],
      nextControls: ["template-json-schema", "template-preview-fixtures", "template-signature"]
    },
    templatePreviewFixtures: {
      schemaVersion: "phase20.template.preview-fixtures.v1",
      status: "fixtures-ready-runtime-disabled",
      runtimeExecution: false,
      fixtureCount: 5,
      coverage: ["importer", "exporter", "agent-tool", "asset-template", "sync-adapter"],
      previewWorkflow: ["load-template", "load-fixture", "render-preview", "run-contract-assertions", "record-audit-summary", "block-or-mark-ready"],
      fixtures: [
        { id: "memory-import-fixture", templateId: "memory-import-template", extensionPoint: "importer", status: "passing", inputFixture: "two-row memory table", expectedPreview: "reviewable memory drafts", requiredAssertions: ["field-mapping-applied", "dedupe-preview-visible", "manual-apply-only"] },
        { id: "redacted-export-fixture", templateId: "redacted-export-template", extensionPoint: "exporter", status: "passing", inputFixture: "memory collection with sensitive fields", expectedPreview: "redacted export package", requiredAssertions: ["redaction-policy-applied", "download-preview-only", "audit-summary-present"] },
        { id: "review-agent-fixture", templateId: "review-agent-template", extensionPoint: "agent-tool", status: "passing", inputFixture: "memory summaries with weak signals", expectedPreview: "reviewable suggestions", requiredAssertions: ["human-confirmation-required", "no-background-run", "audit-event-emitted"] },
        { id: "exhibition-layout-fixture", templateId: "exhibition-layout-template", extensionPoint: "asset-template", status: "passing", inputFixture: "asset draft with citations", expectedPreview: "editable exhibition sections", requiredAssertions: ["citation-required", "manual-save-only", "section-preview-visible"] },
        { id: "sync-preview-fixture", templateId: "sync-preview-template", extensionPoint: "sync-adapter", status: "passing", inputFixture: "local-first sync conflict package", expectedPreview: "conflict preview", requiredAssertions: ["per-item-decision-required", "manual-apply-only", "sync-audit-summary"] }
      ],
      negativeFixtures: [
        { id: "network-request-negative", templateId: "sync-preview-template", status: "blocked", reason: "network-request", expectedDecision: "sandbox-boundary-violation" },
        { id: "missing-citation-negative", templateId: "exhibition-layout-template", status: "blocked", reason: "citation-required", expectedDecision: "template-preview-blocked" },
        { id: "auto-apply-negative", templateId: "memory-import-template", status: "blocked", reason: "manual-apply-only", expectedDecision: "contract-test-failed" }
      ],
      blockedWhen: ["fixture-missing", "expected-preview-mismatch", "required-assertion-failed", "negative-fixture-not-blocked", "audit-summary-missing"],
      exportFields: ["phase20PlatformPlan.templatePreviewFixtures", "phase20PlatformPlan.noCodeTemplatePack", "phase20PlatformPlan.extensionContractTests"],
      nextControls: ["fixture-authoring-ui", "fixture-result-history", "template-preview-diff"]
    },
    signedManifestPolicy: {
      schemaVersion: "phase20.signed.manifest-policy.v1",
      status: "signature-policy-ready-runtime-disabled",
      runtimeExecution: false,
      signatureRequired: true,
      algorithm: "sha256-manifest-digest-placeholder",
      signerTrust: "local-owner-or-built-in-only",
      signedFields: ["id", "version", "extensionPoint", "permissions", "entryPolicy", "dataAccess", "audit", "sandboxBoundary", "templatePack"],
      checksumFields: ["manifestSchema.schemaVersion", "permissionReview.defaultDecision", "extensionContractTests.schemaVersion", "sandboxBoundary.schemaVersion", "noCodeTemplatePack.schemaVersion"],
      verificationSteps: ["parse-manifest", "normalize-fields", "calculate-digest", "compare-signature", "check-signer-trust", "record-audit-event"],
      sampleSignatures: [
        { pluginId: "markdown-importer", status: "built-in-trusted", digest: "sha256:phase20-markdown-importer-manifest" },
        { pluginId: "redacted-exporter", status: "built-in-trusted", digest: "sha256:phase20-redacted-exporter-manifest" },
        { pluginId: "third-party-placeholder", status: "blocked-unsigned", digest: "missing" }
      ],
      blockedWhen: ["signature-missing", "digest-mismatch", "untrusted-signer", "manifest-mutated-after-review", "permissions-changed-after-signature"],
      exportFields: ["phase20PlatformPlan.signedManifestPolicy", "phase20PlatformPlan.manifestSchema", "phase20PlatformPlan.pluginAuditLog"],
      nextControls: ["signature-ui", "manifest-lockfile", "reviewer-countersignature"]
    },
    pluginInstallationWorkflow: {
      schemaVersion: "phase20.plugin.installation-workflow.v1",
      status: "install-workflow-ready-runtime-disabled",
      runtimeExecution: false,
      defaultDecision: "block-or-pending-review",
      installStates: ["manifest-imported", "signature-verified", "permissions-reviewed", "contract-tested", "sandbox-checked", "audit-recorded", "pending-human-review", "blocked"],
      requiredGates: ["manifest-schema-valid", "signature-trusted", "permissions-approved", "contract-tests-passing", "sandbox-boundary-passing", "audit-event-recorded"],
      workflowSteps: [
        { id: "import-manifest", status: "ready", input: "plugin manifest json", output: "normalized manifest draft", blockingFailure: "invalid-manifest" },
        { id: "verify-signature", status: "ready", input: "normalized manifest digest", output: "trusted-or-blocked signature result", blockingFailure: "signature-missing-or-mismatch" },
        { id: "review-permissions", status: "ready", input: "declared permissions", output: "approved or pending human review", blockingFailure: "permission-unreviewed" },
        { id: "run-contract-tests", status: "ready", input: "extension point fixture", output: "contract pass or block decision", blockingFailure: "contract-test-failed" },
        { id: "check-sandbox-boundary", status: "ready", input: "declared capabilities", output: "sandbox pass or blocked capability list", blockingFailure: "sandbox-boundary-violation" },
        { id: "record-install-audit", status: "ready", input: "gate decisions", output: "installation audit summary", blockingFailure: "audit-record-missing" }
      ],
      sampleDecisions: [
        { pluginId: "markdown-importer", state: "installed-built-in", decision: "approved", evidence: ["built-in-trusted", "contract-tests-passing", "audit-recorded"] },
        { pluginId: "review-agent-template", state: "pending-human-review", decision: "pending", evidence: ["agent.suggest", "confirmation-required"] },
        { pluginId: "third-party-placeholder", state: "blocked", decision: "blocked", evidence: ["signature-missing", "runtimeExecution=false"] }
      ],
      blockedWhen: ["invalid-manifest", "signature-missing-or-mismatch", "permission-unreviewed", "contract-test-failed", "sandbox-boundary-violation", "audit-record-missing"],
      exportFields: ["phase20PlatformPlan.pluginInstallationWorkflow", "phase20PlatformPlan.signedManifestPolicy", "phase20PlatformPlan.extensionContractTests", "phase20PlatformPlan.sandboxBoundary"],
      nextControls: ["installation-queue-ui", "reviewer-approval-record", "plugin-lockfile"]
    },
    securityModel: {
      defaultTrust: "built-in-only",
      thirdPartyExecution: false,
      networkAccessForPlugins: false,
      secretStorage: false,
      dataAccess: "explicit-export-or-reviewed-draft-only",
      requiredControls: ["manifest-review", "permission-labels", "human-confirmation", "audit-log", "redaction-before-share"]
    },
    readiness: {
      memoryCount: memories.length,
      importPlanReady: true,
      manifestSchemaReady: true,
      permissionReviewReady: true,
      pluginAuditLogReady: true,
      builtInRegistryReady: true,
      extensionContractTestsReady: true,
      sandboxBoundaryReady: true,
      noCodeTemplatePackReady: true,
      templatePreviewFixturesReady: true,
      signedManifestPolicyReady: true,
      pluginInstallationWorkflowReady: true,
      exportBoundaryReady: true,
      syncBoundaryReady: true,
      pluginRuntimeReady: false,
      recommendation: "第十一版已固定插件清单、扩展点、安全边界、模板预览 fixtures、签名策略和安装闸门；真实第三方插件运行时需要等权限、沙箱和审计闭环完成后再启用。"
    },
    nextMilestones: [
      "phase20-plugin-review-workflow",
      "phase20-plugin-lockfile"
    ]
  };
}

function buildLocalModuleBoundaryPlan() {
  return [
    { id: "routes", label: "HTTP routes", status: "split-active", rule: "第三版已迁移 health 与 operations 路由分发；后续继续拆 memories 和 privacy。" },
    { id: "health", label: "Health route", status: "split-stable", rule: "/api/health 已独立封装，继续保持 health smoke 覆盖。" },
    { id: "operations", label: "Operations", status: "split-stable", rule: "服务层和 route 层已分离；后续清理 server.js 旧实现并补更细的 route 测试。" },
    { id: "privacy", label: "Privacy", status: "ready-to-split", rule: "保持 /api/privacy 和数据主权导出字段兼容。" },
    { id: "agents", label: "Agent workflow", status: "split-after-routes", rule: "先用 smoke test 固定 workflow.run、steps、events 契约，再拆实现。" },
    { id: "frontend", label: "Frontend panels", status: "split-after-api", rule: "先按面板拆渲染函数，暂不引入构建工具。" }
  ];
}

function buildLocalPhase14Readiness() {
  const checks = [
    { id: "api-contract", label: "API 契约保护", status: "ready", detail: "api-smoke 已覆盖核心接口。" },
    { id: "operations-guard", label: "运维保护网", status: "ready", detail: "已有请求 ID、运行事件、日志和运维导出包。" },
    { id: "docs-route", label: "重构路线文档", status: "ready", detail: "项目规划和白皮书已声明阶段 14 模块化目标。" },
    { id: "module-plan", label: "模块边界清单", status: "ready", detail: "routes、operations、privacy、agents、frontend 边界已列出。" },
    { id: "data-safety", label: "数据安全回归", status: "ready", detail: "导入、导出、脱敏、清空、隐私策略均有回归。" },
    { id: "sample-signal", label: "演示样本信号", status: memories.length > 0 ? "ready" : "optional", detail: "无样本也可进入重构；有样本时更利于视觉回归。" }
  ];
  const readyCount = checks.filter((item) => item.status === "ready").length;
  return {
    targetPhase: 14,
    targetName: "工程模块化和服务边界重构",
    ready: readyCount >= 5,
    score: Math.round((readyCount / checks.length) * 100),
    checks,
    recommendedOrder: ["routes", "operations", "privacy", "agents", "rag", "workflow", "frontend-panels"],
    stopConditions: [
      "任一现有 API smoke 失败时暂停拆分",
      "导入导出结构变化时先补迁移说明",
      "前端面板拆分后必须保持无后端回退能力"
    ],
    recommendation: readyCount >= 5
      ? "阶段 14 第三版已完成 health 与 operations route split，并具备进入阶段 15 的基础保护网。"
      : "继续补齐 API 契约、运维导出和模块边界后再进入阶段 14。"
  };
}

function buildLocalPhase15AssetPlan() {
  return [
    { id: "saved-exhibitions", label: "可保存专题展", status: "ready-to-design", detail: "基于现有主题洞察、展品引用和导览词设计专题展字段。" },
    { id: "report-drafts", label: "回忆报告草稿", status: "ready-to-design", detail: "复用报告章节和引用来源，增加草稿、复核、发布、归档状态。" },
    { id: "citation-lock", label: "引用来源锁定", status: "ready", detail: "现有报告和讲解 citations 已保留展品引用，可作为资产证据来源。" },
    { id: "asset-export", label: "专题资产导出", status: "ready-to-design", detail: "在现有 JSON 导出包中增加 savedExhibitions 和 reportDrafts。" },
    { id: "sample-route", label: "样本路线", status: memories.length > 0 ? "ready" : "optional", detail: "可从当前展品生成第一条专题展；无样本时仍可先完成模型和接口。" }
  ];
}

function buildLocalPhase15Readiness() {
  const withSignals = memories.filter((memory) => (
    memory.date || memory.exhibitText || memory.tags?.length || memory.people?.length || memory.location || memory.emotions?.length
  )).length;
  const checks = [
    { id: "api-guard", label: "API 保护网", status: "ready", detail: "Phase 14 readiness 和 API smoke 已覆盖核心接口。" },
    { id: "route-boundary", label: "路由边界", status: "ready", detail: "health 与 operations routes 已从 server.js 抽离。" },
    { id: "insight-source", label: "洞察来源", status: "ready", detail: "时间线、主题候选、报告章节和引用来源已存在。" },
    { id: "workflow-source", label: "工作流来源", status: "ready", detail: "工作流蓝图已声明报告工作流与人工复核点。" },
    { id: "export-boundary", label: "导出边界", status: "ready", detail: "现有导出包可扩展专题资产字段。" },
    { id: "sample-quality", label: "样本质量", status: memories.length > 0 && withSignals > 0 ? "ready" : "optional", detail: "有样本可直接生成首个专题展；无样本时仍可先做资产模型。" }
  ];
  const readyCount = checks.filter((item) => item.status === "ready").length;
  return {
    targetPhase: 15,
    targetName: "专题资产、报告编辑和可保存展览",
    ready: readyCount >= 5,
    score: Math.round((readyCount / checks.length) * 100),
    checks,
    assetPlan: buildLocalPhase15AssetPlan(),
    recommendedFirstBuild: [
      "新增 savedExhibitions/reportDrafts 数据模型",
      "从主题候选一键生成专题展草稿",
      "让导出包包含专题资产与报告草稿",
      "前端增加可保存专题展编辑面板"
    ],
    recommendation: readyCount >= 5
      ? "可以进入阶段 15。建议先做可保存专题展和报告草稿模型，再做编辑与导出。"
      : "继续补齐专题资产模型、导出边界和报告引用来源后再进入阶段 15。"
  };
}

function buildLocalReleaseHistory() {
  return [
    { version: "1.0.10", label: "phase20-template-preview-fixtures", phase: 20, date: "2026-06-25", summary: "Phase 20 eleventh edition adds template preview fixtures, negative fixture blocking, preview workflows, and fixture export coverage while runtime execution stays disabled." },
    { version: "1.0.9", label: "phase20-plugin-installation-workflow", phase: 20, date: "2026-06-25", summary: "Phase 20 tenth edition adds a plugin installation workflow with manifest import, signature verification, permission review, contract tests, sandbox checks, and audit decisions while runtime execution stays disabled." },
    { version: "1.0.8", label: "phase20-signed-plugin-manifest", phase: 20, date: "2026-06-25", summary: "Phase 20 ninth edition adds signed manifest policy, digest fields, trust checks, and blocked unsigned plugin samples while runtime execution stays disabled." },
    { version: "1.0.7", label: "phase20-no-code-template-pack", phase: 20, date: "2026-06-25", summary: "Phase 20 eighth edition adds no-code template packs for importer, exporter, agent-tool, asset-template, and sync-adapter extension points while runtime execution stays disabled." },
    { version: "1.0.6", label: "phase20-plugin-sandbox-boundary", phase: 20, date: "2026-06-25", summary: "Phase 20 seventh edition defines plugin sandbox boundaries, blocked capabilities, data access limits, and runtime handoff gates while execution stays disabled." },
    { version: "1.0.5", label: "phase20-extension-contract-tests", phase: 20, date: "2026-06-25", summary: "Phase 20 sixth edition adds extension contract test suites, fixture expectations, failure policy, and readiness coverage while plugin runtime stays disabled." },
    { version: "1.0.4", label: "phase20-built-in-plugin-registry", phase: 20, date: "2026-06-25", summary: "阶段 20 第五版补充内置插件注册表、能力目录、输入输出契约和注册表检查项。" },
    { version: "1.0.3", label: "phase20-plugin-audit-log", phase: 20, date: "2026-06-25", summary: "阶段 20 第四版补充插件审计日志模型、审计事件 schema、运行阻断样例和导出字段。" },
    { version: "1.0.2", label: "phase20-plugin-permission-review", phase: 20, date: "2026-06-25", summary: "阶段 20 第三版补充插件权限复核策略、默认拒绝、人工确认、内置插件决策和审计事件类型。" },
    { version: "1.0.1", label: "phase20-plugin-manifest-schema", phase: 20, date: "2026-06-25", summary: "阶段 20 第二版补充插件 manifest schema、权限标签、扩展点契约和内置插件 manifest 摘要，真实插件运行时继续关闭。" },
    { version: "1.0.0", label: "phase20-platform-plugin-first-edition", phase: 20, date: "2026-06-25", summary: "阶段 20 第一版启动可扩展产品平台和插件生态边界，新增插件清单、扩展点、安全策略和 readiness 检查。" },
    { version: "0.9.8", label: "phase19-import-audit-ninth-edition", phase: 19, date: "2026-06-24", summary: "阶段 19 第九版补充复核状态流转、字段别名规则、导入报告视图和批次审计检索。" },
    { version: "0.9.7", label: "phase19-import-review-eighth-edition", phase: 19, date: "2026-06-24", summary: "阶段 19 第八版补充模板规则默认值、导入后整理队列、冲突复核台和批次审计导出。" },
    { version: "0.9.6", label: "phase19-import-conflict-seventh-edition", phase: 19, date: "2026-06-24", summary: "阶段 19 第七版补充自定义映射模板、重复项导入决策、导入前冲突预览和批次筛选对比。" },
    { version: "0.9.5", label: "phase19-import-template-sixth-edition", phase: 19, date: "2026-06-24", summary: "阶段 19 第六版补充字段映射模板、批次命名、重复项预判和跨批次对比。" },
    { version: "0.9.4", label: "phase19-import-recovery-fifth-edition", phase: 19, date: "2026-06-24", summary: "阶段 19 第五版补充失败项保留、批次内单项撤销、补全任务状态回看和质量趋势。" },
    { version: "0.9.3", label: "phase19-import-quality-fourth-edition", phase: 19, date: "2026-06-24", summary: "阶段 19 第四版补充导入完整度评分、批次详情和第十八阶段补全任务。" },
    { version: "0.9.2", label: "phase19-import-batch-third-edition", phase: 19, date: "2026-06-24", summary: "阶段 19 第三版补充草稿字段编辑、导入批次记录和批次撤销。" },
    { version: "0.9.1", label: "phase19-import-cleanup-second-edition", phase: 19, date: "2026-06-24", summary: "阶段 19 第二版补充导入清洗策略、CSV 分隔符容错、聊天聚合、草稿选择和来源追踪。" },
    { version: "0.9.0", label: "phase19-external-import-first-edition", phase: 19, date: "2026-06-24", summary: "阶段 19 第一版启动外部资料导入预览，支持文本、Markdown、CSV、JSON 和聊天片段生成展品草稿。" },
    { version: "0.8.12", label: "phase18-agent-digest-thirteenth-edition", phase: 18, date: "2026-06-24", summary: "阶段 18 第十三版补充长期助理摘要、今日/本周焦点和摘要任务入口。" },
    { version: "0.8.11", label: "phase18-graph-asset-navigation-twelfth-edition", phase: 18, date: "2026-06-24", summary: "阶段 18 第十二版补充关系图谱与专题展/报告的双向跳转。" },
    { version: "0.8.10", label: "phase18-sync-asset-link-eleventh-edition", phase: 18, date: "2026-06-24", summary: "阶段 18 第十一版补充资产同步状态、第十七阶段同步提示联动和导出结构。" },
    { version: "0.8.9", label: "phase18-batch-task-tenth-edition", phase: 18, date: "2026-06-24", summary: "阶段 18 第十版补充复盘任务批量选择、批量状态流转和批量生成修复草案。" },
    { version: "0.8.8", label: "phase18-noise-rule-ninth-edition", phase: 18, date: "2026-06-24", summary: "阶段 18 第九版补充可配置降噪规则、规则预览和被收起建议恢复提示。" },
    { version: "0.8.7", label: "phase18-sync-bridge-eighth-edition", phase: 18, date: "2026-06-24", summary: "阶段 18 第八版补充第十七阶段同步维护桥接、复盘任务生成和图谱节点打开展品。" },
    { version: "0.8.6", label: "phase18-review-dashboard-seventh-edition", phase: 18, date: "2026-06-24", summary: "阶段 18 第七版补充长期助理复盘面板、建议自动降噪、关系图筛选和资产/报告回看入口。" },
    { version: "0.8.5", label: "phase18-review-report-sixth-edition", phase: 18, date: "2026-06-24", summary: "阶段 18 第六版补充周期回顾报告草稿、建议质量分层和关系图谱。" },
    { version: "0.8.4", label: "phase18-review-assets-fifth-edition", phase: 18, date: "2026-06-24", summary: "阶段 18 第五版补充周期回顾生成专题资产、Agent 质量统计和跨展品关系证据增强。" },
    { version: "0.8.3", label: "phase18-audit-batch-fourth-edition", phase: 18, date: "2026-06-24", summary: "阶段 18 第四版补充长期任务审计、批量应用前复核和修复草案批量处理。" },
    { version: "0.8.2", label: "phase18-task-queue-third-edition", phase: 18, date: "2026-06-24", summary: "阶段 18 第三版补充长期任务队列持久化、筛选、状态流转和清理能力。" },
    { version: "0.8.1", label: "phase18-repair-draft-second-edition", phase: 18, date: "2026-06-24", summary: "阶段 18 第二版补充建议采纳后的半自动修复草案、预览和逐条应用。" },
    { version: "0.8.0", label: "phase18-long-term-agent-first-edition", phase: 18, date: "2026-06-24", summary: "阶段 18 第一版启动长期记忆助理、主动整理建议、跨展品关系、周期回顾和反馈闭环。" },
    { version: "0.7.5", label: "phase17-sync-health-sixth-edition", phase: 17, date: "2026-06-24", summary: "阶段 17 第六版补充同步健康度，汇总设备信任、队列状态、局域网握手和私有云边界。" },
    { version: "0.7.4", label: "phase17-private-cloud-boundary-fifth-edition", phase: 17, date: "2026-06-24", summary: "阶段 17 第五版补充私有云适配配置边界，默认关闭且不保存密钥。" },
    { version: "0.7.3", label: "phase17-device-trust-fourth-edition", phase: 17, date: "2026-06-24", summary: "阶段 17 第四版补充设备信任策略、待复核设备和阻止设备状态。" },
    { version: "0.7.2", label: "phase17-queue-state-third-edition", phase: 17, date: "2026-06-24", summary: "阶段 17 第三版补充同步队列状态机和任务推进操作。" },
    { version: "0.7.1", label: "phase17-lan-handshake-second-edition", phase: 17, date: "2026-06-24", summary: "阶段 17 第二版补充局域网只读握手模拟和本机同步指纹。" },
    { version: "0.7.0", label: "phase17-sync-adapter-first-edition", phase: 17, date: "2026-06-24", summary: "阶段 17 第一版启动真实多设备同步适配层、设备注册表、同步队列和通道占位。" },
    { version: "0.6.4", label: "phase16-asset-merge-fifth-edition", phase: 16, date: "2026-06-23", summary: "阶段 16 第五版补充旧包兼容说明和专题资产逐项合并预览。" },
    { version: "0.6.3", label: "phase16-risk-audit-fourth-edition", phase: 16, date: "2026-06-23", summary: "阶段 16 第四版补充导入前风险确认和同步审计筛选。" },
    { version: "0.6.2", label: "phase16-quality-drill-third-edition", phase: 16, date: "2026-06-23", summary: "阶段 16 第三版补充同步包质量检查、恢复演练报告和专题资产同步边界。" },
    { version: "0.6.1", label: "phase16-conflict-audit-second-edition", phase: 16, date: "2026-06-23", summary: "阶段 16 第二版补充逐项冲突决策、同步审计记录和同步面板信息层级。" },
    { version: "0.6.0", label: "phase16-sync-preview-first-edition", phase: 16, date: "2026-06-23", summary: "阶段 16 第一版启动手动同步包、导入冲突预览和本地优先写入策略。" },
    { version: "0.5.16", label: "phase15-experience-polish-seventeenth-edition", phase: 15, date: "2026-06-23", summary: "阶段 15 第十七版优化展品墙主路径、阶段文案、资产工作台降噪和恢复说明。" },
    { version: "0.5.15", label: "phase15-asset-recovery-search-sixteenth-edition", phase: 15, date: "2026-06-23", summary: "阶段 15 第十六版补充快照选择对比、审计记录搜索和签名异常修复建议。" },
    { version: "0.5.14", label: "phase15-asset-restore-fifteenth-edition", phase: 15, date: "2026-06-23", summary: "阶段 15 第十五版补充签名异常处理、快照导出恢复入口和审计筛选摘要。" },
    { version: "0.5.13", label: "phase15-asset-signature-fourteenth-edition", phase: 15, date: "2026-06-23", summary: "阶段 15 第十四版补充快照对比恢复、审计记录筛选和发布包签名校验。" },
    { version: "0.5.12", label: "phase15-asset-recovery-thirteenth-edition", phase: 15, date: "2026-06-23", summary: "阶段 15 第十三版补充审计日志导入恢复、资产版本快照和发布包校验摘要。" },
    { version: "0.5.11", label: "phase15-asset-audit-twelfth-edition", phase: 15, date: "2026-06-23", summary: "阶段 15 第十二版补充发布记录时间线、批量操作审计和资产包内容对比。" },
    { version: "0.5.10", label: "phase15-asset-batch-eleventh-edition", phase: 15, date: "2026-06-23", summary: "阶段 15 第十一版补充批量状态操作、发布前差异预览和资产包明细清单。" },
    { version: "0.5.9", label: "phase15-asset-workbench-tenth-edition", phase: 15, date: "2026-06-23", summary: "阶段 15 第十版补充资产发布状态流转、修复入口和导出清单过滤。" },
    { version: "0.5.8", label: "phase15-asset-review-ninth-edition", phase: 15, date: "2026-06-23", summary: "阶段 15 第九版补充资产引用关系图、草稿修复建议和导出前质量确认。" },
    { version: "0.5.7", label: "phase15-asset-quality-eighth-edition", phase: 15, date: "2026-06-23", summary: "阶段 15 第八版补充导出包质量预览、发布前字段校验和资产完整度提示。" },
    { version: "0.5.6", label: "phase15-asset-guided-editing-seventh-edition", phase: 15, date: "2026-06-23", summary: "阶段 15 第七版支持从已保存展品插入排序/引用、排序上移下移和完整导出包预览摘要。" },
    { version: "0.5.5", label: "phase15-asset-export-preview-sixth-edition", phase: 15, date: "2026-06-23", summary: "阶段 15 第六版支持专题展展品排序、报告引用编辑和单个资产导出预览。" },
    { version: "0.5.4", label: "phase15-asset-editing-fifth-edition", phase: 15, date: "2026-06-23", summary: "阶段 15 第五版支持在详情弹窗内编辑专题展和报告草稿核心字段。" },
    { version: "0.5.3", label: "phase15-asset-management-fourth-edition", phase: 15, date: "2026-06-23", summary: "阶段 15 第四版补充专题资产详情、刷新和删除管理体验。" },
    { version: "0.5.2", label: "phase15-frontend-assets-third-edition", phase: 15, date: "2026-06-23", summary: "阶段 15 第三版把专题资产闭环接入前端，支持保存主题展、生成报告草稿并展示已保存资产。" },
    { version: "0.5.1", label: "phase15-insight-assets-second-edition", phase: 15, date: "2026-06-23", summary: "阶段 15 第二版新增从主题洞察生成专题展草稿、从 insights 生成报告草稿，并修复资产创建状态码判断。" },
    { version: "0.5.0", label: "phase15-assets-first-edition", phase: 15, date: "2026-06-23", summary: "阶段 15 第一版启动专题资产建设，新增可保存专题展和回忆报告草稿的数据模型、API 与导出边界。" },
    { version: "0.4.2", label: "phase14-health-route-phase15-readiness-third-edition", phase: 14, date: "2026-06-23", summary: "阶段 14 第三版新增 src/routes/health.js，/api/health 从 server.js 抽离，并补充第十五阶段 readiness 和专题资产计划。" },
    { version: "0.4.1", label: "phase14-operations-route-split-second-edition", phase: 14, date: "2026-06-23", summary: "阶段 14 第二版新增 src/routes/operations.js，/api/version、/api/operations 和 /api/operations/export 的路由分发从 server.js 抽离。" },
    { version: "0.4.0", label: "phase14-operations-service-split-first-edition", phase: 14, date: "2026-06-23", summary: "阶段 14 第一版抽离 operations 服务边界，版本、运维摘要、发布记录、演示包和阶段 14 readiness 改由 src/services/operations.js 提供。" },
    { version: "0.3.4", label: "phase13-phase14-readiness-edition", phase: 13, date: "2026-06-23", summary: "第五版补充第十四阶段 readiness、模块边界计划、迁移顺序和页面进入阶段 14 判断。" },
    { version: "0.3.3", label: "phase13-operations-fourth-edition", phase: 13, date: "2026-06-23", summary: "第四版补充持久化 JSONL 运维日志、/api/operations/export、演示包摘要和页面日志/演示面板。" },
    { version: "0.3.2", label: "phase13-operations-third-edition", phase: 13, date: "2026-06-22", summary: "第三版补充 X-Request-Id、/api/operations、最近运行事件、发布记录和页面运行事件面板。" },
    { version: "0.3.1", label: "phase13-operations-second-edition", phase: 13, date: "2026-06-22", summary: "第二版补充发布清单、运行手册、部署模式、备份策略和风险登记。" },
    { version: "0.3.0", label: "phase13-operations-first-edition", phase: 13, date: "2026-06-22", summary: "第一版补充 /api/version、operations 健康摘要和部署与运维面板。" }
  ];
}

function getVersionInfo() {
  if (versionInfo?.phase >= 15) {
    operationsSource = "server";
    return versionInfo;
  }
  operationsSource = "local";
  return buildLocalVersionInfo();
}

async function syncVersionInfo({ quiet = false } = {}) {
  if (!databaseAvailable && !quiet) {
    versionInfo = null;
    operationsSource = "local";
    renderOperationsPanel();
    renderPhase20PlatformPanel();
    return null;
  }
  try {
    const response = await fetch(API_VERSION);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    if ((payload?.phase || 0) < 15) throw new Error("version info is invalid");
    versionInfo = payload;
    operationsSource = "server";
    renderOperationsPanel();
    renderPhase20PlatformPanel();
    return payload;
  } catch {
    versionInfo = null;
    operationsSource = "local";
    if (!quiet) {
      renderOperationsPanel();
      renderPhase20PlatformPanel();
    }
    return null;
  }
}

function buildPhase10Insights(items = [], filters = {}) {
  const structuredAll = items.map(buildStructuredMemory);
  const structured = filterInsightMemories(structuredAll, filters);
  return {
    filters: normalizeInsightFilters(filters),
    sourceTotal: structuredAll.length,
    filteredTotal: structured.length,
    handoff: buildPhase10Handoff(structured),
    timeline: buildTimelineInsights(structured),
    themes: buildThemeInsights(structured),
    report: buildMemoryReport(structured)
  };
}

function normalizeInsightFilters(filters = {}) {
  return {
    hall: limitText(filters.hall, 40),
    year: /^\d{4}$/.test(String(filters.year || "")) ? String(filters.year) : "",
    theme: limitText(filters.theme, 80)
  };
}

function filterInsightMemories(items = [], filters = {}) {
  const normalized = normalizeInsightFilters(filters);
  const theme = normalized.theme.toLowerCase();
  return items.filter((memory) => {
    const hallId = memory.hall?.id || memory.hall;
    if (normalized.hall && normalized.hall !== "all" && hallId !== normalized.hall) return false;
    if (normalized.year) {
      const date = memory.date || memory.createdAt || "";
      if (!String(date).startsWith(normalized.year)) return false;
    }
    if (theme) {
      const haystack = [
        memory.title,
        memory.exhibitText,
        memory.rawContent,
        memory.location,
        memory.sourceType,
        memory.coverImage,
        memory.mediaNote,
        memory.hall?.name,
        ...(memory.people || []),
        ...(memory.tags || []),
        ...(memory.emotions || []),
        ...(memory.attachments || []).flatMap((item) => [item.name, item.type, item.note])
      ].join(" ").toLowerCase();
      if (!haystack.includes(theme)) return false;
    }
    return true;
  });
}

function buildTimelineInsights(items = []) {
  const groups = items.reduce((map, memory) => {
    const period = getMemoryPeriod(memory);
    if (!map.has(period.key)) {
      map.set(period.key, { ...period, count: 0, mediaCount: 0, emotions: {}, memories: [] });
    }
    const group = map.get(period.key);
    group.count += 1;
    if (hasMultimodalMetadata(memory)) group.mediaCount += 1;
    group.memories.push(buildMemoryReference(memory));
    (memory.emotions || []).forEach((emotion) => {
      group.emotions[emotion] = (group.emotions[emotion] || 0) + 1;
    });
    return map;
  }, new Map());

  return [...groups.values()]
    .sort((a, b) => b.sortValue.localeCompare(a.sortValue))
    .map((group) => ({
      key: group.key,
      label: group.label,
      count: group.count,
      mediaCount: group.mediaCount,
      topEmotions: toTopEntries(group.emotions, 3),
      memories: group.memories.slice(0, 5)
    }));
}

function buildThemeInsights(items = []) {
  const themeMap = new Map();
  items.forEach((memory) => {
    addThemeValue(themeMap, "展厅", memory.hall?.name || getHallName(memory.hall?.id), memory);
    addThemeValue(themeMap, "来源", memory.sourceType, memory);
    (memory.people || []).forEach((value) => addThemeValue(themeMap, "人物", value, memory));
    (memory.tags || []).forEach((value) => addThemeValue(themeMap, "标签", value, memory));
    (memory.emotions || []).forEach((value) => addThemeValue(themeMap, "情绪", value, memory));
    if (memory.location) addThemeValue(themeMap, "地点", memory.location, memory);
  });

  return [...themeMap.values()]
    .sort((a, b) => b.count - a.count || b.mediaCount - a.mediaCount || a.title.localeCompare(b.title, "zh-CN"))
    .slice(0, 8)
    .map((theme) => ({
      type: theme.type,
      title: theme.title,
      count: theme.count,
      mediaCount: theme.mediaCount,
      description: buildThemeDescription(theme),
      coverMemory: theme.memories[0] || null,
      topEmotions: toTopEntries(theme.emotions, 3),
      memories: theme.memories.slice(0, 4)
    }));
}

function buildThemeDescription(theme) {
  const emotion = toTopEntries(theme.emotions, 1)[0]?.label || "平静";
  const mediaText = theme.mediaCount ? `其中 ${theme.mediaCount} 件带有多模态线索` : "目前主要由文字线索构成";
  return `${theme.type}“${theme.title}”串联了 ${theme.count} 件展品，主导情绪偏向“${emotion}”，${mediaText}。`;
}

function addThemeValue(themeMap, type, value, memory) {
  const title = limitText(value, 40);
  if (!title) return;
  const key = `${type}:${title}`;
  if (!themeMap.has(key)) {
    themeMap.set(key, { type, title, count: 0, mediaCount: 0, emotions: {}, memories: [] });
  }
  const theme = themeMap.get(key);
  theme.count += 1;
  if (hasMultimodalMetadata(memory)) theme.mediaCount += 1;
  theme.memories.push(buildMemoryReference(memory));
  (memory.emotions || []).forEach((emotion) => {
    theme.emotions[emotion] = (theme.emotions[emotion] || 0) + 1;
  });
}

function buildMemoryReport(items = []) {
  const total = items.length;
  const favoriteCount = items.filter((memory) => memory.favorite).length;
  const multimodalCount = items.filter(hasMultimodalMetadata).length;
  const topEmotions = toTopEntries(countValues(items.flatMap((memory) => memory.emotions || [])), 5);
  const topTags = toTopEntries(countValues(items.flatMap((memory) => memory.tags || [])), 5);
  const topPeople = toTopEntries(countValues(items.flatMap((memory) => memory.people || [])), 5);
  const topLocations = toTopEntries(countValues(items.map((memory) => memory.location).filter(Boolean)), 5);
  const halls = toTopEntries(countValues(items.map((memory) => memory.hall?.name || getHallName(memory.hall?.id))), 6);
  const dateRange = buildDateRange(items);
  const highlights = [...items]
    .sort((a, b) => Number(b.favorite) - Number(a.favorite) || (b.importance || 1) - (a.importance || 1))
    .slice(0, 3)
    .map(buildMemoryReference);
  const references = highlights.map((memory, index) => ({
    ...memory,
    role: index === 0 ? "开篇展品" : "支撑展品"
  }));
  const dominantEmotion = topEmotions[0]?.label || "平静";
  const dominantTag = topTags[0]?.label || halls[0]?.label || "日常";
  const sections = buildReportSections({
    total,
    dominantTag,
    dominantEmotion,
    favoriteCount,
    multimodalCount,
    dateRange,
    topPeople,
    topLocations,
    highlights
  });

  return {
    total,
    favoriteCount,
    multimodalCount,
    topEmotions,
    topTags,
    topPeople,
    topLocations,
    halls,
    dateRange,
    highlights,
    references,
    sections,
    summary: total
      ? `这批记忆共 ${total} 件展品，主要围绕“${dominantTag}”展开，最明显的情绪是“${dominantEmotion}”。其中 ${favoriteCount} 件被标记为重点展品，${multimodalCount} 件带有照片、OCR、语音或附件线索。`
      : "当前还没有展品，保存几段记忆后可以生成时间线、主题展和回忆报告。",
    nextQuestions: [
      "按月份看，这些记忆在哪些阶段最密集？",
      "哪些人物、地点或标签适合组成主题展？",
      "哪些重点展品适合作为年度回忆报告开头？"
    ]
  };
}

function buildDateRange(items = []) {
  const dates = items
    .map((memory) => memory.date)
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
    .sort();
  return dates.length ? { start: dates[0], end: dates[dates.length - 1] } : { start: "", end: "" };
}

function buildReportSections({ total, dominantTag, dominantEmotion, favoriteCount, multimodalCount, dateRange, topPeople, topLocations, highlights }) {
  if (!total) return [];
  const rangeText = dateRange.start
    ? dateRange.start === dateRange.end ? dateRange.start : `${dateRange.start} 至 ${dateRange.end}`
    : "尚未形成明确时间范围";
  const peopleText = topPeople.length ? topPeople.slice(0, 3).map((item) => item.label).join("、") : "暂未形成高频人物";
  const locationText = topLocations.length ? topLocations.slice(0, 3).map((item) => item.label).join("、") : "暂未形成高频地点";
  const highlightText = highlights.length ? highlights.map((memory) => `《${memory.title}》`).join("、") : "暂未选出重点展品";
  return [
    { title: "时间范围", text: `这批记忆覆盖 ${rangeText}，可以作为时间线回看的起点。` },
    { title: "主题主线", text: `当前最明显的主题是“${dominantTag}”，主导情绪是“${dominantEmotion}”。` },
    { title: "人物与地点", text: `人物线索集中在 ${peopleText}；地点线索集中在 ${locationText}。` },
    { title: "报告开头", text: `建议从 ${highlightText} 开始讲述，其中 ${favoriteCount} 件是重点展品，${multimodalCount} 件带多模态线索。` }
  ];
}

function getMemoryPeriod(memory) {
  const rawDate = memory.date || memory.createdAt || "";
  const match = String(rawDate).match(/^(\d{4})(?:-(\d{2}))?/);
  if (!match) return { key: "undated", label: "未标注时间", sortValue: "0000-00" };
  const year = match[1];
  const month = match[2] || "00";
  return {
    key: `${year}-${month}`,
    label: month === "00" ? `${year} 年` : `${year} 年 ${month} 月`,
    sortValue: `${year}-${month}`
  };
}

function buildMemoryReference(memory) {
  return {
    id: memory.id,
    title: memory.title,
    hall: memory.hall?.name || getHallName(memory.hall?.id),
    date: memory.date || "",
    importance: memory.importance,
    favorite: memory.favorite,
    media: hasMultimodalMetadata(memory)
  };
}

function countValues(values = []) {
  return values.filter(Boolean).reduce((counts, value) => {
    counts[value] = (counts[value] || 0) + 1;
    return counts;
  }, {});
}

function toTopEntries(counts = {}, maxItems = 5) {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN"))
    .slice(0, maxItems)
    .map(([label, count]) => ({ label, count }));
}

function renderHallSelect() {
  elements.hallSelect.innerHTML = halls
    .filter((hall) => hall.id !== "all")
    .map((hall) => `<option value="${hall.id}">${escapeHtml(hall.name)}</option>`)
    .join("");
}

function renderEmotionOptions() {
  elements.emotionOptions.innerHTML = emotionOptions
    .map((emotion) => `<label><input type="checkbox" name="emotion" value="${escapeHtml(emotion)}" />${escapeHtml(emotion)}</label>`)
    .join("");
}

function renderEmotionFilter() {
  const usedEmotions = [...new Set(memories.flatMap((memory) => memory.emotions || []))].sort((a, b) => a.localeCompare(b, "zh-CN"));
  const options = [
    `<option value="all">全部情绪</option>`,
    `<option value="favorite">重点展品</option>`,
    `<option value="media">多模态线索</option>`,
    ...usedEmotions.map((emotion) => `<option value="${escapeHtml(emotion)}">${escapeHtml(emotion)}</option>`)
  ];
  elements.emotionFilterSelect.innerHTML = options.join("");
  elements.emotionFilterSelect.value = usedEmotions.includes(emotionFilter) || ["favorite", "media"].includes(emotionFilter) ? emotionFilter : "all";
  emotionFilter = elements.emotionFilterSelect.value;
}

function renderHallNav() {
  elements.hallNav.innerHTML = halls.map((hall) => {
    const count = hall.id === "all" ? memories.length : memories.filter((memory) => memory.hall === hall.id).length;
    const activeClass = activeHall === hall.id ? "active" : "";
    return `<button class="hall-button ${activeClass}" type="button" data-hall="${hall.id}"><span>${escapeHtml(hall.name)}</span><small>${count}</small></button>`;
  }).join("");

  elements.hallNav.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      activeHall = button.dataset.hall;
      render();
    });
  });
}

function filteredMemories() {
  const keyword = searchKeyword.toLowerCase();
  const list = memories.filter((memory) => {
    const hallMatch = activeHall === "all" || memory.hall === activeHall;
    const emotionMatch = emotionFilter === "all"
      || (emotionFilter === "favorite" && memory.favorite)
      || (emotionFilter === "media" && hasMultimodalMetadata(memory))
      || (memory.emotions || []).includes(emotionFilter);
    const haystack = [
      memory.title,
      memory.rawContent,
      memory.exhibitText,
      memory.location,
      memory.date,
      memory.createdAt,
      memory.coverImage,
      memory.mediaNote,
      memory.sourceType,
      getImportanceLabel(memory.importance),
      ...(memory.people || []),
      ...(memory.tags || []),
      ...(memory.emotions || []),
      ...(memory.attachments || []).flatMap((item) => typeof item === "string" ? [item] : [item.name, item.type, item.note])
    ].join(" ").toLowerCase();
    const keywordMatch = !keyword || haystack.includes(keyword);
    return hallMatch && emotionMatch && keywordMatch;
  });

  return [...list].sort((a, b) => {
    if (sortMode === "oldest") return new Date(a.createdAt) - new Date(b.createdAt);
    if (sortMode === "title") return a.title.localeCompare(b.title, "zh-CN");
    if (sortMode === "importance") return (b.importance || 1) - (a.importance || 1) || new Date(b.createdAt) - new Date(a.createdAt);
    if (sortMode === "intensity") return (b.emotionIntensity || 1) - (a.emotionIntensity || 1) || new Date(b.createdAt) - new Date(a.createdAt);
    return new Date(b.createdAt) - new Date(a.createdAt);
  });
}

function renderStats() {
  const uniqueTags = new Set(memories.flatMap((memory) => memory.tags || []));
  const uniqueEmotions = new Set(memories.flatMap((memory) => memory.emotions || []));
  const usedHalls = new Set(memories.map((memory) => memory.hall));
  const linkedAgentRuns = new Set(memories.map((memory) => memory.agentRunId).filter(Boolean));
  const localMultimodal = memories.filter(hasMultimodalMetadata).length;
  elements.memoryCount.textContent = memories.length;
  elements.hallCount.textContent = usedHalls.size;
  elements.tagCount.textContent = uniqueTags.size;
  elements.emotionCount.textContent = uniqueEmotions.size;
  const backendMultimodal = Number(backendStats?.multimodal);
  elements.mediaCount.textContent = Number.isFinite(backendMultimodal)
    ? Math.max(backendMultimodal, localMultimodal)
    : localMultimodal;
  const backendAgentRuns = Number(backendStats?.agentRuns);
  elements.agentRunCount.textContent = Number.isFinite(backendAgentRuns)
    ? Math.max(backendAgentRuns, linkedAgentRuns.size)
    : linkedAgentRuns.size;
}

function hasMultimodalMetadata(memory = {}) {
  return Boolean(
    memory.coverImage
    || memory.mediaNote
    || normalizeAttachments(memory.attachments).length
  );
}

function renderFormMode() {
  const editingMemory = memories.find((memory) => memory.id === editingId);
  elements.saveButton.textContent = editingMemory ? "保存修改" : "保存为展品";
  elements.cancelEditButton.classList.toggle("is-hidden", !editingMemory);
  elements.formModeHint.textContent = editingMemory
    ? `正在编辑《${editingMemory.title}》。保存后会更新原展品，不会创建副本。`
    : "写下原始记忆后，可以让后端 AI 生成展品草稿。";
  renderDraftPreview();
}

function setAiStatus(message, type = "neutral") {
  elements.aiStatus.textContent = message;
  elements.aiStatus.dataset.status = type;
}

function setAnalyzePending(isPending) {
  isAnalyzing = isPending;
  elements.mockAiButton.disabled = isPending;
  elements.mockAiButton.textContent = isPending ? AI_BUTTON_PENDING_TEXT : AI_BUTTON_TEXT;
  elements.sampleButton.disabled = isPending;
  elements.saveButton.disabled = isPending || isPersisting;
  elements.resetButton.disabled = isPending;
  elements.cancelEditButton.disabled = isPending;
  updateAgentActionState();
}

function setGuidePending(isPending) {
  isGuideAsking = isPending;
  updateGuideAskState();
  elements.guideAskButton.textContent = isPending ? "检索中..." : "提问";
  document.querySelectorAll("[data-question]").forEach((button) => {
    button.disabled = isPending;
  });
}

function updateGuideAskState() {
  const hasQuestion = elements.guideQuestionInput.value.trim().length > 0;
  elements.guideAskButton.disabled = isGuideAsking || !hasQuestion;
}

function renderDraftPreview() {
  const raw = elements.rawContent.value.trim();
  const title = elements.titleInput.value.trim() || (raw ? mockAnalyzeMemory(raw).title : "等待一段记忆");
  const hallName = getHallName(elements.hallSelect.value || "daily");
  const emotions = selectedEmotions();
  const tags = splitList(elements.tagsInput.value).slice(0, 4);
  const people = splitList(elements.peopleInput.value).slice(0, 3);
  const exhibitText = elements.exhibitText.value.trim();
  const coverImage = elements.coverImageInput.value.trim();
  const mediaNote = elements.mediaNoteInput.value.trim();
  const attachments = normalizeAttachments(elements.attachmentsInput.value);
  const workflowStatus = latestAgentWorkflow?.summary?.nextAction || (raw ? "可运行 Agent 整理" : "先写下原始记忆");
  const attachmentPreview = attachments.slice(0, 3).map((item) => `${item.name}${item.type ? ` / ${item.type}` : ""}`).join("；");
  const attachmentTypeSummary = formatAttachmentTypeSummary(attachments);
  const chips = [
    ...emotions.slice(0, 3),
    ...tags.slice(0, Math.max(0, 4 - Math.min(emotions.length, 3)))
  ];
  const previewText = exhibitText || mediaNote || (raw ? limitText(raw, 90) : "这里会显示即将入馆的展品草稿。");

  elements.draftPreview.innerHTML = `
    <div class="draft-preview-card">
      <span class="preview-stamp">草稿</span>
      <p class="eyebrow">Exhibit Draft</p>
      <h4>${escapeHtml(title)}</h4>
      <p>${escapeHtml(previewText)}</p>
      <div class="preview-chip-row">
        <span>${escapeHtml(hallName)}</span>
        <span>${escapeHtml(getImportanceLabel(Number(elements.importanceSelect.value) || 3))}</span>
        ${coverImage ? "<span>封面线索</span>" : ""}
        ${attachments.length ? `<span>${attachments.length} 个附件</span>` : ""}
        ${elements.favoriteInput.checked ? "<span>重点展品</span>" : ""}
      </div>
      <div class="preview-chip-row">
        ${chips.length ? chips.map((item) => `<span>${escapeHtml(item)}</span>`).join("") : "<span>等待情绪和标签</span>"}
      </div>
      <div class="preview-route">
        <strong>入馆线索</strong>
        <small>${escapeHtml(people.length ? `相关人物：${people.join("、")}` : "人物线索可稍后补充")}</small>
        <small>${escapeHtml(mediaNote ? `多模态线索：${limitText(mediaNote, 42)}` : "第十阶段会把图片、OCR、语音线索纳入时间线和主题展")}</small>
        ${attachmentPreview ? `<small class="preview-attachment-list">${escapeHtml(`附件预览：${attachmentPreview}${attachments.length > 3 ? "；..." : ""}`)}</small>` : ""}
        ${attachmentTypeSummary ? `<small class="preview-attachment-types">${escapeHtml(`附件类型：${attachmentTypeSummary}`)}</small>` : ""}
        <small>${escapeHtml(attachments.length ? "附件状态：已记录清单，原文件待后续上传能力接入" : "附件状态：暂无附件清单")}</small>
        <small>${escapeHtml(workflowStatus)}</small>
      </div>
    </div>
  `;
}

async function readApiPayload(response) {
  const text = await response.text();
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    return { error: text.slice(0, 180) };
  }
}

function setStorageStatus(message, type = "neutral") {
  elements.storageStatus.textContent = message;
  elements.storageStatus.dataset.status = type;
}

function setPersistencePending(isPending) {
  isPersisting = isPending;
  elements.saveButton.disabled = isPending || isAnalyzing;
  elements.exportButton.disabled = isPending;
  elements.syncDatabaseButton.disabled = isPending;
  elements.migrateLocalButton.disabled = isPending;
  elements.saveProfileButton.disabled = isPending;
  elements.purgeDatabaseButton.disabled = isPending;
  elements.syncDatabaseButton.textContent = isPending ? "处理中..." : "同步数据库";
  elements.migrateLocalButton.textContent = isPending ? "处理中..." : "迁移本地";
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const payload = await readApiPayload(response);
  if (!response.ok) throw new Error(payload.error || `请求失败：${response.status}`);
  return payload;
}

function buildLocalAssetCollection() {
  return {
    schemaVersion: SCHEMA_VERSION,
    phase: 18,
    source: "browser-fallback",
    savedExhibitions: [],
    reportDrafts: [],
    phase15Readiness: buildLocalPhase15Readiness(),
    phase15AssetPlan: buildLocalPhase15AssetPlan()
  };
}

function getAssetCollection() {
  if (assetCollection?.phase >= 15) {
    assetSource = "server";
    return assetCollection;
  }
  assetSource = "local";
  return buildLocalAssetCollection();
}

async function syncAssetCollection({ quiet = false } = {}) {
  if (!databaseAvailable && !quiet) {
    assetCollection = null;
    assetSource = "local";
    renderAssetCollectionPanel();
    return null;
  }
  try {
    const payload = await requestJson(API_ASSETS);
    if ((payload?.phase || 0) < 15) throw new Error("asset collection is invalid");
    assetCollection = payload;
    assetSource = "server";
    renderAssetCollectionPanel();
    return payload;
  } catch {
    assetCollection = null;
    assetSource = "local";
    if (!quiet) renderAssetCollectionPanel();
    return null;
  }
}

async function saveThemeAsExhibition(themeTitle) {
  const theme = limitText(themeTitle, 80);
  if (!theme) return;
  if (!databaseAvailable) {
    setStorageStatus("需要先连接 Node 后端和 SQLite，才能把主题候选保存为长期专题展资产。", "warning");
    renderAssetCollectionPanel();
    return;
  }
  setStorageStatus(`正在把“${theme}”保存为专题展草稿...`, "loading");
  try {
    const payload = await requestJson(`${API_EXHIBITIONS}/from-theme`, {
      method: "POST",
      body: JSON.stringify({
        theme,
        hall: insightScope === "hall" && activeHall !== "all" ? activeHall : "",
        title: `${theme}专题展草稿`
      })
    });
    const saved = payload.savedExhibition;
    setStorageStatus(`已保存专题展草稿：${saved?.title || theme}`, "success");
    await syncAssetCollection({ quiet: true });
  } catch (error) {
    setStorageStatus(`专题展保存失败：${error.message}`, "warning");
  }
}

async function saveReportDraftFromInsights() {
  if (!databaseAvailable) {
    setStorageStatus("需要先连接 Node 后端和 SQLite，才能把当前洞察保存为报告草稿。", "warning");
    renderAssetCollectionPanel();
    return;
  }
  const scope = {
    hall: insightScope === "hall" && activeHall !== "all" ? activeHall : "",
    source: insightScope
  };
  setStorageStatus("正在把当前洞察生成回忆报告草稿...", "loading");
  try {
    const payload = await requestJson(`${API_REPORT_DRAFTS}/from-insights`, {
      method: "POST",
      body: JSON.stringify({
        scope,
        title: "回忆报告草稿"
      })
    });
    const saved = payload.reportDraft;
    setStorageStatus(`已生成报告草稿：${saved?.title || "回忆报告草稿"}`, "success");
    await syncAssetCollection({ quiet: true });
  } catch (error) {
    setStorageStatus(`报告草稿生成失败：${error.message}`, "warning");
  }
}

async function refreshAssetCollection() {
  if (!databaseAvailable) {
    setStorageStatus("后端未连接：当前只能显示浏览器回退的空资产面板。", "warning");
    renderAssetCollectionPanel();
    return;
  }
  setStorageStatus("正在刷新专题资产库...", "loading");
  const payload = await syncAssetCollection({ quiet: true });
  setStorageStatus(payload ? "专题资产库已刷新。" : "专题资产库刷新失败，已保留本地回退视图。", payload ? "success" : "warning");
}

async function fetchSavedAsset(type, id) {
  const endpoint = type === "report" ? API_REPORT_DRAFTS : API_EXHIBITIONS;
  const payload = await requestJson(`${endpoint}/${encodeURIComponent(id)}`);
  return type === "report" ? payload.reportDraft : payload.savedExhibition;
}

async function openSavedAsset(type, id) {
  if (!id) return;
  const collection = getAssetCollection();
  const localItems = type === "report" ? collection.reportDrafts : collection.savedExhibitions;
  let asset = Array.isArray(localItems) ? localItems.find((item) => item.id === id) : null;
  if (databaseAvailable) {
    try {
      asset = await fetchSavedAsset(type, id);
    } catch (error) {
      setStorageStatus(`资产详情读取失败：${error.message}`, "warning");
    }
  }
  if (asset) renderSavedAssetDialog(type, asset);
}

async function deleteSavedAsset(type, id, title = "") {
  if (!databaseAvailable || !id) {
    setStorageStatus("需要先连接 Node 后端和 SQLite，才能删除专题资产。", "warning");
    return;
  }
  const label = title || (type === "report" ? "这份报告草稿" : "这个专题展");
  if (!confirm(`确定删除“${label}”吗？这个操作只删除专题资产，不会删除原始展品。`)) return;
  const endpoint = type === "report" ? API_REPORT_DRAFTS : API_EXHIBITIONS;
  setStorageStatus(`正在删除“${label}”...`, "loading");
  try {
    await requestJson(`${endpoint}/${encodeURIComponent(id)}`, { method: "DELETE" });
    setStorageStatus(`已删除专题资产：${label}`, "success");
    await syncAssetCollection({ quiet: true });
  } catch (error) {
    setStorageStatus(`专题资产删除失败：${error.message}`, "warning");
  }
}

async function updateSavedAssetStatus(type, id, nextStatus) {
  if (!databaseAvailable || !id) {
    setStorageStatus("需要先连接 Node 后端和 SQLite，才能推进专题资产状态。", "warning");
    return;
  }
  try {
    const asset = await fetchSavedAsset(type, id);
    const validation = validateAssetPayload(type, { ...asset, status: nextStatus });
    if (validation.blocking.length) {
      setStorageStatus(`暂时不能进入 ${nextStatus}：${validation.blocking.join(" ")}`, "warning");
      if (asset) renderSavedAssetDialog(type, asset);
      return;
    }
    const endpoint = type === "report" ? API_REPORT_DRAFTS : API_EXHIBITIONS;
    const response = await requestJson(endpoint, {
      method: "POST",
      body: JSON.stringify({ ...asset, status: nextStatus })
    });
    const saved = type === "report" ? response.reportDraft : response.savedExhibition;
    recordAssetAuditEvent({
      action: "status-update",
      label: `${type === "report" ? "报告" : "专题展"}《${saved?.title || asset.title || id}》状态更新`,
      detail: `${asset.status || "draft"} -> ${nextStatus}`
    });
    captureAssetSnapshot(`单资产状态更新：${saved?.title || asset.title || id}`);
    setStorageStatus(`专题资产状态已更新：${saved?.title || asset.title || id} / ${nextStatus}`, "success");
    await syncAssetCollection({ quiet: true });
  } catch (error) {
    setStorageStatus(`专题资产状态更新失败：${error.message}`, "warning");
  }
}

async function batchUpdateAssetStatus(fromStatus, nextStatus) {
  if (!databaseAvailable) {
    setStorageStatus("需要先连接 Node 后端和 SQLite，才能批量推进专题资产状态。", "warning");
    return;
  }
  const collection = getAssetCollection();
  const candidates = [
    ...(collection.savedExhibitions || []).map((asset) => ({ type: "exhibition", asset })),
    ...(collection.reportDrafts || []).map((asset) => ({ type: "report", asset }))
  ].filter(({ asset }) => (asset.status || "draft") === fromStatus);
  if (!candidates.length) {
    setStorageStatus("当前没有符合条件的专题资产可批量推进。", "warning");
    return;
  }
  const ready = candidates.filter(({ type, asset }) => !validateAssetPayload(type, { ...asset, status: nextStatus }).blocking.length);
  const blocked = candidates.length - ready.length;
  if (!ready.length) {
    setStorageStatus(`批量推进已暂停：${blocked} 个资产需要先修复关键内容。`, "warning");
    return;
  }
  if (!confirm(`准备把 ${ready.length} 个资产从 ${fromStatus} 推进到 ${nextStatus}${blocked ? `；另有 ${blocked} 个需要先修复` : ""}。继续吗？`)) return;
  let savedCount = 0;
  setStorageStatus(`正在批量推进专题资产状态：${fromStatus} -> ${nextStatus}`, "loading");
  for (const { type, asset } of ready) {
    const endpoint = type === "report" ? API_REPORT_DRAFTS : API_EXHIBITIONS;
    try {
      await requestJson(endpoint, {
        method: "POST",
        body: JSON.stringify({ ...asset, status: nextStatus })
      });
      savedCount += 1;
    } catch (error) {
      console.warn("Batch asset status update failed", error);
    }
  }
  await syncAssetCollection({ quiet: true });
  if (savedCount) {
    recordAssetAuditEvent({
      action: "batch-status-update",
      label: `批量状态推进 ${fromStatus} -> ${nextStatus}`,
      detail: `已更新 ${savedCount} 个资产${blocked ? `，${blocked} 个仍需修复` : ""}`
    });
    captureAssetSnapshot(`批量状态推进：${fromStatus} -> ${nextStatus}`);
  }
  setStorageStatus(`批量状态推进完成：已更新 ${savedCount} 个资产${blocked ? `，${blocked} 个仍需修复` : ""}。`, savedCount ? "success" : "warning");
}

function exportFilteredAssetPackage(filterId) {
  const collection = getAssetCollection();
  const manifest = buildAssetExportManifest(collection);
  const filter = manifest.filters.find((item) => item.id === filterId);
  if (!filter) return;
  const statusSet = new Set(filter.statuses);
  const savedExhibitions = (collection.savedExhibitions || []).filter((item) => statusSet.has(item.status || "draft"));
  const reportDrafts = (collection.reportDrafts || []).filter((item) => statusSet.has(item.status || "draft"));
  const filteredCollection = { savedExhibitions, reportDrafts };
  recordAssetAuditEvent({
    action: "filtered-export",
    label: `导出专题资产筛选包：${filter.label}`,
    detail: `${savedExhibitions.length} 个专题展，${reportDrafts.length} 份报告草稿`
  });
  captureAssetSnapshot(`筛选导出：${filter.label}`);
  const payload = {
    app: "AI 记忆博物馆",
    schemaVersion: SCHEMA_VERSION,
    phase: 15,
    exportMode: "phase15-assets-filtered",
    filter: filter.id,
    filterLabel: filter.label,
    exportedAt: new Date().toISOString(),
    savedExhibitions,
    reportDrafts,
    packageItems: buildAssetPackageItems(filteredCollection),
    ...buildPhase15AssetExportReview(filteredCollection)
  };
  downloadJsonPayload(payload, `memory-museum-assets-${filter.id}-${new Date().toISOString().slice(0, 10)}.json`);
  setStorageStatus(`已导出专题资产筛选包：${filter.label} ${savedExhibitions.length + reportDrafts.length} 个。`, "success");
}

function exportSelectedAssetSnapshot(snapshotId = selectedAssetSnapshotId) {
  const snapshot = snapshotId ? findAssetSnapshotById(snapshotId) : getSelectedAssetSnapshot();
  if (!snapshot) {
    setStorageStatus("当前还没有可导出的资产快照。", "warning");
    return;
  }
  selectedAssetSnapshotId = snapshot.id;
  const payload = {
    app: "AI 记忆博物馆",
    schemaVersion: SCHEMA_VERSION,
    phase: 15,
    exportMode: "phase15-asset-snapshot",
    exportedAt: new Date().toISOString(),
    snapshot,
    comparison: buildAssetSnapshotComparison(getAssetCollection(), snapshot),
    signature: buildAssetPackageSignature()
  };
  downloadJsonPayload(payload, `memory-museum-asset-snapshot-${new Date().toISOString().slice(0, 10)}.json`);
  recordAssetAuditEvent({
    action: "snapshot-export",
    label: "导出选中资产快照",
    detail: snapshot.reason || snapshot.id
  });
  setStorageStatus("已导出选中资产快照。", "success");
}

function exportLatestAssetSnapshot() {
  exportSelectedAssetSnapshot();
}

function formatReportSectionsInput(sections = []) {
  return (Array.isArray(sections) ? sections : [])
    .map((section) => `${section.title || "未命名章节"}：${section.text || ""}`.trim())
    .join("\n");
}

function parseReportSectionsInput(value = "") {
  return String(value || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 30)
    .map((line, index) => {
      const separator = line.includes("：") ? "：" : line.includes(":") ? ":" : "";
      if (!separator) return { title: `章节 ${index + 1}`, text: limitText(line, 800) };
      const [title, ...rest] = line.split(separator);
      return {
        title: limitText(title || `章节 ${index + 1}`, 80),
        text: limitText(rest.join(separator) || "", 800)
      };
    });
}

function formatAssetMemoryIdsInput(memoryIds = []) {
  return (Array.isArray(memoryIds) ? memoryIds : []).join("\n");
}

function getMemoryOptionLabel(id) {
  const memory = memories.find((item) => item.id === id);
  if (!memory) return id;
  return `${memory.title} / ${getHallName(memory.hall)}`;
}

function renderMemoryOptionItems() {
  return memories.map((memory) => `<option value="${escapeHtml(memory.id)}">${escapeHtml(`${memory.title} / ${getHallName(memory.hall)}`)}</option>`).join("");
}

function renderAssetSortList(memoryIds = []) {
  const ids = Array.isArray(memoryIds) ? memoryIds : [];
  if (!ids.length) return `<div class="asset-sort-empty">暂无展品排序。可从下拉框插入已保存展品。</div>`;
  return ids.map((id, index) => `
    <div class="asset-sort-row">
      <span>${index + 1}. ${escapeHtml(getMemoryOptionLabel(id))}</span>
      <button type="button" data-memory-sort-index="${index}" data-memory-sort-direction="up">上移</button>
      <button type="button" data-memory-sort-index="${index}" data-memory-sort-direction="down">下移</button>
    </div>
  `).join("");
}

function parseAssetMemoryIdsInput(value = "") {
  return [...new Set(String(value || "")
    .split(/[\n,，、\s]+/)
    .map((item) => limitText(item, 80))
    .filter(Boolean))]
    .slice(0, 80);
}

function formatReportReferencesInput(references = []) {
  return (Array.isArray(references) ? references : [])
    .map((item) => {
      const role = item.role || "引用";
      const title = item.title || item.id || "未命名展品";
      return `${role}：${title}${item.id ? `｜${item.id}` : ""}`;
    })
    .join("\n");
}

function parseReportReferencesInput(value = "") {
  return String(value || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 120)
    .map((line) => {
      const roleSeparator = line.includes("：") ? "：" : line.includes(":") ? ":" : "";
      const [rolePart, detailPart = ""] = roleSeparator ? line.split(roleSeparator) : ["引用", line];
      const detail = detailPart || rolePart;
      const assetSeparator = detail.includes("｜") ? "｜" : detail.includes("|") ? "|" : "";
      const [title, id = ""] = assetSeparator ? detail.split(assetSeparator) : [detail, ""];
      return {
        role: limitText(roleSeparator ? rolePart : "引用", 40),
        title: limitText(title, 120),
        id: limitText(id, 80)
      };
    });
}

function syncAssetSortList(form) {
  const textarea = form.querySelector("[name='memoryIds']");
  const target = form.querySelector("[data-asset-sort-list]");
  if (!textarea || !target) return;
  target.innerHTML = renderAssetSortList(parseAssetMemoryIdsInput(textarea.value));
}

function insertAssetMemoryFromPicker(form) {
  const select = form.querySelector("[data-memory-picker]");
  const textarea = form.querySelector("[name='memoryIds']");
  if (!select || !textarea || !select.value) return;
  const ids = parseAssetMemoryIdsInput(textarea.value);
  if (!ids.includes(select.value)) ids.push(select.value);
  textarea.value = formatAssetMemoryIdsInput(ids);
  syncAssetSortList(form);
  setAssetFormStatus(form, "已加入展品排序，保存后生效。", "editing");
}

function moveAssetMemoryLine(form, index, direction) {
  const textarea = form.querySelector("[name='memoryIds']");
  if (!textarea) return;
  const ids = parseAssetMemoryIdsInput(textarea.value);
  const nextIndex = direction === "up" ? index - 1 : index + 1;
  if (nextIndex < 0 || nextIndex >= ids.length) return;
  [ids[index], ids[nextIndex]] = [ids[nextIndex], ids[index]];
  textarea.value = formatAssetMemoryIdsInput(ids);
  syncAssetSortList(form);
  setAssetFormStatus(form, "展品顺序已调整，保存后生效。", "editing");
}

function insertReportReferenceFromPicker(form) {
  const select = form.querySelector("[data-reference-picker]");
  const textarea = form.querySelector("[name='references']");
  const memory = memories.find((item) => item.id === select?.value);
  if (!select || !textarea || !memory) return;
  const line = `引用：${memory.title}｜${memory.id}`;
  const current = textarea.value.trim();
  if (!current.includes(memory.id)) {
    textarea.value = current ? `${current}\n${line}` : line;
  }
  setAssetFormStatus(form, "已加入报告引用，保存后生效。", "editing");
}

function setAssetFormStatus(form, message, status = "neutral") {
  const target = form?.querySelector("[data-asset-save-status]");
  if (!target) return;
  target.textContent = message;
  target.dataset.status = status;
}

function buildAssetQualitySummary(collection = getAssetCollection()) {
  const exhibitions = Array.isArray(collection.savedExhibitions) ? collection.savedExhibitions : [];
  const reportDrafts = Array.isArray(collection.reportDrafts) ? collection.reportDrafts : [];
  const knownMemoryIds = new Set(memories.map((memory) => memory.id));
  const missingCovers = exhibitions.filter((item) => !item.coverMemoryId || !knownMemoryIds.has(item.coverMemoryId)).length;
  const emptyExhibitions = exhibitions.filter((item) => !Array.isArray(item.memoryIds) || !item.memoryIds.length).length;
  const thinExhibitions = exhibitions.filter((item) => !String(item.intro || item.guideText || "").trim()).length;
  const reportsWithoutSections = reportDrafts.filter((item) => !Array.isArray(item.sections) || !item.sections.length).length;
  const reportsWithoutReferences = reportDrafts.filter((item) => !Array.isArray(item.references) || !item.references.length).length;
  const reviewAssets = [...exhibitions, ...reportDrafts].filter((item) => ["review", "published"].includes(item.status)).length;
  const draftAssets = [...exhibitions, ...reportDrafts].filter((item) => !item.status || item.status === "draft").length;
  const totalIssues = missingCovers + emptyExhibitions + thinExhibitions + reportsWithoutSections + reportsWithoutReferences;
  return {
    totalMemories: memories.length,
    exhibitionCount: exhibitions.length,
    reportCount: reportDrafts.length,
    reviewAssets,
    draftAssets,
    totalIssues,
    items: [
      { id: "cover", label: "封面可追溯", value: missingCovers, ok: missingCovers === 0, detail: missingCovers ? `${missingCovers} 个专题展缺少有效封面` : "专题展封面已关联到展品" },
      { id: "order", label: "展品排序", value: emptyExhibitions, ok: emptyExhibitions === 0, detail: emptyExhibitions ? `${emptyExhibitions} 个专题展还没有展品排序` : "专题展已具备展品顺序" },
      { id: "copy", label: "导览文本", value: thinExhibitions, ok: thinExhibitions === 0, detail: thinExhibitions ? `${thinExhibitions} 个专题展需要补充说明` : "专题说明和导览文案已就绪" },
      { id: "sections", label: "报告章节", value: reportsWithoutSections, ok: reportsWithoutSections === 0, detail: reportsWithoutSections ? `${reportsWithoutSections} 份报告缺少章节` : "报告章节结构已就绪" },
      { id: "references", label: "引用来源", value: reportsWithoutReferences, ok: reportsWithoutReferences === 0, detail: reportsWithoutReferences ? `${reportsWithoutReferences} 份报告缺少引用` : "报告引用来源已就绪" }
    ]
  };
}

function renderAssetQualitySummary(summary) {
  const readinessLabel = summary.totalIssues ? "需要整理" : "可以导出";
  return `
    <div class="asset-quality-panel" data-quality-ready="${summary.totalIssues ? "false" : "true"}">
      <div class="asset-quality-heading">
        <strong>${escapeHtml(readinessLabel)}</strong>
        <small>${summary.reviewAssets} 个复核/发布资产，${summary.draftAssets} 个草稿资产</small>
      </div>
      <div class="asset-quality-grid">
        ${summary.items.map((item) => `
          <span data-quality-status="${item.ok ? "ok" : "needs-work"}">
            <b>${escapeHtml(item.label)}</b>
            <small>${escapeHtml(item.detail)}</small>
          </span>
        `).join("")}
      </div>
    </div>
  `;
}

function buildAssetReferenceGraph(collection = getAssetCollection()) {
  const exhibitions = Array.isArray(collection.savedExhibitions) ? collection.savedExhibitions : [];
  const reportDrafts = Array.isArray(collection.reportDrafts) ? collection.reportDrafts : [];
  const memoryLookup = new Map(memories.map((memory) => [memory.id, memory]));
  const rows = [];
  exhibitions.forEach((item) => {
    const ids = Array.isArray(item.memoryIds) ? item.memoryIds : [];
    rows.push({
      id: item.id,
      type: "专题展",
      title: item.title || "未命名专题展",
      targetCount: ids.length,
      targets: ids.slice(0, 5).map((id) => {
        const memory = memoryLookup.get(id);
        return memory ? `《${memory.title}》` : id;
      })
    });
  });
  reportDrafts.forEach((item) => {
    const refs = Array.isArray(item.references) ? item.references : [];
    rows.push({
      id: item.id,
      type: "报告",
      title: item.title || "未命名报告草稿",
      targetCount: refs.length,
      targets: refs.slice(0, 5).map((ref) => ref.title || ref.id || "未命名引用")
    });
  });
  return {
    totalLinks: rows.reduce((sum, row) => sum + row.targetCount, 0),
    rows: rows.slice(0, 8)
  };
}

function renderAssetReferenceGraph(graph) {
  if (!graph.rows.length) {
    return `<div class="asset-reference-map"><small>还没有专题展展品或报告引用关系。</small></div>`;
  }
  return `
    <div class="asset-reference-map">
      <div class="asset-reference-heading">
        <strong>引用关系图</strong>
        <small>${graph.totalLinks} 条展品/引用连接</small>
      </div>
      ${graph.rows.map((row) => `
        <div class="asset-reference-row">
          <span>${escapeHtml(row.type)}</span>
          <strong>${escapeHtml(row.title)}</strong>
          <small>${row.targets.length ? escapeHtml(row.targets.join("、")) : "等待补充引用对象"}</small>
        </div>
      `).join("")}
    </div>
  `;
}

function buildAssetRepairSuggestions(collection = getAssetCollection()) {
  const exhibitions = Array.isArray(collection.savedExhibitions) ? collection.savedExhibitions : [];
  const reportDrafts = Array.isArray(collection.reportDrafts) ? collection.reportDrafts : [];
  const knownMemoryIds = new Set(memories.map((memory) => memory.id));
  const suggestions = [];
  exhibitions.forEach((item) => {
    const title = item.title || "未命名专题展";
    if (!item.coverMemoryId || !knownMemoryIds.has(item.coverMemoryId)) {
      suggestions.push({ id: item.id, assetType: "exhibition", type: "专题展", title, detail: "补一个有效封面展品 ID，让导出包更像完整展览。" });
    }
    if (!Array.isArray(item.memoryIds) || !item.memoryIds.length) {
      suggestions.push({ id: item.id, assetType: "exhibition", type: "专题展", title, detail: "加入至少一件展品，并用上移/下移整理观看顺序。" });
    }
    if (!String(item.intro || item.guideText || "").trim()) {
      suggestions.push({ id: item.id, assetType: "exhibition", type: "专题展", title, detail: "补一段专题说明或导览词，让回看时有温度和上下文。" });
    }
  });
  reportDrafts.forEach((item) => {
    const title = item.title || "未命名报告草稿";
    if (!Array.isArray(item.sections) || !item.sections.length) {
      suggestions.push({ id: item.id, assetType: "report", type: "报告", title, detail: "补充至少一个章节，形成可继续扩写的报告骨架。" });
    }
    if (!Array.isArray(item.references) || !item.references.length) {
      suggestions.push({ id: item.id, assetType: "report", type: "报告", title, detail: "插入引用展品，让报告能追溯到具体记忆。" });
    }
  });
  return suggestions.slice(0, 6);
}

function renderAssetRepairSuggestions(suggestions = []) {
  return `
    <div class="asset-repair-list">
      <div class="asset-reference-heading">
        <strong>草稿修复建议</strong>
        <small>${suggestions.length ? "按发布前优先级整理" : "暂无明显缺口"}</small>
      </div>
      ${suggestions.length ? suggestions.map((item) => `
        <div class="asset-repair-item">
          <span>${escapeHtml(item.type)}</span>
          <strong>${escapeHtml(item.title)}</strong>
          <small>${escapeHtml(item.detail)}</small>
          <button type="button" data-asset-open="${escapeHtml(item.id || "")}" data-asset-type="${escapeHtml(item.assetType || "exhibition")}">打开修复</button>
        </div>
      `).join("") : "<small>当前专题资产已经具备较完整的导出基础。</small>"}
    </div>
  `;
}

function getAssetStatusCounts(collection = getAssetCollection()) {
  const assets = [
    ...(Array.isArray(collection.savedExhibitions) ? collection.savedExhibitions : []),
    ...(Array.isArray(collection.reportDrafts) ? collection.reportDrafts : [])
  ];
  return assets.reduce((counts, item) => {
    const status = item.status || "draft";
    counts[status] = (counts[status] || 0) + 1;
    return counts;
  }, { draft: 0, review: 0, published: 0, archived: 0 });
}

function getAssetIssueList(type, item) {
  const status = item.status || "draft";
  const validation = validateAssetPayload(type, { ...item, status });
  return [...validation.blocking, ...validation.warnings];
}

function buildAssetPackageItems(collection = getAssetCollection()) {
  const exhibitions = Array.isArray(collection.savedExhibitions) ? collection.savedExhibitions : [];
  const reportDrafts = Array.isArray(collection.reportDrafts) ? collection.reportDrafts : [];
  return [
    ...exhibitions.map((item) => ({
      id: item.id,
      type: "exhibition",
      typeLabel: "专题展",
      title: item.title || "未命名专题展",
      status: item.status || "draft",
      links: Array.isArray(item.memoryIds) ? item.memoryIds.length : 0,
      issues: getAssetIssueList("exhibition", item),
      updatedAt: item.updatedAt || item.createdAt || ""
    })),
    ...reportDrafts.map((item) => ({
      id: item.id,
      type: "report",
      typeLabel: "报告",
      title: item.title || "未命名报告草稿",
      status: item.status || "draft",
      links: Array.isArray(item.references) ? item.references.length : 0,
      issues: getAssetIssueList("report", item),
      updatedAt: item.updatedAt || item.createdAt || ""
    }))
  ];
}

function getBatchTransitionPreview(collection = getAssetCollection()) {
  const items = buildAssetPackageItems(collection);
  const transitions = [
    { from: "draft", to: "review", label: "草稿送复核" },
    { from: "review", to: "published", label: "复核发布" },
    { from: "published", to: "archived", label: "发布归档" }
  ];
  return transitions.map((transition) => {
    const candidates = items.filter((item) => item.status === transition.from);
    const ready = candidates.filter((item) => {
      const source = findAssetById(item.type, item.id, collection);
      return source && !validateAssetPayload(item.type, { ...source, status: transition.to }).blocking.length;
    }).length;
    return {
      ...transition,
      candidates: candidates.length,
      ready,
      blocked: candidates.length - ready
    };
  });
}

function findAssetById(type, id, collection = getAssetCollection()) {
  const list = type === "report" ? collection.reportDrafts : collection.savedExhibitions;
  return Array.isArray(list) ? list.find((item) => item.id === id) : null;
}

function loadAssetAuditLog() {
  try {
    const parsed = JSON.parse(localStorage.getItem(ASSET_AUDIT_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.slice(0, 80) : [];
  } catch (error) {
    return [];
  }
}

function persistAssetAuditLog(entries) {
  try {
    localStorage.setItem(ASSET_AUDIT_KEY, JSON.stringify(entries.slice(0, 80)));
  } catch (error) {
    console.warn("Asset audit log persist failed", error);
  }
}

function recordAssetAuditEvent(event) {
  const entries = loadAssetAuditLog();
  const next = [{
    id: `asset-audit-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    at: new Date().toISOString(),
    ...event
  }, ...entries];
  persistAssetAuditLog(next);
  return next[0];
}

function mergeImportedAssetAuditLog(entries = []) {
  const imported = Array.isArray(entries) ? entries.filter((item) => item && item.id && item.at) : [];
  if (!imported.length) return 0;
  const current = loadAssetAuditLog();
  const byId = new Map([...imported, ...current].map((item) => [item.id, item]));
  const merged = [...byId.values()].sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
  persistAssetAuditLog(merged);
  return Math.min(imported.length, merged.length);
}

function loadAssetSnapshots() {
  try {
    const parsed = JSON.parse(localStorage.getItem(ASSET_SNAPSHOT_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.slice(0, 30) : [];
  } catch (error) {
    return [];
  }
}

function persistAssetSnapshots(snapshots) {
  try {
    localStorage.setItem(ASSET_SNAPSHOT_KEY, JSON.stringify(snapshots.slice(0, 30)));
  } catch (error) {
    console.warn("Asset snapshots persist failed", error);
  }
}

function captureAssetSnapshot(reason, collection = getAssetCollection()) {
  const snapshot = {
    id: `asset-snapshot-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    at: new Date().toISOString(),
    reason,
    counts: getAssetStatusCounts(collection),
    quality: buildAssetQualitySummary(collection),
    packageComparison: buildAssetPackageComparison(collection),
    packageItems: buildAssetPackageItems(collection).slice(0, 20)
  };
  persistAssetSnapshots([snapshot, ...loadAssetSnapshots()]);
  return snapshot;
}

function findAssetSnapshotById(id) {
  return loadAssetSnapshots().find((snapshot) => snapshot.id === id) || null;
}

function getSelectedAssetSnapshot() {
  const snapshots = loadAssetSnapshots();
  if (!snapshots.length) {
    selectedAssetSnapshotId = "";
    return null;
  }
  const selected = snapshots.find((snapshot) => snapshot.id === selectedAssetSnapshotId);
  if (selected) return selected;
  selectedAssetSnapshotId = snapshots[0].id;
  return snapshots[0];
}

function mergeImportedAssetSnapshots(snapshots = []) {
  const imported = Array.isArray(snapshots) ? snapshots.filter((item) => item && item.id && item.at) : [];
  if (!imported.length) return 0;
  const current = loadAssetSnapshots();
  const byId = new Map([...imported, ...current].map((item) => [item.id, item]));
  const merged = [...byId.values()].sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
  persistAssetSnapshots(merged);
  return Math.min(imported.length, merged.length);
}

function restorePhase15AssetMetadata(payload = {}) {
  const auditCount = mergeImportedAssetAuditLog(payload.phase15AssetAuditLog || payload.assetAuditLog || []);
  const snapshotCount = mergeImportedAssetSnapshots(payload.phase15AssetSnapshots || payload.assetSnapshots || []);
  const signature = verifyImportedAssetPackageSignature(payload);
  if (signature.checked) {
    recordAssetAuditEvent({
      action: "signature-verify",
      label: signature.ok ? "导入包签名校验通过" : "导入包签名校验异常",
      detail: `${signature.detail}${signature.repairSuggestions?.suggestions?.length ? `；建议：${signature.repairSuggestions.suggestions.join(" / ")}` : ""}`,
      severity: signature.severity || (signature.ok ? "ok" : "medium")
    });
  }
  return { auditCount, snapshotCount, signature };
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function simpleChecksum(text = "") {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function buildAssetPackageSignature(collection = getAssetCollection()) {
  const payload = {
    schemaVersion: SCHEMA_VERSION,
    phase: 15,
    items: buildAssetPackageItems(collection).map((item) => ({
      id: item.id,
      type: item.type,
      title: item.title,
      status: item.status,
      links: item.links,
      issues: item.issues.length
    })),
    quality: buildAssetQualitySummary(collection).items.map((item) => ({ id: item.id, value: item.value })),
    comparison: buildAssetPackageComparison(collection)
  };
  return {
    algorithm: "fnv1a-lightweight",
    checksum: simpleChecksum(stableStringify(payload)),
    generatedAt: new Date().toISOString(),
    itemCount: payload.items.length
  };
}

function buildAssetSignatureAnomalyPlan(signature = {}) {
  const suggestions = [];
  if (!signature.checked) {
    suggestions.push("导入包未触发签名检查，先确认它是否为第十五阶段完整资产包。");
  } else if (signature.ok) {
    suggestions.push("签名一致，可继续按正常资产包归档。");
  } else if (!signature.expected) {
    suggestions.push("缺少 phase15PackageSignature，建议重新从第十五阶段完整导出入口生成资产包。");
    suggestions.push("如果这是旧版本包，先导入到测试环境，再导出新版带签名包。");
  } else {
    suggestions.push("对照 expected 与 actual 校验码，确认导入包没有被手动改写。");
    suggestions.push("优先使用最近快照导出包和审计搜索定位异常来源。");
  }
  return {
    severity: !signature.checked ? "info" : signature.ok ? "ok" : signature.expected ? "high" : "medium",
    expected: signature.expected || "",
    actual: signature.actual || "",
    suggestions
  };
}

function verifyImportedAssetPackageSignature(payload = {}) {
  const expected = payload.phase15PackageSignature?.checksum;
  const hasPhase15Assets = Array.isArray(payload.savedExhibitions) || Array.isArray(payload.reportDrafts) || Array.isArray(payload.phase15AssetSnapshots);
  if (!expected) {
    const signature = {
      checked: hasPhase15Assets,
      ok: false,
      expected: "",
      actual: "",
      severity: hasPhase15Assets ? "medium" : "info",
      detail: hasPhase15Assets ? "导入包没有发布包签名，建议重新导出新版资产包" : "导入包没有发布包签名"
    };
    return { ...signature, repairSuggestions: buildAssetSignatureAnomalyPlan(signature) };
  }
  const collection = {
    savedExhibitions: Array.isArray(payload.savedExhibitions) ? payload.savedExhibitions : [],
    reportDrafts: Array.isArray(payload.reportDrafts) ? payload.reportDrafts : []
  };
  const actual = buildAssetPackageSignature(collection).checksum;
  const signature = {
    checked: true,
    ok: actual === expected,
    expected,
    actual,
    severity: actual === expected ? "ok" : "high",
    detail: actual === expected ? "发布包签名一致" : `发布包签名不一致，expected=${expected}，actual=${actual}，建议人工复核`
  };
  return { ...signature, repairSuggestions: buildAssetSignatureAnomalyPlan(signature) };
}

function buildAssetAuditFilters(entries = loadAssetAuditLog()) {
  const groups = [
    { id: "status", label: "状态推进", actions: ["status-update", "batch-status-update"] },
    { id: "export", label: "导出记录", actions: ["full-export", "filtered-export"] },
    { id: "recovery", label: "恢复记录", actions: ["metadata-restore", "signature-verify"] }
  ];
  return groups.map((group) => {
    const items = entries.filter((entry) => group.actions.includes(entry.action));
    return {
      ...group,
      count: items.length,
      latestAt: items[0]?.at || "",
      latestLabel: items[0]?.label || ""
    };
  });
}

function buildAssetAuditSearch(query = assetAuditSearchTerm, entries = loadAssetAuditLog()) {
  const term = String(query || "").trim().toLowerCase();
  const matches = term
    ? entries.filter((entry) => [entry.action, entry.label, entry.detail, entry.id]
      .some((value) => String(value || "").toLowerCase().includes(term)))
    : entries.slice(0, 6);
  return {
    query: String(query || "").trim(),
    total: entries.length,
    count: matches.length,
    items: matches.slice(0, 8)
  };
}

function buildAssetSnapshotComparison(collection = getAssetCollection(), snapshot = getSelectedAssetSnapshot()) {
  const current = {
    counts: getAssetStatusCounts(collection),
    quality: buildAssetQualitySummary(collection),
    packageItems: buildAssetPackageItems(collection)
  };
  if (!snapshot) {
    return {
      hasSnapshot: false,
      label: "暂无快照可对比",
      countDelta: {},
      issueDelta: current.quality.totalIssues,
      itemDelta: current.packageItems.length
    };
  }
  const statusKeys = ["draft", "review", "published", "archived"];
  return {
    hasSnapshot: true,
    snapshotId: snapshot.id,
    label: snapshot.reason || "选中快照",
    at: snapshot.at,
    countDelta: statusKeys.reduce((result, key) => {
      result[key] = (current.counts[key] || 0) - (snapshot.counts?.[key] || 0);
      return result;
    }, {}),
    issueDelta: current.quality.totalIssues - (snapshot.quality?.totalIssues || 0),
    itemDelta: current.packageItems.length - (snapshot.packageItems?.length || 0)
  };
}

function buildAssetReleaseTimeline(collection = getAssetCollection()) {
  const packageItems = buildAssetPackageItems(collection);
  const statusEvents = packageItems
    .filter((item) => item.updatedAt)
    .map((item) => ({
      id: `asset-status-${item.id}`,
      at: item.updatedAt,
      action: "status-snapshot",
      label: `${item.typeLabel}《${item.title}》处于 ${item.status}`,
      detail: item.issues.length ? `${item.issues.length} 项仍需整理` : "当前可进入导出包"
    }));
  const auditEvents = loadAssetAuditLog().map((item) => ({
    id: item.id,
    at: item.at,
    action: item.action,
    label: item.label || "专题资产操作",
    detail: item.detail || ""
  }));
  return [...auditEvents, ...statusEvents]
    .sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")))
    .slice(0, 8);
}

function buildAssetPackageComparison(collection = getAssetCollection()) {
  const items = buildAssetPackageItems(collection);
  const groups = [
    { id: "review-ready", label: "复核/发布", statuses: ["review", "published"] },
    { id: "drafts", label: "草稿", statuses: ["draft"] },
    { id: "archive", label: "归档", statuses: ["archived"] }
  ];
  return groups.map((group) => {
    const groupItems = items.filter((item) => group.statuses.includes(item.status));
    return {
      id: group.id,
      label: group.label,
      count: groupItems.length,
      links: groupItems.reduce((sum, item) => sum + item.links, 0),
      issues: groupItems.reduce((sum, item) => sum + item.issues.length, 0),
      ready: groupItems.filter((item) => !item.issues.length).length,
      sample: groupItems.slice(0, 3).map((item) => item.title)
    };
  });
}

function buildAssetPackageValidationSummary(collection = getAssetCollection()) {
  const quality = buildAssetQualitySummary(collection);
  const items = buildAssetPackageItems(collection);
  const auditCount = loadAssetAuditLog().length;
  const snapshotCount = loadAssetSnapshots().length;
  const publishedReady = items.filter((item) => ["review", "published"].includes(item.status) && !item.issues.length).length;
  const status = quality.totalIssues ? "needs-review" : "ready";
  return {
    status,
    totalAssets: items.length,
    publishedReady,
    issueCount: quality.totalIssues,
    auditCount,
    snapshotCount,
    generatedAt: new Date().toISOString(),
    checks: [
      { id: "quality", label: "质量缺口", ok: quality.totalIssues === 0, detail: quality.totalIssues ? `${quality.totalIssues} 个缺口` : "无明显缺口" },
      { id: "audit", label: "审计记录", ok: auditCount > 0, detail: auditCount ? `${auditCount} 条记录` : "尚无审计记录" },
      { id: "snapshot", label: "版本快照", ok: snapshotCount > 0, detail: snapshotCount ? `${snapshotCount} 个快照` : "尚无快照" },
      { id: "package", label: "资产明细", ok: items.length > 0, detail: `${items.length} 个专题资产` }
    ]
  };
}

function renderAssetPackageValidation(summary) {
  return `
    <div class="asset-package-validation" data-validation-status="${escapeHtml(summary.status)}">
      <div class="asset-reference-heading">
        <strong>发布包校验摘要</strong>
        <small>${summary.status === "ready" ? "可以归档" : "建议复核"}</small>
      </div>
      <div class="asset-validation-grid">
        ${summary.checks.map((check) => `
          <span data-validation-ok="${check.ok ? "true" : "false"}">
            <b>${escapeHtml(check.label)}</b>
            <small>${escapeHtml(check.detail)}</small>
          </span>
        `).join("")}
      </div>
    </div>
  `;
}

function renderAssetSnapshotList(snapshots = []) {
  const selected = getSelectedAssetSnapshot();
  return `
    <div class="asset-snapshot-list">
      <div class="asset-reference-heading">
        <strong>资产版本快照</strong>
        <small>${snapshots.length ? "可选择快照对比或导出" : "等待生成快照"}</small>
      </div>
      ${snapshots.length ? snapshots.slice(0, 4).map((snapshot) => `
        <div class="asset-snapshot-row" data-snapshot-selected="${selected?.id === snapshot.id ? "true" : "false"}">
          <span>${escapeHtml(formatDate(snapshot.at) || "刚刚")}</span>
          <strong>${escapeHtml(snapshot.reason || "资产快照")}</strong>
          <small>草稿 ${snapshot.counts?.draft || 0} / 复核 ${snapshot.counts?.review || 0} / 发布 ${snapshot.counts?.published || 0} / 归档 ${snapshot.counts?.archived || 0}</small>
          <div class="asset-row-actions">
            <button type="button" data-asset-snapshot-select="${escapeHtml(snapshot.id)}">${selected?.id === snapshot.id ? "已选中" : "对比"}</button>
            <button type="button" data-asset-snapshot-export="${escapeHtml(snapshot.id)}">导出</button>
          </div>
        </div>
      `).join("") : "<small>状态推进或导出后会留下快照，便于回看发布包变化。</small>"}
    </div>
  `;
}

function renderAssetSnapshotComparison(comparison) {
  const deltaText = comparison.hasSnapshot
    ? `草稿 ${comparison.countDelta.draft || 0} / 复核 ${comparison.countDelta.review || 0} / 发布 ${comparison.countDelta.published || 0} / 归档 ${comparison.countDelta.archived || 0}`
    : "还没有可对比快照";
  return `
    <div class="asset-snapshot-compare">
      <div class="asset-reference-heading">
        <strong>快照对比恢复</strong>
        <small>${comparison.hasSnapshot ? `当前状态对比：${escapeHtml(comparison.label)}` : "等待快照"}</small>
      </div>
      <div class="asset-snapshot-compare-grid">
        <span><b>状态变化</b><small>${escapeHtml(deltaText)}</small></span>
        <span><b>缺口变化</b><small>${comparison.issueDelta > 0 ? "+" : ""}${comparison.issueDelta}</small></span>
        <span><b>资产变化</b><small>${comparison.itemDelta > 0 ? "+" : ""}${comparison.itemDelta}</small></span>
      </div>
      <small class="asset-recovery-note">快照对比不会直接覆盖当前资产；它用于导出恢复参考、人工核对差异和定位异常来源。</small>
      <div class="asset-export-actions">
        <button type="button" data-asset-snapshot-export="${escapeHtml(comparison.snapshotId || "")}" ${comparison.hasSnapshot ? "" : "disabled"}>导出选中快照</button>
      </div>
    </div>
  `;
}

function renderAssetAuditSearch(search = buildAssetAuditSearch()) {
  return `
    <div class="asset-audit-search">
      <div class="asset-reference-heading">
        <strong>审计记录搜索</strong>
        <small>${search.query ? `${search.count}/${search.total} 条命中` : `最近 ${Math.min(search.items.length, search.total)} 条`}</small>
      </div>
      <div class="asset-audit-search-form">
        <input type="search" data-asset-audit-query value="${escapeHtml(search.query)}" placeholder="搜索动作、标题、详情或校验码">
        <button type="button" data-asset-audit-search>搜索</button>
        <button type="button" data-asset-audit-clear ${search.query ? "" : "disabled"}>清空</button>
      </div>
      <div class="asset-audit-search-list">
        ${search.items.length ? search.items.map((item) => `
          <div class="asset-audit-row" data-audit-severity="${escapeHtml(item.severity || "info")}">
            <span>${escapeHtml(formatDate(item.at) || "刚刚")}</span>
            <strong>${escapeHtml(item.label || item.action || "专题资产操作")}</strong>
            <small>${escapeHtml(item.detail || item.id || "")}</small>
          </div>
        `).join("") : "<small>没有找到匹配的审计记录。</small>"}
      </div>
    </div>
  `;
}

function renderAssetAuditFilters(filters = []) {
  return `
    <div class="asset-audit-filter">
      <div class="asset-reference-heading">
        <strong>审计记录筛选</strong>
        <small>按操作类型查看最近留痕</small>
      </div>
      <div class="asset-audit-filter-grid">
        ${filters.map((filter) => `
          <span>
            <b>${escapeHtml(filter.label)}</b>
            <small>${filter.count} 条记录</small>
            <small>${filter.latestLabel ? escapeHtml(filter.latestLabel) : "暂无记录"}</small>
          </span>
        `).join("")}
      </div>
    </div>
  `;
}

function renderAssetPackageSignature(signature, recovery = buildAssetSignatureAnomalyPlan({ checked: true, ok: true })) {
  return `
    <div class="asset-package-signature">
      <div class="asset-reference-heading">
        <strong>发布包签名校验</strong>
        <small>${escapeHtml(signature.algorithm)}</small>
      </div>
      <div class="asset-signature-line">
        <span>${escapeHtml(signature.checksum)}</span>
        <small>${signature.itemCount} 个资产 / ${escapeHtml(formatDate(signature.generatedAt) || "刚刚")}</small>
      </div>
      <div class="asset-signature-recovery" data-signature-severity="${escapeHtml(recovery.severity)}">
        ${recovery.suggestions.map((suggestion) => `<small>${escapeHtml(suggestion)}</small>`).join("")}
      </div>
    </div>
  `;
}

function getNextAssetStatus(status = "draft") {
  if (status === "draft") return { value: "review", label: "送复核" };
  if (status === "review") return { value: "published", label: "发布" };
  if (status === "published") return { value: "archived", label: "归档" };
  return { value: "draft", label: "转草稿" };
}

function renderAssetStatusAction(type, item) {
  const next = getNextAssetStatus(item.status || "draft");
  return `<button type="button" data-asset-status="${escapeHtml(item.id)}" data-asset-type="${escapeHtml(type)}" data-next-status="${escapeHtml(next.value)}">${escapeHtml(next.label)}</button>`;
}

function buildAssetExportManifest(collection = getAssetCollection()) {
  const exhibitions = Array.isArray(collection.savedExhibitions) ? collection.savedExhibitions : [];
  const reportDrafts = Array.isArray(collection.reportDrafts) ? collection.reportDrafts : [];
  const counts = getAssetStatusCounts(collection);
  const items = buildAssetPackageItems(collection);
  const transitionPreview = getBatchTransitionPreview(collection);
  const releaseTimeline = buildAssetReleaseTimeline(collection);
  const packageComparison = buildAssetPackageComparison(collection);
  const packageValidation = buildAssetPackageValidationSummary(collection);
  const snapshots = loadAssetSnapshots();
  const snapshotComparison = buildAssetSnapshotComparison(collection);
  const auditFilters = buildAssetAuditFilters();
  const auditSearch = buildAssetAuditSearch();
  const packageSignature = buildAssetPackageSignature(collection);
  const signatureRecovery = buildAssetSignatureAnomalyPlan({ checked: true, ok: true });
  return {
    counts,
    items,
    transitionPreview,
    releaseTimeline,
    packageComparison,
    packageValidation,
    snapshots,
    snapshotComparison,
    auditFilters,
    auditSearch,
    packageSignature,
    signatureRecovery,
    filters: [
      { id: "review-ready", label: "复核/发布资产", statuses: ["review", "published"], count: counts.review + counts.published },
      { id: "drafts", label: "草稿资产", statuses: ["draft"], count: counts.draft },
      { id: "archive", label: "归档资产", statuses: ["archived"], count: counts.archived }
    ],
    total: exhibitions.length + reportDrafts.length
  };
}

function renderAssetReleaseTimeline(timeline = []) {
  return `
    <div class="asset-release-timeline">
      <div class="asset-reference-heading">
        <strong>发布记录时间线</strong>
        <small>${timeline.length ? "最近资产状态与批量操作" : "等待发布操作"}</small>
      </div>
      ${timeline.length ? timeline.map((item) => `
        <div class="asset-audit-row">
          <span>${escapeHtml(formatDate(item.at) || "刚刚")}</span>
          <strong>${escapeHtml(item.label || "专题资产操作")}</strong>
          <small>${escapeHtml(item.detail || item.action || "")}</small>
        </div>
      `).join("") : "<small>完成状态推进或筛选导出后，这里会留下轻量记录。</small>"}
    </div>
  `;
}

function renderAssetPackageComparison(comparison = []) {
  return `
    <div class="asset-package-compare">
      <div class="asset-reference-heading">
        <strong>资产包内容对比</strong>
        <small>按状态查看数量、连接和缺口</small>
      </div>
      <div class="asset-compare-grid">
        ${comparison.map((item) => `
          <span>
            <b>${escapeHtml(item.label)}</b>
            <small>${item.count} 个资产 / ${item.links} 条连接 / ${item.issues} 个缺口</small>
            <small>${item.sample.length ? escapeHtml(item.sample.join("、")) : "暂无资产"}</small>
          </span>
        `).join("")}
      </div>
    </div>
  `;
}

function renderAssetExportManifest(manifest) {
  return `
    <div class="asset-export-filter">
      <div class="asset-reference-heading">
        <strong>导出清单过滤</strong>
        <small>${manifest.total} 个专题资产</small>
      </div>
      <div class="asset-export-statuses">
        <span>草稿 ${manifest.counts.draft || 0}</span>
        <span>复核 ${manifest.counts.review || 0}</span>
        <span>发布 ${manifest.counts.published || 0}</span>
        <span>归档 ${manifest.counts.archived || 0}</span>
      </div>
      <div class="asset-export-actions">
        ${manifest.filters.map((filter) => `
          <button type="button" data-asset-export-filter="${escapeHtml(filter.id)}" ${filter.count ? "" : "disabled"}>
            ${escapeHtml(filter.label)} ${filter.count}
          </button>
        `).join("")}
      </div>
      <div class="asset-batch-actions">
        ${manifest.transitionPreview.map((item) => `
          <button type="button" data-asset-batch-from="${escapeHtml(item.from)}" data-asset-batch-to="${escapeHtml(item.to)}" ${item.ready ? "" : "disabled"}>
            ${escapeHtml(item.label)} ${item.ready}/${item.candidates}
          </button>
        `).join("")}
      </div>
      <div class="asset-diff-preview">
        ${manifest.transitionPreview.map((item) => `
          <span>${escapeHtml(item.label)}：可推进 ${item.ready}，需修复 ${item.blocked}</span>
        `).join("")}
      </div>
      <div class="asset-package-list">
        ${manifest.items.slice(0, 8).map((item) => `
          <div class="asset-package-row">
            <span>${escapeHtml(item.typeLabel)}</span>
            <strong>${escapeHtml(item.title)}</strong>
            <small>${escapeHtml(item.status)} / 连接 ${item.links} / ${item.issues.length ? `${item.issues.length} 项待整理` : "可进入导出包"}</small>
            <button type="button" data-asset-open="${escapeHtml(item.id)}" data-asset-type="${escapeHtml(item.type)}">打开</button>
          </div>
        `).join("")}
      </div>
      ${renderAssetPackageComparison(manifest.packageComparison)}
      ${renderAssetPackageValidation(manifest.packageValidation)}
      <details class="asset-advanced-tools">
        <summary>
          <span>高级审计、快照与签名</span>
          <small>出现导入异常或发布复核时再展开</small>
        </summary>
        ${renderAssetReleaseTimeline(manifest.releaseTimeline)}
        ${renderAssetAuditFilters(manifest.auditFilters)}
        ${renderAssetAuditSearch(manifest.auditSearch)}
        ${renderAssetSnapshotList(manifest.snapshots)}
        ${renderAssetSnapshotComparison(manifest.snapshotComparison)}
        ${renderAssetPackageSignature(manifest.packageSignature, manifest.signatureRecovery)}
      </details>
    </div>
  `;
}

function validateAssetPayload(type, payload) {
  const blocking = [];
  const warnings = [];
  const status = payload.status || "draft";
  const needsReviewQuality = ["review", "published"].includes(status);
  if (!String(payload.title || "").trim()) blocking.push("请先填写标题。");
  if (type === "report") {
    if (!Array.isArray(payload.sections) || !payload.sections.length) {
      (needsReviewQuality ? blocking : warnings).push("报告还没有章节。");
    }
    if (!Array.isArray(payload.references) || !payload.references.length) {
      (needsReviewQuality ? blocking : warnings).push("报告还没有引用来源。");
    }
  } else {
    if (!Array.isArray(payload.memoryIds) || !payload.memoryIds.length) {
      (needsReviewQuality ? blocking : warnings).push("专题展还没有展品排序。");
    }
    if (!payload.coverMemoryId) warnings.push("建议补充封面展品 ID，导出包会更完整。");
    if (!String(payload.intro || payload.guideText || "").trim()) warnings.push("建议补充专题说明或导览词。");
  }
  return { blocking, warnings };
}

function exportActiveAsset() {
  if (!activeAssetDialog?.asset?.id) return;
  const payload = {
    schemaVersion: SCHEMA_VERSION,
    phase: 15,
    assetType: activeAssetDialog.type,
    exportedAt: new Date().toISOString(),
    asset: activeAssetDialog.asset
  };
  downloadJsonPayload(payload, `memory-museum-${activeAssetDialog.type}-${activeAssetDialog.asset.id}.json`);
  setStorageStatus(`已导出专题资产预览：${activeAssetDialog.asset.title || activeAssetDialog.asset.id}`, "success");
}

async function saveSavedAssetEdits(form) {
  if (!databaseAvailable || !activeAssetDialog?.asset?.id) {
    setStorageStatus("需要先连接 Node 后端和 SQLite，才能保存专题资产编辑。", "warning");
    return;
  }
  const type = activeAssetDialog.type;
  const asset = activeAssetDialog.asset;
  const formData = new FormData(form);
  const endpoint = type === "report" ? API_REPORT_DRAFTS : API_EXHIBITIONS;
  const title = limitText(String(formData.get("title") || "").trim(), 120);
  const payload = type === "report"
    ? {
      ...asset,
      title,
      status: formData.get("status"),
      sections: parseReportSectionsInput(formData.get("sections")),
      references: parseReportReferencesInput(formData.get("references"))
    }
    : {
      ...asset,
      title,
      status: formData.get("status"),
      intro: limitText(formData.get("intro"), 800),
      guideText: limitText(formData.get("guideText"), 2000),
      tags: normalizeList(formData.get("tags")),
      coverMemoryId: limitText(formData.get("coverMemoryId"), 80),
      memoryIds: parseAssetMemoryIdsInput(formData.get("memoryIds")),
      sort: parseAssetMemoryIdsInput(formData.get("memoryIds"))
    };
  const validation = validateAssetPayload(type, payload);
  if (validation.blocking.length) {
    setAssetFormStatus(form, validation.blocking.join(" "), "error");
    return;
  }
  if (validation.warnings.length) {
    setAssetFormStatus(form, validation.warnings.join(" "), "editing");
  }
  const saveMessage = validation.warnings.length
    ? `正在保存到 SQLite... 另有 ${validation.warnings.length} 项草稿提示。`
    : "正在保存到 SQLite...";
  setAssetFormStatus(form, saveMessage, "saving");
  setStorageStatus(`正在保存专题资产编辑：${payload.title || asset.id}`, "loading");
  try {
    const response = await requestJson(endpoint, {
      method: "POST",
      body: JSON.stringify(payload)
    });
    const saved = type === "report" ? response.reportDraft : response.savedExhibition;
    activeAssetDialog = { type, asset: saved };
    await syncAssetCollection({ quiet: true });
    setStorageStatus(`专题资产编辑已保存：${saved?.title || payload.title}`, "success");
    setAssetFormStatus(form, validation.warnings.length ? `已保存，仍建议处理：${validation.warnings.join(" ")}` : "已保存。", validation.warnings.length ? "editing" : "saved");
    renderSavedAssetDialog(type, saved);
  } catch (error) {
    setStorageStatus(`专题资产编辑保存失败：${error.message}`, "warning");
    setAssetFormStatus(form, `保存失败：${error.message}`, "error");
  }
}

async function loadMemoriesFromDatabase({ silent = false } = {}) {
  if (!silent) setStorageStatus("正在从 SQLite 数据库读取展品...", "loading");
  const payload = await requestJson(API_MEMORIES);
  const remoteMemories = Array.isArray(payload.memories) ? payload.memories.map(normalizeMemory) : [];
  databaseAvailable = true;
  const remoteIds = new Set(remoteMemories.map((memory) => memory.id));
  const localOnlyMemories = memories.filter((memory) => !remoteIds.has(memory.id));

  if (remoteMemories.length === 0 && memories.length > 0) {
    databaseNeedsMigration = true;
    setStorageStatus(`数据库已连接但暂为空：当前显示 ${memories.length} 件本地备份，可点击“迁移本地”写入 SQLite。`, "warning");
    render();
    return remoteMemories;
  }

  if (remoteMemories.length > 0 && localOnlyMemories.length > 0) {
    databaseNeedsMigration = true;
    memories = [...localOnlyMemories, ...remoteMemories];
    persistMemories(memories);
    setStorageStatus(`数据库已连接：发现 ${localOnlyMemories.length} 件只在本地备份中的展品，当前已合并显示，可点击“迁移本地”补写入 SQLite。`, "warning");
    render();
    return remoteMemories;
  }

  databaseNeedsMigration = false;
  memories = remoteMemories;
  persistMemories(remoteMemories);
  setStorageStatus(`数据库已连接：SQLite 中有 ${remoteMemories.length} 件展品，本地保留备份。`, "success");
  render();
  return remoteMemories;
}

async function initializeStorage() {
  try {
    await loadMemoriesFromDatabase();
    await syncWorkflowBlueprint({ quiet: true });
    await syncPrivacyPolicy({ quiet: true });
    await syncVersionInfo({ quiet: true });
    await syncAssetCollection({ quiet: true });
    renderWorkflowOrchestration();
    renderPrivacyPanel();
    renderOperationsPanel();
    renderPhase20PlatformPanel();
    renderAssetCollectionPanel();
    renderPhase19ImportLab();
  } catch (error) {
    databaseAvailable = false;
    databaseNeedsMigration = false;
    backendWorkflowBlueprint = null;
    workflowBlueprintSource = "local";
    privacyPolicy = null;
    privacyPolicySource = "local";
    versionInfo = null;
    operationsSource = "local";
    assetCollection = null;
    assetSource = "local";
    setStorageStatus(`数据库未连接：正在使用浏览器本地备份。${error.message ? `原因：${error.message}` : ""}`, "warning");
    render();
  }
}

async function saveMemoryToDatabase(memory, existingId = "") {
  const method = existingId ? "PUT" : "POST";
  const url = existingId ? `${API_MEMORIES}/${encodeURIComponent(existingId)}` : API_MEMORIES;
  const agentWorkflow = latestAgentWorkflow?.run?.id === memory.agentRunId ? latestAgentWorkflow : null;
  const payload = await requestJson(url, {
    method,
    body: JSON.stringify(agentWorkflow ? { ...memory, agentWorkflow } : memory)
  });
  return normalizeMemory(payload.memory);
}

async function fetchAgentRunForMemory(memoryId) {
  const payload = await requestJson(`${API_MEMORIES}/${encodeURIComponent(memoryId)}/agent-run`);
  return payload.run || null;
}

async function deleteMemoryFromDatabase(id) {
  await requestJson(`${API_MEMORIES}/${encodeURIComponent(id)}`, { method: "DELETE" });
}

async function purgeDatabaseMemories() {
  return requestJson(`${API_MEMORIES}/purge`, {
    method: "DELETE",
    body: JSON.stringify({ confirm: "DELETE" })
  });
}

async function importMemoriesToDatabase(items) {
  const payload = await requestJson(`${API_MEMORIES}/import`, {
    method: "POST",
    body: JSON.stringify({ memories: items })
  });
  return {
    imported: payload.imported || 0,
    importedIds: Array.isArray(payload.importedIds) ? payload.importedIds : items.map((item) => item.id).filter(Boolean),
    memories: Array.isArray(payload.memories) ? payload.memories.map(normalizeMemory) : []
  };
}

async function migrateCurrentLocalBackup({ quiet = false } = {}) {
  const localMemories = memories.map(normalizeMemory);
  if (localMemories.length === 0) {
    databaseNeedsMigration = false;
    return { imported: 0, memories: [] };
  }

  if (!quiet) setStorageStatus(`正在把 ${localMemories.length} 件本地备份写入 SQLite...`, "loading");
  const result = await importMemoriesToDatabase(localMemories);
  databaseAvailable = true;
  databaseNeedsMigration = false;
  memories = result.memories;
  persistMemories(memories);
  return result;
}

async function checkAiBackend() {
  try {
    const response = await fetch("/api/health");
    if (!response.ok) throw new Error("health check failed");
    const payload = await response.json();
    backendStats = payload.database?.stats || null;
    backendAiConfigured = Boolean(payload.aiConfigured);
    renderStats();
    if (payload.aiConfigured) {
      setAiStatus(`后端已连接：Agent 工作流可用，AI 模型 ${payload.model} 已配置。`, "success");
    } else {
      setAiStatus("后端已连接：未配置 AI_API_KEY，分析时会使用后端 Mock Agent 工作流回退。", "warning");
    }
  } catch {
    backendAiConfigured = false;
    setAiStatus("未连接 Node 后端：当前会使用前端本地 Agent 工作流。运行 npm start 可启用 AI 与数据库接口。", "warning");
  }
}

function updateEmotionIntensityOutput() {
  elements.emotionIntensityOutput.textContent = `${elements.emotionIntensity.value} / 5`;
  renderDraftPreview();
}

function updateRawCount() {
  elements.rawCount.textContent = `${elements.rawContent.value.length} / ${fieldLimits.rawContent}`;
  renderDraftPreview();
}

function renderMemories() {
  const list = filteredMemories();

  if (list.length === 0) {
    const hint = searchKeyword ? "没有搜到匹配展品。可以换个关键词，或清空搜索后再看。" : "先放入第一件记忆展品。它会像一张展签一样留在这里，之后还能进入主题展、报告和发布包。";
    const actionText = searchKeyword ? "清空筛选后再看" : "去添加记忆";
    elements.memoryGrid.innerHTML = `
      <div class="empty-state museum-empty-state">
        <span class="empty-state-mark" aria-hidden="true"></span>
        <strong>${escapeHtml(searchKeyword ? "暂时没有匹配展品" : "展品墙等待第一束灯光")}</strong>
        <small>${escapeHtml(hint)}</small>
        <button type="button" data-empty-action>${escapeHtml(actionText)}</button>
      </div>
    `;
    elements.memoryGrid.querySelector("[data-empty-action]")?.addEventListener("click", () => {
      if (searchKeyword) {
        clearCollectionFilters();
        return;
      }
      elements.rawContent?.focus();
      elements.memoryForm?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return;
  }

  elements.memoryGrid.innerHTML = list.map((memory) => {
    const tags = [...(memory.emotions || []).slice(0, 3), ...(memory.tags || []).slice(0, 3)]
      .map((tag) => pillHtml(tag))
      .join("");
    const dateOrCreated = memory.date || formatDate(memory.createdAt);
    const archiveNumber = getArchiveNumber(memory);
    const attachmentCount = normalizeAttachments(memory.attachments).length;
    const attachmentTypeSummary = formatAttachmentTypeSummary(memory.attachments);

    return `
      <article class="memory-card ${editingId === memory.id ? "is-editing" : ""}">
        <span class="card-stamp">${escapeHtml(archiveNumber)}</span>
        <div class="card-meta">
          ${pillHtml(getHallName(memory.hall), "hall-pill")}
          ${memory.favorite ? pillHtml("重点", "favorite-pill") : ""}
          ${memory.agentRunId ? pillHtml("有整理历史", "history-pill") : ""}
          ${memory.coverImage ? pillHtml("封面线索", "media-pill") : ""}
          ${attachmentCount ? pillHtml(`${attachmentCount} 个附件`, "media-pill") : ""}
          ${memory.location ? pillHtml(memory.location) : ""}
          ${dateOrCreated ? pillHtml(dateOrCreated) : ""}
        </div>
        <h4>${escapeHtml(memory.title)}</h4>
        <p>${escapeHtml(memory.exhibitText)}</p>
        ${memory.mediaNote ? `<p class="media-note-preview">${escapeHtml(limitText(memory.mediaNote, 86))}</p>` : ""}
        ${attachmentTypeSummary ? `<div class="media-type-strip"><span>附件类型</span><strong>${escapeHtml(attachmentTypeSummary)}</strong></div>` : ""}
        <div class="card-facts">
          <span>${escapeHtml(memory.sourceType)}</span>
          <span>${escapeHtml(getImportanceLabel(memory.importance))}</span>
          <span>情绪强度 ${escapeHtml(memory.emotionIntensity)} / 5</span>
        </div>
        <div class="tag-row">${tags}</div>
        <div class="card-actions">
          <button type="button" data-view="${memory.id}">查看详情</button>
          <button type="button" data-edit="${memory.id}">编辑</button>
          <button type="button" class="delete-button" data-delete="${memory.id}">删除</button>
        </div>
      </article>
    `;
  }).join("");

  elements.memoryGrid.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => openMemory(button.dataset.view));
  });

  elements.memoryGrid.querySelectorAll("[data-edit]").forEach((button) => {
    button.addEventListener("click", () => startEdit(button.dataset.edit));
  });

  elements.memoryGrid.querySelectorAll("[data-delete]").forEach((button) => {
    button.addEventListener("click", () => deleteMemory(button.dataset.delete));
  });
}

function getArchiveNumber(memory) {
  const index = memories.findIndex((item) => item.id === memory.id);
  return `MM-${String(index + 1).padStart(4, "0")}`;
}

function renderGuide(text) {
  if (text) {
    elements.guideCopy.textContent = text;
    return;
  }

  const currentHall = halls.find((hall) => hall.id === activeHall) || halls[0];
  const currentMemories = filteredMemories();
  const featured = currentMemories[0] ? `\n\n当前推荐先看《${currentMemories[0].title}》。` : "";
  const favoriteCount = currentMemories.filter((memory) => memory.favorite).length;
  const averageIntensity = currentMemories.length
    ? (currentMemories.reduce((sum, memory) => sum + (memory.emotionIntensity || 1), 0) / currentMemories.length).toFixed(1)
    : "0";
  const storageName = databaseAvailable ? "SQLite 数据库" : "浏览器本地备份";
  const runCount = currentMemories.filter((memory) => memory.agentRunId).length;
  const phase10 = buildPhase10Handoff(currentMemories);
  const phase10Text = `第十阶段交接线索：${phase10.timelineReady} 件可进入时间线，${phase10.themeReady} 件具备主题展线索，${phase10.multimodalEvidence} 件带多模态证据。`;
  elements.guideCopy.textContent = `欢迎来到${currentHall.name}。\n\n这里现在有 ${currentMemories.length} 件展品，其中 ${favoriteCount} 件被标记为重点展品，平均情绪强度 ${averageIntensity} / 5。当前使用${storageName}，其中 ${runCount} 件展品已经带有 Agent 整理历史。\n\n第十阶段会把已保存展品整理为时间线、主题展和回忆报告草稿，并继续参考封面图、附件清单、OCR 和语音转写描述。\n\n${phase10Text}${featured}`;
}

function renderInsights() {
  const source = insightScope === "filtered"
    ? filteredMemories()
    : insightScope === "hall" && activeHall !== "all"
      ? memories.filter((memory) => memory.hall === activeHall)
      : memories;
  const insights = buildPhase10Insights(source);
  const longTermAgent = buildPhase18LongTermAgent(source);
  const scopeLabel = insightScope === "filtered"
    ? `基于当前筛选结果：${source.length} / ${memories.length} 件`
    : insightScope === "hall" && activeHall !== "all"
      ? `基于${getHallName(activeHall)}：${source.length} / ${memories.length} 件`
      : `基于全馆展品：${source.length} 件`;
  elements.insightScopeSelect.value = insightScope;
  elements.insightScopeMeta.textContent = scopeLabel;
  elements.timelineCount.textContent = `${insights.timeline.length} 个阶段`;
  elements.themeCount.textContent = `${insights.themes.length} 个主题`;
  elements.reportMeta.textContent = insights.report.total ? `${insights.report.total} 件展品` : "等待展品";

  elements.timelineList.innerHTML = insights.timeline.length
    ? insights.timeline.slice(0, 5).map((group) => `
      <div class="timeline-item">
        <span class="timeline-dot"></span>
        <div>
          <strong>${escapeHtml(group.label)}</strong>
          <p>${group.count} 件展品${group.mediaCount ? `，${group.mediaCount} 件带多模态线索` : ""}</p>
          <small>${escapeHtml(group.memories.map((memory) => `《${memory.title}》`).join("、"))}</small>
          <button type="button" data-timeline-search="${escapeHtml(group.memories[0]?.date || group.label)}">查看这一段</button>
        </div>
      </div>
    `).join("")
    : `<div class="insight-empty">保存带时间的展品后，这里会生成记忆时间线。</div>`;

  elements.themeList.innerHTML = insights.themes.length
    ? insights.themes.slice(0, 6).map((theme) => {
      const emotions = theme.topEmotions.map((item) => `${item.label} ${item.count}`).join(" / ");
      return `
        <div class="theme-item">
          <span>${escapeHtml(theme.type)}</span>
          <strong>${escapeHtml(theme.title)}</strong>
          <p>${escapeHtml(theme.description)}</p>
          <small>${theme.count} 件展品${theme.mediaCount ? ` / 多模态 ${theme.mediaCount}` : ""}${emotions ? ` / ${escapeHtml(emotions)}` : ""}</small>
          ${theme.coverMemory ? `<small>代表展品：${escapeHtml(`《${theme.coverMemory.title}》`)}</small>` : ""}
          <div class="theme-action-row">
            <button type="button" data-theme-search="${escapeHtml(theme.title)}">查看相关展品</button>
            <button type="button" data-theme-save="${escapeHtml(theme.title)}">保存为专题展</button>
          </div>
        </div>
      `;
    }).join("")
    : `<div class="insight-empty">补充人物、地点、标签或情绪后，这里会生成主题展候选。</div>`;

  const report = insights.report;
  const topTags = report.topTags.map((item) => `${item.label} ${item.count}`).join(" / ") || "暂无标签";
  const topPeople = report.topPeople.map((item) => `${item.label} ${item.count}`).join(" / ") || "暂无人物";
  const highlights = report.highlights.map((memory) => `《${memory.title}》`).join("、") || "暂无重点展品";
  const references = (report.references || []).map((memory) => `${memory.role}：《${memory.title}》`).join("；") || "暂无引用展品";
  const dateRange = report.dateRange?.start
    ? report.dateRange.start === report.dateRange.end ? report.dateRange.start : `${report.dateRange.start} 至 ${report.dateRange.end}`
    : "未形成时间范围";
  const coverage = `${insights.handoff.timelineReady}/${insights.handoff.total || 0} 时间线，${insights.handoff.themeReady}/${insights.handoff.total || 0} 主题，${insights.handoff.reportReady}/${insights.handoff.total || 0} 报告`;
  elements.reportPanel.innerHTML = `
    <p>${escapeHtml(report.summary)}</p>
    <div class="report-facts">
      <span>重点展品 ${report.favoriteCount}</span>
      <span>多模态 ${report.multimodalCount}</span>
      <span>时间 ${escapeHtml(dateRange)}</span>
      <span>覆盖 ${escapeHtml(coverage)}</span>
      <span>标签 ${escapeHtml(topTags)}</span>
      <span>人物 ${escapeHtml(topPeople)}</span>
    </div>
    <div class="report-sections">
      ${(report.sections || []).map((section) => `
        <section>
          <strong>${escapeHtml(section.title)}</strong>
          <small>${escapeHtml(section.text)}</small>
        </section>
      `).join("")}
    </div>
    <strong>报告开头候选</strong>
    <small>${escapeHtml(highlights)}</small>
    <strong>引用展品</strong>
    <small>${escapeHtml(references)}</small>
    <button type="button" class="asset-inline-action" data-report-draft>生成报告草稿</button>
  `;
  renderPhase18AgentPanel(longTermAgent);
  renderAssetCollectionPanel();
}

function renderPhase18AgentPanel(agent = buildPhase18LongTermAgent()) {
  if (!elements.phase18AgentPanel) return;
  const visibleSuggestions = agent.visibleSuggestions?.length ? agent.visibleSuggestions : agent.suggestions;
  const suggestionItems = visibleSuggestions.length
    ? visibleSuggestions.slice(0, 5).map((item) => `
      <div class="phase18-suggestion" data-priority="${escapeHtml(item.priority)}">
        <div>
          <strong>${escapeHtml(item.title)}</strong>
          <small>${escapeHtml(item.detail)}</small>
        </div>
        <small>${escapeHtml(item.type)} / ${escapeHtml(item.count)} 件相关展品 / ${escapeHtml(item.quality?.tier || "C")} 级建议 ${escapeHtml(item.quality?.score || 0)} 分</small>
        <small>${escapeHtml(item.quality?.reason || "")}</small>
        <div class="phase18-memory-links">${item.examples.map((memory) => `<button type="button" data-phase18-open="${escapeHtml(memory.id)}">${escapeHtml(memory.title)}</button>`).join("")}</div>
        <div class="phase18-actions">
          <button type="button" data-phase18-repair-draft="${escapeHtml(item.id)}" data-phase18-label="${escapeHtml(item.title)}">生成修复草案</button>
          <button type="button" data-phase18-feedback="accepted" data-phase18-target="${escapeHtml(item.id)}" data-phase18-label="${escapeHtml(item.title)}">采纳</button>
          <button type="button" data-phase18-feedback="dismissed" data-phase18-target="${escapeHtml(item.id)}" data-phase18-label="${escapeHtml(item.title)}">暂不处理</button>
        </div>
      </div>
    `).join("")
    : `<small>当前没有主动整理建议；继续补充展品后，长期助理会重新评估。</small>`;
  const relationItems = agent.relationships.clusters.length
    ? agent.relationships.clusters.slice(0, 5).map((item) => `
      <div class="phase18-relation">
        <strong>${escapeHtml(item.type)}：${escapeHtml(item.value)}</strong>
        <small>${escapeHtml(item.count)} 件展品 / ${escapeHtml(item.strength || "light")} 证据</small>
        <small>${escapeHtml(item.evidence || "")}</small>
        <small>${escapeHtml(item.memories.map((memory) => `《${memory.title}》`).join("、"))}</small>
        ${(item.assetLinks?.length || item.reportLinks?.length) ? `
          <div class="phase18-relation-assets">
            ${(item.assetLinks || []).map((asset) => `<button type="button" data-phase18-open-asset="${escapeHtml(asset.id)}">专题展：${escapeHtml(asset.title)}</button>`).join("")}
            ${(item.reportLinks || []).map((report) => `<button type="button" data-phase18-open-report="${escapeHtml(report.id)}">报告：${escapeHtml(report.title)}</button>`).join("")}
          </div>
        ` : `<small>${escapeHtml(agent.relationships.assetNavigation?.recommendation || "")}</small>`}
      </div>
    `).join("")
    : `<small>还没有稳定的跨展品关系。</small>`;
  const graph = filterPhase18RelationshipGraph(agent.relationships.graph || buildPhase18RelationshipGraph(agent.relationships.clusters || []));
  const graphNodes = graph.visibleNodes || graph.nodes || [];
  const graphEdges = graph.visibleEdges || graph.edges || [];
  const graphItems = graphNodes.length
    ? `
      <div class="phase18-graph">
        <div>
          <strong>关系图谱</strong>
          <small>${escapeHtml(graph.summary)}</small>
        </div>
        <div class="phase18-graph-filters">
          ${["all", "cluster", "memory", "asset", "report"].map((filter) => `<button type="button" data-phase18-graph-filter="${escapeHtml(filter)}" ${graph.filter === filter ? "aria-pressed=\"true\"" : ""}>${escapeHtml(filter === "all" ? "全部" : filter === "cluster" ? "关系" : filter === "memory" ? "展品" : filter === "asset" ? "专题展" : "报告")}</button>`).join("")}
        </div>
        <div class="phase18-graph-nodes">
          ${graphNodes.slice(0, 12).map((node) => {
            const memoryId = node.type === "memory" ? String(node.id || "").replace(/^memory-/, "") : "";
            const assetId = node.type === "asset" ? String(node.id || "").replace(/^asset-/, "") : "";
            const reportId = node.type === "report" ? String(node.id || "").replace(/^report-/, "") : "";
            return `<span data-node-type="${escapeHtml(node.type)}" ${memoryId ? `data-phase18-open="${escapeHtml(memoryId)}"` : ""} ${assetId ? `data-phase18-open-asset="${escapeHtml(assetId)}"` : ""} ${reportId ? `data-phase18-open-report="${escapeHtml(reportId)}"` : ""}>${escapeHtml(node.label)}</span>`;
          }).join("")}
        </div>
        <small>${escapeHtml(graphEdges.slice(0, 5).map((edge) => `${edge.label}:${edge.strength}`).join(" / ") || "等待关系边")}</small>
      </div>
    `
    : `<div class="phase18-graph"><strong>关系图谱</strong><small>等待更多人物、地点、标签或情绪线索。</small></div>`;
  const reviewItems = agent.periodicReviews.length
    ? agent.periodicReviews.slice(0, 4).map((item) => `
      <div class="phase18-review">
        <strong>${escapeHtml(item.label)}</strong>
        <small>${escapeHtml(item.count)} 件展品 / ${escapeHtml(item.topEmotions.map((emotion) => `${emotion.label} ${emotion.count}`).join(" / ") || "情绪待补充")}</small>
        <div class="phase18-review-actions">
          <button type="button" data-phase18-save-review="${escapeHtml(item.id)}">保存为专题展</button>
          <button type="button" data-phase18-save-review-report="${escapeHtml(item.id)}">生成报告草稿</button>
          ${item.assetLink?.exists ? `<button type="button" data-phase18-open-asset="${escapeHtml(item.assetLink.id)}">打开专题展</button>` : ""}
          ${item.reportLink?.exists ? `<button type="button" data-phase18-open-report="${escapeHtml(item.reportLink.id)}">打开报告</button>` : ""}
        </div>
      </div>
    `).join("")
    : `<small>带日期的展品还不足以形成周期回顾。</small>`;
  const repairItems = agent.repairDrafts.recent.length
    ? agent.repairDrafts.recent.map((draft) => `
      <div class="phase18-repair-row" data-repair-status="${escapeHtml(draft.status)}">
        <div>
          <strong>${escapeHtml(draft.memoryTitle || draft.memoryId)}</strong>
          <small>${escapeHtml(draft.reason || "")}</small>
        </div>
        <small>${Object.entries(draft.patch || {}).map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join("、") : value}`).join(" / ")}</small>
        ${draft.status === "preview" ? `<button type="button" data-phase18-apply-repair="${escapeHtml(draft.id)}">应用草案</button>` : `<small>已应用</small>`}
      </div>
    `).join("")
    : `<small>还没有修复草案。点击建议里的“生成修复草案”后会在这里预览。</small>`;
  const batchReview = agent.repairDrafts.batchReview || buildPhase18RepairBatchReview();
  const batchReviewItems = batchReview.ready
    ? `
      <div class="phase18-batch-review">
        <div>
          <strong>批量应用前复核</strong>
          <small>${escapeHtml(batchReview.previewCount)} 条草案 / ${escapeHtml(batchReview.targetCount)} 件展品 / ${escapeHtml(batchReview.highRiskCount)} 条占位字段</small>
        </div>
        <small>字段：${escapeHtml(batchReview.fields.map((item) => `${item.label} ${item.count}`).join(" / ") || "待统计")}</small>
        <small>${escapeHtml(batchReview.policy)}</small>
        <div class="phase18-batch-examples">
          ${batchReview.recent.map((item) => `<span>${escapeHtml(item.memoryTitle)}：${escapeHtml(item.fields.join("、") || "字段待复核")}</span>`).join("")}
        </div>
        <button type="button" data-phase18-apply-repair-batch>批量应用预览草案</button>
      </div>
    `
    : `<div class="phase18-batch-review"><strong>批量应用前复核</strong><small>当前没有待应用的预览草案。</small></div>`;
  const auditItems = agent.taskAudit?.recent?.length
    ? agent.taskAudit.recent.slice(0, 5).map((item) => `
      <div class="phase18-audit-row">
        <strong>${escapeHtml(item.action)}</strong>
        <small>${escapeHtml(item.detail || item.targetId || "")}</small>
        <small>${escapeHtml(formatDateTime(item.at))}</small>
      </div>
    `).join("")
    : `<small>任务状态变更、草案生成和批量应用会在这里留下审计记录。</small>`;
  const selectedTaskIds = new Set(agent.taskQueue.selectedIds || []);
  const taskBatch = agent.taskQueue.batchReview || buildPhase18TaskBatchReview();
  const taskBatchPanel = `
    <div class="phase18-task-batch-panel">
      <div>
        <strong>批量任务处理</strong>
        <small>${escapeHtml(taskBatch.recommendation || "")}</small>
      </div>
      <div class="phase18-task-batch-summary">
        <span><b>${escapeHtml(taskBatch.selectedCount || 0)}</b><small>已选择</small></span>
        <span><b>${escapeHtml(taskBatch.activeCount || 0)}</b><small>活跃</small></span>
        <span><b>${escapeHtml(taskBatch.memoryCount || 0)}</b><small>关联展品</small></span>
        <span><b>${escapeHtml(taskBatch.draftableCount || 0)}</b><small>可生成草案</small></span>
      </div>
      <small>状态分布：等待 ${escapeHtml(taskBatch.statusCounts?.queued || 0)} / 复核 ${escapeHtml(taskBatch.statusCounts?.reviewing || 0)} / 完成 ${escapeHtml(taskBatch.statusCounts?.applied || 0)} / 忽略 ${escapeHtml(taskBatch.statusCounts?.dismissed || 0)} / 失败 ${escapeHtml(taskBatch.statusCounts?.failed || 0)}</small>
      <div class="phase18-task-batch-actions">
        <button type="button" data-phase18-task-select-visible>选择当前列表</button>
        <button type="button" data-phase18-task-selection-clear>清空选择</button>
        <button type="button" data-phase18-task-batch-status="reviewing" ${taskBatch.canBatch ? "" : "disabled"}>批量复核</button>
        <button type="button" data-phase18-task-batch-status="applied" ${taskBatch.canBatch ? "" : "disabled"}>批量完成</button>
        <button type="button" data-phase18-task-batch-status="dismissed" ${taskBatch.canBatch ? "" : "disabled"}>批量忽略</button>
        <button type="button" data-phase18-task-batch-status="failed" ${taskBatch.canBatch ? "" : "disabled"}>批量失败</button>
        <button type="button" data-phase18-task-batch-repair ${taskBatch.draftableCount ? "" : "disabled"}>批量生成草案</button>
      </div>
    </div>
  `;
  const taskItems = agent.taskQueue.visible.length
    ? agent.taskQueue.visible.map((task) => `
      <div class="phase18-task-row" data-task-status="${escapeHtml(task.status)}">
        <label class="phase18-task-select">
          <input type="checkbox" data-phase18-task-select="${escapeHtml(task.id)}" ${selectedTaskIds.has(task.id) ? "checked" : ""}>
          <span>选择</span>
        </label>
        <div>
          <strong>${escapeHtml(task.label)}</strong>
          <small>${escapeHtml(getPhase18TaskStatusLabel(task.status))} / ${escapeHtml(task.source)} / ${escapeHtml(task.memoryIds.length)} 件相关展品</small>
        </div>
        <small>${escapeHtml(task.detail || "")}</small>
        <div class="phase18-task-actions">
          ${getPhase18TaskNextActions(task.status).map((action) => `
            <button type="button" data-phase18-task-status="${escapeHtml(action.status)}" data-phase18-task-id="${escapeHtml(task.id)}">${escapeHtml(action.label)}</button>
          `).join("")}
        </div>
      </div>
    `).join("")
    : `<small>当前筛选下没有长期任务。</small>`;
  const quality = agent.agentQuality || buildPhase18AgentQuality();
  const dashboard = agent.reviewDashboard || {};
  const digest = agent.agentDigest || buildPhase18AgentDigest();
  const digestActions = digest.topActions?.length
    ? digest.topActions.map((item) => `
      <span>
        <b>${escapeHtml(item.label)}</b>
        <small>${escapeHtml(item.detail || "")}</small>
      </span>
    `).join("")
    : `<small>暂无明确动作，先继续补充展品线索。</small>`;
  const digestPanel = `
    <article class="phase18-agent-digest" data-readiness="${escapeHtml(digest.readiness || "warming-up")}">
      <div class="phase18-digest-heading">
        <strong>长期助理摘要</strong>
        <small>${escapeHtml(digest.readiness === "needs-attention" ? "需要先处理风险" : digest.readiness === "ready" ? "适合推进" : "继续升温")}</small>
      </div>
      <div class="phase18-digest-focus">
        <span><b>今日焦点</b><small>${escapeHtml(digest.todayFocus || "")}</small></span>
        <span><b>本周焦点</b><small>${escapeHtml(digest.weeklyFocus || "")}</small></span>
      </div>
      <div class="phase18-digest-strip">
        <span><b>${escapeHtml(digest.signals?.activeTasks || 0)}</b><small>活跃任务</small></span>
        <span><b>${escapeHtml(digest.signals?.relationClusters || 0)}</b><small>关系簇</small></span>
        <span><b>${escapeHtml(digest.signals?.reviewCandidates || 0)}</b><small>回顾候选</small></span>
        <span><b>${escapeHtml(digest.signals?.previewDrafts || 0)}</b><small>待审草案</small></span>
        <span><b>${escapeHtml(digest.signals?.assetSyncRisk || 0)}</b><small>同步风险</small></span>
      </div>
      <div class="phase18-digest-actions">${digestActions}</div>
      <small>${escapeHtml(digest.recommendation || "")}</small>
      <small>节奏：${escapeHtml(digest.cadence?.daily || "")} / ${escapeHtml(digest.cadence?.weekly || "")}</small>
      <button type="button" data-phase18-create-digest-task>生成摘要任务</button>
    </article>
  `;
  const reviewPanel = `
    <article class="phase18-review-dashboard">
      <strong>长期助理复盘</strong>
      <div class="phase18-dashboard-strip">
        <span><b>${escapeHtml(dashboard.qualityScore || 0)}</b><small>综合质量</small></span>
        <span><b>${escapeHtml(dashboard.openTasks || 0)}</b><small>活跃任务</small></span>
        <span><b>${escapeHtml(dashboard.quietSuggestions || 0)}</b><small>已降噪</small></span>
        <span><b>${escapeHtml(dashboard.reviewCoverage || 0)}%</b><small>回顾沉淀</small></span>
      </div>
      <small>${escapeHtml(dashboard.focus || "")}</small>
      <small>${escapeHtml(dashboard.recommendation || "")}</small>
      <small>最近审计：${escapeHtml(dashboard.latestAudit || "暂无审计记录")}</small>
      <button type="button" data-phase18-create-review-task>生成复盘任务</button>
    </article>
  `;
  const noiseConfig = agent.suggestionNoise?.config || getDefaultPhase18NoiseRuleConfig();
  const noisePreview = agent.suggestionNoise?.preview || {};
  const quietItems = agent.suggestionNoise?.quiet?.length
    ? agent.suggestionNoise.quiet.slice(0, 4).map((item) => `
      <span>
        <b>${escapeHtml(item.title)}</b>
        <small>${escapeHtml(item.tier)} / ${escapeHtml(item.score)} / ${escapeHtml(item.reason)}</small>
      </span>
    `).join("")
    : `<small>当前没有被规则收起的建议。</small>`;
  const recoverItems = noisePreview.recoverable?.length
    ? noisePreview.recoverable.map((item) => `<span>${escapeHtml(item.title)} ${escapeHtml(item.tier)} ${escapeHtml(item.score)}</span>`).join("")
    : `<small>暂无需要恢复复核的建议。</small>`;
  const noiseRulePanel = `
    <article class="phase18-noise-rule-panel">
      <div class="phase18-noise-rule-heading">
        <strong>降噪规则配置</strong>
        <small>${escapeHtml(noisePreview.recommendation || "")}</small>
      </div>
      <div class="phase18-noise-rule-controls">
        <button type="button" data-phase18-noise-toggle="hideLowTier" aria-pressed="${noiseConfig.hideLowTier ? "true" : "false"}">隐藏 C 级</button>
        <button type="button" data-phase18-noise-toggle="hideDismissed" aria-pressed="${noiseConfig.hideDismissed ? "true" : "false"}">隐藏已忽略</button>
        <button type="button" data-phase18-noise-toggle="hideWeakEvidence" aria-pressed="${noiseConfig.hideWeakEvidence ? "true" : "false"}">隐藏弱证据</button>
        <button type="button" data-phase18-noise-toggle="keepHighPriority" aria-pressed="${noiseConfig.keepHighPriority ? "true" : "false"}">保留高优先级</button>
        <button type="button" data-phase18-noise-score="-8">降低阈值</button>
        <button type="button" data-phase18-noise-score="8">提高阈值</button>
        <button type="button" data-phase18-noise-reset>恢复默认</button>
      </div>
      <div class="phase18-noise-preview">
        <span><b>${escapeHtml(noiseConfig.minVisibleScore)}</b><small>显示阈值</small></span>
        <span><b>${escapeHtml(noisePreview.visibleCount ?? 0)}</b><small>当前显示</small></span>
        <span><b>${escapeHtml(noisePreview.quietCount ?? 0)}</b><small>已收起</small></span>
        <span><b>${escapeHtml(noisePreview.recoverableCount ?? 0)}</b><small>建议复核</small></span>
      </div>
      <div class="phase18-noise-breakdown">
        <small>分布：分层 ${escapeHtml(noisePreview.hiddenByTier || 0)} / 忽略 ${escapeHtml(noisePreview.hiddenByFeedback || 0)} / 弱证据 ${escapeHtml(noisePreview.hiddenByWeakEvidence || 0)} / 分数 ${escapeHtml(noisePreview.hiddenByScore || 0)}</small>
      </div>
      <div class="phase18-noise-quiet">${quietItems}</div>
      <div class="phase18-noise-recover"><strong>可恢复复核</strong>${recoverItems}</div>
    </article>
  `;
  elements.phase18AgentPanel.innerHTML = `
    <div class="phase18-agent-heading">
      <div>
        <span>Phase 18 Agent</span>
        <strong>长期记忆助理</strong>
      </div>
      <small>${escapeHtml(agent.sourceCount)} 件展品 / ${escapeHtml(agent.suggestions.length)} 条建议 / ${escapeHtml(agent.relationships.clusterCount)} 组关系</small>
    </div>
    <div class="phase18-grid">
      ${digestPanel}
      ${reviewPanel}
      ${noiseRulePanel}
      <article>
        <strong>主动整理建议</strong>
        <small>${escapeHtml(agent.suggestionNoise?.recommendation || "")}</small>
        ${suggestionItems}
      </article>
      <article>
        <strong>跨展品关系</strong>
        ${relationItems}
        ${graphItems}
      </article>
      <article>
        <strong>周期回顾</strong>
        ${reviewItems}
      </article>
      <article class="phase18-task-panel">
        <div class="phase18-task-heading">
          <strong>长期任务队列</strong>
          <small>活跃 ${escapeHtml(agent.taskQueue.active)} / 已完成 ${escapeHtml(agent.taskQueue.applied)} / 已忽略 ${escapeHtml(agent.taskQueue.dismissed)}</small>
        </div>
        <div class="phase18-task-filters">
          ${["active", "queued", "reviewing", "failed", "applied", "dismissed", "all"].map((filter) => `
            <button type="button" data-phase18-task-filter="${escapeHtml(filter)}" ${agent.taskQueue.filter === filter ? "aria-pressed=\"true\"" : ""}>${escapeHtml(filter === "active" ? "活跃" : getPhase18TaskStatusLabel(filter))}</button>
          `).join("")}
          <button type="button" data-phase18-clear-resolved>清理已完成</button>
        </div>
        ${taskBatchPanel}
        ${taskItems}
      </article>
      <article>
        <strong>反馈闭环</strong>
        <small>采纳 ${escapeHtml(agent.feedbackLoop.accepted)} / 忽略 ${escapeHtml(agent.feedbackLoop.dismissed)}</small>
        <small>${escapeHtml(agent.nextStep)}</small>
        <div class="phase18-quality-strip">
          <span><b>${escapeHtml(quality.acceptanceRate)}%</b><small>采纳率</small></span>
          <span><b>${escapeHtml(quality.taskResolvedRate)}%</b><small>任务闭环</small></span>
          <span><b>${escapeHtml(quality.repairApplyRate)}%</b><small>草案应用</small></span>
        </div>
        <small>建议分层：A ${escapeHtml(agent.suggestionQuality?.high || 0)} / B ${escapeHtml(agent.suggestionQuality?.medium || 0)} / C ${escapeHtml(agent.suggestionQuality?.low || 0)}，均分 ${escapeHtml(agent.suggestionQuality?.averageScore || 0)}</small>
        <small>${escapeHtml(quality.recommendation || "")}</small>
        <div class="phase18-readiness">
          ${agent.readinessChecks.map((item) => `<span data-status="${escapeHtml(item.status)}"><b>${escapeHtml(item.label)}</b><small>${escapeHtml(item.detail)}</small></span>`).join("")}
        </div>
      </article>
      <article class="phase18-repair-panel">
        <strong>半自动修复草案</strong>
        <small>预览 ${escapeHtml(agent.repairDrafts.preview)} / 已应用 ${escapeHtml(agent.repairDrafts.applied)}</small>
        ${batchReviewItems}
        ${repairItems}
        ${agent.repairDrafts.total ? `<button type="button" class="phase18-clear-repairs" data-phase18-clear-repairs>清空草案</button>` : ""}
      </article>
      <article class="phase18-audit-panel">
        <strong>长期助理审计</strong>
        <small>共 ${escapeHtml(agent.taskAudit?.total || 0)} 条本地记录，用于回看任务状态和批量修复。</small>
        ${auditItems}
      </article>
    </div>
  `;
}

function renderAssetCollectionPanel(collection = getAssetCollection()) {
  if (!elements.savedAssetsPanel) return;
  const exhibitions = Array.isArray(collection.savedExhibitions) ? collection.savedExhibitions : [];
  const reportDrafts = Array.isArray(collection.reportDrafts) ? collection.reportDrafts : [];
  const qualitySummary = buildAssetQualitySummary(collection);
  const referenceGraph = buildAssetReferenceGraph(collection);
  const repairSuggestions = buildAssetRepairSuggestions(collection);
  const exportManifest = buildAssetExportManifest(collection);
  const assetSyncState = buildPhase18AssetSyncState(collection);
  const assetSyncMap = new Map(assetSyncState.items.map((item) => [`${item.type}:${item.id}`, item]));
  const relationshipNavigation = buildPhase18RelationshipMap(memories.map(normalizeMemory)).assetNavigation || {};
  const sourceLabel = assetSource === "server" ? "SQLite 资产库" : "等待后端连接";
  if (elements.assetSummaryMeta) {
    elements.assetSummaryMeta.textContent = `${sourceLabel} / ${exhibitions.length} 个专题展 / ${reportDrafts.length} 份报告`;
  }
  if (!exhibitions.length && !reportDrafts.length) {
    elements.savedAssetsPanel.innerHTML = `
      <div class="asset-empty">
        <strong>还没有长期资产</strong>
        <small>可以从主题展候选保存专题展，也可以把当前洞察生成回忆报告草稿。</small>
        <div class="asset-action-row">
          <button type="button" data-report-draft>生成报告草稿</button>
          <button type="button" data-assets-refresh>刷新资产库</button>
        </div>
      </div>
    `;
    return;
  }
  const exhibitionItems = exhibitions.slice(0, 4).map((item) => {
    const count = Array.isArray(item.memoryIds) ? item.memoryIds.length : 0;
    const tags = Array.isArray(item.tags) ? item.tags.slice(0, 3).join(" / ") : "";
    const sync = assetSyncMap.get(`exhibition:${item.id}`) || {};
    const relations = relationshipNavigation.assetLookup?.[item.id] || [];
    return `
      <article class="asset-item" data-sync-status="${escapeHtml(sync.syncStatus || "review")}">
        <span>${escapeHtml(item.status || "draft")}</span>
        <span class="asset-sync-badge">${escapeHtml(sync.syncStatus || "review")}</span>
        <strong>${escapeHtml(item.title || "未命名专题展")}</strong>
        <small>${count} 件展品${tags ? ` / ${escapeHtml(tags)}` : ""}</small>
        <small>${escapeHtml(sync.recommendation || "")}</small>
        ${relations.length ? `<div class="asset-relation-links">${relations.map((relation) => `<span>${escapeHtml(relation.label)} · ${escapeHtml(relation.overlapCount)} 件</span>`).join("")}</div>` : ""}
        <p>${escapeHtml(limitText(item.intro || item.guideText || "等待继续编辑专题展说明。", 92))}</p>
        <div class="asset-action-row">
          <button type="button" data-asset-open="${escapeHtml(item.id)}" data-asset-type="exhibition">打开</button>
          ${renderAssetStatusAction("exhibition", item)}
          <button type="button" data-asset-delete="${escapeHtml(item.id)}" data-asset-title="${escapeHtml(item.title || "未命名专题展")}" data-asset-type="exhibition">删除</button>
        </div>
      </article>
    `;
  }).join("");
  const reportItems = reportDrafts.slice(0, 4).map((item) => {
    const sectionCount = Array.isArray(item.sections) ? item.sections.length : 0;
    const referenceCount = Array.isArray(item.references) ? item.references.length : 0;
    const sync = assetSyncMap.get(`report:${item.id}`) || {};
    const relations = relationshipNavigation.reportLookup?.[item.id] || [];
    return `
      <article class="asset-item" data-sync-status="${escapeHtml(sync.syncStatus || "review")}">
        <span>${escapeHtml(item.status || "draft")}</span>
        <span class="asset-sync-badge">${escapeHtml(sync.syncStatus || "review")}</span>
        <strong>${escapeHtml(item.title || "未命名报告草稿")}</strong>
        <small>${sectionCount} 个章节 / ${referenceCount} 条引用</small>
        <small>${escapeHtml(sync.recommendation || "")}</small>
        ${relations.length ? `<div class="asset-relation-links">${relations.map((relation) => `<span>${escapeHtml(relation.label)} · ${escapeHtml(relation.overlapCount)} 件</span>`).join("")}</div>` : ""}
        <p>${escapeHtml(limitText(item.summary || item.notes || "等待继续编辑报告章节和引用来源。", 92))}</p>
        <div class="asset-action-row">
          <button type="button" data-asset-open="${escapeHtml(item.id)}" data-asset-type="report">打开</button>
          ${renderAssetStatusAction("report", item)}
          <button type="button" data-asset-delete="${escapeHtml(item.id)}" data-asset-title="${escapeHtml(item.title || "未命名报告草稿")}" data-asset-type="report">删除</button>
        </div>
      </article>
    `;
  }).join("");
  elements.savedAssetsPanel.innerHTML = `
    <div class="asset-summary-strip">
      <span><b>${exhibitions.length}</b>专题展</span>
      <span><b>${reportDrafts.length}</b>报告草稿</span>
      <span><b>${escapeHtml(sourceLabel)}</b>来源</span>
    </div>
    <div class="phase18-asset-sync-state" data-sync-readiness="${escapeHtml(assetSyncState.readiness)}">
      <div>
        <strong>第十八阶段资产同步状态</strong>
        <small>${escapeHtml(assetSyncState.recommendation)}</small>
      </div>
      <div class="phase18-asset-sync-grid">
        <span><b>${escapeHtml(assetSyncState.packageCandidates)}</b><small>可入同步包</small></span>
        <span><b>${escapeHtml(assetSyncState.ready)}</b><small>已发布</small></span>
        <span><b>${escapeHtml(assetSyncState.review)}</b><small>待复核</small></span>
        <span><b>${escapeHtml(assetSyncState.risk)}</b><small>有风险</small></span>
      </div>
    </div>
    <div class="asset-toolbar">
      <button type="button" data-assets-refresh>刷新资产库</button>
      <button type="button" data-report-draft>生成报告草稿</button>
    </div>
    <details class="asset-export-preview asset-package-preview">
      <summary>完整导出包预览</summary>
      <div class="asset-package-grid">
        <span><b>${qualitySummary.totalMemories}</b>展品</span>
        <span><b>${exhibitions.length}</b>专题展</span>
        <span><b>${reportDrafts.length}</b>报告草稿</span>
      </div>
      ${renderAssetQualitySummary(qualitySummary)}
      ${renderAssetReferenceGraph(referenceGraph)}
      ${renderAssetRepairSuggestions(repairSuggestions)}
      ${renderAssetExportManifest(exportManifest)}
      <small>完整导出仍使用页面底部“导出”按钮；这里用于发布前快速确认数量、引用来源和关键内容缺口。</small>
    </details>
    <div class="asset-list">
      ${exhibitionItems}
      ${reportItems}
    </div>
  `;
}

function renderSavedAssetDialog(type, asset = {}) {
  const isReport = type === "report";
  const title = asset.title || (isReport ? "未命名报告草稿" : "未命名专题展");
  const status = asset.status || "draft";
  const tags = Array.isArray(asset.tags) ? asset.tags.map((tag) => pillHtml(tag)).join("") : "";
  const tagText = Array.isArray(asset.tags) ? asset.tags.join("、") : "";
  const memoryIds = Array.isArray(asset.memoryIds) ? asset.memoryIds : [];
  const sections = Array.isArray(asset.sections) ? asset.sections : [];
  const references = Array.isArray(asset.references) ? asset.references : [];
  const scope = asset.scope ? JSON.stringify(asset.scope, null, 2) : "";
  activeAssetDialog = { type, asset };
  elements.dialogContent.innerHTML = `
    <div class="dialog-body asset-dialog-body">
      <p class="eyebrow">Phase 15 / ${isReport ? "回忆报告草稿" : "专题展资产"} / ${escapeHtml(status)}</p>
      <h3>${escapeHtml(title)}</h3>
      ${tags ? `<div class="tag-row">${tags}</div>` : ""}
      <form class="asset-edit-form" data-asset-edit-form data-asset-type="${escapeHtml(type)}">
        <div class="asset-edit-grid">
          <label>标题<input name="title" type="text" maxlength="120" value="${escapeHtml(title)}" /></label>
          <label>状态
            <select name="status">
              ${["draft", "review", "published", "archived"].map((value) => `<option value="${value}" ${status === value ? "selected" : ""}>${value}</option>`).join("")}
            </select>
          </label>
        </div>
        ${isReport ? `
          <label>报告章节<textarea name="sections" rows="6" maxlength="6000">${escapeHtml(formatReportSectionsInput(sections))}</textarea></label>
          <label>引用展品<textarea name="references" rows="4" maxlength="6000">${escapeHtml(formatReportReferencesInput(references))}</textarea></label>
          <div class="asset-picker-row">
            <select data-reference-picker aria-label="选择引用展品">
              <option value="">选择已保存展品作为引用</option>
              ${renderMemoryOptionItems()}
            </select>
            <button type="button" data-reference-insert>插入引用</button>
          </div>
          <small>章节格式为“标题：内容”；引用格式为“角色：标题｜展品ID”。洞察来源会保留。</small>
        ` : `
          <label>专题标签<input name="tags" type="text" maxlength="260" value="${escapeHtml(tagText)}" /></label>
          <div class="asset-edit-grid">
            <label>封面展品 ID<input name="coverMemoryId" type="text" maxlength="80" value="${escapeHtml(asset.coverMemoryId || "")}" /></label>
            <label>展品排序<textarea name="memoryIds" rows="4" maxlength="6400">${escapeHtml(formatAssetMemoryIdsInput(memoryIds))}</textarea></label>
          </div>
          <div class="asset-picker-row">
            <select data-memory-picker aria-label="选择专题展品">
              <option value="">选择已保存展品加入专题展</option>
              ${renderMemoryOptionItems()}
            </select>
            <button type="button" data-memory-insert>加入展品</button>
          </div>
          <div class="asset-sort-list" data-asset-sort-list>${renderAssetSortList(memoryIds)}</div>
          <label>专题说明<textarea name="intro" rows="4" maxlength="800">${escapeHtml(asset.intro || "")}</textarea></label>
          <label>导览词<textarea name="guideText" rows="5" maxlength="2000">${escapeHtml(asset.guideText || "")}</textarea></label>
        `}
        <small data-asset-save-status data-status="neutral">编辑后点击保存，写入 SQLite 后会刷新资产卡片。</small>
        <div class="asset-dialog-actions">
          <button type="button" data-asset-export>导出预览</button>
          <button type="submit">保存编辑</button>
        </div>
      </form>
      <details class="asset-export-preview">
        <summary>JSON 导出预览</summary>
        <pre>${escapeHtml(JSON.stringify({ assetType: type, asset }, null, 2))}</pre>
      </details>
      ${isReport ? `
        <p><strong>报告摘要：</strong>${escapeHtml(asset.summary || asset.notes || "等待继续编辑报告摘要。")}</p>
        <p><strong>洞察范围：</strong>${escapeHtml(scope || "未记录")}</p>
        <div class="asset-dialog-grid">
          <div><strong>章节</strong>${sections.length ? sections.map((section) => `<small>${escapeHtml(section.title || "未命名章节")}：${escapeHtml(limitText(section.text || "", 120))}</small>`).join("") : "<small>暂无章节</small>"}</div>
          <div><strong>引用</strong>${references.length ? references.map((item) => `<small>${escapeHtml(item.role || "引用")}：${escapeHtml(item.title || item.id || "未命名展品")}</small>`).join("") : "<small>暂无引用</small>"}</div>
        </div>
      ` : `
        <p><strong>专题说明：</strong>${escapeHtml(asset.intro || "等待继续编辑专题说明。")}</p>
        <p><strong>导览词：</strong>${escapeHtml(asset.guideText || "等待继续编辑导览词。")}</p>
        <p><strong>展品数量：</strong>${memoryIds.length} 件${asset.coverMemoryId ? `；封面展品：${escapeHtml(asset.coverMemoryId)}` : ""}</p>
        <div class="asset-dialog-grid">
          <div><strong>展品 ID</strong>${memoryIds.length ? memoryIds.map((id) => `<small>${escapeHtml(id)}</small>`).join("") : "<small>暂无展品</small>"}</div>
          <div><strong>后续编辑建议</strong><small>补充专题开场、展品排序、封面说明和导览结尾。</small></div>
        </div>
      `}
      <p><strong>创建时间：</strong>${escapeHtml(formatDate(asset.createdAt) || "未记录")}；<strong>更新时间：</strong>${escapeHtml(formatDate(asset.updatedAt) || "未记录")}</p>
    </div>
  `;
  elements.memoryDialog.showModal();
}

function renderWorkflowOrchestration() {
  if (!elements.workflowOrchestration) return;
  const blueprint = getWorkflowBlueprint();
  const handoff = blueprint.handoff;
  const activeRun = latestAgentWorkflow?.run?.id ? "当前有可回看的整理运行" : "等待新的整理运行";
  const sourceLabel = workflowBlueprintSource === "server" ? "后端蓝图" : workflowBlueprintSource === "server-fallback" ? "本地回退" : "本地蓝图";
  const selectedTemplate = blueprint.templates.find((template) => template.id === activeWorkflowTemplateId) || blueprint.templates[0];
  if (selectedTemplate) activeWorkflowTemplateId = selectedTemplate.id;
  elements.workflowSummaryMeta.textContent = `${sourceLabel} / ${handoff.templates} 个模板 / 复核覆盖 ${handoff.reviewCoverage}% / 回放覆盖 ${handoff.runCoverage}% / 导览覆盖 ${handoff.guideCoverage}%`;
  elements.workflowReadinessGrid.innerHTML = `
    <div><strong>${handoff.total}</strong><small>展品样本</small></div>
    <div><strong>${handoff.withAgentRun}</strong><small>可回放运行</small></div>
    <div><strong>${handoff.withReviewEvidence}</strong><small>复核依据</small></div>
    <div><strong>${handoff.withGuideEvidence}</strong><small>导览证据</small></div>
  `;
  elements.workflowGapList.innerHTML = `
    <div class="workflow-quality-gates">
      ${blueprint.qualityGates.map((gate) => `<span data-gate-status="${escapeHtml(gate.status)}">${escapeHtml(gate.label)}</span>`).join("")}
    </div>
    <div class="workflow-gap-items">
      ${handoff.gaps.map((gap) => `<span data-gap-severity="${escapeHtml(gap.severity)}">${escapeHtml(gap.label)}</span>`).join("")}
    </div>
    <div class="workflow-next-actions">
      ${handoff.recommendedNextActions.map((action) => `<small>${escapeHtml(action)}</small>`).join("")}
    </div>
  `;
  elements.phase12ReadinessPanel.innerHTML = renderPhase12Readiness(blueprint.phase12Readiness);
  elements.workflowDetailPanel.innerHTML = selectedTemplate ? renderWorkflowTemplateDetail(selectedTemplate) : "";
  elements.workflowTemplateList.innerHTML = blueprint.templates.map((template) => `
    <article class="workflow-template-card" data-template="${escapeHtml(template.id)}" ${template.id === activeWorkflowTemplateId ? "data-active-template=\"true\"" : ""}>
      <div class="workflow-template-heading">
        <span>${escapeHtml(template.name)}</span>
        <small>${escapeHtml(`${template.statusLabel} · ${template.entry}`)}</small>
      </div>
      <p>${escapeHtml(template.purpose)}</p>
      <div class="workflow-node-strip">
        ${template.nodes.map((node) => `<span>${escapeHtml(formatWorkflowNodeLabel(node))}</span>`).join("")}
      </div>
      <div class="workflow-meta-row">
        <small>控制：${escapeHtml(formatWorkflowList(template.controls))}</small>
        <small>暂停点：${escapeHtml(formatWorkflowList(template.pausePoints))}</small>
        <small>风险：${escapeHtml(formatWorkflowList(template.riskSignals, 2))}</small>
        <small>保存：${escapeHtml(formatWorkflowList(template.persistence))}</small>
      </div>
      <div class="workflow-action-row">
        ${(template.nextActions || []).slice(0, 3).map((action) => `<span>${escapeHtml(action)}</span>`).join("")}
      </div>
      <strong>${escapeHtml(template.warmCue)}</strong>
    </article>
  `).join("");
  elements.workflowCapabilityList.innerHTML = `
    <span>人工复核 ${blueprint.capabilities.humanReview ? "已接入" : "待接入"}</span>
    <span>重试/驳回 ${blueprint.capabilities.retryAndReject ? "已接入" : "待接入"}</span>
    <span>运行回放 ${blueprint.capabilities.replay ? activeRun : "待接入"}</span>
    <span>引用依据 ${blueprint.capabilities.citations ? "已接入" : "待接入"}</span>
    <span>范围洞察 ${blueprint.capabilities.scopedInsights ? "已接入" : "待接入"}</span>
  `;
}

function renderPrivacyPanel() {
  if (!elements.privacySection) return;
  const policy = getPrivacyPolicy();
  const summary = policy.summary || {};
  const sourceLabel = privacyPolicySource === "server" ? "后端策略" : "本地策略";
  elements.profileNameInput.value = localProfile.displayName;
  elements.profileDeviceInput.value = localProfile.deviceLabel;
  elements.profileSyncSelect.value = localProfile.syncPreference;
  elements.profileAiConsentInput.checked = localProfile.aiConsent;
  elements.privacySummary.textContent = `${sourceLabel} / ${summary.accountMode || "local-single-user"} / ${summary.memoryCount || 0} 件展品`;
  elements.aiScopePanel.innerHTML = `
    <p>${escapeHtml(policy.aiDataScope?.note || "当前未记录 AI 调用范围。")}</p>
    <div class="privacy-chip-row">
      <span>AI ${escapeHtml(summary.aiMode || "unknown")}</span>
      <span>模型 ${escapeHtml(policy.aiDataScope?.model || "not-configured")}</span>
      <span>${localProfile.aiConsent ? "本地已允许" : "本地未允许"}</span>
    </div>
    <small>发送字段：${escapeHtml(formatPrivacyList(policy.aiDataScope?.sentFields))}</small>
    <small>不会发送：${escapeHtml(formatPrivacyList(policy.aiDataScope?.notSentByCurrentApp))}</small>
  `;
  const sensitive = policy.sensitiveData || {};
  elements.sensitivityPanel.innerHTML = `
    <div class="sensitivity-heading">
      <strong>敏感线索</strong>
      <span data-risk-level="${escapeHtml(sensitive.riskLevel || "none")}">${escapeHtml(sensitive.riskLevel || "none")}</span>
    </div>
    <p>${escapeHtml(sensitive.recommendation || "暂无敏感线索摘要。")}</p>
    <div class="privacy-chip-row">
      ${(sensitive.categories || []).map((item) => `<span>${escapeHtml(item.label)} ${escapeHtml(item.count || 0)}</span>`).join("")}
    </div>
  `;
  elements.dataLocationList.innerHTML = (policy.dataLocations || []).map((item) => `
    <div class="privacy-line-item">
      <span>${escapeHtml(item.label)}</span>
      <small>${escapeHtml(item.location)}</small>
      <small>${escapeHtml(formatPrivacyList(item.contains, 5))}</small>
    </div>
  `).join("");
  elements.userControlList.innerHTML = (policy.userControls || []).map((item) => `
    <span data-control-status="${escapeHtml(item.status)}">${escapeHtml(item.label)}</span>
  `).join("");
  renderPhase16SyncPanel();
  elements.phase13ReadinessPanel.innerHTML = renderPhase13Readiness(policy.productizationReadiness || policy.sovereignty?.phase13Readiness);
}

function formatPrivacyList(items, limit = 6) {
  if (!Array.isArray(items) || !items.length) return "未记录";
  return items.slice(0, limit).join(" / ");
}

function renderPhase13Readiness(readiness) {
  if (!readiness) return "";
  return `
    <div class="phase13-readiness-heading">
      <div>
        <span>Phase ${escapeHtml(readiness.targetPhase)}</span>
        <strong>${escapeHtml(readiness.targetName)}</strong>
      </div>
      <small>${escapeHtml(`准备度 ${readiness.score}%`)}</small>
    </div>
    <div class="phase13-checks">
      ${(readiness.checks || []).map((item) => `<span data-readiness-status="${escapeHtml(item.status)}">${escapeHtml(item.label)}</span>`).join("")}
    </div>
    <p>${escapeHtml(readiness.recommendation || "")}</p>
  `;
}

function renderOperationsPanel() {
  if (!elements.operationsSection) return;
  const info = getVersionInfo();
  const ops = info.operations || {};
  const sourceLabel = operationsSource === "server" ? "后端版本" : "本地回退";
  elements.operationsSummaryGrid.innerHTML = `
    <div><strong>${escapeHtml(String(info.phase))}</strong><small>当前阶段</small></div>
    <div><strong>${escapeHtml(info.version || "1.0.0")}</strong><small>版本</small></div>
    <div><strong>${escapeHtml(ops.status || "unknown")}</strong><small>${escapeHtml(sourceLabel)}</small></div>
    <div><strong>${escapeHtml(`${ops.release?.checklistReady || 0}/${ops.release?.checklistTotal || 0}`)}</strong><small>发布清单</small></div>
  `;
  elements.runtimePanel.innerHTML = renderOperationLines([
    ["Node", info.runtime?.node],
    ["平台", info.runtime?.platform],
    ["端口", info.runtime?.port],
    ["运行秒数", info.runtime?.uptimeSeconds],
    ["数据库", info.runtime?.databasePath],
    ["AI 模型", info.runtime?.aiModel]
  ]);
  elements.deploymentPanel.innerHTML = renderOperationLines([
    ["模式", info.deployment?.mode],
    ["静态托管", info.deployment?.staticHosting],
    ["数据库", info.deployment?.database],
    ["启动命令", info.deployment?.startCommand],
    ["健康检查", info.deployment?.healthCheck],
    ["版本检查", info.deployment?.versionCheck],
    ["说明", info.deployment?.notes]
  ]) + renderOperationItems(info.deploymentModes || [], { showStatus: true, compact: true });
  elements.checksPanel.innerHTML = renderOperationLines([
    ["完整检查", info.checks?.full],
    ["Smoke", info.checks?.smoke],
    ["语法", info.checks?.syntax],
    ["备份", ops.backup?.fullExport],
    ["脱敏备份", ops.backup?.redactedExport],
    ["清空", ops.backup?.purge],
    ["观测接口", ops.observability?.operations],
    ["请求 ID", ops.observability?.requestId]
  ]);
  elements.engineeringPanel.innerHTML = `
    <div class="operation-line-list">
      ${(info.nextEngineeringSteps || []).map((item) => `<span>${escapeHtml(item)}</span>`).join("")}
    </div>
    <p>${escapeHtml(ops.readiness?.reason || "")}</p>
  `;
  if (elements.releaseChecklistPanel) {
    elements.releaseChecklistPanel.innerHTML = renderOperationItems(info.releaseChecklist || [], { showStatus: true });
  }
  if (elements.runbookPanel) {
    elements.runbookPanel.innerHTML = renderOperationItems(info.runbook || []);
  }
  if (elements.backupPolicyPanel) {
    elements.backupPolicyPanel.innerHTML = renderBackupPolicy(info.backupPolicy || ops.backupPolicy || {});
  }
  if (elements.riskPanel) {
    elements.riskPanel.innerHTML = renderOperationItems(info.riskRegister || [], { showLevel: true });
  }
  if (elements.operationEventsPanel) {
    elements.operationEventsPanel.innerHTML = renderOperationEvents(info.operationsConsole?.recentEvents || info.recentEvents || []);
  }
  if (elements.releaseHistoryPanel) {
    elements.releaseHistoryPanel.innerHTML = renderReleaseHistory(info.releaseHistory || []);
  }
  if (elements.logArchivePanel) {
    elements.logArchivePanel.innerHTML = renderLogArchive(info.operationsConsole?.logArchive || info.logArchive || {});
  }
  if (elements.demoKitPanel) {
    elements.demoKitPanel.innerHTML = renderDemoKit(info.operationsConsole?.demoKit || info.demoKit || {});
  }
  if (elements.phase14Panel) {
    elements.phase14Panel.innerHTML = renderPhase14Readiness(info.operationsConsole?.phase14Readiness || info.phase14Readiness || {});
  }
  if (elements.moduleBoundaryPanel) {
    elements.moduleBoundaryPanel.innerHTML = renderModuleBoundaryPlan(info.operationsConsole?.moduleBoundaryPlan || info.moduleBoundaryPlan || []);
  }
  if (elements.phase15Panel) {
    elements.phase15Panel.innerHTML = renderPhase14Readiness(info.operationsConsole?.phase15Readiness || info.phase15Readiness || {});
  }
  if (elements.phase15AssetPanel) {
    elements.phase15AssetPanel.innerHTML = renderPhase15AssetPlan(info.operationsConsole?.phase15AssetPlan || info.phase15AssetPlan || []);
  }
}

function renderPhase20PlatformPanel() {
  if (!elements.phase20PlatformSection) return;
  const info = getVersionInfo();
  const plan = info.operationsConsole?.phase20PlatformPlan || info.phase20PlatformPlan || buildLocalPhase20PlatformPlan();
  const readiness = plan.readiness || {};
  const security = plan.securityModel || {};
  const builtInPluginRegistry = plan.builtInPluginRegistry || {};
  const manifestSchema = plan.manifestSchema || {};
  const manifestValidation = plan.manifestValidation || {};
  const permissionReview = plan.permissionReview || {};
  const pluginAuditLog = plan.pluginAuditLog || {};
  const extensionContractTests = plan.extensionContractTests || {};
  const sandboxBoundary = plan.sandboxBoundary || {};
  const noCodeTemplatePack = plan.noCodeTemplatePack || {};
  const templatePreviewFixtures = plan.templatePreviewFixtures || {};
  const signedManifestPolicy = plan.signedManifestPolicy || {};
  const pluginInstallationWorkflow = plan.pluginInstallationWorkflow || {};
  const builtInCount = (plan.builtInPlugins || []).filter((item) => item.enabled !== false).length;
  elements.phase20SummaryGrid.innerHTML = `
    <div><strong>${escapeHtml(String(plan.phase || 20))}</strong><small>阶段</small></div>
    <div><strong>${escapeHtml(String((plan.extensionPoints || []).length))}</strong><small>扩展点</small></div>
    <div><strong>${escapeHtml(String(builtInCount))}</strong><small>内置插件</small></div>
    <div><strong>${escapeHtml(security.thirdPartyExecution ? "开放" : "关闭")}</strong><small>第三方执行</small></div>
  `;
  elements.phase20ExtensionPanel.innerHTML = renderOperationItems(plan.extensionPoints || [], { showStatus: true });
  elements.phase20PluginPanel.innerHTML = renderOperationItems((plan.builtInPlugins || []).map((item) => ({
    ...item,
    label: `${item.id} / ${item.type}`,
    detail: `来源：${item.source || "local"}；状态：${item.enabled === false ? "disabled" : "enabled"}`
  })), { showStatus: true });
  if (elements.phase20RegistryPanel) {
    elements.phase20RegistryPanel.innerHTML = `
      ${renderOperationLines([
        ["Schema", builtInPluginRegistry.schemaVersion],
        ["Status", builtInPluginRegistry.status],
        ["Owner", builtInPluginRegistry.owner],
        ["Total", builtInPluginRegistry.total],
        ["Enabled", builtInPluginRegistry.enabled],
        ["Categories", formatWorkflowList(builtInPluginRegistry.categories || [])],
        ["Checks", formatWorkflowList(builtInPluginRegistry.registryChecks || [])],
        ["Runtime", builtInPluginRegistry.runtimeExecution ? "enabled" : "disabled"]
      ])}
      ${renderOperationItems((builtInPluginRegistry.entries || []).map((item) => ({
        ...item,
        label: `${item.id} / ${item.type}`,
        detail: `${item.capability} / ${item.input} -> ${item.output} / ${item.contract}`
      })), { showStatus: true, compact: true })}
    `;
  }
  if (elements.phase20ManifestPanel) {
    elements.phase20ManifestPanel.innerHTML = renderOperationLines([
      ["Schema", manifestSchema.schemaVersion],
      ["Status", manifestSchema.status],
      ["Required", formatWorkflowList(manifestSchema.requiredFields || [])],
      ["Permissions", formatWorkflowList(manifestSchema.permissionLabels || [])],
      ["Contracts", formatWorkflowList(manifestSchema.extensionContracts || [])],
      ["Built-in manifests", manifestValidation.builtInManifestCount],
      ["Runtime", manifestValidation.runtimeExecution ? "enabled" : "disabled"]
    ]);
  }
  if (elements.phase20PermissionPanel) {
    elements.phase20PermissionPanel.innerHTML = `
      ${renderOperationLines([
        ["Status", permissionReview.status],
        ["Default", permissionReview.defaultDecision],
        ["Human approval", permissionReview.humanApprovalRequired ? "required" : "optional"],
        ["Review scope", formatWorkflowList(permissionReview.reviewScope || [])],
        ["Audit events", formatWorkflowList(permissionReview.auditEventTypes || [])],
        ["Blocked until", formatWorkflowList(permissionReview.blockedUntil || [])]
      ])}
      ${renderOperationItems((permissionReview.builtInDecisions || []).map((item) => ({
        ...item,
        status: item.decision,
        label: item.id,
        detail: `${formatWorkflowList(item.permissions || [])} / confirmation: ${item.confirmationRequired ? "required" : "not required"}`
      })), { showStatus: true, compact: true })}
    `;
  }
  if (elements.phase20AuditPanel) {
    elements.phase20AuditPanel.innerHTML = `
      ${renderOperationLines([
        ["Status", pluginAuditLog.status],
        ["Schema", pluginAuditLog.eventSchemaVersion],
        ["Storage", pluginAuditLog.storageMode],
        ["Runtime", pluginAuditLog.runtimeExecution ? "enabled" : "disabled"],
        ["Required", formatWorkflowList(pluginAuditLog.requiredFields || [])],
        ["Events", formatWorkflowList(pluginAuditLog.eventTypes || [])],
        ["Next controls", formatWorkflowList(pluginAuditLog.nextControls || [])]
      ])}
      ${renderOperationItems((pluginAuditLog.sampleEvents || []).map((item) => ({
        ...item,
        status: item.decision,
        label: `${item.pluginId} / ${item.eventType}`,
        detail: `${item.actor || "system"} / ${formatWorkflowList(item.evidence || [])}`
      })), { showStatus: true, compact: true })}
    `;
  }
  if (elements.phase20ContractPanel) {
    elements.phase20ContractPanel.innerHTML = `
      ${renderOperationLines([
        ["Schema", extensionContractTests.schemaVersion],
        ["Status", extensionContractTests.status],
        ["Coverage", formatWorkflowList(extensionContractTests.coverage || [])],
        ["Assertions", formatWorkflowList(extensionContractTests.requiredAssertions || [])],
        ["Failure policy", extensionContractTests.failurePolicy],
        ["Runtime", extensionContractTests.runtimeExecution ? "enabled" : "disabled"],
        ["Next controls", formatWorkflowList(extensionContractTests.nextControls || [])]
      ])}
      ${renderOperationItems((extensionContractTests.contractSuites || []).map((item) => ({
        ...item,
        label: `${item.id} / ${item.extensionPoint}`,
        detail: `${item.samplePlugin} / ${item.inputFixture} -> ${item.expectedOutput} / ${item.blockingFailure}`
      })), { showStatus: true, compact: true })}
    `;
  }
  if (elements.phase20SandboxPanel) {
    elements.phase20SandboxPanel.innerHTML = `
      ${renderOperationLines([
        ["Schema", sandboxBoundary.schemaVersion],
        ["Status", sandboxBoundary.status],
        ["Isolation", sandboxBoundary.isolationMode],
        ["Trust zone", sandboxBoundary.trustZone],
        ["Blocked", formatWorkflowList(sandboxBoundary.blockedCapabilities || [])],
        ["Allowed", formatWorkflowList(sandboxBoundary.allowedCapabilities || [])],
        ["Runtime", sandboxBoundary.runtimeExecution ? "enabled" : "disabled"],
        ["Handoff", formatWorkflowList(sandboxBoundary.handoffToRuntime || [])],
        ["Next controls", formatWorkflowList(sandboxBoundary.nextControls || [])]
      ])}
      ${renderOperationLines([
        ["Memory", sandboxBoundary.dataBoundary?.memoryAccess],
        ["Assets", sandboxBoundary.dataBoundary?.assetAccess],
        ["Export", sandboxBoundary.dataBoundary?.exportAccess],
        ["Sync", sandboxBoundary.dataBoundary?.syncAccess]
      ])}
      ${renderOperationItems((sandboxBoundary.enforcementChecks || []).map((item) => ({
        ...item,
        label: item.id,
        detail: item.rule
      })), { showStatus: true, compact: true })}
    `;
  }
  if (elements.phase20TemplatePanel) {
    elements.phase20TemplatePanel.innerHTML = `
      ${renderOperationLines([
        ["Schema", noCodeTemplatePack.schemaVersion],
        ["Status", noCodeTemplatePack.status],
        ["Owner", noCodeTemplatePack.owner],
        ["Templates", noCodeTemplatePack.templateCount],
        ["Categories", formatWorkflowList(noCodeTemplatePack.categories || [])],
        ["Guardrails", formatWorkflowList(noCodeTemplatePack.guardrails || [])],
        ["Workflow", formatWorkflowList(noCodeTemplatePack.authoringWorkflow || [])],
        ["Runtime", noCodeTemplatePack.runtimeExecution ? "enabled" : "disabled"],
        ["Next controls", formatWorkflowList(noCodeTemplatePack.nextControls || [])]
      ])}
      ${renderOperationItems((noCodeTemplatePack.templates || []).map((item) => ({
        ...item,
        label: `${item.id} / ${item.extensionPoint}`,
        detail: `${item.input} -> ${item.output} / ${formatWorkflowList(item.controls || [])}`
      })), { showStatus: true, compact: true })}
    `;
  }
  if (elements.phase20FixturePanel) {
    elements.phase20FixturePanel.innerHTML = `
      ${renderOperationLines([
        ["Schema", templatePreviewFixtures.schemaVersion],
        ["Status", templatePreviewFixtures.status],
        ["Fixtures", templatePreviewFixtures.fixtureCount],
        ["Coverage", formatWorkflowList(templatePreviewFixtures.coverage || [])],
        ["Workflow", formatWorkflowList(templatePreviewFixtures.previewWorkflow || [])],
        ["Blocked", formatWorkflowList(templatePreviewFixtures.blockedWhen || [])],
        ["Runtime", templatePreviewFixtures.runtimeExecution ? "enabled" : "disabled"],
        ["Next controls", formatWorkflowList(templatePreviewFixtures.nextControls || [])]
      ])}
      ${renderOperationItems((templatePreviewFixtures.fixtures || []).map((item) => ({
        ...item,
        label: `${item.id} / ${item.templateId}`,
        detail: `${item.inputFixture} -> ${item.expectedPreview} / ${formatWorkflowList(item.requiredAssertions || [])}`
      })), { showStatus: true, compact: true })}
      ${renderOperationItems((templatePreviewFixtures.negativeFixtures || []).map((item) => ({
        ...item,
        label: `${item.id} / ${item.templateId}`,
        detail: `${item.reason} -> ${item.expectedDecision}`
      })), { showStatus: true, compact: true })}
    `;
  }
  if (elements.phase20SignaturePanel) {
    elements.phase20SignaturePanel.innerHTML = `
      ${renderOperationLines([
        ["Schema", signedManifestPolicy.schemaVersion],
        ["Status", signedManifestPolicy.status],
        ["Required", signedManifestPolicy.signatureRequired ? "yes" : "no"],
        ["Algorithm", signedManifestPolicy.algorithm],
        ["Trust", signedManifestPolicy.signerTrust],
        ["Signed fields", formatWorkflowList(signedManifestPolicy.signedFields || [])],
        ["Checksum fields", formatWorkflowList(signedManifestPolicy.checksumFields || [])],
        ["Verify", formatWorkflowList(signedManifestPolicy.verificationSteps || [])],
        ["Blocked", formatWorkflowList(signedManifestPolicy.blockedWhen || [])],
        ["Runtime", signedManifestPolicy.runtimeExecution ? "enabled" : "disabled"],
        ["Next controls", formatWorkflowList(signedManifestPolicy.nextControls || [])]
      ])}
      ${renderOperationItems((signedManifestPolicy.sampleSignatures || []).map((item) => ({
        ...item,
        label: item.pluginId,
        detail: item.digest
      })), { showStatus: true, compact: true })}
    `;
  }
  if (elements.phase20InstallPanel) {
    elements.phase20InstallPanel.innerHTML = `
      ${renderOperationLines([
        ["Schema", pluginInstallationWorkflow.schemaVersion],
        ["Status", pluginInstallationWorkflow.status],
        ["Default", pluginInstallationWorkflow.defaultDecision],
        ["States", formatWorkflowList(pluginInstallationWorkflow.installStates || [])],
        ["Gates", formatWorkflowList(pluginInstallationWorkflow.requiredGates || [])],
        ["Blocked", formatWorkflowList(pluginInstallationWorkflow.blockedWhen || [])],
        ["Runtime", pluginInstallationWorkflow.runtimeExecution ? "enabled" : "disabled"],
        ["Next controls", formatWorkflowList(pluginInstallationWorkflow.nextControls || [])]
      ])}
      ${renderOperationItems((pluginInstallationWorkflow.workflowSteps || []).map((item) => ({
        ...item,
        label: item.id,
        detail: `${item.input} -> ${item.output} / ${item.blockingFailure}`
      })), { showStatus: true, compact: true })}
      ${renderOperationItems((pluginInstallationWorkflow.sampleDecisions || []).map((item) => ({
        ...item,
        status: item.decision,
        label: `${item.pluginId} / ${item.state}`,
        detail: formatWorkflowList(item.evidence || [])
      })), { showStatus: true, compact: true })}
    `;
  }
  elements.phase20SecurityPanel.innerHTML = renderOperationLines([
    ["默认信任", security.defaultTrust],
    ["运行策略", plan.runtimePolicy],
    ["第三方代码", security.thirdPartyExecution ? "允许" : "不允许"],
    ["插件网络访问", security.networkAccessForPlugins ? "允许" : "不允许"],
    ["密钥存储", security.secretStorage ? "允许" : "不允许"],
    ["数据访问", security.dataAccess],
    ["必需控制", formatWorkflowList(security.requiredControls || [])],
    ["建议", readiness.recommendation]
  ]);
  elements.phase20MilestonePanel.innerHTML = `
    <div class="operation-line-list">
      ${(plan.nextMilestones || []).map((item) => `<span>${escapeHtml(item)}</span>`).join("")}
    </div>
    <p>${escapeHtml(readiness.pluginRuntimeReady ? "插件运行时已可用。" : "当前仅启用清单和边界规划，真实插件运行时仍保持关闭。")}</p>
  `;
}

function renderOperationLines(lines = []) {
  return `
    <div class="operation-line-list">
      ${lines.filter(([, value]) => value !== undefined && value !== "").map(([label, value]) => `
        <span><b>${escapeHtml(label)}</b>${escapeHtml(String(value))}</span>
      `).join("")}
    </div>
  `;
}

function renderOperationItems(items = [], options = {}) {
  if (!items.length) return `<p>暂无记录。</p>`;
  return `
    <div class="operation-line-list ${options.compact ? "operation-line-list-compact" : ""}">
      ${items.map((item) => {
        const meta = [
          options.showStatus && item.status ? `状态：${item.status}` : "",
          options.showLevel && item.level ? `级别：${item.level}` : "",
          item.command ? `命令：${item.command}` : "",
          item.database ? `数据：${item.database}` : ""
        ].filter(Boolean).join(" / ");
        const detail = item.detail || item.note || item.mitigation || "";
        return `
          <span data-operation-status="${escapeHtml(item.status || item.level || "info")}">
            <b>${escapeHtml(item.label || item.id || "item")}</b>
            ${meta ? `<em>${escapeHtml(meta)}</em>` : ""}
            ${detail ? `<small>${escapeHtml(detail)}</small>` : ""}
          </span>
        `;
      }).join("")}
    </div>
  `;
}

function renderBackupPolicy(policy = {}) {
  return renderOperationLines([
    ["完整备份", policy.full],
    ["脱敏备份", policy.redacted],
    ["恢复", policy.restore],
    ["清空", policy.purge],
    ["节奏", policy.recommendedCadence],
    ["保存建议", policy.storageAdvice]
  ]);
}

function renderOperationEvents(events = []) {
  if (!events.length) return `<p>暂无运行事件。打开页面或调用接口后会逐步出现最近请求。</p>`;
  return `
    <div class="operation-line-list operation-event-list">
      ${events.slice(0, 8).map((event) => `
        <span data-operation-status="${escapeHtml(event.level || "info")}">
          <b>${escapeHtml(`${event.method || event.type || "event"} ${event.path || ""}`.trim())}</b>
          <em>${escapeHtml(`状态：${event.statusCode || "-"} / 耗时：${event.durationMs || 0}ms`)}</em>
          <small>${escapeHtml(event.id || "")}</small>
          <small>${escapeHtml(event.error || event.at || "")}</small>
        </span>
      `).join("")}
    </div>
  `;
}

function renderReleaseHistory(history = []) {
  if (!history.length) return `<p>暂无发布记录。</p>`;
  return `
    <div class="operation-line-list">
      ${history.map((item) => `
        <span>
          <b>${escapeHtml(`${item.version || ""} ${item.label || ""}`.trim())}</b>
          <em>${escapeHtml(`Phase ${item.phase || 13} / ${item.date || ""}`)}</em>
          <small>${escapeHtml(item.summary || "")}</small>
        </span>
      `).join("")}
    </div>
  `;
}

function renderLogArchive(logArchive = {}) {
  return renderOperationLines([
    ["格式", logArchive.format],
    ["路径", logArchive.path],
    ["大小", logArchive.sizeBytes === undefined ? "" : `${logArchive.sizeBytes} bytes`],
    ["内存事件", logArchive.inMemoryEvents],
    ["导出端点", logArchive.exportEndpoint],
    ["保留策略", logArchive.retention]
  ]);
}

function renderDemoKit(demoKit = {}) {
  const checks = Array.isArray(demoKit.checks) ? demoKit.checks : [];
  return `
    <div class="operation-line-list">
      <span data-operation-status="${demoKit.ready ? "ready" : "needs-sample"}">
        <b>准备度 ${escapeHtml(demoKit.score ?? 0)}%</b>
        <em>${escapeHtml(`样本：${demoKit.sampleCount ?? 0} 件`)}</em>
        <small>${escapeHtml(demoKit.privacyNote || "")}</small>
      </span>
    </div>
    ${renderOperationItems(checks, { showStatus: true, compact: true })}
    <div class="operation-line-list operation-line-list-compact">
      ${(demoKit.storyline || []).slice(0, 5).map((item) => `<span>${escapeHtml(item)}</span>`).join("")}
    </div>
  `;
}

function renderPhase14Readiness(readiness = {}) {
  const checks = Array.isArray(readiness.checks) ? readiness.checks : [];
  return `
    <div class="operation-line-list">
      <span data-operation-status="${readiness.ready ? "ready" : "needs-sample"}">
        <b>Phase ${escapeHtml(readiness.targetPhase || 14)} / ${escapeHtml(readiness.score ?? 0)}%</b>
        <em>${escapeHtml(readiness.targetName || "工程模块化和服务边界重构")}</em>
        <small>${escapeHtml(readiness.recommendation || "")}</small>
      </span>
    </div>
    ${renderOperationItems(checks, { showStatus: true, compact: true })}
    <div class="operation-line-list operation-line-list-compact">
      ${(readiness.recommendedOrder || []).map((item) => `<span>${escapeHtml(item)}</span>`).join("")}
    </div>
  `;
}

function renderModuleBoundaryPlan(plan = []) {
  if (!plan.length) return `<p>暂无模块边界计划。</p>`;
  return `
    <div class="operation-line-list">
      ${plan.map((item) => `
        <span data-operation-status="${escapeHtml(item.status || "info")}">
          <b>${escapeHtml(item.label || item.id)}</b>
          <em>${escapeHtml(item.status || "")}</em>
          <small>${escapeHtml(item.rule || "")}</small>
        </span>
      `).join("")}
    </div>
  `;
}

function renderPhase15AssetPlan(plan = []) {
  if (!plan.length) return `<p>暂无专题资产计划。</p>`;
  return `
    ${renderOperationItems(plan, { showStatus: true, compact: true })}
  `;
}

function confirmAiDataScope(rawContent) {
  if (!backendAiConfigured || localProfile.aiConsent) return true;
  const sensitivity = buildLocalSensitivitySummary([{ rawContent, people: [], emotions: [], attachments: [] }]);
  const message = [
    "当前后端已配置 AI。继续整理会把原始记忆文本发送到配置的 OpenAI-compatible 接口。",
    `本段敏感线索风险：${sensitivity.riskLevel}`,
    "确认继续后，会把“允许配置 AI 后发送原始记忆给模型”保存到本地馆主配置。"
  ].join("\n\n");
  if (!confirm(message)) {
    setAiStatus("已取消 Agent 整理：尚未确认 AI 调用范围。", "warning");
    return false;
  }
  persistLocalProfile({ ...localProfile, aiConsent: true });
  renderPrivacyPanel();
  return true;
}

function renderPhase12Readiness(readiness) {
  if (!readiness) return "";
  return `
    <div class="phase12-readiness-heading">
      <div>
        <span>Phase ${escapeHtml(readiness.targetPhase)}</span>
        <strong>${escapeHtml(readiness.targetName)}</strong>
      </div>
      <small>${escapeHtml(`准备度 ${readiness.score}%`)}</small>
    </div>
    <div class="phase12-checks">
      ${(readiness.checks || []).map((item) => `
        <span data-readiness-status="${escapeHtml(item.status)}" title="${escapeHtml(item.detail || "")}">
          ${escapeHtml(item.label)}
        </span>
      `).join("")}
    </div>
    <p>${escapeHtml(readiness.recommendation || "")}</p>
  `;
}

function renderWorkflowTemplateDetail(template) {
  const nodes = Array.isArray(template.nodes) ? template.nodes : [];
  return `
    <div class="workflow-detail-heading">
      <div>
        <span>${escapeHtml(template.statusLabel || "可查看")}</span>
        <strong>${escapeHtml(template.name)}</strong>
      </div>
      <small>${escapeHtml(template.entry || "")}</small>
    </div>
    <div class="workflow-detail-grid">
      <div>
        <strong>节点依据</strong>
        ${nodes.map((node) => `
          <small>${escapeHtml(formatWorkflowNodeLabel(node))}</small>
          <span>${escapeHtml(formatWorkflowList(node.evidence || [], 5))}</span>
        `).join("")}
      </div>
      <div>
        <strong>暂停点</strong>
        ${(template.pausePoints || []).map((item) => `<span>${escapeHtml(item)}</span>`).join("") || "<span>未记录</span>"}
      </div>
      <div>
        <strong>风险信号</strong>
        ${(template.riskSignals || []).map((item) => `<span>${escapeHtml(item)}</span>`).join("") || "<span>未记录</span>"}
      </div>
      <div>
        <strong>下一步动作</strong>
        ${(template.nextActions || []).map((item) => `<span>${escapeHtml(item)}</span>`).join("") || "<span>未记录</span>"}
      </div>
    </div>
  `;
}

function formatWorkflowNodeLabel(node) {
  if (typeof node === "string") return node;
  return [node.agent || node.id, node.stage].filter(Boolean).join(" · ");
}

function formatWorkflowList(items, limit = 6) {
  if (!Array.isArray(items)) return String(items || "未记录");
  return items.slice(0, limit).map((item) => typeof item === "string" ? item : item.label || item.id || String(item)).join(" / ") || "未记录";
}

function render() {
  renderHallNav();
  renderEmotionFilter();
  renderStats();
  renderFormMode();
  renderInsights();
  renderPhase19ImportLab();
  renderWorkflowOrchestration();
  renderPrivacyPanel();
  renderOperationsPanel();
  renderPhase20PlatformPanel();
  renderAssetCollectionPanel();
  renderMemories();
  renderGuide();
}

function mockAnalyzeMemory(rawContent) {
  const text = rawContent.trim();
  const rules = [
    { hall: "youth", keywords: ["毕业", "学校", "操场", "高三", "同学", "考试", "教室", "校园"], title: "被留在校园里的片段", emotions: ["怀念", "遗憾", "迷茫"], tags: ["校园", "青春", "成长"], sourceType: "日记", importance: 4, emotionIntensity: 4 },
    { hall: "friends", keywords: ["朋友", "室友", "兄弟", "姐妹", "群聊", "聚会", "一起"], title: "朋友之间的小型纪念碑", emotions: ["快乐", "怀念", "温暖"], tags: ["朋友", "陪伴", "关系"], sourceType: "聊天片段", importance: 3, emotionIntensity: 3 },
    { hall: "family", keywords: ["妈妈", "爸爸", "家", "爷爷", "奶奶", "外婆", "饭", "春节"], title: "家里传来的回声", emotions: ["怀念", "平静", "温暖"], tags: ["家庭", "生活", "牵挂"], sourceType: "日记", importance: 4, emotionIntensity: 4 },
    { hall: "low", keywords: ["难过", "失眠", "崩溃", "失败", "累", "焦虑", "哭", "撑不住"], title: "低谷里的小灯", emotions: ["委屈", "迷茫", "释然"], tags: ["低谷", "恢复", "自我"], sourceType: "日记", importance: 4, emotionIntensity: 5 },
    { hall: "strange", keywords: ["离谱", "尴尬", "奇怪", "抽象", "荒唐", "笑死", "社死"], title: "一件很难解释的展品", emotions: ["荒诞", "快乐", "紧张"], tags: ["离谱", "尴尬", "趣事"], sourceType: "聊天片段", importance: 2, emotionIntensity: 3 },
    { hall: "daily", keywords: ["照片", "拍照", "相册", "合影", "镜头"], title: "照片背面的一小段注释", emotions: ["怀念", "温暖"], tags: ["照片", "瞬间", "记录"], sourceType: "照片描述", importance: 3, emotionIntensity: 3 },
    { hall: "daily", keywords: ["梦", "梦到", "醒来"], title: "醒来后还没散掉的梦", emotions: ["迷茫", "害怕", "期待"], tags: ["梦境", "潜意识", "夜晚"], sourceType: "梦境", importance: 2, emotionIntensity: 4 },
    { hall: "daily", keywords: ["旅行", "车站", "机场", "海边", "山", "城市"], title: "路途中被保存的坐标", emotions: ["期待", "兴奋", "平静"], tags: ["旅行", "地点", "移动"], sourceType: "旅行片段", importance: 3, emotionIntensity: 3 }
  ];

  const matched = rules.find((rule) => rule.keywords.some((keyword) => text.includes(keyword))) || {
    hall: "daily",
    title: "普通日子里的发光切片",
    emotions: ["平静"],
    tags: ["日常", "片段", "记录"],
    sourceType: "日记",
    importance: 1,
    emotionIntensity: 2
  };

  const shortText = text.length > 62 ? `${text.slice(0, 62)}...` : text;
  return {
    title: matched.title,
    hall: matched.hall,
    emotions: matched.emotions,
    tags: matched.tags,
    sourceType: matched.sourceType,
    importance: matched.importance,
    emotionIntensity: matched.emotionIntensity,
    favorite: matched.importance >= 4,
    exhibitText: `这件展品来自一段私人记忆：“${shortText}”。它被放入${getHallName(matched.hall)}，因为其中有值得被保存的情绪和细节。`,
    coverImage: "",
    mediaNote: /照片|截图|语音|录音|合影|相册/.test(text)
      ? "第十阶段媒体线索：这段记忆可能适合进入时间线、主题展，并补充封面图、OCR 文本或语音转写说明。"
      : "",
    attachments: []
  };
}

async function analyzeMemory(rawContent) {
  try {
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rawContent })
    });
    const payload = await readApiPayload(response);
    if (!response.ok) throw new Error(payload.error || "AI 分析失败。");

    const normalized = normalizeAnalysisResult(payload.data || {}, rawContent);
    return {
      result: normalized,
      mode: payload.mode || "ai",
      reason: payload.reason || "",
      workflow: normalizeAgentWorkflow(payload.workflow, normalized, rawContent, payload.mode || "ai")
    };
  } catch (error) {
    const result = mockAnalyzeMemory(rawContent);
    return {
      result,
      mode: "local-mock",
      reason: limitText(error.message, 160),
      workflow: buildLocalAgentWorkflow(rawContent, result, "local-mock")
    };
  }
}

function normalizeAgentWorkflow(workflow, result, rawContent, mode) {
  const steps = Array.isArray(workflow?.steps) ? workflow.steps : [];
  if (steps.length) {
    const normalizedSteps = steps.slice(0, 6).map((step) => ({
      id: limitText(step.id, 40) || createId(),
      agent: limitText(step.agent, 40) || "Agent",
      duty: limitText(step.duty, 120),
      status: limitText(step.status, 20) || "done",
      output: limitText(step.output, 220) || "已完成。",
      evidence: Array.isArray(step.evidence) ? step.evidence.slice(0, 8).map((item) => limitText(item, 40)).filter(Boolean) : [],
      actions: Array.isArray(step.actions) ? step.actions.slice(0, 4).map((item) => limitText(item, 30)).filter(Boolean) : []
    }));
    return {
      phase: Number(workflow.phase) || 7,
      mode: workflow.mode || mode,
      run: normalizeAgentRun(workflow.run, workflow.mode || mode),
      stateMachine: normalizeStateMachine(workflow.stateMachine),
      summary: normalizeWorkflowSummary(workflow.summary, normalizedSteps),
      steps: normalizedSteps
    };
  }
  return buildLocalAgentWorkflow(rawContent, result, mode);
}

function buildLocalAgentWorkflow(rawContent, result, mode = "local-mock") {
  const shortRaw = limitText(rawContent, 96);
  const people = result.people?.length ? result.people.slice(0, 4).join("、") : "未识别明确人物";
  const tags = result.tags?.length ? result.tags.slice(0, 4).join("、") : "暂无标签";
  const emotions = result.emotions?.length ? result.emotions.slice(0, 4).join("、") : "暂无情绪";
  const reviewItems = buildLocalReviewItems(result);
  const archiveNeedsReview = reviewItems.some((item) => ["people", "location", "date"].includes(item.field));
  const editorNeedsReview = reviewItems.some((item) => ["tags", "exhibitText"].includes(item.field));
  const needsReview = [archiveNeedsReview, editorNeedsReview].filter(Boolean).length;
  const ready = reviewItems.length ? 0 : 1;
  const done = 3 - needsReview;
  return {
    phase: 10,
    mode,
    run: createAgentRun(mode, "本地 Agent 工作流已创建"),
    stateMachine: {
      statuses: ["queued", "running", "needs_review", "approved", "rejected", "failed", "done", "ready"],
      actions: ["confirm", "reject", "retry", "save"]
    },
    summary: {
      total: 4,
      done,
      ready,
      running: 0,
      needsReview,
    approved: 0,
    rejected: 0,
      status: reviewItems.length ? "needs_review" : "ready",
      progress: Math.round(((done + ready) / 4) * 100),
      requiresHumanReview: reviewItems.length > 0,
      confirmationItems: reviewItems.map((item) => ({ ...item, state: "pending", action: "confirm" })),
      reviewItems,
      nextAction: reviewItems.length ? "补全复核项并确认后，可以保存展品" : "保存展品后可进入讲解员检索池"
    },
    steps: [
      { id: "archivist", agent: "档案员 Agent", duty: "提取人物、地点、时间、来源和原始线索", status: archiveNeedsReview ? "needs_review" : "done", output: `已读取原始片段“${shortRaw}”，提取人物：${people}。`, evidence: ["rawContent", "people", "location", "date"], actions: ["confirm", "reject", "retry"] },
      { id: "curator", agent: "策展人 Agent", duty: "判断展厅、情绪和珍藏级别", status: "done", output: `已归入${getHallName(result.hall)}，情绪为 ${emotions}，强度 ${result.emotionIntensity} / 5。`, evidence: ["hall", "emotions", "importance"], actions: ["confirm", "reject"] },
      { id: "editor", agent: "编辑 Agent", duty: "生成标题、标签和展品说明", status: editorNeedsReview ? "needs_review" : "done", output: `已生成标题《${result.title}》，标签：${tags}。`, evidence: ["title", "tags", "exhibitText"], actions: ["confirm", "reject", "retry"] },
      { id: "guide", agent: "讲解员 Agent", duty: "整理面向参观者的导览提示", status: reviewItems.length ? "queued" : "ready", output: reviewItems.length ? "等待人工确认完成后，再进入讲解员检索池。" : "保存后会进入讲解员检索池，参与后续 RAG 回答。", evidence: ["savedMemory", "ragCandidate"], actions: reviewItems.length ? [] : ["confirm"] }
    ]
  };
}

function normalizeStateMachine(stateMachine = {}) {
  const statuses = Array.isArray(stateMachine.statuses)
    ? stateMachine.statuses.map((item) => limitText(item, 30)).filter(Boolean)
    : ["queued", "running", "needs_review", "approved", "rejected", "failed", "done", "ready"];
  const actions = Array.isArray(stateMachine.actions)
    ? stateMachine.actions.map((item) => limitText(item, 30)).filter(Boolean)
    : ["confirm", "retry", "save"];
  return { statuses, actions };
}

function createAgentRun(mode = "local", label = "Agent 工作流已创建") {
  const now = new Date().toISOString();
  return {
    id: createId(),
    phase: 10,
    mode,
    createdAt: now,
    eventCount: 1,
    events: [{ type: "workflow_created", label, at: now }]
  };
}

function normalizeAgentRun(run, mode = "local") {
  const fallback = createAgentRun(mode);
  if (!run || typeof run !== "object") return fallback;
  const events = Array.isArray(run.events)
    ? run.events.slice(-6).map((event) => ({
      type: limitText(event.type, 40) || "event",
      label: limitText(event.label, 80) || "已记录工作流事件",
      at: limitText(event.at, 40) || new Date().toISOString(),
      step: limitText(event.step, 40)
    }))
    : fallback.events;
  return {
    id: limitText(run.id, 80) || fallback.id,
    phase: Number(run.phase) || 6,
    mode: limitText(run.mode, 40) || mode,
    createdAt: limitText(run.createdAt, 40) || fallback.createdAt,
    eventCount: Math.max(Number(run.eventCount) || events.length, events.length),
    events
  };
}

function appendAgentEvent(type, label, stepId = "") {
  if (!latestAgentWorkflow) return;
  const run = normalizeAgentRun(latestAgentWorkflow.run, latestAgentWorkflow.mode || "local");
  const event = {
    type: limitText(type, 40) || "event",
    label: limitText(label, 80) || "已记录工作流事件",
    step: limitText(stepId, 40),
    at: new Date().toISOString()
  };
  run.events = [...(run.events || []), event].slice(-6);
  run.eventCount = Math.max(Number(run.eventCount) || 0, 0) + 1;
  latestAgentWorkflow.run = run;
}

function formatAgentRunTime(value) {
  if (!value) return "刚刚";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "刚刚";
  return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function normalizeWorkflowSummary(summary, steps) {
  const total = steps.length;
  const done = steps.filter((step) => step.status === "done").length;
  const ready = steps.filter((step) => step.status === "ready").length;
  const running = steps.filter((step) => step.status === "running").length;
  return {
    total: Number(summary?.total) || total,
    done: Number(summary?.done) || done,
    ready: Number(summary?.ready) || ready,
    running: Number(summary?.running) || running,
    needsReview: Number(summary?.needsReview) || steps.filter((step) => step.status === "needs_review").length,
    approved: Number(summary?.approved) || steps.filter((step) => step.status === "approved").length,
    rejected: Number(summary?.rejected) || steps.filter((step) => step.status === "rejected").length,
    status: limitText(summary?.status, 20) || (running > 0 ? "running" : ready > 0 ? "ready" : "pending"),
    progress: Math.min(100, Math.max(0, Number(summary?.progress) || Math.round(((done + ready) / Math.max(total, 1)) * 100))),
    requiresHumanReview: Boolean(summary?.requiresHumanReview),
    confirmationItems: normalizeReviewItems(summary?.confirmationItems),
    reviewItems: normalizeReviewItems(summary?.reviewItems),
    nextAction: limitText(summary?.nextAction, 80) || (ready > 0 ? "保存展品后可进入讲解员检索池" : "继续等待 Agent 工作流完成")
  };
}

function buildLocalReviewItems(result = {}) {
  const items = [];
  if (!result.people?.length) items.push({ field: "people", label: "人物未明确" });
  if (!result.location) items.push({ field: "location", label: "地点可补充" });
  if (!result.date) items.push({ field: "date", label: "时间可补充" });
  if (!result.tags?.length || result.tags.length < 2) items.push({ field: "tags", label: "标签可再丰富" });
  if (!result.exhibitText || result.exhibitText.length < 40) items.push({ field: "exhibitText", label: "展品说明偏短" });
  return items.slice(0, 4);
}

function normalizeReviewItems(items) {
  if (!Array.isArray(items)) return [];
  return items.map((item) => {
    if (typeof item === "string") {
      return { field: getReviewFieldFromLabel(item), label: limitText(item, 40) };
    }
    return {
      field: limitText(item.field, 40) || getReviewFieldFromLabel(item.label),
      label: limitText(item.label, 40)
    };
  }).filter((item) => item.label).slice(0, 4);
}

function getReviewFieldFromLabel(label = "") {
  const text = String(label);
  if (text.includes("人物")) return "people";
  if (text.includes("地点")) return "location";
  if (text.includes("时间")) return "date";
  if (text.includes("标签")) return "tags";
  if (text.includes("说明")) return "exhibitText";
  return "";
}

function renderAgentWorkflow(workflow) {
  const steps = Array.isArray(workflow?.steps) ? workflow.steps : [];
  if (!steps.length) {
    elements.agentWorkflow.innerHTML = "";
    elements.agentWorkflow.setAttribute("aria-busy", "false");
    latestAgentWorkflow = null;
    updateAgentActionState();
    renderDraftPreview();
    return;
  }
  if (!workflow.run) workflow.run = createAgentRun(workflow.mode || "local");
  latestAgentWorkflow = workflow;
  const summary = workflow.summary || null;
  const progress = summary ? Math.min(100, Math.max(0, Number(summary.progress) || 0)) : 0;
  const isBusy = Boolean(summary && summary.status !== "ready" && summary.status !== "done" && progress < 100);
  elements.agentWorkflow.setAttribute("aria-busy", isBusy ? "true" : "false");

  elements.agentWorkflow.innerHTML = `
    <div class="agent-workflow-heading">
      <span>Agent 工作流</span>
      <small>${escapeHtml(workflow.mode || "local")}</small>
    </div>
    ${renderAgentStateMachine(workflow.stateMachine, summary?.status)}
    ${summary ? `
      <div class="agent-summary">
        <span>${escapeHtml(`${summary.done}/${summary.total} 已完成`)}</span>
        <span>${escapeHtml(`${summary.ready} 个就绪`)}</span>
        ${Number(summary.needsReview) > 0 ? `<span data-summary-state="needs-review">${escapeHtml(`${summary.needsReview} 个待确认`)}</span>` : ""}
        ${Number(summary.approved) > 0 ? `<span data-summary-state="approved">${escapeHtml(`${summary.approved} 个已确认`)}</span>` : ""}
        ${Number(summary.rejected) > 0 ? `<span data-summary-state="rejected">${escapeHtml(`${summary.rejected} 个已驳回`)}</span>` : ""}
        <span>${escapeHtml(`${progress}%`)}</span>
        <strong>${escapeHtml(summary.nextAction || "")}</strong>
      </div>
      <div class="agent-progress" role="progressbar" aria-label="Agent 工作流进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}">
        <span style="width: ${progress}%"></span>
      </div>
      ${renderAgentReview(summary)}
    ` : ""}
    ${renderAgentRunSummary(workflow.run)}
    <div class="agent-steps">
      ${steps.map((step, index) => `
        <article class="agent-step" data-status="${escapeHtml(step.status || "done")}">
          <span class="agent-step-index">${index + 1}</span>
          <div>
            <div class="agent-step-title">
              <strong>${escapeHtml(step.agent || "Agent")}</strong>
              <span>${escapeHtml(getAgentStatusLabel(step.status))}</span>
            </div>
            ${step.duty ? `<small>${escapeHtml(step.duty)}</small>` : ""}
            <p>${escapeHtml(step.output || "已完成。")}</p>
            ${renderAgentStepEvidence(step)}
            ${renderAgentStepActions(step)}
          </div>
        </article>
      `).join("")}
    </div>
  `;
  updateAgentActionState();
  renderDraftPreview();
}

function renderAgentRunSummary(run) {
  const normalizedRun = normalizeAgentRun(run);
  const recentEvents = Array.isArray(normalizedRun.events) ? normalizedRun.events.slice(-3).reverse() : [];
  const shortId = normalizedRun.id.length > 8 ? normalizedRun.id.slice(0, 8) : normalizedRun.id;
  return `
    <div class="agent-run-summary" aria-label="Agent 运行摘要">
      <div class="agent-run-meta">
        <span>运行 ${escapeHtml(shortId)}</span>
        <span>阶段 ${escapeHtml(String(normalizedRun.phase))}</span>
        <span>${escapeHtml(`${normalizedRun.eventCount} 条事件`)}</span>
        <span>${escapeHtml(formatAgentRunTime(normalizedRun.createdAt))}</span>
      </div>
      ${recentEvents.length ? `
        <div class="agent-run-events">
          ${recentEvents.map((event) => `
            <span title="${escapeHtml(formatAgentRunTime(event.at))}">
              ${escapeHtml(event.label)}
            </span>
          `).join("")}
        </div>
      ` : ""}
    </div>
  `;
}

function renderAgentStateMachine(stateMachine, currentStatus = "") {
  const statuses = Array.isArray(stateMachine?.statuses) ? stateMachine.statuses : [];
  if (!statuses.length) return "";
  return `
    <div class="agent-state-machine" aria-label="Agent 状态机">
      ${statuses.map((status) => `
        <span data-state="${escapeHtml(status)}" ${status === currentStatus ? "data-current" : ""}>
          ${escapeHtml(getAgentStatusLabel(status))}
        </span>
      `).join("")}
    </div>
  `;
}

function renderAgentStepEvidence(step) {
  const evidence = Array.isArray(step.evidence) ? step.evidence.filter(Boolean).slice(0, 6) : [];
  if (!evidence.length) return "";
  return `
    <div class="agent-step-evidence" aria-label="Agent 依据字段">
      ${evidence.map((item) => `<span>${escapeHtml(getEvidenceLabel(item))}</span>`).join("")}
    </div>
  `;
}

function getEvidenceLabel(key = "") {
  return {
    rawContent: "原始记忆",
    people: "人物",
    location: "地点",
    date: "时间",
    hall: "展厅",
    emotions: "情绪",
    emotionIntensity: "情绪强度",
    importance: "珍藏级别",
    title: "标题",
    tags: "标签",
    exhibitText: "展品说明",
    savedMemory: "保存展品",
    ragCandidate: "讲解员检索"
  }[key] || key;
}

function renderAgentStepActions(step) {
  const actions = new Set(Array.isArray(step.actions) ? step.actions : []);
  if (step.status === "needs_review") {
    actions.add("confirm");
    actions.add("reject");
    actions.add("retry");
  }
  if (!actions.size) return "";

  return `
    <div class="agent-step-actions">
      ${actions.has("confirm") ? `<button type="button" data-agent-approve-step="${escapeHtml(step.id || "")}">确认本步</button>` : ""}
      ${actions.has("reject") ? `<button type="button" data-agent-reject-step="${escapeHtml(step.id || "")}">驳回本步</button>` : ""}
      ${actions.has("retry") ? `<button type="button" data-agent-retry-step="${escapeHtml(step.id || "")}">重试整理</button>` : ""}
    </div>
  `;
}

function renderAgentReview(summary = {}) {
  const items = Array.isArray(summary.reviewItems) ? summary.reviewItems : [];
  const isComplete = summary.status === "ready" || summary.status === "done" || Number(summary.progress) >= 100;
  if (!isComplete && items.length === 0) {
    return `
      <div class="agent-review agent-review-waiting">
        <span>复核状态</span>
        <strong class="agent-review-pending">等待 Agent 输出</strong>
      </div>
    `;
  }

  if (items.length === 0) {
    const completeLabel = summary.reviewConfirmed ? "人工确认完成，可以保存" : "无需复核，可以保存";
    return `
      <div class="agent-review agent-review-empty" data-complete>
        <span>复核状态</span>
        <strong class="agent-review-complete">${escapeHtml(completeLabel)}</strong>
      </div>
    `;
  }

  return `
    <div class="agent-review">
      <span>建议复核</span>
      ${items.map((item) => `<button type="button" data-review-field="${escapeHtml(item.field || "")}" aria-label="${escapeHtml(`定位到${item.label}`)}" title="${escapeHtml(`定位到${item.label}`)}">${escapeHtml(item.label)}</button>`).join("")}
      <button type="button" class="agent-review-confirm" data-confirm-review hidden>确认复核完成</button>
      <strong class="agent-review-complete" hidden>人工确认完成，可以保存</strong>
    </div>
  `;
}

function refreshAgentReviewItems() {
  if (!latestAgentDraft || !elements.agentWorkflow.innerHTML.trim()) return;
  const reviewItems = buildCurrentReviewItemsFromForm();
  elements.agentWorkflow.querySelectorAll("[data-review-field]").forEach((button) => {
    const field = button.dataset.reviewField;
    const stillNeedsReview = reviewItems.some((item) => item.field === field);
    button.toggleAttribute("hidden", !stillNeedsReview);
  });
  const reviewBox = elements.agentWorkflow.querySelector(".agent-review");
  if (reviewBox) {
    if (reviewBox.classList.contains("agent-review-waiting")) return;
    const visibleButtons = Array.from(reviewBox.querySelectorAll("[data-review-field]")).filter((button) => !button.hidden);
    const completeMessage = reviewBox.querySelector(".agent-review-complete");
    const confirmButton = reviewBox.querySelector(".agent-review-confirm");
    const readyToConfirm = visibleButtons.length === 0;
    if (!readyToConfirm) reviewBox.removeAttribute("data-confirmed");
    const isConfirmed = reviewBox.hasAttribute("data-confirmed");
    if (confirmButton) confirmButton.toggleAttribute("hidden", !readyToConfirm || isConfirmed);
    if (completeMessage) completeMessage.toggleAttribute("hidden", !readyToConfirm || !isConfirmed);
    reviewBox.toggleAttribute("data-complete", readyToConfirm && isConfirmed);
  }
}

function buildCurrentReviewItemsFromForm() {
  const result = {
    people: splitList(elements.peopleInput.value),
    location: elements.locationInput.value.trim(),
    date: elements.memoryDate.value,
    tags: splitList(elements.tagsInput.value),
    exhibitText: elements.exhibitText.value.trim()
  };
  return buildLocalReviewItems(result);
}

function getAgentStatusLabel(status = "done") {
  return {
    done: "已完成",
    approved: "已确认",
    rejected: "已驳回",
    needs_review: "待确认",
    ready: "已就绪",
    running: "运行中",
    queued: "等待中",
    failed: "需处理"
  }[status] || status;
}

function approveAgentStep(stepId) {
  if (!latestAgentWorkflow || !stepId) return;
  const step = latestAgentWorkflow.steps?.find((item) => item.id === stepId);
  if (!step || step.status === "approved") return;
  step.status = "approved";
  step.output = `${step.output || "已完成。"} 已由用户确认。`;
  appendAgentEvent("step_approved", `${step.agent || "Agent"}已确认`, step.id);
  latestAgentWorkflow.summary = rebuildClientWorkflowSummary(latestAgentWorkflow);
  renderAgentWorkflow(latestAgentWorkflow);
  setAiStatus("已确认该 Agent 步骤。", "success");
}

function rejectAgentStep(stepId) {
  if (!latestAgentWorkflow || !stepId) return;
  const step = latestAgentWorkflow.steps?.find((item) => item.id === stepId);
  if (!step || step.status === "rejected") return;
  step.status = "rejected";
  step.output = `${step.output || "已完成。"} 用户已驳回本步建议，可手动调整表单后保存。`;
  appendAgentEvent("step_rejected", `${step.agent || "Agent"}已驳回`, step.id);
  latestAgentWorkflow.summary = rebuildClientWorkflowSummary(latestAgentWorkflow);
  renderAgentWorkflow(latestAgentWorkflow);
  setAiStatus("已驳回该 Agent 步骤，可手动调整后保存。", "warning");
}

function retryAgentStep(stepId) {
  if (!stepId || isAnalyzing) return;
  const step = latestAgentWorkflow?.steps?.find((item) => item.id === stepId);
  if (step && latestAgentWorkflow) {
    step.status = "running";
    step.output = `${step.agent || "Agent"}正在重新整理这一部分。`;
    appendAgentEvent("step_retry", `${step.agent || "Agent"}已触发重试`, step.id);
    latestAgentWorkflow.summary = rebuildClientWorkflowSummary(latestAgentWorkflow);
    renderAgentWorkflow(latestAgentWorkflow);
  }
  setAiStatus(`正在重新运行${step?.agent || "Agent"}整理...`, "loading");
  window.setTimeout(() => {
    handleMockAi({
      type: "step_retry_completed",
      label: `${step?.agent || "Agent"}重试后已生成新结果`,
      step: stepId
    });
  }, 180);
}

function confirmAgentReview(button) {
  const reviewBox = button.closest(".agent-review");
  if (!reviewBox) return;
  const remainingReviewItems = buildCurrentReviewItemsFromForm();
  if (remainingReviewItems.length > 0) {
    setAiStatus("还有复核项未补全，请先补完后再确认。", "warning");
    return;
  }
  reviewBox.setAttribute("data-confirmed", "true");
  if (latestAgentWorkflow?.summary) {
    latestAgentWorkflow.steps = (latestAgentWorkflow.steps || []).map((step) => {
      if (step.status === "needs_review") {
        return {
          ...step,
          status: "approved",
          output: `${step.output || "已完成。"} 已由用户确认。`
        };
      }
      if (step.status === "queued" && step.id === "guide") {
        return {
          ...step,
          status: "ready",
          actions: ["confirm"],
          output: "人工复核完成，保存后可进入讲解员检索池。"
        };
      }
      return step;
    });
    latestAgentWorkflow.summary.requiresHumanReview = false;
    latestAgentWorkflow.summary.confirmationItems = (latestAgentWorkflow.summary.confirmationItems || []).map((item) => ({
      ...item,
      state: "confirmed"
    }));
    latestAgentWorkflow.summary.reviewItems = [];
    latestAgentWorkflow.summary.reviewConfirmed = true;
    latestAgentWorkflow.summary.nextAction = "人工复核已确认，可以保存展品";
    latestAgentWorkflow.summary = {
      ...latestAgentWorkflow.summary,
      ...rebuildClientWorkflowSummary(latestAgentWorkflow),
      requiresHumanReview: false,
      confirmationItems: latestAgentWorkflow.summary.confirmationItems,
      reviewItems: [],
      reviewConfirmed: true,
      nextAction: "人工复核已确认，可以保存展品"
    };
    appendAgentEvent("review_confirmed", "人工复核已确认");
  }
  renderAgentWorkflow(latestAgentWorkflow);
  setAiStatus("人工复核已确认，可以保存展品。", "success");
}

function rebuildClientWorkflowSummary(workflow) {
  const steps = Array.isArray(workflow?.steps) ? workflow.steps : [];
  const done = steps.filter((step) => step.status === "done").length;
  const ready = steps.filter((step) => step.status === "ready").length;
  const running = steps.filter((step) => step.status === "running").length;
  const needsReview = steps.filter((step) => step.status === "needs_review").length;
  const approved = steps.filter((step) => step.status === "approved").length;
  const rejected = steps.filter((step) => step.status === "rejected").length;
  const completed = done + ready + approved + rejected;
  return {
    ...(workflow.summary || {}),
    total: steps.length,
    done,
    ready,
    running,
    needsReview,
    approved,
    rejected,
    status: running > 0 ? "running" : needsReview > 0 ? "needs_review" : ready > 0 ? "ready" : "done",
    progress: steps.length ? Math.round((completed / steps.length) * 100) : 0
  };
}

function updateAgentActionState() {
  const hasWorkflow = elements.agentWorkflow.innerHTML.trim().length > 0;
  elements.useAgentSuggestionButton.disabled = isAnalyzing || !latestAgentDraft || !hasWorkflow;
  elements.clearAgentWorkflowButton.disabled = isAnalyzing || !hasWorkflow;
}

function useAgentSuggestion() {
  if (!latestAgentDraft || isAnalyzing) return;
  const manualFields = {
    people: elements.peopleInput.value,
    location: elements.locationInput.value,
    date: elements.memoryDate.value,
    tags: elements.tagsInput.value,
    exhibitText: elements.exhibitText.value
  };
  applyAnalysisToForm(latestAgentDraft);
  if (manualFields.people.trim()) elements.peopleInput.value = manualFields.people;
  if (manualFields.location.trim()) elements.locationInput.value = manualFields.location;
  if (manualFields.date) elements.memoryDate.value = manualFields.date;
  if (manualFields.tags.trim()) elements.tagsInput.value = manualFields.tags;
  if (manualFields.exhibitText.trim()) elements.exhibitText.value = manualFields.exhibitText;
  appendAgentEvent("suggestion_applied", "Agent 建议已重新应用");
  refreshAgentReviewItems();
  setAiStatus("已重新应用 Agent 建议，你可以继续微调后保存。", "success");
  renderGuide(`已把 Agent 建议重新应用到表单。\n\n标题：${latestAgentDraft.title}\n展厅：${getHallName(latestAgentDraft.hall)}\n情绪：${latestAgentDraft.emotions.join("、")}`);
}

function clearAgentWorkflow() {
  if (isAnalyzing) return;
  renderAgentWorkflow();
}

function focusReviewField(field) {
  const target = {
    people: elements.peopleInput,
    location: elements.locationInput,
    date: elements.memoryDate,
    tags: elements.tagsInput,
    exhibitText: elements.exhibitText
  }[field];
  if (!target) return;
  target.focus();
  target.scrollIntoView({ behavior: "smooth", block: "center" });
  setAiStatus("已定位到建议复核的字段。", "loading");
}

function handleReviewFieldInput() {
  refreshAgentReviewItems();
}

async function askGuide(question) {
  try {
    const payload = await requestJson("/api/guide", {
      method: "POST",
      body: JSON.stringify({ question })
    });
    return {
      mode: payload.mode || "mock",
      answer: payload.answer || "讲解员暂时没有生成回答。",
      memories: Array.isArray(payload.memories) ? payload.memories : [],
      citations: Array.isArray(payload.citations) ? payload.citations : [],
      followUps: Array.isArray(payload.followUps) ? payload.followUps.slice(0, 3) : [],
      retrievalMode: payload.retrievalMode || "keyword",
      query: payload.query || "",
      reason: payload.reason || ""
    };
  } catch (error) {
    return {
      mode: "local",
      answer: buildLocalGuideAnswer(question),
      memories: filteredMemories().slice(0, 4).map(buildStructuredMemory),
      citations: [],
      followUps: ["检查后端服务是否已启动", "换一个更具体的问题", "先从当前展厅导览开始"],
      retrievalMode: "local-page",
      query: question,
      reason: limitText(error.message, 160)
    };
  }
}

function buildLocalGuideAnswer(question) {
  const candidates = filteredMemories().slice(0, 4);
  if (candidates.length === 0) {
    return `你的问题是：“${question}”。\n\n当前页面没有可用展品。可以先同步数据库、清空筛选，或新增几件展品后再问我。`;
  }

  const titles = candidates.map((memory) => `《${memory.title}》`).join("、");
  const emotions = [...new Set(candidates.flatMap((memory) => memory.emotions || []))].slice(0, 5).join("、") || "暂未记录";
  return `你的问题是：“${question}”。\n\n当前未能连接后端 RAG 接口，我先基于页面里可见的展品回答。可以参考 ${titles}。\n\n这些展品共同呈现出的情绪包括：${emotions}。其中《${candidates[0].title}》最适合作为第一件讲解展品：${candidates[0].exhibitText}`;
}

function formatGuideEvidence(memories) {
  if (!memories.length) return "暂无候选展品";

  return memories.slice(0, 4).map((memory) => {
    const hallId = typeof memory.hall === "object" ? memory.hall?.id : memory.hall;
    const hallName = typeof memory.hall === "object" ? memory.hall?.name : getHallName(hallId);
    const emotions = (memory.emotions || []).slice(0, 2).join("、");
    const importance = memory.importanceLabel || getImportanceLabel(memory.importance);
    const attachmentCount = normalizeAttachments(memory.attachments).length;
    const media = attachmentCount ? `附件 ${attachmentCount}` : memory.mediaNote ? "多模态线索" : "";
    const meta = [hallName, emotions, importance, media].filter(Boolean).join(" / ");
    return `《${memory.title}》${meta ? `（${meta}）` : ""}`;
  }).join("、");
}

function formatGuideCitations(citations) {
  if (!citations.length) return "";
  return citations.slice(0, 4).map((citation) => {
    const title = citation.memory?.title || "未命名展品";
    const score = Number(citation.score) ? `分数 ${citation.score}` : "";
    const fields = (citation.matchedFields || []).slice(0, 3).join("、");
    const semantic = (citation.semanticTerms || []).slice(0, 3).join("、");
    const confidence = citation.confidence?.label ? `可信度 ${citation.confidence.label}` : "";
    const reason = citation.reason ? `原因 ${citation.reason}` : "";
    const parts = [confidence, score, fields ? `字段 ${fields}` : "", semantic ? `语义 ${semantic}` : "", reason].filter(Boolean).join(" / ");
    return `《${title}》${parts ? `（${parts}）` : ""}`;
  }).join("、");
}

function formatGuideFollowUps(followUps) {
  if (!followUps.length) return "";
  return followUps.slice(0, 3).map((item, index) => `${index + 1}. ${item}`).join("\n");
}

function normalizeAnalysisResult(value, rawContent) {
  const draft = mockAnalyzeMemory(rawContent);
  const hallId = typeof value.hall === "object" ? value.hall?.id : value.hall;
  const hallExists = halls.some((hall) => hall.id === hallId && hall.id !== "all");
  const tags = normalizeList(value.tags).length ? normalizeList(value.tags) : draft.tags;
  const people = normalizeList(value.people);
  const emotions = normalizeList(value.emotions).filter((emotion) => emotionOptions.includes(emotion));

  return {
    title: limitText(value.title || draft.title, fieldLimits.title),
    hall: hallExists ? hallId : draft.hall,
    emotions: emotions.length ? emotions.slice(0, 4) : draft.emotions,
    tags: tags.slice(0, 8),
    people: people.slice(0, 8),
    location: limitText(value.location || "", fieldLimits.location),
    date: limitText(value.date || "", fieldLimits.date),
    sourceType: sourceTypes.includes(value.sourceType) ? value.sourceType : draft.sourceType,
    importance: Math.min(5, Math.max(1, Number(value.importance) || draft.importance)),
    emotionIntensity: Math.min(5, Math.max(1, Number(value.emotionIntensity) || draft.emotionIntensity)),
    favorite: parseBoolean(value.favorite) || Number(value.importance) >= 4,
    exhibitText: limitText(value.exhibitText || draft.exhibitText, fieldLimits.exhibitText),
    coverImage: limitText(value.coverImage || "", fieldLimits.coverImage),
    mediaNote: limitText(value.mediaNote || draft.mediaNote || "", fieldLimits.mediaNote),
    attachments: normalizeAttachments(value.attachments)
  };
}

function applyAnalysisToForm(result) {
  elements.titleInput.value = result.title;
  elements.hallSelect.value = result.hall;
  elements.sourceType.value = result.sourceType;
  elements.importanceSelect.value = String(result.importance);
  elements.emotionIntensity.value = String(result.emotionIntensity);
  elements.favoriteInput.checked = result.favorite;
  elements.locationInput.value = result.location || elements.locationInput.value;
  elements.memoryDate.value = result.date && /^\d{4}-\d{2}-\d{2}$/.test(result.date) ? result.date : elements.memoryDate.value;
  elements.peopleInput.value = result.people?.length ? result.people.join("，") : elements.peopleInput.value;
  elements.exhibitText.value = result.exhibitText;
  elements.coverImageInput.value = result.coverImage || elements.coverImageInput.value;
  elements.mediaNoteInput.value = result.mediaNote || elements.mediaNoteInput.value;
  elements.attachmentsInput.value = result.attachments?.length ? formatAttachmentsInput(result.attachments) : elements.attachmentsInput.value;
  elements.tagsInput.value = result.tags.join("，");
  setSelectedEmotions(result.emotions);
  updateEmotionIntensityOutput();
  renderDraftPreview();
}

async function handleMockAi(runEvent = null) {
  const raw = elements.rawContent.value.trim();
  if (!raw) {
    alert("先写一段原始记忆，再让 Agent 工作流整理。");
    return;
  }
  if (!confirmAiDataScope(raw)) return;

  setAnalyzePending(true);
  try {
    setAiStatus("正在运行多 Agent 工作流...", "loading");
    renderAgentWorkflow({
      mode: "running",
      phase: 10,
      run: createAgentRun("running", "Agent 工作流开始运行"),
      stateMachine: {
        statuses: ["queued", "running", "needs_review", "approved", "rejected", "failed", "done", "ready"],
        actions: ["confirm", "reject", "retry", "save"]
      },
      summary: {
        total: 4,
        done: 0,
        ready: 0,
        running: 1,
        status: "running",
        progress: 25,
        reviewItems: [],
        nextAction: "等待多 Agent 工作流完成"
      },
      steps: [
        { agent: "档案员 Agent", duty: "提取人物、地点、时间、来源和原始线索", status: "running", output: "正在读取原始记忆，提取人物、地点、时间和来源线索。" },
        { agent: "策展人 Agent", duty: "判断展厅、情绪和珍藏级别", status: "queued", output: "等待判断展厅、情绪和珍藏级别。" },
        { agent: "编辑 Agent", duty: "生成标题、标签和展品说明", status: "queued", output: "等待生成标题、标签和展品说明。" },
        { agent: "讲解员 Agent", duty: "整理面向参观者的导览提示", status: "queued", output: "等待把展品接入后续检索讲解。" }
      ]
    });
    const { result, mode, reason, workflow } = await analyzeMemory(raw);
    latestAgentDraft = result;
    applyAnalysisToForm(result);
    if (runEvent) {
      workflow.run = normalizeAgentRun(workflow.run, workflow.mode || mode);
      latestAgentWorkflow = workflow;
      appendAgentEvent(runEvent.type, runEvent.label, runEvent.step);
    }
    renderAgentWorkflow(workflow);

    if (mode === "ai") {
      setAiStatus("Agent 工作流完成：已使用后端真实 AI 接口。", "success");
    } else if (mode === "mock") {
      setAiStatus("AI API 未配置或不可用：后端已使用 Mock Agent 工作流回退。", "warning");
    } else {
      setAiStatus(`无法连接后端：已使用前端本地 Agent 工作流。${reason ? `原因：${reason}` : ""}`, "warning");
    }

    renderGuide(`Agent 工作流已经把这段记忆整理成展品草稿。\n\n标题：${result.title}\n展厅：${getHallName(result.hall)}\n情绪：${result.emotions.join("、")}\n模式：${mode}\n\n下一步你可以手动修改，然后保存为展品。`);
  } finally {
    setAnalyzePending(false);
  }
}

async function fillSampleMemory() {
  const sample = samplePrompts[Math.floor(Math.random() * samplePrompts.length)];
  resetFormState();
  elements.rawContent.value = sample;
  updateRawCount();
  await handleMockAi();
}

function clearCollectionFilters() {
  activeHall = "all";
  searchKeyword = "";
  sortMode = "newest";
  emotionFilter = "all";
  elements.searchInput.value = "";
  elements.sortSelect.value = sortMode;
  elements.emotionFilterSelect.value = emotionFilter;
  render();
}

function buildMemoryFromForm(existing = {}) {
  const rawContent = elements.rawContent.value.trim();
  const draft = mockAnalyzeMemory(rawContent);
  const tags = splitList(elements.tagsInput.value);
  const emotions = selectedEmotions();

  return normalizeMemory({
    ...existing,
    title: elements.titleInput.value.trim() || draft.title,
    hall: elements.hallSelect.value || draft.hall,
    rawContent,
    exhibitText: elements.exhibitText.value.trim() || draft.exhibitText,
    date: elements.memoryDate.value,
    location: elements.locationInput.value.trim(),
    sourceType: elements.sourceType.value || draft.sourceType,
    importance: Number(elements.importanceSelect.value) || draft.importance,
    emotionIntensity: Number(elements.emotionIntensity.value) || draft.emotionIntensity,
    favorite: elements.favoriteInput.checked,
    agentRunId: latestAgentWorkflow?.run?.id || existing.agentRunId || "",
    people: splitList(elements.peopleInput.value),
    tags: tags.length ? tags : draft.tags,
    emotions: emotions.length ? emotions : draft.emotions,
    coverImage: elements.coverImageInput.value.trim(),
    mediaNote: elements.mediaNoteInput.value.trim(),
    attachments: normalizeAttachments(elements.attachmentsInput.value),
    createdAt: existing.createdAt || new Date().toISOString(),
    updatedAt: existing.id ? new Date().toISOString() : ""
  });
}

function resetFormState() {
  editingId = null;
  latestAgentDraft = null;
  elements.memoryForm.reset();
  renderAgentWorkflow();
  elements.emotionIntensity.value = "3";
  updateEmotionIntensityOutput();
  updateRawCount();
  renderFormMode();
}

function agentReviewBlocksSave() {
  if (!latestAgentWorkflow?.summary?.requiresHumanReview) return false;
  return buildCurrentReviewItemsFromForm().length > 0 || !latestAgentWorkflow.summary.reviewConfirmed;
}

async function handleSubmit(event) {
  event.preventDefault();
  if (isAnalyzing || isPersisting) return;
  const rawContent = elements.rawContent.value.trim();
  if (!rawContent) return;
  if (agentReviewBlocksSave()) {
    refreshAgentReviewItems();
    setAiStatus("保存前需要先补全复核项，并点击“确认复核完成”。", "warning");
    return;
  }

  const existing = memories.find((item) => item.id === editingId);
  const memory = buildMemoryFromForm(existing);
  setPersistencePending(true);

  try {
    if (databaseNeedsMigration) {
      setStorageStatus("保存前正在先迁移本地备份，避免旧展品遗漏到数据库外。", "loading");
      await migrateCurrentLocalBackup({ quiet: true });
    }

    const saved = await saveMemoryToDatabase(memory, existing?.id || "");
    databaseAvailable = true;
    databaseNeedsMigration = false;
    const nextMemories = existing
      ? memories.map((item) => item.id === existing.id ? saved : item)
      : [saved, ...memories];

    memories = nextMemories;
    persistMemories(nextMemories);
    setStorageStatus(`数据库已保存：${saved.title} 已写入 SQLite。`, "success");
    await syncWorkflowBlueprint({ quiet: true });
    await syncPrivacyPolicy({ quiet: true });
    await syncVersionInfo({ quiet: true });
    resetFormState();
    activeHall = saved.hall;
    searchKeyword = "";
    elements.searchInput.value = "";
    render();
    renderGuide(existing ? `《${saved.title}》已经更新到数据库。` : `新展品《${saved.title}》已经进入${getHallName(saved.hall)}，并保存到 SQLite。`);
  } catch (error) {
    databaseAvailable = false;
    databaseNeedsMigration = false;
    const nextMemories = existing
      ? memories.map((item) => item.id === existing.id ? memory : item)
      : [memory, ...memories];

    if (!saveMemories(nextMemories)) {
      return;
    }
    memories = nextMemories;
    backendWorkflowBlueprint = null;
    workflowBlueprintSource = "local";
    privacyPolicy = null;
    privacyPolicySource = "local";
    versionInfo = null;
    operationsSource = "local";
    setStorageStatus(`数据库保存失败：已改用浏览器本地备份。原因：${error.message}`, "warning");
    resetFormState();
    activeHall = memory.hall;
    searchKeyword = "";
    elements.searchInput.value = "";
    render();
    renderGuide(existing ? `《${memory.title}》已经更新到本地备份。` : `新展品《${memory.title}》已经保存到本地备份。`);
  } finally {
    setPersistencePending(false);
  }
}

function startEdit(id) {
  const memory = memories.find((item) => item.id === id);
  if (!memory) return;

  editingId = id;
  elements.rawContent.value = memory.rawContent;
  updateRawCount();
  elements.titleInput.value = memory.title;
  elements.hallSelect.value = memory.hall;
  elements.memoryDate.value = memory.date;
  elements.locationInput.value = memory.location;
  elements.sourceType.value = memory.sourceType;
  elements.importanceSelect.value = String(memory.importance);
  elements.emotionIntensity.value = String(memory.emotionIntensity);
  elements.favoriteInput.checked = memory.favorite;
  elements.peopleInput.value = (memory.people || []).join("，");
  elements.exhibitText.value = memory.exhibitText;
  elements.coverImageInput.value = memory.coverImage || "";
  elements.mediaNoteInput.value = memory.mediaNote || "";
  elements.attachmentsInput.value = formatAttachmentsInput(memory.attachments);
  elements.tagsInput.value = (memory.tags || []).join("，");
  setSelectedEmotions(memory.emotions || []);
  updateEmotionIntensityOutput();
  render();
  elements.memoryForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function openMemory(id) {
  const memory = memories.find((item) => item.id === id);
  if (!memory) return;

  const people = memory.people?.length ? memory.people.join("、") : "未记录";
  const tags = [...(memory.emotions || []), ...(memory.tags || [])].map((tag) => pillHtml(tag)).join("");
  const created = formatDate(memory.createdAt) || "未记录";
  const updated = formatDate(memory.updatedAt);
  const archiveNumber = getArchiveNumber(memory);
  const attachments = normalizeAttachments(memory.attachments);
  const attachmentTypeSummary = formatAttachmentTypeSummary(attachments, 6);

  elements.dialogContent.innerHTML = `
    <div class="dialog-body">
      <p class="eyebrow">${escapeHtml(getHallName(memory.hall))} / ${escapeHtml(archiveNumber)}</p>
      <h3>${escapeHtml(memory.title)}</h3>
      <div class="tag-row">${tags}</div>
      <p><strong>展品说明：</strong>${escapeHtml(memory.exhibitText)}</p>
      <p><strong>原始记忆：</strong>${escapeHtml(memory.rawContent)}</p>
      <p><strong>来源：</strong>${escapeHtml(memory.sourceType)}；<strong>珍藏级别：</strong>${escapeHtml(getImportanceLabel(memory.importance))}；<strong>情绪强度：</strong>${escapeHtml(memory.emotionIntensity)} / 5${memory.favorite ? "；重点展品" : ""}</p>
      <p><strong>封面图线索：</strong>${escapeHtml(memory.coverImage || "未记录")}</p>
      <p><strong>图片/OCR/语音线索：</strong>${escapeHtml(memory.mediaNote || "未记录")}</p>
      <div class="attachment-list">
        <strong>附件清单：</strong>
        ${attachmentTypeSummary ? `<div class="attachment-type-summary">类型分布：${escapeHtml(attachmentTypeSummary)}</div>` : ""}
        ${attachments.length
          ? attachments.map((item) => `<span><b>${escapeHtml(getAttachmentCategory(item))}</b>${escapeHtml(item.name)}${item.type ? ` / ${escapeHtml(item.type)}` : ""}${item.note ? ` / ${escapeHtml(item.note)}` : ""}</span>`).join("")
          : "<span>未记录附件</span>"}
        <small>${attachments.length ? "当前保存的是附件清单和线索，原文件上传将在后续迭代接入。" : "可以在编辑展品时补充图片、截图、语音转写或其他附件线索。"}</small>
      </div>
      <p><strong>时间：</strong>${escapeHtml(memory.date || "未记录")}</p>
      <p><strong>地点：</strong>${escapeHtml(memory.location || "未记录")}</p>
      <p><strong>相关人物：</strong>${escapeHtml(people)}</p>
      <p><strong>入馆日期：</strong>${escapeHtml(created)}${updated ? `，最后编辑：${escapeHtml(updated)}` : ""}</p>
      <div id="dialog-agent-run" class="dialog-agent-run">
        ${memory.agentRunId
          ? `<p><strong>整理历史：</strong>正在读取 Agent run ${escapeHtml(memory.agentRunId.slice(0, 8))}...</p>`
          : "<p><strong>整理历史：</strong>这件展品暂未关联 Agent run。</p>"}
      </div>
    </div>
  `;
  elements.memoryDialog.showModal();
  if (!memory.agentRunId) return;

  try {
    const run = await fetchAgentRunForMemory(memory.id);
    const target = document.getElementById("dialog-agent-run");
    if (target && run) target.innerHTML = renderAgentRunDetail(run);
  } catch (error) {
    const target = document.getElementById("dialog-agent-run");
    if (target) target.innerHTML = `<p><strong>整理历史：</strong>暂时无法读取。${escapeHtml(error.message || "")}</p>`;
  }
}

function renderAgentRunDetail(run) {
  const steps = Array.isArray(run.steps) ? run.steps : [];
  const events = Array.isArray(run.events) ? run.events : [];
  const shortId = run.id?.length > 8 ? run.id.slice(0, 8) : run.id;
  const eventLabels = events.slice(-3).map((event) => event.label).filter(Boolean).join("；");
  const progress = Number(run.summary?.progress) || 0;
  const nextAction = limitText(run.summary?.nextAction || "", 80);
  return `
    <div class="agent-run-detail">
      <p><strong>整理历史：</strong>run ${escapeHtml(shortId || "未记录")}；${escapeHtml(run.mode || "mock")}；${escapeHtml(getAgentStatusLabel(run.status || "done"))}；${escapeHtml(formatAgentRunTime(run.createdAt))}</p>
      <p><strong>运行摘要：</strong>${escapeHtml(progress ? `${progress}%` : "未记录进度")}；${escapeHtml(String(run.eventCount || events.length || 0))} 条事件${nextAction ? `；${escapeHtml(nextAction)}` : ""}</p>
      ${run.rawPreview ? `<p><strong>原始线索：</strong>${escapeHtml(limitText(run.rawPreview, 96))}</p>` : ""}
      <div class="agent-run-detail-grid">
        ${steps.slice(0, 4).map((step) => `
          <div>
            <strong>${escapeHtml(step.agent || "Agent")}：${escapeHtml(getAgentStatusLabel(step.status || "done"))}</strong>
            <small>${escapeHtml((step.evidence || []).map(getEvidenceLabel).join("、") || "无依据字段")}</small>
            <span>${escapeHtml(limitText(step.output || "已完成。", 72))}</span>
          </div>
        `).join("")}
      </div>
      ${eventLabels ? `<p><strong>最近事件：</strong>${escapeHtml(eventLabels)}</p>` : ""}
    </div>
  `;
}

async function deleteMemory(id) {
  const memory = memories.find((item) => item.id === id);
  if (!memory) return;
  if (!confirm(`确定删除《${memory.title}》吗？`)) return;

  setPersistencePending(true);
  try {
    await deleteMemoryFromDatabase(id);
    databaseAvailable = true;
    setStorageStatus(`数据库已删除：《${memory.title}》已从 SQLite 移除。`, "success");
  } catch (error) {
    databaseAvailable = false;
    setStorageStatus(`数据库删除失败：已只删除本地备份。原因：${error.message}`, "warning");
  } finally {
    const nextMemories = memories.filter((item) => item.id !== id);
    if (saveMemories(nextMemories)) memories = nextMemories;
    if (databaseAvailable) await syncWorkflowBlueprint({ quiet: true });
    if (databaseAvailable) await syncPrivacyPolicy({ quiet: true });
    if (databaseAvailable) await syncVersionInfo({ quiet: true });
    else {
      backendWorkflowBlueprint = null;
      workflowBlueprintSource = "local";
      privacyPolicy = null;
      privacyPolicySource = "local";
      versionInfo = null;
      operationsSource = "local";
    }
    if (editingId === id) resetFormState();
    render();
    setPersistencePending(false);
  }
}

function answerGuideQuestion(type) {
  const list = filteredMemories();
  const presetQuestions = {
    tour: "带我参观当前展厅",
    mood: "总结我的记忆情绪",
    recent: "推荐一件最近展品",
    schema: "查看结构化 JSON"
  };

  elements.guideQuestionInput.value = presetQuestions[type] || "";
  updateGuideAskState();

  if (type === "tour") {
    const hall = halls.find((item) => item.id === activeHall) || halls[0];
    const names = list.slice(0, 4).map((memory) => `《${memory.title}》`).join("、") || "暂无展品";
    renderGuide(`${hall.name}导览：\n\n${hall.description}\n\n当前可以先看 ${names}。你也可以在上方直接提问，讲解员会从 SQLite 中检索候选展品再回答。`);
  }

  if (type === "mood") {
    const counts = list.flatMap((memory) => memory.emotions || []).reduce((map, emotion) => {
      map[emotion] = (map[emotion] || 0) + 1;
      return map;
    }, {});
    const summary = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([emotion, count]) => `${emotion} ${count} 次`).join("，") || "暂无情绪数据";
    const strongest = [...list].sort((a, b) => (b.emotionIntensity || 1) - (a.emotionIntensity || 1))[0];
    const sourceCounts = list.reduce((map, memory) => {
      map[memory.sourceType] = (map[memory.sourceType] || 0) + 1;
      return map;
    }, {});
    const sourceSummary = Object.entries(sourceCounts).sort((a, b) => b[1] - a[1]).map(([source, count]) => `${source} ${count} 件`).join("，") || "暂无来源数据";
    renderGuide(`情绪统计：\n\n${summary}\n\n来源分布：${sourceSummary}\n\n${strongest ? `情绪强度最高的是《${strongest.title}》，强度 ${strongest.emotionIntensity} / 5。` : "暂无强度数据。"}\n\n这些结构化字段现在已经会进入简单 RAG 检索，讲解员会基于召回的候选展品回答。`);
  }

  if (type === "recent") {
    const recent = [...list].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
    renderGuide(recent ? `今日推荐展品：\n\n《${recent.title}》\n${recent.exhibitText}` : "还没有展品可以推荐。");
  }

  if (type === "schema") {
    const sample = list[0] || memories[0];
    renderGuide(sample
      ? `结构化 JSON 样例：\n\n${JSON.stringify(buildStructuredMemory(sample), null, 2)}`
      : "还没有展品可以生成结构化 JSON。");
  }
}

async function handleGuideAsk(event) {
  event.preventDefault();
  if (isGuideAsking) return;

  const question = elements.guideQuestionInput.value.trim();
  if (!question) {
    renderGuide("先写下你想问讲解员的问题。");
    return;
  }

  setGuidePending(true);
  renderGuide("讲解员正在从数据库里检索相关展品...");
  try {
    const result = await askGuide(question);
    const evidence = formatGuideEvidence(result.memories);
    const citations = formatGuideCitations(result.citations);
    const followUps = formatGuideFollowUps(result.followUps);
    const reason = result.reason ? `\n\n回退原因：${result.reason}` : "";
    const evidenceCount = result.memories.length;
    const queryText = result.query ? `\n检索词：${result.query}` : "";
    const retrievalHint = result.retrievalMode === "recent-fallback" ? "（未命中关键词，已回看最近展品）" : "";
    renderGuide(`${result.answer}\n\n候选展品（${evidenceCount} 件）：${evidence}${citations ? `\n引用依据：${citations}` : ""}${followUps ? `\n可继续追问：\n${followUps}` : ""}${queryText}\n检索模式：${result.mode} / ${result.retrievalMode}${retrievalHint}${reason}`);
  } finally {
    setGuidePending(false);
  }
}

async function exportMemories() {
  let payload = buildCollectionExport();
  if (databaseAvailable && !databaseNeedsMigration) {
    try {
      payload = {
        ...await requestJson(`${API_MEMORIES}/export`),
        ...buildPhase15AssetExportReview()
      };
      setStorageStatus("已从 SQLite 导出数据库备份。", "success");
    } catch (error) {
      setStorageStatus(`数据库导出失败：已导出浏览器本地备份。原因：${error.message}`, "warning");
    }
  } else if (databaseNeedsMigration) {
    setStorageStatus("当前还有本地备份未迁移：已先导出页面中的本地数据。", "warning");
  }

  if (!confirmExportPackageRisk(payload)) return;
  recordAssetAuditEvent({
    action: "full-export",
    label: "导出完整记忆博物馆包",
    detail: `${memories.length} 件展品，${buildAssetPackageItems().length} 个专题资产`
  });
  captureAssetSnapshot("完整导出");
  payload = {
    ...payload,
    phase16Sync: buildPhase16SyncManifest(memories, { exportedAt: payload.exportedAt || new Date().toISOString() }),
    ...buildPhase15AssetExportReview()
  };
  downloadJsonPayload(payload, `memory-museum-${new Date().toISOString().slice(0, 10)}.json`);
}

function downloadJsonPayload(payload, filename) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function exportRedactedMemories() {
  let payload = buildRedactedCollectionExport();
  if (databaseAvailable && !databaseNeedsMigration) {
    try {
      payload = await requestJson(`${API_MEMORIES}/export?mode=redacted`);
      setStorageStatus("已从 SQLite 导出脱敏同步包。", "success");
    } catch (error) {
      setStorageStatus(`数据库脱敏导出失败：已导出浏览器本地脱敏包。原因：${error.message}`, "warning");
    }
  }
  payload = {
    ...payload,
    phase16Sync: buildPhase16SyncManifest((payload.memories || []).map(normalizeMemory), { exportedAt: payload.exportedAt || new Date().toISOString() }),
    phase17SyncAdapter: buildPhase17SyncAdapter((payload.memories || []).map(normalizeMemory), { exportedAt: payload.exportedAt || new Date().toISOString() })
  };
  downloadJsonPayload(payload, `memory-museum-redacted-${new Date().toISOString().slice(0, 10)}.json`);
}

function confirmExportPackageRisk(payload) {
  const sensitivity = payload.privacyPolicy?.sensitiveData || payload.phase12Sovereignty?.sensitivity;
  const assetQuality = payload.phase15AssetQuality || buildAssetQualitySummary(getAssetCollection());
  const repairSuggestions = payload.phase15RepairSuggestions || buildAssetRepairSuggestions(getAssetCollection());
  const warnings = [];
  if (sensitivity && sensitivity.riskLevel !== "none") {
    warnings.push(`导出包敏感线索风险：${sensitivity.riskLevel}`);
    warnings.push(sensitivity.recommendation || "请确认导出包保存位置可信。");
  }
  if (assetQuality.totalIssues) {
    warnings.push(`专题资产还有 ${assetQuality.totalIssues} 个质量缺口。`);
    warnings.push(repairSuggestions.slice(0, 3).map((item) => `${item.type}《${item.title}》：${item.detail}`).join("\n"));
  }
  if (!warnings.length) return true;
  warnings.push("当前导出包未加密，会包含展品文本、结构化字段、洞察、工作流蓝图和专题资产信息。");
  return confirm(warnings.filter(Boolean).join("\n\n"));
}

function getMemorySyncChecksum(memory) {
  const structured = buildStructuredMemory(normalizeMemory(memory));
  return simpleChecksum(stableStringify({
    title: structured.title,
    hall: structured.hall?.id || structured.hall,
    rawContent: structured.rawContent,
    exhibitText: structured.exhibitText,
    date: structured.date,
    location: structured.location,
    people: structured.people,
    emotions: structured.emotions,
    tags: structured.tags,
    importance: structured.importance,
    attachments: structured.attachments
  }));
}

function compareMemoryVersion(imported, existing) {
  const importedTime = new Date(imported.updatedAt || imported.createdAt || 0).getTime() || 0;
  const existingTime = new Date(existing.updatedAt || existing.createdAt || 0).getTime() || 0;
  if (importedTime > existingTime) return "update";
  if (importedTime < existingTime) return "skip";
  return "conflict";
}

function getPhase16DefaultDecision(action) {
  if (action === "conflict") return "copy";
  if (action === "update") return "update";
  if (action === "create") return "create";
  return "skip";
}

function getPhase16Decision(entry) {
  return entry.decision || getPhase16DefaultDecision(entry.action);
}

function getPhase16DecisionLabel(decision) {
  const labels = {
    create: "新增写入",
    update: "导入覆盖",
    copy: "复制为新展品",
    "keep-local": "保留本地",
    skip: "跳过"
  };
  return labels[decision] || decision;
}

function summarizePhase16ImportPlan(plan) {
  const summary = { create: 0, update: 0, copy: 0, skip: 0, keepLocal: 0, conflict: 0, write: 0 };
  (plan?.entries || []).forEach((entry) => {
    const decision = getPhase16Decision(entry);
    if (entry.action === "conflict") summary.conflict += 1;
    if (decision === "create") summary.create += 1;
    if (decision === "update") summary.update += 1;
    if (decision === "copy") summary.copy += 1;
    if (decision === "keep-local") summary.keepLocal += 1;
    if (decision === "skip") summary.skip += 1;
    if (["create", "update", "copy"].includes(decision)) summary.write += 1;
  });
  return summary;
}

function buildPhase16DiffLabels(entry) {
  if (!entry.existing) return ["本地无同 ID 展品"];
  const imported = entry.memory;
  const existing = entry.existing;
  const checks = [
    ["标题", imported.title, existing.title],
    ["展厅", getHallName(imported.hall), getHallName(existing.hall)],
    ["日期", imported.date, existing.date],
    ["情绪", (imported.emotions || []).join(" / "), (existing.emotions || []).join(" / ")],
    ["标签", (imported.tags || []).join(" / "), (existing.tags || []).join(" / ")],
    ["珍藏级别", getImportanceLabel(imported.importance), getImportanceLabel(existing.importance)],
    ["附件", String((imported.attachments || []).length), String((existing.attachments || []).length)]
  ];
  return checks
    .filter(([, importedValue, existingValue]) => String(importedValue || "") !== String(existingValue || ""))
    .slice(0, 4)
    .map(([label, importedValue, existingValue]) => `${label}：本地 ${existingValue || "空"} → 导入 ${importedValue || "空"}`);
}

function renderPhase16DecisionControl(entry, index) {
  const decision = getPhase16Decision(entry);
  if (entry.action === "conflict") {
    return `
      <select data-phase16-decision="${index}" aria-label="冲突处理方式">
        <option value="copy" ${decision === "copy" ? "selected" : ""}>复制为新展品</option>
        <option value="keep-local" ${decision === "keep-local" ? "selected" : ""}>保留本地</option>
        <option value="update" ${decision === "update" ? "selected" : ""}>使用导入覆盖</option>
      </select>
    `;
  }
  if (entry.action === "update") {
    return `
      <select data-phase16-decision="${index}" aria-label="更新处理方式">
        <option value="update" ${decision === "update" ? "selected" : ""}>使用导入覆盖</option>
        <option value="keep-local" ${decision === "keep-local" ? "selected" : ""}>保留本地</option>
        <option value="copy" ${decision === "copy" ? "selected" : ""}>复制为新展品</option>
      </select>
    `;
  }
  if (entry.action === "create") {
    return `
      <select data-phase16-decision="${index}" aria-label="新增处理方式">
        <option value="create" ${decision === "create" ? "selected" : ""}>新增写入</option>
        <option value="skip" ${decision === "skip" ? "selected" : ""}>跳过</option>
      </select>
    `;
  }
  return `<span class="phase16-decision-static">${escapeHtml(getPhase16DecisionLabel(decision))}</span>`;
}

function renderPhase16SyncAudit() {
  const allAudit = loadPhase16SyncAudit();
  const audit = filterPhase16SyncAudit(allAudit).slice(0, 5);
  const filters = [
    ["all", "全部"],
    ["export", "导出"],
    ["preview", "预览"],
    ["drill", "演练"],
    ["apply", "导入"],
    ["cancel", "取消"]
  ];
  const filterBar = `
    <div class="phase16-audit-filters">
      ${filters.map(([id, label]) => `<button type="button" data-phase16-audit-filter="${id}" data-active="${phase16AuditFilter === id}">${label}</button>`).join("")}
    </div>
  `;
  if (!allAudit.length) return `${filterBar}<small>还没有同步记录。导出、预览、演练报告、确认导入都会写入这里。</small>`;
  if (!audit.length) return `${filterBar}<small>当前筛选下没有同步记录。</small>`;
  return `${filterBar}${audit.map((entry) => `
    <div class="phase16-audit-row">
      <span>${escapeHtml(entry.label)}</span>
      <small>${escapeHtml(formatDate(entry.at))} / ${escapeHtml(entry.batchId || localProfile.deviceLabel)}</small>
      <small>${escapeHtml(entry.detail || "")}</small>
    </div>
  `).join("")}`;
}

function renderPhase17SyncAdapterPanel() {
  const adapter = buildPhase17SyncAdapter(memories);
  return `
    <div class="phase17-adapter-panel">
      <div class="phase17-adapter-heading">
        <div>
          <span>Phase 17 Adapter</span>
          <strong>真实多设备同步适配层</strong>
        </div>
        <small>${escapeHtml(adapter.deviceRegistry.deviceCount)} 台设备 / ${escapeHtml(adapter.queue.pending)} 个待处理任务</small>
      </div>
      <div class="phase17-device-strip">
        ${adapter.deviceRegistry.devices.map((device) => `
          <span data-device-status="${escapeHtml(device.status || "trusted")}">
            <b>${escapeHtml(device.label || "未命名设备")}</b>
            <small>${escapeHtml(device.trustLevel || device.status || "trusted")} / ${escapeHtml(device.role || "device")} / ${escapeHtml(device.syncMode || "manual-json")}</small>
            ${device.id !== localProfile.deviceId ? `
              <em>${escapeHtml(device.note || "需要人工确认设备来源。")}</em>
              <div class="phase17-device-actions">
                <button type="button" data-phase17-device-trust="trusted" data-phase17-device-id="${escapeHtml(device.id)}">信任</button>
                <button type="button" data-phase17-device-trust="review" data-phase17-device-id="${escapeHtml(device.id)}">复核</button>
                <button type="button" data-phase17-device-trust="blocked" data-phase17-device-id="${escapeHtml(device.id)}">阻止</button>
              </div>
            ` : ""}
          </span>
        `).join("")}
      </div>
      <div class="phase17-trust-policy">
        <div>
          <strong>设备信任策略</strong>
          <small>可信 ${escapeHtml(adapter.deviceTrustPolicy.trusted)} / 待复核 ${escapeHtml(adapter.deviceTrustPolicy.review)} / 已阻止 ${escapeHtml(adapter.deviceTrustPolicy.blocked)}</small>
          <button type="button" data-phase17-add-review-device>登记待复核设备</button>
        </div>
        ${adapter.deviceTrustPolicy.rules.map((rule) => `<small>${escapeHtml(rule)}</small>`).join("")}
      </div>
      <div class="phase17-adapter-grid">
        ${adapter.adapters.map((item) => `
          <div data-adapter-status="${escapeHtml(item.status)}">
            <strong>${escapeHtml(item.label)}</strong>
            <small>${escapeHtml(item.detail)}</small>
          </div>
        `).join("")}
      </div>
      <div class="phase17-lan-panel" data-lan-status="${escapeHtml(adapter.lanHandshake.status)}">
        <div>
          <strong>局域网只读握手模拟</strong>
          <small>${escapeHtml(adapter.lanHandshake.mode)} / 指纹 ${escapeHtml(adapter.lanHandshake.localFingerprint)}</small>
        </div>
        <div class="phase17-check-row">
          ${adapter.lanHandshake.checks.map((item) => `
            <span data-check-status="${escapeHtml(item.status)}">
              <b>${escapeHtml(item.label)}</b>
              <small>${escapeHtml(item.detail)}</small>
            </span>
          `).join("")}
        </div>
        <small>${adapter.lanHandshake.peerCandidates.length ? `发现 ${escapeHtml(adapter.lanHandshake.peerCandidates.length)} 个历史设备候选，仍需人工确认。` : "暂无其他历史设备候选；当前只保留本机握手指纹。"}</small>
      </div>
      <div class="phase17-cloud-panel" data-cloud-status="${escapeHtml(adapter.privateCloudBoundary.status)}">
        <div>
          <strong>私有云适配边界</strong>
          <small>${escapeHtml(adapter.privateCloudBoundary.provider)} / ${escapeHtml(adapter.privateCloudBoundary.policy)}</small>
          <button type="button" data-phase17-cloud-draft>生成配置草案</button>
          <button type="button" data-phase17-cloud-clear>清除草案</button>
        </div>
        <div class="phase17-check-row">
          ${adapter.privateCloudBoundary.checks.map((item) => `
            <span data-check-status="${escapeHtml(item.status)}">
              <b>${escapeHtml(item.label)}</b>
              <small>${escapeHtml(item.detail)}</small>
            </span>
          `).join("")}
        </div>
        <small>当前状态：${escapeHtml(adapter.privateCloudBoundary.status)}；不会连接 WebDAV、S3 或自托管 API。</small>
      </div>
      <div class="phase17-health-panel" data-health-status="${escapeHtml(adapter.syncHealth.status)}">
        <div>
          <strong>同步健康度</strong>
          <small>${escapeHtml(adapter.syncHealth.score)} 分 / ${escapeHtml(adapter.syncHealth.recommendation)}</small>
        </div>
        <div class="phase17-health-grid">
          ${adapter.syncHealth.checks.map((item) => `
            <span data-health-check="${escapeHtml(item.status)}">
              <b>${escapeHtml(item.label)}</b>
              <small>${escapeHtml(item.detail)}</small>
            </span>
          `).join("")}
        </div>
        <div class="phase17-maintenance-panel">
          <strong>健康度解释</strong>
          <small>${escapeHtml(adapter.healthExplanation.summary)}</small>
          ${adapter.healthExplanation.reasons.length ? adapter.healthExplanation.reasons.map((item) => `
            <span><b>${escapeHtml(item.label)}</b><small>${escapeHtml(item.impact)}</small></span>
          `).join("") : "<small>暂无扣分项。</small>"}
        </div>
      </div>
      <div class="phase17-queue-panel">
        <div>
          <strong>同步队列</strong>
          <small>待处理 ${escapeHtml(adapter.queue.pending)} / 失败 ${escapeHtml(adapter.queue.failures)} / 已完成 ${escapeHtml(adapter.queue.resolved)}</small>
          <button type="button" data-phase17-queue-sync>加入一次手动同步任务</button>
        </div>
        <div class="phase17-recovery-panel">
          <strong>失败恢复建议</strong>
          <small>${escapeHtml(adapter.failureRecovery.recommendation)}</small>
          ${adapter.failureRecovery.actions.length ? adapter.failureRecovery.actions.map((item) => `
            <span><b>${escapeHtml(item.label)}</b><small>${escapeHtml(item.action)}</small></span>
          `).join("") : "<small>暂无失败任务需要恢复。</small>"}
        </div>
        ${adapter.queue.recent.length ? adapter.queue.recent.map((item) => `
          <div class="phase17-queue-row" data-queue-status="${escapeHtml(item.status)}">
            <span>${escapeHtml(item.label)}</span>
            <small>${escapeHtml(getPhase17QueueStatusLabel(item.status))} / ${escapeHtml(item.channel)} / ${escapeHtml(formatDate(item.updatedAt || item.createdAt))}</small>
            <small>${escapeHtml(item.detail || "")}</small>
            ${getPhase17QueueNextActions(item.status).length ? `
              <div class="phase17-queue-actions">
                ${getPhase17QueueNextActions(item.status).map((action) => `
                  <button type="button" data-phase17-queue-status="${escapeHtml(action.status)}" data-phase17-queue-id="${escapeHtml(item.id)}">${escapeHtml(action.label)}</button>
                `).join("")}
              </div>
            ` : ""}
          </div>
        `).join("") : "<small>当前还没有待处理同步任务。</small>"}
      </div>
      <div class="phase17-phase18-advisory" data-advisory-status="${escapeHtml(adapter.phase18SyncAdvisory.readiness)}">
        <strong>第十八阶段资产同步提示</strong>
        <small>专题展 ${escapeHtml(adapter.phase18SyncAdvisory.exhibitions)} / 报告 ${escapeHtml(adapter.phase18SyncAdvisory.reports)} / 活跃长期任务 ${escapeHtml(adapter.phase18SyncAdvisory.activePhase18Tasks)}</small>
        <small>可入包 ${escapeHtml(adapter.phase18SyncAdvisory.packageCandidates || 0)} / 已发布 ${escapeHtml(adapter.phase18SyncAdvisory.readyAssets || 0)} / 风险资产 ${escapeHtml(adapter.phase18SyncAdvisory.riskAssets || 0)}</small>
        <small>${escapeHtml(adapter.phase18SyncAdvisory.recommendation)}</small>
      </div>
      <small>第十七阶段第六版仍坚持本地优先：不自动上传、不自动发现设备，也不绕过第十六阶段风险确认。</small>
    </div>
  `;
}

function countPhase16PayloadAssets(payload = {}) {
  return {
    savedExhibitions: Array.isArray(payload.savedExhibitions) ? payload.savedExhibitions.length : 0,
    reportDrafts: Array.isArray(payload.reportDrafts) ? payload.reportDrafts.length : 0,
    auditRecords: Array.isArray(payload.phase15AssetAuditLog) ? payload.phase15AssetAuditLog.length : 0,
    snapshots: Array.isArray(payload.phase15AssetSnapshots) ? payload.phase15AssetSnapshots.length : 0
  };
}

function buildPhase16AssetBoundary(payload = {}) {
  const counts = countPhase16PayloadAssets(payload);
  const totalAssets = counts.savedExhibitions + counts.reportDrafts;
  return {
    counts,
    totalAssets,
    status: totalAssets > 0 ? "review" : "clear",
    policy: "memory-first-assets-preview",
    note: totalAssets > 0
      ? "同步包包含专题展或报告草稿。本版先同步展品，专题资产只进入边界提示和发布元数据恢复，不会静默合并到当前资产库。"
      : "同步包未发现专题展或报告草稿，可按展品同步流程继续。"
  };
}

function buildPhase16LegacyCompatibility(payload = {}) {
  const sync = payload.phase16Sync || null;
  if (sync?.phase >= 16) {
    return {
      mode: "phase16",
      status: "ready",
      label: "第十六阶段同步包",
      note: "同步包包含 phase16Sync，可使用逐项决策、质量检查和恢复演练。"
    };
  }
  const phase = Number(payload.phase || payload.phase12Sovereignty?.phase || payload.privacyPolicy?.phase || 0);
  return {
    mode: phase >= 15 ? "phase15-legacy" : phase >= 12 ? "phase12-legacy" : "legacy-json",
    status: "review",
    label: phase ? `旧版阶段 ${phase} 备份包` : "旧版 JSON 备份包",
    note: "未发现 phase16Sync。本版会按旧备份兼容模式导入展品，并建议先导出演练报告留档。"
  };
}

function buildPhase16AssetMergePreview(payload = {}) {
  const exhibitions = Array.isArray(payload.savedExhibitions) ? payload.savedExhibitions : [];
  const reports = Array.isArray(payload.reportDrafts) ? payload.reportDrafts : [];
  const current = getAssetCollection();
  const localExhibitionIds = new Set((current.savedExhibitions || []).map((item) => item.id));
  const localReportIds = new Set((current.reportDrafts || []).map((item) => item.id));
  const entries = [
    ...exhibitions.map((asset, index) => ({
      id: asset.id || `imported-exhibition-${index}`,
      type: "exhibition",
      title: asset.title || "未命名专题展",
      status: localExhibitionIds.has(asset.id) ? "conflict" : "new",
      decision: "skip",
      reason: localExhibitionIds.has(asset.id) ? "本地已有同 ID 专题展" : "本地没有同 ID 专题展"
    })),
    ...reports.map((asset, index) => ({
      id: asset.id || `imported-report-${index}`,
      type: "report",
      title: asset.title || "未命名报告草稿",
      status: localReportIds.has(asset.id) ? "conflict" : "new",
      decision: "skip",
      reason: localReportIds.has(asset.id) ? "本地已有同 ID 报告草稿" : "本地没有同 ID 报告草稿"
    }))
  ];
  return {
    entries,
    summary: {
      total: entries.length,
      exhibitions: exhibitions.length,
      reports: reports.length,
      conflicts: entries.filter((entry) => entry.status === "conflict").length
    },
    policy: "preview-only-no-silent-merge"
  };
}

function buildPhase16SyncPackageQuality(payload = {}, normalized = []) {
  const warnings = [];
  const blockers = [];
  const sync = payload.phase16Sync || {};
  const legacy = buildPhase16LegacyCompatibility(payload);
  if (!sync.phase) warnings.push("未发现 phase16Sync 元数据，已进入旧备份兼容模式。");
  if (sync.phase && Number(sync.phase) < 16) warnings.push(`同步包阶段较旧：${sync.phase}`);
  if (sync.mode && sync.mode !== "manual-json-local-first") warnings.push(`同步模式不是当前默认模式：${sync.mode}`);
  if (!payload.app) warnings.push("同步包缺少 app 来源字段。");
  if (!normalized.length) blockers.push("同步包没有可导入展品。");
  const ids = normalized.map((memory) => memory.id);
  const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
  const missingTime = normalized.filter((memory) => !memory.updatedAt && !memory.createdAt).length;
  const missingContent = normalized.filter((memory) => !memory.rawContent && !memory.exhibitText).length;
  if (duplicateIds.length) warnings.push(`同步包内有 ${new Set(duplicateIds).size} 个重复 ID，会按新展品处理重复项。`);
  if (missingTime) warnings.push(`${missingTime} 件展品缺少更新时间，冲突判断会更保守。`);
  if (missingContent) warnings.push(`${missingContent} 件展品缺少正文或展品说明。`);
  const assetBoundary = buildPhase16AssetBoundary(payload);
  if (assetBoundary.totalAssets) warnings.push(`同步包包含 ${assetBoundary.totalAssets} 个专题资产，本版不会静默合并这些资产。`);
  const score = Math.max(0, 100 - warnings.length * 12 - blockers.length * 35);
  return {
    status: blockers.length ? "blocked" : warnings.length ? "review" : "ready",
    score,
    warnings,
    blockers,
    checks: [
      { label: "phase16Sync 元数据", status: sync.phase ? "ready" : "review" },
      { label: "展品数组", status: normalized.length ? "ready" : "blocked" },
      { label: "重复 ID", status: duplicateIds.length ? "review" : "ready" },
      { label: "时间戳", status: missingTime ? "review" : "ready" },
      { label: "旧包兼容", status: legacy.mode === "phase16" ? "ready" : "review" },
      { label: "专题资产边界", status: assetBoundary.totalAssets ? "review" : "ready" }
    ],
    assetBoundary,
    legacy
  };
}

function renderPhase16QualityPanel(plan) {
  const quality = plan?.quality;
  if (!quality) return "";
  const notes = [...(quality.blockers || []), ...(quality.warnings || [])].slice(0, 4);
  return `
    <div class="phase16-quality-panel" data-quality-status="${escapeHtml(quality.status)}">
      <div>
        <strong>同步包质量检查</strong>
        <span>${escapeHtml(quality.status)} / ${escapeHtml(quality.score)} 分</span>
      </div>
      <div class="phase16-quality-grid">
        ${(quality.checks || []).map((item) => `<small data-quality-status="${escapeHtml(item.status)}">${escapeHtml(item.label)}</small>`).join("")}
      </div>
      ${notes.length ? `<p>${notes.map(escapeHtml).join("；")}</p>` : "<p>同步包结构完整，可以继续做恢复演练或确认导入。</p>"}
    </div>
  `;
}

function renderPhase16AssetBoundary(boundary) {
  if (!boundary) return "";
  return `
    <div class="phase16-boundary-panel" data-boundary-status="${escapeHtml(boundary.status)}">
      <strong>专题资产同步边界</strong>
      <div>
        <span>专题展 ${escapeHtml(boundary.counts.savedExhibitions)}</span>
        <span>报告草稿 ${escapeHtml(boundary.counts.reportDrafts)}</span>
        <span>审计 ${escapeHtml(boundary.counts.auditRecords)}</span>
        <span>快照 ${escapeHtml(boundary.counts.snapshots)}</span>
      </div>
      <small>${escapeHtml(boundary.note)}</small>
    </div>
  `;
}

function renderPhase16LegacyCompatibility(legacy) {
  if (!legacy) return "";
  return `
    <div class="phase16-legacy-panel" data-legacy-status="${escapeHtml(legacy.status)}">
      <strong>${escapeHtml(legacy.label)}</strong>
      <small>${escapeHtml(legacy.note)}</small>
    </div>
  `;
}

function getPhase16AssetDecisionLabel(decision) {
  const labels = {
    skip: "暂不合并",
    import: "标记为待合并",
    replace: "标记为替换本地"
  };
  return labels[decision] || decision;
}

function renderPhase16AssetDecisionControl(entry, index) {
  return `
    <select data-phase16-asset-decision="${index}" aria-label="专题资产合并方式">
      <option value="skip" ${entry.decision === "skip" ? "selected" : ""}>暂不合并</option>
      <option value="import" ${entry.decision === "import" ? "selected" : ""}>标记为待合并</option>
      <option value="replace" ${entry.decision === "replace" ? "selected" : ""}>标记为替换本地</option>
    </select>
  `;
}

function renderPhase16AssetMergePreview(preview) {
  if (!preview?.entries?.length) return "";
  return `
    <div class="phase16-asset-merge-panel">
      <div>
        <strong>专题资产逐项合并预览</strong>
        <small>${preview.summary.exhibitions} 个专题展 / ${preview.summary.reports} 个报告草稿 / ${preview.summary.conflicts} 个同 ID 冲突</small>
      </div>
      <small>第五版先保存合并决策和演练报告，不会静默写入专题资产库。</small>
      ${preview.entries.slice(0, 8).map((entry, index) => `
        <div class="phase16-asset-merge-row" data-asset-sync-status="${escapeHtml(entry.status)}">
          <span>${escapeHtml(entry.type === "report" ? "报告" : "专题展")}</span>
          <b>${escapeHtml(entry.title)}</b>
          <small>${escapeHtml(entry.reason)} / 当前：${escapeHtml(getPhase16AssetDecisionLabel(entry.decision))}</small>
          ${renderPhase16AssetDecisionControl(entry, index)}
        </div>
      `).join("")}
      ${preview.entries.length > 8 ? `<small>还有 ${preview.entries.length - 8} 个专题资产未展开。</small>` : ""}
    </div>
  `;
}

function renderPhase16RecoveryDrill(plan, summary) {
  if (!plan) return "";
  const quality = plan.quality || {};
  return `
    <div class="phase16-drill-panel">
      <strong>恢复演练报告</strong>
      <small>本次预演不会写入数据：预计写入 ${summary.write || 0} 件，覆盖 ${summary.update || 0} 件，复制 ${summary.copy || 0} 件，保留或跳过 ${(summary.skip || 0) + (summary.keepLocal || 0)} 件；质量状态 ${escapeHtml(quality.status || "unknown")}。</small>
      <button type="button" data-phase16-export-drill-report>导出演练报告</button>
    </div>
  `;
}

function exportPhase16RecoveryReport() {
  if (!pendingSyncImportPlan) return;
  const summary = summarizePhase16ImportPlan(pendingSyncImportPlan);
  const payload = {
    app: "AI 记忆博物馆",
    phase: 16,
    exportMode: "phase16-recovery-drill-report",
    generatedAt: new Date().toISOString(),
    source: pendingSyncImportPlan.source,
    quality: pendingSyncImportPlan.quality,
    assetBoundary: pendingSyncImportPlan.assetBoundary,
    legacyCompatibility: pendingSyncImportPlan.legacyCompatibility,
    assetMergePreview: pendingSyncImportPlan.assetMergePreview,
    summary,
    entries: pendingSyncImportPlan.entries.map((entry) => ({
      id: entry.memory.id,
      title: entry.memory.title,
      action: entry.action,
      decision: getPhase16Decision(entry),
      reason: entry.reason,
      diffs: buildPhase16DiffLabels(entry)
    }))
  };
  downloadJsonPayload(payload, `memory-museum-recovery-drill-${new Date().toISOString().slice(0, 10)}.json`);
  recordPhase16SyncAuditEvent({
    action: "drill-export",
    label: "导出恢复演练报告",
    detail: `预演写入 ${summary.write} 件；质量 ${pendingSyncImportPlan.quality?.status || "unknown"}`,
    batchId: pendingSyncImportPlan.source.batchId,
    summary
  });
  enqueuePhase17SyncTask({
    action: "recovery-drill",
    label: "恢复演练报告已生成",
    detail: `${pendingSyncImportPlan.source.batchId || "未知批次"} 进入跨设备同步前复核队列。`
  });
  renderPhase16SyncPanel();
}

function buildPhase16ImportPlan(payload = {}) {
  const imported = Array.isArray(payload) ? payload : payload.memories;
  if (!Array.isArray(imported)) throw new Error("导入文件里没有 memories 数组。");
  const normalized = imported.map(normalizeMemory);
  const quality = buildPhase16SyncPackageQuality(payload, normalized);
  const assetBoundary = quality.assetBoundary;
  const legacyCompatibility = quality.legacy;
  const assetMergePreview = buildPhase16AssetMergePreview(payload);
  const currentById = new Map(memories.map((memory) => [memory.id, memory]));
  const seenIncoming = new Set();
  const entries = normalized.map((memory, index) => {
    const existing = currentById.get(memory.id);
    const incomingDuplicate = seenIncoming.has(memory.id);
    seenIncoming.add(memory.id);
    const baseEntry = { id: `sync-entry-${index}-${memory.id}`, memory, existing, duplicateId: incomingDuplicate };
    if (!existing || incomingDuplicate) {
      return { ...baseEntry, action: "create", decision: "create", reason: incomingDuplicate ? "导入包内 ID 重复，作为新展品写入" : "本地没有同 ID 展品" };
    }
    const same = getMemorySyncChecksum(memory) === getMemorySyncChecksum(existing);
    if (same) return { ...baseEntry, action: "skip", decision: "skip", reason: "内容一致" };
    const versionAction = compareMemoryVersion(memory, existing);
    if (versionAction === "update") return { ...baseEntry, action: "update", decision: "update", reason: "导入版本较新" };
    if (versionAction === "skip") return { ...baseEntry, action: "skip", decision: "skip", reason: "本地版本较新" };
    return { ...baseEntry, action: "conflict", decision: "copy", reason: "同 ID 内容不同且时间相同" };
  });
  const summary = entries.reduce((result, entry) => {
    result[entry.action] = (result[entry.action] || 0) + 1;
    return result;
  }, { create: 0, update: 0, conflict: 0, skip: 0 });
  return {
    id: `phase16-import-${Date.now()}`,
    createdAt: new Date().toISOString(),
    source: {
      app: payload.app || "未知来源",
      batchId: payload.phase16Sync?.batchId || "",
      deviceLabel: payload.phase16Sync?.device?.label || "",
      exportedAt: payload.exportedAt || payload.phase16Sync?.exportedAt || ""
    },
    payload,
    entries,
    summary,
    decisionSummary: summarizePhase16ImportPlan({ entries }),
    quality,
    assetBoundary,
    legacyCompatibility,
    assetMergePreview,
    total: entries.length
  };
}

function renderPhase16SyncPanel() {
  if (!elements.phase16SyncPanel) return;
  const plan = pendingSyncImportPlan;
  const summary = plan ? summarizePhase16ImportPlan(plan) : { create: 0, update: 0, copy: 0, skip: 0, keepLocal: 0, conflict: 0, write: 0 };
  const sourceSummary = plan?.summary || { create: 0, update: 0, conflict: 0, skip: 0 };
  elements.phase16SyncPanel.innerHTML = `
    <div class="phase16-sync-heading">
      <div>
        <span>Phase 16 Sync</span>
        <strong>手动同步包、逐项决策与同步审计</strong>
      </div>
      <small>${escapeHtml(localProfile.deviceLabel)} / ${escapeHtml(localProfile.deviceId.slice(0, 12))}</small>
    </div>
    <div class="phase16-sync-actions">
      <button type="button" data-phase16-export-sync>导出同步包</button>
      <span>导入 JSON 文件会先生成预览；冲突和更新都可以逐项选择，不会静默覆盖本地数据。</span>
    </div>
    <div class="phase16-sync-grid">
      <span><b>${memories.length}</b><small>本地展品</small></span>
      <span><b>${summary.create || 0}</b><small>新增写入</small></span>
      <span><b>${summary.update || 0}</b><small>导入覆盖</small></span>
      <span><b>${summary.copy || 0}</b><small>复制新展品</small></span>
      <span><b>${(summary.skip || 0) + (summary.keepLocal || 0)}</b><small>不写入</small></span>
    </div>
    ${plan ? `
      <div class="phase16-import-preview">
        <strong>${escapeHtml(plan.source.batchId || "导入预览")}</strong>
        <small>${escapeHtml(plan.source.deviceLabel || "未知设备")} / ${escapeHtml(formatDate(plan.source.exportedAt) || "未知时间")} / 原始判断：新增 ${sourceSummary.create || 0}，更新 ${sourceSummary.update || 0}，冲突 ${sourceSummary.conflict || 0}，跳过 ${sourceSummary.skip || 0}</small>
        ${renderPhase16QualityPanel(plan)}
        ${renderPhase16LegacyCompatibility(plan.legacyCompatibility)}
        ${renderPhase16AssetBoundary(plan.assetBoundary)}
        ${renderPhase16RecoveryDrill(plan, summary)}
        ${renderPhase16AssetMergePreview(plan.assetMergePreview)}
        <div class="phase16-batch-actions">
          <button type="button" data-phase16-batch-decision="copy">冲突全部复制</button>
          <button type="button" data-phase16-batch-decision="keep-local">冲突全部保留本地</button>
          <button type="button" data-phase16-batch-decision="update">冲突全部导入覆盖</button>
        </div>
        ${plan.entries.slice(0, 10).map((entry, index) => {
          const diffs = buildPhase16DiffLabels(entry);
          return `
          <div class="phase16-import-row" data-sync-action="${escapeHtml(entry.action)}">
            <span>${escapeHtml(entry.action)}</span>
            <b>${escapeHtml(entry.memory.title)}</b>
            <div class="phase16-import-detail">
              <small>${escapeHtml(entry.reason)} / 当前：${escapeHtml(getPhase16DecisionLabel(getPhase16Decision(entry)))}</small>
              ${diffs.length ? `<small>${diffs.map(escapeHtml).join("；")}</small>` : ""}
            </div>
            ${renderPhase16DecisionControl(entry, index)}
          </div>
        `; }).join("")}
        ${plan.entries.length > 10 ? `<small>还有 ${plan.entries.length - 10} 条预览未展开；确认导入时仍会按默认或已选择策略处理。</small>` : ""}
        <div class="phase16-sync-actions">
          <button type="button" data-phase16-apply-import>按当前决策导入 ${summary.write || 0} 件</button>
          <button type="button" data-phase16-cancel-import>取消预览</button>
        </div>
      </div>
    ` : "<small>选择上方“导入”文件后，这里会显示同步预览和冲突处理方式。</small>"}
    <div class="phase16-audit-panel">
      <strong>最近同步记录</strong>
      ${renderPhase16SyncAudit()}
    </div>
    ${renderPhase17SyncAdapterPanel()}
  `;
}

function exportPhase16SyncPackage() {
  const exportedAt = new Date().toISOString();
  const payload = {
    ...buildCollectionExport(),
    exportMode: "phase16-sync-package",
    exportedAt,
    phase16Sync: buildPhase16SyncManifest(memories, { exportedAt })
  };
  downloadJsonPayload(payload, `memory-museum-sync-${new Date().toISOString().slice(0, 10)}.json`);
  recordPhase16SyncAuditEvent({
    action: "export",
    label: "导出同步包",
    detail: `${memories.length} 件展品，${buildAssetPackageItems().length} 个专题资产`,
    batchId: payload.phase16Sync.batchId,
    summary: { itemCount: memories.length, assetCount: buildAssetPackageItems().length }
  });
  enqueuePhase17SyncTask({
    action: "export-sync-package",
    label: "手动同步包待分发",
    detail: `${payload.phase16Sync.batchId} 已生成，可交给其他设备导入。`
  });
  setStorageStatus("已导出第十六阶段手动同步包。", "success");
  renderPhase16SyncPanel();
}

function buildPhase16EntriesToWrite(plan) {
  return (plan?.entries || [])
    .map((entry) => {
      const decision = getPhase16Decision(entry);
      if (["skip", "keep-local"].includes(decision)) return null;
      if (decision === "update") return { ...entry, writeMode: "update", memoryToSave: entry.memory, existingId: entry.existing?.id || entry.memory.id };
      if (decision === "copy") return { ...entry, writeMode: "copy", memoryToSave: { ...entry.memory, id: createId() }, existingId: "" };
      if (decision === "create") {
        const shouldCreateNewId = entry.duplicateId || memories.some((memory) => memory.id === entry.memory.id);
        return { ...entry, writeMode: "create", memoryToSave: shouldCreateNewId ? { ...entry.memory, id: createId() } : entry.memory, existingId: "" };
      }
      return null;
    })
    .filter(Boolean);
}

function confirmPhase16ImportRisk(plan, summary) {
  const quality = plan?.quality || {};
  if (quality.status === "blocked") {
    const blockers = (quality.blockers || []).join("；") || "同步包结构不完整";
    setStorageStatus(`同步包被阻止导入：${blockers}`, "warning");
    renderGuide(`第十六阶段同步已阻止导入。原因：${blockers}。`);
    recordPhase16SyncAuditEvent({
      action: "blocked-import",
      label: "阻止高风险同步导入",
      detail: blockers,
      batchId: plan?.source?.batchId,
      summary
    });
    renderPhase16SyncPanel();
    return false;
  }
  if (quality.status === "review") {
    const warnings = (quality.warnings || []).slice(0, 4).join("\n");
    return confirm(`这个同步包需要复核后再导入：\n\n${warnings || "存在需要人工确认的同步风险。"}\n\n预计写入 ${summary.write} 件，其中覆盖 ${summary.update} 件、复制 ${summary.copy} 件。确认继续吗？`);
  }
  return true;
}

async function applyPhase16ImportPlan() {
  const plan = pendingSyncImportPlan;
  if (!plan) return;
  const summary = summarizePhase16ImportPlan(plan);
  const entriesToWrite = buildPhase16EntriesToWrite(plan);
  if (!entriesToWrite.length) {
    setStorageStatus("同步预览没有需要写入的展品。", "warning");
    recordPhase16SyncAuditEvent({
      action: "apply-empty",
      label: "同步预览未写入",
      detail: "当前决策全部为跳过或保留本地",
      batchId: plan.source.batchId,
      summary
    });
    pendingSyncImportPlan = null;
    renderPhase16SyncPanel();
    return;
  }
  if (!confirmPhase16ImportRisk(plan, summary)) return;
  const restoredPhase15 = Array.isArray(plan.payload) ? { auditCount: 0, snapshotCount: 0 } : restorePhase15AssetMetadata(plan.payload);
  const signatureText = restoredPhase15.signature?.checked ? `，签名${restoredPhase15.signature.ok ? "通过" : "异常"}` : "";
  setPersistencePending(true);
  try {
    const savedItems = [];
    if (databaseAvailable) {
      for (const entry of entriesToWrite) {
        const saved = await saveMemoryToDatabase(entry.memoryToSave, entry.writeMode === "update" ? entry.existingId : "");
        savedItems.push(saved);
      }
      await loadMemoriesFromDatabase({ silent: true });
      await syncWorkflowBlueprint({ quiet: true });
      await syncPrivacyPolicy({ quiet: true });
      await syncVersionInfo({ quiet: true });
      await syncAssetCollection({ quiet: true });
      setStorageStatus(`同步导入完成：新增 ${summary.create}，覆盖 ${summary.update}，复制 ${summary.copy}，不写入 ${summary.skip + summary.keepLocal}${signatureText}。`, "success");
    } else {
      const byId = new Map(memories.map((memory) => [memory.id, memory]));
      entriesToWrite.forEach((entry) => {
        byId.set(entry.memoryToSave.id, normalizeMemory(entry.memoryToSave));
      });
      memories = [...byId.values()].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      persistMemories(memories);
      setStorageStatus(`已导入到浏览器本地备份：新增 ${summary.create}，覆盖 ${summary.update}，复制 ${summary.copy}，不写入 ${summary.skip + summary.keepLocal}${signatureText}。`, "success");
    }
    recordPhase16SyncAuditEvent({
      action: "apply",
      label: "应用同步预览",
      detail: `写入 ${entriesToWrite.length} 件；新增 ${summary.create}，覆盖 ${summary.update}，复制 ${summary.copy}，不写入 ${summary.skip + summary.keepLocal}`,
      batchId: plan.source.batchId,
      summary
    });
    pendingSyncImportPlan = null;
    activeHall = "all";
    searchKeyword = "";
    elements.searchInput.value = "";
    render();
    renderGuide(`第十六阶段同步导入完成。按当前决策写入 ${entriesToWrite.length} 件；复制 ${summary.copy} 件，覆盖 ${summary.update} 件，保留或跳过 ${summary.skip + summary.keepLocal} 件。`);
  } catch (error) {
    setStorageStatus(`同步导入失败：${error.message}`, "warning");
  } finally {
    setPersistencePending(false);
    renderPhase16SyncPanel();
  }
}

function saveLocalProfileFromForm() {
  const saved = persistLocalProfile({
    displayName: elements.profileNameInput.value,
    deviceLabel: elements.profileDeviceInput.value,
    syncPreference: elements.profileSyncSelect.value,
    aiConsent: elements.profileAiConsentInput.checked
  });
  renderPrivacyPanel();
  renderGuide(saved
    ? `本地馆主配置已保存：${localProfile.displayName} / ${localProfile.deviceLabel}。`
    : "本地馆主配置保存失败，可能是浏览器存储不可用。");
}

async function handlePurgeDatabase() {
  const confirmed = confirm("确定清空 SQLite 中的所有展品和 Agent 整理历史吗？建议先导出 JSON 备份。");
  if (!confirmed) return;
  const typed = prompt("请输入 DELETE 确认清空数据库展品。");
  if (typed !== "DELETE") {
    renderGuide("已取消清空数据库。");
    return;
  }

  setPersistencePending(true);
  try {
    const result = await purgeDatabaseMemories();
    memories = [];
    persistMemories([]);
    databaseAvailable = true;
    databaseNeedsMigration = false;
    backendWorkflowBlueprint = null;
    privacyPolicy = null;
    versionInfo = null;
    await syncWorkflowBlueprint({ quiet: true });
    await syncPrivacyPolicy({ quiet: true });
    await syncVersionInfo({ quiet: true });
    setStorageStatus(`数据库已清空：删除 ${result.purge?.memoriesDeleted || 0} 件展品和 ${result.purge?.agentRunsDeleted || 0} 条整理历史。`, "success");
    render();
    renderGuide("数据库展品和整理历史已清空。本地馆主配置仍保留在浏览器中。");
  } catch (error) {
    setStorageStatus(`清空数据库失败：${error.message}`, "warning");
  } finally {
    setPersistencePending(false);
  }
}

function importMemories(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.addEventListener("load", async () => {
    try {
      const parsed = JSON.parse(reader.result);
      pendingSyncImportPlan = buildPhase16ImportPlan(parsed);
      const decisionSummary = summarizePhase16ImportPlan(pendingSyncImportPlan);
      recordPhase16SyncAuditEvent({
        action: "preview",
        label: "生成同步预览",
        detail: `新增 ${decisionSummary.create}，覆盖 ${decisionSummary.update}，复制 ${decisionSummary.copy}，不写入 ${decisionSummary.skip + decisionSummary.keepLocal}；质量 ${pendingSyncImportPlan.quality.status}`,
        batchId: pendingSyncImportPlan.source.batchId,
        summary: decisionSummary
      });
      renderPhase16SyncPanel();
      elements.phase16SyncPanel?.scrollIntoView({ behavior: "smooth", block: "start" });
      setStorageStatus(`已生成同步预览：新增 ${decisionSummary.create}，覆盖 ${decisionSummary.update}，复制 ${decisionSummary.copy}，不写入 ${decisionSummary.skip + decisionSummary.keepLocal}；质量 ${pendingSyncImportPlan.quality.status}。确认后才会写入。`, "success");
      renderGuide("第十六阶段同步预览已生成。请在“数据主权”面板确认导入或取消预览。");
    } catch (error) {
      alert(`导入失败：${error.message}`);
    } finally {
      elements.importFile.value = "";
    }
  });
  reader.readAsText(file, "utf-8");
}

async function syncDatabase() {
  setPersistencePending(true);
  try {
    await loadMemoriesFromDatabase();
    await syncWorkflowBlueprint({ quiet: true });
    await syncPrivacyPolicy({ quiet: true });
    await syncVersionInfo({ quiet: true });
    renderGuide(databaseNeedsMigration
      ? "数据库已经连接，但仍有只在浏览器本地备份中的展品。当前页面已合并显示两边数据；点击“迁移本地”可以把这些展品补写入 SQLite。"
      : "已经从 SQLite 重新同步展品墙。");
  } catch (error) {
    databaseAvailable = false;
    backendWorkflowBlueprint = null;
    workflowBlueprintSource = "local";
    privacyPolicy = null;
    privacyPolicySource = "local";
    versionInfo = null;
    operationsSource = "local";
    setStorageStatus(`同步数据库失败：继续显示浏览器本地备份。原因：${error.message}`, "warning");
  } finally {
    setPersistencePending(false);
  }
}

async function migrateLocalToDatabase() {
  const localMemories = memories.length ? memories : loadMemories();
  if (localMemories.length === 0) {
    renderGuide("本地备份里没有可迁移的展品。");
    return;
  }

  setPersistencePending(true);
  try {
    const result = await migrateCurrentLocalBackup();
    await syncWorkflowBlueprint({ quiet: true });
    await syncPrivacyPolicy({ quiet: true });
    await syncVersionInfo({ quiet: true });
    setStorageStatus(`本地迁移完成：已向 SQLite 写入 ${result.imported} 件展品。`, "success");
    activeHall = "all";
    searchKeyword = "";
    elements.searchInput.value = "";
    render();
    renderGuide(`已经把浏览器本地备份写入 SQLite。当前数据库中可展示 ${memories.length} 件展品。`);
  } catch (error) {
    databaseAvailable = false;
    backendWorkflowBlueprint = null;
    workflowBlueprintSource = "local";
    privacyPolicy = null;
    privacyPolicySource = "local";
    versionInfo = null;
    operationsSource = "local";
    setStorageStatus(`本地迁移失败：${error.message}`, "warning");
  } finally {
    setPersistencePending(false);
  }
}

function bindEvents() {
  document.addEventListener("click", (event) => {
    const featureButton = event.target.closest("[data-feature-target]");
    if (featureButton) {
      setActiveFeaturePanel(featureButton.dataset.featureTarget, featureButton.dataset.featureScrollTo || "");
      return;
    }
    const homeScrollButton = event.target.closest("[data-home-scroll]");
    if (homeScrollButton) {
      scrollHomeTarget(homeScrollButton.dataset.homeScroll);
      return;
    }
    if (event.target.closest("[data-feature-home]")) {
      setActiveFeaturePanel("home", "homeGateway");
    }
  });
  elements.memoryForm.addEventListener("submit", handleSubmit);
  elements.memoryForm.addEventListener("input", renderDraftPreview);
  elements.memoryForm.addEventListener("change", renderDraftPreview);
  elements.guideAskForm.addEventListener("submit", handleGuideAsk);
  elements.guideQuestionInput.addEventListener("input", updateGuideAskState);
  elements.rawContent.addEventListener("input", updateRawCount);
  elements.sampleButton.addEventListener("click", fillSampleMemory);
  elements.mockAiButton.addEventListener("click", handleMockAi);
  elements.useAgentSuggestionButton.addEventListener("click", useAgentSuggestion);
  elements.clearAgentWorkflowButton.addEventListener("click", clearAgentWorkflow);
  elements.agentWorkflow.addEventListener("click", (event) => {
    const reviewButton = event.target.closest("[data-review-field]");
    if (reviewButton) {
      focusReviewField(reviewButton.dataset.reviewField);
      return;
    }
    const confirmReviewButton = event.target.closest("[data-confirm-review]");
    if (confirmReviewButton) {
      confirmAgentReview(confirmReviewButton);
      return;
    }
    const approveButton = event.target.closest("[data-agent-approve-step]");
    if (approveButton) {
      approveAgentStep(approveButton.dataset.agentApproveStep);
      return;
    }
    const rejectButton = event.target.closest("[data-agent-reject-step]");
    if (rejectButton) {
      rejectAgentStep(rejectButton.dataset.agentRejectStep);
      return;
    }
    const retryButton = event.target.closest("[data-agent-retry-step]");
    if (retryButton) retryAgentStep(retryButton.dataset.agentRetryStep);
  });
  [elements.peopleInput, elements.locationInput, elements.tagsInput, elements.exhibitText].forEach((input) => {
    input.addEventListener("input", handleReviewFieldInput);
  });
  elements.memoryDate.addEventListener("change", handleReviewFieldInput);
  elements.resetButton.addEventListener("click", () => {
    resetFormState();
    renderGuide();
  });
  elements.cancelEditButton.addEventListener("click", () => {
    resetFormState();
    render();
  });
  elements.searchInput.addEventListener("input", (event) => {
    searchKeyword = event.target.value.trim();
    renderMemories();
    renderGuide();
    renderInsights();
  });
  elements.themeList.addEventListener("click", (event) => {
    const saveButton = event.target.closest("[data-theme-save]");
    if (saveButton) {
      saveThemeAsExhibition(saveButton.dataset.themeSave || "");
      return;
    }
    const searchButton = event.target.closest("[data-theme-search]");
    if (!searchButton) return;
    searchKeyword = searchButton.dataset.themeSearch || "";
    activeHall = "all";
    emotionFilter = "all";
    elements.searchInput.value = searchKeyword;
    elements.emotionFilterSelect.value = "all";
    render();
    document.getElementById("memoryGrid")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  elements.reportPanel.addEventListener("click", (event) => {
    const button = event.target.closest("[data-report-draft]");
    if (button) saveReportDraftFromInsights();
  });
  elements.phase18AgentPanel?.addEventListener("click", (event) => {
    const openButton = event.target.closest("[data-phase18-open]");
    if (openButton) {
      openMemory(openButton.dataset.phase18Open);
      return;
    }
    if (event.target.closest("[data-phase18-create-review-task]")) {
      const task = createPhase18ReviewDashboardTask();
      renderInsights();
      setStorageStatus(`已生成第十八阶段复盘任务：${task.label}`, "success");
      return;
    }
    if (event.target.closest("[data-phase18-create-digest-task]")) {
      const task = createPhase18DigestTask();
      renderInsights();
      setStorageStatus(`已生成第十八阶段摘要任务：${task.label}`, "success");
      return;
    }
    const noiseToggleButton = event.target.closest("[data-phase18-noise-toggle]");
    if (noiseToggleButton) {
      const key = noiseToggleButton.dataset.phase18NoiseToggle;
      const config = loadPhase18NoiseRuleConfig();
      updatePhase18NoiseRuleSetting(key, !config[key]);
      renderInsights();
      setStorageStatus("第十八阶段降噪规则已更新。", "success");
      return;
    }
    const noiseScoreButton = event.target.closest("[data-phase18-noise-score]");
    if (noiseScoreButton) {
      const config = loadPhase18NoiseRuleConfig();
      const delta = Number(noiseScoreButton.dataset.phase18NoiseScore) || 0;
      updatePhase18NoiseRuleSetting("minVisibleScore", config.minVisibleScore + delta);
      renderInsights();
      setStorageStatus("第十八阶段降噪分数阈值已调整。", "success");
      return;
    }
    if (event.target.closest("[data-phase18-noise-reset]")) {
      resetPhase18NoiseRuleConfig();
      renderInsights();
      setStorageStatus("第十八阶段降噪规则已恢复默认。", "warning");
      return;
    }
    const repairDraftButton = event.target.closest("[data-phase18-repair-draft]");
    if (repairDraftButton) {
      const drafts = queuePhase18RepairDrafts(repairDraftButton.dataset.phase18RepairDraft);
      recordPhase18AgentFeedback("accepted", repairDraftButton.dataset.phase18RepairDraft, repairDraftButton.dataset.phase18Label);
      renderInsights();
      setStorageStatus(drafts.length ? `已生成 ${drafts.length} 条第十八阶段修复草案。` : "没有可生成的修复草案。", drafts.length ? "success" : "warning");
      return;
    }
    const saveReviewButton = event.target.closest("[data-phase18-save-review]");
    if (saveReviewButton) {
      savePhase18PeriodicReviewAsset(saveReviewButton.dataset.phase18SaveReview);
      return;
    }
    const saveReviewReportButton = event.target.closest("[data-phase18-save-review-report]");
    if (saveReviewReportButton) {
      savePhase18PeriodicReviewReport(saveReviewReportButton.dataset.phase18SaveReviewReport);
      return;
    }
    const openReviewAssetButton = event.target.closest("[data-phase18-open-asset]");
    if (openReviewAssetButton) {
      openSavedAsset("exhibition", openReviewAssetButton.dataset.phase18OpenAsset);
      return;
    }
    const openReviewReportButton = event.target.closest("[data-phase18-open-report]");
    if (openReviewReportButton) {
      openSavedAsset("report", openReviewReportButton.dataset.phase18OpenReport);
      return;
    }
    const graphFilterButton = event.target.closest("[data-phase18-graph-filter]");
    if (graphFilterButton) {
      phase18GraphFilter = graphFilterButton.dataset.phase18GraphFilter || "all";
      renderInsights();
      return;
    }
    const applyRepairButton = event.target.closest("[data-phase18-apply-repair]");
    if (applyRepairButton) {
      const applied = applyPhase18RepairDraft(applyRepairButton.dataset.phase18ApplyRepair);
      render();
      setStorageStatus(applied ? "已应用一条第十八阶段修复草案，请继续人工复核字段。" : "修复草案未应用，可能已处理或展品不存在。", applied ? "success" : "warning");
      return;
    }
    if (event.target.closest("[data-phase18-apply-repair-batch]")) {
      const review = buildPhase18RepairBatchReview();
      if (!review.ready) {
        setStorageStatus("当前没有可批量应用的第十八阶段修复草案。", "warning");
        return;
      }
      const confirmed = window.confirm(`即将批量应用 ${review.previewCount} 条修复草案，涉及 ${review.targetCount} 件展品。占位字段仍需要后续人工复核，是否继续？`);
      if (!confirmed) {
        recordPhase18TaskAudit("repair-drafts-batch-cancelled", "preview-drafts", `取消批量应用 ${review.previewCount} 条修复草案。`, {
          previewCount: review.previewCount,
          targetCount: review.targetCount
        });
        renderInsights();
        setStorageStatus("已取消第十八阶段批量应用。", "warning");
        return;
      }
      const applied = applyPhase18RepairDraftBatch();
      render();
      setStorageStatus(applied ? `已批量应用 ${applied} 条第十八阶段修复草案，请继续人工复核。` : "没有修复草案被应用。", applied ? "success" : "warning");
      return;
    }
    if (event.target.closest("[data-phase18-clear-repairs]")) {
      clearPhase18RepairDrafts();
      renderInsights();
      setStorageStatus("已清空第十八阶段修复草案。", "warning");
      return;
    }
    const taskFilterButton = event.target.closest("[data-phase18-task-filter]");
    if (taskFilterButton) {
      phase18TaskFilter = taskFilterButton.dataset.phase18TaskFilter || "active";
      renderInsights();
      return;
    }
    const taskSelect = event.target.closest("[data-phase18-task-select]");
    if (taskSelect) {
      togglePhase18TaskSelection(taskSelect.dataset.phase18TaskSelect, taskSelect.checked);
      renderInsights();
      return;
    }
    if (event.target.closest("[data-phase18-task-select-visible]")) {
      selectVisiblePhase18Tasks();
      renderInsights();
      setStorageStatus("已选择当前列表中的第十八阶段任务。", "success");
      return;
    }
    if (event.target.closest("[data-phase18-task-selection-clear]")) {
      clearPhase18TaskSelection();
      renderInsights();
      setStorageStatus("已清空第十八阶段任务选择。", "warning");
      return;
    }
    const taskBatchStatusButton = event.target.closest("[data-phase18-task-batch-status]");
    if (taskBatchStatusButton) {
      const review = buildPhase18TaskBatchReview();
      const nextStatus = taskBatchStatusButton.dataset.phase18TaskBatchStatus;
      if (!review.canBatch) {
        setStorageStatus("请先选择要批量处理的第十八阶段任务。", "warning");
        return;
      }
      const confirmed = window.confirm(`即将批量更新 ${review.selectedCount} 条长期任务为「${getPhase18TaskStatusLabel(nextStatus)}」，涉及 ${review.memoryCount} 件展品。是否继续？`);
      if (!confirmed) return;
      const result = updatePhase18SelectedTasksStatus(nextStatus);
      renderInsights();
      setStorageStatus(result.changed ? `已批量更新 ${result.changed} 条第十八阶段任务。` : "没有任务状态被更新。", result.changed ? "success" : "warning");
      return;
    }
    if (event.target.closest("[data-phase18-task-batch-repair]")) {
      const review = buildPhase18TaskBatchReview();
      if (!review.draftableCount) {
        setStorageStatus("当前选择的任务没有可生成的修复草案。", "warning");
        return;
      }
      const confirmed = window.confirm(`即将从 ${review.selectedCount} 条任务中批量生成 ${review.draftableCount} 组修复草案。是否继续？`);
      if (!confirmed) return;
      const result = queuePhase18RepairDraftsForSelectedTasks();
      renderInsights();
      setStorageStatus(result.generated ? `已批量生成 ${result.generated} 条第十八阶段修复草案。` : "没有新的修复草案生成，可能已存在预览草案。", result.generated ? "success" : "warning");
      return;
    }
    const taskStatusButton = event.target.closest("[data-phase18-task-status]");
    if (taskStatusButton) {
      const updated = updatePhase18TaskStatus(taskStatusButton.dataset.phase18TaskId, taskStatusButton.dataset.phase18TaskStatus);
      renderInsights();
      setStorageStatus(updated ? "第十八阶段长期任务状态已更新。" : "未找到要更新的长期任务。", updated ? "success" : "warning");
      return;
    }
    if (event.target.closest("[data-phase18-clear-resolved]")) {
      clearResolvedPhase18Tasks();
      renderInsights();
      setStorageStatus("已清理第十八阶段已完成和已忽略任务。", "warning");
      return;
    }
    const feedbackButton = event.target.closest("[data-phase18-feedback]");
    if (feedbackButton) {
      recordPhase18AgentFeedback(
        feedbackButton.dataset.phase18Feedback,
        feedbackButton.dataset.phase18Target,
        feedbackButton.dataset.phase18Label
      );
      renderInsights();
      setStorageStatus("第十八阶段长期助理反馈已记录。", "success");
    }
  });
  elements.savedAssetsPanel?.addEventListener("click", (event) => {
    const reportButton = event.target.closest("[data-report-draft]");
    if (reportButton) {
      saveReportDraftFromInsights();
      return;
    }
    const refreshButton = event.target.closest("[data-assets-refresh]");
    if (refreshButton) {
      refreshAssetCollection();
      return;
    }
    const openButton = event.target.closest("[data-asset-open]");
    if (openButton) {
      openSavedAsset(openButton.dataset.assetType || "exhibition", openButton.dataset.assetOpen || "");
      return;
    }
    const statusButton = event.target.closest("[data-asset-status]");
    if (statusButton) {
      updateSavedAssetStatus(statusButton.dataset.assetType || "exhibition", statusButton.dataset.assetStatus || "", statusButton.dataset.nextStatus || "draft");
      return;
    }
    const exportFilterButton = event.target.closest("[data-asset-export-filter]");
    if (exportFilterButton) {
      exportFilteredAssetPackage(exportFilterButton.dataset.assetExportFilter || "");
      return;
    }
    const batchStatusButton = event.target.closest("[data-asset-batch-from]");
    if (batchStatusButton) {
      batchUpdateAssetStatus(batchStatusButton.dataset.assetBatchFrom || "draft", batchStatusButton.dataset.assetBatchTo || "review");
      return;
    }
    const snapshotExportButton = event.target.closest("[data-asset-snapshot-export]");
    if (snapshotExportButton) {
      exportSelectedAssetSnapshot(snapshotExportButton.dataset.assetSnapshotExport || selectedAssetSnapshotId);
      return;
    }
    const snapshotSelectButton = event.target.closest("[data-asset-snapshot-select]");
    if (snapshotSelectButton) {
      selectedAssetSnapshotId = snapshotSelectButton.dataset.assetSnapshotSelect || "";
      setStorageStatus("已切换资产快照对比对象。", "success");
      renderAssetCollectionPanel();
      return;
    }
    const auditSearchButton = event.target.closest("[data-asset-audit-search]");
    if (auditSearchButton) {
      const input = elements.savedAssetsPanel.querySelector("[data-asset-audit-query]");
      assetAuditSearchTerm = input?.value || "";
      renderAssetCollectionPanel();
      return;
    }
    const auditClearButton = event.target.closest("[data-asset-audit-clear]");
    if (auditClearButton) {
      assetAuditSearchTerm = "";
      renderAssetCollectionPanel();
      return;
    }
    const deleteButton = event.target.closest("[data-asset-delete]");
    if (deleteButton) {
      deleteSavedAsset(deleteButton.dataset.assetType || "exhibition", deleteButton.dataset.assetDelete || "", deleteButton.dataset.assetTitle || "");
    }
  });
  elements.timelineList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-timeline-search]");
    if (!button) return;
    const value = button.dataset.timelineSearch || "";
    searchKeyword = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.slice(0, 7) : value.replace(" 年 ", "-").replace(" 月", "");
    activeHall = "all";
    emotionFilter = "all";
    elements.searchInput.value = searchKeyword;
    elements.emotionFilterSelect.value = "all";
    render();
    document.getElementById("memoryGrid")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  elements.sortSelect.addEventListener("change", (event) => {
    sortMode = event.target.value;
    renderMemories();
    renderGuide();
  });
  elements.emotionFilterSelect.addEventListener("change", (event) => {
    emotionFilter = event.target.value;
    renderMemories();
    renderGuide();
    renderInsights();
  });
  elements.insightScopeSelect.addEventListener("change", (event) => {
    insightScope = event.target.value;
    renderInsights();
  });
  elements.workflowTemplateList.addEventListener("click", (event) => {
    const card = event.target.closest("[data-template]");
    if (!card) return;
    activeWorkflowTemplateId = card.dataset.template || activeWorkflowTemplateId;
    renderWorkflowOrchestration();
  });
  elements.phase19SampleButton?.addEventListener("click", loadPhase19Sample);
  elements.phase19SaveTemplateButton?.addEventListener("click", savePhase19CustomMappingTemplate);
  elements.phase19BatchFilter?.addEventListener("change", (event) => {
    phase19BatchFilter = event.target.value || "all";
    renderPhase19ImportPreview(phase19ImportPreview);
  });
  elements.phase19AuditSearch?.addEventListener("input", (event) => {
    phase19AuditSearch = event.target.value || "";
    renderPhase19ImportPreview(phase19ImportPreview);
  });
  elements.phase19PreviewButton?.addEventListener("click", previewPhase19Import);
  elements.phase19ApplyButton?.addEventListener("click", applyPhase19ImportPreview);
  elements.phase19ImportPreview?.addEventListener("click", (event) => {
    const selectInput = event.target.closest("[data-phase19-draft-select]");
    if (selectInput) {
      setPhase19DraftSelection(Number(selectInput.dataset.phase19DraftSelect), selectInput.checked);
      return;
    }
    if (event.target.closest("[data-phase19-select-all]")) {
      setAllPhase19DraftSelection(true);
      return;
    }
    if (event.target.closest("[data-phase19-select-none]")) {
      setAllPhase19DraftSelection(false);
      return;
    }
    const batchToggleButton = event.target.closest("[data-phase19-batch-toggle]");
    if (batchToggleButton) {
      togglePhase19BatchDetail(batchToggleButton.dataset.phase19BatchToggle);
      return;
    }
    const itemRollbackButton = event.target.closest("[data-phase19-item-rollback]");
    if (itemRollbackButton) {
      rollbackPhase19ImportItem(itemRollbackButton.dataset.phase19ItemBatch, itemRollbackButton.dataset.phase19ItemRollback);
      return;
    }
    const auditButton = event.target.closest("[data-phase19-export-audit]");
    if (auditButton) {
      exportPhase19BatchAudit(auditButton.dataset.phase19ExportAudit);
      return;
    }
    const reviewStatusButton = event.target.closest("[data-phase19-review-status]");
    if (reviewStatusButton) {
      const updated = updatePhase19ConflictReviewStatus(
        reviewStatusButton.dataset.phase19ReviewBatch,
        reviewStatusButton.dataset.phase19ReviewStatus,
        reviewStatusButton.dataset.phase19ReviewNext
      );
      setStorageStatus(updated ? "第十九阶段冲突复核状态已更新。" : "未找到要更新的冲突复核项。", updated ? "success" : "warning");
      return;
    }
    const rollbackButton = event.target.closest("[data-phase19-rollback]");
    if (rollbackButton) {
      rollbackPhase19ImportBatch(rollbackButton.dataset.phase19Rollback);
    }
  });
  elements.phase19ImportPreview?.addEventListener("input", (event) => {
    const fieldInput = event.target.closest("[data-phase19-draft-field]");
    if (!fieldInput) return;
    updatePhase19DraftField(Number(fieldInput.dataset.phase19DraftIndex), fieldInput.dataset.phase19DraftField, fieldInput.value);
  });
  elements.phase19ImportPreview?.addEventListener("change", (event) => {
    const duplicateAction = event.target.closest("[data-phase19-duplicate-action]");
    if (duplicateAction) {
      setPhase19DuplicateAction(Number(duplicateAction.dataset.phase19DuplicateAction), duplicateAction.value);
    }
  });
  elements.clearFiltersButton.addEventListener("click", clearCollectionFilters);
  elements.emotionIntensity.addEventListener("input", updateEmotionIntensityOutput);
  elements.exportButton.addEventListener("click", exportMemories);
  elements.importFile.addEventListener("change", (event) => importMemories(event.target.files[0]));
  elements.syncDatabaseButton.addEventListener("click", syncDatabase);
  elements.migrateLocalButton.addEventListener("click", migrateLocalToDatabase);
  elements.saveProfileButton.addEventListener("click", saveLocalProfileFromForm);
  elements.exportRedactedButton.addEventListener("click", exportRedactedMemories);
  elements.purgeDatabaseButton.addEventListener("click", handlePurgeDatabase);
  elements.phase16SyncPanel?.addEventListener("click", (event) => {
    if (event.target.closest("[data-phase16-export-sync]")) {
      exportPhase16SyncPackage();
      return;
    }
    if (event.target.closest("[data-phase17-queue-sync]")) {
      enqueuePhase17SyncTask({
        action: "manual-sync-review",
        label: "手动同步待复核",
        detail: "已加入第十七阶段同步队列，可先导出同步包再交给其他设备导入。"
      });
      renderPhase16SyncPanel();
      setStorageStatus("已加入第十七阶段同步队列。", "success");
      return;
    }
    if (event.target.closest("[data-phase17-add-review-device]")) {
      const device = addPhase17ReviewDevice();
      enqueuePhase17SyncTask({
        action: "device-review",
        label: "设备信任复核",
        detail: `${device.label} 已登记为待复核设备，进入真实同步前需要确认来源。`,
        risk: "review"
      });
      renderPhase16SyncPanel();
      setStorageStatus("已登记一台待复核设备。", "success");
      return;
    }
    if (event.target.closest("[data-phase17-cloud-draft]")) {
      createPhase17PrivateCloudDraft();
      enqueuePhase17SyncTask({
        action: "private-cloud-boundary",
        channel: "private-cloud",
        label: "私有云配置草案",
        detail: "已生成私有云适配边界草案；不会保存密钥，也不会连接云端。",
        risk: "review"
      });
      renderPhase16SyncPanel();
      setStorageStatus("已生成私有云适配边界草案。", "success");
      return;
    }
    if (event.target.closest("[data-phase17-cloud-clear]")) {
      clearPhase17PrivateCloudDraft();
      renderPhase16SyncPanel();
      setStorageStatus("已清除私有云适配边界草案。", "warning");
      return;
    }
    const phase17TrustButton = event.target.closest("[data-phase17-device-trust]");
    if (phase17TrustButton) {
      const updated = updatePhase17DeviceTrust(
        phase17TrustButton.dataset.phase17DeviceId,
        phase17TrustButton.dataset.phase17DeviceTrust
      );
      renderPhase16SyncPanel();
      setStorageStatus(updated ? "设备信任状态已更新。" : "本机设备不能被降级，或未找到设备。", updated ? "success" : "warning");
      return;
    }
    const phase17QueueButton = event.target.closest("[data-phase17-queue-status]");
    if (phase17QueueButton) {
      const updated = updatePhase17QueueTaskStatus(
        phase17QueueButton.dataset.phase17QueueId,
        phase17QueueButton.dataset.phase17QueueStatus
      );
      renderPhase16SyncPanel();
      setStorageStatus(updated ? "第十七阶段同步任务状态已更新。" : "未找到要更新的同步任务。", updated ? "success" : "warning");
      return;
    }
    if (event.target.closest("[data-phase16-apply-import]")) {
      applyPhase16ImportPlan();
      return;
    }
    if (event.target.closest("[data-phase16-export-drill-report]")) {
      exportPhase16RecoveryReport();
      return;
    }
    const batchButton = event.target.closest("[data-phase16-batch-decision]");
    if (batchButton && pendingSyncImportPlan) {
      const decision = batchButton.dataset.phase16BatchDecision || "copy";
      pendingSyncImportPlan.entries = pendingSyncImportPlan.entries.map((entry) => (
        entry.action === "conflict" ? { ...entry, decision } : entry
      ));
      pendingSyncImportPlan.decisionSummary = summarizePhase16ImportPlan(pendingSyncImportPlan);
      renderPhase16SyncPanel();
      setStorageStatus(`已将冲突项批量设为：${getPhase16DecisionLabel(decision)}。`, "success");
      return;
    }
    if (event.target.closest("[data-phase16-cancel-import]")) {
      recordPhase16SyncAuditEvent({
        action: "cancel-preview",
        label: "取消同步预览",
        detail: "用户取消了尚未应用的导入预览",
        batchId: pendingSyncImportPlan?.source?.batchId,
        summary: pendingSyncImportPlan ? summarizePhase16ImportPlan(pendingSyncImportPlan) : null
      });
      pendingSyncImportPlan = null;
      renderPhase16SyncPanel();
      setStorageStatus("已取消第十六阶段同步预览。", "warning");
    }
  });
  elements.phase16SyncPanel?.addEventListener("change", (event) => {
    const select = event.target.closest("[data-phase16-decision]");
    if (select && pendingSyncImportPlan) {
      const index = Number(select.dataset.phase16Decision);
      if (!Number.isInteger(index) || !pendingSyncImportPlan.entries[index]) return;
      pendingSyncImportPlan.entries[index] = {
        ...pendingSyncImportPlan.entries[index],
        decision: select.value
      };
      pendingSyncImportPlan.decisionSummary = summarizePhase16ImportPlan(pendingSyncImportPlan);
      renderPhase16SyncPanel();
      return;
    }
    const assetSelect = event.target.closest("[data-phase16-asset-decision]");
    if (assetSelect && pendingSyncImportPlan?.assetMergePreview?.entries) {
      const index = Number(assetSelect.dataset.phase16AssetDecision);
      if (!Number.isInteger(index) || !pendingSyncImportPlan.assetMergePreview.entries[index]) return;
      pendingSyncImportPlan.assetMergePreview.entries[index] = {
        ...pendingSyncImportPlan.assetMergePreview.entries[index],
        decision: assetSelect.value
      };
      renderPhase16SyncPanel();
    }
  });
  elements.closeDialog.addEventListener("click", () => elements.memoryDialog.close());
  elements.memoryDialog.addEventListener("click", (event) => {
    if (event.target === elements.memoryDialog) elements.memoryDialog.close();
    const exportButton = event.target.closest("[data-asset-export]");
    if (exportButton) {
      exportActiveAsset();
      return;
    }
    const form = event.target.closest("[data-asset-edit-form]");
    if (!form) return;
    const memoryInsertButton = event.target.closest("[data-memory-insert]");
    if (memoryInsertButton) {
      insertAssetMemoryFromPicker(form);
      return;
    }
    const referenceInsertButton = event.target.closest("[data-reference-insert]");
    if (referenceInsertButton) {
      insertReportReferenceFromPicker(form);
      return;
    }
    const sortButton = event.target.closest("[data-memory-sort-index]");
    if (sortButton) {
      moveAssetMemoryLine(form, Number(sortButton.dataset.memorySortIndex), sortButton.dataset.memorySortDirection || "down");
    }
  });
  elements.memoryDialog.addEventListener("submit", (event) => {
    const form = event.target.closest("[data-asset-edit-form]");
    if (!form) return;
    event.preventDefault();
    saveSavedAssetEdits(form);
  });
  document.querySelectorAll("[data-question]").forEach((button) => {
    button.addEventListener("click", () => answerGuideQuestion(button.dataset.question));
  });
}

renderHallSelect();
renderEmotionOptions();
updateEmotionIntensityOutput();
updateRawCount();
bindEvents();
setActiveFeaturePanel("home", "", false);
updateGuideAskState();
render();
checkAiBackend();
initializeStorage();
