"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { createMemoryStore } = require("../database");
const { buildStoredMultiPerspectivePreview } = require("../lib/multi-perspective-api");
const { createCollectionExporter } = require("../lib/collection-export");
const { createCollectionImporter } = require("../lib/collection-import");
const {
  buildArchaeologyBackup,
  restoreArchaeologyBackup,
  validateArchaeologyBackup
} = require("../lib/archaeology-backup");
const { catalogSourceToClaimSource } = require("../lib/provenance-service");
const cryptoProtocol = require("../public/assets/co-memory-crypto.js");

const SCHEMA_VERSION = 19;
const APP_VERSION = "16.0.0";
const MEMORY_ID = "memory-v16-multi-perspective-integration";
const HALLS = Object.freeze([
  { id: "daily", name: "日常展厅", description: "" }
]);
const COLLECTION_SECTIONS = Object.freeze([
  "archaeology", "capsules", "coMemoryResponses", "count", "curatorAgent", "entities",
  "exhibitions", "exportedAt", "memories", "memoryInbox", "mode", "oralHistories", "privacy",
  "product", "productEnglish", "provenance", "revisitIntents", "revisions", "revisits",
  "schemaVersion", "timeCalibrations", "version", "voices"
].sort());

let assertions = 0;

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});

async function main() {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "time-isle-multi-perspective-integration-"));
  let sourceStore = null;
  let restoredStore = null;
  try {
    sourceStore = createStore(path.join(temporaryRoot, "source.sqlite"));
    sourceStore.saveMemory(createMemory());

    const confirmation = await sourceStore.confirmCoMemoryResponse(await createResponseContract(), {
      idempotencyKey: "v16-multi-perspective-response-confirm"
    });
    ok(confirmation.created, "an explicitly confirmed co-memory response is saved in the real schema 19 store");

    const unlinked = buildReadOnlyPreview(sourceStore, MEMORY_ID, "unlinked preview");
    equal(unlinked.summary.replyCount, 1, "the confirmed reply appears as a perspective");
    equal(unlinked.summary.linkedReplyCount, 0, "a saved reply is not silently treated as linked");
    equal(unlinked.summary.unlinkedReplyCount, 1, "the unlinked reply count remains explicit");
    equal(unlinked.summary.claimCount, 0, "no comparison is invented before provenance confirmation");
    equal(unlinked.comparisonClaims.length, 0, "the unbound reply has no comparison card");
    equal(replyPerspective(unlinked).relationState, "unlinked", "the reply visibly remains unlinked");

    const catalog = sourceStore.listProvenanceSources(MEMORY_ID);
    const memorySource = catalog.find((source) => source.kind === "memory_text");
    const responseSource = catalog.find((source) => source.kind === "co_memory_response");
    ok(memorySource, "the real source catalog exposes the current memory text");
    ok(responseSource, "the real source catalog exposes the confirmed co-memory response");
    const memoryResolution = sourceStore.resolveProvenanceSource(MEMORY_ID, {
      kind: memorySource.kind,
      referenceId: memorySource.referenceId,
      sourceKey: memorySource.sourceKey,
      snapshotSha256: memorySource.snapshotSha256,
      startOffset: 0,
      endOffset: sourceStore.getMemory(MEMORY_ID).rawContent.length
    });
    equal(memoryResolution.status, "resolved", "the real catalog resolves an explicit UTF-16 range of the original text");

    const draft = sourceStore.createProvenanceClaim({
      memoryId: MEMORY_ID,
      statement: "关于散场时是否已经下雨，馆主与回信人留下了不同记录。",
      sources: [
        catalogSourceToClaimSource(memoryResolution.source, { relationKind: "supports", sensitive: false }),
        catalogSourceToClaimSource(responseSource, { relationKind: "different_record", sensitive: false })
      ]
    }, { idempotencyKey: "v16-multi-perspective-claim-create" });
    equal(draft.claim.status, "draft", "binding sources first creates only a provenance draft");

    const confirmed = sourceStore.confirmProvenanceClaim(draft.claim.id, {
      confirm: true,
      expectedVersion: draft.claim.version,
      idempotencyKey: "v16-multi-perspective-claim-confirm"
    });
    equal(confirmed.claim.status, "confirmed", "the comparison becomes active only after explicit confirmation");

    const linked = buildReadOnlyPreview(sourceStore, MEMORY_ID, "linked preview");
    equal(linked.summary.linkedReplyCount, 1, "confirmed provenance links the saved reply");
    equal(linked.summary.unlinkedReplyCount, 0, "the linked reply leaves no unlinked remainder");
    equal(linked.summary.claimCount, 1, "one confirmed multi-perspective comparison is derived");
    equal(linked.comparisonClaims.length, 1, "the confirmed relation produces one comparison card");
    equal(linked.comparisonClaims[0].status, "confirmed", "the current comparison is visibly confirmed");
    equal(linked.comparisonClaims[0].needsReview, false, "the current comparison does not overstate review state");
    deepEqual(
      linked.comparisonClaims[0].sources.map((source) => source.relationKind),
      ["supports", "different_record"],
      "the DTO preserves only the human-confirmed relation labels"
    );
    deepEqual(
      linked.comparisonClaims[0].sources.map((source) => source.perspectiveId),
      ["perspective-current", "perspective-reply-01"],
      "the comparison points only to public preview-local perspective IDs"
    );
    equal(ownerPerspective(linked).relationState, "linked-by-confirmed-provenance",
      "the owner record is linked only by confirmed provenance");
    equal(replyPerspective(linked).relationState, "linked-by-confirmed-provenance",
      "the reply is linked only by confirmed provenance");

    const beforeEdit = sourceStore.getMemory(MEMORY_ID);
    sourceStore.saveMemory({
      ...beforeEdit,
      rawContent: "后来我重新整理了记录：散场时天空还是干的，雨是走到车站后才下的。",
      exhibitText: "这次编辑保留了旧记录，也让已确认的来源关系进入待复核。"
    }, {
      requireExisting: true,
      expectedUpdatedAt: beforeEdit.updatedAt,
      changeNote: "V16 integration: revise the original wording"
    });

    const staleClaim = sourceStore.getProvenanceClaim(draft.claim.id);
    equal(staleClaim.lifecycleStatus, "confirmed", "editing does not erase the human confirmation event");
    equal(staleClaim.status, "needsReview", "editing the original text moves the claim to needsReview");
    ok(staleClaim.needsReview && !staleClaim.sourcesCurrent,
      "the real provenance resolver marks the changed source as non-current");

    const reviewed = buildReadOnlyPreview(sourceStore, MEMORY_ID, "needs-review preview");
    equal(reviewed.summary.claimCount, 1, "the historical comparison remains visible after source change");
    equal(reviewed.summary.needsReviewCount, 1, "the preview counts the stale comparison for review");
    equal(reviewed.comparisonClaims[0].status, "needsReview", "the comparison card exposes needsReview");
    ok(reviewed.comparisonClaims[0].needsReview && !reviewed.comparisonClaims[0].sourcesCurrent,
      "the comparison card cannot present stale sources as current");
    equal(reviewed.summary.revisionCount, 1, "the current head is excluded while the earlier owner version remains");
    equal(reviewed.editHistory.length, 1, "one earlier owner version is derived from the real revision ledger");
    equal(reviewed.editHistory[0].authorBoundary, "same-owner-edit-history",
      "the revision is permanently labelled as same-owner history");
    ok(reviewed.editHistory[0].boundary.includes("不等于另一人的记忆"),
      "the revision boundary cannot be mistaken for another perspective");

    const buildExport = createCollectionExporter({
      store: sourceStore,
      appVersion: APP_VERSION,
      schemaVersion: SCHEMA_VERSION,
      buildArchaeologyBackup
    });
    const archive = buildExport(sourceStore.listMemories(), "full");
    equal(archive.schemaVersion, SCHEMA_VERSION, "V16 keeps the durable archive at schema 19");
    deepEqual(Object.keys(archive).sort(), COLLECTION_SECTIONS,
      "the full archive keeps exactly the pre-V16 collection sections");
    ok(!Object.keys(archive).some((key) => /perspective/iu.test(key)),
      "the derived multi-perspective DTO adds no archive section");

    restoredStore = createStore(path.join(temporaryRoot, "restored.sqlite"));
    const importCollection = createImporter(restoredStore);
    const restored = importCollection(JSON.parse(JSON.stringify(archive)));
    equal(restored.imported, 1, "the existing complete JSON restore imports the memory");
    equal(restored.revisions.revisions, 2, "the existing restore rebuilds the full owner revision ledger");
    equal(restored.coMemoryResponses.responses, 1, "the existing restore rebuilds the confirmed reply");
    equal(restored.provenance.claims, 1, "the existing restore rebuilds the provenance claim");

    const rebuilt = buildReadOnlyPreview(restoredStore, MEMORY_ID, "restored preview");
    deepEqual(publicDto(rebuilt), publicDto(reviewed),
      "the same public multi-perspective DTO is re-derived after export and restore");
    equal(rebuilt.comparisonClaims[0].status, "needsReview",
      "restoration re-evaluates the changed source instead of persisting a V16 view");
    equal(rebuilt.editHistory[0].authorBoundary, "same-owner-edit-history",
      "restored revision history keeps the same-owner boundary");

    const rebuiltArchive = createCollectionExporter({
      store: restoredStore,
      appVersion: APP_VERSION,
      schemaVersion: SCHEMA_VERSION,
      buildArchaeologyBackup
    })(restoredStore.listMemories(), "full");
    deepEqual(Object.keys(rebuiltArchive).sort(), COLLECTION_SECTIONS,
      "re-export after reconstruction still has no V16-specific section");

    const restoredClaim = restoredStore.listProvenanceClaims(MEMORY_ID)[0];
    equal(restoredClaim.lifecycleStatus, "confirmed",
      "the restored needs-review claim still has a confirmed lifecycle before withdrawal");
    const withdrawn = restoredStore.withdrawProvenanceClaim(restoredClaim.id, {
      confirm: true,
      expectedVersion: restoredClaim.version,
      idempotencyKey: "v16-multi-perspective-restored-claim-withdraw"
    });
    ok(withdrawn.changed && withdrawn.claim.status === "withdrawn",
      "an explicit withdrawal appends the withdrawn lifecycle event");

    const afterWithdrawal = buildReadOnlyPreview(restoredStore, MEMORY_ID, "withdrawn preview");
    equal(afterWithdrawal.summary.claimCount, 0,
      "a withdrawn claim no longer contributes a comparison");
    equal(afterWithdrawal.comparisonClaims.length, 0,
      "a withdrawn claim produces no comparison card");
    equal(afterWithdrawal.summary.linkedReplyCount, 0,
      "withdrawal removes the reply from the confirmed-provenance linked count");
    equal(afterWithdrawal.summary.unlinkedReplyCount, 1,
      "the saved reply remains available but explicitly unlinked after withdrawal");
    equal(ownerPerspective(afterWithdrawal).relationState, "unlinked",
      "the owner perspective returns to unlinked after withdrawal");
    equal(replyPerspective(afterWithdrawal).relationState, "unlinked",
      "the related reply returns to unlinked after withdrawal");

    console.log(`Multi-perspective integration checks passed: ${assertions} assertions.`);
  } finally {
    try { restoredStore?.close(); } catch { /* preserve the original failure */ }
    try { sourceStore?.close(); } catch { /* preserve the original failure */ }
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function createStore(dbPath) {
  return createMemoryStore({ dbPath, halls: HALLS, schemaVersion: SCHEMA_VERSION });
}

function buildReadOnlyPreview(store, memoryId, label) {
  const before = store.getStats();
  const preview = buildStoredMultiPerspectivePreview(store, memoryId);
  const after = store.getStats();
  deepEqual(after, before, `${label} leaves every durable database statistic unchanged`);
  equal(preview.execution.persisted, false, `${label} declares zero persistence`);
  return preview;
}

function createImporter(store) {
  return createCollectionImporter({
    store,
    normalizeMemory: (input) => ({ ...input, schemaVersion: SCHEMA_VERSION }),
    sanitizeId,
    createId: (prefix) => `${prefix}-${randomUUID()}`,
    validateArchaeologyBackup,
    restoreArchaeologyBackup,
    httpError,
    schemaVersion: SCHEMA_VERSION
  });
}

function createMemory() {
  const createdAt = "2026-07-20T08:00:00.000Z";
  return {
    schemaVersion: SCHEMA_VERSION,
    id: MEMORY_ID,
    title: "雨夜散场的两种记录",
    hall: "daily",
    sourceType: "其他",
    rawContent: "我记得离开礼堂时已经下起了小雨。",
    exhibitText: "同一段经历，允许不同人留下不同记录。",
    date: "2021-06-19",
    location: "礼堂",
    people: [],
    tags: ["散场", "雨夜"],
    emotions: ["怀念"],
    emotionIntensity: 3,
    importance: 4,
    favorite: false,
    coverImage: "",
    mediaNote: "",
    attachments: [],
    agentRunId: "",
    createdAt,
    updatedAt: createdAt
  };
}

async function createResponseContract() {
  const letterId = "letter_v16_multi_perspective_0001";
  const request = cryptoProtocol.validateRequestPayload({
    format: cryptoProtocol.REQUEST_FORMAT,
    version: cryptoProtocol.VERSION,
    letterId,
    question: "你记得散场时已经下雨了吗？",
    context: {
      title: "",
      note: `[time-isle-memory-anchor:v1:${MEMORY_ID}]\n只回答你亲自记得的部分。`,
      evidence: [{ key: "evidence-1", kind: "quote", text: "我记得离开礼堂时已经下起了小雨。" }]
    },
    boundary: cryptoProtocol.REQUEST_BOUNDARY
  });
  const requestSha256 = await cryptoProtocol.digestRequestPayload(request);
  const response = cryptoProtocol.validateResponsePayload({
    format: cryptoProtocol.RESPONSE_FORMAT,
    version: cryptoProtocol.VERSION,
    letterId,
    responseId: "response_v16_multi_perspective_0001",
    requestSha256,
    identity: {
      label: "一位回信人（自述）",
      assurance: cryptoProtocol.IDENTITY_ASSURANCE,
      verified: false
    },
    answer: "我记得散场时还没下雨，雨是后来在路上才下的。",
    boundary: cryptoProtocol.RESPONSE_BOUNDARY
  });
  return {
    confirm: true,
    memoryId: MEMORY_ID,
    requestSha256,
    request,
    response,
    source: {
      kind: "co_memory_response",
      relationKind: "supplements",
      label: response.identity.label,
      excerpt: response.answer,
      identityAssurance: cryptoProtocol.IDENTITY_ASSURANCE,
      identityVerified: false,
      encrypted: true,
      signed: false
    }
  };
}

function ownerPerspective(preview) {
  return preview.perspectives.find((item) => item.kind === "owner_current");
}

function replyPerspective(preview) {
  return preview.perspectives.find((item) => item.kind === "co_memory_response");
}

function publicDto(preview) {
  const { receipt: _receipt, ...dto } = preview;
  return dto;
}

function sanitizeId(value) {
  const id = String(value || "").trim();
  return /^[A-Za-z0-9_-]{1,120}$/u.test(id) ? id : "";
}

function httpError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}

function ok(value, message) {
  assert.ok(value, message);
  assertions += 1;
}

function equal(actual, expected, message) {
  assert.equal(actual, expected, message);
  assertions += 1;
}

function deepEqual(actual, expected, message) {
  assert.deepEqual(actual, expected, message);
  assertions += 1;
}
