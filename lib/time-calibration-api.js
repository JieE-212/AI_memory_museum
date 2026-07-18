"use strict";

const { createHash } = require("node:crypto");

const TARGET_PATH = /^\/api\/time-calibrations\/(memories|events)\/([a-zA-Z0-9_-]{1,120})$/u;
const PUT_KEYS = Object.freeze([
  "confirm",
  "intervalEnd",
  "intervalStart",
  "note",
  "resolutionKind",
  "selectedSourceKeys",
  "sourceSetSha256"
]);
const DELETE_KEYS = Object.freeze(["confirm"]);
const TIMELINE_QUERY_KEYS = new Set(["limit", "order"]);
const MAX_PUBLIC_CANDIDATES = 100;

function createTimeCalibrationApi(options = {}) {
  const store = options.store;
  const sendJson = options.sendJson;
  const readJsonBody = options.readJsonBody;
  const makeHttpError = options.httpError;
  const interviewDemo = Boolean(options.interviewDemo);
  assertDependencies({ store, sendJson, readJsonBody, makeHttpError });

  async function handle(request, response, url) {
    if (url.pathname === "/api/timeline") {
      try {
        if (request.method !== "GET") throw makeHttpError(405, "Timeline only supports GET.");
        const listOptions = normalizeTimelineQuery(url);
        const entries = store.listTimelineEntries(listOptions).map(publicTimelineEntry);
        return sendJson(response, 200, { count: entries.length, entries });
      } catch (error) {
        throw normalizeApiError(error, makeHttpError);
      }
    }

    const match = url.pathname.match(TARGET_PATH);
    if (!match) {
      if (url.pathname.startsWith("/api/time-calibrations/")) {
        throw makeHttpError(400, "Time calibration target path is invalid.");
      }
      return false;
    }

    try {
      assertNoQuery(url, makeHttpError);
      const targetType = match[1] === "memories" ? "memory" : "event";
      const targetId = match[2];
      if (request.method === "GET") {
        return respondWorkspace(response, 200, readWorkspace(targetType, targetId), false);
      }
      if (request.method === "PUT") {
        assertPersistentWritesAllowed(interviewDemo, makeHttpError);
        const body = await readJsonBody(request);
        assertExactBody(body, PUT_KEYS, "Time calibration", makeHttpError);
        if (body.confirm !== true) throw makeHttpError(400, "Saving a time calibration requires confirm: true.");
        const current = readWorkspace(targetType, targetId);
        const expectedUpdatedAt = requireIfMatch(request, current, makeHttpError);
        const input = {
          resolutionKind: body.resolutionKind,
          intervalStart: body.intervalStart,
          intervalEnd: body.intervalEnd,
          selectedSourceKeys: body.selectedSourceKeys,
          sourceSetSha256: body.sourceSetSha256,
          note: body.note
        };
        if (targetType === "memory") {
          store.saveMemoryTimeCalibration(targetId, input, expectedUpdatedAt === null ? {} : { expectedUpdatedAt });
        } else {
          store.saveEventTimeCalibration(targetId, input, expectedUpdatedAt === null ? {} : { expectedUpdatedAt });
        }
        const workspace = readWorkspace(targetType, targetId);
        return respondWorkspace(response, current.calibration ? 200 : 201, workspace, true);
      }
      if (request.method === "DELETE") {
        assertPersistentWritesAllowed(interviewDemo, makeHttpError);
        const body = await readJsonBody(request);
        assertExactBody(body, DELETE_KEYS, "Time calibration deletion", makeHttpError);
        if (body.confirm !== true) throw makeHttpError(400, "Deleting a time calibration requires confirm: true.");
        const current = readWorkspace(targetType, targetId);
        if (!current.calibration) {
          const error = makeHttpError(404, "No saved time calibration exists for this target.");
          error.code = "CALIBRATION_NOT_FOUND";
          throw error;
        }
        const expectedUpdatedAt = requireIfMatch(request, current, makeHttpError);
        const deleted = targetType === "memory"
          ? store.deleteMemoryTimeCalibration(targetId, { expectedUpdatedAt })
          : store.deleteEventTimeCalibration(targetId, { expectedUpdatedAt });
        return sendJson(response, 200, {
          ok: true,
          deleted: Boolean(deleted),
          target: { type: targetType, id: targetId }
        });
      }
      throw makeHttpError(405, "Time calibration only supports GET, PUT and DELETE.");
    } catch (error) {
      throw normalizeApiError(error, makeHttpError);
    }
  }

  function readWorkspace(targetType, targetId) {
    return targetType === "memory"
      ? store.getMemoryCalibrationWorkspace(targetId)
      : store.getEventCalibrationWorkspace(targetId);
  }

  function respondWorkspace(response, statusCode, workspace, ok) {
    const etag = timeCalibrationEtag(workspace);
    if (response && typeof response.setHeader === "function") response.setHeader("ETag", etag);
    return sendJson(response, statusCode, {
      ...(ok ? { ok: true } : {}),
      ...publicWorkspace(workspace),
      etag
    });
  }

  return Object.freeze({ handle });
}

