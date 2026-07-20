"use strict";

const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const { applyMigrations, listAppliedMigrations, readUserVersion } = require("../lib/migrations");
const {
  MEMORY_INBOX_ARCHIVE_PREFIX,
  MEMORY_INBOX_REDACTED_NOTE,
  MEMORY_INBOX_SECTION_NAME,
  MEMORY_INBOX_SECTION_PATH,
  MEMORY_INBOX_SECTION_VERSION,
  buildMemoryInboxBackup,
  validateMemoryInboxArchiveEnvelope,
  validateMemoryInboxBackupPayload
} = require("../lib/memory-inbox-backup");
const {
  MEMORY_INBOX_MIGRATION,
  initializeMemoryInboxDatabase
} = require("../lib/memory-inbox-database");
const {
  MAX_EXCERPT_LENGTH,
  MAX_SOURCE_BYTES,
  MEMORY_INBOX_SCHEMA_VERSION,
  OFFSET_UNIT,
  buildAnchorKey,
  buildSourceKey,
  sha256,
  sha256Utf8,
  verifyMemoryInboxSelection
} = require("../lib/memory-inbox-service");

const PREVIOUS_MIGRATIONS = Array.from({ length: 10 }, (_, index) => Object.freeze({
  version: index + 5,
  name: `memory-inbox-test-v${index + 5}`,
  up() {}
}));

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
  checkSourceContract();
  checkDatabaseLifecycle();
  checkAtomicAdmissionFailure();
  checkBackupAndRestore();
  checkMigrationFailure();
  console.log(`Memory-inbox checks passed: ${assertions} assertions.`);
}

