"use strict";

const CAPSULE_SCHEMA_VERSION = 9;
const SAFE_SNAPSHOT_VERSION = 1;
const CEREMONIAL_GATE = "local-date-ritual";
const ID_PATTERN = /^[a-zA-Z0-9_-]{1,120}$/u;
const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;

const LIMITS = Object.freeze({
  title: 120,
  shellMessage: 800,
  theme: 120,
  opening: 2400,
  sections: 6,
  sectionTitle: 160,
  sectionSummary: 1600,
  items: 48,
  itemTitle: 160,
  excerpt: 1600,
  curatorNote: 1200,
  quotesPerItem: 3,
  quote: 500,
  transcriptsPerItem: 3,
  transcript: 12000,
  mediaLinks: 24,
  altText: 500,
  caption: 1000,
  snapshotBytes: 512 * 1024
});

const ROOT_KEYS = Object.freeze(["opening", "sections", "theme", "title", "version"]);
const SECTION_KEYS = Object.freeze(["items", "key", "summary", "title"]);
const ITEM_KEYS = Object.freeze([
  "confirmedQuotes", "confirmedTranscripts", "curatorNote", "excerpt", "key", "title"
]);
const FORBIDDEN_KEY_PATTERN = /(?:^|_)(?:rawcontent|raw_content|memoryid|memory_id|entityid|entity_id|voiceid|voice_id|voiceassetid|voice_asset_id|assetid|asset_id|mediaid|media_id|originalurl|original_url|storagekey|storage_key|sha256|hash|agent|agentdata|agent_data|agentrun|agent_run|drafttranscript|draft_transcript|exif|gps|metadata)(?:$|_)/iu;

/**
 * Build the immutable, review-safe payload used by a time capsule.
 *
 * Input records may contain internal IDs while associations are verified. The
 * returned snapshot never does: section/item keys are regenerated in display
 * order, selected confirmed transcript IDs are discarded, and media IDs live
 * only in the separate internal mediaLinks result.
 */
