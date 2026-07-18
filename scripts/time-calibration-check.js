"use strict";

const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const { applyMigrations, listAppliedMigrations, readUserVersion } = require("../lib/migrations");
const {
  buildSourceSetSha256,
  buildStableSourceKey,
  buildTimeCandidates,
  compareIntervals,
  normalizeCalendarEvidence,
  normalizeCalibrationResolution
} = require("../lib/time-calibration-service");
const {
  TIME_CALIBRATION_MIGRATION,
  TIME_CALIBRATION_REDACTED_NOTE,
  initializeTimeCalibrationDatabase,
  validateTimeCalibrationBackupPayload
} = require("../lib/time-calibration-database");
const { createTimeCalibrationApi } = require("../lib/time-calibration-api");

const T0 = "2026-07-18T00:00:00.000Z";
const H = Object.freeze({
  a: "a".repeat(64), b: "b".repeat(64), c: "c".repeat(64),
  d: "d".repeat(64), e: "e".repeat(64), f: "f".repeat(64)
});
let assertions = 0;

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  checkPureService();
  checkDatabaseAndBackup();
  checkJsonStaleFallbackRestore();
  await checkApi();
  console.log(`Time calibration checks passed: ${assertions} assertions.`);
}

function checkPureService() {
  deepEqual(normalizeCalendarEvidence("2024"), {
    resolutionKind: "year", precision: "year", intervalStart: "2024-01-01",
    intervalEnd: "2024-12-31", value: "2024"
  }, "year evidence expands to an inclusive calendar year");
  deepEqual(normalizeCalendarEvidence("2024-02"), {
    resolutionKind: "month", precision: "month", intervalStart: "2024-02-01",
    intervalEnd: "2024-02-29", value: "2024-02"
  }, "leap February expands to its real last day");
  equal(normalizeCalendarEvidence("2023-02-29"), null, "invalid leap day is rejected");
  equal(normalizeCalendarEvidence("2024-2"), null, "non-canonical partial dates are rejected");
  equal(normalizeCalendarEvidence("2024-04-31"), null, "invalid month day is rejected");
  equal(normalizeCalendarEvidence("2024-02-29").intervalStart, "2024-02-29", "valid leap day is accepted");

  deepEqual(normalizeCalibrationResolution({
    resolutionKind: "range", intervalStart: "2021-06-18", intervalEnd: "2021-06-20"
  }), {
    resolutionKind: "range", precision: "range", intervalStart: "2021-06-18",
    intervalEnd: "2021-06-20", value: "2021-06-18/2021-06-20"
  }, "inclusive range remains canonical");
  deepEqual(normalizeCalibrationResolution({ resolutionKind: "uncertain", intervalStart: "", intervalEnd: "" }), {
    resolutionKind: "uncertain", precision: "uncertain", intervalStart: "", intervalEnd: "", value: ""
  }, "uncertain placement stores no fabricated date");
  deepEqual(normalizeCalibrationResolution({ resolutionKind: "alternatives", intervalStart: "", intervalEnd: "" }), {
    resolutionKind: "alternatives", precision: "alternatives", intervalStart: "", intervalEnd: "", value: ""
  }, "alternative placement stores source choices without a synthetic interval");
  throwsCode(
    () => normalizeCalibrationResolution({ resolutionKind: "range", intervalStart: "2021-06-20", intervalEnd: "2021-06-18" }),
    "CALIBRATION_INTERVAL_INVALID",
    "reverse range is rejected"
  );

  equal(compareIntervals(
    { intervalStart: "2021-06-01", intervalEnd: "2021-06-30" },
    { intervalStart: "2021-06-30", intervalEnd: "2021-07-02" }
  ), "compatible", "touching inclusive intervals are compatible");
  equal(compareIntervals(
    { intervalStart: "2021-06-01", intervalEnd: "2021-06-29" },
    { intervalStart: "2021-06-30", intervalEnd: "2021-07-02" }
  ), "disjoint", "only non-overlapping intervals are disjoint");
  equal(compareIntervals({}, { intervalStart: "2021-06-30", intervalEnd: "2021-07-02" }), "unknown", "missing interval is unknown");

  const baseInput = {
    memories: [{ id: "private-memory-a", title: "A", date: "2021-06-18", snapshotSha256: H.a }],
    revisions: [{ id: "revision-internal-a", memoryId: "private-memory-a", revisionNo: 2, snapshotSha256: H.b, snapshot: { date: "2021-06-19" } }],
    claims: [{
      id: "claim-internal-a", memoryId: "private-memory-a", claimKey: "date", value: "2021-06-20",
      quote: "2021-06-20", startOffset: 8, endOffset: 18, evidenceValid: true, status: "extracted"
    }],
    observations: [{
      id: "observation-internal-a", memoryId: "private-memory-a", assetId: "asset-internal-a",
      assetContentSha256: H.c, kind: "captured_at", source: "exif", status: "suggested", sensitive: false,
      value: { localDateTime: "2021-06-17T23:59:59", date: "2021-06-17", timezone: { kind: "local-floating", value: null } }
    }, {
      memoryId: "private-memory-a", assetContentSha256: H.d, kind: "gps_coordinates",
      source: "exif", status: "suggested", sensitive: true, value: { latitude: 30, longitude: 120 }
    }, {
      memoryId: "private-memory-a", assetContentSha256: H.e, kind: "captured_at",
      source: "exif", status: "confirmed", sensitive: true, value: { date: "2021-06-16" }
    }]
  };
  const candidates = buildTimeCandidates(baseInput);
  equal(candidates.length, 4, "only current, revision, valid raw claim and safe EXIF become candidates");
  equal(candidates.find((item) => item.sourceType === "exif").intervalStart, "2021-06-17", "floating EXIF uses its calendar date without UTC conversion");
  equal(candidates.find((item) => item.sourceType === "raw-claim").sourceQuote, "2021-06-20", "bounded raw claim quote remains locally reviewable");
  check(!JSON.stringify(candidates).includes("latitude"), "GPS values never enter candidates");

  const alternativesClaimCandidates = buildTimeCandidates({
    claims: [{
      memoryId: "private-memory-a", claimKey: "date",
      value: { resolutionKind: "alternatives", intervalStart: "", intervalEnd: "" },
      quote: "2021-06-18 / 2021-06-19", startOffset: 0, endOffset: 23,
      evidenceValid: true, status: "extracted"
    }]
  });
  equal(alternativesClaimCandidates.length, 0, "a valid alternatives claim is safely excluded because it is not one interval");

  const sameDayAcrossMemories = buildTimeCandidates({
    memories: [
      { id: "same-day-memory-a", title: "A", date: "2021-06-18" },
      { id: "same-day-memory-b", title: "B", date: "2021-06-18" }
    ],
    claims: [
      { memoryId: "same-day-memory-a", claimKey: "date", value: "2021-06-18", quote: "2021-06-18", startOffset: 0, endOffset: 10, evidenceValid: true, status: "extracted" },
      { memoryId: "same-day-memory-b", claimKey: "date", value: "2021-06-18", quote: "2021-06-18", startOffset: 0, endOffset: 10, evidenceValid: true, status: "extracted" }
    ]
  });
  equal(new Set(sameDayAcrossMemories.filter((item) => item.sourceType === "memory-current").map((item) => item.sourceKey)).size, 2, "same-day current records from different exhibits never collide");
  equal(new Set(sameDayAcrossMemories.filter((item) => item.sourceType === "raw-claim").map((item) => item.sourceKey)).size, 2, "identical raw date claims from different exhibits never collide");
  const duplicateEquivalentClaims = buildTimeCandidates({
    claims: [
      { memoryId: "same-memory", claimKey: "date", value: "2021-06-18", quote: "2021-06-18", startOffset: 0, endOffset: 10, evidenceValid: true, status: "extracted" },
      { memoryId: "same-memory", claimKey: "date", value: "2021-06-18", quote: "2021-06-18", startOffset: 0, endOffset: 10, evidenceValid: true, status: "extracted" }
    ]
  });
  equal(duplicateEquivalentClaims.length, 1, "equivalent duplicate claims from one exhibit collapse to one deterministic source card");

  const withoutDuplicateHead = buildTimeCandidates({
    memories: [{ id: "memory-head", title: "Current", date: "2021-06-18", snapshotSha256: H.a }],
    revisions: [{
      memoryId: "memory-head", memoryTitle: "Current", revisionNo: 1,
      snapshotSha256: H.a, snapshot: { date: "2021-06-18" }
    }]
  });
  equal(withoutDuplicateHead.length, 1, "latest revision identical to the current head is not shown as a duplicate source");
  equal(withoutDuplicateHead[0].sourceType, "memory-current", "the current source wins over its duplicate latest revision");

  const renamed = buildTimeCandidates({
    memories: [{ id: "private-memory-a", title: "Renamed", date: "2021-06-18", snapshotSha256: H.a }],
    revisions: [{ id: "different-revision", memoryId: "private-memory-a", revisionNo: 99, snapshotSha256: H.b, snapshot: { date: "2021-06-19" } }],
    claims: [{
      id: "different-claim", memoryId: "private-memory-a", claimKey: "date", value: "2021-06-20",
      quote: "2021-06-20", startOffset: 8, endOffset: 18, evidenceValid: true, status: "extracted"
    }],
    observations: [{
      id: "different-observation", memoryId: "private-memory-a", assetId: "different-asset",
      assetContentSha256: H.c, kind: "captured_at", source: "exif", status: "suggested", sensitive: false,
      value: { localDateTime: "ignored", date: "2021-06-17", timezone: "" }
    }]
  });
  deepEqual(candidates.map((item) => item.sourceKey).sort(), renamed.map((item) => item.sourceKey).sort(), "stable source keys ignore source-row IDs, titles and display order");
  equal(buildSourceSetSha256(candidates), buildSourceSetSha256([...renamed].reverse()), "source-set digest is independent of input order");

  const changedDate = buildTimeCandidates({ ...baseInput, memories: [{ ...baseInput.memories[0], date: "2021-06-21" }] });
  notEqual(buildSourceSetSha256(candidates), buildSourceSetSha256(changedDate), "date change changes the source-set digest");
  const changedStatus = buildTimeCandidates({
    ...baseInput,
    observations: [{ ...baseInput.observations[0], status: "confirmed" }]
  });
  notEqual(buildSourceSetSha256(candidates), buildSourceSetSha256(changedStatus), "source status change changes the digest");
  const changedContent = buildTimeCandidates({
    ...baseInput,
    observations: [{ ...baseInput.observations[0], assetContentSha256: H.f }]
  });
  notEqual(buildSourceSetSha256(candidates), buildSourceSetSha256(changedContent), "media content hash change changes the digest");
  notEqual(buildStableSourceKey({ ...candidates[0], memoryId: "another", revisionId: "ignored" }), candidates[0].sourceKey, "stable key binds evidence to an irreversible exhibit identity anchor");
  notEqual(buildSourceSetSha256(candidates), buildSourceSetSha256(candidates.slice(1)), "source deletion changes the source-set digest");
}

