"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const html = read("public/index.html");
const css = read("public/curator-agent.css");
const source = read("public/assets/curator-agent.js");
const app = read("public/assets/app.js");
const capsules = read("public/assets/capsules.js");
require(path.join(root, "public", "assets", "curator-agent.js"));

const curator = globalThis.TimeIsleCuratorAgent;
let assertions = 0;

async function main() {
  check(curator && typeof curator === "object", "策展助手模块可独立加载");
  ["createController", "normalizeWorkspace"].forEach((name) => check(typeof curator[name] === "function", `模块导出 ${name}`));
  check(curator.domIds && curator.domIds.dialog === "curatorAgentDialog", "模块导出稳定 DOM 合同");

  const normalized = curator.normalizeWorkspace(workspacePayload());
  equal(normalized.run.id, "run-agent-1", "规范化运行 ID");
  equal(normalized.run.budgets.maxSteps, 6, "规范化六步预算");
  equal(normalized.run.budgets.maxToolCalls, 4, "规范化四次只读查阅预算");
  equal(normalized.proposal.preview.sections[0].items[0].citations[0].quote, "我们在操场尽头站了很久。", "规范化提案引用");
  check(normalized.proposal.relationships[0].status === "candidate", "候选关系保持待人工确认");
  check(normalized.allowDecisions, "新鲜本机提案允许逐项决定");
  const stale = curator.normalizeWorkspace({ ...workspacePayload(), freshness: "stale", allowDecisions: true });
  check(stale.freshness === "stale" && !stale.allowDecisions && Boolean(stale.proposal), "来源过期保留预览并关闭决定");
  const historical = curator.normalizeWorkspace({ ...workspacePayload(), historical: true });
  check(historical.historical && !historical.allowDecisions, "历史提案固定只读");

  const local = createHarness(false);
  await local.controller.open(local.elements.entryButton);
  equal(local.requests.length, 0, "本机打开时不预先创建运行或读取历史");
  local.elements.theme.value = "那些没有说出口的告别";
  await local.elements.form.dispatch("submit", { preventDefault() {} });
  await flush();
  equal(local.requests.length, 2, "明确提交后依次创建并执行一个新运行");
  equal(local.requests[0].url, "/api/curator-agent/runs", "创建运行使用专属 API");
  equal(local.requests[0].method, "POST", "创建运行是显式 POST");
  check(Boolean(local.requests[0].headers["Idempotency-Key"]), "创建运行带幂等键");
  check(!local.requests[0].headers["If-Match"], "首次创建不伪造 If-Match");
  equal(local.requests[1].url, "/api/curator-agent/runs/run-agent-1/execute", "创建后才执行受限策展");
  equal(local.requests[1].headers["If-Match"], '"curator-agent-run-agent-1-v1"', "执行使用最新 ETag");
  check(Boolean(local.requests[1].headers["Idempotency-Key"]), "执行带独立幂等键");
  deepEqual(local.requests[1].body, { confirm: true }, "执行要求显式确认且无越权参数");
  check(local.elements.proposalState.textContent === "尚未保存", "提案完成后明确标记尚未保存");
  check(local.elements.decisionList.innerHTML.includes("保存为草稿") && local.elements.decisionList.innerHTML.includes("确认关系") && local.elements.decisionList.innerHTML.includes("不采用"), "保存与每条关系均为独立决定");
  check(local.elements.decisionList.innerHTML.includes("发布到本馆") && local.elements.decisionList.innerHTML.includes("disabled"), "发布在保存前保持禁用");

  const recentOpenTarget = {
    closest(selector) {
      return selector === "[data-curator-run-open]"
        ? { dataset: { curatorRunOpen: "run-agent-1" } }
        : null;
    }
  };
  await local.elements.recent.dispatch("click", { target: recentOpenTarget });
  await flush();
  equal(local.requests.length, 3, "最近记录只读查看会发出一次详情请求");
  equal(local.requests[2].url, "/api/curator-agent/runs/run-agent-1", "只读查看从 data-curator-run-open 读取正确运行 ID");
  equal(local.requests[2].method, "GET", "历史运行只读查看严格使用 GET");
  check(local.elements.brief.hidden && !local.elements.workspace.hidden, "历史运行打开后进入只读工作区而非停留在简报页");

  const demo = createHarness(true);
  await demo.controller.open(demo.elements.entryButton);
  await flush();
  equal(demo.requests.length, 1, "Demo 打开只发一个请求");
  equal(demo.requests[0].url, "/api/curator-agent/sample", "Demo 只读取静态策展示例");
  equal(demo.requests[0].method, "GET", "Demo 示例严格只读");
  await demo.elements.form.dispatch("submit", { preventDefault() {} });
  equal(demo.requests.length, 1, "Demo 提交表单不会产生 POST 或 DELETE");

  check((html.match(/class="nav-button/g) || []).length === 4 && !html.includes('data-view="curator-agent"'), "策展助手不增加第五项导航");
  check(html.indexOf('id="curatorAgentButton"') < html.indexOf('id="exhibitionStudioButton"') && html.includes("请策展助手提案") && html.includes("自己挑选展品"), "馆藏回顾首先提供助手提案并保留手工策展");
  check(html.includes('id="curatorAgentDialog"') && !html.includes('<dialog class="memory-dialog curator-agent-dialog" id="curatorAgentDialog" open'), "策展工作区默认关闭");
  check(html.includes("最多 6 步 · 4 次只读查阅 · 2 秒执行 · 6 件来源"), "主界面始终展示清晰执行范围");
  check(html.includes('<details class="curator-agent-decisions"') && html.includes('<details class="curator-agent-technical"'), "决定与技术详情默认渐进披露");
  check(html.indexOf("/curator-agent.css") < html.indexOf("/assets/curator-agent.js") && html.indexOf("/assets/curator-agent.js") < html.indexOf("/assets/app.js"), "策展资源在主应用前按序载入");
  check(app.includes("TimeIsleCuratorAgent?.createController") && app.includes("demo: demo.interviewDemo") && app.includes("onOpenMemory: openMemory") && app.includes("onOpenShare:"), "主应用传入 Demo、展品回看与分享桥接");
  check(capsules.includes("async function openForExhibition") && capsules.includes("默认全不选") && capsules.includes("elements.createPanel.open = true"), "发布后只预选展览并继续走原隐私确认流程");
  check(source.includes('"If-Match"') && source.includes('"Idempotency-Key"') && source.includes("CURATOR_AGENT_SOURCE_STALE"), "决定请求覆盖并发、幂等和来源过期边界");
  check(source.includes("requestClose") && source.includes('/cancel`') && source.includes("RUNNING_STATUSES.has"), "关闭运行中对话框会尝试取消");
  check(!/localStorage|sessionStorage|indexedDB/iu.test(source), "运行 ID 不写入浏览器持久化");
  check(!/gradient\s*\(/iu.test(css), "策展界面无渐变");
  check(css.includes("max-width: 1040px") && css.includes("height: 100dvh") && css.includes("max-height: 100dvh"), "桌面宽度与移动全屏边界明确");
  check(["safe-area-inset-top", "safe-area-inset-right", "safe-area-inset-bottom", "safe-area-inset-left"].every((token) => css.includes(token)), "移动全屏兼容四边安全区");
  check(css.includes("@media (max-width: 650px)") && css.includes("@media (max-width: 390px)") && css.includes("@media (max-width: 320px)"), "650、390 与 320 视口均有明确布局规则");
  check(css.includes("overflow-wrap: anywhere") && css.includes("min-width: 0") && css.includes("overflow-x: hidden"), "长文本与窄屏不制造横向溢出");
  check(css.includes('grid-template-columns: minmax(0, 1fr)') && css.includes("width: 100%") && css.includes("min-height: 44px"), "移动动作单列且触控目标不小于 44px");
  check(/#curatorAgentDialog > \.dialog-body\s*\{[^}]*overflow-y:\s*auto;/su.test(css) && !/\.curator-agent-source-list\s*\{[^}]*overflow-y/su.test(css), "对话框只有主体承担滚动");

  local.controller.destroy();
  demo.controller.destroy();
  console.log(`Curator-agent UI checks passed: ${assertions} assertions.`);
}

function workspacePayload() {
  return {
    run: {
      id: "run-agent-1",
      status: "completed",
      version: 2,
      request: { theme: "那些没有说出口的告别", memoryIds: ["memory-a", "memory-b"] },
      budgets: { maxSteps: 6, maxToolCalls: 4, maxDurationMs: 2000, maxSources: 6 },
      usage: { steps: 4, toolCalls: 3, durationMs: 82, sources: 2 },
      allowDecisions: true,
      createdAt: "2026-07-18T00:00:00.000Z",
      updatedAt: "2026-07-18T00:00:01.000Z"
    },
    steps: [
      { index: 1, tool: "list_memories", summary: "读取馆藏目录" },
      { index: 2, tool: "read_memory_evidence", summary: "核对两件展品原文" }
    ],
    proposal: {
      id: "proposal-agent-1",
      proposalSha256: "a".repeat(64),
      sourceSetSha256: "b".repeat(64),
      sourceRefs: [
        { memoryId: "memory-a", updatedAt: "2026-07-17T00:00:00.000Z", rawSha256: "c".repeat(64) },
        { memoryId: "memory-b", updatedAt: "2026-07-17T00:00:00.000Z", rawSha256: "d".repeat(64) }
      ],
      preview: {
        title: "操场尽头的告别",
        opening: "两段关于告别与重逢的私人记忆。",
        sections: [{
          id: "section-1",
          title: "没有说出口",
          summary: "从沉默开始。",
          items: [{
            memoryId: "memory-a",
            title: "毕业傍晚",
            excerpt: "大家在操场告别。",
            curatorNote: "沉默也是告别的一部分。",
            citations: [{ memoryId: "memory-a", quote: "我们在操场尽头站了很久。", evidenceValid: true }]
          }]
        }]
      },
      relation: { id: "relation-1", status: "candidate", title: "同一段成长", description: "两件展品都由告别触发。", requiresConfirmation: true },
      actions: [
        { action: "save_exhibition", enabled: true, requiresConfirmation: true },
        { action: "confirm_relationship", enabled: true, requiresConfirmation: true },
        { action: "publish_exhibition", enabled: true, requiresConfirmation: true, dependsOn: "save_exhibition" }
      ]
    },
    decisions: [],
    allowDecisions: true,
    etag: '"curator-agent-run-agent-1-v2"'
  };
}

function createHarness(demo) {
  const elements = createElements();
  const requests = [];
  let version = 1;
  const fetchImpl = async (url, options = {}) => {
    const method = options.method || "GET";
    const body = options.body ? JSON.parse(options.body) : null;
    requests.push({ url, method, body, headers: options.headers || {} });
    if (url === "/api/curator-agent/sample") return jsonResponse({ ...workspacePayload(), demo: true, synthetic: true }, 200, '"curator-agent-sample-v1"');
    if (url === "/api/curator-agent/runs" && method === "POST") {
      return jsonResponse({
        run: { id: "run-agent-1", status: "created", version, request: body, budgets: workspacePayload().run.budgets, allowDecisions: false },
        proposal: null,
        steps: [],
        decisions: [],
        etag: '"curator-agent-run-agent-1-v1"'
      }, 201, '"curator-agent-run-agent-1-v1"');
    }
    if (url.endsWith("/execute") && method === "POST") {
      version += 1;
      return jsonResponse(workspacePayload(), 200, '"curator-agent-run-agent-1-v2"');
    }
    if (url === "/api/curator-agent/runs/run-agent-1" && method === "GET") {
      return jsonResponse(workspacePayload(), 200, '"curator-agent-run-agent-1-v2"');
    }
    return jsonResponse({ runs: [] }, 200, "");
  };
  const controller = curator.createController({ document: { activeElement: elements.entryButton, getElementById: (id) => elements.byId.get(id) }, elements, fetch: fetchImpl, demo });
  return { controller, elements, requests };
}

function createElements() {
  const byId = new Map();
  const elements = {};
  Object.entries(curator.domIds).forEach(([name, id]) => {
    const element = fakeElement(id);
    elements[name] = element;
    byId.set(id, element);
  });
  elements.dialog.showModal = () => { elements.dialog.open = true; };
  elements.dialog.close = () => { elements.dialog.open = false; elements.dialog.dispatch("close"); };
  elements.form.reset = () => { elements.theme.value = ""; };
  elements.progress.children = ["brief", "read", "propose", "decide"].map((stage) => {
    const item = fakeElement(`stage-${stage}`);
    item.dataset.curatorStage = stage;
    return item;
  });
  elements.progress.querySelectorAll = () => elements.progress.children;
  elements.sourceList.inputs = [];
  elements.sourceList.querySelectorAll = (selector) => selector.includes("input") ? elements.sourceList.inputs.filter((input) => !selector.includes(":checked") || input.checked) : [];
  elements.entryButton.isConnected = true;
  elements.theme.value = "";
  elements.byId = byId;
  return elements;
}

function fakeElement(id) {
  const listeners = new Map();
  const attributes = new Map();
  const classes = new Set();
  return {
    id,
    value: "",
    textContent: "",
    innerHTML: "",
    hidden: false,
    open: false,
    disabled: false,
    dataset: {},
    children: [],
    classList: {
      toggle(name, force) { if (force) classes.add(name); else classes.delete(name); },
      contains(name) { return classes.has(name); }
    },
    addEventListener(type, handler) { listeners.set(type, handler); },
    removeEventListener(type) { listeners.delete(type); },
    async dispatch(type, event = {}) { const handler = listeners.get(type); if (handler) return handler({ target: this, currentTarget: this, ...event }); },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    removeAttribute(name) { attributes.delete(name); },
    getAttribute(name) { return attributes.get(name); },
    querySelectorAll() { return []; },
    querySelector() { return null; },
    focus() {},
    reset() {}
  };
}

function jsonResponse(payload, status = 200, etag = "") {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => name.toLowerCase() === "etag" ? etag : null },
    async text() { return JSON.stringify(payload); }
  };
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

function read(relative) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

function check(condition, message) {
  assertions += 1;
  if (!condition) throw new Error(`Check failed: ${message}`);
}

function equal(actual, expected, message) {
  check(Object.is(actual, expected), `${message}（实际 ${JSON.stringify(actual)}，期望 ${JSON.stringify(expected)}）`);
}

function deepEqual(actual, expected, message) {
  check(JSON.stringify(actual) === JSON.stringify(expected), `${message}（实际 ${JSON.stringify(actual)}，期望 ${JSON.stringify(expected)}）`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
