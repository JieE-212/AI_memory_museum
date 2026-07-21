"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { createMemoryStore } = require("../database");
const { validateArchaeologyBackup, restoreArchaeologyBackup } = require("./archaeology-backup");
const { prepareMediaArchive } = require("./media-backup");
const { restorePreparedArchive } = require("./media-restore");
const { createMediaStorage } = require("./media-storage");
const { createVoiceStorage } = require("./voice-storage");
const { createIsolatedRecoveryDrill } = require("./isolated-recovery-drill");

const SANDBOX_PARENT_NAME = "time-isle-recovery-drills";
const SANDBOX_PREFIX = "recovery-";
const DEFAULT_STALE_AGE_MS = 24 * 60 * 60 * 1000;
const REQUIRED_DATABASE_CHECKS = new Set([
  "DATABASE_QUICK_CHECK",
  "DATABASE_FOREIGN_KEYS",
  "DATABASE_SCHEMA",
  "DATABASE_FTS_COUNT",
  "DATABASE_FTS_MEMBERSHIP"
]);
const RESTORE_COUNT_TABLES = Object.freeze({
  memories: "memories",
  memoryPeople: "memory_people",
  memoryTags: "memory_tags",
  memoryEmotions: "memory_emotions",
  archaeologyEvents: "memory_events",
  archaeologyMembers: "event_members",
  archaeologyClaims: "memory_claims",
  archaeologyDecisions: "memory_pair_decisions",
  archaeologyQuestions: "curator_questions",
  mediaAssets: "media_assets",
  mediaVariants: "media_variants",
  memoryMediaLinks: "memory_media",
  mediaObservations: "media_observations",
  voiceAssets: "voice_assets",
  memoryVoiceLinks: "memory_voice",
  voiceTranscripts: "voice_transcripts",
  exhibitions: "exhibitions",
  exhibitionSections: "exhibition_sections",
  exhibitionItems: "exhibition_items",
  exhibitionCitations: "exhibition_citations",
  revisitStates: "memory_revisit_state",
  revisitIntents: "memory_revisit_intents",
  entities: "entities",
  entityAliases: "entity_aliases",
  entityMemoryLinks: "memory_entities",
  capsules: "time_capsules",
  capsuleMediaLinks: "time_capsule_media",
  revisions: "memory_revisions",
  timeCalibrations: "time_calibrations",
  oralHistoryQuestions: "oral_history_questions",
  oralHistoryAnswers: "oral_history_answers",
  curatorAgentRuns: "curator_agent_runs",
  curatorAgentSteps: "curator_agent_steps",
  curatorAgentProposals: "curator_agent_proposals",
  curatorAgentDecisions: "curator_agent_decisions",
  memoryInboxSources: "memory_inbox_sources",
  memoryInboxItems: "memory_inbox_items",
  provenanceClaims: "provenance_claims",
  provenanceSources: "provenance_claim_sources",
  provenanceEvents: "provenance_claim_events",
  coMemoryResponses: "co_memory_responses"
});

