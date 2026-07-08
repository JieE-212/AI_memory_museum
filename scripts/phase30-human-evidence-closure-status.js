const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const docsRoot = path.join(projectRoot, "项目文档");
const liveSubmissionPath = path.join(projectRoot, "data", "phase30-human-evidence-submission.json");

const requiredEvidence = [
  { evidenceId: "release-blocker-disposition", owner: "release owner" },
  { evidenceId: "transition-redline-disposition", owner: "release owner" },
  { evidenceId: "signoff-evidence-reconciliation", owner: "release owner" },
  { evidenceId: "release-runtime-separation", owner: "release owner" },
  { evidenceId: "runtime-owner-go-no-go", owner: "runtime owner" },
  { evidenceId: "rollback-strategy-review", owner: "runtime owner" },
  { evidenceId: "sandbox-acceptance-review", owner: "security reviewer" },
  { evidenceId: "secret-boundary-review", owner: "security reviewer" },
  { evidenceId: "private-memory-boundary-review", owner: "data steward" },
  { evidenceId: "audit-dry-run-review", owner: "audit reviewer" },
];

const requiredFields = [
  "reviewer",
  "reviewedAt",
  "evidenceRef",
  "disposition",
  "decisionReason",
  "residualRisk",
];

const riskFollowupFields = ["followUpOwner", "recoveryCondition", "targetReviewDate"];
const allowedDispositions = new Set([
  "approved-with-evidence",
  "accepted-with-risk",
  "deferred-with-owner",
  "rejected",
  "blocked",
]);
const followUpDispositions = new Set(["accepted-with-risk", "deferred-with-owner", "blocked"]);
const placeholderValues = new Set(["pending", "missing", "unassigned", "YYYY-MM-DD"]);

function readText(...parts) {
  return fs.readFileSync(path.join(...parts), "utf8");
}

function assert(label, condition) {
  if (!condition) {
    console.error(`not ok - ${label}`);
    process.exit(1);
  }
  console.log(`ok - ${label}`);
}

function hasPlaceholder(value) {
  const text = String(value || "").trim();
  if (!text) return true;
  return placeholderValues.has(text) || text.includes("REPLACE_WITH_");
}

function isDateLike(value) {
  return /^\d{4}-\d{2}-\d{2}/.test(String(value || ""));
}

function inspectRecord(record, expected) {
  const missingFields = [];
  const invalidFields = [];

  if (!record) {
    return {
      evidenceId: expected.evidenceId,
      owner: expected.owner,
      status: "missing-record",
      disposition: "missing",
      missingFields: requiredFields,
      invalidFields: [],
      blocksRelease: true,
      blocksPhase29Exit: true,
      blocksPhase30Entry: true,
      blocksRuntime: true,
      blocksThirdPartyExecution: true,
    };
  }

  if (record.owner !== expected.owner) invalidFields.push("owner");
  for (const field of requiredFields) {
    if (hasPlaceholder(record[field])) missingFields.push(field);
  }
  if (!hasPlaceholder(record.reviewedAt) && !isDateLike(record.reviewedAt)) invalidFields.push("reviewedAt");
  if (!allowedDispositions.has(record.disposition)) invalidFields.push("disposition");

  if (followUpDispositions.has(record.disposition)) {
    for (const field of riskFollowupFields) {
      if (hasPlaceholder(record[field])) missingFields.push(field);
    }
    if (!hasPlaceholder(record.targetReviewDate) && !isDateLike(record.targetReviewDate)) {
      invalidFields.push("targetReviewDate");
    }
  }

  const complete = missingFields.length === 0 && invalidFields.length === 0;
  const blockingDisposition = ["rejected", "blocked", "deferred-with-owner"].includes(record.disposition);

  return {
    evidenceId: expected.evidenceId,
    owner: expected.owner,
    status: complete ? (blockingDisposition ? "complete-but-blocking" : "complete") : "incomplete",
    disposition: record.disposition || "missing",
    reviewer: record.reviewer || "",
    reviewedAt: record.reviewedAt || "",
    evidenceRef: record.evidenceRef || "",
    missingFields,
    invalidFields,
    blocksRelease: !complete || blockingDisposition,
    blocksPhase29Exit: !complete || blockingDisposition,
    blocksPhase30Entry: !complete || blockingDisposition,
    blocksRuntime: !complete || blockingDisposition || expected.evidenceId.includes("runtime"),
    blocksThirdPartyExecution: true,
  };
}

