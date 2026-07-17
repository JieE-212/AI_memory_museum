"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { TextDecoder } = require("node:util");
const { createArchive, extractArchive } = require("./time-isle-archive");
const { inspectImage } = require("./media-format");
const {
  MAX_MEDIA_PER_MEMORY,
  MEDIA_ARCHIVE_LIMITS,
  mediaObservationPolicyViolation
} = require("./media-policy");
const { CLUE_REDACTED_NOTE } = require("./clue-backup");
const { CAPSULE_REDACTED_NOTE } = require("./capsule-database");
const {
  VOICE_SECTION_PATH,
  VOICE_ARCHIVE_PREFIX,
  VOICE_MIME_TYPES,
  buildVoiceArchiveSection,
  buildVoiceManifest,
  readVoiceArchiveSection,
  validateVoiceSectionDeclaration,
  verifyVoiceBytes
} = require("./voice-backup");

const ARCHIVE_FORMAT = "time-isle-media-archive";
const ARCHIVE_FORMAT_VERSION = 2;
const LEGACY_ARCHIVE_FORMAT_VERSION = 1;
const ARCHIVE_SECTION_VERSION = 1;
const SUPPORTED_ARCHIVE_FORMAT_VERSIONS = new Set([LEGACY_ARCHIVE_FORMAT_VERSION, ARCHIVE_FORMAT_VERSION]);
const JSON_MIME = "application/json";
const IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const VARIANT_KINDS = new Set(["original", "display", "thumb"]);
const MEDIA_ROLES = new Set(["cover", "gallery", "evidence"]);
const OBSERVATION_SOURCES = new Set(["user", "exif", "ocr", "system", "model", "import"]);
const OBSERVATION_STATUSES = new Set(["suggested", "confirmed", "rejected"]);
const ID_PATTERN = /^[a-zA-Z0-9_-]{1,120}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

const ARCHIVE_PATHS = Object.freeze({
  manifest: "manifest.json",
  collection: "collection.json",
  assets: "media/assets.json",
  links: "media/links.json",
  observations: "media/media_observations.json",
  exhibitions: "exhibitions/state.json",
  revisits: "revisits/state.json",
  entities: "entities/state.json",
  capsules: "capsules/state.json",
  voices: VOICE_SECTION_PATH
});

const FEATURE_ARCHIVE_SECTIONS = Object.freeze([
  Object.freeze({
    name: "exhibitions",
    collectionKey: "exhibitions",
    path: ARCHIVE_PATHS.exhibitions,
    sinceSchemaVersion: 5,
    version: 1,
    recordsKey: "exhibitions",
    summaryCountKey: "exhibitionCount",
    summaryCountKeys: Object.freeze(["exhibitionCount", "publishedCount"]),
    maximumRecords: 200
  }),
  Object.freeze({
    name: "revisits",
    collectionKey: "revisits",
    path: ARCHIVE_PATHS.revisits,
    sinceSchemaVersion: 6,
    version: 1,
    recordsKey: "states",
    summaryCountKey: "stateCount",
    summaryCountKeys: Object.freeze(["stateCount", "viewedCount", "dismissedCount"]),
    maximumRecords: 500
  }),
  Object.freeze({
    name: "entities",
    collectionKey: "entities",
    path: ARCHIVE_PATHS.entities,
    sinceSchemaVersion: 7,
    version: 1,
    recordsKey: "entities",
    summaryCountKey: "entityCount",
    summaryCountKeys: Object.freeze(["entityCount", "personCount", "locationCount", "themeCount"]),
    redactedNote: CLUE_REDACTED_NOTE,
    maximumRecords: 500
  }),
  Object.freeze({
    name: "capsules",
    collectionKey: "capsules",
    path: ARCHIVE_PATHS.capsules,
    sinceSchemaVersion: 9,
    version: 1,
    recordsKey: "capsules",
    summaryCountKey: "capsuleCount",
    summaryCountKeys: Object.freeze(["capsuleCount", "mediaLinkCount"]),
    redactedNote: CAPSULE_REDACTED_NOTE,
    maximumRecords: 200
  })
]);
const FEATURE_SECTION_BY_NAME = new Map(FEATURE_ARCHIVE_SECTIONS.map((section) => [section.name, section]));
const KNOWN_ARCHIVE_SECTIONS = new Set(["collection", "media", "voices", ...FEATURE_SECTION_BY_NAME.keys()]);
const RESERVED_ARCHIVE_PREFIXES = Object.freeze(["media/", "exhibitions/", "revisits/", "entities/", "capsules/", VOICE_ARCHIVE_PREFIX]);

/**
 * Builds a self-verifying .time-isle archive. Media is selected from the
 * supplied collection boundary, rather than from every asset in the store, so
 * a partial collection export cannot leak links or observations from memories
 * outside that boundary.
 */
function buildMediaArchive({ collection, store, storage, voiceStorage, appVersion, schemaVersion, limits: suppliedLimits } = {}) {
  const limits = normalizeLimits(suppliedLimits);
  assertCollectionRecordLimit(assertCollection(collection), limits);
  const normalizedCollection = cloneJson(assertCollection(collection));
  const mode = normalizedCollection.mode === "redacted" ? "redacted" : "full";
  const exportedAt = normalizeTimestamp(normalizedCollection.exportedAt) || new Date().toISOString();
  const version = requireVersion(appVersion ?? normalizedCollection.version, "appVersion");
  const schema = requireSchemaVersion(schemaVersion ?? normalizedCollection.schemaVersion, "schemaVersion");
  const featureSections = extractFeatureSectionsForWrite(normalizedCollection, mode, schema);
  const voiceSection = buildVoiceArchiveSection({
    collection: normalizedCollection,
    mode,
    schemaVersion: schema,
    voiceStorage,
    validateVoiceBackup: schema >= 8 && Object.hasOwn(normalizedCollection, "voices")
      ? store?.validateVoiceBackup
      : undefined
  });

  if (mode === "redacted") {
    const safeCollection = sanitizeRedactedCollection(normalizedCollection);
    return assembleArchive({
      collection: safeCollection,
      appVersion: version,
      schemaVersion: schema,
      exportedAt,
      mode,
      media: null,
      featureSections,
      voiceSection,
      imageEntries: [],
      limits
    });
  }

  assertStoreAndStorage(store, storage);
  const memoryIds = collectionMemoryIds(normalizedCollection);
  const selected = selectReferencedMedia(memoryIds, store);
  assertRecordLimit(selected.assets, limits.maxAssets, "媒体资产");
  assertRecordLimit(selected.links, limits.maxLinks, "媒体关联");
  const linkKeys = new Set(selected.links.map((link) => `${link.memoryId}\u0000${link.assetId}`));
  const observations = selectObservations(
    selected.assets.map(({ asset }) => asset),
    memoryIds,
    linkKeys,
    store
  );
  assertRecordLimit(observations, limits.maxObservations, "图片线索");
  const imageEntries = [];
  const assets = selected.assets.map(({ asset, variants }) => {
    const archivedVariants = normalizeExportVariants(asset, variants, storage, imageEntries);
    return archiveAsset(asset, archivedVariants);
  });

  return assembleArchive({
    collection: normalizedCollection,
    appVersion: version,
    schemaVersion: schema,
    exportedAt,
    mode,
    media: { assets, links: selected.links, observations },
    featureSections,
    voiceSection,
    imageEntries,
    limits
  });
}

/**
 * Extracts an untrusted archive into an isolated staging directory and fully
 * verifies its manifest, hashes, MIME types, image structure and references.
 * It deliberately performs no database or final media-storage writes.
 */
async function prepareMediaArchive(source, options = {}) {
  assertPlainObject(options, "options");
  const stagingRoot = requireAbsolutePath(options.stagingRoot, "options.stagingRoot");
  const limits = normalizeLimits(options.limits);
  const existed = prepareEmptyStagingRoot(stagingRoot);

  try {
    const extracted = await extractArchive(source, {
      stagingRoot,
      maxEntries: limits.maxEntries,
      maxEntryBytes: limits.maxEntryBytes,
      maxTotalBytes: limits.maxTotalBytes
    });
    const extractedByPath = new Map(extracted.entries.map((entry) => [entry.path, entry]));
    const manifest = readJsonFile(requiredExtractedPath(extractedByPath, stagingRoot, ARCHIVE_PATHS.manifest));
    const manifestEntries = validateManifest(manifest, extractedByPath);
    const verifiedByPath = verifyManifestEntries(manifestEntries, extractedByPath, stagingRoot);
    validateIgnoredOptionalSectionEntries(manifest, verifiedByPath);
    const collection = readJsonFile(verifiedByPath.get(ARCHIVE_PATHS.collection).filePath);
    const featureSections = readFeatureSections(manifest, verifiedByPath, collection);
    validateCollectionForImport(collection, manifest.mode, limits);
    const voiceSection = readVoiceArchiveSection({
      manifest,
      verifiedByPath,
      collection,
      validateVoiceBackup: options.validateVoiceBackup
    });

    if (manifest.mode === "redacted") {
      validateRedactedArchive(manifest, manifestEntries, collection, voiceSection);
      return buildPreparedDescriptor({
        stagingRoot,
        manifest,
        collection,
        assets: [],
        links: [],
        observations: [],
        featureSections,
        voiceSection,
        verifiedByPath
      });
    }

    const assets = readJsonFile(requiredVerifiedPath(verifiedByPath, ARCHIVE_PATHS.assets));
    const links = readJsonFile(requiredVerifiedPath(verifiedByPath, ARCHIVE_PATHS.links));
    const observations = readJsonFile(requiredVerifiedPath(verifiedByPath, ARCHIVE_PATHS.observations));
    validateFullMediaArchive({
      manifest,
      manifestEntries,
      collection,
      assets,
      links,
      observations,
      featureSections,
      voiceSection,
      verifiedByPath,
      limits
    });
    return buildPreparedDescriptor({
      stagingRoot,
      manifest,
      collection,
      assets,
      links,
      observations,
      featureSections,
      voiceSection,
      verifiedByPath
    });
  } catch (error) {
    cleanupRejectedStagingRoot(stagingRoot, existed);
    if (String(error?.code || "").startsWith("MEDIA_ARCHIVE_")) throw error;
    if (String(error?.code || "").startsWith("ARCHIVE_")) throw error;
    throw mediaArchiveError("媒体归档无法通过完整性验证。", "MEDIA_ARCHIVE_INVALID", error);
  }
}