function checkDatabaseAndBackup() {
  const fixture = createFixture("database", { initialize: false });
  try {
    const oldCounts = snapshotOldCounts(fixture.db);
    fixture.initialize();
    equal(readUserVersion(fixture.db), 12, "schema 11 migrates to schema 12");
    deepEqual(listAppliedMigrations(fixture.db).map((item) => item.version), [4, 5, 6, 7, 8, 9, 10, 11, 12], "migration ledger remains contiguous");
    equal(TIME_CALIBRATION_MIGRATION.version, 12, "public migration is schema 12");
    deepEqual(snapshotOldCounts(fixture.db), oldCounts, "migration preserves every pre-existing row count");
    equal(count(fixture.db, "time_calibrations"), 0, "migration does not fabricate user decisions");
    check(indexExists(fixture.db, "idx_time_calibrations_updated"), "updated-time index is created");
    assert.throws(() => fixture.db.prepare(`
      INSERT INTO time_calibrations (
        id, memory_id, event_id, resolution_kind, interval_start, interval_end,
        selected_source_keys_json, source_set_sha256, note, created_at, updated_at
      ) VALUES ('bad-both', 'memory-one', 'event-one', 'uncertain', '', '', '[]', ?, '', ?, ?)
    `).run(H.a, T0, T0), /constraint/iu, "database enforces exactly one target"); assertions += 1;

    const memoryWorkspace = fixture.store.getMemoryCalibrationWorkspace("memory-one");
    const types = new Set(memoryWorkspace.candidates.map((item) => item.sourceType));
    check(types.has("memory-current") && types.has("revision") && types.has("raw-claim") && types.has("exif"), "memory workspace collects all approved source types");
    check(memoryWorkspace.candidates.some((item) => item.memoryId === "memory-two"), "confirmed event sibling sources are included");
    check(memoryWorkspace.candidates.some((item) => item.memoryId === "memory-four"), "explicit same_event path sources are included");
    check(!memoryWorkspace.candidates.some((item) => item.memoryId === "memory-three"), "unassessed pair sources are excluded");
    check(!memoryWorkspace.candidates.some((item) => item.displayDate === "2021-06-21"), "invalidated raw claim is excluded");
    check(!memoryWorkspace.candidates.some((item) => item.displayDate === "2020-01-02"), "media attached only to unrelated memories is excluded");
    equal(memoryWorkspace.candidates.filter((item) => item.sourceType === "raw-claim" && item.memoryId === "memory-one").length, 1, "alternatives claim does not break or enter the database workspace");
    check(!JSON.stringify(memoryWorkspace).includes("gps_coordinates"), "GPS never enters a database workspace");

    const eventWorkspace = fixture.store.getEventCalibrationWorkspace("event-one");
    check(eventWorkspace.candidates.some((item) => item.memoryId === "memory-one"), "event workspace includes first confirmed member");
    check(eventWorkspace.candidates.some((item) => item.memoryId === "memory-two"), "event workspace includes second confirmed member");
    equal(eventWorkspace.target.memberCount, 2, "event workspace reports confirmed membership count");
    const identicalRawSources = eventWorkspace.candidates.filter((item) => (
      item.sourceType === "raw-claim" && item.intervalStart === "2021-06-20"
    ));
    equal(identicalRawSources.length, 2, "two exhibits retain separate raw sources for identical quotes, offsets and dates");
    equal(new Set(identicalRawSources.map((item) => item.sourceKey)).size, 2, "identical cross-exhibit raw sources have unique keys");

    const rawCandidate = memoryWorkspace.candidates.find((item) => item.sourceType === "raw-claim");
    const savedMemory = fixture.store.saveMemoryTimeCalibration("memory-one", {
      resolutionKind: "day",
      intervalStart: rawCandidate.intervalStart,
      intervalEnd: rawCandidate.intervalEnd,
      selectedSourceKeys: [rawCandidate.sourceKey],
      sourceSetSha256: memoryWorkspace.sourceSetSha256,
      note: "User checked the quoted date."
    });
    equal(savedMemory.resolutionKind, "day", "memory calibration is saved with the current evidence digest");
    equal(fixture.db.prepare("SELECT memory_date FROM memories WHERE id = 'memory-one'").get().memory_date, "2021-06-19", "saving never overwrites the memory date");
    const storedAt = savedMemory.updatedAt;

    fixture.db.prepare("UPDATE memories SET memory_date = '2021-06-22' WHERE id = 'memory-one'").run();
    throwsCode(() => fixture.store.saveMemoryTimeCalibration("memory-one", {
      resolutionKind: "day",
      intervalStart: rawCandidate.intervalStart,
      intervalEnd: rawCandidate.intervalEnd,
      selectedSourceKeys: [rawCandidate.sourceKey],
      sourceSetSha256: memoryWorkspace.sourceSetSha256,
      note: "stale"
    }), "CALIBRATION_SOURCES_CHANGED", "stale source digest is rejected with a stable conflict");
    equal(fixture.store.getTimeCalibrationForMemory("memory-one").updatedAt, storedAt, "stale digest performs zero writes");
    equal(fixture.store.getMemoryCalibrationWorkspace("memory-one").needsReview, true, "evidence change derives needsReview without mutating the saved decision");
    const staleBackup = fixture.store.buildTimeCalibrationBackup("full", ["memory-one"]);

    const refreshed = fixture.store.getMemoryCalibrationWorkspace("memory-one");
    throwsCode(() => fixture.store.saveMemoryTimeCalibration("memory-one", {
      resolutionKind: "day",
      intervalStart: "2021-06-22",
      intervalEnd: "2021-06-22",
      selectedSourceKeys: [`time-source:${"0".repeat(64)}`],
      sourceSetSha256: refreshed.sourceSetSha256,
      note: "missing"
    }), "CALIBRATION_SOURCE_NOT_FOUND", "missing selected source is rejected");
    equal(fixture.store.getTimeCalibrationForMemory("memory-one").updatedAt, storedAt, "missing selected source performs zero writes");

    const currentCandidate = refreshed.candidates.find((item) => item.sourceType === "memory-current" && item.memoryId === "memory-one");
    throwsCode(() => fixture.store.saveMemoryTimeCalibration("memory-one", {
      resolutionKind: "day",
      intervalStart: "2030-01-01",
      intervalEnd: "2030-01-01",
      selectedSourceKeys: [currentCandidate.sourceKey],
      sourceSetSha256: refreshed.sourceSetSha256,
      note: "unsupported"
    }, { expectedUpdatedAt: storedAt }), "CALIBRATION_INTERVAL_UNSUPPORTED", "a selected 2021 source cannot support an unrelated 2030 placement");
    equal(fixture.store.getTimeCalibrationForMemory("memory-one").updatedAt, storedAt, "unsupported placement performs zero writes");
    fixture.clock.value = "2026-07-18T00:00:01.000Z";
    const resaved = fixture.store.saveMemoryTimeCalibration("memory-one", {
      resolutionKind: "day",
      intervalStart: "2021-06-22",
      intervalEnd: "2021-06-22",
      selectedSourceKeys: [currentCandidate.sourceKey],
      sourceSetSha256: refreshed.sourceSetSha256,
      note: "Current date checked."
    }, { expectedUpdatedAt: storedAt });
    fixture.clock.value = "2026-07-18T00:00:02.000Z";
    const noOp = fixture.store.saveMemoryTimeCalibration("memory-one", {
      resolutionKind: "day",
      intervalStart: "2021-06-22",
      intervalEnd: "2021-06-22",
      selectedSourceKeys: [currentCandidate.sourceKey],
      sourceSetSha256: refreshed.sourceSetSha256,
      note: "Current date checked."
    }, { expectedUpdatedAt: resaved.updatedAt });
    equal(noOp.updatedAt, resaved.updatedAt, "semantic no-op keeps its timestamp stable");
    throwsCode(() => fixture.store.saveMemoryTimeCalibration("memory-one", {
      resolutionKind: "uncertain", intervalStart: "", intervalEnd: "", selectedSourceKeys: [],
      sourceSetSha256: refreshed.sourceSetSha256, note: ""
    }, { expectedUpdatedAt: storedAt }), "CALIBRATION_VERSION_CONFLICT", "stale expected timestamp is rejected");

    const eventNow = fixture.store.getEventCalibrationWorkspace("event-one");
    const currentEventSources = eventNow.candidates.filter((item) => item.sourceType === "memory-current");
    const twoEventSources = findIntervalPair(currentEventSources, "disjoint");
    equal(twoEventSources.length, 2, "event has two independent current sources for alternatives");
    throwsCode(() => fixture.store.saveEventTimeCalibration("event-one", {
      resolutionKind: "alternatives", intervalStart: "", intervalEnd: "",
      selectedSourceKeys: [twoEventSources[0].sourceKey], sourceSetSha256: eventNow.sourceSetSha256, note: ""
    }), "CALIBRATION_ALTERNATIVES_SOURCES_REQUIRED", "alternatives require at least two selected sources");
    const compatibleSources = findIntervalPair(eventNow.candidates, "compatible");
    equal(compatibleSources.length, 2, "fixture exposes two overlapping sources for the negative alternatives contract");
    throwsCode(() => fixture.store.saveEventTimeCalibration("event-one", {
      resolutionKind: "alternatives", intervalStart: "", intervalEnd: "",
      selectedSourceKeys: compatibleSources.map((item) => item.sourceKey),
      sourceSetSha256: eventNow.sourceSetSha256, note: ""
    }), "CALIBRATION_ALTERNATIVES_CONFLICT_REQUIRED", "two compatible dates cannot masquerade as alternative time records");
    const savedEvent = fixture.store.saveEventTimeCalibration("event-one", {
      resolutionKind: "alternatives", intervalStart: "", intervalEnd: "",
      selectedSourceKeys: twoEventSources.map((item) => item.sourceKey),
      sourceSetSha256: eventNow.sourceSetSha256, note: "Keep both recorded dates."
    });
    equal(savedEvent.intervalStart, "", "alternatives do not synthesize an interval");
    equal(savedEvent.selectedSourceSnapshots.length, 2, "alternatives preserve two minimal source snapshots without copying prose");
    deepEqual(
      savedEvent.selectedSourceSnapshots.map((snapshot) => snapshot.intervalStart).sort(),
      twoEventSources.map((source) => source.intervalStart).sort(),
      "saved source snapshots preserve the two dates needed to explain alternatives"
    );
    check(!/(?:quote|gps|latitude|longitude|title)/iu.test(JSON.stringify(savedEvent.selectedSourceSnapshots)), "saved source snapshots exclude prose, titles and GPS");

    const memoryTwoWorkspace = fixture.store.getMemoryCalibrationWorkspace("memory-two");
    const memoryTwoRawSources = memoryTwoWorkspace.candidates.filter((item) => (
      item.sourceType === "raw-claim" && item.intervalStart === "2021-06-20"
    ));
    fixture.store.saveMemoryTimeCalibration("memory-two", {
      resolutionKind: "day", intervalStart: "2021-06-20", intervalEnd: "2021-06-20",
      selectedSourceKeys: memoryTwoRawSources.map((item) => item.sourceKey), sourceSetSha256: memoryTwoWorkspace.sourceSetSha256, note: ""
    });
    const timeline = fixture.store.listTimelineEntries();
    check(timeline.some((item) => item.target.type === "event" && item.target.id === "event-one"), "grouped timeline contains event calibration");
    check(!timeline.some((item) => item.target.type === "memory" && ["memory-one", "memory-two"].includes(item.target.id)), "event calibration takes precedence over stored member placements");
    const eventEntry = timeline.find((item) => item.target.id === "event-one");
    equal(eventEntry.storedMemberCalibrationCount, 2, "member placements remain stored for detail views");
    deepEqual(eventEntry.target.memberIds, ["memory-one", "memory-two"], "event timeline exposes only confirmed member IDs needed to reopen the puzzle");

    const stats = fixture.store.getTimeCalibrationStats();
    deepEqual(stats, { calibrations: 3, needsReview: 0, uncertain: 0, alternatives: 1 }, "derived calibration stats include alternatives and review state");
    const full = fixture.store.buildTimeCalibrationBackup("full", ["memory-one", "memory-two", "memory-four"]);
    equal(full.calibrations.length, 3, "full backup includes bounded member and event calibrations");
    equal(validateTimeCalibrationBackupPayload(full, ["memory-one", "memory-two", "memory-four"], ["event-one"]), true, "full backup validates against explicit boundaries");
    check(full.calibrations.every((item) => /^[a-f0-9]{64}$/u.test(item.currentSourceSetSha256)), "full backup records the export-time source boundary for strict restore");
    const redacted = fixture.store.buildTimeCalibrationBackup("redacted", ["memory-one", "memory-two", "memory-four"]);
    deepEqual(redacted, {
      alternativesCount: 1,
      calibrationCount: 3,
      mode: "redacted-summary",
      note: TIME_CALIBRATION_REDACTED_NOTE,
      uncertainCount: 0
    }, "redacted backup physically removes dates, source keys, notes and IDs");
    assert.throws(() => validateTimeCalibrationBackupPayload({ ...redacted, note: "changed" }, [], []), /invalid/iu, "fixed redacted note cannot be replaced"); assertions += 1;

    const target = createFixture("restore");
    try {
      target.db.prepare("UPDATE memories SET memory_date = '2021-06-22' WHERE id = 'memory-one'").run();
      remapFixtureIdentities(target.db, "restored-");
      const restored = target.store.restoreTimeCalibrationBackup(full, {
        memoryIdMap: new Map([
          ["memory-one", "restored-memory-one"], ["memory-two", "restored-memory-two"], ["memory-four", "restored-memory-four"]
        ]),
        eventIdMap: new Map([["event-one", "restored-event-one"]]),
        sourceMode: "time-isle"
      });
      equal(restored.calibrations, 3, "complete evidence restores every calibration");
      equal(restored.skipped, 0, "complete restore skips nothing");
      equal(target.store.getTimeCalibrationStats().alternatives, 1, "restored alternatives remain explicit");
      equal(target.store.getTimeCalibrationStats().needsReview, 0, "identity remapping alone does not mark restored decisions for review");
      const remappedWorkspace = target.store.getEventCalibrationWorkspace("restored-event-one");
      check(remappedWorkspace.calibration.selectedSourceKeys.every((key) => remappedWorkspace.candidates.some((candidate) => candidate.sourceKey === key)), "archive source keys are translated to current keys after ID mapping");
      equal(remappedWorkspace.calibration.sourceSetSha256, remappedWorkspace.sourceSetSha256, "time-isle restore translates the current source boundary without false review state");
      const remappedMemoryWorkspace = target.store.getMemoryCalibrationWorkspace("restored-memory-two");
      equal(remappedMemoryWorkspace.calibration.selectedSourceKeys.length, 2, "time-isle restore keeps both cross-exhibit same-day selections");
      equal(new Set(remappedMemoryWorkspace.calibration.selectedSourceKeys).size, 2, "time-isle restore maps selected keys one-to-one");
      deepEqual(remappedMemoryWorkspace.calibration.selectedSourceSnapshots.map((snapshot) => snapshot.sourceKey), remappedMemoryWorkspace.calibration.selectedSourceKeys, "time-isle restore remaps saved snapshots in the same canonical order");
    } finally { target.close(); }

    const jsonTarget = createFixture("restore-json-remapped");
    try {
      jsonTarget.db.prepare("UPDATE memories SET memory_date = '2021-06-22' WHERE id = 'memory-one'").run();
      remapFixtureIdentities(jsonTarget.db, "json-");
      const restoredJson = jsonTarget.store.restoreTimeCalibrationBackup(full, {
        memoryIdMap: new Map([
          ["memory-one", "json-memory-one"], ["memory-two", "json-memory-two"], ["memory-four", "json-memory-four"]
        ]),
        eventIdMap: new Map([["event-one", "json-event-one"]]),
        sourceMode: "json"
      });
      equal(restoredJson.requiresTimeIsle, false, "complete JSON identity mapping does not falsely request a richer archive");
      equal(jsonTarget.store.getTimeCalibrationStats().needsReview, 0, "complete JSON ID remapping preserves currentSourceSet semantics");
      const jsonWorkspace = jsonTarget.store.getMemoryCalibrationWorkspace("json-memory-two");
      equal(jsonWorkspace.calibration.sourceSetSha256, jsonWorkspace.sourceSetSha256, "JSON restore translates the current source boundary");
      equal(new Set(jsonWorkspace.calibration.selectedSourceKeys).size, 2, "JSON restore maps identical cross-exhibit sources one-to-one");
      deepEqual(jsonWorkspace.calibration.selectedSourceSnapshots.map((snapshot) => snapshot.sourceKey), jsonWorkspace.calibration.selectedSourceKeys, "JSON restore remaps selected snapshots with their keys");
    } finally { jsonTarget.close(); }

    const missingMapTarget = createFixture("restore-missing-map");
    try {
      missingMapTarget.db.prepare("UPDATE memories SET memory_date = '2021-06-22' WHERE id = 'memory-one'").run();
      remapFixtureIdentities(missingMapTarget.db, "gap-");
      throwsCode(() => missingMapTarget.store.restoreTimeCalibrationBackup(full, {
        memoryIdMap: new Map([
          ["memory-one", "gap-memory-one"], ["memory-two", "gap-memory-two"]
        ]),
        eventIdMap: new Map([["event-one", "gap-event-one"]]),
        sourceMode: "time-isle"
      }), "CALIBRATION_ARCHIVE_SOURCES_MISMATCH", "time-isle restore fails closed when a target-to-source identity mapping is missing");
      equal(missingMapTarget.store.getTimeCalibrationStats().calibrations, 0, "missing reverse identity mapping rolls back every calibration");
      const incompleteJson = missingMapTarget.store.restoreTimeCalibrationBackup(full, {
        memoryIdMap: new Map([
          ["memory-one", "gap-memory-one"], ["memory-two", "gap-memory-two"]
        ]),
        eventIdMap: new Map([["event-one", "gap-event-one"]]),
        sourceMode: "json"
      });
      equal(incompleteJson.requiresTimeIsle, true, "JSON restore explicitly reports an incomplete reverse identity mapping");
      check(missingMapTarget.store.getTimeCalibrationStats().needsReview > 0, "incomplete JSON identity mapping cannot look current");
    } finally { missingMapTarget.close(); }

    const staleTarget = createFixture("restore-stale");
    try {
      staleTarget.db.prepare("UPDATE memories SET memory_date = '2021-06-22' WHERE id = 'memory-one'").run();
      const restoredStale = staleTarget.store.restoreTimeCalibrationBackup(staleBackup, {
        memoryIdMap: new Map([
          ["memory-one", "memory-one"], ["memory-two", "memory-two"], ["memory-four", "memory-four"]
        ]),
        eventIdMap: new Map(),
        sourceMode: "time-isle"
      });
      equal(restoredStale.calibrations, 1, "完整归档保留来源已失效的旧判断而不是丢弃历史");
      equal(staleTarget.store.getMemoryCalibrationWorkspace("memory-one").needsReview, true, "恢复后的旧判断明确进入待复核状态");
    } finally { staleTarget.close(); }

    const incompleteTarget = createFixture("restore-incomplete");
    try {
      incompleteTarget.db.prepare("UPDATE memories SET memory_date = '2021-06-23' WHERE id = 'memory-one'").run();
      throwsCode(() => incompleteTarget.store.restoreTimeCalibrationBackup(full, {
        memoryIdMap: new Map([
          ["memory-one", "memory-one"], ["memory-two", "memory-two"], ["memory-four", "memory-four"]
        ]),
        eventIdMap: new Map([["event-one", "event-one"]]),
        sourceMode: "time-isle"
      }), "CALIBRATION_ARCHIVE_SOURCES_MISMATCH", "complete archive restore rejects a different reconstructed source boundary");
      equal(incompleteTarget.store.getTimeCalibrationStats().calibrations, 0, "source-boundary mismatch rolls back every calibration write");
    } finally { incompleteTarget.close(); }

    fixture.db.prepare("UPDATE memories SET memory_date = '2021-06-25' WHERE id = 'memory-two'").run();
    const changedEventWorkspace = fixture.store.getEventCalibrationWorkspace("event-one");
    equal(changedEventWorkspace.needsReview, true, "editing a selected source marks alternatives for review");
    deepEqual(
      changedEventWorkspace.calibration.selectedSourceSnapshots.map((snapshot) => snapshot.intervalStart).sort(),
      twoEventSources.map((source) => source.intervalStart).sort(),
      "source changes do not erase the dates that explained the saved alternatives"
    );

    fixture.db.prepare("DELETE FROM memories WHERE id = 'memory-one'").run();
    equal(fixture.store.getTimeCalibrationForMemory("memory-one"), null, "memory deletion cascades its calibration");
  } finally {
    fixture.close();
  }
}