function buildStatus(submission) {
  const records = Array.isArray(submission?.records) ? submission.records : [];
  const byId = new Map();
  const duplicateIds = [];

  for (const record of records) {
    if (!record || !record.evidenceId) continue;
    if (byId.has(record.evidenceId)) duplicateIds.push(record.evidenceId);
    byId.set(record.evidenceId, record);
  }

  const slots = requiredEvidence.map((expected) => inspectRecord(byId.get(expected.evidenceId), expected));
  const completeSlots = slots.filter((slot) => slot.status === "complete" || slot.status === "complete-but-blocking").length;
  const approvedSlots = slots.filter((slot) => slot.status === "complete" && slot.disposition === "approved-with-evidence").length;
  const blockingSlots = slots.filter((slot) => slot.blocksRelease || slot.blocksRuntime);
  const missingSlots = slots.filter((slot) => slot.status === "missing-record" || slot.missingFields.length > 0);
  const invalidSlots = slots.filter((slot) => slot.invalidFields.length > 0);

  return {
    schemaVersion: "phase30.human-evidence-closure-status.v1",
    source: submission ? "live-submission-status" : "no-live-submission-status",
    liveSubmissionPath: "data/phase30-human-evidence-submission.json",
    liveSubmissionExists: Boolean(submission),
    noAutomaticApproval: true,
    releaseReady: false,
    phase29ExitReady: false,
    phase30EntryReady: false,
    runtimeExecution: false,
    thirdPartyExecution: false,
    summary: {
      requiredSlots: requiredEvidence.length,
      completeSlots,
      approvedSlots,
      missingSlots: missingSlots.length,
      invalidSlots: invalidSlots.length,
      duplicateIds: [...new Set(duplicateIds)].length,
      blockingSlots: blockingSlots.length,
      readyForConversionPreflight: Boolean(submission) && completeSlots === requiredEvidence.length && invalidSlots.length === 0 && duplicateIds.length === 0,
      readyForReleaseApproval: false,
      readyForPhase29Exit: false,
      readyForPhase30Entry: false,
      readyForRuntimeExecution: false,
      readyForThirdPartyExecution: false,
    },
    slots,
    duplicateIds: [...new Set(duplicateIds)],
    nextActions: buildNextActions(Boolean(submission), slots, duplicateIds),
  };
}

function buildNextActions(hasLiveSubmission, slots, duplicateIds) {
  if (!hasLiveSubmission) {
    return [
      "collect-real-reviewer-output-for-all-10-evidence-slots",
      "keep-data/phase30-human-evidence-submission.json-absent-until-maintainer-conversion-approval",
      "run-phase30-post-review-evidence-summary-before-any-live-submission-conversion",
    ];
  }

  const actions = [];
  if (duplicateIds.length) actions.push("remove-duplicate-evidence-records");
  for (const slot of slots) {
    if (slot.status === "missing-record") actions.push(`add-record:${slot.evidenceId}`);
    for (const field of slot.missingFields) actions.push(`fill-${field}:${slot.evidenceId}`);
    for (const field of slot.invalidFields) actions.push(`fix-${field}:${slot.evidenceId}`);
  }
  if (!actions.length) {
    actions.push("run-phase30-live-submission-conversion-preflight");
    actions.push("run-phase30-human-evidence-conflict-review");
    actions.push("run-phase30-evidence-submission-gate");
  }
  return [...new Set(actions)];
}

function loadLiveSubmission() {
  if (!fs.existsSync(liveSubmissionPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(liveSubmissionPath, "utf8"));
  } catch (error) {
    console.error(`not ok - live submission JSON is parseable: ${error.message}`);
    process.exit(1);
  }
}

const packageJson = JSON.parse(readText(projectRoot, "package.json"));
const server = readText(projectRoot, "server.js");
const gateDoc = readText(docsRoot, "阶段30人工证据提交门禁.md");
const handoffDoc = readText(docsRoot, "阶段30人工Reviewer交接包.md");
const summaryDoc = readText(docsRoot, "阶段30会后证据汇总包.md");

assert("human evidence closure status does not change active phase", server.includes("const PHASE = 29"));
assert("human evidence closure status does not change version", packageJson.version === "1.9.48");
assert(
  "package exposes human evidence closure status command",
  packageJson.scripts["phase30:evidence-closure-status"] === "node scripts/phase30-human-evidence-closure-status.js"
);
assert(
  "check pipeline includes human evidence closure status command",
  packageJson.scripts.check.includes("node scripts/phase30-human-evidence-closure-status.js")
);
assert("submission gate defines live evidence path", gateDoc.includes("data/phase30-human-evidence-submission.json"));
assert("reviewer handoff defines reviewer responsibilities", requiredEvidence.every((item) => handoffDoc.includes(item.evidenceId)));
assert("post-review summary keeps conversion manual", summaryDoc.includes("维护者明确确认") && summaryDoc.includes("不自动创建"));

const status = buildStatus(loadLiveSubmission());
console.log(JSON.stringify(status, null, 2));
console.log("Phase 30 human evidence closure status checks passed.");
