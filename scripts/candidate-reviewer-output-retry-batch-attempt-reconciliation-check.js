const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const docsDir = path.join(projectRoot, "项目文档");
const reconciliationPath = path.join(docsDir, "当前候选交付Reviewer输出重试批次与接收尝试对账记录.md");
const retryBatchPath = path.join(docsDir, "当前候选交付Reviewer输出重试批次登记表.md");
const attemptPath = path.join(docsDir, "当前候选交付Reviewer输出接收尝试记录.md");
const receiptGatePath = path.join(docsDir, "当前候选交付Reviewer输出接收门禁.md");
const receiptReadinessPath = path.join(docsDir, "当前候选交付Reviewer输出字段修复回执与重试准备记录.md");
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
const reconciliation = fs.readFileSync(reconciliationPath, "utf8");
const retryBatch = fs.readFileSync(retryBatchPath, "utf8");
const attempt = fs.readFileSync(attemptPath, "utf8");
const receiptGate = fs.readFileSync(receiptGatePath, "utf8");
const receiptReadiness = fs.readFileSync(receiptReadinessPath, "utf8");
const fieldGapMatrix = fs.readFileSync(fieldGapMatrixPath, "utf8");
const assignment = fs.readFileSync(assignmentPath, "utf8");
const returnClosure = fs.readFileSync(returnClosurePath, "utf8");
const preReview = fs.readFileSync(preReviewPath, "utf8");
const sequence = fs.readFileSync(sequencePath, "utf8");
const integrity = fs.readFileSync(integrityPath, "utf8");
const negative = fs.readFileSync(negativePath, "utf8");
const finalLock = fs.readFileSync(finalLockPath, "utf8");

const reconciliationFields = [
  "retryAttemptReconciliationId",
  "sourceRetryBatchId",
  "sourceRetryBatchStatus",
  "sourceFieldFixReceiptIds",
  "sourceReceiptAttemptId",
  "targetReceiptAttemptId",
  "receiptAttemptLogged",
  "receiptAttemptResult",
  "receiptGateDecisionRef",
  "receiptGateDecisionStatus",
  "batchToAttemptMatchStatus",
  "unmatchedBatchReason",
  "orphanAttemptReason",
  "affectedEvidenceSlots",
  "affectedFieldNames",
  "reviewerRoles",
  "reconciliationStatus",
  "reconciledAt",
  "reconciledBy",
  "failureRoute",
  "rollbackRequiredIfFailed",
  "rollbackTarget",
  "nextAction",
  "followUpOwner",
  "recoveryCondition",
  "targetReviewDate",
];

const sourceRetryBatchStatuses = [
  "draft",
  "ready-for-receipt-attempt",
  "queued-for-receipt-attempt",
  "attempt-recorded",
  "blocked-by-open-gap",
  "blocked-by-missing-package",
  "cancelled",
];

const receiptAttemptResults = [
  "attempt-recorded",
  "receipt-gate-passed",
  "receipt-gate-failed",
  "returned-for-fix",
  "retry-required",
  "cancelled",
];

const receiptGateDecisionStatuses = [
  "not-run",
  "referenced",
  "passed",
  "failed",
  "returned-for-fix",
  "cancelled",
];

const matchStatuses = [
  "matched",
  "unmatched-batch",
  "orphan-attempt",
  "missing-gate-ref",
  "pending-attempt",
  "cancelled",
];

const reconciliationStatuses = [
  "draft",
  "ready-for-attempt-log",
  "attempt-linked",
  "gate-ref-linked",
  "blocked-by-missing-attempt",
  "blocked-by-missing-gate-ref",
  "returned-for-gap-review",
  "cancelled",
];