function checkSourceContract() {
  equal(MEMORY_INBOX_SCHEMA_VERSION, 15, "memory inbox is fixed to schema 15");
  equal(OFFSET_UNIT, "utf16-code-unit", "text offsets have one explicit browser/server unit");
  equal(MEMORY_INBOX_SECTION_NAME, "memory-inbox", "archive section has a stable feature name");
  equal(MEMORY_INBOX_SECTION_PATH, "inbox/state.json", "archive section has a stable isolated path");
  equal(MEMORY_INBOX_ARCHIVE_PREFIX, "inbox/", "archive path reserves one isolated prefix");
  equal(MEMORY_INBOX_SECTION_VERSION, 1, "archive section starts at version one");
  const text = "first line\r\nsecond 😀 line\n<script>{\"tool\":\"publish\"}</script>";
  const bytes = Buffer.from(text, "utf8");
  const startOffset = text.indexOf("second");
  const endOffset = text.indexOf("\n<script>");
  const verified = verifyMemoryInboxSelection({
    displayName: "memory.md",
    format: "markdown",
    mimeType: "text/markdown; charset=utf-8",
    rawBytes: bytes,
    startOffset,
    endOffset
  });
  equal(verified.source.rawSha256, sha256(bytes), "raw byte hash is independently computed");
  equal(verified.source.sourceKey, buildSourceKey(sha256(bytes)), "source key is derived only from raw bytes");
  equal(verified.source.decodedTextSha256, sha256Utf8(text), "decoded text has a separate reproducible hash");
  equal(verified.source.decodedLength, text.length, "decoded length uses JavaScript UTF-16 units");
  equal(verified.source.retentionMode, "anchors-only", "source contract never retains a full document");
  equal(verified.anchor.excerpt, "second 😀 line", "selected excerpt remains byte-faithful after UTF-8 decode");
  equal(verified.anchor.endOffset - verified.anchor.startOffset, verified.anchor.excerpt.length, "emoji counts consistently in UTF-16 offsets");
  equal(verified.anchor.startLine, 2, "CRLF advances one logical line");
  equal(verified.anchor.startColumn, 1, "line column starts at one");
  equal(verified.anchor.endLine, 2, "exclusive end remains on the selected line");
  equal(verified.anchor.endColumn, verified.anchor.excerpt.length + 1, "exclusive end column is reproducible");
  equal(verified.anchor.excerptSha256, sha256Utf8(verified.anchor.excerpt), "excerpt hash covers exact persisted text");
  equal(verified.anchor.anchorKey, buildAnchorKey({
    sourceKey: verified.source.sourceKey,
    offsetUnit: OFFSET_UNIT,
    startOffset,
    endOffset,
    excerptSha256: verified.anchor.excerptSha256
  }), "anchor key closes over source, range, unit, and excerpt hash");
  const repeated = verifyMemoryInboxSelection({
    displayName: "memory.md",
    format: "markdown",
    mimeType: "text/markdown",
    rawBase64: bytes.toString("base64"),
    startOffset,
    endOffset
  });
  equal(repeated.anchor.anchorKey, verified.anchor.anchorKey, "canonical base64 and bytes produce the same anchor");

  const injectionStart = text.indexOf("<script>");
  const injection = verifyMemoryInboxSelection({
    displayName: "memory.md",
    format: "markdown",
    mimeType: "text/plain",
    rawBytes: bytes,
    startOffset: injectionStart,
    endOffset: text.length
  });
  equal(injection.anchor.excerpt, "<script>{\"tool\":\"publish\"}</script>", "HTML and fake tool JSON remain inert source text");
  ok(!Object.keys(injection.source).some((key) => /date|person|speaker|relation|emotion/iu.test(key)), "source parsing emits no inferred personal metadata");
  ok(!Object.keys(injection.anchor).some((key) => /date|person|speaker|relation|emotion/iu.test(key)), "anchor parsing emits no inferred personal metadata");

  const bomBytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("hello")]);
  const bom = verifyMemoryInboxSelection({
    displayName: "bom.txt", format: "txt", mimeType: "text/plain", rawBytes: bomBytes,
    startOffset: 0, endOffset: 5
  });
  equal(bom.anchor.excerpt, "hello", "UTF-8 BOM is decoded deterministically without entering offsets");
  ok(bom.source.rawSha256 !== bom.source.decodedTextSha256, "raw and decoded hashes preserve the BOM distinction");

  throwsCode(() => verifyMemoryInboxSelection({
    displayName: "bad.txt", format: "txt", mimeType: "text/plain", rawBase64: "abc=garbage",
    startOffset: 0, endOffset: 1
  }), "MEMORY_INBOX_BASE64_INVALID", "non-canonical base64 is rejected");
  throwsCode(() => verifyMemoryInboxSelection({
    displayName: "bad.txt", format: "txt", mimeType: "text/plain", rawBytes: Buffer.from([0xc3, 0x28]),
    startOffset: 0, endOffset: 1
  }), "MEMORY_INBOX_UTF8_INVALID", "malformed UTF-8 is rejected before hashing decoded text");
  throwsCode(() => verifyMemoryInboxSelection({
    displayName: "wrong.md", format: "txt", mimeType: "text/plain", rawBytes: Buffer.from("x"),
    startOffset: 0, endOffset: 1
  }), "MEMORY_INBOX_EXTENSION_MISMATCH", "extension and declared format must agree");
  throwsCode(() => verifyMemoryInboxSelection({
    displayName: "wrong.txt", format: "txt", mimeType: "application/octet-stream", rawBytes: Buffer.from("x"),
    startOffset: 0, endOffset: 1
  }), "MEMORY_INBOX_MIME_UNSUPPORTED", "binary MIME is rejected");
  throwsCode(() => verifyMemoryInboxSelection({
    displayName: "empty.txt", format: "txt", mimeType: "text/plain", rawBytes: Buffer.from("   "),
    startOffset: 0, endOffset: 1
  }), "MEMORY_INBOX_SOURCE_EMPTY", "whitespace-only sources are rejected");
  throwsCode(() => verifyMemoryInboxSelection({
    displayName: "nul.txt", format: "txt", mimeType: "text/plain", rawBytes: Buffer.from("a\0b"),
    startOffset: 0, endOffset: 1
  }), "MEMORY_INBOX_TEXT_UNSUPPORTED", "NUL-bearing text is rejected");
  throwsCode(() => verifyMemoryInboxSelection({
    displayName: "range.txt", format: "txt", mimeType: "text/plain", rawBytes: Buffer.from("abc"),
    startOffset: 2, endOffset: 2
  }), "MEMORY_INBOX_RANGE_INVALID", "empty ranges are rejected");
  throwsCode(() => verifyMemoryInboxSelection({
    displayName: "large.txt", format: "txt", mimeType: "text/plain", rawBytes: Buffer.from("x".repeat(MAX_EXCERPT_LENGTH + 1)),
    startOffset: 0, endOffset: MAX_EXCERPT_LENGTH + 1
  }), "MEMORY_INBOX_EXCERPT_TOO_LARGE", "oversized excerpts are rejected");
  throwsCode(() => verifyMemoryInboxSelection({
    displayName: "huge.txt", format: "txt", mimeType: "text/plain", rawBytes: Buffer.alloc(MAX_SOURCE_BYTES + 1, 0x61),
    startOffset: 0, endOffset: 1
  }), "MEMORY_INBOX_SOURCE_TOO_LARGE", "oversized source files are rejected before decode");
  throwsCode(() => verifyMemoryInboxSelection({
    displayName: "both.txt", format: "txt", mimeType: "text/plain", rawBytes: Buffer.from("x"),
    rawBase64: Buffer.from("x").toString("base64"), startOffset: 0, endOffset: 1
  }), "MEMORY_INBOX_SOURCE_BYTES_INVALID", "source input must choose exactly one byte representation");
  throwsCode(() => verifyMemoryInboxSelection({
    displayName: "extra.txt", format: "txt", mimeType: "text/plain", rawBytes: Buffer.from("x"),
    startOffset: 0, endOffset: 1, inferredDate: "2026-01-01"
  }), "MEMORY_INBOX_FIELD_SET_INVALID", "source contract rejects extra inference fields");
}

