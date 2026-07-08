const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const docsDir = path.join(projectRoot, "项目文档");
const resultReviewPath = path.join(docsDir, "当前候选交付Reviewer输出再对账结果复核记录.md");
const resultIntakePath = path.join(docsDir, "当前候选交付Reviewer输出再对账结果接收记录.md");
const executionPath = path.join(docsDir, "当前候选交付Reviewer输出再对账执行记录.md");
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
const resultReview = fs.readFileSync(resultReviewPath, "utf8");
const resultIntake = fs.readFileSync(resultIntakePath, "utf8");
const execution = fs.readFileSync(executionPath, "utf8");
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

const resultReviewFields = [
  "rerunResultReviewId",
  "sourceRerunResultIntakeId",
  "sourceRerunExecutionId",
  "sourceRerunReadinessId",
  "sourceRetryAttemptReconciliationId",
  "sourceRetryBatchId",
  "sourceReceiptAttemptId",
  "sourceReceiptGateDecisionRef",
  "sourceResultSignal",
  "sourceIntakeStatus",
  "sourceResultMatchedState",
  "sourceResultGateReferenceState",
  "sourceResultFieldGapState",
  "sourceResultBlockerState",
  "sourceResultRecordRef",
  "sourceResultPayloadHashRef",
  "reviewStartedAt",
  "reviewedAt",
  "reviewedBy",
  "reviewOwner",
  "reviewDecision",
  "reviewDecisionReason",
  "reviewStatus",
  "reviewResultRoute",
  "correctionRequired",
  "correctionTargetDocument",
  "nextFailureDispositionRef",
  "nextRetryBatchRef",
  "nextReceiptAttemptRef",
  "nextReceiptGateRecheckRef",
  "nextFieldGapRef",
  "nextFieldFixAssignmentRef",
  "nextReturnClosureRef",
  "nextResultClosureRef",
  "blockerCount",
  "openDispositionRefs",
  "rollbackRequiredIfFailed",
  "rollbackTarget",
  "nextAction",
  "followUpOwner",
  "recoveryCondition",
  "targetReviewDate",
];

const sourceResultSignals = [
  "matched",
  "mismatched",
  "blocked",
  "missing-result-record",
  "gate-ref-missing",
  "needs-new-retry-batch",
  "cancelled",
];

const sourceIntakeStatuses = [
  "received",
  "blocked-by-missing-result-ref",
  "routed-to-result-review",
  "routed-to-failure-disposition",
  "routed-to-retry-batch",
  "routed-to-receipt-attempt",
  "routed-to-receipt-gate",
  "cancelled",
];

const reviewDecisions = [
  "confirm-match-for-review-only",
  "confirm-mismatch-route",
  "confirm-blocker-route",
  "confirm-missing-result-ref",
  "confirm-gate-ref-route",
  "confirm-next-retry-batch",
  "return-to-result-intake",
  "cancelled",
];

const reviewStatuses = [
  "draft",
  "under-review",
  "review-confirmed",
  "blocked-by-missing-source",
  "blocked-by-open-disposition",
  "ready-for-next-disposition",
  "returned-to-result-intake",
  "cancelled",
];

const reviewResultRoutes = [
  "to-rerun-result-disposition",
  "to-failure-disposition",
  "to-retry-batch-register",
  "to-receipt-attempt-log",
  "to-receipt-gate",
  "to-field-gap-matrix",
  "to-field-fix-assignment",
  "to-return-resubmission-closure",
  "to-result-intake",
  "cancelled",
];

