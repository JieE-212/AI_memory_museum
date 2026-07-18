"use strict";

const { randomUUID } = require("node:crypto");
const { applyMigrations } = require("./migrations");
const {
  TIME_CALIBRATION_SCHEMA_VERSION,
  buildSourceSetSha256,
  buildStableSourceKey,
  buildTimeCandidates,
  compareIntervals,
  normalizeCalibrationResolution,
  validateSelectedSourceKeys
} = require("./time-calibration-service");

const ID_PATTERN = /^[a-zA-Z0-9_-]{1,120}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const SOURCE_KEY_PATTERN = /^time-source:[a-f0-9]{64}$/u;
const SOURCE_TYPES = new Set(["memory-current", "revision", "raw-claim", "exif", "oral-history"]);
const SOURCE_PRECISIONS = new Set(["year", "month", "day", "range"]);
const MAX_RELATED_MEMORIES = 500;
const MAX_TIME_CALIBRATIONS = 500;
const TIME_CALIBRATION_REDACTED_NOTE =
  "时间范围、来源、备注、精确时间、内部 ID 与校准哈希已物理移除。";
const FULL_BACKUP_KEYS = Object.freeze(["calibrations", "mode", "schemaVersion"]);
const REDACTED_BACKUP_KEYS = Object.freeze([
  "alternativesCount", "calibrationCount", "mode", "note", "uncertainCount"
]);
const BACKUP_CALIBRATION_KEYS = Object.freeze([
  "createdAt", "currentSourceSetSha256", "eventId", "id", "intervalEnd", "intervalStart",
  "memoryId", "note", "resolutionKind", "selectedSourceKeys",
  "selectedSourceSnapshots", "sourceSetSha256", "updatedAt"
]);
const SOURCE_SNAPSHOT_KEYS = Object.freeze([
  "intervalEnd", "intervalStart", "precision", "sourceKey", "sourceType"
]);

const TIME_CALIBRATION_MIGRATION = Object.freeze({
  version: TIME_CALIBRATION_SCHEMA_VERSION,
  name: "uncertain-timeline-calibrations",
  up(db) {
    db.exec(`
      CREATE TABLE time_calibrations (
        id TEXT PRIMARY KEY,
        memory_id TEXT,
        event_id TEXT,
        resolution_kind TEXT NOT NULL
          CHECK (resolution_kind IN ('year', 'month', 'day', 'range', 'alternatives', 'uncertain')),
        interval_start TEXT NOT NULL DEFAULT '',
        interval_end TEXT NOT NULL DEFAULT '',
        selected_source_keys_json TEXT NOT NULL DEFAULT '[]',
        selected_source_snapshots_json TEXT NOT NULL DEFAULT '[]'
          CHECK (
            json_valid(selected_source_snapshots_json)
            AND json_type(selected_source_snapshots_json) = 'array'
          ),
        source_set_sha256 TEXT NOT NULL CHECK (
          length(source_set_sha256) = 64
          AND source_set_sha256 NOT GLOB '*[^0-9a-f]*'
        ),
        note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 500),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,

        CHECK (
          (memory_id IS NOT NULL AND event_id IS NULL) OR
          (memory_id IS NULL AND event_id IS NOT NULL)
        ),
        CHECK (
          (resolution_kind IN ('alternatives', 'uncertain') AND interval_start = '' AND interval_end = '') OR
          (resolution_kind NOT IN ('alternatives', 'uncertain') AND interval_start <> '' AND interval_end <> '')
        ),

        UNIQUE (memory_id),
        UNIQUE (event_id),
        FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE,
        FOREIGN KEY (event_id) REFERENCES memory_events(id) ON DELETE CASCADE
      );

      CREATE INDEX idx_time_calibrations_memory
        ON time_calibrations(memory_id);
      CREATE INDEX idx_time_calibrations_event
        ON time_calibrations(event_id);
      CREATE INDEX idx_time_calibrations_updated
        ON time_calibrations(updated_at DESC, id);
    `);
  }
});

