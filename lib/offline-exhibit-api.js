"use strict";

const {
  collectExhibitionSelection,
  isCapsuleAvailable,
  listExhibitionCandidates,
  materializeCapsuleContent,
  normalizeBuiltContent,
  normalizeIdList,
  publicCapsuleShell,
  requirePublishedExhibition
} = require("./capsule-api");

const MATERIAL_KEYS = new Set([
  "sourceType",
  "sourceId",
  "mediaAssetIds",
  "transcriptAssetIds",
  "confirm"
]);
const SOURCE_TYPES = new Set(["exhibition", "capsule"]);

function createOfflineExhibitApi(options = {}) {
  const database = options.database || options.capsuleStore || options.store;
  const store = options.store;
  const sendJson = options.sendJson;
  const readJsonBody = options.readJsonBody;
  const httpError = options.httpError;
  const now = typeof options.now === "function" ? options.now : () => new Date().toISOString();
  const buildSafeSnapshot = typeof options.buildSafeSnapshot === "function"
    ? options.buildSafeSnapshot
    : defaultBuildSafeSnapshot;
  const capsule = resolveCapsuleReaders(database);
  assertDependencies({ database, store, capsule, sendJson, readJsonBody, httpError, buildSafeSnapshot });

  async function handle(request, response, url) {
    if (url?.pathname !== "/api/offline-exhibits/candidates" &&
        url?.pathname !== "/api/offline-exhibits/material") return false;

    try {
      if (url.pathname === "/api/offline-exhibits/candidates") {
        if (request.method !== "GET") throw httpError(405, "离线展览候选项只支持 GET。");
        const exhibitionId = requireOnlyExhibitionQuery(url, httpError);
        const exhibition = await requirePublishedExhibition(store, exhibitionId, httpError);
        const candidates = await listExhibitionCandidates({ store, exhibition });
        return sendJson(response, 200, {
          exhibition: {
            id: exhibitionId,
            title: safeText(exhibition.title, 200),
            theme: safeText(exhibition.theme, 200),
            itemCount: candidates.itemRecords.length
          },
          media: candidates.media.map((entry) => ({
            assetId: entry.assetId,
            memoryId: entry.memoryId,
            itemId: entry.itemId,
            itemTitle: safeText(entry.item?.title || findItemTitle(candidates.itemRecords, entry.itemId), 200),
            caption: safeText(entry.caption, 1000),
            altText: safeText(entry.altText, 500),
            mimeType: "image/webp",
            byteSize: entry.variant.byteSize,
            width: entry.variant.width,
            height: entry.variant.height
          })),
          transcripts: candidates.transcripts.map((entry) => ({
            assetId: entry.assetId,
            memoryId: entry.memoryId,
            itemId: entry.itemId,
            itemTitle: safeText(entry.itemTitle, 200),
            label: safeText(entry.label, 120),
            text: safeText(entry.text, 8000),
            language: safeText(entry.language, 40),
            confirmed: true
          }))
        });
      }

      if (request.method !== "POST") throw httpError(405, "离线展览材料只支持 POST。");
      assertNoQuery(url, httpError);
      const body = await readJsonBody(request);
      const input = normalizeMaterialBody(body, httpError);

      if (input.sourceType === "exhibition") {
        const exhibition = await requirePublishedExhibition(store, input.sourceId, httpError);
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
        const safe = normalizeBuiltContent(built, selection.media, httpError);
        const material = await materializeCapsuleContent(safe, store, httpError);
        return sendJson(response, 200, { material });
      }

      if (input.transcriptAssetIds.length) {
        throw httpError(400, "胶囊在封存时已物理移除声音内部 ID；导出时请直接使用快照中已确认的文字稿。");
      }
      const rawShell = await Promise.resolve(capsule.getShell(input.sourceId));
      if (!rawShell) throw httpError(404, "没有找到这枚时光胶囊。");
      const shell = publicCapsuleShell(rawShell, now);
      if (!isCapsuleAvailable(shell, now)) throw lockedCapsuleError(httpError);
      if (shell.needsReview) {
        const error = httpError(409, "这枚时光胶囊需要复核后才能生成离线展览材料。");
        error.code = "CAPSULE_REVIEW_REQUIRED";
        throw error;
      }
      const rawContent = await Promise.resolve(capsule.getPayload(input.sourceId));
      if (!rawContent) throw httpError(404, "时光胶囊内容不存在。");
      const content = await materializeCapsuleContent(
        rawContent,
        store,
        httpError,
        input.mediaAssetIds
      );
      return sendJson(response, 200, { material: { shell, ...content } });
    } catch (error) {
      throw normalizeApiError(error, httpError);
    }
  }

  return Object.freeze({ handle });
}

