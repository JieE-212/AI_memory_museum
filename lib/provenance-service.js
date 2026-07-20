"use strict";

const { createHash } = require("node:crypto");

const PROVENANCE_SCHEMA_VERSION = 16;
const OFFSET_UNIT = "utf16-code-unit";
const COORDINATE_SPACE = "canonical-preview-v1";
const MAX_STATEMENT_LENGTH = 1000;
const MAX_SOURCES_PER_CLAIM = 8;
const MAX_EXCERPT_LENGTH = 4000;
const MAX_JSON_BYTES = 16 * 1024;
const MAX_AUDIO_MS = 3 * 60 * 1000;
const MAX_AGENT_CLAIMS_PER_MEMORY = 20;
const MAX_AGENT_SOURCES_PER_CLAIM = 4;
const RELATION_KINDS = Object.freeze(["supports", "supplements", "different_record"]);
const SOURCE_KINDS = Object.freeze([
  "memory_text",
  "document_excerpt",
  "image_region",
  "voice_segment",
  "oral_history_excerpt",
  "co_memory_response"
]);
const CURRENT_SOURCE_STATUSES = new Set(["source_verified", "archived_verified"]);
const SOURCE_STATUSES = new Set([...CURRENT_SOURCE_STATUSES, "source_changed", "source_missing"]);
const CLAIM_ACTIONS = Object.freeze(["created", "confirmed", "withdrawn"]);
const PROVENANCE_SOURCE_CATALOG_SCHEMA_VERSION = 1;
const CATALOG_CONFIRMATIONS = Object.freeze([
  "user_recorded",
  "user_admitted",
  "user_confirmed",
  "user_selected",
  "user_confirmed_unverified"
]);
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const ID_PATTERN = /^[a-zA-Z0-9_-]{1,120}$/u;
const SOURCE_CONFIG = Object.freeze({
  memory_text: Object.freeze({ sourcePrefix: "memory-text-source", anchorPrefix: "memory-text-anchor", locatorKind: "text", excerptRequired: true }),
  document_excerpt: Object.freeze({ sourcePrefix: "text-source", anchorPrefix: "text-anchor", locatorKind: "text", excerptRequired: true, inboxAnchor: true }),
  image_region: Object.freeze({ sourcePrefix: "image-source", anchorPrefix: "image-region", locatorKind: "image", excerptRequired: false }),
  voice_segment: Object.freeze({ sourcePrefix: "voice-source", anchorPrefix: "voice-segment", locatorKind: "audio", excerptRequired: false }),
  oral_history_excerpt: Object.freeze({ sourcePrefix: "oral-history-source", anchorPrefix: "oral-history-excerpt", locatorKind: "audio", excerptRequired: true }),
  co_memory_response: Object.freeze({ sourcePrefix: "co-memory-response-source", anchorPrefix: "co-memory-response-anchor", locatorKind: "text", excerptRequired: true, maxExcerpt: 8000 })
});
const CATALOG_SOURCE_CONFIG = Object.freeze({
  memory_text: Object.freeze({ sourcePrefix: "memory-text", anchorPrefix: "memory-range" }),
  document_excerpt: Object.freeze({ sourcePrefix: "text-source", anchorPrefix: "text-anchor" }),
  image_region: Object.freeze({ sourcePrefix: "image-source", anchorPrefix: "image-region" }),
  voice_segment: Object.freeze({ sourcePrefix: "voice-source", anchorPrefix: "voice-segment" }),
  oral_history_excerpt: Object.freeze({ sourcePrefix: "time-source", anchorPrefix: "oral-history" }),
  co_memory_response: Object.freeze({ sourcePrefix: "co-memory-response-source", anchorPrefix: "co-memory-response-anchor" })
});

function normalizeClaimDraftInput(input = {}) {
  assertPlainObject(input, "claim");
  assertKnownKeys(input, new Set(["memoryId", "statement", "sources"]), "claim");
  const memoryId = requireId(input.memoryId, "claim.memoryId");
  const statement = requireText(input.statement, "claim.statement", MAX_STATEMENT_LENGTH);
  if (!Array.isArray(input.sources) || input.sources.length < 1 || input.sources.length > MAX_SOURCES_PER_CLAIM) {
    throw provenanceError(`claim.sources must contain 1-${MAX_SOURCES_PER_CLAIM} sources.`, "PROVENANCE_SOURCE_COUNT_INVALID");
  }
  const sources = input.sources.map((source, index) => normalizeVerifiedSourceSnapshot(source, { name: `claim.sources[${index}]` }));
  const anchorKeys = sources.map((source) => source.anchorKey);
  if (new Set(anchorKeys).size !== anchorKeys.length) {
    throw provenanceError("A claim cannot bind the same source anchor twice.", "PROVENANCE_SOURCE_DUPLICATE");
  }
  const sourceSetSha256 = buildSourceSetSha256(sources);
  return Object.freeze({
    memoryId,
    statement,
    sources: Object.freeze(sources),
    sourceSetSha256,
    claimSha256: buildClaimSha256({ statement, sourceSetSha256 })
  });
}

