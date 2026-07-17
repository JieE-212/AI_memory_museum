"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const {
  createArchive,
  createArchiveFile,
  extractArchive
} = require("../lib/time-isle-archive");
const {
  buildMediaArchive,
  buildMediaArchiveFile
} = require("../lib/media-backup");

require("../public/assets/portability");

let assertions = 0;

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "time-isle-stream-check-"));
  const isolatedTemp = path.join(root, "isolated-temp");
  const previousTemp = { TEMP: process.env.TEMP, TMP: process.env.TMP, TMPDIR: process.env.TMPDIR };
  fs.mkdirSync(isolatedTemp, { mode: 0o700 });
  process.env.TEMP = isolatedTemp;
  process.env.TMP = isolatedTemp;
  process.env.TMPDIR = isolatedTemp;
  try {
    await checkDeterministicFileArchive(root);
    await checkTwoPassExtraction(root);
    await checkMediaArchiveDescriptor(root);
    await checkPortabilityStreaming();
  } finally {
    restoreEnvironment(previousTemp);
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log(`Archive stream checks passed: ${assertions} assertions.`);
}

async function checkDeterministicFileArchive(root) {
  const sourcePath = path.join(root, "source.bin");
  const source = Buffer.alloc(2 * 1024 * 1024 + 37);
  for (let index = 0; index < source.length; index += 1) source[index] = index % 251;
  fs.writeFileSync(sourcePath, source, { mode: 0o600 });
  const metadata = Buffer.from('{"kind":"stream-check"}\n', "utf8");
  const entries = [
    { path: "data/source.bin", filePath: sourcePath, size: source.length, sha256: digest(source), mtime: 0 },
    { path: "metadata.json", data: metadata, mtime: 0 }
  ];
  const legacy = createArchive([
    { path: "data/source.bin", data: source, mtime: 0 },
    { path: "metadata.json", data: metadata, mtime: 0 }
  ]);
  const outputPath = path.join(root, "streamed.time-isle");
  const descriptor = await createArchiveFile(entries, { outputPath });
  equal(descriptor.path, outputPath, "流式归档返回明确输出路径");
  equal(descriptor.length, fs.statSync(outputPath).size, "流式归档返回真实压缩字节数");
  deepEqual(fs.readFileSync(outputPath), legacy, "流式 gzip 与旧确定性格式逐字节兼容");
  await descriptor.cleanup();
  await descriptor.cleanup();
  check(!fs.existsSync(outputPath), "归档描述符清理幂等删除输出文件");

  const mismatchPath = path.join(root, "hash-mismatch.time-isle");
  await rejectsCode(
    "ARCHIVE_SOURCE_CHANGED",
    () => createArchiveFile([{ ...entries[0], sha256: "0".repeat(64) }], { outputPath: mismatchPath }),
    "流式归档拒绝源文件哈希在打包前后不一致"
  );
  check(!fs.existsSync(mismatchPath), "源文件验真失败不残留部分归档");

  const abortedPath = path.join(root, "aborted.time-isle");
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => createArchiveFile(entries, { outputPath: abortedPath, signal: controller.signal }),
    (error) => error?.name === "AbortError"
  );
  assertions += 1;
  check(!fs.existsSync(abortedPath), "中止流式归档不残留输出文件");
}

