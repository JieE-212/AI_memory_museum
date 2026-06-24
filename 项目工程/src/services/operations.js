function createOperationsService(deps) {
  const {
    fs,
    path,
    port,
    schemaVersion,
    phase,
    phaseName,
    appVersion,
    buildLabel,
    releaseChannel,
    operationEventLimit,
    operationLogPath,
    operationEvents,
    getStats,
    getDatabasePath,
    isAiConfigured,
    getAiModel,
    buildStructuredMemory,
    hasMultimodalStructured
  } = deps;

  function buildVersionInfo(memories = []) {
    return {
      app: "AI 记忆博物馆",
      packageName: "ai-memory-museum",
      version: appVersion,
      schemaVersion,
      phase,
      phaseName,
      releaseChannel,
      buildLabel,
      generatedAt: new Date().toISOString(),
      runtime: buildRuntimeInfo(),
      deployment: buildDeploymentProfile(),
      operations: buildOperationsSummary(memories),
      operationsConsole: buildOperationsConsole(memories),
      releaseChecklist: buildReleaseChecklist(memories),
      runbook: buildOperationsRunbook(),
      deploymentModes: buildDeploymentModes(),
      backupPolicy: buildBackupPolicy(),
      riskRegister: buildRiskRegister(memories),
      logArchive: buildLogArchiveInfo(),
      demoKit: buildDemoKit(memories),
      phase14Readiness: buildPhase14Readiness(memories),
      phase15Readiness: buildPhase15Readiness(memories),
      phase15AssetPlan: buildPhase15AssetPlan(memories),
      moduleBoundaryPlan: buildModuleBoundaryPlan(),
      releaseHistory: buildReleaseHistory(),
      apiSurface: [
        "GET /api/health",
        "GET /api/version",
        "GET /api/operations",
        "GET /api/operations/export",
        "GET /api/options",
        "GET /api/privacy",
        "GET /api/workflows",
        "GET /api/insights",
        "GET /api/assets",
        "GET /api/exhibitions",
        "GET /api/report-drafts",
        "POST /api/imports/preview",
        "GET /api/memories/export?mode=full|redacted",
        "POST /api/analyze",
        "POST /api/guide",
        "POST /api/exhibitions/from-theme",
        "POST /api/report-drafts/from-insights",
        "DELETE /api/exhibitions/:id",
        "DELETE /api/report-drafts/:id",
        "DELETE /api/memories/purge"
      ],
      checks: {
        full: "npm.cmd run check",
        smoke: "npm.cmd run smoke",
        syntax: "node --check app.js && node --check server.js && node --check database.js && node --check src/services/operations.js && node --check src/routes/health.js && node --check src/routes/operations.js"
      },
      nextEngineeringSteps: [
        "阶段 18 第一版已启动长期记忆助理和主动整理建议",
        "跨展品关系、周期回顾和反馈闭环已接入第十阶段洞察区",
        "第十七阶段同步适配层继续作为本地优先多设备底座保留",
        "保持 API smoke 覆盖资产生成、读取、编辑、删除、保存、导出和同步预览"
      ]
    };
  }

  function buildRuntimeInfo() {
    return {
      node: process.version,
      platform: process.platform,
      pid: process.pid,
      uptimeSeconds: Math.round(process.uptime()),
      port,
      databasePath: getDatabasePath(),
      aiConfigured: isAiConfigured(),
      aiModel: getAiModel()
    };
  }

  function buildDeploymentProfile() {
    const mode = process.env.NODE_ENV === "production" ? "production" : "local";
    return {
      mode,
      releaseChannel,
      staticHosting: "node-http",
      database: "node:sqlite",
      assetMode: "same-origin-static",
      configFiles: [".env", "package.json"],
      startCommand: "npm.cmd start",
      healthCheck: "/api/health",
      versionCheck: "/api/version",
      notes: mode === "production"
        ? "当前以 Node HTTP 直接托管静态资源和 API，生产部署前建议补充反向代理、日志和备份策略。"
        : "当前适合本地体验、演示和课程项目。"
    };
  }

  function buildReleaseChecklist(memories = []) {
    const stats = getStats();
    return [
      { id: "syntax", label: "语法检查", status: "ready", command: "node --check app.js && node --check server.js && node --check database.js && node --check src/services/operations.js && node --check src/routes/health.js && node --check src/routes/operations.js" },
      { id: "readiness", label: "第十五阶段资产检查", status: "ready", command: "node scripts/phase15-readiness.js" },
      { id: "phase16-readiness", label: "第十六阶段同步检查", status: "ready", command: "node scripts/phase16-readiness.js" },
      { id: "phase17-readiness", label: "第十七阶段适配层检查", status: "ready", command: "node scripts/phase17-readiness.js" },
      { id: "phase18-readiness", label: "第十八阶段长期助理检查", status: "ready", command: "node scripts/phase18-readiness.js" },
      { id: "phase19-readiness", label: "第十九阶段外部导入检查", status: "ready", command: "node scripts/phase19-readiness.js" },
      { id: "api-smoke", label: "核心 API smoke test", status: "ready", command: "npm.cmd run smoke" },
      { id: "operations-trace", label: "请求追踪与运行事件", status: "ready", detail: "API 响应带 X-Request-Id，/api/operations 可查看最近运行事件。" },
      { id: "persistent-ops-log", label: "持久化运行日志", status: "ready", detail: "最近 API 请求会追加到 JSONL 运维日志，可随 /api/operations/export 导出。" },
      { id: "data-export", label: "完整与脱敏备份", status: "ready", detail: "发布前可以导出完整包，演示或排查时优先使用脱敏包。" },
      { id: "demo-kit", label: "演示包摘要", status: (stats.total || memories.length) > 0 ? "ready" : "needs-sample", detail: "演示包会汇总样本数量、推荐路线和隐私提示。" },
      { id: "phase14-readiness", label: "第十四阶段模块化检查", status: "ready", detail: "模块边界、迁移顺序、风险闸门和检查保护网已经声明。" },
      { id: "phase15-readiness", label: "第十五阶段资产边界", status: "ready", detail: "专题资产、报告草稿、引用来源、导出边界和工作流状态已形成第一版实现。" },
      { id: "production-logs", label: "持久化日志与反向代理", status: "planned", detail: "生产部署前仍需补充文件日志、HTTPS 和反向代理说明。" }
    ];
  }

  function buildOperationsRunbook() {
    return [
      { id: "start", label: "本地启动", command: "npm.cmd start", detail: "启动后打开 http://127.0.0.1:3000，并先查看 /api/health。" },
      { id: "check", label: "发布前检查", command: "npm.cmd run check", detail: "包含语法检查、Phase 15 readiness 和 API smoke test。" },
      { id: "backup", label: "备份", command: "GET /api/memories/export", detail: "长期保存前导出完整 JSON；对外演示或排查使用 redacted 模式。" },
      { id: "privacy", label: "隐私复核", command: "GET /api/privacy", detail: "确认 AI 调用范围、敏感线索和删除控制符合当前使用场景。" },
      { id: "recover", label: "恢复", command: "POST /api/memories/import", detail: "从 JSON 备份恢复展品，导入时会处理 ID 冲突。" }
    ];
  }

  function buildDeploymentModes() {
    return [
      { id: "local", label: "本地个人使用", status: "ready", database: "SQLite", note: "适合单机长期整理私人记忆。" },
      { id: "demo", label: "课堂/演示模式", status: "ready", database: "临时或演示 SQLite", note: "建议使用脱敏数据和明确的 AI 调用说明。" },
      { id: "lan", label: "局域网共享", status: "planned", database: "SQLite + 访问控制", note: "进入前需要账号、权限和备份策略。" },
      { id: "cloud", label: "云端部署", status: "planned", database: "托管数据库或卷挂载 SQLite", note: "进入前需要 HTTPS、日志、备份、反向代理和密钥管理。" }
    ];
  }

  function buildBackupPolicy() {
    return {
      full: "/api/memories/export",
      redacted: "/api/memories/export?mode=redacted",
      restore: "POST /api/memories/import",
      purge: "DELETE /api/memories/purge with confirm=DELETE",
      recommendedCadence: "每次集中整理后导出一次完整包；对外演示只使用脱敏包。",
      storageAdvice: "完整包建议保存到个人可信设备或加密盘，脱敏包可用于演示、排查和跨设备预览。"
    };
  }

  function buildRiskRegister(memories = []) {
    const stats = getStats();
    const memoryCount = stats.total || memories.length;
    return [
      { id: "privacy", label: "隐私与敏感线索", level: memoryCount > 0 ? "medium" : "low", mitigation: "导出、演示和 AI 调用前先查看 /api/privacy 与脱敏包。" },
      { id: "backup", label: "备份恢复", level: "medium", mitigation: "本阶段已有 JSON 导出/导入，后续需要加密包和自动备份。" },
      { id: "observability", label: "运行观测", level: "medium", mitigation: "当前有 health/version；生产部署前补请求日志、错误日志和 request id。" },
      { id: "module-size", label: "工程模块边界", level: "medium", mitigation: "后续拆分 server、agent、rag、workflow、privacy、operations 模块。" }
    ];
  }

  function buildReleaseHistory() {
    return [
      { version: appVersion, label: buildLabel, phase, date: "2026-06-24", summary: "阶段 19 第九版补充复核状态流转、字段别名规则、导入报告视图和批次审计检索。" },
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
      { version: "0.5.0", label: "phase15-assets-first-edition", phase: 15, date: "2026-06-23", summary: "阶段 15 第一版新增 saved_exhibitions/report_drafts 数据表、资产 API 和导出包字段。" },
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

  function buildLogArchiveInfo() {
    const exists = fs.existsSync(operationLogPath);
    const sizeBytes = exists ? fs.statSync(operationLogPath).size : 0;
    return {
      format: "jsonl",
      path: operationLogPath,
      exists,
      sizeBytes,
      inMemoryEvents: operationEvents.length,
      exportEndpoint: "/api/operations/export",
      retention: `last ${operationEventLimit} events in memory; file keeps append-only local history`
    };
  }

  function buildDemoKit(memories = []) {
    const structured = memories.map(buildStructuredMemory);
    const withDate = structured.filter((memory) => memory.date).length;
    const withPeople = structured.filter((memory) => memory.people.length).length;
    const withMedia = structured.filter(hasMultimodalStructured).length;
    const withGuideText = structured.filter((memory) => memory.exhibitText && (memory.tags.length || memory.emotions.length)).length;
    const readyScore = Math.round(([
      structured.length >= 3,
      withDate >= 2,
      withPeople >= 1,
      withMedia >= 1,
      withGuideText >= 2
    ].filter(Boolean).length / 5) * 100);
    return {
      ready: readyScore >= 60,
      score: readyScore,
      sampleCount: structured.length,
      checks: [
        { id: "sample-count", label: "至少 3 件展品", status: structured.length >= 3 ? "ready" : "needs-sample", count: structured.length },
        { id: "timeline", label: "时间线样本", status: withDate >= 2 ? "ready" : "needs-date", count: withDate },
        { id: "people", label: "人物关系线索", status: withPeople >= 1 ? "ready" : "needs-people", count: withPeople },
        { id: "media", label: "多模态线索", status: withMedia >= 1 ? "ready" : "needs-media", count: withMedia },
        { id: "guide", label: "讲解检索样本", status: withGuideText >= 2 ? "ready" : "needs-guide", count: withGuideText }
      ],
      storyline: [
        "从首页录入或导入 3 到 5 件温馨记忆展品",
        "运行 Agent 整理并保留人工复核状态",
        "打开讲解员提问，展示引用证据和可信度",
        "查看时间线、主题展、隐私策略和部署与运维面板",
        "导出脱敏包用于演示或排查"
      ],
      privacyNote: "演示前优先使用脱敏导出包，避免展示真实人物、地点、联系方式和原始附件线索。"
    };
  }

  function buildModuleBoundaryPlan() {
    return [
      { id: "routes", label: "HTTP routes", status: "split-active", firstFiles: ["server.js"], targetFiles: ["src/routes/health.js", "src/routes/operations.js", "src/routes/memories.js"], rule: "第三版已迁移 health 与 operations 路由分发；后续继续拆 memories 和 privacy。" },
      { id: "health", label: "Health route", status: "split-stable", firstFiles: ["server.js"], targetFiles: ["src/routes/health.js"], rule: "/api/health 已独立封装，继续保持 health smoke 覆盖。" },
      { id: "operations", label: "Operations", status: "split-stable", firstFiles: ["server.js", "scripts/phase14-readiness.js", "scripts/api-smoke.js"], targetFiles: ["src/services/operations.js", "src/routes/operations.js"], rule: "服务层和 route 层已分离；后续清理 server.js 旧实现并补更细的 route 测试。" },
      { id: "privacy", label: "Privacy", status: "ready-to-split", firstFiles: ["server.js", "app.js"], targetFiles: ["src/services/privacy.js", "src/ui/privacy-panel.js"], rule: "保持 /api/privacy 和数据主权导出字段兼容。" },
      { id: "agents", label: "Agent workflow", status: "split-after-routes", firstFiles: ["server.js", "database.js", "app.js"], targetFiles: ["src/services/agents.js", "src/services/workflows.js"], rule: "先用 smoke test 固定 workflow.run、steps、events 契约，再拆实现。" },
      { id: "frontend", label: "Frontend panels", status: "split-after-api", firstFiles: ["app.js"], targetFiles: ["src/ui/renderers.js", "src/ui/operations-panel.js", "src/ui/workflow-panel.js"], rule: "先按面板拆渲染函数，暂不引入构建工具。" }
    ];
  }

  function buildPhase14Readiness(memories = []) {
    const checks = [
      { id: "api-contract", label: "API 契约保护", status: "ready", detail: "api-smoke 已覆盖 health/version/operations/privacy/workflows/analyze/search/guide/insights。" },
      { id: "operations-guard", label: "运维保护网", status: "ready", detail: "已有 X-Request-Id、运行事件、JSONL 日志和运维导出包。" },
      { id: "docs-route", label: "重构路线文档", status: "ready", detail: "项目规划和白皮书已声明阶段 14 模块化目标。" },
      { id: "module-plan", label: "模块边界清单", status: "ready", detail: "routes、operations、privacy、agents、frontend 边界已列出。" },
      { id: "data-safety", label: "数据安全回归", status: "ready", detail: "导入、导出、脱敏、清空、隐私策略均有 smoke 回归。" },
      { id: "health-route", label: "Health 路由边界", status: "ready", detail: "/api/health 已从 server.js 抽离到 src/routes/health.js。" },
      { id: "phase15-plan", label: "第十五阶段准备", status: "ready", detail: "专题资产、报告草稿、引用来源和导出边界已有结构化计划。" },
      { id: "sample-signal", label: "演示样本信号", status: memories.length > 0 ? "ready" : "optional", detail: "无样本也可进入重构；有样本时更利于视觉回归。" }
    ];
    const readyCount = checks.filter((item) => item.status === "ready").length;
    return {
      targetPhase: 14,
      targetName: "工程模块化和服务边界重构",
      ready: readyCount >= 5,
      score: Math.round((readyCount / checks.length) * 100),
      checks,
      recommendedOrder: ["phase15-assets", "saved-exhibitions", "report-drafts", "asset-export", "privacy-review"],
      stopConditions: [
        "任一现有 API smoke 失败时暂停拆分",
        "导入导出结构变化时先补迁移说明",
        "前端面板拆分后必须保持无后端回退能力",
        "阶段 15 的资产保存接口落地前不得破坏现有导出结构"
      ],
      recommendation: readyCount >= 5
        ? "阶段 14 第三版已完成 health 与 operations route split，并具备进入阶段 15 的基础保护网。"
        : "继续补齐 API 契约、运维导出和模块边界后再推进阶段 14。"
    };
  }

  function buildPhase15AssetPlan(memories = []) {
    const structured = memories.map(buildStructuredMemory);
    return [
      { id: "saved-exhibitions", label: "可保存专题展", status: "active", detail: "已支持手动保存专题展，并可从 theme insights 生成草稿。" },
      { id: "report-drafts", label: "回忆报告草稿", status: "active", detail: "已支持手动保存报告草稿，并可从 phase10 insights 生成草稿。" },
      { id: "citation-lock", label: "引用来源锁定", status: "ready", detail: "现有报告和 guide citations 已保留展品引用，可作为资产保存时的证据来源。" },
      { id: "asset-export", label: "专题资产导出", status: "ready-to-design", detail: "在现有 JSON 导出包中增加 savedExhibitions 和 reportDrafts，不破坏旧字段。" },
      { id: "sample-route", label: "样本路线", status: structured.length > 0 ? "ready" : "optional", detail: "可从当前展品生成第一条专题展；无样本时仍可先完成模型和接口。" }
    ];
  }

  function buildPhase15Readiness(memories = []) {
    const structured = memories.map(buildStructuredMemory);
    const withDate = structured.filter((memory) => memory.date).length;
    const withThemeSignals = structured.filter((memory) => (
      memory.tags.length || memory.people.length || memory.location || memory.emotions.length || memory.hall?.id
    )).length;
    const withReportText = structured.filter((memory) => memory.exhibitText && memory.rawContent).length;
    const checks = [
      { id: "api-guard", label: "API 保护网", status: "ready", detail: "Phase 14 readiness 和 API smoke 已覆盖核心接口。" },
      { id: "route-boundary", label: "路由边界", status: "ready", detail: "health 与 operations routes 已从 server.js 抽离。" },
      { id: "insight-source", label: "洞察来源", status: "ready", detail: "phase10 insights 已提供时间线、主题候选、报告章节和引用来源。" },
      { id: "workflow-source", label: "工作流来源", status: "ready", detail: "phase11 workflow blueprint 已声明报告工作流与人工复核点。" },
      { id: "export-boundary", label: "导出边界", status: "ready", detail: "现有导出包可扩展 savedExhibitions/reportDrafts 字段。" },
      { id: "asset-api", label: "资产 API", status: "ready", detail: "/api/assets、/api/exhibitions、/api/exhibitions/from-theme、/api/report-drafts 和 /api/report-drafts/from-insights 已可用。" },
      { id: "sample-quality", label: "样本质量", status: structured.length > 0 && (withDate > 0 || withThemeSignals > 0 || withReportText > 0) ? "ready" : "optional", detail: "有样本可直接生成首个专题展；无样本时仍可先做资产模型。" }
    ];
    const readyCount = checks.filter((item) => item.status === "ready").length;
    return {
      targetPhase: 15,
      targetName: "专题资产、报告编辑和可保存展览",
      ready: readyCount >= 5,
      score: Math.round((readyCount / checks.length) * 100),
      checks,
      assetPlan: buildPhase15AssetPlan(memories),
      recommendedFirstBuild: [
        "前端增加可保存专题展编辑面板",
        "支持从主题候选按钮调用 /api/exhibitions/from-theme",
        "支持报告草稿章节编辑",
        "增加专题资产导出预览"
      ],
      recommendation: readyCount >= 5
        ? "可以进入阶段 15。建议先做可保存专题展和报告草稿模型，再做编辑与导出。"
        : "继续补齐专题资产模型、导出边界和报告引用来源后再进入阶段 15。"
    };
  }

  function buildOperationsExport(memories = []) {
    return {
      app: "AI 记忆博物馆",
      exportedAt: new Date().toISOString(),
      schemaVersion,
      phase,
      version: appVersion,
      buildLabel,
      operations: buildOperationsConsole(memories),
      logArchive: buildLogArchiveInfo(),
      demoKit: buildDemoKit(memories),
      phase14Readiness: buildPhase14Readiness(memories),
      phase15Readiness: buildPhase15Readiness(memories),
      phase15AssetPlan: buildPhase15AssetPlan(memories),
      moduleBoundaryPlan: buildModuleBoundaryPlan(),
      recentEvents: operationEvents.slice(0, operationEventLimit)
    };
  }

  function buildOperationsConsole(memories = []) {
    return {
      schemaVersion,
      phase,
      phaseName,
      version: appVersion,
      buildLabel,
      generatedAt: new Date().toISOString(),
      summary: buildOperationsSummary(memories),
      recentEvents: operationEvents.slice(0, 20),
      releaseHistory: buildReleaseHistory(),
      releaseChecklist: buildReleaseChecklist(memories),
      runbook: buildOperationsRunbook(),
      backupPolicy: buildBackupPolicy(),
      riskRegister: buildRiskRegister(memories),
      logArchive: buildLogArchiveInfo(),
      demoKit: buildDemoKit(memories),
      phase14Readiness: buildPhase14Readiness(memories),
      phase15Readiness: buildPhase15Readiness(memories),
      phase15AssetPlan: buildPhase15AssetPlan(memories),
      moduleBoundaryPlan: buildModuleBoundaryPlan()
    };
  }

  function buildOperationsSummary(memories = []) {
    const stats = getStats();
    const checklist = buildReleaseChecklist(memories);
    const readyCount = checklist.filter((item) => item.status === "ready").length;
    return {
      status: "operational",
      mode: process.env.NODE_ENV === "production" ? "production" : "local",
      checks: ["syntax", "phase15-readiness", "phase16-readiness", "api-smoke"],
      release: {
        channel: releaseChannel,
        label: buildLabel,
        checklistReady: readyCount,
        checklistTotal: checklist.length
      },
      data: {
        memories: stats.total || memories.length,
        multimodal: stats.multimodal || 0,
        agentRuns: stats.agentRuns || 0,
        databasePath: getDatabasePath()
      },
      backup: {
        fullExport: "/api/memories/export",
        redactedExport: "/api/memories/export?mode=redacted",
        purge: "/api/memories/purge"
      },
      observability: {
        health: "/api/health",
        version: "/api/version",
        operations: "/api/operations",
        logs: "in-memory-recent-events",
        requestId: "X-Request-Id",
        recentEvents: operationEvents.length
      },
      backupPolicy: buildBackupPolicy(),
      readiness: {
        phase14: true,
        phase15: true,
        phase16: true,
        phase17: true,
        phase18: true,
        modularizationReady: true,
        assetModelReady: true,
        deployableLocal: true,
        productionReady: false,
        reason: "阶段 19 第九版已补充复核状态流转、字段别名规则、导入报告视图和批次审计检索。"
      }
    };
  }

  return {
    buildVersionInfo,
    buildOperationsSummary,
    buildOperationsConsole,
    buildOperationsExport,
    buildPhase14Readiness,
    buildPhase15Readiness,
    buildPhase15AssetPlan,
    buildModuleBoundaryPlan
  };
}

module.exports = { createOperationsService };