const failureRoutes = [
  "return-to-retry-batch-register",
  "return-to-receipt-attempt-log",
  "return-to-field-gap-matrix",
  "return-to-field-fix-assignment",
  "return-to-return-resubmission-closure",
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
  "npm.cmd run candidate:reviewer-output-retry-batch-attempt-reconciliation-check",
  "npm.cmd run candidate:reviewer-output-retry-batch-register-check",
  "npm.cmd run candidate:reviewer-output-receipt-attempt-log-check",
  "npm.cmd run candidate:reviewer-output-field-fix-receipt-retry-readiness-check",
  "npm.cmd run candidate:reviewer-output-field-gap-matrix-check",
  "npm.cmd run candidate:reviewer-output-field-fix-assignment-check",
  "npm.cmd run candidate:reviewer-output-return-resubmission-closure-check",
  "npm.cmd run candidate:reviewer-output-receipt-check",
  "npm.cmd run candidate:final-review-package-lock-check",
  "npm.cmd run candidate:negative-misuse-check",
  "npm.cmd run candidate:review-chain-integrity-check",
  "npm.cmd run candidate:review-execution-sequence-check",
  "npm.cmd run candidate:pre-review-package-check",
  "npm.cmd run phase30:evidence-closure-status",
  "npm.cmd run check",
];