function assembleArchive({ collection, appVersion, schemaVersion, exportedAt, mode, media, featureSections, voiceSection, imageEntries, limits }) {
  const entries = [{ path: ARCHIVE_PATHS.collection, mime: JSON_MIME, data: jsonBuffer(collection) }];
  if (media) {
    entries.push(
      { path: ARCHIVE_PATHS.assets, mime: JSON_MIME, data: jsonBuffer(media.assets) },
      { path: ARCHIVE_PATHS.links, mime: JSON_MIME, data: jsonBuffer(media.links) },
      { path: ARCHIVE_PATHS.observations, mime: JSON_MIME, data: jsonBuffer(media.observations) },
      ...imageEntries
    );
  }
  for (const section of featureSections) {
    entries.push({ path: section.path, mime: JSON_MIME, data: jsonBuffer(section.payload) });
  }
  if (voiceSection) {
    entries.push(
      { path: voiceSection.path, mime: JSON_MIME, data: jsonBuffer(voiceSection.state) },
      ...voiceSection.audioEntries.map((entry) => ({ path: entry.path, mime: entry.mime, data: entry.data }))
    );
  }
  entries.sort((left, right) => left.path.localeCompare(right.path, "en"));
  const describedEntries = entries.map(describeEntry);
  const manifest = {
    format: ARCHIVE_FORMAT,
    formatVersion: ARCHIVE_FORMAT_VERSION,
    extension: ".time-isle",
    appVersion,
    schemaVersion,
    mode,
    exportedAt,
    collectionPath: ARCHIVE_PATHS.collection,
    sections: buildArchiveSections(collection, media, featureSections, voiceSection),
    media: media
      ? {
          included: true,
          assetsPath: ARCHIVE_PATHS.assets,
          linksPath: ARCHIVE_PATHS.links,
          observationsPath: ARCHIVE_PATHS.observations,
          assetCount: media.assets.length,
          linkCount: media.links.length,
          observationCount: media.observations.length
        }
      : { included: false, assetCount: 0, linkCount: 0, observationCount: 0 },
    ...(voiceSection ? { voices: buildVoiceManifest(voiceSection) } : {}),
    entryCount: describedEntries.length,
    entries: describedEntries
  };
  const archiveEntries = [
    { path: ARCHIVE_PATHS.manifest, data: jsonBuffer(manifest), mtime: 0 },
    ...entries.map((entry) => ({ path: entry.path, data: entry.data, mtime: 0 }))
  ];
  assertArchiveEntryLimits(archiveEntries, limits);
  return createArchive(archiveEntries);
}

function buildArchiveSections(collection, media, featureSections, voiceSection) {
  return [
    {
      name: "collection",
      path: ARCHIVE_PATHS.collection,
      count: collection.memories.length,
      required: true,
      version: ARCHIVE_SECTION_VERSION
    },
    {
      name: "media",
      path: ARCHIVE_PATHS.assets,
      count: media ? media.assets.length : 0,
      required: Boolean(media),
      version: ARCHIVE_SECTION_VERSION
    },
    ...featureSections.map((section) => ({
      name: section.name,
      path: section.path,
      count: section.count,
      required: section.required,
      version: section.version
    })),
    ...(voiceSection ? [{
      name: voiceSection.name,
      path: voiceSection.path,
      count: voiceSection.count,
      required: voiceSection.required,
      version: voiceSection.version
    }] : [])
  ];
}

function extractFeatureSectionsForWrite(collection, mode, schemaVersion) {
  const sections = [];
  for (const definition of FEATURE_ARCHIVE_SECTIONS) {
    const active = schemaVersion >= definition.sinceSchemaVersion;
    const present = Object.hasOwn(collection, definition.collectionKey);
    if (mode === "full" && active && !present) {
      throw mediaArchiveError(
        `完整 schema ${schemaVersion} 归档缺少必需的 ${definition.name} 数据。`,
        "MEDIA_ARCHIVE_REQUIRED_SECTION_MISSING"
      );
    }
    if (!present) continue;
    if (!active) {
      throw mediaArchiveError(
        `${definition.name} 数据不能由 schema ${schemaVersion} 归档声明。`,
        "MEDIA_ARCHIVE_FEATURE_SCHEMA_INVALID"
      );
    }
    const payload = collection[definition.collectionKey];
    const count = validateFeaturePayload(definition, payload, mode);
    delete collection[definition.collectionKey];
    sections.push({
      ...definition,
      payload,
      count,
      required: mode === "full"
    });
  }
  return sections;
}

function readFeatureSections(manifest, verifiedByPath, collection) {
  const output = {};
  const mode = manifest.mode;
  if (manifest.formatVersion === LEGACY_ARCHIVE_FORMAT_VERSION) {
    for (const definition of FEATURE_ARCHIVE_SECTIONS) {
      const active = manifest.schemaVersion >= definition.sinceSchemaVersion;
      const present = Object.hasOwn(collection, definition.collectionKey);
      if (mode === "full" && active && !present) {
        throw mediaArchiveError(
          `完整旧归档缺少必需的 ${definition.name} 数据。`,
          "MEDIA_ARCHIVE_REQUIRED_SECTION_MISSING"
        );
      }
      if (!present) continue;
      if (!active) {
        throw mediaArchiveError("旧归档的功能数据与 schema 版本不一致。", "MEDIA_ARCHIVE_FEATURE_SCHEMA_INVALID");
      }
      validateFeaturePayload(definition, collection[definition.collectionKey], mode);
      output[definition.collectionKey] = collection[definition.collectionKey];
    }
    return output;
  }

  const sectionsByName = new Map(manifest.sections.map((section) => [section.name, section]));
  for (const definition of FEATURE_ARCHIVE_SECTIONS) {
    if (Object.hasOwn(collection, definition.collectionKey)) {
      throw mediaArchiveError(
        `${definition.name} 不能同时出现在 collection 与独立 section。`,
        "MEDIA_ARCHIVE_SECTIONS_INVALID"
      );
    }
    const section = sectionsByName.get(definition.name);
    if (!section) continue;
    const filePath = requiredVerifiedPath(verifiedByPath, definition.path);
    const payload = readJsonFile(filePath);
    const count = validateFeaturePayload(definition, payload, mode);
    if (section.count !== count) {
      throw mediaArchiveError(`${definition.name} section 计数与内容不一致。`, "MEDIA_ARCHIVE_SECTIONS_INVALID");
    }
    collection[definition.collectionKey] = payload;
    output[definition.collectionKey] = payload;
  }
  return output;
}

