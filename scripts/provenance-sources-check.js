"use strict";

const assert = require("node:assert/strict");
const {
  PROVENANCE_SOURCE_KINDS,
  PROVENANCE_SOURCE_SCHEMA_VERSION,
  buildSnapshotSha256,
  createProvenanceSourceCatalog,
  createSnapshot,
  provenanceKey
} = require("../lib/provenance-sources");
const {
  OFFSET_UNIT,
  sha256Utf8,
  verifyMemoryInboxSelection
} = require("../lib/memory-inbox-service");

let assertions = 0;
const ok = (value, message) => { assertions += 1; assert.ok(value, message); };
const equal = (actual, expected, message) => { assertions += 1; assert.equal(actual, expected, message); };
const deepEqual = (actual, expected, message) => { assertions += 1; assert.deepEqual(actual, expected, message); };
const throwsCode = (operation, code, message) => {
  assertions += 1;
  assert.throws(operation, (error) => error?.code === code, message);
};

run();

function run() {
  checkUnifiedCatalog();
  checkMemoryTextResolution();
  checkDocumentResolution();
  checkImageResolution();
  checkVoiceResolution();
  checkOralHistoryResolution();
  checkCoMemoryResponseResolution();
  checkOptionalReadersAndValidation();
  console.log(`Provenance source checks passed: ${assertions} assertions.`);
}

function checkUnifiedCatalog() {
  equal(PROVENANCE_SOURCE_SCHEMA_VERSION, 1, "source catalog contract starts at version one");
  deepEqual(PROVENANCE_SOURCE_KINDS, [
    "memory_text", "document_excerpt", "image_region", "voice_segment", "oral_history_excerpt", "co_memory_response"
  ], "catalog exposes six bounded source kinds only");
  const fixture = createFixture();
  const catalog = createProvenanceSourceCatalog({ store: fixture.store });
  const sources = catalog.listSources("memory-1");
  deepEqual(sources.map((source) => source.kind), PROVENANCE_SOURCE_KINDS, "source list follows one stable task-oriented order");
  equal(new Set(sources.map((source) => source.referenceId)).size, sources.length, "source references are unique within a memory");
  for (const source of sources) {
    equal(source.schemaVersion, 1, `${source.kind} declares the catalog schema`);
    equal(source.memoryId, "memory-1", `${source.kind} remains scoped to one memory`);
    equal(source.snapshotSha256, buildSnapshotSha256(source), `${source.kind} snapshot hash is reproducible`);
    ok(Object.isFrozen(source) && Object.isFrozen(source.locator), `${source.kind} snapshot is immutable to callers`);
    ok(!containsForbiddenInferenceKey(source), `${source.kind} exposes no inferred people/date/relation/emotion/speaker fields`);
  }
  equal(sources.find((source) => source.kind === "document_excerpt").sourceKey, fixture.receipt.source.sourceKey,
    "document source reuses the V11 sourceKey exactly");
  equal(sources.find((source) => source.kind === "document_excerpt").anchorKey, fixture.receipt.item.anchorKey,
    "document source reuses the V11 anchorKey exactly");
  equal(sources.find((source) => source.kind === "memory_text").anchorKey, "", "memory text waits for an explicit range");
  equal(sources.find((source) => source.kind === "voice_segment").anchorKey, "", "voice waits for an explicit millisecond range");

  const memorySource = sources.find((source) => source.kind === "memory_text");
  const relabeled = createSnapshot({ ...memorySource, label: "A presentation-only rename" });
  equal(relabeled.snapshotSha256, memorySource.snapshotSha256, "presentation labels do not invalidate evidence snapshots");
  const changedContent = createSnapshot({ ...memorySource, contentSha256: "f".repeat(64) });
  ok(changedContent.snapshotSha256 !== memorySource.snapshotSha256, "content hash changes invalidate evidence snapshots");
}

