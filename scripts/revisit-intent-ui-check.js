"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const html = read("public/index.html");
const source = read("public/assets/revisit-intents.js");
const revisits = read("public/assets/revisits.js");
const css = read("public/revisit-intents.css");

require(path.join(root, "public", "assets", "revisit-intents.js"));
const moduleApi = globalThis.TimeIsleRevisitIntents;
let assertions = 0;

ok(moduleApi && typeof moduleApi.createController === "function", "回访意愿前端模块可独立加载");
ok(typeof moduleApi.normalizeIntent === "function", "回访意愿前端暴露纯规范化函数");

deepEqual(
  moduleApi.normalizeIntent({ memoryId: "memory_1", choice: "neutral" }),
  { memoryId: "memory_1", choice: "neutral", notBeforeLocalDate: "", timezone: "", updatedAt: "", memory: null },
  "neutral 不携带长期日期或时区"
);
deepEqual(
  moduleApi.normalizeIntent({ memoryId: "memory_1", choice: "later", notBeforeLocalDate: "2026-08-01", timezone: "Asia/Shanghai" }),
  { memoryId: "memory_1", choice: "later", notBeforeLocalDate: "2026-08-01", timezone: "Asia/Shanghai", updatedAt: "", memory: null },
  "later 保留用户明确选择的本地日期与时区"
);
equal(moduleApi.normalizeIntent({ memoryId: "memory_1", choice: "later", notBeforeLocalDate: "", timezone: "UTC" }).choice, "neutral", "缺少日期的 later 安全回退为 neutral");
equal(moduleApi.normalizeIntent({ memoryId: "memory_1", choice: "later", notBeforeLocalDate: "2026-08-01", timezone: "" }).choice, "neutral", "缺少时区的 later 安全回退为 neutral");
equal(moduleApi.normalizeIntent({ memoryId: "../unsafe", choice: "pause" }).memoryId, "", "不安全展品 ID 不进入 DOM 或请求路径");

for (const id of ["revisitIntentManager", "revisitIntentManagerStatus", "revisitIntentManagerList"]) {
  equal((html.match(new RegExp(`id="${id}"`, "g")) || []).length, 1, `${id} 在页面中唯一存在`);
}
ok(html.includes('<details class="revisit-intent-manager" id="revisitIntentManager">'), "长期意愿管理默认折叠");
ok(!html.includes('<details class="revisit-intent-manager" id="revisitIntentManager" open'), "页面不会启动时自动展开管理区");
ok(html.includes('id="revisitIntentManagerStatus" role="status" aria-live="polite"'), "管理状态使用可访问 live region");
equal((html.match(/class="nav-button/g) || []).length, 4, "回访意愿不增加第五项主导航");
ok(!html.includes('data-view="revisit-intent"'), "回访意愿留在回顾页渐进区域");

const intentScript = html.indexOf('/assets/revisit-intents.js?v=8.0.0');
const revisitScript = html.indexOf('/assets/revisits.js?v=8.0.0');
const appScript = html.indexOf('/assets/app.js?v=8.0.0');
ok(intentScript > 0 && intentScript < revisitScript && revisitScript < appScript, "资源按意愿模块、回访控制器、主应用顺序加载");
equal((html.match(/\/revisit-intents\.css\?v=8\.0\.0/g) || []).length, 1, "回访意愿样式只加载一次");
ok(revisits.includes("TimeIsleRevisitIntents?.createController"), "今日回访控制器接入长期意愿子模块");
ok(revisits.includes("intentController?.renderPanel(memory, current.intent)"), "单件展品在呈现后才生成意愿面板");
ok(revisits.includes("button.disabled = busyAction || busyLoad") && revisits.includes("if (!button || busyAction || busyLoad) return;"), "读取候选期间禁止切换方式，避免旧响应覆盖新选择");
ok(revisits.includes('const next = await load(revisit.kind, { userInitiated: true });') && revisits.includes('if (next) elements.content.querySelector("[data-revisit-title]")?.focus'), "换一件后把键盘焦点交给新展品标题");

for (const endpoint of ["/api/revisits/intents", "/api/revisits/${encodeURIComponent(memoryId)}/intent"]) {
  ok(source.includes(endpoint), `前端接入 ${endpoint}`);
}
ok(source.includes("confirm: true"), "保存意愿必须发送明确确认位");
ok(source.includes('date.disabled = intent.choice !== "later"') && source.includes('form.elements.namedItem("notBeforeLocalDate").disabled = selected !== "later"'), "非 later 选择禁用隐藏日期，过期日期不会拦截提交");
ok(source.includes('intent.notBeforeLocalDate < localDate'), "已到期的既有 later 日期仍可被用户重新保存或修改");
ok(source.includes('choice: "neutral"') || source.includes('save(memoryId, "neutral"'), "管理区可显式恢复自然回访");
ok(source.includes('syncCurrentForm(memoryId, normalizeIntent({ memoryId, choice: "neutral" }') && source.includes('candidate.dataset.memoryId === memoryId'), "管理区恢复会同步刷新当前展品里的意愿表单");
ok(source.includes("data-intent-demo-disabled disabled") && source.includes("公开 Demo 不保存长期回访意愿"), "公开 Demo 展示控制方式但禁止持久化");
ok(!/localStorage|sessionStorage|indexedDB/iu.test(source), "回访意愿前端不建立第二套浏览器持久化");
ok(!/riskScore|privacyScore|emotionIntensity|sensitivityScore|psychologicalScore/iu.test(source), "回访意愿不生成心理或敏感度评分");
ok(source.includes("不保存选择原因") && source.includes("不会据此推断心情、关系或重要程度"), "页面明确说明不保存原因且不做心理推断");

ok(css.includes("min-height: 44px") && css.includes("min-height: 48px"), "交互控件满足至少 44px 触控边界");
ok(css.includes("focus-visible"), "键盘焦点有清晰反馈");
ok(css.includes("@media (max-width: 650px)"), "窄屏布局收敛为单列");
ok(css.includes("grid-template-columns: 1fr") && css.includes("flex-direction: column"), "手机日期和管理项均改为单列");
ok(!/gradient\s*\(/iu.test(css), "回访意愿保持无渐变的克制视觉");
ok(css.includes("safe-area-inset-right") && css.includes("safe-area-inset-left"), "移动管理区尊重左右安全区");
ok(css.includes("prefers-reduced-motion"), "减少动态效果偏好得到尊重");
ok(lineCount(source) < 400 && lineCount(css) < 260, "回访意愿模块保持独立且规模受控");

console.log(`Revisit intent UI checks passed: ${assertions} assertions.`);

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function lineCount(value) {
  return String(value).split(/\r?\n/u).length;
}

function ok(value, message) {
  assertions += 1;
  assert.ok(value, message);
}

function equal(actual, expected, message) {
  assertions += 1;
  assert.equal(actual, expected, message);
}

function deepEqual(actual, expected, message) {
  assertions += 1;
  assert.deepEqual(actual, expected, message);
}
