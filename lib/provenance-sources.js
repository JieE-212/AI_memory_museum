"use strict";

const {
  ANCHOR_KEY_PATTERN,
  OFFSET_UNIT,
  SOURCE_KEY_PATTERN,
  buildAnchorKey,
  sha256Utf8,
  stableStringify
} = require("./memory-inbox-service");

const PROVENANCE_SOURCE_SCHEMA_VERSION = 1;
const PROVENANCE_SOURCE_KINDS = Object.freeze([
  "memory_text",
  "document_excerpt",
  "image_region",
  "voice_segment",
  "oral_history_excerpt",
  "co_memory_response"
]);
const KIND_SET = new Set(PROVENANCE_SOURCE_KINDS);
const ID_PATTERN = /^[a-zA-Z0-9_-]{1,120}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const MAX_TEXT_RANGE = 4000;
const MAX_VOICE_DURATION_MS = 3 * 60 * 1000;

function createProvenanceSourceCatalog(options = {}) {
  const store = options.store || {};
  const getMemory = requireReader(options.getMemory || store.getMemory, store, "getMemory");
  const readers = Object.freeze({
    getInboxReceipt: optionalReader(store, ["getMemoryInboxReceiptForMemory"]),
    listMedia: optionalReader(store, ["listMediaForMemory"]),
    listObservations: optionalReader(store, ["listMediaObservations", "listMediaObservation"]),
    listVoices: optionalReader(store, ["listVoiceForMemory"]),
    listOralHistory: optionalReader(store, ["listConfirmedOralHistoryEvidence"]),
    listCoMemory: optionalReader(store, ["listCoMemoryResponseSources"])
  });

  function listSources(memoryId) {
    const id = requireId(memoryId, "memoryId");
    const memory = synchronous(getMemory(id), "getMemory");
    if (!memory) return [];
    const sources = [];
    const memoryText = buildMemoryTextCandidate(id, memory);
    if (memoryText) sources.push(memoryText);
    const document = readDocumentRecord(id, readers.getInboxReceipt);
    if (document?.available) sources.push(document.candidate);
    sources.push(...readImageRecords(id, readers).filter((record) => record.available).map((record) => record.candidate));
    sources.push(...readVoiceRecords(id, readers.listVoices).filter((record) => record.available).map((record) => record.candidate));
    sources.push(...readOralHistoryRecords(id, readers.listOralHistory).map((record) => record.candidate));
    sources.push(...readCoMemoryRecords(id, readers.listCoMemory).map((record) => record.candidate));
    return dedupeAndSort(sources);
  }

  function resolveSource(memoryId, selection = {}) {
    const id = requireId(memoryId, "memoryId");
    const normalized = normalizeSelection(selection);
    const memory = synchronous(getMemory(id), "getMemory");
    if (!memory) return resolution("missing", normalized);

    if (normalized.kind === "memory_text") {
      assertReference(normalized.referenceId, memoryReferenceId(id));
      const current = buildMemoryTextCandidate(id, memory);
      if (!current) return resolution("missing", normalized);
      if (sourceChanged(current, normalized, { compareAnchor: false })) return resolution("source_changed", normalized, current);
      const startOffset = requireInteger(normalized.startOffset, "startOffset", 0, current.locator.length);
      const endOffset = requireInteger(normalized.endOffset, "endOffset", 1, current.locator.length);
      if (endOffset <= startOffset || endOffset - startOffset > MAX_TEXT_RANGE) throw rangeError("The memory text range is invalid.");
      const excerpt = String(memory.rawContent || "").slice(startOffset, endOffset);
      if (!excerpt.trim()) throw rangeError("The memory text range contains only whitespace.");
      const anchorKey = provenanceKey("memory-range", {
        sourceKey: current.sourceKey,
        offsetUnit: OFFSET_UNIT,
        startOffset,
        endOffset,
        excerptSha256: sha256Utf8(excerpt)
      });
      return resolution("resolved", normalized, createSnapshot({
        ...current,
        anchorKey,
        locator: { offsetUnit: OFFSET_UNIT, startOffset, endOffset },
        excerpt
      }));
    }

    if (normalized.kind === "document_excerpt") {
      const record = readDocumentRecord(id, readers.getInboxReceipt);
      if (!record) return resolution("missing", normalized);
      assertReference(normalized.referenceId, record.referenceId);
      if (!record.available || sourceChanged(record.candidate, normalized)) {
        return resolution("source_changed", normalized, record.candidate || null);
      }
      return resolution("resolved", normalized, record.candidate);
    }

    if (normalized.kind === "image_region") {
      const records = readImageRecords(id, readers);
      const record = records.find((entry) => entry.referenceId === normalized.referenceId);
      if (!record) return resolution("missing", normalized);
      if (!record.available || sourceChanged(record.candidate, normalized)) {
        return resolution("source_changed", normalized, record.candidate || null);
      }
      return resolution("resolved", normalized, record.candidate);
    }

    if (normalized.kind === "voice_segment") {
      const records = readVoiceRecords(id, readers.listVoices);
      const record = records.find((entry) => entry.referenceId === normalized.referenceId);
      if (!record) return resolution("missing", normalized);
      if (!record.available || sourceChanged(record.candidate, normalized, { compareAnchor: false })) {
        return resolution("source_changed", normalized, record.candidate || null);
      }
      const startMs = requireInteger(normalized.startMs, "startMs", 0, record.candidate.locator.durationMs - 1);
      const endMs = requireInteger(normalized.endMs, "endMs", 1, record.candidate.locator.durationMs);
      if (endMs <= startMs) throw rangeError("The voice segment range is invalid.");
      const anchorKey = provenanceKey("voice-segment", {
        sourceKey: record.candidate.sourceKey,
        startMs,
        endMs
      });
      return resolution("resolved", normalized, createSnapshot({
        ...record.candidate,
        anchorKey,
        locator: { startMs, endMs, durationMs: record.candidate.locator.durationMs },
        excerpt: ""
      }));
    }

    if (normalized.kind === "co_memory_response") {
      const records = readCoMemoryRecords(id, readers.listCoMemory);
      const record = records.find((entry) => entry.referenceId === normalized.referenceId);
      if (!record) return resolution("missing", normalized);
      if (sourceChanged(record.candidate, normalized)) return resolution("source_changed", normalized, record.candidate);
      return resolution("resolved", normalized, record.candidate);
    }

    const records = readOralHistoryRecords(id, readers.listOralHistory);
    const record = records.find((entry) => entry.referenceId === normalized.referenceId);
    if (!record) return resolution("missing", normalized);
    if (sourceChanged(record.candidate, normalized)) return resolution("source_changed", normalized, record.candidate);
    return resolution("resolved", normalized, record.candidate);
  }

  return Object.freeze({ listSources, resolveSource });
}

