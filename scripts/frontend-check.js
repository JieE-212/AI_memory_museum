const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const html = read("public/index.html");
const css = read("public/styles.css");
const archaeologyCss = read("public/archaeology.css");
const app = read("public/assets/app.js");
const server = read("server.js");
const archaeology = read("lib/archaeology.js");
const archaeologyBackup = read("lib/archaeology-backup.js");
const pkg = JSON.parse(read("package.json"));
const queriedIds = [...app.matchAll(/querySelector\("#([a-zA-Z0-9_-]+)"\)/g)].map((match) => match[1]);
const htmlIds = [...html.matchAll(/\sid="([a-zA-Z0-9_-]+)"/g)].map((match) => match[1]);

const checks = [
  ["页面包含四个清晰主视图", ["collection", "compose", "reflect", "data"].every((view) => html.includes(`data-view-panel="${view}"`))],
  ["顶部导航仍严格保持四项", (html.match(/class="nav-button/g) || []).length === 4],
  ["脚本查询的 DOM ID 全部存在且页面 ID 不重复", queriedIds.every((id) => htmlIds.includes(id)) && new Set(htmlIds).size === htmlIds.length],
  ["时屿品牌结构完整", html.includes("<strong>时屿</strong>") && html.includes("<small>TIME ISLE</small>") && html.includes("AI 私人记忆策展工具")],
  ["核心记录表单存在", html.includes('id="memoryForm"') && html.includes('id="draftForm"')],
  ["已保存展品仍可编辑", html.includes('id="dialogEditButton"') && app.includes("editSelectedMemory")],
  ["讲解员和引用区域存在", html.includes('id="guideForm"') && html.includes('id="citationList"')],
  ["回顾视图包含时间线、主题和摘要", ["timelinePanel", "themesPanel", "reportPanel"].every((id) => html.includes(`id="${id}"`))],
  ["记忆考古使用局部航线和独立拼图", html.includes('id="routesPanel"') && html.includes('id="puzzleDialog"') && html.includes('id="dialogRouteButton"')],
  ["补一块拼图允许回答或保留不确定", ["puzzleSaveAnswerButton", "puzzleUnknownButton", "puzzleSkipButton"].every((id) => html.includes(`id="${id}"`))],
  ["回顾标签具备完整 ARIA 关联", (html.match(/role="tab"/g) || []).length === 4 && (html.match(/role="tabpanel"/g) || []).length === 4 && (html.match(/aria-controls="/g) || []).length === 4],
  ["考古概览失败不会拖垮核心馆藏", app.includes('requestJson("/api/archaeology/overview").catch(() => ({ overview: [] }))')],
  ["数据维护操作存在", ["exportButton", "exportRedactedButton", "importFile", "purgeButton"].every((id) => html.includes(`id="${id}"`))],
  ["页面不再暴露阶段治理术语", !/Phase\s*\d+|Reviewer|插件生态|运行时沙箱|发布审批/.test(html)],
  ["页面没有内联脚本或样式", !/<script(?!\s+src=)/i.test(html) && !/<style/i.test(html) && !/\sstyle="/i.test(html)],
  ["样式未使用渐变", !/gradient\s*\(/i.test(`${css}\n${archaeologyCss}`)],
  ["前端覆盖核心 API", ["/api/memories", "/api/analyze", "/api/search", "/api/guide", "/api/insights", "/api/privacy", "/api/archaeology/routes", "/api/archaeology/puzzle"].every((endpoint) => app.includes(endpoint))],
  ["考古结论保留人工确认边界", archaeology.includes('sameEvent: "unassessed"') && archaeology.includes("requiresConfirmation") && archaeology.includes("sourceQuote")],
  ["服务端不再加载旧运维治理模块", !server.includes("createOperationsService") && !server.includes("phase29") && !server.includes("phase30")],
  ["npm 命令保持精简", Object.keys(pkg.scripts || {}).length <= 7],
  ["核心文件规模已收敛", lineCount(server) < 1400 && lineCount(app) < 1200 && lineCount(css) < 1600 && lineCount(archaeologyCss) < 400 && lineCount(archaeology) < 900 && lineCount(archaeologyBackup) < 300]
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
