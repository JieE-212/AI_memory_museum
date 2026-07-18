"use strict";

const { createHash } = require("node:crypto");

const TIME_CALIBRATION_SCHEMA_VERSION = 12;
const CALIBRATION_RESOLUTION_KINDS = Object.freeze([
  "year",
  "month",
  "day",
  "range",
  "alternatives",
  "uncertain"
]);
const RESOLUTION_KIND_SET = new Set(CALIBRATION_RESOLUTION_KINDS);
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const SOURCE_KEY_PATTERN = /^time-source:[a-f0-9]{64}$/u;
const VALID_EXIF_STATUSES = new Set(["suggested", "confirmed"]);
const INVALID_CLAIM_STATUSES = new Set(["invalid", "invalidated", "rejected", "withdrawn"]);
const DATE_CLAIM_TOKENS = new Set([
  "date",
  "event_date",
  "memory_date",
  "occurred_at",
  "occurred_on",
  "temporal",
  "time"
]);

function normalizeCalendarEvidence(value) {
  if (typeof value === "string") return normalizeCalendarText(value);
  if (!isPlainObject(value)) return null;

  const explicitKind = firstText(value.resolutionKind, value.resolution_kind, value.precision, value.kind);
  if (explicitKind && RESOLUTION_KIND_SET.has(explicitKind)) {
    try {
      return normalizeCalibrationResolution({
        resolutionKind: explicitKind,
        intervalStart: firstDefined(value.intervalStart, value.interval_start, value.startDate, value.start),
        intervalEnd: firstDefined(value.intervalEnd, value.interval_end, value.endDate, value.end),
        value: firstDefined(value.value, value.date)
      });
    } catch {
      return null;
    }
  }

  const directDate = firstDefined(value.date, value.localDate, value.calendarDate, value.occurredOn);
  if (directDate !== undefined) return normalizeCalendarEvidence(directDate);

  const rangeStart = firstDefined(value.intervalStart, value.interval_start, value.startDate, value.from, value.start);
  const rangeEnd = firstDefined(value.intervalEnd, value.interval_end, value.endDate, value.to, value.end);
  if (rangeStart !== undefined || rangeEnd !== undefined) {
    try {
      return normalizeCalibrationResolution({
        resolutionKind: "range",
        intervalStart: rangeStart,
        intervalEnd: rangeEnd
      });
    } catch {
      return null;
    }
  }

  if (value.year !== undefined) {
    const year = normalizeNumericPart(value.year, 4);
    const month = value.month === undefined ? "" : normalizeNumericPart(value.month, 2);
    const day = value.day === undefined ? "" : normalizeNumericPart(value.day, 2);
    if (!year || (value.month !== undefined && !month) || (value.day !== undefined && !day) || (day && !month)) {
      return null;
    }
    return normalizeCalendarText(`${year}${month ? `-${month}` : ""}${day ? `-${day}` : ""}`);
  }
  return null;
}

