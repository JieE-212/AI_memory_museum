"use strict";

const CAPSULE_ITEM_PATH = /^\/api\/capsules\/([A-Za-z0-9][A-Za-z0-9_-]{0,119})$/u;
const CAPSULE_CONTENT_PATH = /^\/api\/capsules\/([A-Za-z0-9][A-Za-z0-9_-]{0,119})\/content$/u;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const CREATE_KEYS = new Set([
  "exhibitionId",
  "title",
  "shellMessage",
  "opensOn",
  "timezone",
  "mediaAssetIds",
  "transcriptAssetIds",
  "confirm"
]);

function createCapsuleApi(options = {}) {
  const database = options.database || options.capsuleStore;
  const store = options.store;
  const sendJson = options.sendJson;
  const readJsonBody = options.readJsonBody;
  const httpError = options.httpError;
  const now = typeof options.now === "function" ? options.now : () => new Date().toISOString();
  const buildSafeSnapshot = typeof options.buildSafeSnapshot === "function"
    ? options.buildSafeSnapshot
    : defaultBuildSafeSnapshot;
  const interviewDemo = Boolean(options.interviewDemo);
  const methods = resolveCapsuleMethods(database);
  assertDependencies({ database, store, methods, sendJson, readJsonBody, httpError, buildSafeSnapshot });

  async function handle(request, response, url) {
    const contentMatch = url?.pathname?.match(CAPSULE_CONTENT_PATH);
    const itemMatch = url?.pathname?.match(CAPSULE_ITEM_PATH);
    if (url?.pathname !== "/api/capsules" && !contentMatch && !itemMatch) return false;

    try {
      assertNoQuery(url, httpError);

      if (url.pathname === "/api/capsules") {
        if (request.method === "GET") {
          const records = await Promise.resolve(methods.list());
          const capsules = normalizeCapsuleList(records).map((record) => publicCapsuleShell(record, now));
          return sendJson(response, 200, { capsules });
        }
        if (request.method === "POST") {
          assertPersistentWritesAllowed(interviewDemo, httpError, request, url);
          const body = await readJsonBody(request);
          const input = normalizeCreateBody(body, httpError);
          const exhibition = await requirePublishedExhibition(store, input.exhibitionId, httpError);
          const selection = await collectExhibitionSelection({
            store,
            exhibition,
            mediaAssetIds: input.mediaAssetIds,
            transcriptAssetIds: input.transcriptAssetIds,
            httpError
          });
          const built = await Promise.resolve(buildSafeSnapshot({
            exhibition,
            media: selection.media,
            transcripts: selection.transcripts
          }));
          const content = normalizeBuiltContent(built, selection.media, httpError);
          const created = await Promise.resolve(methods.create({
            exhibitionId: input.exhibitionId,
            title: input.title,
            shellMessage: input.shellMessage,
            opensOn: input.opensOn,
            timezone: input.timezone,
            snapshot: content.snapshot,
            mediaLinks: content.mediaLinks,
            confirm: true
          }));
          return sendJson(response, 201, { capsule: publicCapsuleShell(created, now) });
        }
        throw httpError(405, "时光胶囊列表只支持 GET 和 POST。");
      }

      const id = (contentMatch || itemMatch)[1];
      if (itemMatch && request.method === "DELETE") {
        assertPersistentWritesAllowed(interviewDemo, httpError, request, url);
      }
      const shellRecord = await Promise.resolve(methods.getShell(id));
      if (!shellRecord) throw httpError(404, "没有找到这枚时光胶囊。");
      const shell = publicCapsuleShell(shellRecord, now);

      if (contentMatch) {
        if (request.method !== "GET") throw httpError(405, "时光胶囊内容只支持 GET。");
        if (!shell.available) {
          return sendJson(response, 423, {
            error: "这枚时光胶囊还未到开启日期，现在只能看到外壳。",
            code: "CAPSULE_NOT_AVAILABLE",
            capsule: shell
          });
        }
        if (shell.needsReview) {
          return sendJson(response, 409, {
            error: "这枚时光胶囊需要复核后才能开启。",
            code: "CAPSULE_REVIEW_REQUIRED",
            capsule: shell
          });
        }
        const rawContent = await Promise.resolve(methods.getPayload(id));
        if (!rawContent) throw httpError(404, "时光胶囊内容不存在。");
        const content = await materializeCapsuleContent(rawContent, store, httpError);
        return sendJson(response, 200, { capsule: shell, content });
      }

      if (request.method === "GET") return sendJson(response, 200, { capsule: shell });
      if (request.method === "DELETE") {
        const removed = await Promise.resolve(methods.remove(id));
        if (!removed) throw httpError(404, "没有找到这枚时光胶囊。");
        return sendJson(response, 200, { ok: true, id });
      }
      throw httpError(405, "时光胶囊详情只支持 GET 和 DELETE。");
    } catch (error) {
      throw normalizeApiError(error, httpError);
    }
  }

  return Object.freeze({ handle });
}