function buildMemoryTextCandidate(memoryId, memory) {
  const text = typeof memory?.rawContent === "string" ? memory.rawContent : "";
  if (!text) return null;
  const contentSha256 = sha256Utf8(text);
  const sourceKey = provenanceKey("memory-text", { memoryId, contentSha256 });
  return createSnapshot({
    kind: "memory_text",
    memoryId,
    referenceId: memoryReferenceId(memoryId),
    sourceKey,
    anchorKey: "",
    label: String(memory.title || "Original memory text").trim().slice(0, 120) || "Original memory text",
    locator: { offsetUnit: OFFSET_UNIT, length: text.length },
    excerpt: "",
    contentSha256,
    confirmation: "user_recorded"
  });
}

function readDocumentRecord(memoryId, reader) {
  if (!reader) return null;
  const receipt = synchronous(reader(memoryId), "getMemoryInboxReceiptForMemory");
  if (!isPlainObject(receipt) || !isPlainObject(receipt.item) || !isPlainObject(receipt.source)) return null;
  const item = receipt.item;
  const source = receipt.source;
  const referenceId = documentReferenceId(item.id);
  const structurallyValid = item.status === "accepted" && item.memoryId === memoryId &&
    SOURCE_KEY_PATTERN.test(String(source.sourceKey || "")) && ANCHOR_KEY_PATTERN.test(String(item.anchorKey || "")) &&
    source.sourceKey === `text-source:${source.rawSha256}` && source.offsetUnit === OFFSET_UNIT &&
    item.offsetUnit === OFFSET_UNIT && Number.isSafeInteger(item.startOffset) && Number.isSafeInteger(item.endOffset) &&
    item.startOffset >= 0 && item.endOffset > item.startOffset && item.endOffset <= Number(source.decodedLength) &&
    typeof item.excerpt === "string" && item.excerpt.length === item.endOffset - item.startOffset &&
    SHA256_PATTERN.test(String(item.excerptSha256 || "")) && sha256Utf8(item.excerpt) === item.excerptSha256 &&
    item.anchorKey === buildAnchorKey({
      sourceKey: source.sourceKey,
      offsetUnit: OFFSET_UNIT,
      startOffset: item.startOffset,
      endOffset: item.endOffset,
      excerptSha256: item.excerptSha256
    });
  const candidate = createSnapshot({
    kind: "document_excerpt",
    memoryId,
    referenceId,
    sourceKey: String(source.sourceKey || provenanceKey("invalid-document", { referenceId })),
    anchorKey: String(item.anchorKey || ""),
    label: String(source.displayName || "Imported text excerpt").trim().slice(0, 120) || "Imported text excerpt",
    locator: {
      offsetUnit: OFFSET_UNIT,
      startOffset: safeInteger(item.startOffset),
      endOffset: safeInteger(item.endOffset),
      startLine: safeInteger(item.startLine),
      endLine: safeInteger(item.endLine)
    },
    excerpt: typeof item.excerpt === "string" ? item.excerpt : "",
    contentSha256: SHA256_PATTERN.test(String(source.rawSha256 || "")) ? source.rawSha256 : "0".repeat(64),
    confirmation: "user_admitted"
  }, { tolerateInvalidKeys: true });
  return { referenceId, available: structurallyValid, candidate };
}

