"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const source = read("public/assets/time-calibrations.js");
const css = read("public/time-calibrations.css");
const html = read("public/index.html");
const app = read("public/assets/app.js");
require(path.join(root, "public", "assets", "time-calibrations.js"));

const moduleApi = globalThis.TimeIsleTimeCalibrations;
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const HASH_D = "d".repeat(64);
const ORIGINAL_KEY = `time-source:${"1".repeat(64)}`;
const REVISION_KEY = `time-source:${"2".repeat(64)}`;
const PHOTO_KEY = `time-source:${"3".repeat(64)}`;
let assertions = 0;

async function main() {
  checkModuleAndNormalization();
  checkStaticContracts();
  checkHostIntegration();
  await checkPuzzleTargetRouting();
  await checkOpenAndRendering();
  await checkSavedSourceSnapshotsSurvive();
  await checkPutAndBusyState();
  await checkConflictRefreshKeepsDraft();
  await checkSourceSetConflictKeepsDraft();
  await checkDeleteAndFreshEtag();
  await checkDemoReadOnly();
  await checkHostBusyLock();
  await checkAbortAndStaleSessions();
  await checkResetClearsSensitiveState();
  console.log(`Time calibration UI checks passed: ${assertions} assertions.`);
}

function checkModuleAndNormalization() {
  ok(moduleApi && typeof moduleApi.createController === "function", "时间校准前端模块可独立加载");
  equal(typeof moduleApi.normalizePayload, "function", "模块暴露纯 payload 规范化函数");
  deepEqual(Object.keys(moduleApi.domIds).sort(), [
    "badge", "body", "choices", "deleteButton", "details", "form", "interval", "intervalEnd",
    "intervalStart", "intro", "note", "refreshButton", "saveButton", "sources", "status", "summary"
  ], "模块公开完整且稳定的宿主 DOM 合同");
  ok(Object.values(moduleApi.domIds).every((id) => /^timeCalibration[A-Z]/u.test(id)), "所有宿主 DOM ID 都使用 timeCalibration 前缀");
  equal(new Set(Object.values(moduleApi.domIds)).size, Object.values(moduleApi.domIds).length, "宿主 DOM ID 合同没有重复值");

  const unicodeNote = "岛".repeat(499) + "🧭🧭";
  const normalized = moduleApi.normalizePayload({
    candidates: [
      candidate(ORIGINAL_KEY, "memory-current", "第一段<script>alert(1)</script>"),
      candidate(REVISION_KEY, "revision", "第二版", { revisionNo: 2 }),
      candidate(PHOTO_KEY, "exif", "照片", { displayDate: "2024-06-18", sourceQuote: "相机记录" }),
      candidate(ORIGINAL_KEY, "memory-current", "重复来源"),
      candidate(`time-source:${"4".repeat(64)}`, "invented-photo", "不可信类型")
    ],
    sourceSetSha256: HASH_A.toUpperCase(),
    calibration: {
      resolutionKind: "day",
      intervalStart: "2024-06-18",
      intervalEnd: "2024-06-18",
      selectedSourceKeys: [ORIGINAL_KEY, ORIGINAL_KEY, "unsafe\nkey"],
      note: unicodeNote
    },
    needsReview: true,
    etag: '"payload-etag"'
  }, '"header-etag"');

  equal(normalized.candidates.length, 3, "候选规范化会去重并拒绝未知来源类型");
  deepEqual(normalized.candidates.map((item) => item.sourceKind), ["original", "revision", "photo"], "后端候选类型映射为三种可信中文标签");
  equal(normalized.candidates[2].excerpt, "相机记录", "sourceQuote 作为原文证据摘录进入只读来源卡");
  equal(normalized.sourceSetSha256, HASH_A, "来源集合 SHA-256 被规范为小写");
  equal(normalized.etag, '"header-etag"', "响应头 ETag 优先于 payload 冗余字段");
  equal(normalized.needsReview, true, "来源变化复核状态被显式保留");
  deepEqual(normalized.calibration.selectedSourceKeys, [ORIGINAL_KEY], "保存结果中的来源键去重并拒绝控制字符");
  equal(Array.from(normalized.calibration.note).length, 500, "Unicode 备注按 code point 完整截到后端 500 字上限");
  equal(normalized.calibration.note.endsWith("🧭"), true, "Unicode 截断不会留下半个代理字符");

  equal(moduleApi.normalizePayload({ sourceSetSha256: "short" }).sourceSetSha256, "", "非 SHA-256 来源版本不会进入保存状态");
  equal(moduleApi.normalizePayload({ etag: '"ok"\r\ninjected: yes' }).etag, "", "含换行的 ETag 被拒绝");
  equal(moduleApi.normalizePayload({ calibration: { resolutionKind: "day", intervalStart: "2024-02-30" } }).calibration, null, "不存在的日历日期被拒绝");
  equal(moduleApi.normalizePayload({ calibration: { resolutionKind: "range", intervalStart: "2024-07-02", intervalEnd: "2024-07-01" } }).calibration, null, "倒置的时间范围被拒绝");
  equal(moduleApi.normalizePayload({ calibration: { resolutionKind: "year", intervalStart: "2024-01-01", intervalEnd: "2024-12-31" } }).calibration, null, "V8 UI 不接受未列入产品合同的分辨率类型");
  const bounded = moduleApi.normalizePayload({
    candidates: Array.from({ length: 105 }, (_, index) => candidate(
      `time-source:${String(index + 10).padStart(64, "0")}`,
      "revision",
      `修订 ${index + 1}`
    )),
    candidateCount: 130,
    candidatesTruncated: true
  });
  equal(bounded.candidates.length, 100, "前端防御性上限与服务端 100 条公共候选合同一致");
  equal(bounded.candidateCount, 130, "前端保留服务端完整候选计数");
  equal(bounded.candidatesTruncated, true, "前端显式保留截断状态而不是静默丢弃");
  deepEqual(moduleApi.normalizePayload({
    calibration: { resolutionKind: "alternatives", selectedSourceKeys: [ORIGINAL_KEY, REVISION_KEY], intervalStart: "2024-01-01" }
  }).calibration, {
    resolutionKind: "alternatives",
    intervalStart: "",
    intervalEnd: "",
    selectedSourceKeys: [ORIGINAL_KEY, REVISION_KEY],
    selectedSourceSnapshots: [],
    note: ""
  }, "多种时间记录只保留来源选择，不伪造单一日期区间");
}