function timeCalibrationEtag(workspace) {
  const targetType = String(workspace?.target?.type || "");
  const targetId = String(workspace?.target?.id || "");
  const calibration = workspace?.calibration || null;
  const semantic = calibration ? {
    currentSourceSetSha256: String(workspace?.sourceSetSha256 || ""),
    intervalEnd: String(calibration.intervalEnd || ""),
    intervalStart: String(calibration.intervalStart || ""),
    note: String(calibration.note || ""),
    resolutionKind: String(calibration.resolutionKind || ""),
    selectedSourceKeys: Array.isArray(calibration.selectedSourceKeys) ? [...calibration.selectedSourceKeys].sort(compareText) : [],
    selectedSourceSnapshots: Array.isArray(calibration.selectedSourceSnapshots) ? calibration.selectedSourceSnapshots : [],
    sourceSetSha256: String(calibration.sourceSetSha256 || "")
  } : {
    sourceSetSha256: String(workspace?.sourceSetSha256 || ""),
    state: "empty"
  };
  const semanticDigest = sha256(stableStringify(semantic));
  const version = stableStringify({
    semanticDigest,
    targetId,
    targetType,
    updatedAt: String(calibration?.updatedAt || "")
  });
  return `"time-calibration-${sha256(version)}"`;
}

function publicWorkspace(workspace) {
  const allCandidates = Array.isArray(workspace?.candidates) ? workspace.candidates : [];
  const candidates = prioritizePublicCandidates(allCandidates, workspace?.calibration).slice(0, MAX_PUBLIC_CANDIDATES);
  return {
    target: publicTarget(workspace?.target),
    calibration: publicCalibration(workspace?.calibration),
    candidates: candidates.map(publicCandidate),
    candidateCount: allCandidates.length,
    candidatesTruncated: allCandidates.length > candidates.length,
    sourceSetSha256: String(workspace?.sourceSetSha256 || ""),
    needsReview: Boolean(workspace?.needsReview)
  };
}

function prioritizePublicCandidates(candidates, calibration) {
  const selected = new Set(Array.isArray(calibration?.selectedSourceKeys) ? calibration.selectedSourceKeys : []);
  const priorities = new Map([
    ["memory-current", 1],
    ["raw-claim", 2],
    ["exif", 3],
    ["revision", 4]
  ]);
  return [...candidates].sort((left, right) => {
    const selectedOrder = Number(!selected.has(left?.sourceKey)) - Number(!selected.has(right?.sourceKey));
    if (selectedOrder) return selectedOrder;
    const sourceOrder = (priorities.get(left?.sourceType) || 9) - (priorities.get(right?.sourceType) || 9);
    return sourceOrder || compareText(left?.sourceKey, right?.sourceKey);
  });
}

function publicTarget(target) {
  if (!target || typeof target !== "object") return null;
  return {
    type: String(target.type || ""),
    id: String(target.id || ""),
    title: String(target.title || ""),
    ...(target.type === "memory" ? { date: String(target.date || "") } : {
      status: String(target.status || ""),
      memberCount: Number(target.memberCount) || 0
    }),
    evidenceMemoryCount: Number(target.evidenceMemoryCount) || 0
  };
}