function initializeTimeCalibrationDatabase(options = {}) {
  const db = requireDatabase(options.db);
  const suppliedTransaction = typeof options.withTransaction === "function" ? options.withTransaction : null;
  const now = typeof options.now === "function" ? options.now : () => new Date().toISOString();
  const createId = typeof options.createId === "function"
    ? options.createId
    : (prefix) => `${prefix}-${randomUUID()}`;
  const listOralHistoryEvidence = typeof options.listOralHistoryEvidence === "function"
    ? options.listOralHistoryEvidence
    : () => [];

  if (options.applyMigrations !== false) {
    const supportedVersion = Math.max(
      TIME_CALIBRATION_SCHEMA_VERSION,
      Number(options.schemaVersion) || TIME_CALIBRATION_SCHEMA_VERSION
    );
    applyMigrations({
      db,
      baselineVersion: 4,
      migrations: [TIME_CALIBRATION_MIGRATION],
      supportedVersion,
      now
    });
  }

  const statements = prepareStatements(db);

  function runAtomic(operation) {
    if (suppliedTransaction) return suppliedTransaction(operation);
    const savepoint = `time_calibration_write_${randomUUID().replace(/-/gu, "")}`;
    db.exec(`SAVEPOINT ${savepoint}`);
    try {
      const result = operation();
      if (result && typeof result.then === "function") {
        throw new TypeError("Time calibration transactions must be synchronous.");
      }
      db.exec(`RELEASE SAVEPOINT ${savepoint}`);
      return result;
    } catch (error) {
      try { db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`); } catch { /* preserve original error */ }
      try { db.exec(`RELEASE SAVEPOINT ${savepoint}`); } catch { /* preserve original error */ }
      throw error;
    }
  }

  function getTimeCalibrationForMemory(memoryId) {
    const row = statements.getForMemory.get(requireId(memoryId, "memoryId"));
    return row ? rowToCalibration(row) : null;
  }

  function getTimeCalibrationForEvent(eventId) {
    const row = statements.getForEvent.get(requireId(eventId, "eventId"));
    return row ? rowToCalibration(row) : null;
  }

  function getMemoryCalibrationWorkspace(memoryId) {
    const id = requireId(memoryId, "memoryId");
    const memory = statements.getMemory.get(id);
    if (!memory) throw targetNotFound("memory");
    const relatedMemoryIds = collectRelatedMemoryIds([id]);
    const evidence = collectEvidence(relatedMemoryIds);
    const candidates = buildTimeCandidates(evidence);
    const sourceSetSha256 = buildSourceSetSha256(candidates);
    const calibration = getTimeCalibrationForMemory(id);
    return {
      target: {
        type: "memory",
        id,
        title: String(memory.title || ""),
        date: String(memory.memory_date || ""),
        evidenceMemoryCount: relatedMemoryIds.length
      },
      calibration,
      candidates,
      sourceSetSha256,
      needsReview: Boolean(calibration && calibration.sourceSetSha256 !== sourceSetSha256)
    };
  }

  function getEventCalibrationWorkspace(eventId) {
    const id = requireId(eventId, "eventId");
    const event = statements.getEvent.get(id);
    if (!event) throw targetNotFound("event");
    const memberRows = event.status === "confirmed" ? statements.confirmedMembersForEvent.all(id) : [];
    const seedIds = memberRows.map((row) => row.memory_id);
    const relatedMemoryIds = collectRelatedMemoryIds(seedIds);
    const evidence = collectEvidence(relatedMemoryIds);
    const candidates = buildTimeCandidates(evidence);
    const sourceSetSha256 = buildSourceSetSha256(candidates);
    const calibration = getTimeCalibrationForEvent(id);
    return {
      target: {
        type: "event",
        id,
        title: String(event.title || ""),
        status: String(event.status || ""),
        memberCount: memberRows.length,
        evidenceMemoryCount: relatedMemoryIds.length
      },
      calibration,
      candidates,
      sourceSetSha256,
      needsReview: Boolean(calibration && calibration.sourceSetSha256 !== sourceSetSha256)
    };
  }

  function saveMemoryTimeCalibration(memoryId, input = {}, saveOptions = {}) {
    const id = requireId(memoryId, "memoryId");
    return saveCalibration("memory", id, input, saveOptions);
  }

  function saveEventTimeCalibration(eventId, input = {}, saveOptions = {}) {
    const id = requireId(eventId, "eventId");
    return saveCalibration("event", id, input, saveOptions);
  }

  function saveCalibration(targetType, targetId, input, saveOptions) {
    assertPlainObject(input, "time calibration");
    assertPlainObject(saveOptions, "time calibration save options");
    return runAtomic(() => {
      const workspace = targetType === "memory"
        ? getMemoryCalibrationWorkspace(targetId)
        : getEventCalibrationWorkspace(targetId);
      const existing = workspace.calibration;
      requireExpectedVersion(existing, saveOptions);
      const suppliedSourceSet = requireSha256(input.sourceSetSha256, "sourceSetSha256");
      if (suppliedSourceSet !== workspace.sourceSetSha256) throw sourcesChanged();

      const resolution = normalizeCalibrationResolution(input);
      const selectedSourceKeys = validateSelectedSourceKeys(input.selectedSourceKeys, workspace.candidates);
      const selectedCandidates = selectedSourceKeys.map((sourceKey) => (
        workspace.candidates.find((candidate) => candidate.sourceKey === sourceKey)
      ));
      if (resolution.resolutionKind === "alternatives" && selectedSourceKeys.length < 2) {
        throw calibrationError(
          "Alternative placement requires at least two confirmed source choices.",
          "CALIBRATION_ALTERNATIVES_SOURCES_REQUIRED"
        );
      }
      if (resolution.resolutionKind === "alternatives" && !hasDisjointSourcePair(selectedCandidates)) {
        throw calibrationError(
          "Alternative placement requires at least two conflicting time sources.",
          "CALIBRATION_ALTERNATIVES_CONFLICT_REQUIRED"
        );
      }
      if (!["alternatives", "uncertain"].includes(resolution.resolutionKind) && selectedSourceKeys.length < 1) {
        throw calibrationError(
          "A dated placement requires at least one confirmed source choice.",
          "CALIBRATION_SOURCES_REQUIRED"
        );
      }
      if (!["alternatives", "uncertain"].includes(resolution.resolutionKind) &&
          selectedCandidates.some((candidate) => compareIntervals(resolution, candidate) !== "compatible")) {
        throw calibrationError(
          "The confirmed placement must overlap every selected time source.",
          "CALIBRATION_INTERVAL_UNSUPPORTED"
        );
      }
      const selectedSourceSnapshots = selectedCandidates.map(sourceSnapshot).sort(compareSourceSnapshots);
      const note = normalizeNote(input.note);
      const normalized = {
        resolutionKind: resolution.resolutionKind,
        intervalStart: resolution.intervalStart,
        intervalEnd: resolution.intervalEnd,
        selectedSourceKeys,
        selectedSourceSnapshots,
        sourceSetSha256: suppliedSourceSet,
        note
      };
      if (existing && sameCalibration(existing, normalized)) return existing;

      const timestamp = monotonicTimestamp(requireTimestamp(now(), "now"), existing?.updatedAt || "");
      const calibrationId = existing?.id || requireId(createId("time-calibration"), "generated calibration id");
      const args = [
        calibrationId,
        targetId,
        normalized.resolutionKind,
        normalized.intervalStart,
        normalized.intervalEnd,
        JSON.stringify(normalized.selectedSourceKeys),
        JSON.stringify(normalized.selectedSourceSnapshots),
        normalized.sourceSetSha256,
        normalized.note,
        existing?.createdAt || timestamp,
        timestamp
      ];
      if (targetType === "memory") statements.upsertMemory.run(...args);
      else statements.upsertEvent.run(...args);
      return targetType === "memory"
        ? getTimeCalibrationForMemory(targetId)
        : getTimeCalibrationForEvent(targetId);
    });
  }

  function deleteMemoryTimeCalibration(memoryId, deleteOptions = {}) {
    return deleteCalibration("memory", requireId(memoryId, "memoryId"), deleteOptions);
  }

  function deleteEventTimeCalibration(eventId, deleteOptions = {}) {
    return deleteCalibration("event", requireId(eventId, "eventId"), deleteOptions);
  }

  function deleteCalibration(targetType, targetId, deleteOptions) {
    assertPlainObject(deleteOptions, "time calibration delete options");
    return runAtomic(() => {
      if (targetType === "memory" && !statements.getMemory.get(targetId)) throw targetNotFound("memory");
      if (targetType === "event" && !statements.getEvent.get(targetId)) throw targetNotFound("event");
      const existing = targetType === "memory"
        ? getTimeCalibrationForMemory(targetId)
        : getTimeCalibrationForEvent(targetId);
      requireExpectedVersion(existing, deleteOptions);
      if (!existing) return null;
      if (targetType === "memory") statements.deleteForMemory.run(targetId);
      else statements.deleteForEvent.run(targetId);
      return existing;
    });
  }

  function listTimelineEntries(listOptions = {}) {
    assertPlainObject(listOptions, "timeline options");
    const order = listOptions.order === undefined ? "asc" : String(listOptions.order).toLowerCase();
    if (order !== "asc" && order !== "desc") {
      throw calibrationError("Timeline order must be asc or desc.", "CALIBRATION_TIMELINE_OPTIONS_INVALID");
    }
    const requestedLimit = listOptions.limit === undefined ? 200 : Number(listOptions.limit);
    if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 500) {
      throw calibrationError("Timeline limit must be an integer from 1 to 500.", "CALIBRATION_TIMELINE_OPTIONS_INVALID");
    }

    const eventRows = statements.listEventCalibrations.all();
    const calibratedEventIds = new Set(eventRows.map((row) => row.event_id));
    const storedMemberCounts = new Map();
    for (const row of statements.listMemberCalibrationGroups.all()) {
      storedMemberCounts.set(row.event_id, Number(row.calibration_count) || 0);
    }

    const entries = eventRows.map((row) => {
      const workspace = getEventCalibrationWorkspace(row.event_id);
      const memberIds = statements.confirmedMembersForEvent.all(row.event_id).map((member) => member.memory_id);
      return {
        target: {
          type: "event",
          id: row.event_id,
          title: String(row.event_title || ""),
          memberCount: Number(row.member_count) || 0,
          memberIds
        },
        calibration: workspace.calibration,
        needsReview: workspace.needsReview,
        eventCalibrationPrecedence: true,
        storedMemberCalibrationCount: storedMemberCounts.get(row.event_id) || 0
      };
    });

    for (const row of statements.listMemoryCalibrations.all()) {
      if (row.confirmed_event_id && calibratedEventIds.has(row.confirmed_event_id)) continue;
      const workspace = getMemoryCalibrationWorkspace(row.memory_id);
      entries.push({
        target: {
          type: "memory",
          id: row.memory_id,
          title: String(row.memory_title || ""),
          ...(row.confirmed_event_id ? {
            confirmedEvent: {
              id: row.confirmed_event_id,
              title: String(row.confirmed_event_title || "")
            }
          } : {})
        },
        calibration: workspace.calibration,
        needsReview: workspace.needsReview,
        eventCalibrationPrecedence: false,
        storedMemberCalibrationCount: 0
      });
    }

    entries.sort((left, right) => compareTimelineEntries(left, right, order));
    return entries.slice(0, requestedLimit);
  }

  function getTimeCalibrationStats() {
    const calibrations = statements.listAll.all().map(rowToCalibration);
    let needsReview = 0;
    for (const calibration of calibrations) {
      const workspace = calibration.targetType === "memory"
        ? getMemoryCalibrationWorkspace(calibration.memoryId)
        : getEventCalibrationWorkspace(calibration.eventId);
      if (workspace.needsReview) needsReview += 1;
    }
    return {
      calibrations: calibrations.length,
      needsReview,
      uncertain: calibrations.filter((item) => item.resolutionKind === "uncertain").length,
      alternatives: calibrations.filter((item) => item.resolutionKind === "alternatives").length
    };
  }

  function buildTimeCalibrationBackup(mode = "full", memoryIds) {
    const boundary = memoryIds === undefined ? null : normalizeIdBoundary(memoryIds, "memoryIds");
    const selectedRows = statements.listAll.all().filter((row) => {
      if (!boundary) return true;
      if (row.memory_id) return boundary.has(row.memory_id);
      const members = statements.allMembersForEvent.all(row.event_id).map((entry) => entry.memory_id);
      return members.length > 0 && members.every((memoryId) => boundary.has(memoryId));
    });
    if (mode === "redacted" || mode === "redacted-summary") {
      const summary = {
        alternativesCount: selectedRows.filter((row) => row.resolution_kind === "alternatives").length,
        calibrationCount: selectedRows.length,
        mode: "redacted-summary",
        note: TIME_CALIBRATION_REDACTED_NOTE,
        uncertainCount: selectedRows.filter((row) => row.resolution_kind === "uncertain").length
      };
      validateTimeCalibrationBackupPayload(summary, [], []);
      return summary;
    }
    if (mode !== "full") {
      throw calibrationError("Time calibration backup mode must be full or redacted.", "CALIBRATION_BACKUP_MODE_INVALID");
    }
    const backup = {
      mode: "full",
      schemaVersion: TIME_CALIBRATION_SCHEMA_VERSION,
      calibrations: selectedRows.map((row) => {
        const workspace = row.memory_id
          ? getMemoryCalibrationWorkspace(row.memory_id)
          : getEventCalibrationWorkspace(row.event_id);
        return rowToBackupCalibration(row, workspace.sourceSetSha256);
      }).sort(compareBackupCalibrations)
    };
    const sourceEventIds = backup.calibrations.map((item) => item.eventId).filter(Boolean);
    validateTimeCalibrationBackupPayload(backup, boundary ? [...boundary] : undefined, sourceEventIds);
    return backup;
  }

  function validateTimeCalibrationBackup(backup, sourceMemoryIds, sourceEventIds) {
    return validateTimeCalibrationBackupPayload(backup, sourceMemoryIds, sourceEventIds);
  }

  function restoreTimeCalibrationBackup(backup, restoreOptions = {}) {
    assertPlainObject(restoreOptions, "time calibration restore options");
    const memoryIdMap = normalizeIdMap(restoreOptions.memoryIdMap, "memoryIdMap");
    const eventIdMap = normalizeIdMap(restoreOptions.eventIdMap, "eventIdMap");
    const oralQuestionKeyMap = normalizeOralQuestionKeyMap(restoreOptions.oralQuestionKeyMap);
    const sourceMode = String(restoreOptions.sourceMode || "time-isle").trim();
    if (sourceMode !== "json" && sourceMode !== "time-isle") {
      throw calibrationError("sourceMode must be json or time-isle.", "CALIBRATION_RESTORE_OPTIONS_INVALID");
    }
    const sourceMemoryIds = backup?.mode === "full"
      ? backup.calibrations.map((item) => item.memoryId).filter(Boolean)
      : [];
    const sourceEventIds = backup?.mode === "full"
      ? backup.calibrations.map((item) => item.eventId).filter(Boolean)
      : [];
    validateTimeCalibrationBackupPayload(backup, sourceMemoryIds, sourceEventIds);
    if (backup.mode === "redacted-summary") {
      return {
        calibrations: 0,
        skipped: 0,
        summarized: true,
        requiresTimeIsle: false,
        note: TIME_CALIBRATION_REDACTED_NOTE,
        idMap: { calibrations: {} }
      };
    }

    return runAtomic(() => {
      let restored = 0;
      let skipped = 0;
      let requiresTimeIsle = false;
      const idMap = new Map();
      const claimedIds = new Set(statements.listAll.all().map((row) => row.id));
      for (const item of backup.calibrations) {
        const targetType = item.memoryId ? "memory" : "event";
        const mappedTargetId = targetType === "memory"
          ? memoryIdMap.get(item.memoryId)
          : eventIdMap.get(item.eventId);
        if (!mappedTargetId) {
          skipped += 1;
          continue;
        }

        let workspace;
        try {
          workspace = targetType === "memory"
            ? getMemoryCalibrationWorkspace(mappedTargetId)
            : getEventCalibrationWorkspace(mappedTargetId);
        } catch (error) {
          if (error?.code !== "CALIBRATION_TARGET_NOT_FOUND") throw error;
          skipped += 1;
          continue;
        }
        const restoreSources = buildRestoreSourceMapping(
          workspace.candidates,
          memoryIdMap,
          eventIdMap,
          oralQuestionKeyMap
        );
        const availableKeys = new Set(restoreSources.archiveKeys);
        const selectedSourceMissing = item.selectedSourceKeys.some((key) => !availableKeys.has(key));
        const currentSourcesMismatch = !restoreSources.complete ||
          restoreSources.archiveSourceSetSha256 !== item.currentSourceSetSha256;
        const wasAlreadyStaleAtExport = item.sourceSetSha256 !== item.currentSourceSetSha256;
        if (sourceMode === "time-isle") {
          if (currentSourcesMismatch || (selectedSourceMissing && !wasAlreadyStaleAtExport)) {
            throw calibrationError(
              "Restored time evidence does not match the archive source boundary.",
              "CALIBRATION_ARCHIVE_SOURCES_MISMATCH"
            );
          }
        } else if (selectedSourceMissing || currentSourcesMismatch) {
          requiresTimeIsle = true;
        }

        const mustRemainNeedsReview = wasAlreadyStaleAtExport ||
          (sourceMode === "json" && (selectedSourceMissing || currentSourcesMismatch));

        const restoredSelection = remapRestoredSelection(
          item.selectedSourceKeys,
          item.selectedSourceSnapshots,
          restoreSources.currentKeyByArchiveKey
        );
        const restoredSourceSetSha256 = selectRestoredSourceBoundary(
          item,
          workspace.sourceSetSha256,
          mustRemainNeedsReview
        );
        const existing = workspace.calibration;
        let targetCalibrationId = existing?.id || item.id;
        if (!existing && claimedIds.has(targetCalibrationId)) {
          targetCalibrationId = claimGeneratedId(createId, claimedIds);
        }
        claimedIds.add(targetCalibrationId);
        idMap.set(item.id, targetCalibrationId);
        const args = [
          targetCalibrationId,
          mappedTargetId,
          item.resolutionKind,
          item.intervalStart,
          item.intervalEnd,
          JSON.stringify(restoredSelection.selectedSourceKeys),
          JSON.stringify(restoredSelection.selectedSourceSnapshots),
          restoredSourceSetSha256,
          item.note,
          item.createdAt,
          item.updatedAt
        ];
        if (targetType === "memory") statements.restoreMemory.run(...args);
        else statements.restoreEvent.run(...args);
        restored += 1;
      }
      return {
        calibrations: restored,
        skipped,
        summarized: false,
        requiresTimeIsle,
        note: requiresTimeIsle
          ? "部分时间来源在 JSON 导入后需要重新核对；如需同时恢复媒体来源，请使用完整 .time-isle 归档。"
          : "",
        idMap: { calibrations: Object.fromEntries(idMap) }
      };
    });
  }

  function clearTimeCalibrations() {
    return runAtomic(() => ({ calibrationsDeleted: Number(statements.clear.run().changes) || 0 }));
  }

  function collectRelatedMemoryIds(seedIds) {
    const queue = [];
    const seen = new Set();
    for (const value of seedIds) {
      const id = requireId(value, "related memoryId");
      if (!seen.has(id)) {
        seen.add(id);
        queue.push(id);
      }
    }
    while (queue.length) {
      const memoryId = queue.shift();
      const related = [];
      const event = statements.confirmedEventForMemory.get(memoryId);
      if (event) related.push(...statements.confirmedMembersForEvent.all(event.event_id).map((row) => row.memory_id));
      for (const pair of statements.sameEventPairsForMemory.all(memoryId, memoryId)) {
        related.push(pair.memory_a_id === memoryId ? pair.memory_b_id : pair.memory_a_id);
      }
      for (const candidate of related) {
        if (seen.has(candidate)) continue;
        if (seen.size >= MAX_RELATED_MEMORIES) {
          throw calibrationError("Confirmed time-evidence boundary is too large.", "CALIBRATION_EVIDENCE_LIMIT", 409);
        }
        seen.add(candidate);
        queue.push(candidate);
      }
    }
    return [...seen].sort(compareText);
  }

  function collectEvidence(memoryIds) {
    if (!memoryIds.length) return { memories: [], revisions: [], claims: [], observations: [], oralHistories: [] };
    const placeholders = memoryIds.map(() => "?").join(", ");
    const memoryRows = db.prepare(`
      SELECT id, title, memory_date
      FROM memories
      WHERE id IN (${placeholders})
      ORDER BY id
    `).all(...memoryIds);
    const revisionRows = db.prepare(`
      SELECT revision.memory_id, revision.revision_no, revision.snapshot_json,
        revision.snapshot_sha256, memory.title AS memory_title
      FROM memory_revisions revision
      JOIN memories memory ON memory.id = revision.memory_id
      WHERE revision.memory_id IN (${placeholders})
      ORDER BY revision.memory_id, revision.revision_no
    `).all(...memoryIds);
    const latestSnapshotByMemory = new Map();
    const revisions = [];
    for (const row of revisionRows) {
      const snapshot = parseJsonObject(row.snapshot_json);
      if (!snapshot) continue;
      latestSnapshotByMemory.set(row.memory_id, row.snapshot_sha256);
      revisions.push({
        memoryId: row.memory_id,
        memoryTitle: row.memory_title,
        revisionNo: Number(row.revision_no),
        snapshotSha256: row.snapshot_sha256,
        snapshot
      });
    }
    const memories = memoryRows.map((row) => ({
      id: row.id,
      title: row.title,
      date: row.memory_date,
      snapshotSha256: latestSnapshotByMemory.get(row.id) || ""
    }));

    const claims = db.prepare(`
      SELECT claim.memory_id, claim.claim_key, claim.claim_type, claim.value_json,
        claim.quote_text, claim.start_offset, claim.end_offset, claim.evidence_valid,
        claim.status, memory.title AS memory_title, memory.raw_content
      FROM memory_claims claim
      JOIN memories memory ON memory.id = claim.memory_id
      WHERE claim.memory_id IN (${placeholders})
        AND claim.evidence_valid = 1
      ORDER BY claim.memory_id, claim.position, claim.id
    `).all(...memoryIds).map((row) => ({
      memoryId: row.memory_id,
      memoryTitle: row.memory_title,
      claimKey: row.claim_key,
      type: row.claim_type,
      value: parseJson(row.value_json),
      quote: row.quote_text,
      startOffset: row.start_offset === null ? null : Number(row.start_offset),
      endOffset: row.end_offset === null ? null : Number(row.end_offset),
      evidenceValid: Boolean(row.evidence_valid),
      status: row.status,
      rawContent: row.raw_content
    }));

    const observations = db.prepare(`
      SELECT link.memory_id, memory.title AS memory_title,
        asset.content_sha256 AS asset_content_sha256,
        observation.kind, observation.source, observation.status,
        observation.sensitive, observation.value_json
      FROM memory_media link
      JOIN memories memory ON memory.id = link.memory_id
      JOIN media_assets asset ON asset.id = link.asset_id
      JOIN media_observations observation ON observation.asset_id = asset.id
      WHERE link.memory_id IN (${placeholders})
        AND observation.kind = 'captured_at'
        AND observation.source = 'exif'
        AND observation.status IN ('suggested', 'confirmed')
        AND observation.sensitive = 0
      ORDER BY link.memory_id, asset.content_sha256, observation.status, observation.id
    `).all(...memoryIds).map((row) => ({
      memoryId: row.memory_id,
      memoryTitle: row.memory_title,
      assetContentSha256: row.asset_content_sha256,
      kind: row.kind,
      source: row.source,
      status: row.status,
      sensitive: Boolean(row.sensitive),
      value: parseJsonObject(row.value_json)
    }));

    const oralHistories = listOralHistoryEvidence(memoryIds);
    if (!Array.isArray(oralHistories)) {
      throw new TypeError("listOralHistoryEvidence 必须同步返回数组。");
    }
    return { memories, revisions, claims, observations, oralHistories };
  }

  return Object.freeze({
    clearTimeCalibrations,
    deleteEventTimeCalibration,
    deleteMemoryTimeCalibration,
    buildTimeCalibrationBackup,
    getEventCalibrationWorkspace,
    getMemoryCalibrationWorkspace,
    getTimeCalibrationStats,
    getTimeCalibrationForEvent,
    getTimeCalibrationForMemory,
    listTimelineEntries,
    restoreTimeCalibrationBackup,
    saveEventTimeCalibration,
    saveMemoryTimeCalibration,
    validateTimeCalibrationBackup
  });
}

function prepareStatements(db) {
  return {
    getMemory: db.prepare("SELECT id, title, memory_date FROM memories WHERE id = ?"),
    getEvent: db.prepare("SELECT id, title, status FROM memory_events WHERE id = ?"),
    getForMemory: db.prepare("SELECT * FROM time_calibrations WHERE memory_id = ?"),
    getForEvent: db.prepare("SELECT * FROM time_calibrations WHERE event_id = ?"),
    listAll: db.prepare("SELECT * FROM time_calibrations ORDER BY id"),
    allMembersForEvent: db.prepare("SELECT memory_id FROM event_members WHERE event_id = ? ORDER BY position, memory_id"),
    confirmedEventForMemory: db.prepare(`
      SELECT member.event_id
      FROM event_members member
      JOIN memory_events event ON event.id = member.event_id
      WHERE member.memory_id = ? AND event.status = 'confirmed'
        AND trim(member.confirmed_at) <> ''
      LIMIT 1
    `),
    confirmedMembersForEvent: db.prepare(`
      SELECT member.memory_id
      FROM event_members member
      JOIN memory_events event ON event.id = member.event_id
      WHERE member.event_id = ? AND event.status = 'confirmed'
        AND trim(member.confirmed_at) <> ''
      ORDER BY member.position, member.memory_id
    `),
    sameEventPairsForMemory: db.prepare(`
      SELECT memory_a_id, memory_b_id
      FROM memory_pair_decisions
      WHERE decision = 'same_event' AND (memory_a_id = ? OR memory_b_id = ?)
      ORDER BY pair_key
    `),
    upsertMemory: db.prepare(`
      INSERT INTO time_calibrations (
        id, memory_id, event_id, resolution_kind, interval_start, interval_end,
        selected_source_keys_json, selected_source_snapshots_json,
        source_set_sha256, note, created_at, updated_at
      ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(memory_id) DO UPDATE SET
        resolution_kind = excluded.resolution_kind,
        interval_start = excluded.interval_start,
        interval_end = excluded.interval_end,
        selected_source_keys_json = excluded.selected_source_keys_json,
        selected_source_snapshots_json = excluded.selected_source_snapshots_json,
        source_set_sha256 = excluded.source_set_sha256,
        note = excluded.note,
        updated_at = excluded.updated_at
    `),
    upsertEvent: db.prepare(`
      INSERT INTO time_calibrations (
        id, memory_id, event_id, resolution_kind, interval_start, interval_end,
        selected_source_keys_json, selected_source_snapshots_json,
        source_set_sha256, note, created_at, updated_at
      ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(event_id) DO UPDATE SET
        resolution_kind = excluded.resolution_kind,
        interval_start = excluded.interval_start,
        interval_end = excluded.interval_end,
        selected_source_keys_json = excluded.selected_source_keys_json,
        selected_source_snapshots_json = excluded.selected_source_snapshots_json,
        source_set_sha256 = excluded.source_set_sha256,
        note = excluded.note,
        updated_at = excluded.updated_at
    `),
    restoreMemory: db.prepare(`
      INSERT INTO time_calibrations (
        id, memory_id, event_id, resolution_kind, interval_start, interval_end,
        selected_source_keys_json, selected_source_snapshots_json,
        source_set_sha256, note, created_at, updated_at
      ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(memory_id) DO UPDATE SET
        resolution_kind = excluded.resolution_kind,
        interval_start = excluded.interval_start,
        interval_end = excluded.interval_end,
        selected_source_keys_json = excluded.selected_source_keys_json,
        selected_source_snapshots_json = excluded.selected_source_snapshots_json,
        source_set_sha256 = excluded.source_set_sha256,
        note = excluded.note,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
    `),
    restoreEvent: db.prepare(`
      INSERT INTO time_calibrations (
        id, memory_id, event_id, resolution_kind, interval_start, interval_end,
        selected_source_keys_json, selected_source_snapshots_json,
        source_set_sha256, note, created_at, updated_at
      ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(event_id) DO UPDATE SET
        resolution_kind = excluded.resolution_kind,
        interval_start = excluded.interval_start,
        interval_end = excluded.interval_end,
        selected_source_keys_json = excluded.selected_source_keys_json,
        selected_source_snapshots_json = excluded.selected_source_snapshots_json,
        source_set_sha256 = excluded.source_set_sha256,
        note = excluded.note,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
    `),
    deleteForMemory: db.prepare("DELETE FROM time_calibrations WHERE memory_id = ?"),
    deleteForEvent: db.prepare("DELETE FROM time_calibrations WHERE event_id = ?"),
    clear: db.prepare("DELETE FROM time_calibrations"),
    listEventCalibrations: db.prepare(`
      SELECT calibration.*, event.id AS event_id, event.title AS event_title,
        COUNT(member.memory_id) AS member_count
      FROM time_calibrations calibration
      JOIN memory_events event ON event.id = calibration.event_id
      LEFT JOIN event_members member ON member.event_id = event.id AND trim(member.confirmed_at) <> ''
      WHERE calibration.event_id IS NOT NULL AND event.status = 'confirmed'
      GROUP BY calibration.id
      ORDER BY calibration.id
    `),
    listMemoryCalibrations: db.prepare(`
      SELECT calibration.*, memory.id AS memory_id, memory.title AS memory_title,
        event.id AS confirmed_event_id, event.title AS confirmed_event_title
      FROM time_calibrations calibration
      JOIN memories memory ON memory.id = calibration.memory_id
      LEFT JOIN event_members member ON member.memory_id = memory.id AND trim(member.confirmed_at) <> ''
      LEFT JOIN memory_events event ON event.id = member.event_id AND event.status = 'confirmed'
      WHERE calibration.memory_id IS NOT NULL
      ORDER BY calibration.id
    `),
    listMemberCalibrationGroups: db.prepare(`
      SELECT member.event_id, COUNT(calibration.id) AS calibration_count
      FROM event_members member
      JOIN memory_events event ON event.id = member.event_id AND event.status = 'confirmed'
      JOIN time_calibrations calibration ON calibration.memory_id = member.memory_id
      WHERE trim(member.confirmed_at) <> ''
      GROUP BY member.event_id
    `)
  };
}

function rowToCalibration(row) {
  const selectedSourceKeys = parseSelectedSourceKeys(row.selected_source_keys_json);
  const selectedSourceSnapshots = parseSourceSnapshots(row.selected_source_snapshots_json);
  return {
    id: row.id,
    targetType: row.memory_id ? "memory" : "event",
    memoryId: row.memory_id || "",
    eventId: row.event_id || "",
    resolutionKind: row.resolution_kind,
    intervalStart: row.interval_start,
    intervalEnd: row.interval_end,
    selectedSourceKeys,
    selectedSourceSnapshots,
    sourceSetSha256: row.source_set_sha256,
    note: row.note || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToBackupCalibration(row, currentSourceSetSha256) {
  const calibration = rowToCalibration(row);
  return {
    createdAt: calibration.createdAt,
    currentSourceSetSha256,
    eventId: calibration.eventId,
    id: calibration.id,
    intervalEnd: calibration.intervalEnd,
    intervalStart: calibration.intervalStart,
    memoryId: calibration.memoryId,
    note: calibration.note,
    resolutionKind: calibration.resolutionKind,
    selectedSourceKeys: calibration.selectedSourceKeys,
    selectedSourceSnapshots: calibration.selectedSourceSnapshots,
    sourceSetSha256: calibration.sourceSetSha256,
    updatedAt: calibration.updatedAt
  };
}

function validateTimeCalibrationBackupPayload(backup, sourceMemoryIds, sourceEventIds) {
  assertPlainObject(backup, "time calibration backup");
  if (backup.mode === "redacted-summary") {
    assertExactKeys(backup, REDACTED_BACKUP_KEYS, "redacted time calibration backup");
    requireBackupCount(backup.calibrationCount, "calibrationCount");
    requireBackupCount(backup.uncertainCount, "uncertainCount");
    requireBackupCount(backup.alternativesCount, "alternativesCount");
    if (backup.uncertainCount + backup.alternativesCount > backup.calibrationCount ||
        backup.note !== TIME_CALIBRATION_REDACTED_NOTE) {
      throw calibrationError("Redacted time calibration summary is invalid.", "CALIBRATION_BACKUP_INVALID");
    }
    return true;
  }

  assertExactKeys(backup, FULL_BACKUP_KEYS, "full time calibration backup");
  if (backup.mode !== "full" || backup.schemaVersion !== TIME_CALIBRATION_SCHEMA_VERSION ||
      !Array.isArray(backup.calibrations) || backup.calibrations.length > MAX_TIME_CALIBRATIONS) {
    throw calibrationError("Full time calibration backup is invalid.", "CALIBRATION_BACKUP_INVALID");
  }
  const memoryBoundary = sourceMemoryIds === undefined
    ? null
    : normalizeIdBoundary(sourceMemoryIds, "sourceMemoryIds");
  const eventBoundary = sourceEventIds === undefined
    ? null
    : normalizeIdBoundary(sourceEventIds, "sourceEventIds");
  const ids = new Set();
  const targets = new Set();
  let previousSortKey = "";
  for (const [index, item] of backup.calibrations.entries()) {
    const name = `calibrations[${index}]`;
    assertPlainObject(item, name);
    assertExactKeys(item, BACKUP_CALIBRATION_KEYS, name);
    const id = requireId(item.id, `${name}.id`);
    const memoryId = item.memoryId === "" ? "" : requireId(item.memoryId, `${name}.memoryId`);
    const eventId = item.eventId === "" ? "" : requireId(item.eventId, `${name}.eventId`);
    if ((!memoryId && !eventId) || (memoryId && eventId)) {
      throw calibrationError(`${name} must identify exactly one target.`, "CALIBRATION_BACKUP_REFERENCE_INVALID");
    }
    if (memoryBoundary && memoryId && !memoryBoundary.has(memoryId)) {
      throw calibrationError(`${name} references a memory outside the backup boundary.`, "CALIBRATION_BACKUP_REFERENCE_INVALID");
    }
    if (eventBoundary && eventId && !eventBoundary.has(eventId)) {
      throw calibrationError(`${name} references an event outside the backup boundary.`, "CALIBRATION_BACKUP_REFERENCE_INVALID");
    }
    const targetKey = memoryId ? `memory:${memoryId}` : `event:${eventId}`;
    if (ids.has(id) || targets.has(targetKey)) {
      throw calibrationError("Time calibration backup contains a duplicate ID or target.", "CALIBRATION_BACKUP_DUPLICATE");
    }
    ids.add(id);
    targets.add(targetKey);

    const resolution = normalizeCalibrationResolution(item);
    if (resolution.intervalStart !== item.intervalStart || resolution.intervalEnd !== item.intervalEnd) {
      throw calibrationError(`${name} interval is not canonical.`, "CALIBRATION_BACKUP_INVALID");
    }
    if (!Array.isArray(item.selectedSourceKeys) || item.selectedSourceKeys.length > 100 ||
        item.selectedSourceKeys.some((key) => typeof key !== "string" || !SOURCE_KEY_PATTERN.test(key)) ||
        new Set(item.selectedSourceKeys).size !== item.selectedSourceKeys.length ||
        JSON.stringify(item.selectedSourceKeys) !== JSON.stringify([...item.selectedSourceKeys].sort(compareText))) {
      throw calibrationError(`${name}.selectedSourceKeys is invalid.`, "CALIBRATION_BACKUP_INVALID");
    }
    const selectedSourceSnapshots = validateBackupSourceSnapshots(
      item.selectedSourceSnapshots,
      item.selectedSourceKeys,
      `${name}.selectedSourceSnapshots`
    );
    if (resolution.resolutionKind === "alternatives" && item.selectedSourceKeys.length < 2) {
      throw calibrationError(`${name} alternatives require two sources.`, "CALIBRATION_BACKUP_INVALID");
    }
    if (resolution.resolutionKind === "alternatives" && !hasDisjointSourcePair(selectedSourceSnapshots)) {
      throw calibrationError(`${name} alternatives require conflicting sources.`, "CALIBRATION_BACKUP_INVALID");
    }
    if (!["alternatives", "uncertain"].includes(resolution.resolutionKind) && item.selectedSourceKeys.length < 1) {
      throw calibrationError(`${name} dated placement requires a source.`, "CALIBRATION_BACKUP_INVALID");
    }
    if (!["alternatives", "uncertain"].includes(resolution.resolutionKind) &&
        selectedSourceSnapshots.some((snapshot) => compareIntervals(resolution, snapshot) !== "compatible")) {
      throw calibrationError(`${name} placement is unsupported by its sources.`, "CALIBRATION_BACKUP_INVALID");
    }
    requireSha256(item.currentSourceSetSha256, `${name}.currentSourceSetSha256`);
    requireSha256(item.sourceSetSha256, `${name}.sourceSetSha256`);
    if (normalizeNote(item.note) !== item.note) {
      throw calibrationError(`${name}.note is not canonical.`, "CALIBRATION_BACKUP_INVALID");
    }
    requireTimestamp(item.createdAt, `${name}.createdAt`);
    requireTimestamp(item.updatedAt, `${name}.updatedAt`);
    if (Date.parse(item.updatedAt) < Date.parse(item.createdAt)) {
      throw calibrationError(`${name} timestamps are out of order.`, "CALIBRATION_BACKUP_INVALID");
    }
    const sortKey = `${targetKey}\u0000${id}`;
    if (previousSortKey && compareText(previousSortKey, sortKey) > 0) {
      throw calibrationError("Time calibration backup must be canonically sorted.", "CALIBRATION_BACKUP_INVALID");
    }
    previousSortKey = sortKey;
  }
  return true;
}

function normalizeIdBoundary(value, name) {
  if (!Array.isArray(value) && !(value instanceof Set)) {
    throw calibrationError(`${name} must be an array or Set.`, "CALIBRATION_BACKUP_BOUNDARY_INVALID");
  }
  const ids = [...value].map((item) => requireId(item, `${name} item`));
  if (ids.length > MAX_TIME_CALIBRATIONS || new Set(ids).size !== ids.length) {
    throw calibrationError(`${name} is too large or contains duplicates.`, "CALIBRATION_BACKUP_BOUNDARY_INVALID");
  }
  return new Set(ids);
}

function normalizeIdMap(value, name) {
  if (value === undefined || value === null) return new Map();
  const entries = value instanceof Map
    ? [...value.entries()]
    : isPlainObject(value) ? Object.entries(value) : null;
  if (!entries) throw calibrationError(`${name} must be a Map or object.`, "CALIBRATION_RESTORE_MAPPING_INVALID");
  const result = new Map();
  const targets = new Set();
  for (const [source, target] of entries) {
    const sourceId = requireId(source, `${name} source`);
    const targetId = requireId(target, `${name} target`);
    if (result.has(sourceId) || targets.has(targetId)) {
      throw calibrationError(`${name} contains a collision.`, "CALIBRATION_RESTORE_MAPPING_INVALID");
    }
    result.set(sourceId, targetId);
    targets.add(targetId);
  }
  return result;
}

function normalizeOralQuestionKeyMap(value) {
  if (value === undefined || value === null) return new Map();
  const entries = value instanceof Map
    ? [...value.entries()]
    : isPlainObject(value) ? Object.entries(value) : null;
  if (!entries) {
    throw calibrationError("oralQuestionKeyMap must be a Map or object.", "CALIBRATION_RESTORE_MAPPING_INVALID");
  }
  const result = new Map();
  const targets = new Set();
  for (const [source, target] of entries) {
    const sourceKey = String(source || "");
    const targetKey = String(target || "");
    if (!/^oral-question:[a-f0-9]{64}$/u.test(sourceKey) || !/^oral-question:[a-f0-9]{64}$/u.test(targetKey) ||
        result.has(sourceKey) || targets.has(targetKey)) {
      throw calibrationError("oralQuestionKeyMap contains an invalid key or collision.", "CALIBRATION_RESTORE_MAPPING_INVALID");
    }
    result.set(sourceKey, targetKey);
    targets.add(targetKey);
  }
  return result;
}

function buildRestoreSourceMapping(candidates, memoryIdMap, eventIdMap = new Map(), oralQuestionKeyMap = new Map()) {
  const sourceIdByTargetId = new Map([...memoryIdMap.entries()].map(([sourceId, targetId]) => [targetId, sourceId]));
  const sourceEventIdByTargetId = new Map([...eventIdMap.entries()].map(([sourceId, targetId]) => [targetId, sourceId]));
  const sourceQuestionKeyByTargetKey = new Map(
    [...oralQuestionKeyMap.entries()].map(([sourceKey, targetKey]) => [targetKey, sourceKey])
  );
  const archiveCandidates = [];
  const currentKeyByArchiveKey = new Map();
  let complete = true;
  for (const candidate of candidates) {
    const isEventSource = candidate.sourceType === "oral-history";
    const sourceMemoryId = isEventSource ? "" : sourceIdByTargetId.get(candidate.memoryId);
    const sourceEventId = isEventSource ? sourceEventIdByTargetId.get(candidate.eventId) : "";
    const sourceQuestionKey = isEventSource
      ? sourceQuestionKeyByTargetKey.get(candidate.questionKey)
      : "";
    if ((!isEventSource && !sourceMemoryId) || (isEventSource && (!sourceEventId || !sourceQuestionKey))) {
      complete = false;
      continue;
    }
    const archiveCandidate = {
      ...candidate,
      memoryId: isEventSource ? "" : sourceMemoryId,
      eventId: isEventSource ? sourceEventId : "",
      questionKey: isEventSource ? sourceQuestionKey : candidate.questionKey,
      sourceKey: ""
    };
    const archiveKey = buildStableSourceKey(archiveCandidate);
    if (currentKeyByArchiveKey.has(archiveKey) && currentKeyByArchiveKey.get(archiveKey) !== candidate.sourceKey) {
      throw calibrationError(
        "Restored time evidence contains an ambiguous source identity.",
        "CALIBRATION_ARCHIVE_SOURCES_MISMATCH"
      );
    }
    currentKeyByArchiveKey.set(archiveKey, candidate.sourceKey);
    archiveCandidates.push({ ...archiveCandidate, sourceKey: archiveKey });
  }
  return {
    archiveKeys: archiveCandidates.map((candidate) => candidate.sourceKey),
    archiveSourceSetSha256: buildSourceSetSha256(archiveCandidates),
    complete,
    currentKeyByArchiveKey
  };
}

function remapRestoredSelection(selectedSourceKeys, selectedSourceSnapshots, currentKeyByArchiveKey) {
  const snapshotsByArchiveKey = new Map(selectedSourceSnapshots.map((snapshot) => [snapshot.sourceKey, snapshot]));
  const pairs = selectedSourceKeys.map((archiveKey) => {
    const currentKey = currentKeyByArchiveKey.get(archiveKey) || archiveKey;
    const snapshot = snapshotsByArchiveKey.get(archiveKey);
    return {
      sourceKey: currentKey,
      snapshot: { ...snapshot, sourceKey: currentKey }
    };
  }).sort((left, right) => compareText(left.sourceKey, right.sourceKey));
  return {
    selectedSourceKeys: pairs.map((pair) => pair.sourceKey),
    selectedSourceSnapshots: pairs.map((pair) => pair.snapshot)
  };
}

function selectRestoredSourceBoundary(item, workspaceSourceSetSha256, mustRemainNeedsReview) {
  if (!mustRemainNeedsReview) return workspaceSourceSetSha256;

  // Both values came from a validated archive and therefore remain truthful
  // source-set summaries. Prefer the boundary saved with the decision. When a
  // lossy JSON restore reconstructs exactly that older set, use the distinct
  // export-time current boundary so the derived review state cannot disappear.
  // Never manufacture a digest merely to force `needsReview`.
  for (const archivedBoundary of [item.sourceSetSha256, item.currentSourceSetSha256]) {
    if (archivedBoundary !== workspaceSourceSetSha256) return archivedBoundary;
  }
  throw calibrationError(
    "Restored time calibration cannot preserve its review boundary without inventing a source digest.",
    "CALIBRATION_RESTORE_REVIEW_BOUNDARY_UNREPRESENTABLE"
  );
}

function claimGeneratedId(createId, claimedIds) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const id = requireId(createId("time-calibration"), "generated calibration id");
    if (!claimedIds.has(id)) return id;
  }
  throw calibrationError("Could not allocate a unique time calibration ID.", "CALIBRATION_ID_COLLISION", 409);
}

function requireBackupCount(value, name) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_TIME_CALIBRATIONS) {
    throw calibrationError(`${name} is invalid.`, "CALIBRATION_BACKUP_INVALID");
  }
}

function assertExactKeys(value, expected, name) {
  const actual = Object.keys(value).sort(compareText);
  const wanted = [...expected].sort(compareText);
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw calibrationError(`${name} has an invalid field set.`, "CALIBRATION_BACKUP_INVALID");
  }
}

function compareBackupCalibrations(left, right) {
  const leftTarget = left.memoryId ? `memory:${left.memoryId}` : `event:${left.eventId}`;
  const rightTarget = right.memoryId ? `memory:${right.memoryId}` : `event:${right.eventId}`;
  return compareText(leftTarget, rightTarget) || compareText(left.id, right.id);
}

function sameCalibration(existing, next) {
  return existing.resolutionKind === next.resolutionKind &&
    existing.intervalStart === next.intervalStart &&
    existing.intervalEnd === next.intervalEnd &&
    JSON.stringify(existing.selectedSourceKeys) === JSON.stringify(next.selectedSourceKeys) &&
    JSON.stringify(existing.selectedSourceSnapshots) === JSON.stringify(next.selectedSourceSnapshots) &&
    existing.sourceSetSha256 === next.sourceSetSha256 &&
    existing.note === next.note;
}

function requireExpectedVersion(existing, options) {
  if (!Object.hasOwn(options, "expectedUpdatedAt")) return;
  const expected = String(options.expectedUpdatedAt || "");
  const current = String(existing?.updatedAt || "");
  if (expected !== current) {
    throw calibrationError("Time calibration changed; refresh before saving.", "CALIBRATION_VERSION_CONFLICT", 412);
  }
}

function compareTimelineEntries(left, right, order) {
  const leftHasInterval = Boolean(left.calibration?.intervalStart);
  const rightHasInterval = Boolean(right.calibration?.intervalStart);
  if (leftHasInterval !== rightHasInterval) return leftHasInterval ? -1 : 1;
  const a = left.calibration?.intervalStart || "";
  const b = right.calibration?.intervalStart || "";
  const primary = compareText(a, b) || compareText(left.calibration?.intervalEnd || "", right.calibration?.intervalEnd || "");
  const direction = order === "desc" ? -primary : primary;
  return direction || compareText(left.target.type, right.target.type) || compareText(left.target.id, right.target.id);
}

function normalizeNote(value) {
  if (value === undefined) return "";
  if (typeof value !== "string") throw calibrationError("note must be text.", "CALIBRATION_NOTE_INVALID");
  const note = value.replace(/\r\n?/gu, "\n").trim();
  if (note.length > 500 || note.includes("\u0000")) {
    throw calibrationError("note must contain at most 500 characters.", "CALIBRATION_NOTE_INVALID");
  }
  return note;
}

function parseSelectedSourceKeys(value) {
  const parsed = parseJson(value);
  if (!Array.isArray(parsed)) return [];
  return parsed.map((item) => String(item || "")).filter((item) => /^time-source:[a-f0-9]{64}$/u.test(item)).sort(compareText);
}

function sourceSnapshot(candidate) {
  return {
    intervalEnd: String(candidate?.intervalEnd || ""),
    intervalStart: String(candidate?.intervalStart || ""),
    precision: String(candidate?.precision || ""),
    sourceKey: String(candidate?.sourceKey || ""),
    sourceType: String(candidate?.sourceType || "")
  };
}

function parseSourceSnapshots(value) {
  const parsed = parseJson(value);
  if (!Array.isArray(parsed)) return [];
  try {
    return validateBackupSourceSnapshots(
      parsed,
      parsed.map((snapshot) => String(snapshot?.sourceKey || "")).sort(compareText),
      "stored source snapshots"
    );
  } catch {
    return [];
  }
}

function validateBackupSourceSnapshots(value, selectedSourceKeys, name) {
  if (!Array.isArray(value) || value.length > 100 || value.length !== selectedSourceKeys.length) {
    throw calibrationError(`${name} is invalid.`, "CALIBRATION_BACKUP_INVALID");
  }
  const snapshots = value.map((snapshot, index) => {
    assertPlainObject(snapshot, `${name}[${index}]`);
    assertExactKeys(snapshot, SOURCE_SNAPSHOT_KEYS, `${name}[${index}]`);
    if (!SOURCE_KEY_PATTERN.test(String(snapshot.sourceKey || "")) ||
        !SOURCE_TYPES.has(String(snapshot.sourceType || "")) ||
        !SOURCE_PRECISIONS.has(String(snapshot.precision || ""))) {
      throw calibrationError(`${name}[${index}] contains an invalid source identity.`, "CALIBRATION_BACKUP_INVALID");
    }
    const interval = normalizeCalibrationResolution({
      resolutionKind: snapshot.precision,
      intervalStart: snapshot.intervalStart,
      intervalEnd: snapshot.intervalEnd
    });
    if (interval.intervalStart !== snapshot.intervalStart || interval.intervalEnd !== snapshot.intervalEnd) {
      throw calibrationError(`${name}[${index}] interval is not canonical.`, "CALIBRATION_BACKUP_INVALID");
    }
    return {
      intervalEnd: interval.intervalEnd,
      intervalStart: interval.intervalStart,
      precision: interval.precision,
      sourceKey: snapshot.sourceKey,
      sourceType: snapshot.sourceType
    };
  });
  const sorted = [...snapshots].sort(compareSourceSnapshots);
  if (JSON.stringify(snapshots) !== JSON.stringify(sorted) ||
      JSON.stringify(snapshots.map((snapshot) => snapshot.sourceKey)) !== JSON.stringify(selectedSourceKeys)) {
    throw calibrationError(`${name} must match selectedSourceKeys in canonical order.`, "CALIBRATION_BACKUP_INVALID");
  }
  return snapshots;
}

function hasDisjointSourcePair(candidates) {
  for (let left = 0; left < candidates.length; left += 1) {
    for (let right = left + 1; right < candidates.length; right += 1) {
      if (compareIntervals(candidates[left], candidates[right]) === "disjoint") return true;
    }
  }
  return false;
}

function compareSourceSnapshots(left, right) {
  return compareText(left.sourceKey, right.sourceKey);
}

function parseJsonObject(value) {
  const parsed = parseJson(value);
  return isPlainObject(parsed) ? parsed : null;
}

function parseJson(value) {
  if (typeof value !== "string") return null;
  try { return JSON.parse(value); } catch { return null; }
}

function requireDatabase(db) {
  if (!db || typeof db.exec !== "function" || typeof db.prepare !== "function") {
    throw new TypeError("initializeTimeCalibrationDatabase requires a synchronous SQLite connection.");
  }
  return db;
}

function requireId(value, name) {
  const id = String(value || "").trim();
  if (!ID_PATTERN.test(id)) throw calibrationError(`${name} is invalid.`, "CALIBRATION_ID_INVALID");
  return id;
}

function requireSha256(value, name) {
  const text = String(value || "").trim().toLowerCase();
  if (!SHA256_PATTERN.test(text)) throw calibrationError(`${name} must be SHA-256.`, "CALIBRATION_SOURCE_SET_INVALID");
  return text;
}

function requireTimestamp(value, name) {
  if (typeof value !== "string" || value.length < 1 || value.length > 40 || !Number.isFinite(Date.parse(value))) {
    throw calibrationError(`${name} must be a valid timestamp.`, "CALIBRATION_TIMESTAMP_INVALID");
  }
  return value;
}

function monotonicTimestamp(candidate, previous) {
  if (!previous || Date.parse(candidate) > Date.parse(previous)) return candidate;
  return new Date(Date.parse(previous) + 1).toISOString();
}

function targetNotFound(type) {
  return calibrationError(`Time calibration ${type} target was not found.`, "CALIBRATION_TARGET_NOT_FOUND", 404);
}

function sourcesChanged() {
  return calibrationError("Time calibration sources changed; refresh before saving.", "CALIBRATION_SOURCES_CHANGED", 409);
}

function assertPlainObject(value, name) {
  if (!isPlainObject(value)) throw calibrationError(`${name} must be an object.`, "CALIBRATION_INPUT_INVALID");
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
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
  MAX_TIME_CALIBRATIONS,
  TIME_CALIBRATION_MIGRATION,
  TIME_CALIBRATION_REDACTED_NOTE,
  initializeTimeCalibrationDatabase,
  validateTimeCalibrationBackupPayload
};
