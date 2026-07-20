"use strict";

const {
  PROVENANCE_SCHEMA_VERSION,
  requireId,
  requireSha256,
  requireTimestamp,
  stableStringify,
  validateClaimAggregate,
  validateStoredSourceSnapshot,
  provenanceError
} = require("./provenance-service");

const MAX_BACKUP_CLAIMS = 50_000;
const MAX_BACKUP_SOURCES = 400_000;
const MAX_BACKUP_EVENTS = 150_000;
const PROVENANCE_REDACTED_NOTE = "主张文字、来源摘录、定位区间、图片坐标、声音选段、内部标识与哈希已从脱敏导出中物理移除。";
const FULL_ROOT_KEYS = Object.freeze(["claims", "events", "mode", "schemaVersion", "sources"]);
const REDACTED_ROOT_KEYS = Object.freeze([
  "claimCount", "confirmedCount", "draftCount", "mode", "needsReviewCount",
  "note", "sourceCount", "withdrawnCount"
]);
const CLAIM_KEYS = Object.freeze(["claimSha256", "createdAt", "id", "memoryId", "sourceSetSha256", "statement"]);
const SOURCE_KEYS = Object.freeze([
  "anchorKey", "claimId", "createdAt", "id", "locator", "originRef", "position",
  "relationKind", "sensitive", "snapshot", "snapshotSha256", "sourceKey", "sourceKind"
]);
const EVENT_KEYS = Object.freeze([
  "action", "claimId", "createdAt", "eventSha256", "id", "previousEventSha256",
  "sequence", "sourceSetSha256"
]);

function buildProvenanceBackup(input = {}) {
  const mode = input.mode === "redacted" ? "redacted" : input.mode;
  const aggregates = normalizeAggregateList(input.aggregates);
  if (mode === "redacted") {
    const states = aggregates.map((entry) => String(entry.state?.status || deriveStoredStatus(entry.events)));
    const claimCount = states.length;
    const draftCount = states.filter((status) => status === "draft").length;
    const confirmedCount = states.filter((status) => status === "confirmed").length;
    const needsReviewCount = states.filter((status) => status === "needsReview").length;
    const withdrawnCount = states.filter((status) => status === "withdrawn").length;
    return Object.freeze({
      mode: "redacted-summary",
      claimCount,
      draftCount,
      confirmedCount,
      needsReviewCount,
      withdrawnCount,
      sourceCount: aggregates.reduce((total, entry) => total + entry.sources.length, 0),
      note: PROVENANCE_REDACTED_NOTE
    });
  }
  if (mode !== "full") throw backupError("Provenance backup mode is invalid.");
  const claims = aggregates.map((entry) => projectClaim(entry.claim));
  const sources = aggregates.flatMap((entry) => entry.sources.map(projectSource));
  const events = aggregates.flatMap((entry) => entry.events.map(projectEvent));
  const payload = {
    mode: "full",
    schemaVersion: PROVENANCE_SCHEMA_VERSION,
    claims: claims.sort(compareClaim),
    sources: sources.sort(compareSource),
    events: events.sort(compareEvent)
  };
  validateProvenanceBackupPayload(payload);
  return Object.freeze(payload);
}