function publicCalibration(calibration) {
  if (!calibration) return null;
  return {
    id: String(calibration.id || ""),
    targetType: String(calibration.targetType || ""),
    memoryId: String(calibration.memoryId || ""),
    eventId: String(calibration.eventId || ""),
    resolutionKind: String(calibration.resolutionKind || ""),
    intervalStart: String(calibration.intervalStart || ""),
    intervalEnd: String(calibration.intervalEnd || ""),
    selectedSourceKeys: Array.isArray(calibration.selectedSourceKeys) ? [...calibration.selectedSourceKeys] : [],
    selectedSourceSnapshots: Array.isArray(calibration.selectedSourceSnapshots)
      ? calibration.selectedSourceSnapshots.map(publicSourceSnapshot)
      : [],
    sourceSetSha256: String(calibration.sourceSetSha256 || ""),
    note: String(calibration.note || ""),
    createdAt: String(calibration.createdAt || ""),
    updatedAt: String(calibration.updatedAt || "")
  };
}

function publicSourceSnapshot(snapshot) {
  return {
    intervalEnd: String(snapshot?.intervalEnd || ""),
    intervalStart: String(snapshot?.intervalStart || ""),
    precision: String(snapshot?.precision || ""),
    sourceKey: String(snapshot?.sourceKey || ""),
    sourceType: String(snapshot?.sourceType || "")
  };
}

function publicTimelineEntry(entry) {
  const target = entry?.target || {};
  const calibration = entry?.calibration || {};
  const memberIds = Array.isArray(target.memberIds)
    ? target.memberIds.map(String).filter((id) => /^[a-zA-Z0-9_-]{1,120}$/u.test(id)).slice(0, 2)
    : [];
  return {
    target: {
      type: String(target.type || ""),
      id: String(target.id || ""),
      title: String(target.title || ""),
      ...(memberIds.length ? { memberIds } : {})
    },
    calibration: {
      resolutionKind: String(calibration.resolutionKind || ""),
      intervalStart: String(calibration.intervalStart || ""),
      intervalEnd: String(calibration.intervalEnd || "")
    },
    needsReview: Boolean(entry?.needsReview)
  };
}

function publicCandidate(candidate) {
  const result = {
    sourceKey: String(candidate?.sourceKey || ""),
    sourceType: String(candidate?.sourceType || ""),
    status: String(candidate?.status || ""),
    precision: String(candidate?.precision || ""),
    intervalStart: String(candidate?.intervalStart || ""),
    intervalEnd: String(candidate?.intervalEnd || ""),
    displayDate: String(candidate?.displayDate || ""),
    memoryId: String(candidate?.memoryId || ""),
    memoryTitle: String(candidate?.memoryTitle || "")
  };
  for (const key of [
    "revisionNo", "snapshotSha256", "claimQuoteSha256", "claimStartOffset",
    "claimEndOffset", "sourceQuote", "assetContentSha256", "timezoneKind"
  ]) {
    if (candidate?.[key] !== undefined) result[key] = candidate[key];
  }
  return result;
}

function requireIfMatch(request, workspace, makeHttpError) {
  const ifMatch = readHeader(request, "if-match").trim();
  if (!ifMatch) {
    const error = makeHttpError(428, "Updating this time calibration requires If-Match.");
    error.code = "CALIBRATION_PRECONDITION_REQUIRED";
    throw error;
  }
  const currentEtag = timeCalibrationEtag(workspace);
  if (ifMatch !== currentEtag) {
    const error = makeHttpError(412, "This time calibration changed; refresh before continuing.");
    error.code = "CALIBRATION_VERSION_CONFLICT";
    throw error;
  }
  return workspace.calibration ? workspace.calibration.updatedAt : null;
}

function readHeader(request, name) {
  if (request?.headers && typeof request.headers.get === "function") return String(request.headers.get(name) || "");
  return String(request?.headers?.[name] || request?.headers?.[name.toLowerCase()] || "");
}