function buildSafeSnapshot(input = {}) {
  assertPlainObject(input, "safe snapshot source");
  assertKnownKeys(input, new Set(["exhibition", "media", "transcripts"]), "safe snapshot source");
  const exhibition = input.exhibition;
  assertReviewSafeExhibition(exhibition);
  const sections = requireArray(exhibition.sections, 1, LIMITS.sections, "exhibition.sections");
  const media = optionalArray(input.media, LIMITS.mediaLinks, "media");
  const transcripts = optionalArray(input.transcripts, LIMITS.items * LIMITS.transcriptsPerItem, "transcripts");

  const memoryToItem = new Map();
  const sourceItemToItem = new Map();
  let itemPosition = 0;
  const snapshotSections = sections.map((section, sectionIndex) => {
    assertPlainObject(section, `exhibition.sections[${sectionIndex}]`);
    const items = requireArray(section.items, 1, LIMITS.items, `exhibition.sections[${sectionIndex}].items`);
    return {
      key: `section-${sectionIndex + 1}`,
      title: requireText(section.title, `section ${sectionIndex + 1} title`, LIMITS.sectionTitle),
      summary: optionalText(section.summary, `section ${sectionIndex + 1} summary`, LIMITS.sectionSummary),
      items: items.map((item, sectionItemIndex) => {
        assertPlainObject(item, `exhibition item ${sectionItemIndex + 1}`);
        itemPosition += 1;
        if (itemPosition > LIMITS.items) {
          throw capsuleError(`安全快照最多包含 ${LIMITS.items} 件展品。`, "CAPSULE_SNAPSHOT_LIMIT");
        }
        const itemKey = `item-${itemPosition}`;
        const memoryId = requireId(item.memoryId, "exhibition item memoryId");
        if (memoryToItem.has(memoryId)) {
          throw capsuleError("安全快照来源包含重复展品。", "CAPSULE_SOURCE_DUPLICATE", 409);
        }
        memoryToItem.set(memoryId, itemKey);
        if (item.id) sourceItemToItem.set(requireId(item.id, "exhibition item id"), itemKey);
        const citations = optionalArray(item.citations, LIMITS.quotesPerItem, `item ${itemPosition} citations`);
        return {
          key: itemKey,
          title: requireText(item.title, `item ${itemPosition} title`, LIMITS.itemTitle),
          excerpt: optionalText(item.excerpt, `item ${itemPosition} excerpt`, LIMITS.excerpt),
          curatorNote: optionalText(item.curatorNote, `item ${itemPosition} curatorNote`, LIMITS.curatorNote),
          confirmedQuotes: citations.map((citation, citationIndex) => {
            assertPlainObject(citation, `item ${itemPosition} citations[${citationIndex}]`);
            if (citation.evidenceValid !== true) {
              throw capsuleError("未通过证据核验的引用不能进入时间胶囊。", "CAPSULE_SOURCE_REVIEW_REQUIRED", 409);
            }
            return requireText(citation.quote, `item ${itemPosition} citations[${citationIndex}].quote`, LIMITS.quote);
          }),
          confirmedTranscripts: []
        };
      })
    };
  });

  const itemByKey = new Map(snapshotSections.flatMap((section) => section.items.map((item) => [item.key, item])));
  const selectedTranscriptIds = new Set();
  for (let index = 0; index < transcripts.length; index += 1) {
    const record = transcripts[index];
    assertPlainObject(record, `transcripts[${index}]`);
    assertKnownKeys(record, new Set(["assetId", "itemId", "language", "memoryId", "status", "text"]), `transcripts[${index}]`);
    const assetId = requireId(record.assetId, `transcripts[${index}].assetId`);
    if (selectedTranscriptIds.has(assetId)) {
      throw capsuleError("同一段文字稿不能被重复选择。", "CAPSULE_TRANSCRIPT_DUPLICATE", 409);
    }
    selectedTranscriptIds.add(assetId);
    if (record.status !== undefined && record.status !== "confirmed") {
      throw capsuleError("草稿文字稿不能进入时间胶囊。", "CAPSULE_TRANSCRIPT_NOT_CONFIRMED", 409);
    }
    const itemKey = resolveAnonymousItemKey(record, memoryToItem, sourceItemToItem, `transcripts[${index}]`);
    const item = itemByKey.get(itemKey);
    if (!item) throw capsuleError("文字稿不属于展览成员。", "CAPSULE_TRANSCRIPT_REFERENCE_INVALID", 400);
    if (item.confirmedTranscripts.length >= LIMITS.transcriptsPerItem) {
      throw capsuleError(`每件展品最多选择 ${LIMITS.transcriptsPerItem} 段确认文字稿。`, "CAPSULE_TRANSCRIPT_LIMIT");
    }
    item.confirmedTranscripts.push(requireText(record.text, `transcripts[${index}].text`, LIMITS.transcript));
  }

  const selectedMediaIds = new Set();
  const mediaLinks = media.map((record, position) => {
    assertPlainObject(record, `media[${position}]`);
    assertKnownKeys(record, new Set([
      "altText", "assetId", "caption", "itemId", "memoryId", "mimeType",
      "position", "selected", "status", "variant"
    ]), `media[${position}]`);
    if (record.selected !== undefined && record.selected !== true) {
      throw capsuleError("只有用户明确选择的图片才能进入时间胶囊。", "CAPSULE_MEDIA_NOT_SELECTED");
    }
    const assetId = requireId(record.assetId, `media[${position}].assetId`);
    if (selectedMediaIds.has(assetId)) {
      throw capsuleError("同一张图片不能被重复选择。", "CAPSULE_MEDIA_DUPLICATE", 409);
    }
    selectedMediaIds.add(assetId);
    if (record.status !== undefined && record.status !== "ready") {
      throw capsuleError("只有已就绪图片才能进入时间胶囊。", "CAPSULE_MEDIA_NOT_READY", 409);
    }
    const variant = record.variant;
    if (variant !== undefined) {
      assertPlainObject(variant, `media[${position}].variant`);
      if (variant.kind !== "display" || variant.mimeType !== "image/webp") {
        throw capsuleError("时间胶囊只链接隐私处理后的 display WebP。", "CAPSULE_MEDIA_VARIANT_INVALID");
      }
    } else if (record.mimeType !== undefined && record.mimeType !== "image/webp") {
      throw capsuleError("时间胶囊只链接 display WebP。", "CAPSULE_MEDIA_VARIANT_INVALID");
    }
    return {
      assetId,
      itemKey: resolveAnonymousItemKey(record, memoryToItem, sourceItemToItem, `media[${position}]`),
      position,
      altText: optionalText(record.altText, `media[${position}].altText`, LIMITS.altText),
      caption: optionalText(record.caption, `media[${position}].caption`, LIMITS.caption)
    };
  });

  const snapshot = {
    version: SAFE_SNAPSHOT_VERSION,
    title: requireText(exhibition.title, "exhibition.title", LIMITS.title),
    theme: optionalText(exhibition.theme, "exhibition.theme", LIMITS.theme),
    opening: optionalText(exhibition.opening, "exhibition.opening", LIMITS.opening),
    sections: snapshotSections
  };
  validateSafeSnapshot(snapshot);
  return { snapshot, mediaLinks };
}

