"use strict";

const path = require("node:path");

require(path.join(__dirname, "..", "public", "assets", "oral-histories.js"));

const oral = globalThis.TimeIsleOralHistories;
let assertions = 0;

async function main() {
  check(oral && typeof oral === "object", "口述史模块可独立加载");
  ["createController", "normalizeWorkspace", "puzzleTarget", "formatPrecise"].forEach((name) => {
    check(typeof oral[name] === "function", `口述史模块导出 ${name}`);
  });
  equal(oral.formatPrecise(61_260), "01:01.2", "选段时码保留 0.1 秒精度");
  check(!oral.puzzleTarget({ event: { id: "event-a" }, decision: { decision: "same_event" }, puzzle: { pair: {}, differs: [] } }).hasDateDifference, "无日期差异的已确认拼图只用于回看已存来源");
  equal(oral.puzzleTarget({ puzzle: { differs: [{ field: "date", verified: true }] } }), null, "未确认同一往事时不启动口述史");

  const success = createHarness();
  success.controller.syncPuzzle({ payload: puzzlePayload(true), demo: false, sessionKey: 1 });
  await flush();
  check(!success.elements.details.hidden && !success.elements.details.open, "未解决日期差异显示默认折叠口述入口");
  check(success.elements.questionChoices.innerHTML.includes("两段记录的日期不一致"), "问题只来自服务端绑定的时间差异");
  check(success.elements.sourceRegion.hidden, "尚无确认回答时不留空来源卡");

  selectQuestion(success);
  success.capture.ready();
  success.elements.transcript.value = "我记得是第一种日期，因为那天刚好是周末。";
  await success.elements.form.dispatch("input", { target: success.elements.transcript });
  const firstResolution = success.elements.resolutionChoices.inputs.find((input) => input.value === "first");
  firstResolution.checked = true;
  await success.elements.form.dispatch("change", { target: firstResolution });
  success.elements.acknowledge.checked = true;
  await success.elements.form.dispatch("change", { target: success.elements.acknowledge });
  check(!success.elements.saveButton.disabled, "问题、声音、选段、文字和时间含义完整后才开放确认");
  await success.elements.form.dispatch("submit");
  await flush();

  const put = success.requests.find((request) => request.method === "PUT");
  check(Boolean(put), "确认后使用事件级口述史 PUT");
  equal(put.headers["If-Match"], '"oral-v1"', "PUT 携带当前 workspace ETag");
  deepEqual(Object.keys(put.body).sort(), [
    "assetId", "confirm", "confirmTranscript", "intervalEnd", "intervalStart", "questionSetSha256",
    "resolutionKind", "segmentEndMs", "segmentStartMs", "submissionId", "transcriptText"
  ].sort(), "PUT 请求只包含约定白名单字段");
  equal(put.body.resolutionKind, "day", "选择第一种确切日期映射为 day");
  equal(put.body.intervalStart, "2019-06-01", "第一日期使用不可变来源快照");
  check(put.body.confirmTranscript === true && put.body.confirm === true, "文字稿和来源均要求显式人工确认");
  check(success.capture.attached, "原子保存后标记声音已被口述史引用");
  check(!success.elements.sourceRegion.hidden, "保存后在拼图中显示独立口述来源");
  check(success.elements.sourceList.innerHTML.includes("独立来源") && success.elements.sourceList.innerHTML.includes("我记得是第一种日期"), "来源卡直接呈现人工确认文字");
  check(success.elements.sourceList.innerHTML.includes("重新回答") && success.elements.sourceList.innerHTML.includes("删除来源"), "当前来源提供重做与撤回入口");

  await success.elements.sourceList.dispatch("click", { target: actionTarget("redo") });
  selectQuestion(success);
  success.capture.ready();
  success.elements.transcript.value = "这是重新回答后的第二份人工文字稿。";
  await success.elements.form.dispatch("input", { target: success.elements.transcript });
  const secondUncertain = success.elements.resolutionChoices.inputs.find((input) => input.value === "uncertain");
  secondUncertain.checked = true;
  await success.elements.form.dispatch("change", { target: secondUncertain });
  success.elements.acknowledge.checked = true;
  await success.elements.form.dispatch("change", { target: success.elements.acknowledge });
  await success.elements.form.dispatch("submit");
  await flush();
  check(success.elements.sourceList.innerHTML.includes("之前的回答（1）"), "重答后旧证据进入默认折叠历史");
  check(success.elements.sourceList.innerHTML.includes("我记得是第一种日期") && success.elements.sourceList.innerHTML.includes("这是重新回答后"), "新旧两份人工来源均可回看");
  check(success.elements.sourceList.innerHTML.includes("被新回答接替"), "superseded 来源显示清晰状态时间");

  await success.elements.sourceList.dispatch("click", { target: actionTarget("delete") });
  await flush();
  const deletion = success.requests.find((request) => request.method === "DELETE");
  deepEqual(deletion.body, { questionSetSha256: SHA, confirm: true }, "删除使用显式确认与问题集版本");
  equal(deletion.headers["If-Match"], '"oral-v3"', "删除使用重答保存后最新 ETag");
  check(success.elements.sourceList.innerHTML.includes("已撤回"), "撤回只改变状态，旧口述证据仍可只读回看");

  const conflict = createHarness({ conflict: true });
  conflict.controller.syncPuzzle({ payload: puzzlePayload(true), demo: false, sessionKey: 2 });
  await flush();
  selectQuestion(conflict);
  conflict.capture.ready();
  conflict.elements.transcript.value = "这份草稿必须在并发冲突后保留。";
  await conflict.elements.form.dispatch("input", { target: conflict.elements.transcript });
  const uncertain = conflict.elements.resolutionChoices.inputs.find((input) => input.value === "uncertain");
  uncertain.checked = true;
  await conflict.elements.form.dispatch("change", { target: uncertain });
  conflict.elements.acknowledge.checked = true;
  await conflict.elements.form.dispatch("change", { target: conflict.elements.acknowledge });
  await conflict.elements.form.dispatch("submit");
  await flush();
  check(conflict.elements.status.textContent.includes("草稿仍保留"), "409/412 明确告知草稿保留");
  equal(conflict.elements.transcript.value, "这份草稿必须在并发冲突后保留。", "冲突不清除文字稿");
  check(conflict.capture.state.ready, "冲突不清除已上传声音");
  check(conflict.elements.refreshButton.hidden === false && conflict.elements.saveButton.disabled, "冲突后要求刷新并重选问题");
  check(!conflict.elements.questionChoices.querySelectorAll('input[name="oralHistoryQuestionId"]')[0].checked, "冲突后不静默重绑旧问题");

  const readOnly = createHarness({ demo: true, eligibility: false, confirmed: true });
  readOnly.controller.syncPuzzle({ payload: puzzlePayload(false), demo: true, sessionKey: 3 });
  await flush();
  check(readOnly.elements.details.hidden, "日期差异已消失时隐藏新回答入口");
  check(!readOnly.elements.sourceRegion.hidden, "差异消失后仍可回看已确认来源");
  check(readOnly.elements.sourceList.innerHTML.includes("disabled"), "Demo 中重做与删除控件均只读");
  await readOnly.elements.form.dispatch("submit");
  check(!readOnly.requests.some((request) => ["PUT", "DELETE"].includes(request.method)), "Demo 口述史零写请求");

  [success, conflict, readOnly].forEach((item) => item.controller.destroy());
  console.log(`Oral-history UI checks passed: ${assertions} assertions.`);
}