function checkMemoryTextResolution() {
  const fixture = createFixture();
  const catalog = createProvenanceSourceCatalog({ store: fixture.store });
  const source = catalog.listSources("memory-1").find((item) => item.kind === "memory_text");
  const startOffset = fixture.state.memory.rawContent.indexOf("emoji");
  const endOffset = fixture.state.memory.rawContent.indexOf(" and inert");
  const selection = {
    kind: source.kind,
    referenceId: source.referenceId,
    sourceKey: source.sourceKey,
    snapshotSha256: source.snapshotSha256,
    startOffset,
    endOffset
  };
  const resolved = catalog.resolveSource("memory-1", selection);
  equal(resolved.status, "resolved", "current memory text resolves successfully");
  equal(resolved.source.excerpt, "emoji 😀", "UTF-16 selection preserves an astral emoji exactly");
  deepEqual(resolved.source.locator, { offsetUnit: OFFSET_UNIT, startOffset, endOffset }, "resolved text records the explicit UTF-16 range");
  ok(resolved.source.anchorKey.startsWith("memory-range:"), "resolved text receives a deterministic range anchor");
  equal(resolved.source.snapshotSha256, buildSnapshotSha256(resolved.source), "resolved range snapshot is reproducible");
  ok(resolved.source.excerpt.includes("😀"), "range slicing does not split the selected emoji");

  throwsCode(() => catalog.resolveSource("memory-1", { ...selection, startOffset: -1 }),
    "PROVENANCE_RANGE_INVALID", "negative memory offsets are rejected");
  throwsCode(() => catalog.resolveSource("memory-1", { ...selection, endOffset: fixture.state.memory.rawContent.length + 1 }),
    "PROVENANCE_RANGE_INVALID", "memory range cannot exceed current source length");
  throwsCode(() => catalog.resolveSource("memory-1", { ...selection, startOffset: 0, endOffset: 0 }),
    "PROVENANCE_RANGE_INVALID", "empty memory range is rejected");

  fixture.state.memory.rawContent += " changed";
  const changed = catalog.resolveSource("memory-1", selection);
  equal(changed.status, "source_changed", "memory edits invalidate a previously listed source");
  ok(changed.source.sourceKey !== source.sourceKey, "source_changed returns the current source without substituting it");
  fixture.state.memory = null;
  equal(catalog.resolveSource("memory-1", selection).status, "missing", "deleted memory resolves as missing");
}

function checkDocumentResolution() {
  const fixture = createFixture();
  const catalog = createProvenanceSourceCatalog({ store: fixture.store });
  const source = catalog.listSources("memory-1").find((item) => item.kind === "document_excerpt");
  const selection = staticSelection(source);
  const resolved = catalog.resolveSource("memory-1", selection);
  equal(resolved.status, "resolved", "accepted document excerpt resolves from its receipt");
  equal(resolved.source.excerpt, fixture.receipt.item.excerpt, "document resolution returns the immutable admitted excerpt");
  equal(resolved.source.sourceKey, fixture.receipt.source.sourceKey, "document resolution preserves sourceKey");
  equal(resolved.source.anchorKey, fixture.receipt.item.anchorKey, "document resolution preserves anchorKey");

  fixture.receipt.item = { ...fixture.receipt.item, excerpt: `${fixture.receipt.item.excerpt}!` };
  equal(catalog.resolveSource("memory-1", selection).status, "source_changed", "tampered receipt resolves as source_changed");
  ok(!catalog.listSources("memory-1").some((item) => item.kind === "document_excerpt"), "invalid receipt is not offered for new selection");
  fixture.state.receipt = null;
  equal(catalog.resolveSource("memory-1", selection).status, "missing", "removed receipt resolves as missing");
}

function checkImageResolution() {
  const fixture = createFixture();
  const catalog = createProvenanceSourceCatalog({ store: fixture.store });
  const source = catalog.listSources("memory-1").find((item) => item.kind === "image_region");
  const selection = staticSelection(source);
  const resolved = catalog.resolveSource("memory-1", selection);
  equal(resolved.status, "resolved", "confirmed user image region resolves successfully");
  deepEqual(resolved.source.locator, fixture.state.observations[0].value.locator, "image locator stays in canonical normalized coordinates");
  equal(resolved.source.confirmation, "user_confirmed", "image region keeps explicit confirmation boundary");
  ok(!catalog.listSources("memory-1").some((item) => item.label === "Model suggestion"), "model observations are never offered as confirmed sources");

  fixture.state.media[0].asset.contentSha256 = "b".repeat(64);
  equal(catalog.resolveSource("memory-1", selection).status, "source_changed", "image byte hash change invalidates a listed region");
  ok(!catalog.listSources("memory-1").some((item) => item.kind === "image_region"), "stale image region is not offered for new selection");
  fixture.state.observations = [];
  equal(catalog.resolveSource("memory-1", selection).status, "missing", "removed image observation resolves as missing");
}

