"use strict";

const { createHash } = require("node:crypto");

const MULTI_PERSPECTIVE_FORMAT = "time-isle.multi-perspective-preview";
const MULTI_PERSPECTIVE_VERSION = 1;
const MULTI_PERSPECTIVE_ENGINE = "deterministic-multi-perspective-v1";
const MULTI_PERSPECTIVE_BOUNDARY =
  "对照只摆放已有记录和人工确认的来源关系；不计算可信度，不判断谁记得更准，也不把文字差异自动解释为矛盾。";
const RELATION_LABELS = Object.freeze({
  supports: "支持这条说法",
  supplements: "补充这条说法",
  different_record: "留下另一种记录"
});
const RELATION_KINDS = new Set(Object.keys(RELATION_LABELS));
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/u;
const CONTROL_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu;
const MULTI_PERSPECTIVE_LIMITS = Object.freeze({
  responses: 12,
  revisions: 8,
  claims: 20,
  sourcesPerClaim: 8,
  excerptCharacters: 800,
  questionCharacters: 500,
  titleCharacters: 160,
  hardResponses: 100,
  hardRevisions: 10_000,
  hardClaims: 100
});

function buildMultiPerspectivePreview(input = {}) {
  assertPlainObject(input, "multi-perspective input");
  assertKnownKeys(
    input,
    new Set(["memory", "passport", "responses", "revisions", "synthetic", "timeContext"]),
    "multi-perspective input"
  );
  const memory = normalizeMemory(input.memory);
  const responses = normalizeResponses(input.responses, memory.id);
  const revisions = normalizeRevisions(input.revisions, memory);
  const passport = normalizePassport(input.passport, memory.id, responses);
  const timeContext = normalizeTimeContext(input.timeContext, memory.date);
  const synthetic = input.synthetic === true;

  const linkedResponseIds = new Set(passport.linkedResponseIds);
  const responsePerspectives = responses.items.map((response) => deepFreeze({
    id: response.projectionId,
    kind: "co_memory_response",
    label: response.label,
    question: response.question.text,
    questionTruncated: response.question.truncated,
    excerpt: response.excerpt.text,
    excerptTruncated: response.excerpt.truncated,
    createdAt: response.createdAt,
    relationState: linkedResponseIds.has(response.recordId) ? "linked-by-confirmed-provenance" : "unlinked",
    identity: deepFreeze({
      assurance: "self-asserted-unverified",
      verified: false,
      signed: false,
      encryptedTransport: true,
      boundary: "称呼来自回信人自述，身份未核验，文件未签名。"
    })
  }));
  const currentPerspective = deepFreeze({
    id: currentPerspectiveId(),
    kind: "owner_current",
    label: "我的当前记录",
    question: "",
    questionTruncated: false,
    excerpt: memory.excerpt.text,
    excerptTruncated: memory.excerpt.truncated,
    createdAt: memory.updatedAt || memory.createdAt,
    relationState: passport.currentMemoryLinked ? "linked-by-confirmed-provenance" : "unlinked",
    identity: deepFreeze({
      assurance: "local-owner-recorded",
      verified: null,
      signed: null,
      encryptedTransport: false,
      boundary: "这是馆主在本机保存的当前记录，不是外部身份认证。"
    })
  });

  const perspectives = deepFreeze([currentPerspective, ...responsePerspectives]);
  const comparisonClaims = deepFreeze(passport.comparisonClaims);
  const linkedReplyCount = [...responses.projectionByRecordId.keys()]
    .filter((recordId) => linkedResponseIds.has(recordId)).length;
  const sourceProjection = {
    memory: memory.digestProjection,
    responses: responses.digestProjection,
    revisions: revisions.digestProjection,
    claims: passport.digestProjection,
    timeContext
  };
  const sourceSnapshotSha256 = sha256(stableStringify(sourceProjection));
  const base = {
    format: MULTI_PERSPECTIVE_FORMAT,
    version: MULTI_PERSPECTIVE_VERSION,
    synthetic,
    target: deepFreeze({ type: "memory", id: memory.id, title: memory.title }),
    boundary: MULTI_PERSPECTIVE_BOUNDARY,
    summary: deepFreeze({
      perspectiveCount: perspectives.length,
      replyCount: responses.total,
      linkedReplyCount,
      unlinkedReplyCount: responses.total - linkedReplyCount,
      claimCount: passport.totalComparisons,
      revisionCount: revisions.total,
      needsReviewCount: passport.needsReviewTotal
    }),
    perspectives,
    perspectivesTruncated: responses.truncated,
    editHistory: deepFreeze(revisions.items),
    editHistoryTruncated: revisions.truncated,
    comparisonClaims,
    comparisonClaimsTruncated: passport.truncated,
    timeContext,
    receipt: deepFreeze({ sourceSnapshotSha256 }),
    execution: deepFreeze({
      engine: MULTI_PERSPECTIVE_ENGINE,
      deterministic: true,
      externalModel: false,
      modelCalls: 0,
      toolCalls: 0,
      persisted: false
    })
  };
  const previewSha256 = sha256(stableStringify(base));
  return deepFreeze({
    ...base,
    receipt: deepFreeze({ ...base.receipt, previewSha256 })
  });
}