async function checkTwoPassExtraction(root) {
  const archive = createArchive([
    { path: "first.txt", data: "first" },
    { path: "second.txt", data: "second" }
  ]);
  const chunks = [archive.subarray(0, 11), archive.subarray(11, 97), archive.subarray(97)];
  let consumed = 0;
  async function* source() {
    for (const chunk of chunks) {
      consumed += 1;
      yield chunk;
    }
  }
  const stagingRoot = path.join(root, "two-pass-success");
  const before = temporaryExtractDirectories();
  const result = await extractArchive(source(), { stagingRoot });
  equal(consumed, chunks.length, "不可重放输入只消费一次并安全落盘供两遍扫描");
  equal(result.entries.length, 2, "两遍流式恢复保留全部条目");
  equal(fs.readFileSync(path.join(stagingRoot, "second.txt"), "utf8"), "second", "第二遍写入正确文件内容");
  deepEqual(temporaryExtractDirectories(), before, "成功恢复清理压缩输入临时目录");

  const flatRoot = path.join(root, "two-pass-flat");
  const flatResult = await extractArchive(archive, { stagingRoot: flatRoot, layout: "flat" });
  deepEqual(flatResult.entries.map((entry) => entry.path), ["first.txt", "second.txt"], "扁平 staging 保留归档逻辑路径");
  check(flatResult.entries.every((entry) => path.dirname(entry.filePath) === flatRoot), "扁平 staging 仅在随机根目录直接写文件");
  check(flatResult.entries.every((entry) => /^\.entry-\d{6}-[a-f0-9]{16}\.bin$/u.test(path.basename(entry.filePath))), "扁平 staging 文件名完全由程序生成");
  equal(fs.readFileSync(flatResult.entries[0].filePath, "utf8"), "first", "扁平 staging 返回可直接消费的真实文件路径");

  const corrupted = corruptSecondHeader(archive);
  const rejectedRoot = path.join(root, "two-pass-rejected");
  await rejectsCode(
    "ARCHIVE_CHECKSUM_INVALID",
    () => extractArchive((async function* () { yield corrupted; })(), { stagingRoot: rejectedRoot }),
    "第一遍在后续条目损坏时拒绝整包"
  );
  check(!fs.existsSync(rejectedRoot), "第一遍验真失败前不创建任何归档输出目录");
  deepEqual(temporaryExtractDirectories(), before, "失败恢复同样清理压缩输入临时目录");

  const trailingCases = [
    [Buffer.concat([archive, Buffer.alloc(512)]), "拒绝 gzip member 后追加原始零字节"],
    [Buffer.concat([archive, zlib.gzipSync(Buffer.alloc(0), { level: 9, mtime: 0 })]), "拒绝串联空 gzip member"],
    [Buffer.concat([archive, zlib.gzipSync(Buffer.alloc(512), { level: 9, mtime: 0 })]), "拒绝串联含零数据的 gzip member"]
  ];
  for (let index = 0; index < trailingCases.length; index += 1) {
    const [candidate, message] = trailingCases[index];
    await rejectsCode(
      "ARCHIVE_GZIP_INVALID",
      () => extractArchive(candidate, { stagingRoot: path.join(root, `gzip-trailing-${index}`) }),
      message
    );
  }

  const invalidCrc = Buffer.from(archive);
  invalidCrc[invalidCrc.length - 8] ^= 1;
  await rejectsCode(
    "ARCHIVE_GZIP_INVALID",
    () => extractArchive(invalidCrc, { stagingRoot: path.join(root, "gzip-invalid-crc") }),
    "拒绝 gzip trailer CRC32 篡改"
  );
  const invalidSize = Buffer.from(archive);
  invalidSize[invalidSize.length - 4] ^= 1;
  await rejectsCode(
    "ARCHIVE_GZIP_INVALID",
    () => extractArchive(invalidSize, { stagingRoot: path.join(root, "gzip-invalid-size") }),
    "拒绝 gzip trailer ISIZE 篡改"
  );

  const tar = zlib.gunzipSync(archive);
  const nonZeroTail = Buffer.alloc(512);
  nonZeroTail[0] = 1;
  await rejectsCode(
    "ARCHIVE_TRAILING_DATA",
    () => extractArchive(zlib.gzipSync(Buffer.concat([tar, nonZeroTail]), { level: 9, mtime: 0 }), {
      stagingRoot: path.join(root, "tar-non-zero-tail")
    }),
    "拒绝 tar 结束标记后的非零数据"
  );
  await rejectsCode(
    "ARCHIVE_TRUNCATED",
    () => extractArchive(zlib.gzipSync(Buffer.concat([tar, Buffer.alloc(1)]), { level: 9, mtime: 0 }), {
      stagingRoot: path.join(root, "tar-misaligned-tail")
    }),
    "拒绝 tar 结束标记后的非块对齐数据"
  );
}

async function checkMediaArchiveDescriptor(root) {
  const collection = redactedCollection();
  const legacy = buildMediaArchive({ collection, appVersion: "4.0.0", schemaVersion: 4 });
  const descriptor = await buildMediaArchiveFile({
    collection,
    appVersion: "4.0.0",
    schemaVersion: 4,
    outputRoot: root
  });
  check(path.isAbsolute(descriptor.path), "媒体流式导出返回绝对临时文件路径");
  equal(descriptor.length, fs.statSync(descriptor.path).size, "媒体流式导出长度可供 HTTP Content-Length 使用");
  deepEqual(fs.readFileSync(descriptor.path), legacy, "媒体流式导出保持现有 .time-isle 字节格式");
  const ownedRoot = path.dirname(descriptor.path);
  await descriptor.cleanup();
  await descriptor.cleanup();
  check(!fs.existsSync(ownedRoot), "媒体导出 cleanup 幂等清理私有临时目录");

  const fixture = mediaFixture(root);
  const fullOptions = {
    collection: fixture.collection,
    store: fixture.store,
    storage: fixture.storage,
    appVersion: "4.0.0",
    schemaVersion: 4
  };
  const fullLegacy = buildMediaArchive(fullOptions);
  const fullDescriptor = await buildMediaArchiveFile({ ...fullOptions, outputRoot: root });
  deepEqual(fs.readFileSync(fullDescriptor.path), fullLegacy, "真实媒体文件描述符保持旧归档确定性字节格式");
  await fullDescriptor.cleanup();

  const beforeFailure = exportDirectories(root);
  await assert.rejects(
    () => buildMediaArchiveFile({
      collection: { ...redactedCollection(), memories: "invalid" },
      appVersion: "4.0.0",
      schemaVersion: 4,
      outputRoot: root
    }),
    (error) => String(error?.code || "").startsWith("MEDIA_ARCHIVE_")
  );
  assertions += 1;
  deepEqual(exportDirectories(root), beforeFailure, "媒体导出校验失败清理私有临时目录");
}