function validateFeaturePayload(definition, payload, mode) {
  assertPlainObject(payload, `${definition.name} section`);
  if (mode === "full") {
    assertExactObjectKeys(payload, ["mode", "schemaVersion", definition.recordsKey], `${definition.name} full section`);
    if (payload.mode !== "full" || payload.schemaVersion !== definition.sinceSchemaVersion) {
      throw mediaArchiveError(`${definition.name} 完整备份的模式或 schema 版本无效。`, "MEDIA_ARCHIVE_FEATURE_INVALID");
    }
    const records = payload[definition.recordsKey];
    if (!Array.isArray(records) || records.length > definition.maximumRecords) {
      throw mediaArchiveError(`${definition.name} 完整备份记录数量无效。`, "MEDIA_ARCHIVE_FEATURE_INVALID");
    }
    return records.length;
  }

  assertExactObjectKeys(payload, ["mode", "note", ...definition.summaryCountKeys], `${definition.name} redacted section`);
  if (payload.mode !== "redacted-summary" || Object.hasOwn(payload, definition.recordsKey)) {
    throw mediaArchiveError(`${definition.name} 脱敏 section 仍包含完整记录。`, "MEDIA_ARCHIVE_FEATURE_INVALID");
  }
  for (const countKey of definition.summaryCountKeys) {
    const count = payload[countKey];
    if (!Number.isSafeInteger(count) || count < 0 || count > definition.maximumRecords) {
      throw mediaArchiveError(`${definition.name} 脱敏 section 计数无效。`, "MEDIA_ARCHIVE_FEATURE_INVALID");
    }
  }
  requireString(payload.note, `${definition.name}.note`, 240);
  if (definition.redactedNote && payload.note !== definition.redactedNote) {
    throw mediaArchiveError(`${definition.name} 脱敏 section 的固定隐私说明无效。`, "MEDIA_ARCHIVE_FEATURE_INVALID");
  }
  const count = payload[definition.summaryCountKey];
  if (definition.summaryCountKeys.some((countKey) => payload[countKey] > count)) {
    throw mediaArchiveError(`${definition.name} 脱敏 section 统计互相矛盾。`, "MEDIA_ARCHIVE_FEATURE_INVALID");
  }
  return count;
}

function assertExactObjectKeys(value, expected, name) {
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (keys.length !== wanted.length || keys.some((key, index) => key !== wanted[index])) {
    throw mediaArchiveError(`${name} 字段无效。`, "MEDIA_ARCHIVE_FEATURE_INVALID");
  }
}

function selectReferencedMedia(memoryIds, store) {
  const assetsById = new Map();
  const links = [];
  const linkKeys = new Set();
  for (const memoryId of [...memoryIds].sort()) {
    const media = store.listMediaForMemory(memoryId);
    if (!Array.isArray(media)) throw mediaArchiveError("媒体关联查询结果无效。", "MEDIA_ARCHIVE_STORE_INVALID");
    if (media.length > MAX_MEDIA_PER_MEMORY) {
      throw mediaArchiveError(
        `展品 ${memoryId} 超过 ${MAX_MEDIA_PER_MEMORY} 张图片。`,
        "MEDIA_ARCHIVE_LIMIT_EXCEEDED"
      );
    }
    for (const item of media) {
      assertPlainObject(item, "media link");
      const assetId = requireId(item.assetId, "media link.assetId");
      const asset = item.asset || store.getMediaAsset(assetId);
      if (!asset || asset.status !== "ready") {
        throw mediaArchiveError(`展品 ${memoryId} 引用了未就绪的媒体资产。`, "MEDIA_ARCHIVE_ASSET_NOT_READY");
      }
      if (asset.id !== assetId) {
        throw mediaArchiveError("媒体关联与资产 ID 不一致。", "MEDIA_ARCHIVE_REFERENCE_INVALID");
      }
      const key = `${memoryId}\u0000${assetId}`;
      if (linkKeys.has(key)) throw mediaArchiveError("媒体关联存在重复项。", "MEDIA_ARCHIVE_REFERENCE_DUPLICATE");
      linkKeys.add(key);
      links.push(archiveLink({ ...item, memoryId, assetId }));

      const variants = Array.isArray(item.variants) && item.variants.length
        ? item.variants
        : (Array.isArray(asset.variants) && asset.variants.length
            ? asset.variants
            : store.listMediaVariants(assetId));
      const existing = assetsById.get(assetId);
      if (existing && existing.asset.contentSha256 !== asset.contentSha256) {
        throw mediaArchiveError("同一媒体 ID 返回了相互矛盾的资产记录。", "MEDIA_ARCHIVE_ASSET_CONFLICT");
      }
      if (!existing) assetsById.set(assetId, { asset, variants });
    }
  }
  links.sort((left, right) => (
    left.memoryId.localeCompare(right.memoryId, "en") ||
    left.position - right.position ||
    left.assetId.localeCompare(right.assetId, "en")
  ));
  return {
    assets: [...assetsById.values()].sort((left, right) => left.asset.id.localeCompare(right.asset.id, "en")),
    links
  };
}

function normalizeExportVariants(asset, variants, storage, imageEntries) {
  requireId(asset.id, "asset.id");
  requireSha256(asset.contentSha256, "asset.contentSha256");
  if (!Array.isArray(variants)) throw mediaArchiveError("媒体变体列表无效。", "MEDIA_ARCHIVE_VARIANTS_INVALID");
  const byKind = new Map();
  for (const variant of variants) {
    assertPlainObject(variant, "media variant");
    const kind = requireEnum(variant.kind, VARIANT_KINDS, "variant.kind");
    if (byKind.has(kind)) throw mediaArchiveError("媒体资产包含重复变体。", "MEDIA_ARCHIVE_VARIANT_DUPLICATE");
    if (variant.assetId !== asset.id) throw mediaArchiveError("媒体变体引用了错误资产。", "MEDIA_ARCHIVE_REFERENCE_INVALID");
    const mimeType = requireEnum(variant.mimeType, IMAGE_MIME_TYPES, "variant.mimeType");
    const filePath = storage.resolveStorageKey(variant.storageKey);
    let data;
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) throw new Error("not a regular file");
      data = fs.readFileSync(filePath);
    } catch (cause) {
      throw mediaArchiveError(`媒体文件不可读取：${asset.id}/${kind}`, "MEDIA_ARCHIVE_FILE_MISSING", cause);
    }
    verifyVariantBytes(variant, data, mimeType, `${asset.id}/${kind}`);
    const archivePath = variantArchivePath(asset.id, kind, mimeType);
    imageEntries.push({ path: archivePath, mime: mimeType, data });
    byKind.set(kind, {
      assetId: asset.id,
      kind,
      archivePath,
      mimeType,
      byteSize: data.length,
      width: requirePositiveInteger(variant.width, "variant.width"),
      height: requirePositiveInteger(variant.height, "variant.height"),
      sha256: requireSha256(variant.sha256, "variant.sha256"),
      createdAt: optionalString(variant.createdAt),
      updatedAt: optionalString(variant.updatedAt)
    });
  }
  assertRequiredVariants(asset, byKind);
  return [...byKind.values()].sort((left, right) => variantOrder(left.kind) - variantOrder(right.kind));
}

function verifyVariantBytes(variant, data, declaredMime, label) {
  if (requirePositiveInteger(variant.byteSize, "variant.byteSize") !== data.length) {
    throw mediaArchiveError(`媒体字节数不一致：${label}`, "MEDIA_ARCHIVE_BYTES_MISMATCH");
  }
  if (requireSha256(variant.sha256, "variant.sha256") !== sha256(data)) {
    throw mediaArchiveError(`媒体哈希不一致：${label}`, "MEDIA_ARCHIVE_HASH_MISMATCH");
  }
  let image;
  try {
    image = inspectImage(data, { maxBytes: Math.max(data.length, 1), allowedMimeTypes: [...IMAGE_MIME_TYPES] });
  } catch (cause) {
    throw mediaArchiveError(`媒体内容不是有效图片：${label}`, "MEDIA_ARCHIVE_MIME_INVALID", cause);
  }
  if (image.mimeType !== declaredMime) {
    throw mediaArchiveError(`媒体真实格式与记录不一致：${label}`, "MEDIA_ARCHIVE_MIME_MISMATCH");
  }
  if (image.width !== Number(variant.width) || image.height !== Number(variant.height)) {
    throw mediaArchiveError(`媒体尺寸与记录不一致：${label}`, "MEDIA_ARCHIVE_DIMENSIONS_MISMATCH");
  }
}

function assertRequiredVariants(asset, byKind) {
  if (!byKind.has("display") || !byKind.has("thumb")) {
    throw mediaArchiveError("就绪媒体必须包含展示图和缩略图。", "MEDIA_ARCHIVE_VARIANT_MISSING");
  }
  if (asset.privacyMode === "preserve_original" && !byKind.has("original")) {
    throw mediaArchiveError("保留原图的媒体缺少 original 变体。", "MEDIA_ARCHIVE_VARIANT_MISSING");
  }
  if (asset.privacyMode === "sanitized_only" && byKind.has("original")) {
    throw mediaArchiveError("仅脱敏媒体不能包含 original 变体。", "MEDIA_ARCHIVE_PRIVACY_INVALID");
  }
}