function checkVoiceResolution() {
  const fixture = createFixture();
  const catalog = createProvenanceSourceCatalog({ store: fixture.store });
  const source = catalog.listSources("memory-1").find((item) => item.kind === "voice_segment");
  const selection = {
    kind: source.kind,
    referenceId: source.referenceId,
    sourceKey: source.sourceKey,
    snapshotSha256: source.snapshotSha256,
    startMs: 1200,
    endMs: 4200
  };
  const resolved = catalog.resolveSource("memory-1", selection);
  equal(resolved.status, "resolved", "ready voice asset resolves an explicit user segment");
  deepEqual(resolved.source.locator, { startMs: 1200, endMs: 4200, durationMs: 12000 }, "voice locator preserves exact milliseconds and source duration");
  ok(resolved.source.anchorKey.startsWith("voice-segment:"), "voice range receives a deterministic segment anchor");
  equal(resolved.source.excerpt, "", "voice source never invents a transcript");

  throwsCode(() => catalog.resolveSource("memory-1", { ...selection, endMs: 12001 }),
    "PROVENANCE_RANGE_INVALID", "voice segment cannot exceed ready asset duration");
  throwsCode(() => catalog.resolveSource("memory-1", { ...selection, startMs: 4200, endMs: 4200 }),
    "PROVENANCE_RANGE_INVALID", "empty voice segment is rejected");
  fixture.state.voices[0].asset.status = "staging";
  equal(catalog.resolveSource("memory-1", selection).status, "source_changed", "non-ready voice asset invalidates the listed source");
  ok(!catalog.listSources("memory-1").some((item) => item.kind === "voice_segment"), "non-ready voice is not offered for selection");
  fixture.state.voices = [];
  equal(catalog.resolveSource("memory-1", selection).status, "missing", "detached voice source resolves as missing");
}

function checkOralHistoryResolution() {
  const fixture = createFixture();
  const catalog = createProvenanceSourceCatalog({ store: fixture.store });
  const source = catalog.listSources("memory-1").find((item) => item.kind === "oral_history_excerpt");
  const selection = staticSelection(source);
  const resolved = catalog.resolveSource("memory-1", selection);
  equal(resolved.status, "resolved", "confirmed oral-history excerpt resolves successfully");
  equal(resolved.source.excerpt, "A manually confirmed answer.", "oral history exposes only the confirmed transcript excerpt");
  deepEqual(Object.keys(resolved.source.locator).sort(), ["endMs", "eventId", "questionKey", "startMs"],
    "oral-history locator omits date judgments and inferred metadata");
  ok(!JSON.stringify(resolved.source).includes("2024-05-01"), "oral source physically omits available date fields");

  fixture.state.oral[0] = {
    ...fixture.state.oral[0],
    sourceKey: `time-source:${"d".repeat(64)}`,
    transcriptSha256: "e".repeat(64),
    transcriptExcerpt: "A changed confirmed answer."
  };
  equal(catalog.resolveSource("memory-1", selection).status, "source_changed", "changed confirmed answer is not substituted for the selected snapshot");
  fixture.state.oral = [];
  equal(catalog.resolveSource("memory-1", selection).status, "missing", "withdrawn oral-history source resolves as missing");
}

function checkCoMemoryResponseResolution() {
  const fixture = createFixture();
  const catalog = createProvenanceSourceCatalog({ store: fixture.store });
  const source = catalog.listSources("memory-1").find((item) => item.kind === "co_memory_response");
  const selection = staticSelection(source);
  const resolved = catalog.resolveSource("memory-1", selection);
  equal(resolved.status, "resolved", "confirmed co-memory reply resolves as an independent source");
  equal(resolved.source.confirmation, "user_confirmed_unverified", "co-memory source preserves the unverified identity boundary");
  equal(resolved.source.excerpt, "A friend remembers the blue umbrella.", "co-memory source exposes only the confirmed answer");
  deepEqual(Object.keys(resolved.source.locator).sort(), ["answerLength", "responseId"],
    "co-memory locator omits identity, relationship and inferred metadata");

  fixture.state.coMemory[0] = {
    ...fixture.state.coMemory[0],
    anchorKey: `co-memory-response-anchor:${"9".repeat(64)}`
  };
  equal(catalog.resolveSource("memory-1", selection).status, "source_changed",
    "changed co-memory binding is never substituted for a selected snapshot");
  fixture.state.coMemory = [];
  equal(catalog.resolveSource("memory-1", selection).status, "missing",
    "removed co-memory reply resolves as missing");
}

