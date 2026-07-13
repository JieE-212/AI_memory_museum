"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { createArchive, extractArchive } = require("../lib/time-isle-archive");
const {
  buildMediaArchive,
  prepareMediaArchive,
  ARCHIVE_FORMAT,
  ARCHIVE_FORMAT_VERSION,
  ARCHIVE_PATHS
} = require("../lib/media-backup");
const { MEDIA_ARCHIVE_LIMITS } = require("../lib/media-policy");

let assertions = 0;

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "time-isle-media-backup-check-"));
  let failure = null;
  try {
    await runChecks(temporaryRoot);
  } catch (error) {
    failure = error;
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
  if (failure) throw failure;
  equal(fs.existsSync(temporaryRoot), false, "测试完成后应清理全部临时归档和图片文件");
  console.log(`Media backup checks passed: ${assertions} assertions.`);
}

async function runChecks(temporaryRoot) {
  const fixture = createFixture(temporaryRoot);
  const collection = {
    product: "时屿",
    productEnglish: "TIME ISLE",
    version: "4.0.0",
    schemaVersion: 4,
    mode: "full",
    exportedAt: "2026-07-12T12:00:00.000Z",
    count: 2,
    memories: [
      { id: "memory-one", title: "旧操场", rawContent: "那天我们绕着操场散步。", media: [{ assetId: fixture.asset.id }] },
      { id: "memory-two", title: "后来重返", rawContent: "多年后又回到同一个地方。", media: [{ assetId: fixture.asset.id }] }
    ],
    archaeology: { mode: "full", events: [], claims: [], pairDecisions: [], questions: [] }
  };

  const archive = buildMediaArchive({
    collection,
    store: fixture.store,
    storage: fixture.storage,
    appVersion: "4.0.0",
    schemaVersion: 4
  });
  check(Buffer.isBuffer(archive), "buildMediaArchive 应返回 Buffer");
  deepEqual(archive.subarray(0, 2), Buffer.from([0x1f, 0x8b]), ".time-isle 应使用 gzip 封装");

  const roundTripRoot = path.join(temporaryRoot, "roundtrip");
  const prepared = await prepareMediaArchive(archive, {
    stagingRoot: roundTripRoot,
    limits: { maxEntries: 20, maxEntryBytes: 1024 * 1024, maxTotalBytes: 4 * 1024 * 1024 }
  });
  equal(prepared.verified, true, "完整归档应在全量验证后返回 verified descriptor");
  equal(prepared.manifest.format, ARCHIVE_FORMAT, "manifest 应声明媒体归档格式");
  equal(prepared.collection.memories.length, 2, "馆藏 JSON 应完整回环");
  equal(prepared.assets.length, 1, "共享图片应只归档一份资产元数据");
  equal(prepared.links.length, 2, "共享图片应保留两个馆藏内关联");
  equal(prepared.mediaObservations.length, 1, "只应保留当前馆藏边界内的图片观察");
  equal(prepared.mediaObservations[0].metadata.memoryId, "memory-one", "图片观察应保留合法的展品归属");
  equal(prepared.files.variants.length, 3, "保留原图模式应返回 original/display/thumb 三个已验证文件路径");
  check(prepared.files.variants.every((item) => path.isAbsolute(item.filePath) && fs.existsSync(item.filePath)), "恢复 descriptor 应提供可读取的绝对暂存路径");
  check(prepared.assets[0].variants.every((variant) => !Object.hasOwn(variant, "storageKey")), "归档不能泄漏原机器 storageKey");
  deepEqual(
    fs.readFileSync(prepared.files.variants.find((item) => item.kind === "original").filePath),
    fixture.original,
    "原图字节应无损回环"
  );
  check(prepared.manifest.entries.every((entry) => /^[a-f0-9]{64}$/.test(entry.sha256) && Number.isSafeInteger(entry.bytes) && entry.mime), "manifest 应为每个业务条目记录哈希、字节数和 MIME");

  const pristineEntries = await readArchiveEntries(archive, path.join(temporaryRoot, "unpack-pristine"));
  const imagePath = prepared.assets[0].variants.find((variant) => variant.kind === "display").archivePath;

  const corruptedEntries = cloneEntries(pristineEntries);
  const corruptedImage = Buffer.from(corruptedEntries.get(imagePath));
  corruptedImage[corruptedImage.length - 1] ^= 0x01;
  corruptedEntries.set(imagePath, corruptedImage);
  const corruptedRoot = path.join(temporaryRoot, "reject-corrupt-hash");
  fs.mkdirSync(corruptedRoot);
  await rejectsCode(
    "MEDIA_ARCHIVE_HASH_MISMATCH",
    () => prepareMediaArchive(repack(corruptedEntries), { stagingRoot: corruptedRoot }),
    "图片被篡改时必须在返回 descriptor 前拒绝"
  );
  deepEqual(fs.readdirSync(corruptedRoot), [], "调用方预先创建的空暂存目录在拒绝后应恢复为空目录");

  const missingEntries = cloneEntries(pristineEntries);
  missingEntries.delete(imagePath);
  const missingRoot = path.join(temporaryRoot, "reject-missing-entry");
  await rejectsCode(
    "MEDIA_ARCHIVE_ENTRY_MISSING",
    () => prepareMediaArchive(repack(missingEntries), { stagingRoot: missingRoot }),
    "manifest 声明但实际缺失的图片必须被拒绝"
  );
  equal(fs.existsSync(missingRoot), false, "缺条目归档被拒绝后不能残留暂存文件");

  const unauthorizedEntries = cloneEntries(pristineEntries);
  const unauthorizedLinks = parseJson(unauthorizedEntries.get(ARCHIVE_PATHS.links));
  unauthorizedLinks[0].memoryId = "memory-outside";
  replaceJsonAndRefreshManifest(unauthorizedEntries, ARCHIVE_PATHS.links, unauthorizedLinks);
  const unauthorizedRoot = path.join(temporaryRoot, "reject-unauthorized-link");
  await rejectsCode(
    "MEDIA_ARCHIVE_REFERENCE_FORBIDDEN",
    () => prepareMediaArchive(repack(unauthorizedEntries), { stagingRoot: unauthorizedRoot }),
    "指向馆藏外记忆的媒体关联必须被拒绝"
  );
  equal(fs.existsSync(unauthorizedRoot), false, "越权引用归档被拒绝后不能残留暂存文件");

  const mimeEntries = cloneEntries(pristineEntries);
  const mimeManifest = parseJson(mimeEntries.get(ARCHIVE_PATHS.manifest));
  mimeManifest.entries.find((entry) => entry.path === imagePath).mime = "image/png";
  mimeEntries.set(ARCHIVE_PATHS.manifest, jsonBuffer(mimeManifest));
  const mimeRoot = path.join(temporaryRoot, "reject-mime");
  await rejectsCode(
    "MEDIA_ARCHIVE_MIME_MISMATCH",
    () => prepareMediaArchive(repack(mimeEntries), { stagingRoot: mimeRoot }),
    "manifest MIME 与图片真实格式不一致时必须被拒绝"
  );
  equal(fs.existsSync(mimeRoot), false, "伪造 MIME 归档被拒绝后不能残留暂存文件");

  await checkObservationPrivacy(temporaryRoot, fixture, collection, pristineEntries);
  await checkArchiveLimits(temporaryRoot, fixture, collection);
  await checkRedactedArchive(temporaryRoot, collection);
}