async function checkPortabilityStreaming() {
  const source = fs.readFileSync(path.join(__dirname, "..", "public", "assets", "portability.js"), "utf8");
  check(!/response\.blob\s*\(/u.test(source), "浏览器导出不再调用 response.blob");
  check(!/createObjectURL|new\s+Blob/u.test(source), "浏览器导出不再创建整包 Blob URL");
  check(source.includes("response.body.pipeTo(writable"), "支持环境把响应流直接写入用户选择的文件");

  const streamedDocument = fakeDocument();
  let piped = false;
  let fetched = "";
  const writable = { abort: async () => {} };
  const controller = globalThis.TimeIslePortability.createController({
    document: streamedDocument.document,
    showSaveFilePicker: async () => ({ createWritable: async () => writable }),
    fetch: async (url) => {
      fetched = url;
      return {
        ok: true,
        body: { pipeTo: async (target) => { equal(target, writable, "响应流写入选中的文件句柄"); piped = true; } }
      };
    }
  });
  await controller.exportArchive("full");
  equal(fetched, "/api/archive/export", "文件系统访问路径请求现有导出接口");
  check(piped, "文件系统访问路径完成流式写入");
  controller.destroy();

  const fallbackDocument = fakeDocument();
  const fallback = globalThis.TimeIslePortability.createController({
    document: fallbackDocument.document,
    fetch: async () => { throw new Error("native download fallback must not fetch into JavaScript"); }
  });
  await fallback.exportArchive("redacted");
  equal(fallbackDocument.anchor.href, "/api/archive/export?mode=redacted", "兼容浏览器交给原生下载器流式接收");
  check(fallbackDocument.anchor.clicked, "兼容浏览器触发原生下载而非内存聚合");
  fallback.destroy();

  const streamlessDocument = fakeDocument();
  let streamlessAborted = false;
  const streamless = globalThis.TimeIslePortability.createController({
    document: streamlessDocument.document,
    showSaveFilePicker: async () => ({
      createWritable: async () => ({ abort: async () => { streamlessAborted = true; } })
    }),
    fetch: async () => ({ ok: true, body: null })
  });
  await streamless.exportArchive("full");
  check(streamlessAborted, "文件句柄可用但响应流不可用时中止未完成写入");
  equal(streamlessDocument.anchor.href, "/api/archive/export", "响应流不可用时改交浏览器原生下载");
  check(streamlessDocument.anchor.clicked, "响应流不可用时不在 JavaScript 内聚合归档");
  streamless.destroy();
}

function redactedCollection() {
  return {
    product: "时屿",
    version: "4.0.0",
    schemaVersion: 4,
    mode: "redacted",
    exportedAt: "2026-07-12T12:00:00.000Z",
    memories: [{
      id: "memory-stream-check",
      title: "流式归档",
      rawContent: "[已隐藏原始记忆]",
      attachments: [],
      media: []
    }],
    archaeology: { mode: "redacted", events: [], claims: [], pairDecisions: [], questions: [] }
  };
}

function mediaFixture(root) {
  const mediaRoot = path.join(root, "media-source");
  const display = createWebp(320, 180);
  const thumb = createWebp(120, 80);
  const files = {
    "assets/display.webp": display,
    "assets/thumb.webp": thumb
  };
  for (const [storageKey, data] of Object.entries(files)) {
    const filePath = path.join(mediaRoot, ...storageKey.split("/"));
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, data, { mode: 0o600 });
  }
  const asset = {
    id: "asset-stream-photo",
    schemaVersion: 4,
    contentSha256: digest(display),
    originalName: "safe.webp",
    sourceMimeType: "image/webp",
    sourceByteSize: display.length,
    width: 320,
    height: 180,
    storageDriver: "local",
    privacyMode: "sanitized_only",
    status: "ready",
    safeMetadata: { canonicalVariant: "display", coordinateSpace: "canonical-preview-v1" },
    createdAt: "2026-07-12T10:00:00.000Z",
    updatedAt: "2026-07-12T10:00:00.000Z"
  };
  const variants = [
    mediaVariant(asset.id, "display", "assets/display.webp", display, 320, 180),
    mediaVariant(asset.id, "thumb", "assets/thumb.webp", thumb, 120, 80)
  ];
  asset.variants = variants;
  const link = {
    memoryId: "memory-stream-media",
    assetId: asset.id,
    role: "cover",
    position: 0,
    caption: "安全展示图",
    altText: "虚构测试照片",
    backNote: "",
    metadata: {},
    createdAt: "2026-07-12T10:05:00.000Z",
    updatedAt: "2026-07-12T10:05:00.000Z"
  };
  const store = {
    listMediaForMemory(memoryId) { return memoryId === link.memoryId ? [{ ...link, asset, variants }] : []; },
    getMediaAsset(assetId) { return assetId === asset.id ? asset : null; },
    listMediaVariants(assetId) { return assetId === asset.id ? variants : []; },
    listMediaObservations() { return []; }
  };
  const storage = {
    resolveStorageKey(storageKey) { return path.join(mediaRoot, ...String(storageKey).split("/")); }
  };
  return {
    store,
    storage,
    collection: {
      product: "时屿",
      version: "4.0.0",
      schemaVersion: 4,
      mode: "full",
      exportedAt: "2026-07-12T12:00:00.000Z",
      memories: [{ id: link.memoryId, title: "流式图片", rawContent: "虚构图片记忆。", media: [{ assetId: asset.id }] }],
      archaeology: { mode: "full", events: [], claims: [], pairDecisions: [], questions: [] }
    }
  };
}