function checkJsonStaleFallbackRestore() {
  const source = createFixture("json-stale-fallback-source");
  const target = createFixture("json-stale-fallback-target");
  try {
    // A plain JSON export restores structured evidence but not media bytes or
    // EXIF observations. Start with no safe EXIF source, save a decision, then
    // add one so the exported decision is legitimately stale.
    source.db.prepare("DELETE FROM media_observations WHERE id = 'observation-date'").run();
    const beforeExif = source.store.getMemoryCalibrationWorkspace("memory-one");
    const selected = beforeExif.candidates.find((candidate) => (
      candidate.sourceType === "memory-current" && candidate.memoryId === "memory-one"
    ));
    source.store.saveMemoryTimeCalibration("memory-one", {
      resolutionKind: "day",
      intervalStart: selected.intervalStart,
      intervalEnd: selected.intervalEnd,
      selectedSourceKeys: [selected.sourceKey],
      sourceSetSha256: beforeExif.sourceSetSha256,
      note: "Saved before EXIF was available."
    });
    source.db.prepare("INSERT INTO media_observations VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      "observation-json-only-exif",
      "asset-one",
      "captured_at",
      "exif",
      JSON.stringify({ date: "2021-06-16", timezone: { kind: "local-floating", value: null } }),
      "suggested",
      0
    );
    const staleAtExport = source.store.getMemoryCalibrationWorkspace("memory-one");
    equal(staleAtExport.needsReview, true, "adding safe EXIF makes the saved pre-EXIF decision stale at export");
    const backup = source.store.buildTimeCalibrationBackup("full", ["memory-one", "memory-two", "memory-four"]);
    const archived = backup.calibrations.find((item) => item.memoryId === "memory-one");
    notEqual(archived.sourceSetSha256, archived.currentSourceSetSha256, "archive records both the old decision boundary and newer EXIF boundary");

    // Model the JSON restore boundary: IDs and structured evidence survive,
    // while the newly added EXIF observation does not.
    target.db.prepare("DELETE FROM media_observations WHERE id = 'observation-date'").run();
    const reconstructed = target.store.getMemoryCalibrationWorkspace("memory-one");
    equal(reconstructed.sourceSetSha256, archived.sourceSetSha256, "lossy JSON reconstruction can exactly fall back to the old decision source set");
    const restored = target.store.restoreTimeCalibrationBackup(backup, {
      memoryIdMap: new Map([
        ["memory-one", "memory-one"], ["memory-two", "memory-two"], ["memory-four", "memory-four"]
      ]),
      eventIdMap: new Map(),
      sourceMode: "json"
    });
    equal(restored.requiresTimeIsle, true, "JSON restore reports that the omitted EXIF source requires a complete archive");
    const restoredWorkspace = target.store.getMemoryCalibrationWorkspace("memory-one");
    equal(restoredWorkspace.needsReview, true, "JSON fallback to the old source set cannot erase the stale decision review state");
    equal(
      restoredWorkspace.calibration.sourceSetSha256,
      archived.currentSourceSetSha256,
      "restore uses the real export-time current boundary instead of inventing a review digest"
    );
  } finally {
    source.close();
    target.close();
  }
}

