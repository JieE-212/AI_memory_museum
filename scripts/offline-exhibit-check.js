"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const { buildSafeSnapshot, validateSafeSnapshot } = require("../lib/capsule-service");
const CapsuleCrypto = require("../public/assets/capsule-crypto");
const SharePrivacy = require("../public/assets/share-privacy");

require("../public/assets/capsules");
const CapsuleUi = globalThis.TimeIsleCapsules;

const PASSPHRASE = "Isle-Capsule-2026!";
const OTHER_PASSPHRASE = "Wrong-Capsule-2026!";
let assertions = 0;

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  const fixture = createFixture();
  const legacyPayload = checkProductionPayload(fixture);
  const reviewed = checkReviewedProjection(fixture);
  checkReviewedTampering(reviewed.payload);
  const legacyEnvelope = await checkCrypto(legacyPayload);
  await checkLegacyWhitespaceCompatibility(legacyPayload);
  const reviewedEnvelope = await checkReviewedCrypto(reviewed);
  await checkOfflineHtml(legacyPayload, legacyEnvelope, fixture);
  await checkReviewedOfflineHtml(reviewed, reviewedEnvelope);
  await checkAstralTextInOfflineRuntime(reviewed);
  await checkStaticSafety(legacyEnvelope);
  console.log(`Offline exhibit checks passed: ${assertions} assertions.`);
}

function checkProductionPayload(fixture) {
  const built = buildSafeSnapshot({
    exhibition: fixture.exhibition,
    media: fixture.media,
    transcripts: fixture.transcripts
  });
  equal(validateSafeSnapshot(built.snapshot), true, "真实胶囊服务生成的安全快照通过严格校验");
  equal(built.mediaLinks[0].itemKey, "item-1", "服务端只把媒体关联改写为匿名展品键");

  const packedMedia = [{
    key: fixture.canaries.mediaId,
    itemKey: built.mediaLinks[0].itemKey,
    caption: built.mediaLinks[0].caption,
    alt: built.mediaLinks[0].altText,
    mimeType: "image/webp",
    width: 320,
    height: 180,
    byteSize: fixture.webp.length,
    dataBase64: fixture.webp.toString("base64"),
    contentUrl: fixture.canaries.mediaUrl,
    sha256: fixture.canaries.mediaHash,
    internalAssetId: fixture.canaries.mediaId
  }];
  const payload = CapsuleUi.assembleOfflinePayload(built.snapshot, packedMedia);

  deepEqual(
    Object.keys(payload),
    ["format", "version", "title", "theme", "opening", "sections", "media"],
    "浏览器最终载荷只保留离线展览白名单字段"
  );
  equal(payload.format, "time-isle.offline-exhibit", "最终载荷使用固定离线展览格式");
  equal(payload.version, 1, "最终载荷使用固定版本");
  deepEqual(payload.sections.map((section) => section.key), ["section-1"], "章节键保持匿名顺序");
  deepEqual(payload.sections[0].items.map((item) => item.key), ["item-1", "item-2"], "展品键保持匿名顺序");
  deepEqual(payload.sections[0].items[0].mediaKeys, ["media-1"], "媒体键挂回正确的匿名展品");
  deepEqual(payload.sections[0].items[1].mediaKeys, [], "未选图片的展品保持空媒体列表");
  deepEqual(payload.sections[0].items[0].confirmedQuotes, [fixture.allowedQuotes[0]], "只保留已核验引用");
  deepEqual(payload.sections[0].items[1].confirmedQuotes, [fixture.allowedQuotes[1]], "每件展品的引用保持独立");
  deepEqual(payload.sections[0].items[0].confirmedTranscripts, [fixture.allowedTranscript], "只保留人工确认文字稿");
  equal(payload.media[0].key, "media-1", "浏览器重新生成匿名媒体键");
  equal(payload.media[0].itemKey, "item-1", "媒体只引用匿名展品键");
  equal(payload.media[0].mimeType, "image/webp", "最终载荷只携带 display WebP");
  equal(payload.media[0].byteSize, fixture.webp.length, "最终载荷保留真实字节数");
  deepEqual(
    Object.keys(payload.media[0]).sort(),
    ["alt", "byteSize", "caption", "dataBase64", "height", "itemKey", "key", "mimeType", "width"].sort(),
    "最终媒体条目物理排除 URL、哈希和数据库字段"
  );

  const serialized = JSON.stringify(payload);
  for (const canary of Object.values(fixture.canaries)) {
    check(!serialized.includes(canary), `最终载荷排除隐私金丝雀：${canary.slice(0, 28)}`);
  }
  check(serialized.includes(fixture.allowedTranscript), "最终载荷保留确认文字稿正文");
  check(serialized.includes(fixture.allowedQuotes[0]), "最终载荷保留确认引用正文");
  check(serialized.includes(fixture.allowedCaption), "最终载荷保留用户选择的安全图片说明");

  assert.throws(
    () => CapsuleUi.assembleOfflinePayload(built.snapshot, [{ ...packedMedia[0], mimeType: "image/jpeg" }]),
    /无效的安全展示图/u
  );
  assertions += 1;
  assert.throws(
    () => CapsuleUi.assembleOfflinePayload(built.snapshot, [{ ...packedMedia[0], itemKey: "item-99" }]),
    /无效的安全展示图/u
  );
  assertions += 1;
  return payload;
}