function normalizeVerifiedSourceSnapshot(input = {}, options = {}) {
  const name = String(options.name || "source");
  assertPlainObject(input, name);
  assertKnownKeys(input, new Set([
    "relationKind", "sourceKind", "sourceKey", "anchorKey", "originRef", "locator",
    "sourceSha256", "excerpt", "metadata", "sensitive"
  ]), name);
  const sourceKind = requireEnum(input.sourceKind, SOURCE_KINDS, `${name}.sourceKind`);
  const relationKind = requireEnum(input.relationKind, RELATION_KINDS, `${name}.relationKind`);
  const config = SOURCE_CONFIG[sourceKind];
  const sourceSha256 = requireSha256(input.sourceSha256, `${name}.sourceSha256`);
  const sourceKey = requireContentKey(input.sourceKey, config.sourcePrefix, `${name}.sourceKey`);
  if (!config.inboxAnchor && sourceKey.slice(sourceKey.lastIndexOf(":") + 1) !== sourceSha256) {
    throw provenanceError(`${name}.sourceKey must be bound to sourceSha256.`, "PROVENANCE_SOURCE_HASH_MISMATCH");
  }
  const originRef = cloneJsonObject(input.originRef, `${name}.originRef`);
  const locator = normalizeLocator(input.locator, config.locatorKind, `${name}.locator`);
  const excerpt = normalizeExcerpt(input.excerpt, config.excerptRequired, `${name}.excerpt`, config.maxExcerpt);
  if (config.locatorKind === "text" && locator.endOffset - locator.startOffset !== excerpt.length) {
    throw provenanceError(`${name}.excerpt length must match its UTF-16 range.`, "PROVENANCE_TEXT_RANGE_MISMATCH");
  }
  const metadata = input.metadata === undefined ? {} : cloneJsonObject(input.metadata, `${name}.metadata`);
  const snapshot = Object.freeze({
    sourceSha256,
    excerpt,
    excerptSha256: sha256(excerpt),
    metadata
  });
  requireJsonBudget(snapshot, `${name}.snapshot`);
  const snapshotSha256 = sha256(stableStringify(snapshot));
  const expectedAnchorKey = buildAnchorKey({ sourceKind, sourceKey, locator, snapshotSha256, excerptSha256: snapshot.excerptSha256 });
  const anchorKey = input.anchorKey === undefined || input.anchorKey === ""
    ? expectedAnchorKey
    : requireContentKey(input.anchorKey, config.anchorPrefix, `${name}.anchorKey`);
  if (anchorKey !== expectedAnchorKey) {
    throw provenanceError(`${name}.anchorKey does not match its source snapshot.`, "PROVENANCE_ANCHOR_HASH_MISMATCH");
  }
  return Object.freeze({
    relationKind,
    sourceKind,
    sourceKey,
    anchorKey,
    originRef,
    locator,
    snapshot,
    snapshotSha256,
    sensitive: requireBoolean(input.sensitive ?? false, `${name}.sensitive`)
  });
}