function readImageRecords(memoryId, readers) {
  if (!readers.listMedia || !readers.listObservations) return [];
  const links = optionalArray(synchronous(readers.listMedia(memoryId), "listMediaForMemory"));
  const records = [];
  for (const link of links) {
    const asset = link?.asset;
    const assetId = String(link?.assetId || asset?.id || "");
    if (!ID_PATTERN.test(assetId)) continue;
    const observations = optionalArray(synchronous(readers.listObservations({
      assetId,
      kind: "image_region",
      status: "confirmed",
      limit: 1000
    }), "listMediaObservations"));
    for (const observation of observations) {
      if (!ID_PATTERN.test(String(observation?.id || "")) || observation?.kind !== "image_region" ||
          observation?.status !== "confirmed" || observation?.source !== "user" ||
          observation?.metadata?.memoryId && observation.metadata.memoryId !== memoryId) continue;
      const value = isPlainObject(observation.value) ? observation.value : {};
      const locator = normalizeImageLocator(value.locator);
      const contentSha256 = String(asset?.contentSha256 || "");
      const referenceId = imageReferenceId(observation.id);
      const sourceKey = SHA256_PATTERN.test(contentSha256)
        ? provenanceKey("image-source", { memoryId, assetId, contentSha256 })
        : provenanceKey("invalid-image", { memoryId, assetId });
      const anchorKey = provenanceKey("image-region", {
        sourceKey,
        observationId: observation.id,
        locator,
        label: String(value.label || "")
      });
      const available = Boolean(asset?.status === "ready" && SHA256_PATTERN.test(contentSha256) && locator &&
        value.sourceHash === `sha256:${contentSha256}` && value.semanticStatus === "user_confirmed");
      records.push({
        referenceId,
        available,
        candidate: createSnapshot({
          kind: "image_region",
          memoryId,
          referenceId,
          sourceKey,
          anchorKey,
          label: String(value.label || link?.caption || "Confirmed image region").trim().slice(0, 120) || "Confirmed image region",
          locator: locator || { coordinateSpace: "invalid", x: 0, y: 0, width: 0, height: 0 },
          excerpt: "",
          contentSha256: SHA256_PATTERN.test(contentSha256) ? contentSha256 : "0".repeat(64),
          confirmation: "user_confirmed"
        })
      });
    }
  }
  return records.sort(compareRecords);
}

function readVoiceRecords(memoryId, reader) {
  if (!reader) return [];
  const links = optionalArray(synchronous(reader(memoryId), "listVoiceForMemory"));
  return links.flatMap((link) => {
    const asset = link?.asset;
    const assetId = String(link?.assetId || asset?.id || "");
    if (!ID_PATTERN.test(assetId)) return [];
    const referenceId = voiceReferenceId(assetId);
    const contentSha256 = String(asset?.contentSha256 || "");
    const durationMs = safeInteger(asset?.durationMs);
    const sourceKey = SHA256_PATTERN.test(contentSha256)
      ? provenanceKey("voice-source", { memoryId, assetId, contentSha256 })
      : provenanceKey("invalid-voice", { memoryId, assetId });
    const available = asset?.status === "ready" && SHA256_PATTERN.test(contentSha256) &&
      durationMs >= 1 && durationMs <= MAX_VOICE_DURATION_MS;
    return [{
      referenceId,
      available,
      candidate: createSnapshot({
        kind: "voice_segment",
        memoryId,
        referenceId,
        sourceKey,
        anchorKey: "",
        label: String(link?.label || asset?.originalName || "Voice recording").trim().slice(0, 120) || "Voice recording",
        locator: { durationMs },
        excerpt: "",
        contentSha256: SHA256_PATTERN.test(contentSha256) ? contentSha256 : "0".repeat(64),
        confirmation: "user_selected"
      })
    }];
  }).sort(compareRecords);
}