function resolveCapsuleReaders(database) {
  return {
    getShell: bindFirst(database, ["getCapsuleShell", "getTimeCapsule", "getCapsule"]),
    getPayload: bindFirst(database, ["getCapsuleContent", "getCapsulePayload", "getTimeCapsulePayload", "openCapsule"])
  };
}

function bindFirst(target, names) {
  if (!target) return null;
  for (const name of names) {
    if (typeof target[name] === "function") return target[name].bind(target);
  }
  return null;
}

function requireOnlyExhibitionQuery(url, httpError) {
  const keys = [...url.searchParams.keys()];
  const values = url.searchParams.getAll("exhibitionId");
  if (keys.length !== 1 || keys[0] !== "exhibitionId" || values.length !== 1) {
    throw httpError(400, "候选项请求必须且只能包含一个 exhibitionId。");
  }
  return normalizeIdList(values, "exhibitionId", httpError)[0];
}

function normalizeMaterialBody(body, httpError) {
  assertPlainObject(body, httpError);
  const unknown = Object.keys(body).filter((key) => !MATERIAL_KEYS.has(key));
  if (unknown.length) throw httpError(400, `离线展览材料请求包含不支持的字段：${unknown.join(", ")}。`);
  if (body.confirm !== true) throw httpError(400, "生成离线展览材料前必须由用户明确确认。");
  if (!SOURCE_TYPES.has(body.sourceType)) throw httpError(400, "sourceType 只能是 exhibition 或 capsule。");
  const sourceId = normalizeIdList([body.sourceId], "sourceId", httpError)[0];
  return {
    sourceType: body.sourceType,
    sourceId,
    mediaAssetIds: normalizeIdList(body.mediaAssetIds, "mediaAssetIds", httpError),
    transcriptAssetIds: normalizeIdList(body.transcriptAssetIds, "transcriptAssetIds", httpError)
  };
}

function assertPlainObject(value, httpError) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw httpError(400, "离线展览材料请求必须是 JSON 对象。");
  }
}

function assertNoQuery(url, httpError) {
  if ([...url.searchParams.keys()].length) throw httpError(400, "离线展览材料接口不接受查询参数。");
}

function lockedCapsuleError(httpError) {
  const error = httpError(423, "这枚时光胶囊还未到开启日期，现在不会生成任何导出材料。");
  error.code = "CAPSULE_NOT_AVAILABLE";
  return error;
}

function findItemTitle(records, itemId) {
  return records.find((entry) => entry.itemId === itemId)?.item?.title || "";
}

function safeText(value, maximum) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function normalizeApiError(error, httpError) {
  if (error?.statusCode) return error;
  if (error instanceof TypeError || error instanceof RangeError ||
      /^(CAPSULE|EXHIBITION|MEDIA|VOICE|OFFLINE)_/u.test(String(error?.code || ""))) {
    const wrapped = httpError(Number(error?.statusCode) || 400, error.message || "离线展览材料请求无效。");
    if (error?.code) wrapped.code = error.code;
    return wrapped;
  }
  return error;
}

function assertDependencies({ database, store, capsule, sendJson, readJsonBody, httpError, buildSafeSnapshot }) {
  const storeMethods = ["getExhibition", "listMediaForMemory", "getMediaAsset", "listVoiceForMemory"];
  if (!database || !capsule.getShell || !capsule.getPayload ||
      !store || storeMethods.some((name) => typeof store[name] !== "function") ||
      typeof sendJson !== "function" || typeof readJsonBody !== "function" ||
      typeof httpError !== "function" || typeof buildSafeSnapshot !== "function") {
    throw new TypeError("createOfflineExhibitApi 依赖不完整。");
  }
}

function defaultBuildSafeSnapshot(input) {
  const service = require("./capsule-service");
  if (typeof service.buildSafeSnapshot !== "function") throw new TypeError("capsule-service 未提供 buildSafeSnapshot。");
  return service.buildSafeSnapshot(input);
}

module.exports = { createOfflineExhibitApi };
