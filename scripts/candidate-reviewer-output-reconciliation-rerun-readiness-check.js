const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const docsDir = path.join(projectRoot, "项目文档");
const readinessPath = path.join(docsDir, "当前候选交付Reviewer输出对账失败回流结果再对账准备记录.md");
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
const readiness = fs.readFileSync(readinessPath, "utf8");
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

const readinessFields = [
  "reconciliationRerunReadinessId",
  "sourceFailureDispositionOutcomeId",
  "sourceFailureDispositionId",
  "sourceRetryAttemptReconciliationId",
  "sourceRetryBatchId",
  "sourceReceiptAttemptId",
  "sourceReceiptGateDecisionRef",
  "sourceOutcomeStatus",
  "sourceCorrectionResultType",
  "sourceCorrectionResultStatus",
  "rerunTrigger",
  "rerunScope",
  "readinessRoute",
  "readinessOwner",
  "readinessPreparedAt",
  "readinessPreparedBy",
  "retryBatchReady",
  "receiptAttemptReady",
  "receiptGateRefReady",
  "requiredCorrectionRefs",
  "requiredTargetDocuments",
  "recheckRequired",
  "recheckCommand",
  "nextReconciliationRef",
  "nextRetryBatchRef",
  "nextReceiptAttemptRef",
  "receiptGateRecheckRef",
  "blockerCount",
  "openDispositionRefs",
  "readinessStatus",
  "rollbackRequiredIfFailed",
  "rollbackTarget",
  "nextAction",
  "followUpOwner",
  "recoveryCondition",
  "targetReviewDate",
];

const sourceOutcomeStatuses = [
  "pending-recheck",
  "ready-for-reconciliation-rerun",
  "ready-for-next-retry-batch",
  "returned-for-additional-disposition",
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
  "correction-recorded",
  "awaiting-recheck",
  "recheck-ready",
  "returned-for-additional-disposition",
  "cancelled",
];

const rerunTriggers = [
  "outcome-ready-for-reconciliation-rerun",
  "outcome-ready-for-next-retry-batch",
  "batch-register-corrected",
  "receipt-attempt-corrected",
  "receipt-gate-ref-corrected",
  "additional-disposition-required",
  "cancelled",
];

const rerunScopes = [
  "batch-attempt-gate",
  "retry-batch-only",
  "receipt-attempt-only",
  "receipt-gate-ref-only",
  "field-gap-return",
  "cancelled",
];

const readinessRoutes = [
  "rerun-reconciliation",
  "open-next-retry-batch",
  "update-receipt-attempt",
  "recheck-receipt-gate",
  "return-to-disposition",
  "cancelled",
];