function resolveCapsuleMethods(database) {
  return {
    list: bindFirst(database, ["listCapsuleShells", "listTimeCapsules", "listCapsules"]),
    getShell: bindFirst(database, ["getCapsuleShell", "getTimeCapsule", "getCapsule"]),
    getPayload: bindFirst(database, ["getCapsuleContent", "getCapsulePayload", "getTimeCapsulePayload", "openCapsule"]),
    create: bindFirst(database, ["createCapsule", "createTimeCapsuleRecord"]),
    remove: bindFirst(database, ["deleteCapsule", "deleteTimeCapsule"])
  };
}

function bindFirst(target, names) {
  if (!target) return null;
  for (const name of names) {
    if (typeof target[name] === "function") return target[name].bind(target);
  }
  return null;
}

function normalizeCapsuleList(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.capsules)) return value.capsules;
  return [];
}

function publicCapsuleShell(record, now = () => new Date().toISOString()) {
  const source = record?.capsule && !record.id ? record.capsule : record;
  if (!source || typeof source !== "object") return null;
  return {
    id: safeId(source.id),
    title: safeText(source.title, 120),
    shellMessage: safeText(source.shellMessage, 800),
    opensOn: safeDate(source.opensOn),
    timezone: safeText(source.timezone, 100),
    available: isCapsuleAvailable(source, now),
    ceremonialGate: true,
    needsReview: Boolean(source.needsReview || source.requiresConfirmation),
    createdAt: safeTimestamp(source.createdAt)
  };
}

function isCapsuleAvailable(shell, now = () => new Date().toISOString()) {
  const opensOn = safeDate(shell?.opensOn);
  const timezone = safeText(shell?.timezone, 100);
  if (!opensOn || !timezone) return false;
  try {
    return localDateAt(now(), timezone) >= opensOn;
  } catch {
    return false;
  }
}

function localDateAt(value, timezone) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new RangeError("now 无效。");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function normalizeCreateBody(body, httpError) {
  assertPlainObject(body, "时光胶囊请求", httpError);
  assertKnownKeys(body, CREATE_KEYS, "时光胶囊请求", httpError);
  if (body.confirm !== true) throw httpError(400, "封存时光胶囊前必须由用户明确确认。");
  return {
    exhibitionId: requireId(body.exhibitionId, "exhibitionId", httpError),
    title: requireText(body.title, "title", 120, httpError),
    shellMessage: optionalText(body.shellMessage, "shellMessage", 800, httpError),
    opensOn: requireDate(body.opensOn, "opensOn", httpError),
    timezone: requireTimezone(body.timezone, httpError),
    mediaAssetIds: normalizeIdList(body.mediaAssetIds, "mediaAssetIds", httpError),
    transcriptAssetIds: normalizeIdList(body.transcriptAssetIds, "transcriptAssetIds", httpError)
  };
}

async function requirePublishedExhibition(store, exhibitionId, httpError) {
  const exhibition = await Promise.resolve(store.getExhibition(exhibitionId));
  if (!exhibition) throw httpError(404, "没有找到要封存的主题展览。");
  const invalidEvidence = (exhibition.sections || []).some((section) => (
    (section.items || []).some((item) => {
      const citations = Array.isArray(item.citations) ? item.citations : [];
      return !citations.length || citations.some((citation) => (
        citation?.evidenceValid !== true || !String(citation?.quote || "").trim()
      ));
    })
  ));
  if (exhibition.status !== "published" || exhibition.needsReview === true ||
      exhibition.requiresConfirmation === true || invalidEvidence) {
    throw httpError(409, "只能封存已发布、引用有效且无需复核的主题展览。");
  }
  return exhibition;
}