async function checkApi() {
  const fixture = createFixture("api");
  try {
    const harness = createApiHarness(fixture.store);
    const insertRevision = fixture.db.prepare("INSERT INTO memory_revisions VALUES (?, ?, ?, ?, ?)");
    for (let index = 0; index < 105; index += 1) {
      const day = String((index % 28) + 1).padStart(2, "0");
      insertRevision.run(
        `api-extra-revision-${index}`,
        "memory-one",
        index + 10,
        JSON.stringify({ date: `2021-07-${day}` }),
        String(index + 10).padStart(64, "0")
      );
    }
    let result = await harness.call("GET", "/api/time-calibrations/events/event-one");
    equal(result.statusCode, 200, "workspace GET succeeds");
    equal(result.getHeader("cache-control"), "no-store", "workspace response is no-store");
    check(result.payload.etag && result.getHeader("etag") === result.payload.etag, "workspace returns matching ETag header and payload");
    check(result.payload.candidateCount > 100 && result.payload.candidates.length === 100 && result.payload.candidatesTruncated === true, "large evidence sets are explicitly and deterministically bounded at the API");
    check(result.payload.candidates.some((item) => item.sourceType === "memory-current"), "bounded evidence prioritizes current records instead of hash-order truncation");
    check(result.payload.candidates.every((item) => item.precision !== "alternatives"), "alternatives claim cannot masquerade as a public single-interval source");
    const serialized = JSON.stringify(result.payload);
    check(!/gps_coordinates|latitude|longitude|raw_content|rawContent/u.test(serialized), "GET never exposes GPS or whole raw memory content");
    const sourceSetBeforeDeletion = result.payload.sourceSetSha256;
    const etagBeforeDeletion = result.payload.etag;
    fixture.db.prepare("DELETE FROM memory_claims WHERE id = 'claim-valid'").run();
    const afterSourceDeletion = await harness.call("GET", "/api/time-calibrations/events/event-one");
    notEqual(afterSourceDeletion.payload.sourceSetSha256, sourceSetBeforeDeletion, "source deletion changes the public source digest");
    notEqual(afterSourceDeletion.payload.etag, etagBeforeDeletion, "source deletion changes the workspace ETag");
    equal(afterSourceDeletion.payload.candidateCount, result.payload.candidateCount - 1, "source deletion removes exactly its candidate");
    fixture.db.prepare("UPDATE memory_claims SET status = 'confirmed' WHERE id = 'claim-valid-two'").run();
    const afterSourceEdit = await harness.call("GET", "/api/time-calibrations/events/event-one");
    notEqual(afterSourceEdit.payload.sourceSetSha256, afterSourceDeletion.payload.sourceSetSha256, "source edit changes the public source digest");
    notEqual(afterSourceEdit.payload.etag, afterSourceDeletion.payload.etag, "source edit changes the workspace ETag");
    equal(afterSourceEdit.payload.candidateCount, afterSourceDeletion.payload.candidateCount, "source edit changes identity without fabricating another candidate");
    result = afterSourceEdit;
    const etag = result.payload.etag;
    const source = result.payload.candidates.find((item) => item.sourceType === "memory-current" && item.precision === "day");
    const validBody = {
      resolutionKind: "day",
      intervalStart: source.intervalStart,
      intervalEnd: source.intervalEnd,
      selectedSourceKeys: [source.sourceKey],
      sourceSetSha256: result.payload.sourceSetSha256,
      note: "API checked",
      confirm: true
    };

    await rejectsStatus(() => harness.call("PUT", "/api/time-calibrations/events/event-one", {
      body: { ...validBody, confirm: false }, headers: { "if-match": etag }
    }), 400, "PUT requires explicit confirmation");
    await rejectsStatus(() => harness.call("PUT", "/api/time-calibrations/events/event-one", {
      body: { ...validBody, extra: true }, headers: { "if-match": etag }
    }), 400, "PUT rejects unknown fields");
    await rejectsStatus(() => harness.call("PUT", "/api/time-calibrations/events/event-one", {
      body: validBody
    }), 428, "even first confirmation requires the workspace ETag");
    await rejectsCode(() => harness.call("PUT", "/api/time-calibrations/events/event-one", {
      body: { ...validBody, sourceSetSha256: "0".repeat(64) }, headers: { "if-match": etag }
    }), 409, "CALIBRATION_SOURCES_CHANGED", "source digest conflict is stable and private");

    result = await harness.call("PUT", "/api/time-calibrations/events/event-one", {
      body: validBody, headers: { "if-match": etag }
    });
    equal(result.statusCode, 201, "first confirmed PUT creates a calibration");
    equal(result.payload.calibration.resolutionKind, "day", "PUT returns the saved decision");
    const savedEtag = result.payload.etag;
    await rejectsStatus(() => harness.call("PUT", "/api/time-calibrations/events/event-one", { body: validBody }), 428, "existing update requires If-Match");
    await rejectsStatus(() => harness.call("PUT", "/api/time-calibrations/events/event-one", {
      body: validBody, headers: { "if-match": etag }
    }), 412, "stale If-Match returns 412");
    result = await harness.call("PUT", "/api/time-calibrations/events/event-one", {
      body: validBody, headers: { "if-match": savedEtag }
    });
    equal(result.statusCode, 200, "current If-Match updates or no-ops safely");
    equal(result.payload.calibration.selectedSourceSnapshots.length, 1, "detail API returns the minimal saved source snapshot");
    const currentCalibrationEtag = result.payload.etag;

    const timelineResult = await harness.call("GET", "/api/timeline");
    equal(timelineResult.statusCode, 200, "timeline GET succeeds");
    equal(timelineResult.getHeader("cache-control"), "no-store", "timeline is no-store");
    const timelineEntry = timelineResult.payload.entries[0];
    deepEqual(Object.keys(timelineEntry).sort(), ["calibration", "needsReview", "target"], "timeline entry uses a strict top-level projection");
    deepEqual(Object.keys(timelineEntry.calibration).sort(), ["intervalEnd", "intervalStart", "resolutionKind"], "timeline omits source keys, hashes, notes, IDs and timestamps");
    deepEqual(Object.keys(timelineEntry.target).sort(), ["id", "memberIds", "title", "type"], "event timeline returns only its title and two-member puzzle boundary");
    equal(timelineEntry.target.memberIds.length, 2, "timeline caps event members at the two IDs used to reopen the puzzle");
    check(!/(?:sourceSet|selectedSource|createdAt|updatedAt|note|calibration-)/u.test(JSON.stringify(timelineResult.payload)), "timeline payload does not leak calibration internals");

    const writesBeforeDemo = count(fixture.db, "time_calibrations");
    const demo = createApiHarness(fixture.store, { interviewDemo: true });
    await rejectsStatus(() => demo.call("DELETE", "/api/time-calibrations/events/event-one", {
      body: { confirm: true }, headers: { "if-match": currentCalibrationEtag }
    }), 403, "Demo deletion is forbidden");
    equal(demo.bodyReads, 0, "Demo write is rejected before reading its body");
    equal(count(fixture.db, "time_calibrations"), writesBeforeDemo, "Demo mutation performs zero writes");

    await rejectsStatus(() => harness.call("DELETE", "/api/time-calibrations/events/event-one", {
      body: { confirm: false }, headers: { "if-match": currentCalibrationEtag }
    }), 400, "DELETE requires explicit confirmation");
    await rejectsStatus(() => harness.call("DELETE", "/api/time-calibrations/events/event-one", {
      body: { confirm: true }
    }), 428, "DELETE requires If-Match");
    result = await harness.call("DELETE", "/api/time-calibrations/events/event-one", {
      body: { confirm: true }, headers: { "if-match": currentCalibrationEtag }
    });
    equal(result.statusCode, 200, "confirmed current DELETE succeeds");
    equal(fixture.store.getTimeCalibrationForEvent("event-one"), null, "DELETE removes only the calibration row");
    equal(fixture.db.prepare("SELECT COUNT(*) AS count FROM memory_events WHERE id = 'event-one'").get().count, 1, "DELETE never removes the event target");

  } finally {
    fixture.close();
  }
}