function readOralHistoryRecords(memoryId, reader) {
  if (!reader) return [];
  const evidence = optionalArray(synchronous(reader([memoryId]), "listConfirmedOralHistoryEvidence"));
  return evidence.flatMap((entry) => {
    const eventId = String(entry?.eventId || "");
    const questionKey = String(entry?.questionKey || "");
    const sourceKey = String(entry?.sourceKey || "");
    const contentSha256 = String(entry?.assetContentSha256 || "");
    const transcriptSha256 = String(entry?.transcriptSha256 || "");
    const startMs = safeInteger(entry?.segmentStartMs);
    const endMs = safeInteger(entry?.segmentEndMs);
    if (!ID_PATTERN.test(eventId) || !questionKey || !isProvenanceKey(sourceKey) || !SHA256_PATTERN.test(contentSha256) ||
        !SHA256_PATTERN.test(transcriptSha256) || startMs < 0 || endMs <= startMs || endMs > MAX_VOICE_DURATION_MS) return [];
    const referenceId = oralHistoryReferenceId(eventId, questionKey);
    const anchorKey = provenanceKey("oral-history", { sourceKey, eventId, questionKey, startMs, endMs, transcriptSha256 });
    return [{
      referenceId,
      candidate: createSnapshot({
        kind: "oral_history_excerpt",
        memoryId,
        referenceId,
        sourceKey,
        anchorKey,
        label: "Confirmed oral-history excerpt",
        locator: { eventId, questionKey, startMs, endMs },
        excerpt: String(entry.transcriptExcerpt || "").slice(0, 180),
        contentSha256,
        confirmation: "user_confirmed"
      })
    }];
  }).sort(compareRecords);
}

function readCoMemoryRecords(memoryId, reader) {
  if (!reader) return [];
  const sources = optionalArray(synchronous(reader(memoryId), "listCoMemoryResponseSources"));
  return sources.flatMap((source) => {
    const rawReferenceId = String(source?.referenceId || "");
    const responseId = String(source?.locator?.responseId || "");
    const excerpt = typeof source?.excerpt === "string" ? source.excerpt : "";
    if (!ID_PATTERN.test(rawReferenceId) || !ID_PATTERN.test(responseId) || !excerpt.length || excerpt.length > 8000 ||
        !isProvenanceKey(source?.sourceKey) || !isProvenanceKey(source?.anchorKey) ||
        !SHA256_PATTERN.test(String(source?.contentSha256 || "")) || source?.confirmation !== "user_confirmed_unverified") return [];
    const referenceId = `co-memory:${rawReferenceId}`;
    return [{
      referenceId,
      candidate: createSnapshot({
        kind: "co_memory_response",
        memoryId,
        referenceId,
        sourceKey: source.sourceKey,
        anchorKey: source.anchorKey,
        label: String(source.label || "Unverified co-memory response").trim().slice(0, 120) || "Unverified co-memory response",
        locator: { responseId, answerLength: excerpt.length },
        excerpt,
        contentSha256: source.contentSha256,
        confirmation: "user_confirmed_unverified"
      })
    }];
  }).sort(compareRecords);
}

function createSnapshot(input, options = {}) {
  const kind = requireKind(input.kind);
  const snapshot = {
    schemaVersion: PROVENANCE_SOURCE_SCHEMA_VERSION,
    kind,
    memoryId: requireId(input.memoryId, "snapshot.memoryId"),
    referenceId: requireReferenceId(input.referenceId),
    sourceKey: requireSourceKey(input.sourceKey, options.tolerateInvalidKeys),
    anchorKey: requireAnchorKey(input.anchorKey, kind, options.tolerateInvalidKeys),
    label: String(input.label || "Source").trim().slice(0, 120) || "Source",
    locator: clonePlainObject(input.locator),
    excerpt: typeof input.excerpt === "string" ? input.excerpt : "",
    contentSha256: requireContentHash(input.contentSha256),
    confirmation: requireConfirmation(input.confirmation)
  };
  snapshot.snapshotSha256 = buildSnapshotSha256(snapshot);
  return deepFreeze(snapshot);
}