function checkReviewedProjection(fixture) {
  const canaries = {
    sourceTitle: "SOURCE-TITLE-CANARY",
    sourceTheme: "SOURCE-THEME-CANARY",
    sourceOpening: "SOURCE-OPENING-CANARY",
    sourceDate: "2049-12-31T23:59:59.000Z",
    internalId: "INTERNAL-ID-CANARY",
    internalUrl: "/api/media/PRIVATE-URL-CANARY/display",
    internalSha: "f".repeat(64),
    unselectedItem: "UNSELECTED-ITEM-CANARY",
    unselectedQuote: "UNSELECTED-QUOTE-CANARY",
    unselectedTranscript: "UNSELECTED-TRANSCRIPT-CANARY",
    unselectedMedia: "UNSELECTED-MEDIA-CANARY"
  };
  const mediaBase = {
    mimeType: "image/webp",
    width: 320,
    height: 180,
    byteSize: fixture.webp.length,
    dataBase64: fixture.webp.toString("base64")
  };
  const source = {
    format: "time-isle.offline-exhibit",
    version: 1,
    title: canaries.sourceTitle,
    theme: canaries.sourceTheme,
    opening: canaries.sourceOpening,
    sourceId: canaries.internalId,
    exportedAt: canaries.sourceDate,
    sections: [{
      key: "section-private-a",
      title: "来源第一章",
      summary: "来源第一章摘要",
      items: [{
        key: "item-private-a",
        title: canaries.unselectedItem,
        excerpt: "未选择摘录",
        curatorNote: "未选择说明",
        confirmedQuotes: [canaries.unselectedQuote],
        confirmedTranscripts: [],
        mediaKeys: ["media-private-a"]
      }, {
        key: "item-private-b",
        title: "来源第二件",
        excerpt: "来源第二件摘录",
        curatorNote: "来源第二件说明",
        confirmedQuotes: [],
        confirmedTranscripts: ["保留的确认文字稿"],
        mediaKeys: ["media-private-b"]
      }]
    }, {
      key: "section-private-b",
      title: "来源第二章",
      summary: "来源第二章摘要",
      items: [{
        key: "item-private-c",
        title: "来源第三件",
        excerpt: "来源第三件摘录",
        curatorNote: "来源第三件说明",
        confirmedQuotes: ["保留的确认引用"],
        confirmedTranscripts: [canaries.unselectedTranscript],
        mediaKeys: ["media-private-c"]
      }]
    }],
    media: [{
      ...mediaBase,
      key: "media-private-a",
      itemKey: "item-1",
      caption: canaries.unselectedMedia,
      alt: "未选择图片",
      contentUrl: canaries.internalUrl,
      sha256: canaries.internalSha,
      assetId: canaries.internalId
    }, {
      ...mediaBase,
      key: "media-private-b",
      itemKey: "item-2",
      caption: "第二件图片但本次不选",
      alt: "不选图片",
      contentUrl: canaries.internalUrl,
      sha256: canaries.internalSha
    }, {
      ...mediaBase,
      key: "media-private-c",
      itemKey: "item-3",
      caption: "保留的安全展示图",
      alt: "一张经过处理的安全展示图",
      contentUrl: canaries.internalUrl,
      sha256: canaries.internalSha
    }]
  };
  const sourceBefore = clone(source);
  const draft = SharePrivacy.createShareDraft({ payload: source });
  equal(draft.publicTitle, SharePrivacy.DEFAULT_PUBLIC_TITLE, "公开标题使用通用默认值而不是来源标题");
  equal(draft.publicNote, SharePrivacy.DEFAULT_PUBLIC_NOTE, "公开说明使用通用默认值");
  equal(draft.fileTitle, SharePrivacy.DEFAULT_FILE_TITLE, "下载文件名使用稳定通用默认值");
  check(draft.sections.every((section) => !section.selected), "所有章节初始均不分享");
  check(draft.sections.flatMap((section) => section.items).every((item) => !item.selected), "所有展品初始均不分享");
  check(draft.sections.flatMap((section) => section.items).flatMap((item) => [...item.quotes, ...item.transcripts, ...item.media]).every((entry) => !entry.selected), "引用、文字稿和图片初始均不分享");

  draft.audience = "大学室友";
  draft.purpose = "一起核对毕业旅行的记忆";
  draft.title = "只给这次分享使用的标题";
  draft.theme = "同行";
  draft.opening = "这份副本只保留我们共同确认过的片段。";
  draft.sections[0].selected = true;
  draft.sections[0].title = "被选择的第一章";
  draft.sections[0].summary = "只保留第二件展品。";
  draft.sections[0].items[1].selected = true;
  draft.sections[0].items[1].title = "重新命名的第一件展品";
  draft.sections[0].items[1].transcripts[0].selected = true;
  draft.sections[1].selected = true;
  draft.sections[1].title = "被选择的第二章";
  draft.sections[1].summary = "保留第三件展品与一张图。";
  draft.sections[1].items[0].selected = true;
  draft.sections[1].items[0].title = "重新命名的第二件展品";
  draft.sections[1].items[0].quotes[0].selected = true;
  draft.sections[1].items[0].media[0].selected = true;
  const draftBeforeProjection = clone(draft);
  const reviewed = SharePrivacy.projectSharePayload(draft);

  equal(reviewed.payload.version, 2, "隐私编辑台投影生成 V2 离线载荷");
  deepEqual(reviewed.payload.sections.map((section) => section.key), ["section-1", "section-2"], "已选章节连续重新编号");
  deepEqual(reviewed.payload.sections.flatMap((section) => section.items.map((item) => item.key)), ["item-1", "item-2"], "跨章节已选展品连续重新编号");
  deepEqual(reviewed.payload.media.map((media) => media.key), ["media-1"], "只保留的图片连续重新编号");
  equal(reviewed.payload.media[0].itemKey, "item-2", "图片所有权改写到新的匿名展品键");
  deepEqual(reviewed.payload.sections[0].items[0].confirmedTranscripts, ["保留的确认文字稿"], "只投影明确选择的文字稿");
  deepEqual(reviewed.payload.sections[1].items[0].confirmedQuotes, ["保留的确认引用"], "只投影明确选择的引用");
  deepEqual(reviewed.payload.sections[1].items[0].confirmedTranscripts, [], "未选择文字稿物理缺席");
  deepEqual(reviewed.shell, {
    title: SharePrivacy.DEFAULT_PUBLIC_TITLE,
    note: SharePrivacy.DEFAULT_PUBLIC_NOTE,
    opensAt: SharePrivacy.IMMEDIATE_OPEN_SENTINEL
  }, "公开外壳保持通用默认值并固定立即开启哨兵");
  equal(reviewed.fileTitle, SharePrivacy.DEFAULT_FILE_TITLE, "文件名不带来源标题或导出时间");
  deepEqual(reviewed.payload.shareReceipt, {
    audience: "大学室友",
    purpose: "一起核对毕业旅行的记忆",
    counts: { sections: 2, items: 2, quotes: 1, transcripts: 1, media: 1 },
    boundary: SharePrivacy.RECEIPT_BOUNDARY
  }, "加密收据精确记录受众、用途、计数与不可撤回边界");
  deepEqual(Object.keys(reviewed.payload.shareReceipt).sort(), ["audience", "boundary", "counts", "purpose"], "分享收据没有额外元数据字段");
  deepEqual(source, sourceBefore, "创建和投影分享副本不会改写来源载荷");
  deepEqual(draft, draftBeforeProjection, "投影过程不会改写编辑草稿");

  const serialized = JSON.stringify(reviewed);
  for (const canary of Object.values(canaries)) {
    check(!serialized.includes(canary), `V2 分享物理排除隐私金丝雀：${canary.slice(0, 30)}`);
  }
  for (const forbiddenKey of ["contentUrl", "sha256", "assetId", "sourceId", "exportedAt"]) {
    check(!serialized.includes(`\"${forbiddenKey}\"`), `V2 分享不输出内部字段 ${forbiddenKey}`);
  }

  const empty = SharePrivacy.createShareDraft({ payload: source });
  empty.audience = "朋友";
  empty.purpose = "回看";
  throwsCode("SHARE_SELECTION_EMPTY", () => SharePrivacy.projectSharePayload(empty), "没有选择章节和展品时拒绝继续");
  const noEvidence = SharePrivacy.createShareDraft({ payload: source });
  noEvidence.audience = "朋友";
  noEvidence.purpose = "回看";
  noEvidence.sections[0].selected = true;
  noEvidence.sections[0].items[1].selected = true;
  throwsCode("SHARE_EVIDENCE_REQUIRED", () => SharePrivacy.projectSharePayload(noEvidence), "没有选择引用或文字稿时拒绝继续");
  const noAudience = clone(draft);
  noAudience.audience = "";
  throwsCode("SHARE_TEXT_INVALID", () => SharePrivacy.projectSharePayload(noAudience), "受众为空时拒绝继续");

  deepEqual(CapsuleCrypto.validateOfflinePayload(reviewed.payload), reviewed.payload, "V2 载荷通过严格密码学模块结构校验");
  return { ...reviewed, canaries };
}

