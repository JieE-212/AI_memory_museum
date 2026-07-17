"use strict";

function createPrivacySummary(options = {}) {
  const interviewDemo = Boolean(options.interviewDemo);
  const aiEnabled = Boolean(options.aiEnabled);
  const featureLocations = Array.isArray(options.featureLocations) ? options.featureLocations : [];
  const featureControls = Array.isArray(options.featureControls) ? options.featureControls : [];

  return function buildPrivacySummary() {
    return {
      mode: interviewDemo ? "interview-demo" : "local-first",
      summary: interviewDemo
        ? "当前是共享的公开面试 Demo，只使用示例数据和临时 SQLite；请勿提交私人内容。"
        : "记忆默认保存在本机 SQLite，只有配置 AI Key 并主动整理或提问时才会调用模型。",
      dataLocations: [
        { name: "记忆、拼图与 Agent 记录", location: interviewDemo ? "Vercel /tmp 临时 SQLite" : "本机 data/memory-museum.sqlite" },
        { name: "原图与缩略图", location: interviewDemo ? "公开 Demo 只读示例媒体" : "本机 data/media 内容寻址目录" },
        { name: "EXIF、相似候选与文字摘录", location: "默认在本机或浏览器内处理；GPS 不反查地点，文字草稿确认前不保存" },
        { name: "记忆航线与原文核验", location: "在服务端本地规则中计算，不发送给外部模型" },
        { name: "主题展览与引用", location: "保存于本机 SQLite；每条策展引用保留原文偏移并随原文修改重新核验" },
        ...featureLocations,
        { name: "AI 请求", location: aiEnabled ? "配置的 OpenAI-compatible API" : "未发送，使用本地 Mock" },
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

module.exports = { createPrivacySummary };