function validateSafeSnapshot(value) {
  assertPlainObject(value, "snapshot");
  assertExactKeys(value, ROOT_KEYS, "snapshot");
  if (value.version !== SAFE_SNAPSHOT_VERSION) {
    throw capsuleError("安全快照版本无效。", "CAPSULE_SNAPSHOT_VERSION_INVALID");
  }
  requireText(value.title, "snapshot.title", LIMITS.title);
  optionalText(value.theme, "snapshot.theme", LIMITS.theme);
  optionalText(value.opening, "snapshot.opening", LIMITS.opening);
  const sections = requireArray(value.sections, 1, LIMITS.sections, "snapshot.sections");
  let expectedItem = 1;
  sections.forEach((section, sectionIndex) => {
    assertPlainObject(section, `snapshot.sections[${sectionIndex}]`);
    assertExactKeys(section, SECTION_KEYS, `snapshot.sections[${sectionIndex}]`);
    if (section.key !== `section-${sectionIndex + 1}`) {
      throw capsuleError("安全快照章节键必须是按顺序生成的匿名键。", "CAPSULE_SNAPSHOT_KEY_INVALID");
    }
    requireText(section.title, `snapshot.sections[${sectionIndex}].title`, LIMITS.sectionTitle);
    optionalText(section.summary, `snapshot.sections[${sectionIndex}].summary`, LIMITS.sectionSummary);
    const items = requireArray(section.items, 1, LIMITS.items, `snapshot.sections[${sectionIndex}].items`);
    items.forEach((item, itemIndex) => {
      assertPlainObject(item, `snapshot.sections[${sectionIndex}].items[${itemIndex}]`);
      assertExactKeys(item, ITEM_KEYS, `snapshot.sections[${sectionIndex}].items[${itemIndex}]`);
      if (item.key !== `item-${expectedItem}`) {
        throw capsuleError("安全快照展品键必须是按顺序生成的匿名键。", "CAPSULE_SNAPSHOT_KEY_INVALID");
      }
      expectedItem += 1;
      if (expectedItem - 1 > LIMITS.items) {
        throw capsuleError(`安全快照最多包含 ${LIMITS.items} 件展品。`, "CAPSULE_SNAPSHOT_LIMIT");
      }
      requireText(item.title, `${item.key}.title`, LIMITS.itemTitle);
      optionalText(item.excerpt, `${item.key}.excerpt`, LIMITS.excerpt);
      optionalText(item.curatorNote, `${item.key}.curatorNote`, LIMITS.curatorNote);
      const quotes = optionalArray(item.confirmedQuotes, LIMITS.quotesPerItem, `${item.key}.confirmedQuotes`);
      quotes.forEach((text, quoteIndex) => requireText(
        text,
        `${item.key}.confirmedQuotes[${quoteIndex}]`,
        LIMITS.quote
      ));
      const confirmed = optionalArray(item.confirmedTranscripts, LIMITS.transcriptsPerItem, `${item.key}.confirmedTranscripts`);
      confirmed.forEach((text, transcriptIndex) => requireText(
        text,
        `${item.key}.confirmedTranscripts[${transcriptIndex}]`,
        LIMITS.transcript
      ));
    });
  });
  const encoded = Buffer.byteLength(JSON.stringify(value), "utf8");
  if (encoded > LIMITS.snapshotBytes) {
    throw capsuleError("安全快照体积超出限制。", "CAPSULE_SNAPSHOT_LIMIT", 413);
  }
  return true;
}