function validateProvenanceBackupPayload(payload, options = {}) {
  assertPlainObject(payload, "provenance backup");
  if (payload.mode === "redacted-summary") {
    assertExactKeys(payload, REDACTED_ROOT_KEYS, "redacted provenance backup");
    if (payload.note !== PROVENANCE_REDACTED_NOTE) throw backupError("Redacted provenance note is invalid.");
    const claimCount = requireCount(payload.claimCount, "claimCount", MAX_BACKUP_CLAIMS);
    const draftCount = requireCount(payload.draftCount, "draftCount", claimCount);
    const confirmedCount = requireCount(payload.confirmedCount, "confirmedCount", claimCount);
    const needsReviewCount = requireCount(payload.needsReviewCount, "needsReviewCount", claimCount);
    const withdrawnCount = requireCount(payload.withdrawnCount, "withdrawnCount", claimCount);
    const sourceCount = requireCount(payload.sourceCount, "sourceCount", MAX_BACKUP_SOURCES);
    if (draftCount + confirmedCount + needsReviewCount + withdrawnCount !== claimCount || (claimCount === 0 && sourceCount !== 0)) {
      throw backupError("Redacted provenance counts are inconsistent.");
    }
    return options.returnNormalized
      ? Object.freeze({ mode: "redacted-summary", claims: [], sources: [], events: [] })
      : true;
  }
  assertExactKeys(payload, FULL_ROOT_KEYS, "full provenance backup");
  if (payload.mode !== "full" || payload.schemaVersion !== PROVENANCE_SCHEMA_VERSION ||
      !Array.isArray(payload.claims) || payload.claims.length > MAX_BACKUP_CLAIMS ||
      !Array.isArray(payload.sources) || payload.sources.length > MAX_BACKUP_SOURCES ||
      !Array.isArray(payload.events) || payload.events.length > MAX_BACKUP_EVENTS) {
    throw backupError("Full provenance backup envelope is invalid.");
  }
  if (payload.sources.length < payload.claims.length || payload.events.length < payload.claims.length ||
      payload.events.length > payload.claims.length * 3) {
    throw backupError("Provenance backup counts cannot close over their claims.");
  }
  const memoryBoundary = options.memoryIds === undefined ? null : new Set(options.memoryIds.map((id) => requireId(id, "memoryId")));
  const claims = payload.claims.map(normalizeBackupClaim);
  const sources = payload.sources.map(normalizeBackupSource);
  const events = payload.events.map(normalizeBackupEvent);
  assertUnique(claims.map((claim) => claim.id), "claim id");
  assertUnique(sources.map((source) => source.id), "source id");
  assertUnique(events.map((event) => event.id), "event id");
  if (memoryBoundary && claims.some((claim) => !memoryBoundary.has(claim.memoryId))) {
    throw backupError("A provenance claim references a memory outside the archive boundary.", "PROVENANCE_BACKUP_REFERENCE_INVALID");
  }
  const claimById = new Map(claims.map((claim) => [claim.id, claim]));
  const sourcesByClaim = groupByClaim(sources, claimById, "source");
  const eventsByClaim = groupByClaim(events, claimById, "event");
  for (const claim of claims) {
    const claimSources = (sourcesByClaim.get(claim.id) || []).sort((left, right) => left.position - right.position || left.id.localeCompare(right.id, "en"));
    const claimEvents = (eventsByClaim.get(claim.id) || []).sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id, "en"));
    validateClaimAggregate({ claim, sources: claimSources, events: claimEvents });
    if (claimSources.some((source) => Date.parse(source.createdAt) < Date.parse(claim.createdAt))) {
      throw backupError("A provenance source predates its claim.");
    }
  }
  const normalized = Object.freeze({
    mode: "full",
    schemaVersion: PROVENANCE_SCHEMA_VERSION,
    claims: Object.freeze(claims),
    sources: Object.freeze(sources),
    events: Object.freeze(events)
  });
  return options.returnNormalized ? normalized : true;
}

function normalizeAggregateList(value) {
  if (!Array.isArray(value) || value.length > MAX_BACKUP_CLAIMS) throw backupError("Provenance aggregates are invalid.");
  return value.map((entry, index) => {
    assertPlainObject(entry, `aggregates[${index}]`);
    const projected = {
      claim: projectClaim(entry.claim),
      sources: Array.isArray(entry.sources) ? entry.sources.map(projectSource) : [],
      events: Array.isArray(entry.events) ? entry.events.map(projectEvent) : []
    };
    validateClaimAggregate(projected);
    const status = entry.state?.status;
    if (status !== undefined && !["draft", "confirmed", "needsReview", "withdrawn"].includes(status)) {
      throw backupError("Provenance aggregate state is invalid.");
    }
    return Object.freeze({ ...projected, state: status === undefined ? null : Object.freeze({ status }) });
  });
}

function projectClaim(claim = {}) {
  return Object.freeze({
    id: requireId(claim.id, "claim.id"),
    memoryId: requireId(claim.memoryId, "claim.memoryId"),
    statement: String(claim.statement || ""),
    sourceSetSha256: requireSha256(claim.sourceSetSha256, "claim.sourceSetSha256"),
    claimSha256: requireSha256(claim.claimSha256, "claim.claimSha256"),
    createdAt: requireTimestamp(claim.createdAt, "claim.createdAt")
  });
}

function projectSource(source = {}) {
  return Object.freeze({
    id: requireId(source.id, "source.id"),
    claimId: requireId(source.claimId, "source.claimId"),
    position: requireCount(source.position, "source.position", 7),
    relationKind: source.relationKind,
    sourceKind: source.sourceKind,
    sourceKey: source.sourceKey,
    anchorKey: source.anchorKey,
    originRef: cloneJson(source.originRef, "source.originRef"),
    locator: cloneJson(source.locator, "source.locator"),
    snapshot: cloneJson(source.snapshot, "source.snapshot"),
    snapshotSha256: requireSha256(source.snapshotSha256, "source.snapshotSha256"),
    sensitive: requireBoolean(source.sensitive, "source.sensitive"),
    createdAt: requireTimestamp(source.createdAt, "source.createdAt")
  });
}