async function checkArchiveLimits(temporaryRoot, fixture, fullCollection) {
  const fiveHundred = boundaryCollection(MEDIA_ARCHIVE_LIMITS.maxMemories);
  const fiveHundredArchive = buildMediaArchive({
    collection: fiveHundred,
    appVersion: "4.0.0",
    schemaVersion: 4
  });
  check(Buffer.isBuffer(fiveHundredArchive), "默认导出上限应接受恰好 500 件展品");
  const fiveHundredPrepared = await prepareMediaArchive(fiveHundredArchive, {
    stagingRoot: path.join(temporaryRoot, "roundtrip-500")
  });
  equal(fiveHundredPrepared.collection.memories.length, 500, "默认 prepare 上限应接受恰好 500 件展品");

  const fiveHundredOne = boundaryCollection(MEDIA_ARCHIVE_LIMITS.maxMemories + 1);
  throwsCode(
    "MEDIA_ARCHIVE_LIMIT_EXCEEDED",
    () => buildMediaArchive({ collection: fiveHundredOne, appVersion: "4.0.0", schemaVersion: 4 }),
    "默认导出必须在打包前拒绝第 501 件展品"
  );
  throwsCode(
    "MEDIA_ARCHIVE_VALUE_INVALID",
    () => buildMediaArchive({
      collection: fiveHundred,
      appVersion: "4.0.0",
      schemaVersion: 4,
      limits: { maxMemories: 501 }
    }),
    "调用者不能抬高共享发布上限制造默认不可恢复的归档"
  );
  const permissiveArchive = createUncheckedRedactedArchive(fiveHundredOne);
  const rejected501Root = path.join(temporaryRoot, "reject-prepare-501");
  await rejectsCode(
    "MEDIA_ARCHIVE_LIMIT_EXCEEDED",
    () => prepareMediaArchive(permissiveArchive, { stagingRoot: rejected501Root }),
    "默认 prepare 必须拒绝包含 501 件展品的自校验归档"
  );
  equal(fs.existsSync(rejected501Root), false, "501 件归档被拒绝后不应残留暂存目录");

  for (const [name, value, message] of [
    ["maxAssets", 0, "导出前应拒绝超限媒体资产"],
    ["maxLinks", 1, "导出前应拒绝超限媒体关联"],
    ["maxObservations", 0, "导出前应拒绝超限图片线索"]
  ]) {
    throwsCode(
      "MEDIA_ARCHIVE_LIMIT_EXCEEDED",
      () => buildMediaArchive({
        collection: fullCollection,
        store: fixture.store,
        storage: fixture.storage,
        appVersion: "4.0.0",
        schemaVersion: 4,
        limits: { [name]: value }
      }),
      message
    );
  }

  const oneMemory = boundaryCollection(1);
  const baseline = buildMediaArchive({ collection: oneMemory, appVersion: "4.0.0", schemaVersion: 4 });
  const baselineEntries = await readArchiveEntries(baseline, path.join(temporaryRoot, "measure-export-limits"));
  const largestEntryBytes = Math.max(...[...baselineEntries.values()].map((data) => data.length));
  const totalEntryBytes = [...baselineEntries.values()].reduce((sum, data) => sum + data.length, 0);
  check(Buffer.isBuffer(buildMediaArchive({
    collection: oneMemory,
    appVersion: "4.0.0",
    schemaVersion: 4,
    limits: { maxEntryBytes: largestEntryBytes, maxTotalBytes: totalEntryBytes }
  })), "导出应接受恰好命中单项与总字节边界的归档");
  throwsCode(
    "MEDIA_ARCHIVE_LIMIT_EXCEEDED",
    () => buildMediaArchive({
      collection: oneMemory,
      appVersion: "4.0.0",
      schemaVersion: 4,
      limits: { maxEntryBytes: largestEntryBytes - 1 }
    }),
    "导出应在压缩前拒绝超过单项字节边界的归档"
  );
  throwsCode(
    "MEDIA_ARCHIVE_LIMIT_EXCEEDED",
    () => buildMediaArchive({
      collection: oneMemory,
      appVersion: "4.0.0",
      schemaVersion: 4,
      limits: { maxTotalBytes: totalEntryBytes - 1 }
    }),
    "导出应在压缩前拒绝超过总字节边界的归档"
  );
  throwsCode(
    "MEDIA_ARCHIVE_LIMIT_EXCEEDED",
    () => buildMediaArchive({
      collection: oneMemory,
      appVersion: "4.0.0",
      schemaVersion: 4,
      limits: { maxEntries: 1 }
    }),
    "导出应在压缩前拒绝超过条目数边界的归档"
  );
}