function createCapsuleService(options = {}) {
  assertPlainObject(options, "capsule service options");
  const store = options.store;
  if (!store || typeof store !== "object") throw new TypeError("createCapsuleService 需要 store。");
  const now = typeof options.now === "function" ? options.now : () => new Date();
  const listShellRecords = method(store, ["listCapsuleShells", "listTimeCapsules"]);
  const getShellRecord = method(store, ["getCapsuleShell", "getTimeCapsule"]);
  const getPayloadRecord = method(store, ["getCapsulePayload", "getTimeCapsulePayload"]);
  const createRecord = method(store, ["createCapsuleRecord", "createTimeCapsuleRecord"]);
  const deleteRecord = method(store, ["deleteCapsule", "deleteTimeCapsule"]);
  const clearRecords = optionalMethod(store, ["clearCapsules", "clearTimeCapsules"]);
  const statsMethod = optionalMethod(store, ["getCapsuleStats", "getTimeCapsuleStats"]);
  const getExhibition = optionalMethod(store, ["getExhibition"]);
  const listVoiceForMemory = optionalMethod(store, ["listVoiceForMemory"]);
  const listMediaForMemory = optionalMethod(store, ["listMediaForMemory"]);
  const getMediaAsset = optionalMethod(store, ["getMediaAsset"]);

  function listCapsules() {
    return listShellRecords().map((record) => publicShell(record, now));
  }

  function getCapsule(id) {
    const record = getShellRecord(requireId(id, "capsule id"));
    return record ? publicShell(record, now) : null;
  }

  function openCapsule(id) {
    const normalizedId = requireId(id, "capsule id");
    const record = getShellRecord(normalizedId);
    if (!record) throw capsuleError("没有找到这个时间胶囊。", "CAPSULE_NOT_FOUND", 404);
    const capsule = publicShell(record, now);
    if (!capsule.available) {
      const error = capsuleError(
        "时间胶囊尚未到仪式开启日期；日期门槛不是加密安全边界。",
        "CAPSULE_NOT_AVAILABLE",
        423
      );
      error.capsule = capsule;
      throw error;
    }
    if (capsule.needsReview) {
      const error = capsuleError("这个时间胶囊需要复核后才能开启。", "CAPSULE_REVIEW_REQUIRED", 409);
      error.capsule = capsule;
      throw error;
    }
    const content = getPayloadRecord(normalizedId);
    if (!content) throw capsuleError("时间胶囊内容缺失。", "CAPSULE_PAYLOAD_MISSING", 500);
    validateSafeSnapshot(content.snapshot);
    return {
      capsule,
      content: {
        snapshot: content.snapshot,
        mediaLinks: Array.isArray(content.mediaLinks) ? content.mediaLinks : []
      }
    };
  }

  function createCapsule(input = {}) {
    assertPlainObject(input, "capsule");
    assertKnownKeys(input, new Set([
      "confirm", "exhibitionId", "id", "mediaAssetIds", "mediaLinks", "opensOn",
      "shellMessage", "snapshot", "sourceExhibitionId", "timezone", "title",
      "transcriptAssetIds"
    ]), "capsule");
    if (input.confirm !== true) {
      throw capsuleError("创建时间胶囊前需要用户明确确认。", "CAPSULE_CONFIRMATION_REQUIRED");
    }
    const timezone = normalizeTimezone(input.timezone);
    const opensOn = requireLocalDate(input.opensOn, "opensOn");
    const sourceId = input.exhibitionId || input.sourceExhibitionId || "";
    if (input.exhibitionId && input.sourceExhibitionId && input.exhibitionId !== input.sourceExhibitionId) {
      throw capsuleError("展览来源字段互相冲突。", "CAPSULE_SOURCE_INVALID");
    }

    let snapshot;
    let mediaLinks;
    if (sourceId) {
      if (!getExhibition) throw new TypeError("从展览创建时间胶囊需要 store.getExhibition。");
      const exhibitionId = requireId(sourceId, "exhibitionId");
      const exhibition = getExhibition(exhibitionId);
      if (!exhibition) throw capsuleError("没有找到来源展览。", "CAPSULE_SOURCE_NOT_FOUND", 404);
      assertReviewSafeExhibition(exhibition);
      if (input.snapshot !== undefined) {
        throw capsuleError("从展览创建时由服务生成安全快照，不能同时提交自定义快照。", "CAPSULE_SNAPSHOT_CONFLICT");
      }
      const transcripts = resolveSelectedTranscripts(
        exhibition,
        normalizeIdList(input.transcriptAssetIds, "transcriptAssetIds", LIMITS.items * LIMITS.transcriptsPerItem),
        listVoiceForMemory
      );
      const media = resolveSelectedMedia(
        exhibition,
        normalizeMediaSelection(input),
        { listMediaForMemory, getMediaAsset }
      );
      ({ snapshot, mediaLinks } = buildSafeSnapshot({ exhibition, media, transcripts }));
    } else {
      if (input.transcriptAssetIds !== undefined && normalizeIdList(
        input.transcriptAssetIds,
        "transcriptAssetIds",
        LIMITS.items * LIMITS.transcriptsPerItem
      ).length) {
        throw capsuleError("没有展览来源时无法核验文字稿归属。", "CAPSULE_TRANSCRIPT_REFERENCE_INVALID");
      }
      snapshot = input.snapshot;
      validateSafeSnapshot(snapshot);
      mediaLinks = normalizeStandaloneMediaLinks(input, snapshot, getMediaAsset);
    }

    const record = createRecord({
      id: input.id,
      title: input.title === undefined ? snapshot.title : requireText(input.title, "title", LIMITS.title),
      shellMessage: optionalText(input.shellMessage, "shellMessage", LIMITS.shellMessage),
      opensOn,
      timezone,
      ceremonialGate: CEREMONIAL_GATE,
      needsReview: false,
      sourceExhibitionId: sourceId ? requireId(sourceId, "exhibitionId") : "",
      snapshot,
      mediaLinks,
      confirm: true
    });
    return publicShell(record, now);
  }

  function deleteCapsule(id) {
    return deleteRecord(requireId(id, "capsule id"));
  }

  function clearCapsules() {
    if (!clearRecords) throw new TypeError("store 未提供 clearCapsules。");
    return clearRecords();
  }

  function getCapsuleStats() {
    if (!statsMethod) return { capsules: listShellRecords().length };
    return statsMethod();
  }

  return Object.freeze({
    clearCapsules,
    createCapsule,
    deleteCapsule,
    getCapsule,
    getCapsuleShell: getCapsule,
    getCapsuleStats,
    listCapsuleShells: listCapsules,
    listCapsules,
    openCapsule
  });
}