function normalizeCalibrationResolution(input = {}) {
  if (!isPlainObject(input)) {
    throw calibrationError("Time calibration resolution must be an object.", "CALIBRATION_RESOLUTION_INVALID");
  }
  const resolutionKind = String(firstDefined(input.resolutionKind, input.resolution_kind, input.kind) || "").trim();
  if (!RESOLUTION_KIND_SET.has(resolutionKind)) {
    throw calibrationError("Unsupported time calibration resolution.", "CALIBRATION_RESOLUTION_INVALID");
  }

  if (resolutionKind === "uncertain" || resolutionKind === "alternatives") {
    const start = String(firstDefined(input.intervalStart, input.interval_start) || "");
    const end = String(firstDefined(input.intervalEnd, input.interval_end) || "");
    if (start || end) {
      throw calibrationError("Uncertain or alternative placement cannot contain an interval.", "CALIBRATION_INTERVAL_INVALID");
    }
    return Object.freeze({
      resolutionKind,
      precision: resolutionKind,
      intervalStart: "",
      intervalEnd: "",
      value: ""
    });
  }

  const compactValue = firstDefined(input.value, input.date);
  const rawStart = firstDefined(input.intervalStart, input.interval_start);
  const rawEnd = firstDefined(input.intervalEnd, input.interval_end);

  if (resolutionKind === "year") {
    let year = "";
    if (typeof compactValue === "string" && /^\d{4}$/u.test(compactValue.trim())) year = compactValue.trim();
    const start = parseCanonicalDay(rawStart);
    const end = parseCanonicalDay(rawEnd);
    if (!year && start && end && start.month === 1 && start.day === 1 && end.month === 12 && end.day === 31 && start.year === end.year) {
      year = String(start.year).padStart(4, "0");
    }
    if (!year || !validYear(Number(year))) throw calibrationError("Invalid year placement.", "CALIBRATION_INTERVAL_INVALID");
    const normalized = {
      resolutionKind,
      precision: resolutionKind,
      intervalStart: `${year}-01-01`,
      intervalEnd: `${year}-12-31`,
      value: year
    };
    requireMatchingSuppliedInterval(normalized, rawStart, rawEnd);
    return Object.freeze(normalized);
  }

  if (resolutionKind === "month") {
    let monthText = "";
    if (typeof compactValue === "string" && /^\d{4}-\d{2}$/u.test(compactValue.trim())) monthText = compactValue.trim();
    const start = parseCanonicalDay(rawStart);
    const end = parseCanonicalDay(rawEnd);
    if (!monthText && start && end && start.year === end.year && start.month === end.month && start.day === 1 && end.day === daysInMonth(end.year, end.month)) {
      monthText = `${String(start.year).padStart(4, "0")}-${String(start.month).padStart(2, "0")}`;
    }
    const match = /^(\d{4})-(\d{2})$/u.exec(monthText);
    const year = Number(match?.[1]);
    const month = Number(match?.[2]);
    if (!match || !validYear(year) || month < 1 || month > 12) {
      throw calibrationError("Invalid month placement.", "CALIBRATION_INTERVAL_INVALID");
    }
    const normalized = {
      resolutionKind,
      precision: resolutionKind,
      intervalStart: `${match[1]}-${match[2]}-01`,
      intervalEnd: `${match[1]}-${match[2]}-${String(daysInMonth(year, month)).padStart(2, "0")}`,
      value: monthText
    };
    requireMatchingSuppliedInterval(normalized, rawStart, rawEnd);
    return Object.freeze(normalized);
  }

  if (resolutionKind === "day") {
    const dayText = typeof compactValue === "string" && compactValue.trim()
      ? compactValue.trim()
      : typeof rawStart === "string" ? rawStart.trim() : "";
    const day = parseCanonicalDay(dayText);
    if (!day) throw calibrationError("Invalid day placement.", "CALIBRATION_INTERVAL_INVALID");
    const canonical = formatDay(day);
    const normalized = {
      resolutionKind,
      precision: resolutionKind,
      intervalStart: canonical,
      intervalEnd: canonical,
      value: canonical
    };
    requireMatchingSuppliedInterval(normalized, rawStart, rawEnd);
    return Object.freeze(normalized);
  }

  const start = parseCanonicalDay(rawStart);
  const end = parseCanonicalDay(rawEnd);
  if (!start || !end || formatDay(start) > formatDay(end)) {
    throw calibrationError("Invalid inclusive date range.", "CALIBRATION_INTERVAL_INVALID");
  }
  return Object.freeze({
    resolutionKind,
    precision: resolutionKind,
    intervalStart: formatDay(start),
    intervalEnd: formatDay(end),
    value: `${formatDay(start)}/${formatDay(end)}`
  });
}

function compareIntervals(left, right) {
  const a = readInterval(left);
  const b = readInterval(right);
  if (!a || !b) return "unknown";
  if (a.end < b.start || b.end < a.start) return "disjoint";
  return "compatible";
}