function checkDatabaseLifecycle() {
  const fixture = createFixture("lifecycle");
  try {
    deepEqual(listAppliedMigrations(fixture.db).map((entry) => entry.version),
      [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], "schema ledger advances continuously to 15");
    equal(readUserVersion(fixture.db), 15, "PRAGMA user_version advances to 15");
    const ledger = JSON.stringify(listAppliedMigrations(fixture.db));
    initializeMemoryInboxDatabase({ db: fixture.db, schemaVersion: 15, now: fixture.now, applyMigrations: true });
    equal(JSON.stringify(listAppliedMigrations(fixture.db)), ledger, "reinitialization verifies rather than rewrites migration history");

    const sourceColumns = fixture.db.prepare("PRAGMA table_info(memory_inbox_sources)").all().map((row) => row.name);
    ok(!sourceColumns.some((name) => /content|bytes|body|text$/iu.test(name) && !["decoded_text_sha256"].includes(name)), "source table has no full-document payload column");
    const triggers = fixture.db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name").all().map((row) => row.name);
    ok(triggers.includes("memory_inbox_anchor_immutable"), "schema installs immutable-anchor trigger");
    ok(triggers.includes("memory_inbox_source_immutable"), "schema installs immutable-source trigger");
    ok(triggers.includes("memory_inbox_terminal_state"), "schema installs terminal-state trigger");

    const raw = Buffer.from("alpha paragraph\n\nbeta paragraph 😀\n\nthird paragraph", "utf8");
    const text = raw.toString("utf8");
    const first = fixture.inbox.createMemoryInboxItem(selection(raw, "notes.md", "markdown", 0, text.indexOf("\n\n")), {
      idempotencyKey: "create_alpha_001"
    });
    ok(first.created && !first.idempotent, "explicit creation persists one pending item");
    equal(first.item.status, "pending", "new item starts pending");
    equal(first.source.retentionMode, "anchors-only", "database persists descriptor-only retention mode");
    deepEqual(fixture.inbox.getMemoryInboxStats(), {
      sources: 1, items: 1, pending: 1, dismissed: 0, accepted: 0, orphaned: 0, needsReview: 0
    }, "initial inbox stats are exact");

    const replay = fixture.inbox.createMemoryInboxItem(selection(raw, "notes.md", "markdown", 0, text.indexOf("\n\n")), {
      idempotencyKey: "create_alpha_001"
    });
    ok(!replay.created && replay.idempotent, "same create key and request replays without a write");
    equal(replay.item.id, first.item.id, "create replay returns the original item");
    throwsCode(() => fixture.inbox.createMemoryInboxItem(selection(raw, "notes.md", "markdown", text.indexOf("beta"), text.indexOf("\n\nthird")), {
      idempotencyKey: "create_alpha_001"
    }), "MEMORY_INBOX_IDEMPOTENCY_CONFLICT", "same create key cannot name a different range");
    throwsCode(() => fixture.inbox.createMemoryInboxItem(selection(raw, "notes.md", "markdown", 0, text.indexOf("\n\n")), {
      idempotencyKey: "create_alpha_002"
    }), "MEMORY_INBOX_ANCHOR_EXISTS", "same anchor cannot be duplicated with a new operation key");

    const betaStart = text.indexOf("beta");
    const betaEnd = text.indexOf("\n\nthird");
    const second = fixture.inbox.createMemoryInboxItem(selection(raw, "notes.md", "markdown", betaStart, betaEnd), {
      idempotencyKey: "create_beta_001"
    });
    equal(second.source.id, first.source.id, "two anchors from identical bytes reuse one source descriptor");
    deepEqual(fixture.inbox.listMemoryInboxItems({ status: "pending" }).map((item) => item.id),
      [second.item.id, first.item.id], "pending list is stable newest-first");

    throwsCode(() => fixture.inbox.dismissMemoryInboxItem(second.item.id, { expectedVersion: 1 }),
      "MEMORY_INBOX_CONFIRMATION_REQUIRED", "dismiss requires explicit confirmation");
    throwsCode(() => fixture.inbox.dismissMemoryInboxItem(second.item.id, { confirm: true }),
      "MEMORY_INBOX_PRECONDITION_REQUIRED", "dismiss requires a version precondition");
    const dismissed = fixture.inbox.dismissMemoryInboxItem(second.item.id, { confirm: true, expectedVersion: 1 });
    equal(dismissed.item.status, "dismissed", "pending item can be explicitly dismissed");
    equal(dismissed.item.version, 2, "dismiss increments item version");
    throwsCode(() => fixture.inbox.reopenMemoryInboxItem(second.item.id, { confirm: true, expectedVersion: 1 }),
      "MEMORY_INBOX_VERSION_CONFLICT", "stale reopen is rejected");
    const reopened = fixture.inbox.reopenMemoryInboxItem(second.item.id, { confirm: true, expectedVersion: 2 });
    equal(reopened.item.status, "pending", "dismissed item can be explicitly reopened");
    equal(reopened.item.version, 3, "reopen increments item version");

    assert.throws(() => fixture.db.prepare("UPDATE memory_inbox_items SET excerpt_text = 'tampered' WHERE id = ?").run(first.item.id),
      /MEMORY_INBOX_ANCHOR_IMMUTABLE/u, "direct SQL cannot alter an anchor");
    assertions += 1;
    equal(fixture.inbox.getMemoryInboxItem(first.item.id).excerpt, "alpha paragraph", "failed tamper leaves excerpt intact");
    assert.throws(() => fixture.db.prepare("UPDATE memory_inbox_sources SET display_name = 'changed.md' WHERE id = ?").run(first.source.id),
      /MEMORY_INBOX_SOURCE_IMMUTABLE/u, "direct SQL cannot rewrite a source descriptor");
    assertions += 1;

    const admitted = fixture.inbox.admitMemoryInboxItem(first.item.id, {
      id: "memory-alpha",
      title: "Manually confirmed title",
      rawContent: "client attempted overwrite",
      agentRunId: "untrusted-run"
    }, { confirm: true, expectedVersion: 1, idempotencyKey: "admit_alpha_001" });
    ok(admitted.admitted && !admitted.idempotent, "pending item admits exactly one memory");
    equal(admitted.memory.rawContent, "alpha paragraph", "admission copies immutable excerpt over client rawContent");
    equal(admitted.memory.agentRunId, "", "admission cannot attach an untrusted agent run");
    equal(admitted.item.status, "accepted", "admission receipt becomes accepted");
    equal(admitted.item.memoryId, "memory-alpha", "accepted receipt links the created memory");
    const admissionReplay = fixture.inbox.admitMemoryInboxItem(first.item.id, {
      id: "memory-alpha", title: "Manually confirmed title", rawContent: "client attempted overwrite", agentRunId: "untrusted-run"
    }, { confirm: true, expectedVersion: 1, idempotencyKey: "admit_alpha_001" });
    ok(!admissionReplay.admitted && admissionReplay.idempotent, "admission replay returns the existing memory before version rejection");
    equal(fixture.memoryCount(), 1, "admission replay creates no duplicate memory");
    throwsCode(() => fixture.inbox.dismissMemoryInboxItem(first.item.id, { confirm: true, expectedVersion: 2 }),
      "MEMORY_INBOX_STATE_INVALID", "accepted item cannot return to a mutable state");

    assert.throws(() => fixture.db.prepare("DELETE FROM memories WHERE id = ?").run("memory-alpha"),
      /FOREIGN KEY constraint failed/u, "accepted receipt prevents uncoordinated memory deletion");
    assertions += 1;
    const detached = fixture.inbox.detachMemoryInboxAdmission("memory-alpha");
    equal(detached.detached, 1, "coordinated deletion first detaches the admission receipt");
    equal(detached.item.status, "orphaned", "detached accepted receipt becomes an orphaned audit record");
    ok(detached.item.needsReview, "orphaned receipt is projected to curation review");
    equal(detached.item.acceptedAt, admitted.item.acceptedAt, "orphaning preserves original admission time");
    fixture.db.prepare("DELETE FROM memories WHERE id = ?").run("memory-alpha");
    equal(fixture.memoryCount(), 0, "memory deletion succeeds only after explicit detach");
    deepEqual(fixture.inbox.getMemoryInboxStats(), {
      sources: 1, items: 2, pending: 1, dismissed: 0, accepted: 0, orphaned: 1, needsReview: 1
    }, "stats expose pending and review state without repairing it");

    const cleared = fixture.inbox.clearMemoryInbox();
    deepEqual(cleared, { memoryInboxItemsDeleted: 2, memoryInboxSourcesDeleted: 1 }, "purge helper clears children before source descriptors");
    deepEqual(fixture.inbox.getMemoryInboxStats(), {
      sources: 0, items: 0, pending: 0, dismissed: 0, accepted: 0, orphaned: 0, needsReview: 0
    }, "clear leaves no inbox tombstone rows");
  } finally {
    fixture.close();
  }
}