function createIsolatedRecoveryRuntime(options = {}) {
  assertPlainObject(options, "options");
  assertKnownKeys(options, new Set([
    "temporaryRoot", "schemaVersion", "halls", "normalizeMemory", "createId", "clock", "randomBytes",
    "prepareArchive", "restoreArchive", "createStore", "createMediaStorage", "createVoiceStorage"
  ]), "options");
  const temporaryRoot = requireAbsolutePath(options.temporaryRoot || os.tmpdir(), "temporaryRoot");
  const schemaVersion = requirePositiveInteger(options.schemaVersion, "schemaVersion");
  const halls = normalizeHalls(options.halls);
  const normalizeMemory = requireFunction(options.normalizeMemory, "normalizeMemory");
  const createId = requireFunction(options.createId, "createId");
  const prepareArchive = options.prepareArchive === undefined
    ? prepareMediaArchive
    : requireFunction(options.prepareArchive, "prepareArchive");
  const restoreArchive = options.restoreArchive === undefined
    ? restorePreparedArchive
    : requireFunction(options.restoreArchive, "restoreArchive");
  const createStore = options.createStore === undefined
    ? createMemoryStore
    : requireFunction(options.createStore, "createStore");
  const mediaStorageFactory = options.createMediaStorage === undefined
    ? createMediaStorage
    : requireFunction(options.createMediaStorage, "createMediaStorage");
  const voiceStorageFactory = options.createVoiceStorage === undefined
    ? createVoiceStorage
    : requireFunction(options.createVoiceStorage, "createVoiceStorage");
  const parentRoot = path.join(temporaryRoot, SANDBOX_PARENT_NAME);

  cleanupStaleRecoverySandboxes({ parentRoot, minimumAgeMs: DEFAULT_STALE_AGE_MS });

  return createIsolatedRecoveryDrill({
    clock: options.clock,
    randomBytes: options.randomBytes,
    createSandbox: async ({ signal }) => {
      throwIfAborted(signal);
      cleanupStaleRecoverySandboxes({ parentRoot, minimumAgeMs: DEFAULT_STALE_AGE_MS });
      ensureRealDirectory(parentRoot);
      const root = fs.mkdtempSync(path.join(parentRoot, SANDBOX_PREFIX));
      let store = null;
      try {
        ensureWithin(parentRoot, root, "sandbox root");
        const dbPath = path.join(root, "museum.sqlite");
        const mediaRoot = path.join(root, "media");
        const voiceRoot = path.join(mediaRoot, "voice");
        store = createStore({ dbPath, halls, schemaVersion });
        const storage = mediaStorageFactory({ root: mediaRoot });
        const voiceStorage = voiceStorageFactory({ root: voiceRoot });
        throwIfAborted(signal);
        return {
          root,
          parentRoot,
          dbPath,
          mediaRoot,
          voiceRoot,
          store,
          storage,
          voiceStorage,
          closed: false
        };
      } catch (error) {
        try { store?.close?.(); } catch { /* cleanup below is the final guard */ }
        removeSandboxRoot(root);
        throw error;
      }
    },
    prepareArchive: async (source, policy) => {
      const sandbox = requireSandbox(policy.sandbox, parentRoot);
      throwIfAborted(policy.signal);
      return prepareArchive(source, {
        stagingRoot: path.join(sandbox.root, "staging"),
        validateVoiceBackup: sandbox.store.validateVoiceBackup,
        validateTimeCalibrationBackup: sandbox.store.validateTimeCalibrationBackup,
        validateOralHistoryBackup: sandbox.store.validateOralHistoryBackup,
        validateCuratorAgentBackup: sandbox.store.validateCuratorAgentBackup,
        validateMemoryInboxBackup: sandbox.store.validateMemoryInboxBackup,
        validateProvenanceBackup: sandbox.store.validateProvenanceBackup,
        validateCoMemoryResponseBackup: sandbox.store.validateCoMemoryResponseBackup,
        supportedSchemaVersion: schemaVersion,
        signal: policy.signal,
        limits: policy.limits
      });
    },
    restoreArchive: ({ sandbox: input, prepared, signal }) => {
      const sandbox = requireSandbox(input, parentRoot);
      throwIfAborted(signal);
      const store = sandbox.store;
      const restored = restoreArchive({
        prepared,
        store,
        storage: sandbox.storage,
        voiceStorage: sandbox.voiceStorage,
        normalizeMemory,
        validateArchaeologyBackup,
        restoreArchaeologyBackup,
        validateExhibitionBackup: store.validateExhibitionBackup,
        restoreExhibitionBackup: store.restoreExhibitionBackup,
        validateRevisitBackup: store.validateRevisitBackup,
        restoreRevisitBackup: store.restoreRevisitBackup,
        validateRevisitIntentBackup: store.validateRevisitIntentBackup,
        restoreRevisitIntentBackup: store.restoreRevisitIntentBackup,
        validateEntityBackup: store.validateClueBackup,
        restoreEntityBackup: store.restoreClueBackup,
        validateVoiceBackup: store.validateVoiceBackup,
        restoreVoiceBackup: store.restoreVoiceBackup,
        validateCapsuleBackup: store.validateCapsuleBackup,
        restoreCapsuleBackup: store.restoreCapsuleBackup,
        validateRevisionBackup: store.validateRevisionBackup,
        restoreRevisionBackup: store.restoreRevisionBackup,
        validateTimeCalibrationBackup: store.validateTimeCalibrationBackup,
        restoreTimeCalibrationBackup: store.restoreTimeCalibrationBackup,
        validateOralHistoryBackup: store.validateOralHistoryBackup,
        restoreOralHistoryBackup: store.restoreOralHistoryBackup,
        validateCuratorAgentBackup: store.validateCuratorAgentBackup,
        restoreCuratorAgentBackup: store.restoreCuratorAgentBackup,
        validateMemoryInboxBackup: store.validateMemoryInboxBackup,
        restoreMemoryInboxBackup: store.restoreMemoryInboxBackup,
        validateProvenanceBackup: store.validateProvenanceBackup,
        restoreProvenanceBackup: store.restoreProvenanceBackup,
        validateCoMemoryResponseBackup: store.validateCoMemoryResponseBackup,
        restoreCoMemoryResponseBackup: store.restoreCoMemoryResponseBackup,
        createId,
        signal
      });
      throwIfAborted(signal);
      return restored;
    },
    verifySandbox: async ({ sandbox: input, prepared, evidence, restored, signal, budget }) => {
      const sandbox = requireSandbox(input, parentRoot);
      throwIfAborted(signal);
      const health = sandbox.store.runDatabaseHealthChecks();
      const requiredChecks = new Map(
        (Array.isArray(health?.checks) ? health.checks : []).map((check) => [String(check?.code || ""), check?.ok === true])
      );
      if (health?.ok !== true || [...REQUIRED_DATABASE_CHECKS].some((code) => requiredChecks.get(code) !== true)) {
        throw runtimeError(
          "The restored database did not pass schema, FTS, foreign-key and integrity checks.",
          "ISOLATED_RECOVERY_DATABASE_CHECK_FAILED",
          422
        );
      }
      const expectedDatabase = preparedDatabaseCounts(prepared);
      const actualDatabase = readRestoredDatabaseCounts(sandbox.dbPath);
      assertCountMap(expectedDatabase, actualDatabase, "ISOLATED_RECOVERY_REFERENCE_CHECK_FAILED");
      assertRestoreResultCounts(expectedDatabase, restored);

      const mediaAssets = listAllMediaAssets(sandbox.store, budget.maxMediaAssets);
      if (mediaAssets.length !== evidence.assetCount || Number(health.counts?.mediaAssets) !== mediaAssets.length) {
        throw runtimeError("Restored media counts are inconsistent.", "ISOLATED_RECOVERY_MEDIA_CHECK_FAILED", 422);
      }
      let mediaVariants = 0;
      for (const asset of mediaAssets) {
        if (!Array.isArray(asset.variants) || asset.variants.length === 0) {
          throw runtimeError("A restored media asset has no variants.", "ISOLATED_RECOVERY_MEDIA_CHECK_FAILED", 422);
        }
        for (const variant of asset.variants) {
          throwIfAborted(signal);
          if (await sandbox.storage.verifyVariant(variant, { signal }) !== true) {
            throw runtimeError("A restored media variant failed hash or format verification.", "ISOLATED_RECOVERY_MEDIA_CHECK_FAILED", 422);
          }
          mediaVariants += 1;
        }
      }
      if (mediaVariants !== actualDatabase.mediaVariants) {
        throw runtimeError("Restored media variant counts are inconsistent.", "ISOLATED_RECOVERY_MEDIA_CHECK_FAILED", 422);
      }

      const voiceAssets = listAllVoiceAssets(sandbox.store, budget.maxMediaAssets);
      const expectedVoiceAssets = prepared.collection?.voices?.mode === "full" && Array.isArray(prepared.collection.voices.assets)
        ? prepared.collection.voices.assets.length
        : 0;
      if (voiceAssets.length !== expectedVoiceAssets || Number(health.counts?.voiceAssets) !== voiceAssets.length) {
        throw runtimeError("Restored voice counts are inconsistent.", "ISOLATED_RECOVERY_VOICE_CHECK_FAILED", 422);
      }
      for (const asset of voiceAssets) {
        throwIfAborted(signal);
        if (await sandbox.voiceStorage.verify(asset, { signal }) !== true) {
          throw runtimeError("A restored voice file failed hash or format verification.", "ISOLATED_RECOVERY_VOICE_CHECK_FAILED", 422);
        }
      }

      if (Number(health.counts?.memories) !== Number(restored?.imported) || Number(restored?.imported) !== evidence.memoryCount) {
        throw runtimeError("Restored memory counts are inconsistent.", "ISOLATED_RECOVERY_REFERENCE_CHECK_FAILED", 422);
      }
      const databaseChecks = health.checks.length;
      const attention = (Array.isArray(health.issueCounts) ? health.issueCounts : [])
        .reduce((sum, item) => safeAdd(sum, Number(item?.count) || 0), 0);
      const counts = safeCounts(health.counts, restored, mediaVariants, actualDatabase);
      return {
        targetSchemaVersion: schemaVersion,
        counts,
        database: { status: "passed", passed: databaseChecks, total: databaseChecks, attention },
        references: {
          status: "passed",
          edgesChecked: restoredReferenceEdges(actualDatabase)
        },
        media: { status: "passed", assetsVerified: mediaAssets.length, variantsVerified: mediaVariants },
        voice: { status: "passed", assetsVerified: voiceAssets.length, filesVerified: voiceAssets.length }
      };
    },
    destroySandbox: async ({ sandbox: input }) => {
      const sandbox = requireSandbox(input, parentRoot, { allowClosed: true });
      let closeError = null;
      if (!sandbox.closed) {
        try {
          sandbox.store.close();
          sandbox.closed = true;
        }
        catch (error) { closeError = error; }
      }
      let removeError = null;
      try { removeSandboxRoot(sandbox.root); }
      catch (error) { removeError = error; }
      const destroyed = !fs.existsSync(sandbox.root);
      try { fs.rmdirSync(parentRoot); } catch { /* keep while another process or stale run exists */ }
      if (closeError || removeError || !destroyed) {
        throw runtimeError(
          "The single-use recovery copy could not be closed and removed.",
          "ISOLATED_RECOVERY_CLEANUP_FAILED",
          500,
          removeError || closeError
        );
      }
      return { destroyed: true };
    }
  });
}