// This bridge is deliberately called only after provenance-sources.resolveSource()
// returns `resolved`. Rechecking the catalog snapshot digest here prevents accidental
// contract drift; it is not a substitute for resolving the live source server-side.
function catalogSourceToClaimSource(input = {}, options = {}) {
  const name = String(options.name || "catalog source");
  assertPlainObject(options, "catalog bridge options");
  assertKnownKeys(options, new Set(["name", "relationKind", "sensitive"]), "catalog bridge options");
  assertPlainObject(input, name);
  assertKnownKeys(input, new Set([
    "schemaVersion", "kind", "memoryId", "referenceId", "sourceKey", "anchorKey",
    "label", "locator", "excerpt", "contentSha256", "confirmation", "snapshotSha256"
  ]), name);
  if (input.schemaVersion !== PROVENANCE_SOURCE_CATALOG_SCHEMA_VERSION) {
    throw provenanceError(`${name}.schemaVersion is unsupported.`, "PROVENANCE_CATALOG_SCHEMA_INVALID");
  }
  const sourceKind = requireEnum(input.kind, SOURCE_KINDS, `${name}.kind`);
  const catalogConfig = CATALOG_SOURCE_CONFIG[sourceKind];
  const memoryId = requireId(input.memoryId, `${name}.memoryId`);
  const referenceId = requireCatalogReferenceId(input.referenceId, `${name}.referenceId`);
  const catalogSourceKey = requireContentKey(input.sourceKey, catalogConfig.sourcePrefix, `${name}.sourceKey`);
  const catalogAnchorKey = requireContentKey(input.anchorKey, catalogConfig.anchorPrefix, `${name}.anchorKey`);
  const label = requireText(input.label, `${name}.label`, 120);
  const catalogLocator = cloneJsonObject(input.locator, `${name}.locator`);
  const locator = normalizeCatalogLocator(catalogLocator, sourceKind, `${name}.locator`);
  const excerpt = normalizeExcerpt(input.excerpt, SOURCE_CONFIG[sourceKind].excerptRequired, `${name}.excerpt`, SOURCE_CONFIG[sourceKind].maxExcerpt);
  const contentSha256 = requireSha256(input.contentSha256, `${name}.contentSha256`);
  const confirmation = requireEnum(input.confirmation, CATALOG_CONFIRMATIONS, `${name}.confirmation`);
  const snapshotSha256 = requireSha256(input.snapshotSha256, `${name}.snapshotSha256`);
  const expectedSnapshotSha256 = sha256(stableStringify({
    schemaVersion: PROVENANCE_SOURCE_CATALOG_SCHEMA_VERSION,
    kind: sourceKind,
    memoryId,
    referenceId,
    sourceKey: catalogSourceKey,
    anchorKey: catalogAnchorKey,
    locator: catalogLocator,
    excerpt,
    contentSha256,
    confirmation
  }));
  if (snapshotSha256 !== expectedSnapshotSha256) {
    throw provenanceError(`${name}.snapshotSha256 is invalid.`, "PROVENANCE_CATALOG_SNAPSHOT_INVALID");
  }
  const relationKind = requireEnum(options.relationKind || "supports", RELATION_KINDS, "catalog bridge options.relationKind");
  const sensitive = requireBoolean(options.sensitive ?? false, "catalog bridge options.sensitive");
  const catalogIdentity = Object.freeze({
    schemaVersion: PROVENANCE_SOURCE_CATALOG_SCHEMA_VERSION,
    referenceId,
    sourceKey: catalogSourceKey,
    anchorKey: catalogAnchorKey,
    snapshotSha256
  });
  return Object.freeze({
    relationKind,
    sourceKind,
    sourceKey: `${SOURCE_CONFIG[sourceKind].sourcePrefix}:${contentSha256}`,
    originRef: Object.freeze({
      provider: "provenance-source-catalog-v1",
      memoryId,
      referenceId
    }),
    locator,
    sourceSha256: contentSha256,
    excerpt,
    metadata: Object.freeze({ label, confirmation, catalog: catalogIdentity }),
    sensitive
  });
}

function mapCatalogResolutionToResolverResult(value) {
  const catalogStatus = typeof value === "string" ? value : value?.status;
  const mapped = {
    resolved: "source_verified",
    source_changed: "source_changed",
    missing: "source_missing"
  }[catalogStatus];
  if (!mapped) {
    throw provenanceError("Catalog source resolution is invalid.", "PROVENANCE_CATALOG_RESOLUTION_INVALID", 500);
  }
  return Object.freeze({ status: mapped, reason: `catalog_${catalogStatus}` });
}

function normalizeCatalogLocator(locator, sourceKind, name) {
  if (sourceKind === "memory_text") {
    assertKnownKeys(locator, new Set(["offsetUnit", "startOffset", "endOffset"]), name);
    return normalizeLocator(locator, "text", name);
  }
  if (sourceKind === "document_excerpt") {
    assertKnownKeys(locator, new Set(["offsetUnit", "startOffset", "endOffset", "startLine", "endLine"]), name);
    return normalizeLocator({
      offsetUnit: locator.offsetUnit,
      startOffset: locator.startOffset,
      endOffset: locator.endOffset
    }, "text", name);
  }
  if (sourceKind === "image_region") {
    return normalizeLocator(locator, "image", name);
  }
  if (sourceKind === "voice_segment") {
    assertKnownKeys(locator, new Set(["startMs", "endMs", "durationMs"]), name);
    const durationMs = requireInteger(locator.durationMs, `${name}.durationMs`, 1, MAX_AUDIO_MS);
    const normalized = normalizeLocator({ startMs: locator.startMs, endMs: locator.endMs }, "audio", name);
    if (normalized.endMs > durationMs) {
      throw provenanceError(`${name} exceeds its source duration.`, "PROVENANCE_AUDIO_RANGE_INVALID");
    }
    return normalized;
  }
  if (sourceKind === "co_memory_response") {
    assertKnownKeys(locator, new Set(["responseId", "answerLength"]), name);
    requireId(locator.responseId, `${name}.responseId`);
    const answerLength = requireInteger(locator.answerLength, `${name}.answerLength`, 1, SOURCE_CONFIG.co_memory_response.maxExcerpt);
    return normalizeLocator({ offsetUnit: OFFSET_UNIT, startOffset: 0, endOffset: answerLength }, "text", name);
  }
  assertKnownKeys(locator, new Set(["eventId", "questionKey", "startMs", "endMs"]), name);
  requireId(locator.eventId, `${name}.eventId`);
  requireText(locator.questionKey, `${name}.questionKey`, 120);
  return normalizeLocator({ startMs: locator.startMs, endMs: locator.endMs }, "audio", name);
}

