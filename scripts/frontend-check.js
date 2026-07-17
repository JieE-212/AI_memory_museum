const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const html = read("public/index.html");
const css = read("public/styles.css");
const pwaCss = read("public/pwa.css");
const archaeologyCss = read("public/archaeology.css");
const mediaCss = read("public/media.css");
const voiceCss = read("public/voice.css");
const capsuleCss = read("public/capsules.css");
const sharePrivacyCss = read("public/share-privacy.css");
const mediaEvidenceCss = read("public/media-evidence.css");
const mediaCompareCss = read("public/media-compare.css");
const mediaOcrCss = read("public/media-ocr.css");
const mediaLabCss = read("public/media-lab.css");
const exhibitionsCss = read("public/exhibitions.css");
const revisitsCss = read("public/revisits.css");
const revisionsCss = read("public/revisions.css");
const cluesCss = read("public/clues.css");
const collectionHealthCss = read("public/collection-health.css");
const app = read("public/assets/app.js");
const pwaApp = read("public/assets/pwa.js");
const mediaApp = read("public/assets/media.js");
const voiceApp = read("public/assets/voice.js");
const capsuleCryptoApp = read("public/assets/capsule-crypto.js");
const capsuleApp = read("public/assets/capsules.js");
const sharePrivacyApp = read("public/assets/share-privacy.js");
const mediaEvidenceApp = read("public/assets/media-evidence.js");
const mediaCompareApp = read("public/assets/media-compare.js");
const mediaOcrApp = read("public/assets/media-ocr.js");
const mediaLabApp = read("public/assets/media-lab.js");
const portabilityApp = read("public/assets/portability.js");
const exhibitionsApp = read("public/assets/exhibitions.js");
const revisitsApp = read("public/assets/revisits.js");
const revisionsApp = read("public/assets/revisions.js");
const cluesApp = read("public/assets/clues.js");
const collectionHealthApp = read("public/assets/collection-health.js");
const server = read("server.js");
const archaeology = read("lib/archaeology.js");
const archaeologyBackup = read("lib/archaeology-backup.js");
const pkg = JSON.parse(read("package.json"));
const vercel = JSON.parse(read("vercel.json"));
require(path.join(root, "public/assets/media-evidence.js"));
require(path.join(root, "public/assets/voice.js"));
const mediaEvidenceMarkup = globalThis.TimeIsleMediaEvidence.renderPanel({
  id: "memory-check",
  media: [{ assetId: "asset-check", position: 0, width: 1200, height: 800, urls: { display: "/api/media/asset-check/display" } }]
});
const emptyMediaEvidenceMarkup = globalThis.TimeIsleMediaEvidence.renderPanel({ id: "memory-empty", media: [] });
const voiceCardMarkup = globalThis.TimeIsleVoice.renderCardSummary({ voiceSummary: { count: 2 } });
const voiceDetailMarkup = globalThis.TimeIsleVoice.renderDetailVoices({ voices: [
  { assetId: "voice-confirmed", position: 0, label: "窗边的雨", asset: { id: "voice-confirmed", durationMs: 3100, contentUrl: "/api/voice/assets/voice-confirmed/content" }, transcript: { status: "confirmed", text: "这是人工确认的文字。" } },
  { assetId: "voice-draft", position: 1, asset: { id: "voice-draft", contentUrl: "/api/voice/assets/voice-draft/content" }, transcript: { status: "draft", text: "普通详情不能出现的草稿。" } }
] });
const queriedIds = [app, pwaApp, mediaApp, voiceApp, capsuleApp, sharePrivacyApp, mediaEvidenceApp, portabilityApp, exhibitionsApp, revisitsApp, cluesApp].flatMap((source) => [
  ...source.matchAll(/(?:querySelector\("#|getElementById\(")([a-zA-Z0-9_-]+)"\)/g)
].map((match) => match[1])).concat(
  [...sharePrivacyApp.matchAll(/^\s+\w+: "(share[a-zA-Z0-9_-]+)",?$/gm)].map((match) => match[1])
);
const htmlIds = [...html.matchAll(/\sid="([a-zA-Z0-9_-]+)"/g)].map((match) => match[1]);
const tabletCssStart = css.indexOf("@media (max-width: 980px)");
const mobileCssStart = css.indexOf("@media (max-width: 650px)");
const compactCssStart = css.indexOf("@media (max-width: 360px)");
const reducedMotionCssStart = css.indexOf("@media (prefers-reduced-motion: reduce)");
const desktopCss = css.slice(0, tabletCssStart);
const tabletCss = css.slice(tabletCssStart, mobileCssStart);
const mobileCss = css.slice(mobileCssStart, compactCssStart);
const compactMobileCss = css.slice(compactCssStart, reducedMotionCssStart);
const desktopHeaderRule = ruleDeclarations(desktopCss, ".site-header");
const desktopNavRule = ruleDeclarations(desktopCss, ".main-nav");
const tabletNavRule = ruleDeclarations(tabletCss, ".main-nav");
const mobileRootRule = ruleDeclarations(mobileCss, ":root");
const mobileHtmlRule = ruleDeclarations(mobileCss, "html");
const mobileBodyRule = ruleDeclarations(mobileCss, "body");
const mobileHeaderRule = ruleDeclarations(mobileCss, ".site-header");
const mobileNavRule = ruleDeclarations(mobileCss, ".main-nav");
const mobileButtonRule = ruleDeclarations(mobileCss, ".nav-button");
const mobileButtonFocusRule = ruleDeclarations(mobileCss, ".nav-button:focus-visible");
const mobileFullLabelRule = ruleDeclarations(mobileCss, ".nav-label-full");
const mobileCompactLabelRule = ruleDeclarations(mobileCss, ".nav-label-compact");
const mobileToastRule = ruleDeclarations(mobileCss, ".toast");
const compactNavRule = ruleDeclarations(compactMobileCss, ".main-nav");
const compactButtonRule = ruleDeclarations(compactMobileCss, ".nav-button");

const checks = [
  ["V7.1 PWA stays inside the four-view information architecture", (html.match(/class="nav-button/g) || []).length === 4 && html.includes('id="pwaInstallPanel" hidden') && html.indexOf('id="pwaInstallPanel"') > html.indexOf('data-view-panel="data"') && !html.includes('data-view="pwa"')],
  ["PWA resources load in manifest-style-controller-app order", html.includes('/manifest.webmanifest?v=7.3.0') && html.indexOf('/styles.css?v=7.2.0') < html.indexOf('/pwa.css?v=7.3.0') && html.indexOf('/assets/pwa.js?v=7.3.0') < html.indexOf('/assets/app.js?v=7.3.0')],
  ["PWA install uses progressive disclosure without private persistence", pwaApp.includes('beforeinstallprompt') && pwaApp.includes('appinstalled') && pwaApp.includes('updateViaCache: "none"') && !/localStorage|sessionStorage|indexedDB|\bcaches\b/iu.test(pwaApp) && pwaCss.includes('.pwa-install-panel [hidden]')],
  ["V7.2 记忆年轮保持四导航并默认按需展开", (html.match(/class="nav-button/g) || []).length === 4 && html.includes('id="revisionTimelineDetails"') && !html.includes('<details class="revision-timeline-card" id="revisionTimelineDetails" open') && !html.includes('data-view="revisions"') && html.indexOf('/assets/revisions.js?v=7.2.0') < html.indexOf('/assets/app.js?v=7.3.0') && app.includes("TimeIsleRevisions?.createController")],
  ["记忆年轮提供并发保护、二次确认与不覆盖恢复", revisionsApp.includes('"If-Match"') && revisionsApp.includes("data-revision-confirm") && revisionsApp.includes("当前版本不会被删除") && revisionsApp.includes("restoredFromRevisionId") && revisionsApp.includes("error.status === 412") && !/localStorage|sessionStorage|indexedDB/iu.test(revisionsApp)],
  ["记忆年轮移动端克制且不使用渐变", revisionsCss.includes("@media (max-width: 650px)") && revisionsCss.includes("@media (max-width: 360px)") && revisionsCss.includes("min-height: 44px") && !/gradient\s*\(/iu.test(revisionsCss)],
  ["馆藏体检位于归档入口之前且保持只读渐进披露", html.includes('id="collectionHealthDetails"') && html.indexOf('id="collectionHealthDetails"') < html.indexOf('id="exportButton"') && !html.includes('<details class="collection-health-panel" id="collectionHealthDetails" open') && collectionHealthApp.includes("/api/collection-health/scans") && collectionHealthApp.includes("/api/archive/inspect") && collectionHealthApp.includes("不会自动删除或改写") && !/localStorage|sessionStorage|indexedDB/iu.test(collectionHealthApp)],
  ["馆藏体检明确 Demo 与移动端安全边界", collectionHealthApp.includes("共享临时示例不提供本机馆藏体检") && collectionHealthApp.includes("不会恢复到当前馆藏") && collectionHealthCss.includes("@media (max-width: 650px)") && collectionHealthCss.includes("@media (max-width: 360px)") && !/gradient\s*\(/iu.test(collectionHealthCss) && app.includes("TimeIsleCollectionHealth?.createController")],
  ["V7 capsule stays inside the four-view information architecture", (html.match(/class="nav-button/g) || []).length === 4 && html.includes('id="capsuleStudioButton"') && !html.includes('data-view="capsule"') && html.indexOf('id="capsuleStudioButton"') > html.indexOf('id="insightsTitle"')],
  ["Capsule resources load in crypto-privacy-controller-app order", (html.match(/\/capsules\.css/g) || []).length === 1 && (html.match(/\/share-privacy\.css/g) || []).length === 1 && (html.match(/\/assets\/capsule-crypto\.js/g) || []).length === 1 && (html.match(/\/assets\/share-privacy\.js/g) || []).length === 1 && (html.match(/\/assets\/capsules\.js/g) || []).length === 1 && html.indexOf('/assets/capsule-crypto.js') < html.indexOf('/assets/share-privacy.js') && html.indexOf('/assets/share-privacy.js') < html.indexOf('/assets/capsules.js') && html.indexOf('/assets/capsules.js') < html.indexOf('/assets/app.js')],
  ["Capsule creation, privacy review and passphrase use progressive disclosure", html.includes('<details class="capsule-create-panel" id="capsuleCreatePanel">') && html.includes('<details class="share-privacy-panel" id="sharePrivacyPanel" hidden>') && html.includes('id="capsuleExportPanel"') && !html.includes('<details class="capsule-create-panel" id="capsuleCreatePanel" open') && (capsuleApp.match(/beginShareReview\(hydrated, (?:elements\.prepareExportButton|trigger)\);/g) || []).length === 2 && (capsuleApp.match(/showExportPanel\(\);/g) || []).length === 1],
  ["Capsule passphrases stay browser-only and are cleared", !/localStorage|sessionStorage|indexedDB/iu.test(capsuleApp) && !/JSON\.stringify\([^\n]{0,200}passphrase/iu.test(capsuleApp) && capsuleApp.includes('elements.passphrase.value = ""') && capsuleApp.includes('elements.passphraseConfirm.value = ""')],
  ["Offline exhibit crypto and no-network container are fixed", capsuleCryptoApp.includes("PBKDF2_ITERATIONS = 310000") && capsuleCryptoApp.includes("KEY_BITS = 256") && capsuleCryptoApp.includes("TAG_BITS = 128") && capsuleCryptoApp.includes("createOfflineHtml") && capsuleCryptoApp.includes("connect-src 'none'")],
  ["Capsule mobile dialog keeps safe areas and touch targets", capsuleCss.includes("height: 100dvh;") && capsuleCss.includes("max-height: 100dvh;") && capsuleCss.includes("min-height: 44px;") && capsuleCss.includes("min-width: 44px;") && ["safe-area-inset-top", "safe-area-inset-right", "safe-area-inset-bottom", "safe-area-inset-left"].every((token) => capsuleCss.includes(token)) && capsuleCss.includes("@media (max-width: 650px)") && capsuleCss.includes("@media (max-width: 390px)") && capsuleCss.includes("@media (max-width: 320px)")],
  ["Share privacy module keeps generic defaults and a fixed immediate-open boundary", sharePrivacyApp.includes('DEFAULT_PUBLIC_TITLE = "时屿加密分享"') && sharePrivacyApp.includes('DEFAULT_FILE_TITLE = "time-isle-private-share"') && sharePrivacyApp.includes('IMMEDIATE_OPEN_SENTINEL = "1970-01-01T00:00:00.000Z"') && sharePrivacyApp.includes("projectSharePayload") && !/\bfetch\b|XMLHttpRequest|WebSocket|sendBeacon|localStorage|sessionStorage|indexedDB/iu.test(sharePrivacyApp)],
  ["Share privacy editor keeps compact mobile and keyboard boundaries", sharePrivacyCss.includes(".share-privacy-panel[hidden]") && sharePrivacyCss.includes("min-height: 44px") && sharePrivacyCss.includes("focus-visible") && sharePrivacyCss.includes("@media (max-width: 650px)") && sharePrivacyCss.includes("@media (max-width: 390px)") && sharePrivacyCss.includes("@media (max-width: 320px)") && sharePrivacyCss.includes("prefers-reduced-motion") && sharePrivacyCss.includes("safe-area-inset-right") && sharePrivacyCss.includes("grid-template-columns: minmax(0, 1fr)") && !/gradient\s*\(/iu.test(sharePrivacyCss)],
  ["Demo voice controls keep native hidden state", /\.voice-field\s+\[hidden\],\s*\.memory-voice-detail\s+\[hidden\]\s*\{[^}]*display:\s*none\s*!important;/s.test(voiceCss) && html.includes('/voice.css?v=7.2.0-align1')],
  ["页面包含四个清晰主视图", ["collection", "compose", "reflect", "data"].every((view) => html.includes(`data-view-panel="${view}"`))],
  ["主导航仍严格保持单一四项", (html.match(/<nav class="main-nav"/g) || []).length === 1 && (html.match(/class="nav-button/g) || []).length === 4],
  ["主导航暴露受控视图和唯一当前项", ["collection", "compose", "reflect", "data"].every((view) => new RegExp(`data-view="${view}"[^>]*aria-controls="view-${view}"`).test(html)) && (html.match(/aria-current="page"/g) || []).length === 1 && app.includes('button.setAttribute("aria-current", active ? "page" : "false")')],
  ["桌面和平板主导航保持顶部布局", tabletCssStart > 0 && mobileCssStart > tabletCssStart && desktopHeaderRule.includes("position: sticky;") && desktopHeaderRule.includes("top: 0;") && desktopNavRule.includes("display: flex;") && !desktopNavRule.includes("position: fixed;") && !tabletNavRule.includes("position: fixed;")],
  ["手机主导航在窄屏及触控横屏固定到底部", compactCssStart > mobileCssStart && mobileCss.includes("(max-width: 950px) and (max-height: 520px) and (pointer: coarse)") && mobileNavRule.includes("position: fixed;") && mobileNavRule.includes("z-index: 50;") && mobileNavRule.includes("inset: auto 0 0;") && mobileNavRule.includes("display: grid;") && mobileNavRule.includes("grid-template-columns: repeat(4, minmax(0, 1fr));")],
  ["手机四项导航等宽居中且保留触控与焦点边界", mobileButtonRule.includes("width: 100%;") && mobileButtonRule.includes("min-width: 0;") && mobileButtonRule.includes("min-height: 52px;") && mobileButtonRule.includes("display: flex;") && mobileButtonRule.includes("align-items: center;") && mobileButtonRule.includes("justify-content: center;") && mobileButtonRule.includes("text-align: center;") && mobileButtonRule.includes("white-space: nowrap;") && mobileButtonFocusRule.includes("outline: 2px solid var(--accent);") && mobileFullLabelRule.includes("display: none;") && mobileCompactLabelRule.includes("display: inline;") && (html.match(/class="nav-label-compact"/g) || []).length === 4],
  ["移动底栏兼容四边安全区并为整页与提示留位", html.includes('content="width=device-width, initial-scale=1.0, viewport-fit=cover"') && mobileRootRule.includes("--mobile-nav-height: 65px;") && mobileHtmlRule.includes("scroll-padding-bottom:") && mobileHtmlRule.includes("env(safe-area-inset-bottom)") && mobileBodyRule.includes("padding-bottom:") && mobileBodyRule.includes("env(safe-area-inset-bottom)") && ["safe-area-inset-top", "safe-area-inset-right", "safe-area-inset-bottom", "safe-area-inset-left"].every((token) => mobileCss.includes(token)) && mobileHeaderRule.includes("backdrop-filter: none;") && mobileToastRule.includes("bottom:") && mobileToastRule.includes("env(safe-area-inset-bottom)")],
  ["320px 主导航标签保持紧凑单行且页面无强制横向溢出", reducedMotionCssStart > compactCssStart && mobileBodyRule.includes("min-width: 0;") && compactNavRule.includes("gap: 2px;") && compactNavRule.includes("padding-left: max(6px, env(safe-area-inset-left));") && compactNavRule.includes("padding-right: max(6px, env(safe-area-inset-right));") && compactButtonRule.includes("padding-inline: 2px;") && compactButtonRule.includes("font-size: 0.7rem;") && mobileButtonRule.includes("white-space: nowrap;")],
  ["脚本查询的 DOM ID 全部存在且页面 ID 不重复", queriedIds.every((id) => htmlIds.includes(id)) && new Set(htmlIds).size === htmlIds.length],
  ["时屿品牌结构完整", html.includes("<strong>时屿</strong>") && html.includes("<small>TIME ISLE</small>") && html.includes("AI 私人记忆策展工具")],
  ["核心记录表单存在", html.includes('id="memoryForm"') && html.includes('id="draftForm"')],
  ["图片记录入口保持在现有记录流程", html.includes('id="photoInput"') && html.includes('id="photoTray"') && !html.includes('data-view="gallery"')],
  ["声音入口保持记录页内的默认折叠渐进披露", /<details class="voice-field">[\s\S]*?<strong>添加声音<\/strong><small>可选 · 最多 3 段，每段 3 分钟<\/small>/.test(html) && html.includes('id="voiceRecordButton"') && html.includes('id="voiceFileInput"') && !html.includes('<details class="voice-field" open') && !html.includes('data-view="voice"')],
  ["声音资源按独立模块接入且不增加主导航", (html.match(/\/voice\.css/g) || []).length === 1 && (html.match(/\/assets\/voice\.js/g) || []).length === 1 && html.indexOf("/media.css") < html.indexOf("/voice.css") && html.indexOf("/assets/media.js") < html.indexOf("/assets/voice.js") && html.indexOf("/assets/voice.js") < html.indexOf("/assets/app.js") && (html.match(/class="nav-button/g) || []).length === 4],
  ["声音控件在应用连接前保持禁用且失联时明确说明", html.includes('id="voiceRecordButton" type="button" disabled') && html.includes('id="voiceFileLabel" for="voiceFileInput" aria-disabled="true"') && html.includes('id="voiceFileInput" class="sr-only" type="file" multiple disabled') && html.includes("正在连接本地声音服务…") && app.includes("showVoiceUnavailable();") && app.includes("请先启动本地服务，再刷新页面重试。") && voiceCss.includes("pointer-events: none;")],
  ["录音与文件选择盒统一对齐且窄屏无表单外边距", /\.voice-actions\s+\.voice-file-label\s*\{[^}]*margin:\s*0\s*;/s.test(voiceCss) && voiceCss.includes(".voice-actions .button,") && voiceCss.includes(".voice-actions .voice-file-label,")],
  ["声音控制器覆盖录音上传关联与失败续存合同", ["loadMemory", "waitForReady", "saveToMemory", "reset", "setDemo", "getState"].every((name) => voiceApp.includes(name)) && voiceApp.includes("/api/voice/uploads?filename=") && voiceApp.includes("/api/memories/${encodeURIComponent(normalizedId)}/voices") && voiceApp.includes("/transcript") && app.includes('runAttachmentControllers("waitForReady")') && app.includes('runAttachmentControllers("saveToMemory", saved.memory.id)') && app.includes("state.pendingSaveMemoryId = saved.memory.id") && app.includes("附件未完成")],
  ["声音模块缺失不会伪装成已连接", app.includes("function initializeVoiceController") && app.includes("声音模块未能加载，请刷新页面重试。") && app.includes("其他馆藏功能不受影响") && app.indexOf("initializeVoiceController(options.voicePolicy") < app.indexOf("setRuntimeStatus(demo.interviewDemo")],
  ["麦克风授权等待直接反馈并隔离过期会话", voiceApp.includes('Symbol("voice-permission")') && voiceApp.includes("取消授权等待") && voiceApp.includes("仍在等待麦克风授权") && voiceApp.includes("requestSession !== session") && voiceApp.includes("demo || mutationBusy") && voiceApp.includes("recording === startedRecording") && voiceApp.includes('setAttribute("aria-busy"') && voiceApp.includes("cancelPermissionRequest(true)")],
  ["录音协商格式、179 秒边界与 Demo 零麦克风写入", voiceApp.indexOf("if (demo || recording") < voiceApp.indexOf("getUserMedia({ audio: true") && voiceApp.includes('"audio/webm;codecs=opus"') && voiceApp.includes('"audio/mp4;codecs=mp4a.40.2"') && voiceApp.includes("Math.min(179_000") && voiceApp.includes('listen(global, "pagehide"') && voiceApp.includes("stopTracks(recording.stream)") && voiceApp.includes("revokeObjectURL") && voiceApp.includes("elements.voiceFileInput.disabled = demo")],
  ["文字稿严格区分草稿与人工确认展示", voiceApp.includes('JSON.stringify({ text, confirm: item.transcript.status === "confirmed" })') && voiceApp.includes('method: "DELETE"') && voiceCardMarkup.includes("2 段声音") && voiceDetailMarkup.includes("这是人工确认的文字。") && !voiceDetailMarkup.includes("普通详情不能出现的草稿。") && voiceDetailMarkup.includes("<audio controls")],
  ["声音移动布局保持克制触控与安全区", voiceCss.includes("min-height: 44px;") && voiceCss.includes(".voice-recording[hidden]") && voiceCss.includes("@media (max-width: 650px)") && voiceCss.includes("@media (max-width: 390px)") && voiceCss.includes("@media (max-width: 320px)") && ["safe-area-inset-right", "safe-area-inset-left"].every((token) => voiceCss.includes(token)) && voiceCss.includes("grid-template-columns: minmax(0, 1fr);") && voiceCss.includes("overflow-wrap: anywhere") && !/gradient\s*\(/i.test(voiceCss)],
  ["照片替代文字可独立核对并保留说明后备", html.includes('id="photoAltText"') && mediaApp.includes('updateSelected("altText"') && mediaApp.includes('altText: media.altText || ""') && mediaApp.includes('altText: String(item.altText || item.caption || "")') && mediaApp.includes('altText: saved.altText || ""') && mediaApp.includes('altText: item.altText') && mediaApp.includes('const alt = String(item.altText || caption')],
  ["照片线索保持为详情图库下的折叠入口", app.includes("TimeIsleMediaEvidence?.renderPanel(memory)") && mediaEvidenceMarkup.includes('<details class="media-evidence-panel"') && emptyMediaEvidenceMarkup === "" && !html.includes('data-view="evidence"')],
  ["照片线索资源已按依赖顺序接入", html.indexOf('/media-evidence.css') > html.indexOf('/media.css') && html.indexOf('/assets/media-evidence.js') > html.indexOf('/assets/media.js') && html.indexOf('/assets/media-evidence.js') < html.indexOf('/assets/app.js')],
  ["影像实验台保持详情内的可选折叠工具", app.includes("TimeIsleMediaLab?.renderPanel(memory") && mediaLabApp.includes('<details class="media-lab"') && !html.includes('data-view="media-lab"')],
  ["文字摘录依赖先于影像实验台载入", html.indexOf('/assets/media-ocr.js') < html.indexOf('/assets/media-lab.js') && html.indexOf('/assets/media-lab.js') < html.indexOf('/assets/app.js')],
  ["已保存展品仍可编辑", html.includes('id="dialogEditButton"') && app.includes("editSelectedMemory")],
  ["讲解员和引用区域存在", html.includes('id="guideForm"') && html.includes('id="citationList"')],
  ["回顾视图包含时间线、主题和摘要", ["timelinePanel", "themesPanel", "reportPanel"].every((id) => html.includes(`id="${id}"`))],
  ["主题展览资源按独立模块和依赖顺序接入", (html.match(/\/exhibitions\.css/g) || []).length === 1 && (html.match(/\/assets\/exhibitions\.js/g) || []).length === 1 && html.indexOf("/styles.css") < html.indexOf("/exhibitions.css") && html.indexOf("/assets/media-lab.js") < html.indexOf("/assets/exhibitions.js") && html.indexOf("/assets/exhibitions.js") < html.indexOf("/assets/app.js") && app.includes("TimeIsleExhibitions?.createController")],
  ["主题展览只从回顾页提供唯一渐进入口", (html.match(/id="exhibitionStudioButton"/g) || []).length === 1 && html.indexOf('data-view-panel="reflect"') < html.indexOf('id="exhibitionStudioButton"') && html.indexOf('id="exhibitionStudioButton"') < html.indexOf('data-view-panel="data"') && !html.includes('data-view="exhibition"')],
  ["主题展览保存要求核对预览且 Demo 只预览", exhibitionsApp.includes("if (destroyed || demo || busyMutation || busyPreview) return;") && exhibitionsApp.includes("previewSignature !== currentSignature()") && exhibitionsApp.includes("elements.saveButton.disabled = busy || demo || Boolean(readingId) || !preview") && exhibitionsApp.includes("confirm: true") && exhibitionsApp.includes('demo ? "Demo 仅预览"') && exhibitionsCss.includes("#exhibitionSaveActions[hidden]") && html.indexOf('id="exhibitionPreview"') < html.indexOf('id="exhibitionSaveButton"') && html.includes('type="button" class="icon-button" value="close" data-exhibition-close')],
  ["主题展览移动工作室覆盖视口安全区与触控边界", exhibitionsCss.includes("height: 100dvh;") && exhibitionsCss.includes("max-height: 100dvh;") && ["safe-area-inset-top", "safe-area-inset-right", "safe-area-inset-bottom", "safe-area-inset-left"].every((token) => exhibitionsCss.includes(token)) && exhibitionsCss.includes('#exhibitionDialog button,\n#exhibitionDialog summary,\n#exhibitionDialog input[type="text"] {\n  min-height: 44px;') && exhibitionsCss.includes("#exhibitionDialog .icon-button {\n  min-width: 44px;")],
  ["主题展览保存沿用用户实际看过的完整预览", ["title", "opening", "mode", "sections"].every((field) => exhibitionsApp.includes(`${field}: preview.${field}`)) && exhibitionsApp.indexOf('requestJson("preview", "/api/exhibitions/preview"') < exhibitionsApp.indexOf("sections: preview.sections")],
  ["今日回访只占回顾页一张渐进卡片", (html.match(/id="revisitCard"/g) || []).length === 1 && html.indexOf('id="revisitCard"') < html.indexOf('id="guideTitle"') && (html.match(/data-revisit-kind=/g) || []).length === 3 && !html.includes('data-view="revisit"')],
  ["今日回访资源独立且在主应用前载入", html.indexOf('/exhibitions.css') < html.indexOf('/revisits.css') && html.indexOf('/assets/revisits.js') > html.indexOf('/assets/exhibitions.js') && html.indexOf('/assets/revisits.js') < html.indexOf('/assets/app.js') && app.includes("TimeIsleRevisits?.createController")],
  ["今日回访仅在明确点击后读取且始终只呈现一件", revisitsApp.includes("if (options.userInitiated !== true)") && revisitsApp.includes('event.target.closest("[data-revisit-start]")') && revisitsApp.includes("load(activeKind, { userInitiated: true })") && revisitsApp.includes("const candidates = [activeKind]") && revisitsApp.includes("revisit: revisits[0]") === false && revisitsApp.includes("current = revisit") && app.includes('if (target === "reflect")')],
  ["今日回访 Demo 不写状态且移动触控边界完整", revisitsApp.includes("if (!demo)") && revisitsApp.includes("sessionHidden.size + 1") && revisitsApp.includes("payload?.revisits") && revisitsApp.includes("function setStatus(text, isError = false)") && revisitsCss.includes("min-height: 44px;") && ["safe-area-inset-right", "safe-area-inset-bottom", "safe-area-inset-left"].every((token) => revisitsCss.includes(token)) && revisitsCss.includes("@media (max-width: 360px)")],
  ["语义线索资源独立并在主应用前载入", (html.match(/\/clues\.css/g) || []).length === 1 && (html.match(/\/assets\/clues\.js/g) || []).length === 1 && html.indexOf('/revisits.css') < html.indexOf('/clues.css') && html.indexOf('/assets/revisits.js') < html.indexOf('/assets/clues.js') && html.indexOf('/assets/clues.js') < html.indexOf('/assets/app.js') && app.includes("TimeIsleClues?.createEntityDialogController")],
  ["实体档案复用单一对话框且不增加导航", ["entityDialog", "entityDialogTitle", "entityDialogKind", "entityDialogStatus", "entityDialogBody"].every((id) => html.includes(`id="${id}"`)) && (html.match(/data-entity-close/g) || []).length === 1 && (html.match(/id="entityDialog"/g) || []).length === 1 && !html.includes('data-view="entities"') && cluesApp.includes('listen(documentRef, "click", handleDocumentClick)')],
  ["唯一搜索框保留线索元数据并呈现可回看依据", (html.match(/id="searchInput"/g) || []).length === 1 && !html.includes("data-search-mode") && !app.includes("/api/search?mode") && app.includes('/api/search?limit=50&query=') && app.includes("normalizeSearchResponse(payload)") && app.includes("state.searchResponse =") && app.includes("renderSearchEvidence(searchResult, state.searchResponse.engine)") && cluesApp.includes("matchedTerms") && cluesApp.includes("matchedFields") && cluesApp.includes("entityRefs")],
  ["展品详情把人物地点主题升级为可打开实体线索", ['renderEntityChips(memory, "person"', 'renderEntityChips(memory, "place"', 'renderEntityChips(memory, "theme"'].every((token) => app.includes(token)) && app.includes("memory.entityRefs || memory.entities || []") && app.includes('data-entity-id=') && app.includes("if (!refs.length)")],
  ["实体别名与合并保持预览后二次确认及 Demo 零写入", cluesApp.includes("/aliases/preview") && cluesApp.includes("data-alias-confirm") && cluesApp.includes("/merge/preview") && cluesApp.includes("data-merge-confirm") && cluesApp.includes("data-entity-merge-details") && cluesApp.includes("onDataChanged") && cluesApp.includes("mutationBusy || demo") && cluesApp.includes("Demo 不保存") && app.includes("onOpenMemory: openMemory, onDataChanged: reloadMemories") && app.includes("cluesController?.setDemo(demo)")],
  ["实体档案覆盖窄屏安全区、触控和克制视觉", cluesCss.includes("@media (max-width: 650px)") && cluesCss.includes("@media (max-width: 390px)") && ["safe-area-inset-top", "safe-area-inset-right", "safe-area-inset-bottom", "safe-area-inset-left"].every((token) => cluesCss.includes(token)) && cluesCss.includes("min-height: 44px;") && cluesCss.includes("grid-template-columns: 1fr;") && cluesCss.includes("overflow-wrap: anywhere") && !/gradient\s*\(/i.test(cluesCss)],
  ["记忆考古使用局部航线和独立拼图", html.includes('id="routesPanel"') && html.includes('id="puzzleDialog"') && html.includes('id="dialogRouteButton"')],
  ["补一块拼图允许回答或保留不确定", ["puzzleSaveAnswerButton", "puzzleUnknownButton", "puzzleSkipButton"].every((id) => html.includes(`id="${id}"`))],
  ["回顾标签具备完整 ARIA 关联", (html.match(/role="tab"/g) || []).length === 4 && (html.match(/role="tabpanel"/g) || []).length === 4 && (html.match(/role="tab"[^>]*aria-controls="/g) || []).length === 4],
  ["非导航视图切换聚焦标题且尊重减少动态偏好", app.includes('switchView(button.dataset.view)') && app.includes('switchView(button.dataset.goView, { focusHeading: true })') && app.includes('querySelector("h1")?.focus({ preventScroll: true })') && app.includes('matchMedia?.("(prefers-reduced-motion: reduce)")') && (html.match(/<h1 tabindex="-1">/g) || []).length === 4],
  ["详情内切换展品重置滚动并聚焦标题", html.includes('id="dialogTitle" tabindex="-1"') && app.includes("elements.dialogBody.scrollTop = 0") && app.includes("elements.dialogTitle.focus({ preventScroll: true })")],
  ["详情异步失败会明确提示而不是静默无响应", app.includes("void openMemory(memoryId).catch") && app.includes('console.error("打开展品详情失败：", error)') && app.includes('showToast(`无法打开这件展品：${error.message}`, true)')],
  ["馆藏检索失败清空旧卡片并提供明确重试", html.includes('id="searchErrorState" hidden') && html.includes('id="retrySearchButton"') && app.includes('elements.retrySearchButton.addEventListener("click", performSearch)') && app.includes('elements.memoryGrid.innerHTML = "";') && app.includes("if (state.searchError)")],
  ["检索结果计数、零结果与失败通过状态区播报", /id="collectionMeta"[^>]*role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"/.test(html) && app.includes('`“${query}”找到 ${visible.length} 件展品${filterNote}${') && app.includes("shortQueryFallback") && app.includes('elements.collectionMeta.textContent = "检索失败，请重试。";')],
  ["隐藏照片输入具有可见焦点代理", mediaCss.includes('label[for="photoInput"]:has(+ #photoInput:focus-visible)') && mediaCss.includes("outline: 2px solid var(--accent)")],
  ["添加照片折叠入口和 320px 字段布局保持克制可聚焦", mediaCss.includes(".media-field > summary:focus-visible") && mediaCss.includes(".media-field > summary::-webkit-details-marker") && mediaCss.includes("@media (max-width: 420px)") && mediaCss.includes("flex-direction: column;") && mediaCss.includes(".media-field-heading .media-privacy-field")],
  ["媒体错误文字和窄屏按钮满足可读触控边界", mediaOcrCss.includes('.media-ocr-status[data-state="error"] {\n  color: var(--danger);') && mediaLabCss.includes('.media-lab-status[data-state="error"] {\n  color: var(--danger);') && mediaOcrCss.includes(".media-ocr-panel button {\n    min-height: 44px;") && mediaLabCss.includes(".media-lab button {\n    min-height: 44px;")],
  ["考古概览失败不会拖垮核心馆藏", app.includes('requestJson("/api/archaeology/overview").catch(() => ({ overview: [] }))')],
  ["数据维护操作存在并呈现媒体清理状态", ["exportButton", "exportRedactedButton", "archiveImportFile", "importFile", "purgeButton"].every((id) => html.includes(`id="${id}"`)) && app.includes("result.mediaCleanupPending")],
  ["页面不再暴露阶段治理术语", !/Phase\s*\d+|Reviewer|插件生态|运行时沙箱|发布审批/.test(html)],
  ["页面没有内联脚本或样式", !/<script(?!\s+src=)/i.test(html) && !/<style/i.test(html) && !/\sstyle="/i.test(html)],
  ["Vercel 静态页面复用完整安全响应头", hasVercelSecurityHeaders(vercel)],
  ["样式未使用渐变", !/gradient\s*\(/i.test(`${css}\n${pwaCss}\n${archaeologyCss}\n${mediaCss}\n${voiceCss}\n${capsuleCss}\n${sharePrivacyCss}\n${mediaEvidenceCss}\n${mediaCompareCss}\n${mediaOcrCss}\n${mediaLabCss}\n${exhibitionsCss}\n${revisitsCss}\n${cluesCss}`)],
  ["前端覆盖核心 API", ["/api/memories", "/api/analyze", "/api/search", "/api/guide", "/api/insights", "/api/privacy", "/api/archaeology/routes", "/api/archaeology/puzzle"].every((endpoint) => app.includes(endpoint))],
  ["图片前端覆盖安全上传和关联 API", ["/uploads", "/complete", "/api/memories/"].every((endpoint) => mediaApp.includes(endpoint))],
  ["附件关联失败后复用已创建展品而不重复新增", app.includes("const targetMemoryId = state.editingMemoryId || state.pendingSaveMemoryId;") && app.includes('method: targetMemoryId ? "PUT" : "POST"') && app.indexOf("state.pendingSaveMemoryId = saved.memory.id") < app.indexOf('runAttachmentControllers("saveToMemory", saved.memory.id)') && app.includes("不会重复创建展品") && app.includes('return "继续完成保存"') && app.includes('state.pendingSaveMemoryId = "";')],
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
  ["核心文件规模已收敛", lineCount(server) < 1400 && lineCount(app) < 1340 && lineCount(pwaApp) < 250 && lineCount(mediaApp) < 1150 && lineCount(voiceApp) < 900 && lineCount(capsuleApp) < 1000 && lineCount(sharePrivacyApp) < 600 && lineCount(mediaEvidenceApp) < 850 && lineCount(mediaCompareApp) < 850 && lineCount(mediaOcrApp) < 750 && lineCount(mediaLabApp) < 500 && lineCount(portabilityApp) < 250 && lineCount(exhibitionsApp) < 850 && lineCount(revisitsApp) < 550 && lineCount(revisionsApp) < 400 && lineCount(cluesApp) < 750 && lineCount(collectionHealthApp) < 350 && lineCount(css) < 1600 && lineCount(pwaCss) < 250 && lineCount(archaeologyCss) < 400 && lineCount(mediaCss) < 700 && lineCount(voiceCss) < 450 && lineCount(capsuleCss) < 650 && lineCount(sharePrivacyCss) < 200 && lineCount(mediaEvidenceCss) < 500 && lineCount(exhibitionsCss) < 800 && lineCount(revisitsCss) < 450 && lineCount(revisionsCss) < 350 && lineCount(cluesCss) < 550 && lineCount(collectionHealthCss) < 300 && lineCount(archaeology) < 900 && lineCount(archaeologyBackup) < 300]
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

console.log(`Frontend checks passed: ${checks.length}.`);

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function lineCount(value) {
  return value.split(/\r?\n/).length;
}

function ruleDeclarations(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${escaped}\\s*\\{([^{}]*)\\}`).exec(source)?.[1] || "";
}

function hasVercelSecurityHeaders(config) {
  const headers = Object.fromEntries((config.headers?.find((item) => item.source === "/(.*)")?.headers || []).map((item) => [item.key, item.value]));
  return headers["X-Content-Type-Options"] === "nosniff"
    && headers["Referrer-Policy"] === "same-origin"
    && headers["X-Frame-Options"] === "DENY"
    && headers["Permissions-Policy"] === "camera=(), microphone=(), geolocation=()"
    && headers["Content-Security-Policy"] === "default-src 'self'; connect-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self'; script-src 'self'; worker-src 'self'; manifest-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
}