function createFixture(name, options = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  createSchema11(db);
  seedEvidence(db);
  const clock = { value: T0 };
  let id = 0;
  let transactionDepth = 0;
  function withTransaction(operation) {
    if (transactionDepth) return operation(Symbol.for("nested"));
    db.exec("BEGIN");
    transactionDepth += 1;
    try {
      const result = operation(Symbol.for("transaction"));
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    } finally {
      transactionDepth -= 1;
    }
  }
  let store = null;
  function initialize() {
    if (!store) {
      store = initializeTimeCalibrationDatabase({
        db,
        withTransaction,
        schemaVersion: 12,
        now: () => clock.value,
        createId: (prefix) => `${prefix}-${name}-${++id}`
      });
    }
    return store;
  }
  if (options.initialize !== false) initialize();
  return {
    db,
    clock,
    initialize,
    get store() { return store || initialize(); },
    close() { db.close(); }
  };
}

function createSchema11(db) {
  db.exec(`
    CREATE TABLE memories (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      memory_date TEXT NOT NULL DEFAULT '',
      raw_content TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE memory_events (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'confirmed',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE event_members (
      event_id TEXT NOT NULL,
      memory_id TEXT NOT NULL UNIQUE,
      position INTEGER NOT NULL DEFAULT 0,
      confirmed_at TEXT NOT NULL,
      PRIMARY KEY (event_id, memory_id),
      FOREIGN KEY (event_id) REFERENCES memory_events(id) ON DELETE CASCADE,
      FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
    );
    CREATE TABLE memory_claims (
      id TEXT PRIMARY KEY,
      memory_id TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      claim_key TEXT NOT NULL DEFAULT '',
      claim_type TEXT NOT NULL DEFAULT 'fact',
      value_json TEXT NOT NULL DEFAULT 'null',
      quote_text TEXT NOT NULL DEFAULT '',
      start_offset INTEGER,
      end_offset INTEGER,
      evidence_valid INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'extracted',
      FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
    );
    CREATE TABLE memory_pair_decisions (
      pair_key TEXT PRIMARY KEY,
      memory_a_id TEXT NOT NULL,
      memory_b_id TEXT NOT NULL,
      decision TEXT NOT NULL,
      FOREIGN KEY (memory_a_id) REFERENCES memories(id) ON DELETE CASCADE,
      FOREIGN KEY (memory_b_id) REFERENCES memories(id) ON DELETE CASCADE
    );
    CREATE TABLE memory_revisions (
      id TEXT PRIMARY KEY,
      memory_id TEXT NOT NULL,
      revision_no INTEGER NOT NULL,
      snapshot_json TEXT NOT NULL,
      snapshot_sha256 TEXT NOT NULL,
      FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
    );
    CREATE TABLE media_assets (
      id TEXT PRIMARY KEY,
      content_sha256 TEXT NOT NULL UNIQUE
    );
    CREATE TABLE memory_media (
      memory_id TEXT NOT NULL,
      asset_id TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (memory_id, asset_id),
      FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE,
      FOREIGN KEY (asset_id) REFERENCES media_assets(id) ON DELETE CASCADE
    );
    CREATE TABLE media_observations (
      id TEXT PRIMARY KEY,
      asset_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      source TEXT NOT NULL,
      value_json TEXT NOT NULL,
      status TEXT NOT NULL,
      sensitive INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (asset_id) REFERENCES media_assets(id) ON DELETE CASCADE
    );
  `);
  const legacy = [5, 6, 7, 8, 9, 10, 11].map((version) => ({
    version,
    name: `time-calibration-check-v${version}`,
    up(database) { database.exec(`CREATE TABLE time_calibration_legacy_v${version} (id TEXT PRIMARY KEY)`); }
  }));
  applyMigrations({ db, baselineVersion: 4, migrations: legacy, supportedVersion: 11, now: () => T0 });
}