function validateStoredSourceSnapshot(input = {}, options = {}) {
  const name = String(options.name || "source");
  assertPlainObject(input, name);
  assertKnownKeys(input, new Set([
    "relationKind", "sourceKind", "sourceKey", "anchorKey", "originRef", "locator",
    "snapshot", "snapshotSha256", "sensitive"
  ]), name);
  assertPlainObject(input.snapshot, `${name}.snapshot`);
  assertKnownKeys(input.snapshot, new Set(["sourceSha256", "excerpt", "excerptSha256", "metadata"]), `${name}.snapshot`);
  const normalized = normalizeVerifiedSourceSnapshot({
    relationKind: input.relationKind,
    sourceKind: input.sourceKind,
    sourceKey: input.sourceKey,
    anchorKey: input.anchorKey,
    originRef: input.originRef,
    locator: input.locator,
    sourceSha256: input.snapshot.sourceSha256,
    excerpt: input.snapshot.excerpt,
    metadata: input.snapshot.metadata,
    sensitive: input.sensitive
  }, { name });
  if (requireSha256(input.snapshot.excerptSha256, `${name}.snapshot.excerptSha256`) !== normalized.snapshot.excerptSha256 ||
      requireSha256(input.snapshotSha256, `${name}.snapshotSha256`) !== normalized.snapshotSha256) {
    throw provenanceError(`${name} snapshot digest is invalid.`, "PROVENANCE_SOURCE_SNAPSHOT_INVALID");
  }
  return normalized;
}

function normalizeLocator(input, kind, name) {
  assertPlainObject(input, name);
  if (kind === "text") {
    assertKnownKeys(input, new Set(["offsetUnit", "startOffset", "endOffset"]), name);
    if (input.offsetUnit !== OFFSET_UNIT) {
      throw provenanceError(`${name}.offsetUnit must be ${OFFSET_UNIT}.`, "PROVENANCE_OFFSET_UNIT_INVALID");
    }
    const startOffset = requireInteger(input.startOffset, `${name}.startOffset`, 0, 10_000_000);
    const endOffset = requireInteger(input.endOffset, `${name}.endOffset`, startOffset + 1, 10_000_000);
    return Object.freeze({ offsetUnit: OFFSET_UNIT, startOffset, endOffset });
  }
  if (kind === "image") {
    assertKnownKeys(input, new Set(["coordinateSpace", "x", "y", "width", "height"]), name);
    if (input.coordinateSpace !== COORDINATE_SPACE) {
      throw provenanceError(`${name}.coordinateSpace must be ${COORDINATE_SPACE}.`, "PROVENANCE_COORDINATE_SPACE_INVALID");
    }
    const x = roundCoordinate(requireFiniteNumber(input.x, `${name}.x`));
    const y = roundCoordinate(requireFiniteNumber(input.y, `${name}.y`));
    const width = roundCoordinate(requireFiniteNumber(input.width, `${name}.width`));
    const height = roundCoordinate(requireFiniteNumber(input.height, `${name}.height`));
    if (x < 0 || y < 0 || x >= 1 || y >= 1 || width <= 0 || height <= 0 || x + width > 1 || y + height > 1) {
      throw provenanceError(`${name} must stay within the canonical image.`, "PROVENANCE_IMAGE_REGION_INVALID");
    }
    return Object.freeze({ coordinateSpace: COORDINATE_SPACE, x, y, width, height });
  }
  if (kind === "audio") {
    assertKnownKeys(input, new Set(["startMs", "endMs"]), name);
    const startMs = requireInteger(input.startMs, `${name}.startMs`, 0, MAX_AUDIO_MS - 1);
    const endMs = requireInteger(input.endMs, `${name}.endMs`, startMs + 1, MAX_AUDIO_MS);
    return Object.freeze({ startMs, endMs });
  }
  throw provenanceError(`${name} has an unsupported locator kind.`, "PROVENANCE_LOCATOR_INVALID");
}

function buildAnchorKey(input = {}) {
  const sourceKind = requireEnum(input.sourceKind, SOURCE_KINDS, "sourceKind");
  const config = SOURCE_CONFIG[sourceKind];
  const sourceKey = requireContentKey(input.sourceKey, config.sourcePrefix, "sourceKey");
  const locator = normalizeLocator(input.locator, config.locatorKind, "locator");
  if (config.inboxAnchor) {
    const excerptSha256 = requireSha256(input.excerptSha256, "excerptSha256");
    return `${config.anchorPrefix}:${sha256(stableStringify({
      sourceKey,
      offsetUnit: locator.offsetUnit,
      startOffset: locator.startOffset,
      endOffset: locator.endOffset,
      excerptSha256
    }))}`;
  }
  const snapshotSha256 = requireSha256(input.snapshotSha256, "snapshotSha256");
  return `${config.anchorPrefix}:${sha256(stableStringify({ sourceKey, locator, snapshotSha256 }))}`;
}