function preparedDatabaseCounts(prepared) {
  const collection = prepared?.collection || {};
  const archaeology = fullSection(collection.archaeology);
  const exhibitions = records(collection.exhibitions, "exhibitions");
  const revisits = records(collection.revisits, "states");
  const revisitIntents = records(collection.revisitIntents, "intents");
  const entities = records(collection.entities, "entities");
  const voices = fullSection(collection.voices);
  const capsules = records(collection.capsules, "capsules");
  const revisions = records(collection.revisions, "revisions");
  const timeCalibrations = records(collection.timeCalibrations, "calibrations");
  const oralQuestions = records(collection.oralHistories, "questions");
  const oralAnswers = records(collection.oralHistories, "answers");
  const curatorRuns = records(collection.curatorAgent, "runs");
  const inboxSources = records(collection.memoryInbox, "sources");
  const inboxItems = records(collection.memoryInbox, "items");
  const provenanceClaims = records(collection.provenance, "claims");
  const provenanceSources = records(collection.provenance, "sources");
  const provenanceEvents = records(collection.provenance, "events");
  const coMemoryResponses = records(collection.coMemoryResponses, "responses");
  const mediaObservations = Array.isArray(prepared?.mediaObservations)
    ? prepared.mediaObservations
    : Array.isArray(prepared?.media_observations) ? prepared.media_observations : [];
  return {
    memories: arrayLength(collection.memories),
    memoryPeople: sum(collection.memories, (memory) => arrayLength(memory?.people)),
    memoryTags: sum(collection.memories, (memory) => arrayLength(memory?.tags)),
    memoryEmotions: sum(collection.memories, (memory) => arrayLength(memory?.emotions)),
    archaeologyEvents: arrayLength(archaeology.events),
    archaeologyMembers: sum(archaeology.events, (event) => arrayLength(event?.members)),
    archaeologyClaims: arrayLength(archaeology.claims),
    archaeologyDecisions: arrayLength(archaeology.pairDecisions),
    archaeologyQuestions: arrayLength(archaeology.questions),
    mediaAssets: arrayLength(prepared?.assets),
    mediaVariants: sum(prepared?.assets, (asset) => arrayLength(asset?.variants)),
    memoryMediaLinks: arrayLength(prepared?.links),
    mediaObservations: arrayLength(mediaObservations),
    voiceAssets: arrayLength(voices.assets),
    memoryVoiceLinks: arrayLength(voices.memoryLinks),
    voiceTranscripts: arrayLength(voices.transcripts),
    exhibitions: exhibitions.length,
    exhibitionSections: sum(exhibitions, (entry) => arrayLength(entry?.sections)),
    exhibitionItems: sum(exhibitions, (entry) => sum(entry?.sections, (section) => arrayLength(section?.items))),
    exhibitionCitations: sum(exhibitions, (entry) => sum(entry?.sections, (section) => (
      sum(section?.items, (item) => arrayLength(item?.citations))
    ))),
    revisitStates: revisits.length,
    revisitIntents: revisitIntents.length,
    entities: entities.length,
    entityAliases: sum(entities, (entity) => arrayLength(entity?.aliases)),
    entityMemoryLinks: sum(entities, (entity) => arrayLength(entity?.memoryLinks)),
    capsules: capsules.length,
    capsuleMediaLinks: sum(capsules, (capsule) => arrayLength(capsule?.mediaLinks)),
    revisions: revisions.length,
    timeCalibrations: timeCalibrations.length,
    oralHistoryQuestions: oralQuestions.length,
    oralHistoryAnswers: oralAnswers.length,
    curatorAgentRuns: curatorRuns.length,
    curatorAgentSteps: sum(curatorRuns, (entry) => arrayLength(entry?.steps)),
    curatorAgentProposals: sum(curatorRuns, (entry) => entry?.proposal ? 1 : 0),
    curatorAgentDecisions: sum(curatorRuns, (entry) => arrayLength(entry?.decisions)),
    memoryInboxSources: inboxSources.length,
    memoryInboxItems: inboxItems.length,
    provenanceClaims: provenanceClaims.length,
    provenanceSources: provenanceSources.length,
    provenanceEvents: provenanceEvents.length,
    coMemoryResponses: coMemoryResponses.length
  };
}