function createHarness(options = {}) {
  const elements = createElements();
  const requests = [];
  let current = workspace({ demo: options.demo, eligibility: options.eligibility, confirmed: options.confirmed });
  let version = 1;
  let etag = `"oral-v${version}"`;
  const fetchImpl = async (url, request = {}) => {
    const method = request.method || "GET";
    const body = request.body ? JSON.parse(request.body) : null;
    requests.push({ url, method, body, headers: request.headers || {} });
    if (method === "PUT" && options.conflict) {
      return responseJson({ error: "时间线索已变化。", code: "ORAL_HISTORY_QUESTION_SET_CHANGED" }, 409, etag);
    }
    if (method === "PUT") {
      const previous = current.currentConfirmed;
      version += 1;
      etag = `"oral-v${version}"`;
      const history = [...(current.history || [])];
      if (previous) history.unshift({ ...previous, status: "superseded", supersededAt: "2026-07-18T01:00:00.000Z" });
      current = workspace({ confirmed: true, answerId: `oral-answer-${version}`, transcriptText: body.transcriptText, history });
      return responseJson({ ok: true, ...current, etag }, 201, etag);
    }
    if (method === "DELETE") {
      version += 1;
      etag = `"oral-v${version}"`;
      const withdrawn = current.currentConfirmed ? [{ ...current.currentConfirmed, status: "withdrawn", withdrawnAt: "2026-07-18T02:00:00.000Z" }, ...(current.history || [])] : current.history;
      current = workspace({ confirmed: false, history: withdrawn });
      return responseJson({ ok: true, withdrawnCount: 1, ...current, etag }, 200, etag);
    }
    return responseJson({ ...current, etag }, 200, etag);
  };
  const capture = createCaptureHarness();
  const controller = oral.createController({
    document: { getElementById: (id) => elements.byId.get(id) || null },
    elements,
    fetch: fetchImpl,
    demo: Boolean(options.demo),
    captureFactory: capture.factory,
    confirm: () => true
  });
  return { controller, elements, requests, capture };
}