function seedEvidence(db) {
  const insertMemory = db.prepare("INSERT INTO memories VALUES (?, ?, ?, ?, ?, ?)");
  insertMemory.run("memory-one", "Graduation retelling", "2021-06-19", "Date: 2021-06-20 was written in the diary.", T0, T0);
  insertMemory.run("memory-two", "Graduation photo", "2021-06-18", "Date: 2021-06-20 was also written in the album.", T0, T0);
  insertMemory.run("memory-three", "Unassessed memory", "2020-01-01", "Unrelated.", T0, T0);
  insertMemory.run("memory-four", "Explicit same event", "2021-06", "Confirmed separately.", T0, T0);
  db.prepare("INSERT INTO memory_events VALUES (?, ?, ?, ?, ?)").run("event-one", "Graduation evening", "confirmed", T0, T0);
  db.prepare("INSERT INTO event_members VALUES (?, ?, ?, ?)").run("event-one", "memory-one", 0, T0);
  db.prepare("INSERT INTO event_members VALUES (?, ?, ?, ?)").run("event-one", "memory-two", 1, T0);
  db.prepare("INSERT INTO memory_pair_decisions VALUES (?, ?, ?, ?)").run("pair-unassessed", "memory-one", "memory-three", "unassessed");
  db.prepare("INSERT INTO memory_pair_decisions VALUES (?, ?, ?, ?)").run("pair-confirmed", "memory-two", "memory-four", "same_event");
  db.prepare("INSERT INTO memory_revisions VALUES (?, ?, ?, ?, ?)").run(
    "revision-one", "memory-one", 1, JSON.stringify({ date: "2021-06-18" }), H.a
  );
  db.prepare("INSERT INTO memory_claims VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    "claim-valid", "memory-one", 0, "date", "date", JSON.stringify("2021-06-20"),
    "2021-06-20", 6, 16, 1, "extracted"
  );
  db.prepare("INSERT INTO memory_claims VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    "claim-invalid", "memory-one", 1, "date", "date", JSON.stringify("2021-06-21"),
    "2021-06-21", 6, 16, 0, "invalidated"
  );
  db.prepare("INSERT INTO memory_claims VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    "claim-location", "memory-one", 2, "location", "fact", JSON.stringify("2022"),
    "Date", 0, 4, 1, "extracted"
  );
  db.prepare("INSERT INTO memory_claims VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    "claim-alternatives", "memory-one", 3, "date", "date",
    JSON.stringify({ resolutionKind: "alternatives", intervalStart: "", intervalEnd: "" }),
    "2021-06-20", 6, 16, 1, "extracted"
  );
  db.prepare("INSERT INTO memory_claims VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    "claim-valid-two", "memory-two", 0, "date", "date", JSON.stringify("2021-06-20"),
    "2021-06-20", 6, 16, 1, "extracted"
  );
  db.prepare("INSERT INTO media_assets VALUES (?, ?)").run("asset-one", H.b);
  db.prepare("INSERT INTO media_assets VALUES (?, ?)").run("asset-unrelated", H.c);
  db.prepare("INSERT INTO memory_media VALUES (?, ?, ?)").run("memory-one", "asset-one", 0);
  db.prepare("INSERT INTO memory_media VALUES (?, ?, ?)").run("memory-three", "asset-unrelated", 0);
  db.prepare("INSERT INTO media_observations VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    "observation-date", "asset-one", "captured_at", "exif",
    JSON.stringify({ localDateTime: "2021-06-17T23:59:59", date: "2021-06-17", timezone: { kind: "local-floating", value: null } }),
    "suggested", 0
  );
  db.prepare("INSERT INTO media_observations VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    "observation-gps", "asset-one", "gps_coordinates", "exif",
    JSON.stringify({ latitude: 30.1, longitude: 120.2 }), "suggested", 1
  );
  db.prepare("INSERT INTO media_observations VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    "observation-unrelated", "asset-unrelated", "captured_at", "exif",
    JSON.stringify({ date: "2020-01-02", timezone: "" }), "confirmed", 0
  );
}