function buildTimeCandidates(input = {}) {
  const candidates = [];
  const memories = Array.isArray(input.memories) ? input.memories : [];
  const revisions = Array.isArray(input.revisions) ? input.revisions : [];
  const claims = Array.isArray(input.claims) ? input.claims : [];
  const observations = Array.isArray(input.observations) ? input.observations : [];

  for (const memory of memories) {
    if (!isPlainObject(memory)) continue;
    const memoryId = localId(memory.id);
    if (!memoryId) continue;
    const interval = normalizeCalendarEvidence(firstDefined(memory.date, memory.memoryDate, memory.memory_date));
    if (!isSingleIntervalEvidence(interval)) continue;
    candidates.push(makeCandidate({
      sourceType: "memory-current",
      status: "current",
      interval,
      memoryId,
      memoryTitle: displayText(memory.title, 120),
      snapshotSha256: optionalSha256(firstDefined(memory.snapshotSha256, memory.snapshot_sha256))
    }));
  }

  for (const revision of revisions) {
    if (!isPlainObject(revision) || !isPlainObject(revision.snapshot)) continue;
    const memoryId = localId(revision.memoryId);
    if (!memoryId) continue;
    const interval = normalizeCalendarEvidence(firstDefined(revision.snapshot.date, revision.snapshot.memoryDate));
    const snapshotSha256 = optionalSha256(firstDefined(revision.snapshotSha256, revision.snapshot_sha256));
    if (!isSingleIntervalEvidence(interval) || !snapshotSha256) continue;
    candidates.push(makeCandidate({
      sourceType: "revision",
      status: "recorded",
      interval,
      memoryId,
      memoryTitle: displayText(revision.memoryTitle, 120),
      revisionNo: optionalPositiveInteger(firstDefined(revision.revisionNo, revision.revision_no)),
      snapshotSha256
    }));
  }

  for (const claim of claims) {
    if (!isPlainObject(claim) || claim.evidenceValid !== true || !isDateClaim(claim)) continue;
    const memoryId = localId(claim.memoryId);
    if (!memoryId) continue;
    const status = String(claim.status || "extracted").trim().toLowerCase();
    if (INVALID_CLAIM_STATUSES.has(status)) continue;
    const quote = typeof claim.quote === "string" ? claim.quote : typeof claim.quoteText === "string" ? claim.quoteText : "";
    const startOffset = optionalNonNegativeInteger(firstDefined(claim.startOffset, claim.start_offset));
    const endOffset = optionalNonNegativeInteger(firstDefined(claim.endOffset, claim.end_offset));
    if (!quote || quote.length > 120 || startOffset === null || endOffset === null ||
        endOffset < startOffset || endOffset - startOffset !== quote.length) continue;
    const rawContent = typeof claim.rawContent === "string" ? claim.rawContent : null;
    if (rawContent !== null && rawContent.slice(startOffset, endOffset) !== quote) continue;
    const interval = normalizeCalendarEvidence(claim.value);
    // `alternatives` is a final human decision over multiple sources, not one
    // independently comparable interval. It must never masquerade as a dated
    // source candidate (or reach the stable-key interval contract).
    if (!isSingleIntervalEvidence(interval)) continue;
    candidates.push(makeCandidate({
      sourceType: "raw-claim",
      status: status || "extracted",
      interval,
      memoryId,
      memoryTitle: displayText(claim.memoryTitle, 120),
      claimQuoteSha256: sha256(quote),
      claimStartOffset: startOffset,
      claimEndOffset: endOffset,
      sourceQuote: quote
    }));
  }

  for (const observation of observations) {
    if (!isPlainObject(observation) || observation.kind !== "captured_at" || observation.source !== "exif" ||
        !VALID_EXIF_STATUSES.has(observation.status) || observation.sensitive !== false || !isPlainObject(observation.value)) {
      continue;
    }
    const memoryId = localId(observation.memoryId);
    if (!memoryId) continue;
    const assetContentSha256 = optionalSha256(firstDefined(observation.assetContentSha256, observation.contentSha256));
    const interval = normalizeCalendarEvidence(observation.value.date);
    if (!assetContentSha256 || !interval || interval.resolutionKind !== "day") continue;
    candidates.push(makeCandidate({
      sourceType: "exif",
      status: observation.status,
      interval,
      memoryId,
      memoryTitle: displayText(observation.memoryTitle, 120),
      assetContentSha256,
      timezoneKind: normalizeTimezoneKind(observation.value.timezone)
    }));
  }

  return deduplicateCandidates(filterCurrentHeadDuplicates(candidates))
    .sort(compareCandidates)
    .map((candidate) => Object.freeze(candidate));
}

function deduplicateCandidates(candidates) {
  const bySourceKey = new Map();
  for (const candidate of candidates) {
    const existing = bySourceKey.get(candidate.sourceKey);
    if (!existing || compareCandidateDetails(candidate, existing) < 0) {
      bySourceKey.set(candidate.sourceKey, candidate);
    }
  }
  return [...bySourceKey.values()];
}

function filterCurrentHeadDuplicates(candidates) {
  const currentHeads = new Set(candidates
    .filter((candidate) => candidate.sourceType === "memory-current" && candidate.snapshotSha256)
    .map((candidate) => [
      candidate.memoryId,
      candidate.snapshotSha256,
      candidate.precision,
      candidate.intervalStart,
      candidate.intervalEnd
    ].join("\u0000")));
  return candidates.filter((candidate) => {
    if (candidate.sourceType !== "revision" || !candidate.snapshotSha256) return true;
    const identity = [
      candidate.memoryId,
      candidate.snapshotSha256,
      candidate.precision,
      candidate.intervalStart,
      candidate.intervalEnd
    ].join("\u0000");
    return !currentHeads.has(identity);
  });
}

