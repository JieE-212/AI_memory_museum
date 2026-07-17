"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const html = read("public/index.html");
const css = read("public/capsules.css");
const privacyCss = read("public/share-privacy.css");
const app = read("public/assets/app.js");
const capsules = read("public/assets/capsules.js");
const cryptoSource = read("public/assets/capsule-crypto.js");
const privacySource = read("public/assets/share-privacy.js");

require(path.join(root, "public", "assets", "share-privacy.js"));
require(path.join(root, "public", "assets", "capsules.js"));
const capsuleModule = globalThis.TimeIsleCapsules;
const privacyModule = globalThis.TimeIsleSharePrivacy;
let assertions = 0;

ok(capsuleModule && typeof capsuleModule.createController === "function", "胶囊前端模块可独立加载");
for (const name of ["assembleOfflinePayload", "buildPreparedDownload", "normalizeCapsule", "normalizeMaterial", "normalizeSnapshot", "toCryptoShell"]) {
  ok(typeof capsuleModule[name] === "function", `胶囊前端暴露 ${name}`);
}
for (const name of ["createShareDraft", "projectSharePayload", "createController", "assembleLegacyPayload"]) {
  ok(typeof privacyModule[name] === "function", `分享隐私模块暴露 ${name}`);
}

equal((html.match(/class="nav-button/g) || []).length, 4, "V7 仍严格保持四项顶层导航");
ok(!html.includes('data-view="capsule"') && !html.includes('data-view="share"'), "胶囊与分享不新增顶层视图");
ok(html.indexOf('id="insightsTitle"') < html.indexOf('id="capsuleStudioButton"') && html.indexOf('id="capsuleStudioButton"') < html.indexOf('data-insight-tab="timeline"'), "胶囊入口位于馆藏回顾的渐进区域");
ok(html.includes('id="exhibitionStudioButton"') && html.includes('id="capsuleStudioButton"'), "策展与胶囊入口并列但职责分开");
ok(html.includes('id="capsuleDialog"') && html.includes('aria-labelledby="capsuleDialogTitle"'), "胶囊使用独立可访问对话框");
ok(html.includes('<details class="capsule-create-panel" id="capsuleCreatePanel">'), "创建与分享工作区默认折叠");
ok(!html.includes('<details class="capsule-create-panel" id="capsuleCreatePanel" open'), "创建工作区不会默认占满页面");
ok(html.includes('<details class="share-privacy-panel" id="sharePrivacyPanel" hidden>'), "分享隐私编辑台默认隐藏且渐进展开");
ok(!html.includes('<details class="share-privacy-panel" id="sharePrivacyPanel" hidden open'), "分享隐私编辑台不会默认展开");
for (const id of [
  "capsuleShelf", "capsuleReader", "capsuleForm", "capsuleExhibitionSelect",
  "capsuleCandidateList", "capsuleTitle", "capsuleShellMessage", "capsuleOpensOn",
  "capsuleTimezone", "capsuleSealButton", "capsulePrepareExportButton",
  "capsuleExportPanel", "capsulePassphrase", "capsulePassphraseConfirm",
  "capsuleDownloadButton", "capsuleCancelExportButton"
]) {
  equal((html.match(new RegExp(`id="${id}"`, "g")) || []).length, 1, `${id} 唯一存在`);
}
for (const id of [
  "sharePrivacyPanel", "sharePrivacyTitle", "sharePrivacyForm", "sharePrivacyStatus",
  "sharePublicTitle", "sharePublicNote", "shareFileTitle", "shareAudience", "sharePurpose",
  "shareExhibitTitle", "shareExhibitTheme", "shareExhibitOpening", "sharePrivacyContent",
  "shareReceiptPreview", "sharePrivacyAcknowledge", "sharePrivacyConfirm", "sharePrivacyCancel"
]) {
  equal((html.match(new RegExp(`id="${id}"`, "g")) || []).length, 1, `${id} 唯一存在`);
}

ok(html.includes('id="capsuleExportPanel"') && html.includes('hidden>'), "口令区在安全素材准备完成前隐藏");
ok(/id="capsulePassphrase"[^>]*autocomplete="new-password"[^>]*spellcheck="false"/u.test(html), "主口令输入禁止保存与拼写上传");
ok(/id="capsulePassphraseConfirm"[^>]*autocomplete="new-password"[^>]*spellcheck="false"/u.test(html), "确认口令输入禁止保存与拼写上传");
ok(html.includes('id="capsuleTimezone" type="text" readonly'), "封存时区自动展示且不由自由文本伪造");
ok(html.includes('id="capsuleOpensOn" type="date"'), "开启日使用原生日期输入");
ok(html.includes("开启日期只是一道仪式门槛") && html.includes("并不是不可破解的密码学时间锁"), "页面明确日期不是密码学时间锁");
for (const excluded of ["原图", "EXIF/GPS", "未确认文字稿", "Agent 整理日志", "内部 ID", "未勾选内容"]) {
  ok(html.includes(excluded), `隐私说明明确物理排除${excluded}`);
}
for (const layer of ["第一层 · 无需口令即可看到", "第二层 · 输入口令后才能看到", "第三层 · 最后核对"]) {
  ok(html.includes(layer), `分享编辑台呈现${layer}`);
}
ok(/id="sharePrivacyStatus"[^>]*role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"/u.test(html), "分享编辑状态通过原子 live region 播报");
ok(html.includes('id="sharePrivacyContent" tabindex="-1"') && html.includes('id="sharePrivacyAcknowledge" type="checkbox"'), "动态清单可聚焦且最终确认需要明确勾选");
ok(html.includes("放弃本次分享并清空草稿") && privacySource.includes("下载后无法撤回"), "页面明确取消清理与下载后不可撤回边界");

ok(
  html.indexOf('/assets/capsule-crypto.js?v=7.3.0') < html.indexOf('/assets/share-privacy.js?v=7.3.0') &&
  html.indexOf('/assets/share-privacy.js?v=7.3.0') < html.indexOf('/assets/capsules.js?v=7.3.0'),
  "资源按加密模块、隐私编辑台、胶囊控制器顺序加载"
);
ok(html.indexOf('/assets/capsules.js?v=7.3.0') < html.indexOf('/assets/app.js'), "胶囊控制器先于主应用加载");
equal((html.match(/\/share-privacy\.css\?v=7\.3\.0/g) || []).length, 1, "分享隐私样式只加载一次");
ok(app.includes("TimeIsleCapsules?.createController") && app.includes("capsulesController?.setDemo(demo)"), "主应用接入胶囊控制器与 Demo 状态");
ok(app.includes("capsulesController?.refresh()"), "馆藏变化会刷新胶囊工作区");

ok(css.includes("#capsuleDialog [hidden]") && css.includes("display: none !important;"), "组件样式不会覆盖原生 hidden");
ok(css.includes("height: 100dvh;") && css.includes("max-height: 100dvh;"), "手机对话框适配动态视口");
for (const token of ["safe-area-inset-top", "safe-area-inset-right", "safe-area-inset-bottom", "safe-area-inset-left"]) {
  ok(css.includes(token), `胶囊移动布局覆盖 ${token}`);
}
ok(css.includes("min-height: 44px;") && css.includes("min-width: 44px;"), "胶囊操作满足移动触控边界");
ok(css.includes("@media (max-width: 650px)") && css.includes("@media (max-width: 390px)") && css.includes("@media (max-width: 320px)"), "胶囊覆盖关键窄屏断点");
ok(!/gradient\s*\(/iu.test(css), "胶囊页面保持无渐变的克制视觉");
ok(privacyCss.includes(".share-privacy-panel[hidden]") && privacyCss.includes("display: none !important;"), "编辑台样式不会覆盖原生 hidden");
ok(privacyCss.includes("min-height: 44px") && privacyCss.includes("focus-visible"), "编辑台满足触控与键盘焦点边界");
ok(
  privacyCss.includes("@media (max-width: 650px)") && privacyCss.includes("@media (max-width: 390px)") && privacyCss.includes("@media (max-width: 320px)"),
  "编辑台独立覆盖 650、390 与 320 窄屏断点"
);
for (const token of ["safe-area-inset-right", "safe-area-inset-left", "prefers-reduced-motion"]) {
  ok(privacyCss.includes(token), `编辑台独立样式覆盖 ${token}`);
}
ok(privacyCss.includes("grid-template-columns: minmax(0, 1fr)") && privacyCss.includes("flex-direction: column"), "编辑台在手机上收敛为单列布局");
ok(!/gradient\s*\(/iu.test(privacyCss), "分享编辑台保持无渐变的克制视觉");
ok(!/share-privacy|share-review|share-receipt/iu.test(css), "分享编辑台样式完全留在独立文件而未回流主胶囊样式");

for (const endpoint of [
  '"/api/capsules"',
  '"/api/offline-exhibits/material"',
  '"/api/exhibitions?status=published&limit=200"',
  "/api/offline-exhibits/candidates?exhibitionId=",
  "/api/capsules/${encodeURIComponent(capsuleId)}/content"
]) {
  ok(capsules.includes(endpoint), `胶囊控制器覆盖接口 ${endpoint}`);
}
ok(capsules.includes('sourceType: "exhibition"') && capsules.includes("mediaAssetIds") && capsules.includes("transcriptAssetIds"), "离线素材请求只发送来源与明确选择项");
ok(!/JSON\.stringify\([^\n]{0,200}passphrase/iu.test(capsules), "口令不进入 JSON 请求体");
ok(!/localStorage|sessionStorage|indexedDB/iu.test(capsules), "胶囊控制器不持久化口令或明文素材");
ok(capsules.includes("Array.from(passphrase).length < MIN_PASSPHRASE") && !capsules.includes("passphrase.length < MIN_PASSPHRASE"), "分享口令按 Unicode 字符数执行前端长度合同");
equal((capsules.match(/beginShareReview\(hydrated, (?:elements\.prepareExportButton|trigger)\);/g) || []).length, 2, "展览与已开启胶囊共用同一隐私复核入口");
ok(
  capsules.indexOf("const hydrated = await hydrateMaterial(response?.material || response, run);") < capsules.indexOf("beginShareReview(hydrated, elements.prepareExportButton);") &&
  capsules.indexOf("const hydrated = await hydrateMaterial(openedMaterial.material, run);") < capsules.indexOf("beginShareReview(hydrated, trigger);"),
  "两条分享路径都在素材读取校验完成后才进入隐私编辑台"
);
equal((capsules.match(/showExportPanel\(\);/g) || []).length, 1, "只有隐私编辑台确认回调可以显示口令区");
ok(capsules.indexOf("function acceptReviewedShare") < capsules.indexOf("showExportPanel();"), "口令步骤只由已确认分享结果开启");
ok(capsules.includes("clearPassphrases();") && capsules.includes('elements.passphrase.value = ""') && capsules.includes('elements.passphraseConfirm.value = ""'), "成功、失败、取消与关闭都会清空口令输入");
ok(capsules.includes("MAX_IMAGES = 24") && capsules.includes("MAX_PLAINTEXT_BYTES = 32 * 1024 * 1024"), "浏览器限制图片数量与明文素材体积");
ok(capsules.includes('item.mimeType !== "image/webp"') && capsules.includes("safeDisplayUrl(item.contentUrl)"), "浏览器只读取安全 display WebP 地址");
ok(capsules.includes('subtle.digest("SHA-256"') && capsules.includes("hash !== item.sha256"), "浏览器在加密前复核展示图 SHA-256");
ok(privacySource.includes('FORMAT = "time-isle.offline-exhibit"') && privacySource.includes("confirmedQuotes") && privacySource.includes("confirmedTranscripts"), "独立隐私模块投影已确认引用与文字稿");
ok(capsules.includes("toCryptoShell") && capsules.includes("IMMEDIATE_OPEN_SENTINEL") && !capsules.includes("zonedMidnightIso"), "V2 公开外壳固定立即开启而不回退来源日期");
ok(
  privacySource.includes("draft.acknowledged = false;") && privacySource.includes("elements.acknowledge.checked = false;") && privacySource.includes("onDirty();"),
  "编辑确认后的任意字段会撤销最终确认并通知胶囊控制器"
);
ok(
  capsules.includes("sharePrivacy.clear();") && capsules.includes("preparedMaterial = null;") && capsules.includes("clearPassphrases();") &&
  capsules.includes("clearPreparedExport(true);") && capsules.includes("clearPreparedExport();\n        clearReader();"),
  "取消、关闭、返回书架与下载后都会清理草稿、明文素材及口令"
);
ok(
  capsules.includes("const downloadUrls = new Set();") && capsules.includes("downloadUrls.add(url);") &&
  capsules.includes("downloadUrls.delete(url)") && capsules.includes("revokeObjectURL(url)"),
  "下载 Blob URL 由会话集合跟踪并在延迟或取消时回收"
);
ok(!/\bfetch\b|XMLHttpRequest|WebSocket|sendBeacon|localStorage|sessionStorage|indexedDB/iu.test(privacySource), "隐私编辑台没有联网或本地持久化能力");
ok(privacySource.includes("escapeHtml(entry.value)") && privacySource.includes("escapeHtml(media.dataBase64)"), "编辑台动态文字与媒体属性统一转义后渲染");
ok(
  capsules.includes('const canOpen = capsule.available && !capsule.needsReview;') &&
  capsules.includes('capsule.needsReview ? "需要复核"') &&
  capsules.includes('shell?.needsReview'),
  "需要复核的胶囊明确标记且不提供打开入口"
);
ok(
  capsules.includes("event.preventDefault(); closeDialog();") &&
  capsules.includes("signal: controller.signal") &&
  capsules.includes("assertCurrentMaterialRead(run, token)") &&
  capsules.includes("cancelActiveWork();"),
  "胶囊对话框可在忙碌时安全关闭并取消慢素材请求"
);
ok(
  capsules.includes("readerReturnTarget = trigger?.isConnected ? trigger : null;") &&
  capsules.includes("const returnTarget = readerReturnTarget;") &&
  capsules.includes("returnTarget?.isConnected"),
  "从胶囊阅读返回书架时恢复原打开按钮焦点"
);
ok(cryptoSource.includes("PBKDF2_ITERATIONS = 310000") && cryptoSource.includes("KEY_BITS = 256") && cryptoSource.includes("TAG_BITS = 128"), "浏览器加密参数固定为 PBKDF2 与 AES-256-GCM");
ok(cryptoSource.includes("createOfflineHtml") && cryptoSource.includes("connect-src 'none'"), "浏览器直接生成断网单文件且 CSP 禁止联网");
ok(!/fetch\s*\(|XMLHttpRequest|<script\s+src=|<link\s+rel=["']stylesheet/iu.test(extractOfflineTemplate(cryptoSource)), "离线模板不依赖网络或外部资源");

const shellTitle = `${"题".repeat(119)}😀`;
const shellNote = `${"注".repeat(239)}🫶`;
const safeShell = capsuleModule.toCryptoShell({ title: `${shellTitle}尾`, note: `${shellNote}尾` });
equal(safeShell.title, shellTitle, "公开外壳标题按 Unicode 码点截断，不会拆开 emoji 代理对");
equal(safeShell.note, shellNote, "公开外壳说明按 Unicode 码点截断，不会拆开 emoji 代理对");

const shareFilename = `${"记".repeat(79)}📷`;
const projectedShare = privacyModule.projectSharePayload({
  publicTitle: "一份加密分享",
  publicNote: "仅向约定对象分享",
  fileTitle: `${shareFilename}尾.html`,
  audience: "约定的朋友",
  purpose: "共同回看",
  title: "一次回忆",
  theme: "陪伴",
  opening: "",
  sections: [{
    selected: true,
    title: "第一章",
    summary: "",
    items: [{
      selected: true,
      title: "一件展品",
      excerpt: "",
      curatorNote: "",
      quotes: [{ selected: true, value: "这是一条已确认引用" }],
      transcripts: [],
      media: []
    }]
  }]
});
equal(projectedShare.fileTitle, shareFilename, "分享编辑台文件名按 Unicode 码点截断，不会拆开 emoji 代理对");

const normalized = capsuleModule.normalizeSnapshot({
  title: "只留下愿意分享的展览",
  theme: "夏天",
  opening: "一封开场信",
  rawContent: "RAW-CANARY",
  memoryId: "memory-secret",
  gps: "31.2,121.5",
  sections: [{
    id: "section-secret",
    title: "第一章",
    summary: "安全摘要",
    items: [{
      memoryId: "memory-secret",
      assetId: "asset-secret",
      title: "操场",
      excerpt: "安全摘录",
      curatorNote: "安全说明",
      citations: [{ quote: "确认原文", evidenceValid: true }],
      transcripts: [{ status: "confirmed", text: "确认文字" }, { status: "draft", text: "DRAFT-CANARY" }]
    }]
  }]
});
const normalizedText = JSON.stringify(normalized);
ok(normalized.format === "time-isle.offline-exhibit" && normalized.version === 1, "浏览器规范化为离线展览固定格式");
ok(normalized.sections[0].key === "section-1" && normalized.sections[0].items[0].key === "item-1", "浏览器只生成匿名顺序键");
ok(normalized.sections[0].items[0].confirmedQuotes[0] === "确认原文", "已确认引用进入匿名载荷");
ok(normalized.sections[0].items[0].confirmedTranscripts.includes("确认文字"), "已确认文字稿进入匿名载荷");
for (const canary of ["RAW-CANARY", "memory-secret", "asset-secret", "31.2,121.5", "DRAFT-CANARY", "section-secret"]) {
  ok(!normalizedText.includes(canary), `规范化载荷物理排除 ${canary}`);
}

const reviewCapsule = capsuleModule.normalizeCapsule({
  id: "capsule-review",
  available: true,
  needsReview: true,
  ceremonialGate: true
});
ok(reviewCapsule.available && reviewCapsule.needsReview, "胶囊前端同时保留到期与需复核两个独立状态");

checkPreparedExportRace().then(() => {
  console.log(`Capsule UI checks passed: ${assertions} assertions.`);
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function checkPreparedExportRace() {
  const preparedA = { fileTitle: "share-A", payload: { title: "A" } };
  const preparedB = { fileTitle: "share-B", payload: { title: "B" } };
  let current = preparedA;
  let finishEncryption;
  let htmlBuilds = 0;
  const encryptionGate = new Promise((resolve) => { finishEncryption = resolve; });
  const pending = capsuleModule.buildPreparedDownload({
    prepared: preparedA,
    passphrase: "long-enough-passphrase",
    encrypt: async (prepared) => {
      await encryptionGate;
      return { prepared };
    },
    createHtml: () => { htmlBuilds += 1; return "<html>A</html>"; },
    isCurrent: (prepared) => current === prepared
  });
  current = preparedB;
  finishEncryption();
  assertions += 1;
  await assert.rejects(pending, (error) => error?.name === "StaleCapsuleRequest", "加密期间重新确认 B 会使旧 A 下载任务失效");
  equal(htmlBuilds, 0, "失效的 A 不会继续生成离线 HTML");

  current = preparedA;
  const completed = await capsuleModule.buildPreparedDownload({
    prepared: preparedA,
    passphrase: "long-enough-passphrase",
    encrypt: async (prepared) => ({ prepared }),
    createHtml: () => "<html>A</html>",
    isCurrent: (prepared) => current === prepared
  });
  equal(completed.filename, "share-A.html", "成功下载始终使用同一份已确认材料捕获的文件名");

  const emojiFilename = `${"a".repeat(79)}😀`;
  const emojiDownload = await capsuleModule.buildPreparedDownload({
    prepared: { fileTitle: `${emojiFilename}尾`, payload: { title: "emoji" } },
    passphrase: "long-enough-passphrase",
    encrypt: async (prepared) => ({ prepared }),
    createHtml: () => "<html>emoji</html>",
    isCurrent: () => true
  });
  equal(emojiDownload.filename, `${emojiFilename}.html`, "最终离线文件名按 Unicode 码点截断，不会拆开 emoji 代理对");
}

function extractOfflineTemplate(source) {
  const start = source.indexOf("<!doctype html>");
  const end = source.lastIndexOf("</html>");
  return start >= 0 && end > start ? source.slice(start, end + 7) : "";
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function ok(value, message) {
  assertions += 1;
  assert.ok(value, message);
}

function equal(actual, expected, message) {
  assertions += 1;
  assert.equal(actual, expected, message);
}