function createApiHarness(store, options = {}) {
  let bodyReads = 0;
  function httpError(statusCode, message) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
  }
  function sendJson(response, statusCode, payload) {
    response.statusCode = statusCode;
    response.payload = payload;
    response.setHeader("Cache-Control", "no-store");
    return payload;
  }
  async function readJsonBody(request) {
    bodyReads += 1;
    return request.body;
  }
  const api = createTimeCalibrationApi({
    store,
    interviewDemo: options.interviewDemo,
    sendJson,
    readJsonBody,
    httpError
  });
  return {
    get bodyReads() { return bodyReads; },
    async call(method, path, callOptions = {}) {
      const headers = Object.fromEntries(Object.entries(callOptions.headers || {}).map(([key, value]) => [key.toLowerCase(), value]));
      const request = { method, headers, body: callOptions.body };
      const responseHeaders = new Map();
      const response = {
        statusCode: 0,
        payload: null,
        setHeader(name, value) { responseHeaders.set(String(name).toLowerCase(), String(value)); },
        getHeader(name) { return responseHeaders.get(String(name).toLowerCase()) || ""; }
      };
      const handled = await api.handle(request, response, new URL(path, "http://127.0.0.1"));
      return {
        handled,
        statusCode: response.statusCode,
        payload: response.payload,
        getHeader: response.getHeader.bind(response)
      };
    }
  };
}