function archiveAsset(asset, variants) {
  const display = variants.find((variant) => variant.kind === "display");
  const canonical = asset.privacyMode === "sanitized_only"
    ? display
    : variants.find((variant) => variant.kind === "original");
  if (canonical.sha256 !== asset.contentSha256 ||
      canonical.mimeType !== asset.sourceMimeType ||
      canonical.byteSize !== Number(asset.sourceByteSize)) {
    throw mediaArchiveError("媒体规范来源与资产记录不一致。", "MEDIA_ARCHIVE_ASSET_CONFLICT");
  }
  if (display.width !== Number(asset.width) || display.height !== Number(asset.height)) {
    throw mediaArchiveError("展示图尺寸与资产记录不一致。", "MEDIA_ARCHIVE_DIMENSIONS_MISMATCH");
  }
  return {
    id: requireId(asset.id, "asset.id"),
    schemaVersion: Number.isSafeInteger(asset.schemaVersion) ? asset.schemaVersion : 4,
    contentSha256: requireSha256(asset.contentSha256, "asset.contentSha256"),
    originalName: optionalString(asset.originalName),
    sourceMimeType: requireEnum(asset.sourceMimeType, IMAGE_MIME_TYPES, "asset.sourceMimeType"),
    sourceByteSize: requirePositiveInteger(asset.sourceByteSize, "asset.sourceByteSize"),
    width: requirePositiveInteger(asset.width, "asset.width"),
    height: requirePositiveInteger(asset.height, "asset.height"),
    storageDriver: "local",
    privacyMode: requireEnum(asset.privacyMode, new Set(["preserve_original", "sanitized_only"]), "asset.privacyMode"),
    status: "ready",
    safeMetadata: cloneJson(assertPlainObject(asset.safeMetadata || {}, "asset.safeMetadata")),
    createdAt: optionalString(asset.createdAt),
    updatedAt: optionalString(asset.updatedAt),
    variants
  };
}

function archiveLink(item) {
  return {
    memoryId: requireId(item.memoryId, "link.memoryId"),
    assetId: requireId(item.assetId, "link.assetId"),
    role: requireEnum(item.role, MEDIA_ROLES, "link.role"),
    position: requireNonNegativeInteger(item.position, "link.position"),
    caption: optionalString(item.caption),
    altText: optionalString(item.altText),
    backNote: optionalString(item.backNote),
    metadata: cloneJson(assertPlainObject(item.metadata || {}, "link.metadata")),
    createdAt: optionalString(item.createdAt),
    updatedAt: optionalString(item.updatedAt)
  };
}

function selectObservations(assets, memoryIds, linkKeys, store) {
  const observations = [];
  const seen = new Set();
  for (const asset of assets) {
    const listed = store.listMediaObservations({ assetId: asset.id, limit: 1000 });
    if (!Array.isArray(listed)) throw mediaArchiveError("媒体观察查询结果无效。", "MEDIA_ARCHIVE_STORE_INVALID");
    for (const item of listed) {
      assertPlainObject(item, "media observation");
      const memoryId = typeof item.metadata?.memoryId === "string" ? item.metadata.memoryId : "";
      if (memoryId && !memoryIds.has(memoryId)) continue;
      if (memoryId && !linkKeys.has(`${memoryId}\u0000${asset.id}`)) {
        throw mediaArchiveError("图片观察引用了未关联的展品。", "MEDIA_ARCHIVE_REFERENCE_INVALID");
      }
      const archived = archiveObservation(item, asset.id);
      assertObservationPrivacy(archived, asset.privacyMode, "MEDIA_ARCHIVE_OBSERVATION_PRIVACY_INVALID");
      if (seen.has(archived.id)) throw mediaArchiveError("媒体观察 ID 重复。", "MEDIA_ARCHIVE_REFERENCE_DUPLICATE");
      seen.add(archived.id);
      observations.push(archived);
    }
  }
  return observations.sort((left, right) => left.id.localeCompare(right.id, "en"));
}

function archiveObservation(item, assetId) {
  if (item.assetId !== assetId) throw mediaArchiveError("媒体观察引用了错误资产。", "MEDIA_ARCHIVE_REFERENCE_INVALID");
  return {
    id: requireId(item.id, "observation.id"),
    assetId,
    kind: requireToken(item.kind, "observation.kind", 40),
    source: requireEnum(item.source, OBSERVATION_SOURCES, "observation.source"),
    value: cloneJson(item.value),
    status: requireEnum(item.status, OBSERVATION_STATUSES, "observation.status"),
    confidence: normalizeConfidence(item.confidence),
    sensitive: Boolean(item.sensitive),
    metadata: cloneJson(assertPlainObject(item.metadata || {}, "observation.metadata")),
    createdAt: optionalString(item.createdAt),
    updatedAt: optionalString(item.updatedAt)
  };
}

function validateManifest(manifest, extractedByPath) {
  assertPlainObject(manifest, "manifest");
  if (manifest.format !== ARCHIVE_FORMAT || !SUPPORTED_ARCHIVE_FORMAT_VERSIONS.has(manifest.formatVersion)) {
    throw mediaArchiveError("归档格式或版本不受支持。", "MEDIA_ARCHIVE_FORMAT_UNSUPPORTED");
  }
  if (manifest.extension !== ".time-isle" || manifest.collectionPath !== ARCHIVE_PATHS.collection) {
    throw mediaArchiveError("归档入口声明无效。", "MEDIA_ARCHIVE_MANIFEST_INVALID");
  }
  if (!['full', 'redacted'].includes(manifest.mode)) {
    throw mediaArchiveError("归档隐私模式无效。", "MEDIA_ARCHIVE_MANIFEST_INVALID");
  }
  requireVersion(manifest.appVersion, "manifest.appVersion");
  requireSchemaVersion(manifest.schemaVersion, "manifest.schemaVersion");
  if (!Array.isArray(manifest.entries) || manifest.entryCount !== manifest.entries.length) {
    throw mediaArchiveError("归档条目清单无效。", "MEDIA_ARCHIVE_MANIFEST_INVALID");
  }
  assertPlainObject(manifest.media, "manifest.media");
  const expectedExtracted = new Set([ARCHIVE_PATHS.manifest]);
  const seen = new Set();
  for (const entry of manifest.entries) {
    assertPlainObject(entry, "manifest entry");
    const entryPath = requireArchiveEntryPath(entry.path);
    if (entryPath === ARCHIVE_PATHS.manifest || seen.has(entryPath.toLowerCase())) {
      throw mediaArchiveError("归档清单包含重复或自引用条目。", "MEDIA_ARCHIVE_MANIFEST_INVALID");
    }
    seen.add(entryPath.toLowerCase());
    expectedExtracted.add(entryPath);
    requireSha256(entry.sha256, "manifest entry.sha256");
    requireNonNegativeInteger(entry.bytes, "manifest entry.bytes");
    requireEnum(entry.mime, new Set([JSON_MIME, ...IMAGE_MIME_TYPES, ...VOICE_MIME_TYPES]), "manifest entry.mime");
  }
  if (manifest.formatVersion === ARCHIVE_FORMAT_VERSION) validateArchiveSections(manifest);
  for (const entryPath of expectedExtracted) {
    if (!extractedByPath.has(entryPath)) {
      throw mediaArchiveError(`归档缺少清单条目：${entryPath}`, "MEDIA_ARCHIVE_ENTRY_MISSING");
    }
  }
  for (const entryPath of extractedByPath.keys()) {
    if (!expectedExtracted.has(entryPath)) {
      throw mediaArchiveError(`归档含有未声明条目：${entryPath}`, "MEDIA_ARCHIVE_ENTRY_UNDECLARED");
    }
  }
  return manifest.entries;
}