async function collectExhibitionSelection({ store, exhibition, mediaAssetIds, transcriptAssetIds, httpError }) {
  const itemRecords = flattenExhibitionItems(exhibition);
  const mediaCandidates = new Map();
  const transcriptCandidates = new Map();

  for (const itemRecord of itemRecords) {
    const mediaLinks = await Promise.resolve(store.listMediaForMemory(itemRecord.memoryId));
    for (const link of Array.isArray(mediaLinks) ? mediaLinks : []) {
      const candidate = await normalizeDisplayCandidate(store, link, itemRecord);
      if (candidate && !mediaCandidates.has(candidate.assetId)) mediaCandidates.set(candidate.assetId, candidate);
    }
    const voices = await Promise.resolve(store.listVoiceForMemory(itemRecord.memoryId));
    for (const voice of Array.isArray(voices) ? voices : []) {
      const transcript = voice?.transcript;
      if (!isConfirmedTranscript(transcript)) continue;
      const assetId = safeId(voice.assetId || transcript.assetId || voice.asset?.id);
      if (!assetId || transcriptCandidates.has(assetId)) continue;
      transcriptCandidates.set(assetId, {
        assetId,
        memoryId: itemRecord.memoryId,
        itemId: itemRecord.itemId,
        text: String(transcript.text || "").trim(),
        language: safeText(transcript.language, 40),
        status: "confirmed"
      });
    }
  }

  const media = mediaAssetIds.map((assetId) => {
    const candidate = mediaCandidates.get(assetId);
    if (!candidate) throw httpError(400, "所选图片不属于该展览或没有可用的 WebP 展示版。");
    return candidate;
  });
  const transcripts = transcriptAssetIds.map((assetId) => {
    const candidate = transcriptCandidates.get(assetId);
    if (!candidate) throw httpError(400, "所选文字稿不属于该展览或尚未人工确认。");
    return candidate;
  });
  return { itemRecords, media, transcripts, mediaCandidates, transcriptCandidates };
}

async function listExhibitionCandidates({ store, exhibition }) {
  const itemRecords = flattenExhibitionItems(exhibition);
  const media = [];
  const transcripts = [];
  const seenMedia = new Set();
  const seenTranscripts = new Set();
  for (const itemRecord of itemRecords) {
    const links = await Promise.resolve(store.listMediaForMemory(itemRecord.memoryId));
    for (const link of Array.isArray(links) ? links : []) {
      const candidate = await normalizeDisplayCandidate(store, link, itemRecord);
      if (!candidate || seenMedia.has(candidate.assetId)) continue;
      seenMedia.add(candidate.assetId);
      media.push(candidate);
    }
    const voices = await Promise.resolve(store.listVoiceForMemory(itemRecord.memoryId));
    for (const voice of Array.isArray(voices) ? voices : []) {
      if (!isConfirmedTranscript(voice?.transcript)) continue;
      const assetId = safeId(voice.assetId || voice.transcript.assetId || voice.asset?.id);
      if (!assetId || seenTranscripts.has(assetId)) continue;
      seenTranscripts.add(assetId);
      transcripts.push({
        assetId,
        memoryId: itemRecord.memoryId,
        itemId: itemRecord.itemId,
        itemTitle: itemRecord.item.title || "",
        label: safeText(voice.label, 120),
        text: String(voice.transcript.text || "").trim(),
        language: safeText(voice.transcript.language, 40),
        status: "confirmed"
      });
    }
  }
  return { itemRecords, media, transcripts };
}

function flattenExhibitionItems(exhibition) {
  const result = [];
  (Array.isArray(exhibition?.sections) ? exhibition.sections : []).forEach((section, sectionIndex) => {
    (Array.isArray(section?.items) ? section.items : []).forEach((item, itemIndex) => {
      const memoryId = safeId(item?.memoryId);
      const itemId = safeId(item?.id);
      if (!memoryId || !itemId) return;
      result.push({ section, item, sectionIndex, itemIndex, memoryId, itemId });
    });
  });
  return result;
}