function buildSourceSetSha256(sources) {
  if (!Array.isArray(sources) || sources.length < 1 || sources.length > MAX_SOURCES_PER_CLAIM) {
    throw provenanceError("A claim source set is invalid.", "PROVENANCE_SOURCE_COUNT_INVALID");
  }
  const projection = sources.map((source, position) => ({
    position,
    relationKind: requireEnum(source.relationKind, RELATION_KINDS, `sources[${position}].relationKind`),
    sourceKind: requireEnum(source.sourceKind, SOURCE_KINDS, `sources[${position}].sourceKind`),
    anchorKey: String(source.anchorKey || ""),
    snapshotSha256: requireSha256(source.snapshotSha256, `sources[${position}].snapshotSha256`)
  }));
  if (projection.some((item) => !/^[a-z][a-z0-9-]*:[a-f0-9]{64}$/u.test(item.anchorKey))) {
    throw provenanceError("A source anchor key is invalid.", "PROVENANCE_ANCHOR_KEY_INVALID");
  }
  return sha256(stableStringify(projection));
}

function buildClaimSha256(input = {}) {
  const statement = requireText(input.statement, "statement", MAX_STATEMENT_LENGTH);
  const sourceSetSha256 = requireSha256(input.sourceSetSha256, "sourceSetSha256");
  return sha256(`time-isle-provenance-claim-v1\0${stableStringify({ statement, sourceSetSha256 })}`);
}

function buildEventSha256(input = {}) {
  const claimSha256 = requireSha256(input.claimSha256, "claimSha256");
  const sequence = requireInteger(input.sequence, "sequence", 0, 2);
  const action = requireEnum(input.action, CLAIM_ACTIONS, "action");
  const sourceSetSha256 = requireSha256(input.sourceSetSha256, "sourceSetSha256");
  const previousEventSha256 = sequence === 0
    ? requireEmpty(input.previousEventSha256, "previousEventSha256")
    : requireSha256(input.previousEventSha256, "previousEventSha256");
  const createdAt = requireTimestamp(input.createdAt, "createdAt");
  return sha256(`time-isle-provenance-event-v1\0${stableStringify({
    claimSha256,
    sequence,
    action,
    sourceSetSha256,
    previousEventSha256,
    createdAt
  })}`);
}

function validateClaimAggregate(aggregate = {}) {
  assertPlainObject(aggregate, "aggregate");
  const claim = aggregate.claim;
  if (!claim || typeof claim !== "object" || Array.isArray(claim)) {
    throw provenanceError("Claim aggregate is missing its claim.", "PROVENANCE_CLAIM_INVALID");
  }
  const memoryId = requireId(claim.memoryId, "claim.memoryId");
  const statement = requireText(claim.statement, "claim.statement", MAX_STATEMENT_LENGTH);
  const sources = Array.isArray(aggregate.sources) ? aggregate.sources : [];
  if (sources.length < 1 || sources.length > MAX_SOURCES_PER_CLAIM) {
    throw provenanceError("Claim source count is invalid.", "PROVENANCE_SOURCE_COUNT_INVALID");
  }
  const normalizedSources = sources.map((source, index) => {
    const normalized = validateStoredSourceSnapshot({
      relationKind: source.relationKind,
      sourceKind: source.sourceKind,
      sourceKey: source.sourceKey,
      anchorKey: source.anchorKey,
      originRef: source.originRef,
      locator: source.locator,
      snapshot: source.snapshot,
      snapshotSha256: source.snapshotSha256,
      sensitive: source.sensitive
    }, { name: `sources[${index}]` });
    if (Number(source.position) !== index) {
      throw provenanceError("Claim source positions must be contiguous.", "PROVENANCE_SOURCE_ORDER_INVALID");
    }
    return { ...normalized, id: requireId(source.id, `sources[${index}].id`), claimId: requireId(source.claimId, `sources[${index}].claimId`), position: index, createdAt: requireTimestamp(source.createdAt, `sources[${index}].createdAt`) };
  });
  const sourceSetSha256 = buildSourceSetSha256(normalizedSources);
  if (sourceSetSha256 !== requireSha256(claim.sourceSetSha256, "claim.sourceSetSha256")) {
    throw provenanceError("Claim source-set digest is invalid.", "PROVENANCE_SOURCE_SET_INVALID");
  }
  const claimSha256 = buildClaimSha256({ statement, sourceSetSha256 });
  if (claimSha256 !== requireSha256(claim.claimSha256, "claim.claimSha256")) {
    throw provenanceError("Claim digest is invalid.", "PROVENANCE_CLAIM_HASH_INVALID");
  }
  const claimId = requireId(claim.id, "claim.id");
  if (normalizedSources.some((source) => source.claimId !== claimId)) {
    throw provenanceError("A source belongs to another claim.", "PROVENANCE_SOURCE_REFERENCE_INVALID");
  }
  const events = Array.isArray(aggregate.events) ? aggregate.events : [];
  validateEventChain(events, { claimId, claimSha256, sourceSetSha256, claimCreatedAt: claim.createdAt });
  return Object.freeze({
    claim: Object.freeze({ id: claimId, memoryId, statement, sourceSetSha256, claimSha256, createdAt: requireTimestamp(claim.createdAt, "claim.createdAt") }),
    sources: Object.freeze(normalizedSources.map(Object.freeze)),
    events: Object.freeze(events.map((event) => Object.freeze({ ...event })))
  });
}

