const { spawn } = require("child_process");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..");

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForHealth(baseUrl, attempts = 40) {
  for (let index = 0; index < attempts; index += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return response.json();
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error("server did not become healthy");
}

function assert(name, condition) {
  if (!condition) throw new Error(`API smoke failed: ${name}`);
  console.log(`ok - ${name}`);
}

async function main() {
  const port = await getFreePort();
  const dbPath = path.join(os.tmpdir(), `memory-museum-smoke-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`);
  const operationsLogPath = path.join(os.tmpdir(), `memory-museum-operations-${Date.now()}-${Math.random().toString(16).slice(2)}.jsonl`);
  const child = spawn(process.execPath, ["server.js"], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      DB_PATH: dbPath,
      OPERATIONS_LOG_PATH: operationsLogPath,
      AI_API_KEY: ""
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (data) => { stdout += String(data); });
  child.stderr.on("data", (data) => { stderr += String(data); });

  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    const health = await waitForHealth(baseUrl);
    assert("health reports phase 19", health.ok === true && health.phase === 19);
    assert("health reports phase 19 name", health.phaseName === "个人知识生态和外部导入版");
    assert("health exposes multimodal stat", typeof health.database?.stats?.multimodal === "number");
    assert("health exposes phase 10 handoff", typeof health.database?.phase10Handoff?.timelineReady === "number");
    assert("health exposes phase 11 handoff", health.database?.phase11Handoff?.templates >= 3 && health.orchestration?.engine?.dependency === "none");
    assert("health exposes phase 12 sovereignty", health.database?.phase12Sovereignty?.exportPackage?.portable === true && health.privacy?.storageMode === "local-first");
    assert("health exposes operations summary", health.operations?.readiness?.phase14 === true && health.operations?.observability?.version === "/api/version");
    assert("health exposes phase 14 operations observability", health.operations?.observability?.operations === "/api/operations" && health.operations?.observability?.requestId === "X-Request-Id");

    const versionResponse = await fetch(`${baseUrl}/api/version`);
    const versionPayload = await versionResponse.json();
    assert("version API reports phase 19", versionResponse.ok && versionPayload.phase === 19 && versionPayload.phaseName === "个人知识生态和外部导入版");
    assert("version API returns request id header", Boolean(versionResponse.headers.get("x-request-id")));
    assert("version API exposes runtime", versionPayload.runtime?.node && versionPayload.deployment?.startCommand === "npm.cmd start");
    assert("version API exposes operations", versionPayload.operations?.backup?.redactedExport && versionPayload.checks?.full === "npm.cmd run check");
    assert("version API exposes phase 19 release checklist", versionPayload.version === "0.9.8" && versionPayload.buildLabel === "phase19-import-audit-ninth-edition" && versionPayload.releaseChecklist?.some((item) => item.id === "phase19-readiness"));
    assert("version API exposes runbook and risk register", versionPayload.runbook?.some((item) => item.id === "backup") && versionPayload.riskRegister?.some((item) => item.id === "privacy"));
    assert("version API exposes backup policy and deployment modes", versionPayload.backupPolicy?.redacted && versionPayload.deploymentModes?.some((item) => item.id === "demo"));
    assert("version API exposes release history", versionPayload.releaseHistory?.some((item) => item.version === "0.9.8"));
    assert("version API exposes log archive and demo kit", versionPayload.logArchive?.exportEndpoint === "/api/operations/export" && versionPayload.demoKit?.checks?.some((item) => item.id === "sample-count"));
    assert("version API exposes phase 14 readiness", versionPayload.phase14Readiness?.ready === true && versionPayload.moduleBoundaryPlan?.some((item) => item.id === "operations"));
    assert("version API exposes phase 15 readiness", versionPayload.phase15Readiness?.ready === true && versionPayload.phase15AssetPlan?.some((item) => item.id === "saved-exhibitions"));

    const operationsResponse = await fetch(`${baseUrl}/api/operations`);
    const operationsPayload = await operationsResponse.json();
    assert("operations API reports phase 19", operationsResponse.ok && operationsPayload.phase === 19 && operationsPayload.version === "0.9.8" && operationsPayload.buildLabel === "phase19-import-audit-ninth-edition");
    assert("operations API exposes recent events", Array.isArray(operationsPayload.recentEvents) && operationsPayload.recentEvents.some((event) => event.path === "/api/version"));
    assert("operations API exposes release history and runbook", operationsPayload.releaseHistory?.some((item) => item.version === "0.9.8") && operationsPayload.runbook?.some((item) => item.id === "check"));
    assert("operations API exposes persisted log archive and demo kit", operationsPayload.logArchive?.format === "jsonl" && operationsPayload.demoKit?.storyline?.length >= 3);
    assert("operations API exposes phase 14 plan", operationsPayload.phase14Readiness?.recommendedOrder?.includes("phase15-assets") && operationsPayload.moduleBoundaryPlan?.some((item) => item.id === "health"));
    assert("operations API exposes phase 15 plan", operationsPayload.phase15Readiness?.targetPhase === 15 && operationsPayload.phase15AssetPlan?.length >= 4);

    const operationsExportResponse = await fetch(`${baseUrl}/api/operations/export`);
    const operationsExportPayload = await operationsExportResponse.json();
    assert("operations export succeeds", operationsExportResponse.ok && operationsExportPayload.phase === 19 && operationsExportPayload.version === "0.9.8" && operationsExportPayload.logArchive?.exportEndpoint === "/api/operations/export");
    assert("operations export includes recent events and demo kit", operationsExportPayload.recentEvents?.some((event) => event.path === "/api/operations") && operationsExportPayload.demoKit?.checks?.length >= 5);
    assert("operations export includes phase 14 readiness", operationsExportPayload.phase14Readiness?.ready === true && operationsExportPayload.moduleBoundaryPlan?.some((item) => item.id === "routes"));
    assert("operations export includes phase 15 readiness", operationsExportPayload.phase15Readiness?.ready === true && operationsExportPayload.phase15AssetPlan?.some((item) => item.id === "report-drafts"));

    const workflowsResponse = await fetch(`${baseUrl}/api/workflows`);
    const workflowsPayload = await workflowsResponse.json();
    assert("workflows API reports phase 19", workflowsResponse.ok && workflowsPayload.phase === 19);
    assert("workflows API returns templates", workflowsPayload.templates?.length >= 3 && workflowsPayload.templates.some((item) => item.id === "memory-curation"));
    assert("workflows API returns capabilities", workflowsPayload.capabilities?.humanReview === true && workflowsPayload.capabilities?.persistedRuns === true);
    assert("workflows API returns diagnostics", Array.isArray(workflowsPayload.qualityGates) && Array.isArray(workflowsPayload.dataSources) && Array.isArray(workflowsPayload.handoff?.recommendedNextActions));
    assert("workflows API returns phase 12 readiness", workflowsPayload.phase12Readiness?.targetPhase === 12 && workflowsPayload.phase12Readiness?.planningReady === true);

    const privacyResponse = await fetch(`${baseUrl}/api/privacy`);
    const privacyPayload = await privacyResponse.json();
    assert("privacy API reports phase 19", privacyResponse.ok && privacyPayload.phase === 19);
    assert("privacy API explains data locations", privacyPayload.dataLocations?.some((item) => item.id === "sqlite" && item.location));
    assert("privacy API explains AI scope", privacyPayload.aiDataScope?.configured === false && privacyPayload.aiDataScope?.note.includes("不会发起外部 AI 调用"));
    assert("privacy API exposes user controls", privacyPayload.userControls?.some((item) => item.id === "purge-all" && item.status === "available"));
    assert("privacy API exposes sensitive data", privacyPayload.sensitiveData?.riskLevel && Array.isArray(privacyPayload.sensitiveData?.categories));
    assert("privacy API exposes phase 13 readiness", privacyPayload.productizationReadiness?.targetPhase === 13 && privacyPayload.productizationReadiness?.ready === true);

    const importPreviewResponse = await fetch(`${baseUrl}/api/imports/preview`, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        format: "markdown",
        defaultSource: "日记",
        cleanupMode: "balanced",
        text: "# 外婆家的晚饭\n外婆把热汤端上桌，屋里很暖。\n\n# 毕业操场\n毕业前大家在操场拍了最后一张照片。"
      })
    });
    const importPreviewPayload = await importPreviewResponse.json();
    assert("phase 19 import preview succeeds", importPreviewResponse.ok && importPreviewPayload.phase === 19 && importPreviewPayload.mode === "external-import-preview");
    assert("phase 19 import preview creates drafts", importPreviewPayload.detectedFormat === "markdown" && importPreviewPayload.draftCount >= 2 && importPreviewPayload.drafts?.every((item) => item.title && item.rawContent && item.selected === true && item.importTrace));
    const csvPreviewResponse = await fetch(`${baseUrl}/api/imports/preview`, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        format: "csv",
        defaultSource: "日记",
        text: "标题;内容;日期\n旧车票;和朋友坐夜车去海边;2022-08-01"
      })
    });
    const csvPreviewPayload = await csvPreviewResponse.json();
    assert("phase 19 csv cleanup detects delimiter", csvPreviewResponse.ok && csvPreviewPayload.drafts?.[0]?.title === "旧车票" && csvPreviewPayload.drafts?.[0]?.importTrace?.includes("分隔符 ;"));
    const phase19ImportResponse = await fetch(`${baseUrl}/api/memories/import`, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ memories: [csvPreviewPayload.drafts[0]] })
    });
    const phase19ImportPayload = await phase19ImportResponse.json();
    assert("phase 19 import returns imported ids", phase19ImportResponse.ok && phase19ImportPayload.imported === 1 && phase19ImportPayload.importedIds?.[0]);

    const analyzeResponse = await fetch(`${baseUrl}/api/analyze`, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        rawContent: "今天在上海和妈妈一起整理老照片，想起童年夏天的晚饭和院子里的风。"
      })
    });
    const analyze = await analyzeResponse.json();
    assert("analyze request succeeds", analyzeResponse.ok);
    assert("workflow is phase 19", analyze.workflow?.phase === 19 && analyze.workflow?.version === 2);
    assert("workflow exposes run metadata", Boolean(analyze.workflow?.run?.id) && analyze.workflow.run.phase === 19 && analyze.workflow.run.persisted === true);
    assert("workflow exposes run events", Array.isArray(analyze.workflow?.run?.events) && analyze.workflow.run.events.length > 0);
    assert("workflow exposes state machine", Array.isArray(analyze.workflow?.stateMachine?.statuses) && analyze.workflow.stateMachine.statuses.includes("needs_review"));
    assert("workflow exposes confirmation items", Array.isArray(analyze.workflow?.summary?.confirmationItems));
    assert("workflow exposes step evidence", analyze.workflow?.steps?.every((step) => Array.isArray(step.evidence)));

    const runResponse = await fetch(`${baseUrl}/api/agent-runs/${encodeURIComponent(analyze.workflow.run.id)}`);
    const runPayload = await runResponse.json();
    assert("agent run query succeeds", runResponse.ok && runPayload.run?.id === analyze.workflow.run.id);
    assert("agent run persists steps and events", runPayload.run.steps.length >= 4 && runPayload.run.events.length >= 1);

    const workflowSnapshot = JSON.parse(JSON.stringify(analyze.workflow));
    workflowSnapshot.steps[0].status = "approved";
    workflowSnapshot.steps[1].status = "rejected";
    workflowSnapshot.run.events.push({
      type: "step_approved",
      label: "档案员 Agent已确认",
      step: workflowSnapshot.steps[0].id,
      at: new Date().toISOString()
    });
    workflowSnapshot.run.events.push({
      type: "step_rejected",
      label: "策展人 Agent已驳回",
      step: workflowSnapshot.steps[1].id,
      at: new Date().toISOString()
    });
    workflowSnapshot.run.eventCount += 2;

    const memoryResponse = await fetch(`${baseUrl}/api/memories`, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        ...analyze.result,
        rawContent: "今天在上海和妈妈一起整理老照片，想起童年夏天的晚饭和院子里的风。",
        date: "2026-06-22",
        coverImage: "old-photo-family-dinner.jpg",
        mediaNote: "照片里有饭桌、妈妈和童年夏天的院子，适合作为家庭展厅封面。",
        attachments: [{ name: "old-photo-family-dinner.jpg", type: "图片", note: "饭桌合照" }],
        agentRunId: analyze.workflow.run.id,
        agentWorkflow: workflowSnapshot,
        createdAt: new Date().toISOString()
      })
    });
    const memoryPayload = await memoryResponse.json();
    assert("memory save succeeds", memoryResponse.ok && memoryPayload.memory?.agentRunId === analyze.workflow.run.id);
    assert("memory saves multimodal metadata", memoryPayload.memory?.coverImage && memoryPayload.memory?.mediaNote && memoryPayload.memory?.attachments?.length === 1);

    const memoryRunResponse = await fetch(`${baseUrl}/api/memories/${encodeURIComponent(memoryPayload.memory.id)}/agent-run`);
    const memoryRunPayload = await memoryRunResponse.json();
    assert("memory links to agent run", memoryRunResponse.ok && memoryRunPayload.run?.id === analyze.workflow.run.id && memoryRunPayload.run.memoryId === memoryPayload.memory.id);
    assert("saved workflow snapshot persists user events", memoryRunPayload.run.events.some((event) => event.type === "step_approved") && memoryRunPayload.run.steps[0].status === "approved");
    assert("rejected agent step is audited", memoryRunPayload.run.events.some((event) => event.type === "step_rejected") && memoryRunPayload.run.steps[1].status === "rejected");
    assert("memory save event is audited", memoryRunPayload.run.events.some((event) => event.type === "memory_saved" && event.payload?.action === "create"));

    const updateSnapshot = JSON.parse(JSON.stringify(workflowSnapshot));
    updateSnapshot.run.events = memoryRunPayload.run.events;
    updateSnapshot.run.eventCount = memoryRunPayload.run.eventCount;
    const updateResponse = await fetch(`${baseUrl}/api/memories/${encodeURIComponent(memoryPayload.memory.id)}`, {
      method: "PUT",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        ...memoryPayload.memory,
        title: "更新后的整理历史展品",
        attachments: [...(memoryPayload.memory.attachments || []), { name: "voice-note.txt", type: "语音转写", note: "补充车站广播线索" }],
        agentWorkflow: updateSnapshot,
        updatedAt: new Date().toISOString()
      })
    });
    const updatePayload = await updateResponse.json();
    assert("memory update succeeds", updateResponse.ok && updatePayload.memory?.title === "更新后的整理历史展品");
    assert("memory update keeps multimodal metadata", updatePayload.memory?.attachments?.length === 2 && updatePayload.memory.mediaNote.includes("照片"));
    const updatedRunResponse = await fetch(`${baseUrl}/api/memories/${encodeURIComponent(memoryPayload.memory.id)}/agent-run`);
    const updatedRunPayload = await updatedRunResponse.json();
    assert("memory update save event is audited", updatedRunResponse.ok && updatedRunPayload.run.events.some((event) => event.type === "memory_saved" && event.payload?.action === "update"));

    const searchResponse = await fetch(`${baseUrl}/api/search?query=${encodeURIComponent("小时候被家人温暖陪伴")}&mode=hybrid`);
    const searchPayload = await searchResponse.json();
    assert("hybrid search succeeds", searchResponse.ok && searchPayload.mode === "hybrid" && Array.isArray(searchPayload.results));
    assert("hybrid search exposes citation metadata", searchPayload.results.some((item) => Array.isArray(item.matchedFields) && typeof item.reason === "string"));
    assert("hybrid search exposes confidence", searchPayload.results.some((item) => item.confidence?.label && item.confidence?.reason));

    const semanticResponse = await fetch(`${baseUrl}/api/search?query=${encodeURIComponent("家人温暖陪伴")}&mode=semantic`);
    const semanticPayload = await semanticResponse.json();
    assert("semantic search succeeds", semanticResponse.ok && semanticPayload.mode === "semantic" && Array.isArray(semanticPayload.results));
    assert("semantic search keeps query anchors", semanticPayload.results.some((item) => Array.isArray(item.matchedTerms) && item.matchedTerms.length > 0));

    const keywordResponse = await fetch(`${baseUrl}/api/search?query=${encodeURIComponent("妈妈")}&mode=keyword`);
    const keywordPayload = await keywordResponse.json();
    assert("keyword search succeeds", keywordResponse.ok && keywordPayload.mode === "keyword" && Array.isArray(keywordPayload.results));

    const mediaSearchResponse = await fetch(`${baseUrl}/api/search?query=${encodeURIComponent("饭桌合照")}&mode=hybrid`);
    const mediaSearchPayload = await mediaSearchResponse.json();
    assert("multimodal metadata is searchable", mediaSearchResponse.ok && mediaSearchPayload.results.some((item) => item.memory?.attachments?.length && item.matchedFields.includes("附件")));

    const exportResponse = await fetch(`${baseUrl}/api/memories/export`);
    const exportPayload = await exportResponse.json();
    assert("export includes multimodal summary", exportResponse.ok && exportPayload.mediaSummary?.attachmentCount >= 2 && exportPayload.mediaSummary?.fileStorage === "metadata-only");
    assert("export summarizes attachment types", exportPayload.mediaSummary?.attachmentTypeCounts?.图片 >= 1 && exportPayload.mediaSummary?.attachmentTypeCounts?.语音 >= 1);
    assert("export includes phase 10 handoff", exportPayload.phase10Handoff?.timelineReady >= 1 && exportPayload.phase10Handoff?.themeReady >= 1 && exportPayload.phase10Handoff?.readyForPhase10 === true);
    assert("export includes phase 10 insights", exportPayload.phase10Insights?.timeline?.length >= 1 && exportPayload.phase10Insights?.themes?.length >= 1 && exportPayload.phase10Insights?.report?.total >= 1);
    assert("export includes phase 11 workflow blueprint", exportPayload.phase11WorkflowBlueprint?.phase >= 18 && exportPayload.phase11WorkflowBlueprint?.templates?.length >= 3);
    assert("export includes phase 11 diagnostics", exportPayload.phase11WorkflowBlueprint?.handoff?.reviewCoverage >= 0 && exportPayload.phase11WorkflowBlueprint?.qualityGates?.length >= 4);
    assert("export includes phase 12 readiness", exportPayload.phase11WorkflowBlueprint?.phase12Readiness?.targetPhase === 12);
    assert("export includes phase 12 sovereignty", exportPayload.phase12Sovereignty?.exportPackage?.portable === true && exportPayload.privacyPolicy?.phase === 19);
    assert("export includes phase 16 sync manifest", exportPayload.phase16Sync?.phase === 16 && exportPayload.phase16Sync?.mode === "manual-json-local-first");
    assert("export includes phase 16 asset boundary", exportPayload.phase16Sync?.assetBoundary?.importPolicy === "phase16-v5-memory-first-assets-preview");
    assert("export includes phase 17 sync adapter", exportPayload.phase17SyncAdapter?.phase === 17 && exportPayload.phase17SyncAdapter?.mode === "adapter-layer-local-first" && exportPayload.phase17SyncAdapter?.adapters?.some((item) => item.id === "manual-json") && exportPayload.phase17SyncAdapter?.syncHealth?.score >= 0 && exportPayload.phase17SyncAdapter?.healthExplanation && exportPayload.phase17SyncAdapter?.failureRecovery && exportPayload.phase17SyncAdapter?.phase18SyncAdvisory);
    assert("export includes phase 18 long-term agent", exportPayload.phase18LongTermAgent?.phase === 18 && Array.isArray(exportPayload.phase18LongTermAgent?.suggestions) && exportPayload.phase18LongTermAgent?.suggestions?.some((item) => item.quality?.tier) && exportPayload.phase18LongTermAgent?.visibleSuggestions && exportPayload.phase18LongTermAgent?.suggestionNoise?.config && exportPayload.phase18LongTermAgent?.suggestionNoise?.preview && exportPayload.phase18LongTermAgent?.relationships?.graph && exportPayload.phase18LongTermAgent?.relationships?.assetNavigation && exportPayload.phase18LongTermAgent?.reviewDashboard && exportPayload.phase18LongTermAgent?.agentDigest?.mode === "daily-weekly-memory-assistant-digest" && exportPayload.phase18LongTermAgent?.repairDrafts?.batchReview && exportPayload.phase18LongTermAgent?.taskQueue?.batchReview && exportPayload.phase18LongTermAgent?.taskAudit && exportPayload.phase18LongTermAgent?.agentQuality && exportPayload.phase18LongTermAgent?.periodicAssetPlan && exportPayload.phase18LongTermAgent?.periodicReportPlan && exportPayload.phase18LongTermAgent?.assetSyncState);
    assert("export includes phase 19 import plan", exportPayload.phase19ImportPlan?.phase === 19 && exportPayload.phase19ImportPlan?.supportedFormats?.includes("markdown") && exportPayload.phase19ImportPlan?.cleanupFeatures?.includes("draft-selection") && exportPayload.phase19ImportPlan?.cleanupFeatures?.includes("batch-rollback") && exportPayload.phase19ImportPlan?.cleanupFeatures?.includes("item-rollback") && exportPayload.phase19ImportPlan?.cleanupFeatures?.includes("failed-item-retention") && exportPayload.phase19ImportPlan?.cleanupFeatures?.includes("quality-trend") && exportPayload.phase19ImportPlan?.cleanupFeatures?.includes("field-mapping-template") && exportPayload.phase19ImportPlan?.cleanupFeatures?.includes("custom-mapping-template") && exportPayload.phase19ImportPlan?.cleanupFeatures?.includes("template-rule-defaults") && exportPayload.phase19ImportPlan?.cleanupFeatures?.includes("field-alias-rules") && exportPayload.phase19ImportPlan?.cleanupFeatures?.includes("duplicate-precheck") && exportPayload.phase19ImportPlan?.cleanupFeatures?.includes("duplicate-decision") && exportPayload.phase19ImportPlan?.cleanupFeatures?.includes("conflict-preview") && exportPayload.phase19ImportPlan?.cleanupFeatures?.includes("conflict-review-desk") && exportPayload.phase19ImportPlan?.cleanupFeatures?.includes("review-status-flow") && exportPayload.phase19ImportPlan?.cleanupFeatures?.includes("cross-batch-compare") && exportPayload.phase19ImportPlan?.cleanupFeatures?.includes("batch-filter-compare") && exportPayload.phase19ImportPlan?.cleanupFeatures?.includes("audit-search") && exportPayload.phase19ImportPlan?.cleanupFeatures?.includes("import-report-view") && exportPayload.phase19ImportPlan?.cleanupFeatures?.includes("post-import-cleanup-queue") && exportPayload.phase19ImportPlan?.cleanupFeatures?.includes("batch-audit-export") && exportPayload.phase19ImportPlan?.importEndpoint === "/api/imports/preview");
    assert("export includes sensitivity summary", exportPayload.phase12Sovereignty?.sensitivity?.riskLevel && exportPayload.privacyPolicy?.sensitiveData?.categories?.length >= 1);

    const redactedExportResponse = await fetch(`${baseUrl}/api/memories/export?mode=redacted`);
    const redactedExportPayload = await redactedExportResponse.json();
    assert("redacted export succeeds", redactedExportResponse.ok && redactedExportPayload.redacted === true && redactedExportPayload.exportMode === "redacted");
    assert("redacted export masks sensitive fields", redactedExportPayload.memories?.[0]?.rawContent?.includes("已脱敏") && redactedExportPayload.memories?.[0]?.people?.every((item) => item.startsWith("人物")));
    assert("redacted export keeps structure", redactedExportPayload.redaction?.maskedFields?.includes("rawContent") && redactedExportPayload.phase12Sovereignty?.exportPackage?.modes?.includes("redacted"));

    const insightsResponse = await fetch(`${baseUrl}/api/insights`);
    const insightsPayload = await insightsResponse.json();
    assert("insights API returns timeline", insightsResponse.ok && insightsPayload.phase === 19 && insightsPayload.timeline?.length >= 1);
    assert("insights API returns themes", insightsPayload.themes?.some((theme) => theme.count >= 1 && Array.isArray(theme.memories)));
    assert("insights API returns report", insightsPayload.report?.summary?.includes("这批记忆共") && insightsPayload.report?.highlights?.length >= 1);
    assert("insights report has narrative sections", insightsPayload.report?.sections?.length >= 3 && insightsPayload.report.sections.some((section) => section.title === "报告开头"));
    assert("insights themes include descriptions", insightsPayload.themes?.some((theme) => theme.description && theme.coverMemory?.title));
    assert("insights report includes references", insightsPayload.report?.references?.some((item) => item.role === "开篇展品" && item.id));
    const filteredInsightsResponse = await fetch(`${baseUrl}/api/insights?year=2026&theme=${encodeURIComponent("妈妈")}`);
    const filteredInsightsPayload = await filteredInsightsResponse.json();
    assert("insights API supports filters", filteredInsightsResponse.ok && filteredInsightsPayload.filters?.year === "2026" && filteredInsightsPayload.filters?.theme === "妈妈" && filteredInsightsPayload.filteredTotal >= 1);

    const exhibitionResponse = await fetch(`${baseUrl}/api/exhibitions`, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        id: "family-table-exhibition",
        title: "家庭饭桌专题展",
        intro: "把妈妈、饭桌和童年夏天串成一条可继续编辑的展线。",
        status: "draft",
        memoryIds: [memoryPayload.memory.id],
        coverMemoryId: memoryPayload.memory.id,
        guideText: "从这件展品开始讲家庭饭桌里的温暖。",
        tags: ["家庭", "饭桌", "温暖"]
      })
    });
    const exhibitionPayload = await exhibitionResponse.json();
    assert("saved exhibition create succeeds", exhibitionResponse.status === 201 && exhibitionPayload.savedExhibition?.id === "family-table-exhibition" && exhibitionPayload.savedExhibition.memoryIds?.includes(memoryPayload.memory.id));

    const generatedExhibitionResponse = await fetch(`${baseUrl}/api/exhibitions/from-theme`, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        id: "generated-mom-theme-exhibition",
        theme: "妈妈",
        year: "2026",
        title: "妈妈主题展草稿"
      })
    });
    const generatedExhibitionPayload = await generatedExhibitionResponse.json();
    assert("theme exhibition generation succeeds", generatedExhibitionResponse.status === 201 && generatedExhibitionPayload.source?.type === "theme-insights" && generatedExhibitionPayload.savedExhibition?.memoryIds?.length >= 1);

    const reportDraftResponse = await fetch(`${baseUrl}/api/report-drafts`, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        id: "family-report-draft",
        title: "家庭饭桌回忆报告",
        status: "draft",
        scope: { theme: "妈妈", year: "2026" },
        sections: filteredInsightsPayload.report?.sections || [],
        references: filteredInsightsPayload.report?.references || [],
        sourceInsights: { filteredTotal: filteredInsightsPayload.filteredTotal, theme: "妈妈" }
      })
    });
    const reportDraftPayload = await reportDraftResponse.json();
    assert("report draft create succeeds", reportDraftResponse.status === 201 && reportDraftPayload.reportDraft?.id === "family-report-draft" && reportDraftPayload.reportDraft.sections?.length >= 1);

    const generatedReportResponse = await fetch(`${baseUrl}/api/report-drafts/from-insights`, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        id: "generated-mom-report-draft",
        theme: "妈妈",
        year: "2026",
        title: "妈妈主题回忆报告草稿"
      })
    });
    const generatedReportPayload = await generatedReportResponse.json();
    assert("insights report draft generation succeeds", generatedReportResponse.status === 201 && generatedReportPayload.source?.type === "phase10-insights" && generatedReportPayload.reportDraft?.sections?.length >= 1);

    const exhibitionDetailResponse = await fetch(`${baseUrl}/api/exhibitions/generated-mom-theme-exhibition`);
    const exhibitionDetailPayload = await exhibitionDetailResponse.json();
    assert("saved exhibition detail succeeds", exhibitionDetailResponse.ok && exhibitionDetailPayload.savedExhibition?.id === "generated-mom-theme-exhibition");

    const reportDraftDetailResponse = await fetch(`${baseUrl}/api/report-drafts/generated-mom-report-draft`);
    const reportDraftDetailPayload = await reportDraftDetailResponse.json();
    assert("report draft detail succeeds", reportDraftDetailResponse.ok && reportDraftDetailPayload.reportDraft?.id === "generated-mom-report-draft");

    const exhibitionEditResponse = await fetch(`${baseUrl}/api/exhibitions`, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        ...exhibitionDetailPayload.savedExhibition,
        title: "妈妈主题展编辑版",
        status: "review",
        intro: "编辑后的专题展说明。",
        guideText: "编辑后的导览词。",
        memoryIds: [memoryPayload.memory.id],
        coverMemoryId: memoryPayload.memory.id,
        tags: ["妈妈", "编辑版"]
      })
    });
    const exhibitionEditPayload = await exhibitionEditResponse.json();
    assert("saved exhibition edit succeeds", exhibitionEditResponse.ok && exhibitionEditPayload.savedExhibition?.title === "妈妈主题展编辑版" && exhibitionEditPayload.savedExhibition.status === "review" && exhibitionEditPayload.savedExhibition.tags?.includes("编辑版") && exhibitionEditPayload.savedExhibition.coverMemoryId === memoryPayload.memory.id);

    const reportDraftEditResponse = await fetch(`${baseUrl}/api/report-drafts`, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        ...reportDraftDetailPayload.reportDraft,
        title: "妈妈主题回忆报告编辑版",
        status: "review",
        sections: [
          { title: "编辑后的章节", text: "这里验证报告草稿章节可以被覆盖保存。" }
        ],
        references: [
          { role: "编辑引用", title: memoryPayload.memory.title, id: memoryPayload.memory.id }
        ]
      })
    });
    const reportDraftEditPayload = await reportDraftEditResponse.json();
    assert("report draft edit succeeds", reportDraftEditResponse.ok && reportDraftEditPayload.reportDraft?.title === "妈妈主题回忆报告编辑版" && reportDraftEditPayload.reportDraft.sections?.[0]?.title === "编辑后的章节" && reportDraftEditPayload.reportDraft.references?.[0]?.role === "编辑引用");

    const deleteExhibitionResponse = await fetch(`${baseUrl}/api/exhibitions/family-table-exhibition`, { method: "DELETE" });
    const deleteExhibitionPayload = await deleteExhibitionResponse.json();
    assert("saved exhibition delete succeeds", deleteExhibitionResponse.ok && deleteExhibitionPayload.ok === true && deleteExhibitionPayload.id === "family-table-exhibition");

    const deleteReportDraftResponse = await fetch(`${baseUrl}/api/report-drafts/family-report-draft`, { method: "DELETE" });
    const deleteReportDraftPayload = await deleteReportDraftResponse.json();
    assert("report draft delete succeeds", deleteReportDraftResponse.ok && deleteReportDraftPayload.ok === true && deleteReportDraftPayload.id === "family-report-draft");

    const assetsResponse = await fetch(`${baseUrl}/api/assets`);
    const assetsPayload = await assetsResponse.json();
    assert("assets API returns phase 15 assets", assetsResponse.ok && assetsPayload.phase === 19 && assetsPayload.savedExhibitions?.length === 1 && assetsPayload.reportDrafts?.length === 1);

    const assetExportResponse = await fetch(`${baseUrl}/api/memories/export`);
    const assetExportPayload = await assetExportResponse.json();
    assert("export includes phase 15 assets", assetExportResponse.ok && assetExportPayload.savedExhibitions?.some((item) => item.id === "generated-mom-theme-exhibition") && assetExportPayload.reportDrafts?.some((item) => item.id === "generated-mom-report-draft"));
    assert("export includes edited phase 15 assets", assetExportPayload.savedExhibitions?.some((item) => item.title === "妈妈主题展编辑版" && item.coverMemoryId === memoryPayload.memory.id) && assetExportPayload.reportDrafts?.some((item) => item.title === "妈妈主题回忆报告编辑版" && item.references?.some((ref) => ref.role === "编辑引用")));

    const mediaGuideResponse = await fetch(`${baseUrl}/api/guide`, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ question: "饭桌合照这条附件线索能讲讲吗？" })
    });
    const mediaGuidePayload = await mediaGuideResponse.json();
    assert("guide uses multimodal citation evidence", mediaGuideResponse.ok && mediaGuidePayload.citations.some((item) => item.matchedFields.includes("附件") || item.matchedFields.includes("多模态线索")));
    assert("guide explains multimodal evidence", typeof mediaGuidePayload.answer === "string" && mediaGuidePayload.answer.includes("多模态线索"));
    assert("guide suggests multimodal follow-up", Array.isArray(mediaGuidePayload.followUps) && mediaGuidePayload.followUps.some((item) => item.includes("附件") || item.includes("图片")));

    const guideResponse = await fetch(`${baseUrl}/api/guide`, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ question: "有没有小时候被家人温暖陪伴的记忆？" })
    });
    const guidePayload = await guideResponse.json();
    assert("guide uses hybrid retrieval", guideResponse.ok && guidePayload.retrievalMode === "hybrid");
    assert("guide exposes citations", Array.isArray(guidePayload.citations) && guidePayload.citations.length > 0);
    assert("guide citation includes reason", guidePayload.citations.some((item) => typeof item.reason === "string" && item.reason.length > 0));
    assert("guide citation includes confidence", guidePayload.citations.some((item) => item.confidence?.label));
    assert("mock guide explains citation evidence", typeof guidePayload.answer === "string" && guidePayload.answer.includes("召回依据"));
    assert("mock guide explains citation confidence", typeof guidePayload.answer === "string" && guidePayload.answer.includes("可信度"));
    assert("guide suggests follow-up questions", Array.isArray(guidePayload.followUps) && guidePayload.followUps.length >= 2);

    const fallbackGuideResponse = await fetch(`${baseUrl}/api/guide`, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ question: "完全不存在的火星海底邮局线索" })
    });
    const fallbackGuidePayload = await fallbackGuideResponse.json();
    assert("guide explains weak evidence boundary", fallbackGuideResponse.ok && fallbackGuidePayload.retrievalMode === "recent-fallback" && fallbackGuidePayload.answer.includes("证据边界"));
    assert("fallback guide suggests better query anchors", Array.isArray(fallbackGuidePayload.followUps) && fallbackGuidePayload.followUps.some((item) => item.includes("人物") || item.includes("情绪")));

    const orphanResponse = await fetch(`${baseUrl}/api/memories`, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        ...analyze.result,
        id: "orphanrun01",
        title: "孤儿整理历史校验",
        rawContent: "这条展品故意携带不存在的 Agent run id，用于验证后端会清理坏引用。",
        agentRunId: "missing-agent-run",
        createdAt: new Date().toISOString()
      })
    });
    const orphanPayload = await orphanResponse.json();
    assert("invalid agent run id is cleared on save", orphanResponse.ok && orphanPayload.memory?.agentRunId === "");

    const rejectedPurgeResponse = await fetch(`${baseUrl}/api/memories/purge`, {
      method: "DELETE",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ confirm: "NO" })
    });
    assert("purge requires explicit confirmation", rejectedPurgeResponse.status === 400);

    const purgeResponse = await fetch(`${baseUrl}/api/memories/purge`, {
      method: "DELETE",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ confirm: "DELETE" })
    });
    const purgePayload = await purgeResponse.json();
    assert("purge deletes local database memories", purgeResponse.ok && purgePayload.purge?.memoriesDeleted >= 1 && purgePayload.privacy?.memoryCount === 0);

    console.log("API smoke checks passed.");
  } catch (error) {
    if (stdout.trim()) console.error(stdout.trim());
    if (stderr.trim()) console.error(stderr.trim());
    throw error;
  } finally {
    child.kill();
    try {
      fs.rmSync(dbPath, { force: true });
    } catch {
      // Ignore cleanup failures on Windows if SQLite still has a handle briefly.
    }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