function validateArchiveSections(manifest) {
  if (!Array.isArray(manifest.sections)) {
    throw mediaArchiveError("V2 归档必须包含 sections 清单。", "MEDIA_ARCHIVE_SECTIONS_INVALID");
  }
  const sectionsByName = new Map();
  const seenPaths = new Set();
  const entriesByPath = new Map(manifest.entries.map((entry) => [entry.path, entry]));
  const expectedKeys = ["count", "name", "path", "required", "version"];

  for (let index = 0; index < manifest.sections.length; index += 1) {
    const section = manifest.sections[index];
    assertPlainObject(section, `manifest.sections[${index}]`);
    const keys = Object.keys(section).sort();
    if (keys.length !== expectedKeys.length || keys.some((key, keyIndex) => key !== expectedKeys[keyIndex])) {
      throw mediaArchiveError("归档 section 字段无效。", "MEDIA_ARCHIVE_SECTIONS_INVALID");
    }
    const name = requireToken(section.name, `manifest.sections[${index}].name`, 64);
    if (name !== name.toLowerCase() || sectionsByName.has(name)) {
      throw mediaArchiveError("归档 section 名称无效或重复。", "MEDIA_ARCHIVE_SECTIONS_INVALID");
    }
    const sectionPath = requireArchiveEntryPath(section.path);
    const collisionKey = sectionPath.toLowerCase();
    if (seenPaths.has(collisionKey)) {
      throw mediaArchiveError("归档 section 路径重复。", "MEDIA_ARCHIVE_SECTIONS_INVALID");
    }
    seenPaths.add(collisionKey);
    requireNonNegativeInteger(section.count, `manifest.sections[${index}].count`);
    if (typeof section.required !== "boolean") {
      throw mediaArchiveError("归档 section 的 required 必须是布尔值。", "MEDIA_ARCHIVE_SECTIONS_INVALID");
    }
    requirePositiveInteger(section.version, `manifest.sections[${index}].version`);

    if (!KNOWN_ARCHIVE_SECTIONS.has(name)) {
      if (section.required) {
        throw mediaArchiveError(
          `归档包含当前版本无法恢复的必需 section：${name}。`,
          "MEDIA_ARCHIVE_REQUIRED_SECTION_UNSUPPORTED"
        );
      }
      if (sectionPath === ARCHIVE_PATHS.collection || RESERVED_ARCHIVE_PREFIXES.some((prefix) => sectionPath.startsWith(prefix))) {
        throw mediaArchiveError("未知可选 section 不能占用保留路径。", "MEDIA_ARCHIVE_SECTIONS_INVALID");
      }
      const descriptor = entriesByPath.get(sectionPath);
      if (section.count > 0 && !descriptor) {
        throw mediaArchiveError("非空可选 section 缺少清单条目。", "MEDIA_ARCHIVE_ENTRY_MISSING");
      }
      if (descriptor && descriptor.mime !== JSON_MIME) {
        throw mediaArchiveError("未知可选 section 的入口必须是 JSON。", "MEDIA_ARCHIVE_MIME_INVALID");
      }
    }
    sectionsByName.set(name, section);
  }

  const collection = sectionsByName.get("collection");
  const media = sectionsByName.get("media");
  if (!collection || !media) {
    throw mediaArchiveError("V2 归档缺少 collection 或 media section。", "MEDIA_ARCHIVE_SECTIONS_INVALID");
  }
  if (collection.path !== ARCHIVE_PATHS.collection || collection.required !== true || collection.version !== ARCHIVE_SECTION_VERSION) {
    throw mediaArchiveError("collection section 声明无效。", "MEDIA_ARCHIVE_SECTIONS_INVALID");
  }
  const collectionEntry = entriesByPath.get(collection.path);
  if (!collectionEntry || collectionEntry.mime !== JSON_MIME) {
    throw mediaArchiveError("collection section 缺少有效 JSON 入口。", "MEDIA_ARCHIVE_ENTRY_MISSING");
  }
  const mediaRequired = manifest.mode === "full";
  if (media.path !== ARCHIVE_PATHS.assets || media.required !== mediaRequired || media.version !== ARCHIVE_SECTION_VERSION) {
    throw mediaArchiveError("media section 声明与归档模式不一致。", "MEDIA_ARCHIVE_SECTIONS_INVALID");
  }
  const mediaEntry = entriesByPath.get(media.path);
  if ((mediaRequired && (!mediaEntry || mediaEntry.mime !== JSON_MIME)) || (!mediaRequired && mediaEntry)) {
    throw mediaArchiveError("media section 入口与归档模式不一致。", "MEDIA_ARCHIVE_SECTIONS_INVALID");
  }

  for (const definition of FEATURE_ARCHIVE_SECTIONS) {
    const section = sectionsByName.get(definition.name);
    const active = manifest.schemaVersion >= definition.sinceSchemaVersion;
    const required = manifest.mode === "full" && active;
    if (required && !section) {
      throw mediaArchiveError(
        `完整 schema ${manifest.schemaVersion} 归档缺少必需的 ${definition.name} section。`,
        "MEDIA_ARCHIVE_REQUIRED_SECTION_MISSING"
      );
    }
    if (!section) continue;
    if (!active) {
      throw mediaArchiveError(`${definition.name} section 与 manifest schema 不一致。`, "MEDIA_ARCHIVE_FEATURE_SCHEMA_INVALID");
    }
    if (section.path !== definition.path || section.version !== definition.version || section.required !== required) {
      throw mediaArchiveError(`${definition.name} section 声明无效。`, "MEDIA_ARCHIVE_SECTIONS_INVALID");
    }
    const entry = entriesByPath.get(section.path);
    if (!entry || entry.mime !== JSON_MIME) {
      throw mediaArchiveError(`${definition.name} section 缺少有效 JSON 入口。`, "MEDIA_ARCHIVE_ENTRY_MISSING");
    }
  }
  validateVoiceSectionDeclaration(manifest, sectionsByName, entriesByPath);
}

function validateIgnoredOptionalSectionEntries(manifest, verifiedByPath) {
  for (const sectionPath of ignoredOptionalSectionPaths(manifest)) {
    const entry = verifiedByPath.get(sectionPath);
    if (!entry || entry.mime !== JSON_MIME) {
      throw mediaArchiveError("可选 section 入口尚未通过完整性校验。", "MEDIA_ARCHIVE_ENTRY_MISSING");
    }
    readJsonFile(entry.filePath);
  }
}

function ignoredOptionalSectionPaths(manifest) {
  if (manifest.formatVersion !== ARCHIVE_FORMAT_VERSION || !Array.isArray(manifest.sections)) return [];
  const entryPaths = new Set(manifest.entries.map((entry) => entry.path));
  return manifest.sections
    .filter((section) => !KNOWN_ARCHIVE_SECTIONS.has(section.name) && section.required === false && entryPaths.has(section.path))
    .map((section) => section.path);
}

function knownFeatureSectionPaths(manifest) {
  if (manifest.formatVersion !== ARCHIVE_FORMAT_VERSION || !Array.isArray(manifest.sections)) return [];
  return manifest.sections
    .filter((section) => FEATURE_SECTION_BY_NAME.has(section.name))
    .map((section) => section.path);
}

function validateKnownSectionCounts(manifest, collectionCount, mediaCount) {
  if (manifest.formatVersion !== ARCHIVE_FORMAT_VERSION) return;
  const byName = new Map(manifest.sections.map((section) => [section.name, section]));
  if (byName.get("collection")?.count !== collectionCount || byName.get("media")?.count !== mediaCount) {
    throw mediaArchiveError("归档 section 计数与内容不一致。", "MEDIA_ARCHIVE_SECTIONS_INVALID");
  }
}

function verifyManifestEntries(manifestEntries, extractedByPath, stagingRoot) {
  const verified = new Map();
  for (const descriptor of manifestEntries) {
    const extracted = extractedByPath.get(descriptor.path);
    if (extracted.size !== descriptor.bytes) {
      throw mediaArchiveError(`归档条目字节数不一致：${descriptor.path}`, "MEDIA_ARCHIVE_BYTES_MISMATCH");
    }
    if (extracted.sha256 !== descriptor.sha256) {
      throw mediaArchiveError(`归档条目哈希不一致：${descriptor.path}`, "MEDIA_ARCHIVE_HASH_MISMATCH");
    }
    const filePath = resolveStagingFile(stagingRoot, descriptor.path);
    const data = fs.readFileSync(filePath);
    if (data.length !== descriptor.bytes || sha256(data) !== descriptor.sha256) {
      throw mediaArchiveError(`暂存条目完整性不一致：${descriptor.path}`, "MEDIA_ARCHIVE_HASH_MISMATCH");
    }
    let image = null;
    let voice = null;
    if (descriptor.mime === JSON_MIME) {
      decodeUtf8(data, descriptor.path);
    } else if (IMAGE_MIME_TYPES.has(descriptor.mime)) {
      try {
        image = inspectImage(data, { maxBytes: Math.max(data.length, 1), allowedMimeTypes: [...IMAGE_MIME_TYPES] });
      } catch (cause) {
        throw mediaArchiveError(`归档图片内容无效：${descriptor.path}`, "MEDIA_ARCHIVE_MIME_INVALID", cause);
      }
      if (image.mimeType !== descriptor.mime) {
        throw mediaArchiveError(`归档图片 MIME 不一致：${descriptor.path}`, "MEDIA_ARCHIVE_MIME_MISMATCH");
      }
    } else if (VOICE_MIME_TYPES.has(descriptor.mime)) {
      voice = verifyVoiceBytes(data, descriptor.mime, descriptor.path);
    } else {
      throw mediaArchiveError(`Unsupported archive MIME: ${descriptor.path}`, "MEDIA_ARCHIVE_MIME_INVALID");
    }
    verified.set(descriptor.path, { ...descriptor, filePath, image, voice });
  }
  return verified;
}

function validateCollectionForImport(collection, mode, limits) {
  assertCollection(collection);
  assertCollectionRecordLimit(collection, limits);
  const collectionMode = collection.mode === "redacted" ? "redacted" : "full";
  if (collectionMode !== mode) {
    throw mediaArchiveError("清单与馆藏的隐私模式不一致。", "MEDIA_ARCHIVE_MODE_MISMATCH");
  }
  collectionMemoryIds(collection);
}

function validateRedactedArchive(manifest, manifestEntries, collection, voiceSection) {
  validateKnownSectionCounts(manifest, collection.memories.length, 0);
  if (manifest.media.included !== false ||
      Number(manifest.media.assetCount) !== 0 ||
      Number(manifest.media.linkCount) !== 0 ||
      Number(manifest.media.observationCount) !== 0) {
    throw mediaArchiveError("脱敏归档不能声明媒体内容。", "MEDIA_ARCHIVE_REDACTED_MEDIA_FORBIDDEN");
  }
  const expectedPaths = new Set([
    ARCHIVE_PATHS.collection,
    ...knownFeatureSectionPaths(manifest),
    ...(voiceSection ? voiceSection.paths : []),
    ...ignoredOptionalSectionPaths(manifest)
  ]);
  if (manifestEntries.length !== expectedPaths.size || manifestEntries.some((entry) => !expectedPaths.has(entry.path))) {
    throw mediaArchiveError("脱敏归档包含媒体或额外条目。", "MEDIA_ARCHIVE_REDACTED_MEDIA_FORBIDDEN");
  }
  for (const memory of collection.memories) {
    if ((Array.isArray(memory.media) && memory.media.length) ||
        (Array.isArray(memory.attachments) && memory.attachments.length) ||
        memory.coverImage) {
      throw mediaArchiveError("脱敏馆藏仍包含媒体关联。", "MEDIA_ARCHIVE_REDACTED_MEDIA_FORBIDDEN");
    }
  }
}