function resolveSelectedTranscripts(exhibition, assetIds, listVoiceForMemory) {
  if (!assetIds.length) return [];
  if (!listVoiceForMemory) throw new TypeError("选择文字稿需要 store.listVoiceForMemory。");
  const candidates = new Map();
  exhibition.sections.flatMap((section) => section.items).forEach((item) => {
    const memoryId = requireId(item.memoryId, "exhibition item memoryId");
    const links = listVoiceForMemory(memoryId);
    if (!Array.isArray(links)) throw new TypeError("store.listVoiceForMemory 必须返回数组。");
    links.forEach((link) => {
      const assetId = String(link?.assetId || link?.asset?.id || "");
      if (!assetIds.includes(assetId)) return;
      const entries = candidates.get(assetId) || [];
      entries.push({
        assetId,
        itemId: item.id,
        memoryId,
        status: link.transcript?.status,
        text: link.transcript?.text
      });
      candidates.set(assetId, entries);
    });
  });
  return assetIds.map((assetId) => {
    const entries = candidates.get(assetId) || [];
    if (!entries.length) throw capsuleError("所选文字稿不属于来源展览。", "CAPSULE_TRANSCRIPT_REFERENCE_INVALID");
    const confirmed = entries.filter((entry) => entry.status === "confirmed" && String(entry.text || "").trim());
    if (!confirmed.length) throw capsuleError("草稿文字稿不能进入时间胶囊。", "CAPSULE_TRANSCRIPT_NOT_CONFIRMED", 409);
    if (confirmed.length !== 1) throw capsuleError("所选文字稿在展览中归属不明确。", "CAPSULE_TRANSCRIPT_AMBIGUOUS", 409);
    return confirmed[0];
  });
}

