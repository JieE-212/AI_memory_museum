"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "public/assets/media-ocr.js"), "utf8");
const css = fs.readFileSync(path.join(root, "public/media-ocr.css"), "utf8");
let assertions = 0;

function check(value, message) {
  assert.ok(value, message);
  assertions += 1;
}

function equal(actual, expected, message) {
  assert.equal(actual, expected, message);
  assertions += 1;
}

const sandbox = {};
sandbox.globalThis = sandbox;
vm.runInNewContext(source, sandbox, { filename: "media-ocr.js" });
const api = sandbox.TimeIsleMediaOcr;

check(api && typeof api.renderOcrPanel === "function", "应公开独立渲染函数");
check(typeof api.hydrate === "function", "应公开可重复接线的 hydrate 函数");

const html = api.renderOcrPanel({
  memoryId: "memory-safe",
  assetId: "asset-safe",
  displayUrl: "/api/media/asset-safe/display",
  altText: '"><script>bad()</script>',
  existingRegions: [{
    label: "车票<旧>",
    locator: { coordinateSpace: "canonical-preview-v1", x: 0.1, y: 0.2, width: 0.3, height: 0.4 }
  }]
});

check(html.startsWith('<details class="media-ocr-panel"'), "面板应使用默认折叠的 details");
check(!/^<details[^>]*\sopen(?:\s|>)/.test(html), "辅助摘录不得默认展开");
check(html.includes("辅助摘录，不是事实判断"), "应明确说明结果不是事实判断");
check(html.includes("默认不保存") && html.includes("不会自动写入展品正文"), "应明确草稿和正文写入边界");
check(html.includes("可编辑摘录草稿") && /<textarea[^>]*data-ocr-draft/.test(html), "识别结果必须先进入可编辑 textarea 草稿");
check(html.includes("我已核对圈选区域和摘录文字"), "保存前应要求用户明确确认");
check(html.includes('type="number"') && ["x", "y", "width", "height"].every((name) => html.includes(`data-ocr-coordinate="${name}"`)), "应提供完整数值坐标键盘后备");
check(html.includes("车票&lt;旧&gt;") && !html.includes("<script>bad()"), "渲染内容应转义不可信文本");
check(html.includes("data-ocr-existing-region"), "应接收并呈现已有规范区域供用户主动沿用");

equal(api.renderOcrPanel({ memoryId: "m", assetId: "a", displayUrl: "https://tracker.example/photo.jpg" }), "", "不得接收远程图片 URL");
equal(api.renderOcrPanel({ memoryId: "../m", assetId: "a", displayUrl: "/local" }), "", "不得把非法 ID 带入 API 路径");

check(source.includes("typeof view.TextDetector") && source.includes("detector.detect(source)"), "应优先检测并调用浏览器本机 TextDetector");
check(source.includes("cropSelectedRegion") && source.includes("drawing.drawImage("), "本机检测前应裁切为用户选择的图片区域");
check(source.includes("MAX_CANVAS_PIXELS") && source.includes("MAX_CANVAS_EDGE"), "区域裁切应设置内存与尺寸上限");
check(source.includes("本机 TextDetector 不可用") && source.includes("当前仅提供手动摘录") && source.includes("不会伪装识别成功"), "不可用时应诚实回退为手动摘录");
check(source.includes("elements.draft.value = text") && source.includes("elements.confirm.checked = false"), "机器结果只能进入未确认草稿");
check(source.includes("if (!elements.confirm.checked)") && source.indexOf("if (!elements.confirm.checked)") < source.indexOf("method: \"POST\""), "确认门禁必须位于保存请求之前");
check(source.includes('regionType: "text"') && source.includes("/annotations`"), "只应保存为 text 类型图片区域证据");
check(!source.includes('method: "PUT"') && !source.includes("/api/analyze") && !source.includes("/api/guide"), "不得自动改写展品正文或触发 AI 分析");
check(source.includes("activeSession !== session") && source.includes("activeOperation !== recognitionOperation"), "异步识别应隔离会话和操作序列");
check(source.includes("requestControllers.forEach((controller) => controller.abort())") && source.includes("AbortController"), "异步保存应支持中止与清理");
check(source.includes("bitmap?.close?.()") && source.includes('elements.image.removeAttribute("src")'), "临时位图和图片引用应及时释放");
check(source.includes("图片不会发送到第三方") && source.includes("不向第三方上传"), "界面应显示清晰的隐私状态");
check(!/https?:\/\//i.test(source) && !/XMLHttpRequest|sendBeacon|WebSocket|EventSource/.test(source), "模块不得包含第三方网络路径或旁路传输");
check((source.match(/fetchImpl\(/g) || []).length === 1, "网络写入应只有已确认 annotation API 一处");
check(!/gradient\s*\(/i.test(css) && !/url\s*\(/i.test(css), "样式不得引入渐变或远程资源");
check(css.includes("@media (max-width: 780px)") && css.includes("prefers-reduced-motion"), "样式应兼顾窄屏和减少动态效果偏好");

check(assertions >= 25, "OCR 回归应覆盖至少 25 条隐私和确认门禁断言");
console.log(`Media OCR checks passed: ${assertions} assertions.`);