function buildStableSourceKey(candidate) {
  if (!isPlainObject(candidate)) {
    throw calibrationError("Time source candidate must be an object.", "CALIBRATION_SOURCE_INVALID");
  }
  const sourceType = String(candidate.sourceType || candidate.type || "").trim();
  const status = String(candidate.status || candidate.sourceStatus || "").trim();
  const precision = String(candidate.precision || candidate.resolutionKind || "").trim();
  const intervalStart = String(candidate.intervalStart || "").trim();
  const intervalEnd = String(candidate.intervalEnd || "").trim();
  const memoryId = localId(firstDefined(candidate.memoryId, candidate.memory_id));
  if (!sourceType || !status || !precision || !memoryId || !parseCanonicalDay(intervalStart) ||
      !parseCanonicalDay(intervalEnd) || intervalStart > intervalEnd) {
    throw calibrationError("Time source candidate is incomplete.", "CALIBRATION_SOURCE_INVALID");
  }

  const projection = {
    intervalEnd,
    intervalStart,
    memoryIdentitySha256: sha256(`time-calibration-memory\u0000${memoryId}`),
    precision,
    sourceStatus: status,
    sourceType
  };
  const snapshotSha256 = optionalSha256(candidate.snapshotSha256);
  const assetContentSha256 = optionalSha256(firstDefined(candidate.assetContentSha256, candidate.mediaContentSha256));
  const claimQuoteSha256 = optionalSha256(candidate.claimQuoteSha256);
  if (snapshotSha256) projection.snapshotSha256 = snapshotSha256;
  if (assetContentSha256) projection.mediaContentSha256 = assetContentSha256;
  if (claimQuoteSha256) {
    const start = optionalNonNegativeInteger(firstDefined(candidate.claimStartOffset, candidate.startOffset));
    const end = optionalNonNegativeInteger(firstDefined(candidate.claimEndOffset, candidate.endOffset));
    if (start === null || end === null || end < start) {
      throw calibrationError("Raw claim offsets are invalid.", "CALIBRATION_SOURCE_INVALID");
    }
    projection.claimEndOffset = end;
    projection.claimQuoteSha256 = claimQuoteSha256;
    projection.claimStartOffset = start;
  }
  return `time-source:${sha256(stableStringify(projection))}`;
}

function buildSourceSetSha256(candidates) {
  if (!Array.isArray(candidates)) {
    throw calibrationError("Time candidates must be an array.", "CALIBRATION_SOURCE_INVALID");
  }
  const keys = [...new Set(candidates.map((candidate) => {
    const key = String(candidate?.sourceKey || "");
    return SOURCE_KEY_PATTERN.test(key) ? key : buildStableSourceKey(candidate);
  }))].sort(compareText);
  return sha256(stableStringify(keys));
}

function validateSelectedSourceKeys(keys, candidates) {
  if (!Array.isArray(keys) || keys.length > 100) {
    throw calibrationError("selectedSourceKeys must be an array of at most 100 keys.", "CALIBRATION_SELECTED_SOURCES_INVALID");
  }
  const normalized = keys.map((key) => String(key || "").trim());
  if (normalized.some((key) => !SOURCE_KEY_PATTERN.test(key)) || new Set(normalized).size !== normalized.length) {
    throw calibrationError("selectedSourceKeys contains an invalid or duplicate key.", "CALIBRATION_SELECTED_SOURCES_INVALID");
  }
  const available = new Set((Array.isArray(candidates) ? candidates : []).map((candidate) => (
    SOURCE_KEY_PATTERN.test(String(candidate?.sourceKey || ""))
      ? candidate.sourceKey
      : buildStableSourceKey(candidate)
  )));
  if (normalized.some((key) => !available.has(key))) {
    throw calibrationError("A selected time source is no longer available.", "CALIBRATION_SOURCE_NOT_FOUND", 409);
  }
  return normalized.sort(compareText);
}

function normalizeCalendarText(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (/^\d{4}$/u.test(text)) {
    try { return normalizeCalibrationResolution({ resolutionKind: "year", value: text }); } catch { return null; }
  }
  if (/^\d{4}-\d{2}$/u.test(text)) {
    try { return normalizeCalibrationResolution({ resolutionKind: "month", value: text }); } catch { return null; }
  }
  if (/^\d{4}-\d{2}-\d{2}$/u.test(text)) {
    try { return normalizeCalibrationResolution({ resolutionKind: "day", value: text }); } catch { return null; }
  }
  return null;
}