function checkAtomicAdmissionFailure() {
  const fixture = createFixture("rollback", { failAdmission: true });
  try {
    const raw = Buffer.from("rollback source");
    const created = fixture.inbox.createMemoryInboxItem(selection(raw, "rollback.txt", "txt", 0, raw.length), {
      idempotencyKey: "create_rollback_001"
    });
    assert.throws(() => fixture.inbox.admitMemoryInboxItem(created.item.id, { id: "rolled-back-memory" }, {
      confirm: true, expectedVersion: 1, idempotencyKey: "admit_rollback_001"
    }), /injected admission failure/u, "injected save failure reaches caller");
    assertions += 1;
    equal(fixture.memoryCount(), 0, "failed admission rolls back the memory insert");
    equal(fixture.inbox.getMemoryInboxItem(created.item.id).status, "pending", "failed admission leaves item pending");
    equal(fixture.inbox.getMemoryInboxItem(created.item.id).version, 1, "failed admission leaves version unchanged");
  } finally {
    fixture.close();
  }
}

function checkBackupAndRestore() {
  const source = createFixture("backup-source");
  let full;
  try {
    const raw = Buffer.from("accepted source\n\npending source 😀", "utf8");
    const text = raw.toString("utf8");
    const acceptedItem = source.inbox.createMemoryInboxItem(selection(raw, "archive.md", "markdown", 0, text.indexOf("\n\n")), {
      idempotencyKey: "create_archive_001"
    });
    source.inbox.admitMemoryInboxItem(acceptedItem.item.id, { id: "source-memory", title: "Confirmed" }, {
      confirm: true, expectedVersion: 1, idempotencyKey: "admit_archive_001"
    });
    source.inbox.createMemoryInboxItem(selection(raw, "archive.md", "markdown", text.indexOf("pending"), text.length), {
      idempotencyKey: "create_archive_002"
    });
    full = source.inbox.buildMemoryInboxBackup("full");
    ok(source.inbox.validateMemoryInboxBackup(full, ["source-memory"]), "full backup validates hashes, ranges, and memory boundary");
    equal(full.sources.length, 1, "full backup deduplicates source descriptors");
    equal(full.items.length, 2, "full backup preserves accepted and pending receipts");
    ok(!JSON.stringify(full.sources).includes("rawBase64"), "full backup contains no original file bytes");
    ok(!Object.keys(full.sources[0]).some((key) => /fullContent|rawBytes|sourceText/iu.test(key)), "full source descriptor has no hidden payload field");

    const boundary = source.inbox.buildMemoryInboxBackup("full", ["source-memory"]);
    equal(boundary.items.length, 1, "bounded export excludes unrelated pending inbox text");
    equal(boundary.items[0].status, "accepted", "bounded export retains the linked admission receipt");

    const redacted = source.inbox.buildMemoryInboxBackup("redacted");
    deepEqual(redacted, {
      mode: "redacted-summary",
      sourceCount: 1,
      itemCount: 2,
      pendingCount: 1,
      dismissedCount: 0,
      acceptedCount: 1,
      orphanedCount: 0,
      note: MEMORY_INBOX_REDACTED_NOTE
    }, "redacted backup contains counts and one fixed disclosure only");
    const redactedJson = JSON.stringify(redacted);
    for (const secret of ["archive.md", "accepted source", full.sources[0].rawSha256, full.items[0].anchorKey, "source-memory"]) {
      ok(!redactedJson.includes(secret), `redacted backup physically removes ${secret.slice(0, 16)}`);
    }
    ok(validateMemoryInboxBackupPayload(redacted), "redacted summary validates independently");
    ok(validateMemoryInboxArchiveEnvelope(redacted, "redacted"), "redacted archive envelope matches its privacy mode");
    throwsCode(() => validateMemoryInboxArchiveEnvelope(redacted, "full"),
      "MEMORY_INBOX_BACKUP_INVALID", "archive envelope rejects a mismatched privacy mode");

    const tamperCases = [
      ["unknown source field", (copy) => { copy.sources[0].extra = true; }],
      ["source hash", (copy) => { copy.sources[0].rawSha256 = "0".repeat(64); }],
      ["source key", (copy) => { copy.sources[0].sourceKey = `text-source:${"0".repeat(64)}`; }],
      ["excerpt", (copy) => { copy.items[0].excerpt = "tampered"; }],
      ["excerpt hash", (copy) => { copy.items[0].excerptSha256 = "0".repeat(64); }],
      ["anchor key", (copy) => { copy.items[0].anchorKey = `text-anchor:${"0".repeat(64)}`; }],
      ["range", (copy) => { copy.items[0].endOffset += 1; }],
      ["missing source", (copy) => { copy.items[0].sourceId = "missing-source"; }],
      ["accepted state", (copy) => { copy.items[0].memoryId = ""; }],
      ["duplicate anchor", (copy) => { copy.items[1].anchorKey = copy.items[0].anchorKey; }],
      ["cross-table id", (copy) => { copy.items[0].id = copy.sources[0].id; }]
    ];
    for (const [label, mutate] of tamperCases) {
      const copy = clone(full);
      mutate(copy);
      throwsCode(() => validateMemoryInboxBackupPayload(copy, { memoryIds: ["source-memory"] }),
        label === "missing source" ? "MEMORY_INBOX_BACKUP_REFERENCE_INVALID" : "MEMORY_INBOX_BACKUP_INVALID",
        `${label} tampering is rejected`);
    }
    throwsCode(() => validateMemoryInboxBackupPayload(full, { memoryIds: [] }),
      "MEMORY_INBOX_BACKUP_REFERENCE_INVALID", "accepted receipt cannot escape the memory export boundary");
  } finally {
    source.close();
  }

  const target = createFixture("backup-target");
  try {
    target.insertMemory("target-memory", "accepted source");
    const restored = target.inbox.restoreMemoryInboxBackup(full, {
      memoryIdMap: new Map([["source-memory", "target-memory"]])
    });
    equal(restored.sources, 1, "restore plans every source descriptor");
    equal(restored.items, 2, "restore plans every receipt");
    equal(restored.skipped, 0, "restore cannot silently skip a receipt");
    equal(target.inbox.getMemoryInboxReceiptForMemory("target-memory").item.status, "accepted", "accepted memory link is remapped");
    equal(target.inbox.getMemoryInboxReceiptForMemory("target-memory").item.excerpt, "accepted source", "restored receipt preserves exact excerpt");
    equal(target.inbox.getMemoryInboxStats().pending, 1, "unlinked pending item survives full archive restore");
    ok(target.inbox.validateMemoryInboxBackup(target.inbox.buildMemoryInboxBackup("full"), ["target-memory"]), "restored state self-validates");

    const replay = target.inbox.restoreMemoryInboxBackup(full, {
      memoryIdMap: { "source-memory": "target-memory" }
    });
    equal(replay.reused, 3, "semantic restore replay reuses one source and two anchors");
    equal(target.inbox.getMemoryInboxStats().items, 2, "restore replay creates no duplicates");

    const redactedResult = target.inbox.restoreMemoryInboxBackup(buildMemoryInboxBackup({ sources: [], items: [] }, "redacted"), {
      memoryIdMap: {}
    });
    ok(redactedResult.summarized, "redacted summary restore is explicitly non-restoring");
    equal(target.inbox.getMemoryInboxStats().items, 2, "redacted summary changes no business data");
  } finally {
    target.close();
  }
}

