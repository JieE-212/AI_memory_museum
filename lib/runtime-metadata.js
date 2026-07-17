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
      architecture: ["Vanilla JS", "Node.js HTTP", "SQLite", "FTS5 Trigram + LIKE 回退", "实体线索档案", "内容寻址影像与声音", "人工确认转写", "证据锚点", "迁移账本", "可校验修订链"],
      productFlow: ["记录", "AI 整理", "照片与声音归档", "语义线索检索与讲解", "主题策展", "记忆回访", "时光胶囊与加密分享", "记忆考古", "历史恢复", "安全导出"],
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
      demo: demoStatus()
    };
  }

  return Object.freeze({ demoStatus, version });
}

module.exports = { createRuntimeMetadata };