function checkReviewedTampering(payload) {
  const cases = [
    ["收据计数", (value) => { value.shareReceipt.counts.items += 1; }],
    ["收据边界", (value) => { value.shareReceipt.boundary = "可以撤回"; }],
    ["额外内部字段", (value) => { value.internalId = "PRIVATE"; }],
    ["章节断号", (value) => { value.sections[1].key = "section-3"; }],
    ["展品断号", (value) => { value.sections[1].items[0].key = "item-9"; }],
    ["孤儿媒体", (value) => { value.media = []; }],
    ["媒体字节数", (value) => { value.media[0].byteSize += 1; }],
    ["媒体归属", (value) => { value.media[0].itemKey = "item-1"; }],
    ["最后一条文字证据", (value) => {
      value.sections.forEach((section) => section.items.forEach((item) => {
        item.confirmedQuotes = [];
        item.confirmedTranscripts = [];
      }));
      value.shareReceipt.counts.quotes = 0;
      value.shareReceipt.counts.transcripts = 0;
    }]
  ];
  for (const [label, mutate] of cases) {
    const changed = clone(payload);
    mutate(changed);
    throwsCode("CAPSULE_PAYLOAD_INVALID", () => CapsuleCrypto.validateOfflinePayload(changed), `V2 ${label}被篡改时拒绝载荷`);
  }
}

