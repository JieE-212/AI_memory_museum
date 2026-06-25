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
      phase20PlatformPlan: buildPhase20PlatformPlan(memories),
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
      { id: "phase20-readiness", label: "第二十阶段平台与插件检查", status: "ready", command: "node scripts/phase20-readiness.js" },
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
      { version: "1.0.10", label: "phase20-template-preview-fixtures", phase, date: "2026-06-25", summary: "Phase 20 eleventh edition adds template preview fixtures, negative fixture blocking, preview workflows, and fixture export coverage while runtime execution stays disabled." },
      { version: "1.0.9", label: "phase20-plugin-installation-workflow", phase, date: "2026-06-25", summary: "Phase 20 tenth edition adds a plugin installation workflow with manifest import, signature verification, permission review, contract tests, sandbox checks, and audit decisions while runtime execution stays disabled." },
      { version: "1.0.8", label: "phase20-signed-plugin-manifest", phase, date: "2026-06-25", summary: "Phase 20 ninth edition adds signed manifest policy, digest fields, trust checks, and blocked unsigned plugin samples while runtime execution stays disabled." },
      { version: "1.0.7", label: "phase20-no-code-template-pack", phase, date: "2026-06-25", summary: "Phase 20 eighth edition adds no-code template packs for importer, exporter, agent-tool, asset-template, and sync-adapter extension points while runtime execution stays disabled." },
      { version: "1.0.6", label: "phase20-plugin-sandbox-boundary", phase, date: "2026-06-25", summary: "Phase 20 seventh edition defines plugin sandbox boundaries, blocked capabilities, data access limits, and runtime handoff gates while execution stays disabled." },
      { version: "1.0.5", label: "phase20-extension-contract-tests", phase, date: "2026-06-25", summary: "Phase 20 sixth edition adds extension contract test suites, fixture expectations, failure policy, and readiness coverage while plugin runtime stays disabled." },
      { version: "1.0.4", label: "phase20-built-in-plugin-registry", phase, date: "2026-06-25", summary: "阶段 20 第五版补充内置插件注册表、能力目录、输入输出契约和注册表检查项。" },
      { version: "1.0.3", label: "phase20-plugin-audit-log", phase, date: "2026-06-25", summary: "阶段 20 第四版补充插件审计日志模型、审计事件 schema、运行阻断样例和导出字段。" },
      { version: "1.0.2", label: "phase20-plugin-permission-review", phase, date: "2026-06-25", summary: "阶段 20 第三版补充插件权限复核策略、默认拒绝、人工确认、内置插件决策和审计事件类型。" },
      { version: "1.0.1", label: "phase20-plugin-manifest-schema", phase, date: "2026-06-25", summary: "阶段 20 第二版补充插件 manifest schema、权限标签、扩展点契约和内置插件 manifest 摘要。" },
      { version: appVersion, label: buildLabel, phase, date: "2026-06-25", summary: "阶段 20 第一版启动可扩展产品平台和插件生态边界，新增插件清单、扩展点、安全策略和 readiness 检查。" },
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

  function buildPhase20PlatformPlan(memories = []) {
    const stats = getStats();
    return {
      phase: 20,
      phaseName: "可扩展产品平台和插件生态版",
      version: appVersion,
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
        memoryCount: stats.total || memories.length,
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
      phase20PlatformPlan: buildPhase20PlatformPlan(memories),
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
      phase20PlatformPlan: buildPhase20PlatformPlan(memories),
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
      checks: ["syntax", "phase15-readiness", "phase16-readiness", "phase17-readiness", "phase18-readiness", "phase19-readiness", "phase20-readiness", "api-smoke"],
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
        phase19: true,
        phase20: true,
        modularizationReady: true,
        assetModelReady: true,
        deployableLocal: true,
        productionReady: false,
        reason: "阶段 20 第十一版已补充平台边界、内置插件清单、扩展点、安全策略、模板预览 fixtures 和插件安装流程模型。"
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
    buildPhase20PlatformPlan,
    buildModuleBoundaryPlan
  };
}

module.exports = { createOperationsService };