async function normalizeDisplayCandidate(store, link, itemRecord) {
  const assetId = safeId(link?.assetId || link?.asset?.id);
  if (!assetId) return null;
  const asset = link.asset || await Promise.resolve(store.getMediaAsset(assetId));
  if (!asset || asset.status !== "ready") return null;
  let variants = Array.isArray(link.variants) ? link.variants : asset.variants;
  if (!Array.isArray(variants) && typeof store.listMediaVariants === "function") {
    variants = await Promise.resolve(store.listMediaVariants(assetId));
  }
  const variant = (Array.isArray(variants) ? variants : []).find((entry) => (
    entry?.kind === "display" && entry?.mimeType === "image/webp" &&
    Number.isSafeInteger(Number(entry.byteSize)) && Number(entry.byteSize) > 0 &&
    Number.isSafeInteger(Number(entry.width)) && Number(entry.width) > 0 &&
    Number.isSafeInteger(Number(entry.height)) && Number(entry.height) > 0 &&
    SHA256_PATTERN.test(String(entry.sha256 || "").toLowerCase())
  ));
  if (!variant) return null;
  return {
    assetId,
    memoryId: itemRecord.memoryId,
    itemId: itemRecord.itemId,
    position: Number.isSafeInteger(link.position) ? link.position : 0,
    caption: safeText(link.caption, 1000),
    altText: safeText(link.altText, 500),
    variant: {
      kind: "display",
      mimeType: "image/webp",
      byteSize: Number(variant.byteSize),
      width: Number.isSafeInteger(Number(variant.width)) ? Number(variant.width) : 0,
      height: Number.isSafeInteger(Number(variant.height)) ? Number(variant.height) : 0,
      sha256: String(variant.sha256).toLowerCase()
    }
  };
}

function isConfirmedTranscript(transcript) {
  if (!transcript || !String(transcript.text || "").trim()) return false;
  if (transcript.status !== undefined) return transcript.status === "confirmed";
  return transcript.confirmed === true;
}

function normalizeBuiltContent(value, selectedMedia, httpError) {
  const rawSnapshot = value?.snapshot || value;
  const snapshot = normalizeSafeSnapshot(rawSnapshot, httpError);
  const rawLinks = Array.isArray(value?.mediaLinks) ? value.mediaLinks : selectedMedia;
  const selected = new Map(selectedMedia.map((item) => [item.assetId, item]));
  const itemKeys = snapshotItemKeys(snapshot);
  const seenAssets = new Set();
  const mediaLinks = rawLinks.map((entry) => {
    const assetId = safeId(entry?.assetId);
    const source = selected.get(assetId);
    if (!assetId || !source) throw httpError(500, "安全快照生成了越界图片引用。");
    if (seenAssets.has(assetId)) throw httpError(500, "安全快照生成了重复图片引用。");
    seenAssets.add(assetId);
    const itemKey = String(entry?.itemKey || "");
    if (!itemKeys.has(itemKey)) throw httpError(500, "安全快照的图片引用不属于任何匿名展品。");
    return {
      assetId,
      itemKey,
      position: Number.isSafeInteger(entry?.position) ? entry.position : source.position,
      caption: safeText(entry?.caption ?? source.caption, 1000),
      altText: safeText(entry?.altText ?? source.altText, 500)
    };
  });
  return { snapshot, mediaLinks };
}

