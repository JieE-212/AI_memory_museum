"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "public/assets/media-lab.js"), "utf8");
const css = fs.readFileSync(path.join(root, "public/media-lab.css"), "utf8");
let assertions = 0;

function check(value, message) {
  assert.ok(value, message);
  assertions += 1;
}

function equal(actual, expected, message) {
  assert.equal(actual, expected, message);
  assertions += 1;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

class FakeElement {
  constructor() {
    this.listeners = new Map();
    this.dataset = {};
    this.attributes = new Map();
    this.hidden = false;
    this.disabled = false;
    this.innerHTML = "";
    this.textContent = "";
    this.value = "0";
    this.selectedIndex = 0;
  }

  addEventListener(type, listener) {
    const group = this.listeners.get(type) || [];
    group.push(listener);
    this.listeners.set(type, group);
  }

  removeEventListener(type, listener) {
    const group = this.listeners.get(type) || [];
    this.listeners.set(type, group.filter((candidate) => candidate !== listener));
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  async dispatch(type) {
    const group = [...(this.listeners.get(type) || [])];
    await Promise.all(group.map((listener) => listener({ type, target: this })));
  }
}

function createPanelFixture() {
  const elements = {
    select: new FakeElement(),
    findButton: new FakeElement(),
    current: new FakeElement(),
    status: new FakeElement(),
    results: new FakeElement(),
    resultList: new FakeElement(),
    ocrHost: new FakeElement()
  };
  const selectorMap = new Map([
    ["[data-media-lab-select]", elements.select],
    ['[data-media-lab-action="find-similar"]', elements.findButton],
    ["[data-media-lab-current]", elements.current],
    ["[data-media-lab-status]", elements.status],
    ["[data-media-lab-results]", elements.results],
    ["[data-media-lab-result-list]", elements.resultList],
    ["[data-media-lab-ocr]", elements.ocrHost]
  ]);
  const panel = new FakeElement();
  panel.querySelector = (selector) => selectorMap.get(selector) || null;
  panel.matches = (selector) => selector === "[data-media-lab-panel]";
  const container = {
    querySelector(selector) {
      return selector === "[data-media-lab-panel]" ? panel : null;
    }
  };
  return { panel, container, elements };
}

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return JSON.stringify(payload); }
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function main() {
  const ocrRenders = [];
  let ocrHydrates = 0;
  let ocrDestroys = 0;
  const sandbox = {
    AbortController,
    TimeIsleMediaOcr: {
      renderOcrPanel(context) {
        ocrRenders.push({ ...context });
        return `<details data-media-ocr-panel>${escapeHtml(context.assetId)}</details>`;
      },
      hydrate(host, options) {
        ocrHydrates += 1;
        check(host.innerHTML.includes("data-media-ocr-panel"), "OCR hydrate 应接收已经渲染的当前照片面板");
        check(typeof options.fetch === "function", "实验台应把同一个本地 fetch 传给 OCR 模块");
        return [{ destroy() { ocrDestroys += 1; } }];
      }
    }
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox, { filename: "media-lab.js" });
  const api = sandbox.TimeIsleMediaLab;

  check(api && typeof api.createController === "function", "应公开 createController");
  check(typeof api.renderPanel === "function", "应公开 renderPanel");
  equal(api.renderPanel({ id: "empty", media: [] }), "", "没有照片的展品不应渲染实验台");
  equal(api.renderPanel({ id: "bad", media: [{ assetId: "a", urls: { display: "https://tracker.example/a.jpg" } }] }), "", "远程图片不得进入本地影像实验台");

  const markup = api.renderPanel({
    id: "memory-safe",
    media: [
      { assetId: "second", position: 2, caption: "第二张", urls: { display: "/api/media/second/display" } },
      { assetId: "first", position: 1, caption: '<img src=x onerror="bad()">', urls: { display: "/api/media/first/display" } }
    ]
  }, escapeHtml);
  check(markup.startsWith('<details class="media-lab"'), "实验台应使用原生 details 折叠容器");
  check(!/^<details[^>]*\sopen(?:\s|>)/.test(markup), "实验台不得默认展开");
  check(markup.includes("影像线索实验台") && markup.includes("可选 · 结果由你核对"), "摘要应清楚说明实验性质和核对边界");
  check(markup.includes("data-media-lab-select") && (markup.match(/<option /g) || []).length === 2, "多张照片应提供当前照片选择器");
  check(markup.indexOf("&lt;img") < markup.indexOf("第二张"), "照片选项应按位置排序并转义不可信说明");
  check(!markup.includes("<img src=x"), "照片说明不得注入 HTML");
  check(markup.includes('data-media-lab-action="find-similar"'), "相似候选只能通过显式按钮触发");
  check(markup.includes("不会自动改写、合并或删除展品"), "面板应声明不会执行破坏性自动操作");
  check(markup.includes('role="status"') && markup.includes('aria-live="polite"'), "异步状态应提供无障碍播报");
  check(!markup.includes("<nav") && !markup.includes("data-view"), "实验台不得增加顶层导航");
  check(!/fingerprint|contentSha256|\bhash\b/i.test(markup), "界面不得显示图片指纹或哈希");

  const secondMarkup = api.renderPanel({ id: "m2", media: [{ assetId: "a2", urls: { display: "/local" } }] });
  check(markup.match(/for="(media-lab-\d+)-photo"/)?.[1] !== secondMarkup.match(/for="(media-lab-\d+)-photo"/)?.[1], "多个实验台实例应使用不同的表单标签 ID");

  const fixture = createPanelFixture();
  const fetchCalls = [];
  let fetchMode = "success";
  let pending = null;
  async function fakeFetch(url, options) {
    fetchCalls.push({ url, options });
    if (fetchMode === "deferred") {
      pending = deferred();
      return pending.promise;
    }
    if (fetchMode === "empty") return response({ ready: true, candidates: [] });
    if (fetchMode === "not-ready") return response({ ready: false, candidates: [] });
    if (fetchMode === "error") return response({ error: "本地检索暂时不可用" }, 503);
    return response({
      ready: true,
      internalHash: "must-not-render",
      candidates: [
        {
          assetId: "candidate-one",
          requiresReview: false,
          media: { urls: { thumb: "/api/media/candidate-one/thumb" }, contentSha256: "secret" },
          memories: [
            { id: "linked-memory", title: "车票 <旧>", date: "2002-04-01" },
            { id: "../unsafe", title: "不能打开" }
          ]
        },
        {
          assetId: "candidate-one",
          media: { urls: { thumb: "/duplicate" } },
          memories: []
        },
        {
          assetId: "selected-a",
          media: { urls: { thumb: "/self" } },
          memories: []
        }
      ]
    });
  }

  const controller = api.createController({ fetch: fakeFetch, AbortController, demo: false });
  const memory = {
    id: "memory-safe",
    media: [
      { assetId: "selected-b", position: 2, caption: "末页", altText: "末页文字", urls: { display: "/api/media/selected-b/display" } },
      { assetId: "selected-a", position: 1, caption: "首页", altText: "首页文字", urls: { display: "/api/media/selected-a/display" } }
    ]
  };
  controller.open(memory, fixture.container);
  equal(fetchCalls.length, 0, "打开或展开实验台不得自动发起相似检索");
  equal(ocrRenders.at(-1).assetId, "selected-a", "打开后应为排序后的第一张照片嵌入 OCR");
  equal(ocrRenders.at(-1).demo, false, "本地模式 OCR 应允许其自身的确认保存流程");
  check(fixture.elements.current.textContent.includes("首页"), "界面应播报当前选中的照片");
  check(fixture.elements.status.textContent.includes("只有点击"), "未检索状态应说明显式触发边界");

  await fixture.elements.findButton.dispatch("click");
  equal(fetchCalls.length, 1, "每次显式点击应只发起一次候选请求");
  equal(fetchCalls[0].url, "/api/media/assets/selected-a/similar?limit=8", "候选请求路径应只包含合法当前照片 ID");
  equal(fetchCalls[0].options.method, "GET", "相似候选接口必须保持只读 GET");
  check(fetchCalls[0].options.signal, "候选请求应绑定 AbortSignal");
  equal(fixture.elements.results.hidden, false, "成功返回后应展示结果区");
  check(fixture.elements.resultList.innerHTML.includes("可能相似 · 需人工核对"), "服务端即使声称无需复核，界面也必须坚持人工核对");
  check(fixture.elements.resultList.innerHTML.includes('data-open-memory="linked-memory"'), "候选应提供关联展品入口");
  check(fixture.elements.resultList.innerHTML.includes("车票 &lt;旧&gt;"), "关联展品标题必须转义");
  check(!fixture.elements.resultList.innerHTML.includes("must-not-render") && !fixture.elements.resultList.innerHTML.includes("secret"), "不得显示服务端内部哈希或指纹字段");
  equal((fixture.elements.resultList.innerHTML.match(/class="media-lab-candidate"/g) || []).length, 1, "候选应排除当前照片并按资源 ID 去重");
  equal(fixture.elements.findButton.disabled, false, "请求完成后检索按钮应恢复可用");

  const destroysBeforeDemo = ocrDestroys;
  controller.setDemo(true);
  equal(ocrRenders.at(-1).demo, true, "切换为 Demo 后应重新渲染只读 OCR 上下文");
  check(ocrDestroys > destroysBeforeDemo, "重渲染 OCR 前应销毁旧实例");
  await fixture.elements.findButton.dispatch("click");
  equal(fetchCalls.length, 2, "Demo 模式仍应允许读取相似照片候选");

  fetchMode = "deferred";
  const staleSearch = fixture.elements.findButton.dispatch("click");
  const staleSignal = fetchCalls.at(-1).options.signal;
  fixture.elements.select.value = "1";
  await fixture.elements.select.dispatch("change");
  equal(staleSignal.aborted, true, "切换照片时应中止上一张照片的候选请求");
  equal(ocrRenders.at(-1).assetId, "selected-b", "切图后 OCR 应与当前照片同步");
  pending.resolve(response({
    ready: true,
    candidates: [{ assetId: "stale-candidate", media: { urls: { thumb: "/stale" } }, memories: [] }]
  }));
  await staleSearch;
  check(!fixture.elements.resultList.innerHTML.includes("stale-candidate"), "被中止请求即使迟到返回也不得污染新照片会话");
  check(fixture.elements.status.textContent.includes("只有点击"), "切图后应恢复未检索空态");

  fetchMode = "empty";
  await fixture.elements.findButton.dispatch("click");
  check(fixture.elements.resultList.innerHTML.includes("没有找到可能相似照片"), "零候选应显示诚实空态");
  check(fixture.elements.status.dataset.state === "empty", "零候选应设置可识别的空态状态");

  fetchMode = "not-ready";
  await fixture.elements.findButton.dispatch("click");
  check(fixture.elements.resultList.innerHTML.includes("还没有可用的本地检索线索"), "特征未就绪应与零候选明确区分");

  fetchMode = "error";
  await fixture.elements.findButton.dispatch("click");
  check(fixture.elements.status.textContent.includes("本地检索暂时不可用"), "接口错误应显示可读错误信息");
  check(fixture.elements.resultList.innerHTML.includes("没有任何照片被合并、修改或删除"), "错误态应再次确认零副作用");

  fetchMode = "deferred";
  const closingSearch = fixture.elements.findButton.dispatch("click");
  const closingSignal = fetchCalls.at(-1).options.signal;
  const destroysBeforeClose = ocrDestroys;
  controller.close();
  equal(closingSignal.aborted, true, "关闭详情时应中止正在进行的候选请求");
  check(ocrDestroys > destroysBeforeClose, "关闭详情时应销毁当前 OCR 实例");
  pending.resolve(response({ ready: true, candidates: [] }));
  await closingSearch;
  controller.destroy();

  check(source.includes("activeOperation === operation") && source.includes("activeSession === session"), "异步结果应同时隔离详情会话和操作序列");
  check(source.includes("activeRequest?.abort?.()") && source.includes("AbortController"), "候选请求应具有统一中止清理路径");
  check((source.match(/fetchImpl\(/g) || []).length === 1, "实验台只应有一个显式的只读网络入口");
  check(!/method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/i.test(source), "实验台不得提供合并、修改或删除网络操作");
  check(!/automatic[-_ ]?merge|autoMerge|deleteCandidate|mergeCandidate/i.test(source), "模块不得隐藏自动合并或候选删除逻辑");
  check(!/https?:\/\//i.test(source), "实验台不得包含第三方网络地址");
  check(!/gradient\s*\(/i.test(css) && !/url\s*\(/i.test(css), "样式不得引入渐变或远程资源");
  check(css.includes(":focus-visible") && css.includes("@media (max-width: 720px)"), "样式应覆盖键盘焦点和窄屏布局");
  check(css.includes("prefers-reduced-motion") && css.includes("[hidden]"), "样式应尊重减少动态效果偏好与原生隐藏语义");
  check(ocrHydrates >= 3, "打开、Demo 切换和切图都应重新 hydrate 对应 OCR");
  check(assertions >= 55, "影像实验台检查应覆盖至少 55 条渲染、隐私和异步边界断言");
  console.log(`Media lab checks passed: ${assertions} assertions.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
