const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const docsDir = path.join(projectRoot, "项目文档");
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

const resultIntakeFields = [
  "rerunResultIntakeId",
  "sourceRerunExecutionId",
  "sourceRerunReadinessId",
  "sourceFailureDispositionOutcomeId",
  "sourceRetryAttemptReconciliationId",
  "sourceRetryBatchId",
  "sourceReceiptAttemptId",
  "sourceReceiptGateDecisionRef",
  "sourceExecutionStatus",
  "sourceExecutionResultRoute",
  "sourceExecutionLogRef",
  "sourceResultRecordRef",
  "intakeReceivedAt",
  "intakeReceivedBy",
  "intakeOwner",
  "resultPayloadRef",
  "resultPayloadHashRef",
  "targetReconciliationRef",
  "targetRetryBatchRef",
  "targetReceiptAttemptRef",
  "targetReceiptGateRef",
  "resultSignal",
  "resultMatchedState",
  "resultGateReferenceState",
  "resultFieldGapState",
  "resultBlockerState",
  "intakeStatus",
  "nextDispositionRoute",
  "nextResultReviewRef",
  "nextRetryBatchRef",
  "nextReceiptAttemptRef",
  "nextReceiptGateRecheckRef",
  "blockerCount",
  "openDispositionRefs",
  "rollbackRequiredIfFailed",
  "rollbackTarget",
  "nextAction",
  "followUpOwner",
  "recoveryCondition",
  "targetReviewDate",
];

const sourceExecutionStatuses = [
  "executed",
  "execution-result-routed",
  "execution-blocked",
  "execution-failed",
  "cancelled",
];

const sourceExecutionResultRoutes = [
  "route-to-rerun-result-intake",
  "route-to-retry-batch-register",
  "route-to-receipt-attempt-log",
  "route-to-receipt-gate",
  "route-to-failure-disposition",
  "route-to-field-gap-matrix",
  "route-to-return-resubmission-closure",
  "cancelled",
];

const resultSignals = [
  "matched",
  "mismatched",
  "blocked",
  "missing-result-record",
  "gate-ref-missing",
  "needs-new-retry-batch",
  "cancelled",
];

const resultMatchedStates = [
  "not-evaluated",
  "matched",
  "mismatched",
  "partial-match",
  "not-applicable",
];

const resultGateReferenceStates = [
  "not-evaluated",
  "gate-ref-linked",
  "gate-ref-missing",
  "gate-ref-stale",
  "not-applicable",
];

const resultFieldGapStates = [
  "not-evaluated",
  "no-new-gap",
  "new-gap-found",
  "existing-gap-open",
  "not-applicable",
];

const resultBlockerStates = [
  "none",
  "open-blocker",
  "blocked-by-missing-result",
  "blocked-by-gate-ref",
  "blocked-by-field-gap",
  "cancelled",
];

const intakeStatuses = [
  "draft",
  "awaiting-result-ref",
  "received",
  "blocked-by-missing-result-ref",
  "routed-to-result-review",
  "routed-to-failure-disposition",
  "routed-to-retry-batch",
  "routed-to-receipt-attempt",
  "routed-to-receipt-gate",
  "cancelled",
];