function readRestoredDatabaseCounts(dbPath) {
  let db;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    db.exec("PRAGMA query_only = ON;");
    return Object.fromEntries(Object.entries(RESTORE_COUNT_TABLES).map(([key, table]) => [
      key,
      count(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count)
    ]));
  } catch (cause) {
    throw runtimeError(
      "The restored database could not be independently counted.",
      "ISOLATED_RECOVERY_DATABASE_CHECK_FAILED",
      422,
      cause
    );
  } finally {
    try { db?.close(); } catch { /* the main sandbox close remains the final guard */ }
  }
}

function assertCountMap(expected, actual, code) {
  for (const key of Object.keys(RESTORE_COUNT_TABLES)) {
    if (count(actual[key]) !== count(expected[key])) {
      throw runtimeError(
        `Restored ${key} count is incomplete (expected ${count(expected[key])}, got ${count(actual[key])}).`,
        code,
        422
      );
    }
  }
}

function assertRestoreResultCounts(expected, restored) {
  const resultCounts = {
    memories: restored?.imported,
    archaeologyEvents: restored?.archaeology?.events,
    archaeologyClaims: restored?.archaeology?.claims,
    archaeologyDecisions: restored?.archaeology?.decisions,
    archaeologyQuestions: restored?.archaeology?.questions,
    mediaAssets: safeAdd(restored?.media?.assetsCreated || 0, restored?.media?.assetsReused || 0),
    memoryMediaLinks: restored?.media?.links,
    mediaObservations: restored?.media?.observations,
    voiceAssets: safeAdd(restored?.voices?.assets || 0, restored?.voices?.assetsReused || 0),
    memoryVoiceLinks: restored?.voices?.memoryLinks,
    voiceTranscripts: restored?.voices?.transcripts,
    exhibitions: restored?.exhibitions?.exhibitions,
    revisitStates: restored?.revisits?.states,
    revisitIntents: restored?.revisitIntents?.intents,
    entities: restored?.entities?.entities,
    entityAliases: restored?.entities?.aliases,
    entityMemoryLinks: restored?.entities?.memoryLinks,
    capsules: restored?.capsules?.capsules,
    capsuleMediaLinks: restored?.capsules?.mediaLinks,
    revisions: restored?.revisions?.revisions,
    timeCalibrations: restored?.timeCalibrations?.calibrations,
    oralHistoryQuestions: restored?.oralHistories?.questions,
    oralHistoryAnswers: restored?.oralHistories?.answers,
    curatorAgentRuns: restored?.curatorAgent?.restoredRuns,
    memoryInboxSources: restored?.memoryInbox?.sources,
    memoryInboxItems: restored?.memoryInbox?.items,
    provenanceClaims: restored?.provenance?.claims,
    provenanceSources: restored?.provenance?.sources,
    provenanceEvents: restored?.provenance?.events,
    coMemoryResponses: restored?.coMemoryResponses?.responses
  };
  for (const [key, value] of Object.entries(resultCounts)) {
    if (count(value) !== count(expected[key])) {
      throw runtimeError(`Restore result ${key} count is inconsistent.`, "ISOLATED_RECOVERY_REFERENCE_CHECK_FAILED", 422);
    }
  }
}

