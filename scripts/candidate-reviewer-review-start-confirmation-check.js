const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const docsDir = path.join(projectRoot, "项目文档");
const reviewStartPath = path.join(docsDir, "当前候选交付Reviewer审查启动确认模板.md");
const blockerLedgerPath = path.join(docsDir, "当前候选交付Reviewer审查中阻塞与澄清问题台账.md");
const handoffReceiptPath = path.join(docsDir, "当前候选交付Reviewer交付签收与退回回执模板.md");
const handoffExecutionPath = path.join(docsDir, "当前候选交付Reviewer实际交付执行清单.md");
const preReviewPath = path.join(docsDir, "当前候选交付审查前包索引.md");
const sequencePath = path.join(docsDir, "当前候选交付人工审查执行顺序总表.md");
const integrityPath = path.join(docsDir, "当前候选交付人工审查链完整性索引.md");
const negativePath = path.join(docsDir, "当前候选交付负向用例防误用检查.md");
const finalLockPath = path.join(docsDir, "当前候选交付人工审查包最终锁定索引.md");
const liveSubmissionPath = path.join(projectRoot, "data", "phase30-human-evidence-submission.json");

function readText(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function assert(label, condition) {
  if (!condition) {
    console.error(`not ok - ${label}`);
    process.exit(1);
  }
  console.log(`ok - ${label}`);
}

const packageJson = JSON.parse(readText("package.json"));
const readme = readText("README.md");
const reviewStart = fs.readFileSync(reviewStartPath, "utf8");
const blockerLedger = fs.readFileSync(blockerLedgerPath, "utf8");
const handoffReceipt = fs.readFileSync(handoffReceiptPath, "utf8");
const handoffExecution = fs.readFileSync(handoffExecutionPath, "utf8");
const preReview = fs.readFileSync(preReviewPath, "utf8");
const sequence = fs.readFileSync(sequencePath, "utf8");
const integrity = fs.readFileSync(integrityPath, "utf8");
const negative = fs.readFileSync(negativePath, "utf8");
const finalLock = fs.readFileSync(finalLockPath, "utf8");

const confirmationFields = [
  "reviewStartConfirmationId",
  "sourceHandoffReceiptId",
  "handoffPackageRef",
  "reviewerName",
  "reviewerRole",
  "reviewStartedAt",
  "assignedEvidenceSlots",
  "scopeUnderstood",
  "redlinesUnderstood",
  "requiredFieldsUnderstood",
  "outputChannelConfirmed",
  "returnChannelConfirmed",
  "cannotApproveByStartConfirmation",
  "cannotCreateLiveSubmission",
  "reviewStartStatus",
  "blockerReason",
  "nextAction",
];

const statuses = [
  "review-started",
  "blocked-by-missing-material",
  "blocked-by-unclear-scope",
  "blocked-by-role-mismatch",
  "blocked-by-reviewer-unavailability",
  "cancelled",
];

const reviewerRoles = [
  "release owner",
  "runtime owner",
  "security reviewer",
  "data steward",
  "audit reviewer",
];

const requiredSlots = [
  "release-blocker-disposition",
  "transition-redline-disposition",
  "signoff-evidence-reconciliation",
  "release-runtime-separation",
  "runtime-owner-go-no-go",
  "rollback-strategy-review",
  "sandbox-acceptance-review",
  "secret-boundary-review",
  "private-memory-boundary-review",
  "audit-dry-run-review",
];

const requiredReviewerFields = [
  "reviewer",
  "reviewedAt",
  "evidenceRef",
  "disposition",
  "decisionReason",
  "residualRisk",
];

const followupFields = [
  "followUpOwner",
  "recoveryCondition",
  "targetReviewDate",
];

const commands = [
  "npm.cmd run candidate:reviewer-review-start-confirmation-check",
  "npm.cmd run candidate:reviewer-in-review-blocker-clarification-check",
  "npm.cmd run candidate:reviewer-handoff-receipt-check",
  "npm.cmd run candidate:reviewer-handoff-execution-check",
  "npm.cmd run candidate:final-review-package-lock-check",
  "npm.cmd run candidate:negative-misuse-check",
  "npm.cmd run candidate:review-chain-integrity-check",
  "npm.cmd run candidate:review-execution-sequence-check",
  "npm.cmd run phase30:evidence-closure-status",
  "npm.cmd run check",
];

assert("candidate reviewer review start confirmation check does not change app version", packageJson.version === "1.9.48");
assert(
  "package exposes candidate reviewer review start confirmation check command",
  packageJson.scripts["candidate:reviewer-review-start-confirmation-check"] ===
    "node scripts/candidate-reviewer-review-start-confirmation-check.js"
);
assert(
  "check pipeline includes candidate reviewer review start confirmation check",
  packageJson.scripts.check.includes("node scripts/candidate-reviewer-review-start-confirmation-check.js")
);
assert("reviewer review start confirmation template exists", fs.existsSync(reviewStartPath));
assert("reviewer review start confirmation template is template-only", reviewStart.includes("reviewer-review-start-confirmation-template-only"));
assert(
  "reviewer review start confirmation template preserves candidate state",
  reviewStart.includes("APP_VERSION=1.9.48") &&
    reviewStart.includes("PHASE=29") &&
    reviewStart.includes("rc-reviewable-but-not-releasable")
);
assert(
  "reviewer review start confirmation template keeps gates blocked",
  reviewStart.includes("releaseReady=false") &&
    reviewStart.includes("phase29ExitReady=false") &&
    reviewStart.includes("phase30EntryReady=false") &&
    reviewStart.includes("runtimeExecution=false") &&
    reviewStart.includes("thirdPartyExecution=false")
);
assert(
  "reviewer review start confirmation template records missing evidence state",
  reviewStart.includes("liveSubmissionExists=false") &&
    reviewStart.includes("approvedSlots=0") &&
    reviewStart.includes("missingSlots=10")
);
assert(
  "reviewer review start confirmation template blocks conversion by default",
  reviewStart.includes("maintainerConversionAuthorization=false") &&
    reviewStart.includes("readyForLiveSubmissionCreation=false")
);
assert("reviewer review start confirmation template lists fields", confirmationFields.every((field) => reviewStart.includes(field)));
assert("reviewer review start confirmation template lists statuses", statuses.every((status) => reviewStart.includes(status)));
assert("reviewer review start confirmation template covers reviewer roles", reviewerRoles.every((role) => reviewStart.includes(role)));
assert("reviewer review start confirmation template covers all slots", requiredSlots.every((slot) => reviewStart.includes(slot)));
assert("reviewer review start confirmation template requires reviewer output fields remain external", requiredReviewerFields.every((field) => reviewStart.includes(field)));
assert("reviewer review start confirmation template requires followup fields remain external", followupFields.every((field) => reviewStart.includes(field)));
assert("reviewer review start confirmation template includes command checks", commands.every((command) => reviewStart.includes(command)));
assert(
  "reviewer review start confirmation template protects live submission conversion",
  reviewStart.includes("data/phase30-human-evidence-submission.json") &&
    reviewStart.includes("不得在仓库保存真实 reviewer 输出")
);
assert(
  "reviewer review start confirmation template says start is not evidence",
  reviewStart.includes("review-started") &&
    reviewStart.includes("不是 reviewer 输出") &&
    reviewStart.includes("不是 Reviewer 输出接收门禁通过")
);
assert("reviewer review start confirmation template links in-review blocker clarification ledger", reviewStart.includes("当前候选交付Reviewer审查中阻塞与澄清问题台账.md"));
assert("reviewer in-review blocker clarification ledger links review start confirmation template", blockerLedger.includes("当前候选交付Reviewer审查启动确认模板.md"));
assert("reviewer handoff receipt template links review start confirmation template", handoffReceipt.includes("当前候选交付Reviewer审查启动确认模板.md"));
assert("reviewer handoff execution checklist links review start confirmation template", handoffExecution.includes("当前候选交付Reviewer审查启动确认模板.md"));
assert("pre-review package links review start confirmation template", preReview.includes("当前候选交付Reviewer审查启动确认模板.md"));
assert("review execution sequence links review start confirmation template", sequence.includes("当前候选交付Reviewer审查启动确认模板.md"));
assert("review chain integrity index links review start confirmation template", integrity.includes("当前候选交付Reviewer审查启动确认模板.md"));
assert("negative misuse check links review start confirmation template", negative.includes("当前候选交付Reviewer审查启动确认模板.md"));
assert("final review package lock index links review start confirmation template", finalLock.includes("当前候选交付Reviewer审查启动确认模板.md"));
assert(
  "README links reviewer review start confirmation template",
  readme.includes("Current candidate reviewer review start confirmation template") &&
    readme.includes("项目文档/当前候选交付Reviewer审查启动确认模板.md")
);
assert("live human evidence submission remains absent", !fs.existsSync(liveSubmissionPath));

console.log("Candidate reviewer review start confirmation checks passed.");