async function checkObservationPrivacy(temporaryRoot, fixture, collection, pristineEntries) {
  const invalidGpsStore = {
    ...fixture.store,
    listMediaObservations({ assetId }) {
      return fixture.observations.filter((item) => item.assetId === assetId).map((item, index) => (
        index === 0
          ? {
              ...item,
              kind: "gps_location",
              source: "exif",
              status: "suggested",
              sensitive: false,
              value: { latitude: 31.2, longitude: 121.5 }
            }
          : item
      ));
    }
  };
  throwsCode(
    "MEDIA_ARCHIVE_OBSERVATION_PRIVACY_INVALID",
    () => buildMediaArchive({
      collection,
      store: invalidGpsStore,
      storage: fixture.storage,
      appVersion: "4.0.0",
      schemaVersion: 4
    }),
    "导出不能把伪装成普通线索的 GPS 坐标写入归档"
  );

  const maliciousGpsEntries = cloneEntries(pristineEntries);
  const maliciousGps = parseJson(maliciousGpsEntries.get(ARCHIVE_PATHS.observations));
  Object.assign(maliciousGps[0], {
    kind: "gps_location",
    source: "exif",
    status: "suggested",
    sensitive: false,
    value: { latitude: 31.2, longitude: 121.5 }
  });
  replaceJsonAndRefreshManifest(maliciousGpsEntries, ARCHIVE_PATHS.observations, maliciousGps);
  const maliciousGpsRoot = path.join(temporaryRoot, "reject-self-verified-gps");
  await rejectsCode(
    "MEDIA_ARCHIVE_OBSERVATION_PRIVACY_INVALID",
    () => prepareMediaArchive(repack(maliciousGpsEntries), { stagingRoot: maliciousGpsRoot }),
    "哈希正确的恶意 GPS 归档仍必须在 prepare 阶段被拒绝"
  );
  equal(fs.existsSync(maliciousGpsRoot), false, "恶意 GPS 归档被拒绝后不得残留暂存文件");

  const sanitizedFixture = createFixture(temporaryRoot, {
    privacyMode: "sanitized_only",
    suffix: "sanitized"
  });
  const sanitizedArchive = buildMediaArchive({
    collection,
    store: sanitizedFixture.store,
    storage: sanitizedFixture.storage,
    appVersion: "4.0.0",
    schemaVersion: 4
  });
  const invalidSensitiveExifStore = {
    ...sanitizedFixture.store,
    listMediaObservations({ assetId }) {
      return sanitizedFixture.observations.filter((item) => item.assetId === assetId).map((item, index) => (
        index === 0
          ? {
              ...item,
              kind: "gps_coordinates",
              source: "exif",
              status: "suggested",
              sensitive: true,
              value: { latitude: 31.2, longitude: 121.5 }
            }
          : item
      ));
    }
  };
  throwsCode(
    "MEDIA_ARCHIVE_OBSERVATION_PRIVACY_INVALID",
    () => buildMediaArchive({
      collection,
      store: invalidSensitiveExifStore,
      storage: sanitizedFixture.storage,
      appVersion: "4.0.0",
      schemaVersion: 4
    }),
    "仅保留安全展示图的导出必须拒绝全部敏感 EXIF 线索"
  );
  const sanitizedEntries = await readArchiveEntries(
    sanitizedArchive,
    path.join(temporaryRoot, "unpack-sanitized-privacy")
  );
  const maliciousExif = parseJson(sanitizedEntries.get(ARCHIVE_PATHS.observations));
  Object.assign(maliciousExif[0], {
    kind: "gps_coordinates",
    source: "exif",
    status: "suggested",
    sensitive: true,
    value: { latitude: 31.2, longitude: 121.5 }
  });
  replaceJsonAndRefreshManifest(sanitizedEntries, ARCHIVE_PATHS.observations, maliciousExif);
  await rejectsCode(
    "MEDIA_ARCHIVE_OBSERVATION_PRIVACY_INVALID",
    () => prepareMediaArchive(repack(sanitizedEntries), {
      stagingRoot: path.join(temporaryRoot, "reject-self-verified-sensitive-exif")
    }),
    "哈希正确的 sanitized-only 敏感 EXIF 归档仍必须被拒绝"
  );

  const sevenExportStore = {
    ...fixture.store,
    listMediaForMemory(memoryId) {
      const media = fixture.store.listMediaForMemory(memoryId);
      return memoryId === "memory-one" && media.length ? Array.from({ length: 7 }, () => ({ ...media[0] })) : media;
    }
  };
  throwsCode(
    "MEDIA_ARCHIVE_LIMIT_EXCEEDED",
    () => buildMediaArchive({
      collection,
      store: sevenExportStore,
      storage: fixture.storage,
      appVersion: "4.0.0",
      schemaVersion: 4
    }),
    "归档导出不能绕过单展品六图上限"
  );
  await rejectSevenLinkArchive(temporaryRoot, pristineEntries);
}

