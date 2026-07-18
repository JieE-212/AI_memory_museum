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
      architecture: ["Vanilla JS", "Node.js HTTP", "SQLite", "FTS5 Trigram + LIKE 回退", "实体线索档案", "内容寻址影像与声音", "人工确认转写", "事件级口述史", "证据锚点", "迁移账本", "可校验修订链"],
      productFlow: ["记录", "AI 整理", "照片与声音归档", "语义线索检索与讲解", "主题策展", "受限策展提案与逐项决定", "记忆回访", "时光胶囊与加密分享", "记忆考古", "口述史回答与时间来源", "历史恢复", "安全导出"],
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
      demo: demoStatus()
    };
  }

  return Object.freeze({ demoStatus, version });
}

module.exports = { createRuntimeMetadata };