function buildSnapshotSha256(snapshot) {
  return sha256Utf8(stableStringify(snapshotCore(snapshot)));
}

function snapshotCore(snapshot) {
  return {
    schemaVersion: PROVENANCE_SOURCE_SCHEMA_VERSION,
    kind: snapshot.kind,
    memoryId: snapshot.memoryId,
    referenceId: snapshot.referenceId,
    sourceKey: snapshot.sourceKey,
    anchorKey: snapshot.anchorKey,
    locator: snapshot.locator,
    excerpt: snapshot.excerpt,
    contentSha256: snapshot.contentSha256,
    confirmation: snapshot.confirmation
  };
}

function normalizeSelection(selection) {
  if (!isPlainObject(selection)) throw provenanceError("Selection must be an object.", "PROVENANCE_SELECTION_INVALID");
  const kind = requireKind(selection.kind);
  const base = new Set(["kind", "referenceId", "snapshotSha256", "sourceKey"]);
  const allowed = kind === "memory_text" ? new Set([...base, "endOffset", "startOffset"])
    : kind === "voice_segment" ? new Set([...base, "endMs", "startMs"])
      : new Set([...base, "anchorKey"]);
  const unknown = Object.keys(selection).filter((key) => !allowed.has(key));
  if (unknown.length) throw provenanceError(`Selection contains unsupported field(s): ${unknown.join(", ")}.`, "PROVENANCE_FIELD_SET_INVALID");
  const normalized = {
    kind,
    referenceId: requireReferenceId(selection.referenceId),
    sourceKey: requireSelectionKey(selection.sourceKey, "sourceKey"),
    snapshotSha256: selection.snapshotSha256 === undefined ? "" : requireHash(selection.snapshotSha256, "snapshotSha256")
  };
  if (kind === "memory_text") {
    normalized.startOffset = selection.startOffset;
    normalized.endOffset = selection.endOffset;
  } else if (kind === "voice_segment") {
    normalized.startMs = selection.startMs;
    normalized.endMs = selection.endMs;
  } else {
    normalized.anchorKey = requireSelectionKey(selection.anchorKey, "anchorKey");
  }
  return normalized;
}

function sourceChanged(current, selection, options = {}) {
  if (!current || current.sourceKey !== selection.sourceKey) return true;
  if (options.compareAnchor !== false && current.anchorKey !== selection.anchorKey) return true;
  return Boolean(selection.snapshotSha256 && current.snapshotSha256 !== selection.snapshotSha256);
}

function resolution(status, selection, source = null) {
  return Object.freeze({
    status,
    kind: selection.kind,
    referenceId: selection.referenceId,
    sourceKey: selection.sourceKey,
    ...(source ? { source } : {})
  });
}

function normalizeImageLocator(value) {
  if (!isPlainObject(value) || value.coordinateSpace !== "canonical-preview-v1") return null;
  const x = Number(value.x);
  const y = Number(value.y);
  const width = Number(value.width);
  const height = Number(value.height);
  if (![x, y, width, height].every(Number.isFinite) || x < 0 || y < 0 || width <= 0 || height <= 0 ||
      x + width > 1 + Number.EPSILON || y + height > 1 + Number.EPSILON) return null;
  return { coordinateSpace: value.coordinateSpace, x, y, width, height };
}

function provenanceKey(prefix, value) {
  return `${prefix}:${sha256Utf8(stableStringify(value))}`;
}

function memoryReferenceId(memoryId) { return `memory:${memoryId}`; }
function documentReferenceId(itemId) { return `document:${requireId(itemId, "itemId")}`; }
function imageReferenceId(observationId) { return `image:${requireId(observationId, "observationId")}`; }
function voiceReferenceId(assetId) { return `voice:${requireId(assetId, "assetId")}`; }
function oralHistoryReferenceId(eventId, questionKey) {
  return provenanceKey("oral", { eventId, questionKey });
}

function assertReference(actual, expected) {
  if (actual !== expected) throw provenanceError("Selection reference does not belong to this source.", "PROVENANCE_REFERENCE_INVALID");
}

function requireKind(value) {
  const kind = String(value || "");
  if (!KIND_SET.has(kind)) throw provenanceError("Source kind is invalid.", "PROVENANCE_KIND_INVALID");
  return kind;
}