function assertPersistentWritesAllowed(interviewDemo, makeHttpError) {
  if (!interviewDemo) return;
  const error = makeHttpError(403, "The public Demo can inspect time calibration but cannot persist changes.");
  error.code = "CALIBRATION_DEMO_READ_ONLY";
  error.interviewDemo = true;
  throw error;
}

function assertExactBody(body, expectedKeys, name, makeHttpError) {
  if (!isPlainObject(body)) throw makeHttpError(400, `${name} body must be a JSON object.`);
  const actual = Object.keys(body).sort(compareText);
  const expected = [...expectedKeys].sort(compareText);
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw makeHttpError(400, `${name} body has an invalid field set.`);
  }
}

function assertNoQuery(url, makeHttpError) {
  if ([...url.searchParams.keys()].length) throw makeHttpError(400, "Time calibration target routes do not accept query parameters.");
}

function normalizeTimelineQuery(url) {
  const unknown = [...new Set([...url.searchParams.keys()].filter((key) => !TIMELINE_QUERY_KEYS.has(key)))];
  if (unknown.length) {
    const error = new Error("Timeline contains unsupported query parameters.");
    error.code = "CALIBRATION_TIMELINE_OPTIONS_INVALID";
    error.statusCode = 400;
    throw error;
  }
  if ([...url.searchParams.keys()].some((key) => url.searchParams.getAll(key).length !== 1)) {
    const error = new Error("Timeline query parameters cannot be repeated.");
    error.code = "CALIBRATION_TIMELINE_OPTIONS_INVALID";
    error.statusCode = 400;
    throw error;
  }
  return {
    ...(url.searchParams.has("limit") ? { limit: Number(url.searchParams.get("limit")) } : {}),
    ...(url.searchParams.has("order") ? { order: url.searchParams.get("order") } : {})
  };
}

function normalizeApiError(error, makeHttpError) {
  const code = String(error?.code || "");
  if (error?.statusCode && !code.startsWith("CALIBRATION_")) return error;
  if (code.startsWith("CALIBRATION_") || error instanceof TypeError || error instanceof RangeError) {
    const statusCode = Number(error?.statusCode) || 400;
    const safeMessages = {
      CALIBRATION_SOURCES_CHANGED: "Time sources changed; refresh before saving.",
      CALIBRATION_SOURCE_NOT_FOUND: "A selected time source is no longer available.",
      CALIBRATION_INTERVAL_UNSUPPORTED: "The confirmed placement is not supported by every selected time source.",
      CALIBRATION_ALTERNATIVES_CONFLICT_REQUIRED: "Keeping alternatives requires conflicting time sources.",
      CALIBRATION_ARCHIVE_SOURCES_MISMATCH: "Restored time evidence does not match the archive source boundary.",
      CALIBRATION_VERSION_CONFLICT: "This time calibration changed; refresh before continuing."
    };
    const wrapped = makeHttpError(statusCode, safeMessages[code] || error.message || "Time calibration request failed.");
    if (code) wrapped.code = code;
    if (error?.interviewDemo) wrapped.interviewDemo = true;
    return wrapped;
  }
  return error;
}

function assertDependencies({ store, sendJson, readJsonBody, makeHttpError }) {
  const methods = [
    "deleteEventTimeCalibration",
    "deleteMemoryTimeCalibration",
    "getEventCalibrationWorkspace",
    "getMemoryCalibrationWorkspace",
    "listTimelineEntries",
    "saveEventTimeCalibration",
    "saveMemoryTimeCalibration"
  ];
  if (!store || methods.some((name) => typeof store[name] !== "function") ||
      typeof sendJson !== "function" || typeof readJsonBody !== "function" || typeof makeHttpError !== "function") {
    throw new TypeError("Time calibration API dependencies are required.");
  }
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

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function compareText(left, right) {
  return String(left).localeCompare(String(right), "en");
}

module.exports = {
  createTimeCalibrationApi,
  timeCalibrationEtag
};