function checkStaticContracts() {
  for (const endpoint of [
    "/api/time-calibrations/events/${encodeURIComponent(state.eventId)}"
  ]) {
    ok(source.includes(endpoint), `控制器接入 ${endpoint}`);
  }
  for (const method of ['method: "GET"', 'method: "PUT"', 'method: "DELETE"']) {
    ok(source.includes(method), `控制器包含 ${method} 请求`);
  }
  ok(source.includes('"If-Match": state.etag'), "PUT 和 DELETE 使用当前 ETag 乐观并发条件");
  ok(source.includes("confirm: true"), "所有持久化动作发送明确确认位");
  ok(source.includes("new AbortController()") && source.includes("abortActiveRequest()"), "控制器使用 AbortController 取消过期请求");
  ok(source.includes("internalSession") && source.includes("hostSessionKey"), "内部会话与宿主 sessionKey 共同阻止旧响应写回");
  ok(source.includes("function setHostBusy(value)") && source.includes("hostBusy || state.conflict"), "宿主拼图 mutation 可锁定时间校准而不混入内部请求状态");
  ok(source.includes('error.status === 412') && source.includes('error.code === "CALIBRATION_SOURCES_CHANGED"') && source.includes("时间线索已经变化，请重新读取后再确认"), "412 与来源变化 409 都进入专用可刷新状态");
  ok(source.includes('setAttribute("aria-busy", String(next))'), "读写期间向可访问性树公开 busy 状态");
  ok(source.includes('setAttribute("role", "status")') && source.includes('setAttribute("aria-live", "polite")') && source.includes('setAttribute("aria-atomic", "true")'), "状态区运行时强化为原子 polite live region");
  ok(source.includes("elements.details.open = false"), "打开新拼图前面板恢复默认折叠状态");
  ok(source.includes("elements.note.value = \"\"") && source.includes("state = emptyState()"), "reset 清空备注、ETag、payload 与选择状态");
  ok(source.includes("公开 Demo 仅展示示例判断，不保存访客修改") && source.includes("state.demo || state.busy"), "公开 Demo 有只读说明并锁定 mutation 控件");
  ok(source.includes("不会改写两段原文、展品日期，也不会自动确认它们属于同一往事"), "模块明确声明不改写原文且不自动归并往事");
  ok(source.includes("原文来源") && source.includes("记忆修订") && source.includes("照片时间线索"), "候选来源只使用三种受控标签");
  ok(source.includes("source.sourceQuote"), "原文 claim 摘录读取后端安全公开字段 sourceQuote");
  ok(source.includes("<fieldset") && source.includes("<legend>"), "动态来源选择使用原生 fieldset 与 legend");
  ok(source.includes('type="checkbox"') && source.includes("timeCalibrationResolutionKind"), "来源复选与分辨率单选拥有独立原生表单合同");
  ok(!/localStorage|sessionStorage|indexedDB/iu.test(source), "时间校准不建立浏览器二次持久化");
  ok(!/riskScore|privacyScore|emotionIntensity|sensitivityScore|psychologicalScore|behaviorScore/iu.test(source), "时间校准不生成心理、行为或敏感度评分");

  ok(css.includes("min-height: 44px") && css.includes("min-height: 48px"), "summary、选择卡与按钮满足至少 44px 触控高度");
  ok(css.includes("@media (max-width: 650px)"), "650px 以下进入窄屏布局");
  ok(css.includes("grid-template-columns: 1fr"), "窄屏来源、选择和区间统一收为单列");
  ok(css.includes("repeat(2, minmax(0, 1fr))") && css.includes("min-width: 0"), "桌面双列允许内容安全收缩且不撑破 320px 视口");
  ok(css.includes("@media (max-width: 360px)"), "极窄 320px 级视口有额外内边距收敛");
  ok(css.includes("overflow: visible") && css.includes("max-height: none"), "面板自身不制造第二层滚动容器");
  ok(css.includes("safe-area-inset-right") && css.includes("safe-area-inset-left"), "移动布局尊重左右安全区");
  ok(css.includes("focus-visible"), "键盘焦点具有清晰样式");
  ok(css.includes("prefers-reduced-motion"), "减少动态偏好得到尊重");
  ok(css.includes("width: 100%") && css.includes("flex-direction: column"), "移动操作按钮使用全宽纵向排列");
  ok(css.includes('content: "✓"') && css.includes('content: "!"') && css.includes('content: "待"'), "状态除颜色外还使用文字或符号表达");
  ok(!/gradient\s*\(/iu.test(css), "独立样式不使用渐变");
}

function checkHostIntegration() {
  for (const id of Object.values(moduleApi.domIds)) {
    equal((html.match(new RegExp(`id="${id}"`, "gu")) || []).length, 1, `${id} 在宿主页中唯一存在`);
  }
  ok(html.includes('<details class="time-calibration-panel" id="timeCalibrationDetails" hidden>'), "时间校准入口使用默认折叠的 details 且初始隐藏");
  ok(!/<details[^>]+id="timeCalibrationDetails"[^>]+\sopen(?:\s|>)/iu.test(html), "宿主页不会启动时自动展开时间校准");
  const puzzleBody = html.indexOf('id="puzzleBody"');
  const calibrationPanel = html.indexOf('id="timeCalibrationDetails"');
  const genericQuestion = html.indexOf('id="puzzleQuestionSection"');
  ok(puzzleBody > 0 && puzzleBody < calibrationPanel && calibrationPanel < genericQuestion, "校准面板位于拼图证据后、通用补问前");
  ok(html.includes('<fieldset class="time-calibration-choices" id="timeCalibrationChoices">') && html.includes("<legend>你希望怎样保留这段时间？</legend>"), "宿主选择区使用原生 fieldset/legend");
  for (const kind of ["day", "range", "alternatives", "uncertain"]) {
    equal((html.match(new RegExp(`name="timeCalibrationResolutionKind" value="${kind}"`, "gu")) || []).length, 1, `宿主页只声明一个 ${kind} radio`);
  }
  ok(html.includes('id="timeCalibrationStatus" role="status" aria-live="polite" aria-atomic="true"'), "宿主状态区静态声明原子 polite live region");
  ok(html.includes('id="timeCalibrationNote" maxlength="500"'), "宿主备注长度与后端 500 字合同一致");
  equal((html.match(/\/time-calibrations\.css\?v=8\.0\.0/gu) || []).length, 1, "独立时间校准样式只加载一次");
  equal((html.match(/\/assets\/time-calibrations\.js\?v=8\.0\.0/gu) || []).length, 1, "独立时间校准脚本只加载一次");
  const moduleScript = html.indexOf('/assets/time-calibrations.js?v=8.0.0');
  const appScript = html.indexOf('/assets/app.js');
  ok(moduleScript > 0 && moduleScript < appScript, "时间校准 UMD 在主应用之前加载");
  equal((html.match(/class="nav-button/gu) || []).length, 4, "V8 入口留在时光拼图内，不增加主导航或 Tab");
  ok(app.includes("TimeIsleTimeCalibrations.createController") && app.includes("initializeTimeCalibrationController"), "主应用初始化独立时间校准 controller");
  ok(app.includes("timeCalibrationController?.syncPuzzle({") && app.includes("sessionKey: state.puzzleSession"), "宿主同步面板目标时传入当前拼图 sessionKey");
  ok(app.includes("timeCalibrationController?.reset()") && app.includes("timeCalibrationController?.setHostBusy?.(busy)"), "宿主在关闭/换图时 reset，并同步拼图 mutation 锁");
  ok(app.includes("onBusyChange: (busy) => setPuzzleBusy(busy, { fromTimeCalibration: true })"), "controller 内部 busy 锁定宿主关闭及其它 mutation 操作且避免递归");
  ok(app.includes('const dateQuestionHandledByCalibration = calibrationTarget?.handlesDateQuestion && payload.question?.basedOn?.field === "date"'), "只有时间校准目标实际存在时才隐藏通用日期补问");
}

async function checkOpenAndRendering() {
  const harness = createHarness();
  harness.queue.enqueue(jsonResponse(workspace({ title: "第一段<script>alert(1)</script>" }), { etag: '"etag-open"' }));
  const result = await harness.controller.open({
    eventId: "event-open",
    puzzle: { pair: { left: { id: "left" }, right: { id: "right" } } },
    demo: false,
    sessionKey: "puzzle-1"
  });

  equal(harness.queue.calls.length, 1, "open 只发出一次账本 GET");
  equal(harness.queue.calls[0].url, "/api/time-calibrations/events/event-open", "open 使用经过约束并编码的 event ID");
  equal(harness.queue.calls[0].options.method, "GET", "open 使用 GET 读取时间账本");
  equal(harness.queue.calls[0].options.cache, "no-store", "私人时间账本禁用浏览器 HTTP 缓存");
  equal(result.candidates.length, 3, "GET 结果规范化后返回给宿主调用方");
  equal(harness.elements.details.hidden, false, "有效 event 打开时间校准入口");
  equal(harness.elements.details.open, false, "入口加载完成后仍默认折叠");
  equal(harness.elements.status.getAttribute("role"), "status", "状态区拥有 status role");
  equal(harness.elements.status.getAttribute("aria-live"), "polite", "状态区以 polite 方式播报");
  equal(harness.elements.status.getAttribute("aria-atomic"), "true", "状态变化原子播报");
  ok(harness.elements.sources.innerHTML.includes("原文来源") && harness.elements.sources.innerHTML.includes("记忆修订") && harness.elements.sources.innerHTML.includes("照片时间线索"), "三类来源卡均可见");
  ok(harness.elements.sources.innerHTML.includes("&lt;script&gt;") && !harness.elements.sources.innerHTML.includes("<script>"), "候选标题写入 DOM 前完成 HTML 转义");
  equal(harness.elements.sources.sourceInputs.length, 3, "每条可信候选生成一个可核对的来源复选框");
  equal(harness.elements.saveButton.disabled, false, "有效 hash 与 ETag 到齐后允许用户开始保存");
  equal(harness.elements.deleteButton.hidden, true, "未校准状态不展示删除动作");
  ok(harness.elements.status.textContent.includes("3 条"), "来源计数使用完整 Unicode 文案呈现");
  deepEqual(harness.busyChanges, [true, false], "GET 的 busy 状态成对通知宿主");
}

async function checkPuzzleTargetRouting() {
  const datedPayload = puzzlePayload({ hasDateDifference: true });
  const datedTarget = moduleApi.calibrationPuzzleTarget(datedPayload);
  equal(datedTarget.eventId, "event-calibration-route", "已确认拼图的 event ID 可作为校准账本目标");
  equal(datedTarget.hasDateDifference, true, "当前已核验日期差异会直接标记为校准入口触发条件");

  const savedHarness = createHarness();
  savedHarness.queue.enqueue(jsonResponse(workspace({
    candidates: [candidate(PHOTO_KEY, "exif", "后来重新核对的照片", { displayDate: "2024-06-20" })],
    calibration: calibration("alternatives", [ORIGINAL_KEY, REVISION_KEY], "保留旧的两种时间记录"),
    needsReview: true
  }), { etag: '"etag-saved-without-current-diff"' }));
  const savedRoute = savedHarness.controller.syncPuzzle({
    payload: puzzlePayload({ hasDateDifference: false }),
    demo: false,
    sessionKey: "saved-without-current-diff"
  });
  equal(savedRoute.active, true, "无当前日期差异的已确认事件仍会核对是否存在旧判断");
  equal(savedRoute.handlesDateQuestion, false, "无当前日期差异时不会误吞宿主的日期补问");
  await waitFor(() => savedHarness.busyChanges.at(-1) === false, "旧判断账本读取完成");
  equal(savedHarness.elements.details.hidden, false, "当前日期差异消失后，已有判断仍保留校准台入口");
  equal(savedHarness.elements.badge.textContent, "需要复核", "来源变化后的旧判断显示需要复核状态");
  ok(savedHarness.elements.sources.innerHTML.includes("保存时来源") && savedHarness.elements.sources.innerHTML.includes("2024-06-19"), "失效来源用保存时不可变快照解释旧判断");
  equal(savedHarness.elements.saveButton.disabled, false, "私人馆可更新没有当前日期差异的旧判断");
  equal(savedHarness.elements.deleteButton.disabled, false, "私人馆可删除没有当前日期差异的旧判断");

  const emptyHarness = createHarness();
  emptyHarness.queue.enqueue(jsonResponse(workspace({ calibration: null }), { etag: '"etag-no-calibration-no-diff"' }));
  const emptyRoute = emptyHarness.controller.syncPuzzle({
    payload: puzzlePayload({ hasDateDifference: false, eventId: "event-empty-route" }),
    demo: false,
    sessionKey: "empty-without-current-diff"
  });
  equal(emptyRoute.handlesDateQuestion, false, "无日期差异且无旧判断的探测不声明处理日期问题");
  await waitFor(() => emptyHarness.busyChanges.at(-1) === false, "空校准账本读取完成");
  equal(emptyHarness.elements.details.hidden, true, "无旧判断且无当前日期差异时不强行展示校准台");

  const demoHarness = createHarness();
  demoHarness.queue.enqueue(jsonResponse(workspace({
    calibration: calibration("day", [ORIGINAL_KEY], "只读旧判断"),
    needsReview: true
  }), { etag: '"etag-demo-saved-without-diff"' }));
  demoHarness.controller.syncPuzzle({
    payload: puzzlePayload({ hasDateDifference: false, eventId: "event-demo-old-calibration" }),
    demo: true,
    sessionKey: "demo-saved-without-current-diff"
  });
  await waitFor(() => demoHarness.busyChanges.at(-1) === false, "Demo 旧判断账本读取完成");
  equal(demoHarness.elements.details.hidden, false, "Demo 仍可查看没有当前日期差异的示例旧判断");
  equal(demoHarness.elements.saveButton.disabled, true, "Demo 旧判断继续禁止更新");
  equal(demoHarness.elements.deleteButton.disabled, true, "Demo 旧判断继续禁止删除");

  const unconfirmedHarness = createHarness();
  const unconfirmedRoute = unconfirmedHarness.controller.syncPuzzle({
    payload: puzzlePayload({ confirmed: false, hasDateDifference: true }),
    sessionKey: "unconfirmed-date-difference"
  });
  equal(unconfirmedRoute.active, false, "未确认属于同一往事时不会开放事件校准");
  equal(unconfirmedHarness.queue.calls.length, 0, "未确认拼图不会探测事件校准账本");
}

async function checkSavedSourceSnapshotsSurvive() {
  const harness = createHarness();
  harness.queue.enqueue(jsonResponse(workspace({
    candidates: [candidate(PHOTO_KEY, "exif", "仍可用照片", { displayDate: "2024-06-20" })],
    calibration: calibration("alternatives", [ORIGINAL_KEY, REVISION_KEY], "保留两种日期"),
    needsReview: true
  }), { etag: '"etag-saved-sources"' }));
  await harness.controller.open({ eventId: "event-saved-sources", sessionKey: "saved-sources" });

  ok(harness.elements.sources.innerHTML.includes("保存时来源"), "来源失效后仍展示只读的保存时来源区");
  ok(harness.elements.sources.innerHTML.includes("2024-06-18") && harness.elements.sources.innerHTML.includes("2024-06-19"), "旧 alternatives 的两项日期仍可解释");
  ok(harness.elements.sources.innerHTML.includes("不能再次勾选"), "保存时来源明确是解释快照而非当前证据");
  equal(harness.elements.sources.sourceInputs.length, 1, "失效来源不会伪装成仍可选择的复选框");
}

async function checkPutAndBusyState() {
  const harness = createHarness();
  harness.queue.enqueue(jsonResponse(workspace(), { etag: '"etag-before-save"' }));
  await harness.controller.open({ eventId: "event-save", sessionKey: 11 });
  selectResolution(harness, "day");
  harness.elements.intervalStart.value = "2024-06-18";
  harness.elements.sources.sourceInputs[0].checked = true;
  harness.elements.note.value = "采用原文中明确写下的日期";

  const pending = deferred();
  harness.queue.enqueue(() => pending.promise);
  const submit = harness.elements.form.emit("submit");
  equal(harness.elements.details.getAttribute("aria-busy"), "true", "PUT 等待期间 details 标记 aria-busy=true");
  equal(harness.elements.body.getAttribute("aria-busy"), "true", "PUT 等待期间面板 body 标记 aria-busy=true");
  equal(harness.elements.saveButton.disabled, true, "PUT 等待期间禁止重复提交");
  equal(harness.elements.deleteButton.disabled, true, "PUT 等待期间禁止删除");
  equal(harness.elements.summary.getAttribute("aria-disabled"), "true", "PUT 等待期间折叠/关闭相关操作锁定");

  pending.resolve(jsonResponse(workspace({
    calibration: calibration("day", [ORIGINAL_KEY], "采用原文中明确写下的日期"),
    sourceSetSha256: HASH_A,
    candidateCount: 130,
    candidatesTruncated: true
  }), { etag: '"etag-after-save"', status: 201 }));
  await submit;

  const call = harness.queue.calls[1];
  const body = JSON.parse(call.options.body);
  equal(call.options.method, "PUT", "保存使用 PUT");
  equal(call.options.headers["If-Match"], '"etag-before-save"', "保存携带 GET 返回的 If-Match");
  deepEqual(body, {
    resolutionKind: "day",
    intervalStart: "2024-06-18",
    intervalEnd: "2024-06-18",
    selectedSourceKeys: [ORIGINAL_KEY],
    sourceSetSha256: HASH_A,
    note: "采用原文中明确写下的日期",
    confirm: true
  }, "PUT body 只包含校准合同字段并发送 confirm:true");
  equal(harness.elements.details.getAttribute("aria-busy"), "false", "PUT 完成后清除 busy 状态");
  equal(harness.elements.summary.getAttribute("aria-disabled"), null, "PUT 完成后恢复 summary 操作");
  equal(harness.elements.status.textContent, "时间判断已保存；原文和展品日期都没有被改写。", "成功文案再次声明不改写边界");
  equal(harness.elements.badge.textContent, "已校准", "保存后摘要显示已校准语义");
  ok(harness.elements.sources.innerHTML.includes("共 130 条"), "保存响应的完整候选计数与截断提示不会在合并后丢失");
  equal(harness.elements.deleteButton.hidden, false, "保存结果存在后展示恢复未校准动作");
  deepEqual(harness.changed, [{ action: "saved", eventId: "event-save", calibration: calibration("day", [ORIGINAL_KEY], "采用原文中明确写下的日期") }], "保存完成后只向宿主广播规范化结果");
}

async function checkConflictRefreshKeepsDraft() {
  const harness = createHarness();
  harness.queue.enqueue(jsonResponse(workspace(), { etag: '"etag-stale"' }));
  await harness.controller.open({ eventId: "event-conflict", sessionKey: "conflict-session" });
  selectResolution(harness, "range");
  harness.elements.intervalStart.value = "2024-06-17";
  harness.elements.intervalEnd.value = "2024-06-19";
  harness.elements.sources.sourceInputs[0].checked = true;
  harness.elements.note.value = "这段草稿不能因冲突丢失🧭";

  harness.queue.enqueue(jsonResponse({ error: "stale" }, { status: 412, etag: '"etag-conflict"' }));
  await harness.elements.form.emit("submit");
  equal(harness.elements.status.textContent, "时间线索已经变化，请重新读取后再确认。你的当前草稿仍保留。", "412 显示专用冲突说明");
  equal(harness.elements.refreshButton.hidden, false, "412 提供显式重新读取按钮");
  equal(harness.elements.saveButton.disabled, true, "冲突账本刷新前禁止继续覆盖式保存");
  equal(harness.elements.note.value, "这段草稿不能因冲突丢失🧭", "412 后备注草稿原样保留");
  equal(harness.elements.intervalStart.value, "2024-06-17", "412 后区间草稿原样保留");
  equal(harness.elements.sources.sourceInputs[0].checked, true, "412 后来源选择原样保留");

  harness.queue.enqueue(jsonResponse(workspace({ sourceSetSha256: HASH_C }), { etag: '"etag-refreshed"' }));
  await harness.elements.refreshButton.emit("click");
  equal(harness.elements.note.value, "这段草稿不能因冲突丢失🧭", "刷新最新账本后继续保留用户备注");
  equal(selectedResolution(harness), "range", "刷新最新账本后继续保留分辨率草稿");
  equal(harness.elements.sources.sourceInputs[0].checked, true, "刷新后仍存在的来源选择继续保留");
  ok(harness.elements.status.textContent.includes("草稿仍保留"), "刷新完成明确提示草稿仍保留");
  equal(harness.elements.saveButton.disabled, false, "拿到最新 ETag 后重新开放保存");

  harness.queue.enqueue(jsonResponse(workspace({
    sourceSetSha256: HASH_C,
    calibration: {
      resolutionKind: "range",
      intervalStart: "2024-06-17",
      intervalEnd: "2024-06-19",
      selectedSourceKeys: [ORIGINAL_KEY],
      note: "这段草稿不能因冲突丢失🧭"
    }
  }), { etag: '"etag-resaved"' }));
  await harness.elements.form.emit("submit");
  const retry = harness.queue.calls.at(-1);
  equal(retry.options.headers["If-Match"], '"etag-refreshed"', "冲突刷新后的重试使用新 ETag");
  equal(JSON.parse(retry.options.body).sourceSetSha256, HASH_C, "冲突刷新后的重试使用新来源集合 hash");
}

async function checkSourceSetConflictKeepsDraft() {
  const harness = createHarness();
  harness.queue.enqueue(jsonResponse(workspace(), { etag: '"etag-source-race"' }));
  await harness.controller.open({ eventId: "event-source-race", sessionKey: "source-race" });
  selectResolution(harness, "day");
  harness.elements.intervalStart.value = "2024-06-18";
  harness.elements.sources.sourceInputs[0].checked = true;
  harness.elements.note.value = "来源竞态下也要保留";

  harness.queue.enqueue(jsonResponse({
    error: "Time sources changed; refresh before saving.",
    code: "CALIBRATION_SOURCES_CHANGED"
  }, { status: 409 }));
  await harness.elements.form.emit("submit");
  equal(harness.elements.refreshButton.hidden, false, "来源集合 409 提供显式重新读取入口");
  equal(harness.elements.saveButton.disabled, true, "来源集合 409 在刷新前锁定再次保存");
  equal(harness.elements.note.value, "来源竞态下也要保留", "来源集合 409 保留用户备注草稿");
  equal(harness.elements.sources.sourceInputs[0].checked, true, "来源集合 409 保留来源选择草稿");
}

async function checkDeleteAndFreshEtag() {
  const harness = createHarness();
  harness.queue.enqueue(jsonResponse(workspace({
    calibration: calibration("alternatives", [ORIGINAL_KEY, REVISION_KEY], "两种记录都保留")
  }), { etag: '"etag-delete"' }));
  await harness.controller.open({ eventId: "event-delete", sessionKey: "delete-session" });
  harness.queue.enqueue(jsonResponse({ ok: true, deleted: true }));
  harness.queue.enqueue(jsonResponse(workspace({ calibration: null, sourceSetSha256: HASH_D }), { etag: '"etag-empty-after-delete"' }));
  await harness.elements.deleteButton.emit("click");

  const deleteCall = harness.queue.calls[1];
  equal(deleteCall.options.method, "DELETE", "恢复未校准状态使用 DELETE");
  equal(deleteCall.options.headers["If-Match"], '"etag-delete"', "DELETE 携带当前判断 ETag");
  deepEqual(JSON.parse(deleteCall.options.body), { confirm: true }, "DELETE 发送后端要求的显式确认 body");
  equal(harness.queue.calls[2].options.method, "GET", "DELETE 未返回新 ETag 时主动重读空账本");
  equal(harness.elements.deleteButton.hidden, true, "删除成功后隐藏重复删除动作");
  equal(harness.elements.note.value, "", "删除成功后清空旧判断备注");
  equal(harness.elements.badge.textContent, "待核对", "删除成功后恢复待核对摘要");
  equal(harness.elements.saveButton.disabled, false, "重读空账本的新 ETag 后可再次校准");
  equal(harness.elements.status.textContent, "已恢复未校准状态；两段原文和展品日期都没有被改写。", "删除成功说明原文和日期未改变");
  deepEqual(harness.changed.at(-1), { action: "deleted", eventId: "event-delete", calibration: null }, "删除完成向宿主广播刷新信号");
}

async function checkDemoReadOnly() {
  const harness = createHarness();
  harness.queue.enqueue(jsonResponse(workspace({
    calibration: calibration("day", [ORIGINAL_KEY], "示例判断")
  }), { etag: '"etag-demo"' }));
  await harness.controller.open({ eventId: "event-demo", demo: true, sessionKey: "demo" });
  const requestCount = harness.queue.calls.length;
  equal(harness.elements.details.hidden, false, "Demo 仍可展开查看来源与示例结果");
  equal(harness.elements.sources.sourceInputs.length, 3, "Demo 展示完整来源卡");
  ok(harness.elements.status.textContent.includes("公开 Demo"), "Demo 明确说明不会保存访客修改");
  ok(harness.elements.choices.radioInputs.every((input) => input.disabled), "Demo 禁用所有分辨率单选");
  ok(harness.elements.sources.sourceInputs.every((input) => input.disabled), "Demo 禁用所有来源复选");
  equal(harness.elements.note.disabled, true, "Demo 禁用备注修改");
  equal(harness.elements.saveButton.disabled, true, "Demo 禁用保存");
  equal(harness.elements.deleteButton.disabled, true, "Demo 禁用删除示例判断");
  await harness.elements.form.emit("submit");
  await harness.elements.deleteButton.emit("click");
  equal(harness.queue.calls.length, requestCount, "Demo 提交与删除事件都不会发出 mutation 请求");
}

async function checkHostBusyLock() {
  const harness = createHarness();
  harness.queue.enqueue(jsonResponse(workspace({
    calibration: calibration("day", [ORIGINAL_KEY], "已保存判断")
  }), { etag: '"etag-host-busy"' }));
  await harness.controller.open({ eventId: "event-host-busy", sessionKey: "host-busy" });
  equal(typeof harness.controller.setHostBusy, "function", "controller 向宿主暴露 setHostBusy");
  const busyNotifications = harness.busyChanges.length;
  const requestCount = harness.queue.calls.length;
  harness.controller.setHostBusy(true);
  equal(harness.elements.saveButton.disabled, true, "宿主 mutation 期间锁定保存");
  equal(harness.elements.deleteButton.disabled, true, "宿主 mutation 期间锁定删除");
  equal(harness.elements.refreshButton.disabled, true, "宿主 mutation 期间锁定刷新账本");
  await harness.elements.form.emit("submit");
  await harness.elements.deleteButton.emit("click");
  await harness.elements.refreshButton.emit("click");
  equal(harness.queue.calls.length, requestCount, "宿主 mutation 期间 submit/delete/refresh 都不发请求");
  equal(harness.busyChanges.length, busyNotifications, "setHostBusy 不反向触发 onBusyChange 形成递归锁");
  harness.controller.setHostBusy(false);
  equal(harness.elements.saveButton.disabled, false, "宿主 mutation 结束后恢复保存");
  equal(harness.elements.deleteButton.disabled, false, "宿主 mutation 结束后恢复删除");
  equal(harness.elements.refreshButton.disabled, false, "宿主 mutation 结束后恢复刷新");
}

async function checkAbortAndStaleSessions() {
  const harness = createHarness({ queue: false });
  const first = deferred();
  const second = deferred();
  harness.fetchImpl = queuedDeferredFetch(harness.calls, [first.promise, second.promise]);
  harness.recreateController();

  const openFirst = harness.controller.open({ eventId: "event-old", sessionKey: "old-session" });
  const firstSignal = harness.calls[0].options.signal;
  const openSecond = harness.controller.open({ eventId: "event-new", sessionKey: "new-session" });
  equal(firstSignal.aborted, true, "新 open 会中止上一拼图的 AbortController");
  second.resolve(jsonResponse(workspace({ title: "新拼图来源" }), { etag: '"etag-new"' }));
  await openSecond;
  first.resolve(jsonResponse(workspace({ title: "旧拼图不应写回" }), { etag: '"etag-old"' }));
  await openFirst;
  ok(harness.elements.sources.innerHTML.includes("新拼图来源"), "新 sessionKey 响应写入当前拼图");
  ok(!harness.elements.sources.innerHTML.includes("旧拼图不应写回"), "忽略 Abort 的旧响应也不能跨 sessionKey 写回");

  const refreshHarness = createHarness({ queue: false });
  const loading = deferred();
  const refreshed = deferred();
  refreshHarness.fetchImpl = queuedDeferredFetch(refreshHarness.calls, [loading.promise, refreshed.promise]);
  refreshHarness.recreateController();
  const initialOpen = refreshHarness.controller.open({ eventId: "event-refresh-abort", sessionKey: 9 });
  const loadingSignal = refreshHarness.calls[0].options.signal;
  const refresh = refreshHarness.controller.refreshLedger();
  equal(loadingSignal.aborted, true, "refreshLedger 即使读取中也会中止旧 AbortController");
  refreshed.resolve(jsonResponse(workspace({ title: "刷新后的来源" }), { etag: '"etag-refresh"' }));
  await refresh;
  loading.resolve(jsonResponse(workspace({ title: "被取消的来源" }), { etag: '"etag-cancelled"' }));
  await initialOpen;
  ok(refreshHarness.elements.sources.innerHTML.includes("刷新后的来源"), "refreshLedger 只呈现最新会话的账本");
}

async function checkResetClearsSensitiveState() {
  const harness = createHarness({ queue: false });
  const loading = deferred();
  harness.fetchImpl = queuedDeferredFetch(harness.calls, [loading.promise]);
  harness.recreateController();
  const open = harness.controller.open({ eventId: "event-reset", sessionKey: "reset" });
  const signal = harness.calls[0].options.signal;
  harness.elements.note.value = "不应留在下一个拼图的敏感草稿";
  harness.controller.reset();
  equal(signal.aborted, true, "reset 中止正在读取的 AbortController");
  equal(harness.elements.details.hidden, true, "reset 隐藏未绑定事件的入口");
  equal(harness.elements.details.open, false, "reset 折叠入口");
  equal(harness.elements.note.value, "", "reset 清空备注草稿");
  equal(harness.elements.intervalStart.value, "", "reset 清空开始日期");
  equal(harness.elements.intervalEnd.value, "", "reset 清空结束日期");
  equal(harness.elements.sources.innerHTML, "", "reset 清空候选 payload 的 DOM 副本");
  ok(harness.elements.choices.radioInputs.every((input) => !input.checked && input.disabled), "reset 清空并锁定所有分辨率选择");
  equal(harness.elements.saveButton.disabled, true, "reset 后不能用旧 ETag 保存");
  loading.resolve(jsonResponse(workspace({ title: "reset 后迟到的来源" }), { etag: '"late"' }));
  await open;
  equal(harness.elements.sources.innerHTML, "", "reset 后迟到的响应不会重新写入敏感内容");

  harness.controller.destroy();
  equal(harness.elements.form.listenerCount("submit"), 0, "destroy 移除表单监听器");
  equal(harness.elements.deleteButton.listenerCount("click"), 0, "destroy 移除 mutation 监听器");
}

function createHarness(options = {}) {
  const { document, elements } = createFakeDocument();
  const queue = options.queue === false ? null : createFetchQueue();
  const harness = {
    document,
    elements,
    queue,
    calls: queue?.calls || [],
    fetchImpl: queue?.fetch,
    busyChanges: [],
    changed: [],
    controller: null,
    recreateController() {
      this.controller?.destroy();
      this.controller = moduleApi.createController({
        document: this.document,
        fetch: this.fetchImpl,
        confirm: () => true,
        onBusyChange: (busy) => this.busyChanges.push(busy),
        onChanged: (change) => this.changed.push(change)
      });
    }
  };
  if (harness.fetchImpl) harness.recreateController();
  return harness;
}

function createFakeDocument() {
  const tags = {
    details: "details",
    summary: "summary",
    badge: "span",
    body: "div",
    intro: "p",
    sources: "div",
    form: "form",
    choices: "fieldset",
    interval: "div",
    intervalStart: "input",
    intervalEnd: "input",
    note: "textarea",
    status: "p",
    saveButton: "button",
    deleteButton: "button",
    refreshButton: "button"
  };
  const elements = {};
  const byId = new Map();
  for (const [key, id] of Object.entries(moduleApi.domIds)) {
    const element = new FakeElement(id, tags[key]);
    elements[key] = element;
    byId.set(id, element);
  }
  elements.summary.summaryCopy = new FakeElement("", "small");
  elements.choices.radioInputs = ["day", "range", "alternatives", "uncertain"].map((value) => {
    const input = new FakeElement("", "input");
    input.type = "radio";
    input.name = "timeCalibrationResolutionKind";
    input.value = value;
    return input;
  });
  elements.intervalStart.type = "date";
  elements.intervalEnd.type = "date";
  elements.intervalStart.parentElement = new FakeElement("", "label");
  elements.intervalEnd.parentElement = new FakeElement("", "label");
  return { document: { getElementById: (id) => byId.get(id) || null }, elements };
}

class FakeElement {
  constructor(id, tagName) {
    this.id = id;
    this.tagName = String(tagName || "div").toUpperCase();
    this.hidden = false;
    this.open = false;
    this.disabled = false;
    this.checked = false;
    this.value = "";
    this.name = "";
    this.type = "";
    this.dataset = {};
    this.parentElement = null;
    this.radioInputs = [];
    this.sourceInputs = [];
    this.summaryCopy = null;
    this.focused = false;
    this._textContent = "";
    this._innerHTML = "";
    this.attributes = new Map();
    this.listeners = new Map();
  }

  set textContent(value) { this._textContent = String(value ?? ""); }
  get textContent() { return this._textContent; }

  set innerHTML(value) {
    this._innerHTML = String(value ?? "");
    if (this.id !== moduleApi.domIds.sources) return;
    this.sourceInputs = [];
    const pattern = /<input\b[^>]*name="timeCalibrationSourceKey"[^>]*value="([^"]*)"[^>]*>/gu;
    for (const match of this._innerHTML.matchAll(pattern)) {
      const input = new FakeElement("", "input");
      input.type = "checkbox";
      input.name = "timeCalibrationSourceKey";
      input.value = decodeHtml(match[1]);
      input.parentElement = this;
      this.sourceInputs.push(input);
    }
  }

  get innerHTML() { return this._innerHTML; }

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }

  removeEventListener(type, handler) {
    const list = this.listeners.get(type) || [];
    this.listeners.set(type, list.filter((candidate) => candidate !== handler));
  }

  listenerCount(type) { return (this.listeners.get(type) || []).length; }

  async emit(type, values = {}) {
    const event = {
      type,
      target: values.target || this,
      key: values.key || "",
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; }
    };
    const results = (this.listeners.get(type) || []).map((handler) => handler(event));
    await Promise.all(results.map((result) => Promise.resolve(result)));
    return event;
  }

  querySelectorAll(selector) {
    if (selector.includes("timeCalibrationResolutionKind")) return this.radioInputs;
    if (selector.includes("timeCalibrationSourceKey")) return this.sourceInputs;
    return [];
  }

  querySelector(selector) {
    if (selector === "small" && this.summaryCopy) return this.summaryCopy;
    return null;
  }

  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  removeAttribute(name) { this.attributes.delete(name); }
  focus() { this.focused = true; }
}