function normalizeMemory(value) {
  assertPlainObject(value, "memory");
  const id = requireId(value.id, "memory.id");
  const title = bounded(value.title, MULTI_PERSPECTIVE_LIMITS.titleCharacters, "未命名记忆");
  const rawContent = String(value.rawContent ?? value.raw_content ?? "");
  const exhibitText = String(value.exhibitText ?? value.exhibit_text ?? "");
  const excerpt = boundedResult(rawContent || exhibitText || "未保留可预览文字", MULTI_PERSPECTIVE_LIMITS.excerptCharacters);
  const date = bounded(value.date ?? value.memoryDate ?? value.memory_date, 40, "");
  const createdAt = optionalTimestamp(value.createdAt ?? value.created_at);
  const updatedAt = optionalTimestamp(value.updatedAt ?? value.updated_at);
  return {
    id,
    title,
    rawContent,
    exhibitText,
    date,
    createdAt,
    updatedAt,
    excerpt,
    digestProjection: {
      id,
      title,
      date,
      createdAt,
      updatedAt,
      contentSha256: sha256(stableStringify({ rawContent, exhibitText }))
    }
  };
}

function normalizeResponses(value, memoryId) {
  const source = boundedDenseArray(value, MULTI_PERSPECTIVE_LIMITS.hardResponses, "responses");
  const normalized = source.map((record, index) => normalizeResponse(record, memoryId, index))
    .sort((left, right) => compareTimestampDesc(left.createdAt, right.createdAt) || compareText(left.recordId, right.recordId));
  normalized.forEach((item, index) => {
    item.projectionId = responseProjectionId(index);
    item.visible = index < MULTI_PERSPECTIVE_LIMITS.responses;
  });
  const items = normalized.slice(0, MULTI_PERSPECTIVE_LIMITS.responses);
  return {
    items,
    total: normalized.length,
    truncated: normalized.length > items.length,
    projectionByRecordId: new Map(normalized.map((item) => [item.recordId, item.projectionId])),
    visibleProjectionIds: new Set(items.map((item) => item.projectionId)),
    digestProjection: normalized.map((item) => ({
      recordId: item.recordId,
      snapshotSha256: item.snapshotSha256,
      createdAt: item.createdAt
    }))
  };
}