function restoredReferenceEdges(actual) {
  return [
    "memoryPeople", "memoryTags", "memoryEmotions", "archaeologyMembers", "memoryMediaLinks",
    "mediaObservations", "memoryVoiceLinks", "voiceTranscripts",
    "exhibitionItems", "exhibitionCitations", "entityMemoryLinks", "capsuleMediaLinks", "oralHistoryAnswers",
    "curatorAgentSteps", "curatorAgentProposals", "curatorAgentDecisions", "provenanceSources", "provenanceEvents"
  ].reduce((total, key) => safeAdd(total, actual[key]), 0);
}

function fullSection(value) {
  return value?.mode === "full" && value && typeof value === "object" ? value : {};
}

function records(section, key) {
  const value = fullSection(section)[key];
  return Array.isArray(value) ? value : [];
}

function arrayLength(value) {
  return Array.isArray(value) ? value.length : 0;
}

function sum(value, selector) {
  return (Array.isArray(value) ? value : []).reduce((total, item) => safeAdd(total, selector(item)), 0);
}

function safeCounts(healthCounts = {}, restored = {}, mediaVariants, actual = {}) {
  return {
    memories: count(actual.memories),
    mediaAssets: count(actual.mediaAssets),
    mediaVariants: count(mediaVariants),
    voiceAssets: count(actual.voiceAssets),
    exhibitions: count(actual.exhibitions),
    capsules: count(actual.capsules),
    entities: count(actual.entities),
    revisions: count(actual.revisions),
    timeCalibrations: count(actual.timeCalibrations),
    oralHistoryQuestions: count(actual.oralHistoryQuestions),
    oralHistoryAnswers: count(actual.oralHistoryAnswers),
    curatorAgentRuns: count(actual.curatorAgentRuns),
    memoryInboxItems: count(actual.memoryInboxItems),
    provenanceClaims: count(actual.provenanceClaims),
    coMemoryResponses: count(actual.coMemoryResponses),
    revisitIntents: count(actual.revisitIntents)
  };
}

