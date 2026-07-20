"use strict";

const { randomUUID } = require("node:crypto");
const { applyMigrations } = require("./migrations");
const {
  CURRENT_SOURCE_STATUSES,
  PROVENANCE_SCHEMA_VERSION,
  buildAgentProjection,
  buildEventSha256,
  deriveClaimState,
  normalizeClaimDraftInput,
  normalizeResolverResult,
  provenanceError,
  requireId,
  requireSha256,
  requireTimestamp,
  sha256,
  stableStringify,
  validateStoredSourceSnapshot
} = require("./provenance-service");
const {
  buildProvenanceBackup: buildBackupPayload,
  validateProvenanceBackupPayload
} = require("./provenance-backup");

const MAX_CLAIMS_PER_MEMORY = 100;
const IDEMPOTENCY_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/u;

const PROVENANCE_MIGRATION = Object.freeze({
  version: PROVENANCE_SCHEMA_VERSION,
  name: "exhibit-provenance-passports-and-claim-ledger",
  up(db) {
    db.exec(`
      CREATE TABLE provenance_claims (
        id TEXT PRIMARY KEY,
        schema_version INTEGER NOT NULL DEFAULT 16 CHECK (schema_version = 16),
        memory_id TEXT NOT NULL,
        statement TEXT NOT NULL CHECK (length(trim(statement)) > 0 AND length(statement) <= 1000),
        source_set_sha256 TEXT NOT NULL CHECK (
          length(source_set_sha256) = 64 AND source_set_sha256 NOT GLOB '*[^0-9a-f]*'
        ),
        claim_sha256 TEXT NOT NULL CHECK (
          length(claim_sha256) = 64 AND claim_sha256 NOT GLOB '*[^0-9a-f]*'
        ),
        created_at TEXT NOT NULL,
        FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
      );

      CREATE TABLE provenance_claim_sources (
        id TEXT PRIMARY KEY,
        claim_id TEXT NOT NULL,
        position INTEGER NOT NULL CHECK (position BETWEEN 0 AND 7),
        relation_kind TEXT NOT NULL CHECK (relation_kind IN ('supports', 'supplements', 'different_record')),
        source_kind TEXT NOT NULL CHECK (source_kind IN (
          'memory_text', 'document_excerpt', 'image_region', 'voice_segment', 'oral_history_excerpt'
        )),
        source_key TEXT NOT NULL,
        anchor_key TEXT NOT NULL,
        origin_ref_json TEXT NOT NULL CHECK (json_valid(origin_ref_json) AND json_type(origin_ref_json) = 'object'),
        locator_json TEXT NOT NULL CHECK (json_valid(locator_json) AND json_type(locator_json) = 'object'),
        snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json) AND json_type(snapshot_json) = 'object'),
        snapshot_sha256 TEXT NOT NULL CHECK (
          length(snapshot_sha256) = 64 AND snapshot_sha256 NOT GLOB '*[^0-9a-f]*'
        ),
        sensitive INTEGER NOT NULL DEFAULT 0 CHECK (sensitive IN (0, 1)),
        created_at TEXT NOT NULL,
        UNIQUE (claim_id, position),
        UNIQUE (claim_id, anchor_key),
        FOREIGN KEY (claim_id) REFERENCES provenance_claims(id) ON DELETE CASCADE
      );

      CREATE TABLE provenance_claim_events (
        id TEXT PRIMARY KEY,
        claim_id TEXT NOT NULL,
        sequence INTEGER NOT NULL CHECK (sequence BETWEEN 0 AND 2),
        action TEXT NOT NULL CHECK (action IN ('created', 'confirmed', 'withdrawn')),
        source_set_sha256 TEXT NOT NULL CHECK (
          length(source_set_sha256) = 64 AND source_set_sha256 NOT GLOB '*[^0-9a-f]*'
        ),
        previous_event_sha256 TEXT NOT NULL DEFAULT '' CHECK (
          previous_event_sha256 = '' OR
          (length(previous_event_sha256) = 64 AND previous_event_sha256 NOT GLOB '*[^0-9a-f]*')
        ),
        event_sha256 TEXT NOT NULL CHECK (
          length(event_sha256) = 64 AND event_sha256 NOT GLOB '*[^0-9a-f]*'
        ),
        idempotency_key TEXT NOT NULL UNIQUE,
        request_sha256 TEXT NOT NULL CHECK (
          length(request_sha256) = 64 AND request_sha256 NOT GLOB '*[^0-9a-f]*'
        ),
        created_at TEXT NOT NULL,
        UNIQUE (claim_id, sequence),
        FOREIGN KEY (claim_id) REFERENCES provenance_claims(id) ON DELETE CASCADE
      );

      CREATE INDEX idx_provenance_claims_memory
        ON provenance_claims(memory_id, created_at DESC, id);
      CREATE INDEX idx_provenance_sources_claim
        ON provenance_claim_sources(claim_id, position, id);
      CREATE INDEX idx_provenance_sources_anchor
        ON provenance_claim_sources(source_kind, anchor_key, claim_id);
      CREATE INDEX idx_provenance_events_claim
        ON provenance_claim_events(claim_id, sequence, id);

      CREATE TRIGGER provenance_claim_update_immutable
      BEFORE UPDATE ON provenance_claims
      BEGIN
        SELECT RAISE(ABORT, 'PROVENANCE_CLAIM_IMMUTABLE');
      END;

      CREATE TRIGGER provenance_source_update_immutable
      BEFORE UPDATE ON provenance_claim_sources
      BEGIN
        SELECT RAISE(ABORT, 'PROVENANCE_SOURCE_IMMUTABLE');
      END;

      CREATE TRIGGER provenance_event_update_immutable
      BEFORE UPDATE ON provenance_claim_events
      BEGIN
        SELECT RAISE(ABORT, 'PROVENANCE_EVENT_IMMUTABLE');
      END;

      CREATE TRIGGER provenance_source_set_frozen
      BEFORE INSERT ON provenance_claim_sources
      WHEN EXISTS (SELECT 1 FROM provenance_claim_events event WHERE event.claim_id = new.claim_id)
      BEGIN
        SELECT RAISE(ABORT, 'PROVENANCE_SOURCE_SET_FROZEN');
      END;
    `);
  }
});

