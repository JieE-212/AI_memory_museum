"use strict";

const REGION_TYPES = new Set(["person", "location", "object", "text", "date", "other"]);
const COORDINATE_SPACE = "canonical-preview-v1";

function buildImageRegionObservation(input = {}, context = {}) {
  assertObject(input, "图片区域");
  const asset = context.asset;
  if (!asset || asset.status !== "ready") throw evidenceError(409, "图片尚未准备完成。");
  const region = normalizeRegion(input.region || input.locator, asset);
  const label = limitText(input.label, 80);
  if (!label) throw evidenceError(400, "请为图片区域写一条简短说明。");
  const regionType = REGION_TYPES.has(input.regionType) ? input.regionType : "other";
  const memoryId = sanitizeId(context.memoryId || input.memoryId);
  if (!memoryId) throw evidenceError(400, "图片证据必须属于一件展品。");
  const id = sanitizeId(input.id);
  return {
    ...(id ? { id } : {}),
    assetId: asset.id,
    kind: "image_region",
    source: "user",
    status: "confirmed",
    confidence: 1,
    sensitive: Boolean(input.sensitive),
    value: {
      sourceType: "image_region",
      mediaId: asset.id,
      sourceHash: `sha256:${asset.contentSha256}`,
      locator: { coordinateSpace: COORDINATE_SPACE, ...region },
      regionType,
      label,
      integrityStatus: "source_verified",
      semanticStatus: "user_confirmed"
    },
    metadata: {
      memoryId,
      note: limitText(input.note, 240)
    }
  };
}

function normalizeRegion(input, asset) {
  assertObject(input, "图片区域坐标");
  const x = finiteNumber(input.x, "x");
  const y = finiteNumber(input.y, "y");
  const width = finiteNumber(input.width, "width");
  const height = finiteNumber(input.height, "height");
  if (x < 0 || y < 0 || x >= 1 || y >= 1 || width <= 0 || height <= 0) {
    throw evidenceError(400, "图片区域必须位于画面范围内。");
  }
  if (x + width > 1 + Number.EPSILON || y + height > 1 + Number.EPSILON) {
    throw evidenceError(400, "图片区域超出了画面范围。");
  }
  const canonicalWidth = Number(asset.width) || 0;
  const canonicalHeight = Number(asset.height) || 0;
  if (canonicalWidth <= 0 || canonicalHeight <= 0) throw evidenceError(409, "图片缺少规范化尺寸。");
  if (width * canonicalWidth < 4 || height * canonicalHeight < 4) {
    throw evidenceError(400, "圈选区域太小，请选择更清晰的范围。");
  }
  return { x: roundCoordinate(x), y: roundCoordinate(y), width: roundCoordinate(width), height: roundCoordinate(height) };
}

function publicImageRegion(observation, media = null) {
  if (!observation || observation.kind !== "image_region") return null;
  const value = observation.value || {};
  const hashMatches = media?.contentSha256
    ? value.sourceHash === `sha256:${media.contentSha256}`
    : true;
  return {
    id: observation.id,
    assetId: observation.assetId,
    memoryId: observation.metadata?.memoryId || "",
    label: value.label || "图片线索",
    regionType: value.regionType || "other",
    locator: value.locator || null,
    note: observation.metadata?.note || "",
    sensitive: Boolean(observation.sensitive),
    integrityStatus: hashMatches ? value.integrityStatus || "source_verified" : "source_invalidated",
    semanticStatus: value.semanticStatus || "user_confirmed",
    sourceHash: value.sourceHash || "",
    media: media ? {
      assetId: media.assetId || media.id,
      caption: media.caption || "",
      altText: media.altText || "",
      width: media.width,
      height: media.height,
      urls: media.urls || {}
    } : null,
    createdAt: observation.createdAt,
    updatedAt: observation.updatedAt
  };
}

function listImageEvidenceForMemory(store, mediaApi, memoryId) {
  const media = mediaApi.publicMediaList(memoryId);
  return media.flatMap((item) => store.listMediaObservations({ assetId: item.assetId, status: "confirmed" })
    .filter((observation) => observation.kind === "image_region")
    .filter((observation) => !observation.metadata?.memoryId || observation.metadata.memoryId === memoryId)
    .map((observation) => publicImageRegion(observation, item))
    .filter(Boolean));
}

function finiteNumber(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw evidenceError(400, `${name} 必须是有限数字。`);
  return number;
}

function roundCoordinate(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function limitText(value, maximum) {
  return String(value || "").trim().slice(0, maximum);
}

function sanitizeId(value) {
  const id = String(value || "").trim();
  return /^[a-zA-Z0-9_-]{1,120}$/.test(id) ? id : "";
}

function assertObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw evidenceError(400, `${name}格式无效。`);
}

function evidenceError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

module.exports = {
  COORDINATE_SPACE,
  buildImageRegionObservation,
  normalizeRegion,
  publicImageRegion,
  listImageEvidenceForMemory
};