function createFetchQueue() {
  const entries = [];
  const calls = [];
  return {
    calls,
    enqueue(value) { entries.push(value); },
    fetch(url, options) {
      calls.push({ url, options });
      if (!entries.length) return Promise.reject(new Error(`Unexpected fetch: ${options?.method || "GET"} ${url}`));
      const next = entries.shift();
      try { return Promise.resolve(typeof next === "function" ? next({ url, options }) : next); }
      catch (error) { return Promise.reject(error); }
    }
  };
}

function queuedDeferredFetch(calls, promises) {
  let index = 0;
  return (url, options) => {
    calls.push({ url, options });
    if (!promises[index]) return Promise.reject(new Error(`Unexpected deferred fetch: ${url}`));
    return promises[index++];
  };
}

function jsonResponse(payload, options = {}) {
  const status = options.status || 200;
  const headers = new Map();
  if (options.etag) headers.set("etag", options.etag);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers.get(String(name).toLowerCase()) || null },
    async text() { return payload === undefined ? "" : JSON.stringify(payload); }
  };
}

function workspace(options = {}) {
  const sourceSetSha256 = options.sourceSetSha256 || HASH_A;
  return {
    target: { type: "event", id: "event", title: "夏日拼图" },
    candidates: options.candidates || [
      candidate(ORIGINAL_KEY, "memory-current", options.title || "第一段记录", { displayDate: "2024-06-18" }),
      candidate(REVISION_KEY, "revision", "一次记忆修订", { displayDate: "2024-06-19", revisionNo: 2 }),
      candidate(PHOTO_KEY, "exif", "相机中的原始照片", { displayDate: "2024-06-18" })
    ],
    ...(Object.hasOwn(options, "candidateCount") ? { candidateCount: options.candidateCount } : {}),
    ...(Object.hasOwn(options, "candidatesTruncated") ? { candidatesTruncated: options.candidatesTruncated } : {}),
    sourceSetSha256,
    calibration: options.calibration === undefined ? null : options.calibration,
    needsReview: options.needsReview === true,
    etag: options.etag || ""
  };
}

