"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  MULTI_PERSPECTIVE_ENGINE,
  MULTI_PERSPECTIVE_FORMAT,
  MULTI_PERSPECTIVE_LIMITS,
  buildMultiPerspectivePreview
} = require("../lib/multi-perspective-service");

const H = Object.freeze({
  a: "a".repeat(64), b: "b".repeat(64), c: "c".repeat(64), d: "d".repeat(64), e: "e".repeat(64)
});
let assertions = 0;

run();

function run() {
  const input = fixtureInput();
  const preview = buildMultiPerspectivePreview(input);
  equal(preview.format, MULTI_PERSPECTIVE_FORMAT, "preview uses the frozen format");
  equal(preview.version, 1, "preview uses contract version 1");
  equal(preview.execution.engine, MULTI_PERSPECTIVE_ENGINE, "preview identifies its deterministic engine");
  equal(preview.execution.externalModel, false, "preview calls no external model");
  equal(preview.execution.modelCalls, 0, "preview reports zero model calls");
  equal(preview.execution.toolCalls, 0, "preview reports zero tool calls");
  equal(preview.execution.persisted, false, "preview is never persisted");
  equal(preview.target.id, "memory-a", "preview remains scoped to one memory");
  equal(preview.perspectives.length, 3, "current record and two replies become three perspectives");
  equal(preview.summary.replyCount, 2, "reply count is explicit");
  equal(preview.summary.linkedReplyCount, 1, "only the provenance-linked reply is linked");
  equal(preview.summary.unlinkedReplyCount, 1, "unbound reply remains unlinked");
  equal(preview.summary.claimCount, 1, "only confirmed cross-perspective claim is shown");
  equal(preview.comparisonClaims[0].sources[0].relationKind, "supports", "support label comes from provenance");
  equal(preview.comparisonClaims[0].sources[1].relationKind, "different_record", "different-record label comes from provenance");
  equal(preview.comparisonClaims[0].sources[1].relationLabel, "留下另一种记录", "relation uses restrained Chinese copy");
  equal(preview.perspectives.find((item) => item.label.includes("另一位朋友")).relationState, "unlinked",
    "free reply text never invents a relation");
  equal(preview.perspectives.find((item) => item.label.includes("阿棠")).identity.verified, false,
    "reply identity remains unverified");
  equal(preview.perspectives.find((item) => item.label.includes("阿棠")).identity.signed, false,
    "reply remains unsigned");
  ok(preview.perspectives.find((item) => item.label.includes("阿棠")).identity.boundary.includes("身份未核验"),
    "unverified boundary remains visible");
  equal(preview.editHistory.length, 1, "current revision head is removed from old edit history");
  equal(preview.editHistory[0].authorBoundary, "same-owner-edit-history", "revision is never called another person's view");
  ok(preview.editHistory[0].boundary.includes("不等于另一人的记忆"), "revision boundary is understandable");
  equal(preview.timeContext.calibration.resolutionKind, "alternatives", "current human time decision remains visible");
  ok(preview.timeContext.boundary.includes("不会改写原文"), "time context never claims a write-back");
  ok(/^[a-f0-9]{64}$/u.test(preview.receipt.sourceSnapshotSha256), "source receipt is a SHA-256 digest");
  ok(/^[a-f0-9]{64}$/u.test(preview.receipt.previewSha256), "preview receipt is a SHA-256 digest");
  ok(Object.isFrozen(preview) && Object.isFrozen(preview.perspectives) && Object.isFrozen(preview.comparisonClaims),
    "preview contract is deeply frozen");

  const shuffled = fixtureInput();
  shuffled.responses.reverse();
  shuffled.revisions.reverse();
  shuffled.passport.claims.reverse();
  const deterministic = buildMultiPerspectivePreview(shuffled);
  equal(deterministic.receipt.previewSha256, preview.receipt.previewSha256,
    "input retrieval order does not change the deterministic preview");
  deepEqual(deterministic, preview, "deterministic preview bytes are stable after source reordering");

  const changed = fixtureInput();
  changed.responses[0].response.answer = "同一位回信人的新回答";
  changed.responses[0].excerpt = "同一位回信人的新回答";
  changed.responses[0].snapshotSha256 = H.e;
  notEqual(buildMultiPerspectivePreview(changed).receipt.sourceSnapshotSha256, preview.receipt.sourceSnapshotSha256,
    "changed saved reply changes the source receipt");

  const stale = fixtureInput();
  confirmedClaim(stale).needsReview = true;
  confirmedClaim(stale).status = "needsReview";
  confirmedClaim(stale).sourcesCurrent = false;
  const stalePreview = buildMultiPerspectivePreview(stale);
  equal(stalePreview.comparisonClaims[0].status, "needsReview", "confirmed relation becomes needsReview when its source changes");
  ok(stalePreview.comparisonClaims[0].boundary.includes("重新核对"), "needs-review copy does not call the claim false");

  const draftOnly = fixtureInput();
  confirmedClaim(draftOnly).lifecycleStatus = "draft";
  confirmedClaim(draftOnly).status = "draft";
  const draftPreview = buildMultiPerspectivePreview(draftOnly);
  equal(draftPreview.comparisonClaims.length, 0, "unconfirmed provenance relation is not presented as a comparison");
  equal(draftPreview.summary.linkedReplyCount, 0, "draft claim does not mark a reply as linked");

  const supportsOnly = fixtureInput();
  confirmedClaim(supportsOnly).sources = [confirmedClaim(supportsOnly).sources[1]];
  const supportsOnlyPreview = buildMultiPerspectivePreview(supportsOnly);
  equal(supportsOnlyPreview.comparisonClaims.length, 0, "one reply attached to a claim is not a multi-perspective comparison");
  equal(supportsOnlyPreview.summary.linkedReplyCount, 1, "confirmed single-source claim still records that the reply is linked");

  const long = fixtureInput();
  const longSource = long.responses.find((item) => item.id === "response-a");
  longSource.request.question = "问".repeat(MULTI_PERSPECTIVE_LIMITS.questionCharacters + 3);
  longSource.response.answer = "答".repeat(MULTI_PERSPECTIVE_LIMITS.excerptCharacters + 3);
  longSource.excerpt = longSource.response.answer;
  const longPreview = buildMultiPerspectivePreview(long);
  const longReply = longPreview.perspectives.find((item) => item.label.includes("阿棠"));
  equal([...longReply.question].length, MULTI_PERSPECTIVE_LIMITS.questionCharacters, "question preview is bounded");
  equal([...longReply.excerpt].length, MULTI_PERSPECTIVE_LIMITS.excerptCharacters, "reply preview is bounded");
  ok(longReply.questionTruncated && longReply.excerptTruncated, "bounded reply reports truncation");

  const many = fixtureInput();
  many.responses = Array.from({ length: 20 }, (_, index) => ({
    ...response(`response-${String(index).padStart(2, "0")}`, H.a, 1),
    createdAt: "2026-01-05T00:00:00.000Z"
  }));
  many.passport.claims = [{
    id: "claim-hidden-linked",
    memoryId: "memory-a",
    statement: "一封未进入首屏的回信仍有已确认来源关系。",
    status: "confirmed",
    lifecycleStatus: "confirmed",
    needsReview: false,
    sourcesCurrent: true,
    etag: "hidden-linked",
    sources: [
      claimSource("memory_text", "supports", "memory:memory-a", "当前原文"),
      claimSource("co_memory_response", "supplements", "co-memory:response-19", "较早回信")
    ]
  }];
  const manyPreview = buildMultiPerspectivePreview(many);
  equal(manyPreview.perspectives.length, MULTI_PERSPECTIVE_LIMITS.responses + 1, "fixed reply display cap is enforced");
  ok(manyPreview.perspectivesTruncated, "reply truncation is explicit");
  equal(manyPreview.summary.replyCount, 20, "summary preserves total reply count");
  equal(manyPreview.summary.linkedReplyCount, 1, "hidden but linked reply remains in the full summary");
  equal(manyPreview.summary.unlinkedReplyCount, 19, "full summary never mislabels a hidden linked reply as unlinked");

  const manyClaims = fixtureInput();
  manyClaims.passport.claims = Array.from({ length: 25 }, (_, index) => ({
    ...confirmedClaim(fixtureInput()),
    id: `claim-${String(index).padStart(2, "0")}`,
    statement: `已确认的对照关系 ${index + 1}`,
    needsReview: index < 5,
    status: index < 5 ? "needsReview" : "confirmed"
  }));
  const manyClaimsPreview = buildMultiPerspectivePreview(manyClaims);
  equal(manyClaimsPreview.comparisonClaims.length, MULTI_PERSPECTIVE_LIMITS.claims, "visible claim list uses a fixed cap");
  ok(manyClaimsPreview.comparisonClaimsTruncated, "claim truncation is explicit");
  equal(manyClaimsPreview.summary.claimCount, 25, "claim summary counts the full bounded input");
  equal(manyClaimsPreview.summary.needsReviewCount, 5, "needs-review summary counts claims beyond the visible cap");

  const manyRevisions = fixtureInput();
  manyRevisions.revisions = Array.from({ length: 12 }, (_, index) => ({
    ...revision(`revision-many-${String(index + 1).padStart(2, "0")}`, index + 1, `2020-${String(index + 1).padStart(2, "0")}-01`, `第 ${index + 1} 次旧记录。`, H.a),
    createdAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString()
  }));
  const manyRevisionsPreview = buildMultiPerspectivePreview(manyRevisions);
  equal(manyRevisionsPreview.editHistory.length, MULTI_PERSPECTIVE_LIMITS.revisions, "visible edit history uses a fixed cap");
  ok(manyRevisionsPreview.editHistoryTruncated, "edit-history truncation is explicit");
  equal(manyRevisionsPreview.summary.revisionCount, 12, "revision summary counts the full bounded input");

  const serialized = JSON.stringify(preview);
  ok(!/passphrase|salt|ciphertext|requestSha256|sourceKey|anchorKey|memory-anchor/iu.test(serialized),
    "public preview excludes cryptographic and internal source identifiers");
  ok(!/response-a|response-b|revision-old|revision-head|claim-confirmed|claim-draft/u.test(serialized),
    "public preview excludes response, revision and claim record IDs");
  ok(preview.perspectives.every((item) => /^perspective-(?:current|reply-\d{2})$/u.test(item.id)),
    "perspective IDs are per-preview opaque positions");
  ok(preview.editHistory.every((item) => !Object.hasOwn(item, "revisionId") && /^edit-\d{2}$/u.test(item.id)),
    "edit history exposes no revision record ID");
  ok(!/truth|accuracy|confidence|谁对谁错|谁更准确/iu.test(serialized),
    "preview contains no truth or confidence scoring");

  throwsCode(() => buildMultiPerspectivePreview({ ...fixtureInput(), unexpected: true }), "MULTI_PERSPECTIVE_INPUT_INVALID",
    "unknown root fields are rejected");
  const crossMemory = fixtureInput();
  crossMemory.responses[0].memoryId = "memory-b";
  throwsCode(() => buildMultiPerspectivePreview(crossMemory), "MULTI_PERSPECTIVE_RESPONSE_INVALID",
    "cross-memory reply is rejected");
  const overstated = fixtureInput();
  overstated.responses[0].identityVerified = true;
  throwsCode(() => buildMultiPerspectivePreview(overstated), "MULTI_PERSPECTIVE_RESPONSE_INVALID",
    "verified identity overstatement is rejected");
  const inventedRelation = fixtureInput();
  confirmedClaim(inventedRelation).sources[0].relationKind = "contradicts";
  throwsCode(() => buildMultiPerspectivePreview(inventedRelation), "MULTI_PERSPECTIVE_RELATION_INVALID",
    "non-provenance relation is rejected");
  const sparse = fixtureInput();
  sparse.responses = new Array(2);
  sparse.responses[1] = response("response-sparse", H.a, 1);
  throwsCode(() => buildMultiPerspectivePreview(sparse), "MULTI_PERSPECTIVE_INPUT_INVALID",
    "sparse source arrays are rejected");
  const excessive = fixtureInput();
  excessive.responses = Array.from({ length: MULTI_PERSPECTIVE_LIMITS.hardResponses + 1 }, (_, index) => response(`response-${index}`, H.a, index));
  throwsCode(() => buildMultiPerspectivePreview(excessive), "MULTI_PERSPECTIVE_LIMIT_EXCEEDED",
    "hard reply budget fails closed");

  const serviceSource = fs.readFileSync(path.join(__dirname, "..", "lib", "multi-perspective-service.js"), "utf8");
  ok(!/\bfetch\s*\(|https?:\/\//u.test(serviceSource), "service has no network capability");
  ok(!/child_process|spawn\s*\(|exec\s*\(/u.test(serviceSource), "service has no process capability");
  ok(!/INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM/iu.test(serviceSource), "service has no persistence statement");
  ok(!/openai|chat\/completions|embedding/iu.test(serviceSource), "service contains no model integration");
  ok(!/\beval\s*\(|new\s+Function\b/u.test(serviceSource), "service contains no dynamic execution");

  console.log(`Multi-perspective service checks passed: ${assertions} assertions.`);
}

function fixtureInput() {
  const current = {
    id: "memory-a",
    title: "雨夜散场",
    rawContent: "我记得散场时下着雨。",
    exhibitText: "一段仍保留不同记录的雨夜。",
    date: "2021-06-19",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-03T00:00:00.000Z"
  };
  const responseA = response("response-a", H.a, 1);
  const responseB = response("response-b", H.b, 2);
  return {
    memory: current,
    responses: [responseB, responseA],
    revisions: [
      revision("revision-old", 1, "2021-06-18", "我最初写成十八日。", H.c),
      revision("revision-head", 2, current.date, current.rawContent, H.d)
    ],
    passport: {
      memoryId: "memory-a",
      claims: [
        {
          id: "claim-draft",
          memoryId: "memory-a",
          statement: "这条草稿不应出现在对照关系里。",
          status: "draft",
          lifecycleStatus: "draft",
          needsReview: false,
          sourcesCurrent: true,
          etag: "draft",
          sources: []
        },
        {
          id: "claim-confirmed",
          memoryId: "memory-a",
          statement: "关于散场时是否下雨，留下了两种记录。",
          status: "confirmed",
          lifecycleStatus: "confirmed",
          needsReview: false,
          sourcesCurrent: true,
          etag: "confirmed-v2",
          sources: [
            claimSource("memory_text", "supports", "memory:memory-a", "我记得散场时下着雨。"),
            claimSource("co_memory_response", "different_record", "co-memory:response-a", "我记得雨是后来才下的。")
          ]
        }
      ]
    },
    timeContext: {
      targetType: "event",
      targetTitle: "毕业散场",
      needsReview: false,
      calibration: {
        targetType: "event",
        resolutionKind: "alternatives",
        intervalStart: "",
        intervalEnd: "",
        selectedSourceKeys: [`time-source:${H.a}`, `time-source:${H.b}`],
        updatedAt: "2026-01-04T00:00:00.000Z"
      }
    },
    synthetic: false
  };
}

function response(id, digest, day) {
  return {
    id,
    kind: "co_memory_response",
    memoryId: "memory-a",
    label: day === 1 ? "阿棠（自述）" : "另一位朋友（自述）",
    excerpt: day === 1 ? "我记得雨是后来才下的。" : "我也记得那晚很潮。",
    identityAssurance: "self-asserted-unverified",
    identityVerified: false,
    encrypted: true,
    signed: false,
    snapshotSha256: digest,
    request: { question: "你记得散场时已经下雨了吗？" },
    response: {
      identity: { label: "自述称呼", assurance: "self-asserted-unverified", verified: false },
      answer: day === 1 ? "我记得雨是后来才下的。" : "我也记得那晚很潮。"
    },
    createdAt: `2026-01-0${day + 4}T00:00:00.000Z`
  };
}

function revision(id, revisionNo, date, rawContent, digest) {
  return {
    id,
    memoryId: "memory-a",
    revisionNo,
    changeKind: revisionNo === 1 ? "created" : "edited",
    snapshotSha256: digest,
    snapshot: {
      title: "雨夜散场",
      date,
      rawContent,
      exhibitText: "一段仍保留不同记录的雨夜。"
    },
    createdAt: `2026-01-0${revisionNo}T00:00:00.000Z`
  };
}

function claimSource(kind, relationKind, referenceId, excerpt) {
  return {
    sourceKind: kind,
    relationKind,
    originRef: { provider: "provenance-source-catalog-v1", memoryId: "memory-a", referenceId },
    snapshot: { excerpt, metadata: { label: kind === "memory_text" ? "当前展品原文" : "阿棠（自述）" } },
    integrityStatus: "source_verified"
  };
}

function confirmedClaim(input) {
  return input.passport.claims.find((claim) => claim.id === "claim-confirmed");
}

function ok(value, message) { assert.ok(value, message); assertions += 1; }
function equal(actual, expected, message) { assert.equal(actual, expected, message); assertions += 1; }
function notEqual(actual, expected, message) { assert.notEqual(actual, expected, message); assertions += 1; }
function deepEqual(actual, expected, message) { assert.deepEqual(actual, expected, message); assertions += 1; }
function throwsCode(callback, code, message) {
  assert.throws(callback, (error) => error?.code === code, message);
  assertions += 1;
}
