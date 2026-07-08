const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const docsDir = path.join(projectRoot, "项目文档");
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

const dispositionFields = [
  "failureDispositionId",
  "sourceRetryAttemptReconciliationId",
  "sourceRetryBatchId",
  "sourceReceiptAttemptId",
  "sourceReceiptGateDecisionRef",
  "failedReconciliationStatus",
  "failedBatchToAttemptMatchStatus",
  "failureReasonType",
  "failureReasonSummary",
  "affectedEvidenceSlots",
  "affectedFieldNames",
  "reviewerRoles",
  "dispositionRoute",
  "routeTargetDocument",
  "routeTargetOwner",
  "routeTargetDueAt",
  "requiredCorrection",
  "rollbackRequiredIfFailed",
  "rollbackTarget",
  "returnClosureRef",
  "fieldGapMatrixRef",
  "fieldFixAssignmentRef",
  "nextRetryBatchRef",
  "nextReceiptAttemptRef",
  "receiptGateRecheckRequired",
  "dispositionStatus",
  "disposedAt",
  "disposedBy",
  "nextAction",
  "followUpOwner",
  "recoveryCondition",
  "targetReviewDate",
];

const failedReconciliationStatuses = [
  "blocked-by-missing-attempt",
  "blocked-by-missing-gate-ref",
  "returned-for-gap-review",
];

