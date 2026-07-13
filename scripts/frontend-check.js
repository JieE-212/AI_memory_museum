const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const html = read("public/index.html");
const css = read("public/styles.css");
const archaeologyCss = read("public/archaeology.css");
const mediaCss = read("public/media.css");
const mediaEvidenceCss = read("public/media-evidence.css");
const mediaCompareCss = read("public/media-compare.css");
const mediaOcrCss = read("public/media-ocr.css");
const mediaLabCss = read("public/media-lab.css");
const app = read("public/assets/app.js");
const mediaApp = read("public/assets/media.js");
const mediaEvidenceApp = read("public/assets/media-evidence.js");
const mediaCompareApp = read("public/assets/media-compare.js");
const mediaOcrApp = read("public/assets/media-ocr.js");
const mediaLabApp = read("public/assets/media-lab.js");
const portabilityApp = read("public/assets/portability.js");
const server = read("server.js");
const archaeology = read("lib/archaeology.js");
const archaeologyBackup = read("lib/archaeology-backup.js");
const pkg = JSON.parse(read("package.json"));
const vercel = JSON.parse(read("vercel.json"));
require(path.join(root, "public/assets/media-evidence.js"));
const mediaEvidenceMarkup = globalThis.TimeIsleMediaEvidence.renderPanel({
  id: "memory-check",
  media: [{ assetId: "asset-check", position: 0, width: 1200, height: 800, urls: { display: "/api/media/asset-check/display" } }]
});
const emptyMediaEvidenceMarkup = globalThis.TimeIsleMediaEvidence.renderPanel({ id: "memory-empty", media: [] });
const queriedIds = [app, mediaApp, mediaEvidenceApp, portabilityApp].flatMap((source) => [
  ...source.matchAll(/(?:querySelector\("#|getElementById\(")([a-zA-Z0-9_-]+)"\)/g)
].map((match) => match[1]));
const htmlIds = [...html.matchAll(/\sid="([a-zA-Z0-9_-]+)"/g)].map((match) => match[1]);

const checks = [
  ["页面包含四个清晰主视图", ["collection", "compose", "reflect", "data"].every((view) => html.includes(`data-view-panel="${view}"`))],
  ["顶部导航仍严格保持四项", (html.match(/class="nav-button/g) || []).length === 4],
  ["主导航暴露受控视图和唯一当前项", ["collection", "compose", "reflect", "data"].every((view) => new RegExp(`data-view="${view}"[^>]*aria-controls="view-${view}"`).test(html)) && (html.match(/aria-current="page"/g) || []).length === 1 && app.includes('button.setAttribute("aria-current", active ? "page" : "false")')],
  ["脚本查询的 DOM ID 全部存在且页面 ID 不重复", queriedIds.every((id) => htmlIds.includes(id)) && new Set(htmlIds).size === htmlIds.length],
  ["时屿品牌结构完整", html.includes("<strong>时屿</strong>") && html.includes("<small>TIME ISLE</small>") && html.includes("AI 私人记忆策展工具")],
  ["核心记录表单存在", html.includes('id="memoryForm"') && html.includes('id="draftForm"')],
  ["图片记录入口保持在现有记录流程", html.includes('id="photoInput"') && html.includes('id="photoTray"') && !html.includes('data-view="gallery"')],
  ["照片替代文字可独立核对并保留说明后备", html.includes('id="photoAltText"') && mediaApp.includes('updateSelected("altText"') && mediaApp.includes('altText: media.altText || ""') && mediaApp.includes('altText: String(item.altText || item.caption || "")') && mediaApp.includes('altText: saved.altText || ""') && mediaApp.includes('altText: item.altText') && mediaApp.includes('const alt = String(item.altText || caption')],
  ["照片线索保持为详情图库下的折叠入口", app.includes("TimeIsleMediaEvidence?.renderPanel(memory)") && mediaEvidenceMarkup.includes('<details class="media-evidence-panel"') && emptyMediaEvidenceMarkup === "" && !html.includes('data-view="evidence"')],
  ["照片线索资源已按依赖顺序接入", html.indexOf('/media-evidence.css') > html.indexOf('/media.css') && html.indexOf('/assets/media-evidence.js') > html.indexOf('/assets/media.js') && html.indexOf('/assets/media-evidence.js') < html.indexOf('/assets/app.js')],
  ["影像实验台保持详情内的可选折叠工具", app.includes("TimeIsleMediaLab?.renderPanel(memory") && mediaLabApp.includes('<details class="media-lab"') && !html.includes('data-view="media-lab"')],
  ["文字摘录依赖先于影像实验台载入", html.indexOf('/assets/media-ocr.js') < html.indexOf('/assets/media-lab.js') && html.indexOf('/assets/media-lab.js') < html.indexOf('/assets/app.js')],
  ["已保存展品仍可编辑", html.includes('id="dialogEditButton"') && app.includes("editSelectedMemory")],
  ["讲解员和引用区域存在", html.includes('id="guideForm"') && html.includes('id="citationList"')],
  ["回顾视图包含时间线、主题和摘要", ["timelinePanel", "themesPanel", "reportPanel"].every((id) => html.includes(`id="${id}"`))],
  ["记忆考古使用局部航线和独立拼图", html.includes('id="routesPanel"') && html.includes('id="puzzleDialog"') && html.includes('id="dialogRouteButton"')],
  ["补一块拼图允许回答或保留不确定", ["puzzleSaveAnswerButton", "puzzleUnknownButton", "puzzleSkipButton"].every((id) => html.includes(`id="${id}"`))],
  ["回顾标签具备完整 ARIA 关联", (html.match(/role="tab"/g) || []).length === 4 && (html.match(/role="tabpanel"/g) || []).length === 4 && (html.match(/role="tab"[^>]*aria-controls="/g) || []).length === 4],
  ["非导航视图切换聚焦标题且尊重减少动态偏好", app.includes('switchView(button.dataset.view)') && app.includes('switchView(button.dataset.goView, { focusHeading: true })') && app.includes('querySelector("h1")?.focus({ preventScroll: true })') && app.includes('matchMedia?.("(prefers-reduced-motion: reduce)")') && (html.match(/<h1 tabindex="-1">/g) || []).length === 4],
  ["详情内切换展品重置滚动并聚焦标题", html.includes('id="dialogTitle" tabindex="-1"') && app.includes("elements.dialogBody.scrollTop = 0") && app.includes("elements.dialogTitle.focus({ preventScroll: true })")],
  ["馆藏检索失败清空旧卡片并提供明确重试", html.includes('id="searchErrorState" hidden') && html.includes('id="retrySearchButton"') && app.includes('elements.retrySearchButton.addEventListener("click", performSearch)') && app.includes('elements.memoryGrid.innerHTML = "";') && app.includes("if (state.searchError)")],
  ["检索结果计数、零结果与失败通过状态区播报", /id="collectionMeta"[^>]*role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"/.test(html) && app.includes('`“${query}”找到 ${visible.length} 件展品${filterNote}`') && app.includes('elements.collectionMeta.textContent = "检索失败，请重试。";')],
  ["隐藏照片输入具有可见焦点代理", mediaCss.includes('label[for="photoInput"]:has(+ #photoInput:focus-visible)') && mediaCss.includes("outline: 2px solid var(--accent)")],
  ["添加照片折叠入口和 320px 字段布局保持克制可聚焦", mediaCss.includes(".media-field > summary:focus-visible") && mediaCss.includes(".media-field > summary::-webkit-details-marker") && mediaCss.includes("@media (max-width: 420px)") && mediaCss.includes("flex-direction: column;") && mediaCss.includes(".media-field-heading .media-privacy-field")],
  ["媒体错误文字和窄屏按钮满足可读触控边界", mediaOcrCss.includes('.media-ocr-status[data-state="error"] {\n  color: var(--danger);') && mediaLabCss.includes('.media-lab-status[data-state="error"] {\n  color: var(--danger);') && mediaOcrCss.includes(".media-ocr-panel button {\n    min-height: 44px;") && mediaLabCss.includes(".media-lab button {\n    min-height: 44px;")],
  ["考古概览失败不会拖垮核心馆藏", app.includes('requestJson("/api/archaeology/overview").catch(() => ({ overview: [] }))')],
  ["数据维护操作存在并呈现媒体清理状态", ["exportButton", "exportRedactedButton", "archiveImportFile", "importFile", "purgeButton"].every((id) => html.includes(`id="${id}"`)) && app.includes("result.mediaCleanupPending")],
  ["页面不再暴露阶段治理术语", !/Phase\s*\d+|Reviewer|插件生态|运行时沙箱|发布审批/.test(html)],
  ["页面没有内联脚本或样式", !/<script(?!\s+src=)/i.test(html) && !/<style/i.test(html) && !/\sstyle="/i.test(html)],
  ["Vercel 静态页面复用完整安全响应头", hasVercelSecurityHeaders(vercel)],
  ["样式未使用渐变", !/gradient\s*\(/i.test(`${css}\n${archaeologyCss}\n${mediaCss}\n${mediaEvidenceCss}\n${mediaCompareCss}\n${mediaOcrCss}\n${mediaLabCss}`)],
  ["前端覆盖核心 API", ["/api/memories", "/api/analyze", "/api/search", "/api/guide", "/api/insights", "/api/privacy", "/api/archaeology/routes", "/api/archaeology/puzzle"].every((endpoint) => app.includes(endpoint))],
  ["图片前端覆盖安全上传和关联 API", ["/uploads", "/complete", "/api/memories/"].every((endpoint) => mediaApp.includes(endpoint))],
  ["图片关联失败后复用已创建展品而不重复新增", app.includes("const targetMemoryId = state.editingMemoryId || state.pendingSaveMemoryId;") && app.includes('method: targetMemoryId ? "PUT" : "POST"') && app.indexOf("state.pendingSaveMemoryId = saved.memory.id") < app.indexOf("mediaController?.saveToMemory(saved.memory.id)") && app.includes("不会重复创建展品") && app.includes('return "继续完成保存"') && app.includes('state.pendingSaveMemoryId = "";')],
  ["服务器先验图像头再触发浏览器解码", mediaApp.indexOf("const begin = await request(") < mediaApp.indexOf("const variants = await createDerivedWebps")],
  ["照片线索覆盖读取、新增和删除 API", mediaEvidenceApp.includes("/annotations") && mediaEvidenceApp.includes('method: "POST"') && mediaEvidenceApp.includes('method: "DELETE"')],
  ["照片圈选与键盘坐标共用规范化坐标", ["pointerdown", "pointermove", "pointerup", "canonical-preview-v1"].every((token) => mediaEvidenceApp.includes(token)) && ['type="number"', 'name="width"', 'name="height"'].every((token) => mediaEvidenceMarkup.includes(token))],
  ["照片线索保存要求用户明确确认", mediaEvidenceApp.includes("我已亲自核对圈选区域与说明，并确认保存") && mediaEvidenceApp.includes("elements.confirm.checked")],
  ["照片线索具备 Demo 只读和会话清理", mediaEvidenceApp.includes("elements.form.hidden = demo") && mediaEvidenceApp.includes("requestControllers.forEach((controller) => controller.abort())") && app.includes('memoryDialog.addEventListener("close"')],
  ["照片线索不冒充 AI 判断", mediaEvidenceApp.includes("不会生成或补写 AI 结论") && mediaEvidenceApp.includes("由你确认")],
  ["时光对照明确是手动对齐而非自动识别", mediaCompareApp.includes("手动对齐，不是自动识别") && app.includes("TimeIsleMediaCompare?.renderComparison") && server.includes("imageCompare")],
  ["照片文字只在明确确认后保存并同步区域证据", mediaOcrApp.includes("本机识别") && mediaOcrApp.includes("elements.confirm.checked") && mediaOcrApp.includes('regionType: "text"') && mediaOcrApp.includes("timeisle:media-ocr-saved") && mediaEvidenceApp.includes("handleOcrSaved")],
  ["近似图片只提供人工复核候选", mediaLabApp.includes("可能相似 · 需人工核对") && !mediaLabApp.includes('method: "DELETE"') && mediaLabApp.includes("/similar?limit=8")],
  ["完整归档与旧 JSON 工具分层", portabilityApp.includes("/api/archive/export") && portabilityApp.includes("/api/archive/restore") && html.includes("JSON 兼容工具")],
  ["考古结论保留人工确认边界", archaeology.includes('sameEvent: "unassessed"') && archaeology.includes("requiresConfirmation") && archaeology.includes("sourceQuote")],
  ["服务端不再加载旧运维治理模块", !server.includes("createOperationsService") && !server.includes("phase29") && !server.includes("phase30")],
  ["npm 命令保持精简", Object.keys(pkg.scripts || {}).length <= 7],
  ["核心文件规模已收敛", lineCount(server) < 1400 && lineCount(app) < 1325 && lineCount(mediaApp) < 1150 && lineCount(mediaEvidenceApp) < 850 && lineCount(mediaCompareApp) < 850 && lineCount(mediaOcrApp) < 750 && lineCount(mediaLabApp) < 500 && lineCount(portabilityApp) < 250 && lineCount(css) < 1600 && lineCount(archaeologyCss) < 400 && lineCount(mediaCss) < 700 && lineCount(mediaEvidenceCss) < 500 && lineCount(archaeology) < 900 && lineCount(archaeologyBackup) < 300]
];

let failed = 0;
for (const [name, condition] of checks) {
  if (!condition) {
    failed += 1;
    console.error(`not ok - ${name}`);
  } else {
    console.log(`ok - ${name}`);
  }
}

if (failed) {
  console.error(`Frontend checks failed: ${failed}`);
  process.exit(1);
}

console.log("Frontend checks passed.");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function lineCount(value) {
  return value.split(/\r?\n/).length;
}

function hasVercelSecurityHeaders(config) {
  const headers = Object.fromEntries((config.headers?.find((item) => item.source === "/(.*)")?.headers || []).map((item) => [item.key, item.value]));
  return headers["X-Content-Type-Options"] === "nosniff"
    && headers["Referrer-Policy"] === "same-origin"
    && headers["X-Frame-Options"] === "DENY"
    && headers["Permissions-Policy"] === "camera=(), microphone=(), geolocation=()"
    && headers["Content-Security-Policy"] === "default-src 'self'; connect-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
}