function mediaVariant(assetId, kind, storageKey, data, width, height) {
  return {
    assetId,
    kind,
    storageKey,
    mimeType: "image/webp",
    byteSize: data.length,
    width,
    height,
    sha256: digest(data),
    createdAt: "2026-07-12T10:00:00.000Z",
    updatedAt: "2026-07-12T10:00:00.000Z"
  };
}

function createWebp(width, height) {
  const frame = Buffer.alloc(10);
  frame[3] = 0x9d;
  frame[4] = 0x01;
  frame[5] = 0x2a;
  frame.writeUInt16LE(width, 6);
  frame.writeUInt16LE(height, 8);
  const chunk = Buffer.alloc(18);
  chunk.write("VP8 ", 0, 4, "ascii");
  chunk.writeUInt32LE(frame.length, 4);
  frame.copy(chunk, 8);
  const body = Buffer.concat([Buffer.from("WEBP", "ascii"), chunk]);
  const header = Buffer.alloc(8);
  header.write("RIFF", 0, 4, "ascii");
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

function fakeDocument() {
  const element = () => ({
    disabled: false,
    textContent: "",
    id: "",
    previousElementSibling: { classList: { toggle() {} }, setAttribute() {}, title: "" },
    classList: { toggle() {} },
    setAttribute() {},
    addEventListener() {},
    removeEventListener() {}
  });
  const elements = {
    "#exportButton": element(),
    "#exportRedactedButton": element(),
    "#archiveImportFile": element(),
    "#dataActionStatus": element()
  };
  const anchor = { href: "", download: "", clicked: false, click() { this.clicked = true; }, remove() {} };
  return {
    anchor,
    document: {
      querySelector(selector) { return elements[selector] || null; },
      querySelectorAll() { return [element()]; },
      createElement(name) { if (name !== "a") throw new Error("unexpected element"); return anchor; },
      body: { appendChild() {} }
    }
  };
}

function corruptSecondHeader(archive) {
  const tar = zlib.gunzipSync(archive);
  const secondOffset = 1024;
  tar[secondOffset] ^= 1;
  return zlib.gzipSync(tar, { level: 9, mtime: 0 });
}

function temporaryExtractDirectories() {
  return fs.readdirSync(os.tmpdir())
    .filter((name) => name.startsWith("time-isle-extract-"))
    .sort();
}

function exportDirectories(root) {
  return fs.readdirSync(root)
    .filter((name) => name.startsWith("time-isle-export-"))
    .sort();
}

function restoreEnvironment(previous) {
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

function digest(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function check(value, message) {
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

async function rejectsCode(code, operation, message) {
  assertions += 1;
  await assert.rejects(operation, (error) => error?.code === code, message);
}