function validateEventChain(events, context = {}) {
  if (!Array.isArray(events) || events.length < 1 || events.length > 3) {
    throw provenanceError("A claim must contain one to three ledger events.", "PROVENANCE_EVENT_COUNT_INVALID");
  }
  const allowed = events.length === 1
    ? [["created"]]
    : events.length === 2
      ? [["created", "confirmed"], ["created", "withdrawn"]]
      : [["created", "confirmed", "withdrawn"]];
  const actions = events.map((event) => String(event?.action || ""));
  if (!allowed.some((sequence) => stableStringify(sequence) === stableStringify(actions))) {
    throw provenanceError("Claim ledger transition is invalid.", "PROVENANCE_EVENT_TRANSITION_INVALID");
  }
  let previousHash = "";
  let previousTime = Date.parse(requireTimestamp(context.claimCreatedAt, "claim.createdAt"));
  events.forEach((event, index) => {
    assertPlainObject(event, `events[${index}]`);
    if (requireId(event.claimId, `events[${index}].claimId`) !== context.claimId || Number(event.sequence) !== index) {
      throw provenanceError("Claim event reference or sequence is invalid.", "PROVENANCE_EVENT_ORDER_INVALID");
    }
    const createdAt = requireTimestamp(event.createdAt, `events[${index}].createdAt`);
    if (Date.parse(createdAt) < previousTime) {
      throw provenanceError("Claim event timestamps are not monotonic.", "PROVENANCE_EVENT_TIME_INVALID");
    }
    const expected = buildEventSha256({
      claimSha256: context.claimSha256,
      sequence: index,
      action: event.action,
      sourceSetSha256: context.sourceSetSha256,
      previousEventSha256: previousHash,
      createdAt
    });
    if (requireSha256(event.sourceSetSha256, `events[${index}].sourceSetSha256`) !== context.sourceSetSha256 ||
        String(event.previousEventSha256 || "") !== previousHash ||
        requireSha256(event.eventSha256, `events[${index}].eventSha256`) !== expected) {
      throw provenanceError("Claim event chain is invalid.", "PROVENANCE_EVENT_HASH_INVALID");
    }
    previousHash = expected;
    previousTime = Date.parse(createdAt);
  });
  return true;
}

function deriveClaimState(aggregate = {}, sourceResolver, context = {}) {
  const normalized = validateClaimAggregate(aggregate);
  if (typeof sourceResolver !== "function") throw new TypeError("deriveClaimState requires sourceResolver(source, context).");
  const resolvedSources = normalized.sources.map((source) => {
    const raw = sourceResolver(source, { ...context, memoryId: normalized.claim.memoryId, claimId: normalized.claim.id });
    if (raw && typeof raw.then === "function") throw new TypeError("sourceResolver must be synchronous.");
    const resolution = normalizeResolverResult(raw);
    return Object.freeze({ ...source, integrityStatus: resolution.status, reviewReason: resolution.reason });
  });
  const last = normalized.events.at(-1);
  const confirmed = normalized.events.find((event) => event.action === "confirmed") || null;
  const withdrawn = last.action === "withdrawn";
  const sourcesCurrent = resolvedSources.every((source) => CURRENT_SOURCE_STATUSES.has(source.integrityStatus));
  const lifecycleStatus = withdrawn ? "withdrawn" : confirmed ? "confirmed" : "draft";
  const needsReview = lifecycleStatus === "confirmed" && !sourcesCurrent;
  const status = withdrawn ? "withdrawn" : needsReview ? "needsReview" : lifecycleStatus;
  const headEventSha256 = last.eventSha256;
  const freshnessSha256 = sha256(stableStringify(resolvedSources.map((source) => ({
    anchorKey: source.anchorKey,
    integrityStatus: source.integrityStatus
  }))));
  return Object.freeze({
    ...normalized.claim,
    status,
    lifecycleStatus,
    needsReview,
    sourcesCurrent,
    version: normalized.events.length,
    confirmedAt: confirmed?.createdAt || "",
    withdrawnAt: withdrawn ? last.createdAt : "",
    headEventSha256,
    freshnessSha256,
    etag: provenanceClaimEtag({ claimId: normalized.claim.id, version: normalized.events.length, headEventSha256, freshnessSha256 }),
    sources: Object.freeze(resolvedSources),
    events: normalized.events
  });
}