async function rejectSevenLinkArchive(temporaryRoot, pristineEntries) {
  const entries = cloneEntries(pristineEntries);
  const assets = parseJson(entries.get(ARCHIVE_PATHS.assets));
  const sourceAsset = assets[0];
  const expandedAssets = [sourceAsset];
  for (let index = 2; index <= 7; index += 1) {
    const clone = JSON.parse(JSON.stringify(sourceAsset));
    clone.id = `asset-seven-link-${index}`;
    for (const variant of clone.variants) {
      const sourcePath = variant.archivePath;
      variant.assetId = clone.id;
      variant.archivePath = sourcePath.replace(`/${sourceAsset.id}/`, `/${clone.id}/`);
      entries.set(variant.archivePath, Buffer.from(entries.get(sourcePath)));
    }
    expandedAssets.push(clone);
  }
  const links = expandedAssets.map((asset, index) => ({
    ...link("memory-one", asset.id, `边界照片 ${index + 1}`),
    role: index === 0 ? "cover" : "gallery",
    position: index
  }));
  entries.set(ARCHIVE_PATHS.assets, jsonBuffer(expandedAssets));
  entries.set(ARCHIVE_PATHS.links, jsonBuffer(links));
  entries.set(ARCHIVE_PATHS.observations, jsonBuffer([]));
  refreshWholeManifest(entries, {
    assetCount: expandedAssets.length,
    linkCount: links.length,
    observationCount: 0
  });
  await rejectsCode(
    "MEDIA_ARCHIVE_LINK_ORDER_INVALID",
    () => prepareMediaArchive(repack(entries), {
      stagingRoot: path.join(temporaryRoot, "reject-seven-links")
    }),
    "归档 link validator 必须使用同一六图常量拒绝第七张"
  );
}