async function checkLegacyWhitespaceCompatibility(payload) {
  const legacy = clone(payload);
  legacy.title = "  旧版标题保留空白  ";
  legacy.sections[0].items[0].excerpt = " 旧版正文允许首尾空白\n";
  deepEqual(CapsuleCrypto.validateOfflinePayload(legacy), legacy, "V1 旧文件继续接受历史首尾空白文本");
  const envelope = await CapsuleCrypto.createEnvelope(legacy, PASSPHRASE, {
    title: "旧版时间胶囊",
    note: "兼容已经导出的 V1 文件。",
    opensAt: "2035-06-01T00:00:00.000Z"
  });
  deepEqual(await CapsuleCrypto.openEnvelope(envelope, PASSPHRASE), legacy, "V1 历史文本仍可完整加密并解密");
}

async function checkReviewedCrypto(reviewed) {
  const envelope = await CapsuleCrypto.createEnvelope(reviewed.payload, PASSPHRASE, reviewed.shell);
  deepEqual(envelope.shell, reviewed.shell, "V2 信封只公开编辑台确认后的通用外壳");
  equal(envelope.shell.opensAt, SharePrivacy.IMMEDIATE_OPEN_SENTINEL, "V2 信封固定立即开启而不近似导出时间");
  deepEqual(await CapsuleCrypto.openEnvelope(envelope, PASSPHRASE), reviewed.payload, "V2 分享可由正确口令完整解密");
  return envelope;
}

