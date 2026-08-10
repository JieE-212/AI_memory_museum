"use strict";

const GUIDE_LEAD_PATTERN = /^(?:(?:这件展品|这段记忆)\s*)?(?:主要)?(?:记录了|讲述了|写下了|讲的是|说的是)\s*[：:,，]?\s*/u;
const ENDING_PATTERN = /[\s。！？!?；;,，]+$/u;

function buildGuideCitationLine(memory, index, maxLength = 90) {
  const title = String(memory?.title || "未命名展品").trim() || "未命名展品";
  const source = String(memory?.exhibitText || memory?.rawContent || "").normalize("NFC").trim().slice(0, maxLength);
  const excerpt = source.replace(GUIDE_LEAD_PATTERN, "").replace(ENDING_PATTERN, "").trim();
  if (!excerpt) return `[${index + 1}]《${title}》暂时没有可引用的文字。`;
  return `[${index + 1}]《${title}》讲的是${excerpt}。`;
}

module.exports = { buildGuideCitationLine };