function resolveSelectedMedia(exhibition, selections, dependencies) {
  if (!selections.length) return [];
  const { listMediaForMemory, getMediaAsset } = dependencies;
  if (!listMediaForMemory || !getMediaAsset) {
    throw new TypeError("选择图片需要 store.listMediaForMemory 与 store.getMediaAsset。");
  }
  const candidates = new Map();
  exhibition.sections.flatMap((section) => section.items).forEach((item) => {
    const memoryId = requireId(item.memoryId, "exhibition item memoryId");
    const links = listMediaForMemory(memoryId);
    if (!Array.isArray(links)) throw new TypeError("store.listMediaForMemory 必须返回数组。");
    links.forEach((link) => {
      const assetId = String(link?.assetId || link?.asset?.id || "");
      if (!selections.some((selection) => selection.assetId === assetId)) return;
      const entries = candidates.get(assetId) || [];
      entries.push({ link, item, memoryId });
      candidates.set(assetId, entries);
    });
  });
  return selections.map((selection) => {
    let entries = candidates.get(selection.assetId) || [];
    if (selection.memoryId) entries = entries.filter((entry) => entry.memoryId === selection.memoryId);
    if (!entries.length) throw capsuleError("所选图片不属于来源展览。", "CAPSULE_MEDIA_REFERENCE_INVALID");
    if (entries.length !== 1) throw capsuleError("所选图片在展览中归属不明确。", "CAPSULE_MEDIA_AMBIGUOUS", 409);
    const asset = getMediaAsset(selection.assetId);
    if (!asset) throw capsuleError("没有找到所选图片。", "CAPSULE_MEDIA_NOT_FOUND", 404);
    if (asset.status !== "ready") throw capsuleError("只有已就绪图片才能进入时间胶囊。", "CAPSULE_MEDIA_NOT_READY", 409);
    const display = (asset.variants || []).find((variant) => variant.kind === "display");
    if (!display || display.mimeType !== "image/webp") {
      throw capsuleError("所选图片缺少隐私处理后的 display WebP。", "CAPSULE_MEDIA_VARIANT_INVALID", 409);
    }
    const { link, item, memoryId } = entries[0];
    return {
      assetId: selection.assetId,
      memoryId,
      itemId: item.id,
      selected: true,
      status: asset.status,
      variant: display,
      altText: selection.altText === undefined ? link.altText : selection.altText,
      caption: selection.caption === undefined ? link.caption : selection.caption
    };
  });
}

function normalizeStandaloneMediaLinks(input, snapshot, getMediaAsset) {
  const selections = normalizeMediaSelection(input);
  if (!selections.length) return [];
  if (!getMediaAsset) throw new TypeError("选择图片需要 store.getMediaAsset。");
  const itemKeys = new Set(snapshot.sections.flatMap((section) => section.items.map((item) => item.key)));
  return selections.map((selection, position) => {
    if (!selection.itemKey || !itemKeys.has(selection.itemKey)) {
      throw capsuleError("自定义快照的图片必须显式关联匿名 itemKey。", "CAPSULE_MEDIA_REFERENCE_INVALID");
    }
    const asset = getMediaAsset(selection.assetId);
    const display = asset?.variants?.find((variant) => variant.kind === "display");
    if (!asset || asset.status !== "ready" || !display || display.mimeType !== "image/webp") {
      throw capsuleError("自定义快照只能链接已就绪的 display WebP。", "CAPSULE_MEDIA_VARIANT_INVALID", 409);
    }
    return {
      assetId: selection.assetId,
      itemKey: selection.itemKey,
      position,
      altText: optionalText(selection.altText, `mediaLinks[${position}].altText`, LIMITS.altText),
      caption: optionalText(selection.caption, `mediaLinks[${position}].caption`, LIMITS.caption)
    };
  });
}

function normalizeMediaSelection(input) {
  if (input.mediaAssetIds !== undefined && input.mediaLinks !== undefined) {
    throw capsuleError("mediaAssetIds 与 mediaLinks 不能同时提交。", "CAPSULE_MEDIA_CONFLICT");
  }
  if (input.mediaAssetIds !== undefined) {
    return normalizeIdList(input.mediaAssetIds, "mediaAssetIds", LIMITS.mediaLinks).map((assetId) => ({ assetId }));
  }
  const links = optionalArray(input.mediaLinks, LIMITS.mediaLinks, "mediaLinks");
  const seen = new Set();
  return links.map((entry, index) => {
    assertPlainObject(entry, `mediaLinks[${index}]`);
    assertKnownKeys(entry, new Set(["altText", "assetId", "caption", "itemKey", "memoryId"]), `mediaLinks[${index}]`);
    const assetId = requireId(entry.assetId, `mediaLinks[${index}].assetId`);
    if (seen.has(assetId)) throw capsuleError("图片选择包含重复 ID。", "CAPSULE_MEDIA_DUPLICATE", 409);
    seen.add(assetId);
    return {
      assetId,
      itemKey: entry.itemKey === undefined ? "" : requireAnonymousItemKey(entry.itemKey),
      memoryId: entry.memoryId === undefined ? "" : requireId(entry.memoryId, `mediaLinks[${index}].memoryId`),
      altText: entry.altText,
      caption: entry.caption
    };
  });
}