async function checkCrypto(payload) {
  const shell = {
    title: "2035 年的操场",
    note: "到约定的日子，再打开这场小展览。",
    opensAt: "2035-06-01T00:00:00.000Z"
  };
  const first = await CapsuleCrypto.createEnvelope(payload, PASSPHRASE, shell);
  const second = await CapsuleCrypto.encryptPayload(payload, PASSPHRASE, shell);
  equal(first.header.kdf.iterations, 310000, "PBKDF2 固定使用 310000 次迭代");
  equal(first.header.kdf.hash, "SHA-256", "PBKDF2 固定使用 SHA-256");
  equal(first.header.kdf.saltBytes, 16, "每次导出使用 16 字节盐");
  equal(first.header.cipher.name, "AES-GCM", "载荷使用 AES-GCM");
  equal(first.header.cipher.keyBits, 256, "AES 密钥长度固定为 256 位");
  equal(first.header.cipher.ivBytes, 12, "每次导出使用 12 字节 IV");
  equal(first.header.cipher.tagBits, 128, "GCM 认证标签固定为 128 位");
  equal(decodeBase64Url(first.salt).length, 16, "盐的实际字节长度正确");
  equal(decodeBase64Url(first.iv).length, 12, "IV 的实际字节长度正确");
  check(first.salt !== second.salt && first.iv !== second.iv && first.ciphertext !== second.ciphertext, "连续导出不会产生确定性密文");
  deepEqual(await CapsuleCrypto.openEnvelope(first, PASSPHRASE), payload, "正确口令完整解密真实生产载荷");
  deepEqual(await CapsuleCrypto.decryptPayload(second, PASSPHRASE), payload, "解密别名保持相同合同");
  check(!JSON.stringify(first).includes(PASSPHRASE), "加密信封不保存口令");
  deepEqual(CapsuleCrypto.validateEnvelope(first), first, "真实加密模块严格校验信封结构");

  await rejectsCode("CAPSULE_DECRYPT_FAILED", () => CapsuleCrypto.openEnvelope(first, OTHER_PASSPHRASE), "错误口令安全失败");
  await rejectsCode(
    "CAPSULE_DECRYPT_FAILED",
    () => CapsuleCrypto.openEnvelope({ ...first, ciphertext: flipBase64UrlByte(first.ciphertext) }, PASSPHRASE),
    "密文篡改时认证失败"
  );
  await rejectsCode(
    "CAPSULE_DECRYPT_FAILED",
    () => CapsuleCrypto.openEnvelope({ ...first, shell: { ...first.shell, note: "外壳已被改动" } }, PASSPHRASE),
    "作为 AAD 的公开外壳被篡改时认证失败"
  );
  assert.throws(
    () => CapsuleCrypto.validateEnvelope({ ...first, unexpected: true }),
    (error) => error?.code === "CAPSULE_ENVELOPE_INVALID"
  );
  assertions += 1;
  return first;
}