async function materializeCapsuleContent(rawContent, store, httpError, selectedAssetIds = null) {
  const content = unwrapCapsuleContent(rawContent);
  const snapshot = normalizeSafeSnapshot(content?.snapshot, httpError);
  const links = Array.isArray(content?.mediaLinks) ? content.mediaLinks : [];
  const itemKeys = snapshotItemKeys(snapshot);
  const requested = selectedAssetIds === null ? null : new Set(selectedAssetIds);
  if (requested && requested.size !== selectedAssetIds.length) throw httpError(400, "mediaAssetIds 不能重复。");
  const linkedIds = links.map((link) => safeId(link?.assetId)).filter(Boolean);
  const availableIds = new Set(linkedIds);
  if (availableIds.size !== linkedIds.length) throw httpError(500, "时光胶囊包含重复图片引用。");
  if (requested && [...requested].some((id) => !availableIds.has(id))) {
    throw httpError(400, "所选图片不属于该时光胶囊。");
  }
  const chosen = requested ? links.filter((link) => requested.has(safeId(link?.assetId))) : links;
  const media = [];
  for (const link of chosen) {
    const assetId = safeId(link?.assetId);
    if (!assetId) throw httpError(500, "时光胶囊的图片引用无效。");
    const itemKey = String(link?.itemKey || "");
    if (!itemKeys.has(itemKey)) throw httpError(500, "时光胶囊的图片引用没有对应的匿名展品。");
    const asset = await Promise.resolve(store.getMediaAsset(assetId));
    const display = (Array.isArray(asset?.variants) ? asset.variants : []).find((variant) => (
      variant?.kind === "display" && variant?.mimeType === "image/webp" &&
      Number.isSafeInteger(Number(variant.byteSize)) && Number(variant.byteSize) > 0 &&
      Number.isSafeInteger(Number(variant.width)) && Number(variant.width) > 0 &&
      Number.isSafeInteger(Number(variant.height)) && Number(variant.height) > 0 &&
      SHA256_PATTERN.test(String(variant.sha256 || "").toLowerCase())
    ));
    if (!asset || asset.status !== "ready" || !display) {
      throw httpError(409, "时光胶囊中的一张展示图片暂时不可用。");
    }
    media.push({
      key: `media-${media.length + 1}`,
      itemKey,
      caption: safeText(link.caption, 1000),
      altText: safeText(link.altText, 500),
      mimeType: "image/webp",
      byteSize: Number(display.byteSize),
      width: Number(display.width),
      height: Number(display.height),
      sha256: String(display.sha256).toLowerCase(),
      contentUrl: `/api/media/${encodeURIComponent(assetId)}/display`
    });
  }
  return { snapshot, media };
}

function unwrapCapsuleContent(value) {
  if (value?.content && typeof value.content === "object") return value.content;
  if (value?.payload && typeof value.payload === "object") return value.payload;
  return value;
}

function normalizeSafeSnapshot(value, httpError = defaultHttpError) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw httpError(500, "时光胶囊的安全快照无效。");
  }
  if (value.version !== 1) throw httpError(500, "时光胶囊的安全快照版本无效。");
  let itemCounter = 0;
  const sections = (Array.isArray(value.sections) ? value.sections : []).map((section, sectionIndex) => ({
    key: `section-${sectionIndex + 1}`,
    title: safeText(section?.title, 160),
    summary: safeText(section?.summary, 1600),
    items: (Array.isArray(section?.items) ? section.items : []).map((item) => {
      itemCounter += 1;
      return {
        key: `item-${itemCounter}`,
        title: safeText(item?.title, 160),
        excerpt: safeText(item?.excerpt, 1600),
        curatorNote: safeText(item?.curatorNote, 1200),
        confirmedQuotes: normalizeConfirmedQuotes(item?.confirmedQuotes),
        confirmedTranscripts: normalizeConfirmedTexts(item?.confirmedTranscripts)
      };
    })
  }));
  if (!sections.length || sections.some((section) => !section.items.length ||
      section.items.some((item) => !item.confirmedQuotes.length))) {
    throw httpError(500, "时光胶囊的安全快照缺少展览内容。");
  }
  return {
    version: 1,
    title: safeText(value.title, 120),
    theme: safeText(value.theme, 120),
    opening: safeText(value.opening, 2400),
    sections
  };
}

function normalizeConfirmedTexts(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    if (typeof entry === "string") return safeText(entry, 12000);
    if (entry && (entry.status === "confirmed" || entry.confirmed === true)) {
      return safeText(String(entry.text || ""), 12000);
    }
    return "";
  }).filter(Boolean).slice(0, 3);
}

function normalizeConfirmedQuotes(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => typeof entry === "string")
    .map((entry) => safeText(entry, 500))
    .filter(Boolean)
    .slice(0, 3);
}

function snapshotItemKeys(snapshot) {
  return new Set(snapshot.sections.flatMap((section) => section.items.map((item) => item.key)));
}

function normalizeIdList(value, name, httpError) {
  if (!Array.isArray(value) || value.length > 500) throw httpError(400, `${name} 必须是有界的 ID 数组。`);
  const ids = value.map((entry) => requireId(entry, name, httpError));
  if (new Set(ids).size !== ids.length) throw httpError(400, `${name} 不能包含重复项。`);
  return ids;
}

function assertNoQuery(url, httpError) {
  if ([...url.searchParams.keys()].length) throw httpError(400, "该时光胶囊接口不接受查询参数。");
}