function listAllMediaAssets(store, maximum) {
  const result = [];
  for (let offset = 0; offset < maximum;) {
    const batch = store.listMediaAssets({ limit: Math.min(500, maximum - offset), offset });
    result.push(...batch);
    if (batch.length < Math.min(500, maximum - offset)) return result;
    offset += batch.length;
  }
  if (store.listMediaAssets({ limit: 1, offset: maximum }).length) {
    throw runtimeError("Restored media count exceeds its safety budget.", "ISOLATED_RECOVERY_BUDGET_EXCEEDED", 413);
  }
  return result;
}

function listAllVoiceAssets(store, maximum) {
  const result = [];
  for (let offset = 0; offset < maximum;) {
    const limit = Math.min(500, maximum - offset);
    const batch = store.listVoiceAssets({ limit, offset });
    result.push(...batch);
    if (batch.length < limit) return result;
    offset += batch.length;
  }
  if (store.listVoiceAssets({ limit: 1, offset: maximum }).length) {
    throw runtimeError("Restored voice count exceeds its safety budget.", "ISOLATED_RECOVERY_BUDGET_EXCEEDED", 413);
  }
  return result;
}

function cleanupStaleRecoverySandboxes(options = {}) {
  const parentRoot = requireAbsolutePath(options.parentRoot, "parentRoot");
  const minimumAgeMs = requireNonNegativeInteger(options.minimumAgeMs ?? DEFAULT_STALE_AGE_MS, "minimumAgeMs");
  const now = requireNonNegativeInteger(options.now ?? Date.now(), "now");
  const result = { removed: [], skipped: [] };
  if (!fs.existsSync(parentRoot)) return result;
  const parentStat = fs.lstatSync(parentRoot);
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
    result.skipped.push({ name: "", reason: "unsafe-parent" });
    return result;
  }
  for (const name of fs.readdirSync(parentRoot)) {
    if (!/^recovery-[A-Za-z0-9_-]{1,160}$/u.test(name)) continue;
    const target = path.resolve(parentRoot, name);
    try {
      ensureWithin(parentRoot, target, "stale sandbox");
      const stat = fs.lstatSync(target);
      if (now - stat.mtimeMs < minimumAgeMs) continue;
      if (stat.isSymbolicLink()) fs.unlinkSync(target);
      else fs.rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
      if (fs.existsSync(target)) throw new Error("path remains");
      result.removed.push(name);
    } catch (error) {
      result.skipped.push({ name, reason: String(error?.code || "remove-failed") });
    }
  }
  try { fs.rmdirSync(parentRoot); } catch { /* keep non-empty parent */ }
  return result;
}

