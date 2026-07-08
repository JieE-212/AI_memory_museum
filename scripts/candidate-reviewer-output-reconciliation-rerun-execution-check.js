const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const docsDir = path.join(projectRoot, "项目文档");
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

const executionFields = [
  "rerunExecutionId",
  "sourceRerunReadinessId",
  "sourceFailureDispositionOutcomeId",
  "sourceFailureDispositionId",
  "sourceRetryAttemptReconciliationId",
  "sourceRetryBatchId",
  "sourceReceiptAttemptId",
  "sourceReceiptGateDecisionRef",
  "sourceReadinessStatus",
  "sourceReadinessRoute",
  "rerunExecutionType",
  "rerunExecutionScope",
  "rerunCommand",
  "rerunCommandRecordedAt",
  "executedAt",
  "executedBy",
  "executionOwner",
  "targetReconciliationRef",
  "targetRetryBatchRef",
  "targetReceiptAttemptRef",
  "targetReceiptGateRef",
  "requiredCorrectionRefs",
  "requiredTargetDocuments",
  "executionInputHashRef",
  "executionLogRef",
  "executionStatus",
  "executionResultRoute",
  "resultRecordRef",
  "blockerCount",
  "openDispositionRefs",
  "rollbackRequiredIfFailed",
  "rollbackTarget",
  "nextAction",
  "followUpOwner",
  "recoveryCondition",
  "targetReviewDate",
];

const sourceReadinessStatuses = [
  "ready-for-rerun",
  "ready-for-next-retry-batch",
  "returned-for-outcome-review",
  "cancelled",
];

const sourceReadinessRoutes = [
  "rerun-reconciliation",
  "open-next-retry-batch",
  "update-receipt-attempt",
  "recheck-receipt-gate",
  "return-to-disposition",
  "cancelled",
];

const rerunExecutionTypes = [
  "reconciliation-rerun",
  "next-retry-batch-registration",
  "receipt-attempt-update",
  "receipt-gate-ref-recheck",
  "disposition-return",
  "cancelled",
];

const rerunExecutionScopes = [
  "batch-attempt-gate",
  "retry-batch-only",
  "receipt-attempt-only",
  "receipt-gate-ref-only",
  "field-gap-return",
  "cancelled",
];

const executionStatuses = [
  "draft",
  "command-recorded",
  "executed",
  "execution-blocked",
  "execution-failed",
  "execution-result-routed",
  "cancelled",
];

