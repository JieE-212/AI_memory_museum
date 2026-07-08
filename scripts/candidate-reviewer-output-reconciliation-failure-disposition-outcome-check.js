const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const docsDir = path.join(projectRoot, "项目文档");
const outcomePath = path.join(docsDir, "当前候选交付Reviewer输出对账失败回流结果复核记录.md");
const dispositionPath = path.join(docsDir, "当前候选交付Reviewer输出对账失败回流处置单.md");
const reconciliationPath = path.join(docsDir, "当前候选交付Reviewer输出重试批次与接收尝试对账记录.md");
const retryBatchPath = path.join(docsDir, "当前候选交付Reviewer输出重试批次登记表.md");
const attemptPath = path.join(docsDir, "当前候选交付Reviewer输出接收尝试记录.md");
const receiptGatePath = path.join(docsDir, "当前候选交付Reviewer输出接收门禁.md");
const fieldGapMatrixPath = path.join(docsDir, "当前候选交付Reviewer输出字段缺口定位矩阵.md");
const assignmentPath = path.join(docsDir, "当前候选交付Reviewer输出字段修复责任分派单.md");
const returnClosurePath = path.join(docsDir, "当前候选交付Reviewer输出退回与补交闭环记录.md");
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
const outcome = fs.readFileSync(outcomePath, "utf8");
const disposition = fs.readFileSync(dispositionPath, "utf8");
const reconciliation = fs.readFileSync(reconciliationPath, "utf8");
const retryBatch = fs.readFileSync(retryBatchPath, "utf8");
const attempt = fs.readFileSync(attemptPath, "utf8");
const receiptGate = fs.readFileSync(receiptGatePath, "utf8");
const fieldGapMatrix = fs.readFileSync(fieldGapMatrixPath, "utf8");
const assignment = fs.readFileSync(assignmentPath, "utf8");
const returnClosure = fs.readFileSync(returnClosurePath, "utf8");
const preReview = fs.readFileSync(preReviewPath, "utf8");
const sequence = fs.readFileSync(sequencePath, "utf8");
const integrity = fs.readFileSync(integrityPath, "utf8");
const negative = fs.readFileSync(negativePath, "utf8");
const finalLock = fs.readFileSync(finalLockPath, "utf8");

const outcomeFields = [
  "failureDispositionOutcomeId",
  "sourceFailureDispositionId",
  "sourceRetryAttemptReconciliationId",
  "sourceRetryBatchId",
  "sourceReceiptAttemptId",
  "sourceReceiptGateDecisionRef",
  "sourceFailureReasonType",
  "sourceDispositionRoute",
  "routeTargetDocument",
  "routeTargetOwner",
  "routeOwnerAcknowledged",
  "routeOwnerAcknowledgedAt",
  "correctionRecordRef",
  "correctionResultType",
  "correctionResultStatus",
  "recheckRequired",
  "recheckCommand",
  "nextReconciliationRef",
  "nextRetryBatchRef",
  "nextReceiptAttemptRef",
  "receiptGateRecheckRef",
  "outcomeStatus",
  "outcomeReviewedAt",
  "outcomeReviewedBy",
  "rollbackRequiredIfFailed",
  "rollbackTarget",
  "nextAction",
  "followUpOwner",
  "recoveryCondition",
  "targetReviewDate",
];

const failureReasonTypes = [
  "unmatched-batch",
  "orphan-attempt",
  "missing-gate-ref",
  "blocked-by-missing-attempt",
  "blocked-by-missing-gate-ref",
  "returned-for-gap-review",
];

const dispositionRoutes = [
  "return-to-retry-batch-register",
  "return-to-receipt-attempt-log",
  "return-to-receipt-gate",
  "return-to-field-gap-matrix",
  "return-to-field-fix-assignment",
  "return-to-return-resubmission-closure",
  "cancelled",
];

const correctionResultTypes = [
  "batch-register-corrected",
  "receipt-attempt-corrected",
  "receipt-gate-ref-corrected",
  "field-gap-matrix-opened",
  "field-fix-assignment-opened",
  "return-closure-opened",
  "next-retry-batch-prepared",
  "cancelled",
];

const correctionResultStatuses = [
  "not-started",
  "owner-acknowledged",
  "correction-recorded",
  "awaiting-recheck",
  "recheck-ready",
  "returned-for-additional-disposition",
  "cancelled",
];