function validateFullMediaArchive({
  manifest,
  manifestEntries,
  collection,
  assets,
  links,
  observations,
  voiceSection,
  verifiedByPath,
  limits
}) {
  if (manifest.media.included !== true ||
      manifest.media.assetsPath !== ARCHIVE_PATHS.assets ||
      manifest.media.linksPath !== ARCHIVE_PATHS.links ||
      manifest.media.observationsPath !== ARCHIVE_PATHS.observations) {
    throw mediaArchiveError("媒体清单入口无效。", "MEDIA_ARCHIVE_MANIFEST_INVALID");
  }
  if (!Array.isArray(assets) || assets.length > limits.maxAssets ||
      !Array.isArray(links) || links.length > limits.maxLinks ||
      !Array.isArray(observations) || observations.length > limits.maxObservations) {
    throw mediaArchiveError("媒体元数据数量无效或超过限制。", "MEDIA_ARCHIVE_LIMIT_EXCEEDED");
  }
  validateKnownSectionCounts(manifest, collection.memories.length, assets.length);
  if (manifest.media.assetCount !== assets.length ||
      manifest.media.linkCount !== links.length ||
      manifest.media.observationCount !== observations.length) {
    throw mediaArchiveError("媒体清单计数与内容不一致。", "MEDIA_ARCHIVE_MANIFEST_INVALID");
  }

  const memoryIds = collectionMemoryIds(collection);
  const assetIds = new Set();
  const assetPrivacyModes = new Map();
  const variantPaths = new Set();
  for (const asset of assets) validateImportedAsset(asset, assetIds, assetPrivacyModes, variantPaths, verifiedByPath);
  const linkKeys = validateImportedLinks(links, memoryIds, assetIds);
  for (const assetId of assetIds) {
    if (![...linkKeys].some((key) => key.endsWith(`\u0000${assetId}`))) {
      throw mediaArchiveError("归档包含未被展品引用的媒体资产。", "MEDIA_ARCHIVE_REFERENCE_INVALID");
    }
  }
  validateImportedObservations(observations, memoryIds, assetPrivacyModes, linkKeys);

  const expectedPaths = new Set([
    ARCHIVE_PATHS.collection,
    ARCHIVE_PATHS.assets,
    ARCHIVE_PATHS.links,
    ARCHIVE_PATHS.observations,
    ...variantPaths,
    ...knownFeatureSectionPaths(manifest),
    ...(voiceSection ? voiceSection.paths : []),
    ...ignoredOptionalSectionPaths(manifest)
  ]);
  if (manifestEntries.length !== expectedPaths.size ||
      manifestEntries.some((entry) => !expectedPaths.has(entry.path))) {
    throw mediaArchiveError("归档清单与媒体元数据条目不一致。", "MEDIA_ARCHIVE_ENTRY_UNDECLARED");
  }
}

function validateImportedAsset(asset, assetIds, assetPrivacyModes, variantPaths, verifiedByPath) {
  assertPlainObject(asset, "asset");
  const assetId = requireId(asset.id, "asset.id");
  if (assetIds.has(assetId)) throw mediaArchiveError("媒体资产 ID 重复。", "MEDIA_ARCHIVE_REFERENCE_DUPLICATE");
  assetIds.add(assetId);
  const contentSha256 = requireSha256(asset.contentSha256, "asset.contentSha256");
  const sourceMimeType = requireEnum(asset.sourceMimeType, IMAGE_MIME_TYPES, "asset.sourceMimeType");
  const sourceByteSize = requirePositiveInteger(asset.sourceByteSize, "asset.sourceByteSize");
  const width = requirePositiveInteger(asset.width, "asset.width");
  const height = requirePositiveInteger(asset.height, "asset.height");
  requirePortableFilename(asset.originalName, "asset.originalName");
  requireTimestamp(asset.createdAt, "asset.createdAt");
  requireTimestamp(asset.updatedAt, "asset.updatedAt");
  if (asset.storageDriver !== "local" || asset.status !== "ready") {
    throw mediaArchiveError("归档只能包含就绪的本地媒体资产。", "MEDIA_ARCHIVE_ASSET_INVALID");
  }
  const privacyMode = requireEnum(asset.privacyMode, new Set(["preserve_original", "sanitized_only"]), "asset.privacyMode");
  assetPrivacyModes.set(assetId, privacyMode);
  requireJsonObject(asset.safeMetadata || {}, "asset.safeMetadata", 65536);
  if (!Array.isArray(asset.variants) || asset.variants.length < 2 || asset.variants.length > 3) {
    throw mediaArchiveError("媒体变体数量无效。", "MEDIA_ARCHIVE_VARIANTS_INVALID");
  }
  const byKind = new Map();
  for (const variant of asset.variants) {
    assertPlainObject(variant, "variant");
    const kind = requireEnum(variant.kind, VARIANT_KINDS, "variant.kind");
    if (variant.assetId !== assetId || byKind.has(kind) || Object.hasOwn(variant, "storageKey")) {
      throw mediaArchiveError("媒体变体引用无效或重复。", "MEDIA_ARCHIVE_REFERENCE_INVALID");
    }
    const mimeType = requireEnum(variant.mimeType, IMAGE_MIME_TYPES, "variant.mimeType");
    const expectedPath = variantArchivePath(assetId, kind, mimeType);
    if (variant.archivePath !== expectedPath || variantPaths.has(expectedPath)) {
      throw mediaArchiveError("媒体变体归档路径无效或重复。", "MEDIA_ARCHIVE_PATH_INVALID");
    }
    const verified = verifiedByPath.get(expectedPath);
    if (!verified || verified.mime !== mimeType) {
      throw mediaArchiveError(`归档缺少媒体变体：${expectedPath}`, "MEDIA_ARCHIVE_ENTRY_MISSING");
    }
    if (verified.bytes !== requirePositiveInteger(variant.byteSize, "variant.byteSize") ||
        verified.sha256 !== requireSha256(variant.sha256, "variant.sha256")) {
      throw mediaArchiveError("媒体变体记录与清单不一致。", "MEDIA_ARCHIVE_HASH_MISMATCH");
    }
    if (verified.image.width !== requirePositiveInteger(variant.width, "variant.width") ||
        verified.image.height !== requirePositiveInteger(variant.height, "variant.height")) {
      throw mediaArchiveError("媒体变体尺寸与实际图片不一致。", "MEDIA_ARCHIVE_DIMENSIONS_MISMATCH");
    }
    requireTimestamp(variant.createdAt, "variant.createdAt");
    requireTimestamp(variant.updatedAt, "variant.updatedAt");
    if (["display", "thumb"].includes(kind) && mimeType !== "image/webp") {
      throw mediaArchiveError("展示图和缩略图必须是 WebP。", "MEDIA_ARCHIVE_MIME_MISMATCH");
    }
    variantPaths.add(expectedPath);
    byKind.set(kind, variant);
  }
  assertRequiredVariants({ privacyMode }, byKind);
  const display = byKind.get("display");
  const canonical = privacyMode === "sanitized_only" ? display : byKind.get("original");
  if (canonical.sha256 !== contentSha256 || canonical.mimeType !== sourceMimeType || canonical.byteSize !== sourceByteSize) {
    throw mediaArchiveError("媒体规范来源与资产记录不一致。", "MEDIA_ARCHIVE_ASSET_CONFLICT");
  }
  if (display.width !== width || display.height !== height) {
    throw mediaArchiveError("资产尺寸与展示图不一致。", "MEDIA_ARCHIVE_DIMENSIONS_MISMATCH");
  }
}

