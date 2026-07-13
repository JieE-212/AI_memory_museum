"use strict";

const fs = require("fs");
const path = require("path");
const { randomUUID, createHash } = require("crypto");
const { Transform } = require("stream");
const { pipeline } = require("stream/promises");
const { inspectImage, validateDerivedWebp } = require("./media-format");
const { MAX_MEDIA_PER_MEMORY } = require("./media-policy");

const DEFAULT_POLICY = Object.freeze({
  allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
  maxOriginalBytes: 20 * 1024 * 1024,
  maxDerivedBytes: 4 * 1024 * 1024,
  maxPixelCount: 40_000_000,
  maxPhotosPerMemory: MAX_MEDIA_PER_MEMORY,
  displayMaxEdge: 1600,
  thumbMaxEdge: 480,
  staleStageMs: 24 * 60 * 60 * 1000
});

function createMediaStorage(options = {}) {
  const root = path.resolve(options.root || path.join(process.cwd(), "data", "media"));
  const policy = normalizePolicy(options);
  const stagingRoot = path.join(root, ".staging");
  const assetsRoot = path.join(root, "assets");
  const trashRoot = path.join(root, ".trash");

  [root, stagingRoot, assetsRoot, trashRoot].forEach((directory) => (
    fs.mkdirSync(directory, { recursive: true })
  ));

  async function beginUpload(readable, input = {}) {
    const uploadId = `upload-${randomUUID()}`;
    const directory = safeJoin(stagingRoot, uploadId);
    const sourcePath = path.join(directory, "source.upload");
    fs.mkdirSync(directory, { recursive: false });

    try {
      const streamed = await streamToFile(readable, sourcePath, policy.maxOriginalBytes);
      const inspected = inspectImage(await fs.promises.readFile(sourcePath), {
        maxBytes: policy.maxOriginalBytes,
        maxPixels: policy.maxPixelCount,
        allowedMimeTypes: policy.allowedMimeTypes
      });
      assertDeclaredMime(input.declaredMimeType, inspected.mimeType);
      const privacyMode = normalizePrivacyMode(input.privacyMode);
      const extension = extensionForMime(inspected.mimeType);
      const originalName = sanitizeFileName(input.fileName, extension);
      const renamedSource = path.join(directory, `original.${extension}`);
      await fs.promises.rename(sourcePath, renamedSource);
      const stage = {
        uploadId,
        originalName,
        privacyMode,
        source: {
          fileName: path.basename(renamedSource),
          sha256: streamed.sha256,
          byteSize: streamed.byteSize,
          mimeType: inspected.mimeType,
          width: inspected.width,
          height: inspected.height
        },
        variants: {},
        createdAt: new Date().toISOString()
      };
      await writeStage(directory, stage);
      return publicStage(stage);
    } catch (error) {
      await removeDirectory(directory);
      throw error;
    }
  }

  async function putDerived(uploadId, kind, readable, input = {}) {
    const normalizedKind = normalizeDerivedKind(kind);
    const directory = stageDirectory(uploadId);
    const stage = await readStage(directory);
    const targetPath = path.join(directory, `${normalizedKind}.webp.upload`);

    try {
      const streamed = await streamToFile(readable, targetPath, policy.maxDerivedBytes);
      const inspected = validateDerivedWebp(await fs.promises.readFile(targetPath), {
        maxBytes: policy.maxDerivedBytes,
        maxPixels: policy.maxPixelCount,
        maxWidth: normalizedKind === "thumb" ? policy.thumbMaxEdge : policy.displayMaxEdge,
        maxHeight: normalizedKind === "thumb" ? policy.thumbMaxEdge : policy.displayMaxEdge
      });
      assertDeclaredMime(input.declaredMimeType || "image/webp", inspected.mimeType);
      const finalPath = path.join(directory, `${normalizedKind}.webp`);
      await fs.promises.rename(targetPath, finalPath);
      stage.variants[normalizedKind] = {
        fileName: path.basename(finalPath),
        sha256: streamed.sha256,
        byteSize: streamed.byteSize,
        mimeType: inspected.mimeType,
        width: inspected.width,
        height: inspected.height
      };
      await writeStage(directory, stage);
      return publicStage(stage);
    } catch (error) {
      await fs.promises.rm(targetPath, { force: true }).catch(() => {});
      throw error;
    }
  }

  async function finalizeUpload(uploadId, assetId = `asset-${randomUUID()}`) {
    const directory = stageDirectory(uploadId);
    const stage = await readStage(directory);
    if (!stage.variants.display || !stage.variants.thumb) {
      throw mediaError(409, "展示图和缩略图尚未准备完成。");
    }
    if (!/^asset-[a-zA-Z0-9_-]{8,120}$/.test(assetId)) throw mediaError(400, "媒体资产 ID 无效。");

    const source = stage.privacyMode === "sanitized_only" ? stage.variants.display : stage.source;
    const contentSha256 = source.sha256;
    const shard = contentSha256.slice(0, 2);
    const parent = safeJoin(assetsRoot, shard);
    const destination = safeJoin(parent, assetId);
    fs.mkdirSync(parent, { recursive: true });
    if (fs.existsSync(destination)) throw mediaError(409, "媒体资产目录已经存在。");

    if (stage.privacyMode === "sanitized_only") {
      const originalPath = path.join(directory, stage.source.fileName);
      await fs.promises.rm(originalPath, { force: true });
    }
    await fs.promises.rm(path.join(directory, "stage.json"), { force: true });
    await fs.promises.rename(directory, destination);
    const finalizedAt = new Date();
    await fs.promises.utimes(destination, finalizedAt, finalizedAt);

    const variants = [];
    if (stage.privacyMode === "preserve_original") {
      variants.push(buildVariant(assetId, "original", stage.source, root, destination));
    }
    variants.push(buildVariant(assetId, "display", stage.variants.display, root, destination));
    variants.push(buildVariant(assetId, "thumb", stage.variants.thumb, root, destination));
    return {
      asset: {
        id: assetId,
        contentSha256,
        originalName: stage.originalName,
        sourceMimeType: source.mimeType,
        sourceByteSize: source.byteSize,
        width: stage.variants.display.width,
        height: stage.variants.display.height,
        privacyMode: stage.privacyMode,
        safeMetadata: {
          canonicalVariant: "display",
          coordinateSpace: "canonical-preview-v1",
          sourceWidth: stage.source.width,
          sourceHeight: stage.source.height
        }
      },
      variants,
      directory: destination
    };
  }

  async function discardUpload(uploadId) {
    const directory = stageDirectory(uploadId);
    await removeDirectory(directory);
    return true;
  }

  async function getUpload(uploadId) {
    return publicStage(await readStage(stageDirectory(uploadId)));
  }

  async function readUploadSource(uploadId) {
    const directory = stageDirectory(uploadId);
    const stage = await readStage(directory);
    const sourcePath = safeJoin(directory, stage.source.fileName);
    const stat = await fs.promises.stat(sourcePath);
    if (!stat.isFile() || stat.size !== Number(stage.source.byteSize) || stat.size > policy.maxOriginalBytes) {
      throw mediaError(409, "上传原图已损坏，无法读取元数据线索。");
    }
    return fs.promises.readFile(sourcePath);
  }

  function resolveStorageKey(storageKey) {
    const normalized = String(storageKey || "").replace(/\\/g, "/");
    if (!normalized || normalized.startsWith("/") || normalized.split("/").includes("..")) {
      throw mediaError(400, "媒体存储路径无效。");
    }
    return safeJoin(root, ...normalized.split("/"));
  }

  async function quarantineAsset(assetId, variants = []) {
    const firstKey = variants.find((item) => item?.storageKey)?.storageKey;
    if (!firstKey) return null;
    const firstPath = resolveStorageKey(firstKey);
    const directory = path.dirname(firstPath);
    const expectedAssetId = path.basename(directory);
    if (expectedAssetId !== assetId) throw mediaError(400, "媒体目录与资产不一致。");
    if (!fs.existsSync(directory)) return null;
    const target = nextTrashDestination(assetId);
    await fs.promises.rename(directory, target);
    return target;
  }

  async function quarantineOrphanDirectory(directory, assetId) {
    const resolved = path.resolve(String(directory || ""));
    const normalizedAssetId = String(assetId || "");
    const shard = path.basename(path.dirname(resolved));
    if (!/^[a-zA-Z0-9_-]{1,120}$/.test(normalizedAssetId)
        || path.basename(resolved) !== normalizedAssetId
        || !/^[a-f0-9]{2}$/.test(shard)
        || path.dirname(path.dirname(resolved)) !== assetsRoot) {
      throw mediaError(400, "无主媒体目录不在内容寻址资产边界内。");
    }
    if (!fs.existsSync(resolved)) return null;
    const target = nextTrashDestination(normalizedAssetId);
    await fs.promises.rename(resolved, target);
    return target;
  }

  async function removeQuarantined(directory) {
    if (!directory) return;
    const resolved = path.resolve(directory);
    if (!isWithin(resolved, trashRoot) || resolved === trashRoot || path.dirname(resolved) !== trashRoot) throw mediaError(400, "回收路径无效。");
    await removeDirectory(resolved);
  }

  async function restoreQuarantined(directory, assetId, variants = []) {
    if (!directory) return null;
    const resolved = path.resolve(directory);
    if (!isWithin(resolved, trashRoot) || resolved === trashRoot || path.dirname(resolved) !== trashRoot) throw mediaError(400, "回收路径无效。");
    const firstKey = variants.find((item) => item?.storageKey)?.storageKey;
    if (!firstKey) throw mediaError(400, "媒体缺少可恢复的存储路径。");
    const originalDirectory = path.dirname(resolveStorageKey(firstKey));
    if (path.basename(originalDirectory) !== assetId) throw mediaError(400, "媒体目录与资产不一致。");
    if (!fs.existsSync(resolved)) return null;
    if (fs.existsSync(originalDirectory)) throw mediaError(409, "媒体原目录已经存在，无法回滚隔离操作。");
    await fs.promises.mkdir(path.dirname(originalDirectory), { recursive: true });
    await fs.promises.rename(resolved, originalDirectory);
    return originalDirectory;
  }

  async function cleanupStaleStages(now = Date.now()) {
    const removed = [];
    for (const entry of await fs.promises.readdir(stagingRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const directory = safeJoin(stagingRoot, entry.name);
      const stat = await fs.promises.stat(directory);
      if (now - stat.mtimeMs <= policy.staleStageMs) continue;
      await removeDirectory(directory);
      removed.push(entry.name);
    }
    return removed;
  }

  async function listQuarantined(now = Date.now(), minimumAgeMs = 0) {
    const entries = [];
    for (const entry of await fs.promises.readdir(trashRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const match = /^(.+)-(\d{10,})$/.exec(entry.name);
      if (!match || !/^[a-zA-Z0-9_-]{1,120}$/.test(match[1])) continue;
      const directory = safeJoin(trashRoot, entry.name);
      const quarantinedMs = Number(match[2]);
      if (!Number.isSafeInteger(quarantinedMs) || now - quarantinedMs < Math.max(0, Number(minimumAgeMs) || 0)) continue;
      entries.push({ assetId: match[1], directory, quarantinedAt: new Date(quarantinedMs).toISOString() });
    }
    return entries;
  }

  async function listAssetDirectories() {
    const directories = [];
    for (const shardEntry of await fs.promises.readdir(assetsRoot, { withFileTypes: true })) {
      if (!shardEntry.isDirectory() || !/^[a-f0-9]{2}$/.test(shardEntry.name)) continue;
      const shardDirectory = safeJoin(assetsRoot, shardEntry.name);
      for (const assetEntry of await fs.promises.readdir(shardDirectory, { withFileTypes: true })) {
        if (!assetEntry.isDirectory() || !/^[a-zA-Z0-9_-]{1,120}$/.test(assetEntry.name)) continue;
        const directory = safeJoin(shardDirectory, assetEntry.name);
        const stat = await fs.promises.stat(directory);
        directories.push({ assetId: assetEntry.name, directory, updatedAtMs: stat.mtimeMs });
      }
    }
    return directories;
  }

  function nextTrashDestination(assetId) {
    let timestamp = Date.now();
    let target = safeJoin(trashRoot, `${assetId}-${timestamp}`);
    while (fs.existsSync(target)) {
      timestamp += 1;
      target = safeJoin(trashRoot, `${assetId}-${timestamp}`);
    }
    return target;
  }

  async function verifyVariant(variant) {
    const filePath = resolveStorageKey(variant.storageKey);
    const stat = await fs.promises.stat(filePath);
    if (!stat.isFile() || stat.size !== Number(variant.byteSize)) return false;
    return (await hashFile(filePath)) === variant.sha256;
  }

  function stageDirectory(uploadId) {
    if (!/^upload-[a-f0-9-]{36}$/.test(String(uploadId || ""))) throw mediaError(400, "上传会话无效。");
    return safeJoin(stagingRoot, uploadId);
  }

  return {
    root,
    policy,
    beginUpload,
    getUpload,
    readUploadSource,
    putDerived,
    finalizeUpload,
    discardUpload,
    resolveStorageKey,
    quarantineAsset,
    quarantineOrphanDirectory,
    removeQuarantined,
    restoreQuarantined,
    cleanupStaleStages,
    listQuarantined,
    listAssetDirectories,
    verifyVariant,
    hashFile
  };
}

async function streamToFile(readable, targetPath, maxBytes) {
  let byteSize = 0;
  const hash = createHash("sha256");
  const meter = new Transform({
    transform(chunk, encoding, callback) {
      byteSize += chunk.length;
      if (byteSize > maxBytes) return callback(mediaError(413, "图片文件过大。"));
      hash.update(chunk);
      callback(null, chunk);
    }
  });
  try {
    await pipeline(readable, meter, fs.createWriteStream(targetPath, { flags: "wx" }));
  } catch (error) {
    await fs.promises.rm(targetPath, { force: true }).catch(() => {});
    throw error;
  }
  if (!byteSize) {
    await fs.promises.rm(targetPath, { force: true }).catch(() => {});
    throw mediaError(400, "图片文件不能为空。");
  }
  return { byteSize, sha256: hash.digest("hex") };
}

async function hashFile(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function readStage(directory) {
  try {
    return JSON.parse(await fs.promises.readFile(path.join(directory, "stage.json"), "utf8"));
  } catch {
    throw mediaError(404, "上传会话不存在或已经失效。");
  }
}

async function writeStage(directory, stage) {
  const target = path.join(directory, "stage.json");
  const temporary = path.join(directory, `stage-${randomUUID()}.tmp`);
  await fs.promises.writeFile(temporary, JSON.stringify(stage), { flag: "wx" });
  await fs.promises.rename(temporary, target);
}

function publicStage(stage) {
  return {
    uploadId: stage.uploadId,
    originalName: stage.originalName,
    privacyMode: stage.privacyMode,
    source: stage.source,
    variants: stage.variants,
    readyToFinalize: Boolean(stage.variants.display && stage.variants.thumb),
    createdAt: stage.createdAt
  };
}

function buildVariant(assetId, kind, record, root, destination) {
  const filePath = path.join(destination, record.fileName);
  return {
    assetId,
    kind,
    storageKey: path.relative(root, filePath).split(path.sep).join("/"),
    mimeType: record.mimeType,
    byteSize: record.byteSize,
    width: record.width,
    height: record.height,
    sha256: record.sha256
  };
}

function normalizePolicy(options) {
  const integer = (value, fallback) => Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : fallback;
  return Object.freeze({
    allowedMimeTypes: [...DEFAULT_POLICY.allowedMimeTypes],
    maxOriginalBytes: integer(options.maxOriginalBytes, DEFAULT_POLICY.maxOriginalBytes),
    maxDerivedBytes: integer(options.maxDerivedBytes, DEFAULT_POLICY.maxDerivedBytes),
    maxPixelCount: integer(options.maxPixelCount, DEFAULT_POLICY.maxPixelCount),
    maxPhotosPerMemory: Math.min(MAX_MEDIA_PER_MEMORY, integer(options.maxPhotosPerMemory, DEFAULT_POLICY.maxPhotosPerMemory)),
    displayMaxEdge: integer(options.displayMaxEdge, DEFAULT_POLICY.displayMaxEdge),
    thumbMaxEdge: integer(options.thumbMaxEdge, DEFAULT_POLICY.thumbMaxEdge),
    staleStageMs: integer(options.staleStageMs, DEFAULT_POLICY.staleStageMs)
  });
}

function normalizePrivacyMode(value) {
  return value === "preserve_original" ? "preserve_original" : "sanitized_only";
}

function normalizeDerivedKind(value) {
  if (!["display", "thumb"].includes(value)) throw mediaError(400, "媒体变体类型无效。");
  return value;
}

function assertDeclaredMime(declaredMimeType, detectedMimeType) {
  const declared = String(declaredMimeType || "").split(";", 1)[0].trim().toLowerCase();
  if (declared && declared !== "application/octet-stream" && declared !== detectedMimeType) {
    throw mediaError(400, "声明的图片格式与文件内容不一致。");
  }
}

function sanitizeFileName(value, fallbackExtension) {
  const base = path.basename(String(value || "").replace(/[\u0000-\u001f]/g, "")).trim().slice(0, 160);
  return base || `memory-photo.${fallbackExtension}`;
}

function extensionForMime(mimeType) {
  return ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" })[mimeType] || "bin";
}

function safeJoin(root, ...parts) {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, ...parts);
  if (!isWithin(target, resolvedRoot)) throw mediaError(400, "媒体路径超出存储范围。");
  return target;
}

function isWithin(target, root) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function removeDirectory(directory) {
  await fs.promises.rm(directory, { recursive: true, force: true });
}

function mediaError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

module.exports = { createMediaStorage, DEFAULT_POLICY, mediaError };