const failedMatchStatuses = [
  "unmatched-batch",
  "orphan-attempt",
  "missing-gate-ref",
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

const dispositionStatuses = [
  "draft",
  "needs-owner-triage",
  "routed",
  "returned-to-owner",
  "ready-for-field-gap-review",
  "ready-for-field-fix-assignment",
  "ready-for-return-closure",
  "ready-for-next-retry-batch",
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
  "当前候选交付Reviewer输出重试批次与接收尝试对账记录.md",
  "当前候选交付Reviewer输出重试批次登记表.md",
  "当前候选交付Reviewer输出接收尝试记录.md",
  "当前候选交付Reviewer输出接收门禁.md",
  "当前候选交付Reviewer输出字段缺口定位矩阵.md",
  "当前候选交付Reviewer输出字段修复责任分派单.md",
  "当前候选交付Reviewer输出退回与补交闭环记录.md",
];

const commands = [
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

const dispositionDocName = "当前候选交付Reviewer输出对账失败回流处置单.md";

assert("candidate reviewer output reconciliation failure disposition check does not change app version", packageJson.version === "1.9.48");
assert(
  "package exposes candidate reviewer output reconciliation failure disposition check command",
  packageJson.scripts["candidate:reviewer-output-reconciliation-failure-disposition-check"] ===
    "node scripts/candidate-reviewer-output-reconciliation-failure-disposition-check.js"
);
assert(
  "check pipeline includes candidate reviewer output reconciliation failure disposition check",
  packageJson.scripts.check.includes("node scripts/candidate-reviewer-output-reconciliation-failure-disposition-check.js")
);
assert("reviewer output reconciliation failure disposition exists", fs.existsSync(dispositionPath));
assert("reviewer output reconciliation failure disposition is disposition-only", disposition.includes("reviewer-output-reconciliation-failure-disposition-only"));
assert(
  "reviewer output reconciliation failure disposition preserves candidate state",
  disposition.includes("APP_VERSION=1.9.48") &&
    disposition.includes("PHASE=29") &&
    disposition.includes("rc-reviewable-but-not-releasable")
);
assert(
  "reviewer output reconciliation failure disposition keeps gates blocked",
  disposition.includes("releaseReady=false") &&
    disposition.includes("phase29ExitReady=false") &&
    disposition.includes("phase30EntryReady=false") &&
    disposition.includes("runtimeExecution=false") &&
    disposition.includes("thirdPartyExecution=false")
);
assert(
  "reviewer output reconciliation failure disposition records missing evidence state",
  disposition.includes("liveSubmissionExists=false") &&
    disposition.includes("approvedSlots=0") &&
    disposition.includes("missingSlots=10")
);
assert(
  "reviewer output reconciliation failure disposition blocks conversion by default",
  disposition.includes("maintainerConversionAuthorization=false") &&
    disposition.includes("readyForLiveSubmissionCreation=false")
);
assert("reviewer output reconciliation failure disposition lists fields", dispositionFields.every((field) => disposition.includes(field)));
assert("reviewer output reconciliation failure disposition lists failed reconciliation statuses", failedReconciliationStatuses.every((status) => disposition.includes(status)));
assert("reviewer output reconciliation failure disposition lists failed match statuses", failedMatchStatuses.every((status) => disposition.includes(status)));
assert("reviewer output reconciliation failure disposition lists failure reason types", failureReasonTypes.every((reasonType) => disposition.includes(reasonType)));
assert("reviewer output reconciliation failure disposition lists disposition routes", dispositionRoutes.every((route) => disposition.includes(route)));
assert("reviewer output reconciliation failure disposition lists disposition statuses", dispositionStatuses.every((status) => disposition.includes(status)));
assert("reviewer output reconciliation failure disposition covers reviewer roles", reviewerRoles.every((role) => disposition.includes(role)));
assert("reviewer output reconciliation failure disposition covers all slots", requiredSlots.every((slot) => disposition.includes(slot)));
assert("reviewer output reconciliation failure disposition keeps reviewer fields external", requiredReviewerFields.every((field) => disposition.includes(field)));
assert("reviewer output reconciliation failure disposition requires followup fields", followupFields.every((field) => disposition.includes(field)));
assert("reviewer output reconciliation failure disposition links required route documents", requiredDocuments.every((doc) => disposition.includes(doc)));
assert("reviewer output reconciliation failure disposition includes command checks", commands.every((command) => disposition.includes(command)));
assert(
  "reviewer output reconciliation failure disposition protects live submission conversion",
  disposition.includes("data/phase30-human-evidence-submission.json") &&
    disposition.includes("不得在仓库保存真实 reviewer 输出")
);
assert(
  "reviewer output reconciliation failure disposition says it is not acceptance",
  disposition.includes("不是 reviewer 输出") &&
    disposition.includes("不是字段已修复证明") &&
    disposition.includes("不是 Reviewer 输出接收门禁通过") &&
    disposition.includes("不是 evidence acceptance")
);
assert(
  "reviewer output reconciliation failure disposition routes each failure status",
  disposition.includes("unmatched-batch") &&
    disposition.includes("orphan-attempt") &&
    disposition.includes("missing-gate-ref") &&
    disposition.includes("blocked-by-missing-attempt") &&
    disposition.includes("blocked-by-missing-gate-ref") &&
    disposition.includes("returned-for-gap-review")
);
assert(
  "reviewer output reconciliation failure disposition rejects false status meanings",
  disposition.includes("routed") &&
    disposition.includes("returned-to-owner") &&
    disposition.includes("ready-for-next-retry-batch") &&
    disposition.includes("都不表示 reviewer 输出已被接收") &&
    disposition.includes("return-to-receipt-gate") &&
    disposition.includes("当作 Reviewer 输出接收门禁通过")
);
assert("reconciliation links failure disposition", reconciliation.includes(dispositionDocName));
assert("retry batch register links failure disposition", retryBatch.includes(dispositionDocName));
assert("receipt attempt log links failure disposition", attempt.includes(dispositionDocName));
assert("output receipt gate links failure disposition", receiptGate.includes(dispositionDocName));
assert("field gap matrix links failure disposition", fieldGapMatrix.includes(dispositionDocName));
assert("field fix assignment links failure disposition", assignment.includes(dispositionDocName));
assert("return resubmission closure record links failure disposition", returnClosure.includes(dispositionDocName));
assert("pre-review package links failure disposition", preReview.includes(dispositionDocName));
assert("review execution sequence links failure disposition", sequence.includes(dispositionDocName));
assert("review chain integrity index links failure disposition", integrity.includes(dispositionDocName));
assert("negative misuse check links failure disposition", negative.includes(dispositionDocName));
assert("final review package lock index links failure disposition", finalLock.includes(dispositionDocName));
assert(
  "README links reviewer output reconciliation failure disposition",
  readme.includes("Current candidate reviewer output reconciliation failure disposition") &&
    readme.includes("项目文档/当前候选交付Reviewer输出对账失败回流处置单.md")
);
assert("live human evidence submission remains absent", !fs.existsSync(liveSubmissionPath));

console.log("Candidate reviewer output reconciliation failure disposition checks passed.");