function validateImportedLinks(links, memoryIds, assetIds) {
  const linkKeys = new Set();
  const perMemory = new Map();
  for (const link of links) {
    assertPlainObject(link, "link");
    const memoryId = requireId(link.memoryId, "link.memoryId");
    const assetId = requireId(link.assetId, "link.assetId");
    if (!memoryIds.has(memoryId) || !assetIds.has(assetId)) {
      throw mediaArchiveError("媒体关联越过了当前馆藏边界。", "MEDIA_ARCHIVE_REFERENCE_FORBIDDEN");
    }
    const key = `${memoryId}\u0000${assetId}`;
    if (linkKeys.has(key)) throw mediaArchiveError("媒体关联重复。", "MEDIA_ARCHIVE_REFERENCE_DUPLICATE");
    linkKeys.add(key);
    const role = requireEnum(link.role, MEDIA_ROLES, "link.role");
    const position = requireNonNegativeInteger(link.position, "link.position");
    requireString(link.caption, "link.caption", 1000, true);
    requireString(link.altText, "link.altText", 1000, true);
    requireString(link.backNote, "link.backNote", 4000, true);
    requireJsonObject(link.metadata || {}, "link.metadata", 32768);
    requireTimestamp(link.createdAt, "link.createdAt");
    requireTimestamp(link.updatedAt, "link.updatedAt");
    const group = perMemory.get(memoryId) || [];
    group.push({ position, role });
    perMemory.set(memoryId, group);
  }
  for (const group of perMemory.values()) {
    const positions = group.map((item) => item.position).sort((a, b) => a - b);
    if (group.length > MAX_MEDIA_PER_MEMORY || positions.some((position, index) => position !== index) || group.filter((item) => item.role === "cover").length !== 1) {
      throw mediaArchiveError("展品图片排序或封面关联无效。", "MEDIA_ARCHIVE_LINK_ORDER_INVALID");
    }
  }
  return linkKeys;
}

function validateImportedObservations(observations, memoryIds, assetPrivacyModes, linkKeys) {
  const ids = new Set();
  for (const observation of observations) {
    assertPlainObject(observation, "observation");
    const id = requireId(observation.id, "observation.id");
    const assetId = requireId(observation.assetId, "observation.assetId");
    if (ids.has(id)) throw mediaArchiveError("媒体观察 ID 重复。", "MEDIA_ARCHIVE_REFERENCE_DUPLICATE");
    ids.add(id);
    if (!assetPrivacyModes.has(assetId)) throw mediaArchiveError("媒体观察引用了未知资产。", "MEDIA_ARCHIVE_REFERENCE_FORBIDDEN");
    requireToken(observation.kind, "observation.kind", 40);
    requireEnum(observation.source, OBSERVATION_SOURCES, "observation.source");
    requireEnum(observation.status, OBSERVATION_STATUSES, "observation.status");
    normalizeConfidence(observation.confidence);
    requireJsonValue(observation.value, "observation.value", 65536);
    if (typeof observation.sensitive !== "boolean") {
      throw mediaArchiveError("媒体观察敏感标记无效。", "MEDIA_ARCHIVE_OBSERVATION_INVALID");
    }
    requireJsonObject(observation.metadata || {}, "observation.metadata", 32768);
    requireTimestamp(observation.createdAt, "observation.createdAt");
    requireTimestamp(observation.updatedAt, "observation.updatedAt");
    assertObservationPrivacy(
      observation,
      assetPrivacyModes.get(assetId),
      "MEDIA_ARCHIVE_OBSERVATION_PRIVACY_INVALID"
    );
    const memoryId = observation.metadata?.memoryId;
    if (memoryId !== undefined) {
      requireId(memoryId, "observation.metadata.memoryId");
      if (!memoryIds.has(memoryId) || !linkKeys.has(`${memoryId}\u0000${assetId}`)) {
        throw mediaArchiveError("媒体观察越过了当前馆藏边界。", "MEDIA_ARCHIVE_REFERENCE_FORBIDDEN");
      }
    }
  }
}

function buildPreparedDescriptor({ stagingRoot, manifest, collection, assets, links, observations, featureSections, voiceSection, verifiedByPath }) {
  const variants = assets.flatMap((asset) => asset.variants.map((variant) => ({
    assetId: asset.id,
    kind: variant.kind,
    archivePath: variant.archivePath,
    filePath: verifiedByPath.get(variant.archivePath).filePath,
    mimeType: variant.mimeType,
    byteSize: variant.byteSize,
    sha256: variant.sha256,
    width: variant.width,
    height: variant.height
  })));
  return {
    verified: true,
    stagingRoot,
    manifest,
    collection,
    descriptor: { assets, links, mediaObservations: observations },
    exhibitions: featureSections.exhibitions || null,
    revisits: featureSections.revisits || null,
    entities: featureSections.entities || null,
    capsules: featureSections.capsules || null,
    voices: voiceSection?.state || null,
    assets,
    links,
    mediaObservations: observations,
    media_observations: observations,
    files: {
      manifest: resolveStagingFile(stagingRoot, ARCHIVE_PATHS.manifest),
      collection: resolveStagingFile(stagingRoot, ARCHIVE_PATHS.collection),
      assets: manifest.mode === "full" ? resolveStagingFile(stagingRoot, ARCHIVE_PATHS.assets) : null,
      links: manifest.mode === "full" ? resolveStagingFile(stagingRoot, ARCHIVE_PATHS.links) : null,
      mediaObservations: manifest.mode === "full"
        ? resolveStagingFile(stagingRoot, ARCHIVE_PATHS.observations)
        : null,
      variants,
      voices: voiceSection?.files || []
    }
  };
}

function sanitizeRedactedCollection(collection) {
  const safe = cloneJson(collection);
  for (const key of ["media", "assets", "mediaAssets", "media_assets", "links", "observations", "mediaObservations", "media_observations"]) {
    delete safe[key];
  }
  safe.mode = "redacted";
  safe.memories = safe.memories.map((memory) => ({
    ...memory,
    coverImage: "",
    mediaNote: memory.mediaNote ? "[已隐藏媒体备注]" : "",
    attachments: [],
    media: [],
    mediaSummary: {
      count: Number(memory.mediaSummary?.count) || (Array.isArray(memory.media) ? memory.media.length : 0),
      coverAssetId: "",
      coverThumbnailUrl: ""
    }
  }));
  return safe;
}

function assertCollection(value) {
  assertPlainObject(value, "collection");
  if (!Array.isArray(value.memories)) throw mediaArchiveError("collection.memories 必须是数组。", "MEDIA_ARCHIVE_COLLECTION_INVALID");
  return value;
}

function collectionMemoryIds(collection) {
  const ids = new Set();
  for (const memory of collection.memories) {
    assertPlainObject(memory, "memory");
    const id = requireId(memory.id, "memory.id");
    if (ids.has(id)) throw mediaArchiveError("馆藏包含重复的记忆 ID。", "MEDIA_ARCHIVE_COLLECTION_INVALID");
    ids.add(id);
  }
  return ids;
}

function assertStoreAndStorage(store, storage) {
  const storeMethods = ["listMediaForMemory", "getMediaAsset", "listMediaVariants", "listMediaObservations"];
  if (!store || storeMethods.some((name) => typeof store[name] !== "function")) {
    throw mediaArchiveError("媒体归档缺少 store 能力。", "MEDIA_ARCHIVE_DEPENDENCY_INVALID");
  }
  if (!storage || typeof storage.resolveStorageKey !== "function") {
    throw mediaArchiveError("媒体归档缺少 storage 能力。", "MEDIA_ARCHIVE_DEPENDENCY_INVALID");
  }
}

function describeEntry(entry) {
  return {
    path: entry.path,
    sha256: sha256(entry.data),
    bytes: entry.data.length,
    mime: entry.mime
  };
}

function variantArchivePath(assetId, kind, mimeType) {
  requireId(assetId, "assetId");
  requireEnum(kind, VARIANT_KINDS, "variant kind");
  const extension = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" })[mimeType];
  if (!extension) throw mediaArchiveError("媒体 MIME 不受支持。", "MEDIA_ARCHIVE_MIME_INVALID");
  return `media/assets/${assetId}/${kind}.${extension}`;
}

function variantOrder(kind) {
  return ({ original: 0, display: 1, thumb: 2 })[kind];
}

function normalizeLimits(value) {
  if (value === undefined) return { ...MEDIA_ARCHIVE_LIMITS };
  assertPlainObject(value, "options.limits");
  const limits = {};
  for (const [name, fallback] of Object.entries(MEDIA_ARCHIVE_LIMITS)) {
    const supplied = value[name];
    const minimum = name === "maxEntries" ? 1 : 0;
    if (supplied === undefined) {
      limits[name] = fallback;
      continue;
    }
    limits[name] = requireLimitInteger(supplied, `options.limits.${name}`, minimum);
    if (limits[name] > fallback) {
      throw mediaArchiveError(
        `options.limits.${name} 不能高于发布策略上限 ${fallback}。`,
        "MEDIA_ARCHIVE_VALUE_INVALID"
      );
    }
  }
  return limits;
}

function assertCollectionRecordLimit(collection, limits) {
  assertRecordLimit(collection.memories, limits.maxMemories, "展品");
}

function assertRecordLimit(items, maximum, label) {
  if (!Array.isArray(items) || items.length > maximum) {
    throw mediaArchiveError(`${label}数量超过归档上限 ${maximum}。`, "MEDIA_ARCHIVE_LIMIT_EXCEEDED");
  }
}