function normalizeResponse(record, memoryId, index) {
  assertPlainObject(record, `responses[${index}]`);
  const recordId = requireId(record.id, `responses[${index}].id`);
  if (record.kind !== "co_memory_response" || record.memoryId !== memoryId ||
      record.identityAssurance !== "self-asserted-unverified" || record.identityVerified !== false ||
      record.encrypted !== true || record.signed !== false) {
    throw perspectiveError("A co-memory response crosses its saved identity or memory boundary.", "MULTI_PERSPECTIVE_RESPONSE_INVALID");
  }
  const response = plainObject(record.response) ? record.response : {};
  const request = plainObject(record.request) ? record.request : {};
  if (response.identity?.verified !== false || response.identity?.assurance !== "self-asserted-unverified") {
    throw perspectiveError("A co-memory response overstates identity assurance.", "MULTI_PERSPECTIVE_RESPONSE_INVALID");
  }
  const answer = String(response.answer ?? record.excerpt ?? "");
  if (!sanitize(answer)) {
    throw perspectiveError("A co-memory response has no saved answer.", "MULTI_PERSPECTIVE_RESPONSE_INVALID");
  }
  return {
    recordId,
    label: bounded(record.label ?? response.identity?.label, 120, "未署名共忆回信"),
    question: boundedResult(request.question || "未保留问题预览", MULTI_PERSPECTIVE_LIMITS.questionCharacters),
    excerpt: boundedResult(answer, MULTI_PERSPECTIVE_LIMITS.excerptCharacters),
    createdAt: optionalTimestamp(record.createdAt),
    snapshotSha256: requireSha256(record.snapshotSha256, `responses[${index}].snapshotSha256`)
  };
}

function normalizeRevisions(value, memory) {
  const source = boundedDenseArray(value, MULTI_PERSPECTIVE_LIMITS.hardRevisions, "revisions");
  const normalized = source.map((revision, index) => normalizeRevision(revision, memory.id, index))
    .sort((left, right) => right.revisionNo - left.revisionNo || compareText(left.revisionId, right.revisionId));
  const withoutCurrentHead = normalized.length && revisionMatchesCurrent(normalized[0], memory)
    ? normalized.slice(1)
    : normalized;
  const items = withoutCurrentHead.slice(0, MULTI_PERSPECTIVE_LIMITS.revisions).map((revision, index) => deepFreeze({
    id: editProjectionId(index),
    kind: "owner_revision",
    revisionNo: revision.revisionNo,
    changeKind: revision.changeKind,
    title: revision.title,
    date: revision.date,
    excerpt: revision.excerpt.text,
    excerptTruncated: revision.excerpt.truncated,
    createdAt: revision.createdAt,
    authorBoundary: "same-owner-edit-history",
    boundary: "这是同一位馆主对展品的编辑历史，不等于另一人的记忆。"
  }));
  return {
    items,
    total: withoutCurrentHead.length,
    truncated: withoutCurrentHead.length > items.length,
    digestProjection: normalized.map((revision) => ({
      revisionId: revision.revisionId,
      revisionNo: revision.revisionNo,
      snapshotSha256: revision.snapshotSha256,
      createdAt: revision.createdAt
    }))
  };
}

function normalizeRevision(revision, memoryId, index) {
  assertPlainObject(revision, `revisions[${index}]`);
  if (revision.memoryId !== memoryId) {
    throw perspectiveError("A revision belongs to another memory.", "MULTI_PERSPECTIVE_REVISION_INVALID");
  }
  const snapshot = plainObject(revision.snapshot) ? revision.snapshot : {};
  const rawContent = String(snapshot.rawContent ?? "");
  const exhibitText = String(snapshot.exhibitText ?? "");
  return {
    revisionId: requireId(revision.id, `revisions[${index}].id`),
    revisionNo: requirePositiveInteger(revision.revisionNo, `revisions[${index}].revisionNo`),
    changeKind: bounded(revision.changeKind, 40, "edited"),
    title: bounded(snapshot.title, MULTI_PERSPECTIVE_LIMITS.titleCharacters, "未命名记忆"),
    date: bounded(snapshot.date, 40, ""),
    rawContent,
    exhibitText,
    excerpt: boundedResult(rawContent || exhibitText || "未保留可预览文字", MULTI_PERSPECTIVE_LIMITS.excerptCharacters),
    snapshotSha256: SHA256_PATTERN.test(String(revision.snapshotSha256 || ""))
      ? revision.snapshotSha256
      : sha256(stableStringify(snapshot)),
    createdAt: optionalTimestamp(revision.createdAt)
  };
}