function makeCandidate(input) {
  const candidate = {
    sourceType: input.sourceType,
    status: input.status,
    precision: input.interval.precision,
    intervalStart: input.interval.intervalStart,
    intervalEnd: input.interval.intervalEnd,
    displayDate: input.interval.value,
    memoryId: input.memoryId || "",
    memoryTitle: input.memoryTitle || ""
  };
  for (const key of [
    "revisionNo", "snapshotSha256", "claimQuoteSha256", "claimStartOffset",
    "claimEndOffset", "sourceQuote", "assetContentSha256", "timezoneKind"
  ]) {
    if (input[key] !== undefined && input[key] !== null && input[key] !== "") candidate[key] = input[key];
  }
  candidate.sourceKey = buildStableSourceKey(candidate);
  return candidate;
}

function isDateClaim(claim) {
  const claimKey = normalizeToken(firstDefined(claim.claimKey, claim.claim_key, claim.key, claim.field));
  const claimType = normalizeToken(firstDefined(claim.type, claim.claimType, claim.claim_type));
  if (DATE_CLAIM_TOKENS.has(claimKey) || DATE_CLAIM_TOKENS.has(claimType)) return true;
  return isPlainObject(claim.value) && [
    "calendarDate", "date", "endDate", "intervalEnd", "intervalStart", "occurredOn", "startDate"
  ].some((key) => Object.hasOwn(claim.value, key));
}

function isSingleIntervalEvidence(interval) {
  return Boolean(interval) && !["alternatives", "uncertain"].includes(interval.resolutionKind) &&
    Boolean(readInterval(interval));
}

function readInterval(value) {
  if (!isPlainObject(value)) return null;
  const kind = String(value.resolutionKind || value.precision || "");
  if (kind === "uncertain") return null;
  const start = String(value.intervalStart || "");
  const end = String(value.intervalEnd || "");
  if (!parseCanonicalDay(start) || !parseCanonicalDay(end) || start > end) return null;
  return { start, end };
}

function parseCanonicalDay(value) {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!validYear(year) || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

function requireMatchingSuppliedInterval(normalized, rawStart, rawEnd) {
  if (rawStart !== undefined && String(rawStart).trim() !== normalized.intervalStart) {
    throw calibrationError("The supplied interval start is not canonical for its precision.", "CALIBRATION_INTERVAL_INVALID");
  }
  if (rawEnd !== undefined && String(rawEnd).trim() !== normalized.intervalEnd) {
    throw calibrationError("The supplied interval end is not canonical for its precision.", "CALIBRATION_INTERVAL_INVALID");
  }
}

function formatDay(parts) {
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function daysInMonth(year, month) {
  return [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] || 0;
}

function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function validYear(year) {
  return Number.isInteger(year) && year >= 1 && year <= 9999;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort(compareText).map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

function optionalSha256(value) {
  const text = String(value || "").trim().toLowerCase();
  return SHA256_PATTERN.test(text) ? text : "";
}

function optionalPositiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function optionalNonNegativeInteger(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function normalizeNumericPart(value, width) {
  if ((typeof value !== "number" && typeof value !== "string") || !/^\d+$/u.test(String(value).trim())) return "";
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || String(number).length > width) return "";
  return String(number).padStart(width, "0");
}

function normalizeTimezoneKind(value) {
  if (isPlainObject(value)) return displayText(value.kind, 40);
  const text = displayText(value, 40);
  return text ? "explicit" : "local-floating";
}

function normalizeToken(value) {
  return String(value || "").trim().toLowerCase().replace(/[\s-]+/gu, "_");
}

function displayText(value, maximum) {
  return String(value || "").replace(/\s+/gu, " ").trim().slice(0, maximum);
}

function localId(value) {
  return typeof value === "string" ? value.trim().slice(0, 120) : "";
}

function firstText(...values) {
  const value = values.find((entry) => typeof entry === "string" && entry.trim());
  return value === undefined ? "" : value.trim();
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function compareCandidates(left, right) {
  return compareText(left.sourceKey, right.sourceKey) || compareText(left.memoryId, right.memoryId);
}

function compareCandidateDetails(left, right) {
  return compareText(stableStringify(left), stableStringify(right));
}

function compareText(left, right) {
  return String(left).localeCompare(String(right), "en");
}

function calibrationError(message, code, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

module.exports = {
  CALIBRATION_RESOLUTION_KINDS,
  TIME_CALIBRATION_SCHEMA_VERSION,
  buildSourceSetSha256,
  buildStableSourceKey,
  buildTimeCandidates,
  compareIntervals,
  normalizeCalendarEvidence,
  normalizeCalibrationResolution,
  validateSelectedSourceKeys
};