function assertPersistentWritesAllowed(interviewDemo, httpError, request, url) {
  if (!interviewDemo) return;
  const error = httpError(403, "公开 Demo 可以查看已有胶囊外壳，但不会封存或删除私人内容。");
  error.code = "CAPSULE_DEMO_READ_ONLY";
  error.interviewDemo = true;
  error.blockedAction = `${request?.method || ""} ${url?.pathname || ""}`.trim();
  throw error;
}

function assertPlainObject(value, name, httpError) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw httpError(400, `${name} 必须是 JSON 对象。`);
  }
}

function assertKnownKeys(value, allowed, name, httpError) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) throw httpError(400, `${name} 包含不支持的字段：${unknown.join(", ")}。`);
}

function requireId(value, name, httpError) {
  const id = String(value ?? "").trim();
  if (!ID_PATTERN.test(id)) throw httpError(400, `${name} 无效。`);
  return id;
}

function safeId(value) {
  const id = String(value ?? "").trim();
  return ID_PATTERN.test(id) ? id : "";
}

function requireText(value, name, maximum, httpError) {
  if (typeof value !== "string") throw httpError(400, `${name} 必须是文本。`);
  const text = value.trim();
  if (!text || [...text].length > maximum || text.includes("\0")) throw httpError(400, `${name} 无效。`);
  return text;
}

function optionalText(value, name, maximum, httpError) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw httpError(400, `${name} 必须是文本。`);
  const text = value.trim();
  if ([...text].length > maximum || text.includes("\0")) throw httpError(400, `${name} 无效。`);
  return text;
}

function safeText(value, maximum) {
  return typeof value === "string" ? [...value.trim()].slice(0, maximum).join("") : "";
}

function requireDate(value, name, httpError) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value) || !isRealDate(value)) {
    throw httpError(400, `${name} 必须是有效的 YYYY-MM-DD 日期。`);
  }
  return value;
}

function safeDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value) && isRealDate(value) ? value : "";
}

function isRealDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1 || year > 9999) return false;
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function requireTimezone(value, httpError) {
  if (typeof value !== "string" || !value.trim() || value.length > 100) throw httpError(400, "timezone 无效。");
  const timezone = value.trim();
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format(new Date(0));
  } catch {
    throw httpError(400, "timezone 必须是有效的 IANA 时区。");
  }
  return timezone;
}

function safeTimestamp(value) {
  return typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value)) ? value : "";
}

function normalizeApiError(error, httpError) {
  if (error?.statusCode) return error;
  if (error instanceof TypeError || error instanceof RangeError ||
      /^(CAPSULE|EXHIBITION|MEDIA|VOICE)_/u.test(String(error?.code || ""))) {
    const wrapped = httpError(Number(error?.statusCode) || 400, error.message || "时光胶囊请求无效。");
    if (error?.code) wrapped.code = error.code;
    return wrapped;
  }
  return error;
}

function assertDependencies({ database, store, methods, sendJson, readJsonBody, httpError, buildSafeSnapshot }) {
  const storeMethods = ["getExhibition", "listMediaForMemory", "getMediaAsset", "listVoiceForMemory"];
  if (!database || Object.values(methods).some((method) => typeof method !== "function") ||
      !store || storeMethods.some((name) => typeof store[name] !== "function") ||
      typeof sendJson !== "function" || typeof readJsonBody !== "function" ||
      typeof httpError !== "function" || typeof buildSafeSnapshot !== "function") {
    throw new TypeError("createCapsuleApi 依赖不完整。");
  }
}

function defaultBuildSafeSnapshot(input) {
  // Lazy loading keeps this adapter independently testable while the V7 service is initialized.
  const service = require("./capsule-service");
  if (typeof service.buildSafeSnapshot !== "function") throw new TypeError("capsule-service 未提供 buildSafeSnapshot。");
  return service.buildSafeSnapshot(input);
}

function defaultHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

module.exports = {
  createCapsuleApi,
  collectExhibitionSelection,
  isCapsuleAvailable,
  listExhibitionCandidates,
  localDateAt,
  materializeCapsuleContent,
  normalizeBuiltContent,
  normalizeIdList,
  normalizeSafeSnapshot,
  publicCapsuleShell,
  requirePublishedExhibition
};