const readinessStatuses = [
  "draft",
  "collecting-target-refs",
  "ready-for-rerun",
  "ready-for-next-retry-batch",
  "blocked-by-missing-correction-ref",
  "blocked-by-open-disposition",
  "returned-for-outcome-review",
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
  "当前候选交付Reviewer输出对账失败回流结果复核记录.md",
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
  "npm.cmd run candidate:reviewer-output-reconciliation-rerun-readiness-check",
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

const readinessDocName = "当前候选交付Reviewer输出对账失败回流结果再对账准备记录.md";

assert("candidate reviewer output reconciliation rerun readiness check does not change app version", packageJson.version === "1.9.48");
assert(
  "package exposes candidate reviewer output reconciliation rerun readiness check command",
  packageJson.scripts["candidate:reviewer-output-reconciliation-rerun-readiness-check"] ===
    "node scripts/candidate-reviewer-output-reconciliation-rerun-readiness-check.js"
);
assert(
  "check pipeline includes candidate reviewer output reconciliation rerun readiness check",
  packageJson.scripts.check.includes("node scripts/candidate-reviewer-output-reconciliation-rerun-readiness-check.js")
);
assert("reviewer output reconciliation rerun readiness exists", fs.existsSync(readinessPath));
assert("reviewer output reconciliation rerun readiness is readiness-only", readiness.includes("reviewer-output-reconciliation-rerun-readiness-only"));
assert(
  "reviewer output reconciliation rerun readiness preserves candidate state",
  readiness.includes("APP_VERSION=1.9.48") &&
    readiness.includes("PHASE=29") &&
    readiness.includes("rc-reviewable-but-not-releasable")
);
assert(
  "reviewer output reconciliation rerun readiness keeps gates blocked",
  readiness.includes("releaseReady=false") &&
    readiness.includes("phase29ExitReady=false") &&
    readiness.includes("phase30EntryReady=false") &&
    readiness.includes("runtimeExecution=false") &&
    readiness.includes("thirdPartyExecution=false")
);
assert(
  "reviewer output reconciliation rerun readiness records missing evidence state",
  readiness.includes("liveSubmissionExists=false") &&
    readiness.includes("approvedSlots=0") &&
    readiness.includes("missingSlots=10")
);
assert(
  "reviewer output reconciliation rerun readiness blocks conversion by default",
  readiness.includes("maintainerConversionAuthorization=false") &&
    readiness.includes("readyForLiveSubmissionCreation=false")
);
assert("reviewer output reconciliation rerun readiness lists fields", readinessFields.every((field) => readiness.includes(field)));
assert("reviewer output reconciliation rerun readiness lists source outcome statuses", sourceOutcomeStatuses.every((status) => readiness.includes(status)));
assert("reviewer output reconciliation rerun readiness lists correction result types", correctionResultTypes.every((type) => readiness.includes(type)));
assert("reviewer output reconciliation rerun readiness lists correction result statuses", correctionResultStatuses.every((status) => readiness.includes(status)));
assert("reviewer output reconciliation rerun readiness lists rerun triggers", rerunTriggers.every((trigger) => readiness.includes(trigger)));
assert("reviewer output reconciliation rerun readiness lists rerun scopes", rerunScopes.every((scope) => readiness.includes(scope)));
assert("reviewer output reconciliation rerun readiness lists readiness routes", readinessRoutes.every((route) => readiness.includes(route)));
assert("reviewer output reconciliation rerun readiness lists readiness statuses", readinessStatuses.every((status) => readiness.includes(status)));
assert("reviewer output reconciliation rerun readiness covers reviewer roles", reviewerRoles.every((role) => readiness.includes(role)));
assert("reviewer output reconciliation rerun readiness covers all slots", requiredSlots.every((slot) => readiness.includes(slot)));
assert("reviewer output reconciliation rerun readiness keeps reviewer fields external", requiredReviewerFields.every((field) => readiness.includes(field)));
assert("reviewer output reconciliation rerun readiness requires followup fields", followupFields.every((field) => readiness.includes(field)));
assert("reviewer output reconciliation rerun readiness links required documents", requiredDocuments.every((doc) => readiness.includes(doc)));
assert("reviewer output reconciliation rerun readiness includes command checks", commands.every((command) => readiness.includes(command)));
assert(
  "reviewer output reconciliation rerun readiness protects live submission conversion",
  readiness.includes("data/phase30-human-evidence-submission.json") &&
    readiness.includes("不得在仓库保存真实 reviewer 输出")
);
assert(
  "reviewer output reconciliation rerun readiness says it is not acceptance",
  readiness.includes("不是 reviewer 输出") &&
    readiness.includes("不是字段已修复证明") &&
    readiness.includes("不是 Reviewer 输出接收门禁通过") &&
    readiness.includes("不是 evidence acceptance")
);
assert(
  "reviewer output reconciliation rerun readiness maps readiness inputs",
  readiness.includes("nextReconciliationRef") &&
    readiness.includes("nextRetryBatchRef") &&
    readiness.includes("nextReceiptAttemptRef") &&
    readiness.includes("receiptGateRecheckRef")
);
assert(
  "reviewer output reconciliation rerun readiness rejects false status meanings",
  readiness.includes("ready-for-rerun") &&
    readiness.includes("ready-for-next-retry-batch") &&
    readiness.includes("receiptGateRefReady=true") &&
    readiness.includes("不表示 reviewer 输出已被接收") &&
    readiness.includes("recheck-ready") &&
    readiness.includes("当作 Reviewer 输出接收门禁通过")
);
assert("outcome review links rerun readiness", outcome.includes(readinessDocName));
assert("failure disposition links rerun readiness", disposition.includes(readinessDocName));
assert("reconciliation links rerun readiness", reconciliation.includes(readinessDocName));
assert("retry batch register links rerun readiness", retryBatch.includes(readinessDocName));
assert("receipt attempt log links rerun readiness", attempt.includes(readinessDocName));
assert("output receipt gate links rerun readiness", receiptGate.includes(readinessDocName));
assert("field gap matrix links rerun readiness", fieldGapMatrix.includes(readinessDocName));
assert("field fix assignment links rerun readiness", assignment.includes(readinessDocName));
assert("return resubmission closure record links rerun readiness", returnClosure.includes(readinessDocName));
assert("pre-review package links rerun readiness", preReview.includes(readinessDocName));
assert("review execution sequence links rerun readiness", sequence.includes(readinessDocName));
assert("review chain integrity index links rerun readiness", integrity.includes(readinessDocName));
assert("negative misuse check links rerun readiness", negative.includes(readinessDocName));
assert("final review package lock index links rerun readiness", finalLock.includes(readinessDocName));
assert(
  "README links reviewer output reconciliation rerun readiness",
  readme.includes("Current candidate reviewer output reconciliation rerun readiness") &&
    readme.includes("项目文档/当前候选交付Reviewer输出对账失败回流结果再对账准备记录.md")
);
assert("live human evidence submission remains absent", !fs.existsSync(liveSubmissionPath));

console.log("Candidate reviewer output reconciliation rerun readiness checks passed.");