function revisionMatchesCurrent(revision, memory) {
  return revision.title === memory.title && revision.date === memory.date &&
    revision.rawContent === memory.rawContent && revision.exhibitText === memory.exhibitText;
}

function normalizePassport(value, memoryId, responses) {
  const passport = value === undefined || value === null ? {} : value;
  assertPlainObject(passport, "passport");
  if (passport.memoryId !== undefined && passport.memoryId !== memoryId) {
    throw perspectiveError("The source passport belongs to another memory.", "MULTI_PERSPECTIVE_PASSPORT_INVALID");
  }
  const claims = boundedDenseArray(passport.claims, MULTI_PERSPECTIVE_LIMITS.hardClaims, "passport.claims")
    .map((claim, index) => normalizeClaim(claim, memoryId, responses, index))
    .filter(Boolean)
    .sort((left, right) => compareText(left.id, right.id));
  const comparison = claims.filter((claim) => claim.isMultiPerspective);
  const visible = comparison.slice(0, MULTI_PERSPECTIVE_LIMITS.claims).map((claim, index) => deepFreeze({
    id: comparisonProjectionId(index),
    statement: claim.statement,
    status: claim.needsReview ? "needsReview" : "confirmed",
    needsReview: claim.needsReview,
    sourcesCurrent: claim.sourcesCurrent,
    boundary: claim.needsReview
      ? "来源后来变化，旧关系仍保留，但需要重新核对。"
      : "这里只确认说法与来源的关系，不是事实认证。",
    sources: deepFreeze(claim.sources.map(publicClaimSource))
  }));
  const linkedResponseIds = [...new Set(claims.flatMap((claim) => claim.linkedResponseIds))].sort(compareText);
  return {
    comparisonClaims: visible,
    linkedResponseIds,
    currentMemoryLinked: claims.some((claim) => claim.currentMemoryLinked),
    totalComparisons: comparison.length,
    needsReviewTotal: comparison.filter((claim) => claim.needsReview).length,
    truncated: comparison.length > visible.length,
    digestProjection: claims.map((claim) => claim.digestProjection)
  };
}

function normalizeClaim(claim, memoryId, responses, index) {
  assertPlainObject(claim, `passport.claims[${index}]`);
  if (claim.memoryId !== memoryId) {
    throw perspectiveError("A provenance claim belongs to another memory.", "MULTI_PERSPECTIVE_CLAIM_INVALID");
  }
  const lifecycleStatus = String(claim.lifecycleStatus || claim.status || "");
  if (lifecycleStatus !== "confirmed") return null;
  const responseIds = new Set(responses.projectionByRecordId.keys());
  const sources = boundedDenseArray(claim.sources, MULTI_PERSPECTIVE_LIMITS.sourcesPerClaim, `passport.claims[${index}].sources`)
    .map((source, sourceIndex) => normalizeClaimSource(
      source,
      memoryId,
      responseIds,
      responses.projectionByRecordId,
      responses.visibleProjectionIds,
      index,
      sourceIndex
    ));
  const perspectiveIds = sources.map((source) => source.perspectiveId).filter(Boolean);
  const distinctPerspectiveIds = new Set(perspectiveIds);
  const hasOwner = distinctPerspectiveIds.has(currentPerspectiveId());
  const responsePerspectiveCount = [...distinctPerspectiveIds].filter((id) => id.startsWith("perspective-reply-")).length;
  const linkedResponseIds = sources.flatMap((source) => source.responseRecordId ? [source.responseRecordId] : []);
  const needsReview = claim.needsReview === true || String(claim.status || "") === "needsReview";
  const statement = bounded(claim.statement, 1000, "未命名来源主张");
  return {
    id: requireId(claim.id, `passport.claims[${index}].id`),
    statement,
    needsReview,
    sourcesCurrent: claim.sourcesCurrent !== false && !needsReview,
    sources,
    linkedResponseIds,
    currentMemoryLinked: hasOwner,
    isMultiPerspective: (responsePerspectiveCount >= 2 || (hasOwner && responsePerspectiveCount >= 1)) &&
      sources.filter((source) => source.responseRecordId).every((source) => source.visiblePerspective),
    digestProjection: {
      id: claim.id,
      statement,
      status: needsReview ? "needsReview" : "confirmed",
      etag: bounded(claim.etag, 300, ""),
      sources: sources.map((source) => ({
        relationKind: source.relationKind,
        kind: source.kind,
        perspectiveId: source.perspectiveId,
        integrityStatus: source.integrityStatus,
        excerptSha256: sha256(source.excerpt)
      }))
    }
  };
}

