"use strict";

const MAX_MEDIA_PER_MEMORY = 6;

const MEDIA_ARCHIVE_LIMITS = Object.freeze({
  maxMemories: 500,
  maxEntries: 2000,
  maxEntryBytes: 25 * 1024 * 1024,
  maxTotalBytes: 500 * 1024 * 1024,
  maxAssets: 500,
  maxLinks: 3000,
  maxObservations: 10000
});

function mediaObservationPolicyViolation(observation, privacyMode) {
  if (!observation || typeof observation !== "object") return "图片线索无效。";
  if (observation.kind === "gps_coordinates" && observation.source !== "exif") {
    return "GPS 图片线索必须来自 EXIF。";
  }
  if (observation.source === "exif") {
    if (observation.status !== "suggested") return "EXIF 图片线索必须保持为待确认状态。";
    if (observation.kind === "gps_coordinates") {
      if (observation.sensitive !== true || !validGpsValue(observation.value)) {
        return "GPS EXIF 线索必须使用严格坐标结构并标记为敏感。";
      }
    } else if (observation.kind === "orientation") {
      if (observation.sensitive !== false || !validOrientationValue(observation.value)) {
        return "方向 EXIF 线索必须使用 1 到 8 的非敏感方向值。";
      }
    } else if (observation.kind === "captured_at") {
      if (observation.sensitive !== false || !validCapturedAtValue(observation.value)) {
        return "拍摄时间 EXIF 线索结构无效或包含额外字段。";
      }
    } else {
      return "EXIF 图片线索类型不在允许列表中。";
    }
  }
  if (privacyMode === "sanitized_only" && observation.source === "exif" && observation.sensitive === true) {
    return "仅保留安全展示图的媒体不能保存敏感 EXIF 线索。";
  }
  return "";
}

function validGpsValue(value) {
  return hasExactKeys(value, ["latitude", "longitude"]) &&
    finiteInRange(value.latitude, -90, 90) &&
    finiteInRange(value.longitude, -180, 180);
}

function validOrientationValue(value) {
  return hasExactKeys(value, ["orientation"]) &&
    Number.isInteger(value.orientation) &&
    value.orientation >= 1 &&
    value.orientation <= 8;
}

function validCapturedAtValue(value) {
  if (!hasExactKeys(value, ["date", "localDateTime", "timezone"])) return false;
  if (typeof value.localDateTime !== "string" || typeof value.date !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/u.exec(value.localDateTime);
  if (!match || value.date !== value.localDateTime.slice(0, 10)) return false;
  const [, year, month, day, hour, minute, second] = match.map(Number);
  if (!validCalendarDay(year, month, day) || hour > 23 || minute > 59 || second > 59) return false;
  if (!hasExactKeys(value.timezone, ["kind", "value"])) return false;
  if (value.timezone.kind === "local-floating") return value.timezone.value === null;
  if (value.timezone.kind !== "offset" || typeof value.timezone.value !== "string") return false;
  return /^(?:[+-](?:0\d|1[0-3]):[0-5]\d|[+-]14:00)$/u.test(value.timezone.value);
}

function validCalendarDay(year, month, day) {
  if (!Number.isInteger(year) || year < 1 || year > 9999 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const lengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= lengths[month - 1];
}

function finiteInRange(value, minimum, maximum) {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function hasExactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return keys.length === wanted.length && keys.every((key, index) => key === wanted[index]);
}

module.exports = {
  MAX_MEDIA_PER_MEMORY,
  MEDIA_ARCHIVE_LIMITS,
  mediaObservationPolicyViolation
};