assert("candidate reviewer output retry batch attempt reconciliation check does not change app version", packageJson.version === "1.9.48");
assert(
  "package exposes candidate reviewer output retry batch attempt reconciliation check command",
  packageJson.scripts["candidate:reviewer-output-retry-batch-attempt-reconciliation-check"] ===
    "node scripts/candidate-reviewer-output-retry-batch-attempt-reconciliation-check.js"
);
assert(
  "check pipeline includes candidate reviewer output retry batch attempt reconciliation check",
  packageJson.scripts.check.includes("node scripts/candidate-reviewer-output-retry-batch-attempt-reconciliation-check.js")
);
assert("reviewer output retry batch attempt reconciliation exists", fs.existsSync(reconciliationPath));
assert("reviewer output retry batch attempt reconciliation is reconciliation-only", reconciliation.includes("reviewer-output-retry-batch-attempt-reconciliation-only"));
assert(
  "reviewer output retry batch attempt reconciliation preserves candidate state",
  reconciliation.includes("APP_VERSION=1.9.48") &&
    reconciliation.includes("PHASE=29") &&
    reconciliation.includes("rc-reviewable-but-not-releasable")
);
assert(
  "reviewer output retry batch attempt reconciliation keeps gates blocked",
  reconciliation.includes("releaseReady=false") &&
    reconciliation.includes("phase29ExitReady=false") &&
    reconciliation.includes("phase30EntryReady=false") &&
    reconciliation.includes("runtimeExecution=false") &&
    reconciliation.includes("thirdPartyExecution=false")
);
assert(
  "reviewer output retry batch attempt reconciliation records missing evidence state",
  reconciliation.includes("liveSubmissionExists=false") &&
    reconciliation.includes("approvedSlots=0") &&
    reconciliation.includes("missingSlots=10")
);
assert(
  "reviewer output retry batch attempt reconciliation blocks conversion by default",
  reconciliation.includes("maintainerConversionAuthorization=false") &&
    reconciliation.includes("readyForLiveSubmissionCreation=false")
);
assert("reviewer output retry batch attempt reconciliation lists fields", reconciliationFields.every((field) => reconciliation.includes(field)));
assert("reviewer output retry batch attempt reconciliation lists source batch statuses", sourceRetryBatchStatuses.every((status) => reconciliation.includes(status)));
assert("reviewer output retry batch attempt reconciliation lists receipt attempt results", receiptAttemptResults.every((result) => reconciliation.includes(result)));
assert("reviewer output retry batch attempt reconciliation lists gate statuses", receiptGateDecisionStatuses.every((status) => reconciliation.includes(status)));
assert("reviewer output retry batch attempt reconciliation lists match statuses", matchStatuses.every((status) => reconciliation.includes(status)));
assert("reviewer output retry batch attempt reconciliation lists reconciliation statuses", reconciliationStatuses.every((status) => reconciliation.includes(status)));
assert("reviewer output retry batch attempt reconciliation lists failure routes", failureRoutes.every((route) => reconciliation.includes(route)));
assert("reviewer output retry batch attempt reconciliation covers reviewer roles", reviewerRoles.every((role) => reconciliation.includes(role)));
assert("reviewer output retry batch attempt reconciliation covers all slots", requiredSlots.every((slot) => reconciliation.includes(slot)));
assert("reviewer output retry batch attempt reconciliation keeps reviewer fields external", requiredReviewerFields.every((field) => reconciliation.includes(field)));
assert("reviewer output retry batch attempt reconciliation requires followup fields", followupFields.every((field) => reconciliation.includes(field)));
assert("reviewer output retry batch attempt reconciliation includes command checks", commands.every((command) => reconciliation.includes(command)));
assert(
  "reviewer output retry batch attempt reconciliation protects live submission conversion",
  reconciliation.includes("data/phase30-human-evidence-submission.json") &&
    reconciliation.includes("不得在仓库保存真实 reviewer 输出")
);
assert(
  "reviewer output retry batch attempt reconciliation says it is not acceptance",
  reconciliation.includes("不是 reviewer 输出") &&
    reconciliation.includes("不是字段已修复证明") &&
    reconciliation.includes("不是 Reviewer 输出接收门禁通过") &&
    reconciliation.includes("不是 evidence acceptance")
);
assert(
  "reviewer output retry batch attempt reconciliation routes through batch attempt and gate",
  reconciliation.includes("当前候选交付Reviewer输出重试批次登记表.md") &&
    reconciliation.includes("当前候选交付Reviewer输出接收尝试记录.md") &&
    reconciliation.includes("当前候选交付Reviewer输出接收门禁.md")
);
assert(
  "reviewer output retry batch attempt reconciliation rejects false status meanings",
  reconciliation.includes("attempt-linked") &&
    reconciliation.includes("gate-ref-linked") &&
    reconciliation.includes("不表示 reviewer 输出已经被接收") &&
    reconciliation.includes("不表示接收门禁通过")
);
assert("reviewer output retry batch attempt reconciliation links retry batch register", reconciliation.includes("当前候选交付Reviewer输出重试批次登记表.md"));
assert("reviewer output retry batch attempt reconciliation links receipt attempt log", reconciliation.includes("当前候选交付Reviewer输出接收尝试记录.md"));
assert("reviewer output retry batch attempt reconciliation links output receipt gate", reconciliation.includes("当前候选交付Reviewer输出接收门禁.md"));
assert("retry batch register links reconciliation", retryBatch.includes("当前候选交付Reviewer输出重试批次与接收尝试对账记录.md"));
assert("receipt attempt log links reconciliation", attempt.includes("当前候选交付Reviewer输出重试批次与接收尝试对账记录.md"));
assert("output receipt gate links reconciliation", receiptGate.includes("当前候选交付Reviewer输出重试批次与接收尝试对账记录.md"));
assert("field fix receipt retry readiness links reconciliation", receiptReadiness.includes("当前候选交付Reviewer输出重试批次与接收尝试对账记录.md"));
assert("field gap matrix links reconciliation", fieldGapMatrix.includes("当前候选交付Reviewer输出重试批次与接收尝试对账记录.md"));
assert("field fix assignment links reconciliation", assignment.includes("当前候选交付Reviewer输出重试批次与接收尝试对账记录.md"));
assert("return resubmission closure record links reconciliation", returnClosure.includes("当前候选交付Reviewer输出重试批次与接收尝试对账记录.md"));
assert("pre-review package links reconciliation", preReview.includes("当前候选交付Reviewer输出重试批次与接收尝试对账记录.md"));
assert("review execution sequence links reconciliation", sequence.includes("当前候选交付Reviewer输出重试批次与接收尝试对账记录.md"));
assert("review chain integrity index links reconciliation", integrity.includes("当前候选交付Reviewer输出重试批次与接收尝试对账记录.md"));
assert("negative misuse check links reconciliation", negative.includes("当前候选交付Reviewer输出重试批次与接收尝试对账记录.md"));
assert("final review package lock index links reconciliation", finalLock.includes("当前候选交付Reviewer输出重试批次与接收尝试对账记录.md"));
assert(
  "README links reviewer output retry batch attempt reconciliation",
  readme.includes("Current candidate reviewer output retry batch attempt reconciliation") &&
    readme.includes("项目文档/当前候选交付Reviewer输出重试批次与接收尝试对账记录.md")
);
assert("live human evidence submission remains absent", !fs.existsSync(liveSubmissionPath));

console.log("Candidate reviewer output retry batch attempt reconciliation checks passed.");