function assertArchiveEntryLimits(entries, limits) {
  if (entries.length > limits.maxEntries) {
    throw mediaArchiveError(`归档条目数量超过上限 ${limits.maxEntries}。`, "MEDIA_ARCHIVE_LIMIT_EXCEEDED");
  }
  let totalBytes = 0;
  for (const entry of entries) {
    if (!Buffer.isBuffer(entry.data) || entry.data.length > limits.maxEntryBytes) {
      throw mediaArchiveError(`归档条目 ${entry.path} 超过单项字节上限。`, "MEDIA_ARCHIVE_LIMIT_EXCEEDED");
    }
    totalBytes += entry.data.length;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > limits.maxTotalBytes) {
      throw mediaArchiveError("归档总字节数超过上限。", "MEDIA_ARCHIVE_LIMIT_EXCEEDED");
    }
  }
}

function assertObservationPrivacy(observation, privacyMode, code) {
  const violation = mediaObservationPolicyViolation(observation, privacyMode);
  if (violation) throw mediaArchiveError(violation, code);
}

function requireLimitInteger(value, name, minimum) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw mediaArchiveError(`${name} 必须是大于等于 ${minimum} 的整数。`, "MEDIA_ARCHIVE_VALUE_INVALID");
  }
  return value;
}

function prepareEmptyStagingRoot(stagingRoot) {
  if (!fs.existsSync(stagingRoot)) return false;
  const stat = fs.lstatSync(stagingRoot);
  if (stat.isSymbolicLink() || !stat.isDirectory() || fs.readdirSync(stagingRoot).length) {
    throw mediaArchiveError("stagingRoot 必须是不存在或为空的真实目录。", "MEDIA_ARCHIVE_STAGING_INVALID");
  }
  return true;
}

function cleanupRejectedStagingRoot(stagingRoot, existed) {
  try {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
    if (existed) fs.mkdirSync(stagingRoot, { recursive: true, mode: 0o700 });
  } catch {
    // Best effort: no unverified descriptor is returned even if OS cleanup fails.
  }
}

function requiredExtractedPath(extractedByPath, stagingRoot, archivePath) {
  if (!extractedByPath.has(archivePath)) {
    throw mediaArchiveError(`归档缺少 ${archivePath}。`, "MEDIA_ARCHIVE_ENTRY_MISSING");
  }
  return resolveStagingFile(stagingRoot, archivePath);
}

function requiredVerifiedPath(verifiedByPath, archivePath) {
  const entry = verifiedByPath.get(archivePath);
  if (!entry || entry.mime !== JSON_MIME) {
    throw mediaArchiveError(`归档缺少 JSON 条目 ${archivePath}。`, "MEDIA_ARCHIVE_ENTRY_MISSING");
  }
  return entry.filePath;
}

function resolveStagingFile(stagingRoot, archivePath) {
  const target = path.resolve(stagingRoot, ...archivePath.split("/"));
  const relative = path.relative(stagingRoot, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw mediaArchiveError("归档暂存路径越界。", "MEDIA_ARCHIVE_PATH_INVALID");
  }
  return target;
}

function requireArchiveEntryPath(value) {
  if (typeof value !== "string" || !value || value.includes("\\") || value.startsWith("/") || /^[a-zA-Z]:/.test(value)) {
    throw mediaArchiveError("清单条目路径无效。", "MEDIA_ARCHIVE_PATH_INVALID");
  }
  const segments = value.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw mediaArchiveError("清单条目路径越界。", "MEDIA_ARCHIVE_PATH_INVALID");
  }
  return value;
}

function readJsonFile(filePath) {
  let text;
  try {
    text = decodeUtf8(fs.readFileSync(filePath), path.basename(filePath));
    return JSON.parse(text);
  } catch (cause) {
    if (String(cause?.code || "").startsWith("MEDIA_ARCHIVE_")) throw cause;
    throw mediaArchiveError(`JSON 条目无法解析：${path.basename(filePath)}`, "MEDIA_ARCHIVE_JSON_INVALID", cause);
  }
}

function decodeUtf8(data, label) {
  try {
    return utf8Decoder.decode(data);
  } catch (cause) {
    throw mediaArchiveError(`条目不是有效 UTF-8：${label}`, "MEDIA_ARCHIVE_JSON_INVALID", cause);
  }
}

function jsonBuffer(value) {
  try {
    return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  } catch (cause) {
    throw mediaArchiveError("归档数据无法序列化为 JSON。", "MEDIA_ARCHIVE_JSON_INVALID", cause);
  }
}

function cloneJson(value) {
  if (value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (cause) {
    throw mediaArchiveError("归档数据必须是可序列化的 JSON。", "MEDIA_ARCHIVE_JSON_INVALID", cause);
  }
}

function sha256(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function requireId(value, name) {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    throw mediaArchiveError(`${name} 无效。`, "MEDIA_ARCHIVE_REFERENCE_INVALID");
  }
  return value;
}

function requireSha256(value, name) {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    throw mediaArchiveError(`${name} 无效。`, "MEDIA_ARCHIVE_HASH_INVALID");
  }
  return value;
}

function requireEnum(value, allowed, name) {
  if (typeof value !== "string" || !allowed.has(value)) {
    throw mediaArchiveError(`${name} 无效。`, "MEDIA_ARCHIVE_VALUE_INVALID");
  }
  return value;
}

function requireToken(value, name, maxLength) {
  if (typeof value !== "string" || !value || value.length > maxLength || !/^[a-zA-Z0-9_-]+$/.test(value)) {
    throw mediaArchiveError(`${name} 无效。`, "MEDIA_ARCHIVE_VALUE_INVALID");
  }
  return value;
}

function requirePositiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw mediaArchiveError(`${name} 必须是正整数。`, "MEDIA_ARCHIVE_VALUE_INVALID");
  }
  return value;
}

function requireNonNegativeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw mediaArchiveError(`${name} 必须是非负整数。`, "MEDIA_ARCHIVE_VALUE_INVALID");
  }
  return value;
}

function requireString(value, name, maximumLength, allowEmpty = false) {
  if (typeof value !== "string" || (!allowEmpty && !value) || value.length > maximumLength || value.includes("\u0000")) {
    throw mediaArchiveError(`${name} 无效。`, "MEDIA_ARCHIVE_VALUE_INVALID");
  }
  return value;
}

function requirePortableFilename(value, name) {
  const filename = requireString(value, name, 255, true);
  if (/[\\/]/.test(filename) || filename === "." || filename === "..") {
    throw mediaArchiveError(`${name} 不能包含路径。`, "MEDIA_ARCHIVE_VALUE_INVALID");
  }
  return filename;
}

function requireTimestamp(value, name) {
  if (typeof value !== "string" || !value || value.length > 40 || !Number.isFinite(Date.parse(value))) {
    throw mediaArchiveError(`${name} 必须是有效时间。`, "MEDIA_ARCHIVE_VALUE_INVALID");
  }
  return value;
}

function requireJsonObject(value, name, maximumBytes) {
  assertPlainObject(value, name);
  requireJsonValue(value, name, maximumBytes);
  return value;
}

function requireJsonValue(value, name, maximumBytes) {
  if (value === undefined || typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") {
    throw mediaArchiveError(`${name} 不是有效 JSON。`, "MEDIA_ARCHIVE_VALUE_INVALID");
  }
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch (cause) {
    throw mediaArchiveError(`${name} 不是有效 JSON。`, "MEDIA_ARCHIVE_VALUE_INVALID", cause);
  }
  if (serialized === undefined || Buffer.byteLength(serialized, "utf8") > maximumBytes) {
    throw mediaArchiveError(`${name} 超过允许大小。`, "MEDIA_ARCHIVE_LIMIT_EXCEEDED");
  }
  return value;
}

function requireVersion(value, name) {
  if ((!Number.isSafeInteger(value) || value < 0) && (typeof value !== "string" || !value.trim() || value.length > 80)) {
    throw mediaArchiveError(`${name} 无效。`, "MEDIA_ARCHIVE_VALUE_INVALID");
  }
  return value;
}

function requireSchemaVersion(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw mediaArchiveError(`${name} 必须是正整数。`, "MEDIA_ARCHIVE_VALUE_INVALID");
  }
  return value;
}

function requireAbsolutePath(value, name) {
  if (typeof value !== "string" || !value || value.includes("\u0000") || !path.isAbsolute(value)) {
    throw mediaArchiveError(`${name} 必须是绝对路径。`, "MEDIA_ARCHIVE_STAGING_INVALID");
  }
  return path.resolve(value);
}

function normalizeConfidence(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw mediaArchiveError("observation.confidence 无效。", "MEDIA_ARCHIVE_OBSERVATION_INVALID");
  }
  return value;
}

function normalizeTimestamp(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : "";
}

function optionalString(value) {
  return typeof value === "string" ? value : "";
}

function assertPlainObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw mediaArchiveError(`${name} 必须是对象。`, "MEDIA_ARCHIVE_VALUE_INVALID");
  }
  return value;
}

function mediaArchiveError(message, code, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  error.statusCode = 400;
  return error;
}

module.exports = {
  buildMediaArchive,
  prepareMediaArchive,
  ARCHIVE_FORMAT,
  ARCHIVE_FORMAT_VERSION,
  ARCHIVE_PATHS,
  FEATURE_ARCHIVE_SECTIONS
};