function requireSandbox(value, parentRoot, options = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value) || (value.closed === true && options.allowClosed !== true) ||
      typeof value.root !== "string" || !value.store || !value.storage || !value.voiceStorage) {
    throw runtimeError("Isolated recovery sandbox is invalid.", "ISOLATED_RECOVERY_SANDBOX_INVALID", 500);
  }
  ensureWithin(parentRoot, value.root, "sandbox root");
  return value;
}

function removeSandboxRoot(root) {
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  if (fs.existsSync(root)) {
    throw runtimeError("Sandbox path remains after cleanup.", "ISOLATED_RECOVERY_CLEANUP_FAILED", 500);
  }
}

function ensureRealDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw runtimeError("Recovery sandbox parent is unsafe.", "ISOLATED_RECOVERY_SANDBOX_INVALID", 500);
  }
}

function ensureWithin(parent, target, name) {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw runtimeError(`${name} escapes its temporary parent.`, "ISOLATED_RECOVERY_PATH_INVALID", 500);
  }
}

function normalizeHalls(value) {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError("halls must be a non-empty array.");
  return Object.freeze(value.map((hall, index) => {
    if (!hall || typeof hall !== "object" || Array.isArray(hall) || typeof hall.id !== "string" || !hall.id ||
        typeof hall.name !== "string" || typeof hall.description !== "string") {
      throw new TypeError(`halls[${index}] is invalid.`);
    }
    return Object.freeze({ id: hall.id, name: hall.name, description: hall.description });
  }));
}

function count(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw runtimeError("Recovery count is invalid.", "ISOLATED_RECOVERY_VERIFICATION_INVALID", 500);
  }
  return number;
}

function safeAdd(left, right) {
  const value = Number(left) + Number(right);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw runtimeError("Recovery count overflowed.", "ISOLATED_RECOVERY_VERIFICATION_INVALID", 500);
  }
  return value;
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  if (typeof signal.throwIfAborted === "function") signal.throwIfAborted();
  const error = new Error("Isolated recovery rehearsal was aborted.");
  error.name = "AbortError";
  throw error;
}

function requireFunction(value, name) {
  if (typeof value !== "function") throw new TypeError(`${name} must be a function.`);
  return value;
}

function requireAbsolutePath(value, name) {
  if (typeof value !== "string" || !path.isAbsolute(value)) throw new TypeError(`${name} must be an absolute path.`);
  return path.resolve(value);
}

function requirePositiveInteger(value, name) {
  if (!Number.isSafeInteger(Number(value)) || Number(value) < 1) throw new TypeError(`${name} must be a positive integer.`);
  return Number(value);
}

function requireNonNegativeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${name} must be a non-negative integer.`);
  return value;
}

function assertPlainObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${name} must be a plain object.`);
  }
}

function assertKnownKeys(value, allowed, name) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) throw new TypeError(`${name} contains unsupported fields: ${unknown.join(", ")}.`);
}

function runtimeError(message, code, statusCode, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

module.exports = {
  createIsolatedRecoveryRuntime,
  cleanupStaleRecoverySandboxes,
  SANDBOX_PARENT_NAME,
  SANDBOX_PREFIX,
  DEFAULT_STALE_AGE_MS
};