const executionResultRoutes = [
  "route-to-rerun-result-intake",
  "route-to-retry-batch-register",
  "route-to-receipt-attempt-log",
  "route-to-receipt-gate",
  "route-to-failure-disposition",
  "route-to-field-gap-matrix",
  "route-to-return-resubmission-closure",
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

const executionDocName = "当前候选交付Reviewer输出再对账执行记录.md";

assert("candidate reviewer output reconciliation rerun execution check does not change app version", packageJson.version === "1.9.48");
assert(
  "package exposes candidate reviewer output reconciliation rerun execution check command",
  packageJson.scripts["candidate:reviewer-output-reconciliation-rerun-execution-check"] ===
    "node scripts/candidate-reviewer-output-reconciliation-rerun-execution-check.js"
);
assert(
  "check pipeline includes candidate reviewer output reconciliation rerun execution check",
  packageJson.scripts.check.includes("node scripts/candidate-reviewer-output-reconciliation-rerun-execution-check.js")
);
assert("reviewer output reconciliation rerun execution exists", fs.existsSync(executionPath));
assert("reviewer output reconciliation rerun execution is execution-only", execution.includes("reviewer-output-reconciliation-rerun-execution-only"));
assert(
  "reviewer output reconciliation rerun execution preserves candidate state",
  execution.includes("APP_VERSION=1.9.48") &&
    execution.includes("PHASE=29") &&
    execution.includes("rc-reviewable-but-not-releasable")
);
assert(
  "reviewer output reconciliation rerun execution keeps gates blocked",
  execution.includes("releaseReady=false") &&
    execution.includes("phase29ExitReady=false") &&
    execution.includes("phase30EntryReady=false") &&
    execution.includes("runtimeExecution=false") &&
    execution.includes("thirdPartyExecution=false")
);
assert(
  "reviewer output reconciliation rerun execution records missing evidence state",
  execution.includes("liveSubmissionExists=false") &&
    execution.includes("approvedSlots=0") &&
    execution.includes("missingSlots=10")
);
assert(
  "reviewer output reconciliation rerun execution blocks conversion by default",
  execution.includes("maintainerConversionAuthorization=false") &&
    execution.includes("readyForLiveSubmissionCreation=false")
);
assert("reviewer output reconciliation rerun execution lists fields", executionFields.every((field) => execution.includes(field)));
assert("reviewer output reconciliation rerun execution lists source readiness statuses", sourceReadinessStatuses.every((status) => execution.includes(status)));
assert("reviewer output reconciliation rerun execution lists source readiness routes", sourceReadinessRoutes.every((route) => execution.includes(route)));
assert("reviewer output reconciliation rerun execution lists execution types", rerunExecutionTypes.every((type) => execution.includes(type)));
assert("reviewer output reconciliation rerun execution lists execution scopes", rerunExecutionScopes.every((scope) => execution.includes(scope)));
assert("reviewer output reconciliation rerun execution lists execution statuses", executionStatuses.every((status) => execution.includes(status)));
assert("reviewer output reconciliation rerun execution lists result routes", executionResultRoutes.every((route) => execution.includes(route)));
assert("reviewer output reconciliation rerun execution covers reviewer roles", reviewerRoles.every((role) => execution.includes(role)));
assert("reviewer output reconciliation rerun execution covers all slots", requiredSlots.every((slot) => execution.includes(slot)));
assert("reviewer output reconciliation rerun execution keeps reviewer fields external", requiredReviewerFields.every((field) => execution.includes(field)));
assert("reviewer output reconciliation rerun execution requires followup fields", followupFields.every((field) => execution.includes(field)));
assert("reviewer output reconciliation rerun execution links required documents", requiredDocuments.every((doc) => execution.includes(doc)));
assert("reviewer output reconciliation rerun execution includes command checks", commands.every((command) => execution.includes(command)));
assert(
  "reviewer output reconciliation rerun execution protects live submission conversion",
  execution.includes("data/phase30-human-evidence-submission.json") &&
    execution.includes("不得在仓库保存真实 reviewer 输出")
);
assert(
  "reviewer output reconciliation rerun execution says it is not acceptance",
  execution.includes("不证明 reviewer 输出已经产生") &&
    execution.includes("不证明字段已经修复") &&
    execution.includes("不证明 Reviewer 输出接收门禁通过") &&
    execution.includes("不是 evidence acceptance")
);
assert(
  "reviewer output reconciliation rerun execution maps execution targets",
  execution.includes("targetReconciliationRef") &&
    execution.includes("targetRetryBatchRef") &&
    execution.includes("targetReceiptAttemptRef") &&
    execution.includes("targetReceiptGateRef")
);
assert(
  "reviewer output reconciliation rerun execution rejects false status meanings",
  execution.includes("command-recorded") &&
    execution.includes("executed") &&
    execution.includes("execution-result-routed") &&
    execution.includes("都不表示 reviewer 输出已经被接收") &&
    execution.includes("不得直接生成 reviewer 输出接收结果")
);
assert("rerun readiness links rerun execution", readiness.includes(executionDocName));
assert("outcome review links rerun execution", outcome.includes(executionDocName));
assert("failure disposition links rerun execution", disposition.includes(executionDocName));
assert("reconciliation links rerun execution", reconciliation.includes(executionDocName));
assert("retry batch register links rerun execution", retryBatch.includes(executionDocName));
assert("receipt attempt log links rerun execution", attempt.includes(executionDocName));
assert("output receipt gate links rerun execution", receiptGate.includes(executionDocName));
assert("field gap matrix links rerun execution", fieldGapMatrix.includes(executionDocName));
assert("field fix assignment links rerun execution", assignment.includes(executionDocName));
assert("return resubmission closure record links rerun execution", returnClosure.includes(executionDocName));
assert("pre-review package links rerun execution", preReview.includes(executionDocName));
assert("review execution sequence links rerun execution", sequence.includes(executionDocName));
assert("review chain integrity index links rerun execution", integrity.includes(executionDocName));
assert("negative misuse check links rerun execution", negative.includes(executionDocName));
assert("final review package lock index links rerun execution", finalLock.includes(executionDocName));
assert(
  "README links reviewer output reconciliation rerun execution",
  readme.includes("Current candidate reviewer output reconciliation rerun execution") &&
    readme.includes("项目文档/当前候选交付Reviewer输出再对账执行记录.md")
);
assert("live human evidence submission remains absent", !fs.existsSync(liveSubmissionPath));

console.log("Candidate reviewer output reconciliation rerun execution checks passed.");