function candidate(sourceKey, sourceType, memoryTitle, extra = {}) {
  return {
    sourceKey,
    sourceType,
    status: sourceType === "memory-current" ? "current" : "recorded",
    precision: "day",
    intervalStart: "2024-06-18",
    intervalEnd: "2024-06-18",
    displayDate: "2024-06-18",
    memoryId: "memory-1",
    memoryTitle,
    ...extra
  };
}

function puzzlePayload(options = {}) {
  const eventId = options.eventId || "event-calibration-route";
  const confirmed = options.confirmed !== false;
  return {
    event: confirmed ? { id: eventId, title: "时间校准拼图" } : null,
    decision: confirmed ? { decision: "same_event" } : null,
    puzzle: {
      pair: { left: { id: "memory-left" }, right: { id: "memory-right" } },
      differs: options.hasDateDifference ? [{ field: "date", verified: true }] : []
    }
  };
}

function calibration(resolutionKind, selectedSourceKeys, note) {
  return {
    resolutionKind,
    intervalStart: resolutionKind === "day" ? "2024-06-18" : "",
    intervalEnd: resolutionKind === "day" ? "2024-06-18" : "",
    selectedSourceKeys,
    selectedSourceSnapshots: selectedSourceKeys.map((sourceKey) => {
      const revision = sourceKey === REVISION_KEY;
      return {
        intervalEnd: revision ? "2024-06-19" : "2024-06-18",
        intervalStart: revision ? "2024-06-19" : "2024-06-18",
        precision: "day",
        sourceKey,
        sourceType: revision ? "revision" : sourceKey === PHOTO_KEY ? "exif" : "memory-current"
      };
    }).sort((left, right) => left.sourceKey.localeCompare(right.sourceKey, "en")),
    note
  };
}

function selectResolution(harness, value) {
  harness.elements.choices.radioInputs.forEach((input) => { input.checked = input.value === value; });
  return harness.elements.form.emit("change", { target: harness.elements.choices.radioInputs.find((input) => input.value === value) });
}

function selectedResolution(harness) {
  return harness.elements.choices.radioInputs.find((input) => input.checked)?.value || "";
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function waitFor(predicate, message) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error(`Timed out waiting for: ${message}`);
}

function decodeHtml(value) {
  return String(value).replaceAll("&quot;", '"').replaceAll("&#39;", "'").replaceAll("&gt;", ">").replaceAll("&lt;", "<").replaceAll("&amp;", "&");
}

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
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

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