async function checkRedactedArchive(temporaryRoot, fullCollection) {
  const redactedCollection = {
    ...fullCollection,
    mode: "redacted",
    privacy: "已隐藏媒体",
    memories: fullCollection.memories.map((memory) => ({
      ...memory,
      rawContent: "[已隐藏原始记忆]",
      coverImage: "private.jpg",
      attachments: [{ name: "不应进入归档.jpg" }],
      media: [{ assetId: "asset-should-not-leak" }]
    }))
  };
  const forbiddenDependency = new Proxy({}, {
    get() {
      throw new Error("脱敏导出不应读取媒体 store/storage");
    }
  });
  const archive = buildMediaArchive({
    collection: redactedCollection,
    store: forbiddenDependency,
    storage: forbiddenDependency,
    appVersion: "4.0.0",
    schemaVersion: 4
  });
  const entries = await readArchiveEntries(archive, path.join(temporaryRoot, "unpack-redacted"));
  deepEqual([...entries.keys()].sort(), [ARCHIVE_PATHS.collection, ARCHIVE_PATHS.manifest].sort(), "脱敏 .time-isle 只能包含 manifest 和 collection");
  check([...entries.keys()].every((entryPath) => !entryPath.startsWith("media/")), "脱敏归档不得物理包含任何媒体条目");

  const prepared = await prepareMediaArchive(archive, { stagingRoot: path.join(temporaryRoot, "roundtrip-redacted") });
  equal(prepared.manifest.media.included, false, "脱敏 manifest 应明确媒体未包含");
  deepEqual(prepared.assets, [], "脱敏恢复 descriptor 不应包含资产");
  check(prepared.collection.memories.every((memory) => memory.media.length === 0 && memory.attachments.length === 0 && memory.coverImage === ""), "脱敏 collection 应清空关联、附件和封面路径");
}