function normalizeClaimSource(source, memoryId, responseIds, projectionByRecordId, visibleProjectionIds, claimIndex, sourceIndex) {
  const label = `passport.claims[${claimIndex}].sources[${sourceIndex}]`;
  assertPlainObject(source, label);
  const relationKind = String(source.relationKind || "");
  if (!RELATION_KINDS.has(relationKind)) {
    throw perspectiveError("A relation label was not created by provenance.", "MULTI_PERSPECTIVE_RELATION_INVALID");
  }
  const kind = String(source.sourceKind || source.kind || "");
  const originRef = plainObject(source.originRef) ? source.originRef : {};
  const referenceId = String(originRef.referenceId || "");
  let perspectiveId = "";
  let responseRecordId = "";
  if (kind === "memory_text" && originRef.memoryId === memoryId) {
    perspectiveId = currentPerspectiveId();
  } else if (kind === "co_memory_response" && referenceId.startsWith("co-memory:")) {
    responseRecordId = referenceId.slice("co-memory:".length);
    if (responseIds.has(responseRecordId)) perspectiveId = projectionByRecordId.get(responseRecordId) || "";
  }
  const metadata = plainObject(source.snapshot?.metadata) ? source.snapshot.metadata : {};
  return deepFreeze({
    kind,
    relationKind,
    relationLabel: RELATION_LABELS[relationKind],
    label: bounded(metadata.label, 120, sourceKindLabel(kind)),
    excerpt: bounded(source.snapshot?.excerpt, MULTI_PERSPECTIVE_LIMITS.excerptCharacters, "已保存来源快照"),
    integrityStatus: normalizeIntegrityStatus(source.integrityStatus),
    perspectiveId,
    responseRecordId,
    visiblePerspective: !responseRecordId || visibleProjectionIds.has(perspectiveId)
  });
}

function publicClaimSource(source) {
  return deepFreeze({
    kind: source.kind,
    relationKind: source.relationKind,
    relationLabel: source.relationLabel,
    label: source.label,
    excerpt: source.excerpt,
    integrityStatus: source.integrityStatus,
    perspectiveId: source.perspectiveId
  });
}

function normalizeTimeContext(value, memoryDate) {
  if (value === undefined || value === null) {
    return deepFreeze({ memoryDate, calibration: null, needsReview: false, boundary: timeBoundary() });
  }
  assertPlainObject(value, "timeContext");
  assertKnownKeys(value, new Set(["calibration", "needsReview", "targetTitle", "targetType"]), "timeContext");
  const calibration = plainObject(value.calibration) ? value.calibration : null;
  const normalizedCalibration = calibration ? deepFreeze({
    targetType: ["memory", "event"].includes(String(value.targetType || calibration.targetType || ""))
      ? String(value.targetType || calibration.targetType)
      : "memory",
    targetTitle: bounded(value.targetTitle, 160, ""),
    resolutionKind: normalizeResolutionKind(calibration.resolutionKind),
    intervalStart: bounded(calibration.intervalStart, 20, ""),
    intervalEnd: bounded(calibration.intervalEnd, 20, ""),
    selectedSourceCount: Array.isArray(calibration.selectedSourceKeys) ? calibration.selectedSourceKeys.length : 0,
    updatedAt: optionalTimestamp(calibration.updatedAt)
  }) : null;
  return deepFreeze({
    memoryDate,
    calibration: normalizedCalibration,
    needsReview: Boolean(value.needsReview && normalizedCalibration),
    boundary: timeBoundary()
  });
}

