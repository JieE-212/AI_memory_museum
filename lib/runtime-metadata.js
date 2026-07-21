"use strict";

function createRuntimeMetadata(options = {}) {
  const appVersion = String(options.appVersion || "");
  const interviewDemo = Boolean(options.interviewDemo);
  const aiEnabled = Boolean(options.aiEnabled);
  const limits = options.demoLimits && typeof options.demoLimits === "object"
    ? { ...options.demoLimits }
    : null;
  if (!/^\d+\.\d+\.\d+$/.test(appVersion)) throw new TypeError("Runtime metadata requires a semantic app version.");

  function demoStatus() {
    return {
      interviewDemo,
      mode: interviewDemo ? "interview-demo" : "local",
      storage: interviewDemo ? "ephemeral-sqlite-on-tmp" : "local-sqlite",
      seededExamples: interviewDemo ? 4 : 0,
      seededExhibitions: interviewDemo ? 1 : 0,
      seededTimeCalibrations: interviewDemo ? 1 : 0,
      seededOralHistoryAnswers: 0,
      oralHistoryMode: interviewDemo ? "read-only-question" : "local-write-with-confirmation",
      curatorAgentMode: interviewDemo ? "read-only-synthetic-sample" : "local-bounded-read-only-tools",
      memoryInboxMode: interviewDemo ? "read-only-synthetic-sample" : "local-verified-text-anchors",
      coMemoryMode: interviewDemo ? "disabled-no-file-input-no-save" : "local-encrypted-file-round-trip",
      memoryLensMode: interviewDemo ? "read-only-deterministic-preview" : "local-deterministic-preview",
      multiPerspectiveMode: interviewDemo ? "read-only-synthetic-preview" : "local-derived-read-only-preview",
      semanticRecallMode: interviewDemo ? "device-worker-read-only-demo" : "device-worker-memory-only",
      museumLockMode: interviewDemo ? "disabled-read-only-demo" : "local-write-gate",
      structuralRecoveryDrillMode: interviewDemo ? "disabled-no-archive-upload" : "local-structural-verification-only",
      isolatedRecoveryDrillMode: interviewDemo ? "disabled-no-archive-upload" : "local-single-use-real-restore",
      seededMemoryInboxItems: 0,
      seededCuratorAgentRuns: 0,
      destructiveActionsBlocked: interviewDemo,
      aiMode: aiEnabled ? "configured" : "mock-fallback",
      limits: interviewDemo && limits ? { ...limits } : null
    };
  }

  function version() {
    return {
      name: "时屿",
      englishName: "TIME ISLE",
      tagline: "AI 私人记忆策展工具",
      version: appVersion,
      runtime: `Node.js ${process.version}`,
      architecture: ["Vanilla JS", "Node.js HTTP", "SQLite", "FTS5 Trigram + LIKE 回退", "Transformers.js q8 / ONNX WASM", "UTF-8 / UTF-16 来源锚点", "实体线索档案", "内容寻址影像与声音", "人工确认转写", "事件级口述史", "共忆信笺加密往返", "设备内确定性镜片", "确定性多视角对照", "锁馆写入门禁", "结构恢复验真", "证据锚点", "迁移账本", "可校验修订链"],
      productFlow: ["记录或从文档逐段收件", "人工确认入馆", "AI 整理", "照片与声音归档", "字段与线索检索及讲解", "设备内按意思找回", "主题策展", "受限策展提案与逐项决定", "共忆见证", "设备内可解释镜片", "多视角记忆对照", "记忆回访", "时光胶囊与加密分享", "记忆考古", "口述史回答与时间来源", "历史恢复", "锁馆与一次性真实恢复演练", "安全导出"],
      v7: {
        timeCapsules: "未到期只返回外壳；本地日期是仪式门槛，不是密码学时间锁",
        offlineSharing: "浏览器端 PBKDF2-SHA-256 + AES-256-GCM，口令不上传、不持久化",
        offlineFile: "单个 HTML、无外链、可断网阅读",
        pwa: "可安装外壳只提供离线边界页，不缓存私人馆藏"
      },
      v72: {
        revisions: "本机 SHA-256 父链记录正文版本；恢复旧版会创建新的 head",
        concurrency: "If-Match 乐观并发阻止静默覆盖"
      },
      v73: {
        sharePrivacy: "安全素材读取后先在浏览器内形成临时分享副本；逐项删改不会回写来源，确认后才进入口令加密",
        shareReceipt: "公开外壳、解密后内容与固定排除项分层核对，边界回执随加密载荷保存",
        revisitIntent: "欢迎、延期、暂停或恢复自然回访均来自用户明确选择，不保存原因，也不推断心理状态"
      },
      v8: {
        uncertainTimeline: "时间校准只保存用户确认的展示范围、来源摘要或保留多种记录；不会回写展品日期，也不会裁决唯一真实时间",
        provenanceReview: "来源集合使用内容稳定摘要；修订、原文锚点或照片时间发生变化后，旧判断会进入待复核"
      },
      v9: {
        oralHistory: "只为已确认事件中仍未解决的日期分歧生成一个问题；声音选段、文字稿和时间含义都由用户明确提供",
        humanBoundary: "不自动转写、不识别说话人、不判断情绪，也不把回答发布或挂靠到任意单件展品",
        provenance: "草稿与‘仍不确定’不会成为日期候选；确认后的单日或范围才以事件级独立来源进入待校准时间线"
      },
      v10: {
        boundedAgent: "固定四项本地只读工具、六步/四次读取/两秒硬预算；不访问网络、文件、任意 SQL，也不把记忆正文解释成指令",
        humanDecisions: "策展助手只生成绑定来源快照的提案；保存草稿、确认关联与发布分别需要一次独立人工决定，分享只交接现有隐私编辑台",
        replayableEvaluation: "运行回执与提案使用规范 SHA-256；评测只从冻结回执重建，不重新读取馆藏或调用外部模型",
        restoreBoundary: "完整私人归档可迁移审计记录；恢复后强制为待复核只读历史，不能再次授权执行"
      },
      v11: {
        memoryInbox: "UTF-8 TXT/Markdown 只在浏览器临时读取；服务端重算原文件、文本与逐字片段哈希，整份源文件不落库",
        admission: "来源片段与新展品在同一事务确认；原文由不可变锚点提供，客户端不能在入馆时替换",
        humanBoundary: "候选不自动入馆，也不自动推断日期、人物、关系、说话人或情绪；公开 Demo 保持来源与展品零写入"
      },
      v12: {
        coMemoryLetters: "一问一答信笺与回信在浏览器端使用 PBKDF2-SHA-256 + AES-256-GCM 加密，并用请求摘要绑定往返；文件不会自动发送、导入或合并原记忆",
        witnessBoundary: "回信身份始终是自述且未验证，文件加密但未签名；用户必须预览并明确确认，系统不据此推断人物、关系、日期或事实",
        storageBoundary: "馆外请求/回信文件保持密文；确认入馆后，问答与来源锚点作为本机 SQLite 中的普通明文结构保存，仍依赖设备磁盘与系统账号保护",
        restoreBoundary: "完整归档迁移问答和来源锚点，脱敏归档只保留安全计数；绑定、哈希、引用或 ID 冲突会在写入前整批拒绝"
      },
      v13: {
        memoryLenses: "时间、共同出现、证据与线索四种镜片只重排已保存字段和已确认来源；按明确 ID 在服务端重读 2–20 件展品，客户端不上传正文",
        localBoundary: "固定确定性规则、零外部模型、零工具调用、零保存；结果只是可解释预览，不认定事实，也不推断人物关系、日期或情绪",
        curatorHandoff: "只有用户明确选择的 2–6 件展品可作为未保存简报交给策展助手；7–20 件必须重新选择，系统不会静默截断、自动运行、保存或发布"
      },
      v14: {
        museumLock: "锁馆先等待在途写操作结束，再在读取正文前以 423 阻止新的写请求；GET、导出、归档验真与结构恢复演练保持只读可用",
        verifierBoundary: "本机只保存由口令派生的 verifier、盐与 KDF 参数，不保存明文口令；敏感 verifier 不进入普通 JSON、.time-isle、日志或公开状态投影",
        encryptionBoundary: "锁馆是应用层写入门禁，不会加密 SQLite、图片、声音或磁盘，也不阻止拥有设备和数据文件的人绕过应用读取明文",
        recoveryDrill: "结构演练只在隔离暂存中核对完整归档的 manifest、哈希与引用；不恢复当前馆藏、不执行隔离恢复，也不能证明具备灾难恢复能力"
      },
      v15: {
        isolatedRestore: "完整备份会真实恢复到一次性 SQLite、图片与声音副本，并在返回成功前完成数据库、引用与媒体哈希体检",
        capabilityBoundary: "演练运行时不会获得当前馆藏 store、数据库路径或媒体存储能力；锁馆期间仍可运行",
        cleanupBoundary: "临时数据库必须先关闭，整个一次性副本必须确认销毁后才返回通过回执；清理失败会关闭式失败",
        recoveryBoundary: "只证明这份备份可在当前版本与当前机器的一次性副本恢复，不证明异机灾备、生产 RTO/RPO、磁盘加密或进程隔离"
      },
      v16: {
        comparison: "在单件展品详情中并列当前记录、同一馆主的编辑年轮、已确认入馆的亲友回信与已有时间判断；只有人工确认的来源关系才形成对照主张",
        identityBoundary: "亲友称呼始终来自回信人自述，身份未核验、文件未签名；系统不计算可信度，不宣布谁对谁错，也不把文字差异自动解释为矛盾",
        derivedBoundary: "独立 GET 接口以固定规则从 schema 19 已保存数据即时派生，零模型、零工具、零保存；不新增数据库表或归档章节",
        handoffBoundary: "操作只打开既有来源护照、记忆年轮或时光拼图；不会自动建立关系、恢复旧版、确认时间或改写展品"
      },
      v17: {
        semanticRecall: "用户主动启用后，浏览器 Worker 使用自托管 bge-small-zh-v1.5 q8 模型生成真实 512 维 embedding，并按文本相似度找回展品",
        sourceBoundary: "GET-only 快照最多包含 500 件展品，只投影标题、说明、正文、标签和已确认文字稿；不包含媒体、未确认文字稿、实体或来源护照",
        privacyBoundary: "模型、tokenizer 与 WASM 全部同源自托管；查询、向量和索引只留在当前 Worker 内存，不写入 localStorage、IndexedDB 或服务端",
        interpretationBoundary: "相似度排序不是事实、人物关系、情绪、真实性或概率判断；模型不可用时明确回退到字段与线索检索"
      },
      demo: demoStatus()
    };
  }

  return Object.freeze({ demoStatus, version });
}

module.exports = { createRuntimeMetadata };