function buildAgentProjection(claims) {
  if (!Array.isArray(claims)) throw new TypeError("claims must be an array.");
  const byMemory = new Map();
  for (const claim of claims) {
    if (!claim || claim.status !== "confirmed" || claim.needsReview) continue;
    const sources = (Array.isArray(claim.sources) ? claim.sources : [])
      .filter((source) => CURRENT_SOURCE_STATUSES.has(source.integrityStatus) && !source.sensitive)
      .map((source) => ({
        relationKind: source.relationKind,
        sourceKind: source.sourceKind,
        anchorKey: source.anchorKey,
        excerpt: String(source.snapshot?.excerpt || "").slice(0, 240),
        ...(source.sourceKind === "co_memory_response" ? {
          identityAssurance: "self-asserted-unverified",
          identityVerified: false,
          encrypted: true,
          signed: false
        } : {})
      }));
    if (!sources.length) continue;
    const projection = {
      claimSha256: requireSha256(claim.claimSha256, "claim.claimSha256"),
      statement: String(claim.statement || "").slice(0, 500),
      sources: sources.slice(0, MAX_AGENT_SOURCES_PER_CLAIM)
    };
    const memoryId = requireId(claim.memoryId, "claim.memoryId");
    if (!byMemory.has(memoryId)) byMemory.set(memoryId, []);
    byMemory.get(memoryId).push(projection);
  }
  return Object.freeze(Object.fromEntries([...byMemory].map(([memoryId, entries]) => {
    entries.sort((left, right) => left.claimSha256.localeCompare(right.claimSha256, "en"));
    const digestProjection = entries.map((entry) => ({
      claimSha256: entry.claimSha256,
      sources: entry.sources.map((source) => ({ relationKind: source.relationKind, sourceKind: source.sourceKind, anchorKey: source.anchorKey }))
    }));
    return [memoryId, Object.freeze({
      claims: Object.freeze(entries.slice(0, MAX_AGENT_CLAIMS_PER_MEMORY).map(Object.freeze)),
      truncated: entries.length > MAX_AGENT_CLAIMS_PER_MEMORY,
      provenanceSetSha256: sha256(stableStringify(digestProjection))
    })];
  })));
}

function provenanceClaimEtag(input = {}) {
  const claimId = requireId(input.claimId, "claimId");
  const version = requireInteger(input.version, "version", 1, 3);
  const headEventSha256 = requireSha256(input.headEventSha256, "headEventSha256");
  const freshnessSha256 = requireSha256(input.freshnessSha256, "freshnessSha256");
  return `"provenance-${claimId}-v${version}-${sha256(`${headEventSha256}\0${freshnessSha256}`).slice(0, 16)}"`;
}

function normalizeResolverResult(value) {
  if (value === true) return Object.freeze({ status: "source_verified", reason: "" });
  if (value === false || value === null || value === undefined) return Object.freeze({ status: "source_changed", reason: "" });
  if (typeof value === "string") return Object.freeze({ status: requireEnum(value, SOURCE_STATUSES, "source status"), reason: "" });
  assertPlainObject(value, "source resolution");
  assertKnownKeys(value, new Set(["status", "reason"]), "source resolution");
  return Object.freeze({
    status: requireEnum(value.status, SOURCE_STATUSES, "source resolution.status"),
    reason: String(value.reason || "").trim().slice(0, 160)
  });
}

function sourceResolutionIsCurrent(value) {
  return CURRENT_SOURCE_STATUSES.has(normalizeResolverResult(value).status);
}

function normalizeExcerpt(value, required, name, maximum = MAX_EXCERPT_LENGTH) {
  const excerpt = String(value ?? "");
  if ((required && !excerpt.length) || excerpt.length > maximum || hasUnpairedSurrogate(excerpt)) {
    throw provenanceError(`${name} is invalid.`, "PROVENANCE_EXCERPT_INVALID");
  }
  return excerpt;
}

function hasUnpairedSurrogate(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
}

function cloneJsonObject(value, name) {
  assertPlainObject(value, name);
  let serialized;
  try { serialized = JSON.stringify(value); } catch {
    throw provenanceError(`${name} must be JSON serializable.`, "PROVENANCE_JSON_INVALID");
  }
  if (serialized === undefined || Buffer.byteLength(serialized, "utf8") > MAX_JSON_BYTES) {
    throw provenanceError(`${name} exceeds its JSON budget.`, "PROVENANCE_JSON_INVALID");
  }
  const cloned = JSON.parse(serialized);
  if (!isPlainObject(cloned)) throw provenanceError(`${name} must be a JSON object.`, "PROVENANCE_JSON_INVALID");
  return Object.freeze(cloned);
}