async function checkOfflineHtml(payload, envelope, fixture) {
  const html = CapsuleCrypto.createOfflineHtml(envelope);
  check(html.startsWith("<!doctype html>"), "真实浏览器模块生成完整单文件 HTML");
  check(html.includes("connect-src 'none'"), "离线 HTML CSP 禁止所有连接");
  check(html.includes("default-src 'none'"), "离线 HTML 默认拒绝所有资源来源");
  check(!/<(?:script|img|iframe|audio|video|source)\b[^>]*\bsrc\s*=/iu.test(html), "HTML 不含静态外部资源 src");
  const style = /<style>([\s\S]*?)<\/style>/iu.exec(html)?.[1] || "";
  check(!/<link\b/iu.test(html) && !/@import\b|url\s*\(/iu.test(style), "HTML 不含外部样式资源");
  check(!/gradient\s*\(/iu.test(style), "离线展览保持无渐变视觉规则");
  check(!/\bfetch\b|XMLHttpRequest|\bXHR\b|WebSocket|sendBeacon/iu.test(html), "HTML 不包含联网 API");
  check(!/localStorage|sessionStorage|indexedDB/iu.test(html), "HTML 不持久化口令或解密内容");
  check(!/\.innerHTML\b|insertAdjacentHTML|document\.write/iu.test(html), "解密内容只通过 textContent 渲染");
  check(html.includes("Date.now()<Date.parse(envelope.shell.opensAt)"), "开启日期前保持本地仪式门槛");
  check(html.includes('type="password"') && html.includes('minlength="12"'), "开启表单使用至少 12 字符口令");
  check(html.includes("URL.createObjectURL") && html.includes("URL.revokeObjectURL"), "图片 Blob URL 会及时回收");
  check(html.includes("item.confirmedQuotes") && html.includes('element("blockquote","quote",text)'), "确认引用只通过 textContent 渲染");
  check(html.includes("additionalData:aad") && html.includes("tagLength:128"), "离线解锁继续认证外壳与密码学头");
  assert.doesNotThrow(() => new Function(extractRuntimeScript(html)), "离线阅读器内联脚本保持有效 JavaScript");
  assertions += 1;
  check(!html.includes(PASSPHRASE), "单文件 HTML 不包含明文口令");
  check(!html.includes(payload.opening) && !html.includes(payload.sections[0].items[0].excerpt), "开启前 HTML 源码不包含展览正文");
  for (const canary of Object.values(fixture.canaries)) {
    check(!html.includes(canary), `单文件 HTML 排除隐私金丝雀：${canary.slice(0, 28)}`);
  }
  const embedded = extractEnvelope(html);
  deepEqual(embedded, envelope, "HTML 内嵌信封未发生序列化变形");
  deepEqual(await CapsuleCrypto.openEnvelope(embedded, PASSPHRASE), payload, "从最终 HTML 提取的信封可独立解密");
}

async function checkReviewedOfflineHtml(reviewed, envelope) {
  const html = CapsuleCrypto.createOfflineHtml(envelope);
  check(html.includes("这次分享的加密收据") && html.includes("renderReceipt(data)"), "V2 离线阅读器解密后呈现分享收据");
  check(html.includes("受众") && html.includes("用途") && html.includes("receipt-boundary"), "V2 阅读器包含收据三类说明位置");
  check(!html.includes(reviewed.payload.shareReceipt.audience) && !html.includes(reviewed.payload.shareReceipt.purpose), "V2 受众与用途在解密前不出现在 HTML 明文");
  check(!html.includes(reviewed.payload.title) && !html.includes(reviewed.payload.sections[0].items[0].title), "V2 加密叙事在开启前不出现在 HTML 明文");
  for (const canary of Object.values(reviewed.canaries)) {
    check(!html.includes(canary), `V2 单文件排除隐私金丝雀：${canary.slice(0, 30)}`);
  }
  const embedded = extractEnvelope(html);
  equal(embedded.shell.opensAt, SharePrivacy.IMMEDIATE_OPEN_SENTINEL, "最终 V2 HTML 使用固定立即开启哨兵");
  deepEqual(await CapsuleCrypto.openEnvelope(embedded, PASSPHRASE), reviewed.payload, "最终 V2 HTML 内嵌信封可独立解密");
}

async function checkAstralTextInOfflineRuntime(reviewed) {
  const payload = clone(reviewed.payload);
  payload.title = "记".repeat(1) + "😀".repeat(119);
  payload.media = [];
  payload.sections.forEach((section) => section.items.forEach((item) => { item.mediaKeys = []; }));
  payload.shareReceipt.counts.media = 0;
  equal(Array.from(payload.title).length, 120, "Astral Unicode 标题精确落在 120 码点边界");
  const envelope = await CapsuleCrypto.createEnvelope(payload, PASSPHRASE, reviewed.shell);
  const html = CapsuleCrypto.createOfflineHtml(envelope);
  const runtime = await executeOfflineRuntime(html, PASSPHRASE);
  equal(runtime.status, "", "离线运行时不会把合法 Astral Unicode 误报为坏文件或错误口令");
  equal(runtime.exhibitHidden, false, "离线运行时按 Unicode 码点接受 120 字符 V2 标题");
  const tooLong = clone(payload);
  tooLong.title += "😀";
  throwsCode("CAPSULE_PAYLOAD_INVALID", () => CapsuleCrypto.validateOfflinePayload(tooLong), "121 个 Unicode 码点仍被主验证器拒绝");
}

async function checkStaticSafety(envelope) {
  const root = path.resolve(__dirname, "..");
  const cryptoSource = fs.readFileSync(path.join(root, "public/assets/capsule-crypto.js"), "utf8");
  const capsulesSource = fs.readFileSync(path.join(root, "public/assets/capsules.js"), "utf8");
  const privacySource = fs.readFileSync(path.join(root, "public/assets/share-privacy.js"), "utf8");
  check(cryptoSource.includes("iterations: PBKDF2_ITERATIONS") && cryptoSource.includes("false, usages"), "派生 AES 密钥不可提取且使用固定参数");
  check(cryptoSource.includes("additionalData") && cryptoSource.includes("authenticatedBytes(header, safeShell)"), "加密阶段把 header 与 shell 作为 AAD");
  check(!/\bfetch\b|XMLHttpRequest|WebSocket|sendBeacon|localStorage|sessionStorage|indexedDB/iu.test(cryptoSource), "密码学模块无联网与持久化能力");
  for (const token of [
    "safeDisplayUrl(item.contentUrl)",
    'item.mimeType !== "image/webp"',
    "bytes.length !== item.byteSize",
    "hash !== item.sha256",
    "privacyModule.assembleLegacyPayload(material.snapshot, packedMedia)"
  ]) {
    check(capsulesSource.includes(token), `真实浏览器打包链保留安全检查：${token}`);
  }
  check(!/\bfetch\b|XMLHttpRequest|WebSocket|sendBeacon|localStorage|sessionStorage|indexedDB/iu.test(privacySource), "分享隐私模块没有联网或持久化能力");
  check(privacySource.includes("IMMEDIATE_OPEN_SENTINEL") && privacySource.includes("RECEIPT_BOUNDARY"), "分享隐私模块固定立即开启与不可撤回边界");

  const browserContext = vm.createContext({
    crypto: webcrypto,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    atob,
    btoa,
    envelopeText: JSON.stringify(envelope)
  });
  vm.runInContext(cryptoSource, browserContext, { filename: "capsule-crypto.browser.js" });
  equal(vm.runInContext("TimeIsleCapsuleCrypto.PBKDF2_ITERATIONS", browserContext), 310000, "UMD 浏览器分支暴露固定密码学合同");
  const browserHtml = vm.runInContext("TimeIsleCapsuleCrypto.createOfflineHtml(JSON.parse(envelopeText))", browserContext);
  check(browserHtml.startsWith("<!doctype html>") && browserHtml.includes("connect-src 'none'"), "UMD 浏览器分支可直接生成断网单文件");
}

function createFixture() {
  const canaries = {
    exhibitionId: "exhibition-internal-id-CANARY",
    sectionId: "section-db-id-CANARY",
    itemOneId: "exhibit-item-one-CANARY",
    itemTwoId: "exhibit-item-two-CANARY",
    memoryOne: "memory-private-one-CANARY",
    memoryTwo: "memory-private-two-CANARY",
    mediaId: "media-asset-private-CANARY",
    voiceId: "voice-asset-private-CANARY",
    rawContent: "RAW-private-memory-CANARY",
    agentRun: "agent-run-private-CANARY",
    originalName: "IMG-private-original-CANARY.jpg",
    mediaUrl: "/api/media/private-database-key-CANARY/display",
    mediaHash: "a".repeat(63) + "b",
    gps: "GPS-31.2304-121.4737-CANARY"
  };
  const allowedQuotes = ["那天风吹过旧操场。", "回程车票在灯下发亮。"];
  const allowedTranscript = "我记得雨停以后，操场很安静。";
  const allowedCaption = "只保留安全展示图的说明。";
  const exhibition = {
    id: canaries.exhibitionId,
    title: "夏日的操场",
    theme: "重逢",
    opening: "两段经过确认的记忆。",
    status: "published",
    needsReview: false,
    requiresConfirmation: false,
    rawContent: canaries.rawContent,
    agentRunId: canaries.agentRun,
    sections: [{
      id: canaries.sectionId,
      title: "第一章",
      summary: "从操场开始。",
      items: [{
        id: canaries.itemOneId,
        memoryId: canaries.memoryOne,
        title: "旧操场",
        excerpt: "雨停后的傍晚。",
        curatorNote: "只保留适合展示的叙事。",
        rawContent: canaries.rawContent,
        citations: [{ id: "citation-one-CANARY", quote: allowedQuotes[0], evidenceValid: true }]
      }, {
        id: canaries.itemTwoId,
        memoryId: canaries.memoryTwo,
        title: "回程车票",
        excerpt: "夜里回家。",
        curatorNote: "第二件展品。",
        citations: [{ id: "citation-two-CANARY", quote: allowedQuotes[1], evidenceValid: true }]
      }]
    }]
  };
  const media = [{
    assetId: canaries.mediaId,
    memoryId: canaries.memoryOne,
    itemId: canaries.itemOneId,
    selected: true,
    status: "ready",
    position: 0,
    altText: "操场照片",
    caption: allowedCaption,
    variant: {
      kind: "display",
      mimeType: "image/webp",
      width: 320,
      height: 180,
      byteSize: 30,
      sha256: canaries.mediaHash,
      originalName: canaries.originalName,
      gps: canaries.gps
    }
  }];
  const transcripts = [{
    assetId: canaries.voiceId,
    memoryId: canaries.memoryOne,
    itemId: canaries.itemOneId,
    status: "confirmed",
    language: "zh-CN",
    text: allowedTranscript
  }];
  return {
    canaries,
    exhibition,
    media,
    transcripts,
    allowedQuotes,
    allowedTranscript,
    allowedCaption,
    webp: createVp8xWebp(320, 180)
  };
}

function createVp8xWebp(width, height) {
  const bytes = Buffer.alloc(30);
  bytes.write("RIFF", 0, "ascii");
  bytes.writeUInt32LE(22, 4);
  bytes.write("WEBP", 8, "ascii");
  bytes.write("VP8X", 12, "ascii");
  bytes.writeUInt32LE(10, 16);
  bytes.writeUIntLE(width - 1, 24, 3);
  bytes.writeUIntLE(height - 1, 27, 3);
  return bytes;
}

function extractEnvelope(html) {
  const match = /<script type="application\/json" id="capsuleEnvelope">([\s\S]*?)<\/script>/u.exec(html);
  if (!match) throw new Error("offline envelope not found");
  return JSON.parse(match[1]);
}

function extractRuntimeScript(html) {
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/giu)];
  const runtime = scripts.find((match) => !/application\/json/iu.test(match[0]));
  if (!runtime) throw new Error("offline runtime not found");
  return runtime[1];
}