function checkMigrationFailure() {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("PRAGMA foreign_keys = ON; CREATE TABLE memories (id TEXT PRIMARY KEY, raw_content TEXT NOT NULL DEFAULT '');");
    applyMigrations({ db, baselineVersion: 4, migrations: PREVIOUS_MIGRATIONS, supportedVersion: 14, now: () => "2026-07-19T00:00:00.000Z" });
    db.exec("CREATE TABLE memory_inbox_sources (id TEXT PRIMARY KEY)");
    throwsCode(() => initializeMemoryInboxDatabase({
      db, schemaVersion: 15, now: () => "2026-07-19T00:00:01.000Z"
    }), "MIGRATION_APPLY_FAILED", "DDL collision rolls schema 15 migration back atomically");
    equal(readUserVersion(db), 14, "failed migration leaves user_version at 14");
    ok(!listAppliedMigrations(db).some((entry) => entry.version === 15), "failed migration leaves no schema 15 ledger tombstone");
    equal(db.prepare("SELECT COUNT(*) AS count FROM pragma_table_info('memory_inbox_sources')").get().count, 1,
      "failed migration preserves the pre-existing conflicting table only");
  } finally {
    db.close();
  }
}

function createFixture(label, options = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE memories (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      raw_content TEXT NOT NULL,
      agent_run_id TEXT NOT NULL DEFAULT ''
    );
  `);
  let tick = 0;
  let id = 0;
  const now = () => new Date(Date.parse("2026-07-19T00:00:00.000Z") + tick++).toISOString();
  applyMigrations({ db, baselineVersion: 4, migrations: PREVIOUS_MIGRATIONS, supportedVersion: 14, now });
  const inbox = initializeMemoryInboxDatabase({
    db,
    schemaVersion: 15,
    now,
    createId: (prefix) => `${prefix}-${label}-${++id}`,
    saveMemory(memory) {
      db.prepare("INSERT INTO memories (id, title, raw_content, agent_run_id) VALUES (?, ?, ?, ?)")
        .run(memory.id, String(memory.title || ""), memory.rawContent, String(memory.agentRunId || ""));
      if (options.failAdmission) throw new Error("injected admission failure");
      return { ...memory };
    },
    getMemory(memoryId) {
      const row = db.prepare("SELECT * FROM memories WHERE id = ?").get(memoryId);
      return row ? { id: row.id, title: row.title, rawContent: row.raw_content, agentRunId: row.agent_run_id } : null;
    }
  });
  return {
    db,
    inbox,
    now,
    insertMemory(memoryId, rawContent = "") {
      db.prepare("INSERT INTO memories (id, raw_content) VALUES (?, ?)").run(memoryId, rawContent);
    },
    memoryCount() {
      return Number(db.prepare("SELECT COUNT(*) AS count FROM memories").get().count);
    },
    close() { db.close(); }
  };
}

function selection(rawBytes, displayName, format, startOffset, endOffset) {
  return {
    displayName,
    format,
    mimeType: format === "txt" ? "text/plain" : "text/markdown",
    rawBytes,
    startOffset,
    endOffset
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