const nextDispositionRoutes = [
  "to-rerun-result-review",
  "to-failure-disposition",
  "to-retry-batch-register",
  "to-receipt-attempt-log",
  "to-receipt-gate",
  "to-field-gap-matrix",
  "to-return-resubmission-closure",
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

const resultIntakeDocName = "当前候选交付Reviewer输出再对账结果接收记录.md";

assert("candidate reviewer output reconciliation rerun result intake check does not change app version", packageJson.version === "1.9.48");
assert(
  "package exposes candidate reviewer output reconciliation rerun result intake check command",
  packageJson.scripts["candidate:reviewer-output-reconciliation-rerun-result-intake-check"] ===
    "node scripts/candidate-reviewer-output-reconciliation-rerun-result-intake-check.js"
);
assert(
  "check pipeline includes candidate reviewer output reconciliation rerun result intake check",
  packageJson.scripts.check.includes("node scripts/candidate-reviewer-output-reconciliation-rerun-result-intake-check.js")
);
assert("reviewer output reconciliation rerun result intake exists", fs.existsSync(resultIntakePath));
assert("reviewer output reconciliation rerun result intake is intake-only", resultIntake.includes("reviewer-output-reconciliation-rerun-result-intake-only"));
assert(
  "reviewer output reconciliation rerun result intake preserves candidate state",
  resultIntake.includes("APP_VERSION=1.9.48") &&
    resultIntake.includes("PHASE=29") &&
    resultIntake.includes("rc-reviewable-but-not-releasable")
);
assert(
  "reviewer output reconciliation rerun result intake keeps gates blocked",
  resultIntake.includes("releaseReady=false") &&
    resultIntake.includes("phase29ExitReady=false") &&
    resultIntake.includes("phase30EntryReady=false") &&
    resultIntake.includes("runtimeExecution=false") &&
    resultIntake.includes("thirdPartyExecution=false")
);
assert(
  "reviewer output reconciliation rerun result intake records missing evidence state",
  resultIntake.includes("liveSubmissionExists=false") &&
    resultIntake.includes("approvedSlots=0") &&
    resultIntake.includes("missingSlots=10")
);
assert(
  "reviewer output reconciliation rerun result intake blocks conversion by default",
  resultIntake.includes("maintainerConversionAuthorization=false") &&
    resultIntake.includes("readyForLiveSubmissionCreation=false")
);
assert("reviewer output reconciliation rerun result intake lists fields", resultIntakeFields.every((field) => resultIntake.includes(field)));
assert("reviewer output reconciliation rerun result intake lists source execution statuses", sourceExecutionStatuses.every((status) => resultIntake.includes(status)));
assert("reviewer output reconciliation rerun result intake lists source result routes", sourceExecutionResultRoutes.every((route) => resultIntake.includes(route)));
assert("reviewer output reconciliation rerun result intake lists result signals", resultSignals.every((signal) => resultIntake.includes(signal)));
assert("reviewer output reconciliation rerun result intake lists match states", resultMatchedStates.every((state) => resultIntake.includes(state)));
assert("reviewer output reconciliation rerun result intake lists gate reference states", resultGateReferenceStates.every((state) => resultIntake.includes(state)));
assert("reviewer output reconciliation rerun result intake lists field gap states", resultFieldGapStates.every((state) => resultIntake.includes(state)));
assert("reviewer output reconciliation rerun result intake lists blocker states", resultBlockerStates.every((state) => resultIntake.includes(state)));
assert("reviewer output reconciliation rerun result intake lists intake statuses", intakeStatuses.every((status) => resultIntake.includes(status)));
assert("reviewer output reconciliation rerun result intake lists disposition routes", nextDispositionRoutes.every((route) => resultIntake.includes(route)));
assert("reviewer output reconciliation rerun result intake covers reviewer roles", reviewerRoles.every((role) => resultIntake.includes(role)));
assert("reviewer output reconciliation rerun result intake covers all slots", requiredSlots.every((slot) => resultIntake.includes(slot)));
assert("reviewer output reconciliation rerun result intake keeps reviewer fields external", requiredReviewerFields.every((field) => resultIntake.includes(field)));
assert("reviewer output reconciliation rerun result intake requires followup fields", followupFields.every((field) => resultIntake.includes(field)));
assert("reviewer output reconciliation rerun result intake links required documents", requiredDocuments.every((doc) => resultIntake.includes(doc)));
assert("reviewer output reconciliation rerun result intake includes command checks", commands.every((command) => resultIntake.includes(command)));
assert(
  "reviewer output reconciliation rerun result intake protects live submission conversion",
  resultIntake.includes("data/phase30-human-evidence-submission.json") &&
    resultIntake.includes("不得在仓库保存真实 reviewer 输出")
);
assert(
  "reviewer output reconciliation rerun result intake says it is not acceptance",
  resultIntake.includes("不是 reviewer 输出") &&
    resultIntake.includes("不是字段已修复证明") &&
    resultIntake.includes("不是 Reviewer 输出接收门禁通过") &&
    resultIntake.includes("不是 evidence acceptance")
);
assert(
  "reviewer output reconciliation rerun result intake maps intake targets",
  resultIntake.includes("targetReconciliationRef") &&
    resultIntake.includes("targetRetryBatchRef") &&
    resultIntake.includes("targetReceiptAttemptRef") &&
    resultIntake.includes("targetReceiptGateRef")
);
assert(
  "reviewer output reconciliation rerun result intake rejects false result meanings",
  resultIntake.includes("received") &&
    resultIntake.includes("matched") &&
    resultIntake.includes("gate-ref-linked") &&
    resultIntake.includes("都不表示 reviewer 输出已经被接收") &&
    resultIntake.includes("不能直接进入 release approval")
);
assert("rerun execution links result intake", execution.includes(resultIntakeDocName));
assert("rerun readiness links result intake", readiness.includes(resultIntakeDocName));
assert("outcome review links result intake", outcome.includes(resultIntakeDocName));
assert("failure disposition links result intake", disposition.includes(resultIntakeDocName));
assert("reconciliation links result intake", reconciliation.includes(resultIntakeDocName));
assert("retry batch register links result intake", retryBatch.includes(resultIntakeDocName));
assert("receipt attempt log links result intake", attempt.includes(resultIntakeDocName));
assert("output receipt gate links result intake", receiptGate.includes(resultIntakeDocName));
assert("field gap matrix links result intake", fieldGapMatrix.includes(resultIntakeDocName));
assert("field fix assignment links result intake", assignment.includes(resultIntakeDocName));
assert("return resubmission closure record links result intake", returnClosure.includes(resultIntakeDocName));
assert("pre-review package links result intake", preReview.includes(resultIntakeDocName));
assert("review execution sequence links result intake", sequence.includes(resultIntakeDocName));
assert("review chain integrity index links result intake", integrity.includes(resultIntakeDocName));
assert("negative misuse check links result intake", negative.includes(resultIntakeDocName));
assert("final review package lock index links result intake", finalLock.includes(resultIntakeDocName));
assert(
  "README links reviewer output reconciliation rerun result intake",
  readme.includes("Current candidate reviewer output reconciliation rerun result intake") &&
    readme.includes("项目文档/当前候选交付Reviewer输出再对账结果接收记录.md")
);
assert("live human evidence submission remains absent", !fs.existsSync(liveSubmissionPath));

console.log("Candidate reviewer output reconciliation rerun result intake checks passed.");