const sourceStates = [
  "not-evaluated",
  "matched",
  "mismatched",
  "partial-match",
  "gate-ref-linked",
  "gate-ref-missing",
  "gate-ref-stale",
  "no-new-gap",
  "new-gap-found",
  "existing-gap-open",
  "none",
  "open-blocker",
  "blocked-by-missing-result",
  "blocked-by-gate-ref",
  "blocked-by-field-gap",
  "not-applicable",
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
  "当前候选交付Reviewer输出再对账结果接收记录.md",
  "当前候选交付Reviewer输出再对账执行记录.md",
  "当前候选交付Reviewer输出对账失败回流结果再对账准备记录.md",
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
  "npm.cmd run candidate:reviewer-output-reconciliation-rerun-result-review-check",
  "npm.cmd run candidate:reviewer-output-reconciliation-rerun-result-intake-check",
  "npm.cmd run candidate:reviewer-output-reconciliation-rerun-execution-check",
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

const resultReviewDocName = "当前候选交付Reviewer输出再对账结果复核记录.md";

assert("candidate reviewer output reconciliation rerun result review check does not change app version", packageJson.version === "1.9.48");
assert(
  "package exposes candidate reviewer output reconciliation rerun result review check command",
  packageJson.scripts["candidate:reviewer-output-reconciliation-rerun-result-review-check"] ===
    "node scripts/candidate-reviewer-output-reconciliation-rerun-result-review-check.js"
);
assert(
  "check pipeline includes candidate reviewer output reconciliation rerun result review check",
  packageJson.scripts.check.includes("node scripts/candidate-reviewer-output-reconciliation-rerun-result-review-check.js")
);
assert("reviewer output reconciliation rerun result review exists", fs.existsSync(resultReviewPath));
assert("reviewer output reconciliation rerun result review is review-only", resultReview.includes("reviewer-output-reconciliation-rerun-result-review-only"));
assert(
  "reviewer output reconciliation rerun result review preserves candidate state",
  resultReview.includes("APP_VERSION=1.9.48") &&
    resultReview.includes("PHASE=29") &&
    resultReview.includes("rc-reviewable-but-not-releasable")
);
assert(
  "reviewer output reconciliation rerun result review keeps gates blocked",
  resultReview.includes("releaseReady=false") &&
    resultReview.includes("phase29ExitReady=false") &&
    resultReview.includes("phase30EntryReady=false") &&
    resultReview.includes("runtimeExecution=false") &&
    resultReview.includes("thirdPartyExecution=false")
);
assert(
  "reviewer output reconciliation rerun result review records missing evidence state",
  resultReview.includes("liveSubmissionExists=false") &&
    resultReview.includes("approvedSlots=0") &&
    resultReview.includes("missingSlots=10")
);
assert(
  "reviewer output reconciliation rerun result review blocks conversion by default",
  resultReview.includes("maintainerConversionAuthorization=false") &&
    resultReview.includes("readyForLiveSubmissionCreation=false")
);
assert("reviewer output reconciliation rerun result review lists fields", resultReviewFields.every((field) => resultReview.includes(field)));
assert("reviewer output reconciliation rerun result review lists result signals", sourceResultSignals.every((signal) => resultReview.includes(signal)));
assert("reviewer output reconciliation rerun result review lists intake statuses", sourceIntakeStatuses.every((status) => resultReview.includes(status)));
assert("reviewer output reconciliation rerun result review lists decisions", reviewDecisions.every((decision) => resultReview.includes(decision)));
assert("reviewer output reconciliation rerun result review lists statuses", reviewStatuses.every((status) => resultReview.includes(status)));
assert("reviewer output reconciliation rerun result review lists routes", reviewResultRoutes.every((route) => resultReview.includes(route)));
assert("reviewer output reconciliation rerun result review lists source states", sourceStates.every((state) => resultReview.includes(state)));
assert("reviewer output reconciliation rerun result review covers reviewer roles", reviewerRoles.every((role) => resultReview.includes(role)));
assert("reviewer output reconciliation rerun result review covers all slots", requiredSlots.every((slot) => resultReview.includes(slot)));
assert("reviewer output reconciliation rerun result review keeps reviewer fields external", requiredReviewerFields.every((field) => resultReview.includes(field)));
assert("reviewer output reconciliation rerun result review requires followup fields", followupFields.every((field) => resultReview.includes(field)));
assert("reviewer output reconciliation rerun result review links required documents", requiredDocuments.every((doc) => resultReview.includes(doc)));
assert("reviewer output reconciliation rerun result review includes command checks", commands.every((command) => resultReview.includes(command)));
assert(
  "reviewer output reconciliation rerun result review protects live submission conversion",
  resultReview.includes("data/phase30-human-evidence-submission.json") &&
    resultReview.includes("不得在仓库保存真实 reviewer 输出")
);
assert(
  "reviewer output reconciliation rerun result review says it is not acceptance",
  resultReview.includes("不是 reviewer 输出") &&
    resultReview.includes("不是字段已修复证明") &&
    resultReview.includes("不是 Reviewer 输出接收门禁通过") &&
    resultReview.includes("不是 evidence acceptance")
);
assert(
  "reviewer output reconciliation rerun result review maps next refs",
  resultReview.includes("nextFailureDispositionRef") &&
    resultReview.includes("nextRetryBatchRef") &&
    resultReview.includes("nextReceiptAttemptRef") &&
    resultReview.includes("nextReceiptGateRecheckRef")
);
assert(
  "reviewer output reconciliation rerun result review rejects false review meanings",
  resultReview.includes("confirm-match-for-review-only") &&
    resultReview.includes("review-confirmed") &&
    resultReview.includes("ready-for-next-disposition") &&
    resultReview.includes("都不表示 reviewer 输出已经被接收") &&
    resultReview.includes("不得直接创建")
);
assert("rerun result intake links result review", resultIntake.includes(resultReviewDocName));
assert("rerun execution links result review", execution.includes(resultReviewDocName));
assert("rerun readiness links result review", readiness.includes(resultReviewDocName));
assert("outcome review links result review", outcome.includes(resultReviewDocName));
assert("failure disposition links result review", disposition.includes(resultReviewDocName));
assert("reconciliation links result review", reconciliation.includes(resultReviewDocName));
assert("retry batch register links result review", retryBatch.includes(resultReviewDocName));
assert("receipt attempt log links result review", attempt.includes(resultReviewDocName));
assert("output receipt gate links result review", receiptGate.includes(resultReviewDocName));
assert("field gap matrix links result review", fieldGapMatrix.includes(resultReviewDocName));
assert("field fix assignment links result review", assignment.includes(resultReviewDocName));
assert("return resubmission closure record links result review", returnClosure.includes(resultReviewDocName));
assert("pre-review package links result review", preReview.includes(resultReviewDocName));
assert("review execution sequence links result review", sequence.includes(resultReviewDocName));
assert("review chain integrity index links result review", integrity.includes(resultReviewDocName));
assert("negative misuse check links result review", negative.includes(resultReviewDocName));
assert("final review package lock index links result review", finalLock.includes(resultReviewDocName));
assert(
  "README links reviewer output reconciliation rerun result review",
  readme.includes("Current candidate reviewer output reconciliation rerun result review") &&
    readme.includes("项目文档/当前候选交付Reviewer输出再对账结果复核记录.md")
);
assert("live human evidence submission remains absent", !fs.existsSync(liveSubmissionPath));

console.log("Candidate reviewer output reconciliation rerun result review checks passed.");