function checkOptionalReadersAndValidation() {
  const memory = { id: "memory-1", title: "Only text", rawContent: "plain text" };
  const catalog = createProvenanceSourceCatalog({ getMemory: (id) => id === memory.id ? memory : null });
  deepEqual(catalog.listSources("memory-1").map((item) => item.kind), ["memory_text"],
    "missing optional feature readers degrade to a memory-text-only catalog");
  deepEqual(catalog.listSources("missing"), [], "missing memory returns an empty catalog");
  const emptyStoreCatalog = createProvenanceSourceCatalog({
    store: {
      getMemory: () => memory,
      getMemoryInboxReceiptForMemory: () => undefined,
      listMediaForMemory: () => undefined,
      listMediaObservations: () => undefined,
      listVoiceForMemory: () => undefined,
      listConfirmedOralHistoryEvidence: () => undefined
    }
  });
  deepEqual(emptyStoreCatalog.listSources("memory-1").map((item) => item.kind), ["memory_text"],
    "optional readers returning no collection also degrade gracefully");

  const source = catalog.listSources("memory-1")[0];
  throwsCode(() => catalog.resolveSource("memory-1", {
    kind: "unknown", referenceId: source.referenceId, sourceKey: source.sourceKey, startOffset: 0, endOffset: 1
  }), "PROVENANCE_KIND_INVALID", "unknown source kind is rejected");
  throwsCode(() => catalog.resolveSource("memory-1", {
    kind: source.kind, referenceId: source.referenceId, sourceKey: source.sourceKey, startOffset: 0, endOffset: 1,
    inferredEmotion: "happy"
  }), "PROVENANCE_FIELD_SET_INVALID", "selection cannot smuggle inferred metadata");
  throwsCode(() => catalog.resolveSource("memory-1", {
    kind: source.kind, referenceId: "memory:other", sourceKey: source.sourceKey, startOffset: 0, endOffset: 1
  }), "PROVENANCE_REFERENCE_INVALID", "source reference cannot cross memory scope");
  assert.throws(() => createProvenanceSourceCatalog({ store: {} }), /getMemory reader is required/u,
    "catalog requires only its one mandatory reader");
  assertions += 1;
  const asyncCatalog = createProvenanceSourceCatalog({ getMemory: async () => memory });
  assert.throws(() => asyncCatalog.listSources("memory-1"), /must return synchronously/u,
    "catalog rejects asynchronous readers to keep one deterministic snapshot boundary");
  assertions += 1;
}