function requireId(value, name) {
  const id = String(value || "");
  if (!ID_PATTERN.test(id)) throw provenanceError(`${name} is invalid.`, "PROVENANCE_ID_INVALID");
  return id;
}

function requireReferenceId(value) {
  const referenceId = String(value || "");
  if (!/^[a-z][a-z-]{1,20}:[a-zA-Z0-9_-]{1,120}$/u.test(referenceId) &&
      !/^[a-z][a-z-]{1,20}:[a-f0-9]{64}$/u.test(referenceId)) {
    throw provenanceError("referenceId is invalid.", "PROVENANCE_REFERENCE_INVALID");
  }
  return referenceId;
}

function requireSourceKey(value, tolerateInvalid) {
  const key = String(value || "");
  if (!isProvenanceKey(key)) {
    if (tolerateInvalid) return provenanceKey("invalid-source", { key });
    throw provenanceError("sourceKey is invalid.", "PROVENANCE_SOURCE_KEY_INVALID");
  }
  return key;
}

function requireAnchorKey(value, kind, tolerateInvalid) {
  const key = String(value || "");
  if (!key && ["memory_text", "voice_segment"].includes(kind)) return "";
  if (!/^[a-z][a-z-]{1,30}:[a-f0-9]{64}$/u.test(key)) {
    if (tolerateInvalid) return provenanceKey("invalid-anchor", { key });
    throw provenanceError("anchorKey is invalid.", "PROVENANCE_ANCHOR_KEY_INVALID");
  }
  return key;
}

function requireSelectionKey(value, name) {
  const key = String(value || "");
  if (!isProvenanceKey(key)) {
    throw provenanceError(`${name} is invalid.`, "PROVENANCE_SELECTION_INVALID");
  }
  return key;
}

function isProvenanceKey(value) {
  return /^[a-z][a-z-]{1,30}:[a-f0-9]{64}$/u.test(String(value || ""));
}

function requireContentHash(value) {
  return requireHash(value, "contentSha256");
}

function requireHash(value, name) {
  const hash = String(value || "");
  if (!SHA256_PATTERN.test(hash)) throw provenanceError(`${name} is invalid.`, "PROVENANCE_HASH_INVALID");
  return hash;
}

function requireConfirmation(value) {
  const confirmation = String(value || "");
  if (!new Set(["user_recorded", "user_admitted", "user_confirmed", "user_selected", "user_confirmed_unverified"]).has(confirmation)) {
    throw provenanceError("Source confirmation boundary is invalid.", "PROVENANCE_CONFIRMATION_INVALID");
  }
  return confirmation;
}

function requireInteger(value, name, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw rangeError(`${name} is outside the source boundary.`);
  return value;
}

function safeInteger(value) {
  return Number.isSafeInteger(Number(value)) ? Number(value) : 0;
}

function requireReader(value, receiver, name) {
  if (typeof value !== "function") throw new TypeError(`${name} reader is required.`);
  return receiver && value === receiver[name] ? value.bind(receiver) : value;
}

function optionalReader(store, names) {
  for (const name of names) if (typeof store?.[name] === "function") return store[name].bind(store);
  return null;
}

function synchronous(value, name) {
  if (value && typeof value.then === "function") throw new TypeError(`${name} must return synchronously.`);
  return value;
}

function optionalArray(value) {
  return Array.isArray(value) ? value : [];
}

function dedupeAndSort(sources) {
  const byIdentity = new Map();
  for (const source of sources) byIdentity.set(`${source.kind}\u0000${source.referenceId}`, source);
  const order = new Map(PROVENANCE_SOURCE_KINDS.map((kind, index) => [kind, index]));
  return [...byIdentity.values()].sort((left, right) =>
    (order.get(left.kind) - order.get(right.kind)) || left.referenceId.localeCompare(right.referenceId, "en"));
}

function compareRecords(left, right) {
  return left.referenceId.localeCompare(right.referenceId, "en");
}

function clonePlainObject(value) {
  if (!isPlainObject(value)) throw provenanceError("Source locator must be an object.", "PROVENANCE_LOCATOR_INVALID");
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function rangeError(message) {
  return provenanceError(message, "PROVENANCE_RANGE_INVALID");
}

function provenanceError(message, code) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = 400;
  return error;
}

module.exports = {
  MAX_TEXT_RANGE,
  PROVENANCE_SOURCE_KINDS,
  PROVENANCE_SOURCE_SCHEMA_VERSION,
  buildSnapshotSha256,
  createProvenanceSourceCatalog,
  createSnapshot,
  provenanceKey
};
