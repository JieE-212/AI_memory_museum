"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const { buildSafeSnapshot, validateSafeSnapshot } = require("../lib/capsule-service");
const CapsuleCrypto = require("../public/assets/capsule-crypto");

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
  const payload = checkProductionPayload(fixture);
  const envelope = await checkCrypto(payload);
  await checkOfflineHtml(payload, envelope, fixture);
  await checkStaticSafety(envelope);
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
  check(!html.includes(PASSPHRASE), "单文件 HTML 不包含明文口令");
  check(!html.includes(payload.opening) && !html.includes(payload.sections[0].items[0].excerpt), "开启前 HTML 源码不包含展览正文");
  for (const canary of Object.values(fixture.canaries)) {
    check(!html.includes(canary), `单文件 HTML 排除隐私金丝雀：${canary.slice(0, 28)}`);
  }
  const embedded = extractEnvelope(html);
  deepEqual(embedded, envelope, "HTML 内嵌信封未发生序列化变形");
  deepEqual(await CapsuleCrypto.openEnvelope(embedded, PASSPHRASE), payload, "从最终 HTML 提取的信封可独立解密");
}

async function checkStaticSafety(envelope) {
  const root = path.resolve(__dirname, "..");
  const cryptoSource = fs.readFileSync(path.join(root, "public/assets/capsule-crypto.js"), "utf8");
  const capsulesSource = fs.readFileSync(path.join(root, "public/assets/capsules.js"), "utf8");
  check(cryptoSource.includes("iterations: PBKDF2_ITERATIONS") && cryptoSource.includes("false, usages"), "派生 AES 密钥不可提取且使用固定参数");
  check(cryptoSource.includes("additionalData") && cryptoSource.includes("authenticatedBytes(header, safeShell)"), "加密阶段把 header 与 shell 作为 AAD");
  check(!/\bfetch\b|XMLHttpRequest|WebSocket|sendBeacon|localStorage|sessionStorage|indexedDB/iu.test(cryptoSource), "密码学模块无联网与持久化能力");
  for (const token of [
    "safeDisplayUrl(item.contentUrl)",
    'item.mimeType !== "image/webp"',
    "bytes.length !== item.byteSize",
    "hash !== item.sha256",
    "assembleOfflinePayload(material.snapshot, packedMedia)"
  ]) {
    check(capsulesSource.includes(token), `真实浏览器打包链保留安全检查：${token}`);
  }

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

async function rejectsCode(code, operation, message) {
  assertions += 1;
  await assert.rejects(operation, (error) => error?.code === code, message);
}