async function executeOfflineRuntime(html, passphrase) {
  const envelope = extractEnvelope(html);
  const nodes = new Map();
  const createNode = (id = "") => {
    const listeners = new Map();
    return {
      id,
      textContent: "",
      className: "",
      hidden: id === "unlockForm" || id === "exhibit",
      value: id === "passphrase" ? passphrase : "",
      disabled: false,
      children: [],
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = [...children]; },
      addEventListener(type, handler) { listeners.set(type, handler); },
      focus() { this.focused = true; },
      listener(type) { return listeners.get(type); }
    };
  };
  for (const id of ["capsuleEnvelope", "shellTitle", "shellNote", "dateGate", "opensAt", "unlockForm", "passphrase", "unlockButton", "unlockStatus", "exhibit"]) {
    nodes.set(id, createNode(id));
  }
  nodes.get("capsuleEnvelope").textContent = JSON.stringify(envelope);
  const documentRef = {
    getElementById(id) { return nodes.get(id); },
    createElement() { return createNode(); }
  };
  const windowRef = { addEventListener() {}, setInterval() { return 0; } };
  const context = vm.createContext({
    document: documentRef,
    window: windowRef,
    crypto: webcrypto,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    Blob,
    URL: { createObjectURL: () => "blob:test", revokeObjectURL() {} },
    Intl,
    Date,
    atob,
    btoa
  });
  vm.runInContext(extractRuntimeScript(html), context, { filename: "offline-runtime.js" });
  const submit = nodes.get("unlockForm").listener("submit");
  if (typeof submit !== "function") throw new Error("offline submit handler not found");
  await submit({ preventDefault() {} });
  return {
    status: nodes.get("unlockStatus").textContent,
    exhibitHidden: nodes.get("exhibit").hidden
  };
}

function decodeBase64Url(value) {
  return Buffer.from(value.replace(/-/gu, "+").replace(/_/gu, "/"), "base64");
}

function flipBase64UrlByte(value) {
  const bytes = decodeBase64Url(value);
  bytes[0] ^= 1;
  return bytes.toString("base64url");
}

function check(condition, message) {
  assertions += 1;
  assert.ok(condition, message);
}

function equal(actual, expected, message) {
  assertions += 1;
  assert.equal(actual, expected, message);
}

function deepEqual(actual, expected, message) {
  assertions += 1;
  assert.deepEqual(actual, expected, message);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function throwsCode(code, operation, message) {
  assertions += 1;
  assert.throws(operation, (error) => error?.code === code, message);
}

async function rejectsCode(code, operation, message) {
  assertions += 1;
  await assert.rejects(operation, (error) => error?.code === code, message);
}