function createFixture(temporaryRoot, options = {}) {
  const sanitizedOnly = options.privacyMode === "sanitized_only";
  const suffix = options.suffix ? `-${options.suffix}` : "";
  const mediaRoot = path.join(temporaryRoot, `media-source${suffix}`);
  fs.mkdirSync(mediaRoot, { recursive: true });
  const original = createPng(12, 8);
  const display = createWebp(320, 180);
  const thumb = createWebp(120, 80);
  const files = {
    ...(sanitizedOnly ? {} : { "assets/original.png": original }),
    "assets/display.webp": display,
    "assets/thumb.webp": thumb
  };
  for (const [storageKey, data] of Object.entries(files)) {
    const filePath = path.join(mediaRoot, ...storageKey.split("/"));
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, data);
  }

  const asset = {
    id: `asset-shared-photo${suffix}`,
    schemaVersion: 4,
    contentSha256: sha256(sanitizedOnly ? display : original),
    originalName: sanitizedOnly ? "操场合影.webp" : "操场合影.png",
    sourceMimeType: sanitizedOnly ? "image/webp" : "image/png",
    sourceByteSize: (sanitizedOnly ? display : original).length,
    width: 320,
    height: 180,
    storageDriver: "local",
    privacyMode: sanitizedOnly ? "sanitized_only" : "preserve_original",
    status: "ready",
    safeMetadata: { canonicalVariant: "display", coordinateSpace: "canonical-preview-v1" },
    createdAt: "2026-07-12T10:00:00.000Z",
    updatedAt: "2026-07-12T10:00:00.000Z"
  };
  const variants = [
    ...(sanitizedOnly ? [] : [variant(asset.id, "original", "assets/original.png", "image/png", original, 12, 8)]),
    variant(asset.id, "display", "assets/display.webp", "image/webp", display, 320, 180),
    variant(asset.id, "thumb", "assets/thumb.webp", "image/webp", thumb, 120, 80)
  ];
  asset.variants = variants;
  const links = [
    link("memory-one", asset.id, "旧操场照片"),
    link("memory-two", asset.id, "重返时翻出的旧照")
  ];
  const observations = [
    {
      id: `observation-school-gate${suffix}`,
      assetId: asset.id,
      kind: "image_region",
      source: "user",
      value: { x: 0.12, y: 0.18, width: 0.3, height: 0.4, label: "旧校门" },
      status: "confirmed",
      confidence: null,
      sensitive: false,
      metadata: { memoryId: "memory-one" },
      createdAt: "2026-07-12T10:10:00.000Z",
      updatedAt: "2026-07-12T10:10:00.000Z"
    },
    {
      id: `observation-outside-boundary${suffix}`,
      assetId: asset.id,
      kind: "image_region",
      source: "user",
      value: { x: 0, y: 0, width: 1, height: 1 },
      status: "confirmed",
      confidence: null,
      sensitive: true,
      metadata: { memoryId: "memory-private-outside" },
      createdAt: "2026-07-12T10:11:00.000Z",
      updatedAt: "2026-07-12T10:11:00.000Z"
    }
  ];
  const store = {
    listMediaForMemory(memoryId) {
      return links.filter((item) => item.memoryId === memoryId).map((item) => ({ ...item, asset, variants }));
    },
    getMediaAsset(assetId) {
      return assetId === asset.id ? asset : null;
    },
    listMediaVariants(assetId) {
      return assetId === asset.id ? variants : [];
    },
    listMediaObservations({ assetId }) {
      return observations.filter((item) => item.assetId === assetId);
    }
  };
  const storage = {
    resolveStorageKey(storageKey) {
      const target = path.resolve(mediaRoot, ...String(storageKey).split("/"));
      const relative = path.relative(mediaRoot, target);
      if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("storage escape");
      return target;
    }
  };
  return { original, display, thumb, asset, variants, links, observations, store, storage };
}

function variant(assetId, kind, storageKey, mimeType, data, width, height) {
  return {
    assetId,
    kind,
    storageKey,
    mimeType,
    byteSize: data.length,
    width,
    height,
    sha256: sha256(data),
    createdAt: "2026-07-12T10:00:00.000Z",
    updatedAt: "2026-07-12T10:00:00.000Z"
  };
}

function link(memoryId, assetId, caption) {
  return {
    memoryId,
    assetId,
    role: "cover",
    position: 0,
    caption,
    altText: "傍晚操场旁的一张旧照片",
    backNote: "照片背面留着当年的一句话。",
    metadata: {},
    createdAt: "2026-07-12T10:05:00.000Z",
    updatedAt: "2026-07-12T10:05:00.000Z"
  };
}

async function readArchiveEntries(archive, stagingRoot) {
  const extracted = await extractArchive(archive, {
    stagingRoot,
    maxEntries: 50,
    maxEntryBytes: 1024 * 1024,
    maxTotalBytes: 8 * 1024 * 1024
  });
  const entries = new Map(extracted.entries.map((entry) => [
    entry.path,
    fs.readFileSync(path.join(stagingRoot, ...entry.path.split("/")))
  ]));
  fs.rmSync(stagingRoot, { recursive: true, force: true });
  return entries;
}

function repack(entries) {
  return createArchive([...entries].map(([entryPath, data]) => ({ path: entryPath, data, mtime: 0 })));
}

function cloneEntries(entries) {
  return new Map([...entries].map(([entryPath, data]) => [entryPath, Buffer.from(data)]));
}