function workspace(options = {}) {
  const answer = options.confirmed ? {
    id: options.answerId || "oral-answer-1",
    submissionId: "oral-submit-1",
    status: "confirmed",
    assetId: "voice-ready",
    asset: { id: "voice-ready", durationMs: 12_300, mimeType: "audio/webm", contentUrl: "/api/voice/assets/voice-ready/content" },
    segmentStartMs: 0,
    segmentEndMs: 12_300,
    transcriptText: options.transcriptText || "我记得是第一种日期，因为那天刚好是周末。",
    resolutionKind: "day",
    intervalStart: "2019-06-01",
    intervalEnd: "2019-06-01",
    createdAt: "2026-07-18T00:00:00.000Z",
    confirmedAt: "2026-07-18T00:00:00.000Z",
    supersededAt: "",
    withdrawnAt: ""
  } : null;
  return {
    event: { id: "event-a", title: "湖边散步", status: "confirmed", memberCount: 2 },
    eligibility: {
      eligible: options.eligibility !== false,
      canAnswer: options.eligibility !== false,
      reason: options.eligibility === false ? "resolved" : "unresolved_date_difference",
      calibrationState: options.eligibility === false ? "day" : "uncertain",
      needsReview: false
    },
    question: {
      id: "",
      questionKey: "oral-question:date-difference-a",
      text: "两段记录的日期不一致。哪一种更接近当时，还是仍不确定？",
      persisted: true,
      sources: [
        { sourceKey: `time-source:${"1".repeat(64)}`, sourceType: "original", precision: "day", intervalStart: "2019-06-01", intervalEnd: "2019-06-01", memoryId: "memory-left", memoryTitle: "第一段记录" },
        { sourceKey: `time-source:${"2".repeat(64)}`, sourceType: "original", precision: "day", intervalStart: "2019-06-02", intervalEnd: "2019-06-02", memoryId: "memory-right", memoryTitle: "第二段记录" }
      ]
    },
    questionSetSha256: SHA,
    currentDraft: null,
    currentConfirmed: answer,
    history: options.history || [],
    demo: Boolean(options.demo)
  };
}

function puzzlePayload(withDateDifference) {
  return {
    event: { id: "event-a", title: "湖边散步" },
    decision: { decision: "same_event" },
    puzzle: {
      pair: { left: { id: "memory-left" }, right: { id: "memory-right" } },
      differs: withDateDifference ? [{ field: "date", verified: true }] : []
    }
  };
}

function selectQuestion(harness) {
  const input = harness.elements.questionChoices.querySelectorAll('input[name="oralHistoryQuestionId"]')[0];
  input.checked = true;
  return harness.elements.form.dispatch("change", { target: input });
}

function createCaptureHarness() {
  let callbacks;
  const state = { ready: false, assetId: "", durationMs: 0, busy: false };
  const harness = {
    state,
    attached: false,
    hostBusy: false,
    factory: (options) => {
      callbacks = options;
      return {
        waitForReady: async () => ({ ...state }),
        markAttached: () => { harness.attached = true; },
        reset: () => {
          state.ready = false;
          state.assetId = "";
          state.durationMs = 0;
          callbacks.onChange?.({ ...state });
        },
        setDemo: () => {},
        setHostBusy: (value) => { harness.hostBusy = Boolean(value); },
        destroy: () => {}
      };
    },
    ready: () => {
      state.ready = true;
      state.assetId = "voice-ready";
      state.durationMs = 12_300;
      state.contentUrl = "/api/voice/assets/voice-ready/content";
      callbacks.onChange?.({ ...state });
    }
  };
  return harness;
}

