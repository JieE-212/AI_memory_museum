"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const service = require("../lib/memory-lens-service");

const root = path.resolve(__dirname, "..");
const modulePath = path.join(root, "public", "assets", "memory-lens.js");
const cssPath = path.join(root, "public", "memory-lens.css");
const source = fs.readFileSync(modulePath, "utf8");
const css = fs.readFileSync(cssPath, "utf8");
const lensUi = require(modulePath);
let assertions = 0;

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function run() {
  for (const method of [
    "renderWorkbench",
    "createController",
    "normalizeCandidates",
    "normalizePreview",
    "createCuratorBrief",
    "validateClueQuery",
    "createOperationGate"
  ]) {
    equal(typeof lensUi[method], "function", `镜片前端导出 ${method}`);
  }
  equal(lensUi.ENGINE_ID, service.MEMORY_LENS_ENGINE, "前后端使用同一个确定性规则引擎 ID");
  equal(lensUi.ENGINE_BOUNDARY, service.MEMORY_LENS_BOUNDARY, "前后端使用同一个不推断边界");
  deepEqual(Object.keys(lensUi.LENSES), ["time", "cooccurrence", "evidence", "clue"], "前端只提供四种服务已定义镜片");
  for (const code of Object.keys(lensUi.LENSES)) {
    equal(lensUi.LENSES[code].label, service.MEMORY_LENS_DEFINITIONS[code].label, `${code} 标签与服务一致`);
    equal(lensUi.LENSES[code].boundary, service.MEMORY_LENS_DEFINITIONS[code].boundary, `${code} 边界与服务一致`);
  }

  const html = lensUi.renderWorkbench();
  ok(html.includes('<details class="memory-lens-workbench" data-memory-lens-root>'), "镜片工作台使用默认折叠 details");
  ok(!/<details class="memory-lens-workbench"[^>]*\sopen(?:\s|>)/u.test(html), "镜片入口启动时不自动展开");
  equal((html.match(/name="lens"/gu) || []).length, 4, "工作台恰好展示四个镜片选项");
  equal((html.match(/name="memoryLensSource"/gu) || []).length, 0, "工作台不会在读取前自动选择任何展品");
  ok(html.includes("不是 embedding、生成模型或人物关系判断"), "入口明确不是 embedding、模型或关系判断");
  ok(html.includes("不会推断日期、情绪或事实"), "入口明确拒绝日期、情绪与事实推断");
  ok(html.includes('data-memory-lens-query-wrap hidden') && html.includes('name="query"') && html.includes("disabled"), "线索查询只在用户显式选择 clue 后启用");
  ok(html.includes("不扩展近义词，不读取情绪字段"), "线索输入框说明直接字段匹配边界");
  ok(html.includes("0 次模型调用") && html.includes("本次不保存"), "结果区持续显示零模型与零持久化状态");
  ok(html.includes("带入策展（未保存简报）"), "策展出口明确是未保存简报");
  ok(!html.includes("data-view="), "镜片不新增第五项主导航");
  ok(html.includes('role="status" aria-live="polite"') && html.includes('aria-atomic="true"'), "读取与计算状态可被读屏及时感知");

  const fixture = memoriesFixture();
  const candidates = lensUi.normalizeCandidates([
    fixture[0],
    { ...fixture[0], title: "重复 ID" },
    { id: "../unsafe", title: "不安全" },
    fixture[1],
    fixture[2]
  ]);
  deepEqual(candidates.candidates.map((item) => item.id), ["lens-alpha", "lens-beta", "lens-gamma"], "候选列表过滤重复与不安全 ID 且保留宿主顺序");
  equal(candidates.candidates[0].raw, fixture[0], "候选只保留原始只读引用供服务规范化，不复制或改写记忆");
  ok(Object.isFrozen(candidates) && Object.isFrozen(candidates.candidates), "候选投影被冻结且不建立第二份持久状态");
  const manyCandidates = lensUi.normalizeCandidates(Array.from({ length: 205 }, (_, index) => ({
    ...fixture[0], id: `candidate-${index}`, title: `展品 ${index}`
  })));
  equal(manyCandidates.candidates.length, 200, "候选 DOM 范围在渲染前限制为 200 件");
  equal(manyCandidates.total, 205, "候选规范化保留被截断数量供界面透明提示");

  equal(lensUi.validateClueQuery("  旧礼堂   雨  "), "旧礼堂 雨", "线索词只做 NFKC 与空白规范化");
  equal(lensUi.validateClueQuery("Ａ A"), "A A", "线索查询保留显式文本而匹配词可按 NFKC 去重");
  throwsCode(() => lensUi.validateClueQuery(""), "MEMORY_LENS_QUERY_INVALID", "clue 不接受空查询");
  throwsCode(() => lensUi.validateClueQuery("词1 词2 词3 词4 词5 词6 词7 词8 词9"), "MEMORY_LENS_QUERY_INVALID", "clue 明确限制为最多八个词");
  throwsCode(() => lensUi.validateClueQuery("词".repeat(41)), "MEMORY_LENS_QUERY_INVALID", "单个 clue 词最多四十字符");
  throwsCode(() => lensUi.validateClueQuery("旧礼堂\npublish"), "MEMORY_LENS_QUERY_INVALID", "clue 拒绝控制换行与指令式拼接");

  const previews = {};
  for (const [code, query] of [["time", ""], ["cooccurrence", ""], ["evidence", ""], ["clue", "旧礼堂 雨"]]) {
    const request = { lens: code, memories: fixture, ...(code === "clue" ? { query } : {}) };
    const servicePreview = service.buildMemoryLensPreview(request);
    const normalized = lensUi.normalizePreview(servicePreview, {
      lens: code,
      query,
      memoryIds: fixture.map((item) => item.id)
    });
    previews[code] = normalized;
    equal(normalized.previewSha256, servicePreview.previewSha256, `${code} 保留服务计算的预览摘要`);
    equal(normalized.engine.externalModel, false, `${code} 结果保持零外部模型`);
    equal(normalized.engine.toolCalls, 0, `${code} 结果保持零工具调用`);
    equal(normalized.engine.persisted, false, `${code} 结果保持零持久化`);
    equal(normalized.items.length, fixture.length, `${code} 逐件覆盖明确选择范围`);
    ok(Object.isFrozen(normalized) && Object.isFrozen(normalized.items[0]), `${code} 前端投影深度冻结`);
  }
  ok(previews.time.items.some((item) => item.title.includes("<script>alert(1)</script>")), "敌意外观标题保留为数据供 textContent 安全呈现");
  ok(previews.cooccurrence.groups.every((group) => group.reason.includes("不代表") || group.key === "cooccurrence:none"), "共同出现分组持续否认人物关系推断");
  ok(previews.evidence.items.every((item) => item.reason.includes("不判断真假") || item.reason.includes("没有可计数")), "证据镜片不把数量包装成真实性");
  deepEqual(previews.clue.queryTerms, ["旧礼堂", "雨"], "线索结果只能回显用户明确输入的直接匹配词");

  const badEngine = clone(previews.time);
  badEngine.engine.externalModel = true;
  throwsCode(() => normalize(badEngine, "time", fixture), "MEMORY_LENS_ENGINE_INVALID", "声称调用外部模型的结果拒绝展示");
  const persisted = clone(previews.time);
  persisted.engine.persisted = true;
  throwsCode(() => normalize(persisted, "time", fixture), "MEMORY_LENS_ENGINE_INVALID", "声称已持久化的结果拒绝展示");
  const toolCall = clone(previews.time);
  toolCall.engine.toolCalls = 1;
  throwsCode(() => normalize(toolCall, "time", fixture), "MEMORY_LENS_ENGINE_INVALID", "声称执行工具调用的结果拒绝展示");
  const expandedScope = clone(previews.time);
  expandedScope.sourceRefs[0].memoryId = "memory-outside";
  expandedScope.items[0].memoryId = "memory-outside";
  expandedScope.groups.find((group) => group.memoryIds.includes("lens-alpha")).memoryIds = ["memory-outside"];
  throwsCode(() => normalize(expandedScope, "time", fixture), "MEMORY_LENS_SOURCE_SCOPE_INVALID", "替换用户明确来源范围的结果拒绝展示");
  const wrongLens = clone(previews.time);
  wrongLens.lens = clone(previews.evidence.lens);
  throwsCode(() => normalize(wrongLens, "time", fixture), "MEMORY_LENS_PREVIEW_INVALID", "返回镜片与用户选择不符时拒绝展示");
  const changedTerms = clone(previews.clue);
  changedTerms.queryTerms = ["旧礼堂", "相近含义"];
  throwsCode(() => normalize(changedTerms, "clue", fixture, "旧礼堂 雨"), "MEMORY_LENS_PREVIEW_INVALID", "扩展或替换显式 clue 词的结果拒绝展示");
  const mismatchedMembership = clone(previews.time);
  mismatchedMembership.items[0].groupKeys = [mismatchedMembership.groups.at(-1).key];
  throwsCode(() => normalize(mismatchedMembership, "time", fixture), "MEMORY_LENS_PREVIEW_INVALID", "条目解释与分组回执不一致时拒绝展示");

  const brief = lensUi.createCuratorBrief(previews.clue);
  equal(brief.format, lensUi.CURATOR_BRIEF_FORMAT, "策展交接使用独立简报格式");
  equal(brief.state, "unsaved-preview", "策展简报状态固定为未保存预览");
  equal(brief.persisted, false, "策展简报不能声称已保存");
  equal(brief.engine, service.MEMORY_LENS_ENGINE, "策展简报保留确定性引擎 ID");
  deepEqual(brief.orderedMemoryIds, previews.clue.items.map((item) => item.memoryId), "策展简报只携带镜片决定的显式顺序");
  ok(brief.boundary.includes("仍需用户决定") && brief.boundary.includes("不能据此认定事实或人物关系"), "策展简报保留人工决定与非关系判断边界");
  ok(!JSON.stringify(brief).includes(fixture[0].rawContent), "策展简报不复制原始记忆正文");
  ok(Object.isFrozen(brief) && Object.isFrozen(brief.sourceRefs), "未保存简报为只读瞬时对象");

  const gate = lensUi.createOperationGate();
  const first = gate.begin("first");
  ok(gate.busy() && first.isCurrent(), "首个镜片请求成为当前操作");
  const second = gate.begin("second");
  ok(first.signal.aborted && !first.isCurrent(), "新请求会取消并淘汰旧请求");
  ok(second.isCurrent() && gate.busy(), "只有最新请求可提交结果");
  first.finish();
  ok(gate.busy(), "过期请求 finish 不能清除当前请求");
  second.finish();
  ok(!gate.busy(), "当前请求完成后释放忙碌状态");
  const third = gate.begin("third");
  ok(gate.cancel() && third.signal.aborted && !third.isCurrent(), "显式取消会中止信号并使结果过期");
  gate.destroy();
  throwsCode(() => gate.begin("after-destroy"), "MEMORY_LENS_CONTROLLER_DESTROYED", "销毁后不能复活旧工作台");

  ok(!/\.innerHTML\b|insertAdjacentHTML|outerHTML/u.test(source), "所有动态标题、解释与依据只通过 DOM textContent 呈现");
  ok(source.includes(".textContent = candidate.title") && source.includes(".textContent = item.reason") && source.includes(".textContent = entry.value"), "候选、解释和依据均使用 textContent");
  ok(!/\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon/u.test(source), "镜片前端本身没有网络能力");
  ok(!/localStorage|sessionStorage|indexedDB/u.test(source), "镜片请求、预览和简报均为零浏览器持久化");
  ok(!/\/api\//u.test(source), "独立模块不隐式绑定服务器接口");
  ok(source.includes("await buildPreview(request") && source.includes("signal: operation.signal"), "设备内计算器通过显式可取消回调接入");
  ok(source.includes("operation.isCurrent()") && source.includes("gate.begin") && source.includes("gate.cancel"), "异步读取和计算具有取消与过期隔离");
  ok(source.includes("event.target.closest(\"[data-memory-lens-curate]\")") && source.includes("await onCurate(brief)"), "只有用户点击才回调未保存策展简报");
  ok(!/method:\s*["'](?:POST|PUT|PATCH|DELETE)/u.test(source), "镜片前端不执行任何写请求");

  ok(css.includes("min-height: 44px") && css.includes("min-height: 48px"), "镜片交互控件满足至少 44px 触控边界");
  ok(css.includes("focus-visible"), "镜片提供清晰键盘焦点");
  ok(css.includes("safe-area-inset-right") && css.includes("safe-area-inset-left"), "移动布局尊重左右安全区");
  ok(css.includes("@media (max-width: 650px)") && css.includes("@media (max-width: 390px)") && css.includes("@media (max-width: 320px)"), "样式覆盖 650、390、320 三档移动宽度");
  ok(css.includes("grid-template-columns: 1fr") && css.includes("flex-direction: column"), "手机镜片、馆藏、分组与操作区收敛为单列");
  ok(css.includes("prefers-reduced-motion"), "镜片尊重减少动态效果偏好");
  ok(!/gradient\s*\(/iu.test(css), "镜片保持无渐变的克制视觉");

  console.log(`Memory-lens UI checks passed: ${assertions} assertions.`);
}

function memoriesFixture() {
  const createdAt = "2026-07-01T08:00:00.000Z";
  return [
    {
      id: "lens-alpha",
      title: "旧礼堂雨夜 <script>alert(1)</script>",
      createdAt,
      updatedAt: "2026-07-01T08:01:00.000Z",
      date: "2024-06-01",
      location: "南校区",
      sourceType: "手写日记",
      tags: ["校园", "雨夜"],
      rawContent: "1999 只是正文里的数字。旧礼堂散场后下着雨。",
      exhibitText: "一次仍有细节不确定的散场。",
      entityRefs: [{ entityId: "entity-ning", type: "person", canonicalName: "阿宁", confirmed: true }],
      confirmedQuotes: ["散场以后，我们又站了一会儿。"],
      voices: [{ transcript: { confirmed: true, text: "雨声里又提到了旧礼堂。" } }],
      media: [{ assetId: "media-a" }]
    },
    {
      id: "lens-beta",
      title: "礼堂门口的等待",
      createdAt,
      updatedAt: "2026-07-01T08:02:00.000Z",
      date: "2024-06",
      location: "南校区",
      sourceType: "聊天片段",
      tags: ["告别"],
      rawContent: "我们在旧礼堂门口等了一会儿。",
      exhibitText: "另一段明确保存的文字记录。",
      entityRefs: [{ entityId: "entity-ning", type: "person", canonicalName: "阿宁", resolutionStatus: "confirmed" }],
      mediaSummary: { count: 0 },
      voiceSummary: { confirmedTranscriptCount: 0 }
    },
    {
      id: "lens-gamma",
      title: "一张礼堂照片",
      createdAt,
      updatedAt: "2026-07-01T08:03:00.000Z",
      date: "那个夏天",
      location: "北门",
      sourceType: "照片",
      tags: ["苏州"],
      rawContent: "",
      exhibitText: "照片旁只留下了苏州两个字。",
      entityRefs: [],
      mediaSummary: { count: 1 },
      voiceSummary: { confirmedTranscriptCount: 0 }
    }
  ];
}

function normalize(value, lens, memories, query = "") {
  return lensUi.normalizePreview(value, { lens, query, memoryIds: memories.map((item) => item.id) });
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
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

function throwsCode(callback, code, message) {
  assertions += 1;
  assert.throws(callback, (error) => error?.code === code, message);
}