function replaceJsonAndRefreshManifest(entries, entryPath, value) {
  const data = jsonBuffer(value);
  entries.set(entryPath, data);
  const manifest = parseJson(entries.get(ARCHIVE_PATHS.manifest));
  const descriptor = manifest.entries.find((entry) => entry.path === entryPath);
  descriptor.bytes = data.length;
  descriptor.sha256 = sha256(data);
  entries.set(ARCHIVE_PATHS.manifest, jsonBuffer(manifest));
}

function refreshWholeManifest(entries, mediaCounts) {
  const manifest = parseJson(entries.get(ARCHIVE_PATHS.manifest));
  const previous = new Map(manifest.entries.map((entry) => [entry.path, entry]));
  manifest.entries = [...entries]
    .filter(([entryPath]) => entryPath !== ARCHIVE_PATHS.manifest)
    .sort(([left], [right]) => left.localeCompare(right, "en"))
    .map(([entryPath, data]) => ({
      path: entryPath,
      sha256: sha256(data),
      bytes: data.length,
      mime: previous.get(entryPath)?.mime || mimeForArchivePath(entryPath)
    }));
  manifest.entryCount = manifest.entries.length;
  Object.assign(manifest.media, mediaCounts);
  entries.set(ARCHIVE_PATHS.manifest, jsonBuffer(manifest));
}

function mimeForArchivePath(entryPath) {
  if (entryPath.endsWith(".json")) return "application/json";
  if (entryPath.endsWith(".jpg") || entryPath.endsWith(".jpeg")) return "image/jpeg";
  if (entryPath.endsWith(".png")) return "image/png";
  if (entryPath.endsWith(".webp")) return "image/webp";
  throw new Error(`unknown test archive MIME: ${entryPath}`);
}

function boundaryCollection(count) {
  return {
    product: "时屿",
    version: "4.0.0",
    schemaVersion: 4,
    mode: "redacted",
    exportedAt: "2026-07-12T12:00:00.000Z",
    memories: Array.from({ length: count }, (_, index) => ({
      id: `memory-boundary-${String(index + 1).padStart(3, "0")}`,
      title: `边界展品 ${index + 1}`,
      rawContent: "[已隐藏原始记忆]",
      attachments: [],
      media: []
    })),
    archaeology: { mode: "redacted", events: [], claims: [], pairDecisions: [], questions: [] }
  };
}

function createUncheckedRedactedArchive(collection) {
  const collectionData = jsonBuffer(collection);
  const manifest = {
    format: ARCHIVE_FORMAT,
    formatVersion: ARCHIVE_FORMAT_VERSION,
    extension: ".time-isle",
    appVersion: "4.0.0",
    schemaVersion: 4,
    mode: "redacted",
    exportedAt: collection.exportedAt,
    collectionPath: ARCHIVE_PATHS.collection,
    media: { included: false, assetCount: 0, linkCount: 0, observationCount: 0 },
    entryCount: 1,
    entries: [{
      path: ARCHIVE_PATHS.collection,
      sha256: sha256(collectionData),
      bytes: collectionData.length,
      mime: "application/json"
    }]
  };
  return createArchive([
    { path: ARCHIVE_PATHS.manifest, data: jsonBuffer(manifest), mtime: 0 },
    { path: ARCHIVE_PATHS.collection, data: collectionData, mtime: 0 }
  ]);
}

function parseJson(data) {
  return JSON.parse(data.toString("utf8"));
}

function jsonBuffer(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function createPng(width, height) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const pixels = Buffer.alloc((1 + (width * 4)) * height);
  return Buffer.concat([
    signature,
    pngChunk("IHDR", header),
    pngChunk("IDAT", zlib.deflateSync(pixels)),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  typeBuffer.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
  return output;
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

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function sha256(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function check(value, message) {
  assert.ok(value, message);
  assertions += 1;
}

function equal(actual, expected, message) {
  assert.equal(actual, expected, message);
  assertions += 1;
}

function deepEqual(actual, expected, message) {
  assert.deepEqual(actual, expected, message);
  assertions += 1;
}

async function rejectsCode(expectedCode, operation, message) {
  await assert.rejects(operation, (error) => error?.code === expectedCode, message);
  assertions += 1;
}

function throwsCode(expectedCode, operation, message) {
  assert.throws(operation, (error) => error?.code === expectedCode, message);
  assertions += 1;
}