const outcomeStatuses = [
  "draft",
  "awaiting-route-owner",
  "route-owner-acknowledged",
  "correction-recorded",
  "pending-recheck",
  "ready-for-reconciliation-rerun",
  "ready-for-next-retry-batch",
  "returned-for-additional-disposition",
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

const requiredDocuments = [
  "当前候选交付Reviewer输出对账失败回流处置单.md",
  "当前候选交付Reviewer输出重试批次与接收尝试对账记录.md",
  "当前候选交付Reviewer输出重试批次登记表.md",
  "当前候选交付Reviewer输出接收尝试记录.md",
  "当前候选交付Reviewer输出接收门禁.md",
  "当前候选交付Reviewer输出字段缺口定位矩阵.md",
  "当前候选交付Reviewer输出字段修复责任分派单.md",
  "当前候选交付Reviewer输出退回与补交闭环记录.md",
];

const commands = [
  "npm.cmd run candidate:reviewer-output-reconciliation-failure-disposition-outcome-check",
  "npm.cmd run candidate:reviewer-output-reconciliation-failure-disposition-check",
  "npm.cmd run candidate:reviewer-output-retry-batch-attempt-reconciliation-check",
  "npm.cmd run candidate:reviewer-output-retry-batch-register-check",
  "npm.cmd run candidate:reviewer-output-receipt-attempt-log-check",
  "npm.cmd run candidate:reviewer-output-receipt-check",
  "npm.cmd run candidate:reviewer-output-field-gap-matrix-check",
  "npm.cmd run candidate:reviewer-output-field-fix-assignment-check",
  "npm.cmd run candidate:reviewer-output-return-resubmission-closure-check",
  "npm.cmd run candidate:final-review-package-lock-check",
  "npm.cmd run candidate:negative-misuse-check",
  "npm.cmd run candidate:review-chain-integrity-check",
  "npm.cmd run candidate:review-execution-sequence-check",
  "npm.cmd run candidate:pre-review-package-check",
  "npm.cmd run phase30:evidence-closure-status",
  "npm.cmd run check",
];

const outcomeDocName = "当前候选交付Reviewer输出对账失败回流结果复核记录.md";

assert("candidate reviewer output reconciliation failure disposition outcome check does not change app version", packageJson.version === "1.9.48");
assert(
  "package exposes candidate reviewer output reconciliation failure disposition outcome check command",
  packageJson.scripts["candidate:reviewer-output-reconciliation-failure-disposition-outcome-check"] ===
    "node scripts/candidate-reviewer-output-reconciliation-failure-disposition-outcome-check.js"
);
assert(
  "check pipeline includes candidate reviewer output reconciliation failure disposition outcome check",
  packageJson.scripts.check.includes("node scripts/candidate-reviewer-output-reconciliation-failure-disposition-outcome-check.js")
);
assert("reviewer output reconciliation failure disposition outcome exists", fs.existsSync(outcomePath));
assert("reviewer output reconciliation failure disposition outcome is outcome-only", outcome.includes("reviewer-output-reconciliation-failure-disposition-outcome-only"));
assert(
  "reviewer output reconciliation failure disposition outcome preserves candidate state",
  outcome.includes("APP_VERSION=1.9.48") &&
    outcome.includes("PHASE=29") &&
    outcome.includes("rc-reviewable-but-not-releasable")
);
assert(
  "reviewer output reconciliation failure disposition outcome keeps gates blocked",
  outcome.includes("releaseReady=false") &&
    outcome.includes("phase29ExitReady=false") &&
    outcome.includes("phase30EntryReady=false") &&
    outcome.includes("runtimeExecution=false") &&
    outcome.includes("thirdPartyExecution=false")
);
assert(
  "reviewer output reconciliation failure disposition outcome records missing evidence state",
  outcome.includes("liveSubmissionExists=false") &&
    outcome.includes("approvedSlots=0") &&
    outcome.includes("missingSlots=10")
);
assert(
  "reviewer output reconciliation failure disposition outcome blocks conversion by default",
  outcome.includes("maintainerConversionAuthorization=false") &&
    outcome.includes("readyForLiveSubmissionCreation=false")
);
assert("reviewer output reconciliation failure disposition outcome lists fields", outcomeFields.every((field) => outcome.includes(field)));
assert("reviewer output reconciliation failure disposition outcome lists failure reason types", failureReasonTypes.every((reasonType) => outcome.includes(reasonType)));
assert("reviewer output reconciliation failure disposition outcome lists disposition routes", dispositionRoutes.every((route) => outcome.includes(route)));
assert("reviewer output reconciliation failure disposition outcome lists correction result types", correctionResultTypes.every((type) => outcome.includes(type)));
assert("reviewer output reconciliation failure disposition outcome lists correction result statuses", correctionResultStatuses.every((status) => outcome.includes(status)));
assert("reviewer output reconciliation failure disposition outcome lists outcome statuses", outcomeStatuses.every((status) => outcome.includes(status)));
assert("reviewer output reconciliation failure disposition outcome covers reviewer roles", reviewerRoles.every((role) => outcome.includes(role)));
assert("reviewer output reconciliation failure disposition outcome covers all slots", requiredSlots.every((slot) => outcome.includes(slot)));
assert("reviewer output reconciliation failure disposition outcome keeps reviewer fields external", requiredReviewerFields.every((field) => outcome.includes(field)));
assert("reviewer output reconciliation failure disposition outcome requires followup fields", followupFields.every((field) => outcome.includes(field)));
assert("reviewer output reconciliation failure disposition outcome links required documents", requiredDocuments.every((doc) => outcome.includes(doc)));
assert("reviewer output reconciliation failure disposition outcome includes command checks", commands.every((command) => outcome.includes(command)));
assert(
  "reviewer output reconciliation failure disposition outcome protects live submission conversion",
  outcome.includes("data/phase30-human-evidence-submission.json") &&
    outcome.includes("不得在仓库保存真实 reviewer 输出")
);
assert(
  "reviewer output reconciliation failure disposition outcome says it is not acceptance",
  outcome.includes("不是 reviewer 输出") &&
    outcome.includes("不是字段已修复证明") &&
    outcome.includes("不是 Reviewer 输出接收门禁通过") &&
    outcome.includes("不是 evidence acceptance")
);
assert(
  "reviewer output reconciliation failure disposition outcome maps routes to results",
  correctionResultTypes.every((type) => outcome.includes(type)) &&
    outcome.includes("重新登记 retry batch") &&
    outcome.includes("重新核对 source batch、attempt 和 gate ref")
);
assert(
  "reviewer output reconciliation failure disposition outcome rejects false status meanings",
  outcome.includes("route-owner-acknowledged") &&
    outcome.includes("correction-recorded") &&
    outcome.includes("ready-for-reconciliation-rerun") &&
    outcome.includes("ready-for-next-retry-batch") &&
    outcome.includes("都不表示 reviewer 输出已被接收") &&
    outcome.includes("receipt-gate-ref-corrected") &&
    outcome.includes("当作 Reviewer 输出接收门禁通过")
);
assert("failure disposition links outcome review", disposition.includes(outcomeDocName));
assert("reconciliation links outcome review", reconciliation.includes(outcomeDocName));
assert("retry batch register links outcome review", retryBatch.includes(outcomeDocName));
assert("receipt attempt log links outcome review", attempt.includes(outcomeDocName));
assert("output receipt gate links outcome review", receiptGate.includes(outcomeDocName));
assert("field gap matrix links outcome review", fieldGapMatrix.includes(outcomeDocName));
assert("field fix assignment links outcome review", assignment.includes(outcomeDocName));
assert("return resubmission closure record links outcome review", returnClosure.includes(outcomeDocName));
assert("pre-review package links outcome review", preReview.includes(outcomeDocName));
assert("review execution sequence links outcome review", sequence.includes(outcomeDocName));
assert("review chain integrity index links outcome review", integrity.includes(outcomeDocName));
assert("negative misuse check links outcome review", negative.includes(outcomeDocName));
assert("final review package lock index links outcome review", finalLock.includes(outcomeDocName));
assert(
  "README links reviewer output reconciliation failure disposition outcome",
  readme.includes("Current candidate reviewer output reconciliation failure disposition outcome") &&
    readme.includes("项目文档/当前候选交付Reviewer输出对账失败回流结果复核记录.md")
);
assert("live human evidence submission remains absent", !fs.existsSync(liveSubmissionPath));

console.log("Candidate reviewer output reconciliation failure disposition outcome checks passed.");