function projectEvent(event = {}) {
  return Object.freeze({
    id: requireId(event.id, "event.id"),
    claimId: requireId(event.claimId, "event.claimId"),
    sequence: requireCount(event.sequence, "event.sequence", 2),
    action: String(event.action || ""),
    sourceSetSha256: requireSha256(event.sourceSetSha256, "event.sourceSetSha256"),
    previousEventSha256: String(event.previousEventSha256 || ""),
    eventSha256: requireSha256(event.eventSha256, "event.eventSha256"),
    createdAt: requireTimestamp(event.createdAt, "event.createdAt")
  });
}

function normalizeBackupClaim(claim, index) {
  assertPlainObject(claim, `claims[${index}]`);
  assertExactKeys(claim, CLAIM_KEYS, `claims[${index}]`);
  return projectClaim(claim);
}

function normalizeBackupSource(source, index) {
  assertPlainObject(source, `sources[${index}]`);
  assertExactKeys(source, SOURCE_KEYS, `sources[${index}]`);
  const projected = projectSource(source);
  const normalized = validateStoredSourceSnapshot({
    relationKind: projected.relationKind,
    sourceKind: projected.sourceKind,
    sourceKey: projected.sourceKey,
    anchorKey: projected.anchorKey,
    originRef: projected.originRef,
    locator: projected.locator,
    snapshot: projected.snapshot,
    snapshotSha256: projected.snapshotSha256,
    sensitive: projected.sensitive
  }, { name: `sources[${index}]` });
  return Object.freeze({ ...projected, ...normalized });
}

function normalizeBackupEvent(event, index) {
  assertPlainObject(event, `events[${index}]`);
  assertExactKeys(event, EVENT_KEYS, `events[${index}]`);
  return projectEvent(event);
}

function groupByClaim(entries, claimById, label) {
  const grouped = new Map();
  for (const entry of entries) {
    if (!claimById.has(entry.claimId)) {
      throw backupError(`A provenance ${label} references a missing claim.`, "PROVENANCE_BACKUP_REFERENCE_INVALID");
    }
    if (!grouped.has(entry.claimId)) grouped.set(entry.claimId, []);
    grouped.get(entry.claimId).push(entry);
  }
  return grouped;
}

function deriveStoredStatus(events) {
  const actions = events.map((event) => event.action);
  if (actions.at(-1) === "withdrawn") return "withdrawn";
  return actions.includes("confirmed") ? "confirmed" : "draft";
}

function assertUnique(values, label) {
  if (new Set(values).size !== values.length) throw backupError(`Duplicate provenance ${label}.`, "PROVENANCE_BACKUP_DUPLICATE");
}

function assertExactKeys(value, expected, name) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (stableStringify(actual) !== stableStringify(wanted)) throw backupError(`${name} field set is invalid.`);
}

function assertPlainObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw backupError(`${name} must be an object.`);
  }
}

function cloneJson(value, name) {
  let serialized;
  try { serialized = JSON.stringify(value); } catch { throw backupError(`${name} is not JSON serializable.`); }
  if (serialized === undefined) throw backupError(`${name} is not JSON serializable.`);
  return JSON.parse(serialized);
}

function requireBoolean(value, name) {
  if (typeof value !== "boolean") throw backupError(`${name} must be boolean.`);
  return value;
}

function requireCount(value, name, maximum) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || number > maximum) throw backupError(`${name} is invalid.`);
  return number;
}

function compareClaim(left, right) {
  return left.memoryId.localeCompare(right.memoryId, "en") || left.createdAt.localeCompare(right.createdAt, "en") || left.id.localeCompare(right.id, "en");
}

function compareSource(left, right) {
  return left.claimId.localeCompare(right.claimId, "en") || left.position - right.position || left.id.localeCompare(right.id, "en");
}

function compareEvent(left, right) {
  return left.claimId.localeCompare(right.claimId, "en") || left.sequence - right.sequence || left.id.localeCompare(right.id, "en");
}

function backupError(message, code = "PROVENANCE_BACKUP_INVALID") {
  const error = provenanceError(message, code, 400);
  return error;
}

module.exports = {
  MAX_BACKUP_CLAIMS,
  MAX_BACKUP_EVENTS,
  MAX_BACKUP_SOURCES,
  PROVENANCE_REDACTED_NOTE,
  buildProvenanceBackup,
  validateProvenanceBackupPayload
};