function snapshotOldCounts(db) {
  const tables = [
    "memories", "memory_events", "event_members", "memory_claims", "memory_pair_decisions",
    "memory_revisions", "media_assets", "memory_media", "media_observations"
  ];
  return Object.fromEntries(tables.map((table) => [table, count(db, table)]));
}

function remapFixtureIdentities(db, prefix) {
  db.exec("PRAGMA foreign_keys = OFF;");
  try {
    for (const table of ["event_members", "memory_claims", "memory_revisions", "memory_media"]) {
      db.exec(`UPDATE ${table} SET memory_id = '${prefix}' || memory_id;`);
    }
    db.exec(`UPDATE memory_pair_decisions SET memory_a_id = '${prefix}' || memory_a_id, memory_b_id = '${prefix}' || memory_b_id;`);
    db.exec(`UPDATE memories SET id = '${prefix}' || id;`);
    db.exec(`UPDATE event_members SET event_id = '${prefix}' || event_id;`);
    db.exec(`UPDATE memory_events SET id = '${prefix}' || id;`);
  } finally {
    db.exec("PRAGMA foreign_keys = ON;");
  }
  deepEqual(db.prepare("PRAGMA foreign_key_check").all(), [], "remapped restore fixture retains referential integrity");
}

function count(db, table) {
  return Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count) || 0;
}

function indexExists(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?").get(name));
}

function findIntervalPair(candidates, relation) {
  for (let left = 0; left < candidates.length; left += 1) {
    for (let right = left + 1; right < candidates.length; right += 1) {
      if (compareIntervals(candidates[left], candidates[right]) === relation) {
        return [candidates[left], candidates[right]];
      }
    }
  }
  return [];
}

async function rejectsStatus(operation, statusCode, message) {
  await assert.rejects(operation, (error) => Number(error?.statusCode) === statusCode, message);
  assertions += 1;
}

async function rejectsCode(operation, statusCode, code, message) {
  await assert.rejects(operation, (error) => Number(error?.statusCode) === statusCode && error?.code === code, message);
  assertions += 1;
}

function throwsCode(operation, code, message) {
  assert.throws(operation, (error) => error?.code === code, message);
  assertions += 1;
}

function check(value, message) {
  assert.ok(value, message);
  assertions += 1;
}

function equal(actual, expected, message) {
  assert.equal(actual, expected, message);
  assertions += 1;
}

function notEqual(actual, expected, message) {
  assert.notEqual(actual, expected, message);
  assertions += 1;
}

function deepEqual(actual, expected, message) {
  assert.deepEqual(actual, expected, message);
  assertions += 1;
}