function publicShell(record, now) {
  const timezone = normalizeTimezone(record.timezone);
  const opensOn = requireLocalDate(record.opensOn, "opensOn");
  const localDate = getLocalDate(now(), timezone);
  return {
    id: requireId(record.id, "capsule id"),
    title: requireText(record.title, "capsule title", LIMITS.title),
    shellMessage: optionalText(record.shellMessage, "capsule shellMessage", LIMITS.shellMessage),
    opensOn,
    timezone,
    available: localDate >= opensOn,
    ceremonialGate: true,
    needsReview: Boolean(record.needsReview),
    createdAt: requireTimestamp(record.createdAt, "capsule createdAt")
  };
}

function getLocalDate(value, timezone) {
  const canonicalTimezone = normalizeTimezone(timezone);
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime())) throw capsuleError("now() 返回了无效时间。", "CAPSULE_NOW_INVALID", 500);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: canonicalTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const part = (type) => parts.find((entry) => entry.type === type)?.value || "";
  return requireLocalDate(`${part("year")}-${part("month")}-${part("day")}`, "local date");
}

function normalizeTimezone(value) {
  const timezone = typeof value === "string" ? value.trim() : "";
  if (!timezone || timezone.length > 100 || timezone.includes("\u0000")) {
    throw capsuleError("timezone 必须是明确的 IANA 时区。", "CAPSULE_TIMEZONE_INVALID");
  }
  try {
    const canonical = new Intl.DateTimeFormat("en-US", { timeZone: timezone }).resolvedOptions().timeZone;
    if (canonical !== "UTC" && !canonical.includes("/")) throw new Error("not an IANA zone");
    return canonical;
  } catch {
    throw capsuleError("timezone 不是当前运行环境支持的 IANA 时区。", "CAPSULE_TIMEZONE_INVALID");
  }
}

function requireLocalDate(value, name) {
  const text = typeof value === "string" ? value : "";
  const match = LOCAL_DATE_PATTERN.exec(text);
  if (!match) throw capsuleError(`${name} 必须是有效的 YYYY-MM-DD 本地日期。`, "CAPSULE_DATE_INVALID");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw capsuleError(`${name} 必须是有效的 YYYY-MM-DD 本地日期。`, "CAPSULE_DATE_INVALID");
  }
  return text;
}

function assertReviewSafeExhibition(exhibition) {
  assertPlainObject(exhibition, "exhibition");
  if (exhibition.status !== "published") {
    throw capsuleError("时间胶囊只能来自已发布展览。", "CAPSULE_SOURCE_NOT_PUBLISHED", 409);
  }
  if (exhibition.needsReview || exhibition.requiresConfirmation) {
    throw capsuleError("来源展览仍需复核。", "CAPSULE_SOURCE_REVIEW_REQUIRED", 409);
  }
  const citations = Array.isArray(exhibition.sections)
    ? exhibition.sections.flatMap((section) => Array.isArray(section.items)
      ? section.items.flatMap((item) => Array.isArray(item.citations) ? item.citations : [])
      : [])
    : [];
  if (citations.some((citation) => citation?.evidenceValid !== true)) {
    throw capsuleError("来源展览包含未通过核验的引用。", "CAPSULE_SOURCE_REVIEW_REQUIRED", 409);
  }
  return true;
}

