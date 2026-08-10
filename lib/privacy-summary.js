"use strict";

function createPrivacySummary(options = {}) {
  const interviewDemo = Boolean(options.interviewDemo);
  const aiEnabled = Boolean(options.aiEnabled);
  const deploymentKind = String(options.deploymentKind || "local");
  const featureLocations = Array.isArray(options.featureLocations) ? options.featureLocations : [];
  const featureControls = Array.isArray(options.featureControls) ? options.featureControls : [];

  return function buildPrivacySummary() {
    return {
      mode: interviewDemo ? "interview-demo" : "local-first",
      summary: interviewDemo
        ? "当前是公开只读 Demo，只展示虚构样例；访客的新增、修改和删除请求会在读取正文前被拒绝。"
        : "记忆默认保存在本机 SQLite；即使配置了外部模型，每次外发仍需在操作前明确同意。",
      dataLocations: [
        { name: "当前模式", location: interviewDemo ? "公开只读 Demo；访客输入零持久化" : "私人本地馆藏；仅当前设备可写" },
        { name: "记忆、拼图与整理记录", location: interviewDemo ? `${deploymentLabel(deploymentKind)}公开实例的临时 SQLite，仅保存虚构播种数据` : "本机 data/memory-museum.sqlite" },
        { name: "原图与缩略图", location: interviewDemo ? "公开 Demo 只读示例媒体" : "本机 data/media 内容寻址目录" },
        { name: "EXIF、相似候选与文字摘录", location: "默认在本机或浏览器内处理；GPS 不反查地点，文字草稿确认前不保存" },
        { name: "记忆航线与原文核验", location: "在服务端本地规则中计算，不发送给外部模型" },
        { name: "主题展览与引用", location: "保存于本机 SQLite；每条策展引用保留原文偏移并随原文修改重新核验" },
        ...featureLocations,
        { name: "AI 请求", location: aiEnabled ? "配置了 OpenAI-compatible API；只有逐次明确同意后才发送页面列明的字段" : "未发送；整理与讲解使用本地规则" },
        { name: "导出文件", location: "由浏览器下载到用户选择的位置" }
      ],
      controls: [
        "自校验 .time-isle 完整备份",
        "原图或安全展示图二选一",
        "物理排除图片的脱敏归档",
        "损坏归档零写入恢复",
        "明确确认后清空本地数据库",
        ...featureControls
      ],
      destructiveActionsBlocked: interviewDemo
    };
  };
}

function deploymentLabel(kind) {
  if (kind === "cloudbase") return "CloudBase ";
  if (kind === "vercel") return "Vercel ";
  return "当前";
}

module.exports = { createPrivacySummary };