function requireJsonBudget(value, name) {
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, "utf8") > MAX_JSON_BYTES) {
    throw provenanceError(`${name} exceeds its JSON budget.`, "PROVENANCE_JSON_INVALID");
  }
}

function requireContentKey(value, prefix, name) {
  const key = String(value || "").trim().toLowerCase();
  const pattern = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:[a-f0-9]{64}$`, "u");
  if (!pattern.test(key)) throw provenanceError(`${name} is invalid.`, "PROVENANCE_CONTENT_KEY_INVALID");
  return key;
}

function requireId(value, name) {
  const id = String(value || "").trim();
  if (!ID_PATTERN.test(id)) throw provenanceError(`${name} is invalid.`, "PROVENANCE_ID_INVALID");
  return id;
}

function requireCatalogReferenceId(value, name) {
  const referenceId = String(value || "").trim();
  if (!/^[a-z][a-z-]{1,20}:(?:[a-zA-Z0-9_-]{1,120}|[a-f0-9]{64})$/u.test(referenceId)) {
    throw provenanceError(`${name} is invalid.`, "PROVENANCE_CATALOG_REFERENCE_INVALID");
  }
  return referenceId;
}

function requireSha256(value, name) {
  const digest = String(value || "").trim().toLowerCase();
  if (!SHA256_PATTERN.test(digest)) throw provenanceError(`${name} must be SHA-256.`, "PROVENANCE_HASH_INVALID");
  return digest;
}

function requireText(value, name, maximum) {
  const text = String(value || "").trim();
  if (!text || text.length > maximum || hasUnpairedSurrogate(text)) {
    throw provenanceError(`${name} is invalid.`, "PROVENANCE_TEXT_INVALID");
  }
  return text;
}

function requireEnum(value, allowed, name) {
  const text = String(value || "").trim();
  const values = allowed instanceof Set ? allowed : new Set(allowed);
  if (!values.has(text)) throw provenanceError(`${name} is invalid.`, "PROVENANCE_ENUM_INVALID");
  return text;
}

function requireInteger(value, name, minimum, maximum) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw provenanceError(`${name} is invalid.`, "PROVENANCE_INTEGER_INVALID");
  }
  return number;
}

function requireFiniteNumber(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw provenanceError(`${name} is invalid.`, "PROVENANCE_NUMBER_INVALID");
  return number;
}

function requireBoolean(value, name) {
  if (typeof value !== "boolean") throw provenanceError(`${name} must be boolean.`, "PROVENANCE_BOOLEAN_INVALID");
  return value;
}

function requireTimestamp(value, name) {
  const timestamp = String(value || "").trim();
  if (!timestamp || Number.isNaN(Date.parse(timestamp))) {
    throw provenanceError(`${name} is invalid.`, "PROVENANCE_TIMESTAMP_INVALID");
  }
  return timestamp.slice(0, 40);
}

function requireEmpty(value, name) {
  if (String(value || "") !== "") throw provenanceError(`${name} must be empty.`, "PROVENANCE_EVENT_HASH_INVALID");
  return "";
}

function assertKnownKeys(value, allowed, name) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) throw provenanceError(`${name} contains unsupported field ${unknown[0]}.`, "PROVENANCE_FIELD_SET_INVALID");
}

function assertPlainObject(value, name) {
  if (!isPlainObject(value)) throw provenanceError(`${name} must be an object.`, "PROVENANCE_OBJECT_INVALID");
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function roundCoordinate(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

function provenanceError(message, code, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

module.exports = {
  CLAIM_ACTIONS,
  COORDINATE_SPACE,
  CURRENT_SOURCE_STATUSES,
  MAX_AGENT_CLAIMS_PER_MEMORY,
  MAX_AGENT_SOURCES_PER_CLAIM,
  MAX_EXCERPT_LENGTH,
  MAX_SOURCES_PER_CLAIM,
  MAX_STATEMENT_LENGTH,
  OFFSET_UNIT,
  PROVENANCE_SCHEMA_VERSION,
  RELATION_KINDS,
  SOURCE_KINDS,
  SOURCE_STATUSES,
  buildAgentProjection,
  buildAnchorKey,
  buildClaimSha256,
  buildEventSha256,
  buildSourceSetSha256,
  catalogSourceToClaimSource,
  deriveClaimState,
  mapCatalogResolutionToResolverResult,
  normalizeClaimDraftInput,
  normalizeResolverResult,
  normalizeVerifiedSourceSnapshot,
  provenanceClaimEtag,
  provenanceError,
  requireId,
  requireSha256,
  requireTimestamp,
  sha256,
  sourceResolutionIsCurrent,
  stableStringify,
  validateClaimAggregate,
  validateEventChain,
  validateStoredSourceSnapshot
};