function initializeProvenanceDatabase(options = {}) {
  const db = requireDatabase(options.db);
  const sourceResolver = options.sourceResolver;
  if (typeof sourceResolver !== "function") {
    throw new TypeError("initializeProvenanceDatabase requires sourceResolver(source, context).");
  }
  const now = typeof options.now === "function" ? options.now : () => new Date().toISOString();
  const createId = typeof options.createId === "function" ? options.createId : (prefix) => `${prefix}-${randomUUID()}`;
  const suppliedTransaction = typeof options.withTransaction === "function" ? options.withTransaction : null;

  if (options.applyMigrations !== false) {
    applyMigrations({
      db,
      baselineVersion: 4,
      migrations: [PROVENANCE_MIGRATION],
      supportedVersion: Math.max(PROVENANCE_SCHEMA_VERSION, Number(options.schemaVersion) || PROVENANCE_SCHEMA_VERSION),
      now
    });
  }

  const statements = prepareStatements(db);

  function runAtomic(operation) {
    if (suppliedTransaction) return suppliedTransaction(operation);
    const savepoint = `provenance_write_${randomUUID().replace(/-/gu, "")}`;
    db.exec(`SAVEPOINT ${savepoint}`);
    try {
      const result = operation();
      if (result && typeof result.then === "function") throw new TypeError("Provenance transactions must be synchronous.");
      db.exec(`RELEASE SAVEPOINT ${savepoint}`);
      return result;
    } catch (error) {
      try { db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`); } catch { /* preserve original */ }
      try { db.exec(`RELEASE SAVEPOINT ${savepoint}`); } catch { /* preserve original */ }
      throw error;
    }
  }

  function createProvenanceClaim(input = {}, mutation = {}) {
    assertMutationKeys(mutation, ["idempotencyKey"]);
    const normalized = normalizeClaimDraftInput(input);
    const idempotencyKey = requireIdempotencyKey(mutation.idempotencyKey);
    const requestSha256 = mutationSha256("create", normalized);
    const replay = replayFor(idempotencyKey, requestSha256, "created");
    if (replay) return { created: false, idempotent: true, claim: requireClaimState(replay.claimId) };
    requireMemory(normalized.memoryId);
    assertSourcesCurrent(normalized.sources, { operation: "create", memoryId: normalized.memoryId });

    return runAtomic(() => {
      if (Number(statements.countForMemory.get(normalized.memoryId)?.count) >= MAX_CLAIMS_PER_MEMORY) {
        throw provenanceError(`A memory can keep at most ${MAX_CLAIMS_PER_MEMORY} provenance claims.`, "PROVENANCE_CLAIM_LIMIT", 409);
      }
      const timestamp = requireTimestamp(now(), "now");
      const claimId = newId("provenance-claim");
      statements.insertClaim.run(
        claimId,
        normalized.memoryId,
        normalized.statement,
        normalized.sourceSetSha256,
        normalized.claimSha256,
        timestamp
      );
      normalized.sources.forEach((source, position) => {
        statements.insertSource.run(
          newId("provenance-source"),
          claimId,
          position,
          source.relationKind,
          source.sourceKind,
          source.sourceKey,
          source.anchorKey,
          JSON.stringify(source.originRef),
          JSON.stringify(source.locator),
          JSON.stringify(source.snapshot),
          source.snapshotSha256,
          source.sensitive ? 1 : 0,
          timestamp
        );
      });
      insertEvent({
        claimId,
        claimSha256: normalized.claimSha256,
        sourceSetSha256: normalized.sourceSetSha256,
        sequence: 0,
        action: "created",
        previousEventSha256: "",
        idempotencyKey,
        requestSha256,
        createdAt: timestamp
      });
      return { created: true, idempotent: false, claim: requireClaimState(claimId) };
    });
  }

  function confirmProvenanceClaim(claimId, mutation = {}) {
    assertMutationKeys(mutation, ["confirm", "expectedVersion", "idempotencyKey"]);
    if (mutation.confirm !== true) throw confirmationRequired();
    return appendLifecycleEvent(claimId, "confirmed", mutation);
  }

  function withdrawProvenanceClaim(claimId, mutation = {}) {
    assertMutationKeys(mutation, ["confirm", "expectedVersion", "idempotencyKey"]);
    if (mutation.confirm !== true) throw confirmationRequired();
    return appendLifecycleEvent(claimId, "withdrawn", mutation);
  }

  function appendLifecycleEvent(rawClaimId, action, mutation) {
    const claimId = requireId(rawClaimId, "claimId");
    const idempotencyKey = requireIdempotencyKey(mutation.idempotencyKey);
    const requestSha256 = mutationSha256(action, { claimId, confirm: true });
    const replay = replayFor(idempotencyKey, requestSha256, action);
    if (replay) return { changed: false, idempotent: true, claim: requireClaimState(replay.claimId) };
    const aggregate = requireAggregate(claimId);
    assertExpectedVersion(aggregate.events.length, mutation.expectedVersion);
    const last = aggregate.events.at(-1);
    if (last.action === "withdrawn") {
      throw provenanceError("The provenance claim was already withdrawn.", "PROVENANCE_CLAIM_WITHDRAWN", 409);
    }
    if (action === "confirmed" && last.action !== "created") {
      throw provenanceError("The provenance claim was already confirmed.", "PROVENANCE_CLAIM_ALREADY_CONFIRMED", 409);
    }
    if (action === "confirmed") {
      assertSourcesCurrent(aggregate.sources, { operation: "confirm", memoryId: aggregate.claim.memoryId, claimId });
    }
    return runAtomic(() => {
      const current = requireAggregate(claimId);
      assertExpectedVersion(current.events.length, mutation.expectedVersion);
      const currentLast = current.events.at(-1);
      if (currentLast.eventSha256 !== last.eventSha256) throw versionConflict();
      const timestamp = monotonicTimestamp(requireTimestamp(now(), "now"), currentLast.createdAt);
      insertEvent({
        claimId,
        claimSha256: current.claim.claimSha256,
        sourceSetSha256: current.claim.sourceSetSha256,
        sequence: current.events.length,
        action,
        previousEventSha256: currentLast.eventSha256,
        idempotencyKey,
        requestSha256,
        createdAt: timestamp
      });
      return { changed: true, idempotent: false, claim: requireClaimState(claimId) };
    });
  }

  function getProvenanceClaim(claimId) {
    const aggregate = readAggregate(requireId(claimId, "claimId"));
    return aggregate ? deriveClaimState(aggregate, sourceResolver, { operation: "read" }) : null;
  }

  function listProvenanceClaims(memoryId) {
    const id = requireId(memoryId, "memoryId");
    return statements.claimsForMemory.all(id).map((row) => (
      deriveClaimState(readAggregateFromRow(row), sourceResolver, { operation: "read" })
    ));
  }

  function getProvenancePassport(memoryId) {
    const id = requireId(memoryId, "memoryId");
    requireMemory(id);
    const claims = listProvenanceClaims(id);
    return Object.freeze({
      memoryId: id,
      summary: Object.freeze(summarizeStates(claims)),
      claims: Object.freeze(claims)
    });
  }

  function listConfirmedProvenanceForAgent(memoryIds) {
    const ids = memoryIds === undefined
      ? statements.memoryIdsWithClaims.all().map((row) => row.memory_id)
      : [...new Set(memoryIds.map((id) => requireId(id, "memoryId")))];
    const states = ids.flatMap((id) => listProvenanceClaims(id));
    const projection = buildAgentProjection(states);
    const emptyDigest = sha256("[]");
    return Object.freeze(Object.fromEntries(ids.map((id) => [id, projection[id] || Object.freeze({
      claims: Object.freeze([]),
      truncated: false,
      provenanceSetSha256: emptyDigest
    })])));
  }

  function buildProvenanceBackup(mode = "full", sourceMemoryIds) {
    const boundary = sourceMemoryIds === undefined ? null : new Set(sourceMemoryIds.map((id) => requireId(id, "memoryId")));
    const rows = statements.allClaims.all().filter((row) => !boundary || boundary.has(row.memory_id));
    const aggregates = rows.map((row) => {
      const aggregate = readAggregateFromRow(row);
      return {
        ...aggregate,
        state: mode === "redacted" ? deriveClaimState(aggregate, sourceResolver, { operation: "backup" }) : null
      };
    });
    return buildBackupPayload({ mode, aggregates });
  }

  function validateProvenanceBackup(backup, sourceMemoryIds) {
    return validateProvenanceBackupPayload(backup, {
      ...(sourceMemoryIds === undefined ? {} : { memoryIds: sourceMemoryIds })
    });
  }

  function restoreProvenanceBackup(backup, restoreOptions = {}) {
    if (backup?.mode === "redacted-summary") {
      validateProvenanceBackupPayload(backup);
      return { claims: 0, sources: 0, events: 0, skipped: 0, summarized: true, idMap: { claims: {}, sources: {}, events: {} } };
    }
    const memoryIdMap = normalizeIdMap(restoreOptions.memoryIdMap, "memoryIdMap");
    const normalized = validateProvenanceBackupPayload(backup, {
      memoryIds: [...memoryIdMap.keys()],
      returnNormalized: true
    });
    const mapSource = restoreOptions.sourceMapper === undefined
      ? (source) => defaultMapSource(source, memoryIdMap)
      : requireFunction(restoreOptions.sourceMapper, "sourceMapper");
    const claimIdMap = new Map();
    const sourceIdMap = new Map();
    const eventIdMap = new Map();
    const occupiedClaimIds = new Set();
    const occupiedSourceIds = new Set();
    const occupiedEventIds = new Set();
    normalized.claims.forEach((claim) => claimIdMap.set(claim.id, uniqueId("provenance-claim", occupiedClaimIds, statements.getClaim)));
    normalized.sources.forEach((source) => sourceIdMap.set(source.id, uniqueId("provenance-source", occupiedSourceIds, statements.getSource)));
    normalized.events.forEach((event) => eventIdMap.set(event.id, uniqueId("provenance-event", occupiedEventIds, statements.getEvent)));

    const plans = normalized.claims.map((claim) => {
      const targetMemoryId = memoryIdMap.get(claim.memoryId);
      if (!targetMemoryId) throw provenanceError("Provenance restore is missing a memory mapping.", "PROVENANCE_RESTORE_MAPPING_INVALID", 409);
      requireMemory(targetMemoryId);
      const targetClaimId = claimIdMap.get(claim.id);
      const sources = normalized.sources.filter((source) => source.claimId === claim.id).sort((a, b) => a.position - b.position).map((source) => {
        const mapped = mapSource(Object.freeze({ ...source }), Object.freeze({
          sourceMemoryId: claim.memoryId,
          targetMemoryId,
          memoryIdMap: new Map(memoryIdMap)
        }));
        if (mapped && typeof mapped.then === "function") throw new TypeError("sourceMapper must be synchronous.");
        const validated = validateMappedSource(mapped, source);
        return { ...source, ...validated, id: sourceIdMap.get(source.id), claimId: targetClaimId };
      });
      const events = normalized.events.filter((event) => event.claimId === claim.id).sort((a, b) => a.sequence - b.sequence).map((event) => ({
        ...event,
        id: eventIdMap.get(event.id),
        claimId: targetClaimId,
        idempotencyKey: restoreIdempotencyKey(eventIdMap.get(event.id)),
        requestSha256: sha256(`time-isle-provenance-restored-event-v1\0${event.eventSha256}`)
      }));
      return { claim: { ...claim, id: targetClaimId, memoryId: targetMemoryId }, sources, events };
    });
    const additionsByMemory = new Map();
    plans.forEach((plan) => additionsByMemory.set(plan.claim.memoryId, (additionsByMemory.get(plan.claim.memoryId) || 0) + 1));
    for (const [memoryId, additions] of additionsByMemory) {
      if (Number(statements.countForMemory.get(memoryId)?.count) + additions > MAX_CLAIMS_PER_MEMORY) {
        throw provenanceError("Provenance restore exceeds the per-memory claim limit.", "PROVENANCE_CLAIM_LIMIT", 409);
      }
    }

    return runAtomic(() => {
      for (const plan of plans) insertRestoredPlan(plan);
      return {
        claims: plans.length,
        sources: plans.reduce((total, plan) => total + plan.sources.length, 0),
        events: plans.reduce((total, plan) => total + plan.events.length, 0),
        skipped: 0,
        idMap: {
          claims: Object.fromEntries(claimIdMap),
          sources: Object.fromEntries(sourceIdMap),
          events: Object.fromEntries(eventIdMap)
        }
      };
    });
  }

  function clearProvenanceClaims() {
    return runAtomic(() => {
      const stats = getProvenanceStats();
      statements.clearClaims.run();
      return { claimsDeleted: stats.claims, sourcesDeleted: stats.sources, eventsDeleted: stats.events };
    });
  }

  function getProvenanceStats() {
    const row = statements.stats.get();
    const states = statements.allClaims.all().map((claim) => deriveClaimState(readAggregateFromRow(claim), sourceResolver, { operation: "stats" }));
    const summary = summarizeStates(states);
    return {
      claims: Number(row.claims) || 0,
      sources: Number(row.sources) || 0,
      events: Number(row.events) || 0,
      draft: summary.draft,
      confirmed: summary.confirmed,
      needsReview: summary.needsReview,
      withdrawn: summary.withdrawn
    };
  }

  function validateProvenanceState() {
    validateProvenanceBackupPayload(buildProvenanceBackup("full"));
    return true;
  }

  function insertRestoredPlan(plan) {
    statements.insertClaim.run(
      plan.claim.id,
      plan.claim.memoryId,
      plan.claim.statement,
      plan.claim.sourceSetSha256,
      plan.claim.claimSha256,
      plan.claim.createdAt
    );
    plan.sources.forEach((source) => statements.insertSource.run(
      source.id,
      source.claimId,
      source.position,
      source.relationKind,
      source.sourceKind,
      source.sourceKey,
      source.anchorKey,
      JSON.stringify(source.originRef),
      JSON.stringify(source.locator),
      JSON.stringify(source.snapshot),
      source.snapshotSha256,
      source.sensitive ? 1 : 0,
      source.createdAt
    ));
    plan.events.forEach((event) => statements.insertEvent.run(
      event.id,
      event.claimId,
      event.sequence,
      event.action,
      event.sourceSetSha256,
      event.previousEventSha256,
      event.eventSha256,
      event.idempotencyKey,
      event.requestSha256,
      event.createdAt
    ));
  }

  function insertEvent(input) {
    const eventSha256 = buildEventSha256(input);
    const eventId = newId("provenance-event");
    statements.insertEvent.run(
      eventId,
      input.claimId,
      input.sequence,
      input.action,
      input.sourceSetSha256,
      input.previousEventSha256,
      eventSha256,
      input.idempotencyKey,
      input.requestSha256,
      input.createdAt
    );
    return eventId;
  }

  function readAggregate(claimId) {
    const row = statements.getClaim.get(claimId);
    return row ? readAggregateFromRow(row) : null;
  }

  function readAggregateFromRow(row) {
    const claim = rowToClaim(row);
    return {
      claim,
      sources: statements.sourcesForClaim.all(claim.id).map(rowToSource),
      events: statements.eventsForClaim.all(claim.id).map(rowToEvent)
    };
  }

  function requireAggregate(claimId) {
    const aggregate = readAggregate(claimId);
    if (!aggregate) throw provenanceError("Provenance claim was not found.", "PROVENANCE_CLAIM_NOT_FOUND", 404);
    return aggregate;
  }

  function requireClaimState(claimId) {
    return deriveClaimState(requireAggregate(claimId), sourceResolver, { operation: "read" });
  }

  function requireMemory(memoryId) {
    if (!statements.memoryExists.get(requireId(memoryId, "memoryId"))) {
      throw provenanceError("Memory was not found.", "PROVENANCE_MEMORY_NOT_FOUND", 404);
    }
  }

  function assertSourcesCurrent(sources, context) {
    for (const source of sources) {
      const result = sourceResolver(source, context);
      if (result && typeof result.then === "function") throw new TypeError("sourceResolver must be synchronous.");
      const resolution = normalizeResolverResult(result);
      if (!CURRENT_SOURCE_STATUSES.has(resolution.status)) {
        const error = provenanceError("A provenance source changed or is unavailable.", "PROVENANCE_SOURCE_NOT_CURRENT", 409);
        error.anchorKey = source.anchorKey;
        error.integrityStatus = resolution.status;
        throw error;
      }
    }
  }

  function replayFor(idempotencyKey, requestSha256, expectedAction) {
    const row = statements.eventByIdempotency.get(idempotencyKey);
    if (!row) return null;
    if (row.request_sha256 !== requestSha256 || row.action !== expectedAction) throw idempotencyConflict();
    return rowToEvent(row);
  }

  function newId(prefix) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const id = requireId(createId(prefix), `${prefix} id`);
      if (!statements.anyId.get(id)) return id;
    }
    throw provenanceError("Unable to allocate a unique provenance id.", "PROVENANCE_ID_CONFLICT", 500);
  }

  function uniqueId(prefix, occupied, getStatement) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const id = requireId(createId(prefix), `${prefix} id`);
      if (!occupied.has(id) && !getStatement.get(id)) {
        occupied.add(id);
        return id;
      }
    }
    throw provenanceError("Unable to allocate a unique restored provenance id.", "PROVENANCE_RESTORE_ID_CONFLICT", 409);
  }

  return Object.freeze({
    createProvenanceClaim,
    confirmProvenanceClaim,
    withdrawProvenanceClaim,
    getProvenanceClaim,
    listProvenanceClaims,
    getProvenancePassport,
    listConfirmedProvenanceForAgent,
    buildProvenanceBackup,
    validateProvenanceBackup,
    restoreProvenanceBackup,
    clearProvenanceClaims,
    getProvenanceStats,
    validateProvenanceState
  });
}

function prepareStatements(db) {
  return {
    memoryExists: db.prepare("SELECT 1 AS found FROM memories WHERE id = ?"),
    insertClaim: db.prepare(`INSERT INTO provenance_claims
      (id, schema_version, memory_id, statement, source_set_sha256, claim_sha256, created_at)
      VALUES (?, 16, ?, ?, ?, ?, ?)`),
    insertSource: db.prepare(`INSERT INTO provenance_claim_sources
      (id, claim_id, position, relation_kind, source_kind, source_key, anchor_key,
       origin_ref_json, locator_json, snapshot_json, snapshot_sha256, sensitive, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    insertEvent: db.prepare(`INSERT INTO provenance_claim_events
      (id, claim_id, sequence, action, source_set_sha256, previous_event_sha256,
       event_sha256, idempotency_key, request_sha256, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    getClaim: db.prepare("SELECT * FROM provenance_claims WHERE id = ?"),
    getSource: db.prepare("SELECT * FROM provenance_claim_sources WHERE id = ?"),
    getEvent: db.prepare("SELECT * FROM provenance_claim_events WHERE id = ?"),
    anyId: db.prepare(`SELECT 1 AS found WHERE EXISTS (SELECT 1 FROM provenance_claims WHERE id = ?1)
      OR EXISTS (SELECT 1 FROM provenance_claim_sources WHERE id = ?1)
      OR EXISTS (SELECT 1 FROM provenance_claim_events WHERE id = ?1)`),
    eventByIdempotency: db.prepare("SELECT * FROM provenance_claim_events WHERE idempotency_key = ?"),
    claimsForMemory: db.prepare("SELECT * FROM provenance_claims WHERE memory_id = ? ORDER BY datetime(created_at) DESC, id"),
    allClaims: db.prepare("SELECT * FROM provenance_claims ORDER BY memory_id, datetime(created_at), id"),
    sourcesForClaim: db.prepare("SELECT * FROM provenance_claim_sources WHERE claim_id = ? ORDER BY position, id"),
    eventsForClaim: db.prepare("SELECT * FROM provenance_claim_events WHERE claim_id = ? ORDER BY sequence, id"),
    countForMemory: db.prepare("SELECT COUNT(*) AS count FROM provenance_claims WHERE memory_id = ?"),
    memoryIdsWithClaims: db.prepare("SELECT DISTINCT memory_id FROM provenance_claims ORDER BY memory_id"),
    stats: db.prepare(`SELECT
      (SELECT COUNT(*) FROM provenance_claims) AS claims,
      (SELECT COUNT(*) FROM provenance_claim_sources) AS sources,
      (SELECT COUNT(*) FROM provenance_claim_events) AS events`),
    clearClaims: db.prepare("DELETE FROM provenance_claims")
  };
}

function rowToClaim(row) {
  return Object.freeze({
    id: row.id,
    memoryId: row.memory_id,
    statement: row.statement,
    sourceSetSha256: row.source_set_sha256,
    claimSha256: row.claim_sha256,
    createdAt: row.created_at
  });
}

function rowToSource(row) {
  return Object.freeze({
    id: row.id,
    claimId: row.claim_id,
    position: Number(row.position),
    relationKind: row.relation_kind,
    sourceKind: row.source_kind,
    sourceKey: row.source_key,
    anchorKey: row.anchor_key,
    originRef: parseJsonObject(row.origin_ref_json, "origin_ref_json"),
    locator: parseJsonObject(row.locator_json, "locator_json"),
    snapshot: parseJsonObject(row.snapshot_json, "snapshot_json"),
    snapshotSha256: row.snapshot_sha256,
    sensitive: Boolean(row.sensitive),
    createdAt: row.created_at
  });
}

function rowToEvent(row) {
  return Object.freeze({
    id: row.id,
    claimId: row.claim_id,
    sequence: Number(row.sequence),
    action: row.action,
    sourceSetSha256: row.source_set_sha256,
    previousEventSha256: row.previous_event_sha256 || "",
    eventSha256: row.event_sha256,
    idempotencyKey: row.idempotency_key,
    requestSha256: row.request_sha256,
    createdAt: row.created_at
  });
}

function validateMappedSource(mapped, original) {
  if (!mapped || typeof mapped !== "object" || Array.isArray(mapped)) {
    throw provenanceError("sourceMapper returned an invalid source.", "PROVENANCE_RESTORE_SOURCE_INVALID", 409);
  }
  const normalized = validateStoredSourceSnapshot({
    relationKind: mapped.relationKind,
    sourceKind: mapped.sourceKind,
    sourceKey: mapped.sourceKey,
    anchorKey: mapped.anchorKey,
    originRef: mapped.originRef,
    locator: mapped.locator,
    snapshot: mapped.snapshot,
    snapshotSha256: mapped.snapshotSha256,
    sensitive: mapped.sensitive
  }, { name: "mapped source" });
  if (normalized.relationKind !== original.relationKind || normalized.sourceKind !== original.sourceKind ||
      normalized.sourceKey !== original.sourceKey || normalized.anchorKey !== original.anchorKey ||
      normalized.snapshotSha256 !== original.snapshotSha256 || normalized.sensitive !== original.sensitive) {
    throw provenanceError("sourceMapper changed immutable source evidence.", "PROVENANCE_RESTORE_SOURCE_INVALID", 409);
  }
  return normalized;
}

function defaultMapSource(source, memoryIdMap) {
  const originRef = { ...(source.originRef || {}) };
  if (originRef.memoryId && memoryIdMap.has(originRef.memoryId)) originRef.memoryId = memoryIdMap.get(originRef.memoryId);
  return { ...source, originRef };
}

function normalizeIdMap(value, name) {
  const entries = value instanceof Map ? [...value] : value && typeof value === "object" && !Array.isArray(value) ? Object.entries(value) : null;
  if (!entries) throw provenanceError(`${name} is invalid.`, "PROVENANCE_RESTORE_MAPPING_INVALID", 409);
  const result = new Map(entries.map(([source, target]) => [requireId(source, `${name} source`), requireId(target, `${name} target`)]));
  if (new Set(result.values()).size !== result.size) throw provenanceError(`${name} contains a collision.`, "PROVENANCE_RESTORE_MAPPING_COLLISION", 409);
  return result;
}

function restoreIdempotencyKey(eventId) {
  return `restore:${requireId(eventId, "eventId")}`;
}

function summarizeStates(states) {
  const summary = { claims: states.length, sources: 0, draft: 0, confirmed: 0, needsReview: 0, withdrawn: 0 };
  states.forEach((state) => {
    summary.sources += Array.isArray(state.sources) ? state.sources.length : 0;
    if (Object.hasOwn(summary, state.status)) summary[state.status] += 1;
  });
  return summary;
}

function mutationSha256(action, value) {
  return sha256(`time-isle-provenance-mutation-v1\0${action}\0${stableStringify(value)}`);
}

function requireIdempotencyKey(value) {
  const key = String(value || "").trim();
  if (!IDEMPOTENCY_PATTERN.test(key)) throw provenanceError("Idempotency-Key is invalid.", "PROVENANCE_IDEMPOTENCY_KEY_INVALID");
  return key;
}

function assertExpectedVersion(current, supplied) {
  if (supplied === undefined) return;
  const expected = Number(supplied);
  if (!Number.isSafeInteger(expected) || expected < 1 || expected > 3) {
    throw provenanceError("expectedVersion is invalid.", "PROVENANCE_VERSION_INVALID");
  }
  if (expected !== current) throw versionConflict();
}

function assertMutationKeys(value, allowedKeys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw provenanceError("mutation must be an object.", "PROVENANCE_MUTATION_INVALID");
  const allowed = new Set(allowedKeys);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) throw provenanceError(`mutation contains unsupported field ${unknown[0]}.`, "PROVENANCE_FIELD_SET_INVALID");
}

function parseJsonObject(value, name) {
  let parsed;
  try { parsed = JSON.parse(value); } catch {
    throw provenanceError(`Stored ${name} is invalid.`, "PROVENANCE_STORED_JSON_INVALID", 500);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw provenanceError(`Stored ${name} is invalid.`, "PROVENANCE_STORED_JSON_INVALID", 500);
  }
  return parsed;
}

function monotonicTimestamp(current, previous) {
  const currentMs = Date.parse(current);
  const previousMs = Date.parse(previous);
  return new Date(Math.max(currentMs, previousMs + 1)).toISOString();
}

function confirmationRequired() {
  return provenanceError("This operation requires confirm: true.", "PROVENANCE_CONFIRMATION_REQUIRED", 400);
}

function idempotencyConflict() {
  return provenanceError("Idempotency-Key was already used for another provenance mutation.", "PROVENANCE_IDEMPOTENCY_CONFLICT", 409);
}

function versionConflict() {
  return provenanceError("The provenance claim changed; refresh before continuing.", "PROVENANCE_VERSION_CONFLICT", 412);
}

function requireFunction(value, name) {
  if (typeof value !== "function") throw new TypeError(`${name} must be a function.`);
  return value;
}

function requireDatabase(db) {
  if (!db || typeof db.exec !== "function" || typeof db.prepare !== "function") {
    throw new TypeError("initializeProvenanceDatabase requires a synchronous SQLite database.");
  }
  return db;
}

module.exports = {
  MAX_CLAIMS_PER_MEMORY,
  PROVENANCE_MIGRATION,
  initializeProvenanceDatabase
};