function createElements() {
  const ids = {
    details: "oralHistoryDetails", summary: "oralHistorySummary", summaryCopy: "oralHistorySummaryCopy", badge: "oralHistoryBadge",
    sourceRegion: "oralHistorySourceRegion", sourceCount: "oralHistorySourceCount", sourceList: "oralHistorySourceList", status: "oralHistoryStatus",
    form: "oralHistoryForm", questionStep: "oralHistoryQuestionStep", questionChoices: "oralHistoryQuestionChoices", audioStep: "oralHistoryAudioStep",
    recordButton: "oralHistoryRecordButton", fileInput: "oralHistoryFileInput", fileLabel: "oralHistoryFileLabel", captureHelp: "oralHistoryCaptureHelp",
    recording: "oralHistoryRecording", timer: "oralHistoryRecordingTimer", stopButton: "oralHistoryStopButton", cancelButton: "oralHistoryCancelButton",
    draftAudio: "oralHistoryDraftAudio", captureStatus: "oralHistoryCaptureStatus", retryButton: "oralHistoryRetryButton", removeAudioButton: "oralHistoryRemoveAudioButton",
    segmentStep: "oralHistorySegmentStep", segmentStart: "oralHistorySegmentStart", segmentStartOutput: "oralHistorySegmentStartOutput",
    segmentEnd: "oralHistorySegmentEnd", segmentEndOutput: "oralHistorySegmentEndOutput", markStartButton: "oralHistoryMarkStartButton",
    markEndButton: "oralHistoryMarkEndButton", previewSegmentButton: "oralHistoryPreviewSegmentButton", transcriptStep: "oralHistoryTranscriptStep",
    transcript: "oralHistoryTranscript", resolutionChoices: "oralHistoryResolutionChoices", firstDateLabel: "oralHistoryFirstDateLabel",
    firstDateMeta: "oralHistoryFirstDateMeta", secondDateLabel: "oralHistorySecondDateLabel", secondDateMeta: "oralHistorySecondDateMeta",
    customInterval: "oralHistoryCustomInterval", intervalStartLabel: "oralHistoryIntervalStartLabel", intervalStart: "oralHistoryIntervalStart",
    intervalEndField: "oralHistoryIntervalEndField", intervalEnd: "oralHistoryIntervalEnd", acknowledge: "oralHistoryAcknowledge",
    saveButton: "oralHistorySaveButton", resetButton: "oralHistoryResetButton", refreshButton: "oralHistoryRefreshButton"
  };
  const elements = Object.fromEntries(Object.entries(ids).map(([key, id]) => [key, new FakeElement(id)]));
  elements.questionChoices.kind = "question";
  elements.resolutionChoices.kind = "resolution";
  elements.resolutionChoices.inputs = ["first", "second", "day", "range", "uncertain"].map((value) => new FakeInput("oralHistoryResolutionChoice", value));
  elements.draftAudio.duration = 12.3;
  elements.byId = new Map(Object.values(elements).filter((value) => value instanceof FakeElement).map((element) => [element.id, element]));
  return elements;
}

class FakeElement {
  constructor(id) {
    this.id = id;
    this.hidden = false;
    this.open = false;
    this.disabled = false;
    this.value = "";
    this.checked = false;
    this.textContent = "";
    this.innerHTML = "";
    this.dataset = {};
    this.attributes = new Map();
    this.listeners = new Map();
    this.currentTime = 0;
    this.duration = 0;
  }
  addEventListener(type, handler) {
    const list = this.listeners.get(type) || [];
    list.push(handler);
    this.listeners.set(type, list);
  }
  removeEventListener(type, handler) { this.listeners.set(type, (this.listeners.get(type) || []).filter((item) => item !== handler)); }
  async dispatch(type, event = {}) {
    for (const handler of [...(this.listeners.get(type) || [])]) await handler({ target: this, preventDefault: () => {}, ...event });
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) || ""; }
  querySelectorAll(selector) {
    if (this.kind === "resolution") return this.inputs;
    if (this.kind === "question") {
      const value = /name="oralHistoryQuestionId" value="([^"]+)"/u.exec(this.innerHTML)?.[1] || "";
      const input = new FakeInput("oralHistoryQuestionId", value);
      input.checked = / checked/u.test(this.innerHTML);
      return value ? [input] : [];
    }
    return [];
  }
  contains() { return true; }
  focus() { this.focused = true; }
  pause() {}
  async play() {}
}

class FakeInput extends FakeElement {
  constructor(name, value) {
    super(`${name}-${value}`);
    this.name = name;
    this.value = value;
  }
}

function actionTarget(action) {
  const target = { dataset: { oralHistoryAction: action } };
  target.closest = (selector) => selector === "[data-oral-history-action]" ? target : null;
  return target;
}

function responseJson(payload, status, etag) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => name.toLowerCase() === "etag" ? etag : "application/json" },
    text: async () => JSON.stringify(payload)
  };
}

async function flush() {
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

function check(condition, message) {
  assertions += 1;
  if (!condition) throw new Error(`not ok - ${message}`);
}

function equal(actual, expected, message) {
  check(actual === expected, `${message}\n  expected: ${JSON.stringify(expected)}\n  actual: ${JSON.stringify(actual)}`);
}

function deepEqual(actual, expected, message) {
  check(JSON.stringify(actual) === JSON.stringify(expected), `${message}\n  expected: ${JSON.stringify(expected)}\n  actual: ${JSON.stringify(actual)}`);
}

const SHA = "a".repeat(64);

main().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