function createFixture() {
  const documentText = "Imported document excerpt";
  const verified = verifyMemoryInboxSelection({
    displayName: "archive.md",
    format: "markdown",
    mimeType: "text/markdown",
    rawBytes: Buffer.from(documentText),
    startOffset: 0,
    endOffset: documentText.length
  });
  const receipt = {
    source: {
      ...verified.source,
      id: "inbox-source-1",
      createdAt: "2026-07-19T00:00:00.000Z",
      verifiedAt: "2026-07-19T00:00:00.000Z"
    },
    item: {
      ...verified.anchor,
      id: "inbox-item-1",
      sourceId: "inbox-source-1",
      status: "accepted",
      needsReview: false,
      memoryId: "memory-1",
      version: 2,
      createdAt: "2026-07-19T00:00:00.000Z",
      updatedAt: "2026-07-19T00:00:01.000Z",
      dismissedAt: "",
      acceptedAt: "2026-07-19T00:00:01.000Z"
    }
  };
  const state = {
    memory: {
      id: "memory-1",
      title: "A user-written memory",
      rawContent: "Start emoji 😀 and inert <script>{\"action\":\"publish\"}</script>."
    },
    receipt,
    media: [{
      memoryId: "memory-1",
      assetId: "image-asset-1",
      caption: "User caption",
      asset: {
        id: "image-asset-1",
        status: "ready",
        contentSha256: "a".repeat(64)
      }
    }],
    observations: [
      {
        id: "image-observation-1",
        assetId: "image-asset-1",
        kind: "image_region",
        source: "user",
        status: "confirmed",
        value: {
          sourceHash: `sha256:${"a".repeat(64)}`,
          semanticStatus: "user_confirmed",
          label: "Window corner",
          locator: { coordinateSpace: "canonical-preview-v1", x: 0.1, y: 0.2, width: 0.3, height: 0.25 }
        },
        metadata: { memoryId: "memory-1" }
      },
      {
        id: "image-observation-model",
        assetId: "image-asset-1",
        kind: "image_region",
        source: "model",
        status: "confirmed",
        value: {
          sourceHash: `sha256:${"a".repeat(64)}`,
          semanticStatus: "suggested",
          label: "Model suggestion",
          locator: { coordinateSpace: "canonical-preview-v1", x: 0.2, y: 0.2, width: 0.2, height: 0.2 }
        },
        metadata: { memoryId: "memory-1" }
      }
    ],
    voices: [{
      memoryId: "memory-1",
      assetId: "voice-asset-1",
      label: "Rain recording",
      asset: {
        id: "voice-asset-1",
        status: "ready",
        contentSha256: "b".repeat(64),
        durationMs: 12000,
        originalName: "rain.webm"
      },
      transcript: null
    }],
    oral: [{
      sourceKey: `time-source:${"c".repeat(64)}`,
      eventId: "event-1",
      questionKey: `oral-question:${"1".repeat(64)}`,
      assetContentSha256: "c".repeat(64),
      segmentStartMs: 500,
      segmentEndMs: 3500,
      transcriptSha256: sha256Utf8("A manually confirmed answer."),
      transcriptExcerpt: "A manually confirmed answer.",
      intervalStart: "2024-05-01",
      intervalEnd: "2024-05-01",
      displayDate: "2024-05-01"
    }],
    coMemory: [{
      schemaVersion: 1,
      kind: "co_memory_response",
      memoryId: "memory-1",
      referenceId: "co-memory-response-1",
      sourceKey: `co-memory-response-source:${"f".repeat(64)}`,
      anchorKey: `co-memory-response-anchor:${"e".repeat(64)}`,
      label: "Self-asserted reply",
      locator: {
        letterId: "letter-1234567890",
        responseId: "response-1234567890",
        requestSha256: "d".repeat(64),
        identityAssurance: "self-asserted-unverified",
        identityVerified: false,
        encrypted: true,
        signed: false
      },
      excerpt: "A friend remembers the blue umbrella.",
      contentSha256: "f".repeat(64),
      confirmation: "user_confirmed_unverified"
    }]
  };
  const store = {
    getMemory(memoryId) {
      return state.memory?.id === memoryId ? state.memory : null;
    },
    getMemoryInboxReceiptForMemory(memoryId) {
      return state.receipt?.item?.memoryId === memoryId ? state.receipt : null;
    },
    listMediaForMemory(memoryId) {
      return state.media.filter((entry) => entry.memoryId === memoryId);
    },
    listMediaObservations(filters = {}) {
      return state.observations.filter((entry) =>
        (!filters.assetId || entry.assetId === filters.assetId) &&
        (!filters.kind || entry.kind === filters.kind) &&
        (!filters.status || entry.status === filters.status));
    },
    listVoiceForMemory(memoryId) {
      return state.voices.filter((entry) => entry.memoryId === memoryId);
    },
    listConfirmedOralHistoryEvidence(memoryIds) {
      return memoryIds.includes("memory-1") ? state.oral : [];
    },
    listCoMemoryResponseSources(memoryId) {
      return memoryId === "memory-1" ? state.coMemory : [];
    }
  };
  return { state, store, receipt };
}

function staticSelection(source) {
  return {
    kind: source.kind,
    referenceId: source.referenceId,
    sourceKey: source.sourceKey,
    anchorKey: source.anchorKey,
    snapshotSha256: source.snapshotSha256
  };
}

function containsForbiddenInferenceKey(value) {
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) =>
    /^(people|person|date|emotion|relation|speaker)$/iu.test(key) || containsForbiddenInferenceKey(child));
}