function resolveAnonymousItemKey(record, memoryToItem, sourceItemToItem, name) {
  const byMemory = record.memoryId === undefined ? "" : memoryToItem.get(requireId(record.memoryId, `${name}.memoryId`));
  const byItem = record.itemId === undefined ? "" : sourceItemToItem.get(requireId(record.itemId, `${name}.itemId`));
  if (byMemory && byItem && byMemory !== byItem) {
    throw capsuleError(`${name} 的展品归属互相冲突。`, "CAPSULE_SOURCE_REFERENCE_INVALID");
  }
  const itemKey = byMemory || byItem;
  if (!itemKey) throw capsuleError(`${name} 不属于来源展览。`, "CAPSULE_SOURCE_REFERENCE_INVALID");
  return itemKey;
}

function assertExactKeys(value, expected, name) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    const unsafe = actual.find((key) => !wanted.includes(key) && FORBIDDEN_KEY_PATTERN.test(key));
    throw capsuleError(
      unsafe ? `${name} 包含禁止字段 ${unsafe}。` : `${name} 字段集合无效。`,
      unsafe ? "CAPSULE_SNAPSHOT_UNSAFE" : "CAPSULE_SNAPSHOT_INVALID"
    );
  }
}

function assertKnownKeys(value, allowed, name) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw capsuleError(`${name} 包含未知字段 ${key}。`, "CAPSULE_VALUE_INVALID");
  }
}

function normalizeIdList(value, name, maximum) {
  const items = optionalArray(value, maximum, name);
  const seen = new Set();
  return items.map((item, index) => {
    const id = requireId(item, `${name}[${index}]`);
    if (seen.has(id)) throw capsuleError(`${name} 包含重复 ID。`, "CAPSULE_VALUE_DUPLICATE", 409);
    seen.add(id);
    return id;
  });
}

function requireAnonymousItemKey(value) {
  const key = String(value || "");
  if (!/^item-[1-9]\d*$/u.test(key)) throw capsuleError("itemKey 必须是匿名展品键。", "CAPSULE_MEDIA_REFERENCE_INVALID");
  return key;
}

function requireId(value, name) {
  const id = String(value || "").trim();
  if (!ID_PATTERN.test(id)) throw capsuleError(`${name} 无效。`, "CAPSULE_ID_INVALID");
  return id;
}

function requireText(value, name, maximum) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || [...text].length > maximum || text.includes("\u0000")) {
    throw capsuleError(`${name} 不能为空且最多 ${maximum} 个字符。`, "CAPSULE_TEXT_INVALID");
  }
  return text;
}

function optionalText(value, name, maximum) {
  if (value === undefined || value === null) return "";
  const text = typeof value === "string" ? value.trim() : "";
  if ([...text].length > maximum || text.includes("\u0000")) {
    throw capsuleError(`${name} 最多 ${maximum} 个字符。`, "CAPSULE_TEXT_INVALID");
  }
  return text;
}

function requireTimestamp(value, name) {
  const text = String(value || "").trim();
  if (!text || text.length > 40 || !Number.isFinite(Date.parse(text))) {
    throw capsuleError(`${name} 必须是有效时间戳。`, "CAPSULE_TIMESTAMP_INVALID");
  }
  return text;
}

function requireArray(value, minimum, maximum, name) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    throw capsuleError(`${name} 必须包含 ${minimum} 至 ${maximum} 项。`, "CAPSULE_VALUE_INVALID");
  }
  return value;
}

function optionalArray(value, maximum, name) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > maximum) {
    throw capsuleError(`${name} 必须是最多 ${maximum} 项的数组。`, "CAPSULE_VALUE_INVALID");
  }
  return value;
}

function assertPlainObject(value, name) {
  if (!isPlainObject(value)) throw capsuleError(`${name} 必须是对象。`, "CAPSULE_VALUE_INVALID");
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function method(target, names) {
  const selected = optionalMethod(target, names);
  if (!selected) throw new TypeError(`store 缺少方法：${names.join(" 或 ")}。`);
  return selected;
}

function optionalMethod(target, names) {
  const name = names.find((candidate) => typeof target[candidate] === "function");
  return name ? target[name].bind(target) : null;
}

function daysInMonth(year, month) {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function capsuleError(message, code, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

module.exports = {
  CAPSULE_LIMITS: LIMITS,
  CAPSULE_SCHEMA_VERSION,
  CEREMONIAL_GATE,
  SAFE_SNAPSHOT_VERSION,
  assertReviewSafeExhibition,
  buildSafeSnapshot,
  createCapsuleService,
  getLocalDate,
  normalizeTimezone,
  requireLocalDate,
  validateSafeSnapshot
};
