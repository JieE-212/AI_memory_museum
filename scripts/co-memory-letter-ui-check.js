"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const modulePath = path.join(root, "public", "assets", "co-memory-letter.js");
const cryptoPath = path.join(root, "public", "assets", "co-memory-crypto.js");
const cssPath = path.join(root, "public", "co-memory-letter.css");
const source = fs.readFileSync(modulePath, "utf8");
const cryptoSource = fs.readFileSync(cryptoPath, "utf8");
const css = fs.readFileSync(cssPath, "utf8");
const letters = require(modulePath);
const cryptoApi = require(cryptoPath);
const encoder = new TextEncoder();
let assertions = 0;

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function run() {
  ok(letters && typeof letters.createController === "function", "共忆信笺控制器可独立加载");
  for (const method of [
    "renderPanel",
    "createRequestPayload",
    "createResponsePayload",
    "createReplyPackage",
    "parseReplyPackage",
    "parseReplyPackageBytes",
    "openReplyPackage",
    "createConfirmationContract",
    "createOfflineInvitationHtml",
    "requireTrustedCryptoSource",
    "extractMemoryAnchor"
  ]) {
    equal(typeof letters[method], "function", `前端模块导出 ${method}`);
  }

  const panel = letters.renderPanel({ id: "memory_safe-1", title: "海边 <script>alert(1)</script>" });
  ok(panel.includes('<details class="co-memory-letter" data-co-memory-panel="memory_safe-1">'), "单件展品面板默认使用 details 折叠");
  ok(!/<details class="co-memory-letter"[^>]*\sopen(?:\s|>)/u.test(panel), "共忆信笺不会默认展开");
  ok(panel.includes("海边 &lt;script&gt;alert(1)&lt;/script&gt;"), "展品标题进入静态模板前经过 HTML 转义");
  ok(!panel.includes("data-view="), "共忆信笺不创建第五项主导航");
  ok(panel.includes("不会自动带出整件展品、照片、声音、人物、日期或关系"), "页面明确最小披露边界");
  ok(panel.includes("加密但未签名") && panel.includes("不能证明回复者身份"), "页面不把共享口令误称为身份认证");
  ok(panel.includes("解锁并只预览") && source.includes("确认保存为未核验来源"), "导入与最终人工保存是两个独立动作");
  equal(letters.renderPanel({ id: "../unsafe", title: "unsafe" }), "", "不安全展品 ID 不进入 DOM");

  const requestA = letters.createRequestPayload({
    memoryId: "memory_safe-1",
    letterId: cryptoApi.createLetterId(),
    question: "你记得离开前，我们还聊了什么吗？",
    contextTitle: "",
    contextNote: "只需回答亲自记得的部分。",
    evidence: "那天傍晚，我们在海边坐到路灯亮起。"
  }, cryptoApi);
  equal(requestA.context.title, "", "未明确勾选时不带出展品标题");
  equal(letters.extractMemoryAnchor(requestA), "memory_safe-1", "加密请求带有不含正文的单件展品归位码");
  ok(requestA.context.note.endsWith("只需回答亲自记得的部分。"), "用户补充说明保留在归位码之后");
  equal(requestA.context.evidence.length, 1, "首版严格围绕一个明确选择的文字片段");
  equal(requestA.context.evidence[0].kind, "quote", "邀请内容标记为人工选择的引文而非自动推断");
  equal(requestA.boundary, cryptoApi.REQUEST_BOUNDARY, "请求保留协议边界声明");
  throwsCode(
    () => letters.createRequestPayload({ memoryId: "memory_safe-1", question: "问题", evidence: "" }, cryptoApi),
    "CO_MEMORY_LETTER_TEXT_INVALID",
    "没有明确披露片段时不能生成邀请"
  );

  const passphrase = "correct horse battery staple";
  const requestEnvelopeA = await cryptoApi.createRequestEnvelope(requestA, passphrase);
  const openedRequestA = await cryptoApi.openRequestEnvelope(requestEnvelopeA, passphrase);
  const responseA = letters.createResponsePayload(openedRequestA, {
    identityLabel: "旧同桌（自述）",
    answer: "我记得我们还说到以后要再去看一次日落。"
  }, cryptoApi);
  equal(responseA.identity.assurance, "self-asserted-unverified", "朋友称呼固定为自述且未核验");
  equal(responseA.identity.verified, false, "前端不能声明回复者身份已验证");
  equal(responseA.requestSha256, openedRequestA.requestSha256, "回复负载绑定完整邀请摘要");
  const responseEnvelopeA = await cryptoApi.createResponseEnvelope(responseA, passphrase, openedRequestA);
  const replyPackageA = letters.createReplyPackage(requestEnvelopeA, responseEnvelopeA, cryptoApi);
  deepEqual(Object.keys(replyPackageA), ["format", "version", "contentType", "request", "response"], "回复包只包含固定协议字段");
  equal(replyPackageA.format, letters.REPLY_PACKAGE_FORMAT, "回复包使用独立格式标识");
  equal(replyPackageA.request.binding.requestSha256, replyPackageA.response.binding.requestSha256, "回复包入口先校验邀请与回信摘要一致");

  const bytes = encoder.encode(JSON.stringify(replyPackageA));
  const parsed = letters.parseReplyPackageBytes(bytes, cryptoApi);
  equal(parsed.response.binding.kind, "response", "UTF-8 JSON 回复包可被严格解析");
  const openedPackage = await letters.openReplyPackage(parsed, passphrase, cryptoApi);
  equal(openedPackage.request.payload.question, requestA.question, "导入先验真并解锁原问题");
  equal(openedPackage.response.payload.answer, responseA.answer, "导入后只返回已验真的回复预览");
  equal(openedPackage.requestSha256, openedRequestA.requestSha256, "导入结果保留请求绑定摘要");

  await rejectsCode(
    () => letters.openReplyPackage(replyPackageA, "wrong passphrase 123", cryptoApi),
    "CO_MEMORY_DECRYPT_FAILED",
    "错误口令拒绝且不返回明文"
  );

  const requestB = letters.createRequestPayload({
    memoryId: "memory_other-2",
    letterId: cryptoApi.createLetterId(),
    question: "另一封邀请的问题是什么？",
    evidence: "这是另一件展品明确选择的片段。"
  }, cryptoApi);
  const requestEnvelopeB = await cryptoApi.createRequestEnvelope(requestB, passphrase);
  throwsCode(
    () => letters.createReplyPackage(requestEnvelopeB, responseEnvelopeA, cryptoApi),
    "CO_MEMORY_REPLY_PACKAGE_BINDING_INVALID",
    "来自另一封邀请的回复不能拼入当前回复包"
  );
  throwsCode(
    () => letters.parseReplyPackage({ ...replyPackageA, request: requestEnvelopeB }, cryptoApi),
    "CO_MEMORY_REPLY_PACKAGE_BINDING_INVALID",
    "手工错配邀请与回复也会在解析时拒绝"
  );

  const tampered = structuredClone(replyPackageA);
  tampered.response.ciphertext = flipBase64UrlCharacter(tampered.response.ciphertext);
  await rejectsCode(
    () => letters.openReplyPackage(tampered, passphrase, cryptoApi),
    "CO_MEMORY_DECRYPT_FAILED",
    "AES-GCM 拒绝被篡改的回复密文"
  );
  throwsCode(
    () => letters.parseReplyPackage({ ...replyPackageA, extra: true }, cryptoApi),
    "CO_MEMORY_REPLY_PACKAGE_INVALID",
    "回复包拒绝未声明的额外字段"
  );
  throwsCode(
    () => letters.parseReplyPackageBytes(Uint8Array.from([0xc3, 0x28]), cryptoApi),
    "CO_MEMORY_REPLY_PACKAGE_UTF8",
    "回复包使用 fatal UTF-8 解码"
  );
  throwsCode(
    () => letters.parseReplyPackageBytes(new Uint8Array(letters.MAX_REPLY_PACKAGE_BYTES + 1), cryptoApi),
    "CO_MEMORY_REPLY_PACKAGE_SIZE",
    "过大的回复包在 JSON 解析前拒绝"
  );

  const confirmation = letters.createConfirmationContract("memory_safe-1", openedPackage);
  equal(confirmation.confirm, true, "交给保存接口的合同带有显式确认位");
  equal(confirmation.memoryId, "memory_safe-1", "人工确认明确指向当前展品");
  equal(confirmation.source.kind, "co_memory_response", "共忆回信使用独立 provenance 来源类型");
  equal(confirmation.source.relationKind, "supplements", "回信只补充原记忆而不覆盖原文");
  equal(confirmation.source.identityAssurance, "self-asserted-unverified", "保存合同保留未核验身份保证级别");
  equal(confirmation.source.identityVerified, false, "保存合同禁止身份已验证声明");
  equal(confirmation.source.encrypted, true, "保存合同记录传输文件经过加密");
  equal(confirmation.source.signed, false, "保存合同明确文件没有签名");
  throwsCode(
    () => letters.createConfirmationContract("memory_other-2", openedPackage),
    "CO_MEMORY_CONFIRMATION_INVALID",
    "回信不能被人工确认到归位码之外的展品"
  );

  const html = letters.createOfflineInvitationHtml(requestEnvelopeA, cryptoSource, cryptoApi);
  ok(html.startsWith("<!doctype html>"), "邀请是可独立打开的单 HTML 文件");
  ok(html.includes("TimeIsleCoMemoryCrypto") && html.includes("createResponseEnvelope"), "邀请内嵌同一套加密协议核心");
  ok(html.includes(requestEnvelopeA.ciphertext), "邀请内嵌加密请求信封");
  ok(!html.includes(requestA.question) && !html.includes(requestA.context.evidence[0].text), "单 HTML 外壳不泄露请求明文");
  ok(!html.includes("memory_safe-1"), "本地归位码也只存在于加密请求中");
  ok(html.includes("PBKDF2") && html.includes("AES-GCM") && html.includes("310000"), "离线邀请沿用 PBKDF2-SHA256 与 AES-GCM 参数");
  ok(html.includes("connect-src 'none'") && html.includes("default-src 'none'"), "离线 HTML 用 CSP 禁止联网和外部资源");
  ok(!/<script[^>]+\ssrc=/iu.test(html) && !/<link[^>]+\shref=/iu.test(html), "离线 HTML 没有外链脚本或样式");
  ok(!/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\b/u.test(html), "离线邀请运行时代码没有网络 API");
  ok(!/\b(?:localStorage|sessionStorage|indexedDB)\b/u.test(html), "离线邀请不建立浏览器持久化");
  ok(html.includes("self-asserted-unverified") || html.includes("cryptoApi.IDENTITY_ASSURANCE"), "离线回复不能升级身份保证级别");
  ok(html.includes(letters.REPLY_PACKAGE_FORMAT), "朋友导出的 JSON 使用可识别回复包格式");
  ok(html.includes("request: invitation") && html.includes("response"), "离线回复同时携带原加密邀请以供错配校验");
  ok(html.includes("没有数字签名") && html.includes("不能证明你的身份"), "朋友端清楚说明加密不等于签名认证");
  ok(html.includes("不会联网") && html.includes("不会自动发送"), "朋友端清楚说明离线与非自动分享边界");
  ok(html.includes("@media(max-width:650px)") && html.includes("@media(max-width:390px)") && html.includes("@media(max-width:320px)"), "离线邀请覆盖 650、390、320 三档窄屏");
  ok(html.includes("env(safe-area-inset-right)") && html.includes("min-height:48px"), "离线邀请尊重安全区并提供至少 44px 触控目标");
  ok(html.includes('id="question" tabindex="-1"') && html.includes("h2:focus-visible") && html.includes('byId("question").focus({ preventScroll: true })'), "解锁后先把可见焦点与读屏上下文交给问题标题");
  ok(html.includes("h1,h2{overflow-wrap:anywhere}") && html.includes(".question-heading>div,form"), "离线邀请中的合法长问题不会撑宽窄屏页面");
  ok(!/gradient\s*\(/iu.test(html), "离线邀请保持无渐变视觉");

  equal(letters.requireTrustedCryptoSource(cryptoSource), cryptoSource, "当前加密核心满足离线嵌入约束");
  throwsCode(
    () => letters.requireTrustedCryptoSource(`${cryptoSource}\nfetch('/leak')`),
    "CO_MEMORY_CRYPTO_SOURCE_INVALID",
    "带网络调用的脚本不能嵌入离线邀请"
  );
  throwsCode(
    () => letters.requireTrustedCryptoSource("console.log('not crypto')"),
    "CO_MEMORY_CRYPTO_SOURCE_INVALID",
    "不完整脚本不能伪装为信笺加密核心"
  );

  ok(source.includes('method: "GET"') && source.includes('fetchImpl("/assets/co-memory-crypto.js"'), "主应用只按需读取同源静态加密脚本");
  ok(!source.includes('method: "POST"') && !source.includes('method: "PUT"') && !source.includes('method: "DELETE"'), "独立模块不自行发起任何写请求");
  ok(!source.includes("/api/"), "保存必须通过宿主显式提供的 confirmResponse 回调");
  ok(source.includes("data-co-memory-confirm-check") && source.includes("confirmResponse(") && source.includes("createConfirmationContract(active.memory.id"), "只有勾选并点击确认才会调用保存接线");
  ok(source.includes("extractMemoryAnchor(opened.request.payload)") && source.includes("CO_MEMORY_MEMORY_BINDING_INVALID"), "回信归位前必须匹配当前单件展品的加密归位码");
  ok(source.includes("file.size > MAX_REPLY_PACKAGE_BYTES") && source.includes("file.arrayBuffer()"), "回信文件在分配内存前执行大小预检");
  ok(source.includes('type="file" accept=".json,application/json,application/vnd.time-isle.co-memory-reply-package+json" tabindex="-1"'), "可见选择按钮承接键盘焦点，隐藏回信 input 不制造不可见 Tab 停靠点");
  ok(source.includes("isCurrent(active)") && source.includes("active.fileReadNo !== readNo"), "关闭、切换或连续选文件时旧异步结果不会回写");
  ok(source.includes("{ signal: active.controller.signal }"), "保存接线收到会话取消信号");
  const executableSource = source.replace(/^.*FORBIDDEN_OFFLINE_SOURCE.*$/mu, "");
  ok(!/\b(?:localStorage|sessionStorage|indexedDB)\b/u.test(executableSource), "宿主模块也不持久化请求、口令或回复");

  ok(css.includes("min-height: 44px") && css.includes("min-height: 48px"), "主应用信笺控件满足至少 44px 触控边界");
  ok(css.includes("focus-visible"), "键盘焦点有清晰反馈");
  ok(css.includes("safe-area-inset-right") && css.includes("safe-area-inset-left"), "移动布局尊重左右安全区");
  ok(css.includes("@media (max-width: 650px)") && css.includes("@media (max-width: 390px)") && css.includes("@media (max-width: 320px)"), "主应用样式覆盖 650、390、320 三档窄屏");
  ok(css.includes("grid-template-columns: 1fr") && css.includes("flex-direction: column"), "手机端口令、文件和操作区收敛为单列");
  ok(css.includes("prefers-reduced-motion"), "信笺尊重减少动态效果偏好");
  ok(!/gradient\s*\(/iu.test(css), "信笺保持无渐变的克制视觉");

  console.log(`Co-memory letter UI checks passed: ${assertions} assertions.`);
}

function flipBase64UrlCharacter(value) {
  const index = Math.floor(value.length / 2);
  const replacement = value[index] === "A" ? "B" : "A";
  return `${value.slice(0, index)}${replacement}${value.slice(index + 1)}`;
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

async function rejectsCode(callback, code, message) {
  assertions += 1;
  await assert.rejects(callback, (error) => error?.code === code, message);
}