function timeBoundary() {
  return "这里只显示你保存的时间判断；不会改写原文或展品日期。";
}

function normalizeResolutionKind(value) {
  const kind = String(value || "");
  return new Set(["year", "month", "day", "range", "alternatives", "uncertain"]).has(kind) ? kind : "uncertain";
}

function normalizeIntegrityStatus(value) {
  const status = String(value || "");
  return new Set(["source_verified", "archived_verified", "source_changed", "source_missing"]).has(status)
    ? status
    : "source_changed";
}

function sourceKindLabel(kind) {
  return ({
    memory_text: "当前展品原文",
    document_excerpt: "文档摘录",
    image_region: "图片区域",
    voice_segment: "声音片段",
    oral_history_excerpt: "口述史片段",
    co_memory_response: "亲友回信"
  })[kind] || "已保存来源";
}

function boundedDenseArray(value, hardLimit, label) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > hardLimit) {
    throw perspectiveError(`${label} exceeds its fixed safety limit.`, "MULTI_PERSPECTIVE_LIMIT_EXCEEDED");
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) {
      throw perspectiveError(`${label} must be a dense array.`, "MULTI_PERSPECTIVE_INPUT_INVALID");
    }
  }
  return value;
}

function currentPerspectiveId() {
  return "perspective-current";
}

function responseProjectionId(index) {
  return `perspective-reply-${String(index + 1).padStart(2, "0")}`;
}

function editProjectionId(index) {
  return `edit-${String(index + 1).padStart(2, "0")}`;
}

function comparisonProjectionId(index) {
  return `comparison-${String(index + 1).padStart(2, "0")}`;
}

function boundedResult(value, maximum) {
  const text = sanitize(value);
  const characters = [...text];
  return deepFreeze({
    text: characters.slice(0, maximum).join(""),
    truncated: characters.length > maximum
  });
}

function bounded(value, maximum, fallback) {
  const result = boundedResult(value, maximum).text;
  return result || fallback;
}

function sanitize(value) {
  return String(value ?? "").replace(/\r\n?/gu, "\n").replace(CONTROL_PATTERN, " ").trim();
}

function optionalTimestamp(value) {
  const text = String(value || "");
  if (!text) return "";
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function requireId(value, label) {
  const id = String(value || "");
  if (!ID_PATTERN.test(id)) throw perspectiveError(`${label} is invalid.`, "MULTI_PERSPECTIVE_ID_INVALID");
  return id;
}

function requireSha256(value, label) {
  const hash = String(value || "");
  if (!SHA256_PATTERN.test(hash)) throw perspectiveError(`${label} is invalid.`, "MULTI_PERSPECTIVE_HASH_INVALID");
  return hash;
}

function requirePositiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) {
    throw perspectiveError(`${label} is invalid.`, "MULTI_PERSPECTIVE_REVISION_INVALID");
  }
  return number;
}

function assertKnownKeys(value, allowed, label) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) {
    throw perspectiveError(`${label} contains unsupported fields.`, "MULTI_PERSPECTIVE_INPUT_INVALID");
  }
}

function assertPlainObject(value, label) {
  if (!plainObject(value)) {
    throw perspectiveError(`${label} must be a plain object.`, "MULTI_PERSPECTIVE_INPUT_INVALID");
  }
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (plainObject(value)) {
    return `{${Object.keys(value).sort(compareText).map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

function compareTimestampDesc(left, right) {
  return String(right || "").localeCompare(String(left || ""), "en");
}

function compareText(left, right) {
  const a = String(left ?? "");
  const b = String(right ?? "");
  return a < b ? -1 : a > b ? 1 : 0;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

function perspectiveError(message, code) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = 400;
  return error;
}

module.exports = {
  MULTI_PERSPECTIVE_BOUNDARY,
  MULTI_PERSPECTIVE_ENGINE,
  MULTI_PERSPECTIVE_FORMAT,
  MULTI_PERSPECTIVE_LIMITS,
  MULTI_PERSPECTIVE_VERSION,
  RELATION_LABELS,
  buildMultiPerspectivePreview,
  stableStringify
};
